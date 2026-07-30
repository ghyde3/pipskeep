/**
 * render/gridLayout.ts — the Keep diorama's pure tile math (spec §9).
 *
 * Covers: layout fitting (both constraint directions), tile↔world
 * round-trips, footprint snapping/clamping, blocked-tile collection
 * (footprints + flat walkable decals), DETERMINISTIC free-tile picking
 * via a seeded core/rng stream (same cursor → same pick, never a blocked
 * tile, near-bias honored with graceful relaxation), the ring-scan
 * nearest-free-tile, and the y-sort comparator's ordering + stability.
 */

import { describe, expect, it } from "vitest";
import { createRng } from "../core/rng";
import {
  collectBlockedTiles,
  compareDepth,
  computeGridLayout,
  cornerTiles,
  footprintAnchor,
  isInsideGrid,
  nearestFreeTile,
  pickFreeTile,
  snapFootprint,
  tileCenter,
  tileKey,
  worldToTile,
} from "./gridLayout";
import type { BlockingItemView } from "./gridLayout";

const ITEMS: Readonly<Record<string, BlockingItemView>> = {
  bowl: { footprint: { w: 1, h: 1 } },
  bed: { footprint: { w: 2, h: 1 } },
  station: { footprint: { w: 2, h: 2 } },
  path: { footprint: { w: 1, h: 1 }, blocks: false },
};

describe("computeGridLayout", () => {
  it("fits the grid inside the width constraint on narrow views", () => {
    const layout = computeGridLayout(375, 812, 8, 8);
    expect(layout.tileW * layout.cols).toBeLessThanOrEqual(375 * 0.94 + 1e-9);
    // Centered horizontally.
    expect(layout.originX).toBeCloseTo((375 - layout.cols * layout.tileW) / 2);
    // Fully inside the vertical band.
    expect(layout.originY).toBeGreaterThanOrEqual(812 * 0.3 - 1e-9);
    expect(layout.originY + layout.rows * layout.tileH).toBeLessThanOrEqual(
      812 * 0.97 + 1e-9,
    );
  });

  it("fits the grid inside the height band on wide views", () => {
    const layout = computeGridLayout(1280, 800, 8, 12);
    const bandH = 800 * 0.97 - 800 * 0.3;
    expect(layout.tileH * layout.rows).toBeLessThanOrEqual(bandH + 1e-9);
  });

  it("keeps the fake-iso squash: tileH = tileW × aspect", () => {
    const layout = computeGridLayout(1000, 800, 8, 8, { tileAspect: 0.5 });
    expect(layout.tileH).toBeCloseTo(layout.tileW * 0.5);
  });

  it("never shrinks tiles below the tappable floor", () => {
    const layout = computeGridLayout(120, 160, 8, 8, { minTileW: 18 });
    expect(layout.tileW).toBeGreaterThanOrEqual(18);
  });
});

/**
 * ROUND 2G REVIEW: the band ran to `0.97 × viewH` — 787.6px on a 375×812
 * phone — while the DOM chrome (Keep strip + action bar) starts at y 655, so
 * 133px of the band was underneath it. Measured at Keep level 4: 35px (10.8%)
 * of the drawn plot permanently occluded, with the standing Pip's entire
 * contact-shadow ellipse (y 655–680) inside that band, so the Pip read as
 * sunk into the XP bar and the celebratory level-4 screenshot cut it off at
 * the chin.
 *
 * Level 1's 8×8 grid escaped by arithmetic luck (bottom at 657.4 — 2.4px
 * lost), which is the part that matters: the defect grew with the Keep, so
 * the more the player built the less of it they could see.
 */
describe("computeGridLayout — the bottom chrome inset", () => {
  const CHROME = 157;

  it("keeps the whole plot clear of the bottom chrome at every Keep size", () => {
    // 8×8 (level 1) through 12×12 (the full plot) — the pre-fix bug only
    // showed on the larger grids.
    for (const size of [8, 9, 10, 11, 12]) {
      const layout = computeGridLayout(375, 812, size, size, {
        bottomInsetPx: CHROME,
      });
      const plotBottom = layout.originY + layout.rows * layout.tileH;
      expect(plotBottom, `${size}×${size} draws under the chrome`).toBeLessThanOrEqual(
        812 - CHROME + 1e-9,
      );
    }
  });

  it("defaults to no inset, so every existing caller is unchanged", () => {
    const withoutOption = computeGridLayout(375, 812, 8, 8);
    const withZero = computeGridLayout(375, 812, 8, 8, { bottomInsetPx: 0 });
    expect(withoutOption).toStrictEqual(withZero);
  });

  it("reserves PIXELS, not a fraction — the same inset costs the same on any viewport", () => {
    // The chrome is a fixed pixel stack, so a fraction that clears it on a
    // phone would over-reserve on a tall desktop. Both viewports must end up
    // with their plot bottom exactly `CHROME` clear of the bottom edge or
    // higher, never scaled.
    for (const viewH of [812, 1000, 1400]) {
      const layout = computeGridLayout(1280, viewH, 12, 12, { bottomInsetPx: CHROME });
      const plotBottom = layout.originY + layout.rows * layout.tileH;
      expect(plotBottom).toBeLessThanOrEqual(viewH - CHROME + 1e-9);
    }
  });

  it("a negative inset is ignored rather than growing the band past the screen", () => {
    const clamped = computeGridLayout(375, 812, 8, 8, { bottomInsetPx: -200 });
    expect(clamped).toStrictEqual(computeGridLayout(375, 812, 8, 8));
  });

  it("still yields a usable grid when the inset swallows most of the band", () => {
    const layout = computeGridLayout(375, 812, 8, 8, { bottomInsetPx: 700 });
    expect(layout.tileW).toBeGreaterThanOrEqual(18); // the tappable floor holds
    expect(Number.isFinite(layout.originY)).toBe(true);
  });
});

