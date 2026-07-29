# PipsKeep — The Content Bible (Round 2B expansion)

**Status:** design, ready to implement. **Author:** content design.
**Implement exactly what is written here.** Where a number is given, it is the number; where a
line is written, it is the line. Where this document disagrees with taste, argue with me, not with
the registry.

---

## 0. The fence, and what it proved

The prime directive of this round: spec §3 promises that *adding a species, food, or expedition
never requires touching `core/`.* This expansion is the proof-of-work for that promise.

**Everything in sections 1–6 is authorable in `src/content/` plus new pattern/silhouette
primitives in `src/render/spriteResolver.ts`.** No `core/` file is edited. No save migration is
required (`schemaVersion` does not move — every addition is additive registry data, and nothing
persisted stores a species/food/expedition *shape*, only ids).

Three things I wanted and could **not** have without a `core/` change. I did not make those
changes. They are written up as findings in **§8**, with the exact minimal patch, and the design
below is built so that it ships and works *without* them:

| Want | Blocked by | Designed around it? |
|---|---|---|
| Eggs from a biome hatch that biome's species | `core/state.ts` `HATCH_EGG` throws away `egg.sourceExpeditionId` | **No.** This is the collection engine. Ships degraded without the patch — see §8.1 and §3.6. |
| A fifth resource (stone / glowsilk / etc.) | `RESOURCE_IDS` lives in `core/economy/index.ts` | **Yes.** Six biomes are differentiated with four resources + nine foods. |
| Keep levels 4–6, one per new biome | `KeepLevel = 1 \| 2 \| 3` in `core/keep/index.ts` | **Yes.** Six expeditions across three levels — each level now unlocks a **quick trip and a deep trip**, which turns out to be a better shape anyway. |

There is also a set of things that need `render/` or `ui/` edits *beyond* `spriteResolver.ts`.
Those are not §3 violations (§3 is about `core/`), but they are outside the fence this round drew,
so they are listed in **§8.2** as explicit permission requests. **Two of them are load-bearing:
without them, 15 new decorations all render as the same wooden crate, and evolution gift variants
remain invisible.**

### Vocabulary check (spec §0)

Every name below is a compound diminutive (`<noun>pip`) or a place name. Nothing in this document
uses "Pal", "-gotchi", "pocket monster", or any Pokémon/Palworld/Tamagotchi term, and no line of
flavor text does either. Eggs *pip*. Babies are *Piplings*. The habitat is *the Keep*.

---

## 1. Species — seven lines, fourteen forms

Seven base species, each with exactly one evolved form: **14 registry entries**. Mosspip and
Grovepip already exist and are **kept, not rewritten** — they get exactly two additive edits
(§1.4, §1.5) and one deliberate one-field fix (§1.6).

### 1.1 The set, and the axes it varies on

The set has to feel worth completing, which means each species must be identifiable at a glance
from **three independent readable axes**, not from its palette alone:

- **Biome affinity** — where you go to find it. This is the collection engine (§3.6).
- **Silhouette weight** — the shape inside the sprite box. Five silhouettes, five distinct reads at
  thumbnail size: `round`, `chunky`, `wide`, `tall`, `tiny`.
- **Temperament flavor** — a personality-*neutral* identity. **This is not a personality.** A
  Pebblepip can roll Chaotic; it is then a stubborn little rock that is also chaotic. Species
  flavor colours *how* a Pip looks and what it says on arrival (§6); personality drives decay,
  quirks and the whole 240-line dialogue corpus, and is orthogonal.

| Line | Base (rarity) | Evolved | Silhouette | Home biome(s) | Temperament flavor |
|---|---|---|---|---|---|
| Moss | **Mosspip** (common) | **Grovepip** | `round` → `round` | Meadow, Bramblewick, Forest | Steady, agreeable, smells of rain on warm stone |
| Stone | **Pebblepip** (common) | **Cairnpip** | `chunky` → `chunky` | Bramblewick, Forest | Stubborn, dependable, will not be moved (literally) |
| Tide | **Tidepip** (common) | **Reefpip** | `wide` → `wide` | Shore | Nosy, brings you things, most of them wet |
| Ember | **Emberpip** (uncommon) | **Hearthpip** | `tiny` → `round` | Lanterngrotto, Forest | Overexcited, warm to the touch, apologises for nothing |
| Snow | **Snowpip** (uncommon) | **Frostpip** | `round` → `round` | Snowdrift | Serene, and extremely smug about the cold |
| Cloud | **Cloudpip** (uncommon) | **Thunderpip** | `tall` → `tall` | Snowdrift, Meadow | Dreamy, drifts off mid-sentence, hiccups sparks |
| Lantern | **Lanternpip** (rare) | **Beaconpip** | `tiny` → `round` | Lanterngrotto | Shy, follows at a polite distance, the reason you can see |

Note the deliberate shape: **two lines change silhouette on evolution** (Ember `tiny→round`,
Lantern `tiny→round`) and five do not. Growing up should be legible without being uniform.

### 1.2 Rarity — and a bug this fixes

`tuning.eggs.rarityWeights` becomes:

```ts
rarityWeights: { common: 100, uncommon: 30, rare: 12, lineage: 0 }
```

and `Rarity` in `content/species.ts` gains a fourth member: `"lineage"`.

**Why:** today `grovepip` carries `rarity: "uncommon"`, and `rollGenome` weights the species roll
across the *whole registry* — so roughly **one egg in five currently hatches a fully-evolved
Grovepip**, which quietly undercuts the entire evolution feature. With 14 entries it would be one
egg in *three*. A zero-weight rarity tier removes evolved forms from the hatch pool without any
core change; `core/pips/genome.test.ts` already pins the mechanism ("weight 0 never hatches").

**Authoring rule:** every evolved form gets `rarity: "lineage"`. `uncommon`/`rare` stay meaningful
as *display* tiers for the Pipdex round.

**One float-edge caution:** `pickSpecies` falls back to `entries[entries.length - 1]` when the
random draw lands exactly on the weight total. Order the registry so **the last entry is a base
species, never a lineage one** — put all seven bases first, then all seven evolved forms. (This is
a ~2⁻⁵³ event; do it anyway, it costs nothing.)

### 1.3 Registry entries (base species)

Shape is the existing `SpeciesDef`, plus the one optional new field in §1.4.

```
pebblepip   name "Pebblepip"    rarity common     silhouette chunky
            palettes [flint, riverstone, sandstone]     patterns [plain, banded, speckled]
            accessorySlots 1
tidepip     name "Tidepip"      rarity common     silhouette wide
            palettes [cockle, sandbar, seafoam]         patterns [ripple, speckled, plain]
            accessorySlots 1
emberpip    name "Emberpip"     rarity uncommon   silhouette tiny
            palettes [cinder, hearthash, coalglow]      patterns [ember, plain, speckled]
            accessorySlots 1
snowpip     name "Snowpip"      rarity uncommon   silhouette round
            palettes [powder, hush, bluehour]           patterns [flake, plain, banded]
            accessorySlots 1
cloudpip    name "Cloudpip"     rarity uncommon   silhouette tall
            palettes [nimbus, dawnwash, duskveil]       patterns [puff, plain, ripple]
            accessorySlots 1
lanternpip  name "Lanternpip"   rarity rare       silhouette tiny
            palettes [deepwater, mossglow, embercave]   patterns [glowdot, plain, ripple]
            accessorySlots 1
```

