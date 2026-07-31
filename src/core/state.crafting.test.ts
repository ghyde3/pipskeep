/**
 * ROUND 2J — CRAFTING, reducer-level (docs/economy-bible.md §3): the
 * end-to-end path through `rootReducer`, with the REAL content registries
 * (`content/recipes.ts`, `content/jobs.ts`'s `"crafting"` entry, and the
 * Craft Table placeable) — `core/crafting/index.test.ts` covers the pure
 * engine against injected fixtures; this file is the "not just a pure
 * helper" half the round's own test plan asks for.
 */

import { describe, expect, it } from "vitest";
import { HOUR_MS, tuning as contentTuning } from "../content/tuning";
import { LifeStage, PipActivity } from "./pips/types";
import type { PipNeeds, PipState } from "./pips/types";
import { createNewGame, rootReducer } from "./state";
import type { GameState } from "./state";
import { fromSaveBlob, toSaveBlob } from "./save/serialize";

const T0 = 50_000_000;
const SEED = 42;

/** `state.crafts` is OPTIONAL on `GameState` (round 2J's own defensive-
 * default convention, see its doc comment) — this helper is the test
 * file's one place that defaults it, matching `core/state.ts`'s own
 * `craftsOf`. */
function craftAt(state: GameState, placementId: string) {
  return (state.crafts ?? {})[placementId];
}

/** `Readonly<Record<string, number>>` reads as `number | undefined` under
 * `noUncheckedIndexedAccess` — every other test file in this repo already
 * defaults with `?? 0` at the call site; this one-liner just names it. */
function num(value: number | undefined): number {
  return value ?? 0;
}

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
      personalityId,
      shiny: false,
    },
    personalityId,
    lifeStage: LifeStage.Adult,
    hatchedAt: T0,
    ageMs: 0,
    happinessIntegral: 0,
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

/** Keep level 6: every shipped recipe (Feastpot's tier 6 included) is
 * enqueue-legal, and PLACE_ITEM itself gates on nothing but bounds/cost
 * (spec §9 "content prerequisite" is a Build-sheet/UI concern, not core's
 * — confirmed by reading `core/keep`'s `placeItem`). */
function makeState(overrides: Partial<GameState> = {}): GameState {
  const pips = overrides.pips ?? { "pip-1": makePip("pip-1") };
  const rosterOrder = overrides.rosterOrder ?? Object.keys(pips);
  return {
    pips,
    rosterOrder,
    activePipId: rosterOrder[0] ?? "pip-1",
    inventory: { berry: 20, emberloaf: 4, glowcap: 4, tideroll: 2 },
    resources: { wood: 50, fiber: 50, shell: 20, driftwood: 20, lodestone: 20 },
    rngState: {},
    seed: SEED,
    keep: { level: 6, placements: {} },
    jobs: {},
    rosterUpgradePurchased: false,
    eggs: [],
    pendingReveals: [],
    nextPipNumber: Object.keys(pips).length + 1,
    nextEggNumber: 1,
    nextPlacementNumber: 1,
    cooldowns: {},
    lastLineIndex: {},
    createdAt: T0,
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
    keepXp: 0,
    lastLevelUp: null,
    crafts: {},
    lastCraftOutcome: null,
    visitors: {},
    attractionStock: {},
    attractionSchedule: {},
    ...overrides,
  };
}

/** Place a real Craft Table at (0, 0) and put `pipId` to work there,
 * through the actual PLACE_ITEM / ASSIGN_JOB reducer arms. */
function withStaffedCraftTable(state: GameState, pipId = "pip-1"): GameState {
  let next = rootReducer(state, { type: "PLACE_ITEM", itemId: "craft-table", x: 0, y: 0, at: T0 });
  expect(next.keep.placements["place-1"]?.itemId).toBe("craft-table");
  next = rootReducer(next, {
    type: "ASSIGN_JOB",
    pipId,
    stationPlacementId: "place-1",
    at: T0,
  });
  expect(next.jobs[pipId]?.jobId).toBe("crafting");
  return next;
}

const POULTICE_MS = 75 * 60_000;
const TOASTNUT_MS = 30 * 60_000;

