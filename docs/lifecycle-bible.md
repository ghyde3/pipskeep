# PipsKeep — The Lifecycle Bible (Round 2H)

> **This document is the design contract for spec §16 v1.5.** Where it and my own prose disagree,
> the FIVE PROMISES win. Where it and an existing guard suite disagree, the guard wins and I was
> wrong. Every number here lives in `tuning.lifecycle`; every rule here is written so a test can
> hold it.

---

## 0. THE FIVE PROMISES, RESTATED AS MECHANISMS

The owner reversed the game's oldest hard rule and replaced it with five promises. A promise that
lives only in copy is a promise that breaks in the first playtest. Each one below is bound to the
single mechanism that makes it true by construction, so that violating the promise requires
deleting a named thing rather than forgetting a subtlety.

| # | Promise | The mechanism that makes it true by construction |
|---|---|---|
| 1 | Loss is never a surprise | `minAilmentDurationMs (36h) > offlineRateCapMs (16h)`, and the `lost` transition exists **only** in the live `TICK` arm. There is no code path from healthy to gone. |
| 2 | Loss is never caused by absence | An ailment countdown is stored as **`remainingMs`**, not as an end timestamp — it is a RATE, so §4.5's cap governs it — plus **the vigil floor**: a catch-up pass may never reduce it below `vigilFloorMs`, and may never remove a Pip at all. |
| 3 | Old age is peaceful | Old age sets a **flag** (`readyToRetire`) and nothing else. It changes no rate, no need, no refusal. Retirement is a player tap into the existing Long Meadow. |
| 4 | Every loss leaves a thread | A loss writes a `LineageEggSeed` into `state.lineageEggs` **inside the same reducer arm that removes the Pip** — the two are one atomic transition, so a loss without a seed is unrepresentable. |
| 5 | The Keep is never empty | `sanctuary.minActivePips` (already shipped, already 1) gates retirement, and the ailment resolver checks the same number before it may ever resolve `lost`. |

**The sixth promise, which the owner did not have to ask for and I am adding anyway:** *grief is
never compounded.* A loss costs the player nothing else. Not a resource, not a Keep XP point, not a
streak day, not an Album entry, not a bounty, not a milestone, not a placed decoration. §7.6 states
this as a list and §8 tests it.

---

## 1. PER-PIP LEVELS

### 1.0 The objection I have to answer first

`docs/progression-bible.md` §0.1 is titled **"ONE SPINE. Keep XP, never per-Pip XP"** and gives four
reasons. Round 2H does not overturn it; it satisfies it. Restating each reason against this design:

| Round 2F's reason for refusing per-Pip XP | How round 2H keeps it true |
|---|---|
| "No session is wasted" | **Keep XP is untouched and remains THE bar.** Every existing source still fires at the same value. Pip XP is a *second, smaller, per-card* number that never replaces the header. A session where every Pip is away still moves the Keep bar exactly as it does today. |
| "It composes with the Long Meadow" | Retiring a Pip still costs **zero Keep XP**, and a resident's `pipXp`/`level` **freeze rather than reset** — asking them home returns them at their full level. Retiring costs nothing, still. |
| "It has somewhere to go" | Pip levels have a ladder that already existed in fiction and now exists in data: **lifespan, resilience, and the share a descendant inherits.** No invented second ladder. |
| "It cannot be farmed by roster churn" | Pip XP is per-Pip and non-transferable; the *only* Keep XP a Pip level grants is `pipLevelPerLevel` (10), idempotent on `counters["pipLevel.<pipId>.<level>"]`. Hatch-and-retire loops re-grant nothing. |

**The line, stated once:** the Keep bar is the game's progress; a Pip's level is that Pip's
biography. They are different sentences about different subjects, and the UI must never put them in
the same widget.

### 1.1 What earns a Pip XP

Only things that Pip did, or that were done to that Pip. Every source is already rate-capped by a
shipped mechanism — the same structural rule round 2F applied to Keep XP.

| Source | Pip XP | Already bounded by |
|---|---|---|
| A care action applied to it (`FEED`/`CLEAN`/`PLAY`/`PET`/`GIVE_ITEM`, and `REST_TOGGLE` when a nap *starts*) | `care` **3** | Cooldowns, full bars, the §5 Play refusal floor |
| A completed expedition, credited at `ACKNOWLEDGE_REVEAL` to the Pip that went | `tripBase 8 + tripPer5Min 2 × ⌊durationMs / 5min⌋` | One Pip per trip, real-time durations |
| One produced job tick while it is the working Pip | `jobTick` **1** | `offlineRateCapMs` — ≤ 96 ticks per absence |
| Surviving an ailment (cured, or the Loyal Turn) | `ailmentSurvived` **60** | One per ailment; ailments are rare |
| Its own evolution | `evolve` **60** | Once per Pip |
| A mastery tier gained | `masteryTierPerTier 20 × newTier` | 2C's own idempotence key |
| Refusals, `TICK`, selection, building, bounties, streaks, milestones | **0** | — |

Trip values, computed: Meadow **10**, Forest **14**, Shore **20**, Bramblewick **24**, Snowdrift
**32**, Lanterngrotto **44**. Per minute the Meadow still wins (2.0 vs 0.49) — round 2B's
"active play beats idle play" shape survives into the third XP table in this codebase.

**The two archetypes this table deliberately levels at the same speed.** A Pip parked on a Gathering
Station through one capped absence earns 96. A Pip taken on four quick trips and given two care
rounds in an engaged day earns roughly 40 + 36 + 24 ≈ 100. *The workhorse and the adventurer grow
together.* That is the answer to "the casual player's Pips never develop", and it is why `jobTick`
stays at 1 rather than being cut to protect active play — active play is already protected by the
Keep bar, the mastery ladder and the loot economy.

### 1.2 The curve

```
pipLevelXp = [0, 40, 110, 220, 380, 600, 900, 1300, 1850, 2600]   // cumulative, index = level − 1
deltas     =    40, 70, 110, 160, 220, 300, 400,  550,  750
maxLevel   = 10
```

**Bar movement** (the round-2F contract, applied to the smaller ladder): one care action at the
top tier is `3 / 750 = 0.40 %`; one Meadow round-trip is `1.33 %`; a care round plus a trip is
`2.6 %`. Every figure clears round 2F's own floors (0.15 % / 1.2 %) with room, because this ladder
is deliberately shorter than the Keep's.

**Wall clock**, against ~180 Pip XP/day for an engaged player's most-used Pip and ~110/day for a
casual one:

| Level | Engaged | Casual | What it feels like |
|---|---|---|---|
| 2 | 5 hours | 9 hours | First session |
| 4 | 1.2 days | 2.0 days | "She's getting the hang of it" |
| 6 | 3.3 days | 5.5 days | Mid-life; the seasoning is now visible in the bars |
| 8 | 7.2 days | 12 days | A veteran; most Pips retire around here |
| 10 | 14.4 days | 24 days | **Rare on purpose** — see §2.5 |

**Level 10 is not expected within one Pip's natural life.** A well-cared Pip lives ~11 rated days
(§2.3) and lands at level 8–9. Level 10 is reached by a Pip whose lifespan was *extended* by care,
buildings and its own levels — or, far more often, by a **descendant who started at level 5**
(§5.4). The line maxes out; the individual usually does not. That is the succession mechanic doing
real emotional work rather than being a consolation prize.

### 1.3 What a level improves — five channels, one of them shared

| Channel | At level 10 | Cap and who else is in the channel |
|---|---|---|
| **Seasoning** (need-decay reduction) | −12 % | **SHARED** with building comfort, summed once, clamped once at `progression.effectCaps.comfortReductionMax` (0.25). See §1.4. |
| **Trail legs** (expedition duration) | ×0.94 | Own factor, composed with buildings and Hardworking, floored at the shipped `effectCaps.expeditionSpeedFloorWithQuirk` (0.75). |
| **Constitution** (ailment contract chance) | −40 % | Own channel, clamped at `ailments.contractReductionMax` (0.60) once buildings are added. |
| **Stamina** (ailment countdown length) | ×1.35 | Own channel, uncapped beyond this table — a longer countdown can only ever help. |
| **Longevity** (lifespan) | +36 % | Own channel; composes multiplicatively with care quality and buildings (§2.3). |
| **Constitution, part 2** (cure roll bonus) | +0.18 | Feeds `ailments.cureBonusMax` (0.45) alongside buildings and escalation. |

