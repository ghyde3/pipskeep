/**
 * THE VISITOR CARD's model layer (round 2K, docs/liveliness-bible.md
 * §1.5/§1.7).
 *
 * The card is the round's answer to the standing rule — "written to
 * state" and "visible to the player" are separate acceptance criteria —
 * so what this suite pins is not layout but the four claims the card
 * makes on the player's behalf:
 *
 *  1. The trust pips are visible FROM VISIT ONE, earned or not. That is
 *     what makes attractions structurally not a gacha (§0.5).
 *  2. Any snack can be offered; the biome-correct one is MARKED, never
 *     the others hidden. Refusing a gift is not this game's tone.
 *  3. At the roster cap the answer is *"they wait"* — never a refusal,
 *     never a prompt to retire someone, never an upsell, and nothing
 *     expires.
 *  4. A visitor who has left closes the card rather than being described
 *     as still standing there.
 */

import { describe, expect, it } from "vitest";
import { tuning as contentTuning } from "../content/tuning";
import type { GameState } from "../core/state";
import type { VisitorRecord } from "../core/attractions";
import {
  attractionPoolEntries,
  buildVisitorCardModel,
  emptyPoolLine,
  visitorFootnote,
  visitorPortrait,
  visitsLineFor,
} from "./visitorCard";

const NOW = 1_800_000_000_000;
const PLACEMENT = "place-1";

function record(overrides: Partial<VisitorRecord> = {}): VisitorRecord {
  return {
    placementId: PLACEMENT,
    speciesId: "mosspip",
    name: "Pipsqueak",
    genome: {
      speciesId: "mosspip",
      palette: "fern",
      pattern: "speckled",
      personalityId: "curious",
      shiny: false,
      accessoryId: null,
    },
    arrivedAt: NOW - 60_000,
    leavesAt: NOW + 60_000,
    trust: 0,
    fedThisVisit: false,
    visits: 1,
    ...overrides,
  };
}

function state(overrides: Partial<GameState> = {}): GameState {
  return {
    seed: 1,
    rngState: {},
    pips: {},
    rosterOrder: ["pip-1", "pip-2"],
    activePipId: "pip-1",
    inventory: { berry: 3 },
    resources: { wood: 999, fiber: 999, shell: 999, lodestone: 999 },
    keep: { level: 6, placements: { [PLACEMENT]: { itemId: "clover-ring", x: 0, y: 0 } } },
    pipdex: { entries: {} },
    visitors: { [PLACEMENT]: record() },
    lastTickAt: NOW,
    ...overrides,
  } as unknown as GameState;
}

describe("visitsLineFor", () => {
  it("names how many times they have been before, in words", () => {
    expect(visitsLineFor(1)).toBe("First time here.");
    expect(visitsLineFor(2)).toBe("Come by once before.");
    expect(visitsLineFor(3)).toBe("Come by twice before.");
    expect(visitsLineFor(5)).toBe("Come by 4 times before.");
    expect(visitsLineFor(9)).toBe("A regular, at this point.");
  });

  it("never reads as a countdown or a deadline", () => {
    for (let v = 1; v < 30; v++) {
      const line = visitsLineFor(v);
      expect(line).not.toMatch(/left|expires?|hurry|last chance/i);
    }
  });
});

