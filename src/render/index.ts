/**
 * render/ (spec §2): Pixi scenes, sprites, animations. Reads state, never
 * mutates it.
 *
 * - spriteResolver.ts — THE `(genome, stage) → composed sprite` mapping
 *   (spec §11); all Pip visuals load through it.
 * - placeableSprites.ts — THE `itemId → composed sprite` mapping for
 *   placed items (stations + decorations), same resolver conventions.
 * - keepScene.ts — the Keep diorama (spec §9): grid, wandering roster,
 *   placement mode, evolution ceremony, care animations.
 * - gridLayout.ts — pure (Pixi-free) tile math: layout fitting, snap,
 *   occupancy, deterministic free-tile picking, the y-sort comparator.
 * - eggTap.ts / pipTap.ts — dependency-free tap seams to the UI.
 * - tween.ts / particles.ts — dependency-free juice utilities.
 */

export * from "./spriteResolver";
export * from "./placeableSprites";
export * from "./keepScene";
export * from "./gridLayout";
export * from "./eggTap";
export * from "./pipTap";
export * from "./tween";
export * from "./particles";
