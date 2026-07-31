# PipsKeep — Progress Log

Phase-gate log and decision journal, per spec §13–§15. Append entries; never rewrite history.

## Phase status

| Phase | Status | Gate logged |
|---|---|---|
| 0 — Scaffold | **gate passed** | 2026-07-29 |
| 1 — Pip core (logic only) | **gate passed** | 2026-07-29 |
| 2 — Care actions + first playable | **gate passed** | 2026-07-29 |
| 3 — Save system hardening | **gate passed** | 2026-07-29 |
| 4 — Expeditions + eggs | **gate passed** | 2026-07-29 |
| 5 — The Keep | **gate passed** | 2026-07-29 |
| 6 — Polish, PWA, onboarding | **gate passed** | 2026-07-29 |

### Round 2J — Economy depth: fifth resource + crafting — 2026-07-31 — GATE PASSED (two findings left open)
**3350 tests** (was 3138). Save schema v10→v11. No new runtime dependency.

- **The design pass corrected the round's own premise.** A fifth resource does NOT raise the affordability ceiling: `expectedMinutesToAfford` is a `max` over a bundle's resources, never a sum, so adding a fifth term to a `max` cannot exceed the largest term already achievable. What it actually buys is **breadth** (eleven strictly-increasing prices instead of five, because five levers have different granularities), **gating that cannot be pre-farmed** (wood/fiber drop at tier 1, so a hoarder could bank the entire old ladder; lodestone does not exist below tier 3), and one currency that never becomes free. It said so plainly rather than letting the brief produce a round that failed its own guard.
- **Lodestone** — naturally magnetised magnetite. Chosen partly because it explains three shipped flavor texts, including the Lanterngrotto's *"the rocks are warm, nobody knows why."*
- **The zero-dilution identity.** Adding a weighted loot entry normally dilutes every existing drop. Scaling rolls in exact proportion to the new weight sum does not: `newRolls/(oldSum+w) === oldRolls/oldSum`. Three integer solutions found, and all 23 existing per-biome item rates verified unchanged to within 1e-12 — so the shipped "33.3 minutes to level 2" on-ramp and every pinned rate survive untouched.
- **The ladder now prices eleven tiers, up from five**, escalating 33.3 → 127.1 expected minutes, strictly increasing, with the lowest afford rate 0.9960 over 3,000 seeded sessions. Lodestone binds tiers 5–10 — six consecutive tiers gated on a material that did not exist a round ago.
- **Crafting is a job that occupies a Pip**, cashing spec §6.2's registry promise. The Pip you give up is the rate limiter, and it inherits assignment legality, Sulking refusals and the offline story for free. Obeys §4.5's cap like every other rate.
- **The 2H cure wound is healed properly.** The audit had found the Poultice undiscoverable; the real bug was its *shape* — the only cure in the game dropped only on the three trails that cause the illness, so the answer to "my Pip is ill" was "run the dangerous trail again and hope." It is now craftable, and the ailment card carries a **"Make one"** affordance so the cure is visible from where the fear is.
- **A NINTH dead feature found and fixed:** craft completions were written to state and reached no player surface. Now toasted live via `collectCraftAlerts` and reported on the Doorstep ("The Craft Table finished: 2 Poultices."). The design pass also found the **Poultice Shelf has no `effects` array at all** — a tier-5 headline costing 7 wood/6 fiber that does literally nothing — plus three placeables whose documented `longevity` effects were never wired.
- **LEFT OPEN, carried to the backlog:** (1) the round's own "cure ceiling" invariant is asserted nowhere — `crafting.balance.test.ts` was named as its guard and never created, so a decorative guard; (2) no repeatable sink exists for lodestone from tier 12 onward. The design was honest that wood/fiber will still pile up and that inventing make-work sinks is how a cosy game becomes a grind — but the late-game surplus is real and unsolved.

### Round 2I — Notifications — 2026-07-31 — GATE PASSED
**3138 tests** (was 2920). No new runtime dependency. No save-schema bump (device-local prefs go through the existing `SaveStore` seam).

