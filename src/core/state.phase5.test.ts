/**
 * Phase 5 reducer tests (spec §4.6, §6.3, §7.4, §9):
 *
 * - PURCHASE_KEEP_LEVEL: exact resource-bundle deduction of the
 *   content-defined cost; typed-refusal-as-unchanged-state when short
 *   or at max level; buying level 2 FLIPS Forest assignment legality.
 * - PURCHASE_ROSTER_UPGRADE: level-3 prerequisite, exact deduction,
 *   once only; raises the HATCH_EGG cap 3 → 5 (4th hatch blocked
 *   before, allowed after), with the friendly nudge in the pre-upgrade
 *   roster-full message and the max message after.
 * - EVOLVE_PIP: a real 72h FakeClock care run (hourly TICK + Feed +
 *   Pet keeps lifetime avg Happiness ≥ 70) sets `readyToEvolve`; TICK
 *   and CATCHUP NEVER evolve; only the action does. Variant selection
 *   by `lastGiftItemId` incl. the default fallback (no gift, unmapped
 *   gift); needs/personality/age are kept, the flag clears, and
 *   `evolvedAt` is recorded.
 * - ACKNOWLEDGE_REVEAL double-dispatch idempotency (Phase 4 audit gap):
 *   the second dispatch is a no-op by reference — loot lands once.
 */

import { describe, expect, it } from "vitest";
import { FakeClock } from "./clock";
import { HOUR_MS, MINUTE_MS, tuning } from "../content/tuning";
import { keepLevels, keepUpgrades, ROSTER_UPGRADE_ID } from "../content/keep";
import { ROSTER_FULL_MAX_MESSAGE, ROSTER_FULL_MESSAGE } from "../content/eggs";
import { LifeStage, PipActivity } from "./pips/types";
import type { PipNeeds, PipState } from "./pips/types";
import { EggState } from "./eggs";
import type { Egg } from "./eggs";
import { rootReducer } from "./state";
import type { GameAction, GameState } from "./state";

const T0 = 50_000_000;
const SEED = 42;

function needs(overrides: Partial<PipNeeds> = {}): PipNeeds {
  return { hunger: 100, cleanliness: 100, happiness: 100, energy: 100, ...overrides };
}

function makePip(id: string, overrides: Partial<PipState> = {}): PipState {
  const personalityId = overrides.personalityId ?? "curious";
  return {
    id,
    speciesId: "mosspip",
    name: "Testpip",
    genome: {
      speciesId: "mosspip",
      palette: "fern",
      pattern: "plain",
      accessorySlots: 1,
      personalityId,
    },
    personalityId,
    lifeStage: LifeStage.Adult,
    hatchedAt: T0,
    ageMs: 0,
    happinessIntegral: 0,
    needs: needs(),
    activity: PipActivity.Idle,
    pendingSulk: false,
    readyToEvolve: false,
    evolved: null,
    lastGiftItemId: null,
    expedition: null,
    needsUpdatedAt: T0,
    ...overrides,
  };
}

function pippingEgg(id: string): Egg {
  return {
    id,
    state: EggState.Pipping,
    foundAt: T0 - 3 * HOUR_MS,
    rarity: "common",
    incubationMs: 2 * HOUR_MS,
    incubationStartedAt: T0 - 3 * HOUR_MS,
    sourceExpeditionId: null,
  };
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  const pips = overrides.pips ?? { "pip-1": makePip("pip-1") };
  const rosterOrder = overrides.rosterOrder ?? Object.keys(pips);
  return {
    pips,
    rosterOrder,
    activePipId: rosterOrder[0] ?? "pip-1",
    inventory: {},
    resources: {},
    rngState: {},
    seed: SEED,
    keep: { level: 1, placements: {} },
    jobs: {},
    rosterUpgradePurchased: false,
    eggs: [],
    pendingReveals: [],
    nextPipNumber: Object.keys(pips).length + 1,
    nextEggNumber: 1,
    nextPlacementNumber: 1,
    cooldowns: {},
    lastLineIndex: {},
    createdAt: T0,
    lastTickAt: T0,
    lastCareOutcome: null,
    lastCatchup: null,
    lastAssignOutcome: null,
    lastHatchOutcome: null,
    lastJobOutcome: null,
    lastEvolveOutcome: null,
    ...overrides,
  };
}

