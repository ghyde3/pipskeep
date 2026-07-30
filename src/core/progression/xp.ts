/**
 * KEEP XP — THE PROGRESSION SPINE (docs/progression-bible.md §0/§1).
 *
 * ONE spine, belonging to the Keep, never to a Pip (bible §0.1): every
 * meaningful action — care, expeditions, hatching, building, jobs,
 * bounties, milestones, evolutions, the Album, the Long Meadow — feeds
 * the SAME forward-only counter, `GameState.keepXp`. No session is
 * wasted, retiring a Pip costs nothing, and the number always has
 * somewhere to go (the 12-tier ladder, `tuning.progression.levelXp`).
 *
 * This module is the pure "how much" calculator — one small function per
 * award-table row (bible §1.3), each taking only the numbers it needs, so
 * every one is unit-testable without a GameState. The "WHEN does an
 * action qualify, and how do we never grant it twice" composition lives
 * in `core/state.ts`'s `applyKeepXpForAction` (the single call site,
 * mirroring 2C's `touchProgressionVisit` wrapper) — exactly like every
 * other 2C progression module (`mastery.ts`, `streak.ts`) stays a pure
 * calculator while `core/state.ts` does the composing, so this file never
 * imports `GameState`/`GameAction` and cannot cycle back to it.
 *
 * Purity: no clock, no Math.random, content enters only as the injected
 * `KeepXpTuning` slice (defaults to the real `content/tuning.ts`, spec §2
 * rule 5's established core/ pattern — every sibling module in this
 * directory does the same).
 */

import { MINUTE_MS, tuning as contentTuning } from "../../content/tuning";

/** The slice of `tuning.progression` this module reads (injectable for
 * tests — the same structural-slice pattern `core/keep`'s `KeepTuning`
 * and `core/progression/mastery.ts`'s `MasteryTuning` already use). */
export interface KeepXpTuning {
  readonly progression: {
    readonly levelXp: readonly number[];
    readonly renown: {
      readonly xpPerLevel: number;
      readonly flairEveryLevels: number;
    };
    readonly xp: {
      readonly care: number;
      readonly expeditionSend: number;
      readonly revealBase: number;
      readonly revealPer5Min: number;
      readonly hatch: number;
      readonly evolve: number;
      readonly firstBuild: number;
      readonly firstJob: number;
      readonly jobTick: number;
      readonly bountyComplete: number;
      readonly bountyDayClear: number;
      readonly streakDayBase: number;
      readonly streakDayPerTier: number;
      readonly rosterUpgrade: number;
      readonly masteryTierPerTier: number;
      readonly albumSeen: number;
      readonly albumCaught: number;
      readonly albumVariant: number;
      readonly sanctuaryFirstArrival: number;
    };
  };
}

const FIVE_MIN_MS = 5 * MINUTE_MS;

/** One care action applied (FEED/CLEAN/PLAY/PET/GIVE_ITEM, or a
 * REST_TOGGLE that actually started a nap — bible §1.3 rows 3–8). The
 * single atom the whole table is sized against. */
export function careActionXp(tuning: KeepXpTuning = contentTuning): number {
  return tuning.progression.xp.care;
}

/** ASSIGN_EXPEDITION, on a successful send-off (row 9). */
export function expeditionSendXp(tuning: KeepXpTuning = contentTuning): number {
  return tuning.progression.xp.expeditionSend;
}

/** ACKNOWLEDGE_REVEAL's base grant (row 10):
 * `revealBase + revealPer5Min × ⌊durationMs / 5min⌋` — a 5-minute Meadow
 * trip pays 7, a 90-minute Grotto trip pays 24. Per-MINUTE the Meadow
 * still wins (bible §1.4), so active play beating idle play survives in
 * XP too. */
export function revealXp(
  durationMs: number,
  tuning: KeepXpTuning = contentTuning,
): number {
  const cfg = tuning.progression.xp;
  return cfg.revealBase + cfg.revealPer5Min * Math.floor(durationMs / FIVE_MIN_MS);
}

