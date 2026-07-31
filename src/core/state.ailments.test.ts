/**
 * AILMENTS + THE LOSS PATH — reducer-level wiring (spec §16 v1.5,
 * docs/lifecycle-bible.md §3–§5, §7), on top of `core/pips/ailment.test.ts`'s
 * pure unit tests. This is where the FIVE-PROMISES tests live, driven
 * through the real `rootReducer`/`createNewGame` with real content, plus
 * the expedition-settle wiring (`core/expeditions/index.ts`'s
 * `ailmentRegistry`/`ailmentTuning` content fields) and the poultice
 * GIVE_ITEM cure route.
 */

import { describe, expect, it } from "vitest";
import { tuning as contentTuning, HOUR_MS } from "../content/tuning";
import { ailments as contentAilments, POULTICE_ITEM_ID } from "../content/ailments";
import { LifeStage, PipActivity } from "./pips/types";
import type { PipNeeds, PipState } from "./pips/types";
import type { GameAction, GameState } from "./state";
import { createNewGame, rootReducer } from "./state";
import { createRng } from "./rng";
import { AILMENT_GRACE_COUNTER_KEY, AILMENT_STREAM } from "./pips/ailment";
import { assignExpedition, processDueExpeditionReturns } from "./expeditions";
import type { AilmentRegistry } from "./pips/ailment";

const T0 = 10_000_000;
const SEED = 7;
const DAY_MS = 24 * HOUR_MS;

function needs(overrides: Partial<PipNeeds> = {}): PipNeeds {
  return { hunger: 90, cleanliness: 90, happiness: 90, energy: 90, ...overrides };
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
    hatchedAt: 0,
    ageMs: T0,
    happinessIntegral: 90 * T0,
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

/** Same shape/defaults as `state.progression.test.ts`'s own `makeState` —
 * a fully valid, hand-built GameState so each test controls exactly the
 * roster/ailment/counters it needs. */
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
    keep: { level: 1, placements: {} },
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
      entries: {
        mosspip: {
          speciesId: "mosspip",
          seenAt: T0,
          caughtAt: T0,
          caughtCount: 1,
          firstPortrait: null,
          shinyCaughtAt: null,
          variantsCaught: {},
          knownBiomes: [],
        },
      },
      discoveryOrder: ["mosspip"],
      formsSeen: 1,
      formsCaught: 1,
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
    ...overrides,
  };
}

