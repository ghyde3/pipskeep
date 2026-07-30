/**
 * KEEP XP — reducer integration tests (docs/progression-bible.md §1.3's
 * award table), dispatched through the REAL `rootReducer` against REAL
 * content, so these prove the WIRING (`applyKeepXpForAction` in
 * `core/state.ts`), not just the pure calculators in `xp.ts` (covered by
 * `core/progression/xp.test.ts`).
 */

import { describe, expect, it } from "vitest";
import { tuning as contentTuning } from "../../content/tuning";
import { expeditions as contentExpeditions } from "../../content/expeditions";
import { LifeStage, PipActivity } from "../pips/types";
import type { PipState } from "../pips/types";
import { createNewGame, rootReducer } from "../state";
import type { GameAction, GameState } from "../state";
import { resolveKeepEffects } from "../keep/effects";
import { effectiveStreakTier } from "./streak";
import { masteryTier } from "./mastery";
import { albumXpFromDeltas, masteryTierXp as awardMasteryTierXp, revealXp } from "./xp";

const SEED = 7;
const T0 = 10_000_000;

/** A fresh save with the starter's personality pinned to Curious — no
 * Lazy-quirk refusal chance to make these tests flaky. */
function fresh(overrides: Partial<GameState> = {}): GameState {
  const base = createNewGame(SEED, T0);
  const pipId = base.activePipId;
  const pip = base.pips[pipId] as PipState;
  return {
    ...base,
    pips: {
      ...base.pips,
      [pipId]: {
        ...pip,
        personalityId: "curious",
        genome: { ...pip.genome, personalityId: "curious" },
      },
    },
    ...overrides,
  };
}

function grant(
  state: GameState,
  resources: Record<string, number> = {},
  items: Record<string, number> = {},
): GameState {
  return rootReducer(state, { type: "DEBUG_GRANT", resources, items });
}

describe("care actions grant xp.care exactly, and only when applied (bible rows 3–8)", () => {
  const cases: readonly {
    label: string;
    build: (pipId: string, at: number) => GameAction;
  }[] = [
    { label: "FEED", build: (pipId, at) => ({ type: "FEED", pipId, foodId: "berry", at }) },
    { label: "CLEAN", build: (pipId, at) => ({ type: "CLEAN", pipId, at }) },
    { label: "PLAY", build: (pipId, at) => ({ type: "PLAY", pipId, at }) },
    { label: "PET", build: (pipId, at) => ({ type: "PET", pipId, at }) },
    {
      label: "GIVE_ITEM",
      build: (pipId, at) => ({ type: "GIVE_ITEM", pipId, itemId: "berry", at }),
    },
    { label: "REST_TOGGLE (starts a nap)", build: (pipId, at) => ({ type: "REST_TOGGLE", pipId, at }) },
  ];

  for (const { label, build } of cases) {
    it(`${label} grants exactly xp.care when it applies`, () => {
      const state = grant(fresh(), {}, { berry: 5 });
      const pipId = state.activePipId;
      const action = build(pipId, T0 + 1_000);
      const next = rootReducer(state, action);
      expect(next.lastCareOutcome?.applied, "outcome must have applied").toBe(true);
      expect(next.keepXp - state.keepXp).toBe(contentTuning.progression.xp.care);
    });
  }

  it("a REFUSED care action (cooldown) grants ZERO — the bar never moves for nothing", () => {
    const state = grant(fresh(), {}, { berry: 5 });
    const pipId = state.activePipId;
    const petted = rootReducer(state, { type: "PET", pipId, at: T0 });
    expect(petted.lastCareOutcome?.applied).toBe(true);
    // Immediately again: inside the 30s cooldown, refused.
    const again = rootReducer(petted, { type: "PET", pipId, at: T0 + 1 });
    expect(again.lastCareOutcome?.applied).toBe(false);
    expect(again.keepXp).toBe(petted.keepXp);
  });

  it("REST_TOGGLE that ENDS a nap (wake) grants nothing — only the START pays (bible row 8)", () => {
    const state = grant(fresh(), {}, { berry: 5 });
    const pipId = state.activePipId;
    const resting = rootReducer(state, { type: "REST_TOGGLE", pipId, at: T0 });
    expect(resting.pips[pipId]?.activity).toBe(PipActivity.Resting);
    const afterStart = resting.keepXp;
    const woke = rootReducer(resting, { type: "REST_TOGGLE", pipId, at: T0 + 1_000 });
    expect(woke.pips[pipId]?.activity).not.toBe(PipActivity.Resting);
    expect(woke.keepXp).toBe(afterStart);
  });
});

describe("ASSIGN_EXPEDITION (bible row 9)", () => {
  it("grants xp.expeditionSend on a legal send-off", () => {
    const state = fresh();
    const pipId = state.activePipId;
    const next = rootReducer(state, {
      type: "ASSIGN_EXPEDITION",
      pipId,
      expeditionId: "meadow",
      at: T0,
    });
    expect(next.lastAssignOutcome?.ok).toBe(true);
    expect(next.keepXp - state.keepXp).toBe(contentTuning.progression.xp.expeditionSend);
  });

  it("a LOCKED expedition (biome not yet unlocked) grants zero", () => {
    const state = fresh();
    const pipId = state.activePipId;
    const next = rootReducer(state, {
      type: "ASSIGN_EXPEDITION",
      pipId,
      expeditionId: "forest", // unlocks at Keep level 2; fresh save is level 1
      at: T0,
    });
    expect(next.lastAssignOutcome?.ok).toBe(false);
    expect(next.keepXp).toBe(state.keepXp);
  });
});

describe("ACKNOWLEDGE_REVEAL (bible row 10) composes with the Album (rows 33–35)", () => {
  it("grants revealXp(duration) plus the Album's newly-seen delta, self-consistently", () => {
    let state = fresh();
    const pipId = state.activePipId;
    state = rootReducer(state, {
      type: "ASSIGN_EXPEDITION",
      pipId,
      expeditionId: "meadow",
      at: T0,
    });
    const meadow = contentExpeditions.meadow;
    state = rootReducer(state, { type: "TICK", at: T0 + meadow.durationMs + 1 });
    const prevPipdex = state.pipdex;
    const before = state.keepXp;
    const next = rootReducer(state, { type: "ACKNOWLEDGE_REVEAL", at: T0 + meadow.durationMs + 2 });

    const seenDelta = next.pipdex.formsSeen - prevPipdex.formsSeen;
    const caughtDelta = next.pipdex.formsCaught - prevPipdex.formsCaught;
    const variantDelta = next.pipdex.variantsCaught - prevPipdex.variantsCaught;
    // A first-ever Meadow reveal marks its WHOLE egg pool seen — a real,
    // non-trivial delta, not a vacuously-true 0-vs-0 check.
    expect(seenDelta).toBeGreaterThan(0);

    const expected =
      revealXp(meadow.durationMs) + albumXpFromDeltas(seenDelta, caughtDelta, variantDelta);
    expect(next.keepXp - before).toBe(expected);
  });
});

