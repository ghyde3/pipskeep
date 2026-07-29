# PipsKeep

A browser-based virtual pet game about very small creatures with very large opinions. You keep **Pips**: feed them, clean up after them, send them on expeditions they will absolutely take credit for, hatch eggs, and slowly turn a patch of meadow into a thriving **Keep**. Pips never die — the worst that happens is a spectacular sulk.

Built with TypeScript, PixiJS (world) + plain DOM (interface), Vite, and Vitest. No frameworks, no backend, no network calls — the whole game runs in your browser and keeps its save in IndexedDB.

## Quick start

```bash
npm install
npm run dev     # dev server on http://localhost:5317 (fixed port)
```

Other commands:

```bash
npm test        # Vitest — the full logic suite
npm run build   # type-check + production build into dist/
npm run preview # serve the production build locally
```

The dev port is **5317** and `strictPort` is on; if something else is squatting on it, evict that first rather than letting Vite wander.

## Install it like an app

PipsKeep is a PWA: the production build ships a web app manifest and a service worker (via `vite-plugin-pwa`) that precaches every built asset, cache-first. After the first visit the game is fully playable offline — there are no runtime network requests at all — and your browser will offer to install it to the home screen or dock (portrait, standalone, with a very round mascot icon). Updates are `autoUpdate`: a new deploy downloads in the background and applies on the next launch.

## Architecture

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
  content/     # ALL game data as typed config. No logic.
  render/      # Pixi scenes, sprites, animations. Reads state, never mutates it.
  ui/          # DOM interface. Dispatches actions, never mutates state directly.
  app/         # Bootstrapping, game loop, service worker registration
```

Four rules hold this together:

**Time is injected.** Nothing in `core/` ever calls `Date.now()` — a single `Clock` interface (`now(): number`) is passed in from the app layer, and timestamps enter the reducer only as action payload data. Production uses one shared `OffsetClock` (which the debug menu can skew for QA); tests use a `FakeClock` they advance by hand. That one seam is why a real-time pet game has a fast, deterministic test suite: "leave a Pip alone for six hours" is a unit test, not an overnight vigil.

**Randomness is seeded, and the cursors live in the save.** All randomness flows through one seeded PRNG (`core/rng.ts`) split into named streams (`"expedition-loot"`, `"egg"`, `"genesis"`, …). Every stream's cursor position is part of `GameState` and is serialized with it — so a given save file always produces the same future rolls, and reloading never re-rolls or skips an outcome. Debugging workflow included: export a save from the debug menu, load it anywhere, get identical results.

**State flows one way.** The whole game is a single plain-object `GameState` in a tiny custom store. UI and render dispatch actions; the pure root reducer (`core/state.ts`) produces new state; UI and render react to it. There are no back doors — the render layer literally cannot mutate the game, and every consequence of a tap is a testable pure function.

**Content is data.** Species, foods, expeditions, personalities, all 240+ dialogue lines, decorations, jobs, Keep upgrades, and every tunable number live in `content/` as typed config objects (`content/tuning.ts` collects the balancing knobs in one place). `core/` treats content ids as opaque strings, and a validation pass (`content/validate.ts`) runs at every dev boot and loudly `console.error`s broken references — empty loot tables, evolution targets that don't exist, dialogue pools under the 8-line minimum, and so on.

## Adding content without touching `core/` (the proof)

The spec's acceptance test for "content is data" is that a new species, food, or expedition is a `content/`-only edit. Here is each one, step by step, with the real file names. None of them touch `core/`, `render/`, or `ui/`.

### Add a food: the Sunbutter Bun

1. **`src/content/foods.ts`** — add `"sunbutter-bun"` to `FOOD_IDS`, then add its entry to the `foods` record:

   ```ts
   "sunbutter-bun": {
     id: "sunbutter-bun",
     name: "Sunbutter Bun",
     hungerRestore: 30,
     sideEffects: { happiness: 5 }, // warm bread fixes most moods
     cost: {},
   },
   ```

   (The existing foods pull their numbers from `content/tuning.ts` so balancing stays a single-file pass — add a `tuning.foods` entry and reference it if you want the same courtesy.)

2. **Optional, to make it obtainable:** add `{ itemId: "sunbutter-bun", weight: 10 }` to a loot table in `src/content/expeditions.ts`, or to a job's production table in `src/content/jobs.ts`.

That's it. Feeding, inventory, the Items sheet, loot reveals, and catch-up all handle it by id. The dev-boot validator will shout if you typo the id anywhere.

### Add a species: the Puddlepip

1. **`src/content/species.ts`** — add the registry entry:

   ```ts
   puddlepip: {
     id: "puddlepip",
     name: "Puddlepip",
     rarity: "uncommon",
     sprite: {
       palettes: ["dew", "pond", "raincloud"],
       patterns: ["plain", "speckled", "swirl"],
       accessorySlots: 1,
     },
     // no `evolution` block = this species doesn't evolve (yet)
   },
   ```

2. **`src/content/palette.ts`** — give those palette ids real colors: add a `puddlepip` entry to `speciesPalettes` with one vibrant `accent` and a variant (body/belly/pattern/outline/blush) per palette id. Skip this and the game still runs — unknown species render in a polite lavender "wildcard" look rather than crashing — but Puddlepips deserve better.

From then on, eggs can hatch Puddlepips: genome rolling weights species by registry `rarity` automatically. To make it an evolution target instead (or as well), point another species' `evolution.targetSpeciesId` at `"puddlepip"`. The placeholder sprite system composes body, belly, pattern, eyes, and accent from those tokens — no new art files, no `render/` changes.

### Add an expedition: the Old Orchard

1. **`src/content/expeditions.ts`** — add `"orchard"` to `EXPEDITION_IDS`, then the entry:

   ```ts
   orchard: {
     id: "orchard",
     name: "Old Orchard",
     unlockKeepLevel: 2,
     durationMs: 45 * MINUTE_MS,
     lootTable: [
       { itemId: "berry", weight: 50 },
       { itemId: "wood", weight: 35 },
       { itemId: "stew", weight: 15 },
     ],
     lootRolls: 3,
     eggChance: 0.12,
     flavor: "Crooked trees, forgotten ladders, and windfall fruit with no witnesses.",
   },
   ```

   (The existing three keep their numbers in `tuning.expeditions`; follow suit or inline them — both are content.)

2. There is no step 2. The Explore sheet lists the registry, the unlock level gates it, refusal dialogue works, loot rolls draw from the seeded expedition stream, and offline catch-up settles returns in chronological order — all by id.

`unlockKeepLevel` must be a level defined in `src/content/keep.ts`, loot `itemId`s must be real foods or resources, and weights must be positive — the boot validator checks all of it.

## Dev tools

### Debug menu (dev builds only)

Run `npm run dev` and tap the wrench button (or press <kbd>`</kbd>). It can:

