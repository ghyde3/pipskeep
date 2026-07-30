/**
 * ROUND 2C — PROGRESSION wiring tests (docs/retention-bible.md): the
 * reducer-level integration for streak/milestones/bounties/mastery/pity,
 * on top of the pure unit tests in `core/progression/*.test.ts`.
 *
 * Deliberately narrow (see `touchProgressionVisit`'s doc comment in
 * state.ts): the streak/bounty REWARD-granting steps are EXPLICIT actions
 * (CLAIM_STREAK_REWARD, REFRESH_BOUNTIES) rather than fired automatically
 * from every care action — an integration-safety boundary that keeps the
 * rest of the (enormous, pre-existing) test suite's assumptions intact.
 * This file is where that explicit wiring itself is proven.
 */

import { describe, expect, it } from "vitest";
import { tuning as contentTuning } from "../content/tuning";
import { species as contentSpecies } from "../content/species";
import { expeditions as contentExpeditions } from "../content/expeditions";
import { LifeStage, PipActivity } from "./pips/types";
import type { PipNeeds, PipState } from "./pips/types";
import type { GameAction, GameState } from "./state";
import { STREAK_VISIT_ACTION_TYPES, createNewGame, rootReducer } from "./state";
import { effectiveStreakTier } from "./progression/streak";
import { masteryTier } from "./progression/mastery";
import { fromSaveBlob, toSaveBlob } from "./save/serialize";
import { BOUNTY_TEMPLATES } from "../content/bountyTemplates";
import { MILESTONES } from "../content/milestones";
import { flairById } from "../content/flair";

const T0 = 10_000_000;
const SEED = 7;

function needs(overrides: Partial<PipNeeds> = {}): PipNeeds {
  return { hunger: 60, cleanliness: 60, happiness: 60, energy: 60, ...overrides };
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
    happinessIntegral: 60 * T0,
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
    inventory: { berry: 5 },
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
    ...overrides,
  };
}

const ALL_ACTION_TYPES: readonly GameAction["type"][] = [
  "TICK",
  "SET_ACTIVE_PIP",
  "FEED",
  "CLEAN",
  "PLAY",
  "PET",
  "REST_TOGGLE",
  "GIVE_ITEM",
  "ASSIGN_EXPEDITION",
  "ACKNOWLEDGE_REVEAL",
  "HATCH_EGG",
  "CATCHUP",
  "PLACE_ITEM",
  "MOVE_ITEM",
  "REMOVE_ITEM",
  "PURCHASE_KEEP_LEVEL",
  "PURCHASE_ROSTER_UPGRADE",
  "ASSIGN_JOB",
  "UNASSIGN_JOB",
  "EVOLVE_PIP",
  "DEBUG_GRANT",
  "ONBOARDING_ADVANCE",
  "DEBUG_SPAWN_EGG",
  "LOAD_SAVE",
  "RETIRE_PIP",
  "RETRIEVE_PIP",
  "SET_DAY_OFFSET",
  "SET_ACTIVE_EVENTS",
  "CLAIM_MILESTONE",
  "REROLL_BOUNTY",
  "REFRESH_BOUNTIES",
  "CLAIM_STREAK_REWARD",
  "RESOLVE_STREAK_CHOICE",
];

