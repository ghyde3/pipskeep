/**
 * Keep upgrade card model tests (spec §9 level gates, §6.3 costs, §7.4
 * roster upgrade; docs/progression-bible.md §1.2/§2/§4.3): next-level
 * cost/copy/affordability from content, the TWO-key XP+resource gate, the
 * road-ahead ladder, the Keep Comfort readout, Renown, and the roster
 * section's level visibility. The DOM card is untested chrome around this.
 */

import { describe, expect, it } from "vitest";
import { keepLevels, keepUpgrades, ROSTER_UPGRADE_ID } from "../content/keep";
import { tuning } from "../content/tuning";
import { decorSets } from "../content/decorSets";
import { jobs } from "../content/jobs";
import { RENOWN_TOP_FLAIR_LEVEL, renownFlairForLevel } from "../content/flair";
import { resolveKeepEffects } from "../core/keep/effects";
import { createNewGame, rootReducer } from "../core/state";
import type { GameState } from "../core/state";
import {
  LEVEL_UNLOCK_COPY,
  LEVEL_UP_TOASTS,
  TIER_HEADLINES,
  buildKeepComfortModel,
  buildTierLadder,
  buildUpgradeCardModel,
} from "./keepUpgrade";

const T0 = 1_000_000;

function stateAt(
  level: number,
  resources: Record<string, number> = {},
  rosterUpgradePurchased = false,
  keepXp = 0,
): GameState {
  const fresh = createNewGame(7, T0);
  const granted = rootReducer(fresh, { type: "DEBUG_GRANT", resources });
  return {
    ...granted,
    keep: { ...granted.keep, level },
    rosterUpgradePurchased,
    keepXp,
  };
}

describe("buildUpgradeCardModel — next level (spec §9/§6.3)", () => {
  it("level 1 sells level 2 with the content cost and the Forest copy", () => {
    const model = buildUpgradeCardModel(stateAt(1));
    expect(model.currentLevel).toBe(1);
    expect(model.next?.level).toBe(2);
    // Content is the single source — the label is rendered FROM tuning,
    // never from a parallel constant, so a rebalance flows through.
    const cost = tuning.progression.levelCosts[2];
    expect(cost).toBeDefined();
    expect(keepLevels.find((l) => l.level === 2)?.cost).toEqual(cost);
    expect(model.next?.costLabel).toBe(
      `${cost?.wood} Wood + ${cost?.fiber} Fiber`,
    );
    expect(model.next?.unlockCopy).toContain("Forest");
    expect(model.next?.affordable).toBe(false);
    expect(model.next?.missingLabel).toBe(
      `Needs ${cost?.wood} more Wood and ${cost?.fiber} more Fiber`,
    );
  });

  it("a covered bundle flips affordable and clears the shortfall", () => {
    const model = buildUpgradeCardModel(stateAt(1, { wood: 15, fiber: 10 }));
    expect(model.next?.affordable).toBe(true);
    expect(model.next?.missingLabel).toBe("");
  });

  // ROUND 2F: the ladder now runs 1..12 (progression bible §2) — level 3
  // (the Snowdrift) has a next level same as any other mid-ladder tier;
  // only the TOP tier (12) has none.
  it("level 12 (the top of the ladder) has no next level — the card celebrates instead", () => {
    const model = buildUpgradeCardModel(stateAt(12));
    expect(model.next).toBeNull();
    expect(model.maxedCopy.length).toBeGreaterThan(10);
  });
});

describe("buildUpgradeCardModel — roster upgrade (spec §7.4)", () => {
  it("hides Cozy Bunks below the content prerequisite level", () => {
    // ROUND 2F: prerequisite moved 3 → 4, following the Shore (which now
    // unlocks at tier 4 — progression bible §2.1).
    expect(keepUpgrades[ROSTER_UPGRADE_ID]?.prerequisiteLevel).toBe(4);
    expect(buildUpgradeCardModel(stateAt(1)).roster.visible).toBe(false);
    expect(buildUpgradeCardModel(stateAt(2)).roster.visible).toBe(false);
    expect(buildUpgradeCardModel(stateAt(3)).roster.visible).toBe(false);
  });

  it("shows it at level 4 with cost + affordability from content", () => {
    const short = buildUpgradeCardModel(stateAt(4));
    expect(short.roster.visible).toBe(true);
    expect(short.roster.owned).toBe(false);
    expect(short.roster.name).toBe("Cozy Bunks");
    expect(short.roster.costLabel).toBe("10 Wood + 8 Shell + 4 Driftwood");
    expect(short.roster.affordable).toBe(false);
    expect(short.roster.missingLabel).toContain("more Wood");

    const rich = buildUpgradeCardModel(
      stateAt(4, { wood: 10, shell: 8, driftwood: 4 }),
    );
    expect(rich.roster.affordable).toBe(true);
  });

  it("owned reads as built, whatever the satchel holds", () => {
    const model = buildUpgradeCardModel(stateAt(4, {}, true));
    expect(model.roster.visible).toBe(true);
    expect(model.roster.owned).toBe(true);
  });
});

