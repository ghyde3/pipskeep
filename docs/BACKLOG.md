# Backlog — rounds designed but not started

These lived only in the session's task list, which does not travel with the repo. Written here so any agent, on any machine, can pick them up. Priority order is my recommendation, not a commitment.

Two rounds are **in progress and take precedence** — see the "⏸ PAUSED MID-ROUND" section at the top of `PROGRESS.md`: round 2G (HUD, built but with 4 blockers + 11 majors unfixed) and round 2H (Pip lifecycle, design only). Finish those before starting anything below.

---

## Round 2D — Pip identity & variety

Make every Pip feel like an individual. The owner's observation that started this: the three starter Pips look and read as the same creature.

1. **INDIVIDUAL NAMES (biggest win).** Today `createPipFromGenome` sets `name: contentSpecies[genome.speciesId].name`, so **every Pip is literally named after its species** — three starters all called "Mosspip", and the away sheet reads "Mosspip / Mosspip / Mosspip". Add a warm name pool in `content/` rolled deterministically from the genesis/egg stream, plus player rename. Species becomes a subtitle ("Pipsqueak · Mosspip · Curious"). Migration must not silently rename existing Pips — offer names to Pips still carrying their species name.
2. **STARTER TRIO = 3 DIFFERENT SPECIES.** Amends spec §7.1, which says "same species, three distinct palettes" — written when Mosspip was the only species. Now there are 7 lines / 14 forms. Preserve the genesis cursor-determinism property: the cursor must advance identically whichever candidate is picked.
3. **ACCESSORIES BECOME REAL.** `accessorySlots` is a dead trait — it is copied from the species registry into every genome (so not even per-individual), the resolver builds and positions an `accessoryAnchor`, and **nothing is ever attached to it**. Author an accessory set (leaf cap, scarf, flower, shell pauldron, lantern), roll per-INDIVIDUAL, render through the single resolver path. Must work for Piplings, shinies and all 14 forms automatically.
4. **PER-INDIVIDUAL JITTER.** Deterministic small variation in eye shape/spacing, proportion and marking placement so no two Pips of a species are pixel-identical. Must stay inside the fixed 118×98 sprite box — `keepScene` hit-tests against those module constants.

Open question for the owner: should game-given names be permanent, or renameable? My lean is game-given with rename available but not prominent — the Pip *is* Pipsqueak, you didn't author it.

---

## Round 2I — Real notifications (Web Push)

Unfenced by spec §16 v1.6. The highest-value remaining feature for this genre: PipsKeep runs on timers the player cannot see while the app is closed.

The `notify(event)` seam (`src/ui/notify.ts`) was designed from Phase 4 to route in-app only, with Push as the named extension point.

- Push for: expedition returns, eggs pipping, a Keep tier becoming affordable, and — critically after round 2H — a Pip contracting an ailment and its countdown nearing its end.
- 2H's promise 1 is "loss is never a surprise". That promise is only honest for a player who is actually looking; push is what makes it true for everyone else.
- Permission flow must be **earned, not cold** — ask after the first expedition send, when there is something worth being told about.
- Respect quiet hours; cap per day; every notification type individually toggleable.
- iOS PWA push needs add-to-home-screen (iOS 16.4+) — detect and explain rather than silently failing.
- Extend the existing vite-plugin-pwa service worker; do not add a second SW.
- No new runtime dependency without asking (the §1 allowlist still binds even though §12 is retired).

---

## Round 2J — Economy depth: fifth resource + crafting

**1. FIFTH RESOURCE.** Asked for by rounds 2B, 2C and 2F. Round 2F proved the need arithmetically: with only four resources the most expensive bundle `reachability.test.ts` permits is ~3.5× level 2's cost, so only 5 of the 12 Keep tiers could be priced at all — the rest are XP-gated by necessity rather than design. Source it from the late biomes so the back half of the ladder can cost something real. `RESOURCE_IDS` lives in `core/economy` — a core change, now authorized.

**2. CRAFTING.** The job system was deliberately built as a registry so Crafting could slot in without core changes (spec §6.2). Recipes as content, a crafting station placeable, resources + foods as inputs, outputs that matter: cure items for 2H's ailments, gift items that drive evolution variants, decorations, expedition provisions. Crafting gives accumulating resources a purpose beyond the Keep ladder.

