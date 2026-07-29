/**
 * Egg content (spec §7). Numbers (incubation times, rarity weights) live
 * in tuning.ts like every other tunable; this file holds the egg system's
 * player-facing copy — content, not logic, per spec §3.
 */

/**
 * Shown when hatching is blocked at the roster cap (spec §7.4: "a
 * friendly message until space exists"). Tone per spec §15: warm,
 * mischievous, never guilt-trippy — the egg is fine, it can wait forever.
 */
export const ROSTER_FULL_MESSAGE =
  "The Keep is packed with happy Pips — not one spare bed! This egg is " +
  "perfectly cozy and in no hurry at all. It'll wait for you.";
