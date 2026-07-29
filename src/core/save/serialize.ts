/**
 * Save envelope (spec §8): `{ schemaVersion, seed, savedAt, state }`.
 *
 * `state` is the whole GameState INCLUDING `rngState` — the cursor of
 * every touched rng stream (spec §2 rule 3) — so a given save file always
 * produces the same future rolls, and reloading never re-rolls or skips
 * an outcome. There is no separate event log; "reproducible" means *load
 * the exported save, get identical results*.
 *
 * `fromSaveBlob` is the trust boundary between storage and the sim: it
 * takes an unknown (JSON-parsed / IndexedDB-read) value and returns either
 * a fully validated `SaveBlob` or a typed `SaveBlobError` — it NEVER
 * throws. A corrupt blob must reach the §8 "Start Fresh + export the
 * broken blob" flow as data, not as an uncaught exception.
 *
 * Versioning: `fromSaveBlob` accepts exactly CURRENT_SCHEMA_VERSION.
 * Older versions go through migrate.ts first (spec §8 migrations from
 * day one), which upgrades then re-enters here for final validation.
 *
 * Validation depth: every field the simulation computes with is deeply
 * validated (pips, needs, rng cursors, cooldowns, roster referential
 * integrity). The two transient UI echoes (`lastCareOutcome`,
 * `lastCatchup`) are checked to be `null | plain object` only — the sim
 * never reads them, and deep-validating them is Phase 3 hardening.
 */

import type { GameState } from "../state";
import { LifeStage, NEED_IDS, PipActivity } from "../pips/types";
import type {
  ActiveExpedition,
  NeedId,
  PipId,
  PipNeeds,
  PipState,
  TraitGenome,
} from "../pips/types";
import { CARE_ACTIONS } from "../pips/care";
import type { CareAction, CareOutcome, CooldownsByPip } from "../pips/care";
import { DIALOGUE_CONTEXTS } from "../pips/mood";
import type { DialogueContext } from "../pips/mood";
import type { LastLineIndexByPip, PipLastLines } from "../pips/dialogue";
import type { CatchupSummary } from "../pips/catchup";

export const CURRENT_SCHEMA_VERSION = 1;

/** The on-disk envelope (spec §8). */
export interface SaveBlob {
  readonly schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  /** Duplicates `state.seed` at the top level for quick inspection of an
   * exported file; `fromSaveBlob` enforces that the two agree. */
  readonly seed: number;
  /** Clock time (ms) at save; offline catch-up derives `elapsed` from it
   * (spec §4.5: `elapsed = max(0, clock.now() − savedAt)`). */
  readonly savedAt: number;
  readonly state: GameState;
}

export type SaveBlobErrorCode =
  /** The blob is not a plain object at all. */
  | "not-an-object"
  /** A field is missing, has the wrong type, or fails a referential
   * check (roster entry without a pip, envelope/state seed mismatch…). */
  | "invalid-field"
  /** schemaVersion is not the one this validator accepts (older →
   * migrate() first; newer → written by a future build). */
  | "unsupported-schema-version"
  /** Defensive catch-all: an unexpected internal failure, converted to
   * data so fromSaveBlob keeps its never-throws contract. */
  | "internal";

/** Typed load-failure detail (spec §8: corrupt saves are surfaced, never
 * silently wiped — Phase 3's "Start Fresh" flow renders this). */
export interface SaveBlobError {
  readonly code: SaveBlobErrorCode;
  /** Dotted path to the offending field, e.g. `state.pips.pip-1.needs`.
   * Empty string when the blob as a whole is at fault. */
  readonly path: string;
  readonly message: string;
}

export type SaveBlobResult =
  | { readonly ok: true; readonly save: SaveBlob }
  | { readonly ok: false; readonly error: SaveBlobError };

/** Wrap live state in the persistence envelope. Pure and cheap: the
 * state object is shared, not cloned (GameState is immutable data). */
export function toSaveBlob(state: GameState, savedAt: number): SaveBlob {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    seed: state.seed,
    savedAt,
    state,
  };
}

/**
 * Validate an unknown value as a current-version SaveBlob.
 * Returns a typed error instead of throwing — always.
 */
export function fromSaveBlob(blob: unknown): SaveBlobResult {
  try {
    return { ok: true, save: validateBlob(blob) };
  } catch (failure) {
    if (failure instanceof ValidationFailure) {
      return { ok: false, error: failure.detail };
    }
    return {
      ok: false,
      error: {
        code: "internal",
        path: "",
        message: failure instanceof Error ? failure.message : String(failure),
      },
    };
  }
}

/** Plain-object check shared with migrate.ts (arrays and null excluded). */
export function isPlainRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Internal validation walk. Failures throw ValidationFailure, which the
// fromSaveBlob boundary converts to a typed result — nothing below is
// reachable from outside this module.
// ---------------------------------------------------------------------------

class ValidationFailure extends Error {
  constructor(readonly detail: SaveBlobError) {
    super(detail.message);
    this.name = "ValidationFailure";
  }
}

function fail(code: SaveBlobErrorCode, path: string, message: string): never {
  throw new ValidationFailure({ code, path, message });
}

