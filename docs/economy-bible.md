# PipsKeep — The Economy Bible (Round 2J)

> **The brief, and why it is arithmetic rather than taste.** Round 2F did not *ask* for a fifth
> resource, it *proved* one was needed: with four resources and six expeditions, the most expensive
> bundle `core/economy/reachability.test.ts` will pass is around `wood 45 / fiber 45 / shell 12 /
> driftwood 8` — about 3.5× Keep level 2's cost. Against a **twelve-tier ladder** that priced only
> five tiers; the other six carry `cost: {}` and are paced by XP *by necessity, not by design*.
> Rounds 2B, 2C and 2F each asked for the fifth resource. This is it — plus **Crafting**, the feature
> spec §6.2 built the job system as a registry to accommodate, finally cashed.

This document is **design only**. It authors no feature code. The one file it edits is
`src/content/tuning.ts`, which now carries a fully-commented `tuning.crafting` block that nothing
reads yet; **every pre-existing value in that file is byte-identical.**

Read alongside: `PIPSKEEP_SPEC.md` §3 (content as data), §6.2 (jobs as a registry), §6.3 (resources
are the currency), §9 (the Keep), §16 (**all of it** — v1.2's reachability rule, v1.3's dead-feature
rule, v1.5's five promises, v1.6's retired fence, v1.7's naming rule);
`docs/progression-bible.md` §2/§3.2/§8.3 (the ladder, the comfort channel, the reachability
arithmetic this round inherits); `docs/lifecycle-bible.md` §3 (ailments and cures);
`docs/retention-bible.md` §0 (the isolation rule); `docs/working-agreement.md`.

---

## 0. The finding that reframes the brief

### 0.1 What a fifth resource buys — and, precisely, what it does not

The brief says the fifth resource lets "the back half of the ladder cost something real". That is
true, but the mechanism is not the one the phrasing suggests, and getting this wrong would produce a
round that fails its own guard suite. So, stated first, out loud:

**A fifth resource does not raise the affordability ceiling.** The reachability suite measures a
price in *minutes* as `max` over the resources in the bundle — the **binding** resource — never the
sum:

```
expectedMinutesToAfford(level, cost) = max over resources r of  cost[r] / rate(r, level)
```

Adding a fifth term to a `max` cannot make the `max` larger than the largest term already
achievable. The ceiling is set by two things and neither is the resource count:

1. `REACHABILITY_BUDGET_MS = 3 h` and the `affordRate ≥ 0.95` bar over 200 seeded sessions, which
   together cap any single resource in a bundle at roughly `mean(3 h yield) − 2.4σ`.
2. The model's own generosity — `expectedYieldAt` runs **one Pip per unlocked expedition in
   parallel**, six Pips at full unlock against a roster cap of 3 (5 with Cozy Bunks, 6 at tier 11).
   Progression bible §8.3 flags this and says, correctly, *do not "fix" it*.

Measured against the tables this round proposes, the ceiling is `wood ≤ 52 / fiber ≤ 54 /
shell ≤ 13.9 / driftwood ≤ 8.0 / lodestone ≤ 20` at z = 2.33, i.e. a top price of **≈ 137 expected
minutes** — versus level 2's 33.3. That is **4.1×**, up from 3.5×, and essentially all of that gain
comes from the extra `lootRolls` the new resource arrives with, not from the resource itself.

**So what does it actually buy?** Three things, and each is worth the round on its own:

| | What the fifth resource genuinely delivers |
|---|---|
| **1. Breadth** | Eleven prices instead of five. The constraint was never "how expensive" — it was "how many *distinct, strictly increasing* prices can you author before two tiers collide". Five resources give five independent levers with different granularities (1 wood = 2.65 min, 1 lodestone = 5.8 min, 1 driftwood = 10.9 min), and that is what lets eleven tiers separate cleanly. **All twelve tiers are now priced** (tier 1 is the free start), up from five. |
| **2. Gating that cannot be pre-farmed** | Wood and fiber drop at Keep level 1. A hoarder at tier 2 can bank every resource the ladder will ever ask for and buy tiers 5, 7 and 9 the instant XP allows — the resource gate is *decorative* for that player. Lodestone does not exist below tier 3. **The back half of the ladder is now priced in a material the early game literally cannot obtain**, which is what "gates naturally behind progression" means mechanically rather than rhetorically. |
| **3. A currency that stays scarce** | Lodestone income is ~11/day for an engaged tier-8 player against a 135-lodestone ladder — **12.3 days**, longer than any other resource and the only one whose ladder cost outpaces the XP curve. It is the answer to §5's sink problem: you cannot stop a mature player accumulating wood, but you can make exactly one currency continue to mean something. |

### 0.2 The four invariants of this round

Every decision below is downstream of these, and each is written so a test can hold it.

**I1 — ZERO DILUTION.** Adding a fifth resource to a loot table normally *dilutes* every other entry
in it, which would silently move six shipped, pinned rate claims across three files. This round adds
lodestone to three biomes and **changes no existing per-trip or per-minute yield by a single float
ULP** (§1.2). This is the round's ⚠️ fragile invariant.

**I2 — NO RECIPE MAY OUTPUT A BASE RESOURCE.** `reachability.test.ts` models the economy as
"expeditions produce resources"; a recipe that produced wood, or lodestone, would be invisible to
`resourcesObtainableAt` and could quietly break the gating claim in I-thinking-it-was-safe fashion.
Crafting **consumes** resources and produces items, gifts, provisions and keepsakes. Never the
reverse. (This also makes the classic crafting exploit — a cycle of recipes that nets a resource —
unrepresentable rather than merely untested.)

**I3 — NOTHING CRAFTED MAY TOUCH NEED DECAY.** Round 2H's arithmetic is exact and unforgiving: the
binding personality is Curious, whose worst capped-window drop is `3.7 × 1.15 × 16 h = 68.08`, and
"still Grumpy from a 90 save" requires `68.08 × (1 − r) > 50`, i.e. `r < 0.26557`. Building comfort
already spends 0.25 of that. **There are 1.557 percentage points of decay-reduction headroom in the
entire game, and they are spoken for.** So there is no crafted "cosy blanket", no ration that slows
Hunger, no charm that slows a bar. Crafted items act on trips, on ailments, on incubation, on XP and
on the Satchel — never on `needDecayPerHour` or on the comfort channel.

**I4 — THE CURE CEILING DOES NOT MOVE.** `ailments.poulticeCureChance` (0.55),
`devotedCareCureChance` (0.35), `cureEscalationPerAttempt` (0.10) and `cureBonusMax` (0.45) are
untouched. The Poultice becomes *makeable*, not *better*, and there is **exactly one cure item in
PipsKeep** before and after this round.

### 0.3 The inherited guards, restated as things that will fail loudly

| Guard | What it pins | How this round stays green |
|---|---|---|
| `economy/reachability.test.ts` | structural + rate reachability of every priced thing | every new price proved in §1.3/§2.3; the suite gains **two data-driven rows** (recipes, food inputs) — a tightening |
| `pips/balance.test.ts` | one care session out-restores one capped absence, for every need × personality | nothing this round reads or writes a decay rate, a restore or the offline cap (I3) |
| `keep/effects.balance.test.ts` | `comfortReductionMax = 0.25`; at 0.30 a Curious Pip comes home Content | no new `comfort` effect is authored anywhere in this round (I3) |
| `pips/level.balance.test.ts` | seasoning + comfort are ONE clamped channel | untouched; `craftSpeed` is a new, disjoint channel with its own floor |
| `pips/lifecycle.promises.test.ts` | the five promises | §3.8 and §4.1 argue each; the Trail Kit only ever *lowers* a contract chance, never raises one |
| `content/expeditions.test.ts` | Shore `shell/min ≈ 0.09000`, `driftwood/min ≈ 0.06000` (5 dp); Feastpot 1-per-3–4 trips; quick beats deep on items/min | **all byte-identical by construction** — that is what I1 is for |
| `content/keep.test.ts` | tiers 2/3 byte-identical; "only tiers 2,3,5,7,9 cost resources" | tiers 2 and 3 untouched; the *"only five"* assertion is this round's one required test rewrite (§6.4) |
| `progression/levelCurve.test.ts` | the bar-movement floors | crafting only ADDS XP sources — the safe direction, per 2H's own note |

---

## 1. THE FIFTH RESOURCE — **Lodestone**

### 1.1 The name, argued against the other four and against the biomes

The four shipped resources are plain, physical, findable nouns: **fiber, wood, shell, driftwood** —
three simple, one compound, none invented, all things a person could pick up. The fifth has to sit in
that register or it will read as an import from a different game.

**Lodestone** — naturally magnetised magnetite. A real thing you can pick up, one word, no invented
morphology, and it clears §16 v1.7's naming rule outright: it collides with nothing in the game's
vocabulary. (Every obvious alternative did. *Glimmer* **is** the word for a shiny Pip. *Ember* is a
species, a food and a decoration. *Lantern* is a species, a biome and two decorations. *Frost*,
*Tide*, *Glow*, *Moss*, *Snow*, *Cloud* and *Shell* are all taken. *Warm Stones* is already a
decoration. `content/names.test.ts` derives the forbidden vocabulary from the registries themselves;
"lodestone" appears nowhere in them.)

Why it belongs in *these* biomes specifically — the flavor is already written, this round only names
what was being described:

- **Snowdrift** — *"Above the treeline everything is quiet, faintly ridiculous, and slightly frozen."*
  Bare scree, and one patch where the drift has melted through in a ring because the stone underneath
  never went cold.
- **Shore** — *"Salt air, glittering tide pools, and treasures the sea forgot to keep."* The sea
  grinds the cliff down and leaves the heavy ones behind, tumbled smooth, sitting in the pools.
- **Lanterngrotto** — *"A sea cave that glows on purpose. The rocks are warm. Nobody knows why.
  Nobody's complaining."* This is the answer to that. The rocks are warm because of what is in them.

And the reason it matters emotionally rather than only mechanically: **PipsKeep is a game about
coming home.** Homecoming is the loot reveal, the Doorstep, the Beacon at tier 10, the Trail Post at
tier 7, the lineage egg that waits in the biome that took her. A stone that points home is the
material that Keep is made of. Proposed flavor, for the Satchel:

> **Lodestone** — *Heavy for its size, faintly warm, and it will not sit still on a flat surface.
> Everyone agrees it is pointing at something. Nobody agrees at what.*

Player-facing label needs no work: `ui/lootReveal.ts`'s `itemLabel` falls back to `capitalize(id)` →
**"Lodestone"**. (Two independent `capitalize` helpers exist — `lootReveal.ts` and `welcome.ts`. Not
this round's problem, but worth a line in a future tidy.)

### 1.2 Where it drops — and ⚠️ THE ZERO-DILUTION IDENTITY (this round's fragile invariant)

Loot tables are **weighted**, so adding an entry raises the denominator and shrinks every other
entry's share. Naively adding lodestone at weight 20 to the Shore would move `shell/min` from 0.0900
to 0.0750 and break `content/expeditions.test.ts`'s five-decimal pin, the Cozy Bunks affordability
margin, and the tier-5/7/9 escalation figures at once.

There is an exact way out. If a table's rolls are scaled in the same ratio as its weight sum, every
existing entry's per-trip yield is **unchanged to the last bit**:

```
perTrip(item) = rolls × weight(item) / weightSum

so if     newRolls / (oldSum + w)  ==  oldRolls / oldSum
then      newRolls × weight / (oldSum + w)  ==  oldRolls × weight / oldSum   for EVERY item
```

Three biomes, three integer solutions:

| Biome | rolls | weight sum | lodestone weight | new rolls | new sum | identity check |
|---|---:|---:|---:|---:|---:|---|
| **Snowdrift** (deep, unlocks 3) | 12 → **15** | 104 → **130** | **26** | 15 | 130 | `15 × 104 = 12 × 130` ✓ |
| **Shore** (quick, unlocks 4) | 6 → **9** | 100 → **150** | **50** | 9 | 150 | `9 × 100 = 6 × 150` ✓ |
| **Lanterngrotto** (deep, unlocks 5) | 14 → **16** | 98 → **112** | **14** | 16 | 112 | `16 × 98 = 14 × 112` ✓ |

**Verified numerically** (simulation mirroring `reachability.test.ts`'s own model): every one of the
23 existing `(biome, item)` per-minute rates in the three edited tables differs by `< 1e-12` before
and after. The pinned ones, spelled out because they are the ones that would have broken:

- `perMinute("shore", "shell")` = **0.09000** (pin: `toBeCloseTo(0.09, 5)`) ✓
- `perMinute("shore", "driftwood")` = **0.06000** (pin: `toBeCloseTo(0.06, 5)`) ✓
- `perTrip("lanterngrotto", "feastpot")` = **0.285714** → 1 per **3.500** trips (pin: strictly inside
  3–4) ✓
- items/min, quick vs deep, per tier: Meadow 0.600 > Bramblewick 0.225 ✓; Forest 0.400 > Snowdrift
  0.250 ✓; Shore **0.300** > Lanterngrotto **0.178** ✓
- Meadow 0.600 > Forest 0.400 (reachability's own "active play beats idle play") ✓
- The level-1 wood ceiling and fiber ceiling: **Meadow, Bramblewick and Forest are not touched at
  all**, so tiers 2 and 3 measure exactly what they measured before this round (33.3 and 66.7
  minutes), and the shipped *"Keep level 2 in 30–45 minutes"* claim and the Gathering-Station on-ramp
  ratio are untouched by construction rather than by re-verification.

> ⚠️ **THE FRAGILE INVARIANT OF ROUND 2J — the zero-dilution identity.** This is the equivalent of
> round 2B's level-1 wood ceiling, 2C's isolation rule, 2F's `comfortReductionMax` and 2H's
> shared-seasoning-channel. `newRolls × oldSum === oldRolls × (oldSum + lodestoneWeight)` must hold
> for all three biomes. **A one-character edit to any of six numbers silently breaks six pinned
> claims in three files at once**, and it will present as a confusing minute-count regression in the
> escalation test rather than as "someone changed a weight". It gets its own direct assertion in
> `content/expeditions.test.ts` — a test that states the identity in the identity's own terms, with
> the before-values written down as literals — so the failure names itself.

**Yield, per trip and per minute:**

| Biome | lodestone/trip | lodestone/min | first available at |
|---|---:|---:|---|
| Snowdrift (60 min) | 3.00 | 0.0500 | **Keep tier 3** |
| Shore (30 min) | 3.00 | **0.1000** | Keep tier 4 |
| Lanterngrotto (90 min) | 2.00 | 0.0222 | Keep tier 5 |

The Shore is the faucet; the Snowdrift is the **reveal**. That ordering is deliberate and is the best
beat in the whole round: at tier 3 a Pip comes home from above the treeline with three heavy stones
that nothing in the game will let you spend yet. One tier later the Shore opens, the stones pile up,
and tier 5's price explains what they were for. A currency should be *found* before it is *spent*.

Bramblewick, Meadow and Forest get **no lodestone, ever** — that is what keeps it a late resource
and what keeps the level-1 ceilings untouched.

### 1.3 The reachability arithmetic

Income rates per minute, computed exactly as `expectedMinutesToAfford` computes them (one Pip per
unlocked expedition, back to back):

| payable at | wood | fiber | shell | driftwood | **lodestone** |
|---|---:|---:|---:|---:|---:|
| L1 | 0.1500 | 0.2988 | — | — | — |
| L2 | 0.3300 | 0.3588 | — | — | — |
| L3 | 0.3588 | 0.4069 | — | — | **0.0500** |
| L4 | 0.3588 | 0.4069 | 0.0900 | 0.0600 | **0.1500** |
| **L5–L11** | 0.3777 | 0.4069 | 0.1293 | 0.0914 | **0.1720** |

Expected 3-hour yield (the suite's `REACHABILITY_BUDGET_MS`), with Monte-Carlo σ at full unlock:

| payable at | wood | fiber | shell | driftwood | lodestone |
|---|---:|---:|---:|---:|---:|
| L3 | 64.6 | 71.5 | 0 | 0 | **9.0** |
| L4 | 64.6 | 71.5 | 16.2 | 10.8 | **27.0** |
| L5+ | 68.0 | 71.5 | 23.3 | 16.5 | **31.0** |
| **σ at L5+** | 6.81 | 7.20 | 4.08 | 3.66 | **4.69** |
| **max cost at z = 2.33** | 52 | 54 | 13.9 | 8.0 | **20** |

Structural reachability, the layer that caught two shipped deadlocks: **lodestone is obtainable from
Keep tier 3**, so any price payable at tier 3 or later may name it. Every Keep tier N is checked
against income at N−1, so **tier 4 is the earliest tier that could be priced in lodestone** — and
§2.2 deliberately does not, leaving tier 5 as the first. Nothing in the game is priced in lodestone
below tier 5, and `resourcesObtainableAt(4) ∋ lodestone` with two independent sources. There is no
deadlock shape available here: the resource is never gated behind the thing it pays for.

### 1.4 What lodestone is FOR

Three jobs, all of them load-bearing, none of them "a bigger number":

1. **The back half of the Keep ladder** (§2). Tiers 5–12 are all priced in it; for six of those eight
   it is the **binding** resource, i.e. the thing you are actually waiting for.
2. **Every recipe worth making** (§4). Nine of the eleven recipes consume it. It is the reason a
   crafted Poultice is a decision rather than a formality.
3. **The one currency that does not become free** (§5). At 11/day against a 135-lodestone ladder and
   a crafting bench that can eat 16/day on its own, lodestone is the only resource whose demand
   outruns its supply at every tier.

---

## 2. THE RE-PRICED LADDER

### 2.1 What does not move, and why

**Tiers 1, 2 and 3 are byte-identical.** Tier 2 (`wood 5, fiber 6`) and tier 3 (`wood 22, fiber 14`)
carry the shipped *"~33 minutes to Keep level 2"* on-ramp, the Gathering-Station ratio (the station
must be cheaper than the tier it funds, in every resource *and* in minutes), and
`content/keep.test.ts`'s byte-identical pins. Their income (Meadow, Bramblewick, Forest) is likewise
untouched (§1.2). Nothing in this round can move them.

**Tier 4 is priced in wood and fiber only** — no lodestone — even though it legally could be. Two
reasons. Tier 4 is the tier that *unlocks* the Shore, and pricing a tier in the material its own
unlock supplies is the exact shape `reachability.test.ts`'s fourth regression pin exists to catch;
staying a tier clear of it is free defensiveness. And a casual player reaches tier 4 on ~day 3 with
one Snowdrift trip a night — 3 lodestone/day — so a lodestone price at tier 4 would be the one row
in the table that made the casual curve *worse*.

### 2.2 The eleven prices

| Tier | Headline (shipped, unchanged) | wood | fiber | shell | drift | **lode** | binding | **expected min** |
|---:|---|---:|---:|---:|---:|---:|---|---:|
| 2 | The Forest trail | 5 | 6 | — | — | — | wood | **33.3** |
| 3 | The Snowdrift, and set bonuses | 22 | 14 | — | — | — | wood | **66.7** |
| 4 | The Shore, and Cozy Bunks | 25 | 18 | — | — | — | wood | **69.7** |
| 5 | The Lanterngrotto | 27 | 20 | — | — | **12** | **lodestone** | **80.0** |
| 6 | The Larder and the Nest Warmer | 28 | 22 | 5 | — | **15** | **lodestone** | **87.2** |
| 7 | The Trail Post, and more ground | 30 | 24 | 6 | 2 | **16** | **lodestone** | **93.0** |
| 8 | The Workbench and the Mending job | 32 | 26 | 7 | 3 | **17** | **lodestone** | **98.8** |
| 9 | The Chronicle, and the last ground | 34 | 28 | 8 | 4 | **18** | **lodestone** | **104.7** |
| 10 | The Beacon | 38 | 30 | 9 | 5 | **19** | **lodestone** | **110.5** |
| 11 | A sixth bed | 44 | 32 | 10 | 6 | 19 | wood | **116.5** |
| 12 | The Weathervane, and Renown begins | 48 | 34 | 11 | 7 | 19 | wood | **127.1** |

Rows 2, 3 are the shipped values verbatim. Tiers 5, 7 and 9 keep their shipped wood counts (27/30/34)
and gain a fiber/shell/driftwood nudge plus the lodestone rider; the brief permits re-pricing them
and **per-resource monotonicity is worth it** — a player comparing two upgrade cards should never see
a later tier asking for *less* of something. Every column above is non-decreasing.

**Where the story is, in one line per phase:**

- **Tiers 2–4 are timber.** The Keep is being built. Wood binds, and the first three prices are the
  shipped on-ramp.
- **Tiers 5–10 are lodestone.** The moment the Shore opens, the thing you are waiting for changes.
  Six consecutive tiers where the binding resource is a material that did not exist a day ago is the
  most legible progression signal this economy has ever had.
- **Tiers 11–12 are timber again, and a lot of it.** Lodestone tops out at 19 (§2.3), so the last two
  tiers escalate in the oldest resource in the game. A sixth bed needs a bed frame; the Weathervane
  needs a mast. The ladder ends where it started, which is a nice shape to have earned.

### 2.3 The proof: monotonic, affordable, and not one tier over the bar

Simulated exactly as the suite simulates: 3,000 seeded 3-hour sessions per row, resources banked from
the real weighted tables, `canAfford` against the row's own bundle, at the row's own `payableAt`.

| Tier | payableAt | binding | **minutes** | **afford rate @3 h** | per-resource z |
|---:|---:|---|---:|---:|---|
| 2 | 1 | wood | 33.3 | 1.0000 | W 4.9 · F 7.9 |
| 3 | 2 | wood | 66.7 | 1.0000 | W 6.0 · F 7.4 |
| 4 | 3 | wood | 69.7 | 1.0000 | W 6.0 · F 7.4 |
| 5 | 4 | lodestone | 80.0 | 1.0000 | W 5.7 · F 7.2 · **L 3.4** |
| 6 | 5 | lodestone | 87.2 | 1.0000 | W 5.9 · F 6.9 · S 4.5 · **L 3.4** |
| 7 | 6 | lodestone | 93.0 | 1.0000 | W 5.6 · F 6.6 · S 4.3 · D 4.0 · **L 3.2** |
| 8 | 7 | lodestone | 98.8 | 0.9997 | W 5.3 · F 6.3 · S 4.0 · D 3.7 · **L 3.0** |
| 9 | 8 | lodestone | 104.7 | 0.9990 | W 5.0 · F 6.0 · S 3.8 · D 3.4 · **L 2.8** |
| 10 | 9 | lodestone | 110.5 | 0.9970 | W 4.4 · F 5.8 · S 3.5 · D 3.2 · **L 2.5** |
| 11 | 10 | wood | 116.5 | 0.9967 | W 3.6 · F 5.5 · S 3.3 · D 2.9 · L 2.5 |
| 12 | 11 | wood | 127.1 | 0.9960 | **W 3.0** · F 5.2 · S 3.0 · **D 2.6** · **L 2.5** |

**Strictly increasing on every row** (smallest gap: 66.7 → 69.7 at tier 4, 3.0 minutes; largest:
116.5 → 127.1). **Lowest afford rate anywhere: 0.9960**, against the suite's 0.95 bar — every row
clears with ≥ 4.6 percentage points of margin, and the tightest single resource in the whole ladder
is z = 2.5. Nothing here is riding the bar.

**Why lodestone stops at 19.** z = 2.5 at 19; at 20 it is 2.35 and at 21 it is 2.13 — and a marginal
0.98 on one resource, compounded across five, is how a 200-seed test becomes flaky. 19 is the last
integer with real margin, which is why tiers 11 and 12 bind on wood instead. **This is a ceiling, and
it is honest to write it down**: the ladder cannot escalate in lodestone past tier 10 without either
raising the 3-hour budget (a weakening) or adding a seventh expedition (a different round).

### 2.4 Cumulative cost against real income

| | wood | fiber | shell | driftwood | **lodestone** |
|---|---:|---:|---:|---:|---:|
| **Whole ladder, tiers 2–12** | 333 | 254 | 56 | 27 | **135** |
| Engaged tier-8 income/day (progression bible §1.6 activity model) | 49.6 | 54.5 | 9.0 | 6.5 | **11.0** |
| **Days of income for the whole ladder** | 6.7 | 4.7 | 6.2 | 4.2 | **12.3** |

Against the shipped XP curve — tier 12 on **engaged day 17** — every resource lands comfortably
inside, and **lodestone is the one that binds**: 12.3 days of income for a 17-day XP climb means the
resource gate is real but never the thing that stops you. That is exactly the relationship
progression bible §1.6 established at tier 2 (*"tier 2 lands at 12 minutes of XP but its cost takes
~33 minutes, so the resource gate is the binding one there... the first tier must not feel like it
was handed over"*) — extended, for the first time, to the whole ladder.

**The casual player, checked honestly.** One check-in plus one overnight deep trip yields ~3
lodestone/day at tier 3–4 and ~6/day once the Shore opens. Tier 5's 12 lodestone is therefore 2–4
days after tier 4, against the bible's *"tier 4 day 3 → tier 5 day 6"*. It fits, but it is the
tightest row in the table for the casual curve, and it is the row playtest will complain about first.
**The lever, pre-computed:** tier 5's lodestone may drop to **11** (73.3 min) and stay monotonic —
below 11 it collides with tier 4's 69.7 and the escalation test fails. Do not reach for the loot
weights; reach for this number.

---

## 3. THE CRAFTING SYSTEM

### 3.1 The station: **the Craft Table**

Spec §6.2: *"Structure the job system as a registry so Crafting/Decorating slot in later without core
changes."* That promise is now cashed, and the registry held: a new job is content, and the station
is a `PlaceableDef` like any other.

| | |
|---|---|
| **id / name** | `craft-table` — **the Craft Table** |
| **unlockKeepLevel** | **4** |
| **footprint** | 2×2 |
| **cost** | `wood 8, fiber 6` (wood/fiber only — payable at tier 4 with enormous margin) |
| **icon** | `{ motif: "bench" }` |
| **effects** | `[{ kind: "job", jobId: "crafting" }]` |
| **flavor** | *"Twine, jars, a knife that's seen things, and a half-finished something nobody will admit to starting."* |

**Why a new station and not the Workbench.** `core/keep/jobs.ts`'s `jobForStationItem` finds a job by
scanning for `stationItemId`, so two jobs on one item id is ambiguous by construction — the Workbench
already hosts **Mending**. The two are deliberate siblings and the distinction is sharp: *Mending
makes more of what you already have* (a weighted wood/fiber faucet); *Crafting makes a specific thing
you asked for* (deterministic, from a recipe). They sit two tiers apart on the ladder and read as a
workshop growing up.

**Why tier 4.** Tier 4 has the thinnest identity on the ladder (the Shore, and a Cozy Bunks purchase
that most players cannot afford the same hour), it is the tier lodestone arrives in volume, and it is
**one tier before the Lanterngrotto** — so the answer to *"what do I do when a Pip comes home ill"*
exists on the Build sheet before the riskiest trail in the game opens. It also means crafting is a
mid-game system a player meets on engaged day 1 / casual day 3, not an endgame afterthought.

**Multiple Craft Tables are legal**, like multiple Gathering Stations — one Pip each. This is the
whole shape of the late game's decision (§5): every table you staff is a Pip not on a trail.

### 3.2 Crafting IS a job — and a Pip works it

**Decision: yes, and the justification is not deference to the spec.** Three reasons, in order:

1. **The occupied Pip is the rate limiter, and it is the *right* rate limiter.** A vending machine
   converts surplus into outputs at the speed of tapping. A job converts surplus at the speed of
   *the thing you gave up to do it* — a Pip who is at the table is not on the Meadow, not gathering,
   not being Played with. That is a real cost the player feels every session, and it is the cost that
   keeps crafted cures from being free (§4.1).
2. **It inherits four solved problems for nothing:** assignment legality and the Sulking refusal
   (`assignPipToJob` → `assignJob`, one Pip per station, personality-appropriate refusal lines);
   reconciliation when a Pip sulks, is retired or is lost (`reconcileJobs`); the focus view's
   *"${name} is ${verbing} away"* line; and the offline story (§3.5).
3. **It composes with 2H's Pip levels honestly** (§3.7): a seasoned Pip is quicker at the bench, which
   is the only per-Pip channel this round adds and the only one that does not touch decay.

The one structural consequence: `JobDef` gains a discriminator, because a crafting job has no
interval and no weighted table.

```ts
// content/jobs.ts
export interface JobDef {
  // ...existing fields...
  /** Round 2J. "production" (Gathering/Simmering/Mending: a weighted table
   *  on a fixed interval) or "crafting" (a queue of recipes). Absent ≡
   *  "production", so all three shipped jobs are byte-identical. */
  readonly kind?: "production" | "crafting";
}
```

`content/validate.ts`'s job rules (`intervalMs > 0`, `table.length > 0`) branch on `kind`;
`processJobProduction` and `collectJobCatchupEvents` skip `kind === "crafting"` entries;
`reachability.test.ts`'s *"no job table drops a resource that does not exist"* iterates an empty array
and passes unchanged.

### 3.3 The recipe shape (content-defined, spec §3)

```ts
// content/recipes.ts — a NEW registry; core never imports it (spec §2 rule 5)
export interface RecipeDef {
  readonly id: string;
  readonly name: string;
  /** Tier at which this recipe appears in the book. Read by
   *  reachability.test.ts's new `pricedRecipes.payableAt`. */
  readonly unlockKeepLevel: KeepLevel;

  /** Resource inputs. Spent from `state.resources` when the order is ENQUEUED. */
  readonly resources: ResourceBundle;
  /** Satchel inputs (food/consumable ids). Spent at the same moment.
   *  SEPARATE from `resources` on purpose: reachability's structural layer
   *  checks resources against expedition drop tables and foods against the
   *  food registry, and merging them would make one of the two checks lie. */
  readonly items?: Readonly<Record<string, number>>;

  readonly output:
    | { readonly kind: "item"; readonly itemId: string; readonly count: number }
    /** A decoration/placeable copy that lands on the KEEPSAKE SHELF
     *  (round 2F), never in `state.resources`. */
    | { readonly kind: "keepsake"; readonly itemId: string; readonly count: number };

  /** Base craft time, before building and Pip-level speed (§3.4). */
  readonly durationMs: number;

  readonly icon: IconSpec;
  readonly flavor: string;
  /** THE "why would I make this" LINE, shown on the recipe card. Required,
   *  not optional — see §4.6. */
  readonly effectCopy: string;
  /** Seasonal seam (spec §12's surviving convention). */
  readonly availableWindow?: { from: string; to: string };
}
```

Everything a recipe is, is data. Adding one is a `content/recipes.ts` edit and nothing else — the §3
claim, held for a fifth registry.

### 3.4 Time, the queue, and (no) batches

**A craft takes real time.** Base durations are 30 / 45 / 60 / 75 / 90 minutes — bounded by
`tuning.crafting.minDurationMs` and `maxDurationMs` so a future recipe cannot be authored as
instant. 30 minutes is the Simmering cadence (the slowest thing a player already waits for
comfortably); 90 minutes is the Lanterngrotto, the longest wait in the game. Nothing crafts faster
than the game's existing slowest tick, which is what makes crafting *a thing you set up and come back
to* rather than a menu.

**Effective duration:**

```
effective = base
          × clamp(∏ building craftSpeed multipliers, crafting.speedMin, 1)   // 0.90 floor
          × crafting.pipLevelSpeed[pipLevel − 1]                             // 1.00 → 0.90
          , floored at base × crafting.speedFloorWithLevel                   // 0.82
```

Sum-then-clamp for fractions, multiply-then-clamp for rates — the shape `core/keep/effects.ts`
already uses, with the composite floor stated separately exactly as `expeditionSpeedFloorWithQuirk`
is. Best case in the entire game: **0.82 × base**.

**Queue: yes, `crafting.queueMax = 3`.** The queue is what makes the station worth staffing before an
absence, and 3 is sized against `offlineRateCapMs`: three 90-minute crafts is 4.5 hours, comfortably
inside one capped absence, so a player who fills the queue and leaves always comes back to all three
done and never to a half-eaten queue they have to reason about.

**Batches: no.** A "craft ×5 at a discount" is the mechanic that turns a station into a spreadsheet,
and the queue already covers *"set up more than one"*. Every craft costs exactly its inputs.

**Inputs are spent on ENQUEUE, not on completion.** So the player cannot queue three things they
cannot pay for, the Satchel immediately reflects the commitment, and there is no "the craft finished
but you can't afford it" state to design copy for. **Cancelling a queued or in-flight order refunds
its inputs in full** — kind, and provably not an exploit, since spend-then-refund is the identity.
Removing the station cancels and refunds everything on it.

### 3.5 Offline: crafting is a **RATE**, and obeys §4.5

Spec §4.5's rule of thumb is *"rates are capped, timers are not"*. Expeditions and eggs are timers
(never capped); Gathering production is a rate (capped at `offlineRateCapMs`).

**Crafting is a rate.** It is job production; treating it as a timer would make it the one production
system in the game that runs unbounded while the app is closed, and a three-slot queue that
regenerates for a week is exactly the faucet the cap exists to close.

**And the cap can never cost you a craft you started.** `maxDurationMs` (90 min) is 1/10.7 of
`offlineRateCapMs` (16 h), and a full three-deep queue of the longest recipe is 4.5 h — so **the cap
does not bite until the queue has been empty for eleven hours.** The rule is kind in practice and
principled on paper, which is the combination this codebase looks for.

Mechanically it mirrors `core/keep/jobs.ts` exactly, which is the point of making it a job:

- `collectCraftCatchupEvents` emits one custom `"craftDone"` catch-up event per completion falling
  inside `[windowStart, windowStart + offlineRateCapMs]`, through the same `runCatchup` `extraEvents`
  seam Gathering uses.
- Each event's `apply` advances the order and records the completion **iff the Pip is still
  `AssignedJob` at that moment** — a Pip who bottomed out and sulked mid-window stops crafting from
  that boundary, same as Gathering.
- `shiftCraftsPastFreeze(crafts, cappedMs)` slides the surviving order's `startedAt` past the
  rate-frozen tail so the first live `TICK` cannot backfill a week of crafting in one burst.
- Recorded completions settle **after** the pass, in fired order — identical to the live path.

**No new RNG stream, and no new cursor.** Recipes are deterministic: inputs in, a fixed output out.
Round 2C's *"retention systems add no rng cursors"* test extends verbatim to crafting, and the
spec §2 rule 3 save contract is untouched.

**Completions are auto-collected and announced, not player-witnessed.** Hatching and evolution are
witnessed because they are *transformations of a Pip*; a finished poultice is not. It lands in the
Satchel and is reported (§6.3). The game already asks the player to tap eggs and clear reveals;
a third pending-thing queue would be clutter, not ceremony.

### 3.6 Composition with round 2F's building effects — and two channels that shipped dead

`BuildingEffect` gains **one** new kind for this round:

```ts
| { readonly kind: "craftSpeed"; readonly multiplier: number }   // must be < 1
```

folded in `core/keep/effects.ts`'s `foldEffect` as a **product** (it is a rate, like `restSpeed` and
`expeditionSpeed`), clamped once at `crafting.speedMin`. `ui/icons.ts`'s `BADGE_FOR_EFFECT_KIND` is
an exhaustive `Record<BuildingEffect["kind"], BadgeId>`, so it gains `craftSpeed: "gear"` in the same
patch — the coordinated content+UI edit `content/buildingEffects.ts`'s own round-2H note says
*"belongs with whoever next wires `foldEffect`"*. **This round is that patch.**

Which is why this round should also finish what 2H left:

> **⚠️ A DEAD PLACEABLE AND A DEAD PROMISE ARE SITTING IN THE REPO RIGHT NOW.**
>
> `content/buildingEffects.ts` records that round 2H specified two more effect kinds — **`remedy`**
> (ailment contract reduction + cure bonus) and **`longevity`** (lifespan bonus) — and deliberately
> did not add them, because widening the union without the badge map is a compile break and `ui/` was
> out of that round's content scope. The consequences are live today:
>
> - **The Poultice Shelf has no `effects` array at all.** It costs `wood 7, fiber 6`, unlocks at tier
>   5 as a named tier headline, is described as *"everything you'd want on a bad night"* — and does
>   **literally nothing**. `rollContraction`'s `buildingContractReduction` parameter and
>   `attemptCure`'s building bonus are permanently 0. By §16 v1.3's standing rule this is a dead
>   feature that has already shipped: *written to state, invisible in play*. It would be the ninth.
> - **`lifespanMs`'s `buildingLongevity` parameter is likewise permanently 0.** The lifecycle bible
>   says *"three ALREADY-SHIPPED placeables carry it (nest-warmer 0.06, sun-bunks 0.10, larder 0.05 =
>   0.21), so the round adds no build item for this"* — but they do not carry it. `nest-warmer` has
>   only `incubationSpeed`; `sun-bunks` has `restSpeed` + `comfort`; `larder` has `comfort`. The
>   bible's *"a devoted player's Pip lives 15.6 days"* is unreachable; the true maximum is 12.85.
>
> **Recommendation — a small, named scope addition, for the orchestrator to accept or cut.** Add both
> kinds in the same union edit `craftSpeed` requires, attach `remedy` to the Poultice Shelf
> (`contractReduction 0.10, cureBonus 0.05`) and `longevity` to the three placeables the lifecycle
> bible already assumed carried it (0.06 / 0.10 / 0.05), and wire `foldEffect` + the badge map for
> all three kinds at once. Both core parameters already exist with the right shapes and defaults;
> both caps already exist (`ailments.contractReductionMax` 0.60, `lifespan.buildingBonusMax` 0.25).
> This is roughly a 30-line patch that makes a shipped tier headline stop lying and makes a shipped
> bible's arithmetic true.
> **If it is cut, cut it cleanly:** then `craftSpeed` is the only new kind, and the crafted `remedy`
> decorations in §4.4 must be cut with it.

**Anti-spam clamp.** Set bonuses count *distinct* placed item ids, but a plain item's `effects`
contribute **per placement** — ten Lodestone Cairns is ten `remedy` contributions. That is already
true of `comfort` today and is handled the same way: sum once, clamp once. `contractReductionMax`
(0.60) is far too loose to be that clamp on its own, so this round proposes a tighter aggregate for
the *building-sourced* portion: `crafting.buildingRemedyMax = { contractReduction: 0.15, cureBonus:
0.06 }`. **Siting note:** those two numbers belong under `lifecycle.ailments`, and they live in
`tuning.crafting` only because this design pass may not edit an existing block. Move them at build
time.

### 3.7 Composition with round 2H's Pip levels

One new channel, `crafting.pipLevelSpeed`, indexed by level − 1:

```
[1.00, 0.99, 0.98, 0.97, 0.96, 0.95, 0.94, 0.93, 0.92, 0.90]
```

**It does not touch the six shipped channels** (`seasoning`, `expeditionSpeed`, `contractReduction`,
`countdownExtend`, `cureBonus`, `lifespanBonus`) and it is **not** a decay channel, so 2H's fragile
invariant — seasoning and comfort are one clamped channel with 1.557 percentage points of headroom in
the entire game — is untouched (I3). `core/pips/level.balance.test.ts` computes identical numbers.

It is exactly 1.00 at level 1, so every existing fixture and every unbuilt Keep gets the identity,
which is the same defensive-default discipline every effect channel in this codebase uses.

**And it gives a workhorse Pip a second thing to be good at.** Round 2H's own note on `jobTick: 1` is
that *"the workhorse and the adventurer level at the same pace"*; this is the first mechanic where
being a workhorse is also *better at being a workhorse*, which is the kind of legible identity round
2D was chasing.

### 3.8 What crafting may never do

Stated as refusals, in the house style, so they are on the record before anyone is tempted:

| Temptation | Refused because |
|---|---|
| A recipe that outputs wood/fiber/shell/driftwood/lodestone | **I2.** It is invisible to `resourcesObtainableAt` and would break the gating claim silently. |
| A recipe whose output slows need decay | **I3.** 1.557 percentage points of headroom, all spent. |
| A second, stronger cure item | **I4.** The Poultice is the only cure, at 0.55, before and after. |
| A crafted item that raises anything | Round 2F §0.3: *every effect strictly helps*. In particular nothing may **raise** an ailment contract chance, a duration or a cost — 2H is explicit that not even an event may. |
| A recipe that guarantees an egg, a species, or a shiny | The Album's chase is walked by expeditions. v1.3's standing rule: evolution must be earned; the pity ladders and biome pools are the collection engine and crafting is not a second door into them. |
| A recipe that is the **first** door to a biome's signature food or species | Round 2B's deep-trip identity. The Feastpot recipe consumes Grotto foods, so the Grotto is still the only way in (§4.2). |
| Crafting that runs uncapped while the app is closed | §4.5. Rates are capped. |
| A "rush this craft" button, in any currency | It is the seed of the only monetisation surface this game could ever grow, and round 2C already refused the same shape for the bounty reroll. |

---

## 4. THE RECIPE BOOK

**The organising principle, and the answer to *"why would I make this instead of doing something else
with those resources?"* at the level of the whole system:** crafting converts **what you have too
much of** into **what you have too little of**. Every recipe below is a specific instance of that
sentence, and each row's "why" says which surplus it drains and which scarcity it fills.

### 4.1 The cure — and the exact item the cruelty audit named

**The item is the POULTICE** (`content/ailments.ts`'s `POULTICE_ITEM_ID`, `content/foods.ts`'s
`poultice`). Round 2H's cruelty audit found *"the only working cure was undiscoverable"* — the
Satchel rendered the one cure in the game through the generated effect line as **"+0 Hunger"**, i.e.
as the worst food in the game, and 2H patched it with a bespoke `effectCopy` override. That fixed the
*label*. It did not fix the *shape of the problem*, which is this:

> The only cure item in PipsKeep drops at **weight 4** on the **three deep trails** — and those are
> exactly the three trails that inflict the ailments. When a Pip comes home ill, the game's answer to
> *"what can I do"* is **"go run the dangerous trail again and hope"**, with another Pip, at another
> 5–10% contraction chance. The remedy and the risk are the same activity.

**Crafting is the honest fix, and the fix is availability, not power.**

```
POULTICE     6 fiber · 1 lodestone  →  1 Poultice     75 min     tier 4
```

- **Why 6 fiber + 1 lodestone:** the wrap and the something-sharp-smelling underneath. Ground
  lodestone worked into a poultice is real folk medicine, and it is the first thing in the game that
  says out loud what the strange heavy stone is *for*. Fiber is the resource the Keep has most of
  (0.407/min, the highest rate in the game) and the ladder's second-cheapest — so the cure drains the
  surplus, not the scarcity.
- **Why 75 minutes:** see the cure ceiling below.
- **Why tier 4 and not earlier:** ailments can be contracted from tier 1 (Bramblewick, 5%), but at
  tier 1–3 a Pip is inside `noLossBeforeLifeMs` (3 days) or the once-ever `firstLossGrace` for
  essentially the whole window, and `minActivePips` protects the last Pip absolutely. **No player can
  lose a Pip before crafting is available to them.** That is worth asserting rather than assuming
  (§6.4).

**THE CURE CEILING — the second named guard of this round.** Making poultices craftable must not make
ailments a formality. The arithmetic, honestly:

- Survival today, per 2H's own worked numbers: **83.9%** worst realistic case (level 1, no buildings,
  no poultices, free daily roll only, shortest ailment); **96.1%** with three poultices; **> 99%** for
  a level-6 Pip with a Poultice Shelf.
- Survival today for a *determined* player is already ≈ 1: deep trails drop poultices at 27% / 37% /
  44% per trip and cure attempts are uncapped. **The ceiling is already 1.0.** What varies is whether
  the player was *lucky*, not whether they *tried*.
- So the honest target: crafting must move the **floor** (from "hope for a drop" to "you can always
  make one, at a price") without moving the **rate** at which a determined player can attempt cures.

The rate is what gets the guard. A crafted poultice costs one Craft Table for 75 minutes; at the best
equipment in the entire game (`speedFloorWithLevel = 0.82`) that is **61.5 minutes**, i.e. **0.976
poultices per rated hour** — and countdowns are measured in **rated** time (36–48 h), so:

> **`crafting.poulticeMinMinutesPerCraft = 60`** — the best-equipped Keep in the game cannot produce
> more than **one Poultice per rated hour**, which is strictly slower than farming them on the
> Lanterngrotto (0.44/trip ÷ 90 min ≈ 0.29/h *per Pip*, but three trails in parallel exceed 1/h).
> **Crafting is the slower route, and its whole value is that it is the safe one and the certain
> one.** Asserted directly, both against the recipe's `durationMs` and against the composed speed
> floor.

Nothing else about cures moves: chances, escalation, the free daily devoted-care roll, the vigil
floor, the shields, the Loyal Turn. **A player with an empty Satchel and no Craft Table still has the
free route, exactly as promise 1 requires.**

### 4.2 Evolution gifts — and the one variant that is currently a five-hour tail

`SpeciesDef.evolution.giftVariants` keys on **food ids**: the most recent `lastGiftItemId` picks the
evolved variant. Audited against drop rates, exactly one key is a genuine design bug and one is a
back-tracking chore:

| Gift key | Variant it unlocks | Where it drops | Expected cost |
|---|---|---|---|
| **`feastpot`** | Lanternpip → **"festival"** | Lanterngrotto only, 2/112 × 16 rolls | **1 per 3.5 trips = 5.25 hours** |
| **`honeydrop`** | Mosspip → **"sunorchard"** | Bramblewick only (a **tier-1**, 40-minute trail) | cheap, but requires a tier-8 player to go back to tier 1 |
| `glowcap`, `emberloaf` | 4 variants across 3 lines | Lanterngrotto, 2.86 / 2.14 per trip | plentiful once tier 5 is open — **no recipe needed** |
| `cocoabun`, `frostberry`, `tideroll`, `toastnut`, `berry`, `stew` | the rest | plentiful in their biomes | **no recipe needed** |

So: **two gift recipes, not eight.** Authoring a conversion for a food that already drops three times
a trip would be busywork with a card.

```
FEASTPOT   2 emberloaf · 2 glowcap · 1 tideroll · 4 lodestone  →  1 Feastpot   90 min   tier 6
```

- **Why:** the Feastpot is the rarest item in the game and the sole key to the **21st and last page**
  of the Album's variant ledger. A 5.25-hour expected tail on the final collectible is the shape
  round 2C's pity system exists to remove everywhere else; this removes it here without touching a
  drop weight. It is also, straightforwardly, what a feast *is*: you make it out of everything else.
- **Why it does not break round 2B's deep-trip identity:** every food input is Lanterngrotto or Shore
  loot. **You still have to go to the Grotto.** The recipe converts its abundant foods into its rare
  one; it is not a second door.
- **Why not cheaper:** at 4 lodestone plus five biome foods it is never an efficient *meal* (the
  Feastpot is also the best food in the game at 100 Hunger / +30 Happy / +15 Energy), so the food
  economy is untouched — you make one because of what it *unlocks*, not what it feeds.

```
HONEYDROP  4 berry · 2 fiber  →  2 Honeydrop   30 min   tier 4
```

- **Why:** Berries are the single most abundant item in the game (Meadow 40%, Gathering 50%,
  Simmering 40% — an engaged day banks ~65). Honeydrop is a Bramblewick-only treat that also happens
  to be a variant key and the best no-cooldown Happiness item in the game (+32, more than a Pet).
  This is the recipe that stops a tier-8 player scheduling a 40-minute trip to a tier-1 trail to
  finish an Album page.
- **Honest note:** this is the one recipe that mildly softens a biome's exclusivity. Bramblewick's
  real identity is the Toastnut, its species pool and its 25% egg chance; the Honeydrop is a treat,
  not a signature meal. Accepted, and recorded here rather than discovered later.

### 4.3 Provisions — one-trip consumables, spent at send-off

Both feed **existing, already-capped channels**. Neither creates a new cap, and neither can raise
anything.

```
WAYBREAD   2 fiber · 2 toastnut · 1 berry  →  2 Waybread   30 min   tier 4
TRAIL KIT  3 fiber · 2 lodestone · 1 toastnut  →  1 Trail Kit   45 min   tier 5
TOASTNUT   4 berry · 1 wood  →  2 Toastnut   30 min   tier 4
```

- **Waybread** — consumed when a Pip is sent out: `+0.08` bonus-roll chance for that trip, summed
  into round 2C's **one** loot channel (`retention.loot.bonusRollChanceMax = 0.25`) alongside
  Curious, mastery, streak, events and the Trail Post. *Why make it:* it is the only way to make a
  **short** trip richer. Every other loot bonus in the game is a permanent trait you were born with,
  a ladder measured in hours, or a building. This is the one that answers *"I have twenty minutes
  right now"*.
- **Trail Kit** — consumed at send-off on a risky trail only: contract chance × (1 − 0.35), fed
  through `rollContraction`'s **already-existing** `buildingContractReduction` parameter and the
  **already-existing** `contractReductionMax` (0.60) clamp. *Why make it:* round 2H's Careful Route
  is a total opt-out that costs **1.5× duration and 25% of the loot**. The Trail Kit is the other
  trade — *most* of the safety, paid for in materials instead of minutes. It is the "I have stuff but
  not time" answer, and after this round every player has two different ways to decline danger.
  - **It must feed the reduction, never skip the roll.** The Careful Route skips `rollContraction`
    entirely (fewer RNG draws); a Trail Kit that did the same would silently change the `ailment`
    cursor's advance for the same sequence of player actions. It reduces the chance and the roll
    still happens.
- **Toastnut** — the deliberate middle of the web: berries → toastnut → Waybread / Trail Kit. It also
  happens to be Pebblepip's `"mosscap"` variant key. *Why make it:* it is the recipe that turns the
  game's most-common drop into the input the other two recipes want, so the berry glut has somewhere
  to go every single session.

### 4.4 Things for the Keep — craft-only, and they land on the Keepsake Shelf

Crafted decorations output `{ kind: "keepsake" }`: the item goes to **round 2F's Keepsake Shelf**, is
placed with `Placement.granted = true`, and `REMOVE_ITEM` returns it to the shelf while refunding
**no resources**. That reuses shipped machinery to close the refund-printer exploit for free — a
crafted decoration can never be laundered back into resources.

**Why craft one instead of buying one?** Because these five cannot be bought. They have no Build
sheet price; the recipe is the only door. (Every one of the 32 shipped decorations remains directly
purchasable, untouched.)

| Item | Recipe | Time | Tier | Effect | Why |
|---|---|---:|---:|---|---|
| **Lodestone Cairn** (1×1) | 4 lodestone · 2 shell | 45 m | 4 | `remedy contractReduction 0.04` | The first permanent thing you can *build* against risk, one tier before the riskiest trail opens. Three stones, balanced, pointing. |
| **Herb Rail** (1×1) | 8 fiber · 2 lodestone · 1 glowcap | 60 m | 5 | `remedy cureBonus 0.03` | Sits with the Poultice Shelf on tier 5. The pair is the Keep's answer to "what if" — one lowers the odds of it happening, one raises the odds of fixing it. |
| **Chime Rail** (2×1) | 3 lodestone · 4 driftwood · 3 fiber | 60 m | 6 | `craftSpeed 0.94` | The only crafting-improves-crafting item, and it is deliberately small and capped. Lodestone rings. |
| **Compass Rose** (2×2) | 8 lodestone · 4 shell · 4 driftwood | 90 m | 8 | `expeditionSpeed 0.96` | Feeds the shipped `expeditionSpeedMin` 0.85 floor. The Beacon at tier 10 is the big one; this is the one you make yourself, two tiers early. |
| **Wayhome Lantern** (2×2) | 12 lodestone · 6 shell · 6 driftwood · 8 wood | 90 m | 10 | `xpBonus 0.03` | The late-game showpiece and the single largest lodestone sink in the game. Repeatable, capped at the shipped `xpBonusMax` 0.25 like everything else. |

*(If §3.6's `remedy`/`longevity` recommendation is cut, the Lodestone Cairn and Herb Rail are cut
with it, and the book ships nine recipes instead of eleven.)*

### 4.5 The complete book

| # | Recipe | Resources | Satchel inputs | Output | Time | Tier | Binding input |
|---:|---|---|---|---|---:|---:|---|
| 1 | **Poultice** | fiber 6, lodestone 1 | — | 1 × Poultice | 75 m | 4 | station time |
| 2 | **Waybread** | fiber 2 | toastnut 2, berry 1 | 2 × Waybread | 30 m | 4 | toastnut |
| 3 | **Toastnut** | wood 1 | berry 4 | 2 × Toastnut | 30 m | 4 | berries |
| 4 | **Honeydrop** | fiber 2 | berry 4 | 2 × Honeydrop | 30 m | 4 | berries |
| 5 | **Lodestone Cairn** | lodestone 4, shell 2 | — | keepsake ×1 | 45 m | 4 | lodestone |
| 6 | **Trail Kit** | fiber 3, lodestone 2 | toastnut 1 | 1 × Trail Kit | 45 m | 5 | lodestone |
| 7 | **Herb Rail** | fiber 8, lodestone 2 | glowcap 1 | keepsake ×1 | 60 m | 5 | glowcap |
| 8 | **Feastpot** | lodestone 4 | emberloaf 2, glowcap 2, tideroll 1 | 1 × Feastpot | 90 m | 6 | emberloaf |
| 9 | **Chime Rail** | lodestone 3, driftwood 4, fiber 3 | — | keepsake ×1 | 60 m | 6 | driftwood |
| 10 | **Compass Rose** | lodestone 8, shell 4, driftwood 4 | — | keepsake ×1 | 90 m | 8 | lodestone |
| 11 | **Wayhome Lantern** | lodestone 12, shell 6, driftwood 6, wood 8 | — | keepsake ×1 | 90 m | 10 | lodestone |

**Reachability, both layers, for all eleven.** Structural: every resource named is in
`resourcesObtainableAt(unlockKeepLevel)` — lodestone from tier 3 (recipes start at 4), shell and
driftwood from tier 4 (the Shore unlocks *at* 4, and recipes are payable at the tier they appear on,
not the one before). Every Satchel input drops from a biome unlocked at or before its recipe's tier —
berry/toastnut from tier 1, glowcap/emberloaf from tier 5, tideroll from tier 4. Rate: the largest
bundle in the book (#11, `lodestone 12`) sits at z = 4.0 against the 3-hour lodestone yield, four
times inside the bar. **These are checked by the suite, not by me** — see §6.4's two new
data-driven rows.

### 4.6 Every recipe answers the question, on its own card

`RecipeDef.effectCopy` is **required**, not optional, for the same reason
progression bible §4.1 made item copy required: *"just lovely"* and *"the Pips will use this"* are
what a card says when nobody made it say anything. Shipping copy:

| Recipe | Card line |
|---|---|
| Poultice | *"Give it to an ailing Pip — a real chance to cure them."* (reuses the shipped `foods.poultice.effectCopy` verbatim) |
| Waybread | *"Packed for the road. The next trip out finds a little more."* |
| Toastnut | *"Berries, roasted hard. Keeps in a pocket; keeps a Pip going."* |
| Honeydrop | *"A small, sticky act of love. Some Pips evolve around one."* |
| Trail Kit | *"Wrapped tight and tucked in a pack. The trail is a good deal less trouble with one of these."* |
| Feastpot | *"Everything the cave had, in one pot. Somebody is going to remember this meal forever."* |
| Lodestone Cairn | *"Three stones, balanced, pointing. Trips out go a little more carefully near it."* |
| Herb Rail | *"Everything drying in one place, where you can reach it at three in the morning."* |
| Chime Rail | *"Lodestone rings differently. Work goes quicker when something is keeping time."* |
| Compass Rose | *"Laid into the ground at the gate. Nobody gets lost on the way back."* |
| Wayhome Lantern | *"The biggest light the Keep has. It is not for finding your way out."* |

---

## 5. THE SINK PROBLEM

**The question, sharpened.** Before this round, resources bought Keep tiers and build items. Both are
**finite and non-repeating**: the ladder is 11 purchases, the catalogue is 45 items. A player who
reaches tier 12 on engaged day 17 has, from day 18 onward, **an income and nothing to spend it on**.

### 5.1 The flow arithmetic

Per-day resource income, computed on the progression bible's own §1.6 activity model:

| Player | wood | fiber | shell | driftwood | **lodestone** |
|---|---:|---:|---:|---:|---:|
| Engaged, tier 4 (12 Meadow, 2 Forest, 1 Snowdrift, 1 station) | 35.3 | 46.1 | 0 | 0 | **3.0** |
| Engaged, tier 8+ (all six trails, 3 stations) | 49.6 | 54.5 | 9.0 | 6.5 | **11.0** |
| Casual (1 check-in + one overnight deep trip, 1 station) | 22.4 | 37.3 | 0 | 0 | **3.0** |

Against demand:

| Sink | wood | fiber | shell | driftwood | **lodestone** | shape |
|---|---:|---:|---:|---:|---:|---|
| The whole Keep ladder | 333 | 254 | 56 | 27 | **135** | one-time, 11 purchases |
| The whole build catalogue, one of each (summed from the registries, + the Craft Table) | 175 | 135 | 44 | 35 | 0 | one-time |
| The 5 crafted keepsakes, one of each | 8 | 11 | 12 | 14 | **29** | one-time, but **repeatable** |
| **One Craft Table kept busy on Poultices (75 m)** | 0 | **96/day** | 0 | 0 | **16/day** | **recurring, unbounded** |
| One Craft Table kept busy on Waybread (30 m) | 0 | **80/day** | 0 | 0 | 0 | recurring |
| Provisions at a realistic 4 risky trips + 4 quick trips a day | 0 | ~14/day | 0 | 0 | **~8/day** | recurring |

### 5.2 What this actually says — three findings, one of them uncomfortable

**Finding 1 — crafting's sink capacity genuinely exceeds income, for the two resources that matter.**
A single Craft Table run continuously on Poultices consumes **96 fiber and 16 lodestone per day**
against an engaged tier-8 income of **54.5 and 11.0**. A second table doubles it. The sink is not
merely present, it is *larger than the faucet* — which is the property a sink needs, and it is
achieved without a single number that scales with the player's wealth (no exponential prices, no
"prestige" reset, no soft currency).

**Finding 2 — the constraint changes character, and that is the design.** Late-game PipsKeep is not
resource-limited, it is **throughput-limited**. One station is one craft at a time, and one craft is
one Pip who is not on a trail. The real currency at tier 12 is **Pip-hours**, and Pip-hours are
bought with the two things the ladder still hands out: roster slots (tier 4's Cozy Bunks, tier 11's
sixth bed) and stations. That is a much healthier late game than "the numbers got bigger", and it is
the first time the roster cap has been a *strategic* number rather than a storage one.

**Finding 3, and it is the uncomfortable one — wood and fiber will still pile up, and no sink fixes
that.** Say it plainly rather than pretending: an engaged tier-12 player banks ~50 wood/day forever,
and the only wood sinks are one-time. **The honest answer is not to invent a wood sink** — a
make-work conversion recipe or an escalating price is exactly how a cosy game turns into a grind, and
round 2C's §0.3 already bans the shape. The answer is that **one currency is kept scarce on purpose**:

- lodestone income **11/day**, ladder demand **135**, crafting demand **8–16/day** if the bench is
  used at all → **lodestone never becomes free**, at any tier, for any player.
- Everything else becomes free, and that is *fine*, because "I have plenty of wood" is not a problem
  a cosy game needs to solve. It is only a problem if wood was the thing you were waiting for. After
  this round it never is, from tier 5 onward.

**The failure mode to watch, named for playtest:** if the Craft Table ends up mostly idle, none of
the above happens and lodestone becomes free too. The mitigation is not a number, it is §6.3's
visibility work — a bench nobody opens is the ninth dead feature, and this round's whole standing
rule is that shipping it is not the same as showing it.

---

## 6. INTERACTIONS, RISKS, SCHEMA, AND PROOF OF VISIBILITY

### 6.1 Interaction with every 2A–2I system

| Round | System | Interaction | Verdict |
|---|---|---|---|
| 2A | decay retune, 16 h cap | nothing here reads or writes a rate, a restore or the cap (I3) | **safe** |
| 2A | Rest at 600/h, `restSpeedMax` | untouched; `craftSpeed` is a disjoint channel | **safe** |
| 2A | level-1 wood/fiber ceilings | Meadow, Bramblewick and Forest tables **untouched** (§1.2) | **safe by construction** |
| 2A | debug time slider | routes through catch-up, so it exercises the capped craft path honestly — the correct behaviour, and a QA tool for it | **safe** |
| 2B | Forest-beats-Meadow on wood, per trip and per minute | those two tables untouched | **safe** |
| 2B | Shore `shell/min` 0.09000, `driftwood/min` 0.06000 | **byte-identical** via the zero-dilution identity | **safe, and this is what I1 is for** |
| 2B | Feastpot 1-per-3.5-trips | `perTrip` = 0.285714 unchanged; the recipe is a *second* route, not a re-weighting | **safe** |
| 2B | deep trips never win on throughput | items/min: Shore 0.300 > Grotto 0.178; Forest 0.400 > Snowdrift 0.250 | **safe** |
| 2B | *"Stew is Forest/Shore-only"* | no recipe outputs Stew | **safe** |
| 2B | biome food/species exclusivity | one softening, named and argued (Honeydrop, §4.2) | **accepted, recorded** |
| 2C | isolation rule | crafting pays in items, keepsakes and provisions — never in decay, restores or the cap | **safe** |
| 2C | one summed loot channel (0.25) | Waybread is `+0.08` **into that channel**, not a new one | **safe** |
| 2C | egg-chance channel, pity ladders | nothing crafted touches eggs at all (§3.8) | **safe** |
| 2C | `grantedDecorationRefund = 0` | crafted keepsakes use the shipped `granted` path — refund nothing | **safe, and it closes the printer for free** |
| 2C | `preLevel2WoodCap` | crafting unlocks at tier 4; no recipe outputs a resource (I2) | **safe** |
| 2C | bounties are level-aware | `BOUNTY_TEMPLATES.requires.minKeepLevel` — a crafting bounty would be a **great** addition and is deliberately **not** in this round; if one is added later it must gate at ≥ 4 | **named seam** |
| 2D | names may not collide with vocabulary | "Lodestone", "Craft Table", "Waybread", "Trail Kit", "Wayhome Lantern" all checked against `names.test.ts`'s derived forbidden set — **and the new ids extend that set**, so the name pool must be re-validated in the same commit | **ACTION REQUIRED — §6.4** |
| 2F | `comfortReductionMax = 0.25` | no new `comfort` effect is authored anywhere in this round | **safe** |
| 2F | XP curve floors | crafting only **adds** XP sources | **safe direction** |
| 2F | Keepsake Shelf | reused wholesale as the crafted-decoration home | **strengthened** |
| 2F | `BADGE_FOR_EFFECT_KIND` exhaustive map | widening `BuildingEffect` is a compile break without a matching case — handled in the same patch | **planned** |
| 2F | *"only tiers 2,3,5,7,9 cost resources"* | **this assertion must be rewritten.** It is the round's one required test change | **ACTION REQUIRED — §6.4** |
| 2G | the Keep strip / cast strip HUD | a fifth resource and a craft-in-progress both want a surface; §6.3 assigns them without growing the chrome | **design constraint, §6.3** |
| 2H | five promises | §3.8 and §4.1; nothing crafted may raise a contract chance, shorten a countdown or punish absence | **safe** |
| 2H | `minDurationMs (36 h) > offlineRateCapMs (16 h)` | untouched | **safe** |
| 2H | cure odds, escalation, `cureBonusMax` | untouched (I4); availability changes, power does not | **safe** |
| 2H | Careful Route | the Trail Kit is a *second*, weaker, material-priced opt-out; both remain, and the Careful Route remains the only total one | **complementary** |
| 2H | seasoning shares the comfort channel | `craftSpeed` and `pipLevelSpeed` are disjoint from decay entirely | **safe** |
| 2H | lineage eggs, breeding | untouched — no recipe produces an egg, a Pip or a level | **safe** |
| 2H | `buildingContractReduction` / `buildingLongevity` seams | this round is the patch that finally wires them (§3.6) | **fixes a dead placeable** |
| 2I | notifications | a finished craft is a **candidate** for a homecoming *suffix*, never its own buzz — the same rule 2H's ailment news follows. `maxPerDay = 4` and `minGapMs` are untouched. **A craft-finished notification is out of scope for this round** | **named seam** |

### 6.2 The save-schema change — ONE bump, v10 → v11

| Field | Shape | v11 backfill |
|---|---|---|
| `state.resources.lodestone` | already legal — `ResourceCounts` is `Record<string, number>` and every read is `?? 0` | **nothing.** No shape change; absent ≡ 0 |
| `state.crafts` | `Readonly<Record<PlacementId, CraftOrder>>` | `{}` |
| `counters["crafted.<recipeId>"]` | ordinary keys in the existing validated, property-tested-monotonic counter bag | absent ≡ 0 |
| RNG cursors | **none added** — recipes are deterministic | n/a |

```ts
interface CraftOrder {
  readonly pipId: PipId;
  readonly recipeId: string;
  /** Clock ms. The completion is DERIVED (`startedAt + effectiveMs`), never
   *  a stored countdown — the same rule expeditions and job ticks follow. */
  readonly startedAt: number;
  /** Snapshotted at enqueue so a Pip levelling up mid-craft cannot retro-
   *  actively change a craft already in flight (and so the timer survives a
   *  building being tucked away). */
  readonly effectiveMs: number;
  /** Recipe ids waiting behind, max `crafting.queueMax`. */
  readonly queue: readonly string[];
}
```

**That is the entire delta: one new record and one new counter family.** Plus `fixtures/v11.json` and
the `MIGRATIONS[10]` step, per spec §8's day-one rule.

**Two things the migration must NOT do**, and both are the brief's own words:

1. **It must not grant lodestone.** A veteran with 400 Shore trips behind them starts at 0. Granting
   it retroactively would be a resource the economy never produced and would break
   `reachability.test.ts`'s premise that the tables are the only faucet. *"Existing saves must not
   gain impossible resources."*
2. **It must not lose anything.** `resources`, `inventory` and `keepsakes` pass through untouched. A
   fixture-backed deep-equal on all three is the test.

**The one real consequence for existing saves, named honestly.** A save sitting at tier 4 with tier
5's old price banked (`wood 27, fiber 20`) now also needs 12 lodestone it does not have. This is a
**re-price, not a deadlock**: lodestone drops on the Snowdrift, which that save unlocked at tier 3,
and on the Shore, which it unlocked at tier 4. `resourcesObtainableAt(4) ∋ lodestone` is exactly what
the structural layer proves. The mitigation is presentational and already built: `spend()` returns a
typed `missing` bundle, so the upgrade card names the shortfall — *"12 more Lodestone"* — and the
player knows, in one sentence, where to go. **The Keep upgrade card must render the new resource in
its shortfall list**, or this is a mystery instead of a goal (§6.3).

### 6.3 THE VISIBILITY TABLE

> §16 v1.3's standing rule, earned **eight** times: *"written to state" and "visible to the player"
> are separate acceptance criteria* — and v1.7 sharpened it: *"visible on one surface" is not
> "visible"*. Every row names **all** the surfaces.

| Mechanic | Where core applies it | Where the player SEES it (all surfaces) |
|---|---|---|
| **Lodestone exists** | `RESOURCE_IDS`; `ACKNOWLEDGE_REVEAL` routes it to `state.resources` (not a food) | **loot reveal** (its own `ITEM_REVEAL_TIERS: "uncommon"` entry, so it flips with ceremony the first time); **Items sheet / Satchel** resource row; **Doorstep** *"The Keep kept working…"* line via `welcome.ts`'s `RESOURCE_IDS` walk (**already automatic — verify, do not rebuild**); **debug menu** grant row (automatic); **Build sheet** and **Keep upgrade** cost lines |
| **Lodestone is a late resource** | `unlockKeepLevel` on the three biomes | the **send-off card's** loot preview for Snowdrift/Shore/Grotto; the tier-4 and tier-5 **upgrade card road-ahead** |
| **The re-priced ladder** | `progression.levelCosts` | **Keep upgrade card** (cost + typed shortfall, per resource); the **XP bar's** *"Next: …"* headline is unchanged; the tier-up **banner** |
| **The Craft Table** | `placeables.ts` entry + `job` effect | **Build sheet card** with icon, cost, flavor and generated effect copy (*"A Pip can work here — Crafting"*); the **Keep scene** sprite (⚠️ it must not be the placeholder crate — round 2F shipped 21 items as brown crates and it made the whole ladder invisible); **tier 4's `unlocks` list** in `content/keep.ts` |
| **A Pip is crafting** | `state.jobs[pipId]`, `activity = AssignedJob` | **focus view** *"Ribbon is crafting away"* (from `JobDef.verbing` — automatic); the **cast strip** chip's activity mark; the **Keep scene** (the Pip stands at the table) |
| **A craft is in progress** | `CraftOrder.startedAt + effectiveMs` | a **progress ring on the station** in the Keep scene; the **recipe book's** header row (*"Poultice · ready in 41 minutes"*); the **focus view** of the working Pip |
| **A craft finished** | catch-up `craftDone` / live settle → `inventory` or `keepsakes` | a **toast** while live; the **Doorstep** *"The Craft Table finished: 2 Poultices"* line after an absence; the item **in the Satchel**; the **Keep XP chip** for the grant |
| **The recipe book** | `content/recipes.ts` filtered by `keep.level` | a **recipe sheet** opened from the Craft Table (and from the nav menu); locked recipes shown greyed **with their tier**, because a recipe you can see and cannot yet make is the carrot |
| **The Poultice is craftable** | recipe #1 | ⚠️ **the load-bearing one: the ailment card gets a "Make one" affordance** that opens the recipe book on the Poultice. This is the difference between fixing the cure and *fixing the discoverability of the cure*, which is the whole reason this recipe exists |
| **Provisions** | consumed at `ASSIGN_EXPEDITION` | the **send-off card** (a checkbox row beside the Careful Route toggle: *"Pack a Waybread"* / *"Pack a Trail Kit"*, each showing the count you hold); the **loot reveal** attributes the extra find; the **Satchel** |
| **A crafted keepsake** | `state.keepsakes` + `Placement.granted` | the **Keepsake Shelf** in the Build sheet; the **Keep scene** once placed; its **item card's** effect line |
| **`craftSpeed` / `remedy` / `longevity`** | `resolveKeepEffects` | the **Keep Comfort readout** (round 2F §4.3's surface — it is already the "what is my Keep doing for me" panel and must gain the three new rows, or these are dead the day they ship); each item's **card badge** via `BADGE_FOR_EFFECT_KIND` |
| **Crafting XP** | `crafting.keepXpPerCraft`, `firstCraftKeepXp`, `pipXpPerCraft` | the **`+N XP` chip** flying into the XP bar; the **Pip level bar**; the **Doorstep** XP-earned-while-away line |

### 6.4 Test plan — what turns green, and the three tests that must be rewritten

**New, and data-driven off the registries so future content is covered automatically:**

1. `reachability.test.ts` gains **`pricedRecipes`** — every `RecipeDef`, `payableAt =
   unlockKeepLevel`, joining `allPricedThings` so both the structural and the rate layer police
   crafting with no new hand-written list. **A tightening.**
2. `reachability.test.ts` gains **"every Satchel input a recipe consumes drops from an expedition
   unlocked at that recipe's tier"** — the food-side twin of the structural check, and the thing that
   would catch someone pricing a tier-4 recipe in Glowcap.
3. `expeditions.test.ts` gains **the zero-dilution identity**, asserted in its own terms
   (`newRolls × oldSum === oldRolls × (oldSum + w)` for all three biomes) *plus* the six
   before-values as literals, so a broken weight names itself instead of surfacing as a minute-count
   regression three files away.
4. `crafting.balance.test.ts` (new): **the cure ceiling** — the best-equipped Keep cannot produce
   more than one Poultice per rated hour; and **no recipe outputs a base resource** (I2), asserted
   over the whole registry.
5. `crafting.test.ts` (new, core): enqueue spends exactly once; cancel refunds exactly; the queue
   caps at `queueMax`; completion is derived from timestamps and survives reload; **catch-up
   completes crafts only inside `offlineRateCapMs`**; `shiftCraftsPastFreeze` prevents backfill; a
   Pip who sulks mid-window stops crafting at that boundary; **no new RNG cursor appears**.
6. A promise test: **no player can lose a Pip before crafting is available to them** — a level-1 save
   is inside `noLossBeforeLifeMs` or `firstLossGrace` for the whole pre-tier-4 window.

**Must be rewritten (all three are this round's job, none is a weakening):**

- `content/keep.test.ts` — *"only the five tiers the bible prices (2, 3, 5, 7, 9) cost resources"* →
  **all eleven non-starting tiers are priced**, with tiers 2 and 3 still asserted byte-identical.
- `content/keep.test.ts` — the tier-4/5 headline assertions gain the Craft Table and the Poultice
  Shelf's newly-real effect.
- `content/names.test.ts` — the forbidden-vocabulary set is *derived from the registries*, so five
  new content nouns (Lodestone, Craft Table, Waybread, Trail Kit, Wayhome Lantern) automatically
  become forbidden Pip names. **Re-run it in the same commit**; if a name in the 140-name pool
  collides, the pool entry moves, never the resource.

**Must stay green untouched, and if any of these move something is wrong:** every assertion in
`pips/balance.test.ts`, `keep/effects.balance.test.ts`, `pips/level.balance.test.ts`,
`pips/lifecycle.promises.test.ts`, the four deadlock regression pins, the Gathering-Station on-ramp
block, and the Shore/Feastpot/items-per-minute pins in `expeditions.test.ts`.

### 6.5 Risks

| # | Risk | Mitigation / first lever |
|---:|---|---|
| 1 | **Someone "tidies" a loot weight and silently breaks six pinned claims.** The zero-dilution identity looks like an accident, not a contract | the identity test (§6.4 #3) and a loud comment on all six numbers in `tuning.ts`/`expeditions.ts` naming this bible §1.2 |
| 2 | **The casual player stalls at tier 5** (12 lodestone at ~3–6/day) | pre-computed lever: tier 5 → **11 lodestone** (73.3 min, still monotonic). **Do not touch the loot weights** |
| 3 | **The loot reveal gets long.** Shore goes 6 → 9 items, Lanterngrotto 14 → 16 | `lootReveal.ts`'s staged script needs a length check at 16 items on a 375px screen. If it drags, shorten the per-item flip for `"common"` tier — do **not** cut rolls, which would break I1 |
| 4 | **Crafted Poultices trivialise ailments** | the cure ceiling (§4.1), asserted; power untouched (I4); and the honest observation that a determined player's survival was already ≈ 1 |
| 5 | **Decoration spam maxes a `remedy` channel** — ten Cairns is 0.40 against a 0.60 cap | `crafting.buildingRemedyMax` (0.15 / 0.06), summed once and clamped once |
| 6 | **The Craft Table is never opened** and every claim in §5 evaporates | §6.3's visibility table, and specifically the ailment card's *"Make one"* affordance and the Build-sheet sprite (round 2F's brown-crate lesson) |
| 7 | **The HUD has no room.** Round 2G cut the 14-chip satchel row to reclaim 86px; a fifth resource and a craft timer both want space | neither goes in the chrome. Lodestone lives in the Items sheet and on cost lines; craft progress lives on the station sprite and in the recipe book. **The Keep strip does not grow.** |
| 8 | **Existing saves feel re-taxed** at tier 5 | the typed `missing` shortfall on the upgrade card, plus tier 4 deliberately staying lodestone-free so the *first* tier after the migration is unchanged in kind |
| 9 | **Scope.** This round touches `core/economy`, `core/keep`, a new core module, two registries, the effect union, the badge map, five UI surfaces and the schema | §6.6's ordering puts the ladder (all guard-suite work, no UI) first, so the round has a shippable, gated halfway point |
| 10 | **`remedy`/`longevity` expands the round** | explicitly separable — §3.6 states the cut line, and cutting it costs two recipes and nothing else |

### 6.6 Implementation order (and what turns green when)

1. **`RESOURCE_IDS` + the three loot tables + the identity test.** Core change, tiny.
   *Green:* `expeditions.test.ts` (with the new identity row), the whole of `reachability.test.ts`
   unchanged. **Nothing else in the repo moves — this step is provably inert.**
2. **`progression.levelCosts` for all eleven tiers**, and the `keep.test.ts` rewrite.
   *Green:* the escalation chain, all eleven afford rates. **Stop here and the round is already
   worth shipping.**
3. **Schema v11** (`state.crafts`, fixture, migration, deep-equal-preserves-resources test).
4. **`core/keep/crafting.ts`** + `JobDef.kind` + `content/recipes.ts` + validator branch.
   *Green:* `crafting.test.ts`, the two new reachability rows, the cure ceiling.
5. **The effect union** (`craftSpeed`, and `remedy`/`longevity` if kept) + `foldEffect` + the badge
   map + the Comfort readout rows.
6. **UI:** the recipe book sheet, the station progress ring, the send-off provisions row, the ailment
   card's *"Make one"*, the Doorstep line, the Satchel row.
7. **Verify:** gate runner, an **economy audit** (does the fifth resource read as a resource or as
   homework?), and a mutation pass aimed squarely at this round's own guarantees — delete the
   `offlineRateCapMs` clamp from the craft collector, delete a lodestone weight, make a recipe output
   wood, and remove the *"Make one"* affordance. If the suite stays green on any of those, the guard
   is decorative.

### 6.7 Named seams this round deliberately does not build

- **Crafting bounties.** `BOUNTY_TEMPLATES` is level-aware and would take *"craft two Waybread"*
  as pure content. Gate at ≥ 4. Not this round.
- **A craft-finished notification.** Round 2I's budget is 4/day with a 25-minute floor and its rule
  is that new news rides an existing buzz. A crafted item is not a homecoming.
- **Decorating** — spec §6.2 names *"Crafting/Decorating"*. Only Crafting is built.
- **A shop.** `FoodDef.cost` is still the unused seam it has been since v1.1, and stays that way.
- **A seventh expedition.** Progression bible §8.3 names it as the other way to raise the ceiling.
  §0.1 shows a fifth resource does not raise it; if the ladder ever needs to be *longer* rather than
  *broader*, that is the lever, and it is a different round.

---

## 7. The one-paragraph version

PipsKeep gains **Lodestone**, a fifth resource that washes up at the Shore, sits under the Snowdrift
and warms the rocks of the Lanterngrotto — added to those three loot tables by scaling their rolls in
exact proportion to their new weight sums, so **not one existing yield in the game changes by a
float**. It is unobtainable below Keep tier 3, which lets **all eleven non-starting tiers carry a real
price for the first time** (up from five), strictly escalating from 33.3 to 127.1 expected minutes
with every row clearing the reachability guard at ≥ 0.996. And it gives the **Craft Table** — a job,
worked by a Pip, on a queue, capped offline like every other rate — something worth consuming: eleven
recipes that turn the surpluses this economy generates into the scarcities it does not, chief among
them **the Poultice**, the game's only cure, which until now could only be *found* on the same three
trails that cause the illness. After this round, a player who loves a Pip can go and make the thing
that saves her.
