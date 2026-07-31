# The Liveliness Bible — round 2K

> **Attractions, and the Keep as a place.**
>
> Design pass for the last round in the queue. Read `PIPSKEEP_SPEC.md` §9, §11, §15.5 and all of
> §16 first; this document assumes them. Where this document and the spec disagree, the spec wins,
> except where §7.2 below proposes a §16 amendment explicitly.
>
> Everything numeric here is `[DEFAULT — review]`-grade and lands in `content/tuning.ts`. The
> structural decisions — what an attraction *is*, what a visitor may never do, where time-of-day
> comes from — are the part worth arguing about.

---

## 0. WHAT I FOUND BEFORE I DESIGNED ANYTHING

### 0.1 The brief named two open wounds. **Both are already closed.**

The brief asks this round to fix the round-2D accessory placement defect and to wire the Poultice
Shelf and three `longevity` placeables. I audited both before designing around them, because
designing a fix for something already fixed is the most expensive kind of wasted round.

| Wound as briefed | Actual state at HEAD `421dfe7` | Evidence |
|---|---|---|
| "the scarf renders across the mouth like a gag, the lantern over an eye, the bowtie on the belly" | **Fixed by round 2D's own fix stage.** `content/accessories.ts` gained an `AccessorySlot` field (`crown`/`neck`/`shoulder`/`side`) with documented body-height fractions; `render/spriteResolver.ts` derives `NECK_Y_FRAC`/`SHOULDER_Y_FRAC`/`CROWN_TUCK_PX` from it; both DOM stylesheets place each accessory in the matching band | `spriteResolver.ts:236–259`, `accessories.ts:68–90`, `ui.css:1602–1723`, `pipdex.css:800–941` |
| "the Poultice Shelf and three `longevity` placeables have no `effects` wired" | **Fixed by round 2J's fix stage.** `poultice-shelf` carries `{kind:"remedy", contractReduction:0.10, cureBonus:0.05}`; `larder` 0.05, `nest-warmer` 0.06, `sun-bunks` 0.10 `longevity`. All three channels are folded in `core/keep/effects.ts`, clamped once, and **read at live call sites** | `placeables.ts:184/229/246/285`, `effects.ts:253–262/335–350`, `state.ts:2826/2904/3406/3530` |

`docs/BACKLOG.md`'s "Known defects" section is **stale on both counts** — it was written at commit
`d3c4ca7`, before `9bc2bcc` (round 2D) and `421dfe7` (round 2J) landed their fix stages. Striking
those two bullets is part of this round.

### 0.2 …but the accessory guard is measurably weaker than it reads, and one collision is still live

This is the finding that justifies keeping §6 in the round at all. I measured it, in a real browser,
against the real modules — not by eye.

`render/spriteResolver.test.ts`'s `"accessories are worn on the RIGHT BODY PART"` suite probes
**one silhouette** (Mosspip, `round`) at **one seed**, and tests **point containment** of the
mouth's *top* control point (`bh × 0.60 + 2`) against each accessory's axis-aligned bounds.

Two things follow:

1. **The guard checks the wrong edge of the mouth.** The mouth is a stroked quadratic:
   `moveTo(-6, -bh·0.40) → quadraticCurveTo(0, -bh·0.36, 6, -bh·0.40)` at `width: 2.5`. Its painted
   band in anchor-local space is `[0.60·bh + 0.75, 0.62·bh + 3.25]`. The guard tests only the top of
   that band. Every `neck` accessory correctly sits below the mouth's **top** while covering its
   **bottom**, so the collision is invisible to the assertion by construction.
2. **The guard probes the most forgiving of the five silhouettes.** `round`/`tall` are `hFrac 1.0`;
   `chunky` is 0.82, `tiny` 0.76, `wide` 0.72. The accessory shapes are authored in **absolute
   pixels** (an 11 px scarf band, a 16 px tail, a 12 px bowtie) while the body they hang on shrinks
   by up to 28%.

**Measured** (Chromium, live Vite modules, probe seed `"zero-jitter-probe"`, adult stage;
`spriteResolver.accessoryAnchor.getLocalBounds()` for the painted top, the mouth band computed from
the same literals):

| Silhouette | species | `bh` | scarf band top | mouth painted bottom | **overlap** |
|---|---|---:|---:|---:|---:|
| `round` | Mosspip | 93.1 | 60.87 | 60.97 | **0.10 px** |
| `tall` | Cloudpip | 93.1 | 60.87 | 60.97 | **0.10 px** |
| `chunky` | **Pebblepip** | 76.4 | 48.79 | 50.62 | **1.83 px** |
| `tiny` | Emberpip | 70.8 | 44.77 | 47.15 | **2.38 px** |
| `wide` | **Tidepip** | 67.1 | 42.09 | 44.85 | **2.76 px** |

The mouth is **2.5 px tall in total**. On Tidepip the scarf's top edge covers slightly more than the
entire mouth stroke. The bowtie is the same shape of problem with ~0.6 px more headroom; the ember
bead's cord clears the mouth only because its topmost points are at ±0.13·bw, off the mouth's
x-range.

**The starter trio is Mosspip / Pebblepip / Tidepip — `round`, `chunky`, `wide`.** Two of the three
Pips on the first screen a new player sees can roll a scarf that sits on the mouth. The brief's
description of the wound was right; only its diagnosis of *where* was out of date.

§6 specifies the fix: a landmark-derived, silhouette-scaled zone table, shared by all three
surfaces, with guards that probe all five silhouettes and rect-overlap the painted band.

### 0.3 The round's five invariants

Everything below is downstream of these. Each is written so a test can hold it.

**I1 — ATTRACTIONS MAY NOT ADVANCE THE ALBUM. Structurally, not by tuning.**
A visitor is drawn only from species the player has **already caught**. Therefore `formsSeen`,
`formsCaught` and `variantsCaught` cannot move on a welcome, by partition rather than by margin.
This is round 2H's breeding guardrail (§6.3: *"breeding can never produce a species the player does
not already own"*) applied to the third succession path, deliberately, because that guardrail
survived a cruelty audit and a mutation stage.

**I2 — NOTHING HERE TOUCHES THE CARE ECONOMY.** No attraction, no weather, no time-of-day state
reads or writes `needDecayPerHour`, `personalityDecayMultipliers`, `care.*`, `foods.*`,
`offlineRateCapMs`, `sulkExitThreshold`, `playRefusal`, any ailment chance, any cure chance, or any
lifespan factor. 2C's §0.4 isolation rule, restated. `core/pips/balance.test.ts` and
`core/keep/effects.balance.test.ts` must come out **byte-identical**.

**I3 — ABSENCE MAY COST A BONUS AND NOTHING ELSE.** An absent player's feeders empty; nothing is
deducted, no trust is lost, no visitor is lost, no counter regresses, no page closes. 2C §0.1's
table extends with three rows, all "no". The one thing absence can cost is *witnessing a visit*,
and §1.6's held-open rule guarantees there is always one waiting when you come back.

**I4 — WEATHER IS MOOD. IT HAS NO MECHANICAL EFFECT OF ANY KIND.** Argued in §4.3, enforced by a
purity-style grep test: nothing under `core/` may import the weather module.

**I5 — THE FRAME BUDGET IS THE ARBITER, AND IT IS MEASURED.** Spec §1 pins 60 fps with 5 animated
Pips and 30 decorations. §5 gives a measured object-count baseline (**239 display objects**), a
per-feature cost table, and a named cut order. Ambience that cannot be measured does not ship.

### 0.4 Inherited guards, restated as things that will fail loudly

| Guard | What it holds | How this round could break it |
|---|---|---|
| `core/pips/balance.test.ts` | one care session out-restores one capped absence | any decay/restore touch (I2) |
| `core/keep/effects.balance.test.ts` | comfort declared ≥ cap and ≤ 1.6× cap; **no utility station carries `comfort`** | an attraction authored with a `comfort` effect |
| `core/economy/reachability.test.ts` | every price payable from already-unlocked income; 0.95 afford rate over 200 seeded 3 h sessions | attraction build/restock/welcome prices |
| `src/ui/layers.test.ts` | the z-index ladder; `.pk-phase5` keeps its stacking context | the visitor card, the daylight overlay |
| `src/ui/portraitPatterns.test.ts` | three-implementation parity for patterns and accessories | the §6 zone rework |
| `core/crafting/balance.test.ts` | the cure cadence floor | untouched (I2) |
| `content/names.test.ts` | no Pip name is a word the game uses for a thing — **derived from the registries**, so new item names extend the forbidden set | six new item names (§1.2 — checked; see §7.5) |

---

# 1. ATTRACTIONS

## 1.0 The shape, in one paragraph

An attraction is a **placeable you stock with feed**. While it has feed, a wild Pip **from a biome
you have already visited, of a species you already own** walks into the Keep every so often, hangs
around the attraction for the better part of an hour, and leaves. You can watch it, talk to it, and
give it a snack it likes. Give it the right snack three times, across three separate visits, and it
will stay if you ask. **Which attractions you build decides who calls.** Feed is the cost, and it is
paid over and over, forever.

That is the whole mechanic. Three things it deliberately is not: it is not a lottery, it is not a
route to a species you have never met, and it is not a thing that nags you.

## 1.1 Where the seam lands, and what happens to it

Spec §12 promised *"Keep upgrade registry supports `effect: "attraction"` no-op"*. That member
(`KeepUpgradeEffect = "rosterCap" | "attraction"` in `content/keep.ts:169`) has **no consumer
anywhere in the tree** — it is a dead union arm, which is exactly the shape of dead feature this
project has found nine times.

**Decision: the seam is honoured by moving, not by occupying.** `attraction` becomes a member of
`BuildingEffect` (`content/buildingEffects.ts`), where every other building capability already lives
— `comfort`, `job`, `remedy`, `longevity`, `craftSpeed`. The `KeepUpgradeEffect` arm is **deleted**
in the same patch. A capability that lives in the same vocabulary as `job` gets the Build sheet card
copy, the icon badge, the Keep Comfort readout row and the `resolveKeepEffects` aggregation for free;
a capability living in a one-entry upgrade registry gets none of that.

```ts
/** ROUND 2K — draws WILD PIPS to the Keep (docs/liveliness-bible.md §1).
 *  `biomeId` is an ExpeditionId: the visitor pool is that biome's
 *  `eggSpecies` INTERSECTED WITH the species the player has already
 *  caught (I1 — attractions can never advance the Album). Purely
 *  descriptive here, like `job`: `core/attractions/` owns the schedule
 *  and reads the registry directly. */
| { readonly kind: "attraction"; readonly biomeId: string }
```

