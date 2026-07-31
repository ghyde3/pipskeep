/**
 * Phase 5 diff tests — the PURE `diffPhase5(prev, next)` effect list:
 * level-up / Cozy Bunks / evolution celebrations (toast + confetti +
 * sound seams), job-outcome toasts (structural blocks toast, the sulking
 * refusal stays with the focus view), and BATCHED gathering production
 * pops that stay quiet when a catch-up summary tells the story instead
 * (spec §4.5). DOM wiring untested chrome, as ever.
 */

import { describe, expect, it } from "vitest";
import { MINUTE_MS } from "../content/tuning";
import { LifeStage, PipActivity } from "../core/pips/types";
import type { PipNeeds, PipState } from "../core/pips/types";
import type { GameState } from "../core/state";
import type { CatchupSummary } from "../core/pips/catchup";
import {
  JOB_BLOCK_COPY,
  diffJobProduction,
  diffPhase5,
  formatGains,
} from "./phase5";

const needs = (): PipNeeds => ({
  hunger: 80,
  cleanliness: 80,
  happiness: 80,
  energy: 80,
});

function makePip(overrides: Partial<PipState> = {}): PipState {
  return {
    id: "pip-1",
    speciesId: "mosspip",
    name: "Mosspip",
    genome: {
      speciesId: "mosspip",
      palette: "fern",
      pattern: "plain",
      personalityId: "curious",
      shiny: false,
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
    evolved: null,
    lastGiftItemId: null,
    expedition: null,
    needsUpdatedAt: 0,
    ...overrides,
  };
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  const pip = makePip();
  return {
    pips: { [pip.id]: pip },
    rosterOrder: [pip.id],
    activePipId: pip.id,
    inventory: {},
    resources: {},
    rngState: {},
    seed: 42,
    keep: { level: 1, placements: {} },
    jobs: {},
    rosterUpgradePurchased: false,
    eggs: [],
    pendingReveals: [],
    nextPipNumber: 2,
    nextEggNumber: 1,
    nextPlacementNumber: 1,
    cooldowns: {},
    lastLineIndex: {},
    createdAt: 0,
    lastTickAt: 0,
    lastCareOutcome: null,
    lastCatchup: null,
    lastAssignOutcome: null,
    lastHatchOutcome: null,
    lastJobOutcome: null,
    lastEvolveOutcome: null,
    onboarding: { completed: true, step: "done" },
    pipdex: {
      entries: {},
      discoveryOrder: [],
      formsSeen: 0,
      formsCaught: 0,
      variantsCaught: 0,
      shiniesCaught: 0,
      unreadEntryIds: [],
    },
    sanctuary: { pips: {}, order: [] },
    lastSanctuaryOutcome: null,
    // ROUND 2C — progression stack defaults (docs/retention-bible.md).
    streak: {
      current: 0,
      longest: 0,
      lastVisitDay: null,
      totalVisitDays: 0,
      graceBanked: 2,
      graceRefilledOnDay: null,
      rainDays: 0,
      rewardedForDay: null,
      pendingChoices: [],
    },
    dayOffsetMs: 0,
    counters: {},
    milestones: { earned: {}, pendingCelebrations: [] },
    bounties: { day: null, slots: [], rerollsUsed: 0, dayBonusGranted: false },
    eggPity: {},
    activeEvents: [],
    keepsakes: {},
    flair: {},
    keepXp: 0,
    lastLevelUp: null,
    ...overrides,
  };
}

const noSummary: CatchupSummary = {
  elapsedMs: 0,
  ratedMs: 0,
  events: [],
  perPip: {},
} as unknown as CatchupSummary;

describe("diffPhase5 — celebrations", () => {
  // ROUND 2F: the tier-up celebration moved to `ui/levelUp.ts`'s banner
  // (which names the tier, lists its unlocks from content, and fires its
  // own confetti + sound). This module must now stay SILENT on a level-up,
  // or every purchase announces itself twice — that regression is exactly
  // what this test guards.
  it("a Keep level-up is silent here — ui/levelUp.ts owns that celebration", () => {
    const prev = makeState();
    const next = makeState({ keep: { level: 2, placements: {} } });
    const effects = diffPhase5(prev, next);
    expect(effects.toasts).toHaveLength(0);
    expect(effects.confettiBursts).toBe(0);
    expect(effects.sounds).not.toContain("keep.levelup");
  });

  it("Cozy Bunks landing celebrates once", () => {
    const prev = makeState();
    const next = makeState({ rosterUpgradePurchased: true });
    const effects = diffPhase5(prev, next);
    expect(effects.toasts.some((t) => t.message.includes("Cozy Bunks"))).toBe(true);
    expect(effects.confettiBursts).toBe(1);
  });

  it("an ok evolution names the pip and the new species", () => {
    const prev = makeState();
    const next = makeState({
      lastEvolveOutcome: {
        ok: true,
        pipId: "pip-1",
        at: 1,
        fromSpeciesId: "mosspip",
        toSpeciesId: "grovepip",
        variantId: "verdant",
      },
    });
    const effects = diffPhase5(prev, next);
    const toast = effects.toasts.find((t) => t.message.includes("Grovepip"));
    expect(toast?.message).toContain("Mosspip");
    expect(effects.confettiBursts).toBe(1);
    expect(effects.sounds).toContain("pip.evolve");
  });

  it("a quiet transition produces zero effects", () => {
    const state = makeState();
    const effects = diffPhase5(state, state);
    expect(effects.toasts).toHaveLength(0);
    expect(effects.confettiBursts).toBe(0);
    expect(effects.sounds).toHaveLength(0);
  });
});

describe("diffPhase5 — job outcomes (spec §6.2)", () => {
  it("a successful assign toasts the cadence", () => {
    const prev = makeState();
    const next = makeState({
      lastJobOutcome: {
        action: "assignJob",
        ok: true,
        pipId: "pip-1",
        jobId: "gathering",
        stationPlacementId: "place-1",
        at: 1,
      },
    });
    const toast = diffPhase5(prev, next).toasts[0];
    expect(toast?.message).toContain("Mosspip is on gathering duty");
    expect(toast?.message).toContain("10 min");
  });

  it("structural blocks toast their copy; the sulking line does not", () => {
    const prev = makeState();
    const blocked = makeState({
      lastJobOutcome: {
        action: "assignJob",
        ok: false,
        pipId: "pip-1",
        stationPlacementId: "place-1",
        at: 1,
        reason: "occupied",
      },
    });
    expect(diffPhase5(prev, blocked).toasts[0]?.message).toBe(
      JOB_BLOCK_COPY["occupied"],
    );

    const sulky = makeState({
      lastJobOutcome: {
        action: "assignJob",
        ok: false,
        pipId: "pip-1",
        stationPlacementId: "place-1",
        at: 1,
        reason: "sulking",
        line: "No. Comfy here.",
      },
    });
    // The focus view voices this one in-panel — no toast.
    expect(diffPhase5(prev, sulky).toasts).toHaveLength(0);
  });
});

describe("diffJobProduction — batched pops, catch-up stays quiet", () => {
  const job = (lastProducedAt: number) => ({
    jobId: "gathering",
    stationPlacementId: "place-1",
    assignedAt: 0,
    lastProducedAt,
  });

  it("an advanced lastProducedAt batches gains from BOTH pools (berries are inventory)", () => {
    const prev = makeState({
      jobs: { "pip-1": job(0) },
      inventory: { berry: 1 },
    });
    const next = makeState({
      jobs: { "pip-1": job(20 * MINUTE_MS) },
      inventory: { berry: 2 },
      resources: { fiber: 1 },
    });
    expect(diffJobProduction(prev, next)).toEqual({ berry: 1, fiber: 1 });
    const effects = diffPhase5(prev, next);
    expect(effects.toasts[0]?.message).toBe(
      "Fresh from the Gathering Station: Berry ×1, Fiber ×1.",
    );
    expect(effects.sounds).toContain("job.produce");
  });

  it("resource gains WITHOUT a production tick never toast (loot, grants)", () => {
    const prev = makeState({ resources: {} });
    const next = makeState({ resources: { wood: 5 } });
    expect(diffJobProduction(prev, next)).toBeNull();
  });

  it("a fresh catch-up summary suppresses the pop — the away sheet tells it", () => {
    const prev = makeState({ jobs: { "pip-1": job(0) }, resources: {} });
    const next = makeState({
      jobs: { "pip-1": job(60 * MINUTE_MS) },
      inventory: { berry: 6 },
      lastCatchup: noSummary,
    });
    expect(diffJobProduction(prev, next)).toBeNull();
    expect(
      diffPhase5(prev, next).toasts.filter((t) =>
        t.message.startsWith("Fresh from"),
      ),
    ).toHaveLength(0);
  });

  it("formatGains speaks satchel-chip language", () => {
    expect(formatGains({ berry: 2, fiber: 1 })).toBe("Berry ×2, Fiber ×1");
  });
});
