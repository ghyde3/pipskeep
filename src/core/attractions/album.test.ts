/**
 * I1 — ATTRACTIONS MAY NOT ADVANCE THE ALBUM (docs/liveliness-bible.md
 * §1.3/§2.2). Three claims, each pinned by its own test:
 *
 * 1. `visitorPool` is a partition of the caught set, always — never a
 *    margin, whatever the pool or the predicate.
 * 2. A welcome cannot move `formsSeen`/`formsCaught`/`variantsCaught`
 *    (or any other pipdex field) — proven at the strongest level: the
 *    function's own host-state type has no `pipdex` field, and passing
 *    one through anyway (structurally, via the spread every refusal/
 *    success path uses) comes back byte-identical.
 * 3. No `lineage`-rarity species can ever be produced — asserted against
 *    the REAL content registries, since that guarantee is INHERITED from
 *    `content/expeditions.ts`'s own `eggSpecies` pools (v1.3's standing
 *    rule: "evolution must be earned"), not enforced by this module,
 *    which has no rarity awareness at all.
 */

import { describe, expect, it } from "vitest";
import { expeditions as contentExpeditions } from "../../content/expeditions";
import { species as contentSpecies } from "../../content/species";
import { welcomeVisitor, visitorPool } from "./index";
import type { AttractionBiomeRegistryView, AttractionContent, CaughtPredicate } from "./index";

const T0 = 10_000_000;

const BIOMES: AttractionBiomeRegistryView = {
  meadow: { eggSpecies: ["cloudpip", "mosspip", "grovepip"] },
};

describe("I1.1 — visitorPool is a partition of the caught set", () => {
  const universes: readonly CaughtPredicate[] = [
    () => true,
    () => false,
    (id) => id === "mosspip",
    (id) => id.length % 2 === 0,
  ];

  it("never returns a species outside the caught predicate, for any pool/predicate combination", () => {
    for (const isCaught of universes) {
      const pool = visitorPool("meadow", isCaught, BIOMES);
      for (const id of pool) expect(isCaught(id)).toBe(true);
    }
  });

  it("an empty caught set yields an empty pool — not a smaller one, an EMPTY one", () => {
    expect(visitorPool("meadow", () => false, BIOMES)).toEqual([]);
  });

  it("an unknown biome yields an empty pool (defensive)", () => {
    expect(visitorPool("nowhere", () => true, BIOMES)).toEqual([]);
  });
});

describe("I1.2 — a welcome cannot move any Album field", () => {
  interface WidePipdexState {
    readonly entries: Readonly<Record<string, unknown>>;
    readonly formsSeen: number;
    readonly formsCaught: number;
    readonly variantsCaught: number;
  }

  // A state shape that ALSO carries pipdex/eggPity, structurally wider
  // than `WelcomeVisitorHostState` — welcomeVisitor's implementation
  // spreads `...state` and only overrides `resources`/`pips`/
  // `rosterOrder`/`visitors`, so any extra field the caller's state
  // happens to carry must survive BY REFERENCE.
  function stateWithAlbum() {
    const pipdex: WidePipdexState = {
      entries: { mosspip: { speciesId: "mosspip", caughtAt: 0 } },
      formsSeen: 4,
      formsCaught: 2,
      variantsCaught: 1,
    };
    const eggPity = { meadow: 5 };
    return {
      keep: {
        level: 6,
        placements: { "place-1": { itemId: "attraction-a", x: 0, y: 0 } },
      },
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
      resources: { wood: 100 },
      pips: {},
      rosterOrder: [],
      pipdex,
      eggPity,
    };
  }

  const CONTENT: AttractionContent = {
    items: { "attraction-a": { effects: [{ kind: "attraction", biomeId: "meadow" }] } },
    tuning: {
      attractions: {
        unlockKeepLevel: 6,
        visitIntervalMs: 21_600_000,
        lingerMs: 2_700_000,
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

  it("a successful welcome leaves pipdex and eggPity untouched, by reference", () => {
    const state = stateWithAlbum();
    const { state: next, outcome } = welcomeVisitor(state, "place-1", "pip-99", T0 + 1, 5, CONTENT);
    expect(outcome.ok).toBe(true);
    expect(next.pipdex).toBe(state.pipdex); // same reference — untouched
    expect(next.eggPity).toBe(state.eggPity);
  });

  it("every refusal path also leaves pipdex/eggPity untouched (the whole state does, by reference)", () => {
    const state = stateWithAlbum();
    const rosterFull = welcomeVisitor(
      { ...state, rosterOrder: ["a", "b"] },
      "place-1",
      "pip-99",
      T0 + 1,
      2,
      CONTENT,
    );
    expect(rosterFull.outcome.ok).toBe(false);
    expect(rosterFull.state.pipdex).toBe(state.pipdex);
    expect(rosterFull.state.eggPity).toBe(state.eggPity);
  });
});

describe("I1.3 — no lineage-rarity species can ever reach a pool (inherited from content, asserted here)", () => {
  it("every species listed in every biome's eggSpecies is NOT lineage-rarity, in the real content registries", () => {
    let checked = 0;
    for (const expedition of Object.values(contentExpeditions)) {
      for (const speciesId of expedition.eggSpecies ?? []) {
        const entry = contentSpecies[speciesId];
        expect(entry, `unknown species ${speciesId} in ${expedition.id}'s eggSpecies`).toBeDefined();
        expect(entry?.rarity, `${speciesId} is lineage-rarity but listed in ${expedition.id}'s eggSpecies`).not.toBe(
          "lineage",
        );
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0); // guard against a vacuous pass
  });
});
