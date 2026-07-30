/**
 * GameState + the root reducer (spec §1 "State", §2 rule 4).
 *
 * One-way flow: the UI dispatches actions through core/store.ts; this
 * reducer is the only thing that produces new GameState. Purity rules
 * (spec §2): time enters ONLY as the `at`/`savedAt`/`now` timestamps on
 * action payloads (the Clock lives with the caller); randomness ONLY via
 * seeded streams whose cursors live in `state.rngState` (spec §2 rule 3
 * — a save reload never re-rolls or skips an outcome).
 *
 * Save shape awareness (spec §8): the persisted save is
 * `{ schemaVersion, seed, savedAt, state: GameState }` — everything in
 * GameState is plain serializable data (no functions, no class
 * instances, no Infinity/NaN), including the rng cursors.
 *
 * Actions (spec §5, §4.5):
 * - TICK {at} — live-loop needs advance for the time since `lastTickAt`,
 *   then the automatic evaluators (Sulking entry/exit, Rest auto-wake,
 *   life stage, evolution readiness). Live ticks are frequent, so no
 *   intra-tick segmentation — long absences go through CATCHUP.
 * - SET_ACTIVE_PIP {pipId} — top-bar selector (spec §10): repoint
 *   `activePipId`. Pure selection; unknown ids no-op.
 * - FEED / CLEAN / PLAY / PET / REST_TOGGLE / GIVE_ITEM — delegate to
 *   pips/care.ts `performCare`; the resulting `CareOutcome` (stat change,
 *   dialogue line, refusal) is stored in `lastCareOutcome` for the UI to
 *   animate from (reducers can't return values — this field is the seam).
 * - CATCHUP {savedAt, now} — delegates to pips/catchup.ts `runCatchup`
 *   (the §4.5 segmented pass with the 12h rate cap); the CatchupSummary
 *   lands in `lastCatchup` for the "While you were away…" sheet. Egg
 *   incubation completions register through the engine's custom-event
 *   seam (eggs never obey the rate cap — timers are not capped);
 *   expedition returns that fired during the pass roll their loot AFTER
 *   the pass in summary-event order, which IS chronological across all
 *   pips — the `"expedition-loot"` cursor advances in true return order
 *   (spec §2 rule 3 determinism).
 * - ASSIGN_EXPEDITION / ACKNOWLEDGE_REVEAL / HATCH_EGG — Phase 4 (spec
 *   §6.1/§7): delegate to core/expeditions and core/eggs; outcomes park
 *   in `lastAssignOutcome`/`lastHatchOutcome` for the UI, and the
 *   loot-reveal queue (`pendingReveals`) gates all loot/egg intake on
 *   the player's acknowledge tap.
 * - PLACE_ITEM / MOVE_ITEM / REMOVE_ITEM — Phase 5 (spec §9): delegate
 *   to core/keep placement (typed refusals in core; a refused placement
 *   returns the state unchanged — the UI pre-validates with the same
 *   pure functions, so the reducer needs no placement echo field).
 *   PLACE_ITEM also BUYS the item (spec §6.3): all-or-nothing spend of
 *   its content cost, refused-as-unchanged when short. MOVE is free;
 *   REMOVE_ITEM refunds the full cost (no stored-items inventory in
 *   MVP, so "tuck away" returns the materials instead) and unassigns
 *   any pip working at the removed station.
 * - PURCHASE_KEEP_LEVEL / PURCHASE_ROSTER_UPGRADE — Phase 5 (spec §6.3/
 *   §7.4/§9): exact resource-bundle deduction via core/economy `spend`;
 *   refusals (nothing to buy, prerequisite level, can't afford) return
 *   the state unchanged by reference.
 * - ASSIGN_JOB / UNASSIGN_JOB — Phase 5 (spec §6.2): delegate to
 *   core/keep/jobs; outcomes park in `lastJobOutcome`. Production is
 *   timestamp-derived and rolled inside TICK/CATCHUP.
 * - EVOLVE_PIP — Phase 5 (spec §4.6): the player's tap on a glowing
 *   pip. Delegates to lifecycle's `applyEvolution`, whose ONLY call
 *   site is this arm — TICK/CATCHUP set `readyToEvolve` but NEVER
 *   evolve. Outcome parks in `lastEvolveOutcome`.
 * - DEBUG_GRANT / DEBUG_SPAWN_EGG / LOAD_SAVE — the debug menu's seams
 *   (spec §14): additive item/resource grants, an instantly-incubating
 *   QA egg, and wholesale replacement with a migrated, validated save
 *   (import). All pure; all plain data in, data out.
 */

import { HOUR_MS, tuning as contentTuning } from "../content/tuning";
import { PERSONALITY_IDS } from "../content/personalities";
import { species as contentSpecies } from "../content/species";
import { foods as contentFoods } from "../content/foods";
import { ROSTER_FULL_MESSAGE, rosterFullMaxMessage } from "../content/eggs";
import { keepLevels as contentKeepLevels, keepUpgrades, ROSTER_UPGRADE_ID } from "../content/keep";
import { placeables as contentPlaceables } from "../content/placeables";
import { decorations as contentDecorations } from "../content/decorations";
import { createRng, createRngFromState } from "./rng";
import type { RngStream } from "./rng";
import { LifeStage, PipActivity } from "./pips/types";
import type { PipId, PipNeeds, PipState, TraitGenome } from "./pips/types";
import { applyNeedsDelta } from "./pips/needs";
import {
  arriveHome,
  evaluateRestAutoWake,
  evaluateSulk,
} from "./pips/machine";
import {
  applyEvolution,
  updateEvolutionReadiness,
  updateLifeStage,
} from "./pips/lifecycle";
import type {
  EvolveRefusalReason,
  SpeciesEvolutionRegistry,
} from "./pips/lifecycle";
import { runCatchup } from "./pips/catchup";
import type { CatchupSummary } from "./pips/catchup";
import { performCare } from "./pips/care";
import type { CareAction, CareOutcome, CooldownsByPip } from "./pips/care";
import type { LastLineIndexByPip } from "./pips/dialogue";
import { createPipFromGenome, rollGenome } from "./pips/genome";
import type { GenomeSpeciesEntry, GenomeSpeciesRegistry } from "./pips/genome";
// ROUND 2B (content bible §3.6, orchestrator ruling #1 — biome-themed egg
// pools): a value import of content/expeditions, same established pattern
// as contentSpecies/contentFoods/contentPlaceables/contentDecorations
// above — core/state.ts already treats content registries as the single
// source of truth for ids (spec §2 rule 5 keeps the *logic* pure; the data
// is allowed to be content). Type-only on content/expeditions' own side
// (SpeciesId, KeepLevel) keeps this a one-way import, no cycle.
import { expeditions as contentExpeditions } from "../content/expeditions";
import {
  EGG_STREAM,
  EggState,
  beginIncubation,
  collectEggCatchupEvents,
  createEgg,
  settleDueEggs,
} from "./eggs";
import type { Egg, EggCatchupState, HatchOutcome } from "./eggs";
import {
  assignExpedition,
  processDueExpeditionReturns,
  settleExpeditionReturn,
} from "./expeditions";
import type { AssignExpeditionOutcome, PendingReveal } from "./expeditions";
import { createKeep, moveItem, placeItem, removeItem } from "./keep";
import type { KeepState, PlacementId } from "./keep";
// ROUND 2F — BUILDING EFFECTS (docs/progression-bible.md §3): placements →
// ONE aggregated, already-capped value; the wiring below is what makes
// that value actually apply (needs decay, rest speed, expedition duration/
// loot/egg-chance, incubation speed) rather than becoming another dead
// feature (ruling #5). Aggregation itself lives entirely in
// `core/keep/effects.ts` — this file only computes it once per dispatch
// (placements don't change mid-dispatch) and threads the result to the
// pure modules that consult it.
import { keepComfortMultipliers, resolveKeepEffects } from "./keep/effects";
import type { ResolvedKeepEffects } from "./keep/effects";
import { IDENTITY_KEEP_COMFORT } from "./pips/needs";
import type { KeepComfortEffect } from "./pips/needs";
import {
  assignPipToJob,
  collectJobCatchupEvents,
  processJobProduction,
  reconcileJobs,
  settleJobTicks,
  shiftJobsPastFreeze,
  unassignPipFromJob,
} from "./keep/jobs";
import type { JobCatchupState, JobOutcome, JobsByPip, JobTick } from "./keep/jobs";
import { spend } from "./economy";
import type { ResourceBundle } from "./economy";
// ROUND 2C — RETENTION (docs/retention-bible.md §1/§2, orchestrator
// ruling: build the Album + the Long Meadow so a 14-form collection is
// reachable without ever deleting a Pip, content-bible §9 risk 7).
import {
  createEmptyPipdex,
  markCaught as markPipdexCaught,
  markSeen as markPipdexSeen,
  markVariantCaught as markPipdexVariantCaught,
} from "./pipdex";
import type { PipdexPortrait, PipdexState } from "./pipdex";
import {
  createEmptySanctuary,
  retirePip as retireToSanctuary,
  retrievePip as retrieveFromSanctuary,
} from "./sanctuary";
import type { SanctuaryOutcome, SanctuaryState } from "./sanctuary";
// ROUND 2C — PROGRESSION (docs/retention-bible.md, the streak/milestone/
// bounty/mastery/pity/event/multiplier stack). Every module below is
// content-injectable and pure, per the established core/ pattern; this
// file is where they're composed against the real GameState.
import { canAfford } from "./economy";
import {
  createEmptyStreak,
  dayIndex as streakDayIndex,
  effectiveStreakTier,
  pickKeepsakeOffers,
  resolveLadderReward,
  streakLootBonus,
  touchVisit,
} from "./progression/streak";
import type { StreakChoice, StreakState } from "./progression/streak";
import {
  claimMilestone,
  createEmptyMilestones,
  detectNewlyEarnable,
  grantFounderMilestone,
} from "./progression/milestones";
import type { MilestoneMetricContext, MilestoneState } from "./progression/milestones";
import {
  applyBountyEvent,
  createEmptyBounties,
  ensureBountiesForDay,
  replaceStaleBounties,
  rerollBountySlot,
} from "./progression/bounties";
import type {
  BountiesState,
  BountyContext,
  BountyProgressEvent,
} from "./progression/bounties";
import {
  incrementMasteryTrips,
  masteryBonusRollChance,
  masteryEggChanceBonusPoints,
  masteryTier,
} from "./progression/mastery";
import {
  guaranteedDrawPool,
  isPityGuaranteed,
  pityThresholdFor,
  rarestTierInPool,
  updatePityCounter,
} from "./progression/pity";
import type { PitySpeciesEntry } from "./progression/pity";
import {
  applyEggChanceBonus,
  effectiveEggChanceBonusPoints,
  effectiveLootBonusChance,
} from "./progression/multipliers";
import {
  activeEventEggChanceBonusPoints,
  activeEventLootBonusChance,
  eventAdjustedPityThreshold,
} from "./progression/events";
import { BOUNTY_TEMPLATES as contentBountyTemplates } from "../content/bountyTemplates";
import { MILESTONES as contentMilestones } from "../content/milestones";
// ROUND 2F — THE PROGRESSION SPINE (docs/progression-bible.md §0/§1): Keep
// XP, ONE spine, applied in ONE place (`applyKeepXpForAction` below,
// mirroring 2C's `touchProgressionVisit` wrapper). `xp.ts` is the pure
// per-source calculator; this file composes it against the real
// GameState/GameAction — same division of labour as every 2C module.
import {
  albumXpFromDeltas,
  bountyCompleteXp,
  bountyDayClearXp,
  careActionXp,
  evolveXp,
  expeditionSendXp,
  firstBuildXp,
  firstJobXp,
  hatchXp,
  isNextTierXpReady,
  jobTickXp,
  masteryTierXp as masteryTierXpAward,
  renownLevelFor,
  revealXp,
  rosterUpgradeXp,
  sanctuaryFirstArrivalXp,
  streakDayXp,
} from "./progression/xp";
// RENOWN FLAIR (bible §1.7) — content, read only for the id list; the level
// arithmetic is `core/progression/xp.ts`'s.
import { renownFlairEarnedBetween } from "../content/flair";
import { jobs as contentJobs } from "../content/jobs";

/** Genesis stream (starter rolls at createNewGame). Its cursor persists
 * in `rngState` like every other stream (spec §2 rule 3). */
export const GENESIS_STREAM = "genesis";

/** Content-defined cost of every placeable item (placeables ∪
 * decorations — the same merged view core/keep uses for footprints,
 * spec §6.3: resources are the currency, item `cost` is a bundle).
 * PLACE_ITEM charges it; REMOVE_ITEM refunds it in full ("tuck away"
 * never destroys value — there is no stored-items inventory in MVP). */
const PLACEMENT_ITEM_COSTS: Readonly<Record<string, ResourceBundle>> = (() => {
  const costs: Record<string, ResourceBundle> = {};
  for (const def of contentPlaceables) costs[def.id] = def.cost;
  for (const def of contentDecorations) costs[def.id] = def.cost;
  return costs;
})();

/**
 * The whole game, as one plain serializable object (spec §8).
 *
 * `pips` is keyed by id for O(1) reducer access; `rosterOrder` carries
 * the stable display/iteration order (spec §7.4 roster).
 */
