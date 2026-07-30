# The HUD redesign — Round 2G

**Author:** Oracle visual pass (round 2G, step 1 of 2). **Status:** specification, ready to build.
**Read with:** `PIPSKEEP_SPEC.md` §10, `docs/progression-bible.md` §0.2/§1.2, `docs/retention-bible.md` §10.

The owner's brief, verbatim: *"The top UI with the pips and status bar is clunky for a game — this
needs a strong revision pass to update."*

Everything below was measured in the running build at HEAD `47760cf`, at **375×812** and **1280×800**,
against a save at Keep tier 6→12 with 1, 3 and 5 Pips, one Pip on expedition, three Pips sulking, all
needs at 0, 14 satchel item types, the XP bar mid-gain and at Ready, a real tier purchase, the day-2
Doorstep, and the Build sheet with all 45 items. Every number carries the viewport it was taken at.
Every height in §1.1 is read off the page. Two figures in this document are instead derived from the
CSS box model — the roster-overflow arithmetic in **N4** and the target heights in §2 — and both say
so. The box model is trustworthy here: predicting the three measured top-bar heights from `ui.css`
alone gives 223.5 / 243.5 / 289.5px against measured 223 / 245 / 291px.

---

## 0. The finding that reframes this round

**Eight of the ten failures on the round's work-list were already fixed inside round 2F, after 2F's
own audit wrote them down.** I verified each one in the browser. A builder handed the raw list would
"fix" working code, and would very likely regress it.

| # | The listed failure | Verdict at `47760cf` | Evidence |
|---|---|---|---|
| 1 | Doorstep reports only decay | **Partly fixed** | XP + production lines exist; see §5.1 for what is still wrong |
| 2 | Loot reveal shows no XP | **FIXED** | reveal card renders `+7 Keep XP` |
| 3 | XP track is 56px wide | **FIXED** | measured **209.7px** at 375px — 2F rebuilt the widget as a 2-row grid |
| 4 | Set bonuses never stated | **FIXED** | every set group prints both bonus tiers verbatim + the next step |
| 5 | Celebrations collide with the top bar | **NOT FIXED** | banner printed over the satchel rows *and* the whole XP bar; see §4 |
| 6 | Ready chip is inert; two Keep chips | **FIXED** | chip is a real `<button>`; `phase5.ts` chip now reads `The Keep`, not a level |
| 7 | Bar advertises "+2 rows of ground" | **FIXED** | all 11 next-tier labels read from `headline`, all name a real carrot |
| 8 | Bar shows over-100% | **Fixed in the bar, live in the upgrade card** | bar: `2,300 / 2,300 · banked`. Card header: `2,970 / 2,300 Keep XP` |
| 9 | Build sheet is 13 screens | **FIXED** | measured scrollHeight **883px = 1.09 screens**; locked cards *do* show cost |
| 10 | Every visibilitychange re-gates the session | **Partly fixed** | `isTrivialAbsence` kills the modal wall; `ticker.ts` still dispatches on every flick |

So this is **not** a bug-fix round. Round 2F closed its own audit list. What is left is exactly what
the owner said: the top bar is clunky **as a design**, and no amount of fixing individual widgets
changes that, because the problem is that there are too many widgets.

Seven new defects that the list does not contain are in §1.6. One of them is a live violation of a
standing spec rule and is the most serious thing in this document.

---

## 1. Honest critique

### 1.1 The measurement that is the whole argument

| Viewport | Roster | Satchel | `.pk-topbar` height | + action bar | Chrome as % of screen | Playfield left |
|---|---|---|---|---|---|---|
| 375×812 | 1 pip *(fresh save, post-onboarding)* | 1 chip row | **223px** *(measured)* | 306.5px | 37.7% | 505.5px |
| 375×812 | 3 pips | 5 chips / 2 rows | **245px** *(measured)* | 328.5px | 40.5% | 483.5px |
| 375×812 | 5 pips | 14 chips / 4 rows | **291px** *(measured)* | 374.5px | **46.1%** | 437.5px |
| 1280×800 | 5 pips | 14 chips / 1 row | **223px** *(measured)* | 306.5px | 38.3% | 493.5px |

A persistent header that consumes **between 27% and 36% of a phone screen on its own**, and whose
height is a function of how well the player is doing: it grows **68px — a full extra row of chrome —
purely as a reward for accumulating things and hatching Pips.** The better you play, the less game you
can see. That inversion is the single worst property of the current design.

And 437px is the *optimistic* figure, because the playfield is not clear. Measured float census at
375×812: Nook button `(12, 544) 44×44`; sound toggle `(323, 594) 40×40`; debug toggle `(331, 646)`;
Keep chip `(12, 619) 90×34`; Build button `(12, 660) 74×34`. Everything below y=544 on the left and
y=594 on the right is chrome. **The unobstructed world is a 375×253 band** — 12% of the screen —
in a game whose entire appeal is watching small creatures potter about in it.

### 1.2 What a player's eye actually does

Land on the Keep view at 5 Pips. In order:

1. **Five faces.** Good — this is the game. The eye lands here because faces always win. ~0.3s.
2. **A name and a word.** `Thistledown / Chaotic`. The eye reads it because it is the only large text.
   It then discovers this is information it already had: the highlighted chip said the same thing.
3. **A wall of eight numbers and four bars.** `Food 8 / Clean 0 / Happy 12 / Energy 19`. The eye does
   not read these as a game state. It reads them as *a form*. There is no ranking, no urgency, no
   colour hierarchy beyond the bar fill, and — critically — they describe **one** of the five faces
   above, with no visual tie back to which one.
4. **Fourteen grey pills.** `Berry ×156 Stew ×12 Honeydrop ×7 Toastnut ×9 Frostberry ×4 Cocoa Bun ×3
   Glowcap ×6 Tideroll ×2 Emberloaf ×5 Feastpot ×1 Fiber ×409 Wood ×392 Shell ×406 Driftwood ×404`.
   The eye **skips this entirely** after the first session. It is a warehouse manifest, styled
   identically pill-to-pill, with no answer to any question the player has. It costs 86px.
