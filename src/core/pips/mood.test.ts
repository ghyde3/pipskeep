/**
 * Mood derivation tests (spec §4.3, Phase 1 gate): precedence order
 * Miserable → Grumpy → Beaming → Content asserted explicitly, including
 * boundary values exactly at the 15/40/70 thresholds — plus OVERLAPPING
 * injected thresholds, the only way the order is observable at all (the
 * shipped predicates are mutually exclusive). Also the Chaotic display
 * quirk: deriveDisplayedMood's roll contract, step directions, end clamps,
 * and determinism from seeded streams.
 */

import { describe, expect, it } from "vitest";
import { tuning } from "../../content/tuning";
import { DIALOGUE_CONTEXTS as CONTENT_DIALOGUE_CONTEXTS } from "../../content/dialogue";
import { createRng } from "../rng";
import type { RngStream } from "../rng";
import type { PipNeeds } from "./types";
import { DIALOGUE_CONTEXTS, MOODS, deriveDisplayedMood, deriveMood } from "./mood";
import type { Mood } from "./mood";

const needs = (overrides: Partial<PipNeeds> = {}): PipNeeds => ({
  hunger: 100,
  cleanliness: 100,
  happiness: 100,
  energy: 100,
  ...overrides,
});

describe("deriveMood — spec §4.3 thresholds", () => {
  it("tuning thresholds match the spec table (15 / 40 / 70)", () => {
    expect(tuning.mood.miserableBelow).toBe(15);
    expect(tuning.mood.grumpyBelow).toBe(40);
    expect(tuning.mood.beamingAtOrAbove).toBe(70);
  });

  it("Beaming — all needs ≥ 70", () => {
    expect(deriveMood(needs())).toBe("beaming");
    expect(deriveMood({ hunger: 70, cleanliness: 70, happiness: 70, energy: 70 })).toBe(
      "beaming",
    ); // boundary: exactly 70 is Beaming
  });

  it("Content — all ≥ 40 but not all ≥ 70", () => {
    expect(deriveMood(needs({ happiness: 69 }))).toBe("content"); // just under Beaming
    expect(deriveMood({ hunger: 40, cleanliness: 40, happiness: 40, energy: 40 })).toBe(
      "content",
    ); // boundary: exactly 40 is NOT Grumpy
  });

  it("Grumpy — any need < 40", () => {
    expect(deriveMood(needs({ cleanliness: 39 }))).toBe("grumpy");
    expect(deriveMood(needs({ energy: 15 }))).toBe("grumpy"); // boundary: exactly 15 is NOT Miserable
  });

  it("Miserable — any need < 15", () => {
    expect(deriveMood(needs({ hunger: 14 }))).toBe("miserable");
    expect(deriveMood(needs({ hunger: 14.999 }))).toBe("miserable");
    expect(deriveMood({ hunger: 0, cleanliness: 0, happiness: 0, energy: 0 })).toBe(
      "miserable",
    );
  });
});

