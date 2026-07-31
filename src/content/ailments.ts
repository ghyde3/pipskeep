/**
 * Ailment registry (spec §16 v1.5, docs/lifecycle-bible.md §3).
 *
 * "Per-biome chance and countdown live in `content/ailments.ts`" —
 * `content/tuning.ts`'s `lifecycle.ailments` block already says so in its
 * own doc comment; the SHARED numbers (stage bands, cure odds, shields)
 * live there, and the per-biome numbers (which trail inflicts which
 * ailment, how likely, how long) live here — the same split
 * `content/expeditions.ts` uses for durations (tuning) vs loot tables
 * (content).
 *
 * ONLY a DEEP trip can carry risk (bible §3.2 — "quick trips are safe").
 * Meadow/Forest/Shore intentionally have no entry here at all: a Pip
 * returning from any of them can never contract anything, by construction
 * — `core/pips/ailment.ts`'s `ailmentForExpedition` simply finds nothing
 * for `fromExpeditionId` values outside this table.
 *
 * Countdown lengths (`totalMs`) are RATED time (bible §3.3) — every one of
 * them exceeds `tuning.lifecycle.ailments.minDurationMs` (36h), which
 * itself exceeds `tuning.offlineRateCapMs` (16h): a Pip that is healthy
 * when the app closes can never be worse than "grave" when it reopens,
 * however long the absence. Lanternfever is exactly the minimum (36h) —
 * bible's own worked example.
 */

import { HOUR_MS } from "./tuning";

/**
 * The cure item (bible §3.5's poultice route). A Give Item consumable
 * with ZERO hunger/side effects — `core/pips/care.ts`'s `giveItem` case
 * already handles any itemId with no food-registry match as a plain gift
 * (sets `lastGiftItemId`, no stat change), so this needs no food-registry
 * entry of its own; `core/state.ts`'s `applyAilmentCureForAction` rolls
 * the actual cure attempt as a side effect of that same GIVE_ITEM action.
 *
 * FINDABLE ON ALL THREE DEEP TRAILS, at weight 4 in each
 * (`content/expeditions.ts`): roughly 27% of Bramblewick trips, 37% of
 * Snowdrift's and 44% of the Lanterngrotto's bring one home. Generous on
 * purpose — the trails that carry the risk are the trails that carry the
 * remedy, so a player who takes the danger is already collecting the
 * answer to it. It carries an `effectCopy` in `content/foods.ts` so the
 * Satchel says what it is for; the generated line would read "+0 Hunger".
 */
export const POULTICE_ITEM_ID = "poultice";

export const AILMENT_IDS = ["brambleburr", "chillshake", "lanternfever"] as const;
export type AilmentId = (typeof AILMENT_IDS)[number];

export interface AilmentDef {
  readonly id: AilmentId;
  readonly name: string;
  /** The ONE biome whose deep trip can inflict this ailment (bible §3.2). */
  readonly fromExpeditionId: string;
  /** Countdown length in RATED ms (bible §3.3) — decrements only while the
   * player is actually present, at the same rate needs decay. */
  readonly totalMs: number;
  /** Contraction probability on a completed trip to `fromExpeditionId`,
   * before the Pip's own constitution (level) and any scar immunity. */
  readonly contractChance: number;
  readonly flavor: string;
}

export const ailments: Readonly<Record<AilmentId, AilmentDef>> = {
  brambleburr: {
    id: "brambleburr",
    name: "Brambleburr",
    fromExpeditionId: "bramblewick",
    totalMs: 48 * HOUR_MS,
    contractChance: 0.05,
    flavor: "A burr worked deep under the fur.",
  },
  chillshake: {
    id: "chillshake",
    name: "Chillshake",
    fromExpeditionId: "snowdrift",
    totalMs: 42 * HOUR_MS,
    contractChance: 0.07,
    flavor: "A shiver that won't settle.",
  },
  lanternfever: {
    id: "lanternfever",
    name: "Lanternfever",
    fromExpeditionId: "lanterngrotto",
    totalMs: 36 * HOUR_MS,
    contractChance: 0.1,
    flavor: "Glowing too bright, burning too fast.",
  },
};