describe("the streak visit whitelist (bible §3.2), enumerated against GameAction's union", () => {
  it("every known action type is explicitly categorised (nothing silently starts or stops counting)", () => {
    for (const type of ALL_ACTION_TYPES) {
      // Every type must be a definite decision — this loop is the
      // "enumerate against the union" check the bible asks for: the
      // whitelist test breaks the moment a NEW action type is added to
      // GameAction without a matching decision here.
      expect(typeof STREAK_VISIT_ACTION_TYPES.has(type)).toBe("boolean");
    }
    // The care/expedition/collection-moment core is IN the whitelist.
    for (const type of [
      "FEED",
      "CLEAN",
      "PLAY",
      "PET",
      "REST_TOGGLE",
      "GIVE_ITEM",
      "ASSIGN_EXPEDITION",
      "ACKNOWLEDGE_REVEAL",
      "HATCH_EGG",
      "ASSIGN_JOB",
      "EVOLVE_PIP",
      "RETIRE_PIP",
      "RETRIEVE_PIP",
      // Bible §3.2 lists "place/move an item, buy something" as visit days
      // too: a session spent entirely in Build mode is a session the player
      // demonstrably played, and recording it as an absence would spend a
      // rain day (or drop the tier) for a day that happened.
      "PLACE_ITEM",
      "MOVE_ITEM",
      "REMOVE_ITEM",
      "PURCHASE_KEEP_LEVEL",
      "PURCHASE_ROSTER_UPGRADE",
      "UNASSIGN_JOB",
    ] as const) {
      expect(STREAK_VISIT_ACTION_TYPES.has(type), type).toBe(true);
    }
    // The app-breathing / meta/administrative actions are OUT.
    for (const type of [
      "TICK",
      "CATCHUP",
      "SET_ACTIVE_PIP",
      "LOAD_SAVE",
      "SET_DAY_OFFSET",
      "SET_ACTIVE_EVENTS",
      "CLAIM_MILESTONE",
      "REROLL_BOUNTY",
      "REFRESH_BOUNTIES",
      "CLAIM_STREAK_REWARD",
      "RESOLVE_STREAK_CHOICE",
    ] as const) {
      expect(STREAK_VISIT_ACTION_TYPES.has(type), type).toBe(false);
    }
  });

  it("a whitelisted action (FEED) advances the streak; a non-whitelisted one (SET_ACTIVE_PIP) never does", () => {
    const state = makeState();
    const fed = rootReducer(state, { type: "FEED", pipId: "pip-1", foodId: "berry", at: T0 });
    expect(fed.streak.totalVisitDays).toBe(1);
    expect(fed.streak.current).toBe(1);

    const reselected = rootReducer(fed, { type: "SET_ACTIVE_PIP", pipId: "pip-1" });
    expect(reselected.streak).toBe(fed.streak);
  });

  it("a Build-mode-only session counts as a visit day — a day the player played is never recorded as an absence", () => {
    const DAY_MS = contentTuning.retention.dayMs;
    let state = makeState({ resources: { fiber: 40, wood: 40, shell: 40, driftwood: 40 } });
    // Day 1: a care action, the ordinary way in.
    state = rootReducer(state, { type: "FEED", pipId: "pip-1", foodId: "berry", at: T0 });
    expect(state.streak.current).toBe(1);
    // Day 2: the player opens the app and spends the whole session in Build
    // mode — places a decoration, tucks it away again. Nothing else.
    state = rootReducer(state, {
      type: "PLACE_ITEM",
      itemId: "moss-tuft",
      x: 2,
      y: 2,
      at: T0 + DAY_MS,
    });
    expect(state.streak.current, "a placement is a visit (bible §3.2)").toBe(2);
    expect(state.streak.graceBanked, "no rain day was spent for a day that happened").toBe(
      contentTuning.retention.streak.graceMax,
    );
    // Day 3: a Keep purchase, likewise.
    state = rootReducer(state, { type: "PURCHASE_KEEP_LEVEL", at: T0 + 2 * DAY_MS });
    expect(state.keep.level, "the purchase itself still went through").toBe(2);
    expect(state.streak.current, "buying something is a visit (bible §3.2)").toBe(3);
  });

  it("a break costs ONLY the bonus tier: every other slice of GameState is byte-identical across it (bible §0.1, wired end to end)", () => {
    const DAY_MS = contentTuning.retention.dayMs;
    // A REAL streak first — a veteran losing a real streak is the case that
    // matters, and a 1 → 1 restart never executes any `current > 1` path.
    let state = makeState();
    for (let day = 0; day < 3; day++) {
      state = rootReducer(state, {
        type: "FEED",
        pipId: "pip-1",
        foodId: "berry",
        at: T0 + day * DAY_MS,
      });
    }
    expect(state.streak.current).toBe(3);
    expect(state.streak.longest).toBe(3);
    // …and real, genuinely-earned milestone credit banked against it.
    state = rootReducer(state, { type: "CLAIM_MILESTONE", id: "first-feed", at: T0 + 1 });
    state = rootReducer(state, { type: "REFRESH_BOUNTIES", at: T0 + 2 * DAY_MS });
    expect(Object.keys(state.milestones.earned)).toContain("first-feed");
    const before = state;
    const tierBefore = effectiveStreakTier(before.streak, contentTuning);
    expect(tierBefore, "a 3-day streak is above tier 0 — there is a bonus to lose").toBeGreaterThan(0);

    // THE CONTROL: the exact same FEED one ordinary day later, where no
    // break happens at all. Everything that differs between these two runs
    // is attributable to the BREAK and nothing else.
    const noBreak = rootReducer(before, {
      type: "FEED",
      pipId: "pip-1",
      foodId: "berry",
      at: T0 + 3 * DAY_MS,
    });
    expect(noBreak.streak.current, "the control did NOT break").toBe(4);

    // A hundred-day gap blows through grace and restarts `current`.
    const after = rootReducer(before, {
      type: "FEED",
      pipId: "pip-1",
      foodId: "berry",
      at: T0 + 102 * DAY_MS,
    });

    // The ONE thing a break may cost: `current`, and the tier derived from it.
    expect(after.streak.current).toBe(1); // restart, not destruction
    expect(effectiveStreakTier(after.streak, contentTuning)).toBeLessThan(tierBefore);
    // Forward-only fields inside the streak itself.
    expect(after.streak.longest).toBe(before.streak.longest);
    expect(after.streak.totalVisitDays).toBe(before.streak.totalVisitDays + 1);
    expect(after.streak.rainDays).toBeGreaterThanOrEqual(before.streak.rainDays);

    // THE TOTAL GUARDRAIL, rather than an enumerated list that can drift:
    // walk EVERY key of GameState and compare WHICH keys the break-run
    // changed against which keys the no-break control changed. They must be
    // the same set — a break touches nothing a plain visit doesn't. Any
    // future slice added to GameState is covered automatically, with no list
    // to keep in sync.
    const changedKeys = (base: GameState, next: GameState): readonly string[] =>
      (Object.keys(next) as (keyof GameState)[])
        .filter((key) => JSON.stringify(next[key]) !== JSON.stringify(base[key]))
        .sort();
    expect(changedKeys(before, after)).toEqual(changedKeys(before, noBreak));

    // And the two slices inside that allowlist that a break must not DAMAGE,
    // pinned exactly (MUTATION 3's target: milestone credit must survive an
    // absence, and `earned` is also the double-grant guard).
    expect(after.milestones.earned).toEqual(before.milestones.earned);
    for (const [id, value] of Object.entries(before.counters)) {
      expect(after.counters[id] ?? 0, `counter ${id} is forward-only`).toBeGreaterThanOrEqual(
        value,
      );
    }
    // Everything the player OWNS, pinned by value.
    expect(after.pipdex).toEqual(before.pipdex);
    expect(after.rosterOrder).toEqual(before.rosterOrder);
    expect(Object.keys(after.pips)).toEqual(Object.keys(before.pips));
    expect(after.sanctuary).toEqual(before.sanctuary);
    expect(after.keepsakes).toEqual(before.keepsakes);
    expect(after.flair).toEqual(before.flair);
    expect(after.eggPity).toEqual(before.eggPity);
    expect(after.eggs).toEqual(before.eggs);
    expect(after.resources).toEqual(before.resources);
    expect(after.keep).toEqual(before.keep);
    expect(after.rosterUpgradePurchased).toBe(before.rosterUpgradePurchased);
    // The single berry the feed itself ate is the ONLY inventory movement.
    expect(after.inventory["berry"]).toBe(before.inventory["berry"]! - 1);
  });
});

