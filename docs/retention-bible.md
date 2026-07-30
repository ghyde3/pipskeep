# PipsKeep — The Retention Bible (Round 2C)

> **The problem, in the owner's words:** *"this still begs the problem of why would anyone play
> this."* v1.0 has a great five-minute experience and no five-day experience. Nothing accumulates
> visibly, nothing is being chased, and today's session is indistinguishable from yesterday's.
>
> **The answer this round builds:** a collection worth completing, a place to keep it, a reason to
> come back tomorrow, and a reason not to feel bad when you don't.

This document is design only. It authors no registries and no feature code. The one file it edits is
`src/content/tuning.ts`, which now carries a fully-commented `tuning.retention` block — every number
below is already in the repo and cross-references this document.

Read alongside: `PIPSKEEP_SPEC.md` §0 (vocabulary), §4.4 (Pips never die, never punish), §12 (scope
fence), §16 (v1.1/v1.2/v1.3 amendments), and `docs/content-bible.md` §9 (the risk list that drives
this round — risk 7 is the structural problem §2 exists to solve).

---

## 0. The five invariants

Nine systems is a lot of surface area for a wholesome game to hurt someone on. Every design decision
below is downstream of these five, and each one is written so a test can hold it.

### 0.1 REWARD SHOWING UP, NEVER PUNISH ABSENCE

The orchestrator's guardrail, and it outranks every other line in this document. Operationally:

| Thing | May it ever decrease? |
|---|---|
| Album (Pipdex) entries | **No.** Once seen, always seen; once caught, always caught. |
| Milestones earned | **No.** |
| Counters (`state.counters`) | **No.** Monotonic non-decreasing, asserted by property test. |
| Expedition mastery trips | **No.** Not on retirement, not on absence, not on evolution. |
| Streak `longest` / `totalVisitDays` | **No.** |
| Resources, items, keepsakes, eggs, Pips | **No.** Nothing in this round removes any of them. |
| Egg pity counters | Only by **paying out** (a rare is guaranteed, counter resets to 0). |
| Streak `current` | Yes — on a gap past grace. |
| Streak **tier** (a loot bonus) | Yes — this is the *only* thing a break costs. |
| Streak `graceBanked` | Yes — spent, and it refills on its own. |

**A broken streak costs a bonus. Full stop.** Not an item, not a page, not a Pip, not a milestone.

### 0.2 Nothing is ever missable

Every event recurs annually and grants nothing exclusive (§8). Every reward that requires a player
choice (keepsake picks, the week basket's egg, a bounty reroll) **waits forever**, exactly like a
Pipping egg (§7.2 of the spec: eggs never expire). There is no claim window anywhere in this design.
Rewards that need no choice auto-bank the instant they're earned, so there is nothing to forget.

### 0.3 No urgency surfaces

Banned, as a category, in every new UI in this round:

- countdown timers on anything retention-related (bounty refresh, streak, event end);
- "your Pips missed you", "they've been waiting", or any second-person guilt;
- streak-loss shaming, "don't lose your streak", "streak at risk";
- "last chance", "expires in", "only N left";
- any offer to restore a streak (with resources, with an ad, with anything).

Enforced by a copy lint: `retention.copy.test.ts` asserts no player-facing string in the new content
registries matches `/missed you|don't lose|streak (lost|at risk)|hurry|last chance|expires? in|only \d+ (hours?|days?) left/i`.
Cheap, and it turns §15.5's tone paragraph into a guard.

### 0.4 Retention never touches the care economy

`tuning.retention` carries the **isolation rule** in its own doc comment: nothing in this round may
read or modify `needDecayPerHour`, `personalityDecayMultipliers`, `care.*`, `foods.*`,
`offlineRateCapMs`, `sulkExitThreshold`, or `playRefusal`. Round 2A/2B's entire balance rests on one
claim — *one care session out-restores one full capped absence, for every need and every
personality* (`core/pips/balance.test.ts`) — and a retention reward that makes care easier
re-derives that claim silently. Retention pays in **resources, items, decorations, and flair**. If a
proposed reward needs to make care cheaper, it is the wrong reward.

### 0.5 Full disclosure

Every probability the player is chasing is printed on the surface where they chase it: base odds per
biome pool, the pity counter and its threshold, the mastery bonus, the summed loot bonus and its cap.
A real gacha hides both the odds and the pity. Showing both is not a concession; it is the mechanic.

---

## 1. THE ALBUM (internal id: `pipdex`)

> **Naming — one owner call, flagged first because it touches §0 vocabulary.** The orchestrator's
> word for this system is *Pipdex*. It is not a trademark and it is fine as the **code identifier**
> (`state.pipdex`, `core/pipdex/`). But "-dex" is unmistakably Pokémon-flavoured, and §0's rule is
> about not *evoking* those games, not merely about avoiding their registered words. **Recommendation:
> the player-facing name is "the Album"** — a scrapbook of Pips you have met — with `pipdex` retained
> internally. All copy below uses "the Album". If the owner prefers Pipdex on the surface, it is a
> find-and-replace in one UI module.

### 1.1 Seen vs caught — three tiers, because biome pools leak knowledge

Biome egg pools (round 2B, bible §3.6) mean a player can legitimately know a species exists before
owning one: they have been to the Snowdrift, and the Snowdrift only ever hatches two things. The
Album models that honestly with three tiers:

| Tier | Earned when | What the page shows |
|---|---|---|
| **Blank page** | never encountered | nothing but the paper. The Album's cover reads "11 met, 3 pages still blank" — a count, never a teasing grey silhouette list. |
| **Field note** | the player has **completed at least one trip** to a biome whose egg pool contains this species | a silhouette (from `sprite.silhouette`), the home biome(s), the temperament flavour line, and the pool odds. No portrait, no first-caught date. |
| **Portrait** | the player has **owned one** — hatched, evolved into, or started with | the full scrapbook page (§1.3). |

Two derivation rules make this feel like knowledge rather than bookkeeping:

- **Trips, not unlocks.** Reaching Keep level 3 does not tell you what lives in the Grotto; *going
  there* does. `seen` is granted at the reveal-acknowledge moment of a completed trip, for every
  species in that expedition's `eggSpecies` pool.
- **Evolved forms are seen through their base.** Lineage forms carry weight 0 and can never be in a
  pool (v1.3 standing rule), so their Field note is unlocked by **catching the base species**:
  catch a Mosspip and Grovepip's page opens with "Mosspips who have been happy a long while are said
  to grow tall and quiet." That is the discovery of the evolution system, delivered by the
  collection system, and it costs nothing to build.

`caught` is set for the **live** `speciesId`, so evolving a Mosspip into a Grovepip catches Grovepip
(and the Mosspip page keeps its portrait forever — the record is of Pips you have met, not Pips you
currently hold). Retiring a Pip to the Long Meadow changes nothing in the Album; the record is
already permanent.

### 1.2 What completion actually IS

14 forms × shiny × 21 gift variants is a 300+ cell matrix. Presenting that as one percentage would
be both dispiriting and, for shiny, mathematically abusive. So there are **two declared targets and
one uncounted celebration**, and the UI's visual weight follows exactly that order:

| | Target | Size | Randomness | Est. time |
|---|---|---|---|---|
| **The Album** | **14 / 14 forms** | the headline number, shown on the cover | egg pools + pity | ~15 engaged hours, or ~3 weeks of one-deep-trip-a-night (bible §3.6) |
| **The Grove Ledger** | 21 / 21 gift variants (7 lines × 3 outcomes) | a second page, opened deliberately | **none** — pure care + patience | very long; 21 Pips raised to 72h at avg happiness ≥ 70 |
| **Glimmers** | *no denominator* | a corner stamp and a soft count: "3 glimmers found" | 2.5% per hatch | unbounded, celebrated, never a goal |

**Why shiny gets no denominator.** At `genome.shinyChance` 0.025, "14/14 shiny" is on the order of
tens of thousands of hatches. Printing `3/14` next to that is the textbook shape of a completionist
trap. The Album says *found*, never *of*.

**Why the Ledger is the long-haul target rather than the Album.** It has no RNG at all. A player who
wants a chase that rewards only showing up and being kind has one, and it cannot be short-circuited
by luck or lengthened by bad luck. That is the healthiest possible endgame for this game.

### 1.3 The page — scrapbook, not spreadsheet

Six deliberate choices, each of which is the difference between a scrapbook and a database view:

1. **Ordered by when you met them**, not by species id or rarity. The Album is a diary.
2. **Two pages per spread**, portrait-sized. Never a 14-cell grid — a grid is a checklist.
3. **The portrait is *your first one*.** A snapshot of that individual's genome (palette, pattern,
   shiny) is frozen into the entry at catch time, so the page shows *Mossy*, not a generic Mosspip.
4. **Its name and its personality.** "Mossy — a Clingy one."
5. **A hand-written found-line, generated from what actually happened**: `"came home from the
   Lanterngrotto in an egg the size of a plum — 14 March"`. Assembled from the source expedition,
   the day, and the life-stage at catch. Never `foundIn: ["lanterngrotto"]`.
6. **The species' own voice**, via the existing 56-line corpus in `content/speciesLines.ts` (bible
   §6.2) — the third and best home for those lines after the hatch toast and the first-meeting.

Evolution appears as a **ribbon across the bottom of the base species' page**: three leaves, filled
in as each gift variant is witnessed, each leaf captioned with the food that caused it
(`honeydrop → sunorchard`). This is where the Grove Ledger lives — per-line, so it never reads as
"you are 4/21 of the way through a job".

