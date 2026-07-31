/**
 * Crafting (spec §6.2's registry promise, cashed — docs/economy-bible.md
 * §3): a QUEUE of recipes worked by a Pip at a placed Craft Table.
 *
 * Crafting reuses the EXISTING job-assignment machinery wholesale
 * (`core/keep/jobs.ts`'s `assignPipToJob`/`unassignPipFromJob`): a Craft
 * Table is a station like any other (content hosts a `"crafting"`-kind
 * job on it), so "one Pip per station", the Idle-only/Sulking-refusal
 * legality, and the focus view's "${name} is crafting away" line all fall
 * out for free (bible §3.2). This module owns the part that IS new: the
 * recipe queue itself, keyed by STATION (`PlacementId`), not by Pip —
 * `state.crafts[stationPlacementId]`.
 *
 * INPUTS ARE SPENT ON ENQUEUE, not on completion (bible §3.4): the player
 * cannot queue what they cannot pay for, and a cancelled order — queued
 * OR in flight — refunds in full. Nothing here ever outputs a base
 * resource (I2, docs/economy-bible.md §0.2): recipes consume resources
 * and Satchel items and produce an item or a keepsake, never the reverse
 * — `reachability.test.ts` models expeditions as the only faucet, and a
 * recipe that minted a resource would be invisible to it.
 *
 * TIME is derived from timestamps, exactly like expeditions and Gathering
 * (never `setTimeout`): `CraftOrder.startedAt + CraftOrder.effectiveMs` is
 * the completion moment. `effectiveMs` is SNAPSHOTTED once, when a recipe
 * BECOMES the active order (at enqueue if the station was idle, or when
 * the prior order completes/cancels and the next queued recipe is
 * promoted) — never recomputed afterward, so a Pip levelling up mid-craft
 * cannot retroactively change a craft already in flight, and the timer
 * survives a building being tucked away (bible §3.6/§5.1).
 *
 * OFFLINE: crafting is a RATE, not a timer (spec §4.5 — "rates are
 * capped, timers are not"), and obeys `offlineRateCapMs` exactly like
 * Gathering: `collectCraftCatchupEvents` is the `runCatchup` extraEvents
 * seam, capped at the first `offlineRateCapMs` of the absence, and each
 * fired completion only actually lands iff the station's Pip is STILL
 * `AssignedJob` at that moment — a Pip who bottoms out and sulks
 * mid-window stops crafting from that boundary, same as Gathering (bible
 * §3.5). `shiftCraftsPastFreeze` then slides the surviving order's
 * `startedAt` past the rate-frozen tail so the first live TICK cannot
 * backfill a long absence in one burst.
 *
 * NO RNG. Recipes are deterministic — inputs in, a fixed output out — so
 * unlike Gathering's two-phase "record the tick, roll it after the pass"
 * shape (which exists ONLY to keep the loot-stream cursor's advance order
 * chronological across concurrently-working Pips), a craft completion's
 * `apply` grants its output immediately. No new rng stream, no new cursor
 * (round 2C's "retention systems add no rng cursors" extends verbatim
 * here).
 *
 * DOCUMENTED SIMPLIFICATION (offline chaining): when an absence spans
 * more than one queued completion at the same station, the completion
 * times for the SECOND and later items are pre-computed from the
 * currently-assigned Pip's level and the building speed multiplier AT
 * COLLECTION TIME (the start of the whole absence) — mirroring how this
 * codebase already freezes `keepEffects`/`keepComfort` once per dispatch
 * rather than re-resolving them per segment. A Pip that levels up mid-
 * absence (from other XP sources) will not see that speed bonus apply to
 * a not-yet-started queued craft until the NEXT live TICK/CATCHUP
 * recomputes it fresh. This never affects the rate cap, never invents a
 * craft, and is off by at most a few minutes on a queued (not yet
 * started) item — an acceptable, explicitly-flagged tradeoff given the
 * alternative (a nested per-event re-simulation) for the size of this
 * round.
 *
 * Purity: no clock, no Math.random. ZERO tuning literals — every number
 * comes from `tuning.crafting` (defaults to `content/tuning.ts`,
 * injectable for tests), and the recipe registry comes from
 * `content/recipes.ts` (also injectable, same pattern as
 * `core/keep/jobs.ts`'s `JobContent`).
 */

