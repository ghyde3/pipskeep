/**
 * Decoration registry (spec §3, §9): id, cost (resource bundle),
 * footprint, sprite ref. Six placeholder entries for MVP.
 */

import type { ResourceBundle } from "../core/economy";
import type { Footprint } from "../core/keep";

export interface DecorationDef {
  id: string;
  name: string;
  cost: ResourceBundle;
  footprint: Footprint;
  /** Resolved by the SpriteResolver (spec §11); placeholder paths for now. */
  spriteRef: string;
  /** Seasonal-events seam (spec §12): optional availability window.
   * NOTHING consumes this yet — registries accept it so seasonal content
   * later is a data change, not a schema change. */
  availableWindow?: { from: string; to: string };
}

export const decorations: readonly DecorationDef[] = [
  {
    id: "pebble-path",
    name: "Pebble Path",
    cost: { fiber: 2 },
    footprint: { w: 1, h: 1 },
    spriteRef: "deco/pebble-path",
  },
  {
    id: "moss-tuft",
    name: "Moss Tuft",
    cost: { fiber: 1 },
    footprint: { w: 1, h: 1 },
    spriteRef: "deco/moss-tuft",
  },
  {
    id: "berry-planter",
    name: "Berry Planter",
    // Costs are RESOURCE bundles; Berries are food (inventory) and can
    // no longer appear in costs — you build the planter, berries grow.
    cost: { wood: 3, fiber: 2 },
    footprint: { w: 1, h: 1 },
    spriteRef: "deco/berry-planter",
  },
  {
    id: "driftwood-arch",
    name: "Driftwood Arch",
    cost: { driftwood: 4 },
    footprint: { w: 2, h: 1 },
    spriteRef: "deco/driftwood-arch",
  },
  {
    id: "shell-mosaic",
    name: "Shell Mosaic",
    cost: { shell: 5 },
    footprint: { w: 2, h: 2 },
    spriteRef: "deco/shell-mosaic",
  },
  {
    id: "cozy-lantern",
    name: "Cozy Lantern",
    cost: { wood: 2, fiber: 2 },
    footprint: { w: 1, h: 1 },
    spriteRef: "deco/cozy-lantern",
  },
];
