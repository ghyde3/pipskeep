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
import type { AwayPipLine, AwaySheetContent, AwaySheetModel } from "./awaySheet";
import { buildBountyCards, buildProgressMetricContext, buildStreakModel } from "./dailies";
import { eventAdjustedPityThreshold } from "../core/progression/events";
import { pityThresholdFor } from "../core/progression/pity";
import { touchVisit } from "../core/progression/streak";
import { RESOURCE_IDS } from "../core/economy";
import { metricValue } from "../core/progression/milestones";
import { tuning as contentTuning } from "../content/tuning";
import type { Tuning } from "../content/tuning";
import { EXPEDITION_IDS, expeditions as contentExpeditions } from "../content/expeditions";
import { species as contentSpecies } from "../content/species";
import { recipes as contentRecipes } from "../content/recipes";
import { MILESTONES as contentMilestones } from "../content/milestones";
// ROUND 2G (docs/hud-redesign.md §5.1 decision 3): the Keep's tier/XP
// progress reads through the SAME pure model the Keep XP bar itself uses,
// so this surface can never disagree with the bar the way the upgrade
// card once did (hud-redesign.md N3: two surfaces, one number, two
// answers). `xpBar.ts` is peer-owned chrome — nothing here renders it or
// changes it, only reads its exported, already-tested arithmetic.
import { buildXpBarModel } from "./xpBar";

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

/** Exactly one nudge, by priority — never more (bible §10.2/§10.5's "the
 * difference between a warm welcome and a to-do list").
 *
 * ROUND 2G (hud-redesign.md §5.1 decision 3): "a Keep tier ready to grow"
 * USED to be the last entry here (round 2F). It is gone from this chain —
 * not dropped, PROMOTED. A nudge is for a perishable moment (a pipping egg
 * that will not wait); a Ready tier waits forever (bible §0.3), so it was
 * never really competing for the same slot, it was just squatting in it —
 * and on the one save that had no closer-priority nudge, "the single most
 * valuable thing a returning player can be told" was a coin-flip against a
 * milestone that was one step away. `keepTierLine` below states it instead
 * as a permanent FACT inside "The Keep" section, every time, which is
 * strictly more visible than winning a priority chain sometimes. */
export function pickNudge(state: GameState, tuning: Tuning = contentTuning): Nudge | null {
  return (
    pippingEggNudge(state) ??
    readyToEvolveNudge(state) ??
    pityNudge(state, tuning) ??
    albumNudge(state, tuning) ??
    milestoneNudge(state, tuning) ??
    null
  );
}

// ---------------------------------------------------------------------------
// THE KEEP'S TIER LINE (hud-redesign.md §5.1 decision 3) — a permanent fact,
// not a nudge; see pickNudge's doc above for why it moved.
// ---------------------------------------------------------------------------

/**
 * "Lv 8 — 261 / 1,150 toward the Chronicle." / "Lv 8 ▸ Ready — the
 * Chronicle is waiting." — always present (there is always a level, always
 * a bar), so it anchors "The Keep" section with a positive, permanent fact
 * even on a return that earned nothing this trip (`keepGainLines` empty).
 *
 * Reads `buildXpBarModel` — the SAME pure model `ui/xpBar.ts` renders —
 * rather than recomputing the tier/XP arithmetic a second time. That is
 * deliberate: hud-redesign.md's N3 finding was two surfaces disagreeing
 * about one number (`2,300 / 2,300` on the bar, `2,970 / 2,300` on the
 * upgrade card) because one of them did its own math. Reusing `numerals`
 * and `nextTierName` verbatim means the Doorstep can never drift from the
 * bar the same way.
 */
