/**
 * Schema migrations (spec §8: "Migrations from day one").
 *
 * `migrate` is the ONLY entry point the load path uses: it takes the raw
 * unknown blob exactly as storage produced it, reads `schemaVersion`,
 * applies every registered vN→vN+1 step in order, then hands the result
 * to `fromSaveBlob` for full structural validation. Like fromSaveBlob it
 * never throws — corrupt or unmigratable blobs come back as typed errors
 * so the §8 "Start Fresh + export the broken blob" flow gets data.
 *
 * v1 is current, so the step table is empty today. The harness and the
 * fixture test (fixtures/v1.json + migrate.test.ts) exist NOW so the
 * first real schema change (Phase 3) slots in as:
 *
 *   1. bump CURRENT_SCHEMA_VERSION in serialize.ts and update the
 *      validators for the new shape;
 *   2. add `1: (v1) => v2blob` to MIGRATIONS below (steps receive and
 *      return plain unknown-shaped records — they must not assume the
 *      old shape was valid beyond what they touch);
 *   3. add fixtures/v2.json; migrate.test.ts already asserts a fixture
 *      exists AND migrates cleanly for every version 1..CURRENT.
 */

import { CURRENT_SCHEMA_VERSION, fromSaveBlob, isPlainRecord } from "./serialize";
import type { SaveBlob, SaveBlobError } from "./serialize";

/**
 * One schema upgrade step: takes a raw vN blob, returns a raw v(N+1)
 * blob (including the bumped `schemaVersion` field). Steps operate on
 * unvalidated data — final validation happens once, after the chain.
 */
export type MigrationStep = (
  blob: Readonly<Record<string, unknown>>,
) => Record<string, unknown>;

/** Keyed by the version a step upgrades FROM: `MIGRATIONS[n]` turns a
 * vN blob into a v(N+1) blob. Empty while v1 is current. */
export const MIGRATIONS: Readonly<Record<number, MigrationStep>> = {};

export type MigrateResult =
  | {
      readonly ok: true;
      readonly save: SaveBlob;
      /** The schemaVersion the blob arrived with (1..CURRENT). */
      readonly fromVersion: number;
    }
  | { readonly ok: false; readonly error: SaveBlobError };

/** Upgrade an unknown blob to CURRENT_SCHEMA_VERSION and validate it. */
export function migrate(unknownBlob: unknown): MigrateResult {
  if (!isPlainRecord(unknownBlob)) {
    return {
      ok: false,
      error: {
        code: "not-an-object",
        path: "",
        message: "save blob is not an object",
      },
    };
  }

  const version = unknownBlob["schemaVersion"];
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return {
      ok: false,
      error: {
        code: "invalid-field",
        path: "schemaVersion",
        message: `schemaVersion must be a positive integer, got ${JSON.stringify(version)}`,
      },
    };
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    return {
      ok: false,
      error: {
        code: "unsupported-schema-version",
        path: "schemaVersion",
        message: `save is schemaVersion ${version} but this build reads up to ${CURRENT_SCHEMA_VERSION} (written by a newer build?)`,
      },
    };
  }

  let blob: Record<string, unknown> = unknownBlob;
  for (let from = version; from < CURRENT_SCHEMA_VERSION; from++) {
    const step = MIGRATIONS[from];
    if (step === undefined) {
      return {
        ok: false,
        error: {
          code: "unsupported-schema-version",
          path: "schemaVersion",
          message: `no migration registered from schemaVersion ${from}`,
        },
      };
    }
    try {
      blob = step(blob);
    } catch (failure) {
      return {
        ok: false,
        error: {
          code: "internal",
          path: "schemaVersion",
          message: `migration from schemaVersion ${from} failed: ${
            failure instanceof Error ? failure.message : String(failure)
          }`,
        },
      };
    }
  }

  const result = fromSaveBlob(blob);
  if (!result.ok) return result;
  return { ok: true, save: result.save, fromVersion: version };
}
