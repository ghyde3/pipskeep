/**
 * The Nook menu — pure model tests (round 2C integrate stage). Same shape
 * as pipdex.test.ts/sanctuary.test.ts: the DOM shell is dumb chrome around
 * these builders, so the builders are what get asserted.
 *
 * The tone rules are tested here too, not just the counts: this menu is the
 * first thing a returning player taps, and bible §0.3 bans urgency copy
 * outright. A hint that reads as a chore list ("3 bounties left today") is
 * exactly the failure this round must not ship.
 */

import { describe, expect, it } from "vitest";
import type { GameState } from "../core/state";
import type { PipState } from "../core/pips/types";
import { LifeStage, PipActivity } from "../core/pips/types";
import type { SanctuaryRecord } from "../core/sanctuary";
import { albumFilledCount, buildNavRows, navBadgeTotal } from "./navMenu";

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
      personalityId: "clingy",
      shiny: false,
    },
    personalityId: "clingy",
    lifeStage: LifeStage.Adult,
    hatchedAt: 0,
    ageMs: 0,
    happinessIntegral: 0,
    needs: { hunger: 80, cleanliness: 80, happiness: 80, energy: 100 },
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

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    pips: { "pip-1": makePip() },
    rosterOrder: ["pip-1"],
    activePipId: "pip-1",
    inventory: {},
    resources: {},
    rngState: {},
    seed: 1,
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

function record(pip: PipState): SanctuaryRecord {
  return { pip, retiredAt: 0, retiredFromKeepLevel: 1, visits: 0 };
}

describe("buildNavRows", () => {
  it("always offers exactly the three destinations, in a stable order", () => {
    const rows = buildNavRows(makeState());
    expect(rows.map((r) => r.id)).toEqual(["album", "meadow", "today"]);
    // Every row is reachable from the very first session — none of them is
    // gated behind a Keep level or an unlock, so a new player can always see
    // where the game is going.
    for (const row of rows) {
      expect(row.label.length).toBeGreaterThan(0);
      expect(row.hint.length).toBeGreaterThan(0);
    }
  });

  it("pluralises the Long Meadow hint, and says so warmly when empty", () => {
    const empty = buildNavRows(makeState())[1];
    expect(empty?.hint).toContain("Nobody's there yet");
    expect(empty?.badge).toBe(0);

    const one = buildNavRows(
      makeState({ sanctuary: { pips: { a: record(makePip({ id: "a" })) }, order: ["a"] } }),
    )[1];
    expect(one?.hint).toContain("One Pip");
    expect(one?.badge).toBe(1);

    const two = buildNavRows(
      makeState({
        sanctuary: {
          pips: { a: record(makePip({ id: "a" })), b: record(makePip({ id: "b" })) },
          order: ["a", "b"],
        },
      }),
    )[1];
    expect(two?.hint).toContain("2 Pips");
    expect(two?.badge).toBe(2);
  });

  /** bible §0.3 — the copy lint, applied to this module's own strings. */
  it("never uses urgency, guilt or deadline copy", () => {
    const banned =
      /missed you|don't lose|streak (lost|at risk)|hurry|last chance|expires? in|only \d+ (hours?|days?) left|left today|remaining today/i;
    const states = [
      makeState(),
      makeState({ sanctuary: { pips: { a: record(makePip({ id: "a" })) }, order: ["a"] } }),
    ];
    for (const state of states) {
      for (const row of buildNavRows(state)) {
        expect(row.label, row.label).not.toMatch(banned);
        expect(row.hint, row.hint).not.toMatch(banned);
      }
    }
  });

  it("describes the Long Meadow as somewhere Pips help out, never storage", () => {
    const meadow = buildNavRows(makeState())[1];
    expect(meadow?.label).toBe("The Long Meadow");
    // The fiction is the spec (bible §2.1): never "storage", "release",
    // "delete", "box" or any other disposal word.
    expect(meadow?.hint).not.toMatch(/stor|release|delete|remove|box|slot/i);
    expect(meadow?.hint).toMatch(/help out/i);
  });
});

describe("albumFilledCount", () => {
  it("is 0 on a brand-new Album and counts non-blank pages after that", () => {
    expect(albumFilledCount(makeState())).toBe(0);

    const withPages = makeState({
      pipdex: {
        entries: {
          mosspip: {
            speciesId: "mosspip",
            seenAt: 10,
            caughtAt: 10,
            caughtCount: 1,
            firstPortrait: null,
            shinyCaughtAt: null,
            variantsCaught: {},
            knownBiomes: ["meadow"],
          },
          cloudpip: {
            speciesId: "cloudpip",
            seenAt: 20,
            caughtAt: null,
            caughtCount: 0,
            firstPortrait: null,
            shinyCaughtAt: null,
            variantsCaught: {},
            knownBiomes: ["meadow"],
          },
        },
        discoveryOrder: ["mosspip", "cloudpip"],
        formsSeen: 2,
        formsCaught: 1,
        variantsCaught: 0,
        shiniesCaught: 0,
        unreadEntryIds: [],
      },
    } as Partial<GameState>);
    // Both a caught page and a field-note page count as "there is something
    // in here" — the badge is an invitation, not a completion score.
    expect(albumFilledCount(withPages)).toBe(2);
  });
});

describe("navBadgeTotal", () => {
  it("is 0 when there is nothing to claim, so the button carries no permanent nag", () => {
    // A fresh save has Album pages (the starter is caught by createNewGame in
    // the real game) but nothing CLAIMABLE — the button must be badge-free,
    // otherwise it reads as a chore that never clears.
    expect(navBadgeTotal(makeState())).toBe(0);
  });

  it("ignores the informational Album/Meadow counts", () => {
    const busy = makeState({
      sanctuary: { pips: { a: record(makePip({ id: "a" })) }, order: ["a"] },
    });
    // One resident, but nothing claimable → still no badge.
    expect(buildNavRows(busy)[1]?.badge).toBe(1);
    expect(navBadgeTotal(busy)).toBe(0);
  });
});