The tables, as data (index = level − 1):

```
seasoning        [0, 0.01, 0.02, 0.03, 0.05, 0.06, 0.08, 0.09, 0.11, 0.12]
expeditionSpeed  [1, 0.99, 0.98, 0.97, 0.97, 0.96, 0.96, 0.95, 0.95, 0.94]
contractReduction[0, 0.04, 0.08, 0.12, 0.16, 0.20, 0.25, 0.30, 0.35, 0.40]
countdownExtend  [1, 1.03, 1.06, 1.09, 1.12, 1.15, 1.20, 1.25, 1.30, 1.35]
cureBonus        [0, 0.02, 0.04, 0.06, 0.08, 0.10, 0.12, 0.14, 0.16, 0.18]
lifespanBonus    [0, 0.04, 0.08, 0.12, 0.16, 0.20, 0.24, 0.28, 0.32, 0.36]
```

> **How the player experiences this.** The Pip's card gains a second, quieter bar under the mood
> dot: *"Mossy · Level 6 · 340 / 600"*, and a one-line plain-English readout of what her levels have
> bought — *"Steadier than most. Fast on the trail. Hard to knock down."* No stat block, no
> percentages on the card (they live in a tap-to-expand detail), and never a comparison between two
> Pips.

### 1.4 THE SHARED CARE-EASE CHANNEL — this round's fragile invariant

Round 2B's fragile invariant was the level-1 wood ceiling. Round 2C's was the isolation rule. Round
2F's was `comfortReductionMax = 0.25`. **Round 2H's is that seasoning does not get its own cap.**

`core/keep/effects.balance.test.ts` proves that at 0.25 a Curious Pip comes home Grumpy and at 0.30
it comes home Content. The arithmetic that makes Curious the binding case:

```
Curious worst-need window drop  = 3.7 (cleanliness) × 1.15 × 16h = 68.08
"still Grumpy from a 90 save"   requires  90 − 68.08 × (1 − r) < 40
                                ⇒  r < 1 − 50/68.08  =  0.26557
```

**There are 1.557 percentage points of headroom above the shipped comfort cap in the entire game.**
A second, independent decay-reduction channel is therefore not merely unwise, it is arithmetically
unavailable. So:

> **THE RULE.** A Pip's seasoning and the Keep's building comfort are **one channel**. They are
> summed, then clamped once, at `progression.effectCaps.comfortReductionMax`. Sum-then-clamp, never
> multiply-then-clamp — the same pattern `retention.loot` and `progression.effectCaps` already use,
> for the same two reasons: the player can read it, and nothing can compound.

Implementation, in `core/pips/needs.ts` `effectiveRates`, with the one subtlety that keeps every
shipped test byte-identical:

```ts
const keepReduction = 1 - keepComfort.multiplier[need];   // whatever the caller passed
const pipReduction  = seasoningFor(pip, tuning);          // 0 when level is 1 or undefined
const headroom      = Math.max(0, careEaseMax - keepReduction);
const applied       = Math.min(pipReduction, headroom);
factor              = keepComfort.multiplier[need] - applied;
```

**Why it is written as headroom rather than `min(cap, sum)`.** `effects.balance.test.ts` constructs
a *hypothetical* 0.30 comfort by hand and asserts it produces a Content Pip. A naive
`min(cap, keep + pip)` would re-clamp that fixture to 0.25 and turn a passing guard red for the
wrong reason. Clamping only the Pip's own contribution against the remaining headroom leaves any
caller-supplied comfort exactly as supplied, and is a strict no-op whenever `pipReduction === 0` —
which is every fixture, every pre-2H save, and every one of the ~900 lines of `core/pips` test data
in this repo. **`pip.level` is optional and `undefined ≡ 1`**, the established `sulking`/`mastery`
precedent, so nothing needs editing.

**The accepted cost, named out loud.** On a *maximally built* Keep a max-level Pip's seasoning
contributes nothing to decay. That is deliberate: the alternative is either raising a cap that
cannot be raised, or shipping two channels that together trivialise care. The level's other five
channels are unshared and remain fully meaningful at any Keep tier — and seasoning is at its most
valuable precisely when the player has the fewest buildings, which is when they need it most.

### 1.5 The arithmetic: a max-level Pip still needs daily care

Run against `balance.test.ts`'s own method — `windowDrop = −rate × personalityMultiplier ×
capHours`, and `sessionRestore > windowDrop` for every (personality × need) pair.

**Case A — max level, maximally built Keep (the worst case for triviality).** Care ease is clamped
at exactly 0.25, so this case is *arithmetically identical* to the case
`effects.balance.test.ts` already proves. Restated with the numbers:

| Personality | Worst need | Window drop | ×0.75 | From 90 → | Mood |
|---|---|---|---|---|---|
| Lazy | energy | 72.80 | 54.60 | 35.40 | Grumpy |
| **Curious** | cleanliness | **68.08** | **51.06** | **38.94** | **Grumpy (the binding row)** |
| Hardworking | hunger | 69.92 | 52.44 | 37.56 | Grumpy |
| Chaotic | cleanliness | 74.00 | 55.50 | 34.50 | Grumpy |
| Clingy | happiness | 72.00 | 54.00 | 36.00 | Grumpy |

Every personality Grumpy (< 40), nothing at 0, nothing at or below `sulkExitThreshold` (25).
Care is shorter; care is not optional.

**Case B — max level, UNBUILT Keep (the new case this round introduces).** Care ease = 0.12.

| Personality | Worst need | Window drop | ×0.88 | From 90 → |
|---|---|---|---|---|
| Lazy | energy | 72.80 | 64.06 | 25.94 |
| Curious | cleanliness | 68.08 | 59.91 | 30.09 |
| Hardworking | hunger | 69.92 | 61.53 | 28.47 |
| Chaotic | cleanliness | 74.00 | 65.12 | **24.88** |
| Clingy | happiness | 72.00 | 63.36 | 26.64 |

Every value lands inside `balance.test.ts`'s **shipped [15, 45] personality-sweep band** and every
Pip is still Grumpy. The strongest single assertion available to this round is therefore:
*a max-level Pip on an unbuilt Keep passes the existing 24-hour sweep unchanged.*

**⚠ Do not copy Case A's assertion into Case B.** Case A clears `sulkExitThreshold` (25) on every
row; Case B's worst row (Chaotic cleanliness, **24.88**) sits 0.12 below it. That is correct and not
a defect — Sulking is *entered* at 0, never at 25, and `sulkExitThreshold` only governs a Pip that is
already sulking. Case B's assertions are therefore `lowestNeed > 0`, `mood === "grumpy"`, and
`lowestNeed ∈ [15, 45]`. A builder who writes `> sulkExitThreshold` here will get a red test and
draw the wrong conclusion from it.

**Case C — the leave-safe floor.** Seasoning only ever *reduces* `windowDrop` while
`sessionRestore` is untouched, so `sessionRestore > windowDrop ≥ windowDropWithSeasoning` holds a
fortiori. The tightest shipped pair (Hardworking / happiness, margin **6.64**) becomes:

- at level 10 unbuilt: `70 − 63.36 × 0.88 = 14.24`
- at level 10 on a maxed Keep: `70 − 63.36 × 0.75 = 22.48`

**The margin only ever widens. Levels can never break the loop; they can only make it safer.**
That is the one-line property test: *for every (personality, need, level, comfort), the
seasoned window drop is ≤ the unseasoned window drop.*

---

## 2. LIFESPAN

### 2.1 The problem, stated before the solution

`ageMs` already accrues across the **entire** absence window — `catchup.ts`'s `accrueFrozenTime`
advances it through the rate-frozen tail on purpose, because the lifetime-happiness average depends
on it. If lifespan keyed off `ageMs`, a three-week holiday would retire an entire roster, and the
player would return to an empty Keep. That is promise 2 and promise 5 broken by the same line of
code.

### 2.2 THE AGEING RULE

> **A Pip's life is measured in `lifeMs`, a NEW clock that advances with RATED time only.** Live
> ticks advance it 1:1. A catch-up pass advances it by `min(elapsed, offlineRateCapMs)` — exactly
> the same clause §4.5 already applies to need decay, Rest regen and Gathering production.
> **Ageing is a RATE, not a TIMER.** Rates are capped; timers are not.

Consequences, all of them intended:

- A player away for three weeks returns to Pips **16 hours older**. Absence cannot end a life.
- A player who opens the app daily ages their Pips at roughly wall-clock speed (an overnight absence
  is fully rated at 8h ≤ 16h — the same reason round 2A chose a 16h cap).
- **A resident of the Long Meadow does not age at all.** Residents live outside `state.pips`, which
  is what already freezes `ageMs`, needs and `happinessIntegral` — `lifeMs` freezes by the identical
  mechanism, with no new flag. *The Long Meadow is where time stops. That is a feature, not a
  loophole,* and §7.4 says why it is safe.
- `ageMs` keeps its two existing jobs (evolution readiness at 72h, and the lifetime happiness
  average) **unchanged and untouched**. `lifecycle.test.ts` and `balance.test.ts` do not move.

**Two clocks is a real cost.** It is paid down by never showing either one as a number: `ageMs`
appears only as "hatched 14 March", `lifeMs` appears only as a named season (§2.4).

### 2.3 How long a life is

```
lifespanMs = baseLifespanMs
           × careQualityMultiplier(lifetimeAvgHappiness)
           × (1 + lifespanBonus[level])
           × (1 + min(buildingLongevity, lifespanBuildingMax))
