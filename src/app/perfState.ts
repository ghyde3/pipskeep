/**
 * Synthetic GameState for the dev perf harness (?perf) — the exact
 * spec §1 budget scenario: 5 animated Pips + 30 decorations on screen.
 *
 * LOCAL-ONLY by construction: this state is handed straight to the
 * render layer's `scene.sync()`. No store is created from it, nothing
 * dispatches, and persistence never sees it — the player's real save is
 * untouched. It is built from the same pure core constructors and
 * content registries the real game uses, so the perf scene renders
 * through the REAL sprite resolvers, wander logic, and idle juice.
 *
 * Pure module (core + content only; no Pixi, no DOM) so the scenario's
 * shape — exactly 5 pips, exactly 30 in-bounds, non-overlapping
 * decorations — is unit-testable forever (perfState.test.ts).
 */

import { createNewGame, rollStarterCandidates } from "../core/state";
import type { GameState } from "../core/state";
import { createPipFromGenome } from "../core/pips/genome";
import { LifeStage } from "../core/pips/types";
import type { PipState } from "../core/pips/types";
import type { Placement } from "../core/keep";
import { decorations } from "../content/decorations";

/** Fixed seed: the perf scene is identical run to run, so numbers from
 * different sessions/machines are comparable. */
export const PERF_SEED = 0x9e7f5eed;

export const PERF_PIP_COUNT = 5;
export const PERF_DECORATION_COUNT = 30;

/** Cute-but-throwaway names for the synthetic roster. */
const PERF_NAMES = ["Benchling", "Framel", "Vsyncia", "Jankuss", "Warble"] as const;

/**
 * 30 decorations laid out by hand on the level-1 8×8 plot: mostly
 * checkerboard 1×1s (every item isolated, lots of wander room), plus
 * one 2×1 arch, a second arch, and one 2×2 mosaic along the bottom rows
 * so multi-tile footprints are represented. 35 of 64 tiles occupied.
 */
const PERF_DECOR_LAYOUT: readonly (readonly [string, number, number])[] = [
  ["moss-tuft", 0, 0], ["moss-tuft", 2, 0], ["moss-tuft", 4, 0], ["moss-tuft", 6, 0],
  ["moss-tuft", 1, 1], ["moss-tuft", 3, 1], ["moss-tuft", 5, 1], ["moss-tuft", 7, 1],
  ["moss-tuft", 0, 2], ["moss-tuft", 2, 2],
  ["pebble-path", 4, 2], ["pebble-path", 6, 2],
  ["pebble-path", 1, 3], ["pebble-path", 3, 3], ["pebble-path", 5, 3], ["pebble-path", 7, 3],
  ["pebble-path", 0, 4], ["pebble-path", 2, 4],
  ["cozy-lantern", 4, 4], ["cozy-lantern", 6, 4],
  ["cozy-lantern", 1, 5], ["cozy-lantern", 3, 5], ["cozy-lantern", 5, 5],
  ["berry-planter", 7, 5], ["berry-planter", 0, 6], ["berry-planter", 2, 6], ["berry-planter", 4, 6],
  ["driftwood-arch", 0, 7], // 2×1 → (0,7)(1,7)
  ["driftwood-arch", 3, 7], // 2×1 → (3,7)(4,7)
  ["shell-mosaic", 6, 6], //   2×2 → (6,6)(7,6)(6,7)(7,7)
];

/** Footprint lookup from the real registry (validates ids in tests). */
export function decorationFootprint(itemId: string): { w: number; h: number } {
  const def = decorations.find((d) => d.id === itemId);
  if (def === undefined) {
    throw new Error(`perfState: unknown decoration id "${itemId}"`);
  }
  return def.footprint;
}

function buildPerfPips(): readonly PipState[] {
  // Two deterministic genesis trios → 6 distinct-ish genomes; take 5.
  const genomes = [
    ...rollStarterCandidates(PERF_SEED),
    ...rollStarterCandidates(PERF_SEED + 1),
  ].slice(0, PERF_PIP_COUNT);

  return genomes.map((genome, i) =>
    createPipFromGenome(genome, {
      id: `perf-pip-${i + 1}`,
      name: PERF_NAMES[i] ?? `Pip ${i + 1}`,
      hatchedAt: 0,
      // One Pipling (shorter, quicker strides — the other animation
      // branch); the rest Adults. All Idle, so all five wander.
      lifeStage: i === PERF_PIP_COUNT - 1 ? LifeStage.Pipling : LifeStage.Adult,
    }),
  );
}

/** The synthetic scene state: 5 wandering pips, 30 placed decorations. */
export function buildPerfState(): GameState {
  const base = createNewGame(PERF_SEED, 0);

  const pips: Record<string, PipState> = {};
  const rosterOrder: string[] = [];
  for (const pip of buildPerfPips()) {
    pips[pip.id] = pip;
    rosterOrder.push(pip.id);
  }

  const placements: Record<string, Placement> = {};
  PERF_DECOR_LAYOUT.forEach(([itemId, x, y], i) => {
    placements[`perf-place-${i + 1}`] = { itemId, x, y };
  });

  return {
    ...base,
    pips,
    rosterOrder,
    activePipId: rosterOrder[0] as string,
    keep: { level: 1, placements },
    nextPipNumber: PERF_PIP_COUNT + 1,
    nextPlacementNumber: PERF_DECORATION_COUNT + 1,
    onboarding: { completed: true, step: "done" },
  };
}
