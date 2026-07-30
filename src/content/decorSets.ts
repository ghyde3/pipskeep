/**
 * Themed decoration sets (docs/progression-bible.md §3.5) — the mechanic
 * that makes building feel like COLLECTING rather than tidying. Six
 * biome-themed sets; `core/keep/effects.ts` counts DISTINCT member
 * `itemId`s currently placed (five Moss Tufts is one member — a set is a
 * collection, not a spam) and grants `bonusAt3` at `setBonus.minMembersTier1`
 * (3) distinct members, upgrading to `bonusAt5` (REPLACING, never
 * stacking with, `bonusAt3`) at `minMembersTier2` (5) — both gated behind
 * the Keep tier that turns the mechanic on
 * (`setBonus.tier1LiveAtKeepLevel`/`tier2LiveAtKeepLevel`, tiers 3 and 6).
 *
 * ROUND 2F UPDATE: the content-authoring pass (progression-bible.md §5.2,
 * this round's implementation-order step 6) has now landed the twelve
 * ✱-marked new decorations `content/decorations.ts` was waiting on, so
 * every set below carries its FULL bible §3.5 roster and all six can reach
 * `minMembersTier2` (5) — no set is short anymore. (Nothing here or in
 * `core/keep/effects.ts` needed to change to make that true: this file's
 * whole design point was that adding members is a pure data change to
 * `memberItemIds`, proven out exactly as planned.) Two things worth being
 * explicit about, both correct (not bugs) and both covered by
 * `content/buildingEffects.test.ts`:
 *
 * - Meadow Green and Tideline end up with 7 and 6 members respectively
 *   (not 5) — the counting rule only needs "at least 5 distinct", so
 *   extra members past the minimum are simply more ways in, not a
 *   different mechanic.
 * - `cloud-kite` is a member of BOTH Meadow Green and First Snow on purpose
 *   (bible §3.5 calls this out by name) — membership is entirely
 *   `memberItemIds`-driven (never the item's own single `setId`, which is
 *   display-only — see `content/decorations.ts`), so one item counting
 *   toward two different sets' distinct-member tallies is exactly the
 *   intended shape, not a double-count bug.
 */

import type { BuildingEffect } from "./buildingEffects";

export interface DecorSetDef {
  readonly id: string;
  readonly name: string;
  /** Distinct decoration ids that count toward this set (bible §3.5's
   * counting rule — driven by THIS list, never by `DecorationDef.setId`). */
  readonly memberItemIds: readonly string[];
  /** Active at `setBonus.minMembersTier1` (3) distinct members placed. */
  readonly bonusAt3: BuildingEffect;
  /** Active at `setBonus.minMembersTier2` (5). REPLACES `bonusAt3` —
   * never stacks with it. */
  readonly bonusAt5: BuildingEffect;
}

export const decorSets: readonly DecorSetDef[] = [
  {
    id: "meadow-green",
    name: "Meadow Green",
    memberItemIds: [
      "moss-tuft",
      "pebble-path",
      "berry-planter",
      "toadstool-ring",
      "cloud-kite",
      "clover-patch",
      "hay-bale",
    ],
    bonusAt3: { kind: "comfort", need: "happiness", decayReduction: 0.04 },
    bonusAt5: { kind: "comfort", need: "happiness", decayReduction: 0.07 },
  },
  {
    id: "bramble-twine",
    name: "Bramble & Twine",
    memberItemIds: [
      "bramble-arch",
      "twine-swing",
      "story-stump",
      "welcome-sign",
      "rope-ladder",
    ],
    bonusAt3: { kind: "restSpeed", multiplier: 1.1 },
    bonusAt5: { kind: "restSpeed", multiplier: 1.18 },
  },
  {
    id: "deep-wood",
    name: "Deep Wood",
    memberItemIds: [
      "sun-awning",
      "mossy-fountain",
      "pine-marker",
      "log-pile",
      "fern-cluster",
    ],
    bonusAt3: { kind: "expeditionLoot", bonusRollChance: 0.02 },
    bonusAt5: { kind: "expeditionLoot", bonusRollChance: 0.04 },
  },
  {
    id: "first-snow",
    name: "First Snow",
    memberItemIds: [
      "wind-chime",
      "cloud-kite",
      "snow-lantern",
      "icicle-arch",
      "sled",
    ],
    bonusAt3: { kind: "comfort", need: "energy", decayReduction: 0.04 },
    bonusAt5: { kind: "comfort", need: "energy", decayReduction: 0.07 },
  },
  {
    id: "tideline",
    name: "Tideline",
    memberItemIds: [
      "driftwood-arch",
      "shell-mosaic",
      "tide-basin",
      "driftwood-bench",
      "wishing-cairn",
      "net-float",
    ],
    bonusAt3: { kind: "comfort", need: "cleanliness", decayReduction: 0.04 },
    bonusAt5: { kind: "comfort", need: "cleanliness", decayReduction: 0.07 },
  },
  {
    id: "lantern-ember",
    name: "Lantern & Ember",
    memberItemIds: [
      "cozy-lantern",
      "lantern-row",
      "ember-brazier",
      "glow-pool",
      "warm-stones",
    ],
    bonusAt3: { kind: "xpBonus", fraction: 0.05 },
    bonusAt5: { kind: "xpBonus", fraction: 0.1 },
  },
];