```

- `baseLifespanMs` = **7 days of rated time.**
- **Care quality** reuses `happinessIntegral / ageMs`, which already exists and already survives
  catch-up correctly. Bands: `< 30 → ×0.85`, `30–49 → ×0.95`, `50–64 → ×1.05`, `65–79 → ×1.20`,
  `≥ 80 → ×1.35`.
- **Level** adds up to +36 % (§1.3).
- **Buildings** add up to +25 % via a new `BuildingEffect` kind, `longevity`, carried by three
  *already-shipped* placeables so the round adds no new build items for this: `nest-warmer` +0.06,
  `sun-bunks` +0.10, `larder` +0.05 (sum 0.21, under the 0.25 cap).

| Player | Lifespan |
|---|---|
| Neglectful (avg happiness < 30, level 3, no buildings) | 7 × 0.85 × 1.08 = **6.4 days** |
| Ordinary (avg 65–79, level 6, one longevity building) | 7 × 1.20 × 1.20 × 1.06 = **10.7 days** |
| Devoted (avg ≥ 80, level 10, all three buildings) | 7 × 1.35 × 1.36 × 1.21 = **15.6 days** |

**"Roughly 1–2 weeks of active play", delivered, with care quality worth ~59 % of a lifetime.**

Because the multiplier is derived live, **lifespan can grow after the fact.** A Pip that entered its
last season can leave it again if the player turns their care around. This is the kindest possible
reading of the mechanic and it is explicitly allowed: crossing out of Elder fires *"Mossy has perked
up. The greying has held off a while."*

### 2.4 Seasons, not a countdown

`season = f(lifeMs / lifespanMs)`, derived, never stored:

| Fraction | Season | What changes |
|---|---|---|
| — | **Pipling** | Existing stage (first 8h of `ageMs`), unchanged |
| < 0.20 | **Young** | Nothing |
| 0.20–0.55 | **Prime** | Nothing |
| 0.55–0.80 | **Seasoned** | Nothing mechanical. A word on the card. |
| ≥ 0.80 | **Elder** | Nothing mechanical. A soft palette wash, a slower idle loop, the new `elder` dialogue context. |
| ≥ 1.00 | **`readyToRetire`** | A flag. Nothing else. |

**Old age is mechanically free.** No need decays faster, no refusal appears, no expedition is
barred, no cure gets harder. §8's P3 tests assert `effectiveRates` is *deep-equal* between a
`lifeMs = 0` Pip and a `lifeMs = 10 × lifespanMs` Pip.

> **How the player experiences this.** They never see a number, a bar, or a date. They see the
> Pip's card word change from *Prime* to *Seasoned* to *Elder*, a portrait that greys a little at
> the muzzle, and — once — a warm card: *"Mossy has come to her last season. She's in no hurry."*
> There is no timer anywhere in this system, and `retention.copy.test.ts`'s urgency lint is extended
> to cover every string in it.

### 2.5 Retirement is a tap

When `lifeMs ≥ lifespanMs`, set `readyToRetire: true`. The Pip glows a warm dusk colour — visually
distinct from evolution's bright glow — and waits. **Exactly like hatching and evolution, this is a
player-witnessed moment and never automatic.** `TICK` and `CATCHUP` may set the flag; only
`RETIRE_PIP` may move a Pip.

That single rule is what makes promise 3 airtight: a player cannot return from a holiday to find
their Keep emptied, because nothing empties itself.

**Promise 5 inside retirement.** `RETIRE_PIP` already refuses with `"lastPip"` at
`sanctuary.minActivePips`. An age-ready last Pip is refused by the same shipped check, with new
copy: *"Not yet. Someone has to hold the fort — and Mossy doesn't mind one bit."* The Pip suffers
nothing for the wait.

**Retiring by age vs. by choice.** `SanctuaryRecord` gains `reason: "player" | "age" | "lost"`. An
age-retired resident is identical in every other respect, is fully retrievable, and returns still
`readyToRetire` — asking them home is a visit, not a reset, and costs nothing. It is one more
summer, offered as often as the player likes.

---

## 3. AILMENTS

### 3.1 The state machine

```
healthy ──contract (expedition return, risky biome only)──▶ settling
settling ──countdown──▶ worsening ──countdown──▶ grave ──countdown ends, live TICK only──▶ lost
   │            │              │
   └────────────┴──────────────┴── cure roll succeeds ──▶ healthy + a SCAR
