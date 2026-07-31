/**
 * Life stage & evolution tests (spec §4.6, Phase 1 gate):
 * Pipling → Adult at exactly hatchedAt + pipling.durationMs (inclusive
 * boundary; round 2A retuned this 24h → 8h in content/tuning.ts, but the
 * duration itself is read from tuning here, never hardcoded, so this
 * suite pins the MECHANISM's boundary behavior, not the shipped number —
 * a future retune moves nothing in this file),
 * readyToEvolve boundaries (avg 69.99 no / 70 yes; age 71h59m no / 72h yes),
 * flag-only semantics (never auto-evolves), and checkEvolution variant
 * selection via lastGiftItemId against the real species registry.
 */

import { describe, expect, it } from "vitest";
import { FakeClock } from "../clock";
import { HOUR_MS, MINUTE_MS, tuning } from "../../content/tuning";
import { species } from "../../content/species";
import { LifeStage, PipActivity } from "./types";
import type { ActiveExpedition, PipNeeds, PipState } from "./types";
import { applyNeedsDelta, effectiveRates, type NeedsTuning } from "./needs";
import { canReceiveCare, departExpedition, evaluateSulk } from "./machine";
import {
  adultAt,
  applyEvolution,
  checkEvolution,
  lifespanMs,
  lifetimeAvgHappiness,
  pipSeason,
  updateAging,
  updateEvolutionReadiness,
  updateLifeStage,
  type LifespanTuning,
  type SpeciesEvolutionRegistry,
} from "./lifecycle";

const PIPLING_MS = tuning.pipling.durationMs; // round 2A: 8h (was 24h)
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
      shiny: false,
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
    evolved: null,
    lastGiftItemId: null,
    expedition: null,
    needsUpdatedAt: 0,
    ...overrides,
  };
}