import { tuning as contentTuning } from "../../content/tuning";
import { recipes as contentRecipes } from "../../content/recipes";
import { jobs as contentJobs } from "../../content/jobs";
import type { ResourceBundle } from "../economy";
import { spend } from "../economy";
import { PipActivity } from "../pips/types";
import type { PipId, PipState } from "../pips/types";
import { pipLevel } from "../pips/level";
import type { CatchupEvent, CatchupState } from "../pips/catchup";
import type { JobsByPip } from "../keep/jobs";
import type { KeepState, PlacementId } from "../keep";

/** Tag of the custom catch-up event one offline craft completion fires
 * through the `runCatchup` extraEvents seam (mirrors `JOB_TICK_TAG`). */
export const CRAFT_TICK_TAG = "craftDone";

/** What a finished recipe hands over (docs/economy-bible.md §3.3). An
 * `"item"` lands in `state.inventory` (a food/consumable id); a
 * `"keepsake"` lands on round 2F's Keepsake Shelf (`state.keepsakes`),
 * never directly placed — the same "granted, re-placeable, no resource
 * refund on removal" contract every other keepsake already honors. */
export type RecipeOutput =
  | { readonly kind: "item"; readonly itemId: string; readonly count: number }
  | { readonly kind: "keepsake"; readonly itemId: string; readonly count: number };

/**
 * Structural view of one recipe as core needs it (content ids are opaque
 * — spec §2 rule 5). `content/recipes.ts`'s `RecipeDef` satisfies this.
 */
export interface RecipeView {
  readonly id: string;
  /** Keep tier this recipe appears in the book at (`reachability.test.ts`'s
   * `pricedRecipes.payableAt`, per the bible). */
  readonly unlockKeepLevel: number;
  /** Resource inputs, spent from `state.resources` at ENQUEUE. */
  readonly resources: Readonly<Record<string, number>>;
  /** Satchel (food/consumable) inputs, spent from `state.inventory` at the
   * SAME moment. Deliberately separate from `resources` (bible §3.3): a
   * structural reachability check treats the two ledgers differently. */
  readonly items?: Readonly<Record<string, number>>;
  readonly output: RecipeOutput;
  /** Base craft time in ms, before building/Pip-level speed (§3.4/§3.6/
   * §3.7) — bounded by `tuning.crafting.minDurationMs`/`maxDurationMs`. */
  readonly durationMs: number;
}

export type RecipeRegistryView = Readonly<Record<string, RecipeView>>;

/** Structural view of a job registry entry, just enough to tell a
 * crafting station apart from any other (mirrors `core/keep/jobs.ts`'s
 * own tiny `stationItemId` scan; duplicated rather than imported since
 * that scan is module-private there). */
export type CraftingJobRegistryView = Readonly<
  Record<string, { readonly stationItemId: string; readonly kind?: "production" | "crafting" }>
>;

/** One station's standing order: the ACTIVE recipe plus everything queued
 * behind it (spec §8, save schema v11). Keyed by `PlacementId`, not by
 * Pip — the station is what is doing the work (bible §3.2/§6.3's Doorstep
 * line, "The Craft Table finished: 2 Poultices"). */
export interface CraftOrder {
  /** The Pip working this station when the ACTIVE recipe started (or was
   * last promoted) — attribution for Keep/Pip XP, never re-validated for
   * completion legality by identity (see module doc: completion checks
   * "is SOME Pip currently AssignedJob here", not "is this exact Pip"). */
  readonly pipId: PipId;
  readonly recipeId: string;
  /** Clock ms the ACTIVE recipe started (or was promoted from the
   * queue). The completion is DERIVED (`startedAt + effectiveMs`), never
   * a stored countdown. */
  readonly startedAt: number;
  /** Snapshotted once, when this recipe became active (see module doc). */
  readonly effectiveMs: number;
  /** Recipe ids waiting behind, max `tuning.crafting.queueMax`. */
  readonly queue: readonly string[];
}

export type CraftsByStation = Readonly<Record<PlacementId, CraftOrder>>;

/** The slice of `tuning.crafting` the speed/queue math reads (injectable
 * for tests; `content/tuning.ts`'s `tuning.crafting` satisfies it). */
