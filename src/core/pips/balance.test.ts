/**
 * BALANCE / FEEL GUARD (playtest round 2A — the "noticeably grumpy" pass;
 * extended in round 2B — "day 2 must not be worse than day 1").
 *
 * Every other test in `core/pips` tests the ENGINE (segmentation, the cap,
 * event ordering) against injected fixture numbers. This file is the
 * opposite: it runs the REAL `content/tuning.ts` numbers through the REAL
 * catch-up engine and asserts how the game FEELS after an absence. It is
 * the permanent guard against re-breaking the curve — if someone edits
 * `needDecayPerHour`, `offlineRateCapMs`, `personalityDecayMultipliers`,
 * `care.rest.energyPerHour`, or `pipling.*`, this file is what tells them
 * what they just did to the player.
 *
 * The targets it encodes (project owner, playtest round 2A):
 *
 *   2h absence   — barely noticeable. Still Beaming; nothing below 78.
 *   8h absence   — mild. The daily/overnight player is NEVER punished:
 *                  Content at worst, no need below 50, nobody Sulking.
 *   24h absence  — "noticeably grumpy, ~25%". Every need in [18, 35] for
 *                  a neutral adult: clearly neglected, obviously fixable,
 *                  NOT a wasteland and NOT all-zeros.
 *   72h absence  — identical to 24h. You can never lose more than one bad
 *                  day (spec §4.5's whole promise, made observable).
 *   personality  — the sweep: from ANY healthy start (85–100), NO
 *                  personality bottoms out at 0 over a 24h absence, so a
 *                  returning player never finds a Pip they cannot greet.
 *   pipling      — a baby is never WORSE off than an adult over the same
 *                  absence, and never spends a whole absence as a baby.
 *   rest         — recovery is measured in minutes, not hours.
 *
 * ROUND 2B adds the case round 2A never modelled — THE SECOND ABSENCE.
 * Every scenario above measures ONE absence from a pristine save, and a
 * tuning can pass all of them while the actual repeating loop (come home
 * → care → leave again) ratchets every bar downward until the whole Keep
 * Sulks. So this file now also encodes:
 *
 *   leave-safe   — for EVERY need × personality, one care session must
 *                  restore MORE than one full capped window takes away.
 *                  That single inequality is what makes the loop close.
 *   day 2, day 3 — the same claim driven through the real reducer: leave,
 *                  come home, do the canonical care round, leave again,
 *                  three times over. No Sulking, no need at 0, nobody
 *                  Miserable, and no downward drift between cycles.
 *
 * Deliberately uses `runCatchup` (not `applyNeedsDelta`) so the assertions
 * exercise the cap, the segmentation and the Sulking evaluation exactly as
 * a real load does; the day-2 loop goes one level further out and drives
 * `rootReducer` itself, so care, cooldowns, refusals and catch-up are the
 * shipped ones. Time comes from FakeClock; there is no clock read here.
 */

import { describe, expect, it } from "vitest";
import { FakeClock } from "../clock";
import { HOUR_MS, MINUTE_MS, SECOND_MS, tuning } from "../../content/tuning";
import { PERSONALITY_IDS } from "../../content/personalities";
import type { PersonalityId } from "../../content/personalities";
import { createNewGame, rootReducer } from "../state";
import type { GameState } from "../state";
import { LifeStage, NEED_IDS, PipActivity } from "./types";
import type { NeedId, PipNeeds, PipState } from "./types";
import { deriveMood } from "./mood";
import { runCatchup } from "./catchup";
import type { CatchupState, CatchupTuning } from "./catchup";

const SAVED_AT = 1_000 * HOUR_MS;

/**
 * The canonical "well-cared-for Keep at save time" the owner described:
 * every need at 90 (inside the 85–100 band a player who just did a care
 * round leaves behind).
 */
const HEALTHY = 90;

/** The whole 85–100 band, for the per-personality robustness sweep. */
const HEALTHY_BAND = [85, 90, 95, 100] as const;