describe("milestones — counters bump, queue, and CLAIM idempotency, wired through the reducer", () => {
  it("a successful FEED bumps feeds/careActions and queues the real 'first-feed' milestone", () => {
    const state = makeState();
    const fed = rootReducer(state, { type: "FEED", pipId: "pip-1", foodId: "berry", at: T0 });
    expect(fed.lastCareOutcome?.applied).toBe(true);
    expect(fed.counters["feeds"]).toBe(1);
    expect(fed.counters["careActions"]).toBe(1);
    expect(fed.milestones.pendingCelebrations).toContain("first-feed");
  });

  it("CLAIM_MILESTONE grants the real reward once, and a second claim never double-grants", () => {
    const state = makeState();
    const fed = rootReducer(state, { type: "FEED", pipId: "pip-1", foodId: "berry", at: T0 });
    const berriesBefore = fed.inventory["berry"] ?? 0;

    const claimed = rootReducer(fed, { type: "CLAIM_MILESTONE", id: "first-feed", at: T0 + 1 });
    expect(claimed.milestones.earned["first-feed"]).toBe(T0 + 1);
    expect(claimed.milestones.pendingCelebrations).not.toContain("first-feed");
    expect(claimed.inventory["berry"]).toBeGreaterThan(berriesBefore); // the real +2 berry reward

    const claimedAgain = rootReducer(claimed, {
      type: "CLAIM_MILESTONE",
      id: "first-feed",
      at: T0 + 2,
    });
    expect(claimedAgain).toBe(claimed); // a true no-op — same reference
    expect(claimedAgain.inventory["berry"]).toBe(claimed.inventory["berry"]);
  });

  it("claiming a milestone that was never earned is a no-op", () => {
    const state = makeState();
    const claimed = rootReducer(state, { type: "CLAIM_MILESTONE", id: "first-feed", at: T0 });
    expect(claimed).toBe(state);
  });

  /**
   * ROUND-2C REVIEW FIX. `case "flair": break; // flair is presentational —
   * nothing in core to grant` meant 20 of 34 milestone rewards paid literally
   * nothing: no `flair` field existed on GameState, serialize validated no such
   * field, and no module rendered a frame, stamp, ribbon, sign or title. Spec
   * v1.3 already made this a standing rule — "treat 'written to state' and
   * 'visible to the player' as separate acceptance criteria" — and here it was
   * neither. `content/flair.test.ts` pins the registry, `ui/pipdex.test.ts` /
   * `ui/sanctuary.test.ts` / `ui/focusView.test.ts` pin the rendering; this
   * pins the grant.
   */
  it("a flair reward is GRANTED into state.flair, once, forward-only, and survives a reload", () => {
    let state = makeState();
    state = rootReducer(state, { type: "ACKNOWLEDGE_REVEAL", at: T0 });
    // `first-egg-found` pays `{ kind: "flair", flairId: "cover-egg-sticker" }`.
    const def = MILESTONES.find((m) => m.id === "first-egg-found");
    expect(def?.reward).toEqual({ kind: "flair", flairId: "cover-egg-sticker" });

    const withEgg = makeState({ counters: { eggsFound: 1 } });
    const claimed = rootReducer(withEgg, {
      type: "CLAIM_MILESTONE",
      id: "first-egg-found",
      at: T0 + 5,
    });
    expect(claimed.flair["cover-egg-sticker"], "the flourish must be recorded").toBe(T0 + 5);
    expect(flairById("cover-egg-sticker"), "…and must exist in the registry").toBeDefined();

    // Idempotent: a second claim is a no-op and cannot rewrite `earnedAt`.
    const again = rootReducer(claimed, {
      type: "CLAIM_MILESTONE",
      id: "first-egg-found",
      at: T0 + 9999,
    });
    expect(again).toBe(claimed);
    expect(again.flair["cover-egg-sticker"]).toBe(T0 + 5);

    // Forward-only across a save/reload — a flourish is permanent by §0.1.
    const reloaded = fromSaveBlob(JSON.parse(JSON.stringify(toSaveBlob(claimed, T0 + 10))));
    expect(reloaded.ok).toBe(true);
    expect(reloaded.ok ? reloaded.save.state.flair["cover-egg-sticker"] : null).toBe(T0 + 5);
  });

  it("EVERY milestone reward kind actually moves something in state — none of them is a silent no-op", () => {
    // The general form of the bug: a reward kind the reducer quietly ignores.
    // `none` is the only kind allowed to change nothing, and no shipped
    // milestone uses it.
    const kinds = new Set(MILESTONES.map((m) => m.reward.kind));
    expect(kinds.has("none"), "no shipped milestone should pay literally nothing").toBe(false);
    for (const kind of kinds) {
      const def = MILESTONES.find(
        (m) => m.reward.kind === kind && Number.isFinite(m.threshold),
      );
      expect(def, `no earnable milestone with reward kind "${kind}"`).toBeDefined();
      // Force the metric over the line, whatever it reads.
      const before = makeState({
        counters: {
          feeds: 999, careActions: 999, expeditionsTotal: 999, eggsFound: 999,
          eggsHatched: 999, naps: 999, decorationsPlaced: 999, evolutions: 999,
          bountiesCompleted: 999, bountyDaysCleared: 999, shiniesFound: 999,
          jobsAssigned: 999, biomesVisited: 999, keepLevel2Reached: 999,
          keepLevel3Reached: 999, rosterSizeReached3: 999, rosterUpgradePurchased: 999,
        },
        pipdex: {
          entries: {}, discoveryOrder: [], formsSeen: 99, formsCaught: 99,
          variantsCaught: 99, shiniesCaught: 99, unreadEntryIds: [],
        },
      });
      const after = rootReducer(before, {
        type: "CLAIM_MILESTONE",
        id: def!.id,
        at: T0 + 1,
      });
      expect(after.milestones.earned[def!.id], `${def!.id} was not earnable`).toBe(T0 + 1);
      const moved =
        JSON.stringify(after.resources) !== JSON.stringify(before.resources) ||
        JSON.stringify(after.inventory) !== JSON.stringify(before.inventory) ||
        JSON.stringify(after.keepsakes) !== JSON.stringify(before.keepsakes) ||
        JSON.stringify(after.flair) !== JSON.stringify(before.flair);
      expect(moved, `reward kind "${kind}" (${def!.id}) granted NOTHING`).toBe(true);
    }
  });
});

