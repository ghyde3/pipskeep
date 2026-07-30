/**
 * EGG PITY (docs/retention-bible.md §7) — visible, never hidden,
 * deterministic from the seeded RNG.
 *
 * A per-biome counter of hatches from that biome that did NOT produce the
 * pool's RAREST tier. At `threshold`, the next hatch from that biome is
 * GUARANTEED to be that tier, and the counter resets to 0. Common-only
 * pools (nothing rarer to chase) get no pity at all — `pityThresholdFor`
 * returns `null`, and the counter is simply never consulted for a
 * guarantee (though it may still be tracked at 0 forever, harmlessly).
 *
 * CURSOR PARITY (the hard constraint, and it comes free): a pity-triggered
 * hatch must consume EXACTLY as many rolls as an ordinary one, or an
 * existing save's future rolls would shift. `rollGenome`
 * (core/pips/genome.ts) already consumes a fixed 5 rolls regardless of how
 * many entries are in the registry it is handed (`pickSpecies` does one
 * weighted draw over `Object.values(registry)`, one `stream.next()` either
 * way) — the exact mechanism round 2B's biome-pool patch already relies
 * on. A pity hatch simply narrows the injected registry further (to the
 * guaranteed subset) before calling `rollGenome`; nothing here touches the
 * RNG directly.
 *
 * Kindness tiebreak (bible §7.2): the guaranteed draw PREFERS a
 * not-yet-caught species of the target tier, if one exists. This reads the
 * Album (a `PipdexState`), so it is composed at the `core/state.ts` call
 * site (which already imports both the pity narrowing here and the
 * pipdex module) — this file stays free of any Album import, taking the
 * caught-check as a plain predicate instead.
 */

export interface PityTuning {
  readonly retention: {
    readonly eggPity: {
      readonly thresholdByRarity: Readonly<Partial<Record<string, number>>>;
    };
  };
}

/** Structural view of one species registry entry, as pity needs it —
 * mirrors `core/pips/genome.ts`'s `GenomeSpeciesEntry` (same field, same
 * opaque-content-id rule, spec §2 rule 5). */
export interface PitySpeciesEntry {
  readonly id: string;
  readonly rarity: string;
}

/** Relative rarity ORDER, rarest first, for picking "the rarest tier
 * present in this pool" (bible §7.1). `lineage` is never in a hatchable
 * pool (v1.3 standing rule — weight 0), so it is excluded here; if it ever
 * appeared it would rank rarest of all, which is harmless since it can
 * never actually occur in a pool this function is asked about. */
const RARITY_ORDER: readonly string[] = ["rare", "uncommon", "common"];

/**
 * The rarest tier actually present in a biome's egg-species pool, or
 * `null` for an empty pool (defensive only — content validation forbids
 * this). A pool of all-common species (Bramblewick) returns `"common"`,
 * and `pityThresholdFor` below turns that into "no pity" because the
 * tuning table has no `common` entry.
 */
export function rarestTierInPool(pool: readonly PitySpeciesEntry[]): string | null {
  if (pool.length === 0) return null;
  const present = new Set(pool.map((entry) => entry.rarity));
  for (const rarity of RARITY_ORDER) {
    if (present.has(rarity)) return rarity;
  }
  // Registry declared a rarity id outside the known order (defensive) —
  // fall back to the pool's first entry deterministically.
  return (pool[0] as PitySpeciesEntry).rarity;
}

/** The pity threshold for a pool, or `null` when this pool has no pity
 * (a common-only pool — "the UI shows the odds and no counter, rather
 * than a counter that never pays", bible §7.1). */
export function pityThresholdFor(
  pool: readonly PitySpeciesEntry[],
  tuning: PityTuning,
): number | null {
  const rarest = rarestTierInPool(pool);
  if (rarest === null) return null;
  return tuning.retention.eggPity.thresholdByRarity[rarest] ?? null;
}

/**
 * Update a biome's pity counter after a hatch (bible §7.2: increments on a
 * HATCH — never on an egg merely being found — that did NOT produce the
 * pool's rarest tier; resets to 0 on one that did). `rarestTier === null`
 * (no pity tracked for this pool) leaves the counter unchanged.
 */
export function updatePityCounter(
  counter: number,
  hatchedRarity: string,
  rarestTier: string | null,
): number {
  if (rarestTier === null) return counter;
  return hatchedRarity === rarestTier ? 0 : counter + 1;
}

/** True once a biome's counter has reached its threshold — the NEXT hatch
 * from it is guaranteed. `threshold === null` (no pity) is never
 * guaranteed, regardless of the counter value. */
export function isPityGuaranteed(counter: number, threshold: number | null): boolean {
  return threshold !== null && counter >= threshold;
}

/**
 * Narrow a pool to its rarest tier for a GUARANTEED draw, preferring
 * not-yet-caught species (the kindness tiebreak) when at least one
 * uncaught rarest-tier species exists. `isCaught` is a plain predicate so
 * this module never imports the Album directly (spec §2 rule 5 — the
 * caller composes with whatever "caught" means, e.g. `pipdex` lookups).
 * Falls back to every rarest-tier entry when all are already caught (or
 * the caught-check is omitted) — a guarantee must never come back empty.
 */
export function guaranteedDrawPool<T extends PitySpeciesEntry>(
  pool: readonly T[],
  rarestTier: string,
  isCaught: (speciesId: string) => boolean = () => false,
): readonly T[] {
  const atTier = pool.filter((entry) => entry.rarity === rarestTier);
  const uncaught = atTier.filter((entry) => !isCaught(entry.id));
  return uncaught.length > 0 ? uncaught : atTier;
}
