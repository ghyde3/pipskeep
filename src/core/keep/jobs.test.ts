/**
 * Gathering job tests (spec §6.2, Phase 5 gate):
 *
 * - ASSIGN_JOB requires a PLACED Gathering Station; decorations and
 *   missing placements refuse; one pip per station; Sulking pips refuse
 *   WITH dialogue; busy pips refuse structurally.
 * - Production: exactly 1 resource per 10 min — 6/hour, scaled by
 *   elapsed — via the seeded `"job"` stream (weighted Berries 70 /
 *   Fiber 30 from tuning), asserted item-by-item against
 *   first-principles stream arithmetic.
 * - Offline: production registers through the catch-up extraEvents seam
 *   and OBEYS the 12h rate cap (spec §4.5/§6.2): a 72h absence yields
 *   exactly 12h × 6 = 72 resources, and the frozen tail is never
 *   backfilled by the next live tick.
 * - A pip that bottoms out mid-absence enters Sulking at the segment
 *   boundary and stops producing from that moment (§4.4).
 * - The job is DERIVED from lastProducedAt timestamps: it survives a
 *   full serialize → wire → migrate reload and produces at the exact
 *   derived moments afterwards. Live and catch-up paths advance the
 *   `"job"` cursor identically over the same timeline.
 *
 * All time is explicit FakeClock-style timestamps — no ambient clocks.
 */

import { describe, expect, it } from "vitest";
import { HOUR_MS, MINUTE_MS, tuning } from "../../content/tuning";
import { jobs as contentJobs } from "../../content/jobs";
import { createRng } from "../rng";
import { LifeStage, PipActivity } from "../pips/types";
import type { PipNeeds, PipState } from "../pips/types";
import { rootReducer } from "../state";
import type { GameState } from "../state";
import { toSaveBlob } from "../save/serialize";
import { migrate } from "../save/migrate";
import type { KeepState } from "./index";
import {
  JOB_STREAM,
  assignPipToJob,
  processJobProduction,
  unassignPipFromJob,
} from "./jobs";

const T0 = 10_000_000;
const SEED = 42;
const INTERVAL = tuning.gathering.intervalMs;
/** Production is a RATE, so an absence yields at most this many ticks
 * however long the player was away (spec §4.5 rule 3 / §6.2). */
const CAPPED_TICKS = tuning.offlineRateCapMs / INTERVAL;
const CAP_HOURS = tuning.offlineRateCapMs / HOUR_MS;

function needs(overrides: Partial<PipNeeds> = {}): PipNeeds {
  return { hunger: 100, cleanliness: 100, happiness: 100, energy: 100, ...overrides };
}

function makePip(id: string, overrides: Partial<PipState> = {}): PipState {
  const personalityId = overrides.personalityId ?? "curious";
  return {
    id,
    speciesId: "mosspip",
    name: "Testpip",
    genome: {
      speciesId: "mosspip",
      palette: "fern",
      pattern: "plain",
      accessorySlots: 1,
      personalityId,
      shiny: false,
    },
    personalityId,
    lifeStage: LifeStage.Adult,
    hatchedAt: 0,
    ageMs: T0,
    happinessIntegral: 100 * T0,
    needs: needs(),
    activity: PipActivity.Idle,
    pendingSulk: false,
    readyToEvolve: false,
    evolved: null,
    lastGiftItemId: null,
    expedition: null,
    needsUpdatedAt: T0,
    ...overrides,
  };
}

/** Level-2 Keep with a station at place-1, a second at place-2, and a
 * decoration at place-3 (spec §9 shapes: stations 2×2 fit an 8-wide row). */