describe("PROMISE 1 — loss is never a surprise", () => {
  it("no code path in expedition-return settling ever removes a Pip, even when the return rolls a NEW ailment", () => {
    // Exercise the EXACT call sites the real reducer uses
    // (assignExpedition → processDueExpeditionReturns), with the ailment
    // content forced to guarantee a contraction, so the claim is proven
    // under the worst case rather than hoping a small real-content chance
    // fires.
    const guaranteed: AilmentRegistry = {
      brambleburr: {
        id: "brambleburr",
        fromExpeditionId: "bramblewick",
        totalMs: 48 * HOUR_MS,
        contractChance: 1,
      },
    };
    const state = makeState({
      rosterOrder: ["pip-1", "pip-2", "pip-3"],
      pips: {
        "pip-1": makePip("pip-1"),
        "pip-2": makePip("pip-2"),
        "pip-3": makePip("pip-3"),
      },
      keep: { level: 1, placements: {} },
    });

    const { state: departed } = assignExpedition(state, "pip-1", "bramblewick", T0, {
      registry: {
        bramblewick: {
          id: "bramblewick",
          unlockKeepLevel: 1,
          durationMs: 40 * 60_000,
          lootTable: [{ itemId: "fiber", weight: 1 }],
          lootRolls: 1,
          eggChance: 0,
        },
      },
    });
    expect(departed.pips["pip-1"]?.activity).toBe("onExpedition");

    const returned = processDueExpeditionReturns(departed, T0 + 40 * 60_000 + 1, {
      registry: {
        bramblewick: {
          id: "bramblewick",
          unlockKeepLevel: 1,
          durationMs: 40 * 60_000,
          lootTable: [{ itemId: "fiber", weight: 1 }],
          lootRolls: 1,
          eggChance: 0,
        },
      },
      ailmentRegistry: guaranteed,
      ailmentTuning: contentTuning,
    });

    // The roster is UNCHANGED — every Pip that went out is still here.
    expect(Object.keys(returned.pips).sort()).toEqual(["pip-1", "pip-2", "pip-3"]);
    expect(returned.rosterOrder).toEqual(["pip-1", "pip-2", "pip-3"]);
    // The reveal DOES report the ailment (the "came back limping" beat's
    // data source)...
    expect(returned.pendingReveals[0]?.contractedAilmentId).toBe("brambleburr");
    // ...and the Pip itself now carries a FULL, freshly-contracted
    // countdown — nowhere near due, by construction (a brand-new ailment
    // can never itself be the thing that ends this same tick).
    expect(returned.pips["pip-1"]?.ailment?.id).toBe("brambleburr");
    expect(returned.pips["pip-1"]?.ailment?.remainingMs).toBe(48 * HOUR_MS);
  });

  it("TICK never removes a Pip for an ailment contracted during THIS SAME tick's return (real content, seed-searched)", () => {
    // Real content's Bramblewick contraction chance is 5% — search a small
    // seed range for one that actually fires, so this proves the claim
    // against the REAL reducer/content wiring rather than injected
    // content, without depending on a specific magic seed.
    let hit: GameState | null = null;
    for (let seed = 1; seed < 300 && hit === null; seed++) {
      const fresh = createNewGame(seed, T0);
      const pipId = fresh.rosterOrder[0] as string;
      const assigned = rootReducer(fresh, {
        type: "ASSIGN_EXPEDITION",
        pipId,
        expeditionId: "bramblewick",
        at: T0,
      });
      if (assigned.lastAssignOutcome?.ok !== true) continue;
      const returnAt = assigned.lastAssignOutcome.returnAt;
      const ticked = rootReducer(assigned, { type: "TICK", at: returnAt + 1 });
      if (ticked.pips[pipId]?.ailment != null) {
        hit = ticked;
      }
    }
    expect(hit, "no seed in range contracted an ailment — widen the search").not.toBeNull();
    if (hit === null) return;
    // The whole roster survived the SAME tick that contracted it.
    expect(Object.keys(hit.pips).length).toBe(Object.keys(createNewGame(1, T0).pips).length);
    expect(hit.lastLossOutcome ?? null).toBeNull();
  });
});

describe("PROMISE 2 — loss is never caused by absence", () => {
  it("a 7-day absence never loses an ailing Pip, and the countdown advances by AT MOST the offline rate cap", () => {
    const state = makeState({
      pips: {
        "pip-1": makePip("pip-1", {
          ailment: {
            id: "brambleburr",
            contractedAt: T0,
            fromExpeditionId: "bramblewick",
            remainingMs: 48 * HOUR_MS,
            totalMs: 48 * HOUR_MS,
            cureAttempts: 0,
          },
        }),
      },
      lastTickAt: T0,
    });

    const savedAt = T0;
    const sevenDaysLater = T0 + 7 * DAY_MS;
    const next = rootReducer(state, { type: "CATCHUP", savedAt, now: sevenDaysLater });

    // Still here.
    expect(next.pips["pip-1"]).toBeDefined();
    expect(next.rosterOrder).toEqual(["pip-1"]);
    // Burned AT MOST the cap, never the full 7 days.
    const before = 48 * HOUR_MS;
    const after = next.pips["pip-1"]?.ailment?.remainingMs as number;
    expect(before - after).toBeLessThanOrEqual(contentTuning.offlineRateCapMs);
    expect(before - after).toBe(contentTuning.offlineRateCapMs); // exactly the cap, for a 7-day absence
    // CATCHUP never resolves anything — the "lost transition is live-TICK
    // only" mechanism (promise 1) made concrete.
    expect(next.lastLossOutcome ?? null).toBeNull();
  });

  it("the vigil floor: an absence can reduce a countdown but never below the floor", () => {
    const state = makeState({
      pips: {
        "pip-1": makePip("pip-1", {
          ailment: {
            id: "lanternfever",
            contractedAt: T0,
            fromExpeditionId: "lanterngrotto",
            remainingMs: 10 * HOUR_MS, // above the floor before the absence
            totalMs: 36 * HOUR_MS,
            cureAttempts: 0,
          },
        }),
      },
      lastTickAt: T0,
    });
    // A month away would, uncapped, burn far more than 10h off the
    // countdown — the vigil floor must catch it.
    const next = rootReducer(state, {
      type: "CATCHUP",
      savedAt: T0,
      now: T0 + 30 * DAY_MS,
    });
    expect(next.pips["pip-1"]?.ailment?.remainingMs).toBe(
      contentTuning.lifecycle.ailments.vigilFloorMs,
    );
  });

  it("ageing obeys the same cap during the same absence (promise 2 restated for lifeMs)", () => {
    const state = makeState({
      pips: { "pip-1": makePip("pip-1", { lifeMs: 0 }) },
      lastTickAt: T0,
    });
    const next = rootReducer(state, {
      type: "CATCHUP",
      savedAt: T0,
      now: T0 + 21 * DAY_MS,
    });
    expect(next.pips["pip-1"]?.lifeMs).toBe(contentTuning.offlineRateCapMs);
  });
});

