/**
 * Life stage & evolution tests (spec §4.6, Phase 1 gate):
 * Pipling → Adult at exactly hatchedAt + 24h (inclusive boundary),
 * readyToEvolve boundaries (avg 69.99 no / 70 yes; age 71h59m no / 72h yes),
 * flag-only semantics (never auto-evolves), and checkEvolution variant
 * selection via lastGiftItemId against the real species registry.
 */

import { describe, expect, it } from "vitest";
import { FakeClock } from "../clock";
import { HOUR_MS, MINUTE_MS, tuning } from "../../content/tuning";
import { species } from "../../content/species";
import { LifeStage, PipActivity } from "./types";
import type { PipNeeds, PipState } from "./types";
import { applyNeedsDelta, type NeedsTuning } from "./needs";
import {
  adultAt,
  checkEvolution,
  lifetimeAvgHappiness,
  updateEvolutionReadiness,
  updateLifeStage,
  type SpeciesEvolutionRegistry,
} from "./lifecycle";

const PIPLING_MS = tuning.pipling.durationMs; // 24h
const EVO_MIN_AGE_MS = tuning.evolution.minAgeMs; // 72h
const EVO_MIN_AVG = tuning.evolution.minLifetimeAvgHappiness; // 70

const fullNeeds = (): PipNeeds => ({
  hunger: 100,
  cleanliness: 100,
  happiness: 100,
  energy: 100,
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
    lifeStage: LifeStage.Pipling,
    hatchedAt: 0,
    ageMs: 0,
    happinessIntegral: 0,
    needs: fullNeeds(),
    activity: PipActivity.Idle,
    pendingSulk: false,
    readyToEvolve: false,
    lastGiftItemId: null,
    expedition: null,
    needsUpdatedAt: 0,
    ...overrides,
  };
}

describe("updateLifeStage — Pipling → Adult at exactly hatchedAt + 24h", () => {
  it("stays a Pipling 1ms before the boundary", () => {
    const clock = new FakeClock(5_000_000_000);
    const pip = makePip({ hatchedAt: clock.now(), needsUpdatedAt: clock.now() });
    clock.advance(PIPLING_MS - 1);
    expect(updateLifeStage(pip, clock.now()).lifeStage).toBe(LifeStage.Pipling);
  });

  it("becomes an Adult at EXACTLY hatchedAt + 24h (inclusive)", () => {
    const clock = new FakeClock(5_000_000_000);
    const pip = makePip({ hatchedAt: clock.now(), needsUpdatedAt: clock.now() });
    clock.advance(PIPLING_MS);
    const after = updateLifeStage(pip, clock.now());
    expect(after.lifeStage).toBe(LifeStage.Adult);
    // Only the life stage changes — nothing else.
    expect({ ...after, lifeStage: pip.lifeStage }).toEqual(pip);
  });

  it("adultAt exposes the computable boundary for catch-up segmentation", () => {
    const pip = makePip({ hatchedAt: 42_000_000 });
    expect(adultAt(pip)).toBe(42_000_000 + PIPLING_MS);
  });

  it("Adults never regress, and re-running is a no-op", () => {
    const adult = makePip({ lifeStage: LifeStage.Adult, hatchedAt: 0 });
    expect(updateLifeStage(adult, 1)).toEqual(adult); // long before 24h — stays Adult
    const promoted = updateLifeStage(makePip(), PIPLING_MS);
    expect(updateLifeStage(promoted, PIPLING_MS)).toEqual(promoted);
  });

  it("is pure — the input pip is never mutated", () => {
    const pip = makePip();
    const snapshot = structuredClone(pip);
    updateLifeStage(pip, PIPLING_MS * 2);
    expect(pip).toEqual(snapshot);
  });

  it("duration comes from tuning (injectable)", () => {
    const pip = makePip({ hatchedAt: 0 });
    const shortStage = { pipling: { durationMs: HOUR_MS } };
    expect(updateLifeStage(pip, HOUR_MS, shortStage).lifeStage).toBe(LifeStage.Adult);
    expect(updateLifeStage(pip, HOUR_MS - 1, shortStage).lifeStage).toBe(
      LifeStage.Pipling,
    );
  });
});

