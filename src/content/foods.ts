/**
 * Food registry (spec §3, §5, §6.3). Foods are loot in MVP — the `cost`
 * field is the seam for a future shop and may go unused.
 *
 * ROUND 2B CONTENT EXPANSION (content bible §4): eight new foods on top of
 * the shipped Berry/Stew. Every restore number below is READ from
 * `tuning.foods` (never repeated here) and is sized against one fixed
 * arithmetic, stated once so nobody has to re-derive it per food:
 *
 *   worst Hunger lost over one full capped (16h) absence
 *     = 3.8/h (base decay) × 1.15 (Hardworking's multiplier) × 16h
 *     = 69.92
 *
 * The full "servings to cover a day away" table (and why Honeydrop and
 * Glowcap's thin 70.0-vs-69.92 margins are intentional) lives on
 * `tuning.foods` — this file only turns those numbers into registry
 * entries + player-facing identity (name, flavor). See
 * `core/pips/balance.test.ts` for the behavioural guard and
 * `content/validate.test.ts` for the schema one.
 *
 * TWO AUTHORING TRAPS (content bible §4.3) — read before adding a food:
 *   1. Every food needs an entry in BOTH `tuning.foods` (the numbers) and
 *      here (the identity). `reachability.test.ts` validates loot-table
 *      item ids against `RESOURCE_IDS ∪ Object.keys(tuning.foods)` — the
 *      TUNING object, not this registry — so a food that exists only here
 *      passes that check by accident while one that exists only in
 *      tuning fails it with a confusing message.
 *   2. `FOOD_IDS` is a const tuple and `FoodId` derives from it. EXTEND
 *      the tuple; never widen the type to `string`.
 */

import type { ResourceBundle } from "../core/economy";
import { tuning } from "./tuning";

export const FOOD_IDS = [
  "berry",
  "stew",
  "honeydrop",
  "toastnut",
  "frostberry",
  "cocoabun",
  "glowcap",
  "tideroll",
  "emberloaf",
  "feastpot",
] as const;
export type FoodId = (typeof FOOD_IDS)[number];

/**
 * Loot-reveal presentation tier (`ui/lootReveal.ts`, spec §6.1: "rare
 * finds get extra flair") — content bible §8.2.3, a fence exception:
 * moving this onto `FoodDef` turns "a new food needs reveal ceremony"
 * into a content decision instead of a recurring `ui/` edit. Absent
 * means "common" (a quick flip, no pause) — `ui/lootReveal.ts`'s own
 * default.
 */
export type FoodRevealTier = "common" | "uncommon" | "rare";

export interface FoodDef {
  id: FoodId;
  name: string;
  /** +Hunger on Feed (spec §5). */
  hungerRestore: number;
  /** Optional side effects (spec §3). */
  sideEffects?: Readonly<Partial<{ happiness: number; energy: number }>>;
  /** Resource-bundle cost — unused seam for a future shop (spec §6.3). */
  cost: ResourceBundle;
  /** Warm, opinionated one-liner (spec §15.5 tone) shown in the Satchel
   * and anywhere else the item is browsed. Player-facing copy, not a
   * design note — never "A nice snack." */
  flavor: string;
  /** Seasonal-events seam (spec §12): optional availability window.
   * NOTHING consumes this yet — registries accept it so seasonal content
   * later is a data change, not a schema change. */
  availableWindow?: { from: string; to: string };
  /** Loot-reveal ceremony tier; absent = "common" (see `FoodRevealTier`). */
  revealTier?: FoodRevealTier;
}

export const foods: Readonly<Record<FoodId, FoodDef>> = {
  berry: {
    id: "berry",
    name: "Berry",
    hungerRestore: tuning.foods.berry.hunger,
    cost: {},
    flavor:
      "The reliable one. Sweet, a little tart, gone in a bite — and there is always another.",
  },
  stew: {
    id: "stew",
    name: "Stew",
    hungerRestore: tuning.foods.stew.hunger,
    sideEffects: { happiness: tuning.foods.stew.happiness },
    cost: {},
    flavor: "A whole meal in a bowl. Somebody is very proud of the recipe.",
    revealTier: "uncommon",
  },
  honeydrop: {
    id: "honeydrop",
    name: "Honeydrop",
    hungerRestore: tuning.foods.honeydrop.hunger,
    sideEffects: { happiness: tuning.foods.honeydrop.happiness },
    cost: {},
    flavor:
      "Not a meal — a small, sticky act of love. Fixes almost nothing and, somehow, everything.",
  },
  toastnut: {
    id: "toastnut",
    name: "Toastnut",
    hungerRestore: tuning.foods.toastnut.hunger,
    sideEffects: { energy: tuning.foods.toastnut.energy },
    cost: {},
    flavor:
      "Roasted hard, holds its shape in a pocket, tastes like it was worth the walk.",
  },
  frostberry: {
    id: "frostberry",
    name: "Frostberry",
    hungerRestore: tuning.foods.frostberry.hunger,
    sideEffects: { energy: tuning.foods.frostberry.energy },
    cost: {},
    flavor: "Cold enough to wake a Pip right up. Tastes like the top of a hill.",
  },
  cocoabun: {
    id: "cocoabun",
    name: "Cocoa Bun",
    hungerRestore: tuning.foods.cocoabun.hunger,
    sideEffects: { happiness: tuning.foods.cocoabun.happiness },
    cost: {},
    flavor: "Warm all the way through. The kind of thing you eat sitting down.",
    revealTier: "uncommon",
  },
  glowcap: {
    id: "glowcap",
    name: "Glowcap",
    hungerRestore: tuning.foods.glowcap.hunger,
    sideEffects: { happiness: tuning.foods.glowcap.happiness },
    cost: {},
    flavor: "A mushroom that hums faintly and is, against all odds, delicious.",
    revealTier: "uncommon",
  },
  tideroll: {
    id: "tideroll",
    name: "Tideroll",
    hungerRestore: tuning.foods.tideroll.hunger,
    sideEffects: { energy: tuning.foods.tideroll.energy },
    cost: {},
    flavor:
      "Salt, bread, something briny in the middle. Best eaten standing at the water's edge.",
  },
  emberloaf: {
    id: "emberloaf",
    name: "Emberloaf",
    hungerRestore: tuning.foods.emberloaf.hunger,
    sideEffects: { happiness: tuning.foods.emberloaf.happiness },
    cost: {},
    flavor: "Rich, dense, faintly smoky — dinner that means it.",
    revealTier: "uncommon",
  },
  feastpot: {
    id: "feastpot",
    name: "Feastpot",
    hungerRestore: tuning.foods.feastpot.hunger,
    sideEffects: {
      happiness: tuning.foods.feastpot.happiness,
      energy: tuning.foods.feastpot.energy,
    },
    cost: {},
    flavor:
      "Everything, all at once, in one pot. Nobody remembers ordering this much food, and nobody is complaining.",
    // The rarest, richest item in the game (~1-in-3.4 Grotto trips) — it
    // gets the loot-reveal showstopper treatment, not a common flip
    // (content bible §8.2.3).
    revealTier: "rare",
  },
};
