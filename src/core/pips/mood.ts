/**
 * Mood derivation (spec §4.3). Mood is derived, never stored.
 *
 * Thresholds come from content/tuning.ts (injectable for tests); the only
 * hard rule here is the precedence order, which is spec-structural:
 * Miserable → Grumpy → Beaming → Content, first match wins.
 *
 * `deriveDisplayedMood` layers the Chaotic display quirk (spec §4.3: 10%
 * chance to DISPLAY a mood one step off from actual — "this is a feature")
 * on top of the actual mood. The display layer (dialogue pool / portrait
 * selection, Phase 2) calls it; the actual mood from `deriveMood` remains
 * the truth for everything else.
 */

import { tuning as contentTuning } from "../../content/tuning";
import type { RngStream } from "../rng";
import { NEED_IDS } from "./types";
import type { PipNeeds } from "./types";

/** Derived moods (spec §4.3). */
export const MOODS = ["beaming", "content", "grumpy", "miserable"] as const;
export type Mood = (typeof MOODS)[number];

/**
 * Dialogue contexts (spec §3): the four moods + Sulking (§4.4) + Refusal
 * (§5 — whenever a Pip declines Play/Job/Expedition) + Greeting (round
 * 2K, docs/liveliness-bible.md §4.5 — what a Pip says to ANOTHER PIP
 * when the two of them stop to notice each other). Content keys its
 * dialogue pools by `personality × DialogueContext`.
 *
 * ⚠️ Adding a context raises the shipped dialogue minimum by
 * `REQUIRED_LINES_PER_CONTEXT × 5 personalities` and `content/validate.ts`
 * hard-fails an underfilled pool — spec §3 makes under-writing dialogue a
 * spec violation, so a thin `greeting` pool breaks the build rather than
 * shipping. That is deliberate: bible §4.5 would rather the feature ship
 * MUTE than ship with four lines per personality.
 */
export const DIALOGUE_CONTEXTS = [...MOODS, "sulking", "refusal", "greeting"] as const;
export type DialogueContext = (typeof DIALOGUE_CONTEXTS)[number];

/** The slice of tuning that mood derivation reads (see tuning.mood). */
export interface MoodThresholds {
  /** Miserable — any need strictly below this. */
  readonly miserableBelow: number;
  /** Grumpy — any need strictly below this. */
  readonly grumpyBelow: number;
  /** Beaming — all needs at or above this. */
  readonly beamingAtOrAbove: number;
}

/**
 * Compute the mood from current needs (spec §4.3).
 *
 * The thresholds overlap by design; evaluation order resolves them and is
 * load-bearing (first match wins):
 *   1. Miserable — any need < miserableBelow
 *   2. Grumpy    — any need < grumpyBelow
 *   3. Beaming   — all needs ≥ beamingAtOrAbove
 *   4. Content   — otherwise (all needs ≥ grumpyBelow holds here, since
 *      step 2 already failed to match)
 */
export function deriveMood(
  needs: PipNeeds,
  thresholds: MoodThresholds = contentTuning.mood,
): Mood {
  let min = Infinity;
  for (const need of NEED_IDS) {
    const value = needs[need];
    if (value < min) min = value;
  }
  if (min < thresholds.miserableBelow) return "miserable";
  if (min < thresholds.grumpyBelow) return "grumpy";
  if (min >= thresholds.beamingAtOrAbove) return "beaming";
  return "content";
}

/** Personality id whose quirk can display a mood one step off (spec §4.3). */
const CHAOTIC_PERSONALITY_ID = "chaotic";

/** The slice of tuning the display quirk reads (see tuning.quirks). */
export interface MoodDisplayTuning {
  readonly quirks: {
    /** Chaotic: chance to display a mood one adjacent step off (§4.3). */
    readonly chaoticMoodDisplayOffsetChance: number;
  };
}

/**
 * The mood to DISPLAY (dialogue pool, idle animation set, portrait
 * expression — spec §4.3). For every personality except Chaotic this is the
 * actual mood. A Chaotic Pip displays a mood one step off with probability
 * `quirks.chaoticMoodDisplayOffsetChance`; "one step" means adjacent on the
 * MOODS scale (beaming ↔ content ↔ grumpy ↔ miserable), direction chosen
 * uniformly, clamped at the ends (Beaming can only show Content, Miserable
 * only Grumpy). When the offset fires, the displayed mood is never the
 * actual one.
 *
 * RNG contract (cursor determinism, spec §2 rule 3): non-Chaotic Pips
 * consume ZERO rolls; a Chaotic Pip consumes exactly one roll for the
 * offset check plus, when it fires, exactly one more for the direction —
 * even at the ends, so the cursor advance never depends on which mood is
 * being displayed. Callers pass a named stream (suggested: "mood-display")
 * whose cursor lives in GameState.
 */
export function deriveDisplayedMood(
  actual: Mood,
  personalityId: string,
  rng: RngStream,
  tuning: MoodDisplayTuning = contentTuning,
): Mood {
  if (personalityId !== CHAOTIC_PERSONALITY_ID) return actual;
  if (!rng.chance(tuning.quirks.chaoticMoodDisplayOffsetChance)) return actual;
  const index = MOODS.indexOf(actual);
  const neighbors: Mood[] = [];
  const brighter = MOODS[index - 1];
  const dimmer = MOODS[index + 1];
  if (brighter !== undefined) neighbors.push(brighter);
  if (dimmer !== undefined) neighbors.push(dimmer);
  return rng.pick(neighbors);
}
