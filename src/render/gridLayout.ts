/**
 * Grid diorama math (spec §9) — every pure calculation behind the Keep's
 * tile rendering, kept Pixi-free so it unit-tests in node.
 *
 * Fake-iso per spec §9: tiles are plain axis-aligned rectangles whose
 * height is a squashed fraction of their width (`tileAspect`), and depth
 * comes ONLY from y-sorting (`compareDepth`) — no isometric math.
 *
 * Coordinate spaces:
 * - TILE space: integer `(tx, ty)`, origin top-left, `ty` grows "toward
 *   the camera" (down the screen).
 * - WORLD space: scene pixels. An entity's anchor is its FEET (pips) or
 *   the bottom-center of its footprint (placeables); that anchor's `y`
 *   is its depth for sorting.
 *
 * Determinism: `pickFreeTile` draws from an injected rng stream
 * (core/rng — the repo's single PRNG), so wander-target selection is
 * reproducible in tests. `nearestFreeTile` and `cornerTiles` are fully
 * deterministic scans with no randomness at all.
 */

export interface GridLayout {
  readonly cols: number;
  readonly rows: number;
  /** Tile width in world px. */
  readonly tileW: number;
  /** Tile height in world px (tileW × tileAspect — the fake-iso squash). */
  readonly tileH: number;
  /** World position of tile (0, 0)'s top-left corner. */
  readonly originX: number;
  readonly originY: number;
}

export interface GridLayoutOptions {
  /** tileH / tileW. The vertical squash that fakes depth (spec §9). */
  readonly tileAspect?: number;
  /** Top of the vertical band the grid may occupy, as a fraction of the
   * view height (the sky lives above it). */
  readonly topFraction?: number;
  /** Bottom of the band, as a fraction of the view height. */
  readonly bottomFraction?: number;
  /** Max grid width as a fraction of the view width. */
  readonly widthFraction?: number;
  /** Floor on tile width so tiny viewports stay tappable. */
  readonly minTileW?: number;
}

const DEFAULTS: Required<GridLayoutOptions> = {
  tileAspect: 0.62,
  topFraction: 0.3,
  bottomFraction: 0.97,
  widthFraction: 0.94,
  minTileW: 18,
};

/**
 * Fit a `cols × rows` grid into the view: constrained horizontally by
 * `widthFraction` and vertically by the `[topFraction, bottomFraction]`
 * band, whichever is tighter. Centered horizontally; biased slightly
 * toward the bottom of the band vertically (the sky gets the slack).
 */
export function computeGridLayout(
  viewW: number,
  viewH: number,
  cols: number,
  rows: number,
  options: GridLayoutOptions = {},
): GridLayout {
  const o = { ...DEFAULTS, ...options };
  const bandTop = viewH * o.topFraction;
  const bandH = Math.max(0, viewH * o.bottomFraction - bandTop);
  const byWidth = (viewW * o.widthFraction) / cols;
  const byHeight = bandH / (rows * o.tileAspect);
  const tileW = Math.max(o.minTileW, Math.min(byWidth, byHeight));
  const tileH = tileW * o.tileAspect;
  const gridW = cols * tileW;
  const gridH = rows * tileH;
  return {
    cols,
    rows,
    tileW,
    tileH,
    originX: (viewW - gridW) / 2,
    originY: bandTop + Math.max(0, (bandH - gridH) * 0.6),
  };
}

/** World position of a tile's center — where a pip's feet stand. */
export function tileCenter(
  layout: GridLayout,
  tx: number,
  ty: number,
): { x: number; y: number } {
  return {
    x: layout.originX + (tx + 0.5) * layout.tileW,
    y: layout.originY + (ty + 0.5) * layout.tileH,
  };
}

/** World px → containing tile (floored; may lie outside the grid). */
export function worldToTile(
  layout: GridLayout,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: Math.floor((x - layout.originX) / layout.tileW),
    y: Math.floor((y - layout.originY) / layout.tileH),
  };
}

export function isInsideGrid(
  layout: Pick<GridLayout, "cols" | "rows">,
  tx: number,
  ty: number,
): boolean {
  return tx >= 0 && ty >= 0 && tx < layout.cols && ty < layout.rows;
}

/** Footprint in tiles (matches core/keep's shape structurally). */
export interface FootprintView {
  readonly w: number;
  readonly h: number;
}

/**
 * Snap a pointer to the top-left tile of a `fw × fh` footprint CENTERED
 * under it, clamped fully inside the grid (the placement ghost's grid
 * snap). Null when the footprint cannot fit at all.
 */
export function snapFootprint(
  layout: GridLayout,
  worldX: number,
  worldY: number,
  footprint: FootprintView,
): { x: number; y: number } | null {
  if (footprint.w > layout.cols || footprint.h > layout.rows) return null;
  const rawX = Math.round((worldX - layout.originX) / layout.tileW - footprint.w / 2);
  const rawY = Math.round((worldY - layout.originY) / layout.tileH - footprint.h / 2);
  return {
    x: Math.min(layout.cols - footprint.w, Math.max(0, rawX)),
    y: Math.min(layout.rows - footprint.h, Math.max(0, rawY)),
  };
}

/**
 * World anchor of a placed footprint: bottom-center of its tile rect.
 * Standing placeables draw upward from here, and this `y` is their depth
 * — a pip on the row below sorts in front, a pip above sorts behind.
 */