/** HATCH_EGG, on success (row 11). */
export function hatchXp(tuning: KeepXpTuning = contentTuning): number {
  return tuning.progression.xp.hatch;
}

/** EVOLVE_PIP, on success (row 21). */
export function evolveXp(tuning: KeepXpTuning = contentTuning): number {
  return tuning.progression.xp.evolve;
}

/** PLACE_ITEM, first-ever placement of that item TYPE (row 13) — the
 * "reason to build" lever. Idempotence key: `counters["built.<itemId>"]`. */
export function firstBuildXp(tuning: KeepXpTuning = contentTuning): number {
  return tuning.progression.xp.firstBuild;
}

/** ASSIGN_JOB, first-ever shift at that job TYPE (row 17). Idempotence
 * key: `counters["job.<jobId>"]`. */
export function firstJobXp(tuning: KeepXpTuning = contentTuning): number {
  return tuning.progression.xp.firstJob;
}

/** One produced job tick, inside TICK/CATCHUP (row 16) — bounded by the
 * same `offlineRateCapMs` production already obeys. */
export function jobTickXp(
  ticks: number,
  tuning: KeepXpTuning = contentTuning,
): number {
  return Math.max(0, ticks) * tuning.progression.xp.jobTick;
}

/** Bounty completion (row 30) / day-clear (row 31) — idempotent by
 * construction upstream (`completedAt` / `dayBonusGranted`), so this is
 * called with the COUNT of NEW completions this dispatch (usually 0 or 1,
 * occasionally more when one action ticks off several bounties at once). */
export function bountyCompleteXp(
  count: number,
  tuning: KeepXpTuning = contentTuning,
): number {
  return Math.max(0, count) * tuning.progression.xp.bountyComplete;
}

export function bountyDayClearXp(
  count: number,
  tuning: KeepXpTuning = contentTuning,
): number {
  return Math.max(0, count) * tuning.progression.xp.bountyDayClear;
}

/** CLAIM_STREAK_REWARD (row 27): `base + perTier × the streak's EFFECTIVE
 * tier` — 20 at tier 0, 40 at tier 4. Idempotent upstream via
 * `rewardedForDay`. */
export function streakDayXp(
  effectiveTier: number,
  tuning: KeepXpTuning = contentTuning,
): number {
  const cfg = tuning.progression.xp;
  return cfg.streakDayBase + cfg.streakDayPerTier * Math.max(0, effectiveTier);
}

/** PURCHASE_ROSTER_UPGRADE, on the one-time purchase (row 20). */
export function rosterUpgradeXp(tuning: KeepXpTuning = contentTuning): number {
  return tuning.progression.xp.rosterUpgrade;
}

/** Mastery tier gained, inside ACKNOWLEDGE_REVEAL (row 32): `perTier ×
 * the NEW tier` (25 → 150), granted ONCE per (pip, biome, tier) via
 * `counters["masteryTier.<pipId>.<biomeId>"]` holding the highest tier
 * already paid — never the sum of every tier passed through. */
export function masteryTierXp(
  newTier: number,
  tuning: KeepXpTuning = contentTuning,
): number {
  return Math.max(0, newTier) * tuning.progression.xp.masteryTierPerTier;
}

/** Album transitions (rows 33–35) — computed as the DELTA of the Album's
 * own forward-only scalar totals (`formsSeen`/`formsCaught`/
 * `variantsCaught`), which already only ever increase by exactly 1 per
 * newly-recorded species/variant. Diffing the totals (rather than
 * special-casing which action caused the change) means every Album-
 * granting action — a reveal's field notes, a hatch, an evolution — is
 * covered by ONE calculation with nothing to forget. */
export function albumXpFromDeltas(
  seenDelta: number,
  caughtDelta: number,
  variantDelta: number,
  tuning: KeepXpTuning = contentTuning,
): number {
  const cfg = tuning.progression.xp;
  return (
    Math.max(0, seenDelta) * cfg.albumSeen +
    Math.max(0, caughtDelta) * cfg.albumCaught +
    Math.max(0, variantDelta) * cfg.albumVariant
  );
}

