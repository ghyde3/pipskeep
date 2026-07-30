/**
 * Keep grid placement tests (spec §9, Phase 5 gate):
 *
 * - Grid bounds: 8×8 at level 1; level 2 adds the +4×8 plot (rows grow
 *   to 12 at the same 8-column width) — straight from tuning.
 * - placeItem/moveItem/removeItem: content-defined footprints (Food
 *   Bowl 1×1, Bed 2×1, Gathering Station 2×2, decorations per
 *   registry), bounds checks, footprint-rectangle collision, TYPED
 *   refusals — never exceptions.
 * - Reducer wiring: PLACE_ITEM mints sequential `place-<n>` ids AND
 *   buys the item (all-or-nothing content-cost spend, spec §6.3);
 *   REMOVE_ITEM refunds in full; refusals (grid or affordability)
 *   return the state unchanged by reference.
 * - Placement survives a full serialize → JSON wire → migrate round
 *   trip deep-equal (the Phase 5 "survives reload" gate, done the same
 *   way Phase 4 proved expedition timers).
 */

import { describe, expect, it } from "vitest";
import { tuning } from "../../content/tuning";
import { placeables } from "../../content/placeables";
import { decorations } from "../../content/decorations";
import { createNewGame, rootReducer } from "../state";
import type { GameState } from "../state";
import { toSaveBlob } from "../save/serialize";
import { migrate } from "../save/migrate";
import { createKeep, gridBounds, moveItem, placeItem, removeItem } from "./index";
import type { KeepState } from "./index";

const footprintOf = (id: string): { w: number; h: number } => {
  const def =
    placeables.find((p) => p.id === id) ?? decorations.find((d) => d.id === id);
  if (def === undefined) throw new Error(`unknown item ${id}`);
  return def.footprint;
};

function keepWith(
  level: number,
  placements: KeepState["placements"] = {},
): KeepState {
  return { level, placements };
}

describe("gridBounds — spec §9 plot growth", () => {
  it("is 8×8 at level 1 and gains the +4×8 plot at level 2 (from tuning)", () => {
    expect(gridBounds(1)).toEqual({ cols: 8, rows: 8 });
    expect(gridBounds(2)).toEqual({ cols: 8, rows: 12 });
    // Level 3 adds no plot in tuning — bounds carry the level-2 growth.
    expect(gridBounds(3)).toEqual({ cols: 8, rows: 12 });
    // The numbers above ARE the tuning values, not parallel constants.
    expect(tuning.keepGrid).toMatchObject({ cols: 8, rows: 8 });
    expect(tuning.keepGrid.growthPerLevel[2]).toEqual({ cols: 0, rows: 4 });
  });
});

