/**
 * The Album (internal id: `pipdex`) — docs/retention-bible.md §1.
 *
 * Player-facing name is "the Album"; `pipdex` is kept as the code
 * identifier only (the bible's own naming call, §1 preamble — "-dex" reads
 * as evoking a specific franchise, which spec §0's vocabulary rule is
 * about, so the surface name is "the Album" and this stays internal).
 *
 * Three tiers per species (bible §1.1), derived from the two timestamps
 * below rather than stored as an enum — `caughtAt !== null` implies
 * Portrait regardless of `seenAt` (a species can be caught without ever
 * being "seen" via a biome trip: the starter, or a lineage form reached
 * only by evolving):
 *
 *   Blank page  — no entry at all (or an entry with both timestamps null).
 *   Field note  — `seenAt !== null`, `caughtAt === null`.
 *   Portrait    — `caughtAt !== null`.
 *
 * EVERY write in this module is additive (bible §1.4's "Every write is
 * additive. There is no code path that clears an entry" — `pipdex.test.ts`
 * asserts every scalar total is non-decreasing across a randomised action
 * sequence, per the orchestrator's §0.1 guardrail: Album entries may never
 * decrease).
 */

import type { LifeStage, PipId, TraitGenome } from "../pips/types";

export interface PipdexPortrait {
  readonly pipId: PipId;
  readonly name: string;
  readonly genome: TraitGenome;
  readonly personalityId: string;
  readonly lifeStageAtCatch: LifeStage;
  /** Expedition the egg came from; null for the starter, an evolution
   * (not sourced from an expedition), or a debug egg. */
  readonly sourceExpeditionId: string | null;
}

export interface PipdexEntry {
  readonly speciesId: string;
  /** First moment this form became a Field note. Null = blank page. */
  readonly seenAt: number | null;
  /** First moment one was owned. Null = never caught. */
  readonly caughtAt: number | null;
  /** Lifetime count of this form acquired (hatched/evolved/started). Monotonic. */
  readonly caughtCount: number;
  /** Frozen snapshot of the FIRST one caught, for the portrait (bible §1.3.3). */
  readonly firstPortrait: PipdexPortrait | null;
  /** First moment a shiny of this form was caught (the corner stamp). */
  readonly shinyCaughtAt: number | null;
  /** Evolution variant id → first witnessed timestamp (the ribbon leaves,
   * bible §1.3.6). Lives on the BASE species' entry — the evolved
   * (lineage) species gets its own `caughtAt`/`firstPortrait` separately. */
  readonly variantsCaught: Readonly<Record<string, number>>;
  /** Expedition ids whose pools this form is known to be in (accumulates,
   * never shrinks). */
  readonly knownBiomes: readonly string[];
}

export interface PipdexState {
  readonly entries: Readonly<Record<string, PipdexEntry>>;
  /** Display order = order first seen OR caught, whichever came first.
   * Forward-only append. */
  readonly discoveryOrder: readonly string[];
  /** Forward-only totals, so the cover needs no O(n) recount per render. */
  readonly formsSeen: number;
  readonly formsCaught: number;
  /** Total gift-variant leaves witnessed across every evolution line (the
   * Grove Ledger total, bible §1.2). */
  readonly variantsCaught: number;
  readonly shiniesCaught: number;
  /** Ids the player has not yet opened since they changed — the "new" dot
   * (bible §1.4). Nothing in core clears this; it is the UI's seam. */
  readonly unreadEntryIds: readonly string[];
}

/** The two declared completion targets plus the uncounted shiny
 * celebration (bible §1.2) — percentages clamped to [0, 1] so a registry
 * edge case (Mosspip's evolution line has one extra gift variant, see
 * content/species.ts) can never read as "more than 100%". */
export interface PipdexCompletion {
  readonly formsSeen: number;
  readonly formsCaught: number;
  readonly albumTarget: number;
  /** `formsCaught / albumTarget`, clamped to [0, 1]. */
  readonly albumPct: number;
  readonly ledgerVariantsCaught: number;
  readonly ledgerTarget: number;
  /** `ledgerVariantsCaught / ledgerTarget`, clamped to [0, 1]. */
  readonly ledgerPct: number;
  /** No denominator, by design (bible §1.2) — "3 glimmers found", never "3/14". */
  readonly shiniesCaught: number;
}