export interface CraftingTuning {
  readonly queueMax: number;
  /** Multiply-then-clamp floor for the (currently unwired) building
   * `craftSpeed` channel — see module doc's building-multiplier seam. */
  readonly speedMin: number;
  /** Composite floor applied AFTER both multipliers (bible §3.6). */
  readonly speedFloorWithLevel: number;
  /** Per-Pip-level speed multiplier, indexed by `level − 1` (bible §3.7). */
  readonly pipLevelSpeed: readonly number[];
}

/** Injectable content, defaulting to the real registries/tuning (same
 * pattern as every sibling `core/` module). */
export interface CraftingContent {
  readonly registry?: RecipeRegistryView;
  readonly jobRegistry?: CraftingJobRegistryView;
  readonly tuning?: CraftingTuning;
  /**
   * The Keep's already-resolved, already-clamped `craftSpeed` building
   * multiplier (product of every placed item's `craftSpeed` effect,
   * clamped at `tuning.crafting.speedMin`) — mirrors how `runCatchup`
   * accepts `keepComfort` as an injected, pre-resolved value. Defaults to
   * the identity (`1`): no placeable in this round carries a `craftSpeed`
   * effect yet (docs/economy-bible.md §3.6's cut recommendation), so every
   * caller that omits this is byte-identical, and the channel activates
   * automatically the moment a future round wires
   * `BuildingEffect`'s `craftSpeed` kind through `resolveKeepEffects`.
   */
  readonly buildingCraftSpeedMultiplier?: number;
}

/**
 * The slice of GameState the crafting engine's LIVE (enqueue/cancel/
 * settle) functions read/write. Structural so this module never imports
 * `core/state.ts`; `GameState` satisfies it.
 */
export interface CraftStateSlice {
  readonly keep: KeepState;
  readonly jobs: JobsByPip;
  readonly pips: Readonly<Record<PipId, PipState>>;
  readonly crafts: CraftsByStation;
  readonly resources: Readonly<Record<string, number>>;
  readonly inventory: Readonly<Record<string, number>>;
  readonly keepsakes: Readonly<Record<string, number>>;
}

/** Why an ENQUEUE_CRAFT was refused. Always STRUCTURAL ("the world said
 * no") — unlike ASSIGN_JOB there is no Sulking-voiced refusal here: the
 * Pip already said yes when it took the job. `cannotAfford` carries a
 * typed `missing` bundle (economy's own `spend` shortfall shape, so the
 * UI can say "12 more Lodestone needed" the same way the Keep upgrade
 * card already does — the "refuses warmly" this round asks for). */
export type CraftRefusalReason =
  | "unknownStation"
  | "unstaffed"
  | "locked"
  | "queueFull"
  | "cannotAfford"
  | "unknownRecipe";

export type CraftOutcome =
  | {
      readonly action: "enqueueCraft";
      readonly ok: true;
      readonly stationPlacementId: PlacementId;
      readonly recipeId: string;
      readonly pipId: PipId;
      readonly at: number;
      /** `true` when this recipe became the ACTIVE order immediately;
       * `false` when it joined the queue behind an in-flight one. */
      readonly startedImmediately: boolean;
    }
  | {
      readonly action: "enqueueCraft";
      readonly ok: false;
      readonly stationPlacementId: PlacementId;
      readonly recipeId: string;
      readonly at: number;
      readonly reason: CraftRefusalReason;
      readonly missing?: Readonly<Record<string, number>>;
    }
  | {
      readonly action: "cancelCraft";
      readonly ok: true;
      readonly stationPlacementId: PlacementId;
      readonly recipeId: string;
      readonly at: number;
    }
  | {
      readonly action: "cancelCraft";
      readonly ok: false;
      readonly stationPlacementId: PlacementId;
      readonly at: number;
      readonly reason: "notCrafting" | "badIndex";
    };

export interface CraftResult<S extends CraftStateSlice> {
  readonly state: S;
  readonly outcome: CraftOutcome;
}

/** Which queued entry (or the active one) a CANCEL_CRAFT targets. */
export type CraftCancelTarget =
  | { readonly kind: "active" }
  | { readonly kind: "queued"; readonly index: number };

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

/** The Pip currently assigned to a station, if any (a reverse scan of
 * `state.jobs` — the same relationship `core/keep/jobs.ts`'s
 * `stationOccupied` already exploits, just read the other direction). */
