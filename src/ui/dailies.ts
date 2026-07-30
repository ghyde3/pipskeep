/**
 * Dailies (docs/retention-bible.md §3 streak, §4 milestones, §5 bounties)
 * — the browsable "what's going on today, and what have I earned" surface.
 * Owned end-to-end by the round-2C UI agent: pure model builders here are
 * unit-tested directly; the DOM shell is dumb chrome around them (same
 * split as every other ui/ module in this codebase).
 *
 * THE GUARDRAIL, restated because this is the file most likely to violate
 * it by accident: nothing here ever shows a countdown, a "streak at risk"
 * warning, or a claim DEADLINE (bible §0.3). A broken streak's ONLY cost
 * is the bonus tier — `streakHeadline` never says "you lost your streak",
 * only ever "day 1" or "a fresh start". Bounties never show a clock
 * ("Today's round", no timer — bible §5.4). The egg-pity note is phrased
 * as encouragement, never as a slot-machine countdown.
 *
 * AUTO-BANKING, NOT CLAIM BUTTONS — for all three systems, with no
 * exceptions (docs/retention-bible.md §0.2: "rewards that need no choice
 * auto-bank the instant they're earned, so there is nothing to forget";
 * §3.5/§5.4 say the same for the ladder and bounties). `initDailiesUi` is the
 * one place that dispatches `CLAIM_STREAK_REWARD`/`REFRESH_BOUNTIES`/
 * `CLAIM_MILESTONE` — all idempotent in core, so redispatching at every boot,
 * every foreground and after every action is always safe — so the player
 * never has to remember to tap anything for anything to pay out. The sheet
 * still celebrates each moment (confetti/sound/toast) even though nothing was
 * tapped, because "claiming must feel juicy" needs a payoff, not a claim verb.
 *
 * MILESTONES USED TO BE THE EXCEPTION, and it was a mistake (round-2C review):
 * every milestone reward is a non-choice (resources, items, a keepsake, or
 * flair), so gating them behind a Claim tap created the one nagging surface in
 * the round — a standing numeric badge on the Nook button plus seven taps in a
 * new player's first hour. The earlier justification here ("the core contract
 * genuinely gates their reward behind an explicit CLAIM_MILESTONE dispatch,
 * bible §4.1") misread §4.1, which describes a toast queue and nothing else.
 * `CLAIM_MILESTONE` remains the core-side grant step; this module simply never
 * makes the player be the one to fire it. The ONLY thing that still waits on a
 * tap anywhere in this file is a genuine CHOICE (the day-5 keepsake pick, the
 * day-7/bounty-day egg pick), and a choice waits forever by design.
 *
 * Pure layer (state → view model, all exported and unit-tested):
 *   buildStreakModel, buildBountyCards, buildMilestoneRows, dailyBadgeCount,
 *   detectRainDayToast, detectStreakRewardToast, detectBountyCelebrations,
 *   detectMilestoneCelebrations, formatRewardBundle, formatLadderReward,
 *   formatMilestoneReward.
 *
 * DOM layer: `createDailiesSheet` (the browsable 3-section sheet) +
 * `mountDailiesEntry` (a self-contained floating entry button, same
 * pattern as `soundToggle.ts` — mounts itself into `#ui`, edits no other
 * ui/ module) + `initDailiesUi` (wires both to a Store/Clock, owns the
 * session-lifecycle dispatches per the progression agent's integration
 * note: SET_DAY_OFFSET/SET_ACTIVE_EVENTS/REFRESH_BOUNTIES/
 * CLAIM_STREAK_REWARD at boot and on every foreground return).
 */

import "./dailies.css";
import type { Clock } from "../core/clock";
import { localDayOffsetMs, monthDayFromMs } from "../core/clock";
import type { Store } from "../core/store";
import type { GameAction, GameState } from "../core/state";
import type { StreakChoiceKind, StreakState } from "../core/progression/streak";
import {
  dayIndex,
  effectiveStreakTier,
  ladderDayFor,
  naturalStreakTier,
  pickKeepsakeOffers,
  resolveLadderReward,
  streakLootBonus,
} from "../core/progression/streak";
import type { LadderContent, LadderReward } from "../core/progression/streak";
import { isMilestoneMet, metricValue } from "../core/progression/milestones";
import type { MilestoneMetricContext } from "../core/progression/milestones";
import { masteryTier } from "../core/progression/mastery";
import { resolveActiveEvents } from "../core/progression/events";
import { tuning as contentTuning } from "../content/tuning";
import type { Tuning } from "../content/tuning";
import { MILESTONES as contentMilestones } from "../content/milestones";
import type { MilestoneDef, MilestoneReward } from "../content/milestones";
import { BOUNTY_TEMPLATES as contentBountyTemplates } from "../content/bountyTemplates";
import type { BountyRewardBundle } from "../content/bountyTemplates";
import { decorations as contentDecorations } from "../content/decorations";
import { flairById } from "../content/flair";
import type { FlairKind } from "../content/flair";
import { EXPEDITION_IDS, expeditions as contentExpeditions } from "../content/expeditions";
import { resourceDisplayName } from "./buildMode";
import { sound } from "../app/sound";
import { burstConfetti } from "./confetti";
import { notify } from "./notify";

