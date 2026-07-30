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
 * When the pip itself says no (Sulking) the core draws a personality-
 * appropriate Refusal line; `sync` diffs `lastAssignOutcome` and surfaces
 * that line in-panel. Structural blocks (locked, occupied, busy) never
 * reach dispatch: the rows disable themselves with warm copy instead —
 * the world said no, not the pip.
 *
 * Piplings (spec §4.6, amended round 2A after playtest finding #3 — a
 * Pipling used to be silently useless): trails on
 * `tuning.pipling.allowedExpeditionIds` stay sendable and are labelled a
 * supervised trip; every other trail explains itself with a LIVE
 * countdown to the Pip's exact grow-up moment ("Still a Pipling — ready
 * to explore in 5h 20m") rather than a bare no. The timestamp mirrors
 * `lifecycle.adultAt`, the same value core puts on its `pipling` refusal.
 *
 * Architecture: `buildFocusModel` + friends are PURE (state in, view
 * model out — node-testable, no DOM); `createFocusView` is the dumb DOM
 * shell that renders the model and dispatches actions.
 *
 * ROUND 2C ADDITIVE (docs/retention-bible.md §6 mastery, §7 egg pity):
 * `ExpeditionRowModel` gained two nullable fields — `masteryBadge` (a
 * filled/hollow-pip rank plus the tier's title, e.g. "●●●○○ Knows where
 * the nests are"; never a raw trip count or percentage, per the task's
 * "subtle indicator, not a numbers dump") and `pityNote` (the visible,
 * always-shown pity countdown, phrased as encouragement — "Toward a
 * Cloudpip: 5/8 — getting close." — never hidden, never a slot-machine
 * percentage). Both are computed by `masteryBadgeFor`/`pityNoteFor` and
 * spliced onto every existing branch via a thin wrapper around the
 * original (renamed, unexported) row builder, so none of the seven
 * existing return sites needed editing. `buildFocusModel`/`FocusModel`
 * and every existing field are otherwise untouched.
 */

import type { Clock } from "../core/clock";
import type { GameAction, GameState } from "../core/state";
import { LifeStage, NEED_IDS, PipActivity } from "../core/pips/types";
import type { NeedId, PipState } from "../core/pips/types";
import {
  effectiveExpeditionDurationMs,
} from "../core/expeditions";
import type { AssignExpeditionOutcome } from "../core/expeditions";
import { adultAt } from "../core/pips/lifecycle";
import type { JobOutcome } from "../core/keep/jobs";
import type { PlacementId } from "../core/keep";
import { EXPEDITION_IDS, expeditions } from "../content/expeditions";
import { tuning } from "../content/tuning";
import type { Tuning } from "../content/tuning";
import { jobs as contentJobs } from "../content/jobs";
import { placeables } from "../content/placeables";
import { personalities } from "../content/personalities";
import type { PersonalityId } from "../content/personalities";
import { species } from "../content/species";
import { pickSpeciesLine } from "../content/speciesLines";
import { masteryTier, masteryTitle, maxMasteryTier } from "../core/progression/mastery";
import { earnedFlairOfKind } from "../content/flair";
import {
  guaranteedDrawPool,
  pityThresholdFor,
  rarestTierInPool,
} from "../core/progression/pity";
import { eventAdjustedPityThreshold } from "../core/progression/events";
import {
  moodColors,
  needColors,
  needDangerColor,
  needWarnColor,
  resolvePipPalette,
} from "../content/palette";
import { retireRefusal } from "../core/sanctuary";
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

/**
 * Coarse, warm countdown for the grow-up timer (round 2A finding #3): an
 * 8-hour wait does not want a ticking seconds column, but the last
 * minute very much does. Hours+minutes above an hour, minutes+seconds
 * below, bare seconds in the last minute.
 */
export function formatGrowUpCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  if (totalSeconds === 0) return "a moment";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor(totalSeconds / 60) % 60;
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

/** Why a row is not sendable right now (drives copy, not core legality —
 * core re-checks everything on dispatch, spec §4.7). */
export type ExpeditionRowStatus =
  | "active" // THIS pip is out there (or just back) — show countdown
  | "available" // Send!
  | "locked" // Keep level too low
  | "occupied" // another pip is on this expedition
  | "away" // this pip is out on a DIFFERENT expedition
  | "resting" // structural: asleep pips are not offered trips
  | "pipling"; // too small for THIS trail — show the grow-up countdown