- **skip time** (+1h / +6h / +24h) by skewing the one shared app clock — decay, expeditions, eggs, and jobs all move together;
- **grant** berries, stew, and a pile of each resource;
- **spawn an egg** that is instantly ready to hatch;
- **export / import saves** as JSON (the reproducibility workflow — a save file replays identically);
- **corrupt the save** on purpose, to exercise the recovery flow.

The module is only reachable through a dev-guarded dynamic import; production builds tree-shake it away entirely.

### Perf harness: `?perf` (dev builds only)

Open **http://localhost:5317/?perf** to boot the measurement scenario instead of the real game: a synthetic Keep with **5 wandering Pips + 30 placed decorations** — exactly the spec's performance-budget scene — rendered through the real sprite resolvers and animation systems. An overlay shows avg fps, p95 and worst frame time (from a raw `requestAnimationFrame` delta ring buffer), and a cumulative count of frames over the 50 ms spike budget.

It is local-only by construction: no store, no IndexedDB, no autosave — your real save is untouched. For the mid-range-phone profile, run it under Chrome DevTools with 4× CPU throttling.

## Performance budgets

From the spec, verified against the production build (measurements from 2026-07-29, dev MacBook; re-measure with `npm run build` + `?perf`):

| Budget | Measured | Status |
| --- | --- | --- |
| App JS ≤ 350 KB gz (excluding Pixi) | ~55 KB gz | comfortably under |
| Total initial JS ≤ 550 KB gz (incl. Pixi) | ~200 KB gz (Pixi chunk ~145 KB gz) | comfortably under |
| 60 fps with 5 Pips + 30 decorations | 60.0 fps avg, p95 ≈ 16.8 ms (`?perf`, unthrottled) | pass; re-check with 4× throttle |
| No frame spikes > 50 ms | 0 spikes in the `?perf` scenario | pass |
| TTI ≤ 3 s Fast 3G / ≤ 1 s warm | ~208 KB gz critical path ≈ 1.5–2 s modeled at Fast 3G; warm (SW cache) load event ≈ 0.4 s local | pass |

The build splits Pixi into its own chunk (`assets/pixi-*.js`) precisely so the first budget stays measurable at a glance.

## Tests

`npm test` runs the whole logic suite — needs decay, care actions, the state machine, offline catch-up segmentation, expeditions, eggs and inheritance, the Keep and jobs, save migrations across every schema version, RNG determinism, and the perf harness's own pure pieces. Rendering is deliberately not unit-tested; logic is. If you add logic, add tests; if you add content, the boot validator is your first reviewer.