// ---------------------------------------------------------------------------
// Small shared formatters
// ---------------------------------------------------------------------------

/** "Snowy Lantern" from "snowy-lantern" — for flair/decoration ids that
 * lack a registry name to fall back to. */
function humanize(id: string): string {
  return id
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** "2 Berries + 3 Fiber" — shared by bounty/milestone/streak reward
 * previews (same vocabulary the top bar's satchel chips use). */
export function formatRewardBundle(bundle: {
  readonly resources?: Readonly<Record<string, number>>;
  readonly items?: Readonly<Record<string, number>>;
}): string {
  const parts: string[] = [];
  for (const source of [bundle.resources, bundle.items]) {
    if (source === undefined) continue;
    for (const [id, amount] of Object.entries(source)) {
      if (amount > 0) parts.push(`${amount} ${resourceDisplayName(id)}`);
    }
  }
  return parts.length === 0 ? "a little something" : parts.join(" + ");
}

export function formatBountyReward(reward: BountyRewardBundle): string {
  return formatRewardBundle(reward);
}

/** Where each kind of flourish actually shows up, so the reward line is a
 * promise the game keeps (round-2C review: this line used to say "a flourish
 * for the Album" for 22 rewards that were granted nowhere and drawn nowhere). */
const FLAIR_WHERE: Readonly<Record<FlairKind, string>> = {
  coverStamp: "a stamp for the Album's cover",
  ribbon: "a ribbon for the Album's cover",
  pageFrame: "a frame for the Album's pages",
  pipTitle: "a title for a Pip's card",
  sanctuarySign: "a sign for the Long Meadow's gate",
};

export function formatMilestoneReward(reward: MilestoneReward): string {
  switch (reward.kind) {
    case "resources":
      return formatRewardBundle({ resources: reward.bundle });
    case "items":
      return formatRewardBundle({ items: reward.items });
    case "keepsake": {
      const deco = contentDecorations.find((d) => d.id === reward.decorationId);
      return `${deco?.name ?? humanize(reward.decorationId)} — a free keepsake`;
    }
    case "flair": {
      const def = flairById(reward.flairId);
      if (def === undefined) return `${humanize(reward.flairId)} — a flourish`;
      return `${def.glyph} ${def.name} — ${FLAIR_WHERE[def.kind]}`;
    }
    case "none":
      return "a warm feeling, mostly";
  }
}

export function formatLadderReward(reward: LadderReward): string {
  switch (reward.kind) {
    case "grant":
      return formatRewardBundle(reward);
    case "keepsakeChoice":
      return "a Keepsake — your choice of three";
    case "eggChoice":
      return "an egg from any biome you've unlocked — your choice";
  }
}

// ---------------------------------------------------------------------------
// STREAK — pure model (bible §3)
// ---------------------------------------------------------------------------

export interface StreakOfferModel {
  readonly id: string;
  readonly label: string;
}

export interface StreakPendingChoiceModel {
  readonly kind: StreakChoiceKind;
  readonly forDay: number;
  readonly offers: readonly StreakOfferModel[];
}

export interface StreakDisplayModel {
  readonly current: number;
  readonly longest: number;
  readonly tier: number;
  readonly tierLootBonusLabel: string;
  /** Days until the next tier, or null once at the top tier. */
  readonly nextTierIn: number | null;
  readonly ladderDay: number;
  readonly ladderLength: number;
  readonly graceBanked: number;
  readonly graceMax: number;
  readonly rainDays: number;
  /** True when a past break's `longest` is propping up today's tier
   * (bible §3.4's welcome-back floor) — drives the "thanks to before"
   * framing rather than crediting the current short streak for it. */
  readonly welcomeBackActive: boolean;
  /** Warm, never-guilt headline (bible §10.2 §2, §15.5 tone). */
  readonly headline: string;
  /** What today's ladder day pays (already banked by the time this
   * renders — `initDailiesUi` claims eagerly, bible §3.5 "auto-bank"). */
  readonly todaysRewardLabel: string;
  readonly pendingChoices: readonly StreakPendingChoiceModel[];
}

/** The exact, warm copy for a streak's current state. Never "you lost
 * your streak" — only ever "day 1" or "a fresh start", the difference
 * being whether a past streak is still paying its welcome-back dividend
 * (bible §3.4). Unit-tested directly: this is the round's one hard
 * copy-correctness requirement. */
export function streakHeadline(streak: StreakState, tuning: Tuning): string {
  if (streak.current === 0) return "Say hello to start a streak.";
  const cfg = tuning.retention.streak;
  const natural = naturalStreakTier(streak.current, cfg.tierMinStreakDay);
  const effective = effectiveStreakTier(streak, tuning);
  const welcomeBackActive = effective > natural;
  if (streak.current === 1 && welcomeBackActive) {
    return `A fresh start — and you're already at Tier ${effective}, thanks to your streak before.`;
  }
  if (streak.current === 1) return "Day 1. Off we go.";
  return `Day ${streak.current} in a row.`;
}

function nextTierInDays(current: number, tierMinStreakDay: readonly number[]): number | null {
  for (const threshold of tierMinStreakDay) {
    if (threshold > current) return threshold - current;
  }
  return null;
}

function unlockedExpeditionIds(keepLevel: number): readonly string[] {
  return EXPEDITION_IDS.filter(
    (id) => contentExpeditions[id].unlockKeepLevel <= keepLevel,
  );
}

function ladderContentFor(state: GameState): LadderContent {
  return {
    keepLevel: state.keep.level,
    keepsakeOffers: pickKeepsakeOffers(
      state.seed,
      Math.max(1, state.streak.current),
      contentDecorations.map((d) => d.id),
    ),
    unlockedExpeditionIds: unlockedExpeditionIds(state.keep.level),
  };
}

function offerLabel(kind: StreakChoiceKind, id: string): string {
  if (kind === "keepsake") {
    return contentDecorations.find((d) => d.id === id)?.name ?? humanize(id);
  }
  return (contentExpeditions as Readonly<Record<string, { name: string }>>)[id]
    ?.name ?? humanize(id);
}

export function buildStreakModel(
  state: GameState,
  tuning: Tuning = contentTuning,
): StreakDisplayModel {
  const streak = state.streak;
  const cfg = tuning.retention.streak;
  const tier = effectiveStreakTier(streak, tuning);
  const natural = naturalStreakTier(streak.current, cfg.tierMinStreakDay);
  const bonus = streakLootBonus(streak, tuning);
  const previewDay = Math.max(1, streak.current);
  const reward = resolveLadderReward(previewDay, tuning, ladderContentFor(state));

  return {
    current: streak.current,
    longest: streak.longest,
    tier,
    tierLootBonusLabel: `+${Math.round(bonus * 100)}%`,
    nextTierIn: nextTierInDays(streak.current, cfg.tierMinStreakDay),
    ladderDay: ladderDayFor(previewDay, cfg.ladderLength),
    ladderLength: cfg.ladderLength,
    graceBanked: streak.graceBanked,
    graceMax: cfg.graceMax,
    rainDays: streak.rainDays,
    welcomeBackActive: tier > natural,
    headline: streakHeadline(streak, tuning),
    todaysRewardLabel: formatLadderReward(reward),
    pendingChoices: streak.pendingChoices.map((choice) => ({
      kind: choice.kind,
      forDay: choice.forDay,
      offers: choice.offers.map((id) => ({ id, label: offerLabel(choice.kind, id) })),
    })),
  };
}

/** Small counts SPELLED OUT, never as digits — see `detectRainDayToast`. */
const COUNT_WORDS: readonly string[] = ["no", "one", "two", "three", "four", "five"];

function countWord(n: number): string {
  return COUNT_WORDS[n] ?? String(n);
}

/**
 * The warm, once-per-occurrence "Rain Day" report (bible §3.4: "reported AFTER
 * THE FACT, warmly, once"). Pure diff — the caller (initDailiesUi) fires it
 * exactly once per transition, never on a stale re-render.
 *
 * The bank is described in WORDS and only when there is something in it. The
 * previous copy interpolated the raw number and always mentioned it, so at an
 * empty bank it read "…Nobody minded. 0 rain days left this fortnight." — a
 * digit next to "left", sitting at zero, which is precisely the dwindling-
 * resource readout §3.4 says grace must never be ("not displayable as a
 * dwindling resource"). Note the bible's own example spells it "One rain day
 * left this fortnight" for the same reason. Caught by `ui/retention.copy.test.ts`.
 */
export function detectRainDayToast(prev: GameState, next: GameState): string | null {
  if (next.streak.rainDays <= prev.streak.rainDays) return null;
  const banked = next.streak.graceBanked;
  if (banked <= 0) {
    return "The Keep had a quiet day. Nobody minded — and your rain days refill on their own.";
  }
  return `The Keep had a quiet day. Nobody minded. ${countWord(banked)} rain day${banked === 1 ? "" : "s"} still in the bank.`;
}

/** Fires once when a streak day's ladder reward has just been auto-banked
 * (`rewardedForDay` transitions onto the current streak day) — the "claim
 * feels juicy even with no claim tap" moment for the non-choice rewards. */
export function detectStreakRewardToast(
  prev: GameState,
  next: GameState,
  tuning: Tuning = contentTuning,
): string | null {
  if (next.streak.current === 0) return null;
  if (next.streak.rewardedForDay !== next.streak.current) return null;
  if (prev.streak.rewardedForDay === next.streak.rewardedForDay) return null;
  const reward = resolveLadderReward(next.streak.current, tuning, ladderContentFor(next));
  if (reward.kind !== "grant") return null; // choice rewards get their own picker, not a toast
  return `Day ${next.streak.current}: ${formatLadderReward(reward)}!`;
}

// ---------------------------------------------------------------------------
// BOUNTIES — pure model (bible §5)
// ---------------------------------------------------------------------------

export interface BountyCardModel {
  readonly slot: number;
  readonly title: string;
  readonly progress: number;
  readonly target: number;
  readonly pct: number;
  readonly complete: boolean;
  readonly stale: boolean;
  readonly rewardLabel: string;
  readonly canReroll: boolean;
}

export function buildBountyCards(
  state: GameState,
  tuning: Tuning = contentTuning,
): readonly BountyCardModel[] {
  const canRerollAtAll =
    state.bounties.rerollsUsed < tuning.retention.bounties.freeRerollsPerDay;
  return state.bounties.slots.map((slot) => {
    const template = contentBountyTemplates.find((t) => t.id === slot.templateId);
    const target = Math.max(1, slot.target);
    return {
      slot: slot.slot,
      title: template?.name ?? "A small errand",
      progress: Math.min(slot.progress, target),
      target,
      pct: Math.min(1, slot.progress / target),
      complete: slot.completedAt !== null,
      stale: slot.stale,
      rewardLabel:
        template !== undefined ? formatBountyReward(template.reward) : "a little something",
      canReroll: canRerollAtAll && slot.completedAt === null && !slot.stale,
    };
  });
}

export function bountiesClearedToday(state: GameState): boolean {
  return state.bounties.dayBonusGranted;
}

/** Bounty slots that just completed on this transition (progress reached
 * target for the first time) — drives the juice (confetti/sound/toast),
 * matching the auto-bank contract: nothing was tapped, but the moment
 * still gets celebrated. */
export function detectBountyCelebrations(
  prev: GameState,
  next: GameState,
): readonly BountyCardModel[] {
  if (prev.bounties.day !== next.bounties.day) return []; // a fresh day, not a completion
  const prevCompleted = new Set(
    prev.bounties.slots.filter((s) => s.completedAt !== null).map((s) => s.slot),
  );
  const nextCards = buildBountyCards(next);
  return nextCards.filter(
    (card) => card.complete && !prevCompleted.has(card.slot),
  );
}

// ---------------------------------------------------------------------------
// MILESTONES — pure model (bible §4)
// ---------------------------------------------------------------------------

export type MilestoneRowStatus = "earned" | "claimable" | "locked";

export interface MilestoneRowModel {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  readonly status: MilestoneRowStatus;
  readonly progressCurrent: number;
  readonly progressTarget: number;
  readonly progressPct: number;
  readonly rewardLabel: string;
}

/**
 * Mirrors `core/state.ts`'s private `buildMilestoneContext` using only
 * PUBLIC `GameState`/registry surface (pipdex/sanctuary/counters/streak
 * fields, plus per-pip `mastery` — never a `core/pipdex` or
 * `core/sanctuary` import, respecting this round's peer-scope fence).
 * Long Meadow residents count toward age/mastery metrics same as the
 * active roster (retiring must never cost progress, bible §0.1).
 */
export function buildProgressMetricContext(
  state: GameState,
  tuning: Tuning = contentTuning,
): MilestoneMetricContext {
  const allPips = [
    ...Object.values(state.pips),
    ...Object.values(state.sanctuary.pips).map((record) => record.pip),
  ];
  let oldestPipAgeMs = 0;
  let masteryTierAnyBiome = 0;
  const bestTierPerBiome: Record<string, number> = {};
  for (const pip of allPips) {
    oldestPipAgeMs = Math.max(oldestPipAgeMs, pip.ageMs);
    for (const biomeId of EXPEDITION_IDS) {
      const trips = pip.mastery?.[biomeId] ?? 0;
      const durationMs = contentExpeditions[biomeId]?.durationMs ?? 0;
      const t = masteryTier(trips, durationMs, tuning);
      masteryTierAnyBiome = Math.max(masteryTierAnyBiome, t);
      bestTierPerBiome[biomeId] = Math.max(bestTierPerBiome[biomeId] ?? 0, t);
    }
  }
  const masteryTierAllBiomes =
    EXPEDITION_IDS.length > 0
      ? Math.min(...EXPEDITION_IDS.map((id) => bestTierPerBiome[id] ?? 0))
      : 0;
  return {
    counters: state.counters,
    albumForms: state.pipdex.formsCaught,
    ledgerVariants: state.pipdex.variantsCaught,
    streakLongest: state.streak.longest,
    masteryTierAnyBiome,
    masteryTierAllBiomes,
    oldestPipAgeMs,
    sanctuaryResidents: state.sanctuary.order.length,
  };
}

export function buildMilestoneRows(
  state: GameState,
  tuning: Tuning = contentTuning,
  registry: readonly MilestoneDef[] = contentMilestones,
): readonly MilestoneRowModel[] {
  const ctx = buildProgressMetricContext(state, tuning);
  const rows: MilestoneRowModel[] = [];
  for (const def of registry) {
    const earned = state.milestones.earned[def.id] !== undefined;
    // Hidden + unearned = "revealed only on earning" (bible §4.1) — not a
    // checklist chore, so it simply isn't listed yet.
    if (def.hidden === true && !earned) continue;
    const value = metricValue(def.metric, ctx);
    const met = isMilestoneMet(def, ctx);
    const status: MilestoneRowStatus = earned ? "earned" : met ? "claimable" : "locked";
    const target = Number.isFinite(def.threshold) ? def.threshold : value;
    rows.push({
      id: def.id,
      name: def.name,
      blurb: def.blurb,
      status,
      progressCurrent: Math.min(value, target),
      progressTarget: target,
      progressPct: target > 0 ? Math.min(1, value / target) : 0,
      rewardLabel: formatMilestoneReward(def.reward),
    });
  }
  return rows;
}

/** Ids that just became claimable on this transition (crossed the
 * threshold) — used to fire a "new!" toast pointing at the sheet. */
export function detectMilestoneCelebrations(
  prev: GameState,
  next: GameState,
  tuning: Tuning = contentTuning,
): readonly MilestoneRowModel[] {
  const prevClaimable = new Set(
    buildMilestoneRows(prev, tuning)
      .filter((r) => r.status === "claimable")
      .map((r) => r.id),
  );
  return buildMilestoneRows(next, tuning).filter(
    (r) => r.status === "claimable" && !prevClaimable.has(r.id),
  );
}

/**
 * The entry button's badge count: ONLY choices genuinely waiting on the
 * player's taste — the day-5 keepsake pick, the day-7/bounty-day egg pick.
 *
 * Milestones deliberately do NOT contribute (round-2C review): they auto-bank
 * (see `initDailiesUi`), so counting them turned the Nook badge into a chore
 * counter — a new player cleared ~7 first-hour milestones and was met by a
 * standing "7" and seven Claim taps. `navMenu.ts` states that a count "is only
 * ever a *positive* thing to look at… never a chore count", and bible §0.2 is
 * explicit: "rewards that need no choice auto-bank the instant they're earned,
 * so there is nothing to forget". A choice, by definition, is not a chore —
 * nobody else can make it, and it waits forever.
 */
export function dailyBadgeCount(state: GameState, _tuning: Tuning = contentTuning): number {
  return state.streak.pendingChoices.length;
}

/**
 * Milestones that are earned but not yet banked — the ids `initDailiesUi`
 * auto-claims. Exported so the auto-bank is unit-testable without a DOM.
 * (`CLAIM_MILESTONE` is idempotent in core, so dispatching a stale id is a
 * no-op by reference; this exists to keep the dispatch loop tiny and honest.)
 */
export function unbankedMilestoneIds(
  state: GameState,
  tuning: Tuning = contentTuning,
): readonly string[] {
  return buildMilestoneRows(state, tuning)
    .filter((r) => r.status === "claimable")
    .map((r) => r.id);
}

// ---------------------------------------------------------------------------
// DOM — the browsable sheet + its floating entry button
// ---------------------------------------------------------------------------

export type DailiesTab = "streak" | "bounties" | "milestones";

export interface DailiesSheetDeps {
  dispatch(action: GameAction): void;
  getState(): GameState;
  clock: Clock;
}

export interface DailiesSheet {
  readonly el: HTMLElement;
  open(tab?: DailiesTab): void;
  close(): void;
  isOpen(): boolean;
  sync(state: GameState): void;
}

function progressBar(pct: number): HTMLElement {
  const track = document.createElement("div");
  track.className = "pk-daily-track";
  const fill = document.createElement("div");
  fill.className = "pk-daily-fill";
  fill.style.width = `${Math.round(Math.min(1, Math.max(0, pct)) * 100)}%`;
  track.appendChild(fill);
  return track;
}

export function createDailiesSheet(deps: DailiesSheetDeps): DailiesSheet {
  const el = document.createElement("div");
  el.className = "pk-daily-wrap";

  const backdrop = document.createElement("div");
  backdrop.className = "pk-daily-backdrop";

  const sheet = document.createElement("div");
  sheet.className = "pk-daily-sheet";

  const handle = document.createElement("div");
  handle.className = "pk-daily-handle";

  const tabs = document.createElement("div");
  tabs.className = "pk-daily-tabs";
  const tabButtons = new Map<DailiesTab, HTMLButtonElement>();
  const makeTab = (id: DailiesTab, label: string): void => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pk-daily-tab";
    b.textContent = label;
    b.addEventListener("click", () => {
      sound("ui.tap");
      setTab(id);
    });
    tabButtons.set(id, b);
    tabs.appendChild(b);
  };
  makeTab("streak", "Streak");
  makeTab("bounties", "Today");
  makeTab("milestones", "Milestones");

  const body = document.createElement("div");
  body.className = "pk-daily-body";

  sheet.append(handle, tabs, body);
  el.append(backdrop, sheet);

  let isOpen = false;
  let activeTab: DailiesTab = "bounties";
  let lastState: GameState | null = null;

  const close = (): void => {
    isOpen = false;
    el.classList.remove("pk-daily-wrap--open");
  };
  backdrop.addEventListener("click", close);

  function setTab(tab: DailiesTab): void {
    activeTab = tab;
    for (const [id, btn] of tabButtons) {
      btn.classList.toggle("pk-daily-tab--active", id === tab);
    }
    if (lastState !== null) renderBody(lastState);
  }

  function renderStreak(state: GameState): void {
    const model = buildStreakModel(state);
    const wrap = document.createElement("div");
    wrap.className = "pk-daily-section";

    const headline = document.createElement("div");
    headline.className = "pk-daily-headline";
    headline.textContent = model.headline;
    wrap.appendChild(headline);

    const stats = document.createElement("div");
    stats.className = "pk-daily-streak-stats";
    const stat = (label: string, value: string): void => {
      const s = document.createElement("div");
      s.className = "pk-daily-stat";
      const v = document.createElement("div");
      v.className = "pk-daily-stat-value";
      v.textContent = value;
      const l = document.createElement("div");
      l.className = "pk-daily-stat-label";
      l.textContent = label;
      s.append(v, l);
      stats.appendChild(s);
    };
    stat("current streak", `${model.current} day${model.current === 1 ? "" : "s"}`);
    stat("longest", `${model.longest} day${model.longest === 1 ? "" : "s"}`);
    stat("loot bonus", model.tierLootBonusLabel);
    wrap.appendChild(stats);

    if (model.welcomeBackActive) {
      const note = document.createElement("div");
      note.className = "pk-daily-note";
      note.textContent = "Your tier is still riding on a streak from before — nothing was lost.";
      wrap.appendChild(note);
    }

    // GRACE, phrased so it is never a dwindling resource with a false promise
    // attached (bible §3.4). The old copy read "0/2 rain days banked — a
    // missed day or two never breaks the streak", which at 0 was simply
    // untrue: the next missed day DID reset `current`. An n/2 readout sitting
    // at 0 beside a reassurance is exactly the mild anxiety surface that
    // clause exists to prevent, so the phrasing is now conditional and the
    // count is only ever mentioned when there is something to mention.
    const grace = document.createElement("div");
    grace.className = "pk-daily-note";
    grace.textContent =
      model.graceBanked > 0
        ? `${countWord(model.graceBanked).replace(/^./, (c) => c.toUpperCase())} rain day${model.graceBanked === 1 ? "" : "s"} in the bank — a missed day or two won't break the streak.`
        : "Your rain days come back on their own in a few days. A break only ever costs the bonus — never a page, an item or a Pip.";
    wrap.appendChild(grace);

    if (model.nextTierIn !== null) {
      const next = document.createElement("div");
      next.className = "pk-daily-note";
      next.textContent = `${model.nextTierIn} more day${model.nextTierIn === 1 ? "" : "s"} to the next tier.`;
      wrap.appendChild(next);
    }

    const ladder = document.createElement("div");
    ladder.className = "pk-daily-reward-line";
    ladder.textContent = `Day ${model.ladderDay} of ${model.ladderLength}: ${model.todaysRewardLabel}`;
    wrap.appendChild(ladder);

    for (const choice of model.pendingChoices) {
      const card = document.createElement("div");
      card.className = "pk-daily-choice";
      const title = document.createElement("div");
      title.className = "pk-daily-choice-title";
      title.textContent =
        choice.kind === "keepsake" ? "Pick your Keepsake" : "Pick your egg";
      card.appendChild(title);
      const offers = document.createElement("div");
      offers.className = "pk-daily-choice-offers";
      choice.offers.forEach((offer, index) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "pk-daily-choice-btn";
        b.textContent = offer.label;
        b.addEventListener("click", () => {
          sound("ui.confirm");
          burstConfetti();
          deps.dispatch({
            type: "RESOLVE_STREAK_CHOICE",
            kind: choice.kind,
            forDay: choice.forDay,
            choiceIndex: index,
            at: deps.clock.now(),
          });
        });
        offers.appendChild(b);
      });
      card.appendChild(offers);
      wrap.appendChild(card);
    }

    body.appendChild(wrap);
  }

  function renderBounties(state: GameState): void {
    const cards = buildBountyCards(state);
    const wrap = document.createElement("div");
    wrap.className = "pk-daily-section";

    const title = document.createElement("div");
    title.className = "pk-daily-headline";
    title.textContent = "Today's round";
    wrap.appendChild(title);

    if (bountiesClearedToday(state)) {
      const cleared = document.createElement("div");
      cleared.className = "pk-daily-note";
      cleared.textContent = "Whole round cleared — an egg is waiting on you to choose its biome.";
      wrap.appendChild(cleared);
    }

    if (cards.length === 0) {
      const empty = document.createElement("div");
      empty.className = "pk-daily-note";
      empty.textContent = "Today's round is still being written — check back after your first tap.";
      wrap.appendChild(empty);
    }

    for (const card of cards) {
      const row = document.createElement("div");
      row.className = `pk-daily-bounty${card.complete ? " pk-daily-bounty--done" : ""}${card.stale ? " pk-daily-bounty--stale" : ""}`;

      const top = document.createElement("div");
      top.className = "pk-daily-bounty-top";
      const name = document.createElement("span");
      name.className = "pk-daily-bounty-name";
      name.textContent = card.title;
      const check = document.createElement("span");
      check.className = "pk-daily-bounty-check";
      check.textContent = card.complete ? "✓" : `${card.progress}/${card.target}`;
      top.append(name, check);
      row.appendChild(top);

      row.appendChild(progressBar(card.pct));

      const reward = document.createElement("div");
      reward.className = "pk-daily-bounty-reward";
      reward.textContent = card.complete ? `Banked: ${card.rewardLabel}` : card.rewardLabel;
      row.appendChild(reward);

      if (card.canReroll) {
        const reroll = document.createElement("button");
        reroll.type = "button";
        reroll.className = "pk-daily-reroll";
        reroll.textContent = "Try a different one";
        reroll.addEventListener("click", () => {
          sound("ui.tap");
          deps.dispatch({ type: "REROLL_BOUNTY", slot: card.slot, at: deps.clock.now() });
        });
        row.appendChild(reroll);
      }

      wrap.appendChild(row);
    }

    body.appendChild(wrap);
  }

  function renderMilestones(state: GameState): void {
    const rows = buildMilestoneRows(state);
    const wrap = document.createElement("div");
    wrap.className = "pk-daily-section";

    const title = document.createElement("div");
    title.className = "pk-daily-headline";
    title.textContent = "Milestones";
    wrap.appendChild(title);

    for (const row of rows) {
      const card = document.createElement("div");
      card.className = `pk-daily-milestone pk-daily-milestone--${row.status}`;

      const top = document.createElement("div");
      top.className = "pk-daily-bounty-top";
      const name = document.createElement("span");
      name.className = "pk-daily-bounty-name";
      name.textContent = row.name;
      top.appendChild(name);
      if (row.status === "earned") {
        const check = document.createElement("span");
        check.className = "pk-daily-bounty-check";
        check.textContent = "✓";
        top.appendChild(check);
      }
      card.appendChild(top);

      const blurb = document.createElement("div");
      blurb.className = "pk-daily-note";
      blurb.textContent = row.blurb;
      card.appendChild(blurb);

      if (row.status !== "earned") {
        card.appendChild(progressBar(row.progressPct));
      }

      const reward = document.createElement("div");
      reward.className = "pk-daily-bounty-reward";
      // No Claim button, by design (bible §0.2): milestone rewards need no
      // choice, so they auto-bank the instant they're earned, exactly like
      // bounty rewards and non-choice streak rewards. The moment is still
      // celebrated — `initDailiesUi` fires the confetti, the sound and the
      // toast — because a payoff does not require a claim verb.
      reward.textContent =
        row.status === "earned" ? `Banked: ${row.rewardLabel}` : row.rewardLabel;
      card.appendChild(reward);

      wrap.appendChild(card);
    }

    body.appendChild(wrap);
  }

  function renderBody(state: GameState): void {
    body.replaceChildren();
    if (activeTab === "streak") renderStreak(state);
    else if (activeTab === "bounties") renderBounties(state);
    else renderMilestones(state);
  }

  return {
    el,
    open(tab?: DailiesTab): void {
      if (tab !== undefined) setTab(tab);
      isOpen = true;
      sound("ui.sheet");
      if (lastState !== null) renderBody(lastState);
      el.classList.add("pk-daily-wrap--open");
    },
    close,
    isOpen: () => isOpen,
    sync(state: GameState): void {
      lastState = state;
      if (!isOpen) return;
      renderBody(state);
    },
  };
}