describe("tile ↔ world mapping", () => {
  const layout = computeGridLayout(800, 600, 8, 8);

  it("round-trips every tile through its center", () => {
    for (let ty = 0; ty < 8; ty++) {
      for (let tx = 0; tx < 8; tx++) {
        const center = tileCenter(layout, tx, ty);
        expect(worldToTile(layout, center.x, center.y)).toEqual({ x: tx, y: ty });
      }
    }
  });

  it("isInsideGrid matches the bounds", () => {
    expect(isInsideGrid(layout, 0, 0)).toBe(true);
    expect(isInsideGrid(layout, 7, 7)).toBe(true);
    expect(isInsideGrid(layout, 8, 0)).toBe(false);
    expect(isInsideGrid(layout, 0, -1)).toBe(false);
  });

  it("footprintAnchor sits at the bottom-center of the footprint", () => {
    const anchor = footprintAnchor(layout, 2, 3, { w: 2, h: 2 });
    expect(anchor.x).toBeCloseTo(layout.originX + 3 * layout.tileW);
    expect(anchor.y).toBeCloseTo(layout.originY + 5 * layout.tileH);
  });
});

describe("snapFootprint", () => {
  const layout = computeGridLayout(800, 600, 8, 8);

  it("centers the footprint under the pointer", () => {
    // Odd footprints center on the pointed-at tile...
    const c = tileCenter(layout, 4, 4);
    expect(snapFootprint(layout, c.x, c.y, { w: 1, h: 1 })).toEqual({ x: 4, y: 4 });
    // ...even footprints center on the nearest tile corner: the corner
    // between tiles (3,3)/(4,4) puts a 2×2's top-left at (3, 3).
    const corner = {
      x: layout.originX + 4 * layout.tileW,
      y: layout.originY + 4 * layout.tileH,
    };
    expect(snapFootprint(layout, corner.x, corner.y, { w: 2, h: 2 })).toEqual({
      x: 3,
      y: 3,
    });
  });

  it("clamps to the grid edges", () => {
    expect(snapFootprint(layout, -1e4, -1e4, { w: 2, h: 1 })).toEqual({ x: 0, y: 0 });
    expect(snapFootprint(layout, 1e4, 1e4, { w: 2, h: 2 })).toEqual({ x: 6, y: 6 });
  });

  it("returns null when the footprint cannot fit", () => {
    expect(snapFootprint(layout, 0, 0, { w: 9, h: 1 })).toBeNull();
  });
});

describe("collectBlockedTiles", () => {
  it("expands footprints and skips flat (walkable) decals", () => {
    const blocked = collectBlockedTiles(
      {
        "place-1": { itemId: "station", x: 1, y: 1 },
        "place-2": { itemId: "path", x: 5, y: 5 },
        "place-3": { itemId: "bed", x: 6, y: 0 },
      },
      ITEMS,
    );
    // 2×2 station covers four tiles.
    expect(blocked.has(tileKey(1, 1))).toBe(true);
    expect(blocked.has(tileKey(2, 1))).toBe(true);
    expect(blocked.has(tileKey(1, 2))).toBe(true);
    expect(blocked.has(tileKey(2, 2))).toBe(true);
    // 2×1 bed covers two.
    expect(blocked.has(tileKey(6, 0))).toBe(true);
    expect(blocked.has(tileKey(7, 0))).toBe(true);
    // Flat path never blocks.
    expect(blocked.has(tileKey(5, 5))).toBe(false);
    expect(blocked.size).toBe(6);
  });

  it("treats unknown items as 1×1 blockers (stale-content default)", () => {
    const blocked = collectBlockedTiles(
      { "place-1": { itemId: "gone-from-content", x: 3, y: 3 } },
      ITEMS,
    );
    expect(blocked.has(tileKey(3, 3))).toBe(true);
    expect(blocked.size).toBe(1);
  });
});

