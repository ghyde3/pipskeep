/**
 * The Doorstep — pure model tests (docs/retention-bible.md §10, the
 * round's headline UX). Covers: the inherited "no Doorstep under 3
 * minutes" contract, section presence/omission, and the one-nudge
 * priority chain (pipping egg > ready-to-evolve > pity > Album >
 * milestone > none — exactly one, ever).
 *
 * ROUND 2G REVIEW: "DOM is untested chrome" was this file's convention and it
 * is gone — see the `createDoorstep` block at the bottom for the blocker that
 * hid behind it.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MINUTE_MS, tuning } from "../content/tuning";
import { EggState } from "../core/eggs";
import { LifeStage, PipActivity } from "../core/pips/types";
import type { PipNeeds, PipState } from "../core/pips/types";
import type { CatchupSummary } from "../core/pips/catchup";
import type { GameState } from "../core/state";
import type { BountyInstance } from "../core/progression/bounties";
import type { AwayPipLine } from "./awaySheet";
import {
  DOORSTEP_PIP_CAP,
  awayCraftLine,
  awayProductionLine,
  cappedAwayPips,
  createDoorstep,
  deriveDoorstepModel,
  isTrivialAbsence,
  keepTierLine,
  pickNudge,
  summarizeAwayNotes,
} from "./welcome";
import type { DoorstepModel } from "./welcome";
import { asHtml, installFakeDom } from "./fakeDom";
import type { FakeDomHandle, FakeElement } from "./fakeDom";
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
    // The count follows the title and is spelled out. "0/1, 0/2, 0/3" down
    // the card read as an ordinal list ("item 1 of 3") rather than three
    // independent fractions — the format only became legible once one of
    // them completed. The leading marker carries done-ness instead.
    expect(model?.bountyLines).toEqual([
      "✓ Hand out four snacks — done",
      "○ Freshen everyone up — 1 of 3",
    ]);
    // Neither form may read as "N of M bounties" — the fraction belongs to
    // the bounty's own progress, so the title has to come first.
    for (const line of model?.bountyLines ?? []) {
      expect(line).not.toMatch(/^[✓○]\s*\d/);
    }
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

/**
 * ROUND 2G (hud-redesign.md §5.1 decision 3) — "a Keep tier ready to grow"
 * moved OUT of the nudge chain into a permanent line (`keepTierLine`,
 * always present in `DoorstepModel.tierLine`). These tests replace round
 * 2F's "pickNudge — 'a Keep tier ready to grow'" describe block, which
 * pinned the nudge behaviour this round deliberately removes.
 */
describe("keepTierLine — the permanent Keep progress line (replaces the old tier-ready NUDGE)", () => {
  it("names the next tier's headline and the live XP/span numerals while not yet ready", () => {
    const line = keepTierLine(baseState({ keepXp: 42 }));
    expect(line).toContain("Lv 1");
    expect(line).toContain("42");
    expect(line).toContain("The Forest trail"); // tier 2's headline — the NEXT tier from level 1
    expect(line).not.toMatch(/Ready/);
  });

  it("switches to READY phrasing, naming the headline as the thing waiting, once the XP gate clears", () => {
    const gate = tuning.progression.levelXp[1] as number;
    const line = keepTierLine(baseState({ keepXp: gate }));
    expect(line).toContain("Lv 1 ▸ Ready");
    expect(line).toContain("The Forest trail"); // tier 2's headline
    expect(line).toMatch(/is waiting/);
  });

  it("stays in not-ready phrasing one XP short of the gate", () => {
    const gate = tuning.progression.levelXp[1] as number;
    expect(keepTierLine(baseState({ keepXp: gate - 1 }))).not.toMatch(/Ready/);
  });

  it("never throws past the top tier (Renown) and still names a level", () => {
    const top = tuning.progression.levelXp.length;
    const line = keepTierLine(baseState({ keep: { level: top, placements: {} }, keepXp: 999_999 }));
    expect(line).toContain(`Lv ${top}`);
  });

  it("is exposed on the Doorstep model as `tierLine`, ALWAYS — even on a return that earned nothing this trip", () => {
    const state = baseState({ keepXp: 42 });
    const model = deriveDoorstepModel(summary(10 * MINUTE_MS), state, SAME_DAY);
    expect(model?.tierLine).toBe(keepTierLine(state));
    expect(model?.keepGainLines).toEqual([]); // nothing earned THIS trip — the fact still shows
  });
});

