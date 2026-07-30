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
import type { MachineTuning } from "../pips/machine";
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
 * (EggTuning intersected because settling a return may create an egg;
 * MachineTuning intersected because `assignExpedition` delegates the
 * Pipling supervised-trip check to `departExpedition`, which needs
 * `pipling.allowedExpeditionIds`/`durationMs`). */
export type ExpeditionTuning = EggTuning &
  MachineTuning & {
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
  /**
   * ROUND 2C (docs/retention-bible.md §9) — the already-composed,
   * already-clamped extra loot-bonus roll chance for THIS ONE trip
   * (mastery + streak + event, via `core/progression/multipliers.ts`'s
   * `effectiveLootBonusChance`), passed straight through to
   * `rollExpeditionLoot`'s 5th parameter. Omitted (`undefined`) preserves
   * the pre-round-2C fallback exactly (see that function's doc comment).
   * Used by `settleExpeditionReturn`'s single-trip call site.
   */
  readonly effectiveLootBonusChance?: number;
  /**
   * The per-pip variant `processDueExpeditionReturns` needs (it may settle
   * SEVERAL different pips' trips in one call): given the returning
   * PipState and the expedition id, return that trip's already-composed
   * bonus chance. Takes precedence over `effectiveLootBonusChance` at that
   * call site; omitted preserves old behaviour exactly.
   */
  readonly resolveLootBonusChance?: (pip: PipState, expeditionId: string) => number;
  /**
   * ROUND 2C (docs/retention-bible.md §6.3/§8.4) — the already-composed,
   * already-clamped-and-ceilinged egg chance for THIS ONE trip (the
   * biome's base `eggChance` plus mastery's top-tier bonus points plus any
   * active event's, via `core/progression/multipliers.ts`'s
   * `applyEggChanceBonus(effectiveEggChanceBonusPoints(...))`). Omitted
   * (`undefined`) uses `expedition.eggChance` verbatim — the pre-round-2C
   * behaviour, byte-identical (the egg roll is ONE `stream.chance` call
   * whatever the probability, so cursor parity is free).
   */
  readonly effectiveEggChance?: number;
  /** The per-pip variant `processDueExpeditionReturns` needs, exactly like
   * `resolveLootBonusChance` — it may settle several pips' trips in one
   * call, each with its own mastery. */
  readonly resolveEggChance?: (pip: PipState, expeditionId: string) => number;
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
  /** The Keep's level gates expedition unlocks (spec §9): meadow 1,
   * forest 2, shore 3. Only `level` is read here. */
  readonly keep: { readonly level: number };
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

/**
 * What one ASSIGN_EXPEDITION request did — the UI's animation/dialogue
 * source (parked in `state.lastAssignOutcome`). Every refusal reason
 * carries enough to write a full sentence (why + when it resolves, where
 * "when" is knowable) rather than a bare no:
 * - `pipling`: `growsUpAt` — the exact Adult-conversion timestamp.
 * - `locked`: `requiredKeepLevel`/`currentKeepLevel` — how far off it is.
 * - `occupied`: `occupiedUntil` — when the other Pip currently out there
 *   is due back, so a retry has a concrete moment to aim for.
 * - `sulking`: no natural "when" — recovery depends on care, not a clock
 *   (the Refusal dialogue line carries the "why" instead).
 */
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
      /** Present iff `reason === "pipling"` (spec §4.6 / round 2A). */
      readonly growsUpAt?: number;
      /** Present iff `reason === "locked"`. */
      readonly requiredKeepLevel?: number;
      readonly currentKeepLevel?: number;
      /** Present iff `reason === "occupied"` — the occupying Pip's
       * derived return moment (`departedAt + durationMs`). */
      readonly occupiedUntil?: number;
    };

export interface AssignResult<S extends ExpeditionStateSlice> {
  readonly state: S;
  readonly outcome: AssignExpeditionOutcome;
}

/** The OTHER pip currently out (or Returning, its loot still uncollected)
 * on this expedition, if any — spec §6.1: one pip per expedition. Shared
 * by the occupied check and its refusal's `occupiedUntil`. */