```

```ts
interface AilmentState {
  readonly id: string;                 // content id — "brambleburr" | "chillshake" | "lanternfever"
  readonly contractedAt: number;       // clock ms, for the Album's dated line
  readonly fromExpeditionId: string;   // THE biome — this is what seeds the lineage egg
  readonly remainingMs: number;        // ⚠ REMAINING, never an end timestamp. See §3.3.
  readonly totalMs: number;            // what it started at, so the ring can render a fraction
  readonly cureAttempts: number;       // forward-only; drives escalating cure odds
}
```

`stage` is **derived** from `remainingMs / totalMs`: `≥ 0.60` settling, `0.25–0.60` worsening,
`< 0.25` grave. Nothing stores a stage — retuning the bands re-grades every Pip with no migration,
the same discipline 2C's mastery tiers use.

### 3.2 Where ailments come from — and where they never come from

**Quick trips are safe. Deep trips carry risk.** That maps exactly onto round 2B's shipped identity
(quick = the active loop, deep = the idle loop) and gives the player one sentence to remember.

| Expedition | Tier | Risk | Ailment | Countdown (rated) |
|---|---|---|---|---|
| Meadow, Forest, Shore | quick | **0.00 — never** | — | — |
| Bramblewick | deep | 0.05 | **Brambleburr** — a burr worked deep under the fur | 48 h |
| Snowdrift | deep | 0.07 | **Chillshake** — a shiver that won't settle | 42 h |
| Lanterngrotto | deep | 0.10 | **Lanternfever** — glowing too bright, burning too fast | 36 h |

**Nothing else in the game can make a Pip ill.** Explicitly and permanently cut, with reasons:

- **No illness from neglect.** Needs at 0 remains Sulking, forever, exactly as §4.4 has always said.
  Neglect-illness would be *caused by absence* by definition — promise 2 forbids it — and it would
  punish precisely the player round 2C's guardrail exists to protect.
- **No illness at home.** Not from a dirty Keep, not from an unfed Pip, not from a missing Bed.
- **No illness from jobs or Rest.**
- **Nothing may ever raise a contract chance.** Not an event (2C: "an event may only ever make
  something easier"), not a building, not a difficulty setting, not a streak break.

> **All danger in PipsKeep comes from a door the player opened, and the door is labelled.**

### 3.3 THE COUNTDOWN OBEYS §4.5 — exactly how

Every other timer in this codebase is derived from `start + duration` and is therefore *uncapped by
construction* — §4.5 rule 4, "rates are capped, timers are not". **An ailment is deliberately the
opposite.** It is stored as `remainingMs` and decremented in exactly the segments `applyNeedsDelta`
runs in, through exactly the same rated/frozen split `advanceThroughCap` already performs:

```ts
// inside the same per-segment advance that moves needs
if (pip.ailment !== null && ratedHours > 0) {
  remaining -= ratedHours * HOUR_MS;      // frozen time subtracts NOTHING
}
```

Three hard rules layered on top, in the order they bind:

1. **`minAilmentDurationMs (36h) > offlineRateCapMs (16h)`.** A Pip that is *healthy* when the
   player closes the app can never be worse than `worsening` when they open it, no matter how long
   they were away. Asserted directly as a tuning invariant.
2. **THE VIGIL FLOOR.** Within a catch-up pass, `remainingMs` may be reduced to no less than
   `vigilFloorMs` (**4 h**). Live time has no floor. So a returning player always finds at least
   four hours of visible countdown and every cure still on the table.
3. **CATCH-UP MAY NEVER TAKE A PIP.** The `lost` transition exists only in the live `TICK` arm.
   `runCatchup` has no code path that removes a Pip from `state.pips`, and §8's P2 tests sweep
   elapsed times from 1 ms to 10 years across every ailment and every remaining value to prove it.

**Together these say the thing the owner actually asked for:** *the loss moment is always witnessed.*
Nobody ever opens PipsKeep to find out their Pip is gone.

Observable consequence, mirroring `balance.test.ts`'s own "72h lands where 24h lands":
**a 7-day absence leaves exactly the same `remainingMs` as a 16-hour absence.**

### 3.4 What the player sees, in time they understand

`remainingMs` is *rated* time, so a digital clock would be a lie for an absent player. The label is
generated from a band table and is never numeric:

| Remaining | Label |
|---|---|
| ≥ 48 h | "a few days of tending left" |
| 24–48 h | "about two days of tending left" |
| 12–24 h | "about a day of tending left" |
| < 12 h | "Mossy needs you today" |

Rendered as a soft ring around the portrait that fills warm-amber → dusk-rose. **No red. No seconds.
No `00:12:33`.** The copy lint asserts no ailment string matches `/\d+\s*:\s*\d+/` or the shipped
urgency regex.

> **How the player experiences this.** A returning Bramblewick trip ends with the ordinary loot
> reveal, and then one extra quiet beat: *"Mossy came back limping. There's a burr in deep."* The
> card in the Keep shows the ring and the two-day label. It is worrying. It is not an emergency, and
> nothing on screen shouts.

### 3.5 Cures

Two routes, both real, plus modifiers. **No cooldown gate** — the limiter is items and the day
boundary, which are legible things the player already understands.

| Route | Base | Availability |
|---|---|---|
| **A poultice** (`GIVE_ITEM` with the new `poultice`) | **0.55** | Consumed on use, success or fail. Drops from all three deep trails (weight 4), from bounty and milestone rewards. |
| **Devoted care** (free) | **0.35** | One roll per day boundary (`retention.dayStartHour`, already in state), granted when all four needs are ≥ 70 at once while ailing. |

Modifiers, summed into one channel and clamped once at `cureBonusMax` (0.45):

- **Escalation**: `+0.10 × cureAttempts` — each failed attempt makes the next likelier. Visible, and
  the same pity shape the codebase already ships for eggs.
- **Level**: `cureBonus[level]`, up to +0.18.
- **Buildings**: the **Poultice Shelf** (new placeable, tier 5, `{ wood: 7, fiber: 6 }`) +0.15; the
  already-shipped **Wash Basin** +0.05. Both via a new `remedy` `BuildingEffect` kind, which also
  carries `contractReduction` (Shelf 0.20, Basin 0.10, clamped at `contractReductionMax` 0.60
  alongside the Pip's own constitution).

**Survival arithmetic**, worst case first — a level-1 Pip, no buildings, no poultices, relying only
on the free daily roll, against the *shortest* ailment (Lanternfever, 36 h rated ≈ 3 sessions for a
daily player):

```
1 − (0.65 × 0.55 × 0.45) = 83.9 %
```

The same Pip with three poultices: `1 − (0.45 × 0.35 × 0.25) = 96.1 %`. A level-6 Pip with a
Poultice Shelf and one poultice: `> 99 %`.

**Frequency.** An engaged player running two deep trips a day carries ~0.12 ailment-chance/day → one
ailment per ~8 days, i.e. **1–2 per Pip lifetime**. Multiplied through survival and the shields of
§7, roughly **one Pip in six is lost to illness; the rest retire peacefully.** That is "some might
last a long time, but they don't last forever" with real, rare stakes.

### 3.6 What a cured Pip carries forward: THE SCAR

A cure (or a Loyal Turn) writes to `pip.scars: readonly string[]` — permanent, forward-only, carried
through evolution, retirement and retrieval.

- **Immunity.** A Pip can never contract an ailment it already carries a scar for. The contract roll
  is skipped entirely — zero RNG consumed, so the stream stays honest.
- **A title.** "Mossy of the Brambles" appears on the card and the Album page.
- **A mark.** A small nick or paler patch, drawn from the existing accessory-anchor rig.
- **60 Pip XP** and 30 Keep XP.
- **Heritable, at a quarter strength.** A child of a scarred parent gets
  `resistances[ailmentId] = 0.25` — a 25 % reduction in that ailment's contract chance. Lineage
  doing mechanical work, not just flavour.

> **How the player experiences this.** Surviving is *better than never having been ill.* The scar is
> a trophy, the immunity is permanent, and the Pip is measurably tougher. A Keep full of scarred old
> veterans is a Keep with a history, and that history is legible on the portraits.

---

## 4. THE LOSS MOMENT

The most emotionally loaded surface in the game. Rules before copy:

- **A full-screen moment, not a modal on top of the Keep.** Warm dusk palette — the Long Meadow's
  own gate colours — never black, never a red border, never a shake.
- **One sound**: a low, warm two-note fall on the existing procedural engine. No sting, no buzzer.
- **No X, no "FAILED", no "you lost", no skull, no gravestone.** The word "died" does not appear.
- **Nothing else may fire.** No confetti, no `+XP` chip, no level-up banner, no milestone ribbon, no
  toast, for the duration of the moment and for **3 seconds after it closes**. A queue rule, stated
  as a rule so it is testable.
- **It is never queued behind anything.** It interrupts the reveal/Doorstep queue and resumes it
  after.
- **It can only ever be reached live** (§3.3 rule 3), so the Doorstep never reports a death.

### The copy

Beat one — the portrait is the one the player has looked at all week, eyes closed, at rest.

```
                        [ portrait, at rest ]

                              Mossy
                       Mosspip · of the Brambles


                   Mossy didn't get better.


           She was with you eleven days, went to the Meadow
           forty-one times, and always came back muddy.


           Her egg is somewhere in the Bramblewick.
           Pips leave one where they were happiest.


                        [  Say goodbye  ]
```

Beat two — one tap, one more line, then back to the Keep.

```
                 Mossy's page stays in the Album. Always.

                 She's in the Long Meadow now, under the old tree,
                 if you want to visit.


                     [  Go back to the Keep  ]
```

**Why each line is that line.** *"didn't get better"* is the plainest true thing and the only phrasing
that blames nobody. The middle paragraph is a eulogy assembled **from the player's own history** —
`lifeMs` in days, `mastery` trip counts, the personality's signature quirk — so no two losses read
the same and every one is specific. The egg line is delivered as *consolation*, not as a quest
marker; there is no "New Objective" chrome. "Always" is there because it answers the fear the player
actually has at that moment, which is that their week is being deleted.

### The Loyal Turn — when a shield catches it

Same staging, opposite outcome. This is what a shielded Pip's countdown reaching zero produces
(§7.3–7.5), and it must never announce that a safety net exists:

```
                     [ portrait, ears up, shaky ]

                Mossy came through it.

        Somewhere in the small hours the shaking stopped.
        She is thinner, and there's a white patch now where
        the burr was, and she is absolutely fine.


                    [  Sit with her a while  ]
```

Grants the scar, the immunity, 60 Pip XP, 30 Keep XP. Never says "you were protected."

### The retirement moment — for contrast, and because it must not feel like a lesser death

```
                     [ portrait, dozing, warm light ]

                              Pebble
                    Hardworking · Old friend of the Shore

              Pebble has had a long life.

        Thirteen days, ninety-two trips, and one very
        determined opinion about berries.

        The Long Meadow is ready whenever you both are.
        She'll be there to visit, and she can always come home.


              [  Walk her over  ]      [  Not today  ]
