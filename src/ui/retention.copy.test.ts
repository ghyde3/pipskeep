/**
 * THE COPY LINT, UI HALF (docs/retention-bible.md §0.3).
 *
 * `core/progression/retention.copy.test.ts` is the content-registry half: it
 * scans `MILESTONES`, `EVENTS` and `BOUNTY_TEMPLATES`. Round-2C review found
 * that scope leaves the guard protecting almost nothing that matters — the
 * urgency/guilt risk in this round lives in UI copy: the Doorstep's greeting,
 * streak line and nudge; the dailies sheet's headline, rain-day toast, grace
 * note and reward labels; the Long Meadow's refusals; the Album's cover lines.
 * The bible calls this lint "the mechanical guard" for risk 15 and asks that it
 * be treated as non-negotiable in review, so this file closes the gap.
 *
 * TWO PASSES, because neither alone is enough:
 *
 *  1. BUILDER PASS — every exported pure builder that produces a sentence a
 *     returning player reads, driven over a matrix of states that includes the
 *     nasty ones (a lapsed streak, an empty grace bank, a full roster refusal).
 *     Catches computed and interpolated copy that no source grep could see.
 *
 *  2. SOURCE PASS — the string literals in the round's UI modules, read as
 *     text (the same `?raw` trick `layers.test.ts` uses for stylesheets).
 *     Catches inline DOM copy that is not behind an exported builder, which is
 *     most of a render function. Deliberately blunt: these files are small and
 *     entirely player-facing, so a forbidden phrase anywhere in them is a bug.
 *
 * This file is in `src/ui/` on purpose: a test under `core/` must never import
 * from `ui/` (spec §2's dependency direction), which is exactly why the
 * original lint could not have been extended in place.
 */

import { describe, expect, it } from "vitest";
import { tuning as contentTuning } from "../content/tuning";
import { MILESTONES } from "../content/milestones";
import { BOUNTY_TEMPLATES } from "../content/bountyTemplates";
import { decorations as contentDecorations } from "../content/decorations";
import { EXPEDITION_IDS } from "../content/expeditions";
import { EggState } from "../core/eggs";
import { LifeStage, PipActivity } from "../core/pips/types";
import type { PipNeeds, PipState } from "../core/pips/types";
import type { CatchupSummary } from "../core/pips/catchup";
import type { GameState } from "../core/state";
import type { StreakState } from "../core/progression/streak";
import { resolveLadderReward } from "../core/progression/streak";
import {
  buildStreakModel,
  detectRainDayToast,
  formatBountyReward,
  formatLadderReward,
  formatMilestoneReward,
  streakHeadline,
} from "./dailies";
import { deriveDoorstepModel, pickNudge } from "./welcome";
import { RETIRE_REFUSAL_COPY, RETRIEVE_REFUSAL_COPY } from "./sanctuary";

/** The bible's own regex, verbatim (§0.3). */
const FORBIDDEN =
  /missed you|don't lose|streak (lost|at risk)|hurry|last chance|expires? in|only \d+ (hours?|days?) left/i;

/** A countdown by any other name: a number sitting next to "left". */
const COUNTDOWN_SHAPED = /\bleft\b[^.]*\d|\d[^.]*\bleft\b/i;

const DAY_MS = contentTuning.retention.dayMs;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const needs = (overrides: Partial<PipNeeds> = {}): PipNeeds => ({
  hunger: 70,
  cleanliness: 70,
  happiness: 70,
  energy: 70,
  ...overrides,
});