describe("celebration copy — every buyable level has a toast", () => {
  it("covers every one of the 12 tiers with warm lines", () => {
    for (const def of keepLevels) {
      if (def.level === 1) continue;
      expect(LEVEL_UP_TOASTS[def.level], `toast for ${def.level}`).toBeTypeOf(
        "string",
      );
      expect(LEVEL_UNLOCK_COPY[def.level], `unlock for ${def.level}`).toBeTypeOf(
        "string",
      );
    }
  });

  it("every tier has a short road-ahead headline too", () => {
    for (const def of keepLevels) {
      expect(TIER_HEADLINES[def.level], `headline for ${def.level}`).toBeTypeOf(
        "string",
      );
    }
  });
});

describe("buildUpgradeCardModel — the tier bar (bible §1.2/§0.2: the bar is per-tier)", () => {
  it("at 0 XP the bar reads empty against the tier-1→2 span", () => {
    const model = buildUpgradeCardModel(stateAt(1, {}, false, 0));
    expect(model.bar.into).toBe(0);
    expect(model.bar.span).toBe(tuning.progression.levelXp[1]);
    expect(model.bar.fraction).toBe(0);
  });

  it("mid-tier XP fills the bar proportionally to THIS tier's span, not the cumulative total", () => {
    const span = (tuning.progression.levelXp[2] ?? 0) - (tuning.progression.levelXp[1] ?? 0);
    const halfway = (tuning.progression.levelXp[1] ?? 0) + Math.round(span / 2);
    const model = buildUpgradeCardModel(stateAt(2, {}, false, halfway));
    expect(model.bar.span).toBe(span);
    expect(model.bar.fraction).toBeCloseTo(0.5, 1);
  });

  it("past the top tier the bar reads full (Renown owns what's next, bible §1.7)", () => {
    const model = buildUpgradeCardModel(stateAt(12, {}, false, 999_999));
    expect(model.bar.span).toBe(0);
    expect(model.bar.fraction).toBe(1);
  });
});

describe("buildUpgradeCardModel — the two-key gate (bible §1.2: earned with XP, paid for with resources)", () => {
  it("full resources but no XP: affordable but NOT buyable", () => {
    const cost = tuning.progression.levelCosts[2];
    const model = buildUpgradeCardModel(
      stateAt(1, { wood: cost?.wood ?? 0, fiber: cost?.fiber ?? 0 }, false, 0),
    );
    expect(model.next?.affordable).toBe(true);
    expect(model.next?.xpReady).toBe(false);
    expect(model.next?.buyable).toBe(false);
    expect(model.next?.xpNeededLabel).toBe(`${tuning.progression.levelXp[1]} more Keep XP`);
  });

  it("full XP but no resources: xpReady but NOT buyable", () => {
    const model = buildUpgradeCardModel(
      stateAt(1, {}, false, tuning.progression.levelXp[1]),
    );
    expect(model.next?.xpReady).toBe(true);
    expect(model.next?.affordable).toBe(false);
    expect(model.next?.buyable).toBe(false);
  });

  it("both cleared: buyable", () => {
    const cost = tuning.progression.levelCosts[2];
    const model = buildUpgradeCardModel(
      stateAt(
        1,
        { wood: cost?.wood ?? 0, fiber: cost?.fiber ?? 0 },
        false,
        tuning.progression.levelXp[1],
      ),
    );
    expect(model.next?.buyable).toBe(true);
    expect(model.next?.xpNeededLabel).toBe("");
  });
});

