/**
 * Placeable stations (spec §9): Food Bowl, Bed, Gathering Station.
 * Distinct from decorations (decorations.ts) — placeables are functional
 * (Pips gravitate to them; the Gathering Station hosts the Gathering job,
 * spec §6.2) — but both share the same grid-placement rules, so core/keep
 * merges the two registries into one placement-item view.
 *
 * Footprints per Phase 5: Food Bowl 1×1, Bed 2×1, Gathering Station 2×2.
 * Costs are `[DEFAULT — review]` resource bundles (spec §6.3).
 */

import type { ResourceBundle } from "../core/economy";
import type { Footprint } from "../core/keep";

export interface PlaceableDef {
  id: string;
  name: string;
  cost: ResourceBundle;
  footprint: Footprint;
  /** Resolved by the SpriteResolver (spec §11); placeholder paths for now. */
  spriteRef: string;
}

export const placeables: readonly PlaceableDef[] = [
  {
    id: "food-bowl",
    name: "Food Bowl",
    cost: { wood: 2 },
    footprint: { w: 1, h: 1 },
    spriteRef: "placeable/food-bowl",
  },
  {
    id: "bed",
    name: "Bed",
    cost: { wood: 4, fiber: 3 },
    footprint: { w: 2, h: 1 },
    spriteRef: "placeable/bed",
  },
  {
    id: "gathering-station",
    name: "Gathering Station",
    cost: { wood: 8, fiber: 4 },
    footprint: { w: 2, h: 2 },
    spriteRef: "placeable/gathering-station",
  },
];
