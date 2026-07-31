/**
 * Dialogue selection tests (spec §3, §4.3, Phase 2): displayedMood's
 * Chaotic offset (determinism, roll contract, adjacency, end clamps) and
 * pickDialogueLine (deterministic via the "dialogue" stream, exactly one
 * roll per pick, never repeats the immediately-previous line per pip per
 * context, cursor + no-repeat memory threaded through state).
 */

import { describe, expect, it } from "vitest";
import { tuning } from "../../content/tuning";
import { dialogue as contentDialogue } from "../../content/dialogue";
import { createRng, createRngFromState } from "../rng";
import { LifeStage, PipActivity } from "./types";
import type { PipNeeds, PipState } from "./types";
import { MOODS, deriveMood } from "./mood";
import type { Mood } from "./mood";
import {
  DIALOGUE_STREAM,
  displayedMood,
  pickDialogueLine,
  pickLineFromPools,
} from "./dialogue";
import type { DialoguePoolsView, DialogueStateSlice } from "./dialogue";

const needs = (overrides: Partial<PipNeeds> = {}): PipNeeds => ({
  hunger: 100,
  cleanliness: 100,
  happiness: 100,
  energy: 100,
  ...overrides,
});

function makePip(overrides: Partial<PipState> = {}): PipState {
  return {
    id: "pip-1",
    speciesId: "mosspip",
    name: "Testpip",
    genome: {
      speciesId: "mosspip",
      palette: "fern",
      pattern: "plain",
      personalityId: "curious",
      shiny: false,
    },
    personalityId: "curious",
    lifeStage: LifeStage.Adult,
    hatchedAt: 0,
    ageMs: 0,
    happinessIntegral: 0,
    needs: needs(),
    activity: PipActivity.Idle,
    pendingSulk: false,
    readyToEvolve: false,
    evolved: null,
    lastGiftItemId: null,
    expedition: null,
    needsUpdatedAt: 0,
    ...overrides,
  };
}

/** First roll of a fresh stream `name` under `seed` — for seed scans. */
function firstRoll(seed: number, name: string): number {
  return createRng(seed).stream(name).next();
}

/** Find a seed whose first `name` roll satisfies `test` (pure scan). */
function findSeed(name: string, test: (roll: number) => boolean): number {
  for (let seed = 1; seed < 10_000; seed++) {
    if (test(firstRoll(seed, name))) return seed;
  }
  throw new Error("no seed found in scan range");
}

const OFFSET_CHANCE = tuning.quirks.chaoticMoodDisplayOffsetChance;

