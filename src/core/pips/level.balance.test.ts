/**
 * THE ROUND'S FRAGILE INVARIANT (spec §16 v1.5, docs/lifecycle-bible.md
 * §1.4/§1.5): a Pip's `seasoning` (its own per-level decay-reduction
 * effect, `core/pips/level.ts`) and the Keep's building `comfort`
 * (`core/keep/effects.ts`, round 2F) are ONE channel — summed, then
 * clamped ONCE, at `tuning.progression.effectCaps.comfortReductionMax`
 * (0.25). There is no independent second cap for seasoning; the
 * arithmetic in the bible proves there is no room for one (1.557
 * percentage points of headroom in the ENTIRE game, and comfort already
 * spends 0.25 of it).
 *
 * Mirrors `core/pips/balance.test.ts`'s own method exactly — real
 * `content/tuning.ts` numbers through the real `effectiveRates` engine,
 * asserting how the game FEELS — so this is the permanent guard against
 * a future retune (of `lifecycle.level.seasoning`,
 * `progression.effectCaps.comfortReductionMax`, or the base decay curve)
 * silently trivialising care for a veteran Pip on a built Keep.
 */

import { describe, expect, it } from "vitest";
import { HOUR_MS, tuning } from "../../content/tuning";
import { PERSONALITY_IDS } from "../../content/personalities";
import type { PersonalityId } from "../../content/personalities";
import { LifeStage, NEED_IDS, PipActivity } from "./types";
import type { NeedId, PipState } from "./types";
import { deriveMood } from "./mood";
import { effectiveRates } from "./needs";
import type { KeepComfortEffect } from "./needs";
import { seasoningFor } from "./level";

const SAVED_AT = 1_000 * HOUR_MS;
const CAP_HOURS = tuning.offlineRateCapMs / HOUR_MS;
const CARE_EASE_MAX = tuning.progression.effectCaps.comfortReductionMax;
const MAX_LEVEL = tuning.lifecycle.level.maxLevel;

function makePip(overrides: Partial<PipState> = {}): PipState {
  const personalityId = overrides.personalityId ?? "curious";
  return {
    id: "pip-1",
    speciesId: "mosspip",
    name: "Testpip",
    genome: {
      speciesId: "mosspip",
      palette: "fern",
      pattern: "plain",
      personalityId,
      shiny: false,
    },
    personalityId,
    lifeStage: LifeStage.Adult,
    hatchedAt: SAVED_AT - 200 * HOUR_MS,
    ageMs: 200 * HOUR_MS,
    happinessIntegral: 0,
    needs: { hunger: 90, cleanliness: 90, happiness: 90, energy: 90 },
    activity: PipActivity.Idle,
    pendingSulk: false,
    readyToEvolve: false,
    evolved: null,
    lastGiftItemId: null,
    expedition: null,
    needsUpdatedAt: SAVED_AT,
    ...overrides,
  };
}

/** A flat per-need Keep comfort MULTIPLIER (`1 − comfort`), the same
 * shape `core/keep/effects.ts`'s `keepComfortMultipliers` produces. */
function flatKeepComfort(multiplier: number): KeepComfortEffect {
  return {
    multiplier: { hunger: multiplier, cleanliness: multiplier, happiness: multiplier, energy: multiplier },
    restSpeedMultiplier: 1,
  };
}

/** How far one need falls over one full capped absence window, for one
 * personality × level × Keep-comfort-multiplier combination — the
 * seasoned sibling of `balance.test.ts`'s own `windowDrop`. */
function seasonedWindowDrop(
  personalityId: PersonalityId,
  need: NeedId,
  level: number,
  keepComfortMultiplier: number,
): number {
  const pip = makePip({ personalityId, level });
  const rates = effectiveRates(pip, tuning, flatKeepComfort(keepComfortMultiplier));
  return -rates[need] * CAP_HOURS;
}

