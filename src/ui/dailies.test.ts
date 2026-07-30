/**
 * Dailies pure-model tests (docs/retention-bible.md §3/§4/§5): streak copy
 * selection incl. the break/welcome-back case, bounty progress math,
 * milestone claimability, and the celebration/toast diffing. DOM is
 * untested chrome (same convention as focusView.test.ts/debugMenu.test.ts).
 */

import { describe, expect, it } from "vitest";
import { tuning } from "../content/tuning";
import { LifeStage, PipActivity } from "../core/pips/types";
import type { PipNeeds, PipState } from "../core/pips/types";
import type { GameState } from "../core/state";
import type { BountyInstance } from "../core/progression/bounties";
import { bountyCompleteXp, bountyDayClearXp, streakDayXp } from "../core/progression/xp";
import { effectiveStreakTier } from "../core/progression/streak";
import {
  bountiesClearedToday,
  bountyDayClearXpAmount,
  detectBountyDayClearCelebration,
  buildBountyCards,
  buildMilestoneRows,
  buildStreakModel,
  dailyBadgeCount,
  unbankedMilestoneIds,
  detectBountyCelebrations,
  detectMilestoneCelebrations,
  detectRainDayToast,
  detectStreakRewardToast,
  formatLadderReward,
  formatMilestoneReward,
  formatRewardBundle,
  streakHeadline,
} from "./dailies";

const needs = (overrides: Partial<PipNeeds> = {}): PipNeeds => ({
  hunger: 80,
  cleanliness: 80,
  happiness: 80,
  energy: 80,
  ...overrides,
});

function makePip(overrides: Partial<PipState> = {}): PipState {
  return {
    id: "pip-1",
    speciesId: "mosspip",
    name: "Mosspip",
    genome: {
      speciesId: "mosspip",
      palette: "fern",
      pattern: "plain",
      accessorySlots: 1,
      personalityId: "curious",
      shiny: false,
    },
    personalityId: "curious",
    lifeStage: LifeStage.Adult,
    hatchedAt: 0,
    ageMs: 0,
    happinessIntegral: 0,
    needs: needs(),
    activity: PipActivity.Idle,
    pendingSulk: false,
    readyToEvolve: false,
    evolved: null,
    lastGiftItemId: null,
    expedition: null,
    needsUpdatedAt: 0,
    ...overrides,
  };
}

function baseState(overrides: Partial<GameState> = {}): GameState {
  const pip = makePip();
  return {
    pips: { [pip.id]: pip },
    rosterOrder: [pip.id],
    activePipId: pip.id,
    inventory: {},
    resources: {},
    rngState: {},
    seed: 42,
    keep: { level: 1, placements: {} },
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
    lastTickAt: 0,
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
    ...overrides,
  } as GameState;
}

function bounty(overrides: Partial<BountyInstance>): BountyInstance {
  return {
    templateId: "hand-out-snacks",
    slot: 0,
    target: 4,
    progress: 0,
    completedAt: null,
    rerolled: false,
    params: {},
    stale: false,
    ...overrides,
  };
}

describe("formatRewardBundle", () => {
  it("joins resources and items with friendly names", () => {
    expect(formatRewardBundle({ resources: { fiber: 3 }, items: { berry: 2 } })).toBe(
      "3 Fiber + 2 Berry",
    );
  });

  it("falls back warmly for an empty bundle", () => {
    expect(formatRewardBundle({})).toBe("a little something");
  });

  it("drops zero/negative entries", () => {
    expect(formatRewardBundle({ resources: { fiber: 0, wood: 2 } })).toBe("2 Wood");
  });
});

describe("formatMilestoneReward", () => {
  it("formats every reward kind", () => {
    expect(formatMilestoneReward({ kind: "resources", bundle: { fiber: 2 } })).toContain("Fiber");
    expect(formatMilestoneReward({ kind: "items", items: { berry: 2 } })).toContain("Berry");
    // Flair reads the real registry now (round-2C review: the label used to
    // humanize the raw id and promise "a flourish for the Album" for rewards
    // that were granted nowhere and drawn nowhere).
    const flairLabel = formatMilestoneReward({
      kind: "flair",
      flairId: "album-week-ribbon",
    });
    expect(flairLabel).toContain("Week Ribbon");
    expect(flairLabel, "must say WHERE the flourish shows").toContain("Album's cover");
    expect(formatMilestoneReward({ kind: "none" })).toBeTypeOf("string");
  });

  it("names a keepsake decoration when it exists in the registry", () => {
    expect(formatMilestoneReward({ kind: "keepsake", decorationId: "moss-tuft" })).toContain(
      "Moss Tuft",
    );
  });
});