describe("ENQUEUE_CRAFT / crafting through the REDUCER (docs/economy-bible.md §3)", () => {
  it("recipe execution end-to-end: enqueue spends inputs exactly once, TICK completes and grants the output", () => {
    const staffed = withStaffedCraftTable(makeState());
    const before = staffed.resources;

    const enqueued = rootReducer(staffed, {
      type: "ENQUEUE_CRAFT",
      stationPlacementId: "place-1",
      recipeId: "poultice",
      at: T0,
    });
    expect(enqueued.lastCraftOutcome).toMatchObject({ action: "enqueueCraft", ok: true, recipeId: "poultice" });
    // Fiber 6 / Lodestone 1 spent EXACTLY once.
    expect(num(enqueued.resources.fiber)).toBe(num(before.fiber) - 6);
    expect(num(enqueued.resources.lodestone)).toBe(num(before.lodestone) - 1);
    expect(craftAt(enqueued, "place-1")).toMatchObject({ recipeId: "poultice", startedAt: T0 });

    // Not yet due: TICK a moment early does nothing.
    const early = rootReducer(enqueued, { type: "TICK", at: T0 + POULTICE_MS - 1 });
    expect(num(early.inventory.poultice)).toBe(0);
    expect(craftAt(early, "place-1")).toBeDefined();

    // Due: TICK at the completion moment grants the Poultice and clears
    // the station, and the Keep/Pip both earn crafting XP.
    const done = rootReducer(early, { type: "TICK", at: T0 + POULTICE_MS });
    expect(done.inventory.poultice).toBe(1);
    expect(craftAt(done, "place-1")).toBeUndefined();
    expect(done.lastCraftCompletions).toHaveLength(1);
    expect(done.keepXp).toBeGreaterThan(enqueued.keepXp);
    expect((done.pips["pip-1"]?.pipXp ?? 0)).toBeGreaterThan(0);
    // The "first time this recipe is ever finished" bonus is idempotent.
    expect(done.counters["crafted.poultice"]).toBe(1);
  });

  it("inputs are consumed exactly once even when two different recipes are enqueued back to back", () => {
    const staffed = withStaffedCraftTable(makeState());
    const afterFirst = rootReducer(staffed, {
      type: "ENQUEUE_CRAFT",
      stationPlacementId: "place-1",
      recipeId: "lodestone-cairn",
      at: T0,
    });
    // The Cairn queues behind nothing (station was idle) — but a SECOND
    // request queues behind it, and its own cost is spent immediately.
    const afterSecond = rootReducer(afterFirst, {
      type: "ENQUEUE_CRAFT",
      stationPlacementId: "place-1",
      recipeId: "poultice",
      at: T0 + 1,
    });
    expect(craftAt(afterSecond, "place-1")?.queue).toEqual(["poultice"]);
    // Cairn: lodestone 4, shell 2. Poultice: fiber 6, lodestone 1. Neither
    // double-spent, both spent exactly once.
    expect(num(afterSecond.resources.lodestone)).toBe(num(staffed.resources.lodestone) - 5);
    expect(num(afterSecond.resources.shell)).toBe(num(staffed.resources.shell) - 2);
    expect(num(afterSecond.resources.fiber)).toBe(num(staffed.resources.fiber) - 6);

    // Re-dispatching the SAME enqueue action again spends a THIRD time
    // (it is a new request, not a replay) — proving there is no silent
    // double-charge hiding in a single dispatch, and no silent NO-charge
    // either.
    const afterThird = rootReducer(afterSecond, {
      type: "ENQUEUE_CRAFT",
      stationPlacementId: "place-1",
      recipeId: "lodestone-cairn",
      at: T0 + 2,
    });
    expect(craftAt(afterThird, "place-1")?.queue).toEqual(["poultice", "lodestone-cairn"]);
    expect(num(afterThird.resources.lodestone)).toBe(num(staffed.resources.lodestone) - 9);
  });

  it("cancel refunds correctly: the active order in full, promoting the next queued recipe with a fresh timer", () => {
    let state = withStaffedCraftTable(makeState());
    state = rootReducer(state, {
      type: "ENQUEUE_CRAFT",
      stationPlacementId: "place-1",
      recipeId: "poultice",
      at: T0,
    });
    state = rootReducer(state, {
      type: "ENQUEUE_CRAFT",
      stationPlacementId: "place-1",
      recipeId: "lodestone-cairn",
      at: T0,
    });
    const spentFiber = num(state.resources.fiber);
    const spentLodestone = num(state.resources.lodestone);

    const cancelled = rootReducer(state, {
      type: "CANCEL_CRAFT",
      stationPlacementId: "place-1",
      target: { kind: "active" },
      at: T0 + 5_000,
    });
    expect(cancelled.lastCraftOutcome).toMatchObject({ ok: true, recipeId: "poultice" });
    expect(num(cancelled.resources.fiber)).toBe(spentFiber + 6);
    expect(num(cancelled.resources.lodestone)).toBe(spentLodestone + 1);
    // The Cairn is now active, timer restarted at the cancel moment.
    expect(craftAt(cancelled, "place-1")).toMatchObject({
      recipeId: "lodestone-cairn",
      startedAt: T0 + 5_000,
      queue: [],
    });

    // Cancelling a QUEUED recipe refunds just that one.
    let requeued = rootReducer(cancelled, {
      type: "ENQUEUE_CRAFT",
      stationPlacementId: "place-1",
      recipeId: "poultice",
      at: T0 + 6_000,
    });
    const beforeQueueCancel = num(requeued.resources.fiber);
    requeued = rootReducer(requeued, {
      type: "CANCEL_CRAFT",
      stationPlacementId: "place-1",
      target: { kind: "queued", index: 0 },
      at: T0 + 7_000,
    });
    expect(num(requeued.resources.fiber)).toBe(beforeQueueCancel + 6); // the Poultice's fiber back
    expect(craftAt(requeued, "place-1")).toMatchObject({ recipeId: "lodestone-cairn", queue: [] });
  });

  it("REMOVE_ITEM refunds EVERYTHING queued at the station and drops it (bible §3.4)", () => {
    let state = withStaffedCraftTable(makeState());
    state = rootReducer(state, {
      type: "ENQUEUE_CRAFT",
      stationPlacementId: "place-1",
      recipeId: "poultice",
      at: T0,
    });
    state = rootReducer(state, {
      type: "ENQUEUE_CRAFT",
      stationPlacementId: "place-1",
      recipeId: "lodestone-cairn",
      at: T0,
    });
    const removed = rootReducer(state, { type: "REMOVE_ITEM", placementId: "place-1", at: T0 + 10 });
    expect(removed.keep.placements["place-1"]).toBeUndefined();
    expect(craftAt(removed, "place-1")).toBeUndefined();
    // Both the recipe refunds AND the Craft Table's own build cost (wood
    // 8 / fiber 6) come back — REMOVE_ITEM's existing "tuck away never
    // destroys value" rule, now extended to the recipe queue.
    expect(num(removed.resources.fiber)).toBe(num(state.resources.fiber) + 6 /* poultice */ + 6 /* table */);
    expect(num(removed.resources.wood)).toBe(num(state.resources.wood) + 8 /* table */);
    expect(num(removed.resources.lodestone)).toBe(
      num(state.resources.lodestone) + 1 /* poultice */ + 4 /* cairn */,
    );
    expect(num(removed.resources.shell)).toBe(num(state.resources.shell) + 2 /* cairn */);
    // The Pip is freed back to Idle (REMOVE_ITEM's existing job rule).
    expect(removed.pips["pip-1"]?.activity).toBe(PipActivity.Idle);
  });

  it("an unaffordable recipe refuses WARMLY: state unchanged, a typed shortfall the UI can name", () => {
    // Exactly enough to BUILD the Craft Table (wood 8 / fiber 6) and
    // nothing left over for the Poultice's own fiber 6 / lodestone 1.
    const staffed = withStaffedCraftTable(
      makeState({ resources: { wood: 8, fiber: 6, shell: 0, driftwood: 0, lodestone: 0 } }),
    );
    expect(num(staffed.resources.fiber)).toBe(0);
    const refused = rootReducer(staffed, {
      type: "ENQUEUE_CRAFT",
      stationPlacementId: "place-1",
      recipeId: "poultice",
      at: T0,
    });
    expect(refused.lastCraftOutcome).toMatchObject({
      ok: false,
      reason: "cannotAfford",
      missing: { fiber: 6, lodestone: 1 },
    });
    expect(refused.resources).toEqual(staffed.resources); // nothing spent
    expect(craftAt(refused, "place-1")).toBeUndefined();
  });

  it("a recipe below the Keep's tier refuses `locked`, warmly", () => {
    const staffed = withStaffedCraftTable(makeState({ keep: { level: 4, placements: {} } }));
    // Re-place at level 4 (Feastpot needs tier 6).
    const placed = rootReducer(staffed, { type: "PLACE_ITEM", itemId: "craft-table", x: 4, y: 0, at: T0 });
    const assigned = rootReducer(placed, {
      type: "ASSIGN_JOB",
      pipId: "pip-1",
      stationPlacementId: "place-2",
      at: T0,
    });
    const refused = rootReducer(assigned, {
      type: "ENQUEUE_CRAFT",
      stationPlacementId: "place-2",
      recipeId: "feastpot",
      at: T0,
    });
    expect(refused.lastCraftOutcome).toMatchObject({ ok: false, reason: "locked" });
  });

  it("a Pip occupied by crafting cannot also be sent on an expedition (or otherwise put to work)", () => {
    const staffed = withStaffedCraftTable(makeState());
    expect(staffed.pips["pip-1"]?.activity).toBe(PipActivity.AssignedJob);

    const attempted = rootReducer(staffed, {
      type: "ASSIGN_EXPEDITION",
      pipId: "pip-1",
      expeditionId: "meadow",
      at: T0,
    });
    expect(attempted.lastAssignOutcome?.ok).toBe(false);
    expect(attempted.pips["pip-1"]?.activity).toBe(PipActivity.AssignedJob); // still crafting
  });

  it("reload mid-craft preserves the remaining time to the millisecond", () => {
    const staffed = withStaffedCraftTable(makeState());
    const enqueued = rootReducer(staffed, {
      type: "ENQUEUE_CRAFT",
      stationPlacementId: "place-1",
      recipeId: "poultice",
      at: T0,
    });

    // "Reload" — a full JSON wire round-trip at an arbitrary later moment
    // (the save envelope's `savedAt` is independent of the craft's own
    // timestamps; `startedAt`/`effectiveMs` must survive byte-identical).
    const savedAt = T0 + 40 * 60_000;
    const wire = JSON.parse(JSON.stringify(toSaveBlob(enqueued, savedAt))) as unknown;
    const loaded = fromSaveBlob(wire);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(craftAt(loaded.save.state, "place-1")).toEqual(craftAt(enqueued, "place-1"));

    // Catch up from the save point to exactly the true completion moment
    // (T0 + POULTICE_MS) — computed from the ORIGINAL startedAt, not from
    // `savedAt`, so a reload cannot shorten OR lengthen the remaining time.
    const now = T0 + POULTICE_MS;
    const caughtUp = rootReducer(loaded.save.state, { type: "CATCHUP", savedAt, now });
    expect(caughtUp.inventory.poultice).toBe(1);
    expect(craftAt(caughtUp, "place-1")).toBeUndefined();

    // One tick EARLIER than true completion must NOT have finished yet —
    // proves the remaining time was preserved to the ms, not rounded.
    const justBefore = rootReducer(loaded.save.state, { type: "CATCHUP", savedAt, now: now - 1 });
    expect(num(justBefore.inventory.poultice)).toBe(0);
    expect(craftAt(justBefore, "place-1")).toBeDefined();
  });

  it("offline accrual respects the rate cap: a craft survives a long absence and completes EXACTLY once, never duplicated", () => {
    const staffed = withStaffedCraftTable(makeState());
    const enqueued = rootReducer(staffed, {
      type: "ENQUEUE_CRAFT",
      stationPlacementId: "place-1",
      recipeId: "poultice",
      at: T0,
    });

    // A 20-hour absence — longer than `offlineRateCapMs` (16h) — but the
    // recipe (75 min) completes comfortably inside the rated window, so
    // this proves completion survives past the cap boundary rather than
    // being silently lost (core/crafting/index.test.ts's injected-cap
    // tests are where the cap's own BITE is proven directly).
    expect(contentTuning.offlineRateCapMs).toBe(16 * HOUR_MS);
    const savedAt = T0;
    const now = T0 + 20 * HOUR_MS;
    const caughtUp = rootReducer(enqueued, { type: "CATCHUP", savedAt, now });
    expect(caughtUp.inventory.poultice).toBe(1);
    expect(craftAt(caughtUp, "place-1")).toBeUndefined();

    // The queue is now empty — a SECOND catch-up over the same kind of
    // long gap grants nothing further (idempotent; nothing to backfill).
    const again = rootReducer(caughtUp, {
      type: "CATCHUP",
      savedAt: now,
      now: now + 20 * HOUR_MS,
    });
    expect(again.inventory.poultice).toBe(1);
  });

  it("createNewGame ships crafts: {} — the field is real from the very first save", () => {
    const fresh = createNewGame(SEED, T0);
    expect(fresh.crafts).toEqual({});
    expect(fresh.lastCraftOutcome).toBeNull();
  });
});