describe("bounties — explicit REFRESH_BOUNTIES generates today's trio, level-aware; progress auto-completes and auto-banks", () => {
  it("REFRESH_BOUNTIES generates a level-1-eligible trio, deterministically for the day", () => {
    const state = makeState();
    const refreshed = rootReducer(state, { type: "REFRESH_BOUNTIES", at: T0 });
    expect(refreshed.bounties.slots.length).toBe(contentTuning.retention.bounties.perDay);
    expect(refreshed.bounties.day).not.toBeNull();

    const again = rootReducer(refreshed, { type: "REFRESH_BOUNTIES", at: T0 + 1 });
    expect(again).toBe(refreshed); // same day — no-op by reference

    // …and every slot the REAL reducer generated is completable at this Keep
    // level, checked against the AUTHORED template requirements rather than
    // against `isBountyEligible` (which is what generation filters on — see
    // `bounties.test.ts`'s `authoredRequirementsMet` doc comment for why the
    // obvious assertion is a tautology). The unit suite proves this over 1000
    // seeded days against a hand-built context; this proves the context the
    // reducer actually derives from a real GameState agrees.
    for (const slot of refreshed.bounties.slots) {
      const template = BOUNTY_TEMPLATES.find((t) => t.id === slot.templateId);
      expect(template, `unknown template ${slot.templateId}`).toBeDefined();
      expect(
        template!.requires.minKeepLevel ?? 1,
        `${slot.templateId} needs a higher Keep level than this save has`,
      ).toBeLessThanOrEqual(refreshed.keep.level);
      if (template!.requires.expeditionId !== undefined) {
        expect(
          contentExpeditions[template!.requires.expeditionId as "meadow"].unlockKeepLevel,
          `${slot.templateId} names a locked biome`,
        ).toBeLessThanOrEqual(refreshed.keep.level);
      }
      if (template!.requires.placedItemId !== undefined) {
        expect(
          Object.values(refreshed.keep.placements).map((p) => p.itemId),
          `${slot.templateId} needs a station that isn't placed`,
        ).toContain(template!.requires.placedItemId);
      }
      expect(
        template!.requires.minRosterSize ?? 0,
        `${slot.templateId} needs more Pips than this save has`,
      ).toBeLessThanOrEqual(refreshed.rosterOrder.length);
    }
  });

  it("completing a feed-kind bounty auto-banks its reward and bumps bountiesCompleted", () => {
    let state = makeState();
    state = rootReducer(state, { type: "REFRESH_BOUNTIES", at: T0 });
    const feedSlot = state.bounties.slots.find((s) => s.templateId === "hand-out-snacks");
    expect(feedSlot, "expected the universal feed bounty to be eligible at level 1").toBeDefined();

    const berriesBefore = state.inventory["berry"] ?? 0;
    for (let i = 0; i < feedSlot!.target; i++) {
      state = rootReducer(state, {
        type: "FEED",
        pipId: "pip-1",
        foodId: "berry",
        at: T0 + i * 1000,
      });
    }
    const completed = state.bounties.slots.find((s) => s.slot === feedSlot!.slot)!;
    expect(completed.completedAt).not.toBeNull();
    expect(state.counters["bountiesCompleted"]).toBe(1);
    // The reward is a NET gain even though feeding itself consumed
    // berries (5 starting − target fed + reward berries, per the
    // template's `{ items: { berry: 1 } }`).
    expect(state.inventory["berry"]).toBe(berriesBefore - feedSlot!.target + 1);
  });
});

