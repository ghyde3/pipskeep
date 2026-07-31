/**
 * BREEDING + LINEAGE EGGS (spec §12 unfenced, spec §16 v1.5,
 * docs/lifecycle-bible.md §5–§6) — promise 4's payoff (a lost Pip's line is
 * genuinely recoverable) and the succession mechanic (`combineGenomes`'s
 * long-reserved seam, live at last).
 *
 * Two sources of a "lineage" child, sharing one inheritance calculator:
 *   - A LINEAGE EGG (bible §5): found on a later trip back to the biome
 *     that took a lost Pip. `attemptLineageFind` below is called from the
 *     SAME settle point loot/ailment rolls fire from
 *     (`core/expeditions/index.ts`'s `settleExpeditionReturn`), consuming
 *     `GameState.lineageEggs` (`core/pips/ailment.ts`'s `LineageEggSeed`,
 *     written by `resolveAilments`'s TRUE LOSS branch).
 *   - A BRED EGG (bible §6): `combineForBreeding` between two eligible
 *     LIVING Pips, wired into `core/state.ts`'s BREED_PIPS action.
 *
 * Both inherit through the SAME three steps, computed once at the moment
 * of finding/breeding (never re-derived at hatch — by hatch time a lost
 * Pip's seed is the only surviving record of it, and a bred parent may
 * itself have since retired or even been lost, exactly the reasoning
 * bible §6.1 gives for combining a bred egg's genome at BREED time):
 *
 *   1. `combineGenomes` (genome.ts's shipped, unit-tested, exactly-6-roll
 *      seam, THE breeding seam spec §12 reserved since Phase 4) — for a
 *      lineage egg the SAME genome is passed as both parents (bible §5.4:
 *      "the child is the parent, give or take a freckle"), which is
 *      exactly the degenerate case genome.ts's own module doc already
 *      anticipates ("every parent-pick degenerate while the mutation
 *      branch still fires"). `genome.test.ts` does not move.
 *   2. Shininess, rolled OUTSIDE `combineGenomes` (which hard-codes
 *      `shiny: false` to keep its 6-roll contract) from the SAME stream,
 *      ALWAYS consuming its roll — mirrors `rollGenome`'s own "the shiny
 *      check always consumes its roll" discipline (spec §2 rule 3) — so
 *      cursor determinism never depends on which parent (if either) was
 *      shiny.
 *   3. A level share and inherited resistances, both pure arithmetic —
 *      no RNG.
 *
 * RNG: everything above draws from ONE new stream, `"lineage"` (bible
 * §9.2: "New RNG streams: … `lineage` (find + combine + shiny)").
 * `attemptLineageFind` additionally spends its own find-roll from the
 * SAME stream, ahead of the three steps above, ONLY when a qualifying
 * unfound seed exists for the biome being returned from (see that
 * function's own doc) — the zero-unfound-seed case costs the stream
 * nothing, so every fixture/test that never seeds `lineageEggs` (which is
 * every one that predates this file) stays byte-identical.
 *
 * THE ALBUM CANNOT BE TRIVIALISED (bible §6.3/§9.1) — restated here
 * because it is this file's OWN load-bearing property, not merely
 * inherited: `combineGenomes` picks `speciesId` from one of the genomes it
 * is handed, consulting no rarity table and no biome pool, and
 * `genome.speciesId` is always the BIRTH species (evolution is v1.3's
 * standing rule — never inherited). So neither a lineage nor a bred egg
 * can ever produce a species the player does not already effectively own,
 * or an evolved form. Consequently NEITHER path here ever touches
 * `state.eggPity` or a biome's egg-species pool — the caller
 * (`core/state.ts`'s `HATCH_EGG` arm) reads `Egg.lineageGenome` directly
 * and skips `rollGenome`/the pity ladder entirely, exactly as it skips
 * them for nothing else.
 *
 * Purity: no clock (`at`/`now` come from the caller), no `Math.random()`
 * (an `RngStream` is threaded in, its cursor lives in `GameState.rngState`).
 * ZERO tuning literals; every number is read from the tuning object
 * (defaults to `content/tuning.ts`, injectable for tests).
 */

import { tuning as contentTuning } from "../../content/tuning";
import { combineGenomes } from "./genome";
import type { CombineGenomesContent } from "./genome";
import { LifeStage, PipActivity } from "./types";
import type { PipId, PipState, TraitGenome } from "./types";
import { isSulking } from "./machine";
import { pipLevel } from "./level";
import type { RngStream } from "../rng";
import type { LineageEggSeed } from "./ailment";

/** Named RNG stream for lineage finds, genome combination (both lineage
 * and breeding), and the shiny-inherit roll (bible §9.2). Cursor lives in
 * `GameState.rngState`, exactly like every other named stream. */
