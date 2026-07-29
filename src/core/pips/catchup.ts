/**
 * Offline catch-up (spec §4.5) — ONE chronological segmented pass.
 *
 * On load, `runCatchup(state, savedAt, now)`:
 *
 * 1. clamps `elapsed = max(0, now − savedAt)` — negative elapsed (clock
 *    rolled back) is zero change, nothing ever moves backwards;
 * 2. collects timed events with absolute timestamps in `(savedAt, now]`:
 *    expedition returns (`departedAt + durationMs`), Pipling→Adult moments
 *    (`adultAt`), Rest auto-wakes (generated ITERATIVELY during the pass —
 *    a pip that only starts Resting mid-window via an event still wakes at
 *    its computable moment), plus caller-supplied events through the
 *    `extraEvents` seam (Phase 4 adds egg completions, Phase 5 job ticks,
 *    without touching this engine);
 * 3. processes segments chronologically: within each segment, need rates
 *    use the pip's activity DURING that segment (Clingy's ×2.0 happiness
 *    penalty only while OnExpedition/Returning; Rest regen only until the
 *    auto-wake fires), via `applyNeedsDelta` on the current activity;
 * 4. applies THE RATE CAP (spec §4.5 rule 3): need changes accrue only for
 *    the portion of each segment overlapping `[savedAt, savedAt + capMs]`.
 *    Events past the cap STILL FIRE and still change activity/life stage —
 *    rates simply contribute zero there ("rates are capped, timers are
 *    not"). `ageMs` and `happinessIntegral` accrue across the ENTIRE
 *    window: frozen happiness keeps counting toward the lifetime average
 *    at its frozen value (spec §4.6, via `accrueFrozenTime`);
 * 5. evaluates Sulking entry/exit at every segment boundary and at the end
 *    of the pass (spec §4.5 rule 5) — pips that bottom out while away get
 *    `pendingSulk` and convert to Sulking the moment they land (§4.4).
 *
 * Consequence of the cap worth naming: a Resting pip whose computed wake
 * moment lands PAST the cap never wakes during the pass — its energy
 * freezes below the threshold, so the "timer" (which is defined by the
 * energy trajectory itself, not a stored timestamp) never elapses. It is
 * still Resting at load and resumes regenerating on the first live tick.
 *
 * Start-of-pass normalization (defensive, spec-silent → smallest rule):
 * a consistent save is untouched, but before segmenting we heal states the
 * live loop would already have resolved — overdue adulthood, an overdue
 * expedition return (its timer elapsed before `savedAt`; recorded at
 * `savedAt` since the true moment predates the window), an already-due
 * rest wake, and stale Sulking entry/exit. Pips saved as `Returning` are
 * deliberately LEFT WAITING: the principled line is "timers fire,
 * player-gated states wait" — Returning has no timer, it waits for the
 * player's collect (Phase 4). In-window returns, by contrast, collapse
 * OnExpedition → Returning → Idle at the return moment (offline returns
 * are auto-collected into the "While you were away…" sheet).
 *
 * The output `CatchupSummary` (per-pip needs deltas, fired events with
 * timestamps, elapsed/rated/capped ms) is the data source for that sheet.
 *
 * Purity: no clock access — `savedAt`/`now` come from the caller's
 * injected Clock. ZERO tuning literals; every threshold and rate comes
 * from the tuning object (defaults to `content/tuning.ts`, injectable for
 * tests). The only numeric constants are structural (0 clamps/guards).
 */

import { HOUR_MS, tuning as contentTuning } from "../../content/tuning";
import { LifeStage, NEED_IDS, PipActivity } from "./types";
import type {
  ActiveExpedition,
  NeedId,
  PipId,
  PipNeeds,
  PipState,
} from "./types";
import { accrueFrozenTime, applyNeedsDelta } from "./needs";
import type { NeedsTuning } from "./needs";
import {
  arriveHome,
  beginReturn,
  evaluateRestAutoWake,
  evaluateSulk,
  wake,
} from "./machine";
import type { MachineTuning } from "./machine";
import { adultAt, updateLifeStage } from "./lifecycle";
import type { LifecycleTuning } from "./lifecycle";

/**
 * The slice of tuning catch-up reads: everything the needs math, state
 * machine, and lifecycle read (their segments run inside this pass), plus
 * the offline rate cap. An intersection (not `extends`) because the member
 * slices declare sibling fields under the same keys (`care`, `pipling`).
 * `content/tuning.ts` satisfies the whole thing.
 */