describe("REROLL_BOUNTY — free, budgeted, keeps kinds distinct", () => {
  it("rerolls a slot once, then refuses (state unchanged) once the free budget is spent", () => {
    let state = makeState();
    state = rootReducer(state, { type: "REFRESH_BOUNTIES", at: T0 });
    const slot0 = state.bounties.slots[0]!.slot;

    const rerolled = rootReducer(state, { type: "REROLL_BOUNTY", slot: slot0, at: T0 + 1 });
    expect(rerolled.bounties.rerollsUsed).toBe(1);

    const again = rootReducer(rerolled, { type: "REROLL_BOUNTY", slot: slot0, at: T0 + 2 });
    expect(again).toBe(rerolled); // budget spent — no-op
  });
});

describe("CLAIM_STREAK_REWARD and RESOLVE_STREAK_CHOICE — explicit, idempotent", () => {
  it("banks day 1's grant reward exactly once", () => {
    let state = makeState();
    state = rootReducer(state, { type: "FEED", pipId: "pip-1", foodId: "berry", at: T0 });
    expect(state.streak.current).toBe(1);

    const berriesBefore = state.inventory["berry"] ?? 0;
    const claimed = rootReducer(state, { type: "CLAIM_STREAK_REWARD", at: T0 + 1 });
    expect(claimed.streak.rewardedForDay).toBe(1);
    expect(claimed.inventory["berry"]).toBe(berriesBefore + 2); // day 1 = { berry: 2 }

    const again = rootReducer(claimed, { type: "CLAIM_STREAK_REWARD", at: T0 + 2 });
    expect(again).toBe(claimed); // idempotent
  });

  it("a fresh save (current === 0) has nothing to claim", () => {
    const state = makeState();
    const claimed = rootReducer(state, { type: "CLAIM_STREAK_REWARD", at: T0 });
    expect(claimed).toBe(state);
  });

  it("resolving a pending keepsake choice grants the chosen decoration into the keepsakes shelf and clears the choice", () => {
    const state = makeState({
      streak: {
        current: 5,
        longest: 5,
        lastVisitDay: 1,
        totalVisitDays: 5,
        graceBanked: 2,
        graceRefilledOnDay: 1,
        rainDays: 0,
        rewardedForDay: 5,
        pendingChoices: [
          { kind: "keepsake", offers: ["welcome-sign", "moss-tuft"], forDay: 5 },
        ],
      },
    });
    const resolved = rootReducer(state, {
      type: "RESOLVE_STREAK_CHOICE",
      kind: "keepsake",
      forDay: 5,
      choiceIndex: 1,
      at: T0,
    });
    expect(resolved.keepsakes["moss-tuft"]).toBe(1);
    expect(resolved.streak.pendingChoices).toEqual([]);

    // Waits forever, but resolving twice is a no-op (already gone).
    const again = rootReducer(resolved, {
      type: "RESOLVE_STREAK_CHOICE",
      kind: "keepsake",
      forDay: 5,
      choiceIndex: 0,
      at: T0 + 1,
    });
    expect(again).toBe(resolved);
  });

  it("resolving a pending egg choice drops a real, incubating egg for the chosen biome", () => {
    const state = makeState({
      streak: {
        current: 7,
        longest: 7,
        lastVisitDay: 1,
        totalVisitDays: 7,
        graceBanked: 2,
        graceRefilledOnDay: 1,
        rainDays: 0,
        rewardedForDay: 7,
        pendingChoices: [{ kind: "basketEgg", offers: ["meadow"], forDay: 7 }],
      },
    });
    const resolved = rootReducer(state, {
      type: "RESOLVE_STREAK_CHOICE",
      kind: "basketEgg",
      forDay: 7,
      choiceIndex: 0,
      at: T0,
    });
    expect(resolved.eggs.length).toBe(1);
    expect(resolved.eggs[0]?.sourceExpeditionId).toBe("meadow");
    expect(resolved.eggs[0]?.state).toBe("incubating");
  });
});