describe("pickNudge — the tier-ready fact no longer competes for the nudge slot", () => {
  /** Every non-hidden milestone banked, so the lower-priority milestone nudge
   * cannot mask what's being tested in these fixtures. */
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

  it("returns null when a tier is ready and nothing else qualifies — the round-2F 'is null when nothing qualifies' case now includes a ready tier, because that fact moved to a permanent line", () => {
    const gate = tuning.progression.levelXp[1] as number;
    expect(pickNudge(noOtherNudges({ keepXp: gate }))).toBeNull();
  });

  it("a pipping egg still nudges normally even when a tier happens to be ready — there is no longer anything to outrank", () => {
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
});

describe("cappedAwayPips — the per-pip block cap (hud-redesign.md §5.1 decision 2)", () => {
  const pip = (id: string, note: string | null = null): AwayPipLine => ({
    pipId: id,
    name: id,
    needLines: [],
    note,
  });

  it("shows everything, with no hidden count, at or under the cap", () => {
    const pips = [pip("a"), pip("b"), pip("c")];
    expect(cappedAwayPips(pips, false)).toEqual({ shown: pips, hiddenCount: 0 });
  });

  it("caps at 3 and reports the hidden count when collapsed", () => {
    const pips = [pip("a"), pip("b"), pip("c"), pip("d"), pip("e")];
    const result = cappedAwayPips(pips, false);
    expect(result.shown).toEqual(pips.slice(0, 3));
    expect(result.hiddenCount).toBe(2);
  });

  it("shows everything, with zero hidden, once expanded", () => {
    const pips = [pip("a"), pip("b"), pip("c"), pip("d"), pip("e")];
    expect(cappedAwayPips(pips, true)).toEqual({ shown: pips, hiddenCount: 0 });
  });
});

describe("summarizeAwayNotes — collapsing a note repeated by 2+ Pips (hud-redesign.md §5.1 decision 2)", () => {
  const SULKY_NOTE = "came home a bit sulky. One good snack fixes everything.";

  const pip = (id: string, note: string | null): AwayPipLine => ({
    pipId: id,
    name: id,
    needLines: [],
    note,
  });

  it("leaves a UNIQUE note in place — only genuine repetition collapses", () => {
    const pips = [pip("a", SULKY_NOTE), pip("b", null)];
    const { pips: out, sharedNotes } = summarizeAwayNotes(pips);
    expect(sharedNotes).toEqual([]);
    expect(out).toEqual(pips);
  });

  it("collapses a note shared by 2+ Pips into ONE section-level line, stripped from each Pip's own row", () => {
    const pips = [pip("a", SULKY_NOTE), pip("b", SULKY_NOTE), pip("c", SULKY_NOTE), pip("d", null)];
    const { pips: out, sharedNotes } = summarizeAwayNotes(pips);
    expect(sharedNotes).toEqual([`Three of them ${SULKY_NOTE}`]);
    expect(out.filter((p) => p.note !== null)).toEqual([]);
    expect(out.map((p) => p.pipId)).toEqual(["a", "b", "c", "d"]); // order preserved
  });

  it("keeps two DIFFERENT repeated notes as two separate collective lines", () => {
    const other = "dozed through the whole thing, honestly.";
    const pips = [pip("a", SULKY_NOTE), pip("b", SULKY_NOTE), pip("c", other), pip("d", other)];
    const { sharedNotes } = summarizeAwayNotes(pips);
    expect(sharedNotes).toEqual([`Two of them ${SULKY_NOTE}`, `Two of them ${other}`]);
  });

  it("is a no-op with no notes at all", () => {
    const pips = [pip("a", null), pip("b", null)];
    expect(summarizeAwayNotes(pips)).toEqual({ pips, sharedNotes: [] });
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

// ---------------------------------------------------------------------------
// THE CARD — the return moment as the player actually sees it
// ---------------------------------------------------------------------------

/**
 * ROUND 2G REVIEW. Two findings meet here.
 *
 * The first is the systemic one: `createDoorstep` was one of three headline
 * DOM factories in the round with no test whatsoever, and the review's note
 * was specific — mutations to the Doorstep's XP line, tier phrasing and
 * station-production line all died correctly, but every one of them died at
 * the MODEL layer. Nothing asserted `renderBody` PAINTS any of it, so the
 * Doorstep sat one `bodyEl.replaceChildren()` away from the same class of
 * silently-dead feature that killed the loot reveal's XP chip.
 *
 * The second is the blocker: on a real day-2 return the card was, in full,
 * one tier line and a paragraph of decay. The gains existed and were ordered
 * first, but rendered in the identical 13px/weight-400/rgb(61,74,61) as the
 * losses beneath them — measured, the gain line was 5,328px² against
 * 16,280px² of decay, 3.1× larger, same weight, same colour. So the tests
 * below pin the RANK, not just the presence: a `--gain` line has to be
 * distinguishable in the DOM from a decay line, because that distinction is
 * the only thing the CSS has to hang a hierarchy on.
 */
describe("createDoorstep — what the card paints", () => {
  let dom: FakeDomHandle;

  beforeEach(() => {
    dom = installFakeDom();
  });
  afterEach(() => {
    dom.uninstall();
  });

  function show(model: DoorstepModel): {
    readonly sheet: ReturnType<typeof createDoorstep>;
    readonly root: FakeElement;
  } {
    let dismissed = 0;
    const sheet = createDoorstep({
      mount: asHtml(dom.ui),
      onDismiss: () => (dismissed += 1),
    });
    void dismissed;
    sheet.show(model);
    return { sheet, root: sheet.el as unknown as FakeElement };
  }

  /** A real model, straight from the real deriver — no hand-built fixture
   * that could drift from what the game actually produces. */
  function modelFor(state: GameState, sum: CatchupSummary, now = SAME_DAY): DoorstepModel {
    const model = deriveDoorstepModel(sum, state, now);
    if (model === null) throw new Error("fixture produced no Doorstep");
    return model;
  }

  const lines = (root: FakeElement, cls = ".pk-doorstep-line"): string[] =>
    root.querySelectorAll(cls).map((el) => el.textContent);

  it("paints the tier fact as a marked line, whatever its position in the section", () => {
    const { root } = show(modelFor(baseState(), summary(10 * MINUTE_MS)));

    const tier = root.querySelectorAll(".pk-doorstep-line--tier");
    expect(tier).toHaveLength(1);
    expect(tier[0]?.textContent).toMatch(/^Lv 1 —/);
    // The tone travels with the line. This used to be applied afterwards by
    // `querySelector(".pk-doorstep-line")` — i.e. by POSITION — which would
    // have silently marked the wrong line, or none, the day the order moved.
    expect(tier[0]?.classList.contains("pk-doorstep-line")).toBe(true);
  });

  it("ranks what the absence EARNED above what it cost, in the DOM as well as in order", () => {
    const withGains: CatchupSummary = {
      ...summary(24 * 60 * MINUTE_MS),
      keepXpGained: 81,
      produced: { fiber: 29, wood: 17 },
    };
    const { root } = show(modelFor(baseState(), withGains));

    const gains = root.querySelectorAll(".pk-doorstep-line--gain").map((el) => el.textContent);
    expect(gains).toEqual([
      "+81 Keep XP while you were away.",
      "The Keep kept working: 29 Fiber and 17 Wood came in.",
    ]);

    // …and they are ranked, not merely present: a decay line must not be
    // able to wear the same class.
    const all = lines(root);
    const plain = all.filter((text) => !gains.includes(text));
    expect(plain.length).toBeGreaterThan(0);
    for (const text of plain) {
      expect(gains).not.toContain(text);
    }
  });

  it("a quiet return that earned nothing prints NO gain lines rather than a '+0'", () => {
    const { root } = show(modelFor(baseState(), summary(10 * MINUTE_MS)));
    expect(root.querySelectorAll(".pk-doorstep-line--gain")).toHaveLength(0);
  });

  it("the streak forecast is NOT dressed as a gain — it has not happened yet", () => {
    const { root } = show(modelFor(baseState(), summary(10 * MINUTE_MS)));

    const forecast = lines(root).find((text) => text.includes("Waiting for you today"));
    expect(forecast).toBeDefined();
    const gainTexts = root
      .querySelectorAll(".pk-doorstep-line--gain")
      .map((el) => el.textContent);
    expect(gainTexts).not.toContain(forecast);
  });

  it("'Come in' sits in a fixed footer OUTSIDE the scrolling body, and dismisses", () => {
    let dismissed = 0;
    const sheet = createDoorstep({
      mount: asHtml(dom.ui),
      onDismiss: () => (dismissed += 1),
    });
    const root = sheet.el as unknown as FakeElement;
    sheet.show(modelFor(baseState(), summary(10 * MINUTE_MS)));

    const dismiss = root.querySelector(".pk-doorstep-dismiss") as FakeElement;
    expect(dismiss.closest(".pk-doorstep-footer")).not.toBeNull();
    expect(dismiss.closest(".pk-doorstep-body")).toBeNull();

    expect(sheet.isOpen()).toBe(true);
    dismiss.click();
    expect(dismissed).toBe(1);
    expect(sheet.isOpen()).toBe(false);
    expect(root.classList.contains("pk-doorstep--open")).toBe(false);
  });

  it("caps the per-pip block and expands it in place on the disclosure tap", () => {
    const roster = ["a", "b", "c", "d", "e"].map((id) =>
      makePip({ id, name: `Pip-${id}`, needs: needs({ hunger: 20 }) }),
    );
    const state = baseState({
      pips: Object.fromEntries(roster.map((p) => [p.id, p])),
      rosterOrder: roster.map((p) => p.id),
      activePipId: "a",
    });
    const sum: CatchupSummary = {
      ...summary(24 * 60 * MINUTE_MS),
      pips: roster.map((p) => ({
        pipId: p.id,
        activityBefore: PipActivity.Idle,
        activityAfter: PipActivity.Idle,
        needsBefore: needs({ hunger: 80 }),
        needsAfter: needs({ hunger: 20 }),
        needsDelta: { hunger: -60, cleanliness: 0, happiness: 0, energy: 0 },
      })) as CatchupSummary["pips"],
    };
    const { root } = show(modelFor(state, sum));

    const named = (): string[] => lines(root).filter((text) => text.startsWith("Pip-"));
    expect(named()).toHaveLength(DOORSTEP_PIP_CAP);

    const more = root.querySelector(".pk-doorstep-more") as FakeElement;
    expect(more.textContent).toBe(`+${roster.length - DOORSTEP_PIP_CAP} more`);
    more.click();
    expect(named()).toHaveLength(roster.length);
    expect((root.querySelector(".pk-doorstep-more") as FakeElement).textContent).toBe("Show less");
  });

  it("re-opening starts tidy again — the disclosure is per-open, not persisted", () => {
    const model = modelFor(baseState(), summary(10 * MINUTE_MS));
    const { sheet, root } = show(model);
    sheet.hide();
    sheet.show(model);
    expect(root.classList.contains("pk-doorstep--open")).toBe(true);
  });
});

/**
 * ⚠️ ROUND 2J FIX STAGE — the Doorstep half of "a craft finished".
 * Verified in play before this existed: queue a Poultice, skip +6h, and
 * the Doorstep read "THE KEEP — Lv 4 — 0/400 toward The Lanterngrotto.
 * +8 Keep XP while you were away." and nothing else.
 */
describe("awayCraftLine — what the bench made while you were away", () => {
  const summary = (crafted: Record<string, number>): CatchupSummary => ({
    elapsedMs: 6 * 3_600_000,
    ratedMs: 6 * 3_600_000,
    cappedMs: 0,
    events: [],
    pips: [],
    crafted,
  });

  it("names the recipe, counted", () => {
    expect(awayCraftLine(summary({ poultice: 2 }))).toBe(
      "The Craft Table finished: 2 × Poultice.",
    );
  });

  it("lists a mixed batch as one warm sentence", () => {
    expect(awayCraftLine(summary({ poultice: 1, "lodestone-cairn": 1 }))).toBe(
      "The Craft Table finished: Poultice and Lodestone Cairn.",
    );
  });

  it("is null when nothing was crafted — the section is omitted, never shown empty", () => {
    expect(awayCraftLine(summary({}))).toBeNull();
    expect(awayCraftLine({ ...summary({}), crafted: undefined })).toBeNull();
  });

  it("...and it could NEVER have come from `produced`, which is resources only", () => {
    // This is the whole reason `CatchupSummary.crafted` exists: crafted
    // outputs land in `inventory`/`keepsakes`, so the round-2F production
    // line walks a delta they can never appear in.
    const withResources: CatchupSummary = {
      ...summary({}),
      produced: { wood: 12, lodestone: 3 },
    };
    expect(awayProductionLine(withResources)).toMatch(/12 Wood/);
    expect(awayCraftLine(withResources)).toBeNull();
  });
});