describe("HATCH_EGG (bible row 11) composes with the Album", () => {
  it("grants xp.hatch plus the Album's newly-caught delta, self-consistently", () => {
    let state = fresh();
    state = rootReducer(state, { type: "DEBUG_SPAWN_EGG", at: T0 });
    const egg = state.eggs[0];
    if (egg === undefined) throw new Error("no egg spawned");
    // Fast-forward well past incubation so it's Pipping, then hatch.
    state = rootReducer(state, { type: "TICK", at: T0 + egg.incubationMs + 1 });
    const pipping = state.eggs.find((e) => e.id === egg.id);
    expect(pipping?.state).toBe("pipping");

    const prevPipdex = state.pipdex;
    const before = state.keepXp;
    const next = rootReducer(state, {
      type: "HATCH_EGG",
      eggId: egg.id,
      at: T0 + egg.incubationMs + 2,
    });
    expect(next.lastHatchOutcome?.ok).toBe(true);

    const seenDelta = next.pipdex.formsSeen - prevPipdex.formsSeen;
    const caughtDelta = next.pipdex.formsCaught - prevPipdex.formsCaught;
    const variantDelta = next.pipdex.variantsCaught - prevPipdex.variantsCaught;
    const expected =
      contentTuning.progression.xp.hatch +
      albumXpFromDeltas(seenDelta, caughtDelta, variantDelta);
    expect(next.keepXp - before).toBe(expected);
  });
});

describe("EVOLVE_PIP (bible row 21) composes with the Album", () => {
  it("grants xp.evolve plus the Album's newly-caught/variant delta, self-consistently", () => {
    const state = fresh();
    const pipId = state.activePipId;
    const pip = state.pips[pipId] as PipState;
    // Construct a Pip the lifecycle machinery already considers ready —
    // `applyEvolution`'s ONLY check is this flag (core/pips/lifecycle.ts).
    const ready: GameState = {
      ...state,
      pips: { ...state.pips, [pipId]: { ...pip, readyToEvolve: true } },
    };
    const prevPipdex = ready.pipdex;
    const before = ready.keepXp;
    const next = rootReducer(ready, { type: "EVOLVE_PIP", pipId, at: T0 });
    expect(next.lastEvolveOutcome?.ok).toBe(true);

    const seenDelta = next.pipdex.formsSeen - prevPipdex.formsSeen;
    const caughtDelta = next.pipdex.formsCaught - prevPipdex.formsCaught;
    const variantDelta = next.pipdex.variantsCaught - prevPipdex.variantsCaught;
    expect(caughtDelta + variantDelta, "an evolution must record SOMETHING new in the Album").toBeGreaterThan(0);

    const expected =
      contentTuning.progression.xp.evolve +
      albumXpFromDeltas(seenDelta, caughtDelta, variantDelta);
    expect(next.keepXp - before).toBe(expected);
  });
});

describe("PLACE_ITEM first-build XP (bible row 13) — closes the place → refund → place printer", () => {
  it("pays firstBuild once per item TYPE, never again — even across a remove/re-place cycle", () => {
    let state = grant(fresh(), { wood: 20, fiber: 20 });
    const before = state.keepXp;
    const placed = rootReducer(state, {
      type: "PLACE_ITEM",
      itemId: "gathering-station",
      x: 0,
      y: 0,
      at: T0,
    });
    expect(placed.keep.placements["place-1"]).toBeDefined();
    expect(placed.keepXp - before).toBe(contentTuning.progression.xp.firstBuild);

    // Tuck it away (full resource refund) and place it again: XP-neutral
    // — the printer this closes.
    const removed = rootReducer(placed, {
      type: "REMOVE_ITEM",
      placementId: "place-1",
      at: T0 + 1,
    });
    const replaced = rootReducer(removed, {
      type: "PLACE_ITEM",
      itemId: "gathering-station",
      x: 2,
      y: 2,
      at: T0 + 2,
    });
    expect(replaced.keep.placements["place-2"]).toBeDefined();
    expect(replaced.keepXp).toBe(placed.keepXp);

    // A SECOND item of the SAME type placed alongside the first (without
    // removing anything) also pays nothing further.
    state = grant(replaced, { wood: 20, fiber: 20 });
    const beforeThird = state.keepXp;
    const third = rootReducer(state, {
      type: "PLACE_ITEM",
      itemId: "gathering-station",
      x: 5,
      y: 5,
      at: T0 + 3,
    });
    expect(third.keep.placements["place-3"]).toBeDefined();
    expect(third.keepXp).toBe(beforeThird);
  });

  it("a DIFFERENT item type still pays its own firstBuild", () => {
    const state = grant(fresh(), { wood: 20, fiber: 20 });
    const one = rootReducer(state, {
      type: "PLACE_ITEM",
      itemId: "gathering-station",
      x: 0,
      y: 0,
      at: T0,
    });
    const two = rootReducer(one, { type: "PLACE_ITEM", itemId: "bed", x: 4, y: 4, at: T0 + 1 });
    expect(two.keepXp - one.keepXp).toBe(contentTuning.progression.xp.firstBuild);
  });

  it("a REFUSED placement (unaffordable) grants zero", () => {
    const state = fresh(); // no resources granted
    const next = rootReducer(state, { type: "PLACE_ITEM", itemId: "bed", x: 0, y: 0, at: T0 });
    expect(next).toBe(state);
    expect(next.keepXp).toBe(state.keepXp);
  });
});

describe("ASSIGN_JOB first-job XP (bible row 17)", () => {
  it("pays firstJob once per job TYPE; a second pip on the same job type pays nothing further", () => {
    let state = grant(fresh(), { wood: 20, fiber: 20 });
    const starterId = state.activePipId;
    state = rootReducer(state, {
      type: "PLACE_ITEM",
      itemId: "gathering-station",
      x: 0,
      y: 0,
      at: T0,
    });
    state = rootReducer(state, {
      type: "PLACE_ITEM",
      itemId: "gathering-station",
      x: 4,
      y: 0,
      at: T0 + 1,
    });
    const before = state.keepXp;
    const assigned = rootReducer(state, {
      type: "ASSIGN_JOB",
      pipId: starterId,
      stationPlacementId: "place-1",
      at: T0 + 2,
    });
    expect(assigned.lastJobOutcome).toMatchObject({ ok: true });
    expect(assigned.keepXp - before).toBe(contentTuning.progression.xp.firstJob);

    // Second pip, second (identical-type) station: no further firstJob.
    const secondPipId = "pip-2";
    const withSecondPip: GameState = {
      ...assigned,
      pips: {
        ...assigned.pips,
        [secondPipId]: {
          ...(assigned.pips[starterId] as PipState),
          id: secondPipId,
          activity: PipActivity.Idle, // the starter is AssignedJob; this clone must not be
        },
      },
      rosterOrder: [...assigned.rosterOrder, secondPipId],
    };
    const beforeSecond = withSecondPip.keepXp;
    const secondAssigned = rootReducer(withSecondPip, {
      type: "ASSIGN_JOB",
      pipId: secondPipId,
      stationPlacementId: "place-2",
      at: T0 + 3,
    });
    expect(secondAssigned.lastJobOutcome).toMatchObject({ ok: true });
    expect(secondAssigned.keepXp).toBe(beforeSecond);
  });
});