/**
 * ⚠️ ROUND 2J FIX STAGE — MUTATION SURVIVORS, closed.
 *
 * Two mutations passed the whole suite before these existed:
 *
 * 1. Replacing `shiftCraftsPastFreeze(result.state.crafts, elapsedMs -
 *    ratedMs)` in the CATCHUP arm with a LOAD-TIME RESET (every surviving
 *    order's `startedAt` set to `action.now`) left 3260/3260 green. The
 *    existing "reload mid-craft preserves the remaining time" case only
 *    exercises orders that COMPLETE during the pass — at `T0 +
 *    POULTICE_MS - 1` it asserts the order is still `toBeDefined()` and
 *    never looks at its `startedAt`. Failure in play: enqueue a 75-minute
 *    Poultice, close the app 30 minutes in, reopen — the clock restarts
 *    and the player waits 105 minutes instead of 75, silently, on every
 *    single reload.
 *
 * 2. Deleting the `shiftCraftsPastFreeze` CALL SITE entirely — the
 *    rate-freeze slide that stops a long absence being backfilled in one
 *    burst — was invisible too: the helper is unit-tested directly in
 *    `core/crafting/index.test.ts` but was never exercised through the
 *    reducer.
 */
describe("a craft that SURVIVES a catch-up keeps its own clock", () => {
  it("an order that does not finish during the absence comes back with its ORIGINAL startedAt", () => {
    const staffed = withStaffedCraftTable(makeState());
    const enqueued = rootReducer(staffed, {
      type: "ENQUEUE_CRAFT",
      stationPlacementId: "place-1",
      recipeId: "poultice",
      at: T0,
    });
    expect(craftAt(enqueued, "place-1")?.startedAt).toBe(T0);

    // Away for 30 minutes of a 75-minute craft — it survives the pass.
    const savedAt = T0;
    const now = T0 + 30 * 60_000;
    const caughtUp = rootReducer(enqueued, { type: "CATCHUP", savedAt, now });
    const survivor = craftAt(caughtUp, "place-1");
    expect(survivor).toBeDefined();
    expect(num(caughtUp.inventory.poultice)).toBe(0);
    // THE ASSERTION THE MUTATION SURVIVED: the clock did not restart.
    expect(survivor?.startedAt).toBe(T0);
    expect(survivor?.effectiveMs).toBe(POULTICE_MS);
  });

  it("...and a TICK at the original completion moment finishes it — not 30 minutes later", () => {
    const staffed = withStaffedCraftTable(makeState());
    const enqueued = rootReducer(staffed, {
      type: "ENQUEUE_CRAFT",
      stationPlacementId: "place-1",
      recipeId: "poultice",
      at: T0,
    });
    const caughtUp = rootReducer(enqueued, {
      type: "CATCHUP",
      savedAt: T0,
      now: T0 + 30 * 60_000,
    });
    const ticked = rootReducer(caughtUp, { type: "TICK", at: T0 + POULTICE_MS });
    expect(ticked.inventory.poultice).toBe(1);
    expect(craftAt(ticked, "place-1")).toBeUndefined();
  });

  /**
   * THE RATE FREEZE, through the reducer. A craft enqueued and then left
   * for far longer than `offlineRateCapMs` must not have the frozen tail
   * counted against it: `shiftCraftsPastFreeze` slides the surviving
   * order's `startedAt` forward by exactly the capped portion, so the
   * first live TICK cannot backfill a week of crafting in one burst.
   */
  it("an order that survives a capped absence has its clock SLID past the frozen tail", () => {
    // The only way an order outlives the rated window is if crafting
    // stopped inside it (a Pip who sulked, retired, or — here — was taken
    // off the bench): the queue itself can never span the 16h cap, since
    // three of the longest recipe is 4.5h. `shiftCraftsPastFreeze` is what
    // stops the frozen tail being backfilled in one burst afterwards, and
    // its call site was invisible to the suite until this pinned it.
    const staffed = withStaffedCraftTable(makeState());
    const enqueued = rootReducer(staffed, {
      type: "ENQUEUE_CRAFT",
      stationPlacementId: "place-1",
      recipeId: "poultice",
      at: T0,
    });
    const idle = rootReducer(enqueued, { type: "UNASSIGN_JOB", pipId: "pip-1", at: T0 });
    expect(craftAt(idle, "place-1")?.startedAt).toBe(T0);

    const cappedMs = contentTuning.offlineRateCapMs;
    const elapsedMs = 40 * HOUR_MS;
    const caughtUp = rootReducer(idle, {
      type: "CATCHUP",
      savedAt: T0,
      now: T0 + elapsedMs,
    });
    // Nothing was made (nobody was working it) and the surviving order's
    // start moved forward by EXACTLY the rate-frozen portion.
    expect(num(caughtUp.inventory.poultice)).toBe(0);
    expect(craftAt(caughtUp, "place-1")?.startedAt).toBe(T0 + (elapsedMs - cappedMs));
  });

  it("the rate-frozen tail of a long absence is slid past, not banked", () => {
    const staffed = withStaffedCraftTable(makeState());
    // The Feastpot is the longest recipe in the book; queue three so the
    // station is still busy at the far end of a very long absence.
    let state = { ...staffed, keep: { ...staffed.keep, level: 12 } };
    state = {
      ...state,
      resources: { ...state.resources, lodestone: 99, fiber: 99, shell: 99, driftwood: 99 },
      inventory: { ...state.inventory, emberloaf: 99, glowcap: 99, tideroll: 99 },
    };
    for (let i = 0; i < 3; i += 1) {
      state = rootReducer(state, {
        type: "ENQUEUE_CRAFT",
        stationPlacementId: "place-1",
        recipeId: "feastpot",
        at: T0,
      });
    }
    const cappedMs = contentTuning.offlineRateCapMs;
    const elapsedMs = 3 * cappedMs;
    const caughtUp = rootReducer(state, {
      type: "CATCHUP",
      savedAt: T0,
      now: T0 + elapsedMs,
    });
    const survivor = craftAt(caughtUp, "place-1");
    // Three 90-minute crafts fit inside one 16h rated window, so all
    // three complete and the station is empty — the honest shape of the
    // cap being kind (bible §3.5: it cannot bite until the queue has been
    // empty for eleven hours).
    expect(survivor).toBeUndefined();
    expect(caughtUp.inventory.feastpot).toBe(3);
    // And nothing was double-counted by the frozen tail.
    expect(caughtUp.lastCraftCompletions).toHaveLength(3);
  });
});

