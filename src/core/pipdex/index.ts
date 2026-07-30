/**
 * The Album (`pipdex`) — pure, additive record-keeping (bible §1).
 *
 * Every exported function here is a total, pure transform: `PipdexState`
 * in, `PipdexState` out, no clock access (timestamps come from the
 * caller's `at`), no randomness, no content imports (species/expedition
 * ids are opaque strings, spec §2 rule 5 — the reducer resolves them from
 * content and calls in with plain ids, the same pattern `pips/lifecycle.ts`
 * uses for evolution registries).
 *
 * Monotonicity (bible §0.1 — the orchestrator's guardrail: Album entries
 * may never decrease): every counter here only ever increases, and a
 * once-set timestamp is never overwritten (`prior.seenAt ?? at`, never
 * `at` outright). `pipdex.test.ts` asserts every scalar total is
 * non-decreasing across a long randomised action sequence.
 */

import type {
  PipdexCompletion,
  PipdexEntry,
  PipdexPortrait,
  PipdexState,
} from "./types";

export type {
  PipdexCompletion,
  PipdexEntry,
  PipdexPortrait,
  PipdexState,
} from "./types";

/** A fresh Album: nothing met, nothing caught (bible §11.1 v6 backfill for
 * a save with no prior history — `createNewGame` seeds the starter into
 * this via `markCaught` immediately afterward). */
export function createEmptyPipdex(): PipdexState {
  return {
    entries: {},
    discoveryOrder: [],
    formsSeen: 0,
    formsCaught: 0,
    variantsCaught: 0,
    shiniesCaught: 0,
    unreadEntryIds: [],
  };
}

function blankEntry(speciesId: string): PipdexEntry {
  return {
    speciesId,
    seenAt: null,
    caughtAt: null,
    caughtCount: 0,
    firstPortrait: null,
    shinyCaughtAt: null,
    variantsCaught: {},
    knownBiomes: [],
  };
}

function withUnread(
  unreadEntryIds: readonly string[],
  speciesId: string,
): readonly string[] {
  return unreadEntryIds.includes(speciesId)
    ? unreadEntryIds
    : [...unreadEntryIds, speciesId];
}

function withDiscovery(
  discoveryOrder: readonly string[],
  speciesId: string,
  isNewEntry: boolean,
): readonly string[] {
  return isNewEntry ? [...discoveryOrder, speciesId] : discoveryOrder;
}

/**
 * Grant a Field note (bible §1.1): the player has completed a trip to a
 * biome whose egg pool contains `speciesId`, OR (the evolution case, bible
 * §1.1 "evolved forms are seen through their base") the reducer is
 * revealing an evolution target the moment its base species was caught.
 * `expeditionId` is omitted for the latter — there is no biome to record.
 *
 * Idempotent and additive: a species already at Field note or Portrait
 * only gains a new `knownBiomes` entry (if `expeditionId` is new); the
 * `seenAt` timestamp, once set, never moves.
 */
export function markSeen(
  state: PipdexState,
  speciesId: string,
  at: number,
  expeditionId?: string,
): PipdexState {
  const prior = state.entries[speciesId];
  const isNewEntry = prior === undefined;
  const base = prior ?? blankEntry(speciesId);

  const wasUnseen = base.seenAt === null;
  const seenAt = wasUnseen ? at : base.seenAt;
  const knownBiomes =
    expeditionId !== undefined && !base.knownBiomes.includes(expeditionId)
      ? [...base.knownBiomes, expeditionId]
      : base.knownBiomes;

  if (!isNewEntry && !wasUnseen && knownBiomes === base.knownBiomes) {
    return state; // nothing new to record — keep reference stability
  }

  const entry: PipdexEntry = { ...base, seenAt, knownBiomes };
  return {
    ...state,
    entries: { ...state.entries, [speciesId]: entry },
    discoveryOrder: withDiscovery(state.discoveryOrder, speciesId, isNewEntry),
    formsSeen: wasUnseen ? state.formsSeen + 1 : state.formsSeen,
    unreadEntryIds: withUnread(state.unreadEntryIds, speciesId),
  };
}

