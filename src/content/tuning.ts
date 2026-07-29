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
   * `keepLevelCosts`). The Meadow is the ONLY wood source at Keep level 1,
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
     */
    snowdrift: {
      durationMs: 60 * MINUTE_MS,
      eggChance: 0.35,
      unlockKeepLevel: 2,
      lootRolls: 12,
    },
    shore: {
      durationMs: 30 * MINUTE_MS,
      eggChance: 0.18,
      unlockKeepLevel: 3,
      lootRolls: 6,
    },
    /**
     * ROUND 2B — the level-3 DEEP trip, and the top of the ladder. 90
     * minutes, the richest food table in the game (it is the only source
     * of the Emberloaf and the Feastpot), and a coin-flip egg chance on
     * the only pool a Lanternpip appears in. Still not a throughput win:
     * 14 rolls over 90 minutes is 0.156 items/min against the Meadow's
     * 0.60. You go for what only it has.
     */
    lanterngrotto: {
      durationMs: 90 * MINUTE_MS,
      eggChance: 0.5,
      unlockKeepLevel: 3,
      lootRolls: 14,
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
   * Keep level costs (spec §6.3); referenced by content/keep.ts.
   *
   * ROUND 2A — PROGRESSION DEADLOCK REPAIR. Both of these were priced in
   * resources that ONLY the level they unlock could supply:
   *   - Level 2 cost Wood; Wood dropped only in the Forest; the Forest
   *     unlocked AT level 2. (The reported deadlock.)
   *   - Level 3 cost Shell + Driftwood; both dropped only at the Shore;
   *     the Shore unlocks AT level 3. (The same bug, one tier up, not yet
   *     reached by any playtester.)
   *
   * The invariant now enforced by `core/economy/reachability.test.ts`:
   * every level is priced ONLY in resources the PREVIOUS level's
   * expeditions already drop.
   *
   * - Level 2 `{ wood: 5, fiber: 6 }`, payable from the Meadow alone
   *   (which now drops fallen twigs). BOTH resources have to land, and
   *   the binding one is stochastic, so the honest figure measured over
   *   300 fresh saves driven through the real reducer is a MEDIAN of 8
   *   trips / 35 minutes (mean 7.8 / 37.9, p90 50, worst seed 75) — not
   *   the 6.7 trips a wood-only division suggests. Median hits the
   *   owner's 30–45 minute target; the tail runs past it, which is what
   *   the Gathering Station on-ramp below exists to absorb. It came DOWN
   *   from 15/10 because level 1 has exactly one expedition and one Pip
   *   may be on it at a time, so early income is hard-capped no matter
   *   how many Pips the player has.
   * - Level 3 `{ wood: 22, fiber: 14 }`, payable from Meadow + Forest run
   *   in parallel ≈ 1 hour with two adult Pips (and the Forest is now
   *   genuinely the better Wood-per-minute source — see
   *   `expeditions.forest.lootRolls`). Shell/Driftwood move OFF the level
   *   ladder and onto the roster upgrade, which is purchasable at level 3
   *   — the moment the Shore that supplies them opens.
   */
  keepLevelCosts: {
    2: { wood: 5, fiber: 6 },
    3: { wood: 22, fiber: 14 },
  } satisfies Partial<Record<KeepLevel, ResourceBundle>>,

  /**
   * Placeable station costs (spec §9); referenced by content/placeables.ts.
   *
   * ROUND 2B — THE CASUAL ON-RAMP, MADE REAL. These live here, next to
   * `keepLevelCosts`, precisely because of the bug that put them here:
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
  } satisfies Readonly<Record<string, ResourceBundle>>,

  /**
   * Keep grid (spec §9): 8×8 starting area; Level 2 adds a +4×8 plot,
   * expressed as simple rows/cols growth per level (cumulative). Bounds
   * math lives in core/keep `gridBounds`.
   */
  keepGrid: {
    cols: 8,
    rows: 8,
    /** Extra cols/rows unlocked AT each Keep level (spec §9: L2 = +4×8,
     * i.e. 4 more rows at the same 8-column width). */
    growthPerLevel: {
      2: { cols: 0, rows: 4 },
    } satisfies Partial<Record<KeepLevel, { cols: number; rows: number }>>,
  },

  /** Roster upgrade cost (spec §7.4: Keep upgrade raises the cap 3 → 5;
   * purchasable at Keep level 3). Referenced by content/keep.ts. */
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
  },

  /** New saves are seeded with 3 Berries so the guided first Feed works
   * (§6.3). Item counts, not a cost bundle — Berries are food (inventory),
   * not a resource, so ResourceBundle deliberately does not apply here. */
  startingInventory: { berry: 3 } satisfies Readonly<Record<string, number>>,
} as const;

export type Tuning = typeof tuning;
