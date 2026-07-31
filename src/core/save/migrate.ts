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
import { createEmptyPipdex, markCaught, markSeen, markVariantCaught } from "../pipdex";
import type { PipdexPortrait, PipdexState } from "../pipdex";
import { createEmptySanctuary } from "../sanctuary";
import { expeditions as contentExpeditions } from "../../content/expeditions";
import type { LifeStage } from "../pips/types";
// ROUND 2C — PROGRESSION (docs/retention-bible.md, merged into the SAME
// v5→v6 step as the Album/Long Meadow above — one version bump, per the
// orchestrator's instruction to coordinate rather than double-bump). The
// FLAIR field arrived later, in review, and needed v7 of its own because v6
// saves already existed by then — see MIGRATIONS[6].
import { createEmptyStreak } from "../progression/streak";
import { createEmptyMilestones, grantFounderMilestone } from "../progression/milestones";
import { createEmptyBounties } from "../progression/bounties";
import { tuning as contentTuning } from "../../content/tuning";
// ROUND 2F — THE PROGRESSION SPINE (docs/progression-bible.md §8.4): the
// v7 → v8 `keepXp` backfill reads milestone `xp` values, the same content
// registry `core/state.ts`'s CLAIM_MILESTONE arm reads.
import { MILESTONES as contentMilestones } from "../../content/milestones";
import { masteryTier } from "../progression/mastery";
// ROUND 2D — INDIVIDUAL NAMES (docs/BACKLOG.md "Round 2D" item 1): the
// v9 → v10 step's own migration-only RNG draw + the species registry it
// reads to detect "still carrying a bare species name".
import { createRng } from "../rng";
import { rollPipName } from "../pips/genome";
import { species as contentSpecies } from "../../content/species";

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
/**
 * v5 → v6 Album backfill (docs/retention-bible.md §11.3): "never backfill
 * a counter above the truth, never below what is provable." For every
 * pip already owned, mark its LIVE species caught at `hatchedAt` with a
 * portrait frozen from its genome/name; a shiny genome sets the shiny
 * stamp; an already-evolved pip's variant leaf lands on its BIRTH
 * species' page (`genome.speciesId` — the immutable record, since the
 * live `speciesId` already flipped). Then mark "seen" for every species
 * in the egg pool of every expedition already unlocked at the save's
 * Keep level (bible: "a slight over-grant of seen... costs nothing").
 *
 * Defensive throughout: a pre-v6 blob is not yet validated, so every read
 * degrades to a safe default rather than throwing — a genuinely corrupt
 * field surfaces at the final `fromSaveBlob` validation, same as every
 * other migration step.
 */
function derivePipdex(pipsRaw: unknown, keepLevel: number, at: number): PipdexState {
  let pipdex = createEmptyPipdex();
  if (isPlainRecord(pipsRaw)) {
    for (const [pipId, pipValue] of Object.entries(pipsRaw)) {
      if (!isPlainRecord(pipValue)) continue;
      const speciesId = pipValue["speciesId"];
      const genomeValue = pipValue["genome"];
      if (typeof speciesId !== "string" || !isPlainRecord(genomeValue)) continue;

      const hatchedAt =
        typeof pipValue["hatchedAt"] === "number" ? pipValue["hatchedAt"] : at;
      const name = typeof pipValue["name"] === "string" ? pipValue["name"] : speciesId;
      const personalityId =
        typeof pipValue["personalityId"] === "string" ? pipValue["personalityId"] : "";
      const lifeStageAtCatch: LifeStage =
        pipValue["lifeStage"] === "pipling" ? "pipling" : "adult";
      const birthSpeciesId =
        typeof genomeValue["speciesId"] === "string"
          ? genomeValue["speciesId"]
          : speciesId;

      const portrait: PipdexPortrait = {
        pipId,
        name,
        genome: {
          speciesId: birthSpeciesId,
          palette: typeof genomeValue["palette"] === "string" ? genomeValue["palette"] : "",
          pattern: typeof genomeValue["pattern"] === "string" ? genomeValue["pattern"] : "",
          personalityId:
            typeof genomeValue["personalityId"] === "string"
              ? genomeValue["personalityId"]
              : personalityId,
          shiny: genomeValue["shiny"] === true,
        },
        personalityId,
        lifeStageAtCatch,
        sourceExpeditionId: null,
      };

      pipdex = markCaught(pipdex, speciesId, hatchedAt, portrait);

      const evolved = pipValue["evolved"];
      if (isPlainRecord(evolved) && typeof evolved["variantId"] === "string") {
        const evolvedAt =
          typeof evolved["evolvedAt"] === "number" ? evolved["evolvedAt"] : hatchedAt;
        pipdex = markVariantCaught(pipdex, birthSpeciesId, evolved["variantId"], evolvedAt);
      }
    }
  }

  for (const expedition of Object.values(contentExpeditions)) {
    if (expedition.unlockKeepLevel > keepLevel) continue;
    for (const speciesId of expedition.eggSpecies ?? []) {
      pipdex = markSeen(pipdex, speciesId, at, expedition.id);
    }
  }

  return pipdex;
}