5. **The XP bar, last, at the bottom edge of the chrome.** The round's headline feature, in the
   position reserved for footnotes.
6. Then the eye finally reaches the world, 291px down, and finds the Pips clustered in a band with a
   menu button, a speaker, a wrench, a "The Keep" chip and a "Build" button lying on top of them.

That is a **dashboard reading order**, not a HUD reading order. A HUD answers three questions in this
order: *does anything need me → what did I just earn → what can I do*. This one answers *who is
selected → what are their four integers → what is in the warehouse → oh, and progress*.

### 1.3 The information is in the wrong shape, not merely the wrong place

- **Four labelled bars show one Pip's needs, using 28px + 351px of the most valuable pixels on the
  screen.** Meanwhile the other four Pips' needs — the actual answer to *does anything need me* — are
  compressed into a single 14px mood dot each. The layout spends its budget on the Pip you already
  chose and starves the four you did not. At 5 Pips there are 20 need values in play and the bar
  shows 4 of them at 88px each.
- **The numerals are an audit trail, not a game readout.** Nobody plays off `Food 33`. `Food 33` is
  how you *verify* a bar you already read. It belongs in the focus view — which already has it, at a
  legible size, with a mood line and personality flavour (verified: the focus view renders all four
  needs with labels and values, plus `● Feeling Miserable`, plus the pity counters). Every numeral in
  the top bar is a duplicate of something one tap away.
- **The satchel row is the only surface for `state.resources`** (verified: `itemsSheet.ts` reads
  `state.inventory` only, so Wood/Fiber/Shell/Driftwood exist nowhere else outside a build screen).
  That is why it cannot simply be deleted — it has to be *relocated*, and §2.5 says where.
- **Two rows say "who is selected".** The active chip's `--active` ring already says it. The identity
  row repeats it in words. The `i` badge is `aria-hidden` decoration on top of that. Three signals,
  one fact.

### 1.4 The XP bar is well-built and badly sited

2F's rebuild is genuinely good — a 2-row grid, a 209.7px track, a 12px height, a `+N` flight chip, a
2px tick floor, `banked` numerals, headline-named carrots, a real `<button>`. None of that is the
problem. The problem is 600 pixels:

> The Feed button is at `(12, 729)`. The bar that Feed fills is at `(24, 240)`. **The reward is 489px
> from the action that earns it**, on the opposite end of a phone. The `+N XP` chip floats up in a
> place the player's eye demonstrably is not, because their thumb is at the bottom of the screen and
> their attention is on the Pip they just fed.

The bible's own §0.2 promise — *"the bar always acknowledges you"* — is implemented perfectly and
delivered to an empty room.

### 1.5 Desktop is not designed, it is stretched

At 1280×800: a need bar's track is **541px wide** to express a number between 0 and 100. The XP
track is **1112px**, so its numerals sit ~1100px from its level chip and the eye has to travel the
full width of a monitor to pair a fill with a figure. Fourteen satchel pills spread across 1256px.
The top bar has no `max-width` anywhere. Neither does the action bar, whose six buttons become
213px-wide slabs.

### 1.6 Seven defects the work-list does not contain

**N1 — Sulking is invisible in the top bar. This violates a standing spec rule.**
Spec v1.3 §10: *"anything that reports Sulking to the player must use `isSulking`, never
`activity === "sulking"` — a Pip can nap through a sulk."* `topBar.ts`'s `statusGlyph(activity)` and
`identitySubtitle(pip)` both key off `activity` only. `focusView.ts` never mentions sulking at all.
Measured state, one save, five Pips:

| Pip | `activity` | `sulking` | needs | Top bar says |
|---|---|---|---|---|
| Bramblewick | `sulking` | true | 0/0/0/0 | `…` badge ✓ |
| **Thistledown** (active) | `idle` | **true** | **0/0/0/0** | **nothing. Subtitle reads `Chaotic`.** |
| Marigold | `sulking` | true | 14/0/31/0 | `…` badge ✓ |

The game's loudest "you must act now" state is reported for some Pips and silently dropped for
others, on the same screen, at the same moment. Inconsistency is worse than absence: the player
learns the badge means something, then it lies. `awaySheet.ts` is the only surface that gets this
right — it imports `isSulking`.

**N2 — The most important button in the round has a 45×20px hit box.** Measured
`.pk-xpbar-chip` = `45.3 × 20`. 20px tall, against the ~44px minimum for a thumb. It is also the
element that *pulses gold* to demand a tap.

**N3 — Failure 8's fix never reached the upgrade card.** The bar says `2,300 / 2,300 · banked`; the
card header, opened by tapping that same bar, says `2,970 / 2,300 Keep XP`. Measured three times at
three tiers (`2,970 / 2,300`, `920 / 900`, `171 / 1,150`). Two surfaces, one number, two answers.

**N4 — The roster strip overflows at the roster cap.** `.pk-topbar` content width at 375px is 351px.
`.pk-chipbtn` is 52px (46px art + 3px padding ×2); `.pk-selector { gap: 8px }`; no `flex-wrap`.
6 Pips = `6×52 + 5×8 = 352px` → **1px over, chips clip**. With a pending reveal chip
(`+4px margin + 40px`) it is **396px — 45px of overflow.** Roster 6 is reachable:
`rosterCapUpgraded: 5` plus `rosterCapBonusByLevel: { 11: 1 }`. The save I tested had reached tier 11.

**N5 — The reveal chip reflows the roster.** It is appended *after* the last Pip chip, so every
expedition return shifts every portrait left by 44px and back again. The cast strip should be stable
furniture; a returning Pip should not move everyone's face.

**N6 — `role="status"` on the XP bar announces XP on every grant.** `.pk-xpbar` carries
`role="status"` (implicit `aria-live="polite"`) and its numerals change on every `keepXp` change. A
screen-reader user is read a number every few seconds during ordinary play.

