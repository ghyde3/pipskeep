/**
 * The Gathering job (spec §6.2) — assignment at a placed Gathering
 * Station, timestamp-derived production, and the catch-up integration.
 *
 * Assignment: ASSIGN_JOB → `assignPipToJob` — requires a PLACED station
 * whose item hosts a job (registry-driven so Crafting/Decorating slot in
 * later, spec §6.2), ONE pip per station, and a machine-legal pip
 * (`assignJob`: Idle only; Sulking pips refuse WITH a Refusal-context
 * line, spec §4.4/§4.7). The assignment lands in `state.jobs[pipId]`
 * with `lastProducedAt = at` — the production timer base.
 *
 * Production is DERIVED, never a timer (same rule as expedition returns,
 * spec §6.1): ticks are due at `lastProducedAt + k·intervalMs`. The job
 * therefore survives reload by construction — a reload mid-interval
 * resumes exactly where the timestamps say.
 *
 * - LIVE (TICK): `processJobProduction` rolls every due tick since
 *   `lastProducedAt`, in chronological order across all working pips
 *   (ties: roster order), one weighted roll each from the `"job"`
 *   stream (cursor in `state.rngState`, spec §2 rule 3).
 * - CATCH-UP: `collectJobCatchupEvents` registers one custom
 *   `"jobTick"` event per due tick through the runCatchup extraEvents
 *   seam — but ONLY inside the first `offlineRateCapMs` of the absence:
 *   production is a RATE and obeys the 12h cap (spec §4.5 rule 3 /
 *   §6.2), unlike expedition/egg timers. Each event's `apply` advances
 *   `lastProducedAt` and records the tick iff the pip is still
 *   AssignedJob at that moment (a pip that bottomed out and entered
 *   Sulking mid-window stops producing from that boundary — §4.4 "it
 *   refuses expeditions/jobs"). The reducer rolls the recorded ticks
 *   AFTER the pass, in fired (chronological) order — the same order the
 *   live path uses, so the `"job"` cursor advances identically either
 *   way. `shiftJobsPastFreeze` then skips the rate-frozen tail so the
 *   first live tick doesn't backfill 60h of "missed" production.
 *
 * Needs decay during a job at normal awake rates (spec §4.7: decay in
 * every state) — nothing here touches needs.
 *
 * Purity: no clock, no Math.random; `at` comes from the caller's
 * injected Clock, rolls from the seeded stream. ZERO tuning literals —
 * every number comes from tuning/content (defaults, injectable).
 */

import { tuning as contentTuning } from "../../content/tuning";
import { jobs as contentJobs } from "../../content/jobs";
import { foods as contentFoods } from "../../content/foods";
import { dialogue as contentDialogue } from "../../content/dialogue";
import { createRngFromState } from "../rng";
import type { Rng, RngStream } from "../rng";
import { PipActivity } from "../pips/types";
import type { PipId, PipState } from "../pips/types";
import { assignJob, unassignJob } from "../pips/machine";
import { DIALOGUE_STREAM, pickLineFromPools } from "../pips/dialogue";
import type { DialoguePoolsView, DialogueStateSlice } from "../pips/dialogue";
import type { CatchupEvent, CatchupState } from "../pips/catchup";
import type { KeepState, PlacementId } from "./index";

/** Name of the seeded RNG stream for job production rolls (spec §6.2). */
export const JOB_STREAM = "job";

/** Tag of the custom catch-up event one offline production tick fires
 * through the extraEvents seam. */
export const JOB_TICK_TAG = "jobTick";

/** One pip's standing job (spec §6.2), as persisted in `state.jobs`. */
export interface JobAssignment {
  /** Job registry id (`"gathering"` in MVP). */
  readonly jobId: string;
  /** The placed station hosting the work (one pip per station). */
  readonly stationPlacementId: PlacementId;
  /** Clock timestamp (ms) of the ASSIGN_JOB. */
  readonly assignedAt: number;
  /** Production timer base: ticks are due at `+ k·intervalMs`. Advances
   * to each produced tick's timestamp — never a stored countdown. */
  readonly lastProducedAt: number;
}

