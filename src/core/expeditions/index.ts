/**
 * Expedition domain (spec §6.1) — assignment legality, derived return
 * timers, seeded loot rolls, and the pending-reveal queue.
 *
 * Timers: completion is DERIVED from `departedAt + durationMs` via the
 * caller's injected Clock — never a setTimeout — so a reload
 * mid-expedition preserves the remaining time to the millisecond by
 * construction (spec §6.1).
 *
 * Return flow (both live TICK and offline catch-up):
 *   OnExpedition —timer elapses→ Returning, loot rolled, reveal queued.
 * Loot and any egg go to `state.pendingReveals` — NOT directly to
 * inventory: the reveal moment is the dopamine core (spec §6.1), so the
 * ACKNOWLEDGE_REVEAL action (the player closing the reveal modal) is
 * what transfers items to inventory/resources and eggs to `state.eggs`.
 * Live returns wait in Returning until acknowledged (player-gated);
 * offline returns land Idle/Sulking during catch-up with their reveals
 * still queued for load time.
 *
 * RNG contract per settled return (cursor determinism, spec §2 rule 3),
 * all from the `"expedition-loot"` stream, in this exact order:
 *   1. `lootRolls` base item rolls (1 weighted roll each); after EACH
 *      base roll, a Curious pip rolls its bonus chance (1 roll) and, when
 *      it fires, one bonus item (1 roll) appended right after its base
 *      item. Non-Curious pips consume ZERO bonus-chance rolls.
 *   2. One egg-chance roll (spec §6.1 egg chances).
 *
 * CURIOUS "+10% loot" (spec §4.2), exact semantics: each of the
 * `lootRolls` base rolls independently carries a
 * `tuning.quirks.curiousLootBonus` (0.10) chance of one extra roll from
 * the same weighted table, so the EXPECTED item count per trip is
 * exactly `lootRolls × (1 + curiousLootBonus)` — a +10% average,
 * delivered as occasional visible extra finds rather than fractional
 * scaling.
 *
 * Multiple due returns (a long tick, or a catch-up window) are settled
 * in CHRONOLOGICAL return order — the stream cursor advances in the
 * order the trips actually completed, so determinism never depends on
 * roster order or assignment order.
 *
 * Purity: no clock, no Math.random; `at` comes from the caller, rng
 * cursors live in the state slice. ZERO tuning literals — every number
 * comes from tuning/content (defaults to content/, injectable).
 */

import { tuning as contentTuning } from "../../content/tuning";
import { expeditions as contentExpeditions } from "../../content/expeditions";
import { dialogue as contentDialogue } from "../../content/dialogue";
import { createRngFromState } from "../rng";
import type { Rng, RngStream } from "../rng";
import { PipActivity } from "../pips/types";
import type { ActiveExpedition, PipId, PipState } from "../pips/types";
import { beginReturn, departExpedition } from "../pips/machine";
import { DIALOGUE_STREAM, pickLineFromPools } from "../pips/dialogue";
import type { DialoguePoolsView, DialogueStateSlice } from "../pips/dialogue";
import { createEgg } from "../eggs";
import type { Egg, EggTuning } from "../eggs";

/** Identifier of an in-flight expedition instance (not the content id). */
export type ExpeditionRunId = string;

/** Name of the seeded RNG stream used for loot rolls (spec §6.1). */
export const EXPEDITION_LOOT_STREAM = "expedition-loot";

/** Personality ids with hardcoded expedition quirks (spec §4.2 — same
 * pattern as CLINGY in needs.ts and LAZY in care.ts). */
const HARDWORKING_PERSONALITY_ID = "hardworking";
const CURIOUS_PERSONALITY_ID = "curious";

/**
 * Structural view of one expedition registry entry, as core needs it
 * (content ids are opaque here — spec §2 rule 5). `content/expeditions`
 * satisfies this; `unlockKeepLevel` widens to number.
 */
export interface ExpeditionView {
  readonly id: string;
  readonly unlockKeepLevel: number;
  readonly durationMs: number;
  readonly lootTable: readonly { readonly itemId: string; readonly weight: number }[];
  readonly lootRolls: number;
  readonly eggChance: number;
}

export type ExpeditionRegistryView = Readonly<Record<string, ExpeditionView>>;

/** The slice of tuning expeditions read; content/tuning satisfies it
 * (EggTuning intersected because settling a return may create an egg). */
