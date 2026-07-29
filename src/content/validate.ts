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
import type { FoodDef } from "./foods";
import { foods as defaultFoods } from "./foods";
import type { ExpeditionDef } from "./expeditions";
import { expeditions as defaultExpeditions } from "./expeditions";
import type { PersonalityDef, PersonalityId } from "./personalities";
import { personalities as defaultPersonalities } from "./personalities";
import type { DialoguePools } from "./dialogue";
import { dialogue as defaultDialogue, findUnderfilledDialoguePools } from "./dialogue";
import type { KeepLevelDef } from "./keep";
import { keepLevels as defaultKeepLevels } from "./keep";
import type { DecorationDef } from "./decorations";
import { decorations as defaultDecorations } from "./decorations";

export interface ContentBundle {
  species: Readonly<Record<SpeciesId, SpeciesDef>>;
  foods: Readonly<Record<string, FoodDef>>;
  expeditions: Readonly<Record<string, ExpeditionDef>>;
  personalities: Readonly<Record<PersonalityId, PersonalityDef>>;
  dialogue: DialoguePools;
  keepLevels: readonly KeepLevelDef[];
  decorations: readonly DecorationDef[];
}

export const defaultContentBundle: ContentBundle = {
  species: defaultSpecies,
  foods: defaultFoods,
  expeditions: defaultExpeditions,
  personalities: defaultPersonalities,
  dialogue: defaultDialogue,
  keepLevels: defaultKeepLevels,
  decorations: defaultDecorations,
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

  // --- Foods: sane effects, non-negative costs ---
  for (const f of Object.values(content.foods)) {
    if (f.hungerRestore < 0) {
      errors.push(`food "${f.id}": negative hungerRestore ${f.hungerRestore}`);
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