describe("updateEvolutionReadiness — spec §4.6 boundaries", () => {
  // The real registry's mosspip thresholds are sourced from tuning
  // (72h / avg 70); assert that wiring once so the boundary tests below
  // are anchored to the same numbers the game will use.
  it("species registry thresholds come from tuning", () => {
    expect(species.mosspip!.evolution!.minAgeMs).toBe(EVO_MIN_AGE_MS);
    expect(species.mosspip!.evolution!.minLifetimeAvgHappiness).toBe(EVO_MIN_AVG);
  });

  const at = (ageMs: number, avg: number): PipState =>
    makePip({
      lifeStage: LifeStage.Adult,
      ageMs,
      happinessIntegral: avg * ageMs,
    });

  it("avg exactly 70 at age exactly 72h → ready (both boundaries inclusive)", () => {
    const pip = at(EVO_MIN_AGE_MS, EVO_MIN_AVG);
    expect(updateEvolutionReadiness(pip, species).readyToEvolve).toBe(true);
  });

  it("avg 69.99 at age 72h → NOT ready", () => {
    const pip = at(EVO_MIN_AGE_MS, 69.99);
    expect(updateEvolutionReadiness(pip, species).readyToEvolve).toBe(false);
  });

  it("age 71h59m with avg 100 → NOT ready", () => {
    const pip = at(EVO_MIN_AGE_MS - MINUTE_MS, 100);
    expect(updateEvolutionReadiness(pip, species).readyToEvolve).toBe(false);
  });

  it("well past both thresholds → ready", () => {
    const pip = at(EVO_MIN_AGE_MS * 2, 90);
    expect(updateEvolutionReadiness(pip, species).readyToEvolve).toBe(true);
  });

  it("sets the FLAG only — never auto-evolves the species", () => {
    const pip = at(EVO_MIN_AGE_MS, 100);
    const after = updateEvolutionReadiness(pip, species);
    expect(after.readyToEvolve).toBe(true);
    expect(after.speciesId).toBe("mosspip"); // still waiting for the player's tap
    expect({ ...after, readyToEvolve: false }).toEqual(pip);
  });

  it("the flag is sticky — a later unhappy stretch does not revoke it", () => {
    const glowing = makePip({ readyToEvolve: true, ageMs: EVO_MIN_AGE_MS * 2 });
    // Lifetime average is now 0, far below the threshold.
    expect(updateEvolutionReadiness(glowing, species).readyToEvolve).toBe(true);
  });

  it("species without an evolution never becomes ready", () => {
    const pip = at(EVO_MIN_AGE_MS * 10, 100);
    const grovepip = { ...pip, speciesId: "grovepip" };
    expect(updateEvolutionReadiness(grovepip, species).readyToEvolve).toBe(false);
  });

  it("unknown species id is a no-op, not a crash", () => {
    const pip = { ...at(EVO_MIN_AGE_MS, 100), speciesId: "??" };
    expect(updateEvolutionReadiness(pip, species)).toEqual(pip);
  });

  it("a newborn (ageMs = 0) is not ready and produces no NaN", () => {
    const pip = makePip();
    expect(lifetimeAvgHappiness(pip)).toBe(0);
    expect(updateEvolutionReadiness(pip, species).readyToEvolve).toBe(false);
  });

  it("FakeClock end-to-end: 72h lived at exactly happiness 70 → ready", () => {
    // Hold happiness flat at 70 (rate 0) so the lifetime average is exactly
    // the boundary value after any amount of time.
    const flatHappiness: NeedsTuning = {
      needDecayPerHour: { ...tuning.needDecayPerHour, happiness: 0 },
      personalityDecayMultipliers: {
        curious: { hunger: 1, cleanliness: 1, happiness: 1, energy: 1 },
      },
      quirks: tuning.quirks,
      pipling: tuning.pipling,
      care: tuning.care,
    };
    const clock = new FakeClock(8_000_000_000);
    const hatchling = makePip({
      lifeStage: LifeStage.Adult,
      hatchedAt: clock.now(),
      needsUpdatedAt: clock.now(),
      needs: { ...fullNeeds(), happiness: EVO_MIN_AVG },
    });

    // 1 hour short of 72h: avg is already exactly 70, but the age gate
    // is not met yet. (Whole-hour segments keep every float exact; the
    // 71h59m boundary itself is asserted arithmetically above.)
    clock.advance(EVO_MIN_AGE_MS - HOUR_MS);
    const almost = applyNeedsDelta(
      hatchling,
      (clock.now() - hatchling.needsUpdatedAt) / HOUR_MS,
      flatHappiness,
    );
    expect(lifetimeAvgHappiness(almost)).toBe(EVO_MIN_AVG);
    expect(updateEvolutionReadiness(almost, species).readyToEvolve).toBe(false);

    // Advance the remaining hour: exactly 72h lived at exactly avg 70.
    clock.advance(HOUR_MS);
    const arrived = applyNeedsDelta(
      almost,
      (clock.now() - almost.needsUpdatedAt) / HOUR_MS,
      flatHappiness,
    );
    expect(lifetimeAvgHappiness(arrived)).toBe(EVO_MIN_AVG);
    expect(updateEvolutionReadiness(arrived, species).readyToEvolve).toBe(true);
  });
});