/**
 * v5 → v6 progression-counter backfill (docs/retention-bible.md §11.3):
 * "never backfill a counter above the truth, never below what is
 * provable." Pre-v6 history is partly unknowable, so only the handful of
 * counters directly reconstructable from the save's OWN shape are
 * derived; everything else starts at 0 (a fresh save also starts every
 * counter at 0, so this is not a special case — it is the honest floor).
 */
function deriveCounters(pipsRaw: unknown): Record<string, number> {
  const pips = isPlainRecord(pipsRaw) ? Object.values(pipsRaw) : [];
  const rosterSize = pips.length;
  let evolutions = 0;
  for (const pip of pips) {
    if (isPlainRecord(pip) && pip["evolved"] !== null && pip["evolved"] !== undefined) {
      evolutions++;
    }
  }
  return {
    // Every roster pip but the original starter was, at minimum, hatched
    // from an egg (a provable lower bound, never the true count if any
    // roster slot changed hands via the Long Meadow — but never higher).
    eggsHatched: Math.max(0, rosterSize - 1),
    evolutions,
    // The player has visited at least once (this save exists).
    visitDays: 1,
  };
}

/**
 * v6 → v8 `keepXp` backfill (docs/progression-bible.md §8.4): "never above
 * the truth, never below what is provable" — the same rule the v6 Album
 * backfill (`derivePipdex` above) already follows.
 *
 *   keepXp = max(
 *     levelXp[keep.level − 1],           // you demonstrably REACHED this
 *                                        // tier (levelXp is 0-indexed by
 *                                        // tier − 1 — bible §1.1)
 *     4·careActions + 2·expeditionsTotal + 40·eggsHatched + 90·evolutions
 *       + 25·(distinct placed itemIds) + 15·bountiesCompleted
 *       + Σ xp of every milestone already in milestones.earned,
 *   )
 *
 * Both terms are provable from state that already exists; a veteran may
 * land several tiers' worth of XP at once (the `founder` precedent — a
 * GIFT, never a reset), and because tiers still require the player's own
 * tap (PURCHASE_KEEP_LEVEL's `needsXp` gate never fires itself), they get
 * a sequence of celebratory tier-up banners on their first session back,
 * each naming a real unlock. This function must NOT grant resources (the
 * `preLevel2WoodCap` guard) and must NOT auto-purchase a tier — it only
 * ever raises the number the bar reads, never the level itself.
 *
 * Defensive throughout, like every migration step: a pre-v8 blob is not
 * yet validated, so every read degrades to a safe default.
 */
