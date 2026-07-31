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
import { awardPipXp, evolvePipXp, lifespanBonusFor } from "./level";
import type { LevelCurveTuning, LevelXpTuning } from "./level";

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

/** The Pip-XP award slice `applyEvolution` needs (bible §1.1 row 5):
 * both the curve (to recompute `level` from the new `pipXp`) and the
 * award table (to read `xp.evolve`). `content/tuning.ts` satisfies both
 * halves in one object, same as every other core/ module's structural
 * intersection type (e.g. `catchup.ts`'s `CatchupTuning`). */
export type EvolvePipXpTuning = LevelCurveTuning & LevelXpTuning;

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
 *
 * ROUND 2H (bible §1.1 row 5): this Pip's OWN evolve Pip XP (`pipXp`/
 * `level`) is also awarded here — the one new effect this round adds,
 * because this function's existing sole-call-site contract already IS
 * the qualifying-moment gate that award would otherwise need duplicated
 * elsewhere (`core/state.ts`'s `applyPipXpForAction`).
 */
export function applyEvolution(
  pip: PipState,
  registry: SpeciesEvolutionRegistry,
  at: number,
  tuning: EvolvePipXpTuning = contentTuning,
): ApplyEvolutionResult {
  if (!pip.readyToEvolve) return { ok: false, reason: "notReady" };
  const result = checkEvolution(pip, registry);
  if (result === null) return { ok: false, reason: "noEvolution" };
  const evolved: PipState = {
    ...pip,
    speciesId: result.targetSpeciesId,
    readyToEvolve: false,
    evolved: { variantId: result.variantId, evolvedAt: at },
  };
  return { ok: true, result, pip: awardPipXp(evolved, evolvePipXp(tuning), tuning) };
}

// ---------------------------------------------------------------------------
// LIFESPAN & AGEING (spec §16 v1.5, docs/lifecycle-bible.md §2) — promise 3
// ("old age is peaceful") and half of promise 2/5 (the other half is
// `needs.ts`'s `lifeMs` accrual, which this module's `lifespanMs`/
// `updateAging` consume but never advance themselves — this file never
// touches a clock or advances time, exactly like the life-stage/evolution
// code above).
// ---------------------------------------------------------------------------

/**
 * THE AGEING RULE's tuning slice (bible §2.2/§2.3), as core reads it.
 * `lifecycle.level.lifespanBonus` is optional and chained (matches
 * `LevelEffectsTuning`'s own contract in `pips/level.ts`) so a fixture
 * that only cares about the lifespan formula itself need not also stub
 * out the whole level-effects table.
 */
export interface LifespanTuning {
  readonly lifecycle: {
    readonly lifespan: {
      /** A Pip's baseline lifespan before any multiplier (bible: 7 days
       * of RATED time). */
      readonly baseMs: number;
      /** Lifetime-avg-happiness → multiplier bands (bible §2.3),
       * evaluated highest-`min`-first — the same "band table" convention
       * `content/tuning.ts`'s other banded lookups already use. */
      readonly careQualityBands: readonly {
        readonly min: number;
        readonly multiplier: number;
      }[];
      /** Cap on the summed BUILDING `longevity` contribution (bible:
       * 0.25 — three already-shipped placeables sum to 0.21). This
       * round wires no building into the channel yet (see `lifespanMs`'s
       * doc comment); the cap still clamps whatever a future caller
       * supplies. */
      readonly buildingBonusMax: number;
      /** Season boundaries as a fraction of `lifeMs / lifespanMs` (bible
       * §2.4) — DERIVED, never stored. */
      readonly seasons: {
        readonly young: number;
        readonly prime: number;
        readonly seasoned: number;
      };
    };
    readonly level?: {
      readonly lifespanBonus?: readonly number[];
    };
  };
}

/** Highest-`min`-first band lookup (bible §2.3) — `1` (no change) if the
 * table is empty or nothing matches (defensive; content always covers
 * `min: 0`). */
function careQualityMultiplier(avgHappiness: number, tuning: LifespanTuning): number {
  for (const band of tuning.lifecycle.lifespan.careQualityBands) {
    if (avgHappiness >= band.min) return band.multiplier;
  }
  return 1;
}

/**
 * A Pip's current lifespan, in ms (bible §2.3):
 * `baseMs × careQuality(lifetimeAvgHappiness) × (1 + level.lifespanBonus)
 * × (1 + min(buildingLongevity, buildingBonusMax))`.
 *
 * DERIVED, never stored — recomputed live every time, so a lifespan can
 * GROW after the fact and a Pip can leave the Elder season again (bible:
 * "the kindest possible reading of the mechanic", explicitly allowed).
 *
 * `buildingLongevity` is the Keep's summed `longevity` BuildingEffect
 * contribution (bible §2.3's `nest-warmer`/`sun-bunks`/`larder`) —
 * THIS ROUND WIRES NO CALLER FOR IT (the building-effect channel itself
 * is out of this round's scope; `core/keep/effects.ts` has no
 * `longevity` kind yet). The parameter exists so the formula is already
 * complete and correct for whoever adds that channel; omitted (`0`) is
 * exactly an unbuilt Keep's true value, so every call site in this round
 * is byte-correct without it.
 */
export function lifespanMs(
  pip: PipState,
  tuning: LifespanTuning = contentTuning,
  buildingLongevity = 0,
): number {
  const cfg = tuning.lifecycle.lifespan;
  const quality = careQualityMultiplier(lifetimeAvgHappiness(pip), tuning);
  const levelBonus = lifespanBonusFor(pip, tuning);
  const buildingBonus = Math.min(Math.max(buildingLongevity, 0), cfg.buildingBonusMax);
  return cfg.baseMs * quality * (1 + levelBonus) * (1 + buildingBonus);
}

/** The Pip card's season word (bible §2.4). `"pipling"` mirrors the
 * existing `LifeStage.Pipling` life stage rather than a fraction of a
 * lifespan a Pipling hasn't started living in earnest yet; Adults derive
 * their word from `lifeMs / lifespanMs` alone. */
export type PipSeason = "pipling" | "young" | "prime" | "seasoned" | "elder";

/**
 * DERIVED, never stored (bible §2.4) — retuning `seasons` re-grades every
 * Pip with no migration, the same discipline `core/progression/mastery.ts`'s
 * tier tables use. Mechanically inert: nothing reads this to change a
 * rate, a need, or a refusal (P3, bible §2.4) — it is a word on a card.
 */
export function pipSeason(
  pip: PipState,
  tuning: LifespanTuning = contentTuning,
  buildingLongevity = 0,
): PipSeason {
  if (pip.lifeStage === LifeStage.Pipling) return "pipling";
  const span = lifespanMs(pip, tuning, buildingLongevity);
  const fraction = span > 0 ? (pip.lifeMs ?? 0) / span : 0;
  const { young, prime, seasoned } = tuning.lifecycle.lifespan.seasons;
  if (fraction < young) return "young";
  if (fraction < prime) return "prime";
  if (fraction < seasoned) return "seasoned";
  return "elder";
}

/**
 * Set `readyToRetire` once `lifeMs` reaches this Pip's (live-computed)
 * lifespan (bible §2.5) — a FLAG, nothing else. Old age changes no rate,
 * no need, no refusal: `effectiveRates`/`canReceiveCare`/expedition
 * legality must all be deep-equal before and after this flag flips (P3).
 *
 * Sticky, exactly like `updateEvolutionReadiness` above: once announced,
 * never revoked — even though `lifespanMs` can grow back past `lifeMs`
 * if care improves afterward, un-announcing a retirement would read as
 * punishment (the identical reasoning `updateEvolutionReadiness`'s doc
 * comment already gives).
 *
 * Call ONLY from TICK and CATCHUP (mirrors `updateEvolutionReadiness`'s
 * own contract exactly). `RETIRE_PIP` is the ONLY action that may ever
 * move a Pip into the Long Meadow (promise 3) — this function never
 * touches `state.sanctuary`, and `core/sanctuary/index.ts`'s
 * `retireRefusal` already refuses at `sanctuary.minActivePips` regardless
 * of WHY the player is retiring (promise 5), so an age-ready LAST Pip is
 * refused by the exact same shipped check a manual retirement is.
 */
export function updateAging(
  pip: PipState,
  tuning: LifespanTuning = contentTuning,
  buildingLongevity = 0,
): PipState {
  if (pip.readyToRetire === true) return pip;
  if ((pip.lifeMs ?? 0) < lifespanMs(pip, tuning, buildingLongevity)) return pip;
  return { ...pip, readyToRetire: true };
}
