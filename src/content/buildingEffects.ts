/**
 * Building effect vocabulary (docs/progression-bible.md §3.1) — the typed,
 * content-defined shape that makes a placed item DO something mechanical
 * instead of being "just lovely" (the owner's diagnosis this round
 * answers, alongside "the Pips will use this").
 *
 * Pure data SHAPE only — no logic, no tuning numbers, no registry lookups.
 * Aggregating every placed item's effects into ONE capped value per
 * channel lives in `core/keep/effects.ts`; `content/placeables.ts` and
 * `content/decorations.ts` attach an optional `effects?: readonly
 * BuildingEffect[]` list (absent ≡ `[]`, matching every other optional
 * content field's convention) to say what a given item's cards mean.
 *
 * THE ONE HARD RULE (bible §0.3/§3.1 rule 1, pinned by
 * `content/buildingEffects.test.ts`): every effect strictly HELPS. There is
 * no variant of any kind below with the opposite sign — no effect may ever
 * raise a decay rate, slow a trip down, lengthen an incubation, or shrink a
 * chance. "Buildings shorten the chore; they never trivialise care" is
 * enforced by the CAPS in `tuning.progression.effectCaps`
 * (`core/keep/effects.ts` clamps, never this file), not by anything here —
 * this file only says what KIND of good thing an effect is.
 */

import type { NeedId } from "../core/pips";

export type BuildingEffect =
  /** Slows one need's decay (or all four) Keep-wide, as a FRACTION removed
   * (0.06 = "6% slower"). `decayReduction` must be > 0. */
  | { readonly kind: "comfort"; readonly need: NeedId | "all"; readonly decayReduction: number }
  /** Multiplies the Resting energy-regen rate. `multiplier` must be > 1. */
  | { readonly kind: "restSpeed"; readonly multiplier: number }
  /** Multiplies expedition duration. `multiplier` must be < 1. */
  | { readonly kind: "expeditionSpeed"; readonly multiplier: number }
  /** Additive bonus-roll chance — feeds 2C's ONE summed, capped loot
   * channel (`retention.loot.bonusRollChanceMax`), never a second one.
   * `bonusRollChance` must be > 0. */
  | { readonly kind: "expeditionLoot"; readonly bonusRollChance: number }
  /** Additive egg-chance POINTS — feeds 2C's separate, separately-capped
   * channel (`retention.loot.eggChanceBonusPointsMax`). `points` must be
   * > 0. */
  | { readonly kind: "eggChancePoints"; readonly points: number }
  /** Multiplies egg incubation time. `multiplier` must be < 1. */
  | { readonly kind: "incubationSpeed"; readonly multiplier: number }
  /** Hosts a job (the existing `jobs.stationItemId` relationship,
   * `core/keep/jobs.ts`'s own registry scan — made EXPLICIT on the card so
   * "the Pips will use this" becomes "A Pip can work here — Gathering, one
   * find every 10 minutes."). Purely descriptive: this effect does not
   * change whether the job actually runs. */
  | { readonly kind: "job"; readonly jobId: string }
  /** Multiplies every Keep XP grant. `fraction` must be > 0. */
  | { readonly kind: "xpBonus"; readonly fraction: number }
  /**
   * ROUND 2J FIX STAGE (docs/lifecycle-bible.md §2.3/§3.5, economy-bible
   * §3.6) — AILMENTS, on both sides. `contractReduction` lowers the odds
   * of catching one at all (fed to `core/pips/ailment.ts`'s already-
   * shipped `rollContraction` `buildingContractReduction` parameter);
   * `cureBonus` raises the odds a cure attempt lands (fed to `attemptCure`
   * through the same shipped `cureBonusMax` clamp). Either may be 0; both
   * must be ≥ 0 — like every other kind here, this one only ever helps.
   *
   * A plain item's effects contribute PER PLACEMENT, so ten Poultice
   * Shelves is ten contributions. `contractReductionMax` (0.60) is far too
   * loose to be that clamp on its own, hence the tighter building-sourced
   * aggregate `tuning.crafting.buildingRemedyMax` — summed once, clamped
   * once, in `core/keep/effects.ts`.
   */
  | {
      readonly kind: "remedy";
      readonly contractReduction: number;
      readonly cureBonus: number;
    }
  /**
   * ROUND 2J FIX STAGE (docs/lifecycle-bible.md §2.2) — a longer life, as
   * a FRACTION added (0.06 = "+6%"). Fed to `core/pips/lifecycle.ts`'s
   * already-shipped `lifespanMs` `buildingLongevity` parameter and its
   * already-shipped `lifecycle.lifespan.buildingBonusMax` (0.25) clamp.
   * `bonus` must be > 0.
   *
   * The lifecycle bible asserted three shipped placeables already carried
   * this (nest-warmer 0.06, sun-bunks 0.10, larder 0.05) and its "a
   * devoted player's Pip lives 15.6 days" arithmetic depended on it — but
   * the effect kind did not exist, so `buildingLongevity` was permanently
   * 0 and the true maximum was 12.85 days. This is the patch that makes
   * that bible's own number true.
   */
  | { readonly kind: "longevity"; readonly bonus: number }
  /**
   * ROUND 2J FIX STAGE (docs/economy-bible.md §3.6) — multiplies a craft's
   * duration at every Craft Table. `multiplier` must be < 1. Composes by
   * PRODUCT (it is a rate, like `restSpeed`/`expeditionSpeed`), clamped
   * once at `tuning.crafting.speedMin`, then the crafting Pip's own level
   * factor and the composite floor apply in `core/crafting`.
   *
   * Without this kind, `CraftingTuning.speedMin` was a clamp nothing could
   * ever reach: `buildingCraftSpeedMultiplier` had no caller and always
   * defaulted to 1.
   */
  | { readonly kind: "craftSpeed"; readonly multiplier: number }
  /**
   * ROUND 2K (docs/liveliness-bible.md §1.1) — DRAWS WILD PIPS to the Keep.
   * Purely descriptive here, exactly like `job`: `core/attractions/` owns
   * the visit schedule and reads the registry through its own structural
   * view (`AttractionEffectLike`), deliberately independent of this union
   * so it activates the instant this member lands, with zero code changes
   * on the core side (already shipped and tested against injected
   * content).
   *
   * `biomeId` is a `content/expeditions.ts` id: the visitor pool is that
   * biome's `eggSpecies` INTERSECTED WITH the species the player has
   * already caught (I1 — attractions can never advance the Album; the
   * partition is enforced in `core/attractions`, not here). Must be
   * non-empty and must resolve to a real expedition — `content/validate.ts`
   * checks both, because an attraction with neither schedules nothing and
   * leaves no card able to say why.
   *
   * This member DISCHARGES the spec §12 seam that used to live as
   * `content/keep.ts`'s `KeepUpgradeEffect` "attraction" no-op arm
   * (deleted in this same patch): a capability that lives in the same
   * vocabulary as `job`/`comfort`/`remedy`/`longevity` gets the Build
   * sheet card, the icon badge and `resolveKeepEffects` aggregation for
   * free, which a one-entry upgrade registry never could. See
   * `content/placeables.ts`'s six attraction stations.
   */
  | { readonly kind: "attraction"; readonly biomeId: string };

