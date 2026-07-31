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
import type { VisitorRecord } from "../core/attractions";
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

/**
 * ROUND 2K (docs/liveliness-bible.md §5.3) — THE AMBIENCE SCENARIO.
 *
 * ⚠️ `?perf` MUST MEASURE THE NEW WORK OR THE WHOLE BUDGET IS THEATRE.
 * Measuring ambience with a harness that renders none of it is precisely
 * the failure mode spec §16 v1.3 keeps naming: the shipped harness draws
 * 5 Pips and 30 decorations and would have reported a perfectly healthy
 * 60 fps for a round that added visitors, attraction sprites, weather
 * particles, flitters and a full-screen tint.
 *
 * The scenario is the shipped one PLUS the round's worst realistic case:
 * four attractions (their own drawn sprites, each with a stock ring) and
 * two visitors — one of them shiny, accessorised and on the `wide`
 * silhouette, which is the most expensive Pip the game can draw (16
 * display objects against a plain Pip's 11). `perfMode` then forces the
 * scene to Night + Rain, which is the heaviest combination of the two
 * things the player cannot turn off.
 */
export const PERF_ATTRACTION_LAYOUT: readonly (readonly [string, number, number])[] = [
  ["clover-ring", 0, 0], //     2×2 meadow
  ["thicket-feeder", 3, 0], //  1×1 bramblewick
  ["sap-bucket", 5, 0], //      forest
  // ⚠️ FIX STAGE — was `snow-bell`. `lampwell` carries the `lantern`
  // motif, which is the ONLY thing that allocates a `lanternGlow`
  // Graphics at night (render/keepScene.ts). The old layout contained no
  // lantern-motif item at all, so the night scenario never measured the
  // one night-specific allocation the round added.
  ["lampwell", 7, 0], //        lanterngrotto
];

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

/** The two visitors the ambience scenario stands in the Keep. The first
 * is the most expensive Pip the game can draw: shiny, accessorised, and
 * on the widest silhouette. */
const PERF_VISITOR_NAMES = ["Overdraw", "Repaint"] as const;

/**
 * ROUND 2K — the ambience scenario (`?perf=ambience`, bible §5.3).
 *
 * Everything `buildPerfState` places, PLUS four attractions with full
 * stock and two present visitors. Weather and daylight are NOT state (both
 * are derived in the app layer), so `perfMode` forces those directly.
 */
export function buildAmbiencePerfState(): GameState {
  const base = buildPerfState();

  const placements: Record<string, Placement> = { ...base.keep.placements };
  const attractionStock: Record<string, number> = {};
  const attractionSchedule: Record<string, number> = {};
  const visitors: Record<string, VisitorRecord> = {};

  // The attractions go on the level-2 forest rows, which `buildPerfState`
  // leaves free — so the 30 decorations keep the exact positions the
  // baseline measured them at and the two runs stay comparable.
  PERF_ATTRACTION_LAYOUT.forEach(([itemId, x, y], i) => {
    const pid = `perf-attraction-${i + 1}`;
    placements[pid] = { itemId, x, y: y + 8 };
    attractionStock[pid] = 4;
    attractionSchedule[pid] = 0;
  });

  // Two of the four host a visitor. `maxConcurrentVisitors` is 2.
  const genomes = rollStarterCandidates(PERF_SEED + 7);
  PERF_VISITOR_NAMES.forEach((name, i) => {
    const pid = `perf-attraction-${i + 1}`;
    const rolled = genomes[i];
    if (rolled === undefined) return;
    visitors[pid] = {
      placementId: pid,
      speciesId: rolled.speciesId,
      name,
      genome: {
        ...rolled,
        // Visitor 0 is the worst case the renderer can be handed.
        // ⚠️ FIX STAGE — this said `"wander-scarf"`, which is not an
        // accessory id anything ships (`ACCESSORY_IDS` has `"scarf"`).
        // `resolveAccessory` returns `null` for an unknown id, so the
        // "most expensive Pip the game can draw" was being measured
        // WITHOUT the accessory the comment claims for it. A perf harness
        // that quietly under-builds its own worst case is the same class
        // of defect as a feature nothing renders.
        shiny: i === 0,
        accessoryId: i === 0 ? "scarf" : rolled.accessoryId,
      },
      arrivedAt: 0,
      // Far enough out that `visitorIsPresent` is true for any plausible
      // `lastTickAt` the harness syncs with.
      leavesAt: Number.MAX_SAFE_INTEGER,
      trust: i === 0 ? 3 : 1,
      fedThisVisit: false,
      visits: 2,
    };
  });

  return {
    ...base,
    keep: { level: 2, placements },
    attractionStock,
    attractionSchedule,
    visitors,
    nextPlacementNumber:
      PERF_DECORATION_COUNT + PERF_ATTRACTION_LAYOUT.length + 1,
  };
}