describe("formatLadderReward", () => {
  it("describes grant/keepsakeChoice/eggChoice distinctly", () => {
    expect(formatLadderReward({ kind: "grant", items: { berry: 2 } })).toContain("Berry");
    expect(formatLadderReward({ kind: "keepsakeChoice", offers: [] })).toMatch(/keepsake/i);
    expect(formatLadderReward({ kind: "eggChoice", offers: [] })).toMatch(/egg/i);
  });
});

describe("streakHeadline — warm copy, never guilt (bible §3.4/§10.2)", () => {
  it("invites a first visit at zero", () => {
    expect(streakHeadline(
      { current: 0, longest: 0, lastVisitDay: null, totalVisitDays: 0, graceBanked: 2, graceRefilledOnDay: null, rainDays: 0, rewardedForDay: null, pendingChoices: [] },
      tuning,
    )).toMatch(/say hello/i);
  });

  it("plain day 1 with no prior streak reads as a beginning, not a reset", () => {
    const headline = streakHeadline(
      { current: 1, longest: 1, lastVisitDay: 5, totalVisitDays: 1, graceBanked: 2, graceRefilledOnDay: 5, rainDays: 0, rewardedForDay: null, pendingChoices: [] },
      tuning,
    );
    expect(headline).toMatch(/day 1/i);
    expect(headline).not.toMatch(/lost|broke|fail/i);
  });

  it("a restart after a longest ≥ 7 streak credits the welcome-back tier, never shames the break", () => {
    const headline = streakHeadline(
      { current: 1, longest: 9, lastVisitDay: 40, totalVisitDays: 20, graceBanked: 2, graceRefilledOnDay: 40, rainDays: 3, rewardedForDay: null, pendingChoices: [] },
      tuning,
    );
    expect(headline).toMatch(/fresh start/i);
    expect(headline).toMatch(/tier/i);
    expect(headline).not.toMatch(/lost|broke|fail|streak.{0,20}(gone|reset)/i);
  });

  it("an ordinary multi-day streak just counts up", () => {
    expect(streakHeadline(
      { current: 12, longest: 12, lastVisitDay: 5, totalVisitDays: 12, graceBanked: 2, graceRefilledOnDay: 5, rainDays: 0, rewardedForDay: null, pendingChoices: [] },
      tuning,
    )).toBe("Day 12 in a row.");
  });
});

describe("buildStreakModel", () => {
  it("computes tier, next-tier distance and a level-aware reward preview", () => {
    const state = baseState({
      streak: {
        current: 2,
        longest: 2,
        lastVisitDay: 5,
        totalVisitDays: 2,
        graceBanked: 2,
        graceRefilledOnDay: 5,
        rainDays: 0,
        rewardedForDay: null,
        pendingChoices: [],
      },
    });
    const model = buildStreakModel(state);
    expect(model.current).toBe(2);
    expect(model.tier).toBe(0); // tier 1 needs day 3 (tierMinStreakDay)
    expect(model.nextTierIn).toBe(1);
    expect(model.ladderDay).toBe(2);
    expect(model.welcomeBackActive).toBe(false);
    expect(model.todaysRewardLabel).toBeTypeOf("string");
  });

  it("surfaces pending choices with human-readable offer labels", () => {
    const state = baseState({
      streak: {
        current: 5,
        longest: 5,
        lastVisitDay: 5,
        totalVisitDays: 5,
        graceBanked: 2,
        graceRefilledOnDay: 5,
        rainDays: 0,
        rewardedForDay: 5,
        pendingChoices: [{ kind: "keepsake", offers: ["moss-tuft"], forDay: 5 }],
      },
    });
    const model = buildStreakModel(state);
    expect(model.pendingChoices).toHaveLength(1);
    expect(model.pendingChoices[0]?.offers[0]?.label).toBe("Moss Tuft");
  });

  it("caps nextTierIn at null once the top tier is reached", () => {
    const state = baseState({
      streak: {
        current: 30,
        longest: 30,
        lastVisitDay: 5,
        totalVisitDays: 30,
        graceBanked: 2,
        graceRefilledOnDay: 5,
        rainDays: 0,
        rewardedForDay: null,
        pendingChoices: [],
      },
    });
    expect(buildStreakModel(state).nextTierIn).toBeNull();
  });
});