```

**"Not today" is a real button and it costs nothing.** The flag persists; the card can be dismissed
as many times as the player likes. Retiring pays 40 Keep XP — old age is a *reward*.

---

## 5. LINEAGE EGGS

### 5.1 The seed

Written **inside the same reducer arm that removes the Pip**, so a loss without a thread is
unrepresentable:

```ts
interface LineageEggSeed {
  readonly pipId: PipId;               // the lost Pip; its record is in sanctuary under reason "lost"
  readonly name: string;               // for every line of copy this seed produces
  readonly genome: TraitGenome;        // the BIRTH genome — evolution stays earned (v1.3 standing rule)
  readonly expeditionId: string;       // the biome that took them
  readonly level: number;              // level at the moment of loss
  readonly scars: readonly string[];   // become the hatchling's resistances
  readonly generation: number;         // parent's generation; child is this + 1
  readonly seededAt: number;
  readonly misses: number;             // forward-only trips to that biome since seeding
}
```

Stored in `GameState.lineageEggs: readonly LineageEggSeed[]`. **A seed never expires, never decays,
and is removed only by being found.**

### 5.2 Find odds — generous, and stated as two numbers

On each completed trip to that biome:

```
find chance = 0.40 on the first trip;  GUARANTEED on the second.
```

Expected trips: **1.6.** On the Bramblewick that is about 64 minutes; on the Grotto about 2.4 hours.
Two numbers the player can hold in their head — *"go back; she'll be there the first or second
time"* — and no tail. The owner asked for reachable, not a rare drip; a pity ladder with a long
shoulder would have been the wrong shape here even though it is the codebase's usual pattern, and
§9 records that as a deliberate exception.

One roll per qualifying trip, from the new `"lineage"` stream; **zero rolls** on a trip to a biome
with no unfound seed, so no existing cursor moves.

### 5.3 How the player learns the egg is out there

Three surfaces, because missing it would break promise 4 in practice while satisfying it in data:

1. **The loss moment says it** (§4), in the sentence right before the button.
2. **A standing card in the Nook — "Someone to find."** One row per unfound seed: the parent's
   portrait, the biome, and a **Send someone** button that opens the expedition picker pre-set to
   that trail. No countdown, no expiry, no badge that nags. It simply stays there.
3. **The send-off card for that biome** carries a line: *"Mossy's egg is somewhere here."*

### 5.4 What the hatchling inherits

- **Genome** — `combineGenomes(seed.genome, seed.genome, rng)`. Passing the same genome twice makes
  every parent-pick degenerate while the mutation branch still fires, so the child is *the parent,
  give or take a freckle*. **This consumes the function's shipped, tested, exactly-6-roll contract
  unchanged** — round 2H writes no new genome code and `genome.test.ts` does not move. This is the
  reuse the seam was built for.
- **Species** — the parent's **birth** species, because that is what `genome.speciesId` is. A lost
  Grovepip leaves a Mosspip egg. Evolution stays earned (v1.3's standing rule), and the Album cannot
  be advanced by loss.
- **Shininess** — inherited at `shinyInheritChance` **0.50** if the parent was shiny. Rolled by the
  *caller*, from the `lineage` stream, **outside** `combineGenomes` (which hard-codes `shiny: false`
  and must keep its 6-roll contract). Losing a shiny Pip must not quietly delete a 1-in-40 thing.
- **Level** — `1 + floor((parent.level − 1) × lineageLevelShare)`, `lineageLevelShare = 0.50`.
  A parent lost at level 9 leaves a child that hatches at **level 5**, with `pipXp` set to that
  level's threshold. The line does not start over.
- **Resistances** — one entry per parent scar at 0.25.
- **Name** — auto-named `<Parent> the Second` / `the Third` / … from `generation`. No naming UI is
  required and none is added.
- **Album** — the parent's page gains a permanent lineage line: *"Mossy → Mossy the Second."*
  **No collection counter moves in either direction.**

> **How the player experiences this.** The grief has a job attached to it, and the job is short. You
> go back to the place that took her, twice at most, and something of her comes home already half
> grown. It is the only mechanic in the game where a bad thing pays out, and it pays out in the one
> currency that matters — continuity.

---

## 6. BREEDING (§12 UNFENCED)

`combineGenomes(a, b, rng)` has been implemented, unit-tested and called by nothing since Phase 4.
It goes live unchanged.

### 6.1 The action and its eligibility

`BREED_PIPS { aId, bId, at }` → an `Egg` with `sourceExpeditionId: null` and a new
`lineageGenome: TraitGenome` field. **The genome is combined at BREED time, not at hatch**, because
the parents may be retired, remembered or gone by the time the egg pips.

| Gate | Value | Why |
|---|---|---|
| Both Adults | — | A Pipling is a baby |
| Both level ≥ `breedMinLevel` **3** | ~1 day of care each | Breeding is something a Pip grows into |
| Neither ailing | — | Obvious, and it keeps the ailment surface uncluttered |
| Neither `OnExpedition`/`Returning`, neither sulking | — | Mirrors every other legality table in core |
| **All eight needs ≥ `breedMinNeed` 60** | — | "They have to be happy." The only gate that is really a care check. |
| Not the same Pip | — | — |
| Per-Pip cooldown `breedCooldownMs` **24 h wall-clock** | — | Wall clock, not rated, so an absent player's cooldown ticks for free |
| Lifetime `maxClutchesPerPip` **3** | — | See §6.3 |

Incubation is `breedingIncubationMs` **4 h** — twice a found egg. A clutch is a bigger thing.

**No bond stat.** The brief asked whether breeding should require one; the answer is no. Inventing a
per-pair affection meter would add a second relationship system to a round that already adds two
clocks, and the needs-≥-60 gate already says "they're happy" using state that exists.

### 6.2 What is inherited

- **Genome** — `combineGenomes(a.genome, b.genome, rng)` from the `lineage` stream, 6 rolls, exactly
  as tested. Species from one parent 50/50; palette and pattern from either parent with the shipped
  `breeding.mutationChance` (0.05) of a fresh draw; personality from either parent 50/50.
- **Shiny** — as §5.4, rolled outside the function; `shinyInheritChance` applies if *either* parent
  is shiny.
- **Level** — `1 + floor((mean(levelA, levelB) − 1) × breedLevelShare)`, `breedLevelShare` **0.35**.
  Two level-8 parents produce a level-3 child. **Deliberately lower than lineage's 0.50**: a lost
  parent's legacy should be the stronger inheritance, both thematically and to stop breeding becoming
  the efficient way to manufacture levels.
- **Resistances** — the union of both parents' scars at 0.25 each.
- **Generation** — `max(a.generation, b.generation) + 1`.

### 6.3 How it composes with lineage eggs without trivialising the Album

**`combineGenomes` picks `speciesId` from one of the two parents.** It consults no rarity table and
no registry pool. Therefore:

> **Breeding can never produce a species the player does not already own, and a bred child is always
> a BASE form (the genome carries the birth species).**

That single property — already true of the shipped function, and now load-bearing — means breeding
adds **zero** Album progress. It produces *more of what you have*, with better traits and a head
start. The 14-form Album is still walked by expeditions and biome pools alone, and the content
bible's ~15-hour time-to-find table is untouched.

The three-clutch lifetime cap is a second, softer guard: it stops a two-Pip factory from filling
every roster slot with level-4 hatchlings and turning the roster cap into the only real constraint.
Combined with `rosterCap` (3, or 5 with Cozy Bunks, or 6 at tier 11), the equilibrium is a Keep of
a few well-known Pips with a family tree, which is exactly the fiction.

> **How the player experiences this.** Two Pips they have cared about for a week produce an egg that
> looks like both of them and starts life already competent. It is the first thing in PipsKeep that
> is *made of the player's own attachment* rather than of RNG.

---

## 7. THE ANTI-BRUTALITY SYSTEM

The owner's stated fear, in their words: it *"can't be brutal that a player loses their star too
quickly and are disappointed."* Six independent shields, in the order they fire. Any one of them
alone would prevent most bad outcomes; all six make the bad outcome *rare, late, chosen and
survivable*.

### 7.1 Shield one — no hidden risk, ever

Every expedition send-off card carries a **risk line, in words, above the button**:

- Meadow / Forest / Shore: *"Safe trail."*
- Bramblewick / Snowdrift / Lanterngrotto: *"Some risk. Pips sometimes come back with a burr."*

No probability is hidden (2C §0.5's full-disclosure rule extends to danger: the exact percentage is
on the tap-to-expand detail). A player who never taps a deep trail **never encounters this system at
all**, and that is a supported way to play the whole game.

### 7.2 Shield two — THE CAREFUL ROUTE (risk is opt-in per trip)

The brief asked whether there should be a safe route and a risky route to the same biome. Yes — but
not by duplicating six biomes into twelve. **Any deep trip may be sent as a careful trip**, a toggle
on the send-off card reading *"Take the long way round."*

| | Duration | Loot rolls | Egg chance | Ailment chance |
|---|---|---|---|---|
| Normal | ×1.0 | ×1.0 | unchanged | as tabled |
| **Careful** | **×1.5** | **×0.75** (`max(1, round(...))`) | unchanged | **×0** |

**One universal, legible opt-out of all danger, at a real and honest cost** (half the yield per
minute). It is offered only where `ailmentChance > 0`, so it never appears as a pointless downgrade.

*Reachability safety:* a careful trip is strictly worse per minute than a normal one, so it can
never make any priced thing more affordable. `reachability.test.ts` measures the normal route and
therefore measures the faster economy — the safe direction, exactly as round 2F argued for building
speed.

**The consequence worth saying out loud: after this, every loss in PipsKeep is downstream of a
choice the player made twice** — once to take a deep trail, once to take it the fast way.

### 7.3 Shield three — the young cannot be lost

> A Pip whose `lifeMs < noLossBeforeMs` (**3 days of rated life**) cannot be lost. Its countdown
> reaching zero resolves as the **Loyal Turn**.

Three days rather than seven: seven would be half of a typical life and would drain the stakes
entirely, leaving the emotional weight only on Pips who were about to retire anyway. Three days
protects the attachment phase and the whole of week one for the starter, and leaves 4–13 days of
genuine vulnerability.

**Shielded Pips can still contract ailments**, on purpose. A player's first ailment is therefore a
frightening story with a guaranteed happy ending that teaches the cure UI, hands out the first scar,
and makes the *second* ailment legible. This is the single best onboarding this system could have,
and it costs nothing.

### 7.4 Shield four — the first loss never happens

The first time in a save's life that an ailment would take a Pip, **it doesn't**: the Loyal Turn
fires and `counters["ailment.graceUsed"]` goes to 1. Once ever, per save, never refilled, never
mentioned.

**No player will ever lose their first Pip.**

### 7.5 Shield five — the last Pip never goes (promise 5, mechanically)

If resolving `lost` would leave `rosterOrder.length` below `sanctuary.minActivePips` (1), it
resolves as the Loyal Turn instead — regardless of grace, regardless of age, regardless of shields
already spent. The same number gates `RETIRE_PIP`. **`rosterOrder.length ≥ 1` is a state invariant,
asserted by property test over long randomised action sequences.**

### 7.6 Shield six — the pause, and the list of things a loss does not cost

**Retiring an ailing Pip is legal, and the ailment freezes with them.** Residents live outside the
tick loop, which is what already freezes needs, `ageMs` and now `lifeMs`; `remainingMs` freezes by
the identical mechanism with no new flag. Asking them home resumes the countdown exactly where it
stopped.

*The Long Meadow is rest, not medicine* — the ailment is not cured — but **the player can always
press pause on grief**, indefinitely, for free, and try again when they have poultices. The Long
Meadow list says so plainly: *"Mossy is resting, and still poorly. Ask her home when you're ready to
try again."*

And, on a loss, **none of the following change**:

| | |
|---|---|
| Keep XP | Unchanged. A loss grants none and costs none. |
| `keep.level`, resources, inventory, keepsakes, placements | Unchanged. |
| The Album | **Permanent.** The page, the portrait, the caught count, the variants, the shiny stamp: all stand. `formsCaught` can never decrease — §8 P-Album tests it. |
| Mastery trips | Stand, on the Pip's frozen record. |
| Streak, grace, bounties, milestones | Untouched. A loss is not a missed day. |
| Milestones | **No milestone may ever be earned by losing a Pip.** "The Line Goes On" is earned by *hatching* a lineage egg, never by seeding one. |

### 7.7 THE QUIET KEEP — the setting I am specifying rather than deferring

`state.settings.quietKeep: boolean`, default **false**, in the Nook: **"Pips never fall ill."**

Every `ailmentChance` resolves to 0 while it is on, and turning it on **immediately and gently cures
any ailment in progress** (with the Loyal Turn moment, so the Pip still gets its scar). Turning it
off again is allowed at any time. **No milestone, no Album entry, no flair and no Keep XP is gated on
it, and nothing anywhere labels it as easy mode.**

This is three lines of reducer code and it is the complete, unconditional answer to *"it can't be
brutal."* A game whose owner is worried about disappointing players should ship the switch that makes
disappointment impossible, and should not make anyone ask for it.

### 7.8 What I am cutting, and saying so

The brief asked me to name anything that cannot be made non-brutal.

1. **Death by neglect — cut.** Covered in §3.2. It is *definitionally* caused by absence.
2. **Ailments contracted at home — cut.** Same reason.
3. **Any penalty for old age — cut.** No stat drift, no refusals, no slower trips, no "frail" state.
   §2.4 asserts the rates are deep-equal.
4. **Any loss-related push notification — cut, permanently, and named now so round 2I cannot add it.**
   "Mossy isn't well" arriving on a lock screen at 11 p.m. is the most brutal thing this design could
   possibly produce. `notify()` may carry ailment *contraction* and *cure* in-app; the push channel
   may carry neither.
5. **A visible lifespan number or bar — cut.** §2.4.
6. **Losing a Pip while the app is closed — cut.** §3.3. This is the whole round.

---

## 8. THE FIVE PROMISES AS TESTS

These are the round's gate. New files: `core/pips/lifecycle.promises.test.ts` (P1–P5),
`core/pips/level.balance.test.ts` (the balance guard), plus additions to the existing migration and
serialization suites.

### P1 — Loss is never a surprise

```ts
it("no reducer arm removes a Pip except the live-TICK ailment resolution", () => {
  // 2,000 seeded random actions drawn from every GameAction arm, at every clock
  // step from 1s to 30d. After each dispatch:
  //   activeCount(after) < activeCount(before)  ⟹  after.lastLossOutcome?.at === action.at
  //                                              || action.type === "RETIRE_PIP"
});

