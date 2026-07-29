/**
 * Focus-view controller tests (spec §10 Pip focus view) — the PURE model
 * layer only: expedition row derivation (unlock gating copy, one-pip-per-
 * expedition, live countdown, Sulking/Pipling stay sendable so core gets
 * to voice the refusal), duration/countdown formatting, and the
 * personality blurb roster. The DOM shell is untested chrome around this
 * (same pattern as debugMenu.test.ts).
 */

import { describe, expect, it } from "vitest";
import { MINUTE_MS, tuning } from "../content/tuning";
import { PERSONALITY_IDS } from "../content/personalities";
import { LifeStage, PipActivity } from "../core/pips/types";
import type { PipNeeds, PipState } from "../core/pips/types";
import type { GameState } from "../core/state";
import { adultAt } from "../core/pips/lifecycle";
import {
  PERSONALITY_BLURBS,
  buildExpeditionRow,
  buildFocusModel,
  formatCountdown,
  formatDurationShort,
  formatGrowUpCountdown,
  lifeStageLabel,
  personalityBlurb,
} from "./focusView";

const needs = (overrides: Partial<PipNeeds> = {}): PipNeeds => ({
  hunger: 80,
  cleanliness: 80,
  happiness: 80,
  energy: 80,
  ...overrides,
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
      accessorySlots: 1,
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

function makeState(
  overrides: Partial<GameState> & { pip?: PipState } = {},
): GameState {
  const pip = overrides.pip ?? makePip();
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
    ...overrides,
  };
}

const row = (state: GameState, expeditionId: string, now = 0) => {
  const pip = state.pips[state.activePipId];
  if (pip === undefined) throw new Error("active pip missing");
  const built = buildExpeditionRow(state, pip, expeditionId, now);
  if (built === null) throw new Error(`${expeditionId} missing from registry`);
  return built;
};

describe("personality blurbs — spec §15.5 tone copy", () => {
  it("covers every launch personality with a non-empty one-liner", () => {
    for (const id of PERSONALITY_IDS) {
      expect(PERSONALITY_BLURBS[id], id).toBeTypeOf("string");
      expect((PERSONALITY_BLURBS[id] as string).length).toBeGreaterThan(10);
    }
  });

  it("unknown personalities fall back instead of crashing", () => {
    expect(personalityBlurb("moody")).toBeTypeOf("string");
  });
});

describe("formatDurationShort / formatCountdown", () => {
  it("renders minutes and hour+minute durations", () => {
    expect(formatDurationShort(5 * MINUTE_MS)).toBe("5 min");
    expect(formatDurationShort(30 * MINUTE_MS)).toBe("30 min");
    expect(formatDurationShort(60 * MINUTE_MS)).toBe("1 h");
    expect(formatDurationShort(90 * MINUTE_MS)).toBe("1 h 30 min");
  });

  it("counts down m:ss, rolls into h:mm:ss, clamps at 0:00", () => {
    expect(formatCountdown(272_000)).toBe("4:32");
    expect(formatCountdown(3_849_000)).toBe("1:04:09");
    expect(formatCountdown(999)).toBe("0:01");
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(-5_000)).toBe("0:00");
  });
});

describe("buildExpeditionRow — unlock gating (spec §6.1/§9)", () => {
  it("at Keep level 1: meadow sendable, forest/shore locked with friendly level copy", () => {
    const state = makeState();
    expect(row(state, "meadow").status).toBe("available");
    expect(row(state, "meadow").sendable).toBe(true);

    const forest = row(state, "forest");
    expect(forest.status).toBe("locked");
    expect(forest.sendable).toBe(false);
    expect(forest.note).toContain("Keep level 2");

    expect(row(state, "shore").note).toContain("Keep level 3");
  });

  it("Keep level 3 unlocks everything", () => {
    const state = makeState({ keep: { level: 3, placements: {} } });
    for (const id of ["meadow", "forest", "shore"]) {
      expect(row(state, id).status, id).toBe("available");
    }
  });

  it("duration label reflects Hardworking's −15% (spec §4.2)", () => {
    const base = makeState();
    expect(row(base, "shore").durationLabel).toBe("30 min");

    const hardworking = makePip({ personalityId: "hardworking" });
    const state = makeState({ pip: hardworking });
    const expected = formatDurationShort(
      30 * MINUTE_MS * tuning.quirks.hardworkingExpeditionDurationMultiplier,
    );
    expect(row(state, "shore").durationLabel).toBe(expected);
    expect(expected).not.toBe("30 min");
  });
});

