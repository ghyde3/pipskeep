/**
 * Expedition tests (spec §6.1, Phase 4 gate):
 *
 * - THE GATE: send pip → advance duration → Returning → ACKNOWLEDGE →
 *   exact seeded loot, asserted item-by-item against a fixed seed (the
 *   expectation is pinned AND re-derived from first-principles stream
 *   arithmetic, independent of the loot-roll implementation).
 * - Reload mid-expedition preserves remaining time exactly to the ms
 *   (derived timers — full save/wire/migrate/load round trip).
 * - A need hitting 0 mid-expedition defers Sulking until the return
 *   lands; the loot is unaffected (spec §4.4 "never punish").
 * - Hardworking ×0.85 duration exact; Curious +10% loot as a
 *   deterministic per-base-roll bonus-roll chance.
 * - One pip per expedition; Piplings and Sulking pips refuse with
 *   dialogue; locked expeditions refuse structurally.
 * - Catch-up rolls loot for multiple returns in CHRONOLOGICAL order
 *   across pips — explicitly tested with two trips returning in the
 *   opposite order of their assignment.
 *
 * All time is explicit FakeClock-style timestamps — no ambient clocks.
 */

import { describe, expect, it } from "vitest";
import { HOUR_MS, MINUTE_MS, tuning } from "../../content/tuning";
import { expeditions as contentExpeditions } from "../../content/expeditions";
import { createRng, createRngFromState } from "../rng";
import type { RngStream } from "../rng";
import { LifeStage, PipActivity } from "../pips/types";
import type { PipNeeds, PipState } from "../pips/types";
import type { GameState } from "../state";
import { rootReducer } from "../state";
import { toSaveBlob } from "../save/serialize";
import { migrate } from "../save/migrate";
import { EggState } from "../eggs";
import {
  EXPEDITION_LOOT_STREAM,
  assignExpedition,
  effectiveExpeditionDurationMs,
  rollExpeditionLoot,
  settleExpeditionReturn,
} from "./index";
import type { ExpeditionView } from "./index";

const T0 = 10_000_000;
const SEED = 42;
const MEADOW_MS = tuning.expeditions.meadow.durationMs;

function needs(overrides: Partial<PipNeeds> = {}): PipNeeds {
  return { hunger: 80, cleanliness: 80, happiness: 80, energy: 80, ...overrides };
}

function makePip(id: string, overrides: Partial<PipState> = {}): PipState {
  const personalityId = overrides.personalityId ?? "lazy";
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
    happinessIntegral: 80 * T0,
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
    keep: { level: 3, placements: {} },
    jobs: {},
    rosterUpgradePurchased: false,
    eggs: [],
    pendingReveals: [],
    nextPipNumber: Object.keys(pips).length + 1,
    nextEggNumber: 1,
    nextPlacementNumber: 1,
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

/** A minimal scripted stream: `next()` replays the given values (chance
 * and weighted picks read through it). For semantics tests only. */
function scriptedStream(values: readonly number[]): RngStream {
  let i = 0;
  const next = (): number => {
    const v = values[i];
    i += 1;
    if (v === undefined) throw new Error(`script exhausted at roll ${i}`);
    return v;
  };
  return {
    next,
    int: (max) => Math.floor(next() * max),
    pick: <T,>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)] as T,
    chance: (p) => next() < p,
    getState: () => i,
  };
}

const MEADOW_VIEW: ExpeditionView = {
  id: "meadow",
  unlockKeepLevel: 1,
  durationMs: MEADOW_MS,
  lootTable: [
    { itemId: "berry", weight: 60 },
    { itemId: "fiber", weight: 40 },
  ],
  lootRolls: 2,
  eggChance: 0.08,
};