function keepWithStations(): KeepState {
  return {
    level: 2,
    placements: {
      "place-1": { itemId: "gathering-station", x: 0, y: 0 },
      "place-2": { itemId: "gathering-station", x: 3, y: 0 },
      "place-3": { itemId: "cozy-lantern", x: 6, y: 0 },
    },
  };
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  const pips = overrides.pips ?? { "pip-1": makePip("pip-1") };
  const rosterOrder = overrides.rosterOrder ?? Object.keys(pips);
  return {
    pips,
    rosterOrder,
    activePipId: rosterOrder[0] ?? "pip-1",
    inventory: {},
    resources: {},
    rngState: {},
    seed: SEED,
    keep: keepWithStations(),
    jobs: {},
    rosterUpgradePurchased: false,
    eggs: [],
    pendingReveals: [],
    nextPipNumber: Object.keys(pips).length + 1,
    nextEggNumber: 1,
    nextPlacementNumber: 4,
    cooldowns: {},
    lastLineIndex: {},
    createdAt: 0,
    lastTickAt: T0,
    lastCareOutcome: null,
    lastCatchup: null,
    lastAssignOutcome: null,
    lastHatchOutcome: null,
    lastJobOutcome: null,
    lastEvolveOutcome: null,
    onboarding: { completed: true, step: "done" },
    pipdex: {
      entries: {},
      discoveryOrder: [],
      formsSeen: 0,
      formsCaught: 0,
      variantsCaught: 0,
      shiniesCaught: 0,
      unreadEntryIds: [],
    },
    sanctuary: { pips: {}, order: [] },
    lastSanctuaryOutcome: null,
    // ROUND 2C — progression stack defaults (docs/retention-bible.md).
    streak: {
      current: 0,
      longest: 0,
      lastVisitDay: null,
      totalVisitDays: 0,
      graceBanked: 2,
      graceRefilledOnDay: null,
      rainDays: 0,
      rewardedForDay: null,
      pendingChoices: [],
    },
    dayOffsetMs: 0,
    counters: {},
    milestones: { earned: {}, pendingCelebrations: [] },
    bounties: { day: null, slots: [], rerollsUsed: 0, dayBonusGranted: false },
    eggPity: {},
    activeEvents: [],
    keepsakes: {},
    flair: {},
    ...overrides,
  };
}

/** Total production across BOTH pools: food output (Berries) routes to
 * the inventory, everything else to resources (spec §6.3 routing —
 * makeState starts both pools empty, so the sum is pure production). */
const totalResources = (state: GameState): number =>
  [...Object.values(state.resources), ...Object.values(state.inventory)].reduce(
    (sum, n) => sum + n,
    0,
  );

/** First-principles replica of one weighted production roll: raw stream
 * arithmetic over the tuning table (Berries 70 / Fiber 30), independent
 * of the implementation under test. */
function referenceRoll(next: () => number): string {
  const table = contentJobs["gathering"]?.table ?? [];
  const total = table.reduce((sum, entry) => sum + entry.weight, 0);
  let r = next() * total;
  for (const entry of table) {
    r -= entry.weight;
    if (r < 0) return entry.itemId;
  }
  throw new Error("reference roll fell through");
}

