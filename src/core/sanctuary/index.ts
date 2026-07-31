/**
 * The Long Meadow (`sanctuary`) — retire/retrieve (docs/retention-bible.md
 * §2). Pure functions over a structural host-state slice, the same shape
 * `core/keep/jobs.ts` uses for job assignment: `retirePip`/`retrievePip`
 * are generic over any state extending `SanctuaryHostState`, so later
 * callers (the reducer) pass the full `GameState` without this module
 * importing it (spec §2 rule 5 — no cycle back to core/state.ts).
 *
 * THE ONE-PLACE INVARIANT (bible §2.6, the sharpest new failure mode in
 * the codebase per bible §14 risk 3): every PipId the game has ever
 * minted exists in EXACTLY ONE of `state.pips` (with a matching
 * `rosterOrder` entry) or `state.sanctuary.pips`. Never both, never
 * neither. Both functions below move the whole PipId atomically between
 * the two — there is no intermediate state where it exists in neither or
 * both.
 *
 * FREEZING (bible §2.4): a resident's needs snap ONCE on arrival
 * (`buildResident`) and then literally cannot change again, because
 * residents live in `state.sanctuary.pips`, which `TICK`'s per-pip loop
 * and `CATCHUP`'s roster-derived pip list never touch — moving a Pip OUT
 * of `state.pips`/`rosterOrder` (this module's job) is what freezes it,
 * not a stored flag. `ageMs`/`happinessIntegral` freeze for the same
 * reason (bible §2.4: "evolution must be earned" — a resident aging at a
 * constant 80 happiness would make the sanctuary the optimal way to
 * evolve, hollowing out v1.3's standing rule).
 *
 * Job auto-unassignment (bible §2.3: "AssignedJob: yes, and the job is
 * auto-unassigned") is DELIBERATELY NOT done here — it is the caller's
 * job (the RETIRE_PIP reducer arm), exactly the same separation of
 * concerns `REMOVE_ITEM` already uses (`core/keep/index.ts`'s
 * `removeItem` does not know about jobs either; `state.ts` composes both).
 * This keeps `core/sanctuary` decoupled from `core/keep/jobs`.
 */

import { tuning as contentTuning } from "../../content/tuning";
import { PipActivity } from "../pips/types";
import type { PipId, PipNeeds, PipState } from "../pips/types";
import { evaluateSulk } from "../pips/machine";
import type { MachineTuning } from "../pips/machine";
import type { SanctuaryReason, SanctuaryRecord, SanctuaryState } from "./types";

export type { SanctuaryReason, SanctuaryRecord, SanctuaryState } from "./types";

/** A fresh Long Meadow: nobody there yet (bible §11.1 v6 backfill —
 * nothing could have been retired before this round shipped). */
export function createEmptySanctuary(): SanctuaryState {
  return { pips: {}, order: [] };
}

/** The slice of tuning retire/retrieve reads (injectable for tests, same
 * pattern as `NeedsTuning`/`MachineTuning`). `content/tuning.ts`'s
 * `retention.sanctuary` satisfies it (`capacity`/`minStayMs` are read by
 * the reducer, not this module — capacity is asserted NEVER to gate
 * anything, bible §2.2, and minStayMs is `retrievePip`'s own parameter). */
export interface SanctuaryTuning {
  /** You cannot send your LAST Pip away (bible §2.3: "someone has to hold
   * the fort") — structural, not a punishment. */
  readonly minActivePips: number;
  /** Snapped onto a resident's needs ONCE on arrival (bible §2.3/§2.4). */
  readonly arrivalNeeds: PipNeeds;
}

/**
 * The arrival transform (bible §2.3 steps 1–3, §2.4): needs snap once to
 * `arrivalNeeds`; the Sulking flag clears through the ORDINARY §4.4 exit
 * rule (`evaluateSulk` — no special case, since 80/80/80/100 clears
 * `sulkExitThreshold` by a wide margin: if a future retune ever dropped
 * `arrivalNeeds` below the threshold, a genuinely Sulking resident would
 * correctly stay marked sulking rather than being silently cured by a
 * hand-rolled `sulking: false`); `activity` is then forced to Idle
 * regardless (residents have no Resting/AssignedJob display — "they nap
 * on the way" is flavour, not a stored state), `pendingSulk` clears (no
 * expedition can be in flight — `retirePip` refuses OnExpedition/
 * Returning before this is ever called), and `expedition` is nulled
 * defensively for the same reason.
 *
 * `ageMs`, `happinessIntegral`, `genome`, `name`, `evolved`, `mastery`,
 * and every other field are carried over untouched — this function never
 * touches them, and moving the Pip OUT of the live roster (the caller's
 * job) is what actually freezes them going forward (module doc).
 */