describe("the Phase 4 gate: send → advance → Returning → collect exact seeded loot", () => {
  it("walks the full loop with the exact rolls of seed 42, item by item", () => {
    const state = makeState();

    // 1) Send (spec §6.1): Idle → OnExpedition with a derived timer.
    const sent = rootReducer(state, {
      type: "ASSIGN_EXPEDITION",
      pipId: "pip-1",
      expeditionId: "meadow",
      at: T0,
    });
    expect(sent.lastAssignOutcome).toEqual({
      ok: true,
      pipId: "pip-1",
      expeditionId: "meadow",
      departedAt: T0,
      durationMs: MEADOW_MS,
      returnAt: T0 + MEADOW_MS,
    });
    expect(sent.pips["pip-1"]?.activity).toBe(PipActivity.OnExpedition);
    expect(sent.pips["pip-1"]?.expedition).toEqual({
      expeditionId: "meadow",
      departedAt: T0,
      durationMs: MEADOW_MS,
    });
    // Assignment rolls nothing — the loot stream is untouched until return.
    expect(sent.rngState[EXPEDITION_LOOT_STREAM]).toBeUndefined();

    // 2) Advance to one ms BEFORE the derived moment: still away.
    const early = rootReducer(sent, { type: "TICK", at: T0 + MEADOW_MS - 1 });
    expect(early.pips["pip-1"]?.activity).toBe(PipActivity.OnExpedition);
    expect(early.pendingReveals).toEqual([]);

    // 3) At exactly departedAt + durationMs: Returning, reveal queued.
    const returned = rootReducer(early, { type: "TICK", at: T0 + MEADOW_MS });
    expect(returned.pips["pip-1"]?.activity).toBe(PipActivity.Returning);
    expect(returned.pendingReveals).toHaveLength(1);
    const reveal = returned.pendingReveals[0];

    // Item-by-item against the fixed seed. Pinned literal first —
    // seed 42's fresh "expedition-loot" stream rolls the Meadow (Berry
    // 40 / Fiber 35 / Wood 25, 3 base rolls, lazy pip → no Curious
    // bonus) as: berry, berry, wood — and no egg.
    expect(reveal?.items).toEqual(["berry", "berry", "wood"]);
    expect(reveal?.egg).toBeNull();
    expect(reveal?.completedAt).toBe(T0 + MEADOW_MS);

    // Independent first-principles re-derivation of the same rolls
    // (raw stream arithmetic over the weighted table — no reuse of the
    // implementation under test). Table-driven so a content rebalance
    // moves both sides together instead of silently un-pinning one.
    const ref = createRng(SEED).stream(EXPEDITION_LOOT_STREAM);
    const meadowTable = contentExpeditions.meadow.lootTable;
    const meadowTotal = meadowTable.reduce((sum, e) => sum + e.weight, 0);
    const pickMeadow = (r: number): string => {
      let acc = r * meadowTotal;
      for (const entry of meadowTable) {
        acc -= entry.weight;
        if (acc < 0) return entry.itemId;
      }
      throw new Error("meadow reference roll fell through");
    };
    expect(reveal?.items).toEqual(
      Array.from({ length: contentExpeditions.meadow.lootRolls }, () =>
        pickMeadow(ref.next()),
      ),
    );
    // The egg roll, consumed after every base roll.
    expect(ref.next() < contentExpeditions.meadow.eggChance).toBe(false);

    // 4) Nothing entered the pantry yet — the reveal moment gates it.
    expect(returned.inventory).toEqual({});
    expect(returned.resources).toEqual({});

    // 5) ACKNOWLEDGE: loot lands, split by the food registry — Berries
    //    are food → inventory; Wood is a resource → resources (§6.3).
    const collected = rootReducer(returned, {
      type: "ACKNOWLEDGE_REVEAL",
      at: T0 + MEADOW_MS + 1_000,
    });
    expect(collected.inventory).toEqual({ berry: 2 });
    expect(collected.resources).toEqual({ wood: 1 });
    expect(collected.pendingReveals).toEqual([]);
    expect(collected.pips["pip-1"]?.activity).toBe(PipActivity.Idle);
    expect(collected.pips["pip-1"]?.expedition).toBeNull();
  });

  it("loot routing: non-food loot lands in resources (shore drops)", () => {
    // Roll shore with a scripted stream to force known items.
    const shore: ExpeditionView = {
      id: "shore",
      unlockKeepLevel: 3,
      durationMs: tuning.expeditions.shore.durationMs,
      lootTable: [
        { itemId: "shell", weight: 45 },
        { itemId: "driftwood", weight: 35 },
        { itemId: "stew", weight: 20 },
      ],
      lootRolls: 4,
      eggChance: 0.18,
    };
    // r*100: 10→shell, 50→driftwood, 90→stew, 20→shell; egg roll 0.99→no.
    const loot = rollExpeditionLoot(
      scriptedStream([0.1, 0.5, 0.9, 0.2, 0.99]),
      shore,
      "lazy",
    );
    expect(loot.items).toEqual(["shell", "driftwood", "stew", "shell"]);

    const state = makeState({
      pendingReveals: [
        {
          pipId: "pip-1",
          expeditionId: "shore",
          completedAt: T0,
          items: loot.items,
          egg: null,
        },
      ],
    });
    const collected = rootReducer(state, { type: "ACKNOWLEDGE_REVEAL", at: T0 });
    expect(collected.resources).toEqual({ shell: 2, driftwood: 1 });
    expect(collected.inventory).toEqual({ stew: 1 }); // stew is food
  });

  it("ACKNOWLEDGE on an empty queue is a no-op", () => {
    const state = makeState();
    expect(rootReducer(state, { type: "ACKNOWLEDGE_REVEAL", at: T0 })).toBe(state);
  });
});

