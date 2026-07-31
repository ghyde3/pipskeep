/**
 * ALL `[DEFAULT — review]` numeric values from spec §4–§7 live here
 * (spec §14: balancing is a single-file pass). Registries import from this
 * file rather than repeating numbers.
 *
 * Every value in this file is `[DEFAULT — review]` unless noted otherwise.
 */

import type { NeedId } from "../core/pips";
import type { PersonalityId } from "./personalities";
import type { KeepLevel } from "../core/keep";
import type { ResourceBundle } from "../core/economy";
// Type-only import from a sibling registry (erased at compile — no cycle).
import type { Rarity } from "./species";

export const SECOND_MS = 1_000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;

export const tuning = {
  /**
   * Base need decay per real-time hour (spec §4.1). Negative = decays.
   *
   * ROUND 2A RETUNE (playtest — "noticeably grumpy, ~25%"). These four
   * numbers plus `offlineRateCapMs` are the whole feel of coming back.
   * The arithmetic they are solving, stated once:
   *
   *   drop over one full capped window = rate × (offlineRateCapMs / 1h)
   *
   * A save left at ~90 should return at ~25 after a day away, so that
   * product wants to be ≈65 for EVERY need. At the 16h cap below that
   * means ≈4.1 points/hour. The old rates (−6/−4/−5/−3) had a 2:1 spread
   * between the fastest and slowest need, so a returning player found one
   * bar at 18 next to another at 54 — incoherent rather than "grumpy".
   * The spread came down to ≈1.17:1 (round 2B tightened it further, to
   * ≈1.09:1): the bars fall together, and the Keep reads as uniformly
   * neglected. Ordering is still meaningful — Hunger leads
   * (its fix, Feed, is the most abundant), Energy trails (so a Pip is
   * never too tired to be Played with).
   *
   * ROUND 2B (playtest review — "day 2 is worse than day 1"). Round 2A
   * fixed the FIRST absence and never modelled the second, so it missed
   * the loop: you come home to ~25, you do a care round, you leave
   * again — and whatever you left is what the NEXT window eats. The
   * number that actually matters is therefore not the return value but
   *
   *   LEAVE-SAFE FLOOR = max over (need × personality) of
   *                      rate × personalityMultiplier × capHours
   *
   * i.e. the bar value you must LEAVE behind for nothing to hit 0 while
   * you are gone. At round 2A's rates that floor was 78.0, while a care
   * session could only put Hunger at ~50 and Happiness at ~53 — so day 2
   * landed the whole Keep Sulking with needs at exactly 0. The repair is
   * two-sided and both sides live in this file: the restores came UP
   * (see `care.play`, `care.pet`, `foods`), and the three fastest rates
   * came down 5–7% so the floor is 74.0 — comfortably inside what one care
   * session now restores, with the headline "come back to ~25" feel and
   * the [18, 35] band intact (a neutral Pip now returns at 29/31/32/34).
   *
   * Guarded by `core/pips/balance.test.ts` — including the second
   * absence, which is the case round 2A had no test for.
   */
  needDecayPerHour: {
    hunger: -3.8,
    cleanliness: -3.7,
    happiness: -3.6,
    energy: -3.5, // while awake; Resting regenerates instead (see care.rest)
  } satisfies Record<NeedId, number>,

  /**
   * Personality decay multipliers (spec §4.2). Effective rate =
   * base × personality × life-stage × situational, all multiplicative.
   *
   * ROUND 2A: compressed from [0.7, 1.5] to [0.8, 1.3]. These multipliers
   * do not colour a moment — they multiply a WHOLE capped window, so at
   * any tuning that lands a 24h absence near 25, a ×1.5 necessarily drives
   * that need to 0 and hands the player a guaranteed Sulking Pip every
   * time they leave. Personality should flavour the curve, not decide
   * whether the Keep survives the night. Every quirk keeps its direction
   * and stays clearly visible (Chaotic is still the dirtiest Pip in the
   * Keep, Clingy still the loneliest) — the extremes just no longer reach
   * the floor. Guarded by `core/pips/balance.test.ts`.
   *
   * ROUND 2B: unchanged, but note what the top of this range now DOES.
   * The largest multiplier here sets the leave-safe floor documented on
   * `needDecayPerHour` (today: Chaotic's ×1.25 Cleanliness → 74.0), and
   * therefore how much a single care session has to be able to restore.
   * Raising any multiplier raises that bar for every care action at once.
   */
  personalityDecayMultipliers: {
    lazy: { hunger: 0.85, cleanliness: 1.0, happiness: 1.0, energy: 1.3 },
    curious: { hunger: 1.0, cleanliness: 1.15, happiness: 0.85, energy: 1.1 },
    hardworking: { hunger: 1.15, cleanliness: 1.0, happiness: 1.1, energy: 1.15 },
    chaotic: { hunger: 1.1, cleanliness: 1.25, happiness: 0.8, energy: 1.0 },
    clingy: { hunger: 1.0, cleanliness: 1.0, happiness: 1.25, energy: 0.9 },
  } satisfies Record<PersonalityId, Record<NeedId, number>>,

  /** Personality quirk numbers (spec §4.2 table, right column). */
  quirks: {
    /** Clingy: Happiness decay ×2.0 while OnExpedition (situational modifier). */
    clingyExpeditionHappinessMultiplier: 2.0,
    /** Curious: +10% expedition loot. */
    curiousLootBonus: 0.1,
    /** Hardworking: −15% expedition duration. */
    hardworkingExpeditionDurationMultiplier: 0.85,
    /** Chaotic: 10% chance to DISPLAY a mood one step off from actual (§4.3). */
    chaoticMoodDisplayOffsetChance: 0.1,
  },

  /**
   * Mood thresholds (spec §4.3). Evaluate in order, first match wins:
   * Miserable → Grumpy → Beaming → Content.
   */
  mood: {
    /** Miserable — any need < this. */
    miserableBelow: 15,
    /** Grumpy — any need < this. */
    grumpyBelow: 40,
    /** Beaming — all needs ≥ this. */
    beamingAtOrAbove: 70,
  },

  /** Sulking exit: ALL four needs ≥ this (inclusive) → back to Idle (§4.4). */
  sulkExitThreshold: 25,

  /**
   * Offline catch-up rate cap (spec §4.5): needs change and Gathering
   * production accrue only during the FIRST this-many ms of absence.
   * Rates are capped; timers (expeditions, eggs) are not.
   *
   * ROUND 2A: 12h → 16h. This is the dominant lever for long absences —
   * everything past it is free — so it and `needDecayPerHour` are chosen
   * together (see the arithmetic there). 16h specifically because:
   *
   * - It is LONGER than a night's sleep, so an 8h overnight absence is
   *   fully rated and honest — the cap never quietly eats a night, and
   *   the "8h is mild" promise comes from the rates, not from a freeze.
   * - It is SHORTER than a day, so the cap is already binding at the 24h
   *   mark the retune targets: the "come back to ~25" number is the
   *   capped value and cannot drift with how long the player was away.
   *   24h, 3 days and a fortnight all land in exactly the same place.
   * - Raising the cap let the per-hour rates come DOWN by a third, which
   *   is what makes short absences cheap: the same 65-point day costs
   *   only ~32 points overnight and ~8 points over a coffee break.
   */
  offlineRateCapMs: 16 * HOUR_MS,

  /** Care action effects and cooldowns (spec §5). */
  care: {
    clean: {
      /** Cleanliness → 100, deliberately trivial (a check-in ritual). */
      setsCleanlinessTo: 100,
      cooldownMs: 60 * SECOND_MS,
    },
    /**
     * ROUND 2B: +20 → +45 Happiness. Play and Pet are the ONLY cures for
     * Happiness, and between them they used to return 28 points against
     * a bar that a day's absence took 76 off — so the one need with the
     * most expressive care actions was also the one you could never
     * actually fix. Play is now the big one (a real event, and the only
     * care action that costs something: −10 Energy, which is why it
     * cannot simply be spammed — nine plays empty a full Energy bar and
     * the §5 refusal floor stops the tenth).
     */
    play: {
      happiness: 45,
      energy: -10,
    },
    /**
     * ROUND 2B: +8 → +25 (Clingy +14 → +35). Pet is the 30-second-
     * cooldown affection tap; at +8 it was decorative. The sizing rule is
     * exact: ONE Play plus ONE Pet must out-restore a full capped window
     * of Happiness decay for EVERY personality, or the bar ratchets down
     * a little further every day (Clingy lost 2 points per cycle at
     * 40 + 30 — a slow-motion version of the same day-2 failure). Worst
     * case is Clingy: 72.0 decayed vs 45 + 35 = 80 restored.
     */
    pet: {
      happiness: 25,
      /** Clingy gets this instead of the base +25. */
      clingyHappiness: 35,
      cooldownMs: 30 * SECOND_MS,
    },
    rest: {
      /**
       * Energy regen per hour while Resting (spec §4.1).
       *
       * ROUND 2A: 15 → 600, i.e. 10 Energy per real MINUTE. Decay is
       * measured in hours; recovery must be measured in minutes or the
       * only cure for the one need Feed/Clean/Play cannot touch is to put
       * the game down for four hours. At 600/h a full 0 → 100 nap takes
       * 10 minutes — two Meadow trips — so "put one Pip down for a nap
       * and send another out" is a single, legible loop. Still slow
       * enough to be a thing the player WATCHES rather than a button.
       */
      energyPerHour: 600,
      /** Pip auto-wakes when Energy reaches this. */
      autoWakeAtEnergy: 100,
    },
  },

  /** Play refusal thresholds (spec §5). Refusals are free and cooldown-less. */
  playRefusal: {
    /** Any Pip refuses Play below this Energy. */
    minEnergy: 10,
    /** Lazy Pips additionally refuse below this Energy. */
    lazyMinEnergy: 30,
    /** Lazy Pips refuse any other Play this often, just because. */
    lazyFlavorRefusalChance: 0.15,
  },

  /**
   * Expedition table (spec §6.1). Loot tables live in expeditions.ts.
   * `lootRolls` = base weighted rolls per completed trip (the reveal's
   * item count before Curious's bonus rolls).
   *
   * ROUND 2B — SIX BIOMES, THREE TIERS, TWO RHYTHMS. Each Keep level now
   * unlocks a PAIR of trails rather than one:
   *
   *   - a QUICK trip (Meadow 5m / Forest 15m / Shore 30m) — the active
   *     loop. Best items per minute, best eggs per HOUR, the thing you tap
   *     between care actions.
   *   - a DEEP trip (Bramblewick 40m / Snowdrift 60m / Lanterngrotto 90m)
   *     — the idle loop. One per absence, higher egg chance PER TRIP,
   *     richer foods, and (with per-biome egg pools) the only source of
   *     its species.
   *
   * Deep trips deliberately do NOT win on throughput — the Meadow still
   * out-farms every one of them per minute, and remains the best egg farm
   * per hour. They are worth a slot because they are the only door to
   * their biome's foods and species, not because they are faster.
   *
   * ⚠️ THE LEVEL-1 WOOD CEILING (the fragile invariant — see the note on
   * `progression.levelCosts`). The Meadow is the ONLY wood source at Keep level 1,
   * and BOTH level 2 and the Gathering Station are priced wood-first. So:
   *
   *   - no new Keep-level-1 expedition may push wood above ~0.183/min, or
   *     the level-2 target falls through its 15-minute floor;
   *   - no new Keep-level-1 expedition may push fiber above 0.400/min, or
   *     fiber becomes the binding resource and hits the same floor.
   *
   * That is why the Bramblewick drops ZERO wood and lands fiber at
   * 0.302/min: every shipped level-1 number is byte-identical to round
   * 2A's, and the Meadow/Forest tables are untouched on purpose. What is
   * actually asserted is the 15-minute floor this protects, so an
   * innocent-looking level-1 wood drop presents as a confusing failure in
   * "expects to be affordable in 30–45 minutes" — start here.
   * Guarded by `core/economy/reachability.test.ts`.
   */
  expeditions: {
    meadow: {
      durationMs: 5 * MINUTE_MS,
      eggChance: 0.08,
      unlockKeepLevel: 1,
      /** ROUND 2A: 2 → 3. The Meadow is the ONLY expedition at level 1
       * and only one Pip can be on it at a time (spec §6.1), so its
       * per-trip yield is the hard ceiling on early progression — and a
       * 2-item reveal after five minutes was a thin dopamine moment.
       * ROUND 2B: unchanged, and load-bearing for four pinned assertions
       * (the 30–45 minute level-2 target, the Gathering-Station on-ramp
       * ratio, the Forest-beats-Meadow-on-wood pair, and the daily-berry
       * ritual). Do not retune it casually. */
      lootRolls: 3,
    },
    /**
     * ROUND 2B — the level-1 DEEP trip. 40 minutes is the shortest thing
     * that reads as "leave it running while you do something else", and
     * short enough that a first session can still see one come home.
     * Drops no wood by design (see the ceiling note above), so it changes
     * nothing about how long Keep level 2 takes — it only makes the
     * waiting richer: fiber, the Honeydrop treat, and the Toastnut.
     */
    bramblewick: {
      durationMs: 40 * MINUTE_MS,
      eggChance: 0.25,
      unlockKeepLevel: 1,
      lootRolls: 9,
    },
    /**
     * ROUND 2A: Forest 3 → 4 rolls, Shore 4 → 6. Rolls did not scale with
     * duration at all, so a 30-minute Shore trip paid four items while six
     * Meadow trips over the same half hour paid eighteen — the "bigger"
     * expeditions were a throughput DOWNGRADE dressed as progression.
     * Short trips still win on raw items per minute (that is their whole
     * identity: active play beats idle play), but the gap is no longer
     * absurd, and the Shore now actually supplies the Shell/Driftwood the
     * roster upgrade is priced in. A fuller pass on this belongs with the
     * content expansion; this is the minimum that makes level 3 work.
     */
    /**
     * ROUND 2B: Forest 4 → 6 rolls. At 4 rolls the Forest paid 0.12 Wood
     * per minute against the Meadow's 0.15 — so the newly unlocked
     * expedition was a Wood DOWNGRADE, and the fastest route to the
     * level-3 Wood cost it gates was to ignore it and keep spamming the
     * Meadow. An unlock the optimal player declines is not an unlock. At
     * 6 rolls it pays 0.18 Wood/minute (+20% on the Meadow) and lands a
     * six-item haul, which is what a fifteen-minute wait should look
     * like. Short trips still win on RAW items per minute (Meadow 0.60 vs
     * Forest 0.40) — active play beating idle play is the intended
     * shape; the tier below just no longer wins at the tier above's own
     * headline resource. Guarded by `core/economy/reachability.test.ts`.
     */
    forest: {
      durationMs: 15 * MINUTE_MS,
      eggChance: 0.12,
      unlockKeepLevel: 2,
      lootRolls: 6,
    },
    /**
     * ROUND 2B — the level-2 DEEP trip. An hour, sized so an overnight
     * player gets exactly one completed run. Thin pickings and fat egg
     * odds: above the treeline there is not much to carry home, but it is
     * the only place a Snowpip has ever been seen.
     *
     * ROUND 2F (progression bible §2.1) — unlock 2 → 3. Re-spreading the
     * six biomes across the new 12-tier ladder so a two-hour-old save no
     * longer sees every trail: removing this trip from level-2 income
     * leaves Wood at 0.33/min there, and level 3 still lands at 66.7
     * expected minutes (up from 61.1) — it STRENGTHENS the escalation
     * chain rather than threatening it (guarded by
     * `core/economy/reachability.test.ts`).
     *
     * ROUND 2J (docs/economy-bible.md §1.2) — 12 → 15 rolls, paired with
     * lodestone's weight-26 entry on `content/expeditions.ts`'s table
     * (weight sum 104 → 130). THE ZERO-DILUTION IDENTITY: this is the
     * exact scaling that leaves every pre-existing per-trip yield in this
     * table UNCHANGED (`15 × 104 === 12 × 130`) — see
     * `content/expeditions.test.ts`'s identity test. Do not touch this
     * number without recomputing that identity for all three biomes.
     */
    snowdrift: {
      durationMs: 60 * MINUTE_MS,
      eggChance: 0.35,
      unlockKeepLevel: 3,
      lootRolls: 15,
    },
    /**
     * ROUND 2F — unlock 3 → 4. Shell/Driftwood now arrive at tier 4, which
     * is why Cozy Bunks' `prerequisiteLevel` (content/keep.ts) moves 3 → 4
     * to match: the tier that supplies its cost.
     *
     * ROUND 2J (docs/economy-bible.md §1.2) — 6 → 9 rolls, paired with
     * lodestone's weight-50 entry (weight sum 100 → 150). THE ZERO-
     * DILUTION IDENTITY: `9 × 100 === 6 × 150`, so `shell/min` stays
     * 0.09000 and `driftwood/min` stays 0.06000 to 5dp — pinned in
     * `content/expeditions.test.ts`. Do not touch this number in
     * isolation; see the Snowdrift comment above.
     */
    shore: {
      durationMs: 30 * MINUTE_MS,
      eggChance: 0.18,
      unlockKeepLevel: 4,
      lootRolls: 9,
    },
    /**
     * ROUND 2B — the level-3 DEEP trip, and the top of the ladder. 90
     * minutes, the richest food table in the game (it is the only source
     * of the Emberloaf and the Feastpot), and a coin-flip egg chance on
     * the only pool a Lanternpip appears in. Still not a throughput win:
     * 14 rolls over 90 minutes is 0.156 items/min against the Meadow's
     * 0.60. You go for what only it has.
     *
     * ROUND 2F — unlock 3 → 5 (+2 tiers). The trophy chase (Lanternpip)
     * now starts on engaged day 2 / casual day 6 rather than hour 2 —
     * later, but not so late the Album becomes unfinishable (progression
     * bible §2.1).
     *
     * ROUND 2J (docs/economy-bible.md §1.2) — 14 → 16 rolls, paired with
     * lodestone's weight-14 entry (weight sum 98 → 112). THE ZERO-
     * DILUTION IDENTITY: `16 × 98 === 14 × 112`, so the Feastpot's
     * per-trip chance (still 1-per-3.5-trips) is unchanged to the last
     * bit — pinned in `content/expeditions.test.ts`.
     */
    lanterngrotto: {
      durationMs: 90 * MINUTE_MS,
      eggChance: 0.5,
      unlockKeepLevel: 5,
      lootRolls: 16,
    },
  } satisfies Record<
    string,
    {
      durationMs: number;
      eggChance: number;
      unlockKeepLevel: KeepLevel;
      lootRolls: number;
    }
  >,

  /**
   * Gathering job (spec §6.2): 1 resource per interval from a weighted
   * table.
   *
   * ROUND 2A: Wood added at 20%. Wood is what every placeable and the
   * Keep itself is priced in, so a station that could not produce any was
   * a Berry faucet rather than an economy. With the §4.5 cap this is also
   * the CASUAL player's route to Keep level 2: one absence yields at most
   * `offlineRateCapMs / intervalMs` ticks, ~19 of them Wood.
   *
   * ROUND 2B: unchanged here — the reason that route did not work was the
   * station's PRICE, not its output. See `placeableCosts`.
   */
  gathering: {
    intervalMs: 10 * MINUTE_MS,
    table: { berry: 0.5, fiber: 0.3, wood: 0.2 },
  },

  /**
   * Simmering job (content bible §5.4) — the second job, at the Stockpot.
   * Deliberately slower and food-only: 30 min per tick (vs Gathering's 10)
   * and NO Wood/Fiber, so it never competes with Gathering as the
   * materials faucet. One capped 16h absence = 32 ticks ≈ 12.8 Berries +
   * 19.2 Toastnuts — generous pantry, but it costs a Pip's labour, and
   * staffing both stations consumes two-thirds of the base 3-Pip roster.
   *
   * Deliberately NO Stew: Stew stays a Forest/Shore-only reward, because
   * "Keep level 2 visibly makes feeding easier" is a shipped round-2B
   * promise and a level-1 Stockpot dropping Stew would eat it.
   *
   * Placed next to `gathering` on purpose — two production RATES that
   * must stay in a legible relationship (the round-2B lesson about two
   * PRICES that must stay in a relationship, one level up).
   */
  jobs: {
    simmering: {
      intervalMs: 30 * MINUTE_MS,
      table: { berry: 40, toastnut: 60 },
    },

    /**
     * ROUND 2F (progression bible §3.4) — the THIRD job, at the Workbench
     * (tier 8). Slowest of the three (45 min vs Gathering's 10 and
     * Simmering's 30) and materials-only, the late-game complement to
     * Gathering's mixed faucet and Simmering's pantry: one capped 16h
     * absence is 21 ticks ≈ 12.6 Wood + 8.4 Fiber. Wood/Fiber only, same
     * as the other two stations, so it stays outside the level-1 wood
     * ceiling regardless of which tier it unlocks at (`core/economy/
     * reachability.test.ts`'s "a station's own cost is payable at level 1"
     * checks the STATION's cost, not the job's OUTPUT, which this table
     * is — the Workbench itself is priced in `placeableCosts.workbench`).
     */
    mending: {
      intervalMs: 45 * MINUTE_MS,
      table: { wood: 60, fiber: 40 },
    },
  },

  /** Eggs (spec §7). Incubation timers are never capped by offline rules. */
  eggs: {
    /** Incubation (spec §7.2): real-time, 2h default. */
    incubationMsDefault: 2 * HOUR_MS,
    /** Content-defined per-rarity overrides (spec §7.2); absent → default. */
    incubationMsByRarity: {} satisfies Partial<Record<Rarity, number>>,
    /** Rarity of eggs found on expeditions (spec §7.1 — the MVP source). */
    expeditionEggRarity: "common" satisfies Rarity,
    /**
     * Species-roll weights by registry rarity at hatch (spec §7.3:
     * "weighted by registry rarity"). Relative weights per species entry.
     *
     * ROUND 2B (content bible §1.2) — the `lineage` tier and the bug it
     * fixes: evolved forms (Grovepip, Cairnpip, Reefpip, Hearthpip,
     * Frostpip, Thunderpip, Beaconpip) are registered with
     * `rarity: "lineage"`, and `lineage: 0` here removes them from the
     * hatch pool entirely — `core/pips/genome.test.ts` already pins "weight
     * 0 never hatches". Before this fix, `grovepip` shipped as
     * `rarity: "uncommon"`, so roughly one egg in five hatched a
     * fully-evolved Grovepip, quietly undercutting the whole evolution
     * feature. `uncommon`/`rare` also move 25→30 / 5→12 per the bible (now
     * that the registry has 14 entries instead of 2, the old weights would
     * have made the two rarer BASE species harder to find than before this
     * expansion, which is backwards).
     */
    rarityWeights: {
      common: 100,
      uncommon: 30,
      rare: 12,
      lineage: 0,
    } satisfies Record<Rarity, number>,
  },

  /** Fresh-genome extras rolled at hatch (core/pips/genome rollGenome). */
  genome: {
    /** Chance a hatched genome is the rare iridescent variant — rare
     * enough to feel special, common enough to actually meet one. */
    shinyChance: 0.025,
  },

  /**
   * Breeding seam numbers (spec §7.3/§12 — `combineGenomes` only; nothing
   * in gameplay reads these until the breeding UI phase).
   */
  breeding: {
    /** Chance that an inherited palette/pattern mutates to a random
     * variant of the child's species instead (per field). */
    mutationChance: 0.05,
  },

  /** Roster cap (spec §7.4): 3 active Pips; Keep upgrade raises to 5. */
  rosterCap: 3,
  rosterCapUpgraded: 5,

  /**
   * Pipling life stage (spec §4.6).
   *
   * ROUND 2A REWORK (playtest: "the eggs hatched and the babies were
   * useless and I had no idea why"). The old shape was a life stage that
   * could do NOTHING for 24 hours and cost 20% MORE upkeep meanwhile —
   * pure tax on the single most exciting moment in the game.
   *
   * - `durationMs` 24h → 8h: one overnight absence. Hatch it before bed
   *   and it is an adult in the morning; hatch it in the morning and it
   *   is an adult after work. 8h is also ≤ `offlineRateCapMs`, so a
   *   babyhood always finishes inside the rated part of an absence and
   *   the growth stage never freezes half-done.
   * - `decayMultiplier` 1.2 → 0.9: "everyone helps look after the baby."
   *   A Pipling is now the LOWEST-maintenance Pip in the Keep, which
   *   gives the stage a mechanical identity (low upkeep, low output)
   *   instead of a lockout, and makes hatching read as a gift.
   */
  pipling: {
    durationMs: 8 * HOUR_MS,
    decayMultiplier: 0.9,
    /**
     * Expeditions a Pipling may be sent on — the "supervised short trip"
     * (round 2A amendment to spec §4.6, which blanket-barred Piplings).
     * Meadow only: 5 minutes is too short for a trip to hurt anyone, and
     * Forest/Shore stay adult-only so the stage still means "not ready
     * for the real world" and the mid-game economy stays adult-gated.
     *
     * READ BY: `core/pips/machine.ts` `departExpedition` (the `"pipling"`
     * refusal must consult this list instead of refusing outright) — the
     * expedition id is already on the `ActiveExpedition` it receives.
     */
    allowedExpeditionIds: ["meadow"] as readonly string[],
  },

  /**
   * Evolution (spec §4.6): ready when ageMs ≥ 72h AND lifetime average
   * Happiness (happinessIntegral / ageMs) ≥ 70. Player-witnessed via tap.
   */
  evolution: {
    minAgeMs: 72 * HOUR_MS,
    minLifetimeAvgHappiness: 70,
  },

  /**
   * Placeable station costs (spec §9); referenced by content/placeables.ts.
   *
   * ROUND 2B — THE CASUAL ON-RAMP, MADE REAL. These live here, next to
   * `progression.levelCosts`, precisely because of the bug that put them here:
   * the Gathering Station cost `{ wood: 8, fiber: 4 }` while the Keep
   * level 2 it is supposed to FUND cost `{ wood: 5, fiber: 6 }`. The
   * station was more expensive in Wood than the thing it was the cheap
   * route to, so the advertised casual path ("build it, leave, come back
   * to a level-2 fund") was strictly dominated by just buying level 2 —
   * i.e. it did not exist. Two prices that must stay in a relationship
   * cannot live in two files where nobody can see them together.
   *
   * The invariant, now enforced by `core/economy/reachability.test.ts`:
   * the Gathering Station is cheaper — in every resource AND in expected
   * minutes of play — than the Keep level it funds. At `{ wood: 3,
   * fiber: 2 }` it is ~4 Meadow trips (~20 minutes), so the casual
   * player's first session ends with a station placed and a Pip on it,
   * and ONE absence then pays for level 2 outright (a capped 16h window
   * is 96 gathering ticks ≈ 19 Wood, 29 Fiber, 48 Berries).
   *
   * The Bed and Food Bowl are cosmetic-functional and stay cheap; they
   * are not on the progression path.
   */
  placeableCosts: {
    "food-bowl": { wood: 2 },
    bed: { wood: 4, fiber: 3 },
    "gathering-station": { wood: 3, fiber: 2 },
    /**
     * ROUND 2B — the Stockpot (content bible §5.3), the Simmering job's
     * station. Wood + fiber ONLY, per the placeables rule below `placeableCosts`
     * itself proves (§3.4 of the bible: placeables carry no level gate, so
     * they may only cost resources obtainable at Keep level 1). Priced
     * MORE than the Gathering Station in both resources on purpose (bible
     * §3.5) so a first-session player still reaches for the Gathering
     * Station first and the casual on-ramp narrative (see the comment
     * above) survives having a second station to buy.
     */
    stockpot: { wood: 5, fiber: 4 },

    /**
     * ROUND 2F (progression bible §3.4/§5.1) — nine new stations, one per
     * tier the ladder hands out. Each carries `unlockKeepLevel` on its OWN
     * `PlaceableDef` entry (content/placeables.ts), which is what lets
     * `trail-post`/`beacon`/`weathervane` price in Shell/Driftwood at all:
     * `core/economy/reachability.test.ts`'s `pricedPlaceables.payableAt`
     * now reads `item.unlockKeepLevel` instead of a hard-coded `1` (bible
     * §8.3 Update 1 — an authorised TIGHTENING, not a weakening: each
     * station is checked against the income available when it actually
     * appears). Every entry below clears its own tier's 3-hour/0.95-afford
     * bar with margin (bible §5.1's own table).
     */
    "wash-basin": { wood: 3, fiber: 2 },
    "play-post": { wood: 4, fiber: 4 },
    /**
     * ROUND 2H (docs/lifecycle-bible.md §3.5) — the Poultice Shelf, tier
     * 5. Wood + fiber only, same reachability rule every station follows:
     * both are obtainable from the Meadow/Forest at level 1, so this is
     * safely payable at the tier it actually unlocks on (5), where
     * Lanterngrotto also opens.
     */
    "poultice-shelf": { wood: 7, fiber: 6 },
    larder: { wood: 8, fiber: 5 },
    "nest-warmer": { wood: 5, fiber: 4 },
    "trail-post": { wood: 6, shell: 2 },
    /**
     * ROUND 2J FIX STAGE — the four LATE stations gain a lodestone rider.
     *
     * The economy audit measured the whole build catalogue at `wood 175,
     * fiber 135, shell 44, driftwood 35, lodestone 0`: the round's headline
     * resource paid for Keep tiers and nothing else, so from the moment the
     * ladder ended it was pure surplus. These four are the right carriers —
     * every one unlocks at tier 8 or later, well past lodestone's tier-3
     * arrival, so `reachability.test.ts`'s structural layer is satisfied by
     * construction and its rate layer has enormous margin (lodestone's
     * expected 3-hour yield at tier 8+ is ~31 against a top price of 6).
     *
     * Deliberately NOT retrofitted onto the early stations: the Gathering
     * Station on-ramp and the tier-1-payable rule are shipped promises, and
     * lodestone does not exist below tier 3. The WORKBENCH is excluded for
     * the same reason even though it unlocks at 8 — it hosts the Mending
     * job, and `reachability.test.ts`'s "a station's own cost is payable at
     * level 1, so the job economy is not circular" rule applies to every
     * job-hosting station regardless of tier.
     */
    workbench: { wood: 6, fiber: 5 },
    "sun-bunks": { wood: 10, fiber: 8, lodestone: 3 },
    beacon: { wood: 12, shell: 5, driftwood: 3, lodestone: 5 },
    weathervane: { wood: 10, shell: 4, driftwood: 4, lodestone: 6 },
  } satisfies Readonly<Record<string, ResourceBundle>>,

  /**
   * Keep grid (spec §9): 8×8 starting area. Growth-per-level moved to
   * `progression.gridGrowth` in round 2F (progression bible §2.2/§8.6
   * risk 1 — the "two numbers, two files" trap round 2B documented; the
   * tier-2 `+4 rows` entry there is byte-identical to what shipped here).
   * Bounds math lives in core/keep `gridBounds`.
   */
  keepGrid: {
    cols: 8,
    rows: 8,
  },

  /** Roster upgrade cost (spec §7.4: Keep upgrade raises the cap 3 → 5;
   * purchasable at Keep level 4 as of round 2F — see
   * `content/keep.ts`'s `keepUpgrades.prerequisiteLevel`, moved 3 → 4
   * to follow the Shore, which now supplies this cost's Shell/Driftwood,
   * progression bible §2.1). Referenced by content/keep.ts. */
  rosterUpgradeCost: { wood: 10, shell: 8, driftwood: 4 } satisfies ResourceBundle,

  /**
   * Food effects (spec §5/§6.3); referenced by content/foods.ts.
   *
   * ROUND 2B: Berry +25 → +45, Stew +50 → +75 (and +5 → +15 Happiness).
   * Feed is the only cure for Hunger, and Hunger is the fastest-decaying
   * need: a day away costs up to 69.9 points, so a +25 snack could not
   * put a returning Pip back above the leave-safe floor at any sane
   * number of taps. The two foods now say different things —
   *
   *   Berry — a snack. Two of them cover a full day's Hunger from any
   *           starting point, and Berries are the most common drop in
   *           the game (Meadow 40%, Gathering 50%), so the everyday loop
   *           is "come home, hand out two berries each".
   *   Stew  — a meal. ONE covers a whole day, plus a Happiness kicker.
   *           It drops only in the Forest and at the Shore, which is the
   *           point: unlocking Keep level 2 visibly makes feeding easier.
   *
   * Guarded by `core/pips/balance.test.ts` (the second-absence loop).
   *
   * ROUND 2B CONTENT EXPANSION — eight more foods, all sized against the
   * SAME single number. Say it once, out loud, because every row below
   * is an answer to it:
   *
   *   worst Hunger lost over one full capped absence
   *     = 3.8/h × 1.15 (Hardworking) × 16 h  =  69.92
   *
   * "Servings to cover a day away" is therefore `ceil(69.92 / hunger)`,
   * and the sizing rule (spec §16 v1.2) is that the everyday food must
   * make that number small enough to be one homecoming's worth of taps:
   *
   *   berry      45   → 2   (2×45  = 90.0)   the staple
   *   stew       75   → 1   (75.0)           the meal
   *   honeydrop  10   → 7   (7×10  = 70.0)   THE TREAT — never a meal
   *   toastnut   55   → 2   (2×55  = 110.0)  the pocket snack
   *   frostberry 40   → 2   (2×40  = 80.0)   the brisk one
   *   cocoabun   60   → 2   (2×60  = 120.0)  the comfort bake
   *   glowcap    35   → 2   (2×35  = 70.0)   the odd little mushroom
   *   tideroll   60   → 2   (2×60  = 120.0)  the seaside lunch
   *   emberloaf  90   → 1   (90.0)           the hot dinner
   *   feastpot  100   → 1   (100.0)          THE FEAST
   *
   * Two of those margins are thin ON PURPOSE and are pinned in
   * `foods.test.ts` so a decay nudge lands there first: Honeydrop
   * (70.0 vs 69.92) and Glowcap (70.0 vs 69.92) both clear the day by
   * 0.08 of a point. Honeydrop's job is the +32 Happiness — more than a
   * Pet, with no cooldown — handed to a grumpy Pip while the stew is
   * still fifteen minutes out; being a ludicrous meal is the price of
   * that and the reason it is not simply better than a Berry.
   *
   * Nothing here weakens Berry or Stew: every new food is additive
   * headroom, and the two load-bearing rows are byte-identical to what
   * `core/pips/balance.test.ts` already pins.
   *
   * Side effects are bonuses, never load-bearing (spec §5: Happiness is
   * cured by Play + Pet, Energy by Rest). Feed applies them; Give Item
   * applies the side effects ONLY (`core/pips/care.ts`), which is why the
   * treat and the feast read so differently as gifts.
   */
  foods: {
    berry: { hunger: 45 },
    stew: { hunger: 75, happiness: 15 },
    honeydrop: { hunger: 10, happiness: 32 },
    toastnut: { hunger: 55, energy: 6 },
    frostberry: { hunger: 40, energy: 12 },
    cocoabun: { hunger: 60, happiness: 18 },
    glowcap: { hunger: 35, happiness: 20 },
    tideroll: { hunger: 60, energy: 5 },
    emberloaf: { hunger: 90, happiness: 10 },
    feastpot: { hunger: 100, happiness: 30, energy: 15 },
    /**
     * ROUND 2H — the Poultice (docs/lifecycle-bible.md §3.5), the cure
     * item for `content/ailments.ts`'s poultice route
     * (`tuning.lifecycle.ailments.poulticeCureChance`). Zero restore and
     * no side effects ON PURPOSE: it is a Give Item consumable, not a
     * meal, so it deliberately fails `foods.test.ts`'s "day away" sizing
     * loop (which is filtered to only the ten meal-shaped foods) rather
     * than being force-fit into that arithmetic. Lives HERE, not a
     * separate registry, because `core/pips/care.ts`'s `giveItem` case
     * already reads any gift's side effects from THIS table (an unknown
     * id is a safe no-op gift) — a second consumable registry would be a
     * second source of truth for exactly the same lookup.
     */
    poultice: { hunger: 0 },
  },

  /**
   * ROUND 2C — RETENTION (docs/retention-bible.md). Every number the
   * gamification stack reads, in one block, because they are all answers
   * to the SAME question and must be read together:
   *
   *   "Does this reward showing up without ever punishing absence?"
   *
   * The orchestrator guardrail, restated here because this is the file
   * where it would be violated first: a broken streak may cost a BONUS
   * and nothing else — never progress, never an item, never a Pip. There
   * is therefore no number in this block that can go DOWN except
   * `streak.tierLootBonus` (a multiplier, i.e. a bonus) and
   * `streak.graceMax` (a budget that refills on its own). Counters,
   * Pipdex entries, milestones and mastery are monotonic by construction
   * — see `docs/retention-bible.md` §0 for the full invariant list.
   *
   * ⚠️ THE ISOLATION RULE (the fragile invariant of this round, the
   * equivalent of round 2B's level-1 wood ceiling). NOTHING in this block
   * may be read by anything that computes need decay, care restores, food
   * effects, or the offline cap. The whole of round 2A/2B balance rests on
   * one arithmetic claim —
   *
   *   one care session out-restores one full capped absence, for every
   *   need and every personality (`core/pips/balance.test.ts`)
   *
   * — and a retention reward that touches a restore value or a decay rate
   * re-derives that claim silently. So retention pays in RESOURCES, ITEMS,
   * DECORATIONS and FLAIR only. If a future reward needs to make care
   * easier, it is the wrong reward.
   */
  retention: {
    /**
     * Day boundary for streaks and daily bounties: the local hour a new
     * "visit day" starts. 04:00 rather than midnight because a 1 a.m.
     * session belongs to the night owl's PREVIOUS day, and losing a
     * streak to insomnia is exactly the punishment this round forbids.
     *
     * Applied as an offset, never by parsing a date in core: the day
     * index is `floor((at - dayOffsetMs) / dayMs)` where `dayOffsetMs`
     * combines the player's timezone offset with this hour and lives in
     * GameState (set at boot by the app layer, the only place allowed to
     * ask what timezone this is — spec §2 rule 2).
     */
    dayStartHour: 4,
    dayMs: 24 * HOUR_MS,

    /**
     * DAILY STREAK. The ladder repeats every `ladderLength` days; what
     * escalates with a long streak is the TIER (a loot bonus), not the
     * ladder. That split is the anti-dark-pattern shape: the day-to-day
     * rewards are always attainable, and the only thing a break can cost
     * is the tier — a bonus, per the guardrail.
     *
     * `tierMinStreakDay[i]` is the streak day at which tier i begins;
     * `tierLootBonus[i]` is that tier's additive bonus-roll chance (see
     * `loot.bonusRollChanceMax` — every bonus source sums into ONE capped
     * channel, so a 30-day streak cannot compound with mastery into
     * absurdity).
     *
     * GRACE, and why a bank rather than a "streak freeze": `graceMax` 2
     * missed days are absorbed silently (a "rain day"), refilling one per
     * `graceRefreshDays`. A bank is forgiving in the shape real life
     * actually breaks streaks (one bad Tuesday, twice a month) and — the
     * reason it is not a purchasable freeze — it can never become a
     * monetisation surface or an anxiety timer.
     *
     * WELCOME BACK: a returning player whose `longest` ever reached
     * `welcomeBackLongestRequired` restarts at tier
     * `welcomeBackTierFloor`, not tier 0. A fortnight away therefore
     * leaves you strictly BETTER off than a brand-new player — the
     * mechanical form of "a returning player should feel welcomed, not
     * billed".
     */
    streak: {
      ladderLength: 7,
      graceMax: 2,
      graceRefreshDays: 14,
      tierMinStreakDay: [1, 3, 7, 14, 30],
      tierLootBonus: [0, 0.05, 0.1, 0.15, 0.2],
      welcomeBackLongestRequired: 7,
      welcomeBackTierFloor: 1,
    },

    /**
     * THE SANCTUARY (the Long Meadow) — the storage answer that makes a
     * 14-form collection reachable without ever deleting a Pip (content
     * bible §9 risk 7; spec §4.4 "no death, no running away, no lost
     * Pips").
     *
     * `capacity: null` is UNLIMITED, deliberately and permanently. A
     * capped sanctuary recreates the exact problem it exists to solve —
     * at cap the completionist is back to choosing which Pip to destroy.
     * The cost of "unlimited" is a few hundred bytes per resident.
     *
     * `arrivalNeeds`: a retired Pip's needs snap here ONCE on arrival and
     * then never change (retired Pips are outside the decay loop
     * entirely). 80 rather than 100 because Beaming is what the player's
     * own care earns — the sanctuary is comfortable, not better than
     * home; and 80 rather than "frozen as-was" because storing a Pip must
     * never preserve misery (punishment by storage is still punishment).
     * All four values clear `sulkExitThreshold` by a wide margin, so
     * retiring a Sulking Pip clears the sulk through the ORDINARY §4.4
     * exit rule with no special case.
     *
     * `minStayMs`: a resident settles in for one overnight before they
     * can be asked home. This is the ONLY limit on the retire/retrieve
     * loop and it exists for one reason: without it, "retire → ask home"
     * is a free full heal, and the sanctuary becomes a spa that
     * trivialises care (the one thing §4.4's floor and round 2A's restore
     * arithmetic must not be routed around). 8h matches
     * `pipling.durationMs` and sits inside `offlineRateCapMs`, so a stay
     * always completes inside one rated absence. Waiting costs nothing
     * and missing the moment costs nothing — it is a settling-in period,
     * never a countdown.
     *
     * `minActivePips`: you cannot send your LAST Pip away. Structural
     * (someone has to hold the fort), not a punishment.
     */
    sanctuary: {
      capacity: null,
      minStayMs: 8 * HOUR_MS,
      arrivalNeeds: {
        hunger: 80,
        cleanliness: 80,
        happiness: 80,
        energy: 100,
      } satisfies Record<NeedId, number>,
      minActivePips: 1,
    },

    /**
     * THE ALBUM (internal id `pipdex`). Two declared targets and one
     * uncounted celebration — the split is load-bearing:
     *
     * - `albumTarget` 14: every form, base and evolved. THE headline
     *   number. Long but bounded, and every form has a findable route
     *   (content bible §3.6's time-to-find table: ~15 engaged hours for
     *   the set, the Lanternpip trophy being ~10.5h of it).
     * - `ledgerTarget` 21: the seven evolution lines × three gift
     *   variants. Zero RNG — pure care and patience — which is why it is
     *   the long-haul target rather than the headline one.
     * - Shiny stamps are NOT a target and get no denominator. At
     *   `genome.shinyChance` 0.025, "14/14 shiny" is tens of thousands of
     *   hatches; presenting that as completion would be the definition of
     *   a dark pattern. The Album shows "3 glimmers found", never "3/14".
     */
    pipdex: {
      albumTarget: 14,
      ledgerTarget: 21,
    },

    /**
     * DAILY BOUNTIES — three a day, generated LEVEL-AWARE (a bounty for a
     * locked biome is a bug, not a stretch goal). The generator filters
     * templates through the player's actual capabilities and draws from
     * what survives; `perDay` 3 because two reads as thin and four reads
     * as a chore list on a game whose whole session is five minutes.
     *
     * `freeRerollsPerDay` 1, and free forever: a reroll exists so a
     * bad draw is not an accusation sitting on the doorstep. Charging for
     * it (resources, ads, anything) would turn a kindness into a
     * conversion funnel.
     *
     * `dayBonusEggMaxPerDay` 1: completing all three grants ONE egg from
     * any unlocked biome pool, player's choice. It is the low-time
     * player's route into the collection chase — an engaged player already
     * out-farms it in an hour of Meadow trips (0.96 eggs/h), so it
     * accelerates the person who needs it and barely registers for the
     * person who doesn't. Watch item: this plus the day-7 basket is
     * ~1.1 extra eggs/day, and eggs never expire — see the retention
     * bible's risk list for the egg-pile presentation rule.
     */
    bounties: {
      perDay: 3,
      freeRerollsPerDay: 1,
      dayBonusEggMaxPerDay: 1,
    },

    /**
     * EXPEDITION MASTERY — per Pip, per biome, five tiers. What is stored
     * is TRIPS (a plain forward-only count); the tier is DERIVED, so
     * retuning the thresholds below re-grades every existing Pip with no
     * migration.
     *
     * Thresholds are TIME-NORMALISED so no biome is a silly grind and none
     * is free:
     *
     *   trips(tier, biome) = max(ceil(tierHours[tier] × 60 / durationMin),
     *                            tierMinTrips[tier])
     *
     * so tier 5 is ~18 engaged hours on the Meadow (216 trips) and ~30
     * wall-clock hours of idling on the Lanterngrotto (20 trips) — the
     * active player and the once-a-night player both have a real ladder in
     * the rhythm they actually play. `tierMinTrips` is the floor that stops
     * a 90-minute biome handing out tier 1 for a single trip.
     *
     * What mastery improves: ONLY the bonus-roll chance below (loot
     * QUANTITY, delivered as occasional visible extra finds exactly like
     * Curious's +10%), plus `topTierEggChanceBonusPoints` at tier 5.
     * Explicitly NOT duration (that is Hardworking's identity, and the
     * expedition-duration figures are what `core/economy/
     * reachability.test.ts` measures progression against), NOT loot-table
     * weights, NOT need decay, NOT refusal rules.
     *
     * Why the numbers are small: the real reward is the title on the Pip's
     * card ("Old friend of the Meadow"). +15% at the top of an 18-hour
     * ladder is a nod, not an economy. The reachability suite measures a
     * FRESH save, which has zero mastery by construction — so those
     * assertions keep measuring the tuned economy and cannot be
     * accidentally satisfied by a buff.
     */
    mastery: {
      tierHours: [0.5, 1.5, 4, 9, 18],
      tierMinTrips: [2, 4, 7, 12, 20],
      tierBonusRollChance: [0.02, 0.05, 0.08, 0.11, 0.15],
      topTierEggChanceBonusPoints: 0.02,
    },

    /**
     * LOOT MULTIPLIERS — one channel, summed once, clamped once.
     *
     * Every source of "more loot" in the game (Curious's
     * `quirks.curiousLootBonus`, mastery, streak tier, an event) is an
     * ADDITIVE bonus-roll chance, they are summed, and the sum is clamped
     * to `bonusRollChanceMax`. Sum-then-clamp rather than
     * multiply-then-clamp for two reasons: the player can read it
     * ("+10% Curious, +15% Meadow → capped at +25%"), and nothing can
     * compound. Worst case today sums to 0.55; the cap holds it at 0.25.
     *
     * 0.25 specifically: at the Meadow's 3 base rolls that is ~0.75 extra
     * items per trip — visible, occasional, never a doubling — and it
     * means a fully-buffed veteran earns at most 1.25× the yield the
     * economy was tuned for, which cannot re-order the biomes or break
     * reachability's "each Keep level costs more engaged play than the
     * last".
     *
     * Egg chance is a SEPARATE channel (additive percentage POINTS, from
     * mastery tier 5 and events), capped at `eggChanceBonusPointsMax`,
     * with `eggChanceCeiling` as a hard ceiling on the resulting chance so
     * the Lanterngrotto's 50% can never become a certainty.
     *
     * Job production (Gathering, Simmering) takes NO multipliers at all:
     * it is the offline faucet, its ceiling is `offlineRateCapMs`, and
     * buffing it re-derives the casual on-ramp arithmetic that
     * `reachability.test.ts` pins (the station must stay cheaper, in
     * minutes, than the Keep level it funds).
     */
    loot: {
      bonusRollChanceMax: 0.25,
      eggChanceBonusPointsMax: 0.05,
      eggChanceCeiling: 0.6,
    },

    /**
     * EGG PITY — visible, never hidden, and deterministic from the seeded
     * RNG.
     *
     * A per-biome counter of hatches from that biome that did NOT produce
     * the rarest tier present in its egg pool. At the threshold the next
     * hatch from that biome is GUARANTEED to be that tier, and the counter
     * resets. Keyed by the pool's rarest tier:
     *
     *   uncommon pools (Meadow → Cloudpip 23.1%, Forest → Emberpip 13.0%,
     *     Snowdrift, Shore): 8. Expected wait without pity is ~4.3 hatches
     *     on the Meadow; 8 turns a long tail into a promise.
     *   rare pools (Lanterngrotto → Lanternpip 28.6%): 6. Grotto eggs cost
     *     90 minutes each, so 6 caps the trophy chase at ~9 hours against
     *     the ~10.5h expectation — the tail is what makes a chase feel
     *     unfair, and this removes it without touching the base odds.
     *   common-only pools (Bramblewick): no pity, because there is nothing
     *     rarer in the pool to chase. The UI shows the base odds and no
     *     counter, rather than a counter that never pays.
     *
     * Cursor parity is the hard constraint and it comes free: a pity hatch
     * narrows the species registry handed to `rollGenome`, which consumes
     * exactly 5 rolls regardless of registry size — the same mechanism
     * round 2B's biome pools already rely on (spec §2 rule 3).
     */
    eggPity: {
      thresholdByRarity: { uncommon: 8, rare: 6 } satisfies Partial<
        Record<Rarity, number>
      >,
    },

    /**
     * EVENTS — limited-time FLAVOUR, never limited-time CONTENT.
     *
     * Two rules make "limited time" safe here, and they are absolute:
     * every event RECURS ANNUALLY (declared as month-day, so "you missed
     * it" is always "it comes back"), and nothing is ever obtainable only
     * during one. An event may make something EASIER (a loot bonus inside
     * the capped channel, a lower pity threshold) or louder (a featured
     * decoration), and that is the whole permitted surface.
     *
     * `lootBonusRollChanceMax` is the per-event ceiling on what it may
     * contribute to the ONE summed bonus channel above; `pityThresholdMin`
     * is the floor an event may lower a pity threshold to (it may only
     * ever LOWER one — an event that made a chase longer would be a
     * punishment for playing at the wrong time of year).
     */
    events: {
      lootBonusRollChanceMax: 0.1,
      pityThresholdMin: 4,
    },

    /**
     * GRANT CEILINGS — the guard that keeps round 2B's shipped feel claim
     * honest ("Keep level 2 in 30–45 minutes of engaged play", measured
     * over 300 seeds in `reachability.test.ts`).
     *
     * Streak, bounty and milestone rewards are the one way this round can
     * inject resources OUTSIDE the expedition and job tables that
     * reachability measures — so a generous early ladder could quietly
     * make the shipped number a lie. Wood is the binding resource for Keep
     * level 2 (`progression.levelCosts[2]` = 5 wood / 6 fiber) and the level-1
     * wood ceiling (see `expeditions`) is the fragile invariant it
     * protects, so the cap is stated on wood:
     *
     *   the TOTAL wood a player can bank from every retention grant
     *   reachable before Keep level 2 is `preLevel2WoodCap`.
     *
     * Fiber grants are deliberately NOT capped this tightly: fiber is not
     * the binding resource, so extra fiber shortens the unlucky tail (the
     * p90 50-trip seed) without moving the median — the same job the
     * Gathering Station on-ramp does.
     *
     * `grantedDecorationRefund` 0 closes a real exploit: `REMOVE_ITEM`
     * refunds a placement's full cost, so a free decoration would be a
     * resource printer. Granted keepsakes refund NOTHING and instead
     * return to a keepsakes shelf, re-placeable free forever — warmer than
     * a refund and closed as a loop.
     */
    grants: {
      preLevel2WoodCap: 2,
      grantedDecorationRefund: 0,
    },
  },

  /**
   * ROUND 2F — THE PROGRESSION SPINE (docs/progression-bible.md). Keep XP,
   * the 12-tier Keep ladder, and building effects, in one block because
   * they are three views of the same question:
   *
   *   "does the bar move, does it lead somewhere named, and does the thing
   *    you built with it do anything?"
   *
   * ⚠️ THE ISOLATION RULE STILL BINDS (see `retention`'s own doc comment).
   * Nothing here may read or modify `needDecayPerHour`,
   * `personalityDecayMultipliers`, `care.*`, `foods.*`, `offlineRateCapMs`,
   * `sulkExitThreshold`, or `playRefusal`. Building COMFORT is a fifth
   * multiplicative FACTOR applied in `core/pips/needs.ts` `effectiveRates`
   * (base × personality × life-stage × situational × keepComfort, bible
   * §3.2) — it never edits a rate, so every arithmetic assertion in
   * `core/pips/balance.test.ts` computes exactly the same numbers, and the
   * factor is the identity on a Keep with no placements, so every
   * reducer-driven test in the repo is byte-identical.
   *
   * ⚠️ THE FRAGILE INVARIANT OF THIS ROUND (the equivalent of round 2B's
   * level-1 wood ceiling and round 2C's isolation rule):
   * `effectCaps.comfortReductionMax`. At 0.25 a MAXIMALLY-built Keep still
   * comes home Grumpy after a 24h absence for every personality; at 0.30 a
   * Curious Pip comes home Content and the daily care loop stops mattering.
   * The whole "buildings shorten the chore, never trivialise care" promise
   * is that one number. Guarded by `core/keep/comfort.balance.test.ts`.
   */
  progression: {
    /**
     * CUMULATIVE Keep XP required to reach each tier, indexed by tier − 1
     * (so `levelXp[0] === 0` is tier 1). The BAR the player watches is
     * per-tier — `(keepXp − levelXp[L−1]) / (levelXp[L] − levelXp[L−1])` —
     * because a cumulative bar is why every XP game eventually stops
     * feeling like it moves (bible §0.2).
     *
     * The deltas are 100 · 180 · 300 · 400 · 550 · 700 · 900 · 1150 · 1450
     * · 1800 · 2300. Measured against the bible §1.6 income model that is
     * tier 2 at ~12 minutes, tier 4 by the end of day 1, tier 8 on engaged
     * day 7, tier 12 on engaged day 17 (casual day 54). "Early levels in
     * the first session, mid-game in days, late-game in weeks."
     *
     * THE ANTI-GRIND CONSTRAINT, which is what actually pins these
     * numbers: at EVERY tier, one care action must be ≥ 0.15% of that
     * tier's bar and one care round plus a Meadow round-trip ≥ 1.2%
     * (`barVisibility` below). Tier 12 is the binding row: 4/2300 = 0.17%
     * and 33/2300 = 1.43%. Steepening any late tier lands in
     * `core/progression/levelCurve.test.ts` first.
     */
    levelXp: [
      0, 100, 280, 580, 980, 1530, 2230, 3130, 4280, 5730, 7530, 9830,
    ] as readonly number[],

    /**
     * XP per player action (bible §1.3's table covers every arm of
     * `GameAction`; anything absent from that table grants ZERO — `TICK`,
     * `SET_ACTIVE_PIP`, `MOVE_ITEM`, `REMOVE_ITEM`, `UNASSIGN_JOB`,
     * `RETRIEVE_PIP`, the onboarding/debug/day-offset/event seams).
     *
     * Two structural rules these numbers encode:
     *
     * 1. Every repeatable source is already rate-capped by a shipped
     *    mechanism — cooldowns and full bars for care, one-Pip-per-trip for
     *    expeditions, `offlineRateCapMs` for job ticks, three-a-day for
     *    bounties, one-day-a-day for the streak. The two that looked
     *    unbounded are keyed to first-time-only counters instead:
     *    `firstBuild` on `counters["built.<itemId>"]` (closing the
     *    place → full-refund → place printer) and `firstJob` on
     *    `counters["job.<jobId>"]`.
     * 2. `revealBase + revealPer5Min × floor(durationMs / 5min)` is why a
     *    90-minute Grotto trip pays 24 and a 5-minute Meadow trip pays 7:
     *    per MINUTE the Meadow still wins (1.4 vs 0.27), so active play
     *    beating idle play — round 2B's shape — survives in XP too.
     */
    xp: {
      /** FEED/CLEAN/PLAY/PET/GIVE_ITEM, and REST_TOGGLE when a nap STARTS.
       * The atom the whole table is sized against. Refusals pay nothing. */
      care: 4,
      expeditionSend: 2,
      revealBase: 6,
      revealPer5Min: 1,
      hatch: 40,
      evolve: 90,
      /** First ever placement of each item TYPE — the "reason to build"
       * lever, and the reason the catalog is worth 45 entries. */
      firstBuild: 25,
      firstJob: 20,
      /** Per produced job tick. The idle earner, and the biggest single
       * absence source: ≤ 96 ticks per capped absence per station. Rewarding
       * absence is correct (spec §4.4) but this is the number to lower first
       * if playtest says active play feels pointless (bible §8.6 risk 7). */
      jobTick: 1,
      bountyComplete: 15,
      bountyDayClear: 25,
      /** CLAIM_STREAK_REWARD: base + perTier × the streak's bonus tier. */
      streakDayBase: 20,
      streakDayPerTier: 5,
      rosterUpgrade: 60,
      /** Mastery tier gained: this × the new tier (25 → 125). Idempotent on
       * `counters["masteryTier.<pipId>.<biomeId>"]`. */
      masteryTierPerTier: 25,
      albumSeen: 10,
      albumCaught: 50,
      albumVariant: 35,
      /** Long Meadow FIRST arrival only (`visits === 0`), so a
       * retrieve → retire loop pays nothing the second time. */
      sanctuaryFirstArrival: 20,
      /**
       * Bands for `MilestoneDef.xp` (a new required content field). Sized
       * so the ~2,200 XP earnable before tier 12 is ~22% of `levelXp[12]`:
       * enough that milestones feel like progress, little enough that the
       * ladder is not a milestone checklist. Pinned by
       * `content/milestones.test.ts` at < 30%.
       */
      milestoneBands: {
        firstHour: 15,
        firstDay: 30,
        firstWeek: 60,
        longHaul: 120,
        /** The 11 new one-per-Keep-tier milestones, by tier band. They cost
         * nothing to build: `bumpCountersForAction` already writes a GENERIC
         * `keepLevel<N>Reached` counter, and they give the tier-9 Chronicle
         * its whole data source for free (`milestones.earned` is already
         * `id → earnedAt`). */
        keepTierEarly: 40,
        keepTierMid: 80,
        keepTierLate: 150,
        keepTierTop: 220,
      },
    },

    /**
     * THE BAR-MOVEMENT GUARANTEE, as four asserted fractions of the CURRENT
     * TIER's bar (bible §0.2). These are the anti-grind contract: they are
     * checked for every tier, so a future steepening of `levelXp` fails
     * here rather than in playtest.
     *
     * Rendering carries the last mile and is not optional: a `+N XP` chip
     * flies into the bar on every grant, the fill animates with a 2px
     * minimum advance (a "tick floor", so a sub-pixel grant still visibly
     * nudges), and the numerals always change. A single Pet at tier 12 is
     * 0.17% — half a pixel of fill, but a visible `+4`.
     */
    barVisibility: {
      /** One care action (4 XP). */
      minCareActionFraction: 0.0015,
      /** A canonical 6-tap care round + one Meadow round-trip (33 XP). */
      minCareRoundPlusTripFraction: 0.012,
      /** One engaged session: roster care round + 4 quick trips + 1 deep
       * trip + the day's three bounties and day-clear + the streak day. */
      minSessionFraction: 0.08,
      /** One full capped absence with a single Gathering Station staffed
       * (96 ticks) — so an absence ALONE visibly moves the bar. */
      minCappedAbsenceFraction: 0.04,
    },

    /**
     * BUILDING EFFECT CAPS. Every channel is summed ONCE across every
     * placed item and every active set bonus, then clamped ONCE here —
     * sum-then-clamp, never multiply-then-clamp, for the same two reasons
     * `retention.loot` gives: the player can read it, and nothing can
     * compound.
     *
     * `comfortReductionMax` is the fragile one (see the block header). The
     * worst-case arithmetic it protects, in full: the leave-safe window
     * drop is `-needDecayPerHour[need] × personalityMultiplier × 16h`, whose
     * maximum is Chaotic cleanliness at 74.0. At ×0.75 that is 55.5, so a
     * 90 save returns at 34.5 — under the Grumpy line of 40, over the
     * `sulkExitThreshold` of 25, and far over Miserable's 15. Every
     * personality's LOWEST need lands in [34.5, 38.9]: a maximally-built
     * Keep never Sulks and never comes home Content. The chore got
     * shorter; the care did not become optional.
     *
     * LOOT AND EGG CHANCE DELIBERATELY HAVE NO ENTRY HERE. Building loot
     * bonuses feed `retention.loot.bonusRollChanceMax` (0.25) and building
     * egg points feed `retention.loot.eggChanceBonusPointsMax` (0.05) —
     * round 2C's EXISTING single channels, not new ones. That is what keeps
     * a fully-buffed veteran at ≤ 1.25× the yield the economy was tuned for
     * and stops buildings re-ordering the biomes.
     */
    effectCaps: {
      /** Per need, as a fraction of decay removed. THE fragile number. */
      comfortReductionMax: 0.25,
      /** Multiplier on `care.rest.energyPerHour`. At the cap a full
       * 0 → 100 nap is 6m15s, still clearing balance.test.ts's "a nap must
       * be at least 5 minutes — long enough to be a thing you WATCH". */
      restSpeedMax: 1.6,
      /** Floor on the expedition-duration multiplier from buildings alone.
       * 0.85 is EXACTLY Hardworking's quirk, so a building can never
       * out-do a personality's identity. */
      expeditionSpeedMin: 0.85,
      /** Floor once a building's multiplier composes with Hardworking's
       * (0.85 × 0.85 = 0.7225 → clamped): the best possible trip is −25%.
       * `reachability.test.ts` measures a building-free economy, so it
       * measures a strictly SLOWER one — safe direction. */
      expeditionSpeedFloorWithQuirk: 0.75,
      /** Floor on the egg-incubation multiplier. A 2h egg becomes 1h36m,
       * so `incubation + pipling.durationMs` stays well under the 12h
       * balance.test.ts pins. */
      incubationSpeedMin: 0.8,
      /** Cap on the summed Keep XP bonus. The only compounding-adjacent
       * loop in the round (more building → more XP → more tiers → more
       * building); bounded here, and bible §1.6's day-11+ income row
       * already assumes it, so the wall-clock table holds. */
      xpBonusMax: 0.25,
    },

    /**
     * THEMED SET BONUSES — the mechanic that makes building feel like
     * collecting rather than tidying (bible §3.5). Six biome-themed sets in
     * `content/decorSets.ts`; the bonus counts DISTINCT member itemIds
     * currently placed, so five Moss Tufts is one member.
     *
     * The two `liveAtKeepLevel` values are what make tiers 3 and 6 land as
     * headlines: before tier 3 a decoration is worth 1–2%; after it, a
     * themed corner is a real Keep-wide perk. The tier-2 (5-member) bonus
     * REPLACES the tier-1 (3-member) bonus rather than stacking with it —
     * one clamp, one readable number.
     */
    setBonus: {
      minMembersTier1: 3,
      minMembersTier2: 5,
      tier1LiveAtKeepLevel: 3,
      tier2LiveAtKeepLevel: 6,
    },

    /**
     * Extra roster slots granted by Keep TIER, on top of the shipped
     * `rosterCap` / `rosterCapUpgraded` pair (spec §7.4's 3 → 5 Cozy Bunks
     * upgrade is untouched — only its `prerequisiteLevel` moves 3 → 4, to
     * the tier that opens the Shore its shell/driftwood cost is priced in).
     *
     * A sixth bed at tier 11 is the single most wanted thing for a
     * collection player, and it costs NO schema change: the cap becomes
     * `base + (bunks ? 2 : 0) + bonusByLevel[level]`, all derived.
     */
    rosterCapBonusByLevel: { 11: 1 } as Readonly<Record<number, number>>,

    /**
     * THE MANDATORY MITIGATION, DONE (round 2F implementation): tiers 2
     * and 3 below were BYTE-IDENTICAL to the shipped `keepLevelCosts` the
     * design pass could not touch. Now that `core/keep`'s `KeepLevel`
     * union is widened, `keepLevelCosts` is DELETED (this is the single
     * source of truth) and `content/keep.ts` reads ONLY
     * `progression.levelCosts` — closing the two-numbers-in-two-files trap
     * round 2B documented before it could open. `content/keep.test.ts`
     * pins tiers 2/3 byte-identical to the values that shipped.
     *
     * ROUND 2J — ALL ELEVEN NON-STARTING TIERS ARE NOW PRICED
     * (docs/economy-bible.md §2). The paragraph this replaces explained why
     * only five of eleven could be: with four resources and six
     * expeditions, `core/economy/reachability.test.ts`'s 3h/≥0.95-over-200-
     * seeds bar caps the top bundle near `wood 45 / fiber 45 / shell 12 /
     * driftwood 8` — about 3.5× level 2's 33.3 expected minutes — so a
     * twelve-tier ladder priced only in those four resources was
     * arithmetically impossible. Rounds 2B, 2C and 2F each asked for a
     * fifth resource for exactly this reason. Round 2J adds **lodestone**
     * (`core/economy`'s `RESOURCE_IDS`, sourced from Snowdrift/Shore/
     * Lanterngrotto — `content/expeditions.ts`), which raises the ceiling
     * to `wood ≤52 / fiber ≤54 / shell ≤13.9 / driftwood ≤8.0 /
     * lodestone ≤20` at z = 2.33 (≈137 expected minutes, 4.1× level 2's) —
     * enough for eleven strictly-increasing prices, not because any one
     * bundle got so much bigger, but because five independent levers at
     * different granularities (1 wood ≈ 2.65 min, 1 lodestone ≈ 5.8 min,
     * 1 driftwood ≈ 10.9 min) let eleven tiers separate cleanly where five
     * resources' worth of levers could not (bible §0.1).
     *
     * TIERS 2 AND 3 ARE BYTE-IDENTICAL to what shipped — the on-ramp
     * arithmetic (`content/keep.test.ts`'s pins, the Gathering-Station
     * ratio) is untouched by construction. TIER 4 IS DELIBERATELY
     * LODESTONE-FREE even though it could legally be priced in it: tier 4
     * is the tier that UNLOCKS the Shore (lodestone's own faucet), and
     * pricing a tier in the resource its own unlock supplies is the exact
     * deadlock shape `reachability.test.ts`'s fourth regression pin exists
     * to catch — staying a tier clear of it is free defensiveness (bible
     * §2.1). TIERS 5–10 bind on lodestone — the moment the Shore opens,
     * the resource you are waiting for changes, which is the most legible
     * progression signal this economy has produced. TIERS 11–12 bind on
     * wood again: lodestone's per-tier price stops climbing at 19 (z = 2.5;
     * at 20 it drops to 2.35, and a marginal margin compounded across five
     * resources is how a 200-seed suite goes flaky), so the last two tiers
     * escalate in the oldest resource in the game instead.
     *
     * Every column is non-decreasing tier-over-tier (a player comparing two
     * upgrade cards should never see a later tier ask for LESS of
     * something), and the escalation chain, in the units the suite measures
     * (`expectedMinutesToAfford(tier − 1, cost)`), is strictly increasing
     * end to end:
     *   tier 2  33.3 → 3  66.7 → 4  69.7 → 5  80.0 → 6  87.2 → 7  93.0 →
     *   8  98.8 → 9  104.7 → 10  110.5 → 11  116.5 → 12  127.1
     * Lowest afford rate anywhere: 0.9960 (tier 12), clearing the suite's
     * 0.95 bar by ≥ 4.6 percentage points on every row (economy bible §2.3).
     */
    levelCosts: {
      2: { wood: 5, fiber: 6 },
      3: { wood: 22, fiber: 14 },
      4: { wood: 25, fiber: 18 },
      5: { wood: 27, fiber: 20, lodestone: 12 },
      6: { wood: 28, fiber: 22, shell: 5, lodestone: 15 },
      7: { wood: 30, fiber: 24, shell: 6, driftwood: 2, lodestone: 16 },
      8: { wood: 32, fiber: 26, shell: 7, driftwood: 3, lodestone: 17 },
      9: { wood: 34, fiber: 28, shell: 8, driftwood: 4, lodestone: 18 },
      10: { wood: 38, fiber: 30, shell: 9, driftwood: 5, lodestone: 19 },
      11: { wood: 44, fiber: 32, shell: 10, driftwood: 6, lodestone: 19 },
      12: { wood: 48, fiber: 34, shell: 11, driftwood: 7, lodestone: 19 },
    } as Readonly<Record<number, ResourceBundle>>,

    /**
     * Grid growth per tier (bible §2.2). The shipped `keepGrid.growthPerLevel`
     * is DELETED (same mitigation as `levelCosts` above) — this is the
     * single source of truth `core/keep`'s `gridBounds` reads. Tier 2's
     * `+4 rows` entry is byte-identical to the shipped one and a test
     * asserts it.
     *
     * 8×8 → 8×12 → 10×12 → 10×14 → 12×14. STOPS at 168 tiles on purpose:
     * spec §1's perf budget is "60fps with 5 animated Pips + 30
     * decorations", and 168 tiles already hosts 60–80 placeables. That is
     * the round's largest technical risk (bible §8.6 risk 9) and the first
     * lever if the measurement fails is to drop this table's tier-9 entry.
     */
    gridGrowth: {
      2: { cols: 0, rows: 4 },
      5: { cols: 2, rows: 0 },
      7: { cols: 0, rows: 2 },
      9: { cols: 2, rows: 0 },
    } as Readonly<Record<number, { cols: number; rows: number }>>,

    /**
     * RENOWN — what the bar does after tier 12 (bible §1.7). Every
     * `xpPerLevel` past `levelXp[11]` grants one Renown level, shown on the
     * XP bar's chip ("Lv 12 · Renown 3") and on the Keep upgrade card's own
     * Renown line. That is the whole of it, and it is deliberately the whole
     * of it: never power, never resources, never a cap change. It exists for
     * exactly one reason — the bar must never be full and dead — and it is
     * honestly a reason not to MIND that you did not open the app rather
     * than a reason to open it (bible §7.5 says so out loud, and recommends
     * round 2D's Pip identity as the real day-30 answer). At an engaged
     * 750/day a Renown level is four days; at a casual 190/day it is a
     * fortnight.
     *
     * RENOWN NOW ACTUALLY PAYS. It shipped granting literally nothing: this
     * block's `flairEveryLevels: 5` was deleted on the grounds that
     * `content/flair.ts` had no Renown entries to mint, which left the reward
     * for clearing a Renown level as the chip's own text changing. Since tier
     * 12 lands around day 17 on the bible's income model, that made the
     * entire named ladder exhausted from day 17 with nothing behind it — the
     * exact opposite of §1.7's job. Both halves are now real:
     *
     *   - `content/flair.ts` ships TWELVE `renown-*` flourishes, one per
     *     level, spread across all five flair kinds (Album cover stamps and
     *     ribbons, two page frames, two Pip titles, three gate signs).
     *   - `flairEveryLevels: 1` — EVERY level mints one, not every fifth.
     *     At every fifth (the original figure) a flourish cost 15,000 XP ≈ 20
     *     engaged days, which is not a reward, it is a rumour.
     *   - `core/state.ts`'s `applyKeepXpForAction` grants them (multi-level
     *     jumps included), `ui/xpBar.ts` names the next one on the bar, and
     *     `ui/keepUpgrade.ts` names the last one earned.
     *
     * `xpPerLevel` 3,000 → 2,000 for two reasons. It paces a Renown level at
     * ~2.7 engaged days / ~10.5 casual days, which is a real cadence rather
     * than a fortnight of nothing; and 3,000 was the one span in the game
     * that BROKE §0.2's own bar-movement floor (a 4-XP care action is 0.133 %
     * of 3,000, under the asserted 0.15 % minimum — the endgame bar moved
     * less than the contract allows, one row past where `levelCurve.test.ts`
     * was looking). At 2,000 a care action is 0.20 % and the floor now covers
     * the Renown span too, asserted.
     */
    renown: { xpPerLevel: 2000, flairEveryLevels: 1 },

    /**
     * The perf GATE for this round, recorded here so it is a number and not
     * a hope (bible §8.6 risk 9): placed items that must hold 60fps with 6
     * Pips at 4× CPU throttle before the round can be logged. 2× spec §1's
     * shipped "30 decorations" budget, because the tier-9 grid can host
     * 60–80. If it fails, static-batch non-animated placeables first, then
     * drop `gridGrowth[9]`.
     */
    placementPerfBudget: 60,
  },

  /**
   * ROUND 2H — THE LIFECYCLE (docs/lifecycle-bible.md). Spec §16 v1.5 makes
   * Pips finite. Every number below is an answer to ONE question, and they
   * must be read together:
   *
   *   "can a player be surprised, punished for being away, or left with
   *    nothing?"
   *
   * The FIVE PROMISES are hard rules, not tuning values. Three of them are
   * enforced by RELATIONSHIPS between numbers in this block and numbers
   * elsewhere in this file, so those relationships are stated here and
   * asserted in `core/pips/lifecycle.promises.test.ts`:
   *
   *   1. `ailments.minDurationMs (36h) > offlineRateCapMs (16h)` — a Pip
   *      that is HEALTHY when the app closes can never be critical when it
   *      opens, however long the absence.
   *   2. Ailment countdowns are stored as REMAINING time, not as an end
   *      timestamp: they are a RATE, so §4.5's cap governs them ("rates are
   *      capped, timers are not"), and `ailments.vigilFloorMs` means an
   *      absence can never itself be the final straw.
   *   3. The `lost` transition exists ONLY in the live TICK arm. No
   *      catch-up pass may remove a Pip. The loss moment is always
   *      witnessed.
   *
   * ⚠️ THE FRAGILE INVARIANT OF THIS ROUND (the equivalent of round 2B's
   * level-1 wood ceiling, 2C's isolation rule and 2F's
   * `comfortReductionMax`): `level.seasoning` DOES NOT GET ITS OWN CAP. A
   * Pip's seasoning and the Keep's building comfort are ONE channel, summed
   * once and clamped once at `progression.effectCaps.comfortReductionMax`.
   * The arithmetic that forces this, in full: the binding personality is
   * Curious, whose worst window drop is `3.7 × 1.15 × 16h = 68.08`, and
   * "still Grumpy from a 90 save" requires `68.08 × (1 − r) > 50`, i.e.
   * `r < 0.26557`. Comfort already spends 0.25 of that. **There are 1.557
   * percentage points of decay-reduction headroom in the entire game**, so a
   * second independent channel is not unwise, it is arithmetically
   * unavailable. Guarded by `core/pips/level.balance.test.ts`.
   *
   * ⚠️ THE ISOLATION RULE STILL BINDS (see `retention`'s doc comment).
   * Nothing here edits `needDecayPerHour`, `personalityDecayMultipliers`,
   * `care.*`, `foods.*`, `offlineRateCapMs`, `sulkExitThreshold` or
   * `playRefusal`. Seasoning is a subtraction INSIDE round 2F's existing
   * fifth factor, clamped against that factor's remaining headroom, and is
   * exactly 0 at level 1 — so `core/pips/balance.test.ts` and
   * `core/keep/effects.balance.test.ts` both stay green BYTE-IDENTICAL.
   */
  lifecycle: {
    /**
     * PER-PIP LEVELS (bible §1). A second, smaller ladder that belongs to
     * the PIP; `keepXp` remains THE bar (progression bible §0.1 is
     * satisfied, not overturned — see bible §1.0's four-row table).
     *
     * Cumulative XP to reach each level, indexed by level − 1. Deltas are
     * 40 · 70 · 110 · 160 · 220 · 300 · 400 · 550 · 750. At ~180 pip XP/day
     * (engaged) that is level 2 in the first session, level 6 on day 3, and
     * level 10 at day 14.4 — DELIBERATELY past a typical 11-day lifespan.
     * Most Pips retire at 8–9; level 10 belongs to a Pip whose life was
     * extended, or (far more often) to a descendant who hatched at level 5.
     * The LINE maxes out; the individual usually does not.
     *
     * Bar movement, the round-2F contract applied to the shorter ladder:
     * one care action at the top level is 3/750 = 0.40 %, a Meadow
     * round-trip 1.33 % — both clear `progression.barVisibility`'s floors.
     */
    level: {
      maxLevel: 10,
      levelXp: [
        0, 40, 110, 220, 380, 600, 900, 1300, 1850, 2600,
      ] as readonly number[],

      /**
       * XP a PIP earns for what IT did. Every row is already rate-capped by
       * a shipped mechanism (cooldowns and full bars for care, one-Pip-per-
       * trip for expeditions, `offlineRateCapMs` for job ticks), which is
       * the same structural rule `progression.xp` encodes.
       *
       * `jobTick: 1` is deliberate and is the row to read twice. One capped
       * absence with a Pip on a station is 96 XP; an engaged day of care and
       * quick trips is ~100. THE WORKHORSE AND THE ADVENTURER LEVEL AT THE
       * SAME PACE — that is the answer to "the casual player's Pips never
       * develop", and active play is already protected by the Keep bar, the
       * mastery ladder and the loot economy.
       *
       * `tripBase + tripPer5Min × ⌊durationMs / 5min⌋` gives Meadow 10,
       * Forest 14, Shore 20, Bramblewick 24, Snowdrift 32, Grotto 44 — per
       * MINUTE the Meadow still wins (2.0 vs 0.49), so round 2B's
       * "active play beats idle play" shape survives into a third XP table.
       */
      xp: {
        care: 3,
        tripBase: 8,
        tripPer5Min: 2,
        jobTick: 1,
        ailmentSurvived: 60,
        evolve: 60,
        masteryTierPerTier: 20,
      },

      /**
       * WHAT A LEVEL BUYS, indexed by level − 1. Six channels; only the
       * first is shared (see the block header).
       *
       * `seasoning` — decay reduction, summed into round 2F's comfort
       * channel and clamped with it at `comfortReductionMax`. At 0.12 on an
       * UNBUILT Keep every personality still comes home Grumpy from a 90
       * save (worst: Chaotic cleanliness 74.0 × 0.88 = 65.12 → 24.88), which
       * is inside `core/pips/balance.test.ts`'s own shipped [15, 45]
       * personality-sweep band. The leave-safe margin only ever WIDENS:
       * the tightest shipped pair (Hardworking/happiness, 6.64) becomes
       * 14.24 at level 10 unbuilt and 22.48 on a maxed Keep.
       *
       * `expeditionSpeed` composes with buildings AND Hardworking's quirk
       * and is floored by the SHIPPED
       * `progression.effectCaps.expeditionSpeedFloorWithQuirk` (0.75) — an
       * authorised TIGHTENING of that value's meaning (it now binds on
       * three factors instead of two, i.e. on strictly more combinations).
       * `reachability.test.ts` measures a level-1 save, so it measures the
       * SLOWER economy: the safe direction, exactly as round 2F argued.
       */
      seasoning: [0, 0.01, 0.02, 0.03, 0.05, 0.06, 0.08, 0.09, 0.11, 0.12],
      expeditionSpeed: [1, 0.99, 0.98, 0.97, 0.97, 0.96, 0.96, 0.95, 0.95, 0.94],
      contractReduction: [0, 0.04, 0.08, 0.12, 0.16, 0.2, 0.25, 0.3, 0.35, 0.4],
      countdownExtend: [1, 1.03, 1.06, 1.09, 1.12, 1.15, 1.2, 1.25, 1.3, 1.35],
      cureBonus: [0, 0.02, 0.04, 0.06, 0.08, 0.1, 0.12, 0.14, 0.16, 0.18],
      lifespanBonus: [0, 0.04, 0.08, 0.12, 0.16, 0.2, 0.24, 0.28, 0.32, 0.36],

      /** Granted to EVERY Pip (active and resident) by the v8 → v9
       * migration, with `pipXp` set to `levelXp[1]`: a veteran's Pips arrive
       * with a season already behind them. 0.01 seasoning — no guard moves. */
      migrationGrantLevel: 2,
    },

    /**
     * LIFESPAN (bible §2). THE AGEING RULE, stated once: a Pip's life is
     * measured in `lifeMs`, a NEW clock that advances with RATED time only —
     * live ticks 1:1, an absence by `min(elapsed, offlineRateCapMs)`. Ageing
     * is a RATE, not a timer.
     *
     * This is not a stylistic choice, it is promise 2 and promise 5 in the
     * same line of code. `ageMs` accrues across the ENTIRE absence window
     * (catchup.ts's `accrueFrozenTime`, because the lifetime happiness
     * average needs it), so a lifespan keyed off `ageMs` would retire a
     * whole roster over one three-week holiday and hand the player back an
     * empty Keep. With this rule, three weeks away ages a Pip by 16 hours.
     *
     * `ageMs` keeps its two existing jobs — evolution readiness at 72h and
     * the happiness average — UNCHANGED. Two clocks is a real cost, paid
     * down by never displaying either as a number: `ageMs` shows as a hatch
     * date, `lifeMs` shows as a named season and nothing else. There is no
     * lifespan bar and no countdown anywhere in this system.
     *
     * `baseMs` 7 days, multiplied by care quality (×0.85 … ×1.35),
     * `level.lifespanBonus` (up to +36 %) and building `longevity` (up to
     * +25 %): a neglected Pip lives 6.4 days, an ordinary one 10.7, a
     * devoted player's 15.6. "Roughly 1–2 weeks of active play", with CARE
     * QUALITY worth ~59 % of a lifetime — which is the whole point.
     *
     * Because the multiplier is derived live, a lifespan can GROW after the
     * fact and a Pip can leave the Elder season again. That is deliberate
     * and is the kindest reading available.
     */
    lifespan: {
      baseMs: 7 * 24 * HOUR_MS,
      /** Lifetime avg happiness (`happinessIntegral / ageMs`) → multiplier.
       * Evaluated highest-`min`-first, like every band table in this file. */
      careQualityBands: [
        { min: 80, multiplier: 1.35 },
        { min: 65, multiplier: 1.2 },
        { min: 50, multiplier: 1.05 },
        { min: 30, multiplier: 0.95 },
        { min: 0, multiplier: 0.85 },
      ] as readonly { readonly min: number; readonly multiplier: number }[],
      /** Cap on the summed building `longevity` effect. Three ALREADY-
       * SHIPPED placeables carry it (nest-warmer 0.06, sun-bunks 0.10,
       * larder 0.05 = 0.21), so the round adds no build item for this. */
      buildingBonusMax: 0.25,
      /** Season boundaries as a fraction of `lifeMs / lifespanMs`. Derived,
       * never stored — retuning re-grades every Pip with no migration, the
       * same discipline 2C's mastery tiers use. */
      seasons: { young: 0.2, prime: 0.55, seasoned: 0.8 },
    },

    /**
     * AILMENTS (bible §3). The ONLY thing in PipsKeep that can take a Pip,
     * and it can only ever be contracted by completing a DEEP expedition.
     *
     * Explicitly and permanently absent, because each would be caused by
     * absence and promise 2 forbids it: illness from neglect (needs at 0 is
     * still Sulking, forever, exactly as §4.4 has always said), illness at
     * home, illness from a job or a nap. And nothing anywhere may ever RAISE
     * a contract chance — not an event (2C: an event may only make something
     * easier), not a building, not a setting, not a broken streak.
     *
     * Quick trips are safe; deep trips carry risk. That maps exactly onto
     * round 2B's shipped quick/deep identity and gives the player one
     * sentence to remember. NO LEVEL-1 EXPEDITION CHANGES, so the level-1
     * wood ceiling is untouched.
     *
     * Per-biome chance and countdown live in `content/ailments.ts`; the
     * numbers here are the ones that make the promises true.
     */
    ailments: {
      /**
       * ⚠️ MUST EXCEED `offlineRateCapMs` (16h). Asserted directly. This one
       * inequality is why a Pip that is healthy when the app closes can
       * never be critical when it opens. The shortest shipped ailment
       * (Lanternfever) is exactly this.
       */
      minDurationMs: 36 * HOUR_MS,
      /**
       * THE VIGIL FLOOR. Within a CATCH-UP pass, `remainingMs` may be
       * reduced to no less than this; live time has no floor. So a returning
       * player always finds at least four hours of visible countdown and
       * every cure still on the table — an absence can never itself be the
       * final straw.
       */
      vigilFloorMs: 4 * HOUR_MS,
      /** Stage boundaries as a fraction of `remainingMs / totalMs`:
       * ≥ 0.60 settling, 0.25–0.60 worsening, < 0.25 grave. Derived. */
      stages: { settling: 0.6, worsening: 0.25 },

      /** Cure rolls. No cooldown gate — the limiter is poultices and the
       * day boundary, which are legible things the player already has. */
      poulticeCureChance: 0.55,
      devotedCareCureChance: 0.35,
      /** All four needs ≥ this while ailing earns the free daily roll. */
      devotedCareNeedFloor: 70,
      /** Each failed attempt makes the next likelier — visible, and the
       * same pity shape `retention.eggPity` already ships. */
      cureEscalationPerAttempt: 0.1,
      /** ONE summed channel (escalation + level + buildings), clamped once.
       * Worst realistic case — level 1, no buildings, no poultices, free
       * daily roll only, shortest ailment — survives at 83.9 %; three
       * poultices take it to 96.1 %; a level-6 Pip with a Poultice Shelf
       * clears 99 %. */
      cureBonusMax: 0.45,
      /** Summed contract reduction (level + buildings), clamped once. */
      contractReductionMax: 0.6,
      /** A cured Pip can NEVER contract that ailment again (the scar is an
       * immunity, not a debuff) and passes this fraction of that immunity to
       * its children. Lineage doing mechanical work, not just flavour. */
      inheritedResistance: 0.25,
    },

    /**
     * THE ANTI-BRUTALITY SHIELDS (bible §7). The owner's fear, in their
     * words: it "can't be brutal that a player loses their star too quickly
     * and are disappointed." Six independent shields; these are the four
     * that are numbers. The other two are structural (`minActivePips`, which
     * already ships, and the Quiet Keep toggle).
     */
    shields: {
      /**
       * A Pip whose `lifeMs` is under this cannot be LOST — its countdown
       * resolving to zero fires the Loyal Turn instead (it pulls through,
       * keeps the scar, keeps the immunity).
       *
       * 3 days, not 7: seven would be half a typical life and would drain
       * the stakes entirely, leaving the weight only on Pips who were about
       * to retire anyway. Three protects the attachment phase and the whole
       * of week one for the starter, and leaves 4–13 days of genuine
       * vulnerability.
       *
       * Shielded Pips CAN still contract ailments, on purpose: a player's
       * first ailment is then a frightening story with a guaranteed happy
       * ending that teaches the cure UI and hands out the first scar.
       */
      noLossBeforeLifeMs: 3 * 24 * HOUR_MS,
      /** The first time in a save's life that an ailment would take a Pip,
       * it doesn't. Once ever, keyed on `counters["ailment.graceUsed"]`,
       * never refilled, never mentioned to the player. NO PLAYER WILL EVER
       * LOSE THEIR FIRST PIP. */
      firstLossGrace: true,
      /**
       * THE CAREFUL ROUTE — risk is opt-in per trip ("Take the long way
       * round"), offered only where `ailmentChance > 0`. One universal,
       * legible opt-out of all danger at an honest cost: half the yield per
       * minute. `reachability.test.ts` measures the NORMAL route and so
       * measures the faster economy — the safe direction.
       *
       * After this, every loss in PipsKeep is downstream of a choice the
       * player made twice: once to take a deep trail, once to take it fast.
       */
      carefulRouteDurationMultiplier: 1.5,
      carefulRouteLootMultiplier: 0.75,
    },

    /**
     * LINEAGE (bible §5–§6) — promise 4, and the succession mechanic.
     *
     * A lost Pip's egg is found on the FIRST trip back to the biome that
     * took them at 0.40, and is GUARANTEED on the second. Expected 1.6
     * trips. Two numbers a player can hold in their head — "go back; she'll
     * be there the first or second time" — and NO TAIL. This deliberately
     * breaks the codebase's pity-ladder habit: a long shoulder is what makes
     * a chase feel unfair, and this chase begins in grief.
     *
     * BREEDING IS UNFENCED (spec §12 amended). `combineGenomes(a, b, rng)`
     * has been implemented, tested and called by nothing since Phase 4; it
     * goes live UNCHANGED, at its exact 6-roll contract. A lineage egg calls
     * it with the SAME genome twice — every parent-pick is degenerate while
     * the mutation branch still fires, so the child is the parent give or
     * take a freckle, and `genome.test.ts` does not move.
     *
     * THE ALBUM CANNOT BE TRIVIALISED, and it is the shipped function that
     * guarantees it: `combineGenomes` picks `speciesId` from one of the two
     * PARENTS, consulting no rarity table and no biome pool, and
     * `genome.speciesId` is always the BIRTH species. So breeding can never
     * produce a species the player does not already own, and never an
     * evolved form. Evolution stays earned (v1.3's standing rule); the
     * 14-form Album is still walked by expeditions alone.
     *
     * `shiny` is rolled by the CALLER from the `lineage` stream, OUTSIDE
     * `combineGenomes` (which hard-codes `shiny: false` and must keep its
     * 6-roll contract) — losing a shiny Pip must not quietly delete a
     * 1-in-40 thing.
     */
    lineage: {
      findChanceFirstTrip: 0.4,
      guaranteedAfterTrips: 2,
      /** A descendant hatches at `1 + floor((parent − 1) × share)`. A parent
       * lost at level 9 leaves a child at level 5 — the line does not start
       * over. Breeding's share is LOWER on purpose (below): a lost parent's
       * legacy should be the stronger inheritance, thematically and to stop
       * breeding becoming the efficient way to manufacture levels. */
      lostParentLevelShare: 0.5,
      bredLevelShare: 0.35,
      shinyInheritChance: 0.5,

      breedMinLevel: 3,
      /** All four needs, both parents. The only gate that is really a care
       * check — no bond stat is invented; a second relationship system in a
       * round that already adds two clocks would be one too many. */
      breedMinNeed: 60,
      /** Wall-clock, not rated: an absent player's cooldown ticks for free. */
      breedCooldownMs: 24 * HOUR_MS,
      /** Lifetime, per Pip. Stops a two-Pip factory filling every roster
       * slot with hatchlings and turning `rosterCap` into the only real
       * constraint. Three reads as natural rather than as a quota. */
      maxClutchesPerPip: 3,
      /** Twice a found egg (`eggs.incubationMsDefault`). A clutch is a
       * bigger thing. */
      breedingIncubationMs: 4 * HOUR_MS,
    },

    /**
     * KEEP XP for the new moments (bible §9.3), sized against
     * `progression.xp`'s own atom. Adding sources only ever makes the bar
     * move MORE, which is the safe direction for
     * `core/progression/levelCurve.test.ts`'s floors, and none of these is a
     * milestone so `content/milestones.test.ts`'s < 30 % ratio is untouched.
     *
     * `pipLevel` is the only compounding-adjacent loop and is bounded twice:
     * `level.maxLevel` per Pip, and idempotence on
     * `counters["pipLevel.<pipId>.<level>"]` so roster churn re-grants
     * nothing (progression bible §0.1's fourth reason, preserved).
     *
     * A LOSS GRANTS ZERO, and costs zero. Grief is never monetised, in
     * either direction. `progression.xp.sanctuaryFirstArrival` must
     * therefore be gated on `reason !== "lost"`.
     */
    keepXp: {
      ailmentCured: 30,
      pipLevel: 10,
      retirementWitnessed: 40,
      lineageEggFound: 50,
      breedEgg: 20,
    },
  },

  /**
   * ROUND 2I — NOTIFICATIONS (docs/notifications-bible.md). Live as of the
   * build round: `src/ui/notificationAsk.ts` / `notificationSettings.ts`
   * consume `permissionAsk`; the scheduling side (`src/app/notifications/`
   * — plan/budget/channel) consumes the rest. Uncommented once, here, so
   * both halves of the round read the same numbers instead of each
   * inventing their own copy.
   */
  notifications: {
    // Bible §4.1 — dropped, never deferred. Local wall-clock hours,
    // derived from `GameState.dayOffsetMs` (no timezone library:
    // tzOffsetMs = dayOffsetMs - retention.dayStartHour * HOUR_MS).
    quietHours: { startHour: 22, endHour: 8 },

    // Bible §4.2 — volume. `maxPerDay` is counted per the SAME 04:00-local
    // dayIndex the streak and bounties use, so the whole game rolls over
    // together. `minGapMs` is the real spam control: three back-to-back
    // 5-minute Meadow trips can never produce three buzzes.
    maxPerDay: 4,
    minGapMs: 25 * MINUTE_MS,
    coalesceWindowMs: 10 * MINUTE_MS,
    maxNamesInBody: 3,

    // Hidden-tab timers are throttled to ~1/min after five minutes hidden,
    // so a delivery may be up to a minute late. That is handled by the COPY
    // rather than by a number: no notification string may contain a time
    // word, which copy.test.ts enforces. (The bible's `timerSlopMs` and
    // `maxClausesPerNotification` are deliberately absent — see
    // core/notifications/types.ts for why they were removed rather than
    // shipped as knobs that turn nothing.)

    // Bible §3 — the EARNED ask. Never on first launch; never during
    // onboarding; only from a tap, `delayAfterSendMs` after the departure
    // trot of the first qualifying expedition send. A soft dismiss may be
    // re-asked after `reAskAfterSends` more sends, to `maxAsks` lifetime.
    // An explicit "No thanks" or a browser deny is FINAL — never re-asked.
    permissionAsk: {
      afterExpeditionSends: 1,
      delayAfterSendMs: 3 * SECOND_MS,
      reAskAfterSends: 3,
      maxAsks: 2,
    },

    // How late is too late. A timer that fires long after its moment (a
    // laptop lid closed overnight, a frozen tab thawed days later) has
    // nothing useful left to say, so `dueNotifications` drops anything
    // older than this rather than buzzing about it.
    //
    // ROUND-2I REVIEW FIX: this replaces `outbox: { horizonMs, maxEntries }`
    // and `periodicSyncMinIntervalMs`. Both described the Tier-2 outbox and
    // periodic-sync path this round cut, and NOTHING read either — exactly
    // the dead-knob shape the comment above already calls out for
    // `timerSlopMs`/`maxClausesPerNotification`. This one is read on every
    // recompute (core/notifications/index.ts).
    staleAfterMs: 24 * HOUR_MS,
  },

  /**
   * ROUND 2J — CRAFTING (docs/economy-bible.md §3). ⚠️ DESIGN PASS ONLY:
   * NOTHING READS THIS BLOCK YET. It is written now, next to the economy
   * numbers it has to be read against, so the build round argues with a
   * committed set of numbers instead of inventing its own.
   *
   * The companion half of this round — the fifth resource (`lodestone`) and
   * the eleven re-priced Keep tiers — is deliberately NOT here: those are
   * edits to `expeditions.lootRolls` and `progression.levelCosts`, i.e. to
   * EXISTING values, and this design pass may not move an existing value.
   * They are specified in economy-bible §1.2 and §2.2 with their arithmetic.
   *
   * ⚠️ THE FRAGILE INVARIANT OF THIS ROUND (the equivalent of round 2B's
   * level-1 wood ceiling, 2C's isolation rule, 2F's `comfortReductionMax`
   * and 2H's shared seasoning channel) lives in that other half and is
   * restated here because this is the file it would be violated from —
   * THE ZERO-DILUTION IDENTITY (bible §1.2):
   *
   *   newRolls × oldSum === oldRolls × (oldSum + lodestoneWeight)
   *
   * for all three biomes that gain lodestone (Snowdrift 12→15 rolls / +26,
   * Shore 6→9 / +50, Lanterngrotto 14→16 / +14). Scaling the rolls in exact
   * proportion to the new weight sum is what leaves EVERY existing per-trip
   * and per-minute yield in the game byte-identical. Change one of those six
   * numbers and six pinned claims across three files break at once — the
   * Shore's 0.09000 shell/min, its 0.06000 driftwood/min, the Feastpot's
   * 1-per-3.5-trips cadence, both quick-beats-deep items/min pairs, and the
   * whole tier-5→12 escalation chain — and it will present as a confusing
   * minute-count failure in `reachability.test.ts`, not as "someone edited a
   * weight". Start at economy-bible §1.2.
   *
   * THREE RULES THIS BLOCK ENCODES (bible §0.2), stated so a future number
   * cannot quietly break one:
   *
   * 1. NOTHING CRAFTED TOUCHES NEED DECAY. Round 2H's arithmetic leaves
   *    1.557 percentage points of decay-reduction headroom in the entire
   *    game and building comfort has spent 0.25 of the 0.26557 available.
   *    So there is no `comfort` number in this block and no crafted item may
   *    ever carry one. `craftSpeed` and `pipLevelSpeed` are disjoint from
   *    `needDecayPerHour`, `care.*`, `foods.*` and `offlineRateCapMs`, which
   *    is why `core/pips/balance.test.ts`, `core/keep/effects.balance.test.ts`
   *    and `core/pips/level.balance.test.ts` all stay green byte-identical.
   * 2. NO RECIPE OUTPUTS A BASE RESOURCE. `reachability.test.ts` models
   *    expeditions as the only faucet; a recipe that produced wood — or
   *    lodestone — would be invisible to `resourcesObtainableAt` and could
   *    break the gating claim silently. Crafting consumes; it never mints.
   * 3. THE CURE CEILING DOES NOT MOVE. `lifecycle.ailments`' cure numbers
   *    are untouched: the Poultice becomes MAKEABLE, not stronger, and
   *    there is exactly one cure item in PipsKeep before and after.
   */
  crafting: {
    /** Keep tier the Craft Table appears on the Build sheet (bible §3.1).
     * One tier BEFORE the Lanterngrotto, so the answer to "my Pip came home
     * ill" exists before the riskiest trail in the game opens. */
    unlockKeepLevel: 4,

    /**
     * Craft durations are per-recipe content (`content/recipes.ts`); these
     * are the BOUNDS, so a future recipe cannot be authored as instant.
     * 30 minutes is the Simmering cadence — the slowest tick a player
     * already waits for comfortably; 90 is the Lanterngrotto, the longest
     * wait in the game. Nothing crafts faster than the game's own slowest
     * existing rhythm, which is what makes crafting a thing you set up and
     * come back to rather than a menu.
     */
    minDurationMs: 30 * MINUTE_MS,
    maxDurationMs: 90 * MINUTE_MS,

    /**
     * Orders waiting behind the one in flight. Sized against
     * `offlineRateCapMs`: three of the LONGEST recipe is 4.5h, comfortably
     * inside one capped absence, so a player who fills the queue and leaves
     * always comes back to all three done and never to a half-eaten queue.
     *
     * Crafting is a RATE and obeys §4.5's cap exactly like job production
     * (bible §3.5) — but because `maxDurationMs` is 1/10.7 of the cap, the
     * cap cannot bite until the queue has been empty for eleven hours. It
     * can never cost the player a craft they started; it only stops a bench
     * running for a week.
     */
    queueMax: 3,

    /**
     * SPEED. Multiply-then-clamp for the building channel (a multiplier IS a
     * "how many times", the same treatment `restSpeed`/`expeditionSpeed` get
     * in `core/keep/effects.ts`), then the Pip's own factor, then one
     * composite floor — stated separately for exactly the reason
     * `progression.effectCaps.expeditionSpeedFloorWithQuirk` is.
     *
     *   effective = base
     *             × clamp(∏ building craftSpeed, speedMin, 1)
     *             × pipLevelSpeed[level − 1]
     *             , floored at base × speedFloorWithLevel
     */
    speedMin: 0.9,
    speedFloorWithLevel: 0.82,

    /**
     * Per-Pip craft speed by level − 1 (round 2H's ladder, bible §3.7). A
     * SEVENTH channel, deliberately disjoint from `lifecycle.level`'s six —
     * and specifically NOT a decay channel, so 2H's fragile invariant (a
     * Pip's seasoning and the Keep's comfort are ONE clamped channel with
     * 1.557pp of headroom) is untouched. Exactly 1.0 at level 1, so every
     * existing fixture gets the identity.
     *
     * It also gives a workhorse Pip a second thing to be good at, which is
     * the first mechanic in the game where being a workhorse makes you
     * better at being a workhorse.
     */
    pipLevelSpeed: [
      1, 0.99, 0.98, 0.97, 0.96, 0.95, 0.94, 0.93, 0.92, 0.9,
    ] as readonly number[],

    /**
     * ⚠️ THE CURE CEILING (bible §4.1) — the number that keeps a craftable
     * Poultice from making ailments a formality.
     *
     * The honest arithmetic, because it is not the one people expect:
     * survival for a DETERMINED player is already ≈ 1 today (deep trails
     * drop poultices at 27%/37%/44% per trip and cure attempts are
     * uncapped). 2H's 83.9% floor is the UNLUCKY player's number, not the
     * ceiling. So crafting must raise the FLOOR — from "hope for a drop" to
     * "you can always make one, at a price" — without raising the RATE at
     * which anyone can attempt cures.
     *
     * Hence the guard is a CADENCE, not a chance: at the best equipment in
     * the entire game (`speedFloorWithLevel` 0.82 against the Poultice's
     * 75-minute recipe = 61.5 min) the best-equipped Keep produces 0.976
     * poultices per RATED hour — and countdowns are measured in rated time.
     *
     * ⚠️ ROUND 2J FIX STAGE: this number had ZERO consumers when the round
     * shipped — the file that two separate comments named as its guard,
     * `crafting.balance.test.ts`, did not exist. The invariant HELD, with
     * 1.5 minutes of margin, and nothing would have noticed it breaking:
     * dropping `speedFloorWithLevel` to 0.2 and the last `pipLevelSpeed`
     * entry to 0.2 produced a 15-minute Poultice with a fully green suite.
     * It is now asserted, against the REAL shipped tuning (not a fixture),
     * in `src/core/crafting/balance.test.ts`.
     */
    poulticeMinMinutesPerCraft: 60,

    /**
     * ⚠️ THE REMEDY AGGREGATE — read by `core/keep/effects.ts`, which sums
     * every placed item's `remedy` effect ONCE and clamps it here.
     *
     * Why it exists as a SEPARATE, tighter clamp than
     * `lifecycle.ailments.contractReductionMax` (0.60): a plain item's
     * `effects` contribute PER PLACEMENT. Set bonuses count distinct ids,
     * but ten Lodestone Cairns is ten contributions — already true of
     * `comfort` today. 0.60 is far too loose to be the ceiling on a
     * spammable crafted decoration, and a player who papers the Keep in
     * Cairns must not become immune. At this cap the whole game's
     * building-sourced remedy is: Poultice Shelf 0.10/0.05 + any number of
     * Cairns (0.04 each) and Herb Rails (0.03 each) → 0.15 contract
     * reduction and 0.06 cure bonus, and no further.
     *
     * ⚠️ SITING NOTE (unchanged, and still true): these two belong under
     * `lifecycle.ailments`, next to `contractReductionMax`/`cureBonusMax`.
     * They stay here because moving a live number a shipped test reads is
     * a separate, mechanical change and this round has moved enough.
     *
     * (Round 2J's design pass also parked `waybreadBonusRollChance` and
     * `trailKitContractReduction` in this block for the two PROVISION
     * recipes of bible §4.3. Those recipes were cut and the fix stage
     * REMOVED the numbers with them — a live tuning value with no consumer
     * is a number that drifts out of calibration unread, and "cut it
     * cleanly" is what §3.6 asks for. They are re-derivable from the bible
     * if a provisions round ever happens.)
     */
    buildingRemedyMax: { contractReduction: 0.15, cureBonus: 0.06 },

    /**
     * KEEP XP + PIP XP for the new moments, sized against
     * `progression.xp`'s own 4-XP care atom (these belong conceptually in
     * that block; same siting note as above).
     *
     * `firstCraft` mirrors `progression.xp.firstBuild` exactly — first time
     * each RECIPE is made, idempotent on `counters["crafted.<recipeId>"]`.
     * It is the "reason to try every recipe" lever, the same way firstBuild
     * is the "reason to build" lever, and it is why the book is worth
     * eleven entries instead of three.
     *
     * Adding XP sources only ever makes the bar move MORE, which is the
     * safe direction for `core/progression/levelCurve.test.ts`'s floors, and
     * the whole channel is rate-capped by station throughput (one craft at a
     * time, ≥ 30 minutes each): ~16 crafts/day/station is ~128 Keep XP
     * against an engaged 600–750/day.
     */
    keepXpPerCraft: 8,
    firstCraftKeepXp: 25,
    pipXpPerCraft: 5,
  },

  /** New saves are seeded with 3 Berries so the guided first Feed works
   * (§6.3). Item counts, not a cost bundle — Berries are food (inventory),
   * not a resource, so ResourceBundle deliberately does not apply here. */
  startingInventory: { berry: 3 } satisfies Readonly<Record<string, number>>,
} as const;

export type Tuning = typeof tuning;