/** Real content tuning + an all-×1.0 personality, so the headline numbers
 * measure the BASE curve rather than whichever personality got rolled. */
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

/** Come back after `awayMs` and report the single pip's state. */
function comeBackAfter(
  awayMs: number,
  overrides: Partial<PipState> = {},
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
  );
  return after.pips[0]!;
}

const lowestNeed = (needs: PipNeeds): number =>
  Math.min(...NEED_IDS.map((need) => needs[need]));

const highestNeed = (needs: PipNeeds): number =>
  Math.max(...NEED_IDS.map((need) => needs[need]));

/** Hours in one full capped offline window — the unit every "a day away"
 * number in this file is really measured in (spec §4.5). */
const CAP_HOURS = tuning.offlineRateCapMs / HOUR_MS;

/**
 * How far one need falls over a WHOLE capped window for one personality —
 * and therefore the bar value the player must LEAVE BEHIND for that need
 * not to be sitting on the floor when they get back. The load-bearing
 * quantity of round 2B; everything else in the loop is downstream of it.
 */
function windowDrop(personalityId: PersonalityId, need: NeedId): number {
  return (
    -tuning.needDecayPerHour[need] *
    tuning.personalityDecayMultipliers[personalityId][need] *
    CAP_HOURS
  );
}

/**
 * What ONE canonical care session puts back on a need — the round a
 * player actually does, spelled out (and mirrored beat for beat by
 * `careSession` below, which performs it through the reducer):
 *
 *   Rest    → Energy 100, minus the 10 the single Play then costs
 *   Clean   → Cleanliness 100
 *   Feed ×2 → 2 Berries of Hunger ("two berries each" is the daily ritual)
 *   Play + Pet → the whole Happiness cure, once each
 *
 * Clean and Rest SET their need, so their restore covers the bar from any
 * starting point. Feed, Play and Pet ADD — which is exactly why Hunger
 * and Happiness were the two needs that broke in round 2A.
 */
function sessionRestore(personalityId: PersonalityId, need: NeedId): number {
  switch (need) {
    case "cleanliness":
      return tuning.care.clean.setsCleanlinessTo;
    case "energy":
      return tuning.care.rest.autoWakeAtEnergy + tuning.care.play.energy;
    case "hunger":
      return 2 * tuning.foods.berry.hunger;
    case "happiness":
      return (
        tuning.care.play.happiness +
        (personalityId === "clingy"
          ? tuning.care.pet.clingyHappiness
          : tuning.care.pet.happiness)
      );
  }
}

// --- the day-2 loop, driven through the shipped reducer ---------------------

/** A one-Pip Keep of a given personality with every need at `start` and a
 * deliberately bottomless pantry — these tests measure the CARE loop, not
 * the economy (whether the pantry keeps up is
 * `core/economy/reachability.test.ts`'s job). Built from `createNewGame`
 * so the state is the real thing; only the traits the scenario is ABOUT
 * are overridden. */
function keepWith(personalityId: PersonalityId, start = HEALTHY): GameState {
  const base = createNewGame(7, SAVED_AT);
  const id = base.activePipId;
  const pip = base.pips[id];
  if (pip === undefined) throw new Error("createNewGame produced no starter");
  return {
    ...base,
    inventory: { berry: 99 },
    pips: {
      [id]: {
        ...pip,
        personalityId,
        genome: { ...pip.genome, personalityId },
        needs: needsAt(start),
      },
    },
  };
}

/** Close the tab for `ms` and come back — the same CATCHUP the boot path
 * dispatches over `savedAt → now`. */
const leaveFor = (state: GameState, ms: number): GameState =>
  rootReducer(state, {
    type: "CATCHUP",
    savedAt: state.lastTickAt,
    now: state.lastTickAt + ms,
  });

/** Real time a full 0 → 100 nap takes at the shipped regen rate. */
const FULL_NAP_MS =
  (tuning.care.rest.autoWakeAtEnergy / tuning.care.rest.energyPerHour) *
  HOUR_MS;