export const LINEAGE_STREAM = "lineage";

/** The tuning slice this module reads. `content/tuning.ts`'s
 * `lifecycle.lineage` (+ `lifecycle.ailments.inheritedResistance`, reused
 * verbatim — bible §3.6/§5.4/§6.2 all cite the SAME 0.25, one channel, not
 * three tunables to keep in sync — + `breeding.mutationChance`, the
 * pre-existing genome.ts seam number) satisfies this in full. */
export interface LineageTuning {
  readonly lifecycle: {
    readonly lineage: {
      readonly findChanceFirstTrip: number;
      /** A qualifying trip is "guaranteed" once `misses + 1` reaches this
       * (bible §5.2: "guaranteed on the second"). */
      readonly guaranteedAfterTrips: number;
      readonly lostParentLevelShare: number;
      readonly bredLevelShare: number;
      readonly shinyInheritChance: number;
      readonly breedMinLevel: number;
      readonly breedMinNeed: number;
      readonly breedCooldownMs: number;
      readonly maxClutchesPerPip: number;
      readonly breedingIncubationMs: number;
    };
    readonly ailments: {
      readonly inheritedResistance: number;
    };
  };
  readonly breeding: {
    readonly mutationChance: number;
  };
}

// ---------------------------------------------------------------------------
// SHARED INHERITANCE (bible §5.4/§6.2) — the three steps every child
// (lineage or bred) inherits through.
// ---------------------------------------------------------------------------

/** What a child inherits from its parent(s), computed ONCE at the moment
 * of finding/breeding — never re-derived at hatch (module doc). This is
 * the shape `Egg.lineageGenome`/`lineageParentIds`/`lineageLevel`/
 * `lineageResistances`/`lineageGeneration` (`core/eggs/index.ts`) carry
 * until `HATCH_EGG` reads them. */
export interface LineageInheritance {
  readonly genome: TraitGenome;
  readonly parentIds: readonly PipId[];
  readonly level: number;
  readonly resistances: Readonly<Record<string, number>>;
  readonly generation: number;
}

/** `1 + floor((base − 1) × share)` (bible §5.4/§6.2's shared formula):
 * `base` is the lost parent's own level for a lineage egg, or the MEAN of
 * both parents' levels for a bred egg. Floored at 1 defensively — `base`
 * is always `>= 1` by construction (`pipLevel`/`LineageEggSeed.level`),
 * so the `+1` alone already guarantees this, but a share > 1 from a
 * misconfigured tuning object must still never produce a level below 1. */
function childLevelFromShare(base: number, share: number): number {
  return Math.max(1, 1 + Math.floor((base - 1) * share));
}

/** A parent's scars → the child's inherited resistances (bible
 * §3.6/§5.4/§6.2): every scarred ailment id at `inheritedResistance`
 * (0.25). For a bred child this is the UNION of both parents' scars —
 * safe to just overwrite duplicates since the value is identical either
 * way (the SAME tuning constant, not a per-parent one). */
function resistancesFromScars(
  scars: readonly string[],
  resistance: number,
): Readonly<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const id of scars) out[id] = resistance;
  return out;
}

/** Roll shininess for a child OUTSIDE `combineGenomes` (module doc):
 * ALWAYS consumes exactly one roll from `stream` — mirrors `rollGenome`'s
 * "the shiny check always consumes its roll" discipline — and only
 * APPLIES the result when at least one parent was itself shiny (bible:
 * "losing a shiny Pip must not quietly delete a 1-in-40 thing"; §6.2:
 * "applies if EITHER parent is shiny"). A non-shiny lineage/pair can never
 * produce a shiny child — the roll still fires, it just cannot matter. */
function rollInheritedShiny(
  anyParentShiny: boolean,
  stream: RngStream,
  tuning: LineageTuning,
): boolean {
  const rolled = stream.chance(tuning.lifecycle.lineage.shinyInheritChance);
  return anyParentShiny && rolled;
}

// ---------------------------------------------------------------------------
// LINEAGE EGGS (bible §5) — promise 4's payoff.
// ---------------------------------------------------------------------------

/** The OLDEST unfound seed for `expeditionId` (FIFO by `seededAt`) — the
 * bible does not directly address two Pips lost to the same biome at
 * once; queue fairness (earliest loss found first) is the one reading
 * consistent with §5.2's "One roll per qualifying trip" being singular
 * (a trip targets exactly one seed, not one roll per seed). `undefined`
 * when `expeditionId` carries no unfound seed at all — the caller's
 * signal to consume ZERO rolls (module doc). */
