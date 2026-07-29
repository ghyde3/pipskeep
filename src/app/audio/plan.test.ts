/**
 * The pure planner, and the sound design itself.
 *
 * The palette tests are the interesting half: "the hatch fanfare rises",
 * "the refusal bends downward and stays quiet", "the parade is buzzy" are
 * assertions about how the game FEELS, and they hold with no AudioContext
 * anywhere near them.
 */

import { describe, expect, it } from "vitest";
import { degreeHz } from "./notes";
import { DEFAULT_CUE, SOUND_PALETTE, cueFor } from "./palette";
import { DEFAULT_JITTER_CENTS, noteCost, planCue } from "./plan";
import type { CueSpec, PlannedTone, ToneSpec } from "./plan";

const tones = (spec: CueSpec): ToneSpec[] =>
  spec.notes.filter((n): n is ToneSpec => n.kind === "tone");

const plannedTones = (voices: readonly { kind: string }[]): PlannedTone[] =>
  voices.filter((v): v is PlannedTone => v.kind === "tone");

const simple: CueSpec = {
  cooldownMs: 100,
  jitterCents: 0,
  notes: [
    {
      kind: "tone",
      wave: "triangle",
      degree: 0,
      at: 0,
      attack: 0.01,
      decay: 0.05,
      sustain: 0.5,
      hold: 0.02,
      release: 0.1,
      gain: 0.2,
    },
    {
      kind: "tone",
      wave: "sine",
      degree: 4,
      at: 0.1,
      attack: 0.01,
      decay: 0.05,
      sustain: 0.5,
      hold: 0,
      release: 0.2,
      gain: 0.1,
    },
  ],
};

describe("planCue — absolute timing", () => {
  it("offsets every note from the cue start", () => {
    const plan = planCue("test", simple, 10, 0.5);
    expect(plan.start).toBe(10);
    expect(plan.voices[0]?.start).toBe(10);
    expect(plan.voices[1]?.start).toBeCloseTo(10.1, 9);
  });

  it("ends when the LAST voice falls silent, not the last one started", () => {
    const plan = planCue("test", simple, 0, 0.5);
    // note 0: 0.01 + 0.05 + 0.02 + 0.1 = 0.18
    // note 1: starts 0.1, lasts 0.01 + 0.05 + 0 + 0.2 = 0.26 → ends 0.36
    expect(plan.end).toBeCloseTo(0.36, 9);
  });

  it("counts voices: a detuned pair is two oscillators, vibrato adds one", () => {
    expect(noteCost({ ...(simple.notes[0] as ToneSpec) })).toBe(1);
    expect(noteCost({ ...(simple.notes[0] as ToneSpec), detune: 9 })).toBe(2);
    expect(
      noteCost({
        ...(simple.notes[0] as ToneSpec),
        detune: 9,
        vibrato: { rateHz: 5, cents: 20 },
      }),
    ).toBe(3);
    expect(noteCost({ kind: "noise", at: 0, attack: 0, hold: 0, release: 0.1, gain: 0.1, lowpass: 900 })).toBe(1);
    expect(planCue("test", simple, 0, 0.5).voiceCost).toBe(2);
  });
});

describe("planCue — pitch jitter", () => {
  it("is dead-centre at 0.5 — the authored pitch, exactly", () => {
    const plan = planCue("test", { ...simple, jitterCents: 20 }, 0, 0.5);
    const [a, b] = plannedTones(plan.voices);
    expect(a?.freq).toBeCloseTo(degreeHz(0), 6);
    expect(b?.freq).toBeCloseTo(degreeHz(4), 6);
  });

  it("bends a full ±jitterCents at the extremes", () => {
    const low = plannedTones(planCue("t", { ...simple, jitterCents: 1200 }, 0, 0).voices);
    const high = plannedTones(planCue("t", { ...simple, jitterCents: 1200 }, 0, 1).voices);
    expect(low[0]?.freq).toBeCloseTo(degreeHz(0) / 2, 6);
    expect(high[0]?.freq).toBeCloseTo(degreeHz(0) * 2, 6);
  });

  it("transposes the WHOLE cue by one draw, so a fanfare stays in tune with itself", () => {
    const plan = planCue("t", { ...simple, jitterCents: 40 }, 0, 0.13);
    const [a, b] = plannedTones(plan.voices);
    const ratioA = (a as PlannedTone).freq / degreeHz(0);
    const ratioB = (b as PlannedTone).freq / degreeHz(4);
    expect(ratioA).toBeCloseTo(ratioB, 12);
    expect(ratioA).not.toBeCloseTo(1, 6); // it really did move
  });

  it("defaults to a subtle wobble — alive, not out of tune", () => {
    expect(DEFAULT_JITTER_CENTS).toBeGreaterThan(0);
    expect(DEFAULT_JITTER_CENTS).toBeLessThan(50);
  });
});