**N7 — The tier-up banner and the milestone ribbon are only visible if you are quick.** Both fire
correctly (mutation observer: `.pk-levelup--open` applied 11ms after the purchase tap), but they open
*while the Keep upgrade card is still open* — the card is not dismissed by the purchase — and both
auto-dismiss (4000ms / 5000ms) whether or not the player has yet closed the card and looked. This is
adjacent to failure 5 and the fix in §4 covers it.

*Not verified, flagged only:* while scripting I reached a state with the focus view open over the
Build sheet (two overlays). I induced it with a synthetic backdrop click, so I make no claim; it is
worth a hand check against main.ts's one-surface-at-a-time rule.

---

## 2. The redesign

### 2.1 Principle

> **The top of the screen is the cast. The bottom of the screen is the verbs and the reward. The
> middle is the game. Detail is one tap away and lives in exactly one place.**

Three consequences, and they drive every number below:

1. **The HUD's height stops depending on the save.** Fixed 96px top / 156px bottom at every roster
   size and every satchel state. A HUD that grows is a HUD that cannot be composed against.
2. **Needs move from *one Pip, four bars* to *every Pip, four bars*.** Same pixel budget, five times
   the information, and it finally answers *does anything need me*.
3. **The XP bar moves to the thumb.** Directly above the action bar, so a Feed tap and the bar it
   fills are 8px apart.

### 2.2 The layout, at 375×812

```
┌───────────────────────────────────────────────┐  y=0
│ .pk-hud-top                        96px       │
│  ┌───┐ ┌───┐ ┌───┐ ┌───┐ ┌───┐        ┌────┐  │  row A1  64px
│  │ ◉ │ │ ◉ │ │ ◉ │ │ ◉ │ │ ◉ │        │ !2 │  │   chips + alert
│  │▁▄█│ │▁▁▁│ │███│ │▄██│ │███│        └────┘  │   comb under each face
│  └───┘ └───┘ └───┘ └───┘ └───┘                │
│  Thistledown · Chaotic · sulking · Clean empty│  row A2  15px
└───────────────────────────────────────────────┘  y=96
   ┌──┐                                            Nook float, y=106
   │☰ │
   └──┘
                  T H E   W O R L D                 560px of it
                  (one 44px float, nothing else)

┌───────────────────────────────────────────────┐  y=656
│ .pk-keepstrip                       72px      │
│ ┌──────────┐ ┌──────────────────┐  ┌────┐     │  row 1  40px
│ │Lv 7▸Ready│ │███████▏ 920/1,150│  │ ⚒  │     │
│ └──────────┘ └──────────────────┘  └────┘     │
│ ▸ Ready — the Workbench and the Mending job   │  row 2  18px
└───────────────────────────────────────────────┘  y=728
┌───────────────────────────────────────────────┐
│ Feed  Clean  Play  Pet  Rest  Items    84px   │  unchanged
└───────────────────────────────────────────────┘  y=812
```

**Budget.** 96 + 72 + 84 = **252px of chrome (31%)**, constant. Playfield **560px**, up from 437.5px
at 5 Pips (+28%) and 483.5px at 3 Pips (+16%). Floats over the world: **one** (44px), down from five.

### 2.3 `.pk-hud-top` — the cast strip (replaces `.pk-topbar`'s five rows)

Container:

```css
.pk-hud-top {
  pointer-events: auto;
  position: absolute; top: 0; left: 0; right: 0;
  padding: calc(env(safe-area-inset-top, 0px) + 6px) 12px 6px;
  display: flex; flex-direction: column; gap: 4px;
  /* unchanged from .pk-topbar: */
  background: rgba(255, 253, 246, 0.82);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  border-bottom: 1.5px solid rgba(95, 138, 94, 0.18);
  border-radius: 0 0 18px 18px;
}
.pk-hud-top > * { max-width: 720px; width: 100%; margin: 0 auto; }  /* desktop cap */
```

Measured acceptance: height **96px ± 2** at 375×812 for rosters of 1 and 6, with and without a pending
reveal, with 0 and 14 satchel item types.

**Row A1 — `.pk-cast-row`, 64px.** `display:flex; align-items:center; gap:6px;`
- `.pk-cast` — `flex: 1 1 0; min-width: 0; display: flex; gap: 6px;` holds the Pip chips.
- `.pk-hud-alert` — `flex: 0 0 40px`, present only when `state.pendingReveals.length > 0`. **Pinned to
  the right end, outside `.pk-cast`** (fixes N5: the roster no longer reflows when a Pip returns).

**Chip sizing — fixes N4 by construction.** The controller writes `--pk-cast-n: <rosterOrder.length>`
onto `.pk-cast` in `sync()`. CSS:

```css
.pk-castchip {
  flex: 0 0 auto;
  width: min(52px, calc((100% - (var(--pk-cast-n, 3) - 1) * 6px) / var(--pk-cast-n, 3)));
  height: 64px;                 /* the whole face+comb column is the tap target */
}
```

Reserved by the alert chip: `40 + 6 = 46px`, so `.pk-cast` gets 305px at 375px.
Resulting art width: **1–5 Pips → 52px (capped); 6 Pips → 45px.** Verify by measurement at 6.

**Chip contents** (`.pk-chip`, `position: relative; width: 100%; aspect-ratio: 1`):
- Portrait blob, eyes, accent sprout, `--pk-accent` — **unchanged**, including palette resolution.
- **Mood dot — keep.** 14px, bottom-right, unchanged. It is not redundant with the comb: it renders
  `displayedMood`, which carries Chaotic's §4.3 one-step-off lie. The comb shows the truth; the dot
  shows what the Pip is willing to admit. That is flavour worth 14px.
- **Status badge — keep the position and size, change the rule.** See §2.7 (N1).
- **NEW: the need comb.** Four bars under the face, in a 10px band, `NEED_IDS` order
  (hunger, cleanliness, happiness, energy), colours straight from `needColors`:

