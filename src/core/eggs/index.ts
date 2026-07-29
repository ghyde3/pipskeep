/**
 * Egg domain (spec §7) — the egg state machine, incubation timers, and
 * the catch-up integration.
 *
 * State machine (spec §7.2): Found → Incubating → Pipping → Hatched.
 *
 * - **Found**: just rolled on an expedition; lives inside the pending
 *   loot reveal, not yet in `state.eggs`. ACKNOWLEDGE_REVEAL moves it to
 *   `state.eggs` and starts incubation.
 * - **Incubating**: real-time timer, DERIVED — the egg is ready at
 *   `incubationStartedAt + incubationMs` (no setTimeout persistence;
 *   reload preserves remaining time by construction, same rule as
 *   expedition timers, spec §6.1). Incubation is NEVER capped by the
 *   offline rate cap (spec §4.5 rule 4: "timers are not") — during
 *   catch-up a completion registers through the engine's custom-event
 *   seam (`collectEggCatchupEvents`) and flips the egg to Pipping.
 * - **Pipping**: cracked and wobbling, WAITING FOR THE PLAYER (spec §7.2:
 *   hatching is always player-witnessed, never automatic — hard rule).
 *   Nothing in this codebase auto-hatches, and nothing expires an egg
 *   (spec §7.4: eggs never expire) — a Pipping egg waits for its tap
 *   forever, including through the roster-full refusal.
 * - **Hatched**: terminal; the reducer removes the egg from `state.eggs`
 *   when HATCH_EGG succeeds (the hatch outcome carries the story for the
 *   UI), so no persisted egg ever holds this state.
 *
 * `incubationMs` is SNAPSHOTTED onto the egg at creation (resolved from
 * tuning by the egg's rarity — content-defined per rarity, 2h default,
 * spec §7.2) exactly like `durationMs` on ActiveExpedition: the derived
 * timer survives content re-tuning.
 *
 * Purity: no clock — `at` timestamps come from the caller's injected
 * Clock. ZERO tuning literals; every number is read from the tuning
 * object (defaults to `content/tuning.ts`, injectable for tests).
 */

import { tuning as contentTuning } from "../../content/tuning";
import type { CatchupEvent, CatchupState } from "../pips/catchup";

export type EggId = string;

/** Egg state machine (spec §7.2): Found → Incubating → Pipping → Hatched. */
export const EggState = {
  Found: "found",
  Incubating: "incubating",
  Pipping: "pipping",
  Hatched: "hatched",
} as const;
export type EggState = (typeof EggState)[keyof typeof EggState];

/** Name of the seeded RNG stream for hatch genome rolls (spec §7.2). */
export const EGG_STREAM = "egg";

/** Tag of the custom catch-up event an offline incubation completion
 * fires through the extraEvents seam (see collectEggCatchupEvents). */
export const EGG_READY_TAG = "eggReady";

/** One egg, as persisted in `state.eggs` (or inside a pending reveal
 * while still Found). Plain serializable data (spec §8). */
export interface Egg {
  readonly id: EggId;
  readonly state: EggState;
  /** Clock timestamp (ms) the expedition (or debug spawn) found it. */
  readonly foundAt: number;
  /** Rarity id (opaque content id) — selected the incubation time. */
  readonly rarity: string;
  /** Incubation length, snapshotted at creation (see module doc). */
  readonly incubationMs: number;
  /** Set when incubation begins; null exactly while Found. */
  readonly incubationStartedAt: number | null;
  /** Expedition that found it; null for debug-spawned eggs. */
  readonly sourceExpeditionId: string | null;
}

/** The slice of tuning the egg system reads (injectable for tests).
 * `content/tuning.ts` satisfies it. */
export interface EggTuning {
  readonly eggs: {
    readonly incubationMsDefault: number;
    readonly incubationMsByRarity: Readonly<Partial<Record<string, number>>>;
    readonly expeditionEggRarity: string;
  };
}

/** Incubation length for a rarity: the per-rarity override when content
 * defines one, else the default (spec §7.2 "content-defined per rarity,
 * 2h default"). */
export function resolveIncubationMs(
  rarity: string,
  tuning: EggTuning = contentTuning,
): number {
  return tuning.eggs.incubationMsByRarity[rarity] ?? tuning.eggs.incubationMsDefault;
}

export interface CreateEggOptions {
  readonly id: EggId;
  readonly foundAt: number;
  /** Defaults to the tuning-defined expedition-egg rarity. */
  readonly rarity?: string;
  readonly sourceExpeditionId: string | null;
}