describe("displayedMood — spec §4.3 Chaotic display quirk", () => {
  it("tuning: chaoticMoodDisplayOffsetChance is 10%", () => {
    expect(OFFSET_CHANCE).toBe(0.1);
  });

  it("non-Chaotic personalities always display the actual mood and consume ZERO rolls", () => {
    for (const personalityId of ["lazy", "curious", "hardworking", "clingy"]) {
      const pip = makePip({ personalityId, needs: needs({ hunger: 50 }) });
      const stream = createRng(7).stream("mood-display");
      const untouched = createRng(7).stream("mood-display");
      expect(displayedMood(pip, stream)).toBe(deriveMood(pip.needs));
      expect(stream.getState()).toBe(untouched.getState()); // zero rolls
    }
  });

  it("Chaotic no-fire: displays the actual mood, consuming exactly one roll", () => {
    const seed = findSeed("mood-display", (r) => r >= OFFSET_CHANCE);
    const pip = makePip({ personalityId: "chaotic", needs: needs({ hunger: 50 }) });
    const stream = createRng(seed).stream("mood-display");
    const reference = createRng(seed).stream("mood-display");
    expect(displayedMood(pip, stream)).toBe("content"); // actual: min 50 → content
    reference.next(); // the offset check
    expect(stream.getState()).toBe(reference.getState()); // exactly one roll
  });

  it("Chaotic fire: displays an ADJACENT mood, never the actual one, consuming exactly two rolls", () => {
    const seed = findSeed("mood-display", (r) => r < OFFSET_CHANCE);
    const pip = makePip({ personalityId: "chaotic", needs: needs({ hunger: 50 }) });
    const stream = createRng(seed).stream("mood-display");
    const reference = createRng(seed).stream("mood-display");
    const shown = displayedMood(pip, stream);
    const actual: Mood = "content";
    expect(shown).not.toBe(actual);
    expect(Math.abs(MOODS.indexOf(shown) - MOODS.indexOf(actual))).toBe(1);
    reference.next(); // offset check
    reference.next(); // direction
    expect(stream.getState()).toBe(reference.getState()); // exactly two rolls
  });

  it("clamps at the ends: Beaming can only show Content, Miserable only Grumpy", () => {
    const seed = findSeed("mood-display", (r) => r < OFFSET_CHANCE);
    const beaming = makePip({ personalityId: "chaotic" }); // all 100
    expect(displayedMood(beaming, createRng(seed).stream("mood-display"))).toBe(
      "content",
    );
    const miserable = makePip({
      personalityId: "chaotic",
      needs: needs({ hunger: 5 }),
    });
    expect(
      displayedMood(miserable, createRng(seed).stream("mood-display")),
    ).toBe("grumpy");
  });

  it("is deterministic: same seed and state → same displayed mood", () => {
    const pip = makePip({ personalityId: "chaotic", needs: needs({ energy: 45 }) });
    for (let seed = 1; seed <= 50; seed++) {
      const a = displayedMood(pip, createRng(seed).stream("mood-display"));
      const b = displayedMood(pip, createRng(seed).stream("mood-display"));
      expect(a).toBe(b);
    }
  });
});

function makeState(
  overrides: Partial<DialogueStateSlice> & { pip?: PipState } = {},
): DialogueStateSlice {
  const pip = overrides.pip ?? makePip();
  return {
    seed: 42,
    rngState: {},
    pips: { [pip.id]: pip },
    lastLineIndex: {},
    ...overrides,
  };
}

