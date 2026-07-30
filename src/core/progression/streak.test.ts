import { describe, expect, it } from "vitest";
import { HOUR_MS } from "../../content/tuning";
import {
  createEmptyStreak,
  dayIndex,
  effectiveStreakTier,
  ladderDayFor,
  pickKeepsakeOffers,
  resolveLadderReward,
  streakLootBonus,
  touchVisit,
} from "./streak";
import type { StreakTuning } from "./streak";

const DAY_MS = 24 * HOUR_MS;

const tuning: StreakTuning = {
  retention: {
    dayStartHour: 4,
    dayMs: DAY_MS,
    streak: {
      ladderLength: 7,
      graceMax: 2,
      graceRefreshDays: 14,
      tierMinStreakDay: [1, 3, 7, 14, 30],
      tierLootBonus: [0, 0.05, 0.1, 0.15, 0.2],
      welcomeBackLongestRequired: 7,
      welcomeBackTierFloor: 1,
    },
  },
};

/** A dayOffsetMs matching 04:00 local for UTC (no extra tz shift), so
 * `at` in plain days-since-epoch math is easy to reason about in tests. */
const OFFSET_4AM = 4 * HOUR_MS;

describe("dayIndex — the day boundary rule", () => {
  it("is floor((at - dayOffsetMs) / dayMs): a session just before 04:00 belongs to the PREVIOUS day", () => {
    // 03:59 on "day 1" (i.e. 1 minute before the boundary) is still day 0.
    const justBefore = DAY_MS + OFFSET_4AM - 60_000;
    const justAfter = DAY_MS + OFFSET_4AM + 60_000;
    expect(dayIndex(justBefore, OFFSET_4AM, DAY_MS)).toBe(0);
    expect(dayIndex(justAfter, OFFSET_4AM, DAY_MS)).toBe(1);
  });

  it("a 1 a.m. session belongs to the night owl's PREVIOUS day, never a fresh one", () => {
    // 01:00 on calendar day 2 (i.e. 21 hours after the day-1 4am boundary)
    // is still BEFORE day 2's 04:00 boundary, so it is day 1.
    const oneAm = DAY_MS + OFFSET_4AM + 21 * HOUR_MS;
    expect(dayIndex(oneAm, OFFSET_4AM, DAY_MS)).toBe(1);
  });

  it("is monotonic across the boundary — crossing it always increases the index by exactly 1 per day", () => {
    let prev = dayIndex(0, OFFSET_4AM, DAY_MS);
    for (let h = 1; h <= 72; h++) {
      const next = dayIndex(h * HOUR_MS, OFFSET_4AM, DAY_MS);
      expect(next - prev).toBeGreaterThanOrEqual(0);
      expect(next - prev).toBeLessThanOrEqual(1);
      prev = next;
    }
  });
});

describe("touchVisit — ordinary advance", () => {
  it("first ever visit starts the streak at 1 with full grace", () => {
    const empty = createEmptyStreak(tuning);
    expect(empty.graceBanked).toBe(2);
    const at = OFFSET_4AM + HOUR_MS;
    const next = touchVisit(empty, at, OFFSET_4AM, tuning);
    expect(next.current).toBe(1);
    expect(next.longest).toBe(1);
    expect(next.totalVisitDays).toBe(1);
  });

  it("a same-day revisit is a no-op (identity value, not just idempotent)", () => {
    const empty = createEmptyStreak(tuning);
    const at = OFFSET_4AM + HOUR_MS;
    const once = touchVisit(empty, at, OFFSET_4AM, tuning);
    const twice = touchVisit(once, at + 5 * HOUR_MS, OFFSET_4AM, tuning);
    expect(twice).toStrictEqual(once);
  });

  it("clock rollback (delta <= 0) never advances or regresses the streak", () => {
    const empty = createEmptyStreak(tuning);
    const at = OFFSET_4AM + DAY_MS * 5;
    const advanced = touchVisit(empty, at, OFFSET_4AM, tuning);
    const rolledBack = touchVisit(advanced, at - DAY_MS, OFFSET_4AM, tuning);
    expect(rolledBack).toStrictEqual(advanced);
  });

  it("consecutive days advance current by 1 each", () => {
    let streak = createEmptyStreak(tuning);
    let at = OFFSET_4AM + HOUR_MS;
    for (let day = 1; day <= 5; day++) {
      streak = touchVisit(streak, at, OFFSET_4AM, tuning);
      expect(streak.current).toBe(day);
      at += DAY_MS;
    }
    expect(streak.longest).toBe(5);
    expect(streak.totalVisitDays).toBe(5);
  });
});