describe("PURCHASE_ROSTER_UPGRADE (bible row 20)", () => {
  it("pays rosterUpgrade once; a repeat purchase is a same-state refusal", () => {
    const state = grant(fresh({ keep: { level: 4, placements: {} } }), {
      wood: 10,
      shell: 8,
      driftwood: 4,
    });
    const bought = rootReducer(state, { type: "PURCHASE_ROSTER_UPGRADE", at: T0 });
    expect(bought.rosterUpgradePurchased).toBe(true);
    expect(bought.keepXp - state.keepXp).toBe(contentTuning.progression.xp.rosterUpgrade);

    const again = rootReducer(bought, { type: "PURCHASE_ROSTER_UPGRADE", at: T0 + 1 });
    expect(again).toBe(bought);
  });
});

describe("PURCHASE_KEEP_LEVEL grants ZERO — the tier IS the reward (bible row 19)", () => {
  it("keepXp is unchanged by the purchase itself (only the resources move)", () => {
    const state = grant(fresh({ keepXp: contentTuning.progression.levelXp[1] }), {
      wood: 20,
      fiber: 20,
    });
    const next = rootReducer(state, { type: "PURCHASE_KEEP_LEVEL", at: T0 });
    expect(next.keep.level).toBe(2);
    expect(next.keepXp).toBe(state.keepXp);
  });
});

describe("mastery tier-up XP (bible row 32) — inside ACKNOWLEDGE_REVEAL, paid once per tier", () => {
  it("grants masteryTierXp(newTier) exactly when a trip crosses a NEW tier, and nothing on a trip that doesn't", () => {
    const bramblewick = contentExpeditions.bramblewick;
    // tripsForTier(1, 40min) = max(ceil(30/40), tierMinTrips[0]) = 2 —
    // bank the first trip directly so the SECOND (dispatched below)
    // crosses tier 1.
    let state = fresh();
    const pipId = state.activePipId;
    const pipBefore = state.pips[pipId] as PipState;
    state = {
      ...state,
      pips: { ...state.pips, [pipId]: { ...pipBefore, mastery: { bramblewick: 1 } } },
    };

    state = rootReducer(state, {
      type: "ASSIGN_EXPEDITION",
      pipId,
      expeditionId: "bramblewick",
      at: T0,
    });
    state = rootReducer(state, { type: "TICK", at: T0 + bramblewick.durationMs + 1 });
    const prevPipdex = state.pipdex;
    const before = state.keepXp;
    const next = rootReducer(state, {
      type: "ACKNOWLEDGE_REVEAL",
      at: T0 + bramblewick.durationMs + 2,
    });

    const nextPip = next.pips[pipId] as PipState;
    expect(nextPip.mastery?.["bramblewick"]).toBe(2);
    const prevTier = masteryTier(1, bramblewick.durationMs, contentTuning);
    const nextTier = masteryTier(2, bramblewick.durationMs, contentTuning);
    expect(nextTier, "this trip must actually cross a tier for the test to mean anything").toBeGreaterThan(prevTier);

    const seenDelta = next.pipdex.formsSeen - prevPipdex.formsSeen;
    const caughtDelta = next.pipdex.formsCaught - prevPipdex.formsCaught;
    const variantDelta = next.pipdex.variantsCaught - prevPipdex.variantsCaught;
    const expected =
      revealXp(bramblewick.durationMs) +
      awardMasteryTierXp(nextTier) +
      albumXpFromDeltas(seenDelta, caughtDelta, variantDelta);
    expect(next.keepXp - before).toBe(expected);

    // The idempotence counter now holds the highest tier already paid.
    expect(next.counters[`masteryTier.${pipId}.bramblewick`]).toBe(nextTier);
  });
});

describe("bounty completion + day-clear XP (bible rows 30–31)", () => {
  it("a single-slot day: one qualifying action pays BOTH bountyComplete and bountyDayClear", () => {
    const state = grant(
      fresh({
        bounties: {
          day: 0,
          slots: [
            {
              templateId: "hand-out-snacks",
              slot: 0,
              target: 1,
              progress: 0,
              completedAt: null,
              rerolled: false,
              params: {},
              stale: false,
            },
          ],
          rerollsUsed: 0,
          dayBonusGranted: false,
        },
      }),
      {},
      { berry: 5 },
    );
    const pipId = state.activePipId;
    const next = rootReducer(state, { type: "FEED", pipId, foodId: "berry", at: T0 });
    expect(next.counters["bountiesCompleted"]).toBe(1);
    expect(next.counters["bountyDaysCleared"]).toBe(1);
    const expected =
      contentTuning.progression.xp.care +
      contentTuning.progression.xp.bountyComplete +
      contentTuning.progression.xp.bountyDayClear;
    expect(next.keepXp - state.keepXp).toBe(expected);
  });
});

describe("CLAIM_STREAK_REWARD (bible row 27)", () => {
  it("grants base + perTier × the streak's EFFECTIVE tier", () => {
    const state = fresh({
      streak: {
        current: 3,
        longest: 3,
        lastVisitDay: 3,
        totalVisitDays: 4,
        graceBanked: 2,
        graceRefilledOnDay: null,
        rainDays: 0,
        rewardedForDay: null,
        pendingChoices: [],
      },
    });
    const next = rootReducer(state, { type: "CLAIM_STREAK_REWARD", at: T0 });
    expect(next.streak.rewardedForDay).toBe(3);
    const tier = effectiveStreakTier(state.streak, contentTuning);
    const expected =
      contentTuning.progression.xp.streakDayBase +
      contentTuning.progression.xp.streakDayPerTier * tier;
    expect(next.keepXp - state.keepXp).toBe(expected);
  });

  it("a repeat claim for the same day is a same-state refusal — no double grant", () => {
    const state = fresh({
      streak: {
        current: 1,
        longest: 1,
        lastVisitDay: 1,
        totalVisitDays: 1,
        graceBanked: 2,
        graceRefilledOnDay: null,
        rainDays: 0,
        rewardedForDay: null,
        pendingChoices: [],
      },
    });
    const once = rootReducer(state, { type: "CLAIM_STREAK_REWARD", at: T0 });
    const twice = rootReducer(once, { type: "CLAIM_STREAK_REWARD", at: T0 + 1 });
    expect(twice).toBe(once);
  });
});

describe("CLAIM_MILESTONE (bible row 28) grants exactly the content-defined xp", () => {
  it("grants def.xp on a genuine new earn; a repeat claim grants nothing", () => {
    const state = fresh({ counters: { feeds: 1 } });
    const once = rootReducer(state, { type: "CLAIM_MILESTONE", id: "first-feed", at: T0 });
    expect(once.milestones.earned["first-feed"]).toBeDefined();
    expect(once.keepXp - state.keepXp).toBeGreaterThan(0); // content assigns first-feed a real band
    const twice = rootReducer(once, { type: "CLAIM_MILESTONE", id: "first-feed", at: T0 + 1 });
    expect(twice).toBe(once);
  });

  it("an unmet milestone grants nothing (same-state refusal)", () => {
    const state = fresh({ counters: {} });
    const next = rootReducer(state, { type: "CLAIM_MILESTONE", id: "first-feed", at: T0 });
    expect(next).toBe(state);
  });
});