/**
 * Grant a Portrait (bible §1.1/§1.3): hatched, evolved into, or started
 * with. `caughtCount` increments every call (a lifetime tally, bible
 * §1.4); `caughtAt` and `firstPortrait` are set only the FIRST time (the
 * portrait is frozen at first catch — bible §1.3.3, "the page shows
 * Mossy, not a generic Mosspip"). A shiny genome sets `shinyCaughtAt` the
 * first time one is caught, independent of species.
 */
export function markCaught(
  state: PipdexState,
  speciesId: string,
  at: number,
  portrait: PipdexPortrait,
): PipdexState {
  const prior = state.entries[speciesId];
  const isNewEntry = prior === undefined;
  const base = prior ?? blankEntry(speciesId);

  const wasUncaught = base.caughtAt === null;
  const caughtAt = wasUncaught ? at : base.caughtAt;
  const firstPortrait = base.firstPortrait ?? portrait;
  const shinyNewlyCaught = base.shinyCaughtAt === null && portrait.genome.shiny;
  const shinyCaughtAt = shinyNewlyCaught ? at : base.shinyCaughtAt;

  const entry: PipdexEntry = {
    ...base,
    caughtAt,
    caughtCount: base.caughtCount + 1,
    firstPortrait,
    shinyCaughtAt,
  };

  return {
    ...state,
    entries: { ...state.entries, [speciesId]: entry },
    discoveryOrder: withDiscovery(state.discoveryOrder, speciesId, isNewEntry),
    formsCaught: wasUncaught ? state.formsCaught + 1 : state.formsCaught,
    shiniesCaught: shinyNewlyCaught ? state.shiniesCaught + 1 : state.shiniesCaught,
    unreadEntryIds: withUnread(state.unreadEntryIds, speciesId),
  };
}

/**
 * Witness one gift-variant leaf on `baseSpeciesId`'s page — the Grove
 * Ledger (bible §1.3.6/§1.2): stored on the BASE species' entry (the
 * ribbon lives on Mosspip's page, not Grovepip's), keyed by variant id,
 * first-witnessed timestamp. Idempotent: re-witnessing the same variant
 * (should not happen — a Pip evolves once — but defensive) changes
 * nothing and returns the input by reference.
 */
export function markVariantCaught(
  state: PipdexState,
  baseSpeciesId: string,
  variantId: string,
  at: number,
): PipdexState {
  const prior = state.entries[baseSpeciesId];
  const isNewEntry = prior === undefined;
  const base = prior ?? blankEntry(baseSpeciesId);

  if (base.variantsCaught[variantId] !== undefined) {
    if (!isNewEntry) return state;
    // Defensive: a variant witnessed on a species with no entry yet (the
    // base was never marked seen/caught) still creates the blank entry so
    // discovery bookkeeping stays consistent.
    return {
      ...state,
      entries: { ...state.entries, [baseSpeciesId]: base },
      discoveryOrder: withDiscovery(state.discoveryOrder, baseSpeciesId, true),
    };
  }

  const entry: PipdexEntry = {
    ...base,
    variantsCaught: { ...base.variantsCaught, [variantId]: at },
  };

  return {
    ...state,
    entries: { ...state.entries, [baseSpeciesId]: entry },
    discoveryOrder: withDiscovery(state.discoveryOrder, baseSpeciesId, isNewEntry),
    variantsCaught: state.variantsCaught + 1,
    unreadEntryIds: withUnread(state.unreadEntryIds, baseSpeciesId),
  };
}

/**
 * The two declared completion targets plus the uncounted shiny corner
 * stamp (bible §1.2). Pure math over the forward-only totals — O(1),
 * never an O(n) recount. `albumTarget`/`ledgerTarget` are content-owned
 * numbers (`tuning.retention.pipdex`), passed in rather than imported so
 * this module stays content-free.
 */
export function pipdexCompletion(
  state: PipdexState,
  albumTarget: number,
  ledgerTarget: number,
): PipdexCompletion {
  const clampedPct = (numerator: number, denominator: number): number =>
    denominator > 0 ? Math.min(1, Math.max(0, numerator / denominator)) : 0;
  return {
    formsSeen: state.formsSeen,
    formsCaught: state.formsCaught,
    albumTarget,
    albumPct: clampedPct(state.formsCaught, albumTarget),
    ledgerVariantsCaught: state.variantsCaught,
    ledgerTarget,
    ledgerPct: clampedPct(state.variantsCaught, ledgerTarget),
    shiniesCaught: state.shiniesCaught,
  };
}
