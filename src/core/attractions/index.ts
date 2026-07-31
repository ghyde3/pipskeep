/**
 * ATTRACTIONS (round 2K, docs/liveliness-bible.md §1-§3) — placeables that
 * draw WILD PIPS to the Keep over time: a third succession path alongside
 * lineage eggs and breeding (both round 2H), and the first recurring
 * resource sink whose largest component is wood (round 2J's named
 * unsolvable, docs/economy-bible.md §5).
 *
 * THE SHAPE (bible §1.0): a placement whose content item carries an
 * `"attraction"` building effect (`{kind:"attraction", biomeId}` — a
 * capability living in the SAME vocabulary as `job`, purely descriptive
 * there; this module owns the schedule and reads the registry directly,
 * exactly as `core/keep/jobs.ts` does for `job`). While it holds feed
 * (`state.attractionStock`), a wild Pip — of a species the player has
 * ALREADY CAUGHT, from the attraction's own biome — visits every
 * `visitIntervalMs` of RATED time, lingers `lingerMs`, and can be fed a
 * biome-correct snack up to `welcomeTrust` times (across separate visits)
 * to earn a welcome into the roster.
 *
 * THE THREE INVARIANTS (bible §0.3), each enforced structurally, not by
 * tuning, and each pinned by this module's own test suite:
 *
 * I1 — ATTRACTIONS MAY NOT ADVANCE THE ALBUM. `visitorPool` intersects a
 *   biome's `eggSpecies` with the caught set BEFORE a single roll is
 *   consumed (a partition, not a margin — the same guarantee round 2H
 *   gave breeding). A welcome never touches `state.pipdex` at all: the
 *   welcomed Pip's species, by construction, is already caught, so there
 *   is nothing for the Album to learn from it. An empty pool is INERT —
 *   zero stock consumed, zero rolls, schedule frozen — never a wasted
 *   build.
 * I2 — NOTHING HERE TOUCHES THE CARE ECONOMY. No function in this module
 *   reads or writes a need, a decay rate, a cooldown, an ailment chance,
 *   a cure chance, or a lifespan factor. `welcomeVisitor` grants a Pip at
 *   the SAME `arrivalNeeds` snapshot the Long Meadow's homecoming uses —
 *   read, never altered.
 * I3 — ABSENCE MAY COST A BONUS AND NOTHING ELSE. Visit scheduling rides
 *   the SAME offline rate cap every other rate obeys (§4.5) — no third
 *   clock. Trust is forward-only (2C §0.1's may-never-decrease table). A
 *   welcome/feed/restock refusal never mutates state, and a visitor who
 *   is never welcomed simply leaves (`now >= leavesAt`) with nothing
 *   lost — the SAME VisitorRecord is reused, unpenalised, on the next
 *   scheduled visit (bible §1.5: "the same visitor keeps coming back").
 *
 * RNG (spec §2 rule 3): exactly ONE new stream, `"visitors"` — used only
 * by `rollGenome`'s fixed 6-roll draw when a placement's VisitorRecord is
 * being rolled FRESH (no existing record to reuse). Naming uses the
 * EXISTING `NAME_STREAM` (`core/pips/genome.ts`, "every individual name
 * roll draws from this stream" — starters, hatchlings, and now visitors).
 * Both are skipped ENTIRELY (zero rolls of either) when the visitor pool
 * is empty or an existing record is being reused — I1's "zero rolls on
 * an empty pool" and the cursor-parity contract every sibling narrowing
 * (2B's biome pools, 2C's pity ladder) already relies on.
 *
 * CATCH-UP (spec §4.5, bible §1.5/§1.6): visit scheduling is a RATE, so
 * it rides `core/pips/catchup.ts`'s `extraEvents` seam capped at
 * `offlineRateCapMs` — the SAME cap job production already obeys, reused
 * rather than a third clock. Because the generic catch-up engine's
 * `CustomCatchupEvent.apply` has no RNG to thread through it (the SAME
 * constraint `core/keep/jobs.ts`'s `firedJobTicks` design answers),
 * catch-up visits are a TWO-PHASE process exactly like job ticks:
 *
 *   1. `collectAttractionCatchupEvents` — one event per attraction with
 *      due work, whose `apply` deterministically advances
 *      `attractionStock`/`attractionSchedule` and records a
 *      `firedAttractionVisits` marker. No roll happens here.
 *   2. `settleAttractionVisits` — called ONCE, after the whole pass, in
 *      fired (chronological) order: rolls/reuses each fired visit's
 *      VisitorRecord and applies THE HELD-OPEN RULE (bible §1.6): the
 *      visit is materialised at its own scheduled timestamp, but
 *      `leavesAt` is stamped to `returnAt + lingerMs` (`returnAt` = the
 *      moment the player actually returns), so a returning player ALWAYS
 *      finds someone freshly arrived, never mid-departure. Earlier due
 *      ticks inside the same window are silently folded into the stock
 *      consumed by the one that IS materialised — "written to state" only
 *      for the visit that is also "visible to the player" (spec §16
 *      v1.3's standing rule).
 *
 * The live path (`processAttractionVisits`, called from TICK) shares
 * BOTH phases: it computes due ticks the same way (uncapped — a live
 * dispatch's elapsed time is always tiny) and settles them through the
 * SAME `settleAttractionVisits`, so live and offline visits are rolled by
 * literally the same code.
 *
 * Purity: no clock, no `Math.random()` — `at`/`now` and every RngStream
 * are supplied by the caller (spec §2 rules 2-3). Content enters as
 * injectable structural views defaulting to content/ (the pattern used
 * across `core/`), and this module deliberately does NOT import
 * `content/buildingEffects.ts`'s `BuildingEffect` union or `core/pipdex`
 * directly — the attraction-effect lookup and the caught-species
 * predicate are both taken as plain structural/predicate parameters
 * (mirrors `core/progression/pity.ts`'s own "stays free of any Album
 * import" rule), so this file never needs to know the exact shape either
 * one lands in.
 */