it("every loss was preceded by an ailment visible for at least one full session", () => {
  // For every ailment def: contract() sets remainingMs === totalMs, and
  // totalMs >= tuning.lifecycle.ailments.minDurationMs.
});

it("minDurationMs exceeds the offline rate cap — a healthy Pip is never critical on return", () => {
  expect(tuning.lifecycle.ailments.minDurationMs).toBeGreaterThan(tuning.offlineRateCapMs);
});

it("every stage yields a human countdown label, never a clock and never urgency copy", () => {
  // for each stage × each ailment: label is non-empty, does NOT match /\d+\s*:\s*\d+/,
  // and does NOT match retention.copy.test.ts's shipped urgency regex.
});

it("every risky expedition declares a risk line, and every safe one declares it is safe", () => {
  // content/expeditions.ts: (ailmentChance > 0) === (riskCopy is the risky variant)
});
```

### P2 — Loss is never caused by absence

```ts
it.each(ELAPSEDS)("CATCHUP over %s never removes a Pip", (elapsed) => {
  // ELAPSEDS: 1ms, 1s, 1m, 1h, 15h59m, 16h, 16h01m, 24h, 3d, 7d, 30d, 365d, 10y
  // × every ailment × remainingMs ∈ {totalMs, 12h, 5h, 4h, 3h, 1h, 1ms}
  // × every shield state (grace spent/unspent, lifeMs above/below noLossBefore,
  //   roster size 1..3)
  // Invariant: rosterOrder.length is unchanged and no lastLossOutcome is written.
});

it("an absence burns at most offlineRateCapMs of a countdown", () => {
  // remainingBefore - remainingAfter <= tuning.offlineRateCapMs, for every elapsed above.
});

it("an absence never takes a countdown below the vigil floor", () => {
  // for every elapsed and every starting remaining >= vigilFloorMs:
  //   remainingAfter >= tuning.lifecycle.ailments.vigilFloorMs
});

it("a 7-day absence leaves the same remaining as a 16-hour absence", () => {
  // the cap, made observable — the sibling of balance.test.ts's own 72h/24h claim
});

it("ageing obeys the same cap: a 3-week absence ages a Pip by exactly offlineRateCapMs", () => {
  expect(after.lifeMs - before.lifeMs).toBe(tuning.offlineRateCapMs);
});

