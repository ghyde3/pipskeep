/**
 * Care actions (spec §5, v1.1) — Feed, Clean, Play, Pet, Rest toggle,
 * Give Item — as one pure `performCare(state, request)` step.
 *
 * Effects (all numbers from content/tuning.ts; content registries are
 * injectable, defaulting to content/):
 * - Feed: consumes one inventory item; +hunger plus the food's side
 *   effects (happiness/energy), clamped 0–100.
 * - Clean: Cleanliness → 100, 60s cooldown (deliberately trivial, §5).
 * - Play: +20 Happiness, −10 Energy, refusal rules below.
 * - Pet: +8 Happiness (+14 for Clingy), 30s cooldown.
 * - Rest: toggles Resting via the state machine (beginRest/wake).
 * - Give Item: consumes one inventory item, sets `lastGiftItemId`
 *   (drives evolution variants, §4.6) and applies the item's
 *   content-defined effects. Decision (spec §5 "content-defined special
 *   effects"): a gifted FOOD applies its side effects only — hunger
 *   restore stays exclusive to Feed; items without content effects
 *   (plain resources) just set the gift record. Future gift items extend
 *   the registry, not this file.
 *
 * Play refusal rules (spec §5, v1.1): ANY Pip refuses below 10 Energy;
 * Lazy additionally refuses below 30; Lazy refuses any other Play 15% of
 * the time just because (rng stream `"quirks"`). A refusal costs nothing
 * — no stat change, no inventory, NO cooldown — and draws a line from
 * the Refusal dialogue context (§3): funny, not frustrating.
 *
 * Cooldowns (Clean 60s, Pet 30s): `state.cooldowns[pipId][action]` holds
 * the last-USED `at` timestamp; the action is blocked while
 * `at − lastUsed < cooldownMs` and unblocks at exactly the boundary.
 * A cooldown block is a structural no (like an empty pantry), not the
 * Pip declining — it costs nothing and draws no line.
 *
 * Care legality: `canReceiveCare` (spec §4.7) — Idle, Resting, Sulking.
 * Sulking is deliberately included: recovery is one good care session
 * away (§4.4), and `evaluateSulk` runs after every applied action so the
 * session that lifts all needs ≥ 25 exits the sulk on the spot.
 *
 * Every request returns a `CareOutcome` the UI animates from: whether it
 * applied, the dialogue context, and the picked line. Success lines come
 * from the pip's DISPLAYED mood (Chaotic's §4.3 quirk, stream
 * `"mood-display"`), or the Sulking context while still sulking.
 *
 * RNG contract per request (cursor determinism, spec §2 rule 3):
 * - `"quirks"`: exactly one roll iff a Lazy pip attempts Play at
 *   ≥ 30 Energy (the flavor-refusal check); zero otherwise.
 * - `"mood-display"`: only on the success path of a non-sulking Chaotic
 *   pip (one roll, plus one when the offset fires).
 * - `"dialogue"`: exactly one roll whenever a line is drawn.
 * Structural refusals (unknown pip/item, busy, cooldown, empty
 * inventory) consume zero rolls and return the input state unchanged.
 */

import { tuning as contentTuning } from "../../content/tuning";
import { foods as contentFoods } from "../../content/foods";
import { dialogue as contentDialogue } from "../../content/dialogue";
import { createRngFromState } from "../rng";
import type { Rng } from "../rng";
import { NEED_MAX, NEED_MIN, PipActivity } from "./types";
import type { NeedId, PipId, PipState } from "./types";
import type { DialogueContext, MoodThresholds } from "./mood";
import {
  beginRest,
  canReceiveCare,
  evaluateRestAutoWake,
  evaluateSulk,
  wake,
} from "./machine";
import type { MachineTuning, TransitionResult } from "./machine";
import {
  DIALOGUE_STREAM,
  MOOD_DISPLAY_STREAM,
  displayedMood,
  pickLineFromPools,
} from "./dialogue";
import type {
  DialogueLine,
  DialoguePoolsView,
  DialogueStateSlice,
} from "./dialogue";

/** Lazy flavor-refusal stream (spec §5). Cursor lives in GameState. */
export const QUIRKS_STREAM = "quirks";

/** Personality ids with hardcoded care quirks (same pattern as needs.ts
 * CLINGY / mood.ts CHAOTIC — the quirk is spec'd to the personality). */
const LAZY_PERSONALITY_ID = "lazy";
const CLINGY_PERSONALITY_ID = "clingy";

/** The six care actions (spec §5). Also the cooldown-table key. */
export const CARE_ACTIONS = [
  "feed",
  "clean",
  "play",
  "pet",
  "restToggle",
  "giveItem",
] as const;
export type CareAction = (typeof CARE_ACTIONS)[number];

