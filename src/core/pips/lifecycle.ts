/**
 * Life stages & evolution (spec §4.6).
 *
 * - Pipling → Adult at exactly `hatchedAt + pipling.durationMs` (8h
 *   default as of round 2A — was 24h; see content/tuning.ts `pipling` for
 *   the retune rationale), inclusive at the boundary.
 * - Evolution readiness: `ageMs ≥ minAgeMs` AND lifetime average Happiness
 *   (`happinessIntegral / ageMs`) `≥ minLifetimeAvgHappiness` sets the
 *   `readyToEvolve` FLAG. Nothing here ever changes `speciesId` — evolution
 *   is player-witnessed (a tap), never automatic.
 * - Thresholds and variant mappings live in the species registry (spec
 *   §4.6), whose values default from `content/tuning.ts`. Core reads the
 *   registry through a structural type so adding species never touches
 *   core/ (spec §2 rule 5).
 *
 * Pure functions: `now` comes from the injected Clock at the call site.
 * ZERO tuning literals here.
 */

import { tuning as contentTuning } from "../../content/tuning";
import { LifeStage } from "./types";
import type { PipState } from "./types";

/** The slice of tuning the life-stage math reads (injectable for tests). */
export interface LifecycleTuning {
  readonly pipling: {
    /** Pipling lasts hatch → this many ms (spec §4.6; round 2A: 8h
     * default, was 24h). */
    readonly durationMs: number;
  };
}

/**
 * The computable moment a Pipling becomes an Adult: `hatchedAt +
 * pipling.durationMs`. Exposed so catch-up passes can split segments at
 * the boundary (the Pipling decay multiplier — round 2A: ×0.9, was ×1.2
 * — ends here, §4.5/§4.6).
 */
export function adultAt(
  pip: PipState,
  tuning: LifecycleTuning = contentTuning,
): number {
  return pip.hatchedAt + tuning.pipling.durationMs;
}

/**
 * Promote a Pipling to Adult once `now ≥ adultAt(pip)` — inclusive: at
 * exactly `hatchedAt + pipling.durationMs` the Pip is an Adult. Adults
 * never regress.
 */
export function updateLifeStage(
  pip: PipState,
  now: number,
  tuning: LifecycleTuning = contentTuning,
): PipState {
  if (pip.lifeStage !== LifeStage.Pipling) return pip;
  if (now < adultAt(pip, tuning)) return pip;
  return { ...pip, lifeStage: LifeStage.Adult };
}

/**
 * Lifetime average Happiness = happinessIntegral / ageMs (spec §4.6).
 * A newborn (ageMs = 0) has no history yet — returns 0, never NaN.
 */
export function lifetimeAvgHappiness(pip: PipState): number {
  return pip.ageMs > 0 ? pip.happinessIntegral / pip.ageMs : 0;
}

/**
 * Evolution conditions as core reads them from the species registry
 * (structural subset of content/species.ts `EvolutionDef`).
 */
export interface EvolutionSpec {
  readonly targetSpeciesId: string;
  readonly minAgeMs: number;
  readonly minLifetimeAvgHappiness: number;
  /** Most recent Give Item id → variant id (spec §4.6). */
  readonly giftVariants: Readonly<Record<string, string>>;
  /** Used when the Pip never received a gift (or the gift is unmapped). */
  readonly defaultVariantId: string;
}

/** A species registry entry; `evolution` absent = species never evolves. */
export interface SpeciesEvolutionEntry {
  readonly evolution?: EvolutionSpec;
}

/** Structural view of the species registry, keyed by species id. */
export type SpeciesEvolutionRegistry = Readonly<
  Record<string, SpeciesEvolutionEntry>
>;

/**
 * Set `readyToEvolve` when the Pip's species can evolve and both §4.6
 * thresholds hold: `ageMs ≥ minAgeMs` AND lifetime average Happiness
 * `≥ minLifetimeAvgHappiness` (both inclusive). Run alongside the other
 * post-recompute evaluations.
 *
 * Decision (spec is silent): the flag is STICKY — once glowing, the Pip
 * keeps waiting for its tap even if the lifetime average later dips below
 * the threshold. Revoking an announced evolution would read as punishment
 * (§4.4 tone rule).
 */
export function updateEvolutionReadiness(
  pip: PipState,
  registry: SpeciesEvolutionRegistry,
): PipState {
  if (pip.readyToEvolve) return pip;
  const evolution = registry[pip.speciesId]?.evolution;
  if (evolution === undefined) return pip;
  if (
    pip.ageMs >= evolution.minAgeMs &&
    lifetimeAvgHappiness(pip) >= evolution.minLifetimeAvgHappiness
  ) {
    return { ...pip, readyToEvolve: true };
  }
  return pip;
}

/** What tapping a glowing Pip will produce (spec §4.6). */
export interface EvolutionResult {
  readonly targetSpeciesId: string;
  readonly variantId: string;
}

/**
 * Resolve the evolution a Pip's species offers: the target species plus
 * the variant selected by the most recent Give Item (`lastGiftItemId`);
 * the default variant when no gift was ever given or the gift id has no
 * mapping. Returns `null` when the species does not evolve.
 *
 * This only ANSWERS what evolution would produce — it does not check
 * `readyToEvolve` and changes nothing. The tap handler gates on the flag
 * and applies the result (Phase 5).
 */
export function checkEvolution(
  pip: PipState,
  registry: SpeciesEvolutionRegistry,
): EvolutionResult | null {
  const evolution = registry[pip.speciesId]?.evolution;
  if (evolution === undefined) return null;
  const giftVariant =
    pip.lastGiftItemId !== null
      ? evolution.giftVariants[pip.lastGiftItemId]
      : undefined;
  return {
    targetSpeciesId: evolution.targetSpeciesId,
    variantId: giftVariant ?? evolution.defaultVariantId,
  };
}

/** Why applyEvolution declined. `notReady` = the flag isn't set (the UI
 * should not have offered the tap); `noEvolution` = the species has no
 * evolution entry (defensive — the flag is only ever set when one
 * exists). */
export type EvolveRefusalReason = "notReady" | "noEvolution";

export type ApplyEvolutionResult =
  | { readonly ok: true; readonly pip: PipState; readonly result: EvolutionResult }
  | { readonly ok: false; readonly reason: EvolveRefusalReason };

/**
 * Apply the evolution a glowing Pip has been waiting for (spec §4.6).
 * Legal ONLY when `readyToEvolve` — and by design this function's ONLY
 * call site is the EVOLVE_PIP reducer arm (the player's tap): evolution
 * is player-witnessed, NEVER applied by TICK or CATCHUP. Grep-proof:
 * nothing else in the repo may call applyEvolution.
 *
 * Effect: the live `speciesId` flips to the target species; the variant
 * selected by `lastGiftItemId` (default fallback) is recorded together
 * with `evolvedAt = at` in `pip.evolved`; `readyToEvolve` clears. Needs,
 * personality, age (`ageMs`/`happinessIntegral`/`hatchedAt`), activity,
 * and the immutable birth `genome` are all KEPT untouched.
 */
export function applyEvolution(
  pip: PipState,
  registry: SpeciesEvolutionRegistry,
  at: number,
): ApplyEvolutionResult {
  if (!pip.readyToEvolve) return { ok: false, reason: "notReady" };
  const result = checkEvolution(pip, registry);
  if (result === null) return { ok: false, reason: "noEvolution" };
  return {
    ok: true,
    result,
    pip: {
      ...pip,
      speciesId: result.targetSpeciesId,
      readyToEvolve: false,
      evolved: { variantId: result.variantId, evolvedAt: at },
    },
  };
}