describe("detectRainDayToast (bible §3.4 — reported once, after the fact)", () => {
  it("is silent when rainDays hasn't moved", () => {
    const s = baseState();
    expect(detectRainDayToast(s, s)).toBeNull();
  });

  it("reports warmly, with the remaining grace count, when a rain day was just spent", () => {
    const prev = baseState({
      streak: { current: 3, longest: 5, lastVisitDay: 10, totalVisitDays: 5, graceBanked: 2, graceRefilledOnDay: 10, rainDays: 0, rewardedForDay: null, pendingChoices: [] },
    });
    const next = baseState({
      streak: { current: 4, longest: 5, lastVisitDay: 12, totalVisitDays: 6, graceBanked: 1, graceRefilledOnDay: 10, rainDays: 1, rewardedForDay: null, pendingChoices: [] },
    });
    const toast = detectRainDayToast(prev, next);
    expect(toast).toMatch(/quiet day/i);
    // Spelled in WORDS, and framed as what's IN the bank rather than what's
    // left of it — bible §3.4: grace is "not displayable as a dwindling
    // resource" (the bible's own example line spells it "One", too).
    expect(toast).toMatch(/one rain day still in the bank/i);
    expect(toast).not.toMatch(/\d/);
    expect(toast).not.toMatch(/lost|missed you|sorry/i);
  });

  it("says nothing about a count when the bank is empty — never '0 rain days left'", () => {
    const prev = baseState({
      streak: { current: 3, longest: 5, lastVisitDay: 10, totalVisitDays: 5, graceBanked: 1, graceRefilledOnDay: 10, rainDays: 0, rewardedForDay: null, pendingChoices: [] },
    });
    const next = baseState({
      streak: { current: 4, longest: 5, lastVisitDay: 12, totalVisitDays: 6, graceBanked: 0, graceRefilledOnDay: 10, rainDays: 1, rewardedForDay: null, pendingChoices: [] },
    });
    const toast = detectRainDayToast(prev, next);
    expect(toast).toMatch(/quiet day/i);
    expect(toast).toMatch(/refill on their own/i);
    expect(toast).not.toMatch(/\bleft\b/i);
    expect(toast).not.toMatch(/\d/);
  });
});

describe("detectStreakRewardToast", () => {
  it("fires once when a plain grant auto-banks", () => {
    const prev = baseState({
      streak: { current: 1, longest: 1, lastVisitDay: 5, totalVisitDays: 1, graceBanked: 2, graceRefilledOnDay: 5, rainDays: 0, rewardedForDay: null, pendingChoices: [] },
    });
    const next = baseState({
      streak: { current: 1, longest: 1, lastVisitDay: 5, totalVisitDays: 1, graceBanked: 2, graceRefilledOnDay: 5, rainDays: 0, rewardedForDay: 1, pendingChoices: [] },
    });
    const toast = detectStreakRewardToast(prev, next);
    expect(toast).toMatch(/day 1/i);
    // ROUND 2G: the day's Keep XP is named too (progression-bible.md §1.3
    // row 27) — it used to be silent, visible only as the bar's generic
    // `+N` flight chip.
    expect(toast).toMatch(/\+\d+ XP/);
  });

  // ROUND 2G: a choice-kind reward day still pays the day's Keep XP the
  // instant `rewardedForDay` advances (`core/state.ts`'s CLAIM_STREAK_REWARD
  // arm keys the grant off `rewardedForDay` alone, never off `reward.kind`)
  // — so this toast now names that XP instead of staying fully silent. The
  // picker card still handles the CHOICE itself; only the payout's XP half
  // gets a toast here.
  it("names the XP on a choice-kind reward day, but never the reward itself (the picker handles that)", () => {
    const prev = baseState({
      streak: { current: 5, longest: 5, lastVisitDay: 5, totalVisitDays: 5, graceBanked: 2, graceRefilledOnDay: 5, rainDays: 0, rewardedForDay: null, pendingChoices: [] },
    });
    const next = baseState({
      streak: { current: 5, longest: 5, lastVisitDay: 5, totalVisitDays: 5, graceBanked: 2, graceRefilledOnDay: 5, rainDays: 0, rewardedForDay: 5, pendingChoices: [{ kind: "keepsake", offers: ["moss-tuft"], forDay: 5 }] },
    });
    const toast = detectStreakRewardToast(prev, next);
    expect(toast).toMatch(/day 5/i);
    expect(toast).toMatch(/\+\d+ XP/);
    expect(toast).not.toMatch(/keepsake|moss tuft/i);
  });

  it("does not re-fire on a repeat sync for the same already-rewarded day", () => {
    const state = baseState({
      streak: { current: 1, longest: 1, lastVisitDay: 5, totalVisitDays: 1, graceBanked: 2, graceRefilledOnDay: 5, rainDays: 0, rewardedForDay: 1, pendingChoices: [] },
    });
    expect(detectStreakRewardToast(state, state)).toBeNull();
  });
});

