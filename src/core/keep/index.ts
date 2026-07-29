/**
 * Keep domain (spec §9) — habitat state, plots, grid placement.
 *
 * Phase 5 implements the logic. Phase 0 provides vocabulary types only.
 */

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