function occupyingPip(
  state: ExpeditionStateSlice,
  expeditionId: string,
  exceptPipId: PipId,
): PipState | undefined {
  return Object.values(state.pips).find(
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

  const refuse = (
    reason: AssignRefusalReason,
    extra: {
      readonly growsUpAt?: number;
      readonly requiredKeepLevel?: number;
      readonly currentKeepLevel?: number;
      readonly occupiedUntil?: number;
    } = {},
  ): AssignResult<S> => ({
    state,
    outcome: { ok: false, pipId, expeditionId, at, reason, ...extra },
  });

  const pip = state.pips[pipId];
  if (pip === undefined) return refuse("unknownPip");

  const expedition = registry[expeditionId];
  if (expedition === undefined) return refuse("unknownExpedition");
  if (expedition.unlockKeepLevel > state.keep.level) {
    return refuse("locked", {
      requiredKeepLevel: expedition.unlockKeepLevel,
      currentKeepLevel: state.keep.level,
    });
  }
  const occupant = occupyingPip(state, expeditionId, pipId);
  if (occupant !== undefined) {
    // occupant.expedition is non-null by construction (OnExpedition/
    // Returning invariant, types.ts), but stay defensive rather than `!`.
    return refuse("occupied", {
      occupiedUntil:
        occupant.expedition !== null
          ? occupant.expedition.departedAt + occupant.expedition.durationMs
          : undefined,
    });
  }

  const durationMs = effectiveExpeditionDurationMs(
    expedition,
    pip.personalityId,
    tuning,
  );
  const result = departExpedition(
    pip,
    { expeditionId, departedAt: at, durationMs },
    tuning,
  );

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
        ...(result.refusal.kind === "pipling"
          ? { growsUpAt: result.refusal.growsUpAt }
          : {}),
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
 * doc's RNG contract (base rolls with a bonus-chance roll interleaved,
 * then the egg-chance roll). Empty loot table → no items (defensive;
 * content validation forbids it), egg roll still consumed.
 *
 * ROUND 2C (docs/retention-bible.md §9.2) — the bonus-roll chance
 * generalises from "iff Curious" to "iff the EFFECTIVE chance > 0", where
 * effective = Curious's own +10% PLUS mastery/streak/event bonuses,
 * summed-then-clamped by `core/progression/multipliers.ts`. `effectiveBonusChance`
 * is that already-composed, already-clamped number:
 *
 * - OMITTED (`undefined`): falls back to the pre-round-2C formula —
 *   `curious ? tuning.quirks.curiousLootBonus : 0` — so every existing
 *   call site (this module's own `processDueExpeditionReturns`/
 *   `settleExpeditionReturn` when their `content.effectiveLootBonusChance`
 *   is unset, and every test that calls this function directly) consumes
 *   BYTE-IDENTICAL rolls to before this round. This is the load-bearing
 *   compatibility contract — do not change the fallback.
 * - PROVIDED: used DIRECTLY as the per-base-roll bonus chance, replacing
 *   (not adding to) the internal Curious-only calculation — the caller is
 *   expected to have already folded Curious's own contribution into the
 *   sum via `effectiveLootBonusChance({ curious, ... }, tuning)`, so a
 *   fresh save with no mastery/streak/event and a non-Curious pip still
 *   passes `0`, and a Curious one with nothing else active still passes
 *   exactly `tuning.quirks.curiousLootBonus` — identical to the fallback
 *   path either way.
 *
 * `effectiveEggChance` is the same story for the EGG roll (bible §6.3's
 * mastery-top-tier bonus and §8.4's event bonus, summed/clamped/ceilinged
 * by `multipliers.ts` before it gets here): omitted uses
 * `expedition.eggChance` verbatim. Either way the egg roll is exactly ONE
 * `stream.chance` call, so this cannot shift a single cursor byte.
 */
export function rollExpeditionLoot(
  stream: RngStream,
  expedition: ExpeditionView,
  personalityId: string,
  tuning: ExpeditionTuning = contentTuning,
  effectiveBonusChance?: number,
  effectiveEggChance?: number,
): LootRoll {
  const items: string[] = [];
  const curious = personalityId === CURIOUS_PERSONALITY_ID;
  const bonusChance =
    effectiveBonusChance ?? (curious ? tuning.quirks.curiousLootBonus : 0);
  if (expedition.lootTable.length > 0) {
    for (let i = 0; i < expedition.lootRolls; i++) {
      items.push(pickWeighted(stream, expedition.lootTable));
      if (bonusChance > 0 && stream.chance(bonusChance)) {
        items.push(pickWeighted(stream, expedition.lootTable));
      }
    }
  }
  const eggFound = stream.chance(effectiveEggChance ?? expedition.eggChance);
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
    content.effectiveLootBonusChance,
    content.effectiveEggChance,
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
    // ROUND 2C: resolve THIS pip's already-composed bonus chances (if the
    // caller supplied resolvers) into the flat fields
    // settleExpeditionReturn reads — omitted resolvers preserve old
    // behaviour exactly.
    let perTripContent: ExpeditionContent = content;
    if (content.resolveLootBonusChance !== undefined) {
      perTripContent = {
        ...perTripContent,
        effectiveLootBonusChance: content.resolveLootBonusChance(
          pip,
          entry.expedition.expeditionId,
        ),
      };
    }
    if (content.resolveEggChance !== undefined) {
      perTripContent = {
        ...perTripContent,
        effectiveEggChance: content.resolveEggChance(
          pip,
          entry.expedition.expeditionId,
        ),
      };
    }
    next = settleExpeditionReturn(
      next,
      entry.pipId,
      entry.expedition,
      entry.returnAt,
      perTripContent,
    );
  }
  return next;
}
