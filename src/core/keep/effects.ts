/**
 * Keep-wide building effects (docs/progression-bible.md §3) — the answer
 * to "just lovely" / "reasons to build": `state.keep.placements` → ONE
 * aggregated, ALREADY-CAPPED value (`ResolvedKeepEffects`) that every other
 * system consults. This module owns the AGGREGATION; the seam that threads
 * its result into `core/pips/needs.ts`, `core/pips/catchup.ts`,
 * `core/expeditions/index.ts` and `core/eggs/index.ts` is this same
 * ownership (round 2F orchestrator brief) and is documented at each of
 * those call sites.
 *
 * PURE and DERIVED, never stored: a Keep with nothing placed resolves to
 * `IDENTITY_KEEP_EFFECTS` (every multiplier 1, every reduction/bonus 0) —
 * the whole reason every wiring call site below can default to it and
 * leave every pre-2F fixture in this repo byte-identical (bible §8.2).
 *
 * SUM-THEN-CLAMP, applied per channel exactly once (bible §3.1 rule 3),
 * with the one documented exception the bible's own worked arithmetic
 * requires: the two MULTIPLIER channels (`restSpeed`, `expeditionSpeed`,
 * `incubationSpeed`) compose by MULTIPLYING every placed effect's own
 * multiplier together (a multiplier IS a "how many times", so two of them
 * stack the way ×1.25 and ×1.20 always have — Bed + Sun Bunks is bible
 * §3.4's own worked "×1.50, under 1.60" = 1.25 × 1.20, and two Beacons is
 * its own "→ 0.846, clamped to 0.85" = 0.92 × 0.92); the four FRACTION/
 * POINTS channels (`comfort`, `expeditionLoot`, `eggChancePoints`,
 * `xpBonus`) are summed additively, matching the bible's own "Bowl −6%,
 * Larder −8%, Meadow Green set −7% → −21% of −25% max" example. Either
 * way, the clamp itself happens exactly once, here, never per-item (bible
 * §3 header).
 *
 * `expeditionLootBonusChance` and `eggChanceBonusPoints` are returned
 * UNCLAMPED — bible §3.3 is explicit that these two channels have "no
 * entry" in `effectCaps` on purpose: they feed 2C's EXISTING shared,
 * already-clamped channels (`retention.loot.bonusRollChanceMax` /
 * `eggChanceBonusPointsMax`, `core/progression/multipliers.ts`) alongside
 * Curious/mastery/streak/events, and clamping twice would just make the
 * Comfort readout's arithmetic lie about where the real ceiling is.
 */

import { tuning as contentTuning } from "../../content/tuning";
import { placeables as contentPlaceables } from "../../content/placeables";
import { decorations as contentDecorations } from "../../content/decorations";
import { decorSets as contentDecorSets } from "../../content/decorSets";
import type { DecorSetDef } from "../../content/decorSets";
import type { BuildingEffect } from "../../content/buildingEffects";
import { NEED_IDS } from "../pips/types";
import type { NeedId } from "../pips/types";
import type { KeepState } from "./index";

/** Structural view of one placement-bearing content entry, as this module
 * needs it — both `PlaceableDef` and `DecorationDef` satisfy it (spec §2
 * rule 5: ids are opaque here). */
export interface EffectItemView {
  readonly effects?: readonly BuildingEffect[];
}

export type EffectItemRegistryView = Readonly<Record<string, EffectItemView>>;

/** The slice of tuning the aggregation reads (injectable for tests, same
 * pattern as every sibling core/ module). `content/tuning.ts` satisfies
 * it in full. */
