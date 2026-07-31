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
import { albumFilledCount, buildNavRows, navBadgeTotal, quietKeepRow } from "./navMenu";

function makePip(overrides: Partial<PipState> = {}): PipState {
  return {
    id: "pip-1",
    speciesId: "mosspip",
    name: "Mossy",
    genome: {
      speciesId: "mosspip",
      palette: "fern",
      pattern: "plain",
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
  it("always offers the permanent destinations, in a stable order", () => {
    const rows = buildNavRows(makeState());
    // ROUND 2H added "nursery" (breeding is the succession mechanic now that
    // Pips are finite, so it needs a standing door). ROUND 2J added
    // "crafting" (the Craft Table's recipe book — always browsable, per
    // docs/economy-bible.md §6.3). "lineage" is NOT here: it appears only
    // while an egg is actually waiting — see below.
    expect(rows.map((r) => r.id)).toEqual([
      "album",
      "meadow",
      "today",
      "nursery",
      "crafting",
    ]);
    // Every row is reachable from the very first session — none of them is
    // gated behind a Keep level or an unlock, so a new player can always see
    // where the game is going.
    for (const row of rows) {
      expect(row.label.length).toBeGreaterThan(0);
      expect(row.hint.length).toBeGreaterThan(0);
    }
  });

  // ROUND 2H (spec §16 v1.5 promise 4: "every loss leaves a thread to pull").
  // The thread has to be VISIBLE somewhere the player will look, and it has
  // to disappear once pulled — a permanent "Someone to find" row with nobody
  // to find would read as a chore the player is failing (bible §0.3).
  describe('"Someone to find" — the lineage row (promise 4)', () => {
    const seed = (name: string, expeditionId: string) => ({
      pipId: `${name}-id`,
      name,
      genome: makePip().genome,
      expeditionId,
      level: 3,
      scars: [],
      generation: 1,
      seededAt: 0,
      misses: 0,
    });

    it("is absent while no lost Pip has left an egg", () => {
      expect(buildNavRows(makeState()).map((r) => r.id)).not.toContain(
        "lineage",
      );
      expect(
        buildNavRows(makeState({ lineageEggs: [] })).map((r) => r.id),
      ).not.toContain("lineage");
    });

    it("appears, last, the moment an egg is waiting — and names the count", () => {
      const one = buildNavRows(
        makeState({ lineageEggs: [seed("Bramble", "bramblewick")] }),
      );
      const row = one[one.length - 1];
      expect(row?.id).toBe("lineage");
      expect(row?.badge).toBe(1);
      expect(row?.hint).toContain("An egg is waiting");

      const two = buildNavRows(
        makeState({
          lineageEggs: [
            seed("Bramble", "bramblewick"),
            seed("Thistle", "snowdrift"),
          ],
        }),
      );
      expect(two[two.length - 1]?.badge).toBe(2);
      expect(two[two.length - 1]?.hint).toContain("2 eggs");
    });
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

// ---------------------------------------------------------------------------
// ROUND 2H FIX PASS — SHIELD SIX. `state.settings.quietKeep` existed only
// as a sentence in a tuning comment: no state field, no reducer arm, no
// control anywhere in the game. The bible called it "the complete,
// unconditional answer to 'it can't be brutal'".
// ---------------------------------------------------------------------------

describe("the Quiet Keep switch (shield six)", () => {
  it("reads OFF on a save that has never touched it", () => {
    const row = quietKeepRow(makeState());
    expect(row.on).toBe(false);
    expect(row.label).toBe("Quiet Keep");
    expect(row.hint).toMatch(/never fall ill/i);
  });

  it("reads ON, and says how to undo it — no setting here is a trap", () => {
    const row = quietKeepRow({ ...makeState(), settings: { quietKeep: true } });
    expect(row.on).toBe(true);
    expect(row.hint).toMatch(/turn it off/i);
  });

  // Bible §0.3: no surface in this game may scold or nag. A player
  // reaching for this switch is worried, and the last thing they need is
  // a paragraph about game design.
  it("never hedges, warns, or implies the player is playing wrong", () => {
    for (const on of [false, true]) {
      const row = quietKeepRow({ ...makeState(), settings: { quietKeep: on } });
      expect(row.hint).not.toMatch(/easier|easy mode|cheat|but you|miss out|less rewarding/i);
    }
  });

  it("is NOT a destination row — the Nook's list is places, and this is a switch", () => {
    const ids = buildNavRows({ ...makeState(), settings: { quietKeep: true } }).map((r) => r.id);
    expect(ids).not.toContain("quiet");
    expect(ids).not.toContain("settings");
  });
});
