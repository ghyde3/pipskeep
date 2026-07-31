# PipsKeep — Build Specification v1.1

A browser-based virtual pet game. Players raise small creatures called **Pips** — feeding them, cleaning up after them, sending them on expeditions, and hatching new ones — while expanding a cozy habitat called the Keep.

Tone: wholesome with a mischievous streak. Warm, slightly chaotic, memeable. Never dark, never punishing, never grindy.

> **Decisions marked `[DEFAULT — review]` are proposed values, not settled design.** Implement them as specified; they are all in config files, so tuning them later is a data change, not a code change.

---

## 0. Naming & Vocabulary (use these exact terms everywhere)

| Term | Meaning | Code identifier |
|---|---|---|
| **Pip** | A creature | `Pip`, `PipId`, `PipState` |
| **Pipling** | A newly hatched Pip (juvenile stage) | `LifeStage.Pipling` |
| **Pipping** | The state of an egg beginning to hatch | `EggState.Pipping` |
| **The Keep** | The player's habitat/base | `Keep`, `KeepState` |
| **Species** | Compound diminutives: Mosspip, Emberpip, Snowpip | `speciesId: "mosspip"` |

- Game title: **PipsKeep** (one word, capital P, capital K).
- Never use "Pal", "-gotchi", "pocket monster", or any Pokémon/Palworld/Tamagotchi trademark in code, UI copy, asset names, or docs.
- Flavor text convention: eggs "pip" when hatching begins — e.g. *"Your egg is pipping!"*

---

## 1. Technical Stack (committed — no substitutions)

- **Language:** TypeScript, `strict: true`. No `any` without an inline justification comment.
- **Build:** Vite.
- **Rendering:** **PixiJS** (latest stable v8). No Phaser. No Three.js or any 3D library.
- **UI layer:** DOM/HTML overlaid on the Pixi canvas for menus, buttons, dialogs, and HUD. Pixi renders the world (Keep, Pips, animations); DOM renders the interface. Plain TypeScript + CSS — no React/Vue/Svelte.
- **State:** A single plain-object game state tree with a small custom store (subscribe/dispatch). No external state library.
- **Persistence:** IndexedDB via the `idb` package. **No localStorage fallback** (see §8).
- **Package manager:** npm.
- **Dependency allowlist:** `pixi.js`, `idb`. Dev deps: `vite`, `typescript`, `vitest`. **Anything else requires stopping and asking.**
- **PWA:** installable, offline-capable. Web app manifest + service worker (Vite PWA plugin is a permitted dev dep for this). Cache-first for assets, network-independent gameplay.
- **Testing:** Vitest for all logic modules. Rendering is not unit-tested; logic is.

### Performance budgets (measurable, verify in Phase 6)

- Initial JS bundle: app code ≤ 350 KB gzipped excluding Pixi; ≤ 550 KB gzipped total including Pixi.
- 60 fps on a mid-range phone profile (Chrome DevTools 4x CPU throttle) with 5 animated Pips + 30 decorations on screen.
- Time-to-interactive ≤ 3s on simulated Fast 3G, warm cache ≤ 1s.
- No frame-time spikes > 50ms during care-action animations.

---

## 2. Architecture Rules

```
src/
  core/        # Pure logic. No Pixi, no DOM, no Date.now(). Fully unit-tested.
    clock.ts   # Clock interface + implementations
    rng.ts     # Seeded PRNG
    pips/      # Pip state machine, needs, personality, lifecycle
    eggs/      # Egg state machine, incubation, inheritance
    expeditions/
    keep/      # Habitat state, plots, placement
    economy/   # Resources, costs, inventory
    save/      # Serialization, schema versioning, migrations
  content/     # ALL game data as typed config (see §3). No logic.
  render/      # Pixi scenes, sprites, animations. Reads state, never mutates it.
  ui/          # DOM interface. Dispatches actions, never mutates state directly.
  app/         # Bootstrapping, game loop, service worker registration
```

**Hard rules:**

1. **`core/` is pure.** No rendering imports, no browser APIs except through injected interfaces. Every system in `core/` has unit tests.
2. **Time is injected.** A single `Clock` interface (`now(): number` in ms). Production uses real time; tests use a `FakeClock` that can be advanced arbitrarily. **Zero direct calls to `Date.now()` or `new Date()` outside `clock.ts`.** This is non-negotiable — it is what makes a real-time game testable.
3. **Randomness is seeded.** One PRNG module (mulberry32 or similar), seeded per save, with derived streams per system (`rng.stream("expedition-loot")`). No `Math.random()` outside `rng.ts`. **Each stream's cursor position is part of `GameState` and is serialized in the save** — a given save file therefore always produces the same future rolls, and reloading never re-rolls or skips an outcome. There is no separate event log; "reproducible" means *load the exported save, get identical results*, which is also the debugging workflow (§8 export/import).
4. **State flows one way.** UI/render dispatch actions → core reducers produce new state → render/UI react. No back doors.
5. **Content is data.** See §3. Adding a species, food, or expedition must never require touching `core/`.

