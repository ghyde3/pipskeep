/**
 * BREEDING + LINEAGE EGGS — reducer-level wiring (spec §12 unfenced, spec
 * §16 v1.5, docs/lifecycle-bible.md §5–§6), on top of
 * `core/pips/breeding.test.ts`'s pure unit tests and
 * `core/expeditions/lineage.test.ts`'s settle-point wiring tests. This is
 * where BREED_PIPS, HATCH_EGG's lineage/bred branch, the pity/pool
 * bypass, and the full "lose → expedition → egg → hatch → the descendant
 * carries the lineage" loop are driven through the real `rootReducer`/
 * `createNewGame` with real content.
 */

import { describe, expect, it } from "vitest";
import { HOUR_MS, tuning as contentTuning } from "../content/tuning";
import { LifeStage, PipActivity } from "./pips/types";
import type { PipNeeds, PipState } from "./pips/types";
import type { Egg } from "./eggs";
import type { GameAction, GameState } from "./state";
import { createNewGame, rootReducer } from "./state";
import { xpForLevel } from "./pips/level";
import { NAME_POOL } from "../content/names";
import type { SanctuaryRecord } from "./sanctuary";
import { species as contentSpecies } from "../content/species";

const T0 = 10_000_000;
const SEED = 21;

function needs(overrides: Partial<PipNeeds> = {}): PipNeeds {
  return { hunger: 90, cleanliness: 90, happiness: 90, energy: 90, ...overrides };
}

function makePip(id: string, overrides: Partial<PipState> = {}): PipState {
  const personalityId = overrides.personalityId ?? "curious";
  return {
    id,
    speciesId: "mosspip",
    name: `Pip-${id}`,
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
    ageMs: 10 * 24 * HOUR_MS,
    happinessIntegral: 90 * 10 * 24 * HOUR_MS,
    needs: needs(),
    activity: PipActivity.Idle,
    pendingSulk: false,
    readyToEvolve: false,
    evolved: null,
    lastGiftItemId: null,
    expedition: null,
    needsUpdatedAt: T0,
    level: 8,
    ...overrides,
  };
}

/** Same shape as `state.ailments.test.ts`'s own `makeState` — a fully
 * valid, hand-built GameState so each test controls exactly the
 * roster/eggs/lineageEggs it needs. */
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
    keep: { level: 4, placements: {} },
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
    lineageEggs: [],
    lastLossOutcome: null,
    lastBreedOutcome: null,
    ...overrides,
  };
}

