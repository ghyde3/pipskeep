/**
 * THE GUARD (docs/progression-bible.md §3.6, orchestrator ruling #3): a
 * MAXIMALLY-BUILT Keep must still need real care. "Buildings shorten the
 * chore; they never trivialise care" is a single number —
 * `tuning.progression.effectCaps.comfortReductionMax` (0.25) — and this
 * file is the permanent arithmetic proof of it, the round-2F sibling of
 * `core/pips/balance.test.ts` (which this file deliberately does NOT
 * duplicate — it stays byte-identical because comfort is the identity on
 * an unbuilt Keep, per that file's own §8.2 reasoning).
 *
 * Mirrors `core/pips/balance.test.ts`'s own method exactly: real
 * `content/tuning.ts` numbers through the real `runCatchup` engine, this
 * time with the Keep's comfort/rest-speed multiplier MAXED OUT (every
 * comfort channel at `comfortReductionMax`, rest speed at `restSpeedMax`)
 * — the worst-case (for the "care still matters" claim) a player could
 * ever build.
 */

import { describe, expect, it } from "vitest";
import { FakeClock } from "../clock";
import { HOUR_MS, tuning } from "../../content/tuning";
import { PERSONALITY_IDS } from "../../content/personalities";
import type { PersonalityId } from "../../content/personalities";
import { LifeStage, NEED_IDS, PipActivity } from "../pips/types";
import type { NeedId, PipNeeds, PipState } from "../pips/types";
import { deriveMood } from "../pips/mood";
import { runCatchup } from "../pips/catchup";
import type { CatchupState, CatchupTuning } from "../pips/catchup";
import type { KeepComfortEffect } from "../pips/needs";
import { placeables as contentPlaceables } from "../../content/placeables";
import { decorations as contentDecorations } from "../../content/decorations";
import { decorSets as contentDecorSets } from "../../content/decorSets";
import type { BuildingEffect } from "../../content/buildingEffects";

const SAVED_AT = 1_000 * HOUR_MS;
const HEALTHY = 90;

const neutralTuning = {
  ...tuning,
  personalityDecayMultipliers: {
    ...tuning.personalityDecayMultipliers,
    neutral: { hunger: 1, cleanliness: 1, happiness: 1, energy: 1 },
  },
} satisfies CatchupTuning;

const needsAt = (value: number): PipNeeds => ({
  hunger: value,
  cleanliness: value,
  happiness: value,
  energy: value,
});

