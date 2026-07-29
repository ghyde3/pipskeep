/**
 * Pip vocabulary + the aggregate per-Pip state type (spec §0, §4).
 *
 * Spec §0 requires the aggregate per-Pip state to be named `PipState`.
 * `PipActivity` is the state-machine activity enum stored inside it
 * (spec §4.7); it is deliberately NOT called "PipState" itself.
 *
 * Ids that resolve against content registries (species, personality,
 * items, expeditions) are plain strings here — core treats content ids
 * as opaque (spec §2 rule 5: adding content must never touch core/).
 */

export type PipId = string;

/** The four needs, each 0–100, 100 = fully satisfied (spec §4.1). */
export const NEED_IDS = ["hunger", "cleanliness", "happiness", "energy"] as const;
export type NeedId = (typeof NEED_IDS)[number];

/**
 * Structural bounds of the needs scale (spec §4.1: "each 0–100").
 * These are spec-level constants, not tunables — the 0–100 scale is part
 * of the model (mood thresholds, Sulking floor, evolution average all
 * assume it), so they live here rather than in content/tuning.ts.
 */
export const NEED_MIN = 0;
export const NEED_MAX = 100;

/** Current need values, each clamped to [NEED_MIN, NEED_MAX]. */
export type PipNeeds = Record<NeedId, number>;

/** Life stages (spec §4.6). Vocabulary per spec §0: `LifeStage.Pipling`. */
export const LifeStage = {
  Pipling: "pipling",
  Adult: "adult",
} as const;
export type LifeStage = (typeof LifeStage)[keyof typeof LifeStage];

/** Pip state-machine activities (spec §4.7). */
export const PipActivity = {
  Idle: "idle",
  Resting: "resting",
  AssignedJob: "assignedJob",
  OnExpedition: "onExpedition",
  Returning: "returning",
  Sulking: "sulking",
} as const;
export type PipActivity = (typeof PipActivity)[keyof typeof PipActivity];

/**
 * Trait genome (spec §7.3): `{ species, palette, pattern, accessorySlots,
 * personality }`. Field names carry an `Id` suffix where they reference a
 * content registry. Built now so breeding (`combineGenomes(a, b, rng)`,
 * spec §12 seam) is a UI feature later, not a data migration.
 */
export interface TraitGenome {
  /** Spec §7.3 `species` — id into the species registry. */
  speciesId: string;
  /** Palette variant id from the species' sprite params. */
  palette: string;
  /** Pattern variant id from the species' sprite params. */
  pattern: string;
  /** Number of accessory anchor points (spec §11). */
  accessorySlots: number;
  /** Spec §7.3 `personality` — id into the personality registry. */
  personalityId: string;
}

/**
 * The record of a completed evolution (spec §4.6): the variant the most
 * recent Give Item selected, and when the player witnessed it. `null`
 * until the Pip evolves. Set ONLY by the EVOLVE_PIP action (via
 * lifecycle's `applyEvolution`) — never by TICK or CATCHUP.
 */
export interface EvolvedRecord {
  /** Evolution variant id from the species registry's gift mapping. */
  variantId: string;
  /** Clock timestamp (ms) of the player's evolution tap. */
  evolvedAt: number;
}

/** The Pip's current outing, if any (spec §6.1). Completion is derived
 * from `departedAt + durationMs` — no persisted timers (spec §6.1). */
export interface ActiveExpedition {
  expeditionId: string;
  /** Clock timestamp (ms) at departure. */
  departedAt: number;
  /** Effective duration in ms (after e.g. Hardworking's −15%). */
  durationMs: number;
}

/**
 * Aggregate per-Pip state (spec §0 vocabulary: `PipState`).
 *
 * `speciesId`/`personalityId` at the top level are the LIVE values (a Pip's
 * species changes on evolution, spec §4.6); `genome` is the immutable birth
 * record used for inheritance (spec §7.3).
 */
export interface PipState {
  id: PipId;
  /** Live species — starts as `genome.speciesId`, changes on evolution. */
  speciesId: string;
  name: string;
  genome: TraitGenome;
  /** Live personality — from `genome.personalityId`; never changes in MVP. */
  personalityId: string;
  lifeStage: LifeStage;
  /** Clock timestamp (ms) of hatching (or adoption, for starters). */
  hatchedAt: number;
  /** Total lived ms; accrues whenever needs are recomputed (spec §4.6). */
  ageMs: number;
  /**
   * Time-weighted sum of Happiness in happiness·ms (spec §4.6).
   * Lifetime average Happiness = happinessIntegral / ageMs.
   */
  happinessIntegral: number;
  needs: PipNeeds;
  activity: PipActivity;
  /**
   * True when a need hit 0 while OnExpedition/Returning: Sulking entry is
   * deferred until the Pip lands back in Idle (spec §4.4).
   */
  pendingSulk: boolean;
  /** Spec §4.6: glows and waits for the player's tap. A flag, not a state. */
  readyToEvolve: boolean;
  /** Completed-evolution record; null until evolved (spec §4.6). The
   * live `speciesId` above flips to the target species at the same
   * moment; `genome` stays the immutable birth record. */
  evolved: EvolvedRecord | null;
  /** Most recent Give Item — selects the evolution variant (spec §4.6). */
  lastGiftItemId: string | null;
  /** Non-null exactly while OnExpedition/Returning. */
  expedition: ActiveExpedition | null;
  /** Clock timestamp (ms) of the last needs recompute. */
  needsUpdatedAt: number;
}