`BADGE_FOR_EFFECT_KIND` is exhaustive by type, so widening the union is a coordinated
content + core + ui edit (2J's own note). The new case is **`boot`** — the travel family. A sixth
badge id was considered and declined: five badges is a vocabulary a player can learn, and a visitor
arriving *is* travel.

## 1.2 The six attractions

One per biome, because the game already has six biomes with six loot identities, six flavour voices,
and an Album organised by them. One-per-biome is the only shape in which *"what you build shapes who
visits"* is a real decision rather than a token one.

| id | Name | Biome | Footprint | Motif | Build cost | Restock cost | Charges |
|---|---|---|---|---|---|---|---:|
| `clover-ring` | **Clover Ring** | meadow | 2×2 | `leaf` | `wood 10, fiber 12` | `fiber 4, wood 2` | 4 |
| `thicket-feeder` | **Thicket Feeder** | bramblewick | 1×1 | `basket` | `wood 8, fiber 14` | `fiber 6, wood 3` | 4 |
| `sap-bucket` | **Sap Bucket** | forest | 1×1 | `bowl` | `wood 18, fiber 6` | `wood 8, fiber 3` | 4 |
| `snow-bell` | **Snow Bell** | snowdrift | 1×1 | `chime` | `wood 12, fiber 10, lodestone 2` | `wood 6, fiber 6, lodestone 1` | 4 |
| `tidewrack` | **Tidewrack** | shore | 2×2 | `shell` | `shell 8, driftwood 6, wood 10` | `wood 4, shell 2, driftwood 3` | 4 |
| `lampwell` | **Lampwell** | lanterngrotto | 2×2 | `lantern` | `lodestone 8, shell 6, wood 14` | `wood 6, shell 2, lodestone 2` | 4 |

Every id and display word was checked against `content/names.test.ts`'s derived vocabulary sweep and
the 166-entry `NAME_POOL`. **`Hollow`, `Drift` and `Willow` are in the name pool** — which is why
there is no "Hollow Log" and no "Driftwood Perch" here. `Basin`, `Shelf`, `Cairn`, `Pool`, `Lantern`
and `Table` are avoided as *second* uses of an existing item word. The pool still needs re-validating
in the same commit (§7.5).

Flavour, because a card that says "attracts Pips" is the ninth dead feature in a new costume:

- **Clover Ring** — *"A ring of clover nobody's allowed to cut. Word gets round."*
- **Thicket Feeder** — *"A basket wedged in the hedge. Something eats from it every night and never says thank you."*
- **Sap Bucket** — *"Slow, sweet, and impossible to walk past. Ask anyone."*
- **Snow Bell** — *"It only rings when it's cold enough. Whoever comes when it does already knew what it meant."*
- **Tidewrack** — *"Everything the tide left, arranged on purpose. It's an invitation, if you can read it."*
- **Lampwell** — *"A dish of glowstone kept lit at the Keep's edge. Down in the grotto, that means welcome."*

### The unlock

**All six unlock at Keep tier 6**, and tier 6's headline changes:

```
level 6, headline: "The Clover Ring — wild Pips start coming by"
unlocks: [
  "the Clover Ring, and five more ways to draw visitors",
  "the Larder",
  "the Nest Warmer",
  "eggs hatch sooner",
  "5-of-a-set bonuses go live",
]
```

Three reasons for tier 6 rather than tier 7 (which is the thinner tier and was the tempting answer):

1. **Timing against 2H.** The earliest a Pip can be lost is `noLossBeforeLifeMs` = 3 rated days, and
   `firstLossGrace` means the *first* one never happens at all. Tier 6 lands at **engaged day 3**
   (progression bible §1.6). The third succession path arrives at the first moment it could matter.
   Tier 7 is engaged day 5 — two days after the earliest possible loss.
2. **Theme.** Tier 6 is already the "the Keep becomes a home" tier (Larder, Nest Warmer, sets going
   live). Creatures starting to visit is the same sentence.
3. `content/keep.test.ts` requires a headline to **name something that gates at that tier**.
   "The Clover Ring" does. "Visitors" would not have.

The casual player reaches tier 6 on day 9. That is late for a succession path, and it is fine:
lineage eggs (guaranteed within two trips) and breeding (level 3+) are both live long before. This
is the *luxury* road back, not the first one — which is also why it costs the most.

## 1.3 What decides who visits — the pool, and the hard guardrail

```ts
function visitorPool(attraction, state): readonly SpeciesId[] {
  const biome = expeditions[attraction.biomeId];
  return (biome.eggSpecies ?? []).filter(
    (id) => state.pipdex.entries[id]?.caughtAt != null,   // ← I1
  );
}
```

Two properties, both structural:

- **It reuses 2B's collection engine verbatim.** No second species table to drift out of sync with
  `content/expeditions.ts`. Add a species to a biome pool in five rounds' time and its attraction
  learns about it for free.
- **An empty pool schedules nothing and consumes zero RNG rolls.** Exactly the cursor discipline
  2H's lineage seeds use (*"zero rolls on a trip to a biome with no unfound seed, so no existing
  cursor moves"*). A tier-6 player who has never taken the Lanterngrotto can build a Lampwell; it
  simply sits there, and its card says so, warmly:

  > *"Nobody from the Lanterngrotto knows the way here yet. Meet one first, and the light will mean
  > something."*

**Attractions are a reward FOR collection, never a route TO it.** That single sentence is the whole
guardrail, and §2 does the arithmetic.

### What the visitor's genome is

`rollGenome` from the new `"visitors"` stream, with the registry **narrowed to the pool** — the
identical narrowing mechanism 2C's pity and 2B's biome pools already use, which preserves
`rollGenome`'s shipped fixed-5-roll contract. So a visitor may carry a palette, pattern, personality
or accessory the player has never seen, and may be **shiny** at the shipped `genome.shinyChance`.

That last one is deliberate and is the round's one concession to surprise: `shiniesCaught` is the
Album's **one counter with no denominator by design** (retention bible §1.2 — *"3 glimmers found,
never 3/14"*), so a shiny visitor is a celebration that moves no completion percentage. I1 is
stated precisely as: **a welcome may not move `formsSeen`, `formsCaught` or `variantsCaught`.**

## 1.4 Stock — the thing that makes this a sink

An attraction holds `stockMax` **4** charges of feed. **One charge is spent per visit produced.**
An attraction at zero charges produces no visits.

The rules that keep this from becoming a chore or a punishment:

| Rule | Why |
|---|---|
| A restock always fills to full, for one flat cost | no partial-fill arithmetic, no optimisation |
| **"Restock all"** is one tap on the Keep card, with one summed cost | the daily ritual is one tap, not six |
| An empty attraction is **inert, never broken** | nothing else in the game depends on it |
| **No badge, no toast, no red dot, no notification, ever** | 2C §0.3 bans urgency surfaces as a category |
| The empty state is legible in the world (the bowl is empty) and on the card (`Feed 0/4`) | §0.5 full disclosure — information, not a nag |
| Removing an attraction **refunds its remaining charges** as well as its build cost | 2J's *"tuck away never destroys value"*, already the rule for a Craft Table's in-flight orders (`state.ts:3665`) |
| Placing an attraction stamps it **full** (the build cost includes the first fill) | you never build a thing and watch it do nothing |

Charges burn on the schedule whether or not anyone is watching — a feeder empties because things
eat from it. That is the honest simulation, and it is what lets the sink scale (§3). It costs the
absent player nothing they had: the charge was pre-paid, nothing is deducted on return, and §1.6's
held-open rule means they still get a visit to witness.

## 1.5 The visit — cadence, and how it is expressed

```
tuning.attractions.visitIntervalMs   = 6 h of RATED time
tuning.attractions.lingerMs          = 45 min
tuning.attractions.maxConcurrent     = 2
```

**Rated time, not wall time.** Visit scheduling rides the *existing* job-catch-up machinery
(`core/keep/jobs.ts`'s `collectJobCatchupEvents`, which already honours
`min(elapsed, offlineRateCapMs)` = 16 h). **No third clock is introduced.** A week away produces at
most `floor(16 / 6)` = 2 visits per attraction, not 28.

**What a visit looks like, concretely** — because "a visitor arrived" written to `state.visitors`
and nothing on screen is the tenth dead feature:

1. The wild Pip **walks in from the nearest screen edge** toward its attraction — the same
   `resolvePipSprite` rig every roster Pip uses, so it is a real, individual, jittered, accessorised
   Pip on sight.
2. It **reads as not-yours**: no selection ring, no cast-strip mood dot, a slightly lighter contact
   shadow, and a **drifting motif** (three slow petals for the Clover Ring, snow motes for the Snow
   Bell, a faint glow for the Lampwell — one pooled emitter, keyed off the attraction's `icon.motif`).
3. It **loiters at the attraction**, using the existing station-gravitation path, with the ordinary
   idle set. It is not stationary and it is not on rails.
4. It **leaves** at `leavesAt` by walking back off the same edge, with a line.

**Tapping it opens the Visitor card** — a small sheet, deliberately *not* the focus view (it is not
your Pip; it has no need bars, no job, no expedition):

```
┌──────────────────────────────────────┐
│   [portrait]  Pipsqueak              │
│               Tidepip · Curious      │
│               visiting from the Shore│
│                                      │
│   "Come by twice before."      ●●○   │
│                                      │
│   [ Offer a snack ]                  │
│   [ Ask them to stay ]   (at ●●●)    │
└──────────────────────────────────────┘
```

- **Offer a snack** opens the Satchel filtered to that biome's own foods. A snack from the right
  biome earns **+1 trust, once per visit**. A snack from anywhere else is accepted with a line and
  earns nothing (it is not refused — refusing a gift is not this game's tone).
- The trust pips (`●●○`) are the full-disclosure surface: three, visible, from the first visit.
- **Ask them to stay** appears only at `welcomeTrust` **3**.

### Trust is forward-only

Trust never decays, never resets, is never lost to absence, and is not spent by anything but a
welcome. It is a `state.visitors[placementId].trust` counter and it joins 2C §0.1's may-never-
decrease table. A visitor you fed once six weeks ago comes back still remembering.

**The same visitor keeps coming back.** One `VisitorRecord` per attraction placement, persisting
between visits, so the fiction is *"the little grey one who keeps turning up"* rather than *"a random
Pip event fired"*. When a visitor is welcomed (or when the attraction is removed), the record is
cleared and the next visit rolls a fresh one.

## 1.6 Absence, and the held-open rule

The kindest rule in the round, and the one that makes I3 true rather than merely claimed:

> **On return, the most recent scheduled visit per attraction is materialised with its `leavesAt`
> extended to `returnAt + lingerMs`.** Earlier visits in the window are reported on the Doorstep and
> produce no state.

So a player who returns always finds someone standing there, up to `maxConcurrent` of them. Trust is
only earned by being present with the right snack — but presence is *guaranteed to be possible* on
every single return, so three returns is three chances. An absent player is slower, never blocked.

Doorstep copy, and the tone rule it must satisfy:

> **"Busy morning. Four callers, and Pipsqueak stayed longest."**

Never *"you missed"*, never *"they waited"*, never *"came while you were away"*. Nothing was lost, so
nothing may be phrased as loss. `retention.copy.test.ts`'s banned-phrase regex gains
`/missed (them|you)|waited for you|came and went/i`.

## 1.7 The welcome — cost, the roster cap, and the Long Meadow

**Cost**, paid once, scaled by biome depth. Priced in the resource the biome itself supplies, so the
sentence *"go to the Shore, come back, and you can keep a Tidepip"* is literally true:

| Biome | `welcomeCost` |
|---|---|
| meadow, bramblewick | `wood 12, fiber 12` |
| forest, snowdrift | `wood 16, fiber 14, lodestone 2` |
| shore, lanterngrotto | `wood 20, shell 8, lodestone 4` |

Plus, already spent: three biome snacks across three visits.

A welcomed Pip enters the roster at **level 1**, needs at the shipped `arrivalNeeds`, generation 0,
no scars, keeping its rolled name and genome. **Deliberately weaker than both other succession
paths** — lineage hands you `1 + floor((parent − 1) × 0.50)`, breeding `× 0.35`. A stranger has no
family history to inherit, and this keeps attractions from becoming the efficient way to manufacture
levels. The thing attractions give that the other two cannot is **a Pip that is not related to
anyone you have** — new blood for breeding, which is the quiet reason a completionist builds them.

### At the roster cap, the answer is: **they wait.**

Not a refusal, not a prompt to retire someone, not an upsell.

> *"Pipsqueak would stay, when there's room."*

Trust stays at maximum. The visitor keeps calling. The button becomes a quiet line of text. Nothing
expires, ever — retention bible §0.2, *"nothing is ever missable"*, applied exactly as it is applied
to a Pipping egg.

**The Long Meadow is offered, once, as an option — never as a requirement.** Below the waiting line,
one secondary link:

> *"The Long Meadow has room, if someone fancies a rest. You can ask them home whenever you like."*

It opens the existing Long Meadow sheet. It is not pre-selected, it names no Pip, and the copy says
the true thing: the Long Meadow is unlimited, retirement is reversible after `minStayMs`, and
`retirePip` already refuses at `minActivePips` so **promise 5 holds mechanically** — a visitor can
never empty a Keep.

### Composition with 2H's mortality

Nothing fires on a loss. The loss moment's copy (lifecycle bible §4) is not touched — adding *"but
someone might visit!"* to the sentence after a Pip dies would be the single worst line in the game.

Instead, the Nook gains a sibling card to **"Someone to find"**:

> **Someone who visits** — one row per attraction with a live visitor or a visitor at full trust,
> showing the portrait, the biome, and the trust pips. No countdown, no badge, no nag. It simply
> stays there.

Two standing cards, two threads, both always visible, neither urgent. That is what "more than one
road back" should look like on screen.

## 1.8 What attractions may never do

Written as a list because the mutation stage will try all of them:

1. Never produce a species the player has not caught (I1).
2. Never produce an **evolved** form. `eggSpecies` pools contain no `lineage`-rarity entries, so this
   is inherited, not added — but it is asserted, because v1.3's standing rule (*"evolution must be
   earned"*) has been re-broken once already.
3. Never touch `state.eggPity`. A welcome is not a hatch. Incrementing it would be a gift;
   resetting it would be a punishment. **Byte-identical across a welcome** is the test.
4. Never produce an egg, a resource, a food, or any inventory item. Attractions are a **pure sink** on
   the economy's ledger — `reachability.test.ts`'s premise that expedition and job tables are the
   only faucet is strengthened, not weakened.
5. Never change any expedition's duration, loot table, `eggChance`, or ailment chance (I2).
6. Never grant a `comfort` effect (`effects.balance.test.ts`'s "no utility station carries comfort" —
   all six ids join `NOT_COMFORT_STATIONS`).
7. Never notify. §4.6 argues this at length.
8. Never nag about stock.

---

# 2. THE COLLECTION GUARDRAIL

> The brief: *"Show the arithmetic proving attractions do not out-pace expeditions as a route to the
> Album. Interact explicitly with 2C's pity counter and 2B's biome pools."*

## 2.1 The arithmetic, and why it is a partition rather than a margin

Content bible §3.6's completionist table is the thing to beat:

| Species | Best route | Expected engaged time |
|---|---|---|
| Cloudpip | Meadow (23.1% × 8%) | ~4.5 h |
| Tidepip | Shore (76.9% × 18%) | ~3.6 h |
| Pebblepip | Forest (43.5% × 12%) | ~4.8 h |
| Emberpip | Lanterngrotto (71.4% × 50%) | ~4.2 h |
| Snowpip | Snowdrift (50% × 35%) | ~5.7 h |
| **Lanternpip** | Lanterngrotto only (28.6% × 50%) | **~10.5 h** |

Against that:

> **Expected time for an attraction to produce a species the player has not caught: undefined.
> There is no such event.** `visitorPool` intersects with the caught set before a single roll is
> consumed. The ratio is not 1.3× or 4×; expeditions are the only route, at every tier, forever.

This is the property worth having. A tuning margin ("attractions are 3× slower than expeditions")
rots the first time someone retunes a cadence. A partition does not. It is also the exact property
2H chose for breeding, and it is the reason that round's cruelty audit passed: *"breeding adds zero
Album progress. It produces more of what you have."*

**Corollary worth stating out loud:** every attraction in the game is **dead weight to a new player
and grows in value as the Album fills.** The Lampwell is worthless until you have taken the
Lanterngrotto and hatched something from it. That inverts the usual gacha shape — here the
collection unlocks the passive channel, not the other way round.

## 2.2 Interaction with 2C's pity counter — three explicit claims

`core/progression/pity.ts` tracks, per biome, hatches that did **not** produce the pool's rarest
tier, guaranteeing that tier at `thresholdByRarity` (uncommon 8, rare 6).

1. **A welcome is not a hatch and never calls `updatePityCounter`.** The counter is threaded from
   `HATCH_EGG` and only from there. Test: `eggPity` deep-equal before and after `WELCOME_VISITOR`,
   including the case where the welcomed species *is* the biome's rarest tier.
2. **Attractions cannot shorten a pity chase.** The chase is for a species you have not caught;
   attractions only produce species you have. The two systems are disjoint on their inputs.
3. **Attractions cannot lengthen one either.** They consume zero rolls from the `"egg"` or
   `"genome"` streams — the `"visitors"` stream is new and separate, and its cursor lives in
   `rngState` like every other. A save's future egg rolls are bit-identical whether or not
   attractions exist. **This is the cursor-parity claim and it needs its own test**, the same one
   round 2B's biome-pool patch and 2C's pity narrowing each shipped.

Consider the sharpest hypothetical: a player 5 hatches into an 8-hatch Snowdrift pity ladder chasing
Snowpip. They build a Snow Bell. Its pool is `{snowpip, cloudpip} ∩ caught`. They have never caught
a Snowpip, so the pool is `{cloudpip}` — the attraction can only ever bring the thing they already
have. The chase is untouched. **The system is at its most useless precisely where it would have been
most damaging.** That is not an accident of tuning; it is what I1 buys.

## 2.3 Interaction with 2B's biome pools

Attractions **read** `ExpeditionDef.eggSpecies` and never write it, and never change any expedition's
`durationMs`, `lootRolls`, `lootTable`, `eggChance` or `unlockKeepLevel`. Content bible §3.6's
time-to-find table is therefore unchanged **to the last digit** — an identity, not an estimate, and
`content/expeditions.test.ts` already pins the per-trip yields that make it so.

The one *soft* interaction, named honestly: attractions give a player a **second reason to have
visited a biome**. Before this round the only reason to take the Lanterngrotto twice was loot and a
Lanternpip. After it, the first Grotto trip also lights the Lampwell. That makes the deep trails
more attractive without changing a single number in their tables — which is the kind of composition
this project keeps trying to get.

## 2.4 Does the ROSTER fill too fast? (The second, softer collection question)

The Album is safe by partition. The roster is not, so it gets real arithmetic.

Fastest possible welcome, one attraction:
- 3 witnessed visits × 1 snack each, minimum one visit per return, ~3 returns/day → **1 day**.
- With six attractions running, six visitors accumulate trust in parallel → theoretically ~6
  welcomes available by day 2.

That is too fast on its face. Four things bind it:

| Brake | Effect |
|---|---|
| `rosterCap` 3 / 5 (Cozy Bunks) / 6 (tier 11) | there are at most 6 slots, ever |
| `welcomeCost` at the deep end: `wood 20, shell 8, lodestone 4` | 4 lodestone against 11/day income, competing directly with crafting's 8–16/day |
| Snacks are **biome foods** — glowcap, emberloaf, frostberry, tideroll | the deep-biome foods are the scarce ones; three of them per welcome is a real trip cost |
| `maxConcurrent` 2 | at most two trust counters advance per return |

Steady state: a Keep at cap only welcomes when a slot opens, and slots open when a Pip retires or is
lost. Pip lifespan is 6.4–15.6 days (lifecycle bible §2.3). **At a 5-slot roster, replacement demand
is roughly 0.4 Pips/day; attractions can supply about that and no more, because the cap is the
binding constraint, not the cadence.** The equilibrium is the one 2H already designed for: *"a Keep
of a few well-known Pips with a family tree"* — plus, now, the occasional stranger who stuck around.

**A visitor is never lost to the cap** (§1.7), so the fast-accumulation case turns into a warm
backlog rather than a wasted opportunity: three friends waiting for a bed is a nice problem.

---

# 3. THE SINK

> The brief: *"Whether attractions can honestly absorb round 2J's late-game surplus — a sink a player
> WANTS. Show the flow arithmetic against 2J's measured income. If it cannot, say so."*

## 3.1 The problem, in 2J's own words

Economy bible §5.2, finding 3, the uncomfortable one:

> *"wood and fiber will still pile up, and no sink fixes that… an engaged tier-12 player banks ~50
> wood/day forever, and the only wood sinks are one-time. **The honest answer is not to invent a wood
> sink** — a make-work conversion recipe or an escalating price is exactly how a cosy game turns into
> a grind."*

So the bar this round has to clear is not "consume wood". It is **"consume wood in a way a player
actively wants to pay"** — no make-work, no escalating price, no exponential curve, no soft currency.

## 3.2 The flow arithmetic

2J's measured per-day income (economy bible §5.1):

| Player | wood | fiber | shell | driftwood | lodestone |
|---|---:|---:|---:|---:|---:|
| Engaged, tier 8+ | 49.6 | 54.5 | 9.0 | 6.5 | 11.0 |
| Engaged, tier 4 | 35.3 | 46.1 | 0 | 0 | 3.0 |
| Casual | 22.4 | 37.3 | 0 | 0 | 3.0 |

**Charge burn.** One charge per visit; one visit per 6 rated hours per stocked attraction.

- *Engaged* (present in bursts, absences short, so rated ≈ wall ≈ 24 h/day):
  `24 / 6` = **4 visits/attraction/day** → with `stockMax` 4, **one restock per attraction per day**.
- *Casual* (one check-in; rated time capped at 16 h per absence):
  `16 / 6` = **2.67 visits/attraction/day** → one restock per attraction every 1.5 days.

**Demand at the natural build — one of each, six attractions, engaged:**

| | wood | fiber | shell | driftwood | lodestone |
|---|---:|---:|---:|---:|---:|
| Clover Ring | 2 | 4 | | | |
| Thicket Feeder | 3 | 6 | | | |
| Sap Bucket | 8 | 3 | | | |
| Snow Bell | 6 | 6 | | | 1 |
| Tidewrack | 4 | | 2 | 3 | |
| Lampwell | 6 | | 2 | | 2 |
| **Total / day** | **29** | **19** | **4** | **3** | **3** |
| **% of engaged tier-8+ income** | **58.5%** | 34.9% | 44.4% | 46.2% | 27.3% |

## 3.3 The three findings

**Finding 1 — this is the first recurring sink in PipsKeep whose largest component is WOOD, and it
takes 58.5% of the faucet at a build nobody has to justify.** Crafting (2J) is a fiber-and-lodestone
sink: a Craft Table on Poultices burns 96 fiber and 16 lodestone a day and **zero wood**. The whole
build catalogue and the whole Keep ladder are one-time. Attractions are the first thing in the game
that eats wood every day and keeps eating.

**Finding 2 — the sink CAN exceed the wood faucet, at a build the player chooses for its own sake.**
There is no limit on placing multiples (the same rule 2J's craft-only Cairns already established),
and the grid reaches 12×14 = 168 tiles at tier 9.

| Attractions placed | tiles used | wood/day | vs 49.6 income |
|---:|---:|---:|---|
| 6 (one each) | 15 | 29.0 | 58.5% |
| 10 | 25 | 48.3 | 97.4% |
| **12 (two each)** | **30** | **58.0** | **117%** — *the sink exceeds the faucet* |
| 18 | 45 | 87.0 | 175% |

Thirty tiles of 168 is a corner of the Keep. **The sink's ceiling is the player's own appetite for
visitors, and that is precisely the property "a sink a player WANTS" means.** Nobody restocks a
feeder as a chore. They restock it because the little grey one comes by.

And the arithmetic never inflates: the price of the eleventh Clover Ring is the price of the first.
No escalation, no prestige reset, no conversion recipe. 2C §0.3's banned shapes are all absent.

**Finding 3, and it is the honest caveat — this does not CLOSE the wood surplus at a normal build,
and pretending otherwise would be the wrong kind of confidence.** At six attractions an engaged
tier-12 player still banks ~20 wood/day forever. What changes is the *character* of the leftover:
before this round, wood accumulated with nothing at all to want; after it, wood accumulates and there
is an obvious, delightful, unbounded thing to spend it on if you feel like it. 2J's answer was *"one
currency is kept scarce on purpose and the rest becoming free is fine"*. That answer still stands.
This round's contribution is that **the free currency now buys something**, which is a strictly
better resting state than "the free currency buys nothing".

> **Verdict, stated plainly as the brief asks: yes, honestly, and partially.** Attractions are a real,
> recurring, non-make-work sink whose largest component is the one resource nothing else consumed;
> they absorb 58.5% of the wood faucet at the natural build and can exceed it at a build the player
> would only make for pleasure. They do not eliminate the surplus at a normal build. The arithmetic
> holds; the claim is sized to it.

## 3.4 The three ways this sink could go wrong, and the guards

| Failure | Guard |
|---|---|
| **Restocking becomes a chore** | one-tap "Restock all"; no timer; no consequence for an empty feeder; nothing else in the game depends on stock |
| **Over-building becomes a trap** (30 feeders, no wood) | removal refunds the build cost *and* the remaining charges (§1.4); the Build card states the rate in words: *"One caller about every six hours. Eats a handful of feed each time."* (§0.5 full disclosure) |
| **The bench-is-idle failure 2J named** — nobody builds any, so nothing sinks | §7.4's visibility table. A sink nobody opens is the tenth dead feature, and this round's whole standing rule is that shipping is not showing |

## 3.5 Reachability

Attractions add three priced families. All three join `reachability.test.ts` **data-driven off the
registries**, so future attractions are policed with no new hand-written list — a tightening:

1. `pricedPlaceables` picks up the six build costs automatically (`payableAt = unlockKeepLevel` = 6).
2. New: `pricedAttractionRestocks`, `payableAt = unlockKeepLevel`.
3. New: `pricedAttractionWelcomes`, `payableAt = unlockKeepLevel`.

Structural check at level 6: `resourcesObtainableAt(6)` = `{wood, fiber, shell, driftwood, lodestone}`
(Snowdrift unlocks at 3, Shore at 4, Grotto at 5). All five are legal. ✓

Rate check — analytic expected yield over the test's 3 h budget with every level-6 trail running in
parallel: **wood ≈ 68, fiber ≈ 71, shell ≈ 23, driftwood ≈ 16, lodestone ≈ 31.** The most expensive
thing this round prices is the Lampwell at `lodestone 8, shell 6, wood 14` — 26% of the lodestone
expectation, 26% of shell, 21% of wood. Every entry clears with 3–5× margin, which is well inside the
0.95 seeded-afford-rate bar. ✓

---

# 4. THE LIVING KEEP

> The brief: *"the game stops looking like a diorama and starts looking like a place."*

## 4.1 The ranking, first, because the frame budget is real

Ranked by **delight per frame cost**, which is the ordering the brief asks for and also the cut order
read backwards (§5.4).

| # | Feature | Delight | Persistent objects | Per-frame work | Verdict |
|---|---|---|---:|---|---|
| **1** | **Pip ↔ decoration interactions** | **highest in the round** | **0** | one extra branch when picking a wander target | ship first |
| **2** | **Pip ↔ Pip greetings** | very high | 0 (transient bubble is pooled) | ≤15 pairwise distance checks | ship first |
| **3** | Time-of-day sky + light | high | +1 | 1 lerp/second; redraw on threshold | ship |
| **4** | Lanterns lighting at dusk | high | ≤ +6 | alpha tween on phase flip only | ship |
| **5** | Dawn/dusk shadow skew | medium-high | 0 | 2 writes × actors | ship |
| **6** | Weather — **behaviour** (shelter, footprints) | high | 0 | reuses target-picking | ship |
| **7** | Weather — **particles** | medium | +1 emitter | ≤40 particles (existing system) | ship, first to cut |
| **8** | Flitters (butterflies / fireflies) | medium | +3 day / +5 night | 5 sine evaluations | ship, cuttable |
| **9** | Skybirds | low-medium | 0 (transient) | 1 lerp, ~6 s every ~90 s | ship, cuttable |
| **—** | Grass shivering as a Pip passes | low | **+~200** (every tuft becomes its own object) | per-tuft distance test | **CUT** |

The top two cost essentially nothing and are the two that actually change how the screen feels. That
is not a coincidence — they are *behaviour*, and behaviour is free because the actors already exist
and already tick.

## 4.2 Time of day

**Four anchors, continuously interpolated.** Four rather than three (three cannot express dawn *and*
dusk, and dusk is the best-looking moment in any cosy game) and rather than five (a placeholder-art
game cannot draw five distinguishable skies).

| Phase | Local hours | sky top | sky bottom | overlay tint | α | light |
|---|---|---|---|---|---:|---|
| **Dawn** | 05–08 | `#f6d2c4` | `#fdeede` | `#ffd9b0` | 0.10 | low, left, warm |
| **Day** | 08–17 | `#cfe8f7` *(shipped)* | `#eef7ea` *(shipped)* | — | 0.00 | high, right *(shipped)* |
| **Dusk** | 17–20 | `#e0b4c8` | `#ffe2c4` | `#ffb26e` | 0.14 | low, right, orange |
| **Night** | 20–05 | `#2f3b63` | `#55658f` | `#24304f` | **0.22** | moon, small, cool |

Day is **byte-identical to what ships today**, so the round can never make the default look worse.

### Where the hour comes from — the purity contract

`core/` never learns what time it is. The app layer already owns `Date` — 2C established the
precedent with `SET_DAY_OFFSET` (*"the app layer owns Date, spec §2 rule 2"*).

```
src/app/daylight.ts   (NEW, app layer)
  daylightAt(nowMs, dayOffsetMs) -> { phase, blend, tint, alpha, sunAngle }
    ← pure function of a NUMBER. No Date, no clock. Unit-testable in node.

src/app/main.ts
  every DAYLIGHT_SAMPLE_MS (1000): scene.setDaylight(daylightAt(appClock.now(), state.dayOffsetMs))
```

Two consequences that are acceptance criteria, not nice-to-haves:

- **The debug time slider moves the sky.** `appClock` is the `OffsetClock`; `skew()` shifts it; the
  next sample lands in a different phase. Dragging the slider from noon to midnight must visibly turn
  the Keep to night. This is the QA tool for the whole feature.
- **A mutation that replaces `appClock.now()` with `Date.now()` must fail a test.** The repo has
  been burned by clocks read directly; the guard is a `daylight.test.ts` that drives the whole ramp
  off a `FakeClock` composed under an `OffsetClock`.

### What actually changes

- **Sky** — the three shipped bands and the sun glow recolour along the ramp. `drawBackground()` is
  a full teardown-and-rebuild, so it is **not** called per sample; it is called only when the
  sampled tint moves more than `DAYLIGHT_REDRAW_EPSILON` (in practice every ~2 wall minutes).
- **Sun → moon** — the shipped `circle(w*0.78, gridTop*0.34, …)` becomes a position and colour on the
  ramp; at night it is a smaller, cooler disc with a soft ring.
- **One full-screen overlay** — a single `Graphics` above `world` and below the UI, whose `tint` and
  `alpha` change. Tinting *above* the world (rather than recolouring the ground) is what keeps the
  Pips and the ground shifting together, which is why the contrast argument below works.
- **Shadows** — `shadow.x` and `shadow.scale.x` skew with the sun's angle at dawn and dusk. This is
  the single cheapest thing that makes light read as *real* rather than as a filter.
- **Lanterns wake at dusk** — `cozy-lantern`, `lantern-row`, `wayhome-lantern`, `beacon`, `lampwell`
  (any item whose `icon.motif` is `lantern` or `flame`) gain a glow child that fades in over 8 s at
  the Day→Dusk flip and out at Dawn. **This is the best beat in the section** because the thing that
  notices the time is a thing the player built.
- **Pip behaviour** — at Night an Idle Pip is 3× likelier to pick "settle" over "walk", and blink
  intervals stretch ×1.6. At Dawn, the first idle after the flip is a stretch. Zero new objects; a
  branch in the existing wander/idle selection.

### The legibility guard (round 2E's lesson, applied before it bites)

Night is 0.22 alpha, capped in tuning, and the overlay sits **above both the ground and the Pips**,
so it multiplies both — contrast *ratios* are preserved almost exactly, which is what
`content/palette.test.ts` actually pins (body-vs-ground ≥ 1.95 / 1.76). The build stage must
nonetheless re-run that suite against the night-composited colours and report the worst pairing.
Pale-on-pale has bitten this project twice (`cloudwisp`/`snowcap` on Frostpip; the Album's collapsed
portraits). **If any pairing drops below the shipped floor, the alpha comes down — not the floor.**

And: no phase ever blocks, dims or delays any interaction. Night is a look.

## 4.3 Weather — mood only, and why that is not a cop-out

**Decision: weather has no mechanical effect of any kind (I4).** Three arguments, each sufficient on
its own:

1. **2C §0.4's isolation rule.** Weather that changed decay, restore, loot or egg odds would
   re-derive `balance.test.ts`'s central claim silently. The rule exists because that has happened.
2. **2H's shield one: no hidden risk, ever.** Weather that raised ailment risk would be risk the
   send-off card cannot state — and it would fire while the player was away, which is promise 2.
3. **The player cannot control it.** A cosy game must never make an uncontrollable thing cost
   something. Waiting for good weather to send a Pip out is a mechanic from a different genre.

The tempting exception — *"rain makes Pips cleaner"* — is refused: it is a `care.*` touch, it is
positive-only today and a balance dependency tomorrow, and it would make players *wait for rain*.

**Enforcement**: `src/app/weather.ts` lives in the app layer and a grep test asserts nothing under
`src/core/` imports it. Same shape as the existing purity greps.

### Derived, never stored — zero state, zero cursor

```ts
// Pure. Deterministic across reloads. Moves with the debug slider.
// Cosmetic randomness uses a render-local fixed seed (the repo rule —
// see render/keepScene.ts's jitter and render/particles.ts's module doc).
weatherAt(saveSeed, nowMs) =
  pick(WEATHER_WEIGHTS, fnv1a(`${saveSeed}|${floor(nowMs / WEATHER_WINDOW_MS)}`))
```

`WEATHER_WINDOW_MS` = 3 h. No `GameState` field, no RNG cursor, no migration, no save cost.

| Weather | weight | What it does | Cost |
|---|---:|---|---|
| **Clear** | 58 | nothing | 0 |
| **Overcast** | 22 | sky desaturates ~12%, sun glow α ×0.35 | 0 objects |
| **Rain** | 14 | 40 streak particles; **Pips path to the nearest shelter** (`arch`/`nest`/`bench` motifs, or a Bed) and idle there; a puddle sheen on the plot | 1 emitter |
| **Snow** | 4 | 30 slow drifting motes; **Pips leave a footprint** — one pooled ellipse, 400 ms fade | 1 emitter |
| **Petalfall** | 2 | 20 petals in `keepPalette.flowerPetals`; **Pips bat at one** (existing play idle) | 1 emitter |

The behaviour column is the point. *Pips running for the arch when it rains* is worth more than the
rain is, and it costs nothing because the shelter is chosen through the same target-picking branch
§4.4 adds anyway.

**Seasonal seam, deliberately not built:** 2C's `EVENTS` could later bias `WEATHER_WEIGHTS` for a
recurring window. `weatherAt` takes the weight table as a parameter so that is a one-line call-site
change later. Nothing consumes it this round.

## 4.4 Pip ↔ decoration — the highest-value item in the round

When an Idle Pip picks a wander target, it has `decorInterestChance` (**0.22**) to pick a **placed
item's tile** instead of a free tile. On arrival it plays a ~2 s interaction chosen by that item's
**`icon.motif`** — a field that already exists on all 45 catalogue items:

| motif | interaction |
|---|---|
| `droplet` | splash, two dust-blue particles |
| `nest` | curl up, one slow breath cycle |
| `leaf` | sniff, ears-forward lean |
| `lantern` / `flame` | sit and stare at it |
| `stone` | lean against it |
| `post` | scratch (the existing Play squash) |
| `bowl` / `basket` / `pot` / `bench` | rummage (the existing job-work loop) |
| `arch` | walk through it and pause on the far side |
| `chime` | nudge it; the chime rings (existing `sound(slotId)` hook) |
| `shell` / `snowflake` / `spark` | a small delighted hop |

**Sixteen motifs cover the entire catalogue with zero new content authoring**, and every future item
inherits an interaction the moment it is given an icon. This is the thing that retroactively pays off
round 2F's 45 build items: the answer to *"why did I build that"* becomes *"because someone sits on
it"*.

## 4.5 Pip ↔ Pip greetings

When two Idle actors come within `greetRadiusTiles` (1.4), both have been idle ≥ 1.5 s, and their
per-pair cooldown (60 s) has elapsed:

1. Both stop and **face each other** (one x-flip each).
2. One emits a mood-appropriate emote — a heart (Beaming), a note (Content), a puff (Grumpy), a
   single grey dot (Miserable) — through the pooled particle system.
3. **35% of the time one speaks**, from a **new `greeting` dialogue context**.
4. **Chaotic quirk**: 20% chance it emits the *wrong* emote entirely. That is the personality's whole
   contract (spec §4.2: *"occasionally 'helps' wrong"*) and it is funnier here than anywhere else it
   currently fires.

**Content cost, named because spec §3 makes under-writing dialogue a spec violation:** 5 personalities
× 8 lines = **40 new lines**, raising the shipped minimum from 240 to 280. This is in scope. If it
is cut, the feature ships mute (emote only) rather than shipping with four lines per personality —
`content/validate.ts`'s per-context minimum must be extended to cover `greeting` so a thin pool fails
the build rather than shipping.

Piplings get their own flavour for free: they already amble with shorter strides, so a Pipling
greeting an Adult reads as a small one bothering a big one without a line of code.

## 4.6 What ambience deliberately does NOT do

- **No notifications.** 2I's budget is `maxPerDay` 4 with a minimum gap; a visitor is not urgent, and
  2C §0.3 bans urgency surfaces as a category. A visitor may at most become a **suffix on a
  homecoming notification** (*"…and someone's at the Clover Ring"*) — and even that is out of scope
  this round, named as a seam. A buzz for a butterfly would be the worst notification in the game.
- **No sound beyond the existing slots.** The chime nudge reuses `sound(slotId)`. Music is the
  owner's (BACKLOG owner decisions, 2026-07-31) and is not touched.
- **No new dependency.** Everything is Pixi `Graphics`, the existing `TweenRunner`, the existing
  `ParticleSystem`, and `fnv1a`.

---

# 5. PERFORMANCE PLAN

## 5.1 The measured baseline

Taken against the real modules, in a real Chromium, on the shipped tree (`421dfe7`), by constructing
`createKeepScene(390, 844)` and syncing `buildPerfState()` — the exact spec §1 scenario:

```
Spec §1 scenario (5 animated Pips + 30 decorations)
  total display objects .......... 239
    Graphics ..................... 148
    Containers ....................91
    Text ........................... 0
  max scene-graph depth ............ 6

  by top-level layer:
    background ....................... 4
    gridOverlay ...................... 2
    world .......................... 189
    ghostLayer ....................... 1
    fxAbove (particles) ............. 41
    flash ............................ 1
```

And the unit cost of a Pip, which is what a visitor costs:

| Pip variant | objects | Graphics |
|---|---:|---:|
| plain, no accessory | 11 | 7 |
| patterned | 13 | 9 |
| patterned + accessory | 14 | 10 |
| shiny + patterned + accessory | **16** | 12 |

**Honest limitation, stated because §5 is worthless if it is theatre:** I could not obtain frame-rate
numbers in this pass. `?perf` reports `warming up…` in a backgrounded preview pane because
`requestAnimationFrame` is suspended there, so the ring buffer never fills. The object counts above
**are** measured; the fps numbers are the build stage's job (§5.3).

## 5.2 The per-feature cost table, against that 239-object denominator

| Feature | persistent Δ | transient Δ | per-frame work |
|---|---:|---:|---|
| Pip ↔ decoration interest | **0** | 0 | 1 branch per target pick (~1/3 s per actor) |
| Pip ↔ Pip greetings | **0** | ≤1 bubble, ≤1 burst | C(6,2) = 15 squared-distance tests/frame |
| Daylight overlay | +1 | 0 | 1 lerp/s; `drawBackground` on threshold only |
| Lantern glows | +1 per lantern-motif placement (≤6) | 0 | alpha tween on phase flip only |
| Shadow skew | 0 | 0 | 2 float writes × actors |
| Weather behaviour | 0 | 0 | shares the target-pick branch |
| Weather particles (rain, worst) | +1 emitter | ≤40 | existing integrator |
| Flitters | +3 day / **+5 night** | 0 | 5 sine evaluations |
| Skybird | 0 | +1 (~6 s per ~90 s) | 1 lerp |
| **Attraction sprites** (6 placed) | **+6 … +18** | 0 | stock ring redrawn on change only |
| **Visitors** (`maxConcurrent` 2, worst case shiny+accessory) | **+32** | ≤2 motif emitters | identical to a roster Pip |

**Worst realistic composite** (night + rain + 2 shiny visitors + 6 attractions + all ambience):
`+1 +6 +5 +1 +18 +32` = **+63 persistent → 302 objects, +26%**, plus ≤40 rain particles inside the
already-allocated 41-slot pool.

**+26% is over the +20% object-count target I would have liked**, and the two features responsible are
the two that must not be cut (visitors and attraction sprites — they are the round). So the object
count is treated as a **leading indicator, not the gate**. The gate is measured frame time.

## 5.3 The gate — measured, before and after, and the harness must include the new work

**Acceptance, under Chrome DevTools 4× CPU throttle on the §1 scenario:**

| Metric | Bar | Source |
|---|---|---|
| average fps | ≥ 58 | spec §1 "60 fps" |
| p95 frame time | ≤ 20 ms | derived from the same budget |
| frames > 50 ms | **0** | spec §1 "no frame-time spikes > 50 ms" |
| objects | ≤ 310 | this section |

**`?perf` must be extended, or this whole section is theatre.** Measuring ambience with a harness
that renders none of it is precisely the failure mode spec §16 v1.3 keeps naming. `src/app/perfState.ts`
gains a second scenario behind `?perf=ambience`:

- the existing 5 Pips + 30 decorations, **plus** 4 attractions and 2 visitors (one shiny,
  accessorised, on the `wide` silhouette — the most expensive Pip the game can draw),
- daylight forced to **Night**, weather forced to **Rain**, flitters at their night count.

`perfState.ts` is a pure module and `perfMode.ts` is dev-only (tree-shaken from production, pinned by
the `PERF_MODE_MARKER` grep), so both are safe to extend. The build stage reports **four numbers for
each of the two scenarios, before and after the round**, in `PROGRESS.md`. No numbers, no gate.

## 5.4 The cut order, named in advance

Cut from the bottom of §4.1's ranking, in this order, until the gate passes:

1. **Skybirds** — pure garnish.
2. **Flitters** — the night's fireflies are the prettiest thing to lose, and the first genuinely sad cut.
3. **Weather particles** — *keep the behaviour*. Pips running for the arch is 80% of the delight at
   0% of the particle cost; the rain streaks are the other 20%.
4. **Shadow skew** — cheap, but it is two writes × actors × frames and it is the only per-frame cost
   in the daylight feature.
5. **Lantern glows** — cut to an instant swap instead of an 8 s fade before cutting the glow itself.
6. **Daylight interpolation** — degrade to four discrete steps with a 400 ms cross-fade. The sky
   still changes; it just stops being continuous.

**Never cut:** Pip ↔ decoration interest, Pip ↔ Pip greetings, visitors, attraction sprites. The
first two are free and are the round's actual answer to *"the Keep looks like a diorama"*; the last
two are the feature.

---

# 6. THE TWO WOUNDS

## 6.1 Accessories — what is left, and it is not nothing

§0.1 and §0.2 establish: the round-2D fix stage built the right scheme and the shipped guard is too
weak to hold it. Three things remain, and the first is a live visual defect on the starter screen.

### 6.1.1 The anchor scheme — landmark-derived, silhouette-scaled, one table

The root cause of the residual collision is that **accessory shapes are authored in absolute pixels
while the body they hang on varies by 28% in height across five silhouettes.** A scarf that clears
the mouth by 2 px on a 98-px-tall Mosspip covers it by 2.8 px on a 70-px-tall Tidepip.

The fix is two numbers, not twelve reshapings.

**(a) Zones derive from LANDMARKS, not from hand-picked fractions of `bh`.** Move the table into
`render/pipGeometry.ts` — the pure, Pixi-free module that exists precisely so all three surfaces can
share one table:

```ts
/** Anchor-local landmarks (origin = crown, +y toward the feet).
 *  Every one is derived from the SAME literals resolvePipSprite draws
 *  with, so a change to the mouth or the eyes moves the zones too. */
export function bodyLandmarks(bh: number, eyeScale: number) {
  return {
    bodyTop:    2,                                  // the anchor sits 2px above it
    eyeRow:     bh * 0.42 + 2,
    eyeRadius:  9.5 * eyeScale,
    faceBottom: bh * 0.62 + 2 + 1.25,               // ← the MOUTH'S PAINTED LOWER EDGE
    feet:       bh,
  };
}

export const ACCESSORY_ZONE_PAD_PX = 2;

/** [top, bottom] of the band a slot may occupy, and the lateral band. */
export function accessoryZone(slot: AccessorySlot, bh: number, bw: number, eyeScale: number)
```

with the four zones defined as:

| slot | vertical band | lateral band |
|---|---|---|
| `crown` | `[-∞, eyeRow - eyeRadius - pad]`, bottom **≥ `bodyTop`** (touching, never floating) | centred, `|cx| ≤ 0.2·bw` |
| `neck` | `[faceBottom + pad, feet - pad]` | centred, `|cx| ≤ 0.2·bw` |
| `shoulder` | `[faceBottom + pad, feet - pad]` | flank, `|cx| > 0.25·bw` |
| `side` | `[eyeRow - eyeRadius, feet - pad]` | flank, `|cx| - halfWidth > eyeGap + eyeRadius` |

**(b) Accessories SCALE with their wearer.** One factor, applied to the whole `parts` list at the end
of `drawAccessory`, exactly the way `CROWN_TUCK_PX` is applied today:

```ts
const zone = accessoryZone(def.slot, bh, bw, eyeScale);
const zoneH = zone.bottom - zone.top;
const scale = Math.min(1, zoneH / naturalHeightOf(parts));   // shrink-only, never grow
for (const p of parts) { p.scale.set(scale); p.y = zone.top + p.y * scale; }
```

Shrink-only, mirroring `computeJitter`'s own safety argument (growth breaks the fixed 118×98 box;
shrinking cannot). Worked example, the worst case:

- `wide` (Tidepip), `bh` 67.1 → `faceBottom` 44.85, `feet` 67.1, pad 2 → **neck zone 18.25 px tall.**
- Scarf natural height = band 11 + gap 5 + tail 12 = **28 px** → `scale` = 0.65.
- New band top = 46.85, which is **2.0 px clear of the painted mouth** and the tail lands at 64.6,
  **2.5 px above the feet**.
- `round` (Mosspip), `bh` 93.1 → zone 28.2 px → `scale` = 1.0 (unchanged), band top 60.9 → …which is
  still the 0.10 px overlap. **So the pad must also apply to the tall silhouettes**: with the zone
  top at `faceBottom + 2` = 62.97 the band moves down 2.1 px and clears. Mosspip's scarf sits very
  slightly lower than today; nothing else moves.

**(c) The two DOM surfaces derive the same bands.** `pipGeometry.ts` exports the zone table as
percentages of portrait height:

```ts
export const ACCESSORY_ZONE_PCT: Record<AccessorySlot, { top: number; bottom: number }>
```

`ui/focusView.ts` and `ui/pipdex.ts` write it as a CSS custom property on the accessory node
(`--pk-acc-zone-top`), and each stylesheet positions its own independently-authored shapes inside
that band. **The three-implementations pattern is preserved** (each surface still authors its own
shapes — that is what `portraitPatterns.test.ts` guards); only the *band* becomes shared, which is
exactly what was already true for `AccessorySlot` and is the thing that was never enforced.

### 6.1.2 The guards — three, and each closes a hole a mutation walked through

1. **`spriteResolver.test.ts` — sweep all five silhouettes, not one.**
   `it.each(SILHOUETTES × ACCESSORY_IDS)`, plus a `guards against a vacuous suite` assertion that
   the silhouette list came from `SILHOUETTE_FRACTIONS` and has 5 entries. The current file's own
   convention (it already sweeps every species for the box check) makes this a two-line change; it
   simply was not applied to the body-part check.
2. **Test the mouth's PAINTED BAND, by rect overlap, not its control point by containment.**
   ```
   mouthRect = { x: [-7.25, 7.25], y: [0.60·bh + 0.75, 0.62·bh + 3.25] }
   eyeRect_L/R from (eyeGap, eyeRadius, eyeRow) × eyeScale
   assert: no accessory's painted bounds overlap either rect
   ```
   This is the assertion that would have caught the shipped defect. Its absence is why the defect
   shipped.
3. **`portraitPatterns.test.ts` — a DOM zone guard, which does not exist today.** Parse each
   `.pk-portrait-accessory--<id>` / `.pk-pipdex-accessory--<id>` rule's `top:` percentage out of the
   stylesheet and assert it lands inside `ACCESSORY_ZONE_PCT[slot]`. The suite currently proves that
   a rule *exists*, is *unique*, and is *mounted* — three good checks that all pass with the scarf
   drawn across the eyes. **A guard that never renders is not a guard** (§16 v1.7's own rule);
   applied to geometry, that means a guard that never measures is not a guard either.

### 6.1.3 And strike the stale BACKLOG entry

`docs/BACKLOG.md`'s "Accessory placement (round 2D)" bullet is rewritten to describe what §0.2
actually found, or removed. The neighbouring **"Jitter is near-invisible"** bullet is still live and
is **not** in this round's scope — but it is worth noting that §6.1.1's shrink-only scale factor and
the jitter's shrink-only body factor now compose, so a build agent touching one should read the
other's doc comment.

## 6.2 The Poultice Shelf and the three `longevity` placeables — verified, with the arithmetic

Already wired (§0.1). Since the brief asks for numbers that respect 2F's comfort knife-edge and 2H's
lifespan arithmetic, here is the verification rather than a proposal.

**`longevity` — the sum is right and the bible's own claim is now true.**

| Item | `longevity` |
|---|---:|
| Larder | 0.05 |
| Nest Warmer | 0.06 |
| Sun Bunks | 0.10 |
| **Sum** | **0.21** |
| `lifecycle.lifespan.buildingBonusMax` | 0.25 |

0.21 < 0.25, so the clamp is **reachable-but-unreached** — headroom for one future item without a
re-tune, which is the same shape 2F left for comfort. And the lifecycle bible's headline claim
resolves: **12.85 days × 1.21 = 15.55 ≈ "a devoted player's 15.6"**. Before the wiring the true
maximum was 12.85 and the bible was wrong; it is now right.

**`remedy` — power did not move, availability did.**

| Source | contract ↓ | cure ↑ |
|---|---:|---:|
| Poultice Shelf | 0.10 | 0.05 |
| Lodestone Cairn (craft-only, spammable) | 0.04 each | — |
| Herb Rail (craft-only, spammable) | — | 0.03 each |
| **Clamp `crafting.buildingRemedyMax`** | **0.15** | **0.06** |

The tighter building-sourced clamp (0.15 / 0.06) sits far below
`lifecycle.ailments.contractReductionMax` 0.60 and `cureBonusMax` 0.45, so papering the Keep in
Cairns is not immunity — which is exactly the failure `buildingRemedyMax` was created to prevent, and
it is doing its job.

**2F's comfort knife-edge is untouched and this round must keep it that way.** Declared comfort per
need against `comfortReductionMax` 0.25: hunger is at **exactly 1.00×** after 2F's Larder retune —
there is zero slack. `effects.balance.test.ts` bounds the declared budget at 1.6× the cap and floors
it at 1.0×. **Therefore no attraction may carry a `comfort` effect**, and all six ids join that
file's `NOT_COMFORT_STATIONS` list (§1.8 rule 6). An attraction is not a cushion.

---

# 7. RISKS, SCHEMA, VISIBILITY, TESTS

## 7.1 The save-schema change — ONE bump, v11 → v12

| Field | Shape | v12 backfill |
|---|---|---|
| `state.visitors` | `Readonly<Record<PlacementId, VisitorRecord>>` | `{}` |
| `state.attractionStock` | `Readonly<Record<PlacementId, number>>` | `{}` (absent ≡ 0) |
| `state.lastVisitorOutcome` | optional echo | `undefined ≡ null` |
| `rngState["visitors"]` | number | **no shape change** — `Record<string, number>`, absent ≡ 0 |
| `counters["visitor.visited"]`, `["visitor.fed"]`, `["visitor.welcomed"]`, `["attraction.restocked"]` | existing counter bag | absent ≡ 0 |

```ts
interface VisitorRecord {
  readonly placementId: PlacementId;
  readonly speciesId: string;
  readonly name: string;
  readonly genome: TraitGenome;
  /** Clock ms of the CURRENT (or most recent) visit. */
  readonly arrivedAt: number;
  /** Derived at schedule time and stored, the same way an expedition's
   *  completion is derived from `departureTime + duration`: presence is
   *  `now < leavesAt`, never a stored boolean. */
  readonly leavesAt: number;
  /** Forward-only, 0..welcomeTrust. Joins 2C §0.1's may-never-decrease table. */
  readonly trust: number;
  readonly fedThisVisit: boolean;
  readonly visits: number;
}
```

Plus `fixtures/v12.json` and the `MIGRATIONS[11]` step, per spec §8's day-one rule.

**Three things the migration must NOT do**, each with a fixture-backed deep-equal:

1. **Not grant stock or a visitor.** No attraction exists in a pre-v12 save; every backfill is empty.
2. **Not move any Album counter.** `pipdex` passes through untouched — the strongest possible
   statement of I1 is that even the migration cannot break it.
3. **Not lose anything.** `resources`, `inventory`, `keepsakes`, `eggPity`, `crafts`, `sanctuary`
   pass through byte-identical.

**Content-side schema notes** (not save schema, but coordinated in the same patch):

- `BuildingEffect` gains `attraction` → `BADGE_FOR_EFFECT_KIND` (exhaustive) and
  `ui/buildMode.ts`'s `describeEffect` (exhaustive) both need a case, or the build breaks. Good.
- `KeepUpgradeEffect`'s `"attraction"` arm is **deleted** (§1.1).
- `content/keep.ts` tier 6's `headline` and `unlocks` change.

## 7.2 A proposed §16 amendment (v1.8), for the owner

Two lines, both of which this round makes true and neither of which is currently written down:

- **§12's attraction seam is discharged.** The `KeepUpgradeEffect` no-op is deleted and the
  capability lives in `BuildingEffect`. Worth recording because the spec's own table still points at
  the old location.
- **§7.1 gains a fourth acquisition source: attractions** — with the standing rule that *an
  acquisition channel outside expeditions may never produce a species the player has not already
  caught*. That rule now covers breeding (v1.5), lineage eggs (v1.5) and attractions, and it is the
  single sentence that keeps the Album's meaning intact as acquisition channels multiply.

## 7.3 Interaction with every shipped system

| Round | System | Interaction | Verdict |
|---|---|---|---|
| 2A | decay retune, 16 h cap | nothing reads a rate or a restore (I2); the cap is *reused* for visit scheduling | **safe** |
| 2A | debug time slider | routes through catch-up, and now also drives the sky and the weather — a QA tool for both | **safe, and strengthened** |
| 2A | procedural sound | one existing slot reused (the chime nudge); no new slots | **safe** |
| 2B | six biomes, `eggSpecies` | read-only; the pools become the attraction affinity table | **safe, and reused** |
| 2B | deep trips never win on throughput | no trip number moves | **safe** |
| 2B | biome food/species exclusivity | snacks are *consumed*, never produced | **safe** |
| 2C | never punish absence | I3; the held-open rule; no urgency surface; trust forward-only | **safe by design** |
| 2C | egg pity | disjoint on inputs; byte-identical across a welcome (§2.2) | **safe, tested** |
| 2C | the Album is additive | I1 — a welcome cannot move a completion counter | **safe by partition** |
| 2C | events (`availableWindow`) | `weatherAt` takes its weight table as a parameter — a named seam, unused | **named seam** |
| 2C | copy lint | gains the §1.6 banned phrases | **tightened** |
| 2D | names may not collide | six new item names extend the forbidden set; **pool re-validation required** | **ACTION REQUIRED — §7.5** |
| 2D | per-individual jitter | a visitor is a full jittered Pip through the one resolver | **safe, reused** |
| 2E | portrait render regressions | §6.1's DOM zone guard is the check 2E's class of bug wanted | **strengthened** |
| 2F | comfort knife-edge (hunger at exactly 1.00×) | no attraction carries `comfort` (§6.2) | **safe, guarded** |
| 2F | `BADGE_FOR_EFFECT_KIND` exhaustive | widening the union is a compile break without a case | **planned** |
| 2F | tier headlines name real content | tier 6's new headline names the Clover Ring | **safe, tested** |
| 2F | Keep XP floors | this round only **adds** XP sources | **safe direction** |
| 2G | slim Keep strip, cast strip | the visitor chip is a dashed-ring variant at the strip's end; the daylight overlay must sit **below** the strip's z-rung (`layers.test.ts`) | **design constraint, §7.4** |
| 2H | the five promises | P5: `minActivePips` still refuses the last retirement; nothing here can empty a Keep | **safe** |
| 2H | third succession path | welcomes are the *weakest* of the three (level 1, no inheritance) on purpose (§1.7) | **complementary** |
| 2H | Quiet Keep | orthogonal — attractions have no risk surface at all | **safe** |
| 2H | lineage / breeding | untouched; a welcomed Pip is unrelated to everyone, which is the *new* thing it offers breeding | **complementary** |
| 2I | notifications | **nothing here notifies** (§4.6); a homecoming suffix is a named seam | **named seam** |
| 2J | crafting, lodestone scarcity | attractions take 27% of lodestone against crafting's 8–16/day — both fit, and lodestone stays the scarce one | **safe, §3.2** |
| 2J | `reachability.test.ts` data-driven | two new priced families join it | **a tightening** |
| 2J | `crafting.balance.test.ts` cure cadence | untouched (I2) | **safe** |

## 7.4 THE VISIBILITY TABLE

> §16 v1.3's standing rule, earned **nine** times: *"written to state" and "visible to the player" are
> separate acceptance criteria* — and v1.7 sharpened it: *"visible on one surface" is not "visible"*.
> Every row names **all** the surfaces.

| Mechanic | Where core applies it | Where the player SEES it (all surfaces) |
|---|---|---|
| **An attraction exists** | `placeables.ts` entry + `attraction` effect | **Build sheet card** (icon + `boot` badge + cost + flavour + generated effect copy *"Draws visitors from the Shore"*); **tier 6's `unlocks` list** and its **headline** in `content/keep.ts`; the **Keep scene** sprite (⚠️ its own drawn sprite — 2F shipped 21 items as brown crates and it made the whole ladder invisible) |
| **Its pool** | `visitorPool()` | the **Build card** and the **item card** name the species by name, with the Album tier of each (*"Tidepip ✓ · Cloudpip — not met"*) — §0.5 full disclosure |
| **Its pool is empty** | `visitorPool() === []` | the item card's warm line (*"Nobody from the Lanterngrotto knows the way here yet"*); the **Keep scene** draws it unlit |
| **Stock** | `state.attractionStock[id]` | `Feed 3/4` on the **item card**; the **Keep scene** (a full bowl vs an empty one, and a small ring on the sprite); the **Keep card's "Restock all"** button with its summed cost. **No badge, no toast, no notification** |
| **A restock** | `RESTOCK_ATTRACTION` | resource counters tick in the **Keep strip**; a small pour animation; the **`+N XP` chip** |
| **A visitor is present** | `state.visitors[id]`, `now < leavesAt` | the **Keep scene** (a real Pip, walking in from the edge, loitering at the attraction, with a motif drift); a **dashed-ring chip at the end of the cast strip** — the only roster list on screen 100% of the time; the **Visitor card** on tap |
| **Who they are** | `VisitorRecord.genome/name` | the Visitor card's **portrait, name, species, personality and home biome** — through the same resolver and DOM portrait path every roster Pip uses, so accessories, patterns, jitter and shininess all render |
| **Trust** | `VisitorRecord.trust` | **three pips** on the Visitor card, visible from visit one; the **Nook's "Someone who visits"** card row; the snack button's state |
| **A snack landed** | `FEED_VISITOR` | eating animation + munch particles + a **dialogue line** (the shipped care-action grammar); a trust pip fills with a small pop; the **`+N XP` chip** |
| **Ready to welcome** | `trust >= welcomeTrust` | the Visitor card's **"Ask them to stay"** button; the Nook row's state; a soft, non-pulsing glow on the visitor in the scene |
| **A welcome** | `WELCOME_VISITOR` | a **witnessed moment** — the visitor does the arrival wiggle every hatchling does, the cast strip's chip loses its dashed ring, a **Keep XP chip**, and a **Chronicle line** (*"Pipsqueak stopped visiting and started living here."*) |
| **The roster is full** | refusal | *"Pipsqueak would stay, when there's room."* on the Visitor card **plus** the Nook row; the secondary Long Meadow link. **Nothing expires** |
| **Visits while away** | catch-up | the **Doorstep** line (*"Busy morning. Four callers, and Pipsqueak stayed longest."*); the held-open visitor **actually standing there** when the sheet closes |
| **Time of day** | `app/daylight.ts` → `scene.setDaylight` | the **sky, the sun/moon, the ground light, every Pip's shadow**, the lanterns at dusk, and Pip behaviour at night. Also the **debug time slider** — dragging it must turn the Keep to night |
| **Weather** | `app/weatherAt` (derived) | the **sky**, the **particles**, and — the part that matters — **Pips running for the arch, leaving footprints, batting at petals** |
| **Ambient life** | scene-local | butterflies by day, **fireflies at night**, moths at dusk, the occasional bird |
| **Pips notice each other** | scene-local | two Pips stop, turn, emote, and sometimes **speak a `greeting` line** |
| **Pips notice what you built** | scene-local, keyed on `icon.motif` | a Pip **sits on the Warm Stones, splashes the Glow Pool, walks through the Driftwood Arch** — across all 45 catalogue items, automatically |

## 7.5 Test plan

**New, data-driven off the registries so future content is covered automatically:**

1. `core/attractions/attractions.test.ts` — cadence under `FakeClock`; the 16 h cap; charge burn;
   the held-open rule; `maxConcurrent`; zero rolls on an empty pool.
2. `core/attractions/album.test.ts` — **I1.** For 200 seeded states: `visitorPool ⊆ caught`;
   `formsSeen`/`formsCaught`/`variantsCaught` unchanged by every `WELCOME_VISITOR`; no `lineage`-rarity
   species can ever be produced.
3. `core/attractions/pity.test.ts` — **§2.2.** `eggPity` deep-equal across a welcome; the `"egg"` and
   `"genome"` cursors bit-identical whether or not attractions exist.
4. `core/attractions/absence.test.ts` — **I3.** Trust never decreases; no counter regresses; a 7-day
   absence yields exactly `floor(16/6)` scheduled visits per attraction and one materialised.
5. `app/daylight.test.ts` — the ramp under a `FakeClock` under an `OffsetClock`; a skew moves the
   phase; **the mutation `Date.now()` must fail**.
6. `app/weather.test.ts` — determinism across reloads; window boundaries; the weight distribution
   over 10 000 windows; **`core/` imports nothing from it** (a grep test).
7. `render/ambience.test.ts` — object-count budgets from §5.2, asserted as literals so a regression
   is a failing test rather than a slow game.
8. `content/greeting-dialogue` coverage inside `content/validate.ts` — ≥8 lines × 5 personalities.

**Existing suites that must be extended (all tightenings, none weakened):**

- `reachability.test.ts` — `pricedAttractionRestocks` + `pricedAttractionWelcomes`, plus the
  "covers every priced registry entry" count assertions.
- `effects.balance.test.ts` — the six attraction ids join `NOT_COMFORT_STATIONS`.
- `content/keep.test.ts` — tier 6's new headline and unlocks.
- `content/names.test.ts` — **⚠️ ACTION REQUIRED.** The six new display names extend the derived
  forbidden vocabulary; the 166-entry pool must be re-validated **in the same commit**. Checked at
  design time: `Hollow`, `Drift` and `Willow` are in the pool and are avoided. Nothing in the six
  proposed names collides — but the check is a test run, not a promise.
- `spriteResolver.test.ts` — §6.1.2 guards 1 and 2.
- `portraitPatterns.test.ts` — §6.1.2 guard 3.
- `retention.copy.test.ts` — the §1.6 banned phrases.
- `layers.test.ts` — the daylight overlay's rung and the Visitor card's rung.
- `save/migrate.test.ts` — the v12 fixture and the three must-nots.

## 7.6 Risks

1. **Restocking becomes the chore that ruins a cosy game.** *Mitigation:* one-tap Restock all; no
   nag of any kind; an empty attraction costs nothing. *Watch for at playtest:* if players describe
   restocking as "the thing I have to do", `stockMax` goes to 8 and the cost doubles — same
   economics, half the taps.
2. **The Keep gets visually crowded.** Six attractions plus two visitors plus weather plus flitters
   on a 375-px screen. *Mitigation:* `maxConcurrent` 2; the visual "not yours" treatment; §5.4's cut
   order. *Watch for:* whether a player can still find their own Pips at a glance.
3. **Night is too dark to play in.** *Mitigation:* α capped at 0.22; the contrast re-check in §4.2;
   no phase gates any interaction. *If it still reads badly:* the cap drops, never the contrast floor.
4. **Weather gets read as a mechanic.** Players are trained to assume weather matters. *Mitigation:*
   weather is never mentioned on any mechanical surface — not the send-off card, not the Build sheet,
   not the Doorstep — so there is nothing to infer from. *Watch for:* anyone reporting that they
   waited for clear skies.
5. **The `greeting` context ships thin.** 40 lines is real authoring. *Mitigation:* the validator
   minimum makes a thin pool a build failure; if the lines are not written, the feature ships mute
   rather than shipping bad.
6. **`perfState` drifts from the real scene.** The harness is a hand-built fixture. *Mitigation:*
   `perfState.test.ts` already validates ids against the real registries; extend it to the
   attractions and visitors.
7. **Attractions read as a gacha.** *Mitigation:* they are structurally the opposite — zero Album
   progress, no rarity roll, and the pool is printed on the card by name (§0.5). If a playtester uses
   the word "gacha", the card copy has failed, not the mechanic.
8. **Over-building drains wood at a rate the player did not intend.** *Mitigation:* the rate is on
   the card in words; removal is a full refund including charges.
9. **The visitor's "not yours" treatment is too subtle**, and a player taps a visitor expecting the
   focus view. *Mitigation:* the dashed cast-strip ring and the distinct card. *Watch for:* anyone
   trying to send a visitor on an expedition.
10. **Tier 6 becomes overstuffed** — Larder, Nest Warmer, faster eggs, 5-of-a-set, and now six
    attractions. *Accepted:* tier 7 is the thin one and this round declines to fix it, because the
    succession timing argument (§1.2) beats the ladder-tidiness argument. Noted for a future pass.

## 7.7 Implementation order

Sequential where state is shared; the two halves are independent after step 1.

1. **Content + tuning** — `tuning.attractions` (already drafted as a commented block), the six
   placeables, the `attraction` effect kind, the badge and `describeEffect` cases, tier 6's headline,
   the `KeepUpgradeEffect` deletion. *Green:* `content/*.test.ts`, `keep.test.ts`, `names.test.ts`,
   `reachability.test.ts`, `effects.balance.test.ts`.
2. **`core/attractions/`** — pool, schedule, charge burn, trust, welcome, catch-up integration
   alongside `collectJobCatchupEvents`. *Green:* the four new core suites; `balance.test.ts` and
   `effects.balance.test.ts` byte-identical.
3. **Schema v12** — the two records, the migration, `fixtures/v12.json`. *Green:* migrate suite.
4. **UI** — Visitor card, cast-strip chip, Nook row, Build/item cards, Doorstep line, Restock all.
   *Green:* `layers.test.ts`, `retention.copy.test.ts`.
5. **Render — visitors + attraction sprites.** The heaviest render work; do it before ambience so the
   perf budget is measured against the feature, not against garnish.
6. **`app/daylight.ts` + `app/weather.ts`** and their scene hooks. *Green:* the two new app suites.
7. **Ambience** in §4.1's ranked order — decoration interest, greetings, shadows, lanterns, weather
   behaviour, particles, flitters, birds. Stop when the §5.3 gate is at risk; cut per §5.4.
8. **§6.1's accessory zones** — independent of everything above; can run in parallel from step 1.
9. **Measure.** `?perf` and `?perf=ambience`, before/after, four numbers each, into `PROGRESS.md`.

## 7.8 Named seams this round deliberately does not build

- **A visitor suffix on the homecoming notification** (2I). Named, not built.
- **Seasonal weather bias** via 2C's `EVENTS`. `weatherAt` takes its weight table as a parameter;
  nothing passes a non-default one.
- **An attraction bounty** (*"welcome a visitor"*). `BOUNTY_TEMPLATES.requires.minKeepLevel` exists
  and would need to gate at ≥6. A good future addition; out of scope.
- **Visitor breeding preview** — a welcomed Pip is unrelated to your roster, which is genuinely
  interesting for `combineGenomes`. No UI surfaces that this round.
- **Indoor/outdoor** or any second Keep space that weather could differentiate. Not this round, not
  soon.

---

## 8. The one-paragraph version

Attractions are placeables you keep stocked with feed; while they have feed, a Pip **of a species you
already own**, from the biome that attraction is themed on, walks into the Keep every six rated hours
and stays for three quarters of an hour. Feed it the right snack on three separate visits and it will
stay if you ask — a third road back after a loss, deliberately the weakest of the three, and the only
one that brings you someone unrelated to everyone you have. Because the pool intersects with the
Album's caught set before a single roll is consumed, **attractions cannot advance the Album by one
page, ever** — that is a partition, not a tuning margin, and it is the same guarantee 2H gave
breeding. Feed is the first recurring sink in PipsKeep whose largest component is wood: 29/day at the
natural six-attraction build, 58.5% of the faucet 2J named as unsolvable, and more than 100% of it at
a twelve-attraction build a player would only make because they like the company. Around all of that,
the Keep learns to be a place: four interpolated times of day driven from the injected clock (so the
debug slider turns the sky), five weathers that are **purely mood and provably so**, fireflies at
night, and — the two cheapest and best things in the round — Pips that stop to greet each other and
Pips that sit on the furniture you built for them. And the scarf finally comes off the mouth on
Tidepip, which it has been on since round 2D, 2.76 measured pixels of a 2.5-pixel mouth, on the first
screen a new player ever sees.