export function buildResident(
  pip: PipState,
  at: number,
  arrivalNeeds: PipNeeds,
  machineTuning?: MachineTuning,
): PipState {
  const snapped: PipState = {
    ...pip,
    needs: { ...arrivalNeeds },
    needsUpdatedAt: at,
  };
  const settled = evaluateSulk(snapped, machineTuning);
  return {
    ...settled,
    activity: PipActivity.Idle,
    pendingSulk: false,
    expedition: null,
  };
}

/**
 * The homecoming transform (bible §2.5): the resident's PipState returns
 * to the active roster EXACTLY as it was frozen (needs, ageMs,
 * happinessIntegral, genome, mastery — bit-for-bit), with only
 * `needsUpdatedAt` re-stamped to the retrieval moment (the same pattern a
 * freshly hatched Pip's `needsUpdatedAt: hatchedAt` uses, `pips/genome.ts`
 * `createPipFromGenome`) so the live TICK/CATCHUP loop picks it up
 * cleanly from here rather than computing elapsed time against a
 * months-stale timestamp.
 */
export function buildReturnee(record: SanctuaryRecord, at: number): PipState {
  return { ...record.pip, needsUpdatedAt: at };
}

/** Why a RETIRE_PIP request did not retire (bible §2.3's legality table).
 * `unknownPip` is structural (the UI should not have offered it);
 * `busy` = loot in flight, a reveal owed (OnExpedition/Returning);
 * `lastPip` = "someone has to hold the fort" (at `minActivePips`). */
export type RetireRefusalReason = "unknownPip" | "busy" | "lastPip";

/** Why a RETRIEVE_PIP ("Ask them home") request did not retrieve.
 * `unknownResident` is structural; `notSettled` = still inside
 * `minStayMs` (bible §2.5 — NOT a countdown, just a settling-in period);
 * `full` = the roster is at cap (a friendly refusal, never a wall).
 * `lost` (spec §16 v1.5, docs/lifecycle-bible.md §4) — this resident's
 * `reason` is `"lost"`: a memorial, not a pause. Only `core/pips/
 * ailment.ts`'s true-loss transition ever sets that reason, and nothing
 * may undo it — resurrecting a lost Pip back into the active roster would
 * break the whole tone of promise 3/4 ("only danger can truly take a
 * Pip"). An ailing-but-still-alive Pip retired by player choice (bible
 * §7.6) keeps `reason: "player"`/`"age"` and stays fully retrievable. */
export type RetrieveRefusalReason = "unknownResident" | "notSettled" | "full" | "lost";

/** What one RETIRE_PIP / RETRIEVE_PIP request did — parked in
 * `state.lastSanctuaryOutcome` for the UI, the same shape as every other
 * `last*Outcome` echo in `core/state.ts`. */
export type SanctuaryOutcome =
  | { readonly action: "retire"; readonly ok: true; readonly pipId: PipId; readonly at: number }
  | {
      readonly action: "retire";
      readonly ok: false;
      readonly pipId: PipId;
      readonly at: number;
      readonly reason: RetireRefusalReason;
    }
  | { readonly action: "retrieve"; readonly ok: true; readonly pipId: PipId; readonly at: number }
  | {
      readonly action: "retrieve";
      readonly ok: false;
      readonly pipId: PipId;
      readonly at: number;
      readonly reason: RetrieveRefusalReason;
    };

/**
 * The minimal state shape retire/retrieve operate on. Structural (like
 * `JobStateSlice`) so this module never imports `core/state.ts`; `GameState`
 * satisfies it.
 */
export interface SanctuaryHostState {
  readonly pips: Readonly<Record<PipId, PipState>>;
  readonly rosterOrder: readonly PipId[];
  readonly activePipId: PipId;
  readonly sanctuary: SanctuaryState;
  readonly keep: { readonly level: number };
}

export interface SanctuaryResult<S extends SanctuaryHostState> {
  readonly state: S;
  readonly outcome: SanctuaryOutcome;
}

/**
 * The retire legality check, as a PREDICATE (round 2C integrate stage).
 * `null` = "Send to the Long Meadow" is offerable right now; otherwise the
 * reason it is not.
 *
 * Split out of `retirePip` so the UI can decide whether to *draw* the
 * affordance instead of drawing it and then apologising: a confirm dialog
 * that only reveals "someone has to hold the fort" AFTER the player taps
 * Confirm is a worse experience than never offering it, and the bible's
 * refusal copy (§2.3) is there for the races this cannot prevent (a trip
 * that lands between render and tap), not as the primary path.
 *
 * `retirePip` delegates to this, so there is exactly ONE legality rule in
 * the codebase and the button can never disagree with the reducer.
 */
export function retireRefusal(
  state: SanctuaryHostState,
  pipId: PipId,
  tuning: SanctuaryTuning = contentTuning.retention.sanctuary,
): RetireRefusalReason | null {
  const pip = state.pips[pipId];
  if (pip === undefined) return "unknownPip";
  if (
    pip.activity === PipActivity.OnExpedition ||
    pip.activity === PipActivity.Returning
  ) {
    return "busy";
  }
  if (state.rosterOrder.length <= tuning.minActivePips) return "lastPip";
  return null;
}

