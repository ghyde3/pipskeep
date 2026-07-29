/**
 * Keep domain (spec §9) — habitat state, plots, grid placement.
 *
 * The Keep is a tile grid: 8×8 at level 1, growing by tuning-defined
 * rows/cols at later levels (Level 2 adds the +4×8 plot — spec §9). All
 * placement legality lives here as pure functions with TYPED refusals
 * (never exceptions): bounds checks against `gridBounds(level)` and
 * footprint-rectangle collision against every existing placement.
 *
 * Footprints are CONTENT-DEFINED (spec §3): core reads them through the
 * structural `PlacementItemRegistryView`, which defaults to the merged
 * placeables + decorations registries — adding a placeable or decoration
 * never touches this module (spec §2 rule 5).
 *
 * `KeepState` is the `state.keep` slice of GameState: plain serializable
 * data (spec §8). Placement ids are opaque here; the reducer mints them
 * (`place-<n>` via `state.nextPlacementNumber`, the nextPipNumber
 * pattern).
 *
 * Purity: no clock, no randomness — placement is fully deterministic
 * spatial math. ZERO tuning literals; grid numbers come from the tuning
 * object (defaults to `content/tuning.ts`, injectable for tests).
 */

import { tuning as contentTuning } from "../../content/tuning";
import { placeables as contentPlaceables } from "../../content/placeables";
import { decorations as contentDecorations } from "../../content/decorations";

/** Keep levels gate content (spec §9): 1 = start, 2 = Forest, 3 = Shore. */
export type KeepLevel = 1 | 2 | 3;

export interface GridPosition {
  x: number;
  y: number;
}

/** Footprint of a placeable in grid tiles. */
export interface Footprint {
  w: number;
  h: number;
}

/** Identifier of one placed item instance (`place-<n>`, reducer-minted). */
export type PlacementId = string;

/** One placed item: which content item, and its top-left grid tile. */
export interface Placement {
  /** Placeable or decoration id (content registries). */
  readonly itemId: string;
  readonly x: number;
  readonly y: number;
}

/**
 * The `state.keep` slice (spec §9): the Keep's level plus every placed
 * item. Level 1 = start; 2 unlocks Forest + the extra plot; 3 unlocks
 * Shore + makes the roster upgrade purchasable.
 */
export interface KeepState {
  readonly level: number;
  readonly placements: Readonly<Record<PlacementId, Placement>>;
}

/** A fresh level-1 Keep with nothing placed. */
export function createKeep(): KeepState {
  return { level: 1, placements: {} };
}

/** The slice of tuning the grid math reads (injectable for tests). */
export interface KeepTuning {
  readonly keepGrid: {
    readonly cols: number;
    readonly rows: number;
    /** Extra cols/rows unlocked AT each level, cumulative (spec §9). */
    readonly growthPerLevel: Readonly<
      Partial<Record<number, { readonly cols: number; readonly rows: number }>>
    >;
  };
}

/**
 * Grid bounds at a Keep level (spec §9): the starting area plus every
 * growth entry for levels ≤ `level`, accumulated. Level 1 = 8×8; level 2+
 * adds the +4×8 plot (4 rows) by default tuning.
 */
export function gridBounds(
  level: number,
  tuning: KeepTuning = contentTuning,
): { cols: number; rows: number } {
  let { cols, rows } = tuning.keepGrid;
  for (const [lvl, growth] of Object.entries(tuning.keepGrid.growthPerLevel)) {
    if (growth !== undefined && Number(lvl) <= level) {
      cols += growth.cols;
      rows += growth.rows;
    }
  }
  return { cols, rows };
}

/** What core needs to know about a placeable item: its footprint.
 * Content-defined (spec §3); ids are opaque here. */
export interface PlacementItemView {
  readonly footprint: Footprint;
}

export type PlacementItemRegistryView = Readonly<
  Record<string, PlacementItemView>
>;

/** Default placement-item view: placeables ∪ decorations (both share the
 * grid rules, spec §9). Built once — content registries are static. */
const DEFAULT_PLACEMENT_ITEMS: PlacementItemRegistryView = (() => {
  const items: Record<string, PlacementItemView> = {};
  for (const def of contentPlaceables) items[def.id] = { footprint: def.footprint };
  for (const def of contentDecorations) items[def.id] = { footprint: def.footprint };
  return items;
})();

/** Injectable content for placement checks, defaulting to the real
 * registries/tuning. */
export interface KeepContent {
  readonly items?: PlacementItemRegistryView;
  readonly tuning?: KeepTuning;
}

/**
 * Why a placement request was refused. All structural (the world said
 * no, not a pip — no dialogue): `unknownItem` (not in any placement
 * registry), `unknownPlacement` (move/remove of an id that isn't
 * placed), `duplicateId` (place with an id already in use — the reducer
 * mints ids, so this marks a caller bug), `outOfBounds` (footprint
 * escapes the grid at the CURRENT level, or non-integer coords),
 * `collision` (footprint overlaps an existing placement).
 */
export type PlacementRefusalKind =
  | "unknownItem"
  | "unknownPlacement"
  | "duplicateId"
  | "outOfBounds"
  | "collision";