export interface ExpeditionRowModel {
  readonly id: string;
  readonly name: string;
  readonly flavor: string;
  /** Effective for THIS pip (Hardworking's −15% shows up here). */
  readonly durationLabel: string;
  readonly status: ExpeditionRowStatus;
  /** Warm one-liner under the row; null when the row speaks for itself. */
  readonly note: string | null;
  /** Countdown text: expedition return (`active`) or the Pipling's
   * grow-up moment (`pipling`). Null when nothing is counting down. */
  readonly countdown: string | null;
  /**
   * Absolute timestamp `countdown` counts toward, so the DOM shell can
   * re-render it every frame without rebuilding the model. Null exactly
   * when `countdown` is null.
   */
  readonly countdownUntil: number | null;
  /** Small chip in the row's top-right ("Keep level 2", "Pipling",
   * "Supervised"); null when the row needs no chip. */
  readonly badge: string | null;
  readonly sendable: boolean;
  /** ROUND 2C (bible §6.3) — this Pip's mastery rank on this biome, as
   * filled/hollow pips plus the tier title; null below tier 1. */
  readonly masteryBadge: string | null;
  /** ROUND 2C (bible §7.2) — the visible egg-pity countdown for this
   * biome; null for a common-only pool (nothing rarer to chase). */
  readonly pityNote: string | null;
}