Evolved forms carry the same `palettes`/`patterns` id lists (so a Pip keeps its birth variant ids
through evolution — the renderer reads `genome.palette` after the species flips), `rarity:
"lineage"`, `accessorySlots: 2`, and **no `evolution` field**:

```
cairnpip   "Cairnpip"    chunky | hearthpip "Hearthpip" round | frostpip  "Frostpip"  round
reefpip    "Reefpip"     wide   | thunderpip "Thunderpip" tall | beaconpip "Beaconpip" round
```

### 1.4 New optional field: `silhouette`

Add to `SpriteVariantParams` in `content/species.ts`:

```ts
/** Body shape inside the FIXED sprite box (spec §11). Optional — absent
 * means "round", so existing entries are untouched. */
silhouette?: "round" | "chunky" | "wide" | "tall" | "tiny";
```

Optional-with-default is what keeps the promise "keep Mosspip, do not rewrite it": mosspip and
grovepip get no edit here at all.

**The hard constraint on the render side.** `render/keepScene.ts` uses the module constants
`PIP_BODY_WIDTH` (118) and `PIP_BODY_HEIGHT` (98) for tap hit-testing, the selection ring, the
ground shadow and particle spawn boxes. Those constants are **not** per-species. Therefore:

> **Silhouettes vary the shape *inside* the 118 × 98 box. They never exceed it.**
> `headTopY` is already returned per-sprite and consumers use it, so a shorter Pip's speech bubble
> lands correctly for free. A *wider* one would break the tap target — hence the ceiling.

Multipliers to implement in `spriteResolver.ts` (`w`, `h` as fractions of the box):

| silhouette | w | h | notes |
|---|---|---|---|
| `round` | 1.00 | 1.00 | baseline — pixel-identical to today |
| `chunky` | 1.00 | 0.82 | lower corner radius, wider shadow; reads as *heavy* |
| `wide` | 1.00 | 0.72 | very low dome, flat base; reads as *limpet* |
| `tall` | 0.80 | 1.00 | narrower base, taller dome; reads as *wispy* |
| `tiny` | 0.78 | 0.76 | plus eyes at ×1.15 relative scale; reads as *baby-brained* |

`round` must be byte-for-byte the current drawing, so Mosspip does not change appearance.

### 1.5 Patterns — six new primitives

`patternKind()` in `spriteResolver.ts` currently maps `plain→none`, `speckled/dots→dots`,
`swirl→swirl`, and *everything else → stripes*. That fallback is why new pattern ids are safe but
boring. Add six:

| id | primitive | brief |
|---|---|---|
| `banded` | horizontal strata | 2–3 soft horizontal bands across the lower flank, like sedimentary rock. Pattern colour, 45% alpha. |
| `ripple` | concentric arcs | 3 nested arcs sweeping the flank, thin stroke, like a tide mark. 55% alpha. |
| `ember` | rising flecks | 7 small flecks scaled 3→1 rising up the flank, warm; the top two at 90% alpha with a 1px halo. |
| `flake` | crystal specks | 6 six-point star specks (three crossed strokes each), 60% alpha, one large + five small. |
| `puff` | scalloped lobes | 4 overlapping soft circles hugging the upper silhouette edge, 30% alpha — the body looks cloud-lobed. |
| `glowdot` | bioluminescent cluster | 5 dots in a loose arc, each with a 2× radius halo at 20% alpha in the **accent** colour, not the pattern colour. The one place the accent appears on the body. |

All masked to the body silhouette exactly as the existing overlays are. Keep `stripes` as the
unknown-id fallback: it is a working safety net and content validation still shouts.

### 1.6 The one edit to an existing entry

`grovepip.rarity: "uncommon"` → `"lineage"`. That is the whole diff to shipped species data, and it
is a bug fix (§1.2). Mosspip is not touched. Mosspip's palette entries are not touched.

### 1.7 Evolution lines and gift variants

Every base species evolves at the shipped thresholds (`tuning.evolution`: age ≥ 72 h **and**
lifetime average Happiness ≥ 70) and every one offers **three** outcomes: two gift-selected
variants plus a default. `giftVariants` keys are validated against the food registry, so every key
below is a real food id from §4.

| Species | → Target | `giftVariants` | `defaultVariantId` |
|---|---|---|---|
| mosspip | grovepip | `berry → berrybright`, `stew → heartymoss`, **`honeydrop → sunorchard`** *(new key, additive)* | `verdant` *(unchanged)* |
| pebblepip | cairnpip | `toastnut → mosscap`, `glowcap → veinlight` | `riverworn` |
| tidepip | reefpip | `tideroll → coralbloom`, `glowcap → pearlrim` | `seaglass` |
| emberpip | hearthpip | `emberloaf → bakestone`, `cocoabun → cinnamon` | `hearthlight` |
| snowpip | frostpip | `cocoabun → cocoadust`, `frostberry → berryfrost` | `windowfrost` |
| cloudpip | thunderpip | `honeydrop → sunshower`, `frostberry → hailhush` | `rainveil` |
| lanternpip | beaconpip | `glowcap → greenflame`, `feastpot → festival` | `harbourlight` |

Note the pleasing consequence: **the gift that shapes a Pip is usually a food from its own biome**
(Snowpip wants cocoa; Lanternpip wants a glowcap), so "what do I feed it to get *that* one" has a
findable answer. `feastpot → festival` is the deliberate exception: the rarest food, on the rarest
line, for the completionist.

> ⚠️ **These variants are currently invisible in game.** `pip.evolved.variantId` is stored by
> `applyEvolution` and read by *nobody* — `keepScene` composes the sprite from
> `{...pip.genome, speciesId: pip.speciesId}`. Two lines in `keepScene.ts` fix it. See §8.2.2. Ship
> the data regardless; it is correct and it is what the fix reads.

### 1.8 Palettes — soft pastels, one vibrant accent (spec §11)

Add one `SpeciesPaletteDef` per new species to `content/palette.ts`. Mosspip and Grovepip are
untouched.

`palette.test.ts` enforces: every registry species has an authored palette, every declared palette
id resolves, and **all variants of a species share exactly one accent**. Honour it.

**Derivation rule** (so this is mechanical, not 180 hand-picked hexes). For each variant, from the
`body` hex given below:

- `belly` = body lightened toward `#ffffff` by **55%**
- `pattern` = body darkened by **22%**
- `outline` = body darkened by **42%**
- `blush` = the species' fixed blush hex (per row)