export interface KeepEffectsTuning {
  readonly progression: {
    readonly effectCaps: {
      readonly comfortReductionMax: number;
      readonly restSpeedMax: number;
      readonly expeditionSpeedMin: number;
      readonly incubationSpeedMin: number;
      readonly xpBonusMax: number;
    };
    readonly setBonus: {
      readonly minMembersTier1: number;
      readonly minMembersTier2: number;
      readonly tier1LiveAtKeepLevel: number;
      readonly tier2LiveAtKeepLevel: number;
    };
  };
  /**
   * ROUND 2J FIX STAGE — the three channels this round wired. Structurally
   * OPTIONAL so the ~dozen bare `{ progression: {...} }` tuning fixtures
   * across `core/keep`'s own tests keep compiling; an absent block means
   * "no clamp beyond the identity", which is exactly what an unbuilt Keep
   * resolves to anyway.
   *
   * `buildingRemedyMax` is the tighter BUILDING-SOURCED aggregate: a plain
   * item's effects contribute per placement, so ten Poultice Shelves is
   * ten contributions, and `lifecycle.ailments.contractReductionMax`
   * (0.60) is far too loose to be that clamp on its own.
   */
  readonly crafting?: {
    readonly speedMin?: number;
    readonly buildingRemedyMax?: {
      readonly contractReduction?: number;
      readonly cureBonus?: number;
    };
  };
  readonly lifecycle?: {
    readonly lifespan?: { readonly buildingBonusMax?: number };
  };
}

/** Injectable content, defaulting to the real merged registries (same
 * pattern as `core/keep`'s own `PlacementItemRegistryView`). */
export interface KeepEffectsContent {
  readonly items?: EffectItemRegistryView;
  readonly sets?: readonly DecorSetDef[];
  readonly tuning?: KeepEffectsTuning;
}

const DEFAULT_ITEMS: EffectItemRegistryView = (() => {
  const items: Record<string, EffectItemView> = {};
  for (const def of contentPlaceables) items[def.id] = def;
  for (const def of contentDecorations) items[def.id] = def;
  return items;
})();

/** One active themed-set bonus — descriptive (the Build sheet / Comfort
 * readout's "Tideline ✓5" line, bible §3.5/§4.3); the effect's numeric
 * contribution is already folded into the totals below, so nothing reads
 * this list to compute anything. */
export interface ActiveSetBonus {
  readonly setId: string;
  readonly tier: 1 | 2;
  readonly effect: BuildingEffect;
}

/**
 * The one aggregated value every consulting system reads. `comfort` is a
 * per-need REDUCTION FRACTION (0.06 = "6% slower"), matching the Comfort
 * readout's arithmetic; `keepComfortMultipliers` below does the one
 * reduction→multiplier conversion `core/pips/needs.ts` wants.
 */
export interface ResolvedKeepEffects {
  readonly comfort: Readonly<Record<NeedId, number>>;
  readonly restSpeedMultiplier: number;
  readonly expeditionSpeedMultiplier: number;
  readonly expeditionLootBonusChance: number;
  readonly eggChanceBonusPoints: number;
  readonly incubationSpeedMultiplier: number;
  readonly xpBonusFraction: number;
  /**
   * ROUND 2J FIX STAGE — the `remedy` channel, summed once and clamped
   * once at `tuning.crafting.buildingRemedyMax`. `ailmentContractReduction`
   * is handed to `core/pips/ailment.ts`'s `rollContraction`
   * (`buildingContractReduction`); `ailmentCureBonus` to `attemptCure`.
   * Both 0 on an unbuilt Keep — the identity those call sites already
   * default to.
   */
  readonly ailmentContractReduction: number;
  readonly ailmentCureBonus: number;
  /** ROUND 2J FIX STAGE — the `longevity` channel, summed once and clamped
   * once at `tuning.lifecycle.lifespan.buildingBonusMax`. Handed to
   * `core/pips/lifecycle.ts`'s `lifespanMs` (`buildingLongevity`). */
  readonly lifespanBonusFraction: number;
  /** ROUND 2J FIX STAGE — the `craftSpeed` channel, composed by PRODUCT
   * (it is a rate) and clamped once at `tuning.crafting.speedMin`. Handed
   * to `core/crafting`'s `effectiveCraftDurationMs`
   * (`buildingCraftSpeedMultiplier`), which applies the Pip-level factor
   * and the composite floor on top. */
  readonly craftSpeedMultiplier: number;
  /** jobIds hosted by a CURRENTLY PLACED station — descriptive only
   * (bible §3.1: the `job` effect kind is "made explicit on the card").
   * `core/keep/jobs.ts`'s own `stationItemId` registry scan is the actual
   * hosting mechanism and reads nothing from here. */
  readonly hostedJobIds: readonly string[];
  readonly activeSetBonuses: readonly ActiveSetBonus[];
}