describe("deriveMood — precedence order (spec §4.3: first match wins)", () => {
  it("Miserable beats Grumpy when both match (any < 15 implies any < 40)", () => {
    // hunger 10 satisfies both "any < 15" and "any < 40" — order resolves it.
    expect(deriveMood(needs({ hunger: 10 }))).toBe("miserable");
  });

  it("Miserable beats Grumpy even when a second need is independently Grumpy", () => {
    expect(deriveMood(needs({ hunger: 10, energy: 30 }))).toBe("miserable");
  });

  it("Beaming beats Content when both match (all ≥ 70 implies all ≥ 40)", () => {
    expect(deriveMood({ hunger: 85, cleanliness: 85, happiness: 85, energy: 85 })).toBe(
      "beaming",
    );
  });

  it("one Grumpy need vetoes Beaming for the rest (Grumpy is checked first)", () => {
    expect(deriveMood(needs({ happiness: 39 }))).toBe("grumpy");
  });

  it("walks down through all four moods as a single need falls", () => {
    expect(deriveMood(needs({ hunger: 100 }))).toBe("beaming");
    expect(deriveMood(needs({ hunger: 69 }))).toBe("content");
    expect(deriveMood(needs({ hunger: 40 }))).toBe("content");
    expect(deriveMood(needs({ hunger: 39 }))).toBe("grumpy");
    expect(deriveMood(needs({ hunger: 15 }))).toBe("grumpy");
    expect(deriveMood(needs({ hunger: 14 }))).toBe("miserable");
    expect(deriveMood(needs({ hunger: 0 }))).toBe("miserable");
  });

  it("uses the thresholds passed in (injectable for tests)", () => {
    const custom = { miserableBelow: 5, grumpyBelow: 20, beamingAtOrAbove: 90 };
    expect(deriveMood(needs({ hunger: 10 }), custom)).toBe("grumpy");
    expect(deriveMood(needs({ hunger: 89 }), custom)).toBe("content");
    expect(deriveMood(needs(), custom)).toBe("beaming");
  });

  // Under the SHIPPED tuning (grumpyBelow 40 ≤ beamingAtOrAbove 70) the
  // Grumpy and Beaming predicates are mutually exclusive, so no needs value
  // can observe their relative order — only deliberately OVERLAPPING
  // injected thresholds can. These tests are the ones that actually pin the
  // spec-structural precedence (a mutant swapping the checks passes every
  // shipped-tuning test).
  it("Grumpy is checked BEFORE Beaming: overlapping thresholds expose the order", () => {
    // grumpyBelow (50) > beamingAtOrAbove (30): a min need of 40 satisfies
    // BOTH "any < 50" (Grumpy) and "all ≥ 30" (Beaming). First match wins.
    const overlapping = { miserableBelow: 5, grumpyBelow: 50, beamingAtOrAbove: 30 };
    expect(deriveMood(needs({ hunger: 40 }), overlapping)).toBe("grumpy");
    // All four needs inside the overlap band — still Grumpy.
    expect(
      deriveMood(
        { hunger: 45, cleanliness: 45, happiness: 45, energy: 45 },
        overlapping,
      ),
    ).toBe("grumpy");
    // Sanity outside the overlap: the usual bands still hold.
    expect(deriveMood(needs({ hunger: 3 }), overlapping)).toBe("miserable");
    expect(deriveMood(needs({ hunger: 60 }), overlapping)).toBe("beaming");
  });

  it("Miserable is checked BEFORE Beaming under overlap too", () => {
    // miserableBelow (60) > beamingAtOrAbove (30); grumpyBelow 0 never
    // matches. A min need of 50 satisfies both Miserable and Beaming.
    const overlapping = { miserableBelow: 60, grumpyBelow: 0, beamingAtOrAbove: 30 };
    expect(deriveMood(needs({ hunger: 50 }), overlapping)).toBe("miserable");
    expect(deriveMood(needs({ hunger: 60 }), overlapping)).toBe("beaming");
  });

  it("Miserable is checked BEFORE Grumpy under overlap (equal thresholds)", () => {
    // miserableBelow == grumpyBelow: any value under both matches both
    // "any < x" predicates; the first check must win.
    const overlapping = { miserableBelow: 30, grumpyBelow: 30, beamingAtOrAbove: 90 };
    expect(deriveMood(needs({ hunger: 20 }), overlapping)).toBe("miserable");
  });
});

