/**
 * Content validation (spec §3): run at boot in dev mode. Broken evolution
 * targets, empty loot tables, missing species/item refs, negative costs,
 * and underfilled dialogue pools (the Phase 2 authoring pass landed —
 * spec §3's 8-line minimum is now a hard requirement) → loud
 * console.error.
 */

import { RESOURCE_IDS, type ResourceBundle } from "../core/economy";
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
  jobs: Readonly<Record<string, JobDef>>;
  /** Species palette tokens (spec §11); keyed by species id. */
  speciesPalettes: Readonly<Record<string, SpeciesPaletteDef>>;
  /** Species flavor lines (content-bible §6.2); keyed by species id. */
  speciesLines: Readonly<Record<SpeciesId, SpeciesLines>>;
  /** Rarity → hatch weight (spec §7.3, content-bible round 2B's
   * zero-weight "lineage" tier): used to catch an expedition's
   * `eggSpecies` pool that resolves to zero hatchable species. */
  rarityWeights: Readonly<Record<string, number>>;
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
  jobs: defaultJobs,
  speciesPalettes: defaultSpeciesPalettes,
  speciesLines: defaultSpeciesLines,
  rarityWeights: defaultTuning.eggs.rarityWeights,
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

  // --- Keep levels: non-negative resource-bundle costs ---
  for (const level of content.keepLevels) {
    checkCostBundle(`keep level ${level.level}`, level.cost, errors);
  }

  // --- Decorations: non-negative costs, sane footprints ---
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
  const placeableIds = new Set(content.placeables.map((pl) => pl.id));
  for (const job of Object.values(content.jobs)) {
    if (!placeableIds.has(job.stationItemId)) {
      errors.push(
        `job "${job.id}": station item "${job.stationItemId}" is not a placeable`,
      );
    }
    if (job.intervalMs <= 0) {
      errors.push(`job "${job.id}": intervalMs must be > 0`);
    }
    if (job.table.length === 0) {
      errors.push(`job "${job.id}": empty production table`);
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
