/**
 * The note grid every PipsKeep sound sits on.
 *
 * ONE rule keeps the palette cohesive: every pitch in the game is a degree
 * of a C major pentatonic scale. A pentatonic scale has no semitone
 * neighbours and no tritone, so ANY two notes from it sound consonant
 * together — which matters here because sounds overlap constantly (a Feed
 * blip lands while a job-produce pop and a toast chime are still ringing).
 * Pick pitches off this grid and the Keep can never produce a sour chord
 * by accident; pick them freely and it eventually will.
 *
 * Degrees are integers and wrap across octaves: 0 = C5, 4 = A5, 5 = C6,
 * −1 = A4, −5 = C4. Negative degrees are the warm low register (Pet, egg
 * knocks, wooden thunks); +7 and up is the airy chime register.
 *
 * These are sound-design constants, not gameplay tuning: they belong with
 * the palette that uses them, exactly as `content/palette.ts` owns colour
 * tokens rather than `content/tuning.ts`. Nothing here is in `core/`.
 */

/** Semitone offsets of the major pentatonic: C D E G A. */
export const PENTATONIC_SEMITONES = [0, 2, 4, 7, 9] as const;

/** Degree 0. C5 — the middle of the palette's comfortable range. */
export const ROOT_HZ = 523.2511306011972;

const TWELFTH_ROOT = 2 ** (1 / 12);

/** Floor-mod that behaves for negative degrees (JS `%` does not). */
function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** Semitone offset from the root for a (possibly negative) scale degree. */
export function degreeSemitones(degree: number): number {
  const size = PENTATONIC_SEMITONES.length;
  const octave = Math.floor(degree / size);
  // Index is in [0, size) by construction; the assertion is only here to
  // satisfy noUncheckedIndexedAccess.
  const step = PENTATONIC_SEMITONES[mod(degree, size)] as number;
  return step + 12 * octave;
}

/** Frequency in Hz for a scale degree (0 = ROOT_HZ). */
export function degreeHz(degree: number): number {
  return ROOT_HZ * TWELFTH_ROOT ** degreeSemitones(degree);
}

/** Apply a cents offset to a frequency (100 cents = one semitone). */
export function detuneHz(hz: number, cents: number): number {
  return hz * 2 ** (cents / 1200);
}