/** RETIRE_PIP, the pip's FIRST-ever arrival at the Long Meadow (row 22).
 * Idempotence lives in `counters["sanctuaryArrival.<pipId>"]` (NOT
 * `SanctuaryRecord.visits`, which `core/sanctuary`'s `retirePip` resets to
 * 0 on every arrival — a counters key is what actually survives a
 * retrieve → retire loop without re-granting). */
export function sanctuaryFirstArrivalXp(tuning: KeepXpTuning = contentTuning): number {
  return tuning.progression.xp.sanctuaryFirstArrival;
}

/** Cumulative XP required to REACH `level` (1-indexed; level 1 needs 0).
 * `levelXp` is 0-indexed by tier − 1 (bible §1.1), so tier `level`'s own
 * requirement is `levelXp[level - 1]`. */
export function xpRequiredForLevel(
  level: number,
  tuning: KeepXpTuning = contentTuning,
): number {
  return tuning.progression.levelXp[level - 1] ?? 0;
}

/** Whether `keepXp` clears the XP gate for the NEXT tier above `level`
 * (bible §1.2: tiers are earned with XP and PAID FOR with resources — two
 * keys). Past the last defined tier, there is no next gate to clear. */
export function isNextTierXpReady(
  keepXp: number,
  level: number,
  tuning: KeepXpTuning = contentTuning,
): boolean {
  const required = tuning.progression.levelXp[level];
  return required !== undefined && keepXp >= required;
}

/**
 * RENOWN (bible §1.7) — how many Renown levels `keepXp` has cleared past the
 * top tier. 0 below it, and 0 exactly ON the top tier's requirement.
 *
 * THE ONE PIECE OF RENOWN ARITHMETIC IN THE CODEBASE. It lived in
 * `ui/xpBar.ts` and was duplicated in `ui/keepUpgrade.ts`, so `core/state.ts`
 * had no pure way to ask "did this XP award cross a Renown boundary?" — which
 * is a large part of why Renown shipped granting nothing. Both UI modules and
 * the reducer's flair grant now read this.
 */
export function renownLevelFor(
  keepXp: number,
  tuning: KeepXpTuning = contentTuning,
): number {
  const topRequirement =
    tuning.progression.levelXp[tuning.progression.levelXp.length - 1] ?? 0;
  const perLevel = Math.max(1, tuning.progression.renown.xpPerLevel);
  return Math.floor(Math.max(0, keepXp - topRequirement) / perLevel);
}

/** The Renown bar's `{ into, span }`, mirroring `tierBarProgress`'s shape so
 * the XP bar has one code path for both halves of its life. */
export function renownBarProgress(
  keepXp: number,
  tuning: KeepXpTuning = contentTuning,
): { readonly into: number; readonly span: number } {
  const topRequirement =
    tuning.progression.levelXp[tuning.progression.levelXp.length - 1] ?? 0;
  const perLevel = Math.max(1, tuning.progression.renown.xpPerLevel);
  const beyond = Math.max(0, keepXp - topRequirement);
  return { into: beyond - renownLevelFor(keepXp, tuning) * perLevel, span: perLevel };
}

/** The current tier's bar, as `{ into, span }` — `into / span` is the
 * fraction the UI fills (bible §1.2: the bar is PER-TIER, never
 * cumulative, "because a cumulative bar is why every XP game eventually
 * stops feeling like it moves", §0.2). Past the top tier, `span` is 0 and
 * the bar reads as full (Renown owns what happens next, bible §1.7). */
export function tierBarProgress(
  keepXp: number,
  level: number,
  tuning: KeepXpTuning = contentTuning,
): { readonly into: number; readonly span: number } {
  const lo = xpRequiredForLevel(level, tuning);
  const hiRaw = tuning.progression.levelXp[level];
  const hi = hiRaw ?? lo;
  return { into: Math.max(0, keepXp - lo), span: Math.max(0, hi - lo) };
}