describe("derived timers survive reload exactly (spec §6.1)", () => {
  it("save mid-expedition → wire → migrate → load → remaining time exact to the ms", () => {
    const sent = rootReducer(makeState(), {
      type: "ASSIGN_EXPEDITION",
      pipId: "pip-1",
      expeditionId: "meadow",
      at: T0,
    });
    // Two minutes into the five-minute trip, the tab dies mid-session.
    const savedAt = T0 + 2 * MINUTE_MS;
    const ticked = rootReducer(sent, { type: "TICK", at: savedAt });
    const wire: unknown = JSON.parse(JSON.stringify(toSaveBlob(ticked, savedAt)));

    const migrated = migrate(wire);
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;

    // Boot flow: LOAD_SAVE then CATCHUP over the (short) absence.
    let loaded = rootReducer(makeState(), {
      type: "LOAD_SAVE",
      state: migrated.save.state,
    });
    loaded = rootReducer(loaded, {
      type: "CATCHUP",
      savedAt: migrated.save.savedAt,
      now: savedAt + MINUTE_MS,
    });
    expect(loaded.pips["pip-1"]?.activity).toBe(PipActivity.OnExpedition);
    // The derived moment is untouched by the round trip…
    expect(loaded.pips["pip-1"]?.expedition).toEqual({
      expeditionId: "meadow",
      departedAt: T0,
      durationMs: MEADOW_MS,
    });
    // …so the return fires at EXACTLY the original ms, not a ms early.
    const early = rootReducer(loaded, { type: "TICK", at: T0 + MEADOW_MS - 1 });
    expect(early.pips["pip-1"]?.activity).toBe(PipActivity.OnExpedition);
    const due = rootReducer(early, { type: "TICK", at: T0 + MEADOW_MS });
    expect(due.pips["pip-1"]?.activity).toBe(PipActivity.Returning);
    expect(due.pendingReveals[0]?.completedAt).toBe(T0 + MEADOW_MS);
  });
});