/**
 * "Send to the Long Meadow" (bible §2.3). Legality mirrors care-action
 * legality (spec §4.7): Idle/Resting/Sulking/AssignedJob are all legal —
 * retiring a Sulking Pip is DELIBERATELY legal (bible §2.3: "a player
 * whose Pip is having a bad week should be able to give it a change of
 * scene" — the refusal list is structural, never moral) — only
 * OnExpedition/Returning (loot in flight) and the last active Pip are
 * refused.
 *
 * On success: the Pip moves WHOLESALE from `pips`/`rosterOrder` into
 * `sanctuary.pips`/`sanctuary.order` (the one-place invariant, module
 * doc), `activePipId` repoints to the first remaining roster Pip if the
 * retiree was active, and a fresh `SanctuaryRecord` is created via
 * `buildResident`. Job unassignment is the CALLER's responsibility (see
 * module doc) — this function does not touch `jobs`.
 */
export function retirePip<S extends SanctuaryHostState>(
  state: S,
  pipId: PipId,
  at: number,
  tuning: SanctuaryTuning = contentTuning.retention.sanctuary,
  reason: SanctuaryReason = "player",
): SanctuaryResult<S> {
  const blocked = retireRefusal(state, pipId, tuning);
  if (blocked !== null) {
    return {
      state,
      outcome: { action: "retire", ok: false, pipId, at, reason: blocked },
    };
  }
  // Non-null by the guard above — `retireRefusal` returns "unknownPip"
  // for a missing id, so reaching here means the Pip resolves.
  const pip = state.pips[pipId] as PipState;

  const resident = buildResident(pip, at, tuning.arrivalNeeds);
  const pips: Record<PipId, PipState> = { ...state.pips };
  delete pips[pipId];
  const rosterOrder = state.rosterOrder.filter((id) => id !== pipId);
  const activePipId =
    state.activePipId === pipId ? (rosterOrder[0] as PipId) : state.activePipId;

  const record: SanctuaryRecord = {
    pip: resident,
    retiredAt: at,
    retiredFromKeepLevel: state.keep.level,
    visits: 0,
    // ROUND 2H — always recorded, never inferred. `"player"` is the
    // default so every existing caller keeps its exact meaning; the
    // RETIRE_PIP reducer arm passes `"age"` for a Pip that had already
    // reached the end of a full life (promise 3).
    reason,
  };

  return {
    state: {
      ...state,
      pips,
      rosterOrder,
      activePipId,
      sanctuary: {
        pips: { ...state.sanctuary.pips, [pipId]: record },
        order: [...state.sanctuary.order, pipId],
      },
    },
    outcome: { action: "retire", ok: true, pipId, at },
  };
}

/**
 * "Ask them home" (bible §2.5). Free, always — the only gates are
 * `minStayMs` (a settling-in period, NOT a countdown — waiting costs
 * nothing) and the roster cap (refused warmly, never a wall: "the Keep's
 * full and cosy — swap someone out and she'll be along"). On success the
 * Pip moves back to the BACK of `rosterOrder`, at its frozen (arrival)
 * needs, Idle — one care round makes it Beaming (bible §2.5: "the
 * homecoming is a warm moment, not a repair job").
 */
export function retrievePip<S extends SanctuaryHostState>(
  state: S,
  pipId: PipId,
  at: number,
  rosterCap: number,
  minStayMs: number = contentTuning.retention.sanctuary.minStayMs,
): SanctuaryResult<S> {
  const refuse = (reason: RetrieveRefusalReason): SanctuaryResult<S> => ({
    state,
    outcome: { action: "retrieve", ok: false, pipId, at, reason },
  });

  const record = state.sanctuary.pips[pipId];
  if (record === undefined) return refuse("unknownResident");
  // ROUND 2H — a "lost" resident is a memorial, never a pause (see
  // `RetrieveRefusalReason`'s doc comment above). Checked before
  // `minStayMs`/roster-cap so a lost Pip is NEVER offered "ask them home"
  // regardless of how long ago they were lost or how much room there is.
  if (record.reason === "lost") return refuse("lost");
  if (at - record.retiredAt < minStayMs) return refuse("notSettled");
  if (state.rosterOrder.length >= rosterCap) return refuse("full");

  const returnee = buildReturnee(record, at);
  const sanctuaryPips: Record<PipId, SanctuaryRecord> = { ...state.sanctuary.pips };
  delete sanctuaryPips[pipId];

  return {
    state: {
      ...state,
      pips: { ...state.pips, [pipId]: returnee },
      rosterOrder: [...state.rosterOrder, pipId],
      sanctuary: {
        pips: sanctuaryPips,
        order: state.sanctuary.order.filter((id) => id !== pipId),
      },
    },
    outcome: { action: "retrieve", ok: true, pipId, at },
  };
}
