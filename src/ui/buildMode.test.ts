/**
 * Build-mode controller tests (spec §9 placement UI, §6.3 costs; docs/
 * progression-bible.md §4/§5) — the PURE model layer: catalog
 * affordability with friendly shortfalls, cost/missing copy, generated
 * effect lines, set-progress grouping, lock labels, first-build XP, and
 * the rearrange rows (incl. who works a station). The DOM sheet is
 * untested chrome around this (topBar.test.ts pattern); tile validity is
 * the scene's job (it reuses core/keep directly).
 */

import { describe, expect, it } from "vitest";
import { placeables } from "../content/placeables";
import { decorations } from "../content/decorations";
import { decorSets } from "../content/decorSets";
import { tuning } from "../content/tuning";
import { createNewGame, rootReducer } from "../core/state";
import type { GameState } from "../core/state";
import {
  buildCatalog,
  buildSheetModel,
  describeEffect,
  describeSetBonus,
  findBuildItem,
  formatBundle,
  formatMissing,
  missingFor,
  placementHostsJob,
  resourceDisplayName,
} from "./buildMode";

const T0 = 1_000_000;

/** A fresh game with granted resources — reducer-built so shapes never
 * drift from core. */
function stateWith(resources: Record<string, number> = {}): GameState {
  const fresh = createNewGame(7, T0);
  return rootReducer(fresh, { type: "DEBUG_GRANT", resources });
}

/** All Build entries across both catalog groups, flattened — a thin test
 * helper only; the real model deliberately groups (bible §5.5). */
function allEntries(model: ReturnType<typeof buildSheetModel>) {
  return [...model.stations, ...model.sets.flatMap((g) => g.entries)];
}

describe("buildCatalog — placeables ∪ decorations (spec §9)", () => {
  it("lists every placeable (stations first) and every BUYABLE decoration", () => {
    // ROUND 2J FIX STAGE — the five craft-only keepsakes are decorations in
    // the registry but carry no price, so the buyable catalogue filters
    // them out. Leaving them in would put five free items on the Build
    // sheet and make every keepsake recipe pointless.
    const buyableDecorations = decorations.filter((d) => d.craftOnly !== true);
    const catalog = buildCatalog();
    expect(catalog.length).toBe(placeables.length + buyableDecorations.length);
    expect(catalog.slice(0, placeables.length).every((i) => i.kind === "station")).toBe(
      true,
    );
    expect(catalog.slice(placeables.length).every((i) => i.kind === "decoration")).toBe(
      true,
    );
    expect(catalog.some((i) => i.id === "lodestone-cairn")).toBe(false);
  });

  it("a craft-only keepsake is resolvable for PLACING but never offered for SALE", () => {
    // Both halves matter: place mode has to resolve the item (you place it
    // off the Keepsake Shelf), and the sheet must never sell it for its
    // empty cost bundle.
    expect(findBuildItem("lodestone-cairn")?.kind).toBe("decoration");
    expect(findBuildItem("lodestone-cairn")?.cost).toEqual({});
    expect(buildCatalog().some((i) => i.id === "lodestone-cairn")).toBe(false);
  });

  it("findBuildItem resolves ids from both registries, null for unknowns", () => {
    expect(findBuildItem("gathering-station")?.footprint).toEqual({ w: 2, h: 2 });
    expect(findBuildItem("cozy-lantern")?.kind).toBe("decoration");
    expect(findBuildItem("hot-tub")).toBeNull();
  });

  it("every catalog item carries an icon and a normalized effects array", () => {
    for (const item of buildCatalog()) {
      expect(item.icon.motif, item.id).toBeTypeOf("string");
      expect(Array.isArray(item.effects), item.id).toBe(true);
    }
  });
});

describe("cost copy — warm and concrete (spec §15.5)", () => {
  it("names food-registry resources by their registry name, capitalizes the rest", () => {
    expect(resourceDisplayName("berry")).toBe("Berry");
    expect(resourceDisplayName("wood")).toBe("Wood");
    expect(resourceDisplayName("driftwood")).toBe("Driftwood");
  });

  it("formats bundles and shortfalls as friendly lines", () => {
    expect(formatBundle({ wood: 4, fiber: 3 })).toBe("4 Wood + 3 Fiber");
    expect(formatBundle({})).toBe("Free");
    expect(formatMissing({ wood: 2 })).toBe("Needs 2 more Wood");
    expect(formatMissing({ wood: 2, fiber: 1 })).toBe(
      "Needs 2 more Wood and 1 more Fiber",
    );
    expect(formatMissing({})).toBe("");
  });
});