/** Taps in the canonical session (see `sessionRestore`): Rest, Clean,
 * Feed, Feed, Play, Pet. A Lazy Pip's 15% whim refusal (spec §5) can add
 * a retry, which costs nothing but a tap. */
const SESSION_TAPS = 6;

/**
 * The care round the player does on getting home, performed through the
 * real reducer so cooldowns, refusals and the nap are the shipped ones.
 * Rest comes FIRST on purpose: Energy gates Play (a Lazy Pip refuses
 * below 30), so the nap is what makes the rest of the round possible.
 *
 * Returns the tap count as well as the state, so the tests can assert
 * what the round COSTS the player and not only what it achieves.
 */
function careSession(state: GameState): { state: GameState; taps: number } {
  const id = state.activePipId;
  let s = state;
  let at = s.lastTickAt + SECOND_MS;
  let taps = 0;

  s = rootReducer(s, { type: "REST_TOGGLE", pipId: id, at });
  taps++;
  // One tick, one nap: 0 → 100 Energy takes ~10 minutes of real time.
  at += FULL_NAP_MS + MINUTE_MS;
  s = rootReducer(s, { type: "TICK", at });

  s = rootReducer(s, { type: "CLEAN", pipId: id, at });
  taps++;
  for (let i = 0; i < 2; i++) {
    at += SECOND_MS;
    s = rootReducer(s, { type: "FEED", pipId: id, foodId: "berry", at });
    taps++;
  }
  at += SECOND_MS;
  s = rootReducer(s, { type: "PLAY", pipId: id, at });
  taps++;
  // Lazy's 15% flavour refusal (spec §5) costs nothing — tap again.
  for (let retry = 0; retry < 5 && s.lastCareOutcome?.applied === false; retry++) {
    at += SECOND_MS;
    s = rootReducer(s, { type: "PLAY", pipId: id, at });
    taps++;
  }
  at += SECOND_MS;
  s = rootReducer(s, { type: "PET", pipId: id, at });
  taps++;
  return { state: s, taps };
}

const activePip = (state: GameState): PipState => {
  const pip = state.pips[state.activePipId];
  if (pip === undefined) throw new Error("no active pip");
  return pip;
};

// ---------------------------------------------------------------------------

describe("a 2-hour absence is barely noticeable", () => {
  it("leaves every need at or above 78 and the Pip still Beaming", () => {
    const pip = comeBackAfter(2 * HOUR_MS);

    for (const need of NEED_IDS) {
      expect(pip.needs[need]).toBeGreaterThanOrEqual(78);
    }
    expect(deriveMood(pip.needs, tuning.mood)).toBe("beaming");
    expect(pip.activity).toBe(PipActivity.Idle);
  });

  it("costs less than a fifth of the bar on the fastest-decaying need", () => {
    const pip = comeBackAfter(2 * HOUR_MS);
    expect(HEALTHY - lowestNeed(pip.needs)).toBeLessThanOrEqual(12);
  });
});

describe("an 8-hour (overnight) absence is mild — the daily player is never punished", () => {
  it("leaves every need at or above 50 and the Pip no worse than Content", () => {
    const pip = comeBackAfter(8 * HOUR_MS);

    for (const need of NEED_IDS) {
      expect(pip.needs[need]).toBeGreaterThanOrEqual(50);
    }
    expect(deriveMood(pip.needs, tuning.mood)).toBe("content");
    expect(pip.activity).not.toBe(PipActivity.Sulking);
  });

  it("is fully rated — the offline cap does not silently absorb a night", () => {
    const clock = new FakeClock(SAVED_AT);
    clock.advance(8 * HOUR_MS);
    const { summary } = runCatchup(
      { pips: [makePip()] },
      SAVED_AT,
      clock.now(),
      neutralTuning,
    );
    expect(summary.ratedMs).toBe(8 * HOUR_MS);
    expect(summary.cappedMs).toBe(0);
  });
});

