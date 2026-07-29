/**
 * The PipsKeep sound palette — every `sound(slotId)` seam in the game,
 * authored as data.
 *
 * The brief: cozy, wooden, small. Soft marimba/kalimba blips, gentle
 * wooden pops, airy chimes — nothing metallic, nothing sharp, nothing
 * that sounds like a notification from a bank app. Three rules hold it
 * together:
 *
 *   1. EVERY pitch is a pentatonic degree (./notes.ts), so overlapping
 *      cues cannot clash.
 *   2. Registers carry meaning. Low (negative degrees, heavy lowpass) =
 *      physical and wooden: thunks, knocks, purrs. Middle (0–5) = the
 *      Pip talking back: care blips, pops. High (7+, detuned chime
 *      pairs) = magic: shimmer, hatches, rare loot.
 *   3. Direction carries meaning. Rising = something arrived or grew;
 *      falling = something settled, closed, or was declined.
 *
 * Everything is filtered — raw square and raw white noise are harsh, and
 * a lowpass is what makes a synthesized blip read as "wooden" rather than
 * "8-bit". Peak gains are deliberately small (0.06–0.28): the master
 * limiter in engine.ts is a safety net, not a mixing tool.
 *
 * These are sound-design constants, not gameplay tuning — same reasoning
 * as `content/palette.ts` owning colour tokens instead of
 * `content/tuning.ts`, and nothing here lives in `core/`.
 */

import type { CueSpec, NoiseSpec, ToneSpec, VibratoSpec } from "./plan";
import type { OscWave } from "./types";

// ---------------------------------------------------------------------------
// Voice factories — the four timbres the whole palette is built from
// ---------------------------------------------------------------------------

interface ToneOpts {
  readonly wave?: OscWave;
  readonly gain?: number;
  /** Total voice length, seconds. */
  readonly len?: number;
  readonly lowpass?: number;
  readonly detune?: number;
  readonly glideCents?: number;
  readonly q?: number;
  readonly vibrato?: VibratoSpec;
}

/** Marimba-ish plucked blip: instant attack, two-stage decay to nothing. */
function blip(degree: number, at: number, o: ToneOpts = {}): ToneSpec {
  const len = o.len ?? 0.16;
  return {
    kind: "tone",
    wave: o.wave ?? "triangle",
    degree,
    at,
    attack: 0.005,
    decay: len * 0.25,
    sustain: 0.3,
    hold: 0,
    release: len * 0.75,
    gain: o.gain ?? 0.2,
    lowpass: o.lowpass ?? 2400,
    ...(o.detune !== undefined ? { detune: o.detune } : {}),
    ...(o.glideCents !== undefined ? { glideCents: o.glideCents } : {}),
    ...(o.q !== undefined ? { q: o.q } : {}),
    ...(o.vibrato !== undefined ? { vibrato: o.vibrato } : {}),
  };
}

/** Airy chime: a slightly detuned sine PAIR, so it beats gently and
 * shimmers instead of sitting still. The magic register. */
function chime(degree: number, at: number, o: ToneOpts = {}): ToneSpec {
  const len = o.len ?? 0.5;
  return {
    kind: "tone",
    wave: o.wave ?? "sine",
    degree,
    at,
    attack: 0.008,
    decay: len * 0.2,
    sustain: 0.4,
    hold: 0,
    release: len * 0.8,
    gain: o.gain ?? 0.13,
    detune: o.detune ?? 9,
    lowpass: o.lowpass ?? 5200,
    ...(o.glideCents !== undefined ? { glideCents: o.glideCents } : {}),
    ...(o.q !== undefined ? { q: o.q } : {}),
    ...(o.vibrato !== undefined ? { vibrato: o.vibrato } : {}),
  };
}

/** Sustained warm tone — the "purr" register. Slow attack, real sustain. */
function pad(degree: number, at: number, o: ToneOpts = {}): ToneSpec {
  const len = o.len ?? 0.5;
  return {
    kind: "tone",
    wave: o.wave ?? "sine",
    degree,
    at,
    attack: 0.06,
    decay: 0.1,
    sustain: 0.75,
    hold: Math.max(0, len - 0.45),
    release: 0.29,
    gain: o.gain ?? 0.12,
    detune: o.detune ?? 6,
    lowpass: o.lowpass ?? 900,
    ...(o.glideCents !== undefined ? { glideCents: o.glideCents } : {}),
    ...(o.q !== undefined ? { q: o.q } : {}),
    ...(o.vibrato !== undefined ? { vibrato: o.vibrato } : {}),
  };
}