function workingPipAt(jobs: JobsByPip, stationPlacementId: PlacementId): PipId | undefined {
  for (const [pipId, job] of Object.entries(jobs)) {
    if (job.stationPlacementId === stationPlacementId) return pipId;
  }
  return undefined;
}

/** True when `itemId` hosts a `"crafting"`-kind job (i.e. is a Craft
 * Table or a future sibling) per the job registry. */
function isCraftingStationItem(itemId: string, jobRegistry: CraftingJobRegistryView): boolean {
  return Object.values(jobRegistry).some(
    (job) => job.kind === "crafting" && job.stationItemId === itemId,
  );
}

/** Per-Pip-level speed multiplier — `1` (identity) at level 1, absent
 * table, or a level outside the table's range holds the nearest end
 * (same clamp-to-bounds discipline `core/pips/level.ts`'s
 * `levelTableValue` uses). */
function pipLevelSpeedMultiplier(level: number, tuning: CraftingTuning): number {
  const table = tuning.pipLevelSpeed;
  if (table === undefined || table.length === 0) return 1;
  const idx = Math.min(Math.max(Math.trunc(level) - 1, 0), table.length - 1);
  return (table[idx] as number | undefined) ?? 1;
}

/**
 * A recipe's EFFECTIVE duration (bible §3.6): building `craftSpeed`
 * (multiply-then-clamp at `speedMin`) × the Pip's own level multiplier,
 * floored once, together, at `speedFloorWithLevel × base` — the same
 * "composite floor stated separately" shape
 * `progression.effectCaps.expeditionSpeedFloorWithQuirk` already uses.
 * Exported so `crafting.balance.test.ts`-style callers can assert the
 * cure ceiling directly against this function.
 */
export function effectiveCraftDurationMs(
  baseDurationMs: number,
  level: number,
  buildingCraftSpeedMultiplier: number,
  tuning: CraftingTuning,
): number {
  const buildingMult = Math.min(Math.max(buildingCraftSpeedMultiplier, tuning.speedMin), 1);
  const levelMult = pipLevelSpeedMultiplier(level, tuning);
  const effective = baseDurationMs * buildingMult * levelMult;
  const floor = baseDurationMs * tuning.speedFloorWithLevel;
  return Math.max(effective, floor);
}

/** The minimal slice `grantOutput` touches — satisfied by both
 * `CraftStateSlice` (live) and `CraftCatchupState` (offline), so the same
 * function grants an output either way. */
interface OutputSlice {
  readonly inventory: Readonly<Record<string, number>>;
  readonly keepsakes: Readonly<Record<string, number>>;
}

/** Grant a recipe's output to the right bucket — item → inventory,
 * keepsake → the Keepsake Shelf's holding bag (round 2F's `state.
 * keepsakes`, never placed directly — see module doc). */
function grantOutput<S extends OutputSlice>(state: S, output: RecipeOutput): S {
  if (output.kind === "item") {
    return {
      ...state,
      inventory: {
        ...state.inventory,
        [output.itemId]: (state.inventory[output.itemId] ?? 0) + output.count,
      },
    };
  }
  return {
    ...state,
    keepsakes: {
      ...state.keepsakes,
      [output.itemId]: (state.keepsakes[output.itemId] ?? 0) + output.count,
    },
  };
}

/** Refund one recipe's FULL cost (resources + Satchel items) back onto
 * `state` — the exact inverse of what enqueueing it spent. Recipes
 * removed from content between sessions refund nothing (defensive; there
 * is nothing sane to refund for an id nobody can describe any more). */
function refundRecipeCost<S extends CraftStateSlice>(
  state: S,
  recipeId: string,
  registry: RecipeRegistryView,
): S {
  const recipe = registry[recipeId];
  if (recipe === undefined) return state;
  const resources = { ...state.resources };
  for (const [id, amount] of Object.entries(recipe.resources)) {
    resources[id] = (resources[id] ?? 0) + amount;
  }
  const inventory = { ...state.inventory };
  for (const [id, amount] of Object.entries(recipe.items ?? {})) {
    inventory[id] = (inventory[id] ?? 0) + amount;
  }
  return { ...state, resources, inventory };
}