export interface PlacementRefusal {
  readonly kind: PlacementRefusalKind;
  readonly placementId: PlacementId;
  /** Set on `collision`: the placement already occupying the tiles. */
  readonly blockingPlacementId?: PlacementId;
}

export type PlacementResult =
  | { readonly ok: true; readonly keep: KeepState }
  | { readonly ok: false; readonly refusal: PlacementRefusal };

const refuse = (
  kind: PlacementRefusalKind,
  placementId: PlacementId,
  blockingPlacementId?: PlacementId,
): PlacementResult => ({
  ok: false,
  refusal: {
    kind,
    placementId,
    ...(blockingPlacementId !== undefined ? { blockingPlacementId } : {}),
  },
});

/** Footprint of a placement, looked up via the item registry. Items
 * missing from the registry (content removed between sessions) default
 * to 1×1 so stale placements still collide/render somewhere sane. */
function footprintOf(
  itemId: string,
  items: PlacementItemRegistryView,
): Footprint {
  return items[itemId]?.footprint ?? { w: 1, h: 1 };
}

/** Axis-aligned rectangle overlap on the half-open tile rects
 * `[x, x+w) × [y, y+h)`. */
function overlaps(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** True when the footprint sits fully inside the grid at this level and
 * on integer tiles (grid snap is a UI nicety; core REQUIRES it). */
function inBounds(
  x: number,
  y: number,
  footprint: Footprint,
  level: number,
  tuning: KeepTuning,
): boolean {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return false;
  const { cols, rows } = gridBounds(level, tuning);
  return x >= 0 && y >= 0 && x + footprint.w <= cols && y + footprint.h <= rows;
}

/** First existing placement whose footprint overlaps the candidate rect,
 * ignoring `exceptId` (so moveItem doesn't collide with itself).
 * Deterministic: placements are scanned in key insertion order. */
function findCollision(
  keep: KeepState,
  rect: { x: number; y: number; w: number; h: number },
  items: PlacementItemRegistryView,
  exceptId?: PlacementId,
): PlacementId | null {
  for (const [id, placement] of Object.entries(keep.placements)) {
    if (id === exceptId) continue;
    const footprint = footprintOf(placement.itemId, items);
    if (
      overlaps(rect, {
        x: placement.x,
        y: placement.y,
        w: footprint.w,
        h: footprint.h,
      })
    ) {
      return id;
    }
  }
  return null;
}

/**
 * Place a new item at `(x, y)` under `placementId` (spec §9
 * tap-to-place). Refusals: unknownItem, duplicateId, outOfBounds,
 * collision. Pure — the input Keep is never mutated.
 */
export function placeItem(
  keep: KeepState,
  placementId: PlacementId,
  itemId: string,
  x: number,
  y: number,
  content: KeepContent = {},
): PlacementResult {
  const items = content.items ?? DEFAULT_PLACEMENT_ITEMS;
  const tuning = content.tuning ?? contentTuning;

  if (items[itemId] === undefined) return refuse("unknownItem", placementId);
  if (keep.placements[placementId] !== undefined) {
    return refuse("duplicateId", placementId);
  }
  const footprint = footprintOf(itemId, items);
  if (!inBounds(x, y, footprint, keep.level, tuning)) {
    return refuse("outOfBounds", placementId);
  }
  const blocking = findCollision(
    keep,
    { x, y, w: footprint.w, h: footprint.h },
    items,
  );
  if (blocking !== null) return refuse("collision", placementId, blocking);

  return {
    ok: true,
    keep: {
      ...keep,
      placements: { ...keep.placements, [placementId]: { itemId, x, y } },
    },
  };
}

/**
 * Move an existing placement to `(x, y)` (spec §9 move supported). The
 * placement never collides with itself; all other rules match placeItem.
 */
export function moveItem(
  keep: KeepState,
  placementId: PlacementId,
  x: number,
  y: number,
  content: KeepContent = {},
): PlacementResult {
  const items = content.items ?? DEFAULT_PLACEMENT_ITEMS;
  const tuning = content.tuning ?? contentTuning;

  const placement = keep.placements[placementId];
  if (placement === undefined) return refuse("unknownPlacement", placementId);
  const footprint = footprintOf(placement.itemId, items);
  if (!inBounds(x, y, footprint, keep.level, tuning)) {
    return refuse("outOfBounds", placementId);
  }
  const blocking = findCollision(
    keep,
    { x, y, w: footprint.w, h: footprint.h },
    items,
    placementId,
  );
  if (blocking !== null) return refuse("collision", placementId, blocking);

  return {
    ok: true,
    keep: {
      ...keep,
      placements: { ...keep.placements, [placementId]: { ...placement, x, y } },
    },
  };
}

/**
 * Remove a placement (spec §9 remove supported). The only refusal is
 * unknownPlacement. Callers owning jobs (the reducer) must ALSO unassign
 * any pip working at the removed station — see state.ts REMOVE_ITEM.
 */
export function removeItem(
  keep: KeepState,
  placementId: PlacementId,
): PlacementResult {
  if (keep.placements[placementId] === undefined) {
    return refuse("unknownPlacement", placementId);
  }
  const placements = { ...keep.placements };
  delete placements[placementId];
  return { ok: true, keep: { ...keep, placements } };
}