describe("buildVisitorCardModel", () => {
  it("names who they are, from their own genome", () => {
    const model = buildVisitorCardModel(state(), PLACEMENT, NOW);
    expect(model).not.toBeNull();
    expect(model?.name).toBe("Pipsqueak");
    expect(model?.speciesName).toBe("Mosspip");
    expect(model?.personalityName).toBe("Curious");
    expect(model?.biomeName).toBe("Meadow");
  });

  it("SHOWS THE TRUST PIPS FROM VISIT ONE, all of them, none filled", () => {
    const model = buildVisitorCardModel(state(), PLACEMENT, NOW);
    expect(model?.trust).toBe(0);
    expect(model?.trustNeeded).toBe(contentTuning.attractions.welcomeTrust);
    expect(model?.trustNeeded).toBeGreaterThan(0);
  });

  it("returns null once the visit has ended — the card closes, it never lies", () => {
    const s = state({ visitors: { [PLACEMENT]: record({ leavesAt: NOW - 1 }) } });
    expect(buildVisitorCardModel(s, PLACEMENT, NOW)).toBeNull();
  });

  it("returns null when the attraction itself is gone", () => {
    const s = state({ keep: { level: 6, placements: {} } as GameState["keep"] });
    expect(buildVisitorCardModel(s, PLACEMENT, NOW)).toBeNull();
  });

  it("returns null for a placement that is not an attraction at all", () => {
    const s = state({
      keep: {
        level: 6,
        placements: { [PLACEMENT]: { itemId: "bed", x: 0, y: 0 } },
      } as unknown as GameState["keep"],
    });
    expect(buildVisitorCardModel(s, PLACEMENT, NOW)).toBeNull();
  });
});

describe("snacks — every gift is accepted (bible §1.5)", () => {
  it("offers everything in the satchel, not just the biome's own", () => {
    const s = state({ inventory: { berry: 3, emberloaf: 1, tideroll: 2 } });
    const model = buildVisitorCardModel(s, PLACEMENT, NOW);
    const ids = model?.snacks.map((x) => x.foodId) ?? [];
    expect(ids).toContain("berry");
    expect(ids).toContain("emberloaf");
    expect(ids).toContain("tideroll");
  });

  it("MARKS the biome-correct snack and sorts it first, rather than hiding the rest", () => {
    const s = state({ inventory: { berry: 3, emberloaf: 1, tideroll: 2 } });
    const model = buildVisitorCardModel(s, PLACEMENT, NOW);
    const snacks = model?.snacks ?? [];
    const liked = snacks.filter((x) => x.fromBiome);
    expect(liked.length).toBeGreaterThan(0);
    // Everything marked comes before everything unmarked.
    const firstUnmarked = snacks.findIndex((x) => !x.fromBiome);
    const lastMarked = snacks.map((x) => x.fromBiome).lastIndexOf(true);
    expect(lastMarked).toBeLessThan(firstUnmarked === -1 ? snacks.length : firstUnmarked);
  });

  it("skips anything the player has none of", () => {
    const s = state({ inventory: { berry: 0, emberloaf: 2 } });
    const ids = buildVisitorCardModel(s, PLACEMENT, NOW)?.snacks.map((x) => x.foodId) ?? [];
    expect(ids).not.toContain("berry");
    expect(ids).toContain("emberloaf");
  });

  it("an empty satchel is a state, not a crash", () => {
    const s = state({ inventory: {} });
    expect(buildVisitorCardModel(s, PLACEMENT, NOW)?.snacks).toEqual([]);
  });
});

describe("the welcome, and the roster cap (bible §1.7)", () => {
  const full = contentTuning.attractions.welcomeTrust;

  it("offers the welcome once trust is full and there is room", () => {
    const s = state({ visitors: { [PLACEMENT]: record({ trust: full }) } });
    const model = buildVisitorCardModel(s, PLACEMENT, NOW);
    expect(model?.canWelcome).toBe(true);
    expect(model?.waitingForRoom).toBe(false);
    expect(model?.welcomeCostLabel).not.toBe("");
  });

  it("does not offer it before trust is full", () => {
    const s = state({ visitors: { [PLACEMENT]: record({ trust: full - 1 }) } });
    expect(buildVisitorCardModel(s, PLACEMENT, NOW)?.canWelcome).toBe(false);
  });

  it("names what is missing rather than greying the button in silence", () => {
    const s = state({
      visitors: { [PLACEMENT]: record({ trust: full }) },
      resources: { wood: 0, fiber: 0, shell: 0, lodestone: 0 } as GameState["resources"],
    });
    const model = buildVisitorCardModel(s, PLACEMENT, NOW);
    expect(model?.canAffordWelcome).toBe(false);
    expect(model?.welcomeMissingLabel).toMatch(/more/i);
  });

  it("AT THE CAP THEY WAIT — never a refusal, never a prompt to retire anyone", () => {
    const s = state({
      rosterOrder: ["p1", "p2", "p3", "p4", "p5"],
      visitors: { [PLACEMENT]: record({ trust: full }) },
    });
    const model = buildVisitorCardModel(s, PLACEMENT, NOW);
    expect(model?.waitingForRoom).toBe(true);
    expect(model?.canWelcome).toBe(false);
    expect(model?.footnote).toBe("Pipsqueak would stay, when there's room.");
    // Trust is NOT lost, and nothing expires.
    expect(model?.trust).toBe(full);
  });
});