import { tuning as contentTuning } from "../../content/tuning";
import { species as contentSpecies } from "../../content/species";
import { expeditions as contentExpeditions } from "../../content/expeditions";
import { placeables as contentPlaceables } from "../../content/placeables";
import { decorations as contentDecorations } from "../../content/decorations";
import { spend } from "../economy";
import type { ResourceBundle, ResourceCounts } from "../economy";
import { createRngFromState } from "../rng";
import type { Rng } from "../rng";
import { NAME_STREAM, createPipFromGenome, rollGenome, rollPipName } from "../pips/genome";
import type { GenomeSpeciesEntry, GenomeSpeciesRegistry } from "../pips/genome";
import { LifeStage } from "../pips/types";
import type { PipId, PipNeeds, PipState, TraitGenome } from "../pips/types";
import type { CatchupEvent, CatchupState } from "../pips/catchup";
import type { KeepState, PlacementId } from "../keep";

/** The one new RNG stream this round introduces (module doc). */
export const ATTRACTION_STREAM = "visitors";

/** Tag of the custom catch-up event one due (but not yet rolled) visit
 * fires through the `extraEvents` seam — mirrors `core/keep/jobs.ts`'s
 * `JOB_TICK_TAG`. */
export const ATTRACTION_VISIT_TAG = "attractionVisit";

// ---------------------------------------------------------------------------
// STRUCTURAL CONTENT VIEWS — deliberately independent of
// `content/buildingEffects.ts`'s `BuildingEffect` union (module doc): a
// widened `{kind: string}` shape reads any registry entry that carries an
// `effects` list, present or future, without this file needing to import
// that union's exact literal type.
// ---------------------------------------------------------------------------

/** One building effect, as this module needs to recognise the
 * `"attraction"` kind — a structural subset of `BuildingEffect`. */
export interface AttractionEffectLike {
  readonly kind: string;
  readonly biomeId?: string;
}

export interface AttractionItemView {
  readonly effects?: readonly AttractionEffectLike[];
}

export type AttractionItemRegistryView = Readonly<Record<string, AttractionItemView>>;

/** Placeables ∪ decorations (same merge `core/keep/effects.ts`'s own
 * `DEFAULT_ITEMS` uses) — an attraction is a placeable today, but nothing
 * here assumes that. */
const DEFAULT_ATTRACTION_ITEMS: AttractionItemRegistryView = (() => {
  const items: Record<string, AttractionItemView> = {};
  for (const def of contentPlaceables) items[def.id] = def;
  for (const def of contentDecorations) items[def.id] = def;
  return items;
})();

/** Structural view of one biome (`content/expeditions.ts`'s `ExpeditionDef`
 * satisfies this): the species pool an attraction's visitors draw from,
 * and the loot table that decides which foods count as "this biome's
 * own" for trust (bible §1.5: "a snack from THAT BIOME'S OWN loot
 * table"). */
export interface AttractionBiomeView {
  readonly eggSpecies?: readonly string[];
  readonly lootTable?: readonly { readonly itemId: string }[];
}

export type AttractionBiomeRegistryView = Readonly<Record<string, AttractionBiomeView>>;

const DEFAULT_BIOMES: AttractionBiomeRegistryView = contentExpeditions;

/** A caught-species predicate (bible I1) — a plain function so this module
 * never imports `core/pipdex` (module doc); `(id) =>
 * state.pipdex.entries[id]?.caughtAt != null` is the real caller. */
export type CaughtPredicate = (speciesId: string) => boolean;

/** The slice of tuning every function below reads (injectable, defaults to
 * `content/tuning.ts`'s `attractions` block). */
export interface AttractionsTuningSlice {
  readonly unlockKeepLevel: number;
  readonly visitIntervalMs: number;
  readonly lingerMs: number;
  /**
   * ⚠️ FIX STAGE — this IS enforced now, in core, by `visitorSlots` below.
   *
   * It shipped documented as "the RENDER layer's own display cap, not a
   * core state constraint" — and then no render code enforced it either,
   * so a Keep with all six attractions stocked and overdue materialised
   * SIX simultaneous visitors against a tuned maximum of two (measured,
   * three times the designed rate). That inflates the welcome rate — the
   * third succession path — past the pacing the collection guardrail
   * (§2) is argued from.
   *
   * Enforcing it in core rather than in the renderer is the choice that
   * keeps spec §16 v1.3 true: a cap applied only at draw time would leave
   * four visitors written to state that no player can ever see or
   * welcome. Capping presence itself means "in state" and "on screen"
   * are the same set by construction.
   *
   * A capped visit is NEVER lost: its stock is not spent and its schedule
   * is not advanced (`processAttractionVisits`), so it stays due and
   * arrives the moment a slot frees. That is what makes the cap a pacing
   * rule rather than a punishment for owning six attractions.
   */
  readonly maxConcurrentVisitors: number;
  /**
   * ⚠️ FIX STAGE — read by `settleAttractionVisits`, which used to apply
   * the held-open rule unconditionally, making this knob a lie to whoever
   * tuned it next. `false` now genuinely means "a visit that fired while
   * you were away has already ended by the time you get back"; `true`
   * (shipped) means the most recent one per attraction is held open to
   * `returnAt + lingerMs`. See bible §1.6.
   */
  readonly holdLastVisitOpen: boolean;
  readonly stockMax: number;
  readonly welcomeTrust: number;
  readonly trustPerSnack: number;
  readonly maxSnacksPerVisit: number;
  readonly welcomeCost: Readonly<Record<string, ResourceBundle>>;
  readonly restockCost: Readonly<Record<string, ResourceBundle>>;
  readonly visitorFedKeepXp: number;
  readonly welcomeKeepXp: number;
  readonly restockKeepXp: number;
}