describe("expedition mastery — increments at ACKNOWLEDGE_REVEAL, the player-witnessed trip-completed moment", () => {
  it("a pip's mastery for the completed biome increments by exactly 1 per acknowledged trip", () => {
    const pip = makePip("pip-1", {
      activity: PipActivity.Returning,
      expedition: { expeditionId: "meadow", departedAt: T0 - 1000, durationMs: 1000 },
      mastery: { meadow: 5 },
    });
    const state = makeState({
      pips: { "pip-1": pip },
      pendingReveals: [
        {
          pipId: "pip-1",
          expeditionId: "meadow",
          completedAt: T0,
          items: ["berry", "fiber"],
          egg: null,
        },
      ],
    });
    const next = rootReducer(state, { type: "ACKNOWLEDGE_REVEAL", at: T0 + 1 });
    expect(next.pips["pip-1"]?.mastery?.["meadow"]).toBe(6);
    // itemsCollected counts every item landed (2), not a flat +1.
    expect(next.counters["itemsCollected"]).toBe(2);
  });
});

describe("egg pity — wired through HATCH_EGG: guarantees the rarest tier exactly at threshold, then resets", () => {
  const meadowUncommonThreshold = contentTuning.retention.eggPity.thresholdByRarity["uncommon"]!;

  it("at threshold, the hatch is GUARANTEED uncommon (Cloudpip, the Meadow pool's only uncommon) and the counter resets", () => {
    const eggState = makeState({
      eggs: [
        {
          id: "egg-1",
          state: "pipping",
          foundAt: T0,
          rarity: "common",
          incubationMs: 1000,
          incubationStartedAt: T0,
          sourceExpeditionId: "meadow",
        },
      ],
      eggPity: { meadow: meadowUncommonThreshold },
    });
    const hatched = rootReducer(eggState, { type: "HATCH_EGG", eggId: "egg-1", at: T0 + 1 });
    expect(hatched.lastHatchOutcome?.ok).toBe(true);
    const pipId = hatched.lastHatchOutcome?.ok === true ? hatched.lastHatchOutcome.pipId : "";
    const hatchling = hatched.pips[pipId];
    expect(hatchling?.speciesId).toBe("cloudpip");
    expect(contentSpecies["cloudpip"]?.rarity).toBe("uncommon");
    expect(hatched.eggPity["meadow"]).toBe(0); // paid out — resets
  });

  it("below threshold, the counter simply increments on a miss and does not guarantee anything", () => {
    const eggState = makeState({
      eggs: [
        {
          id: "egg-1",
          state: "pipping",
          foundAt: T0,
          rarity: "common",
          incubationMs: 1000,
          incubationStartedAt: T0,
          sourceExpeditionId: "meadow",
        },
      ],
      eggPity: { meadow: meadowUncommonThreshold - 1 },
    });
    // Without the guarantee, SOME seeds will still roll uncommon by
    // chance — the only universal claim is the counter moves by exactly
    // 1 in the direction the outcome implies, never resetting except on
    // an uncommon hit.
    const hatched = rootReducer(eggState, { type: "HATCH_EGG", eggId: "egg-1", at: T0 + 1 });
    const pipId = hatched.lastHatchOutcome?.ok === true ? hatched.lastHatchOutcome.pipId : "";
    const hatchling = hatched.pips[pipId];
    const rarity = contentSpecies[hatchling!.speciesId]?.rarity;
    if (rarity === "uncommon") {
      expect(hatched.eggPity["meadow"]).toBe(0);
    } else {
      expect(hatched.eggPity["meadow"]).toBe(meadowUncommonThreshold);
    }
  });

  it("never resets on absence — only ever by paying out (no code path decays it), and SURVIVES a save/reload", () => {
    const state = makeState({ eggPity: { meadow: 5, lanterngrotto: 2 } });
    // Simulate time passing with ordinary TICKs — nothing touches eggPity
    // outside HATCH_EGG.
    const ticked = rootReducer(state, { type: "TICK", at: T0 + 100_000 });
    expect(ticked.eggPity["meadow"]).toBe(5);

    // A reload is exactly what an absent player does on return, so the
    // guarantee is asserted HERE, where it is stated — not left to a generic
    // whole-state deep-equal elsewhere whose only protection was a fixture
    // that happened to set `eggPity` (round-2C review, mutation 6: replacing
    // the validator with `eggPity: {}` failed exactly one unrelated test).
    const reloaded = fromSaveBlob(JSON.parse(JSON.stringify(toSaveBlob(ticked, T0 + 100_000))));
    expect(reloaded.ok, "the round trip must validate").toBe(true);
    const restored = reloaded.ok ? reloaded.save.state : null;
    expect(restored?.eggPity["meadow"], "a visible pity counter must survive a reload").toBe(5);
    expect(restored?.eggPity["lanterngrotto"]).toBe(2);
  });
});