describe("describeEffect — generated from the effect data, never authored (bible §4.4)", () => {
  it("matches the bible's table, verbatim, for every effect kind", () => {
    expect(describeEffect({ kind: "comfort", need: "hunger", decayReduction: 0.06 })).toBe(
      "Hunger falls 6% slower for every Pip in the Keep.",
    );
    expect(describeEffect({ kind: "comfort", need: "all", decayReduction: 0.02 })).toBe(
      "Every need falls 2% slower, Keep-wide.",
    );
    expect(describeEffect({ kind: "restSpeed", multiplier: 1.25 })).toBe(
      "Naps finish 25% sooner.",
    );
    expect(describeEffect({ kind: "expeditionSpeed", multiplier: 0.92 })).toBe(
      "Trips come home 8% sooner.",
    );
    expect(
      describeEffect({ kind: "expeditionLoot", bonusRollChance: 0.03 }),
    ).toBe("A 3% better chance of an extra find on every trip.");
    expect(describeEffect({ kind: "eggChancePoints", points: 0.01 })).toBe(
      "Eggs turn up a shade more often.",
    );
    expect(describeEffect({ kind: "incubationSpeed", multiplier: 0.85 })).toBe(
      "Eggs hatch 15% sooner.",
    );
    expect(describeEffect({ kind: "job", jobId: "gathering" })).toBe(
      "A Pip can work here — Gathering, one find every 10 minutes.",
    );
    expect(describeEffect({ kind: "xpBonus", fraction: 0.05 })).toBe(
      "+5% Keep XP from everything you do.",
    );
  });

  it("every real catalog item's effects generate a non-empty line each", () => {
    for (const item of buildCatalog()) {
      for (const effect of item.effects) {
        expect(describeEffect(effect).length, `${item.id}: ${effect.kind}`).toBeGreaterThan(
          5,
        );
      }
    }
  });
});

describe("buildSheetModel — stations (spec §6.3, bible §2.3/§4.1)", () => {
  it("greys out what the satchel cannot cover, with the missing amounts", () => {
    // 2 wood: Food Bowl (2 wood) affordable; Bed (4 wood + 3 fiber) not.
    const model = buildSheetModel(stateWith({ wood: 2 }));
    const bowl = model.stations.find((e) => e.id === "food-bowl");
    const bed = model.stations.find((e) => e.id === "bed");
    expect(bowl?.affordable).toBe(true);
    expect(bowl?.missingLabel).toBe("");
    expect(bowl?.buyable).toBe(true);
    expect(bed?.affordable).toBe(false);
    expect(bed?.missing).toEqual({ wood: 2, fiber: 3 });
    expect(bed?.missingLabel).toBe("Needs 2 more Wood and 3 more Fiber");
    expect(bed?.buyable).toBe(false);
  });

  it("a rich satchel affords the whole catalog", () => {
    const model = buildSheetModel(
      // ROUND 2J FIX STAGE — the late stations now carry a lodestone rider.
      stateWith({
        wood: 999,
        fiber: 999,
        shell: 999,
        driftwood: 999,
        lodestone: 999,
        berry: 99,
      }),
    );
    expect(allEntries(model).every((e) => e.affordable)).toBe(true);
  });

  it("a station past the current Keep level shows locked, greyed, and named — never hidden", () => {
    const model = buildSheetModel(stateWith({ wood: 999, fiber: 999 }));
    const larder = model.stations.find((e) => e.id === "larder"); // unlockKeepLevel 6
    expect(larder).toBeDefined();
    expect(larder?.locked).toBe(true);
    expect(larder?.lockLabel).toBe("Opens at Keep level 6");
    expect(larder?.buyable).toBe(false); // locked wins even though affordable
    expect(larder?.affordable).toBe(true);
  });

  it("a station at or below the current level is unlocked", () => {
    const model = buildSheetModel(stateWith({}));
    const bowl = model.stations.find((e) => e.id === "food-bowl"); // level 1
    expect(bowl?.locked).toBe(false);
    expect(bowl?.lockLabel).toBeNull();
  });

  it("every station's own effects generate its effectLines", () => {
    const model = buildSheetModel(stateWith({}));
    const bed = model.stations.find((e) => e.id === "bed");
    expect(bed?.effectLines).toEqual([
      "Naps finish 25% sooner.",
      "Energy falls 6% slower for every Pip in the Keep.",
    ]);
    const gathering = model.stations.find((e) => e.id === "gathering-station");
    expect(gathering?.effectLines).toEqual([
      "A Pip can work here — Gathering, one find every 10 minutes.",
    ]);
  });

  it("a never-built station carries the first-build XP callout and reads NEW", () => {
    const model = buildSheetModel(stateWith({}));
    const bowl = model.stations.find((e) => e.id === "food-bowl");
    expect(bowl?.isNew).toBe(true);
    expect(bowl?.firstBuildLabel).toBe(
      `+${tuning.progression.xp.firstBuild} Keep XP the first time you build one`,
    );
  });

  it("once built, the same item type never shows the first-build callout again", () => {
    let state = stateWith({ wood: 20, fiber: 20 });
    state = rootReducer(state, {
      type: "PLACE_ITEM",
      itemId: "food-bowl",
      x: 0,
      y: 0,
      at: T0,
    });
    const model = buildSheetModel(state);
    const bowl = model.stations.find((e) => e.id === "food-bowl");
    expect(bowl?.isNew).toBe(false);
    expect(bowl?.firstBuildLabel).toBeNull();
  });

  it("missingFor mirrors core/economy spend's shortfall shape", () => {
    expect(missingFor({ wood: 1 }, { wood: 4, fiber: 3 })).toEqual({
      wood: 3,
      fiber: 3,
    });
    expect(missingFor({ wood: 9 }, { wood: 4 })).toEqual({});
  });
});

