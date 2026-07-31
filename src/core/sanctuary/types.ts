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
  /**
   * ROUND 2H (spec §16 v1.5, docs/lifecycle-bible.md §2.5/§4/§9.2) — WHY
   * this Pip is here. All three are written by real code paths:
   *
   * - `"player"` — an ordinary RETIRE_PIP tap. Written explicitly by
   *   `core/state.ts`'s RETIRE_PIP arm; `undefined` also reads as this,
   *   which is what every pre-2H resident round-trips as.
   * - `"age"` — a RETIRE_PIP tap on a Pip whose `readyToRetire` flag was
   *   already set (promise 3's peaceful ending). Cosmetic in mechanics —
   *   an age retirement is retrievable exactly like a player one — but
   *   NOT cosmetic in meaning: it is what lets the Long Meadow tell a
   *   full life apart from a change of scene, and what gives the
   *   promise-3 path something durable for a test to assert on.
   * - `"lost"` — `core/pips/ailment.ts`'s `resolveAilments` TRUE LOSS
   *   branch, the only reason that is never player-chosen.
   *
   * `core/sanctuary/index.ts`'s `retrievePip` refuses a `"lost"` resident
   * (a memorial, not a pause) — retiring an ailing-but-still-alive Pip
   * (bible §7.6) stays `"player"`/`"age"` and fully retrievable.
   */
  readonly reason?: SanctuaryReason;
}

export type SanctuaryReason = "player" | "age" | "lost";

export interface SanctuaryState {
  readonly pips: Readonly<Record<PipId, SanctuaryRecord>>;
  /** Stable display order = order of arrival. */
  readonly order: readonly PipId[];
}