export function keepTierLine(state: GameState, tuning: Tuning = contentTuning): string {
  const bar = buildXpBarModel(state, tuning);
  if (bar.atTopTier) {
    return bar.renownFlairName !== null
      ? `${bar.levelLabel} — ${bar.renownNextIn.toLocaleString("en-US")} XP to ${bar.renownFlairName}.`
      : `${bar.levelLabel} — every flourish earned.`;
  }
  if (bar.ready) {
    return `${bar.levelLabel} — ${bar.nextTierName ?? "a new tier"} is waiting.`;
  }
  return `${bar.levelLabel} — ${bar.numerals} toward ${bar.nextTierName ?? "the next tier"}.`;
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

/**
 * ROUND 2J FIX STAGE — "The Craft Table finished: 2 Poultices."
 *
 * Verified in play before this existed: queue a Poultice, skip +6h, and
 * the Doorstep read "THE KEEP — Lv 4 — 0/400 toward The Lanterngrotto.
 * +8 Keep XP while you were away." and nothing else. No line, no toast, no
 * scene change — the only trace of a finished craft was a bare XP chip,
 * and the jar was in the Satchel if you thought to go and look.
 *
 * `awayProductionLine` above could never have covered it: it walks
 * `summary.produced`, which is a RESOURCE delta, and a crafted Poultice
 * lands in `inventory`. Hence `CatchupSummary.crafted`, stamped by the
 * same reducer pass.
 */
export function awayCraftLine(summary: CatchupSummary): string | null {
  const crafted = summary.crafted ?? {};
  const parts = Object.entries(crafted)
    .filter(([, count]) => count > 0)
    .map(([recipeId, count]) => {
      const name = craftedRecipeName(recipeId);
      return count === 1 ? name : `${count} × ${name}`;
    });
  if (parts.length === 0) return null;
  const list =
    parts.length === 1
      ? (parts[0] as string)
      : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1] as string}`;
  return `The Craft Table finished: ${list}.`;
}

/** Recipe display name, with the crafted decoration's own name as the
 * fallback for a keepsake recipe (both registries are content). */
function craftedRecipeName(recipeId: string): string {
  const recipe = (contentRecipes as Readonly<Record<string, { name: string }>>)[recipeId];
  if (recipe !== undefined) return recipe.name;
  return recipeId;
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
  /**
   * ROUND 2G (hud-redesign.md §5.1 decision 3) — "Lv 8 — 261 / 1,150
   * toward the Chronicle." / "Lv 8 ▸ Ready — the Chronicle is waiting."
   * ALWAYS present (see `keepTierLine`'s doc), so "The Keep" section leads
   * with a permanent, positive fact even on a quiet return where
   * `keepGainLines` is empty. Replaces the old `keepTierReadyNudge`,
   * which only ever spoke up when it won a priority chain.
   */
  readonly tierLine: string;
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

  // ROUND 2G: name the Keep XP alongside the ladder reward — it used to be
  // silent here too (see dailies.ts's `rewardXp` doc for why the XP is
  // never gated behind `pendingChoices` the way the reward label is).
  //
  // ROUND 2G REVIEW — SAY THAT IT HAS NOT HAPPENED YET. This read "Today:
  // +20 XP · 2 Berry", which is the grammar of a receipt. It is not one: it
  // is `projectStreak`'s forecast of what the first tap will bank, and on a
  // brand-new save it was the ONLY gain-shaped line on the entire card, so a
  // returning player read it as their reward, tapped "Come in", and found
  // the XP bar still saying 30 / 100. A future tense costs two words and
  // stops the card from over-claiming.
  const bannerRewardLine =
    streakModel.current > 0 && streakModel.pendingChoices.length === 0
      ? `Waiting for you today: +${streakModel.rewardXp} XP · ${streakModel.todaysRewardLabel}`
      : null;

  // "○ A proper nap — 0 of 1" rather than "0/1 A proper nap". Three bounties
  // whose targets happen to be 1, 2 and 3 printed as "0/1, 0/2, 0/3", which
  // reads as an ordinal list ("item 1 of 3") on first glance — confirmed by
  // watching them resolve to "✓ / ✓ / 2/3", the point at which the format
  // finally became legible. The leading marker carries done-ness; the
  // fraction is spelled out and follows the title, where a count belongs.
  const bountyLines = buildBountyCards(projected, tuning).map((card) =>
    card.complete
      ? `✓ ${card.title} — done`
      : `○ ${card.title} — ${card.progress} of ${card.target}`,
  );

  // The absence's EARNINGS, listed before its costs in the same section
  // (bible §6.3: "+1 line, not a section").
  const keepGainLines = [
    awayXpLine(summary),
    awayProductionLine(summary),
    // ROUND 2J FIX STAGE — the bench's own line, alongside the station's.
    awayCraftLine(summary),
  ].filter((line): line is string => line !== null);

  return {
    away,
    streakLine,
    welcomeBackLine,
    bannerRewardLine,
    bountyLines,
    keepGainLines,
    tierLine: keepTierLine(state, tuning),
    nudge: pickNudge(state, tuning),
  };
}

// ---------------------------------------------------------------------------
// The per-pip block: capped rows + deduplicated notes (hud-redesign.md
// §5.1 decision 2) — pure, so both are unit-testable without a DOM.
// ---------------------------------------------------------------------------

/** Rows shown before a "+N more" disclosure takes over (roster cap is 6,
 * so an uncapped block could reach 6 name+need+note rows of pure decay
 * before the Doorstep said anything else — measured on the shipped build
 * at 5 Pips: "twelve lines of downward arrows before anything positive"). */
export const DOORSTEP_PIP_CAP = 3;

/** Slice `pips` to the cap unless `expanded` — the DOM shell's disclosure
 * button flips `expanded` and re-renders in place, same per-instance
 * pattern `buildSheet.ts`'s `expandedSets` uses (starts tidy on every
 * open, nothing persisted). */
export function cappedAwayPips(
  pips: readonly AwayPipLine[],
  expanded: boolean,
  cap: number = DOORSTEP_PIP_CAP,
): { readonly shown: readonly AwayPipLine[]; readonly hiddenCount: number } {
  if (expanded || pips.length <= cap) return { shown: pips, hiddenCount: 0 };
  return { shown: pips.slice(0, cap), hiddenCount: pips.length - cap };
}

const AWAY_COUNT_WORDS = ["zero", "one", "two", "three", "four", "five", "six"] as const;

function awayCountWord(n: number): string {
  return AWAY_COUNT_WORDS[n] ?? String(n);
}

function capitalizeFirst(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Every note `deriveAwaySheet` writes reads as a sentence fragment
 * following a Pip's NAME ("…came home a bit sulky. One good snack fixes
 * everything.", rendered as `${name} — …${note}`). A note shared by 2+
 * Pips collapses into ONE section-level line using the exact same
 * fragment ("Three of them came home a bit sulky. One good snack fixes
 * everything."), because the fragment's grammar already assumes a
 * subject in front of it — "of them" fills that role for a group as
 * cleanly as a name does for one.
 *
 * Returns the per-pip list with the now-collective note stripped (so the
 * DOM shell doesn't print it twice) plus the shared lines to render once,
 * in first-seen order. Pips with a UNIQUE note keep it — only genuine
 * repetition is what "the same two lines on almost every card" (bible's
 * own words, aimed at the Build sheet, apply here too) is collapsing.
 */
export function summarizeAwayNotes(pips: readonly AwayPipLine[]): {
  readonly pips: readonly AwayPipLine[];
  readonly sharedNotes: readonly string[];
} {
  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const pip of pips) {
    if (pip.note === null) continue;
    if (!counts.has(pip.note)) order.push(pip.note);
    counts.set(pip.note, (counts.get(pip.note) ?? 0) + 1);
  }
  const shared = new Set(
    order.filter((note) => (counts.get(note) ?? 0) >= 2),
  );
  if (shared.size === 0) return { pips, sharedNotes: [] };

  const sharedNotes = order
    .filter((note) => shared.has(note))
    .map((note) => `${capitalizeFirst(awayCountWord(counts.get(note) ?? 0))} of them ${note}`);

  const strippedPips = pips.map((pip) =>
    pip.note !== null && shared.has(pip.note) ? { ...pip, note: null } : pip,
  );
  return { pips: strippedPips, sharedNotes };
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

/**
 * One rendered line, plus how loudly it should read.
 *
 * The Doorstep's whole job is telling a returning player what happened, and
 * the round-2G review's measurement of it was blunt: what the absence EARNED
 * and what it COST were rendered in identical type, so the card was
 * indistinguishable from a decay report. `tone` is the ranking that fixes
 * that, and it travels with the line rather than being applied by position
 * afterwards (see `section` below).
 */
type DoorstepLineTone = "tier" | "gain";

interface DoorstepLine {
  readonly text: string;
  readonly tone?: DoorstepLineTone;
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

  // ROUND 2G (hud-redesign.md §5.1 decision 1) — a fixed footer OUTSIDE
  // `.pk-doorstep-body`'s scroll region, so "Come in" (the sheet's one
  // dismiss button) is always reachable no matter how long the body gets.
  const footer = document.createElement("div");
  footer.className = "pk-doorstep-footer";
  footer.appendChild(dismiss);

  card.append(titleEl, elapsedEl, bodyEl, footer);
  el.append(backdrop, card);
  deps.mount.appendChild(el);

  let open = false;
  // ROUND 2G (hud-redesign.md §5.1 decision 2) — starts collapsed on every
  // open, same per-instance-not-persisted convention `buildSheet.ts`'s
  // `expandedSets` uses ("reopening the sheet starts tidy again").
  let pipsExpanded = false;

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

  const section = (
    heading: string | null,
    lines: readonly DoorstepLine[],
  ): HTMLElement => {
    const sec = document.createElement("div");
    sec.className = "pk-doorstep-section";
    if (heading !== null) {
      const h = document.createElement("div");
      h.className = "pk-doorstep-heading";
      h.textContent = heading;
      sec.appendChild(h);
    }
    for (const { text, tone } of lines) {
      const line = document.createElement("div");
      // The tone travels WITH the line rather than being pinned on
      // afterwards by position. `renderBody` used to reach back in with
      // `keepSection.querySelector(".pk-doorstep-line")?.classList.add(…)`
      // to mark the tier line — an optional-chained hook that assumed the
      // tier line was always the section's first, and would have silently
      // painted nothing the day that order changed (round 2G review). A
      // no-op that looks like a success is exactly the class of bug this
      // round is about.
      line.className =
        tone === undefined
          ? "pk-doorstep-line"
          : `pk-doorstep-line pk-doorstep-line--${tone}`;
      line.textContent = text;
      sec.appendChild(line);
    }
    return sec;
  };

  const plain = (text: string): DoorstepLine => ({ text });

  /** Rebuilds the whole body from `model` — called on open, and again by
   * the per-pip disclosure toggle (which only flips `pipsExpanded`, never
   * re-derives the model). */
  function renderBody(model: DoorstepModel): void {
    bodyEl.replaceChildren();

    // §2 Streak — omitted while there's nothing to say yet.
    if (model.streakLine !== null) {
      const lines: DoorstepLine[] = [plain(model.streakLine)];
      if (model.welcomeBackLine !== null) lines.push(plain(model.welcomeBackLine));
      // NOT a `--gain`: this is a FORECAST of what today's first tap will
      // bank, not something already earned (see `bannerRewardLine`'s doc).
      // Styling it as a gain is precisely how a reviewer read it as a reward,
      // tapped "Come in", and found the XP bar unchanged.
      if (model.bannerRewardLine !== null) lines.push(plain(model.bannerRewardLine));
      bodyEl.appendChild(section("Streak", lines));
    }

    // §3 The Keep — leads with the PERMANENT tier fact, then what the
    // absence EARNED, then any note shared by 2+ Pips collapsed to one
    // line, then the per-pip need arrows + capped-time note (capped at
    // DOORSTEP_PIP_CAP rows with a "+N more" disclosure).
    //
    // ORDER MATTERS AND IS THE FIX. This section used to open with three-to-
    // twelve lines of pure decay (`Pip1 — Hunger ↓49 Cleanliness ↓59 …`), so
    // at a roster cap of 6 the return screen was twelve lines of downward
    // arrows before anything positive appeared. The permanent fact and the
    // earnings go FIRST, and repetition ("came home a bit sulky" printed
    // once per Pip) collapses into one line instead of three.
    //
    // ROUND 2G REVIEW — RANKING, NOT JUST ORDERING. Putting the gains first
    // was necessary and not sufficient: they rendered as `.pk-doorstep-line`
    // exactly like the decay beneath them (13px, weight 400, rgb(61,74,61)),
    // so "+81 Keep XP while you were away." and "Mosspip — Hunger ↓60
    // Cleanliness ↓68 …" were typographically the same sentence. Measured on
    // a real return: the gain line was 5,328px² against 16,280px² of decay —
    // 3.1× larger, same weight, same colour. The only colour-differentiated
    // lines on the whole card were the tier line and the nudge, neither of
    // which is something the player RECEIVED. `--gain` is that missing rank.
    const keepLines: DoorstepLine[] = [
      { text: model.tierLine, tone: "tier" },
      ...model.keepGainLines.map((text) => ({ text, tone: "gain" as const })),
    ];
    const { pips: dedupedPips, sharedNotes } = summarizeAwayNotes(model.away.pips);
    keepLines.push(...sharedNotes.map(plain));
    const { shown, hiddenCount } = cappedAwayPips(dedupedPips, pipsExpanded);
    for (const pip of shown) {
      const chips = pip.needLines
        .map((n) => `${n.label} ${n.direction === "down" ? "↓" : "↑"}${n.amount}`)
        .join(" ");
      keepLines.push(
        plain(
          `${pip.name}${chips.length > 0 ? " — " + chips : ""}${pip.note !== null ? " — " + pip.note : ""}`,
        ),
      );
    }
    // Always shown: `tierLine` guarantees this section is never empty.
    const keepSection = section("The Keep", keepLines);
    if (hiddenCount > 0 || (pipsExpanded && dedupedPips.length > DOORSTEP_PIP_CAP)) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "pk-doorstep-more";
      toggle.textContent = pipsExpanded ? "Show less" : `+${hiddenCount} more`;
      toggle.addEventListener("click", () => {
        sound("ui.tap");
        pipsExpanded = !pipsExpanded;
        renderBody(model);
      });
      keepSection.appendChild(toggle);
    }
    bodyEl.appendChild(keepSection);

    // §4 Homecomings — a TEASE, never the reveal's contents.
    const homecomingLines = [...model.away.expeditionLines];
    if (model.away.eggLine !== null) homecomingLines.push(model.away.eggLine);
    if (model.away.lootLine !== null) homecomingLines.push(model.away.lootLine);
    if (model.away.cappedLine !== null) homecomingLines.push(model.away.cappedLine);
    if (homecomingLines.length > 0) {
      bodyEl.appendChild(section("Homecomings", homecomingLines.map(plain)));
    }

    // §5 Today's round — compact checklist, no clock.
    if (model.bountyLines.length > 0) {
      bodyEl.appendChild(section("Today's round", model.bountyLines.map(plain)));
    }

    // §6 One nudge, at most.
    if (model.nudge !== null) {
      const nudgeEl = section(null, [plain(`${model.nudge.icon} ${model.nudge.text}`)]);
      nudgeEl.classList.add("pk-doorstep-nudge");
      bodyEl.appendChild(nudgeEl);
    }
  }

  return {
    el,

    show(model: DoorstepModel): void {
      titleEl.textContent = model.away.title;
      elapsedEl.textContent = model.away.elapsedLine;
      pipsExpanded = false;
      renderBody(model);

      open = true;
      sound("away.open");
      el.classList.add("pk-doorstep--open");
    },

    hide,
    isOpen: () => open,
  };
}