export interface DailiesEntryDeps {
  readonly mount: HTMLElement;
  onOpen(): void;
}

export interface DailiesEntry {
  readonly el: HTMLButtonElement;
  sync(state: GameState): void;
  dispose(): void;
}

/** The floating entry point (soundToggle.ts's exact pattern): a small
 * round button, its own class prefix, mounted into `#ui` (falling back to
 * whatever mount it is handed), editing no other ui/ module. */
export function mountDailiesEntry(deps: DailiesEntryDeps): DailiesEntry {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "pk-daily-entry";
  el.setAttribute("aria-label", "Today's streak, bounties and milestones");
  el.title = "Today's round";
  const icon = document.createElement("span");
  icon.className = "pk-daily-entry-icon";
  icon.textContent = "☀";
  icon.setAttribute("aria-hidden", "true");
  const badge = document.createElement("span");
  badge.className = "pk-daily-entry-badge";
  badge.setAttribute("aria-hidden", "true");
  el.append(icon, badge);

  const onClick = (): void => {
    sound("ui.tap");
    deps.onOpen();
  };
  el.addEventListener("click", onClick);

  const root = document.getElementById("ui") ?? deps.mount;
  root.appendChild(el);

  return {
    el,
    sync(state: GameState): void {
      const count = dailyBadgeCount(state);
      badge.textContent = count > 0 ? String(count) : "";
      badge.classList.toggle("pk-daily-entry-badge--on", count > 0);
    },
    dispose(): void {
      el.removeEventListener("click", onClick);
      el.remove();
    },
  };
}

