/**
 * Interaction with 2C's egg pity (docs/liveliness-bible.md §2.2) — three
 * explicit claims:
 *
 * 1. A welcome is not a hatch and never calls `updatePityCounter` — this
 *    module doesn't even import it, and `eggPity` (wherever a caller's
 *    state happens to carry it) is untouched byte-for-byte across every
 *    welcome, success or refusal.
 * 2. Attractions cannot shorten a pity chase — the pool is disjoint from
 *    "not yet caught", which is exactly what a pity ladder chases.
 * 3. Attractions consume ZERO rolls from the `"egg"`/`"genome"` streams —
 *    a save's future egg rolls are bit-identical whether or not
 *    attractions exist. `"egg"`/`"genome"` are the real stream names
 *    `core/state.ts`'s `EGG_STREAM`/genome rolls use; this module only
 *    ever touches `"visitors"`/`"pip-name"`.
 */

import { describe, expect, it } from "vitest";
import {
  feedVisitor,
  processAttractionVisits,
  restockAttraction,
  welcomeVisitor,
} from "./index";
import type { AttractionContent, VisitorsByPlacement } from "./index";

const T0 = 10_000_000;
const HOUR = 60 * 60 * 1000;

const CONTENT: AttractionContent = {
  items: { "attraction-a": { effects: [{ kind: "attraction", biomeId: "meadow" }] } },
  biomes: { meadow: { eggSpecies: ["mosspip"], lootTable: [{ itemId: "berry" }] } },
  species: {
    mosspip: { id: "mosspip", rarity: "common", sprite: { palettes: ["fern"], patterns: ["plain"] } },
  },
  tuning: {
    attractions: {
      unlockKeepLevel: 6,
      visitIntervalMs: 6 * HOUR,
      lingerMs: 45 * 60_000,
      maxConcurrentVisitors: 2,
      holdLastVisitOpen: true,
      stockMax: 4,
      welcomeTrust: 3,
      trustPerSnack: 1,
      maxSnacksPerVisit: 1,
      welcomeCost: { meadow: { wood: 12 } },
      restockCost: { "attraction-a": { wood: 2 } },
      visitorFedKeepXp: 6,
      welcomeKeepXp: 60,
      restockKeepXp: 2,
    },
  },
};

/** A pre-touched `rngState` carrying REAL egg/genome cursors — the exact
 * cursor-parity claim this suite pins: these values must never move. */
function preTouchedRngState() {
  return { egg: 305_419_896, genome: 2_596_069_104, dialogue: 42 };
}

function baseState() {
  return {
    keep: { level: 6, placements: { "place-1": { itemId: "attraction-a", x: 0, y: 0 } } },
    seed: 7,
    rngState: preTouchedRngState(),
    attractionStock: { "place-1": 4 },
    attractionSchedule: { "place-1": T0 },
    visitors: {} as VisitorsByPlacement,
    resources: { wood: 100 },
    inventory: { berry: 5 },
    pips: {},
    rosterOrder: [] as string[],
    eggPity: { meadow: 5 },
  };
}

describe("cursor parity — the egg/genome streams never move for any attraction operation", () => {
  it("processAttractionVisits (a fresh roll) touches ONLY visitors/pip-name, never egg/genome", () => {
    const state = baseState();
    const next = processAttractionVisits(state, T0 + 6 * HOUR, () => true, new Set(), CONTENT);
    expect(next.rngState.egg).toBe(state.rngState.egg);
    expect(next.rngState.genome).toBe(state.rngState.genome);
    expect(next.rngState.dialogue).toBe(state.rngState.dialogue);
  });

  it("feedVisitor never touches rngState at all (no roll of any kind)", () => {
    const withVisitor = {
      ...baseState(),
      visitors: {
        "place-1": {
          placementId: "place-1",
          speciesId: "mosspip",
          name: "Pipsqueak",
          genome: {
            speciesId: "mosspip",
            palette: "fern",
            pattern: "plain",
            personalityId: "curious",
            shiny: false,
          },
          arrivedAt: T0,
          leavesAt: T0 + 10_000,
          trust: 0,
          fedThisVisit: false,
          visits: 1,
        },
      },
    };
    const { state: next } = feedVisitor(withVisitor, "place-1", "berry", T0 + 5, CONTENT);
    // `FeedVisitorHostState` doesn't even declare `rngState` — whatever the
    // caller's state carries passes through the `{...state, ...}` spread
    // untouched, by reference.
    expect(next.rngState).toBe(withVisitor.rngState);
  });

  it("welcomeVisitor never touches rngState (zero rolls — the genome/name already exist) or eggPity", () => {
    const withVisitor = {
      ...baseState(),
      visitors: {
        "place-1": {
          placementId: "place-1",
          speciesId: "mosspip",
          name: "Pipsqueak",
          genome: {
            speciesId: "mosspip",
            palette: "fern",
            pattern: "plain",
            personalityId: "curious",
            shiny: false,
          },
          arrivedAt: T0,
          leavesAt: T0 + 10_000,
          trust: 3,
          fedThisVisit: false,
          visits: 3,
        },
      },
    };
    const { state: next, outcome } = welcomeVisitor(withVisitor, "place-1", "pip-99", T0 + 6, 5, CONTENT);
    expect(outcome.ok).toBe(true);
    expect(next.eggPity).toBe(withVisitor.eggPity); // untouched — never a hatch
    expect(next.rngState).toBe(withVisitor.rngState); // zero rolls — the record was already rolled
  });

  it("restockAttraction never touches rngState (a plain resource spend, no roll)", () => {
    const state = baseState();
    const { state: next } = restockAttraction(state, "place-1", T0, CONTENT);
    expect(next.rngState).toBe(state.rngState);
  });
});

describe("attractions cannot shorten a pity chase — the pool is disjoint from 'not yet caught'", () => {
  it("a species the player has never caught can never appear in an attraction's pool, so the pity ladder is untouched by construction", () => {
    // The sharpest hypothetical from the bible §2.2: chasing "snowpip" via
    // pity, the player has only ever caught "cloudpip" from this biome.
    const isCaught = (id: string) => id === "cloudpip";
    const state = {
      ...baseState(),
      keep: { level: 6, placements: { "place-1": { itemId: "attraction-a", x: 0, y: 0 } } },
    };
    const nextWithChasedSpeciesUncaught = processAttractionVisits(
      { ...state, attractionSchedule: { "place-1": T0 } },
      T0 + 6 * HOUR,
      isCaught,
      new Set(),
      {
        ...CONTENT,
        biomes: { meadow: { eggSpecies: ["cloudpip", "snowpip"] } },
        species: {
          cloudpip: { id: "cloudpip", rarity: "common", sprite: { palettes: ["p"], patterns: ["s"] } },
          snowpip: { id: "snowpip", rarity: "rare", sprite: { palettes: ["p"], patterns: ["s"] } },
        },
      },
    );
    // The only possible visitor is cloudpip — snowpip (the pity target)
    // can never be produced, so the chase is entirely untouched.
    expect(nextWithChasedSpeciesUncaught.visitors["place-1"]?.speciesId).toBe("cloudpip");
  });
});