describe("buildBountyCards", () => {
  it("computes progress percentage and completion", () => {
    const state = baseState({
      bounties: {
        day: 3,
        slots: [bounty({ slot: 0, progress: 2, target: 4 })],
        rerollsUsed: 0,
        dayBonusGranted: false,
      },
    });
    const [card] = buildBountyCards(state);
    expect(card?.progress).toBe(2);
    expect(card?.target).toBe(4);
    expect(card?.pct).toBeCloseTo(0.5);
    expect(card?.complete).toBe(false);
    expect(card?.canReroll).toBe(true);
  });

  it("a completed bounty cannot be rerolled and clamps progress at target", () => {
    const state = baseState({
      bounties: {
        day: 3,
        slots: [bounty({ slot: 0, progress: 6, target: 4, completedAt: 100 })],
        rerollsUsed: 0,
        dayBonusGranted: false,
      },
    });
    const [card] = buildBountyCards(state);
    expect(card?.progress).toBe(4);
    expect(card?.pct).toBe(1);
    expect(card?.complete).toBe(true);
    expect(card?.canReroll).toBe(false);
  });

  it("honours the spent reroll budget", () => {
    const state = baseState({
      bounties: {
        day: 3,
        slots: [bounty({ slot: 0 })],
        rerollsUsed: tuning.retention.bounties.freeRerollsPerDay,
        dayBonusGranted: false,
      },
    });
    expect(buildBountyCards(state)[0]?.canReroll).toBe(false);
  });

  it("bountiesClearedToday reads the day-bonus flag", () => {
    expect(bountiesClearedToday(baseState({ bounties: { day: 1, slots: [], rerollsUsed: 0, dayBonusGranted: true } }))).toBe(true);
  });
});

describe("detectBountyCelebrations", () => {
  it("fires only for a slot that JUST completed", () => {
    const prev = baseState({
      bounties: { day: 3, slots: [bounty({ slot: 0, progress: 3, target: 4 })], rerollsUsed: 0, dayBonusGranted: false },
    });
    const next = baseState({
      bounties: { day: 3, slots: [bounty({ slot: 0, progress: 4, target: 4, completedAt: 200 })], rerollsUsed: 0, dayBonusGranted: false },
    });
    const fired = detectBountyCelebrations(prev, next);
    expect(fired).toHaveLength(1);
    expect(fired[0]?.slot).toBe(0);
  });

  it("does not re-fire for an already-complete slot", () => {
    const state = baseState({
      bounties: { day: 3, slots: [bounty({ slot: 0, progress: 4, target: 4, completedAt: 200 })], rerollsUsed: 0, dayBonusGranted: true },
    });
    expect(detectBountyCelebrations(state, state)).toHaveLength(0);
  });

  it("a fresh day boundary never reads as a celebration", () => {
    const prev = baseState({
      bounties: { day: 3, slots: [bounty({ slot: 0, progress: 4, target: 4, completedAt: 200 })], rerollsUsed: 0, dayBonusGranted: true },
    });
    const next = baseState({
      bounties: { day: 4, slots: [bounty({ slot: 0, templateId: "freshen-everyone", progress: 0, target: 3 })], rerollsUsed: 0, dayBonusGranted: false },
    });
    expect(detectBountyCelebrations(prev, next)).toHaveLength(0);
  });
});

