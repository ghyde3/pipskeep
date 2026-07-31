# PipsKeep — The Notifications Bible (Round 2I)

> **This document is the design contract for round 2I.** Where it and my own prose disagree, the
> TONE RULES win (spec §4.4, §15.5, round 2C's guardrail, round 2H's cruelty cut). Where it and an
> existing guard suite disagree, the guard wins and I was wrong. Every number here lives in
> `tuning.notifications`; every rule here is written so a test can hold it.
>
> Design only. No feature code was written this round.

---

## 0. THE VERDICT, BEFORE ANYTHING ELSE

Two things must be said in the first hundred words, because every other decision in this document
follows from them.

**First: this round cannot ship Web Push, and nobody should pretend otherwise.** The Push API is a
*server* API. A push message reaches a closed device because a server POSTs a VAPID-signed payload
to the browser vendor's push endpoint at the right moment. PipsKeep has no server — spec §1 commits
to "network-independent gameplay" and the app makes zero network calls — and the owner's 2026-07-31
decision is web-only PWA with no new runtime dependency. A client cannot POST to a push endpoint at
a moment when the client is not running. That is not a limitation of our design; it is the shape of
the platform. **Round 2I ships client-scheduled notifications, and names the push server as a seam
and a proposal.** The backlog entry's title ("Web Push") is the ambition; this is the honest half of
it that can be delivered today, and it is genuinely most of the value.

**Second: what *can* be delivered turns out to cover the case that matters most.** Expedition
durations are 5 / 15 / 30 / 40 / 60 / 90 minutes and egg incubation is 2 hours. The single most
common shape in this genre — *send a Pip on a 5-minute Meadow trip, switch tabs or apps, forget* —
is reliably servable, because a hidden-but-alive page can arm its own timer and call
`registration.showNotification()`. The unreliable cases are the long ones. And the failure mode
correlates in the right direction: **the longer the timer, the more likely the player has genuinely
left, and the less a buzz was the right way to reach them anyway.** A 90-minute Lanterngrotto return
that goes undelivered is told properly by the Doorstep. A 5-minute Meadow return that goes
undelivered is the loop breaking.

Everything below is designed so that **a missed delivery is invisible** — never a stale buzz, never
a replay, never an apology.

### 0.1 The five constraints this round obeys, restated as mechanisms