function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}

/** `parent.key` path join ("" parent → just the key). */
function p(parent: string, key: string): string {
  return parent === "" ? key : `${parent}.${key}`;
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isPlainRecord(value)) {
    fail("invalid-field", path, `expected an object, got ${describeValue(value)}`);
  }
  return value;
}

function expectFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(
      "invalid-field",
      path,
      `expected a finite number, got ${describeValue(value)}`,
    );
  }
  return value;
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    fail("invalid-field", path, `expected a string, got ${describeValue(value)}`);
  }
  return value;
}

function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    fail("invalid-field", path, `expected a boolean, got ${describeValue(value)}`);
  }
  return value;
}

function expectStringOrNull(value: unknown, path: string): string | null {
  if (value === null) return null;
  return expectString(value, path);
}

function expectOneOf<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
): T {
  if (
    typeof value !== "string" ||
    !(allowed as readonly string[]).includes(value)
  ) {
    fail(
      "invalid-field",
      path,
      `expected one of [${allowed.join(", ")}], got ${
        typeof value === "string" ? JSON.stringify(value) : describeValue(value)
      }`,
    );
  }
  return value as T;
}

/** Record whose every value is a finite number (inventory, resources,
 * rng cursors). */
function validateNumberRecord(
  value: unknown,
  path: string,
): Record<string, number> {
  const rec = expectRecord(value, path);
  const out: Record<string, number> = {};
  for (const [key, entry] of Object.entries(rec)) {
    out[key] = expectFiniteNumber(entry, p(path, key));
  }
  return out;
}

function validateStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) {
    fail("invalid-field", path, `expected an array, got ${describeValue(value)}`);
  }
  return value.map((entry, i) => expectString(entry, `${path}[${i}]`));
}

const LIFE_STAGES: readonly LifeStage[] = Object.values(LifeStage);
const ACTIVITIES: readonly PipActivity[] = Object.values(PipActivity);

function validateGenome(value: unknown, path: string): TraitGenome {
  const rec = expectRecord(value, path);
  return {
    speciesId: expectString(rec["speciesId"], p(path, "speciesId")),
    palette: expectString(rec["palette"], p(path, "palette")),
    pattern: expectString(rec["pattern"], p(path, "pattern")),
    accessorySlots: expectFiniteNumber(
      rec["accessorySlots"],
      p(path, "accessorySlots"),
    ),
    personalityId: expectString(rec["personalityId"], p(path, "personalityId")),
  };
}

function validateNeeds(value: unknown, path: string): PipNeeds {
  const rec = expectRecord(value, path);
  const needs = {} as Record<NeedId, number>;
  for (const id of NEED_IDS) {
    needs[id] = expectFiniteNumber(rec[id], p(path, id));
  }
  return needs;
}

function validateExpedition(
  value: unknown,
  path: string,
): ActiveExpedition | null {
  if (value === null) return null;
  const rec = expectRecord(value, path);
  return {
    expeditionId: expectString(rec["expeditionId"], p(path, "expeditionId")),
    departedAt: expectFiniteNumber(rec["departedAt"], p(path, "departedAt")),
    durationMs: expectFiniteNumber(rec["durationMs"], p(path, "durationMs")),
  };
}

function validatePipState(
  value: unknown,
  path: string,
  expectedId: string,
): PipState {
  const rec = expectRecord(value, path);
  const id = expectString(rec["id"], p(path, "id"));
  if (id !== expectedId) {
    fail(
      "invalid-field",
      p(path, "id"),
      `pip id ${JSON.stringify(id)} does not match its record key ${JSON.stringify(expectedId)}`,
    );
  }
  return {
    id,
    speciesId: expectString(rec["speciesId"], p(path, "speciesId")),
    name: expectString(rec["name"], p(path, "name")),
    genome: validateGenome(rec["genome"], p(path, "genome")),
    personalityId: expectString(rec["personalityId"], p(path, "personalityId")),
    lifeStage: expectOneOf(rec["lifeStage"], p(path, "lifeStage"), LIFE_STAGES),
    hatchedAt: expectFiniteNumber(rec["hatchedAt"], p(path, "hatchedAt")),
    ageMs: expectFiniteNumber(rec["ageMs"], p(path, "ageMs")),
    happinessIntegral: expectFiniteNumber(
      rec["happinessIntegral"],
      p(path, "happinessIntegral"),
    ),
    needs: validateNeeds(rec["needs"], p(path, "needs")),
    activity: expectOneOf(rec["activity"], p(path, "activity"), ACTIVITIES),
    pendingSulk: expectBoolean(rec["pendingSulk"], p(path, "pendingSulk")),
    readyToEvolve: expectBoolean(rec["readyToEvolve"], p(path, "readyToEvolve")),
    lastGiftItemId: expectStringOrNull(
      rec["lastGiftItemId"],
      p(path, "lastGiftItemId"),
    ),
    expedition: validateExpedition(rec["expedition"], p(path, "expedition")),
    needsUpdatedAt: expectFiniteNumber(
      rec["needsUpdatedAt"],
      p(path, "needsUpdatedAt"),
    ),
  };
}