export interface AttractionsTuning {
  readonly attractions: AttractionsTuningSlice;
}

/** Injectable content for every function in this module, defaulting to the
 * real registries/tuning (the pattern every `core/` module uses). */
export interface AttractionContent {
  readonly items?: AttractionItemRegistryView;
  readonly biomes?: AttractionBiomeRegistryView;
  readonly species?: GenomeSpeciesRegistry;
  readonly accessoryIds?: readonly string[];
  readonly tuning?: AttractionsTuning;
  /** A welcomed Pip's starting needs (bible §1.7: "needs at the shipped
   * arrivalNeeds") — defaults to the SAME snapshot the Long Meadow's
   * homecoming uses (`retention.sanctuary.arrivalNeeds`), read, never
   * altered (I2). */
  readonly arrivalNeeds?: PipNeeds;
}

function attractionTuningOf(content: AttractionContent): AttractionsTuningSlice {
  return (content.tuning ?? contentTuning).attractions;
}

// ---------------------------------------------------------------------------
// THE REGISTRY LOOKUP — mirrors `core/keep/jobs.ts`'s `jobForStationItem`.
// ---------------------------------------------------------------------------

/** The `biomeId` a placed item's `"attraction"` effect names, or
 * `undefined` when the item hosts no attraction at all. */
export function attractionBiomeIdFor(
  itemId: string,
  items: AttractionItemRegistryView = DEFAULT_ATTRACTION_ITEMS,
): string | undefined {
  return items[itemId]?.effects?.find((effect) => effect.kind === "attraction")
    ?.biomeId;
}

// ⚠️ FIX STAGE — `isAttractionItem` was deleted here. It was exported for
// "the Build-sheet / reachability predicate a peer's content/UI pass
// wants", and that peer never materialised: it finished the round with
// zero non-test consumers while every sibling export had three to eight.
// `ui/buildMode.ts` branches on the effect KIND directly (`case
// "attraction"`), which is the same information without a second name for
// it. Speculative API is the scope fence's failure mode wearing a
// helper's clothes; callers who want the predicate can write
// `attractionBiomeIdFor(id) !== undefined`, which is what this was.

// ---------------------------------------------------------------------------
// THE POOL (I1) — bible §1.3/§2.1.
// ---------------------------------------------------------------------------

/**
 * `biome.eggSpecies ∩ caught` (bible §1.3) — intersected BEFORE any roll
 * is consumed, so the pool can never contain a species the player has not
 * already caught. An empty pool (never visited the biome, or nothing
 * caught from it yet) is the natural, structural reason an attraction
 * produces nothing (I1).
 */
export function visitorPool(
  biomeId: string,
  isCaught: CaughtPredicate,
  biomes: AttractionBiomeRegistryView = DEFAULT_BIOMES,
): readonly string[] {
  return (biomes[biomeId]?.eggSpecies ?? []).filter(isCaught);
}

/** True when `foodId` is drawn from `biomeId`'s own loot table (bible
 * §1.5: only a biome-correct snack earns trust; anything else is still
 * accepted, per the tone rule "refusing a gift is not this game's
 * tone" — see `feedVisitor`). */
export function isBiomeFood(
  biomeId: string,
  foodId: string,
  biomes: AttractionBiomeRegistryView = DEFAULT_BIOMES,
): boolean {
  return (biomes[biomeId]?.lootTable ?? []).some((entry) => entry.itemId === foodId);
}

// ---------------------------------------------------------------------------
// THE VISITOR RECORD (bible §1.5/§7.1) — one per attraction placement,
// persisting between visits.
// ---------------------------------------------------------------------------

export interface VisitorRecord {
  readonly placementId: PlacementId;
  readonly speciesId: string;
  readonly name: string;
  readonly genome: TraitGenome;
  /** Clock ms of the CURRENT (or most recent) visit's scheduled arrival. */
  readonly arrivedAt: number;
  /** Derived-timer discipline (spec §6.1): presence is `now < leavesAt`,
   * never a stored boolean. */
  readonly leavesAt: number;
  /** Forward-only, 0..welcomeTrust and beyond (bible §1.5: "never decays,
   * never resets, never lost to absence" — 2C §0.1's may-never-decrease
   * table). */
  readonly trust: number;
  readonly fedThisVisit: boolean;
  readonly visits: number;
}

export type VisitorsByPlacement = Readonly<Record<PlacementId, VisitorRecord>>;
export type AttractionStockByPlacement = Readonly<Record<PlacementId, number>>;
/** Per-placement schedule baseline (mirrors `JobAssignment.lastProducedAt`):
 * the next visit is due at `baseline + visitIntervalMs`. Seeded at
 * placement time (`PLACE_ITEM`) and advanced only by ACTUALLY produced
 * visits — an attraction whose pool is empty leaves this untouched (I1:
 * inert, not merely unlucky). */
export type AttractionScheduleByPlacement = Readonly<Record<PlacementId, number>>;

/** One fired due-tick, recorded during a catch-up pass; the roll/reuse
 * itself happens AFTERWARDS via `settleAttractionVisits` (module doc —
 * the generic catch-up engine has no RNG to thread through
 * `CustomCatchupEvent.apply`, the same constraint
 * `core/keep/jobs.ts`'s `firedJobTicks` answers). */
export interface AttractionVisitTick {
  readonly placementId: PlacementId;
  readonly biomeId: string;
  /** The LAST due tick's own timestamp within the (possibly rate-capped)
   * window — `VisitorRecord.arrivedAt` is stamped from this. */
  readonly at: number;
  /** How many charges this tick consumed (collapses every earlier due
   * tick in the same window into the one that is materialised). */
  readonly ticksConsumed: number;
}

// ---------------------------------------------------------------------------
// ROLLING / REUSING ONE VISITOR — the only RNG-consuming step.
// ---------------------------------------------------------------------------