describe('a 24-hour absence lands "noticeably grumpy, ~25%"', () => {
  it("puts EVERY need in [18, 35] from a healthy save", () => {
    const pip = comeBackAfter(24 * HOUR_MS);

    for (const need of NEED_IDS) {
      expect(pip.needs[need]).toBeGreaterThanOrEqual(18);
      expect(pip.needs[need]).toBeLessThanOrEqual(35);
    }
  });

  it("reads as neglected, not destroyed: nothing at 0, and the Pip is not Sulking", () => {
    const pip = comeBackAfter(24 * HOUR_MS);

    expect(lowestNeed(pip.needs)).toBeGreaterThan(0);
    expect(pip.activity).toBe(PipActivity.Idle);
    expect(pip.pendingSulk).toBe(false);
    // Visibly unhappy — the whole point of coming home to a grumpy Keep.
    expect(deriveMood(pip.needs, tuning.mood)).toBe("grumpy");
  });

  it("keeps the four bars close together — one uniformly low Keep, not one crisis bar next to one fine bar", () => {
    const pip = comeBackAfter(24 * HOUR_MS);
    expect(highestNeed(pip.needs) - lowestNeed(pip.needs)).toBeLessThanOrEqual(
      15,
    );
  });

  it("is recoverable: one Clean plus one Berry clears the Sulking-exit bar on every need", () => {
    const pip = comeBackAfter(24 * HOUR_MS);
    const afterCare: PipNeeds = {
      ...pip.needs,
      cleanliness: tuning.care.clean.setsCleanlinessTo,
      hunger: Math.min(100, pip.needs.hunger + tuning.foods.berry.hunger),
    };
    for (const need of NEED_IDS) {
      expect(afterCare[need]).toBeGreaterThanOrEqual(tuning.sulkExitThreshold);
    }
  });
});

describe("you can never lose more than one bad day (spec §4.5, made observable)", () => {
  it("a 72-hour absence lands exactly where a 24-hour absence lands", () => {
    const day = comeBackAfter(24 * HOUR_MS);
    const weekend = comeBackAfter(72 * HOUR_MS);
    expect(weekend.needs).toEqual(day.needs);
  });

  it("a 7-day absence lands there too", () => {
    const day = comeBackAfter(24 * HOUR_MS);
    const week = comeBackAfter(7 * 24 * HOUR_MS);
    expect(week.needs).toEqual(day.needs);
  });

  it("the cap binds before 24h, so the 24h target is the capped value and cannot drift with absence length", () => {
    expect(tuning.offlineRateCapMs).toBeLessThan(24 * HOUR_MS);
    // ...but not before a night's sleep: an overnight absence stays honest.
    expect(tuning.offlineRateCapMs).toBeGreaterThanOrEqual(12 * HOUR_MS);
  });
});

describe("personality sweep: the short absences hold for the SHIPPED personalities too", () => {
  // Round 2B (review finding): the 2h and 8h targets used to be asserted
  // only against the fabricated all-×1.0 `neutral` personality, so no
  // personality a player can actually roll was covered at either window.
  // The multipliers are what make those windows interesting, so sweep.
  for (const personalityId of PERSONALITY_IDS) {
    it(`${personalityId}: a 2h absence is barely noticeable`, () => {
      const pip = comeBackAfter(
        2 * HOUR_MS,
        { personalityId, needs: needsAt(HEALTHY) },
        tuning,
      );
      for (const need of NEED_IDS) {
        expect(pip.needs[need], `${personalityId} ${need}`).toBeGreaterThanOrEqual(78);
      }
      expect(deriveMood(pip.needs, tuning.mood)).toBe("beaming");
      expect(pip.activity).toBe(PipActivity.Idle);
    });

    it(`${personalityId}: an 8h (overnight) absence is mild`, () => {
      const pip = comeBackAfter(
        8 * HOUR_MS,
        { personalityId, needs: needsAt(HEALTHY) },
        tuning,
      );
      for (const need of NEED_IDS) {
        expect(pip.needs[need], `${personalityId} ${need}`).toBeGreaterThanOrEqual(50);
      }
      expect(deriveMood(pip.needs, tuning.mood)).toBe("content");
      expect(pip.activity).not.toBe(PipActivity.Sulking);
    });
  }
});