describe("the footnote — every branch is a tone decision", () => {
  const base = {
    name: "Pipsqueak",
    trust: 0,
    trustNeeded: 3,
    waitingForRoom: false,
    canAffordWelcome: true,
    fedThisVisit: false,
  };

  it("never guilts, never nags, never counts down", () => {
    const shapes = [
      base,
      { ...base, fedThisVisit: true },
      { ...base, trust: 2 },
      { ...base, trust: 3 },
      { ...base, trust: 3, canAffordWelcome: false },
      { ...base, trust: 3, waitingForRoom: true },
    ];
    for (const shape of shapes) {
      const line = visitorFootnote(shape);
      expect(line).not.toMatch(/missed|hurry|last chance|expires?|don't lose|before they/i);
      expect(line.length).toBeGreaterThan(0);
    }
  });

  it("the cap line is the exact sentence the bible specifies", () => {
    expect(visitorFootnote({ ...base, trust: 3, waitingForRoom: true })).toBe(
      "Pipsqueak would stay, when there's room.",
    );
  });
});

describe("the pool, printed by name (bible §0.5 — why this is not a gacha)", () => {
  it("lists every species the attraction could ever produce, marked caught or not", () => {
    const s = state({
      pipdex: { entries: { mosspip: { caughtAt: 1 } } } as unknown as GameState["pipdex"],
    });
    const entries = attractionPoolEntries(s, "clover-ring");
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some((e) => e.caught)).toBe(true);
    // …and the uncaught ones are SHOWN, not hidden: full disclosure means
    // the player can see that the pool is a subset of what they own.
    expect(entries.every((e) => typeof e.name === "string" && e.name.length > 0)).toBe(true);
  });

  it("marks nothing caught for a brand-new player — I1, visible", () => {
    const entries = attractionPoolEntries(state(), "clover-ring");
    expect(entries.every((e) => !e.caught)).toBe(true);
  });

  it("returns nothing for an item that hosts no attraction", () => {
    expect(attractionPoolEntries(state(), "bed")).toEqual([]);
  });

  it("has a warm line for an attraction nobody can visit yet", () => {
    const line = emptyPoolLine("clover-ring");
    expect(line).toContain("Meadow");
    expect(line).not.toMatch(/error|invalid|cannot|failed/i);
  });
});

describe("the portrait — one individual across every surface", () => {
  it("seeds the jitter off the PLACEMENT, so the card and the Keep agree", () => {
    const visual = visitorPortrait(PLACEMENT, record());
    expect(visual.jitterSeed).toBe(`visitor:${PLACEMENT}`);
    expect(visual.speciesId).toBe("mosspip");
    expect(visual.accessoryId).toBeNull();
  });

  it("carries shininess and the accessory through, like any roster Pip", () => {
    const visual = visitorPortrait(
      PLACEMENT,
      record({
        genome: { ...record().genome, shiny: true, accessoryId: "wander-scarf" },
      }),
    );
    expect(visual.shiny).toBe(true);
    expect(visual.accessoryId).toBe("wander-scarf");
  });
});