describe("assignment legality (spec §6.2/§4.7)", () => {
  it("assigns an Idle pip at a placed station: AssignedJob + a jobs entry", () => {
    const next = rootReducer(makeState(), {
      type: "ASSIGN_JOB",
      pipId: "pip-1",
      stationPlacementId: "place-1",
      at: T0,
    });
    expect(next.pips["pip-1"]?.activity).toBe(PipActivity.AssignedJob);
    expect(next.jobs["pip-1"]).toEqual({
      jobId: "gathering",
      stationPlacementId: "place-1",
      assignedAt: T0,
      lastProducedAt: T0,
    });
    expect(next.lastJobOutcome).toEqual({
      action: "assignJob",
      ok: true,
      pipId: "pip-1",
      jobId: "gathering",
      stationPlacementId: "place-1",
      at: T0,
    });
  });

  it("requires a placed JOB station: missing placements and decorations refuse", () => {
    for (const stationPlacementId of ["place-99", "place-3"]) {
      const { state, outcome } = assignPipToJob(
        makeState(),
        "pip-1",
        stationPlacementId,
        T0,
      );
      expect(outcome).toMatchObject({ ok: false, reason: "unknownStation" });
      expect(state.jobs).toEqual({});
    }
  });

  it("one pip per station (spec §6.2); a second station is fine", () => {
    const two = makeState({
      pips: { "pip-1": makePip("pip-1"), "pip-2": makePip("pip-2") },
    });
    const first = rootReducer(two, {
      type: "ASSIGN_JOB", pipId: "pip-1", stationPlacementId: "place-1", at: T0,
    });
    const refused = rootReducer(first, {
      type: "ASSIGN_JOB", pipId: "pip-2", stationPlacementId: "place-1", at: T0,
    });
    expect(refused.lastJobOutcome).toMatchObject({ ok: false, reason: "occupied" });
    expect(refused.pips["pip-2"]?.activity).toBe(PipActivity.Idle);

    const other = rootReducer(first, {
      type: "ASSIGN_JOB", pipId: "pip-2", stationPlacementId: "place-2", at: T0,
    });
    expect(other.lastJobOutcome).toMatchObject({ ok: true });
    expect(other.jobs["pip-2"]?.stationPlacementId).toBe("place-2");
  });

  it("a Sulking pip refuses WITH a Refusal line; busy pips refuse structurally", () => {
    const sulker = makeState({
      pips: {
        "pip-1": makePip("pip-1", {
          activity: PipActivity.Sulking,
          needs: needs({ happiness: 0 }),
        }),
      },
    });
    const refused = rootReducer(sulker, {
      type: "ASSIGN_JOB", pipId: "pip-1", stationPlacementId: "place-1", at: T0,
    });
    expect(refused.lastJobOutcome).toMatchObject({ ok: false, reason: "sulking" });
    expect(refused.lastJobOutcome).toHaveProperty("line");
    expect(refused.pips["pip-1"]?.activity).toBe(PipActivity.Sulking);
    // The line draw advanced the dialogue cursor (and only that).
    expect(refused.rngState["dialogue"]).toBeDefined();
    expect(refused.rngState[JOB_STREAM]).toBeUndefined();

    const resting = makeState({
      pips: { "pip-1": makePip("pip-1", { activity: PipActivity.Resting }) },
    });
    const busy = assignPipToJob(resting, "pip-1", "place-1", T0);
    expect(busy.outcome).toMatchObject({ ok: false, reason: "busy" });
    expect(busy.state).toBe(resting); // structural refusals cost nothing

    const unknown = assignPipToJob(makeState(), "pip-9", "place-1", T0);
    expect(unknown.outcome).toMatchObject({ ok: false, reason: "unknownPip" });
  });

  it("UNASSIGN_JOB returns the pip to Idle and drops the entry", () => {
    const working = rootReducer(makeState(), {
      type: "ASSIGN_JOB", pipId: "pip-1", stationPlacementId: "place-1", at: T0,
    });
    const idle = rootReducer(working, { type: "UNASSIGN_JOB", pipId: "pip-1", at: 0 });
    expect(idle.pips["pip-1"]?.activity).toBe(PipActivity.Idle);
    expect(idle.jobs).toEqual({});
    expect(idle.lastJobOutcome).toEqual({
      action: "unassignJob", ok: true, pipId: "pip-1",
    });

    const notAssigned = unassignPipFromJob(makeState(), "pip-1");
    expect(notAssigned.outcome).toMatchObject({ ok: false, reason: "notAssigned" });
  });

  it("REMOVE_ITEM on an occupied station unassigns its worker", () => {
    const working = rootReducer(makeState(), {
      type: "ASSIGN_JOB", pipId: "pip-1", stationPlacementId: "place-1", at: T0,
    });
    const removed = rootReducer(working, {
      type: "REMOVE_ITEM", placementId: "place-1", at: 0 });
    expect(removed.keep.placements["place-1"]).toBeUndefined();
    expect(removed.pips["pip-1"]?.activity).toBe(PipActivity.Idle);
    expect(removed.jobs).toEqual({});
  });
});