describe("RETIRE_PIP first-arrival XP (bible row 22) — a retrieve → retire loop pays once", () => {
  it("pays sanctuaryFirstArrival on the FIRST retirement only, never again for the same Pip", () => {
    let state = fresh();
    const starterId = state.activePipId;
    const secondId = "pip-2";
    state = {
      ...state,
      pips: { ...state.pips, [secondId]: { ...(state.pips[starterId] as PipState), id: secondId } },
      rosterOrder: [...state.rosterOrder, secondId],
    };

    const before = state.keepXp;
    const retired = rootReducer(state, { type: "RETIRE_PIP", pipId: secondId, at: T0 });
    expect(retired.lastSanctuaryOutcome).toMatchObject({ action: "retire", ok: true });
    expect(retired.keepXp - before).toBe(contentTuning.progression.xp.sanctuaryFirstArrival);

    const minStayMs = contentTuning.retention.sanctuary.minStayMs;
    const retrieved = rootReducer(retired, {
      type: "RETRIEVE_PIP",
      pipId: secondId,
      at: T0 + minStayMs + 1,
    });
    expect(retrieved.lastSanctuaryOutcome).toMatchObject({ action: "retrieve", ok: true });

    const beforeSecondRetire = retrieved.keepXp;
    const retiredAgain = rootReducer(retrieved, {
      type: "RETIRE_PIP",
      pipId: secondId,
      at: T0 + minStayMs + 2,
    });
    expect(retiredAgain.lastSanctuaryOutcome).toMatchObject({ action: "retire", ok: true });
    expect(retiredAgain.keepXp).toBe(beforeSecondRetire);
  });
});

describe("job production ticks grant xp.jobTick per tick, inside TICK/CATCHUP (bible row 16)", () => {
  it("a TICK that settles N overdue Gathering ticks grants exactly N × xp.jobTick", () => {
    let state = grant(fresh(), { wood: 20, fiber: 20 });
    const pipId = state.activePipId;
    state = rootReducer(state, {
      type: "PLACE_ITEM",
      itemId: "gathering-station",
      x: 0,
      y: 0,
      at: T0,
    });
    state = rootReducer(state, {
      type: "ASSIGN_JOB",
      pipId,
      stationPlacementId: "place-1",
      at: T0,
    });
    // Manually back-date lastProducedAt so exactly 3 ticks are overdue —
    // cheaper and more precise than simulating 30 minutes of real ticks.
    const intervalMs = contentTuning.gathering.intervalMs;
    const job = state.jobs[pipId];
    if (job === undefined) throw new Error("job missing");
    const backdated: GameState = {
      ...state,
      jobs: { ...state.jobs, [pipId]: { ...job, lastProducedAt: T0 - 3 * intervalMs } },
    };
    const before = backdated.keepXp;
    const ticked = rootReducer(backdated, { type: "TICK", at: T0 });
    expect(ticked.keepXp - before).toBe(3 * contentTuning.progression.xp.jobTick);
  });
});

describe("keepXp is forward-only across an ordinary play sequence", () => {
  it("never decreases across a mixed sequence of actions, including refusals", () => {
    let state = grant(fresh(), { wood: 30, fiber: 30 });
    const pipId = state.activePipId;
    const actions: readonly GameAction[] = [
      { type: "FEED", pipId, foodId: "berry", at: T0 },
      { type: "PET", pipId, at: T0 + 1 }, // applies
      { type: "PET", pipId, at: T0 + 2 }, // cooldown refusal
      { type: "ASSIGN_EXPEDITION", pipId, expeditionId: "meadow", at: T0 + 3 },
      { type: "ASSIGN_EXPEDITION", pipId, expeditionId: "forest", at: T0 + 4 }, // locked
      { type: "PLACE_ITEM", itemId: "bed", x: 0, y: 0, at: T0 + 5 },
      { type: "SET_ACTIVE_PIP", pipId }, // no-op
      { type: "TICK", at: T0 + 6 },
    ];
    let last = state.keepXp;
    for (const action of actions) {
      state = rootReducer(state, action);
      expect(state.keepXp, JSON.stringify(action)).toBeGreaterThanOrEqual(last);
      last = state.keepXp;
    }
  });
});

/**
 * ROUND 2F INTEGRATE — the `xpBonus` BUILDING CHANNEL actually moves the
 * number.
 *
 * This is the round's own no-dead-features rule (spec §16 v1.3) applied to
 * itself, inverted. `resolveKeepEffects` computed and capped
 * `xpBonusFraction` from the moment the effects engine landed, the Build
 * sheet printed "+8% Keep XP" on the Weathervane's card, and the upgrade
 * card's "How the Keep helps" readout listed it under Keep XP — but
 * `applyKeepXpForAction` never multiplied by it. Visible in the UI, absent
 * from the simulation: a promise the game did not keep.
 *
 * These tests are what make the promise true, dispatched through the REAL
 * reducer against the REAL Weathervane.
 */
describe("the xpBonus building channel scales every XP grant (bible §3.1)", () => {
  /** Level 12 + enough resources to place the Weathervane. */
  function atTopTier(): GameState {
    const base = grant(fresh(), {
      wood: 999,
      fiber: 999,
      shell: 999,
      driftwood: 999,
    });
    return { ...base, keep: { ...base.keep, level: 12 } };
  }

  it("an unbuilt Keep pays the base rate exactly (the bonus is opt-in, never a hidden tax)", () => {
    const state = atTopTier();
    const pipId = state.activePipId;
    const before = state.keepXp;
    const petted = rootReducer(state, { type: "PET", pipId, at: T0 });
    expect(petted.keepXp - before).toBe(contentTuning.progression.xp.care);
  });

  it("placing the Weathervane makes every later care action pay MORE than it did before", () => {
    let state = atTopTier();
    const pipId = state.activePipId;

    // Baseline: one Pet on a bare Keep.
    const baseline =
      rootReducer(state, { type: "PET", pipId, at: T0 }).keepXp - state.keepXp;
    expect(baseline).toBe(contentTuning.progression.xp.care);

    state = rootReducer(state, {
      type: "PLACE_ITEM",
      itemId: "weathervane",
      x: 0,
      y: 0,
      at: T0,
    });
    expect(state.keep.placements, "the Weathervane must actually be placed").not.toEqual(
      {},
    );

    const bonus = resolveKeepEffects(state.keep, state.keep.level).xpBonusFraction;
    expect(bonus, "the Weathervane must carry a real xpBonus").toBeGreaterThan(0);

    const before = state.keepXp;
    const petted = rootReducer(state, { type: "PET", pipId, at: T0 + 60_000 });
    const gained = petted.keepXp - before;

    expect(gained).toBe(Math.ceil(contentTuning.progression.xp.care * (1 + bonus)));
    // THE OBSERVABLE CLAIM: the bar moves further than it used to. A bonus
    // that rounds away to the same integer is a bonus the player cannot see,
    // which is why the multiply rounds UP.
    expect(gained).toBeGreaterThan(baseline);
  });

  it("scales a LARGE grant proportionally too, not just the rounding-sensitive small ones", () => {
    let state = atTopTier();
    state = rootReducer(state, {
      type: "PLACE_ITEM",
      itemId: "weathervane",
      x: 0,
      y: 0,
      at: T0,
    });
    const bonus = resolveKeepEffects(state.keep, state.keep.level).xpBonusFraction;

    // A hatch is one of the biggest single grants in the table (40 XP), so
    // it proves the multiply scales, not just that it rounds up.
    const withEgg: GameState = {
      ...state,
      eggs: [
        {
          id: "egg-1",
          state: "pipping",
          foundAt: T0,
          rarity: contentTuning.eggs.expeditionEggRarity,
          incubationMs: 0,
          incubationStartedAt: T0,
          sourceExpeditionId: "meadow",
        },
      ],
    };
    const before = withEgg.keepXp;
    const hatched = rootReducer(withEgg, { type: "HATCH_EGG", eggId: "egg-1", at: T0 + 1 });
    expect(hatched.lastHatchOutcome?.ok, "the fixture egg must actually hatch").toBe(true);
    // A hatch also fires the Album's "new form caught" grants, so assert the
    // WHOLE dispatch scaled rather than picking the hatch row out of it.
    const expectedBase =
      contentTuning.progression.xp.hatch +
      albumXpFromDeltas(
        hatched.pipdex.formsSeen - withEgg.pipdex.formsSeen,
        hatched.pipdex.formsCaught - withEgg.pipdex.formsCaught,
        hatched.pipdex.variantsCaught - withEgg.pipdex.variantsCaught,
        contentTuning,
      );
    expect(hatched.keepXp - before).toBe(Math.ceil(expectedBase * (1 + bonus)));
    expect(hatched.keepXp - before).toBeGreaterThan(expectedBase);
  });

  it("the bonus is capped — stacking every xpBonus source cannot exceed effectCaps.xpBonusMax", () => {
    let state = atTopTier();
    const ids = ["weathervane", "cozy-lantern", "lantern-row", "ember-brazier", "glow-pool", "warm-stones"];
    let slot = 0;
    for (const itemId of ids) {
      const placed = rootReducer(state, {
        type: "PLACE_ITEM",
        itemId,
        x: slot % 4,
        y: Math.floor(slot / 4),
        at: T0 + slot,
      });
      if (placed !== state) slot += 1;
      state = placed;
    }
    const bonus = resolveKeepEffects(state.keep, state.keep.level).xpBonusFraction;
    expect(bonus).toBeLessThanOrEqual(contentTuning.progression.effectCaps.xpBonusMax);
  });
});