// ---------------------------------------------------------------------------
// ENQUEUE / CANCEL — the LIVE, player-facing actions
// ---------------------------------------------------------------------------

/**
 * Start (or queue behind an in-flight order) one recipe at a placed Craft
 * Table (bible §3.1–§3.4). Pure; refusals are typed outcomes, never
 * exceptions. Inputs are spent HERE, in full, the moment the request is
 * accepted — whether it becomes the active order or joins the queue.
 */
export function enqueueCraft<S extends CraftStateSlice>(
  state: S,
  stationPlacementId: PlacementId,
  recipeId: string,
  at: number,
  content: CraftingContent = {},
): CraftResult<S> {
  const registry: RecipeRegistryView = content.registry ?? contentRecipes;
  const jobRegistry = content.jobRegistry ?? contentJobs;
  const tuning = content.tuning ?? contentTuning.crafting;
  const buildingMult = content.buildingCraftSpeedMultiplier ?? 1;

  const refuse = (
    reason: CraftRefusalReason,
    missing?: Readonly<Record<string, number>>,
  ): CraftResult<S> => ({
    state,
    outcome: {
      action: "enqueueCraft",
      ok: false,
      stationPlacementId,
      recipeId,
      at,
      reason,
      ...(missing !== undefined ? { missing } : {}),
    },
  });

  const placement = state.keep.placements[stationPlacementId];
  if (placement === undefined || !isCraftingStationItem(placement.itemId, jobRegistry)) {
    return refuse("unknownStation");
  }

  const recipe = registry[recipeId];
  if (recipe === undefined) return refuse("unknownRecipe");
  if (recipe.unlockKeepLevel > state.keep.level) return refuse("locked");

  const pipId = workingPipAt(state.jobs, stationPlacementId);
  const pip = pipId !== undefined ? state.pips[pipId] : undefined;
  if (pipId === undefined || pip === undefined || pip.activity !== PipActivity.AssignedJob) {
    return refuse("unstaffed");
  }

  const existing = state.crafts[stationPlacementId];
  if (existing !== undefined && existing.queue.length >= tuning.queueMax) {
    return refuse("queueFull");
  }

  // Affordability, both ledgers, ONE combined typed shortfall (bible
  // §3.3: resources and Satchel items are separate ledgers on purpose).
  const spendResult = spend(state.resources, recipe.resources as ResourceBundle);
  const itemsCost = recipe.items ?? {};
  const missingItems: Record<string, number> = {};
  for (const [itemId, amount] of Object.entries(itemsCost)) {
    const have = state.inventory[itemId] ?? 0;
    if (have < amount) missingItems[itemId] = amount - have;
  }
  if (!spendResult.ok || Object.keys(missingItems).length > 0) {
    const missing: Record<string, number> = { ...(!spendResult.ok ? spendResult.missing : {}), ...missingItems };
    return refuse("cannotAfford", missing);
  }

  const inventory = { ...state.inventory };
  for (const [itemId, amount] of Object.entries(itemsCost)) {
    inventory[itemId] = (inventory[itemId] ?? 0) - amount;
  }

  let crafts: Record<PlacementId, CraftOrder>;
  let startedImmediately: boolean;
  if (existing === undefined) {
    const effectiveMs = effectiveCraftDurationMs(
      recipe.durationMs,
      pipLevel(pip),
      buildingMult,
      tuning,
    );
    crafts = {
      ...state.crafts,
      [stationPlacementId]: { pipId, recipeId, startedAt: at, effectiveMs, queue: [] },
    };
    startedImmediately = true;
  } else {
    crafts = {
      ...state.crafts,
      [stationPlacementId]: { ...existing, queue: [...existing.queue, recipeId] },
    };
    startedImmediately = false;
  }

  return {
    state: { ...state, resources: spendResult.resources, inventory, crafts },
    outcome: {
      action: "enqueueCraft",
      ok: true,
      stationPlacementId,
      recipeId,
      pipId,
      at,
      startedImmediately,
    },
  };
}

/**
 * Cancel the active order or one queued entry at a station (bible §3.4):
 * refunds that recipe's FULL cost. Cancelling the active order promotes
 * the next queued recipe (if any), snapshotting a FRESH `effectiveMs` at
 * `at` using whichever Pip currently staffs the station (falling back to
 * the cancelled order's own Pip if the station is momentarily unstaffed —
 * defensive; `ENQUEUE_CRAFT` cannot have queued anything without a
 * staffed station, so this only matters if the Pip left between then and
 * now).
 */