it("no CATCHUP over any elapsed time ever sets readyToRetire on a whole roster", () => {
  // a roster of three Pips at lifeMs = 0.9 × lifespan, away 30 days:
  // at most 16h of ageing is applied, so none crosses.
});
```

### P3 — Old age is peaceful

```ts
it("reaching lifespanMs sets readyToRetire and changes literally nothing else", () => {
  const young = pipAt({ lifeMs: 0 });
  const old   = { ...young, lifeMs: 10 * lifespanMs(young) };
  expect(effectiveRates(old)).toEqual(effectiveRates(young));
  expect(canReceiveCare(old)).toBe(canReceiveCare(young));
  expect(departExpedition(old, trip).ok).toBe(true);
  expect(evaluateSulk(old)).toEqual({ ...evaluateSulk(young), lifeMs: old.lifeMs, readyToRetire: true });
});

it("no TICK and no CATCHUP ever moves a Pip into the sanctuary", () => {
  // 500 randomised TICK/CATCHUP dispatches over an over-age roster:
  // sanctuary.order is unchanged throughout. Only RETIRE_PIP moves anyone.
});

it("an age-retired Pip keeps name, genome, level, pipXp, mastery, scars and Album page", () => {});

it("an age-retired Pip is retrievable, and returns still readyToRetire", () => {});

it("RETIRE_PIP refuses the last active Pip whether player-chosen or age-ready", () => {
  expect(retireRefusal(onePipKeep, id)).toBe("lastPip");
});

it("a resident's lifeMs does not advance, over any elapsed time", () => {});
```

### P4 — Every loss leaves a thread

```ts
it("every loss seeds exactly one lineage egg, in the biome that inflicted the ailment", () => {
  // after.lineageEggs.length === before.length + 1
  // seed.expeditionId === pip.ailment.fromExpeditionId
  // asserted for every ailment × every biome that can inflict it
});

it("a seed is guaranteed found by the 2nd completed trip to its biome, over 200 RNG seeds", () => {});

it("the hatchling carries the parent's BIRTH species, never its evolved form", () => {
  // parent evolved to grovepip ⇒ child.genome.speciesId === "mosspip"
});

it("the hatchling inherits at least half the parent's earned levels", () => {
  expect(child.level).toBe(1 + Math.floor((parent.level - 1) * 0.5));
});

it("a shiny parent's egg inherits shininess at the declared rate, and the roll is outside combineGenomes", () => {
  // combineGenomes still consumes exactly 6 rolls — genome.test.ts's contract is untouched
});

it("a lineage seed never expires and is removed only by being found", () => {
  // 5,000 randomised actions over 90 simulated days: seeds only ever leave via a find
});
```

### P5 — The Keep is never empty

```ts
it("rosterOrder.length >= 1 after every action in a 5,000-action randomised sequence", () => {});

it("an ailment on the last active Pip always resolves as the Loyal Turn", () => {
  // for every ailment, every shield state, every RNG seed in 0..199
});

it("the one-place invariant survives loss: every PipId is in exactly one of pips / sanctuary.pips", () => {
  // round 2C's own invariant, re-asserted across the new "lost" reason
});
```

### The balance guard (the round's fragile invariant)

```ts
it("care ease never exceeds comfortReductionMax, for any (comfort, level) pair", () => {
  // property test over comfort ∈ [0, 0.25] × level ∈ 1..10
});

it("a max-level Pip on a MAXED Keep comes home Grumpy, for every personality", () => {
  // the arithmetic of §1.5 Case A — identical by construction to effects.balance.test.ts
});

it("a max-level Pip on an UNBUILT Keep lands inside balance.test.ts's shipped [15, 45] band", () => {
  // §1.5 Case B
});

it("the leave-safe margin only ever widens with levels", () => {
  // for every (personality, need, level): seasonedDrop <= unseasonedDrop
});

it("balance.test.ts and effects.balance.test.ts are byte-identical", () => {
  // enforced by review, not by code: level is optional, undefined ≡ 1, seasoning ≡ 0
});
```

### Migration and the Album

```ts
it("no migrated Pip is Elder, readyToRetire, or ailing", () => {
  // v8 fixture with a 21-day-old Pip ⇒ lifeMs 0, season Young, ailment null
});

it("every migrated Pip — active and resident — starts at level 2 with the matching pipXp", () => {});

it("the Album's forms-caught total never decreases across a 5,000-action sequence including losses", () => {});

