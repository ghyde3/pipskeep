/**
 * The Album — pure model-layer tests (docs/retention-bible.md §1). Same
 * pattern as `focusView.test.ts`: the DOM shell is untested chrome around
 * these pure builders (state (+ speciesId) in, plain data out).
 */

import { describe, expect, it } from "vitest";
import type { GameState } from "../core/state";
import type { PipdexEntry, PipdexPortrait, PipdexState } from "../core/pipdex";
import { LifeStage } from "../core/pips/types";
import { species as contentSpecies } from "../content/species";
import {
  buildFoundLine,
  buildPipdexCardModel,
  buildPipdexDetailModel,
  buildPipdexOverviewModel,
  entryTier,
  formatCaughtDate,
  homeBiomesOf,
  pipdexGridOrder,
} from "./pipdex";

function emptyPipdex(): PipdexState {
  return {
    entries: {},
    discoveryOrder: [],
    formsSeen: 0,
    formsCaught: 0,
    variantsCaught: 0,
    shiniesCaught: 0,
    unreadEntryIds: [],
  };
}

function makeState(overrides: Partial<GameState> & { pipdex?: PipdexState } = {}): GameState {
  return {
    pips: {},
    rosterOrder: [],
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
    pipdex: overrides.pipdex ?? emptyPipdex(),
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

function portrait(overrides: Partial<PipdexPortrait> = {}): PipdexPortrait {
  return {
    pipId: "pip-7",
    name: "Mossy",
    genome: {
      speciesId: "mosspip",
      palette: "fern",
      pattern: "speckled",
      personalityId: "clingy",
      shiny: false,
    },
    personalityId: "clingy",
    lifeStageAtCatch: LifeStage.Pipling,
    sourceExpeditionId: "meadow",
    ...overrides,
  };
}

function entry(overrides: Partial<PipdexEntry> = {}): PipdexEntry {
  return {
    speciesId: "mosspip",
    seenAt: null,
    caughtAt: null,
    caughtCount: 0,
    firstPortrait: null,
    shinyCaughtAt: null,
    variantsCaught: {},
    knownBiomes: [],
    ...overrides,
  };
}

describe("every registry species has real content (fixture sanity)", () => {
  it("has exactly 14 forms, matching tuning.retention.pipdex.albumTarget", () => {
    expect(Object.keys(contentSpecies).length).toBe(14);
  });
});

describe("entryTier", () => {
  it("is blank with no entry at all", () => {
    expect(entryTier(undefined)).toBe("blank");
  });

  it("is field-note when seen but never caught", () => {
    expect(entryTier(entry({ seenAt: 100 }))).toBe("field-note");
  });

  it("is portrait once caught, regardless of seenAt", () => {
    expect(entryTier(entry({ seenAt: null, caughtAt: 500 }))).toBe("portrait");
    expect(entryTier(entry({ seenAt: 100, caughtAt: 500 }))).toBe("portrait");
  });
});

describe("pipdexGridOrder", () => {
  it("puts discoveryOrder first, then every remaining species", () => {
    const state = makeState({
      pipdex: { ...emptyPipdex(), discoveryOrder: ["lanternpip", "mosspip"] },
    });
    const order = pipdexGridOrder(state);
    expect(order[0]).toBe("lanternpip");
    expect(order[1]).toBe("mosspip");
    expect(order.length).toBe(Object.keys(contentSpecies).length);
    // Every registry id appears exactly once.
    expect(new Set(order).size).toBe(order.length);
    for (const id of Object.keys(contentSpecies)) {
      expect(order).toContain(id);
    }
  });

  it("is stable (never drops or duplicates a species) with an empty pipdex", () => {
    const order = pipdexGridOrder(makeState());
    expect(order.length).toBe(Object.keys(contentSpecies).length);
  });
});

describe("buildPipdexCardModel — the three tiers", () => {
  it("blank: no name, no portrait, no shiny badge", () => {
    const card = buildPipdexCardModel(makeState(), "snowpip");
    expect(card.tier).toBe("blank");
    expect(card.displayName).toBeNull();
    expect(card.portraitVisual).toBeNull();
    expect(card.shinyBadge).toBe(false);
  });

  it("field-note: has a species name and silhouette, but no portrait", () => {
    const state = makeState({
      pipdex: {
        ...emptyPipdex(),
        entries: { snowpip: entry({ speciesId: "snowpip", seenAt: 10 }) },
        discoveryOrder: ["snowpip"],
        formsSeen: 1,
      },
    });
    const card = buildPipdexCardModel(state, "snowpip");
    expect(card.tier).toBe("field-note");
    expect(card.displayName).toBe("Snowpip");
    expect(card.portraitVisual).toBeNull();
    expect(card.silhouette).toBe("round");
  });

  it("portrait: carries the frozen firstPortrait's genome", () => {
    const state = makeState({
      pipdex: {
        ...emptyPipdex(),
        entries: {
          mosspip: entry({
            speciesId: "mosspip",
            seenAt: 5,
            caughtAt: 10,
            firstPortrait: portrait(),
          }),
        },
        discoveryOrder: ["mosspip"],
        formsSeen: 1,
        formsCaught: 1,
      },
    });
    const card = buildPipdexCardModel(state, "mosspip");
    expect(card.tier).toBe("portrait");
    expect(card.displayName).toBe("Mosspip");
    expect(card.portraitVisual).toEqual({
      speciesId: "mosspip",
      // The frozen catch's own Pip id — round 2D item 4's jitter seed, so
      // the Album page keeps the individual it met, not a generic Mosspip.
      jitterSeed: "pip-7",
      accessoryId: undefined,
      paletteId: "fern",
      pattern: "speckled",
      shiny: false,
    });
  });

  it("shows the new dot from unreadEntryIds verbatim", () => {
    const state = makeState({
      pipdex: { ...emptyPipdex(), unreadEntryIds: ["mosspip"] },
    });
    expect(buildPipdexCardModel(state, "mosspip").isNew).toBe(true);
    expect(buildPipdexCardModel(state, "pebblepip").isNew).toBe(false);
  });
});

describe("buildPipdexOverviewModel — the three declared targets (bible §1.2)", () => {
  it("reports zero/zero/zero on a fresh Album, all 14 blank", () => {
    const model = buildPipdexOverviewModel(makeState());
    expect(model.totalForms).toBe(14);
    expect(model.metCount).toBe(0);
    expect(model.blankCount).toBe(14);
    expect(model.formsCaught).toBe(0);
    expect(model.albumTarget).toBe(14);
    expect(model.albumPct).toBe(0);
    expect(model.ledgerVariantsCaught).toBe(0);
    expect(model.ledgerTarget).toBe(21);
    expect(model.shiniesCaught).toBe(0);
    expect(model.cards.length).toBe(14);
  });

  /**
   * ROUND-2C REVIEW FIX: 20 of 34 milestone rewards were `kind: "flair"` and
   * flair was a no-op — no state field, no renderer, nothing. Every long-haul
   * chase in the game (14/14 The Album, 21/21 the Grove Ledger, the 30-day
   * streak, 100 bounties) paid literally nothing while the sheet promised "a
   * flourish for the Album". These pin the Album end of the fix.
   */
  it("surfaces earned FLAIR on the cover: stamps, ribbons, the one active frame, and anything showing elsewhere", () => {
    const model = buildPipdexOverviewModel(
      makeState({
        flair: {
          "album-curator-stamp": 10,
          "album-week-ribbon": 11,
          "album-bounty-frame": 12,
          "album-ledger-frame": 13,
          "pip-card-old-friend-title": 14,
          "sanctuary-gate-sign": 15,
        },
      }),
    );
    expect(model.coverStamps.map((f) => f.id)).toEqual(["album-curator-stamp"]);
    expect(model.ribbons.map((f) => f.id)).toEqual(["album-week-ribbon"]);
    // Frames are mutually exclusive by nature: the highest-ranked one wins…
    expect(model.pageFrame?.id).toBe("album-ledger-frame");
    // …and flourishes that live elsewhere are still NAMED here, so nothing the
    // player earned is invisible.
    expect(model.elsewhereFlair.map((f) => f.id)).toEqual([
      "pip-card-old-friend-title",
      "sanctuary-gate-sign",
    ]);
  });

  it("a fresh save has no flair anywhere and shows no empty flourish sections", () => {
    const model = buildPipdexOverviewModel(makeState());
    expect(model.coverStamps).toEqual([]);
    expect(model.ribbons).toEqual([]);
    expect(model.pageFrame).toBeNull();
    expect(model.elsewhereFlair).toEqual([]);
  });

  it("met vs blank counts every non-blank tier, caught or merely seen", () => {
    const state = makeState({
      pipdex: {
        ...emptyPipdex(),
        entries: {
          mosspip: entry({ speciesId: "mosspip", caughtAt: 1, firstPortrait: portrait() }),
          snowpip: entry({ speciesId: "snowpip", seenAt: 1 }),
        },
        discoveryOrder: ["mosspip", "snowpip"],
        formsSeen: 1,
        formsCaught: 1,
      },
    });
    const model = buildPipdexOverviewModel(state);
    expect(model.metCount).toBe(2);
    expect(model.blankCount).toBe(12);
    expect(model.formsCaught).toBe(1);
  });

  it("albumPct clamps to [0, 1] and never exceeds 1 even at full completion", () => {
    const entries: Record<string, PipdexEntry> = {};
    for (const id of Object.keys(contentSpecies)) {
      entries[id] = entry({ speciesId: id, caughtAt: 1, firstPortrait: portrait({ pipId: id }) });
    }
    const state = makeState({
      pipdex: {
        ...emptyPipdex(),
        entries,
        discoveryOrder: Object.keys(contentSpecies),
        formsCaught: Object.keys(contentSpecies).length,
      },
    });
    const model = buildPipdexOverviewModel(state);
    expect(model.albumPct).toBe(1);
    expect(model.blankCount).toBe(0);
  });
});

describe("homeBiomesOf — content-only, no player state", () => {
  it("lists every biome whose pool contains the species, with odds summing sensibly", () => {
    const biomes = homeBiomesOf("mosspip");
    const ids = biomes.map((b) => b.id);
    expect(ids).toContain("meadow");
    expect(ids).toContain("bramblewick");
    expect(ids).toContain("forest");
    for (const b of biomes) {
      expect(b.oddsPct).not.toBeNull();
      expect(b.oddsPct as number).toBeGreaterThan(0);
      expect(b.oddsPct as number).toBeLessThanOrEqual(100);
    }
  });

  it("matches the content bible's published Meadow odds (Mosspip 76.9% / Cloudpip 23.1%)", () => {
    const meadow = homeBiomesOf("mosspip").find((b) => b.id === "meadow");
    expect(meadow?.oddsPct).toBeCloseTo(76.9, 0);
    const cloud = homeBiomesOf("cloudpip").find((b) => b.id === "meadow");
    expect(cloud?.oddsPct).toBeCloseTo(23.1, 0);
  });

  it("is empty for a lineage form — never hatchable, never in a pool", () => {
    expect(homeBiomesOf("grovepip")).toEqual([]);
    expect(homeBiomesOf("beaconpip")).toEqual([]);
  });
});

describe("formatCaughtDate", () => {
  it("renders day/month/year without ever calling new Date() in this file", () => {
    // 2026-03-14T00:00:00.000Z
    const ts = Date.UTC(2026, 2, 14);
    expect(formatCaughtDate(ts)).toBe("14 Mar 2026");
  });
});

describe("buildFoundLine", () => {
  const caughtAt = Date.UTC(2026, 2, 14);

  it("names the source expedition for a biome hatch", () => {
    const line = buildFoundLine(portrait({ sourceExpeditionId: "lanterngrotto" }), caughtAt, false);
    expect(line).toContain("Lanterngrotto");
    expect(line).toContain("14 Mar 2026");
  });

  it("credits care, not a trip, for a lineage (evolved) form", () => {
    const line = buildFoundLine(portrait({ sourceExpeditionId: null }), caughtAt, true);
    expect(line.toLowerCase()).not.toContain("egg");
    expect(line).toContain("14 Mar 2026");
  });

  it("credits day one for a base-species catch with no source expedition (the starter)", () => {
    const line = buildFoundLine(portrait({ sourceExpeditionId: null }), caughtAt, false);
    expect(line.toLowerCase()).toContain("start");
  });
});

describe("buildPipdexDetailModel", () => {
  it("is null for a Blank page", () => {
    expect(buildPipdexDetailModel(makeState(), "snowpip")).toBeNull();
  });

  it("is null for an unknown species id", () => {
    expect(buildPipdexDetailModel(makeState(), "not-a-species")).toBeNull();
  });

  it("field-note: has a species line and no individual name/date", () => {
    const state = makeState({
      pipdex: {
        ...emptyPipdex(),
        entries: { snowpip: entry({ speciesId: "snowpip", seenAt: 10, knownBiomes: ["snowdrift"] }) },
        discoveryOrder: ["snowpip"],
      },
    });
    const model = buildPipdexDetailModel(state, "snowpip");
    expect(model?.tier).toBe("field-note");
    expect(model?.individualName).toBeNull();
    expect(model?.caughtDateLabel).toBeNull();
    expect(model?.speciesLine).not.toBeNull();
    expect(model?.homeBiomes.map((b) => b.id)).toContain("snowdrift");
  });

  it("portrait: carries individual name, personality, found line, date, no ribbon on a non-evolving species", () => {
    const state = makeState({
      pipdex: {
        ...emptyPipdex(),
        entries: {
          tidepip: entry({
            speciesId: "tidepip",
            caughtAt: Date.UTC(2026, 0, 1),
            firstPortrait: portrait({ name: "Puddles", personalityId: "curious", sourceExpeditionId: "shore" }),
          }),
        },
        discoveryOrder: ["tidepip"],
        formsCaught: 1,
      },
    });
    const model = buildPipdexDetailModel(state, "tidepip");
    expect(model?.tier).toBe("portrait");
    expect(model?.individualName).toBe("Puddles");
    expect(model?.personalityName).toBe("Curious");
    expect(model?.foundLine).toContain("Shore");
    expect(model?.caughtDateLabel).toBe("1 Jan 2026");
    // tidepip evolves into reefpip, so the ribbon SHOULD be present, not
    // absent — assert the interesting negative case on a species that has
    // no evolution instead (not applicable in this registry, so assert
    // the ribbon length matches the giftVariants + default count).
    expect(model?.evolutionRibbon?.length).toBe(3);
    expect(model?.evolvesInto).toBe("Reefpip");
  });

  it("lineage species: isLineage true, evolvesFrom names the base, no ribbon", () => {
    const state = makeState({
      pipdex: {
        ...emptyPipdex(),
        entries: {
          grovepip: entry({
            speciesId: "grovepip",
            caughtAt: 1,
            firstPortrait: portrait({ sourceExpeditionId: null }),
          }),
        },
        discoveryOrder: ["grovepip"],
        formsCaught: 1,
      },
    });
    const model = buildPipdexDetailModel(state, "grovepip");
    expect(model?.isLineage).toBe(true);
    expect(model?.evolvesFrom).toBe("Mosspip");
    expect(model?.evolutionRibbon).toBeNull();
    expect(model?.homeBiomes).toEqual([]);
  });

  it("the evolution ribbon reflects witnessed vs unwitnessed leaves", () => {
    const state = makeState({
      pipdex: {
        ...emptyPipdex(),
        entries: {
          mosspip: entry({
            speciesId: "mosspip",
            caughtAt: 1,
            firstPortrait: portrait(),
            variantsCaught: { berrybright: 500 },
          }),
        },
        discoveryOrder: ["mosspip"],
        formsCaught: 1,
      },
    });
    const model = buildPipdexDetailModel(state, "mosspip");
    const berry = model?.evolutionRibbon?.find((l) => l.variantId === "berrybright");
    const stew = model?.evolutionRibbon?.find((l) => l.variantId === "heartymoss");
    expect(berry?.witnessed).toBe(true);
    expect(berry?.witnessedAt).toBe(500);
    expect(stew?.witnessed).toBe(false);
    expect(stew?.witnessedAt).toBeNull();
  });
});