export const IDENTITY_KEEP_EFFECTS: ResolvedKeepEffects = {
  comfort: { hunger: 0, cleanliness: 0, happiness: 0, energy: 0 },
  restSpeedMultiplier: 1,
  expeditionSpeedMultiplier: 1,
  expeditionLootBonusChance: 0,
  eggChanceBonusPoints: 0,
  incubationSpeedMultiplier: 1,
  xpBonusFraction: 0,
  ailmentContractReduction: 0,
  ailmentCureBonus: 0,
  lifespanBonusFraction: 0,
  craftSpeedMultiplier: 1,
  hostedJobIds: [],
  activeSetBonuses: [],
};

interface Accumulator {
  readonly comfort: Record<NeedId, number>;
  restSpeedProduct: number;
  expeditionSpeedProduct: number;
  incubationSpeedProduct: number;
  expeditionLootBonusChance: number;
  eggChanceBonusPoints: number;
  xpBonusFraction: number;
  ailmentContractReduction: number;
  ailmentCureBonus: number;
  lifespanBonusFraction: number;
  craftSpeedProduct: number;
  readonly jobIds: Set<string>;
}

function newAccumulator(): Accumulator {
  return {
    comfort: { hunger: 0, cleanliness: 0, happiness: 0, energy: 0 },
    restSpeedProduct: 1,
    expeditionSpeedProduct: 1,
    incubationSpeedProduct: 1,
    expeditionLootBonusChance: 0,
    eggChanceBonusPoints: 0,
    xpBonusFraction: 0,
    ailmentContractReduction: 0,
    ailmentCureBonus: 0,
    lifespanBonusFraction: 0,
    craftSpeedProduct: 1,
    jobIds: new Set(),
  };
}

/** Fold ONE effect into the running accumulator — the "sum" (or
 * "multiply", for the two rate channels — see module doc) half of
 * sum-then-clamp. Shared by per-item effects and the chosen set bonus, so
 * a set's effect is folded through the identical path an item's is. */
function foldEffect(acc: Accumulator, effect: BuildingEffect): void {
  switch (effect.kind) {
    case "comfort":
      if (effect.need === "all") {
        for (const need of NEED_IDS) acc.comfort[need] += effect.decayReduction;
      } else {
        acc.comfort[effect.need] += effect.decayReduction;
      }
      break;
    case "restSpeed":
      acc.restSpeedProduct *= effect.multiplier;
      break;
    case "expeditionSpeed":
      acc.expeditionSpeedProduct *= effect.multiplier;
      break;
    case "incubationSpeed":
      acc.incubationSpeedProduct *= effect.multiplier;
      break;
    case "expeditionLoot":
      acc.expeditionLootBonusChance += effect.bonusRollChance;
      break;
    case "eggChancePoints":
      acc.eggChanceBonusPoints += effect.points;
      break;
    case "job":
      acc.jobIds.add(effect.jobId);
      break;
    case "xpBonus":
      acc.xpBonusFraction += effect.fraction;
      break;
    // ROUND 2J FIX STAGE — the three kinds round 2H/2J named and neither
    // wired. Fractions sum (like `comfort`/`xpBonus`); the rate multiplies
    // (like `restSpeed`/`expeditionSpeed`). Clamped once, below.
    case "remedy":
      acc.ailmentContractReduction += effect.contractReduction;
      acc.ailmentCureBonus += effect.cureBonus;
      break;
    case "longevity":
      acc.lifespanBonusFraction += effect.bonus;
      break;
    case "craftSpeed":
      acc.craftSpeedProduct *= effect.multiplier;
      break;
  }
}

/**
 * The aggregation. Pure — derives everything from `keep.placements` (plus
 * the Keep's level, which gates WHEN set bonuses turn on) and the content
 * registries; nothing is stored, nothing is memoised (a Keep tops out
 * around 80 placements — recomputing this on every TICK/CATCHUP dispatch
 * is cheap, and memoising it would be a second place for a stale-cache bug
 * to hide for no measured benefit).
 */