Both must keep `reachability.test.ts` and `balance.test.ts` green; every new cost obtainable from the prior tier's activities.

---

## Round 2K — Attractions & the living Keep

Unfenced by §16 v1.6. The Keep-upgrade registry has carried `effect: "attraction"` as a deliberate no-op since Phase 5.

- **Attractions**: placeables that draw WILD PIPS to the Keep over time — a passive acquisition channel distinct from expedition eggs and breeding. Different attractions appeal to different species/biomes, so what you build shapes who visits. A visitor can be welcomed into the roster (respecting the cap and the Long Meadow) or simply visit and leave.
- Composes with 2H's mortality: attractions become a **third succession path** alongside lineage eggs and breeding, so a player who loses a Pip has more than one road back.
- **A living Keep** generally: weather or time-of-day mood, ambient visitors, Pips reacting to each other and to decorations. The Keep is the screen players look at most and is currently static beyond wandering.

---

## Owner decisions (2026-07-31)

- **Web only, for now.** No Steam/App Store wrapper — no Tauri, no Capacitor, no native build or signing pipeline. Do not add a packaging round or a runtime dependency for it. This simplifies round 2I: PWA push via the existing vite-plugin-pwa service worker is the whole notification story, and the only platform wrinkle left is iOS needing add-to-home-screen (16.4+).
- **Music is the owner's, not an agent's.** Do not generate, source, or scaffold a soundtrack. The procedural SFX engine from round 2A stays as-is; leave the `sound(slotId)` seam alone unless asked.
- **Art remains the biggest gap and is unassigned.** Spec §11 still describes the "Placeholder Standard": every Pip is procedurally drawn. `render/spriteResolver.ts` is the single swap point and has held up through 14 species forms, accessories and jitter — real sprite sheets should drop in there without touching anything else. This is a money-and-taste decision, not an orchestration problem.

## Standing recommendations not yet scheduled

- **Day 30 is thin.** Round 2F's design pass said so plainly: day 14 has four named pulls, day 30 has Renown and little else. 2H (individual Pips that develop and are finite) is the main answer; if it lands and day 30 is still thin, that is the next design problem.
- **Six dead features have shipped so far** — `evolved.variantId`, milestone flair, the Album's bucketed patterns, `state.keepsakes`, Renown's reward, and the loot reveal's XP chip. Spec §16 v1.3 made it a standing rule: *"written to state" and "visible to the player" are separate acceptance criteria.* Every round since has still found one. Keep the mutation-testing stage that catches them.

## Known defects awaiting a polish pass

- **Accessory placement (round 2D).** Several of the 12 accessories render on the wrong body part: the scarf sits across the mouth rather than the neck, and the round's identity audit also reported the lantern over an eye and the bowtie/ember bead on the belly. Head accessories can also collide with the species sprout and float detached above the crown with inconsistent z-order. Visible on the starter-pick screen — the first thing a new player sees. Fix in `render/spriteResolver.ts`'s `drawAccessory` plus the two DOM portrait stylesheets, keeping `portraitPatterns.test.ts` parity green.
- **Jitter is near-invisible.** Under ~1 CSS px at Keep scale and applied on one surface of seven. Either make it perceptible or cut it — an imperceptible feature is a dead one.
- **The cure ceiling is unguarded (round 2J).** The round named `crafting.balance.test.ts` as the guard for its own invariant — that crafting moves the survival *floor*, not the *rate* — and never created it. The arithmetic was verified by hand in `docs/economy-bible.md` §4 but is pinned by nothing, so a later tuning change can breach it silently.
- **No late-game sink (round 2J).** Lodestone, wood and fiber all accumulate uselessly from roughly tier 12. The economy bible argued honestly that make-work sinks are how a cosy game becomes a grind, so this needs a *desirable* sink (something a player wants, not something that merely consumes), not a bigger number.
- **Poultice Shelf and three `longevity` placeables have no effects wired.** Named headlines that do literally nothing; found by 2J's design pass, not fixed by it.