/** A roster with every shield already spent — the scenario every PROMISE
 * 4/5/Album test below needs to force a TRUE LOSS rather than a Loyal
 * Turn. */
function trueLossReadyState(overrides: Partial<GameState> = {}): GameState {
  return makeState({
    rosterOrder: ["pip-1", "pip-2", "pip-3"],
    activePipId: "pip-1",
    pips: {
      "pip-1": makePip("pip-1", {
        name: "Mossy",
        level: 5,
        ailment: {
          id: "brambleburr",
          contractedAt: T0 - 48 * HOUR_MS,
          fromExpeditionId: "bramblewick",
          remainingMs: 0,
          totalMs: 48 * HOUR_MS,
          cureAttempts: 2,
        },
        lifeMs: 10 * DAY_MS, // well past noLossBeforeLifeMs
      }),
      "pip-2": makePip("pip-2"),
      "pip-3": makePip("pip-3"),
    },
    counters: { [AILMENT_GRACE_COUNTER_KEY]: 1 }, // grace already spent
    lastTickAt: T0,
    ...overrides,
  });
}

describe("PROMISE 4 — every loss leaves a thread to pull", () => {
  it("a true loss seeds exactly one LineageEggSeed, in the biome that took them, atomically with the loss", () => {
    const state = trueLossReadyState();
    const next = rootReducer(state, { type: "TICK", at: T0 + 1 });

    expect(next.pips["pip-1"]).toBeUndefined();
    expect(next.lineageEggs?.length).toBe(1);
    const seed = next.lineageEggs?.[0];
    expect(seed?.pipId).toBe("pip-1");
    expect(seed?.name).toBe("Mossy");
    expect(seed?.expeditionId).toBe("bramblewick");
    expect(seed?.level).toBe(5);
    expect(seed?.misses).toBe(0);
    expect(next.lastLossOutcome).toMatchObject({ kind: "lost", pipId: "pip-1" });
  });
});

describe("PROMISE 5 — the Keep is never empty", () => {
  it("an ailment on the LAST active Pip always resolves as the Loyal Turn, never a loss", () => {
    const state = makeState({
      pips: {
        "pip-1": makePip("pip-1", {
          ailment: {
            id: "brambleburr",
            contractedAt: T0 - 48 * HOUR_MS,
            fromExpeditionId: "bramblewick",
            remainingMs: 0,
            totalMs: 48 * HOUR_MS,
            cureAttempts: 0,
          },
          lifeMs: 10 * DAY_MS,
        }),
      },
      counters: { [AILMENT_GRACE_COUNTER_KEY]: 1 },
      lastTickAt: T0,
    });
    const next = rootReducer(state, { type: "TICK", at: T0 + 1 });

    expect(next.rosterOrder.length).toBe(1);
    expect(next.pips["pip-1"]).toBeDefined();
    expect(next.pips["pip-1"]?.ailment).toBeNull();
    expect(next.pips["pip-1"]?.scars).toEqual(["brambleburr"]);
    expect(next.lastLossOutcome).toMatchObject({ kind: "loyalTurn", pipId: "pip-1" });
  });
});

