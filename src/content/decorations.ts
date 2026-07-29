/**
 * Decoration registry (spec §3, §9): id, cost (resource bundle),
 * footprint, sprite ref.
 *
 * ROUND 2B CONTENT EXPANSION (content bible §5.1): fourteen new
 * decorations on top of the shipped six, twenty in total. Decorations are
 * checked for reachability only at the MAX Keep level (not per-tier like
 * expeditions/placeables), so they may be priced in any of the four
 * resources, including shell/driftwood — see `core/economy/
 * reachability.test.ts`'s "every decoration is buyable by the time the
 * Keep is fully built".
 *
 * Footprint sanity: the Keep grid is 8×8 at level 1 and 8×12 at level 2
 * (spec §9 + `tuning.keepGrid`) — the 3×2 Sun Awning (the biggest
 * footprint in the game) and the 3×1 Lantern Row both fit at level 1 with
 * room to spare.
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
  /** Warm, opinionated one-liner (spec §15.5 tone) shown in the Build
   * sheet. Player-facing copy — never "A nice decoration." */
  flavor: string;
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
    flavor:
      "A little path so Pips stop cutting through the flower bed. They will cut through the flower bed anyway.",
  },
  {
    id: "moss-tuft",
    name: "Moss Tuft",
    cost: { fiber: 1 },
    footprint: { w: 1, h: 1 },
    spriteRef: "deco/moss-tuft",
    flavor:
      "Soft, green, faintly damp. A corner that finally looks like it meant to be a corner.",
  },
  {
    id: "berry-planter",
    name: "Berry Planter",
    // Costs are RESOURCE bundles; Berries are food (inventory) and can
    // no longer appear in costs — you build the planter, berries grow.
    cost: { wood: 3, fiber: 2 },
    footprint: { w: 1, h: 1 },
    spriteRef: "deco/berry-planter",
    flavor: "A wooden box of dirt, doing its best impression of a garden.",
  },
  {
    id: "driftwood-arch",
    name: "Driftwood Arch",
    cost: { driftwood: 4 },
    footprint: { w: 2, h: 1 },
    spriteRef: "deco/driftwood-arch",
    flavor:
      "Salt-bleached wood, bent by the tide into something almost like a doorway.",
  },
  {
    id: "shell-mosaic",
    name: "Shell Mosaic",
    cost: { shell: 5 },
    footprint: { w: 2, h: 2 },
    spriteRef: "deco/shell-mosaic",
    flavor:
      "Every shell laid just so. Someone spent an entire afternoon on this and would do it again.",
  },
  {
    id: "cozy-lantern",
    name: "Cozy Lantern",
    cost: { wood: 2, fiber: 2 },
    footprint: { w: 1, h: 1 },
    spriteRef: "deco/cozy-lantern",
    flavor:
      "Warm light for evenings that don't actually get dark in here, but try telling it that.",
  },
  {
    id: "welcome-sign",
    name: "Welcome Sign",
    cost: { wood: 3, fiber: 1 },
    footprint: { w: 1, h: 1 },
    spriteRef: "deco/welcome-sign",
    flavor: "Hand-painted, a little crooked, and completely sincere about it.",
  },
  {
    id: "toadstool-ring",
    name: "Toadstool Ring",
    cost: { fiber: 4, wood: 1 },
    footprint: { w: 2, h: 2 },
    spriteRef: "deco/toadstool-ring",
    flavor:
      "A perfect circle of toadstools. Absolutely nothing bad has ever happened near one of these.",
  },
  {
    id: "bramble-arch",
    name: "Bramble Arch",
    cost: { fiber: 8, wood: 2 },
    footprint: { w: 2, h: 1 },
    spriteRef: "deco/bramble-arch",
    flavor: "Hedge, trimmed into a doorway. It bites back if you're not careful.",
  },
  {
    id: "twine-swing",
    name: "Twine Swing",
    cost: { wood: 5, fiber: 6 },
    footprint: { w: 2, h: 2 },
    spriteRef: "deco/twine-swing",
    flavor: "Rope and a plank, hung for someone small to kick their feet on.",
  },
  {
    id: "story-stump",
    name: "Story Stump",
    cost: { wood: 8 },
    footprint: { w: 2, h: 2 },
    spriteRef: "deco/story-stump",
    flavor:
      "A wide old stump, worn smooth from Pips sitting around it telling each other nonsense.",
  },
  {
    id: "sun-awning",
    name: "Sun Awning",
    cost: { wood: 6, fiber: 7 },
    footprint: { w: 3, h: 2 },
    spriteRef: "deco/sun-awning",
    flavor:
      "Shade on the sunny days, cover on the rainy ones. Popular with everyone, always.",
  },
  {
    id: "cloud-kite",
    name: "Cloud Kite",
    cost: { fiber: 6, wood: 2 },
    footprint: { w: 1, h: 1 },
    spriteRef: "deco/cloud-kite",
    flavor:
      "Forever aloft, no matter how still the air actually is. Nobody is questioning it.",
  },
  {
    id: "wind-chime",
    name: "Wind Chime",
    cost: { shell: 4, fiber: 3 },
    footprint: { w: 1, h: 1 },
    spriteRef: "deco/wind-chime",
    flavor: "Rings even when nothing is moving. The Keep likes to have the last word.",
  },
  {
    id: "tide-basin",
    name: "Tide Basin",
    cost: { shell: 6, driftwood: 3 },
    footprint: { w: 2, h: 2 },
    spriteRef: "deco/tide-basin",
    flavor:
      "A little pool of Shore water that refuses to evaporate. Tidepips adore it, loudly.",
  },
  {
    id: "driftwood-bench",
    name: "Driftwood Bench",
    cost: { driftwood: 5, fiber: 2 },
    footprint: { w: 2, h: 1 },
    spriteRef: "deco/driftwood-bench",
    flavor: "Two seats, weathered soft. Built for sitting down and staying a while.",
  },
  {
    id: "lantern-row",
    name: "Lantern Row",
    cost: { wood: 4, shell: 2 },
    footprint: { w: 3, h: 1 },
    spriteRef: "deco/lantern-row",
    flavor: "A line of little lights along the path. Nobody asked for it; everybody uses it.",
  },
  {
    id: "ember-brazier",
    name: "Ember Brazier",
    cost: { wood: 6, driftwood: 4 },
    footprint: { w: 1, h: 1 },
    spriteRef: "deco/ember-brazier",
    flavor: "Coals that never quite go out. Stand close and you'll understand why.",
  },
  {
    id: "wishing-cairn",
    name: "Wishing Cairn",
    cost: { shell: 3, driftwood: 3 },
    footprint: { w: 1, h: 1 },
    spriteRef: "deco/wishing-cairn",
    flavor:
      "Three stones, stacked and balanced. Make a wish; the Keep won't tell if it doesn't come true.",
  },
  {
    id: "mossy-fountain",
    name: "Mossy Fountain",
    cost: { wood: 6, fiber: 4, shell: 4 },
    footprint: { w: 2, h: 2 },
    spriteRef: "deco/mossy-fountain",
    flavor:
      "Wood, shell and fiber, all in one basin. The Keep's answer to \"we have three of everything now.\"",
  },
];