| # | Constraint | The mechanism that makes it true by construction |
|---|---|---|
| 1 | Route through the existing seam; no parallel path | `notify(event)` becomes the **only** delivery function for both channels. The toast-vs-system decision lives inside it, keyed on `document.visibilityState`. There is no second entry point to write. |
| 2 | Reward showing up, never punish absence (§4.4, 2C) | The catalogue contains **zero** notification types whose trigger is the passage of time without the player. Every type's trigger is a **thing the player started** finishing. No absence can produce a notification. |
| 3 | No loss-related push (2H's cut) | The ailment clause is a **suffix on a homecoming that was already firing**. It can never *cause* a notification, and the words for countdown, danger, and loss are on a forbidden list a test enforces. |
| 4 | One service worker | We keep `generateSW` and add our listeners via `workbox.importScripts`. No strategy change, no `injectManifest`, no second registration, no new dependency. |
| 5 | No new runtime dependency | `Notification`, `ServiceWorkerRegistration.showNotification`, `navigator.serviceWorker`, `setTimeout`, and the already-open IndexedDB handle. That is the whole toolkit. |

---

## 1. THE CATALOGUE

> **Fewer, better.** The catalogue is **two types**. Every candidate the brief listed was considered
> and four were cut. The cuts are the design.

### 1.0 The bar a type has to clear

A notification type earns a place on someone's lock screen only if it can answer **yes to all four**:

1. **Did the player start this?** If the player did not set this in motion, buzzing them about it is
   the app inserting itself into their day uninvited.
2. **Is it finished?** Not "is progressing", not "is nearly", not "is available". *Finished.*
3. **Is coming back better than not coming back?** If nothing is lost by arriving four hours later,
   the buzz is a manufactured urgency and §0.3 of the retention bible forbids it.
4. **Would the player thank you?** Read the exact string on a lock screen at 3pm on a Tuesday, in a
   meeting. If any part of you flinches, it is cut.

`needLow` and `sulking` fail (1) and (4). Bounty rollover fails (1), (2) and (3). Keep-tier
affordability fails (2) and (4). "Come back, we miss you" fails all four and is a different genre of
product.

### 1.1 Type A — **Homecoming** (`typeId: "homecoming"`, tag `pk-homecoming`)

| | |
|---|---|
| **Trigger** | Any assigned expedition whose `departedAt + durationMs` falls at or before `now`. Derived, never a stored flag — the same derivation `processDueExpeditionReturns` uses. |
| **Scheduled or transitional** | **Scheduled ahead.** Fully determined by two numbers already in the save. |
| **Priority** | 1 (highest). It is the game's core loop; spec §10.1.5 names it as the fifth beat of the acceptance-bar first 90 seconds. |
| **Earns it because** | The player pressed Send and was told a duration. Arriving to collect is the entire bargain. Yes to all four questions. |
| **Coalesces** | Yes, across Pips (§4.3). Three trips home is ONE notification. |
| **Cancels when** | Every due run has had its reveal acknowledged, or the app is open, or the app has been opened since arming (§4.5). |

**Copy — one Pip, ordinary trip.** Title carries the news (lock screens truncate bodies first); the
OS already shows "PipsKeep", so the title must not repeat it.

```
title: "Rooter is back from the Meadow"
body:  one of, chosen statelessly from (state.seed, dueAt):
  "Pockets full, feet muddy. Come see what they found."
  "Waiting by the gate with something behind their back."
  "Back in one piece and extremely pleased about it."
  "Something is rattling in their satchel."
```

**Copy — two or more Pips.** Up to three names, then a count.

```
title: "Three Pips are home"
body:  "Rooter, Bramble and Quill are back, and there is a small pile by the gate."

title: "Five Pips are home"
body:  "Rooter, Bramble, Quill and two more are back, and the gate is getting crowded."
```

**Copy — the ailment suffix** (round 2H's permitted half: an ailment has *begun*, and coming home is
the action). **Hard rule: this clause never appears alone and never causes a notification.** It is
appended to a homecoming the budget had already approved.

```
title: "Rooter is back from Bramblewick"          ← unchanged; the news is still "home"
body:  "Home safe, but scratched up — they have picked up Brambleburr.
        Nothing needs doing tonight. They would just like you to look at it."
```

Why this is not the thing 2H cut: 2H cut *"your pet is dying and you are at work"*. This is *"your
pet is home and has a scrape"*. The reassurance in the second sentence is **arithmetically true, not
a comforting lie** — `minAilmentDurationMs` (36h rated) exceeds `offlineRateCapMs` (16h), the
countdown is stored as `remainingMs` so it is a rate under §4.5's cap, and `resolveAilments` runs
only in the live `TICK` arm. Nothing can resolve while they are away. The clause is allowed to say
so because the code guarantees it.

**Copy — the lineage suffix** (promise 4). This is the most emotionally loaded moment in the game
and a lock screen is the wrong place to spend it. **Tease; never spoil.** No lost Pip's name, no
word "lineage", no egg rarity.

```
title: "Rooter is back from Bramblewick"
body:  "They found something in the brambles and will not put it down. It is warm."
```

**Suffix precedence** when a return carries both: **lineage wins**, and the ailment clause is
dropped from the notification entirely (the Doorstep and the reveal both still carry it). Two
suffixes would exceed the two-clause cap (§4.3) and, more importantly, would put a wonder and a
worry in the same sentence.

### 1.2 Type B — **Pipping** (`typeId: "pipping"`, tag `pk-pipping`)

| | |
|---|---|
| **Trigger** | Any egg in `EggState.Incubating` whose `eggReadyAt(egg)` (`incubationStartedAt + incubationMs`) falls at or before `now`. |
| **Scheduled or transitional** | **Scheduled ahead.** `incubationMs` is snapshotted at creation (including the Keep's incubation-speed multiplier), so the due moment is a pure sum of two saved numbers. |
| **Priority** | 2. |
| **Earns it because** | The player chose to begin incubation (`ACKNOWLEDGE_REVEAL`). A Pipping egg waits forever with no penalty (§7.2), so this is an invitation with genuinely zero pressure — the cleanest possible notification in the whole game. |
| **Coalesces** | Yes, across eggs. |
| **Cancels when** | Every pipping egg has been hatched, or the app is open, or has been opened since arming. |

```
title: "An egg is pipping"
body:  "Tap-tap. Tap. Something in the nursery has decided today is the day."

title: "The eggs are pipping"
body:  "Two of them, tapping in stereo. The nursery is not being subtle."
```

### 1.3 The cuts, argued

| Candidate | Verdict | Why |
|---|---|---|
| **Keep tier becomes affordable** | **CUT** | Fails bar (2): affordability is not an event, it is a threshold you drift across — and drift is what a Gathering job does *while you are gone*, which makes it the closest thing in the catalogue to an absence-triggered buzz. Fails bar (4) hardest: "You can now afford the Nursery" is a shop notification. It is the one string in this whole document that sounds like a different app. The Keep-tier surface already glows in the HUD and the Doorstep's single nudge slot already covers it. |
| **Bounty day rolling over (04:00)** | **CUT, twice over** | Fails bar (1): the player did not start the day. Fails bar (3): retention bible §5.4 is titled "the absence of a deadline" — bounties never expire, so there is nothing to be late for and inventing a buzz would manufacture the exact urgency §0.3 bans. And the trigger time is 04:00 **local**, which is the worst hour in the day to make a phone light up. A dark pattern, a tone violation and an alarm clock in one feature. |
| **Ailment contracted (standalone)** | **FOLDED IN, never standalone** | See §1.1. Standalone it would be a new interruption whose only content is worry; folded into a homecoming it is strictly more information on a buzz the player already accepted. |
| **Lineage egg found (standalone)** | **FOLDED IN, never standalone** | Same delivery moment (the expedition settle point), and standalone it would spend the reveal on a notification shade. |
| **Need < 25 / Sulking** | **NEVER** | The purest possible form of "punish absence". In-app toast only, forever. See §6. |
| **Pip ready to evolve** | **CUT** | Fails bar (3) — readiness is permanent and the Pip is fine. It is a Doorstep nudge, which it already is. |
| **A Pip is ready to retire (old age)** | **NEVER** | Promise 3 says old age is peaceful. Peaceful things do not buzz. |
| **Job haul is full / resources capped** | **CUT** | Absence-triggered and resource-nagging: both disqualifying. |
| **Streak / "come back" / re-engagement of any kind** | **NEVER** | §6. |

**The catalogue is therefore two types and four flavour variants.** Two types is not thin; two types
is the reason the permission ask is allowed to promise *"Nothing else. Ever."* and keep it.

---

## 2. THE SCHEDULING MODEL

> The round's hardest technical problem. Solved explicitly, including the parts that cannot be
> solved.

### 2.1 The finding that reshaped the design

`src/app/ticker.ts` **pauses the game loop the moment the document goes hidden** — it cancels the
rAF and dispatches a `CATCHUP` on return. This is correct (rAF is throttled to zero in hidden tabs
anyway) and it must not change. But it has a consequence the naive design misses:

> **While the tab is hidden, no state transition ever happens.** There is nothing for a
> transition-watcher like `app/alerts.ts` or `ui/phase4.ts` to observe. Every existing notification
> in the game fires from a diff between two states, and no diff will ever occur while the player is
> away.

So a transition-driven design would deliver **nothing, ever**, and would be the eighth dead feature.
The scheduler must be **derivation-driven**: it computes due moments from timestamps already in the
save, arms wake-ups, and at each wake-up recomputes from *unadvanced* state. This is exactly the
discipline spec §6.1 already imposes — *"completion is DERIVED from `departedAt + durationMs` … never
a `setTimeout`"* — applied one layer out. **The reducer is never dispatched into while hidden.**
The ticker's pause, the autosave debounce, and the `CATCHUP`-on-return path are all untouched.

### 2.2 The four delivery tiers, honestly ranked

| Tier | When it works | Reliability | What it costs us |
|---|---|---|---|
| **0 — Toast** | Page visible | 100% | Already built. **A system notification is never shown when the page is visible.** |
| **1 — Page hidden, page alive** | Tab backgrounded, another app in front, screen locked with the tab still resident | **High**, with up to ~60 s of lateness | A `setTimeout` armed at hide-time and a `registration.showNotification()` call. **This is the workhorse.** |
| **2 — Page gone, SW opportunistically woken** | The browser wakes the service worker for its own reasons (`periodicsync`, a navigation, a fetch) | **Best effort. May be zero for a given user forever.** | ~30 lines of logic-free JS in the SW plus a pre-rendered outbox in IndexedDB. |
| **3 — Real Web Push** | Always | 100% | **A server.** Out of scope; §2.7. |

**Tier 1 is the round.** Tiers 2 and 3 are labelled as what they are.

### 2.3 Tier 1 in detail — arm on hide, recompute on wake

The arming hook is `visibilitychange → hidden`, the *same* event `app/persistence.ts` already uses
for its immediate flush. Ordering is load-bearing:

```
visibilitychange → hidden
  1. persistence flushes the save            (existing behaviour, unchanged)
  2. scheduler.arm(state, now)               (new)
       plan       = planNotifications(state, prefs, now)      // pure
       decisions  = applyBudget(plan, ledger, state.dayOffsetMs, tuning, now)  // pure
       for each delivering item: setTimeout(wake, item.dueAt - now)
       writeOutbox(decisions.delivering, savedAt)             // for tier 2
```

At each wake the scheduler **does not trust the payload it armed**. It re-runs the same two pure
functions against the current store state and the current `now`:

```
wake(now)
  plan      = planNotifications(store.getState(), prefs, now)
  decisions = applyBudget(plan, ledger, ..., now)
  for each item with dueAt <= now:
      notify({ kind, message, push: { title, body, tag, typeId } })   // THE SEAM
      ledger.record(item)
  re-arm the next timer
```

Because `planNotifications` is a pure derivation over `departedAt + durationMs` and
`incubationStartedAt + incubationMs`, it is correct against an un-ticked state: an expedition is due
at its due time whether or not the reducer has settled it yet. **Recomputing at fire time is also
the cancellation mechanism** (§4.5) — anything the player already dealt with simply is not in the
new plan.

**Known imprecision, and why the copy survives it.** Chrome throttles timers in hidden tabs to 1 Hz,
and after ~5 minutes of hiding applies *intensive throttling* — roughly one wake per minute. Firefox
and Safari have comparable budgets. So a notification may arrive **up to ~60 seconds late**. Two
consequences, both already handled: `tuning.notifications.timerSlopMs` (60 s) is the tolerance the
tests assert against, and **no string in §1 contains a time word** — not "just now", not "a minute
ago", not a duration. The copy reads identically whether it is on time or a minute late.

**When Tier 1 stops working:** the tab is discarded under memory pressure, frozen by Chrome's
lifecycle freezing, evicted from the bfcache, or (most commonly) suspended by iOS Safari, which is
aggressive about background tabs. For a 5-minute Meadow trip this rarely bites. For a 2-hour
incubation it usually does. That is the honest boundary and §2.6 is what we do about it: nothing,
deliberately.

### 2.4 Tier 2 in detail — the outbox, and the dumbest possible service worker

The service worker cannot run our TypeScript, cannot import our modules, and cannot be trusted with
game logic. So it is given **none**. At arm time the page writes a fully rendered outbox:

```ts
// IndexedDB, existing SaveStore seam, key "notify-outbox"
interface Outbox {
  readonly forSavedAt: number;          // the save's savedAt at arming time
  readonly entries: readonly {
    readonly dueAt: number;
    readonly title: string;             // already rendered
    readonly body: string;              // already rendered
    readonly tag: string;
  }[];
}
```

Every decision — which types, which copy, quiet hours, the daily cap, coalescing — was made by the
tested pure functions **before** the page went away. The SW's whole job is:

```
on wake (periodicsync | any event):
  outbox = get("notify-outbox")
  save   = get("latest")
  if (!outbox) return
  if (save.savedAt !== outbox.forSavedAt) { delete outbox; return }   // ← staleness guard
  for (e of outbox.entries) if (e.dueAt <= Date.now()) showNotification(e.title, {body, tag})
  delete outbox
```

**The `forSavedAt` check is the entire anti-staleness story for Tier 2** and it is exact: if the
player has played *at all* since the outbox was armed, the save has been rewritten with a newer
`savedAt`, and the whole outbox is discarded unshown. It cannot tell the player something they have
already handled, because "handled" and "the save moved" are the same event.

**Where the SW code lives.** `vite.config.ts` keeps `strategies: 'generateSW'` exactly as it is and
gains one line — `workbox.importScripts: ['pk-notify-sw.js']` — with the file in `public/`. This
pulls our listeners **into the existing service worker**; it does not create a second one, does not
change the precache strategy, does not require `injectManifest`, and adds no dependency. (The
alternative, switching to `injectManifest`, would pull `workbox-precaching` into the bundle as a de
facto runtime dependency, which §1's allowlist forbids without asking.) `globPatterns` already
matches `**/*.js`; exclude `pk-notify-sw.js` from the precache manifest so it is not cached as a
page asset.

**`periodicsync` registration** is Chromium-only, requires an installed PWA, and the browser grants
wake-ups based on site engagement — `minInterval` is a hint, not a contract. Register it with
`tuning.notifications.periodicSyncMinIntervalMs` (12 h) inside a `try`/feature-detect, and treat
every wake as a bonus. **Because Tier 2 may never fire for a given user, it is at real risk of being
a dead feature by the project's own standard.** Mitigation is mandatory and specified in §9.4: a
debug-menu button that drives the same drain path, and a test that proves the drain shows a
notification.

### 2.5 The one progressive enhancement worth five lines

`Notification.prototype.showTrigger` / `TimestampTrigger` is the API that would solve this problem
completely: hand the browser a timestamp and it fires the notification whether or not anything of
ours is running. It ran as a Chrome origin trial and **did not ship**; assume it is absent. But the
feature detect is trivial and the payoff is total, so:

```
if ("showTrigger" in Notification.prototype) → attach `showTrigger: new TimestampTrigger(dueAt)`
                                                and skip arming a timer for that entry
```

Guarded, five lines, zero cost if absent. Do not design anything around it and do not mention it in
any player-facing copy.

### 2.6 What we do NOT do about missed deliveries

**We never replay.** If the app opens and the plan says a homecoming was due four hours ago and no
notification was delivered, **nothing is shown**. The player is *here*; a notification would tell
them something they are two seconds from seeing. The Doorstep (retention bible §10.2 §4
"Homecomings") already tells that story properly, in order, with the right tone, and hands off to
the loot reveal.

Corollaries, all testable:

- On the app becoming visible, the scheduler **cancels every armed timer**, **clears the outbox**,
  and calls `registration.getNotifications()` and closes every notification whose tag starts with
  `pk-`. A stale notification sitting in the shade after the player has already come home is the
  precise failure this round exists to avoid.
- A notification is never shown while `document.visibilityState === "visible"`. The `notify()` seam
  enforces this in one place (§7.2).
- The ledger records *deliveries*, not *plans*, so a missed delivery consumes no daily budget.

### 2.7 The push server, named as a seam

If the owner ever wants Tier 3, the shape is already here and nothing in §1, §4 or §5 changes:

- The client calls `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`
  and POSTs the subscription to a tiny endpoint, together with the **already computed** outbox
  (`{dueAt, title, body, tag}` — the same objects §2.4 writes to IndexedDB).
- The server's only job is to sleep until `dueAt` and POST a VAPID-signed message. It runs no game
  logic and stores no game state, because the client already rendered the copy.
- The SW's `push` handler is one line: `event.waitUntil(registration.showNotification(data.title, data))`.

**This is infrastructure, and the working agreement says propose infrastructure before building
it.** It needs a host, a VAPID key pair, a privacy line about subscription endpoints leaving the
device, and a decision about a game that currently makes zero network calls. Ask; do not build.

---

## 3. THE PERMISSION FLOW

### 3.1 The rule

**Never on first launch. Never on load. Never from a timer. Only from a tap, and only once there is
genuinely something to be told about.** A cold permission prompt is the single most disliked pattern
on the web, it is unrecoverable when refused (browsers will not ask twice), and here it would be
asked before the player has any idea what we would use it for.

### 3.2 The exact moment

**Three seconds after the departure trot completes, on the player's first expedition send that
happens while onboarding is not active.**

- *Why after the send:* a trip is now running with a stated duration. The offer is concrete —
  "we can tell you when *this* is done" — instead of abstract.
- *Why not during onboarding:* spec §10.1 budgets ≤ 60 seconds for the whole ceremony and step 4 is
  the guided send. Dropping a browser permission dialog into it would wreck the acceptance-bar
  sequence. If onboarding is active, the ask defers to the next qualifying send.
- *Why three seconds:* the trot animation and its speech bubble own that beat. The card slides up
  after, from the bottom, non-blocking, over a settled screen — the same manners the Nook menu uses.

The card is **not a browser dialog**. It is our own card with two buttons; only the "yes" button
calls `Notification.requestPermission()`, and it does so **synchronously inside the click handler**,
because Safari requires a user gesture and Chrome heuristically penalises prompts that are not
gesture-bound.

### 3.3 The copy

```
title:   "Shall we tell you when they're back?"

body:    "Rooter is off to the Meadow for five minutes. If you wander away,
          we can tap you on the shoulder when they come home — and when an
          egg starts tapping back.

          That's the whole list. Nothing else, ever. No 'your Pips miss you'."

buttons: [ Yes, tap me ]   [ No thanks ]
```

The Pip's name and the biome are interpolated from the trip that just left — §15.5's "specific"
rule, and it is what makes the card read as the Keep talking rather than a consent banner. The last
line is a promise the catalogue can actually keep, which is why it is allowed to be that absolute.

**On "Yes, tap me":**
- Granted → master switch on, both types on, and a single toast: *"Lovely. We'll keep it to the
  interesting bits."*
- Denied at the browser dialog → **one** toast, no sulking: *"No problem at all — the Doorstep will
  tell you everything when you come back."* Then §3.4.
- Dismissed at the browser dialog (no answer) → treated as "not now", counts as one ask.

**On "No thanks":** the card slides away, no toast, no second thought. Recorded as `askedAndDeclined`.

### 3.4 On deny — the part that is easy to get wrong

- **Never re-prompt automatically. Not after n days, not after a level-up, not ever.** (Browsers
  will not honour it anyway after a hard deny; the point is that we would not even if they did.)
- **The game is completely fine.** Nothing in the catalogue is information the Doorstep does not also
  carry. There is no gated content, no reward for enabling, no badge, no asterisk anywhere in the UI.
  A player who never grants permission plays an identical game.
- The Notifications row in the Nook (§5) stays, showing the truth and the way back:
  - permission `default`, asked and declined by *us*:
    *"Off. Say the word and we'll ask again."* — tapping asks once more.
  - permission `denied` by the *browser*:
    *"Your browser is holding the door shut. If you change your mind, it's in the site settings for
    this page — we can't ask again from in here."* No deep-link (there isn't one), no instructions
    dressed up as a tutorial, no repetition.
- **A soft dismiss is not a deny.** If the player taps outside the card without choosing, we may ask
  again after `reAskAfterSends` (3) more sends, to a lifetime maximum of `maxAsks` (2). Then never.

### 3.5 The iOS path

iOS supports Web Push in PWAs from 16.4, **but only when the app has been added to the Home Screen
and launched from there.** In an ordinary Safari tab, `Notification` is not defined at all.

**Detection without UA sniffing** (which rots):

```
supportsNotifications   = "Notification" in window && "serviceWorker" in navigator
looksLikeHomeScreenGate = !("Notification" in window)
                          && "serviceWorker" in navigator
                          && "standalone" in navigator        // an iOS-Safari-only property
                          && navigator.standalone === false
```

That is: *the platform has service workers but is hiding notifications from us, and it is a browser
that has the `standalone` concept and says we are not in it.* That describes iOS Safari precisely and
degrades to "just don't offer it" everywhere else.

When `looksLikeHomeScreenGate`, the permission card is **replaced** (never shown alongside) by:

```
title:  "Pop us on your Home Screen first"

body:   "iPhones only let us wave at you from the Home Screen. Tap Share,
         then Add to Home Screen, and open PipsKeep from there — after
         that we can tell you when a trip's home.

         Everything works exactly the same either way. You'll just have
         to come and look, which is honestly half the fun."

button: [ Got it ]
```

Shown **once, ever**, automatically. It lives in the Nook row afterwards for anyone who wants it
back. The last sentence is doing deliberate work: it removes the pressure, it is true, and it
refuses to frame a whole platform's users as second class. **Never re-show it, never badge it, never
put a "install the app!" banner anywhere.** One warm explanation, then silence.

---

## 4. THE ANNOYANCE BUDGET

All numbers from `tuning.notifications`. Every rule here is enforced in **one pure function**,
`applyBudget`, which returns for every planned item either a delivery or a **named suppression
reason** — because a suppression that leaves no trace cannot be tested, and this round's mutation
stage will be told to delete each rule in turn.

```ts
type Suppression = "quiet-hours" | "daily-cap" | "min-gap" | "coalesced"
                 | "type-off" | "master-off" | "no-permission" | "already-delivered";
```

### 4.1 Quiet hours — 22:00 to 08:00 local, and how we know the time

**We need no timezone library and no new app-layer plumbing, because the game already computed
this.** `GameState.dayOffsetMs` is `dayStartHour·1h + getTimezoneOffset()·60_000`, set by
`SET_DAY_OFFSET` from `core/clock.ts`'s `localDayOffsetMs` — the one file allowed to ask what
timezone this is — and it is already refreshed at boot and on `visibilitychange`. Inverting it gives
local wall-clock time as pure integer arithmetic:

```
tzOffsetMs   = dayOffsetMs - dayStartHour * HOUR_MS
localMs      = now - tzOffsetMs
localHour    = floor((localMs mod DAY_MS) / HOUR_MS)
```

So `applyBudget` takes `dayOffsetMs` as a number and stays pure. DST and travel are handled exactly
as the streak already handles them — the offset is re-derived on the next visibility change, and a
wrong hour for one evening can only ever cost a notification, never send a wrong one.

**A notification due inside quiet hours is DROPPED, not deferred.** Deferring to 08:00 produces a
batch of buzzes at breakfast telling you about things that finished overnight — stale, chore-shaped,
and a re-engagement ping in everything but name. Dropping is silent and the Doorstep tells the story
properly whenever the player actually shows up. Suppression reason `"quiet-hours"`.

### 4.2 Volume

| Knob | Value | Reasoning |
|---|---|---|
| `maxPerDay` | **4** | Counted per `dayIndex(now, dayOffsetMs)` — the same 04:00-local day the streak and bounties use, so the whole game rolls over together. Over ~16 waking hours that is at most one interruption every four hours. |
| `minGapMs` | **25 min** | The real spam control. Three back-to-back 5-minute Meadow trips cannot produce three buzzes. Suppression reason `"min-gap"`; the suppressed item is simply not delivered — it is *not* queued for later. |
| `coalesceWindowMs` | **10 min** | Items of the same type whose `dueAt` fall within this window merge (§4.3). |
| `maxClausesPerNotification` | **2** | A body may name at most two things. A third becomes "…and more waiting". |
| `timerSlopMs` | **60 s** | Accepted lateness (§2.3); the tolerance tests assert against. |

### 4.3 Coalescing

1. **Within a type**, items whose `dueAt` fall within `coalesceWindowMs` of the earliest merge into
   one, which fires at the **latest** `dueAt` in the group (so nothing is announced early). Names are
   listed up to three, then "and N more".
2. **Across types**, if a second type's merged item falls within `minGapMs` of the first, the two
   merge into a single two-clause body rather than one being dropped:

   ```
   title: "The Keep has been busy"
   body:  "Rooter is home from the Meadow, and an egg is pipping."
   ```

   This is the **only** generic title in the catalogue, and it is only ever used when the body names
   both specific things — a vague title over a specific body is fine; a vague body is not, and would
   violate §15.5.
3. **Suffixes do not count as clauses.** An ailment or lineage suffix replaces the ordinary body of a
   single-Pip homecoming; it is never added to a coalesced multi-Pip body (there is no room to say
   which Pip, and a vague "one of them is hurt" is exactly the cruelty 2H cut). In a coalesced
   homecoming, suffixes are dropped and the Doorstep carries them.

### 4.4 The tag discipline

Every notification carries `tag: "pk-homecoming" | "pk-pipping" | "pk-keep"` and `renotify: false`.
The OS therefore *replaces* rather than stacks: a second homecoming while the first is still in the
shade updates it in place, silently. The shade can never accumulate a column of PipsKeep entries.

### 4.5 Cancellation — "already handled" is worse than none

Five independent mechanisms, in order of when they bite:

| # | Mechanism | Covers |
|---|---|---|
| 1 | **Recompute at fire time** (§2.3). The armed timer is a wake-up, not a payload; `planNotifications` runs again against current state. | The player acknowledged the reveal / hatched the egg before the timer fired. Nothing is in the new plan, so nothing fires. |
| 2 | **`forSavedAt` staleness guard** (§2.4). | Tier 2. If the player has played since arming, the whole outbox is dropped unshown. |
| 3 | **Clear on visible.** On `visibilitychange → visible`: cancel all timers, delete the outbox, and `registration.getNotifications()` → close every `pk-*` notification. | The player came back on their own and the shade still holds a buzz about it. |
| 4 | **Ledger dedupe.** Each delivery records `(typeId, subjectIds, dueAt)`; a plan item matching a recorded delivery is suppressed `"already-delivered"`. | Double-fire across a timer and an SW drain, or two tabs. |
| 5 | **Never replay on open** (§2.6). | Everything else. |

---

## 5. SETTINGS

### 5.1 Where

**One row in the Nook menu** (`src/ui/navMenu.ts`), directly under Quiet Keep — the game's de facto
settings drawer, already carrying a `role="switch"` row with the exact manners we want (it does not
close the popover on toggle, "a switch you can see change is a switch you can trust"). But
notifications need more than one switch, and a popover holding three destinations must not grow into
a preferences pane. So:

> The Nook row is a **destination**, not a switch. Label **"Tap on the shoulder"**, hint reflecting
> live state. Tapping opens a small sheet (the `buildSheet`/`itemsSheet` pattern, `--pk-z-sheet`).

The label is the game's own words for the thing, not "Notifications" — §0's vocabulary discipline
applied to a settings row. The *sheet's* heading may say "Notifications" once, because a player
hunting for this setting will scan for that word.

### 5.2 The sheet

```
Tap on the shoulder

  [ ✓ ]  Let us tap you on the shoulder            ← master
         On. We'll only ever use it for the two things below.

  [ ✓ ]  When a trip comes home                    ← typeId "homecoming"
         Who's back, what they're carrying, and if they came home
         with a scrape.

  [ ✓ ]  When an egg starts pipping                ← typeId "pipping"
         Tap-tap.

  ── We stay quiet between 10pm and 8am, your time, and never more
     than four times a day. ──

  What we will never send you
    · Anything about a Pip being unhappy or hungry.
    · Anything about a Pip being in danger. If there's bad news you
      can't act on from where you're standing, it waits until you're home.
    · Anything asking you to come back.
    · Anything about a streak.
```

The **"What we will never send you"** block is not decoration. It is the surface that makes the
deliberate cuts of §1.3 and §6 *visible to the player* — which, by spec §16 v1.3's standing rule, is
what stops four carefully argued cuts from being invisible non-features. It is also the most
trust-building copy in the game, and it costs four lines.

The quiet-hours line is **informational, not editable**, this round. Editing it needs a time picker,
a persisted pair of hours and a night-worker story; the fixed window can only ever *reduce*
notifications, so shipping it read-only is safe. Named as a deliberate cut in §12.

### 5.3 States and defaults

| Permission | Master default | Row hint |
|---|---|---|
| Never asked | **off** | "Off. We'll offer once you've got a trip running." |
| `granted` | **on**, both types **on** | "On — trips home and eggs pipping." |
| `default` (we asked, player declined our card) | off | "Off. Say the word and we'll ask again." (tap re-asks) |
| `denied` (browser) | off, all rows disabled | "Your browser is holding the door shut…" (§3.4) |
| iOS home-screen gate | off, all rows disabled | "Add PipsKeep to your Home Screen and we can wave at you." (tap re-shows §3.5) |

**Defaults are opt-in at every level**: nothing is on until the player says yes to the earned ask,
and turning the master off leaves both type toggles remembered but inert (greyed, still showing
their remembered value — so turning the master back on restores exactly what they had).

---

## 6. WHAT WE DELIBERATELY DO NOT SEND

Named, with the rule each one would break. This list is enforced twice: as a design contract here,
and as a **forbidden-substring test over every string in `copy.ts`** (§9.3).

1. **Anything about a loss approaching.** *Round 2H's cruelty audit, verbatim: a phone buzzing to
   tell someone their pet is dying, while they are at work and can do nothing, is the cruellest
   possible use of this feature.* No countdown, no "hurry", no "X hours left", no "you may lose".
   The words `dying`, `dies`, `lose`, `losing`, `lost`, `danger`, `critical`, `urgent`, `hurry`,
   `last chance`, `time is running out` are forbidden in every notification string. **This is the
   round's hardest rule and the one most likely to be eroded by a well-meaning later change**, which
   is why it is a test and not a paragraph.
2. **Anything about a need being low, or a Pip Sulking.** §4.4 and 2C's guardrail. These are
   absence-caused states by construction, so a notification about them *is* a punishment for absence
   wearing a friendly face. In-app toast only, forever — `app/alerts.ts` keeps its exact current
   behaviour and its events simply carry no `push` field.
3. **Anything about a Pip retiring to the Long Meadow.** Promise 3 says old age is peaceful.
4. **Anything about a streak, a rain day, or a grace day.** Retention bible §0.3, "no urgency
   surfaces". A streak notification is a loss-aversion lever and this game does not pull those.
5. **Anything about bounties, dailies, or "today's round".** §1.3. No deadline exists, so no
   reminder can be honest.
6. **Anything about affordability, resources, or the Keep ladder.** §1.3. Shop notification.
7. **Anything whose content is "come back".** No "your Pips miss you", no "it's been 3 days", no
   "the Keep is quiet without you", no re-engagement campaign in any costume. The Keep is fine. The
   Pips are fine. §4.5's offline rate cap makes that literally true, and the notification system is
   not permitted to imply otherwise.
8. **Anything at all while the app is open.** That is a toast's job, and doing both would be the
   most obviously broken thing we could ship.
9. **Badges.** No `navigator.setAppBadge`. A number on the app icon is an unclearable chore counter
   with no tone control at all, and it survives every rule in §4.

---

## 7. ARCHITECTURE

### 7.1 Files

| File | Purity | Owns |
|---|---|---|
| `src/app/notifications/plan.ts` | **pure** | `planNotifications(state, prefs, now) → PlannedNotification[]`. Derives due moments; selects flavour variants; picks bodies statelessly. |
| `src/app/notifications/budget.ts` | **pure** | `applyBudget(plan, ledger, dayOffsetMs, tuning, now) → { delivering, suppressed }` with a reason per suppression. Quiet hours, cap, gap, coalescing, toggles. |
| `src/app/notifications/copy.ts` | **pure, data** | Every string in §1 and §3. One module so the forbidden-word test has one target. |
| `src/app/notifications/types.ts` | **pure, data** | `NOTIFICATION_TYPES` — the const array the completeness test iterates. |
| `src/app/notifications/ledger.ts` | **pure** | Delivery record, day-bucketed; `record`, `deliveredToday`, `lastDeliveryAt`, dedupe. Serialised to IndexedDB by the channel. |
| `src/app/notifications/channel.ts` | **impure, fully injected** | Permission, `showNotification`, timers, outbox IO, `getNotifications().close()`, `periodicsync` registration, the `showTrigger` probe. |
| `src/app/notifications/scheduler.ts` | **impure, thin** | Wires `visibilitychange`, arm/wake/cancel. Calls the pure pair, then `notify()`. |
| `src/ui/notifySettings.ts` | DOM | The sheet (§5.2). Pure model builder + dumb shell, the house pattern. |
| `public/pk-notify-sw.js` | plain JS, logic-free | `notificationclick`, `periodicsync`, the outbox drain (§2.4). |

**Why `app/` and not `core/`.** `core/` is pure but it is also the *game*; a notification is not a
game rule and its copy is not game content. `src/app/alerts.ts` is the exact precedent — pure,
holds copy, testable without a DOM or a clock, deliberately outside `core/`. Nothing in this round
touches `core/`, which is also why nothing here can perturb an RNG cursor. Body selection uses a
throwaway `createRng(seed, dueAt)` that is never persisted — the same stateless-draw pattern
`streak.ts` uses for keepsake offers, chosen for exactly the same reason.

### 7.2 The seam — `notify(event)` becomes real

One change to `src/ui/notify.ts`, and it is the change the seam was written for in Phase 4:

```ts
export interface NotifyEvent {
  readonly kind: NotifyKind;
  readonly message: string;
  readonly onTap?: () => void;
  /** ROUND 2I: what this event looks like on a lock screen. ABSENT ⇒
   *  in-app only, forever — every existing call site is unchanged and
   *  every existing toast (needLow, sulking, info) stays in-app by
   *  construction, which is §6.2 enforced by the type system. */
  readonly push?: {
    readonly typeId: NotificationTypeId;
    readonly title: string;
    readonly body: string;
    readonly tag: string;
  };
}
```

and the routing decision, in **one** place:

```
notify(event):
  if (event.push === undefined || documentIsVisible()) → toast   (existing path, unchanged)
  else                                                 → channel.show(event.push)
```

Consequences worth stating:

- Fifteen existing `notify({...})` call sites compile and behave identically.
- "Never both" is structurally impossible, not a rule someone has to remember.
- **`sound("notify.toast")` must move inside the toast branch.** Today `notify()` plays it
  unconditionally; leaving it there would play a chime from a hidden tab alongside the OS's own
  notification sound. Small, and exactly the kind of thing that ships if it is not written down.
- `onTap` and `notificationclick` become the same idea: the SW's click handler focuses (or opens)
  the window and posts `{type: "pk-notification-click", tag}`; the page routes `pk-homecoming` to
  the loot reveal and `pk-pipping` to the nursery — the same destinations the toasts' `onTap` uses.

### 7.3 `vite.config.ts`

Two lines inside the existing `VitePWA({ workbox: … })` block: `importScripts: ['pk-notify-sw.js']`
and an exclusion so that file is not itself precached. **No strategy change. No second service
worker. No new dependency. The manifest, the precache globs and `navigateFallback` are untouched.**

### 7.4 `tuning.notifications`

Added to `src/content/tuning.ts` as a **commented-out block** this round (design only — a live key
with no consumer would be the dead feature this project keeps shipping). The build round uncomments
it. Every existing value in the file is byte-identical.

---

## 8. THE SAVE SCHEMA — NO BUMP, AND WHY

**`CURRENT_SCHEMA_VERSION` stays at 10. No migration, no new fixture.** This is a decision, not an
omission, and the counter-argument deserves an answer.

The obvious move is a `GameSettings.notifications` field beside `quietKeep`. It is wrong, for three
reasons:

1. **These preferences are device-local, not save-local.** Notification permission is granted per
   origin per browser profile. The same save opened on a laptop and a phone has two different
   permission states, two different outboxes, and two different delivery ledgers. Putting them in
   `GameState` would make one device's answer overwrite the other's.
2. **The debug menu exports and imports the save.** A save handed to another person, or restored on
   a new machine, must not carry "notifications on" from a device where a human granted permission.
   It would be a setting that is *true* and *unenforceable*.
3. **The precedent already exists and is explicitly documented.** `initSound` stores the mute
   preference "in IndexedDB under its own key, through the SAME key-value seam the save uses
   (`app/persistence.ts`'s `SaveStore`) … no save-version bump". Notification preferences are the
   same category of thing for the same reasons.

So three new records in the existing `pipskeep`/`saves` object store, through the existing
`SaveStore` interface, alongside `pref-sound`:

| Key | Shape | Lifetime |
|---|---|---|
| `pref-notify` | `{ master: boolean, types: Record<NotificationTypeId, boolean>, asks: number, declined: boolean, iosNoticeShown: boolean }` | Forever, per device |
| `notify-ledger` | `{ day: number, deliveries: {typeId, subjectIds, dueAt, at}[] }` | Pruned to the current and previous day |
| `notify-outbox` | §2.4's `Outbox` | Written on hide, deleted on visible / on drain / on staleness |

`GameSettings` is untouched. `core/save/*` is untouched. **The one condition that would force a bump
is a notification preference that changes gameplay** — and none does, by design: `quietKeep` alters
what the reducer rolls; nothing here alters anything the reducer does.

Missing or malformed records fall back to defaults, and a throwing `get` is swallowed exactly as
`initSound` swallows it. A browser with no IndexedDB plays the game without notifications rather
than not at all.

---

## 9. PROVING IT — THE TEST PLAN

> Notifications are famously hard to test, and this codebase has shipped seven dead features. The
> seam is therefore designed **for the test first**: all decisions in pure functions, all effects
> behind an injected interface, and one guard whose specific job is to make a
> scheduled-but-never-delivered type impossible.

### 9.1 Pure — `plan.test.ts`

- An expedition departing at `T` with `durationMs = D` produces exactly one item, `dueAt === T + D`.
  With `careful: true`, `dueAt` uses the stored (already-multiplied) `durationMs` — the multiplier is
  never re-applied.
- An `Incubating` egg produces `dueAt === incubationStartedAt + incubationMs`; a `Found` egg and a
  `Pipping` egg produce **nothing** (`eggReadyAt` returns null).
- A returning-with-ailment run produces the ailment-suffix body, **exact string**.
- A returning-with-lineage-egg run produces the lineage-suffix body, and **the lost Pip's name does
  not appear in it** (assert `not.toContain`).
- Both suffixes at once → lineage wins, ailment clause absent.
- 1 / 2 / 3 / 5 Pips produce the singular, plural, three-name and "and N more" forms.
- Body selection is deterministic for a given `(seed, dueAt)` and **consumes no `rngState` cursor**
  (assert `state.rngState` is referentially unchanged).

### 9.2 Pure — `budget.test.ts`

One test per suppression reason, each asserting the reason *by name*:

- 22:30 local (constructed via a `dayOffsetMs` for a known offset) → `"quiet-hours"`, and 08:01 →
  delivered. Both hemispheres' offsets, and a negative-offset timezone, so the modular arithmetic is
  actually exercised.
- Fifth delivery in one `dayIndex` → `"daily-cap"`; the first delivery after 04:00 local → delivered.
- Two items 5 minutes apart → second `"min-gap"`. Two items 30 minutes apart → both delivered.
- Two homecomings 4 minutes apart → **one** item naming both, firing at the later `dueAt`.
- A homecoming and a pipping within `minGapMs` → one two-clause body containing both nouns.
- Master off → `"master-off"` for everything. One type off → `"type-off"` for that type only.
- A recorded delivery replays → `"already-delivered"`.
- **Invariant test:** `delivering.length + suppressed.length === plan.length`, always. Nothing may be
  silently lost.

### 9.3 Copy — `copy.test.ts`

- **Forbidden vocabulary**, over every string the module can produce (all variants, all counts):
  the §6.1 danger list, plus `-gotchi` / `Pal` / Pokémon / Tamagotchi terms (spec §0), plus
  guilt-shaped substrings (`miss you`, `haven't`, `come back`, `don't forget`, `still waiting`,
  `days since`), plus time words (`just now`, `a minute ago`, `minutes ago`) that §2.3's lateness
  would make false. **Derive the Pip-name and item-name collision check from the content registries
  the way `content/names.test.ts` already does**, so the rule cannot rot as content grows.
- No string exceeds a sane lock-screen budget: title ≤ 48 chars, body ≤ 160.
- Every string is non-empty for every variant × count combination.

### 9.4 Effects — `channel.test.ts`

`channel.ts` takes a `NotificationChannelDeps` with every dependency injected: `permission()`,
`requestPermission()`, `registration()`, `setTimeout`/`clearTimeout`, `visibilityState()`, a
`SaveStore`, and a `Clock`. The fake registration records `showNotification(title, options)` calls.

- **One test per notification type asserting the exact `(title, body, tag)` that reached
  `showNotification`.** This is the "proven to fire" test and there is one per row of the catalogue.
- Permission `denied` → zero calls, no throw.
- `visibilityState: "visible"` → zero `showNotification` calls (the seam took the toast branch).
- Arm → advance the fake clock past `dueAt` → exactly one call. Advance again → no second call.
- Arm → become visible before `dueAt` → timer cancelled, **zero** calls, outbox deleted,
  `getNotifications()` walked and every `pk-*` notification `close()`d.
- Outbox drain with a **matching** `forSavedAt` → shows. With a **stale** `forSavedAt` → shows
  nothing and deletes the outbox.
- `requestPermission` is only ever called from inside the card's click handler (asserted by the UI
  test in 9.6, which fires a real `click` event).

### 9.5 The anti-dead-feature guard — `catalogue.test.ts`

The guard that makes "scheduled but never delivered" structurally impossible:

```
for every typeId in NOTIFICATION_TYPES:
  ✓ copy.ts exports a non-empty title+body for it
  ✓ plan.ts has a branch that can emit it        (proven by a fixture that does)
  ✓ notifySettings.ts's model contains a row for it
  ✓ pref defaults contain a key for it
  ✓ channel.test.ts's recorded-delivery set contains it   ← the load-bearing one
```

The last line works by having `channel.test.ts` export the set of typeIds it actually saw reach
`showNotification`, and asserting it covers `NOTIFICATION_TYPES` exactly. **Adding a type without
delivering it in a test fails the build.** Adding a type without a settings row fails the build.
This is the round's answer to the seventh dead feature.

### 9.6 UI — `notifySettings.test.ts`, `navMenu.test.ts`, permission card

Per §16 v1.7's "a guard that never renders is not a guard": these build the DOM and query nodes, not
just call model functions.

- The Nook renders the "Tap on the shoulder" row; tapping opens the sheet.
- The sheet renders master + one row per type + the quiet-hours line + **all four "never send"
  bullets** (assert the text, so deleting the trust block fails).
- `denied` state disables every row and renders the browser-settings hint.
- The iOS-gate state renders the Home Screen card and **not** the permission card.
- The permission card interpolates the actual Pip name and biome of the trip that just left.
- `requestPermission` is invoked synchronously within the click handler's call stack.

### 9.7 Mutation targets to hand the mutation stage

Each must turn a test red:

| Break this | Should fail |
|---|---|
| Delete the quiet-hours check in `applyBudget` | `budget.test.ts` |
| Delete the `documentIsVisible()` branch in `notify()` | `notify.test.ts` ("never both") |
| Delete the `getNotifications().close()` on visible | `channel.test.ts` |
| Delete the `forSavedAt` staleness check | `channel.test.ts` |
| Make `applyBudget` return everything as `delivering` | four `budget.test.ts` cases |
| Remove a type from `NOTIFICATION_TYPES` but leave its copy | `catalogue.test.ts` |
| Add a type with no `channel.test.ts` delivery | `catalogue.test.ts` |
| Let the ailment suffix create its own plan item | `plan.test.ts` (§1.1's hard rule) |
| Re-apply the careful-route multiplier in `planNotifications` | `plan.test.ts` |
| Leave `sound("notify.toast")` outside the toast branch | `notify.test.ts` |

### 9.8 Manual gate (the part tests cannot reach)

1. Grant permission, send a Meadow trip, switch to another tab, wait 5 minutes → notification arrives
   with the right name and biome. Click it → the tab focuses and the loot reveal is open.
2. Same, but come back to the tab at 4 minutes → no notification ever appears, and the shade is empty.
3. Same, but with the system clock at 23:00 local → no notification; the Doorstep tells it on return.
4. Three trips returning within 10 minutes → exactly one notification naming three Pips.
5. Debug-menu "drain outbox" button → a notification appears (this is the only practical way to
   exercise Tier 2, and it exists precisely so Tier 2 is not a dead path).
6. iOS Safari tab → the Home Screen card, not the permission card, and no console errors.
7. Deny permission → the game plays identically; every notification's content is present in the
   Doorstep.

---

## 10. VISIBILITY TABLE

Per the working agreement: mechanic → where it is decided → **every** surface the player meets it on.

| Mechanic | Decided in | Player sees it at |
|---|---|---|
| Homecoming notification | `plan.ts` + `budget.ts` | The lock screen / notification shade; the toast when visible; the Doorstep's "Homecomings" section when neither fired |
| Pipping notification | same | same, plus the nursery badge |
| Ailment suffix | `plan.ts` | The homecoming body; the Doorstep; the ailment view's countdown ring |
| Lineage suffix | `plan.ts` | The homecoming body; the loot reveal (the real moment) |
| Quiet hours | `budget.ts` | The settings sheet's quiet-hours line |
| Daily cap | `budget.ts` | The settings sheet's quiet-hours line ("never more than four times a day") |
| Coalescing | `budget.ts` | The plural bodies |
| Per-type toggles | `pref-notify` | The settings sheet's two rows |
| Master switch | `pref-notify` | The settings sheet's first row + the Nook row's hint |
| The permission ask | `scheduler.ts` | The card, once, after the first post-onboarding send |
| The iOS gate | `channel.ts` | The Home Screen card + the Nook row hint + the sheet |
| The deliberate cuts (§6) | this document | **The "What we will never send you" block** — the only reason four cuts are visible instead of invisible |

---

## 11. RISKS

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | **Tier 2 never fires for anyone** (`periodicsync` is Chromium+installed+engagement-gated) and becomes the eighth dead feature | High | Labelled best-effort in this document; the debug-menu drain button and `channel.test.ts`'s drain cases keep the path exercised and provable. If the build round finds `periodicsync` never granted in practice, **cut Tier 2 rather than ship it dark** — Tier 1 is the round either way. |
| 2 | **iOS delivers almost nothing** even when installed (aggressive suspension) | High, unavoidable | Honesty in §3.5's copy; no feature is gated on notifications; nothing implies iOS players are missing out. |
| 3 | **Timer lateness makes copy wrong** | Medium | No time words in any string (§9.3 enforces it); `timerSlopMs` is the asserted tolerance. |
| 4 | **A later round adds a "loss approaching" notification in good faith** | High if it happens | §6.1's forbidden-vocabulary test is the guard, and it is a test rather than a paragraph precisely because paragraphs erode. |
| 5 | **Permission asked at the wrong moment** by a future change | Medium | The ask has exactly one call site (`scheduler.ts`), guarded on `!onboarding.active` and on the ask counters; the UI test asserts gesture-bound invocation. |
| 6 | **Two tabs open → duplicate notifications** | Low | `tag` replacement makes it visually idempotent; the ledger dedupe catches the rest. |
| 7 | **`importScripts` interacting badly with `autoUpdate`** | Low | The extra script is precache-excluded and revisioned by the SW's own URL; verify a deploy-over-deploy update in the manual gate. |
| 8 | **Clock skew / DST changes the quiet-hours window mid-session** | Low | `dayOffsetMs` is already refreshed on `visibilitychange`; the failure mode is one dropped notification, never a wrong one. |
| 9 | **Scope creep into a push server** | Medium | §2.7: named as a seam and an infrastructure proposal. Do not build it without the owner's go-ahead. |

---

## 12. FINDINGS — decisions I did not make, and what I would ask for

1. **The push server (§2.7) is the only way to reach a genuinely closed device, and it is an
   infrastructure decision, not a code one.** It needs a host, VAPID keys, and — most significantly —
   it would give PipsKeep its first ever network call, which spec §1 currently rules out. Worth
   asking, and worth asking *after* Tier 1 has been played with, because Tier 1 may prove to be
   enough.
2. **Editable quiet hours** are cut this round (§5.2). If a night-shift player ever complains, the
   fix is a two-hour-picker row and a pair of numbers in `pref-notify`; nothing else changes.
3. **I did not give notifications a sound or vibration pattern.** The OS owns both, players have
   configured them, and overriding is presumptuous. Explicitly: no `vibrate`, no `silent`, no
   `requireInteraction`.
4. **I did not add an icon/badge image to `showNotification`.** We have `icons/pip-192.png`
   precached; the build round should pass it as `icon` and add a small monochrome `badge` asset
   for Android's status bar. That is an art task, not a design one.
5. **The one thing I would most like to add and did not**: a notification for *"the cure you left
   brewing worked"* — the only genuinely joyful ailment message. It is cut because it resolves inside
   the live `TICK` arm, which never runs while hidden, so it could not be scheduled ahead without
   simulating the reducer forward — and simulating RNG-consuming reducer arms ahead of time is a
   determinism hazard I am not willing to introduce for one notification. Revisit only if the push
   server lands.
6. **Four notification types were cut and two shipped.** If the build round finds itself adding a
   third, re-read §1.0's four questions before writing any code. The permission card promises
   *"That's the whole list. Nothing else, ever."* — and that promise is now a shipped string.