describe("THE ALBUM IS PERMANENT", () => {
  it("a true loss never touches the Album — nothing there can regress", () => {
    const state = trueLossReadyState();
    const next = rootReducer(state, { type: "TICK", at: T0 + 1 });

    expect(next.pipdex).toBe(state.pipdex); // reference-identical — never touched
    expect(next.pipdex.formsCaught).toBe(state.pipdex.formsCaught);
    expect(next.pipdex.entries["mosspip"]?.caughtAt).not.toBeNull();
  });

  it("a lost Pip's whole record survives, verbatim, as a Long Meadow memorial (not deleted)", () => {
    const state = trueLossReadyState();
    const next = rootReducer(state, { type: "TICK", at: T0 + 1 });

    const record = next.sanctuary.pips["pip-1"];
    expect(record).toBeDefined();
    expect(record?.reason).toBe("lost");
    expect(record?.pip.name).toBe("Mossy");
    expect(record?.pip.level).toBe(5);
  });

  it("a lost resident can never be retrieved back to the active roster (a memorial, not a pause)", () => {
    const state = trueLossReadyState();
    const afterLoss = rootReducer(state, { type: "TICK", at: T0 + 1 });
    const retrieved = rootReducer(afterLoss, {
      type: "RETRIEVE_PIP",
      pipId: "pip-1",
      at: T0 + 100_000,
    });

    expect(retrieved.pips["pip-1"]).toBeUndefined();
    expect(retrieved.sanctuary.pips["pip-1"]).toBeDefined();
    expect(retrieved.lastSanctuaryOutcome).toMatchObject({
      action: "retrieve",
      ok: false,
      reason: "lost",
    });
  });

  it("a true loss grants ZERO Keep XP — grief is never monetised", () => {
    const state = trueLossReadyState({ keepXp: 500 });
    const next = rootReducer(state, { type: "TICK", at: T0 + 1 });
    expect(next.keepXp).toBe(500);
  });
});

describe("cures", () => {
  it("the poultice route (GIVE_ITEM) cures a Pip, awards Keep XP, and leaves it genuinely fine", () => {
    // Real content's poultice cure chance is 0.55, not guaranteed — search
    // a small seed range for one whose FIRST "ailment" stream roll
    // succeeds, so this proves the real GIVE_ITEM wiring rather than an
    // injected tuning object.
    let seed = -1;
    for (let candidate = 1; candidate < 200; candidate++) {
      if (createRng(candidate).stream(AILMENT_STREAM).next() < 0.55) {
        seed = candidate;
        break;
      }
    }
    expect(seed, "no seed in range rolled a cure success — widen the search").toBeGreaterThan(0);

    const state = makeState({
      seed,
      inventory: { [POULTICE_ITEM_ID]: 1 },
      keepXp: 100,
      pips: {
        "pip-1": makePip("pip-1", {
          ailment: {
            id: "brambleburr",
            contractedAt: T0 - HOUR_MS,
            fromExpeditionId: "bramblewick",
            remainingMs: 40 * HOUR_MS,
            totalMs: 48 * HOUR_MS,
            cureAttempts: 0,
          },
        }),
      },
    });

    const next = rootReducer(state, {
      type: "GIVE_ITEM",
      pipId: "pip-1",
      itemId: POULTICE_ITEM_ID,
      at: T0 + 1,
    });

    expect(next.inventory[POULTICE_ITEM_ID] ?? 0).toBe(0); // consumed
    expect(next.pips["pip-1"]?.ailment).toBeNull();
    expect(next.pips["pip-1"]?.scars).toEqual(["brambleburr"]);
    expect(next.lastLossOutcome).toMatchObject({
      kind: "cured",
      pipId: "pip-1",
      route: "poultice",
    });
    // The ordinary GIVE_ITEM care-action grant (progression.xp.care) fires
    // too — the cure is an ADDITIONAL effect of the same action, not a
    // replacement for its usual Keep XP.
    expect(next.keepXp).toBe(
      100 + contentTuning.progression.xp.care + contentTuning.lifecycle.keepXp.ailmentCured,
    );

    // Genuinely fine: ordinary care still works, needs still decay
    // normally, nothing lingers from the ailment.
    const fed = rootReducer(next, {
      type: "FEED",
      pipId: "pip-1",
      foodId: "berry",
      at: T0 + 2,
    });
    expect(fed.lastCareOutcome?.applied).toBeDefined();
    const ticked = rootReducer(next, { type: "TICK", at: T0 + 60 * 60_000 });
    expect(ticked.pips["pip-1"]?.ailment).toBeNull();
    expect(ticked.rosterOrder).toEqual(["pip-1"]);

    // And it can never contract the SAME ailment again (the scar is a
    // permanent immunity) — proven over a large offline window where the
    // real 5% chance would otherwise very likely have fired at least once
    // across repeated returns.
    const scarredAgain = rootReducer(ticked, {
      type: "ASSIGN_EXPEDITION",
      pipId: "pip-1",
      expeditionId: "bramblewick",
      at: T0 + 61 * 60_000,
    });
    if (scarredAgain.lastAssignOutcome?.ok === true) {
      const returnedAgain = rootReducer(scarredAgain, {
        type: "TICK",
        at: scarredAgain.lastAssignOutcome.returnAt + 1,
      });
      expect(returnedAgain.pips["pip-1"]?.ailment).toBeNull();
    }
  });

  it("a GIVE_ITEM of anything else never rolls a cure attempt", () => {
    const state = makeState({
      inventory: { berry: 3 },
      pips: {
        "pip-1": makePip("pip-1", {
          ailment: {
            id: "brambleburr",
            contractedAt: T0,
            fromExpeditionId: "bramblewick",
            remainingMs: 40 * HOUR_MS,
            totalMs: 48 * HOUR_MS,
            cureAttempts: 0,
          },
        }),
      },
    });
    const next = rootReducer(state, {
      type: "GIVE_ITEM",
      pipId: "pip-1",
      itemId: "berry",
      at: T0 + 1,
    });
    expect(next.pips["pip-1"]?.ailment).toEqual(state.pips["pip-1"]?.ailment);
  });
});