```css
.pk-comb { display: flex; justify-content: center; gap: 2px; height: 10px; margin-top: 2px; }
.pk-comb-track { width: 6px; height: 8px; border-radius: 2px;
                 background: rgba(61, 74, 61, 0.16); align-self: flex-end;
                 display: flex; align-items: flex-end; overflow: hidden; }
.pk-comb-fill  { width: 100%; border-radius: 2px;
                 transition: height 500ms cubic-bezier(0.22, 1, 0.36, 1), background 300ms ease; }
```

`height: <need>%`, floored at **1px** so an empty need is a visible dark slot, never a missing bar.
Fill colour uses the **existing thresholds unchanged**: `needDangerColor` below 15,
`needWarnColor` below 40, else `needColors[need]`. `aria-hidden="true"` — the chip's own label
carries the words (§2.8).

- **NEW: the alert ring**, composed on the button so it survives `--active`:

```css
.pk-castchip--care   { box-shadow: 0 0 0 2px   rgba(230, 168, 74, 0.85); }  /* min need < 40 */
.pk-castchip--urgent { box-shadow: 0 0 0 2.5px rgba(217, 106, 106, 0.95);
                       animation: pk-chip-throb 1600ms ease-in-out infinite; }
@keyframes pk-chip-throb { 0%,100% { transform: scale(1); } 50% { transform: scale(1.06); } }
```

`--urgent` when `min(needs) < 15` **or** `isSulking(pip)`. `--urgent` wins over `--care`. The active
chip's `background: rgba(124,194,131,0.22)` stays; only its `box-shadow` is replaced by the ring, so
"who is selected" and "who needs me" never fight for the same channel.