it("a bred child's species is always one of its parents' BIRTH species", () => {
  // 500 seeds; the Album cannot be advanced by breeding
});
```

---

## 9. RISKS, INTERACTIONS AND THE SAVE SCHEMA

### 9.1 Interaction with every shipped system

| Round | System | Interaction | Verdict |
|---|---|---|---|
| **2A** | Decay retune, 16h cap | Seasoning enters `effectiveRates` as a headroom-clamped subtraction inside the existing fifth factor. `offlineRateCapMs` now governs three things (needs, production, **ageing + countdowns**). | Safe. `balance.test.ts` byte-identical. |
| **2A** | Sulking floor | Untouched. Ailments are orthogonal to `sulking`; a Pip can be both, and `isSulking()` remains the only sulk check. | Safe. |
| **2A** | Debug time slider | Routes through CATCHUP, so it honestly simulates the vigil floor and the ageing cap. Add three debug buttons: *inflict ailment*, *age to Elder*, *seed a lineage egg*. | Additive. |
| **2B** | Six biomes, quick/deep | Risk maps exactly onto the quick/deep split. **No level-1 expedition changes**, so the wood ceiling is untouched. | Safe. |
| **2B** | Food sizing | The `poultice` is **not a food** — it is a Give Item consumable with zero hunger. It cannot enter `foods.test.ts`'s servings-to-cover-a-day table. | Safe. |
| **2C** | Never punish absence | The vigil floor + no-loss-in-catch-up is the *strongest* statement of this guardrail in the codebase. Ageing capped. | Reinforced. |
| **2C** | Album permanence | A loss touches no Album counter. New `lineage` line is additive. | Safe, tested. |
| **2C** | Long Meadow | Reused wholesale for the lost, under `reason: "lost"`, with a `remembered` retrieve refusal. One-place invariant preserved. **`sanctuaryFirstArrivalXp` must be gated on `reason !== "lost"` — grief pays nothing.** | Watch item, tested. |
| **2C** | Streak / bounties / milestones | A loss is not a missed day and breaks nothing. No milestone may be earned by losing. | Safe, tested. |
| **2C** | Loot & egg channels | Lineage/bred eggs bypass both channels entirely (no loot roll, no biome egg roll). | Safe. |
| **2C** | Copy lint | Extended to every new string: ailments, seasons, retirement, loss, the Nook card. | Additive. |
| **2F** | Keep XP spine | Six new rows (§9.3). Adding sources only ever makes the bar move more — the safe direction for `levelCurve.test.ts`'s floors. Milestone XP ratio unchanged. | Safe. |
| **2F** | `comfortReductionMax` | **The shared channel.** §1.4. | The round's fragile invariant. |
| **2F** | `expeditionSpeedFloorWithQuirk` | Now floors three factors (building × Hardworking × level) instead of two. An authorised **tightening** — it binds on strictly more combinations. | Named, tested. |
| **2F** | Building effects | Two new kinds: `longevity`, `remedy`. Both sum-then-clamp through `resolveKeepEffects` exactly like the seven existing kinds. One new placeable (Poultice Shelf, tier 5). | Additive. |
| **2F** | `reachability.test.ts` | Poultice Shelf priced `{ wood: 7, fiber: 6 }`, checked at its own `unlockKeepLevel` 5 by the shipped `payableAt` rule. Careful route is strictly slower per minute. | Safe. |
| **2G** | HUD files | **Not touched.** Seams reported in §9.5. | Coordinated. |

### 9.2 The save schema — ONE bump, v8 → v9

**`PipState`** (every field optional, `undefined ≡` the stated default — the `sulking`/`mastery`
precedent, so no fixture in the repo needs an edit):

```ts
readonly level?: number;                                  // ≡ 1
readonly pipXp?: number;                                  // ≡ 0
readonly lifeMs?: number;                                 // ≡ 0
readonly ailment?: AilmentState | null;                   // ≡ null
readonly scars?: readonly string[];                       // ≡ []
readonly resistances?: Readonly<Record<string, number>>;  // ≡ {}
readonly readyToRetire?: boolean;                         // ≡ false
readonly generation?: number;                             // ≡ 1
readonly parentIds?: readonly PipId[];                    // ≡ []
readonly lastBredAt?: number | null;                      // ≡ null
readonly clutches?: number;                               // ≡ 0
```

**`GameState`**: `lineageEggs: readonly LineageEggSeed[]`, `lastLossOutcome: LossOutcome | null`,
`settings: { quietKeep: boolean }`.
**`SanctuaryRecord`**: `reason: "player" | "age" | "lost"`.
**`Egg`**: `lineageGenome?: TraitGenome`, `lineageParentIds?: readonly PipId[]`.
**New RNG streams**: `"ailment"` (contract + cure), `"lineage"` (find + combine + shiny). Absent keys
in `rngState` already read as cursor 0, so no migration is needed for them.

**The v8 → v9 migration**, defensive throughout like every step before it:

| Field | Backfill | Why |
|---|---|---|
| `lifeMs` | **0**, for every Pip in `pips` **and** every `sanctuary.pips[*].pip` | The brief's hard requirement: *no currently-owned Pip is instantly old.* A three-week-old veteran starts its first season now. |
| `level` / `pipXp` | **2** / `pipLevelXp[1]` | A small, provably safe thank-you: a veteran's Pips arrive with a season already behind them. Level 2 is 0.01 seasoning — no guard moves. |
| `ailment` | `null` | *No currently-owned Pip is instantly ailing.* |
| `readyToRetire` | `false` | Follows from `lifeMs: 0`; written explicitly so a round-trip through `serialize.ts` is byte-equal. |
| `scars`, `resistances`, `parentIds` | `[]`, `{}`, `[]` | — |
| `generation`, `clutches` | `1`, `0` | — |
| `sanctuary.pips[*].reason` | `"player"` | Nothing could have been age-retired or lost before this round. |
| `lineageEggs`, `lastLossOutcome`, `settings` | `[]`, `null`, `{ quietKeep: false }` | — |

**Rejected alternative, recorded:** backfilling `lifeMs` from `ageMs` (even clamped to 20 % of a
lifespan). It reads as more "correct" and it is strictly worse — it makes the first thing a
returning veteran sees a Pip closer to the end than a new player's, which is the punishment the
brief forbids. Fixture required: a v8 save with a 21-day-old, evolved, mastery-laden Pip.

### 9.3 New Keep XP rows

`ailmentCured 30`, `pipLevelPerLevel 10` (idempotent on `counters["pipLevel.<pipId>.<level>"]`),
`retirementWitnessed 40`, `lineageEggFound 50`, `breedEgg 20`.
**A loss grants zero.** Grief is never monetised, in either direction.

### 9.4 Risks

1. **Two clocks confuse players or builders.** *Mitigation:* neither is ever displayed as a number;
   `ageMs` keeps its two existing jobs and gains none; the field doc on `lifeMs` states the ageing
   rule in full. *Likelihood: medium. Severity: low.*
2. **Per-Pip XP re-derives progression-bible §0.1.** *Mitigation:* §1.0's four-row table, plus the
   hard rule that the Keep bar stays the header and the Pip bar lives on the card. *Severity: high if
   ignored — this is the review checkpoint.*
3. **Late-game Keeps get no decay benefit from levels.** Accepted and named (§1.4). The other five
   channels are unshared.
4. **The loss still lands wrong for someone.** *Mitigation:* the Quiet Keep (§7.7). This is the
   residual-risk answer and it is complete.
5. **Dialogue authoring: 2 new contexts (`elder`, `ailing`) × 5 personalities × 8 lines = 80 new
   lines**, plus the loss/retirement/Loyal-Turn eulogy fragments. Real, budgeted, non-optional work —
   §3 of the spec says the charm lives here. *Severity: schedule, not design.*
6. **The lineage egg's flat 0.40-then-guaranteed shape breaks the codebase's pity-ladder habit.**
   Deliberate, and recorded as an exception: a long shoulder is what makes a chase feel unfair, and
   this chase begins in grief.
7. **Ailment frequency lands wrong in playtest.** *First lever:* `ailments.contractChance` per biome.
   *Second:* `cureBase`. *Never:* `minDurationMs`, `vigilFloorMs`, or any shield.
8. **A player discovers retire-to-pause and treats it as the correct play.** Acceptable — it is a
   kindness, it costs a roster slot and 8 h, and it does not cure. *Severity: low.*
9. **Perf.** One extra number per Pip per segment. Immaterial.

### 9.5 Seams for the orchestrator (round 2G owns these files — I have not touched them)

| File (2G-owned) | What round 2H needs | The seam |
|---|---|---|
| `ui/topBar.ts` | An ailment ring / Elder tint on the cast strip portrait | **`ui/pipStatus.ts`** (new, 2H-owned): `pipStatusBadge(pip): { kind: "ailing" \| "elder" \| "ready" \| null; ring?: number; label: string }`. Pure, unit-tested, DOM-free. 2G calls it. |
| `ui/awaySheet.ts` (the Doorstep) | Report ailment progress and new retirement readiness — **never a loss** | `CatchupSummary` gains `ailmentProgress?: { pipId; ailmentId; remainingMsBefore; remainingMsAfter; stage }[]` and `retirementsReady?: readonly PipId[]`, stamped by `recordCatchupGains` exactly like `keepXpGained`. Copy supplied in §3.4 / §2.4. |
| `ui/lootReveal.ts` | The "came back limping" beat after a risky trip's reveal | `PendingReveal` gains `contractedAilmentId?: string`. One extra staged card at the end of the existing sequence. |
| `ui/levelUp.ts`, `ui/milestoneCelebration.ts` | Must not fire during or within 3 s of the loss moment | A single exported predicate from 2H's loss module: `isMourning(state, now): boolean`. Both queues already defer defensively; they gain one more condition. |
| `ui/buildSheet.ts` | The Poultice Shelf card and the `remedy`/`longevity` effect copy | Pure data — `content/placeables.ts` + `content/buildingEffects.ts` + the shipped generated-copy path. No 2G file changes. |

2H owns and may freely edit: `ui/focusView.ts`, `ui/sanctuary.ts`, `ui/pipdex.ts`, `ui/notify.ts`,
`ui/navMenu.ts`'s Nook tabs, plus new modules `ui/lossMoment.ts`, `ui/ailmentCard.ts`,
`ui/pipStatus.ts`, `ui/lineageCard.ts`, `ui/breedSheet.ts`.

**New layer-ladder rungs** (`ui/layers.test.ts` must be extended, not reordered):
`.pk-loss` at **z 48** — above the milestone ribbon (47), below the recovery modal (50), because
nothing except a corrupt save may cover it; and `.pk-breed-wrap--open` at **z 26** as a peer of the
sanctuary confirm (reachable from the focus view and the roster alike).

---

## 10. IMPLEMENTATION ORDER

1. `tuning.lifecycle` block + the four content registries (ailments, poultice, Poultice Shelf,
   `longevity`/`remedy` effect kinds). Content only — nothing observable.
2. `PipState` fields + `core/pips/level.ts` (curve, channels, seasoning) + the `effectiveRates`
   headroom clamp. **`balance.test.ts` and `effects.balance.test.ts` must stay green
   byte-identical here** — that is the checkpoint before anything else lands.
3. `core/pips/lifespan.ts` (`lifeMs` accrual in `applyNeedsDelta`/`advanceThroughCap`, seasons,
   `readyToRetire`) + P3 tests.
4. `core/pips/ailments.ts` (state machine, countdown, vigil floor, cure rolls, shields) + P1/P2
   tests. **No `lost` transition yet** — prove the countdown before proving the ending.
5. The `lost` resolution, `lastLossOutcome`, the sanctuary `"lost"` reason, `lineageEggs` seeding —
   one atomic reducer arm + P4/P5 tests.
6. Lineage find + hatch; breeding action; `combineGenomes` wired at last.
7. v9 migration + fixture. Keep XP rows. Milestones. Dialogue (80 lines).
8. UI: loss moment, ailment card, season word, retirement card, Nook "Someone to find", breed sheet,
   Long Meadow sections, Album lineage line, `ui/pipStatus.ts` for 2G.
9. The Quiet Keep toggle. Last, so it is written against a finished system rather than as an excuse
   for one.