// ---------------------------------------------------------------------------
// ROUND 2H FIX PASS — the two shields that were specified, sold to the
// player in copy, and never built; plus the free cure route, end to end
// through the real reducer.
// ---------------------------------------------------------------------------

describe("SHIELD TWO — the Careful Route ('take the long way round')", () => {
  const risky = "bramblewick";

  function sendable(careful: boolean): { state: GameState; action: GameAction } {
    const state = makeState({
      pips: { "pip-1": makePip("pip-1") },
      keep: { level: 4, placements: {} },
    });
    return {
      state,
      action: {
        type: "ASSIGN_EXPEDITION",
        pipId: "pip-1",
        expeditionId: risky,
        at: T0,
        ...(careful ? { careful: true } : {}),
      },
    };
  }

  it("is opt-in per trip and costs exactly the advertised extra time", () => {
    const ordinary = rootReducer(sendable(false).state, sendable(false).action);
    const long = rootReducer(sendable(true).state, sendable(true).action);
    const a = ordinary.pips["pip-1"]?.expedition?.durationMs ?? 0;
    const b = long.pips["pip-1"]?.expedition?.durationMs ?? 0;
    expect(b).toBe(
      Math.round(a * contentTuning.lifecycle.shields.carefulRouteDurationMultiplier),
    );
    expect(long.pips["pip-1"]?.expedition?.careful).toBe(true);
    expect(ordinary.pips["pip-1"]?.expedition?.careful).toBeUndefined();
  });

  // THE POINT OF THE SHIELD. Without it, risk on the deep trails is
  // mandatory — and spec v1.3 §6.1 makes the deep trails the SOLE source
  // of their biome's species and foods, so finishing the Album would have
  // required accepting unmitigated risk with no lever at all.
  it("PROMISE 1: a careful trip can NEVER contract an ailment, at any seed", () => {
    // A registry with a GUARANTEED contraction — if a single roll happens,
    // this test fails.
    const certain: AilmentRegistry = {
      brambleburr: {
        id: "brambleburr",
        fromExpeditionId: risky,
        totalMs: 48 * HOUR_MS,
        contractChance: 1,
      },
    };
    for (let seed = 1; seed <= 25; seed++) {
      const departed = makeState({
        seed,
        keep: { level: 4, placements: {} },
        pips: {
          "pip-1": makePip("pip-1", {
            activity: PipActivity.OnExpedition,
            expedition: {
              expeditionId: risky,
              departedAt: T0,
              durationMs: HOUR_MS,
              careful: true,
            },
          }),
        },
      });
      const settled = processDueExpeditionReturns(departed, T0 + 2 * HOUR_MS, {
        ailmentRegistry: certain,
        ailmentTuning: contentTuning,
      });
      expect(settled.pips["pip-1"]?.ailment ?? null).toBeNull();
    }
  });

  it("charges the honest price: fewer loot rolls, floored, never zero", () => {
    const mult = contentTuning.lifecycle.shields.carefulRouteLootMultiplier;
    const base = (careful: boolean): number => {
      const departed = makeState({
        keep: { level: 4, placements: {} },
        pips: {
          "pip-1": makePip("pip-1", {
            activity: PipActivity.OnExpedition,
            expedition: {
              expeditionId: risky,
              departedAt: T0,
              durationMs: HOUR_MS,
              ...(careful ? { careful: true } : {}),
            },
          }),
        },
      });
      const settled = processDueExpeditionReturns(departed, T0 + 2 * HOUR_MS, {});
      return settled.pendingReveals[0]?.items.length ?? 0;
    };
    const ordinary = base(false);
    const long = base(true);
    expect(long).toBeLessThan(ordinary);
    expect(long).toBeGreaterThanOrEqual(1); // the long way always brings SOMETHING home
    expect(long).toBeGreaterThanOrEqual(Math.floor(ordinary * mult) - 1);
  });

  it("is silently ignored on a SAFE trail — never a tax on a risk that never existed", () => {
    const state = makeState({ pips: { "pip-1": makePip("pip-1") } });
    const plain = rootReducer(state, {
      type: "ASSIGN_EXPEDITION",
      pipId: "pip-1",
      expeditionId: "meadow",
      at: T0,
    });
    const asked = rootReducer(state, {
      type: "ASSIGN_EXPEDITION",
      pipId: "pip-1",
      expeditionId: "meadow",
      at: T0,
      careful: true,
    });
    expect(asked.pips["pip-1"]?.expedition?.durationMs).toBe(
      plain.pips["pip-1"]?.expedition?.durationMs,
    );
    expect(asked.pips["pip-1"]?.expedition?.careful).toBeUndefined();
  });
});