function narrowedSpeciesRegistry(
  pool: readonly string[],
  registry: GenomeSpeciesRegistry,
): Record<string, GenomeSpeciesEntry> {
  const narrowed: Record<string, GenomeSpeciesEntry> = {};
  for (const id of pool) {
    const entry = registry[id];
    if (entry !== undefined) narrowed[id] = entry;
  }
  return narrowed;
}

/**
 * Roll a brand-new visitor from `pool` (guaranteed non-empty by every
 * caller) — exactly 6 rolls on `ATTRACTION_STREAM` (`rollGenome`'s fixed
 * contract, narrowed to the pool, same cursor-parity mechanism 2B's biome
 * pools and 2C's pity ladder already rely on) plus exactly 1 roll on
 * `NAME_STREAM` (`rollPipName`, disjoint — never perturbs the
 * `"visitors"` cursor). 7 rolls total, the same shape a lineage-egg find
 * or an ordinary hatch already consumes.
 */
function rollFreshVisitor(
  rng: Rng,
  pool: readonly string[],
  usedNames: ReadonlySet<string>,
  content: AttractionContent,
): { readonly speciesId: string; readonly genome: TraitGenome; readonly name: string } {
  const registry = content.species ?? contentSpecies;
  const genome = rollGenome(rng.stream(ATTRACTION_STREAM), {
    species: narrowedSpeciesRegistry(pool, registry),
    accessoryIds: content.accessoryIds ?? [],
  });
  const name = rollPipName(rng.stream(NAME_STREAM), usedNames);
  return { speciesId: genome.speciesId, genome, name };
}

/**
 * Materialise one visit at `placementId`: REUSE the existing
 * VisitorRecord's genome/name (zero rolls — "the same visitor keeps
 * coming back", bible §1.5) when one exists, or ROLL a fresh one (exactly
 * 7 rolls, see `rollFreshVisitor`) when this is the first visit since the
 * record was last cleared (welcome, or the attraction was removed).
 * `at` is the SCHEDULED arrival moment; `leavesAt` here is the ordinary
 * `at + lingerMs` — catch-up's held-open extension is applied by the
 * caller (`settleAttractionVisits`) AFTER this returns, so this function
 * stays correct and independently testable on its own.
 */
function materializeVisit(
  existing: VisitorRecord | undefined,
  placementId: PlacementId,
  pool: readonly string[],
  at: number,
  lingerMs: number,
  rng: Rng,
  usedNames: ReadonlySet<string>,
  content: AttractionContent,
): VisitorRecord {
  if (existing !== undefined) {
    return {
      ...existing,
      arrivedAt: at,
      leavesAt: at + lingerMs,
      fedThisVisit: false,
      visits: existing.visits + 1,
    };
  }
  const rolled = rollFreshVisitor(rng, pool, usedNames, content);
  return {
    placementId,
    speciesId: rolled.speciesId,
    name: rolled.name,
    genome: rolled.genome,
    arrivedAt: at,
    leavesAt: at + lingerMs,
    trust: 0,
    fedThisVisit: false,
    visits: 1,
  };
}

// ---------------------------------------------------------------------------
// DUE-TICK ARITHMETIC — shared by the live and catch-up paths (one
// definition of "how many visits are due").
// ---------------------------------------------------------------------------

/** How many visit charges are due between `baseline` and `until`, capped
 * by `stock` (an attraction can never produce more visits than it has
 * feed for — the rest are simply never produced, I1/§1.4's "an attraction
 * at zero produces no visits"). */
function dueTicksFor(
  baseline: number,
  until: number,
  stock: number,
  intervalMs: number,
): number {
  if (intervalMs <= 0 || stock <= 0 || until <= baseline) return 0;
  const due = Math.floor((until - baseline) / intervalMs);
  return Math.min(due, stock);
}

// ---------------------------------------------------------------------------
// THE CONCURRENCY CAP — one definition of "is there room for another
// visitor", shared by the live and catch-up paths so they can never
// disagree about how crowded the Keep is.
// ---------------------------------------------------------------------------

/** The placements already hosting a present visitor at `at` — i.e. the
 * slots that are taken before any new tick is considered. */
function occupiedSlots(
  visitors: VisitorsByPlacement,
  at: number,
): Set<PlacementId> {
  const taken = new Set<PlacementId>();
  for (const [placementId, record] of Object.entries(visitors)) {
    if (visitorIsPresent(record, at)) taken.add(placementId);
  }
  return taken;
}

/** True when `placementId` may materialise a visit: either it already
 * holds the slot it is about to re-occupy, or a slot is genuinely free.
 * `max <= 0` is read as "uncapped" rather than "nobody ever visits" —
 * a mis-tuned zero must not silently delete the whole feature. */
function hasSlotFor(
  occupied: ReadonlySet<PlacementId>,
  placementId: PlacementId,
  max: number,
): boolean {
  if (max <= 0) return true;
  return occupied.has(placementId) || occupied.size < max;
}

// ---------------------------------------------------------------------------
// SETTLEMENT — rolls/reuses every fired tick, in order, applying the
// held-open rule. Shared by the live and catch-up paths.
// ---------------------------------------------------------------------------

export interface AttractionSettleState {
  readonly seed: number;
  readonly rngState: Readonly<Record<string, number>>;
  readonly visitors: VisitorsByPlacement;
}

/**
 * Roll/reuse every fired tick IN ORDER (the caller's array order — both
 * the live path and the catch-up path build it chronologically) and stamp
 * `leavesAt = returnAt + lingerMs` on each (bible §1.6's held-open rule:
 * `returnAt` is the moment the player/live-tick actually processes this,
 * so a returning player always finds someone freshly arrived). A pool
 * that has since gone empty (defensive only — I1 makes this practically
 * unreachable, since "caught" only grows) skips that tick with zero
 * rolls rather than crashing.
 */
