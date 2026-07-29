/**
 * The pentatonic grid. If these break, every sound in the game moves.
 */

import { describe, expect, it } from "vitest";
import {
  degreeHz,
  degreeSemitones,
  detuneHz,
  PENTATONIC_SEMITONES,
  ROOT_HZ,
} from "./notes";

describe("degreeSemitones", () => {
  it("walks the pentatonic within an octave", () => {
    expect([0, 1, 2, 3, 4].map(degreeSemitones)).toEqual([...PENTATONIC_SEMITONES]);
  });

  it("wraps upward into the next octave", () => {
    expect(degreeSemitones(5)).toBe(12);
    expect(degreeSemitones(6)).toBe(14);
    // Degree 12 = the third degree (E, +4) two octaves up.
    expect(degreeSemitones(12)).toBe(4 + 24);
  });

  it("wraps downward for negative degrees (the warm low register)", () => {
    // −1 is the A below the root: 9 semitones up, one octave down.
    expect(degreeSemitones(-1)).toBe(-3);
    expect(degreeSemitones(-5)).toBe(-12);
    expect(degreeSemitones(-10)).toBe(-24);
  });

  // The property that makes overlapping cues safe: no two adjacent
  // degrees are a semitone apart, so any two notes sound consonant.
  it("never produces a semitone neighbour inside one octave", () => {
    const steps = [0, 1, 2, 3, 4, 5].map(degreeSemitones);
    for (let i = 1; i < steps.length; i++) {
      const gap = (steps[i] as number) - (steps[i - 1] as number);
      expect(gap).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("degreeHz", () => {
  it("puts degree 0 on the root", () => {
    expect(degreeHz(0)).toBeCloseTo(ROOT_HZ, 6);
  });

  it("doubles every five degrees (one octave)", () => {
    expect(degreeHz(5)).toBeCloseTo(ROOT_HZ * 2, 6);
    expect(degreeHz(-5)).toBeCloseTo(ROOT_HZ / 2, 6);
    expect(degreeHz(10)).toBeCloseTo(ROOT_HZ * 4, 6);
  });

  it("rises monotonically with the degree", () => {
    for (let d = -12; d < 20; d++) {
      expect(degreeHz(d + 1)).toBeGreaterThan(degreeHz(d));
    }
  });
});

describe("detuneHz", () => {
  it("treats 1200 cents as an octave and 0 as a no-op", () => {
    expect(detuneHz(440, 1200)).toBeCloseTo(880, 6);
    expect(detuneHz(440, -1200)).toBeCloseTo(220, 6);
    expect(detuneHz(440, 0)).toBe(440);
  });
});
