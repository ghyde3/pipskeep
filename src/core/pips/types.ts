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

/**
 * Pip state-machine activities (spec §4.7).
 *
 * `Sulking` is still a member — it remains the activity value for the
 * common case (any need floors while Idle/AssignedJob) — but it is no
 * longer the ONLY encoding of "is this Pip sulking": see `PipState.sulking`
 * and `isSulking()` in machine.ts for the one case `activity` cannot
 * represent on its own (sulking while Resting, round 2A).
 */
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
  /**
   * Rare iridescent variant, rolled once at hatch from the egg stream
   * (tuning.genome.shinyChance) and immutable for life — evolution keeps
   * the birth genome, so the trait survives it by construction. Starters
   * and (for now) bred children are never shiny; only hatched eggs roll.
   */
  shiny: boolean;
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
  /**
   * ROUND 2H — THE CAREFUL ROUTE (spec §16 v1.5, docs/lifecycle-bible.md
   * §7.2, shield two): the player chose "take the long way round" at
   * send-off. Baked in at departure and never recomputed, exactly like
   * `durationMs`, because it is half a bargain the player already struck:
   * `lifecycle.shields.carefulRouteDurationMultiplier` was already
   * charged against the duration above, and in exchange this trip rolls
   * NO ailment at all on return and brings back
   * `carefulRouteLootMultiplier` of the usual haul.
   *
   * `undefined ≡ false` (the ordinary, faster, riskier route) — the same
   * optional-field precedent as `PipState.sulking`/`mastery`, so every
   * pre-2H trip snapshot and fixture is valid unchanged.
   */
  careful?: boolean;
}

/**
 * ROUND 2H — AN IN-PROGRESS AILMENT (spec §16 v1.5, docs/lifecycle-bible.md
 * §3.1). `null` while healthy; set only by `core/pips/ailment.ts`'s
 * `rollContraction`, on a completed DEEP-trip return (§3.2 — quick trips
 * never carry one).
 *
 * `remainingMs` is a REMAINING duration, deliberately never an end
 * timestamp: it is a RATE, decremented only through the rated portion of
 * `core/pips/needs.ts`'s `applyNeedsDelta` (the identical mechanism
 * `lifeMs` below uses) — that is the entire reason an absence can only
 * ever burn at most `offlineRateCapMs` off a countdown (promise 2).
 * `stage` (settling/worsening/grave) is DERIVED from `remainingMs /
 * totalMs`, never stored — see `ailmentStage()`.
 */