describe("buildSheetModel — themed decoration sets (bible §3.5/§5.5)", () => {
  it("groups every decoration into exactly one of the six named sets, no orphans", () => {
    const model = buildSheetModel(stateWith({}));
    expect(model.sets.map((g) => g.setId).sort()).toEqual(
      [...decorSets.map((s) => s.id)].sort(),
    );
    const totalGrouped = model.sets.reduce((n, g) => n + g.entries.length, 0);
    expect(totalGrouped).toBe(decorations.filter((d) => d.craftOnly !== true).length);
  });

  it("a set's placed/total counts DISTINCT member ids currently placed, not raw placements", () => {
    let state = stateWith({ fiber: 20 });
    // Two Moss Tufts is still ONE distinct member (bible §3.5's counting
    // rule — a set is a collection, not a spam).
    state = rootReducer(state, {
      type: "PLACE_ITEM",
      itemId: "moss-tuft",
      x: 0,
      y: 0,
      at: T0,
    });
    state = rootReducer(state, {
      type: "PLACE_ITEM",
      itemId: "moss-tuft",
      x: 1,
      y: 0,
      at: T0,
    });
    const model = buildSheetModel(state);
    const meadow = model.sets.find((g) => g.setId === "meadow-green");
    expect(meadow?.placedCount).toBe(1);
  });

  it("a set's bonus goes active at 3 distinct members once the Keep tier turns it on, and every entry reflects it", () => {
    let state = stateWith({ fiber: 50, wood: 20 });
    state = { ...state, keep: { ...state.keep, level: 3 } }; // tier1LiveAtKeepLevel
    for (const [i, id] of ["moss-tuft", "pebble-path", "berry-planter"].entries()) {
      state = rootReducer(state, {
        type: "PLACE_ITEM",
        itemId: id,
        x: i,
        y: 0,
        at: T0,
      });
    }
    const model = buildSheetModel(state);
    const meadow = model.sets.find((g) => g.setId === "meadow-green");
    expect(meadow?.bonusActive).toBe(true);
    expect(meadow?.bonusTier).toBe(1);
    const mossTuft = meadow?.entries.find((e) => e.id === "moss-tuft");
    expect(mossTuft?.setBonusActive).toBe(true);
    // ROUND 2F: the card names the NEXT STEP, not just a tally (bible §3.5's
    // own example copy is "2 of 6 — one more for the set bonus"). With the
    // 3-member tier earned, the step in front of the player is the 5-member one.
    expect(mossTuft?.setLabel).toBe(
      "Meadow Green — 3 of 7 placed — two more for the bigger bonus",
    );
  });

  it("below the Keep tier that turns bonuses on, 3 placed members still count but grant nothing", () => {
    let state = stateWith({ fiber: 50, wood: 20 }); // level 1, tier1LiveAtKeepLevel is 3
    for (const [i, id] of ["moss-tuft", "pebble-path", "berry-planter"].entries()) {
      state = rootReducer(state, {
        type: "PLACE_ITEM",
        itemId: id,
        x: i,
        y: 0,
        at: T0,
      });
    }
    const model = buildSheetModel(state);
    const meadow = model.sets.find((g) => g.setId === "meadow-green");
    expect(meadow?.placedCount).toBe(3);
    expect(meadow?.bonusActive).toBe(false);
  });

  it("an unset decoration shows null setLabel — never (defensively only; every shipped one carries a set)", () => {
    // Every shipped decoration DOES carry a setId (content bible §5.3), so
    // this just pins that the model has no orphan group in practice.
    const model = buildSheetModel(stateWith({}));
    expect(model.sets.find((g) => g.setId === "unsorted")).toBeUndefined();
  });
});