export type ExpeditionTuning = EggTuning & {
  readonly quirks: {
    readonly hardworkingExpeditionDurationMultiplier: number;
    readonly curiousLootBonus: number;
  };
};

/** Injectable content, defaulting to the real registries. */
export interface ExpeditionContent {
  readonly registry?: ExpeditionRegistryView;
  readonly tuning?: ExpeditionTuning;
  readonly pools?: DialoguePoolsView;
}

/**
 * One completed trip waiting for its loot-reveal moment (spec §6.1).
 * ACKNOWLEDGE_REVEAL consumes the queue head: items are routed to
 * inventory/resources, the egg (still Found) starts incubating in
 * `state.eggs`, and a still-Returning pip arrives home.
 */
export interface PendingReveal {
  readonly pipId: PipId;
  readonly expeditionId: string;
  /** The derived return moment the loot was rolled for. */
  readonly completedAt: number;
  /** Item ids in exact roll order (base and bonus rolls interleaved). */
  readonly items: readonly string[];
  /** Egg found on this trip (state Found), or null. */
  readonly egg: Egg | null;
}

/**
 * The slice of GameState the expedition system reads/writes. Structural
 * so this module never imports core/state.ts (no core-internal cycles);
 * GameState satisfies it.
 */
export interface ExpeditionStateSlice extends DialogueStateSlice {
  readonly rosterOrder: readonly PipId[];
  /** Gates expedition unlocks (spec §9): meadow 1, forest 2, shore 3. */
  readonly keepLevel: number;
  readonly pendingReveals: readonly PendingReveal[];
  /** Deterministic egg-id counter (`egg-<n>`). */
  readonly nextEggNumber: number;
}

/**
 * Effective trip duration (spec §4.2): content duration × Hardworking's
 * tuning-defined multiplier (×0.85 — "−15% expedition duration"); ×1 for
 * everyone else.
 */
export function effectiveExpeditionDurationMs(
  expedition: ExpeditionView,
  personalityId: string,
  tuning: ExpeditionTuning = contentTuning,
): number {
  const multiplier =
    personalityId === HARDWORKING_PERSONALITY_ID
      ? tuning.quirks.hardworkingExpeditionDurationMultiplier
      : 1;
  return expedition.durationMs * multiplier;
}

/**
 * Why an assignment did not happen.
 * Pip-voiced refusals (draw a Refusal line, spec §3/§4.7): `sulking`,
 * `pipling`. Structural blocks (no line — the world said no, not the
 * pip): `unknownPip`, `unknownExpedition`, `locked` (Keep level too
 * low), `occupied` (another pip already out on that expedition, spec
 * §6.1 one-pip-per-expedition), `busy` (not an Idle pip).
 */
export type AssignRefusalReason =
  | "unknownPip"
  | "unknownExpedition"
  | "locked"
  | "occupied"
  | "busy"
  | "sulking"
  | "pipling";

/** What one ASSIGN_EXPEDITION request did — the UI's animation/dialogue
 * source (parked in `state.lastAssignOutcome`). */
export type AssignExpeditionOutcome =
  | {
      readonly ok: true;
      readonly pipId: PipId;
      readonly expeditionId: string;
      readonly departedAt: number;
      readonly durationMs: number;
      /** Derived: departedAt + durationMs (spec §6.1). */
      readonly returnAt: number;
    }
  | {
      readonly ok: false;
      readonly pipId: PipId;
      readonly expeditionId: string;
      readonly at: number;
      readonly reason: AssignRefusalReason;
      /** Refusal dialogue, when the pip itself declined. */
      readonly lineId?: string;
      readonly line?: string;
    };

export interface AssignResult<S extends ExpeditionStateSlice> {
  readonly state: S;
  readonly outcome: AssignExpeditionOutcome;
}

/** True when some OTHER pip is currently out (or Returning, its loot
 * still uncollected) on this expedition — spec §6.1: one pip per
 * expedition. */
function expeditionOccupied(
  state: ExpeditionStateSlice,
  expeditionId: string,
  exceptPipId: PipId,
): boolean {
  return Object.values(state.pips).some(
    (pip) =>
      pip.id !== exceptPipId &&
      (pip.activity === PipActivity.OnExpedition ||
        pip.activity === PipActivity.Returning) &&
      pip.expedition?.expeditionId === expeditionId,
  );
}

