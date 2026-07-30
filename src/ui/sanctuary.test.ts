/**
 * The Long Meadow — pure model-layer tests (docs/retention-bible.md §2).
 * Same pattern as `focusView.test.ts`/`pipdex.test.ts`: the DOM shell is
 * untested chrome around these pure builders.
 */

import { describe, expect, it } from "vitest";
import type { GameState } from "../core/state";
import type { PipNeeds, PipState } from "../core/pips/types";
import { LifeStage, PipActivity } from "../core/pips/types";
import type { SanctuaryRecord, SanctuaryState } from "../core/sanctuary";
import { tuning } from "../content/tuning";
import {
  buildMasteryChips,
  buildResidentModel,
  buildRetireConfirmModel,
  buildSanctuaryListModel,
  formatResidencySince,
  isSettled,
  pickActivityLine,
} from "./sanctuary";

const needs = (overrides: Partial<PipNeeds> = {}): PipNeeds => ({
  hunger: 80,
  cleanliness: 80,
  happiness: 80,
  energy: 100,
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
      personalityId: "clingy",
      shiny: false,
    },
    personalityId: "clingy",
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

function makeRecord(overrides: Partial<SanctuaryRecord> & { pip?: PipState } = {}): SanctuaryRecord {
  return {
    pip: overrides.pip ?? makePip(),
    retiredAt: 0,
    retiredFromKeepLevel: 1,
    visits: 0,
    ...overrides,
  };
}

function makeSanctuary(records: Readonly<Record<string, SanctuaryRecord>>, order: readonly string[]): SanctuaryState {
  return { pips: records, order };
}

function makeState(sanctuary: SanctuaryState, pips: Readonly<Record<string, PipState>> = {}): GameState {
  return {
    pips,
    rosterOrder: Object.keys(pips),
    activePipId: Object.keys(pips)[0] ?? "pip-1",
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
    sanctuary,
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
  } as GameState;
}

const DAY_MS = tuning.retention.dayMs;

describe("formatResidencySince", () => {
  it("says 'arrived today' for anything under a day", () => {
    expect(formatResidencySince(0, DAY_MS - 1)).toBe("arrived today");
    expect(formatResidencySince(1000, 1000)).toBe("arrived today");
  });

  it("says 'since yesterday' at exactly one day", () => {
    expect(formatResidencySince(0, DAY_MS)).toBe("here since yesterday");
  });

  it("counts days under two weeks", () => {
    expect(formatResidencySince(0, 5 * DAY_MS)).toBe("here 5 days");
  });

  it("switches to weeks, then months, for longer stays", () => {
    expect(formatResidencySince(0, 21 * DAY_MS)).toMatch(/weeks/);
    expect(formatResidencySince(0, 90 * DAY_MS)).toMatch(/months/);
  });

  it("never goes negative even if `at` is somehow before retiredAt", () => {
    expect(formatResidencySince(10_000, 0)).toBe("arrived today");
  });
});

describe("isSettled — the one gate on Ask them home (bible §2.5)", () => {
  it("is false right up to minStayMs, true at and after it", () => {
    const minStayMs = tuning.retention.sanctuary.minStayMs;
    expect(isSettled(0, minStayMs - 1, minStayMs)).toBe(false);
    expect(isSettled(0, minStayMs, minStayMs)).toBe(true);
    expect(isSettled(0, minStayMs + 1, minStayMs)).toBe(true);
  });
});

describe("pickActivityLine", () => {
  it("is deterministic for the same Pip id", () => {
    const pip = { id: "pip-42", personalityId: "curious" };
    expect(pickActivityLine(pip)).toBe(pickActivityLine(pip));
  });

  it("draws from a personality-specific pool", () => {
    const line = pickActivityLine({ id: "pip-1", personalityId: "lazy" });
    expect(typeof line).toBe("string");
    expect(line.length).toBeGreaterThan(5);
  });

  it("falls back gracefully for an unknown personality instead of crashing", () => {
    expect(() => pickActivityLine({ id: "pip-1", personalityId: "moody" })).not.toThrow();
  });
});

describe("buildMasteryChips", () => {
  it("is empty with no mastery at all", () => {
    expect(buildMasteryChips({ mastery: undefined })).toEqual([]);
  });

  it("includes only biomes with tier > 0, titled per bible §6.3", () => {
    // Meadow tier 1 needs 6 trips (0.5h @ 5min, floored by tierMinTrips=2 -> ceil(30/5)=6).
    const chips = buildMasteryChips({ mastery: { meadow: 6, forest: 0 } });
    const ids = chips.map((c) => c.biomeId);
    expect(ids).toContain("meadow");
    expect(ids).not.toContain("forest");
    const meadowChip = chips.find((c) => c.biomeId === "meadow");
    expect(meadowChip?.title).toBe("Knows the path");
  });
});

describe("buildResidentModel", () => {
  it("uses the evolution gift variant for the portrait when the resident evolved", () => {
    const pip = makePip({
      speciesId: "grovepip",
      evolved: { variantId: "berrybright", evolvedAt: 0 },
    });
    const state = makeState(makeSanctuary({ "pip-1": makeRecord({ pip }) }, ["pip-1"]));
    const model = buildResidentModel(state, "pip-1", 0);
    expect(model?.portraitVisual.paletteId).toBe("berrybright");
    expect(model?.portraitVisual.speciesId).toBe("grovepip");
  });

  it("falls back to the birth palette when never evolved", () => {
    const state = makeState(makeSanctuary({ "pip-1": makeRecord() }, ["pip-1"]));
    const model = buildResidentModel(state, "pip-1", 0);
    expect(model?.portraitVisual.paletteId).toBe("fern");
  });

  it("surfaces the ready-to-evolve flag and the keep-level flavor", () => {
    const pip = makePip({ readyToEvolve: true });
    const state = makeState(
      makeSanctuary({ "pip-1": makeRecord({ pip, retiredFromKeepLevel: 2 }) }, ["pip-1"]),
    );
    const model = buildResidentModel(state, "pip-1", 0);
    expect(model?.readyToEvolve).toBe(true);
    expect(model?.keepLevelFlavor).toMatch(/trails/);
  });

  it("is null for a pip id that isn't actually resident", () => {
    const state = makeState(makeSanctuary({}, []));
    expect(buildResidentModel(state, "nope", 0)).toBeNull();
  });
});

describe("buildSanctuaryListModel — ordering (bible §2.6: stable, order of arrival)", () => {
  it("follows sanctuary.order, not object key order", () => {
    const records = {
      b: makeRecord({ pip: makePip({ id: "b", name: "Second" }) }),
      a: makeRecord({ pip: makePip({ id: "a", name: "First" }) }),
    };
    const state = makeState(makeSanctuary(records, ["a", "b"]));
    const model = buildSanctuaryListModel(state, 0);
    expect(model.residents.map((r) => r.name)).toEqual(["First", "Second"]);
  });

  it("is empty with nobody retired", () => {
    expect(buildSanctuaryListModel(makeState(makeSanctuary({}, [])), 0).residents).toEqual([]);
  });

  /** ROUND-2C REVIEW FIX: `sanctuary-gate-sign` / `sanctuary-gathering-sign`
   * were `kind: "flair"` milestone rewards that granted and drew nothing. */
  it("carries the earned gate signs (bible §4.3's 'a Long Meadow gate sign')", () => {
    const bare = makeState(makeSanctuary({}, []));
    expect(buildSanctuaryListModel(bare, 0).gateSigns).toEqual([]);

    const signed: GameState = {
      ...bare,
      flair: { "sanctuary-gate-sign": 5, "sanctuary-gathering-sign": 6, "album-curator-stamp": 7 },
    };
    const model = buildSanctuaryListModel(signed, 0);
    expect(model.gateSigns.map((f) => f.id)).toEqual([
      "sanctuary-gate-sign",
      "sanctuary-gathering-sign",
    ]);
    // Album flair does NOT leak onto the meadow gate.
    expect(model.gateSigns.map((f) => f.id)).not.toContain("album-curator-stamp");
  });
});

describe("buildRetireConfirmModel", () => {
  it("resolves a live roster Pip's name and portrait", () => {
    const pip = makePip({ id: "pip-9", name: "Cairn" });
    const state = makeState({ pips: {}, order: [] } as SanctuaryState, { "pip-9": pip });
    const model = buildRetireConfirmModel(state, "pip-9");
    expect(model?.name).toBe("Cairn");
    expect(model?.portraitVisual.speciesId).toBe("mosspip");
  });

  it("is null for an unknown pip id (defensive — caller shouldn't offer it)", () => {
    const state = makeState({ pips: {}, order: [] } as SanctuaryState, {});
    expect(buildRetireConfirmModel(state, "ghost")).toBeNull();
  });
});