export type JobsByPip = Readonly<Record<PipId, JobAssignment>>;

/**
 * Structural view of one job registry entry as core needs it (content
 * ids are opaque — spec §2 rule 5). `content/jobs` satisfies this.
 */
export interface JobView {
  readonly id: string;
  readonly stationItemId: string;
  readonly intervalMs: number;
  readonly table: readonly { readonly itemId: string; readonly weight: number }[];
}

export type JobRegistryView = Readonly<Record<string, JobView>>;

/** Injectable content, defaulting to the real registries. */
export interface JobContent {
  readonly registry?: JobRegistryView;
  readonly pools?: DialoguePoolsView;
}

/**
 * The slice of GameState the job system reads/writes. Structural so this
 * module never imports core/state.ts; GameState satisfies it.
 */
export interface JobStateSlice extends DialogueStateSlice {
  readonly rosterOrder: readonly PipId[];
  readonly keep: KeepState;
  readonly jobs: JobsByPip;
  readonly inventory: Readonly<Record<string, number>>;
  readonly resources: Readonly<Record<string, number>>;
}

/**
 * Why an assignment/unassignment did not happen.
 * Pip-voiced (draws a Refusal line): `sulking`. Structural (no line —
 * the world said no): `unknownPip`, `unknownStation` (placement id not
 * placed, or its item hosts no job), `occupied` (spec §6.2: one pip per
 * station), `busy` (pip not Idle), `notAssigned` (unassign of a pip
 * that isn't on a job).
 */
export type JobRefusalReason =
  | "unknownPip"
  | "unknownStation"
  | "occupied"
  | "busy"
  | "sulking"
  | "notAssigned";

/** What one ASSIGN_JOB / UNASSIGN_JOB request did — the UI's
 * animation/dialogue source (parked in `state.lastJobOutcome`). */
export type JobOutcome =
  | {
      readonly action: "assignJob";
      readonly ok: true;
      readonly pipId: PipId;
      readonly jobId: string;
      readonly stationPlacementId: PlacementId;
      readonly at: number;
    }
  | {
      readonly action: "assignJob";
      readonly ok: false;
      readonly pipId: PipId;
      readonly stationPlacementId: PlacementId;
      readonly at: number;
      readonly reason: JobRefusalReason;
      /** Refusal dialogue, when the pip itself declined (sulking). */
      readonly lineId?: string;
      readonly line?: string;
    }
  | {
      readonly action: "unassignJob";
      readonly ok: true;
      readonly pipId: PipId;
    }
  | {
      readonly action: "unassignJob";
      readonly ok: false;
      readonly pipId: PipId;
      readonly reason: JobRefusalReason;
    };

export interface JobResult<S extends JobStateSlice> {
  readonly state: S;
  readonly outcome: JobOutcome;
}

/** The job hosted by a placed item, or undefined (registry scan — the
 * registry is tiny and content-defined). */
function jobForStationItem(
  itemId: string,
  registry: JobRegistryView,
): JobView | undefined {
  return Object.values(registry).find((job) => job.stationItemId === itemId);
}

/** True when some OTHER pip already works this station (spec §6.2: one
 * pip per station). */
function stationOccupied(
  jobs: JobsByPip,
  stationPlacementId: PlacementId,
  exceptPipId: PipId,
): boolean {
  return Object.entries(jobs).some(
    ([pipId, job]) =>
      pipId !== exceptPipId && job.stationPlacementId === stationPlacementId,
  );
}

/** Commit rng cursors + no-repeat memory after a refusal line draw
 * (same shape as expeditions' commitRefusalLine). */
