/**
 * Pip focus view (spec §10 two views): tap the active pip's portrait (or
 * the identity row's Info affordance) and the Keep view slides under an
 * overlay panel — large procedural portrait, name + species + personality
 * (with a one-line blurb), four stat readouts, life stage, and the
 * EXPEDITIONS list: all three destinations with flavor, duration, unlock
 * state, and a Send button when this pip can go (spec §6.1). An
 * OnExpedition pip shows its destination and a live remaining-time
 * countdown (derived from departedAt + durationMs — no timers persisted,
 * spec §6.1). Close returns to the Keep view.
 *
 * Refusals: Send always dispatches — legality lives in core (spec §4.7).
 * When the pip itself says no (Sulking / Pipling) the core draws a
 * personality-appropriate Refusal line; `sync` diffs `lastAssignOutcome`
 * and surfaces that line in-panel. Structural blocks (locked, occupied,
 * busy) never reach dispatch: the rows disable themselves with warm copy
 * instead — the world said no, not the pip.
 *
 * Architecture: `buildFocusModel` + friends are PURE (state in, view
 * model out — node-testable, no DOM); `createFocusView` is the dumb DOM
 * shell that renders the model and dispatches actions.
 */

import type { Clock } from "../core/clock";
import type { GameAction, GameState } from "../core/state";
import { LifeStage, NEED_IDS, PipActivity } from "../core/pips/types";
import type { NeedId, PipState } from "../core/pips/types";
import {
  effectiveExpeditionDurationMs,
} from "../core/expeditions";
import type { AssignExpeditionOutcome } from "../core/expeditions";
import type { JobOutcome } from "../core/keep/jobs";
import type { PlacementId } from "../core/keep";
import { EXPEDITION_IDS, expeditions } from "../content/expeditions";
import { jobs as contentJobs } from "../content/jobs";
import { placeables } from "../content/placeables";
import { personalities } from "../content/personalities";
import type { PersonalityId } from "../content/personalities";
import { species } from "../content/species";
import {
  moodColors,
  needColors,
  needDangerColor,
  needWarnColor,
  resolvePipPalette,
} from "../content/palette";
import { peekDisplayedMood } from "./topBar";
import { sound } from "../app/sound";

/** Bar color-shift thresholds — same readout language as the top bar. */
const WARN_BELOW = 40;
const DANGER_BELOW = 15;

const NEED_LABELS: Record<NeedId, string> = {
  hunger: "Food",
  cleanliness: "Clean",
  happiness: "Happy",
  energy: "Energy",
};

/**
 * One-line personality blurbs (spec §15.5 tone: warm, mischievous,
 * opinionated). Exported so tests can hold copy to the roster.
 */
export const PERSONALITY_BLURBS: Readonly<Record<string, string>> = {
  lazy: "Professional napper. Will absolutely move mountains — tomorrow.",
  curious: "Licks first, asks questions second. For science.",
  hardworking: "Thinks rest is just planning with your eyes closed.",
  chaotic: "Has a plan. Nobody knows what it is. Including them.",
  clingy: "Your shadow's shadow. Happiest within hugging distance.",
};

const FALLBACK_BLURB = "A Pip of mysterious habits and strong opinions.";

/** Blurb for a personality id — never empty, never crashes. */
export function personalityBlurb(personalityId: string): string {
  return PERSONALITY_BLURBS[personalityId] ?? FALLBACK_BLURB;
}

/** Life-stage readout (spec §4.6): short, warm. */
export function lifeStageLabel(stage: LifeStage): string {
  return stage === LifeStage.Pipling ? "Pipling (still tiny)" : "Adult";
}

/** "5 min" / "26 min" / "1 h" / "1 h 30 min" — expedition durations. */
export function formatDurationShort(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

/** Live "4:32" / "1:04:09" countdown (clamped at 0:00). */
export function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  return `${m}:${ss}`;
}