describe("PURCHASE_KEEP_LEVEL (spec §6.3/§9)", () => {
  it("deducts the level-2 bundle EXACTLY (15 Wood + 10 Fiber)", () => {
    const state = makeState({ resources: { wood: 20, fiber: 15, berry: 2 } });
    const next = rootReducer(state, { type: "PURCHASE_KEEP_LEVEL" });
    expect(next.keep.level).toBe(2);
    expect(next.resources).toEqual({ wood: 5, fiber: 5, berry: 2 });
    // The cost came from content/keep.ts, not a parallel constant.
    expect(keepLevels.find((l) => l.level === 2)?.cost).toEqual({
      wood: 15,
      fiber: 10,
    });
  });

  it("refuses when short — state unchanged by reference, nothing deducted", () => {
    const state = makeState({ resources: { wood: 14, fiber: 10 } });
    expect(rootReducer(state, { type: "PURCHASE_KEEP_LEVEL" })).toBe(state);
  });

  it("refuses at max level (no level 4 in content)", () => {
    const state = makeState({
      keep: { level: 3, placements: {} },
      resources: { wood: 999, fiber: 999, shell: 999, driftwood: 999 },
    });
    expect(rootReducer(state, { type: "PURCHASE_KEEP_LEVEL" })).toBe(state);
  });

  it("level 2 → 3 costs the Shore-tier bundle (20 Wood + 12 Shells + 6 Driftwood)", () => {
    const state = makeState({
      keep: { level: 2, placements: {} },
      resources: { wood: 20, shell: 12, driftwood: 6 },
    });
    const next = rootReducer(state, { type: "PURCHASE_KEEP_LEVEL" });
    expect(next.keep.level).toBe(3);
    expect(next.resources).toEqual({ wood: 0, shell: 0, driftwood: 0 });
  });

  it("buying level 2 flips Forest assignment from locked to legal (spec §6.1/§9)", () => {
    const state = makeState({ resources: { wood: 15, fiber: 10 } });
    const send: GameAction = {
      type: "ASSIGN_EXPEDITION",
      pipId: "pip-1",
      expeditionId: "forest",
      at: T0,
    };

    const locked = rootReducer(state, send);
    expect(locked.lastAssignOutcome).toMatchObject({ ok: false, reason: "locked" });
    expect(locked.pips["pip-1"]?.activity).toBe(PipActivity.Idle);

    const upgraded = rootReducer(state, { type: "PURCHASE_KEEP_LEVEL" });
    const sent = rootReducer(upgraded, send);
    expect(sent.lastAssignOutcome).toMatchObject({ ok: true, expeditionId: "forest" });
    expect(sent.pips["pip-1"]?.activity).toBe(PipActivity.OnExpedition);
  });
});

describe("PURCHASE_ROSTER_UPGRADE + the HATCH_EGG cap (spec §7.4)", () => {
  /** Three pips (the base cap) at Keep level 3 with pipping eggs waiting. */
  const atCap = (overrides: Partial<GameState> = {}): GameState =>
    makeState({
      pips: {
        "pip-1": makePip("pip-1"),
        "pip-2": makePip("pip-2"),
        "pip-3": makePip("pip-3"),
      },
      keep: { level: 3, placements: {} },
      eggs: [pippingEgg("egg-1"), pippingEgg("egg-2"), pippingEgg("egg-3")],
      resources: { wood: 10, shell: 9, driftwood: 4 },
      ...overrides,
    });

  it("requires Keep level 3 (content prerequisite) and refuses below it", () => {
    expect(keepUpgrades[ROSTER_UPGRADE_ID]?.prerequisiteLevel).toBe(3);
    const early = atCap({ keep: { level: 2, placements: {} } });
    expect(rootReducer(early, { type: "PURCHASE_ROSTER_UPGRADE" })).toBe(early);
  });

  it("deducts the content cost exactly, once — a second purchase refuses", () => {
    const state = atCap();
    const bought = rootReducer(state, { type: "PURCHASE_ROSTER_UPGRADE" });
    expect(bought.rosterUpgradePurchased).toBe(true);
    expect(bought.resources).toEqual({ wood: 0, shell: 1, driftwood: 0 });
    expect(keepUpgrades[ROSTER_UPGRADE_ID]?.cost).toEqual(tuning.rosterUpgradeCost);
    expect(rootReducer(bought, { type: "PURCHASE_ROSTER_UPGRADE" })).toBe(bought);

    const broke = atCap({ resources: { wood: 9 } });
    expect(rootReducer(broke, { type: "PURCHASE_ROSTER_UPGRADE" })).toBe(broke);
  });

  it("raises the hatch cap 3 → 5: 4th hatch blocked before, allowed after", () => {
    const state = atCap();

    // At the base cap of 3, the 4th pip cannot hatch — friendly nudge.
    const blocked = rootReducer(state, {
      type: "HATCH_EGG", eggId: "egg-1", at: T0,
    });
    expect(blocked.lastHatchOutcome).toEqual({
      ok: false,
      eggId: "egg-1",
      at: T0,
      reason: "rosterFull",
      message: ROSTER_FULL_MESSAGE,
    });
    expect(ROSTER_FULL_MESSAGE).toContain("Keep level 3"); // the upgrade nudge
    expect(blocked.rosterOrder).toHaveLength(3);
    expect(blocked.eggs.find((e) => e.id === "egg-1")?.state).toBe(EggState.Pipping);

    // Buy the upgrade: the SAME egg now hatches...
    const upgraded = rootReducer(state, { type: "PURCHASE_ROSTER_UPGRADE" });
    const four = rootReducer(upgraded, { type: "HATCH_EGG", eggId: "egg-1", at: T0 });
    expect(four.lastHatchOutcome).toMatchObject({ ok: true, eggId: "egg-1" });
    expect(four.rosterOrder).toHaveLength(4);

    // ...and a 5th fits, but the 6th refuses with the max message.
    const five = rootReducer(four, { type: "HATCH_EGG", eggId: "egg-2", at: T0 });
    expect(five.rosterOrder).toHaveLength(5);
    expect(five.rosterOrder).toHaveLength(tuning.rosterCapUpgraded);
    const full = rootReducer(five, { type: "HATCH_EGG", eggId: "egg-3", at: T0 });
    expect(full.lastHatchOutcome).toMatchObject({
      ok: false,
      reason: "rosterFull",
      message: ROSTER_FULL_MAX_MESSAGE,
    });
    expect(full.rosterOrder).toHaveLength(5);
    expect(full.eggs.find((e) => e.id === "egg-3")?.state).toBe(EggState.Pipping);
  });
});