Hand-tune afterwards if a variant reads muddy — the rule is a starting point, the pastel band is
the law. (Applied to the existing `mosspip/fern` body it lands within a few percent of the
hand-authored values, which is the calibration.)

| Species | accent (the one loud note) | blush | variant bodies |
|---|---|---|---|
| pebblepip | `#8ac926` lichen lime | `#eaa9ad` | flint `#c8c6bd` · riverstone `#b9c4cc` · sandstone `#d9c6ac` |
| cairnpip | `#ffd60a` tucked gold | `#e6a3a6` | flint `#b3b1a7` · riverstone `#a3b0ba` · sandstone `#c9b494` |
| tidepip | `#00b4d8` vivid cyan | `#f2b6bd` | cockle `#f0dcc4` · sandbar `#e8d3b3` · seafoam `#d6e8de` |
| reefpip | `#ff477e` coral pink | `#f0aeb6` | cockle `#e6cdb0` · sandbar `#dcc39f` · seafoam `#c2ddd1` |
| emberpip | `#ff5714` flame orange | `#f4b0a6` | cinder `#e8cdbd` · hearthash `#dcc4c0` · coalglow `#f0c9a8` |
| hearthpip | `#ff9505` hearth amber | `#eda99f` | cinder `#d9b8a4` · hearthash `#ccadaa` · coalglow `#e3b48d` |
| snowpip | `#e63946` holly red | `#f3bcc4` | powder `#f0f4f8` · hush `#e2eaf2` · bluehour `#d4e0ee` |
| frostpip | `#4cc9f0` ice cyan | `#eeb3bf` | powder `#e4edf5` · hush `#d2e0ec` · bluehour `#c0d4e8` |
| cloudpip | `#9d4edd` violet | `#f2bcc8` | nimbus `#f2eef8` · dawnwash `#f6e4ea` · duskveil `#e0dcee` |
| thunderpip | `#ffe74c` electric yellow | `#e9b0bf` | nimbus `#dcd6e6` · dawnwash `#e2cdd6` · duskveil `#c8c2d8` |
| lanternpip | `#9fff6b` glow green | `#e8a9b8` | deepwater `#9fb8c4` · mossglow `#a8c2ae` · embercave `#c2b0a4` |
| beaconpip | `#00f5d4` beacon turquoise | `#e2a3b4` | deepwater `#8aa6b6` · mossglow `#95b09d` · embercave `#b09c8e` |

Also add to `itemColors` in `content/palette.ts` (inventory chips + care-morsel particles):

```
honeydrop #f0b429   toastnut  #c98b45   frostberry #7fc7e8   cocoabun  #a9714b
glowcap   #8fe388   tideroll  #7ec4a8   emberloaf #d1743c    feastpot  #e0563f
```

---

## 2. Biomes — six expeditions, three tiers, two rhythms

### 2.1 The shape

Keep levels stay at **1 / 2 / 3** (see §8.1.3 for why, and why I now prefer it). Each level unlocks
a **pair**:

- a **quick trip** — the active-play loop. Best items per minute, best eggs per *hour*, the thing
  you tap between care actions.
- a **deep trip** — the idle loop. One per absence, sized so an overnight player gets exactly one
  completed run. Higher egg chance per trip, richer foods, and **the only source of its species**.

That pairing is what makes the deep trips worth a slot even though the Meadow out-farms them on
raw throughput: *you cannot get a Snowpip out of a Meadow.*

| Expedition | Keep level | Duration | Rolls | Egg | Identity |
|---|---|---|---|---|---|
| **Meadow** | 1 | 5 min | 3 | 8% | *(unchanged)* Everyday grass. Berries, twine, fallen twigs. |
| **Bramblewick** | 1 | 40 min | 9 | 25% | Hedgerow. Twine and honey. **No wood** (see §3.3). |
| **Forest** | 2 | 15 min | 6 | 12% | *(unchanged)* The timber tier. |
| **Snowdrift** | 2 | 60 min | 12 | 35% | Above the treeline. Cold snacks, thin pickings, fat egg odds. |
| **Shore** | 3 | 30 min | 6 | 18% | Shell and driftwood. *(one loot-table edit — §2.2)* |
| **Lanterngrotto** | 3 | 90 min | 14 | 50% | The glowing sea cave. Richest food and the rarest line. |

### 2.2 Loot tables (weights are relative; they need not sum to 100)

```
meadow         berry 40   fiber 35   wood 25                                  [UNCHANGED]
bramblewick    fiber 45   honeydrop 25   berry 20   toastnut 20
forest         wood 45    berry 30   fiber 15   stew 10                       [UNCHANGED]
snowdrift      frostberry 30   fiber 25   cocoabun 20   wood 15   stew 10
shore          shell 45   driftwood 30   tideroll 15   stew 10                [EDITED]
lanterngrotto  shell 25   driftwood 20   glowcap 20   emberloaf 15   wood 12   feastpot 2
```

**Meadow and Forest are byte-identical to today, on purpose.** They are load-bearing for four
pinned assertions (the 30–45 minute level-2 target, the Gathering-Station on-ramp ratio, the
Forest-beats-Meadow-on-wood pair, and the daily-berry ritual). Do not touch them in this round.

**Shore's one edit** trades `stew 20` for `stew 10 + tideroll 15` and `driftwood 35 → 30`, to give
the Shore a signature food. Verified safe: shell/minute is *unchanged* at 0.090, driftwood/minute
falls 0.070 → 0.060, and the roster upgrade still clears its 3-hour affordability check with a
4× margin (§3.4).

**Feastpot at weight 2** of 94 over 14 rolls = 0.30 per trip ≈ **one feast every ~3.4 grotto
trips**. That is the intended cadence for the game's best food: a thing that happens, not a thing
you plan around.

### 2.3 Flavor text

```
bramblewick    "A hedge with opinions. Twine, honey, and one thorn that will absolutely find you."
snowdrift      "Above the treeline everything is quiet, faintly ridiculous, and slightly frozen."
lanterngrotto  "A sea cave that glows on purpose. The rocks are warm. Nobody knows why. Nobody's complaining."
```

Meadow / Forest / Shore keep their shipped lines.

### 2.4 Piplings

`tuning.pipling.allowedExpeditionIds` stays `["meadow"]`. It is content, so this is a free choice —
but a Pipling's whole babyhood is 8 hours and a Bramblewick run is 40 minutes of it. The
supervised-short-trip idea reads best when there is exactly one supervised short trip.

---

## 3. The economy — every gated cost, with the arithmetic

**Every number in this section was computed against the real `rollExpeditionLoot` and the real
seeded RNG**, using the same analytic and simulation functions
`core/economy/reachability.test.ts` uses. Nothing here is a guess.

### 3.1 Income rates

Expected units per wall-clock minute, with every unlocked expedition run in parallel — one Pip
each, back to back. This is exactly the quantity `expectedMinutesToAfford` divides by.