/** Why a row is not sendable right now (drives copy, not core legality —
 * core re-checks everything on dispatch, spec §4.7). */
export type ExpeditionRowStatus =
  | "active" // THIS pip is out there (or just back) — show countdown
  | "available" // Send!
  | "locked" // Keep level too low
  | "occupied" // another pip is on this expedition
  | "away" // this pip is out on a DIFFERENT expedition
  | "resting"; // structural: asleep pips are not offered trips

export interface ExpeditionRowModel {
  readonly id: string;
  readonly name: string;
  readonly flavor: string;
  /** Effective for THIS pip (Hardworking's −15% shows up here). */
  readonly durationLabel: string;
  readonly status: ExpeditionRowStatus;
  /** Warm one-liner under the row; null when the row speaks for itself. */
  readonly note: string | null;
  /** Countdown text, only while status === "active" and still trotting. */
  readonly countdown: string | null;
  readonly sendable: boolean;
}

export interface FocusModel {
  readonly pipId: string;
  readonly name: string;
  readonly speciesName: string;
  readonly personalityName: string;
  readonly blurb: string;
  readonly stageLabel: string;
  readonly mood: string;
  readonly needs: Readonly<Record<NeedId, number>>;
  readonly expeditions: readonly ExpeditionRowModel[];
  /** Job rows (spec §6.2): one per placed station that hosts a job.
   * Empty until a Gathering Station is placed — no station, no section. */
  readonly jobs: readonly JobRowModel[];
}

/** Why a job row is (or isn't) workable right now (drives copy, not
 * legality — core re-checks everything on ASSIGN_JOB, spec §4.7). */
export type JobRowStatus =
  | "assigned" // THIS pip works here — show the Take a break button
  | "available" // Clock in!
  | "occupied" // another pip works this station (one per, spec §6.2)
  | "away" // this pip is out on an expedition
  | "resting" // structural: asleep pips are not offered shifts
  | "workingElsewhere"; // this pip already works another station

export interface JobRowModel {
  readonly stationPlacementId: PlacementId;
  /** "Gathering Station" — the placeable's display name. */
  readonly stationName: string;
  /** "Gathering" — the job registry's display name. */
  readonly jobName: string;
  /** "every 10 min" cadence chip. */
  readonly cadenceLabel: string;
  readonly status: JobRowStatus;
  /** Warm one-liner under the row; null when it speaks for itself. */
  readonly note: string | null;
  readonly assignable: boolean;
  readonly unassignable: boolean;
}

/** Display name of the placeable hosting a job (registry lookup). */
function stationDisplayName(itemId: string): string {
  return placeables.find((def) => def.id === itemId)?.name ?? itemId;
}

/**
 * Build the job rows for the focus view. Pure. One row per placed
 * station whose item hosts a registry job (spec §6.2 registry seam —
 * Crafting stations would appear here with zero UI changes). Sulking
 * pips keep a live Clock in button: the refusal (with its personality
 * line) is the pip's to deliver, not the UI's to pre-empt (spec §4.4).
 */