describe("EVOLVE_PIP (spec §4.6: player-witnessed, never automatic)", () => {
  /**
   * A REAL care run under FakeClock: hourly TICK + Feed(berry) + Pet for
   * 72 hours. Feeding pins Hunger high (no Sulking noise) and petting
   * offsets the ~4/h Happiness decay of a Curious pip, so Happiness
   * stays ≥ ~96 and the lifetime average lands far above the 70
   * threshold at exactly age 72h.
   */
  function runTo72h(): { state: GameState; clock: FakeClock } {
    const clock = new FakeClock(T0);
    let state = makeState({ inventory: { berry: 200 } });
    for (let hour = 1; hour <= 72; hour++) {
      clock.advance(HOUR_MS);
      const at = clock.now();
      state = rootReducer(state, { type: "TICK", at });
      state = rootReducer(state, { type: "FEED", pipId: "pip-1", foodId: "berry", at });
      state = rootReducer(state, { type: "PET", pipId: "pip-1", at });
    }
    return { state, clock };
  }

  it("the 72h ≥70-average run sets readyToEvolve; TICK/CATCHUP never evolve", () => {
    const { state, clock } = runTo72h();
    const pip = state.pips["pip-1"];
    expect(pip?.readyToEvolve).toBe(true);
    expect(pip?.ageMs).toBe(72 * HOUR_MS);
    expect((pip?.happinessIntegral ?? 0) / (pip?.ageMs ?? 1)).toBeGreaterThanOrEqual(70);
    // Still a mosspip: readiness is a flag, evolution waits for the tap.
    expect(pip?.speciesId).toBe("mosspip");

    // More live time never evolves it...
    clock.advance(24 * HOUR_MS);
    const laterLive = rootReducer(state, { type: "TICK", at: clock.now() });
    expect(laterLive.pips["pip-1"]?.speciesId).toBe("mosspip");
    expect(laterLive.pips["pip-1"]?.readyToEvolve).toBe(true); // sticky, still glowing

    // ...and neither does a long offline catch-up.
    const offline = rootReducer(state, {
      type: "CATCHUP",
      savedAt: T0 + 72 * HOUR_MS,
      now: T0 + 144 * HOUR_MS,
    });
    expect(offline.pips["pip-1"]?.speciesId).toBe("mosspip");
    expect(offline.pips["pip-1"]?.readyToEvolve).toBe(true);
  });

  it("refuses before readiness (typed outcome, nothing changes)", () => {
    const fresh = makeState();
    const refused = rootReducer(fresh, {
      type: "EVOLVE_PIP", pipId: "pip-1", at: T0,
    });
    expect(refused.pips).toBe(fresh.pips);
    expect(refused.lastEvolveOutcome).toEqual({
      ok: false, pipId: "pip-1", at: T0, reason: "notReady",
    });
    const unknown = rootReducer(fresh, {
      type: "EVOLVE_PIP", pipId: "pip-9", at: T0,
    });
    expect(unknown.lastEvolveOutcome).toMatchObject({ reason: "unknownPip" });
  });

  it("the action applies it: species swaps, variant from lastGiftItemId, everything else kept", () => {
    const { state, clock } = runTo72h();
    // Gift a Berry — the mosspip registry maps berry → "berrybright".
    const gifted = rootReducer(state, {
      type: "GIVE_ITEM", pipId: "pip-1", itemId: "berry", at: clock.now(),
    });
    const before = gifted.pips["pip-1"] as PipState;

    const evolveAt = clock.now() + MINUTE_MS;
    const evolved = rootReducer(gifted, {
      type: "EVOLVE_PIP", pipId: "pip-1", at: evolveAt,
    });
    const after = evolved.pips["pip-1"] as PipState;

    expect(after.speciesId).toBe("grovepip");
    expect(after.evolved).toEqual({ variantId: "berrybright", evolvedAt: evolveAt });
    expect(after.readyToEvolve).toBe(false);
    // Kept: needs, personality, age/history, and the birth genome.
    expect(after.needs).toEqual(before.needs);
    expect(after.personalityId).toBe(before.personalityId);
    expect(after.ageMs).toBe(before.ageMs);
    expect(after.happinessIntegral).toBe(before.happinessIntegral);
    expect(after.hatchedAt).toBe(before.hatchedAt);
    expect(after.genome).toEqual(before.genome);

    expect(evolved.lastEvolveOutcome).toEqual({
      ok: true,
      pipId: "pip-1",
      at: evolveAt,
      fromSpeciesId: "mosspip",
      toSpeciesId: "grovepip",
      variantId: "berrybright",
    });

    // Grovepips have no further evolution: the glow never returns.
    const later = rootReducer(evolved, {
      type: "TICK", at: evolveAt + 24 * HOUR_MS,
    });
    expect(later.pips["pip-1"]?.readyToEvolve).toBe(false);
  });

  it("no gift → the default variant; an unmapped gift also falls back", () => {
    const { state, clock } = runTo72h();
    expect(state.pips["pip-1"]?.lastGiftItemId).toBeNull();

    const noGift = rootReducer(state, {
      type: "EVOLVE_PIP", pipId: "pip-1", at: clock.now(),
    });
    expect(noGift.pips["pip-1"]?.evolved?.variantId).toBe("verdant");

    // An item with no giftVariants mapping (wood) → default fallback.
    const granted = rootReducer(state, {
      type: "DEBUG_GRANT", items: { wood: 1 },
    });
    const gifted = rootReducer(granted, {
      type: "GIVE_ITEM", pipId: "pip-1", itemId: "wood", at: clock.now(),
    });
    expect(gifted.pips["pip-1"]?.lastGiftItemId).toBe("wood");
    const evolved = rootReducer(gifted, {
      type: "EVOLVE_PIP", pipId: "pip-1", at: clock.now(),
    });
    expect(evolved.pips["pip-1"]?.evolved?.variantId).toBe("verdant");
  });
});