describe("placeItem — footprints, bounds, collision (spec §9)", () => {
  it("content defines the footprints: bowl 1×1, bed 2×1, station 2×2", () => {
    expect(footprintOf("food-bowl")).toEqual({ w: 1, h: 1 });
    expect(footprintOf("bed")).toEqual({ w: 2, h: 1 });
    expect(footprintOf("gathering-station")).toEqual({ w: 2, h: 2 });
  });

  it("places an item and stores its top-left tile", () => {
    const result = placeItem(createKeep(), "place-1", "gathering-station", 2, 3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.keep.placements).toEqual({
      "place-1": { itemId: "gathering-station", x: 2, y: 3 },
    });
  });

  it("refuses unknown items (typed, no exception)", () => {
    const result = placeItem(createKeep(), "place-1", "hot-tub", 0, 0);
    expect(result).toEqual({
      ok: false,
      refusal: { kind: "unknownItem", placementId: "place-1" },
    });
  });

  it("bounds-checks the WHOLE footprint at the current level", () => {
    const keep = createKeep(); // level 1 → 8×8
    // A 2×2 station fits at (6,6) — its far corner is tile (7,7)...
    expect(placeItem(keep, "p", "gathering-station", 6, 6).ok).toBe(true);
    // ...but not at (7,7), (7,0) or (0,7): the footprint escapes.
    for (const [x, y] of [[7, 7], [7, 0], [0, 7]] as const) {
      const result = placeItem(keep, "p", "gathering-station", x, y);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.refusal.kind).toBe("outOfBounds");
    }
    // Negative and non-integer coordinates are out of bounds too.
    for (const [x, y] of [[-1, 0], [0, -1], [1.5, 2]] as const) {
      const result = placeItem(keep, "p", "food-bowl", x, y);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.refusal.kind).toBe("outOfBounds");
    }
  });

  it("the level-2 plot legalizes rows 8–11 (spec §9: Level 2 adds +4×8)", () => {
    const atLevel1 = placeItem(keepWith(1), "p", "bed", 0, 10);
    expect(atLevel1.ok).toBe(false);
    if (!atLevel1.ok) expect(atLevel1.refusal.kind).toBe("outOfBounds");

    const atLevel2 = placeItem(keepWith(2), "p", "bed", 0, 10);
    expect(atLevel2.ok).toBe(true);
    // The plot grows rows, not columns: x = 8 stays illegal at level 2.
    const wide = placeItem(keepWith(2), "p", "food-bowl", 8, 0);
    expect(wide.ok).toBe(false);
  });

  it("collides footprint-rectangle against footprint-rectangle", () => {
    const placed = placeItem(createKeep(), "place-1", "gathering-station", 2, 2);
    if (!placed.ok) throw new Error("setup failed");
    const keep = placed.keep;

    // Every tile the 2×2 station covers (and partial overlaps) refuse —
    // including a 2×1 bed poking in from the left edge at (1,3)/(1,2).
    for (const [x, y] of [[2, 2], [3, 3], [1, 3], [1, 2]] as const) {
      const result = placeItem(keep, "place-2", "bed", x, y);
      expect(result.ok, `bed at ${x},${y}`).toBe(false);
      if (!result.ok) {
        expect(result.refusal).toEqual({
          kind: "collision",
          placementId: "place-2",
          blockingPlacementId: "place-1",
        });
      }
    }
    // Adjacent tiles do not collide (half-open rects).
    expect(placeItem(keep, "place-2", "bed", 4, 2).ok).toBe(true);
    expect(placeItem(keep, "place-2", "food-bowl", 2, 4).ok).toBe(true);
  });

  it("refuses a placement id that is already in use (reducer mints ids)", () => {
    const placed = placeItem(createKeep(), "place-1", "food-bowl", 0, 0);
    if (!placed.ok) throw new Error("setup failed");
    const dup = placeItem(placed.keep, "place-1", "food-bowl", 5, 5);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.refusal.kind).toBe("duplicateId");
  });
});

describe("moveItem / removeItem (spec §9)", () => {
  const seeded = (): KeepState => {
    let keep = createKeep();
    for (const [id, itemId, x, y] of [
      ["place-1", "gathering-station", 0, 0],
      ["place-2", "bed", 4, 4],
    ] as const) {
      const result = placeItem(keep, id, itemId, x, y);
      if (!result.ok) throw new Error("setup failed");
      keep = result.keep;
    }
    return keep;
  };

  it("moves within bounds, keeping the item id", () => {
    const result = moveItem(seeded(), "place-2", 6, 7);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.keep.placements["place-2"]).toEqual({
      itemId: "bed",
      x: 6,
      y: 7,
    });
  });

  it("never collides with itself — a one-tile nudge overlapping the old spot is legal", () => {
    const result = moveItem(seeded(), "place-1", 1, 1);
    expect(result.ok).toBe(true);
  });

  it("refuses collision with OTHER placements, out-of-bounds, and unknown ids", () => {
    const ontoStation = moveItem(seeded(), "place-2", 1, 1);
    expect(ontoStation.ok).toBe(false);
    if (!ontoStation.ok) {
      expect(ontoStation.refusal).toEqual({
        kind: "collision",
        placementId: "place-2",
        blockingPlacementId: "place-1",
      });
    }
    const outside = moveItem(seeded(), "place-2", 7, 0); // 2×1 bed → x+2 > 8
    expect(outside.ok).toBe(false);
    if (!outside.ok) expect(outside.refusal.kind).toBe("outOfBounds");

    const unknown = moveItem(seeded(), "place-99", 0, 0);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.refusal.kind).toBe("unknownPlacement");
  });

  it("removes a placement; unknown ids refuse", () => {
    const removed = removeItem(seeded(), "place-1");
    expect(removed.ok).toBe(true);
    if (removed.ok) {
      expect(Object.keys(removed.keep.placements)).toEqual(["place-2"]);
      // The freed tiles are placeable again.
      expect(placeItem(removed.keep, "place-3", "bed", 0, 0).ok).toBe(true);
    }
    const unknown = removeItem(seeded(), "place-99");
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.refusal.kind).toBe("unknownPlacement");
  });
});

