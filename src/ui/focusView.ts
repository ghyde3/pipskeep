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
import { PIP_NAME_MAX_LENGTH, validatePipName } from "../core/state";
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
import {
  EXPEDITION_IDS,
  SAFE_TRAIL_COPY,
  expeditions,
} from "../content/expeditions";
import type { ExpeditionId } from "../content/expeditions";
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
import { isSulking } from "../core/pips/machine";
// ROUND 2H (spec §16 v1.5): a Pip's own page is where its own life shows.
// Every one of these is a PURE model helper from a 2H module — the sheets
// and dialogs they belong to stay in their own files, reached through the
// optional deps below. `pipStatusBadge`/`pipLevelChipLabel` are the seams
// those modules published for exactly this.
import { pipLevelChipLabel } from "./pipLevel";
import { pipStatusBadge } from "./ailment";
import { lineageHintFor } from "./memorial";
import { pipSeason } from "../core/pips/lifecycle";
import { peekDisplayedMood } from "./topBar";
import { sound } from "../app/sound";
import { resolveAccessory } from "../content/accessories";
import {
  SILHOUETTE_FRACTIONS,
  accessoryZoneStyleVars,
  jitterStyleVars,
} from "../render/pipGeometry";

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

/**
 * ROUND 2D item 5 (docs/BACKLOG.md "Round 2D" item 1, the owner's own
 * lean: "game-given with rename available but not prominent — the Pip
 * *is* Pipsqueak, you didn't author it") — warm copy for a RENAME_PIP
 * validation failure (`core/state.ts`'s `validatePipName`). Same
 * precedent as `ui/sanctuary.ts`'s `RETIRE_REFUSAL_COPY`: a structural
 * rule, stated kindly, never a scold.
 */
export const RENAME_ERROR_COPY: Readonly<Record<"empty" | "tooLong", string>> = {
  empty: "Every Pip needs a name to answer to.",
  tooLong: `Let's keep it to ${PIP_NAME_MAX_LENGTH} characters or fewer.`,
};

/**
 * ROUND 2D item 3 — a genome's `accessoryId` → the focus-view portrait's
 * CSS class suffix, or `null` for "draw nothing" (every "bare" spelling
 * `resolveAccessory` already collapses: `undefined`/`null`/the `"none"`
 * sentinel/an unrecognized id). Direct 1:1 pass-through, same shape as
 * `ui/pipdex.ts`'s `albumAccessoryClassSuffix` (that file's own doc has
 * the "why export this at all" reasoning: `portraitPatterns.test.ts`
 * calls it directly so a typo here can't silently ship a blank
 * accessory on THIS surface either).
 */