export function resolveKeepEffects(
  keep: KeepState,
  keepLevel: number,
  content: KeepEffectsContent = {},
): ResolvedKeepEffects {
  const items = content.items ?? DEFAULT_ITEMS;
  const sets = content.sets ?? contentDecorSets;
  const tuning = content.tuning ?? contentTuning;
  const caps = tuning.progression.effectCaps;
  const setBonusCfg = tuning.progression.setBonus;
  const remedyMax = tuning.crafting?.buildingRemedyMax ?? {};

  const acc = newAccumulator();
  const placedIds = new Set<string>();
  for (const placement of Object.values(keep.placements)) {
    placedIds.add(placement.itemId);
    const item = items[placement.itemId];
    if (item?.effects === undefined) continue;
    for (const effect of item.effects) foldEffect(acc, effect);
  }

  const activeSetBonuses: ActiveSetBonus[] = [];
  for (const set of sets) {
    const distinctPlaced = set.memberItemIds.filter((id) => placedIds.has(id)).length;
    let chosen: { readonly tier: 1 | 2; readonly effect: BuildingEffect } | null = null;
    if (
      distinctPlaced >= setBonusCfg.minMembersTier2 &&
      keepLevel >= setBonusCfg.tier2LiveAtKeepLevel
    ) {
      chosen = { tier: 2, effect: set.bonusAt5 };
    } else if (
      distinctPlaced >= setBonusCfg.minMembersTier1 &&
      keepLevel >= setBonusCfg.tier1LiveAtKeepLevel
    ) {
      chosen = { tier: 1, effect: set.bonusAt3 };
    }
    if (chosen !== null) {
      foldEffect(acc, chosen.effect);
      activeSetBonuses.push({ setId: set.id, tier: chosen.tier, effect: chosen.effect });
    }
  }

  const comfort = {} as Record<NeedId, number>;
  for (const need of NEED_IDS) {
    comfort[need] = Math.min(Math.max(acc.comfort[need], 0), caps.comfortReductionMax);
  }

  return {
    comfort,
    restSpeedMultiplier: Math.min(Math.max(acc.restSpeedProduct, 1), caps.restSpeedMax),
    expeditionSpeedMultiplier: Math.min(
      Math.max(acc.expeditionSpeedProduct, caps.expeditionSpeedMin),
      1,
    ),
    expeditionLootBonusChance: Math.max(acc.expeditionLootBonusChance, 0),
    eggChanceBonusPoints: Math.max(acc.eggChanceBonusPoints, 0),
    incubationSpeedMultiplier: Math.min(
      Math.max(acc.incubationSpeedProduct, caps.incubationSpeedMin),
      1,
    ),
    xpBonusFraction: Math.min(Math.max(acc.xpBonusFraction, 0), caps.xpBonusMax),
    ailmentContractReduction: Math.min(
      Math.max(acc.ailmentContractReduction, 0),
      remedyMax.contractReduction ?? Infinity,
    ),
    ailmentCureBonus: Math.min(
      Math.max(acc.ailmentCureBonus, 0),
      remedyMax.cureBonus ?? Infinity,
    ),
    lifespanBonusFraction: Math.min(
      Math.max(acc.lifespanBonusFraction, 0),
      tuning.lifecycle?.lifespan?.buildingBonusMax ?? Infinity,
    ),
    craftSpeedMultiplier: Math.min(
      Math.max(acc.craftSpeedProduct, tuning.crafting?.speedMin ?? 0),
      1,
    ),
    hostedJobIds: Array.from(acc.jobIds),
    activeSetBonuses,
  };
}

/**
 * The one reduction→multiplier conversion `core/pips/needs.ts`'s
 * `effectiveRates` wants (bible §3.2's fifth factor): `1 − comfort[need]`,
 * per need. Kept out of `resolveKeepEffects` itself so the aggregated
 * value stays in the same "reduction fraction" units the Comfort readout
 * displays (bible §4.3) — this converter is the one place that cares about
 * the OTHER unit.
 */
export function keepComfortMultipliers(
  effects: ResolvedKeepEffects,
): Readonly<Record<NeedId, number>> {
  const result = {} as Record<NeedId, number>;
  for (const need of NEED_IDS) result[need] = 1 - effects.comfort[need];
  return result;
}