export function settleAttractionVisits<S extends AttractionSettleState>(
  state: S,
  ticks: readonly AttractionVisitTick[],
  returnAt: number,
  isCaught: CaughtPredicate,
  usedNames: ReadonlySet<string> = new Set(),
  content: AttractionContent = {},
): S {
  if (ticks.length === 0) return state;
  const tuning = attractionTuningOf(content);
  const rng = createRngFromState(state.seed, state.rngState);
  const used = new Set(usedNames);
  let visitors = state.visitors;
  // ⚠️ THE CONCURRENCY CAP (see `maxConcurrentVisitors`' doc). The set is
  // seeded with everyone ALREADY standing in the Keep at `returnAt`, so a
  // tick can only claim a slot that is genuinely free. A placement already
  // in the set is re-occupying its OWN slot (the same visitor coming back
  // round), which never grows the crowd — that is why the guard is
  // "distinct placements", not "ticks processed".
  const occupied = occupiedSlots(visitors, returnAt);
  for (const tick of ticks) {
    // Checked BEFORE any roll, so a capped tick consumes exactly zero rng —
    // the same cursor-parity discipline the empty-pool skip below keeps.
    if (!hasSlotFor(occupied, tick.placementId, tuning.maxConcurrentVisitors)) continue;
    const pool = visitorPool(tick.biomeId, isCaught, content.biomes);
    if (pool.length === 0) continue; // defensive — see doc comment
    occupied.add(tick.placementId);
    const existing = visitors[tick.placementId];
    const record = materializeVisit(
      existing,
      tick.placementId,
      pool,
      tick.at,
      tuning.lingerMs,
      rng,
      used,
      content,
    );
    used.add(record.name);
    // ⚠️ THE HELD-OPEN RULE, now actually conditional on its own knob
    // (bible §1.6). `record.leavesAt` is the ordinary `tick.at + lingerMs`
    // `materializeVisit` stamped; holding open pushes it to
    // `returnAt + lingerMs` so a returning player always finds someone
    // freshly arrived rather than a Keep that emptied while they travelled.
    const leavesAt = tuning.holdLastVisitOpen ? returnAt + tuning.lingerMs : record.leavesAt;
    visitors = {
      ...visitors,
      [tick.placementId]: { ...record, leavesAt },
    };
  }
  return { ...state, visitors, rngState: rng.getState() };
}

// ---------------------------------------------------------------------------
// LIVE PATH (TICK) — mirrors `core/keep/jobs.ts`'s `processJobProduction`.
// ---------------------------------------------------------------------------

export interface AttractionStateSlice {
  readonly keep: KeepState;
  readonly seed: number;
  readonly rngState: Readonly<Record<string, number>>;
  readonly attractionStock: AttractionStockByPlacement;
  readonly attractionSchedule: AttractionScheduleByPlacement;
  readonly visitors: VisitorsByPlacement;
}

/**
 * LIVE production: every attraction placement with due work (deterministic
 * order — `Object.entries` preserves insertion order for non-numeric-like
 * placement ids such as `"place-3"`, the same iteration order
 * `resolveKeepEffects`/`findCollision` already rely on) gets its due
 * ticks collapsed into one materialised visit, settled via
 * `settleAttractionVisits` with `returnAt = at` (a live dispatch IS the
 * return moment). No-op (returns `state` unchanged) when nothing is due
 * anywhere — mirrors `processJobProduction`'s own early return.
 */
export function processAttractionVisits<S extends AttractionStateSlice>(
  state: S,
  at: number,
  isCaught: CaughtPredicate,
  usedNames: ReadonlySet<string> = new Set(),
  content: AttractionContent = {},
): S {
  const items = content.items ?? DEFAULT_ATTRACTION_ITEMS;
  const tuning = attractionTuningOf(content);

  let stock = state.attractionStock;
  let schedule = state.attractionSchedule;
  const ticks: AttractionVisitTick[] = [];
  // ⚠️ The cap is applied HERE as well as in `settleAttractionVisits`, and
  // the duplication is the point: settlement alone would let a capped
  // attraction spend its stock and advance its schedule for a visit that
  // never materialises — a player who owns six attractions would silently
  // burn feed on visitors they never meet. Deciding before the spend makes
  // a capped visit *deferred* instead of *lost*.
  const occupied = occupiedSlots(state.visitors, at);

  for (const [placementId, placement] of Object.entries(state.keep.placements)) {
    const biomeId = attractionBiomeIdFor(placement.itemId, items);
    if (biomeId === undefined) continue;

    const pool = visitorPool(biomeId, isCaught, content.biomes);
    if (pool.length === 0) continue; // I1 — inert, zero rolls

    const available = stock[placementId] ?? 0;
    const baseline = schedule[placementId] ?? at;
    const ticksToProcess = dueTicksFor(baseline, at, available, tuning.visitIntervalMs);
    if (ticksToProcess <= 0) continue;

    // No room: leave stock AND schedule untouched so this attraction stays
    // due and fires the moment a slot frees.
    if (!hasSlotFor(occupied, placementId, tuning.maxConcurrentVisitors)) continue;
    occupied.add(placementId);

    const visitAt = baseline + ticksToProcess * tuning.visitIntervalMs;
    stock = { ...stock, [placementId]: available - ticksToProcess };
    schedule = { ...schedule, [placementId]: visitAt };
    ticks.push({ placementId, biomeId, at: visitAt, ticksConsumed: ticksToProcess });
  }

  if (ticks.length === 0) return state;
  return settleAttractionVisits(
    { ...state, attractionStock: stock, attractionSchedule: schedule },
    ticks,
    at,
    isCaught,
    usedNames,
    content,
  );
}

// ---------------------------------------------------------------------------
// CATCH-UP PATH — mirrors `core/keep/jobs.ts`'s
// `collectJobCatchupEvents`/`firedJobTicks` pair exactly.
// ---------------------------------------------------------------------------