/** The UNSEASONED (level 1) window drop for the same (personality, need,
 * keepComfortMultiplier) — level 1 has 0 seasoning by construction
 * (`seasoningFor`'s identity), so this is exactly `balance.test.ts`'s own
 * `windowDrop` composed with a Keep comfort multiplier. */
function unseasonedWindowDrop(
  personalityId: PersonalityId,
  need: NeedId,
  keepComfortMultiplier: number,
): number {
  return seasonedWindowDrop(personalityId, need, 1, keepComfortMultiplier);
}

describe("seasoningFor — the level table itself", () => {
  it("is exactly 0 at level 1 (undefined ≡ 1) — a strict no-op", () => {
    expect(seasoningFor(makePip())).toBe(0);
    expect(seasoningFor(makePip({ level: 1 }))).toBe(0);
  });

  it("is monotonically non-decreasing with level", () => {
    let prev = 0;
    for (let level = 1; level <= MAX_LEVEL; level++) {
      const value = seasoningFor(makePip({ level }));
      expect(value, `level ${level}`).toBeGreaterThanOrEqual(prev);
      prev = value;
    }
  });

  it("caps at 0.12 at max level, per the bible's own headroom arithmetic", () => {
    expect(seasoningFor(makePip({ level: MAX_LEVEL }))).toBeCloseTo(0.12, 10);
  });
});

describe("THE SHARED CARE-EASE CHANNEL — care ease never exceeds comfortReductionMax", () => {
  it("for any (legitimately-resolved comfort, level) pair, the total reduction stays at or below the cap", () => {
    // "Legitimately-resolved" comfort is core/keep/effects.ts's own domain:
    // resolveKeepEffects clamps its OWN output to [0, comfortReductionMax]
    // before anything downstream ever sees it — that clamp is this
    // property's other half, and is effects.test.ts's job, not this
    // file's. This sweeps every keepComfort a real Keep can ever produce.
    for (let comfortSteps = 0; comfortSteps <= 10; comfortSteps++) {
      const keepComfort = (comfortSteps / 10) * CARE_EASE_MAX;
      const keepComfortMultiplier = 1 - keepComfort;
      for (let level = 1; level <= MAX_LEVEL; level++) {
        const pip = makePip({ level });
        const rates = effectiveRates(pip, tuning, flatKeepComfort(keepComfortMultiplier));
        for (const need of NEED_IDS) {
          const baseRatePerHour =
            tuning.needDecayPerHour[need] *
            tuning.personalityDecayMultipliers[pip.personalityId as PersonalityId][need];
          // The EFFECTIVE multiplier this need actually saw, backed out of
          // the produced rate; `1 − that` is the TOTAL reduction (keep +
          // seasoning combined) applied to it.
          const effectiveMultiplier = rates[need] / baseRatePerHour;
          const totalReduction = 1 - effectiveMultiplier;
          expect(
            totalReduction,
            `level ${level}, keepComfort ${keepComfort}, ${need}`,
          ).toBeLessThanOrEqual(CARE_EASE_MAX + 1e-9);
        }
      }
    }
  });

  it("is a strict no-op whenever `progression`/`lifecycle` is absent from the injected tuning (every pre-2H fixture)", () => {
    const bareTuning = {
      needDecayPerHour: tuning.needDecayPerHour,
      personalityDecayMultipliers: tuning.personalityDecayMultipliers,
      quirks: tuning.quirks,
      pipling: tuning.pipling,
      care: tuning.care,
    };
    const level1 = effectiveRates(makePip({ level: 1 }), bareTuning, flatKeepComfort(0.75));
    const level10 = effectiveRates(makePip({ level: MAX_LEVEL }), bareTuning, flatKeepComfort(0.75));
    expect(level10).toEqual(level1);
  });
});