describe("loot multipliers — wired end to end through TICK's expedition settlement", () => {
  it("a maxed mastery+streak+curious pip yields measurably MORE loot on average than a plain pip over many seeds", () => {
    const meadowMs = contentTuning.expeditions.meadow.durationMs;
    const topMasteryTrips = 300; // comfortably past tier 5's threshold

    const countItems = (seed: number, buffed: boolean): number => {
      const pip = makePip("pip-1", {
        personalityId: buffed ? "curious" : "lazy",
        activity: PipActivity.OnExpedition,
        expedition: { expeditionId: "meadow", departedAt: T0 - meadowMs, durationMs: meadowMs },
        mastery: buffed ? { meadow: topMasteryTrips } : {},
      });
      const state = makeState({
        seed,
        pips: { "pip-1": pip },
        streak: buffed
          ? {
              current: 30,
              longest: 30,
              lastVisitDay: 1,
              totalVisitDays: 30,
              graceBanked: 2,
              graceRefilledOnDay: 1,
              rainDays: 0,
              rewardedForDay: 30,
              pendingChoices: [],
            }
          : {
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
      });
      const ticked = rootReducer(state, { type: "TICK", at: T0 });
      return ticked.pendingReveals[0]?.items.length ?? 0;
    };

    const SEEDS = 60;
    let plainTotal = 0;
    let buffedTotal = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      plainTotal += countItems(seed, false);
      buffedTotal += countItems(seed, true);
    }
    // Baseline (Lazy, no buffs): exactly `lootRolls` items every time.
    expect(plainTotal / SEEDS).toBeCloseTo(contentTuning.expeditions.meadow.lootRolls, 1);
    // Buffed: measurably higher on average (extra bonus rolls firing).
    expect(buffedTotal).toBeGreaterThan(plainTotal);
  });

  it("the cap holds even at maximum stacking — the AVERAGE buffed yield across many trips converges to lootRolls × (1 + bonusRollChanceMax), never beyond it", () => {
    // A single trip's bonus rolls are still probabilistic (each of the 3
    // base rolls independently has a chance to fire), so any ONE trip
    // could in principle land every bonus roll — the cap bounds the
    // CHANCE, not a single trip's outcome. What the cap guarantees is the
    // EXPECTED yield over many trips, which is what this test measures.
    const meadowMs = contentTuning.expeditions.meadow.durationMs;
    const cap = contentTuning.retention.loot.bonusRollChanceMax;
    const lootRolls = contentTuning.expeditions.meadow.lootRolls;
    const expectedMax = lootRolls * (1 + cap);

    let total = 0;
    const SEEDS = 300;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const pip = makePip("pip-1", {
        personalityId: "curious",
        activity: PipActivity.OnExpedition,
        expedition: { expeditionId: "meadow", departedAt: T0 - meadowMs, durationMs: meadowMs },
        mastery: { meadow: 999 },
      });
      const state = makeState({
        seed,
        pips: { "pip-1": pip },
        streak: {
          current: 999,
          longest: 999,
          lastVisitDay: 1,
          totalVisitDays: 999,
          graceBanked: 2,
          graceRefilledOnDay: 1,
          rainDays: 0,
          rewardedForDay: 999,
          pendingChoices: [],
        },
        activeEvents: ["berry-glut"],
      });
      const ticked = rootReducer(state, { type: "TICK", at: T0 });
      total += ticked.pendingReveals[0]?.items.length ?? 0;
    }
    const average = total / SEEDS;
    // Comfortably above the unbuffed baseline (lootRolls)...
    expect(average).toBeGreaterThan(lootRolls);
    // ...but never drifting past what the CAPPED chance predicts, with a
    // generous statistical margin (this is a sampled average, not exact).
    expect(average).toBeLessThanOrEqual(expectedMax * 1.15);
  });
});

