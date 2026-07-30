/**
 * THE DAILY STREAK (docs/retention-bible.md §3) — round 2C, progression half.
 *
 * The hard guardrail this module exists to satisfy (orchestrator ruling,
 * spec §4.4): REWARD SHOWING UP, NEVER PUNISH ABSENCE. A broken streak may
 * cost a BONUS (the loot-bonus tier) and NOTHING else — never an item,
 * never progress, never a Pip. `current` is the only field a break can
 * reduce; `longest`/`totalVisitDays`/`rainDays` are forward-only.
 *
 * Day boundary (bible §3.1): `dayIndex(at) = floor((at - dayOffsetMs) /
 * dayMs)`, where `dayOffsetMs` combines the player's timezone offset with
 * `retention.dayStartHour` (04:00 local). This module never touches `Date`
 * — `dayOffsetMs` is injected (computed by the app layer, the only place
 * allowed to ask "what timezone is this", spec §2 rule 2) and every
 * function here is pure integer arithmetic over `at`/`dayOffsetMs`/`dayMs`.
 * A boundary shift from DST or travel can only ever gift a day (the
 * `delta <= 0` no-op below) or be absorbed by grace — never take one.
 *
 * What counts as a "visit" (bible §3.2): any real player action — the
 * caller decides which actions call `touchVisit`, never `TICK`/`CATCHUP`.
 * `core/state.ts` enumerates the exact whitelist; `streak.test.ts` checks
 * that list against `GameAction`'s union.
 *
 * The ladder (bible §3.3): content repeats every `ladderLength` days; what
 * escalates with a longer streak is the TIER (`effectiveStreakTier`), a
 * multiplicative loot-bonus channel (see `core/progression/multipliers.ts`)
 * — never the ladder rewards themselves, which are exactly as attainable on
 * day 1 as on day 91. `resolveLadderReward` is level-aware (bible's
 * anti-Stew-before-level-2 rule, and the level-1 wood ceiling — see
 * content/tuning.ts `retention.grants.preLevel2WoodCap`).
 *
 * Grace (bible §3.4): a bank, not a purchasable freeze — it cannot become a
 * monetisation surface because it is never displayed as a dwindling
 * resource with a price tag, is never extendable, and refills on its own.
 *
 * Keepsake offers (bible §3.3 day 5, §11.4): drawn STATELESSLY from
 * `(seed, forDay)` — a throwaway RNG stream never persisted in
 * `GameState`, exactly like bounty generation — so `rngState` never grows
 * and no other stream's cursor is ever perturbed.
 *
 * Welcome back (bible §3.4): a streak that once reached `longest ≥
 * welcomeBackLongestRequired` restarts (after a grace-exceeding gap) with
 * its EFFECTIVE tier floored at `welcomeBackTierFloor`, even though
 * `current` itself restarts at 1 — implemented as a floor on the DERIVED
 * tier (`effectiveStreakTier`), never as a boost to `current`, so the
 * "break costs only a bonus" invariant needs no special case here.
 */

import { createRng } from "../rng";

export interface StreakTuning {
  readonly retention: {
    readonly dayStartHour: number;
    readonly dayMs: number;
    readonly streak: {
      readonly ladderLength: number;
      readonly graceMax: number;
      readonly graceRefreshDays: number;
      readonly tierMinStreakDay: readonly number[];
      readonly tierLootBonus: readonly number[];
      readonly welcomeBackLongestRequired: number;
      readonly welcomeBackTierFloor: number;
    };
  };
}

/**
 * `bountyEgg` reuses this same shape for the daily-bounty day-clear bonus
 * (docs/retention-bible.md §5.6: "clearing all three grants one egg from
 * any unlocked biome pool, player's choice") — a second, independent
 * source of the same kind of waiting choice, parked in the same queue so
 * `core/state.ts` only needs ONE resolve action for every "pick a biome
 * for a bonus egg" moment in the game. Its `forDay` is the BOUNTY day
 * (`state.bounties.day`), a different numbering space from the streak's
 * `current` — the `kind` tag is what keeps the two families distinct, not
 * the number.
 */
export type StreakChoiceKind = "keepsake" | "basketEgg" | "bountyEgg";

/** A choice reward the player has EARNED but not yet resolved. WAITS
 * FOREVER (bible §0.2) — nothing here expires; `RESOLVE_STREAK_CHOICE`
 * (core/state.ts) is the only thing that consumes one. */
export interface StreakChoice {
  readonly kind: StreakChoiceKind;
  /** Content ids to choose from (decoration ids, or expedition ids). */
  readonly offers: readonly string[];
  /** The ladder-cycle streak day (`current`) this choice was earned on —
   * the idempotence key, mirroring `rewardedForDay`. For `bountyEgg` this
   * is the BOUNTY day instead (see the field's module-doc note above). */
  readonly forDay: number;
}