export type CatchupTuning = NeedsTuning &
  MachineTuning &
  LifecycleTuning & {
    /**
     * Spec §4.5 rule 3: needs change (decay AND regen) accrues only during
     * the first this-many ms of absence; after that, rates freeze.
     */
    readonly offlineRateCapMs: number;
  };

/**
 * The minimal state shape the engine operates on. `runCatchup` is generic
 * over any state extending this, so later phases pass the full GameState
 * and custom events can edit their own slices of it.
 */
export interface CatchupState {
  readonly pips: readonly PipState[];
}

/** A Resting pip's computed Energy-reaches-threshold moment (§4.5 rule 1). */
export interface RestAutoWakeEvent {
  readonly kind: "restAutoWake";
  readonly at: number;
  readonly pipId: PipId;
}

/** An expedition timer elapsing (never capped, spec §4.5 rule 4). */
export interface ExpeditionReturnEvent {
  readonly kind: "expeditionReturn";
  readonly at: number;
  readonly pipId: PipId;
  /**
   * Snapshot of the trip, kept on the event because `arriveHome` clears
   * `pip.expedition` — Phase 4 resolves loot for the away sheet from this.
   */
  readonly expedition: ActiveExpedition;
}

/** A Pipling crossing `adultAt` mid-window — the ×1.2 decay ends here (§4.6). */
export interface BecameAdultEvent {
  readonly kind: "becameAdult";
  readonly at: number;
  readonly pipId: PipId;
}

/**
 * The generic seam (spec §12 discipline): future phases add egg
 * completions, job production ticks, etc. as `custom` events WITHOUT
 * modifying this engine. `apply` runs when the event fires and may edit
 * any part of the caller's state; the engine re-evaluates Sulking and
 * rest auto-wake for every pip afterwards, and the event still splits the
 * segment (so rate changes it causes take effect from its timestamp).
 */
export interface CustomCatchupEvent<S extends CatchupState = CatchupState> {
  readonly kind: "custom";
  readonly at: number;
  /** Names the concrete event for summaries (e.g. `"eggCompletion"`). */
  readonly tag: string;
  /** Optional pip this event concerns, for the away sheet. */
  readonly pipId?: PipId;
  /** State edit applied when the event fires. Omit for marker-only events. */
  readonly apply?: (state: S) => S;
}

/** Every event kind the pass can process (spec §4.5 rule 1). */
export type CatchupEvent<S extends CatchupState = CatchupState> =
  | RestAutoWakeEvent
  | ExpeditionReturnEvent
  | BecameAdultEvent
  | CustomCatchupEvent<S>;

/**
 * An event as recorded in the summary — plain data for the away sheet
 * (custom events are recorded without their `apply` function).
 */
export type CatchupFiredEvent =
  | RestAutoWakeEvent
  | ExpeditionReturnEvent
  | BecameAdultEvent
  | Omit<CustomCatchupEvent<CatchupState>, "apply">;

/**
 * Event-collection seam: called once, after start-of-pass normalization,
 * with the window bounds; returned events outside `(windowStart,
 * windowEnd]` are ignored.
 */
export type CatchupEventCollector<S extends CatchupState> = (
  state: S,
  windowStart: number,
  windowEnd: number,
) => readonly CatchupEvent<S>[];

/** What one pip went through while the player was away. */
export interface PipCatchupDelta {
  readonly pipId: PipId;
  readonly activityBefore: PipActivity;
  readonly activityAfter: PipActivity;
  readonly needsBefore: PipNeeds;
  readonly needsAfter: PipNeeds;
  /** `needsAfter − needsBefore`, per need (post-clamp). */
  readonly needsDelta: Readonly<Record<NeedId, number>>;
}

/** Data source for the "While you were away…" sheet (spec §4.5). */
export interface CatchupSummary {
  /** Clamped absence length: `max(0, now − savedAt)`. */
  readonly elapsedMs: number;
  /** Leading portion during which rates accrued: `min(elapsedMs, capMs)`. */
  readonly ratedMs: number;
  /** Trailing rate-frozen portion: `elapsedMs − ratedMs`. */
  readonly cappedMs: number;
  /** Everything that fired, in chronological order. */
  readonly events: readonly CatchupFiredEvent[];
  /** One entry per pip present at the end of the pass, in state order. */
  readonly pips: readonly PipCatchupDelta[];
}

