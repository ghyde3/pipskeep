/**
 * Save domain (spec §8) — serialization, schema versioning, migrations.
 *
 * Phase 3 implements persistence (IndexedDB via `idb`), the migration
 * harness, autosave, and export/import. Phase 0 pins the save envelope
 * shape so everything downstream types against it.
 */

export const CURRENT_SCHEMA_VERSION = 1;

/**
 * The on-disk envelope (spec §8). `state` includes the RNG stream cursors
 * (spec §2 rule 3) — reloading a save must never re-roll or skip a random
 * outcome.
 */
export interface SaveFile<TGameState> {
  schemaVersion: number;
  seed: number;
  /** Clock time (ms) at save; offline catch-up derives `elapsed` from it. */
  savedAt: number;
  state: TGameState;
}