---

## 3. Content as Data

All of the following live in `content/` as typed, validated config objects:

- **Species registry** — id, display name, base sprite variant params (palette, pattern, accessory slots), evolution conditions, rarity.
- **Foods** — id, name, hunger restore, side effects (happiness, energy), cost.
- **Expeditions** — id, name, unlock condition, duration, loot table (weighted), egg chance, flavor text.
- **Personalities** — id, name, decay modifiers (§4), dialogue pool reference, reaction quirks.
- **Dialogue** — keyed by `personality × context`, where context is the four moods (§4.3) plus **Sulking** (§4.4) and **Refusal** (used whenever a Pip declines Play/Job/Expedition). **Minimum 8 lines per context per personality** — 6 contexts × 5 personalities × 8 lines = **240 lines minimum at launch**; budget real authoring time for this in Phase 2. Under-writing dialogue is a spec violation; the charm of the game lives here. Lines should be short, opinionated, occasionally weird.
- **Keep upgrades** — id, cost, effect, prerequisite.
- **Decorations** — id, cost, footprint, sprite ref.

Each registry gets a validation function run at boot in dev mode (missing sprite refs, broken evolution targets, empty loot tables → loud console error).

---

## 4. Pips — Needs, Personality, Lifecycle

### 4.1 Stats

Four needs, each 0–100: **Hunger, Cleanliness, Happiness, Energy.** (100 = fully satisfied.)

**Base decay rates** `[DEFAULT — review]`, per real-time hour:

| Need | Decay/hour |
|---|---|
| Hunger | −6 |
| Cleanliness | −4 |
| Happiness | −5 |
| Energy | −3 (awake), **+15 while Resting** |