function deriveKeepXp(state: Readonly<Record<string, unknown>>): number {
  const keepValue = state["keep"];
  const level =
    isPlainRecord(keepValue) && typeof keepValue["level"] === "number"
      ? keepValue["level"]
      : 1;
  const levelXp = contentTuning.progression.levelXp;
  const floor = levelXp[Math.max(0, level - 1)] ?? 0;

  const countersValue = state["counters"];
  const counters = isPlainRecord(countersValue) ? countersValue : {};
  const numCounter = (id: string): number => {
    const value = counters[id];
    return typeof value === "number" ? value : 0;
  };

  const placementsValue = isPlainRecord(keepValue) ? keepValue["placements"] : undefined;
  const distinctPlacedItemIds = isPlainRecord(placementsValue)
    ? new Set(
        Object.values(placementsValue)
          .filter(isPlainRecord)
          .map((placement) => placement["itemId"])
          .filter((id): id is string => typeof id === "string"),
      ).size
    : 0;

  const milestonesValue = state["milestones"];
  const earnedValue = isPlainRecord(milestonesValue) ? milestonesValue["earned"] : undefined;
  const earnedIds = isPlainRecord(earnedValue) ? Object.keys(earnedValue) : [];
  let milestoneXp = 0;
  for (const id of earnedIds) {
    const def = contentMilestones.find((m) => m.id === id);
    milestoneXp += def?.xp ?? 0;
  }

  const xp = contentTuning.progression.xp;
  const provable =
    xp.care * numCounter("careActions") +
    xp.expeditionSend * numCounter("expeditionsTotal") +
    xp.hatch * numCounter("eggsHatched") +
    xp.evolve * numCounter("evolutions") +
    xp.firstBuild * distinctPlacedItemIds +
    xp.bountyComplete * numCounter("bountiesCompleted") +
    milestoneXp;

  return Math.max(floor, Math.round(provable));
}

/**
 * Seed the round's three new idempotence key families (bible §1.1/§8.4)
 * so a migrated veteran's FIRST post-migration action never re-grants XP
 * for a build/job/mastery-tier the save already provably has: `built.
 * <itemId>` from every currently-placed item, `job.<jobId>` from every
 * standing assignment, `masteryTier.<pipId>.<biomeId>` from each Pip's
 * existing mastery trips (the highest tier those trips already reach).
 * No new schema field — `counters` is already a validated, forward-only
 * bag; these are just new keys in it.
 */
