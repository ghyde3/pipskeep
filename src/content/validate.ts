/**
 * Content validation (spec §3): run at boot in dev mode. Broken evolution
 * targets, empty loot tables, missing species/item refs, negative costs,
 * and underfilled dialogue pools (the Phase 2 authoring pass landed —
 * spec §3's 8-line minimum is now a hard requirement) → loud
 * console.error.
 */

import { RESOURCE_IDS, type ResourceBundle } from "../core/economy";
import { NEED_IDS } from "../core/pips";
import type { SpeciesDef, SpeciesId } from "./species";
import { species as defaultSpecies } from "./species";
import { tuning as defaultTuning } from "./tuning";
import type { FoodDef } from "./foods";
import { foods as defaultFoods } from "./foods";
import type { ExpeditionDef } from "./expeditions";
import { expeditions as defaultExpeditions } from "./expeditions";
import type { PersonalityDef, PersonalityId } from "./personalities";
import { personalities as defaultPersonalities } from "./personalities";
import type { DialoguePools } from "./dialogue";
import { dialogue as defaultDialogue, findUnderfilledDialoguePools } from "./dialogue";
import type { KeepLevelDef, KeepUpgradeDef } from "./keep";
import { keepLevels as defaultKeepLevels, keepUpgrades as defaultKeepUpgrades } from "./keep";
import type { DecorationDef } from "./decorations";
import { decorations as defaultDecorations } from "./decorations";
import type { PlaceableDef } from "./placeables";
import { placeables as defaultPlaceables } from "./placeables";
import type { JobDef } from "./jobs";
import { jobs as defaultJobs } from "./jobs";
import type { SpeciesPaletteDef } from "./palette";
import { speciesPalettes as defaultSpeciesPalettes } from "./palette";
import type { SpeciesLines } from "./speciesLines";
import { speciesLines as defaultSpeciesLines } from "./speciesLines";
import type { BuildingEffect } from "./buildingEffects";
import type { DecorSetDef } from "./decorSets";
import { decorSets as defaultDecorSets } from "./decorSets";
import { MOTIF_IDS, BADGE_IDS, type IconSpec } from "./icons";
import type { BountyTemplate } from "./bountyTemplates";
import { BOUNTY_TEMPLATES as defaultBountyTemplates } from "./bountyTemplates";
import type { AilmentDef, AilmentId } from "./ailments";
import { ailments as defaultAilments, POULTICE_ITEM_ID } from "./ailments";
import { SAFE_TRAIL_COPY, RISKY_TRAIL_COPY } from "./expeditions";
import type { RecipeDef, RecipeId } from "./recipes";
import { recipes as defaultRecipes } from "./recipes";

export interface ContentBundle {
  species: Readonly<Record<SpeciesId, SpeciesDef>>;
  foods: Readonly<Record<string, FoodDef>>;
  expeditions: Readonly<Record<string, ExpeditionDef>>;
  personalities: Readonly<Record<PersonalityId, PersonalityDef>>;
  dialogue: DialoguePools;
  keepLevels: readonly KeepLevelDef[];
  keepUpgrades: Readonly<Record<string, KeepUpgradeDef>>;
  decorations: readonly DecorationDef[];
  placeables: readonly PlaceableDef[];
  /** Themed decoration sets (progression bible §3.5); keyed by registry
   * order, not id — `content/decorSets.ts` is the source of truth. */
  decorSets: readonly DecorSetDef[];
  jobs: Readonly<Record<string, JobDef>>;
  /** Species palette tokens (spec §11); keyed by species id. */
  speciesPalettes: Readonly<Record<string, SpeciesPaletteDef>>;
  /** Species flavor lines (content-bible §6.2); keyed by species id. */
  speciesLines: Readonly<Record<SpeciesId, SpeciesLines>>;
  /** Rarity → hatch weight (spec §7.3, content-bible round 2B's
   * zero-weight "lineage" tier): used to catch an expedition's
   * `eggSpecies` pool that resolves to zero hatchable species. */
  rarityWeights: Readonly<Record<string, number>>;
  /** Daily bounty templates (retention bible §5.2) — validated for
   * Keep-tier agreement with their own co-gates (progression bible §8.5). */
  bountyTemplates: readonly BountyTemplate[];
  /** Ailment registry (docs/lifecycle-bible.md §3), keyed by id — the
   * ROUND 2H checks below cross-reference it against `expeditions` (every
   * biome's danger flag) and `foods` (the cure item must be real). */
  ailments: Readonly<Record<AilmentId, AilmentDef>>;
  /** ROUND 2J (docs/economy-bible.md §3–§4) — the Craft Table's book.
   * Checked below for real inputs/outputs, a real unlock tier, and a
   * duration inside `tuning.crafting`'s bounds. */
  recipes: Readonly<Record<RecipeId, RecipeDef>>;
  /** The tuning slice the tier-gate check reads (progression bible §2.4's
   * "unlock currency" table), PLUS (round 2H) the slice the ailment checks
   * below need. Injected like every other registry so a test can hand in
   * a deliberately-dead ladder — or a broken lifecycle number — and see
   * it rejected. */
  tuning: {
    readonly offlineRateCapMs: number;
    readonly progression: {
      readonly gridGrowth: Readonly<Record<number, { cols: number; rows: number }>>;
      readonly rosterCapBonusByLevel: Readonly<Record<number, number>>;
      readonly setBonus: {
        readonly tier1LiveAtKeepLevel: number;
        readonly tier2LiveAtKeepLevel: number;
      };
    };
    readonly lifecycle: {
      readonly ailments: {
        readonly minDurationMs: number;
        readonly poulticeCureChance: number;
        readonly devotedCareCureChance: number;
      };
    };
    /** ROUND 2J — the recipe-duration bounds every recipe must sit inside
     * (docs/economy-bible.md §3.4: "nothing crafts faster than the game's
     * own slowest existing rhythm"). */
    readonly crafting: {
      readonly minDurationMs: number;
      readonly maxDurationMs: number;
    };
  };
}