export interface FocusModel {
  readonly pipId: string;
  readonly name: string;
  readonly speciesName: string;
  readonly personalityName: string;
  readonly blurb: string;
  readonly stageLabel: string;
  /** Earned FLAIR titles (bible §4.3's "a title on a Pip's card") — the
   * `mastery-tier-5-any-biome` / `mastery-tier-3-all-biomes` milestone
   * rewards, which were `kind: "flair"` and paid literally nothing before
   * this round's fix. An honourific, never a rank or a score. */
  readonly flairTitles: readonly string[];
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
        // Content-owned per-job verb (content bible §8.2.4): a Pip at the
        // Stockpot is "simmering away", not "gathering away".
        note: `${pip.name} is ${job.verbing} away — a little something ${base.cadenceLabel}.`,
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
        // Content-owned per-job note (content bible §8.2.4) — "the
        // basket can wait" doesn't describe a pot.
        note: job.restingNote,
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

/**
 * ROUND 2C (bible §6.3) — a subtle per-Pip, per-biome mastery indicator:
 * filled/hollow pips plus the tier's title (e.g. "●●●○○ Knows where the
 * nests are"). Deliberately never a raw trip count or bonus percentage —
 * the task's "a subtle rank/pips indicator, not a numbers dump". Null
 * below tier 1 (nothing to show yet).
 */
export function masteryBadgeFor(
  pip: PipState,
  expeditionId: string,
  tuningArg: Tuning = tuning,
): string | null {
  const def = expeditions[expeditionId as keyof typeof expeditions];
  if (def === undefined) return null;
  const trips = pip.mastery?.[expeditionId] ?? 0;
  const tier = masteryTier(trips, def.durationMs, tuningArg);
  if (tier <= 0) return null;
  const max = maxMasteryTier(tuningArg);
  const dots = "●".repeat(tier) + "○".repeat(Math.max(0, max - tier));
  const title = masteryTitle(tier, def.name);
  return title !== null ? `${dots} ${title}` : dots;
}

/**
 * ROUND 2C (bible §7.2) — the visible egg-pity countdown for a biome,
 * phrased as encouragement rather than a raw probability ("full
 * disclosure" — the counter itself is never hidden — without reading as a
 * slot machine). Null for a common-only pool (nothing rarer to chase,
 * bible §7.1 — "the UI shows the odds and no counter") or a biome with no
 * declared egg pool.
 */
export function pityNoteFor(
  state: GameState,
  expeditionId: string,
  tuningArg: Tuning = tuning,
): string | null {
  const def = expeditions[expeditionId as keyof typeof expeditions];
  const pool = def?.eggSpecies;
  if (pool === undefined || pool.length === 0) return null;
  const rarityPool = pool.map((id) => ({ id, rarity: species[id]?.rarity ?? "common" }));
  const rarestTier = rarestTierInPool(rarityPool);
  const baseThreshold = pityThresholdFor(rarityPool, tuningArg);
  if (rarestTier === null || baseThreshold === null) return null;

  const threshold =
    eventAdjustedPityThreshold(
      baseThreshold,
      expeditionId,
      state.activeEvents,
      tuningArg,
    ) ?? baseThreshold;
  const counter = state.eggPity[expeditionId] ?? 0;
  const remaining = Math.max(0, threshold - counter);

  // Kindness tiebreak (bible §7.2): name the specific still-uncaught
  // species the guarantee would prefer, same as the guaranteed hatch
  // itself would pick.
  const isCaught = (speciesId: string): boolean =>
    state.pipdex.entries[speciesId]?.caughtAt != null;
  const guaranteed = guaranteedDrawPool(rarityPool, rarestTier, isCaught);
  const names = guaranteed.map((entry) => species[entry.id]?.name ?? entry.id).join(" or ");
  const article = /^[aeiou]/i.test(names) ? "an" : "a";

  const tail =
    remaining === 0
      ? " — guaranteed next hatch!"
      : remaining <= 2
        ? " — getting close."
        : "";
  return `Toward ${article} ${names}: ${counter}/${threshold}${tail}`;
}

/** Build one expedition row for the focus view. Pure. */
function buildExpeditionRowBase(
  state: GameState,
  pip: PipState,
  expeditionId: string,
  now: number,
): Omit<ExpeditionRowModel, "masteryBadge" | "pityNote"> | null {
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
      countdownUntil: stillOut ? returnAt : null,
      badge: null,
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
      countdownUntil: null,
      badge: null,
      note: null, // the active row already tells the story
      sendable: false,
    };
  }

  if (def.unlockKeepLevel > state.keep.level) {
    return {
      ...base,
      status: "locked",
      countdown: null,
      countdownUntil: null,
      badge: `Keep level ${def.unlockKeepLevel}`,
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
      countdownUntil: null,
      badge: null,
      note: `${occupant.name} is already out there — one Pip per trail.`,
      sendable: false,
    };
  }

  // Piplings (spec §4.6, round 2A): no longer blanket-barred. Trails on
  // the supervised-trip allowlist stay sendable and say so; the rest
  // explain themselves with a live countdown to the exact moment this
  // Pip grows up, mirroring the `growsUpAt` core hands back on refusal.
  const isPipling = pip.lifeStage === LifeStage.Pipling;
  const supervised =
    isPipling && tuning.pipling.allowedExpeditionIds.includes(def.id);

  if (isPipling && !supervised) {
    const growsUpAt = adultAt(pip);
    return {
      ...base,
      status: "pipling",
      countdown: formatGrowUpCountdown(growsUpAt - now),
      countdownUntil: growsUpAt,
      badge: "Pipling",
      note: `Still a Pipling — ready to explore in`,
      sendable: false,
    };
  }

  if (pip.activity === PipActivity.Resting) {
    return {
      ...base,
      status: "resting",
      countdown: null,
      countdownUntil: null,
      badge: null,
      note: "Fast asleep. The trail can wait; the dream cannot.",
      sendable: false,
    };
  }

  // Available. Sulking pips still get a live Send button — the refusal
  // (with its personality line) is the pip's to deliver, not the UI's to
  // pre-empt (spec §4.7).
  return {
    ...base,
    status: "available",
    countdown: null,
    countdownUntil: null,
    badge: supervised ? "Supervised" : null,
    note: supervised
      ? "A little supervised trip — just right for small paws."
      : null,
    sendable: true,
  };
}

/**
 * Public entry point (unchanged signature/behaviour for every existing
 * field): wraps `buildExpeditionRowBase` and splices on the two ROUND 2C
 * fields (`masteryBadge`/`pityNote`) so none of the seven branches above
 * needed touching.
 */