describe("needs bottoming out mid-expedition (spec §4.4: never punish the trip)", () => {
  it("defers Sulking until the return lands; the loot is identical either way", () => {
    const fragile = makeState({
      pips: { "pip-1": makePip("pip-1", { needs: needs({ happiness: 0.001 }) }) },
    });
    const sturdy = makeState(); // happiness 80, same seed

    const run = (initial: GameState): GameState => {
      let s = rootReducer(initial, {
        type: "ASSIGN_EXPEDITION",
        pipId: "pip-1",
        expeditionId: "meadow",
        at: T0,
      });
      s = rootReducer(s, { type: "TICK", at: T0 + 4 * MINUTE_MS });
      return rootReducer(s, { type: "TICK", at: T0 + MEADOW_MS });
    };

    const bottomed = run(fragile);
    // Happiness hit 0 while away: entry deferred, trip untouched.
    const midPip = rootReducer(
      rootReducer(fragile, {
        type: "ASSIGN_EXPEDITION",
        pipId: "pip-1",
        expeditionId: "meadow",
        at: T0,
      }),
      { type: "TICK", at: T0 + 4 * MINUTE_MS },
    ).pips["pip-1"];
    expect(midPip?.needs.happiness).toBe(0);
    expect(midPip?.activity).toBe(PipActivity.OnExpedition);
    expect(midPip?.pendingSulk).toBe(true);

    expect(bottomed.pips["pip-1"]?.activity).toBe(PipActivity.Returning);
    expect(bottomed.pips["pip-1"]?.pendingSulk).toBe(true);

    // Full loot, identical to the run where nothing bottomed out.
    const happy = run(sturdy);
    expect(bottomed.pendingReveals[0]?.items).toEqual(
      happy.pendingReveals[0]?.items,
    );
    expect(bottomed.pendingReveals[0]?.items?.length).toBeGreaterThan(0);

    // Landing converts the deferred sulk — and the loot still arrives.
    const landed = rootReducer(bottomed, {
      type: "ACKNOWLEDGE_REVEAL",
      at: T0 + MEADOW_MS,
    });
    expect(landed.pips["pip-1"]?.activity).toBe(PipActivity.Sulking);
    expect(landed.pips["pip-1"]?.pendingSulk).toBe(false);
    const delivered =
      Object.values(landed.inventory).reduce((a, b) => a + b, 0) +
      Object.values(landed.resources).reduce((a, b) => a + b, 0);
    expect(delivered).toBe(bottomed.pendingReveals[0]?.items.length);
  });
});

describe("personality quirks (spec §4.2)", () => {
  it("Hardworking: duration is exactly content duration × 0.85", () => {
    expect(tuning.quirks.hardworkingExpeditionDurationMultiplier).toBe(0.85);
    const state = makeState({
      pips: { "pip-1": makePip("pip-1", { personalityId: "hardworking" }) },
    });
    const sent = rootReducer(state, {
      type: "ASSIGN_EXPEDITION",
      pipId: "pip-1",
      expeditionId: "meadow",
      at: T0,
    });
    const expected = MEADOW_MS * 0.85;
    expect(sent.pips["pip-1"]?.expedition?.durationMs).toBe(expected);
    expect(sent.lastAssignOutcome).toMatchObject({
      ok: true,
      durationMs: expected,
      returnAt: T0 + expected,
    });
    // And the unit itself, exact for every expedition:
    for (const def of Object.values(contentExpeditions)) {
      expect(effectiveExpeditionDurationMs(def, "hardworking")).toBe(
        def.durationMs * 0.85,
      );
      expect(effectiveExpeditionDurationMs(def, "lazy")).toBe(def.durationMs);
    }
  });

  it("Curious: each base roll carries a 10% bonus-roll chance (exact semantics)", () => {
    expect(tuning.quirks.curiousLootBonus).toBe(0.1);
    // Script: base1 0.5 → berry; bonus check 0.05 (< 0.1, fires);
    // bonus item 0.7 → fiber; base2 0.9 → fiber; bonus check 0.5 (no);
    // egg 0.99 (no). Bonus items append right after their base item.
    const curious = rollExpeditionLoot(
      scriptedStream([0.5, 0.05, 0.7, 0.9, 0.5, 0.99]),
      MEADOW_VIEW,
      "curious",
    );
    expect(curious.items).toEqual(["berry", "fiber", "fiber"]);
    expect(curious.eggFound).toBe(false);

    // A non-Curious pip on the SAME script consumes no bonus rolls:
    // 0.5 → berry, 0.05 → berry, then 0.7 is the egg roll (≥ 0.08 → no).
    const plain = rollExpeditionLoot(
      scriptedStream([0.5, 0.05, 0.7]),
      MEADOW_VIEW,
      "lazy",
    );
    expect(plain.items).toEqual(["berry", "berry"]);
    expect(plain.eggFound).toBe(false);
  });

  it("Curious loot is deterministic from the save's stream cursor", () => {
    const state = makeState({
      pips: { "pip-1": makePip("pip-1", { personalityId: "curious" }) },
    });
    const run = (): readonly string[] | undefined => {
      let s = rootReducer(state, {
        type: "ASSIGN_EXPEDITION",
        pipId: "pip-1",
        expeditionId: "meadow",
        at: T0,
      });
      s = rootReducer(s, { type: "TICK", at: T0 + MEADOW_MS });
      return s.pendingReveals[0]?.items;
    };
    const a = run();
    const b = run();
    expect(a).toBeDefined();
    expect(a).toEqual(b);
  });
});