export function cancelCraft<S extends CraftStateSlice>(
  state: S,
  stationPlacementId: PlacementId,
  target: CraftCancelTarget,
  at: number,
  content: CraftingContent = {},
): CraftResult<S> {
  const registry: RecipeRegistryView = content.registry ?? contentRecipes;
  const tuning = content.tuning ?? contentTuning.crafting;
  const buildingMult = content.buildingCraftSpeedMultiplier ?? 1;

  const refuseCancel = (reason: "notCrafting" | "badIndex"): CraftResult<S> => ({
    state,
    outcome: { action: "cancelCraft", ok: false, stationPlacementId, at, reason },
  });

  const order = state.crafts[stationPlacementId];
  if (order === undefined) return refuseCancel("notCrafting");

  if (target.kind === "queued") {
    const idx = target.index;
    if (!Number.isInteger(idx) || idx < 0 || idx >= order.queue.length) {
      return refuseCancel("badIndex");
    }
    const cancelledRecipeId = order.queue[idx] as string;
    const refunded = refundRecipeCost(state, cancelledRecipeId, registry);
    const queue = order.queue.filter((_, i) => i !== idx);
    return {
      state: { ...refunded, crafts: { ...refunded.crafts, [stationPlacementId]: { ...order, queue } } },
      outcome: {
        action: "cancelCraft",
        ok: true,
        stationPlacementId,
        recipeId: cancelledRecipeId,
        at,
      },
    };
  }

  // target.kind === "active"
  const refunded = refundRecipeCost(state, order.recipeId, registry);
  const crafts: Record<PlacementId, CraftOrder> = { ...refunded.crafts };
  if (order.queue.length > 0) {
    const nextRecipeId = order.queue[0] as string;
    const nextRecipe = registry[nextRecipeId];
    const promotedPipId = workingPipAt(refunded.jobs, stationPlacementId) ?? order.pipId;
    const promotedPip = refunded.pips[promotedPipId];
    const level = promotedPip !== undefined ? pipLevel(promotedPip) : 1;
    const effectiveMs =
      nextRecipe !== undefined
        ? effectiveCraftDurationMs(nextRecipe.durationMs, level, buildingMult, tuning)
        : 0;
    crafts[stationPlacementId] = {
      pipId: promotedPipId,
      recipeId: nextRecipeId,
      startedAt: at,
      effectiveMs,
      queue: order.queue.slice(1),
    };
  } else {
    delete crafts[stationPlacementId];
  }

  return {
    state: { ...refunded, crafts },
    outcome: { action: "cancelCraft", ok: true, stationPlacementId, recipeId: order.recipeId, at },
  };
}

/**
 * Removing a station cancels and refunds EVERYTHING on it (bible §3.4) —
 * the active order and every queued recipe. Called from the `REMOVE_ITEM`
 * reducer arm, alongside `unassignPipFromJob` for the same placement.
 */
export function refundCraftsAtStation<S extends CraftStateSlice>(
  state: S,
  stationPlacementId: PlacementId,
  content: CraftingContent = {},
): S {
  const registry: RecipeRegistryView = content.registry ?? contentRecipes;
  const order = state.crafts[stationPlacementId];
  if (order === undefined) return state;

  let next = refundRecipeCost(state, order.recipeId, registry);
  for (const recipeId of order.queue) {
    next = refundRecipeCost(next, recipeId, registry);
  }
  const crafts = { ...next.crafts };
  delete crafts[stationPlacementId];
  return { ...next, crafts };
}

// ---------------------------------------------------------------------------
// LIVE settlement — the TICK path
// ---------------------------------------------------------------------------

/** One craft completion — WHO, WHERE, WHAT. Plain data, recorded for the
 * caller's XP/counter/UI bookkeeping (the reducer, not this module, owns
 * Keep XP / Pip XP / `counters["crafted.<recipeId>"]`). */
export interface CraftCompletion {
  readonly at: number;
  readonly stationPlacementId: PlacementId;
  readonly pipId: PipId;
  readonly recipeId: string;
  readonly output: RecipeOutput;
}

