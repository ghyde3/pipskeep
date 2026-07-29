/**
 * render/ (spec §2): Pixi scenes, sprites, animations. Reads state, never
 * mutates it.
 *
 * - spriteResolver.ts — THE `(genome, stage) → composed sprite` mapping
 *   (spec §11); all Pip visuals load through it.
 * - keepScene.ts — the Phase 2 Keep view: diorama, active Pip, care
 *   animations.
 * - tween.ts / particles.ts — dependency-free juice utilities.
 */

export * from "./spriteResolver";
export * from "./keepScene";
export * from "./tween";
export * from "./particles";
