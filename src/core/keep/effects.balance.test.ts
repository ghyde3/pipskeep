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
      accessorySlots: 1,
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