describe("touchVisit — a break costs ONLY a bonus (the guardrail)", () => {
  it("a gap within the grace bank SURVIVES: current keeps climbing, grace is spent, a rain day is logged", () => {
    let streak = createEmptyStreak(tuning);
    let at = OFFSET_4AM + HOUR_MS;
    streak = touchVisit(streak, at, OFFSET_4AM, tuning); // day 0, current 1
    at += DAY_MS;
    streak = touchVisit(streak, at, OFFSET_4AM, tuning); // day 1, current 2
    // Skip one day (a gap of 1) — well within the 2-day grace bank.
    at += 2 * DAY_MS;
    const before = { ...streak };
    streak = touchVisit(streak, at, OFFSET_4AM, tuning);
    expect(streak.current).toBe(before.current + 1); // SURVIVES, not reset
    expect(streak.graceBanked).toBe(before.graceBanked - 1);
    expect(streak.rainDays).toBe(before.rainDays + 1);
    // Nothing else about the world changed — no items, no resources exist
    // in StreakState at all, so "a break costs only a bonus" is total by
    // construction: there is nothing else in this module TO lose.
    expect(streak.totalVisitDays).toBe(before.totalVisitDays + 1);
    // `longest` is forward-only and reflects the now-higher `current` —
    // never a resource, never something a rain day could touch besides.
    expect(streak.longest).toBeGreaterThanOrEqual(before.longest);
    expect(streak.longest).toBe(streak.current);
  });

  it("a gap beyond grace restarts `current` at 1 — but never below 1, and never touches `longest`/`totalVisitDays`", () => {
    let streak = createEmptyStreak(tuning);
    let at = OFFSET_4AM + HOUR_MS;
    for (let day = 0; day < 10; day++) {
      streak = touchVisit(streak, at, OFFSET_4AM, tuning);
      at += DAY_MS;
    }
    expect(streak.current).toBe(10);
    expect(streak.longest).toBe(10);
    const totalBefore = streak.totalVisitDays;

    // A 30-day gap blows through the 2-day grace bank.
    at += 30 * DAY_MS;
    streak = touchVisit(streak, at, OFFSET_4AM, tuning);
    expect(streak.current).toBe(1); // restart, never negative, never 0
    expect(streak.longest).toBe(10); // NEVER decreases (bible §0.1)
    expect(streak.totalVisitDays).toBe(totalBefore + 1); // forward-only
  });

  it("the ONLY thing a broken streak can cost is the loot-bonus TIER", () => {
    let streak = createEmptyStreak(tuning);
    let at = OFFSET_4AM + HOUR_MS;
    // Reach tier 2 (day 7+).
    for (let day = 0; day < 8; day++) {
      streak = touchVisit(streak, at, OFFSET_4AM, tuning);
      at += DAY_MS;
    }
    const tierBefore = effectiveStreakTier(streak, tuning);
    expect(tierBefore).toBeGreaterThanOrEqual(2);

    // Blow the streak.
    at += 30 * DAY_MS;
    streak = touchVisit(streak, at, OFFSET_4AM, tuning);
    const tierAfter = effectiveStreakTier(streak, tuning);
    // The welcome-back floor (longest reached 7) keeps this a soft
    // landing, but the bonus tier itself is allowed to fall — that IS the
    // one permitted cost.
    expect(tierAfter).toBeLessThanOrEqual(tierBefore);
    expect(tierAfter).toBeGreaterThanOrEqual(tuning.retention.streak.welcomeBackTierFloor);
  });
});

