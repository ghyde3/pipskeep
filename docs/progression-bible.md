# PipsKeep — The Progression Bible (Round 2F)

> **The owner's diagnosis, verbatim, is the brief:** *"we're good for a simple 5 minute game 'oh thats cute'
> but no solid reason yet to entice players to come back."* Specifically: no visible experience bar; no
> reason to build; `"pips will use this"` / `"just lovely"` is far too vague; the catalog is far too
> limited; Keep level 3 is too shallow; milestones complete silently.
>
> **The answer this round builds:** ONE spine — **Keep XP** — that every action feeds, a **12-tier Keep
> ladder** hung off it where every tier has a name you can look forward to, **buildings that do things**,
> and an item card that tells you what a thing does instead of that it is lovely.

This document is design only. It authors no feature code. The one file it edits is
`src/content/tuning.ts`, which now carries a fully-commented `tuning.progression` block; every number
below is in the repo and cross-references this document.

Read alongside: `PIPSKEEP_SPEC.md` §4.4 (Pips never die, never punish), §9 (the Keep), §12 (scope
fence), §15.5 (tone), §16 (v1.1/v1.2/v1.3 amendments — they override earlier sections);
`docs/retention-bible.md` (round 2C — this round composes with all nine of its systems);
`docs/content-bible.md` (round 2B — §3.3's level-1 wood ceiling and §9's risk list are still live).

---

## 0. The four invariants of this round

Every decision below is downstream of these. Each is written so a test can hold it.

### 0.1 ONE SPINE. Keep XP, never per-Pip XP.

XP belongs to **the Keep**, not to a Pip. Reasons, in order of how much they matter:

1. **No session is wasted.** A five-minute check-in that pets two Pips and collects one reveal moves
   the same bar as an hour of expeditions. Per-Pip XP would mean the bar you were watching stops the
   moment that Pip goes on a trip, retires to the Long Meadow, or evolves.
2. **It composes with the Long Meadow.** Round 2C's whole answer to "a collection game with nowhere
   to put the collection" is that retiring costs you nothing. Per-Pip XP would make retiring cost you
   a progress bar — the exact punishment §4.4 forbids.
3. **It has somewhere to go.** Keep XP already has a ladder waiting for it: the Keep's level, its
   ground, its stations, its trails. Per-Pip XP would need a second, invented ladder.
4. **It cannot be farmed by roster churn.** Hatch-and-retire loops can't reset anything.

### 0.2 THE BAR ALWAYS MOVES — and that is a testable claim, not a vibe

Four thresholds, all computable from `tuning.progression` alone, all asserted:

