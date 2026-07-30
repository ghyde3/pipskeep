/**
 * The Long Meadow (internal id: `sanctuary`) — docs/retention-bible.md §2.
 *
 * The storage answer to content-bible §9 risk 7 (14 collectable forms
 * against a 3/5-Pip roster cap, with no release and no delete): a resident
 * is never destroyed, never punished, and always retrievable. Capacity is
 * UNLIMITED, permanently (bible §2.2) — a capped sanctuary would recreate
 * the exact "which Pip do I delete" problem it exists to solve.
 */

import type { PipId, PipState } from "../pips/types";

export interface SanctuaryRecord {
  /** The whole Pip, verbatim — genome, name, mastery, evolution record,
   * everything. Nothing is ever dropped or summarised (bible §2.6). */
  readonly pip: PipState;
  readonly retiredAt: number;
  /** Flavour: "she left when the Keep was still one small field." */
  readonly retiredFromKeepLevel: number;
  /** Times asked home (forward-only). */
  readonly visits: number;
}

export interface SanctuaryState {
  readonly pips: Readonly<Record<PipId, SanctuaryRecord>>;
  /** Stable display order = order of arrival. */
  readonly order: readonly PipId[];
}
