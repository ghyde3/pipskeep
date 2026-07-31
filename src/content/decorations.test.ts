/**
 * Decoration + placeable registry tests (content bible §5, progression
 * bible §5). Reachability (can you ever afford it, does it stay cheaper
 * than the level it funds) is `core/economy/reachability.test.ts`'s job
 * and is data-driven off these same registries; this file guards the
 * CONTENT-authoring shape: ids, footprints, resource-bundle legality, and
 * the Stockpot's specific pricing relationship to the Gathering Station
 * (bible §3.5, §5.3).
 */

import { describe, expect, it } from "vitest";
import { RESOURCE_IDS } from "../core/economy";
import { gridBounds } from "../core/keep";
import { decorations } from "./decorations";
import { placeables } from "./placeables";
import { keepLevels } from "./keep";
import { tuning } from "./tuning";

import { recipes } from "./recipes";

const RESOURCE_SET = new Set<string>(RESOURCE_IDS);
const MAX_LEVEL = Math.max(...keepLevels.map((l) => l.level));

describe("decoration registry shape (content bible §5.1, progression bible §5.2)", () => {
  it("ships thirty-seven decorations — 32 buyable, plus round 2J's five craft-only keepsakes — all with unique ids", () => {
    expect(decorations).toHaveLength(37);
    expect(new Set(decorations.map((d) => d.id)).size).toBe(37);
    expect(decorations.filter((d) => d.craftOnly === true)).toHaveLength(5);
    expect(decorations.filter((d) => d.craftOnly !== true)).toHaveLength(32);
  });

  /**
   * ROUND 2J FIX STAGE — the craft-only contract, stated where a content
   * author will read it. An empty `cost` is only safe BECAUSE both doors
   * are shut: `ui/buildMode.ts`'s catalogue filters these out, and
   * `core/state.ts`'s PLACE_ITEM refuses one with an empty Keepsake Shelf.
   * A craft-only item that leaked into the catalogue would be a free
   * decoration printer.
   */
  it("every craft-only keepsake is the output of a real recipe, and nothing else is", () => {
    const craftedIds = new Set(
      Object.values(recipes)
        .filter((r) => r.output.kind === "keepsake")
        .map((r) => r.output.itemId),
    );
    const craftOnlyIds = new Set(
      decorations.filter((d) => d.craftOnly === true).map((d) => d.id),
    );
    expect([...craftOnlyIds].sort()).toEqual([...craftedIds].sort());
  });

  it("every decoration's cost bundle uses only real resources", () => {
    for (const d of decorations) {
      for (const resourceId of Object.keys(d.cost)) {
        expect(RESOURCE_SET.has(resourceId), `${d.id}: ${resourceId}`).toBe(true);
      }
    }
  });

  it("every decoration fits inside the fully-built Keep grid (12x14 by tier 9)", () => {
    const maxLevelBounds = gridBounds(MAX_LEVEL);
    for (const d of decorations) {
      expect(d.footprint.w, d.id).toBeLessThanOrEqual(maxLevelBounds.cols);
      expect(d.footprint.h, d.id).toBeLessThanOrEqual(maxLevelBounds.rows);
    }
  });

  it("the biggest footprint in the game is the Sun Awning, as the bible calls out", () => {
    const areas = decorations.map((d) => ({
      id: d.id,
      area: d.footprint.w * d.footprint.h,
    }));
    const maxArea = Math.max(...areas.map((a) => a.area));
    const biggest = areas.filter((a) => a.area === maxArea).map((a) => a.id);
    expect(biggest).toContain("sun-awning");
  });

  it("every decoration carries real, non-filler flavor text", () => {
    for (const d of decorations) {
      expect(d.flavor.trim().length, d.id).toBeGreaterThan(10);
      expect(d.flavor.toLowerCase(), d.id).not.toBe("a nice decoration.");
    }
  });
});

describe("placeable registry shape, plus the Stockpot's pricing relationship", () => {
  it("ships twenty-one registry ids: the original four, nine round-2F stations, round 2H's Poultice Shelf, round 2J's Craft Table, and round 2K's six attractions", () => {
    expect(placeables.map((p) => p.id).sort()).toEqual(
      [
        "food-bowl",
        "bed",
        "gathering-station",
        "stockpot",
        "wash-basin",
        "play-post",
        "larder",
        "nest-warmer",
        "trail-post",
        "workbench",
        "sun-bunks",
        "beacon",
        "weathervane",
        "poultice-shelf",
        "craft-table",
        // ROUND 2K (docs/liveliness-bible.md §1.2) — one attraction per biome.
        "clover-ring",
        "thicket-feeder",
        "sap-bucket",
        "snow-bell",
        "tidewrack",
        "lampwell",
      ].sort(),
    );
  });

  it("every placeable's cost is obtainable by its own unlockKeepLevel tier (progression bible §2.3)", () => {
    // ROUND 2F supersedes the old blanket "wood/fiber only" rule: a
    // placeable may now cost Shell/Driftwood, PROVIDED it doesn't unlock
    // until a tier where the Shore (shell/driftwood) has opened. The full,
    // authoritative version of this claim — built from the real
    // expedition registry, not a hand-written table — is
    // `core/economy/reachability.test.ts`'s `pricedPlaceables` suite; this
    // is the cheap content-side sanity check next to it.
    const RESOURCE_AVAILABLE_FROM: Readonly<Record<string, number>> = {
      wood: 1,
      fiber: 1,
      shell: 4,
      driftwood: 4,
      // ROUND 2J — the Snowdrift (tier 3) is lodestone's first source; the
      // Shore (tier 4) is where it arrives in volume.
      lodestone: 3,
    };
    for (const p of placeables) {
      for (const resourceId of Object.keys(p.cost)) {
        const availableFrom = RESOURCE_AVAILABLE_FROM[resourceId] ?? Infinity;
        expect(
          p.unlockKeepLevel,
          `${p.id}: needs ${resourceId} but unlocks before it's obtainable`,
        ).toBeGreaterThanOrEqual(availableFrom);
      }
    }
  });

  it("every placeable's unlockKeepLevel names a real Keep tier", () => {
    const knownLevels = new Set(keepLevels.map((l) => l.level));
    for (const p of placeables) {
      expect(knownLevels.has(p.unlockKeepLevel), p.id).toBe(true);
    }
  });

  it("the Stockpot costs more than the Gathering Station in BOTH resources (bible §3.5)", () => {
    const stockpot = placeables.find((p) => p.id === "stockpot");
    const gathering = placeables.find((p) => p.id === "gathering-station");
    expect(stockpot).toBeDefined();
    expect(gathering).toBeDefined();
    expect(stockpot!.cost.wood ?? 0).toBeGreaterThan(gathering!.cost.wood ?? 0);
    expect(stockpot!.cost.fiber ?? 0).toBeGreaterThan(gathering!.cost.fiber ?? 0);
  });

  it("the Stockpot's cost matches tuning.placeableCosts.stockpot exactly", () => {
    const stockpot = placeables.find((p) => p.id === "stockpot");
    expect(stockpot?.cost).toEqual(tuning.placeableCosts.stockpot);
  });

  it("every placeable carries real, non-filler flavor text", () => {
    for (const p of placeables) {
      expect(p.flavor.trim().length, p.id).toBeGreaterThan(10);
    }
  });
});