export interface CatchupResult<S extends CatchupState> {
  readonly state: S;
  readonly summary: CatchupSummary;
}

/**
 * Structural pips replacement preserving every other field of the
 * caller's state type. The cast is safe: only `pips` — a declared
 * `CatchupState` field — is overwritten.
 */
function replacePips<S extends CatchupState>(
  state: S,
  pips: readonly PipState[],
): S {
  return { ...state, pips } as S;
}

function replacePip<S extends CatchupState>(state: S, pip: PipState): S {
  return replacePips(
    state,
    state.pips.map((existing) => (existing.id === pip.id ? pip : existing)),
  );
}

function getPip(state: CatchupState, pipId: PipId): PipState | undefined {
  return state.pips.find((pip) => pip.id === pipId);
}

/**
 * Advance one pip through `[from, to]` in its CURRENT activity, splitting
 * at the rate cap: the overlap with `[savedAt, capAt]` moves needs via
 * `applyNeedsDelta`; the remainder passes through `accrueFrozenTime`
 * (needs frozen, `ageMs`/`happinessIntegral` still accruing — §4.6).
 */
function advanceThroughCap(
  pip: PipState,
  from: number,
  to: number,
  capAt: number,
  tuning: CatchupTuning,
): PipState {
  let next = pip;
  const ratedEnd = Math.min(to, capAt);
  if (ratedEnd > from) {
    next = applyNeedsDelta(next, (ratedEnd - from) / HOUR_MS, tuning);
  }
  const frozenStart = Math.max(from, capAt);
  if (to > frozenStart) {
    next = accrueFrozenTime(next, (to - frozenStart) / HOUR_MS);
  }
  return next;
}

/**
 * Built-in statically-knowable events: expedition returns and Pipling →
 * Adult moments inside `(windowStart, windowEnd]`. Rest auto-wakes are NOT
 * collected here — they depend on the energy trajectory, so the main loop
 * regenerates them iteratively at every boundary.
 */
function collectBuiltInEvents<S extends CatchupState>(
  pips: readonly PipState[],
  windowStart: number,
  windowEnd: number,
  tuning: CatchupTuning,
): CatchupEvent<S>[] {
  const events: CatchupEvent<S>[] = [];
  for (const pip of pips) {
    if (pip.activity === PipActivity.OnExpedition && pip.expedition !== null) {
      const at = pip.expedition.departedAt + pip.expedition.durationMs;
      if (at > windowStart && at <= windowEnd) {
        events.push({
          kind: "expeditionReturn",
          at,
          pipId: pip.id,
          expedition: pip.expedition,
        });
      }
    }
    if (pip.lifeStage === LifeStage.Pipling) {
      const at = adultAt(pip, tuning);
      if (at > windowStart && at <= windowEnd) {
        events.push({ kind: "becameAdult", at, pipId: pip.id });
      }
    }
  }
  return events;
}

/**
 * Start-of-pass normalization at `savedAt` (see module doc): heal what the
 * live loop would already have resolved. No-op on a consistent save.
 * Overdue expedition returns are the one healing recorded as a fired event
 * (clamped to `savedAt`) — the player still wants their loot reported.
 */
function normalizeAtStart<S extends CatchupState>(
  state: S,
  savedAt: number,
  tuning: CatchupTuning,
): { state: S; events: CatchupFiredEvent[] } {
  const events: CatchupFiredEvent[] = [];
  const pips = state.pips.map((pip) => {
    let next = updateLifeStage(pip, savedAt, tuning);
    if (
      next.activity === PipActivity.OnExpedition &&
      next.expedition !== null &&
      next.expedition.departedAt + next.expedition.durationMs <= savedAt
    ) {
      const expedition = next.expedition;
      const returning = beginReturn(next);
      if (returning.ok) {
        const home = arriveHome(returning.pip);
        if (home.ok) {
          next = home.pip;
          events.push({
            kind: "expeditionReturn",
            at: savedAt,
            pipId: next.id,
            expedition,
          });
        }
      }
    }
    next = evaluateSulk(next, tuning);
    next = evaluateRestAutoWake(next, tuning);
    return next;
  });
  return { state: replacePips(state, pips), events };
}

/** Fire one queued (non-wake) event; refusals mean a stale/duplicate event
 * for the pip's current activity and are skipped without recording. */