describe("BREED_PIPS", () => {
  it("succeeds for two eligible Pips: a bred Incubating Egg lands, both parents update, XP is granted", () => {
    const state = makeState({
      pips: { a: makePip("a"), b: makePip("b") },
      rosterOrder: ["a", "b"],
      activePipId: "a",
    });
    const action: GameAction = { type: "BREED_PIPS", aId: "a", bId: "b", at: T0 };
    const next = rootReducer(state, action);

    expect(next.lastBreedOutcome).toEqual({ ok: true, aId: "a", bId: "b", eggId: "egg-1", at: T0 });
    expect(next.eggs).toHaveLength(1);
    const egg = next.eggs[0] as Egg;
    expect(egg.state).toBe("incubating");
    expect(egg.sourceExpeditionId).toBeNull();
    expect(egg.incubationMs).toBe(contentTuning.lifecycle.lineage.breedingIncubationMs);
    expect(egg.lineageGenome).toBeDefined();
    expect(egg.lineageParentIds).toEqual(["a", "b"]);
    // Two level-8 parents -> level 3 (bible §6.2's own worked example).
    expect(egg.lineageLevel).toBe(3);

    expect(next.pips["a"]?.lastBredAt).toBe(T0);
    expect(next.pips["a"]?.clutches).toBe(1);
    expect(next.pips["b"]?.lastBredAt).toBe(T0);
    expect(next.pips["b"]?.clutches).toBe(1);

    expect(next.counters["eggsBred"]).toBe(1);
    expect(next.keepXp).toBe(contentTuning.lifecycle.keepXp.breedEgg);
  });

  it("refuses with a structural reason and leaves pips/eggs untouched — samePip", () => {
    const state = makeState({ pips: { a: makePip("a") }, rosterOrder: ["a"] });
    const action: GameAction = { type: "BREED_PIPS", aId: "a", bId: "a", at: T0 };
    const next = rootReducer(state, action);
    expect(next.lastBreedOutcome).toEqual({ ok: false, aId: "a", bId: "a", at: T0, reason: "samePip" });
    expect(next.eggs).toEqual([]);
    expect(next.pips).toEqual(state.pips);
    expect(next.keepXp).toBe(0);
  });

  it("refuses with the failing pip named — levelTooLow", () => {
    const state = makeState({
      pips: { a: makePip("a", { level: 1 }), b: makePip("b") },
      rosterOrder: ["a", "b"],
    });
    const action: GameAction = { type: "BREED_PIPS", aId: "a", bId: "b", at: T0 };
    const next = rootReducer(state, action);
    expect(next.lastBreedOutcome).toEqual({
      ok: false,
      aId: "a",
      bId: "b",
      at: T0,
      reason: "levelTooLow",
      pipId: "a",
    });
    expect(next.eggs).toEqual([]);
    expect(next.pips["a"]?.clutches ?? 0).toBe(0);
  });

  it("a refusal does not advance rngState (no roll spent on a request that never combined a genome)", () => {
    const state = makeState({
      pips: { a: makePip("a", { needs: needs({ hunger: 10 }) }), b: makePip("b") },
      rosterOrder: ["a", "b"],
    });
    const next = rootReducer(state, { type: "BREED_PIPS", aId: "a", bId: "b", at: T0 });
    expect(next.lastBreedOutcome?.ok).toBe(false);
    expect(next.rngState).toEqual(state.rngState);
  });
});