export interface AttractionCatchupState extends CatchupState {
  readonly keep: KeepState;
  readonly attractionStock: AttractionStockByPlacement;
  readonly attractionSchedule: AttractionScheduleByPlacement;
  /** Ticks that actually fired during THIS pass, in fired (chronological)
   * order — the reducer settles these AFTER the pass via
   * `settleAttractionVisits` (module doc). */
  readonly firedAttractionVisits: readonly AttractionVisitTick[];
}

export interface AttractionCatchupTuning extends AttractionsTuning {
  readonly offlineRateCapMs: number;
}

/**
 * Catch-up event collector for the `runCatchup` `extraEvents` seam (spec
 * §4.5 rule 1, bible §1.5: "rides the existing job-catch-up machinery").
 * One custom event per attraction with due work, CAPPED at the first
 * `offlineRateCapMs` of the absence (visit scheduling is a RATE — the
 * SAME cap job production obeys, I3's "no third clock"). Each event's
 * `apply` deterministically advances `attractionStock`/
 * `attractionSchedule` and records the fired tick; NO roll happens here
 * (see module doc for why) — `settleAttractionVisits` does that, once,
 * after the whole pass.
 */
export function collectAttractionCatchupEvents<S extends AttractionCatchupState>(
  state: S,
  windowStart: number,
  windowEnd: number,
  isCaught: CaughtPredicate,
  tuning: AttractionCatchupTuning = contentTuning,
  content: AttractionContent = {},
): CatchupEvent<S>[] {
  const items = content.items ?? DEFAULT_ATTRACTION_ITEMS;
  const cfg = tuning.attractions;
  const cappedEnd = Math.min(windowEnd, windowStart + tuning.offlineRateCapMs);

  const events: CatchupEvent<S>[] = [];
  for (const [placementId, placement] of Object.entries(state.keep.placements)) {
    const biomeId = attractionBiomeIdFor(placement.itemId, items);
    if (biomeId === undefined) continue;

    const pool = visitorPool(biomeId, isCaught, content.biomes);
    if (pool.length === 0) continue; // I1 — inert, zero rolls, nothing advances

    const available = state.attractionStock[placementId] ?? 0;
    const baseline = state.attractionSchedule[placementId] ?? windowStart;
    const ticksToProcess = dueTicksFor(baseline, cappedEnd, available, cfg.visitIntervalMs);
    if (ticksToProcess <= 0) continue;

    const visitAt = baseline + ticksToProcess * cfg.visitIntervalMs;
    events.push({
      kind: "custom",
      at: visitAt,
      tag: ATTRACTION_VISIT_TAG,
      apply: (s: S): S => {
        const currentStock = s.attractionStock[placementId] ?? 0;
        const consume = Math.min(ticksToProcess, currentStock);
        if (consume <= 0) return s;
        return {
          ...s,
          attractionStock: { ...s.attractionStock, [placementId]: currentStock - consume },
          attractionSchedule: { ...s.attractionSchedule, [placementId]: visitAt },
          firedAttractionVisits: [
            ...s.firedAttractionVisits,
            { placementId, biomeId, at: visitAt, ticksConsumed: consume },
          ],
        };
      },
    });
  }
  return events;
}

// ---------------------------------------------------------------------------
// THE VISIT CARD ACTIONS — feed, welcome, restock (bible §1.5/§1.7/§1.4).
// ---------------------------------------------------------------------------

/** True presence — derived, never stored (spec §6.1's timer discipline). */
export function visitorIsPresent(record: VisitorRecord | undefined, at: number): boolean {
  return record !== undefined && at < record.leavesAt;
}

// --- FEED_VISITOR --------------------------------------------------------

export type FeedVisitorRefusalReason = "unknownAttraction" | "noVisitor" | "insufficientItem";

export type FeedVisitorOutcome =
  | {
      readonly action: "feedVisitor";
      readonly ok: true;
      readonly placementId: PlacementId;
      readonly foodId: string;
      readonly at: number;
      /** Whether this snack was biome-correct, not-yet-fed-this-visit,
       * and therefore actually moved trust (bible §1.5: "once per
       * visit"; a snack from elsewhere or a second one is still
       * accepted — "refusing a gift is not this game's tone" — it just
       * earns nothing). */
      readonly trustGained: boolean;
    }
  | {
      readonly action: "feedVisitor";
      readonly ok: false;
      readonly placementId: PlacementId;
      readonly foodId: string;
      readonly at: number;
      readonly reason: FeedVisitorRefusalReason;
    };

export interface FeedVisitorHostState {
  readonly keep: KeepState;
  readonly visitors: VisitorsByPlacement;
  readonly inventory: Readonly<Record<string, number>>;
}

export interface FeedVisitorResult<S> {
  readonly state: S;
  readonly outcome: FeedVisitorOutcome;
}

/**
 * "Offer a snack" (bible §1.5). Always consumes the item when one exists
 * (an actual gift, mirroring spec §5 Feed's own "consumes inventory
 * item"); only a biome-correct snack, on a visit that has not already
 * been fed, moves trust — capped at `maxSnacksPerVisit` fed-events per
 * visit (today always 1). Structural refusals (nothing to feed, nothing
 * owned) leave state unchanged by reference.
 */