export interface GameState {
  readonly pips: Readonly<Record<PipId, PipState>>;
  readonly rosterOrder: readonly PipId[];
  /** The pip the top bar / focus view is showing (spec §10). */
  readonly activePipId: PipId;
  /** Feedable/giftable items by id (foods are loot, spec §6.3). */
  readonly inventory: Readonly<Record<string, number>>;
  /** Resource counts — resources ARE the currency (spec §6.3). */
  readonly resources: Readonly<Record<string, number>>;
  /** Cursor of every touched rng stream (spec §2 rule 3 / §8). */
  readonly rngState: Readonly<Record<string, number>>;
  readonly seed: number;
  /** The Keep (spec §9): level (1 = start, 2 unlocks Forest + plot, 3
   * unlocks Shore + roster upgrade) and every placed item. */
  readonly keep: KeepState;
  /** Standing Gathering jobs by working pip (spec §6.2). Invariant kept
   * by construction + reconcileJobs: an entry exists iff its pip is in
   * AssignedJob at a still-placed station. */
  readonly jobs: JobsByPip;
  /** Spec §7.4: the Keep upgrade that raises the roster cap 3 → 5.
   * Purchasable at Keep level 3 via PURCHASE_ROSTER_UPGRADE. */
  readonly rosterUpgradePurchased: boolean;
  /** Eggs in the Keep (Incubating/Pipping — spec §7.2). Found eggs live
   * inside `pendingReveals` until acknowledged; hatched eggs are
   * removed. Eggs NEVER expire (spec §7.4). */
  readonly eggs: readonly Egg[];
  /** Completed trips awaiting their loot-reveal moment (spec §6.1).
   * ACKNOWLEDGE_REVEAL consumes the head — nothing enters inventory,
   * resources, or `eggs` until the player has seen it. */
  readonly pendingReveals: readonly PendingReveal[];
  /** Deterministic id counters (`pip-<n>` / `egg-<n>` / `place-<n>`). */
  readonly nextPipNumber: number;
  readonly nextEggNumber: number;
  readonly nextPlacementNumber: number;
  /** Per pip, per care action: last-used `at` (Clean 60s / Pet 30s, §5). */
  readonly cooldowns: CooldownsByPip;
  /** Per pip, per dialogue context: last line index said (the
   * no-immediate-repeat memory of pickDialogueLine, spec §3). */
  readonly lastLineIndex: LastLineIndexByPip;
  readonly createdAt: number;
  /** Timestamp of the last TICK/CATCHUP needs advance. Kept in lockstep
   * with every pip's `needsUpdatedAt` by construction. */
  readonly lastTickAt: number;
  /** Outcome of the most recent care action — the UI animates from this
   * (stat change, dialogue line, refusal). Null until the first action. */
  readonly lastCareOutcome: CareOutcome | null;
  /** Summary of the most recent CATCHUP — data source for the "While you
   * were away…" sheet (spec §4.5). */
  readonly lastCatchup: CatchupSummary | null;
  /** Outcome of the most recent ASSIGN_EXPEDITION (send-off animation or
   * refusal dialogue). Null until the first assignment. */
  readonly lastAssignOutcome: AssignExpeditionOutcome | null;
  /** Outcome of the most recent HATCH_EGG (hatch moment, or the friendly
   * roster-full message — spec §7.4). Null until the first attempt. */
  readonly lastHatchOutcome: HatchOutcome | null;
  /** Outcome of the most recent ASSIGN_JOB / UNASSIGN_JOB (send-to-work
   * moment or refusal dialogue — spec §6.2). Null until the first. */
  readonly lastJobOutcome: JobOutcome | null;
  /** Outcome of the most recent EVOLVE_PIP (the witnessed evolution
   * moment — spec §4.6). Null until the first attempt. */
  readonly lastEvolveOutcome: EvolveOutcome | null;
  /** Guided-onboarding progress (spec §10/§10.1). Fresh games start at
   * step "feed"; migrated saves arrive completed. */
  readonly onboarding: OnboardingState;
  /** ROUND 2C — the Album (docs/retention-bible.md §1): seen/caught
   * record, forever additive (spec §4.4's "never punish" guardrail —
   * nothing in this round ever clears an entry). Migrated saves derive
   * it from every Pip already owned (§11.3) so a veteran never loses
   * credit. */
  readonly pipdex: PipdexState;
  /** ROUND 2C — the Long Meadow (docs/retention-bible.md §2): retired
   * Pips, UNLIMITED capacity, permanently (a cap would recreate the
   * delete-a-Pip problem it exists to solve — content-bible §9 risk 7).
   * Residents are excluded from TICK/CATCHUP's per-pip pass by
   * construction (they simply aren't in `pips`/`rosterOrder`) — that
   * exclusion IS the freeze (§2.4), not a stored flag. */
  readonly sanctuary: SanctuaryState;
  /** Outcome of the most recent RETIRE_PIP / RETRIEVE_PIP (send-off or
   * homecoming moment, or a friendly refusal) — parked like every other
   * `last*Outcome` echo. Null until the first attempt. */
  readonly lastSanctuaryOutcome: SanctuaryOutcome | null;
  /** ROUND 2C — the daily streak (docs/retention-bible.md §3). A broken
   * streak may cost only `current`'s bonus TIER — `longest`,
   * `totalVisitDays` and `rainDays` are forward-only (spec §4.4's
   * guardrail, restated for this round). */
  readonly streak: StreakState;
  /** ROUND 2C — the day-boundary offset streak/bounty day-indexing reads
   * (bible §3.1): sets the LOCAL 04:00 boundary. Set at boot by
   * `SET_DAY_OFFSET` (the app layer owns `Date`, spec §2 rule 2); `0`
   * until then behaves like a UTC-midnight boundary — harmless, since a
   * boundary shift can only ever gift a streak day, never take one. */
  readonly dayOffsetMs: number;
  /** ROUND 2C — forward-only counter bag milestones read
   * (bible §4.1). Every entry only ever increases. */
  readonly counters: Readonly<Record<string, number>>;
  /** ROUND 2C — milestones earned + awaiting celebration (bible §4). */
  readonly milestones: MilestoneState;
  /** ROUND 2C — today's three bounties, level-aware and lazily
   * regenerated (bible §5). */
  readonly bounties: BountiesState;
  /** ROUND 2C — visible, per-biome egg-pity counters (bible §7): misses
   * since that biome's last rarest-tier hatch. Absent key ≡ 0. Never
   * resets on absence — only ever by paying out. */
  readonly eggPity: Readonly<Record<string, number>>;
  /** ROUND 2C — ids of the events currently active (bible §8.3), set by
   * the app layer's `SET_ACTIVE_EVENTS` (core never asks what day it is).
   * A stale list can only ever have granted a bonus, never taken one. */
  readonly activeEvents: readonly string[];
  /** ROUND 2C — granted-but-unplaced decorations (bible §11.2): a
   * streak/milestone keepsake reward lands here, re-placeable for FREE
   * (never refunded on removal — `REMOVE_ITEM` returns a granted
   * placement here instead of refunding resources, closing the
   * free-decoration resource-printer exploit). Keyed by decoration id. */
  readonly keepsakes: Readonly<Record<string, number>>;
  /** ROUND 2C — earned FLAIR (bible §4.3): `flairId → earnedAt`. Pure
   * decoration — the Album's cover stamps and page frame, the Long Meadow's
   * gate signs, a Pip's title (`content/flair.ts` says where each one
   * draws). Grants nothing, costs the economy nothing, and is FORWARD-ONLY:
   * nothing in the game removes a flourish, so a break can never take one
   * (bible §0.1). Absent key ≡ not earned. */
  readonly flair: Readonly<Record<string, number>>;
  /** ROUND 2F — THE PROGRESSION SPINE (docs/progression-bible.md §0.1/§1):
   * lifetime Keep XP, forward-only, integer. ONE spine belonging to the
   * KEEP, never to a Pip — every meaningful action feeds it (see
   * `applyKeepXpForAction`), so no session is wasted and retiring a Pip
   * never costs progress. Current tier remains `keep.level` (unchanged,
   * still the single source of truth for every gate); this field only
   * says how close the NEXT tier is
   * (`tuning.progression.levelXp`) and paces — never gates alone — every
   * `PURCHASE_KEEP_LEVEL`. Never decreases; nothing in this round spends,
   * decays, or resets it (bible §0.3). */
  readonly keepXp: number;
  /** ROUND 2F — the player-witnessed Keep-tier-up moment (progression
   * bible §1.2/§6.3), parked like every other `last*Outcome` echo: a tier
   * only ever lands on a player's own `PURCHASE_KEEP_LEVEL` tap (never
   * while away), so the UI's celebration banner has something to animate
   * from. Null until the first purchase. */
  readonly lastLevelUp: LevelUpOutcome | null;
}

/** What one successful `PURCHASE_KEEP_LEVEL` did — the UI's tier-up
 * banner data source (parked in `state.lastLevelUp`, like every other
 * `last*Outcome`). Refusals (max level, XP not ready, can't afford) leave
 * the state unchanged BY REFERENCE (module doc / spec §9's established
 * refusal contract) and so never touch this field — there is nothing to
 * celebrate about a tap that did nothing. */
export interface LevelUpOutcome {
  readonly at: number;
  readonly fromLevel: number;
  readonly toLevel: number;
}

/** What one EVOLVE_PIP request did — the UI's evolution-moment data
 * source (parked in `state.lastEvolveOutcome`, like hatch outcomes). */
export type EvolveOutcome =
  | {
      readonly ok: true;
      readonly pipId: PipId;
      readonly at: number;
      readonly fromSpeciesId: string;
      readonly toSpeciesId: string;
      readonly variantId: string;
    }
  | {
      readonly ok: false;
      readonly pipId: PipId;
      readonly at: number;
      readonly reason: "unknownPip" | EvolveRefusalReason;
    };

export type GameAction =
  | { readonly type: "TICK"; readonly at: number }
  /** Top-bar selector tap (spec §10): point the top bar / focus view /
   * Keep camera at another roster pip. Pure selection — no time, no
   * randomness; an unknown pipId is a no-op (stale UI, not an error). */
  | { readonly type: "SET_ACTIVE_PIP"; readonly pipId: PipId }
  | { readonly type: "FEED"; readonly pipId: PipId; readonly foodId: string; readonly at: number }
  | { readonly type: "CLEAN"; readonly pipId: PipId; readonly at: number }
  | { readonly type: "PLAY"; readonly pipId: PipId; readonly at: number }
  | { readonly type: "PET"; readonly pipId: PipId; readonly at: number }
  | { readonly type: "REST_TOGGLE"; readonly pipId: PipId; readonly at: number }
  | { readonly type: "GIVE_ITEM"; readonly pipId: PipId; readonly itemId: string; readonly at: number }
  /** Send a pip on an expedition (spec §6.1). Legality (unlock, one pip
   * per expedition, machine refusals) lives in core/expeditions. */
  | {
      readonly type: "ASSIGN_EXPEDITION";
      readonly pipId: PipId;
      readonly expeditionId: string;
      readonly at: number;
    }
  /** Player closes the loot-reveal modal: the queue HEAD's items land in
   * inventory/resources, its egg starts incubating, and a still-Returning
   * pip arrives home (spec §6.1 reveal moment). No-op on an empty queue. */
  | { readonly type: "ACKNOWLEDGE_REVEAL"; readonly at: number }
  /** Player taps a Pipping egg (spec §7.2 — hatching is always
   * player-witnessed). Refused with a friendly message at the roster cap
   * (spec §7.4); the egg never expires. */
  | { readonly type: "HATCH_EGG"; readonly eggId: string; readonly at: number }
  | { readonly type: "CATCHUP"; readonly savedAt: number; readonly now: number }
  /** Place a new item on the Keep grid (spec §9 tap-to-place). The id is
   * minted from `nextPlacementNumber`. A refused placement (bounds,
   * collision, unknown item) returns the state unchanged — the UI
   * pre-validates with core/keep's pure placeItem. No time, no rng. */
  | {
      readonly type: "PLACE_ITEM";
      readonly itemId: string;
      readonly x: number;
      readonly y: number;
      readonly at: number;
    }
  /** Move an existing placement (spec §9). Same refusal contract. */
  | {
      readonly type: "MOVE_ITEM";
      readonly placementId: PlacementId;
      readonly x: number;
      readonly y: number;
      readonly at: number;
    }
  /** Remove a placement (spec §9). A pip working at the removed station
   * is unassigned back to Idle (its job cannot outlive the station). */
  | { readonly type: "REMOVE_ITEM"; readonly placementId: PlacementId; readonly at: number }
  /** Buy the NEXT Keep level (spec §6.3/§9): exact bundle deduction of
   * the content-defined cost. Refused (state unchanged) at max level or
   * when short. Level 2 unlocks Forest + the extra plot; level 3
   * unlocks Shore + makes the roster upgrade purchasable. */
  | { readonly type: "PURCHASE_KEEP_LEVEL"; readonly at: number }
  /** Buy the roster upgrade (spec §7.4): cap 3 → 5. Requires Keep level
   * 3 (content prerequisite), not already owned, and the content cost. */
  | { readonly type: "PURCHASE_ROSTER_UPGRADE"; readonly at: number }
  /** Put a pip to work at a placed Gathering Station (spec §6.2). */
  | {
      readonly type: "ASSIGN_JOB";
      readonly pipId: PipId;
      readonly stationPlacementId: PlacementId;
      readonly at: number;
    }
  /** Return a working pip to Idle (spec §6.2: jobs never end on their
   * own). */
  | { readonly type: "UNASSIGN_JOB"; readonly pipId: PipId; readonly at: number }
  /** The player taps a glowing pip (spec §4.6): apply its evolution.
   * Legal ONLY when `readyToEvolve` — this action is the sole caller of
   * applyEvolution; TICK/CATCHUP never evolve. */
  | { readonly type: "EVOLVE_PIP"; readonly pipId: PipId; readonly at: number }
  /** Debug-menu grant (spec §14, dev builds only): additively merges item
   * and resource counts. Pure like everything else — the "debug" prefix
   * marks intent (QA seeding), not impurity. */
  | {
      readonly type: "DEBUG_GRANT";
      readonly items?: Readonly<Record<string, number>>;
      readonly resources?: Readonly<Record<string, number>>;
    }
  /** Advance the guided onboarding (spec §10.1): forward-only along
   * ONBOARDING_STEPS — a stale or backwards step is a no-op, so replays
   * and double-taps can never resurrect a finished tutorial. Skipping is
   * this same action jumping straight to "done" (spec §10 skippable). */
  | { readonly type: "ONBOARDING_ADVANCE"; readonly step: OnboardingStep }
  /** Debug-menu egg spawn (spec §14, dev builds only): drops an egg
   * straight into the Keep, already Incubating at `at` — pair with the
   * time-skip buttons to QA the full Pipping → hatch flow. Pure. */
  | { readonly type: "DEBUG_SPAWN_EGG"; readonly at: number }
  /** Wholesale state replacement from a validated save (debug-menu import,
   * spec §8/§14). `state` MUST come out of `migrate()` — the reducer
   * trusts it. Transient UI echoes are nulled so the swap does not replay
   * a stale care animation; callers follow up with CATCHUP over
   * `savedAt → now`, exactly like boot. */
  | { readonly type: "LOAD_SAVE"; readonly state: GameState }
  /** ROUND 2C — "Send to the Long Meadow" (docs/retention-bible.md §2.3).
   * Legal from Idle/Resting/Sulking/AssignedJob (a working pip is
   * auto-unassigned first, mirroring REMOVE_ITEM); refused for
   * OnExpedition/Returning (loot in flight) and the last active Pip. */
  | { readonly type: "RETIRE_PIP"; readonly pipId: PipId; readonly at: number }
  /** ROUND 2C — "Ask them home" (docs/retention-bible.md §2.5). Free,
   * gated only by `minStayMs` (a settling-in period, not a countdown) and
   * the roster cap (refused warmly, never a wall). */
  | { readonly type: "RETRIEVE_PIP"; readonly pipId: PipId; readonly at: number }
  /** ROUND 2C — the app layer's daily recomputation of the streak/bounty
   * day-boundary offset (bible §3.1), via `core/clock.ts`'s
   * `localDayOffsetMs`. Dispatched at boot and on `visibilitychange`; a
   * DST/travel shift this produces can only ever gift a streak day, never
   * take one (the `delta <= 0` no-op in `progression/streak.ts`). */
  | { readonly type: "SET_DAY_OFFSET"; readonly offsetMs: number }
  /** ROUND 2C — the app layer's resolved set of currently-active seasonal
   * events (bible §8.3), via `core/progression/events.ts`'s
   * `resolveActiveEvents` over a `monthDayFromMs`-derived date. Core never
   * asks what day it is; a stale list can only ever grant a bonus, never
   * take one. */
  | { readonly type: "SET_ACTIVE_EVENTS"; readonly ids: readonly string[] }
  /** ROUND 2C — grant a milestone's reward (bible §4). Idempotent:
   * claiming an already-earned id is a no-op (no double-grant, tested). */
  | { readonly type: "CLAIM_MILESTONE"; readonly id: string; readonly at: number }
  /** ROUND 2C — the free daily bounty reroll (bible §5.4). Refused
   * (state unchanged) once the free-reroll budget is spent. */
  | { readonly type: "REROLL_BOUNTY"; readonly slot: number; readonly at: number }
  /** ROUND 2C — lazily (re)generate today's bounty trio (bible §5.1).
   * EXPLICIT rather than fired automatically from every care action (an
   * integration-safety boundary — see `touchProgressionVisit`'s doc
   * comment): the app layer dispatches this once per session/day-change,
   * same spirit as `SET_DAY_OFFSET`/`SET_ACTIVE_EVENTS`. Idempotent for
   * the same day (state unchanged by reference when already current). */
  | { readonly type: "REFRESH_BOUNTIES"; readonly at: number }
  /** ROUND 2C — bank the current streak day's ladder reward (bible §3.3):
   * a plain grant auto-applies immediately; a choice day (5/7) parks a
   * `StreakChoice` in `pendingChoices` for `RESOLVE_STREAK_CHOICE`.
   * EXPLICIT rather than automatic (see `touchProgressionVisit`'s doc
   * comment) — idempotent via `rewardedForDay`, so dispatching it more
   * than once for the same streak day is a no-op. */
  | { readonly type: "CLAIM_STREAK_REWARD"; readonly at: number }
  /** ROUND 2C — resolve a WAITING streak/bounty choice reward (the day-5
   * keepsake pick, the day-7 or bounty-day-clear egg pick, bible §3.3/
   * §5.6). `forDay`+`kind` together identify the specific pending choice
   * (idempotent — resolving an already-gone choice is a no-op). */
  | {
      readonly type: "RESOLVE_STREAK_CHOICE";
      readonly kind: StreakChoice["kind"];
      readonly forDay: number;
      readonly choiceIndex: number;
      readonly at: number;
    };