/**
 * ⚠️ ROUND 2J FIX STAGE — THE NINTH DEAD FEATURE, closed at the reducer
 * boundary: `lastCraftCompletions` must actually reach the Doorstep's
 * data source. `CatchupSummary.produced` is a RESOURCE delta, so a
 * crafted Poultice (which lands in `inventory`) could never appear there —
 * which is exactly why a player who queued three, closed the app
 * overnight and returned was told nothing about them.
 */
describe("what the bench made while you were away is on the Doorstep's own summary", () => {
  it("CATCHUP stamps `crafted` onto lastCatchup, counted per recipe", () => {
    const staffed = withStaffedCraftTable(makeState());
    const enqueued = rootReducer(staffed, {
      type: "ENQUEUE_CRAFT",
      stationPlacementId: "place-1",
      recipeId: "poultice",
      at: T0,
    });
    const caughtUp = rootReducer(enqueued, {
      type: "CATCHUP",
      savedAt: T0,
      now: T0 + 4 * HOUR_MS,
    });
    expect(caughtUp.inventory.poultice).toBe(1);
    expect(caughtUp.lastCatchup?.crafted).toEqual({ poultice: 1 });
    // ...and it is NOT derivable from `produced`, which is resources only.
    expect(caughtUp.lastCatchup?.produced?.poultice).toBeUndefined();
  });

  it("an absence with no crafting leaves `crafted` empty rather than absent-and-ambiguous", () => {
    const state = makeState();
    const caughtUp = rootReducer(state, {
      type: "CATCHUP",
      savedAt: T0,
      now: T0 + 2 * HOUR_MS,
    });
    expect(caughtUp.lastCatchup?.crafted ?? {}).toEqual({});
  });
});