describe("rearrange rows — placements + who works there (spec §6.2)", () => {
  it("lists placements with names, tiles, icons, and the station's worker", () => {
    // PLACE_ITEM buys the item now, so the fixture needs the funds.
    let state = stateWith({ wood: 20, fiber: 20 });
    state = rootReducer(state, {
      type: "PLACE_ITEM",
      itemId: "gathering-station",
      x: 1,
      y: 1,
      at: 0,
    });
    state = rootReducer(state, { type: "PLACE_ITEM", itemId: "moss-tuft", x: 6, y: 6, at: 0 });
    state = rootReducer(state, {
      type: "ASSIGN_JOB",
      pipId: state.activePipId,
      stationPlacementId: "place-1",
      at: T0 + 1000,
    });

    const model = buildSheetModel(state);
    expect(model.rearrange).toHaveLength(2);
    const station = model.rearrange.find((r) => r.placementId === "place-1");
    expect(station?.name).toBe("Gathering Station");
    // ROUND 2D: the starter gets an individually rolled name (no longer
    // its species name) — deterministic for seed 7 (state.ts's stateWith
    // fixture), same as every other assertion this suite already pins to
    // this seed's exact roll.
    expect(station?.workerName).toBe("Rowan");
    expect(station?.resolvedIcon.motif).toBe("basket");
    const tuft = model.rearrange.find((r) => r.placementId === "place-2");
    expect(tuft?.workerName).toBeNull();
  });

  it("placementHostsJob knows stations from decorations", () => {
    expect(placementHostsJob("gathering-station")).toBe(true);
    expect(placementHostsJob("moss-tuft")).toBe(false);
  });
});

/**
 * ROUND 2F INTEGRATE — the Keepsake Shelf's VISIBLE half. `state.keepsakes`
 * was written by round 2C's streak/milestone rewards and read by nothing:
 * the Build sheet showed a granted decoration at full price and the reducer
 * charged it. `PLACE_ITEM` now spends a keepsake first; these tests pin that
 * the card SAYS so, since "applied in core" and "visible to the player" are
 * separate acceptance criteria (spec §16 v1.3).
 */
describe("the Keepsake Shelf on a Build card (bible §5.4)", () => {
  const DECO = "cozy-lantern";

  function withKeepsake(count: number, resources: Record<string, number> = {}): GameState {
    return { ...stateWith(resources), keepsakes: count > 0 ? { [DECO]: count } : {} };
  }

  const cardFor = (state: GameState, id: string) =>
    allEntries(buildSheetModel(state)).find((e) => e.id === id)!;

  it("reads FREE and is affordable on an empty satchel", () => {
    const card = cardFor(withKeepsake(1), DECO);
    expect(card.keepsakes).toBe(1);
    expect(card.costLabel).toBe("Free");
    expect(card.keepsakeLabel).toBe("Free — a keepsake");
    expect(card.affordable).toBe(true);
    expect(card.missingLabel).toBe("");
  });

  it("names how many are on the shelf when there is more than one", () => {
    expect(cardFor(withKeepsake(3), DECO).keepsakeLabel).toBe(
      "Free — a keepsake (3 on the shelf)",
    );
  });

  it("says nothing at all when the shelf is empty (no phantom gold chip)", () => {
    const card = cardFor(withKeepsake(0, { wood: 99, fiber: 99 }), DECO);
    expect(card.keepsakes).toBe(0);
    expect(card.keepsakeLabel).toBeNull();
    expect(card.costLabel).not.toBe("Free");
  });

  it("agrees with the reducer: a card that says Free places without spending", () => {
    // The model and `PLACE_ITEM` must use the same ordering, or the sheet
    // promises a free placement the reducer then charges for.
    const state = withKeepsake(1, { wood: 0, fiber: 0 });
    expect(cardFor(state, DECO).buyable).toBe(true);
    const placed = rootReducer(state, { type: "PLACE_ITEM", itemId: DECO, x: 0, y: 0, at: T0 });
    expect(Object.keys(placed.keep.placements)).toHaveLength(1);
    expect(placed.resources["wood"] ?? 0).toBe(0);
    // …and the card stops advertising it once the shelf is empty.
    expect(cardFor(placed, DECO).keepsakeLabel).toBeNull();
  });
});


