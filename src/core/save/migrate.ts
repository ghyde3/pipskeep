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
 * Adding the NEXT schema version:
 *
 *   1. bump CURRENT_SCHEMA_VERSION in serialize.ts and update the
 *      validators for the new shape;
 *   2. add `N: (vN) => vN+1blob` to MIGRATIONS below (steps receive and
 *      return plain unknown-shaped records — they must not assume the
 *      old shape was valid beyond what they touch);
 *   3. add fixtures/vN+1.json; migrate.test.ts already asserts a fixture
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

/**
 * v1 pips could only ever be created by createNewGame (`pip-1`), but a
 * migration must not assume validity: derive the next id counter from
 * the largest `pip-<n>` key actually present, falling back to key count.
 */
function derivePipCounter(pips: unknown): number {
  if (!isPlainRecord(pips)) return 1;
  const keys = Object.keys(pips);
  let max = 0;
  for (const key of keys) {
    const match = /^pip-(\d+)$/.exec(key);
    if (match !== null) max = Math.max(max, Number(match[1]));
  }
  return Math.max(max, keys.length) + 1;
}

/** Keyed by the version a step upgrades FROM: `MIGRATIONS[n]` turns a
 * vN blob into a v(N+1) blob. */
export const MIGRATIONS: Readonly<Record<number, MigrationStep>> = {
  /**
   * v1 → v2 (Phase 4, expeditions + eggs): pre-Phase-4 saves had no
   * Keep level, no eggs, no reveal queue, and no id counters. Defaults
   * are the "nothing has happened yet" values; the two new transient
   * echoes start null like their v1 siblings.
   */
  1: (blob) => {
    const out: Record<string, unknown> = { ...blob, schemaVersion: 2 };
    const state = blob["state"];
    if (isPlainRecord(state)) {
      out["state"] = {
        ...state,
        keepLevel: 1,
        eggs: [],
        pendingReveals: [],
        nextPipNumber: derivePipCounter(state["pips"]),
        nextEggNumber: 1,
        lastAssignOutcome: null,
        lastHatchOutcome: null,
      };
    }
    return out;
  },
};

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