function makePip(overrides: Partial<PipState> = {}): PipState {
  return {
    id: "pip-1",
    speciesId: "mosspip",
    name: "Mossy",
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
    ageMs: 100 * 60 * 60 * 1000,
    happinessIntegral: 70 * 100 * 60 * 60 * 1000,
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

function streak(overrides: Partial<StreakState> = {}): StreakState {
  return {
    current: 0,
    longest: 0,
    lastVisitDay: null,
    totalVisitDays: 0,
    graceBanked: contentTuning.retention.streak.graceMax,
    graceRefilledOnDay: null,
    rainDays: 0,
    rewardedForDay: null,
    pendingChoices: [],
    ...overrides,
  };
}

function baseState(overrides: Partial<GameState> = {}): GameState {
  return {
    pips: { "pip-1": makePip() },
    rosterOrder: ["pip-1"],
    activePipId: "pip-1",
    inventory: { berry: 3 },
    resources: {},
    rngState: {},
    seed: 11,
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
    streak: streak(),
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

const summary = (elapsedMs: number): CatchupSummary => ({
  elapsedMs,
  ratedMs: elapsedMs,
  cappedMs: 0,
  events: [],
  pips: [],
});

/**
 * The nasty matrix: every streak shape a real player can be in, including the
 * ones the round-2C review found unguarded — a lapse past grace, an empty
 * grace bank, and a veteran's welcome-back floor.
 */
const STREAK_SHAPES: readonly { readonly label: string; readonly value: StreakState }[] = [
  { label: "fresh save", value: streak() },
  { label: "day 1", value: streak({ current: 1, longest: 1, lastVisitDay: 5, totalVisitDays: 1 }) },
  {
    label: "day 6, grace full",
    value: streak({ current: 6, longest: 6, lastVisitDay: 5, totalVisitDays: 6 }),
  },
  {
    label: "day 6, grace EMPTY",
    value: streak({
      current: 6,
      longest: 6,
      lastVisitDay: 5,
      totalVisitDays: 6,
      graceBanked: 0,
      graceRefilledOnDay: 5,
    }),
  },
  {
    label: "just lapsed, veteran (welcome-back floor)",
    value: streak({ current: 1, longest: 12, lastVisitDay: 5, totalVisitDays: 40, rainDays: 3 }),
  },
  {
    label: "long streak at the top tier",
    value: streak({ current: 45, longest: 45, lastVisitDay: 5, totalVisitDays: 45 }),
  },
];

function check(source: string, text: string): void {
  expect(FORBIDDEN.test(text), `${source}: "${text}"`).toBe(false);
  expect(COUNTDOWN_SHAPED.test(text), `${source} reads as a countdown: "${text}"`).toBe(false);
}

// ---------------------------------------------------------------------------
// PASS 1 — the exported pure builders
// ---------------------------------------------------------------------------

describe("copy lint, builder pass — every sentence a returning player reads", () => {
  it("streakHeadline, over every streak shape including a lapse and an empty grace bank", () => {
    for (const shape of STREAK_SHAPES) {
      check(`streakHeadline[${shape.label}]`, streakHeadline(shape.value, contentTuning));
    }
  });

  it("buildStreakModel's whole model, over every streak shape", () => {
    for (const shape of STREAK_SHAPES) {
      const model = buildStreakModel(baseState({ streak: shape.value }), contentTuning);
      check(`streakModel[${shape.label}].headline`, model.headline);
      check(`streakModel[${shape.label}].todaysRewardLabel`, model.todaysRewardLabel);
      for (const choice of model.pendingChoices) {
        for (const offer of choice.offers) {
          check(`streakModel[${shape.label}].offer`, offer.label);
        }
      }
    }
  });

  it("detectRainDayToast, at every grace level the bank can be at (including 0)", () => {
    for (let banked = 0; banked <= contentTuning.retention.streak.graceMax; banked++) {
      const prev = baseState({ streak: streak({ rainDays: 0 }) });
      const next = baseState({
        streak: streak({ rainDays: 1, graceBanked: banked }),
      });
      const toast = detectRainDayToast(prev, next);
      expect(toast, "the rain-day report must actually fire").not.toBeNull();
      check(`detectRainDayToast[banked=${banked}]`, toast as string);
    }
  });

  it("pickNudge, every branch of the priority chain", () => {
    const cases: readonly { readonly label: string; readonly state: GameState }[] = [
      {
        label: "pipping egg",
        state: baseState({
          eggs: [
            {
              id: "egg-1",
              state: EggState.Pipping,
              foundAt: 0,
              rarity: "common",
              incubationMs: 1,
              incubationStartedAt: 0,
              sourceExpeditionId: "meadow",
            },
          ],
        }),
      },
      {
        label: "ready to evolve",
        state: baseState({ pips: { "pip-1": makePip({ readyToEvolve: true }) } }),
      },
      { label: "pity one away", state: baseState({ eggPity: { meadow: 99 } }) },
      {
        label: "album one away",
        state: baseState({
          pipdex: {
            entries: {},
            discoveryOrder: [],
            formsSeen: 0,
            formsCaught: contentTuning.retention.pipdex.albumTarget - 1,
            variantsCaught: 0,
            shiniesCaught: 0,
            unreadEntryIds: [],
          },
        }),
      },
      { label: "milestone one away", state: baseState({ counters: { careActions: 9 } }) },
      { label: "nothing at all", state: baseState() },
    ];
    for (const { label, state } of cases) {
      const nudge = pickNudge(state, contentTuning);
      if (nudge === null) continue;
      check(`pickNudge[${label}]`, nudge.text);
    }
  });

  it("the whole Doorstep model, over every streak shape, at both an ordinary return and a lapse", () => {
    for (const shape of STREAK_SHAPES) {
      for (const now of [6 * DAY_MS, 40 * DAY_MS]) {
        const model = deriveDoorstepModel(
          summary(30 * 24 * 60 * 60 * 1000),
          baseState({ streak: shape.value }),
          now,
        );
        expect(model, "a 30-day absence must produce a Doorstep").not.toBeNull();
        const lines = [
          model?.away.title,
          model?.away.elapsedLine,
          model?.streakLine,
          model?.welcomeBackLine,
          model?.bannerRewardLine,
          model?.nudge?.text,
          ...(model?.bountyLines ?? []),
          ...(model?.away.expeditionLines ?? []),
          model?.away.eggLine,
          model?.away.lootLine,
          model?.away.cappedLine,
        ];
        for (const line of lines) {
          if (typeof line === "string") check(`doorstep[${shape.label}@${now}]`, line);
        }
      }
    }
  });

  it("every reward label the game can print (milestones, ladder days × levels, bounties)", () => {
    for (const m of MILESTONES) {
      check(`milestoneReward:${m.id}`, formatMilestoneReward(m.reward));
    }
    for (let day = 1; day <= contentTuning.retention.streak.ladderLength; day++) {
      for (const keepLevel of [1, 2, 3]) {
        const reward = resolveLadderReward(day, contentTuning, {
          keepLevel,
          keepsakeOffers: contentDecorations.slice(0, 3).map((d) => d.id),
          unlockedExpeditionIds: [...EXPEDITION_IDS],
        });
        check(`ladderReward:day${day}:level${keepLevel}`, formatLadderReward(reward));
      }
    }
    for (const b of BOUNTY_TEMPLATES) {
      check(`bountyReward:${b.id}`, formatBountyReward(b.reward));
    }
  });

  it("the Long Meadow's refusal copy — both tables, every reason", () => {
    for (const [reason, text] of Object.entries(RETIRE_REFUSAL_COPY)) {
      check(`retireRefusal:${reason}`, text);
    }
    for (const [reason, text] of Object.entries(RETRIEVE_REFUSAL_COPY)) {
      check(`retrieveRefusal:${reason}`, text);
    }
  });
});

// ---------------------------------------------------------------------------
// PASS 2 — the source text of the round's UI modules
// ---------------------------------------------------------------------------

const uiSources = import.meta.glob("./{welcome,dailies,pipdex,sanctuary,navMenu}.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Readonly<Record<string, string>>;

/** Every string literal (single, double, and template) in a source file, with
 * comments stripped first so a doc comment quoting the forbidden regex (as this
 * very file's siblings do, at length) can never fail the lint. */
function stringLiteralsOf(source: string): readonly string[] {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
  const out: string[] = [];
  const pattern = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(withoutComments)) !== null) {
    const text = match[1] ?? match[2] ?? match[3];
    if (text !== undefined && text.length > 0) out.push(text);
  }
  return out;
}

describe("copy lint, source pass — the round's UI modules, read as text", () => {
  it("found all five modules and a real number of literals in each", () => {
    const names = Object.keys(uiSources).sort();
    expect(names).toEqual([
      "./dailies.ts",
      "./navMenu.ts",
      "./pipdex.ts",
      "./sanctuary.ts",
      "./welcome.ts",
    ]);
    for (const [name, source] of Object.entries(uiSources)) {
      expect(stringLiteralsOf(source).length, name).toBeGreaterThan(20);
    }
  });

  for (const [name, source] of Object.entries(uiSources)) {
    it(`${name} contains no urgency/guilt phrasing in any string literal`, () => {
      for (const text of stringLiteralsOf(source)) {
        expect(FORBIDDEN.test(text), `${name}: "${text}"`).toBe(false);
      }
    });
  }

  it("the source pass would actually catch something (a guard against a silently-inert lint)", () => {
    // Round-2C review found `content/events.test.ts`'s grep guard silently
    // matching nothing because of an over-anchored regex. Prove this one bites.
    const planted = `const copy = "Hurry — your Pips missed you!";`;
    const literals = stringLiteralsOf(planted);
    expect(literals).toContain("Hurry — your Pips missed you!");
    expect(FORBIDDEN.test(literals[0] as string)).toBe(true);
    // …and that a doc comment quoting the regex does NOT trip it.
    expect(stringLiteralsOf(`/** never say "missed you" */\nconst a = "fine";`)).toEqual(["fine"]);
  });
});
