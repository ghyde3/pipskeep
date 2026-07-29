/**
 * Expedition domain (spec §6.1) — timers derived from `departureTime +
 * duration` via the injected Clock (no setTimeout persistence), seeded
 * loot rolls.
 *
 * Phase 4 implements the logic. Phase 0 provides vocabulary types only.
 */

/** Identifier of an in-flight expedition instance (not the content id). */
export type ExpeditionRunId = string;

/** Name of the seeded RNG stream used for loot rolls (spec §6.1). */
export const EXPEDITION_LOOT_STREAM = "expedition-loot";