export function feedVisitor<S extends FeedVisitorHostState>(
  state: S,
  placementId: PlacementId,
  foodId: string,
  at: number,
  content: AttractionContent = {},
): FeedVisitorResult<S> {
  const refuse = (reason: FeedVisitorRefusalReason): FeedVisitorResult<S> => ({
    state,
    outcome: { action: "feedVisitor", ok: false, placementId, foodId, at, reason },
  });

  const items = content.items ?? DEFAULT_ATTRACTION_ITEMS;
  const tuning = attractionTuningOf(content);
  const placement = state.keep.placements[placementId];
  const biomeId = placement !== undefined ? attractionBiomeIdFor(placement.itemId, items) : undefined;
  if (biomeId === undefined) return refuse("unknownAttraction");

  const record = state.visitors[placementId];
  if (!visitorIsPresent(record, at)) return refuse("noVisitor");
  const present = record as VisitorRecord;

  const owned = state.inventory[foodId] ?? 0;
  if (owned < 1) return refuse("insufficientItem");

  const eligible =
    !present.fedThisVisit &&
    tuning.maxSnacksPerVisit > 0 &&
    isBiomeFood(biomeId, foodId, content.biomes);
  const nextRecord: VisitorRecord = eligible
    ? { ...present, trust: present.trust + tuning.trustPerSnack, fedThisVisit: true }
    : present;

  return {
    state: {
      ...state,
      inventory: { ...state.inventory, [foodId]: owned - 1 },
      visitors: { ...state.visitors, [placementId]: nextRecord },
    },
    outcome: { action: "feedVisitor", ok: true, placementId, foodId, at, trustGained: eligible },
  };
}

// --- WELCOME_VISITOR ------------------------------------------------------

export type WelcomeVisitorRefusalReason =
  | "unknownAttraction"
  | "noVisitor"
  | "trustTooLow"
  | "rosterFull"
  | "insufficientResources";

export type WelcomeVisitorOutcome =
  | {
      readonly action: "welcomeVisitor";
      readonly ok: true;
      readonly placementId: PlacementId;
      readonly pipId: PipId;
      readonly at: number;
    }
  | {
      readonly action: "welcomeVisitor";
      readonly ok: false;
      readonly placementId: PlacementId;
      readonly at: number;
      readonly reason: WelcomeVisitorRefusalReason;
    };

export interface WelcomeVisitorHostState {
  readonly keep: KeepState;
  readonly visitors: VisitorsByPlacement;
  readonly resources: ResourceCounts;
  readonly pips: Readonly<Record<PipId, PipState>>;
  readonly rosterOrder: readonly PipId[];
}

export interface WelcomeVisitorResult<S> {
  readonly state: S;
  readonly outcome: WelcomeVisitorOutcome;
}

/**
 * "Ask them to stay" (bible §1.7). Consumes NO rng roll at all — the
 * welcomed Pip's genome/name were already rolled when the visitor was
 * materialised (module doc), so a welcome is cheap and touches neither
 * the `"visitors"` nor the `"pip-name"` cursor. Refusals, in order:
 * unknown/removed attraction, nobody present, trust below
 * `welcomeTrust`, roster at cap (WARM and NON-DESTRUCTIVE — trust and the
 * visitor are both untouched, bible §1.7: "they wait, forever"), short on
 * the biome's `welcomeCost`. On success the visitor's record is CLEARED
 * (bible §1.5: "the next visit rolls a fresh one") and a full Pip enters
 * the roster at level 1 (`undefined` level/pipXp default to exactly
 * that), generation 0 (a stranger — no family to inherit from,
 * `pips/types.ts`'s `generation` precedent: `undefined ≡ 1`, so this is
 * set EXPLICITLY), Adult (a wild Pip was never anyone's newborn), at the
 * SAME `arrivalNeeds` the Long Meadow's homecoming uses (I2).
 */
export function welcomeVisitor<S extends WelcomeVisitorHostState>(
  state: S,
  placementId: PlacementId,
  newPipId: PipId,
  at: number,
  rosterCap: number,
  content: AttractionContent = {},
): WelcomeVisitorResult<S> {
  const refuse = (reason: WelcomeVisitorRefusalReason): WelcomeVisitorResult<S> => ({
    state,
    outcome: { action: "welcomeVisitor", ok: false, placementId, at, reason },
  });

  const items = content.items ?? DEFAULT_ATTRACTION_ITEMS;
  const tuning = attractionTuningOf(content);
  const placement = state.keep.placements[placementId];
  const biomeId = placement !== undefined ? attractionBiomeIdFor(placement.itemId, items) : undefined;
  if (biomeId === undefined) return refuse("unknownAttraction");

  const record = state.visitors[placementId];
  if (!visitorIsPresent(record, at)) return refuse("noVisitor");
  const present = record as VisitorRecord;
  if (present.trust < tuning.welcomeTrust) return refuse("trustTooLow");
  if (state.rosterOrder.length >= rosterCap) return refuse("rosterFull");

  const cost = tuning.welcomeCost[biomeId] ?? {};
  const paid = spend(state.resources, cost);
  if (!paid.ok) return refuse("insufficientResources");

  const arrivalNeeds = content.arrivalNeeds ?? contentTuning.retention.sanctuary.arrivalNeeds;
  const pip: PipState = {
    ...createPipFromGenome(present.genome, {
      id: newPipId,
      name: present.name,
      hatchedAt: at,
      lifeStage: LifeStage.Adult,
      needs: arrivalNeeds,
    }),
    generation: 0,
  };

  const visitors = { ...state.visitors };
  delete visitors[placementId];

  return {
    state: {
      ...state,
      resources: paid.resources,
      pips: { ...state.pips, [newPipId]: pip },
      rosterOrder: [...state.rosterOrder, newPipId],
      visitors,
    },
    outcome: { action: "welcomeVisitor", ok: true, placementId, pipId: newPipId, at },
  };
}

// --- RESTOCK_ATTRACTION ----------------------------------------------------

export type RestockRefusalReason = "unknownAttraction" | "alreadyFull" | "insufficientResources";

export type RestockAttractionOutcome =
  | {
      readonly action: "restockAttraction";
      readonly ok: true;
      readonly placementId: PlacementId;
      readonly at: number;
    }
  | {
      readonly action: "restockAttraction";
      readonly ok: false;
      readonly placementId: PlacementId;
      readonly at: number;
      readonly reason: RestockRefusalReason;
    };

export interface RestockHostState {
  readonly keep: KeepState;
  readonly attractionStock: AttractionStockByPlacement;
  readonly resources: ResourceCounts;
}

