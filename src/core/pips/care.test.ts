/**
 * Care action tests (spec §5 v1.1, Phase 2 gate): exact stat effect per
 * action, cooldown blocks within the window and unblocks at EXACTLY the
 * boundary (FakeClock timestamps), the full refusal matrix (universal
 * 10-Energy floor at 9.99/10, Lazy 30 floor at 29.99/30, Lazy 15% whim
 * made deterministic via seeded "quirks" streams), inventory decrement +
 * refuse-when-empty, Clingy Pet +14, refusals cost nothing, and purity
 * (the input state is never mutated — structural sharing allowed).
 */

import { describe, expect, it } from "vitest";
import { FakeClock } from "../clock";
import { SECOND_MS, tuning } from "../../content/tuning";
import { createRng } from "../rng";
import { LifeStage, PipActivity } from "./types";
import type { PipNeeds, PipState } from "./types";
import { QUIRKS_STREAM, performCare } from "./care";
import type { CareRequest, CareStateSlice } from "./care";

const needs = (overrides: Partial<PipNeeds> = {}): PipNeeds => ({
  hunger: 50,
  cleanliness: 50,
  happiness: 50,
  energy: 50,
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
      accessorySlots: 1,
      personalityId: "curious",
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
    lastGiftItemId: null,
    expedition: null,
    needsUpdatedAt: 0,
    ...overrides,
  };
}