export const defaultContentBundle: ContentBundle = {
  species: defaultSpecies,
  foods: defaultFoods,
  expeditions: defaultExpeditions,
  personalities: defaultPersonalities,
  dialogue: defaultDialogue,
  keepLevels: defaultKeepLevels,
  keepUpgrades: defaultKeepUpgrades,
  decorations: defaultDecorations,
  placeables: defaultPlaceables,
  decorSets: defaultDecorSets,
  jobs: defaultJobs,
  speciesPalettes: defaultSpeciesPalettes,
  speciesLines: defaultSpeciesLines,
  rarityWeights: defaultTuning.eggs.rarityWeights,
  bountyTemplates: defaultBountyTemplates,
  ailments: defaultAilments,
  recipes: defaultRecipes,
  tuning: defaultTuning,
};

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

function checkCostBundle(label: string, cost: ResourceBundle, errors: string[]): void {
  for (const [resourceId, amount] of Object.entries(cost)) {
    if (amount === undefined) continue;
    if (!(RESOURCE_IDS as readonly string[]).includes(resourceId)) {
      errors.push(`${label}: unknown resource "${resourceId}" in cost`);
    }
    if (amount < 0) {
      errors.push(`${label}: negative cost ${resourceId}=${amount}`);
    }
  }
}

/**
 * ROUND 2F (progression bible §3, §4.2) — a `BuildingEffect`'s internal
 * references must resolve, or the effect is exactly the kind of
 * "written to state, invisible/broken to the player" bug ruling #5 bans:
 * a comfort effect naming a need that doesn't exist would silently
 * contribute NOTHING to `core/keep/effects.ts`'s per-need sum (a typo'd
 * "hapiness" reads as an unknown key and is dropped), and a `job` effect
 * naming a job the registry doesn't have would describe a station as
 * hosting work nobody can ever actually assign.
 */
function checkBuildingEffect(
  label: string,
  effect: BuildingEffect,
  content: ContentBundle,
  errors: string[],
): void {
  if (effect.kind === "comfort" && effect.need !== "all") {
    if (!(NEED_IDS as readonly string[]).includes(effect.need)) {
      errors.push(`${label}: comfort effect references unknown need "${effect.need}"`);
    }
  }
  if (effect.kind === "job" && !(effect.jobId in content.jobs)) {
    errors.push(`${label}: job effect references unknown job "${effect.jobId}"`);
  }
  // ROUND 2K (docs/liveliness-bible.md §1.1/§1.3) — an attraction's whole
  // identity IS its biome affinity: `biomeId` selects the species pool
  // `core/attractions`' `visitorPool()` draws from (`eggSpecies ∩ caught`).
  // Missing or unresolvable is the same silent-failure shape as an unknown
  // job or need above — the card would have nothing to name and the
  // schedule would never fire, with nothing anywhere to say why.
  if (effect.kind === "attraction") {
    if (effect.biomeId.trim().length === 0) {
      errors.push(`${label}: attraction effect has no biome/species affinity`);
    } else if (!(effect.biomeId in content.expeditions)) {
      errors.push(
        `${label}: attraction effect names unknown biome "${effect.biomeId}" — no species pool exists there`,
      );
    }
  }
}

/** A catalog item's `icon` (progression bible §4.2) must name a motif (and,
 * if present, a badge) this game actually knows how to draw — an
 * unauthored id would render as nothing on the Build sheet, which is the
 * same "silently broken" failure mode as every other check in this file. */
/**
 * RULING #2, ACTUALLY ENFORCED: every tier from 2 up must GATE at least one
 * concrete piece of content at EXACTLY that tier.
 *
 * The check this replaces only asserted that a tier's prose was non-empty —
 * i.e. it verified the HEADLINE STRING existed, never that anything happens
 * when you buy the tier. A review mutation proved the hole: moving both
 * tier-8 placeables (`workbench`, `sun-bunks`) from `unlockKeepLevel: 8` to 9
 * left the whole suite green at 1,969 tests, while `content/keep.ts` went on
 * advertising "the Workbench, the Mending job, the Sun Bunks" — and the
 * Mending job died with it, since `jobs.ts` hosts it on the Workbench. Keep
 * level 8 became a pure number bump: the exact dead tier the bible says there
 * are none of.
 *
 * Every mechanism the bible §2.4 table names as an "unlock currency" counts as
 * a gate, so this is the same list the design is written against:
 *   - a placeable's `unlockKeepLevel`
 *   - an expedition's `unlockKeepLevel`
 *   - `progression.gridGrowth[N]` (more ground)
 *   - `progression.rosterCapBonusByLevel[N]` (another bed)
 *   - a keep upgrade's `prerequisiteLevel` (Cozy Bunks)
 *   - `progression.setBonus.tier1/tier2LiveAtKeepLevel` (an effect KIND
 *     switching on)
 *
 * `levelCosts[N]` is deliberately NOT a gate: charging for a tier is a price,
 * not a reward, and counting it would let a tier justify itself by being
 * expensive. Decorations carry no tier gate at all by design, so they cannot
 * be one either.
 */