| At Keep level | wood/min | fiber/min | shell/min | driftwood/min | berry/min |
|---|---|---|---|---|---|
| 1 (Meadow + Bramblewick) | **0.1500** | 0.3020 | — | — | 0.2809 |
| 2 (+ Forest, Snowdrift) | **0.3600** | 0.4120 | — | — | 0.4009 |
| 3 (+ Shore, Lanterngrotto) | 0.3799 | 0.4120 | **0.1314** | **0.0931** | 0.4009 |

### 3.2 Gated costs — the table the reachability test will check

| Priced thing | Cost | Payable at | Structurally reachable? | Expected minutes | Verified |
|---|---|---|---|---|---|
| Keep level 2 | `wood 5, fiber 6` | L1 | wood ✓ fiber ✓ (Meadow) | **33.33** | in `[15, 45]` ✓ |
| Keep level 3 | `wood 22, fiber 14` | L2 | wood ✓ fiber ✓ | **61.11** | escalates past 33.33 ✓ |
| Cozy Bunks (roster) | `wood 10, shell 8, driftwood 4` | L3 | all ✓ (Shore + Grotto) | 61.09 | 3 h afford rate **1.00** ✓ |
| Food Bowl | `wood 2` | L1 | ✓ | 13.33 | 3 h afford rate 1.00 ✓ |
| Bed | `wood 4, fiber 3` | L1 | ✓ | 26.67 | 3 h afford rate 1.00 ✓ |
| Gathering Station | `wood 3, fiber 2` | L1 | ✓ | **20.00** | ratio to L2 = **0.600** ≤ 0.7 ✓, ≤ 25 ✓ |
| **Stockpot** *(new)* | `wood 5, fiber 4` | L1 | ✓ | 33.33 | 3 h afford rate 1.00 ✓ |

Three-hour expected yields (the rate-reachability layer): **L1** `wood 27.0, fiber 52.5` · **L2**
`wood 64.8, fiber 72.3` · **L3** `wood 68.4, fiber 72.3, shell 23.6, driftwood 16.8`. Every priced
thing clears its cost by ≥ 2× and every seeded 200-session afford rate is **1.00** against a 0.95
bar. The 45-minute level-2 feel test lands at **0.845** against a 0.5 bar.

### 3.3 The rule that keeps this true — read this before adding anything

The Meadow is the **only** wood source at Keep level 1, and level 2's price and the Gathering
Station's price are both wood-bound. Two consequences:

1. **No new Keep-level-1 expedition may drop wood above 0.183/min**, or the level-2 target falls
   below its 15-minute floor. Bramblewick drops **zero** wood, which is why every shipped
   level-1 number in §3.2 is *identical to today's*. Keep it that way unless you are deliberately
   re-tuning level 2.
2. **No new level-1 expedition may push fiber above 0.400/min** (6 ÷ 0.4 = 15 min), or fiber
   becomes the binding resource and hits the same floor. Bramblewick lands fiber at 0.302, i.e.
   6 fiber in 19.9 minutes — comfortably behind wood's 33.3, which is what keeps wood binding.
   There is headroom, but not infinite headroom.

The Gathering-Station ratio is *structurally* safe — both it and level 2 are priced in the same
binding resource, so the ratio is pinned at 3/5 = 0.600 no matter what the wood rate is. Break that
(by pricing the station in something level 2 does not use) and the on-ramp test becomes fragile
again. Don't.

### 3.4 Placeables must be priced in level-1 resources. Full stop.

`reachability.test.ts` tags **every** placeable `payableAt: 1`, because spec §9 offers build mode
from the start and placeables carry no level gate. So:

> **New placeables may cost only `wood` and `fiber`.** A shell- or driftwood-priced station fails
> structural reachability at level 1 and there is no content-side way to gate it.

Decorations are exempt — they are checked only at max level, so they may cost anything (§5).

### 3.5 The casual on-ramp still exists

One capped 16-hour absence with a Pip on a Gathering Station is 96 ticks:
`berry 48, fiber 28.8, wood 19.2` — which still pays for Keep level 2 (`wood 5, fiber 6`) several
times over. Unchanged by this expansion. The new **Stockpot** (§5.3) is deliberately *more*
expensive than the Gathering Station in both resources, so a first-session player still buys the
station first and the on-ramp narrative survives.

### 3.6 The collection engine — which species live where

**This is the section that needs the §8.1.1 core patch.** Written as content now so the patch is a
two-line read, not a design exercise.

New optional field on `ExpeditionDef`:

```ts
/** Species this biome's eggs may hatch (ids into the species registry).
 * Absent = the whole registry, weighted by rarity (today's behaviour).
 * Weighting WITHIN the pool stays rarity-based — no new concept. */
eggSpecies?: readonly SpeciesId[];
```

| Expedition | `eggSpecies` | Resulting odds (rarity-weighted within pool) |
|---|---|---|
| meadow | `[mosspip, cloudpip]` | Mosspip 76.9% · Cloudpip 23.1% |
| bramblewick | `[mosspip, pebblepip]` | 50% · 50% |
| forest | `[mosspip, pebblepip, emberpip]` | 43.5% · 43.5% · 13.0% |
| snowdrift | `[snowpip, cloudpip]` | 50% · 50% |
| shore | `[tidepip, cloudpip]` | Tidepip 76.9% · Cloudpip 23.1% |
| lanterngrotto | `[emberpip, lanternpip]` | Emberpip 71.4% · **Lanternpip 28.6%** |

**Time-to-find, for a completionist who knows where to go** (expected engaged hours = trips ÷
(egg chance × pool share) × duration):

| Species | Best route | Expected engaged time | Overnight player (1 deep trip/night) |
|---|---|---|---|
| Mosspip | starter, or Meadow | — | — |
| Cloudpip | Meadow (23.1% × 8%) | ~4.5 h | also Snowdrift, ~6 nights |
| Tidepip | Shore (76.9% × 18%) | ~3.6 h | — |
| Pebblepip | Forest (43.5% × 12%) | ~4.8 h | Bramblewick, ~8 nights |
| Emberpip | Lanterngrotto (71.4% × 50%) | ~4.2 h | ~3 nights |
| Snowpip | Snowdrift (50% × 35%) | ~5.7 h | ~6 nights |
| **Lanternpip** | Lanterngrotto only (28.6% × 50%) | **~10.5 h** | ~7 nights |