describe("live production (spec §6.2: 1 per 10 min from the weighted table)", () => {
  const working = (): GameState =>
    rootReducer(makeState(), {
      type: "ASSIGN_JOB", pipId: "pip-1", stationPlacementId: "place-1", at: T0,
    });

  it("produces nothing before the first interval boundary", () => {
    const next = rootReducer(working(), { type: "TICK", at: T0 + INTERVAL - 1 });
    expect(next.resources).toEqual({});
    expect(next.jobs["pip-1"]?.lastProducedAt).toBe(T0);
  });

  it("produces exactly 6/hour, scaled by elapsed (3 at 30min, 6 at 1h)", () => {
    const half = rootReducer(working(), { type: "TICK", at: T0 + 30 * MINUTE_MS });
    expect(totalResources(half)).toBe(3);
    expect(half.jobs["pip-1"]?.lastProducedAt).toBe(T0 + 30 * MINUTE_MS);

    const hour = rootReducer(half, { type: "TICK", at: T0 + HOUR_MS });
    expect(totalResources(hour)).toBe(6);
    expect(hour.jobs["pip-1"]?.lastProducedAt).toBe(T0 + HOUR_MS);
    expect(tuning.gathering.intervalMs).toBe(10 * MINUTE_MS); // the 6/hour rate
  });

  it("rolls item-by-item from the seeded 'job' stream (Berries 70/Fiber 30)", () => {
    const hour = rootReducer(working(), { type: "TICK", at: T0 + HOUR_MS });

    // First-principles: 6 weighted rolls from seed 42's fresh "job"
    // stream, over the tuning table — no reuse of the implementation.
    // Routing rule (spec §6.3): berries are FOOD → inventory; fiber is
    // a resource. Same rolls, split by the food registry.
    const ref = createRng(SEED).stream(JOB_STREAM);
    const expectedInventory: Record<string, number> = {};
    const expectedResources: Record<string, number> = {};
    for (let i = 0; i < 6; i++) {
      const item = referenceRoll(() => ref.next());
      const bucket = item === "berry" ? expectedInventory : expectedResources;
      bucket[item] = (bucket[item] ?? 0) + 1;
    }
    expect(hour.inventory).toEqual(expectedInventory);
    expect(hour.resources).toEqual(expectedResources);
    // The cursor persisted — a reload never re-rolls (spec §2 rule 3).
    expect(hour.rngState[JOB_STREAM]).toBe(ref.getState());

    // And the table really is the tuning one (round 2A: Wood added, so
    // the station is an economy rather than a Berry faucet).
    expect(tuning.gathering.table).toEqual({ berry: 0.5, fiber: 0.3, wood: 0.2 });
  });

  it("the weighted table converges on the tuning weights over a long seeded run", () => {
    // 16 hourly ticks is a shift a full-needs Curious pip comfortably
    // survives at any sane tuning, giving 96 deterministic rolls on
    // seed 42. (Care is Idle/Resting/Sulking-only, §4.7 — a working pip
    // cannot be topped up mid-shift.)
    let state = working();
    for (let h = 1; h <= 16; h++) {
      state = rootReducer(state, { type: "TICK", at: T0 + h * HOUR_MS });
    }
    expect(state.pips["pip-1"]?.activity).toBe(PipActivity.AssignedJob);
    // Berries route to the inventory (food), Fiber and Wood stay
    // resources — totalResources sums both pools (spec §6.3 routing).
    const produced = totalResources(state);
    expect(produced).toBe(96);
    const berries = state.inventory["berry"] ?? 0;
    const weights = Object.values(tuning.gathering.table);
    const berryShare =
      tuning.gathering.table.berry / weights.reduce((a, b) => a + b, 0);
    expect(berries / produced).toBeGreaterThan(berryShare - 0.12);
    expect(berries / produced).toBeLessThan(berryShare + 0.12);
  });

  it("a pip pulled off AssignedJob produces nothing while its jobs entry lingers", () => {
    // In the TICK arm evaluateSulk runs BEFORE processJobProduction, so
    // a pip that bottoms out mid-window is already Sulking while its
    // state.jobs entry still exists (reconcileJobs prunes only AFTER
    // production has rolled). That window must produce ZERO — no
    // resources, no "job"-stream rolls (spec §4.4 "refuses
    // expeditions/jobs").
    const fragile = makeState({
      pips: { "pip-1": makePip("pip-1", { needs: needs({ hunger: 2.9 }) }) },
    });
    const assigned = rootReducer(fragile, {
      type: "ASSIGN_JOB", pipId: "pip-1", stationPlacementId: "place-1", at: T0,
    });

    // The guard, directly: Sulking pip + lingering jobs entry past a due
    // interval is an exact no-op (same reference back — no resources, no
    // rng advance, lastProducedAt untouched).
    const sulking: GameState = {
      ...assigned,
      pips: {
        "pip-1": {
          ...(assigned.pips["pip-1"] as PipState),
          activity: PipActivity.Sulking,
        },
      },
    };
    expect(processJobProduction(sulking, T0 + HOUR_MS)).toBe(sulking);

    // Same through the public reducer: hunger (−6/h from 2.9) pins to 0
    // inside the window, the pip sulks, and the 18 elapsed intervals
    // roll nothing — resources empty, "job" cursor never created, and
    // the abandoned entry is pruned after the (empty) production pass.
    const ticked = rootReducer(assigned, { type: "TICK", at: T0 + 3 * HOUR_MS });
    expect(ticked.pips["pip-1"]?.activity).toBe(PipActivity.Sulking);
    expect(ticked.resources).toEqual({});
    expect(ticked.inventory).toEqual({});
    expect(ticked.rngState[JOB_STREAM]).toBeUndefined();
    expect(ticked.jobs).toEqual({});
  });

  it("two working pips interleave chronologically on one stream", () => {
    const two = makeState({
      pips: { "pip-1": makePip("pip-1"), "pip-2": makePip("pip-2") },
    });
    let state = rootReducer(two, {
      type: "ASSIGN_JOB", pipId: "pip-1", stationPlacementId: "place-1", at: T0,
    });
    state = rootReducer(state, {
      type: "ASSIGN_JOB", pipId: "pip-2", stationPlacementId: "place-2",
      at: T0 + 5 * MINUTE_MS,
    });
    state = rootReducer(state, { type: "TICK", at: T0 + HOUR_MS });
    // pip-1 ticks at 10..60 (6), pip-2 at 15..55 (5) → 11 rolls total.
    expect(totalResources(state)).toBe(11);
    const ref = createRng(SEED).stream(JOB_STREAM);
    for (let i = 0; i < 11; i++) referenceRoll(() => ref.next());
    expect(state.rngState[JOB_STREAM]).toBe(ref.getState());
  });
});