function commitRefusalLine<S extends JobStateSlice>(
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
 * Assign a pip to the job hosted at a placed station (spec §6.2) at
 * `at`. Pure; refusals are typed outcomes, never exceptions. Structural
 * blocks consume zero rng rolls and return the input state untouched;
 * the Sulking refusal (via the state machine) draws one Refusal-context
 * line, advancing only the dialogue cursor and no-repeat memory.
 */
export function assignPipToJob<S extends JobStateSlice>(
  state: S,
  pipId: PipId,
  stationPlacementId: PlacementId,
  at: number,
  content: JobContent = {},
): JobResult<S> {
  const registry = content.registry ?? contentJobs;
  const pools = content.pools ?? contentDialogue;

  const refuse = (reason: JobRefusalReason): JobResult<S> => ({
    state,
    outcome: { action: "assignJob", ok: false, pipId, stationPlacementId, at, reason },
  });

  const pip = state.pips[pipId];
  if (pip === undefined) return refuse("unknownPip");

  const placement = state.keep.placements[stationPlacementId];
  if (placement === undefined) return refuse("unknownStation");
  const job = jobForStationItem(placement.itemId, registry);
  if (job === undefined) return refuse("unknownStation");
  if (stationOccupied(state.jobs, stationPlacementId, pipId)) {
    return refuse("occupied");
  }

  const result = assignJob(pip);
  if (!result.ok) {
    if (result.refusal.kind !== "sulking") return refuse("busy");
    // The pip SAYS no (spec §4.4/§4.7) — one Refusal-context line.
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
        action: "assignJob",
        ok: false,
        pipId,
        stationPlacementId,
        at,
        reason: "sulking",
        ...(line !== null ? { lineId: line.lineId, line: line.text } : {}),
      },
    };
  }

  return {
    state: {
      ...state,
      pips: { ...state.pips, [pip.id]: result.pip },
      jobs: {
        ...state.jobs,
        [pip.id]: {
          jobId: job.id,
          stationPlacementId,
          assignedAt: at,
          lastProducedAt: at,
        },
      },
    },
    outcome: {
      action: "assignJob",
      ok: true,
      pipId,
      jobId: job.id,
      stationPlacementId,
      at,
    },
  };
}

/**
 * Return a working pip to Idle (spec §6.2: jobs have no natural end —
 * the player unassigns). Drops the `state.jobs` entry; partial progress
 * toward the next tick is simply abandoned (no fractional production).
 */
export function unassignPipFromJob<S extends JobStateSlice>(
  state: S,
  pipId: PipId,
): JobResult<S> {
  const refuse = (reason: JobRefusalReason): JobResult<S> => ({
    state,
    outcome: { action: "unassignJob", ok: false, pipId, reason },
  });

  const pip = state.pips[pipId];
  if (pip === undefined) return refuse("unknownPip");

  const result = unassignJob(pip);
  if (!result.ok) return refuse("notAssigned");

  const jobs: Record<PipId, JobAssignment> = { ...state.jobs };
  delete jobs[pipId];
  return {
    state: { ...state, pips: { ...state.pips, [pip.id]: result.pip }, jobs },
    outcome: { action: "unassignJob", ok: true, pipId },
  };
}

/** One due production tick: WHEN it lands, WHO produced, from WHICH job
 * table. Plain data — the roll happens at settle time. */
export interface JobTick {
  readonly at: number;
  readonly pipId: PipId;
  readonly jobId: string;
}

/** One weighted pick from a job table. Consumes exactly one roll. */
function pickWeighted(
  stream: RngStream,
  table: JobView["table"],
): string {
  const total = table.reduce((sum, entry) => sum + entry.weight, 0);
  let r = stream.next() * total;
  for (const entry of table) {
    r -= entry.weight;
    if (r < 0) return entry.itemId;
  }
  // Float-edge fallback (r landed exactly on total): last entry.
  return (table[table.length - 1] as JobView["table"][number]).itemId;
}

/** The minimal slice tick-settling touches (production is inventory/
 * resources + rng only — `jobs`/pips bookkeeping stays with the caller). */
export interface JobRollSlice {
  readonly seed: number;
  readonly rngState: Readonly<Record<string, number>>;
  readonly inventory: Readonly<Record<string, number>>;
  readonly resources: Readonly<Record<string, number>>;
}