/**
 * ROUND 2F FIX — SET BONUSES ARE NOW STATED (bible §3.5).
 *
 * As shipped, every set header read exactly `Meadow Green · 0 of 7 placed` and,
 * once earned, `· bonus active`. Nothing in the game said WHAT the bonus was
 * (meadow-green's happiness −4%/−7%, tideline's cleanliness −4%/−7%,
 * lantern-ember's +5%/+10% Keep XP, bramble-twine's ×1.10/×1.18 naps,
 * deep-wood's +2%/+4% loot, first-snow's energy −4%/−7%) or that the 3-of-a-set
 * tier only goes live at Keep 3 and the 5-of-a-set at Keep 6 — 12 discrete,
 * non-random long-haul goals, all invisible. And because a decoration's own
 * effect is 1–2% (noise), the set payoff is the only legible reason to place one.
 */
describe("describeSetBonus — the bonus, in words (bible §3.5)", () => {
  const meadowGreen = decorSets.find((s) => s.id === "meadow-green")!;
  const cfg = tuning.progression.setBonus;

  it("states BOTH tiers, with their member counts and their real effects", () => {
    const info = describeSetBonus(meadowGreen, 0, 12, null);
    expect(info.tier1Line).toContain(`${cfg.minMembersTier1} placed:`);
    expect(info.tier2Line).toContain(`${cfg.minMembersTier2} placed:`);
    // Generated from the set's own effect data, so it can never drift from
    // what `core/keep/effects.ts` actually applies.
    expect(info.tier1Line).toBe(`3 placed: ${describeEffect(meadowGreen.bonusAt3)}`);
    expect(info.tier2Line).toBe(`5 placed: ${describeEffect(meadowGreen.bonusAt5)}`);
  });

  it("every set states a NON-EMPTY, distinct promise for both of its tiers", () => {
    for (const set of decorSets) {
      const info = describeSetBonus(set, 0, 12, null);
      expect(info.tier1Line.length, set.id).toBeGreaterThan(12);
      expect(info.tier2Line.length, set.id).toBeGreaterThan(12);
      expect(info.tier1Line, set.id).not.toBe(info.tier2Line);
    }
  });

  it("names the next step by COUNT, in words, exactly as the bible's example copy does", () => {
    expect(describeSetBonus(meadowGreen, 0, 12, null).nextStepLine).toBe(
      "three more for the set bonus",
    );
    expect(describeSetBonus(meadowGreen, 2, 12, null).nextStepLine).toBe(
      "one more for the set bonus",
    );
    expect(describeSetBonus(meadowGreen, 3, 12, 1).nextStepLine).toBe(
      "two more for the bigger bonus",
    );
  });

  it("stops nagging once the top tier is earned", () => {
    expect(describeSetBonus(meadowGreen, 5, 12, 2).nextStepLine).toBeNull();
    expect(describeSetBonus(meadowGreen, 7, 12, 2).nextStepLine).toBeNull();
  });

  it("explains the Keep-level gate rather than letting an unearned bonus look broken", () => {
    // Three members placed at Keep 2: the count is there, the tier is not live.
    const early = describeSetBonus(meadowGreen, 3, 2, null);
    expect(early.notYetLiveLine).toBe(
      `Set bonuses go live at Keep level ${cfg.tier1LiveAtKeepLevel}`,
    );
  });

  it("explains the SECOND gate too, once tier 1 is live but the Keep is short for tier 2", () => {
    const mid = describeSetBonus(meadowGreen, 5, cfg.tier1LiveAtKeepLevel, 1);
    expect(mid.notYetLiveLine).toBe(
      `The bigger bonus goes live at Keep level ${cfg.tier2LiveAtKeepLevel}`,
    );
  });

  it("says nothing about gates when the bonus is genuinely live", () => {
    expect(describeSetBonus(meadowGreen, 3, 12, 1).notYetLiveLine).toBeNull();
    expect(describeSetBonus(meadowGreen, 5, 12, 2).notYetLiveLine).toBeNull();
  });

  it("reports the live tier so the sheet can tick it off", () => {
    expect(describeSetBonus(meadowGreen, 0, 12, null).activeTier).toBeNull();
    expect(describeSetBonus(meadowGreen, 3, 12, 1).activeTier).toBe(1);
    expect(describeSetBonus(meadowGreen, 5, 12, 2).activeTier).toBe(2);
  });
});