describe("pickFreeTile (deterministic wander targets, spec §9)", () => {
  it("is deterministic: same seeded stream cursor → same sequence", () => {
    const blocked = new Set([tileKey(0, 0), tileKey(3, 3)]);
    const a = createRng(1234).stream("wander");
    const b = createRng(1234).stream("wander");
    for (let i = 0; i < 20; i++) {
      expect(pickFreeTile(a, 8, 8, blocked)).toEqual(pickFreeTile(b, 8, 8, blocked));
    }
  });

  it("never returns a blocked or excluded tile", () => {
    const blocked = new Set<string>();
    for (let tx = 0; tx < 8; tx++) {
      for (let ty = 0; ty < 4; ty++) blocked.add(tileKey(tx, ty));
    }
    const stream = createRng(42).stream("wander");
    for (let i = 0; i < 50; i++) {
      const tile = pickFreeTile(stream, 8, 8, blocked, {
        exclude: (tx, ty) => tx === 4 && ty === 4,
      });
      expect(tile).not.toBeNull();
      if (tile !== null) {
        expect(blocked.has(tileKey(tile.x, tile.y))).toBe(false);
        expect(tile).not.toEqual({ x: 4, y: 4 });
        expect(tile.y).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it("honors the near-bias radius (loitering by the Food Bowl)", () => {
    const stream = createRng(7).stream("wander");
    for (let i = 0; i < 50; i++) {
      const tile = pickFreeTile(stream, 8, 8, new Set(), {
        near: { x: 2, y: 2 },
        maxDist: 2,
      });
      expect(tile).not.toBeNull();
      if (tile !== null) {
        expect(Math.max(Math.abs(tile.x - 2), Math.abs(tile.y - 2))).toBeLessThanOrEqual(2);
      }
    }
  });

  it("relaxes the near-bias when everything nearby is blocked", () => {
    const blocked = new Set<string>();
    for (let tx = 0; tx <= 4; tx++) {
      for (let ty = 0; ty <= 4; ty++) blocked.add(tileKey(tx, ty));
    }
    const stream = createRng(9).stream("wander");
    const tile = pickFreeTile(stream, 8, 8, blocked, {
      near: { x: 2, y: 2 },
      maxDist: 2,
    });
    expect(tile).not.toBeNull();
    if (tile !== null) {
      expect(blocked.has(tileKey(tile.x, tile.y))).toBe(false);
    }
  });

  it("returns null only on a fully blocked grid", () => {
    const blocked = new Set<string>();
    for (let tx = 0; tx < 2; tx++) {
      for (let ty = 0; ty < 2; ty++) blocked.add(tileKey(tx, ty));
    }
    const stream = createRng(1).stream("wander");
    expect(pickFreeTile(stream, 2, 2, blocked)).toBeNull();
  });
});

describe("nearestFreeTile + corners (sulk destinations)", () => {
  it("returns the tile itself when free", () => {
    expect(nearestFreeTile(8, 8, new Set(), { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it("ring-scans outward deterministically when blocked", () => {
    const blocked = new Set([tileKey(0, 0)]);
    // Ring 1 in row-major order from (0,0): (-1,-1)…(1,-1) out of grid,
    // then (-1,0) out, (1,0) in-grid free → the pick.
    expect(nearestFreeTile(8, 8, blocked, { x: 0, y: 0 })).toEqual({ x: 1, y: 0 });
  });

  it("returns null when the whole grid blocks", () => {
    const blocked = new Set([tileKey(0, 0)]);
    expect(nearestFreeTile(1, 1, blocked, { x: 0, y: 0 })).toBeNull();
  });

  it("cornerTiles covers the four corners in stable order", () => {
    expect(cornerTiles(8, 12)).toEqual([
      { x: 0, y: 0 },
      { x: 7, y: 0 },
      { x: 0, y: 11 },
      { x: 7, y: 11 },
    ]);
  });
});

describe("compareDepth (y-sorting, spec §9 fake-iso)", () => {
  it("orders by depth y: lower on screen renders in front", () => {
    const a = { depthY: 100, seq: 5 };
    const b = { depthY: 200, seq: 1 };
    expect(compareDepth(a, b)).toBeLessThan(0);
    expect(compareDepth(b, a)).toBeGreaterThan(0);
  });

  it("breaks depth ties by creation order (stable, no z-flicker)", () => {
    const first = { depthY: 150, seq: 1 };
    const second = { depthY: 150, seq: 2 };
    expect(compareDepth(first, second)).toBeLessThan(0);
    expect(compareDepth(second, first)).toBeGreaterThan(0);
    expect(compareDepth(first, first)).toBe(0);
  });

  it("sorts a mixed crowd exactly by (depth, seq)", () => {
    const entries = [
      { depthY: 300, seq: 0 }, // pip near the camera
      { depthY: 120, seq: 1 }, // bed further up
      { depthY: 120, seq: 2 }, // pip ON the bed (same depth, later seq)
      { depthY: 40, seq: 3 }, // egg at the back
    ];
    const sorted = [...entries].sort(compareDepth);
    expect(sorted.map((e) => e.seq)).toEqual([3, 1, 2, 0]);
  });
});
