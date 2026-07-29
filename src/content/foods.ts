/**
 * Food registry (spec §3, §5, §6.3). Foods are loot in MVP — the `cost`
 * field is the seam for a future shop and may go unused.
 */

import type { ResourceBundle } from "../core/economy";
import { tuning } from "./tuning";

export const FOOD_IDS = ["berry", "stew"] as const;
export type FoodId = (typeof FOOD_IDS)[number];

export interface FoodDef {
  id: FoodId;
  name: string;
  /** +Hunger on Feed (spec §5). */
  hungerRestore: number;
  /** Optional side effects (spec §3). */
  sideEffects?: Readonly<Partial<{ happiness: number; energy: number }>>;
  /** Resource-bundle cost — unused seam for a future shop (spec §6.3). */
  cost: ResourceBundle;
}

export const foods: Readonly<Record<FoodId, FoodDef>> = {
  berry: {
    id: "berry",
    name: "Berry",
    hungerRestore: tuning.foods.berry.hunger,
    cost: {},
  },
  stew: {
    id: "stew",
    name: "Stew",
    hungerRestore: tuning.foods.stew.hunger,
    sideEffects: { happiness: tuning.foods.stew.happiness },
    cost: {},
  },
};