function validateCooldowns(value: unknown, path: string): CooldownsByPip {
  const rec = expectRecord(value, path);
  const out: Record<PipId, Partial<Record<CareAction, number>>> = {};
  for (const [pipId, table] of Object.entries(rec)) {
    const tablePath = p(path, pipId);
    const tableRec = expectRecord(table, tablePath);
    const entry: Partial<Record<CareAction, number>> = {};
    for (const [key, at] of Object.entries(tableRec)) {
      const action = expectOneOf(key, p(tablePath, key), CARE_ACTIONS);
      entry[action] = expectFiniteNumber(at, p(tablePath, key));
    }
    out[pipId] = entry;
  }
  return out;
}

function validateLastLineIndex(
  value: unknown,
  path: string,
): LastLineIndexByPip {
  const rec = expectRecord(value, path);
  const out: Record<PipId, PipLastLines> = {};
  for (const [pipId, table] of Object.entries(rec)) {
    const tablePath = p(path, pipId);
    const tableRec = expectRecord(table, tablePath);
    const entry: Partial<Record<DialogueContext, number>> = {};
    for (const [key, index] of Object.entries(tableRec)) {
      const context = expectOneOf(key, p(tablePath, key), DIALOGUE_CONTEXTS);
      entry[context] = expectFiniteNumber(index, p(tablePath, key));
    }
    out[pipId] = entry;
  }
  return out;
}

/** Transient UI echoes: shape-checked to `null | plain object` only and
 * passed through — the simulation never reads them (Phase 3 hardening
 * deep-validates or drops them). */
function passThroughTransient(value: unknown, path: string): unknown {
  if (value === null) return null;
  return expectRecord(value, path);
}

function validateGameState(value: unknown, path: string): GameState {
  const rec = expectRecord(value, path);

  const pipsRec = expectRecord(rec["pips"], p(path, "pips"));
  const pips: Record<PipId, PipState> = {};
  for (const [pipId, pip] of Object.entries(pipsRec)) {
    pips[pipId] = validatePipState(pip, p(p(path, "pips"), pipId), pipId);
  }

  const rosterOrder = validateStringArray(
    rec["rosterOrder"],
    p(path, "rosterOrder"),
  );
  rosterOrder.forEach((pipId, i) => {
    if (pips[pipId] === undefined) {
      fail(
        "invalid-field",
        `${p(path, "rosterOrder")}[${i}]`,
        `roster references unknown pip ${JSON.stringify(pipId)}`,
      );
    }
  });

  const activePipId = expectString(rec["activePipId"], p(path, "activePipId"));
  if (pips[activePipId] === undefined) {
    fail(
      "invalid-field",
      p(path, "activePipId"),
      `active pip ${JSON.stringify(activePipId)} is not in the roster`,
    );
  }

  return {
    pips,
    rosterOrder,
    activePipId,
    inventory: validateNumberRecord(rec["inventory"], p(path, "inventory")),
    resources: validateNumberRecord(rec["resources"], p(path, "resources")),
    // The rng stream cursors (spec §2 rule 3) — the field that makes a
    // reload produce the exact same future rolls.
    rngState: validateNumberRecord(rec["rngState"], p(path, "rngState")),
    seed: expectFiniteNumber(rec["seed"], p(path, "seed")),
    cooldowns: validateCooldowns(rec["cooldowns"], p(path, "cooldowns")),
    lastLineIndex: validateLastLineIndex(
      rec["lastLineIndex"],
      p(path, "lastLineIndex"),
    ),
    createdAt: expectFiniteNumber(rec["createdAt"], p(path, "createdAt")),
    lastTickAt: expectFiniteNumber(rec["lastTickAt"], p(path, "lastTickAt")),
    lastCareOutcome: passThroughTransient(
      rec["lastCareOutcome"],
      p(path, "lastCareOutcome"),
    ) as CareOutcome | null,
    lastCatchup: passThroughTransient(
      rec["lastCatchup"],
      p(path, "lastCatchup"),
    ) as CatchupSummary | null,
  };
}

function validateBlob(blob: unknown): SaveBlob {
  if (!isPlainRecord(blob)) {
    fail(
      "not-an-object",
      "",
      `expected a save object, got ${describeValue(blob)}`,
    );
  }
  const version = blob["schemaVersion"];
  if (version !== CURRENT_SCHEMA_VERSION) {
    fail(
      "unsupported-schema-version",
      "schemaVersion",
      `expected schemaVersion ${CURRENT_SCHEMA_VERSION}, got ${
        typeof version === "number" ? version : describeValue(version)
      } — older saves must go through migrate() first`,
    );
  }
  const seed = expectFiniteNumber(blob["seed"], "seed");
  const savedAt = expectFiniteNumber(blob["savedAt"], "savedAt");
  const state = validateGameState(blob["state"], "state");
  if (state.seed !== seed) {
    fail(
      "invalid-field",
      "seed",
      `envelope seed ${seed} does not match state.seed ${state.seed}`,
    );
  }
  return { schemaVersion: CURRENT_SCHEMA_VERSION, seed, savedAt, state };
}