### 1.4 Data shape

```ts
// core/pipdex/types.ts
export interface PipdexEntry {
  readonly speciesId: string;
  /** First moment this form became a Field note. Null = blank page. */
  readonly seenAt: number | null;
  /** First moment one was owned. Null = never caught. */
  readonly caughtAt: number | null;
  /** Lifetime count of this form acquired (hatched/evolved/started). Monotonic. */
  readonly caughtCount: number;
  /** Frozen snapshot of the FIRST one, for the portrait (§1.3.3). */
  readonly firstPortrait: {
    readonly pipId: PipId;
    readonly name: string;
    readonly genome: TraitGenome;
    readonly personalityId: string;
    readonly lifeStageAtCatch: LifeStage;
    /** Expedition the egg came from; null for the starter or a debug egg. */
    readonly sourceExpeditionId: string | null;
  } | null;
  /** First moment a shiny of this form was caught (the corner stamp). */
  readonly shinyCaughtAt: number | null;
  /** Evolution variant id → first witnessed timestamp (the ribbon leaves). */
  readonly variantsCaught: Readonly<Record<string, number>>;
  /** Expedition ids whose pools this form is known to be in (accumulates). */
  readonly knownBiomes: readonly string[];
}

export interface PipdexState {
  readonly entries: Readonly<Record<string, PipdexEntry>>;
  /** Display order = order first seen. Forward-only append. */
  readonly discoveryOrder: readonly string[];
  /** Forward-only totals, so the cover needs no O(n) recount per render. */
  readonly formsSeen: number;
  readonly formsCaught: number;
  readonly variantsCaught: number;
  readonly shiniesCaught: number;
  /** Ids the player has not yet opened since they changed — the "new" dot. */
  readonly unreadEntryIds: readonly string[];
}
```

Every write is additive. There is no code path that clears an entry, and `pipdex.test.ts` asserts it
by running a long randomised action sequence and checking every scalar total is non-decreasing at
every step.

### 1.5 Anti-dark-pattern justification

- Completion is **bounded and routed**: every one of the 14 has a named best route with a published
  expected time (bible §3.6), and §7's pity makes the worst case finite.
- The one **unbounded** axis (shiny) is deliberately denied a denominator.
- The one **luck-free** axis (the Ledger) is the long-haul target, so the player with patience and
  no luck still has an endgame.
- **No cost to view.** No page is gated behind a purchase, a level, or a streak.
- Nothing in the Album can be lost, so opening it after two weeks away is purely a pleasure.

---

## 2. THE LONG MEADOW (the sanctuary)

> This is the load-bearing system of the round. Content bible §9 risk 7: *"A collection game with
> nowhere to put the collection… today a completionist cannot complete anything."* 14 forms against
> a roster cap of 3 (5 upgraded), with no release and no storage, means a completionist would have
> to delete Pips — which collides head-on with §4.4.

### 2.1 The fiction, and why the fiction is the spec

**The Long Meadow** is a wide green place over the hill where Pips go to help out. It is not
storage, not a box, not a farm. Residents have jobs they are proud of and are pleased to see you.

- The verb pair is **"Send to the Long Meadow"** and **"Ask them home"**. Never *release*, *store*,
  *deposit*, *retire from service*, *archive*, and absolutely never *delete*.
- The confirm copy says what is true: *"Mossy will be helping out at the Long Meadow. Same name,
  same freckles, same everything — and you can ask her home whenever you like. The clock stops while
  she's there: nothing is lost and nothing sneaks ahead."*
- There is no "are you sure? this cannot be undone" dialog, because it can be undone.
- The Long Meadow has its own **visitable page** with a portrait card per resident, their name, how
  long they have been there, what they have been up to (a warm line drawn from personality + a
  seeded flavour pick), and their mastery titles. It is a nice place to look at.

Vocabulary check (§0): "Long Meadow", "sanctuary", "resident" are all clean. Note the deliberate
avoidance of collision with the **Meadow** expedition — the two are distinct in copy ("the Meadow"
is a five-minute trip; "the Long Meadow" is over the hill and you don't send anyone on a trip
there). If the owner finds that too close, `The Long Hollow` is the fallback name.

### 2.2 Capacity: unlimited, permanently

Not "generous". **Unlimited**, and it is a hard rule in the same class as "Pips never die":

> A capped sanctuary recreates the exact problem the sanctuary exists to solve. At cap, the
> completionist is once again choosing which Pip to destroy.

The cost is trivially affordable: a serialized `PipState` is ~450 bytes, so 100 residents is ~45 KB
of IndexedDB and ~15 ms of extra boot validation. At an absurd 1000 residents it is ~450 KB and
still under 50 ms. `tuning.retention.sanctuary.capacity` is `null`, and `sanctuary.test.ts` asserts
that no code path reads it as a limit.

### 2.3 Retire flow

**Legality** (mirrors care-action legality, spec §4.7):

