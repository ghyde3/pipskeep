/**
 * THE DOORSTEP (docs/retention-bible.md §10 — "the single most important
 * UX decision in the round"): the returning-player sequence, built as an
 * EXTENSION of the existing "While you were away…" sheet rather than a
 * replacement — exactly per the bible's §10.4 implementation note, so
 * `awaySheet.test.ts`'s pinned copy assertions keep passing untouched.
 *
 * `deriveDoorstepModel` calls the existing, UNMODIFIED `deriveAwaySheet`
 * (from ./awaySheet) to get sections 1/3/4 (the greeting sized to the
 * absence, the per-pip need arrows + capped-time note, and the homecoming
 * TEASE — never the reveal's contents) and layers this round's two new
 * sections on top: the streak (§2) and today's compact bounty checklist
 * (§5), plus AT MOST ONE nudge (§6), by priority: a pipping egg → a Pip
 * ready to evolve → an egg-pity counter one away → an Album page one form
 * away → a milestone one step away. `deriveAwaySheet`'s existing
 * under-3-minutes-is-null contract is inherited for free (a "no Doorstep
 * on a tab flick" rule this module never has to re-implement or
 * re-litigate) — see bible §10.3.
 *
 * WIRING: `src/ui/phase4.ts` DOES wire this in — `initPhase4Ui` constructs
 * `createDoorstep` and calls `deriveDoorstepModel` at its away-sheet call
 * site, with the same `onDismiss` contract `createAwaySheet` had (dismissing
 * plays the queued loot reveal next). Do not add a second Doorstep or away
 * sheet anywhere: §10.1's "at most ONE blocking surface on open" is enforced
 * by that single call site plus `openLootReveal`'s `sheet.isOpen()` guard.
 *
 * THE STREAK SECTION IS A PROJECTION, AND THAT IS THE POINT (round-2C review).
 * Opening the app is NOT a visit (bible §3.2 says so by name — a background
 * PWA reload or a tab flick must not advance anything), so the streak in
 * `state` is still yesterday's when the Doorstep paints. Reading it raw meant
 * a player who had been away a fortnight was greeted with "Day 6 in a row."
 * and then, on their first tap, had `current` silently reset to 1 with no
 * message at all — `detectRainDayToast` only fires when `rainDays` increases,
 * and a past-grace reset increments nothing. The exact moment §3.4/§10.2 was
 * written for never fired, and the player was quietly billed for the absence.
 *
 * So the streak section is derived from `touchVisit(state.streak, now, …)` —
 * the same pure advance rule the reducer will apply, run WITHOUT dispatching.
 * It tells the truth about what today is the moment the player does anything,
 * which is the only honest thing to put on a doorstep, and it can only ever be
 * generous: if they close the app without touching anything, grace absorbs the
 * day, and a projection that showed one day more than was banked has cost them
 * nothing. Rain days are NOT reported here — `detectRainDayToast` reports them
 * after the fact on the first real action (bible §3.4's "after the fact,
 * warmly, once"), so putting them on the Doorstep too would say it twice.
 *
 * Session-lifecycle dispatches this round needs (SET_DAY_OFFSET,
 * SET_ACTIVE_EVENTS, REFRESH_BOUNTIES, CLAIM_STREAK_REWARD) are NOT this
 * module's job — `./dailies.ts`'s `initDailiesUi` owns them, independent
 * of whether the Doorstep ever shows, because the bible's short-absence
 * path (§10.3) requires bounties to "refresh silently" and the streak to
 * advance even when there is no Doorstep to show.
 */

import "./dailies.css";
import { sound } from "../app/sound";
import type { CatchupSummary } from "../core/pips/catchup";
import { EggState } from "../core/eggs";
import type { GameState } from "../core/state";
import {
  AWAY_SHEET_MIN_ELAPSED_MS,
  deriveAwaySheet,
} from "./awaySheet";
import type { AwaySheetContent, AwaySheetModel } from "./awaySheet";
import { buildBountyCards, buildProgressMetricContext, buildStreakModel } from "./dailies";
import { eventAdjustedPityThreshold } from "../core/progression/events";
import { pityThresholdFor } from "../core/progression/pity";
import { touchVisit } from "../core/progression/streak";
import { isNextTierXpReady } from "../core/progression/xp";
import { keepLevels } from "../content/keep";
import { RESOURCE_IDS } from "../core/economy";
import { metricValue } from "../core/progression/milestones";
import { tuning as contentTuning } from "../content/tuning";
import type { Tuning } from "../content/tuning";
import { EXPEDITION_IDS, expeditions as contentExpeditions } from "../content/expeditions";
import { species as contentSpecies } from "../content/species";
import { MILESTONES as contentMilestones } from "../content/milestones";