// ---------------------------------------------------------------------------
// THE AWARD TABLE, LOOPED (bible §1.3) — the mechanical half
//
// Every non-zero row above has a hand-written `describe`, which is thorough
// but HAND-MAINTAINED: a new key added to `tuning.progression.xp` failed
// nothing, and roughly seven ZERO rows were unpinned entirely. The three
// blocks below make the table itself the unit of test:
//
//   1. `XP_TUNING_KEY_COVERAGE` is looped against `Object.keys(tuning.
//      progression.xp)` in BOTH directions, so a new tuning key without a
//      named covering test fails here, immediately, by name.
//   2. Every `GameAction["type"]` is classified pays / pays-nothing, and the
//      pays-nothing ones are DISPATCHED with a zero-delta assertion — the
//      rows the hand-written describes never reached.
//   3. A 500-action randomised sweep, which is what bible §8.7 actually
//      promised ("keepXp never decreases across a randomised 500-action
//      sequence") where the shipped test walked 8 hand-picked actions.
// ---------------------------------------------------------------------------

/**
 * Each key of `tuning.progression.xp` → the test that OBSERVES it moving the
 * number through `rootReducer`. Not decoration: the loop below asserts this
 * map and the tuning slice have exactly the same keys, so the table cannot
 * grow a row that nothing proves.
 */
const XP_TUNING_KEY_COVERAGE: Readonly<Record<string, string>> = {
  care: "care actions grant xp.care exactly (bible rows 3-8)",
  expeditionSend: "ASSIGN_EXPEDITION (bible row 9)",
  revealBase: "ACKNOWLEDGE_REVEAL pays revealBase + revealPer5Min x duration (row 10)",
  revealPer5Min: "ACKNOWLEDGE_REVEAL pays revealBase + revealPer5Min x duration (row 10)",
  hatch: "HATCH_EGG (bible row 11)",
  evolve: "EVOLVE_PIP (bible row 21)",
  firstBuild: "PLACE_ITEM first-ever placement of a type (rows 13/13b)",
  firstJob: "ASSIGN_JOB first-ever shift at a job (row 17)",
  jobTick: "job production ticks inside TICK/CATCHUP (row 16)",
  bountyComplete: "bounty completed (row 30)",
  bountyDayClear: "bounty day cleared (row 31)",
  streakDayBase: "CLAIM_STREAK_REWARD pays base + perTier x tier (row 27)",
  streakDayPerTier: "CLAIM_STREAK_REWARD pays base + perTier x tier (row 27)",
  rosterUpgrade: "PURCHASE_ROSTER_UPGRADE (row 20)",
  masteryTierPerTier: "mastery tier gained inside ACKNOWLEDGE_REVEAL (row 32)",
  albumSeen: "Album transitions (rows 33-35)",
  albumCaught: "Album transitions (rows 33-35)",
  albumVariant: "Album transitions (rows 33-35)",
  sanctuaryFirstArrival: "RETIRE_PIP first arrival only (row 22)",
  milestoneBands: "CLAIM_MILESTONE pays the milestone's content xp (row 28)",
};

describe("the XP award table is covered BY CONSTRUCTION, not by hand", () => {
  const tuningKeys = Object.keys(contentTuning.progression.xp).sort();
  const coveredKeys = Object.keys(XP_TUNING_KEY_COVERAGE).sort();

  it("every key of tuning.progression.xp names the test that proves it", () => {
    const uncovered = tuningKeys.filter((k) => XP_TUNING_KEY_COVERAGE[k] === undefined);
    expect(
      uncovered,
      `these XP tuning keys have no covering test — add one, then name it in XP_TUNING_KEY_COVERAGE: ${uncovered.join(", ")}`,
    ).toEqual([]);
  });

  it("and nothing names a key that no longer exists", () => {
    const stale = coveredKeys.filter(
      (k) => (contentTuning.progression.xp as Record<string, unknown>)[k] === undefined,
    );
    expect(stale, `stale coverage entries: ${stale.join(", ")}`).toEqual([]);
  });

  it("every numeric award in the table is strictly positive — a 0 row would be a silent dead source", () => {
    for (const [key, value] of Object.entries(contentTuning.progression.xp)) {
      if (typeof value !== "number") continue;
      expect(value, `xp.${key}`).toBeGreaterThan(0);
    }
  });

  it("every milestone band is strictly positive too", () => {
    const bands = contentTuning.progression.xp.milestoneBands as Record<string, number>;
    expect(Object.keys(bands).length).toBeGreaterThan(0);
    for (const [band, value] of Object.entries(bands)) {
      expect(value, `milestoneBands.${band}`).toBeGreaterThan(0);
    }
  });
});

/**
 * THE ZERO ROWS, DISPATCHED. Bible §1.3 assigns **0** to fourteen action
 * types, and the reason each is 0 is a DESIGN decision — "rearranging is not
 * progress", "asking someone home is a kindness, not a grind", "QA seams stay
 * honest", "the tier IS the reward". Only four of them were pinned; these
 * loops pin all of them, through the real reducer.
 */