function checkEveryTierGatesSomething(
  content: ContentBundle,
  errors: string[],
): void {
  const prog = content.tuning.progression;
  for (const level of content.keepLevels) {
    const n = level.level;
    if (n <= 1) continue; // tier 1 IS the starting state, not an unlock

    const gates: string[] = [];
    for (const p of content.placeables) {
      if (p.unlockKeepLevel === n) gates.push(`placeable "${p.id}"`);
    }
    for (const e of Object.values(content.expeditions)) {
      if (e.unlockKeepLevel === n) gates.push(`expedition "${e.id}"`);
    }
    for (const u of Object.values(content.keepUpgrades)) {
      if (u.prerequisiteLevel === n) gates.push(`keep upgrade "${u.id}"`);
    }
    if (prog.gridGrowth[n] !== undefined) gates.push("grid growth");
    if (prog.rosterCapBonusByLevel[n] !== undefined) gates.push("roster cap bonus");
    if (prog.setBonus.tier1LiveAtKeepLevel === n) gates.push("3-of-a-set bonuses");
    if (prog.setBonus.tier2LiveAtKeepLevel === n) gates.push("5-of-a-set bonuses");

    if (gates.length === 0) {
      errors.push(
        `keep level ${n}: NOTHING in content gates at this tier — it advertises "${level.headline}" ` +
          `but no placeable, expedition, job station, keep upgrade, grid growth, roster bonus or ` +
          `set-bonus tier switches on at exactly ${n}. That is a dead tier (progression bible §2).`,
      );
    }
  }
}

/**
 * ROUND 2J (docs/economy-bible.md §6.4) — the recipe-side twin of
 * `core/economy/reachability.test.ts`'s deadlock guard, reimplemented here
 * because that suite lives in `core/` and this round's content agent may
 * not edit it. Same shape as the shipped guard, restated for recipes: a
 * recipe is priced like a placeable, not like a Keep level — it is
 * PAYABLE AT the tier it appears on (a player standing at that tier may
 * already have banked resources from it), not the tier before. Jobs are
 * deliberately excluded, exactly as the core suite excludes them, so a
 * station's own cost can never bootstrap itself into "reachable".
 */
function itemsObtainableFromExpeditionsAt(
  content: ContentBundle,
  level: number,
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const expedition of Object.values(content.expeditions)) {
    if (expedition.unlockKeepLevel > level) continue;
    for (const entry of expedition.lootTable) {
      if (entry.weight > 0) ids.add(entry.itemId);
    }
  }
  return ids;
}

/**
 * ROUND 2J — "an output nothing can use" (the ninth-dead-feature shape,
 * specialised to crafting): a recipe's `"item"` output must be something a
 * player can actually DO something with. Three ways an item earns that:
 * it restores something on Feed/Give Item (a real food), it IS the
 * ailment cure item (`POULTICE_ITEM_ID` — zero food value by design, but a
 * real mechanical use), or it is an evolution gift-variant KEY on some
 * species (`SpeciesDef.evolution.giftVariants`). An item satisfying none
 * of the three would be craftable, land in the Satchel, and do precisely
 * nothing forever — "written to state" with no "visible to the player"
 * half (spec §16 v1.3's standing rule, extended to crafted goods).
 */
function isCraftedItemUseful(content: ContentBundle, itemId: string): boolean {
  const food = content.foods[itemId];
  if (food === undefined) return false; // unknown output — reported separately
  if (food.hungerRestore > 0) return true;
  if (food.sideEffects) {
    for (const amount of Object.values(food.sideEffects)) {
      if (amount !== undefined && amount > 0) return true;
    }
  }
  if (itemId === POULTICE_ITEM_ID) return true;
  for (const s of Object.values(content.species)) {
    if (s.evolution && itemId in s.evolution.giftVariants) return true;
  }
  return false;
}

function checkIcon(label: string, icon: IconSpec, errors: string[]): void {
  if (!(MOTIF_IDS as readonly string[]).includes(icon.motif)) {
    errors.push(`${label}: unknown icon motif "${icon.motif}"`);
  }
  if (icon.badge !== undefined && !(BADGE_IDS as readonly string[]).includes(icon.badge)) {
    errors.push(`${label}: unknown icon badge "${icon.badge}"`);
  }
}

