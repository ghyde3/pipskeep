/**
 * MILESTONES (docs/retention-bible.md §4) — a registry-driven achievement
 * system read against one forward-only counter bag (`GameState.counters`).
 *
 * Two-phase, mirroring the streak ladder's auto-bank-vs-choice split:
 * `detectNewlyEarnable` notices a metric crossed its threshold and queues
 * the id in `pendingCelebrations` (a toast the UI can show whenever it
 * likes — bible §10.2's "one gentle toast", never a modal chain);
 * `claimMilestone` is the explicit grant step, and it is the one this
 * module's idempotency guarantee is about: `state.earned[id]` is set
 * exactly once, and every call after the first is a same-state no-op —
 * claiming twice can never double-grant a reward.
 *
 * Nothing here can decrease: `earned` only ever gains entries (bible
 * §0.1 — "Milestones earned: No[, may never decrease]"), and the metric
 * inputs this module reads (counters, Album totals, streak longest,
 * mastery tiers, Pip age, sanctuary residents) are themselves all
 * forward-only by construction elsewhere.
 */

import type { MilestoneDef, MilestoneReward } from "../../content/milestones";
import { MILESTONES as contentMilestones } from "../../content/milestones";

export interface MilestoneState {
  readonly earned: Readonly<Record<string, number>>;
  readonly pendingCelebrations: readonly string[];
}

export function createEmptyMilestones(): MilestoneState {
  return { earned: {}, pendingCelebrations: [] };
}

/** Everything a milestone's metric might read. Built by the caller
 * (core/state.ts) from the real GameState — kept structural so this
 * module never imports pipdex/sanctuary/pips directly (spec §2 rule 5,
 * and the explicit "do not edit core/pipdex or core/sanctuary" fence:
 * reading their OUTPUT numbers here is composition, not an edit). */
export interface MilestoneMetricContext {
  readonly counters: Readonly<Record<string, number>>;
  readonly albumForms: number;
  readonly ledgerVariants: number;
  readonly streakLongest: number;
  /** Highest mastery tier any single Pip has reached in any one biome. */
  readonly masteryTierAnyBiome: number;
  /** The WORST biome's best tier across the roster — i.e. "every biome,
   * at least tier N" (the min-of-max, so all six must clear the bar). */
  readonly masteryTierAllBiomes: number;
  readonly oldestPipAgeMs: number;
  readonly sanctuaryResidents: number;
}

export function metricValue(
  metric: MilestoneDef["metric"],
  ctx: MilestoneMetricContext,
): number {
  switch (metric.kind) {
    case "counter":
      return ctx.counters[metric.counterId] ?? 0;
    case "albumForms":
      return ctx.albumForms;
    case "ledgerVariants":
      return ctx.ledgerVariants;
    case "streakLongest":
      return ctx.streakLongest;
    case "masteryTierAnyBiome":
      return ctx.masteryTierAnyBiome;
    case "masteryTierAllBiomes":
      return ctx.masteryTierAllBiomes;
    case "oldestPipAgeMs":
      return ctx.oldestPipAgeMs;
    case "sanctuaryResidents":
      return ctx.sanctuaryResidents;
  }
}

export function isMilestoneMet(def: MilestoneDef, ctx: MilestoneMetricContext): boolean {
  return metricValue(def.metric, ctx) >= def.threshold;
}

/**
 * Scan the registry for newly-met, not-yet-earned, not-already-pending
 * milestones and queue them. Additive only — never removes an id already
 * pending (that is `claimMilestone`'s job) and never touches `earned`.
 * Returns `state` BY REFERENCE when nothing changed.
 */
export function detectNewlyEarnable(
  state: MilestoneState,
  ctx: MilestoneMetricContext,
  registry: readonly MilestoneDef[] = contentMilestones,
): MilestoneState {
  let pending = state.pendingCelebrations;
  let changed = false;
  for (const def of registry) {
    if (state.earned[def.id] !== undefined) continue;
    if (pending.includes(def.id)) continue;
    if (isMilestoneMet(def, ctx)) {
      pending = [...pending, def.id];
      changed = true;
    }
  }
  return changed ? { ...state, pendingCelebrations: pending } : state;
}

export interface ClaimResult {
  readonly state: MilestoneState;
  readonly ok: boolean;
  readonly reward?: MilestoneReward;
}

/**
 * Claim a milestone's reward at `at`. Idempotent: already-earned is a
 * same-reference no-op (no reward returned — the caller must not grant
 * anything on a `ok: false` result). Re-verifies the metric itself
 * (rather than trusting `pendingCelebrations`) so a claim dispatched out
 * of order can never grant a reward the player has not actually earned.
 */
export function claimMilestone(
  state: MilestoneState,
  id: string,
  at: number,
  ctx: MilestoneMetricContext,
  registry: readonly MilestoneDef[] = contentMilestones,
): ClaimResult {
  if (state.earned[id] !== undefined) {
    return { state, ok: false };
  }
  const def = registry.find((m) => m.id === id);
  if (def === undefined) return { state, ok: false };
  if (!isMilestoneMet(def, ctx)) return { state, ok: false };

  return {
    state: {
      earned: { ...state.earned, [id]: at },
      pendingCelebrations: state.pendingCelebrations.filter((pid) => pid !== id),
    },
    ok: true,
    reward: def.reward,
  };
}

/**
 * The v6 migration's one-time grant (bible §11.3): sets `earned` directly,
 * bypassing the metric check entirely (the `founder` milestone's threshold
 * is `Infinity` precisely so ordinary play can never earn it — only this
 * function, called exactly once by `MIGRATIONS[5]`, ever grants it).
 */
export function grantFounderMilestone(state: MilestoneState, at: number): MilestoneState {
  if (state.earned["founder"] !== undefined) return state;
  return { ...state, earned: { ...state.earned, founder: at } };
}
