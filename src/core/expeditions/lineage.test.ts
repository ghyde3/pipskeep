/**
 * LINEAGE EGG FINDS — the settle-point wiring (spec §12 unfenced, spec
 * §16 v1.5, docs/lifecycle-bible.md §5.2), on top of
 * `core/pips/breeding.test.ts`'s pure unit tests of `attemptLineageFind`
 * itself. This file proves `settleExpeditionReturn` actually calls it at
 * the right moment, with the right cursor isolation from the loot/egg and
 * ailment rolls, and that a find correctly overrides a same-trip loot-egg
 * roll in the pending reveal.
 */

import { describe, expect, it } from "vitest";
import { createRng } from "../rng";
import { HOUR_MS } from "../../content/tuning";
import { LifeStage, PipActivity } from "../pips/types";
import type { PipNeeds, PipState } from "../pips/types";
import type { GameState } from "../state";
import { EXPEDITION_LOOT_STREAM, settleExpeditionReturn } from "./index";
import type { ExpeditionView } from "./index";
import { LINEAGE_STREAM } from "../pips/breeding";
import type { LineageEggSeed } from "../pips/ailment";

const T0 = 10_000_000;
const SEED = 42;

const BRAMBLEWICK: ExpeditionView = {
  id: "bramblewick",
  unlockKeepLevel: 1,
  durationMs: 40 * 60_000,
  lootTable: [{ itemId: "fiber", weight: 1 }],
  lootRolls: 1,
  eggChance: 0,
};

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
      personalityId,
      shiny: false,
    },
    personalityId,
    lifeStage: LifeStage.Adult,
    hatchedAt: 0,
    ageMs: T0,
    happinessIntegral: 80 * T0,
    needs: needs(),
    activity: PipActivity.OnExpedition,
    pendingSulk: false,
    readyToEvolve: false,
    evolved: null,
    lastGiftItemId: null,
    expedition: { expeditionId: "bramblewick", departedAt: T0, durationMs: 40 * 60_000 },
    needsUpdatedAt: T0,
    ...overrides,
  };
}

function makeSeed(overrides: Partial<LineageEggSeed> = {}): LineageEggSeed {
  return {
    pipId: "pip-lost",
    name: "Mossy",
    genome: {
      speciesId: "mosspip",
      palette: "fern",
      pattern: "plain",
      personalityId: "curious",
      shiny: false,
    },
    expeditionId: "bramblewick",
    level: 9,
    scars: [],
    generation: 1,
    seededAt: 0,
    misses: 0,
    ...overrides,
  };
}

/** A minimal ExpeditionStateSlice-satisfying fixture (GameState's own
 * shape is a superset, so this is deliberately trimmed to what
 * `settleExpeditionReturn` actually reads). */
function makeState(
  overrides: Partial<GameState> & { lineageEggs?: readonly LineageEggSeed[] } = {},
): GameState {
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
    keep: { level: 4, placements: {} },
    jobs: {},
    rosterUpgradePurchased: false,
    eggs: [],
    pendingReveals: [],
    nextPipNumber: 2,
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
    lineageEggs: [],
    lastLossOutcome: null,
    lastBreedOutcome: null,
    ...overrides,
  };
}

const returnAt = T0 + 40 * 60_000;