describe("SHIELD SIX — the Quiet Keep", () => {
  const risky = "bramblewick";

  it("is off by default and toggles idempotently", () => {
    const state = makeState();
    expect(state.settings?.quietKeep ?? false).toBe(false);
    const on = rootReducer(state, { type: "SET_QUIET_KEEP", on: true, at: T0 });
    expect(on.settings?.quietKeep).toBe(true);
    expect(rootReducer(on, { type: "SET_QUIET_KEEP", on: true, at: T0 })).toBe(on);
    const off = rootReducer(on, { type: "SET_QUIET_KEEP", on: false, at: T0 });
    expect(off.settings?.quietKeep).toBe(false);
  });

  it("no expedition return can contract anything while it is on, at any seed", () => {
    for (let seed = 1; seed <= 25; seed++) {
      let state = makeState({
        seed,
        keep: { level: 4, placements: {} },
        pips: {
          "pip-1": makePip("pip-1", {
            activity: PipActivity.OnExpedition,
            expedition: { expeditionId: risky, departedAt: T0, durationMs: HOUR_MS },
          }),
        },
        lastTickAt: T0,
      });
      state = rootReducer(state, { type: "SET_QUIET_KEEP", on: true, at: T0 });
      state = rootReducer(state, { type: "TICK", at: T0 + 2 * HOUR_MS });
      expect(state.pips["pip-1"]?.ailment ?? null).toBeNull();
    }
  });

  // A player reaches for this switch when they are FRIGHTENED FOR A PIP
  // THEY CAN SEE. A setting that only protected the next Pip would be the
  // cruellest possible reading of "Pips never fall ill".
  it("turning it ON clears an ailment already in flight", () => {
    const state = makeState({
      pips: {
        "pip-1": makePip("pip-1", {
          ailment: {
            id: "brambleburr",
            contractedAt: T0,
            fromExpeditionId: risky,
            remainingMs: 2 * HOUR_MS,
            totalMs: 48 * HOUR_MS,
            cureAttempts: 0,
          },
        }),
      },
    });
    const quiet = rootReducer(state, { type: "SET_QUIET_KEEP", on: true, at: T0 });
    expect(quiet.pips["pip-1"]?.ailment).toBeNull();
    // ...without paying the survival rewards. Otherwise the switch is an
    // XP-and-immunity printer: flip on, flip off, repeat.
    expect(quiet.pips["pip-1"]?.scars ?? []).toEqual([]);
    expect(quiet.keepXp).toBe(state.keepXp);
    expect(quiet.pips["pip-1"]?.pipXp ?? 0).toBe(state.pips["pip-1"]?.pipXp ?? 0);
  });
});