export { AWAY_SHEET_MIN_ELAPSED_MS };

// ---------------------------------------------------------------------------
// The one-nudge priority chain (bible §10.2 row 6)
// ---------------------------------------------------------------------------

export interface Nudge {
  readonly icon: string;
  readonly text: string;
}

function pippingEggNudge(state: GameState): Nudge | null {
  const count = state.eggs.filter((egg) => egg.state === EggState.Pipping).length;
  if (count === 0) return null;
  return {
    icon: "🥚",
    text:
      count === 1
        ? "Someone's egg is pipping — go take a look."
        : `${count} eggs are pipping — go take a look.`,
  };
}

function readyToEvolveNudge(state: GameState): Nudge | null {
  const pip = Object.values(state.pips).find((p) => p.readyToEvolve);
  if (pip === undefined) return null;
  return {
    icon: "✨",
    text: `${pip.name} is glowing — ready to grow up whenever you tap them.`,
  };
}

function unlockedBiomeIds(keepLevel: number): readonly string[] {
  return EXPEDITION_IDS.filter(
    (id) => contentExpeditions[id].unlockKeepLevel <= keepLevel,
  );
}

/** One away from a guaranteed rare find in any unlocked biome — the SAME
 * pity math `focusView.ts`'s per-row indicator uses, kept independent so
 * neither file has to import the other (spec §2 rule 5's "content is
 * data, composed at the call site" spirit, applied to a UI-layer read). */
function pityNudge(state: GameState, tuning: Tuning): Nudge | null {
  for (const biomeId of unlockedBiomeIds(state.keep.level)) {
    const def = contentExpeditions[biomeId as keyof typeof contentExpeditions];
    const pool = (def.eggSpecies ?? []).map((id) => ({
      id,
      rarity: contentSpecies[id]?.rarity ?? "common",
    }));
    const baseThreshold = pityThresholdFor(pool, tuning);
    if (baseThreshold === null) continue; // common-only pool — nothing to chase
    const threshold =
      eventAdjustedPityThreshold(baseThreshold, biomeId, state.activeEvents, tuning) ??
      baseThreshold;
    const counter = state.eggPity[biomeId] ?? 0;
    if (threshold - counter <= 1) {
      return {
        icon: "🌟",
        text: `A rare find is due soon at the ${def.name}.`,
      };
    }
  }
  return null;
}

function albumNudge(state: GameState, tuning: Tuning): Nudge | null {
  const remaining = tuning.retention.pipdex.albumTarget - state.pipdex.formsCaught;
  if (remaining === 1) {
    return { icon: "📖", text: "The Album is one form away from complete." };
  }
  return null;
}

/** "One step away" milestones only — never a hidden one (bible §4.1:
 * hidden milestones are "revealed only on earning", so a nudge must not
 * tease their existence early). */
function milestoneNudge(state: GameState, tuning: Tuning): Nudge | null {
  const ctx = buildProgressMetricContext(state, tuning);
  for (const def of contentMilestones) {
    if (def.hidden === true) continue;
    if (state.milestones.earned[def.id] !== undefined) continue;
    if (!Number.isFinite(def.threshold)) continue;
    const value = metricValue(def.metric, ctx);
    if (def.threshold - value === 1) {
      return { icon: "🏅", text: `${def.name} is one step away.` };
    }
  }
  return null;
}

/**
 * ROUND 2F (progression bible §6.3) — "a Keep tier ready to grow", the one
 * new entry at the END of the chain.
 *
 * Last on purpose: a pipping egg or a glowing Pip is a moment that will not
 * wait, whereas a Ready tier waits forever (bible §0.3), so it should never
 * push a perishable moment off the screen. But it belongs on the Doorstep at
 * all because it is the single most valuable thing a returning player can be
 * told — the whole ladder is invisible until someone mentions it.
 */
