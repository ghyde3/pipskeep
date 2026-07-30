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
 * validated (pips, needs, eggs, pending reveals, rng cursors, cooldowns,
 * roster referential integrity). The transient UI echoes
 * (`lastCareOutcome`, `lastCatchup`, `lastAssignOutcome`,
 * `lastHatchOutcome`) are checked to be `null | plain object` only — a
 * deliberate, permanent contract, not a stopgap: the sim never reads
 * them (they only feed UI diffing), and passing them through unchanged
 * is what keeps save→load deep-equal (the Phase 2 gate). Deep-validate
 * them only if a reducer ever starts computing with them.
 */

import { ONBOARDING_STEPS } from "../state";
import type { EvolveOutcome, GameState, OnboardingState } from "../state";
import { LifeStage, NEED_IDS, PipActivity } from "../pips/types";
import type {
  ActiveExpedition,
  EvolvedRecord,
  NeedId,
  PipId,
  PipNeeds,
  PipState,
  TraitGenome,
} from "../pips/types";
import type {
  PipdexEntry,
  PipdexPortrait,
  PipdexState,
} from "../pipdex";
import type { SanctuaryOutcome, SanctuaryRecord, SanctuaryState } from "../sanctuary";
import type { StreakChoice, StreakChoiceKind, StreakState } from "../progression/streak";
import type { MilestoneState } from "../progression/milestones";
import type { BountiesState, BountyInstance } from "../progression/bounties";
import { CARE_ACTIONS } from "../pips/care";
import type { CareAction, CareOutcome, CooldownsByPip } from "../pips/care";
import { DIALOGUE_CONTEXTS } from "../pips/mood";
import type { DialogueContext } from "../pips/mood";
import type { LastLineIndexByPip, PipLastLines } from "../pips/dialogue";
import type { CatchupSummary } from "../pips/catchup";
import { EggState } from "../eggs";
import type { Egg, HatchOutcome } from "../eggs";
import type { AssignExpeditionOutcome, PendingReveal } from "../expeditions";
import type { KeepState, Placement, PlacementId } from "../keep";
import type { JobAssignment, JobOutcome, JobsByPip } from "../keep/jobs";

/**
 * v7 (round 2C review): one new REQUIRED top-level slice — `flair`
 * (`flairId → earnedAt`, docs/retention-bible.md §4.3). Round 2C shipped 22
 * `kind: "flair"` milestone rewards against no state field, no serializer
 * entry and no renderer, so every long-haul target in the game — 14/14 The
 * Album, 21/21 the Grove Ledger, the 30-day streak, 100 bounties — paid
 * literally nothing while the UI promised "a flourish for the Album". It gets
 * a version of its own rather than being folded into v6 because v6 saves
 * already existed by the time review caught it; `MIGRATIONS[6]` seeds the
 * field and re-derives the `founder` veteran's Album stamp.
 *
 * v6 (round 2C — docs/retention-bible.md §11): two new REQUIRED
 * top-level slices — `pipdex` (the Album, §1) and `sanctuary` (the Long
 * Meadow, §2) — plus the matching transient echo `lastSanctuaryOutcome`.
 * Both are additive-only data (spec §4.4's guardrail: nothing in this
 * round ever removes a Pip or clears an Album entry). Migrated saves
 * derive `pipdex` from every Pip already owned (bible §11.3 — "never
 * backfill a counter above the truth, never below what is provable") and
 * seed `sanctuary` empty (nothing could have been retired before this
 * round shipped).
 *
 * v5 (round 2A finding #2): per-pip `sulking: boolean` — the Sulking
 * penalty (spec §4.4) is now an orthogonal flag alongside `activity`, not
 * solely the `activity === "sulking"` enum value, so "Resting AND still
 * sulking" is representable (a Sulking Pip's Rest toggle used to be
 * refused outright — see `core/pips/machine.ts` module doc). Migrated
 * saves derive it from the pre-v5 encoding: `sulking: activity ===
 * "sulking"`. Absent on a v5 blob defaults to `false` (same
 * belt-and-suspenders as `genome.shiny`, in case of a partial write) —
 * every pip this build produces sets it explicitly.
 *
 * v4 (Phase 6): `onboarding: { completed, step }` — guided-onboarding
 * progress (spec §10.1); migrated saves arrive completed so only fresh
 * games see the tutorial.
 * (v3, Phase 5: `keepLevel` restructured into `keep: {level,
 * placements}`, plus `jobs`, `rosterUpgradePurchased`,
 * `nextPlacementNumber`, per-pip `evolved` records, and the two new
 * transient outcome echoes (job, evolve). v2, Phase 4: keepLevel, eggs,
 * pendingReveals, id counters.) */