export interface DailiesUiDeps {
  readonly mount: HTMLElement;
  readonly store: Store<GameState, GameAction>;
  readonly clock: Clock;
  /**
   * Mount the floating "☀" entry button? Default TRUE (this module's
   * original standalone behaviour, which its tests cover).
   *
   * The integrate stage passes FALSE: round 2C shipped three browsable
   * screens, and one floating button each does not fit a 375px thumb zone
   * — `.pk-daily-entry` (`left: 12px; bottom + 178px`) landed geometrically
   * on top of the Phase 5 Keep bar's upper button at a LOWER z-index,
   * which is an unreachable Build button. `ui/navMenu.ts` now owns that
   * slot and routes "Today" here via the returned `open()`, so the sheet
   * and all of the session-lifecycle wiring below stay exactly as they
   * are — only the redundant button goes away.
   */
  readonly mountEntry?: boolean;
}

export interface DailiesUi {
  open(tab?: DailiesTab): void;
  /** Close the sheet — the integrate stage's mutual-exclusion seam (main.ts
   * closes every other surface before opening a destination). */
  close(): void;
  /** Claimable-count badge source for whoever draws the entry point (the
   * Nook menu, when this module isn't drawing its own button). */
  badgeCount(state: GameState): number;
  dispose(): void;
}