/**
 * Roll production for already-determined ticks, in the given order: one
 * weighted `"job"`-stream roll per tick (spec §6.2 — 1 item per tick),
 * cursor committed. Produced items route exactly like expedition loot
 * (spec §6.3, the ACKNOWLEDGE_REVEAL rule): food-registry members land
 * in the INVENTORY (Berries are food first), everything else is a
 * resource. Ticks whose job id is missing from the registry (content
 * removed between sessions) are skipped with zero rolls. Callers pass
 * ticks in chronological order — both the live and catch-up paths do —
 * so the cursor advance is identical whichever path processed the same
 * timeline (spec §2 rule 3).
 */
export function settleJobTicks<S extends JobRollSlice>(
  state: S,
  ticks: readonly JobTick[],
  content: JobContent = {},
): S {
  if (ticks.length === 0) return state;
  const registry = content.registry ?? contentJobs;
  const foodRegistry: Readonly<Record<string, unknown>> = contentFoods;

  const rng = createRngFromState(state.seed, state.rngState);
  const stream = rng.stream(JOB_STREAM);
  const inventory: Record<string, number> = { ...state.inventory };
  const resources: Record<string, number> = { ...state.resources };
  let rolled = false;
  for (const tick of ticks) {
    const job = registry[tick.jobId];
    if (job === undefined || job.table.length === 0) continue;
    const itemId = pickWeighted(stream, job.table);
    const bucket = foodRegistry[itemId] !== undefined ? inventory : resources;
    bucket[itemId] = (bucket[itemId] ?? 0) + 1;
    rolled = true;
  }
  if (!rolled) return state;
  return { ...state, inventory, resources, rngState: rng.getState() };
}

/**
 * LIVE production (the TICK path): every due tick since each working
 * pip's `lastProducedAt` up to `at` (inclusive), across all jobs, in
 * chronological order (ties: roster order), rolled via settleJobTicks;
 * each job's `lastProducedAt` advances to its last produced tick. Pips
 * no longer in AssignedJob produce nothing (reconcileJobs prunes them).
 */
export function processJobProduction<S extends JobStateSlice>(
  state: S,
  at: number,
  content: JobContent = {},
): S {
  const registry = content.registry ?? contentJobs;

  const due: JobTick[] = [];
  for (const [pipId, job] of Object.entries(state.jobs)) {
    const pip = state.pips[pipId];
    if (pip === undefined || pip.activity !== PipActivity.AssignedJob) continue;
    const def = registry[job.jobId];
    if (def === undefined || def.intervalMs <= 0) continue;
    for (let t = job.lastProducedAt + def.intervalMs; t <= at; t += def.intervalMs) {
      due.push({ at: t, pipId, jobId: job.jobId });
    }
  }
  if (due.length === 0) return state;

  const rosterIndex = (pipId: PipId): number => {
    const index = state.rosterOrder.indexOf(pipId);
    return index === -1 ? state.rosterOrder.length : index;
  };
  due.sort((a, b) => a.at - b.at || rosterIndex(a.pipId) - rosterIndex(b.pipId));

  let next = settleJobTicks(state, due, content);
  const jobs: Record<PipId, JobAssignment> = { ...next.jobs };
  for (const tick of due) {
    const job = jobs[tick.pipId];
    if (job !== undefined && tick.at > job.lastProducedAt) {
      jobs[tick.pipId] = { ...job, lastProducedAt: tick.at };
    }
  }
  return { ...next, jobs };
}

/**
 * Drop job entries whose pip is gone or no longer AssignedJob (Sulking
 * entry pulls a pip off its job for good — spec §4.4 "refuses
 * expeditions/jobs"; Sulking exits to Idle, never back to the station),
 * and entries whose station placement no longer exists (defensive; the
 * REMOVE_ITEM reducer already unassigns actively). Returns the input by
 * reference when nothing changed.
 */
