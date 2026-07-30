/**
 * Egg content (spec §7). Numbers (incubation times, rarity weights) live
 * in tuning.ts like every other tunable; this file holds the egg system's
 * player-facing copy — content, not logic, per spec §3.
 */

/**
 * Shown when hatching is blocked at the roster cap (spec §7.4: "a
 * friendly message until space exists (upgrade prompt)"). Tone per spec
 * §15: warm, mischievous, never guilt-trippy — the egg is fine, it can
 * wait forever.
 *
 * ROUND 2C (docs/retention-bible.md §2.7): now points at the Long
 * Meadow FIRST — it is the answer available at every Keep level, not
 * just after the roster upgrade — with the upgrade kept as a mention,
 * not the headline.
 */
export const ROSTER_FULL_MESSAGE =
  "The Keep is full and cosy. Send someone to the Long Meadow to make " +
  "room — they'll be fine, they'll be delighted, and you can ask them " +
  "back any time. Your egg will wait as long as it likes. (Psst: the " +
  "Cozy Bunks upgrade at Keep level 3 adds two more beds, too.)";

/**
 * The roster-full message AFTER the roster upgrade is owned (spec §7.4):
 * no upgrade left to nudge toward, so the Long Meadow gets the same
 * pointer (bible §2.7 — "gets the same sanctuary pointer").
 */
export const ROSTER_FULL_MAX_MESSAGE =
  "Even the upgraded Keep is bursting — five happy Pips and zero spare " +
  "beds! Send someone to the Long Meadow to make room — they'll be fine, " +
  "they'll be delighted, and you can ask them back any time. This egg is " +
  "snug as can be and genuinely does not mind waiting.";