describe("settleExpeditionReturn — lineage egg finds (bible §5.2)", () => {
  it("consumes ZERO extra rolls and leaves lineageEggs untouched (by reference) when there is no unfound seed at all", () => {
    const withoutSeeds = makeState({ lineageEggs: [] });
    const result = settleExpeditionReturn(withoutSeeds, "pip-1", makePip("pip-1").expedition!, returnAt, {
      registry: { bramblewick: BRAMBLEWICK },
    });
    expect(result.lineageEggs).toBe(withoutSeeds.lineageEggs);
    // Byte-identical to a caller that never mentions lineage at all — the
    // "lineage" stream cursor must not appear in rngState.
    expect(result.rngState["lineage"]).toBeUndefined();
  });

  it("consumes ZERO extra rolls when a seed exists but for a DIFFERENT biome", () => {
    const state = makeState({ lineageEggs: [makeSeed({ expeditionId: "snowdrift" })] });
    const result = settleExpeditionReturn(state, "pip-1", makePip("pip-1").expedition!, returnAt, {
      registry: { bramblewick: BRAMBLEWICK },
    });
    expect(result.lineageEggs).toBe(state.lineageEggs);
    expect(result.rngState["lineage"]).toBeUndefined();
  });

  it("a miss increments the seed's misses and produces no egg", () => {
    let hitState: GameState | null = null;
    for (let seed = 1; seed < 2000 && hitState === null; seed++) {
      const state = makeState({ seed, lineageEggs: [makeSeed()] });
      const result = settleExpeditionReturn(
        state,
        "pip-1",
        makePip("pip-1").expedition!,
        returnAt,
        { registry: { bramblewick: BRAMBLEWICK } },
      );
      if (result.lineageEggs?.[0]?.misses === 1) hitState = result;
    }
    expect(hitState, "no seed in range produced a miss — widen the search").not.toBeNull();
    if (hitState === null) return;
    expect(hitState.pendingReveals[0]?.egg).toBeNull();
    expect(hitState.lineageEggs).toHaveLength(1);
  });

  it("a find produces a Found egg carrying the lineage fields, and removes the seed", () => {
    const state = makeState({ lineageEggs: [makeSeed({ misses: 1, level: 9 })] });
    const result = settleExpeditionReturn(state, "pip-1", makePip("pip-1").expedition!, returnAt, {
      registry: { bramblewick: BRAMBLEWICK },
    });
    expect(result.lineageEggs).toEqual([]);
    const egg = result.pendingReveals[0]?.egg;
    expect(egg).not.toBeNull();
    expect(egg?.state).toBe("found");
    expect(egg?.sourceExpeditionId).toBe("bramblewick");
    expect(egg?.lineageGenome).toBeDefined();
    expect(egg?.lineageParentIds).toEqual(["pip-lost"]);
    expect(egg?.lineageLevel).toBe(5); // 1 + floor((9-1) * 0.5)
    expect(egg?.lineageGeneration).toBe(2);
  });

  it("a lineage find TAKES PRECEDENCE over a same-trip loot-egg roll — exactly one egg in the reveal, and nextEggNumber advances by exactly 1", () => {
    const GUARANTEED_EGG: ExpeditionView = { ...BRAMBLEWICK, eggChance: 1 };
    const state = makeState({ lineageEggs: [makeSeed({ misses: 1 })], nextEggNumber: 5 });
    const result = settleExpeditionReturn(state, "pip-1", makePip("pip-1").expedition!, returnAt, {
      registry: { bramblewick: GUARANTEED_EGG },
    });
    expect(result.pendingReveals).toHaveLength(1);
    expect(result.pendingReveals[0]?.egg?.lineageGenome).toBeDefined();
    expect(result.nextEggNumber).toBe(6);
  });

  it("the 'lineage' stream never shifts the 'expedition-loot' cursor, in either direction", () => {
    const stateNoSeeds = makeState({ lineageEggs: [] });
    const withoutLineage = settleExpeditionReturn(
      stateNoSeeds,
      "pip-1",
      makePip("pip-1").expedition!,
      returnAt,
      { registry: { bramblewick: BRAMBLEWICK } },
    );

    const stateWithSeed = makeState({ lineageEggs: [makeSeed({ misses: 1 })] });
    const withLineage = settleExpeditionReturn(
      stateWithSeed,
      "pip-1",
      makePip("pip-1").expedition!,
      returnAt,
      { registry: { bramblewick: BRAMBLEWICK } },
    );

    // Both start from the same seed/empty rngState, so the loot roll
    // (drawn BEFORE the lineage roll, module doc) must land on the exact
    // same "expedition-loot" cursor either way.
    expect(withLineage.rngState[EXPEDITION_LOOT_STREAM]).toBe(
      withoutLineage.rngState[EXPEDITION_LOOT_STREAM],
    );
  });

  it("resolves against the SAME 'lineage' stream a real Rng derives, deterministically", () => {
    const state = makeState({ lineageEggs: [makeSeed({ misses: 1 })] });
    const result = settleExpeditionReturn(state, "pip-1", makePip("pip-1").expedition!, returnAt, {
      registry: { bramblewick: BRAMBLEWICK },
    });
    const rng = createRng(SEED);
    // find (1) + combine (7) + shiny (1) = 9 rolls on "lineage".
    const stream = rng.stream(LINEAGE_STREAM);
    for (let i = 0; i < 9; i++) stream.next();
    expect(result.rngState[LINEAGE_STREAM]).toBe(stream.getState());
  });
});