describe("buildTierLadder — the road ahead (bible §2)", () => {
  it("marks everything up to and including the current level as reached, the very next as next, the rest locked", () => {
    const ladder = buildTierLadder(4);
    expect(ladder).toHaveLength(12);
    expect(ladder.filter((r) => r.status === "reached").map((r) => r.level)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(ladder.find((r) => r.level === 5)?.status).toBe("next");
    expect(ladder.filter((r) => r.status === "locked").map((r) => r.level)).toEqual([
      6, 7, 8, 9, 10, 11, 12,
    ]);
  });

  it("at the top tier every row reads reached and none is next", () => {
    const ladder = buildTierLadder(12);
    expect(ladder.every((r) => r.status === "reached")).toBe(true);
  });

  it("every row's headline is non-empty", () => {
    for (const row of buildTierLadder(1)) {
      expect(row.headline.length).toBeGreaterThan(3);
    }
  });
});

describe("buildUpgradeCardModel — Renown past the top tier (bible §1.7)", () => {
  it("is null below the top tier", () => {
    expect(buildUpgradeCardModel(stateAt(11, {}, false, 999_999)).renown).toBeNull();
  });

  it("starts at level 0 exactly at the tier-12 floor", () => {
    const floor = tuning.progression.levelXp[11] ?? 0;
    const model = buildUpgradeCardModel(stateAt(12, {}, false, floor));
    expect(model.renown?.level).toBe(0);
    expect(model.renown?.into).toBe(0);
    expect(model.renown?.span).toBe(tuning.progression.renown.xpPerLevel);
  });

  it("advances a level every xpPerLevel past the floor, flair only, never a cap change", () => {
    const floor = tuning.progression.levelXp[11] ?? 0;
    const perLevel = tuning.progression.renown.xpPerLevel;
    const model = buildUpgradeCardModel(stateAt(12, {}, false, floor + perLevel + 200));
    expect(model.renown?.level).toBe(1);
    expect(model.renown?.into).toBe(200);
  });
});

describe("buildKeepComfortModel — the surface that stops effects being a dead feature (bible §4.3)", () => {
  it("an unbuilt Keep shows no need/scalar rows, but every set at 0", () => {
    const model = buildKeepComfortModel(stateAt(1));
    expect(model.needs).toEqual([]);
    expect(model.scalars).toEqual([]);
    expect(model.sets).toHaveLength(decorSets.length);
    expect(model.sets.every((s) => s.placedCount === 0 && !s.bonusActive)).toBe(true);
  });

  it("a placed Food Bowl shows up as a Hunger comfort row, sourced by name", () => {
    let state = stateAt(1, { wood: 20, fiber: 20 });
    state = rootReducer(state, { type: "PLACE_ITEM", itemId: "food-bowl", x: 0, y: 0, at: T0 });
    const model = buildKeepComfortModel(state);
    const hunger = model.needs.find((n) => n.need === "hunger");
    expect(hunger?.pct).toBe(6);
    expect(hunger?.capPct).toBe(25);
    expect(hunger?.atCap).toBe(false);
    expect(hunger?.sources).toContain("Food Bowl");
  });

  it("a placed Bed shows a Naps scalar row with a real multiplier and a source", () => {
    let state = stateAt(1, { wood: 20, fiber: 20 });
    state = rootReducer(state, { type: "PLACE_ITEM", itemId: "bed", x: 0, y: 0, at: T0 });
    const model = buildKeepComfortModel(state);
    const naps = model.scalars.find((s) => s.key === "rest");
    expect(naps?.valueLabel).toBe("×1.25");
    expect(naps?.sources).toContain("Bed");
  });

  it("names the SET as a source once a set bonus is active", () => {
    let state = stateAt(3, { fiber: 50, wood: 20 }); // tier 3 turns 3-of-a-set on
    for (const [i, id] of ["moss-tuft", "pebble-path", "berry-planter"].entries()) {
      state = rootReducer(state, { type: "PLACE_ITEM", itemId: id, x: i, y: 0, at: T0 });
    }
    const model = buildKeepComfortModel(state);
    const happiness = model.needs.find((n) => n.need === "happiness");
    expect(happiness?.sources).toContain("Meadow Green set");
    const meadow = model.sets.find((s) => s.setId === "meadow-green");
    expect(meadow?.bonusActive).toBe(true);
    expect(meadow?.placedCount).toBe(3);
  });
});


/** ROUND 2F helper: a Keep at `level` with `placements` injected directly —
 * `stateAt` above takes RESOURCES as its second argument, and these tests are
 * about what is BUILT. */
function builtAt(
  level: number,
  placements: Record<string, { itemId: string; x: number; y: number }>,
): GameState {
  const base = stateAt(level);
  return { ...base, keep: { ...base.keep, level, placements } };
}

/**
 * ROUND 2F FIXES to the "How the Keep helps" readout.
 *
 * `ResolvedKeepEffects.hostedJobIds` was aggregated, capped and returned and
 * then read by NOTHING outside its own unit test — a computed value with no
 * consumer, the mildest instance of the dead-feature pattern this round exists
 * to kill. And only the COMFORT rows carried "at the Keep's limit", so "Naps
 * ×1.6" — which is exactly `restSpeedMax` — read as though more was available.
 */
describe("buildKeepComfortModel — hostedJobIds is finally consumed", () => {
  it("names no work on an unbuilt Keep", () => {
    expect(buildKeepComfortModel(builtAt(1, {})).jobs).toEqual([]);
  });

  it("names the job a placed station hosts", () => {
    const model = buildKeepComfortModel(
      builtAt(1, { "place-1": { itemId: "gathering-station", x: 0, y: 0 } }),
    );
    expect(model.jobs).toContain(jobs.gathering!.name);
  });

  it("agrees with the effects engine — same ids, resolved to names", () => {
    const placements = {
      "place-1": { itemId: "gathering-station", x: 0, y: 0 },
      "place-2": { itemId: "stockpot", x: 3, y: 0 },
    };
    const state = builtAt(12, placements);
    const resolved = resolveKeepEffects(state.keep, state.keep.level);
    const model = buildKeepComfortModel(state);
    expect(model.jobs.length).toBe(resolved.hostedJobIds.length);
    for (const id of resolved.hostedJobIds) {
      expect(model.jobs).toContain(jobs[id]!.name);
    }
  });
});

describe("buildKeepComfortModel — scalar rows say when they are at the cap", () => {
  it("a single Bed is BELOW the rest-speed cap and does not claim otherwise", () => {
    const model = buildKeepComfortModel(builtAt(1, { "place-1": { itemId: "bed", x: 0, y: 0 } }));
    const rest = model.scalars.find((s) => s.key === "rest");
    expect(rest).toBeDefined();
    expect(rest?.atCap).toBe(false);
  });

  it("stacked rest-speed items pin the cap and SAY so", () => {
    const placements: Record<string, { itemId: string; x: number; y: number }> = {};
    for (let i = 0; i < 6; i++) {
      placements[`place-${i + 1}`] = { itemId: "bed", x: i * 2, y: 0 };
    }
    const model = buildKeepComfortModel(builtAt(12, placements));
    const rest = model.scalars.find((s) => s.key === "rest");
    expect(rest?.valueLabel).toBe(
      `×${Math.round(tuning.progression.effectCaps.restSpeedMax * 100) / 100}`,
    );
    expect(rest?.atCap).toBe(true);
  });

  it("stacked Beacons pin the trip-speed floor and say so", () => {
    const placements: Record<string, { itemId: string; x: number; y: number }> = {};
    for (let i = 0; i < 6; i++) {
      placements[`place-${i + 1}`] = { itemId: "beacon", x: i * 2, y: 0 };
    }
    const trips = buildKeepComfortModel(builtAt(12, placements)).scalars.find(
      (s) => s.key === "trips",
    );
    expect(trips?.atCap).toBe(true);
  });

  it("the two DELIBERATELY uncapped channels never claim a limit (bible §3.3)", () => {
    const placements: Record<string, { itemId: string; x: number; y: number }> = {};
    const loud = ["trail-post", "weathervane"];
    let slot = 0;
    for (const itemId of loud) {
      for (let i = 0; i < 6; i++) {
        placements[`place-${++slot}`] = { itemId, x: slot % 10, y: Math.floor(slot / 10) };
      }
    }
    const model = buildKeepComfortModel(builtAt(12, placements));
    expect(model.scalars.find((s) => s.key === "loot")?.atCap).toBe(false);
    expect(model.scalars.find((s) => s.key === "eggs")?.atCap).toBe(false);
  });
});


describe("the Renown line names its flourishes (bible §1.7)", () => {
  const topLevel = keepLevels[keepLevels.length - 1]!.level;
  const floor = tuning.progression.levelXp[tuning.progression.levelXp.length - 1] ?? 0;
  const perLevel = tuning.progression.renown.xpPerLevel;

  it("names the flourish the NEXT level will mint, even before the first one is earned", () => {
    const model = buildUpgradeCardModel(stateAt(topLevel, {}, false, floor + 10));
    expect(model.renown?.level).toBe(0);
    expect(model.renown?.earnedFlairName).toBeNull();
    expect(model.renown?.nextFlairName).toBe(renownFlairForLevel(1)?.name);
  });

  it("names both the flourish just earned and the one coming", () => {
    const model = buildUpgradeCardModel(
      stateAt(topLevel, {}, false, floor + perLevel * 2 + 5),
    );
    expect(model.renown?.level).toBe(2);
    expect(model.renown?.earnedFlairName).toBe(renownFlairForLevel(2)?.name);
    expect(model.renown?.nextFlairName).toBe(renownFlairForLevel(3)?.name);
  });

  it("stops promising a flourish past the end of the ladder", () => {
    const model = buildUpgradeCardModel(
      stateAt(topLevel, {}, false, floor + perLevel * (RENOWN_TOP_FLAIR_LEVEL + 3)),
    );
    expect(model.renown?.nextFlairName).toBeNull();
  });
});