| Player did… | Must move the current tier's bar by at least |
|---|---|
| one care action (a single Pet) | **0.15 %** |
| one care round (6 taps) + one Meadow round-trip | **1.2 %** |
| one engaged session (roster care round + 4 quick trips + 1 deep trip + the day's bounties + the streak day) | **8 %** |
| one capped absence with one Gathering Station staffed | **4 %** |

The bar is **per-tier**: numerator `keepXp − levelXp[L]`, denominator `levelXp[L+1] − levelXp[L]`.
Cumulative bars are why every XP game eventually stops feeling like it moves.

Rendering carries the last mile, and it is not optional: every grant floats a `+N XP` chip that flies
into the bar, the fill animates with a **2 px minimum advance** (a "tick floor", so a sub-pixel grant
still visibly nudges), and the numerals under the bar (`1,240 / 1,530`) always change. A single Pet at
tier 12 is 0.17 % of the bar — half a pixel of fill, but a visible `+4` and a changed number. Say what
we mean: *the bar always acknowledges you*; the FILL is guaranteed to move on a care round.

### 0.3 PROGRESSION IS OPT-IN DELIGHT, NOT A TREADMILL WITH A WHIP

Round 2C's §0.1 and §0.3 bind this round unchanged, restated in this round's own terms:

| Thing | May it ever decrease? |
|---|---|
| `keepXp` | **No.** Forward-only, forever. Nothing in this round spends, decays, or resets it. |
| `keep.level` | **No.** |
| Building effects on a placed item | **No** while placed. Tucking an item away removes its own contribution — that is the player's choice, not a decay. |
| `counters["built.<itemId>"]` | **No.** First-build XP is paid once and never clawed back. |
| A tier that is ready to buy | **Waits forever.** No claim window, no expiry, no "ready for 3 more hours". |
| Set-bonus membership | Only by the player tucking items away. |

Banned copy, in addition to 2C's list (`retention.copy.test.ts` extends to cover the new surfaces):
"XP lost", "level down", "only N XP left", "catch up", "you're behind", any comparison to another
player or to the player's own past pace, and any countdown attached to a tier.

**And the round's own new temptation, named so it is refused out loud:** it would be very easy to make
a building effect that *increases* decay ("the Bonfire dries everyone out"), or a tier that *raises* a
cost. Neither exists. **Every building effect strictly helps; no tier ever makes anything worse.**

### 0.4 BUILDINGS SHORTEN THE CHORE. THEY NEVER TRIVIALISE CARE.

`core/pips/balance.test.ts` is the contract and it stays green **byte-identical** (§8.2 shows why by
construction). On top of it, this round adds one new claim and asserts it:

> A **maximally-built** Keep — every comfort channel at its cap — still comes home **Grumpy** after a
> 24-hour absence, for every personality, and still needs care or its needs still reach 0.

The arithmetic is in §3.6. The single number that makes it true is
`progression.effectCaps.comfortReductionMax = 0.25`. If a proposed effect needs that cap raised, the
effect is wrong.

---

## 1. KEEP XP AND THE LEVEL CURVE

### 1.1 Data shape

```ts
// GameState — ONE new required field for the whole round (§8.4)
readonly keepXp: number;   // lifetime total, forward-only, integer
```

Everything else is derived or reuses existing state:

- **Current tier** — `state.keep.level`, unchanged, still the single source of truth for every gate.
- **Tier readiness** — `keepXp >= levelXp[level + 1]`, derived.
- **One-time-XP idempotence keys** — `state.counters`, which is already forward-only, already
  serialized, already migrated, and already asserted monotonic. New key families:
  `built.<itemId>` (first placement of a building type), `job.<jobId>` (first shift at a job),
  `masteryTier.<pipId>.<biomeId>` (highest tier already paid for). No new schema field for any of them.

`levelXp` is content (`tuning.progression.levelXp`), so **retuning the curve re-grades every existing
save with no migration** — the same reasoning that keeps mastery storing trips rather than tiers
(retention bible §6.1) and evolution storing `happinessIntegral` rather than a readiness flag
(spec §4.6).

### 1.2 Tiers are EARNED with XP and PAID FOR with resources — two keys, on purpose

`PURCHASE_KEEP_LEVEL` survives unchanged in shape and gains exactly one new refusal: `needsXp`. A tier
becomes purchasable when **`keepXp >= levelXp[next]`** *and* the player can afford `levelCosts[next]`
(five of the eleven tiers have a cost; six are free).

Why both keys rather than XP alone:

- **The XP gate is what makes late tiers take weeks.** Resource costs cannot: §8.3 shows that the six
  expeditions and four resources cap the top affordable bundle at roughly 3.5× the level-2 bundle in
  wall-clock, so a resource-only ladder physically cannot escalate across twelve tiers. XP can, freely.
- **The resource gate is what keeps expeditions and jobs load-bearing.** An XP-only ladder would make
  the entire economy decorative.
- **`core/economy/reachability.test.ts` survives almost untouched** (§8.3). Levels 2 and 3 keep
  byte-identical costs, so *"Keep level 2 in 30–45 minutes"*, the Gathering-Station on-ramp ratio and
  the level-1 wood ceiling are all preserved exactly.
- **The tier stays a player-witnessed moment.** Like hatching (§7.2) and evolution (§4.6), the Keep
  never levels up while you are away. The bar fills, the chip reads **Ready**, and the tap is the
  celebration. Nothing is missable: a ready tier waits forever.

**Where the player SEES it:** the Keep bar (`ui/phase5.ts`, bottom-left) becomes
`[ Lv 5 ] ▓▓▓▓▓▓░░░░ 1,240 / 1,530` — the level chip, the fill, the numerals. When the bar fills the
chip swaps to `[ Lv 5 ▸ Ready ]` and pulses. Tapping it opens the upgrade card (`ui/keepUpgrade.ts`),
whose header gains the same bar plus **the next tier's headline unlock by name**
("Level 6 — the Larder and the Nest Warmer").

### 1.3 The complete XP source table

Every arm of `GameAction` in `core/state.ts`, with nothing left off the list. `mult` values are the
`tuning.progression.xp.*` keys.

| # | Action / event | XP | Idempotence / anti-farm | Where the player sees it |
|---|---|---|---|---|
| 1 | `TICK` | **0** | — | — (the app breathing, not the player — the same rule as `STREAK_VISIT_ACTION_TYPES`) |
| 2 | `SET_ACTIVE_PIP` | **0** | — | — |
| 3 | `FEED` (applied) | **4** | `lastCareOutcome.applied === true` | `+4 XP` chip → the Keep bar |
| 4 | `CLEAN` (applied) | **4** | applied + the shipped 60 s cooldown | ditto |
| 5 | `PLAY` (applied) | **4** | applied; refusals pay nothing | ditto |
| 6 | `PET` (applied) | **4** | applied + the shipped 30 s cooldown | ditto |
| 7 | `GIVE_ITEM` (applied) | **4** | applied; consumes an item | ditto |
| 8 | `REST_TOGGLE` → *starts* a nap | **4** | only when the pip ends in `Resting` (mirrors the `naps` counter) | ditto |
| 9 | `ASSIGN_EXPEDITION` (ok) | **2** | `lastAssignOutcome.ok`; one pip per trip caps the rate | `+2 XP` on the send-off |
| 10 | `ACKNOWLEDGE_REVEAL` (per trip) | **6 + 1 per full 5 min of nominal duration** → Meadow 7 · Forest 9 · Shore 12 · Bramblewick 14 · Snowdrift 18 · Grotto 24 | consumes the queue head | `+N XP` inside the loot-reveal modal, next to the haul |
| 11 | `HATCH_EGG` (ok) | **40** | `lastHatchOutcome.ok`; the egg leaves state | `+40 XP` in the hatch moment |
| 12 | `CATCHUP` | **0 directly** | its reveals pay at #10; its job ticks pay at #16 | the Doorstep's Keep section: *"+340 Keep XP while you were away."* |
| 13 | `PLACE_ITEM`, **first ever placement of this `itemId`** | **25** | `counters["built.<itemId>"]` — paid once per building TYPE, forever | `+25 XP` and a **NEW** flag leaving the Build-sheet card |
| 13b | `PLACE_ITEM`, any later placement | **0** | — closes the place→refund→place printer | — |
| 14 | `MOVE_ITEM` | **0** | rearranging is not progress | — |
| 15 | `REMOVE_ITEM` | **0**, and never negative | XP is forward-only (§0.3) | — |
| 16 | Job production tick (inside `TICK`/`CATCHUP`) | **1 per tick** | ticks are timestamp-derived and capped by `offlineRateCapMs` → ≤ 96 per absence per Gathering Station | the Doorstep's away-XP line; the production toast gains `+N XP` |
| 17 | `ASSIGN_JOB`, **first ever shift at this `jobId`** | **20** | `counters["job.<jobId>"]` | `+20 XP` on the send-to-work moment |
| 18 | `UNASSIGN_JOB` | **0** | — | — |
| 19 | `PURCHASE_KEEP_LEVEL` | **0** | the tier IS the reward | — |
| 20 | `PURCHASE_ROSTER_UPGRADE` | **60** | once, by the flag | `+60 XP` in the Cozy Bunks celebration |
| 21 | `EVOLVE_PIP` (ok) | **90** | `readyToEvolve` is consumed | `+90 XP` in the evolution moment |
| 22 | `RETIRE_PIP` (ok, **first** arrival only) | **20** | `sanctuary.pips[id].visits === 0` — a retrieve→retire loop pays nothing the second time | `+20 XP` on the Long Meadow send-off |
| 23 | `RETRIEVE_PIP` | **0** | asking someone home is a kindness, not a grind | — |
| 24 | `ONBOARDING_ADVANCE` | **0** | — | — |
| 25 | `DEBUG_GRANT` / `DEBUG_SPAWN_EGG` / `LOAD_SAVE` | **0** | QA seams stay honest | — |
| 26 | `SET_DAY_OFFSET` / `SET_ACTIVE_EVENTS` / `REFRESH_BOUNTIES` / `REROLL_BOUNTY` | **0** | app-layer bookkeeping | — |
| 27 | `CLAIM_STREAK_REWARD` | **20 + 5 × streak tier** (20 → 40) | `streak.rewardedForDay` | `+N XP` on the Doorstep's streak strip |
| 28 | `CLAIM_MILESTONE` | **content-defined `xp`** (§1.5) | `milestones.earned[id]` | the milestone ribbon's `+N XP` chip (§6) |
| 29 | `RESOLVE_STREAK_CHOICE` | **0** | the chosen thing IS the reward | — |
| 30 | Bounty completed (inside `applyBountyProgressForAction`) | **15** | `slots[i].completedAt` | `+15 XP` on the bounty tick-off |
| 31 | Bounty day cleared (all three) | **25** | `bounties.dayBonusGranted` | `+25 XP` on the day-clear celebration |
| 32 | Mastery tier gained (inside `ACKNOWLEDGE_REVEAL`) | **25 × new tier** (25 → 150) | `counters["masteryTier.<pipId>.<biomeId>"]` holds the highest tier already paid | `+N XP` beside the new title on the Pip's card |
| 33 | Album: a species goes **seen** (field note) | **10** | `pipdex.entries[id].seenAt` was null | `+10 XP` on the Album toast |
| 34 | Album: a species goes **caught** (portrait) | **50** | `caughtAt` was null | `+50 XP` on the new-page toast |
| 35 | Album: a new **gift variant** recorded | **35** | the variant leaf was absent | ditto |

**Two structural rules this table encodes, stated for the reviewer:**

1. **Every repeatable source is either rate-capped by an existing mechanism or one-time.** Care actions
   are capped by cooldowns and by the fact that a satisfied Pip's bars are full; expeditions by one Pip
   per trip; job ticks by `offlineRateCapMs`; bounties by three a day; streak by one day a day. There
   is no unbounded loop anywhere in the table, and the two that *looked* unbounded — place/remove and
   assign/unassign — are keyed to first-time-only counters.
2. **XP is pure arithmetic. No new RNG stream, no new cursor.** The 2C test *"retention systems add no
   rng cursors"* extends to progression verbatim.

### 1.4 The curve — 12 tiers

`tuning.progression.levelXp` is the cumulative table; the bar's denominator is the difference.

| Tier | Δ XP (the bar) | Cumulative | One care action = | Care round + Meadow trip = |
|---:|---:|---:|---:|---:|
| 1 | — | 0 | — | — |
| 2 | 100 | 100 | 4.0 % | 33 % |
| 3 | 180 | 280 | 2.2 % | 18 % |
| 4 | 300 | 580 | 1.3 % | 11 % |
| 5 | 400 | 980 | 1.0 % | 8.3 % |
| 6 | 550 | 1,530 | 0.73 % | 6.0 % |
| 7 | 700 | 2,230 | 0.57 % | 4.7 % |
| 8 | 900 | 3,130 | 0.44 % | 3.7 % |
| 9 | 1,150 | 4,280 | 0.35 % | 2.9 % |
| 10 | 1,450 | 5,730 | 0.28 % | 2.3 % |
| 11 | 1,800 | 7,530 | 0.22 % | 1.8 % |
| 12 | 2,300 | 9,830 | 0.17 % | 1.4 % |

Every cell in the last two columns clears §0.2's thresholds (0.15 % and 1.2 %) — the tier-12 row is the
binding one and it clears both with room. **Assert the whole column, not the endpoints:** a future
tuning that steepens tier 9 must fail here, not in playtest.

**The intended shift in what pays.** Early tiers are paid for in taps (a care action is 4 % of tier 2);
late tiers are paid for in **events** — a Grotto trip is 1.0 % of tier 12, a hatch 1.7 %, an evolution
3.9 %, a long-haul milestone 5.2 %, a mastery tier-6 6.5 %. That is the correct shape for a game whose
late-game content is expeditions and collection, and it is why the fill still visibly jumps at tier 12
even though a single Pet does not move it.

### 1.5 Milestone XP bands

`MilestoneDef` gains one required field: `readonly xp: number`. Bands (`tuning.progression.xp.milestoneBands`):

| Band | XP | Count today | Subtotal |
|---|---:|---:|---:|
| First hour (First Feed, First Trip Home, …) | 15 | 7 | 105 |
| First day (10 care actions, 5 trips, …) | 30 | 6 | 180 |
| First week (50 care actions, 7-day streak, First Evolution, …) | 60 | 11 | 660 |
| Long haul (500 care actions, 14/14, 21/21, 30-day streak, …) | 120 | 14 | 1,680 |
| **NEW: one milestone per Keep tier** ("The Keep, Level 7") | 40 (t2–4) / 80 (t5–6) / 150 (t7–9) / 220 (t10–12) | 11 | 1,290 |

Total milestone XP ≈ 3,915, of which roughly 2,200 is earnable before tier 12 — **22 % of the ladder**.
High enough that milestones feel like progress, low enough that the ladder is not a milestone checklist.
`content/milestones.test.ts` gains: *"pre-tier-12 milestone XP is under 30 % of `levelXp[12]`"*.

The eleven new Keep-tier milestones cost nothing to build: `bumpCountersForAction`'s
`PURCHASE_KEEP_LEVEL` arm already writes a **generic** `keepLevel<N>Reached` counter, so
`keepLevel7Reached` exists the moment the union widens. They also give the Chronicle (§2, tier 9) its
entire data source for free — `milestones.earned` is already `id → earnedAt`.

### 1.6 Wall-clock: two players, measured

**Income model.** Stated so it can be argued with, and so the build agent can re-measure it.

| Phase | Engaged player (3 sessions/day, ~45 min) | Casual player (1 check-in, ~5 min + one overnight) |
|---|---:|---:|
| Day 1 (onboarding + 45 min) | 450 | 250 |
| Days 2–4 (3 Pips, 3 trails, 1 station) | 420 / day | 180 / day |
| Days 5–10 (5 Pips, 5 trails, 2 stations) | 600 / day | 180 / day |
| Day 11+ (all six trails, 3 stations, sets built) | 750 / day | 190 / day |

Worked example — one engaged day at tier 7: 12 Meadow round-trips (12 × 9 = 108) + one Snowdrift
(20) + 30 care actions across 5 Pips (120) + 96 Gathering ticks (96) + 3 bounties and the day-clear
(70) + the streak day (35) + one hatch (40) + one milestone (60) = **549**. The 600/day row assumes a
second station.

| | Engaged | Casual |
|---|---|---|
| Tier 2 | 12 min | ~20 min |
| Tier 3 | ~35 min | day 1 (late) |
| Tier 4 — **the Shore** | ~1 h 30 (day 1) | day 3 |
| Tier 5 — **the Lanterngrotto** | day 2 | day 6 |
| Tier 6 | day 3 | day 9 |
| Tier 7 | day 5 | day 13 |
| Tier 8 | day 7 | day 18 |
| Tier 9 | day 9 | day 24 |
| Tier 10 — **the Beacon** | day 11 | day 32 |
| Tier 11 — **a sixth bed** | day 14 | day 40 |
| Tier 12 — **the Weathervane** | day 17 | day 54 |

"Early levels within the first session, mid-game in days, late-game in weeks" — 2 and 3 inside session
one, 4–8 across the first week, 9–12 across weeks two and three (engaged) or months two (casual).
**And critically: tier 2 lands at 12 minutes of XP but its 5 Wood / 6 Fiber takes ~33 minutes**, so the
shipped *"Keep level 2 in 30–45 minutes"* feel claim is unchanged and the resource gate — not the XP
gate — is still the binding one there. That is deliberate: the first tier must not feel like it was
handed over.

### 1.7 After tier 12: Renown

`keepXp` does not stop. Past `levelXp[12]`, every `renown.xpPerLevel` (3,000) grants one **Renown**
level. Renown grants **flair only, forever** — never power, never resources, never a cap change. Every
fifth Renown level mints a new cover stamp / page frame / Keep title from `content/flair.ts`.

This exists for one reason: the bar must never be full and dead. At an engaged 750/day a Renown level
is four days; at a casual 190/day it is a fortnight. It is the cheapest possible answer to "what is
there at day 60", it cannot inflate anything, and it is the **last** thing to cut from the round.

**Where the player SEES it:** the level chip reads `[ Lv 12 · Renown 3 ]` and the bar keeps filling;
the Album cover carries the stamps.

---

## 2. THE 12-TIER UNLOCK LADDER

Every tier has a **headline the player can look forward to by name**. A tier that only raises a number
is a dead tier, so there are none.

| Tier | Cum. XP | Resource cost | HEADLINE | Also |
|---:|---:|---|---|---|
| **1** | 0 | — | **The Meadow and the Bramblewick** | 8×8 ground · Food Bowl, Bed, Gathering Station · **Keep Comfort is live from tap one** (the Bowl and the Bed already do something) · the Keepsake Shelf |
| **2** | 100 | `wood 5, fiber 6` *(shipped, byte-identical)* | **The Forest trail** | +4 rows → 8×12 *(shipped)* · the **Wash Basin** and the **Play Post** |
| **3** | 280 | `wood 22, fiber 14` *(shipped, byte-identical)* | **The Snowdrift** | the **Stockpot** + the **Simmering** job · **set bonuses go live** (3-of-a-set) |
| **4** | 580 | — | **The Shore** | **Cozy Bunks** becomes purchasable (roster 3 → 5) |
| **5** | 980 | `wood 27, fiber 20` | **The Lanterngrotto** | +2 columns → 10×12 |
| **6** | 1,530 | — | **The Larder and the Nest Warmer** | eggs hatch sooner, the pantry keeps · **5-of-a-set bonuses go live** |
| **7** | 2,230 | `wood 30, fiber 22, shell 6` | **More ground — +2 rows → 10×14** | the **Trail Post** (trips find more) |
| **8** | 3,130 | — | **The Workbench and the Mending job** | the **Sun Bunks** (naps finish sooner) |
| **9** | 4,280 | `wood 34, fiber 26, shell 7, driftwood 4` | **The last ground — +2 columns → 12×14** | **The Chronicle** — a dated page of everything the Keep has done |
| **10** | 5,730 | — | **The Beacon — every trip comes home sooner** | — |
| **11** | 7,530 | — | **A sixth bed — the roster cap rises to 6** | — |
| **12** | 9,830 | — | **The Weathervane, and Renown begins** | the endless flair ladder (§1.7) |

### 2.1 Which tiers gate which of the six expeditions

Round 2B put all six at levels 1–3 — meaning a two-hour-old save had seen every trail in the game.
Re-spread:

| Expedition | Duration | 2B | **2F** | Why |
|---|---:|---:|---:|---|
| Meadow | 5 min | 1 | **1** | Untouched. Load-bearing for four pinned reachability assertions (content bible §2.2). |
| Bramblewick | 40 min | 1 | **1** | Untouched. The first session's "leave it running" hook, and it drops no Wood, so it cannot touch the level-1 wood ceiling. |
| Forest | 15 min | 2 | **2** | Untouched. Level 3's `wood 22` is priced against Meadow + Forest. |
| Snowdrift | 60 min | 2 | **3** | +1 tier. Removing it from level-2 income leaves Wood at 0.33/min there — level 3 still lands at 66.7 expected minutes (up from 61.1), which *strengthens* the escalation chain. |
| Shore | 30 min | 3 | **4** | +1 tier. Shell and Driftwood now arrive at tier 4, so **Cozy Bunks' `prerequisiteLevel` moves 3 → 4** (the tier that supplies its cost). |
| Lanterngrotto | 90 min | 3 | **5** | +2 tiers. The trophy chase (Lanternpip ≈ 10.5 engaged hours, content bible §9.8) starts on engaged day 2 / casual day 6 rather than hour 2 — later, but not so late that the Album becomes unfinishable. |

Reachability consequences are worked in full in §8.3; the summary is that the priced chain
2 → 3 → 5 → 7 → 9 measures **33.3 → 66.7 → 75.0 → 79.0 → 89.6** expected minutes, strictly
increasing, every row inside the 3-hour affordability ceiling with ≥ 0.95 seeded afford rate.

### 2.2 Grid growth

`progression.gridGrowth` (mirrors and supersedes `keepGrid.growthPerLevel`, with a test asserting the
shipped tier-2 entry is byte-identical):

| Tier | Growth | Size | Tiles |
|---:|---|---|---:|
| 1 | — | 8×8 | 64 |
| 2 | +4 rows *(shipped)* | 8×12 | 96 |
| 5 | +2 cols | 10×12 | 120 |
| 7 | +2 rows | 10×14 | 140 |
| 9 | +2 cols | 12×14 | 168 |

Stops at 168 on purpose. Spec §1's perf budget is *"5 animated Pips + 30 decorations"*; 168 tiles can
host roughly 60–80 items, which is already 2× that budget. **This is the round's main perf risk** — see
§8.6, where the obligation and the fallback lever are named.

### 2.3 Placeables gain an unlock tier

Content bible §9 risk 5 asked for exactly this and could not do it inside a content-only round:

```ts
// content/placeables.ts
readonly unlockKeepLevel: KeepLevel;   // NEW, required
```

Two consequences, both good:

1. **A station can finally be priced in Shell and Driftwood** without failing structural reachability,
   because `reachability.test.ts`'s `pricedPlaceables` moves from a hard-coded `payableAt: 1` to
   `payableAt: item.unlockKeepLevel`. That is the "update reachability expectations" this round is
   authorised to make, and it is a *tightening* — the test now checks each station against the income
   available when it actually appears.
2. **Nine of the twelve tiers can hand out a station by name**, which is what makes the ladder legible.

The four shipped placeables get `unlockKeepLevel: 1` except the Stockpot, which moves to 3 so the
Simmering job becomes tier 3's second unlock. `"a station's own cost is payable at level 1"` still
passes for every job station (all priced in Wood/Fiber only — §4.4's rule survives).

### 2.4 What each tier's unlock is made of — and that none of it is invented

| Unlock currency | Mechanism that already exists | Tiers using it |
|---|---|---|
| Expeditions | `unlockKeepLevel` on `ExpeditionDef` | 1, 1, 2, 3, 4, 5 |
| Ground | `keepGrid.growthPerLevel` → `gridBounds(level)` | 2, 5, 7, 9 |
| Stations | new `unlockKeepLevel` on `PlaceableDef` | 2, 3, 6, 7, 8, 10, 12 |
| Jobs | the 2B-proven job registry (a new job is pure content) | 3 (Simmering), 8 (Mending) |
| Roster | `keepUpgrades.prerequisiteLevel` (4) + `progression.rosterCapBonusByLevel` (11) | 4, 11 |
| Effect *kinds* switching on | `progression.setBonus.tier1LiveAtKeepLevel` / `tier2LiveAtKeepLevel` | 3, 6 |
| Album / history surfaces | `milestones.earned` (already `id → earnedAt`) | 9 (the Chronicle) |
| Flair | `content/flair.ts`, already wired in 2C-review | 12 (Renown) |

**Nothing here is a new system.** Crafting was considered as tier 8's headline and **declined** —
"spend resources → get an item" is a new action, a new registry and a new UI, and CLAUDE.md rule 3
forbids a speculative implementation. Tier 8 gets the Mending job instead, which is genuinely pure
content. Crafting's named seam is §7.6.

---

## 3. BUILDING EFFECTS

The owner's complaint — *"just lovely" is FAR too vague… we need reasons to build items* — is
answered by making placeables and decorations **do** things, mechanically, visibly, and capped.

### 3.1 The typed effect system

Content-defined, so a new building is a data change (spec §3):

```ts
// content/buildingEffects.ts  (new registry module — pure data + the cap table's types)

export type BuildingEffect =
  /** Slows one need's decay (or all four) Keep-wide, as a FRACTION. */
  | { readonly kind: "comfort"; readonly need: NeedId | "all"; readonly decayReduction: number }
  /** Multiplies the Resting energy-regen rate. > 1 only. */
  | { readonly kind: "restSpeed"; readonly multiplier: number }
  /** Multiplies expedition duration. < 1 only. */
  | { readonly kind: "expeditionSpeed"; readonly multiplier: number }
  /** Additive bonus-roll chance — feeds 2C's ONE summed, capped loot channel. */
  | { readonly kind: "expeditionLoot"; readonly bonusRollChance: number }
  /** Additive egg-chance POINTS — feeds 2C's separate, separately-capped channel. */
  | { readonly kind: "eggChancePoints"; readonly points: number }
  /** Multiplies egg incubation time. < 1 only. */
  | { readonly kind: "incubationSpeed"; readonly multiplier: number }
  /** Hosts a job (the existing `jobs.stationItemId` relationship, made explicit on the card). */
  | { readonly kind: "job"; readonly jobId: string }
  /** Multiplies every Keep XP grant. */
  | { readonly kind: "xpBonus"; readonly fraction: number };

// Both registries gain:
readonly effects?: readonly BuildingEffect[];   // absent ≡ []
readonly setId?: string;                        // decoration set membership
readonly icon: IconSpec;                        // §4.2
```

**Five hard rules, each a test in `content/buildingEffects.test.ts`:**

1. **Every effect strictly helps.** `decayReduction > 0`, `restSpeed.multiplier > 1`,
   `expeditionSpeed.multiplier < 1`, `incubationSpeed.multiplier < 1`, `bonusRollChance > 0`,
   `points > 0`, `xpBonus.fraction > 0`. No effect may ever have the other sign. (§0.3)
2. **No effect names a tuning key on 2C's isolation list.** `needDecayPerHour`, `care.*`, `foods.*`,
   `offlineRateCapMs`, `personalityDecayMultipliers`, `playRefusal`, `sulkExitThreshold`. Comfort is a
   *new multiplicative factor*, not an edit to a rate — see §3.2.
   `retention.isolation.test.ts` extends to cover `content/buildingEffects.ts`.
3. **Every channel is summed once and clamped once**, at the caps in §3.3. Sum-then-clamp, never
   multiply-then-clamp — the player must be able to read it ("Bowl −6 %, Larder −8 %, Meadow Green set
   −7 % → −21 % of −25 % max").
4. **Loot and egg-chance effects reuse 2C's existing channels.** They do NOT create new ones. A Trail
   Post's `+0.03` enters the same sum as Curious's `+0.10`, mastery's `+0.15` and the streak tier's
   `+0.20`, and is clamped by the same `retention.loot.bonusRollChanceMax = 0.25`. This is the single
   most important composition decision in §3: it means a maximally-buffed Keep still cannot exceed the
   1.25× yield the economy was tuned for (retention bible §9.1).
5. **Job production takes no multipliers at all**, unchanged from 2C §9.1. `xpBonus` applies to the XP
   a job tick grants, not to the tick's loot.

### 3.2 Where comfort actually applies — the one core touch

`core/pips/needs.ts` `effectiveRates()` currently documents the stack as *base × personality ×
life-stage × situational*. It gains a **fifth, final factor**:

```
rate = needDecayPerHour[need]
     × personalityDecayMultipliers[personality][need]
     × lifeStageMultiplier
     × situational
     × keepComfortFactor[need]        // NEW: (1 − clampedComfortReduction), ≥ 0.75
```

and, while Resting, `rates.energy = care.rest.energyPerHour × keepRestSpeedMultiplier`.

This is a **spec §4.1 amendment** and must be recorded in §16 as v1.4. Three properties make it safe:

- `needDecayPerHour` is never edited, so every arithmetic assertion in `balance.test.ts` — which
  computes drops directly from tuning — is untouched (§8.2).
- The factor is `1.0` on a Keep with no placements, so every reducer-driven test in the repo that
  builds state from `createNewGame` is **byte-identical**.
- The factor is derived from `state.keep.placements` on every call, so it is not stored, cannot drift,
  and needs no migration. Tucking an item away changes it immediately.

`core/keep/comfort.ts` (new, pure) owns the derivation: `keepEffects(keep, level, content) →
ResolvedKeepEffects`, memoised on the `placements` object identity (which the reducer already
replaces wholesale on every placement change — see `PLACE_ITEM`).

### 3.3 The cap table

`tuning.progression.effectCaps`:

| Channel | Cap | Why that number |
|---|---|---|
| `comfortReductionMax` | **0.25** per need | §3.6's arithmetic: 0.25 is the largest value at which a maximally-built Keep still comes home Grumpy for *every* personality. At 0.30 a Curious Pip comes home Content. |
| `restSpeedMax` | **1.60** | A full 0→100 nap is 10 min; at the cap it is 6 min 15 s. `balance.test.ts` asserts a nap is *at least* 5 minutes ("long enough to be a thing you WATCH") — 6:15 keeps that true with margin. |
| `expeditionSpeedMin` | **0.85** | Exactly Hardworking's `−15 %` quirk, so a building can never out-do a personality's identity. |
| `expeditionSpeedFloorWithQuirk` | **0.75** | Buildings compose multiplicatively with Hardworking (0.85 × 0.85 = 0.7225) and are then floored here, so the best possible trip is −25 %. Keeps `reachability.test.ts`'s duration-based measurements honest (they assume no buildings, so they measure a strictly slower economy — a safe direction). |
| `incubationSpeedMin` | **0.80** | A 2 h egg becomes 1 h 36 m. Never below the Pipling stage's own 8 h, so "hatch before bed, adult by morning" survives. |
| `xpBonusMax` | **0.25** | A fully-decorated veteran levels 25 % faster. Folded into §1.6's day-11+ income row, so the wall-clock table already accounts for it. |
| loot bonus | **reuses `retention.loot.bonusRollChanceMax` = 0.25** | one channel, §3.1 rule 4 |
| egg points | **reuses `retention.loot.eggChanceBonusPointsMax` = 0.05**, ceiling `0.60` | ditto |

### 3.4 Per-building effects

**Stations** (`content/placeables.ts` — 13 total, 4 shipped + 9 new):

| id | Tier | Footprint | Cost | Effect | Cap note |
|---|---:|---|---|---|---|
| `food-bowl` | 1 | 1×1 | `wood 2` *(shipped)* | comfort hunger **−6 %** | — |
| `bed` | 1 | 2×1 | `wood 4, fiber 3` *(shipped)* | restSpeed **×1.25**, comfort energy **−6 %** | — |
| `gathering-station` | 1 | 2×2 | `wood 3, fiber 2` *(shipped)* | job `gathering` | — |
| `stockpot` | 3 | 2×2 | `wood 5, fiber 4` *(shipped)* | job `simmering`, comfort hunger **−4 %** | — |
| `wash-basin` | 2 | 1×1 | `wood 3, fiber 2` | comfort cleanliness **−8 %** | — |
| `play-post` | 2 | 2×1 | `wood 4, fiber 4` | comfort happiness **−8 %** | — |
| `larder` | 6 | 2×2 | `wood 8, fiber 5` | comfort hunger **−8 %** | Bowl+Stockpot+Larder = −18 %, under cap |
| `nest-warmer` | 6 | 1×1 | `wood 5, fiber 4` | incubationSpeed **×0.85** | one only matters; a second is clamped |
| `trail-post` | 7 | 1×1 | `wood 6, shell 2` | expeditionLoot **+0.03** | into 2C's 0.25 channel |
| `workbench` | 8 | 2×2 | `wood 6, fiber 5` | job `mending` | station priced Wood/Fiber (§4.4 rule) |
| `sun-bunks` | 8 | 2×2 | `wood 10, fiber 8` | restSpeed **×1.20**, comfort energy **−5 %** | Bed+Bunks = ×1.50, under 1.60 |
| `beacon` | 10 | 2×2 | `wood 12, shell 5, driftwood 3` | expeditionSpeed **×0.92** | two Beacons → 0.846, clamped to 0.85 |
| `weathervane` | 12 | 1×1 | `wood 10, shell 4, driftwood 4` | xpBonus **+0.08**, eggChancePoints **+0.01** | — |

**The third job** (pure content, the 2B proof point re-used):

```
jobs.mending = { id: "mending", name: "Mending", stationItemId: "workbench",
                 intervalMs: 45 min, table: { wood: 60, fiber: 40 },
                 verbing: "mending", restingNote: "Fast asleep. The mending will keep." }
```

Slowest of the three and materials-only — the late-game complement to Gathering's mixed faucet and
Simmering's pantry. One capped 16 h absence is 21 ticks ≈ 12.6 Wood + 8.4 Fiber. It cannot touch any
measured claim: `reachability.test.ts` excludes jobs from `resourcesObtainableAt` by design, and the
casual-on-ramp test reads `jobs["gathering"]` by name.

**Decorations** (32 total, 20 shipped + 12 new). Each carries a **small single-need comfort of 1–2 %**
matching its set, so no decoration is cosmetic-only, and the set bonus does the heavy lifting. With 32
decorations at up to 2 % each the naive sum would be 64 % — the per-need cap of 25 % is what turns that
into an interesting choice: **a 168-tile Keep can max one or two comfort channels, never all four.**

### 3.5 Themed set bonuses — because sets are what make building feel like collecting

```ts
// content/decorSets.ts
export interface DecorSetDef {
  readonly id: string;
  readonly name: string;
  readonly memberItemIds: readonly string[];
  /** At `setBonus.minMembersTier1` (3) distinct members PLACED. */
  readonly bonusAt3: BuildingEffect;
  /** At `minMembersTier2` (5). REPLACES bonusAt3 — never stacks with it. */
  readonly bonusAt5: BuildingEffect;
}
```

Counting rule: **distinct member `itemId`s currently placed**, so five Moss Tufts is one member. That
is what makes a set a collection rather than a spam.

| Set | Members (✱ = new) | 3-of-a-set | 5-of-a-set |
|---|---|---|---|
| **Meadow Green** | moss-tuft, pebble-path, berry-planter, toadstool-ring, cloud-kite, ✱clover-patch, ✱hay-bale | comfort happiness **−4 %** | **−7 %** |
| **Bramble & Twine** | bramble-arch, twine-swing, story-stump, welcome-sign, ✱rope-ladder | restSpeed **×1.10** | **×1.18** |
| **Deep Wood** | sun-awning, ✱pine-marker, ✱log-pile, ✱fern-cluster, mossy-fountain | expeditionLoot **+0.02** | **+0.04** |
| **First Snow** | wind-chime, ✱snow-lantern, ✱icicle-arch, ✱sled, cloud-kite | comfort energy **−4 %** | **−7 %** |
| **Tideline** | driftwood-arch, shell-mosaic, tide-basin, driftwood-bench, wishing-cairn, ✱net-float | comfort cleanliness **−4 %** | **−7 %** |
| **Lantern & Ember** | cozy-lantern, lantern-row, ember-brazier, ✱glow-pool, ✱warm-stones | xpBonus **+0.05** | **+0.10** |

Two items sit in two sets on purpose (`cloud-kite` in Meadow Green and First Snow) — it makes the
Build sheet's set counter interesting, and the cap table makes it safe.

Set bonuses **go live at tier 3** (3-of-a-set) and **tier 6** (5-of-a-set), which is what makes those
two tiers' headlines land: before tier 3 a decoration is 1–2 %; after it, a themed corner is a real perk.

**Where the player SEES it:** every Build-sheet card shows `Tideline — 3 of 6 placed ✓ bonus active`
or `2 of 6 — one more for the set bonus`; the Keep Comfort readout (§4.3) lists each active set bonus
as its own line with the set's name.

### 3.6 The worst-case proof: a maximally-built Keep still needs real care

`balance.test.ts`'s leave-safe arithmetic, restated:
`windowDrop(p, need) = −needDecayPerHour[need] × personalityDecayMultipliers[p][need] × 16 h`.
Comfort multiplies that by `(1 − 0.25) = 0.75`. From a healthy 90 save, after one full capped absence:

| Personality | Hunger | Cleanliness | Happiness | Energy | Lowest | Mood |
|---|---:|---:|---:|---:|---:|---|
| Lazy | 51.3 | 45.6 | 46.8 | **35.4** | 35.4 | **Grumpy** |
| Curious | 44.4 | **38.9** | 53.3 | 43.8 | 38.9 | **Grumpy** |
| Hardworking | **37.6** | 45.6 | 42.5 | 41.7 | 37.6 | **Grumpy** |
| Chaotic | 39.8 | **34.5** | 55.4 | 48.0 | 34.5 | **Grumpy** |
| Clingy | 44.4 | 45.6 | **36.0** | 52.2 | 36.0 | **Grumpy** |

*(Worked example, Chaotic cleanliness: `3.7 × 1.25 × 16 = 74.00`; `× 0.75 = 55.50`; `90 − 55.50 = 34.50`.)*

Four claims fall out, and all four become assertions in a new `core/keep/comfort.balance.test.ts`:

1. **Every personality still comes home Grumpy.** Every "Lowest" cell is under the Grumpy line of 40.
   At `comfortReductionMax = 0.30` the Curious row's lowest becomes 42.3 → **Content**, which is the
   precise reason the cap is 0.25 and not 0.30.
2. **Nobody comes home Miserable, and nobody Sulks.** Every cell is above 25 (`sulkExitThreshold`) and
   far above 15. *That is the payoff the player bought:* an unbuilt Keep returns in the [18, 35] band
   and a bad pairing lands near the sulk line; a fully-built one returns in [34.5, 55.4] and never
   sulks. **The chore got shorter. The care did not become optional.**
3. **Care is still mandatory.** Leave a fully-built Keep at 40 and one absence takes up to 55.5 — it
   still reaches 0. No amount of building removes the need to show up.
4. **The leave-safe inequality is unaffected in the safe direction.** `sessionRestore` is unchanged;
   `windowDrop` can only get *smaller*. The round-2B invariant `sessionRestore > windowDrop` therefore
   holds with a strictly larger margin — the tightest per-pair margin rises from `+8.00`
   (Clingy/happiness: 80 restored vs 72.00 lost) to `+26.00` (80 vs 54.00).

**The mirror-image risk, named:** because comfort only ever *widens* that margin, no building can break
`balance.test.ts`. The way this design could still hurt the player is a future effect with the other
sign — hence §3.1 rule 1, asserted.

---

## 4. THE ITEM INFO MODEL AND THE ICON VOCABULARY

### 4.1 What replaces "the Pips will use this" / "just lovely"

The offending code is `src/ui/buildSheet.ts` lines 91–97:

```ts
foot.textContent = entry.kind === "station"
  ? `${entry.footprintLabel} · the Pips will use this`
  : `${entry.footprintLabel} · just lovely`;
```

It is a hard-coded string chosen by *kind*, so it literally cannot say anything about the item. The
replacement is a structured model built in `ui/buildMode.ts` (the pure layer — node-testable, no DOM):

```ts
export interface BuildEntryModel extends BuildItemDef {
  readonly icon: IconSpec;                       // §4.2
  readonly footprintLabel: string;                // "2×1"  (shipped)
  readonly costLabel: string;                     // "6 Wood + 2 Shell"  (shipped)
  readonly affordable: boolean;                   // (shipped)
  readonly missingLabel: string;                  // (shipped)
  // --- NEW ---
  /** One line per effect, GENERATED from the effect data (§4.4). */
  readonly effectLines: readonly string[];
  /** "Tideline — 3 of 6 placed", or null. */
  readonly setLabel: string | null;
  /** True once the set's 3- or 5-member bonus is active. */
  readonly setBonusActive: boolean;
  /** "Opens at Keep level 7" when locked, else null. */
  readonly lockLabel: string | null;
  /** "+25 Keep XP the first time you build one", or null once built. */
  readonly firstBuildLabel: string | null;
  /** True when this is a free re-placeable keepsake (§5.4). */
  readonly fromKeepsakeShelf: boolean;
  /** The shipped warm one-liner. Kept — it is the charm; it is just no longer the ONLY line. */
  readonly flavor: string;
}
```

A card therefore reads:

```
  ╭──────────────────────────────╮
  │  ◍  Larder                NEW │
  │     2×2 · 8 Wood + 5 Fiber    │
  │     ♥ Hunger falls 8% slower  │
  │       for every Pip           │
  │     ★ +25 Keep XP, first one  │
  │     "A cold cupboard that…"   │
  ╰──────────────────────────────╯
```

The rule that keeps this honest: **effect lines are generated from the effect data, never authored.**
A number in `content/buildingEffects.ts` and a number on the card can therefore never disagree.

### 4.2 The icon vocabulary — procedural inline SVG, no dependencies, no asset pipeline

Not 45 bespoke drawings. **Three orthogonal axes**, composed:

```ts
// ui/itemIcons.ts
export type MotifId =
  | "bowl" | "nest" | "basket" | "pot" | "leaf" | "shell"
  | "flame" | "lantern" | "stone" | "droplet" | "snowflake" | "spark"
  | "arch" | "post" | "bench" | "chime";                        // 16 motifs
export type BadgeId = "heart" | "moon" | "boot" | "star" | "gear";  // 5 badges
export interface IconSpec { readonly motif: MotifId; readonly badge?: BadgeId }
```

1. **Motif** — *what the thing is*. One `<path>`/`<circle>` string per motif in a
   `Record<MotifId, string>`, drawn on a `0 0 24 24` viewBox. ~16 short path strings, ~40 lines of data
   for the whole game.
2. **Badge** — *what the thing does*. A 9×9 corner mark, one per effect family:
   `heart` = comfort · `moon` = rest · `boot` = expedition · `star` = Keep XP · `gear` = hosts a job.
   **Derived from the item's first effect, not authored** — so the badge can never lie either. A
   decoration with only a 1 % comfort effect still wears the heart, which is the point: it does
   something.
3. **Tint** — *what family it belongs to*. A CSS custom property `--pk-icon-tint` set from the item's
   `setId` (or a neutral station tint), sourced from `content/palette.ts`. Six set tints + one station
   tint.

`iconSvg(spec, tint): string` returns a self-contained inline `<svg>`. 16 × 5 × 7 = 560 visually
distinct combinations from ~40 lines of path data and zero new files in `public/`.

**Why not emoji.** The codebase already learned this: `ui/topBar.ts` uses `"🧺"` for the working badge
and `ui/navMenu.ts`'s own comment says a label beats *"an emoji the player has to guess at"*. Emoji
render differently on every platform, cannot be tinted, and cannot carry a badge. Inline SVG can do all
three and costs nothing.

**Where the player SEES it:** the Build-sheet card, the Rearrange rows (so "Move / Tuck away" rows are
finally identifiable at a glance), the placement-mode pill, and the Keep Comfort readout's per-source
lines.

### 4.3 The Keep Comfort readout — the surface that stops effects being a dead feature

Ruling #5 applies hardest here. An effect that is computed and applied but nowhere displayed is exactly
the failure this codebase has now shipped four times. So: **the upgrade card
(`ui/keepUpgrade.ts`) gains a second section, "How the Keep helps".**

```
  How the Keep helps
  ────────────────────────────────────────
  ♥ Hunger      −18%   ▓▓▓▓▓▓▓░░  of −25%
  ♥ Clean       −13%   ▓▓▓▓▓░░░░  of −25%
  ♥ Happy       −25%   ▓▓▓▓▓▓▓▓▓  at cap
  ♥ Energy       −6%   ▓▓░░░░░░░  of −25%
  ☾ Naps        ×1.35  (Bed, Sun Bunks)
  ▶ Trips       ×0.92  (Beacon)
  ✦ Trip finds   +5%   (Trail Post, Deep Wood set)
  ★ Keep XP      +5%   (Lantern & Ember set)
  ────────────────────────────────────────
  Sets:  Tideline ✓3   Meadow Green ✓5   First Snow 2 of 5
```

Every line names its sources. Every capped line says so. "at cap" is the signal that tells a player to
spend their next grid tiles on a different channel — which is the strategy the caps exist to create.

`buildKeepComfortModel(state)` is pure and unit-tested; it is the same `keepEffects()` derivation
`core/pips/needs.ts` consumes, so the readout cannot drift from the simulation.

### 4.4 Generated effect copy

`describeEffect(effect, content): string` — one function, one test per effect kind, warm and concrete
(spec §15.5), never a bare number:

| Effect | Line |
|---|---|
| `comfort` hunger 0.06 | "Hunger falls 6% slower for every Pip in the Keep." |
| `comfort` all 0.02 | "Every need falls 2% slower, Keep-wide." |
| `restSpeed` 1.25 | "Naps finish 25% sooner." |
| `expeditionSpeed` 0.92 | "Trips come home 8% sooner." |
| `expeditionLoot` 0.03 | "A 3% better chance of an extra find on every trip." |
| `eggChancePoints` 0.01 | "Eggs turn up a shade more often." |
| `incubationSpeed` 0.85 | "Eggs hatch 15% sooner." |
| `job` gathering | "A Pip can work here — Gathering, one find every 10 minutes." |
| `xpBonus` 0.05 | "+5% Keep XP from everything you do." |
| at cap | the line is suffixed " (at the Keep's limit)" and greyed |

`retention.copy.test.ts` extends to cover every generated line.

---

## 5. THE CATALOG — 45 build items

Shipped: 4 placeables + 20 decorations = **24**. Target was 35+. Final: **13 placeables + 32
decorations = 45**.

### 5.1 New placeables (9)

Costs, tiers and effects are the table in §3.4. Reachability-safety per item:

| id | `unlockKeepLevel` | Cost | Resources obtainable at that tier? |
|---|---:|---|---|
| `wash-basin` | 2 | `wood 3, fiber 2` | ✓ Wood+Fiber from tier 1 |
| `play-post` | 2 | `wood 4, fiber 4` | ✓ |
| `larder` | 6 | `wood 8, fiber 5` | ✓ |
| `nest-warmer` | 6 | `wood 5, fiber 4` | ✓ |
| `trail-post` | 7 | `wood 6, shell 2` | ✓ Shell from tier 4 (Shore) |
| `workbench` | 8 | `wood 6, fiber 5` | ✓ — and Wood/Fiber only, per §4.4's job-station rule |
| `sun-bunks` | 8 | `wood 10, fiber 8` | ✓ |
| `beacon` | 10 | `wood 12, shell 5, driftwood 3` | ✓ |
| `weathervane` | 12 | `wood 10, shell 4, driftwood 4` | ✓ |

Every one clears the 3-hour rate check with a ≥ 3× margin at its own tier (§8.3's yield table).

### 5.2 New decorations (12), grouped by set

| id | Name | Cost | Footprint | Set | Own comfort | Flat? |
|---|---|---|---|---|---|---|
| `clover-patch` | Clover Patch | `fiber 3` | 1×1 | Meadow Green | happiness −1 % | ✓ |
| `hay-bale` | Hay Bale | `fiber 5, wood 1` | 1×1 | Meadow Green | happiness −2 % | |
| `rope-ladder` | Rope Ladder | `fiber 7, wood 3` | 1×2 | Bramble & Twine | energy −2 % | |
| `pine-marker` | Pine Marker | `wood 5` | 1×1 | Deep Wood | cleanliness −1 % | |
| `log-pile` | Log Pile | `wood 7, fiber 2` | 2×1 | Deep Wood | hunger −1 % | |
| `fern-cluster` | Fern Cluster | `fiber 6` | 1×1 | Deep Wood | cleanliness −2 % | ✓ |
| `snow-lantern` | Snow Lantern | `wood 4, fiber 4` | 1×1 | First Snow | energy −1 % | |
| `icicle-arch` | Icicle Arch | `wood 5, fiber 8` | 2×1 | First Snow | energy −2 % | |
| `sled` | Sled | `wood 6, fiber 3` | 2×1 | First Snow | happiness −2 % | ✓ |
| `net-float` | Net Float | `shell 4, driftwood 2` | 1×1 | Tideline | cleanliness −1 % | |
| `glow-pool` | Glow Pool | `shell 5, driftwood 4` | 2×2 | Lantern & Ember | happiness −2 % | ✓ |
| `warm-stones` | Warm Stones | `driftwood 3, wood 3` | 1×1 | Lantern & Ember | energy −2 % | ✓ |

All twelve pass `"every decoration is buyable by the time the Keep is fully built"` — the only
reachability rule decorations face (they carry no tier gate, matching the shipped design).

**Flat items** (`isFlatItem()` in `render/placeableSprites.ts`) gain `clover-patch`, `fern-cluster`,
`sled`, `glow-pool`, `warm-stones`. Content bible §9.11 warned that 20 decorations on an 8×12 grid can
wall a Pip in; 32 on a 12×14 grid makes that considerably easier, so the generous-flat-list mitigation
matters more, and the real fix (a walkability check in the placement validator) is now genuinely worth
doing — see §8.6.

### 5.3 The 20 shipped decorations gain effects and sets

No cost, footprint, id or flavour changes — **byte-identical** except two new optional fields
(`effects`, `setId`) and one new required one (`icon`). Assignments are the §3.5 table; each gets a
1–2 % comfort in its set's need. Six of them (`welcome-sign`, `story-stump`, `sun-awning`,
`mossy-fountain`, `wishing-cairn`, `wind-chime`) already read as "the centrepiece" in their content-bible
brief, so they take the 2 % end.

### 5.4 The Keepsake Shelf — a shipped-dead reward, finally paid

**Finding (ruling #5, a fourth dead feature).** `state.keepsakes` is written by
`CLAIM_MILESTONE`'s `keepsake` reward and by `RESOLVE_STREAK_CHOICE`'s day-5 pick, and **read by
nothing**: no UI lists it, `PLACE_ITEM` never spends from it, and `Placement.granted` — which
`tuning.retention.grants.grantedDecorationRefund`'s comment describes as the thing that closes the
resource-printer exploit — was never implemented. So a day-5 streak player *chooses* a keepsake from
three offers and receives, observably, nothing. This round fixes it because building is the round's
subject:

- **`PLACE_ITEM` gains a free path.** When `state.keepsakes[itemId] > 0`, decrement the shelf, charge
  no resources, and set `Placement.granted = true`.
- **`REMOVE_ITEM` honours it.** A granted placement returns `+1` to `keepsakes` and refunds **no**
  resources — which is what `grantedDecorationRefund: 0` was always meant to mean.
- **Where the player SEES it:** a **Keepsake Shelf** section at the top of the Build sheet, above the
  catalog: one card per shelved item with a `×2` count chip, a "Free — a keepsake" cost line, and the
  same icon and effect lines as any other card. Live from tier 1 (a bug fix is not an unlock).
- First-build XP still applies once per `itemId` regardless of how it was paid for.

### 5.5 Build-sheet information architecture

The sheet is now 45 cards and needs structure, or the round makes it worse rather than better:

1. **Keepsakes** (only when the shelf is non-empty) — free, yours already.
2. **Stations** — grouped, `NEW` flagged, locked ones shown greyed with `Opens at Keep level N`
   (never hidden: a named thing to look forward to is the ladder's whole job).
3. **Sets** — six collapsible groups, each headed `Tideline · 3 of 6 placed · bonus active`.
4. **Rearrange** — unchanged, plus icons.

Locked-but-visible is a deliberate reversal of the "hide what you can't do" instinct. `ui/focusView.ts`
already does this for locked expeditions (*"Opens at Keep level 3 — something to grow toward"*) and it
is the correct pattern.

---

## 6. THE MILESTONE COMPLETION MOMENT

### 6.1 What happens today

`ui/dailies.ts` auto-banks every milestone (correctly — round 2C's review removed the Claim tap) and
`detectMilestoneCelebrations` routes each to `notify()`: a 3.6-second, 4-deep, text-only toast in a
stack shared with expedition returns, low needs and Sulking. Seven milestones fire in a new player's
first hour, into the same channel as *"Someone brought something home!"*. That is the owner's
"need better notification".

### 6.2 The Milestone Ribbon

A new, **non-blocking** surface — deliberately not a modal, because 2C's §10.1 rule (*at most ONE
blocking surface on open, ever*) is binding and there are already five stacked surfaces on a return.

**One milestone:**

```
  ╭───────────────────────────────────────────────╮
  │ ✦  First Evolution                    +60 XP →│
  │    Someone grew up, right in front of you.    │
  │    ⟡ a flourish for the Album                 │
  ╰───────────────────────────────────────────────╯
```

- A **ribbon card** — wider and taller than a toast, its own class (`pk-ribbon`), its own container so
  it never queues behind a need-low toast.
- **5-second dwell** (vs a toast's 3.6), tap-to-open → the Nook's Milestones section, scrolled to and
  highlighting that row.
- **The `+60 XP` chip detaches and flies into the Keep XP bar**, which then advances with its tick
  floor. This is the single most load-bearing animation in the round: it is the visible causal link
  between "I did a thing" and "the bar moved", and it is what makes XP feel like a spine rather than a
  number.
- One small `burstConfetti` and a dedicated sound slot (`milestone.ribbon`), distinct from
  `notify.toast`.
- Reward chip renders the actual reward (`formatMilestoneReward`, already exists) — including flair,
  which since the 2C review is a real thing that draws somewhere.

**Two or more at once** — one ribbon, never a chain:

```
  ╭───────────────────────────────────────────────╮
  │ ✦  Three new milestones              +105 XP →│
  │    First Feed · First Nap · First Trip Home   │
  ╰───────────────────────────────────────────────╯
```

Summed XP chip, same flight animation, tap opens the Nook.

### 6.3 Sequencing against the Doorstep and the loot reveals

2C §10.2's order is the constraint and it is preserved exactly. **No sixth stacked modal:**

| Step | Surface | Blocking? | Change this round |
|---|---|---|---|
| 1 | **The Doorstep** (six sections, one "Come in") | yes — the only one | **+1 line, not a section**: inside the existing *"The Keep"* section, `"+340 Keep XP while you were away."` And the *"One nudge"* priority list gains one entry at the end: *"a Keep tier ready to grow"*. Still exactly one nudge, ever. |
| 2 | **The loot reveal queue** | yes, sequential | each reveal card gains its `+N XP` chip. Untouched otherwise — it is the dopamine core. |
| 3 | **Milestone ribbons** | **no** | upgraded from toast to ribbon; batched to one; XP chip flies to the bar. |
| 4 | **Album badge + one gentle toast** | no | `+50 XP` chip on the new-page toast. |
| 5 | **The Keep tier banner** | **no**, and **never fires on open** | NEW — see below. |

**The tier-up banner can never collide with the open sequence, by construction:** a tier only ever
lands on `PURCHASE_KEEP_LEVEL`, which only ever happens on a player tap in the upgrade card, which the
player can only reach after dismissing the Doorstep. So the round's *biggest* celebration is
structurally safe from the stacking problem.

The banner itself: a full-width strip that slides down over the Keep (not a modal — the Keep stays
visible and visibly grows underneath it), reading

```
        ✦  THE KEEP IS LEVEL 5  ✦
     The Lanterngrotto is open. Two more columns of ground.
```

with confetti, a distinct sound, the grid animating outward, and the new trail's card sliding into the
expedition list. It self-dismisses in 4 s or on tap.

### 6.4 The in-session day-boundary and streak cases are untouched

2C §10.3's rules stand: under 3 minutes elapsed there is no Doorstep at all; a mid-session 04:00
crossing is one toast. Neither gains anything this round.

---

## 7. THE LOOP AT EVERY TIMESCALE

This is the point of the round. Each row names **the specific mechanic doing the pulling** — not a mood.

### 7.1 The first five minutes

| Beat | What happens | The pull |
|---|---|---|
| 0:00 | Title → three starter Pips → pick one *(shipped, §10.1)* | — |
| 0:20 | Guided Feed. **The XP bar appears with its first `+4`** and the chip reads `Lv 1 · 4 / 100`. | The bar exists and it moved. This is the change: v1.0's first minute produced no visible accumulation at all. |
| 0:35 | **First Feed** milestone ribbon, `+15 XP` flying into the bar. | The ribbon teaches what the bar is for. |
| 0:50 | Guided Meadow send, `+2 XP`. | — |
| 1:00–4:00 | Free play. Clean, Pet, place a **Moss Tuft** (1 Fiber) → `+25 XP · NEW` and the card says *"Happiness falls 1 % slower."* | **First-build XP.** The player learns in minute two that building is a progression action, not decoration. |
| 4:00 | **The Doorstep does not fire** (under 3 min elapsed, 2C §10.3). Meadow returns: reveal + `+7 XP`. | The reveal, untouched. |
| 5:00 | Bar sits around 65 / 100. `Lv 2` is visibly close and the Keep chip is already naming the Forest. | **The next tier, named.** |

The acceptance bar: at five minutes the player can point at a bar, say what fills it, and name what is
at the end of it.

### 7.2 The first session (≈ 30–45 minutes)

- **Tier 2 lands.** XP crosses 100 at ~12 minutes; the 5 Wood / 6 Fiber takes ~33. The bar sits at
  `Ready` for twenty minutes with the Forest named on the chip — *anticipation, not a wall.*
- The tier banner fires, the grid grows by four rows, the Forest card slides into the expedition list.
- **The Wash Basin and Play Post** unlock — two `NEW` cards, two first-build bonuses, two comfort lines.
- Bar restarts at `Lv 2 · 0 / 180`; tier 3 (**the Snowdrift**) is named immediately.
- Ends around 300–350 XP.

**The pull to session two:** a named tier one care-round away, a Bramblewick trip still running, and
three bounties with two ticked.

### 7.3 The first day

- Tiers 2, 3 and (late) 4 — **the Forest, the Snowdrift, the Shore**.
- The Stockpot and the Simmering job; **set bonuses go live at tier 3**, which retroactively makes every
  decoration already placed worth more.
- First egg → first hatch (`+40`), Pipling → adult overnight.
- The streak's day-1 grant, three bounties, the day-clear egg choice.
- **Cozy Bunks** appears at tier 4 as a thing to save Shell and Driftwood for.

**The pull to day 2:** *"Cozy Bunks — room for five"* is a named, priced, visible goal, and the Shore
that supplies it just opened.

### 7.4 The first week

| Day | Named pull |
|---|---|
| 2 | **The Lanterngrotto** (tier 5) — the trophy biome, and +2 columns of ground |
| 3 | **The Larder and the Nest Warmer** (tier 6) + **5-of-a-set bonuses** — the first time a themed corner pays properly |
| 4 | Set completion: *"First Snow — 4 of 5"* on the Build sheet |
| 5 | **Tier 7's ground** and the Trail Post; the 7-day-streak milestone in sight |
| 6 | Mastery titles arriving on Pip cards (*"Knows where the nests are"*), each `+75–100 XP` |
| 7 | **The Workbench and the Mending job** (tier 8); First Evolution if a Pip has been kept happy |

Also running all week: the Album (2C), climbing 4 → 8 forms; the egg-pity counters, printed.

### 7.5 The first month — and the honest answer about day 14

**Day 14, engaged.** Four independent pulls, all named, all visible on a surface that exists:

1. **The XP bar itself.** Tier 11 lands ~day 14 and its headline is **a sixth bed** — the single most
   wanted thing for a collection player, because the roster cap is what makes them choose. Tier 12 and
   the Weathervane are eight days out and named.
2. **The egg-pity counter** (2C §7, already printed): *"7 of 8 Grotto hatches since a Lanternpip."* A
   guaranteed trophy on a visible counter is the strongest single pull in the game at that point.
3. **Set completion.** *"Deep Wood — 4 of 5 placed"* on the Build sheet, with the 5-bonus stated. Six
   sets × two tiers is twelve discrete, nameable, non-random goals.
4. **The Grove Ledger** (2C's 21 gift variants) — zero RNG, pure care and patience. The healthiest
   long-haul target the game has.

**Day 30, engaged.** Tier 12 landed around day 17, so from ~day 17 the ladder's named unlocks are gone.
What is left: **Renown** (§1.7 — a flair level every four days), the Album's tail (the Lanternpip and
the Ledger), the 30-day streak, `100 trips`/`500 care actions`/`100 bounties`, and mastery tier 6 on
six biomes × six Pips.

**Where I will say plainly that it is thin.** Renown is *sufficient* — the bar never dies, and flair is
what players screenshot — but it is **not a reason to open the app**; it is a reason not to mind that
you did. The honest ranking of what would give day 30 a real pull, in the order I would build it:

1. **Pip identity (the queued round 2D).** The deepest gap is not in the ladder — it is that **no
   individual Pip matters long-term.** After evolution and mastery there is nothing more to learn about
   a Pip, nothing it can become, no relationship that deepens. A game about small creatures whose
   creatures stop developing at 72 hours has a day-30 problem no Keep ladder can fix. This is the
   single highest-value next round and this round's ladder makes room for it (tiers deliberately hand
   out *Keep* things, leaving *Pip* things entirely free for 2D).
2. **A fifth resource** (content bible §8.1.2, retention bible §15.4 — asked for twice now). It is the
   binding constraint on everything: §8.3 shows the four-resource economy is what caps the priced
   ladder's escalation at 3.5×, and it is why nine of the twelve tiers had to be XP-only. A fifth
   late-game resource obtainable only from the Grotto would give tiers 10–12 real costs, give recipes
   somewhere to go, and give decorations a top tier.
3. **Crafting** (§7.6's seam). *Turn 30 Fiber into a Feastpot* is the natural sink for a late-game
   player drowning in materials with a maxed Keep.

### 7.6 Named seams only (spec §12 / CLAUDE.md rule 3)

| Deferred | Seam that exists after this round, and nothing more |
|---|---|
| **Crafting / recipes** | `BuildingEffect` has no `recipe` kind; the Workbench hosts the ordinary `mending` job. A recipe registry would be `content/recipes.ts` + one `CRAFT` action; **not built.** |
| **A fifth resource** | `RESOURCE_IDS` is a const array and `ResourceBundle` is keyed off it; adding one is a one-line core change plus loot tables. **Not made.** |
| **Per-Pip progression** | Untouched on purpose — `PipState` gains nothing this round, leaving round 2D a clean field. |
| **Walkability validation** | `isFlatItem()` is extended with five new flat ids; a reachability check in `placeItem` is **not** added (§8.6). |
| **Renown flair beyond the first tranche** | `content/flair.ts` accepts new ids as data. |

---

## 8. RISKS, GUARD INTERACTIONS, AND THE SAVE SCHEMA

### 8.1 The `KeepLevel` union widening

```ts
// core/keep/index.ts
export type KeepLevel = 1 | 2 | 3;                                    // before
export type KeepLevel = 1|2|3|4|5|6|7|8|9|10|11|12;                    // after
```

Contained by inspection. The union is referenced only as a *type* in five places — `content/keep.ts`
(`KeepLevelDef.level`, `KeepUpgradeDef.prerequisiteLevel`), `content/expeditions.ts`
(`unlockKeepLevel`), and `content/tuning.ts` (`keepLevelCosts`, `keepGrid.growthPerLevel` `satisfies`
clauses). Everything that *computes* with a level already types it as `number`: `KeepState.level`,
`gridBounds(level: number)`, `unlockedExpeditionIdsAt(level: number)`,
`SanctuaryRecord.retiredFromKeepLevel: number`, and every `unlockKeepLevel > state.keep.level`
comparison. So widening cannot produce a type error anywhere except the five sites that *want* it.

`content/keep.ts`'s own comment — *"a sixth Keep level was considered and declined (`core/keep`'s
`KeepLevel` union would need widening, a §3 core change)"* — should be updated in place to record that
2F made the change and why, rather than deleted. The `keepLevels` array grows from 3 to 12 entries; its
`unlocks: readonly string[]` field is what the *"every Keep level's unlock list is worth the price"*
test reads, so every new entry needs a non-empty list (they all have §2's headline).

### 8.2 `core/pips/balance.test.ts` — green byte-identical, by construction

The suite has two halves and this round is invisible to both:

- **The arithmetic half** (`windowDrop`, `sessionRestore`, the shape-of-the-curve block) reads
  `tuning.needDecayPerHour`, `personalityDecayMultipliers`, `offlineRateCapMs`, `care.*` and `foods.*`
  **directly from tuning**. This round edits none of those values. Comfort is a new *factor* applied in
  `effectiveRates`, not an edit to a rate (§3.2), so every one of these assertions computes exactly the
  same numbers.
- **The reducer half** (`comeBackAfter`, `keepWith` → `careSession` → `leaveFor`, the personality sweep,
  the day-2/day-3 loop) builds state from `createNewGame(7, SAVED_AT)`, which produces
  `keep: { level: 1, placements: {} }`. With no placements the comfort factor is exactly `1.0`, the rest
  multiplier exactly `1.0`. **Every number these tests observe is unchanged.**

There is one thing to watch and it is a *test-authoring* trap, not a balance one: `makePip()` and the
`CatchupState` fixtures do not carry a `keep`, so `runCatchup` must keep receiving the comfort factor as
part of its injected tuning/params rather than reaching for a `GameState.keep` that its fixtures do not
have. **Design constraint for the builder:** `effectiveRates` takes the resolved comfort factor as an
*optional parameter defaulting to the identity*, exactly as `NeedsTuning` is already a structural slice.
That keeps ~900 lines of existing `core/pips` fixtures compiling untouched.

New guard: `core/keep/comfort.balance.test.ts` — §3.6's table, the "still Grumpy" claim per personality,
"nothing at or below `sulkExitThreshold`", "care is still mandatory" (leave at 40, come back at 0), and
"the leave-safe margin only ever widens".

### 8.3 `core/economy/reachability.test.ts` — three authorised updates, no weakening

**What does NOT change.** The whole structural layer (`resourcesObtainableAt`, the four
deadlock-regression pins, `"no expedition or job table drops a resource that does not exist"`,
`"a station's own cost is payable at level 1"`, `"every decoration is buyable"`, `"every resource drops
somewhere"`). Level 2's cost, the Meadow and Forest loot tables, `startingInventory`, and the
Gathering-Station on-ramp block are all byte-identical, so *"expects to be affordable in 30–45
minutes"*, *"most seeded 45-minute sessions actually get there"*, *"the casual on-ramp actually
EXISTS"* and *"the Gathering Station alone gets there overnight"* all pass unmodified.

**Update 1 — `pricedPlaceables.payableAt`: `1` → `item.unlockKeepLevel`.** This is a *tightening*: each
station is now checked against the income available when it actually appears. The four shipped
placeables are unaffected (`unlockKeepLevel: 1`, except the Stockpot at 3, whose Wood/Fiber cost is
payable at every tier).

**Update 2 — `pricedKeepLevels` grows from 2 rows to 5** (tiers 2, 3, 5, 7, 9; the other six carry
`cost: {}` and are filtered out by the existing `costedResources(...).length > 0` guard, so they add no
rows at all).

**Update 3 — Cozy Bunks' `prerequisiteLevel`: 3 → 4**, following the Shore that supplies its cost.

**The escalation chain**, computed the way the test computes it (`expectedMinutesToAfford(level − 1,
cost)`, analytic, one Pip per unlocked expedition in parallel):

| Priced tier | Income at `payableAt` | Rates /min | Cost | Binding | **Minutes** |
|---|---|---|---|---|---:|
| 2 | Meadow, Bramblewick | W .150 · F .302 | `wood 5, fiber 6` | wood | **33.3** |
| 3 | + Forest | W .330 · F .362 | `wood 22, fiber 14` | wood | **66.7** |
| 5 | + Snowdrift, Shore | W .360 · F .412 · S .090 · D .060 | `wood 27, fiber 20` | wood | **75.0** |
| 7 | + Lanterngrotto (all six) | W .380 · F .412 · S .131 · D .093 | `wood 30, fiber 22, shell 6` | wood | **79.0** |
| 9 | all six | as above | `wood 34, fiber 26, shell 7, driftwood 4` | wood | **89.6** |

Strictly increasing ✅. *(Note: moving the Snowdrift from tier 2 to tier 3 raises tier 3's measurement
from 61.1 to 66.7 minutes — it strengthens the chain rather than threatening it.)*

**The 3-hour rate ceiling and the 0.95 seeded afford rate.** Expected yield over the test's
`REACHABILITY_BUDGET_MS` (3 h) at full unlock is `wood 68.4 (σ 6.8) · fiber 72.3 (σ 7.0) · shell 23.7
(σ 3.8) · driftwood 16.8 (σ 3.5)`. Tier 9's bundle is the largest and sits at z ≥ 2.4 on every
resource (wood z = 5.1, fiber z = 6.6, shell z = 4.4, driftwood z = 3.6), so the joint afford rate is
> 0.99. Every new placeable is at z ≥ 3 on every resource at its own tier.

**THE FINDING THAT SHAPED THE ROUND, stated plainly for the record.** The four-resource, six-expedition
economy caps the top affordable bundle at roughly `wood 45 / fiber 45 / shell 12 / driftwood 8` if the
3-hour, 0.95-afford guard is to hold. Against level 2's 33.3 minutes that is a **maximum escalation of
~3.5× in wall-clock across the entire ladder.** A twelve-tier ladder priced *only* in resources is
therefore arithmetically impossible without either a fifth resource or a seventh expedition. **That is
why tiers are XP-gated and only five of them are priced** — not a preference, a constraint. See §7.5's
recommendation 2.

**A fourth thing to check, not to change.** `expectedYieldAt` assumes one Pip per unlocked expedition
running in parallel — six Pips at full unlock, against a roster cap of 3 (5 with Bunks, 6 at tier 11).
The model already over-counts income by ~2× at full unlock and did before this round; it makes every
assertion *conservative in the safe direction* (the real player is slower than the model, and the
guard is "can you afford this at all"). Do not "fix" it as part of this round — it would move the
shipped 30–45-minute claim.

### 8.4 The exact save-schema change

**`CURRENT_SCHEMA_VERSION` 7 → 8.** One step `MIGRATIONS[7]`, one new fixture
`src/core/save/fixtures/v8.json`, new validators in `serialize.ts`. **ONE bump for the whole round.**

| Field | Shape | v8 backfill |
|---|---|---|
| `keepXp` | `number` (required, forward-only integer) | **derived, generously** — see below |
| `Placement.granted?` | `boolean` | **Optional**, `undefined ≡ false` — the same pattern `PipState.sulking` and `PipState.mastery` use, so no existing fixture needs an edit. Finally implements the 2C promise (§5.4). |
| `counters` | *no schema change* | new key families `built.<itemId>`, `job.<jobId>`, `masteryTier.<pipId>.<biomeId>` are ordinary keys in an existing validated record. `built.*` is seeded from every currently-placed `itemId`; `job.*` from every entry in `state.jobs`; `masteryTier.*` from each Pip's existing `mastery` trips. |

That is the entire schema delta: **one required scalar and one optional boolean.** Using `counters` for
every idempotence key is what keeps it that small, and it is legitimate — `counters` is already
documented as "forward-only counter bag" and already property-tested monotonic.

**How `keepXp` is backfilled**, following the retention bible's §11.3 rule (*never above the truth,
never below what is provable*):

```
keepXp = max(
  levelXp[keep.level],                                  // you demonstrably reached this tier
  4 × counters.careActions
    + 2 × counters.expeditionsTotal
    + 40 × counters.eggsHatched
    + 90 × counters.evolutions
    + 25 × distinct placed itemIds
    + 15 × counters.bountiesCompleted
    + Σ xp of every milestone already in milestones.earned
)
```

Both terms are provable from state that already exists. A veteran may land several tiers' worth of XP
at once — **that is a gift, the `founder` precedent** — and because tiers still require the player's
tap, they get a *sequence* of celebratory tier-up banners on their first session back, each naming a
real unlock. That is the single best possible first impression of this round for an existing save, and
it costs nothing to build.

**Two things the migration must NOT do:** it must not grant resources (the `preLevel2WoodCap` guard),
and it must not auto-purchase tiers (that would consume the moments and could spend resources the
player was saving).

**RNG: no new persisted cursors.** XP is pure arithmetic; comfort is pure arithmetic over
`keep.placements`; set bonuses are a set-membership count. The 2C test *"retention systems add no rng
cursors"* extends verbatim and should be renamed to cover progression.

### 8.5 Interaction with every 2A / 2B / 2C system

| System | Interaction | Verdict |
|---|---|---|
| **2A** decay retune / 16 h cap | comfort multiplies the rate, never edits it (§3.2); factor is 1.0 unbuilt | safe, §8.2 |
| **2A** Rest at 600/h | `restSpeedMax 1.60` → nap floor 6 m 15 s vs the asserted ≥ 5 min | safe |
| **2A** Pipling 8 h / ×0.9 | untouched; `incubationSpeedMin 0.80` keeps egg + babyhood under the asserted 12 h | safe |
| **2A** time slider / catch-up | job-tick XP accrues through the same capped `firedJobTicks` path — an honest simulated absence pays honest XP | safe |
| **2B** level-1 wood ceiling | no level-1 expedition changes; no XP source grants resources | safe |
| **2B** Forest-beats-Meadow-on-wood (per trip and per minute) | loot tables untouched | safe |
| **2B** Stew is Forest/Shore-only | no tier or XP grant hands out food | safe |
| **2B** deep trips never win on throughput | `expeditionSpeed` is a flat multiplier applied to all biomes equally, so it cannot re-order them; `expeditionLoot` is a per-base-roll chance, which scales *with* existing rolls | safe, same argument as 2C §12.4 |
| **2B** food sizing / leave-safe | comfort only widens the margin (§3.6 claim 4) | safe, strengthened |
| **2C** streak | `CLAIM_STREAK_REWARD` gains XP, idempotent via `rewardedForDay`; a break still costs only the bonus tier — **XP is never touched by a break** | safe |
| **2C** milestones | gain a required `xp` field + 11 new Keep-tier entries; reward *kinds* unchanged, so the four-kind allowlist and the isolation-list ban still hold | safe |
| **2C** bounties | completion and day-clear grant XP, idempotent via `completedAt` / `dayBonusGranted`; level-aware generation now sees up to 12 levels — **`BOUNTY_TEMPLATES.requires.minKeepLevel` values must be re-checked against the new spread** (a Shore bounty gated at `minKeepLevel: 3` would be impossible at tier 3 now) | **ACTION REQUIRED — see risk 4** |
| **2C** mastery | tier-ups grant XP; mastery itself is unchanged. **If the 6th tier is ever appended, `masteryEggChanceBonusPoints` must be re-gated to `tier >= 5` first** or every existing tier-5 Pip silently loses its egg bonus — a §0.1 violation | **TRAP — see risk 5** |
| **2C** egg pity | untouched. Tier 11's "thresholds ease by 1" was **cut** from the ladder to avoid touching it | safe |
| **2C** events | untouched; event loot bonuses enter the same summed channel as building loot bonuses | safe |
| **2C** loot multipliers | building effects **reuse** `bonusRollChanceMax 0.25` and `eggChanceBonusPointsMax 0.05`. Worst-case sum rises from 0.55 to 0.58; the cap still holds it at 0.25 | safe — and see risk 6 |
| **2C** the Long Meadow | first arrival grants 20 XP once (`visits === 0`); retirement never costs XP; residents are outside comfort because they are outside the decay loop | safe |
| **2C** the Album | seen/caught/variant transitions grant XP, idempotent via the timestamps that are already there | safe |
| **2C** the Doorstep | +1 line and +1 nudge-priority entry. **No new section, no sixth modal** (§6.3) | safe |
| **2C** `retention.isolation.test.ts` | extends to `content/buildingEffects.ts`, `content/decorSets.ts`, `core/keep/comfort.ts` | extend it |
| **2C** `retention.copy.test.ts` | extends to the ribbon, the tier banner, generated effect lines, the Comfort readout | extend it |
| **2E** portrait rendering | untouched | safe |

### 8.6 Risks

**Structural**

1. **Two sources of truth for tier costs.** `tuning.keepLevelCosts` (shipped, tiers 2–3) and
   `tuning.progression.levelCosts` (this round, tiers 2–3–5–7–9) both name tiers 2 and 3. Deliberate —
   I am forbidden from mutating shipped values — but it is exactly the two-numbers-in-two-files trap
   round 2B documented. **Mitigation, and it is mandatory:** `content/keep.test.ts` asserts
   `progression.levelCosts[2]` deep-equals `keepLevelCosts[2]` and likewise for 3; the builder makes
   `content/keep.ts` read **only** `progression.levelCosts` and deletes `keepLevelCosts` in the same
   commit. Same treatment for `keepGrid.growthPerLevel` vs `progression.gridGrowth`.
2. **Comfort must not leak into `core/pips` fixtures.** §8.2's parameter-with-identity-default rule. If
   the builder instead reaches for `GameState.keep` inside `effectiveRates`, ~900 lines of `core/pips`
   fixtures stop compiling and the pressure will be to edit `balance.test.ts`. Don't.
3. **`PLACE_ITEM` now has three payment paths** (resources / keepsake shelf / refused) and
   `REMOVE_ITEM` two refund paths (resources / shelf). This is the sharpest new correctness surface in
   the round — the failure mode is a resource printer. Assert: place-from-shelf charges nothing and
   decrements exactly one; remove-a-granted refunds nothing and increments exactly one; a
   place→remove→place cycle is XP- and resource-neutral after the first.

**Balance**

4. **Bounty templates gated by `minKeepLevel` against the OLD spread.** `BOUNTY_TEMPLATES` filters on
   `requires.minKeepLevel` and `requires.expeditionId`, and `buildBountyContext` derives
   `unlockedExpeditionIds` from `unlockKeepLevel`. Because the biome tiers moved, any template whose
   `minKeepLevel` was chosen to match a biome's old tier can now generate at a tier where that biome is
   locked. `bounties.test.ts`'s eligibility matrix must be re-run across **1–12**, not 1–3. This is the
   most likely place for a shipped bug in this round.
5. **The mastery tier-6 trap.** `masteryEggChanceBonusPoints` returns the bonus only at
   `tier >= maxMasteryTier(tuning)`. Appending a 6th tier to `mastery.tierHours` therefore *removes* the
   egg bonus from every existing tier-5 Pip — a straight §0.1 violation. This round does **not** append
   a tier (tier 9's headline is the ground and the Chronicle instead). If a later round wants tier 6, it
   must first replace that comparison with a tuned `eggBonusFromTier: 5`.
6. **The loot cap is now easier to hit** (2C risk 7, made worse). A Curious Pip (+0.10) with Meadow
   mastery (+0.15) is already at the 0.25 cap; a Trail Post and the Deep Wood set add +0.07 that does
   nothing on that Pip. It will read as *"my Trail Post does nothing"*. Honest fixes, in order:
   (a) show the cap in the Comfort readout with "at cap" (§4.3 — do this regardless);
   (b) raise `bonusRollChanceMax` to 0.30 and re-run reachability's level-2 measurement.
   Do **not** make the sources multiplicative.
7. **Job-tick XP is the biggest single idle source.** 96 ticks per capped absence per station × 1 XP;
   three staffed stations is 288 XP for zero taps, against an engaged session's ~300. It is bounded by
   `offlineRateCapMs` and by the roster cap (a Pip on a job is not on a trip), and rewarding absence is
   correct per §0.3 — but it is the number to check first if playtest says active play feels pointless.
   **Lever:** `xp.jobTick` 1 → 0.5 with a floor, or grant per *produced item* rather than per tick.
8. **The XP bonus is a compounding-adjacent loop** (more building → more XP → more tiers → more
   building). It is bounded by `xpBonusMax 0.25` and by §1.6's income model already assuming it at
   day 11+, so the wall-clock table holds. Flagged because it is the only loop in the round.

**Perf and rendering**

9. **The grid grows 64 → 168 tiles and the catalog to 45 items** (§2.2). Spec §1's budget is *"60 fps
   with 5 animated Pips + 30 decorations"*. A full late-game Keep is 60–80 placeables — **2–2.7× the
   measured budget.** This is the round's largest technical risk. **Obligation:** measure 60 placed
   items with 6 Pips at 4× CPU throttle as a round gate and record it in `PROGRESS.md`. **Levers, in
   order:** static-batch non-animated placeables in `keepScene.ts`; drop the tier-9 growth (cap at
   10×14 = 140); a friendly soft cap on placement count (least preferred — it is a wall).
10. **21 new sprites.** Content bible §9.9's "15 identical crates" risk, again, larger. `render/
    placeableSprites.ts` must get real shape variety for 21 new items or a third of the catalog is
    interchangeable blobs and the "reasons to build" ask fails on sight. The §4.2 icon vocabulary
    covers the *Build sheet*; it does **not** cover the diorama.
11. **The XP bar lives in `pk-keepbar`**, which `ui/phase5.ts` hides during placement mode and while
    the Build sheet is open (the stacking-context fix in commit `73eaaa4`). So the bar is invisible
    exactly while the player is building — and building now grants XP. **Either** show a compact bar in
    the placement pill, **or** let the round-2G UI pass move the bar somewhere always-visible. Do not
    re-introduce the occlusion bug.

**Tone and product**

12. **Twelve tiers is a lot of ladder for a wholesome game.** The guards are the copy lint, the
    no-countdown rule, and the fact that a ready tier waits forever. The design guard is that every
    tier is a *place or a thing*, never a number — if a tier's headline ever becomes "+5 % something",
    the ladder has become a treadmill.
13. **Day 30 is thin and I have said so** (§7.5). Renown keeps the bar alive; it is not a reason to
    open the app. The recommendation is round 2D (Pip identity), then a fifth resource.
14. **The Build sheet could become a wall of 45 cards.** §5.5's four-section IA is the mitigation and it
    is not optional. Constraint: the catalog must be scannable in two thumb-scrolls per section.

### 8.7 Test plan — what turns green

| Suite | Claims |
|---|---|
| `core/progression/keepXp.test.ts` (new) | every source in §1.3's table grants exactly its value; every one-time source is idempotent under repeat dispatch; `keepXp` never decreases across a randomised 500-action sequence; place→remove→place is XP-neutral after the first; refused actions grant nothing |
| `core/progression/levelCurve.test.ts` (new) | the four §0.2 bar-movement thresholds, asserted **for every tier**; `levelXp` strictly increasing; `PURCHASE_KEEP_LEVEL` refuses with `needsXp` below the gate and with the shipped refusal above it but short on resources |
| `core/keep/comfort.test.ts` (new) | every channel sums once and clamps once; an unbuilt Keep is exactly the identity on all channels; tucking an item away removes exactly its contribution; set bonuses count **distinct** placed ids; 3-tier is replaced by, not stacked with, 5-tier; every effect strictly helps |
| `core/keep/comfort.balance.test.ts` (new) | §3.6's table; still Grumpy per personality; nothing ≤ `sulkExitThreshold`; care still mandatory; the leave-safe margin only widens |
| `content/buildingEffects.test.ts` (new) | effect signs; no isolation-list key referenced; every placeable/decoration has an icon and a resolvable set; every set has ≥ 5 members; caps in tuning ≥ the largest single effect |
| `ui/itemIcons.test.ts` (new) | every `MotifId` has path data; the badge is derived from the effects, not authored; output is self-contained SVG with no external refs |
| `ui/buildMode.test.ts` (extend) | no card can render the strings "the Pips will use this" or "just lovely" — **a literal regression pin on the two offending lines**; every card has ≥ 1 effect line or an explicit "purely lovely" opt-out; generated lines match the effect numbers |
| `ui/keepUpgrade.test.ts` (extend) | the Comfort readout names every source; "at cap" appears exactly when clamped; the next tier's headline is non-empty for all 11 |
| `ui/milestoneRibbon.test.ts` (new) | one ribbon per batch; summed XP; never more than one visible; fires after the reveal queue drains; the tier banner never fires during the open sequence |
| `core/save/migrate.test.ts` (extend) | v8 fixture; `keepXp` backfill is ≥ `levelXp[keep.level]` and never grants resources; `granted` defaults false; `built.*` seeded from placements; **no new rng cursors** |
| `core/economy/reachability.test.ts` (extend) | §8.3's three updates; the 5-row escalation chain; every new placeable at its own tier |
| `core/progression/bounties.test.ts` (extend) | the eligibility matrix across levels **1–12** (risk 4) |
| `retention.isolation.test.ts` / `retention.copy.test.ts` (extend) | the new modules and the new copy surfaces |

### 8.8 Implementation order (and what turns green when)

1. `KeepLevel` widening + `keepLevels` to 12 entries + `progression` tuning block → types compile, `"unlock list is worth the price"` green.
2. `keepXp` + `MIGRATIONS[7]` + `v8.json` + validators → save suite green.
3. XP grants inside `applyProgressionEffects` (it already runs only when `baseReducer` changed something, so every `.toBe(state)` refusal contract survives) → `keepXp.test.ts` green.
4. `PURCHASE_KEEP_LEVEL`'s `needsXp` gate + expedition re-spread + Cozy Bunks prerequisite → `levelCurve.test.ts` + reachability green.
5. `core/keep/comfort.ts` + the `effectiveRates` parameter → `comfort.test.ts` + `comfort.balance.test.ts` green, `balance.test.ts` still green.
6. Content: `buildingEffects.ts`, `decorSets.ts`, 9 placeables, 12 decorations, `mending`, icons on all 45, milestone `xp` + 11 tier milestones.
7. UI: the XP bar + `+N XP` chips, the item card, the Comfort readout, the Keepsake Shelf, the ribbon, the tier banner.
8. `render/placeableSprites.ts` for 21 new items (risk 10) — the one thing that cannot be deferred without the round failing on sight.