export interface CraftSettleResult<S extends CraftStateSlice> {
  readonly state: S;
  readonly completions: readonly CraftCompletion[];
}

/**
 * LIVE completion (the TICK path): every station whose active order's
 * `startedAt + effectiveMs` has elapsed by `at` completes — but ONLY
 * while its station is currently staffed (a Pip `AssignedJob` there right
 * now; see module doc for why this mirrors Gathering rather than
 * "the station always finishes regardless"). Completing chains through
 * the queue (a long-idle live session, or the debug time slider, can
 * complete more than one recipe at a station in a single TICK).
 */
export function settleCraftCompletions<S extends CraftStateSlice>(
  state: S,
  at: number,
  content: CraftingContent = {},
): CraftSettleResult<S> {
  const registry: RecipeRegistryView = content.registry ?? contentRecipes;
  const tuning = content.tuning ?? contentTuning.crafting;
  const buildingMult = content.buildingCraftSpeedMultiplier ?? 1;

  let current = state;
  const completions: CraftCompletion[] = [];

  for (const stationPlacementId of Object.keys(state.crafts)) {
    for (;;) {
      const order = current.crafts[stationPlacementId];
      if (order === undefined) break;
      if (order.startedAt + order.effectiveMs > at) break;

      const workingPipId = workingPipAt(current.jobs, stationPlacementId);
      const workingPip = workingPipId !== undefined ? current.pips[workingPipId] : undefined;
      if (workingPip === undefined || workingPip.activity !== PipActivity.AssignedJob) {
        break; // stops crafting from this boundary, same as Gathering
      }

      const recipe = registry[order.recipeId];
      const completedAt = order.startedAt + order.effectiveMs;

      let next = current;
      if (recipe !== undefined) {
        next = grantOutput(next, recipe.output);
        completions.push({
          at: completedAt,
          stationPlacementId,
          pipId: workingPipId as PipId,
          recipeId: order.recipeId,
          output: recipe.output,
        });
      }

      const crafts: Record<PlacementId, CraftOrder> = { ...next.crafts };
      if (order.queue.length > 0) {
        const nextRecipeId = order.queue[0] as string;
        const nextRecipe = registry[nextRecipeId];
        const effectiveMs =
          nextRecipe !== undefined
            ? effectiveCraftDurationMs(nextRecipe.durationMs, pipLevel(workingPip), buildingMult, tuning)
            : 0;
        crafts[stationPlacementId] = {
          pipId: workingPipId as PipId,
          recipeId: nextRecipeId,
          startedAt: completedAt,
          effectiveMs,
          queue: order.queue.slice(1),
        };
      } else {
        delete crafts[stationPlacementId];
      }
      current = { ...next, crafts };
    }
  }

  return { state: current, completions };
}

// ---------------------------------------------------------------------------
// OFFLINE catch-up — the `runCatchup` extraEvents seam
// ---------------------------------------------------------------------------

/** The catch-up state shape the craft collector operates on: `pips` as
 * the engine's array view (per `CatchupState`) + `jobs`/`crafts` +
 * whatever a granted output lands in + the completion record the reducer
 * settles XP/counters from after the pass (mirrors `JobCatchupState`). */
export interface CraftCatchupState extends CatchupState {
  readonly jobs: JobsByPip;
  readonly crafts: CraftsByStation;
  readonly inventory: Readonly<Record<string, number>>;
  readonly keepsakes: Readonly<Record<string, number>>;
  /** Completions that actually fired (station still staffed), in fired
   * order. */
  readonly firedCraftCompletions: readonly CraftCompletion[];
}

/** The slice of tuning the collector reads (the §4.5 rate cap, plus
 * `tuning.crafting` for the speed/queue math). */
export interface CraftCatchupTuning {
  readonly offlineRateCapMs: number;
  readonly crafting: CraftingTuning;
}

/**
 * Catch-up event collector for the `runCatchup` extraEvents seam (spec
 * §4.5 rule 1, bible §3.5): one custom `"craftDone"` event per completion
 * that would occur inside the absence window, CAPPED at the first
 * `offlineRateCapMs` — crafting is a RATE and rates freeze after the cap.
 * See the module doc for the documented chaining simplification.
 */