/** Pure check pass — no logging. `validateContent` wraps this with logging. */
export function collectContentIssues(
  content: ContentBundle = defaultContentBundle,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Every id a loot table or gift-variant map may legally reference.
  const knownItemIds = new Set<string>([
    ...RESOURCE_IDS,
    ...Object.keys(content.foods),
  ]);
  const knownKeepLevels = new Set(content.keepLevels.map((l) => l.level));

  // --- Species: broken evolution targets, missing item refs, and
  // non-empty sprite variant lists (genome rolls pick from them) ---
  for (const s of Object.values(content.species)) {
    if (s.sprite.palettes.length === 0) {
      errors.push(`species "${s.id}": empty sprite palette list`);
    }
    if (s.sprite.patterns.length === 0) {
      errors.push(`species "${s.id}": empty sprite pattern list`);
    }
    if (s.evolution) {
      if (!(s.evolution.targetSpeciesId in content.species)) {
        errors.push(
          `species "${s.id}": broken evolution target "${s.evolution.targetSpeciesId}"`,
        );
      }
      if (s.evolution.minAgeMs <= 0) {
        errors.push(`species "${s.id}": evolution minAgeMs must be > 0`);
      }
      if (
        s.evolution.minLifetimeAvgHappiness < 0 ||
        s.evolution.minLifetimeAvgHappiness > 100
      ) {
        errors.push(
          `species "${s.id}": evolution minLifetimeAvgHappiness out of [0, 100]`,
        );
      }
      for (const giftItemId of Object.keys(s.evolution.giftVariants)) {
        if (!knownItemIds.has(giftItemId)) {
          errors.push(
            `species "${s.id}": evolution gift item "${giftItemId}" does not exist`,
          );
        }
      }
    }
  }

  // --- Evolution variants (content-bible §1.7/§8.2.2): a gift variant or
  // default variant id that resolves to no authored palette entry doesn't
  // crash — `resolvePipPalette` falls back gracefully — but it silently
  // renders as the fallback look instead of the distinct one the gift was
  // supposed to unlock. That is exactly the "gift variants are invisible"
  // bug this round fixes on the data side; catch a re-regression loudly.
  // Scoped to species whose evolution target itself resolves (a broken
  // `targetSpeciesId` is already its own error above; re-flagging every
  // variant under a species that doesn't exist would just be noise).
  for (const s of Object.values(content.species)) {
    if (!s.evolution || !(s.evolution.targetSpeciesId in content.species)) continue;
    const targetPalette = content.speciesPalettes[s.evolution.targetSpeciesId];
    const variantIds = new Set([
      ...Object.values(s.evolution.giftVariants),
      s.evolution.defaultVariantId,
    ]);
    for (const variantId of variantIds) {
      if (targetPalette === undefined || !(variantId in targetPalette.variants)) {
        warnings.push(
          `species "${s.id}": evolution variant "${variantId}" has no authored palette on "${s.evolution.targetSpeciesId}" (renders as the fallback look)`,
        );
      }
    }
  }

  // --- Species flavor lines (content-bible §6.2): every species has an
  // entry, and every line is non-empty (the tuple TYPE already enforces
  // "exactly four"; this is the runtime "every species is covered" half)
  for (const s of Object.values(content.species)) {
    const lines = content.speciesLines[s.id];
    if (lines === undefined) {
      errors.push(`species "${s.id}": missing speciesLines entry`);
      continue;
    }
    if (lines.some((line) => line.trim().length === 0)) {
      errors.push(`species "${s.id}": speciesLines has an empty line`);
    }
  }

  // --- Foods: sane effects, non-negative costs, real flavor text ---
  for (const f of Object.values(content.foods)) {
    if (f.hungerRestore < 0) {
      errors.push(`food "${f.id}": negative hungerRestore ${f.hungerRestore}`);
    }
    // Side effects are bonuses (spec §5: Happiness/Energy are cured by
    // Play/Pet/Rest), but a NEGATIVE one would silently punish a Feed —
    // every restore in this game only ever adds. Round 2B content
    // expansion: the same "negative restore" failure mode Feed's
    // hungerRestore has always guarded against, extended to sideEffects.
    if (f.sideEffects) {
      for (const [effect, amount] of Object.entries(f.sideEffects)) {
        if (amount !== undefined && amount < 0) {
          errors.push(`food "${f.id}": negative ${effect} side effect ${amount}`);
        }
      }
    }
    if (f.flavor.trim().length === 0) {
      errors.push(`food "${f.id}": missing flavor text`);
    }
    checkCostBundle(`food "${f.id}"`, f.cost, errors);
  }

  // --- Expeditions: empty loot tables, missing item refs, sane numbers ---
  for (const e of Object.values(content.expeditions)) {
    if (e.lootTable.length === 0) {
      errors.push(`expedition "${e.id}": empty loot table`);
    }
    for (const entry of e.lootTable) {
      if (!knownItemIds.has(entry.itemId)) {
        errors.push(
          `expedition "${e.id}": loot item "${entry.itemId}" does not exist`,
        );
      }
      if (entry.weight <= 0) {
        errors.push(
          `expedition "${e.id}": loot item "${entry.itemId}" has non-positive weight ${entry.weight}`,
        );
      }
    }
    if (e.eggChance < 0 || e.eggChance > 1) {
      errors.push(`expedition "${e.id}": eggChance ${e.eggChance} out of [0, 1]`);
    }
    if (e.durationMs <= 0) {
      errors.push(`expedition "${e.id}": durationMs must be > 0`);
    }
    if (!Number.isInteger(e.lootRolls) || e.lootRolls <= 0) {
      errors.push(
        `expedition "${e.id}": lootRolls must be a positive integer, got ${e.lootRolls}`,
      );
    }
    if (!knownKeepLevels.has(e.unlockKeepLevel)) {
      errors.push(
        `expedition "${e.id}": unlockKeepLevel ${e.unlockKeepLevel} is not a defined Keep level`,
      );
    }
  }

  // --- Ailments (round 2H, docs/lifecycle-bible.md §3): the five promises
  // are DATA relationships, not hopes, and a broken one here is exactly
  // the "invisible until the exact moment a player hits it" failure this
  // file exists to catch loudly at boot instead of in a playtest. ---
  const dangerousExpeditionIds = new Set(
    Object.values(content.ailments).map((a) => a.fromExpeditionId),
  );

  // A biome flagged dangerous with no ailment pool (or vice versa) is
  // shield one (bible §7.1, "no hidden risk, ever") broken by construction:
  // the risk line on the send-off card must agree with whether the biome
  // can actually inflict anything.
  for (const e of Object.values(content.expeditions)) {
    const isDangerous = dangerousExpeditionIds.has(e.id);
    if (e.riskCopy !== SAFE_TRAIL_COPY && e.riskCopy !== RISKY_TRAIL_COPY) {
      errors.push(
        `expedition "${e.id}": riskCopy "${e.riskCopy}" is not one of the two shipped risk-line strings (bible §7.1)`,
      );
    } else if (isDangerous && e.riskCopy !== RISKY_TRAIL_COPY) {
      errors.push(
        `expedition "${e.id}": has an ailment pool but riskCopy says "${e.riskCopy}" — a dangerous biome must say so (bible §7.1)`,
      );
    } else if (!isDangerous && e.riskCopy !== SAFE_TRAIL_COPY) {
      errors.push(
        `expedition "${e.id}": has no ailment pool but riskCopy says "${e.riskCopy}" — hidden safety is as misleading as hidden danger`,
      );
    }
  }

  for (const a of Object.values(content.ailments)) {
    if (!(a.fromExpeditionId in content.expeditions)) {
      errors.push(
        `ailment "${a.id}": fromExpeditionId "${a.fromExpeditionId}" is not a defined expedition`,
      );
    }
    if (a.contractChance <= 0 || a.contractChance > 1) {
      errors.push(`ailment "${a.id}": contractChance ${a.contractChance} out of (0, 1]`);
    }
    // A countdown shorter than the offline cap breaks promise 2 BY
    // CONSTRUCTION (bible §3.3 rule 1): a Pip who is healthy when the app
    // closes could go critical, or worse, during a single capped absence.
    if (a.totalMs <= content.tuning.offlineRateCapMs) {
      errors.push(
        `ailment "${a.id}": countdown ${a.totalMs}ms does not exceed offlineRateCapMs ${content.tuning.offlineRateCapMs}ms — a healthy Pip could turn critical during one absence, breaking promise 2 (bible §3.3 rule 1)`,
      );
    }
    if (a.totalMs < content.tuning.lifecycle.ailments.minDurationMs) {
      errors.push(
        `ailment "${a.id}": countdown ${a.totalMs}ms is shorter than lifecycle.ailments.minDurationMs (${content.tuning.lifecycle.ailments.minDurationMs}ms)`,
      );
    }
    if (a.flavor.trim().length === 0) {
      errors.push(`ailment "${a.id}": missing flavor text`);
    }
  }

  // A cure item that does not exist: the poultice route's item id must
  // resolve to something `core/pips/care.ts`'s `giveItem` can actually
  // hand out — the same `foods` oracle every other item reference uses.
  if (!(POULTICE_ITEM_ID in content.foods)) {
    errors.push(
      `ailments: cure item "${POULTICE_ITEM_ID}" (POULTICE_ITEM_ID) does not exist in the food/item registry`,
    );
  }

  // An ailment with no cure: the shared cure system (poultice + devoted
  // care) must have at least one route with real odds, or every ailment
  // in the game is unwinnable by construction — promise 1's "a real,
  // actionable chance to save them" would be false for the whole roster.
  {
    const cureCfg = content.tuning.lifecycle.ailments;
    if (cureCfg.poulticeCureChance <= 0 && cureCfg.devotedCareCureChance <= 0) {
      errors.push(
        "ailments: no cure route exists (poulticeCureChance and devotedCareCureChance are both non-positive) — every ailment would be unwinnable",
      );
    }
  }

  if (content.tuning.lifecycle.ailments.minDurationMs <= content.tuning.offlineRateCapMs) {
    errors.push(
      `lifecycle.ailments.minDurationMs (${content.tuning.lifecycle.ailments.minDurationMs}ms) must exceed offlineRateCapMs (${content.tuning.offlineRateCapMs}ms) — promise 2's whole guarantee rests on this inequality`,
    );
  }

  // --- Egg pools (round 2B, orchestrator ruling #1 — biome-themed egg
  // pools): every `eggSpecies` id must resolve to a real, HATCHABLE
  // species. `core/state.ts`'s `eggSpeciesPoolFor` silently falls back to
  // the whole registry when a pool resolves to zero hatchable species
  // (unknown ids, or every listed species is a zero-weight "lineage"
  // form) — which is exactly the "this content silently does nothing"
  // failure mode validation exists to catch loudly instead of at the
  // reducer boundary.
  for (const e of Object.values(content.expeditions)) {
    if (e.eggSpecies === undefined) continue;
    if (e.eggSpecies.length === 0) {
      errors.push(`expedition "${e.id}": eggSpecies is present but empty`);
      continue;
    }
    let hatchable = 0;
    for (const speciesId of e.eggSpecies) {
      const entry = content.species[speciesId];
      if (entry === undefined) {
        errors.push(
          `expedition "${e.id}": eggSpecies references unknown species "${speciesId}"`,
        );
        continue;
      }
      const weight = content.rarityWeights[entry.rarity] ?? 1;
      if (weight > 0) {
        hatchable += 1;
      } else {
        warnings.push(
          `expedition "${e.id}": eggSpecies includes "${speciesId}", whose rarity ("${entry.rarity}") has zero hatch weight — it can never actually hatch from this pool`,
        );
      }
    }
    if (hatchable === 0) {
      errors.push(
        `expedition "${e.id}": eggSpecies has no hatchable species (every listed id is unknown or zero-weight) — hatches from this biome would silently fall back to the whole registry`,
      );
    }
  }

  // --- Personalities: multipliers must be positive ---
  for (const p of Object.values(content.personalities)) {
    for (const [need, mult] of Object.entries(p.decayMultipliers)) {
      if (mult <= 0) {
        errors.push(
          `personality "${p.id}": non-positive decay multiplier ${need}=${mult}`,
        );
      }
    }
  }

  // --- Keep levels: non-negative resource-bundle costs, a headline, an
  // unlock list, and — the load-bearing one — a REAL CONTENT GATE at that
  // exact tier (progression bible §2/ruling #2: "a tier that only raises a
  // number is a dead tier, so there are none" — enforced, not just hoped) ---
  for (const level of content.keepLevels) {
    checkCostBundle(`keep level ${level.level}`, level.cost, errors);
    if (level.unlocks.length === 0) {
      errors.push(
        `keep level ${level.level}: no unlocks — a tier that only raises a number is a dead tier`,
      );
    }
    if (level.headline.trim().length === 0) {
      errors.push(
        `keep level ${level.level}: no headline — the XP bar has nothing to name as "Next: …"`,
      );
    } else if (level.headline.trimStart().startsWith("+")) {
      // The bar's only job is to name the carrot. A headline that opens with
      // "+2 rows of ground" makes it announce a NUMBER, which is what tiers 7
      // and 9 did when the bar read `unlocks[0]`.
      errors.push(
        `keep level ${level.level}: headline "${level.headline}" leads with a number — name the thing the tier hands over`,
      );
    }
  }
  checkEveryTierGatesSomething(content, errors);

  // --- Decorations: non-negative costs, sane footprints, a resolvable
  // icon, and every effect's own internal references (round 2F) ---
  for (const d of content.decorations) {
    checkCostBundle(`decoration "${d.id}"`, d.cost, errors);
    if (d.footprint.w <= 0 || d.footprint.h <= 0) {
      errors.push(
        `decoration "${d.id}": footprint ${d.footprint.w}x${d.footprint.h} must be positive`,
      );
    }
    if (d.spriteRef.length === 0) {
      errors.push(`decoration "${d.id}": missing spriteRef`);
    }
    if (d.flavor.trim().length === 0) {
      errors.push(`decoration "${d.id}": missing flavor text`);
    }
    checkIcon(`decoration "${d.id}"`, d.icon, errors);
    for (const effect of d.effects ?? []) {
      checkBuildingEffect(`decoration "${d.id}"`, effect, content, errors);
    }
  }

  // --- Placeables (spec §9): same bar as decorations, plus id
  // uniqueness ACROSS both registries — core/keep merges them into one
  // placement-item view, so a shared id would shadow a footprint ---
  const placementItemIds = new Set<string>();
  for (const d of content.decorations) placementItemIds.add(d.id);
  for (const pl of content.placeables) {
    checkCostBundle(`placeable "${pl.id}"`, pl.cost, errors);
    if (pl.footprint.w <= 0 || pl.footprint.h <= 0) {
      errors.push(
        `placeable "${pl.id}": footprint ${pl.footprint.w}x${pl.footprint.h} must be positive`,
      );
    }
    if (pl.spriteRef.length === 0) {
      errors.push(`placeable "${pl.id}": missing spriteRef`);
    }
    if (pl.flavor.trim().length === 0) {
      errors.push(`placeable "${pl.id}": missing flavor text`);
    }
    if (placementItemIds.has(pl.id)) {
      errors.push(
        `placeable "${pl.id}": id collides with another placement item`,
      );
    }
    placementItemIds.add(pl.id);
    if (!knownKeepLevels.has(pl.unlockKeepLevel)) {
      errors.push(
        `placeable "${pl.id}": unlockKeepLevel ${pl.unlockKeepLevel} is not a defined Keep level`,
      );
    }
    checkIcon(`placeable "${pl.id}"`, pl.icon, errors);
    for (const effect of pl.effects ?? []) {
      checkBuildingEffect(`placeable "${pl.id}"`, effect, content, errors);
    }
  }

  // --- Decoration sets (progression bible §3.5): every member id must
  // resolve to a real placement item, and both bonus tiers' effects must
  // themselves reference real needs/jobs ---
  for (const set of content.decorSets) {
    for (const memberId of set.memberItemIds) {
      if (!placementItemIds.has(memberId)) {
        errors.push(
          `decor set "${set.id}": member "${memberId}" does not exist`,
        );
      }
    }
    checkBuildingEffect(`decor set "${set.id}" bonusAt3`, set.bonusAt3, content, errors);
    checkBuildingEffect(`decor set "${set.id}" bonusAt5`, set.bonusAt5, content, errors);
  }

  // --- Keep upgrades (spec §3 registry): sane costs + prerequisites ---
  for (const upgrade of Object.values(content.keepUpgrades)) {
    checkCostBundle(`keep upgrade "${upgrade.id}"`, upgrade.cost, errors);
    if (!knownKeepLevels.has(upgrade.prerequisiteLevel)) {
      errors.push(
        `keep upgrade "${upgrade.id}": prerequisiteLevel ${upgrade.prerequisiteLevel} is not a defined Keep level`,
      );
    }
  }

  // --- Jobs (spec §6.2 registry): station must be a placeable, table
  // items must exist, positive weights, positive interval, real copy ---
  //
  // ROUND 2J (docs/economy-bible.md §3.2): `kind === "crafting"` jobs are
  // a QUEUE of recipes (`core/crafting`), not a weighted table on a fixed
  // interval — `intervalMs`/`table` are deliberately `0`/`[]` for them
  // (the job registry's OWN `content/jobs.ts` doc comment explains why
  // that is enough to make `core/keep/jobs.ts` skip them with no edit),
  // so those two checks are the ONLY ones this branches on.
  const placeableIds = new Set(content.placeables.map((pl) => pl.id));
  for (const job of Object.values(content.jobs)) {
    if (!placeableIds.has(job.stationItemId)) {
      errors.push(
        `job "${job.id}": station item "${job.stationItemId}" is not a placeable`,
      );
    }
    if (job.kind !== "crafting") {
      if (job.intervalMs <= 0) {
        errors.push(`job "${job.id}": intervalMs must be > 0`);
      }
      if (job.table.length === 0) {
        errors.push(`job "${job.id}": empty production table`);
      }
    }
    for (const entry of job.table) {
      if (!knownItemIds.has(entry.itemId)) {
        errors.push(
          `job "${job.id}": production item "${entry.itemId}" does not exist`,
        );
      }
      if (entry.weight <= 0) {
        errors.push(
          `job "${job.id}": production item "${entry.itemId}" has non-positive weight ${entry.weight}`,
        );
      }
    }
    // ROUND 2B (content bible §8.2.4): per-job copy must actually be
    // authored — an empty `verbing`/`restingNote` would silently degrade
    // to "${pip.name} is  away" or a blank resting note.
    if (job.verbing.trim().length === 0) {
      errors.push(`job "${job.id}": missing verbing`);
    }
    if (job.restingNote.trim().length === 0) {
      errors.push(`job "${job.id}": missing restingNote`);
    }
  }

  // --- A station's `job` EFFECT must agree with that job's own
  // `stationItemId` (progression bible §3.1) ---
  //
  // ROUND 2F INTEGRATE. The `job` effect kind is DESCRIPTIVE: it is what
  // puts "A Pip can work here — Gathering, one find every 10 minutes." on
  // the Build card. The actual hosting is decided elsewhere, by
  // `core/keep/jobs.ts` scanning each job's `stationItemId`. Two sources of
  // truth for one fact, which is precisely the shape of the bounty-tier
  // drift below — except here the failure is worse than a mis-gated bounty:
  // a card would advertise work at a station where no Pip can ever be
  // assigned, or a station would host a job its card never mentions.
  //
  // Both directions are checked, so neither half can drift alone.
  for (const p of content.placeables) {
    for (const effect of p.effects ?? []) {
      if (effect.kind !== "job") continue;
      const job = content.jobs[effect.jobId];
      if (job === undefined) continue; // already reported by checkBuildingEffect
      if (job.stationItemId !== p.id) {
        errors.push(
          `placeable "${p.id}": advertises job "${effect.jobId}", but that job is hosted by "${job.stationItemId}"`,
        );
      }
    }
  }
  for (const job of Object.values(content.jobs)) {
    const station = content.placeables.find((p) => p.id === job.stationItemId);
    if (station === undefined) continue; // already reported by the jobs pass
    const advertises = (station.effects ?? []).some(
      (e) => e.kind === "job" && e.jobId === job.id,
    );
    if (!advertises) {
      errors.push(
        `placeable "${station.id}": hosts job "${job.id}" but no job effect says so, so its card cannot tell the player`,
      );
    }
  }

  // --- Bounty templates: `minKeepLevel` must agree with the tier its
  // co-gate ACTUALLY unlocks at (progression bible §8.5) ---
  //
  // ROUND 2F INTEGRATE. The bible named this "the most likely place for a
  // shipped bug in this round" and it was right: widening the ladder
  // re-spread four expeditions and gave stations their own tiers, which
  // silently left three templates advertising a `minKeepLevel` from the OLD
  // spread (Shore 3 when the Shore now opens at 4, the Grotto 3 when it now
  // opens at 5, the Stockpot 2 when it now unlocks at 3).
  //
  // Those three numbers are corrected in `bountyTemplates.ts` — but the
  // NUMBERS were never the real problem. The problem is that a tier written
  // in two files drifts the moment either moves, and nothing notices. So
  // this rule is the durable half of the fix: a template whose
  // `minKeepLevel` disagrees with its own `expeditionId`/`placedItemId`
  // co-gate is a content ERROR, caught at boot and in `validate.test.ts`,
  // the next time anyone re-spreads a tier.
  for (const t of content.bountyTemplates) {
    const min = t.requires.minKeepLevel;
    if (min === undefined) continue;
    const expedition =
      t.requires.expeditionId === undefined
        ? undefined
        : content.expeditions[t.requires.expeditionId];
    if (t.requires.expeditionId !== undefined && expedition === undefined) {
      errors.push(
        `bounty "${t.id}": requires unknown expedition "${t.requires.expeditionId}"`,
      );
    } else if (expedition !== undefined && expedition.unlockKeepLevel !== min) {
      errors.push(
        `bounty "${t.id}": minKeepLevel ${min} disagrees with expedition "${expedition.id}", which unlocks at Keep level ${expedition.unlockKeepLevel}`,
      );
    }
    const station =
      t.requires.placedItemId === undefined
        ? undefined
        : content.placeables.find((p) => p.id === t.requires.placedItemId);
    if (station !== undefined && station.unlockKeepLevel !== min) {
      errors.push(
        `bounty "${t.id}": minKeepLevel ${min} disagrees with placeable "${station.id}", which unlocks at Keep level ${station.unlockKeepLevel}`,
      );
    }
  }

  // --- Recipes (docs/economy-bible.md §3–§4, round 2J): station must
  // exist and actually host a "crafting" job, every resource/item input
  // must be real, the output item must be real (for `"item"` outputs —
  // `"keepsake"` outputs reference a placement item instead), the tier
  // must be defined, and duration must sit inside `tuning.crafting`'s
  // bounds (§3.4: "nothing crafts faster than the game's own slowest
  // existing rhythm"). ---
  const craftingStationIds = new Set(
    Object.values(content.jobs)
      .filter((job) => job.kind === "crafting")
      .map((job) => job.stationItemId),
  );
  if (craftingStationIds.size === 0 && Object.keys(content.recipes).length > 0) {
    errors.push(
      `recipes: ${Object.keys(content.recipes).length} recipe(s) defined but no job hosts a "crafting" station`,
    );
  }
  // ROUND 2J — THE INVERSE: a station with no recipes. A crafting station
  // is only ever worth building because of what it can make; a Craft Table
  // on the Build sheet with an empty recipe book is a placeable a player
  // can spend Wood/Fiber on and get literally nothing usable for it.
  if (craftingStationIds.size > 0 && Object.keys(content.recipes).length === 0) {
    errors.push(
      `recipes: station(s) ${[...craftingStationIds].map((id) => `"${id}"`).join(", ")} host a "crafting" job, but the recipe book is empty — nothing could ever be crafted there`,
    );
  }
  for (const recipe of Object.values(content.recipes)) {
    if (!knownKeepLevels.has(recipe.unlockKeepLevel)) {
      errors.push(
        `recipe "${recipe.id}": unlockKeepLevel ${recipe.unlockKeepLevel} is not a defined Keep level`,
      );
    }
    checkCostBundle(`recipe "${recipe.id}" resources`, recipe.resources, errors);

    // ROUND 2J — THE CRAFTING DEADLOCK (economy bible §6.4, the same class
    // as the two economy deadlocks `core/economy/reachability.test.ts`
    // already caught): every resource AND every Satchel item this recipe
    // consumes must be obtainable from an expedition unlocked at or before
    // the tier the recipe itself appears on. A recipe priced in something
    // that only unlocks LATER is craftable-on-paper and unmakeable in play.
    const obtainableAtRecipeTier = itemsObtainableFromExpeditionsAt(
      content,
      recipe.unlockKeepLevel,
    );
    for (const [resourceId, amount] of Object.entries(recipe.resources)) {
      if (amount === undefined || amount <= 0) continue;
      if (!obtainableAtRecipeTier.has(resourceId)) {
        errors.push(
          `recipe "${recipe.id}": resource "${resourceId}" is not obtainable from any expedition by Keep tier ${recipe.unlockKeepLevel} — a crafting deadlock`,
        );
      }
    }
    for (const [itemId, amount] of Object.entries(recipe.items ?? {})) {
      if (!knownItemIds.has(itemId)) {
        errors.push(`recipe "${recipe.id}": Satchel input "${itemId}" does not exist`);
      }
      if (amount <= 0) {
        errors.push(`recipe "${recipe.id}": Satchel input "${itemId}" has non-positive amount ${amount}`);
      } else if (!obtainableAtRecipeTier.has(itemId)) {
        errors.push(
          `recipe "${recipe.id}": Satchel input "${itemId}" is not obtainable from any expedition by Keep tier ${recipe.unlockKeepLevel} — a crafting deadlock`,
        );
      }
    }
    if (recipe.output.count <= 0) {
      errors.push(`recipe "${recipe.id}": output count must be > 0`);
    }
    if (recipe.output.kind === "item") {
      if (!knownItemIds.has(recipe.output.itemId)) {
        errors.push(`recipe "${recipe.id}": output item "${recipe.output.itemId}" does not exist`);
      } else if (!isCraftedItemUseful(content, recipe.output.itemId)) {
        // ROUND 2J — "an output nothing can use" (spec §16 v1.3's standing
        // rule, applied to crafting): no restore value, not the cure item,
        // not an evolution gift key. A recipe that clears every other check
        // but produces this would be craftable, real, land in the Satchel,
        // and do nothing — the ninth dead feature, from a different door.
        errors.push(
          `recipe "${recipe.id}": output "${recipe.output.itemId}" has no use anywhere — no restore value, not the ailment cure item, and not an evolution gift key`,
        );
      }
    }
    if (
      recipe.output.kind === "keepsake" &&
      !placeableIds.has(recipe.output.itemId) &&
      !content.decorations.some((d) => d.id === recipe.output.itemId)
    ) {
      errors.push(`recipe "${recipe.id}": keepsake output "${recipe.output.itemId}" is not a placement item`);
    }
    if (
      recipe.durationMs < content.tuning.crafting.minDurationMs ||
      recipe.durationMs > content.tuning.crafting.maxDurationMs
    ) {
      errors.push(
        `recipe "${recipe.id}": durationMs ${recipe.durationMs} is outside [${content.tuning.crafting.minDurationMs}, ${content.tuning.crafting.maxDurationMs}]`,
      );
    }
    if (recipe.effectCopy.trim().length === 0) {
      errors.push(`recipe "${recipe.id}": missing effectCopy`);
    }
    if (recipe.flavor.trim().length === 0) {
      errors.push(`recipe "${recipe.id}": missing flavor`);
    }
  }

  // --- Dialogue: underfilled pools are ERRORS (spec §3: minimum 8 lines
  // per personality × context; the Phase 2 authoring pass landed, so the
  // pre-authoring warn downgrade is gone per the Phase 2 gate TODO) ---
  errors.push(...findUnderfilledDialoguePools(content.dialogue));

  return { errors, warnings };
}

/**
 * Validate the content registries, logging loudly (spec §3). Returns the
 * result so tests and tooling can assert on it.
 */
export function validateContent(
  content: ContentBundle = defaultContentBundle,
): ValidationResult {
  const result = collectContentIssues(content);
  for (const error of result.errors) {
    console.error(`[content] ${error}`);
  }
  for (const warning of result.warnings) {
    console.warn(`[content] ${warning}`);
  }
  return result;
}