export interface AilmentState {
  /** Content id — an entry in `content/ailments.ts`. */
  readonly id: string;
  /** Clock timestamp (ms) of contraction, for the Album's dated line. */
  readonly contractedAt: number;
  /** The biome that inflicted it — this is what seeds the lineage egg
   * (bible §5.1) on a true loss. */
  readonly fromExpeditionId: string;
  /** Remaining RATED ms until the countdown resolves. */
  readonly remainingMs: number;
  /** What it started at, so a countdown ring can render a fraction. */
  readonly totalMs: number;
  /** Forward-only; drives escalating cure odds (bible §3.5). */
  readonly cureAttempts: number;
  /**
   * ROUND 2H — the day index (`core/progression/streak.ts`'s `dayIndex`)
   * on which this ailment last took its FREE devoted-care cure roll
   * (`core/pips/ailment.ts`'s `applyDevotedCare`). `undefined ≡ never
   * rolled`, which is deliberately ELIGIBLE: a freshly contracted ailment
   * gets its first free chance on the very next tick at which the Pip's
   * needs are all high, never a day later.
   *
   * Written only when a roll actually happened, so a day the player never
   * managed to bring the needs up simply passes without spending
   * anything — this is a rate limit on the reward, never a deadline.
   */
  readonly lastCareRollDay?: number;
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
  /**
   * True while the Sulking guilt-trip penalty (spec §4.4) is active,
   * INDEPENDENT of `activity` (round 2A fix for "a Pip that Sulks at 0
   * Energy could never Rest, because Rest required Idle" — the state
   * machine's `beginRest`/`wake` used to be the only way out of Sulking,
   * and both refused unless `activity === Idle`).
   *
   * `activity` alone cannot represent "napping AND still sulking": a Pip
   * beginning Rest FROM Sulking needs `activity` to read `Resting` (so
   * the Rest regen/auto-wake machinery applies) while the guilt-trip
   * persists until its needs actually clear the §4.4 exit bar. This
   * field is that missing orthogonal bit. See `machine.ts`'s module doc
   * ("Sulking: activity vs. flag") for the full decision, and read it via
   * `isSulking(pip)` (machine.ts) rather than directly — that helper also
   * recognizes the pre-existing `activity === PipActivity.Sulking`
   * encoding, which is KEPT and still set for the common (non-Resting)
   * case so every existing consumer of that check (dialogue, UI,
   * rendering, job eviction) keeps working unchanged.
   *
   * Optional rather than required: `undefined` ≡ `false`. Every
   * core-owned constructor and transition (genome.ts, machine.ts,
   * catchup.ts) that can produce a Sulking-while-Resting Pip sets it
   * explicitly; it stays optional so every existing fixture elsewhere
   * that never exercises the Resting+Sulking overlap needs no changes.
   */
  sulking?: boolean;
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
  /**
   * ROUND 2C — expedition mastery (docs/retention-bible.md §6):
   * expeditionId → completed-trip count. Optional exactly like `sulking`
   * above — `undefined ≡ {}` — so no existing fixture needs an edit.
   * Forward-only (never decays, never resets); lives on `PipState` so it
   * travels to the Long Meadow and back automatically on retire/retrieve,
   * and survives evolution untouched. Read via
   * `core/progression/mastery.ts`'s pure derivation functions — no tier is
   * ever stored, only trips.
   */
  mastery?: Readonly<Record<string, number>>;
  /**
   * ROUND 2H — PER-PIP LEVEL (spec §16 v1.5, docs/lifecycle-bible.md §1).
   * A second, smaller ladder belonging to THIS Pip — Keep XP
   * (`GameState.keepXp`) remains the game's one spine (progression bible
   * §0.1); this is that Pip's biography, never shown in the same widget.
   * Optional exactly like `sulking`/`mastery` above: `undefined ≡ 1`
   * (level 1 — the identity level, every level-effect table's index 0).
   * Only ever increases (`core/pips/level.ts`'s `awardPipXp` is the sole
   * mutator), and travels to the Long Meadow and back untouched (retiring
   * freezes it, exactly like `mastery`).
   */
  level?: number;
  /** Cumulative Pip XP earned by THIS Pip toward its next `level` (bible
   * §1.1/§1.2) — forward-only. `undefined ≡ 0`. */
  pipXp?: number;
  /**
   * ROUND 2H — LIFESPAN (bible §2.2): a Pip's life measured in RATED time
   * only. Live ticks advance it 1:1 (`core/pips/needs.ts`'s
   * `applyNeedsDelta`); an offline catch-up pass advances it by at most
   * `offlineRateCapMs` total (the SAME rated/frozen split §4.5 already
   * gives needs decay — `accrueFrozenTime` deliberately does NOT touch
   * this field). `undefined ≡ 0` (a newborn/migrated Pip is freshly
   * young). Deliberately DISTINCT from `ageMs`, which keeps accruing
   * through frozen catch-up time for the evolution/happiness-average math
   * (see `lifecycle.ts`'s module doc) — a resident of the Long Meadow
   * freezes `lifeMs` the same way it already freezes `ageMs`: by living
   * outside `state.pips`, not via a stored flag.
   */
  lifeMs?: number;
  /**
   * Bible §2.5: set by TICK/CATCHUP the moment `lifeMs` reaches this
   * Pip's lifespan — a FLAG, nothing else (old age changes no rate, no
   * need, no refusal — bible §2.4). Sticky, like `readyToEvolve`: once
   * set, never revoked (a later improvement in care can still raise the
   * live-computed lifespan back past `lifeMs`, silently un-crossing the
   * threshold in fiction, but the flag itself never un-announces —
   * revoking an announced retirement would read as punishment, the exact
   * reasoning `updateEvolutionReadiness` already uses). Only `RETIRE_PIP`
   * may act on it; TICK/CATCHUP never move a Pip to the sanctuary
   * (promise 3/5). `undefined ≡ false`.
   */
  readyToRetire?: boolean;
  /**
   * ROUND 2H — AILMENTS (docs/lifecycle-bible.md §3). `null`/`undefined`
   * while healthy (`undefined ≡ null` — the same optional-field precedent
   * as `sulking`/`mastery`/`level` above); set by `rollContraction` on a
   * risky expedition return, cleared by a cure (poultice, or the Loyal
   * Turn) or by a true loss (which instead REMOVES the Pip from
   * `state.pips` entirely — the ailment travels with it into the Long
   * Meadow's memorial record, `core/pips/ailment.ts`'s module doc).
   */
  ailment?: AilmentState | null;
  /**
   * ROUND 2H — SCARS (bible §3.6): permanent, forward-only ids of every
   * ailment this Pip has survived (cured, or via the Loyal Turn). A scar
   * is a standing IMMUNITY — `rollContraction` skips the roll entirely
   * (zero RNG consumed) for any ailment id already in this list — and
   * travels through evolution, retirement and retrieval untouched.
   * `undefined ≡ []`, the same precedent as `mastery`.
   */
  scars?: readonly string[];
  /**
   * ROUND 2H — INHERITED RESISTANCE (bible §3.6/§5.4): `ailmentId →
   * fractional contract-chance reduction`, heritable from a scarred
   * parent at `tuning.lifecycle.ailments.inheritedResistance` (0.25).
   * Written by the lineage/breeding hatch path (not this round's own
   * mutator); READ by `rollContraction` to reduce that ailment's odds for
   * THIS Pip. `undefined ≡ {}`, the same precedent as `mastery`/`scars`.
   */
  resistances?: Readonly<Record<string, number>>;
  /**
   * ROUND 2H — LINEAGE (spec §12 unfenced, docs/lifecycle-bible.md
   * §5.4/§6.2/§9.2): this Pip's generation. `1` = original stock (every
   * starter and every ordinary hatched/loot egg); a lineage-egg
   * hatchling or a bred child is one more than its parent(s)' own
   * generation. `undefined ≡ 1`, the same `sulking`/`mastery` precedent —
   * every pre-2H Pip and every fresh non-lineage hatch is generation 1.
   */
  generation?: number;
  /**
   * ROUND 2H — LINEAGE (bible §5.4/§6.2/§9.2): the id(s) this Pip was
   * hatched/bred from — absent/`[]` for original stock, one id for a
   * lineage-egg hatchling (the lost Pip), two for a bred child
   * (`[aId, bId]`). `undefined ≡ []`, the `mastery`/`scars` precedent.
   */
  parentIds?: readonly PipId[];
  /**
   * ROUND 2H — BREEDING (bible §6.1/§9.2): wall-clock timestamp (ms) of
   * this Pip's most recent BREED_PIPS as a parent — gates
   * `lifecycle.lineage.breedCooldownMs`. Wall-clock, not rated
   * (`core/pips/breeding.ts`'s `ownBreedRefusal` compares it straight
   * against the action's `at`), so an absent player's cooldown ticks for
   * free rather than freezing with the rest of an offline pass.
   * `undefined ≡ null` (never bred).
   */
  lastBredAt?: number | null;
  /**
   * ROUND 2H — BREEDING (bible §6.1/§9.2): lifetime clutches produced as
   * a parent, forward-only — gates `lifecycle.lineage.maxClutchesPerPip`
   * (bible §6.3: stops a two-Pip factory from filling every roster slot).
   * `undefined ≡ 0`.
   */
  clutches?: number;
}
