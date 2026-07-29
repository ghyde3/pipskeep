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
 * - DEBUG_GRANT / DEBUG_SPAWN_EGG / LOAD_SAVE — the debug menu's seams
 *   (spec §14): additive item/resource grants, an instantly-incubating
 *   QA egg, and wholesale replacement with a migrated, validated save
 *   (import). All pure; all plain data in, data out.
 */

import { HOUR_MS, tuning as contentTuning } from "../content/tuning";
import { PERSONALITY_IDS } from "../content/personalities";
import { species as contentSpecies } from "../content/species";
import { foods as contentFoods } from "../content/foods";
import { ROSTER_FULL_MESSAGE } from "../content/eggs";
import { createRng, createRngFromState } from "./rng";
import { LifeStage, PipActivity } from "./pips/types";
import type { PipId, PipNeeds, PipState, TraitGenome } from "./pips/types";
import { applyNeedsDelta } from "./pips/needs";
import {
  arriveHome,
  evaluateRestAutoWake,
  evaluateSulk,
} from "./pips/machine";
import {
  updateEvolutionReadiness,
  updateLifeStage,
} from "./pips/lifecycle";
import type { SpeciesEvolutionRegistry } from "./pips/lifecycle";
import { runCatchup } from "./pips/catchup";
import type { CatchupSummary } from "./pips/catchup";
import { performCare } from "./pips/care";
import type { CareAction, CareOutcome, CooldownsByPip } from "./pips/care";
import type { LastLineIndexByPip } from "./pips/dialogue";
import { createPipFromGenome, rollGenome } from "./pips/genome";
import {
  EGG_STREAM,
  EggState,
  beginIncubation,
  collectEggCatchupEvents,
  createEgg,
  settleDueEggs,
} from "./eggs";
import type { Egg, HatchOutcome } from "./eggs";
import {
  assignExpedition,
  processDueExpeditionReturns,
  settleExpeditionReturn,
} from "./expeditions";
import type { AssignExpeditionOutcome, PendingReveal } from "./expeditions";

/** Genesis stream (starter rolls at createNewGame). Its cursor persists
 * in `rngState` like every other stream (spec §2 rule 3). */
export const GENESIS_STREAM = "genesis";

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
  /** Keep level (spec §9): 1 = start, 2 unlocks Forest, 3 unlocks Shore.
   * Phase 5 owns raising it; expeditions gate on it now (spec §6.1). */
  readonly keepLevel: number;
  /** Eggs in the Keep (Incubating/Pipping — spec §7.2). Found eggs live
   * inside `pendingReveals` until acknowledged; hatched eggs are
   * removed. Eggs NEVER expire (spec §7.4). */
  readonly eggs: readonly Egg[];
  /** Completed trips awaiting their loot-reveal moment (spec §6.1).
   * ACKNOWLEDGE_REVEAL consumes the head — nothing enters inventory,
   * resources, or `eggs` until the player has seen it. */
  readonly pendingReveals: readonly PendingReveal[];
  /** Deterministic id counters (`pip-<n>` / `egg-<n>`). */
  readonly nextPipNumber: number;
  readonly nextEggNumber: number;
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
}

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
  /** Debug-menu grant (spec §14, dev builds only): additively merges item
   * and resource counts. Pure like everything else — the "debug" prefix
   * marks intent (QA seeding), not impurity. */
  | {
      readonly type: "DEBUG_GRANT";
      readonly items?: Readonly<Record<string, number>>;
      readonly resources?: Readonly<Record<string, number>>;
    }
  /** Debug-menu egg spawn (spec §14, dev builds only): drops an egg
   * straight into the Keep, already Incubating at `at` — pair with the
   * time-skip buttons to QA the full Pipping → hatch flow. Pure. */
  | { readonly type: "DEBUG_SPAWN_EGG"; readonly at: number }
  /** Wholesale state replacement from a validated save (debug-menu import,
   * spec §8/§14). `state` MUST come out of `migrate()` — the reducer
   * trusts it. Transient UI echoes are nulled so the swap does not replay
   * a stale care animation; callers follow up with CATCHUP over
   * `savedAt → now`, exactly like boot. */
  | { readonly type: "LOAD_SAVE"; readonly state: GameState };

/**
 * Starter hunger (spec §10.1: "Hunger bar is visibly at ~60" so the
 * guided first Feed lands). An onboarding-structural value, not a
 * balancing tunable — it exists to make step 3 of the first 90 seconds
 * work, which is why it lives here and not in content/tuning.ts.
 */
export const STARTER_HUNGER = 60;

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