export interface RestockResult<S> {
  readonly state: S;
  readonly outcome: RestockAttractionOutcome;
}

/**
 * Refill one attraction to `stockMax` for its flat, never-inflating
 * `restockCost` (bible §1.4/§3.3: "the price of the eleventh Clover Ring
 * is the price of the first"). Refused (state unchanged) when already
 * full — spending resources on a full feeder would be waste, not a
 * gift — or short on cost.
 */
export function restockAttraction<S extends RestockHostState>(
  state: S,
  placementId: PlacementId,
  at: number,
  content: AttractionContent = {},
): RestockResult<S> {
  const refuse = (reason: RestockRefusalReason): RestockResult<S> => ({
    state,
    outcome: { action: "restockAttraction", ok: false, placementId, at, reason },
  });

  const items = content.items ?? DEFAULT_ATTRACTION_ITEMS;
  const tuning = attractionTuningOf(content);
  const placement = state.keep.placements[placementId];
  const itemId = placement?.itemId;
  const biomeId = itemId !== undefined ? attractionBiomeIdFor(itemId, items) : undefined;
  if (biomeId === undefined || itemId === undefined) return refuse("unknownAttraction");

  const current = state.attractionStock[placementId] ?? 0;
  if (current >= tuning.stockMax) return refuse("alreadyFull");

  const cost = tuning.restockCost[itemId] ?? {};
  const paid = spend(state.resources, cost);
  if (!paid.ok) return refuse("insufficientResources");

  return {
    state: {
      ...state,
      resources: paid.resources,
      attractionStock: { ...state.attractionStock, [placementId]: tuning.stockMax },
    },
    outcome: { action: "restockAttraction", ok: true, placementId, at },
  };
}

/** The three visitor-action outcomes, unioned for `state.lastVisitorOutcome`
 * (parked like every other `last*Outcome` echo). */
export type VisitorOutcome =
  | FeedVisitorOutcome
  | WelcomeVisitorOutcome
  | RestockAttractionOutcome;

// ---------------------------------------------------------------------------
// PLACE_ITEM / REMOVE_ITEM SEAMS — the two moments outside the visit-card
// actions that touch attraction state (module doc: "written to state" and
// "visible" both matter, but the actual rendering is the render layer's
// job — this module only supplies the DATA those two moments need).
// ---------------------------------------------------------------------------

/**
 * What `PLACE_ITEM` should stamp for a fresh attraction placement (bible
 * §1.4: "placing an attraction stamps it FULL... you never build a thing
 * and watch it do nothing"), or `undefined` when `itemId` hosts no
 * attraction at all (every other placeable/decoration — the common
 * case). The schedule baseline seeds to `at` (placement time), so the
 * FIRST visit is due `visitIntervalMs` later — the same "wait one
 * interval for the first tick" convention `core/keep/jobs.ts`'s
 * `assignedAt`/`lastProducedAt` already uses.
 */
export function initialAttractionStockFor(
  itemId: string,
  at: number,
  content: AttractionContent = {},
): { readonly biomeId: string; readonly stock: number; readonly scheduleAt: number } | undefined {
  const items = content.items ?? DEFAULT_ATTRACTION_ITEMS;
  const biomeId = attractionBiomeIdFor(itemId, items);
  if (biomeId === undefined) return undefined;
  const tuning = attractionTuningOf(content);
  return { biomeId, stock: tuning.stockMax, scheduleAt: at };
}

/**
 * The resources `REMOVE_ITEM` should refund for an attraction's remaining
 * feed, ON TOP OF the ordinary full build-cost refund every placement
 * already gets (bible §1.4: "removing an attraction refunds its
 * remaining charges as well as its build cost" — 2J's "tuck away never
 * destroys value" rule, already how a removed Craft Table's in-flight
 * orders are handled). Priced at `restockCost / stockMax` per charge,
 * FLOORED per resource so removal can never mint value beyond what was
 * actually paid in. `{}` (no refund) for a non-attraction item, a
 * content-removed attraction id, or zero remaining charges.
 */
export function refundForRemainingStock(
  itemId: string,
  remainingCharges: number,
  content: AttractionContent = {},
): ResourceBundle {
  const tuning = attractionTuningOf(content);
  const cost = tuning.restockCost[itemId];
  if (cost === undefined || remainingCharges <= 0 || tuning.stockMax <= 0) return {};
  const out: Record<string, number> = {};
  for (const [resourceId, amount] of Object.entries(cost)) {
    if (amount === undefined) continue;
    const refund = Math.floor((amount * remainingCharges) / tuning.stockMax);
    if (refund > 0) out[resourceId] = refund;
  }
  return out;
}

/**
 * Drop every trace of a removed placement (bible §1.5: removal clears the
 * visitor record, "the next visit rolls a fresh one" — for whichever
 * attraction is later placed on that tile). Returns `state` BY REFERENCE
 * when the placement carried no attraction state at all (every ordinary
 * placeable/decoration removal — the common case), matching every other
 * refusal/no-op contract in `core/`.
 */
export function clearAttractionState<
  S extends {
    readonly attractionStock: AttractionStockByPlacement;
    readonly attractionSchedule: AttractionScheduleByPlacement;
    readonly visitors: VisitorsByPlacement;
  },
>(state: S, placementId: PlacementId): S {
  if (
    state.attractionStock[placementId] === undefined &&
    state.attractionSchedule[placementId] === undefined &&
    state.visitors[placementId] === undefined
  ) {
    return state;
  }
  const attractionStock = { ...state.attractionStock };
  delete attractionStock[placementId];
  const attractionSchedule = { ...state.attractionSchedule };
  delete attractionSchedule[placementId];
  const visitors = { ...state.visitors };
  delete visitors[placementId];
  return { ...state, attractionStock, attractionSchedule, visitors };
}