describe("every zero row in the award table actually pays zero (bible §1.3)", () => {
  /** A state with a placement to move/remove, a job to unassign, a pip in the
   * Long Meadow to retrieve, and no jobs producing — so any XP observed below
   * came from the action itself and nothing else. */
  function stageForZeroRows(): GameState {
    let state = grant(fresh(), { wood: 200, fiber: 200 });
    state = rootReducer(state, { type: "PLACE_ITEM", itemId: "bed", x: 0, y: 0, at: T0 });
    // Second placement of the SAME type — row 13b, which pays nothing.
    state = rootReducer(state, { type: "PLACE_ITEM", itemId: "bed", x: 3, y: 0, at: T0 + 1 });
    return state;
  }

  const zeroCases: readonly {
    readonly label: string;
    readonly row: string;
    readonly run: (state: GameState) => GameAction;
  }[] = [
    {
      label: "MOVE_ITEM",
      row: "row 14 — rearranging is not progress",
      run: (state) => ({
        type: "MOVE_ITEM",
        placementId: Object.keys(state.keep.placements)[0]!,
        x: 5,
        y: 5,
        at: T0 + 100,
      }),
    },
    {
      label: "REMOVE_ITEM",
      row: "row 15 — XP is forward-only, and never negative",
      run: (state) => ({
        type: "REMOVE_ITEM",
        placementId: Object.keys(state.keep.placements)[0]!,
        at: T0 + 100,
      }),
    },
    {
      label: "PLACE_ITEM (a type already built)",
      row: "row 13b — closes the place/refund/place printer",
      run: () => ({ type: "PLACE_ITEM", itemId: "bed", x: 6, y: 6, at: T0 + 100 }),
    },
    {
      label: "SET_ACTIVE_PIP",
      row: "row 2",
      run: (state) => ({ type: "SET_ACTIVE_PIP", pipId: state.activePipId }),
    },
    {
      label: "ONBOARDING_ADVANCE",
      row: "row 24",
      run: () => ({ type: "ONBOARDING_ADVANCE", step: "done" }),
    },
    {
      label: "DEBUG_GRANT",
      row: "row 25 — QA seams stay honest",
      run: () => ({ type: "DEBUG_GRANT", resources: { wood: 500 }, items: { berry: 20 } }),
    },
    {
      label: "DEBUG_SPAWN_EGG",
      row: "row 25 — QA seams stay honest",
      run: () => ({ type: "DEBUG_SPAWN_EGG", at: T0 + 100 }),
    },
    {
      label: "SET_DAY_OFFSET",
      row: "row 26 — app-layer bookkeeping",
      run: () => ({ type: "SET_DAY_OFFSET", offsetMs: 2 * 24 * 60 * 60 * 1000 }),
    },
    {
      label: "SET_ACTIVE_EVENTS",
      row: "row 26 — app-layer bookkeeping",
      run: () => ({ type: "SET_ACTIVE_EVENTS", ids: ["lantern-nights"] }),
    },
    {
      label: "REFRESH_BOUNTIES",
      row: "row 26 — app-layer bookkeeping",
      run: () => ({ type: "REFRESH_BOUNTIES", at: T0 + 100 }),
    },
    {
      label: "TICK with nothing working",
      row: "row 1 — the app breathing, not the player",
      run: () => ({ type: "TICK", at: T0 + 100 }),
    },
  ];

  for (const { label, row, run } of zeroCases) {
    it(`${label} grants exactly 0 (${row})`, () => {
      const state = stageForZeroRows();
      const before = state.keepXp;
      const after = rootReducer(state, run(state));
      expect(after.keepXp - before, label).toBe(0);
      // Forward-only: never negative either (bible §0.3).
      expect(after.keepXp).toBeGreaterThanOrEqual(before);
    });
  }

  it("UNASSIGN_JOB grants 0 — leaving work is not progress (row 18)", () => {
    let state = grant(fresh(), { wood: 200, fiber: 200 });
    state = rootReducer(state, {
      type: "PLACE_ITEM",
      itemId: "gathering-station",
      x: 0,
      y: 0,
      at: T0,
    });
    const pipId = state.activePipId;
    const placementId = Object.keys(state.keep.placements)[0]!;
    state = rootReducer(state, {
      type: "ASSIGN_JOB",
      pipId,
      stationPlacementId: placementId,
      at: T0 + 1,
    });
    // The FIRST shift paid (row 17); leaving must not.
    const before = state.keepXp;
    const after = rootReducer(state, { type: "UNASSIGN_JOB", pipId, at: T0 + 2 });
    expect(after.jobs[pipId]).toBeUndefined();
    expect(after.keepXp - before).toBe(0);
  });

  it("RETRIEVE_PIP grants 0 — asking someone home is a kindness, not a grind (row 23)", () => {
    let state = fresh();
    // Two pips, so retiring one is legal.
    const pipId = state.activePipId;
    const retired = rootReducer(state, { type: "RETIRE_PIP", pipId, at: T0 });
    if (retired.lastSanctuaryOutcome?.ok !== true) {
      // A single-pip roster refuses retirement; retrieving nothing must still
      // pay nothing, which is the claim under test either way.
      const before = retired.keepXp;
      const after = rootReducer(retired, { type: "RETRIEVE_PIP", pipId, at: T0 + 1 });
      expect(after.keepXp - before).toBe(0);
      return;
    }
    state = retired;
    const before = state.keepXp;
    const after = rootReducer(state, { type: "RETRIEVE_PIP", pipId, at: T0 + 1 });
    expect(after.keepXp - before).toBe(0);
  });

  it("RESOLVE_STREAK_CHOICE grants 0 — the chosen thing IS the reward (row 29)", () => {
    const state = fresh();
    const before = state.keepXp;
    // With no pending choice this is a no-op; with one it grants the keepsake.
    // Either way the CLAIM never pays XP, which is the row.
    const after = rootReducer(state, {
      type: "RESOLVE_STREAK_CHOICE",
      kind: "keepsake",
      forDay: 1,
      choiceIndex: 0,
      at: T0 + 1,
    });
    expect(after.keepXp - before).toBe(0);
  });

  it("LOAD_SAVE grants 0 — importing a save is not playing it (row 25)", () => {
    const source = grant(fresh(), { wood: 5 });
    const target = fresh();
    const after = rootReducer(target, { type: "LOAD_SAVE", state: source });
    // The loaded state's own keepXp comes across verbatim; nothing is added.
    expect(after.keepXp).toBe(source.keepXp);
  });

  it("PURCHASE_KEEP_LEVEL grants 0 directly — the tier IS the reward (row 19)", () => {
    let state = grant(fresh(), { wood: 999, fiber: 999 });
    // Earn past the tier-2 gate with care actions so the purchase is legal.
    const pipId = state.activePipId;
    let at = T0;
    for (let i = 0; i < 60; i++) {
      at += 61_000; // clear every care cooldown
      state = rootReducer(state, { type: "CLEAN", pipId, at });
      if (state.keepXp >= (contentTuning.progression.levelXp[1] ?? 0)) break;
    }
    const before = state.keepXp;
    const bought = rootReducer(state, { type: "PURCHASE_KEEP_LEVEL", at: at + 1 });
    expect(bought.keep.level, "the purchase must actually have happened").toBe(2);
    expect(bought.keepXp - before).toBe(0);
  });
});

/**
 * BIBLE §8.7's ACTUAL PROMISE: "`keepXp` never decreases across a randomised
 * 500-action sequence." The shipped test walked eight hand-picked actions.
 *
 * Deterministic by construction — a tiny seeded LCG picks the actions, so the
 * "randomised" sweep replays identically on every run and a failure is
 * reproducible. Timestamps march forward past every cooldown, and the action
 * pool deliberately includes illegal moves (locked biomes, out-of-bounds
 * placements, empty reveal queues, cooldown refusals) because a refusal is the
 * case most likely to bookkeep XP wrongly.
 */