describe("ACKNOWLEDGE_REVEAL double-dispatch idempotency (Phase 4 audit gap)", () => {
  it("the second dispatch is a no-op by reference — loot lands exactly once", () => {
    const returning = makePip("pip-1", {
      activity: PipActivity.Returning,
      expedition: {
        expeditionId: "meadow",
        departedAt: T0 - 5 * MINUTE_MS,
        durationMs: 5 * MINUTE_MS,
      },
    });
    const state = makeState({
      pips: { "pip-1": returning },
      pendingReveals: [
        {
          pipId: "pip-1",
          expeditionId: "meadow",
          completedAt: T0,
          items: ["berry", "fiber"],
          egg: null,
        },
      ],
    });

    const once = rootReducer(state, { type: "ACKNOWLEDGE_REVEAL", at: T0 + 1_000 });
    expect(once.pendingReveals).toEqual([]);
    expect(once.inventory).toEqual({ berry: 1 }); // berries are food
    expect(once.resources).toEqual({ fiber: 1 });
    expect(once.pips["pip-1"]?.activity).toBe(PipActivity.Idle);

    // The double-tap: an empty queue acknowledges to the SAME state —
    // no second berry, no re-landing, no new object identity.
    const twice = rootReducer(once, { type: "ACKNOWLEDGE_REVEAL", at: T0 + 1_200 });
    expect(twice).toBe(once);
    expect(twice.inventory).toEqual({ berry: 1 });
    expect(twice.resources).toEqual({ fiber: 1 });
  });
});