/**
 * ✅ ROUND 2J FIX STAGE — THE ROUND 2H NOTE THAT USED TO LIVE HERE IS
 * DISCHARGED. It read: "`remedy` and `longevity` are DELIBERATELY NOT
 * ADDED HERE… it belongs with whoever next wires `core/keep/effects.ts`'s
 * `foldEffect` for these two kinds". This round is that patch, and it took
 * `craftSpeed` with it, because all three are the same coordinated
 * content+core+ui edit: widen the union here, fold in
 * `core/keep/effects.ts`, add a case to `ui/icons.ts`'s exhaustive
 * `BADGE_FOR_EFFECT_KIND`, add a generated line to `ui/buildMode.ts`'s
 * exhaustive `describeEffect`, and read the resolved value at the one core
 * call site that already had the parameter waiting.
 *
 * What it fixed, concretely: the Poultice Shelf — a named tier-5 headline
 * costing `wood 7, fiber 6` and described as "everything you'd want on a
 * bad night" — had no `effects` array at all and did literally nothing.
 * `lifespanMs`'s `buildingLongevity` was likewise permanently 0, so the
 * lifecycle bible's "a devoted player's Pip lives 15.6 days" was
 * unreachable (the true maximum was 12.85). And `CraftingTuning.speedMin`
 * was a clamp with no channel that could reach it.
 */
export type BuildingEffectKind = BuildingEffect["kind"];