describe("the EGG-CHANCE channel — wired end to end through TICK's expedition settlement", () => {
  /**
   * Round-2C review: this whole channel was DEAD CODE. `masteryEggChanceBonusPoints`,
   * `activeEventEggChanceBonusPoints`, `effectiveEggChanceBonusPoints` and
   * `applyEggChanceBonus` had zero non-test callers, so bible §6.3's tier-5
   * reward and `lantern-nights`' `eggChanceBonusPoints` did nothing in game
   * while their unit tests gave the impression of a verified feature. These
   * tests are deliberately at the INTEGRATION level: a unit test of an
   * unwired function proves nothing about the game.
   *
   * THE SETUP IS THE POINT — and it makes these HARD proofs, not sampled ones.
   * Every run below is Curious + a tier-4 streak, which already sums the LOOT
   * channel past `bonusRollChanceMax` (0.10 + 0.20 > 0.25). Adding mastery
   * therefore cannot change the loot channel at all: both runs fire the exact
   * same bonus rolls and arrive at the egg roll on the SAME cursor, with the
   * same underlying uniform `u`. An egg is found iff `u < p`, so for a strictly
   * larger `p`:
   *
   *   - MONOTONICITY holds for every single seed (plain found ⟹ buffed found), and
   *   - at least one seed must flip (u landing in the widened band), which is
   *     what proves the bonus actually reaches the roll.
   *
   * No statistical margin, no flaky threshold.
   */
  const TOP_MASTERY_TRIPS = 999; // comfortably past the top tier's threshold

  /** Curious + a top-tier streak: the loot channel is already clamped, so
   * mastery/events can only move the EGG channel from here. */
  function cappedLootStreak(): GameState["streak"] {
    return {
      current: 30,
      longest: 30,
      lastVisitDay: 1,
      totalVisitDays: 30,
      graceBanked: 2,
      graceRefilledOnDay: 1,
      rainDays: 0,
      rewardedForDay: 30,
      pendingChoices: [],
    };
  }

  function settleTrip(opts: {
    seed: number;
    trips: number;
    expeditionId?: string;
    activeEvents?: readonly string[];
  }): GameState {
    const expeditionId = opts.expeditionId ?? "meadow";
    const durationMs = contentTuning.expeditions[expeditionId as "meadow"].durationMs;
    const pip = makePip("pip-1", {
      personalityId: "curious",
      activity: PipActivity.OnExpedition,
      expedition: { expeditionId, departedAt: T0 - durationMs, durationMs },
      mastery: { [expeditionId]: opts.trips },
    });
    return rootReducer(
      makeState({
        seed: opts.seed,
        keep: { level: 3, placements: {} }, // every biome unlocked
        pips: { "pip-1": pip },
        streak: cappedLootStreak(),
        activeEvents: opts.activeEvents ?? [],
      }),
      { type: "TICK", at: T0 },
    );
  }

  const SEEDS = 300;
  const eggSeeds = (opts: Omit<Parameters<typeof settleTrip>[0], "seed">): readonly number[] => {
    const found: number[] = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      if (settleTrip({ ...opts, seed }).pendingReveals[0]?.egg != null) found.push(seed);
    }
    return found;
  };

  it("the loot channel really is clamped in this setup (the premise every proof below rests on)", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const plain = settleTrip({ seed, trips: 0 });
      const mastered = settleTrip({ seed, trips: TOP_MASTERY_TRIPS });
      expect(mastered.pendingReveals[0]?.items, `seed ${seed}`).toEqual(
        plain.pendingReveals[0]?.items,
      );
    }
  });

  it("mastery's top tier strictly WIDENS the egg band — every plain find is still a find, and some new ones appear", () => {
    const plain = eggSeeds({ trips: 0 });
    const mastered = eggSeeds({ trips: TOP_MASTERY_TRIPS });
    expect(plain.length, "the baseline must find SOME eggs for this to compare").toBeGreaterThan(0);
    for (const seed of plain) {
      expect(mastered, `seed ${seed} found an egg WITHOUT mastery but not with it`).toContain(seed);
    }
    expect(
      mastered.length,
      "bible §6.3's tier-5 egg bonus must actually reach the roll",
    ).toBeGreaterThan(plain.length);
  });

  it("an event's eggChanceBonusPoints reaches the roll too (lantern-nights on the Lanterngrotto)", () => {
    const quiet = eggSeeds({ trips: 0, expeditionId: "lanterngrotto" });
    const lit = eggSeeds({
      trips: 0,
      expeditionId: "lanterngrotto",
      activeEvents: ["lantern-nights"],
    });
    for (const seed of quiet) {
      expect(lit, `seed ${seed} regressed under an event — events may only ADD`).toContain(seed);
    }
    expect(lit.length).toBeGreaterThan(quiet.length);
  });

  it("mastery BELOW the top tier changes nothing at all (a ceiling reward, not a per-tier ramp)", () => {
    const meadowMs = contentTuning.expeditions.meadow.durationMs;
    const NEARLY_TOP_TRIPS = 200; // tier 4 on the Meadow, one short of the top
    expect(masteryTier(NEARLY_TOP_TRIPS, meadowMs, contentTuning)).toBe(
      masteryTier(TOP_MASTERY_TRIPS, meadowMs, contentTuning) - 1,
    );
    expect(eggSeeds({ trips: NEARLY_TOP_TRIPS })).toEqual(eggSeeds({ trips: 0 }));
  });

  it("CURSOR PARITY: the bonus never consumes an extra roll — rngState is identical with and without it", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const plain = settleTrip({ seed, trips: 0 });
      const mastered = settleTrip({ seed, trips: TOP_MASTERY_TRIPS });
      expect(mastered.rngState, `seed ${seed}`).toEqual(plain.rngState);
    }
  });

  it("the resulting chance can never reach certainty — eggChanceCeiling holds at maximum stacking", () => {
    const stacked = eggSeeds({
      trips: TOP_MASTERY_TRIPS,
      expeditionId: "lanterngrotto", // the highest base eggChance in the game
      activeEvents: ["lantern-nights"],
    });
    expect(stacked.length, "a boosted biome is still never a guarantee").toBeLessThan(SEEDS);
    const ceiling = contentTuning.retention.loot.eggChanceCeiling;
    expect(stacked.length / SEEDS).toBeLessThanOrEqual(ceiling + 0.1); // sampled, generous margin
  });
});

describe("a full session smoke test: createNewGame plus a handful of dispatches never throws and stays internally consistent", () => {
  it("plays a few real actions without crashing, and progression fields stay well-formed", () => {
    let state = createNewGame(SEED, T0);
    state = rootReducer(state, { type: "FEED", pipId: state.activePipId, foodId: "berry", at: T0 });
    state = rootReducer(state, { type: "CLEAN", pipId: state.activePipId, at: T0 + 1 });
    state = rootReducer(state, { type: "REFRESH_BOUNTIES", at: T0 + 2 });
    state = rootReducer(state, { type: "CLAIM_STREAK_REWARD", at: T0 + 3 });
    expect(state.streak.current).toBeGreaterThanOrEqual(1);
    expect(state.counters["careActions"]).toBeGreaterThanOrEqual(2);
    expect(Number.isFinite(state.streak.longest)).toBe(true);
    expect(Array.isArray(state.bounties.slots)).toBe(true);
  });
});
