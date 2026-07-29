/**
 * Cue specs (what a sound IS) and the pure planner that expands one into
 * an absolutely-timed list of voices (what to schedule).
 *
 * The split matters: `planCue` is a pure function of (spec, start time,
 * one jitter draw) → plain data, so the entire sound design can be tested
 * without an AudioContext — "the hatch fanfare is four notes rising
 * through the pentatonic, the last one twice as long" is an assertion
 * about a `CuePlan`, not about a browser. `schedule.ts` then does the
 * dumb, mechanical part: turn each planned voice into real nodes.
 *
 * Envelope model: full ADSR, expressed in seconds —
 *
 *   0 ──attack──▶ peak ──decay──▶ peak×sustain ──hold──▶ ──release──▶ 0
 *
 * so a percussive blip is `sustain: 0` with no hold, and a warm pad is
 * `sustain: 0.7` with a long hold. Total voice length is the sum.
 */

import { degreeHz, detuneHz } from "./notes";
import type { OscWave } from "./types";

// ---------------------------------------------------------------------------
// Specs — the authored sound design (see ./palette.ts)
// ---------------------------------------------------------------------------

/** A low-frequency oscillator wobbling a voice's pitch (kazoo duty). */
export interface VibratoSpec {
  readonly rateHz: number;
  /** Peak deviation in cents. */
  readonly cents: number;
}

export interface ToneSpec {
  readonly kind: "tone";
  readonly wave: OscWave;
  /** Pentatonic scale degree (see ./notes.ts). 0 = C5. */
  readonly degree: number;
  /** Offset from cue start, seconds. */
  readonly at: number;
  readonly attack: number;
  readonly decay: number;
  /** Sustain LEVEL as a fraction of peak (0 = fully percussive). */
  readonly sustain: number;
  /** Time held at the sustain level, seconds. */
  readonly hold: number;
  readonly release: number;
  /** Peak gain, pre-master. */
  readonly gain: number;
  /** Non-zero → a detuned PAIR (±cents/2), the "chime" shimmer. */
  readonly detune?: number;
  /** Pitch glide over the voice's life, in cents (negative = downward). */
  readonly glideCents?: number;
  /** Lowpass cutoff, Hz. Omit for an unfiltered voice. */
  readonly lowpass?: number;
  readonly q?: number;
  readonly vibrato?: VibratoSpec;
}

export interface NoiseSpec {
  readonly kind: "noise";
  readonly at: number;
  readonly attack: number;
  readonly hold: number;
  readonly release: number;
  readonly gain: number;
  /** Noise is ALWAYS filtered — raw white noise is harsh and un-cozy. */
  readonly lowpass: number;
  /** Sweep the cutoff to this by the end (whooshes, swells). */
  readonly lowpassTo?: number;
  readonly q?: number;
  /** Resample the shared noise buffer (>1 = brighter/faster). */
  readonly rate?: number;
}

export type NoteSpec = ToneSpec | NoiseSpec;

export interface CueSpec {
  readonly notes: readonly NoteSpec[];
  /** Cue-level gain trim (default 1). */
  readonly gain?: number;
  /** Minimum gap between two plays of this slot, ms (anti machine-gun). */
  readonly cooldownMs: number;
  /** Per-play pitch wobble, ±cents. Default DEFAULT_JITTER_CENTS. */
  readonly jitterCents?: number;
  /**
   * 0 = droppable chatter (taps, pops), 1 = normal, 2 = never dropped by
   * the voice cap (hatches, level-ups — the moments the game is about).
   */
  readonly priority?: 0 | 1 | 2;
}

/** Default per-play pitch wobble. Small enough to read as "alive", not
 * "out of tune" — a sixth of a semitone at the extremes. */
export const DEFAULT_JITTER_CENTS = 16;

// ---------------------------------------------------------------------------
// Plan — absolutely-timed, fully resolved
// ---------------------------------------------------------------------------