export function focusAccessoryClassSuffix(
  accessoryId: string | null | undefined,
): string | null {
  return resolveAccessory(accessoryId)?.id ?? null;
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
  /**
   * ROUND 2H (spec §16 v1.5 promise 1, lifecycle bible §7.1) — this trail's
   * standing risk line, from `content/expeditions.ts`. ALWAYS present, for
   * every trail: "Safe trail." is as much a promise as the risky line is a
   * warning, and a player who only ever sees copy on the dangerous ones
   * learns nothing from its absence. This is the FIRST of promise 1's two
   * beats (the second is `ui/ailment.ts`'s confirm on the Send tap).
   */
  readonly riskCopy: string;
  /** ROUND 2H (bible §5.3 item 3) — "Someone of Bramble's line is out
   * there." Set only while a lineage egg from a lost Pip is waiting in
   * THIS biome; null otherwise. Promise 4's thread, at the exact moment
   * the player is choosing where to send someone. */
  readonly lineageHint: string | null;
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
  /** Round 2G's N1 fix (hud-redesign doc §2.7, spec v1.3 §10's standing
   * rule): this view never mentioned sulking at all before, even though a
   * Pip can nap through a sulk (`isSulking` true while `activity` reads
   * "resting" or "idle"). The mood row appends "· sulking" when this is
   * true — see `createFocusView`'s `moodRow` below. */
  readonly sulking: boolean;
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
  /** "every 10 min" cadence chip — or "by the recipe" for a crafting
   * station, which has no cadence at all (round 2J fix stage: the Craft
   * Table's deliberate `intervalMs: 0` rendered as "every 0 min"). */
  readonly cadenceLabel: string;
  /**
   * ROUND 2J FIX STAGE — the card's flavor line, CONTENT-OWNED.
   * `createFocusView` hard-coded one Gathering-Station string ("Steady
   * paws, steady snacks — the basket fills itself. Almost.") onto every
   * job card. That was merely inaccurate for the Stockpot and the
   * Workbench; for the Craft Table it is actively misleading, because
   * Crafting is the one job that fills no basket on its own — a player
   * who clocks a Pip in here must go and queue a recipe, and the card
   * said the opposite.
   */
  readonly flavor: string;
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

    const crafting = job.kind === "crafting";
    const base = {
      stationPlacementId: placementId,
      stationName: stationDisplayName(placement.itemId),
      jobName: job.name,
      // A crafting station has no interval — its pace is whatever recipe
      // is queued. Saying "every 0 min" was both meaningless and a
      // promise the station cannot keep.
      cadenceLabel: crafting ? "by the recipe" : `every ${formatDurationShort(job.intervalMs)}`,
      flavor: job.cardFlavor,
    };

    if (myJob?.stationPlacementId === placementId) {
      rows.push({
        ...base,
        status: "assigned",
        // Content-owned per-job verb (content bible §8.2.4): a Pip at the
        // Stockpot is "simmering away", not "gathering away".
        note: crafting
          ? `${pip.name} is ${job.verbing} away — queue a recipe from the Craft Table in the Nook menu and they'll get on with it.`
          : `${pip.name} is ${job.verbing} away — a little something ${base.cadenceLabel}.`,
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
): Omit<
  ExpeditionRowModel,
  "masteryBadge" | "pityNote" | "riskCopy" | "lineageHint"
> | null {
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
    // ROUND 2H splices on two more fields the same way, so none of the
    // seven status branches above needed touching a second time.
    riskCopy:
      expeditions[expeditionId as ExpeditionId]?.riskCopy ?? SAFE_TRAIL_COPY,
    lineageHint: lineageHintFor(state.lineageEggs, expeditionId),
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
    sulking: isSulking(pip),
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

/**
 * ROUND 2H — the season word, in the game's voice rather than the core's
 * enum. Warm and unhurried on purpose: `pipSeason` is mechanically inert
 * (it changes no rate and blocks no action), so its only job is to let a
 * player feel a life passing. "Getting on" is as close to a warning as
 * this row ever gets; the actual end arrives as `ui/memorial.ts`'s
 * retirement card, and it is peaceful (promise 3).
 */
const SEASON_WORD: Readonly<Record<string, string>> = {
  pipling: "a Pipling",
  young: "young",
  prime: "in their prime",
  seasoned: "seasoned",
  elder: "getting on",
};

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
  /**
   * ROUND 2H THE SEND SEAM (spec §16 v1.5 promise 1). When wired, the Send
   * button calls this INSTEAD of dispatching `ASSIGN_EXPEDITION` itself, so
   * `ui/ailment.ts` can put its risk confirm in front of a dangerous trail.
   * When omitted the view falls back to its own direct dispatch — identical
   * behaviour to every pre-2H build, which is what keeps this file's ~40
   * existing tests (each building its own deps object) valid untouched.
   */
  requestExpedition?(pipId: string, expeditionId: string): void;
  /** Open this Pip's Growth sheet (`ui/pipLevel.ts`). Optional — no dep,
   * no level chip. */
  openGrowth?(pipId: string): void;
  /** Open this Pip's ailment card (`ui/ailment.ts`). Optional. */
  openAilment?(pipId: string): void;
  /** Open this Pip's retirement-ready card (`ui/memorial.ts`). Optional. */
  openRetirementReady?(pipId: string): void;
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

  // ROUND 2D item 5 — the rename dialog. Its own overlay, same reasoning
  // as `ui/sanctuary.ts`'s retire confirm (that file's module doc has the
  // full case): it must survive `panel.replaceChildren()` inside
  // `rebuild()` below, which fires on nearly every TICK while the focus
  // view stays open (needs decay changes state ~1/s), so its DOM lives as
  // a SIBLING of `panel` — appended to `el`, never to `panel` — and paints
  // only from its own cached state (`renamePipId`/`renameDraft`/
  // `renameError`), never re-derived from live GameState. An in-progress
  // edit must never be stomped by an unrelated rebuild.
  const renameWrap = document.createElement("div");
  renameWrap.className = "pk-rename-wrap";
  const renameBackdrop = document.createElement("div");
  renameBackdrop.className = "pk-rename-backdrop";
  const renamePanel = document.createElement("div");
  renamePanel.className = "pk-rename";
  renamePanel.setAttribute("role", "dialog");
  renamePanel.setAttribute("aria-modal", "true");
  renamePanel.setAttribute("aria-label", "Rename this Pip");
  renameWrap.append(renameBackdrop, renamePanel);
  el.appendChild(renameWrap);

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

  // ROUND 2D item 5 — the rename dialog's own cached state (module doc on
  // `renameWrap` above explains why it is cached rather than re-derived).
  let renamePipId: string | null = null;
  /** The name being edited (immutable original — for the heading). */
  let renameOriginalName = "";
  /** Live textbox contents, kept in sync via the input's own listener. */
  let renameDraft = "";
  let renameError: string | null = null;

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
    // Rename lives nested inside `el` (module doc above), so it is already
    // visually hidden the instant the wrap loses `--open` — this just
    // keeps its own state from surviving into the next open() too.
    closeRename();
  };
  backdrop.addEventListener("click", close);

  const closeRename = (): void => {
    renamePipId = null;
    renameOriginalName = "";
    renameDraft = "";
    renameError = null;
    renameWrap.classList.remove("pk-rename-wrap--open");
  };
  renameBackdrop.addEventListener("click", closeRename);

  /** Pure paint from the cached rename state — see `renameWrap`'s module
   * doc for why this never reads live GameState. Safe to call as many
   * times as needed (every keystroke's error-clear, the Save handler). */
  const paintRename = (): void => {
    renamePanel.replaceChildren();
    if (renamePipId === null) return;

    const heading = document.createElement("div");
    heading.className = "pk-rename-heading";
    heading.textContent = `Rename ${renameOriginalName}?`;

    const sub = document.createElement("div");
    sub.className = "pk-rename-copy";
    sub.textContent = "Same Pip, new name — change it again anytime.";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "pk-rename-input";
    input.maxLength = PIP_NAME_MAX_LENGTH;
    input.value = renameDraft;
    input.setAttribute("aria-label", `New name for ${renameOriginalName}`);
    input.addEventListener("input", () => {
      renameDraft = input.value;
      // Clear a standing error the moment they start fixing it, rather
      // than making them re-submit to find out it's gone.
      if (renameError !== null) {
        renameError = null;
        const errorEl = renamePanel.querySelector(".pk-rename-error");
        errorEl?.remove();
      }
    });
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        submitRename();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        closeRename();
      }
    });

    renamePanel.append(heading, sub, input);

    if (renameError !== null) {
      const error = document.createElement("div");
      error.className = "pk-rename-error";
      error.textContent = renameError;
      renamePanel.appendChild(error);
    }

    const actions = document.createElement("div");
    actions.className = "pk-rename-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "pk-rename-cancel";
    cancel.textContent = "Never mind";
    cancel.addEventListener("click", () => {
      sound("ui.tap");
      closeRename();
    });
    const save = document.createElement("button");
    save.type = "button";
    save.className = "pk-rename-save";
    save.textContent = "Save";
    save.addEventListener("click", submitRename);
    actions.append(cancel, save);
    renamePanel.appendChild(actions);

    input.focus?.();
  };

  /** Validate + dispatch, or repaint with a kind inline error. Shared by
   * the Save tap and the input's Enter key. */
  function submitRename(): void {
    if (renamePipId === null) return;
    sound("ui.tap");
    const validated = validatePipName(renameDraft);
    if (!validated.ok) {
      renameError = RENAME_ERROR_COPY[validated.reason];
      paintRename();
      return;
    }
    deps.dispatch({ type: "RENAME_PIP", pipId: renamePipId, name: validated.name });
    closeRename();
  }

  const openRename = (pipId: string, currentName: string): void => {
    renamePipId = pipId;
    renameOriginalName = currentName;
    renameDraft = currentName;
    renameError = null;
    sound("ui.sheet");
    paintRename();
    renameWrap.classList.add("pk-rename-wrap--open");
  };

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
    // ROUND 2D FIX STAGE — this portrait now wears the species silhouette
    // and the Pip's own jitter, both of which it previously ignored (a
    // fixed `inset: 4px` box: a Tidepip and a Mosspip were the same
    // shape, and two Pips with one genome were byte-identical). Same
    // fractions ui/pipdex.ts uses, same pure jitter the Keep sprite uses.
    const portraitFractions =
      SILHOUETTE_FRACTIONS[
        species[pip.speciesId]?.sprite.silhouette ?? "round"
      ];
    portrait.style.setProperty("--pk-wfrac", String(portraitFractions.w));
    portrait.style.setProperty("--pk-hfrac", String(portraitFractions.h));
    for (const [varName, value] of Object.entries(jitterStyleVars(pip.id))) {
      portrait.style.setProperty(varName, value);
    }
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
    // ROUND 2D FIX STAGE — the mouth (see ui.css). Parity with the Pixi
    // resolver, which has always drawn one; without it the face has no
    // lower landmark and every neck accessory reads as a mouth.
    const pMouth = document.createElement("span");
    pMouth.className = "pk-portrait-mouth";
    pMouth.style.borderBottomColor = palette.outline;
    pBlob.append(pBelly, pEyes, pMouth, blushL, blushR);
    // ROUND 2D item 3 — worn accessory, the same registry
    // render/spriteResolver.ts's Pixi resolver reads, rendered through an
    // independently authored DOM shape (portraitPatterns.test.ts's
    // three-implementations parity, extended to accessories).
    const accessorySuffix = focusAccessoryClassSuffix(pip.genome.accessoryId);
    if (accessorySuffix !== null) {
      const accessoryDef = resolveAccessory(pip.genome.accessoryId);
      const pAccessory = document.createElement("span");
      pAccessory.className = `pk-portrait-accessory pk-portrait-accessory--${accessorySuffix}`;
      if (accessoryDef !== null) {
        pAccessory.style.setProperty("--pk-acc-primary", accessoryDef.primaryColor);
        pAccessory.style.setProperty(
          "--pk-acc-secondary",
          accessoryDef.secondaryColor ?? accessoryDef.primaryColor,
        );
        // ⚠️ FIX STAGE (bible §6.1.1(c)) — the SHARED band, same table
        // `ui/pipdex.ts` reads. See `ACCESSORY_ZONE_PCT`.
        for (const [name, value] of Object.entries(accessoryZoneStyleVars(accessoryDef.slot))) {
          pAccessory.style.setProperty(name, value);
        }
        pAccessory.setAttribute("aria-hidden", "true");
        pAccessory.title = accessoryDef.name;
      }
      pBlob.appendChild(pAccessory);
    }
    portrait.appendChild(pBlob);

    // --- Identity block ---
    const head = document.createElement("div");
    head.className = "pk-focus-head";
    const nameRow = document.createElement("div");
    nameRow.className = "pk-focus-name-row";
    const name = document.createElement("div");
    name.className = "pk-focus-name";
    name.textContent = model.name;
    // ROUND 2D item 5 — rename, discoverable but not prominent (the
    // owner's own lean, module doc above): a small pencil beside the
    // name, never a headline action.
    const renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.className = "pk-focus-rename-btn";
    renameBtn.textContent = "✎";
    renameBtn.title = "Rename";
    renameBtn.setAttribute("aria-label", `Rename ${model.name}`);
    renameBtn.addEventListener("click", () => {
      sound("ui.tap");
      openRename(model.pipId, model.name);
    });
    nameRow.append(name, renameBtn);
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
    // Round 2G N1 fix: sulking is reported here even while `activity` reads
    // "resting" or "idle" (a Pip can nap through a sulk) — see FocusModel's
    // `sulking` field doc.
    moodText.textContent = model.sulking
      ? `Feeling ${model.mood} · sulking`
      : `Feeling ${model.mood}`;
    moodRow.append(moodDot, moodText);
    // Species greeting (content bible §6.2/§8.2.5) — set by open(), not
    // here, so it survives the per-TICK rebuild the same way the refusal
    // line does (see the two `applyX()` calls below).
    greetingEl = document.createElement("div");
    greetingEl.className = "pk-focus-greeting";
    head.append(nameRow, kind);
    if (titles !== null) head.appendChild(titles);
    head.append(blurb, greetingEl, moodRow);

    // --- ROUND 2H: this Pip's own life (spec §16 v1.5) ---
    // One row of small taps, each opening the sheet that owns that subject.
    // Every chip here is drawn ONLY when its dep was wired AND the Pip
    // actually has that state, so a level-1, healthy, young Pip sees just
    // its level chip and its season word — never a row of empty slots.
    const lifeRow = document.createElement("div");
    lifeRow.className = "pk-focus-life";

    const levelLabel = pipLevelChipLabel(pip);
    const openGrowth = deps.openGrowth;
    if (levelLabel !== null && openGrowth !== undefined) {
      const lv = document.createElement("button");
      lv.type = "button";
      lv.className = "pk-life-chip pk-life-chip--level";
      lv.textContent = levelLabel;
      lv.title = `${pip.name}'s own growth`;
      lv.setAttribute("aria-label", `${pip.name} is ${levelLabel} — see how they've grown`);
      lv.addEventListener("click", () => {
        sound("ui.tap");
        openGrowth(pip.id);
      });
      lifeRow.appendChild(lv);
    }

    // The season word (pipling/young/prime/seasoned/elder). Derived, never
    // stored, mechanically inert — it is the ONLY place a player can watch
    // a life go by before the retirement card arrives, which is the whole
    // point of showing it (promise 3: old age should be legible long
    // before it is imminent, so it never lands as a shock).
    const season = pipSeason(pip, tuning);
    const seasonEl = document.createElement("span");
    seasonEl.className = `pk-life-season pk-life-season--${season}`;
    seasonEl.textContent = SEASON_WORD[season] ?? season;
    lifeRow.appendChild(seasonEl);

    const badge = pipStatusBadge(pip);
    const openAilment = deps.openAilment;
    const openReady = deps.openRetirementReady;
    if (badge.kind === "ailing" && openAilment !== undefined) {
      const ail = document.createElement("button");
      ail.type = "button";
      ail.className = "pk-life-chip pk-life-chip--ailing";
      ail.textContent = badge.label;
      ail.setAttribute("aria-label", `${pip.name}: ${badge.label} — tend to them`);
      ail.addEventListener("click", () => {
        sound("ui.tap");
        openAilment(pip.id);
      });
      lifeRow.appendChild(ail);
    } else if (badge.kind === "ready" && openReady !== undefined) {
      const ready = document.createElement("button");
      ready.type = "button";
      ready.className = "pk-life-chip pk-life-chip--ready";
      ready.textContent = badge.label;
      ready.setAttribute("aria-label", `${pip.name}: ${badge.label}`);
      ready.addEventListener("click", () => {
        sound("ui.tap");
        openReady(pip.id);
      });
      lifeRow.appendChild(ready);
    }

    if (lifeRow.childElementCount > 0) head.appendChild(lifeRow);
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

      // ROUND 2H (promise 1, bible §7.1): every trail states its own risk,
      // every time, before the tap. The safe line is drawn too — see the
      // `riskCopy` field doc for why the reassurance is load-bearing.
      const riskEl = document.createElement("div");
      const risky = row.riskCopy !== SAFE_TRAIL_COPY;
      riskEl.className = `pk-exp-risk pk-exp-risk--${risky ? "risky" : "safe"}`;
      riskEl.textContent = row.riskCopy;
      card.appendChild(riskEl);

      // ROUND 2H (promise 4, bible §5.3 item 3): the thread to pull, shown
      // exactly where the player decides where to send someone.
      if (row.lineageHint !== null) {
        const lin = document.createElement("div");
        lin.className = "pk-exp-lineage";
        lin.textContent = row.lineageHint;
        card.appendChild(lin);
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
          // ROUND 2H (promise 1): route through the send seam when wired, so
          // a risky trail gets its confirm BEFORE anyone leaves. The fallback
          // is the pre-2H dispatch, byte-for-byte, and `requestExpedition`
          // itself degrades to exactly this for a safe trail — so a send is
          // the same one action either way, from the same `at`.
          const request = deps.requestExpedition;
          if (request !== undefined) {
            request(model.pipId, row.id);
          } else {
            deps.dispatch({
              type: "ASSIGN_EXPEDITION",
              pipId: model.pipId,
              expeditionId: row.id,
              at: deps.clock.now(),
            });
          }
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
        // Round 2J fix stage: content-owned, per job — see
        // `JobRowModel.flavor`.
        flavor.textContent = jobRow.flavor;
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