describe("personality sweep: nobody bottoms out from a healthy start", () => {
  for (const personalityId of PERSONALITY_IDS) {
    it(`${personalityId} survives a 24h absence from every healthy start (85–100)`, () => {
      for (const start of HEALTHY_BAND) {
        const pip = comeBackAfter(
          24 * HOUR_MS,
          { personalityId, needs: needsAt(start) },
          tuning,
        );
        for (const need of NEED_IDS) {
          expect(
            pip.needs[need],
            `${personalityId} ${need} from ${start}`,
          ).toBeGreaterThan(0);
        }
        expect(pip.activity).not.toBe(PipActivity.Sulking);
      }
    });

    it(`${personalityId} is nonetheless visibly neglected after 24h`, () => {
      const pip = comeBackAfter(
        24 * HOUR_MS,
        { personalityId, needs: needsAt(HEALTHY) },
        tuning,
      );
      expect(deriveMood(pip.needs, tuning.mood)).not.toBe("beaming");
      expect(deriveMood(pip.needs, tuning.mood)).not.toBe("content");
    });
  }

  it("lands EVERY shipped personality in the same neighbourhood as the neutral baseline", () => {
    // Round 2B (review finding): the headline [18, 35] band was pinned
    // only on the neutral pip, while the real sweep asserted merely "> 0"
    // and tolerated one personality below 10. The multipliers widen the
    // band — that is their job — but they must not leave it: 15 is the
    // Miserable line and 45 is still unmistakably Grumpy.
    for (const personalityId of PERSONALITY_IDS) {
      const pip = comeBackAfter(
        24 * HOUR_MS,
        { personalityId, needs: needsAt(HEALTHY) },
        tuning,
      );
      for (const need of NEED_IDS) {
        expect(pip.needs[need], `${personalityId} ${need}`).toBeGreaterThanOrEqual(15);
        expect(pip.needs[need], `${personalityId} ${need}`).toBeLessThanOrEqual(45);
      }
    }
  });

  it("nobody comes home Miserable from a healthy save — grumpy is the target, not despair", () => {
    for (const personalityId of PERSONALITY_IDS) {
      const pip = comeBackAfter(
        24 * HOUR_MS,
        { personalityId, needs: needsAt(HEALTHY) },
        tuning,
      );
      expect(
        deriveMood(pip.needs, tuning.mood),
        `${personalityId} after 24h`,
      ).toBe("grumpy");
    }
  });

  it("no personality multiplier is extreme enough to zero a bar inside one capped window", () => {
    const capHours = tuning.offlineRateCapMs / HOUR_MS;
    for (const personalityId of PERSONALITY_IDS) {
      const multipliers = tuning.personalityDecayMultipliers[personalityId];
      for (const need of NEED_IDS) {
        const drop =
          -tuning.needDecayPerHour[need] * multipliers[need] * capHours;
        expect(drop, `${personalityId}/${need} full-window drop`).toBeLessThan(
          85,
        );
      }
    }
  });
});