export interface PlannedTone {
  readonly kind: "tone";
  readonly wave: OscWave;
  /** Absolute context time, seconds. */
  readonly start: number;
  readonly end: number;
  /** Post-jitter fundamental, Hz. */
  readonly freq: number;
  /** Frequency at `end` when the voice glides; equals `freq` otherwise. */
  readonly glideTo: number;
  /** 0 = single oscillator; otherwise a ±detune/2 pair. */
  readonly detune: number;
  readonly attack: number;
  readonly decay: number;
  readonly sustain: number;
  readonly hold: number;
  readonly release: number;
  readonly peak: number;
  readonly lowpass?: number;
  readonly q?: number;
  readonly vibrato?: VibratoSpec;
}

export interface PlannedNoise {
  readonly kind: "noise";
  readonly start: number;
  readonly end: number;
  readonly attack: number;
  readonly hold: number;
  readonly release: number;
  readonly peak: number;
  readonly lowpass: number;
  readonly lowpassTo: number;
  readonly q: number;
  readonly rate: number;
}

export type PlannedVoice = PlannedTone | PlannedNoise;

export interface CuePlan {
  readonly slot: string;
  /** Absolute start of the cue, seconds. */
  readonly start: number;
  /** When the last voice falls silent, seconds. */
  readonly end: number;
  readonly voices: readonly PlannedVoice[];
  /** Oscillators/sources this cue will hold — what the voice cap counts. */
  readonly voiceCost: number;
}

function toneLength(spec: ToneSpec): number {
  return spec.attack + spec.decay + spec.hold + spec.release;
}

function noiseLength(spec: NoiseSpec): number {
  return spec.attack + spec.hold + spec.release;
}

/** How many oscillators/sources a spec occupies (a detuned pair is 2, a
 * vibrato LFO is another one). The voice cap counts these, not cues. */
export function noteCost(spec: NoteSpec): number {
  if (spec.kind === "noise") return 1;
  return (spec.detune !== undefined && spec.detune !== 0 ? 2 : 1) +
    (spec.vibrato !== undefined ? 1 : 0);
}

/**
 * Expand a cue into absolutely-timed voices. Pure.
 *
 * `jitter01` is ONE draw in [0, 1) — the whole cue transposes together by
 * ±jitterCents, rather than each note wobbling independently. That keeps
 * a four-note fanfare in tune with ITSELF while still never sounding
 * mechanically identical twice, which per-note jitter cannot do.
 */
export function planCue(
  slot: string,
  spec: CueSpec,
  start: number,
  jitter01: number,
): CuePlan {
  const cueGain = spec.gain ?? 1;
  const jitterRange = spec.jitterCents ?? DEFAULT_JITTER_CENTS;
  const cents = (jitter01 * 2 - 1) * jitterRange;
  const rateJitter = 1 + (jitter01 * 2 - 1) * 0.06;

  const voices: PlannedVoice[] = [];
  let end = start;
  let voiceCost = 0;

  for (const note of spec.notes) {
    voiceCost += noteCost(note);
    const noteStart = start + note.at;
    if (note.kind === "noise") {
      const noteEnd = noteStart + noiseLength(note);
      voices.push({
        kind: "noise",
        start: noteStart,
        end: noteEnd,
        attack: note.attack,
        hold: note.hold,
        release: note.release,
        peak: note.gain * cueGain,
        lowpass: note.lowpass,
        lowpassTo: note.lowpassTo ?? note.lowpass,
        q: note.q ?? 0.7,
        rate: (note.rate ?? 1) * rateJitter,
      });
      if (noteEnd > end) end = noteEnd;
      continue;
    }
    const noteEnd = noteStart + toneLength(note);
    const freq = detuneHz(degreeHz(note.degree), cents);
    voices.push({
      kind: "tone",
      wave: note.wave,
      start: noteStart,
      end: noteEnd,
      freq,
      glideTo:
        note.glideCents === undefined ? freq : detuneHz(freq, note.glideCents),
      detune: note.detune ?? 0,
      attack: note.attack,
      decay: note.decay,
      sustain: note.sustain,
      hold: note.hold,
      release: note.release,
      peak: note.gain * cueGain,
      ...(note.lowpass !== undefined ? { lowpass: note.lowpass } : {}),
      ...(note.q !== undefined ? { q: note.q } : {}),
      ...(note.vibrato !== undefined ? { vibrato: note.vibrato } : {}),
    });
    if (noteEnd > end) end = noteEnd;
  }

  return { slot, start, end, voices, voiceCost };
}