describe("deriveDisplayedMood — Chaotic display quirk (spec §4.3)", () => {
  /**
   * Scripted stream: `next()` returns the given rolls in order and throws
   * when exhausted, so each test pins EXACTLY how many rolls are consumed.
   * `chance`/`pick`/`int` mirror MulberryStream's formulas over `next()`.
   */
  function scriptedRng(rolls: readonly number[]): RngStream {
    let cursor = 0;
    const next = (): number => {
      const roll = rolls[cursor];
      if (roll === undefined) {
        throw new Error(`scripted rng exhausted after ${cursor} roll(s)`);
      }
      cursor += 1;
      return roll;
    };
    return {
      next,
      int: (maxExclusive: number) => Math.floor(next() * maxExclusive),
      pick: <T,>(array: readonly T[]): T => {
        const item = array[Math.floor(next() * array.length)];
        if (item === undefined) throw new Error("pick on empty array");
        return item;
      },
      chance: (p: number) => next() < p,
      getState: () => cursor,
    };
  }

  const CHANCE = tuning.quirks.chaoticMoodDisplayOffsetChance;

  it("non-Chaotic personalities always display the actual mood and consume ZERO rolls", () => {
    // An exhausted-from-the-start stream throws on any next(): reaching
    // the rng at all would fail the test.
    for (const personalityId of ["lazy", "curious", "hardworking", "clingy", "neutral"]) {
      for (const mood of MOODS) {
        expect(deriveDisplayedMood(mood, personalityId, scriptedRng([]))).toBe(mood);
      }
    }
  });

  it("Chaotic, offset roll ≥ chance: actual mood, exactly one roll consumed", () => {
    const rng = scriptedRng([CHANCE]); // boundary: chance() is a STRICT <
    expect(deriveDisplayedMood("content", "chaotic", rng)).toBe("content");
    expect(rng.getState()).toBe(1); // the direction roll was NOT consumed
  });

  it("Chaotic, offset fires: one step off, direction picked by the second roll", () => {
    // Roll 1 (0 < 0.1) fires the offset; roll 2 picks among the neighbors
    // [brighter, dimmer] — low → brighter, high → dimmer.
    expect(deriveDisplayedMood("content", "chaotic", scriptedRng([0, 0]))).toBe("beaming");
    expect(deriveDisplayedMood("content", "chaotic", scriptedRng([0, 0.99]))).toBe("grumpy");
    expect(deriveDisplayedMood("grumpy", "chaotic", scriptedRng([0, 0]))).toBe("content");
    expect(deriveDisplayedMood("grumpy", "chaotic", scriptedRng([0, 0.99]))).toBe("miserable");
  });

  it("clamps at the ends: Beaming can only show Content, Miserable only Grumpy", () => {
    for (const direction of [0, 0.99]) {
      expect(deriveDisplayedMood("beaming", "chaotic", scriptedRng([0, direction]))).toBe(
        "content",
      );
      expect(deriveDisplayedMood("miserable", "chaotic", scriptedRng([0, direction]))).toBe(
        "grumpy",
      );
    }
  });

  it("consumes exactly two rolls when the offset fires, even at the ends (cursor discipline)", () => {
    for (const mood of MOODS) {
      const rng = scriptedRng([0, 0.5]);
      const displayed = deriveDisplayedMood(mood, "chaotic", rng);
      expect(displayed).not.toBe(mood); // offset fired → never the actual
      expect(rng.getState()).toBe(2);
    }
  });

  it("reads the chance from content tuning by default (the constant has a consumer)", () => {
    expect(CHANCE).toBe(0.1);
    // Just under the tuned chance fires the offset; exactly at it does not.
    expect(deriveDisplayedMood("content", "chaotic", scriptedRng([CHANCE - 0.001, 0])))
      .toBe("beaming");
    expect(deriveDisplayedMood("content", "chaotic", scriptedRng([CHANCE]))).toBe("content");
  });

  it("is deterministic from a seeded stream, and both directions occur (real RNG)", () => {
    const run = (): Mood[] => {
      const stream = createRng(12345).stream("mood-display");
      return Array.from({ length: 200 }, () =>
        deriveDisplayedMood("content", "chaotic", stream),
      );
    };
    const a = run();
    const b = run();
    expect(a).toEqual(b); // same seed → identical displayed sequence
    // With chance 0.1 over 200 draws this seed shows both neighbors and
    // mostly the actual mood (counts are deterministic for the fixed seed).
    expect(a.filter((mood) => mood === "content").length).toBeGreaterThan(150);
    expect(a).toContain("beaming");
    expect(a).toContain("grumpy");
  });
});

describe("Mood + dialogue-context vocabulary (spec §3/§4.3)", () => {
  it("exposes the four moods", () => {
    expect(MOODS).toEqual(["beaming", "content", "grumpy", "miserable"]);
  });

  it("exposes exactly the 7 contexts: 4 moods + sulking + refusal + greeting", () => {
    // ROUND 2K (docs/liveliness-bible.md §4.5) — `greeting` is the only
    // context whose audience is another PIP rather than the player. It
    // is last on purpose: appending keeps every existing pool's identity
    // and every `lineId` (`personality/context/index`) stable.
    expect(DIALOGUE_CONTEXTS).toEqual([
      "beaming",
      "content",
      "grumpy",
      "miserable",
      "sulking",
      "refusal",
      "greeting",
    ]);
  });

  it("stays in lockstep with the content dialogue registry's contexts", () => {
    expect([...DIALOGUE_CONTEXTS]).toEqual([...CONTENT_DIALOGUE_CONTEXTS]);
  });
});