Everything is a single afternoon of targeted play; the trophy species is two-and-a-bit. Deliberate:
the Meadow remains the best *egg farm per hour* (0.96 eggs/h vs the Grotto's 0.33), so the deep
biomes never win on rate — they win because they are **the only door**.

**If the §8.1.1 patch is declined:** drop `eggSpecies` entirely, ship everything else, and every
egg rolls the whole registry — Mosspip/Pebblepip/Tidepip 24.9% each, the uncommons 7.5% each,
Lanternpip 3.0%. It works, it is not broken, and the game loses the single best reason to run six
different biomes. I would fight for the patch.

---

## 4. Foods — nine of them, and the sizing rule they all answer

### 4.1 The rule, stated once with its arithmetic

Spec round-2A/2B invariant: **one care session must out-restore one full capped absence, for every
need and every personality.** For Hunger that means beating the worst-case window drop:

```
worst hunger drop = 3.8 /h  ×  1.15 (Hardworking)  ×  16 h  =  69.92
```

So the honest question for every food is *how many does it take to cover a day away?* — and
`core/pips/balance.test.ts` pins the answer for Berry (`2 × 45 = 90 > 69.92`) and Stew
(`75 > 69.92`). Nothing below weakens either; every new food is additive headroom.

(For completeness, the other three: Cleanliness and Energy are *set* by Clean and Rest so they
cannot fail; Happiness's worst case is Clingy at `3.6 × 1.25 × 16 = 72.0` against Play 45 + Pet 35
= 80. Foods that give Happiness are bonus, never load-bearing.)

### 4.2 The registry

| id | Name | Hunger | Side effects | To cover a day away | Where it drops | Role |
|---|---|---|---|---|---|---|
| `berry` | Berry | 45 | — | **2** | Meadow 40, Forest 30, Bramblewick 20, Gathering 50, Stockpot 40 | *(unchanged)* the staple |
| `stew` | Stew | 75 | +15 happy | **1** | Forest 10, Shore 10, Snowdrift 10 | *(unchanged)* the meal |
| `honeydrop` | Honeydrop | **10** | **+32 happy** | 7 *(don't)* | Bramblewick 25 | **the treat** |
| `toastnut` | Toastnut | 55 | +6 energy | 2 | Bramblewick 20, Stockpot 60 | the pocket snack |
| `frostberry` | Frostberry | 40 | +12 energy | 2 | Snowdrift 30 | the brisk one |
| `cocoabun` | Cocoa Bun | 60 | +18 happy | 2 | Snowdrift 20 | the comfort bake |
| `glowcap` | Glowcap | 35 | +20 happy | 2 | Lanterngrotto 20 | the odd little mushroom |
| `tideroll` | Tideroll | 60 | +5 energy | 2 | Shore 15 | the seaside lunch |
| `emberloaf` | Emberloaf | 90 | +10 happy | **1** | Lanterngrotto 15 | the hot dinner |
| `feastpot` | Feastpot | **100** | **+30 happy, +15 energy** | **1** | Lanterngrotto 2 | **the feast** |

**The treat (Honeydrop)** is deliberately a terrible meal and a wonderful moment: at 10 Hunger it
takes seven to feed a Pip for a day, so nobody will ever use it that way — but +32 Happiness is
more than a Pet, on a food that costs no cooldown. It is what you hand a grumpy Pip while the stew
is still 15 minutes away.

**The feast (Feastpot)** is the only item in the game that fills a whole bar and moves two others.
One drop every ~3.4 Grotto trips. It should get the loot-reveal showstopper treatment (§8.2.3) and
it is Lanternpip's evolution gift.

### 4.3 Two authoring traps that will bite you

1. **Every food needs an entry in `tuning.foods` as well as `content/foods.ts`.**
   `reachability.test.ts` validates loot-table item ids against
   `RESOURCE_IDS ∪ Object.keys(tuning.foods)` — *the tuning object, not the food registry.* A food
   that exists only in `foods.ts` will fail that assertion with a confusing message.
2. **`FOOD_IDS` is a const tuple** in `content/foods.ts` and `FoodId` derives from it. Extend the
   tuple; do not widen the type to `string`.

---

## 5. Decorations, placeables, and one new job

### 5.1 Decorations — twenty, of which fourteen are new

Costs use only the four real resources. Decorations are checked for reachability only at max Keep
level, so they may be priced in shell/driftwood freely. The "what it says" column is not flavour
text for the UI — it is the design brief, and the Pipdex/trophy round will lean on it.

| id | Name | Cost | Footprint | Flat? | What it says about the player who chose it |
|---|---|---|---|---|---|
| `pebble-path` | Pebble Path | `fiber 2` | 1×1 | ✓ | *(existing)* Tidy. Wants the Keep to have routes. |
| `moss-tuft` | Moss Tuft | `fiber 1` | 1×1 | | *(existing)* Filling a corner because a corner was empty. |
| `berry-planter` | Berry Planter | `wood 3, fiber 2` | 1×1 | | *(existing)* Practical, or pretending to be. |
| `cozy-lantern` | Cozy Lantern | `wood 2, fiber 2` | 1×1 | | *(existing)* Evening person. |
| `driftwood-arch` | Driftwood Arch | `driftwood 4` | 2×1 | | *(existing)* Has been to the Shore and wants you to know. |
| `shell-mosaic` | Shell Mosaic | `shell 5` | 2×2 | ✓ | *(existing)* Patient. Sorted the shells by size first. |
| `welcome-sign` | Welcome Sign | `wood 3, fiber 1` | 1×1 | | Hand-painted, slightly crooked, absolutely on purpose. This is a *home* now. |
| `toadstool-ring` | Toadstool Ring | `fiber 4, wood 1` | 2×2 | ✓ | Believes in a bit of nonsense. Pips detour through it. |
| `bramble-arch` | Bramble Arch | `fiber 8, wood 2` | 2×1 | | Went to the hedge and came back with an *entrance*. |
| `twine-swing` | Twine Swing | `wood 5, fiber 6` | 2×2 | | Building for the Pips, not for the screenshot. |
| `story-stump` | Story Stump | `wood 8` | 2×2 | | A gathering place. Expensive in one resource — a statement. |
| `sun-awning` | Sun Awning | `wood 6, fiber 7` | 3×2 | | Thinks about comfort. The biggest footprint in the game. |
| `cloud-kite` | Cloud Kite | `fiber 6, wood 2` | 1×1 | | Optimist. It is always aloft; there is never any wind. |
| `wind-chime` | Wind Chime | `shell 4, fiber 3` | 1×1 | | Likes the Keep to make a noise when nobody's doing anything. |
| `tide-basin` | Tide Basin | `shell 6, driftwood 3` | 2×2 | ✓ | Brought the Shore home. Tidepips will not leave it alone. |
| `driftwood-bench` | Driftwood Bench | `driftwood 5, fiber 2` | 2×1 | | Two seats. Sentimental about it. |
| `lantern-row` | Lantern Row | `wood 4, shell 2` | 3×1 | | Lights the path. Nobody asked. Everyone's glad. |
| `ember-brazier` | Ember Brazier | `wood 6, driftwood 4` | 1×1 | | Has been to the Grotto and came back warmer. |
| `wishing-cairn` | Wishing Cairn | `shell 3, driftwood 3` | 1×1 | | Three smooth stones, balanced. Superstitious in a nice way. |
| `mossy-fountain` | Mossy Fountain | `wood 6, fiber 4, shell 4` | 2×2 | | The centrepiece. Three resources, three tiers of play, one show-off. |

`spriteRef` follows the shipped convention: `deco/<id>`.

**Footprint sanity:** the Keep is 8×8 at level 1 and 8×12 at level 2. The 3×2 awning and the 3×1
lantern row fit at level 1 with room to spare.

### 5.2 A note on flat decorations

`isFlatItem()` in `render/placeableSprites.ts` decides which items Pips can walk over. Flat items
(`pebble-path`, `shell-mosaic`, and the new `toadstool-ring`, `tide-basin`) render under Pips and
never block wandering. Everything else is a solid obstacle — with 20 decorations available on an
8×12 grid it is now genuinely possible to wall a Pip in, which is an argument for keeping the flat
list generous. **Nothing enforces walkability today.** Flagged in §9.

### 5.3 One new placeable: the Stockpot

| id | Name | Cost | Footprint | spriteRef |
|---|---|---|---|---|
| `stockpot` | Stockpot | `wood 5, fiber 4` | 2×2 | `placeable/stockpot` |

Wood + fiber only, per §3.4. More expensive than the Gathering Station in *both* resources, per
§3.5.

### 5.4 One new job: Simmering

This is the §3 proof point I am most pleased with: `core/keep/jobs.ts` and `ui/focusView.ts` find
jobs by *scanning the job registry for a placement whose `itemId` hosts one*. A second job is
**pure content**.

```
jobs.simmering = {
  id: "simmering", name: "Simmering", stationItemId: "stockpot",
  intervalMs: 30 min, table: { berry: 40, toastnut: 60 }
}
```

- One capped 16-hour absence = 32 ticks → ~12.8 Berries + ~19.2 Toastnuts. Generous, but it costs
  a Pip's labour, and one Pip per station means staffing both stations consumes two thirds of a
  base roster.
- **Deliberately no Stew.** Stew must stay a Forest/Shore reward, because "unlocking Keep level 2
  visibly makes feeding easier" is a shipped round-2B promise and a Stockpot at level 1 would eat
  it.
- Add `tuning.jobs`-style numbers next to `tuning.gathering` so both cadences are visible in one
  place — the round-2B lesson about two prices that must stay in a relationship applies to two
  *rates* too.

The Gathering Station remains the materials faucet; the Stockpot is the pantry. Clean division.

---

## 6. Dialogue — five personalities, and no combinatorial explosion

### 6.1 The confirmation, with the arithmetic

**Personalities stay at five and the dialogue corpus does not grow.** `content/dialogue/` is keyed
`personality × context` — six contexts (four moods + Sulking + Refusal) × five personalities × 8
lines = **240 lines, unchanged by this expansion.** Species are not a dialogue axis and must never
become one:

```
today, after this round:     5 × 6 × 8   =    240 lines
if species keyed dialogue:  14 × 5 × 6 × 8 = 3,360 lines
```

`core/pips/dialogue.ts` picks from `pools[personalityId][context]` and never sees a species id.
Nothing in this expansion changes that. `findUnderfilledDialoguePools` keeps hard-failing
validation at 8 lines per pool.

### 6.2 Species flavor lines — the small, typed alternative

New file `content/speciesLines.ts`. **Exactly four lines per species, 14 species, 56 lines**, drawn
at the three moments where a species *is* the subject: **hatch**, **evolution**, and **first
meeting** (the first time a Pip of that species is opened in the focus view).

Deliberately moment-agnostic. Four lines that read correctly in all three moments beats twelve
lines that fragment the voice, and it keeps the authoring cost at one screen per species. Each line
is written as *the Keep noticing this Pip*.

```ts
/** Species flavor (spec §3 content-as-data). EXACTLY four lines per
 * species — the tuple type is the enforcement. Used at hatch, evolution
 * and first meeting; personality dialogue (dialogue/) is untouched by
 * species and must stay that way (240 lines, not 3,360). */
export type SpeciesLines = readonly [string, string, string, string];

export const SPECIES_LINE_COUNT = 4;

export const speciesLines: Readonly<Record<SpeciesId, SpeciesLines>> = { ... };

/** Deterministic pick — no RNG stream, no cursor, no save impact.
 * `key` is the pip id; the same Pip always greets you the same way. */
export function pickSpeciesLine(speciesId: SpeciesId, key: string): string | null;
```

Implementation notes for the author:

- The tuple type gives compile-time enforcement of "exactly four" — better than a runtime check.
- **No RNG.** A simple deterministic hash of the pip id modulo 4. Touching an RNG stream cursor
  from a presentation path is a determinism hazard (spec §2 rule 3), and there is no reason to.
- Add a `collectContentIssues` check: every species in the registry has a `speciesLines` entry, and
  every line is non-empty. Cheap, and it is the same class of guard as the dialogue-pool check.
- Return `null` for an unknown species so the three call sites can fall back to today's copy.

### 6.3 The 56 lines

**Mosspip**
1. Smells like rain on a warm stone. Immediately sits down.
2. Mosspip has decided this spot is the spot. It is not.
3. Hello! I brought moss. It's from your roof.
4. Wobbles once, settles, and sighs the sigh of a Pip who has arrived.

**Grovepip**
1. Taller now. Still puts moss in the soup.
2. Grovepip stretches, and something small nests in it immediately.
3. The Keep smells like a forest after rain. That's just Grovepip breathing.
4. Grew up. Kept the habit of napping in doorways.

**Pebblepip**
1. Landed with a clunk. Seems pleased about the clunk.
2. Pebblepip has chosen a favourite tile and will be defending it.
3. Heavier than it looks. Everything is heavier than Pebblepip looks.
4. Rolled here from somewhere. Declines to say where.

**Cairnpip**
1. Three stones tall and counting. Please don't count out loud.
2. Cairnpip stacks itself a little higher when it thinks you're impressed.
3. Marks the path home, and has never once been lost. Says so often.
4. Somehow taller. Somehow still napping.

**Tidepip**
1. Arrived damp. Has already found something to bring you.
2. Tidepip turns over a stone, gasps, and shows you a completely normal stone.
3. Smells of salt and enthusiasm.
4. Left a small puddle as a gift. The puddle is the gift.

**Reefpip**
1. Wearing a crown of coral it insists it grew itself.
2. Reefpip has upgraded from puddles to tide pools. Congratulations to everyone.
3. Every pocket is full of shells. Reefpip has no pockets.
4. Bigger, brighter, still absolutely soaking.

**Emberpip**
1. Warm! Warm warm warm. Sorry. Hello.
2. Emberpip vibrates at a frequency only snacks can hear.
3. Toasty little thing. Do not leave near the curtains.
4. Popped out of the shell already talking.

**Hearthpip**
1. Settled into a proper glow. Naps like a banked fire.
2. Hearthpip has claimed the warmest corner, and is now the warmest corner.
3. Still warm. Considerably more sensible about it.
4. Everyone drifts over. Nobody admits why.

**Snowpip**
1. Arrived cold and delighted about it.
2. Snowpip is unbothered. Snowpip has always been unbothered.
3. Leaves tiny frost prints and absolutely no apology.
4. Quietly the smuggest Pip in the Keep.

**Frostpip**
1. Has started drawing on the windows. The drawings are rude.
2. Frostpip breathes out and it snows a little. Indoors.
3. Colder. Calmer. Extremely pleased with itself.
4. Winter walked in wearing a very small hat.

**Cloudpip**
1. Drifted in through the door and forgot why.
2. Cloudpip is listening. Cloudpip is not listening.
3. Weighs approximately one idea.
4. Hovers a bit. Insists it isn't.

**Thunderpip**
1. Hiccups. Sparks. Apologises. Hiccups again.
2. Thunderpip rumbles when it's happy, which is alarming and lovely.
3. Distant weather, arrived in person.
4. Grew up moody in the most charming possible way.

**Lanternpip**
1. Glows. Hides. Glows again from a slightly worse hiding spot.
2. Lanternpip followed you home at a very polite distance.
3. The reason you can see anything down here.
4. Small, shy, and quietly the brightest thing in the Keep.

**Beaconpip**
1. Steady light now. You can see the Keep from the shore.
2. Beaconpip has stopped hiding and started guiding.
3. Everyone finds their way home. That's Beaconpip's whole deal.
4. Shy no longer — just quiet, and lit.

---

## 7. Implementation order (and what turns green when)

1. **`content/tuning.ts`** — `rarityWeights` (+ `lineage: 0`), the six `expeditions` entries, the
   ten `foods` entries, `placeableCosts.stockpot`, the Simmering cadence. *Do this first:* the
   reachability test reads item existence from `tuning.foods`, so everything downstream depends on
   it.
2. **`content/foods.ts`** — extend `FOOD_IDS`, add nine entries reading from tuning.
3. **`content/species.ts`** — `Rarity` gains `"lineage"`; `SpriteVariantParams` gains optional
   `silhouette`; twelve new entries; `grovepip.rarity` fix. Bases first, lineage last (§1.2).
4. **`content/palette.ts`** — twelve `SpeciesPaletteDef`s + eight `itemColors`.
5. **`content/expeditions.ts`** — extend `EXPEDITION_IDS`, three new entries, the one Shore edit,
   optional `eggSpecies` field + pools (harmless if §8.1.1 is declined; validation should still
   check the ids resolve).
6. **`content/decorations.ts`** — fourteen entries. **`content/placeables.ts`** — the Stockpot.
   **`content/jobs.ts`** — Simmering.
7. **`content/speciesLines.ts`** — new file, 56 lines, plus the validation hook.
8. **`render/spriteResolver.ts`** — six pattern primitives + five silhouettes.
9. Run `npm test`. `reachability.test.ts` and `balance.test.ts` are data-driven and will police all
   of the above without being edited. **If you find yourself editing either of those files, stop —
   the content is wrong, not the test.**

---

## 8. Findings — what I could not do inside the fence

### 8.1 §3 violations (a `core/` change would be required — NOT made)

#### 8.1.1 Biome-themed egg pools are not data-driven — *the headline finding*

`core/state.ts` `HATCH_EGG` (~line 731):

```ts
const genome = rollGenome(rng.stream(EGG_STREAM));
```

The egg carries `sourceExpeditionId` — it is created with it in
`core/expeditions/index.ts`, it is serialized, it survives reload — and the hatch path **drops it
on the floor**. Species selection is registry-wide, weighted only by rarity.

So spec §3's promise holds for *adding a species* (drop an entry in, it hatches) but **not for the
collection engine**: "species are found in themed places" is not expressible as data.

**Minimal patch (2 lines of behaviour, no contract change).** `rollGenome` already accepts an
injectable `GenomeRollContent` with a `species` registry, and it consumes exactly 5 rolls
regardless of registry size — so the RNG cursor contract (spec §2 rule 3) is untouched:

```ts
const pool = eggSpeciesPool(egg.sourceExpeditionId); // content lookup, undefined = whole registry
const genome = rollGenome(rng.stream(EGG_STREAM), pool ? { species: pool } : {});
```

where `eggSpeciesPool` filters `contentSpecies` by the expedition's new `eggSpecies` id list (§3.6).
Weighting inside the pool stays rarity-based — no new weighting concept, no new roll.

- **Save impact:** none. No schema change, no migration. A Pipping egg already in a save will hatch
  a *different* species than it would have (the cursor produces the same numbers; the pool maps
  them differently). Nothing is re-rolled or skipped; §2 rule 3 is intact.
- **If declined:** ship §3.6's tables anyway as inert data and accept registry-wide rolls (odds in
  §3.6's fallback paragraph). The game works; the six-biome structure loses its point.

#### 8.1.2 New resource types require a `core/` edit

`RESOURCE_IDS = ["fiber", "wood", "shell", "driftwood"]` is a const tuple in
`core/economy/index.ts`, and `ResourceBundle` derives from it. A fifth resource — *stone* for the
Bramblewick drystone walls, *glowsilk* for the Grotto — is a `core/` change.

**Designed around it**, and it cost something real: the Lanterngrotto has no resource of its own
and borrows the Shore's shell/driftwood, and the Bramblewick is deliberately wood-free. Both
identities land through **foods** instead, which works, but a sixth or seventh biome will run out
of room. Recommend widening this before the next content round: it is a one-line tuple edit plus
a `topBar` label, and `state.resources` is already `Record<string, number>`.

#### 8.1.3 Keep levels beyond 3 require a `core/` edit

`export type KeepLevel = 1 | 2 | 3;` in `core/keep/index.ts`. Every registry that gates on a level
(`ExpeditionDef.unlockKeepLevel`, `KeepLevelDef.level`, `KeepUpgradeDef.prerequisiteLevel`) imports
that union, so a sixth expedition on its own tier is impossible from content.

**Designed around it — and I now prefer the result.** Two expeditions per tier (a quick trip and a
deep trip, §2.1) is a stronger shape than six levels: it gives every tier both play rhythms
instead of alternating them, and it keeps `keepGrid.growthPerLevel` and the roster upgrade where
playtesting put them. **I am not asking for this one.** If a future round wants levels 4–5, note
that `KeepState.level` and `gridBounds()` are already `number` — only the exported union is
narrow.

#### 8.1.4 Per-expedition egg rarity is not data-driven

`settleExpeditionReturn` calls `createEgg({...})` without a `rarity`, so every egg in the game is
`tuning.eggs.expeditionEggRarity` (`"common"`, 2 h). `createEgg` and `resolveIncubationMs` both
*already* support per-rarity incubation — `tuning.eggs.incubationMsByRarity` exists and is empty —
so the only missing piece is passing an expedition-defined rarity at the call site.

I wanted deep-biome eggs to take longer and feel weightier ("a Grotto egg needs six hours"). Not
possible from content. **Designed around it**: deep biomes differentiate on *egg chance* and
*species pool* only. If §8.1.1 is approved, this is the same file, the same function, one extra
line — do them together or not at all.

### 8.2 Fence exceptions (`render/`/`ui/` beyond `spriteResolver.ts`)

These are not §3 violations. They are outside the boundary this round drew, and two of them are
load-bearing for shipping the content above.

#### 8.2.1 `render/placeableSprites.ts` — **required, or 15 items are identical crates**

`RESOLVERS` is a hand-written `itemId → DrawFn` map with a `drawFallbackCrate` default. Fourteen
new decorations and one new placeable need fourteen new draw functions, plus `isFlatItem`
registrations for `toadstool-ring` and `tide-basin`. Without this the expansion ships as
*15 wooden crates at 15 different prices*, which is a §11 failure and worse than shipping nothing.
This file is the decoration equivalent of `spriteResolver.ts` and I read the fence as an oversight
rather than a decision — but it is the owner's call, so: **requesting explicit permission.**

#### 8.2.2 `render/keepScene.ts` — 2 lines, or evolution gift variants stay invisible

Evolution's whole player-facing hook is "the last thing you fed it decides which form it becomes"
(spec §4.6). `applyEvolution` stores `pip.evolved.variantId` correctly. Nothing reads it:

- line ~615 composes the sprite as `{ ...pip.genome, speciesId: pip.speciesId }` — no variant;
- line ~646's sprite cache key is `id|stage|species|palette|pattern` — no variant, so two Pips of
  the same evolved species share a sprite regardless of what they were fed.

Fix: `resolvePipSprite(genome, stage, variantId?)` (inside `spriteResolver.ts`, which *is* in
scope) and two lines in `keepScene.ts` to pass `pip.evolved?.variantId` and add it to the key.
**21 gift variants are authored in §1.7 and none of them are visible without this.**

#### 8.2.3 `ui/lootReveal.ts` — new items need reveal tiers

`ITEM_REVEAL_TIERS` is a hard-coded map in `ui/`. Unlisted ids present as *common* — so the
Feastpot, the rarest and best item in the game, would flip past with no more ceremony than a twig.
Recommended: `feastpot: "rare"`; `emberloaf`, `glowcap`, `cocoabun` joined to the existing
`stew`/`driftwood` uncommons. **Better still:** move the tier onto `FoodDef` as
`revealTier?: "common" | "uncommon" | "rare"` and have the UI read content — that turns a
recurring `ui/` edit into a content field forever. Small change, permanent payoff.

#### 8.2.4 `ui/focusView.ts` — job copy is Gathering-flavoured

`buildJobRows` writes `"${pip.name} is gathering away"` and `"The basket can wait; the dream cannot"`
for *any* job. A Pip at the Stockpot will be described as gathering. Either add per-job copy to
`JobDef` (content, my preference — `verbing: "simmering"`, `idleNote: "..."`) or accept the wrong
noun for a round.

#### 8.2.5 Three call sites for species flavor lines

`ui/phase4.ts` (~line 147, the hatch toast), `ui/phase5.ts` (~line 411, `"Something wants to
change…"`), and the focus view's first-open. Each is a one-line
`pickSpeciesLine(pip.speciesId, pip.id) ?? <today's copy>`. Without them §6.3's 56 lines are dead
data.

---

## 9. Risks

**Balance & the restore rule**

1. **The Stockpot could trivialise Hunger.** 19 Toastnuts and 13 Berries per absence is a lot of
   pantry. It costs a Pip's labour and it is capped by the §4.5 rate cap, and round 2B deliberately
   made food abundant (the difficulty is taps and attention, not scarcity) — but this is the single
   number in the expansion most likely to need a nerf after playtest. Watch it. Lever:
   `intervalMs` up, or drop `toastnut`'s share.
2. **No test guards a *new* food's sizing.** `balance.test.ts` pins Berry and Stew by name. If
   someone later nerfs `berry.hunger` because "we have nine foods now", the leave-safe floor breaks
   and day 2 gets worse than day 1 again. **Recommend** extending the sizing assertion to *every*
   food: "no food restores less than `honeydrop`, and at least one food covers the worst window
   alone." Cheap, and it turns §4.1 into a guard instead of a paragraph.
3. **Happiness is now available from food.** Honeydrop (+32) and Feastpot (+30) exceed a Pet (+25).
   That is intended — a resource-limited alternative to a cooldown-limited action — but it does
   mean a player with a full satchel can skip Play. Acceptable; note it if playtesters report the
   care loop feeling optional.

**Reachability**

4. **The level-1 wood ceiling is the fragile invariant** (§3.3). It is not directly asserted —
   what *is* asserted is the 15-minute floor it protects. Anyone adding a level-1 expedition that
   drops wood will get a confusing failure in "expects to be affordable in 30–45 minutes". Consider
   adding a comment pointing at §3.3 in `tuning.expeditions`.
5. **Placeables have no level gate** (§3.4). The next person to design a station will reach for
   shells and fail structural reachability at level 1 with no content-side fix. The clean answer is
   `unlockKeepLevel` on `PlaceableDef` + a `payableAt` derived from it in the test — but the test
   lives in `core/`, so it is out of scope this round.
6. **Six expeditions and a three-Pip roster.** At level 3 there are six trails and three Pips.
   That is a real choice, and it is also the moment the roster upgrade (`3 → 5`) stops being
   optional. Watch that the upgrade's ~61-minute price doesn't read as a wall right when the
   content opens up.

**Collection**

7. **A collection game with nowhere to put the collection.** Seven lines × two stages = 14 forms,
   against a roster cap of 3 (5 upgraded). There is no release, no storage, and no record of what
   you have hatched — so today a completionist *cannot* complete anything, and hatching is blocked
   at cap by a friendly message. **This expansion is only half a feature without the Pipdex round.**
   The seen/caught record is the dependency; a way to move a Pip out of the active roster is the
   likely second half. Flagging it here because the content lands first and the gap will be
   immediately visible.
8. **Lanternpip at ~10.5 engaged hours** is the longest chase in the game by 2×. I believe that is
   right for a trophy, but it is the number to cut first if playtest says the set feels
   unfinishable. Lever: the Grotto's `eggChance`, or shrinking its pool to Lanternpip alone.

**Art & rendering**

9. **15 identical crates** if §8.2.1 is declined. This is the biggest single-shot quality risk in
   the round.
10. **Silhouettes must not exceed the sprite box** (§1.4) or tap targets desync from what is drawn
    — a bug that will present as "sometimes I can't tap my Pip" and be miserable to diagnose.
11. **Twenty decorations on an 8×12 grid can wall a Pip in.** Wandering has no walkability check.
    Not new, but this expansion makes it reachable. Mitigation for this round: keep the flat list
    generous (§5.2). Real fix: a reachability check in the placement validator, which is `core/`.

**Process**

12. **`tuning.foods` vs `content/foods.ts`** (§4.3) — the duplicate-registration trap will produce
    a confusing reachability failure. It is worth a comment in `foods.ts` pointing at it.
13. **Registry ordering matters** for the lineage-weight fix (§1.2's float-edge note).
14. **Nothing here changes the save schema.** If a reviewer proposes a migration, something has
    gone wrong — push back.
