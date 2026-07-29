/**
 * Dialogue selection (spec §3, §4.3) — which mood a Pip SHOWS and which
 * line it SAYS.
 *
 * - `displayedMood(pip, stream)` — the mood driving dialogue pool, idle
 *   animation set, and portrait expression. For every personality except
 *   Chaotic this is exactly `deriveMood(pip.needs)`; Chaotic Pips have a
 *   `tuning.quirks.chaoticMoodDisplayOffsetChance` (10%) chance to show a
 *   mood one adjacent step off, both directions, clamped at the ends
 *   (spec §4.3 — "this is a feature"). Actual mood remains the truth for
 *   everything else.
 * - `pickDialogueLine(state, pipId, context)` — one line from the
 *   `personality × context` pool (spec §3), deterministic via the
 *   `"dialogue"` rng stream whose cursor lives in `state.rngState`, and
 *   never repeating the line the Pip most recently said in that context
 *   (`state.lastLineIndex`, tracked per Pip per context).
 *
 * RNG contract (cursor determinism, spec §2 rule 3): a successful line
 * pick consumes EXACTLY ONE `"dialogue"` roll — whether or not a previous
 * line was being avoided — so the cursor advance never depends on
 * per-pip history. A missing/empty pool consumes zero rolls and returns
 * the state unchanged. `displayedMood` consumes zero rolls for
 * non-Chaotic Pips; Chaotic consumes one, plus one more when the offset
 * fires (deriveDisplayedMood's contract).
 *
 * Purity: no clock, no Math.random. Content enters as injectable
 * parameters defaulting to `content/` registries (the same pattern as
 * tuning everywhere else in core/).
 */

import { tuning as contentTuning } from "../../content/tuning";
import { dialogue as contentDialogue } from "../../content/dialogue";
import { createRngFromState } from "../rng";
import type { RngStream } from "../rng";
import { deriveDisplayedMood, deriveMood } from "./mood";
import type { DialogueContext, Mood, MoodThresholds } from "./mood";
import type { PipId, PipState } from "./types";

/** Stream names (spec §2 rule 3: named streams, cursors in GameState). */
export const DIALOGUE_STREAM = "dialogue";
export const MOOD_DISPLAY_STREAM = "mood-display";

/**
 * Structural view of the dialogue registry: personality ids are opaque
 * strings in core (spec §2 rule 5). `content/dialogue`'s `DialoguePools`
 * satisfies this.
 */
export type DialoguePoolsView = Readonly<
  Record<string, Readonly<Partial<Record<DialogueContext, readonly string[]>>>>
>;

/** Per-Pip most-recent line index, per context (the no-immediate-repeat
 * memory of pickDialogueLine). Lives in GameState so it saves/restores. */
export type PipLastLines = Partial<Record<DialogueContext, number>>;
export type LastLineIndexByPip = Readonly<Record<PipId, PipLastLines>>;

/** The slice of tuning displayedMood reads. `content/tuning` satisfies it. */
export interface DisplayedMoodTuning {
  readonly mood: MoodThresholds;
  readonly quirks: { readonly chaoticMoodDisplayOffsetChance: number };
}

/**
 * The mood this Pip DISPLAYS right now (spec §4.3): actual mood for
 * everyone, one adjacent step off 10% of the time for Chaotic. Callers
 * pass the `"mood-display"` stream (MOOD_DISPLAY_STREAM) so the quirk's
 * cursor lives in GameState.
 */
export function displayedMood(
  pip: PipState,
  stream: RngStream,
  tuning: DisplayedMoodTuning = contentTuning,
): Mood {
  return deriveDisplayedMood(
    deriveMood(pip.needs, tuning.mood),
    pip.personalityId,
    stream,
    tuning,
  );
}

/** A picked dialogue line. `lineId` is stable content addressing
 * (`personality/context/index`); `text` is the authored line. */
export interface DialogueLine {
  readonly lineId: string;
  readonly text: string;
  readonly personalityId: string;
  readonly context: DialogueContext;
  readonly index: number;
}

/**
 * Pool-level pick: one line, avoiding `previousIndex` when the pool has
 * at least two lines (a single-line pool must repeat). Consumes exactly
 * one roll from `stream` when the pool is non-empty (see module doc);
 * zero rolls and `null` when the pool is missing or empty.
 *
 * The avoid-previous mapping stays one roll: draw from `size − 1` and
 * skip over the previous index, so determinism never depends on rerolls.
 */
export function pickLineFromPools(
  personalityId: string,
  context: DialogueContext,
  previousIndex: number | undefined,
  stream: RngStream,
  pools: DialoguePoolsView = contentDialogue,
): DialogueLine | null {
  const pool = pools[personalityId]?.[context];
  if (pool === undefined || pool.length === 0) return null;

  const avoid =
    previousIndex !== undefined &&
    Number.isInteger(previousIndex) &&
    previousIndex >= 0 &&
    previousIndex < pool.length &&
    pool.length > 1
      ? previousIndex
      : null;

  let index: number;
  if (avoid === null) {
    index = stream.int(pool.length);
  } else {
    const roll = stream.int(pool.length - 1);
    index = roll >= avoid ? roll + 1 : roll;
  }

  return {
    lineId: `${personalityId}/${context}/${index}`,
    // Index is in [0, pool.length) by construction; noUncheckedIndexedAccess
    // widens the access, hence the assertion.
    text: pool[index] as string,
    personalityId,
    context,
    index,
  };
}

/**
 * The slice of GameState pickDialogueLine reads/writes. Structural so
 * this module never imports core/state.ts (no core-internal cycles);
 * GameState satisfies it.
 */
export interface DialogueStateSlice {
  readonly seed: number;
  readonly rngState: Readonly<Record<string, number>>;
  readonly pips: Readonly<Record<PipId, PipState>>;
  readonly lastLineIndex: LastLineIndexByPip;
}

export interface PickDialogueLineResult<S extends DialogueStateSlice> {
  readonly state: S;
  /** `null` when the pip is unknown or its pool is missing/empty —
   * `state` is then the input, untouched. */
  readonly line: DialogueLine | null;
}

/**
 * Pick one dialogue line for `pipId` in `context` (spec §3), advancing
 * the `"dialogue"` stream cursor and the pip's no-repeat memory in the
 * returned state. Deterministic: same state in → same line and state out.
 */
export function pickDialogueLine<S extends DialogueStateSlice>(
  state: S,
  pipId: PipId,
  context: DialogueContext,
  pools: DialoguePoolsView = contentDialogue,
): PickDialogueLineResult<S> {
  const pip = state.pips[pipId];
  if (pip === undefined) return { state, line: null };

  const rng = createRngFromState(state.seed, state.rngState);
  const line = pickLineFromPools(
    pip.personalityId,
    context,
    state.lastLineIndex[pipId]?.[context],
    rng.stream(DIALOGUE_STREAM),
    pools,
  );
  if (line === null) return { state, line: null };

  return {
    state: {
      ...state,
      rngState: rng.getState(),
      lastLineIndex: {
        ...state.lastLineIndex,
        [pipId]: { ...state.lastLineIndex[pipId], [context]: line.index },
      },
    },
    line,
  };
}