/**
 * A brand-new save (spec §10.1, §6.3): one starter mosspip with a random
 * personality plus 3 Berries for the guided first Feed.
 *
 * Genesis rolls, in fixed order (cursor determinism — same seed, same
 * starter): personality, palette, pattern — all from the `"genesis"`
 * stream, whose advanced cursor is captured in `rngState`.
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
): GameState {
  const rng = createRng(seed);
  const genesis = rng.stream(GENESIS_STREAM);
  const personalityId = genesis.pick(content.personalityIds);
  const palette = genesis.pick(content.palettes);
  const pattern = genesis.pick(content.patterns);

  const genome: TraitGenome = {
    speciesId: content.speciesId,
    palette,
    pattern,
    accessorySlots: content.accessorySlots,
    personalityId,
  };

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

  return {
    pips: { [starterId]: starter },
    rosterOrder: [starterId],
    activePipId: starterId,
    inventory: { ...content.startingInventory },
    resources: {},
    rngState: rng.getState(),
    seed,
    keepLevel: 1,
    eggs: [],
    pendingReveals: [],
    nextPipNumber: 2,
    nextEggNumber: 1,
    cooldowns: {},
    lastLineIndex: {},
    createdAt: now,
    lastTickAt: now,
    lastCareOutcome: null,
    lastCatchup: null,
    lastAssignOutcome: null,
    lastHatchOutcome: null,
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

/**
 * The root reducer. Pure: never mutates the input state (structural
 * sharing throughout), never reads a clock or Math.random. Content
 * (tuning, registries) enters via the modules it delegates to, which all
 * default to content/ — the same single source the whole core uses.
 */
export function rootReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "TICK": {
      // Clock rollback safety: elapsed clamps to 0 and lastTickAt never
      // moves backwards (mirrors runCatchup's negative-elapsed rule).
      const elapsedMs = Math.max(0, action.at - state.lastTickAt);
      const hours = elapsedMs / HOUR_MS;
      const registry: SpeciesEvolutionRegistry = contentSpecies;
      const pips = mapPips(state, (pip) => {
        let next = applyNeedsDelta(pip, hours);
        // Live ticks are short; the mid-tick Pipling→Adult rate boundary
        // is negligible here (CATCHUP segments it exactly, spec §4.5).
        next = updateLifeStage(next, Math.max(action.at, state.lastTickAt));
        next = evaluateSulk(next);
        next = evaluateRestAutoWake(next);
        next = updateEvolutionReadiness(next, registry);
        return next;
      });
      const ticked: GameState = {
        ...state,
        pips,
        // Derived timers (spec §6.1/§7.2): due incubations flip to
        // Pipping (never hatch), due trips move to Returning with loot
        // rolled in chronological return order and reveals queued.
        eggs: settleDueEggs(state.eggs, action.at),
        lastTickAt: Math.max(state.lastTickAt, action.at),
      };
      return processDueExpeditionReturns(ticked, action.at);
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
      const { state: next, outcome } = assignExpedition(
        state,
        action.pipId,
        action.expeditionId,
        action.at,
      );
      return { ...next, lastAssignOutcome: outcome };
    }

    case "ACKNOWLEDGE_REVEAL": {
      const reveal = state.pendingReveals[0];
      if (reveal === undefined) return state; // empty queue — nothing to see
      let next: GameState = {
        ...state,
        pendingReveals: state.pendingReveals.slice(1),
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
      // Roster cap (spec §7.4): friendly refusal, egg untouched — it
      // stays Pipping and never expires, however long it waits.
      if (state.rosterOrder.length >= contentTuning.rosterCap) {
        return refuse("rosterFull", ROSTER_FULL_MESSAGE);
      }

      // Genome from the "egg" stream (spec §7.2/§7.3): species weighted
      // by registry rarity; palette/pattern/personality random. The
      // cursor advance persists in rngState — a reload never re-rolls.
      const rng = createRngFromState(state.seed, state.rngState);
      const genome = rollGenome(rng.stream(EGG_STREAM));
      const pipId: PipId = `pip-${state.nextPipNumber}`;
      const pipling = createPipFromGenome(genome, {
        id: pipId,
        name: contentSpecies[genome.speciesId]?.name ?? genome.speciesId,
        hatchedAt: action.at,
        lifeStage: LifeStage.Pipling,
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
      // Egg completions register through the engine's custom-event seam
      // ({kind:"custom", tag:"eggReady"}); custom events fire regardless
      // of the rate cap — incubation is a timer, never capped (§4.5).
      const result = runCatchup(
        { pips: list, eggs: eggsAtStart },
        action.savedAt,
        action.now,
        contentTuning,
        collectEggCatchupEvents,
      );
      const pips: Record<PipId, PipState> = { ...state.pips };
      for (const pip of result.state.pips) {
        pips[pip.id] = pip;
      }
      let next: GameState = {
        ...state,
        pips,
        eggs: result.state.eggs,
        lastTickAt: Math.max(state.lastTickAt, action.now),
        lastCatchup: result.summary,
      };
      // Loot for returns that fired during the pass, rolled AFTER the
      // pass in summary-event order — which is chronological across ALL
      // pips, so the "expedition-loot" cursor advances in true return
      // order regardless of assignment order (spec §2 rule 3; the
      // engine's events are the timeline, the rolls are time-free).
      // Reveals queue for the load-time "While you were away…" flow.
      for (const event of result.summary.events) {
        if (event.kind === "expeditionReturn") {
          next = settleExpeditionReturn(
            next,
            event.pipId,
            event.expedition,
            event.at,
          );
        }
      }
      return next;
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
      const egg = beginIncubation(
        createEgg({
          id: `egg-${state.nextEggNumber}`,
          foundAt: action.at,
          sourceExpeditionId: null,
        }),
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
      };
    }
  }
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
