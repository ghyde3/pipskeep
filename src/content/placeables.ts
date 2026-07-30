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
 *
 * ROUND 2F (docs/progression-bible.md §3.4) — every station gains an
 * `effects` list: the "just lovely" / "the Pips will use this" complaint
 * this round answers is that the shipped four stations already DO
 * something (the Bowl slows Hunger, the Bed speeds naps and slows Energy
 * decay, the Gathering Station and Stockpot host their jobs) but nowhere
 * SAID so. Aggregation, capping and actually applying these lives in
 * `core/keep/effects.ts` — this file only attaches the DATA. `job` entries
 * are descriptive only (`core/keep/jobs.ts`'s own `stationItemId` scan is
 * what actually hosts the job; it is unaffected by this list).
 *
 * ROUND 2F ALSO adds nine new stations (bible §5.1) and, with them, TWO
 * more required fields:
 *
 * - `unlockKeepLevel` — the tier this station first appears on the Build
 *   sheet (bible §2.3). This is what makes a Shell/Driftwood-priced
 *   station possible at all: `core/economy/reachability.test.ts`'s
 *   `pricedPlaceables.payableAt` reads THIS field instead of a hard-coded
 *   `1`, so `trail-post`/`beacon`/`weathervane` are checked against the
 *   income available at the tier they actually unlock on, not level 1.
 *   The four shipped stations stay `unlockKeepLevel: 1` except the
 *   Stockpot, which moves to 3 (content/keep.ts's tier-3 headline).
 * - `icon` — the procedural glyph id (`content/icons.ts`; rendered by `ui/icons.ts`,
 *   a separate task, renders it). Required so the Build sheet can never
 *   show a card with no icon at all.
 */

import type { ResourceBundle } from "../core/economy";
import type { Footprint, KeepLevel } from "../core/keep";
import type { BuildingEffect } from "./buildingEffects";
import type { IconSpec } from "./icons";
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
  /** Mechanical effects this station grants Keep-wide while placed (bible
   * §3.1); absent ≡ `[]`. Every entry strictly helps (§0.3) — see
   * `content/buildingEffects.test.ts`. */
  effects?: readonly BuildingEffect[];
  /** Keep tier this station first appears on the Build sheet (bible §2.3);
   * see the module doc for why this replaced a hard-coded "payable at
   * level 1" assumption. */
  unlockKeepLevel: KeepLevel;
  /** Procedural glyph id (bible §4.2) — see `content/icons.ts`. */
  icon: IconSpec;
}