/**
 * Starter hunger (spec §10.1: "Hunger bar is visibly at ~60" so the
 * guided first Feed lands). An onboarding-structural value, not a
 * balancing tunable — it exists to make step 3 of the first 90 seconds
 * work, which is why it lives here and not in content/tuning.ts.
 */
export const STARTER_HUNGER = 60;

/**
 * Onboarding progress (spec §10/§10.1): the guided first-90-seconds
 * beats, persisted so a mid-onboarding reload resumes where it left off.
 * Steps advance forward only (ONBOARDING_ADVANCE below); "done" is
 * terminal and `completed` is true iff the step is "done". The starter
 * PICK is not a step — a save cannot exist without a pip, so state
 * always starts at "feed" (the pick happens before createNewGame).
 */
export const ONBOARDING_STEPS = ["feed", "explore", "done"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface OnboardingState {
  /** True once onboarding finished (guided or skipped). Existing saves
   * migrate to true — only fresh games ever see the guided beats. */
  readonly completed: boolean;
  readonly step: OnboardingStep;
}

/** Everything createNewGame reads from content, injectable for tests.
 * Defaults: the mosspip species entry + the five personalities. */
export interface StarterContent {
  readonly speciesId: string;
  readonly palettes: readonly string[];
  readonly patterns: readonly string[];
  readonly accessorySlots: number;
  readonly personalityIds: readonly string[];
  readonly startingInventory: Readonly<Record<string, number>>;
}

/** Starter species (spec §10.1 — the onboarding starter is a Mosspip). */
const STARTER_SPECIES_ID = "mosspip";

function defaultStarterContent(): StarterContent {
  const starter = contentSpecies[STARTER_SPECIES_ID];
  if (starter === undefined) {
    throw new Error(
      `createNewGame: starter species "${STARTER_SPECIES_ID}" missing from the species registry`,
    );
  }
  return {
    speciesId: starter.id,
    palettes: starter.sprite.palettes,
    patterns: starter.sprite.patterns,
    accessorySlots: starter.sprite.accessorySlots,
    personalityIds: PERSONALITY_IDS,
    startingInventory: contentTuning.startingInventory,
  };
}

/** How many starter Pips the onboarding offers (spec §7.1: three). */
export const STARTER_CANDIDATE_COUNT = 3;

/**
 * ROUND 2B — biome-themed egg pools (content bible §3.6, orchestrator
 * ruling #1). An egg's species pool comes from the expedition biome it
 * was found in (`egg.sourceExpeditionId`), not the whole registry.
 *
 * RNG CURSOR CONTRACT (spec §2 rule 3 — hard constraint on this patch):
 * `rollGenome` (core/pips/genome.ts) always consumes EXACTLY 5 rolls from
 * the stream it is handed — species/palette/pattern/personality/shiny —
 * regardless of how many entries are in the registry it rolls against
 * (`pickSpecies` does one weighted draw over `Object.values(registry)`,
 * one `stream.next()` call either way). So narrowing the registry here
 * never changes how many rolls a hatch consumes; a fixed seed advances
 * the cursor identically whichever pool an egg's species come from.
 * Pinned by `core/state.test.ts` ("biome pool cursor parity").
 *
 * Falls back to the FULL registry (returns `undefined`, `rollGenome`'s own
 * default) when: the egg has no `sourceExpeditionId` (the DEBUG_SPAWN_EGG
 * QA seam, spec §14, passes `null`); the id doesn't resolve to a known
 * expedition (defensive — content should always agree with itself); the
 * expedition declares no `eggSpecies` (content opts out on purpose,
 * content/expeditions.ts's own doc comment); or every listed id is itself
 * missing from the species registry (defensive; validate.ts catches this
 * loudly as a content error before it ever reaches here).
 */
function eggSpeciesPoolFor(
  sourceExpeditionId: string | null,
): GenomeSpeciesRegistry | undefined {
  if (sourceExpeditionId === null) return undefined;
  // Structural lookup only (spec §2 rule 5 — core treats content ids as
  // opaque strings, same as GenomeSpeciesEntry above): ExpeditionId is a
  // fixed content-side union, but the egg only ever stored a plain string.
  const registry = contentExpeditions as Readonly<
    Record<string, { eggSpecies?: readonly string[] }>
  >;
  const pool = registry[sourceExpeditionId]?.eggSpecies;
  if (pool === undefined || pool.length === 0) return undefined;
  const filtered: Record<string, GenomeSpeciesEntry> = {};
  for (const id of pool) {
    const entry = contentSpecies[id];
    if (entry !== undefined) filtered[id] = entry;
  }
  return Object.keys(filtered).length > 0 ? filtered : undefined;
}

/** Draw one entry from `pool` without replacement (splice), refilling
 * from `all` if the pool ever runs dry (defensive: tiny injected test
 * content — real content always has ≥ 3 of each). Exactly one roll. */
function takeDistinct(
  stream: RngStream,
  pool: string[],
  all: readonly string[],
): string {
  if (pool.length === 0) pool.push(...all);
  return pool.splice(stream.int(pool.length), 1)[0] as string;
}

/** The shared genesis-roll body: exactly 3 rolls per candidate
 * (personality, palette, pattern — in that order), 9 total, regardless
 * of content or outcomes (cursor determinism, spec §2 rule 3). */
function rollCandidatesFromStream(
  genesis: RngStream,
  content: StarterContent,
): TraitGenome[] {
  const personalityPool = [...content.personalityIds];
  const palettePool = [...content.palettes];
  const candidates: TraitGenome[] = [];
  for (let i = 0; i < STARTER_CANDIDATE_COUNT; i++) {
    const personalityId = takeDistinct(
      genesis,
      personalityPool,
      content.personalityIds,
    );
    const palette = takeDistinct(genesis, palettePool, content.palettes);
    const pattern = genesis.pick(content.patterns);
    candidates.push({
      speciesId: content.speciesId,
      palette,
      pattern,
      accessorySlots: content.accessorySlots,
      personalityId,
      // Starters are never shiny (and cost zero extra rolls — the 3-roll
      // per-candidate genesis contract stays exact): the rare variant is
      // a hatch-day surprise, not an onboarding option.
      shiny: false,
    });
  }
  return candidates;
}

/**
 * The onboarding starter trio (spec §7.1/§10.1.1): three candidates of
 * the SAME species with three DISTINCT palettes and DISTINCT
 * personalities, rolled deterministically from the seed's genesis
 * stream — the same rolls createNewGame makes, so the trio the player
 * saw is exactly the trio the save was born from. Pure: same seed, same
 * three Pips, forever.
 */
export function rollStarterCandidates(
  seed: number,
  content: StarterContent = defaultStarterContent(),
): readonly TraitGenome[] {
  return rollCandidatesFromStream(
    createRng(seed).stream(GENESIS_STREAM),
    content,
  );
}

/**
 * A brand-new save (spec §10.1, §6.3): the starter mosspip the player
 * picked from the trio, plus 3 Berries for the guided first Feed.
 *
 * Genesis rolls, in fixed order (cursor determinism — same seed, same
 * trio): the full three-candidate roll of rollStarterCandidates, whose
 * advanced cursor is captured in `rngState` — the cursor is identical
 * whichever candidate wins, so the pick itself never perturbs any
 * future roll. `starterChoice` indexes the trio (clamped, default 0).
 *
 * The starter is an ADULT: spec §10.1 sends it on the guided first
 * expedition within the first 90 seconds, and Piplings refuse
 * expeditions (§4.6) — a Pipling starter would break onboarding.
 * `hatchedAt` records the adoption moment (types.ts).
 */
export function createNewGame(
  seed: number,
  now: number,
  content: StarterContent = defaultStarterContent(),
  starterChoice = 0,
): GameState {
  const rng = createRng(seed);
  const genesis = rng.stream(GENESIS_STREAM);
  const candidates = rollCandidatesFromStream(genesis, content);
  const index = Math.min(
    Math.max(Math.trunc(starterChoice), 0),
    candidates.length - 1,
  );
  const genome = candidates[index] as TraitGenome;

  const needs: PipNeeds = {
    hunger: STARTER_HUNGER,
    cleanliness: 100,
    happiness: 100,
    energy: 100,
  };

  const starterId: PipId = "pip-1";
  // Shared construction path with HATCH_EGG (spec §7.2) — the starter
  // differs only in its Adult stage and onboarding hunger.
  const starter = createPipFromGenome(genome, {
    id: starterId,
    name: "Mosspip",
    hatchedAt: now,
    lifeStage: LifeStage.Adult,
    needs,
  });

  // ROUND 2C: the starter is the player's first Album entry (bible
  // §11.3 — a fresh game is exactly the "nothing provable" case the v6
  // migration otherwise has to reconstruct).
  const pipdex = markPipdexCaught(createEmptyPipdex(), starter.speciesId, now, {
    pipId: starter.id,
    name: starter.name,
    genome: starter.genome,
    personalityId: starter.personalityId,
    lifeStageAtCatch: starter.lifeStage,
    sourceExpeditionId: null,
  });

  return {
    pips: { [starterId]: starter },
    rosterOrder: [starterId],
    activePipId: starterId,
    inventory: { ...content.startingInventory },
    resources: {},
    rngState: rng.getState(),
    seed,
    keep: createKeep(),
    jobs: {},
    rosterUpgradePurchased: false,
    eggs: [],
    pendingReveals: [],
    nextPipNumber: 2,
    nextEggNumber: 1,
    nextPlacementNumber: 1,
    cooldowns: {},
    lastLineIndex: {},
    createdAt: now,
    lastTickAt: now,
    lastCareOutcome: null,
    lastCatchup: null,
    lastAssignOutcome: null,
    lastHatchOutcome: null,
    lastJobOutcome: null,
    lastEvolveOutcome: null,
    // The guided beats start at the first prompt (spec §10.1.3) — the
    // pick already happened, or this state could not exist.
    onboarding: { completed: false, step: "feed" },
    pipdex,
    sanctuary: createEmptySanctuary(),
    lastSanctuaryOutcome: null,
    // ROUND 2C: a fresh save starts with nothing to break — full grace,
    // no counters, no bounties generated yet (the first visit action
    // lazily generates day 0's trio), no active events (the app layer
    // resolves and dispatches SET_ACTIVE_EVENTS at boot).
    streak: createEmptyStreak(contentTuning),
    dayOffsetMs: 0,
    counters: {},
    milestones: createEmptyMilestones(),
    bounties: createEmptyBounties(),
    eggPity: {},
    activeEvents: [],
    keepsakes: {},
    flair: {},
    // ROUND 2F: a fresh Keep has done nothing yet — the bar starts at
    // the very bottom of tier 1, and no tier-up has ever happened.
    keepXp: 0,
    lastLevelUp: null,
  };
}

/** Map every pip in roster order (the reducer's per-pip loop). */
function mapPips(
  state: GameState,
  fn: (pip: PipState) => PipState,
): Readonly<Record<PipId, PipState>> {
  const pips: Record<PipId, PipState> = {};
  for (const [id, pip] of Object.entries(state.pips)) {
    pips[id] = fn(pip);
  }
  return pips;
}

// ---------------------------------------------------------------------------
// ROUND 2C — PROGRESSION composition helpers (docs/retention-bible.md).
//
// The base switch below (renamed `baseReducer`) is untouched Phase 0–2B
// logic; `rootReducer` at the bottom of this section wraps it with the
// progression stack's side effects (streak/bounty visit-touch, counters,
// milestone detection) WITHOUT altering any existing action's own return
// value — every `.toBe(state)` reference-equality contract the base
// switch already promises (SET_ACTIVE_PIP, PURCHASE_KEEP_LEVEL,
// ACKNOWLEDGE_REVEAL, MOVE_ITEM, …) is preserved because the wrapper is a
// no-op whenever `baseReducer` itself returned the SAME reference (a true
// structural refusal never touches progression state either).
// ---------------------------------------------------------------------------

/** Every expedition id unlocked at `level`, in registry order. */
function unlockedExpeditionIdsAt(level: number): readonly string[] {
  return Object.values(contentExpeditions)
    .filter((exp) => exp.unlockKeepLevel <= level)
    .map((exp) => exp.id);
}

/**
 * ROUND 2F (docs/progression-bible.md §3) — the Keep's aggregated building
 * effects, resolved from `state.keep` (placements never change mid-
 * dispatch, so every call site below computes this ONCE and reuses it).
 * The single call site of `core/keep/effects.ts`'s `resolveKeepEffects`
 * against the real GameState — everywhere else in this file that needs a
 * building effect receives the already-resolved `ResolvedKeepEffects`
 * (or, for needs decay/rest speed, the `KeepComfortEffect` view of it),
 * never `state.keep` itself, matching the established pattern every other
 * `core/state.ts` progression helper already uses (mastery, streak, …).
 */
function computeKeepEffects(state: GameState): ResolvedKeepEffects {
  return resolveKeepEffects(state.keep, state.keep.level);
}

/**
 * HOW MANY PIPS THE KEEP SLEEPS (spec §7.4, extended by progression bible
 * §2's tier-11 headline "a sixth bed — the roster cap rises to 6").
 *
 * `base + (Cozy Bunks ? +2 : 0) + tier bonus`, all derived — there is no
 * stored cap and this round adds none. The two things that raise it are:
 *
 *   - `rosterUpgradePurchased` — the shipped Cozy Bunks upgrade (3 → 5),
 *     completely untouched by this round;
 *   - `tuning.progression.rosterCapBonusByLevel` — extra beds granted by
 *     Keep TIER, cumulative across every tier already passed.
 *
 * ROUND 2F INTEGRATE — THE SECOND DEAD UNLOCK. `rosterCapBonusByLevel`
 * shipped as content with `{ 11: 1 }` in it and NOTHING read it: both
 * call sites computed the cap straight from `rosterUpgradePurchased`, so
 * tier 11's own headline ("the roster cap rises to 6") bought the player
 * exactly nothing. Written to content, invisible in play — the standing
 * rule spec §16 v1.3 added after the third such feature. This function is
 * the one place that reads it, and both call sites now go through it.
 *
 * Cumulative on purpose: a table with entries at (say) 11 and 14 must
 * grant BOTH by tier 14, never just the last one — the same "sum every
 * tier already passed" shape `gridBounds` uses for `gridGrowth`.
 */
export function rosterCapFor(state: GameState): number {
  const base = state.rosterUpgradePurchased
    ? contentTuning.rosterCapUpgraded
    : contentTuning.rosterCap;
  let bonus = 0;
  for (const [level, extra] of Object.entries(
    contentTuning.progression.rosterCapBonusByLevel,
  )) {
    if (state.keep.level >= Number(level)) bonus += extra;
  }
  return base + bonus;
}

/** The `core/pips/needs.ts` view of `keepEffects` — comfort multipliers +
 * rest-speed multiplier, the two things `applyNeedsDelta`/`runCatchup`
 * consult. */
function keepComfortFrom(keepEffects: ResolvedKeepEffects): KeepComfortEffect {
  return {
    multiplier: keepComfortMultipliers(keepEffects),
    restSpeedMultiplier: keepEffects.restSpeedMultiplier,
  };
}

/**
 * The already-composed, already-clamped loot-bonus roll chance for ONE
 * pip's trip on ONE biome (docs/retention-bible.md §9): Curious's own
 * +10% (folded in here so `rollExpeditionLoot`'s override path replaces
 * rather than adds to its internal calculation, per that function's doc
 * comment) plus this pip's mastery tier in the biome plus the player's
 * current streak tier plus any active event's contribution PLUS the
 * Keep's building/set contribution (round 2F, progression bible §3.1 rule
 * 4 — "a Trail Post's +3% enters the same sum") — summed then clamped by
 * `core/progression/multipliers.ts`. A fresh save (no mastery, no streak,
 * no event, no building, non-Curious pip) evaluates to exactly 0; a
 * Curious one evaluates to exactly `tuning.quirks.curiousLootBonus` — both
 * BYTE-IDENTICAL to the pre-round-2C behaviour (the cursor-parity
 * contract `rollExpeditionLoot`'s doc comment describes).
 */
function resolveLootBonusChanceFor(
  state: GameState,
  pip: PipState,
  expeditionId: string,
  keepEffects: ResolvedKeepEffects,
): number {
  const expedition = contentExpeditions[expeditionId as keyof typeof contentExpeditions];
  const durationMs = expedition?.durationMs ?? 0;
  const trips = pip.mastery?.[expeditionId] ?? 0;
  return effectiveLootBonusChance(
    {
      curious: pip.personalityId === "curious",
      masteryBonusChance: masteryBonusRollChance(trips, durationMs, contentTuning),
      streakBonusChance: streakLootBonus(state.streak, contentTuning),
      eventBonusChance: activeEventLootBonusChance(state.activeEvents, contentTuning),
      buildingBonusChance: keepEffects.expeditionLootBonusChance,
    },
    contentTuning,
  );
}

/**
 * The already-composed egg chance for ONE pip's trip on ONE biome
 * (docs/retention-bible.md §6.3 mastery top tier + §8.4 event bonus, plus
 * round 2F's building/set contribution — e.g. the Weathervane): the
 * biome's base `eggChance` plus the summed-then-clamped bonus POINTS, with
 * `eggChanceCeiling` as a hard ceiling so a biome's odds can never become
 * a certainty. This is the ONE call site of the egg-chance channel — the
 * mirror of `resolveLootBonusChanceFor` for the loot channel, and the
 * reason mastery tier 5's "small additive egg-chance bonus" and Lantern
 * Nights' `eggChanceBonusPoints` are things that actually happen in game.
 *
 * A fresh save (no mastery, no event, no building) evaluates to exactly
 * the biome's base `eggChance`, so the egg roll is byte-identical to
 * before this round — and because the roll is a single `stream.chance`
 * call whatever the probability, the cursor cannot shift even when a
 * bonus IS active.
 */
function resolveEggChanceFor(
  state: GameState,
  pip: PipState,
  expeditionId: string,
  keepEffects: ResolvedKeepEffects,
): number {
  const expedition = contentExpeditions[expeditionId as keyof typeof contentExpeditions];
  if (expedition === undefined) return 0;
  const trips = pip.mastery?.[expeditionId] ?? 0;
  const points = effectiveEggChanceBonusPoints(
    {
      masteryPoints: masteryEggChanceBonusPoints(
        trips,
        expedition.durationMs,
        contentTuning,
      ),
      eventPoints: activeEventEggChanceBonusPoints(state.activeEvents, expeditionId),
      buildingPoints: keepEffects.eggChanceBonusPoints,
    },
    contentTuning,
  );
  return applyEggChanceBonus(expedition.eggChance, points, contentTuning);
}

/** Structural species-rarity view for `progression/pity.ts`, built once
 * from the real species registry (opaque ids — spec §2 rule 5). */
const PITY_SPECIES_VIEW: Readonly<Record<string, PitySpeciesEntry>> = (() => {
  const view: Record<string, PitySpeciesEntry> = {};
  for (const entry of Object.values(contentSpecies)) {
    view[entry.id] = { id: entry.id, rarity: entry.rarity };
  }
  return view;
})();

/** The rarity-tagged species pool for a biome's eggSpecies list (pity's
 * own structural view — mirrors `eggSpeciesPoolFor`'s registry lookup,
 * kept separate because pity wants rarity tags, not genome rolling
 * shape). */
function pitySpeciesPoolFor(expeditionId: string): readonly PitySpeciesEntry[] {
  const ids =
    (
      contentExpeditions as Readonly<Record<string, { eggSpecies?: readonly string[] }>>
    )[expeditionId]?.eggSpecies ?? [];
  return ids
    .map((id) => PITY_SPECIES_VIEW[id])
    .filter((entry): entry is PitySpeciesEntry => entry !== undefined);
}

/** Everything a bounty needs to know about the player's CURRENT
 * capabilities (bible §5.3) — built fresh from the real GameState. */
function buildBountyContext(state: GameState): BountyContext {
  const placedItemIds = new Set(
    Object.values(state.keep.placements).map((p) => p.itemId),
  );
  const unlockedExpeditionIds = new Set(unlockedExpeditionIdsAt(state.keep.level));
  const obtainableItemIds = new Set<string>();
  for (const exp of Object.values(contentExpeditions)) {
    if (exp.unlockKeepLevel > state.keep.level) continue;
    for (const entry of exp.lootTable) obtainableItemIds.add(entry.itemId);
  }
  const rosterPips = state.rosterOrder
    .map((id) => state.pips[id])
    .filter((pip): pip is PipState => pip !== undefined);
  const hasAdultPip = rosterPips.some((pip) => pip.lifeStage === LifeStage.Adult);
  const hasAffordableDecoration = contentDecorations.some((deco) =>
    canAfford(state.resources, deco.cost),
  );
  return {
    keepLevel: state.keep.level,
    rosterSize: state.rosterOrder.length,
    hasAdultPip,
    placedItemIds,
    unlockedExpeditionIds,
    obtainableItemIds,
    hasAffordableDecoration,
  };
}

/** Everything a milestone's metric might read (bible §4), composed from
 * the real GameState — active roster AND Long Meadow residents both
 * count for age/mastery metrics (retiring must never cost progress). */
function buildMilestoneContext(state: GameState): MilestoneMetricContext {
  const allPips = [
    ...Object.values(state.pips),
    ...Object.values(state.sanctuary.pips).map((record) => record.pip),
  ];
  let oldestPipAgeMs = 0;
  let masteryTierAnyBiome = 0;
  const biomeIds = Object.keys(contentExpeditions);
  const bestTierPerBiome: Record<string, number> = {};
  for (const pip of allPips) {
    oldestPipAgeMs = Math.max(oldestPipAgeMs, pip.ageMs);
    for (const biomeId of biomeIds) {
      const trips = pip.mastery?.[biomeId] ?? 0;
      const durationMs =
        (contentExpeditions as Readonly<Record<string, { durationMs: number }>>)[biomeId]
          ?.durationMs ?? 0;
      const tier = masteryTier(trips, durationMs, contentTuning);
      masteryTierAnyBiome = Math.max(masteryTierAnyBiome, tier);
      bestTierPerBiome[biomeId] = Math.max(bestTierPerBiome[biomeId] ?? 0, tier);
    }
  }
  const masteryTierAllBiomes =
    biomeIds.length > 0
      ? Math.min(...biomeIds.map((id) => bestTierPerBiome[id] ?? 0))
      : 0;
  return {
    counters: state.counters,
    albumForms: state.pipdex.formsCaught,
    ledgerVariants: state.pipdex.variantsCaught,
    streakLongest: state.streak.longest,
    masteryTierAnyBiome,
    masteryTierAllBiomes,
    oldestPipAgeMs,
    sanctuaryResidents: state.sanctuary.order.length,
  };
}

/** Additively bump one or more counters by `amount` (default 1). Pure. */
function bumpCounters(
  counters: Readonly<Record<string, number>>,
  ids: readonly string[],
  amount = 1,
): Readonly<Record<string, number>> {
  if (ids.length === 0) return counters;
  const next = { ...counters };
  for (const id of ids) next[id] = (next[id] ?? 0) + amount;
  return next;
}

/**
 * ROUND 2C counters (bible §4.1) — every id this build's milestone
 * registry actually reads. Derives what happened from the OUTCOME the
 * base reducer just parked (never re-validates legality itself — the
 * base switch already decided whether the action applied) plus, for
 * ACKNOWLEDGE_REVEAL/PLACE_ITEM/PURCHASE_*, a before/after diff against
 * `prev` (the pre-dispatch state).
 */
function bumpCountersForAction(
  prev: GameState,
  next: GameState,
  action: GameAction,
): GameState {
  switch (action.type) {
    case "FEED":
    case "CLEAN":
    case "PLAY":
    case "PET":
    case "GIVE_ITEM": {
      if (next.lastCareOutcome?.applied !== true) return next;
      const perActionCounter: Readonly<Record<string, string>> = {
        FEED: "feeds",
        CLEAN: "cleans",
        PLAY: "plays",
        PET: "pets",
        GIVE_ITEM: "gifts",
      };
      const counterId = perActionCounter[action.type] as string;
      return { ...next, counters: bumpCounters(next.counters, [counterId, "careActions"]) };
    }
    case "REST_TOGGLE": {
      if (next.lastCareOutcome?.applied !== true) return next;
      // "naps" counts STARTING a rest (the player-witnessed moment of
      // putting a Pip down) — auto-wake is a TICK/CATCHUP event, not a
      // dispatched visit, so it is not the moment this counter models.
      const pip = next.pips[action.pipId];
      const startedResting = pip?.activity === PipActivity.Resting;
      const counterIds = startedResting ? ["naps", "careActions"] : ["careActions"];
      return { ...next, counters: bumpCounters(next.counters, counterIds) };
    }
    case "ASSIGN_EXPEDITION": {
      if (next.lastAssignOutcome?.ok !== true) return next;
      return {
        ...next,
        counters: bumpCounters(next.counters, [
          "expeditionsTotal",
          `expeditions.${action.expeditionId}`,
        ]),
      };
    }
    case "ACKNOWLEDGE_REVEAL": {
      // `itemsCollected` (a per-item COUNT, not a flat +1) is bumped
      // separately in `applyProgressionEffects` via
      // `itemsCollectedThisReveal` — this arm only handles the flat +1
      // `eggsFound` counter.
      const reveal = prev.pendingReveals[0];
      if (reveal === undefined || reveal.egg === null) return next;
      return { ...next, counters: bumpCounters(next.counters, ["eggsFound"]) };
    }
    case "HATCH_EGG": {
      if (next.lastHatchOutcome?.ok !== true) return next;
      const hatchling = next.pips[next.lastHatchOutcome.pipId];
      const counterIds = ["eggsHatched"];
      if (hatchling?.genome.shiny === true) counterIds.push("shiniesFound");
      return { ...next, counters: bumpCounters(next.counters, counterIds) };
    }
    case "ASSIGN_JOB": {
      if (next.lastJobOutcome?.action !== "assignJob" || !next.lastJobOutcome.ok) {
        return next;
      }
      return { ...next, counters: bumpCounters(next.counters, ["jobsAssigned"]) };
    }
    case "EVOLVE_PIP": {
      if (next.lastEvolveOutcome?.ok !== true) return next;
      return { ...next, counters: bumpCounters(next.counters, ["evolutions"]) };
    }
    case "RETIRE_PIP": {
      if (next.lastSanctuaryOutcome?.ok !== true) return next;
      return { ...next, counters: bumpCounters(next.counters, ["sanctuaryArrivals"]) };
    }
    case "RETRIEVE_PIP": {
      if (next.lastSanctuaryOutcome?.ok !== true) return next;
      return { ...next, counters: bumpCounters(next.counters, ["sanctuaryReturns"]) };
    }
    case "PLACE_ITEM": {
      if (next.keep === prev.keep) return next; // refused
      const isDecoration = contentDecorations.some((d) => d.id === action.itemId);
      if (!isDecoration) return next;
      return { ...next, counters: bumpCounters(next.counters, ["decorationsPlaced"]) };
    }
    case "PURCHASE_KEEP_LEVEL": {
      if (next.keep.level === prev.keep.level) return next; // refused
      const counterId = `keepLevel${next.keep.level}Reached`;
      return { ...next, counters: bumpCounters(next.counters, [counterId]) };
    }
    case "PURCHASE_ROSTER_UPGRADE": {
      if (!next.rosterUpgradePurchased || prev.rosterUpgradePurchased) return next;
      return { ...next, counters: bumpCounters(next.counters, ["rosterUpgradePurchased"]) };
    }
    default:
      return next;
  }
}

/** Item counts collected on THIS acknowledge (bible §4.1 `itemsCollected`
 * — the raw count of items landed, egg or not). Kept as its own tiny
 * helper because `bumpCountersForAction`'s ACKNOWLEDGE_REVEAL arm above
 * needed a second pass anyway (a defensive style choice, not a
 * requirement) — this is the actually-used implementation. */
function itemsCollectedThisReveal(prev: GameState): number {
  return prev.pendingReveals[0]?.items.length ?? 0;
}

/** Milestone-worthy roster-size / biome-coverage totals that are cheaper
 * to RECOMPUTE than to diff (both are monotonic functions of already-
 * forward-only counters, so recomputing can never regress them). */
function withDerivedCounters(state: GameState): GameState {
  let counters = state.counters;
  if (state.rosterOrder.length >= 3 && (counters["rosterSizeReached3"] ?? 0) < 1) {
    counters = bumpCounters(counters, ["rosterSizeReached3"]);
  }
  const biomesVisited = Object.keys(contentExpeditions).filter(
    (id) => (counters[`expeditions.${id}`] ?? 0) > 0,
  ).length;
  if (biomesVisited !== (counters["biomesVisited"] ?? 0)) {
    counters = { ...counters, biomesVisited };
  }
  return counters === state.counters ? state : { ...state, counters };
}

/** Mastery increments at the moment a trip's reveal is acknowledged (the
 * player-witnessed "trip completed" moment, bible §6.1) — reads the
 * PRE-dispatch reveal (`prev`, before ACKNOWLEDGE_REVEAL consumed it). */
function applyMasteryForAction(
  prev: GameState,
  next: GameState,
  action: GameAction,
): GameState {
  if (action.type !== "ACKNOWLEDGE_REVEAL") return next;
  const reveal = prev.pendingReveals[0];
  if (reveal === undefined) return next;
  const pip = next.pips[reveal.pipId];
  if (pip === undefined) return next;
  const mastery = incrementMasteryTrips(pip.mastery, reveal.expeditionId);
  return { ...next, pips: { ...next.pips, [pip.id]: { ...pip, mastery } } };
}

/** Bounty progress events implied by an action's OUTCOME (bible §5) —
 * auto-banks completed bounties' rewards and the day-clear bonus egg
 * choice the instant they fire (no claim step, per §5.4/§3.5's "auto-bank
 * the instant they're earned"). */
function applyBountyProgressForAction(
  prev: GameState,
  next: GameState,
  action: GameAction,
): GameState {
  const events: BountyProgressEvent[] = [];
  switch (action.type) {
    case "FEED":
      if (next.lastCareOutcome?.applied === true) events.push({ kind: "feed" });
      break;
    case "CLEAN":
      if (next.lastCareOutcome?.applied === true) events.push({ kind: "clean" });
      break;
    case "PLAY":
      if (next.lastCareOutcome?.applied === true) events.push({ kind: "play" });
      break;
    case "PET":
      if (next.lastCareOutcome?.applied === true) events.push({ kind: "pet" });
      break;
    case "REST_TOGGLE":
      if (
        next.lastCareOutcome?.applied === true &&
        next.pips[action.pipId]?.activity === PipActivity.Resting
      ) {
        events.push({ kind: "rest" });
      }
      break;
    case "ASSIGN_EXPEDITION":
      if (next.lastAssignOutcome?.ok === true) {
        events.push({ kind: "expedition", expeditionId: action.expeditionId });
      }
      break;
    case "ACKNOWLEDGE_REVEAL": {
      const reveal = prev.pendingReveals[0];
      if (reveal === undefined) break;
      const counts: Record<string, number> = {};
      for (const itemId of reveal.items) counts[itemId] = (counts[itemId] ?? 0) + 1;
      for (const [itemId, amount] of Object.entries(counts)) {
        events.push({ kind: "collect", itemId, amount });
      }
      break;
    }
    case "HATCH_EGG":
      if (next.lastHatchOutcome?.ok === true) events.push({ kind: "hatch" });
      break;
    case "ASSIGN_JOB":
      if (next.lastJobOutcome?.action === "assignJob" && next.lastJobOutcome.ok) {
        const placedItemId =
          next.keep.placements[next.lastJobOutcome.stationPlacementId]?.itemId;
        events.push({ kind: "job", placedItemId });
      }
      break;
    case "PLACE_ITEM":
      if (next.keep !== prev.keep && contentDecorations.some((d) => d.id === action.itemId)) {
        events.push({ kind: "place" });
      }
      break;
    default:
      break;
  }

  if (events.length === 0) return next;

  let bounties = next.bounties;
  let counters = next.counters;
  for (const event of events) {
    const result = applyBountyEvent(bounties, event, actionAt(action) ?? next.lastTickAt);
    bounties = result.bounties;
    if (result.justCompleted.length > 0) {
      counters = bumpCounters(counters, ["bountiesCompleted"], result.justCompleted.length);
      for (const completed of result.justCompleted) {
        const template = contentBountyTemplates.find((t) => t.id === completed.templateId);
        if (template === undefined) continue;
        // Auto-bank the reward (bible §5.4: "rewards auto-bank on
        // completion, so a completed bounty can never be missed").
        const inventoryDelta = template.reward.items ?? {};
        const resourceDelta = template.reward.resources ?? {};
        next = {
          ...next,
          inventory: mergeCounts(next.inventory, inventoryDelta),
          resources: mergeCounts(next.resources, resourceDelta),
        };
      }
    }
    if (result.dayJustCleared) {
      counters = bumpCounters(counters, ["bountyDaysCleared"]);
      const offers = [...unlockedExpeditionIdsAt(next.keep.level)];
      if (offers.length > 0 && bounties.day !== null) {
        next = {
          ...next,
          streak: {
            ...next.streak,
            pendingChoices: [
              ...next.streak.pendingChoices,
              { kind: "bountyEgg", offers, forDay: bounties.day },
            ],
          },
        };
      }
    }
  }
  return { ...next, bounties, counters };
}

/**
 * ROUND 2F — KEEP XP, applied in this ONE place (docs/progression-bible.md
 * §1.3's award table), mirroring `touchProgressionVisit`'s own boundary:
 * every branch below keys off the SAME outcome fields
 * `bumpCountersForAction` already trusts (`lastCareOutcome.applied`,
 * `lastAssignOutcome.ok`, …) and never re-validates legality itself — so
 * a unit test dispatching (say) a REFUSED FEED against a hand-built
 * fixture never silently gains XP the outcome itself didn't earn.
 *
 * Three sources are computed GENERICALLY, as a diff of an already
 * forward-only total, rather than special-cased per action — so a future
 * action nobody thought to wire in still pays correctly (ruling #5: every
 * XP source must be mechanical, observable, and impossible to forget):
 * the Album (`pipdex.formsSeen`/`formsCaught`/`variantsCaught` — covers
 * ACKNOWLEDGE_REVEAL's field notes, HATCH_EGG's portrait, and
 * EVOLVE_PIP's portrait+variant with ONE calculation), and completed
 * bounties / day-clears (the counters `applyBountyProgressForAction`,
 * just above this call site, already bumped).
 */
function applyKeepXpForAction(
  prev: GameState,
  next: GameState,
  action: GameAction,
): GameState {
  let gained = 0;
  let counters = next.counters;

  switch (action.type) {
    case "FEED":
    case "CLEAN":
    case "PLAY":
    case "PET":
    case "GIVE_ITEM":
      if (next.lastCareOutcome?.applied === true) gained += careActionXp(contentTuning);
      break;
    case "REST_TOGGLE":
      // Only a nap that STARTS pays (bible row 8) — mirrors the `naps`
      // counter's own condition just above in `bumpCountersForAction`.
      if (
        next.lastCareOutcome?.applied === true &&
        next.pips[action.pipId]?.activity === PipActivity.Resting
      ) {
        gained += careActionXp(contentTuning);
      }
      break;
    case "ASSIGN_EXPEDITION":
      if (next.lastAssignOutcome?.ok === true) gained += expeditionSendXp(contentTuning);
      break;
    case "ACKNOWLEDGE_REVEAL": {
      const reveal = prev.pendingReveals[0];
      if (reveal !== undefined) {
        const durationMs =
          (
            contentExpeditions as Readonly<Record<string, { durationMs: number }>>
          )[reveal.expeditionId]?.durationMs ?? 0;
        gained += revealXp(durationMs, contentTuning);

        // Mastery tier-up (bible row 32): compare this pip's mastery tier
        // on this biome BEFORE (prev, untouched by this dispatch yet) vs
        // AFTER (`applyMasteryForAction`, run just above this call site
        // in `applyProgressionEffects`, has already incremented `next`'s
        // trip count). Idempotent via `counters["masteryTier.<pipId>.
        // <biomeId>"]` holding the highest tier already paid — granting
        // ONLY the new tier's multiple, never the sum of every tier
        // skipped through (mirrors `masteryEggChanceBonusPoints`'s own
        // "top tier only" reasoning, just at every tier instead of one).
        const prevPip = prev.pips[reveal.pipId];
        const nextPip = next.pips[reveal.pipId];
        if (prevPip !== undefined && nextPip !== undefined) {
          const prevTrips = prevPip.mastery?.[reveal.expeditionId] ?? 0;
          const nextTrips = nextPip.mastery?.[reveal.expeditionId] ?? 0;
          if (nextTrips > prevTrips) {
            const prevTier = masteryTier(prevTrips, durationMs, contentTuning);
            const nextTier = masteryTier(nextTrips, durationMs, contentTuning);
            if (nextTier > prevTier) {
              const key = `masteryTier.${reveal.pipId}.${reveal.expeditionId}`;
              const paidTier = counters[key] ?? 0;
              if (nextTier > paidTier) {
                gained += masteryTierXpAward(nextTier, contentTuning);
                counters = { ...counters, [key]: nextTier };
              }
            }
          }
        }
      }
      break;
    }
    case "HATCH_EGG":
      if (next.lastHatchOutcome?.ok === true) gained += hatchXp(contentTuning);
      break;
    case "EVOLVE_PIP":
      if (next.lastEvolveOutcome?.ok === true) gained += evolveXp(contentTuning);
      break;
    case "PLACE_ITEM": {
      // First-ever placement of this item TYPE (bible row 13) — ANY
      // placeable or decoration, not just decorations (unlike the
      // `decorationsPlaced` counter `bumpCountersForAction` bumps above).
      // Idempotent via `counters["built.<itemId>"]`, paid once per type,
      // forever — closing the place → refund → place printer (row 13b).
      if (next.keep !== prev.keep) {
        const key = `built.${action.itemId}`;
        if ((counters[key] ?? 0) === 0) {
          gained += firstBuildXp(contentTuning);
          counters = { ...counters, [key]: 1 };
        }
      }
      break;
    }
    case "ASSIGN_JOB":
      // First-ever shift at this job TYPE (bible row 17), idempotent via
      // `counters["job.<jobId>"]`.
      if (next.lastJobOutcome?.action === "assignJob" && next.lastJobOutcome.ok) {
        const key = `job.${next.lastJobOutcome.jobId}`;
        if ((counters[key] ?? 0) === 0) {
          gained += firstJobXp(contentTuning);
          counters = { ...counters, [key]: 1 };
        }
      }
      break;
    case "PURCHASE_ROSTER_UPGRADE":
      // The flag itself is the idempotence key (base reducer refuses a
      // repeat purchase by returning `state` unchanged, so reaching here
      // with the flag newly true IS the one-time moment).
      if (next.rosterUpgradePurchased && !prev.rosterUpgradePurchased) {
        gained += rosterUpgradeXp(contentTuning);
      }
      break;
    case "CLAIM_STREAK_REWARD":
      // `rewardedForDay` is the base reducer's own idempotence key (a
      // repeat claim for the same day returns `state` unchanged).
      if (next.streak.rewardedForDay !== prev.streak.rewardedForDay) {
        gained += streakDayXp(effectiveStreakTier(next.streak, contentTuning), contentTuning);
      }
      break;
    case "CLAIM_MILESTONE": {
      // `rootReducer`'s own `next === state` gate already means reaching
      // here IS a genuine new earn (an already-earned or not-yet-met id
      // refuses by returning the SAME `state` reference — see the base
      // switch's CLAIM_MILESTONE arm) — no second idempotence check
      // needed. `xp` is optional content (defaults to 0) so this stays
      // forward-compatible with a content pass that has not yet filled
      // every milestone's value in.
      const def = contentMilestones.find((m) => m.id === action.id);
      gained += def?.xp ?? 0;
      break;
    }
    case "TICK":
    case "CATCHUP": {
      // Job production tick XP (bible row 16), derived from WHAT WAS ACTUALLY
      // PRODUCED: spec §6.2 is "1 item per tick", and during TICK/CATCHUP the
      // only thing that adds to `inventory`/`resources` is `settleJobTicks`
      // (expedition loot lands in `pendingReveals` and is not collected until
      // ACKNOWLEDGE_REVEAL), so the count of new items IS the count of ticks.
      // Already bounded by the same `offlineRateCapMs` production obeys.
      //
      // IT USED TO DIFF `jobs[pipId].lastProducedAt`, WHICH SILENTLY LOST THE
      // WHOLE GRANT on the most common long absence there is. `reconcileJobs`
      // PRUNES a job whose pip is no longer AssignedJob, and entering Sulking
      // does exactly that (spec §4.4) — so an absence long enough to take a
      // need to 0 ended with `next.jobs` empty, the diff finding nothing to
      // measure, and the player paid resources for their station's whole shift
      // but zero XP for it. Measured: a 20h absence with a staffed Gathering
      // Station banked 8 Wood + 29 Fiber and +0 XP. Diffing the produced
      // totals cannot lose the grant, because it reads the thing that happened
      // rather than the bookkeeping that survived.
      const countAll = (state: GameState): number => {
        let total = 0;
        for (const n of Object.values(state.inventory)) total += n;
        for (const n of Object.values(state.resources)) total += n;
        return total;
      };
      const ticks = Math.max(0, countAll(next) - countAll(prev));
      gained += jobTickXp(ticks, contentTuning);
      break;
    }
    case "RETIRE_PIP": {
      // FIRST-ever arrival only (bible row 22). Deliberately NOT keyed on
      // `SanctuaryRecord.visits` — `core/sanctuary`'s `retirePip` resets
      // that to 0 on every arrival, so it cannot tell a first retirement
      // from a retrieve → retire loop. `counters["sanctuaryArrival.
      // <pipId>"]` can, because counters never get deleted.
      if (
        next.lastSanctuaryOutcome?.ok === true &&
        next.lastSanctuaryOutcome.action === "retire"
      ) {
        const key = `sanctuaryArrival.${action.pipId}`;
        if ((counters[key] ?? 0) === 0) {
          gained += sanctuaryFirstArrivalXp(contentTuning);
          counters = { ...counters, [key]: 1 };
        }
      }
      break;
    }
    default:
      break;
  }

  // Bounty completions / day-clears (bible rows 30–31) — the counters
  // `applyBountyProgressForAction` (just above this call site) already
  // bumped; diffing them is the generic form (usually 0 or 1, occasionally
  // more when one action ticks off several bounties at once).
  const completedDelta =
    (next.counters["bountiesCompleted"] ?? 0) - (prev.counters["bountiesCompleted"] ?? 0);
  const dayClearDelta =
    (next.counters["bountyDaysCleared"] ?? 0) - (prev.counters["bountyDaysCleared"] ?? 0);
  gained +=
    bountyCompleteXp(completedDelta, contentTuning) +
    bountyDayClearXp(dayClearDelta, contentTuning);

  // The Album (bible rows 33–35) — see the module-doc note above.
  const seenDelta = next.pipdex.formsSeen - prev.pipdex.formsSeen;
  const caughtDelta = next.pipdex.formsCaught - prev.pipdex.formsCaught;
  const variantDelta = next.pipdex.variantsCaught - prev.pipdex.variantsCaught;
  gained += albumXpFromDeltas(seenDelta, caughtDelta, variantDelta, contentTuning);

  // THE `xpBonus` BUILDING CHANNEL (progression bible §3.1/§3.4), applied
  // HERE and nowhere else — the last step, so it scales EVERY row of the
  // award table uniformly rather than a hand-picked subset (which is what
  // "+8% Keep XP" on the Weathervane's card promises the player, and what
  // `ui/keepUpgrade.ts`'s "How the Keep helps" readout prints back to them).
  //
  // Round-2F integration note (ruling #5): the effects engine resolved and
  // capped `xpBonusFraction` from the moment it landed, and both the Build
  // sheet's effect line and the Comfort readout displayed it — but nothing
  // multiplied by it. That is the exact shape of the "written to state,
  // invisible in play" dead feature spec §16 v1.3 made a standing rule
  // against, inverted: visible in the UI, absent from the simulation. This
  // is the one line that makes the promise true.
  //
  // Resolved from `next.keep` (the Keep as it stands after this action), so
  // the tap that places the Weathervane already earns its own bonus. Only
  // computed when there is something to scale — `applyKeepXpForAction` runs
  // on every TICK, and the overwhelming majority of ticks grant nothing.
  // ROUNDED UP (`ceil`) on any positive grant so a bonus can never be
  // invisible: at +5% a 4-XP care action pays 5, never a silent 4.
  if (gained > 0) {
    const xpBonusFraction = computeKeepEffects(next).xpBonusFraction;
    if (xpBonusFraction > 0) gained = Math.ceil(gained * (1 + xpBonusFraction));
  }

  if (gained === 0 && counters === next.counters) return next;

  const keepXp = next.keepXp + gained;

  // RENOWN FLAIR (bible §1.7) — the endgame's ONLY payout, and the reason
  // the bar past tier 12 is not full and dead. Every Renown level crossed by
  // this award mints its `renown-*` flourish from `content/flair.ts` into the
  // same `state.flair` bag milestone flair already uses, so it draws through
  // renderers that already exist (`ui/pipdex.ts`'s cover strip and page
  // frame, `ui/sanctuary.ts`'s gate sign, `ui/focusView.ts`'s Pip title) and
  // `ui/xpBar.ts` names the NEXT one on the bar itself.
  //
  // A RECONCILIATION, NOT AN EDGE DETECTOR. It asks "which flourishes has this
  // Keep earned?" and grants any that are missing, rather than "did this
  // dispatch cross a boundary?" — because the boundary form silently forfeits
  // banked Renown XP: a player who banks two Renown levels' worth at level 11
  // and then buys tier 12 crosses no boundary on the next action, so the
  // edge-detecting form paid them nothing, ever. `grantFlair` never overwrites
  // an existing entry, so this is idempotent by construction and multi-level
  // jumps (a long CATCHUP, a debug grant) cannot skip a flourish either.
  //
  // GATED ON ACTUALLY BEING AT THE TOP TIER, because §1.7 is "AFTER tier 12:
  // Renown". `renownLevelFor` reads `keepXp` alone, so without this a player
  // sitting at level 11 with a Ready tier 12 unpurchased would start collecting
  // Renown flourishes before finishing the named ladder — Renown would arrive
  // before the thing it is meant to come after. Nothing is lost by waiting: the
  // XP is banked, and the flourishes mint the moment the tier is bought.
  let flair = next.flair;
  if (
    gained > 0 &&
    contentTuning.progression.renown.flairEveryLevels > 0 &&
    next.keep.level >= contentTuning.progression.levelXp.length
  ) {
    const earnedLevel = renownLevelFor(keepXp, contentTuning);
    if (earnedLevel > 0) {
      const at = actionAt(action) ?? 0;
      for (const def of renownFlairEarnedBetween(0, earnedLevel)) {
        flair = grantFlair(flair, def.id, at);
      }
    }
  }

  return { ...next, counters, keepXp, flair };
}

/**
 * ROUND 2F — WHAT THE ABSENCE PAID (docs/progression-bible.md §6.3).
 *
 * The Doorstep reported ONLY decay: three-to-twelve lines of `Hunger ↓49
 * Cleanliness ↓59 …` and nothing else. On a measured 20h return that had
 * actually earned +140 Keep XP and 22 Wood / 31 Fiber / 2 Shell from a staffed
 * Gathering Station, the return screen was a chore report with no pull — the
 * one screen whose entire job is to make coming back feel good.
 *
 * Both numbers are computed HERE rather than in the UI because only the
 * reducer can see both sides of the dispatch. They ride on `lastCatchup`,
 * which `core/save/serialize.ts` treats as `passThroughTransient` (a UI echo,
 * never validated state) — so this needs no schema bump, no migration and no
 * new fixture, and both fields are optional so every pre-2F fixture and
 * hand-built summary in the test suite stays valid.
 *
 * Only ever POSITIVE deltas: an absence cannot cost XP (bible §0.3) and
 * spending happens on player taps, never inside CATCHUP, so a negative here
 * would be a bug and is dropped rather than rendered as a loss.
 */
function recordCatchupGains(
  prev: GameState,
  next: GameState,
  action: GameAction,
): GameState {
  if (action.type !== "CATCHUP") return next;
  const summary = next.lastCatchup;
  if (summary === null) return next;

  const keepXpGained = Math.max(0, next.keepXp - prev.keepXp);

  const produced: Record<string, number> = {};
  for (const [resourceId, count] of Object.entries(next.resources)) {
    const gain = count - (prev.resources[resourceId] ?? 0);
    if (gain > 0) produced[resourceId] = gain;
  }

  if (keepXpGained === 0 && Object.keys(produced).length === 0) return next;
  return { ...next, lastCatchup: { ...summary, keepXpGained, produced } };
}

/** The `at` timestamp on actions that carry one (most do); `null` for the
 * handful of genuinely time-free ones (SET_ACTIVE_PIP, ONBOARDING_ADVANCE,
 * DEBUG_GRANT, LOAD_SAVE, SET_DAY_OFFSET, SET_ACTIVE_EVENTS) — see the
 * module-level note on the streak visit whitelist below. */
function actionAt(action: GameAction): number | null {
  return "at" in action ? (action as { at: number }).at : null;
}

/**
 * THE STREAK VISIT WHITELIST (docs/retention-bible.md §3.2): exactly the
 * action types that count as a player "showing up" — enumerated
 * explicitly (rather than "every action with an `at`") so a future action
 * added to `GameAction` can't silently start OR stop counting.
 * `state.test.ts` checks this list against `GameAction`'s own union.
 *
 * The bible's own list, in full: "Feed, Clean, Play, Pet, Rest, Give Item,
 * send an expedition, collect a reveal, hatch an egg, PLACE/MOVE AN ITEM,
 * BUY SOMETHING, assign a job, evolve, retire, ask home." The build/purchase
 * half of that sentence is why `PLACE_ITEM`/`MOVE_ITEM`/`REMOVE_ITEM`/
 * `PURCHASE_KEEP_LEVEL`/`PURCHASE_ROSTER_UPGRADE`/`UNASSIGN_JOB` now carry
 * an `at` timestamp: a session spent entirely in Build mode is a session
 * the player demonstrably played, and recording it as an absence would
 * spend a rain day (or reset the tier) for a day that happened. A BREAK may
 * cost the tier (§0.1); a session that happened may not.
 *
 * NOT included, and why: `TICK`/`CATCHUP` (the app breathing, not the
 * player, spec §4.5 — and the bible's "not merely opening the app");
 * `SET_ACTIVE_PIP`/`ONBOARDING_ADVANCE`/`DEBUG_*`/`LOAD_SAVE`/
 * `SET_DAY_OFFSET`/`SET_ACTIVE_EVENTS`/`CLAIM_MILESTONE`/`REROLL_BOUNTY`/
 * `RESOLVE_STREAK_CHOICE` (meta/administrative bookkeeping the app layer
 * fires on its own at boot, not a player showing up — if these counted,
 * merely launching the PWA would count, which §3.2 forbids by name).
 */
export const STREAK_VISIT_ACTION_TYPES: ReadonlySet<GameAction["type"]> = new Set([
  "FEED",
  "CLEAN",
  "PLAY",
  "PET",
  "REST_TOGGLE",
  "GIVE_ITEM",
  "ASSIGN_EXPEDITION",
  "ACKNOWLEDGE_REVEAL",
  "HATCH_EGG",
  "ASSIGN_JOB",
  "UNASSIGN_JOB",
  "EVOLVE_PIP",
  "RETIRE_PIP",
  "RETRIEVE_PIP",
  "PLACE_ITEM",
  "MOVE_ITEM",
  "REMOVE_ITEM",
  "PURCHASE_KEEP_LEVEL",
  "PURCHASE_ROSTER_UPGRADE",
]);

/**
 * Advance the streak for a visit at `at`, resolve any ladder reward the
 * new day unlocked (auto-banked, or parked as a waiting choice), and
 * lazily regenerate today's bounty trio. The single call site for both
 * (bible §3/§5 share the same day-derived, `at`-gated trigger).
 */
function touchProgressionVisit(state: GameState, at: number): GameState {
  // Deliberately narrow: THIS wrapper (run automatically after every
  // whitelisted action) only advances `streak`'s own bookkeeping
  // (current/longest/grace/rainDays) — never grants a reward and never
  // regenerates bounties. Both of those are EXPLICIT actions
  // (CLAIM_STREAK_REWARD, REFRESH_BOUNTIES) precisely so an ordinary
  // FEED/CLEAN/etc. dispatched in isolation (as thousands of existing
  // unit tests across the codebase do, each with its own hand-built
  // GameState fixture) can never silently acquire bonus items/resources
  // it did not ask for. The reward/regeneration LOGIC itself
  // (`resolveLadderReward`, `ensureBountiesForDay`) is fully implemented
  // and unit-tested in `core/progression/`; this is a deliberate
  // integration-safety boundary, not a missing feature.
  const streak = touchVisit(state.streak, at, state.dayOffsetMs, contentTuning);
  return streak === state.streak ? state : { ...state, streak };
}

/**
 * The progression wrapper (bible §0.1's guardrail made mechanical): runs
 * AFTER the base switch, and only when the base switch actually changed
 * something (`next !== prevBase` — a true structural refusal returns the
 * SAME reference from `baseReducer`, and this wrapper preserves that
 * exactly, so every existing `.toBe(state)` contract survives untouched).
 */
function applyProgressionEffects(
  prev: GameState,
  next: GameState,
  action: GameAction,
): GameState {
  let result = next;
  result = bumpCountersForAction(prev, result, action);
  if (action.type === "ACKNOWLEDGE_REVEAL") {
    const collected = itemsCollectedThisReveal(prev);
    if (collected > 0) {
      result = { ...result, counters: bumpCounters(result.counters, ["itemsCollected"], collected) };
    }
  }
  result = applyMasteryForAction(prev, result, action);
  result = applyBountyProgressForAction(prev, result, action);
  // ROUND 2F — Keep XP (docs/progression-bible.md §1.3): AFTER mastery
  // (reads the already-incremented trip count) and bounty progress
  // (reads the already-bumped completion counters), same "runs only when
  // baseReducer actually changed something" safety the whole wrapper has.
  result = applyKeepXpForAction(prev, result, action);
  // ROUND 2F — what the absence actually PAID (bible §6.3): recorded onto the
  // same transient `lastCatchup` echo the Doorstep already reads, once the XP
  // and production above have landed. See `recordCatchupGains`.
  result = recordCatchupGains(prev, result, action);

  const visitAt = STREAK_VISIT_ACTION_TYPES.has(action.type) ? actionAt(action) : null;
  if (visitAt !== null) {
    result = touchProgressionVisit(result, visitAt);
  }

  result = withDerivedCounters(result);
  result = { ...result, milestones: detectNewlyEarnable(result.milestones, buildMilestoneContext(result)) };

  return result;
}

/**
 * The root reducer. Pure: never mutates the input state (structural
 * sharing throughout), never reads a clock or Math.random. Content
 * (tuning, registries) enters via the modules it delegates to, which all
 * default to content/ — the same single source the whole core uses.
 */
export function rootReducer(state: GameState, action: GameAction): GameState {
  const next = baseReducer(state, action);
  if (next === state) return next; // a true structural refusal — untouched
  return applyProgressionEffects(state, next, action);
}

function baseReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "TICK": {
      // Clock rollback safety: elapsed clamps to 0 and lastTickAt never
      // moves backwards (mirrors runCatchup's negative-elapsed rule).
      const elapsedMs = Math.max(0, action.at - state.lastTickAt);
      const hours = elapsedMs / HOUR_MS;
      const registry: SpeciesEvolutionRegistry = contentSpecies;
      // ROUND 2F (progression bible §3.2) — the Keep's building effects,
      // resolved ONCE for this dispatch (placements don't change mid-TICK):
      // comfort multiplies every pip's decay, restSpeedMultiplier speeds
      // Resting energy regen — both via effectiveRates' new fifth factor,
      // which is the identity on an unbuilt Keep (state.keep.placements
      // empty ⇒ keepEffects === IDENTITY_KEEP_EFFECTS in every observable
      // way), so this is byte-identical for every pre-2F save/fixture.
      const keepEffects = computeKeepEffects(state);
      const keepComfort = keepComfortFrom(keepEffects);
      const pips = mapPips(state, (pip) => {
        let next = applyNeedsDelta(pip, hours, contentTuning, keepComfort);
        // Live ticks are short; the mid-tick Pipling→Adult rate boundary
        // is negligible here (CATCHUP segments it exactly, spec §4.5).
        next = updateLifeStage(next, Math.max(action.at, state.lastTickAt));
        next = evaluateSulk(next);
        next = evaluateRestAutoWake(next);
        next = updateEvolutionReadiness(next, registry);
        return next;
      });
      let ticked: GameState = {
        ...state,
        pips,
        // Derived timers (spec §6.1/§7.2): due incubations flip to
        // Pipping (never hatch), due trips move to Returning with loot
        // rolled in chronological return order and reveals queued.
        eggs: settleDueEggs(state.eggs, action.at),
        lastTickAt: Math.max(state.lastTickAt, action.at),
      };
      // Gathering production (spec §6.2): every due tick since each
      // job's lastProducedAt, rolled chronologically from the "job"
      // stream; then prune jobs whose pip left AssignedJob (Sulking
      // entry above pulls a pip off its job for good, spec §4.4).
      ticked = processJobProduction(ticked, action.at);
      ticked = {
        ...ticked,
        jobs: reconcileJobs(ticked.jobs, ticked.pips, ticked.keep),
      };
      // ROUND 2C: mastery/streak/event loot bonus AND the mastery/event
      // egg-chance bonus, both resolved per returning pip (see
      // resolveLootBonusChanceFor / resolveEggChanceFor's doc comments for
      // the cursor-parity contract this preserves on a fresh save) — PLUS
      // round 2F's building/set contribution (same keepEffects) and the
      // Keep's incubation-speed multiplier for any egg a returning trip
      // finds.
      return processDueExpeditionReturns(ticked, action.at, {
        resolveLootBonusChance: (pip, expeditionId) =>
          resolveLootBonusChanceFor(ticked, pip, expeditionId, keepEffects),
        resolveEggChance: (pip, expeditionId) =>
          resolveEggChanceFor(ticked, pip, expeditionId, keepEffects),
        keepIncubationSpeedMultiplier: keepEffects.incubationSpeedMultiplier,
      });
    }

    case "SET_ACTIVE_PIP": {
      // Selection only (spec §10). Unknown pip or already active: same
      // state back (subscribers diffing references see no change).
      if (
        state.pips[action.pipId] === undefined ||
        state.activePipId === action.pipId
      ) {
        return state;
      }
      return { ...state, activePipId: action.pipId };
    }

    case "FEED":
      return applyCare(state, {
        action: "feed",
        pipId: action.pipId,
        foodId: action.foodId,
        at: action.at,
      });
    case "CLEAN":
      return applyCare(state, { action: "clean", pipId: action.pipId, at: action.at });
    case "PLAY":
      return applyCare(state, { action: "play", pipId: action.pipId, at: action.at });
    case "PET":
      return applyCare(state, { action: "pet", pipId: action.pipId, at: action.at });
    case "REST_TOGGLE":
      return applyCare(state, {
        action: "restToggle",
        pipId: action.pipId,
        at: action.at,
      });
    case "GIVE_ITEM":
      return applyCare(state, {
        action: "giveItem",
        pipId: action.pipId,
        itemId: action.itemId,
        at: action.at,
      });

    case "ASSIGN_EXPEDITION": {
      // ROUND 2F (progression bible §3.2): the Keep's building
      // expedition-speed multiplier, baked into the trip's `durationMs` at
      // send-off (never recomputed later — same rule as Hardworking's
      // quirk) via `effectiveExpeditionDurationMs`'s composition + floor.
      const keepEffects = computeKeepEffects(state);
      const { state: next, outcome } = assignExpedition(
        state,
        action.pipId,
        action.expeditionId,
        action.at,
        { keepSpeedMultiplier: keepEffects.expeditionSpeedMultiplier },
      );
      return { ...next, lastAssignOutcome: outcome };
    }

    case "ACKNOWLEDGE_REVEAL": {
      const reveal = state.pendingReveals[0];
      if (reveal === undefined) return state; // empty queue — nothing to see

      // ROUND 2C: a completed TRIP — not merely unlocking the biome —
      // grants a Field note for every species in ITS egg pool (bible
      // §1.1: "Trips, not unlocks. Reaching Keep level 3 does not tell
      // you what lives in the Grotto; going there does."). Same
      // structural pool lookup eggSpeciesPoolFor uses above, kept
      // separate here because this one wants the ids, not a filtered
      // GenomeSpeciesRegistry.
      const revealedPool =
        (
          contentExpeditions as Readonly<
            Record<string, { eggSpecies?: readonly string[] }>
          >
        )[reveal.expeditionId]?.eggSpecies ?? [];
      let pipdex = state.pipdex;
      for (const speciesId of revealedPool) {
        pipdex = markPipdexSeen(pipdex, speciesId, action.at, reveal.expeditionId);
      }

      let next: GameState = {
        ...state,
        pendingReveals: state.pendingReveals.slice(1),
        pipdex,
      };

      // Route items (spec §6.3): foods (feedable/giftable) go to the
      // inventory; everything else is a resource. Membership in the food
      // registry is the routing rule — berries are food first.
      const foodRegistry: Readonly<Record<string, unknown>> = contentFoods;
      const items: Record<string, number> = {};
      const resources: Record<string, number> = {};
      for (const itemId of reveal.items) {
        const bucket = foodRegistry[itemId] !== undefined ? items : resources;
        bucket[itemId] = (bucket[itemId] ?? 0) + 1;
      }
      next = {
        ...next,
        inventory: mergeCounts(next.inventory, items),
        resources: mergeCounts(next.resources, resources),
      };

      // The egg leaves the reveal and starts incubating NOW — the
      // acknowledge tap is the player placing it in the Keep (spec §7.2
      // Found → Incubating; its derived timer runs from this moment).
      if (reveal.egg !== null) {
        next = {
          ...next,
          eggs: [...next.eggs, beginIncubation(reveal.egg, action.at)],
        };
      }

      // A live return waits in Returning until this acknowledge; landing
      // converts a deferred pendingSulk to Sulking (spec §4.4). Offline
      // returns already landed during catch-up — arriveHome is simply
      // not legal then and the pip is left as-is.
      const pip = next.pips[reveal.pipId];
      if (
        pip !== undefined &&
        pip.activity === PipActivity.Returning &&
        pip.expedition?.expeditionId === reveal.expeditionId
      ) {
        const home = arriveHome(pip);
        if (home.ok) {
          next = { ...next, pips: { ...next.pips, [pip.id]: home.pip } };
        }
      }
      return next;
    }

    case "HATCH_EGG": {
      const refuse = (
        reason: "unknownEgg" | "notPipping" | "rosterFull",
        message?: string,
      ): GameState => ({
        ...state,
        lastHatchOutcome: {
          ok: false,
          eggId: action.eggId,
          at: action.at,
          reason,
          ...(message !== undefined ? { message } : {}),
        },
      });

      const egg = state.eggs.find((e) => e.id === action.eggId);
      if (egg === undefined) return refuse("unknownEgg");
      // Pipping WAITS for the player and ONLY Pipping hatches — an
      // Incubating egg's tap does nothing hatch-like (spec §7.2).
      if (egg.state !== EggState.Pipping) return refuse("notPipping");
      // Roster cap (spec §7.4): 3 base, 5 once the roster upgrade is
      // owned. Friendly refusal, egg untouched — it stays Pipping and
      // never expires, however long it waits. The pre-upgrade message
      // carries the upgrade nudge; the post-upgrade one just reassures.
      const rosterCap = rosterCapFor(state);
      if (state.rosterOrder.length >= rosterCap) {
        return refuse(
          "rosterFull",
          state.rosterUpgradePurchased
            ? rosterFullMaxMessage(rosterCap)
            : ROSTER_FULL_MESSAGE,
        );
      }

      // ROUND 2C — EGG PITY (docs/retention-bible.md §7): a per-biome
      // counter of hatches that missed the pool's rarest tier. At
      // threshold, THIS hatch is guaranteed that tier — the species
      // registry handed to rollGenome narrows further (to the rarest-tier
      // subset, kindness-tiebreaking toward not-yet-caught), which costs
      // ZERO extra rolls (rollGenome always consumes exactly 5 — see
      // progression/pity.ts's module doc) so the cursor contract holds
      // exactly like the biome-pool patch above.
      const pityBiomeId = egg.sourceExpeditionId;
      const pityPool = pityBiomeId !== null ? pitySpeciesPoolFor(pityBiomeId) : [];
      const pityRarestTier = rarestTierInPool(pityPool);
      const pityBaseThreshold = pityThresholdFor(pityPool, contentTuning);
      const pityThreshold =
        pityBiomeId !== null
          ? eventAdjustedPityThreshold(
              pityBaseThreshold,
              pityBiomeId,
              state.activeEvents,
              contentTuning,
            )
          : pityBaseThreshold;
      const pityCounterBefore = pityBiomeId !== null ? (state.eggPity[pityBiomeId] ?? 0) : 0;
      const pityGuaranteed =
        pityBiomeId !== null && isPityGuaranteed(pityCounterBefore, pityThreshold);

      // Genome from the "egg" stream (spec §7.2/§7.3): species weighted
      // by registry rarity; palette/pattern/personality random. The
      // cursor advance persists in rngState — a reload never re-rolls.
      // ROUND 2B: the pool narrows to the biome the egg was found in
      // (egg.sourceExpeditionId → content/expeditions.ts's eggSpecies),
      // when the content declares one — see eggSpeciesPoolFor's doc
      // comment for the RNG-cursor-parity guarantee this relies on.
      const rng = createRngFromState(state.seed, state.rngState);
      let speciesPool = eggSpeciesPoolFor(egg.sourceExpeditionId);
      if (pityGuaranteed && pityRarestTier !== null) {
        const guaranteedEntries = guaranteedDrawPool(
          pityPool,
          pityRarestTier,
          (speciesId) => state.pipdex.entries[speciesId]?.caughtAt !== null,
        );
        const guaranteedRegistry: Record<string, GenomeSpeciesEntry> = {};
        for (const entry of guaranteedEntries) {
          const full = contentSpecies[entry.id];
          if (full !== undefined) guaranteedRegistry[entry.id] = full;
        }
        if (Object.keys(guaranteedRegistry).length > 0) {
          speciesPool = guaranteedRegistry;
        }
      }
      const genome = rollGenome(
        rng.stream(EGG_STREAM),
        speciesPool !== undefined ? { species: speciesPool } : {},
      );
      const pipId: PipId = `pip-${state.nextPipNumber}`;
      const pipling = createPipFromGenome(genome, {
        id: pipId,
        name: contentSpecies[genome.speciesId]?.name ?? genome.speciesId,
        hatchedAt: action.at,
        lifeStage: LifeStage.Pipling,
      });

      const hatchedRarity = contentSpecies[genome.speciesId]?.rarity ?? "common";
      const eggPity =
        pityBiomeId !== null
          ? {
              ...state.eggPity,
              [pityBiomeId]: updatePityCounter(
                pityCounterBefore,
                hatchedRarity,
                pityRarestTier,
              ),
            }
          : state.eggPity;

      // ROUND 2C: a hatch is a Portrait-tier Album catch (bible §1.1).
      const pipdex = markPipdexCaught(state.pipdex, pipling.speciesId, action.at, {
        pipId: pipling.id,
        name: pipling.name,
        genome: pipling.genome,
        personalityId: pipling.personalityId,
        lifeStageAtCatch: pipling.lifeStage,
        sourceExpeditionId: egg.sourceExpeditionId,
      });

      return {
        ...state,
        pips: { ...state.pips, [pipId]: pipling },
        rosterOrder: [...state.rosterOrder, pipId],
        // Hatched is terminal (spec §7.2) — the egg leaves the state;
        // the outcome below carries the moment for the UI.
        eggs: state.eggs.filter((e) => e.id !== egg.id),
        nextPipNumber: state.nextPipNumber + 1,
        rngState: rng.getState(),
        lastHatchOutcome: { ok: true, eggId: egg.id, pipId, at: action.at },
        pipdex,
        eggPity,
      };
    }

    case "CATCHUP": {
      // Adapt the Record-keyed roster to the catch-up engine's array view
      // and back, preserving roster order (catchup.ts owns all §4.5 rules).
      const list = state.rosterOrder
        .map((id) => state.pips[id])
        .filter((pip): pip is PipState => pip !== undefined);
      // Heal any incubation already due at the window start (the live
      // loop would have flipped it) — mirror of the engine's own
      // start-of-pass normalization.
      const eggsAtStart = settleDueEggs(state.eggs, action.savedAt);
      // The adapter carries eggs AND jobs through the pass: egg
      // completions register through the engine's custom-event seam
      // ({kind:"custom", tag:"eggReady"}) and fire regardless of the
      // rate cap (timers are never capped, §4.5); job production ticks
      // register as {tag:"jobTick"} events CAPPED at the first 12h —
      // production is a rate (§4.5 rule 3/§6.2). Each fired jobTick
      // lands in `firedJobTicks` iff its pip was still working.
      type CatchupAdapter = EggCatchupState & JobCatchupState;
      const adapter: CatchupAdapter = {
        pips: list,
        eggs: eggsAtStart,
        jobs: state.jobs,
        firedJobTicks: [] as readonly JobTick[],
      };
      // ROUND 2F (progression bible §3.2) — same building-effects
      // resolution as the live TICK path, computed once against
      // `state.keep` (placements are frozen for the whole pass) and
      // threaded into the engine so an offline absence decays/rests at the
      // SAME effective rate a live tick would have.
      const keepEffects = computeKeepEffects(state);
      const keepComfort = keepComfortFrom(keepEffects);
      const result = runCatchup(
        adapter,
        action.savedAt,
        action.now,
        contentTuning,
        (s, windowStart, windowEnd) => [
          ...collectEggCatchupEvents(s, windowStart, windowEnd),
          ...collectJobCatchupEvents(s, windowStart, windowEnd),
        ],
        keepComfort,
      );
      const pips: Record<PipId, PipState> = { ...state.pips };
      for (const pip of result.state.pips) {
        pips[pip.id] = pip;
      }
      let next: GameState = {
        ...state,
        pips,
        eggs: result.state.eggs,
        jobs: result.state.jobs,
        lastTickAt: Math.max(state.lastTickAt, action.now),
        lastCatchup: result.summary,
      };
      // Roll the production that actually fired, in fired (chronological)
      // order — the same order the live path uses, so the "job" cursor
      // advances identically (spec §2 rule 3). Then slide surviving jobs
      // past the rate-frozen tail (production must not backfill it on
      // the next live tick) and prune jobs whose pip stopped working.
      next = settleJobTicks(next, result.state.firedJobTicks);
      next = {
        ...next,
        jobs: reconcileJobs(
          shiftJobsPastFreeze(
            next.jobs,
            result.summary.elapsedMs - result.summary.ratedMs,
          ),
          next.pips,
          next.keep,
        ),
      };
      // Loot for returns that fired during the pass, rolled AFTER the
      // pass in summary-event order — which is chronological across ALL
      // pips, so the "expedition-loot" cursor advances in true return
      // order regardless of assignment order (spec §2 rule 3; the
      // engine's events are the timeline, the rolls are time-free).
      // Reveals queue for the load-time "While you were away…" flow.
      for (const event of result.summary.events) {
        if (event.kind === "expeditionReturn") {
          // ROUND 2C: same per-pip mastery/streak/event bonus resolution
          // as the live TICK path, computed against `next` (the state as
          // of just before THIS trip settles) — consistent with the live
          // path reading each pip's mastery BEFORE that trip's own
          // increment (applied later, at ACKNOWLEDGE_REVEAL).
          const returningPip = next.pips[event.pipId];
          next = settleExpeditionReturn(next, event.pipId, event.expedition, event.at, {
            effectiveLootBonusChance:
              returningPip !== undefined
                ? resolveLootBonusChanceFor(
                    next,
                    returningPip,
                    event.expedition.expeditionId,
                    keepEffects,
                  )
                : undefined,
            effectiveEggChance:
              returningPip !== undefined
                ? resolveEggChanceFor(
                    next,
                    returningPip,
                    event.expedition.expeditionId,
                    keepEffects,
                  )
                : undefined,
            keepIncubationSpeedMultiplier: keepEffects.incubationSpeedMultiplier,
          });
        }
      }
      return next;
    }

    case "PLACE_ITEM": {
      // Ids are minted here (`place-<n>`), so core/keep never guesses.
      // Refusals (typed in core/keep) return the state unchanged — the
      // UI pre-validates with the same pure function (see module doc).
      const placementId = `place-${state.nextPlacementNumber}`;
      const result = placeItem(
        state.keep,
        placementId,
        action.itemId,
        action.x,
        action.y,
      );
      if (!result.ok) return state;

      // THE KEEPSAKE SHELF (docs/retention-bible.md §11.2, progression
      // bible §5.4 — and Keep tier 1's own advertised unlock).
      //
      // ROUND 2F INTEGRATE — THE FOURTH DEAD FEATURE, CLOSED. `state.
      // keepsakes` has been WRITTEN since round 2C (by `CLAIM_MILESTONE`'s
      // keepsake reward and by `RESOLVE_STREAK_CHOICE`'s day-5 pick) and
      // READ BY NOTHING: no surface listed it, and this arm charged full
      // resources for a decoration the player had already been given. A
      // day-5 streak player chose from three offers and received,
      // observably, nothing. `Placement.granted` — the flag this file's own
      // `keepsakes` doc comment describes as closing the free-decoration
      // resource-printer exploit — existed in the type and the save format
      // and was never once set.
      //
      // A granted copy is spent FIRST and costs nothing; only when the
      // shelf is empty does the resource spend happen. That ordering is
      // what makes a keepsake feel like a gift instead of a rebate.
      const keepsakeCount = state.keepsakes[action.itemId] ?? 0;
      if (keepsakeCount > 0) {
        const placement = result.keep.placements[placementId];
        const remaining = keepsakeCount - 1;
        const keepsakes = { ...state.keepsakes };
        if (remaining > 0) keepsakes[action.itemId] = remaining;
        else delete keepsakes[action.itemId];
        return {
          ...state,
          keep:
            placement === undefined
              ? result.keep
              : {
                  ...result.keep,
                  placements: {
                    ...result.keep.placements,
                    // `granted` is what tells REMOVE_ITEM to hand the
                    // keepsake BACK to the shelf rather than pay out its
                    // resource cost — place → tuck away → place must never
                    // print materials the player never spent.
                    [placementId]: { ...placement, granted: true },
                  },
                },
          keepsakes,
          nextPlacementNumber: state.nextPlacementNumber + 1,
        };
      }

      // Placing a NEW item buys it (spec §6.3): all-or-nothing spend of
      // the content-defined cost. Short = refused, state unchanged (the
      // Build sheet greys unaffordable cards with the same canAfford).
      const paid = spend(state.resources, PLACEMENT_ITEM_COSTS[action.itemId] ?? {});
      if (!paid.ok) return state;
      return {
        ...state,
        keep: result.keep,
        resources: paid.resources,
        nextPlacementNumber: state.nextPlacementNumber + 1,
      };
    }

    case "MOVE_ITEM": {
      const result = moveItem(state.keep, action.placementId, action.x, action.y);
      if (!result.ok) return state;
      // A station keeps its workers when moved — jobs reference the
      // placement id, not the tiles.
      return { ...state, keep: result.keep };
    }

    case "REMOVE_ITEM": {
      const removed = state.keep.placements[action.placementId];
      const result = removeItem(state.keep, action.placementId);
      if (!result.ok || removed === undefined) return state;
      // Full refund of the content cost (the inverse of PLACE_ITEM's
      // spend): "Tuck away" never destroys value — there is no stored-
      // items inventory in MVP, so the materials come back instead.
      //
      // …UNLESS it was a keepsake (`granted`), in which case it goes back
      // on the shelf it came from, still free and still re-placeable. This
      // is the half of the Keepsake Shelf that keeps the economy honest:
      // refunding resources for a decoration the player never bought would
      // turn every gift into a resource printer (the exploit `state.
      // keepsakes`'s own doc comment named, and which nothing implemented
      // until this round's integrate pass).
      let next: GameState = removed.granted === true
        ? {
            ...state,
            keep: result.keep,
            keepsakes: {
              ...state.keepsakes,
              [removed.itemId]: (state.keepsakes[removed.itemId] ?? 0) + 1,
            },
          }
        : {
            ...state,
            keep: result.keep,
            resources: mergeCounts(
              state.resources,
              bundleToCounts(PLACEMENT_ITEM_COSTS[removed.itemId]),
            ),
          };
      // A job cannot outlive its station (spec §6.2): unassign any pip
      // working at the removed placement back to Idle.
      for (const [pipId, job] of Object.entries(state.jobs)) {
        if (job.stationPlacementId !== action.placementId) continue;
        const unassigned = unassignPipFromJob(next, pipId);
        next = unassigned.state;
      }
      // Defensive sweep for entries unassign could not heal (pip gone).
      return { ...next, jobs: reconcileJobs(next.jobs, next.pips, next.keep) };
    }

    case "PURCHASE_KEEP_LEVEL": {
      // Buy the NEXT level (spec §6.3 costs, §9 gates). Refusals — no
      // next level defined, XP gate not cleared, or short on resources —
      // leave the state unchanged by reference (spend never goes
      // negative, economy/).
      const nextLevel = state.keep.level + 1;
      const def = contentKeepLevels.find((level) => level.level === nextLevel);
      if (def === undefined) return state;
      // ROUND 2F (progression bible §1.2) — TWO keys, not one: a tier is
      // "earned" with XP and "paid for" with resources. Six of eleven
      // tiers cost nothing at all, so this gate is the only one they
      // have — and it is the same gate every priced tier ALSO clears.
      // Never a countdown: a ready tier waits forever (bible §0.3), so
      // this is a plain threshold check, nothing time-based.
      if (!isNextTierXpReady(state.keepXp, state.keep.level, contentTuning)) {
        return state;
      }
      const paid = spend(state.resources, def.cost);
      if (!paid.ok) return state;
      return {
        ...state,
        resources: paid.resources,
        // Raising the level IS the unlock: expedition gating reads
        // keep.level (Forest at 2, Snowdrift at 3, Shore at 4, the
        // Lanterngrotto at 5 — spec §6.1/§9), and the grid grows via
        // gridBounds(level) with no data migration.
        keep: { ...state.keep, level: nextLevel },
        // The player-witnessed tier-up moment (bible §1.2/§6.3): the UI's
        // celebration banner animates from this, never from an offline
        // tick — PURCHASE_KEEP_LEVEL only ever fires on a tap.
        lastLevelUp: { at: action.at, fromLevel: state.keep.level, toLevel: nextLevel },
      };
    }

    case "PURCHASE_ROSTER_UPGRADE": {
      // Spec §7.4/§9: purchasable once (level 3 prerequisite from
      // content), raises the HATCH_EGG cap 3 → 5 via the flag.
      if (state.rosterUpgradePurchased) return state;
      const upgrade = keepUpgrades[ROSTER_UPGRADE_ID];
      if (upgrade === undefined) return state;
      if (state.keep.level < upgrade.prerequisiteLevel) return state;
      const paid = spend(state.resources, upgrade.cost);
      if (!paid.ok) return state;
      return {
        ...state,
        resources: paid.resources,
        rosterUpgradePurchased: true,
      };
    }

    case "ASSIGN_JOB": {
      const { state: next, outcome } = assignPipToJob(
        state,
        action.pipId,
        action.stationPlacementId,
        action.at,
      );
      return { ...next, lastJobOutcome: outcome };
    }

    case "UNASSIGN_JOB": {
      const { state: next, outcome } = unassignPipFromJob(state, action.pipId);
      return { ...next, lastJobOutcome: outcome };
    }

    case "EVOLVE_PIP": {
      // The player-witnessed evolution tap (spec §4.6). This arm is the
      // ONLY call site of applyEvolution in the repo — TICK/CATCHUP set
      // readyToEvolve but never apply (grep-proof by design).
      const refuse = (
        reason: "unknownPip" | EvolveRefusalReason,
      ): GameState => ({
        ...state,
        lastEvolveOutcome: {
          ok: false,
          pipId: action.pipId,
          at: action.at,
          reason,
        },
      });

      const pip = state.pips[action.pipId];
      if (pip === undefined) return refuse("unknownPip");
      const registry: SpeciesEvolutionRegistry = contentSpecies;
      const evolved = applyEvolution(pip, registry, action.at);
      if (!evolved.ok) return refuse(evolved.reason);

      // ROUND 2C: the evolved (lineage) species is caught under its OWN
      // entry (bible §1.1 — genome/personality/life-stage carry over,
      // since evolution keeps the birth genome; no source expedition —
      // evolution is earned through care, not a trip). The gift-variant
      // leaf lands on the BASE species' page, where the ribbon lives
      // (bible §1.3.6).
      const portrait: PipdexPortrait = {
        pipId: pip.id,
        name: pip.name,
        genome: pip.genome,
        personalityId: pip.personalityId,
        lifeStageAtCatch: pip.lifeStage,
        sourceExpeditionId: null,
      };
      const pipdex = markPipdexVariantCaught(
        markPipdexCaught(state.pipdex, evolved.result.targetSpeciesId, action.at, portrait),
        pip.speciesId,
        evolved.result.variantId,
        action.at,
      );

      return {
        ...state,
        pips: { ...state.pips, [pip.id]: evolved.pip },
        pipdex,
        lastEvolveOutcome: {
          ok: true,
          pipId: pip.id,
          at: action.at,
          fromSpeciesId: pip.speciesId,
          toSpeciesId: evolved.result.targetSpeciesId,
          variantId: evolved.result.variantId,
        },
      };
    }

    case "ONBOARDING_ADVANCE": {
      // Forward-only (module doc on ONBOARDING_STEPS): a backwards or
      // same-step advance returns the state unchanged by reference, so
      // completion is sticky and replays are harmless.
      const from = ONBOARDING_STEPS.indexOf(state.onboarding.step);
      const to = ONBOARDING_STEPS.indexOf(action.step);
      if (to <= from) return state;
      return {
        ...state,
        onboarding: { completed: action.step === "done", step: action.step },
      };
    }

    case "DEBUG_GRANT": {
      return {
        ...state,
        inventory: mergeCounts(state.inventory, action.items),
        resources: mergeCounts(state.resources, action.resources),
      };
    }

    case "DEBUG_SPAWN_EGG": {
      // Straight to Incubating at `at` (skipping the reveal queue — this
      // is the QA seam, spec §14): time-skip past the incubation, watch
      // it pip, tap to hatch.
      //
      // HONOURS THE KEEP'S incubationSpeed, like both player paths do. It did
      // not, so a debug-spawned egg on a Nest-Warmer-built Keep snapshotted
      // the unbuilt 2h duration and the effect looked DEAD to whoever was
      // hand-checking it — and the debug menu is precisely how a QA pass would
      // check it. A seam that lies about a shipped effect is worse than no
      // seam (spec §16 v1.3's standing rule, applied to the QA surface).
      const egg = beginIncubation(
        createEgg(
          {
            id: `egg-${state.nextEggNumber}`,
            foundAt: action.at,
            sourceExpeditionId: null,
          },
          contentTuning,
          computeKeepEffects(state).incubationSpeedMultiplier,
        ),
        action.at,
      );
      return {
        ...state,
        eggs: [...state.eggs, egg],
        nextEggNumber: state.nextEggNumber + 1,
      };
    }

    case "LOAD_SAVE": {
      // Replace everything; drop the transient UI echoes so subscribers
      // diffing them don't replay stale moments.
      return {
        ...action.state,
        lastCareOutcome: null,
        lastCatchup: null,
        lastAssignOutcome: null,
        lastHatchOutcome: null,
        lastJobOutcome: null,
        lastEvolveOutcome: null,
        lastSanctuaryOutcome: null,
        lastLevelUp: null,
      };
    }

    case "RETIRE_PIP": {
      // ROUND 2C — "Send to the Long Meadow" (docs/retention-bible.md
      // §2.3). A working pip is auto-unassigned FIRST — the same
      // separation of concerns REMOVE_ITEM uses (core/keep's own
      // functions never touch jobs; the reducer composes both) — then
      // core/sanctuary owns legality + the one-place invariant.
      let working: GameState = state;
      if (state.jobs[action.pipId] !== undefined) {
        working = unassignPipFromJob(working, action.pipId).state;
      }
      const { state: retired, outcome } = retireToSanctuary(
        working,
        action.pipId,
        action.at,
      );
      return { ...retired, lastSanctuaryOutcome: outcome };
    }

    case "RETRIEVE_PIP": {
      // ROUND 2C — "Ask them home" (docs/retention-bible.md §2.5). Free;
      // gated only by minStayMs and the roster cap (core/sanctuary owns
      // both refusals).
      const rosterCap = rosterCapFor(state);
      const { state: retrieved, outcome } = retrieveFromSanctuary(
        state,
        action.pipId,
        action.at,
        rosterCap,
      );
      return { ...retrieved, lastSanctuaryOutcome: outcome };
    }

    case "SET_DAY_OFFSET": {
      // ROUND 2C (docs/retention-bible.md §3.1): the app layer's
      // recomputed local-04:00 boundary. A no-op at the identical value
      // keeps dispatching this harmless on every boot/visibilitychange.
      if (state.dayOffsetMs === action.offsetMs) return state;
      return { ...state, dayOffsetMs: action.offsetMs };
    }

    case "SET_ACTIVE_EVENTS": {
      // ROUND 2C (bible §8.3): the app layer's resolved active-event id
      // list. A stale list can only ever have granted a bonus, never
      // taken one — this is a plain data swap, no legality to check.
      if (
        state.activeEvents.length === action.ids.length &&
        state.activeEvents.every((id, i) => id === action.ids[i])
      ) {
        return state;
      }
      return { ...state, activeEvents: action.ids };
    }

    case "REFRESH_BOUNTIES": {
      const today = streakDayIndex(action.at, state.dayOffsetMs, contentTuning.retention.dayMs);
      const bountyContext = buildBountyContext(state);
      const ensured = ensureBountiesForDay(
        state.bounties,
        state.seed,
        today,
        bountyContext,
        contentTuning,
      );
      const bounties = replaceStaleBounties(ensured, bountyContext, contentTuning);
      return bounties === state.bounties ? state : { ...state, bounties };
    }

    case "CLAIM_STREAK_REWARD": {
      // Idempotent: a day already banked (or nothing to bank yet, e.g. a
      // fresh save with current === 0) is a no-op.
      if (state.streak.current === 0 || state.streak.rewardedForDay === state.streak.current) {
        return state;
      }
      const decorationIds = contentDecorations.map((d) => d.id);
      const ladderContent = {
        keepLevel: state.keep.level,
        keepsakeOffers: pickKeepsakeOffers(state.seed, state.streak.current, decorationIds),
        unlockedExpeditionIds: unlockedExpeditionIdsAt(state.keep.level),
      };
      const reward = resolveLadderReward(state.streak.current, contentTuning, ladderContent);
      if (reward.kind === "grant") {
        return {
          ...state,
          inventory: mergeCounts(state.inventory, reward.items),
          resources: mergeCounts(state.resources, reward.resources),
          streak: { ...state.streak, rewardedForDay: state.streak.current },
        };
      }
      const choice: StreakChoice = {
        kind: reward.kind === "keepsakeChoice" ? "keepsake" : "basketEgg",
        offers: reward.offers,
        forDay: state.streak.current,
      };
      return {
        ...state,
        streak: {
          ...state.streak,
          rewardedForDay: state.streak.current,
          pendingChoices: [...state.streak.pendingChoices, choice],
        },
      };
    }

    case "CLAIM_MILESTONE": {
      // ROUND 2C (bible §4): idempotent grant — claimMilestone itself
      // refuses (state unchanged, no reward) an already-earned or
      // not-yet-met id.
      const result = claimMilestone(
        state.milestones,
        action.id,
        action.at,
        buildMilestoneContext(state),
        contentMilestones,
      );
      if (!result.ok || result.reward === undefined) {
        return result.state === state.milestones ? state : { ...state, milestones: result.state };
      }
      let next: GameState = { ...state, milestones: result.state };
      switch (result.reward.kind) {
        case "resources":
          next = { ...next, resources: mergeCounts(next.resources, result.reward.bundle) };
          break;
        case "items":
          next = { ...next, inventory: mergeCounts(next.inventory, result.reward.items) };
          break;
        case "keepsake":
          next = {
            ...next,
            keepsakes: mergeCounts(next.keepsakes, { [result.reward.decorationId]: 1 }),
          };
          break;
        case "flair":
          // Flair IS presentational — but "presentational" is not the same
          // as "not granted" (spec v1.3's standing rule: written-to-state
          // and visible-to-the-player are separate acceptance criteria).
          // Recording it here is what lets `content/flair.ts`'s renderers
          // draw it, and it is forward-only: `mergeFlair` never overwrites
          // an earlier earnedAt and nothing anywhere removes an entry.
          next = { ...next, flair: grantFlair(next.flair, result.reward.flairId, action.at) };
          break;
        case "none":
          break; // genuinely nothing to grant — a warm feeling, mostly
      }
      return next;
    }

    case "REROLL_BOUNTY": {
      // ROUND 2C (bible §5.4): free, budgeted reroll. A spent budget or
      // an unknown slot is a no-op (rerollBountySlot itself returns the
      // input by reference).
      const bounties = rerollBountySlot(
        state.bounties,
        action.slot,
        state.seed,
        buildBountyContext(state),
        contentTuning,
        contentBountyTemplates,
      );
      return bounties === state.bounties ? state : { ...state, bounties };
    }

    case "RESOLVE_STREAK_CHOICE": {
      // ROUND 2C (bible §3.3/§5.6): the day-5 keepsake pick, and the
      // day-7/bounty-day-clear egg pick — both wait forever
      // (§0.2) and both resolve through this one action.
      const index = state.streak.pendingChoices.findIndex(
        (choice) => choice.kind === action.kind && choice.forDay === action.forDay,
      );
      if (index === -1) return state; // already resolved, or never existed
      const choice = state.streak.pendingChoices[index] as StreakChoice;
      const picked = choice.offers[action.choiceIndex];
      if (picked === undefined) return state; // out-of-range pick — refuse quietly

      const remainingChoices = state.streak.pendingChoices.filter((_, i) => i !== index);
      let next: GameState = {
        ...state,
        streak: { ...state.streak, pendingChoices: remainingChoices },
      };

      if (choice.kind === "keepsake") {
        next = { ...next, keepsakes: mergeCounts(next.keepsakes, { [picked]: 1 }) };
        return next;
      }

      // basketEgg / bountyEgg: drop a Found egg straight into incubation
      // for the chosen biome — the same "appears in the Keep, already
      // incubating" shape DEBUG_SPAWN_EGG uses (spec §14), except this one
      // carries a real `sourceExpeditionId` so it feeds that biome's Album
      // knowledge and pity counter normally (bible §7.3: "no special
      // case").
      const egg = beginIncubation(
        createEgg({
          id: `egg-${next.nextEggNumber}`,
          foundAt: action.at,
          sourceExpeditionId: picked,
        }),
        action.at,
      );
      return {
        ...next,
        eggs: [...next.eggs, egg],
        nextEggNumber: next.nextEggNumber + 1,
      };
    }
  }
}