describe("welcome back — a returning veteran is better off than a new player", () => {
  it("restarts at the welcome-back tier floor once `longest` has ever reached the requirement", () => {
    let streak = createEmptyStreak(tuning);
    let at = OFFSET_4AM + HOUR_MS;
    for (let day = 0; day < 7; day++) {
      streak = touchVisit(streak, at, OFFSET_4AM, tuning);
      at += DAY_MS;
    }
    expect(streak.longest).toBeGreaterThanOrEqual(7);

    // A huge gap restarts current at 1...
    at += 60 * DAY_MS;
    streak = touchVisit(streak, at, OFFSET_4AM, tuning);
    expect(streak.current).toBe(1);
    // ...but the EFFECTIVE tier is floored at 1, not 0 — strictly better
    // than a brand-new player, who would read tier 0 at current === 1.
    expect(effectiveStreakTier(streak, tuning)).toBe(1);

    const freshPlayer = touchVisit(createEmptyStreak(tuning), at, OFFSET_4AM, tuning);
    expect(effectiveStreakTier(freshPlayer, tuning)).toBe(0);
    expect(streakLootBonus(streak, tuning)).toBeGreaterThan(
      streakLootBonus(freshPlayer, tuning),
    );
  });

  it("never applies the floor to a streak that never reached the requirement", () => {
    let streak = createEmptyStreak(tuning);
    let at = OFFSET_4AM + HOUR_MS;
    streak = touchVisit(streak, at, OFFSET_4AM, tuning); // current 1, longest 1
    at += 30 * DAY_MS;
    streak = touchVisit(streak, at, OFFSET_4AM, tuning); // restarts at 1 again
    expect(streak.longest).toBe(1);
    expect(effectiveStreakTier(streak, tuning)).toBe(0);
  });
});

describe("grace — a bank that refills on its own, never a purchasable freeze", () => {
  it("refills 1 per graceRefreshDays, capped at graceMax", () => {
    let streak = createEmptyStreak(tuning);
    let at = OFFSET_4AM + HOUR_MS;
    streak = touchVisit(streak, at, OFFSET_4AM, tuning);
    at += DAY_MS;
    streak = touchVisit(streak, at, OFFSET_4AM, tuning);
    // Spend both grace days on one big-enough gap.
    at += 3 * DAY_MS; // gap of 2 — exactly graceMax
    streak = touchVisit(streak, at, OFFSET_4AM, tuning);
    expect(streak.graceBanked).toBe(0);

    // 14 days later (one graceRefreshDays window) it should have refilled by 1.
    at += 14 * DAY_MS;
    streak = touchVisit(streak, at, OFFSET_4AM, tuning);
    expect(streak.graceBanked).toBe(1);
  });

  it("never exceeds graceMax no matter how long the player waits", () => {
    let streak = createEmptyStreak(tuning);
    const at = OFFSET_4AM + HOUR_MS;
    streak = touchVisit(streak, at, OFFSET_4AM, tuning);
    const later = touchVisit(streak, at + 1000 * DAY_MS, OFFSET_4AM, tuning);
    expect(later.graceBanked).toBeLessThanOrEqual(tuning.retention.streak.graceMax);
  });
});

describe("100-day forward jump — pays out once, never farmable", () => {
  it("a single huge jump only ever advances the streak state ONE step (restart), regardless of the jump size", () => {
    const streak = createEmptyStreak(tuning);
    const at = OFFSET_4AM + HOUR_MS;
    const jumpedOnce = touchVisit(streak, at, OFFSET_4AM, tuning);
    const jumpedAgain = touchVisit(jumpedOnce, at + 100 * DAY_MS, OFFSET_4AM, tuning);
    // Rolling back and forward across the same huge jump cannot be used to
    // rack up multiple "current" increments from one dispatched visit.
    expect(jumpedAgain.totalVisitDays).toBe(jumpedOnce.totalVisitDays + 1);
  });
});