function keepTierReadyNudge(state: GameState, tuning: Tuning): Nudge | null {
  if (!isNextTierXpReady(state.keepXp, state.keep.level, tuning)) return null;
  const nextDef = keepLevels.find((d) => d.level === state.keep.level + 1);
  if (nextDef === undefined) return null;
  return {
    icon: "✦",
    text: `The Keep has grown enough for level ${state.keep.level + 1} — ${nextDef.headline}.`,
  };
}

/** Exactly one nudge, by priority — never more (bible §10.2/§10.5's "the
 * difference between a warm welcome and a to-do list"). */
export function pickNudge(state: GameState, tuning: Tuning = contentTuning): Nudge | null {
  return (
    pippingEggNudge(state) ??
    readyToEvolveNudge(state) ??
    pityNudge(state, tuning) ??
    albumNudge(state, tuning) ??
    milestoneNudge(state, tuning) ??
    keepTierReadyNudge(state, tuning) ??
    null
  );
}

// ---------------------------------------------------------------------------
// What the absence PAID (bible §6.3) — the Doorstep's missing good news
// ---------------------------------------------------------------------------

/** "+340 Keep XP while you were away." — null when the absence earned none
 * (a short gap with nobody working), because a "+0" line is worse than no
 * line. Reads `summary.keepXpGained`, stamped on by the reducer. */
export function awayXpLine(summary: CatchupSummary): string | null {
  const gained = summary.keepXpGained ?? 0;
  if (gained <= 0) return null;
  return `+${gained.toLocaleString("en-US")} Keep XP while you were away.`;
}

/** "Your Gathering Station brought in 22 Wood, 31 Fiber and 2 Shell." — the
 * other half of what an absence actually paid, and the reason staffing a
 * station before you close the app feels worth doing. Null with nothing
 * produced. */