/** A cost bundle as a plain count record for `mergeCounts` (drops the
 * `undefined`/zero entries a Partial bundle may carry). */
function bundleToCounts(
  bundle: ResourceBundle | undefined,
): Readonly<Record<string, number>> | undefined {
  if (bundle === undefined) return undefined;
  const out: Record<string, number> = {};
  for (const [id, amount] of Object.entries(bundle)) {
    if (amount !== undefined && amount > 0) out[id] = amount;
  }
  return out;
}

/**
 * Record an earned flourish (bible §4.3). Forward-only by construction: an
 * id already present keeps its ORIGINAL `earnedAt` (so a re-grant can never
 * rewrite history) and nothing in the codebase ever deletes a key — which is
 * what makes `flair` safe under §0.1's "a break costs a bonus, full stop".
 */
function grantFlair(
  flair: Readonly<Record<string, number>>,
  flairId: string,
  at: number,
): Readonly<Record<string, number>> {
  if (flair[flairId] !== undefined) return flair;
  return { ...flair, [flairId]: at };
}

/** Additive merge of count records (DEBUG_GRANT). Never mutates. */
function mergeCounts(
  base: Readonly<Record<string, number>>,
  delta: Readonly<Record<string, number>> | undefined,
): Readonly<Record<string, number>> {
  if (delta === undefined) return base;
  const out: Record<string, number> = { ...base };
  for (const [id, count] of Object.entries(delta)) {
    out[id] = (out[id] ?? 0) + count;
  }
  return out;
}

/** Care delegation: performCare owns effects/refusals/dialogue; the
 * outcome is parked in `lastCareOutcome` for the UI. */
function applyCare(
  state: GameState,
  request: Parameters<typeof performCare<GameState>>[1],
): GameState {
  const { state: next, outcome } = performCare(state, request);
  return { ...next, lastCareOutcome: outcome };
}

export type { CareAction };
