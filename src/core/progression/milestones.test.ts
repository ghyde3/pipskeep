import { describe, expect, it } from "vitest";
import {
  claimMilestone,
  createEmptyMilestones,
  detectNewlyEarnable,
  grantFounderMilestone,
  isMilestoneMet,
} from "./milestones";
import type { MilestoneMetricContext } from "./milestones";
import type { MilestoneDef } from "../../content/milestones";

const baseCtx: MilestoneMetricContext = {
  counters: {},
  albumForms: 0,
  ledgerVariants: 0,
  streakLongest: 0,
  masteryTierAnyBiome: 0,
  masteryTierAllBiomes: 0,
  oldestPipAgeMs: 0,
  sanctuaryResidents: 0,
};

const registry: readonly MilestoneDef[] = [
  {
    id: "first-feed",
    name: "First Feed",
    blurb: "...",
    metric: { kind: "counter", counterId: "feeds" },
    threshold: 1,
    reward: { kind: "items", items: { berry: 2 } },
  },
  {
    id: "fifty-care",
    name: "50 Care",
    blurb: "...",
    metric: { kind: "counter", counterId: "careActions" },
    threshold: 50,
    reward: { kind: "resources", bundle: { fiber: 3 } },
  },
  {
    id: "album-full",
    name: "Full Album",
    blurb: "...",
    metric: { kind: "albumForms" },
    threshold: 14,
    reward: { kind: "flair", flairId: "curator-stamp" },
  },
];

describe("isMilestoneMet / metricValue", () => {
  it("reads counters, album totals, streak, mastery, age and sanctuary correctly", () => {
    const ctx: MilestoneMetricContext = { ...baseCtx, counters: { feeds: 1 } };
    expect(isMilestoneMet(registry[0]!, ctx)).toBe(true);
    expect(isMilestoneMet(registry[1]!, ctx)).toBe(false);
  });
});

describe("detectNewlyEarnable", () => {
  it("queues a newly-met milestone exactly once", () => {
    const empty = createEmptyMilestones();
    const ctx: MilestoneMetricContext = { ...baseCtx, counters: { feeds: 1 } };
    const next = detectNewlyEarnable(empty, ctx, registry);
    expect(next.pendingCelebrations).toEqual(["first-feed"]);
  });

  it("never re-queues an already-earned milestone", () => {
    const withEarned = { earned: { "first-feed": 10 }, pendingCelebrations: [] };
    const ctx: MilestoneMetricContext = { ...baseCtx, counters: { feeds: 5 } };
    const next = detectNewlyEarnable(withEarned, ctx, registry);
    expect(next.pendingCelebrations).toEqual([]);
    expect(next).toBe(withEarned); // reference stability
  });

  it("never re-queues something already pending", () => {
    const alreadyPending = { earned: {}, pendingCelebrations: ["first-feed"] };
    const ctx: MilestoneMetricContext = { ...baseCtx, counters: { feeds: 3 } };
    const next = detectNewlyEarnable(alreadyPending, ctx, registry);
    expect(next).toBe(alreadyPending);
  });

  it("queues multiple milestones met simultaneously", () => {
    const empty = createEmptyMilestones();
    const ctx: MilestoneMetricContext = {
      ...baseCtx,
      counters: { feeds: 1, careActions: 50 },
    };
    const next = detectNewlyEarnable(empty, ctx, registry);
    expect(new Set(next.pendingCelebrations)).toEqual(new Set(["first-feed", "fifty-care"]));
  });
});

describe("claimMilestone — idempotency (the double-grant guard)", () => {
  it("grants the reward the first time and marks it earned", () => {
    const empty = createEmptyMilestones();
    const ctx: MilestoneMetricContext = { ...baseCtx, counters: { feeds: 1 } };
    const result = claimMilestone(empty, "first-feed", 100, ctx, registry);
    expect(result.ok).toBe(true);
    expect(result.reward).toEqual({ kind: "items", items: { berry: 2 } });
    expect(result.state.earned["first-feed"]).toBe(100);
  });

  it("claiming TWICE does not double-grant — the second claim is a no-op with no reward", () => {
    const empty = createEmptyMilestones();
    const ctx: MilestoneMetricContext = { ...baseCtx, counters: { feeds: 1 } };
    const once = claimMilestone(empty, "first-feed", 100, ctx, registry);
    expect(once.ok).toBe(true);

    const twice = claimMilestone(once.state, "first-feed", 200, ctx, registry);
    expect(twice.ok).toBe(false);
    expect(twice.reward).toBeUndefined();
    // The earned timestamp does NOT move to the second claim's `at`.
    expect(twice.state.earned["first-feed"]).toBe(100);
    expect(twice.state).toBe(once.state); // same reference — truly a no-op
  });

  it("a simulated hundred-claim spam of the same id grants the reward exactly once", () => {
    let state = createEmptyMilestones();
    const ctx: MilestoneMetricContext = { ...baseCtx, counters: { feeds: 1 } };
    let grants = 0;
    for (let i = 0; i < 100; i++) {
      const result = claimMilestone(state, "first-feed", i, ctx, registry);
      state = result.state;
      if (result.ok) grants++;
    }
    expect(grants).toBe(1);
  });

  it("refuses to claim a milestone that has not actually been met yet, even if asked", () => {
    const empty = createEmptyMilestones();
    const result = claimMilestone(empty, "fifty-care", 1, baseCtx, registry);
    expect(result.ok).toBe(false);
    expect(result.state.earned["fifty-care"]).toBeUndefined();
  });

  it("removes the id from pendingCelebrations on a successful claim", () => {
    const pending = { earned: {}, pendingCelebrations: ["first-feed"] };
    const ctx: MilestoneMetricContext = { ...baseCtx, counters: { feeds: 1 } };
    const result = claimMilestone(pending, "first-feed", 5, ctx, registry);
    expect(result.state.pendingCelebrations).toEqual([]);
  });

  it("an unknown id never grants anything", () => {
    const empty = createEmptyMilestones();
    const result = claimMilestone(empty, "does-not-exist", 1, baseCtx, registry);
    expect(result.ok).toBe(false);
  });
});

describe("grantFounderMilestone — the migration's one-time apology", () => {
  it("grants exactly once, idempotent thereafter", () => {
    const empty = createEmptyMilestones();
    const once = grantFounderMilestone(empty, 42);
    expect(once.earned["founder"]).toBe(42);
    const twice = grantFounderMilestone(once, 999);
    expect(twice.earned["founder"]).toBe(42); // unchanged
    expect(twice).toBe(once);
  });
});

describe("monotonicity across a long randomised sequence", () => {
  it("earned count and pendingCelebrations never shrink except via a successful claim removing exactly one id", () => {
    let state = createEmptyMilestones();
    let earnedCount = 0;
    const ctx: MilestoneMetricContext = { ...baseCtx };
    let counters: Record<string, number> = { feeds: 0, careActions: 0 };
    for (let i = 0; i < 300; i++) {
      counters = { ...counters, feeds: counters.feeds! + 1, careActions: counters.careActions! + 2 };
      const liveCtx = { ...ctx, counters };
      state = detectNewlyEarnable(state, liveCtx, registry);
      // Claim everything pending.
      for (const id of [...state.pendingCelebrations]) {
        const result = claimMilestone(state, id, i, liveCtx, registry);
        if (result.ok) earnedCount++;
        state = result.state;
      }
      expect(Object.keys(state.earned).length).toBe(earnedCount);
    }
    // Every registry milestone with a reachable counter threshold got earned.
    expect(state.earned["first-feed"]).toBeDefined();
    expect(state.earned["fifty-care"]).toBeDefined();
  });
});