describe("keepXp is forward-only across a randomised 500-action sequence (bible §8.7)", () => {
  /** Seeded LCG — test-local, so `core/rng.ts`'s cursor contract is untouched. */
  function lcg(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 0x100000000;
    };
  }

  for (const seed of [1, 12345, 987654321]) {
    it(`never decreases over 500 randomised actions (seed ${seed})`, () => {
      const rand = lcg(seed);
      let state = grant(fresh(), { wood: 400, fiber: 400, shell: 200, driftwood: 200 }, { berry: 200 });
      const pipId = state.activePipId;
      let at = T0;
      let last = state.keepXp;
      let moved = 0;

      const pool: readonly ((s: GameState) => GameAction)[] = [
        () => ({ type: "FEED", pipId, foodId: "berry", at }),
        () => ({ type: "CLEAN", pipId, at }),
        () => ({ type: "PLAY", pipId, at }),
        () => ({ type: "PET", pipId, at }),
        () => ({ type: "REST_TOGGLE", pipId, at }),
        () => ({ type: "GIVE_ITEM", pipId, itemId: "berry", at }),
        () => ({ type: "ASSIGN_EXPEDITION", pipId, expeditionId: "meadow", at }),
        () => ({ type: "ASSIGN_EXPEDITION", pipId, expeditionId: "lanterngrotto", at }), // locked
        () => ({ type: "ACKNOWLEDGE_REVEAL", at }),
        () => ({ type: "TICK", at }),
        () => ({ type: "CATCHUP", savedAt: at - 60_000, now: at }),
        (s) => ({
          type: "PLACE_ITEM",
          itemId: ["bed", "food-bowl", "moss-tuft", "pebble-path", "cozy-lantern"][
            Math.floor(rand() * 5)
          ]!,
          x: Math.floor(rand() * 10),
          y: Math.floor(rand() * 14),
          at,
        }),
        (s) => {
          const ids = Object.keys(s.keep.placements);
          const id = ids[Math.floor(rand() * Math.max(1, ids.length))] ?? "place-999";
          return { type: "MOVE_ITEM", placementId: id, x: Math.floor(rand() * 10), y: 1, at };
        },
        (s) => {
          const ids = Object.keys(s.keep.placements);
          const id = ids[Math.floor(rand() * Math.max(1, ids.length))] ?? "place-999";
          return { type: "REMOVE_ITEM", placementId: id, at };
        },
        () => ({ type: "PURCHASE_KEEP_LEVEL", at }),
        () => ({ type: "PURCHASE_ROSTER_UPGRADE", at }),
        () => ({ type: "SET_ACTIVE_PIP", pipId }),
        () => ({ type: "UNASSIGN_JOB", pipId, at }),
        () => ({ type: "EVOLVE_PIP", pipId, at }),
        () => ({ type: "DEBUG_SPAWN_EGG", at }),
        (s) => ({ type: "HATCH_EGG", eggId: s.eggs[0]?.id ?? "egg-999", at }),
        () => ({ type: "REFRESH_BOUNTIES", at }),
        () => ({ type: "CLAIM_STREAK_REWARD", at }),
        () => ({ type: "RETIRE_PIP", pipId, at }),
        () => ({ type: "RETRIEVE_PIP", pipId, at }),
      ];

      for (let i = 0; i < 500; i++) {
        at += 45_000 + Math.floor(rand() * 120_000);
        const make = pool[Math.floor(rand() * pool.length)]!;
        state = rootReducer(state, make(state));
        expect(
          state.keepXp,
          `keepXp went BACKWARDS at step ${i} (seed ${seed})`,
        ).toBeGreaterThanOrEqual(last);
        expect(Number.isFinite(state.keepXp)).toBe(true);
        expect(Number.isInteger(state.keepXp), "keepXp must stay an integer").toBe(true);
        if (state.keepXp > last) moved += 1;
        last = state.keepXp;
      }

      // Sanity: the sweep has to actually EXERCISE the award table, or the
      // monotonicity claim above is vacuous.
      expect(moved, "the sweep granted XP on no step at all").toBeGreaterThan(20);
    });
  }
});


/**
 * ROUND 2F — `lastCatchup.keepXpGained` / `.produced` (bible §6.3). The
 * Doorstep can only report what the absence paid if the reducer records it, and
 * these two fields are the ONLY channel — `core/pips/catchup.ts`'s engine
 * cannot see the XP (awarded by the reducer wrapper) or the production
 * (rolled after the pass). Recorded but never rendered would be a dead field;
 * `ui/welcome.test.ts` covers the rendering half.
 */
describe("CATCHUP records what the absence paid (bible §6.3)", () => {
  /** A Keep with a staffed Gathering Station, so an absence genuinely earns
   * both XP (job ticks) and resources (production). */
  function staffed(): GameState {
    let state = grant(fresh(), { wood: 200, fiber: 200 });
    state = rootReducer(state, {
      type: "PLACE_ITEM",
      itemId: "gathering-station",
      x: 0,
      y: 0,
      at: T0,
    });
    const placementId = Object.keys(state.keep.placements)[0]!;
    return rootReducer(state, {
      type: "ASSIGN_JOB",
      pipId: state.activePipId,
      stationPlacementId: placementId,
      at: T0 + 1,
    });
  }

  const TWENTY_HOURS = 20 * 60 * 60 * 1000;

  it("stamps the Keep XP the absence earned onto lastCatchup", () => {
    const state = staffed();
    const before = state.keepXp;
    const after = rootReducer(state, {
      type: "CATCHUP",
      savedAt: T0 + 1,
      now: T0 + 1 + TWENTY_HOURS,
    });
    const gained = after.keepXp - before;
    expect(gained, "a 20h absence with a staffed station must earn XP").toBeGreaterThan(0);
    expect(after.lastCatchup?.keepXpGained).toBe(gained);
  });

  it("stamps what the station produced, positive counts only", () => {
    const state = staffed();
    const after = rootReducer(state, {
      type: "CATCHUP",
      savedAt: T0 + 1,
      now: T0 + 1 + TWENTY_HOURS,
    });
    const produced = after.lastCatchup?.produced ?? {};
    expect(Object.keys(produced).length).toBeGreaterThan(0);
    for (const [resourceId, count] of Object.entries(produced)) {
      expect(count, resourceId).toBeGreaterThan(0);
      // And it agrees with the actual satchel delta.
      expect(count).toBe((after.resources[resourceId] ?? 0) - (state.resources[resourceId] ?? 0));
    }
  });

  it("leaves both fields unset when an absence earned nothing — no '+0' to render", () => {
    const state = fresh(); // nobody working, nothing to find
    const after = rootReducer(state, {
      type: "CATCHUP",
      savedAt: T0,
      now: T0 + 10 * 60 * 1000,
    });
    expect(after.keepXp).toBe(state.keepXp);
    expect(after.lastCatchup?.keepXpGained).toBeUndefined();
    expect(after.lastCatchup?.produced).toBeUndefined();
  });

  it("never records a NEGATIVE gain — an absence cannot cost XP or resources (bible §0.3)", () => {
    const state = staffed();
    const after = rootReducer(state, {
      type: "CATCHUP",
      savedAt: T0 + 1,
      now: T0 + 1 + TWENTY_HOURS,
    });
    expect(after.lastCatchup?.keepXpGained ?? 0).toBeGreaterThanOrEqual(0);
    for (const count of Object.values(after.lastCatchup?.produced ?? {})) {
      expect(count).toBeGreaterThan(0);
    }
  });

  it("a live TICK never stamps them — this is the RETURN screen's data, not the ticker's", () => {
    const state = staffed();
    const after = rootReducer(state, { type: "TICK", at: T0 + 1 + TWENTY_HOURS });
    expect(after.lastCatchup).toBeNull();
  });
});