export function footprintAnchor(
  layout: GridLayout,
  tx: number,
  ty: number,
  footprint: FootprintView,
): { x: number; y: number } {
  return {
    x: layout.originX + (tx + footprint.w / 2) * layout.tileW,
    y: layout.originY + (ty + footprint.h) * layout.tileH,
  };
}

/** Canonical key for one tile (Set/Map membership). */
export function tileKey(tx: number, ty: number): string {
  return `${tx},${ty}`;
}

/** What blocked-tile collection needs to know per item id. `blocks`
 * defaults to true; flat ground decals (pebble path, shell mosaic) set
 * it false so pips amble right over them. */
export interface BlockingItemView {
  readonly footprint: FootprintView;
  readonly blocks?: boolean;
}

/** A placement, structurally (core/keep's Placement satisfies this). */
export interface PlacementView {
  readonly itemId: string;
  readonly x: number;
  readonly y: number;
}

/**
 * Every tile covered by a movement-blocking placement. Items missing
 * from the registry count as 1×1 blockers (mirror of core/keep's stale-
 * content default).
 */
export function collectBlockedTiles(
  placements: Readonly<Record<string, PlacementView>>,
  items: Readonly<Record<string, BlockingItemView>>,
): Set<string> {
  const blocked = new Set<string>();
  for (const placement of Object.values(placements)) {
    const item = items[placement.itemId];
    if (item !== undefined && item.blocks === false) continue;
    const fp = item?.footprint ?? { w: 1, h: 1 };
    for (let dx = 0; dx < fp.w; dx++) {
      for (let dy = 0; dy < fp.h; dy++) {
        blocked.add(tileKey(placement.x + dx, placement.y + dy));
      }
    }
  }
  return blocked;
}

/** The one rng operation tile picking needs (RngStream satisfies it). */
export interface TileRandom {
  int(maxExclusive: number): number;
}

export interface PickFreeTileOptions {
  /** Bias: only tiles within `maxDist` (Chebyshev) of `near`. When the
   * constrained set is empty the pick falls back to the whole grid. */
  readonly near?: { x: number; y: number };
  readonly maxDist?: number;
  /** Additional per-tile veto (e.g. "not my current tile"). */
  readonly exclude?: (tx: number, ty: number) => boolean;
}

/**
 * Pick a uniformly random free tile (spec §9 random walk targets).
 * Deterministic given the stream's cursor: candidates are enumerated in
 * row-major order and indexed by ONE `stream.int` draw. Returns null
 * only when the whole grid is blocked/excluded.
 */
export function pickFreeTile(
  stream: TileRandom,
  cols: number,
  rows: number,
  blocked: ReadonlySet<string>,
  options: PickFreeTileOptions = {},
): { x: number; y: number } | null {
  const collect = (constrained: boolean): { x: number; y: number }[] => {
    const out: { x: number; y: number }[] = [];
    for (let ty = 0; ty < rows; ty++) {
      for (let tx = 0; tx < cols; tx++) {
        if (blocked.has(tileKey(tx, ty))) continue;
        if (options.exclude?.(tx, ty) === true) continue;
        if (constrained && options.near !== undefined) {
          const dist = Math.max(
            Math.abs(tx - options.near.x),
            Math.abs(ty - options.near.y),
          );
          if (dist > (options.maxDist ?? Infinity)) continue;
        }
        out.push({ x: tx, y: ty });
      }
    }
    return out;
  };

  let candidates = collect(true);
  if (candidates.length === 0 && options.near !== undefined) {
    candidates = collect(false); // relax the bias, keep exclusions
  }
  if (candidates.length === 0) return null;
  return candidates[stream.int(candidates.length)] ?? null;
}

/**
 * Nearest free tile to `from` — ring scan by Chebyshev distance,
 * row-major inside each ring, so it is fully deterministic with no rng
 * (sulk corners, bed approach fallbacks). Null when everything blocks.
 */
export function nearestFreeTile(
  cols: number,
  rows: number,
  blocked: ReadonlySet<string>,
  from: { x: number; y: number },
): { x: number; y: number } | null {
  const maxRing = Math.max(cols, rows);
  for (let ring = 0; ring <= maxRing; ring++) {
    for (let ty = from.y - ring; ty <= from.y + ring; ty++) {
      for (let tx = from.x - ring; tx <= from.x + ring; tx++) {
        if (Math.max(Math.abs(tx - from.x), Math.abs(ty - from.y)) !== ring) {
          continue; // interior of the ring — already scanned
        }
        if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) continue;
        if (blocked.has(tileKey(tx, ty))) continue;
        return { x: tx, y: ty };
      }
    }
  }
  return null;
}

/** The grid's four corner tiles, in stable order (TL, TR, BL, BR). */
export function cornerTiles(
  cols: number,
  rows: number,
): readonly { x: number; y: number }[] {
  return [
    { x: 0, y: 0 },
    { x: cols - 1, y: 0 },
    { x: 0, y: rows - 1 },
    { x: cols - 1, y: rows - 1 },
  ];
}

/** One depth-sortable entity: anchor `y` is depth; `seq` (creation
 * order) breaks ties so equal-depth entities never flicker-swap. */
export interface DepthEntry {
  readonly depthY: number;
  readonly seq: number;
}

/**
 * The y-sort comparator (spec §9 fake-iso): lower on screen = closer to
 * the camera = drawn later. Ties resolve by `seq` so the order is total
 * and stable frame-to-frame.
 */
export function compareDepth(a: DepthEntry, b: DepthEntry): number {
  if (a.depthY !== b.depthY) return a.depthY - b.depthY;
  return a.seq - b.seq;
}