export function oldestUnfoundSeedFor(
  seeds: readonly LineageEggSeed[],
  expeditionId: string,
): LineageEggSeed | undefined {
  let oldest: LineageEggSeed | undefined;
  for (const seed of seeds) {
    if (seed.expeditionId !== expeditionId) continue;
    if (oldest === undefined || seed.seededAt < oldest.seededAt) oldest = seed;
  }
  return oldest;
}

/** Find chance for a seed's NEXT qualifying trip (bible §5.2: "0.40 on the
 * first trip; GUARANTEED on the second" — generalised via
 * `guaranteedAfterTrips` rather than hardcoding "the second"). */
export function lineageFindChance(
  seed: LineageEggSeed,
  tuning: LineageTuning = contentTuning,
): number {
  const cfg = tuning.lifecycle.lineage;
  return seed.misses + 1 >= cfg.guaranteedAfterTrips ? 1 : cfg.findChanceFirstTrip;
}

/** One found seed's full inheritance (bible §5.4): the SAME genome passed
 * as both parents to `combineGenomes` (module doc — the degenerate,
 * single-parent case genome.ts's own doc already anticipates), a
 * shiny-inherit roll, the lost parent's OWN level shared at
 * `lostParentLevelShare`, and its scars turned into resistances. Consumes
 * exactly 7 rolls from `stream` (6 for `combineGenomes`, 1 for shiny). */
function inheritFromLineageSeed(
  seed: LineageEggSeed,
  stream: RngStream,
  tuning: LineageTuning,
  content: CombineGenomesContent,
): LineageInheritance {
  const combined = combineGenomes(seed.genome, seed.genome, stream, content);
  const shiny = rollInheritedShiny(seed.genome.shiny, stream, tuning);
  return {
    genome: { ...combined, shiny },
    parentIds: [seed.pipId],
    level: childLevelFromShare(seed.level, tuning.lifecycle.lineage.lostParentLevelShare),
    resistances: resistancesFromScars(
      seed.scars,
      tuning.lifecycle.ailments.inheritedResistance,
    ),
    generation: seed.generation + 1,
  };
}

/** One qualifying trip's outcome (bible §5.2/§5.3):
 * - `"none"` — no unfound seed for this biome. Zero rolls consumed.
 * - `"miss"` — a seed exists but this roll didn't find it. One roll
 *   consumed; `seeds` carries the SAME seed with `misses` incremented.
 * - `"found"` — the seed is removed from `seeds` and its full inheritance
 *   is resolved. 8 rolls consumed total (1 find + 7 inherit). */
export type LineageFindOutcome =
  | { readonly kind: "none" }
  | { readonly kind: "miss"; readonly seeds: readonly LineageEggSeed[] }
  | {
      readonly kind: "found";
      readonly seed: LineageEggSeed;
      readonly seeds: readonly LineageEggSeed[];
      readonly inheritance: LineageInheritance;
    };

/**
 * Attempt to find a lineage egg on a completed trip to `expeditionId`
 * (bible §5.2). Called from the SAME settle point loot/ailment rolls fire
 * from (`core/expeditions/index.ts`'s `settleExpeditionReturn`), AFTER
 * both of those rolls, so this function's own roll(s) can never shift
 * either of THEIR cursors — determinism holds from the seeded expedition
 * streams exactly as before this file existed. Zero rolls when `seeds`
 * carries no unfound seed for `expeditionId` (`oldestUnfoundSeedFor`
 * returning `undefined`) — the natural, automatic gate every
 * pre-lineage-egg fixture/test relies on (module doc).
 */
export function attemptLineageFind(
  seeds: readonly LineageEggSeed[],
  expeditionId: string,
  stream: RngStream,
  tuning: LineageTuning = contentTuning,
  content: CombineGenomesContent = {},
): LineageFindOutcome {
  const target = oldestUnfoundSeedFor(seeds, expeditionId);
  if (target === undefined) return { kind: "none" };

  const chance = lineageFindChance(target, tuning);
  const hit = stream.chance(chance);
  if (!hit) {
    const seedsAfter = seeds.map((s) =>
      s === target ? { ...s, misses: s.misses + 1 } : s,
    );
    return { kind: "miss", seeds: seedsAfter };
  }

  const inheritance = inheritFromLineageSeed(target, stream, tuning, content);
  const seedsAfter = seeds.filter((s) => s !== target);
  return { kind: "found", seed: target, seeds: seedsAfter, inheritance };
}

// ---------------------------------------------------------------------------
// BREEDING (bible §6, spec §12 unfenced) — `combineGenomes` goes live.
// ---------------------------------------------------------------------------

