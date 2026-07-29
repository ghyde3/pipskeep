/**
 * Placeable stations (spec §9): Food Bowl, Bed, Gathering Station.
 * Distinct from decorations (decorations.ts) — placeables are functional
 * (Pips gravitate to them; the Gathering Station hosts the Gathering job,
 * spec §6.2) — but both share the same grid-placement rules, so core/keep
 * merges the two registries into one placement-item view.
 *
 * Footprints per Phase 5: Food Bowl 1×1, Bed 2×1, Gathering Station 2×2.
 * ROUND 2B adds the Stockpot (2×2, content bible §5.3) — the Simmering
 * job's station, priced wood+fiber only per the placeables reachability
 * rule below (`placeableCosts` in tuning.ts): placeables carry no level
 * gate (spec §9 offers build mode from the start), so anything priced in
 * shell/driftwood would fail structural reachability at Keep level 1 with
 * no content-side fix.
 *
 * Costs live in `tuning.ts` (`placeableCosts`), like every other tunable
 * — ROUND 2B moved them there because the Gathering Station's price only
 * makes sense NEXT TO `keepLevelCosts`: it is the cheap on-ramp to Keep
 * level 2, and while the two numbers lived in different files it was
 * silently more expensive than the upgrade it funds. See the comment on
 * `placeableCosts`.
 */

import type { ResourceBundle } from "../core/economy";
import type { Footprint } from "../core/keep";
import { tuning } from "./tuning";

export interface PlaceableDef {
  id: string;
  name: string;
  cost: ResourceBundle;
  footprint: Footprint;
  /** Resolved by the SpriteResolver (spec §11); placeholder paths for now. */
  spriteRef: string;
  /** Warm, opinionated one-liner (spec §15.5 tone) shown in the Build
   * sheet. Player-facing copy — never "A nice station." */
  flavor: string;
}

export const placeables: readonly PlaceableDef[] = [
  {
    id: "food-bowl",
    name: "Food Bowl",
    cost: tuning.placeableCosts["food-bowl"],
    footprint: { w: 1, h: 1 },
    spriteRef: "placeable/food-bowl",
    flavor: "Berries pile up here faster than anyone eats them. That's rather the point.",
  },
  {
    id: "bed",
    name: "Bed",
    cost: tuning.placeableCosts.bed,
    footprint: { w: 2, h: 1 },
    spriteRef: "placeable/bed",
    flavor: "A proper nest. Naps happen here on purpose, not by accident on the nearest rug.",
  },
  {
    id: "gathering-station",
    name: "Gathering Station",
    cost: tuning.placeableCosts["gathering-station"],
    footprint: { w: 2, h: 2 },
    spriteRef: "placeable/gathering-station",
    flavor: "A big basket and a rake, propped and waiting. Someone is going to fill that basket.",
  },
  {
    id: "stockpot",
    name: "Stockpot",
    cost: tuning.placeableCosts["stockpot"],
    footprint: { w: 2, h: 2 },
    spriteRef: "placeable/stockpot",
    flavor:
      "A big pot that's always got something going. Never quite empty, never quite the same thing twice.",
  },
];