describe("Piplings are not dead weight (playtest round 2A amendment to spec §4.6)", () => {
  it("a Pipling is never WORSE off than an adult over the same absence", () => {
    expect(tuning.pipling.decayMultiplier).toBeLessThanOrEqual(1);

    const baby = comeBackAfter(24 * HOUR_MS, {
      lifeStage: LifeStage.Pipling,
      hatchedAt: SAVED_AT,
      ageMs: 0,
    });
    const adult = comeBackAfter(24 * HOUR_MS);

    for (const need of NEED_IDS) {
      expect(baby.needs[need]).toBeGreaterThanOrEqual(adult.needs[need]);
    }
  });

  it("grows up inside a single overnight absence — never a whole day of being useless", () => {
    expect(tuning.pipling.durationMs).toBeLessThanOrEqual(8 * HOUR_MS);

    const baby = comeBackAfter(8 * HOUR_MS, {
      lifeStage: LifeStage.Pipling,
      hatchedAt: SAVED_AT,
      ageMs: 0,
    });
    expect(baby.lifeStage).toBe(LifeStage.Adult);
  });

  it("hatches and grows up well inside one day, egg included", () => {
    expect(
      tuning.eggs.incubationMsDefault + tuning.pipling.durationMs,
    ).toBeLessThanOrEqual(12 * HOUR_MS);
  });

  it("spends its whole babyhood inside the rated window, so the cap never freezes a growth stage mid-way", () => {
    expect(tuning.pipling.durationMs).toBeLessThanOrEqual(
      tuning.offlineRateCapMs,
    );
  });
});

describe("Rest is a nap, not a shift — recovery is measured in minutes", () => {
  it("a Pip put down to Rest at Energy 20 is back at 100 within 15 minutes", () => {
    const clock = new FakeClock(SAVED_AT);
    clock.advance(15 * MINUTE_MS);
    const pip = makePip({
      activity: PipActivity.Resting,
      needs: { ...needsAt(HEALTHY), energy: 20 },
    });

    const { state, summary } = runCatchup(
      { pips: [pip] },
      SAVED_AT,
      clock.now(),
      neutralTuning,
    );

    expect(summary.events.map((event) => event.kind)).toContain("restAutoWake");
    expect(state.pips[0]!.activity).toBe(PipActivity.Idle);
  });

  it("a full 0 → 100 nap takes no more than 15 minutes of real time", () => {
    const fullNapMs =
      (100 / tuning.care.rest.energyPerHour) * HOUR_MS;
    expect(fullNapMs).toBeLessThanOrEqual(15 * MINUTE_MS);
    // ...but still long enough to be a thing you WATCH, not a button.
    expect(fullNapMs).toBeGreaterThanOrEqual(5 * MINUTE_MS);
  });

  it("refills the Energy a 24h absence drains, in about one Meadow trip", () => {
    const drained = 24 * HOUR_MS <= tuning.offlineRateCapMs
      ? 24
      : tuning.offlineRateCapMs / HOUR_MS;
    const lost = -tuning.needDecayPerHour.energy * drained;
    const napMs = (lost / tuning.care.rest.energyPerHour) * HOUR_MS;
    expect(napMs).toBeLessThanOrEqual(2 * tuning.expeditions.meadow.durationMs);
  });
});