/** Why a `BREED_PIPS` request was refused. Every reason here is
 * STRUCTURAL — "the world said no", never Pip-voiced (there is no
 * personality-flavoured refusal line for breeding, unlike ASSIGN_
 * EXPEDITION's Sulking/Pipling refusals — mirrors that action's own
 * `busy`/`locked`/`occupied` reasons instead). */
export type BreedRefusalReason =
  | "unknownPip"
  | "samePip"
  | "notAdult"
  | "levelTooLow"
  | "ailing"
  | "busy"
  | "sulking"
  | "needsTooLow"
  | "cooldown"
  | "clutchesExhausted";

/** One pip's own eligibility gates (bible §6.1's table, checked in the
 * order listed there), independent of its partner. `undefined` =
 * eligible. */
function ownBreedRefusal(
  pip: PipState,
  now: number,
  tuning: LineageTuning,
): BreedRefusalReason | undefined {
  const cfg = tuning.lifecycle.lineage;
  if (pip.lifeStage !== LifeStage.Adult) return "notAdult";
  if (pipLevel(pip) < cfg.breedMinLevel) return "levelTooLow";
  if (pip.ailment != null) return "ailing";
  if (
    pip.activity === PipActivity.OnExpedition ||
    pip.activity === PipActivity.Returning
  ) {
    return "busy";
  }
  if (isSulking(pip)) return "sulking";
  if (Object.values(pip.needs).some((n) => n < cfg.breedMinNeed)) return "needsTooLow";
  if (pip.lastBredAt != null && now - pip.lastBredAt < cfg.breedCooldownMs) {
    return "cooldown";
  }
  if ((pip.clutches ?? 0) >= cfg.maxClutchesPerPip) return "clutchesExhausted";
  return undefined;
}

/** `breedEligibility`'s result. `pipId` names WHICH pip a per-pip refusal
 * is about — absent for the two refusals that aren't about a specific
 * eligible-but-failing pip (`samePip`; `unknownPip` sets it to whichever
 * id was missing). */
export interface BreedEligibility {
  readonly ok: boolean;
  readonly reason?: BreedRefusalReason;
  readonly pipId?: PipId;
}

/**
 * Breeding eligibility (bible §6.1's table): not the same Pip, both known,
 * both Adults, both level ≥ `breedMinLevel`, neither ailing, neither
 * OnExpedition/Returning, neither sulking, all eight needs (four per pip)
 * ≥ `breedMinNeed`, per-pip cooldown, lifetime clutch cap. Pure — no RNG,
 * no mutation; checks `a` fully before `b` (the first failing pip is the
 * one reported).
 */
export function breedEligibility(
  pips: Readonly<Record<PipId, PipState>>,
  aId: PipId,
  bId: PipId,
  now: number,
  tuning: LineageTuning = contentTuning,
): BreedEligibility {
  if (aId === bId) return { ok: false, reason: "samePip" };
  const a = pips[aId];
  if (a === undefined) return { ok: false, reason: "unknownPip", pipId: aId };
  const b = pips[bId];
  if (b === undefined) return { ok: false, reason: "unknownPip", pipId: bId };

  const aReason = ownBreedRefusal(a, now, tuning);
  if (aReason !== undefined) return { ok: false, reason: aReason, pipId: aId };
  const bReason = ownBreedRefusal(b, now, tuning);
  if (bReason !== undefined) return { ok: false, reason: bReason, pipId: bId };

  return { ok: true };
}

/**
 * Combine two ELIGIBLE parents into their child's inheritance (bible
 * §6.2). Consumes exactly 7 rolls from `stream` (6 for `combineGenomes`, 1
 * for shiny), always. Callers are expected to have already confirmed
 * `breedEligibility` — this function does not re-check it, mirroring
 * `assignExpedition`'s own "the caller validated, this just does the
 * work" boundary once a request is known-legal.
 */
export function combineForBreeding(
  a: PipState,
  b: PipState,
  stream: RngStream,
  tuning: LineageTuning = contentTuning,
  content: CombineGenomesContent = {},
): LineageInheritance {
  const combined = combineGenomes(a.genome, b.genome, stream, content);
  const anyShiny = a.genome.shiny || b.genome.shiny;
  const shiny = rollInheritedShiny(anyShiny, stream, tuning);
  const meanLevel = (pipLevel(a) + pipLevel(b)) / 2;
  const scars = [...new Set([...(a.scars ?? []), ...(b.scars ?? [])])];
  return {
    genome: { ...combined, shiny },
    parentIds: [a.id, b.id],
    level: childLevelFromShare(meanLevel, tuning.lifecycle.lineage.bredLevelShare),
    resistances: resistancesFromScars(scars, tuning.lifecycle.ailments.inheritedResistance),
    generation: Math.max(a.generation ?? 1, b.generation ?? 1) + 1,
  };
}