describe("Case A (bible §1.5) — max level, MAXIMALLY BUILT Keep: seasoning contributes nothing (no headroom), and every personality still comes home Grumpy", () => {
  const CASES: readonly [PersonalityId, NeedId][] = [
    ["lazy", "energy"],
    ["curious", "cleanliness"],
    ["hardworking", "hunger"],
    ["chaotic", "cleanliness"],
    ["clingy", "happiness"],
  ];

  it("a maxed Keep's comfort already spends the whole cap, so a max-level Pip's own seasoning adds exactly 0", () => {
    for (const [personalityId, need] of CASES) {
      const seasoned = seasonedWindowDrop(personalityId, need, MAX_LEVEL, 1 - CARE_EASE_MAX);
      const unseasonedAtCap = unseasonedWindowDrop(personalityId, need, 1 - CARE_EASE_MAX);
      expect(seasoned, `${personalityId}/${need}`).toBeCloseTo(unseasonedAtCap, 9);
    }
  });

  it("every worst-need personality lands Grumpy from a 90 save, nothing at 0, nothing at or below sulkExitThreshold", () => {
    for (const [personalityId, need] of CASES) {
      const drop = seasonedWindowDrop(personalityId, need, MAX_LEVEL, 1 - CARE_EASE_MAX);
      const landed = 90 - drop;
      expect(landed, `${personalityId}/${need}`).toBeGreaterThan(tuning.sulkExitThreshold);
      expect(landed, `${personalityId}/${need}`).toBeLessThan(40); // Grumpy
      expect(landed, `${personalityId}/${need}`).toBeGreaterThan(0);
    }
  });

  it("a max-level Pip on a MAXED Keep comes home Grumpy, for every shipped personality (not just the five binding rows)", () => {
    for (const personalityId of PERSONALITY_IDS) {
      const pip = makePip({ personalityId, level: MAX_LEVEL, needs: { hunger: 90, cleanliness: 90, happiness: 90, energy: 90 } });
      const rates = effectiveRates(pip, tuning, flatKeepComfort(1 - CARE_EASE_MAX));
      const needs = { ...pip.needs };
      for (const need of NEED_IDS) {
        needs[need] = Math.max(0, Math.min(100, needs[need] + rates[need] * CAP_HOURS));
      }
      expect(deriveMood(needs, tuning.mood), personalityId).toBe("grumpy");
    }
  });
});

describe("Case B (bible §1.5) — max level, UNBUILT Keep: seasoning is at its most valuable, and still lands inside balance.test.ts's shipped [15, 45] band", () => {
  // Bible §1.5's own Case B table names exactly ONE row per personality —
  // its OWN worst (fastest-decaying) need, the same five (personality,
  // need) pairs Case A above checks. Seasoning REDUCES decay uniformly
  // across all four needs, so an already-mild need (Curious's happiness,
  // ×0.8) can land ABOVE 45 once seasoned — that is fine and expected
  // (seasoning can only ever make a need end up HIGHER); the [15, 45]
  // claim is about each personality's WORST need, not every need.
  const CASES: readonly [PersonalityId, NeedId][] = [
    ["lazy", "energy"],
    ["curious", "cleanliness"],
    ["hardworking", "hunger"],
    ["chaotic", "cleanliness"],
    ["clingy", "happiness"],
  ];

  it("a max-level Pip's worst need on an unbuilt Keep passes the existing 24-hour personality-sweep band unchanged", () => {
    // ⚠ Deliberately NOT `> sulkExitThreshold` here (see bible §1.5's own
    // warning): Case B's worst row sits fractionally BELOW 25, which is
    // fine — Sulking is ENTERED at 0, never at 25; sulkExitThreshold only
    // governs a Pip that is already sulking.
    for (const [personalityId, need] of CASES) {
      const drop = seasonedWindowDrop(personalityId, need, MAX_LEVEL, 1);
      const landed = 90 - drop;
      expect(landed, `${personalityId}/${need}`).toBeGreaterThan(0);
      expect(landed, `${personalityId}/${need}`).toBeGreaterThanOrEqual(15);
      expect(landed, `${personalityId}/${need}`).toBeLessThanOrEqual(45);
    }
  });

  it("no need, seasoned or not, is ever pushed below the UNSEASONED sweep's own floor of 15", () => {
    // The one direction seasoning must never move a bar: down. Every need
    // for every personality, seasoned at max level on an unbuilt Keep,
    // stays at or above what the pre-2H sweep already proved safe.
    for (const personalityId of PERSONALITY_IDS) {
      for (const need of NEED_IDS) {
        const seasonedDrop = seasonedWindowDrop(personalityId, need, MAX_LEVEL, 1);
        expect(90 - seasonedDrop, `${personalityId}/${need}`).toBeGreaterThanOrEqual(15);
      }
    }
  });

  it("every shipped personality is still Grumpy, never Beaming/Content, from a max-level Pip on an unbuilt Keep", () => {
    for (const personalityId of PERSONALITY_IDS) {
      const pip = makePip({ personalityId, level: MAX_LEVEL, needs: { hunger: 90, cleanliness: 90, happiness: 90, energy: 90 } });
      const rates = effectiveRates(pip, tuning, flatKeepComfort(1));
      const needs = { ...pip.needs };
      for (const need of NEED_IDS) {
        needs[need] = Math.max(0, Math.min(100, needs[need] + rates[need] * CAP_HOURS));
      }
      expect(deriveMood(needs, tuning.mood), personalityId).toBe("grumpy");
    }
  });
});