describe("HATCH_EGG — bred and lineage eggs bypass rollGenome, pity and biome pools", () => {
  function bredEgg(overrides: Partial<Egg> = {}): Egg {
    return {
      id: "egg-bred",
      state: "pipping",
      foundAt: T0,
      rarity: "bred",
      incubationMs: contentTuning.lifecycle.lineage.breedingIncubationMs,
      incubationStartedAt: T0,
      sourceExpeditionId: null,
      lineageGenome: {
        speciesId: "mosspip",
        palette: "fern",
        pattern: "plain",
        personalityId: "hardworking",
        shiny: true,
      },
      lineageParentIds: ["a", "b"],
      lineageLevel: 4,
      lineageResistances: { brambleburr: 0.25 },
      lineageGeneration: 3,
      ...overrides,
    };
  }

  it("ROUND 2D — a lineage hatchling is named as an INDIVIDUAL, never after its species", () => {
    // ROUND 2D FIX STAGE. The lineage arm of HATCH_EGG was the one naming
    // path with no test: mutating it back to `name = contentSpecies[…].name`
    // — the exact pre-2D bug — left the whole suite green, while the same
    // mutation applied to `createNewGame` or the ordinary hatch arm failed
    // seven tests across five files. The three tests that DO exercise this
    // branch assert genome, level, resistances, generation and pity, and
    // never `name`.
    //
    // It is also the branch where the name matters most: a recovery egg
    // from a Pip the player just lost is round 2H's whole emotional
    // payoff, and "Mosspip hatched" is not a payoff.
    const state = makeState({ eggs: [bredEgg()] });
    const next = rootReducer(state, { type: "HATCH_EGG", eggId: "egg-bred", at: T0 });
    expect(next.lastHatchOutcome?.ok).toBe(true);
    if (next.lastHatchOutcome?.ok !== true) return;
    const hatchling = next.pips[next.lastHatchOutcome.pipId];
    expect(hatchling).toBeDefined();
    expect(NAME_POOL).toContain(hatchling?.name);
    expect(hatchling?.name).not.toBe(contentSpecies[hatchling?.speciesId as string]?.name);
  });

  it("ROUND 2D — a lineage hatchling's name dedupes against the LONG MEADOW, exactly like an ordinary hatch", () => {
    // Two gaps in one test.
    //
    // (1) The lineage arm must pass `collectUsedNames(state)` to
    //     `rollPipName`, not an empty set — otherwise a recovery egg can
    //     hand you a second Pip with the name of the one you just lost.
    // (2) `collectUsedNames` reads three sources (roster, Long Meadow,
    //     Album) and only the Album branch had a live-roll test: deleting
    //     the `state.sanctuary` line failed nothing. The Long Meadow is
    //     also the right place to reserve names from here, because the
    //     roster is capped and the sanctuary is not.
    const base = makeState({ eggs: [bredEgg()] });
    const seed = base.pips[base.rosterOrder[0] as string];
    if (seed === undefined) throw new Error("fixture has no Pip to clone");
    const reserved = NAME_POOL.filter((n) => n !== seed.name).slice(0, -1);
    const openName = NAME_POOL[NAME_POOL.length - 1] as string;
    const residents: Record<string, SanctuaryRecord> = {};
    const order: string[] = [];
    reserved.forEach((name, i) => {
      const id = `ghost-${i}`;
      residents[id] = {
        pip: { ...seed, id: id as typeof seed.id, name },
        retiredAt: T0,
        retiredFromKeepLevel: 1,
        visits: 0,
      };
      order.push(id);
    });
    const next = rootReducer(
      { ...base, sanctuary: { pips: residents, order } },
      { type: "HATCH_EGG", eggId: "egg-bred", at: T0 },
    );
    expect(next.lastHatchOutcome?.ok).toBe(true);
    if (next.lastHatchOutcome?.ok !== true) return;
    expect(next.pips[next.lastHatchOutcome.pipId]?.name).toBe(openName);
  });

  it("hatches a bred egg with the SNAPSHOTTED genome/level/resistances/generation, no RNG roll", () => {
    const state = makeState({
      eggs: [bredEgg()],
      eggPity: { bramblewick: 4 },
    });
    const next = rootReducer(state, { type: "HATCH_EGG", eggId: "egg-bred", at: T0 });

    expect(next.lastHatchOutcome?.ok).toBe(true);
    if (next.lastHatchOutcome?.ok !== true) return;
    const hatchling = next.pips[next.lastHatchOutcome.pipId];
    expect(hatchling).toBeDefined();
    expect(hatchling?.genome.speciesId).toBe("mosspip");
    expect(hatchling?.genome.personalityId).toBe("hardworking");
    expect(hatchling?.genome.shiny).toBe(true);
    expect(hatchling?.level).toBe(4);
    expect(hatchling?.pipXp).toBe(xpForLevel(4, contentTuning));
    expect(hatchling?.generation).toBe(3);
    expect(hatchling?.parentIds).toEqual(["a", "b"]);
    expect(hatchling?.resistances).toEqual({ brambleburr: 0.25 });

    // NO rollGenome roll: the "egg" stream was never touched.
    expect(next.rngState["egg"]).toBeUndefined();
    // NO pity ladder interaction: the counter for bramblewick (an
    // unrelated biome here, but the point is generalisable — a bred egg
    // has `sourceExpeditionId: null` and touches NO biome's pity at all)
    // is exactly what it was before.
    expect(next.eggPity).toEqual(state.eggPity);
    expect(next.eggs).toEqual([]);
  });

  it("hatches a lineage-found egg the same way, and its OWN biome's pity is untouched", () => {
    const lineageEgg: Egg = {
      id: "egg-lineage",
      state: "pipping",
      foundAt: T0,
      rarity: "common",
      incubationMs: 2 * HOUR_MS,
      incubationStartedAt: T0,
      sourceExpeditionId: "bramblewick",
      lineageGenome: {
        speciesId: "mosspip",
        palette: "fern",
        pattern: "plain",
        personalityId: "curious",
        shiny: false,
      },
      lineageParentIds: ["lost-pip"],
      lineageLevel: 5,
      lineageResistances: {},
      lineageGeneration: 2,
    };
    const state = makeState({ eggs: [lineageEgg], eggPity: { bramblewick: 7 } });
    const next = rootReducer(state, { type: "HATCH_EGG", eggId: "egg-lineage", at: T0 });

    expect(next.lastHatchOutcome?.ok).toBe(true);
    if (next.lastHatchOutcome?.ok !== true) return;
    const hatchling = next.pips[next.lastHatchOutcome.pipId];
    expect(hatchling?.level).toBe(5);
    expect(hatchling?.generation).toBe(2);
    expect(hatchling?.parentIds).toEqual(["lost-pip"]);

    // The BIOME the egg was found in still gets NO pity update from this
    // hatch — lineage eggs bypass the pity ladder entirely (bible §6.3/
    // §9.1), even though `sourceExpeditionId` is non-null here (unlike a
    // bred egg).
    expect(next.eggPity["bramblewick"]).toBe(7);
    expect(next.rngState["egg"]).toBeUndefined();
  });

  it("still respects the roster cap, exactly like an ordinary hatch", () => {
    const full = {
      pips: { a: makePip("a"), b: makePip("b"), c: makePip("c") },
      rosterOrder: ["a", "b", "c"],
    };
    const state = makeState({ ...full, eggs: [bredEgg()] });
    const next = rootReducer(state, { type: "HATCH_EGG", eggId: "egg-bred", at: T0 });
    expect(next.lastHatchOutcome?.ok).toBe(false);
    expect(
      next.lastHatchOutcome?.ok === false ? next.lastHatchOutcome.reason : undefined,
    ).toBe("rosterFull");
    expect(next.eggs).toEqual([bredEgg()]);
  });
});