function makePip(overrides: Partial<PipState> = {}): PipState {
  const personalityId = overrides.personalityId ?? "neutral";
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
    needs: needsAt(HEALTHY),
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

const lowestNeed = (needs: PipNeeds): number => Math.min(...NEED_IDS.map((n) => needs[n]));

/** A maxed-out comfort multiplier at exactly the cap `reduction` (e.g. the
 * shipped 0.25) — deliberately parameterised so the "what if the cap were
 * higher" test below can construct the SAME shape at a different value,
 * proving the cap (not the arithmetic) is what makes the claim true. */
function maxedKeepComfort(reduction: number, restSpeedMultiplier: number): KeepComfortEffect {
  const multiplier = {} as Record<NeedId, number>;
  for (const need of NEED_IDS) multiplier[need] = 1 - reduction;
  return { multiplier, restSpeedMultiplier };
}

const SHIPPED_MAXED_COMFORT = maxedKeepComfort(
  tuning.progression.effectCaps.comfortReductionMax,
  tuning.progression.effectCaps.restSpeedMax,
);

function comeBackMaxed(
  awayMs: number,
  overrides: Partial<PipState> = {},
  keepComfort: KeepComfortEffect = SHIPPED_MAXED_COMFORT,
  catchupTuning: CatchupTuning = neutralTuning,
): PipState {
  const clock = new FakeClock(SAVED_AT);
  clock.advance(awayMs);
  const state: CatchupState = { pips: [makePip(overrides)] };
  const { state: after } = runCatchup(
    state,
    SAVED_AT,
    clock.now(),
    catchupTuning,
    undefined,
    keepComfort,
  );
  return after.pips[0]!;
}

function windowDropWithComfort(personalityId: PersonalityId, need: NeedId): number {
  const capHours = tuning.offlineRateCapMs / HOUR_MS;
  const base =
    -tuning.needDecayPerHour[need] *
    tuning.personalityDecayMultipliers[personalityId][need] *
    capHours;
  return base * (1 - tuning.progression.effectCaps.comfortReductionMax);
}

function windowDropUnbuilt(personalityId: PersonalityId, need: NeedId): number {
  const capHours = tuning.offlineRateCapMs / HOUR_MS;
  return (
    -tuning.needDecayPerHour[need] *
    tuning.personalityDecayMultipliers[personalityId][need] *
    capHours
  );
}

describe("a maximally-built Keep still comes home Grumpy after 24h, for every personality (bible §3.6)", () => {
  for (const personalityId of PERSONALITY_IDS) {
    it(`${personalityId}: comes home Grumpy, never Content or Beaming`, () => {
      const pip = comeBackMaxed(24 * HOUR_MS, { personalityId, needs: needsAt(HEALTHY) });
      expect(deriveMood(pip.needs, tuning.mood), personalityId).toBe("grumpy");
    });

    it(`${personalityId}: nothing floors and nothing sulks — the chore got shorter, not optional`, () => {
      const pip = comeBackMaxed(24 * HOUR_MS, { personalityId, needs: needsAt(HEALTHY) });
      expect(lowestNeed(pip.needs), personalityId).toBeGreaterThan(0);
      expect(pip.activity, personalityId).not.toBe(PipActivity.Sulking);
      expect(pip.pendingSulk, personalityId).toBe(false);
    });

    it(`${personalityId}: nothing is at or below sulkExitThreshold — a maxed Keep never sulks`, () => {
      const pip = comeBackMaxed(24 * HOUR_MS, { personalityId, needs: needsAt(HEALTHY) });
      expect(lowestNeed(pip.needs), personalityId).toBeGreaterThan(tuning.sulkExitThreshold);
    });
  }

  it("the maxed return is strictly BETTER than the unbuilt return for every personality/need (comfort only widens the margin)", () => {
    for (const personalityId of PERSONALITY_IDS) {
      const maxed = comeBackMaxed(24 * HOUR_MS, { personalityId, needs: needsAt(HEALTHY) });
      const unbuilt = comeBackMaxed(
        24 * HOUR_MS,
        { personalityId, needs: needsAt(HEALTHY) },
        { multiplier: { hunger: 1, cleanliness: 1, happiness: 1, energy: 1 }, restSpeedMultiplier: 1 },
      );
      for (const need of NEED_IDS) {
        expect(maxed.needs[need], `${personalityId}/${need}`).toBeGreaterThanOrEqual(
          unbuilt.needs[need],
        );
      }
    }
  });
});

describe("care is still mandatory on a maxed Keep — a full absence from the leave-safe floor still reaches 0", () => {
  it("leaving at the (comfort-adjusted) floor still bottoms out one need for the worst pairing", () => {
    const floor = Math.max(
      ...PERSONALITY_IDS.flatMap((id) => NEED_IDS.map((need) => windowDropWithComfort(id, need))),
    );
    // Leaving comfortably ABOVE the maxed floor survives with room, exactly
    // like the un-maxed balance.test.ts equivalent — proving the maxed
    // Keep still has a real floor, not "care no longer matters".
    for (const personalityId of PERSONALITY_IDS) {
      const pip = comeBackMaxed(24 * HOUR_MS, { personalityId, needs: needsAt(floor + 1) });
      for (const need of NEED_IDS) {
        expect(pip.needs[need], `${personalityId}/${need}`).toBeGreaterThan(0);
      }
    }
    // ...and the floor is REAL — leaving at exactly 40 (a Grumpy-but-caring
    // save) still lets the worst pairing hit 0 over a full absence.
    for (const personalityId of PERSONALITY_IDS) {
      const worstDrop = Math.max(...NEED_IDS.map((need) => windowDropWithComfort(personalityId, need)));
      if (worstDrop < 40) continue; // this personality's worst need never reaches 0 from 40
      const pip = comeBackMaxed(24 * HOUR_MS, { personalityId, needs: needsAt(40) });
      expect(lowestNeed(pip.needs), personalityId).toBe(0);
    }
  });
});

describe("the leave-safe margin only ever WIDENS on a maxed Keep (never narrows)", () => {
  it("every personality/need's leave-safe margin is bigger with maxed comfort than without", () => {
    for (const personalityId of PERSONALITY_IDS) {
      for (const need of NEED_IDS) {
        const withoutComfort = windowDropUnbuilt(personalityId, need);
        const withComfort = windowDropWithComfort(personalityId, need);
        expect(withComfort, `${personalityId}/${need}`).toBeLessThanOrEqual(withoutComfort);
      }
    }
  });
});

describe("WHY the cap is 0.25 and not 0.30 (the exact number the bible names)", () => {
  it("at 0.25 (shipped) a Curious Pip comes home Grumpy", () => {
    const pip = comeBackMaxed(24 * HOUR_MS, {
      personalityId: "curious",
      needs: needsAt(HEALTHY),
    });
    expect(deriveMood(pip.needs, tuning.mood)).toBe("grumpy");
  });

  it("at a hypothetical 0.30 cap, a Curious Pip would come home Content — exactly why 0.25 is the line", () => {
    const hypothetical = maxedKeepComfort(0.3, tuning.progression.effectCaps.restSpeedMax);
    const pip = comeBackMaxed(
      24 * HOUR_MS,
      { personalityId: "curious", needs: needsAt(HEALTHY) },
      hypothetical,
    );
    expect(deriveMood(pip.needs, tuning.mood)).toBe("content");
  });
});

describe("rest speed at the cap still leaves a nap long enough to watch", () => {
  it("a full 0 → 100 nap at restSpeedMax is at least 5 minutes (balance.test.ts's own floor)", () => {
    const cappedEnergyPerHour =
      tuning.care.rest.energyPerHour * tuning.progression.effectCaps.restSpeedMax;
    const fullNapMs = (100 / cappedEnergyPerHour) * HOUR_MS;
    expect(fullNapMs).toBeGreaterThanOrEqual(5 * 60 * 1000);
  });
});

/**
 * ⚠️ ROUND 2J FIX STAGE — THE PRE-CLAMP COMFORT BUDGET.
 *
 * The mutation that exposed the gap: adding two `comfort` effects
 * (`decayReduction: 0.09` each) to the round's new Craft Table left the
 * whole suite green — and even added two data-driven tests that themselves
 * passed. Nothing in the repo bounded how much comfort CONTENT may
 * declare.
 *
 * Why the existing guards cannot catch it. `core/keep/effects.test.ts`'s
 * "every need reaches comfortReductionMax on a fully-built Keep" is a
 * LOWER bound; its companion "and none exceeds it" reads
 * `effects.comfort[need]`, which is the value AFTER `resolveKeepEffects`
 * has already clamped at `caps.comfortReductionMax` — true by construction,
 * and it can never fail.
 *
 * Why over-declaring is harmful even though the clamp holds. The
 * fully-built ceiling is unchanged, so the harm is not "care becomes
 * trivial at max build" — it is that the cap is reached with FEWER and
 * CHEAPER buildings, quietly deleting the progression pacing the
 * 0.25-of-0.26557 budget was sized to protect. Round 2H's arithmetic
 * leaves 1.557 percentage points of decay-reduction headroom in the whole
 * game; this asserts how much of it content has actually spent.
 */
describe("⚠️ the PRE-CLAMP comfort budget: how much content may DECLARE, not what survives the clamp", () => {
  /** Every `comfort` contribution any content entry declares, per need,
   * summed before any clamp — items and set bonuses alike. */
  function declaredComfort(): Record<NeedId, number> {
    const total: Record<NeedId, number> = {
      hunger: 0,
      cleanliness: 0,
      happiness: 0,
      energy: 0,
    };
    const add = (effect: BuildingEffect): void => {
      if (effect.kind !== "comfort") return;
      if (effect.need === "all") {
        for (const need of NEED_IDS) total[need] += effect.decayReduction;
      } else {
        total[effect.need] += effect.decayReduction;
      }
    };
    for (const item of [...contentPlaceables, ...contentDecorations]) {
      for (const effect of item.effects ?? []) add(effect);
    }
    for (const set of contentDecorSets) {
      // The two tiers are exclusive — only the higher one is ever folded —
      // so the honest worst case is the bigger of the two.
      add(set.bonusAt5);
    }
    return total;
  }

  const CAP = tuning.progression.effectCaps.comfortReductionMax;

  /**
   * The declared budget may exceed the cap — that is what makes a
   * fully-built Keep reach it — but only by a stated, deliberate margin.
   * 1.6× is roughly what the shipped tree spends (hunger is the tightest
   * at exactly 1.00× after round 2F's Larder retune; energy is the
   * loosest). Anything past this means content is handing the cap out
   * cheaply, which is the pacing regression this guard exists for.
   */
  const MAX_DECLARED_MULTIPLE = 1.6;

  for (const need of NEED_IDS) {
    it(`${need}: content declares no more than ${MAX_DECLARED_MULTIPLE}× the cap before clamping`, () => {
      const declared = declaredComfort()[need];
      expect(declared, `${need} declared`).toBeLessThanOrEqual(CAP * MAX_DECLARED_MULTIPLE);
    });

    it(`${need}: content declares AT LEAST the cap, so a fully-built Keep can still reach it`, () => {
      expect(declaredComfort()[need], `${need} declared`).toBeGreaterThanOrEqual(CAP);
    });
  }

  /**
   * The specific shape the mutation took: a STATION that is not about
   * comfort quietly acquiring some. Stations that exist to slow a need
   * (Food Bowl, Bed, Larder, Sun Bunks, Wash Basin, Play Post) are the
   * only ones that should carry it — a workshop is not a cushion.
   */
  it("no production or utility station carries a comfort effect", () => {
    // (The Stockpot is deliberately absent: it IS a pantry, and round 2B
    // gave it a Hunger comfort on purpose.)
    const NOT_COMFORT_STATIONS = [
      "gathering-station",
      "workbench",
      "craft-table",
      "nest-warmer",
      "trail-post",
      "beacon",
      "weathervane",
      "poultice-shelf",
    ];
    for (const id of NOT_COMFORT_STATIONS) {
      const item = contentPlaceables.find((p) => p.id === id);
      expect(item, id).toBeDefined();
      for (const effect of item?.effects ?? []) {
        expect(effect.kind, `${id} must not slow a need`).not.toBe("comfort");
      }
    }
  });

  /** Nothing CRAFTED may carry comfort at all (docs/economy-bible.md's I3
   * — the headroom is spent). */
  it("no craft-only keepsake carries a comfort effect", () => {
    for (const item of contentDecorations.filter((d) => d.craftOnly === true)) {
      for (const effect of item.effects ?? []) {
        expect(effect.kind, item.id).not.toBe("comfort");
      }
    }
  });
});