describe("Case C (bible §1.5) — the leave-safe margin only ever WIDENS with level", () => {
  it("for every (personality, need, level, keep comfort), the seasoned window drop is ≤ the unseasoned one", () => {
    const comfortMultipliers = [1, 1 - CARE_EASE_MAX / 2, 1 - CARE_EASE_MAX];
    for (const personalityId of PERSONALITY_IDS) {
      for (const need of NEED_IDS) {
        for (const keepComfortMultiplier of comfortMultipliers) {
          const unseasoned = unseasonedWindowDrop(personalityId, need, keepComfortMultiplier);
          let prevDrop = unseasoned;
          for (let level = 1; level <= MAX_LEVEL; level++) {
            const drop = seasonedWindowDrop(personalityId, need, level, keepComfortMultiplier);
            expect(
              drop,
              `${personalityId}/${need} level ${level} comfort×${keepComfortMultiplier}`,
            ).toBeLessThanOrEqual(unseasoned + 1e-9);
            expect(
              drop,
              `${personalityId}/${need} level ${level} monotonic`,
            ).toBeLessThanOrEqual(prevDrop + 1e-9);
            prevDrop = drop;
          }
        }
      }
    }
  });

  it("the tightest shipped leave-safe pair (Hardworking/happiness) only ever gets SAFER with level", () => {
    const unbuiltUnseasoned = unseasonedWindowDrop("hardworking", "happiness", 1);
    const unbuiltSeasoned = seasonedWindowDrop("hardworking", "happiness", MAX_LEVEL, 1);
    const maxedSeasoned = seasonedWindowDrop(
      "hardworking",
      "happiness",
      MAX_LEVEL,
      1 - CARE_EASE_MAX,
    );
    expect(unbuiltSeasoned).toBeLessThan(unbuiltUnseasoned);
    expect(maxedSeasoned).toBeLessThan(unbuiltSeasoned);

    const restore =
      tuning.care.play.happiness + tuning.care.pet.happiness; // hardworking is not clingy
    expect(restore - unbuiltUnseasoned).toBeGreaterThan(0); // the shipped floor
    expect(restore - unbuiltSeasoned).toBeGreaterThan(restore - unbuiltUnseasoned);
    expect(restore - maxedSeasoned).toBeGreaterThan(restore - unbuiltSeasoned);
  });
});