describe("the shape of the curve (the levers, stated as invariants)", () => {
  it("every need decays at a similar rate — the bars fall together", () => {
    const rates = NEED_IDS.map((need) => -tuning.needDecayPerHour[need]);
    const fastest = Math.max(...rates);
    const slowest = Math.min(...rates);
    expect(fastest / slowest).toBeLessThanOrEqual(1.35);
  });

  it("a full capped window costs roughly 65 points — the number that puts a 90 save at ~25", () => {
    const capHours = tuning.offlineRateCapMs / HOUR_MS;
    for (const need of NEED_IDS) {
      const drop = -tuning.needDecayPerHour[need] * capHours;
      expect(drop, `${need} full-window drop`).toBeGreaterThanOrEqual(55);
      expect(drop, `${need} full-window drop`).toBeLessThanOrEqual(72);
    }
  });

  it("one care session out-restores one full absence, for every need and every personality (the leave-safe floor)", () => {
    // THE round 2B invariant. Read it as: whatever a day away takes off a
    // bar, the round the player does when they get home must put back
    // MORE — otherwise every cycle leaves the Pip a little lower than the
    // last and the Keep Sulks a few days later. Round 2A failed this on
    // Hunger (25 restored vs 69.9 lost) and Happiness (28 vs 76).
    for (const personalityId of PERSONALITY_IDS) {
      for (const need of NEED_IDS) {
        expect(
          sessionRestore(personalityId, need),
          `${personalityId}/${need}: one session restores less than one absence takes`,
        ).toBeGreaterThan(windowDrop(personalityId, need));
      }
    }
  });

  it("names the two care actions that have to carry it — Feed and Play/Pet SET nothing", () => {
    // Clean and Rest are set-to-100 actions, so they can never fail the
    // invariant above; the additive ones can, and did. Pinned so a future
    // "just nerf the food a bit" lands here first.
    const worstHunger = Math.max(
      ...PERSONALITY_IDS.map((id) => windowDrop(id, "hunger")),
    );
    const worstHappiness = Math.max(
      ...PERSONALITY_IDS.map((id) => windowDrop(id, "happiness")),
    );
    expect(2 * tuning.foods.berry.hunger).toBeGreaterThan(worstHunger);
    expect(tuning.foods.stew.hunger).toBeGreaterThan(worstHunger);
    expect(
      tuning.care.play.happiness + tuning.care.pet.happiness,
    ).toBeGreaterThan(
      Math.max(
        ...PERSONALITY_IDS.filter((id) => id !== "clingy").map((id) =>
          windowDrop(id, "happiness"),
        ),
      ),
    );
    expect(
      tuning.care.play.happiness + tuning.care.pet.clingyHappiness,
    ).toBeGreaterThan(worstHappiness);
    // A Clingy Pip loses the most Happiness and gets the biggest Pet —
    // the quirk has to pay for itself.
    expect(tuning.care.pet.clingyHappiness).toBeGreaterThan(
      tuning.care.pet.happiness,
    );
    expect(worstHappiness).toBe(windowDrop("clingy", "happiness"));
  });

  it("Energy is the slowest need to drain — a Pip is never too tired to be played with", () => {
    for (const need of NEED_IDS) {
      expect(-tuning.needDecayPerHour.energy).toBeLessThanOrEqual(
        -tuning.needDecayPerHour[need],
      );
    }
    // A 24h absence must leave enough Energy for even a Lazy Pip to Play.
    const pip = comeBackAfter(24 * HOUR_MS);
    expect(pip.needs.energy).toBeGreaterThanOrEqual(
      tuning.playRefusal.lazyMinEnergy,
    );
  });
});