function deriveXpIdempotenceCounters(
  state: Readonly<Record<string, unknown>>,
): Record<string, number> {
  const counters: Record<string, number> = {};

  const keepValue = state["keep"];
  const placementsValue = isPlainRecord(keepValue) ? keepValue["placements"] : undefined;
  if (isPlainRecord(placementsValue)) {
    for (const placement of Object.values(placementsValue)) {
      if (!isPlainRecord(placement)) continue;
      const itemId = placement["itemId"];
      if (typeof itemId === "string") counters[`built.${itemId}`] = 1;
    }
  }

  const jobsValue = state["jobs"];
  if (isPlainRecord(jobsValue)) {
    for (const job of Object.values(jobsValue)) {
      if (!isPlainRecord(job)) continue;
      const jobId = job["jobId"];
      if (typeof jobId === "string") counters[`job.${jobId}`] = 1;
    }
  }

  const pipsValue = state["pips"];
  if (isPlainRecord(pipsValue)) {
    for (const [pipId, pip] of Object.entries(pipsValue)) {
      if (!isPlainRecord(pip)) continue;
      const masteryValue = pip["mastery"];
      if (!isPlainRecord(masteryValue)) continue;
      for (const [expeditionId, tripsValue] of Object.entries(masteryValue)) {
        if (typeof tripsValue !== "number") continue;
        const durationMs =
          (
            contentExpeditions as Readonly<Record<string, { durationMs: number }>>
          )[expeditionId]?.durationMs ?? 0;
        const tier = masteryTier(tripsValue, durationMs, contentTuning);
        if (tier > 0) counters[`masteryTier.${pipId}.${expeditionId}`] = tier;
      }
    }
  }

  return counters;
}

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

  /**
   * v2 → v3 (Phase 5, the Keep): the flat `keepLevel` becomes
   * `keep: { level, placements }` (level carried over, nothing placed
   * yet — placement did not exist before v3), plus the new empty/false
   * defaults: `jobs`, `rosterUpgradePurchased`, `nextPlacementNumber`,
   * a null `evolved` record on every pip (nothing could have evolved),
   * and the two new transient echoes starting null.
   */
  2: (blob) => {
    const out: Record<string, unknown> = { ...blob, schemaVersion: 3 };
    const state = blob["state"];
    if (isPlainRecord(state)) {
      const { keepLevel, ...rest } = state;
      const pips = state["pips"];
      const migratedPips = isPlainRecord(pips)
        ? Object.fromEntries(
            Object.entries(pips).map(([pipId, pip]) => [
              pipId,
              isPlainRecord(pip) ? { ...pip, evolved: null } : pip,
            ]),
          )
        : pips;
      out["state"] = {
        ...rest,
        pips: migratedPips,
        keep: {
          level: typeof keepLevel === "number" ? keepLevel : 1,
          placements: {},
        },
        jobs: {},
        rosterUpgradePurchased: false,
        nextPlacementNumber: 1,
        lastJobOutcome: null,
        lastEvolveOutcome: null,
      };
    }
    return out;
  },

  /**
   * v3 → v4 (Phase 6): three changes in ONE step —
   *
   * 1. Onboarding: existing saves have long outgrown the tutorial —
   *    `onboarding` arrives completed, so only genuinely fresh games
   *    (createNewGame) ever see the guided beats (spec §10.1).
   * 2. Berry dedupe: Berries are FOOD (the food registry is the routing
   *    rule, spec §6.3) — any `resources.berry` a pre-v4 Gathering job
   *    accrued moves into the inventory, merging with what's there.
   * 3. Genome `shiny`: pre-v4 genomes get the explicit default `false`
   *    (nothing hatched before v4 could have rolled it).
   */
  3: (blob) => {
    const out: Record<string, unknown> = { ...blob, schemaVersion: 4 };
    const state = blob["state"];
    if (isPlainRecord(state)) {
      const pips = state["pips"];
      const migratedPips = isPlainRecord(pips)
        ? Object.fromEntries(
            Object.entries(pips).map(([pipId, pip]) => {
              if (!isPlainRecord(pip)) return [pipId, pip];
              const genome = pip["genome"];
              return [
                pipId,
                isPlainRecord(genome)
                  ? { ...pip, genome: { shiny: false, ...genome } }
                  : pip,
              ];
            }),
          )
        : pips;

      let inventory = state["inventory"];
      let resources = state["resources"];
      if (isPlainRecord(resources) && typeof resources["berry"] === "number") {
        const { berry, ...rest } = resources;
        resources = rest;
        const held =
          isPlainRecord(inventory) && typeof inventory["berry"] === "number"
            ? inventory["berry"]
            : 0;
        inventory = {
          ...(isPlainRecord(inventory) ? inventory : {}),
          berry: held + berry,
        };
      }

      out["state"] = {
        ...state,
        pips: migratedPips,
        inventory,
        resources,
        onboarding: { completed: true, step: "done" },
      };
    }
    return out;
  },

  /**
   * v4 → v5 (round 2A finding #2): per-pip `sulking: boolean` — the
   * Sulking penalty becomes an orthogonal flag alongside `activity`
   * instead of solely the `activity === "sulking"` value, so "Resting
   * AND still sulking" is representable (see `core/pips/machine.ts`
   * module doc). A pre-v5 save's ENTIRE Sulking state lived in
   * `activity`, so that is the one faithful source to derive from: a pip
   * saved mid-Sulk gets `sulking: true`; every other pip (including one
   * napping for unrelated reasons — the pre-v5 model could not have
   * recorded "sulking while Resting" in the first place) gets `false`.
   */
  4: (blob) => {
    const out: Record<string, unknown> = { ...blob, schemaVersion: 5 };
    const state = blob["state"];
    if (isPlainRecord(state)) {
      const pips = state["pips"];
      const migratedPips = isPlainRecord(pips)
        ? Object.fromEntries(
            Object.entries(pips).map(([pipId, pip]) => {
              if (!isPlainRecord(pip)) return [pipId, pip];
              return [pipId, { ...pip, sulking: pip["activity"] === "sulking" }];
            }),
          )
        : pips;
      out["state"] = { ...state, pips: migratedPips };
    }
    return out;
  },

  /**
   * v5 → v6 (round 2C, docs/retention-bible.md §11): TWO agents' work
   * merged into this ONE version bump (coordinated per the orchestrator's
   * instruction — do not double-bump the schema version):
   *
   * - `pipdex` (the Album, §1) and `sanctuary` (the Long Meadow, §2), plus
   *   the matching transient echo. `sanctuary` seeds empty — nothing could
   *   have been retired before this round shipped — `pipdex` is DERIVED
   *   from the existing save so a veteran never loses credit for Pips
   *   they already own (see `derivePipdex` above).
   * - The PROGRESSION stack (streak/milestones/bounties/counters/eggPity/
   *   dayOffsetMs/activeEvents/keepsakes): `streak` arrives with FULL
   *   GRACE (bible §11.1 — "full grace on arrival"), `counters` derives
   *   the handful of provable lower bounds (`deriveCounters`, §11.3's
   *   "never above the truth" rule), and a returning v5 player is granted
   *   the one-time hidden `founder` milestone (§11.3 — "an
   *   apology-in-flair for the history the save cannot prove... a GIFT,
   *   never a reset"). Everything else seeds empty, exactly like a fresh
   *   `createNewGame`.
   */
  5: (blob) => {
    const out: Record<string, unknown> = { ...blob, schemaVersion: 6 };
    const state = blob["state"];
    if (isPlainRecord(state)) {
      const keepLevel =
        isPlainRecord(state["keep"]) && typeof state["keep"]["level"] === "number"
          ? state["keep"]["level"]
          : 1;
      const at = typeof blob["savedAt"] === "number" ? blob["savedAt"] : 0;
      out["state"] = {
        ...state,
        pipdex: derivePipdex(state["pips"], keepLevel, at),
        sanctuary: createEmptySanctuary(),
        lastSanctuaryOutcome: null,
        streak: createEmptyStreak(contentTuning),
        dayOffsetMs: 0,
        counters: deriveCounters(state["pips"]),
        milestones: grantFounderMilestone(createEmptyMilestones(), at),
        bounties: createEmptyBounties(),
        eggPity: {},
        activeEvents: [],
        keepsakes: {},
      };
    }
    return out;
  },

  /**
   * v6 → v7: EARNED FLAIR (docs/retention-bible.md §4.3).
   *
   * Round 2C shipped 22 `kind: "flair"` milestone rewards against no state
   * field, no serializer entry and no renderer, so every long-haul target in
   * the game paid literally nothing. `GameState.flair` (`flairId → earnedAt`)
   * is the fix, and it needs its own version because v6 saves already exist.
   *
   * The one seeded entry: a v5 veteran was granted the hidden `founder`
   * milestone by the step above, and that milestone's reward IS a flourish
   * (`album-founder-stamp`). Granting the milestone without the flair would
   * make the apology-in-flair the last remaining place where flair paid
   * nothing — so it is read back off `milestones.earned` here (whatever route
   * the save took to v6) and stamped into the Album's cover.
   *
   * Forward-only, like every other flair grant: nothing removes an entry.
   */
  6: (blob) => {
    const out: Record<string, unknown> = { ...blob, schemaVersion: 7 };
    const state = blob["state"];
    if (isPlainRecord(state)) {
      const flair: Record<string, number> = {};
      const milestones = state["milestones"];
      const earned = isPlainRecord(milestones) ? milestones["earned"] : undefined;
      const founderAt = isPlainRecord(earned) ? earned["founder"] : undefined;
      if (typeof founderAt === "number") {
        flair["album-founder-stamp"] = founderAt;
      }
      out["state"] = { ...state, flair };
    }
    return out;
  },

  /**
   * v7 → v8 (round 2F — docs/progression-bible.md §8.4): THE PROGRESSION
   * SPINE arrives. Two fields, the whole round's schema delta:
   *
   * - `keepXp` — derived generously (`deriveKeepXp` above), never above
   *   the truth, never below what is provable. Grants no resources, does
   *   not auto-purchase a tier.
   * - `Placement.granted` needs no migration at all: it is OPTIONAL
   *   (`undefined ≡ false`, same as `sulking`/`mastery`), so every
   *   existing placement round-trips untouched with the field simply
   *   absent — exactly the point of making it optional.
   */
  7: (blob) => {
    const out: Record<string, unknown> = { ...blob, schemaVersion: 8 };
    const state = blob["state"];
    if (isPlainRecord(state)) {
      const priorCounters = isPlainRecord(state["counters"]) ? state["counters"] : {};
      out["state"] = {
        ...state,
        keepXp: deriveKeepXp(state),
        lastLevelUp: null,
        counters: { ...priorCounters, ...deriveXpIdempotenceCounters(state) },
      };
    }
    return out;
  },

  /**
   * v8 → v9 (round 2H — spec §16 v1.5, docs/lifecycle-bible.md §9.2): PER-PIP
   * LEVELS + LIFESPAN — this migration's slice of the round's ONE shared
   * schema bump.
   *
   * Every Pip already owned — active in `state.pips` AND resident in the
   * Long Meadow (`state.sanctuary.pips[*].pip`) — is granted:
   *
   *   - `level: migrationGrantLevel` (2) with `pipXp` set to EXACTLY that
   *     level's cumulative threshold (never a guess, never above what
   *     the curve says level 2 costs) — "a veteran's Pips arrive with a
   *     season already behind them", a small, provably safe thank-you
   *     (0.01 seasoning at level 2 — no balance guard moves).
   *   - `lifeMs: 0` / `readyToRetire: false` — a brand-new lifespan
   *     clock for every Pip, regardless of how long (by `ageMs`) they
   *     have already been played. The REJECTED alternative (deriving
   *     `lifeMs` from `ageMs`, even scaled) is recorded in this file's
   *     module doc and in serialize.ts: it would make a returning
   *     veteran's Pips closer to retirement than a new player's, which
   *     is exactly the punishment the brief forbids. `readyToRetire`
   *     follows from `lifeMs: 0` and is written explicitly so a
   *     round-trip through `serialize.ts` is byte-equal.
   *
   * Ailment/lineage/breeding fields (`ailment`, `scars`, `resistances`,
   * `generation`, `parentIds`, `lastBredAt`, `clutches`,
   * `GameState.lineageEggs`/`lastLossOutcome`/`settings`,
   * `SanctuaryRecord.reason`, `Egg.lineageGenome`/`lineageParentIds`) are
   * this SAME v9 bump's OTHER slices (docs/lifecycle-bible.md's ailments/
   * lineage/breeding work) and are not this step's concern — they are
   * all OPTIONAL fields with safe defaults (the same `undefined ≡`
   * contract this step's own fields use), so their absence here is not a
   * gap this step needs to fill.
   */
  8: (blob) => {
    const out: Record<string, unknown> = { ...blob, schemaVersion: 9 };
    const state = blob["state"];
    if (isPlainRecord(state)) {
      const grantLevel = contentTuning.lifecycle.level.migrationGrantLevel;
      const grantXp = contentTuning.lifecycle.level.levelXp[grantLevel - 1] ?? 0;

      const migratePip = (pip: unknown): unknown => {
        if (!isPlainRecord(pip)) return pip;
        return {
          ...pip,
          level: grantLevel,
          pipXp: grantXp,
          lifeMs: 0,
          readyToRetire: false,
        };
      };

      const pips = state["pips"];
      const migratedPips = isPlainRecord(pips)
        ? Object.fromEntries(
            Object.entries(pips).map(([pipId, pip]) => [pipId, migratePip(pip)]),
          )
        : pips;

      const sanctuary = state["sanctuary"];
      let migratedSanctuary = sanctuary;
      if (isPlainRecord(sanctuary) && isPlainRecord(sanctuary["pips"])) {
        const residents = Object.fromEntries(
          Object.entries(sanctuary["pips"]).map(([pipId, record]) => {
            if (!isPlainRecord(record)) return [pipId, record];
            return [pipId, { ...record, pip: migratePip(record["pip"]) }];
          }),
        );
        migratedSanctuary = { ...sanctuary, pips: residents };
      }

      out["state"] = { ...state, pips: migratedPips, sanctuary: migratedSanctuary };
    }
    return out;
  },

  /**
   * v9 → v10 (round 2D — docs/BACKLOG.md "Round 2D — Pip identity &
   * variety" item 1, spec §7.1/§7.3 amended): INDIVIDUAL NAMES.
   *
   * Every Pip already owned — active AND resident in the Long Meadow —
   * that is STILL CARRYING A BARE SPECIES DISPLAY NAME
   * (`createPipFromGenome` used to default every hatch's name to
   * `contentSpecies[speciesId].name`, so "the name equals SOME species'
   * display name" is the exact, structural "never got an individual
   * name" tell) is OFFERED a real one, rolled deterministically from a
   * dedicated migration-only stream seeded off the save's own `seed`.
   * Matched against EVERY species in the registry, not just the Pip's own
   * live `speciesId` — a Pip that evolved after hatching keeps its BIRTH
   * species' name untouched (e.g. a Grovepip still named "Mosspip"), and
   * that still counts as "never renamed". A Pip whose name is anything
   * else — including a name a PLAYER already typed that happens not to
   * match any species — is a real, chosen identity and is NEVER touched
   * (the player-rename guarantee: "a player-renamed Pip is never
   * touched").
   *
   * The migration stream is NOT persisted into `rngState` — this is a
   * ONE-TIME backfill over already-serialized data, not a live gameplay
   * roll, so it needs no cursor to resume from (`rollPipName`'s own doc
   * comment: the live equivalent, `NAME_STREAM`, is used ONLY by
   * `createNewGame`/`HATCH_EGG`, never here).
   *
   * Dedup ("avoid duplicate names against the roster + Long Meadow +
   * Album at roll time", item 3): seeded with every name already frozen
   * into the Album's `firstPortrait`s (read-only — Album portraits are
   * NEVER touched by this step, matching how `RENAME_PIP` never touches
   * them at live gameplay either), then every pip is visited in a fixed
   * order (roster, then Long Meadow) with each pip's resulting name — kept
   * or freshly rolled — added to the used set before the next pip is
   * considered, so the SAME fixture always migrates to the SAME names and
   * two Pips needing a name in the same save never collide with each
   * other.
   *
   * `TraitGenome.accessoryId` (this SAME v10 bump's other slice, round
   * 2D item 3's data half) needs no migration at all — it is OPTIONAL
   * (`undefined ≡ never rolled`, the `sulking`/`mastery` precedent), so
   * every existing genome round-trips untouched with the field simply
   * absent (`serialize.ts`'s own module doc for v10).
   */
  9: (blob) => {
    const out: Record<string, unknown> = { ...blob, schemaVersion: 10 };
    const state = blob["state"];
    if (!isPlainRecord(state)) return out;

    const seedValue = state["seed"];
    const seed = typeof seedValue === "number" ? seedValue : 0;
    const rng = createRng(seed).stream("migration-name-v10");

    const usedNames = new Set<string>();
    const pipdexValue = state["pipdex"];
    const entriesValue = isPlainRecord(pipdexValue) ? pipdexValue["entries"] : undefined;
    if (isPlainRecord(entriesValue)) {
      for (const entry of Object.values(entriesValue)) {
        if (!isPlainRecord(entry)) continue;
        const portrait = entry["firstPortrait"];
        if (isPlainRecord(portrait) && typeof portrait["name"] === "string") {
          usedNames.add(portrait["name"]);
        }
      }
    }

    const speciesNames = new Set(Object.values(contentSpecies).map((def) => def.name));

    const migratePip = (pip: unknown): unknown => {
      if (!isPlainRecord(pip)) return pip;
      const name = pip["name"];
      if (typeof name !== "string") return pip;
      if (!speciesNames.has(name)) {
        usedNames.add(name);
        return pip;
      }
      const rolled = rollPipName(rng, usedNames);
      usedNames.add(rolled);
      return { ...pip, name: rolled };
    };

    const pips = state["pips"];
    const migratedPips = isPlainRecord(pips)
      ? Object.fromEntries(
          Object.entries(pips).map(([pipId, pip]) => [pipId, migratePip(pip)]),
        )
      : pips;

    const sanctuary = state["sanctuary"];
    let migratedSanctuary = sanctuary;
    if (isPlainRecord(sanctuary) && isPlainRecord(sanctuary["pips"])) {
      const residents = Object.fromEntries(
        Object.entries(sanctuary["pips"]).map(([pipId, record]) => {
          if (!isPlainRecord(record)) return [pipId, record];
          return [pipId, { ...record, pip: migratePip(record["pip"]) }];
        }),
      );
      migratedSanctuary = { ...sanctuary, pips: residents };
    }

    out["state"] = { ...state, pips: migratedPips, sanctuary: migratedSanctuary };
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