describe("buildMilestoneRows", () => {
  it("marks a met-but-unclaimed milestone as claimable, with progress", () => {
    const state = baseState({ counters: { feeds: 1 } });
    const rows = buildMilestoneRows(state);
    const firstFeed = rows.find((r) => r.id === "first-feed");
    expect(firstFeed?.status).toBe("claimable");
    expect(firstFeed?.progressCurrent).toBe(1);
    expect(firstFeed?.progressTarget).toBe(1);
  });

  it("marks an earned milestone as earned even if the metric would still pass", () => {
    const state = baseState({
      counters: { feeds: 1 },
      milestones: { earned: { "first-feed": 10 }, pendingCelebrations: [] },
    });
    const row = buildMilestoneRows(state).find((r) => r.id === "first-feed");
    expect(row?.status).toBe("earned");
  });

  it("a not-yet-met milestone is locked, with partial progress", () => {
    const state = baseState({ counters: { careActions: 3 } });
    const row = buildMilestoneRows(state).find((r) => r.id === "ten-care-actions");
    expect(row?.status).toBe("locked");
    expect(row?.progressCurrent).toBe(3);
    expect(row?.progressTarget).toBe(10);
  });

  it("omits an unearned hidden milestone entirely (a surprise, not a checklist chore)", () => {
    const state = baseState();
    expect(buildMilestoneRows(state).some((r) => r.id === "first-glimmer")).toBe(false);
  });

  it("shows a hidden milestone once it IS earned", () => {
    const state = baseState({
      milestones: { earned: { "first-glimmer": 10 }, pendingCelebrations: [] },
    });
    expect(buildMilestoneRows(state).some((r) => r.id === "first-glimmer")).toBe(true);
  });
});

describe("detectMilestoneCelebrations", () => {
  it("fires only for a milestone that just crossed its threshold", () => {
    const prev = baseState({ counters: { feeds: 0 } });
    const next = baseState({ counters: { feeds: 1 } });
    const fired = detectMilestoneCelebrations(prev, next);
    expect(fired.some((r) => r.id === "first-feed")).toBe(true);
  });

  it("does not re-fire once already earned", () => {
    const state = baseState({
      counters: { feeds: 1 },
      milestones: { earned: { "first-feed": 10 }, pendingCelebrations: [] },
    });
    expect(detectMilestoneCelebrations(state, state)).toHaveLength(0);
  });
});

describe("dailyBadgeCount", () => {
  it("counts ONLY choices waiting on the player's taste — never milestones (they auto-bank)", () => {
    const state = baseState({
      // `first-feed` is earned-but-unbanked here; it must NOT show up as a
      // badge (round-2C review: the badge was a chore counter, and bible §0.2
      // says non-choice rewards auto-bank so "there is nothing to forget").
      counters: { feeds: 1 },
      streak: {
        current: 5,
        longest: 5,
        lastVisitDay: 5,
        totalVisitDays: 5,
        graceBanked: 2,
        graceRefilledOnDay: 5,
        rainDays: 0,
        rewardedForDay: 5,
        pendingChoices: [{ kind: "keepsake", offers: ["moss-tuft"], forDay: 5 }],
      },
    });
    expect(unbankedMilestoneIds(state), "the milestone IS earned").toContain("first-feed");
    expect(dailyBadgeCount(state)).toBe(1); // the keepsake choice, and nothing else
  });

  it("a first hour full of milestones and no waiting choices shows NO badge at all", () => {
    // The exact regression: a new player clears ~7 first-hour milestones and
    // used to be met by a standing "7" plus seven Claim taps.
    const state = baseState({
      counters: { feeds: 1, careActions: 10, expeditionsTotal: 5, eggsHatched: 1, naps: 1 },
    });
    expect(unbankedMilestoneIds(state).length).toBeGreaterThan(2);
    expect(dailyBadgeCount(state)).toBe(0);
  });

  it("is zero on a fresh save", () => {
    expect(dailyBadgeCount(baseState())).toBe(0);
  });
});

