/**
 * Egg domain (spec §7) — state machine, incubation, inheritance.
 *
 * Phase 4 implements the lifecycle; `combineGenomes()` (breeding seam,
 * spec §12) also lands in core here. Phase 0 provides vocabulary types only.
 */

export type EggId = string;

/** Egg state machine (spec §7.2): Found → Incubating → Pipping → Hatched. */
export const EggState = {
  Found: "found",
  Incubating: "incubating",
  Pipping: "pipping",
  Hatched: "hatched",
} as const;
export type EggState = (typeof EggState)[keyof typeof EggState];