describe("assignment legality (spec §6.1/§4.6/§4.7)", () => {
  it("enforces one pip per expedition (OnExpedition AND uncollected Returning block)", () => {
    const state = makeState({
      pips: {
        "pip-1": makePip("pip-1", {
          activity: PipActivity.OnExpedition,
          expedition: { expeditionId: "meadow", departedAt: T0, durationMs: MEADOW_MS },
        }),
        "pip-2": makePip("pip-2"),
      },
    });
    const refused = rootReducer(state, {
      type: "ASSIGN_EXPEDITION",
      pipId: "pip-2",
      expeditionId: "meadow",
      at: T0 + 1,
    });
    // `occupiedUntil` is the occupying Pip's derived return moment, so the
    // UI can tell the player exactly when to retry (spec: refusals carry
    // enough to write "why + when").
    expect(refused.lastAssignOutcome).toMatchObject({
      ok: false,
      reason: "occupied",
      occupiedUntil: T0 + MEADOW_MS,
    });
    expect(refused.pips["pip-2"]?.activity).toBe(PipActivity.Idle);

    // A Returning pip still holds its slot until the reveal is collected.
    const returningHolder = makeState({
      pips: {
        "pip-1": makePip("pip-1", {
          activity: PipActivity.Returning,
          expedition: { expeditionId: "meadow", departedAt: T0, durationMs: MEADOW_MS },
        }),
        "pip-2": makePip("pip-2"),
      },
    });
    const stillRefused = rootReducer(returningHolder, {
      type: "ASSIGN_EXPEDITION",
      pipId: "pip-2",
      expeditionId: "meadow",
      at: T0,
    });
    expect(stillRefused.lastAssignOutcome).toMatchObject({
      ok: false,
      reason: "occupied",
      occupiedUntil: T0 + MEADOW_MS,
    });

    // A DIFFERENT expedition is fine — multiple pips out simultaneously.
    const forestOk = rootReducer(state, {
      type: "ASSIGN_EXPEDITION",
      pipId: "pip-2",
      expeditionId: "forest",
      at: T0 + 1,
    });
    expect(forestOk.lastAssignOutcome).toMatchObject({ ok: true, expeditionId: "forest" });
    expect(forestOk.pips["pip-2"]?.activity).toBe(PipActivity.OnExpedition);
  });

  it("locked expeditions refuse until the Keep level unlocks them (spec §9)", () => {
    const level1 = makeState({ keep: { level: 1, placements: {} } });
    for (const locked of ["forest", "shore"] as const) {
      const refused = rootReducer(level1, {
        type: "ASSIGN_EXPEDITION",
        pipId: "pip-1",
        expeditionId: locked,
        at: T0,
      });
      expect(refused.lastAssignOutcome).toMatchObject({
        ok: false,
        reason: "locked",
        requiredKeepLevel: contentExpeditions[locked]?.unlockKeepLevel,
        currentKeepLevel: 1,
      });
      expect(refused.pips["pip-1"]?.activity).toBe(PipActivity.Idle);
    }
    // Meadow needs level 1; forest unlocks at 2, shore still locked.
    const meadowOk = rootReducer(level1, {
      type: "ASSIGN_EXPEDITION",
      pipId: "pip-1",
      expeditionId: "meadow",
      at: T0,
    });
    expect(meadowOk.lastAssignOutcome).toMatchObject({ ok: true });
    const level2 = makeState({ keep: { level: 2, placements: {} } });
    expect(
      rootReducer(level2, {
        type: "ASSIGN_EXPEDITION",
        pipId: "pip-1",
        expeditionId: "forest",
        at: T0,
      }).lastAssignOutcome,
    ).toMatchObject({ ok: true });
    expect(
      rootReducer(level2, {
        type: "ASSIGN_EXPEDITION",
        pipId: "pip-1",
        expeditionId: "shore",
        at: T0,
      }).lastAssignOutcome,
    ).toMatchObject({ ok: false, reason: "locked" });
  });

  it("Piplings refuse expeditions NOT on the supervised-trip allowlist — refused with a Refusal-context line AND growsUpAt (spec §4.6, round 2A)", () => {
    // Forest is level-2+ and NOT in tuning.pipling.allowedExpeditionIds
    // (only Meadow is, round 2A's "supervised short trip" amendment) —
    // still the age-gated case the spec originally described.
    const hatchedAt = T0 - 3 * HOUR_MS;
    const state = makeState({
      pips: {
        "pip-1": makePip("pip-1", { lifeStage: LifeStage.Pipling, hatchedAt }),
      },
    });
    const refused = rootReducer(state, {
      type: "ASSIGN_EXPEDITION",
      pipId: "pip-1",
      expeditionId: "forest",
      at: T0,
    });
    const outcome = refused.lastAssignOutcome;
    expect(outcome).toMatchObject({
      ok: false,
      reason: "pipling",
      growsUpAt: hatchedAt + tuning.pipling.durationMs,
    });
    if (outcome !== null && !outcome.ok) {
      expect(outcome.line).toBeTypeOf("string");
      expect(outcome.lineId).toMatch(/^lazy\/refusal\//);
    }
    expect(refused.pips["pip-1"]?.activity).toBe(PipActivity.Idle);
    // The dialogue draw advanced the dialogue cursor — and nothing else.
    expect(refused.rngState["dialogue"]).toBeTypeOf("number");
    expect(refused.rngState[EXPEDITION_LOOT_STREAM]).toBeUndefined();
  });

  it("Piplings CAN go on the Meadow — the round 2A supervised-trip amendment", () => {
    expect(tuning.pipling.allowedExpeditionIds).toEqual(["meadow"]);
    const state = makeState({
      pips: { "pip-1": makePip("pip-1", { lifeStage: LifeStage.Pipling }) },
    });
    const sent = rootReducer(state, {
      type: "ASSIGN_EXPEDITION",
      pipId: "pip-1",
      expeditionId: "meadow",
      at: T0,
    });
    expect(sent.lastAssignOutcome).toMatchObject({ ok: true, expeditionId: "meadow" });
    expect(sent.pips["pip-1"]?.activity).toBe(PipActivity.OnExpedition);
  });

  it("Sulking pips refuse with dialogue (spec §4.7), and stay Sulking", () => {
    const state = makeState({
      pips: {
        "pip-1": makePip("pip-1", {
          activity: PipActivity.Sulking,
          needs: needs({ happiness: 0 }),
        }),
      },
    });
    const refused = rootReducer(state, {
      type: "ASSIGN_EXPEDITION",
      pipId: "pip-1",
      expeditionId: "meadow",
      at: T0,
    });
    const outcome = refused.lastAssignOutcome;
    expect(outcome).toMatchObject({ ok: false, reason: "sulking" });
    if (outcome !== null && !outcome.ok) {
      expect(outcome.line).toBeTypeOf("string");
    }
    expect(refused.pips["pip-1"]?.activity).toBe(PipActivity.Sulking);
  });

  it("structural blocks (busy / unknown pip / unknown expedition) draw no line and roll nothing", () => {
    const resting = makeState({
      pips: { "pip-1": makePip("pip-1", { activity: PipActivity.Resting }) },
    });
    const busy = assignExpedition(resting, "pip-1", "meadow", T0);
    expect(busy.outcome).toMatchObject({ ok: false, reason: "busy" });
    expect(busy.outcome.ok === false && busy.outcome.lineId).toBeUndefined();
    expect(busy.state).toBe(resting); // untouched by reference

    const state = makeState();
    expect(assignExpedition(state, "pip-9", "meadow", T0).outcome).toMatchObject({
      ok: false,
      reason: "unknownPip",
    });
    expect(assignExpedition(state, "pip-1", "volcano", T0).outcome).toMatchObject({
      ok: false,
      reason: "unknownExpedition",
    });
  });

  it("after ACKNOWLEDGE the expedition slot frees up again", () => {
    let s = rootReducer(makeState(), {
      type: "ASSIGN_EXPEDITION",
      pipId: "pip-1",
      expeditionId: "meadow",
      at: T0,
    });
    s = rootReducer(s, { type: "TICK", at: T0 + MEADOW_MS });
    s = rootReducer(s, { type: "ACKNOWLEDGE_REVEAL", at: T0 + MEADOW_MS });
    const again = rootReducer(s, {
      type: "ASSIGN_EXPEDITION",
      pipId: "pip-1",
      expeditionId: "meadow",
      at: T0 + MEADOW_MS + 1,
    });
    expect(again.lastAssignOutcome).toMatchObject({ ok: true });
  });
});

describe("catch-up returns roll loot in chronological order (spec §2 rule 3 / §4.5)", () => {
  it("two trips returning in the OPPOSITE order of assignment: rolls follow return order", () => {
    // Assign pip-1 FIRST to the long trip (shore, 30m), pip-2 SECOND to
    // the short one (meadow, 5m → returns first). If loot order followed
    // assignment (or roster) order, the stream would be consumed
    // shore-first; chronological means meadow-first.
    const base = makeState({
      pips: { "pip-1": makePip("pip-1"), "pip-2": makePip("pip-2") },
    });
    let s = rootReducer(base, {
      type: "ASSIGN_EXPEDITION",
      pipId: "pip-1",
      expeditionId: "shore",
      at: T0,
    });
    s = rootReducer(s, {
      type: "ASSIGN_EXPEDITION",
      pipId: "pip-2",
      expeditionId: "meadow",
      at: T0 + MINUTE_MS,
    });
    const meadowReturnAt = T0 + MINUTE_MS + MEADOW_MS; // T0 + 6m
    const shoreReturnAt = T0 + tuning.expeditions.shore.durationMs; // T0 + 30m
    expect(meadowReturnAt).toBeLessThan(shoreReturnAt);

    // Player leaves at T0+2m; both trips complete during the absence.
    const savedAt = T0 + 2 * MINUTE_MS;
    const preCatchup = rootReducer(s, { type: "TICK", at: savedAt });
    const caught = rootReducer(preCatchup, {
      type: "CATCHUP",
      savedAt,
      now: T0 + 40 * MINUTE_MS,
    });

    // Reveal queue is chronological: meadow (pip-2) first.
    expect(caught.pendingReveals.map((r) => [r.expeditionId, r.pipId, r.completedAt]))
      .toEqual([
        ["meadow", "pip-2", meadowReturnAt],
        ["shore", "pip-1", shoreReturnAt],
      ]);
    // The away sheet fired the returns in the same order.
    const returnEvents = (caught.lastCatchup?.events ?? []).filter(
      (e) => e.kind === "expeditionReturn",
    );
    expect(returnEvents.map((e) => e.at)).toEqual([meadowReturnAt, shoreReturnAt]);

    // RNG determinism: the stream must have been consumed meadow-first.
    // Reference: continue from the pre-catch-up cursors and roll meadow
    // then shore — exactly what chronological order demands.
    const ref = createRngFromState(preCatchup.seed, preCatchup.rngState);
    const stream = ref.stream(EXPEDITION_LOOT_STREAM);
    const meadowRef = rollExpeditionLoot(stream, contentExpeditions.meadow, "lazy");
    const shoreRef = rollExpeditionLoot(stream, contentExpeditions.shore, "lazy");
    expect(caught.pendingReveals[0]?.items).toEqual(meadowRef.items);
    expect(caught.pendingReveals[1]?.items).toEqual(shoreRef.items);

    // Both pips already landed (offline returns auto-arrive) — Idle.
    expect(caught.pips["pip-1"]?.activity).toBe(PipActivity.Idle);
    expect(caught.pips["pip-2"]?.activity).toBe(PipActivity.Idle);
  });

  it("a long live tick settles multiple due returns in the same chronological order", () => {
    const base = makeState({
      pips: { "pip-1": makePip("pip-1"), "pip-2": makePip("pip-2") },
    });
    let s = rootReducer(base, {
      type: "ASSIGN_EXPEDITION",
      pipId: "pip-1",
      expeditionId: "shore",
      at: T0,
    });
    s = rootReducer(s, {
      type: "ASSIGN_EXPEDITION",
      pipId: "pip-2",
      expeditionId: "meadow",
      at: T0 + MINUTE_MS,
    });
    const rngBefore = s.rngState;
    const ticked = rootReducer(s, { type: "TICK", at: T0 + HOUR_MS });
    expect(ticked.pendingReveals.map((r) => r.expeditionId)).toEqual([
      "meadow",
      "shore",
    ]);
    const ref = createRngFromState(s.seed, rngBefore);
    const stream = ref.stream(EXPEDITION_LOOT_STREAM);
    expect(ticked.pendingReveals[0]?.items).toEqual(
      rollExpeditionLoot(stream, contentExpeditions.meadow, "lazy").items,
    );
    expect(ticked.pendingReveals[1]?.items).toEqual(
      rollExpeditionLoot(stream, contentExpeditions.shore, "lazy").items,
    );
  });
});

describe("expedition eggs land in the reveal, then incubate on acknowledge (spec §7.1/§7.2)", () => {
  it("settles an egg-bearing return: Found in the reveal, Incubating after ACKNOWLEDGE", () => {
    // Force the egg with a certain-egg registry view (chance 1).
    const state = makeState({
      pips: {
        "pip-1": makePip("pip-1", {
          activity: PipActivity.Returning,
          expedition: { expeditionId: "meadow", departedAt: T0, durationMs: MEADOW_MS },
        }),
      },
    });
    const settled = settleExpeditionReturn(
      state,
      "pip-1",
      { expeditionId: "meadow", departedAt: T0, durationMs: MEADOW_MS },
      T0 + MEADOW_MS,
      { registry: { meadow: { ...MEADOW_VIEW, eggChance: 1 } } },
    );
    const egg = settled.pendingReveals[0]?.egg;
    expect(egg).toMatchObject({
      id: "egg-1",
      state: EggState.Found,
      foundAt: T0 + MEADOW_MS,
      rarity: tuning.eggs.expeditionEggRarity,
      incubationMs: tuning.eggs.incubationMsDefault,
      incubationStartedAt: null,
      sourceExpeditionId: "meadow",
    });
    expect(settled.nextEggNumber).toBe(2);
    expect(settled.eggs).toEqual([]); // not in the Keep until acknowledged

    const ackAt = T0 + MEADOW_MS + 30_000;
    const collected = rootReducer(settled, { type: "ACKNOWLEDGE_REVEAL", at: ackAt });
    expect(collected.eggs).toHaveLength(1);
    expect(collected.eggs[0]).toMatchObject({
      id: "egg-1",
      state: EggState.Incubating,
      incubationStartedAt: ackAt, // the timer runs from the reveal tap
    });
    expect(collected.pips["pip-1"]?.activity).toBe(PipActivity.Idle);
  });
});