export interface StreakState {
  readonly current: number;
  readonly longest: number;
  readonly lastVisitDay: number | null;
  readonly totalVisitDays: number;
  readonly graceBanked: number;
  readonly graceRefilledOnDay: number | null;
  /** Rain days spent, for the warm after-the-fact report. Forward-only. */
  readonly rainDays: number;
  /** The streak-day (`current`) whose ladder reward has already been
   * banked — the double-grant guard (claiming/advancing twice must not
   * double-pay). */
  readonly rewardedForDay: number | null;
  readonly pendingChoices: readonly StreakChoice[];
}

/** A fresh streak: full grace from day one (bible §3.4 "full at 2 from the
 * very first day"), nothing visited yet. */
export function createEmptyStreak(tuning: StreakTuning): StreakState {
  return {
    current: 0,
    longest: 0,
    lastVisitDay: null,
    totalVisitDays: 0,
    graceBanked: tuning.retention.streak.graceMax,
    graceRefilledOnDay: null,
    rainDays: 0,
    rewardedForDay: null,
    pendingChoices: [],
  };
}

/** The day index a timestamp falls on (bible §3.1). Pure integer division —
 * no Date, no timezone library. `dayOffsetMs` already encodes both the
 * player's UTC offset and `dayStartHour`; see `core/clock.ts`'s
 * `localDayOffsetMs` for how the app layer derives it. */
export function dayIndex(at: number, dayOffsetMs: number, dayMs: number): number {
  return Math.floor((at - dayOffsetMs) / dayMs);
}

/** The natural ladder tier (0-indexed) for a streak length, per
 * `tierMinStreakDay` (descending scan — the highest threshold the streak
 * has reached). Does NOT apply the welcome-back floor; see
 * `effectiveStreakTier` for the one the game actually pays out. */
export function naturalStreakTier(
  currentDays: number,
  tierMinStreakDay: readonly number[],
): number {
  let tier = 0;
  for (let i = 0; i < tierMinStreakDay.length; i++) {
    if (currentDays >= (tierMinStreakDay[i] as number)) tier = i;
  }
  return tier;
}

/**
 * The tier the loot-bonus channel actually reads (bible §3.4 welcome
 * back): the natural tier from `current`, floored at
 * `welcomeBackTierFloor` whenever `longest` has ever reached
 * `welcomeBackLongestRequired`. Implemented as a floor on the DERIVED
 * value rather than a boost to `current` itself, so a veteran who restarts
 * is "strictly better off than a brand-new player" without `current` ever
 * lying about how many consecutive days were actually visited.
 */
export function effectiveStreakTier(streak: StreakState, tuning: StreakTuning): number {
  const cfg = tuning.retention.streak;
  const natural = naturalStreakTier(streak.current, cfg.tierMinStreakDay);
  const floor =
    streak.longest >= cfg.welcomeBackLongestRequired ? cfg.welcomeBackTierFloor : 0;
  return Math.max(natural, floor);
}

/** The additive loot-bonus chance this streak currently contributes (feeds
 * `core/progression/multipliers.ts`'s summed, capped channel). */
export function streakLootBonus(streak: StreakState, tuning: StreakTuning): number {
  const tier = effectiveStreakTier(streak, tuning);
  return tuning.retention.streak.tierLootBonus[tier] ?? 0;
}

/**
 * Advance the streak for a visit at `at` (bible §3.4's advance rule, in
 * full). Pure; a same-day revisit or a clock rollback (`delta <= 0`) is a
 * no-op — returns `streak` BY REFERENCE so callers can skip downstream
 * work cheaply. Grace refills passively (elapsed-time based, independent
 * of visits) before the gap is evaluated, so a long-overdue refill is
 * available to spend on the very gap that needed it.
 */
export function touchVisit(
  streak: StreakState,
  at: number,
  dayOffsetMs: number,
  tuning: StreakTuning,
): StreakState {
  const cfg = tuning.retention.streak;
  const dayMs = tuning.retention.dayMs;
  const today = dayIndex(at, dayOffsetMs, dayMs);

  if (streak.lastVisitDay !== null && today <= streak.lastVisitDay) {
    return streak; // already counted today, or the clock rolled back
  }

  // Passive grace refill: `graceRefreshDays` per +1, capped at `graceMax`.
  let graceBanked = streak.graceBanked;
  let graceRefilledOnDay = streak.graceRefilledOnDay ?? today;
  if (streak.lastVisitDay === null) {
    graceRefilledOnDay = today;
  } else {
    while (
      graceBanked < cfg.graceMax &&
      today - graceRefilledOnDay >= cfg.graceRefreshDays
    ) {
      graceBanked += 1;
      graceRefilledOnDay += cfg.graceRefreshDays;
    }
    if (graceBanked >= cfg.graceMax) graceRefilledOnDay = today;
  }

  let current: number;
  let rainDays = streak.rainDays;
  if (streak.lastVisitDay === null) {
    current = 1;
  } else {
    const delta = today - streak.lastVisitDay;
    if (delta === 1) {
      current = streak.current + 1;
    } else {
      const gap = delta - 1;
      if (gap <= cfg.graceMax && graceBanked >= gap) {
        // The streak SURVIVES: grace absorbs the gap (a "Rain Day").
        graceBanked -= gap;
        current = streak.current + 1;
        rainDays += gap;
      } else {
        // Restart at the welcome-back floor (a bonus-tier concept, see
        // effectiveStreakTier — `current` itself always restarts honestly
        // at 1, never inflated).
        current = 1;
      }
    }
  }

  return {
    ...streak,
    current,
    longest: Math.max(streak.longest, current),
    lastVisitDay: today,
    totalVisitDays: streak.totalVisitDays + 1,
    graceBanked,
    graceRefilledOnDay,
    rainDays,
  };
}