export function buildJobRows(state: GameState, pip: PipState): JobRowModel[] {
  const rows: JobRowModel[] = [];
  const myJob = state.jobs[pip.id];

  for (const [placementId, placement] of Object.entries(
    state.keep.placements,
  )) {
    const job = Object.values(contentJobs).find(
      (def) => def.stationItemId === placement.itemId,
    );
    if (job === undefined) continue;

    const base = {
      stationPlacementId: placementId,
      stationName: stationDisplayName(placement.itemId),
      jobName: job.name,
      cadenceLabel: `every ${formatDurationShort(job.intervalMs)}`,
    };

    if (myJob?.stationPlacementId === placementId) {
      rows.push({
        ...base,
        status: "assigned",
        note: `${pip.name} is gathering away — a little something ${base.cadenceLabel}.`,
        assignable: false,
        unassignable: true,
      });
      continue;
    }

    const worker = Object.entries(state.jobs).find(
      ([workerId, assignment]) =>
        workerId !== pip.id && assignment.stationPlacementId === placementId,
    );
    if (worker !== undefined) {
      const workerName = state.pips[worker[0]]?.name ?? "Somepip";
      rows.push({
        ...base,
        status: "occupied",
        note: `${workerName} has this one covered — one Pip per station.`,
        assignable: false,
        unassignable: false,
      });
      continue;
    }

    if (myJob !== undefined) {
      rows.push({
        ...base,
        status: "workingElsewhere",
        note: "Already on the clock at another station.",
        assignable: false,
        unassignable: false,
      });
      continue;
    }

    if (
      pip.activity === PipActivity.OnExpedition ||
      pip.activity === PipActivity.Returning
    ) {
      rows.push({
        ...base,
        status: "away",
        note: "Out adventuring — the station can wait.",
        assignable: false,
        unassignable: false,
      });
      continue;
    }

    if (pip.activity === PipActivity.Resting) {
      rows.push({
        ...base,
        status: "resting",
        note: "Fast asleep. The basket can wait; the dream cannot.",
        assignable: false,
        unassignable: false,
      });
      continue;
    }

    rows.push({
      ...base,
      status: "available",
      note: null,
      assignable: true,
      unassignable: false,
    });
  }

  return rows;
}

/** Some OTHER pip currently out (or back, loot uncollected) on this
 * expedition — spec §6.1 one-pip-per-expedition, mirroring core. */
function occupantOf(
  state: GameState,
  expeditionId: string,
  exceptPipId: string,
): PipState | null {
  for (const other of Object.values(state.pips)) {
    if (
      other.id !== exceptPipId &&
      (other.activity === PipActivity.OnExpedition ||
        other.activity === PipActivity.Returning) &&
      other.expedition?.expeditionId === expeditionId
    ) {
      return other;
    }
  }
  return null;
}

/** Build one expedition row for the focus view. Pure. */
export function buildExpeditionRow(
  state: GameState,
  pip: PipState,
  expeditionId: string,
  now: number,
): ExpeditionRowModel | null {
  const def = expeditions[expeditionId as keyof typeof expeditions];
  if (def === undefined) return null;

  const base = {
    id: def.id,
    name: def.name,
    flavor: def.flavor,
    durationLabel: formatDurationShort(
      effectiveExpeditionDurationMs(def, pip.personalityId),
    ),
  };

  const isAway =
    pip.activity === PipActivity.OnExpedition ||
    pip.activity === PipActivity.Returning;

  // THIS pip is on THIS expedition: destination + live countdown.
  if (isAway && pip.expedition?.expeditionId === def.id) {
    const returnAt = pip.expedition.departedAt + pip.expedition.durationMs;
    const stillOut =
      pip.activity === PipActivity.OnExpedition && returnAt > now;
    return {
      ...base,
      status: "active",
      countdown: stillOut ? formatCountdown(returnAt - now) : null,
      note: stillOut
        ? `${pip.name} is out there right now — back in`
        : `${pip.name} is back! Go see what the satchel is hiding.`,
      sendable: false,
    };
  }

  if (isAway) {
    return {
      ...base,
      status: "away",
      countdown: null,
      note: null, // the active row already tells the story
      sendable: false,
    };
  }

  if (def.unlockKeepLevel > state.keep.level) {
    return {
      ...base,
      status: "locked",
      countdown: null,
      note: `Opens at Keep level ${def.unlockKeepLevel} — something to grow toward.`,
      sendable: false,
    };
  }

  const occupant = occupantOf(state, def.id, pip.id);
  if (occupant !== null) {
    return {
      ...base,
      status: "occupied",
      countdown: null,
      note: `${occupant.name} is already out there — one Pip per trail.`,
      sendable: false,
    };
  }

  if (pip.activity === PipActivity.Resting) {
    return {
      ...base,
      status: "resting",
      countdown: null,
      note: "Fast asleep. The trail can wait; the dream cannot.",
      sendable: false,
    };
  }

  // Available. Sulking and Pipling pips still get a live Send button —
  // the refusal (with its personality line) is the pip's to deliver,
  // not the UI's to pre-empt (spec §4.7).
  return {
    ...base,
    status: "available",
    countdown: null,
    note: null,
    sendable: true,
  };
}