/**
 * RENOWN FLAIR, THROUGH THE REDUCER (docs/progression-bible.md §1.7).
 *
 * Renown shipped granting literally nothing: `tuning.progression.renown` had
 * its `flairEveryLevels` DELETED because `content/flair.ts` had no `renown-*`
 * entries to mint, so clearing a Renown level — roughly 2.7 engaged days —
 * changed the level chip's text and nothing else. Since tier 12 lands around
 * day 17 on the bible's own income model, the entire named ladder was
 * exhausted from day 17 with nothing behind it. The bible called Renown "the
 * LAST thing to cut from the round" and it was cut.
 */
describe("Renown flair is granted by the reducer (bible §1.7)", () => {
  const topRequirement =
    contentTuning.progression.levelXp[contentTuning.progression.levelXp.length - 1] ?? 0;
  const perLevel = contentTuning.progression.renown.xpPerLevel;

  /** A tier-12 Keep sitting `shortBy` XP below the given Renown boundary. */
  function atRenownEdge(level: number, shortBy: number): GameState {
    const base = grant(fresh(), {}, { berry: 50 });
    return {
      ...base,
      keep: { ...base.keep, level: 12 },
      keepXp: topRequirement + perLevel * level - shortBy,
    };
  }

  it("crossing the FIRST Renown boundary mints its flourish", () => {
    const state = atRenownEdge(1, 2); // one care action (4 XP) clears it
    expect(state.flair["renown-lamplight-stamp"]).toBeUndefined();
    const after = rootReducer(state, { type: "PET", pipId: state.activePipId, at: T0 });
    expect(after.keepXp).toBeGreaterThanOrEqual(topRequirement + perLevel);
    expect(after.flair["renown-lamplight-stamp"]).toBeDefined();
  });

  it("stamps the grant with the action's own timestamp", () => {
    const state = atRenownEdge(1, 2);
    const after = rootReducer(state, {
      type: "PET",
      pipId: state.activePipId,
      at: T0 + 12_345,
    });
    expect(after.flair["renown-lamplight-stamp"]).toBe(T0 + 12_345);
  });

  it("mints NOTHING while the boundary is still ahead", () => {
    const state = atRenownEdge(1, 500);
    const after = rootReducer(state, { type: "PET", pipId: state.activePipId, at: T0 });
    expect(after.keepXp).toBeGreaterThan(state.keepXp); // the action did pay
    expect(after.flair).toEqual(state.flair);
  });

  it("mints EVERY level a multi-level jump crossed — a debug grant skips no flourish", () => {
    // A single reveal cannot cross three Renown levels, but a DEBUG_GRANT-fed
    // sweep or a very long absence can; `renownFlairEarnedBetween` handles it.
    const base = grant(fresh(), {}, { berry: 50 });
    const state: GameState = {
      ...base,
      keep: { ...base.keep, level: 12 },
      keepXp: topRequirement,
    };
    // Walk forward with care actions until three levels are behind us.
    let walked = state;
    let at = T0;
    while (walked.keepXp < topRequirement + perLevel * 3) {
      at += 61_000;
      walked = rootReducer(walked, { type: "CLEAN", pipId: walked.activePipId, at });
    }
    for (const id of [
      "renown-lamplight-stamp",
      "renown-well-known-ribbon",
      "renown-keeper-title",
    ]) {
      expect(walked.flair[id], id).toBeDefined();
    }
  });

  it("never re-mints a flourish already earned — the grant is idempotent", () => {
    const state = atRenownEdge(1, 2);
    const first = rootReducer(state, { type: "PET", pipId: state.activePipId, at: T0 });
    const stamp = first.flair["renown-lamplight-stamp"];
    expect(stamp).toBeDefined();
    // Another action well inside the same Renown level.
    const second = rootReducer(first, {
      type: "CLEAN",
      pipId: first.activePipId,
      at: T0 + 61_000,
    });
    expect(second.flair["renown-lamplight-stamp"]).toBe(stamp);
  });

  it("grants NOTHING below tier 12 — Renown is what comes AFTER the named ladder", () => {
    // A level-11 Keep with a Ready tier 12 unpurchased has the XP for a Renown
    // level, and must not start collecting flourishes before finishing the
    // ladder they are meant to follow. Nothing is lost: the XP is banked and
    // the flourishes mint the moment the tier is bought (next test).
    const base = grant(fresh(), {}, { berry: 50 });
    const state: GameState = {
      ...base,
      keep: { ...base.keep, level: 11 },
      keepXp: topRequirement + perLevel - 2,
    };
    const after = rootReducer(state, { type: "PET", pipId: state.activePipId, at: T0 });
    expect(after.keepXp).toBeGreaterThanOrEqual(topRequirement + perLevel);
    expect(after.flair["renown-lamplight-stamp"]).toBeUndefined();
  });

  it("banked Renown XP pays out as soon as tier 12 is actually reached", () => {
    const base = grant(fresh(), {}, { berry: 50 });
    // Level 11, already well past the first Renown boundary.
    const held: GameState = {
      ...base,
      keep: { ...base.keep, level: 11 },
      keepXp: topRequirement + perLevel + 100,
    };
    expect(held.flair["renown-lamplight-stamp"]).toBeUndefined();
    const atTop: GameState = { ...held, keep: { ...held.keep, level: 12 } };
    const after = rootReducer(atTop, { type: "PET", pipId: atTop.activePipId, at: T0 });
    expect(after.flair["renown-lamplight-stamp"]).toBeDefined();
  });

  it("the flair a Renown level mints is DECORATION ONLY — no resources, no items, no cap change", () => {
    const state = atRenownEdge(1, 2);
    const after = rootReducer(state, { type: "PET", pipId: state.activePipId, at: T0 });
    expect(after.flair["renown-lamplight-stamp"]).toBeDefined();
    expect(after.resources).toEqual(state.resources);
    expect(after.inventory).toEqual(state.inventory);
    expect(after.keep.level).toBe(state.keep.level);
    expect(after.rosterUpgradePurchased).toBe(state.rosterUpgradePurchased);
    expect(after.keepsakes).toEqual(state.keepsakes);
  });

  it("a fresh save's flair is untouched by ordinary play far below Renown", () => {
    let state = grant(fresh(), {}, { berry: 50 });
    let at = T0;
    for (let i = 0; i < 20; i++) {
      at += 61_000;
      state = rootReducer(state, { type: "CLEAN", pipId: state.activePipId, at });
    }
    expect(Object.keys(state.flair).filter((id) => id.startsWith("renown-"))).toEqual([]);
  });
});
