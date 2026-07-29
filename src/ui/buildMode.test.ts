/**
 * Build-mode controller tests (spec §9 placement UI, §6.3 costs) — the
 * PURE model layer: catalog affordability with friendly shortfalls,
 * cost/missing copy, and the rearrange rows (incl. who works a station).
 * The DOM sheet is untested chrome around this (topBar.test.ts pattern);
 * tile validity is the scene's job (it reuses core/keep directly).
 */

import { describe, expect, it } from "vitest";
import { placeables } from "../content/placeables";
import { decorations } from "../content/decorations";
import { createNewGame, rootReducer } from "../core/state";
import type { GameState } from "../core/state";
import {
  buildCatalog,
  buildSheetModel,
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

describe("buildCatalog — placeables ∪ decorations (spec §9)", () => {
  it("lists every placeable (stations first) and every decoration", () => {
    const catalog = buildCatalog();
    expect(catalog.length).toBe(placeables.length + decorations.length);
    expect(catalog.slice(0, placeables.length).every((i) => i.kind === "station")).toBe(
      true,
    );
    expect(catalog.slice(placeables.length).every((i) => i.kind === "decoration")).toBe(
      true,
    );
  });

  it("findBuildItem resolves ids from both registries, null for unknowns", () => {
    expect(findBuildItem("gathering-station")?.footprint).toEqual({ w: 2, h: 2 });
    expect(findBuildItem("cozy-lantern")?.kind).toBe("decoration");
    expect(findBuildItem("hot-tub")).toBeNull();
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

describe("buildSheetModel — affordability (spec §6.3)", () => {
  it("greys out what the satchel cannot cover, with the missing amounts", () => {
    // 2 wood: Food Bowl (2 wood) affordable; Bed (4 wood + 3 fiber) not.
    const model = buildSheetModel(stateWith({ wood: 2 }));
    const bowl = model.entries.find((e) => e.id === "food-bowl");
    const bed = model.entries.find((e) => e.id === "bed");
    expect(bowl?.affordable).toBe(true);
    expect(bowl?.missingLabel).toBe("");
    expect(bed?.affordable).toBe(false);
    expect(bed?.missing).toEqual({ wood: 2, fiber: 3 });
    expect(bed?.missingLabel).toBe("Needs 2 more Wood and 3 more Fiber");
  });

  it("a rich satchel affords the whole catalog", () => {
    const model = buildSheetModel(
      stateWith({ wood: 99, fiber: 99, shell: 99, driftwood: 99, berry: 99 }),
    );
    expect(model.entries.every((e) => e.affordable)).toBe(true);
  });

  it("missingFor mirrors core/economy spend's shortfall shape", () => {
    expect(missingFor({ wood: 1 }, { wood: 4, fiber: 3 })).toEqual({
      wood: 3,
      fiber: 3,
    });
    expect(missingFor({ wood: 9 }, { wood: 4 })).toEqual({});
  });
});

describe("rearrange rows — placements + who works there (spec §6.2)", () => {
  it("lists placements with names, tiles, and the station's worker", () => {
    // PLACE_ITEM buys the item now, so the fixture needs the funds.
    let state = stateWith({ wood: 20, fiber: 20 });
    state = rootReducer(state, {
      type: "PLACE_ITEM",
      itemId: "gathering-station",
      x: 1,
      y: 1,
    });
    state = rootReducer(state, { type: "PLACE_ITEM", itemId: "moss-tuft", x: 6, y: 6 });
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
    expect(station?.workerName).toBe("Mosspip");
    const tuft = model.rearrange.find((r) => r.placementId === "place-2");
    expect(tuft?.workerName).toBeNull();
  });

  it("placementHostsJob knows stations from decorations", () => {
    expect(placementHostsJob("gathering-station")).toBe(true);
    expect(placementHostsJob("moss-tuft")).toBe(false);
  });
});