describe("buildExpeditionRow — occupancy and away states (spec §6.1)", () => {
  it("another pip out on the trail marks it occupied, with the occupant named", () => {
    const other = makePip({
      id: "pip-2",
      name: "Fernpip",
      activity: PipActivity.OnExpedition,
      expedition: { expeditionId: "meadow", departedAt: 0, durationMs: 1000 },
    });
    const me = makePip();
    const state = makeState({
      pips: { [me.id]: me, [other.id]: other },
      rosterOrder: [me.id, other.id],
    });
    const meadow = row(state, "meadow");
    expect(meadow.status).toBe("occupied");
    expect(meadow.sendable).toBe(false);
    expect(meadow.note).toContain("Fernpip");
  });

  it("a Returning pip with uncollected loot still occupies its expedition", () => {
    const other = makePip({
      id: "pip-2",
      name: "Fernpip",
      activity: PipActivity.Returning,
      expedition: { expeditionId: "meadow", departedAt: 0, durationMs: 1000 },
    });
    const me = makePip();
    const state = makeState({
      pips: { [me.id]: me, [other.id]: other },
      rosterOrder: [me.id, other.id],
    });
    expect(row(state, "meadow").status).toBe("occupied");
  });

  it("the pip's own active expedition shows a live derived countdown", () => {
    const departedAt = 100_000;
    const durationMs = 5 * MINUTE_MS;
    const pip = makePip({
      activity: PipActivity.OnExpedition,
      expedition: { expeditionId: "meadow", departedAt, durationMs },
    });
    const state = makeState({ pip });

    // 4:32 left: now = departedAt + duration − 272s.
    const now = departedAt + durationMs - 272_000;
    const meadow = row(state, "meadow", now);
    expect(meadow.status).toBe("active");
    expect(meadow.countdown).toBe("4:32");
    expect(meadow.sendable).toBe(false);

    // Other rows go quiet while this pip is away (level 2 keeps forest open).
    const state2 = makeState({ pip, keep: { level: 2, placements: {} } });
    expect(row(state2, "forest", now).status).toBe("away");
    expect(row(state2, "forest", now).sendable).toBe(false);
  });

  it("a Returning pip's row flips to 'back!' copy with no countdown", () => {
    const pip = makePip({
      activity: PipActivity.Returning,
      expedition: {
        expeditionId: "meadow",
        departedAt: 0,
        durationMs: 5 * MINUTE_MS,
      },
    });
    const state = makeState({ pip });
    const meadow = row(state, "meadow", 10 * MINUTE_MS);
    expect(meadow.status).toBe("active");
    expect(meadow.countdown).toBeNull();
    expect(meadow.note).toContain("back");
  });
});

describe("buildExpeditionRow — who gets a Send button (spec §4.7)", () => {
  it("Resting pips are not offered trips (structural, no dialogue)", () => {
    const state = makeState({ pip: makePip({ activity: PipActivity.Resting }) });
    const meadow = row(state, "meadow");
    expect(meadow.status).toBe("resting");
    expect(meadow.sendable).toBe(false);
  });

  it("Sulking pips KEEP the Send button — the refusal line is theirs to deliver", () => {
    const state = makeState({ pip: makePip({ activity: PipActivity.Sulking }) });
    expect(row(state, "meadow").sendable).toBe(true);
  });

  it("Piplings keep the Send button on their supervised trail (spec §4.6, round 2A)", () => {
    const state = makeState({ pip: makePip({ lifeStage: LifeStage.Pipling }) });
    expect(row(state, "meadow").sendable).toBe(true);
  });
});