/** The whole panel's view model. Pure: state + now in, model out. */
export function buildFocusModel(
  state: GameState,
  pipId: string,
  now: number,
): FocusModel | null {
  const pip = state.pips[pipId];
  if (pip === undefined) return null;

  const rows: ExpeditionRowModel[] = [];
  for (const id of EXPEDITION_IDS) {
    const row = buildExpeditionRow(state, pip, id, now);
    if (row !== null) rows.push(row);
  }

  return {
    pipId: pip.id,
    name: pip.name,
    speciesName: species[pip.speciesId]?.name ?? pip.speciesId,
    personalityName:
      personalities[pip.personalityId as PersonalityId]?.name ??
      pip.personalityId,
    blurb: personalityBlurb(pip.personalityId),
    stageLabel: lifeStageLabel(pip.lifeStage),
    mood: peekDisplayedMood(state, pip),
    needs: { ...pip.needs },
    expeditions: rows,
    jobs: buildJobRows(state, pip),
  };
}

/** Toast-grade copy for structural assign blocks that slipped past the
 * disabled rows (double-tap races). Warm, never guilt (spec §15.5). */
export const ASSIGN_BLOCK_COPY: Readonly<Record<string, string>> = {
  locked: "That trail isn't open yet — the Keep has some growing to do.",
  occupied: "One Pip per trail — someone's already got this one covered.",
  busy: "This Pip has their paws full right now.",
  unknownExpedition: "That trail seems to have wandered off the map.",
  unknownPip: "Hmm — who? The Keep has no record of that Pip.",
};

export interface FocusViewDeps {
  dispatch(action: GameAction): void;
  getState(): GameState;
  clock: Clock;
}

export interface FocusView {
  readonly el: HTMLElement;
  /** Open on the CURRENT active pip. */
  open(): void;
  close(): void;
  readonly isOpen: boolean;
  sync(state: GameState): void;
  /** Per-frame: live countdown text. */
  tick(now: number): void;
}