describe("checkEvolution — variant via lastGiftItemId (spec §4.6)", () => {
  it("returns the variant the most recent gift maps to", () => {
    const pip = makePip({ lastGiftItemId: "berry" });
    expect(checkEvolution(pip, species)).toEqual({
      targetSpeciesId: "grovepip",
      variantId: "berrybright",
    });
    expect(checkEvolution(makePip({ lastGiftItemId: "stew" }), species)).toEqual({
      targetSpeciesId: "grovepip",
      variantId: "heartymoss",
    });
  });

  it("returns the default variant when no gift was ever given (null)", () => {
    const pip = makePip({ lastGiftItemId: null });
    expect(checkEvolution(pip, species)).toEqual({
      targetSpeciesId: "grovepip",
      variantId: "verdant",
    });
  });

  it("an unmapped gift id falls back to the default variant", () => {
    const pip = makePip({ lastGiftItemId: "mystery-rock" });
    expect(checkEvolution(pip, species)?.variantId).toBe("verdant");
  });

  it("returns null for a species that does not evolve", () => {
    const pip = makePip({ speciesId: "grovepip" });
    expect(checkEvolution(pip, species)).toBeNull();
  });

  it("returns null for an unknown species id", () => {
    expect(checkEvolution(makePip({ speciesId: "??" }), species)).toBeNull();
  });

  it("answers without checking readiness — it changes nothing", () => {
    const pip = makePip({ readyToEvolve: false, lastGiftItemId: "berry" });
    const snapshot = structuredClone(pip);
    expect(checkEvolution(pip, species)).not.toBeNull();
    expect(pip).toEqual(snapshot);
  });

  it("accepts a minimal structural registry (core never imports content types)", () => {
    const registry: SpeciesEvolutionRegistry = {
      testpip: {
        evolution: {
          targetSpeciesId: "grandtestpip",
          minAgeMs: EVO_MIN_AGE_MS,
          minLifetimeAvgHappiness: EVO_MIN_AVG,
          giftVariants: { pebble: "stony" },
          defaultVariantId: "plain",
        },
      },
    };
    const pip = makePip({ speciesId: "testpip", lastGiftItemId: "pebble" });
    expect(checkEvolution(pip, registry)).toEqual({
      targetSpeciesId: "grandtestpip",
      variantId: "stony",
    });
  });
});