/** A freshly found egg (state Found, not yet incubating). */
export function createEgg(
  options: CreateEggOptions,
  tuning: EggTuning = contentTuning,
): Egg {
  const rarity = options.rarity ?? tuning.eggs.expeditionEggRarity;
  return {
    id: options.id,
    state: EggState.Found,
    foundAt: options.foundAt,
    rarity,
    incubationMs: resolveIncubationMs(rarity, tuning),
    incubationStartedAt: null,
    sourceExpeditionId: options.sourceExpeditionId,
  };
}

/** Found → Incubating at `at` (the ACKNOWLEDGE_REVEAL moment). Already
 * past Found: returned unchanged (idempotent, never regresses). */
export function beginIncubation(egg: Egg, at: number): Egg {
  if (egg.state !== EggState.Found) return egg;
  return { ...egg, state: EggState.Incubating, incubationStartedAt: at };
}

/**
 * The derived incubation-complete moment: `incubationStartedAt +
 * incubationMs`. Null when the egg is not Incubating (Found eggs have no
 * timer yet; Pipping eggs are already done and wait forever).
 */
export function eggReadyAt(egg: Egg): number | null {
  if (egg.state !== EggState.Incubating || egg.incubationStartedAt === null) {
    return null;
  }
  return egg.incubationStartedAt + egg.incubationMs;
}

/** Incubating → Pipping for one egg. Never hatches (spec §7.2). */
function toPipping(egg: Egg): Egg {
  return { ...egg, state: EggState.Pipping };
}

/**
 * Flip every Incubating egg whose derived timer has elapsed at `at` to
 * Pipping (inclusive at the boundary, matching expedition returns). The
 * live TICK path; returns the input array by reference when nothing was
 * due (cheap for the frequent-tick case). NEVER hatches — Pipping waits
 * for the player (spec §7.2).
 */
export function settleDueEggs(eggs: readonly Egg[], at: number): readonly Egg[] {
  let changed = false;
  const next = eggs.map((egg) => {
    const readyAt = eggReadyAt(egg);
    if (readyAt === null || readyAt > at) return egg;
    changed = true;
    return toPipping(egg);
  });
  return changed ? next : eggs;
}

/** The state shape the egg catch-up collector operates on: any catch-up
 * state that also carries the eggs array (the reducer's CATCHUP adapter
 * satisfies this). */
export interface EggCatchupState extends CatchupState {
  readonly eggs: readonly Egg[];
}

/**
 * Catch-up event collector for the runCatchup `extraEvents` seam
 * (spec §4.5 rule 1): one `{ kind: "custom", tag: "eggReady" }` event per
 * Incubating egg whose derived completion lands inside the absence
 * window. The engine fires custom events REGARDLESS of the offline rate
 * cap — incubation is a timer, and "rates are capped, timers are not"
 * (spec §4.5) — and each event's `apply` flips exactly that egg to
 * Pipping, where it WAITS for the player at load (spec §7.2).
 *
 * Completions already due at the window start are healed by the caller
 * (`settleDueEggs(eggs, savedAt)` before the pass — the live loop would
 * already have flipped them); completions after the window end simply
 * stay Incubating and flip on a later TICK.
 */
export function collectEggCatchupEvents<S extends EggCatchupState>(
  state: S,
  windowStart: number,
  windowEnd: number,
): CatchupEvent<S>[] {
  const events: CatchupEvent<S>[] = [];
  for (const egg of state.eggs) {
    const readyAt = eggReadyAt(egg);
    if (readyAt === null || readyAt <= windowStart || readyAt > windowEnd) {
      continue;
    }
    const eggId = egg.id;
    events.push({
      kind: "custom",
      at: readyAt,
      tag: EGG_READY_TAG,
      apply: (s: S): S => ({
        ...s,
        eggs: s.eggs.map((e) =>
          // Flip by id on the CURRENT state (never a stale capture).
          e.id === eggId && e.state === EggState.Incubating ? toPipping(e) : e,
        ),
      }),
    });
  }
  return events;
}

/** Why a hatch request did not hatch. `rosterFull` is the only
 * pip-facing one (spec §7.4 friendly message); the others are structural
 * (the UI should not have offered the tap). */
export type HatchRefusalReason = "unknownEgg" | "notPipping" | "rosterFull";

/** What one HATCH_EGG request did — the UI's hatch-moment data source
 * (parked in `state.lastHatchOutcome`, like care outcomes). */
export type HatchOutcome =
  | {
      readonly ok: true;
      readonly eggId: EggId;
      /** The newborn Pipling's id. */
      readonly pipId: string;
      readonly at: number;
    }
  | {
      readonly ok: false;
      readonly eggId: EggId;
      readonly at: number;
      readonly reason: HatchRefusalReason;
      /** Friendly player-facing copy (set for rosterFull, spec §7.4). */
      readonly message?: string;
    };