describe("reducer wiring + reload survival (Phase 5 gate)", () => {
  const T0 = 1_000_000;

  /** Fresh game with enough granted resources to buy the test items —
   * PLACE_ITEM charges the content cost (spec §6.3). */
  const freshWithResources = (): GameState =>
    rootReducer(createNewGame(7, T0), {
      type: "DEBUG_GRANT",
      resources: { wood: 20, fiber: 20 },
    });

  it("PLACE_ITEM mints sequential ids; refusals return the state unchanged by reference", () => {
    const fresh = freshWithResources();
    const one = rootReducer(fresh, {
      type: "PLACE_ITEM",
      itemId: "gathering-station",
      x: 2,
      y: 2, at: 0 });
    const two = rootReducer(one, { type: "PLACE_ITEM", itemId: "bed", x: 5, y: 5, at: 0 });
    expect(two.keep.placements).toEqual({
      "place-1": { itemId: "gathering-station", x: 2, y: 2 },
      "place-2": { itemId: "bed", x: 5, y: 5 },
    });
    expect(two.nextPlacementNumber).toBe(3);

    // Colliding placement: unchanged state, same reference, no id burned.
    const refused = rootReducer(two, {
      type: "PLACE_ITEM",
      itemId: "food-bowl",
      x: 2,
      y: 2, at: 0 });
    expect(refused).toBe(two);

    // MOVE/REMOVE flow through the same core rules.
    const moved = rootReducer(two, {
      type: "MOVE_ITEM",
      placementId: "place-2",
      x: 0,
      y: 6, at: 0 });
    expect(moved.keep.placements["place-2"]).toEqual({ itemId: "bed", x: 0, y: 6 });
    expect(rootReducer(two, { type: "MOVE_ITEM", placementId: "nope", x: 0, y: 0, at: 0 })).toBe(two);
    const removed = rootReducer(moved, { type: "REMOVE_ITEM", placementId: "place-1", at: 0 });
    expect(removed.keep.placements["place-1"]).toBeUndefined();
  });

  it("PLACE_ITEM buys the item; short = refused; REMOVE_ITEM refunds (spec §6.3)", () => {
    // A fresh save can afford nothing (3 seed Berries are inventory, not
    // resources) — even a grid-valid placement is refused unchanged.
    const fresh = createNewGame(7, T0);
    expect(
      rootReducer(fresh, { type: "PLACE_ITEM", itemId: "food-bowl", x: 0, y: 0, at: 0 }),
    ).toBe(fresh);

    const granted = rootReducer(fresh, {
      type: "DEBUG_GRANT",
      resources: { wood: 10, fiber: 4 },
    });
    const placed = rootReducer(granted, {
      type: "PLACE_ITEM",
      itemId: "gathering-station",
      x: 2,
      y: 2, at: 0 });
    // Exactly the content cost (round 2B: 3 Wood + 2 Fiber), all-or-nothing.
    expect(placed.keep.placements["place-1"]).toEqual({
      itemId: "gathering-station",
      x: 2,
      y: 2,
    });
    expect(placed.resources).toEqual({ wood: 7, fiber: 2 });
    expect(
      placeables.find((p) => p.id === "gathering-station")?.cost,
    ).toEqual({ wood: 3, fiber: 2 });

    // Moving is free.
    const moved = rootReducer(placed, {
      type: "MOVE_ITEM",
      placementId: "place-1",
      x: 4,
      y: 4, at: 0 });
    expect(moved.resources).toEqual(placed.resources);

    // Tuck away = full refund (no stored-items inventory in MVP, so the
    // materials come back instead of the item going somewhere).
    const removed = rootReducer(moved, { type: "REMOVE_ITEM", placementId: "place-1", at: 0 });
    expect(removed.keep.placements["place-1"]).toBeUndefined();
    expect(removed.resources).toEqual({ wood: 10, fiber: 4 });
  });

  it("placements (and a standing job) survive serialize → wire → migrate deep-equal", () => {
    let state: GameState = freshWithResources();
    state = rootReducer(state, { type: "PLACE_ITEM", itemId: "gathering-station", x: 1, y: 1, at: 0 });
    state = rootReducer(state, { type: "PLACE_ITEM", itemId: "cozy-lantern", x: 6, y: 6, at: 0 });
    state = rootReducer(state, {
      type: "ASSIGN_JOB",
      pipId: state.activePipId,
      stationPlacementId: "place-1",
      at: T0 + 1_000,
    });
    expect(state.jobs[state.activePipId]).toBeDefined();

    // The §8 wire trip: envelope → JSON → migrate (current version passes
    // through) → deep-equal, placements and job timestamps intact.
    const wire = JSON.parse(
      JSON.stringify(toSaveBlob(state, T0 + 2_000)),
    ) as unknown;
    const result = migrate(wire);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.save.state).toStrictEqual(state);
  });
});