describe("offline production (spec §4.5/§6.2: the 12h rate cap)", () => {
  const working = (): GameState =>
    rootReducer(makeState(), {
      type: "ASSIGN_JOB", pipId: "pip-1", stationPlacementId: "place-1", at: T0,
    });

  it("72h of absence yields EXACTLY one capped window of ticks", () => {
    const away = rootReducer(working(), {
      type: "CATCHUP", savedAt: T0, now: T0 + 72 * HOUR_MS,
    });
    expect(totalResources(away)).toBe(CAPPED_TICKS);
    // Needs froze at the cap too (rates are capped): a Curious pip's
    // hunger decays for exactly the capped window out of the 72h.
    expect(away.pips["pip-1"]?.needs.hunger).toBeCloseTo(
      100 + tuning.needDecayPerHour.hunger * CAP_HOURS,
      6,
    );
    // The pip is still working; the away summary carries the ticks.
    expect(away.pips["pip-1"]?.activity).toBe(PipActivity.AssignedJob);
    expect(
      away.lastCatchup?.events.filter((e) => e.kind === "custom" && e.tag === "jobTick"),
    ).toHaveLength(CAPPED_TICKS);
  });

  it("the frozen tail is never backfilled: production resumes from load time", () => {
    const now = T0 + 72 * HOUR_MS;
    const away = rootReducer(working(), { type: "CATCHUP", savedAt: T0, now });
    // lastProducedAt slid past the frozen stretch to land at `now`.
    expect(away.jobs["pip-1"]?.lastProducedAt).toBe(now);
    const soon = rootReducer(away, { type: "TICK", at: now + INTERVAL - 1 });
    expect(totalResources(soon)).toBe(CAPPED_TICKS); // nothing yet
    const next = rootReducer(soon, { type: "TICK", at: now + INTERVAL });
    expect(totalResources(next)).toBe(CAPPED_TICKS + 1); // one fresh interval
  });

  it("a short absence produces exactly elapsed/interval and matches the live path roll-for-roll", () => {
    const offline = rootReducer(working(), {
      type: "CATCHUP", savedAt: T0, now: T0 + HOUR_MS,
    });
    const live = rootReducer(working(), { type: "TICK", at: T0 + HOUR_MS });
    expect(totalResources(offline)).toBe(6);
    expect(offline.resources).toEqual(live.resources);
    expect(offline.inventory).toEqual(live.inventory);
    // Same timeline → same "job" cursor, whichever path processed it.
    expect(offline.rngState[JOB_STREAM]).toBe(live.rngState[JOB_STREAM]);
    expect(offline.jobs["pip-1"]?.lastProducedAt).toBe(T0 + HOUR_MS);
  });

  it("a pip that bottoms out mid-absence sulks at the boundary and stops producing", () => {
    // Seeded with 27 minutes' worth of Hunger (Curious's hunger
    // multiplier is ×1.0, so the base rate applies): it pins to 0 inside
    // the 20–30min segment, so the 30min boundary evaluation enters
    // Sulking BEFORE the 30min tick fires (§4.4/§4.5 rule 5). Only the
    // 10min and 20min ticks produce. Derived from tuning so a retune
    // moves the seed rather than breaking the claim.
    const startingHunger = -tuning.needDecayPerHour.hunger * (27 / 60);
    const fragile = makeState({
      pips: { "pip-1": makePip("pip-1", { needs: needs({ hunger: startingHunger }) }) },
    });
    const working = rootReducer(fragile, {
      type: "ASSIGN_JOB", pipId: "pip-1", stationPlacementId: "place-1", at: T0,
    });
    const away = rootReducer(working, {
      type: "CATCHUP", savedAt: T0, now: T0 + 3 * HOUR_MS,
    });
    expect(totalResources(away)).toBe(2);
    expect(away.pips["pip-1"]?.activity).toBe(PipActivity.Sulking);
    // The abandoned job is pruned — Sulking exits to Idle, never back
    // to the station (spec §4.4 "refuses expeditions/jobs").
    expect(away.jobs).toEqual({});
  });
});