describe("buildExpeditionRow — Piplings explain themselves (finding #3)", () => {
  const piplingState = (overrides: Partial<PipState> = {}) =>
    makeState({
      pip: makePip({ lifeStage: LifeStage.Pipling, hatchedAt: 0, ...overrides }),
      keep: { level: 3, placements: {} }, // unlock forest/shore so the
      // Pipling reason is what's actually being asserted, not the level
    });

  it("labels an allowed trail as a little supervised trip, still sendable", () => {
    const meadow = row(piplingState(), "meadow");
    expect(tuning.pipling.allowedExpeditionIds).toContain("meadow");
    expect(meadow.status).toBe("available");
    expect(meadow.sendable).toBe(true);
    expect(meadow.badge).toBe("Supervised");
    expect(meadow.note).toContain("supervised");
  });

  it("an adult-only trail shows the grow-up countdown, not a bare refusal", () => {
    // 5h20m before this Pipling turns Adult.
    const now = tuning.pipling.durationMs - (5 * 60 + 20) * MINUTE_MS;
    const forest = row(piplingState(), "forest", now);

    expect(forest.status).toBe("pipling");
    expect(forest.sendable).toBe(false);
    expect(forest.badge).toBe("Pipling");
    expect(forest.note).toContain("Still a Pipling");
    expect(forest.countdown).toBe("5h 20m");
    // The DOM shell ticks this every frame off the absolute timestamp.
    expect(forest.countdownUntil).toBe(tuning.pipling.durationMs);
  });

  it("the countdown target is exactly core's adultAt (no drift between layers)", () => {
    const state = piplingState({ hatchedAt: 1_234_567 });
    const pip = state.pips["pip-1"];
    if (pip === undefined) throw new Error("pip missing");
    expect(row(state, "shore").countdownUntil).toBe(adultAt(pip));
  });

  it("still-locked trails keep the Keep-level reason (the actionable one)", () => {
    const state = makeState({
      pip: makePip({ lifeStage: LifeStage.Pipling }),
      keep: { level: 1, placements: {} },
    });
    const forest = row(state, "forest");
    expect(forest.status).toBe("locked");
    expect(forest.note).toContain("Keep level 2");
  });

  it("Adults never get a pipling row", () => {
    const state = makeState({ keep: { level: 3, placements: {} } });
    for (const id of ["meadow", "forest", "shore"]) {
      expect(row(state, id).status, id).not.toBe("pipling");
      expect(row(state, id).badge, id).toBeNull();
    }
  });
});

describe("formatGrowUpCountdown — coarse above an hour, live below", () => {
  it("renders hours+minutes, minutes+seconds, then bare seconds", () => {
    expect(formatGrowUpCountdown(5 * 3_600_000 + 20 * 60_000)).toBe("5h 20m");
    expect(formatGrowUpCountdown(8 * 3_600_000)).toBe("8h 0m");
    expect(formatGrowUpCountdown(12 * 60_000 + 30_000)).toBe("12m 30s");
    expect(formatGrowUpCountdown(90_000)).toBe("1m 30s");
    expect(formatGrowUpCountdown(8_000)).toBe("8s");
  });

  it("never renders a negative or a bare zero", () => {
    expect(formatGrowUpCountdown(0)).toBe("a moment");
    expect(formatGrowUpCountdown(-60_000)).toBe("a moment");
  });
});

describe("buildFocusModel — the whole panel model", () => {
  it("assembles identity, stage, mood, needs, and all three expedition rows", () => {
    const state = makeState();
    const model = buildFocusModel(state, "pip-1", 0);
    expect(model).not.toBeNull();
    expect(model?.speciesName).toBe("Mosspip");
    expect(model?.personalityName).toBe("Curious");
    expect(model?.blurb).toBe(PERSONALITY_BLURBS["curious"]);
    expect(model?.stageLabel).toBe(lifeStageLabel(LifeStage.Adult));
    expect(model?.mood).toBe("beaming"); // all needs at 80 ≥ 70
    expect(model?.needs.hunger).toBe(80);
    expect(model?.expeditions.map((r) => r.id)).toEqual([
      "meadow",
      "forest",
      "shore",
    ]);
  });

  it("returns null for an unknown pip instead of crashing", () => {
    expect(buildFocusModel(makeState(), "pip-99", 0)).toBeNull();
  });
});
