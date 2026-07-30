/**
 * The Doorstep — pure model tests (docs/retention-bible.md §10, the
 * round's headline UX). Covers: the inherited "no Doorstep under 3
 * minutes" contract, section presence/omission, and the one-nudge
 * priority chain (pipping egg > ready-to-evolve > pity > Album >
 * milestone > none — exactly one, ever). DOM is untested chrome, same
 * convention as awaySheet.test.ts.
 */

import { describe, expect, it } from "vitest";
import { MINUTE_MS, tuning } from "../content/tuning";
import { EggState } from "../core/eggs";
import { LifeStage, PipActivity } from "../core/pips/types";
import type { PipNeeds, PipState } from "../core/pips/types";
import type { CatchupSummary } from "../core/pips/catchup";
import type { GameState } from "../core/state";
import type { BountyInstance } from "../core/progression/bounties";
import { deriveDoorstepModel, isTrivialAbsence, pickNudge } from "./welcome";
import { MILESTONES } from "../content/milestones";

/** `dayOffsetMs` is 0 in every fixture here, so a timestamp inside day N is
 * simply `N * dayMs`. `SAME_DAY` lands the Doorstep on the day the fixture
 * streaks already visited (delta 0 → the projection is a no-op); `NEXT_DAY`
 * and `LONG_GAP` exercise the ordinary advance and the past-grace restart. */
