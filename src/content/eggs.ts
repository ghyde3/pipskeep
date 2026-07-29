/**
 * Egg content (spec §7). Numbers (incubation times, rarity weights) live
 * in tuning.ts like every other tunable; this file holds the egg system's
 * player-facing copy — content, not logic, per spec §3.
 */

/**
 * Shown when hatching is blocked at the roster cap (spec §7.4: "a
 * friendly message until space exists (upgrade prompt)"). Tone per spec
 * §15: warm, mischievous, never guilt-trippy — the egg is fine, it can
 * wait forever. This one carries the friendly upgrade nudge; it is used
 * while the roster upgrade is still available.
 */
export const ROSTER_FULL_MESSAGE =
  "The Keep is packed with happy Pips — not one spare bed! This egg is " +
  "perfectly cozy and in no hurry at all. Psst: the Cozy Bunks upgrade " +
  "(Keep level 3) adds two more beds.";

/**
 * The roster-full message AFTER the roster upgrade is owned (spec §7.4):
 * no upgrade left to nudge toward, so just reassure — eggs never expire.
 */
export const ROSTER_FULL_MAX_MESSAGE =
  "Even the upgraded Keep is bursting — five happy Pips and zero spare " +
  "beds! This egg is snug as can be and genuinely does not mind waiting.";