**Row A2 — `.pk-hud-line`, 15px.** One element: `.pk-hud-who`, a `<button>`, `flex:1 1 auto;
min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:left;
font-size:11px`. Tapping opens the focus view (today's `.pk-identity` behaviour, kept).

Content is a pure function — put it in `topBar.ts` beside `identitySubtitle` and unit-test it:

```
<Name>[ · <Personality>][ · <status>][ · <NeedLabel> is low | <NeedLabel> is empty]
```

- `<Name>` at `font-weight: 700`, everything after it at `font-weight: 400; opacity: 0.62`.
- `<status>` from the corrected status rule (§2.7). Omitted when there is none.
- The need clause names **exactly one** need — the lowest — and only when it is below 40:
  `is low` below 40, `is empty` below 15. Labels are the existing `NEED_LABELS`
  (`Food / Clean / Happy / Energy`). Ties break in `NEED_IDS` order.
- This clause is also the comb's legend: it teaches the colour→need mapping in context, which is why
  the comb needs no labels of its own.

Examples, pinned as test cases:
`Pipsqueak · Bold` · `Marigold · Curious · gathering away · Clean is empty` ·
`Thistledown · Chaotic · sulking · Clean is empty` · `Bramblewick · Lazy · off exploring · Happy is low`

**Row A2 carries nothing else.** No satchel counts, no streak. See §2.5 and §6.

### 2.4 `.pk-keepstrip` — the Keep strip (where the XP bar lives now)

```css
.pk-keepstrip {
  pointer-events: auto;
  position: absolute; left: 0; right: 0;
  bottom: var(--pk-actionbar-h, 84px);
  z-index: 5;                        /* the rung .pk-xpbar holds today — see §2.9 */
  padding: 7px 12px 8px;
  background: rgba(255, 253, 246, 0.88);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  border-top: 1.5px solid rgba(95, 138, 94, 0.14);
}
.pk-keepstrip-inner { max-width: 560px; margin: 0 auto; }   /* desktop cap */
```

Height **72px ± 2**. Two rows inside `.pk-keepstrip-inner`:

**Row 1, 40px** — `display:flex; align-items:center; gap:8px;`
- `.pk-xpbar` — **the whole widget is one `<button>`**, `flex: 1 1 0; min-width: 0; height: 40px`.
  This is what finally kills failure 6's ghost and N2 at once: the tap target is 40px tall and
  ~215px wide instead of 45×20, and the thing that pulses is the thing that acts.
  - `.pk-xpbar-chip` becomes a **`<span>`**, not a button — `flex: 0 0 auto`, 76px wide, 24px tall,
    `font-size: 12px; font-weight: 800`, text from the existing `model.levelLabel`. All of
    `xpBar.ts`'s pure model survives untouched.
  - `.pk-xpbar-track` — `flex: 1 1 0; min-width: 120px;` **height 14px** (was 12), `border-radius: 999px`.
    Measured target at 375px: `351 − 76 − 8 − 44 = 223px`; at desktop it caps at ~424px, never 1112px.
  - `.pk-xpbar-numerals` moves **inside the track**, absolutely positioned
    `right: 8px; top: 50%; transform: translateY(-50%)`, `font-size: 10.5px; font-weight: 700;
    font-variant-numeric: tabular-nums;` colour `#5a4a12` over the gold fill and `#7a8a7a` over the
    empty track — implement as one colour with a 1px light text-shadow rather than two states.
    This buys ~66px of track and puts the figure *on* the fill, where the eye already is.
  - `.pk-xpbar-fill`, `.pk-xpbar-flights`, `.pk-xpbar-gain`, the 2px tick floor, `computeFillPaint` —
    **all unchanged.**
- `.pk-build-btn` — the existing Build button, moved here. `flex: 0 0 44px; height: 40px`,
  icon-only (`⚒`), `aria-label="Build"`. It stops being a float.

**Row 2, 18px** — `.pk-xpbar-next`, full width, `font-size: 11.5px; font-weight: 600`, colour
`#7a8a7a` normally and `#8a5a12` when Ready. Text from `xpBarNextLabel(model)` with **one addition**:

```
not ready:  ▸ Next: The Trail Post, and more ground
ready:      ▸ Ready — the Trail Post, and more ground. Tap to grow the Keep.
renown:     ▸ Next flourish: Lamplight Stamp — 1,110 XP
```

The Ready string is the only new copy. It keeps the carrot **named** (failure 7's fix, preserved) and
adds the call to action, which is the one thing the label was missing.

**Ready state.** `.pk-xpbar--ready` pulses the **whole strip's** left region, not a 45px chip:
keep `@keyframes pk-xpbar-pulse`, apply it to `.pk-xpbar` with `box-shadow: 0 0 0 0 → 0 0 0 6px`
gold, and set the chip span's background to `#f4b942` as today. The fill goes solid gold.
Retain the `sound("keep.ready")` one-shot on the false→true edge.

**Hiding.** `.pk-keepstrip--hide` (opacity 0, `pointer-events:none`, 160ms) is driven by the *same*
`onOpenChange` seam `buildSheet.ts` already uses for `.pk-keepbar`, **plus** placement mode. Reason:
`.pk-keepstrip` sits at z 5 in `#ui` while `.pk-phase5` is a z-6 stacking context, so the placement
pill (z 7 inside phase5, `bottom: safe + 92px`) would otherwise land on top of the strip. This is the
documented trap; do not attempt to out-z-index it.

### 2.5 Where the satchel goes

The satchel row is **cut from the HUD** (−86px at worst). Its content is re-homed by kind, because
foods and resources are not the same thing:

- **Foods (10 types) → the Items sheet.** They already live there, with icons and generated effect
  lines. Their ambient counts were never a decision input: the Feed flow shows them at the moment of
  choosing. Nothing to build.
- **Resources (4 types) → two new homes, both already on screen when they matter.**
  1. **A `Materials` section at the bottom of the Items sheet** — the four resources as read-only
     count rows, no actions. `itemsSheet.ts`'s pure `itemsSheetModel` gains a
     `materials: readonly { id, name, count }[]` field built from `RESOURCE_IDS` + `state.resources`,
     zero counts dropped. This is the fix for the fact that resources currently have **no** viewing
     surface outside a build screen.
  2. **A four-count header row in the Build sheet and the Keep upgrade card** — the two surfaces where
     the number is an actual decision input. One line, `🪵 392 · 🌿 409 · 🐚 406 · 🪶 404`, using the
     existing `ui/icons.ts` specs.
- **Ambient "something arrived" feedback → motion, not a manifest.** When `inventory`/`resources`
  gain an item outside a loot reveal (a job tick), float a `+1 Wood` mote from the **Items button** in
  the action bar, reusing `.pk-xpbar-gain`'s animation shape. Motion is what the eye catches; fourteen
  static pills are what it learns to skip.

I am naming the risk rather than hiding it: the owner may miss the always-on counts. The mitigation is
the mote plus the two new header rows plus the Materials section — three places that answer the
question *at the moment it is asked*, replacing one place that answered it constantly and was ignored.

### 2.6 The information budget, decided

| Want | Volume | Verdict | Where it lives |
|---|---|---|---|
| Which Pips exist, who is selected | 1–6 | **Permanent** | cast row, 64px |
| Every Pip's four needs | 4 × 6 = 24 | **Permanent, as combs** | 10px band under each face |
| Which Pip needs me *now* | 1–6 flags | **Permanent, loud** | alert ring + throb |
| Sulking | 1–6 flags | **Permanent** | status badge + who-line (§2.7) |
| Away / resting / working | 1–6 | **Permanent** | status badge, unchanged |
| Active Pip's name + personality | 1 line | **Permanent, one line** | who-line, 15px |
| Active Pip's need **numerals** | 4 ints | **CUT** | focus view (already there) |
| Keep tier + XP + numerals + carrot | 1 bar | **Permanent, promoted** | Keep strip, thumb zone |
| A tier is Ready | 1 flag | **Permanent, loud** | whole strip pulses; carrot line says "Tap to grow" |
| Pending loot reveals | 1 count | **Permanent** | alert chip, right end of cast row |
| Pipping egg / ready-to-evolve | 0–n | **Deliberately NOT badged** | see §6, cut #7 |
| Foods (10 types) | 10 ints | **CUT** | Items sheet |
| Resources (4 types) | 4 ints | **CUT from HUD** | Items sheet + 2 headers + mote |
| Streak day count | 1 int | **CUT from HUD** | Doorstep + the Today sheet |
| Build entry | 1 button | **Permanent** | Keep strip, right end |
| Nook entry | 1 button | **Permanent** | one float, re-sited (§2.9) |
| Sound toggle | 1 button | **CUT from HUD** | a row in the Nook popover |

### 2.7 The sulking fix (N1) — required, and the highest-value item here

Three pure-function changes in `topBar.ts`, all unit-testable, plus one in `focusView.ts`:

1. `statusGlyph` takes the **Pip**, not the activity, and checks `isSulking(pip)` **first**:
   ```
   isSulking(pip)                    → { glyph: "…", label: "sulking" }
   activity === OnExpedition         → { glyph: "»", label: "off exploring" }
   activity === Returning            → { glyph: "!", label: "back with treasure" }
   activity === Resting              → { glyph: "z", label: "snoozing" }
   activity === AssignedJob          → { glyph: "🧺", label: "gathering away" }
   otherwise                         → null
   ```
   Sulking first because a Pip that naps through a sulk is a Pip that needs a snack, not a Pip that is
   napping. Keep the existing `--sulking` red badge colour.
2. `identitySubtitle` / the new who-line builder use the same corrected status.
3. Keep the old `statusGlyph(activity)` signature deleted rather than deprecated — a second entry
   point is how this rule got broken once already.
4. `focusView.ts`'s mood line appends `· sulking` when `isSulking(pip)`:
   `● Feeling Miserable · sulking`.

`retention.copy.test.ts` and `topBar.test.ts` both need updating; the new assertion to add is
explicitly *"a Pip with `sulking: true` and `activity: idle` is reported as sulking"*, so the rule
cannot regress silently a third time.

### 2.8 Accessibility — every Phase 6 label preserved, three extended

Keep verbatim: the reveal chip's `"Someone brought something home — open the reveal"`; the who-line's
shape `` `${name}, ${subtitle} — open details` ``; the Build button's name; the Nook's label; the
debug toggle's `"Toggle the debug menu"`.

Extended:
- **Cast chip** — same shape, corrected status, new need clause:
  `` `${name} — ${mood}${status ? `, ${status.label}` : ""}${lowNeed ? `, ${lowNeed}` : ""}${isActive ? "" : ". Select"}` ``
  → `"Thistledown — miserable, sulking, Clean is empty"`. `aria-pressed` unchanged. The comb and the
  ring are `aria-hidden`; the words carry them.
- **The Keep strip** — one `<button>`, so it cannot carry `role="status"`:
  `` `Keep level ${level}, ${into} of ${span} experience${ready ? " — a tier is ready" : ""}. Open Keep upgrades.` ``
- **N6 fix** — move `role="status"` off `.pk-xpbar` onto a visually-hidden `<span role="status">`
  inside the strip, and **only write to it on a level change or a ready-state edge**, never on an XP
  tick. `.pk-sr-only` is a new 6-line utility class in `ui.css`.

### 2.9 Floats, after

| Float | Before | After |
|---|---|---|
| Nook `.pk-nav-btn` | `(12, 544)`, mid-world | `left: 12px; top: calc(var(--pk-hud-top, 96px) + 10px)` — reads as chrome, clears the world's centre. **Keep its `z-index: 5` declaration** so `layers.test.ts`'s rung stays green; it is inert there. |
| Sound toggle | `(323, 594)` | **CUT.** A row inside the Nook popover. |
| Debug toggle | `(331, 646)` | `right: 10px; top: calc(var(--pk-hud-top, 96px) + 10px)`. Dev-only; move it off the Keep strip. |
| Keep chip | `(12, 619)` | **CUT.** The strip is the door. |
| Build button | `(12, 660)` | Moved into the Keep strip. |
| `.pk-keepbar` container | exists | **Deleted**, along with `.pk-keepbar--hide`. |

**Z-index ladder.** One rung changes selector, nothing changes number:
`progression.css`'s `z-index: 5` moves from `.pk-xpbar` to `.pk-keepstrip` (the widget is now a flex
child of the strip and needs no z-index of its own). Update that single `LADDER` entry in
`layers.test.ts` — file `progression.css`, selector `.pk-keepstrip`, z 5, and rewrite its `why` to say
the bar now lives in the bottom strip. `.pk-hud-top` declares **no** z-index, exactly as `.pk-topbar`
does today, so every overlay still covers it. No new rungs.

---

## 3. Why the XP bar becomes prominent

Not by getting wider — it is already 209.7px. By four changes, in order of effect:

1. **Adjacency.** 8px above the action bar. Every Feed/Clean/Play/Pet/Rest tap now happens directly
   beneath the bar it moves, and the `+N` chip floats into the player's actual gaze. This is the whole
   point and it costs nothing but a `mountInTopBar` → `mountInKeepStrip` swap.
2. **The whole widget is the button.** ~223 × 40px instead of 45 × 20px, and the pulse and the tap
   target are finally the same object.
3. **Height and contrast.** Track 12px → 14px; numerals move onto the fill; the carrot line goes from
   `10.5px #7a8a7a` (grey on cream, the weakest text on screen) to `11.5px 600` and switches to a
   warm `#8a5a12` when Ready, so the line that names the reward stops reading as a footnote.
4. **Naming the carrot, kept and completed.** `model.nextTierName` already reads `headline`, which is
   why the bar says *"The Trail Post, and more ground"* and not *"+2 rows of ground"* — verified
   across all 11 tiers. The Ready variant adds the verb: *"Ready — the Trail Post, and more ground.
   Tap to grow the Keep."*

**Banked over-100% progress (failure 8).** The bar's answer is already right and stays byte-identical:
`ready ? "2,300 / 2,300 · banked" : "920 / 1,150"`. The build must additionally make
`keepUpgrade.ts`'s header consume `buildXpBarModel(state).numerals` instead of formatting
`keepXp − levelXp[L]` itself, so the card stops printing `2,970 / 2,300 Keep XP` (N3). One number,
one function, two surfaces.

---

## 4. Celebrations that cannot collide (failure 5, N7)

**The cause, precisely.** `progression.css` sets
`--pk-below-topbar: calc(env(safe-area-inset-top,0px) + 172px)` and `ui.css` hardcodes the same 172px
for `.pk-toasts`. The top bar measures **245px** at 3 Pips and **291px** at 5. The constant was never
right — it under-shoots by 73px in the *best* case.

**Measured proof at 5 Pips.** With `.pk-levelup--open` and `.pk-ribbon--open` both applied, the banner
occupied `y = 0 → 119` over a `y = 0 → 291` top bar. On screen: *"✦ The Keep is Level 8 ✦"* and its
three unlock chips printed across `Tideroll ×2 Emberloaf ×5 Feastpot ×1 Fiber ×389 / Wood ×370
Shell ×406 Driftwood ×404` **and across the entire XP bar** — `Lv 8`, `171 / 1,150` and
`Next: The Chronicle, and the last ground` are all legible *through* the banner's gradient, with
*"✦ the Workbench ✦ the Mending job"* struck over them. The round's proudest moment is drawn on top
of the round's headline feature.

**The fix — measure, never guess.**

1. The cast-strip controller owns a `ResizeObserver` on `.pk-hud-top` and writes its rounded height to
   `document.documentElement.style.setProperty("--pk-hud-top", `${h}px`)` on every resize, and once on
   mount. Same for `.pk-actionbar` → `--pk-actionbar-h`, and the two bottom elements' combined height
   → `--pk-hud-bottom`.
2. Every surface that must clear the chrome consumes the variable, with a fallback equal to the
   design height:
   ```css
   .pk-toasts, .pk-levelup, .pk-ribbon { top: calc(var(--pk-hud-top, 96px) + 8px); }
   .pk-nav-btn, .pk-debug-toggle       { top: calc(var(--pk-hud-top, 96px) + 10px); }
   .pk-placebar                        { bottom: calc(var(--pk-hud-bottom, 156px) + 8px); }
   ```
   `--pk-below-topbar` and both `172px` literals are **deleted**. Grep for `172px` before finishing;
   there must be none left.
3. **The two celebrations stack by measurement too.** `levelUp.ts` publishes its own card height as
   `--pk-levelup-h` when it opens; the ribbon's existing `:has()` rule becomes
   `transform: translateY(calc(var(--pk-levelup-h, 140px) + 12px))`. Keep the `:has()` mechanism — the
   collision is in CSS and belongs in CSS — just stop hardcoding 168px.
4. **N7: the purchase closes the card.** A successful `PURCHASE_KEEP_LEVEL` must dismiss the Keep
   upgrade card before the banner plays, so the celebration lands on the world and not behind the
   surface that triggered it. `phase5.ts` already sees the outcome; add the close. Then the banner's
   4000ms and the ribbon's 5000ms are 4000ms and 5000ms the player actually watches. Leave
   `levelUp.ts`'s defensive Doorstep/reveal queue exactly as it is.

**Acceptance test the builder should perform by hand at 375×812, roster 6, 14 satchel types:** buy a
tier; the card closes; the banner sits fully below the cast strip with clear air; the ribbon sits
below the banner; neither overlaps the strip nor each other; the ribbon's `+N XP` chip flies **down**
to the Keep strip's track. That last point needs code: `.pk-ribbon-flychip`'s `--pk-fly-dy` defaults
to `-60px` and the fly target is now *below* the ribbon, so `milestoneCelebration.ts` must compute a
signed `dy` from `xpBar.anchorRect()` rather than assuming upward travel.

**Where the Ready affordance lives.** In the Keep strip, and nowhere else. It is the loudest element
on the screen when Ready (a pulsing full-width gold bar in the thumb zone), it is the tap target, and
it names both the reward and the verb. The competing `The Keep` chip is deleted. One widget, one
readout, one door — which is what bible §1.2 asked for in the first place.

---

## 5. Per-failure mapping

### 5.1 Failure 1 — the day-2 Doorstep

**Verified state.** 2F added the good news. Measured on a real +24h return: *"+90 Keep XP while you
were away."* and *"The Keep kept working: 20 Fiber and 22 Wood came in."*, both inside the `The Keep`
section, ahead of the decay. A `keepTierReadyNudge` exists too.

**What is still wrong, measured.** The card is 682px tall with `scrollHeight 806` vs
`clientHeight 679`, 5 sections and 14 line elements:
- **Proportion.** Two lines of earnings against fifteen rendered lines of `↓` arrows (5 Pips × 3
  wrapped lines). The good news is 12% of the card.
- **The dismiss button is below the fold.** `"Come in"` — the only button, per retention bible
  §10.2 — is off-screen on arrival.
- **The ready-tier fact is last of six nudge priorities**, so it loses to a pipping egg, a glowing
  Pip, a pity counter, an Album page *and* a milestone. On my measured return the slot went to
  *"🏅 First Egg Found is one step away."* — and that nudge was itself below the fold.
- **Copy repeats verbatim.** *"came home a bit sulky. One good snack fixes everything."* three times
  in one section.

**Design decisions (three, bounded — the Doorstep's sections and copy are the retention bible's, not
mine):**
1. **`position: sticky; bottom: 0` on `.pk-doorstep-dismiss`**, with the card's cream background and a
   6px top fade. The one button is always reachable.
2. **Cap the per-Pip block at 3 rows** plus a `+2 more` disclosure button that expands in place.
   Deduplicate identical notes to one section-level line
   (*"Three of them came home sulky. One good snack fixes everything."*).
3. **Promote the Keep's position out of the nudge slot into the `The Keep` section**, as a line of its
   own, because it is a *fact*, not a nudge, and the one-nudge rule governs nudges:
   `Lv 8 — 261 / 1,150 toward the Chronicle.` And when a tier is Ready:
   `Lv 8 ▸ Ready — the Chronicle is waiting.` `keepTierReadyNudge` is then **deleted** from the nudge
   chain, which also gives the perishable nudges (pipping egg, glowing Pip) their slot back.
   This is the fix for *"the single most important return moment does not sell the progression"*: it
   now sells it as a stated fact in a fixed position, not as a lottery for the last nudge slot.

### 5.2 Failures 2–4, 6–10

| # | Decision |
|---|---|
| **2** XP at the loot reveal | **Already fixed** (`+7 Keep XP` verified). Addition: on `Collect`, fly a `+N XP` chip from the reveal card to `xpBar.anchorRect()` — the reveal is the dopamine core and it should visibly feed the spine it pays into. |
| **3** 56px track | **Already fixed** (209.7px measured). This pass does not re-widen it; it re-sites it (§3) and takes it 12px → 14px. Track measures ~223px at 375px after the numerals move inside. |
| **4** Set bonuses unstated | **Already fixed.** Verified: every group prints both tiers plus the next step, e.g. *"○ 3 placed: +5% Keep XP from everything you do. ○ 5 placed: +10% … three more for the set bonus."* No change. The one adjacent gap: the upgrade card still shows a bare tally (`Meadow Green 1 of 7 · …`) with no bonus named — give each set there the same two bonus lines the sheet uses. |
| **5** Celebrations collide | §4. Measured CSS variable, delete both `172px` literals and `--pk-below-topbar`, stack the ribbon off `--pk-levelup-h`, close the upgrade card on purchase. |
| **6** Inert Ready chip | **Already fixed** (real `<button>`; `phase5.ts` no longer repeats the level). Residual N2 (45×20px target) fixed by making the whole 223×40px strip the button, and the `The Keep` chip is deleted so one door remains. |
| **7** Bar names the dull thing | **Already fixed** via `headline`; verified across all 11 tiers. Extended: the Ready variant keeps the name and adds the verb. |
| **8** Over-100% numerals | **Fixed in the bar; still live in the upgrade card** (`2,970 / 2,300`). Card consumes `buildXpBarModel().numerals`. |
| **9** 13-screen Build sheet | **Already fixed.** Measured 883px = 1.09 screens; 45 items behind 6 collapsed set groups; locked cards read *"Opens at Keep level 10 — something to grow toward. Will cost 12 Wood + 5 Shell + 3 Driftwood."* No change beyond the new resource header row (§2.5). |
| **10** CATCHUP on every flick | **Partly fixed** — `isTrivialAbsence` + `QUIET_ABSENCE_MS` removed the modal wall; a 3-minute absence now correctly gets nothing. **Not a HUD problem and I am declaring it out of scope for this pass.** Owner: `app/ticker.ts`. The remaining defect is that `onVisibility` dispatches `CATCHUP` unconditionally, so a half-second tab flick runs a full segmented catch-up pass and a full 6-view re-sync. The guard is three lines — skip the dispatch when `clock.now() - state.lastTickAt < TICK_INTERVAL_MS * 2`, since the live loop covered that window. Worth taking in this round only because the new HUD re-renders more per sync (six combs) and should not be doing it on every tab flick. |

---

## 6. Cuts

A top-10 HUD shows less. These are removals, not relocations to a second permanent slot.

1. **The 14-chip satchel row — up to 86px, the single biggest win.** Re-homed per §2.5. A warehouse
   manifest, styled uniformly, answering no question the player is asking at that moment.
2. **The four need numerals.** `Food 33` is verification, not play. It already exists, larger, in the
   focus view.
3. **The four labelled need bars for one Pip — 28px.** Replaced by combs for *every* Pip in the same
   band. The old layout spent its budget on the Pip you already chose.
4. **The identity row as a separate 29.5px row.** Compressed to a 15px line that says strictly more
   than the old one did (status corrected, lowest need named).
5. **The `i` info badge.** 17px of `aria-hidden` decoration on a button whose entire surface is
   already tappable and whose label already says *"open details"*.
6. **The floating `The Keep` chip — 90×34px.** Its only job was being a second door to the upgrade
   card. The strip is the door.
7. **Badges for pipping eggs and ready-to-evolve Pips — refused before they are built.** The obvious
   move is a second and third attention chip. Don't. A pipping egg already has a world sprite you tap
   and the Doorstep's top nudge slot; a glowing Pip already has a world bubble. **One** attention chip,
   for pending loot reveals only, keeping today's exact action and label. Adding badges is how a HUD
   becomes the thing the owner just called clunky.
8. **The floating sound toggle — 40×40.** A preference set once, holding permanent screen. A row in
   the Nook popover.
9. **The streak count, from the HUD.** It is a *return-moment* fact. It belongs on the Doorstep (where
   it already is: *"Day 14 in a row."*) and in the Today sheet. It does not belong on screen while you
   are playing, because there is nothing to do about it.
10. **The `NEW` badge on Build cards.** Adjacent, not mine, but: it is on all 13 station cards at once.
    A badge on everything marks nothing. Show it only for items unlocked by the most recent tier.
11. **Every `172px` literal and `--pk-below-topbar`.** Not a pixel cut — a *class* of bug cut. A
    hardcoded guess at another element's height will be wrong again the next time a row is added.

**Net:** −139px of chrome at 5 Pips (375px → 236px… 252px including the taller Keep strip), constant
across roster and satchel state, and four of five world-obscuring floats gone.

---

## Appendix — acceptance checklist

Hand-verify at **375×812** and **1280×800**, then `npm test` and `npm run build`.

1. `.pk-hud-top` measures **96px ± 2** with rosters of 1 and 6, satchels of 0 and 14 types, with and
   without a pending reveal. It never changes height during play.
2. At roster **6**, all six chips fit with no clipping and no wrap (art ~45px), and the alert chip
   sits at the right end without moving them (N4, N5).
3. Chrome totals **252px ± 4**; the world band is **≥ 555px** with exactly one 44px float over it.
4. A Pip with `sulking: true, activity: "idle"` shows the `…` badge, the who-line says `· sulking`,
   the chip carries `--urgent`, the aria-label says `sulking`, and the focus view's mood line says
   `· sulking` (N1 — the spec §10 rule).
5. The Keep strip's tap target measures **≥ 40px tall / ≥ 200px wide**; tapping anywhere on the bar
   opens the upgrade card; when Ready the whole strip pulses and row 2 reads
   *"Ready — … Tap to grow the Keep."*
6. `keepXp` past the tier gate: bar reads `X / X · banked`, **and** the upgrade card header reads the
   same string (N3).
7. Buy a tier at roster 6 with 14 satchel types: the card closes, the banner clears the cast strip
   entirely, the ribbon stacks below the banner, the `+N XP` chip flies **down** to the strip.
8. `grep -rn "172px\|--pk-below-topbar" src` returns nothing.
9. `layers.test.ts` green with exactly one edited rung (`.pk-xpbar` → `.pk-keepstrip`, still z 5).
10. Open the Build sheet: the Keep strip hides (not z-fights); enter placement mode: it stays hidden;
    cancel: it returns. No stray scroll on `.pk-phase5` or `#ui`.
11. Screen reader: XP numerals are **not** announced on every grant; level changes and ready-edges
    **are** (N6).
12. Desktop: no need bar wider than its label needs, XP track ≤ ~430px, cast strip content ≤ 720px
    centred, action bar content ≤ 720px centred.
13. Doorstep on a +24h return at roster 5: `Come in` visible without scrolling; per-Pip block capped
    at 3 + disclosure; the sulky note appears once; a `Lv N — X / Y toward <headline>` line is present
    in `The Keep`; the nudge slot is free for a perishable moment.