export function createFocusView(deps: FocusViewDeps): FocusView {
  const el = document.createElement("div");
  el.className = "pk-focus-wrap";

  const backdrop = document.createElement("div");
  backdrop.className = "pk-focus-backdrop";

  const panel = document.createElement("div");
  panel.className = "pk-focus";
  el.append(backdrop, panel);

  let isOpen = false;
  let viewedPipId: string | null = null;
  let lastState: GameState | null = null;
  let lastSeenOutcome: AssignExpeditionOutcome | null = null;
  let lastSeenJobOutcome: JobOutcome | null = null;
  /** Countdown text node per expedition id, refreshed by tick(). */
  let countdownEls = new Map<string, HTMLElement>();
  let refusalEl: HTMLElement | null = null;
  let refusalTimer: number | null = null;
  /** Survives the per-TICK rebuilds — reapplied until the timer clears it. */
  let refusalText: string | null = null;

  const close = (): void => {
    isOpen = false;
    viewedPipId = null;
    refusalText = null;
    el.classList.remove("pk-focus-wrap--open");
  };
  backdrop.addEventListener("click", close);

  const applyRefusal = (): void => {
    if (refusalEl === null) return;
    if (refusalText !== null) {
      refusalEl.textContent = refusalText;
      refusalEl.classList.add("pk-focus-refusal--in");
    } else {
      refusalEl.classList.remove("pk-focus-refusal--in");
    }
  };

  const showRefusalLine = (line: string): void => {
    refusalText = line;
    applyRefusal();
    if (refusalTimer !== null) window.clearTimeout(refusalTimer);
    refusalTimer = window.setTimeout(() => {
      refusalText = null;
      applyRefusal();
    }, 4200);
  };

  const rebuild = (state: GameState): void => {
    if (viewedPipId === null) return;
    const now = deps.clock.now();
    const model = buildFocusModel(state, viewedPipId, now);
    const pip = state.pips[viewedPipId];
    if (model === null || pip === undefined) {
      close();
      return;
    }

    panel.replaceChildren();
    countdownEls = new Map();

    // Close affordance.
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "pk-focus-close";
    closeBtn.textContent = "×";
    closeBtn.title = "Back to the Keep";
    closeBtn.addEventListener("click", () => {
      sound("ui.tap");
      close();
    });

    // --- Portrait: big procedural blob from the genome's palette ---
    const palette = resolvePipPalette(pip.speciesId, pip.genome.palette);
    const portrait = document.createElement("div");
    portrait.className = "pk-portrait";
    portrait.style.setProperty("--pk-accent", palette.accent);
    const pBlob = document.createElement("div");
    pBlob.className = `pk-portrait-blob pk-portrait-blob--${pip.genome.pattern}`;
    pBlob.style.background = palette.body;
    pBlob.style.borderColor = palette.outline;
    pBlob.style.setProperty("--pk-pattern", palette.pattern);
    const pBelly = document.createElement("div");
    pBelly.className = "pk-portrait-belly";
    pBelly.style.background = palette.belly;
    const pEyes = document.createElement("div");
    pEyes.className = "pk-portrait-eyes";
    pEyes.append(document.createElement("i"), document.createElement("i"));
    const blushL = document.createElement("span");
    blushL.className = "pk-portrait-blush pk-portrait-blush--l";
    blushL.style.background = palette.blush;
    const blushR = document.createElement("span");
    blushR.className = "pk-portrait-blush pk-portrait-blush--r";
    blushR.style.background = palette.blush;
    pBlob.append(pBelly, pEyes, blushL, blushR);
    portrait.appendChild(pBlob);

    // --- Identity block ---
    const head = document.createElement("div");
    head.className = "pk-focus-head";
    const name = document.createElement("div");
    name.className = "pk-focus-name";
    name.textContent = model.name;
    const kind = document.createElement("div");
    kind.className = "pk-focus-kind";
    kind.textContent = `${model.speciesName} · ${model.personalityName} · ${model.stageLabel}`;
    const blurb = document.createElement("div");
    blurb.className = "pk-focus-blurb";
    blurb.textContent = model.blurb;
    const moodRow = document.createElement("div");
    moodRow.className = "pk-focus-mood";
    const moodDot = document.createElement("span");
    moodDot.className = "pk-focus-mood-dot";
    moodDot.style.background = moodColors[model.mood] ?? "#999";
    const moodText = document.createElement("span");
    moodText.textContent = `Feeling ${model.mood}`;
    moodRow.append(moodDot, moodText);
    head.append(name, kind, blurb, moodRow);

    // In-panel refusal line (the pip says no, in its own voice).
    refusalEl = document.createElement("div");
    refusalEl.className = "pk-focus-refusal";
    applyRefusal(); // an in-flight line survives the per-TICK rebuild

    // --- Four stat readouts ---
    const stats = document.createElement("div");
    stats.className = "pk-focus-stats";
    for (const need of NEED_IDS) {
      const row = document.createElement("div");
      row.className = "pk-need";
      const label = document.createElement("span");
      label.className = "pk-need-label";
      label.textContent = NEED_LABELS[need];
      const track = document.createElement("div");
      track.className = "pk-need-track";
      const fill = document.createElement("div");
      fill.className = "pk-need-fill";
      const value = model.needs[need];
      fill.style.width = `${Math.round(value)}%`;
      fill.style.background =
        value < DANGER_BELOW
          ? needDangerColor
          : value < WARN_BELOW
            ? needWarnColor
            : (needColors[need] ?? "#999");
      track.appendChild(fill);
      const valueEl = document.createElement("span");
      valueEl.className = "pk-need-value";
      valueEl.textContent = `${Math.round(value)}`;
      row.append(label, track, valueEl);
      stats.appendChild(row);
    }

    // --- Expeditions ---
    const expTitle = document.createElement("div");
    expTitle.className = "pk-focus-section";
    expTitle.textContent = "Expeditions";
    const expList = document.createElement("div");
    expList.className = "pk-focus-expeditions";

    for (const row of model.expeditions) {
      const card = document.createElement("div");
      card.className = `pk-exp pk-exp--${row.status}`;

      const top = document.createElement("div");
      top.className = "pk-exp-top";
      const expName = document.createElement("span");
      expName.className = "pk-exp-name";
      expName.textContent = row.name;
      const duration = document.createElement("span");
      duration.className = "pk-exp-duration";
      duration.textContent = row.durationLabel;
      top.append(expName, duration);

      const flavor = document.createElement("div");
      flavor.className = "pk-exp-flavor";
      flavor.textContent = row.flavor;
      card.append(top, flavor);

      if (row.note !== null) {
        const note = document.createElement("div");
        note.className = "pk-exp-note";
        note.textContent = row.note;
        if (row.countdown !== null) {
          const cd = document.createElement("span");
          cd.className = "pk-exp-countdown";
          cd.textContent = ` ${row.countdown}`;
          note.appendChild(cd);
          countdownEls.set(row.id, cd);
        }
        card.appendChild(note);
      }

      if (row.status === "locked") {
        const lock = document.createElement("span");
        lock.className = "pk-exp-lock";
        lock.textContent = `Keep level ${expeditions[row.id as keyof typeof expeditions]?.unlockKeepLevel ?? "?"}`;
        top.appendChild(lock);
      }

      if (row.sendable) {
        const send = document.createElement("button");
        send.type = "button";
        send.className = "pk-exp-send";
        send.textContent = "Send";
        send.addEventListener("click", () => {
          sound("ui.tap");
          deps.dispatch({
            type: "ASSIGN_EXPEDITION",
            pipId: model.pipId,
            expeditionId: row.id,
            at: deps.clock.now(),
          });
        });
        card.appendChild(send);
      }

      expList.appendChild(card);
    }

    // --- Work (spec §6.2): one row per placed job station ---
    const workEls: HTMLElement[] = [];
    if (model.jobs.length > 0) {
      const workTitle = document.createElement("div");
      workTitle.className = "pk-focus-section";
      workTitle.textContent = "Work";
      const workList = document.createElement("div");
      workList.className = "pk-focus-expeditions";

      for (const jobRow of model.jobs) {
        const card = document.createElement("div");
        card.className = `pk-exp pk-job pk-job--${jobRow.status}`;

        const top = document.createElement("div");
        top.className = "pk-exp-top";
        const jobName = document.createElement("span");
        jobName.className = "pk-exp-name";
        jobName.textContent = jobRow.stationName;
        const cadence = document.createElement("span");
        cadence.className = "pk-exp-duration";
        cadence.textContent = jobRow.cadenceLabel;
        top.append(jobName, cadence);
        card.appendChild(top);

        const flavor = document.createElement("div");
        flavor.className = "pk-exp-flavor";
        flavor.textContent =
          "Steady paws, steady snacks — the basket fills itself. Almost.";
        card.appendChild(flavor);

        if (jobRow.note !== null) {
          const note = document.createElement("div");
          note.className = "pk-exp-note";
          note.textContent = jobRow.note;
          card.appendChild(note);
        }

        if (jobRow.assignable) {
          const assign = document.createElement("button");
          assign.type = "button";
          assign.className = "pk-exp-send";
          assign.textContent = "Clock in";
          assign.addEventListener("click", () => {
            sound("ui.tap");
            deps.dispatch({
              type: "ASSIGN_JOB",
              pipId: model.pipId,
              stationPlacementId: jobRow.stationPlacementId,
              at: deps.clock.now(),
            });
          });
          card.appendChild(assign);
        }
        if (jobRow.unassignable) {
          const unassign = document.createElement("button");
          unassign.type = "button";
          unassign.className = "pk-exp-send pk-job-break";
          unassign.textContent = "Take a break";
          unassign.addEventListener("click", () => {
            sound("ui.tap");
            deps.dispatch({ type: "UNASSIGN_JOB", pipId: model.pipId });
          });
          card.appendChild(unassign);
        }

        workList.appendChild(card);
      }
      workEls.push(workTitle, workList);
    }

    panel.append(
      closeBtn,
      portrait,
      head,
      refusalEl,
      stats,
      expTitle,
      expList,
      ...workEls,
    );
  };

  /** React to a fresh ASSIGN_EXPEDITION outcome while open. */
  const watchAssignOutcome = (state: GameState): void => {
    const outcome = state.lastAssignOutcome;
    if (outcome === null || outcome === lastSeenOutcome) return;
    lastSeenOutcome = outcome;
    if (!isOpen || outcome.pipId !== viewedPipId) return;
    if (outcome.ok) {
      // Off they trot — return to the Keep to wave goodbye (spec §10.1.4).
      close();
      return;
    }
    if (outcome.line !== undefined) {
      showRefusalLine(outcome.line);
    }
  };

  /** React to a fresh ASSIGN_JOB/UNASSIGN_JOB outcome while open: the
   * Sulking refusal line lands in-panel, in the pip's own voice (spec
   * §4.4). Structural blocks are phase5's toast; success re-renders via
   * the normal state diff. */
  const watchJobOutcome = (state: GameState): void => {
    const outcome = state.lastJobOutcome;
    if (outcome === null || outcome === lastSeenJobOutcome) return;
    lastSeenJobOutcome = outcome;
    if (!isOpen || outcome.pipId !== viewedPipId) return;
    if (
      outcome.action === "assignJob" &&
      !outcome.ok &&
      outcome.reason === "sulking" &&
      outcome.line !== undefined
    ) {
      showRefusalLine(outcome.line);
    }
  };

  return {
    el,
    get isOpen(): boolean {
      return isOpen;
    },

    open(): void {
      const state = deps.getState();
      lastState = state;
      viewedPipId = state.activePipId;
      // Don't replay an outcome that predates this open.
      lastSeenOutcome = state.lastAssignOutcome;
      lastSeenJobOutcome = state.lastJobOutcome;
      isOpen = true;
      sound("ui.sheet");
      rebuild(state);
      el.classList.add("pk-focus-wrap--open");
    },

    close,

    sync(state: GameState): void {
      const prev = lastState;
      lastState = state;
      if (!isOpen) {
        // Keep the outcome cursors moving while closed so a stale
        // refusal never replays on the next open.
        lastSeenOutcome = state.lastAssignOutcome;
        lastSeenJobOutcome = state.lastJobOutcome;
        return;
      }
      // Follow the selector: focus always shows the active pip.
      if (viewedPipId !== state.activePipId) {
        viewedPipId = state.activePipId;
        lastSeenOutcome = state.lastAssignOutcome;
        lastSeenJobOutcome = state.lastJobOutcome;
        rebuild(state);
        return;
      }
      watchAssignOutcome(state);
      watchJobOutcome(state);
      if (prev !== state) rebuild(state);
    },

    tick(now: number): void {
      if (!isOpen || lastState === null || viewedPipId === null) return;
      for (const [expeditionId, cdEl] of countdownEls) {
        const pip = lastState.pips[viewedPipId];
        if (pip?.expedition?.expeditionId !== expeditionId) continue;
        const returnAt = pip.expedition.departedAt + pip.expedition.durationMs;
        cdEl.textContent = ` ${formatCountdown(returnAt - now)}`;
      }
    },
  };
}