export const placeables: readonly PlaceableDef[] = [
  {
    id: "food-bowl",
    name: "Food Bowl",
    cost: tuning.placeableCosts["food-bowl"],
    footprint: { w: 1, h: 1 },
    spriteRef: "placeable/food-bowl",
    flavor: "Berries pile up here faster than anyone eats them. That's rather the point.",
    effects: [{ kind: "comfort", need: "hunger", decayReduction: 0.06 }],
    unlockKeepLevel: 1,
    icon: { motif: "bowl" },
  },
  {
    id: "bed",
    name: "Bed",
    cost: tuning.placeableCosts.bed,
    footprint: { w: 2, h: 1 },
    spriteRef: "placeable/bed",
    flavor: "A proper nest. Naps happen here on purpose, not by accident on the nearest rug.",
    effects: [
      { kind: "restSpeed", multiplier: 1.25 },
      { kind: "comfort", need: "energy", decayReduction: 0.06 },
    ],
    unlockKeepLevel: 1,
    icon: { motif: "nest" },
  },
  {
    id: "gathering-station",
    name: "Gathering Station",
    cost: tuning.placeableCosts["gathering-station"],
    footprint: { w: 2, h: 2 },
    spriteRef: "placeable/gathering-station",
    flavor: "A big basket and a rake, propped and waiting. Someone is going to fill that basket.",
    effects: [{ kind: "job", jobId: "gathering" }],
    unlockKeepLevel: 1,
    icon: { motif: "basket" },
  },
  {
    id: "stockpot",
    name: "Stockpot",
    cost: tuning.placeableCosts["stockpot"],
    footprint: { w: 2, h: 2 },
    spriteRef: "placeable/stockpot",
    flavor:
      "A big pot that's always got something going. Never quite empty, never quite the same thing twice.",
    effects: [
      { kind: "job", jobId: "simmering" },
      { kind: "comfort", need: "hunger", decayReduction: 0.04 },
    ],
    // ROUND 2F (bible §2.3): moves from an implicit level-1 to tier 3 —
    // the Stockpot and the Simmering job are content/keep.ts's tier-3
    // headline unlock, alongside 3-of-a-set bonuses going live.
    unlockKeepLevel: 3,
    icon: { motif: "pot" },
  },

  // ---- ROUND 2F: nine new stations, one per ladder tier (bible §5.1) ----
  {
    id: "wash-basin",
    name: "Wash Basin",
    cost: tuning.placeableCosts["wash-basin"],
    footprint: { w: 1, h: 1 },
    spriteRef: "placeable/wash-basin",
    flavor: "A proper basin, always full, never cold. Nobody has to fetch water for this.",
    effects: [{ kind: "comfort", need: "cleanliness", decayReduction: 0.08 }],
    unlockKeepLevel: 2,
    icon: { motif: "droplet" },
  },
  {
    id: "play-post",
    name: "Play Post",
    cost: tuning.placeableCosts["play-post"],
    footprint: { w: 2, h: 1 },
    spriteRef: "placeable/play-post",
    flavor: "A scratched-up post that's clearly been climbed, chewed, and loved, in that order.",
    effects: [{ kind: "comfort", need: "happiness", decayReduction: 0.08 }],
    unlockKeepLevel: 2,
    icon: { motif: "post" },
  },
  {
    id: "larder",
    name: "Larder",
    cost: tuning.placeableCosts.larder,
    footprint: { w: 2, h: 2 },
    spriteRef: "placeable/larder",
    flavor: "Shelves that stay stocked. Somehow there is always one more jar.",
    // 0.08 → 0.13, so HUNGER CAN ACTUALLY REACH ITS CAP.
    //
    // Summing every comfort effect in the game gave hunger 0.20 against a
    // `comfortReductionMax` of 0.25, while cleanliness (0.22), happiness (0.22)
    // and energy (0.26) each cleared it — because those three have a SET bonus
    // topping them up (tideline, meadow-green, first-snow) and hunger has none.
    // So the Keep Comfort readout permanently showed "Hunger −20% of −25%" — an
    // unreachable ceiling on the fastest-decaying need (3.8/h) and the one that
    // binds the worst-case return, i.e. the need players chase hardest.
    //
    // It also made the bible's own §3.6 invariant table wrong: it predicts
    // Hardworking hunger coming home at 37.6 after a full capped absence, and
    // a maximally-built Keep actually delivered 34. At 0.13 the sum is exactly
    // 0.25 and the table is right again.
    //
    // The Larder is the right item to carry it: it IS the pantry, it is tier
    // 6's headline unlock alongside the Nest Warmer, and comfort can only ever
    // widen `balance.test.ts`'s leave-safe margin (bible §3.6 claim 4), so
    // there is no way for this number to hurt the player.
    effects: [{ kind: "comfort", need: "hunger", decayReduction: 0.13 }],
    unlockKeepLevel: 6,
    icon: { motif: "basket" },
  },
  {
    id: "nest-warmer",
    name: "Nest Warmer",
    cost: tuning.placeableCosts["nest-warmer"],
    footprint: { w: 1, h: 1 },
    spriteRef: "placeable/nest-warmer",
    flavor:
      "A gentle warmth under the egg, day and night, so nothing has to wait quite so long.",
    effects: [{ kind: "incubationSpeed", multiplier: 0.85 }],
    unlockKeepLevel: 6,
    icon: { motif: "nest" },
  },
  {
    id: "trail-post",
    name: "Trail Post",
    cost: tuning.placeableCosts["trail-post"],
    footprint: { w: 1, h: 1 },
    spriteRef: "placeable/trail-post",
    flavor:
      "A little signpost at the edge of the grounds. Every trip out passes it, and comes back knowing a bit more.",
    effects: [{ kind: "expeditionLoot", bonusRollChance: 0.03 }],
    unlockKeepLevel: 7,
    icon: { motif: "post" },
  },
  {
    id: "workbench",
    name: "Workbench",
    cost: tuning.placeableCosts.workbench,
    footprint: { w: 2, h: 2 },
    spriteRef: "placeable/workbench",
    flavor: "Sawdust, string, and a drawer of things that might be useful later. They usually are.",
    effects: [{ kind: "job", jobId: "mending" }],
    unlockKeepLevel: 8,
    icon: { motif: "bench" },
  },
  {
    id: "sun-bunks",
    name: "Sun Bunks",
    cost: tuning.placeableCosts["sun-bunks"],
    footprint: { w: 2, h: 2 },
    spriteRef: "placeable/sun-bunks",
    flavor: "The warm bunk. Whoever naps here wakes up first, and never says why.",
    effects: [
      { kind: "restSpeed", multiplier: 1.2 },
      { kind: "comfort", need: "energy", decayReduction: 0.05 },
    ],
    unlockKeepLevel: 8,
    icon: { motif: "nest" },
  },
  {
    id: "beacon",
    name: "Beacon",
    cost: tuning.placeableCosts.beacon,
    footprint: { w: 2, h: 2 },
    spriteRef: "placeable/beacon",
    flavor:
      "A steady light at the Keep's edge, bright enough to find the way home a little faster.",
    effects: [{ kind: "expeditionSpeed", multiplier: 0.92 }],
    unlockKeepLevel: 10,
    icon: { motif: "lantern" },
  },
  {
    id: "weathervane",
    name: "Weathervane",
    cost: tuning.placeableCosts.weathervane,
    footprint: { w: 1, h: 1 },
    spriteRef: "placeable/weathervane",
    flavor: "Turns with every draft, catching something none of the rest of the Keep notices.",
    effects: [
      { kind: "xpBonus", fraction: 0.08 },
      { kind: "eggChancePoints", points: 0.01 },
    ],
    unlockKeepLevel: 12,
    icon: { motif: "spark" },
  },
];