function makeState(
  overrides: Partial<CareStateSlice> & { pip?: PipState } = {},
): CareStateSlice {
  const pip = overrides.pip ?? makePip();
  return {
    seed: 42,
    rngState: {},
    pips: { [pip.id]: pip },
    lastLineIndex: {},
    inventory: { berry: 3, stew: 1 },
    cooldowns: {},
    ...overrides,
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

const pip = (state: CareStateSlice): PipState => {
  const p = state.pips["pip-1"];
  if (p === undefined) throw new Error("pip-1 missing");
  return p;
};

/** Find a seed whose FIRST quirks roll satisfies `test` (deterministic
 * scan — the whim check is the first roll a fresh save's Play consumes). */
function findQuirksSeed(test: (roll: number) => boolean): number {
  for (let seed = 1; seed < 10_000; seed++) {
    if (test(createRng(seed).stream(QUIRKS_STREAM).next())) return seed;
  }
  throw new Error("no seed found in scan range");
}

const WHIM = tuning.playRefusal.lazyFlavorRefusalChance;

describe("Feed — spec §5", () => {
  it("Berry: +25 Hunger, consumes one berry, other needs untouched", () => {
    const state = makeState();
    const { state: next, outcome } = performCare(state, {
      action: "feed",
      pipId: "pip-1",
      foodId: "berry",
      at: 1_000,
    });
    expect(outcome.applied).toBe(true);
    expect(pip(next).needs.hunger).toBe(50 + tuning.foods.berry.hunger); // 75
    expect(pip(next).needs.happiness).toBe(50);
    expect(pip(next).needs.energy).toBe(50);
    expect(next.inventory["berry"]).toBe(2);
    expect(next.inventory["stew"]).toBe(1);
  });

  it("Stew: +50 Hunger AND +5 Happiness (content side effect)", () => {
    const state = makeState();
    const { state: next } = performCare(state, {
      action: "feed",
      pipId: "pip-1",
      foodId: "stew",
      at: 1_000,
    });
    expect(pip(next).needs.hunger).toBe(100); // 50 + 50
    expect(pip(next).needs.happiness).toBe(50 + tuning.foods.stew.happiness); // 55
    expect(next.inventory["stew"]).toBe(0);
  });

  it("clamps Hunger at 100", () => {
    const state = makeState({ pip: makePip({ needs: needs({ hunger: 90 }) }) });
    const { state: next } = performCare(state, {
      action: "feed",
      pipId: "pip-1",
      foodId: "berry",
      at: 1_000,
    });
    expect(pip(next).needs.hunger).toBe(100);
    expect(next.inventory["berry"]).toBe(2); // still consumed — player's call
  });

  it("refuses when the item is out of stock: nothing changes at all", () => {
    const state = makeState({ inventory: { berry: 0 } });
    const { state: next, outcome } = performCare(state, {
      action: "feed",
      pipId: "pip-1",
      foodId: "berry",
      at: 1_000,
    });
    expect(outcome.applied).toBe(false);
    expect(outcome.refusalReason).toBe("outOfStock");
    expect(next).toBe(state); // by reference: zero cost, zero rolls
  });

  it("refuses an unknown food id", () => {
    const state = makeState();
    const { state: next, outcome } = performCare(state, {
      action: "feed",
      pipId: "pip-1",
      foodId: "gravel",
      at: 1_000,
    });
    expect(outcome.applied).toBe(false);
    expect(outcome.refusalReason).toBe("unknownItem");
    expect(next).toBe(state);
  });
});

describe("Clean — spec §5 (deliberately trivial, 60s cooldown)", () => {
  it("sets Cleanliness to exactly 100 from any value", () => {
    const state = makeState({
      pip: makePip({ needs: needs({ cleanliness: 3 }) }),
    });
    const { state: next, outcome } = performCare(state, {
      action: "clean",
      pipId: "pip-1",
      at: 1_000,
    });
    expect(outcome.applied).toBe(true);
    expect(pip(next).needs.cleanliness).toBe(100);
  });

  it("blocks within the 60s cooldown and unblocks at EXACTLY the boundary", () => {
    const clock = new FakeClock(10_000);
    let state = makeState({ pip: makePip({ needs: needs({ cleanliness: 1 }) }) });
    const clean = (at: number) =>
      performCare(state, { action: "clean", pipId: "pip-1", at });

    const first = clean(clock.now());
    expect(first.outcome.applied).toBe(true);
    state = first.state;
    expect(state.cooldowns["pip-1"]?.clean).toBe(10_000);

    clock.advance(60 * SECOND_MS - 1); // 59.999s later: still blocked
    const blocked = clean(clock.now());
    expect(blocked.outcome.applied).toBe(false);
    expect(blocked.outcome.refusalReason).toBe("cooldown");
    expect(blocked.state).toBe(state); // cooldown block costs nothing

    clock.advance(1); // exactly lastUsed + 60s: unblocked
    const boundary = clean(clock.now());
    expect(boundary.outcome.applied).toBe(true);
    expect(boundary.state.cooldowns["pip-1"]?.clean).toBe(
      10_000 + 60 * SECOND_MS,
    );
  });
});

describe("Play — spec §5 effects and refusal matrix (v1.1)", () => {
  it("+20 Happiness, −10 Energy", () => {
    const state = makeState();
    const { state: next, outcome } = performCare(state, {
      action: "play",
      pipId: "pip-1",
      at: 1_000,
    });
    expect(outcome.applied).toBe(true);
    expect(pip(next).needs.happiness).toBe(70);
    expect(pip(next).needs.energy).toBe(40);
  });

  it("any Pip refuses below 10 Energy: 9.99 refuses, 10 plays", () => {
    const refusing = makeState({ pip: makePip({ needs: needs({ energy: 9.99 }) }) });
    const refused = performCare(refusing, { action: "play", pipId: "pip-1", at: 0 });
    expect(refused.outcome.applied).toBe(false);
    expect(refused.outcome.refusalReason).toBe("tooTired");
    expect(refused.outcome.dialogueContext).toBe("refusal");
    expect(pip(refused.state).needs).toEqual(needs({ energy: 9.99 })); // no cost

    const playing = makeState({ pip: makePip({ needs: needs({ energy: 10 }) }) });
    const played = performCare(playing, { action: "play", pipId: "pip-1", at: 0 });
    expect(played.outcome.applied).toBe(true);
    expect(pip(played.state).needs.energy).toBe(0); // 10 − 10
  });

  it("playing down to exactly 0 Energy enters Sulking (spec §4.4 floor)", () => {
    const state = makeState({ pip: makePip({ needs: needs({ energy: 10 }) }) });
    const { state: next, outcome } = performCare(state, {
      action: "play",
      pipId: "pip-1",
      at: 0,
    });
    expect(outcome.applied).toBe(true);
    expect(pip(next).activity).toBe(PipActivity.Sulking);
    expect(outcome.dialogueContext).toBe("sulking");
  });

  it("Lazy additionally refuses below 30 Energy: 29.99 refuses, 30 reaches the whim roll", () => {
    const lazyAt = (energy: number, seed: number) =>
      makeState({
        seed,
        pip: makePip({ personalityId: "lazy", needs: needs({ energy }) }),
      });

    const seedNoWhim = findQuirksSeed((r) => r >= WHIM);
    const refused = performCare(lazyAt(29.99, seedNoWhim), {
      action: "play",
      pipId: "pip-1",
      at: 0,
    });
    expect(refused.outcome.applied).toBe(false);
    expect(refused.outcome.refusalReason).toBe("lazyTooTired");
    // Threshold refusals consume NO quirks roll.
    expect(refused.state.rngState[QUIRKS_STREAM]).toBeUndefined();

    const played = performCare(lazyAt(30, seedNoWhim), {
      action: "play",
      pipId: "pip-1",
      at: 0,
    });
    expect(played.outcome.applied).toBe(true);
    expect(pip(played.state).needs.energy).toBe(20);
    // The whim check consumed exactly one quirks roll.
    const oneRoll = createRng(seedNoWhim).stream(QUIRKS_STREAM);
    oneRoll.next();
    expect(played.state.rngState[QUIRKS_STREAM]).toBe(oneRoll.getState());
  });

  it("Lazy 15% whim refusal is deterministic from the seeded quirks stream", () => {
    const seedWhim = findQuirksSeed((r) => r < WHIM);
    const state = makeState({
      seed: seedWhim,
      pip: makePip({ personalityId: "lazy", needs: needs({ energy: 80 }) }),
    });
    const first = performCare(state, { action: "play", pipId: "pip-1", at: 0 });
    expect(first.outcome.applied).toBe(false);
    expect(first.outcome.refusalReason).toBe("lazyWhim");
    expect(first.outcome.dialogueContext).toBe("refusal");
    expect(first.outcome.lineId).toBeDefined(); // funny, not silent
    expect(pip(first.state).needs).toEqual(needs({ energy: 80 })); // free

    // Identical state → identical refusal (reload never re-rolls, §2 r3).
    const again = performCare(state, { action: "play", pipId: "pip-1", at: 0 });
    expect(again.outcome).toEqual(first.outcome);
    expect(again.state).toEqual(first.state);
  });

  it("non-Lazy Pips never consume a quirks roll", () => {
    const state = makeState();
    const { state: next } = performCare(state, {
      action: "play",
      pipId: "pip-1",
      at: 0,
    });
    expect(next.rngState[QUIRKS_STREAM]).toBeUndefined();
  });

  it("a refusal triggers no cooldown and blocks nothing: the very next Play can apply", () => {
    const seedWhim = findQuirksSeed((r) => r < WHIM);
    const state = makeState({
      seed: seedWhim,
      pip: makePip({ personalityId: "lazy", needs: needs({ energy: 80 }) }),
    });
    const refused = performCare(state, { action: "play", pipId: "pip-1", at: 0 });
    expect(refused.outcome.applied).toBe(false);
    expect(refused.state.cooldowns).toEqual({});
    // The whim roll advanced the quirks cursor; whether the NEXT attempt
    // plays depends only on that cursor — assert it matches a manual
    // second roll of the same stream.
    const stream = createRng(seedWhim).stream(QUIRKS_STREAM);
    stream.next();
    const secondRollRefuses = stream.next() < WHIM;
    const second = performCare(refused.state, {
      action: "play",
      pipId: "pip-1",
      at: 1,
    });
    expect(second.outcome.applied).toBe(!secondRollRefuses);
  });
});

describe("Pet — spec §5 (+8, Clingy +14, 30s cooldown)", () => {
  it("+8 Happiness for a non-Clingy Pip", () => {
    const state = makeState();
    const { state: next } = performCare(state, {
      action: "pet",
      pipId: "pip-1",
      at: 0,
    });
    expect(pip(next).needs.happiness).toBe(58);
  });

  it("Clingy gets +14 instead", () => {
    const state = makeState({ pip: makePip({ personalityId: "clingy" }) });
    const { state: next } = performCare(state, {
      action: "pet",
      pipId: "pip-1",
      at: 0,
    });
    expect(pip(next).needs.happiness).toBe(64);
  });

  it("blocks within the 30s cooldown and unblocks at EXACTLY the boundary", () => {
    const clock = new FakeClock(5_000);
    let state = makeState();
    const pet = (at: number) =>
      performCare(state, { action: "pet", pipId: "pip-1", at });

    state = pet(clock.now()).state;
    clock.advance(30 * SECOND_MS - 1);
    const blocked = pet(clock.now());
    expect(blocked.outcome.applied).toBe(false);
    expect(blocked.outcome.refusalReason).toBe("cooldown");
    expect(blocked.state).toBe(state);

    clock.advance(1);
    const boundary = pet(clock.now());
    expect(boundary.outcome.applied).toBe(true);
    expect(pip(boundary.state).needs.happiness).toBe(66); // 50 + 8 + 8
  });

  it("cooldowns are per Pip: petting one Pip does not block another", () => {
    const a = makePip({ id: "pip-a" });
    const b = makePip({ id: "pip-b" });
    let state: CareStateSlice = {
      ...makeState(),
      pips: { "pip-a": a, "pip-b": b },
    };
    state = performCare(state, { action: "pet", pipId: "pip-a", at: 0 }).state;
    const other = performCare(state, { action: "pet", pipId: "pip-b", at: 1 });
    expect(other.outcome.applied).toBe(true);
  });
});

describe("Rest toggle — spec §5 (via the state machine)", () => {
  it("Idle → Resting, and Resting → Idle", () => {
    const state = makeState();
    const on = performCare(state, { action: "restToggle", pipId: "pip-1", at: 0 });
    expect(on.outcome.applied).toBe(true);
    expect(pip(on.state).activity).toBe(PipActivity.Resting);
    const off = performCare(on.state, {
      action: "restToggle",
      pipId: "pip-1",
      at: 1,
    });
    expect(off.outcome.applied).toBe(true);
    expect(pip(off.state).activity).toBe(PipActivity.Idle);
  });

  it("a full-energy Pip still visibly lies down (no same-action auto-wake)", () => {
    const state = makeState({ pip: makePip({ needs: needs({ energy: 100 }) }) });
    const on = performCare(state, { action: "restToggle", pipId: "pip-1", at: 0 });
    expect(on.outcome.applied).toBe(true);
    expect(pip(on.state).activity).toBe(PipActivity.Resting);
  });

  it("a Sulking Pip declines the Rest toggle with a Refusal line", () => {
    const state = makeState({
      pip: makePip({ activity: PipActivity.Sulking, needs: needs({ hunger: 0 }) }),
    });
    const { state: next, outcome } = performCare(state, {
      action: "restToggle",
      pipId: "pip-1",
      at: 0,
    });
    expect(outcome.applied).toBe(false);
    expect(outcome.refusalReason).toBe("machine");
    expect(outcome.dialogueContext).toBe("refusal");
    expect(outcome.lineId).toBeDefined();
    expect(pip(next).activity).toBe(PipActivity.Sulking); // unchanged
  });
});

describe("Give Item — spec §5 / §4.6 (gift record + content effects)", () => {
  it("sets lastGiftItemId, consumes the item, applies the food's side effects only", () => {
    const state = makeState();
    const { state: next, outcome } = performCare(state, {
      action: "giveItem",
      pipId: "pip-1",
      itemId: "stew",
      at: 0,
    });
    expect(outcome.applied).toBe(true);
    expect(pip(next).lastGiftItemId).toBe("stew");
    expect(next.inventory["stew"]).toBe(0);
    expect(pip(next).needs.happiness).toBe(55); // side effect, +5
    expect(pip(next).needs.hunger).toBe(50); // hunger restore is Feed-only
  });

  it("an item without content effects just sets the gift record", () => {
    const state = makeState({ inventory: { wood: 2 } });
    const { state: next, outcome } = performCare(state, {
      action: "giveItem",
      pipId: "pip-1",
      itemId: "wood",
      at: 0,
    });
    expect(outcome.applied).toBe(true);
    expect(pip(next).lastGiftItemId).toBe("wood");
    expect(next.inventory["wood"]).toBe(1);
    expect(pip(next).needs).toEqual(needs());
  });

  it("refuses when out of stock", () => {
    const state = makeState({ inventory: {} });
    const { state: next, outcome } = performCare(state, {
      action: "giveItem",
      pipId: "pip-1",
      itemId: "berry",
      at: 0,
    });
    expect(outcome.applied).toBe(false);
    expect(outcome.refusalReason).toBe("outOfStock");
    expect(next).toBe(state);
  });
});

describe("care legality and outcomes — spec §4.7 / §4.4", () => {
  it("a Pip away on expedition cannot receive care", () => {
    const away = makePip({
      activity: PipActivity.OnExpedition,
      expedition: { expeditionId: "meadow", departedAt: 0, durationMs: 1 },
    });
    const state = makeState({ pip: away });
    for (const request of [
      { action: "feed", pipId: "pip-1", foodId: "berry", at: 0 },
      { action: "clean", pipId: "pip-1", at: 0 },
      { action: "play", pipId: "pip-1", at: 0 },
      { action: "pet", pipId: "pip-1", at: 0 },
      { action: "restToggle", pipId: "pip-1", at: 0 },
      { action: "giveItem", pipId: "pip-1", itemId: "berry", at: 0 },
    ] satisfies CareRequest[]) {
      const { state: next, outcome } = performCare(state, request);
      expect(outcome.applied).toBe(false);
      expect(outcome.refusalReason).toBe("busy");
      expect(next).toBe(state);
    }
  });

  it("an unknown pip id is a structural block", () => {
    const state = makeState();
    const { state: next, outcome } = performCare(state, {
      action: "pet",
      pipId: "ghost",
      at: 0,
    });
    expect(outcome.applied).toBe(false);
    expect(outcome.refusalReason).toBe("unknownPip");
    expect(next).toBe(state);
  });

  it("Sulking Pips CAN receive care, speak from the Sulking pool, and exit when all needs reach 25", () => {
    const sulker = makePip({
      activity: PipActivity.Sulking,
      needs: { hunger: 24, cleanliness: 30, happiness: 30, energy: 30 },
    });
    const state = makeState({ pip: sulker });

    // Petting helps but hunger is still < 25: still sulking, sulking line.
    const petted = performCare(state, { action: "pet", pipId: "pip-1", at: 0 });
    expect(petted.outcome.applied).toBe(true);
    expect(pip(petted.state).activity).toBe(PipActivity.Sulking);
    expect(petted.outcome.dialogueContext).toBe("sulking");

    // Feeding lifts hunger to 49 — all four ≥ 25 → back to Idle (§4.4).
    const fed = performCare(petted.state, {
      action: "feed",
      pipId: "pip-1",
      foodId: "berry",
      at: 1,
    });
    expect(fed.outcome.applied).toBe(true);
    expect(pip(fed.state).activity).toBe(PipActivity.Idle);
    expect(fed.outcome.dialogueContext).not.toBe("sulking");
  });

  it("every applied action carries a dialogue line from personality × context", () => {
    const state = makeState();
    const { outcome } = performCare(state, {
      action: "pet",
      pipId: "pip-1",
      at: 0,
    });
    expect(outcome.applied).toBe(true);
    expect(outcome.lineId).toMatch(/^curious\//);
    expect(outcome.line).toBeTypeOf("string");
    // All needs 50..58 → mood "content" → context selects the content pool.
    expect(outcome.dialogueContext).toBe("content");
    expect(outcome.lineId).toMatch(/^curious\/content\/\d+$/);
  });

  it("a Chaotic Pip's success line may come from an adjacent displayed mood (cursor advances)", () => {
    const state = makeState({ pip: makePip({ personalityId: "chaotic" }) });
    const { state: next, outcome } = performCare(state, {
      action: "pet",
      pipId: "pip-1",
      at: 0,
    });
    expect(outcome.applied).toBe(true);
    // Actual mood is content (all 50..58); displayed is content or one step off.
    expect(["beaming", "content", "grumpy"]).toContain(outcome.dialogueContext);
    expect(next.rngState["mood-display"]).toBeTypeOf("number");
  });
});

describe("purity — performCare never mutates its input", () => {
  it("applied and refused paths both leave a deep-frozen input untouched", () => {
    const requests: CareRequest[] = [
      { action: "feed", pipId: "pip-1", foodId: "berry", at: 0 },
      { action: "clean", pipId: "pip-1", at: 0 },
      { action: "play", pipId: "pip-1", at: 0 },
      { action: "pet", pipId: "pip-1", at: 0 },
      { action: "restToggle", pipId: "pip-1", at: 0 },
      { action: "giveItem", pipId: "pip-1", itemId: "stew", at: 0 },
      { action: "feed", pipId: "pip-1", foodId: "gravel", at: 0 }, // refusal
      { action: "pet", pipId: "ghost", at: 0 }, // structural block
    ];
    for (const request of requests) {
      const state = deepFreeze(makeState());
      // Frozen objects throw on mutation in strict mode — a mutation
      // anywhere in performCare would explode here.
      expect(() => performCare(state, request)).not.toThrow();
    }
  });
});