export function collectCraftCatchupEvents<S extends CraftCatchupState>(
  state: S,
  windowStart: number,
  windowEnd: number,
  tuning: CraftCatchupTuning = contentTuning,
  content: CraftingContent = {},
): CatchupEvent<S>[] {
  const registry: RecipeRegistryView = content.registry ?? contentRecipes;
  const craftingTuning = content.tuning ?? tuning.crafting;
  const buildingMult = content.buildingCraftSpeedMultiplier ?? 1;
  const ratedEnd = Math.min(windowEnd, windowStart + tuning.offlineRateCapMs);

  const events: CatchupEvent<S>[] = [];

  for (const [stationPlacementId, order] of Object.entries(state.crafts)) {
    const workingPipId = workingPipAt(state.jobs, stationPlacementId);
    const workingPip =
      workingPipId !== undefined ? state.pips.find((p) => p.id === workingPipId) : undefined;
    const level = workingPip !== undefined ? pipLevel(workingPip) : 1;

    let recipeId = order.recipeId;
    let completesAt = order.startedAt + order.effectiveMs;
    let queue = order.queue;

    while (completesAt <= ratedEnd) {
      if (completesAt > windowStart) {
        const at = completesAt;
        const firingRecipeId = recipeId;
        const firingQueue = queue;
        events.push({
          kind: "custom",
          at,
          tag: CRAFT_TICK_TAG,
          ...(workingPipId !== undefined ? { pipId: workingPipId } : {}),
          apply: (s: S): S => {
            const currentOrder = s.crafts[stationPlacementId];
            if (currentOrder === undefined || currentOrder.recipeId !== firingRecipeId) return s;
            const pipId = workingPipAt(s.jobs, stationPlacementId);
            if (pipId === undefined) return s; // unstaffed — frozen, see module doc
            const pip = s.pips.find((p) => p.id === pipId);
            if (pip === undefined || pip.activity !== PipActivity.AssignedJob) return s; // frozen

            const recipe = registry[firingRecipeId];
            let next: S = s;
            if (recipe !== undefined) next = grantOutput(next, recipe.output);

            const crafts: Record<PlacementId, CraftOrder> = { ...next.crafts };
            if (firingQueue.length > 0) {
              const nextRecipeId = firingQueue[0] as string;
              const nextRecipe = registry[nextRecipeId];
              const effectiveMs =
                nextRecipe !== undefined
                  ? effectiveCraftDurationMs(nextRecipe.durationMs, pipLevel(pip), buildingMult, craftingTuning)
                  : 0;
              crafts[stationPlacementId] = {
                pipId,
                recipeId: nextRecipeId,
                startedAt: at,
                effectiveMs,
                queue: firingQueue.slice(1),
              };
            } else {
              delete crafts[stationPlacementId];
            }

            if (recipe === undefined) return { ...next, crafts };
            return {
              ...next,
              crafts,
              firedCraftCompletions: [
                ...next.firedCraftCompletions,
                { at, stationPlacementId, pipId, recipeId: firingRecipeId, output: recipe.output },
              ],
            };
          },
        });
      }

      if (queue.length === 0) break;
      const nextRecipeId = queue[0] as string;
      const nextRecipe = registry[nextRecipeId];
      if (nextRecipe === undefined) break;
      const effectiveMs = effectiveCraftDurationMs(nextRecipe.durationMs, level, buildingMult, craftingTuning);
      recipeId = nextRecipeId;
      queue = queue.slice(1);
      completesAt = completesAt + effectiveMs;
    }
  }

  return events;
}

/**
 * After a catch-up pass that hit the rate cap: slide every surviving
 * station's ACTIVE order's `startedAt` past the rate-frozen tail
 * (`cappedMs` = elapsed − rated) — without this, the first live TICK
 * would "backfill" a long absence's worth of crafting in one burst,
 * dodging the cap (mirrors `shiftJobsPastFreeze` exactly).
 */
export function shiftCraftsPastFreeze(crafts: CraftsByStation, cappedMs: number): CraftsByStation {
  if (cappedMs <= 0 || Object.keys(crafts).length === 0) return crafts;
  const next: Record<PlacementId, CraftOrder> = {};
  for (const [stationPlacementId, order] of Object.entries(crafts)) {
    next[stationPlacementId] = { ...order, startedAt: order.startedAt + cappedMs };
  }
  return next;
}
