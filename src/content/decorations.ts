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
 * Footprint sanity: the Keep grid grows to 12×14 by tier 9 (spec §9 +
 * `tuning.progression.gridGrowth`) — the 3×2 Sun Awning (the biggest
 * footprint in the game) and the 3×1 Lantern Row both fit at level 1 with
 * room to spare.
 *
 * ROUND 2F (docs/progression-bible.md §3.4/§5.3) — every shipped
 * decoration gains a small SINGLE-need `effects` comfort (1–2%, matching
 * its set's theme) plus a `setId`: "no decoration is cosmetic-only" is the
 * rule, and the themed SET bonus (`content/decorSets.ts`) is what turns a
 * handful of 1–2%s into a real Keep-wide perk once three (or five) distinct
 * members are placed. `setId` is DISPLAY-only (which set a card's icon
 * tints as, "primary" set for an item in two) — the bonus itself is
 * computed from `decorSets.ts`'s `memberItemIds`, which is how
 * `cloud-kite` can count toward BOTH Meadow Green and First Snow (bible
 * §3.5) despite carrying only one `setId` here.
 *
 * ROUND 2F ALSO adds twelve more decorations (bible §5.2) — the ✱-marked
 * members that let every one of the six themed sets actually reach its
 * 5-of-a-set bonus (`content/decorSets.ts`'s own doc comment tracked this
 * as a known, honest gap; this patch closes it) — and a required `icon`
 * field on every entry, old and new (`content/icons.ts`; rendered by
 * `ui/icons.ts`).
 */

import type { ResourceBundle } from "../core/economy";
import type { Footprint } from "../core/keep";
import type { BuildingEffect } from "./buildingEffects";
import type { IconSpec } from "./icons";

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
  /** Mechanical effects this decoration grants Keep-wide while placed
   * (bible §3.1); absent ≡ `[]`. Every entry strictly helps (§0.3) — see
   * `content/buildingEffects.test.ts`. */
  effects?: readonly BuildingEffect[];
  /** Which themed set (`content/decorSets.ts`) this item's CARD reads as
   * belonging to — display only; see the module doc above. */
  setId?: string;
  /** Procedural glyph id (bible §4.2) — see `content/icons.ts`. */
  icon: IconSpec;
  /**
   * ROUND 2J FIX STAGE (docs/economy-bible.md §4.4) — CRAFT-ONLY. This
   * decoration has NO Build-sheet price; the only way to get one is to
   * make it at a Craft Table, which lands a copy on round 2F's Keepsake
   * Shelf. `cost` is `{}` for these, and both halves are load-bearing:
   *
   * - `ui/buildMode.ts`'s catalogue FILTERS them out, so the Build sheet
   *   never offers a free item. (The Keepsake Shelf section still lists
   *   any copy you already own — that is where they show up.)
   * - `core/state.ts`'s PLACE_ITEM REFUSES a craft-only item whose
   *   keepsake count is 0, so an empty `cost` can never become a
   *   free-decoration printer.
   *
   * Why craft-only at all: `content/recipes.ts`'s own header worked out
   * that a crafted decoration which is ALSO directly buyable is a recipe
   * a rational player never uses (buying is instant and ties up no Pip) —
   * a dead feature by spec §16 v1.3's standing rule, from a quieter door.
   * The recipe has to be the only door, or it is not a door.
   */
  craftOnly?: true;
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
    effects: [{ kind: "comfort", need: "happiness", decayReduction: 0.01 }],
    setId: "meadow-green",
    icon: { motif: "stone" },
  },
  {
    id: "moss-tuft",
    name: "Moss Tuft",
    cost: { fiber: 1 },
    footprint: { w: 1, h: 1 },
    spriteRef: "deco/moss-tuft",
    flavor:
      "Soft, green, faintly damp. A corner that finally looks like it meant to be a corner.",
    effects: [{ kind: "comfort", need: "happiness", decayReduction: 0.01 }],
    setId: "meadow-green",
    icon: { motif: "leaf" },
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
    effects: [{ kind: "comfort", need: "hunger", decayReduction: 0.01 }],
    setId: "meadow-green",
    icon: { motif: "leaf" },
  },
  {
    id: "driftwood-arch",
    name: "Driftwood Arch",
    cost: { driftwood: 4 },
    footprint: { w: 2, h: 1 },
    spriteRef: "deco/driftwood-arch",
    flavor:
      "Salt-bleached wood, bent by the tide into something almost like a doorway.",
    effects: [{ kind: "comfort", need: "cleanliness", decayReduction: 0.01 }],
    setId: "tideline",
    icon: { motif: "arch" },
  },
  {
    id: "shell-mosaic",
    name: "Shell Mosaic",
    cost: { shell: 5 },
    footprint: { w: 2, h: 2 },
    spriteRef: "deco/shell-mosaic",
    flavor:
      "Every shell laid just so. Someone spent an entire afternoon on this and would do it again.",
    effects: [{ kind: "comfort", need: "cleanliness", decayReduction: 0.01 }],
    setId: "tideline",
    icon: { motif: "shell" },
  },
  {
    id: "cozy-lantern",
    name: "Cozy Lantern",
    cost: { wood: 2, fiber: 2 },
    footprint: { w: 1, h: 1 },
    spriteRef: "deco/cozy-lantern",
    flavor:
      "Warm light for evenings that don't actually get dark in here, but try telling it that.",
    effects: [{ kind: "comfort", need: "happiness", decayReduction: 0.01 }],
    setId: "lantern-ember",
    icon: { motif: "lantern" },
  },
  {
    id: "welcome-sign",
    name: "Welcome Sign",
    cost: { wood: 3, fiber: 1 },
    footprint: { w: 1, h: 1 },
    spriteRef: "deco/welcome-sign",
    flavor: "Hand-painted, a little crooked, and completely sincere about it.",
    effects: [{ kind: "comfort", need: "energy", decayReduction: 0.02 }],
    setId: "bramble-twine",
    icon: { motif: "post" },
  },
  {
    id: "toadstool-ring",
    name: "Toadstool Ring",
    cost: { fiber: 4, wood: 1 },
    footprint: { w: 2, h: 2 },
    spriteRef: "deco/toadstool-ring",
    flavor:
      "A perfect circle of toadstools. Absolutely nothing bad has ever happened near one of these.",
    effects: [{ kind: "comfort", need: "happiness", decayReduction: 0.01 }],
    setId: "meadow-green",
    icon: { motif: "leaf" },
  },
  {
    id: "bramble-arch",
    name: "Bramble Arch",
    cost: { fiber: 8, wood: 2 },
    footprint: { w: 2, h: 1 },
    spriteRef: "deco/bramble-arch",
    flavor: "Hedge, trimmed into a doorway. It bites back if you're not careful.",
    effects: [{ kind: "comfort", need: "energy", decayReduction: 0.01 }],
    setId: "bramble-twine",
    icon: { motif: "arch" },
  },
  {
    id: "twine-swing",
    name: "Twine Swing",
    cost: { wood: 5, fiber: 6 },
    footprint: { w: 2, h: 2 },
    spriteRef: "deco/twine-swing",
    flavor: "Rope and a plank, hung for someone small to kick their feet on.",
    effects: [{ kind: "comfort", need: "energy", decayReduction: 0.01 }],
    setId: "bramble-twine",
    icon: { motif: "bench" },
  },
  {
    id: "story-stump",
    name: "Story Stump",
    cost: { wood: 8 },
    footprint: { w: 2, h: 2 },
    spriteRef: "deco/story-stump",
    flavor:
      "A wide old stump, worn smooth from Pips sitting around it telling each other nonsense.",
    effects: [{ kind: "comfort", need: "energy", decayReduction: 0.02 }],
    setId: "bramble-twine",
    icon: { motif: "bench" },
  },
  {
    id: "sun-awning",
    name: "Sun Awning",
    cost: { wood: 6, fiber: 7 },
    footprint: { w: 3, h: 2 },
    spriteRef: "deco/sun-awning",
    flavor:
      "Shade on the sunny days, cover on the rainy ones. Popular with everyone, always.",
    effects: [{ kind: "comfort", need: "cleanliness", decayReduction: 0.02 }],
    setId: "deep-wood",
    icon: { motif: "arch" },
  },
  {
    id: "cloud-kite",
    name: "Cloud Kite",
    cost: { fiber: 6, wood: 2 },
    footprint: { w: 1, h: 1 },
    spriteRef: "deco/cloud-kite",
    flavor:
      "Forever aloft, no matter how still the air actually is. Nobody is questioning it.",
    // Member of BOTH Meadow Green and First Snow (bible §3.5, on purpose —
    // see content/decorSets.ts) — `setId` is display-only, so it names
    // just one (its "primary" set); decorSets.ts's memberItemIds is what
    // actually counts it toward both.
    effects: [{ kind: "comfort", need: "happiness", decayReduction: 0.01 }],
    setId: "meadow-green",
    icon: { motif: "spark" },
  },
  {
    id: "wind-chime",
    name: "Wind Chime",
    cost: { shell: 4, fiber: 3 },
    footprint: { w: 1, h: 1 },
    spriteRef: "deco/wind-chime",
    flavor: "Rings even when nothing is moving. The Keep likes to have the last word.",
    effects: [{ kind: "comfort", need: "energy", decayReduction: 0.02 }],
    setId: "first-snow",
    icon: { motif: "chime" },
  },
  {
    id: "tide-basin",
    name: "Tide Basin",
    cost: { shell: 6, driftwood: 3 },
    footprint: { w: 2, h: 2 },
    spriteRef: "deco/tide-basin",
    flavor:
      "A little pool of Shore water that refuses to evaporate. Tidepips adore it, loudly.",
    effects: [{ kind: "comfort", need: "cleanliness", decayReduction: 0.01 }],
    setId: "tideline",
    icon: { motif: "droplet" },
  },
  {
    id: "driftwood-bench",
    name: "Driftwood Bench",
    cost: { driftwood: 5, fiber: 2 },
    footprint: { w: 2, h: 1 },
    spriteRef: "deco/driftwood-bench",
    flavor: "Two seats, weathered soft. Built for sitting down and staying a while.",
    effects: [{ kind: "comfort", need: "cleanliness", decayReduction: 0.01 }],
    setId: "tideline",
    icon: { motif: "bench" },
  },
  {
    id: "lantern-row",
    name: "Lantern Row",
    cost: { wood: 4, shell: 2 },
    footprint: { w: 3, h: 1 },
    spriteRef: "deco/lantern-row",
    flavor: "A line of little lights along the path. Nobody asked for it; everybody uses it.",
    effects: [{ kind: "comfort", need: "happiness", decayReduction: 0.01 }],
    setId: "lantern-ember",
    icon: { motif: "lantern" },
  },
  {
    id: "ember-brazier",
    name: "Ember Brazier",
    cost: { wood: 6, driftwood: 4 },
    footprint: { w: 1, h: 1 },
    spriteRef: "deco/ember-brazier",
    flavor: "Coals that never quite go out. Stand close and you'll understand why.",
    effects: [{ kind: "comfort", need: "happiness", decayReduction: 0.01 }],
    setId: "lantern-ember",
    icon: { motif: "flame" },
  },
  {
    id: "wishing-cairn",
    name: "Wishing Cairn",
    cost: { shell: 3, driftwood: 3 },
    footprint: { w: 1, h: 1 },
    spriteRef: "deco/wishing-cairn",
    flavor:
      "Three stones, stacked and balanced. Make a wish; the Keep won't tell if it doesn't come true.",
    effects: [{ kind: "comfort", need: "cleanliness", decayReduction: 0.02 }],
    setId: "tideline",
    icon: { motif: "stone" },
  },
  {
    id: "mossy-fountain",
    name: "Mossy Fountain",
    cost: { wood: 6, fiber: 4, shell: 4 },
    footprint: { w: 2, h: 2 },
    spriteRef: "deco/mossy-fountain",
    flavor:
      "Wood, shell and fiber, all in one basin. The Keep's answer to \"we have three of everything now.\"",
    effects: [{ kind: "comfort", need: "cleanliness", decayReduction: 0.02 }],
    setId: "deep-wood",
    icon: { motif: "droplet" },
  },

  // ---- ROUND 2F: twelve new decorations, one ✱ per set (bible §5.2) ----
  {
    id: "clover-patch",
    name: "Clover Patch",
    cost: { fiber: 3 },
    footprint: { w: 1, h: 1 },
    spriteRef: "deco/clover-patch",
    flavor: "A little patch of clover, gone slightly wild. Somebody's found the lucky one twice already.",
    effects: [{ kind: "comfort", need: "happiness", decayReduction: 0.01 }],
    setId: "meadow-green",
    icon: { motif: "leaf" },
  },
  {
    id: "hay-bale",
    name: "Hay Bale",
    cost: { fiber: 5, wood: 1 },
    footprint: { w: 1, h: 1 },
    spriteRef: "deco/hay-bale",
    flavor: "One good bale, dragged into the sun. Warm to sit against by afternoon.",
    effects: [{ kind: "comfort", need: "happiness", decayReduction: 0.02 }],
    setId: "meadow-green",
    icon: { motif: "leaf" },
  },
  {
    id: "rope-ladder",
    name: "Rope Ladder",
    cost: { fiber: 7, wood: 3 },
    footprint: { w: 1, h: 2 },
    spriteRef: "deco/rope-ladder",
    flavor: "Knotted rope, climbed more than it's used for anything sensible.",
    effects: [{ kind: "comfort", need: "energy", decayReduction: 0.02 }],
    setId: "bramble-twine",
    icon: { motif: "post" },
  },
  {
    id: "pine-marker",
    name: "Pine Marker",
    cost: { wood: 5 },
    footprint: { w: 1, h: 1 },
    spriteRef: "deco/pine-marker",
    flavor: "A single pine bough, staked upright. Smells like somewhere further off.",
    effects: [{ kind: "comfort", need: "cleanliness", decayReduction: 0.01 }],
    setId: "deep-wood",
    icon: { motif: "post" },
  },
  {
    id: "log-pile",
    name: "Log Pile",
    cost: { wood: 7, fiber: 2 },
    footprint: { w: 2, h: 1 },
    spriteRef: "deco/log-pile",
    flavor: "Split logs, stacked properly, the way somebody's grandfather would insist on.",
    effects: [{ kind: "comfort", need: "hunger", decayReduction: 0.01 }],
    setId: "deep-wood",
    icon: { motif: "basket" },
  },
  {
    id: "fern-cluster",
    name: "Fern Cluster",
    cost: { fiber: 6 },
    footprint: { w: 1, h: 1 },
    spriteRef: "deco/fern-cluster",
    flavor: "Ferns, thick and cool underfoot. The shadiest corner in the Keep.",
    effects: [{ kind: "comfort", need: "cleanliness", decayReduction: 0.02 }],
    setId: "deep-wood",
    icon: { motif: "leaf" },
  },
  {
    id: "snow-lantern",
    name: "Snow Lantern",
    cost: { wood: 4, fiber: 4 },
    footprint: { w: 1, h: 1 },
    spriteRef: "deco/snow-lantern",
    flavor: "A little lantern packed in snow, glowing through it rather than over it.",
    effects: [{ kind: "comfort", need: "energy", decayReduction: 0.01 }],
    setId: "first-snow",
    icon: { motif: "lantern" },
  },
  {
    id: "icicle-arch",
    name: "Icicle Arch",
    cost: { wood: 5, fiber: 8 },
    footprint: { w: 2, h: 1 },
    spriteRef: "deco/icicle-arch",
    flavor: "A doorway of real ice, somehow never quite melting.",
    effects: [{ kind: "comfort", need: "energy", decayReduction: 0.02 }],
    setId: "first-snow",
    icon: { motif: "arch" },
  },
  {
    id: "sled",
    name: "Sled",
    cost: { wood: 6, fiber: 3 },
    footprint: { w: 2, h: 1 },
    spriteRef: "deco/sled",
    flavor: "Waxed and ready, propped against the wall for a hill that doesn't exist here.",
    effects: [{ kind: "comfort", need: "happiness", decayReduction: 0.02 }],
    setId: "first-snow",
    icon: { motif: "bench" },
  },
  {
    id: "net-float",
    name: "Net Float",
    cost: { shell: 4, driftwood: 2 },
    footprint: { w: 1, h: 1 },
    spriteRef: "deco/net-float",
    flavor: "A glass float in an old net, salvaged whole from somewhere the tide didn't want it back.",
    effects: [{ kind: "comfort", need: "cleanliness", decayReduction: 0.01 }],
    setId: "tideline",
    icon: { motif: "shell" },
  },
  {
    id: "glow-pool",
    name: "Glow Pool",
    cost: { shell: 5, driftwood: 4 },
    footprint: { w: 2, h: 2 },
    spriteRef: "deco/glow-pool",
    flavor: "A shallow pool that glows faintly after dark, for reasons nobody's questioned twice.",
    effects: [{ kind: "comfort", need: "happiness", decayReduction: 0.02 }],
    setId: "lantern-ember",
    icon: { motif: "droplet" },
  },
  {
    id: "warm-stones",
    name: "Warm Stones",
    cost: { driftwood: 3, wood: 3 },
    footprint: { w: 1, h: 1 },
    spriteRef: "deco/warm-stones",
    flavor: "Stones that hold the day's warmth long after the sun's given up.",
    effects: [{ kind: "comfort", need: "energy", decayReduction: 0.02 }],
    setId: "lantern-ember",
    icon: { motif: "stone" },
  },
  // -------------------------------------------------------------------
  // ROUND 2J FIX STAGE — THE FIVE CRAFT-ONLY KEEPSAKES
  // (docs/economy-bible.md §4.4). These are the round's answer to its own
  // §5 sink problem, and the fix-stage blocker that named it: every
  // other sink in the game is FINITE (the ladder is 11 purchases; the
  // catalogue is 45 items), so a tier-12 player had a permanent lodestone
  // income and nothing left to spend it on. A craft-only decoration is
  // repeatable, permanent, and the only thing in the game whose price is
  // paid in the late resource — you can place as many Cairns as you have
  // grid for, forever.
  //
  // ⚠️ Each carries NO `cost` (see `craftOnly`) and NO `setId`: they are
  // not members of the six themed sets, so they cannot short-cut a set
  // bonus that the six themed groups are pacing.
  //
  // Effects are deliberately SMALL and every one of them feeds a channel
  // that is already summed-and-clamped somewhere: `remedy` at
  // `crafting.buildingRemedyMax`, `craftSpeed` at `crafting.speedMin`,
  // `expeditionSpeed` at `effectCaps.expeditionSpeedMin`, `xpBonus` at
  // `effectCaps.xpBonusMax`. Ten Cairns is not an immunity.
  // -------------------------------------------------------------------
  {
    id: "lodestone-cairn",
    name: "Lodestone Cairn",
    cost: {},
    craftOnly: true,
    footprint: { w: 1, h: 1 },
    spriteRef: "deco/lodestone-cairn",
    flavor: "Three stones, balanced, pointing. Trips out go a little more carefully near it.",
    effects: [{ kind: "remedy", contractReduction: 0.04, cureBonus: 0 }],
    icon: { motif: "stone" },
  },
  {
    id: "herb-rail",
    name: "Herb Rail",
    cost: {},
    craftOnly: true,
    footprint: { w: 1, h: 1 },
    spriteRef: "deco/herb-rail",
    flavor:
      "Everything drying in one place, where you can reach it at three in the morning.",
    effects: [{ kind: "remedy", contractReduction: 0, cureBonus: 0.03 }],
    icon: { motif: "leaf" },
  },
  {
    id: "chime-rail",
    name: "Chime Rail",
    cost: {},
    craftOnly: true,
    footprint: { w: 2, h: 1 },
    spriteRef: "deco/chime-rail",
    flavor: "Lodestone rings differently. Work goes quicker when something is keeping time.",
    effects: [{ kind: "craftSpeed", multiplier: 0.94 }],
    icon: { motif: "arch" },
  },
  {
    id: "compass-rose",
    name: "Compass Rose",
    cost: {},
    craftOnly: true,
    footprint: { w: 2, h: 2 },
    spriteRef: "deco/compass-rose",
    flavor: "Laid into the ground at the gate. Nobody gets lost on the way back.",
    effects: [{ kind: "expeditionSpeed", multiplier: 0.96 }],
    icon: { motif: "spark" },
  },
  {
    id: "wayhome-lantern",
    name: "Wayhome Lantern",
    cost: {},
    craftOnly: true,
    footprint: { w: 2, h: 2 },
    spriteRef: "deco/wayhome-lantern",
    flavor: "The biggest light the Keep has. It is not for finding your way out.",
    effects: [{ kind: "xpBonus", fraction: 0.03 }],
    icon: { motif: "lantern" },
  },
];