/**
 * ROUND 2G REVIEW — the round's four new XP-copy surfaces, none of which had
 * a single assertion: `BountyCardModel.xpReward`, `StreakDisplayModel.rewardXp`,
 * `bountyDayClearXpAmount` and `detectBountyDayClearCelebration`. All four are
 * rendered (the bounty card's "Banked: +15 XP · …", the ladder line, the
 * day-clear banner, and a brand-new toast-plus-confetti-plus-sound
 * celebration), and the day-clear detector in particular is the same detector
 * CLASS as `detectBountyCelebrations` and `detectStreakRewardToast`, both of
 * which are tested here.
 *
 * The values were verified correct by inspection at review time — each calls
 * the same `bountyCompleteXp`/`bountyDayClearXp`/`streakDayXp` that
 * `core/state.ts` sums into `keepXp`. So this is a coverage gap rather than a
 * wrong number, and these tests exist to keep it that way: they assert the UI
 * figures ARE the reducer's figures, not that they equal some literal a
 * retune would have to chase.
 */
describe("the XP the dailies surfaces promise is the XP the reducer grants", () => {
  it("a bounty card's xpReward is bountyCompleteXp, not a hand-typed number", () => {
    const state = baseState({
      bounties: {
        day: 1,
        slots: [bounty({ slot: 0, progress: 2, target: 4 })],
        rerollsUsed: 0,
        dayBonusGranted: false,
      },
    });
    const [card] = buildBountyCards(state);
    expect(card?.xpReward).toBe(bountyCompleteXp(1, tuning));
    expect(card?.xpReward).toBeGreaterThan(0);
  });

  it("the streak ladder's rewardXp is streakDayXp at the EFFECTIVE tier, not the ladder day", () => {
    const state = baseState({
      streak: {
        current: 5,
        longest: 5,
        lastVisitDay: 5,
        totalVisitDays: 5,
        graceBanked: 2,
        graceRefilledOnDay: 5,
        rainDays: 0,
        rewardedForDay: 5,
        pendingChoices: [],
      },
    });
    const model = buildStreakModel(state, tuning);
    // `effectiveStreakTier` — the SAME argument core/state.ts's reducer sums
    // into `keepXp`. The ladder day is a different number (it cycles), and
    // reading it here would have the card promise one figure while the bar
    // moved by another.
    expect(model.rewardXp).toBe(streakDayXp(effectiveStreakTier(state.streak, tuning), tuning));
    expect(model.rewardXp).toBe(streakDayXp(model.tier, tuning));
    expect(model.rewardXp).toBeGreaterThan(0);
  });

  it("bountyDayClearXpAmount is bountyDayClearXp, and is worth more than one bounty", () => {
    expect(bountyDayClearXpAmount(tuning)).toBe(bountyDayClearXp(1, tuning));
    expect(bountyDayClearXpAmount(tuning)).toBeGreaterThan(bountyCompleteXp(1, tuning));
  });
});

describe("detectBountyDayClearCelebration — fires on the edge, exactly once", () => {
  const withBonus = (dayBonusGranted: boolean): GameState =>
    baseState({
      bounties: { day: 1, slots: [], rerollsUsed: 0, dayBonusGranted },
    });

  it("fires on the false → true edge", () => {
    expect(detectBountyDayClearCelebration(withBonus(false), withBonus(true))).toBe(true);
  });

  it("does NOT fire on a repeat sync once the bonus is already granted", () => {
    // The failure mode this guards: the celebration is a toast plus confetti
    // plus a sound, driven off a subscription that runs on every tick.
    expect(detectBountyDayClearCelebration(withBonus(true), withBonus(true))).toBe(false);
  });

  it("does not fire while the day is still unfinished, or when a new day resets the flag", () => {
    expect(detectBountyDayClearCelebration(withBonus(false), withBonus(false))).toBe(false);
    expect(detectBountyDayClearCelebration(withBonus(true), withBonus(false))).toBe(false);
  });
});