/** A care request, timestamped by the caller's Clock (time never
 * originates inside core — spec §2 rule 2). */
export type CareRequest =
  | { readonly action: "feed"; readonly pipId: PipId; readonly foodId: string; readonly at: number }
  | { readonly action: "clean"; readonly pipId: PipId; readonly at: number }
  | { readonly action: "play"; readonly pipId: PipId; readonly at: number }
  | { readonly action: "pet"; readonly pipId: PipId; readonly at: number }
  | { readonly action: "restToggle"; readonly pipId: PipId; readonly at: number }
  | { readonly action: "giveItem"; readonly pipId: PipId; readonly itemId: string; readonly at: number };

/**
 * Why a request did not apply.
 * Pip-voiced refusals (draw a Refusal line, §3): `tooTired`,
 * `lazyTooTired`, `lazyWhim`, `machine`.
 * Structural blocks (no line — the pip isn't declining, the world is):
 * `unknownPip`, `busy` (not Idle/Resting/Sulking — the UI shouldn't have
 * offered), `cooldown`, `outOfStock`, `unknownItem`.
 */
export type CareRefusalReason =
  | "unknownPip"
  | "busy"
  | "cooldown"
  | "outOfStock"
  | "unknownItem"
  | "tooTired"
  | "lazyTooTired"
  | "lazyWhim"
  | "machine";

/** What one care request did — everything the UI animates from (spec §5:
 * stat change + dialogue line + particle/sound-slot hook). */
export interface CareOutcome {
  readonly action: CareAction;
  readonly pipId: PipId;
  readonly at: number;
  readonly applied: boolean;
  readonly refusalReason?: CareRefusalReason;
  /** Pool the line was (or would be) drawn from: `refusal` on any
   * refusal, `sulking` while still sulking, else the displayed mood. */
  readonly dialogueContext: DialogueContext;
  /** Stable line id (`personality/context/index`), when a line was drawn. */
  readonly lineId?: string;
  /** The line's text, for the UI bubble. */
  readonly line?: string;
}

/** Cooldown table: per pip, per action, the last-used `at` timestamp. */
export type CooldownsByPip = Readonly<
  Record<PipId, Partial<Record<CareAction, number>>>
>;

/** The slice of GameState care operates on (GameState satisfies it). */
export interface CareStateSlice extends DialogueStateSlice {
  readonly inventory: Readonly<Record<string, number>>;
  readonly cooldowns: CooldownsByPip;
}

/** The slice of tuning care reads. `content/tuning` satisfies it (and it
 * includes MachineTuning, so the sulk/auto-wake evaluators share it). */
export interface CareTuning extends MachineTuning {
  readonly care: MachineTuning["care"] & {
    readonly clean: { readonly setsCleanlinessTo: number; readonly cooldownMs: number };
    readonly play: { readonly happiness: number; readonly energy: number };
    readonly pet: {
      readonly happiness: number;
      readonly clingyHappiness: number;
      readonly cooldownMs: number;
    };
  };
  readonly playRefusal: {
    readonly minEnergy: number;
    readonly lazyMinEnergy: number;
    readonly lazyFlavorRefusalChance: number;
  };
  readonly mood: MoodThresholds;
  readonly quirks: { readonly chaoticMoodDisplayOffsetChance: number };
}

/** Structural food view (spec §3 food registry). Feed/Give Item read
 * only this; `content/foods` satisfies it. */
export interface CareFoodDef {
  readonly hungerRestore: number;
  readonly sideEffects?: Readonly<
    Partial<{ happiness: number; energy: number }>
  >;
}
export type CareFoodRegistry = Readonly<Record<string, CareFoodDef>>;

/** Injectable content, defaulting to the real registries. */
export interface CareContent {
  readonly tuning?: CareTuning;
  readonly foods?: CareFoodRegistry;
  readonly pools?: DialoguePoolsView;
}

export interface CareResult<S extends CareStateSlice> {
  readonly state: S;
  readonly outcome: CareOutcome;
}

const clampNeed = (value: number): number =>
  Math.min(NEED_MAX, Math.max(NEED_MIN, value));

function addNeeds(
  pip: PipState,
  delta: Partial<Record<NeedId, number>>,
): PipState {
  const needs = { ...pip.needs };
  for (const [need, amount] of Object.entries(delta) as [NeedId, number][]) {
    needs[need] = clampNeed(needs[need] + amount);
  }
  return { ...pip, needs };
}

/** True while the action's cooldown window is still open. Unblocks at
 * exactly `lastUsed + cooldownMs` (spec §5 test bar). */