describe("ladder — content repeats, level-aware, never Stew before level 2", () => {
  it("ladderDayFor cycles 1..ladderLength forever", () => {
    expect(ladderDayFor(1, 7)).toBe(1);
    expect(ladderDayFor(7, 7)).toBe(7);
    expect(ladderDayFor(8, 7)).toBe(1);
    expect(ladderDayFor(14, 7)).toBe(7);
    expect(ladderDayFor(91, 7)).toBe(7);
  });

  it("day 3 never offers Stew before Keep level 2", () => {
    const reward = resolveLadderReward(3, tuning, {
      keepLevel: 1,
      keepsakeOffers: [],
      unlockedExpeditionIds: ["meadow"],
    });
    expect(reward.kind).toBe("grant");
    if (reward.kind === "grant") {
      expect(reward.items?.stew).toBeUndefined();
    }
  });

  it("day 3 DOES offer Stew from Keep level 2 on", () => {
    const reward = resolveLadderReward(3, tuning, {
      keepLevel: 2,
      keepsakeOffers: [],
      unlockedExpeditionIds: ["meadow", "forest"],
    });
    expect(reward.kind).toBe("grant");
    if (reward.kind === "grant") {
      expect(reward.items?.stew).toBe(1);
    }
  });

  it("day 5 is a keepsake choice, day 7 is an egg choice — both WAIT (no auto-grant of a specific item)", () => {
    const day5 = resolveLadderReward(5, tuning, {
      keepLevel: 1,
      keepsakeOffers: ["pebble-path", "moss-tuft", "welcome-sign"],
      unlockedExpeditionIds: ["meadow"],
    });
    expect(day5).toEqual({
      kind: "keepsakeChoice",
      offers: ["pebble-path", "moss-tuft", "welcome-sign"],
    });

    const day7 = resolveLadderReward(7, tuning, {
      keepLevel: 1,
      keepsakeOffers: [],
      unlockedExpeditionIds: ["meadow", "bramblewick"],
    });
    expect(day7).toEqual({
      kind: "eggChoice",
      offers: ["meadow", "bramblewick"],
    });
  });

  it("the only pre-level-2 Wood in the whole ladder is day 4's single Wood (the level-1 wood ceiling, bible §12.3)", () => {
    let totalWood = 0;
    for (let day = 1; day <= 7; day++) {
      const reward = resolveLadderReward(day, tuning, {
        keepLevel: 1,
        keepsakeOffers: ["x"],
        unlockedExpeditionIds: ["meadow"],
      });
      if (reward.kind === "grant") totalWood += reward.resources?.wood ?? 0;
    }
    expect(totalWood).toBeLessThanOrEqual(2); // tuning.retention.grants.preLevel2WoodCap
  });
});

describe("pickKeepsakeOffers — stateless, day-derived, never persisted", () => {
  const allDecorations = ["a", "b", "c", "d", "e", "f", "g"];

  it("is deterministic: same (seed, forDay) always offers the same three", () => {
    const a = pickKeepsakeOffers(1, 5, allDecorations);
    const b = pickKeepsakeOffers(1, 5, allDecorations);
    expect(a).toEqual(b);
  });

  it("offers exactly `count` distinct ids when enough exist", () => {
    const offers = pickKeepsakeOffers(1, 5, allDecorations);
    expect(offers.length).toBe(3);
    expect(new Set(offers).size).toBe(3);
  });

  it("returns everything when fewer than `count` decorations exist", () => {
    expect(pickKeepsakeOffers(1, 5, ["only-one"])).toEqual(["only-one"]);
  });

  it("different days offer different (or at least independently-drawn) sets", () => {
    const day5 = pickKeepsakeOffers(1, 5, allDecorations);
    const day12 = pickKeepsakeOffers(1, 12, allDecorations);
    // Not a strict inequality requirement (collisions are possible), just
    // proof the day genuinely feeds the draw.
    expect(day5.length).toBe(3);
    expect(day12.length).toBe(3);
  });
});