describe("ACKNOWLEDGE_REVEAL — lineageEggFound Keep XP (bible §9.3)", () => {
  it("pays lineageEggFound, ON TOP OF the ordinary revealXp, when the reveal's egg carries a lineageGenome", () => {
    const lineageEgg: Egg = {
      id: "egg-lineage",
      state: "found",
      foundAt: T0,
      rarity: "common",
      incubationMs: 2 * HOUR_MS,
      incubationStartedAt: null,
      sourceExpeditionId: "bramblewick",
      lineageGenome: {
        speciesId: "mosspip",
        palette: "fern",
        pattern: "plain",
        personalityId: "curious",
        shiny: false,
      },
      lineageParentIds: ["lost-pip"],
      lineageLevel: 5,
      lineageResistances: {},
      lineageGeneration: 2,
    };
    const withLineageReveal = makeState({
      pendingReveals: [
        { pipId: "pip-1", expeditionId: "bramblewick", completedAt: T0, items: [], egg: lineageEgg },
      ],
    });
    const withOrdinaryReveal = makeState({
      pendingReveals: [
        { pipId: "pip-1", expeditionId: "bramblewick", completedAt: T0, items: [], egg: null },
      ],
    });

    const lineageNext = rootReducer(withLineageReveal, { type: "ACKNOWLEDGE_REVEAL", at: T0 });
    const ordinaryNext = rootReducer(withOrdinaryReveal, { type: "ACKNOWLEDGE_REVEAL", at: T0 });

    expect(lineageNext.keepXp - ordinaryNext.keepXp).toBe(
      contentTuning.lifecycle.keepXp.lineageEggFound,
    );
  });
});