interface NoiseOpts {
  readonly gain?: number;
  readonly attack?: number;
  readonly hold?: number;
  readonly release?: number;
  readonly lowpass?: number;
  readonly lowpassTo?: number;
  readonly q?: number;
  readonly rate?: number;
}

/** Filtered noise burst — the air in the palette: taps, sweeps, crackle. */
function noise(at: number, o: NoiseOpts = {}): NoiseSpec {
  return {
    kind: "noise",
    at,
    attack: o.attack ?? 0.004,
    hold: o.hold ?? 0.008,
    release: o.release ?? 0.06,
    gain: o.gain ?? 0.06,
    lowpass: o.lowpass ?? 1200,
    ...(o.lowpassTo !== undefined ? { lowpassTo: o.lowpassTo } : {}),
    ...(o.q !== undefined ? { q: o.q } : {}),
    ...(o.rate !== undefined ? { rate: o.rate } : {}),
  };
}

// ---------------------------------------------------------------------------
// The palette
// ---------------------------------------------------------------------------

/**
 * slot id → cue. Slot ids are the ones already threaded through render/
 * and ui/ (grep `sound(`); unknown ids fall back to DEFAULT_CUE so a new
 * seam is never silently mute.
 */
export const SOUND_PALETTE: Readonly<Record<string, CueSpec>> = {
  // --- Care (spec §4.7) -------------------------------------------------
  // Feed: two munchy wooden pops with a soft "nom" underneath. Falling
  // pair — the food went IN and the moment is over.
  "care.feed": {
    cooldownMs: 140,
    notes: [
      noise(0, { gain: 0.05, lowpass: 850, release: 0.05 }),
      blip(2, 0, { len: 0.13, lowpass: 1700, gain: 0.24 }),
      blip(0, 0.08, { len: 0.17, lowpass: 1450, gain: 0.2 }),
    ],
  },

  // Clean: a four-note sparkle arpeggio riding a little "shhh" of air.
  "care.clean": {
    cooldownMs: 200,
    notes: [
      noise(0, {
        gain: 0.045,
        attack: 0.05,
        hold: 0.06,
        release: 0.26,
        lowpass: 2200,
        lowpassTo: 5600,
      }),
      chime(3, 0, { len: 0.42, gain: 0.11 }),
      chime(5, 0.06, { len: 0.42, gain: 0.1 }),
      chime(7, 0.12, { len: 0.46, gain: 0.095 }),
      chime(9, 0.18, { len: 0.6, gain: 0.085 }),
    ],
  },

  // Play: a bouncy two-note with a cheeky upward bend on the second —
  // the sound of a thing springing back up.
  "care.play": {
    cooldownMs: 160,
    jitterCents: 24,
    notes: [
      blip(0, 0, { len: 0.12, lowpass: 2200, gain: 0.22 }),
      blip(4, 0.1, { len: 0.22, lowpass: 2800, gain: 0.22, glideCents: 130 }),
    ],
  },

  // Pet: a warm low chord that PURRS — the slow vibrato on the bottom
  // note is doing the whole job here.
  "care.pet": {
    cooldownMs: 260,
    notes: [
      pad(-10, 0, {
        len: 0.62,
        gain: 0.14,
        lowpass: 520,
        vibrato: { rateHz: 5.5, cents: 11 },
      }),
      pad(-5, 0.02, { len: 0.58, gain: 0.1, lowpass: 700 }),
      pad(-3, 0.05, { len: 0.52, gain: 0.075, lowpass: 900 }),
    ],
  },

  // Rest: a descending sigh, settling onto a low cushion.
  "care.rest": {
    cooldownMs: 300,
    notes: [
      {
        kind: "tone",
        wave: "triangle",
        degree: 4,
        at: 0,
        attack: 0.05,
        decay: 0.12,
        sustain: 0.55,
        hold: 0.12,
        release: 0.34,
        gain: 0.18,
        lowpass: 1150,
        glideCents: -700,
      },
      pad(-8, 0.1, { len: 0.5, gain: 0.08, lowpass: 480 }),
    ],
  },

  // Wake: the sigh in reverse — two steps up, eyes open.
  "care.wake": {
    cooldownMs: 300,
    notes: [
      blip(0, 0, { len: 0.13, lowpass: 2000, gain: 0.18 }),
      blip(3, 0.09, { len: 0.24, lowpass: 2600, gain: 0.2 }),
    ],
  },

  // Give: Feed's sweeter cousin — a gift shimmers.
  "care.give": {
    cooldownMs: 160,
    notes: [
      noise(0, { gain: 0.035, lowpass: 3200, release: 0.09 }),
      chime(4, 0, { len: 0.4, gain: 0.12 }),
      chime(7, 0.08, { len: 0.55, gain: 0.11 }),
    ],
  },

  // Refuse: the "nope". Two notes down, the second bending comically
  // FLAT — deflating, never scolding. Soft, dark, and quiet on purpose
  // (spec §5: the world said no, and it feels a bit silly about it).
  "care.refuse": {
    cooldownMs: 320,
    notes: [
      blip(2, 0, { len: 0.14, lowpass: 1050, gain: 0.16 }),
      blip(1, 0.11, {
        len: 0.3,
        lowpass: 820,
        gain: 0.15,
        glideCents: -190,
      }),
    ],
  },

  // --- UI chrome --------------------------------------------------------
  // The tiniest tick in the palette. Fires constantly, so it is short,
  // quiet, droppable, and wobbles more than anything else.
  "ui.tap": {
    cooldownMs: 45,
    jitterCents: 30,
    priority: 0,
    notes: [blip(7, 0, { wave: "sine", len: 0.06, gain: 0.075, lowpass: 3800 })],
  },

  "ui.sheet": {
    cooldownMs: 140,
    notes: [
      noise(0, {
        gain: 0.055,
        attack: 0.03,
        hold: 0.02,
        release: 0.16,
        lowpass: 520,
        lowpassTo: 2600,
      }),
      blip(-2, 0.02, { len: 0.22, lowpass: 900, gain: 0.12 }),
    ],
  },

  "ui.confirm": {
    cooldownMs: 200,
    notes: [
      chime(4, 0, { len: 0.34, gain: 0.12 }),
      chime(7, 0.07, { len: 0.5, gain: 0.11 }),
    ],
  },

  "notify.toast": {
    cooldownMs: 420,
    priority: 0,
    notes: [chime(5, 0, { len: 0.52, gain: 0.085 })],
  },

  // --- "While you were away" -------------------------------------------
  "away.open": {
    cooldownMs: 400,
    notes: [
      noise(0, {
        gain: 0.05,
        attack: 0.12,
        hold: 0.02,
        release: 0.2,
        lowpass: 400,
        lowpassTo: 2200,
      }),
      chime(2, 0.1, { len: 0.6, gain: 0.1 }),
      chime(5, 0.18, { len: 0.7, gain: 0.09 }),
    ],
  },

  "away.dismiss": {
    cooldownMs: 300,
    notes: [
      blip(3, 0, { len: 0.14, lowpass: 1600, gain: 0.14 }),
      blip(0, 0.08, { len: 0.24, lowpass: 1300, gain: 0.13 }),
    ],
  },

  // --- Loot reveal (spec §7) -------------------------------------------
  "reveal.open": {
    cooldownMs: 400,
    priority: 2,
    notes: [
      noise(0, {
        gain: 0.06,
        attack: 0.18,
        hold: 0.02,
        release: 0.14,
        lowpass: 300,
        lowpassTo: 4200,
      }),
      chime(0, 0.14, { len: 0.6, gain: 0.11 }),
      chime(2, 0.2, { len: 0.6, gain: 0.1 }),
      chime(4, 0.26, { len: 0.8, gain: 0.1 }),
    ],
  },

  "reveal.flip": {
    cooldownMs: 90,
    priority: 0,
    notes: [
      noise(0, { gain: 0.05, lowpass: 2400, release: 0.04, rate: 1.4 }),
      blip(5, 0.01, { len: 0.11, lowpass: 3000, gain: 0.11 }),
    ],
  },

  // Rare loot: the shimmer register, top to bottom.
  "reveal.shine": {
    cooldownMs: 160,
    priority: 1,
    notes: [
      noise(0, {
        gain: 0.04,
        attack: 0.02,
        hold: 0.02,
        release: 0.3,
        lowpass: 3600,
        lowpassTo: 7000,
      }),
      chime(7, 0, { len: 0.55, gain: 0.11 }),
      chime(9, 0.05, { len: 0.6, gain: 0.1 }),
      chime(12, 0.11, { len: 0.9, gain: 0.09, detune: 14 }),
    ],
  },

  "reveal.egg": {
    cooldownMs: 220,
    notes: [
      pad(-5, 0, { len: 0.5, gain: 0.08, lowpass: 600 }),
      chime(2, 0.02, { len: 0.6, gain: 0.1, detune: 18 }),
      chime(6, 0.14, { len: 0.8, gain: 0.09, detune: 22 }),
    ],
  },

  "reveal.collect": {
    cooldownMs: 110,
    priority: 0,
    notes: [
      noise(0, { gain: 0.05, lowpass: 1100, release: 0.05 }),
      blip(5, 0, { len: 0.11, lowpass: 2600, gain: 0.15 }),
      blip(2, 0.07, { len: 0.16, lowpass: 2100, gain: 0.14 }),
    ],
  },

  // --- The Keep: building, placing, jobs (spec §6, §9) ------------------
  // The wooden thunk. Low triangle dropping a minor-third's worth of
  // pitch under a short filtered knock: something small and solid met
  // the ground.
  "place.drop": {
    cooldownMs: 90,
    notes: [
      noise(0, { gain: 0.07, lowpass: 700, release: 0.05 }),
      blip(-8, 0, { len: 0.2, lowpass: 620, gain: 0.26, glideCents: -300 }),
    ],
  },

  "keep.place": {
    cooldownMs: 90,
    notes: [
      noise(0, { gain: 0.07, lowpass: 700, release: 0.05 }),
      blip(-8, 0, { len: 0.2, lowpass: 620, gain: 0.26, glideCents: -300 }),
      blip(4, 0.03, { len: 0.18, lowpass: 2600, gain: 0.1 }),
    ],
  },

  "keep.remove": {
    cooldownMs: 120,
    notes: [
      noise(0, { gain: 0.05, lowpass: 600, release: 0.05 }),
      blip(-8, 0, { len: 0.26, lowpass: 560, gain: 0.2, glideCents: -650 }),
    ],
  },

  "place.enter": {
    cooldownMs: 200,
    notes: [
      blip(3, 0, { wave: "sine", len: 0.1, lowpass: 3000, gain: 0.1 }),
      blip(5, 0.06, { wave: "sine", len: 0.16, lowpass: 3400, gain: 0.09 }),
    ],
  },

  "place.confirm": {
    cooldownMs: 160,
    notes: [
      noise(0, { gain: 0.06, lowpass: 800, release: 0.05 }),
      blip(-8, 0, { len: 0.18, lowpass: 620, gain: 0.22, glideCents: -300 }),
      chime(7, 0.05, { len: 0.45, gain: 0.1 }),
    ],
  },

  // Keep level-up: the big one. A rising run into a held chord.
  "keep.levelup": {
    cooldownMs: 900,
    priority: 2,
    notes: [
      blip(0, 0, { len: 0.16, gain: 0.2, lowpass: 2600 }),
      blip(2, 0.09, { len: 0.16, gain: 0.2, lowpass: 2800 }),
      blip(4, 0.18, { len: 0.2, gain: 0.21, lowpass: 3000 }),
      chime(7, 0.28, { len: 0.9, gain: 0.12 }),
      chime(9, 0.32, { len: 0.95, gain: 0.11 }),
      chime(12, 0.36, { len: 1.2, gain: 0.1, detune: 13 }),
      noise(0.28, {
        gain: 0.04,
        attack: 0.03,
        hold: 0.05,
        release: 0.4,
        lowpass: 3000,
        lowpassTo: 7000,
      }),
    ],
  },

  "keep.bunks": {
    cooldownMs: 600,
    priority: 2,
    notes: [
      pad(-5, 0, { len: 0.5, gain: 0.11, lowpass: 800 }),
      pad(-1, 0.08, { len: 0.55, gain: 0.1, lowpass: 1100 }),
      chime(4, 0.16, { len: 0.7, gain: 0.1 }),
    ],
  },

  "job.assign": {
    cooldownMs: 200,
    notes: [
      blip(2, 0, { len: 0.14, lowpass: 1800, gain: 0.18 }),
      blip(4, 0.09, { len: 0.2, lowpass: 2200, gain: 0.18 }),
    ],
  },

  // Gathering production fires on a schedule forever — the quietest,
  // shortest, most droppable cue in the palette, with a long cooldown.
  "job.produce": {
    cooldownMs: 750,
    priority: 0,
    notes: [
      noise(0, { gain: 0.045, lowpass: 1300, release: 0.05 }),
      blip(4, 0.01, { wave: "sine", len: 0.13, lowpass: 2800, gain: 0.1 }),
    ],
  },

  // --- Pips -------------------------------------------------------------
  // Poking a Pip should feel like poking a Pip: a tiny boop that lands
  // somewhere slightly different every time.
  "pip.tap": {
    cooldownMs: 60,
    jitterCents: 70,
    priority: 0,
    notes: [blip(5, 0, { wave: "sine", len: 0.1, gain: 0.11, lowpass: 3200 })],
  },

  "pip.evolveOffer": {
    cooldownMs: 500,
    notes: [
      pad(-3, 0, { len: 0.6, gain: 0.08, lowpass: 700 }),
      chime(7, 0.04, { len: 0.7, gain: 0.1, detune: 24 }),
      chime(9, 0.16, { len: 0.9, gain: 0.09, detune: 24 }),
    ],
  },

  // Evolution gather: a swell. Air rising under a tone climbing an
  // octave — something is being pulled together.
  "evolve.gather": {
    cooldownMs: 900,
    priority: 2,
    notes: [
      noise(0, {
        gain: 0.06,
        attack: 0.5,
        hold: 0.05,
        release: 0.18,
        lowpass: 220,
        lowpassTo: 3200,
      }),
      {
        kind: "tone",
        wave: "triangle",
        degree: -3,
        at: 0.02,
        attack: 0.3,
        decay: 0.1,
        sustain: 0.8,
        hold: 0.16,
        release: 0.2,
        gain: 0.11,
        lowpass: 1600,
        glideCents: 1200,
        detune: 8,
      },
    ],
  },

  // Evolution fanfare: five notes up the scale, then the chord.
  "evolve.fanfare": {
    cooldownMs: 1200,
    priority: 2,
    notes: [
      blip(0, 0, { len: 0.14, gain: 0.2, lowpass: 2600 }),
      blip(2, 0.07, { len: 0.14, gain: 0.2, lowpass: 2700 }),
      blip(4, 0.14, { len: 0.14, gain: 0.21, lowpass: 2900 }),
      blip(5, 0.21, { len: 0.14, gain: 0.21, lowpass: 3100 }),
      blip(7, 0.28, { len: 0.22, gain: 0.22, lowpass: 3300 }),
      chime(7, 0.38, { len: 1.1, gain: 0.12 }),
      chime(9, 0.42, { len: 1.15, gain: 0.11 }),
      chime(12, 0.46, { len: 1.5, gain: 0.1, detune: 15 }),
      noise(0.36, {
        gain: 0.05,
        attack: 0.04,
        hold: 0.06,
        release: 0.5,
        lowpass: 3200,
        lowpassTo: 7600,
      }),
    ],
  },

  "pip.evolve": {
    cooldownMs: 1200,
    priority: 2,
    notes: [
      blip(0, 0, { len: 0.14, gain: 0.2, lowpass: 2600 }),
      blip(4, 0.07, { len: 0.14, gain: 0.2, lowpass: 2800 }),
      blip(7, 0.14, { len: 0.2, gain: 0.21, lowpass: 3100 }),
      chime(9, 0.24, { len: 1.1, gain: 0.11 }),
      chime(12, 0.3, { len: 1.4, gain: 0.1, detune: 15 }),
    ],
  },

  // --- Eggs (spec §7.2) -------------------------------------------------
  "egg.tap": {
    cooldownMs: 70,
    jitterCents: 40,
    priority: 0,
    notes: [
      noise(0, { gain: 0.06, lowpass: 520, release: 0.04 }),
      blip(-6, 0, { len: 0.1, lowpass: 520, gain: 0.16 }),
    ],
  },

  "egg.crack": {
    cooldownMs: 120,
    notes: [
      noise(0, { gain: 0.08, lowpass: 1700, release: 0.05, rate: 1.3 }),
      noise(0.06, { gain: 0.04, lowpass: 2600, release: 0.09, rate: 1.6 }),
      blip(-4, 0, { len: 0.12, lowpass: 900, gain: 0.16 }),
    ],
  },

  "egg.snug": {
    cooldownMs: 400,
    notes: [
      noise(0, { gain: 0.045, lowpass: 600, release: 0.08 }),
      pad(-10, 0.01, { len: 0.45, gain: 0.12, lowpass: 480 }),
      pad(-5, 0.04, { len: 0.42, gain: 0.09, lowpass: 700 }),
    ],
  },

  // Hatch: the four-note fanfare. Rising, open, arriving.
  "egg.hatch": {
    cooldownMs: 1000,
    priority: 2,
    notes: [
      chime(0, 0, { len: 0.4, gain: 0.13 }),
      chime(2, 0.09, { len: 0.4, gain: 0.13 }),
      chime(4, 0.18, { len: 0.45, gain: 0.13 }),
      chime(7, 0.27, { len: 1.1, gain: 0.14, detune: 12 }),
      noise(0.25, {
        gain: 0.04,
        attack: 0.03,
        hold: 0.04,
        release: 0.35,
        lowpass: 2800,
        lowpassTo: 6600,
      }),
    ],
  },

  // Shiny hatch: the same fanfare with an octave doubling stacked on top
  // and a long shimmering tail — the palette's biggest, brightest moment.
  "egg.hatchShiny": {
    cooldownMs: 1000,
    priority: 2,
    notes: [
      chime(0, 0, { len: 0.4, gain: 0.12 }),
      chime(5, 0, { len: 0.4, gain: 0.08 }),
      chime(2, 0.09, { len: 0.4, gain: 0.12 }),
      chime(7, 0.09, { len: 0.4, gain: 0.08 }),
      chime(4, 0.18, { len: 0.45, gain: 0.12 }),
      chime(7, 0.27, { len: 1.2, gain: 0.13, detune: 12 }),
      chime(12, 0.27, { len: 1.4, gain: 0.09, detune: 16 }),
      chime(16, 0.5, { len: 1.8, gain: 0.07, detune: 20 }),
      noise(0.24, {
        gain: 0.05,
        attack: 0.04,
        hold: 0.06,
        release: 0.7,
        lowpass: 3400,
        lowpassTo: 8200,
      }),
    ],
  },

  // --- The parade (the silly one) ---------------------------------------
  // A kazoo is a buzzy square with a fast wobble and no dignity. Four
  // staccato notes, then a held one that slides up and gives up.
  "parade.kazoo": {
    cooldownMs: 1500,
    priority: 2,
    jitterCents: 40,
    notes: [
      noise(0, { gain: 0.05, lowpass: 1400, release: 0.07, rate: 0.8 }),
      blip(2, 0.02, {
        wave: "square",
        len: 0.17,
        lowpass: 1500,
        gain: 0.1,
        vibrato: { rateHz: 13, cents: 45 },
      }),
      blip(4, 0.18, {
        wave: "square",
        len: 0.17,
        lowpass: 1600,
        gain: 0.1,
        vibrato: { rateHz: 14, cents: 45 },
      }),
      blip(2, 0.34, {
        wave: "square",
        len: 0.17,
        lowpass: 1500,
        gain: 0.1,
        vibrato: { rateHz: 13, cents: 50 },
      }),
      blip(0, 0.5, {
        wave: "square",
        len: 0.17,
        lowpass: 1400,
        gain: 0.1,
        vibrato: { rateHz: 12, cents: 50 },
      }),
      {
        kind: "tone",
        wave: "square",
        degree: 4,
        at: 0.66,
        attack: 0.02,
        decay: 0.06,
        sustain: 0.7,
        hold: 0.3,
        release: 0.24,
        gain: 0.1,
        lowpass: 1500,
        glideCents: 160,
        vibrato: { rateHz: 15, cents: 60 },
      },
    ],
  },
};

/** Unknown slot ids still make a small, polite sound rather than nothing
 * — a new `sound("some.new.slot")` seam is audible the day it lands. */
export const DEFAULT_CUE: CueSpec = {
  cooldownMs: 90,
  priority: 0,
  jitterCents: 25,
  notes: [blip(5, 0, { wave: "sine", len: 0.09, gain: 0.08, lowpass: 3200 })],
};

/** Look up a cue, falling back to DEFAULT_CUE. */
export function cueFor(slot: string): CueSpec {
  return SOUND_PALETTE[slot] ?? DEFAULT_CUE;
}