function onCooldown(
  state: CareStateSlice & { cooldowns: CooldownsByPip },
  pipId: PipId,
  action: CareAction,
  at: number,
  cooldownMs: number,
): boolean {
  const lastUsed = state.cooldowns[pipId]?.[action];
  return lastUsed !== undefined && at - lastUsed < cooldownMs;
}

interface StepResult<S extends CareStateSlice> {
  readonly state: S;
  readonly outcome: CareOutcome;
}

/** A structural block: nothing happened, nothing rolls, no line. The
 * input state is returned by reference — refusals cost nothing. */
function blocked<S extends CareStateSlice>(
  state: S,
  request: CareRequest,
  reason: CareRefusalReason,
): StepResult<S> {
  return {
    state,
    outcome: {
      action: request.action,
      pipId: request.pipId,
      at: request.at,
      applied: false,
      refusalReason: reason,
      dialogueContext: "refusal",
    },
  };
}

/** A pip-voiced refusal: costs nothing, no cooldown, but the pip SAYS so
 * — one line from the Refusal context (spec §5). Only the rng cursor and
 * no-repeat memory advance. */
function refusedWithLine<S extends CareStateSlice>(
  state: S,
  request: CareRequest,
  reason: CareRefusalReason,
  pip: PipState,
  rng: Rng,
  pools: DialoguePoolsView,
): StepResult<S> {
  const line = pickLineFromPools(
    pip.personalityId,
    "refusal",
    state.lastLineIndex[pip.id]?.refusal,
    rng.stream(DIALOGUE_STREAM),
    pools,
  );
  return {
    state: commitDialogue(state, pip.id, rng, line),
    outcome: {
      action: request.action,
      pipId: request.pipId,
      at: request.at,
      applied: false,
      refusalReason: reason,
      dialogueContext: "refusal",
      ...(line !== null ? { lineId: line.lineId, line: line.text } : {}),
    },
  };
}

/** Write back the rng cursors and (when a line was drawn) the pip's
 * no-repeat memory. */
function commitDialogue<S extends CareStateSlice>(
  state: S,
  pipId: PipId,
  rng: Rng,
  line: DialogueLine | null,
): S {
  const next = { ...state, rngState: rng.getState() };
  if (line === null) return next;
  return {
    ...next,
    lastLineIndex: {
      ...state.lastLineIndex,
      [pipId]: { ...state.lastLineIndex[pipId], [line.context]: line.index },
    },
  };
}

/**
 * Perform one care action (spec §5). Pure: same state + request in, same
 * state + outcome out; the input state is never mutated. See module doc
 * for effects, refusal rules, and the per-stream RNG contract.
 */
export function performCare<S extends CareStateSlice>(
  state: S,
  request: CareRequest,
  content: CareContent = {},
): CareResult<S> {
  const tuning = content.tuning ?? contentTuning;
  const foods: CareFoodRegistry = content.foods ?? contentFoods;
  const pools = content.pools ?? contentDialogue;

  const pip = state.pips[request.pipId];
  if (pip === undefined) return blocked(state, request, "unknownPip");
  if (!canReceiveCare(pip)) return blocked(state, request, "busy");

  const rng = createRngFromState(state.seed, state.rngState);

  switch (request.action) {
    case "feed": {
      const food = foods[request.foodId];
      if (food === undefined) return blocked(state, request, "unknownItem");
      if ((state.inventory[request.foodId] ?? 0) <= 0) {
        return blocked(state, request, "outOfStock");
      }
      const fed = addNeeds(pip, {
        hunger: food.hungerRestore,
        ...(food.sideEffects ?? {}),
      });
      return applySuccess(state, request, fed, rng, tuning, pools, {
        inventoryDelta: { [request.foodId]: -1 },
      });
    }

    case "clean": {
      if (
        onCooldown(state, pip.id, "clean", request.at, tuning.care.clean.cooldownMs)
      ) {
        return blocked(state, request, "cooldown");
      }
      const cleaned: PipState = {
        ...pip,
        needs: {
          ...pip.needs,
          cleanliness: clampNeed(tuning.care.clean.setsCleanlinessTo),
        },
      };
      return applySuccess(state, request, cleaned, rng, tuning, pools, {
        startCooldown: true,
      });
    }

    case "play": {
      // Refusal ladder (spec §5): universal floor, Lazy floor, Lazy whim.
      // Threshold refusals consume zero quirks rolls; the whim check rolls
      // exactly once, only for a Lazy pip past both floors.
      if (pip.needs.energy < tuning.playRefusal.minEnergy) {
        return refusedWithLine(state, request, "tooTired", pip, rng, pools);
      }
      if (pip.personalityId === LAZY_PERSONALITY_ID) {
        if (pip.needs.energy < tuning.playRefusal.lazyMinEnergy) {
          return refusedWithLine(state, request, "lazyTooTired", pip, rng, pools);
        }
        if (
          rng.stream(QUIRKS_STREAM).chance(tuning.playRefusal.lazyFlavorRefusalChance)
        ) {
          return refusedWithLine(state, request, "lazyWhim", pip, rng, pools);
        }
      }
      const played = addNeeds(pip, {
        happiness: tuning.care.play.happiness,
        energy: tuning.care.play.energy,
      });
      return applySuccess(state, request, played, rng, tuning, pools, {});
    }

    case "pet": {
      if (onCooldown(state, pip.id, "pet", request.at, tuning.care.pet.cooldownMs)) {
        return blocked(state, request, "cooldown");
      }
      const bonus =
        pip.personalityId === CLINGY_PERSONALITY_ID
          ? tuning.care.pet.clingyHappiness
          : tuning.care.pet.happiness;
      const petted = addNeeds(pip, { happiness: bonus });
      return applySuccess(state, request, petted, rng, tuning, pools, {
        startCooldown: true,
      });
    }

    case "restToggle": {
      const result: TransitionResult =
        pip.activity === PipActivity.Resting ? wake(pip) : beginRest(pip);
      if (!result.ok) {
        // e.g. Rest offered to a Sulking pip — the pip declines, with a line.
        return refusedWithLine(state, request, "machine", pip, rng, pools);
      }
      return applySuccess(state, request, result.pip, rng, tuning, pools, {
        // A freshly-begun rest is never auto-woken inside the same action:
        // a full-energy pip visibly lies down; the next TICK wakes it.
        skipAutoWake: pip.activity !== PipActivity.Resting,
      });
    }

    case "giveItem": {
      if ((state.inventory[request.itemId] ?? 0) <= 0) {
        return blocked(state, request, "outOfStock");
      }
      const food = foods[request.itemId];
      const gifted = addNeeds(
        { ...pip, lastGiftItemId: request.itemId },
        food?.sideEffects ?? {},
      );
      return applySuccess(state, request, gifted, rng, tuning, pools, {
        inventoryDelta: { [request.itemId]: -1 },
      });
    }
  }
}