describe("planCue — glides and noise", () => {
  it("resolves glideCents into an absolute target frequency", () => {
    const plan = planCue(
      "t",
      {
        cooldownMs: 10,
        jitterCents: 0,
        notes: [
          {
            ...(simple.notes[0] as ToneSpec),
            glideCents: -1200,
          },
        ],
      },
      0,
      0.5,
    );
    const tone = plannedTones(plan.voices)[0] as PlannedTone;
    expect(tone.freq).toBeCloseTo(degreeHz(0), 6);
    expect(tone.glideTo).toBeCloseTo(degreeHz(0) / 2, 6);
  });

  it("leaves glideTo equal to freq when a note does not glide", () => {
    const tone = plannedTones(planCue("t", simple, 0, 0.5).voices)[0] as PlannedTone;
    expect(tone.glideTo).toBe(tone.freq);
  });

  it("defaults a noise burst's filter sweep to a flat cutoff", () => {
    const plan = planCue(
      "t",
      {
        cooldownMs: 10,
        notes: [{ kind: "noise", at: 0, attack: 0.01, hold: 0.01, release: 0.05, gain: 0.06, lowpass: 900 }],
      },
      0,
      0.5,
    );
    const voice = plan.voices[0];
    expect(voice?.kind).toBe("noise");
    if (voice?.kind !== "noise") throw new Error("expected a noise voice");
    expect(voice.lowpassTo).toBe(900);
    expect(voice.end).toBeCloseTo(0.07, 9);
  });
});

// ---------------------------------------------------------------------------
// The palette
// ---------------------------------------------------------------------------

/** Every slot id the game actually calls (grep `sound(` across src/).
 * A missing entry is not fatal at runtime — DEFAULT_CUE covers it — but
 * it does mean a moment nobody bothered to score. */
const CALLED_SLOTS = [
  "care.feed", "care.clean", "care.play", "care.pet", "care.rest",
  "care.wake", "care.give", "care.refuse",
  "ui.tap", "ui.sheet", "ui.confirm", "notify.toast",
  "away.open", "away.dismiss",
  "reveal.open", "reveal.flip", "reveal.shine", "reveal.egg", "reveal.collect",
  "keep.place", "keep.remove", "keep.levelup", "keep.bunks",
  "place.drop", "place.enter", "place.confirm",
  "job.assign", "job.produce",
  "pip.tap", "pip.evolveOffer", "pip.evolve",
  "evolve.gather", "evolve.fanfare",
  "egg.tap", "egg.crack", "egg.snug", "egg.hatch", "egg.hatchShiny",
  "parade.kazoo",
] as const;