/** Commit rng cursors + no-repeat memory after a refusal line draw
 * (same shape as care.ts's commitDialogue). */
function commitRefusalLine<S extends ExpeditionStateSlice>(
  state: S,
  pipId: PipId,
  rng: Rng,
  line: ReturnType<typeof pickLineFromPools>,
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
 * Assign a pip to an expedition (spec §6.1) at `at`. Pure; refusals are
 * typed outcomes, never exceptions, and structural blocks consume zero
 * rng rolls and return the input state untouched. Pip-voiced refusals
 * (Sulking, spec §4.7; Pipling, spec §4.6 — both via the state machine)
 * draw one Refusal-context line, advancing only the dialogue cursor and
 * no-repeat memory.
 */
export function assignExpedition<S extends ExpeditionStateSlice>(
  state: S,
  pipId: PipId,
  expeditionId: string,
  at: number,
  content: ExpeditionContent = {},
): AssignResult<S> {
  const registry: ExpeditionRegistryView = content.registry ?? contentExpeditions;
  const tuning = content.tuning ?? contentTuning;
  const pools = content.pools ?? contentDialogue;

  const refuse = (reason: AssignRefusalReason): AssignResult<S> => ({
    state,
    outcome: { ok: false, pipId, expeditionId, at, reason },
  });

  const pip = state.pips[pipId];
  if (pip === undefined) return refuse("unknownPip");

  const expedition = registry[expeditionId];
  if (expedition === undefined) return refuse("unknownExpedition");
  if (expedition.unlockKeepLevel > state.keepLevel) return refuse("locked");
  if (expeditionOccupied(state, expeditionId, pipId)) return refuse("occupied");

  const durationMs = effectiveExpeditionDurationMs(
    expedition,
    pip.personalityId,
    tuning,
  );
  const result = departExpedition(pip, {
    expeditionId,
    departedAt: at,
    durationMs,
  });

  if (!result.ok) {
    if (result.refusal.kind === "illegal") return refuse("busy");
    // Sulking / Pipling: the pip SAYS no — one Refusal-context line.
    const rng = createRngFromState(state.seed, state.rngState);
    const line = pickLineFromPools(
      pip.personalityId,
      "refusal",
      state.lastLineIndex[pip.id]?.refusal,
      rng.stream(DIALOGUE_STREAM),
      pools,
    );
    return {
      state: commitRefusalLine(state, pip.id, rng, line),
      outcome: {
        ok: false,
        pipId,
        expeditionId,
        at,
        reason: result.refusal.kind,
        ...(line !== null ? { lineId: line.lineId, line: line.text } : {}),
      },
    };
  }

  return {
    state: { ...state, pips: { ...state.pips, [pip.id]: result.pip } },
    outcome: {
      ok: true,
      pipId,
      expeditionId,
      departedAt: at,
      durationMs,
      returnAt: at + durationMs,
    },
  };
}

/** One weighted pick from a loot table. Consumes exactly one roll. */
function pickWeighted(
  stream: RngStream,
  table: ExpeditionView["lootTable"],
): string {
  const total = table.reduce((sum, entry) => sum + entry.weight, 0);
  let r = stream.next() * total;
  for (const entry of table) {
    r -= entry.weight;
    if (r < 0) return entry.itemId;
  }
  // Float-edge fallback (r landed exactly on total): last entry.
  return (table[table.length - 1] as ExpeditionView["lootTable"][number]).itemId;
}

export interface LootRoll {
  /** Item ids in exact roll order (base and bonus interleaved). */
  readonly items: readonly string[];
  readonly eggFound: boolean;
}

/**
 * Roll one completed trip's loot from the given stream, per the module
 * doc's RNG contract (base rolls with Curious bonus rolls interleaved,
 * then the egg-chance roll). Empty loot table → no items (defensive;
 * content validation forbids it), egg roll still consumed.
 */
export function rollExpeditionLoot(
  stream: RngStream,
  expedition: ExpeditionView,
  personalityId: string,
  tuning: ExpeditionTuning = contentTuning,
): LootRoll {
  const items: string[] = [];
  const curious = personalityId === CURIOUS_PERSONALITY_ID;
  if (expedition.lootTable.length > 0) {
    for (let i = 0; i < expedition.lootRolls; i++) {
      items.push(pickWeighted(stream, expedition.lootTable));
      if (curious && stream.chance(tuning.quirks.curiousLootBonus)) {
        items.push(pickWeighted(stream, expedition.lootTable));
      }
    }
  }
  const eggFound = stream.chance(expedition.eggChance);
  return { items, eggFound };
}

/**
 * Settle ONE completed trip: roll its loot (advancing the
 * `"expedition-loot"` cursor in the state slice) and append the pending
 * reveal — items and any egg (state Found) included. Does NOT touch the
 * pip: the caller owns the OnExpedition → Returning (live) or → Idle
 * (catch-up engine) transition, and passes the trip snapshot here
 * because arrival clears `pip.expedition`.
 *
 * An expedition id missing from the registry (content removed between
 * sessions) settles as an empty reveal with zero rolls consumed — the
 * player still sees their pip come home.
 */
export function settleExpeditionReturn<S extends ExpeditionStateSlice>(
  state: S,
  pipId: PipId,
  expedition: ActiveExpedition,
  completedAt: number,
  content: ExpeditionContent = {},
): S {
  const registry: ExpeditionRegistryView = content.registry ?? contentExpeditions;
  const tuning = content.tuning ?? contentTuning;
  const def = registry[expedition.expeditionId];

  if (def === undefined) {
    const reveal: PendingReveal = {
      pipId,
      expeditionId: expedition.expeditionId,
      completedAt,
      items: [],
      egg: null,
    };
    return { ...state, pendingReveals: [...state.pendingReveals, reveal] };
  }

  const pip = state.pips[pipId];
  const rng = createRngFromState(state.seed, state.rngState);
  const stream = rng.stream(EXPEDITION_LOOT_STREAM);
  const loot = rollExpeditionLoot(
    stream,
    def,
    pip?.personalityId ?? "",
    tuning,
  );

  const egg = loot.eggFound
    ? createEgg(
        {
          id: `egg-${state.nextEggNumber}`,
          foundAt: completedAt,
          sourceExpeditionId: expedition.expeditionId,
        },
        tuning,
      )
    : null;

  const reveal: PendingReveal = {
    pipId,
    expeditionId: expedition.expeditionId,
    completedAt,
    items: loot.items,
    egg,
  };

  return {
    ...state,
    rngState: rng.getState(),
    pendingReveals: [...state.pendingReveals, reveal],
    nextEggNumber: egg !== null ? state.nextEggNumber + 1 : state.nextEggNumber,
  };
}

/**
 * Live-tick return processing: every OnExpedition pip whose derived
 * return moment (`departedAt + durationMs`) has arrived by `at`
 * (inclusive) moves to Returning and has its trip settled. Multiple due
 * trips settle in CHRONOLOGICAL return order (ties: roster order) — the
 * loot-stream cursor is consumed in the order the trips completed, the
 * same order the catch-up pass produces (see module doc).
 */
export function processDueExpeditionReturns<S extends ExpeditionStateSlice>(
  state: S,
  at: number,
  content: ExpeditionContent = {},
): S {
  const due: { pipId: PipId; expedition: ActiveExpedition; returnAt: number }[] =
    [];
  for (const pip of Object.values(state.pips)) {
    if (pip.activity !== PipActivity.OnExpedition || pip.expedition === null) {
      continue;
    }
    const returnAt = pip.expedition.departedAt + pip.expedition.durationMs;
    if (returnAt <= at) {
      due.push({ pipId: pip.id, expedition: pip.expedition, returnAt });
    }
  }
  if (due.length === 0) return state;

  const rosterIndex = (pipId: PipId): number => {
    const index = state.rosterOrder.indexOf(pipId);
    return index === -1 ? state.rosterOrder.length : index;
  };
  due.sort(
    (a, b) => a.returnAt - b.returnAt || rosterIndex(a.pipId) - rosterIndex(b.pipId),
  );

  let next = state;
  for (const entry of due) {
    const pip = next.pips[entry.pipId];
    if (pip === undefined) continue;
    const returning = beginReturn(pip);
    if (!returning.ok) continue; // stale entry — activity changed mid-loop
    next = {
      ...next,
      pips: { ...next.pips, [entry.pipId]: returning.pip },
    };
    next = settleExpeditionReturn(
      next,
      entry.pipId,
      entry.expedition,
      entry.returnAt,
      content,
    );
  }
  return next;
}