/**
 * Wires the sheet + entry button to a live Store/Clock, and owns the
 * session-lifecycle dispatches flagged by the progression agent's report
 * as "for the integrate/UI stage": `SET_DAY_OFFSET`/`SET_ACTIVE_EVENTS`
 * keep the streak/bounty day boundary and seasonal events fresh;
 * `REFRESH_BOUNTIES`/`CLAIM_STREAK_REWARD` are idempotent for an already-
 * current day, so redispatching them at every boot and every foreground
 * return is always safe (bible §3.6/§5.1 — a stale value can only ever
 * grant, never take away).
 */
export function initDailiesUi(deps: DailiesUiDeps): DailiesUi {
  const { store, clock } = deps;

  const sheet = createDailiesSheet({
    dispatch: (a) => store.dispatch(a),
    getState: () => store.getState(),
    clock,
  });
  const entry =
    deps.mountEntry === false
      ? null
      : mountDailiesEntry({ mount: deps.mount, onOpen: () => sheet.open() });
  deps.mount.appendChild(sheet.el);

  const refreshSessionState = (): void => {
    const now = clock.now();
    store.dispatch({
      type: "SET_DAY_OFFSET",
      offsetMs: localDayOffsetMs(contentTuning.retention.dayStartHour, now),
    });
    store.dispatch({
      type: "SET_ACTIVE_EVENTS",
      ids: resolveActiveEvents(monthDayFromMs(now)),
    });
    store.dispatch({ type: "REFRESH_BOUNTIES", at: now });
    store.dispatch({ type: "CLAIM_STREAK_REWARD", at: now });
    bankEarnedMilestones();
  };

  /**
   * AUTO-BANK every earned milestone (bible §0.2: "rewards that need no choice
   * auto-bank the instant they're earned, so there is nothing to forget").
   *
   * Milestone rewards are resources, items, a keepsake decoration or flair —
   * none of them a choice — so gating them behind a Claim tap made them the
   * one nagging surface in the round: a standing numeric badge on the Nook
   * button and seven taps in a new player's first hour. Same mechanism the
   * streak ladder already uses here (`CLAIM_MILESTONE` is idempotent in core,
   * so this is safe at every boot, every foreground, and after every action).
   */
  function bankEarnedMilestones(): void {
    for (const id of unbankedMilestoneIds(store.getState())) {
      store.dispatch({ type: "CLAIM_MILESTONE", id, at: clock.now() });
    }
  }

  refreshSessionState();

  const onVisibility = (): void => {
    if (document.visibilityState === "visible") refreshSessionState();
  };
  document.addEventListener("visibilitychange", onVisibility);

  let prev = store.getState();
  const unsubscribe = store.subscribe((state) => {
    const before = prev;
    prev = state;
    sheet.sync(state);
    entry?.sync(state);

    // THE DAY JUST TURNED, mid-session. `refreshSessionState` only runs at
    // boot and on foreground, but the streak advances on the player's first
    // action of a new day — so without this, day 7's ladder reward sat
    // unbanked (and today's bounty trio unrefreshed) until the player
    // happened to background and foreground the app. Bible §3.5 is explicit
    // that non-choice rewards auto-bank "the instant the day advances", and
    // §10.3 wants the new day's round up with one gentle toast, not a chore.
    // Both dispatches are idempotent and neither moves `streak.current`, so
    // this cannot loop.
    if (state.streak.lastVisitDay !== before.streak.lastVisitDay) {
      const now = clock.now();
      store.dispatch({ type: "REFRESH_BOUNTIES", at: now });
      store.dispatch({ type: "CLAIM_STREAK_REWARD", at: now });
    }

    const rainToast = detectRainDayToast(before, state);
    if (rainToast !== null) notify({ kind: "info", message: rainToast });

    const streakToast = detectStreakRewardToast(before, state);
    if (streakToast !== null) {
      sound("ui.confirm");
      notify({ kind: "info", message: streakToast });
    }

    for (const card of detectBountyCelebrations(before, state)) {
      sound("reveal.collect");
      burstConfetti();
      notify({ kind: "info", message: `Bounty done: ${card.title}! +${card.rewardLabel}` });
    }

    // Milestones: CELEBRATE, then bank. Nothing is ever waiting on a tap
    // (bible §0.2/§10.2 — "milestone celebrations as TOASTS, one at a time,
    // tap-to-open for detail… never a modal chain"), so the toast reports
    // what was banked rather than asking for a chore.
    const newMilestones = detectMilestoneCelebrations(before, state);
    if (newMilestones.length > 0) {
      sound("ui.confirm");
      burstConfetti();
      const first = newMilestones[0];
      const message =
        newMilestones.length === 1 && first !== undefined
          ? `${first.name} — ${first.rewardLabel}. Have a look.`
          : `${newMilestones.length} new milestones — have a look.`;
      // Tap-to-open: click the entry button when this module drew one,
      // otherwise open the sheet directly (the Nook menu owns the button).
      notify({
        kind: "info",
        message,
        onTap: () => {
          if (entry !== null) entry.el.click();
          else sheet.open("milestones");
        },
      });
      bankEarnedMilestones();
    }
  });

  sheet.sync(store.getState());
  entry?.sync(store.getState());

  return {
    open(tab?: DailiesTab): void {
      sheet.open(tab);
    },
    close(): void {
      sheet.close();
    },
    badgeCount(state: GameState): number {
      return dailyBadgeCount(state);
    },
    dispose(): void {
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
      entry?.dispose();
      sheet.el.remove();
    },
  };
}