describe("end to end — a lost Pip's line is genuinely recoverable (lose -> expedition -> egg -> hatch -> descendant)", () => {
  it("carries the lost parent's lineage through to a hatched descendant, via the real reducer and real content", () => {
    // 1) Force a TRUE LOSS through the real TICK/resolveAilments path: a
    // roster of two (so losing one still leaves >= minActivePips), the
    // grace shield already spent, and the ailing Pip old enough that the
    // young-Pip shield does not apply.
    //
    // Needs are deliberately BELOW `devotedCareNeedFloor`: with all four
    // high, the free daily cure (`applyDevotedCare`, run on the same tick,
    // before the countdown may resolve) gets a real chance to save this
    // Pip — which is the whole point of that route, and would make this
    // fixture non-deterministic. A Pip lost with the needs let slip is
    // also the honest shape of a loss.
    const lost = makePip("lost", {
      level: 9,
      lifeStage: LifeStage.Adult,
      ageMs: 20 * 24 * HOUR_MS,
      lifeMs: 10 * 24 * HOUR_MS,
      needs: { hunger: 40, cleanliness: 40, happiness: 40, energy: 40 },
      ailment: {
        id: "brambleburr",
        contractedAt: T0 - HOUR_MS,
        fromExpeditionId: "bramblewick",
        remainingMs: 0,
        totalMs: 48 * HOUR_MS,
        cureAttempts: 0,
      },
    });
    const survivor = makePip("survivor", { level: 8 });
    let state = makeState({
      pips: { lost: lost, survivor },
      rosterOrder: ["lost", "survivor"],
      activePipId: "survivor",
      counters: { "ailment.graceUsed": 1 },
      keep: { level: 4, placements: {} },
    });

    state = rootReducer(state, { type: "TICK", at: T0 });
    expect(state.pips["lost"]).toBeUndefined();
    expect(state.sanctuary.pips["lost"]?.reason).toBe("lost");
    expect(state.lineageEggs).toHaveLength(1);
    expect(state.lineageEggs?.[0]).toMatchObject({
      pipId: "lost",
      expeditionId: "bramblewick",
      level: 9,
      generation: 1,
    });

    // 2) Send the survivor back to Bramblewick — up to twice, since the
    // find is guaranteed by the SECOND qualifying trip regardless of
    // seed (bible §5.2), so this loop is deterministic without a seed
    // search.
    let found: Egg | null = null;
    for (let trip = 0; trip < 2 && found === null; trip++) {
      const assignAt = state.lastTickAt;
      state = rootReducer(state, {
        type: "ASSIGN_EXPEDITION",
        pipId: "survivor",
        expeditionId: "bramblewick",
        at: assignAt,
      });
      expect(state.lastAssignOutcome?.ok).toBe(true);
      if (state.lastAssignOutcome?.ok !== true) return;
      const returnAt = state.lastAssignOutcome.returnAt;
      state = rootReducer(state, { type: "TICK", at: returnAt + 1 });
      const reveal = state.pendingReveals[0];
      expect(reveal).toBeDefined();
      if (reveal?.egg?.lineageGenome !== undefined) {
        found = reveal.egg;
      }
      state = rootReducer(state, { type: "ACKNOWLEDGE_REVEAL", at: returnAt + 1 });
    }

    expect(found, "the lineage egg was not found within 2 qualifying trips").not.toBeNull();
    if (found === null) return;
    expect(state.lineageEggs).toEqual([]);
    expect(state.eggs.some((e) => e.lineageParentIds?.includes("lost"))).toBe(true);
    const inFlightEgg = state.eggs.find((e) => e.lineageParentIds?.includes("lost")) as Egg;
    expect(inFlightEgg.state).toBe("incubating");

    // 3) Let incubation finish and hatch it.
    const readyAt = (inFlightEgg.incubationStartedAt ?? 0) + inFlightEgg.incubationMs + 1;
    state = rootReducer(state, { type: "TICK", at: readyAt });
    const pipping = state.eggs.find((e) => e.id === inFlightEgg.id);
    expect(pipping?.state).toBe("pipping");

    const eggPityBefore = state.eggPity;
    const rngEggCursorBefore = state.rngState["egg"];
    state = rootReducer(state, { type: "HATCH_EGG", eggId: inFlightEgg.id, at: readyAt });

    expect(state.lastHatchOutcome?.ok).toBe(true);
    if (state.lastHatchOutcome?.ok !== true) return;
    const descendant = state.pips[state.lastHatchOutcome.pipId];
    expect(descendant).toBeDefined();
    expect(descendant?.generation).toBe(2);
    expect(descendant?.parentIds).toEqual(["lost"]);
    // The lost parent (level 9) shares half its levels: 1 + floor(8*0.5) = 5.
    expect(descendant?.level).toBe(5);
    expect(descendant?.genome.speciesId).toBe("mosspip");

    // The find/hatch never touched the pity ladder or the "egg" RNG
    // stream — the pity/pool bypass holds end to end, not just in the
    // isolated HATCH_EGG unit tests above.
    expect(state.eggPity).toEqual(eggPityBefore);
    expect(state.rngState["egg"]).toBe(rngEggCursorBefore);

    // The Album's permanence/lost-record contract (round 2C/2H) still
    // holds: the lost Pip's own record is untouched in the sanctuary.
    expect(state.sanctuary.pips["lost"]?.reason).toBe("lost");
  });
});