| Pip state | Retire? |
|---|---|
| Idle | yes |
| Resting | yes (they nap on the way) |
| **Sulking** | **yes** — see below, this matters |
| AssignedJob | yes, and the job is auto-unassigned (mirrors `REMOVE_ITEM`'s behaviour) |
| OnExpedition / Returning | **refused** (`busy`) — there is loot in flight and a reveal owed |
| the last active Pip | **refused** (`lastPip`) — "Someone has to hold the fort." |

**Retiring a Sulking Pip is legal, and the copy must never let it read as disposal.** A player whose
Pip is having a bad week should be able to give it a change of scene. The refusal list above is
structural, never moral.

**What happens on arrival:**

1. Needs snap **once** to `sanctuary.arrivalNeeds` = `{ hunger: 80, cleanliness: 80, happiness: 80,
   energy: 100 }`, then never change again (§2.4).
2. Because all four clear `sulkExitThreshold` (25) by a wide margin, a Sulking resident stops
   sulking through the **ordinary §4.4 exit rule** — `evaluateSulk` handles it, no special case.
3. `activity` is set to `Idle`, `expedition` to `null`, `pendingSulk` to `false`.
4. `ageMs`, `happinessIntegral`, `readyToEvolve`, `evolved`, `lastGiftItemId`, `genome`, `name`, and
   **mastery** are carried over byte-for-byte. Nothing is recomputed and nothing is dropped.
5. If the retiree was `activePipId`, it repoints to the first remaining roster Pip. **Invariant:
   `activePipId ∈ rosterOrder`, always.**

**Why 80 and not 100:** Beaming is what the player's own care earns. The sanctuary is comfortable,
not better than home. **Why 80 and not "frozen as-was":** storing a Pip must never preserve misery.
A sanctuary page showing a frozen Pip at 3 Hunger forever would be punishment by storage, and
punishment by storage is still punishment.

### 2.4 What a retired Pip's needs do: nothing, forever

Retired Pips are **removed from the decay loop entirely** — excluded from `TICK`'s per-pip pass and
from `CATCHUP`'s segmentation. Their needs are a constant. This is the direct answer to the brief's
question, and there are three defensible options; here is why this one:

| Option | Verdict |
|---|---|
| (a) keep decaying | **Rejected.** Punishment by storage. Violates §4.4 and the round's guardrail outright. |
| (b) freeze at retire-time values | **Rejected.** Cold, and it makes the sanctuary page a gallery of frozen sad faces. |
| (c) snap to content, then hold | **Chosen.** The caretakers look after them. Honest, warm, and cheap. |

**And `ageMs` / `happinessIntegral` freeze too.** This is the subtle one and it is not optional:
evolution readiness is `ageMs ≥ 72h AND happinessIntegral / ageMs ≥ 70`. If retired time accrued age
at a constant happiness of 80, the Long Meadow would become the **optimal way to evolve** — park a
Pip for three days, come home to a ready-to-evolve Pip you never cared for. That hollows out the one
thing v1.3 made a standing rule: *evolution must be earned.*

So: **time in the Long Meadow is time off the clock.** Neither forward nor back. Note that this is
not a penalty in disguise, and it is worth stating in the confirm copy because it is genuinely
even-handed: a Pip left *active* through a three-day absence accrues 72h of age at a happiness that
returns around 25, which **tanks** its lifetime average and pushes evolution further away. Freezing
is often the kinder outcome. It is honestly neutral, which is exactly what it should be.

`readyToEvolve` **persists** if it was already set. The sanctuary card shows "glowing — ask her home
to see it", because evolution is a witnessed in-world moment (§4.6) and the Keep is where it happens.

### 2.5 Retrieve flow ("Ask them home")

- **Free.** No resource cost, ever. Charging to retrieve makes storage a tax and the collection
  pay-to-view.
- Requires roster space under the current cap (3, or 5 with the upgrade). At cap: a friendly refusal
  in the same voice as the hatch refusal, with the obvious suggestion ("the Keep's full and cosy —
  swap someone out and she'll be along").
- The Pip returns to the **back of `rosterOrder`**, at its arrival needs (80/80/80/100), Idle. One
  care round makes it Beaming — the homecoming is a warm moment, not a repair job.
- `visits` increments on the record (scrapbook flavour: "home for the third time").

**The one limit: `minStayMs` = 8 hours.** A resident settles in for one overnight before they can be
asked home. This exists for exactly one reason:

> Without it, "retire → ask home" is a free full heal, and the Long Meadow becomes a spa that routes
> around the care loop — the one thing §4.4's floor and round 2A's restore arithmetic must not be
> bypassed. With it, a spa round trip costs a night, so nobody will ever use it as one.

8h specifically: it matches `pipling.durationMs` (the game's existing "one overnight" unit) and sits
inside `offlineRateCapMs` (16h), so a stay always completes within one rated absence. **It is not a
countdown** — waiting costs nothing, missing the moment costs nothing, and the card says "home
tomorrow morning" in words, never as a ticking clock (§0.3).

Beyond that: **no cooldown on retiring, no limit on how often, no daily cap.** Rotate the roster
daily if you like.

### 2.6 Data shape and the one-place invariant

```ts
export interface SanctuaryRecord {
  /** The whole Pip, verbatim. Nothing is ever dropped or summarised. */
  readonly pip: PipState;
  readonly retiredAt: number;
  /** Flavour: "she left when the Keep was still one small field." */
  readonly retiredFromKeepLevel: number;
  /** Times asked home (forward-only). */
  readonly visits: number;
}

// GameState
readonly sanctuary: {
  readonly pips: Readonly<Record<PipId, SanctuaryRecord>>;
  /** Stable display order = order of arrival. */
  readonly order: readonly PipId[];
};
```

**THE INVARIANT, and it is the one to test hardest:** every `PipId` the game has ever minted exists
in **exactly one** of `state.pips` (with a matching `rosterOrder` entry) or `state.sanctuary.pips`.
Never both, never neither. `nextPipNumber` never rewinds, so ids are unique for the life of the save.
`sanctuary.test.ts` asserts this after every action in a randomised sequence — including
retire/retrieve interleaved with hatch, evolve, catch-up, and save/reload.

### 2.7 The roster-cap message changes

`ROSTER_FULL_MESSAGE` currently nudges toward the roster upgrade. It now nudges toward the Long
Meadow first, because that is the answer available at every Keep level:

> *"The Keep is full and cosy. Send someone to the Long Meadow to make room — they'll be fine, they'll
> be delighted, and you can ask them back any time. Your egg will wait as long as it likes."*

The egg still never expires and is still never lost. `ROSTER_FULL_MAX_MESSAGE` (post-upgrade) gets
the same sanctuary pointer.

### 2.8 Anti-dark-pattern justification

Nothing is deleted, nothing is capped, nothing is charged, nothing decays while stored, nothing is
lost on retrieval, and the only limit is a settling-in night that closes a care-trivialising
exploit rather than gating content. The system's *only* cost to the player is a tap.

---

## 3. THE DAILY STREAK

### 3.1 The day

`dayIndex(at) = floor((at - dayOffsetMs) / DAY_MS)` where `dayOffsetMs` combines the player's
timezone offset with `retention.dayStartHour` = **04:00 local**.

- 04:00 rather than midnight because a 1 a.m. session belongs to the night owl's *previous* day.
  Losing a streak to insomnia is precisely the punishment this round forbids.
- `dayOffsetMs` lives in `GameState`, set at boot by a `SET_DAY_OFFSET { offsetMs }` action. The app
  layer computes it via a **new `localDayOffsetMs(dayStartHour)` export in `core/clock.ts`** — the
  only file permitted to touch `Date` (spec §2 rule 2). This is the round's single purity-adjacent
  addition and it belongs exactly there: asking "what timezone is this" is asking the clock.
- DST and travel shift the boundary by a few hours. Harmless by construction: the advance rule
  no-ops on `delta ≤ 0`, and grace absorbs the rest. A boundary shift can produce a free day; it can
  never take one.

### 3.2 What counts as a visit day

**Any single player action.** Feed, Clean, Play, Pet, Rest, Give Item, send an expedition, collect a
reveal, hatch an egg, place/move an item, buy something, assign a job, evolve, retire, ask home.

- **Not** merely opening the app. A background PWA reload or a tab flick is not a visit; if it were,
  the streak would measure nothing and mean nothing.
- **Not** a quota. There is no "care for all three Pips" or "all needs above 70". One tap. The game
  already frames Clean as "a check-in ritual" (§5) — that is the shape of a visit day.
- **Not** `TICK`. Automatic ticks are the app breathing, not the player showing up.

Implementation: a single `touchVisit(state, at)` helper called from an explicit whitelist of reducer
arms, with `streak.test.ts` **enumerating that whitelist against `GameAction`'s union** so a future
action can't silently fail to count (or silently start counting).

### 3.3 The ladder — the content repeats, the tier escalates

`ladderLength` = 7. Days 8–14 repeat days 1–7's rewards; what grows is the **tier**. That split is
the whole anti-dark-pattern shape: the day-to-day rewards are always attainable from any streak
length, and the only thing a break can cost is the tier — a bonus, per §0.1.

All grants are resolved through a **level-aware grant table**, so nothing is ever handed out that the
player's Keep cannot already obtain (the same rule bounties obey, §5.3):

| Day | Reward at Keep level 1 | Notes |
|---|---|---|
| 1 | 2 Berries | "something to hand out" |
| 2 | 3 Fiber | |
| 3 | 1 Toastnut + 2 Berries | Toastnut is Bramblewick/Simmering — level-1 reachable |
| 4 | 2 Fiber + **1 Wood** | the only pre-level-2 wood in the ladder (§3.6) |
| 5 | **A Keepsake** | a free decoration, **chosen from 3 offered** |
| 6 | 3 Berries + 2 Fiber | |
| 7 | **The Week Basket** | a level-aware bundle + **1 egg from any unlocked biome pool, player's choice** |

At Keep level 2 the same rows scale (wood appears from day 2, Stew becomes eligible); at level 3 the
basket may include Shell/Driftwood. **Deliberately no Stew before Keep level 2** — "unlocking level 2
visibly makes feeding easier" is a shipped round-2B promise and a level-1 streak Stew would eat it.

Two design notes on the standout rows:

- **Day 5's Keepsake is the single best retention reward in this design**, and it is worth saying
  why: decorations are pure cosmetics (zero balance risk, §0.4) and they are the game's only
  mechanism for *visible accumulation*. A player five weeks in has a Keep that is visibly, densely
  theirs. That is the five-day experience the round was commissioned to build, and it costs the
  economy nothing. It is a **choice of 3**, not a random drop, because a cosmetic you didn't want is
  worse than nothing.
- **Day 7's egg is the collection accelerator for the low-time player**, and it is a *choice of
  unlocked biome* so it aims at whatever Album page is still blank. It also feeds that biome's pity
  counter normally (§7).

**Tiers:**

| Tier | Streak days | Loot bonus |
|---|---|---|
| 0 | 1–2 | +0.00 |
| 1 | 3–6 | +0.05 |
| 2 | 7–13 | +0.10 |
| 3 | 14–29 | +0.15 |
| 4 | 30+ | **+0.20 (cap)** |

Delivered as additive bonus-roll chance into the one summed, capped channel (§9). Never fractional
items; never anything that touches care.

### 3.4 What a break costs, and the grace that usually prevents it

Advance rule, in full:

```
delta = today - lastVisitDay
delta <= 0  →  no-op                       (already counted today, or the clock rolled back)
delta == 1  →  current += 1                (the ordinary day)
delta >= 2  →  gap of (delta - 1) missed days:
                 if graceBanked >= (delta - 1) and (delta - 1) <= graceMax:
                     spend that many grace days; current += 1   ← the streak SURVIVES
                 else:
                     current = 1                                 ← restart, at the welcome-back floor
```

**Grace: a bank of 2, refilling 1 per 14 days, full at 2 from the very first day.** Why a bank
rather than a purchasable freeze:

- It is forgiving in the shape real life actually breaks streaks — one bad Tuesday, roughly twice a
  month — rather than in the shape a store would like to sell.
- It can never become a monetisation surface or an anxiety timer, because it is not purchasable,
  not displayable as a dwindling resource with a price tag, and not extendable.
- A missed day is called a **Rain Day** and reported *after the fact*, warmly and once: *"The Keep
  had a quiet day on Tuesday. Nobody minded. One rain day left this fortnight."*

**And when the streak does restart, it restarts better than new.** If `longest` ever reached
`welcomeBackLongestRequired` (7), the fresh streak starts at tier `welcomeBackTierFloor` (1) rather
than tier 0. A fortnight away therefore leaves a veteran **strictly better off than a brand-new
player** — the mechanical form of "a returning player should feel welcomed, not billed."

What a break does **not** cost: any granted reward, any ladder row (they cycle from day 1 again,
which is a fresh set of gifts, not a demotion), `longest`, `totalVisitDays`, any counter, any
milestone, any Album page, any Pip.

### 3.5 Data shape

```ts
export interface StreakState {
  readonly current: number;                 // consecutive visit days
  readonly longest: number;                 // forward-only
  readonly lastVisitDay: number | null;     // day index
  readonly totalVisitDays: number;          // forward-only
  readonly graceBanked: number;             // 0..graceMax
  readonly graceRefilledOnDay: number | null;
  /** Rain days spent, for the warm after-the-fact report. Forward-only. */
  readonly rainDays: number;
  /** Day whose ladder reward has been banked — the double-grant guard. */
  readonly rewardedForDay: number | null;
  /** Choice rewards awaiting a tap. WAITS FOREVER (§0.2). */
  readonly pendingChoices: readonly StreakChoice[];
}

export type StreakChoice =
  | { readonly kind: "keepsake"; readonly offers: readonly string[]; readonly forDay: number }
  | { readonly kind: "basketEgg"; readonly offers: readonly string[]; readonly forDay: number };
```

Non-choice rewards **auto-bank** the instant the day advances, so there is no claim button to miss.
`rewardedForDay` is the idempotence guard: a day can pay out exactly once, however many actions the
player takes and however the clock behaves.

### 3.6 Clock tampering

Spec §4.5's ruling stands — *"single-player, no leaderboards; we do not care."* Two clamps make it
safe anyway, and both are worth a test:

1. `delta ≤ 0` never advances the streak and never re-grants (so rolling the clock back and forth
   cannot farm ladder rewards).
2. A forward jump of 100 days pays out **one** day's ladder reward, not 100, because the payout is
   gated on `rewardedForDay !== today`, not on the size of the jump. And a forward jump can only
   *reset* the streak, which grace absorbs.

---

## 4. MILESTONES

### 4.1 Shape

A content registry, `content/milestones.ts`, read against one forward-only counter bag:

```ts
// GameState
readonly counters: Readonly<Record<string, number>>;   // monotonic non-decreasing, asserted
readonly milestones: {
  readonly earned: Readonly<Record<string, number>>;   // id → earnedAt
  /** Earned but not yet celebrated — drives the toast queue (§10). */
  readonly pendingCelebrations: readonly string[];
};

export interface MilestoneDef {
  readonly id: string;
  readonly name: string;
  /** Past-tense, warm, never an imperative. "You fed someone. They were pleased." */
  readonly blurb: string;
  readonly metric:
    | { readonly kind: "counter"; readonly counterId: string }
    | { readonly kind: "albumForms" }
    | { readonly kind: "ledgerVariants" }
    | { readonly kind: "streakLongest" }
    | { readonly kind: "masteryTierAnyBiome" }
    | { readonly kind: "masteryTierAllBiomes" }
    | { readonly kind: "oldestPipAgeMs" }        // roster OR Long Meadow — both count
    | { readonly kind: "sanctuaryResidents" };
  readonly threshold: number;
  readonly reward: MilestoneReward;
  /** Revealed only on earning (a surprise, not a hidden chore). */
  readonly hidden?: boolean;
}

export type MilestoneReward =
  | { readonly kind: "resources"; readonly bundle: ResourceBundle }
  | { readonly kind: "items"; readonly items: Readonly<Record<string, number>> }
  | { readonly kind: "keepsake"; readonly decorationId: string }
  | { readonly kind: "flair"; readonly flairId: string }
  | { readonly kind: "none" };
```

**Milestones never have an `availableWindow`.** Not "unused" — *forbidden*, by test. A windowed
achievement is permanently-missed content, which §0.2 rules out.

Counter ids: `careActions`, `feeds`, `cleans`, `plays`, `pets`, `naps`, `gifts`,
`expeditions.<biomeId>`, `expeditionsTotal`, `eggsFound`, `eggsHatched`, `itemsCollected`,
`evolutions`, `bountiesCompleted`, `bountyDaysCleared`, `decorationsPlaced`, `visitDays`,
`sanctuaryArrivals`, `sanctuaryReturns`, `shiniesFound`, `jobTicks`.

### 4.2 The spread (~34, first hour to long haul)

**First hour** — a milestone should fire inside the first 90 seconds (spec §10.1's acceptance bar):
First Feed · First Trip Home · First Egg Found · First Hatch · First Nap · First Decoration Placed ·
Keep Level 2.

**First day:** 10 care actions · 5 trips · Three Pips in the Keep · A Pip at work (first job) · First
Album Field note · Three bounties in a day.

**First week:** 50 care actions · 25 trips · a 7-day streak · 4 Album forms · **First Evolution** ·
Keep Level 3 · Every biome visited once (6/6) · Roster upgrade · First Long Meadow resident · 10
bounties.

**Long haul:** 500 care actions · 100 trips · **14/14 The Album** · **21/21 The Grove Ledger** ·
30-day streak · 100 bounties · a Pip 30 days old (roster **or** Long Meadow — both count, because
retiring must never cost progress) · mastery tier 5 in one biome · mastery tier 3 in all six ·
First Glimmer (hidden) · 50 decorations placed · 5 residents at the Long Meadow · 100 bounty-days.

### 4.3 Rewards: resources, items, decorations, flair — never power

Hard-fenced, and the fence is a test (`milestones.test.ts`):

1. Every reward's `kind` ∈ the four allowed variants above.
2. **No milestone reward may reference any tuning key in the isolation list** (`needDecayPerHour`,
   `care.*`, `foods.*`, `offlineRateCapMs`, `personalityDecayMultipliers`, `playRefusal`,
   `sulkExitThreshold`). No decay reduction, no cooldown reduction, no restore boost, no expedition
   speed-up, no roster-cap change beyond the shipped upgrade. §0.4 is why.
3. **The early-grant ceiling** (§12.2): the sum of every resource reward earnable before Keep level 2
   must keep `retention.grants.preLevel2WoodCap` (2 wood). Asserted, because otherwise the shipped
   "Keep level 2 in 30–45 minutes" claim quietly becomes a lie.

**Flair** is the interesting reward and should carry most of the long-haul rows: Album page frames,
a curator's stamp on the cover, a ribbon under a species portrait, a title on a Pip's card, a
Long Meadow gate sign. Flair is infinitely grantable, costs the economy exactly nothing, and is what
players actually screenshot.

---

## 5. DAILY BOUNTIES

### 5.1 Shape and generation

**3 per day**, generated from a level-aware template pool.

```ts
export interface BountyInstance {
  readonly templateId: string;
  readonly slot: number;                 // 0..perDay-1
  readonly target: number;               // resolved at generation
  readonly progress: number;
  readonly completedAt: number | null;
  readonly rerolled: boolean;
  /** Ids resolved at generation: which biome, which item, which station. */
  readonly params: Readonly<Record<string, string>>;
  /** Became impossible after generation (§5.5) — auto-replaced, free. */
  readonly stale: boolean;
}

// GameState
readonly bounties: {
  readonly day: number | null;
  readonly slots: readonly BountyInstance[];
  readonly rerollsUsed: number;
  readonly dayBonusGranted: boolean;
};
```

**Generation is stateless and day-derived.** It uses `createRng(seed).stream("bounty:" + dayIndex)`
and **never persists that cursor**, exactly as `rollStarterCandidates` previews the starter trio.
Three consequences worth having:

- Reload-safe by construction — the same day always derives the same three bounties.
- `rngState` never grows, however many days pass. (A per-day *persisted* stream name would have
  added an entry to the save every day forever.)
- No cursor interaction with the loot or egg streams whatsoever, so §2 rule 3's determinism claim is
  untouched.

Regeneration is **lazy**: the first player action on a new day notices `bounties.day !== today` and
regenerates. A 30-day absence generates **one** day, not 30.

### 5.2 The templates

```ts
export interface BountyTemplate {
  readonly id: string;
  readonly kind: "feed" | "clean" | "play" | "pet" | "rest" | "expedition" | "collect" | "hatch" | "job" | "place";
  readonly requires: {
    readonly minKeepLevel?: KeepLevel;
    readonly expeditionId?: string;        // must be UNLOCKED at current level
    readonly itemId?: string;              // must be OBTAINABLE at current level
    readonly placedItemId?: string;        // must already be placed
    readonly needsAdultPip?: boolean;
    readonly minRosterSize?: number;
    readonly needsAffordableDecoration?: boolean;
  };
  readonly target: number | { readonly base: number; readonly perRosterPip: number };
  readonly reward: BountyReward;
  readonly weight: number;
}
```

Level-1-safe examples: *Hand out four snacks* (feed ×4) · *Freshen everyone up* (clean × roster
size) · *Three trips to the Meadow* (~15 min) · *Bring home six Fiber* (~2 Meadow trips) · *Sit with
someone* (pet ×3) · *A proper nap* (one Rest to auto-wake) · *Take the long road* (one Bramblewick
trip).
Level 2+: *A Forest run* · *Something simmering* (requires a placed Stockpot) · *Hatch one egg*.
Level 3+: *Two Shore trips* · *An evening at the Grotto*.

### 5.3 Level-awareness, and the proof

> *"a bounty for a locked biome is a bug — make the generator level-aware and prove it."*

The generator builds `eligible = templates.filter(t => isBountyEligible(t, state))` and draws
`perDay` distinct **kinds** from it. `isBountyEligible` checks:

- `minKeepLevel ≤ state.keep.level`;
- `expeditionId`'s `unlockKeepLevel ≤ state.keep.level`;
- `itemId` is obtainable at the current level — **via the same helper
  `core/economy/reachability` already uses**, not a second notion of "obtainable". This is the key
  architectural move: one definition, one place, one test suite guarding both;
- `placedItemId` appears in `state.keep.placements`;
- `needsAdultPip` / `minRosterSize` against the live roster;
- `needsAffordableDecoration`: at least one unplaced decoration costs ≤ one hour of expected income
  at this Keep level (again from the reachability rate helper).

**The proof obligations** (`bounties.test.ts`):

1. **The matrix.** For Keep level ∈ {1,2,3} × roster size ∈ {1..5} × placements ∈ {∅, {station},
   {stockpot}, {both}} × 1000 seeded day indices: **every generated bounty is completable** — its
   biome is unlocked, its item is obtainable, its station is placed, and its target is ≤ what one
   day of that level's play can produce. This single property test is the "prove it" deliverable.
2. **The pool never starves.** `eligible.length ≥ perDay` at every point in that matrix. The
   universal care templates guarantee it: care always works, even for a single Sulking Pip (Feed and
   Clean are legal from Sulking, §4.7).
3. **Distinct kinds.** No day offers three feed bounties.
4. **Target sanity.** `target ≤ dailyCapacity(level)` for every generated instance, where
   `dailyCapacity` comes from the reachability rate helper — so a bounty is never a grind.

### 5.4 Rerolls, expiry, and the absence of a deadline

- **1 free reroll per day, player picks which slot.** Free forever — no resources, no ads, no
  "watch this to reroll". A reroll exists so a bad draw is not an accusation sitting on the
  doorstep; charging for it would turn a kindness into a conversion funnel.
- Rerolls draw from the same eligible pool, excluding the current day's kinds.
- **No countdown timer anywhere.** The card is headed "Today's round" and shows no clock.
- Unfinished bounties are **silently replaced** at the day boundary. There is no failure state, no
  "0/3 completed yesterday", no streak-of-bounties to break. The only bounty number that persists is
  `counters.bountiesCompleted`, which is forward-only.
- **Rewards auto-bank on completion**, so a completed bounty can never be missed.

### 5.5 A bounty that becomes impossible mid-day

The player removes the Stockpot; the "something simmering" bounty is now dead. It is marked `stale`
and **auto-replaced free of charge** on the next action — not counted as a failure, not consuming the
reroll. Tested.

### 5.6 Rewards

Per bounty: a modest level-aware bundle (2–4 of something the Keep can already get), drawn from the
same grant table the streak uses and subject to the same `preLevel2WoodCap`.

Clearing all three in a day grants **one egg from any unlocked biome pool, player's choice**
(`dayBonusEggMaxPerDay` = 1). This is the low-time player's route into the Album chase; an engaged
player already out-farms it in an hour of Meadow trips (0.96 eggs/h), so it accelerates the person
who needs it and barely registers for the person who doesn't.

---

## 6. EXPEDITION MASTERY

### 6.1 Shape

Per **Pip**, per **biome**. What is stored is **trips**; the tier is **derived**.

```ts
// PipState (optional, undefined ≡ {} — the same pattern `sulking` uses,
// so no existing fixture needs an edit)
readonly mastery?: Readonly<Record<string, number>>;   // expeditionId → completed trips
```

Storing trips rather than tiers means **retuning the thresholds re-grades every existing Pip with no
migration** — a property worth having, and the same reasoning behind storing `happinessIntegral`
rather than a readiness flag.

Mastery lives on `PipState`, which means it **travels to the Long Meadow and back automatically**.
Retiring never costs progress (§0.1).

### 6.2 Thresholds — time-normalised, so no biome is a silly grind

```
trips(tier, biome) = max( ceil( tierHours[tier] × 60 / durationMinutes ),
                          tierMinTrips[tier] )

tierHours    = [0.5, 1.5, 4, 9, 18]
tierMinTrips = [2,   4,   7, 12, 20]
```

| Biome | Duration | T1 | T2 | T3 | T4 | T5 | T5 in wall-clock |
|---|---|---|---|---|---|---|---|
| Meadow | 5 m | 6 | 18 | 48 | 108 | 216 | ~18 h engaged |
| Forest | 15 m | 2 | 6 | 16 | 36 | 72 | ~18 h engaged |
| Shore | 30 m | 2 | 4 | 8 | 18 | 36 | ~18 h engaged |
| Bramblewick | 40 m | 2 | 4 | 7 | 14 | 27 | ~18 h idle |
| Snowdrift | 60 m | 2 | 4 | 7 | 12 | 20 | ~20 h idle |
| Lanterngrotto | 90 m | 2 | 4 | 7 | 12 | 20 | ~30 h idle (~20 nights) |

Both play rhythms get a real ladder in their own currency: the active player grinds Meadow trips, the
once-a-night player accrues Grotto mastery over three weeks. `tierMinTrips` is the floor that stops a
90-minute biome handing out tier 1 for a single trip.

### 6.3 What improves, and by how much

| Tier | Bonus-roll chance | Title (the actual reward) |
|---|---|---|
| 1 | +0.02 | "Knows the path" |
| 2 | +0.05 | "Knows the shortcuts" |
| 3 | +0.08 | "Knows where the nests are" |
| 4 | +0.11 | "Knows every stone" |
| 5 | +0.15 **+ 2 percentage points egg chance** | "Old friend of the Meadow" |

- **Loot quantity only**, delivered exactly as Curious's +10% is: an independent bonus-roll chance
  per base roll, so it arrives as occasional visible extra finds rather than fractional scaling. It
  feeds the one summed, capped channel (§9).
- **Tier 5 adds +0.02 to that biome's egg chance for that Pip** (Meadow 8% → 10%, Grotto 50% → 52%).
  Small, flavourful, and the collection accelerator for the player who has genuinely put the hours in.
  Separate channel, separately capped (§9).
- **Explicitly does not improve:** duration (that is Hardworking's identity, and the duration figures
  are what `reachability.test.ts` measures progression against), loot-table weights, egg-pool odds,
  refusal rules, need decay, care restores.
- **Never decays.** Not from absence, not from retirement, not from evolution.

**Why the numbers are small:** the real reward is the title on the Pip's card and in its Album entry.
+15% at the top of an 18-hour ladder is a nod, not an economy. This is deliberate — a mastery system
that meaningfully changed yields would have to be balanced against the round-2B income tables, and
those tables are load-bearing for four pinned assertions.

### 6.4 Balance-guard interaction (the important part)

`core/economy/reachability.test.ts` measures a **fresh save**, which has zero mastery by construction.
So every one of its assertions keeps measuring the tuned economy and cannot be accidentally satisfied
by a buff. Add one explicit test asserting that (`"the reachability figures are measured at zero
mastery"`) so nobody later seeds mastery into those fixtures for convenience.

Residual exposure, quantified: the level-2 target is ~8 Meadow trips, and Meadow tier 1 needs 6 trips
for +0.02 — so a player earns roughly `2 trips × 3 rolls × 0.02 ≈ 0.12` extra items inside the
measured window. That is well under the noise of a single weighted roll and cannot move the 30–45
minute median.

---

## 7. EGG PITY

### 7.1 Tiers and base odds — printed, always

Rarity tiers are the shipped ones (`common` 100 / `uncommon` 30 / `rare` 12 / `lineage` 0). The
chase the player actually feels is *which species came out*, so pity operates on **the rarest tier
present in the egg's biome pool**:

| Biome | Pool | Base odds | Rarest tier | Pity threshold |
|---|---|---|---|---|
| Meadow | mosspip, cloudpip | 76.9% / 23.1% | uncommon | **8** |
| Bramblewick | mosspip, pebblepip | 50% / 50% | common | **none** |
| Forest | mosspip, pebblepip, emberpip | 43.5% / 43.5% / 13.0% | uncommon | **8** |
| Snowdrift | snowpip, cloudpip | 50% / 50% | uncommon | **8** |
| Shore | tidepip, cloudpip | 76.9% / 23.1% | uncommon | **8** |
| Lanterngrotto | emberpip, lanternpip | 71.4% / **28.6%** | rare | **6** |

- **8 for uncommon pools.** The Meadow's Cloudpip is expected in ~4.3 hatches; 8 turns a long tail
  into a promise without touching the base odds.
- **6 for rare pools.** Grotto eggs cost 90 minutes each, so 6 caps the trophy chase at ~9 hours
  against the ~10.5 h expectation (bible §3.6). *The tail is what makes a chase feel unfair*, and
  this removes the tail while leaving the odds exactly as published.
- **No pity for common-only pools** (Bramblewick), because there is nothing rarer in the pool to
  chase. The UI shows the odds and no counter, rather than a counter that never pays.

### 7.2 The counter

```ts
// GameState
readonly eggPity: Readonly<Record<string, number>>;   // expeditionId → misses since last rare
```

- Increments on a **hatch** (not on an egg being found) from that biome that did **not** produce the
  pool's rarest tier. Hatching is the player-witnessed moment; a counter must only move on something
  the player saw.
- At `threshold`, the next hatch from that biome is **guaranteed** to be that tier, and the counter
  resets to 0.
- **Kindness tiebreak:** the guaranteed draw prefers a **not-yet-caught** species of that tier if one
  exists, else any of that tier. This reads the Album from the hatch path (in `core/state.ts`, which
  already imports every registry — `core/eggs` stays Album-free). It is a strictly forward kindness
  and it makes the display concrete: *"the next one from the Grotto will be a Lanternpip."*
- **Visible, always.** On the biome card, on the egg's own card, and on the Album's Lanternpip page:
  *"Grotto eggs: Emberpip 71%, Lanternpip 29%. Three more before a Lanternpip is certain."*

### 7.3 Determinism, and why it costs nothing

The hard constraint is cursor parity: a pity hatch must consume **exactly as many rolls** as a normal
one, or an existing save's future rolls shift. It comes free, via the mechanism round 2B already
relies on:

> `rollGenome` consumes exactly 5 rolls — species, palette, pattern, personality, shiny —
> **regardless of how many entries are in the registry it is handed** (`pickSpecies` does one
> weighted draw over `Object.values(registry)`, one `stream.next()` either way).

So a pity hatch simply narrows the injected registry to the guaranteed subset, exactly as
`eggSpeciesPoolFor` already narrows it to the biome pool. Same 5 rolls, same cursor advance.

Required test (mirroring the existing `"biome pool cursor parity"`): **`"pity hatch cursor parity"`**
— a pity-triggered hatch and an ordinary hatch from the same cursor leave `rngState.egg` identical.
Plus: **survives save/reload** — serialize → migrate → hatch produces the same species and the same
cursor as hatching without the round trip.

Bonus eggs from the streak basket and the bounty day-clear carry the player's chosen
`sourceExpeditionId` and therefore feed that biome's counter normally. No special case.

### 7.4 Anti-dark-pattern justification

Odds published. Counter visible and exact. Threshold published. Pity cannot be bought, extended,
reset by the game, or lost. It never resets on absence — a player who hatched 5 Grotto eggs in March
comes back in June one egg from a guaranteed Lanternpip. That is the whole point of it being in
`GameState` rather than in a session.

---

## 8. EVENTS

### 8.1 Two rules that make "limited time" safe

1. **Every event recurs annually.** Windows are declared as month-day, so "you missed it" is always
   "it comes back". This converts limited-time from *scarcity* into *seasonality* — the difference
   between a holiday and a sale.
2. **Nothing is ever obtainable only during an event.** An event may make something **easier** (a
   loot bonus inside the capped channel; a lower pity threshold) or **louder** (a featured
   decoration). That is the entire permitted surface.

### 8.2 The `availableWindow` seam — and the one sentence that makes it safe

`ExpeditionDef`, `FoodDef` and `DecorationDef` already carry the unused §12 field
`availableWindow?: { from: string; to: string }`. This round consumes it — **as a *featured* window,
never a *gating* one.** A decoration with an `availableWindow` is in the registry all year, buyable
all year, and merely ribboned and surfaced to the top of the Build sheet during its season.

The field name is kept (the §12 seam is honoured as written); one sentence is added to its doc comment
in all three registries, and `events.test.ts` asserts that **no registry lookup path filters by
`availableWindow`** — the guard against a future dev reading the field name and writing a gate.

### 8.3 How an event reaches core without breaking purity

Windows are month-day strings, and core cannot parse a date. So:

```ts
// GameState
readonly activeEvents: readonly string[];
// action
{ type: "SET_ACTIVE_EVENTS", ids: readonly string[], at: number }
```

The **app layer** resolves which events are active (it owns `Date` via `clock.ts`) and dispatches at
boot and on `visibilitychange`. Core reads only the id list against a content table. Purity intact:
time enters as data, exactly as `at` timestamps already do.

A stale `activeEvents` in a save can only ever have *granted* a bonus, never taken one, so the worst
case of a missed refresh is a few extra items.

### 8.4 The three shipped events

```ts
export interface EventDef {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  /** Annual, month-day. "--MM-DD" style, inclusive. */
  readonly window: { readonly from: string; readonly to: string };
  readonly lootBonusRollChance?: number;                            // ≤ events.lootBonusRollChanceMax
  readonly eggChanceBonusPoints?: Readonly<Record<string, number>>;  // per expedition
  readonly pityThresholdOverride?: Readonly<Record<string, number>>; // may only LOWER, floor = pityThresholdMin
  readonly featuredItemIds?: readonly string[];
  readonly featuredDecorationIds?: readonly string[];
}
```

| Event | When | What it does | What it never does |
|---|---|---|---|
| **Berry Glut** | early summer, 7 days | `lootBonusRollChance: 0.10`; Berry and Honeydrop featured | grant any item that isn't already in the tables |
| **Lantern Nights** | midwinter, 10 days | Grotto `eggChanceBonusPoints: +0.05`, `pityThresholdOverride: 4` | change Lanternpip's base odds; make it exclusive |
| **Tidying Week** | early spring, 7 days | features the `bunting` decoration and three others at the top of the Build sheet | discount them, or remove them afterwards |

**Lantern Nights is the model case.** During it, the trophy species is easier to reach (a guarantee in
4 rather than 6 eggs). Outside it, Lanternpip is obtainable at **identical base odds all year** and
pity still guarantees it in 6. The event is a *good week to go looking*, never the only week.

Copy rules: the card reads "the lanterns are out this week" and, at the end, "the lanterns are packed
away — they'll be back next winter." **No countdown**, no "N days left", no notification pressure
(§0.3).

---

## 9. LOOT MULTIPLIERS

### 9.1 One channel, summed once, clamped once

| Source | Max | Where it comes from |
|---|---|---|
| Curious personality | +0.10 | shipped (`quirks.curiousLootBonus`) |
| Expedition mastery | +0.15 | tier 5 in that biome, that Pip |
| Streak tier | +0.20 | 30-day streak |
| Active event | +0.10 | `events.lootBonusRollChanceMax` |
| **Naive sum** | **+0.55** | |
| **After the cap** | **+0.25** | `retention.loot.bonusRollChanceMax` |

**Sum-then-clamp, not multiply-then-clamp**, for two reasons: the player can read it (*"+10% Curious,
+15% Meadow mastery → capped at +25%"*), and nothing can compound. The cap is applied **once**, at
the single site `rollExpeditionLoot`.

**Why 0.25:** at the Meadow's 3 base rolls that is ~0.75 extra items per trip — visible, occasional,
never a doubling. It means a fully-buffed veteran earns at most **1.25×** the yield the economy was
tuned for, which cannot re-order the biomes (the multiplier is uniform) and cannot break
reachability's *"each Keep level costs more engaged play than the last"*.

**Egg chance is a separate channel:** additive percentage points (mastery tier 5 +0.02, events up to
+0.05), clamped at `eggChanceBonusPointsMax` = 0.05, with `eggChanceCeiling` = 0.60 as a hard ceiling
on the resulting chance — so the Grotto's 50% can never become a certainty.

**Job production takes no multipliers at all.** Gathering and Simmering are the offline faucet, their
ceiling is `offlineRateCapMs`, and buffing them re-derives the casual on-ramp arithmetic that
reachability pins (*the station must stay cheaper, in minutes, than the Keep level it funds*).

**Nothing multiplies care.** Not restores, not decay, not food effects, not cooldowns (§0.4).

### 9.2 The RNG contract, and the one decision it forces

Today `rollExpeditionLoot` consumes, per base roll: 1 item roll, plus — **iff the Pip is Curious** —
1 bonus-chance roll, plus 1 more item roll if it fired.

Generalising "iff Curious" to "iff bonus chance > 0" is the right change, and it is deliberately
**not** "always consume the bonus roll":

- **Chosen:** consume the bonus-chance roll **iff the effective bonus chance > 0**. A fresh save with
  a non-Curious Pip and no buffs consumes byte-identical rolls to today, so no existing save's
  in-flight expedition changes outcome on upgrade.
- **Rejected:** unconditional consumption. Cleaner to describe, but it re-aligns every future roll for
  every existing save — the same *class* of change round 2B accepted for egg pools, but there is no
  reason to spend it here when the conditional form is free.

Determinism is preserved because the effective chance is computed from **persisted** state (mastery
trips, streak tier, `activeEvents`), so a reload recomputes the identical chance. Required test:
**`"loot cursor is identical across save → reload mid-expedition with buffs active"`**.

---

## 10. THE SESSION SHAPE

> The single most important UX decision in the round. Five systems all want the moment the app opens.

### 10.1 The rule

**At most ONE blocking surface on open, ever.** Everything else is a toast, a badge, or a dot.

The away sheet grows up into **The Doorstep**: one scrollable card, sections in a fixed order, each
omitted when empty, with exactly **one** button.

### 10.2 The sequence, in order

**1. The Doorstep** (blocking, one card, one dismiss)

| § | Section | Content |
|---|---|---|
| 1 | **The greeting** | one line sized to the absence. *"Back already?"* / *"You were gone about two days."* / *"Two weeks. The Keep is dozy but fine."* Never guilt. |
| 2 | **Streak** | *"Day 6 in a row."* Or after a gap: *"A fresh start — and you're still at Tier 1, thanks to that fortnight in March."* Rain days reported after the fact, warmly, once. Banked rewards shown as a small strip here, not as another modal. |
| 3 | **The Keep** | the existing per-pip need arrows + the capped-time note. Same content, same tone, now a section. |
| 4 | **Homecomings** | trips completed, eggs now pipping, job hauls. A **tease** — never the reveal's contents. |
| 5 | **Today's round** | the three bounties as a compact checklist. **No clock.** This is the "what do I do now" answer, and it is the actual retention mechanic. |
| 6 | **One nudge** | at most ONE, by priority: a pipping egg → a Pip ready to evolve → a pity counter one away → an Album page one form away → a milestone one step away. Exactly one, ever. |
| — | **Dismiss** | **"Come in"** |

**2. The loot reveal queue** — existing behaviour, entirely unchanged. The reveal is the dopamine core
(§6.1) and must not be pre-empted, diluted, or shared with a rewards summary.

**3. Milestone celebrations** — as **toasts**, one at a time, tap-to-open for detail. More than two
earned during catch-up batch into one: *"Three new milestones — have a look."* Never a modal chain.

**4. Album badge** — a dot on the Album button, plus **one** gentle toast for the session's first new
page. Never a modal: new pages are for savouring on the player's schedule.

### 10.3 The short-absence path

Under `AWAY_SHEET_MIN_ELAPSED_MS` (3 min — a tab flick): **no Doorstep at all.** A streak advance, if
the day changed, is a single toast. Bounties refresh silently. That rule is already in
`deriveAwaySheet` and it stays exactly as it is.

Crossing 04:00 **mid-session**: one toast, *"New day — today's round is up."* No modal, no
interruption of whatever the player was doing.

### 10.4 Implementation note for the integrate stage

The Doorstep should **extend** `AwaySheetModel` with optional sections rather than replace it, so the
existing `awaySheet.test.ts` assertions (which pin exact copy) keep passing. `deriveAwaySheet`'s
null-under-3-minutes contract and `phase4.ts`'s suppression rule (*a meaningful catch-up silences
per-event toasts because the sheet tells that story*) are both load-bearing and both stay.

### 10.5 Why this ordering

It answers the three questions a returning player has, in the order they have them: **"is everyone
okay?"** (sections 1–3), **"what did I get?"** (section 4, then the reveal), **"what now?"**
(section 5). The nudge cap of one is the difference between a warm welcome and a to-do list. And the
reveal staying last and untouched means the best moment in the game is still the last thing that
happens on open.

---

## 11. SAVE SCHEMA CHANGES (v5 → v6)

`CURRENT_SCHEMA_VERSION` 5 → **6**. One migration step `MIGRATIONS[5]`, one new fixture
`src/core/save/fixtures/v6.json` (`migrate.test.ts` already asserts a fixture exists and migrates
cleanly for every version 1..CURRENT), and new validators in `serialize.ts` for each field.

### 11.1 New `GameState` fields

| Field | Shape | v6 backfill |
|---|---|---|
| `pipdex` | `PipdexState` (§1.4) | **derived from the existing save** — see §11.3 |
| `sanctuary` | `{ pips: {}, order: [] }` | empty (nothing could have been retired) |
| `streak` | `StreakState` (§3.5) | `current: 0, longest: 0, lastVisitDay: null, totalVisitDays: 0, graceBanked: 2, rainDays: 0, rewardedForDay: null, pendingChoices: []` — **full grace on arrival** |
| `bounties` | `{ day: null, slots: [], rerollsUsed: 0, dayBonusGranted: false }` | empty; the first action generates the day |
| `counters` | `Record<string, number>` | provable lower bounds only — see §11.3 |
| `milestones` | `{ earned: {}, pendingCelebrations: [] }` | empty + the `founder` grant (§11.3) |
| `eggPity` | `Record<string, number>` | `{}` (absent ≡ 0) |
| `dayOffsetMs` | `number` | `0`, overwritten at boot by `SET_DAY_OFFSET` |
| `activeEvents` | `readonly string[]` | `[]`, refreshed at boot |
| `keepsakes` | `Record<string, number>` | `{}` — the granted-decoration shelf (§11.2) |

### 11.2 Changed existing shapes

| Where | Change | Why optional / how migrated |
|---|---|---|
| `PipState.mastery?` | `Record<string, number>`, expeditionId → trips | **Optional**, `undefined ≡ {}` — the same pattern `sulking` uses, so no existing fixture needs an edit. |
| `Placement.granted?` | `boolean` | **Optional**, `undefined ≡ false`. Granted keepsakes refund **nothing** on `REMOVE_ITEM` and return to `keepsakes` instead — this closes a real resource-printer exploit (`REMOVE_ITEM` refunds full cost today, so a free decoration would mint resources). Returning to a re-placeable shelf is warmer than a refund *and* closed as a loop. |
| `ROSTER_FULL_MESSAGE` / `_MAX_MESSAGE` | copy only | Now points at the Long Meadow (§2.7). No schema impact. |

### 11.3 What the migration derives, and the rule it follows

> **Rule: never backfill a counter above the truth, never below what is provable.** Pre-v6 history is
> partly unknowable, and a migration that guessed high would hand out unearned milestones while one
> that guessed low would feel like a reset.

- **Album:** for every roster Pip, mark its **live** `speciesId` caught at `hatchedAt`, with
  `firstPortrait` from its genome/name. For every Pip with `evolved !== null`, mark the variant leaf.
  For every `genome.shiny === true`, set `shinyCaughtAt`. Mark **seen** for every species in the
  `eggSpecies` pool of every expedition unlocked at the save's Keep level (a slight over-grant of
  "seen" — the player very probably has been there — and over-granting *knowledge* costs nothing).
- **Counters:** `eggsHatched = max(0, rosterSize - 1)`, `evolutions = count(evolved !== null)`,
  `visitDays = 1`, everything else `0`.
- **A one-time `founder` milestone**, hidden, granted **only by the migration**: an apology-in-flair
  for the history the save cannot prove. A returning v5 player therefore opens the Album already
  partly full and with a stamp on the cover — a **gift**, never a reset.

### 11.4 RNG streams

**No new persisted cursors.** Bounty generation, keepsake offers and event selection all derive
statelessly from `(seed, dayIndex)` via a local `createRng` whose state is never captured — the same
trick `rollStarterCandidates` uses. Consequences: `rngState` never grows with playtime, and none of
these systems can perturb the `egg`, `expedition-loot`, `job`, `dialogue` or `genesis` sequences.
Worth an explicit test: **`"retention systems add no rng cursors"`** (dispatch a long session,
assert `Object.keys(rngState)` is unchanged from the shipped set).

---

## 12. BALANCE INTERACTIONS WITH THE ROUND 2A/2B GUARDS

### 12.1 `core/pips/balance.test.ts` — untouched by construction

Nothing in this round reads or writes `needDecayPerHour`, `personalityDecayMultipliers`, `care.*`,
`foods.*`, `offlineRateCapMs`, `sulkExitThreshold`, or `playRefusal`. The leave-safe floor (74.0), the
second-absence loop, the [18, 35] return band, and the "one care session out-restores one capped
window" claim are all arithmetic over exactly those keys.

**Add one guard:** `retention.isolation.test.ts` asserts that no module under the new retention
systems imports or references those tuning keys. It makes §0.4 mechanical rather than aspirational.

The one place this could have gone wrong is the sanctuary: `arrivalNeeds` at 80 sets need values
directly. It is safe because it is a **one-time snap on arrival**, gated behind `minStayMs` = 8h, so
it can never function as a care action (see §2.5's exploit note). Worth its own test: *"a retire →
minimum stay → retrieve round trip takes longer than a care round and is therefore never the cheaper
cure."*

### 12.2 `core/economy/reachability.test.ts` — two new obligations

Untouched in principle: all new income is either (a) grants outside the expedition/job tables that
the suite measures, or (b) bonus rolls that are **zero on a fresh save**. But grants are the one way
this round can inject resources the suite doesn't see, so:

1. **The `preLevel2WoodCap` assertion.** The total wood obtainable from every retention grant
   reachable before Keep level 2 must be ≤ 2 (`tuning.retention.grants.preLevel2WoodCap`). Wood is the
   binding resource for level 2 (`{ wood: 5, fiber: 6 }`) and the **level-1 wood ceiling** is the
   fragile invariant it protects (bible §3.3, §9.4). Fiber grants are deliberately *not* capped this
   tightly: fiber is not binding, so extra fiber shortens the unlucky tail (the p90 50-trip seed)
   without moving the median — the same job the Gathering Station on-ramp does.
2. **Re-run the level-2 measurement with maximum grants.** Replay the 300-seed level-2 measurement
   with the largest grant bundle a player could have banked inside that window and assert the median
   **stays ≥ 25 minutes**. This keeps the shipped "30–45 minutes" claim honest in *both* directions —
   the existing suite only guards the upper bound.
3. **Pin the zero-mastery assumption** (§6.4) so nobody later seeds mastery into those fixtures.

### 12.3 The level-1 wood ceiling (bible §3.3 / §9.4)

The streak ladder's first draft put 3 Wood on day 3 — 60% of the level-2 wood cost, handed over
before the player had earned it, which would have silently falsified the shipped feel claim. The
shipped ladder (§3.3) has **1 wood before level 2** and pushes materials later, and the cap above is
the guard that keeps it that way. This is the same failure mode round 2B documented for level-1
expeditions, arriving from a completely new direction — which is why the cap lives in `tuning.ts`
next to the numbers it protects.

### 12.4 Other shipped promises this round must not eat

| Promise | Where it could break | Kept by |
|---|---|---|
| "Keep level 2 visibly makes feeding easier" (Stew is Forest/Shore-only) | a streak/bounty granting Stew at level 1 | the level-aware grant table: no Stew before level 2 |
| "the Meadow is the best egg farm per hour" | bonus eggs + mastery egg points | bonus eggs ≈ 1.1/day vs Meadow's 0.96/**hour**; mastery adds ≤ 2 points |
| "deep trips never win on throughput" | mastery buffing deep biomes disproportionately | the bonus is a flat chance per base roll, so it scales *with* existing rolls and cannot re-order biomes |
| "each Keep level costs more engaged play than the last" | the 0.25 loot cap | the cap is uniform across biomes and levels |
| "one care session out-restores one absence" | sanctuary `arrivalNeeds` | `minStayMs` (§12.1) |
| "Pips never die / never punish" | every system in this round | §0.1's table, tested |
| "evolution must be earned" (v1.3) | sanctuary age accrual | frozen `ageMs` / `happinessIntegral` (§2.4) |
| "eggs never expire" | any bounty/streak expiry logic touching eggs | nothing in this round expires anything |

### 12.5 Perf

- Retired Pips leave the `TICK`/`CATCHUP` loops, so the per-tick cost stays O(active ≤ 5) — a small
  net **win** for a player with 30 residents.
- `counters`, `pipdex` and `streak` updates are O(1) per action.
- Boot validation grows O(residents) at ~0.15 ms each.
- The Album renders **two** pages at a time via `spriteResolver`, not 14 — §1's 60 fps budget and the
  ≤350 KB app-bundle budget both stay intact.

---

## 13. TEST PLAN — what turns green

| Suite | The claims it holds |
|---|---|
| `core/pipdex/pipdex.test.ts` | seen/caught tiers; evolved-through-base seeing; portrait frozen at first catch; **every scalar total monotonic** across a randomised sequence; variants and shiny recorded |
| `core/sanctuary/sanctuary.test.ts` | **the one-place invariant** after every action; `activePipId ∈ rosterOrder`; retire legality matrix incl. Sulking and `lastPip`; job auto-unassign; arrival needs clear the sulk via the ordinary §4.4 rule; **needs/age/integral frozen while resident**; `minStayMs` gate; retrieve at cap refuses warmly; nothing is ever deleted |
| `core/streak/streak.test.ts` | day-index math incl. the 04:00 offset and DST shifts; the visit-day **whitelist enumerated against `GameAction`**; ladder payout idempotence (`rewardedForDay`); grace bank spend/refill; welcome-back tier floor; **a break costs only the tier**; clock-rollback and 100-day-jump clamps |
| `core/bounties/bounties.test.ts` | **the eligibility matrix** (levels × roster × placements × 1000 seeds → zero impossible bounties); pool never starves; distinct kinds; target sanity vs daily capacity; reroll; stale auto-replace; day-clear egg cap; stateless day-derived determinism |
| `core/mastery/mastery.test.ts` | threshold derivation per biome; trips forward-only; survives retire/retrieve and evolution; affects **only** bonus rolls + tier-5 egg points |
| `core/eggs/pity.test.ts` | thresholds per pool rarest tier; common-only pools have none; **cursor parity** (pity vs ordinary hatch); survives save/reload; kindness tiebreak prefers uncaught; counter resets on payout; never resets on absence |
| `core/economy/multipliers.test.ts` | sum-then-clamp at 0.25; egg points clamp at 0.05 with the 0.60 ceiling; jobs take none; **loot cursor identical across save/reload with buffs** |
| `content/milestones.test.ts` | reward kinds in the allowlist; **no reference to isolation-list tuning keys**; no `availableWindow`; pre-level-2 grant sum ≤ `preLevel2WoodCap`; every metric resolves to a real counter |
| `content/events.test.ts` | every window recurs annually; **no lookup path filters by `availableWindow`**; every event effect is a bonus or a feature, never an exclusive; pity overrides only lower, floored at `pityThresholdMin` |
| `retention.isolation.test.ts` | no retention module touches the isolation list (§0.4) |
| `retention.copy.test.ts` | the forbidden-phrase lint (§0.3) |
| `core/save/migrate.test.ts` | v6 fixture exists and migrates; the derived Album/counters backfill; `founder` granted once; **no new rng cursors** |
| `ui/doorstep.test.ts` | section order; sections omitted when empty; **exactly one nudge**; no Doorstep under 3 minutes; the reveal queue still plays after dismiss; existing `awaySheet` copy assertions still pass |
| `core/economy/reachability.test.ts` (extended) | the two new obligations + the zero-mastery pin (§12.2) |

---

## 14. RISKS

**Structural**

1. **Sanctuary as an evolution shortcut** — solved by freezing `ageMs`/`happinessIntegral` (§2.4). If
   a future round wants residents to age, evolution readiness must be re-derived first.
2. **Sanctuary as a free heal** — solved by `minStayMs` = 8h (§2.5). This is the number to check
   first if playtesters report care feeling optional. Lever: `minStayMs` up.
3. **The one-place invariant is the sharpest new failure mode in the codebase.** A Pip in both
   `pips` and `sanctuary` would double-render, double-decay and double-count. A Pip in neither is a
   deleted Pip — the exact thing §4.4 forbids. Tested after every action; if any bug in this round
   escapes to a player, it will be this one.
4. **`activePipId` dangling after a retire.** Cheap to get wrong, immediately visible (the top bar
   empties). Asserted.

**Balance**

5. **The level-1 wood ceiling, from a new direction** (§12.3). An innocent-looking streak reward will
   present as a failure in *"expects to be affordable in 30–45 minutes"*. The `preLevel2WoodCap`
   comment in `tuning.ts` points here.
6. **The egg faucet.** Bonus eggs ≈ 1.1/day on top of expeditions, and eggs never expire, so a player
   at roster cap can accumulate a large Pipping queue. Mitigation is **presentational, not
   subtractive** (nothing is ever taken): the Keep renders at most ~6 eggs with "+4 more nestled in
   the straw", and the Doorstep lists at most 3. Watch item; lever `bounties.dayBonusEggMaxPerDay`.
7. **Loot cap reached early by a Curious Pip with mastery.** +0.10 +0.15 = 0.25 hits the cap with no
   room for the streak tier, which will read as "my streak does nothing" on that specific Pip. Honest
   fix if playtest dislikes it: raise the cap to 0.30 and re-run §12.2's measurement. Do **not** fix
   it by making the sources multiplicative.
8. **Mastery inflation inside the measured window** — quantified at ≈0.12 extra items (§6.4).
   Negligible, but pinned so it stays that way.

**Determinism & saves**

9. **Pity cursor parity** is the round's equivalent of round 2B's biome-pool patch. It works only
   because `rollGenome` consumes a fixed 5 rolls. Any future change to `rollGenome`'s roll count
   breaks both features at once — worth a comment at that function.
10. **Conditional bonus-roll consumption** (§9.2) means a buffed Pip consumes more rolls than an
    unbuffed one. Deterministic, but it makes "how many rolls does a trip take" state-dependent for
    the first time. Documented at `rollExpeditionLoot`.
11. **`activeEvents` persists and can be stale.** Refresh before the first `TICK`. Worst case is a
    small over-grant, never an under-grant.
12. **Save size** grows with residents (~450 B each) and with `pipdex` (~14 entries with frozen
    portraits, ~6 KB). No cap is imposed; §2.2 does the arithmetic.

**Day boundaries**

13. **DST / travel / the date line.** Absorbed by the `delta ≤ 0` no-op, `rewardedForDay`
    idempotence, and grace. A boundary shift can gift a day; it cannot take one.
14. **Clock tampering** is now newly attractive (daily rewards). §3.6's two clamps mean a forward
    jump pays once. Spec §4.5's "we do not care" ruling stands.

**Tone & product**

15. **Nine systems is a lot of surface for a wholesome game to guilt someone on.** The copy lint
    (§0.3) is the mechanical guard; the Doorstep's one-nudge cap is the design guard. Both are cheap
    and both should be treated as non-negotiable in review.
16. **"Pipdex" evokes Pokémon** even though it infringes nothing. Recommendation: internal id only,
    "the Album" on the surface (§1). **Owner call.**
17. **The Long Meadow vs the Meadow** — two "meadows" in one game. Distinct in every sentence, but if
    it reads badly in playtest, `The Long Hollow` is the drop-in fallback. **Owner call.**
18. **The Doorstep can still become a wall of text** even at one card, if every section fires at once
    after a long absence. Design constraint: the card must fit **two thumb-scrolls on a phone**; if a
    section would overflow, it truncates to a count with a tap-to-expand, never to a second modal.
19. **The Album's 14 pages are the round's biggest art-quality risk**, the same shape as bible §9.9's
    "15 identical crates": if pages are composed from `spriteResolver` alone with no page furniture,
    the scrapbook reads as a spreadsheet with pictures. The §1.3 six choices are the mitigation and
    they are not optional decoration — they *are* the feature.

---

## 15. FINDINGS — decisions I did not make, and what I would ask for

1. **`Rarity` as a display tier.** `uncommon`/`rare` are already documented as "display tiers for the
   Pipdex round" (bible §1.2). This design uses them for exactly that, plus as the pity key. No change
   needed — noting that the round-2B author's forward-planning paid off.
2. **Per-expedition egg rarity** (bible §8.1.4) is still not data-driven, and this round does not need
   it. If it lands later, deep-biome eggs could take longer to incubate, which would pair well with
   pity (a Grotto egg that takes 6 hours and is guaranteed by the 6th is a better trophy chase than
   one that takes 2 hours). Same file, same function, one line — but out of scope here.
3. **Keep levels beyond 3** (bible §8.1.3) remain unnecessary. This round adds progression without
   adding tiers, which is the healthier shape for a game whose grid is 8×12.
4. **A fifth resource** (bible §8.1.2) would give keepsakes and milestones more room to differentiate
   rewards. Still recommended before the next content round; not needed for this one.
5. **What I would build first if the round were cut in half:** the **Long Meadow** and the **Album**,
   in that order. Without the sanctuary the collection is literally unreachable (bible §9.7), and
   without the Album there is nothing to accumulate. Streak, bounties, mastery, pity, events and
   multipliers are all *amplifiers* — they make a five-day experience better, but the sanctuary and
   the Album are what make one exist.
6. **One mechanic I was asked for and would build differently:** nothing was refused. Every system on
   the brief is buildable inside the guardrail as designed above. The closest call was **limited-time
   events**, which are only safe because of the two absolute rules in §8.1 (annual recurrence, nothing
   exclusive) — if either of those is ever relaxed, the feature becomes a missed-content anxiety
   machine and should be cut instead.