/** The 1-indexed ladder-cycle day for a streak length (bible §3.3: content
 * repeats every `ladderLength` days). */
export function ladderDayFor(currentDays: number, ladderLength: number): number {
  if (currentDays <= 0) return 1;
  return ((currentDays - 1) % ladderLength) + 1;
}

/** A plain resource/item grant — auto-banked, no claim step (bible §3.5:
 * "non-choice rewards auto-bank the instant they're earned"). */
export interface LadderGrantReward {
  readonly kind: "grant";
  readonly resources?: Readonly<Record<string, number>>;
  readonly items?: Readonly<Record<string, number>>;
}

/** A reward that waits for the player's tap (bible §3.3 day 5/7) — parked
 * in `StreakState.pendingChoices` until `RESOLVE_STREAK_CHOICE`. */
export interface LadderChoiceReward {
  readonly kind: "keepsakeChoice" | "eggChoice";
  readonly offers: readonly string[];
}

export type LadderReward = LadderGrantReward | LadderChoiceReward;

/** Content the ladder needs to stay level-aware (bible §3.3/§12.3): Stew
 * only once level 2 visibly makes feeding easier; wood stays under the
 * `preLevel2WoodCap` before level 2; the day-5/7 choices need real,
 * currently-relevant offers. */
export interface LadderContent {
  readonly keepLevel: number;
  /** Decoration ids to offer on day 5 (bible: "chosen from 3 offered") —
   * already narrowed/shuffled by the caller (see `pickKeepsakeOffers`). */
  readonly keepsakeOffers: readonly string[];
  /** Expedition ids unlocked at the current Keep level, for day 7's "any
   * unlocked biome pool, player's choice". */
  readonly unlockedExpeditionIds: readonly string[];
}

/**
 * Resolve the ladder-cycle reward for a just-reached streak length. Pure
 * and level-aware — day 3 only offers Stew from Keep level 2 on (the
 * shipped "level 2 visibly makes feeding easier" promise, bible §12.4),
 * and the only pre-level-2 Wood in the whole ladder is day 4's single
 * Wood (within `retention.grants.preLevel2WoodCap`, guarded by
 * `bounties`/`streak` isolation tests — see `retention.isolation.test.ts`).
 */
export function resolveLadderReward(
  currentDays: number,
  tuning: StreakTuning,
  content: LadderContent,
): LadderReward {
  const ladderDay = ladderDayFor(currentDays, tuning.retention.streak.ladderLength);
  switch (ladderDay) {
    case 1:
      return { kind: "grant", items: { berry: 2 } };
    case 2:
      return { kind: "grant", resources: { fiber: 3 } };
    case 3:
      return content.keepLevel >= 2
        ? { kind: "grant", items: { stew: 1 } }
        : { kind: "grant", items: { toastnut: 1, berry: 2 } };
    case 4:
      return content.keepLevel >= 2
        ? { kind: "grant", resources: { fiber: 2, wood: 2 } }
        : { kind: "grant", resources: { fiber: 2, wood: 1 } };
    case 5:
      return { kind: "keepsakeChoice", offers: content.keepsakeOffers };
    case 6:
      return { kind: "grant", items: { berry: 3 }, resources: { fiber: 2 } };
    default:
      return { kind: "eggChoice", offers: content.unlockedExpeditionIds };
  }
}

/**
 * Draw `count` distinct decoration ids to offer as day 5's keepsake choice
 * (bible: "chosen from 3 offered — a cosmetic you didn't want is worse
 * than nothing"). Stateless and day-derived: the SAME `(seed, forDay)`
 * always offers the same three, but nothing here is persisted in
 * `GameState` (see the module doc's "Keepsake offers" note).
 */
export function pickKeepsakeOffers(
  seed: number,
  forDay: number,
  decorationIds: readonly string[],
  count = 3,
): readonly string[] {
  if (decorationIds.length <= count) return decorationIds;
  const stream = createRng(seed).stream(`keepsake:${forDay}`);
  const pool = [...decorationIds];
  const offers: string[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    offers.push(pool.splice(stream.int(pool.length), 1)[0] as string);
  }
  return offers;
}