- **THE HEADLINE, AND IT IS A SCOPE CORRECTION: real Web Push is impossible here, and the design pass says so in its first hundred words.** Push is a *server* API — a closed device is reached because a server POSTs a VAPID-signed payload to the vendor's endpoint at the right moment. PipsKeep has no server (spec §1: zero network calls) and the owner's decision is web-only with no new dependency. **What shipped is client-scheduled local notifications.** A push server is documented as a seam plus an infrastructure proposal awaiting the owner's go-ahead.
- **The second finding would have made this the eighth dead feature.** `app/ticker.ts` pauses the game loop on `visibilitychange → hidden`, so **no state transition ever happens while the tab is hidden**. The obvious transition-driven design — matching `app/alerts.ts` and `ui/phase4.ts` — would have delivered *nothing, ever*. The scheduler is therefore derivation-driven: arm a timer on hide, and at each wake **recompute** `planNotifications(state, now)` from unadvanced state. That is spec §6.1's "timers are derived, never setTimeout" applied one layer out.
- **Two notification types shipped; four were cut with arguments.** Homecoming and Pipping. Cut: Keep-tier-affordable (it drifts across a threshold *while you are gone* — the closest thing to an absence-triggered buzz, and it reads as a shop notification), bounty rollover (no deadline exists, and it would fire at 04:00 local — a dark pattern, a tone violation and an alarm clock at once), evolve-ready, and job hauls. `needLow`/`sulking` are never-send by construction: they are absence-caused, so a push about them *is* a punishment for absence.
- **Round 2H's cut was honoured structurally.** Ailment and lineage news are *suffixes on a homecoming that was already firing* — they can never CAUSE an interruption. Strictly more information on a buzz already accepted.
- **Honest delivery tiering rather than a promise.** Tier 0 in-app toast → Tier 1 hidden-but-alive page timers (the workhorse, ~60s late under Chrome's intensive throttling — so **no notification string contains a time word**) → Tier 2 opportunistic SW drain → Tier 3 a push server that does not exist yet. The failure mode correlates in the right direction: the longer the timer, the more genuinely the player has left.
- **The mutation tester found the guard against 2H's cut was bypassable** — it scanned a hand-maintained list of copy builders, so a forbidden string composed at *plan* time shipped three banned words with the suite green. Now driven from `planNotifications`/`dueNotifications` over fixture states, so it stays correct as the catalogue grows. Also fixed: quiet hours were evaluated at `dueAt` rather than the delivery instant (a delayed timer could buzz at 2am), a second homecoming cluster was silently dropped when a pipping was also due, and the settings sheet advertised a notification the round had cut.

### Round 2D — Pip identity & variety — 2026-07-31 — GATE PASSED (with a known visual defect)
**2920 tests** (was 2662). Save schema v9→v10.

- **The round's purpose is achieved.** A fresh onboarding now offers **Ribbon** (Mosspip · Clingy), **Oatcake** (Pebblepip · Hardworking) and **Spindle** (Tidepip · Lazy) — three names, three species, three silhouettes, three palettes, three personalities, each wearing a different accessory. Verified in the browser at 375px. The complaint that started this round — "Mosspip / Mosspip / Mosspip" — is gone.
- **Shipped:** a 140-name pool in 7 thematic groups; per-individual name rolls on create, hatch AND the lineage-egg branch, deduped against roster + Long Meadow + Album; `RENAME_PIP`; three distinct starter species; **12 accessories finally attached to the `accessoryAnchor` that had been positioned and empty since Phase 2 — the seventh dead feature, now alive**; per-individual jitter (body, eyes, markings).
- **Deliberate design calls:** the name is NOT part of `TraitGenome` (it is not heritable, and keeping it out left `combineGenomes` and every cursor contract untouched); a dedicated `NAME_STREAM` disjoint from the genesis/egg streams so no existing determinism guarantee — 2C's pity ladder, 2H's lineage — was perturbed; and `NO_ACCESSORY_ID` is a real pool entry rather than a null, so **40% of Pips come up bare** because bare has to stay charming.
- **The identity audit failed the round on its first pass and was right to.** It found the starter cards all showing the SAME name (the exact bug the round existed to fix), the cast strip carrying no name/accessory/pattern so same-palette Pips were pixel-identical in the always-visible surface, starters and bred children permanently unable to wear accessories, jitter invisible in practice (<1 CSS px, and two of four axes mathematically dead because FNV-1a's last-byte diffusion made `eyeRadiusX ≡ eyeRadiusY`), the loss eulogy stripping a Pip's accessory at the one moment individuality matters most, and eight pool names colliding with existing vocabulary (Berry is a food, Meadow is an expedition AND the sanctuary). All fixed in-round.
- **KNOWN DEFECT, not fixed:** several accessories still render on the wrong body part — the scarf sits across the mouth like a gag rather than around the neck, and the audit reported the lantern over an eye and the bowtie/ember bead on the belly. Cosmetic, visible on the first screen a new player sees. Logged in `docs/BACKLOG.md` for a render polish pass.
- Mutation blockers fixed in-round: the accessory parity guard never rendered DOM (the entire DOM half of the feature could be deleted with the suite green), and the lineage-egg hatch branch could revert to species-naming with no test noticing — which would have silently gutted round 2H's payoff.

### Round 2H — Lifecycle, lineage & risk — 2026-07-30 — GATE PASSED
**2662 tests** (was 2286). The round that changed what the game *is*: Pips are finite. Spec §16 v1.5's five promises are the gate, and each has named tests.

- **Shipped:** per-Pip levels (10-tier curve, six effect channels), a `lifeMs` lifespan, ailments with visible countdowns and cures, TRUE LOSS on the deep trails, lineage-recovery eggs, and **breeding — `combineGenomes()` is finally called by gameplay after sitting tested-and-uncalled since Phase 4.**
- **The load-bearing discovery.** Per-Pip decay resistance cannot be its own channel: `effects.balance.test.ts` pins comfort at 0.25 and the binding arithmetic (Curious's worst window, 3.7 × 1.15 × 16h = 68.08, needing `68.08 × (1−r) > 50`) leaves **1.557 percentage points of decay-reduction headroom in the entire game** — already spent by building comfort. So a Pip's seasoning and the Keep's comfort are ONE channel, summed once and clamped once via a *headroom* clamp, chosen over `min(cap, sum)` specifically so it wouldn't re-clamp the guard suite's hypothetical-0.30 fixture and turn a passing test red for the wrong reason.
- **The promises are structural, not tonal.** Ailment countdowns are stored as `remainingMs` — a RATE, so §4.5's offline cap governs them for free; `minAilmentDurationMs` (36h) exceeds the 16h cap by construction; and **the `lost` transition exists only in the live TICK arm, so catch-up can never take a Pip and the loss is always witnessed.** `lifeMs` advances on rated time only, so three weeks away ages a Pip by 16 hours — promises 2 and 5 in one line. Loss and lineage-seeding are a single atomic reducer arm, making *a loss without a thread* unrepresentable.
- **The cruelty audit earned the round.** It played the real build and found **four blockers**, all fixed: the free "devoted care" cure the UI promised **did not exist** (0 cures in 100 runs with perfect care); the vigil floor was **a cliff, not a floor** (leaving with under 4h remaining killed the Pip a minute after reopening — a direct promise-2 breach); the Careful Route opt-out **was not implemented**, making risk mandatory; and the Quiet Keep toggle **did not exist anywhere**. It also caught the Long Meadow showing a *lost* Pip as merely retired and promising she'd be "home again tomorrow morning" — a lie to a grieving player.
- **Also fixed:** the lineage seed hardcoded `generation: 1`, collapsing the chain for any lost descendant (now `seed.generation + 1`, with its own test); the only working cure was undiscoverable; and the bible's 83.9% survival floor was off by the whole margin.
- **Six things were deliberately CUT as un-de-brutalizable**, including death by neglect (definitionally caused by absence, which promise 2 forbids) and any loss-related push notification — named explicitly now so round 2I cannot add one.
- Note: 80 new dialogue lines were required (2 contexts × 5 personalities × 8) — spec §3 makes that non-optional.

### Round 2G — HUD legibility — 2026-07-30 — GATE PASSED
**2286 tests.** Oracle visual pass → two builders → integrate → three verifiers → fixer → re-gate.

- **The Oracle's finding reframed the round:** eight of the ten "measured failures" it was handed had *already been fixed inside round 2F, after 2F's own audit wrote them down*. A builder given the raw list would have "fixed" working code. It verified each in the running game before designing — e.g. the XP track was already 209.7px, not the 56px on the list. **Lesson: a stale finding is worse than no finding; re-verify before acting on an audit from a previous round.**
- **The real problem was design, not bugs.** Measured `.pk-topbar` at 375×812: **223px with one Pip, 291px with five** — the header *grew 68px as a reward for playing well* — and with the action bar that was **46.1% of the screen as chrome**, leaving a 375×253 band of actual world.
- **The redesign, now shipped:** a 96px cast strip (roster chips carrying per-Pip need combs and alert rings) + a **72px Keep strip in the thumb zone that is one full-width button** + the action bar = constant chrome regardless of roster size. Playfield roughly doubled. Floats over the world went 5 → 1.
- **Cut, not kept:** the 14-chip satchel row (−86px, re-homed to the Items sheet), the four need numerals, the single-Pip need bars, the identity row, the `i` badge, the separate Keep chip, the sound-toggle float. Several proposed additions were *refused before being built*.
- **Verified by me in the browser:** the Doorstep now leads with "Lv 1 ▸ Ready — The Forest trail is waiting", names XP waiting and homecomings; the loot reveal shows "+7 Keep XP"; the Ready affordance is a real button with the label "Keep level 1, 100 of 100 experience banked — a tier is ready. Open Keep upgrades."
- **A live spec violation found and fixed (N1):** `topBar.ts` keyed sulking off `activity` and never `isSulking`, violating spec §16 v1.3's own standing rule — so a Pip with `sulking: true, activity: "idle"` and needs at 0/0/0/0 got **no badge at all** while others did. `focusView.ts` never mentioned sulking. Both fixed; the activity-only signature was deleted rather than deprecated.
- Also fixed: celebrations now clear the chrome via a measured `--pk-hud-top` (two hardcoded `172px` literals deleted — the banner had been printing straight through the XP bar at five Pips); speech bubbles clamped to the viewport; starter-Pip camouflage (1.05:1 body-vs-ground); roster overflow at six Pips; purchase now closes the upgrade card so celebrations don't play behind it.

## Next up (queued, not started)

Both paused rounds are now complete and gated. Remaining, in recommended order:

- **2D — Pip identity & variety.** Individual names (every Pip is still literally named after its species), three distinct starter species, real accessories, per-individual jitter. See `docs/BACKLOG.md`.
- **2I — Web Push.** Note: round 2H explicitly CUT loss-related push notifications as un-de-brutalizable. Do not add one.
- **2J — Fifth resource + crafting.**
- **2K — Attractions & the living Keep.**

## Gate log

### Round 2F — The progression spine — 2026-07-30
`docs/progression-bible.md` (1,316 lines) designed it before any code. **2189 tests** (was 1580). Save schema v7→v8.

- **Shipped:** Keep XP as one spine (35 sources across every player action, awarded at a single call site so no reducer arm can forget it), a **12-tier ladder** with a named headline unlock per tier and the six expeditions re-spread across it, a typed content-defined **building-effect system** (comfort/rest-speed/expedition-speed/loot/egg-chance/incubation/job/xp) with six themed decoration sets, **45 build items** (up from 24), procedural inline-SVG icons, a milestone ribbon and a tier-up banner.
- **Design finding that shaped the round:** a 12-tier *resource-priced* ladder is arithmetically impossible against the reachability guard with only four resources — the affordable top bundle is ~3.5× level 2's cost. Hence tiers are XP-gated with only five also priced. **A fifth resource is now the highest-value economy change** and has been asked for by three consecutive rounds.
- **A FOURTH dead feature found: `state.keepsakes`.** Written by `CLAIM_MILESTONE` and by `RESOLVE_STREAK_CHOICE`'s day-5 pick, and read by *nothing* — a player chose from three offers and received observably zero. `Placement.granted` was likewise never implemented despite a comment claiming it closed the refund exploit. Both fixed (Keepsake Shelf).
- **A FIFTH dead feature, caught by the game-design audit: Renown** — the designated endgame and the entire answer to "what is there on day 30" — **granted literally nothing**, because its flair half was deleted and never replaced. Now pays.
- **21 of the 45 build items — including EVERY new station, i.e. the headline unlock of tiers 2, 3, 6, 7, 8, 10 and 12 — rendered as the identical placeholder brown crate.** The ladder's carrots were invisible. Fixed; the crate is now reserved for genuinely unknown ids.
- **Balance held on a knife edge:** `comfortReductionMax = 0.25` is the round's fragile invariant. At 0.25 a maximally-built Keep still comes home Grumpy for all five personalities; at 0.30 a Curious Pip comes home *Content* and the daily loop stops mattering. Worked in the bible; guarded by a new `effects.balance.test.ts`.
- **The verdict I am carrying forward, verbatim from the game-design audit: "the spine exists and is real; the surfaces that would let a player FEEL it are half-built."** Outstanding and now owned by round 2G:
  - The Doorstep still reports only decay/streak/bounties — it never mentions XP earned while away, what a staffed station produced, or that a Keep tier is ready. The return moment does not sell the progression. **(Unfixed blocker.)**
  - XP is granted at ~15 kinds of moment and displayed at 5; the loot reveal — the richest source — shows no XP at all.
  - The XP bar's fill track is **56 px wide on a 375 px screen**, making the round's headline feature its least visible element.
  - Set bonuses are never stated anywhere: the sheet says "0 of 7 placed" and later "· bonus active", but never what the bonus *is*.
  - The tier-up banner and milestone ribbon anchor at `top: 0` over a ~200 px top bar and collide with the need bars.
  - The gold "Lv N ▸ Ready" chip is inert; the real tap target is a different chip.
- Mutation: 18 applied, 12 killed. Surviving majors (fixed in-round): the expeditionSpeed/incubationSpeed channels could be dropped at the reducer seam with all tests green, a mid-ladder tier could be made to deliver nothing, and both celebration controllers could be disconnected from their stores — all the dead-feature class this round explicitly forbade.
- Guards green: `balance.test.ts` (55), `effects.balance.test.ts` (21), `reachability.test.ts` (77), `layers.test.ts` (8).


### Round 2E — Portrait render regressions — 2026-07-30
Two owner-reported visual bugs, both traced to the same structural cause: **a pip's pattern is implemented three independent times** — the Pixi scene (`render/spriteResolver.ts`), the focus-view DOM portrait (`ui.css`), and the Album's DOM portrait (`pipdex.css`). Nothing kept them in step.

- **Focus-view portrait collapsed to `height: 0px`.** `.pk-portrait` declares `height: 108px`, but every child is absolutely positioned, so it has zero in-flow content height — and it is a flex item with `flex-shrink: 1` inside the height-constrained focus panel. Once rounds 2B/2C grew that panel (six expeditions, mastery lines), it overflowed and the portrait was the one item free to shrink to nothing; the absolute eyes and blush then spilled over the pip's name. Fixed with `flex: 0 0 auto`.
- **The "starburst" over the pip's face** was `repeating-conic-gradient(… 0 14deg, transparent 14deg 40deg)` — radiating pie-slices by construction — in BOTH stylesheets, while the Pixi scene draws `swirl` as a small off-center spiral. The same pip looked like a different creature in its portrait than in the Keep. Replaced with a bounded off-center curl in both.
- **The real cause of "not fully rendered":** round 2B added six pattern primitives (banded, ripple, ember, flake, puff, glowdot) to the resolver and the species registry and **never added them to either stylesheet**; `speckled` was missing from the Album's CSS too. Most pips had been rendering with no pattern overlay at all. All 11 missing overlays authored, verified visually across all 9 patterns at portrait, Album and 58×48 thumbnail sizes.
- **A second, subtler layer of the same bug, found during visual verification:** the Album's `domPatternKind()` bucketed ember/flake/puff/glowdot into one shared "fleck" class, which silently **discarded four of the newly-authored rules** — four species wore identical dots in the Album while looking distinct in the Keep. CSS-authored and TS-emits-it are separate acceptance criteria (spec §16 v1.3's standing rule, earned yet again).
- **New guard:** `src/ui/portraitPatterns.test.ts` is data-driven off the species registry — every content pattern must have a rule in both stylesheets, the emitted class must exist, no two distinct patterns may collapse to one class, and neither stylesheet may use `repeating-conic-gradient`. Injectivity is the load-bearing assertion; mutation-verified by re-introducing the bucketing.
- Tests: **1580 passing** (was 1553). Build clean.
- Process note: this round's workflow died mid-flight to an expired OAuth token after its author agent had already completed the CSS work. The tree was left green but with an uncommitted temp harness, which I used for the visual pass and then removed.


### Round 2C — Full gamification stack — 2026-07-30
Design-first again: `docs/retention-bible.md` planned every system with its numbers and its anti-dark-pattern justification before any feature code. **1553 tests** (was 1053). Save schema v5→v6 with migration + fixture.

- **Shipped:** the Album (Pipdex with seen/caught tiers, frozen first portraits, shiny stamps, per-line gift-variant "Grove Ledger"), the **Long Meadow** (sanctuary), daily streak with a grace bank, 34 milestones, daily bounties, per-pip expedition mastery, visible egg pity counter, annually-recurring events, loot multipliers, and **the Doorstep** — one blocking surface on open, replacing what would otherwise have been five stacked modals.
- **The structural problem is solved.** 14 collectable forms against a roster cap of 5 previously meant deleting Pips to collect. The Long Meadow has **unlimited capacity permanently** (a capped sanctuary just recreates the problem), retired Pips' needs snap once to 80/80/80/100 and then never change — they leave the decay loop entirely, so storage can never become punishment — and `ageMs`/`happinessIntegral` **freeze**, which stops the sanctuary becoming the optimal way to farm evolutions. `minStayMs` of 8h exists solely so "retire → ask home" isn't a free full heal routing around care. Verb pair is "Send to the Long Meadow" / "Ask them home", never release/store/delete.
- **An exploit found and closed by the design pass:** `REMOVE_ITEM` refunds a placement's full cost, so any granted/free decoration would have been a resource printer. Fixed with a `granted` flag and a keepsakes shelf (refund 0, re-placeable free forever).
- **The verification stage did its most valuable work yet.** A mutation tester found a **blocker** — nothing proved that a streak break preserved state outside `StreakState`, i.e. the exact guardrail I'd made non-negotiable. The fix is a strong test: build a real 3-day streak, bank a real milestone, run a control, then assert every other slice of `GameState` is byte-identical across a 100-day gap.
- **Three majors, all real, all fixed:** 20 of 34 milestone rewards were `kind: "flair"` against **no registry, no state field and no renderer** — every long-haul target (14/14 Album, 21/21 Ledger, 30-day streak, 100 bounties) paid literally nothing. This is the same failure mode as `evolved.variantId`, and the fix cites spec v1.3's standing rule by name. The visit-day whitelist omitted every build/purchase action, so a session the player genuinely played could be recorded as an absence. And the Doorstep showed an already-lapsed streak then silently reset it with no welcome-back message — the one moment the whole forgiving-streak design existed for.
- Guardrail held: rewards for showing up, never punishment for absence. Events recur **annually** so "you missed it" is always "it comes back", and the `availableWindow` field is consumed as *featured*, never *gating*.


### Round 2B — Big content expansion — 2026-07-29
Design-first round: a 932-line content bible (`docs/content-bible.md`) planned everything, with the economy verified against the *real* loot roller rather than estimated, then three authors implemented it in parallel.

- **Content shipped:** 7 species lines / **14 forms** (Mosspip, Pebblepip, Tidepip, Emberpip, Snowpip, Cloudpip, Lanternpip → Grovepip, Cairnpip, Reefpip, Hearthpip, Frostpip, Thunderpip, Beaconpip) with 21 gift-selected evolution variants; **6 biomes** (Bramblewick, Snowdrift, Lanterngrotto added) structured as a *quick trip + deep trip pair per Keep level* rather than six tiers; **10 foods** incl. a treat (Honeydrop 10/+32) and a feast (Feastpot 100/+30/+15); **20 decorations**, 1 placeable (Stockpot), 1 new job (Simmering); 56 species flavor lines in a new `speciesLines.ts`.
- **§3 verified:** the deep trips, foods, decorations and the new job all landed as pure content. The job system turned out to be genuinely registry-driven — a clean proof point. Deliberately declined: a 5th `RESOURCE_ID` and widening the `KeepLevel` union; the bible designed around both.
- **One authorized core change:** `HATCH_EGG` now passes `sourceExpeditionId` into the genome roll so eggs hatch their biome's species — the collection engine. Approved as a *feature*, not a §3 violation, on the condition that the RNG cursor advances identically regardless of pool (tested).
- **Two shipped bugs found by the design pass:** `grovepip` had `rarity: "uncommon"`, so ~1 egg in 5 hatched a fully-evolved Grovepip and undercut evolution's payoff — fixed with a zero-weight `lineage` tier. And **`pip.evolved.variantId` was written by `applyEvolution` and read by nobody**, so every gift-selected evolution variant since Phase 5 was invisible; the palette data for those looks did not even exist. Both fixed. Lesson: the tests asserted the stored value, never that anything rendered it.
- **A third deadlock class closed:** the reachability test now tags every placeable and covers the new tiers, so the level-3 shell/driftwood trap (found in 2A) cannot recur in any new content.
- **Deep trips deliberately do NOT win on throughput** — the Meadow still out-farms every long trail per minute. They earn a slot by being the only door to their biome's species and foods, which is a better reason than bigger numbers.
- Mutation: 8/8 killed. Audit majors fixed in-round: species lines were only firing on shiny hatches (~2.5% of hatches) — now every hatch surfaces its species' voice, with shiny keeping its rarer one-off.
- Tests: **1053 passing** (was 962). Build clean.
- Known deferred: "first meeting" fires on every focus-view open, since true first-time tracking needs a persisted seen-record — correctly deferred to the Pipdex round.

### Round 2 side-fix — Sulking under-reporting (playtest follow-up) — 2026-07-29
Round 2A made sulking a flag orthogonal to `activity`, which left two reporting surfaces comparing the literal activity value and so silently under-reporting the sulk.
- `src/ui/awaySheet.ts` now reads `isSulking` off the post-catchup pip snapshot it already receives (simpler than plumbing new fields through the shared `PipCatchupDelta`).
- Toast logic extracted from `main.ts` into a new pure `src/app/alerts.ts` (`collectAlerts(prev, next) → NotifyEvent[]`) reading `isSulking`. Extraction was necessary because `main.ts` ends in `void boot()`, so nothing inside it can be imported by a test. Need-low crossings gained coverage they never had.
- The away sheet's "dozed through the whole thing" branch no longer beats the sulk branch — a sulking pip whose needs happened not to move is never told it dozed.
- Guards mutation-verified: reverting each site to its activity comparison fails the new tests.
- **Process note:** my first pass at this collided with round 2B running concurrently. 2B's gate-runner correctly flagged my `catchup.ts` edit as an unexplained core change and its fixer reverted it. Lesson recorded: do not hand-edit shared core files while a workflow with a no-core-changes mandate is auditing them.


### Round 2A — Fix & Feel (playtest response) — 2026-07-29
Triggered by the project owner's first real playtest. Four reports, all reproduced against code.

- **Progression deadlock (critical, shipped in v1.0):** Meadow dropped only berry/fiber, Gathering only berry/fiber, wood existed only in Forest, Forest needed level 2, level 2 cost 15 wood. **The game was unwinnable past level 1.** Fixed: Meadow now drops "fallen twigs" (wood 25%), level 2 costs 5 wood + 6 fiber, Gathering Station costs 3 wood + 2 fiber (deliberately cheaper than the level it funds, so the casual on-ramp exists). Level 2 now ≈33 min of engaged play, or one overnight with a station.
- **A SECOND deadlock found by the design pass, never reached by a player:** level 3 cost Shell + Driftwood, which drop only from the Shore, which unlocks *at* level 3. Fixed by moving those costs onto the roster upgrade (purchasable exactly when the Shore opens).
- **Sulking pips could not Rest (spec §4.7 violation, soft-lock):** `beginRest` required Idle. Since Rest is the only Energy source, a pip sulking at 0 Energy could never recover — breaking §4.4's "recovery is always one good care session away". Root cause was the state model: `Sulking` was a member of the *activity* enum, making "Sulking while Resting" unrepresentable. Fixed properly — `sulking` is now a flag orthogonal to activity, with a save migration.
- **Day 2 worse than day 1 (found by the playtest-sim auditor):** restore/decay asymmetry — Clean and Rest *set* to 100 but Feed/Play/Pet *added* less than a day removed, so every cycle ratcheted down and all five personalities Sulked on day 2. Fixed on both sides: Play 20→45, Pet 8→25 (Clingy 35), Berry 25→45, Stew 50→75/+15, plus a small decay reduction. Verified over three leave→care→leave cycles across all personalities: zero Sulking, every homecoming ≥ the last.
- **Decay retune:** rates −6/−4/−5/−3 → **−3.8/−3.7/−3.6/−3.5** (spread compressed 2:1 → 1.17:1 so bars fall together), offline cap **12h → 16h**, Rest regen **15/h → 600/h** (refilling a day's Energy deficit took 4.4 real hours; now ~10 min). Personality multipliers compressed [0.7,1.5] → [0.8,1.3] — at any tuning hitting the ~25% target, a ×1.5 mathematically forces that need to 0 on *every* absence.
- **Piplings:** 24h → **8h**, decay ×1.2 → **×0.9** ("everyone helps look after the baby"), and now allowed on the Meadow as a supervised short trip. Focus view shows a live "ready to explore in 5h 20m" countdown.
- **Debug time-skip was lying:** it skewed the clock then dispatched raw TICK, bypassing the §4.5 cap entirely — which is why 24h looked like total depletion. Now dispatches CATCHUP, with an equivalence test asserting a debug skip produces identical state to a real absence. A "live decay (no cap)" toggle remains for QA.
- **Time slider shipped** as requested: Min/Hrs/Days toggle with dynamic maxes (60/24/30), live readout, plus +5m/+15m/+1h/+6h/+24h quick jumps. Clock badge now reads "+1d 6h".
- **Sound shipped** (scope change, §12 seam retired): procedural WebAudio, zero new dependencies. Pentatonic cozy palette, per-slot voice caps, seeded pitch variation via core/rng, mute toggle, synthesis layer unit-tested against a stubbed AudioContext.
- **Orchestrator-found bug (during my own playtest):** cooldowns used `total - (now - lastUsed)` with no clamp, so a save whose stamps were written under a skewed clock (debug skew, system clock change, timezone shift) showed **~32 hours** of remaining cooldown and genuinely blocked the action — §4.5 clamps negative elapsed for decay but nobody applied it to cooldowns. Fixed in core and UI; guard test verified to fail without the fix.
- **New permanent guards:** `balance.test.ts` (encodes 2h/8h/24h feel targets across personalities) and `economy/reachability.test.ts` (proves every Keep level is purchasable from the previous level's activities, data-driven off the registries so future content is covered automatically).
- Tests: **962 passing** (was 692 at v1.0). Mutation: 8/8 killed, including a deliberate re-introduction of the wood deadlock, which the reachability test caught.


### Phase 0 — Scaffold — 2026-07-29
- Tests: `npm test` → 4 files, **48 passed** (clock, rng, store, content validation). Includes golden known-answer vectors pinning mulberry32 + FNV-1a (algorithm changes now fail tests — protects save determinism across versions) and a mutation-hardened FakeClock frozen-time test.
- Build: `tsc --noEmit && vite build` green; app bundle 32 KB gzipped (well under 350 KB budget); Pixi chunks ~58 KB gzipped.
- Manual check: blank pastel canvas verified in browser via `vite preview` (canvas mounted, zero console errors); dev server confirmed on port 5317.
- Review: adversarial audit (purity greps, spec-table fidelity, vocabulary) clean; one major finding (vacuous FakeClock drift test) found by mutation testing and fixed.
- Notes for Phase 1: aggregate per-Pip type must be named `PipState` (§0 vocabulary — only `PipActivity` exists so far); dialogue underfill validation is warn-only until Phase 2's authoring pass, then must become an error.

### Phase 1 — Pip core (logic only) — 2026-07-29
- Tests: `npm test` → 9 files, **239 passed** (needs 30, mood 14, machine 79, lifecycle 34, catchup 24, plus Phase 0's 48+). All 11 gate clauses mapped by the gate-runner to named exact-value FakeClock tests: 6h hunger −36 ±0, all five §4.2 multiplier rows, sulk enter-at-0/exit-all-≥25-inclusive, 7-day absence = exactly 12h rate changes, Clingy segmentation (2h×(−5·1.3·2.0)+4h×(−5·1.3) exact), negative-elapsed clamp, pipling ×1.2 multiplicative + adult at exactly 24h, mood precedence with boundary values, deferred sulking on expedition, rest auto-wake at exactly 100, evolution readiness flag-only at avg≥70/age≥72h.
- Build: `tsc --noEmit && vite build` green.
- Review: mutation tester ran 8 targeted mutations; 1 survived (Beaming-before-Grumpy precedence swap) → fixer added overlapping-threshold precedence tests; re-gate green. Spec audit clean.
- Notes for Phase 2: Chaotic's 10% displayed-mood offset (§4.3) is a display-layer concern — tuning value exists, must be consumed where mood selects dialogue/portrait. Dialogue underfill validation must flip warn→error after the authoring pass.

### Phase 2 — Care actions + first playable — 2026-07-29
- Tests: `npm test` → 17 files, **361 passed**. Every care action has exact stat-effect + cooldown-boundary tests (60s/30s exact via FakeClock); refusal matrix at 9.99/10 and 29.99/30; deep-equal save round-trip incl. RNG-cursor continuation (draw-5-compare); dialogue validation now hard-fails below 8 lines/pool (all 30 pools pass — 340 lines authored).
- Mutation: 8/8 mutations killed (cooldown removal, refusal thresholds, inventory decrement, rngState drop, context swap, Chaotic quirk).
- Manual check (human at the controls, browser on :5317): Feed → berry arc + munch + "Stay forever?" + Food 60→85 + Berry ×3→×2; Pet → hearts + lean-in + 30s conic cooldown ring counting down; Play → confetti + Energy −10; Rest → eyes closed + Z's + button flips to Wake; Clean → sparkle. **Reload restored everything exactly** — still Resting, cooldown expired in real time, inventory/needs intact.
- Notes for later phases: action buttons need accessible names (a11y, Phase 6); top bar is single-portrait — becomes the §10 multi-pip selector when Phase 4 hatching lands; idle animation should vary by mood (§4.3) — Phase 6 juice pass; 4 cross-personality duplicate jokes to deduplicate in a Phase 6 dialogue pass.

### Phase 3 — Save system hardening — 2026-07-29
- Tests: `npm test` → 21 files, **406 passed**. Migration fixture harness (self-extending: fails if schemaVersion bumps without a fixture); anchored-debounce autosave proven to save every action within 2000ms under continuous 1 Hz ticking; hidden + pagehide immediate flush; quarantine-before-overwrite ordering; import rejects invalid blobs with typed errors.
- **Critical bug found & fixed in-phase:** the debounce re-armed on every dispatch, so the 1 Hz ticker starved autosave forever — a real kill-tab would have lost the whole session. Now anchored: first unsaved dispatch arms the timer, later dispatches never push it back.
- Mutation: 7 mutations; 1 survived initially (boot silently creating a new game on corrupt blob — the exact §8-forbidden bug) → fixer added boot-level coverage; re-gate green (398→406 tests).
- Manual check (browser): wrench menu opens; +6h skew live-verified the personality table (Food 57→21 = 6×6, Happy −24 = 6×5×0.8 Curious, Clean −28.8 = 6×4×1.2), clock badge +6h; corrupt-save flow QA'd — modal with warm copy, broken blob quarantined verbatim in idb, Start Fresh only on explicit click; export/import round-trip incl. bad-JSON rejection toast. Debug menu confirmed absent from prod bundle (grep dist clean).
- Notes: `new Date(exportedAt)` in recovery.ts formats an injected timestamp (letter-vs-spirit of §2 rule 2 — acceptable, documented); transient echoes (lastCareOutcome/lastCatchup) remain shallow-validated.

### Phase 4 — Expeditions + eggs — 2026-07-29
- Tests: `npm test` → 29 files, **521 passed**. Full §13 Phase 4 gate mapped: seeded loot asserted item-by-item under FakeClock; egg completes during offline absence and waits in Pipping (never auto-hatches); roster-cap hatch refusal (friendly, egg intact, never expires); reload mid-expedition preserves remaining time to the ms; deferred Sulking with loot unaffected; Hardworking ×0.85 + Curious loot bonus; chronological RNG ordering across multi-pip returns; combineGenomes tested as a seam and verified uncalled by gameplay (§12).
- Save schema bumped v1→v2 with migration + fixture — the Phase 2 migration harness's first real use; live browser save migrated cleanly.
- Mutation: 9/9 killed. Verifiers all passed with minors only.
- Manual check (browser): away sheet ("You were gone 13 minutes. The Keep kept busy.") with per-pip delta chips; focus view with personality blurbs, locked-expedition copy, live countdown; Send → status glyph → +1h skip → "Mosspip is back!" reveal auto-opened with staged cards → Collect landed loot. Egg spawn → Pipping wobble → tap-hatch → new Pipling with hello line (verified by builder QA + integrator).
- Two real rendering bugs found and fixed during builder browser QA: Pixi v8 lazy worldTransform hit-testing (replaced with stage-level manual hit test) and a tab-hidden RAF pause leaving a dead tween target that killed the renderer.
- Notes for Phase 5: wire upgraded roster cap into HATCH_EGG + add the §7.4 upgrade-prompt nudge to the roster-full message; add explicit ACKNOWLEDGE_REVEAL double-dispatch idempotency test.

### Phase 5 — The Keep — 2026-07-29
- Tests: `npm test` → 38 files, **632 passed**. Placement collision/bounds/move/remove + serialize round-trip; Keep level 2 exact-bundle deduction flips Forest legality; roster upgrade raises hatch cap 3→5 end-to-end; gathering 1/10min seeded weighted table with 12h offline cap (72h → exactly 72 resources); EVOLVE_PIP applies only via the action (grep-verified single call site), variant by lastGiftItemId; schema v2→v3 migration + fixture; ACKNOWLEDGE_REVEAL idempotency added (Phase 4 note closed).
- Mutation: 9 mutations, 1 survived (AssignedJob guard removable from *live* production path — catch-up path was covered, live wasn't) → fixer added the live-path test; re-gate green.
- Manual check (browser, mobile viewport): all pips wander the fake-iso grid with y-sorting; pipling strides shorter; active-pip accent ring; gathering station sprite placed; egg on tile; Build button + Keep Lv chip; away sheet still correct. Evolution ceremony, gravitation seats (bed/bowl/station/corner), placement ghost tints verified numerically by builder harness + integrator live QA.
- Notes for Phase 6: dedupe Berry appearing as both inventory food chip and resource chip in top bar; a11y labels still pending on care buttons.

### Phase 6 — Polish, PWA, onboarding — 2026-07-29
- Tests: `npm test` → 42 files, **692 passed**. Onboarding step machine (skip semantics, deterministic starter trio, existing-save bypass via v4 migration); schema v3→v4 (onboarding + berry-to-inventory + genome addition) with fixture; mutation run 7/7 killed.
- **Perf budgets (spec §1) — measured, all pass with huge margin:**
  - App JS: **57.5 KB gzip** (budget ≤ 350 KB). Pixi chunk: 147.2 KB gzip. Total initial JS: **~198 KB gzip** (budget ≤ 550 KB). CSS: 7 KB gzip.
  - Frame rate (`?perf` harness: 5 animated pips + 30 decorations): **60.0 fps avg, p95 frame 16.8 ms, worst 17.7 ms, zero spikes > 50 ms** (budget: 60 fps, no spikes > 50 ms).
  - Warm load: domInteractive 314 ms. Fast-3G TTI modeled 1.5–2.0 s (budget ≤ 3 s; methodology in build report).
- **PWA verified end-to-end by orchestrator:** service worker activated (17 precache entries); server killed → full reload served entirely from cache (real network-independence, not simulated).
- **First-90-seconds verified live:** title card → "Three little Pips want to move in." (3 palettes/personalities with intro blurbs) → pick → land + wiggle + line → guided Feed (juice chain intact) → guided Meadow send (Hardworking's 4-min duration visible) → "off exploring" free play. Skip present on every post-pick beat.
- A11y: all controls labeled (care bar, chips, wrench); toast stack aria-live; title card keyboard-accessible. §12 seam completed: content registries accept optional `availableWindow` (unused).
- README.md with content-only add-a-species/food/expedition walkthroughs; debug menu + `?perf` documented.
- Two undocumented delight features shipped (see git history if you must — better: play).
- Incident note: a stale vite HMR module graph (from parallel builds) made starter cards unresponsive + resurrected a fixed validation error; dev-server restart resolved it — code was never wrong. Future minor polish: pips blink in sync on the pick screen; focus view rebuilds per tick (makes its DOM refs churn).

<!-- One entry per completed phase:

### Phase N — <name> — <date>
- Tests: <command run, pass/fail counts, decisive output pasted>
- Manual check: <what was verified by hand in the browser>
- Notes: <anything the next phase should know>
-->

## Decisions

<!-- One line each, newest last: date — decision — why.
Per spec §15.4: record small decisions here; stop and ask only for hard-to-reverse ones. -->

- 2026-07-29 — Dev server pinned to port 5317 with `strictPort: true` — 5173/3000/5000/8080 are occupied by other local projects.
- 2026-07-29 — typescript resolved to 7.0.2 (native tsc); works cleanly with strict + noUncheckedIndexedAccess, kept unpinned.
- 2026-07-29 — Added `grovepip` species entry as Mosspip's evolved form so evolution-target validation runs against real data (spec §4.6 requires the evolved form anyway).
- 2026-07-29 — `Rng.getState()` snapshots only streams touched so far; untouched streams re-derive from seed (tested) — keeps saves minimal without losing determinism.
- 2026-07-29 — Store throws on dispatch-from-inside-a-reducer: one-way flow is mechanically enforced, not conventional.
- 2026-07-29 — Golden known-answer tests pin mulberry32/FNV-1a exact outputs so a silent algorithm swap can't invalidate saved RNG cursors.