describe("buildSheetModel — every set group carries its bonus copy", () => {
  it("all six sets get bonusInfo, so no group can silently go back to a bare tally", () => {
    const model = buildSheetModel(stateWith({}));
    const real = model.sets.filter((g) => g.setId !== "unsorted");
    expect(real.length).toBe(decorSets.length);
    for (const group of real) {
      expect(group.bonusInfo, group.setId).not.toBeNull();
      expect(group.bonusInfo?.tier1Line.length, group.setId).toBeGreaterThan(12);
      expect(group.bonusInfo?.tier2Line.length, group.setId).toBeGreaterThan(12);
    }
  });
});


/**
 * ROUND 2F — THE KEEPSAKE SHELF GETS ITS OWN SECTION (bible §5.5 item 1).
 * The reducer half and the per-card "Free — a keepsake" label both landed, but
 * the sheet had no shelf GROUP, so a day-5 streak player who chose a keepsake
 * had to remember which one and hunt for it among 45 cards.
 */
describe("buildSheetModel — the Keepsake Shelf group", () => {
  it("is empty when the shelf is empty, so the section is simply omitted", () => {
    expect(buildSheetModel(stateWith({})).keepsakes).toEqual([]);
  });

  it("lists one card per shelved gift, marked Free", () => {
    const base = stateWith({});
    const state: GameState = { ...base, keepsakes: { "cozy-lantern": 2 } };
    const model = buildSheetModel(state);
    expect(model.keepsakes.map((e) => e.id)).toEqual(["cozy-lantern"]);
    const card = model.keepsakes[0];
    expect(card?.costLabel).toBe("Free");
    expect(card?.keepsakes).toBe(2);
    expect(card?.keepsakeLabel).toBe("Free — a keepsake (2 on the shelf)");
    expect(card?.buyable).toBe(true);
  });

  it("a shelved gift is affordable on an EMPTY satchel — that is the whole point", () => {
    const base = createNewGame(7, T0);
    const state: GameState = {
      ...base,
      resources: {},
      keepsakes: { "cozy-lantern": 1 },
    };
    const card = buildSheetModel(state).keepsakes[0];
    expect(card?.affordable).toBe(true);
    expect(card?.missingLabel).toBe("");
  });

  it("agrees with the reducer: a shelf card places without spending", () => {
    const base = createNewGame(7, T0);
    const state: GameState = { ...base, resources: {}, keepsakes: { "cozy-lantern": 1 } };
    expect(buildSheetModel(state).keepsakes.length).toBe(1);
    const placed = rootReducer(state, {
      type: "PLACE_ITEM",
      itemId: "cozy-lantern",
      x: 0,
      y: 0,
      at: T0,
    });
    expect(placed.resources).toEqual({});
    // Shelf emptied → the group empties with it.
    expect(buildSheetModel(placed).keepsakes).toEqual([]);
  });
});

describe("locked cards still name their price (bible §5.5)", () => {
  it("every locked station has a non-empty costLabel to save toward", () => {
    const model = buildSheetModel(stateWith({}));
    const locked = model.stations.filter((e) => e.locked);
    expect(locked.length).toBeGreaterThan(0);
    for (const entry of locked) {
      expect(entry.costLabel.length, entry.id).toBeGreaterThan(0);
      expect(entry.lockLabel, entry.id).not.toBeNull();
    }
  });

  it("the Beacon — the priciest locked station — states all three resources", () => {
    const beacon = buildSheetModel(stateWith({})).stations.find((e) => e.id === "beacon");
    expect(beacon?.locked).toBe(true);
    expect(beacon?.costLabel).toContain("Wood");
    expect(beacon?.costLabel).toContain("Shell");
    expect(beacon?.costLabel).toContain("Driftwood");
  });
});