describe("SOUND_PALETTE — coverage and hygiene", () => {
  it("scores every slot the game calls", () => {
    const missing = CALLED_SLOTS.filter((slot) => SOUND_PALETTE[slot] === undefined);
    expect(missing).toEqual([]);
  });

  it("falls back to a real cue for an unknown slot — a new seam is never mute", () => {
    expect(cueFor("some.brand.new.slot")).toBe(DEFAULT_CUE);
    expect(DEFAULT_CUE.notes.length).toBeGreaterThan(0);
  });

  it("keeps every cue short, quiet, and inside the audible band", () => {
    for (const [slot, spec] of Object.entries(SOUND_PALETTE)) {
      expect(spec.notes.length, slot).toBeGreaterThan(0);
      expect(spec.cooldownMs, slot).toBeGreaterThanOrEqual(40);
      const plan = planCue(slot, spec, 0, 0.5);
      // Nothing outstays its welcome…
      expect(plan.end, slot).toBeLessThanOrEqual(2.6);
      for (const voice of plan.voices) {
        // …nothing is loud on its own (the limiter is a safety net, not
        // a mixing tool)…
        expect(voice.peak, slot).toBeGreaterThan(0);
        expect(voice.peak, slot).toBeLessThanOrEqual(0.3);
        if (voice.kind === "tone") {
          // …and every pitch is somewhere a small speaker can render.
          expect(voice.freq, slot).toBeGreaterThan(60);
          expect(voice.freq, slot).toBeLessThan(9000);
          expect(voice.glideTo, slot).toBeGreaterThan(50);
          expect(voice.sustain, slot).toBeGreaterThanOrEqual(0);
          expect(voice.sustain, slot).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("stays inside the voice cap for every single cue", () => {
    for (const [slot, spec] of Object.entries(SOUND_PALETTE)) {
      expect(planCue(slot, spec, 0, 0.5).voiceCost, slot).toBeLessThanOrEqual(18);
    }
  });

  it("gives the once-a-session moments priority over chatter", () => {
    for (const slot of ["egg.hatch", "egg.hatchShiny", "evolve.fanfare", "keep.levelup", "parade.kazoo"]) {
      expect(SOUND_PALETTE[slot]?.priority, slot).toBe(2);
    }
    // …and the constant background chatter is the first thing dropped.
    for (const slot of ["ui.tap", "pip.tap", "job.produce", "notify.toast"]) {
      expect(SOUND_PALETTE[slot]?.priority, slot).toBe(0);
    }
  });
});

describe("SOUND_PALETTE — the sound design reads correctly", () => {
  it("hatch is a four-note fanfare that RISES", () => {
    const degrees = tones(SOUND_PALETTE["egg.hatch"] as CueSpec).map((t) => t.degree);
    expect(degrees).toEqual([0, 2, 4, 7]);
    for (let i = 1; i < degrees.length; i++) {
      expect(degrees[i] as number).toBeGreaterThan(degrees[i - 1] as number);
    }
  });

  it("the shiny hatch is the same shape but bigger, brighter, and longer", () => {
    const plain = SOUND_PALETTE["egg.hatch"] as CueSpec;
    const shiny = SOUND_PALETTE["egg.hatchShiny"] as CueSpec;
    expect(shiny.notes.length).toBeGreaterThan(plain.notes.length);
    const topPlain = Math.max(...tones(plain).map((t) => t.degree));
    const topShiny = Math.max(...tones(shiny).map((t) => t.degree));
    expect(topShiny).toBeGreaterThan(topPlain);
    expect(planCue("s", shiny, 0, 0.5).end).toBeGreaterThan(
      planCue("p", plain, 0, 0.5).end,
    );
  });

  it("evolution is a rising RUN into a held chord", () => {
    const degrees = tones(SOUND_PALETTE["evolve.fanfare"] as CueSpec)
      .slice(0, 5)
      .map((t) => t.degree);
    expect(degrees).toEqual([0, 2, 4, 5, 7]);
  });

  it("rest sighs downward and wake steps back up", () => {
    const rest = tones(SOUND_PALETTE["care.rest"] as CueSpec)[0] as ToneSpec;
    expect(rest.glideCents ?? 0).toBeLessThan(0);
    const wake = tones(SOUND_PALETTE["care.wake"] as CueSpec).map((t) => t.degree);
    expect(wake[1] as number).toBeGreaterThan(wake[0] as number);
  });

  it("the refusal is a gentle downward bend — funny, never harsh", () => {
    const spec = SOUND_PALETTE["care.refuse"] as CueSpec;
    const notes = tones(spec);
    expect((notes[1] as ToneSpec).degree).toBeLessThan((notes[0] as ToneSpec).degree);
    expect((notes[1] as ToneSpec).glideCents ?? 0).toBeLessThan(0); // bends FLAT
    for (const note of notes) {
      expect(note.gain).toBeLessThanOrEqual(0.18); // quieter than praise
      expect(note.lowpass ?? Infinity).toBeLessThanOrEqual(1100); // dark, soft
    }
  });

  it("pet purrs: low, sustained, and wobbling", () => {
    const notes = tones(SOUND_PALETTE["care.pet"] as CueSpec);
    for (const note of notes) {
      expect(note.degree).toBeLessThan(0); // the warm low register
      expect(note.sustain).toBeGreaterThan(0.5); // it is HELD, not plucked
    }
    expect(notes.some((n) => n.vibrato !== undefined)).toBe(true);
  });

  it("the parade kazoo is buzzy, wobbly and silly", () => {
    const notes = tones(SOUND_PALETTE["parade.kazoo"] as CueSpec);
    expect(notes.every((n) => n.wave === "square")).toBe(true);
    expect(notes.every((n) => n.vibrato !== undefined)).toBe(true);
    expect(notes.every((n) => (n.vibrato?.rateHz ?? 0) >= 10)).toBe(true);
  });

  it("wooden thunks live low and drop in pitch", () => {
    for (const slot of ["place.drop", "keep.place", "keep.remove"]) {
      const thunk = tones(SOUND_PALETTE[slot] as CueSpec)[0] as ToneSpec;
      expect(thunk.degree, slot).toBeLessThan(0);
      expect(thunk.glideCents ?? 0, slot).toBeLessThan(0);
      expect(thunk.lowpass ?? Infinity, slot).toBeLessThanOrEqual(700);
    }
  });

  it("ui.tap is the smallest thing in the palette", () => {
    const tap = SOUND_PALETTE["ui.tap"] as CueSpec;
    expect(tap.notes.length).toBe(1);
    expect(planCue("ui.tap", tap, 0, 0.5).end).toBeLessThan(0.1);
    expect(tap.cooldownMs).toBeLessThanOrEqual(60);
    for (const [slot, spec] of Object.entries(SOUND_PALETTE)) {
      if (slot === "ui.tap") continue;
      expect(planCue(slot, spec, 0, 0.5).end, slot).toBeGreaterThanOrEqual(
        planCue("ui.tap", tap, 0, 0.5).end,
      );
    }
  });
});