describe("pickDialogueLine — spec §3 (deterministic, no immediate repeat)", () => {
  it("picks a line from the pip's personality × context pool with a stable lineId", () => {
    const state = makeState();
    const { line } = pickDialogueLine(state, "pip-1", "beaming");
    expect(line).not.toBeNull();
    const pool = contentDialogue.curious.beaming;
    expect(pool).toContain(line?.text);
    expect(line?.lineId).toBe(`curious/beaming/${line?.index}`);
    expect(line?.context).toBe("beaming");
  });

  it("is deterministic: identical state produces the identical line and state", () => {
    const state = makeState();
    const a = pickDialogueLine(state, "pip-1", "grumpy");
    const b = pickDialogueLine(state, "pip-1", "grumpy");
    expect(a.line).toEqual(b.line);
    expect(a.state).toEqual(b.state);
  });

  it("advances the dialogue cursor and the pip's no-repeat memory in the returned state", () => {
    const state = makeState();
    const { state: next, line } = pickDialogueLine(state, "pip-1", "refusal");
    expect(line).not.toBeNull();
    expect(next.rngState[DIALOGUE_STREAM]).toBeTypeOf("number");
    expect(next.lastLineIndex["pip-1"]?.refusal).toBe(line?.index);
    // input untouched
    expect(state.rngState).toEqual({});
    expect(state.lastLineIndex).toEqual({});
  });

  it("never repeats the immediately-previous line in a context (chained picks)", () => {
    let state = makeState();
    let previous: number | undefined;
    for (let i = 0; i < 25; i++) {
      const result = pickDialogueLine(state, "pip-1", "content");
      expect(result.line).not.toBeNull();
      if (previous !== undefined) {
        expect(result.line?.index).not.toBe(previous);
      }
      previous = result.line?.index;
      state = result.state;
    }
  });

  it("no-repeat memory is per context: a repeat is only avoided within the same context", () => {
    const pools: DialoguePoolsView = {
      curious: {
        beaming: ["b0", "b1", "b2"],
        content: ["c0", "c1", "c2"],
      },
    };
    let state = makeState();
    const first = pickDialogueLine(state, "pip-1", "beaming", pools);
    state = first.state;
    const other = pickDialogueLine(state, "pip-1", "content", pools);
    state = other.state;
    expect(state.lastLineIndex["pip-1"]?.beaming).toBe(first.line?.index);
    expect(state.lastLineIndex["pip-1"]?.content).toBe(other.line?.index);
  });

  it("a single-line pool repeats (repeat unavoidable) rather than failing", () => {
    const pools: DialoguePoolsView = { curious: { sulking: ["only line"] } };
    let state = makeState();
    for (let i = 0; i < 3; i++) {
      const result = pickDialogueLine(state, "pip-1", "sulking", pools);
      expect(result.line?.text).toBe("only line");
      expect(result.line?.index).toBe(0);
      state = result.state;
    }
  });

  it("consumes exactly one dialogue roll per pick, with or without a previous line", () => {
    // First pick (no previous): one roll.
    const state = makeState();
    const afterFirst = pickDialogueLine(state, "pip-1", "miserable");
    const oneRoll = createRngFromState(state.seed, state.rngState);
    oneRoll.stream(DIALOGUE_STREAM).next();
    expect(afterFirst.state.rngState[DIALOGUE_STREAM]).toBe(
      oneRoll.getState()[DIALOGUE_STREAM],
    );
    // Second pick (avoiding previous): also exactly one roll.
    const afterSecond = pickDialogueLine(afterFirst.state, "pip-1", "miserable");
    oneRoll.stream(DIALOGUE_STREAM).next();
    expect(afterSecond.state.rngState[DIALOGUE_STREAM]).toBe(
      oneRoll.getState()[DIALOGUE_STREAM],
    );
  });

  it("unknown pip: returns null and the input state untouched (zero rolls)", () => {
    const state = makeState();
    const result = pickDialogueLine(state, "nobody", "beaming");
    expect(result.line).toBeNull();
    expect(result.state).toBe(state);
  });

  it("missing/empty pool: returns null and the input state untouched (zero rolls)", () => {
    const state = makeState();
    const empty: DialoguePoolsView = { curious: { beaming: [] } };
    expect(pickDialogueLine(state, "pip-1", "beaming", empty).line).toBeNull();
    expect(pickDialogueLine(state, "pip-1", "beaming", empty).state).toBe(state);
    const missing: DialoguePoolsView = {};
    expect(pickDialogueLine(state, "pip-1", "grumpy", missing).line).toBeNull();
  });
});

describe("pickLineFromPools — avoid-previous mapping", () => {
  it("covers every index except the previous one, uniformly reachable", () => {
    const pools: DialoguePoolsView = {
      p: { refusal: ["a", "b", "c", "d"] },
    };
    const seen = new Set<number>();
    for (let seed = 1; seed <= 200; seed++) {
      const line = pickLineFromPools(
        "p",
        "refusal",
        2,
        createRng(seed).stream(DIALOGUE_STREAM),
        pools,
      );
      expect(line?.index).not.toBe(2);
      if (line !== null) seen.add(line.index);
    }
    expect([...seen].sort()).toEqual([0, 1, 3]);
  });

  it("an out-of-range previous index is ignored (full pool reachable)", () => {
    const pools: DialoguePoolsView = { p: { grumpy: ["a", "b"] } };
    const seen = new Set<number>();
    for (let seed = 1; seed <= 100; seed++) {
      const line = pickLineFromPools(
        "p",
        "grumpy",
        99,
        createRng(seed).stream(DIALOGUE_STREAM),
        pools,
      );
      if (line !== null) seen.add(line.index);
    }
    expect([...seen].sort()).toEqual([0, 1]);
  });
});