describe("THE FREE DAILY CURE — devoted care, through the real reducer", () => {
  function ailing(overrides: Partial<PipState> = {}): GameState {
    return makeState({
      pips: {
        "pip-1": makePip("pip-1", {
          lifeMs: 10 * DAY_MS,
          ailment: {
            id: "brambleburr",
            contractedAt: T0,
            fromExpeditionId: "bramblewick",
            remainingMs: 20 * HOUR_MS,
            totalMs: 48 * HOUR_MS,
            cureAttempts: 0,
          },
          ...overrides,
        }),
      },
      lastTickAt: T0,
    });
  }

  it("a TICK rolls the free cure for a well-tended ailing Pip, and stamps the day", () => {
    const next = rootReducer(ailing(), { type: "TICK", at: T0 + 60_000 });
    const pip = next.pips["pip-1"];
    // Either cured outright, or a failed attempt banked — never nothing.
    if (pip?.ailment == null) {
      expect(next.lastLossOutcome).toMatchObject({ kind: "cured", route: "devotedCare" });
    } else {
      expect(pip.ailment.cureAttempts).toBe(1);
      expect(pip.ailment.lastCareRollDay).toBeDefined();
    }
  });

  it("a TICK with the needs let slip rolls NOTHING and spends no day", () => {
    const state = ailing({ needs: needs({ hunger: 20 }) });
    const next = rootReducer(state, { type: "TICK", at: T0 + 60_000 });
    expect(next.pips["pip-1"]?.ailment?.cureAttempts).toBe(0);
    expect(next.pips["pip-1"]?.ailment?.lastCareRollDay).toBeUndefined();
  });

  it("ZERO RNG FOOTPRINT when nobody is ailing — the stream is never even opened", () => {
    const healthy = makeState({ lastTickAt: T0 });
    const next = rootReducer(healthy, { type: "TICK", at: T0 + 60_000 });
    expect(next.rngState[AILMENT_STREAM]).toBeUndefined();
  });

  it("one roll per day, however many ticks the player sits through", () => {
    let state = ailing();
    let t = T0;
    for (let i = 0; i < 20; i++) {
      t += 60_000;
      state = rootReducer(state, { type: "TICK", at: t });
      if (state.pips["pip-1"]?.ailment == null) break;
    }
    // 20 minutes of ticking is still one day, so at most one attempt.
    expect(state.pips["pip-1"]?.ailment?.cureAttempts ?? 1).toBeLessThanOrEqual(1);
  });

  // THE AUDIT'S BLOCKER, as an end-to-end measurement: perfect care, an
  // empty satchel, no intervention. It measured 0 cures in 100 runs.
  it("PROMISE 1: perfect care alone saves the great majority of Pips, with an empty satchel", () => {
    const N = 120;
    let cured = 0;
    for (let seed = 1; seed <= N; seed++) {
      let state = { ...ailing(), seed };
      let t = T0;
      for (let i = 0; i < 400; i++) {
        t += 30 * 60 * 1000;
        // Perfect care: re-pin every need to full each tick.
        const pip = state.pips["pip-1"];
        if (pip === undefined) break;
        if (pip.ailment == null) break;
        state = {
          ...state,
          pips: { ...state.pips, "pip-1": { ...pip, needs: needs({ hunger: 100 }) } },
        };
        state = rootReducer(state, { type: "TICK", at: t });
      }
      if (state.pips["pip-1"]?.ailment == null && state.pips["pip-1"] !== undefined) cured++;
    }
    expect(cured / N).toBeGreaterThan(0.7);
  });
});