describe("day 2 is not worse than day 1 — the loop closes (round 2B)", () => {
  /** Leave for a day, come home, do the round — `cycles` times over. */
  function liveFor(personalityId: PersonalityId, cycles: number): PipState[] {
    let state = keepWith(personalityId);
    const homecomings: PipState[] = [];
    for (let cycle = 0; cycle < cycles; cycle++) {
      state = leaveFor(state, 24 * HOUR_MS);
      homecomings.push(activePip(state));
      state = careSession(state).state;
    }
    return homecomings;
  }

  for (const personalityId of PERSONALITY_IDS) {
    it(`${personalityId}: three days of leave-care-leave never ratchets downward`, () => {
      const [day1, day2, day3] = liveFor(personalityId, 3) as [
        PipState,
        PipState,
        PipState,
      ];

      for (const pip of [day1, day2, day3]) {
        expect(pip.activity, `${personalityId} activity`).not.toBe(
          PipActivity.Sulking,
        );
        expect(pip.sulking, `${personalityId} sulking flag`).toBe(false);
        expect(lowestNeed(pip.needs), `${personalityId} lowest need`).toBeGreaterThan(0);
        expect(
          deriveMood(pip.needs, tuning.mood),
          `${personalityId} mood`,
        ).not.toBe("miserable");
      }

      // The actual regression: every later homecoming is at least as good
      // as the one before it, need by need. Round 2A's tuning failed this
      // on day 2 with five Pips Sulking and needs at exactly 0.
      for (const need of NEED_IDS) {
        expect(
          day2.needs[need],
          `${personalityId} ${need}: day 2 worse than day 1`,
        ).toBeGreaterThanOrEqual(day1.needs[need]);
        expect(
          day3.needs[need],
          `${personalityId} ${need}: day 3 worse than day 2`,
        ).toBeGreaterThanOrEqual(day2.needs[need]);
      }
    });
  }

  it("the round that does it is six taps and about one Meadow trip of waiting", () => {
    // The player-facing COST of "leave-safe" — the review measured the
    // round 2A equivalent at 8–13 taps, 3 berries and 13–15 minutes.
    for (const personalityId of PERSONALITY_IDS) {
      const home = leaveFor(keepWith(personalityId), 24 * HOUR_MS);
      const { taps } = careSession(home);
      // Exactly the canonical round, plus at most a Lazy whim retry.
      expect(taps, `${personalityId} taps`).toBeGreaterThanOrEqual(SESSION_TAPS);
      expect(taps, `${personalityId} taps`).toBeLessThanOrEqual(SESSION_TAPS + 2);
    }
    // Most of the wall clock is the nap, which runs while the player does
    // something else (sending another Pip out, tidying the Keep).
    expect(FULL_NAP_MS).toBeLessThanOrEqual(
      2 * tuning.expeditions.meadow.durationMs,
    );
  });

  it("leaves a cared-for Keep Beaming, not merely un-Sulking", () => {
    for (const personalityId of PERSONALITY_IDS) {
      let state = keepWith(personalityId);
      state = leaveFor(state, 24 * HOUR_MS);
      state = careSession(state).state;
      const pip = activePip(state);
      expect(
        deriveMood(pip.needs, tuning.mood),
        `${personalityId} after one care round`,
      ).toBe("beaming");
    }
  });

  it("the same loop over 8-hour absences stays Content — the twice-a-day player is never punished", () => {
    for (const personalityId of PERSONALITY_IDS) {
      let state = keepWith(personalityId);
      for (let cycle = 0; cycle < 4; cycle++) {
        state = leaveFor(state, 8 * HOUR_MS);
        state = careSession(state).state;
      }
      state = leaveFor(state, 8 * HOUR_MS);
      const pip = activePip(state);
      for (const need of NEED_IDS) {
        expect(pip.needs[need], `${personalityId} ${need}`).toBeGreaterThanOrEqual(50);
      }
      expect(pip.activity).not.toBe(PipActivity.Sulking);
    }
  });

  it("a Keep left just above the leave-safe floor survives the night with nothing floored", () => {
    // The floor is a promise about the WORST personality — leave every bar
    // a hair above it and NOTHING is on the floor a day later, whoever the
    // Pip turned out to be. (Leaving at exactly the floor lands the worst
    // pairing on 0 by construction; that is what "floor" means.)
    const floor = Math.max(
      ...PERSONALITY_IDS.flatMap((id) =>
        NEED_IDS.map((need) => windowDrop(id, need)),
      ),
    );
    for (const personalityId of PERSONALITY_IDS) {
      const pip = comeBackAfter(
        24 * HOUR_MS,
        { personalityId, needs: needsAt(floor + 1) },
        tuning,
      );
      for (const need of NEED_IDS) {
        expect(pip.needs[need], `${personalityId} ${need}`).toBeGreaterThan(0);
      }
      expect(pip.activity).not.toBe(PipActivity.Sulking);
    }
    // ...and the floor is REACHABLE: no bar has to be left fuller than a
    // bar can be, and the tightest per-pair margin is genuinely positive
    // (this is the number that goes negative when someone nerfs a food).
    expect(floor).toBeLessThan(100);
    const tightestMargin = Math.min(
      ...PERSONALITY_IDS.flatMap((id) =>
        NEED_IDS.map((need) => sessionRestore(id, need) - windowDrop(id, need)),
      ),
    );
    expect(tightestMargin).toBeGreaterThan(0);
  });
});
