/**
 * EXPEDITION MASTERY (docs/retention-bible.md §6) — per Pip, per biome.
 *
 * What is STORED is trips (a plain forward-only count, `PipState.mastery`,
 * optional exactly like `sulking` — `undefined ≡ {}`, so no existing
 * fixture needs an edit). The TIER is DERIVED from trips + the expedition's
 * duration, so retuning the thresholds re-grades every existing Pip with
 * no migration (the same reasoning behind storing `happinessIntegral`
 * rather than a readiness flag, spec §4.6).
 *
 * Never decays: not on absence, not on retirement (mastery lives on
 * `PipState`, so it travels to the Long Meadow and back automatically),
 * not on evolution.
 *
 * What mastery improves — and ONLY this (bible §6.3, §0.4 isolation):
 * a bonus-roll CHANCE (loot quantity, delivered exactly like Curious's
 * +10% — occasional visible extra finds, never fractional scaling) and,
 * at tier 5 only, a small additive egg-chance bonus in POINTS. Both feed
 * `core/progression/multipliers.ts`'s single summed, capped channel —
 * this module never touches a roll itself. Explicitly NOT duration (that
 * is Hardworking's identity and what `core/economy/reachability.test.ts`
 * measures progression against), NOT loot-table weights, NOT decay, NOT
 * refusal rules — this module and its callers must never import anything
 * from the isolation list (`needDecayPerHour`, `care.*`, `foods.*`,
 * `offlineRateCapMs`, `personalityDecayMultipliers`, `playRefusal`,
 * `sulkExitThreshold` — see `retention.isolation.test.ts`).
 */

export interface MasteryTuning {
  readonly retention: {
    readonly mastery: {
      readonly tierHours: readonly number[];
      readonly tierMinTrips: readonly number[];
      readonly tierBonusRollChance: readonly number[];
      readonly topTierEggChanceBonusPoints: number;
    };
  };
}

/** Highest tier the tuning table defines (5 at launch). */
export function maxMasteryTier(tuning: MasteryTuning): number {
  return tuning.retention.mastery.tierHours.length;
}

/**
 * Trips required to REACH `tier` (1-indexed) on a biome of the given
 * duration (bible §6.2):
 *
 *   trips(tier, biome) = max(ceil(tierHours[tier] × 60 / durationMinutes),
 *                             tierMinTrips[tier])
 *
 * Time-normalised so a 90-minute biome (idle rhythm) and a 5-minute one
 * (active rhythm) both hand out a real ladder in the rhythm they're
 * actually played in; `tierMinTrips` is the floor that stops a long biome
 * handing out tier 1 for a single trip.
 */
export function tripsForTier(
  tier: number,
  durationMs: number,
  tuning: MasteryTuning,
): number {
  const i = tier - 1;
  const cfg = tuning.retention.mastery;
  const hours = cfg.tierHours[i] ?? 0;
  const minTrips = cfg.tierMinTrips[i] ?? 0;
  const durationMinutes = durationMs / 60_000;
  if (durationMinutes <= 0) return minTrips;
  return Math.max(Math.ceil((hours * 60) / durationMinutes), minTrips);
}

/** The highest tier `trips` completed trips on a biome of `durationMs`
 * duration have reached (0 = no tier yet). Monotonic in `trips`. */
export function masteryTier(
  trips: number,
  durationMs: number,
  tuning: MasteryTuning,
): number {
  let tier = 0;
  const max = maxMasteryTier(tuning);
  for (let t = 1; t <= max; t++) {
    if (trips >= tripsForTier(t, durationMs, tuning)) tier = t;
  }
  return tier;
}

/** The bonus-roll chance this Pip's mastery in this biome currently
 * contributes (0 below tier 1). Feeds the summed loot-bonus channel. */
export function masteryBonusRollChance(
  trips: number,
  durationMs: number,
  tuning: MasteryTuning,
): number {
  const tier = masteryTier(trips, durationMs, tuning);
  if (tier === 0) return 0;
  return tuning.retention.mastery.tierBonusRollChance[tier - 1] ?? 0;
}

/** The egg-chance bonus (in additive percentage POINTS — a separate,
 * separately-capped channel from loot) this Pip's mastery contributes:
 * only at the top tier, per bible §6.3. */
export function masteryEggChanceBonusPoints(
  trips: number,
  durationMs: number,
  tuning: MasteryTuning,
): number {
  const tier = masteryTier(trips, durationMs, tuning);
  return tier >= maxMasteryTier(tuning)
    ? tuning.retention.mastery.topTierEggChanceBonusPoints
    : 0;
}

/** Record one completed trip on `expeditionId` (bible §6.1: mastery
 * increments when a TRIP COMPLETES — the same moment loot is rolled).
 * `undefined` mastery reads as `{}`, same as `sulking`'s optional pattern —
 * every read site must do the same to stay migration-free. Forward-only:
 * never called with a negative delta, never resets. */
export function incrementMasteryTrips(
  mastery: Readonly<Record<string, number>> | undefined,
  expeditionId: string,
): Readonly<Record<string, number>> {
  const current = mastery?.[expeditionId] ?? 0;
  return { ...(mastery ?? {}), [expeditionId]: current + 1 };
}

/** Generic per-tier titles (bible §6.3 table); tier 5's title takes the
 * biome's display name ("Old friend of the Meadow"). */
const MASTERY_TITLES: readonly string[] = [
  "Knows the path",
  "Knows the shortcuts",
  "Knows where the nests are",
  "Knows every stone",
];

/** The player-facing title for a mastery tier on a named biome (the
 * actual reward, per bible §6.3 — "the real reward is the title on the
 * Pip's card"). Tier 0 has no title (`null`). */
export function masteryTitle(tier: number, biomeName: string): string | null {
  if (tier <= 0) return null;
  if (tier < MASTERY_TITLES.length + 1) {
    return MASTERY_TITLES[tier - 1] as string;
  }
  return `Old friend of the ${biomeName}`;
}
