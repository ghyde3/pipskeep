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
  // ---- ROUND 2H: the Poultice Shelf (bible §3.5, docs/lifecycle-bible.md) ----
  {
    id: "poultice-shelf",
    name: "Poultice Shelf",
    cost: tuning.placeableCosts["poultice-shelf"],
    footprint: { w: 1, h: 1 },
    spriteRef: "placeable/poultice-shelf",
    flavor:
      "Jars of leaves, wraps and something sharp-smelling, always within reach. Everything you'd want on a bad night.",
    // ROUND 2J FIX STAGE — THE SHELF FINALLY DOES SOMETHING. This entry
    // shipped with NO `effects` array at all: a named tier-5 headline
    // costing `wood 7, fiber 6`, described as "everything you'd want on a
    // bad night", whose every mechanical parameter (`rollContraction`'s
    // `buildingContractReduction`, `attemptCure`'s building bonus) was
    // permanently 0. A dead placeable and a dead promise, both shipped.
    //
    // The `remedy` kind now exists (`content/buildingEffects.ts`), is
    // folded by `core/keep/effects.ts` and clamped once at
    // `tuning.crafting.buildingRemedyMax` — so ten shelves cannot become a
    // 0.60 immunity. The numbers are docs/economy-bible.md §3.6's own
    // recommendation verbatim (0.10 / 0.05), which leaves real headroom
    // under the 0.15/0.06 aggregate for the crafted Cairn and Herb Rail to
    // add to without either becoming redundant.
    //
    // ⚠️ It may never make ailments a formality — 2H's I4 stands: the cure
    // CHANCES (`poulticeCureChance` 0.55, `cureBonusMax` 0.45) are
    // untouched, and this feeds the same already-clamped channel a Pip's
    // own level does.
    effects: [{ kind: "remedy", contractReduction: 0.1, cureBonus: 0.05 }],
    // Tier 5 (bible §3.5) — lands alongside Lanterngrotto, the riskiest
    // trail, so the answer to "what if" is on the Build sheet the same
    // tier the question first gets sharp. Payable at level 5 with plain
    // wood/fiber (`core/economy/reachability.test.ts`).
    unlockKeepLevel: 5,
    icon: { motif: "leaf" },
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
    //
    // ROUND 2J FIX STAGE adds the `longevity` half docs/lifecycle-bible.md
    // §2.2 already ASSUMED was here ("three already-shipped placeables
    // carry it — nest-warmer 0.06, sun-bunks 0.10, larder 0.05 = 0.21").
    // They did not; the effect kind did not exist, `lifespanMs`'s
    // `buildingLongevity` was permanently 0, and that bible's "a devoted
    // player's Pip lives 15.6 days" was unreachable (true max 12.85).
    // These three entries make its own arithmetic true, under the shipped
    // `lifecycle.lifespan.buildingBonusMax` (0.25) clamp.
    effects: [
      { kind: "comfort", need: "hunger", decayReduction: 0.13 },
      { kind: "longevity", bonus: 0.05 },
    ],
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
    // ROUND 2J FIX STAGE — the `longevity` half lifecycle-bible §2.2
    // already assumed was here (see the Larder's own note).
    effects: [
      { kind: "incubationSpeed", multiplier: 0.85 },
      { kind: "longevity", bonus: 0.06 },
    ],
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
      // ROUND 2J FIX STAGE — see the Larder's `longevity` note.
      { kind: "longevity", bonus: 0.1 },
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
  /**
   * ROUND 2J (docs/economy-bible.md §3.1) — the Craft Table: Crafting's
   * station, hosting the `"crafting"`-kind job (`content/jobs.ts`). A
   * deliberate sibling of the Workbench, not a replacement — Mending
   * makes more of what you already have (a weighted wood/fiber faucet);
   * Crafting makes a specific thing you asked for (a deterministic
   * recipe). Tier 4: the tier that unlocks the Shore (this round's fifth
   * resource in volume) and ONE TIER BEFORE the Lanterngrotto, so the
   * answer to "my Pip came home ill" exists on the Build sheet before the
   * riskiest trail in the game opens. Cost is wood/fiber only (payable at
   * tier 4 with enormous margin) — inlined here rather than routed
   * through `tuning.placeableCosts` (this round's design pass already
   * edited `tuning.ts` once for the `crafting` block; a second edit for
   * one cost bundle was not worth reopening that file for).
   *
   * Carries no `effects` beyond hosting the job — docs/economy-bible.md
   * §3.6's `craftSpeed` channel is this round's named, explicitly-cut
   * seam (the effect union + `foldEffect` + the badge map are a
   * coordinated content+core+ui patch for a future round to accept).
   */
  {
    id: "craft-table",
    name: "Craft Table",
    cost: { wood: 8, fiber: 6 },
    footprint: { w: 2, h: 2 },
    spriteRef: "placeable/craft-table",
    flavor:
      "Twine, jars, a knife that's seen things, and a half-finished something nobody will admit to starting.",
    effects: [{ kind: "job", jobId: "crafting" }],
    unlockKeepLevel: 4,
    icon: { motif: "bench" },
  },

  /**
   * ROUND 2K — THE SIX ATTRACTIONS (docs/liveliness-bible.md §1.2). One per
   * biome, because "what you build shapes who visits" is only a real
   * decision if every biome has a door. Each carries exactly one
   * `attraction` effect naming that biome's id — `core/attractions/`'s
   * `visitorPool()` reads it as `expeditions[biomeId].eggSpecies ∩ caught`
   * (I1: a partition, never a margin — an attraction can never advance the
   * Album, only bring back a species the player already owns). All six
   * unlock at tier 6 alongside the Larder and the Nest Warmer
   * (`content/keep.ts`); costs live in `tuning.placeableCosts` like every
   * other station's, and the recurring restock/welcome costs that make
   * this round's wood-heavy economy sink live in `tuning.attractions`.
   *
   * None carries a `comfort` effect — hunger's declared budget sits at
   * EXACTLY 1.00× `comfortReductionMax` after round 2F's Larder retune, so
   * there is zero slack (2F's knife-edge; docs/liveliness-bible.md §6.2).
   * An attraction is a door, not a cushion.
   */
  {
    id: "clover-ring",
    name: "Clover Ring",
    cost: tuning.placeableCosts["clover-ring"],
    footprint: { w: 2, h: 2 },
    spriteRef: "placeable/clover-ring",
    flavor: "A ring of clover nobody's allowed to cut. Word gets round.",
    effects: [{ kind: "attraction", biomeId: "meadow" }],
    unlockKeepLevel: 6,
    icon: { motif: "leaf" },
  },
  {
    id: "thicket-feeder",
    name: "Thicket Feeder",
    cost: tuning.placeableCosts["thicket-feeder"],
    footprint: { w: 1, h: 1 },
    spriteRef: "placeable/thicket-feeder",
    flavor:
      "A basket wedged in the hedge. Something eats from it every night and never says thank you.",
    effects: [{ kind: "attraction", biomeId: "bramblewick" }],
    unlockKeepLevel: 6,
    icon: { motif: "basket" },
  },
  {
    id: "sap-bucket",
    name: "Sap Bucket",
    cost: tuning.placeableCosts["sap-bucket"],
    footprint: { w: 1, h: 1 },
    spriteRef: "placeable/sap-bucket",
    flavor: "Slow, sweet, and impossible to walk past. Ask anyone.",
    effects: [{ kind: "attraction", biomeId: "forest" }],
    unlockKeepLevel: 6,
    icon: { motif: "bowl" },
  },
  {
    id: "snow-bell",
    name: "Snow Bell",
    cost: tuning.placeableCosts["snow-bell"],
    footprint: { w: 1, h: 1 },
    spriteRef: "placeable/snow-bell",
    flavor:
      "It only rings when it's cold enough. Whoever comes when it does already knew what it meant.",
    effects: [{ kind: "attraction", biomeId: "snowdrift" }],
    unlockKeepLevel: 6,
    icon: { motif: "chime" },
  },
  {
    id: "tidewrack",
    name: "Tidewrack",
    cost: tuning.placeableCosts["tidewrack"],
    footprint: { w: 2, h: 2 },
    spriteRef: "placeable/tidewrack",
    flavor: "Everything the tide left, arranged on purpose. It's an invitation, if you can read it.",
    effects: [{ kind: "attraction", biomeId: "shore" }],
    unlockKeepLevel: 6,
    icon: { motif: "shell" },
  },
  {
    id: "lampwell",
    name: "Lampwell",
    cost: tuning.placeableCosts["lampwell"],
    footprint: { w: 2, h: 2 },
    spriteRef: "placeable/lampwell",
    flavor: "A dish of glowstone kept lit at the Keep's edge. Down in the grotto, that means welcome.",
    effects: [{ kind: "attraction", biomeId: "lanterngrotto" }],
    unlockKeepLevel: 6,
    icon: { motif: "lantern" },
  },
];