export function awayProductionLine(summary: CatchupSummary): string | null {
  const produced = summary.produced ?? {};
  const parts = RESOURCE_IDS.flatMap((id) => {
    const count = produced[id] ?? 0;
    return count > 0 ? [`${count} ${resourceLabel(id)}`] : [];
  });
  if (parts.length === 0) return null;
  const list =
    parts.length === 1
      ? (parts[0] as string)
      : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1] as string}`;
  return `The Keep kept working: ${list} came in.`;
}

function resourceLabel(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

// ---------------------------------------------------------------------------
// The Doorstep model — AwaySheetModel, extended (bible §10.4)
// ---------------------------------------------------------------------------

export interface DoorstepModel {
  readonly away: AwaySheetModel;
  /** Null when there is nothing to say yet (a brand-new save that hasn't
   * visited today) — the section is simply omitted, never shown empty. */
  readonly streakLine: string | null;
  /**
   * The "you are welcome here" line, shown ONLY when the absence just cost the
   * streak its count (a gap past grace). This is bible §3.4's promise made
   * visible at the one moment it matters — before this existed, a returning
   * player's streak reset in silence, which inverted the round's guardrail.
   * Null in every ordinary case, because there is nothing to reassure about.
   */
  readonly welcomeBackLine: string | null;
  /** The auto-banked ladder reward for today, or null while a choice
   * reward is still waiting on a tap (that gets its own picker, not a
   * banner — see ./dailies.ts's pendingChoices). */
  readonly bannerRewardLine: string | null;
  /** Today's three bounties as a compact, clockless checklist. */
  readonly bountyLines: readonly string[];
  /**
   * ROUND 2F (bible §6.3) — the good news, inside "The Keep" section rather
   * than as a sixth section (§10.1's section budget is fixed): what the
   * absence EARNED, above the decay it cost. Empty when an absence genuinely
   * earned nothing, so a quiet return still reads quietly.
   */
  readonly keepGainLines: readonly string[];
  readonly nudge: Nudge | null;
}

/**
 * `state` with its streak advanced to `now` — a PROJECTION, not a dispatch
 * (see the module doc's "the streak section is a projection" note for why the
 * raw `state.streak` is the wrong thing to paint). Reuses the reducer's own
 * pure `touchVisit`, so the Doorstep can never disagree with what the first
 * tap will actually do.
 */
function projectStreak(state: GameState, now: number, tuning: Tuning): GameState {
  const streak = touchVisit(state.streak, now, state.dayOffsetMs, tuning);
  return streak === state.streak ? state : { ...state, streak };
}

/**
 * ROUND 2F — "A REPORT OF ±1s IS NOT A REPORT."
 *
 * Absences over `AWAY_SHEET_MIN_ELAPSED_MS` (3 minutes) get the full Doorstep,
 * and three minutes is exactly at the boundary bible §10.3 draws — so a
 * notification, a phone call or an app switch came back to a MODAL WALL reading
 * "You were gone 3 minutes. The Keep kept busy." over three lines of
 * `Hunger ↓1 Cleanliness ↓1 Happiness ↓1 Energy ↓1`, and the player tapped
 * "Come in" past it while losing whatever sheet they had open.
 *
 * Rather than retuning the threshold (which only moves the boundary somewhere
 * else), this asks the honest question: did anything worth a modal actually
 * happen? Trivial means EVERY reported need moved by 1 or less AND nothing came
 * home — no trip, no egg, no loot, no rate-cap note.
 *
 * `QUIET_ABSENCE_MS` is the belt and braces: past an hour the player is
 * greeted regardless, because "no deltas" can also mean a Pip whose needs were
 * ALREADY at 0 and had nowhere left to fall — which is precisely when they most
 * need telling. And `pips.length === 0` never counts as trivial: no evidence is
 * not evidence of nothing.
 */
export const QUIET_ABSENCE_MS = 60 * 60 * 1000;

export function isTrivialAbsence(
  summary: CatchupSummary,
  away: AwaySheetModel,
  quietMs: number = QUIET_ABSENCE_MS,
): boolean {
  if (summary.elapsedMs >= quietMs) return false;
  if (away.pips.length === 0) return false;
  if (away.expeditionLines.length > 0) return false;
  if (away.eggLine !== null || away.lootLine !== null || away.cappedLine !== null) {
    return false;
  }
  return away.pips.every(
    (pip) => pip.note === null && pip.needLines.every((need) => need.amount <= 1),
  );
}

export function deriveDoorstepModel(
  summary: CatchupSummary,
  state: GameState,
  now: number,
  content: AwaySheetContent = {},
  tuning: Tuning = contentTuning,
): DoorstepModel | null {
  // Inherits the "no Doorstep under 3 minutes" rule for free (bible §10.3)
  // — a tab flick gets nothing, exactly as it always has.
  const away = deriveAwaySheet(summary, state, content);
  if (away === null) return null;
  // …and nothing worth a modal is the same as nothing (see above).
  if (isTrivialAbsence(summary, away)) return null;

  const projected = projectStreak(state, now, tuning);
  const streakModel = buildStreakModel(projected, tuning);
  const streakLine = streakModel.current > 0 ? streakModel.headline : null;

  // A gap past grace: `current` restarts at 1 from something longer. THIS is
  // the moment to be warm and specific about what a break does and does not
  // cost (bible §0.1: "a broken streak costs a bonus. Full stop.").
  const lapsed = state.streak.current > 1 && streakModel.current === 1;
  const welcomeBackLine = lapsed
    ? "Everything else is exactly where you left it — every page, every milestone, every friend. Only the bonus starts over."
    : null;

  const bannerRewardLine =
    streakModel.current > 0 && streakModel.pendingChoices.length === 0
      ? `Today: ${streakModel.todaysRewardLabel}`
      : null;

  const bountyLines = buildBountyCards(projected, tuning).map(
    (card) => `${card.complete ? "✓" : `${card.progress}/${card.target}`} ${card.title}`,
  );

  // The absence's EARNINGS, listed before its costs in the same section
  // (bible §6.3: "+1 line, not a section").
  const keepGainLines = [awayXpLine(summary), awayProductionLine(summary)].filter(
    (line): line is string => line !== null,
  );

  return {
    away,
    streakLine,
    welcomeBackLine,
    bannerRewardLine,
    bountyLines,
    keepGainLines,
    nudge: pickNudge(state, tuning),
  };
}

// ---------------------------------------------------------------------------
// DOM shell — same contract as awaySheet.ts's createAwaySheet
// ---------------------------------------------------------------------------

export interface DoorstepDeps {
  readonly mount: HTMLElement;
  /** Dismiss tapped — the caller plays the queued loot reveal next, same
   * as the plain away sheet. */
  onDismiss(): void;
}

export interface Doorstep {
  readonly el: HTMLElement;
  show(model: DoorstepModel): void;
  hide(): void;
  isOpen(): boolean;
}

export function createDoorstep(deps: DoorstepDeps): Doorstep {
  const el = document.createElement("div");
  el.className = "pk-doorstep";

  const backdrop = document.createElement("div");
  backdrop.className = "pk-doorstep-backdrop";

  const card = document.createElement("div");
  card.className = "pk-doorstep-card";

  const titleEl = document.createElement("div");
  titleEl.className = "pk-doorstep-title";
  const elapsedEl = document.createElement("div");
  elapsedEl.className = "pk-doorstep-elapsed";
  const bodyEl = document.createElement("div");
  bodyEl.className = "pk-doorstep-body";

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "pk-doorstep-dismiss";
  dismiss.textContent = "Come in";

  card.append(titleEl, elapsedEl, bodyEl, dismiss);
  el.append(backdrop, card);
  deps.mount.appendChild(el);

  let open = false;

  const hide = (): void => {
    open = false;
    el.classList.remove("pk-doorstep--open");
  };

  dismiss.addEventListener("click", () => {
    if (!open) return;
    sound("away.dismiss");
    hide();
    deps.onDismiss();
  });

  const section = (heading: string | null, lines: readonly string[]): HTMLElement => {
    const sec = document.createElement("div");
    sec.className = "pk-doorstep-section";
    if (heading !== null) {
      const h = document.createElement("div");
      h.className = "pk-doorstep-heading";
      h.textContent = heading;
      sec.appendChild(h);
    }
    for (const text of lines) {
      const line = document.createElement("div");
      line.className = "pk-doorstep-line";
      line.textContent = text;
      sec.appendChild(line);
    }
    return sec;
  };

  return {
    el,

    show(model: DoorstepModel): void {
      titleEl.textContent = model.away.title;
      elapsedEl.textContent = model.away.elapsedLine;
      bodyEl.replaceChildren();

      // §2 Streak — omitted while there's nothing to say yet.
      if (model.streakLine !== null) {
        const lines = [model.streakLine];
        if (model.welcomeBackLine !== null) lines.push(model.welcomeBackLine);
        if (model.bannerRewardLine !== null) lines.push(model.bannerRewardLine);
        bodyEl.appendChild(section("Streak", lines));
      }

      // §3 The Keep — what the absence EARNED first, then the per-pip need
      // arrows + capped-time note, verbatim from the away model.
      //
      // ORDER MATTERS AND IS THE FIX. This section used to open with three-to-
      // twelve lines of pure decay (`Pip1 — Hunger ↓49 Cleanliness ↓59 …`), so
      // at a roster cap of 6 the return screen was twelve lines of downward
      // arrows before anything positive appeared. The earnings go FIRST.
      const keepLines: string[] = [...model.keepGainLines];
      for (const pip of model.away.pips) {
        const chips = pip.needLines
          .map((n) => `${n.label} ${n.direction === "down" ? "↓" : "↑"}${n.amount}`)
          .join(" ");
        keepLines.push(
          `${pip.name}${chips.length > 0 ? " — " + chips : ""}${pip.note !== null ? " — " + pip.note : ""}`,
        );
      }
      if (keepLines.length > 0) bodyEl.appendChild(section("The Keep", keepLines));

      // §4 Homecomings — a TEASE, never the reveal's contents.
      const homecomingLines = [...model.away.expeditionLines];
      if (model.away.eggLine !== null) homecomingLines.push(model.away.eggLine);
      if (model.away.lootLine !== null) homecomingLines.push(model.away.lootLine);
      if (model.away.cappedLine !== null) homecomingLines.push(model.away.cappedLine);
      if (homecomingLines.length > 0) {
        bodyEl.appendChild(section("Homecomings", homecomingLines));
      }

      // §5 Today's round — compact checklist, no clock.
      if (model.bountyLines.length > 0) {
        bodyEl.appendChild(section("Today's round", model.bountyLines));
      }

      // §6 One nudge, at most.
      if (model.nudge !== null) {
        const nudgeEl = section(null, [`${model.nudge.icon} ${model.nudge.text}`]);
        nudgeEl.classList.add("pk-doorstep-nudge");
        bodyEl.appendChild(nudgeEl);
      }

      open = true;
      sound("away.open");
      el.classList.add("pk-doorstep--open");
    },

    hide,
    isOpen: () => open,
  };
}