function fireStaticEvent<S extends CatchupState>(
  state: S,
  event: CatchupEvent<S>,
  tuning: CatchupTuning,
  fired: CatchupFiredEvent[],
): S {
  switch (event.kind) {
    case "restAutoWake": {
      // Engine-generated wakes are handled inline in the main loop; this
      // arm only serves externally supplied wake events (extraEvents seam).
      const pip = getPip(state, event.pipId);
      if (pip === undefined) return state;
      const woken = wake(pip);
      if (!woken.ok) return state;
      fired.push({ kind: "restAutoWake", at: event.at, pipId: event.pipId });
      return replacePip(state, woken.pip);
    }
    case "expeditionReturn": {
      const pip = getPip(state, event.pipId);
      if (pip === undefined) return state;
      // Offline returns collapse OnExpedition → Returning → Idle at the
      // return moment: the away sheet auto-collects (module doc). The
      // pre-event Sulking evaluation already ran, so a pip that bottomed
      // out while away carries pendingSulk and lands Sulking (§4.4).
      const returning = beginReturn(pip);
      if (!returning.ok) return state;
      const home = arriveHome(returning.pip);
      if (!home.ok) return state;
      fired.push({
        kind: "expeditionReturn",
        at: event.at,
        pipId: event.pipId,
        expedition: event.expedition,
      });
      return replacePip(state, home.pip);
    }
    case "becameAdult": {
      const pip = getPip(state, event.pipId);
      if (pip === undefined || pip.lifeStage !== LifeStage.Pipling) {
        return state;
      }
      fired.push({ kind: "becameAdult", at: event.at, pipId: event.pipId });
      return replacePip(state, updateLifeStage(pip, event.at, tuning));
    }
    case "custom": {
      fired.push({
        kind: "custom",
        at: event.at,
        tag: event.tag,
        pipId: event.pipId,
      });
      return event.apply !== undefined ? event.apply(state) : state;
    }
  }
}

const zeroNeedsDelta = (): Record<NeedId, number> => {
  const delta = {} as Record<NeedId, number>;
  for (const need of NEED_IDS) delta[need] = 0;
  return delta;
};

/**
 * The chronological catch-up pass (spec §4.5). See module doc for the
 * full contract. `savedAt`/`now` are absolute Clock timestamps supplied by
 * the caller (core never reads a clock itself).
 *
 * `extraEvents` is the extension seam: either a ready event list or a
 * collector called with the (normalized) state and window bounds. Events
 * outside `(savedAt, now]` are ignored.
 */
