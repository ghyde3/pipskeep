/**
 * Food registry tests (content bible §4). `core/pips/balance.test.ts`
 * guards the two shipped, load-bearing foods (Berry, Stew) behaviourally
 * through the real reducer; this file is the CONTENT-side guard for the
 * other eight — the sizing rule stated once, applied to every food, so a
 * future "nerf this food a bit" edit fails here first instead of quietly
 * reopening the round 2A/2B "day 2 is worse than day 1" bug.
 */

import { describe, expect, it } from "vitest";
import { FOOD_IDS, foods, type FoodId } from "./foods";
import { tuning } from "./tuning";

/** The worst-case Hunger drop over one full capped (16h) absence: base
 * decay × the largest personality multiplier that need can draw ×
 * capHours (content bible §4.1). Restated here, not imported, so this
 * file fails independently if the arithmetic in tuning.ts's comment ever
 * drifts from the numbers it actually reads. */
const WORST_HUNGER_DROP =
  -tuning.needDecayPerHour.hunger *
  Math.max(
    ...Object.values(tuning.personalityDecayMultipliers).map((row) => row.hunger),
  ) *
  (tuning.offlineRateCapMs / (60 * 60 * 1000));

/**
 * ROUND 2H — the Poultice is a registered "food" (it shares the Give Item
 * lookup) but is NOT a meal: `hungerRestore` is deliberately 0, so it must
 * sit outside the "servings to cover a day away" sizing loop below. This
 * is the meal-shaped subset that loop actually applies to. The type
 * predicate (not a bare `.filter`) is what narrows `(typeof
 * MEAL_FOOD_IDS)[number]` down to exactly the ten meal ids for
 * `servingsById` below — a bare filter callback would leave the inferred
 * element type at the full `FoodId` union, "poultice" included.
 */
const MEAL_FOOD_IDS = FOOD_IDS.filter(
  (id): id is Exclude<FoodId, "poultice"> => foods[id].hungerRestore > 0,
);

describe("food registry shape (content bible §4, +poultice round 2H)", () => {
  it("ships exactly the ten meal ids the bible specifies, plus the round 2H cure item", () => {
    expect([...FOOD_IDS].sort()).toEqual(
      [
        "berry",
        "stew",
        "honeydrop",
        "toastnut",
        "frostberry",
        "cocoabun",
        "glowcap",
        "tideroll",
        "emberloaf",
        "feastpot",
        "poultice",
      ].sort(),
    );
    expect([...MEAL_FOOD_IDS].sort()).toEqual(
      [
        "berry",
        "stew",
        "honeydrop",
        "toastnut",
        "frostberry",
        "cocoabun",
        "glowcap",
        "tideroll",
        "emberloaf",
        "feastpot",
      ].sort(),
    );
  });

  it("every food id in the registry has a tuning.foods entry, and vice versa (the §4.3 authoring trap)", () => {
    expect(Object.keys(foods).sort()).toEqual(Object.keys(tuning.foods).sort());
  });

  it("every food's restore numbers are read from tuning.foods, not hand-copied", () => {
    for (const id of FOOD_IDS) {
      const def = foods[id];
      const tuned: { hunger: number; happiness?: number; energy?: number } =
        tuning.foods[id];
      expect(def.hungerRestore, id).toBe(tuned.hunger);
      expect(def.sideEffects?.happiness, id).toBe(tuned.happiness);
      expect(def.sideEffects?.energy, id).toBe(tuned.energy);
    }
  });

  it("nothing has a negative restore (Feed and Give Item only ever add)", () => {
    for (const id of FOOD_IDS) {
      const def = foods[id];
      expect(def.hungerRestore, id).toBeGreaterThanOrEqual(0);
      for (const amount of Object.values(def.sideEffects ?? {})) {
        expect(amount, id).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("every food carries real, non-empty flavor text", () => {
    for (const id of FOOD_IDS) {
      expect(foods[id].flavor.trim().length, id).toBeGreaterThan(10);
    }
  });

  it("the Poultice is the one deliberate non-meal: zero restore, no side effects (round 2H)", () => {
    expect(foods.poultice.hungerRestore).toBe(0);
    expect(foods.poultice.sideEffects).toBeUndefined();
  });
});

describe("the restore-sizing rule: every food's 'cover a day away' arithmetic", () => {
  it("the worst-case Hunger drop is 69.92 (3.8 × 1.15 × 16h) — the number every row answers", () => {
    expect(WORST_HUNGER_DROP).toBeCloseTo(69.92, 2);
  });

  it("Berry ×2 and Stew ×1 out-restore the worst-case drop (the two load-bearing rows)", () => {
    expect(2 * foods.berry.hungerRestore).toBeGreaterThan(WORST_HUNGER_DROP);
    expect(foods.stew.hungerRestore).toBeGreaterThan(WORST_HUNGER_DROP);
  });

  /** Servings the bible commits to per food, and the resulting total.
   * MEAL_FOOD_IDS only — the Poultice restores no Hunger and is not part
   * of this arithmetic (see the dedicated test below). */
  const servingsById: Readonly<Record<(typeof MEAL_FOOD_IDS)[number], number>> = {
    berry: 2,
    stew: 1,
    honeydrop: 7,
    toastnut: 2,
    frostberry: 2,
    cocoabun: 2,
    glowcap: 2,
    tideroll: 2,
    emberloaf: 1,
    feastpot: 1,
  };

  for (const id of MEAL_FOOD_IDS) {
    it(`${id}: ${servingsById[id]} serving(s) clears one full capped absence`, () => {
      expect(servingsById[id] * foods[id].hungerRestore).toBeGreaterThan(
        WORST_HUNGER_DROP,
      );
    });
  }

  it("Honeydrop (7 servings) and Glowcap (2 servings) clear the day by design, but only just (the intentionally thin margins)", () => {
    // Content bible §4.2: both land at 70.0 against 69.92 — 0.08 of a
    // point of headroom, on purpose, so a future decay-rate nudge trips
    // one of these two tests before it silently reopens the day-2 bug.
    expect(7 * foods.honeydrop.hungerRestore).toBeCloseTo(70, 5);
    expect(2 * foods.glowcap.hungerRestore).toBeCloseTo(70, 5);
    expect(7 * foods.honeydrop.hungerRestore).toBeGreaterThan(WORST_HUNGER_DROP);
    expect(2 * foods.glowcap.hungerRestore).toBeGreaterThan(WORST_HUNGER_DROP);
  });

  it("Honeydrop is a terrible meal and a wonderful moment: worst Hunger-per-serving, best Happiness-per-serving among cheap treats", () => {
    // The treat's whole design (content bible §4.2): +32 Happiness with NO
    // cooldown, on a food nobody would ever use as a meal (7 servings to
    // cover a day, vs 1-2 for everything else).
    expect(foods.honeydrop.hungerRestore).toBeLessThan(foods.berry.hungerRestore);
    expect(foods.honeydrop.sideEffects?.happiness).toBeGreaterThan(
      tuning.care.pet.happiness,
    );
  });

  it("Feastpot is the only food that moves all three restorable needs at once (the feast)", () => {
    expect(foods.feastpot.hungerRestore).toBe(100);
    expect(foods.feastpot.sideEffects?.happiness).toBeGreaterThan(0);
    expect(foods.feastpot.sideEffects?.energy).toBeGreaterThan(0);
    // And it is the single biggest Hunger restore in the game.
    for (const id of FOOD_IDS) {
      if (id === "feastpot") continue;
      expect(foods.feastpot.hungerRestore).toBeGreaterThanOrEqual(
        foods[id].hungerRestore,
      );
    }
  });
});
