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
  | { readonly kind: "xpBonus"; readonly fraction: number };

export type BuildingEffectKind = BuildingEffect["kind"];