export function reconcileJobs(
  jobs: JobsByPip,
  pips: Readonly<Record<PipId, PipState>>,
  keep: KeepState,
): JobsByPip {
  let changed = false;
  const next: Record<PipId, JobAssignment> = {};
  for (const [pipId, job] of Object.entries(jobs)) {
    const pip = pips[pipId];
    if (
      pip === undefined ||
      pip.activity !== PipActivity.AssignedJob ||
      keep.placements[job.stationPlacementId] === undefined
    ) {
      changed = true;
      continue;
    }
    next[pipId] = job;
  }
  return changed ? next : jobs;
}

/** The catch-up state shape the job collector operates on: pips (array
 * view, per the engine) + jobs + the tick record the reducer settles
 * after the pass. */
export interface JobCatchupState extends CatchupState {
  readonly jobs: JobsByPip;
  /** Ticks that actually fired (pip still working), in fired order. */
  readonly firedJobTicks: readonly JobTick[];
}

/** The slice of tuning the collector reads (the §4.5 rate cap). */
export interface JobCatchupTuning {
  readonly offlineRateCapMs: number;
}

/**
 * Catch-up event collector for the runCatchup extraEvents seam (spec
 * §4.5 rule 1 "Gathering production ticks"): one custom `"jobTick"`
 * event per due tick inside the absence window, CAPPED at the first
 * `offlineRateCapMs` of absence — production is a rate, and rates
 * freeze after the cap (spec §4.5 rule 3 / §6.2). Each event's `apply`
 * advances the job's `lastProducedAt` and records the tick in
 * `firedJobTicks` iff the pip is still AssignedJob at that moment; the
 * reducer rolls the recorded ticks after the pass, in this same
 * chronological order (see module doc).
 */
export function collectJobCatchupEvents<S extends JobCatchupState>(
  state: S,
  windowStart: number,
  windowEnd: number,
  tuning: JobCatchupTuning = contentTuning,
  registry: JobRegistryView = contentJobs,
): CatchupEvent<S>[] {
  const ratedEnd = Math.min(windowEnd, windowStart + tuning.offlineRateCapMs);
  const events: CatchupEvent<S>[] = [];
  for (const [pipId, job] of Object.entries(state.jobs)) {
    const def = registry[job.jobId];
    if (def === undefined || def.intervalMs <= 0) continue;
    for (let t = job.lastProducedAt + def.intervalMs; t <= ratedEnd; t += def.intervalMs) {
      if (t <= windowStart) continue;
      events.push({
        kind: "custom",
        at: t,
        tag: JOB_TICK_TAG,
        pipId,
        apply: (s: S): S => {
          const current = s.jobs[pipId];
          if (current === undefined) return s;
          const pip = s.pips.find((p) => p.id === pipId);
          if (pip === undefined || pip.activity !== PipActivity.AssignedJob) {
            return s;
          }
          return {
            ...s,
            jobs: {
              ...s.jobs,
              [pipId]: { ...current, lastProducedAt: t },
            },
            firedJobTicks: [
              ...s.firedJobTicks,
              { at: t, pipId, jobId: current.jobId },
            ],
          };
        },
      });
    }
  }
  return events;
}

/**
 * After a catch-up pass that hit the rate cap: slide every surviving
 * job's production base past the rate-frozen tail (`cappedMs` = elapsed
 * − rated). The frozen stretch simply does not count for production —
 * without this, the first live TICK would "backfill" every tick of a
 * long absence in one burst, dodging the cap (spec §4.5 rule 3).
 */
export function shiftJobsPastFreeze(jobs: JobsByPip, cappedMs: number): JobsByPip {
  if (cappedMs <= 0 || Object.keys(jobs).length === 0) return jobs;
  const next: Record<PipId, JobAssignment> = {};
  for (const [pipId, job] of Object.entries(jobs)) {
    next[pipId] = { ...job, lastProducedAt: job.lastProducedAt + cappedMs };
  }
  return next;
}