const DAY_MS = tuning.retention.dayMs;
const SAME_DAY = 5 * DAY_MS + 60_000;
const NEXT_DAY = 6 * DAY_MS + 60_000;
const LONG_GAP = 40 * DAY_MS + 60_000;

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
  const pip = overrides.pips === undefined ? makePip() : undefined;
  return {
    pips: pip !== undefined ? { [pip.id]: pip } : {},
    rosterOrder: pip !== undefined ? [pip.id] : [],
    activePipId: pip?.id ?? "pip-1",
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
    flair: {},
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

function summary(elapsedMs: number): CatchupSummary {
  return { elapsedMs, ratedMs: elapsedMs, cappedMs: 0, events: [], pips: [] };
}

describe("deriveDoorstepModel — the 3-minute floor is inherited, not reimplemented", () => {
  it("is null under AWAY_SHEET_MIN_ELAPSED_MS, same as the plain away sheet", () => {
    expect(deriveDoorstepModel(summary(30_000), baseState(), SAME_DAY)).toBeNull();
  });

  it("is non-null once the absence is meaningful", () => {
    expect(deriveDoorstepModel(summary(10 * MINUTE_MS), baseState(), SAME_DAY)).not.toBeNull();
  });
});

describe("deriveDoorstepModel — section presence (bible §10.2)", () => {
  it("greets a never-visited save with day 1 rather than a blank section (the projection knows today counts)", () => {
    const model = deriveDoorstepModel(summary(10 * MINUTE_MS), baseState(), SAME_DAY);
    expect(model?.streakLine).toMatch(/day 1/i);
    expect(model?.welcomeBackLine, "nothing lapsed — nothing to reassure about").toBeNull();
  });

  it("shows the streak headline once a streak exists", () => {
    const state = baseState({
      streak: {
        current: 3,
        longest: 3,
        lastVisitDay: 5,
        totalVisitDays: 3,
        graceBanked: 2,
        graceRefilledOnDay: 5,
        rainDays: 0,
        rewardedForDay: 3,
        pendingChoices: [],
      },
    });
    const model = deriveDoorstepModel(summary(10 * MINUTE_MS), state, SAME_DAY);
    expect(model?.streakLine).toMatch(/day 3/i);
    expect(model?.bannerRewardLine).toMatch(/today/i);
  });

  it("suppresses the reward banner while a choice is still pending (it gets its own picker)", () => {
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
    const model = deriveDoorstepModel(summary(10 * MINUTE_MS), state, SAME_DAY);
    expect(model?.bannerRewardLine).toBeNull();
  });

  it("renders today's bounties as a clockless checklist", () => {
    const state = baseState({
      bounties: {
        day: 1,
        slots: [
          bounty({ slot: 0, progress: 4, target: 4, completedAt: 10 }),
          bounty({ slot: 1, templateId: "freshen-everyone", progress: 1, target: 3 }),
        ],
        rerollsUsed: 0,
        dayBonusGranted: false,
      },
    });
    const model = deriveDoorstepModel(summary(10 * MINUTE_MS), state, SAME_DAY);
    expect(model?.bountyLines).toEqual([
      "✓ Hand out four snacks",
      "1/3 Freshen everyone up",
    ]);
    // No clock anywhere in the checklist (bible §5.4 "no clock").
    expect(model?.bountyLines.join(" ")).not.toMatch(/\d+:\d+|hour|minute|expires?/i);
  });

  it("omits the bounty section when nothing has generated yet", () => {
    const model = deriveDoorstepModel(summary(10 * MINUTE_MS), baseState(), SAME_DAY);
    expect(model?.bountyLines).toEqual([]);
  });
});

/**
 * ROUND-2C REVIEW FIX. The Doorstep used to read `state.streak` raw, so it
 * painted a streak that had already lapsed and the first tap then reset it in
 * silence — `detectRainDayToast` only fires when `rainDays` increases, and a
 * past-grace reset increments nothing, so the exact moment bible §3.4/§10.2
 * was written for never fired. These tests pin the projection.
 */
describe("deriveDoorstepModel — the streak section is projected to NOW, never stale", () => {
  const streakOnDay5 = (overrides: Partial<GameState["streak"]> = {}): GameState["streak"] => ({
    current: 6,
    longest: 6,
    lastVisitDay: 5,
    totalVisitDays: 6,
    graceBanked: 2,
    graceRefilledOnDay: 5,
    rainDays: 0,
    rewardedForDay: 6,
    pendingChoices: [],
    ...overrides,
  });

  it("an overnight return reads DAY 7, not the day 6 sitting in the save", () => {
    const state = baseState({ streak: streakOnDay5() });
    const model = deriveDoorstepModel(summary(10 * 60 * MINUTE_MS), state, NEXT_DAY);
    expect(model?.streakLine).toMatch(/day 7/i);
    expect(model?.streakLine).not.toMatch(/day 6/i);
    expect(model?.welcomeBackLine).toBeNull();
  });

  it("a fortnight away is greeted with a FRESH START and the welcome-back tier, never with the streak they no longer have", () => {
    const state = baseState({ streak: streakOnDay5({ current: 6, longest: 9 }) });
    const model = deriveDoorstepModel(summary(14 * 24 * 60 * MINUTE_MS), state, LONG_GAP);
    // Not "Day 6 in a row." — the thing the player would have been shown, and
    // then silently billed for, before this fix.
    expect(model?.streakLine).not.toMatch(/day 6/i);
    expect(model?.streakLine).toMatch(/fresh start/i);
    // longest 9 ≥ welcomeBackLongestRequired, so the tier floor applies and the
    // headline says so — "strictly better off than a brand-new player".
    expect(model?.streakLine).toMatch(/tier/i);
    // …and the reassurance fires, which is the whole point of the moment.
    expect(model?.welcomeBackLine).toMatch(/exactly where you left it/i);
    expect(model?.welcomeBackLine).toMatch(/only the bonus/i);
  });

  it("a lapse whose longest never reached the welcome-back bar still gets the reassurance, warmly", () => {
    const state = baseState({ streak: streakOnDay5({ current: 3, longest: 3 }) });
    const model = deriveDoorstepModel(summary(14 * 24 * 60 * MINUTE_MS), state, LONG_GAP);
    expect(model?.streakLine).toMatch(/day 1/i);
    expect(model?.welcomeBackLine).not.toBeNull();
  });

  it("a gap grace absorbs is NOT a lapse — the streak survives and nothing apologises for it", () => {
    const state = baseState({ streak: streakOnDay5() });
    // One missed day: grace (2 banked) covers it, so `current` goes 6 → 7.
    const model = deriveDoorstepModel(
      summary(2 * 24 * 60 * MINUTE_MS),
      state,
      7 * DAY_MS + 60_000,
    );
    expect(model?.streakLine).toMatch(/day 7/i);
    expect(model?.welcomeBackLine).toBeNull();
  });

  it("never mentions rain days (detectRainDayToast reports those after the fact, once — bible §3.4)", () => {
    const state = baseState({ streak: streakOnDay5() });
    const model = deriveDoorstepModel(
      summary(2 * 24 * 60 * MINUTE_MS),
      state,
      7 * DAY_MS + 60_000,
    );
    const all = [model?.streakLine, model?.welcomeBackLine, model?.bannerRewardLine].join(" ");
    expect(all).not.toMatch(/rain day/i);
  });

  it("carries NO urgency or guilt anywhere in the lapsed copy (bible §0.3)", () => {
    const state = baseState({ streak: streakOnDay5({ longest: 9 }) });
    const model = deriveDoorstepModel(summary(14 * 24 * 60 * MINUTE_MS), state, LONG_GAP);
    const all = [model?.streakLine, model?.welcomeBackLine, model?.bannerRewardLine].join(" ");
    expect(all).not.toMatch(
      /missed you|don't lose|streak (lost|at risk)|hurry|last chance|expires? in|only \d+ (hours?|days?) left/i,
    );
  });
});

describe("pickNudge — exactly one, by priority (bible §10.2 row 6)", () => {
  it("a pipping egg outranks everything else", () => {
    const state = baseState({
      eggs: [
        {
          id: "egg-1",
          state: EggState.Pipping,
          foundAt: 0,
          rarity: "common",
          incubationMs: 1000,
          incubationStartedAt: 0,
          sourceExpeditionId: "meadow",
        },
      ],
      pips: { "pip-1": makePip({ readyToEvolve: true }) },
    });
    expect(pickNudge(state)?.icon).toBe("🥚");
  });

  it("ready-to-evolve outranks pity/album/milestone", () => {
    const state = baseState({
      pips: { "pip-1": makePip({ readyToEvolve: true }) },
      eggPity: { meadow: tuning.retention.eggPity.thresholdByRarity["uncommon"] as number },
    });
    expect(pickNudge(state)?.icon).toBe("✨");
  });

  it("a pity counter one away from guaranteed outranks the Album/milestone nudges", () => {
    const threshold = tuning.retention.eggPity.thresholdByRarity["uncommon"] as number;
    const state = baseState({ eggPity: { meadow: threshold - 1 } });
    const nudge = pickNudge(state);
    expect(nudge?.icon).toBe("🌟");
    expect(nudge?.text).toMatch(/meadow/i);
  });

  it("a common-only pool (Bramblewick) never contributes a pity nudge", () => {
    const state = baseState({
      keep: { level: 2, placements: {} },
      eggPity: { bramblewick: 999 },
    });
    // A brand-new save legitimately has other, lower-priority nudges
    // available (e.g. a first-hour milestone one step away) — the
    // assertion that matters here is narrower: Bramblewick's all-common
    // pool must never be the SOURCE of a pity nudge.
    expect(pickNudge(state)?.icon).not.toBe("🌟");
  });

  it("an Album one form away from complete nudges once no closer priority fires", () => {
    const state = baseState({
      pipdex: {
        entries: {},
        discoveryOrder: [],
        formsSeen: 0,
        formsCaught: tuning.retention.pipdex.albumTarget - 1,
        variantsCaught: 0,
        shiniesCaught: 0,
        unreadEntryIds: [],
      },
    });
    expect(pickNudge(state)?.icon).toBe("📖");
  });

  it("a milestone one step away is the lowest-priority nudge", () => {
    const state = baseState({ counters: { feeds: 0 } }); // first-feed needs 1; 0 away by 1
    const nudge = pickNudge(state);
    expect(nudge?.icon).toBe("🏅");
    expect(nudge?.text).toMatch(/first feed/i);
  });

  it("never teases a hidden milestone's existence", () => {
    // "First Glimmer" (hidden) needs shiniesFound=1; sitting at 0 is "one
    // away" by the same arithmetic the milestone nudge uses elsewhere —
    // it must never surface before it is earned.
    const state = baseState({ counters: { shiniesFound: 0 } });
    const nudge = pickNudge(state);
    expect(nudge?.text).not.toMatch(/glimmer/i);
  });

  it("is null when nothing qualifies", () => {
    // Every non-hidden milestone already earned, so none reads as "one
    // away" — the only remaining way to test the true null case, since a
    // brand-new save otherwise legitimately has first-hour milestones
    // sitting one step away (which is correct behaviour, tested above).
    const earned: Record<string, number> = {};
    for (const def of MILESTONES) {
      if (!def.hidden) earned[def.id] = 0;
    }
    const state = baseState({ milestones: { earned, pendingCelebrations: [] } });
    expect(pickNudge(state)).toBeNull();
  });
});


/**
 * ROUND 2F (progression bible §6.3) — THE DOORSTEP HAS TO CARRY GOOD NEWS.
 *
 * As shipped, the return screen reported ONLY decay. Measured on a 20h return
 * with a staffed Gathering Station, the absence had actually paid +140 Keep XP
 * and 22 Wood / 31 Fiber / 2 Shell and left tier 4 XP-ready; the Doorstep
 * showed three lines of `Hunger ↓49 Cleanliness ↓59 Happiness ↓57 Energy ↓68`,
 * a homecoming tease, an 0/1 bounty checklist and one milestone nudge. At a
 * roster cap of 6 that is twelve lines of downward arrows before anything
 * positive. The bible asked for one new LINE (not a section) inside "The Keep"
 * and one new entry at the END of the nudge chain; both are below.
 */
describe("deriveDoorstepModel — what the absence PAID (bible §6.3)", () => {
  const paid = (
    elapsedMs: number,
    keepXpGained?: number,
    produced?: Record<string, number>,
  ): CatchupSummary => ({
    ...summary(elapsedMs),
    ...(keepXpGained === undefined ? {} : { keepXpGained }),
    ...(produced === undefined ? {} : { produced }),
  });

  it("reports the Keep XP the absence earned, formatted with thousands", () => {
    const model = deriveDoorstepModel(
      paid(20 * 60 * MINUTE_MS, 1340),
      baseState(),
      SAME_DAY,
    );
    expect(model?.keepGainLines).toContain("+1,340 Keep XP while you were away.");
  });

  it("reports what a staffed station brought in, as a readable list", () => {
    const model = deriveDoorstepModel(
      paid(20 * 60 * MINUTE_MS, 140, { wood: 22, fiber: 31, shell: 2 }),
      baseState(),
      SAME_DAY,
    );
    // Listed in `RESOURCE_IDS` order — the canonical registry order every
    // other resource readout uses — so the line never reorders itself between
    // two absences that happened to produce in a different sequence.
    const production = model?.keepGainLines.find((l) => l.includes("kept working"));
    expect(production).toBe("The Keep kept working: 31 Fiber, 22 Wood and 2 Shell came in.");
  });

  it("uses no comma-and for a single resource", () => {
    const model = deriveDoorstepModel(
      paid(20 * 60 * MINUTE_MS, 10, { wood: 4 }),
      baseState(),
      SAME_DAY,
    );
    expect(model?.keepGainLines.find((l) => l.includes("kept working"))).toBe(
      "The Keep kept working: 4 Wood came in.",
    );
  });

  it("says NOTHING when the absence earned nothing — a '+0' line is worse than no line", () => {
    const model = deriveDoorstepModel(paid(10 * MINUTE_MS), baseState(), SAME_DAY);
    expect(model?.keepGainLines).toEqual([]);
  });

  it("drops a zero-count resource rather than printing '0 Wood'", () => {
    const model = deriveDoorstepModel(
      paid(20 * 60 * MINUTE_MS, 5, { wood: 0, fiber: 3 }),
      baseState(),
      SAME_DAY,
    );
    expect(model?.keepGainLines.find((l) => l.includes("kept working"))).toBe(
      "The Keep kept working: 3 Fiber came in.",
    );
  });

  it("the earnings come FIRST — they must not sit under twelve lines of decay arrows", () => {
    const model = deriveDoorstepModel(
      paid(20 * 60 * MINUTE_MS, 340, { wood: 9 }),
      baseState(),
      SAME_DAY,
    );
    // The model exposes them as their own ordered list, which the DOM shell
    // prepends to the per-pip decay lines (see `show`'s "The Keep" section).
    expect(model?.keepGainLines[0]).toContain("Keep XP");
    expect(model?.keepGainLines[1]).toContain("kept working");
  });

  it("survives a pre-2F summary with neither field set (both are optional)", () => {
    const model = deriveDoorstepModel(summary(20 * 60 * MINUTE_MS), baseState(), SAME_DAY);
    expect(model).not.toBeNull();
    expect(model?.keepGainLines).toEqual([]);
  });
});

describe("pickNudge — 'a Keep tier ready to grow' (bible §6.3's new entry)", () => {
  /** Every non-hidden milestone banked, so the lower-priority milestone nudge
   * cannot mask the tier nudge in these fixtures. */
  function noOtherNudges(overrides: Partial<GameState> = {}): GameState {
    const earned: Record<string, number> = {};
    for (const def of MILESTONES) {
      if (!def.hidden) earned[def.id] = 0;
    }
    return baseState({
      milestones: { earned, pendingCelebrations: [] },
      ...overrides,
    });
  }

  it("nudges when the XP gate for the next tier is already cleared", () => {
    const gate = tuning.progression.levelXp[1] as number;
    const nudge = pickNudge(noOtherNudges({ keepXp: gate }));
    expect(nudge?.icon).toBe("✦");
    expect(nudge?.text).toContain("level 2");
  });

  it("names the tier's HEADLINE, so the nudge says what you get", () => {
    const gate = tuning.progression.levelXp[1] as number;
    const nudge = pickNudge(noOtherNudges({ keepXp: gate }));
    expect(nudge?.text).toContain("The Forest trail");
  });

  it("stays silent one XP short of the gate", () => {
    const gate = tuning.progression.levelXp[1] as number;
    expect(pickNudge(noOtherNudges({ keepXp: gate - 1 }))).toBeNull();
  });

  it("is LAST in the chain — a perishable moment always outranks a tier that waits forever", () => {
    const gate = tuning.progression.levelXp[1] as number;
    const withEgg = noOtherNudges({
      keepXp: gate,
      eggs: [
        {
          id: "egg-1",
          state: EggState.Pipping,
          foundAt: 0,
          rarity: "common",
          incubationMs: 1000,
          incubationStartedAt: 0,
          sourceExpeditionId: "meadow",
        },
      ],
    });
    expect(pickNudge(withEgg)?.icon).toBe("🥚");
  });

  it("stays silent at the top tier, where there is no next tier to be ready for", () => {
    const top = tuning.progression.levelXp.length;
    const state = noOtherNudges({
      keep: { level: top, placements: {} },
      keepXp: 999_999,
    });
    expect(pickNudge(state)).toBeNull();
  });
});


/**
 * ROUND 2F — A MODAL WALL OF ±1s IS NOT A REPORT.
 *
 * `ticker.ts` dispatches CATCHUP on every `visibilitychange`, and the Doorstep
 * fires for any absence over `AWAY_SHEET_MIN_ELAPSED_MS` (3 minutes) — exactly
 * the boundary bible §10.3 draws, so a 3-minute absence landed on the noisy
 * side. Observed: "You were gone 3 minutes. The Keep kept busy." over three
 * lines of `Hunger ↓1 Cleanliness ↓1 Happiness ↓1 Energy ↓1`. In practice any
 * notification or phone call mid-session ended with the player tapping "Come
 * in" past a report of ±1 and losing whatever sheet they had open.
 */
describe("deriveDoorstepModel — a trivial absence gets NO Doorstep at all", () => {
  const trivialPip = {
    pipId: "pip-1",
    activityBefore: PipActivity.Idle,
    activityAfter: PipActivity.Idle,
    needsBefore: needs(),
    needsAfter: needs({ hunger: 79, cleanliness: 79, happiness: 79, energy: 79 }),
    needsDelta: { hunger: -1, cleanliness: -1, happiness: -1, energy: -1 },
  };

  const withPip = (elapsedMs: number, delta: Record<string, number>): CatchupSummary => ({
    ...summary(elapsedMs),
    pips: [{ ...trivialPip, needsDelta: delta as typeof trivialPip.needsDelta }],
  });

  it("suppresses a 3-minute absence whose every need moved by 1", () => {
    const model = deriveDoorstepModel(
      withPip(3 * MINUTE_MS, { hunger: -1, cleanliness: -1, happiness: -1, energy: -1 }),
      baseState(),
      SAME_DAY,
    );
    expect(model).toBeNull();
  });

  it("still shows once a need has moved by MORE than 1 — real decay is worth saying", () => {
    const model = deriveDoorstepModel(
      withPip(20 * MINUTE_MS, { hunger: -4, cleanliness: -1, happiness: -1, energy: -1 }),
      baseState(),
      SAME_DAY,
    );
    expect(model).not.toBeNull();
  });

  it("ALWAYS shows past the quiet window, even with no deltas to report", () => {
    // The case that makes the time guard load-bearing: a Pip already at 0 has
    // nowhere left to fall, so a long absence produces no deltas — and that is
    // exactly when the player most needs telling.
    const model = deriveDoorstepModel(
      withPip(20 * 60 * MINUTE_MS, { hunger: 0, cleanliness: 0, happiness: 0, energy: 0 }),
      baseState(),
      SAME_DAY,
    );
    expect(model).not.toBeNull();
  });

  it("never suppresses an absence something came home from", () => {
    const model = deriveDoorstepModel(
      {
        ...withPip(3 * MINUTE_MS, {
          hunger: -1,
          cleanliness: -1,
          happiness: -1,
          energy: -1,
        }),
        events: [
          {
            kind: "expeditionReturn",
            at: 1,
            pipId: "pip-1",
            expedition: { expeditionId: "meadow", departedAt: 0, durationMs: 1 },
          },
        ],
      } as CatchupSummary,
      baseState({
        pendingReveals: [
          {
            pipId: "pip-1",
            expeditionId: "meadow",
            completedAt: 1,
            items: ["berry"],
            egg: null,
          },
        ],
      }),
      SAME_DAY,
    );
    expect(model).not.toBeNull();
  });

  it("an EMPTY pip list is never 'trivial' — no evidence is not evidence of nothing", () => {
    expect(deriveDoorstepModel(summary(10 * MINUTE_MS), baseState(), SAME_DAY)).not.toBeNull();
  });

  it("isTrivialAbsence is exposed and honest about each of its clauses", () => {
    const away = {
      title: "t",
      elapsedLine: "e",
      pips: [{ name: "P", needLines: [{ label: "Food", direction: "down", amount: 1 }], note: null }],
      expeditionLines: [],
      eggLine: null,
      lootLine: null,
      cappedLine: null,
    } as unknown as Parameters<typeof isTrivialAbsence>[1];

    expect(isTrivialAbsence(summary(3 * MINUTE_MS), away)).toBe(true);
    // Any one of the four "something happened" signals flips it.
    expect(
      isTrivialAbsence(summary(3 * MINUTE_MS), { ...away, eggLine: "an egg!" }),
    ).toBe(false);
    expect(
      isTrivialAbsence(summary(3 * MINUTE_MS), { ...away, lootLine: "loot" }),
    ).toBe(false);
    expect(
      isTrivialAbsence(summary(3 * MINUTE_MS), { ...away, cappedLine: "capped" }),
    ).toBe(false);
    expect(
      isTrivialAbsence(summary(3 * MINUTE_MS), { ...away, expeditionLines: ["home"] }),
    ).toBe(false);
    // And so does crossing the quiet window.
    expect(isTrivialAbsence(summary(2 * 60 * MINUTE_MS), away)).toBe(false);
  });
});
