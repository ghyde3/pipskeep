/**
 * ROUND 2I — NOTIFICATION COPY (docs/notifications-bible.md §1, §15.5).
 *
 * Pure, data-only string builders. Every variant is deterministic given
 * `(seed, dueAt)` via a THROWAWAY rng stream (`core/rng.ts`'s `createRng`,
 * never persisted in `GameState.rngState`) — the exact same stateless-draw
 * pattern `core/progression/streak.ts` uses for keepsake offers
 * (`createRng(seed).stream(\`keepsake:${forDay}\`)`), chosen for the same
 * reason: presentation must never perturb a gameplay cursor (spec §2 rule 3).
 *
 * NO TIME WORDS (bible §2.3/§9.3): Chrome's intensive throttling can deliver
 * a Tier-1 notification up to ~60s late, so nothing here may say "just now"
 * or imply freshness a clock could contradict.
 *
 * NOTHING ABOUT A LOSS APPROACHING (round 2H's binding cut, restated by this
 * round's §6.1): `FORBIDDEN_SUBSTRINGS` is the list `catalogue.test.ts` (this
 * directory) scans every rendered string against — a test, not a paragraph,
 * because paragraphs erode (bible §11 risk 4).
 */

import { createRng } from "../rng";

/** Salt so a notification-copy draw can never collide with a gameplay
 * stream even for a tiny test seed (same precedent `app/sound.ts`'s
 * `AUDIO_SEED_SALT` sets for presentation-only randomness). */
const NOTIFY_SEED_SALT = 0x504b_4e4f; // "PKNO"

/** One throwaway roll, keyed on `(seed, dueAt, salt)` so two different
 * notification moments (even same type, same day) never draw identically
 * by accident, and the SAME moment always renders the SAME string (stable
 * across an arm → wake → outbox-drain sequence that all recompute the same
 * plan). Never touches `GameState.rngState`. */
function pickStateless<T>(
  seed: number,
  dueAt: number,
  salt: string,
  options: readonly T[],
): T {
  const stream = createRng(seed ^ NOTIFY_SEED_SALT).stream(`notify:${salt}:${dueAt}`);
  return stream.pick(options);
}

// ---------------------------------------------------------------------------
// HOMECOMING (bible §1.1)
// ---------------------------------------------------------------------------

const HOMECOMING_BODIES_SINGLE: readonly string[] = [
  "Pockets full, feet muddy. Come see what they found.",
  "Waiting by the gate with something behind their back.",
  "Back in one piece and extremely pleased about it.",
  "Something is rattling in their satchel.",
];

const MAX_NAMES_DEFAULT = 3;

function joinNames(names: readonly string[], maxNames: number): string {
  const shown = names.slice(0, maxNames);
  if (names.length <= maxNames) {
    if (shown.length === 1) return shown[0] as string;
    if (shown.length === 2) return `${shown[0]} and ${shown[1]}`;
    return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
  }
  const overflow = names.length - maxNames;
  return `${shown.join(", ")} and ${overflow} more`;
}

/** Number-word for a small count (bible's exact "Three Pips are home" /
 * "Five Pips are home" titles) — falls back to the digit past ten (never
 * exercised by a real roster cap, but honest for a test fixture). */
const COUNT_WORDS: readonly string[] = [
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
];

function countWord(n: number): string {
  return COUNT_WORDS[n] ?? String(n);
}

/** `biomeName` is the expedition's content-defined display name (e.g.
 * "Meadow", "Bramblewick") — resolved by `plan.ts` from the expedition
 * registry and passed in, so this module never imports content itself.
 * Omitted (a cluster of 2+ Pips, possibly from different biomes) falls
 * back to a biome-free title — the plural form never names one anyway. */
export function homecomingTitle(names: readonly string[], biomeName?: string): string {
  if (names.length === 1) {
    return biomeName !== undefined
      ? `${names[0]} is back from ${biomeName}`
      : `${names[0]} is home`;
  }
  return `${countWord(names.length)} Pips are home`;
}

/** Variety matters more than it looks: at `maxPerDay` 4 a regular player
 * meets these sentences several times a week, and a lock screen that says
 * the same thing every time stops being the Keep talking and starts being
 * a reminder app (§15.5). `%NAMES%` is substituted rather than
 * concatenated so each variant can put the names where its own sentence
 * wants them. */