Effective rate = base × personality modifier (§4.2) × life-stage modifier (§4.6) × situational modifier (e.g. Clingy's expedition penalty). **All modifiers stack multiplicatively.**

### 4.2 Personalities

Five at launch. Modifiers are multipliers on base decay `[DEFAULT — review]`:

| Personality | Hunger | Clean | Happy | Energy | Quirk |
|---|---|---|---|---|---|
| Lazy | ×0.8 | ×1.0 | ×1.0 | ×1.4 | Refuses Play per §5 refusal rules; loves Rest |
| Curious | ×1.0 | ×1.2 | ×0.8 | ×1.1 | +10% expedition loot |
| Hardworking | ×1.2 | ×1.0 | ×1.1 | ×1.2 | −15% expedition duration |
| Chaotic | ×1.1 | ×1.5 | ×0.7 | ×1.0 | Random reaction table; occasionally "helps" wrong |
| Clingy | ×1.0 | ×1.0 | ×1.3* | ×0.9 | *Happiness ×2.0 decay while on expedition; +bonus from Pet |

### 4.3 Mood

Derived, not stored. Computed from current needs:

- **Beaming** — all needs ≥ 70
- **Content** — all needs ≥ 40
- **Grumpy** — any need < 40
- **Miserable** — any need < 15

The thresholds overlap; resolve by evaluating in this order, first match wins: **Miserable → Grumpy → Beaming → Content**. Tests must assert this order.

Mood selects the dialogue pool, idle animation set, and portrait expression. Chaotic personality has a 10% chance to display a mood one step off from actual (this is a feature).

### 4.4 The floor: Pips do not die. Ever.

- At 0 in any need, the Pip enters **Sulking**: greyed-out mood, sad idle animation, guilt-trip dialogue (its own dialogue context, §3), and it refuses expeditions/jobs. That is the entire penalty.
- **Enter:** any need reaches 0 while the Pip is in Idle, Resting, or AssignedJob. If a need hits 0 while OnExpedition/Returning, the expedition completes normally with full loot (never punish) and the Pip enters Sulking the moment it lands back in Idle.
- **Exit:** all four needs ≥ 25 (inclusive) → back to Idle. One good care session covers it.
- No death, no running away, no permanent stat damage, no lost Pips. Recovery is always one good care session away. This is a hard tone rule, not a tuning value.

### 4.5 Offline catch-up

On load, compute `elapsed = max(0, clock.now() − savedAt)` and apply everything in **one chronological catch-up pass**:

1. **Collect timed events** with absolute timestamps inside the absence window: expedition completions, egg incubation completions, Rest auto-wakes (the computable moment Energy reaches 100), and Gathering production ticks.
2. **Process segments chronologically.** Between consecutive events, apply need rates using each Pip's state *during that segment* — so a Clingy Pip's ×2.0 happiness decay applies only to the portion of the absence it actually spent OnExpedition, and Rest regen stops at its auto-wake moment, not at load time.
3. **The rate cap: needs change (decay *and* regen) and Gathering production accrue only during the first 12 hours of absence** `[DEFAULT — review]`; after that they freeze. "First 12 hours" so the frozen state reflects roughly what the player left behind — and every discrete timer (30-min expeditions, 2-h eggs) lands inside that window in practice. A player returning after a week finds a grumpy Keep, not a wasteland. Rule of thumb: **rates are capped, timers are not.**
4. Expedition and egg timers are **never capped** — they complete in full while away (returning to good news is the hook to come back).
5. Sulking entry/exit (§4.4) is evaluated at every segment boundary and at the end of the pass.

- Catch-up produces a **"While you were away…"** summary sheet on load: needs changes, expeditions completed, eggs pipped, resources gathered.
- **Clock-tamper policy: we do not care.** Single-player, no leaderboards. If the player rolls their system clock forward to skip an expedition, that's their toy. Negative elapsed time (clock rolled *back*) clamps to 0 — never apply negative decay or rewind timers.

### 4.6 Life stages & evolution

- **Pipling** (hatch → 24h real time `[DEFAULT — review]`): smaller sprite, cannot go on expeditions, needs decay ×1.2.
- **Adult**: full capabilities.
- **Evolution** (MVP: one evolved form for the starter species). Concrete mechanism:
  - Each Pip stores `ageMs` and `happinessIntegral` (time-weighted sum of Happiness, updated whenever needs are recomputed; during rate-frozen catch-up segments the frozen value keeps accruing). **Lifetime average Happiness = `happinessIntegral / ageMs`.**
  - When `ageMs ≥ 72h` **and** lifetime average Happiness ≥ 70 `[DEFAULT — review]`, the Pip becomes **ready to evolve**: it glows and waits for the player to tap it. Like hatching, evolution is player-witnessed, never automatic. (This is a flag on `PipState`, not a new state-machine state.)
  - **Variant selection:** the most recent Give Item used on that Pip (`lastGiftItemId`, stored on the Pip) selects the variant; if none, the default variant.
  - Thresholds and variant mappings live in the species registry.

### 4.7 Pip state machine

```
Idle ⇄ Resting
Idle → AssignedJob → Idle
Idle → OnExpedition → Returning → Idle
Idle | Resting | AssignedJob → Sulking → Idle
  (enter: any need hits 0; exit: all needs ≥ 25 — see §4.4.
   OnExpedition/Returning defer Sulking entry until back at Idle.)
```

- **Needs decay in every state, including OnExpedition** (Clingy's happiness penalty makes expedition assignment a real choice).
- Care actions are legal only in Idle, Resting, Sulking (i.e., not while away).
- Sulking Pips refuse Job/Expedition assignment with personality-appropriate dialogue.

---

## 5. Care Actions

All actions are instant, with a short (< 1.5s) juicy animation. Effects `[DEFAULT — review]`:

| Action | Effect | Notes |
|---|---|---|
| Feed | +Hunger per food item (content-defined, e.g. Berry +25, Stew +50/+5 Happy) | Consumes inventory item |
| Clean | Cleanliness → 100 | 60s cooldown to prevent spam-idling |
| Play | +20 Happiness, −10 Energy | Refusal rules below |
| Pet | +8 Happiness | 30s cooldown; Clingy gets +14 |
| Rest | Toggles Resting state (Energy +15/hour) | Pip auto-wakes at 100 |
| Give Item | Content-defined special effects | Also drives evolution variants |

**Play refusal rules** `[DEFAULT — review]`: any Pip refuses Play below 10 Energy (can't afford the cost). Lazy Pips additionally refuse below 30 Energy, and refuse any other Play 15% of the time just because. A refusal costs nothing, triggers no cooldown, and draws from the Refusal dialogue context (§3) — refusals should be funny, not frustrating.

**Clean is deliberately trivial:** instant restore to 100 with a short cooldown makes Cleanliness a check-in ritual, not a resource to manage. This is intended tone (§4.4), not an oversight.

Every action produces: stat change, animation, one dialogue line drawn from `personality × context` (§3), and a small particle/sound-slot hook (sounds optional in MVP; leave the seam).

---

## 6. Expeditions & Jobs

### 6.1 Expeditions (MVP: 3)

| Expedition | Duration | Unlock | Loot focus | Egg chance |
|---|---|---|---|---|
| Meadow | 5 min | start | Berries, Fiber | 8% |
| Forest | 15 min | Keep level 2 | Wood, Berries, uncommon items | 12% |
| Shore | 30 min | Keep level 3 | Shells, Driftwood, rare items | 18% |

`[DEFAULT — review]` — all values in `content/expeditions.ts`.

- One Pip per expedition; multiple Pips can be out simultaneously on different expeditions.
- Timers run on real time via `Clock`; completion is computed on the fly (no setTimeout persistence — derive from `departureTime + duration` so it survives reload).
- Return produces a **loot reveal moment**: modal with staged reveals, rare finds get extra flair. This moment is the dopamine core — make it juicy.
- Loot rolls use the seeded RNG expedition stream.

### 6.2 Jobs (MVP: minimal)

- One job type: **Gathering** at a placed Gathering Station — a Pip in the `AssignedJob` state at the station passively produces 1 resource per 10 min `[DEFAULT — review]`, rolled from the station's weighted table (Berries 70% / Fiber 30% `[DEFAULT — review]`). Offline production obeys the 12-hour rate cap (§4.5).
- Structure the job system as a registry so Crafting/Decorating slot in later without core changes.

### 6.3 Resources & economy (MVP)

- **No abstract currency.** Resources *are* the currency: Berries, Fiber, Wood, Shells, Driftwood, plus content-defined uncommon/rare items.
- **All acquisition is expeditions + the Gathering job.** There is no shop in MVP. The `cost` field on foods, decorations, and Keep upgrades is a resource bundle (e.g. `{ wood: 4 }`); food `cost` may go unused in MVP — it is the seam for a future shop.
- Foods are loot: Berries drop everywhere; richer foods (e.g. Stew) appear as uncommon drops in Forest/Shore loot tables.
- Keep level costs `[DEFAULT — review]`: Level 2 = 15 Wood + 10 Fiber; Level 3 = 20 Wood + 12 Shells + 6 Driftwood. In `content/keep.ts`.
- New saves are seeded with **3 Berries** `[DEFAULT — review]` so the guided first Feed (§10.1) always works.

---

## 7. Eggs, Acquisition & Breeding

### 7.1 Sources (MVP)

1. **Starter:** onboarding offers 3 starter Pips — **three DIFFERENT species** (amended §16 v1.7; the original "same species, three distinct palettes" was written when Mosspip was the only species), each with its own silhouette, palette, pattern, personality, individual name and worn accessory, all shown up front; player picks one.
2. **Expedition eggs** per §6.1 chances.
3. ~~Breeding~~ — **NOT in MVP** (see §12), but inheritance data structures are built now (§7.3).

### 7.2 Egg state machine

```
Found → Incubating → Pipping → Hatched
```

- Incubation: real-time timer, 2h `[DEFAULT — review]`, content-defined per rarity. Not capped by offline rules — completes while away.
- **Pipping**: when the timer completes, the egg visibly cracks and wobbles in the Keep and waits for the player to tap it. Hatching is always a player-witnessed moment, never automatic.
- Hatch produces a Pipling with species + traits rolled from the RNG egg stream.

### 7.3 Traits & inheritance

Each Pip carries a trait genome: `{ species, palette, pattern, personality }`, plus `shiny` and the individually rolled `accessoryId` (**`accessorySlots` was removed in §16 v1.7** — it was per-species data living in per-individual state that nothing rendered). Expedition eggs roll all of it randomly (weighted by registry rarity). The genome structure and a `combineGenomes(a, b, rng)` function are implemented and unit-tested **now** so breeding is a UI feature later, not a data migration.

### 7.4 Roster cap

- **3 active Pips** at MVP. Keep upgrade raises to 5 `[DEFAULT — review]`.
- At cap, eggs can still be found and incubated, but hatching is blocked with a friendly message until space exists (upgrade prompt). Eggs never expire.

---

## 8. Save System

- **IndexedDB only** (via `idb`). No localStorage fallback — every browser that can install a PWA has IndexedDB, and a second serialization path will drift.
- Save shape: `{ schemaVersion: number, seed: number, savedAt: number, state: GameState }`. `GameState` includes the RNG stream cursors (§2 rule 3) — reloading a save must never re-roll or skip a random outcome.
- **Migrations from day one:** a `migrate(save)` function keyed by `schemaVersion`, with a test that loads a fixture save from each historical version. The save shape *will* change mid-build; this is how it doesn't hurt.
- Autosave: on every state-mutating action (debounced 2s) + on `visibilitychange` to hidden.
- Load failure (corrupt/unmigratable): offer "Start Fresh" with the broken blob exported to a downloadable file — never silently wipe.
- Export/Import save as a JSON file in a debug menu (also your QA tool).

---

## 9. The Keep (Habitat)

- Top-down 2D diorama with a slight vertical offset for depth (fake-iso via y-sorting; no isometric grid math in MVP).
- Grid-based placement, starting area 8×8 tiles `[DEFAULT — review]`.
- **Keep level** gates content: Level 1 (start) → Level 2 (unlocks Forest, +4×8 plot) → Level 3 (unlocks Shore, roster upgrade purchasable). Costs in `content/keep.ts`.
- Placeables (MVP): Food Bowl, Bed, Gathering Station, ~6 decorations. Placement UI: tap-to-place with grid snap, move/remove supported.
- Pips wander the Keep with simple idle pathing (random walk between free tiles, pause, idle animation). They gravitate toward relevant stations (Bed while Resting, Bowl when hungry) — approximate is fine, alive is the goal.

---

## 10. UI / UX

- **Mobile-first**, portrait-primary, fully responsive to desktop.
- **Persistent top bar:** active Pip selector (portraits with mood dot), four need bars for selected Pip, resource counts.
- **Bottom action bar:** big thumb-friendly care buttons (Feed, Clean, Play, Pet, Rest, Items).
- **Two views:** Keep view (world) ⇄ Pip focus view (large portrait, stats, personality, dialogue log, assign-to-expedition).
- **Inventory:** simple grid sheet.
- **Notifications: in-app only for MVP.** A badge/toast system for: expedition return, egg pipping, need < 25, Sulking. Web Push / service-worker notifications are explicitly out of scope; leave a `notify(event)` seam where they'd plug in.
- **Onboarding:** ≤ 60 seconds — pick a starter, guided first Feed, guided first expedition send. Skippable.

### 10.1 First 90 seconds (the acceptance bar for "feels good")

1. Title card → tap → three starter Pips bounce in, each with a one-line personality intro. Player taps one; the others wave goodbye (they're fine).
2. Chosen Pip lands in the Keep, does a happy wiggle, says a line. Hunger bar is visibly at ~60.
3. Prompt: "Pips get hungry! Try feeding them." Player taps Feed → Berry (from the seeded starting inventory, §6.3) → eating animation + munch particles + happy line + bar fills. It must feel *juicy*.
4. Prompt: "Pips love exploring." Player sends Pip to the Meadow (5 min timer starts, Pip trots off-screen with a wave).
5. Free play in the Keep. At ~5 min the return notification fires → loot reveal moment.

If this sequence is boring, the game is boring. Judge every animation-polish decision against it.

---

## 11. Art (Placeholder Standard)

- Placeholder Pips: layered Pixi graphics — rounded body shape + eyes + palette + pattern overlay + accessory anchor points. Composed procedurally from the trait genome so variants are visible *now*.
- All sprites load through a single `SpriteResolver` mapping `(species, stage, palette, pattern) → texture/composition`. Dropping in real sprite sheets later = swapping the resolver, nothing else.
- Palette: soft pastels + one vibrant accent per species. Define as CSS/JS tokens in `content/palette.ts`.
- Animation via lightweight tween utility: squash-and-stretch on actions, bounce on hatch, wobble on pipping eggs. Juice is a requirement, not polish.

---

## 12. Scope Fence

**Do not implement anything in this list.** Leave the named seam only:

| Deferred feature | Seam that must exist |
|---|---|
| Breeding UI | `combineGenomes()` tested in core |
| More species | Species registry entries |
| Attraction buildings | Keep upgrade registry supports `effect: "attraction"` no-op |
| Seasonal events | Content registries accept optional `availableWindow` field (unused) |
| Multiplayer / share codes | Save export/import (§8) is the seam |
| Sound | `sound(slotId)` no-op hooks on actions |
| Web Push | `notify(event)` routes to in-app only |

If mid-build you believe something deferred is actually load-bearing, **stop and ask** — do not implement it speculatively.

---

## 13. Build Phases & Exit Gates

Work strictly in order. **Each phase ends with its gate verified (tests passing + manual check noted in a `PROGRESS.md` log) before the next begins.**

**Phase 0 — Scaffold**
Vite + TS strict + Pixi + Vitest wired; folder structure per §2; Clock + RNG modules with tests; empty state store; content registries typed with validation; CI-able `npm test` and `npm run build` both green.
*Gate:* `FakeClock` advance test passes; RNG stream determinism test passes; build produces a running blank canvas.

**Phase 1 — Pip core (logic only)**
Needs decay, personalities, moods, Sulking floor, catch-up with 12h cap, life stages, Pip state machine.
*Gate (all via FakeClock, no UI):* advancing 6h drops Hunger by exactly the configured amount ±0; personality multipliers verified per table; need at 0 → Sulking, all needs ≥ 25 → Idle; 7-day absence applies exactly 12h of rate changes (first-12h cap, §4.5); catch-up segmentation verified (a Clingy Pip whose expedition spans part of the absence gets ×2.0 happiness decay for exactly that segment); negative elapsed clamps to 0.

**Phase 2 — Care actions + first playable**
Care actions in core with cooldowns; minimal Keep view rendering one Pip; top/bottom bars; dialogue system with full line pools.
*Gate:* every care action has a unit test for stat effect + cooldown; a human can feed/clean/play/pet/rest a Pip in the browser and every action shows animation + dialogue; save/reload preserves state exactly (deep-equal test).

**Phase 3 — Save system hardening**
IndexedDB persistence, schemaVersion + migration harness, autosave, corrupt-save recovery, export/import.
*Gate:* migration fixture test passes; kill-tab-mid-session loses ≤ 2s of actions; corrupt blob triggers recovery flow, not a wipe.

**Phase 4 — Expeditions + eggs**
All 3 expeditions, loot tables, timer derivation from timestamps, loot reveal UI, egg lifecycle through hatch, roster cap, "While you were away" sheet.
*Gate:* FakeClock test — send Pip, advance duration, state = Returning, collect = correct seeded loot; egg completes offline and waits in Pipping; hatching at roster cap blocks with message; reload mid-expedition preserves remaining time exactly; a need hitting 0 mid-expedition defers Sulking until return, loot unaffected.

**Phase 5 — The Keep**
Grid placement, Keep levels, placeables, Pip wandering/pathing, Gathering job, evolution for starter species.
*Gate:* place/move/remove survives reload; Keep level 2 purchase unlocks Forest; Pips visibly wander and gravitate; evolution readiness triggers under FakeClock-simulated care (lifetime-average mechanism, §4.6) and completes only on player tap; `lastGiftItemId` selects the variant.

**Phase 6 — Polish, PWA, onboarding**
Onboarding flow, first-90-seconds sequence tuned, in-app notifications, PWA manifest + service worker + offline, performance budget verification, README.
*Gate:* installs as PWA and runs airplane-mode; Lighthouse PWA checks pass; perf budgets in §1 measured and recorded in `PROGRESS.md`; first-90-seconds runs clean on a throttled mobile profile.

---

## 14. Deliverables

- Runnable repo: `npm install && npm run dev`.
- `README.md`: run instructions, architecture overview, how to add a species/food/expedition (content-only walkthrough proving §3).
- `PROGRESS.md`: phase gate log with test evidence.
- All `[DEFAULT — review]` values collected in one `content/tuning.ts` (or clearly co-located per registry) so balancing is a single-file pass.
- Debug menu (dev builds only): FakeClock time-skip buttons (+1h, +6h, +24h), grant resources, spawn egg, export/import save.

---

## 15. Standing Instructions for the Build Agent

1. Follow phases in order; do not start a phase before the prior gate is logged in `PROGRESS.md`.
2. Do not add dependencies outside the allowlist without asking.
3. Do not implement anything in §12 beyond its named seam.
4. When the spec is silent, prefer the smallest implementation that keeps `core/` pure and content in `content/`, note the decision in `PROGRESS.md`, and continue — only stop and ask for decisions that are hard to reverse (schema shape, state-tree structure, rendering approach).
5. Tone check on all player-facing text: warm, mischievous, opinionated. Never guilt the player harshly; even Sulking dialogue should be funny-sad, not bleak.

---

## 16. Changelog

**v1.7 (2026-07-31)** — **round 2D: Pips become individuals.** Three sections are amended by what this round shipped.

- **§7.1 is amended: the starter trio is THREE DIFFERENT SPECIES.** The old wording ("same species, three distinct palettes + personalities") was written when Mosspip was the only species; there are now 14 forms. The trio is Mosspip / Pebblepip / Tidepip — three silhouettes, three palette families, three biome affinities, three personalities, three names, three accessories — so the first decision a player makes is a real one. Common-tier on purpose: a starter is a free pick outside the rarity economy. **The genesis cursor contract is unchanged and still binds**: `rollStarterCandidates` consumes a fixed number of rolls per candidate and `createNewGame` rolls all three names BEFORE it knows the winner, so the RNG cursor advances identically whichever Pip is picked.
- **§7.3 is amended: `accessorySlots` is removed from the trait genome.** The genome is `{ species, palette, pattern, personality }` plus `shiny` and `accessoryId`. `accessorySlots` was written into every genome, serialized, schema-validated and migrated since Phase 1, and **no surface ever rendered it** — it was not even per-individual (copied verbatim from the species registry), and it was not constant (evolved forms carried 2, base forms 1), so the save file promised a second accessory that could never appear. One accessory per Pip is the design: one anchor on the rig, one shape on each of the three render surfaces. Old saves keep the key harmlessly; the validator drops it on first load. No migration step needed.
- **§0 gains a vocabulary rule for NAMES.** A Pip's name may never be a word the game already uses for a THING. The first name pool shipped nine collisions and every one broke a real sentence — "Feed Berry a Berry", "Send Meadow to the Meadow", a Pip called Sprout when a sprout is the accent feature every Pip wears, a shiny called Glimmer when "glimmer" IS the word for shiny. `content/names.test.ts` now derives the forbidden vocabulary from the content registries themselves, so the rule cannot rot as either side grows.

**Two standing rules earned again this round** (both are §16 v1.3's, restated because they were violated in the same shapes):

1. **"Written to state" and "visible to the player" are separate acceptance criteria** — and *"visible on one surface"* is not *"visible"*. Jitter was applied at exactly one production call site, which was also the smallest sprite in the game; accessories were stripped by four portrait builders; the cast strip — the only roster list on screen 100% of the time — carried no name, accessory, pattern or silhouette at all. Every round should produce the visibility table, and every row of it should name **all** the surfaces.
2. **A guard that never renders is not a guard.** The accessory parity test string-matched CSS and called pure functions; deleting the `appendChild` on BOTH DOM portraits left the suite green. Tests for a visual feature must build the DOM and query the node.

**v1.6 (2026-07-30)** — **§12 (Scope Fence) is RETIRED by owner decision.** "Anything ruled out because of MVP we don't need to worry about anymore — if you find value in building a feature, just build it."

§12 existed to stop an MVP sprawling. The MVP shipped (v1.0), and eight rounds have since built well past it, so the fence now only blocks value. It is void. The **seams it protected were well-designed and every one of them is now a door**:

| Formerly fenced | Its seam | Status |
|---|---|---|
| Breeding UI | `combineGenomes()` | **Unfenced v1.5** — live in round 2H as the succession mechanic |
| More species | Species registry | **Done** (round 2B — 14 forms) |
| Sound | `sound(slotId)` no-ops | **Done** (round 2A — procedural WebAudio) |
| Seasonal events | `availableWindow` | **Done** (round 2C — annually recurring, never exclusive) |
| Web Push | `notify(event)` routes in-app only | **NOW OPEN** — the highest-value remaining item |
| Attraction buildings | Keep-upgrade registry `effect: "attraction"` no-op | **NOW OPEN** |
| Multiplayer / share codes | Save export/import (§8) | **NOW OPEN** |

**What does NOT change:** the §1 dependency allowlist still requires a stop-and-ask before adding a runtime dependency; `core/` purity, seeded determinism, injected time, and content-as-data are architecture, not scope, and still bind; and every tone rule — including v1.5's five promises — still binds. Retiring the fence removes a ceiling, not the foundations.


**v1.5 (2026-07-30)** — **§4.4 is amended by owner decision. Pips are now finite.** This reverses the project's oldest hard rule, so the replacement rule is written with equal force.

The old rule ("Pips do not die. Ever… no lost Pips") produced a game with no stakes: nothing a player did could go wrong, so nothing they did felt weighty. Pips are now closer to livestock than to furniture — some last a long time, none last forever. **What replaces the old rule is not permission to punish; it is a set of promises about how loss may happen.**

**The five promises (hard rules, not tuning values):**
1. **Loss is never a surprise.** A Pip never simply fails to return. Danger arrives as an **ailment with a visible countdown**, and the player always gets a real, actionable chance to save them.
2. **Loss is never caused by absence.** Ailment progression obeys the same offline rate cap as needs (§4.5). A player who closes the app for a week must never come back to a Pip who died *because they were away*. This preserves round 2C's guardrail: reward showing up, never punish absence.
3. **Old age is peaceful, not a death.** A Pip who reaches the end of a full life **retires to the Long Meadow** — still named, still visitable, still in the Album, never deleted. Only danger can truly take a Pip.
4. **Every loss leaves a thread to pull.** A Pip lost to an ailment **leaves an egg in the biome that took them**, findable on later expeditions there, carrying their lineage. Loss is a quest, not a dead end.
5. **The Keep is never empty.** At least one Pip always remains active; a player can never return to an unplayable Keep.

**Companions to the amendment:**
- **Pips level individually** (§4.6 extended). Earned levels improve that Pip: slower need decay, faster expeditions, better resilience. Capped so a veteran Pip shortens the care *chore* without trivializing care (the `balance.test.ts` guard still binds).
- **Breeding is UNFENCED** (§12 amended). `combineGenomes()` — implemented and tested since Phase 4, deliberately uncalled — is now live. Lineage is the succession mechanic: descendants inherit traits and a share of earned progress.
- **The Album is permanent.** A Pip lost or retired keeps its page forever. Collection progress can never regress.


**v1.3 (2026-07-29)** — content expansion (round 2B).

- **§3 holds, with one named exception.** Species, foods, decorations, expeditions and even a new *job* were all added as pure content. The exception is deliberate: `HATCH_EGG` now reads an egg's `sourceExpeditionId` so eggs hatch their biome's species. Per-biome pools are a **feature** (the collection engine), not content addition, so §3 is not violated — but any such change must preserve the RNG cursor contract exactly, and that is now tested.
- **New standing rule (generalizing v1.2's):** evolved forms carry the zero-weight `lineage` rarity tier and can never be rolled from an egg. Evolution must be earned.
- **§4.6 gift variants are now actually rendered.** `evolved.variantId` was stored and never read from Phase 5 until this round; the variant looks did not exist as data. A stored variant that nothing displays is a dead feature — treat "written to state" and "visible to the player" as separate acceptance criteria.
- **§6.1 expeditions are now six**, as a quick-trip/deep-trip pair per Keep level. Deep trips are intentionally *not* throughput upgrades; they are the sole source of their biome's species and foods.
- **§10 reporting rule:** anything that reports Sulking to the player must use `isSulking`, never `activity === "sulking"` — a Pip can nap through a sulk. Applies to toasts, the away sheet, and any future summary surface.

**v1.2 (2026-07-29)** — playtest amendments. v1.0 shipped, was played, and the feedback overrode several spec decisions. Where this section conflicts with earlier sections, **this section wins**; tuning values live in `content/tuning.ts` as always.

- **§6.3 economy was unwinnable and is corrected.** The costs I set in v1.1 created a circular dependency (level 2 needs wood; wood needs Forest; Forest needs level 2) and a second one at level 3 (shell/driftwood need the Shore, which unlocks at level 3). Meadow now drops wood; level costs are rebalanced; shell/driftwood moved to the roster upgrade. **New standing rule: every gated cost must be obtainable from activities unlocked at the previous tier, enforced by `economy/reachability.test.ts`.**
- **§4.7 Sulking is a flag, not an activity.** Modelling it as an activity made "Sulking while Resting" unrepresentable and soft-locked any pip that hit 0 Energy. `PipState.sulking` is now orthogonal to `activity`. Rest is legal from Sulking, as §4.7 always intended.
- **§4.1/§4.2 decay retuned** to −3.8/−3.7/−3.6/−3.5 with the offline cap at **16h** and personality multipliers compressed to [0.8, 1.3]. Rationale: any multiplier ≥1.5 mathematically drives its need to 0 on every absence at a tuning that targets ~25%.
- **§5 restore values raised** so one care session out-restores one full capped absence for every personality — otherwise each day/care cycle ratchets downward and day 2 is worse than day 1.
- **§4.6 Pipling stage: 24h → 8h, decay ×1.2 → ×0.9**, and Piplings may take the Meadow (shortest expedition) as a supervised trip. A stage that could do nothing *and* cost more upkeep was pure tax on the game's most exciting moment.
- **§12 sound seam retired**: sound is implemented, procedurally via WebAudio, with no new dependencies (the §1 allowlist is intact).
- **§14 debug menu** gains a time slider (Min/Hrs/Days, dynamic maxes 60/24/30) and its skip now routes through the catch-up path so it honestly simulates a real absence.
- Cooldowns now clamp negative elapsed time exactly as §4.5 requires for decay.


**v1.1 (2026-07-29)** — coherence pass. All numeric choices below are `[DEFAULT — review]`-grade and tunable in content; the structural decisions are the point.

- **RNG reproducibility** (§2, §8): dropped the unimplemented "event log" claim. RNG stream cursors now serialize inside `GameState`, so a save file deterministically produces all future rolls and reload never re-rolls.
- **Dialogue** (§3, §5): re-keyed to `personality × context` — 4 moods + Sulking + Refusal = 6 contexts, 240-line minimum stated explicitly.
- **Modifier stacking** (§4.1): base × personality × life-stage × situational, multiplicative.
- **Mood precedence** (§4.3): Miserable → Grumpy → Beaming → Content, first match wins.
- **Sulking** (§4.4, §4.7): enter on any need = 0 from Idle/Resting/AssignedJob; exit when all needs ≥ 25 (inclusive — resolves the §4.7 vs Phase-1-gate off-by-one). A need hitting 0 mid-expedition defers Sulking until return; the expedition and its loot are unaffected.
- **Offline catch-up** (§4.5, §6.2): specified as one chronological, segment-by-segment pass. Rates (need decay, Rest regen, Gathering production) accrue only during the *first* 12 hours of absence; discrete timers (expeditions, eggs) are never capped. "Rates are capped, timers are not."
- **Play refusal** (§4.2, §5): unified the two conflicting rules — everyone refuses below 10 Energy; Lazy also refuses below 30 Energy plus a 15% flavor refusal. Refusals are free and cooldown-less.
- **Clean** (§5): confirmed as an intentionally trivial check-in ritual, not an oversight.
- **Economy** (new §6.3): resources are the currency, no shop in MVP, acquisition via expeditions + Gathering only, Keep costs as resource bundles, new saves seeded with 3 Berries so the onboarding Feed always works.
- **Evolution** (§4.6): made computable — lifetime time-weighted Happiness average (`happinessIntegral / ageMs`) ≥ 70 at age ≥ 72h sets a ready-to-evolve flag; player taps to witness; `lastGiftItemId` picks the variant.
- **Wording** (§1, §6.2): bundle budget disambiguated (app ≤ 350 KB / total ≤ 550 KB gzipped); "Idle-at-station" aligned to the `AssignedJob` state.