export function buildExpeditionRow(
  state: GameState,
  pip: PipState,
  expeditionId: string,
  now: number,
): ExpeditionRowModel | null {
  const base = buildExpeditionRowBase(state, pip, expeditionId, now);
  if (base === null) return null;
  return {
    ...base,
    masteryBadge: masteryBadgeFor(pip, expeditionId),
    pityNote: pityNoteFor(state, expeditionId),
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
    flairTitles: earnedFlairOfKind(state.flair, "pipTitle").map(
      (def) => `${def.glyph} ${def.name}`,
    ),
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

/**
 * Should the focus view draw "Send to the Long Meadow" for this Pip?
 *
 * Delegates to `core/sanctuary`'s single legality rule (`retireRefusal`),
 * so the button can never disagree with the reducer. Deliberately TRUE for
 * a Sulking Pip (bible §2.3: a Pip having a bad week should be allowed a
 * change of scene — the refusal list is structural, never moral), and
 * false only for a Pip with loot in flight or the last Pip in the Keep,
 * because offering a tap that can only apologise is worse than not
 * offering it.
 */
export function canOfferRetire(state: GameState, pipId: string): boolean {
  return retireRefusal(state, pipId) === null;
}

export interface FocusViewDeps {
  dispatch(action: GameAction): void;
  getState(): GameState;
  clock: Clock;
  /**
   * Open the Long Meadow's retire confirmation for this Pip (round 2C —
   * `ui/sanctuary.ts` owns that dialog and its copy; this view only owns
   * the affordance). OPTIONAL: when omitted the button is not drawn at
   * all, which is what keeps every pre-2C focusView test — each of which
   * builds its own deps object — passing untouched.
   */
  openRetireConfirm?(pipId: string): void;
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
  /** Live countdown text nodes per expedition id, refreshed by tick().
   * Each carries the absolute moment it counts toward plus its own
   * formatter, so an expedition return ("4:32") and a Pipling's grow-up
   * timer ("5h 20m") tick through the exact same loop. */
  let countdownEls = new Map<
    string,
    {
      readonly el: HTMLElement;
      readonly until: number;
      readonly format: (remainingMs: number) => string;
    }
  >();
  let refusalEl: HTMLElement | null = null;
  let refusalTimer: number | null = null;
  /** Survives the per-TICK rebuilds — reapplied until the timer clears it. */
  let refusalText: string | null = null;
  /**
   * ROUND 2B (content bible §6.2/§8.2.5, a fence exception): the
   * species' own line, shown briefly whenever the focus view opens for
   * a Pip — the third of three call sites that make `speciesLines.ts`'s
   * 56 authored lines actually visible (hatch toast, evolution prompt,
   * here). Same survive-the-rebuild pattern as `refusalText` above; set
   * ONLY by `open()`, never by a plain `sync()` rebuild, so it doesn't
   * re-trigger on every need tick while the panel is open.
   */
  let greetingEl: HTMLElement | null = null;
  let greetingTimer: number | null = null;
  let greetingText: string | null = null;

  const close = (): void => {
    isOpen = false;
    viewedPipId = null;
    refusalText = null;
    greetingText = null;
    if (greetingTimer !== null) {
      window.clearTimeout(greetingTimer);
      greetingTimer = null;
    }
    el.classList.remove("pk-focus-wrap--open");
  };
  backdrop.addEventListener("click", close);

  const applyGreeting = (): void => {
    if (greetingEl === null) return;
    if (greetingText !== null) {
      greetingEl.textContent = greetingText;
      greetingEl.classList.add("pk-focus-greeting--in");
    } else {
      greetingEl.classList.remove("pk-focus-greeting--in");
    }
  };

  const showGreetingLine = (line: string): void => {
    greetingText = line;
    applyGreeting();
    if (greetingTimer !== null) window.clearTimeout(greetingTimer);
    greetingTimer = window.setTimeout(() => {
      greetingText = null;
      applyGreeting();
    }, 4200);
  };

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
    closeBtn.setAttribute("aria-label", "Close — back to the Keep");
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
    const titles =
      model.flairTitles.length > 0 ? document.createElement("div") : null;
    if (titles !== null) {
      titles.className = "pk-focus-titles";
      titles.textContent = model.flairTitles.join(" · ");
    }
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
    // Species greeting (content bible §6.2/§8.2.5) — set by open(), not
    // here, so it survives the per-TICK rebuild the same way the refusal
    // line does (see the two `applyX()` calls below).
    greetingEl = document.createElement("div");
    greetingEl.className = "pk-focus-greeting";
    head.append(name, kind);
    if (titles !== null) head.appendChild(titles);
    head.append(blurb, greetingEl, moodRow);
    applyGreeting();

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

      // ROUND 2C (bible §6.3/§7.2) — additive, subtle: a mastery rank line
      // and the visible pity countdown, each omitted when there's nothing
      // to show yet (tier 0 / a common-only pool).
      if (row.masteryBadge !== null) {
        const mastery = document.createElement("div");
        mastery.className = "pk-exp-mastery";
        mastery.textContent = row.masteryBadge;
        card.appendChild(mastery);
      }
      if (row.pityNote !== null) {
        const pity = document.createElement("div");
        pity.className = "pk-exp-pity";
        pity.textContent = row.pityNote;
        card.appendChild(pity);
      }

      if (row.note !== null) {
        const note = document.createElement("div");
        note.className = "pk-exp-note";
        note.textContent = row.note;
        if (row.countdown !== null && row.countdownUntil !== null) {
          const cd = document.createElement("span");
          cd.className = "pk-exp-countdown";
          cd.textContent = ` ${row.countdown}`;
          note.appendChild(cd);
          countdownEls.set(row.id, {
            el: cd,
            until: row.countdownUntil,
            format:
              row.status === "pipling" ? formatGrowUpCountdown : formatCountdown,
          });
        }
        card.appendChild(note);
      }

      if (row.badge !== null) {
        const badge = document.createElement("span");
        badge.className = `pk-exp-badge pk-exp-badge--${row.status}`;
        badge.textContent = row.badge;
        top.appendChild(badge);
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
            deps.dispatch({
              type: "UNASSIGN_JOB",
              pipId: model.pipId,
              at: deps.clock.now(),
            });
          });
          card.appendChild(unassign);
        }

        workList.appendChild(card);
      }
      workEls.push(workTitle, workList);
    }

    // --- The Long Meadow (round 2C, docs/retention-bible.md §2.3) ---
    // Deliberately LAST and deliberately quiet: a warm side door, never a
    // headline action. Drawn only when `openRetireConfirm` was wired AND
    // core says it is legal right now, so the player never taps a button
    // whose only possible answer is an apology. `ui/sanctuary.ts` owns the
    // confirmation, its copy, and the dispatch — this is just the door.
    const meadowEls: HTMLElement[] = [];
    const openRetire = deps.openRetireConfirm;
    if (openRetire !== undefined && canOfferRetire(state, model.pipId)) {
      const meadow = document.createElement("div");
      meadow.className = "pk-focus-meadow";
      const meadowBtn = document.createElement("button");
      meadowBtn.type = "button";
      meadowBtn.className = "pk-meadow-send";
      meadowBtn.textContent = "Send to the Long Meadow";
      meadowBtn.title = "They'll help out at the meadow sanctuary — visit any time";
      meadowBtn.addEventListener("click", () => {
        sound("ui.tap");
        openRetire(model.pipId);
      });
      const meadowNote = document.createElement("div");
      meadowNote.className = "pk-focus-meadow-note";
      meadowNote.textContent = "Visit any time, and ask them home whenever you like.";
      meadow.append(meadowBtn, meadowNote);
      meadowEls.push(meadow);
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
      ...meadowEls,
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
      // Species greeting (content bible §6.2/§8.2.5) — set here (not in
      // rebuild()) so it plays once per open call, not on every subsequent
      // state-driven rebuild while the panel stays open. NOTE: this fires
      // on EVERY open, not just the pip's first ever — the bible frames
      // this as a rare "first meeting" beat, but true first-time tracking
      // needs a persisted per-species-seen record, deferred to the Pipdex
      // round (see the orchestrator's round-2B note). `pickSpeciesLine`
      // being a deterministic hash of the pip's id means the same line
      // repeats verbatim on every repeat visit. Silent if the species is
      // missing from `speciesLines` (defensive).
      const pip = state.pips[viewedPipId];
      const line = pip !== undefined ? pickSpeciesLine(pip.speciesId, pip.id) : null;
      if (line !== null) showGreetingLine(line);
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
      if (!isOpen) return;
      // Every entry knows its own target and formatter; rebuild() re-seeds
      // the map whenever state changes, so `until` is never stale.
      for (const { el: cdEl, until, format } of countdownEls.values()) {
        cdEl.textContent = ` ${format(until - now)}`;
      }
    },
  };
}