export function runCatchup<S extends CatchupState>(
  state: S,
  savedAt: number,
  now: number,
  tuning: CatchupTuning = contentTuning,
  extraEvents?: readonly CatchupEvent<S>[] | CatchupEventCollector<S>,
): CatchupResult<S> {
  const elapsedMs = Math.max(0, now - savedAt);
  const startPips = state.pips;

  // Negative or zero elapsed: zero change, by construction (spec §4.5:
  // clock rolled back clamps to 0 — never negative decay, never rewound
  // timers). The input state is returned untouched, not even normalized.
  if (elapsedMs <= 0) {
    return {
      state,
      summary: {
        elapsedMs: 0,
        ratedMs: 0,
        cappedMs: 0,
        events: [],
        pips: startPips.map((pip) => ({
          pipId: pip.id,
          activityBefore: pip.activity,
          activityAfter: pip.activity,
          needsBefore: { ...pip.needs },
          needsAfter: { ...pip.needs },
          needsDelta: zeroNeedsDelta(),
        })),
      },
    };
  }

  const windowEnd = now;
  const ratedMs = Math.min(elapsedMs, tuning.offlineRateCapMs);
  const capAt = savedAt + tuning.offlineRateCapMs;

  const fired: CatchupFiredEvent[] = [];
  const normalized = normalizeAtStart(state, savedAt, tuning);
  let current = normalized.state;
  fired.push(...normalized.events);

  const extras =
    typeof extraEvents === "function"
      ? extraEvents(current, savedAt, windowEnd)
      : (extraEvents ?? []);

  // Static queue: events knowable up front, chronological (stable sort —
  // same-timestamp events keep collection order: built-ins, then extras).
  const queue = [
    ...collectBuiltInEvents<S>(current.pips, savedAt, windowEnd, tuning),
    ...extras,
  ]
    .filter((event) => event.at > savedAt && event.at <= windowEnd)
    .sort((a, b) => a.at - b.at);

  const { energyPerHour, autoWakeAtEnergy } = tuning.care.rest;
  let t = savedAt;
  let queueIndex = 0;

  while (t < windowEnd) {
    // (1) Regenerate Rest auto-wake candidates from the CURRENT trajectory
    // (iterative — spec §4.5 rule 1's "computable moment", recomputed so
    // pips that started Resting mid-window are covered). A wake landing
    // past the rate cap never fires: energy freezes below the threshold.
    const wakeCandidates: { pipId: PipId; at: number }[] = [];
    if (t < capAt && energyPerHour > 0) {
      for (const pip of current.pips) {
        if (pip.activity !== PipActivity.Resting) continue;
        const deficit = autoWakeAtEnergy - pip.needs.energy;
        if (deficit <= 0) continue; // already due — healed at boundaries
        const at = t + (deficit / energyPerHour) * HOUR_MS;
        if (at <= capAt && at <= windowEnd) {
          wakeCandidates.push({ pipId: pip.id, at });
        }
      }
    }

    // (2) Next segment boundary: earliest of the next static event, the
    // earliest wake, or the end of the window. Always > t (queue times are
    // strictly ahead after step 4, wake times are strictly ahead by
    // construction), so the pass always terminates.
    let nextAt = windowEnd;
    const nextStatic = queue[queueIndex];
    if (nextStatic !== undefined) nextAt = Math.min(nextAt, nextStatic.at);
    for (const candidate of wakeCandidates) {
      nextAt = Math.min(nextAt, candidate.at);
    }

    // (3) Advance every pip through the segment in its CURRENT activity,
    // splitting rated vs frozen time at the cap (spec §4.5 rules 2–3).
    current = replacePips(
      current,
      current.pips.map((pip) =>
        advanceThroughCap(pip, t, nextAt, capAt, tuning),
      ),
    );
    t = nextAt;

    // (4) Boundary evaluation BEFORE events fire (spec §4.5 rule 5): a pip
    // that bottomed out while away gets pendingSulk here, so an
    // expeditionReturn at this same boundary lands it Sulking (§4.4).
    current = replacePips(
      current,
      current.pips.map((pip) => evaluateSulk(pip, tuning)),
    );

    // (5) Fire wake events due exactly now. Direct wake() rather than the
    // ≥-threshold evaluator: the segment was split at the computed moment,
    // so this is exact even if float rounding left energy a hair short.
    // Skipped (unrecorded) if the pip stopped Resting at this boundary —
    // e.g. a need hit 0 and Sulking entry in step 4 won.
    for (const candidate of wakeCandidates) {
      if (candidate.at !== t) continue;
      const pip = getPip(current, candidate.pipId);
      if (pip === undefined || pip.activity !== PipActivity.Resting) continue;
      const woken = wake(pip);
      if (woken.ok) {
        current = replacePip(current, woken.pip);
        fired.push({ kind: "restAutoWake", at: t, pipId: candidate.pipId });
      }
    }

    // (6) Fire static events due exactly now (chronological; ties fire in
    // queue order).
    while (true) {
      const event = queue[queueIndex];
      if (event === undefined || event.at !== t) break;
      queueIndex += 1;
      current = fireStaticEvent(current, event, tuning, fired);
    }

    // (7) Post-event evaluation: events may have changed activities or
    // needs (arriveHome, custom edits) — Sulking entry/exit again, plus
    // rest auto-wake healing for custom events that filled a Resting
    // pip's energy outright.
    current = replacePips(
      current,
      current.pips.map((pip) =>
        evaluateRestAutoWake(evaluateSulk(pip, tuning), tuning),
      ),
    );
  }

  const before = new Map(startPips.map((pip) => [pip.id, pip]));
  const perPip: PipCatchupDelta[] = current.pips.map((pip) => {
    const start = before.get(pip.id) ?? pip; // pip added mid-pass → zero delta
    const needsDelta = {} as Record<NeedId, number>;
    for (const need of NEED_IDS) {
      needsDelta[need] = pip.needs[need] - start.needs[need];
    }
    return {
      pipId: pip.id,
      activityBefore: start.activity,
      activityAfter: pip.activity,
      needsBefore: { ...start.needs },
      needsAfter: { ...pip.needs },
      needsDelta,
    };
  });

  return {
    state: current,
    summary: {
      elapsedMs,
      ratedMs,
      cappedMs: elapsedMs - ratedMs,
      events: fired,
      pips: perPip,
    },
  };
}