/** Post-effect pipeline shared by every applied action: machine
 * re-evaluations, cooldown recording, inventory, success dialogue. */
function applySuccess<S extends CareStateSlice>(
  state: S,
  request: CareRequest,
  pipAfterEffect: PipState,
  rng: Rng,
  tuning: CareTuning,
  pools: DialoguePoolsView,
  options: {
    readonly inventoryDelta?: Readonly<Record<string, number>>;
    readonly startCooldown?: boolean;
    readonly skipAutoWake?: boolean;
  },
): StepResult<S> {
  // Machine re-evaluations (spec §4.4/§5): the care session that lifts a
  // sulker's needs all ≥ 25 exits Sulking here; Play that bottoms out
  // Energy enters it. Auto-wake fires if an effect filled Energy while
  // Resting (seam for energy foods), except on a just-begun rest.
  let pip = evaluateSulk(pipAfterEffect, tuning);
  if (options.skipAutoWake !== true) {
    pip = evaluateRestAutoWake(pip, tuning);
  }

  // Success context (spec §3/§4.3): Sulking pips speak from the Sulking
  // pool; everyone else from the DISPLAYED mood (Chaotic quirk applies).
  const context: DialogueContext =
    pip.activity === PipActivity.Sulking
      ? "sulking"
      : displayedMood(pip, rng.stream(MOOD_DISPLAY_STREAM), tuning);

  const line = pickLineFromPools(
    pip.personalityId,
    context,
    state.lastLineIndex[pip.id]?.[context],
    rng.stream(DIALOGUE_STREAM),
    pools,
  );

  let inventory = state.inventory;
  if (options.inventoryDelta !== undefined) {
    inventory = { ...inventory };
    for (const [itemId, delta] of Object.entries(options.inventoryDelta)) {
      inventory = { ...inventory, [itemId]: (inventory[itemId] ?? 0) + delta };
    }
  }

  const cooldowns =
    options.startCooldown === true
      ? {
          ...state.cooldowns,
          [pip.id]: { ...state.cooldowns[pip.id], [request.action]: request.at },
        }
      : state.cooldowns;

  const nextState = commitDialogue(
    {
      ...state,
      pips: { ...state.pips, [pip.id]: pip },
      inventory,
      cooldowns,
    },
    pip.id,
    rng,
    line,
  );

  return {
    state: nextState,
    outcome: {
      action: request.action,
      pipId: request.pipId,
      at: request.at,
      applied: true,
      dialogueContext: context,
      ...(line !== null ? { lineId: line.lineId, line: line.text } : {}),
    },
  };
}