const HOMECOMING_BODIES_MULTI: readonly string[] = [
  "%NAMES% are back, and there is a small pile by the gate.",
  "%NAMES% came in together, all talking at once.",
  "%NAMES% are back, comparing pockets.",
  "%NAMES% are home, and something needs unpacking.",
];

export function homecomingBody(
  seed: number,
  dueAt: number,
  names: readonly string[],
  maxNames: number = MAX_NAMES_DEFAULT,
): string {
  if (names.length === 1) {
    return pickStateless(seed, dueAt, "homecoming", HOMECOMING_BODIES_SINGLE);
  }
  return pickStateless(seed, dueAt, "homecoming-multi", HOMECOMING_BODIES_MULTI).replace(
    "%NAMES%",
    joinNames(names, maxNames),
  );
}

// ---------------------------------------------------------------------------
// PIPPING (bible §1.2)
// ---------------------------------------------------------------------------

export function pippingTitle(eggCount: number): string {
  return eggCount === 1 ? "An egg is pipping" : "The eggs are pipping";
}

const PIPPING_BODIES_SINGLE: readonly string[] = [
  "Tap-tap. Tap. Something in the nursery has decided today is the day.",
  "A very small chisel is at work in the nursery.",
  "The shell has opinions now. Loud ones.",
  "Someone in there has found the door.",
];

/** `%COUNT%` is the number word. Every variant names the EGGS in its own
 * body: the plural used to open "Two of them, tapping in stereo", whose
 * "them" only resolved via the title — and plenty of lock screens truncate
 * or separate the title from the body. */
const PIPPING_BODIES_MULTI: readonly string[] = [
  "%COUNT% eggs, tapping in stereo. The nursery is not being subtle.",
  "%COUNT% eggs have started at once. It is quite the racket.",
  "%COUNT% eggs, all chiselling away on their own schedule.",
];

export function pippingBody(seed: number, dueAt: number, eggCount: number): string {
  if (eggCount === 1) {
    return pickStateless(seed, dueAt, "pipping", PIPPING_BODIES_SINGLE);
  }
  return pickStateless(seed, dueAt, "pipping-multi", PIPPING_BODIES_MULTI).replace(
    "%COUNT%",
    countWord(eggCount),
  );
}

// ---------------------------------------------------------------------------
// CROSS-TYPE COALESCE (bible §4.3.2 — "the only generic title in the
// catalogue", and only ever paired with a body that names both specifics).
// ---------------------------------------------------------------------------

export const COMBINED_TITLE = "The Keep has been busy";

export function combinedBody(homecomingBodyNoun: string, pippingBodyNoun: string): string {
  return `${homecomingBodyNoun}, and ${pippingBodyNoun}.`;
}

/** The noun clause a combined body names a homecoming with — deliberately
 * NOT the full single/plural body (bible §4.3.2's two-clause cap), just
 * "who or how many". */
export function homecomingClause(names: readonly string[], biomeName?: string): string {
  if (names.length === 1) {
    return biomeName !== undefined
      ? `${names[0]} is home from ${biomeName}`
      : `${names[0]} is home`;
  }
  return `${countWord(names.length)} Pips are home`;
}

export function pippingClause(eggCount: number): string {
  return eggCount === 1 ? "an egg is pipping" : `${countWord(eggCount).toLowerCase()} eggs are pipping`;
}

// ---------------------------------------------------------------------------
// THE FORBIDDEN LIST (bible §6/§9.3) — round 2H's binding cut, spec §0
// vocabulary, and the guilt/time-word bans, all in one place so exactly one
// test (`catalogue.test.ts`) needs to scan exactly one list.
// ---------------------------------------------------------------------------

export const FORBIDDEN_SUBSTRINGS: readonly string[] = [
  // Round 2H's cruelty cut — nothing about a loss approaching.
  "dying",
  "dies",
  "lose",
  "losing",
  "lost",
  "danger",
  "critical",
  "urgent",
  "hurry",
  "last chance",
  "time is running out",
  // Guilt-shaped re-engagement language (bible §6.7).
  "miss you",
  "haven't",
  "come back",
  "don't forget",
  "still waiting",
  "days since",
  // Time words a late Tier-1 delivery would make false (bible §2.3).
  "just now",
  "a minute ago",
  "minutes ago",
  // spec §0 vocabulary — never these terms anywhere in copy.
  "-gotchi",
  "gotchi",
  "pal",
  "pokemon",
  "pokémon",
  "tamagotchi",
  "palworld",
];

export const MAX_TITLE_LENGTH = 48;
export const MAX_BODY_LENGTH = 160;
