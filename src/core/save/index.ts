/**
 * Save domain (spec §8) — serialization, schema versioning, migrations.
 *
 * - serialize.ts owns the envelope shape (`SaveBlob`), `toSaveBlob`, and
 *   the never-throws structural validator `fromSaveBlob`.
 * - migrate.ts owns the schemaVersion upgrade harness (`migrate`), with
 *   a fixture save per historical version under fixtures/.
 * - IndexedDB persistence (autosave, load-on-boot) lives in
 *   src/app/persistence.ts — it is a browser concern, not core.
 */

export * from "./serialize";
export * from "./migrate";