export const CURRENT_SCHEMA_VERSION = 7;

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
const EGG_STATES: readonly EggState[] = Object.values(EggState);

function expectNumberOrNull(value: unknown, path: string): number | null {
  if (value === null) return null;
  return expectFiniteNumber(value, path);
}

function validateEgg(value: unknown, path: string): Egg {
  const rec = expectRecord(value, path);
  return {
    id: expectString(rec["id"], p(path, "id")),
    state: expectOneOf(rec["state"], p(path, "state"), EGG_STATES),
    foundAt: expectFiniteNumber(rec["foundAt"], p(path, "foundAt")),
    rarity: expectString(rec["rarity"], p(path, "rarity")),
    incubationMs: expectFiniteNumber(rec["incubationMs"], p(path, "incubationMs")),
    incubationStartedAt: expectNumberOrNull(
      rec["incubationStartedAt"],
      p(path, "incubationStartedAt"),
    ),
    sourceExpeditionId: expectStringOrNull(
      rec["sourceExpeditionId"],
      p(path, "sourceExpeditionId"),
    ),
  };
}

function validateEggs(value: unknown, path: string): readonly Egg[] {
  if (!Array.isArray(value)) {
    fail("invalid-field", path, `expected an array, got ${describeValue(value)}`);
  }
  return value.map((egg, i) => validateEgg(egg, `${path}[${i}]`));
}

function validatePendingReveal(value: unknown, path: string): PendingReveal {
  const rec = expectRecord(value, path);
  const eggValue = rec["egg"];
  return {
    pipId: expectString(rec["pipId"], p(path, "pipId")),
    expeditionId: expectString(rec["expeditionId"], p(path, "expeditionId")),
    completedAt: expectFiniteNumber(rec["completedAt"], p(path, "completedAt")),
    items: validateStringArray(rec["items"], p(path, "items")),
    egg: eggValue === null ? null : validateEgg(eggValue, p(path, "egg")),
  };
}

function validatePendingReveals(
  value: unknown,
  path: string,
): readonly PendingReveal[] {
  if (!Array.isArray(value)) {
    fail("invalid-field", path, `expected an array, got ${describeValue(value)}`);
  }
  return value.map((reveal, i) => validatePendingReveal(reveal, `${path}[${i}]`));
}

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
    // Absent = false rather than a hard failure: `shiny` landed inside
    // the v4 window, so a v4 blob written just before it may lack the
    // field. The v3→v4 migration writes it explicitly for older saves.
    shiny:
      rec["shiny"] === undefined ? false : expectBoolean(rec["shiny"], p(path, "shiny")),
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