describe("reload survival (derived from lastProducedAt — no timers)", () => {
  it("a job saved mid-interval resumes and produces at the exact derived moment", () => {
    const working = rootReducer(makeState(), {
      type: "ASSIGN_JOB", pipId: "pip-1", stationPlacementId: "place-1", at: T0,
    });
    // 25 minutes pass live: 2 ticks produce, 5 minutes of progress hang.
    const mid = rootReducer(working, { type: "TICK", at: T0 + 25 * MINUTE_MS });
    expect(totalResources(mid)).toBe(2);

    // Full §8 wire trip.
    const wire = JSON.parse(
      JSON.stringify(toSaveBlob(mid, T0 + 25 * MINUTE_MS)),
    ) as unknown;
    const loaded = migrate(wire);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const restored = rootReducer(loaded.save.state, {
      type: "LOAD_SAVE", state: loaded.save.state,
    });
    expect(restored.jobs["pip-1"]?.lastProducedAt).toBe(T0 + 20 * MINUTE_MS);
    expect(restored.pips["pip-1"]?.activity).toBe(PipActivity.AssignedJob);

    // The third tick lands at exactly lastProducedAt + interval — 5
    // minutes after the reload moment, not 10 (derived, not restarted).
    const early = rootReducer(restored, { type: "TICK", at: T0 + 29 * MINUTE_MS });
    expect(totalResources(early)).toBe(2);
    const due = rootReducer(early, { type: "TICK", at: T0 + 30 * MINUTE_MS });
    expect(totalResources(due)).toBe(3);
  });
});