describe("updateLifeStage — Pipling → Adult at exactly hatchedAt + pipling.durationMs", () => {
  it("stays a Pipling 1ms before the boundary", () => {
    const clock = new FakeClock(5_000_000_000);
    const pip = makePip({ hatchedAt: clock.now(), needsUpdatedAt: clock.now() });
    clock.advance(PIPLING_MS - 1);
    expect(updateLifeStage(pip, clock.now()).lifeStage).toBe(LifeStage.Pipling);
  });

  it("becomes an Adult at EXACTLY hatchedAt + pipling.durationMs (inclusive)", () => {
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
    expect(updateLifeStage(adult, 1)).toEqual(adult); // long before the boundary — stays Adult
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

describe("applyEvolution — the birth genome (shiny included) survives", () => {
  it("keeps the immutable genome untouched, iridescence and all", () => {
    const pip = makePip({
      lifeStage: LifeStage.Adult,
      readyToEvolve: true,
      genome: {
        speciesId: "mosspip",
        palette: "fern",
        pattern: "plain",
        accessorySlots: 1,
        personalityId: "curious",
        shiny: true,
      },
    });
    const result = applyEvolution(pip, species, 1_000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The live species flips; the birth record (and its shiny flag) is
    // the SAME object — evolution cannot launder the sparkle away.
    expect(result.pip.speciesId).toBe("grovepip");
    expect(result.pip.genome).toBe(pip.genome);
    expect(result.pip.genome.shiny).toBe(true);
  });

  it("ROUND 2H: awards this Pip's own evolve XP (bible §1.1 row 5) — the sole call site", () => {
    const pip = makePip({ lifeStage: LifeStage.Adult, readyToEvolve: true });
    const result = applyEvolution(pip, species, 1_000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pip.pipXp).toBe(tuning.lifecycle.level.xp.evolve);
  });
});

// ---------------------------------------------------------------------------
// LIFESPAN & AGEING (spec §16 v1.5, docs/lifecycle-bible.md §2) — promise 3.
// ---------------------------------------------------------------------------

/** A pip with a controlled lifetime-average happiness (via
 * happinessIntegral/ageMs) and no lifeMs yet — the lifespan tests' base
 * fixture. `ageMs` is large so `lifeStage` reads as a deliberate choice,
 * never accidentally Pipling. */
function pipAt(overrides: Partial<PipState> & { readonly avgHappiness?: number } = {}): PipState {
  const { avgHappiness, ...rest } = overrides;
  const ageMs = rest.ageMs ?? 1000 * HOUR_MS;
  return makePip({
    lifeStage: LifeStage.Adult,
    ageMs,
    happinessIntegral: (avgHappiness ?? 0) * ageMs,
    ...rest,
  });
}

describe("lifespanMs — bible §2.3's formula, pinned against the bible's own worked examples", () => {
  it("Neglectful (avg < 30, level 3, no buildings) ⇒ ~6.4 days", () => {
    const pip = pipAt({ avgHappiness: 10, level: 3 });
    expect(lifespanMs(pip) / HOUR_MS / 24).toBeCloseTo(6.4, 1);
  });

  it("Ordinary (avg 65–79, level 6, one +0.06 longevity building) ⇒ ~10.7 days", () => {
    const pip = pipAt({ avgHappiness: 70, level: 6 });
    expect(lifespanMs(pip, tuning, 0.06) / HOUR_MS / 24).toBeCloseTo(10.7, 1);
  });

  it("Devoted (avg ≥ 80, level 10, all three +0.21 longevity buildings) ⇒ ~15.6 days", () => {
    const pip = pipAt({ avgHappiness: 85, level: 10 });
    expect(lifespanMs(pip, tuning, 0.21) / HOUR_MS / 24).toBeCloseTo(15.6, 1);
  });

  it("building longevity clamps at buildingBonusMax, never rewarding an over-supplied value", () => {
    const pip = pipAt({ avgHappiness: 50, level: 1 });
    const capped = lifespanMs(pip, tuning, tuning.lifecycle.lifespan.buildingBonusMax);
    const overSupplied = lifespanMs(pip, tuning, tuning.lifecycle.lifespan.buildingBonusMax + 5);
    expect(overSupplied).toBe(capped);
  });

  it("a newborn (ageMs = 0, no happiness history) gets the lowest care-quality band, not NaN", () => {
    const pip = pipAt({ avgHappiness: 0, ageMs: 0, level: 1 });
    expect(Number.isFinite(lifespanMs(pip))).toBe(true);
    expect(lifespanMs(pip)).toBeGreaterThan(0);
  });

  it("care quality is worth roughly 59% of a lifetime (bible §2.3): the Devoted:Neglectful ratio", () => {
    const neglectful = lifespanMs(pipAt({ avgHappiness: 10, level: 1 }));
    const devoted = lifespanMs(pipAt({ avgHappiness: 85, level: 1 }));
    const ratio = devoted / neglectful;
    // 1.35 / 0.85 ≈ 1.588
    expect(ratio).toBeCloseTo(1.35 / 0.85, 5);
  });

  it("levels can only ever EXTEND a lifespan, never shorten it", () => {
    const base = lifespanMs(pipAt({ avgHappiness: 50, level: 1 }));
    for (let level = 2; level <= tuning.lifecycle.level.maxLevel; level++) {
      expect(lifespanMs(pipAt({ avgHappiness: 50, level }))).toBeGreaterThan(base);
    }
  });
});

describe("pipSeason — bible §2.4 (derived, never stored, mechanically inert)", () => {
  it("a Pipling always reports its own stage, regardless of lifeMs", () => {
    const pipling = makePip({ lifeStage: LifeStage.Pipling, lifeMs: 999_999_999_999 });
    expect(pipSeason(pipling)).toBe("pipling");
  });

  it("walks young → prime → seasoned → elder as lifeMs crosses each fraction of lifespanMs", () => {
    const pip = pipAt({ avgHappiness: 50, level: 1 });
    const span = lifespanMs(pip);
    const { young, prime, seasoned } = tuning.lifecycle.lifespan.seasons;

    expect(pipSeason({ ...pip, lifeMs: 0 })).toBe("young");
    expect(pipSeason({ ...pip, lifeMs: span * young - 1 })).toBe("young");
    expect(pipSeason({ ...pip, lifeMs: span * young })).toBe("prime");
    expect(pipSeason({ ...pip, lifeMs: span * prime - 1 })).toBe("prime");
    expect(pipSeason({ ...pip, lifeMs: span * prime })).toBe("seasoned");
    expect(pipSeason({ ...pip, lifeMs: span * seasoned - 1 })).toBe("seasoned");
    expect(pipSeason({ ...pip, lifeMs: span * seasoned })).toBe("elder");
    expect(pipSeason({ ...pip, lifeMs: span * 10 })).toBe("elder");
  });

  it("is purely derived — retuning the season bands re-grades an existing Pip with no stored state to migrate", () => {
    const pip = pipAt({ avgHappiness: 50, level: 1, lifeMs: 0 });
    const retuned: LifespanTuning = {
      lifecycle: {
        lifespan: { ...tuning.lifecycle.lifespan, seasons: { young: 0, prime: 0, seasoned: 0 } },
        level: tuning.lifecycle.level,
      },
    };
    // Same Pip, same stored fields — only the tuning changed — and the
    // word on its card changes immediately, with no migration.
    expect(pipSeason(pip, tuning)).toBe("young");
    expect(pipSeason(pip, retuned)).toBe("elder");
  });
});

describe("updateAging — bible §2.5: a FLAG, nothing else (promise 3)", () => {
  it("does not set the flag before lifeMs reaches lifespanMs", () => {
    const pip = pipAt({ avgHappiness: 50, level: 1 });
    const span = lifespanMs(pip);
    expect(updateAging({ ...pip, lifeMs: span - 1 }).readyToRetire).toBeFalsy();
  });

  it("sets the flag at EXACTLY lifeMs === lifespanMs (inclusive)", () => {
    const pip = pipAt({ avgHappiness: 50, level: 1 });
    const span = lifespanMs(pip);
    expect(updateAging({ ...pip, lifeMs: span }).readyToRetire).toBe(true);
  });

  it("is sticky — once set, a later happiness improvement (which would grow lifespanMs back past lifeMs) never revokes it", () => {
    const old = { ...pipAt({ avgHappiness: 10, level: 1 }), lifeMs: 999_999_999_999, readyToRetire: true };
    // Even with a MUCH higher lifespan (via a devoted-care re-evaluation),
    // the flag never un-announces.
    const improved = { ...old, happinessIntegral: 85 * old.ageMs };
    expect(updateAging(improved).readyToRetire).toBe(true);
  });

  it("sets ONLY the flag — nothing else on the Pip changes", () => {
    const pip = pipAt({ avgHappiness: 50, level: 1 });
    const span = lifespanMs(pip);
    const before = { ...pip, lifeMs: span * 2 };
    const aged = updateAging(before);
    const { readyToRetire, ...restOfAged } = aged;
    expect(readyToRetire).toBe(true);
    expect(restOfAged).toEqual(before);
  });

  it("PROMISE 3: reaching lifespanMs changes literally nothing mechanical — effectiveRates, care legality and expedition legality are all deep-equal before and after", () => {
    const young = pipAt({ avgHappiness: 50, level: 1, lifeMs: 0 });
    const span = lifespanMs(young);
    const old = updateAging({ ...young, lifeMs: 10 * span });
    expect(old.readyToRetire).toBe(true);

    expect(effectiveRates(old)).toEqual(effectiveRates(young));
    expect(canReceiveCare(old)).toBe(canReceiveCare(young));

    const trip: ActiveExpedition = { expeditionId: "meadow", departedAt: 0, durationMs: HOUR_MS };
    const oldResult = departExpedition(old, trip);
    const youngResult = departExpedition(young, trip);
    expect(oldResult.ok).toBe(true);
    expect(oldResult.ok).toBe(youngResult.ok);

    // evaluateSulk: identical except for the two fields THIS test moved.
    expect(evaluateSulk(old)).toEqual({
      ...evaluateSulk(young),
      lifeMs: old.lifeMs,
      readyToRetire: true,
    });
  });

  it("run only from TICK/CATCHUP by contract — RETIRE_PIP is the only action that may ever move a Pip (asserted at the reducer level in core/state.test.ts)", () => {
    // This function itself never touches sanctuary state — it returns a
    // PipState, never a GameState — so promise 3/5 hold by construction:
    // there is no state this function COULD move a Pip into.
    const pip = pipAt({ avgHappiness: 50, level: 1, lifeMs: lifespanMs(pipAt({ avgHappiness: 50, level: 1 })) });
    const result = updateAging(pip);
    expect(result.readyToRetire).toBe(true);
    const newKeys = Object.keys(result).filter((key) => !(key in pip));
    expect(newKeys).toEqual(["readyToRetire"]);
  });
});