/** Evolution record (spec §4.6): null until the pip evolved. */
function validateEvolved(value: unknown, path: string): EvolvedRecord | null {
  if (value === null) return null;
  const rec = expectRecord(value, path);
  return {
    variantId: expectString(rec["variantId"], p(path, "variantId")),
    evolvedAt: expectFiniteNumber(rec["evolvedAt"], p(path, "evolvedAt")),
  };
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
    // v5 (round 2A finding #2): absent = false rather than a hard failure
    // — same defensive default as `genome.shiny` — every pip this build
    // writes sets it explicitly; the v4→v5 migration backfills older
    // saves from the pre-v5 `activity === "sulking"` encoding.
    sulking:
      rec["sulking"] === undefined
        ? false
        : expectBoolean(rec["sulking"], p(path, "sulking")),
    readyToEvolve: expectBoolean(rec["readyToEvolve"], p(path, "readyToEvolve")),
    evolved: validateEvolved(rec["evolved"], p(path, "evolved")),
    lastGiftItemId: expectStringOrNull(
      rec["lastGiftItemId"],
      p(path, "lastGiftItemId"),
    ),
    expedition: validateExpedition(rec["expedition"], p(path, "expedition")),
    needsUpdatedAt: expectFiniteNumber(
      rec["needsUpdatedAt"],
      p(path, "needsUpdatedAt"),
    ),
    // ROUND 2C — expedition mastery (v6, bible §6.1): optional exactly
    // like `sulking` above — absent stays absent, so a pre-mastery pip
    // round-trips byte-for-byte with no field materialising from nothing.
    ...(rec["mastery"] !== undefined
      ? { mastery: validateNumberRecord(rec["mastery"], p(path, "mastery")) }
      : {}),
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

/** One placed item on the Keep grid (spec §9). Structural only: bounds
 * and collision are gameplay rules over content footprints, which the
 * save layer deliberately does not import — placement legality was
 * enforced when the item was placed. */
function validatePlacement(value: unknown, path: string): Placement {
  const rec = expectRecord(value, path);
  return {
    itemId: expectString(rec["itemId"], p(path, "itemId")),
    x: expectFiniteNumber(rec["x"], p(path, "x")),
    y: expectFiniteNumber(rec["y"], p(path, "y")),
  };
}

/** The Keep slice (spec §9): level 1..3 plus every placement. */
function validateKeep(value: unknown, path: string): KeepState {
  const rec = expectRecord(value, path);
  const level = expectFiniteNumber(rec["level"], p(path, "level"));
  if (!Number.isInteger(level) || level < 1) {
    fail(
      "invalid-field",
      p(path, "level"),
      `keep level must be a positive integer, got ${level}`,
    );
  }
  const placementsRec = expectRecord(rec["placements"], p(path, "placements"));
  const placements: Record<PlacementId, Placement> = {};
  for (const [placementId, placement] of Object.entries(placementsRec)) {
    placements[placementId] = validatePlacement(
      placement,
      p(p(path, "placements"), placementId),
    );
  }
  return { level, placements };
}

/** Standing jobs (spec §6.2), keyed by working pip. */
function validateJobs(value: unknown, path: string): JobsByPip {
  const rec = expectRecord(value, path);
  const out: Record<PipId, JobAssignment> = {};
  for (const [pipId, job] of Object.entries(rec)) {
    const jobPath = p(path, pipId);
    const jobRec = expectRecord(job, jobPath);
    out[pipId] = {
      jobId: expectString(jobRec["jobId"], p(jobPath, "jobId")),
      stationPlacementId: expectString(
        jobRec["stationPlacementId"],
        p(jobPath, "stationPlacementId"),
      ),
      assignedAt: expectFiniteNumber(jobRec["assignedAt"], p(jobPath, "assignedAt")),
      lastProducedAt: expectFiniteNumber(
        jobRec["lastProducedAt"],
        p(jobPath, "lastProducedAt"),
      ),
    };
  }
  return out;
}

/** Onboarding progress (v4, spec §10.1): the sim reads `completed`
 * (boot decides whether to resume the guided beats), so it is deeply
 * validated, unlike the transient echoes below. */
function validateOnboarding(value: unknown, path: string): OnboardingState {
  const rec = expectRecord(value, path);
  return {
    completed: expectBoolean(rec["completed"], p(path, "completed")),
    step: expectOneOf(rec["step"], p(path, "step"), ONBOARDING_STEPS),
  };
}

/** Transient UI echoes: shape-checked to `null | plain object` only and
 * passed through. Deliberate and permanent — the simulation never reads
 * them, and preserving them verbatim keeps save→load deep-equal; deep
 * validation starts mattering only if a reducer ever reads them. */
function passThroughTransient(value: unknown, path: string): unknown {
  if (value === null) return null;
  return expectRecord(value, path);
}

/** ROUND 2C — the Album (v6, docs/retention-bible.md §1.4). The frozen
 * first-portrait snapshot inside a `PipdexEntry`. */
function validatePipdexPortrait(value: unknown, path: string): PipdexPortrait {
  const rec = expectRecord(value, path);
  return {
    pipId: expectString(rec["pipId"], p(path, "pipId")),
    name: expectString(rec["name"], p(path, "name")),
    genome: validateGenome(rec["genome"], p(path, "genome")),
    personalityId: expectString(rec["personalityId"], p(path, "personalityId")),
    lifeStageAtCatch: expectOneOf(
      rec["lifeStageAtCatch"],
      p(path, "lifeStageAtCatch"),
      LIFE_STAGES,
    ),
    sourceExpeditionId: expectStringOrNull(
      rec["sourceExpeditionId"],
      p(path, "sourceExpeditionId"),
    ),
  };
}

/** One species' Album page. `expectedSpeciesId` mirrors `validatePipState`'s
 * key/id referential check (the entry's own `speciesId` must match the
 * record key it is stored under). */
function validatePipdexEntry(
  value: unknown,
  path: string,
  expectedSpeciesId: string,
): PipdexEntry {
  const rec = expectRecord(value, path);
  const speciesId = expectString(rec["speciesId"], p(path, "speciesId"));
  if (speciesId !== expectedSpeciesId) {
    fail(
      "invalid-field",
      p(path, "speciesId"),
      `pipdex entry speciesId ${JSON.stringify(speciesId)} does not match its record key ${JSON.stringify(expectedSpeciesId)}`,
    );
  }
  const firstPortraitValue = rec["firstPortrait"];
  return {
    speciesId,
    seenAt: expectNumberOrNull(rec["seenAt"], p(path, "seenAt")),
    caughtAt: expectNumberOrNull(rec["caughtAt"], p(path, "caughtAt")),
    caughtCount: expectFiniteNumber(rec["caughtCount"], p(path, "caughtCount")),
    firstPortrait:
      firstPortraitValue === null
        ? null
        : validatePipdexPortrait(firstPortraitValue, p(path, "firstPortrait")),
    shinyCaughtAt: expectNumberOrNull(rec["shinyCaughtAt"], p(path, "shinyCaughtAt")),
    variantsCaught: validateNumberRecord(
      rec["variantsCaught"],
      p(path, "variantsCaught"),
    ),
    knownBiomes: validateStringArray(rec["knownBiomes"], p(path, "knownBiomes")),
  };
}

/** The whole Album (v6). `discoveryOrder` is referentially checked against
 * `entries` (same bar as `rosterOrder` vs `pips`). */
function validatePipdexState(value: unknown, path: string): PipdexState {
  const rec = expectRecord(value, path);
  const entriesRec = expectRecord(rec["entries"], p(path, "entries"));
  const entries: Record<string, PipdexEntry> = {};
  for (const [speciesId, entry] of Object.entries(entriesRec)) {
    entries[speciesId] = validatePipdexEntry(
      entry,
      p(p(path, "entries"), speciesId),
      speciesId,
    );
  }
  const discoveryOrder = validateStringArray(
    rec["discoveryOrder"],
    p(path, "discoveryOrder"),
  );
  discoveryOrder.forEach((speciesId, i) => {
    if (entries[speciesId] === undefined) {
      fail(
        "invalid-field",
        `${p(path, "discoveryOrder")}[${i}]`,
        `discoveryOrder references unknown species ${JSON.stringify(speciesId)}`,
      );
    }
  });
  return {
    entries,
    discoveryOrder,
    formsSeen: expectFiniteNumber(rec["formsSeen"], p(path, "formsSeen")),
    formsCaught: expectFiniteNumber(rec["formsCaught"], p(path, "formsCaught")),
    variantsCaught: expectFiniteNumber(rec["variantsCaught"], p(path, "variantsCaught")),
    shiniesCaught: expectFiniteNumber(rec["shiniesCaught"], p(path, "shiniesCaught")),
    unreadEntryIds: validateStringArray(
      rec["unreadEntryIds"],
      p(path, "unreadEntryIds"),
    ),
  };
}

/** ROUND 2C — the Long Meadow (v6, docs/retention-bible.md §2.6). A
 * resident's whole `PipState`, verbatim — same referential bar as an
 * active pip (`validatePipState`'s key/id match). */
function validateSanctuaryRecord(
  value: unknown,
  path: string,
  expectedId: string,
): SanctuaryRecord {
  const rec = expectRecord(value, path);
  return {
    pip: validatePipState(rec["pip"], p(path, "pip"), expectedId),
    retiredAt: expectFiniteNumber(rec["retiredAt"], p(path, "retiredAt")),
    retiredFromKeepLevel: expectFiniteNumber(
      rec["retiredFromKeepLevel"],
      p(path, "retiredFromKeepLevel"),
    ),
    visits: expectFiniteNumber(rec["visits"], p(path, "visits")),
  };
}

/** The whole Long Meadow (v6). `order` is referentially checked against
 * `pips` (same bar as `rosterOrder` vs the active roster). */
function validateSanctuaryState(value: unknown, path: string): SanctuaryState {
  const rec = expectRecord(value, path);
  const pipsRec = expectRecord(rec["pips"], p(path, "pips"));
  const pips: Record<PipId, SanctuaryRecord> = {};
  for (const [pipId, record] of Object.entries(pipsRec)) {
    pips[pipId] = validateSanctuaryRecord(
      record,
      p(p(path, "pips"), pipId),
      pipId,
    );
  }
  const order = validateStringArray(rec["order"], p(path, "order"));
  order.forEach((pipId, i) => {
    if (pips[pipId] === undefined) {
      fail(
        "invalid-field",
        `${p(path, "order")}[${i}]`,
        `sanctuary order references unknown resident ${JSON.stringify(pipId)}`,
      );
    }
  });
  return { pips, order };
}

/** ROUND 2C — the daily streak (v6, docs/retention-bible.md §3.5). */
const STREAK_CHOICE_KINDS: readonly StreakChoiceKind[] = [
  "keepsake",
  "basketEgg",
  "bountyEgg",
];

function validateStreakChoice(value: unknown, path: string): StreakChoice {
  const rec = expectRecord(value, path);
  return {
    kind: expectOneOf(rec["kind"], p(path, "kind"), STREAK_CHOICE_KINDS),
    offers: validateStringArray(rec["offers"], p(path, "offers")),
    forDay: expectFiniteNumber(rec["forDay"], p(path, "forDay")),
  };
}

function validateStreakState(value: unknown, path: string): StreakState {
  const rec = expectRecord(value, path);
  const pendingRaw = rec["pendingChoices"];
  if (!Array.isArray(pendingRaw)) {
    fail(
      "invalid-field",
      p(path, "pendingChoices"),
      `expected an array, got ${describeValue(pendingRaw)}`,
    );
  }
  return {
    current: expectFiniteNumber(rec["current"], p(path, "current")),
    longest: expectFiniteNumber(rec["longest"], p(path, "longest")),
    lastVisitDay: expectNumberOrNull(rec["lastVisitDay"], p(path, "lastVisitDay")),
    totalVisitDays: expectFiniteNumber(rec["totalVisitDays"], p(path, "totalVisitDays")),
    graceBanked: expectFiniteNumber(rec["graceBanked"], p(path, "graceBanked")),
    graceRefilledOnDay: expectNumberOrNull(
      rec["graceRefilledOnDay"],
      p(path, "graceRefilledOnDay"),
    ),
    rainDays: expectFiniteNumber(rec["rainDays"], p(path, "rainDays")),
    rewardedForDay: expectNumberOrNull(rec["rewardedForDay"], p(path, "rewardedForDay")),
    pendingChoices: pendingRaw.map((choice, i) =>
      validateStreakChoice(choice, `${p(path, "pendingChoices")}[${i}]`),
    ),
  };
}

/** ROUND 2C — milestones (v6, bible §4). */
function validateMilestoneState(value: unknown, path: string): MilestoneState {
  const rec = expectRecord(value, path);
  return {
    earned: validateNumberRecord(rec["earned"], p(path, "earned")),
    pendingCelebrations: validateStringArray(
      rec["pendingCelebrations"],
      p(path, "pendingCelebrations"),
    ),
  };
}

/** ROUND 2C — daily bounties (v6, bible §5.1). */
function validateBountyInstance(value: unknown, path: string): BountyInstance {
  const rec = expectRecord(value, path);
  return {
    templateId: expectString(rec["templateId"], p(path, "templateId")),
    slot: expectFiniteNumber(rec["slot"], p(path, "slot")),
    target: expectFiniteNumber(rec["target"], p(path, "target")),
    progress: expectFiniteNumber(rec["progress"], p(path, "progress")),
    completedAt: expectNumberOrNull(rec["completedAt"], p(path, "completedAt")),
    rerolled: expectBoolean(rec["rerolled"], p(path, "rerolled")),
    params: (() => {
      const paramsRec = expectRecord(rec["params"], p(path, "params"));
      const out: Record<string, string> = {};
      for (const [key, entry] of Object.entries(paramsRec)) {
        out[key] = expectString(entry, p(p(path, "params"), key));
      }
      return out;
    })(),
    stale: expectBoolean(rec["stale"], p(path, "stale")),
  };
}

function validateBountiesState(value: unknown, path: string): BountiesState {
  const rec = expectRecord(value, path);
  const slotsRaw = rec["slots"];
  if (!Array.isArray(slotsRaw)) {
    fail("invalid-field", p(path, "slots"), `expected an array, got ${describeValue(slotsRaw)}`);
  }
  return {
    day: expectNumberOrNull(rec["day"], p(path, "day")),
    slots: slotsRaw.map((slot, i) => validateBountyInstance(slot, `${p(path, "slots")}[${i}]`)),
    rerollsUsed: expectFiniteNumber(rec["rerollsUsed"], p(path, "rerollsUsed")),
    dayBonusGranted: expectBoolean(rec["dayBonusGranted"], p(path, "dayBonusGranted")),
  };
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

  // Reveal pips must exist (same referential bar as rosterOrder — the
  // acknowledge path resolves them).
  const pendingReveals = validatePendingReveals(
    rec["pendingReveals"],
    p(path, "pendingReveals"),
  );
  pendingReveals.forEach((reveal, i) => {
    if (pips[reveal.pipId] === undefined) {
      fail(
        "invalid-field",
        `${p(path, "pendingReveals")}[${i}].pipId`,
        `reveal references unknown pip ${JSON.stringify(reveal.pipId)}`,
      );
    }
  });

  // Jobs are doubly referential: the working pip must exist, and the
  // station placement must still be on the grid (same bar as roster).
  const keep = validateKeep(rec["keep"], p(path, "keep"));
  const jobs = validateJobs(rec["jobs"], p(path, "jobs"));
  for (const [pipId, job] of Object.entries(jobs)) {
    if (pips[pipId] === undefined) {
      fail(
        "invalid-field",
        p(p(path, "jobs"), pipId),
        `job references unknown pip ${JSON.stringify(pipId)}`,
      );
    }
    if (keep.placements[job.stationPlacementId] === undefined) {
      fail(
        "invalid-field",
        p(p(p(path, "jobs"), pipId), "stationPlacementId"),
        `job references unknown placement ${JSON.stringify(job.stationPlacementId)}`,
      );
    }
  }

  // ROUND 2C — THE ONE-PLACE INVARIANT (bible §2.6/§14 risk 3): every
  // PipId lives in EXACTLY ONE of `pips` or `sanctuary.pips`. Never both.
  // ("Never neither" isn't independently checkable from a static blob —
  // an id simply absent from both never appears in this save at all —
  // but a hand-edited or corrupted save putting the SAME id in both is
  // exactly the double-render/double-decay bug the bible calls the
  // sharpest new failure mode in the round, so it is worth catching here
  // too, not just in the reducer's randomised property test.)
  const sanctuary = validateSanctuaryState(rec["sanctuary"], p(path, "sanctuary"));
  for (const pipId of Object.keys(sanctuary.pips)) {
    if (pips[pipId] !== undefined) {
      fail(
        "invalid-field",
        p(p(p(path, "sanctuary"), "pips"), pipId),
        `pip ${JSON.stringify(pipId)} exists in BOTH the active roster and the Long Meadow`,
      );
    }
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
    keep,
    jobs,
    rosterUpgradePurchased: expectBoolean(
      rec["rosterUpgradePurchased"],
      p(path, "rosterUpgradePurchased"),
    ),
    eggs: validateEggs(rec["eggs"], p(path, "eggs")),
    pendingReveals,
    nextPipNumber: expectFiniteNumber(
      rec["nextPipNumber"],
      p(path, "nextPipNumber"),
    ),
    nextEggNumber: expectFiniteNumber(
      rec["nextEggNumber"],
      p(path, "nextEggNumber"),
    ),
    nextPlacementNumber: expectFiniteNumber(
      rec["nextPlacementNumber"],
      p(path, "nextPlacementNumber"),
    ),
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
    lastAssignOutcome: passThroughTransient(
      rec["lastAssignOutcome"],
      p(path, "lastAssignOutcome"),
    ) as AssignExpeditionOutcome | null,
    lastHatchOutcome: passThroughTransient(
      rec["lastHatchOutcome"],
      p(path, "lastHatchOutcome"),
    ) as HatchOutcome | null,
    lastJobOutcome: passThroughTransient(
      rec["lastJobOutcome"],
      p(path, "lastJobOutcome"),
    ) as JobOutcome | null,
    lastEvolveOutcome: passThroughTransient(
      rec["lastEvolveOutcome"],
      p(path, "lastEvolveOutcome"),
    ) as EvolveOutcome | null,
    onboarding: validateOnboarding(rec["onboarding"], p(path, "onboarding")),
    // ROUND 2C (v6, docs/retention-bible.md §1/§2/§11). `sanctuary` was
    // already parsed above (the one-place invariant cross-check needs it
    // alongside `pips`).
    pipdex: validatePipdexState(rec["pipdex"], p(path, "pipdex")),
    sanctuary,
    lastSanctuaryOutcome: passThroughTransient(
      rec["lastSanctuaryOutcome"],
      p(path, "lastSanctuaryOutcome"),
    ) as SanctuaryOutcome | null,
    // ROUND 2C (v6, docs/retention-bible.md §11) — the progression stack.
    streak: validateStreakState(rec["streak"], p(path, "streak")),
    dayOffsetMs: expectFiniteNumber(rec["dayOffsetMs"], p(path, "dayOffsetMs")),
    counters: validateNumberRecord(rec["counters"], p(path, "counters")),
    milestones: validateMilestoneState(rec["milestones"], p(path, "milestones")),
    bounties: validateBountiesState(rec["bounties"], p(path, "bounties")),
    eggPity: validateNumberRecord(rec["eggPity"], p(path, "eggPity")),
    activeEvents: validateStringArray(rec["activeEvents"], p(path, "activeEvents")),
    keepsakes: validateNumberRecord(rec["keepsakes"], p(path, "keepsakes")),
    // v7: earned flair (docs/retention-bible.md §4.3). Strictly required —
    // `MIGRATIONS[6]` seeds it for every v6 save, so a blob reaching here
    // without it is genuinely malformed, not merely old.
    flair: validateNumberRecord(rec["flair"], p(path, "flair")),
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
