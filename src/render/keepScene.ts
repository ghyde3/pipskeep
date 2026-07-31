/**
 * Keep scene — the Phase 5 grid diorama (spec §9): the whole roster
 * alive in one fake-iso tile world.
 *
 * Layout: the Keep grid (core/keep `gridBounds`, 8×8 at level 1, +4 rows
 * of Forest plot at level 2) renders as plain axis-aligned tiles squashed
 * vertically — depth is faked purely by y-sorting the `world` layer
 * (render/gridLayout.ts owns all the pure math; no isometric math, spec
 * §9). The tile checker is visible ONLY in placement mode; in normal
 * play the ground reads as one soft meadow.
 *
 * Inhabitants (spec §9 "alive is the goal"):
 * - EVERY roster pip renders and wanders: random walk between free tiles
 *   (deterministic picks from the render-local jitter stream), a waddly
 *   amble (Piplings take shorter, quicker strides), pauses, mood-informed
 *   idling (spec §4.3: mood selects the idle animation set — Beaming pips
 *   hop, Miserable pips droop).
 * - Gravitation: Resting pips beeline to a placed Bed and nap on it;
 *   hungry pips (< 40) loiter near the Food Bowl; AssignedJob pips stand
 *   at their station doing a rummage loop with produced-item pops;
 *   Sulking pips slump in a corner. OnExpedition pips are simply absent.
 * - readyToEvolve pips carry a pulsing glow + sparkles; the player's tap
 *   goes out through the render/pipTap seam. When the reducer parks an ok
 *   `lastEvolveOutcome`, the scene plays the witnessed ceremony (spec
 *   §4.6): gather-light → white flash → silhouette swap to the evolved
 *   species → confetti + fanfare slot → happy wiggle, all under 4s.
 * - The active pip carries a subtle ground ring so selection still reads
 *   in a crowd.
 *
 * Placeables render through render/placeableSprites.ts (the single
 * itemId → sprite mapping, spec §11 resolver conventions); placement
 * mode (`enterPlacementMode`/`exitPlacementMode` — the UI's render hook)
 * shows a grid-snapped ghost with green/red validity tinting backed by
 * core/keep's own pure `placeItem`/`moveItem`, and confirmed drops land
 * with a squash + dust poof.
 *
 * Reads state, never mutates it (spec §2 rule 4). Randomness: render-only
 * juice draws from a core/rng stream with a fixed local seed — cursor
 * deliberately not in GameState (no gameplay outcome reads it). Time
 * never enters: everything advances on `update(dtMs)` frame time.
 *
 * Egg layer (spec §7.2) carries over from Phase 4, re-homed onto grid
 * tiles and depth-sorted with everything else; the hatch moment now
 * spawns the newborn's real wandering actor at the shell's tile.
 */

import { Container, Graphics, Rectangle, Text } from "pixi.js";
import type { GameState, EvolveOutcome } from "../core/state";
import type { CareOutcome } from "../core/pips/care";
import { LifeStage, PipActivity } from "../core/pips/types";
import type { PipState } from "../core/pips/types";
import { createRng, fnv1a } from "../core/rng";
import { EggState } from "../core/eggs";
import type { Egg, HatchOutcome } from "../core/eggs";
import { deriveDisplayedMood, deriveMood } from "../core/pips/mood";
import type { Mood } from "../core/pips/mood";
import { pickLineFromPools } from "../core/pips/dialogue";
import { dialogue as dialoguePools } from "../content/dialogue";
import { gridBounds, moveItem, placeItem } from "../core/keep";
import { placeables as contentPlaceables } from "../content/placeables";
import { decorations as contentDecorations } from "../content/decorations";
import {
  itemColors,
  itemFallbackColor,
  keepPalette,
  resolvePipPalette,
} from "../content/palette";
import { sound } from "../app/sound";
import { emitEggTap } from "./eggTap";
import { emitCraftTableTap } from "./craftTap";
import { jobs as contentJobs } from "../content/jobs";
import { emitPipTap } from "./pipTap";
import {
  resolvePipSprite,
  PIPLING_SCALE,
  PIP_BODY_HEIGHT,
  PIP_BODY_WIDTH,
} from "./spriteResolver";
import type { PipSprite } from "./spriteResolver";
import {
  TweenRunner,
  easeIn,
  easeInOut,
  easeOut,
  easeOutBack,
  linear,
  squashStretch,
} from "./tween";
import type { TweenHandle } from "./tween";
import { ParticleSystem } from "./particles";
import {
  collectBlockedTiles,
  computeGridLayout,
  cornerTiles,
  footprintAnchor,
  nearestFreeTile,
  pickFreeTile,
  snapFootprint,
  tileCenter,
  worldToTile,
} from "./gridLayout";
import type { BlockingItemView, FootprintView, GridLayout } from "./gridLayout";
import { isFlatItem, resolvePlaceableSprite } from "./placeableSprites";
import type { PlaceableSprite } from "./placeableSprites";
// ROUND 2K — THE LIVING KEEP (docs/liveliness-bible.md §4).
//
// ⚠️ THE PURITY CONTRACT IS INTACT AND THIS IMPORT IS THE PROOF SHAPE:
// `app/daylight` and `app/weather` are PURE FUNCTIONS OF A NUMBER. The
// scene never calls them — `app/main.ts` samples them from the ONE
// injected `OffsetClock` and pushes the result in through `setDaylight`/
// `setWeather`. That is what makes the debug time slider move the sky
// (bible §4.2's acceptance criterion), and it is why this file imports
// only the TYPES plus `mixHex`'s colour maths. Same render→app direction
// `sound` already established above.
import { daylightChangedEnough, mixHex } from "../app/daylight";
import type { DaylightSample } from "../app/daylight";
import { invitesPlay, leavesFootprints, seeksShelter } from "../app/weather";
import type { WeatherSample } from "../app/weather";
import { createAmbience } from "./ambience";
import type { AmbienceLayer } from "./ambience";
import { emitVisitorTap } from "./visitorTap";
import { attractionBiomeIdFor, visitorIsPresent } from "../core/attractions";
import type { VisitorRecord } from "../core/attractions";
import { createPipFromGenome } from "../core/pips/genome";
import { tuning as contentTuning } from "../content/tuning";

export interface KeepScene {
  readonly view: Container;
  /** Re-render from new state (roster, placements, eggs, outcomes). */
  sync(state: GameState): void;
  /** Per-frame advance: wandering, tweens, particles, idle juice. */
  update(dtMs: number): void;
  /** Animate a care outcome (< 1.5s, spec §5) on the outcome's pip.
   * `consumedItemId` lets Feed color the morsel by what was eaten. */
  playCareOutcome(outcome: CareOutcome, consumedItemId?: string): void;
  resize(width: number, height: number): void;
  /** Screen-space (CSS px) anchor just above the ACTIVE pip's head — the
   * UI hangs the speech bubble here. */
  getBubbleAnchor(): { x: number; y: number };
  /**
   * UI render hook (spec §9 tap-to-place): show the tile checker and a
   * grid-snapped ghost of `itemId` with green/red validity tinting
   * (validated by core/keep's own pure placeItem/moveItem against the
   * latest synced state). A tap on a VALID spot calls `onPlaced(x, y)`
   * with the snapped top-left tile — the UI dispatches PLACE_ITEM (or
   * MOVE_ITEM when `opts.movePlacementId` is set) and decides when to
   * exit. The scene never dispatches.
   */
  enterPlacementMode(
    itemId: string,
    onPlaced: (x: number, y: number) => void,
    opts?: { movePlacementId?: string },
  ): void;
  /** Hide the checker + ghost (idempotent). */
  exitPlacementMode(): void;
  /**
   * One-off cosmetic conga across the foreground: every present roster
   * pip marches (adults leading, Piplings trailing), confetti pops, a
   * kazoo slot fires, and everyone ambles back to whatever they were
   * doing. PURE COSMETICS by contract: no dispatch, no state writes, no
   * state reads beyond the roster the scene already renders. Queues
   * politely — never starts while a care animation or the evolution
   * ceremony is mid-flight. Idempotent while one is queued or marching.
   */
  playParade(): void;
  /**
   * ROUND 2K (docs/liveliness-bible.md §4.2) — push the current sky.
   *
   * Called by `app/main.ts` at `tuning.liveliness.daylight.sampleMs`
   * (1 Hz) with `daylightAt(appClock.now(), state.dayOffsetMs)`. The
   * scene NEVER asks what time it is; it is told. That is the whole
   * reason the debug time slider turns the Keep to night — and the
   * reason `core/` purity is untouched by a feature whose entire subject
   * is the time of day.
   *
   * Cheap to call every second: the full-screen tint and the actors'
   * shadow skew update every time, and `drawBackground` (a teardown and
   * rebuild) fires only when `daylightChangedEnough` says the sky has
   * actually moved — ~94 times a day, measured.
   */
  setDaylight(sample: DaylightSample): void;
  /**
   * ROUND 2K (docs/liveliness-bible.md §4.3) — push the current weather.
   *
   * ⚠️ MOOD ONLY (invariant I4). This changes particles, the sky's
   * saturation, and where an idle Pip chooses to stand. It changes NO
   * need, NO decay rate, NO loot table, NO risk, and no Pip's
   * eligibility for anything. `app/weather.test.ts` greps `core/` to
   * keep that true.
   */
  setWeather(sample: WeatherSample): void;
}

/** Pip-voiced refusals get the shake + line; structural blocks (cooldown,
 * empty pantry) are the UI's problem (spec §5: no line, no drama). */
const VOICED_REFUSALS: ReadonlySet<string> = new Set([
  "tooTired",
  "lazyTooTired",
  "lazyWhim",
  "machine",
]);

/** Item footprints + walkability for grid math, from the same content
 * registries core/keep merges (flat decals never block wandering). */
const BLOCKING_ITEMS: Readonly<Record<string, BlockingItemView>> = (() => {
  const items: Record<string, BlockingItemView> = {};
  for (const def of [...contentPlaceables, ...contentDecorations]) {
    items[def.id] = { footprint: def.footprint, blocks: !isFlatItem(def.id) };
  }
  return items;
})();

function footprintOf(itemId: string): FootprintView {
  return BLOCKING_ITEMS[itemId]?.footprint ?? { w: 1, h: 1 };
}

/** Deterministic grid slots for eggs (all within the 8×8 core plot). */
const EGG_TILE_SLOTS: readonly { x: number; y: number }[] = [
  { x: 2, y: 4 },
  { x: 5, y: 3 },
  { x: 1, y: 2 },
  { x: 6, y: 5 },
  { x: 3, y: 6 },
  { x: 4, y: 1 },
];

/** Mood → idle animation set (spec §4.3: mood selects the idle set).
 * Each mood must READ differently at a glance: Beaming bounces, Content
 * sways, Grumpy is stiff (short, brisk, narrowed eyes, arms-crossed
 * energy), Miserable is a full-body droop — barely bobbing, half-lidded,
 * with a standing slump (`slumpRad`) and its own heavy-sigh flourish in
 * updateActor. Grumpy stays upright and irritated; Miserable wilts. */
const MOOD_IDLE: Readonly<
  Record<Mood, { bobAmp: number; bobSpeed: number; eyes: number; slumpRad: number }>
> = {
  beaming: { bobAmp: 3.4, bobSpeed: 4.1, eyes: 1, slumpRad: 0 },
  content: { bobAmp: 2.6, bobSpeed: 3.4, eyes: 1, slumpRad: 0 },
  grumpy: { bobAmp: 1.2, bobSpeed: 2.8, eyes: 0.8, slumpRad: 0 },
  miserable: { bobAmp: 0.45, bobSpeed: 1.3, eyes: 0.45, slumpRad: 0.055 },
};

const DUST_COLORS = ["#e8dcc0", "#d6c9a8", "#ffffff"] as const;

/**
 * Design height of the bottom DOM chrome (Keep strip + action bar) — the
 * fallback used before `.pk-keepstrip` exists in the document, and in any
 * non-browser context.
 */
const BOTTOM_CHROME_FALLBACK_PX = 157;

/**
 * Resolve one Pip's Keep sprite. Module-level and EXPORTED (round 2D fix
 * stage) rather than a closure inside `createKeepScene`, because it is
 * the ONLY production call site of `resolvePipSprite` and both of round
 * 2D's render wirings live in these five lines — with no
 * `keepScene.test.ts` at all, dropping `accessoryId` here (every Pip in
 * the Keep renders bare) or seeding the jitter with `Date.now()` (every
 * Pip looks different on every reload) were both silent, green changes.
 * `keepScene.test.ts` now pins both.
 *
 * Resolve with the LIVE species (evolution changes it, spec §4.6); genome
 * stays the immutable birth record for palette/pattern — UNLESS the Pip
 * has evolved with a gift-selected variant (`pip.evolved.variantId`,
 * content-bible §8.2.2), in which case that variant id stands in for the
 * palette lookup key (spriteResolver.ts's optional third param). Without
 * this, every evolution gift variant authored in content/palette.ts is
 * dead: `applyEvolution` writes `variantId` and nothing ever read it back.
 */
export function resolveActorSprite(pip: PipState): PipSprite {
  return resolvePipSprite(
    { ...pip.genome, speciesId: pip.speciesId },
    pip.lifeStage,
    pip.evolved?.variantId,
    // ROUND 2D item 4 — jitter seed: the Pip's own id VERBATIM, unique
    // per Pip (unlike the genome, which two Pips could roll identically)
    // and STABLE across reloads, so every actor in the Keep looks
    // individually jittered and looks the SAME individual every session
    // (spriteResolver.ts's `jitterSeed` doc).
    pip.id,
  );
}

/** The sprite cache key: every input `resolveActorSprite` reads. */
export function actorSpriteKey(pip: PipState): string {
  // `variantId` joins the key (content-bible §8.2.2): two Pips of the
  // same evolved species that were fed different gift items must NOT
  // share a cached sprite just because species/palette/pattern match.
  // `accessoryId` joins it for the same reason (round 2D fix stage): it
  // was safe only by accident, because `pip.id` happens to lead the key.
  return [
    pip.id,
    pip.lifeStage,
    pip.speciesId,
    pip.genome.palette,
    pip.genome.pattern,
    pip.genome.accessoryId ?? "",
    pip.evolved?.variantId ?? "",
  ].join("|");
}

/**
 * How much of the bottom of the view the DOM chrome covers, measured off the
 * Keep strip's own top edge.
 *
 * WHY MEASURE RATHER THAN ASSUME. `computeGridLayout`'s band ran to
 * `0.97 × viewH` — 787.6px on a 375×812 phone, i.e. 133px underneath chrome
 * that starts at 655. At Keep level 4 that put 35px of the drawn plot, and
 * the standing Pip's entire contact shadow, permanently behind the Keep
 * strip: the Pip read as sunk into the XP bar. Level 1's 8×8 grid escaped by
 * arithmetic luck (2.4px lost), so the bug grew with the Keep — the opposite
 * of what a reward should do.
 *
 * Measuring the real element is what keeps this correct as the strip's own
 * height changes (its second row is text and can re-wrap). The strip's
 * `bottom` offset also tracks `--pk-actionbar-h`, so the reason pill's extra
 * 40px is included whenever it is showing at relayout time; a pill that
 * appears BETWEEN relayouts is not re-fitted until the next resize or tier
 * change, which is a transient the plot survives (the Pip that pill is about
 * is, by definition, not standing on the plot).
 */
function measureBottomChrome(viewH: number): number {
  if (typeof document === "undefined") return BOTTOM_CHROME_FALLBACK_PX;
  const strip = document.querySelector(".pk-keepstrip");
  if (strip === null) return BOTTOM_CHROME_FALLBACK_PX;
  const top = strip.getBoundingClientRect().top;
  // A detached / not-yet-laid-out strip reports 0 — that is "unknown", not
  // "the chrome fills the screen", so fall back rather than starving the plot.
  if (!Number.isFinite(top) || top <= 0) return BOTTOM_CHROME_FALLBACK_PX;
  return Math.max(0, Math.min(viewH * 0.4, viewH - top));
}

export function createKeepScene(width: number, height: number): KeepScene {
  // Render-local deterministic jitter (see module doc).
  const jitter = createRng(0x6a756963).stream("keep-juice");

  const view = new Container();
  const background = new Container();
  /** Tile checker — visible only in placement mode. */
  const gridOverlay = new Container();
  /** Depth-sorted inhabitants: placeables, eggs, pips. */
  const world = new Container();
  world.sortableChildren = true;
  const ghostLayer = new Container();
  /**
   * ROUND 2K (docs/liveliness-bible.md §4.2) — THE DAYLIGHT OVERLAY.
   *
   * ONE full-screen Graphics whose tint and alpha ride the ramp. It sits
   * ABOVE `world` deliberately: tinting above the scene multiplies the
   * ground and the Pips TOGETHER, so contrast RATIOS survive — which is
   * what `content/palette.test.ts` actually pins (body-vs-ground ≥ 1.95 /
   * 1.76). Recolouring the ground instead would have darkened the
   * backdrop while leaving the Pips bright, which is the pale-on-pale
   * failure that has bitten this project twice.
   *
   * It sits BELOW `fxAbove` and the ambience layer on purpose too: at
   * night the fireflies and the care-moment hearts should GLOW over the
   * dark, not be dimmed into it.
   *
   * Never interactive — every tap must fall through to the world.
   */
  const daylightOverlay = new Graphics();
  daylightOverlay.alpha = 0;
  daylightOverlay.eventMode = "none";
  const fxAbove = new ParticleSystem(jitter);
  /** Evolution white-out. */
  const flashG = new Graphics();
  flashG.alpha = 0;
  const ambience: AmbienceLayer = createAmbience({
    width,
    height,
    groundTop: Math.max(40, height * 0.3),
  });
  view.addChild(
    background,
    gridOverlay,
    world,
    ghostLayer,
    daylightOverlay,
    ambience.view,
    fxAbove.view,
    flashG,
  );

  /** Scene-wide tweens (flash, ceremony timeline, placeable drops) —
   * never cleared by actor sprite rebuilds. */
  const sceneRunner = new TweenRunner();
  /** Egg tweens — separate runner, mirroring Phase 4's isolation. */
  const eggRunner = new TweenRunner();

  let w = width;
  let h = height;
  let lastState: GameState | null = null;
  /** Height of the DOM chrome pinned to the bottom of the screen (Keep strip
   * + action bar), measured — see `measureBottomChrome`. */
  let bottomInset = measureBottomChrome(h);
  let layout: GridLayout = computeGridLayout(w, h, 8, 8, {
    bottomInsetPx: bottomInset,
  });
  let blockedTiles: ReadonlySet<string> = new Set();
  /** Depth tiebreak counter (stable y-sorting via creation order). */
  let seqCounter = 0;

  /**
   * ROUND 2K — the current sky and weather, as pushed in by main.ts.
   *
   * Both start at their no-op values so a scene that is NEVER told (every
   * existing test, and the first frame before the first sample lands)
   * renders EXACTLY what shipped before this round: `day` is
   * byte-identical to `keepPalette` and `clear` costs nothing. This
   * round cannot make the default look worse, and the default is what an
   * un-wired scene draws.
   */
  let daylight: DaylightSample | null = null;
  let weather: WeatherSample | null = null;
  /** The sample `drawBackground` last painted — the redraw-threshold
   * comparison lives in `app/daylight.daylightChangedEnough`, and this is
   * the "a" it compares against. */
  let paintedDaylight: DaylightSample | null = null;

  const pipScale = (): number =>
    Math.min(0.92, Math.max(0.34, (layout.tileW * 1.35) / PIP_BODY_WIDTH));
  const eggScale = (): number =>
    Math.min(1.1, Math.max(0.6, layout.tileW / 60));

  /** Shorthand — round 2K reads this slice on nearly every frame. */
  const tuningAmbience = contentTuning.liveliness.ambience;

  function dustPoof(x: number, y: number, scale = 1): void {
    fxAbove.burst({
      x,
      y,
      count: 8,
      shape: "dot",
      colors: [...DUST_COLORS],
      speed: 70 * scale,
      directionRad: -Math.PI / 2,
      spreadRad: Math.PI * 1.6,
      gravity: 150,
      lifeMs: 480,
      sizeMin: 2,
      sizeMax: 3.8,
    });
  }

  // -------------------------------------------------------------------------
  // Background + grid overlay
  // -------------------------------------------------------------------------

  function drawBackground(): void {
    background.removeChildren().forEach((c) => c.destroy());
    const level = lastState?.keep.level ?? 1;
    const gridTop = layout.originY;
    const gridBottom = layout.originY + layout.rows * layout.tileH;
    const gridLeft = layout.originX;
    const gridW = layout.cols * layout.tileW;

    const g = new Graphics();
    // ROUND 2K (bible §4.2) — the three shipped sky bands and the sun
    // glow now read off the daylight ramp. With no sample pushed in
    // (`sky` falls back to the literals below) this is byte-identical to
    // what shipped before the round, and `daylightAt`'s `day` anchor IS
    // `keepPalette`, so it stays byte-identical at midday too.
    const sky = daylight;
    const desat = weather?.desaturate ?? 0;
    // Overcast pulls the sky toward its own grey rather than toward
    // white — a desaturated pastel, not a washed-out one.
    const dull = (hex: string): string => (desat > 0 ? mixHex(hex, "#c3cbd0", desat * 3) : hex);
    g.rect(0, 0, w, gridTop * 0.55).fill(dull(sky?.skyTop ?? keepPalette.skyTop));
    g.rect(0, gridTop * 0.55, w, gridTop * 0.3).fill(dull(sky?.skyMid ?? "#dff0ef"));
    g.rect(0, gridTop * 0.85, w, h - gridTop * 0.85).fill(
      dull(sky?.skyBottom ?? keepPalette.skyBottom),
    );
    // Sun glow — becomes the moon on the night anchor: a smaller, cooler
    // disc with a soft ring around it.
    const discX = w * (sky?.sunX ?? 0.78);
    const discY = gridTop * ((sky?.sunY ?? 0.34) / 0.34) * 0.34;
    const discR = Math.min(w, h) * 0.12 * (sky?.sunScale ?? 1);
    const discAlpha = 0.7 * (weather?.sunGlowScale ?? 1);
    if (sky?.isMoon === true) {
      g.circle(discX, discY, discR * 1.9).fill({
        color: sky.sunColor,
        alpha: discAlpha * 0.16,
      });
      g.circle(discX, discY, discR).fill({ color: sky.sunColor, alpha: discAlpha });
      // A crescent bite, so the moon reads as a moon and not a pale sun.
      g.circle(discX + discR * 0.42, discY - discR * 0.3, discR * 0.86).fill({
        color: dull(sky.skyTop),
        alpha: 0.92,
      });
    } else {
      g.circle(discX, discY, discR).fill({
        color: sky?.sunColor ?? keepPalette.sunGlow,
        alpha: discAlpha,
      });
    }
    // Far hills hugging the horizon.
    g.ellipse(w * 0.2, gridTop * 0.98, w * 0.45, gridTop * 0.22).fill(
      keepPalette.hillFar,
    );
    g.ellipse(w * 0.85, gridTop * 1.02, w * 0.5, gridTop * 0.24).fill(
      keepPalette.hillNear,
    );
    // Meadow slab from just above the grid to the bottom of the screen.
    g.rect(0, gridTop - layout.tileH * 0.8, w, h - gridTop + layout.tileH).fill(
      keepPalette.ground,
    );
    g.ellipse(w / 2, gridTop - layout.tileH * 0.8, w * 0.62, layout.tileH * 1.1).fill(
      keepPalette.ground,
    );
    background.addChild(g);

    // The Keep plot itself: a slightly deeper green bed with a soft rim
    // (invisible tiles — the checker only appears in placement mode).
    const plot = new Graphics();
    const pad = layout.tileW * 0.16;
    plot
      .roundRect(
        gridLeft - pad,
        gridTop - pad,
        gridW + pad * 2,
        gridBottom - gridTop + pad * 2,
        layout.tileW * 0.3,
      )
      .fill(keepPalette.groundNear)
      .stroke({ width: 2, color: 0x5f8a5e, alpha: 0.18 });

    // Level 2 Forest plot (spec §9): the +4 rows render as a deeper band.
    const baseRows = 8;
    if (level >= 2 && layout.rows > baseRows) {
      const plotTop = layout.originY + baseRows * layout.tileH;
      plot
        .roundRect(
          gridLeft - pad,
          plotTop,
          gridW + pad * 2,
          gridBottom - plotTop + pad,
          layout.tileW * 0.3,
        )
        .fill({ color: "#8fc487", alpha: 0.55 });
      // A few forest bushes along the seam + edges.
      for (let i = 0; i < 5; i++) {
        const bx = gridLeft + gridW * (0.08 + i * 0.21) + (jitter.next() - 0.5) * 14;
        const by = plotTop + (i % 2 === 0 ? 2 : layout.tileH * 0.3);
        plot.ellipse(bx, by, layout.tileW * 0.26, layout.tileH * 0.3).fill("#6b9d58");
        plot
          .ellipse(bx - layout.tileW * 0.12, by - layout.tileH * 0.16, layout.tileW * 0.16, layout.tileH * 0.2)
          .fill("#7fb371");
      }
    }
    background.addChild(plot);

    // Grass tufts + flowers scattered OUTSIDE the plot.
    const detail = new Graphics();
    for (let i = 0; i < 14; i++) {
      const tx = jitter.next() * w;
      const ty = gridTop - layout.tileH * 0.5 + jitter.next() * (h - gridTop);
      const insidePlot =
        tx > gridLeft - pad && tx < gridLeft + gridW + pad && ty > gridTop - pad;
      if (insidePlot) continue;
      for (const blade of [-3, 0, 3]) {
        detail
          .moveTo(tx + blade, ty)
          .quadraticCurveTo(tx + blade * 1.6, ty - 7, tx + blade * 2.2, ty - 12);
      }
      detail.stroke({ width: 2, color: keepPalette.tuft, alpha: 0.8, cap: "round" });
    }
    for (let i = 0; i < 6; i++) {
      const fx = jitter.next() * w;
      const fy = gridTop + jitter.next() * (h - gridTop);
      const insidePlot =
        fx > gridLeft - pad && fx < gridLeft + gridW + pad && fy > gridTop - pad;
      if (insidePlot) continue;
      const petal = jitter.pick(keepPalette.flowerPetals);
      for (let p = 0; p < 5; p++) {
        const a = (p / 5) * Math.PI * 2;
        detail.circle(fx + Math.cos(a) * 4, fy + Math.sin(a) * 4, 2.6);
      }
      detail.fill({ color: petal, alpha: 0.9 });
      detail.circle(fx, fy, 2).fill(keepPalette.flowerCore);
    }
    background.addChild(detail);
  }

  function drawGridOverlay(): void {
    gridOverlay.removeChildren().forEach((c) => c.destroy());
    const g = new Graphics();
    for (let ty = 0; ty < layout.rows; ty++) {
      for (let tx = 0; tx < layout.cols; tx++) {
        const px = layout.originX + tx * layout.tileW;
        const py = layout.originY + ty * layout.tileH;
        g.rect(px, py, layout.tileW, layout.tileH).fill({
          color: (tx + ty) % 2 === 0 ? 0xffffff : 0x2f4f2f,
          alpha: (tx + ty) % 2 === 0 ? 0.1 : 0.05,
        });
      }
    }
    g.rect(
      layout.originX,
      layout.originY,
      layout.cols * layout.tileW,
      layout.rows * layout.tileH,
    ).stroke({ width: 2, color: 0xffffff, alpha: 0.35 });
    gridOverlay.addChild(g);
  }

  // -------------------------------------------------------------------------
  // Placeables
  // -------------------------------------------------------------------------

  interface PlaceableVisual {
    readonly sprite: PlaceableSprite;
    readonly seq: number;
    itemId: string;
    x: number;
    y: number;
    dropTween: TweenHandle | null;
    /**
     * ROUND 2J FIX STAGE — the craft-in-flight ring, created lazily for a
     * crafting station and nothing else. Economy-bible §6.3 assigns "a
     * progress ring on the station in the Keep scene", and §6.5 risk 6
     * names "the Craft Table is never opened" as the failure that
     * evaporates every claim in §5 — with no ambient signal, the bench is
     * a thing you have to remember to go and check.
     */
    craftRing: Graphics | null;
    /**
     * ROUND 2K (docs/liveliness-bible.md §4.2) — the dusk glow, created
     * lazily for a `lantern`/`flame`-motif item and nothing else.
     *
     * ⚠️ THIS IS THE BEST BEAT IN §4.2, and it is worth stating why: the
     * thing that notices the time is a thing the PLAYER BUILT. A sky that
     * changes on its own is scenery; a lantern that wakes up because the
     * sun went down is the Keep responding.
     */
    lanternGlow: Graphics | null;
    /**
     * ROUND 2K (bible §1.4) — the feed-charge ring on an attraction, so
     * an empty one reads IN THE WORLD and not only on a card. Created
     * lazily for attractions and nothing else.
     */
    stockRing: Graphics | null;
  }

  const placeableVisuals = new Map<string, PlaceableVisual>();
  let placeablesInit = false;

  /** Motifs whose items light up after dark (bible §4.2). */
  const LANTERN_MOTIFS: ReadonlySet<string> = new Set(["lantern", "flame"]);

  /** Placed item ids that host a `"crafting"`-kind job — the same registry
   * scan `core/crafting` and `ui/crafting.ts` each do. A second crafting
   * station is content, never a render change. */
  const CRAFTING_STATION_ITEM_IDS: ReadonlySet<string> = new Set(
    Object.values(contentJobs)
      .filter((job) => job.kind === "crafting")
      .map((job) => job.stationItemId),
  );

  /**
   * Draw (or clear) one station's progress ring. A thin amber arc riding
   * just above the bench, filling from 0 to 1 across the craft — legible
   * at a glance from across the Keep, and gone the moment nothing is in
   * flight.
   */
  function syncCraftRing(v: PlaceableVisual, fraction: number | null): void {
    if (fraction === null) {
      if (v.craftRing !== null) {
        v.craftRing.destroy();
        v.craftRing = null;
      }
      return;
    }
    let ring = v.craftRing;
    if (ring === null) {
      ring = new Graphics();
      v.sprite.wrap.addChild(ring);
      v.craftRing = ring;
    }
    const r = layout.tileW * 0.34;
    const cy = -layout.tileH * 1.35;
    const t = Math.max(0, Math.min(1, fraction));
    ring.clear();
    ring
      .circle(0, cy, r)
      .fill({ color: 0x2f2a22, alpha: 0.28 })
      .stroke({ width: Math.max(2, r * 0.16), color: 0xf6ead8, alpha: 0.35 });
    if (t > 0.001) {
      ring
        .arc(0, cy, r, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2)
        .stroke({ width: Math.max(2, r * 0.16), color: 0xf6b73c, alpha: 0.95 });
    }
  }

  /**
   * ROUND 2K (bible §4.2) — fade every lantern-motif item's glow to the
   * current `lanternGlow` (0 by day, 1 deep at night).
   *
   * Called from `setDaylight`, i.e. once a second, and it is one alpha
   * write per lantern (≤ 6 in practice). The glow Graphics itself is
   * built once and reused; a phase flip changes a number, never the
   * scene graph.
   */
  function syncLanternGlow(): void {
    const target = daylight?.lanternGlow ?? 0;
    for (const v of placeableVisuals) {
      const visual = v[1];
      const motif = ITEM_MOTIF[visual.itemId];
      if (motif === undefined || !LANTERN_MOTIFS.has(motif)) continue;
      let glow = visual.lanternGlow;
      if (glow === null) {
        if (target <= 0.001) continue; // never built for a Keep that is always day
        glow = new Graphics();
        const r = layout.tileW * 0.5;
        for (const [fraction, alpha] of [
          [1, 0.1],
          [0.62, 0.16],
          [0.32, 0.26],
        ] as const) {
          glow.circle(0, -layout.tileH * 0.75, r * fraction).fill({
            color: 0xffd88a,
            alpha,
          });
        }
        glow.alpha = 0;
        // Behind the lantern's own art, so it reads as light spilling out
        // rather than as a sticker over the top.
        visual.sprite.wrap.addChildAt(glow, 0);
        visual.lanternGlow = glow;
      }
      glow.alpha = target;
    }
  }

  /**
   * ROUND 2K (bible §1.4, visibility table's "Stock" row) — the feed
   * ring on an attraction.
   *
   * ⚠️ AN EMPTY ATTRACTION MUST READ IN THE WORLD, not only on a card.
   * The alternative — stock that exists only inside the item card — is
   * the same failure mode as a visitor written to state and never drawn:
   * the player would have to go looking for a fact the Keep already knows.
   * Four soft pips around the item's head; the spent ones go hollow.
   *
   * NO BADGE, NO TOAST, NO NOTIFICATION (bible §1.8 item 8: never nag
   * about stock). An empty attraction costs the player nothing — it just
   * stops drawing visitors — so the surface is quiet by design.
   */
  function syncStockRing(v: PlaceableVisual, stock: number | null): void {
    if (stock === null) {
      if (v.stockRing !== null) {
        v.stockRing.destroy();
        v.stockRing = null;
      }
      return;
    }
    let ring = v.stockRing;
    if (ring === null) {
      ring = new Graphics();
      v.sprite.wrap.addChild(ring);
      v.stockRing = ring;
    }
    const max = contentTuning.attractions.stockMax;
    const r = Math.max(2.2, layout.tileW * 0.05);
    const gap = r * 2.9;
    const cy = -layout.tileH * 1.45;
    const x0 = -((max - 1) * gap) / 2;
    ring.clear();
    for (let i = 0; i < max; i++) {
      const filled = i < stock;
      ring.circle(x0 + i * gap, cy, r);
      if (filled) {
        ring.fill({ color: 0xf6d99b, alpha: 0.95 });
      } else {
        ring.fill({ color: 0x3a3a32, alpha: 0.14 });
      }
    }
  }

  function placeableDepth(v: PlaceableVisual, anchorY: number): number {
    // Flat decals live under every standing thing; standing items sort
    // by their footprint's bottom edge (gridLayout.compareDepth rule —
    // Pixi's zIndex sort is stable, seq order breaks ties).
    return v.sprite.flat ? -100000 + v.seq : anchorY;
  }

  function positionPlaceable(v: PlaceableVisual): void {
    const anchor = footprintAnchor(layout, v.x, v.y, footprintOf(v.itemId));
    v.sprite.view.position.set(anchor.x, anchor.y);
    v.sprite.view.zIndex = placeableDepth(v, anchor.y);
  }

  function playDropIn(v: PlaceableVisual): void {
    const wrap = v.sprite.wrap;
    const fall = layout.tileH * 1.2;
    wrap.position.y = -fall;
    sound("place.drop");
    v.dropTween?.cancel();
    v.dropTween = sceneRunner.sequence([
      {
        durationMs: 170,
        ease: easeIn,
        onUpdate: (t) => {
          if (!wrap.destroyed) wrap.position.y = -fall * (1 - t);
        },
        onComplete: () => {
          if (wrap.destroyed) return;
          wrap.position.y = 0;
          squashStretch(sceneRunner, wrap, { amount: 0.18, cycleMs: 200 });
          dustPoof(v.sprite.view.position.x, v.sprite.view.position.y, 1.1);
        },
      },
    ]);
  }

  function playMoveHop(v: PlaceableVisual): void {
    const wrap = v.sprite.wrap;
    v.dropTween?.cancel();
    v.dropTween = sceneRunner.add({
      durationMs: 240,
      ease: linear,
      onUpdate: (t) => {
        if (!wrap.destroyed) {
          wrap.position.y = -Math.sin(t * Math.PI) * layout.tileH * 0.5;
        }
      },
      onComplete: () => {
        if (wrap.destroyed) return;
        wrap.position.y = 0;
        dustPoof(v.sprite.view.position.x, v.sprite.view.position.y, 0.8);
      },
    });
  }

  function syncPlaceables(state: GameState): void {
    const first = !placeablesInit;
    placeablesInit = true;
    const present = new Set<string>();

    for (const [pid, placement] of Object.entries(state.keep.placements)) {
      present.add(pid);
      const existing = placeableVisuals.get(pid);
      if (existing === undefined) {
        const sprite = resolvePlaceableSprite(
          placement.itemId,
          footprintOf(placement.itemId),
          layout.tileW,
          layout.tileH,
        );
        const v: PlaceableVisual = {
          sprite,
          seq: seqCounter++,
          itemId: placement.itemId,
          x: placement.x,
          y: placement.y,
          dropTween: null,
          craftRing: null,
          lanternGlow: null,
          stockRing: null,
        };
        placeableVisuals.set(pid, v);
        world.addChild(sprite.view);
        positionPlaceable(v);
        if (!first) playDropIn(v); // boot-loaded items just exist
        continue;
      }
      if (existing.x !== placement.x || existing.y !== placement.y) {
        existing.x = placement.x;
        existing.y = placement.y;
        positionPlaceable(existing);
        playMoveHop(existing);
      }
    }

    // ROUND 2J FIX STAGE — the craft-in-flight ring, refreshed from state
    // on every sync (TICK dispatches drive this, the same cadence the egg
    // timers already ride).
    const crafts = state.crafts ?? {};
    for (const [pid, v] of placeableVisuals) {
      if (!CRAFTING_STATION_ITEM_IDS.has(v.itemId)) continue;
      const order = crafts[pid];
      if (order === undefined || order.effectiveMs <= 0) {
        syncCraftRing(v, null);
        continue;
      }
      const elapsed = state.lastTickAt - order.startedAt;
      syncCraftRing(v, elapsed / order.effectiveMs);
    }

    // ROUND 2K — the attraction feed ring, refreshed on the same cadence.
    const stock = state.attractionStock ?? {};
    for (const [pid, v] of placeableVisuals) {
      if (!isAttraction(v.itemId)) continue;
      syncStockRing(v, stock[pid] ?? 0);
    }

    for (const [pid, v] of placeableVisuals) {
      if (present.has(pid)) continue;
      placeableVisuals.delete(pid);
      dustPoof(v.sprite.view.position.x, v.sprite.view.position.y - layout.tileH * 0.3);
      v.dropTween?.cancel();
      v.sprite.destroy();
    }

    blockedTiles = collectBlockedTiles(state.keep.placements, BLOCKING_ITEMS);
  }

  /** First placement (by stable key order) whose item matches. */
  function findPlacement(
    state: GameState,
    itemId: string,
  ): readonly { id: string; x: number; y: number }[] {
    const out: { id: string; x: number; y: number }[] = [];
    for (const [pid, p] of Object.entries(state.keep.placements)) {
      if (p.itemId === itemId) out.push({ id: pid, x: p.x, y: p.y });
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Pip actors — the wandering roster (spec §9)
  // -------------------------------------------------------------------------

  type ActorMode = "roam" | "rest" | "work" | "sulk";

  interface Actor {
    pip: PipState;
    sprite: PipSprite;
    spriteKey: string;
    readonly root: Container;
    readonly ring: Graphics;
    readonly glow: Graphics;
    readonly runner: TweenRunner;
    readonly seq: number;
    x: number;
    y: number;
    facing: 1 | -1;
    mode: ActorMode;
    modeKey: string;
    target: { x: number; y: number } | null;
    seatZ: number | null;
    seated: boolean;
    pauseMs: number;
    careHoldMs: number;
    walkPhase: number;
    walkBob: number;
    // Idle juice channels (composited every frame).
    readonly anim: { x: number; y: number; rot: number };
    slumpRot: number;
    eyesForced: number | null;
    eyesCurrent: number;
    blinkInMs: number;
    blinkT: number;
    bobPhase: number;
    wiggleInMs: number;
    zInMs: number;
    rummageInMs: number;
    produceInMs: number;
    mood: Mood;
    moodRefreshMs: number;
    glowPhase: number;
    glowSparkleInMs: number;
    /** Iridescent-variant glint timer (genome.shiny actors only). */
    shinySparkleInMs: number;
    ceremony: boolean;
    suppressRebuild: boolean;
    /** Marching in the conga (position driven by updateParade). */
    parading: boolean;
    helloBubble: Container | null;
    /**
     * ROUND 2K (docs/liveliness-bible.md §1.5) — set on a VISITOR actor,
     * null on every roster Pip. A visitor uses the SAME rig, the same
     * wander, the same idle set and the same jitter as a roster Pip
     * (which is the point — it must read as a real, individual Pip on
     * sight), and differs only in: no selection ring, a lighter contact
     * shadow, a drifting motif, a tap that opens the Visitor card instead
     * of the focus view, and an arrival/exit that walks the screen edge.
     */
    visitor: VisitorActor | null;
    /**
     * ROUND 2K (bible §4.4) — THE HIGHEST DELIGHT-PER-FRAME ITEM IN THE
     * ROUND, and it costs ZERO display objects. > 0 while the actor is
     * mid-interaction with a placed item it walked over to look at;
     * `decorMotif` is the item's `icon.motif`, which picks WHICH
     * interaction plays.
     */
    decorHoldMs: number;
    decorMotif: string | null;
    /** How long this actor has been standing still and unoccupied — the
     * greeting rule's "both idle ≥ 1.5 s" precondition (bible §4.5). */
    idleMs: number;
    /** > 0 while mid-greeting: stops the amble so the two actually face
     * each other instead of drifting apart mid-hello. */
    greetHoldMs: number;
    /** Steps since this actor last dropped a footprint (snow only). */
    footprintCooldownMs: number;
  }

  /** The visitor-specific half of a visitor Actor (bible §1.5). */
  interface VisitorActor {
    readonly placementId: string;
    readonly itemId: string;
    /** Where the attraction stands — what the visitor loiters around. */
    home: { x: number; y: number };
    /** Walking back off the edge at `leavesAt`; destroyed on arrival. */
    leaving: boolean;
    /** Trust as of the last sync — drives the ready-to-welcome glow. */
    trust: number;
    /** Motif drift timer (the "not yours" tell, bible §1.5 item 2). */
    motifInMs: number;
  }

  const actors = new Map<string, Actor>();
  /** Set by the hatch celebration so the newborn's actor spawns at the
   * shell's tile (syncEggs runs before syncActors). */
  let pendingHatchSpawn: { pipId: string; x: number; y: number } | null = null;

  const visualScale = (actor: Actor): number =>
    pipScale() * (actor.pip.lifeStage === LifeStage.Pipling ? PIPLING_SCALE : 1);

  function applyActorScale(actor: Actor): void {
    const s = visualScale(actor);
    actor.sprite.view.scale.set(actor.facing * s, s);
  }

  function drawActorRing(actor: Actor): void {
    const s = visualScale(actor);
    const accent = resolvePipPalette(actor.pip.speciesId, actor.pip.genome.palette).accent;
    const rx = PIP_BODY_WIDTH * 0.52 * s;
    actor.ring
      .clear()
      .ellipse(0, 3, rx, rx * 0.34)
      .stroke({ width: 3, color: accent, alpha: 0.65 })
      .ellipse(0, 3, rx * 0.82, rx * 0.34 * 0.82)
      .fill({ color: 0xffffff, alpha: 0.1 });
  }

  function drawActorGlow(actor: Actor): void {
    const s = visualScale(actor);
    const cy = -PIP_BODY_HEIGHT * 0.55 * s;
    const r = PIP_BODY_WIDTH * 0.72 * s;
    actor.glow.clear();
    for (const [fraction, alpha] of [
      [1, 0.1],
      [0.72, 0.14],
      [0.45, 0.2],
    ] as const) {
      actor.glow.circle(0, cy, r * fraction).fill({ color: 0xffe9a3, alpha });
    }
  }

  function applyActivityLook(actor: Actor): void {
    const sulking = actor.pip.activity === PipActivity.Sulking;
    const resting = actor.pip.activity === PipActivity.Resting;
    actor.sprite.setSulkTint(sulking);
    actor.slumpRot = sulking ? 0.09 : 0;
    actor.eyesForced = resting ? 0.08 : sulking ? 0.45 : null;
  }

  function attachSprite(actor: Actor): void {
    actor.spriteKey = actorSpriteKey(actor.pip);
    actor.root.addChild(actor.sprite.view);
    applyActorScale(actor);
    drawActorRing(actor);
    drawActorGlow(actor);
    applyActivityLook(actor);
  }

  function rebuildActorSprite(actor: Actor): void {
    actor.runner.clear();
    actor.anim.x = 0;
    actor.anim.y = 0;
    actor.anim.rot = 0;
    actor.sprite.destroy();
    actor.sprite = resolveActorSprite(actor.pip);
    attachSprite(actor);
    // A small hello pop so stage changes read.
    squashStretch(actor.runner, actor.sprite.rig, {
      amount: 0.1,
      cycleMs: 180,
      cycles: 2,
    });
  }

  function spawnPos(pip: PipState): { x: number; y: number } {
    if (pendingHatchSpawn !== null && pendingHatchSpawn.pipId === pip.id) {
      const pos = { x: pendingHatchSpawn.x, y: pendingHatchSpawn.y };
      pendingHatchSpawn = null;
      return pos;
    }
    const tile =
      pickFreeTile(jitter, layout.cols, layout.rows, blockedTiles) ?? {
        x: Math.floor(layout.cols / 2),
        y: Math.floor(layout.rows / 2),
      };
    return tileCenter(layout, tile.x, tile.y);
  }

  /**
   * @param spawnAt ROUND 2K — override the random free-tile spawn (and
   *   the arrival dust with it). A visitor enters from off-screen and
   *   WALKS in; a puff of dust at the screen edge would read as something
   *   materialising there, which is the opposite of "came a long way".
   */
  function createActor(pip: PipState, spawnAt?: { x: number; y: number }): Actor {
    const root = new Container();
    const ring = new Graphics();
    ring.visible = false;
    const glow = new Graphics();
    glow.alpha = 0;
    root.addChild(ring, glow);

    const pos = spawnAt ?? spawnPos(pip);
    const actor: Actor = {
      pip,
      sprite: resolveActorSprite(pip),
      spriteKey: "",
      root,
      ring,
      glow,
      runner: new TweenRunner(),
      seq: seqCounter++,
      x: pos.x,
      y: pos.y,
      facing: jitter.chance(0.5) ? 1 : -1,
      mode: "roam",
      modeKey: "",
      target: null,
      seatZ: null,
      seated: false,
      pauseMs: 600 + jitter.int(1800),
      careHoldMs: 0,
      walkPhase: 0,
      walkBob: 0,
      anim: { x: 0, y: 0, rot: 0 },
      slumpRot: 0,
      eyesForced: null,
      eyesCurrent: 1,
      blinkInMs: 2000 + jitter.int(2500),
      blinkT: -1,
      bobPhase: jitter.next() * Math.PI * 2,
      wiggleInMs: 5000 + jitter.int(5000),
      zInMs: 0,
      rummageInMs: 1200 + jitter.int(1500),
      produceInMs: 4000 + jitter.int(4000),
      mood: deriveMood(pip.needs),
      moodRefreshMs: 0,
      glowPhase: jitter.next() * Math.PI * 2,
      glowSparkleInMs: 900 + jitter.int(1600),
      shinySparkleInMs: 1200 + jitter.int(2600),
      ceremony: false,
      suppressRebuild: false,
      parading: false,
      helloBubble: null,
      visitor: null,
      decorHoldMs: 0,
      decorMotif: null,
      idleMs: 0,
      greetHoldMs: 0,
      footprintCooldownMs: 0,
    };
    attachSprite(actor);
    root.position.set(actor.x, actor.y);
    root.zIndex = actor.y;
    world.addChild(root);

    // Arrival: a little dust + hello wiggle (alive from frame one).
    // Skipped for an off-screen spawn — see `spawnAt`'s doc.
    if (spawnAt === undefined) {
      dustPoof(actor.x, actor.y, 0.8);
      squashStretch(actor.runner, actor.sprite.rig, {
        amount: 0.12,
        cycleMs: 180,
        cycles: 2,
      });
    }
    return actor;
  }

  function destroyActor(actor: Actor): void {
    actor.runner.clear();
    actor.helloBubble?.destroy({ children: true });
    actor.helloBubble = null;
    dustPoof(actor.x, actor.y, 0.7);
    actor.sprite.destroy();
    actor.root.removeFromParent();
    actor.root.destroy({ children: true });
  }

  /** Show the newborn's hello line above its head for a few seconds. */
  function showHelloBubble(actor: Actor, text: string): void {
    const bubble = buildHelloBubble(text);
    const s = visualScale(actor);
    bubble.position.set(actor.x, actor.y + (actor.sprite.headTopY - 10) * s);
    bubble.scale.set(0);
    fxAbove.view.addChild(bubble);
    actor.helloBubble = bubble;
    sceneRunner.add({
      durationMs: 260,
      ease: easeOutBack,
      onUpdate: (t) => {
        if (!bubble.destroyed) bubble.scale.set(t);
      },
    });
    sceneRunner.after(3600, () => {
      if (!bubble.destroyed) bubble.destroy({ children: true });
      if (actor.helloBubble === bubble) actor.helloBubble = null;
    });
  }

  // --- Behavior --------------------------------------------------------------

  /** Where a Resting pip naps: the pip's own bed pick (stable per pip so
   * two resting pips spread across beds), or null (nap in place). */
  function bedSeat(actor: Actor, state: GameState): { pos: { x: number; y: number }; z: number; key: string } | null {
    const beds = findPlacement(state, "bed");
    const bed = beds[fnv1a(actor.pip.id) % Math.max(1, beds.length)];
    if (bed === undefined) return null;
    const anchor = footprintAnchor(layout, bed.x, bed.y, footprintOf("bed"));
    return {
      pos: { x: anchor.x, y: anchor.y - layout.tileH * 0.42 },
      z: anchor.y + 1, // ON the cushion — draw just in front of the bed
      key: bed.id,
    };
  }

  function stationSeat(actor: Actor, state: GameState): { pos: { x: number; y: number }; z: number | null; key: string } | null {
    const job = state.jobs[actor.pip.id];
    if (job === undefined) return null;
    const placement = state.keep.placements[job.stationPlacementId];
    if (placement === undefined) return null;
    const anchor = footprintAnchor(
      layout,
      placement.x,
      placement.y,
      footprintOf(placement.itemId),
    );
    return {
      pos: { x: anchor.x - layout.tileW * 0.62, y: anchor.y + layout.tileH * 0.28 },
      z: null,
      key: job.stationPlacementId,
    };
  }

  function sulkSeat(actor: Actor): { x: number; y: number } {
    const corners = cornerTiles(layout.cols, layout.rows);
    const corner = corners[fnv1a(actor.pip.id) % corners.length] ?? { x: 0, y: 0 };
    const tile =
      nearestFreeTile(layout.cols, layout.rows, blockedTiles, corner) ?? corner;
    return tileCenter(layout, tile.x, tile.y);
  }

  /** Recompute the actor's behavior mode; on change, reset its journey. */
  function refreshMode(actor: Actor, state: GameState): void {
    const activity = actor.pip.activity;
    let mode: ActorMode = "roam";
    let key = "roam";
    if (activity === PipActivity.Sulking) {
      mode = "sulk";
      key = "sulk";
    } else if (activity === PipActivity.Resting) {
      mode = "rest";
      key = `rest|${bedSeat(actor, state)?.key ?? "floor"}`;
    } else if (activity === PipActivity.AssignedJob) {
      mode = "work";
      key = `work|${stationSeat(actor, state)?.key ?? "gone"}`;
    }
    if (key === actor.modeKey) return;

    actor.mode = mode;
    actor.modeKey = key;
    actor.seated = false;
    actor.seatZ = null;
    actor.target = null;
    actor.pauseMs = 0;
    actor.anim.rot = 0; // drop any mid-waddle lean

    if (mode === "rest") {
      const seat = bedSeat(actor, state);
      if (seat !== null) {
        actor.target = seat.pos;
        actor.seatZ = seat.z;
      } else {
        actor.seated = true; // no bed placed — nap right here
      }
    } else if (mode === "work") {
      const seat = stationSeat(actor, state);
      if (seat !== null) {
        actor.target = seat.pos;
      } else {
        actor.mode = "roam"; // station vanished mid-sync; reducer will heal
        actor.modeKey = "roam";
      }
    } else if (mode === "sulk") {
      actor.target = sulkSeat(actor);
    } else {
      actor.pauseMs = 400 + jitter.int(1200);
    }
  }

  /** Advance toward `target`. Returns true on arrival this frame. */
  function walk(actor: Actor, dtMs: number): boolean {
    const target = actor.target;
    if (target === null) return false;
    const pipling = actor.pip.lifeStage === LifeStage.Pipling;
    const speed = layout.tileW * (pipling ? 1.25 : 1.7); // px/s
    const strideFreq = pipling ? 11 : 7.5; // rad/s — Piplings patter
    const dx = target.x - actor.x;
    const dy = target.y - actor.y;
    const dist = Math.hypot(dx, dy);
    const step = (speed * dtMs) / 1000;
    if (Math.abs(dx) > 2) actor.facing = dx > 0 ? 1 : -1;
    if (dist <= step) {
      actor.x = target.x;
      actor.y = target.y;
      actor.target = null;
      actor.walkBob = 0;
      return true;
    }
    actor.x += (dx / dist) * step;
    actor.y += (dy / dist) * step;
    actor.walkPhase += (strideFreq * dtMs) / 1000;
    // The waddle: perky little hops + a sway (spec §9 amble).
    actor.walkBob = Math.abs(Math.sin(actor.walkPhase)) * layout.tileW * 0.055;
    actor.anim.rot = Math.sin(actor.walkPhase) * 0.06;
    return false;
  }

  /**
   * ROUND 2K (bible §4.4) — the item an idle Pip wanders over to look at.
   *
   * ⚠️ THIS IS THE ROUND'S BEST DELIGHT-PER-FRAME-COST ITEM AND IT COSTS
   * ZERO DISPLAY OBJECTS: one extra branch when picking a wander target,
   * roughly once every three seconds per actor. It is also the thing that
   * retroactively pays off round 2F's 45 build items — the answer to "why
   * did I build that" becomes "because someone sits on it".
   *
   * Returns the placement to visit, or null to fall through to an
   * ordinary free tile.
   */
  function pickDecorInterest(
    state: GameState,
  ): { pid: string; itemId: string; x: number; y: number } | null {
    const entries = Object.entries(state.keep.placements);
    if (entries.length === 0) return null;
    const picked = entries[jitter.int(entries.length)];
    if (picked === undefined) return null;
    const [pid, placement] = picked;
    if (ITEM_MOTIF[placement.itemId] === undefined) return null;
    return { pid, itemId: placement.itemId, x: placement.x, y: placement.y };
  }

  /**
   * ROUND 2K (bible §4.3) — the nearest thing to stand under when it
   * rains: an `arch`, a `nest`, a `bench`, or a Bed.
   *
   * ⚠️ SHELTERING IS A BEHAVIOUR, NOT A MECHANIC (invariant I4). A
   * sheltering Pip's needs, decay, mood, job production and expedition
   * eligibility are byte-identical to a wandering one's — this function
   * changes where an actor stands and nothing else. It is nonetheless the
   * best thing in §4.3, because Pips running for the arch is worth more
   * than the rain is.
   */
  const SHELTER_MOTIFS: ReadonlySet<string> = new Set(["arch", "nest", "bench"]);

  function pickShelter(
    state: GameState,
  ): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null;
    for (const placement of Object.values(state.keep.placements)) {
      const motif = ITEM_MOTIF[placement.itemId];
      if (placement.itemId !== "bed" && (motif === undefined || !SHELTER_MOTIFS.has(motif))) {
        continue;
      }
      const anchor = footprintAnchor(layout, placement.x, placement.y, footprintOf(placement.itemId));
      if (best === null) best = { x: anchor.x, y: anchor.y };
    }
    return best;
  }

  function pickRoamTarget(actor: Actor, state: GameState): void {
    // ROUND 2K — a VISITOR loiters at the attraction that drew it here
    // (bible §1.5 item 3: "not stationary and not on rails"). Same
    // gravitation the Food Bowl already uses, keyed to its own home.
    const visiting = actor.visitor;
    if (visiting !== null) {
      if (visiting.leaving) {
        actor.target = edgePointNear({ x: actor.x, y: actor.y });
        actor.pauseMs = 0;
        return;
      }
      const homeTile = worldToTile(layout, visiting.home.x, visiting.home.y);
      const near = pickFreeTile(jitter, layout.cols, layout.rows, blockedTiles, {
        near: homeTile,
        maxDist: 2,
      });
      if (near !== null) actor.target = tileCenter(layout, near.x, near.y);
      actor.pauseMs = 0;
      return;
    }

    // ROUND 2K — rain sends everyone for cover, before anything else
    // (there is no point admiring the lantern in a downpour).
    if (weather !== null && seeksShelter(weather.kind) && jitter.chance(0.5)) {
      const shelter = pickShelter(state);
      if (shelter !== null) {
        actor.target = { x: shelter.x, y: shelter.y + layout.tileH * 0.35 };
        actor.pauseMs = 0;
        return;
      }
    }

    // ⚠️ ROUND 2K FIX STAGE — petalfall's behavioural half, which was
    // WRITTEN AND NEVER HOOKED UP. `invitesPlay` shipped as an import in
    // this file and nothing else: `grep -c invitesPlay` returned 1, the
    // import line. Its own doc reads "Is there something in the air worth
    // batting at? (petalfall.)", so the beat was designed — rain's
    // `seeksShelter` and snow's `leavesFootprints` are both wired, and
    // petalfall alone was left inert. That is the tenth instance of this
    // project's signature defect, in the very round whose brief was to
    // close the ninth. `tsconfig.json` sets no `noUnusedLocals`, so
    // nothing complained.
    if (weather !== null && invitesPlay(weather.kind) && jitter.chance(0.35)) {
      playPetalChase(actor);
      return;
    }

    // ROUND 2K — decoration interest.
    if (jitter.chance(contentTuning.liveliness.ambience.decorInterestChance)) {
      const interest = pickDecorInterest(state);
      if (interest !== null) {
        const anchor = footprintAnchor(
          layout,
          interest.x,
          interest.y,
          footprintOf(interest.itemId),
        );
        actor.target = { x: anchor.x, y: anchor.y + layout.tileH * 0.4 };
        actor.decorMotif = ITEM_MOTIF[interest.itemId] ?? null;
        actor.pauseMs = 0;
        return;
      }
    }

    const hungry = actor.pip.needs.hunger < 40;
    const bowls = hungry ? findPlacement(state, "food-bowl") : [];
    const bowl = bowls[0];
    const current = worldToTile(layout, actor.x, actor.y);
    const tile = pickFreeTile(jitter, layout.cols, layout.rows, blockedTiles, {
      near: bowl !== undefined ? { x: bowl.x, y: bowl.y } : current,
      maxDist: bowl !== undefined ? 2 : 3,
      exclude: (tx, ty) => tx === current.x && ty === current.y,
    });
    if (tile !== null) actor.target = tileCenter(layout, tile.x, tile.y);
    actor.pauseMs = 0;
  }

  /**
   * ROUND 2K (bible §4.4) — the ~2 s interaction an actor plays on
   * arriving at an item it walked over to look at. Sixteen motifs cover
   * the entire 45-item catalogue with ZERO new content authoring, and
   * every future item inherits one the moment it is given an icon.
   *
   * Every branch reuses an animation channel that already exists
   * (`anim.y`, `anim.rot`, the squash runner, the particle pool), so the
   * whole table costs no new objects and no new tween machinery.
   */
  /**
   * ⚠️ ROUND 2K FIX STAGE — the petalfall reaction `invitesPlay` was
   * written for and never given.
   *
   * A Pip stops where it is, rears up and bats at a petal going past. It
   * costs ZERO new display objects and no new tween machinery, exactly
   * like every branch of `playDecorInteraction` below: the hop rides
   * `anim.y`/`anim.rot`, and the petals come out of the pooled emitter
   * `fxAbove` using the same `keepPalette.flowerPetals` the falling motes
   * are drawn from — so the thing the Pip swats at is visibly the thing
   * that is falling.
   */
  function playPetalChase(actor: Actor): void {
    const s = visualScale(actor);
    actor.decorHoldMs = contentTuning.liveliness.ambience.decorInteractionMs;
    actor.pauseMs = 0;
    fxAbove.burst({
      x: actor.x + 10 * actor.facing * s,
      y: actor.y - 34 * s,
      count: 4,
      shape: "dot",
      colors: [...keepPalette.flowerPetals],
      speed: 60,
      directionRad: -Math.PI / 2,
      spreadRad: Math.PI * 0.9,
      gravity: 90,
      lifeMs: 700,
      sizeMin: 2,
      sizeMax: 3.6,
    });
    actor.runner.add({
      durationMs: 1100,
      ease: easeInOut,
      onUpdate: (t) => {
        // Two swipes: up on the toes, a little lean into each one.
        const swipe = Math.sin(t * Math.PI * 2);
        actor.anim.y = -Math.abs(Math.sin(t * Math.PI * 2)) * 6 * s;
        actor.anim.rot = swipe * 0.14 * actor.facing;
      },
      onComplete: () => {
        actor.anim.y = 0;
        actor.anim.rot = 0;
      },
    });
  }

  function playDecorInteraction(actor: Actor, motif: string): void {
    const s = visualScale(actor);
    actor.decorHoldMs = contentTuning.liveliness.ambience.decorInteractionMs;
    switch (motif) {
      case "droplet":
        // A splash, with two dust-blue drops.
        fxAbove.burst({
          x: actor.x,
          y: actor.y,
          count: 6,
          shape: "dot",
          colors: ["#bfe6ef", "#e8f6fa"],
          speed: 90,
          directionRad: -Math.PI / 2,
          spreadRad: Math.PI * 0.8,
          gravity: 260,
          lifeMs: 520,
          sizeMin: 2,
          sizeMax: 3.4,
        });
        squashStretch(actor.runner, actor.sprite.rig, { amount: 0.2, cycleMs: 200, cycles: 2 });
        break;
      case "nest":
        // Curl up for one slow breath.
        actor.runner.add({
          durationMs: 1600,
          ease: easeInOut,
          onUpdate: (t) => {
            actor.anim.y = Math.sin(t * Math.PI) * 4 * s;
            actor.anim.rot = Math.sin(t * Math.PI) * 0.05;
          },
        });
        break;
      case "leaf":
        // Sniff: lean forward, ears (such as they are) first.
        actor.runner.add({
          durationMs: 900,
          ease: easeInOut,
          onUpdate: (t) => {
            actor.anim.rot = Math.sin(t * Math.PI) * 0.16 * actor.facing;
            actor.anim.y = Math.sin(t * Math.PI) * 3 * s;
          },
        });
        break;
      case "lantern":
      case "flame":
        // Sit and stare at it. The stillness IS the animation.
        actor.runner.add({
          durationMs: 1800,
          ease: linear,
          onUpdate: (t) => {
            actor.anim.y = Math.sin(t * Math.PI * 2) * 1.2 * s;
          },
        });
        break;
      case "stone":
        // Lean against it.
        actor.runner.add({
          durationMs: 1700,
          ease: easeInOut,
          onUpdate: (t) => {
            actor.anim.rot = Math.sin(Math.min(1, t * 2) * Math.PI * 0.5) * 0.13 * actor.facing;
          },
          onComplete: () => {
            actor.anim.rot = 0;
          },
        });
        break;
      case "post":
        squashStretch(actor.runner, actor.sprite.rig, { amount: 0.22, cycleMs: 170, cycles: 4 });
        break;
      case "bowl":
      case "basket":
      case "pot":
      case "bench":
        rummage(actor);
        break;
      case "arch":
        // Walk through and pause on the far side.
        actor.runner.add({
          durationMs: 900,
          ease: easeInOut,
          onUpdate: (t) => {
            actor.anim.x = actor.facing * 18 * s * t;
          },
        });
        break;
      case "chime":
        sound("ui.tap");
        actor.runner.add({
          durationMs: 700,
          ease: easeOut,
          onUpdate: (t) => {
            actor.anim.x = Math.sin(t * Math.PI * 4) * 5 * (1 - t) * s;
          },
        });
        break;
      default: {
        // shell / snowflake / spark and anything a future item invents:
        // a small delighted hop. An unknown motif is VISIBLE, never inert.
        actor.runner.add({
          durationMs: 420,
          ease: easeOut,
          onUpdate: (t) => {
            actor.anim.y = -Math.sin(t * Math.PI) * 16 * s;
          },
          onComplete: () => {
            actor.anim.y = 0;
          },
        });
        break;
      }
    }
  }

  /** One produced-item pop over the station (cosmetic — real production
   * is the reducer's timestamp math, spec §6.2). */
  function producePop(actor: Actor): void {
    const isBerry = jitter.chance(0.7);
    const color = isBerry ? itemColors["berry"] ?? "#e0607e" : "#c9a86b";
    const s = visualScale(actor);
    const dot = new Graphics().circle(0, 0, 6 * Math.max(0.6, s)).fill(color);
    dot.circle(1.5, -5 * Math.max(0.6, s), 2).fill(keepPalette.tuft);
    const fromX = actor.x + actor.facing * layout.tileW * 0.5;
    const fromY = actor.y - layout.tileH * 1.1;
    dot.position.set(fromX, fromY);
    fxAbove.view.addChild(dot);
    sound("job.produce");
    actor.runner.add({
      durationMs: 640,
      ease: easeOut,
      onUpdate: (t) => {
        if (dot.destroyed) return;
        dot.position.y = fromY - t * layout.tileH * 0.9;
        dot.alpha = t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1;
      },
      onComplete: () => {
        if (!dot.destroyed) {
          dot.removeFromParent();
          dot.destroy();
        }
      },
    });
    fxAbove.burst({
      x: fromX,
      y: fromY,
      count: 3,
      shape: "sparkle",
      colors: ["#ffffff", "#fdf3c0"],
      speed: 40,
      gravity: -15,
      lifeMs: 500,
      sizeMin: 2,
      sizeMax: 3.5,
    });
  }

  function rummage(actor: Actor): void {
    // Lean into the basket and root around.
    const rig = actor.sprite.rig;
    const dir = actor.facing;
    actor.runner.sequence([
      {
        durationMs: 260,
        ease: easeInOut,
        onUpdate: (t) => {
          actor.anim.rot = dir * 0.16 * t;
          actor.anim.y = 3 * t;
        },
      },
      {
        durationMs: 340,
        ease: linear,
        onUpdate: (t) => {
          actor.anim.rot = dir * (0.16 + Math.sin(t * Math.PI * 4) * 0.035);
        },
      },
      {
        durationMs: 240,
        ease: easeOut,
        onUpdate: (t) => {
          actor.anim.rot = dir * 0.16 * (1 - t);
          actor.anim.y = 3 * (1 - t);
        },
        onComplete: () => {
          actor.anim.rot = 0;
          actor.anim.y = 0;
          squashStretch(actor.runner, rig, { amount: 0.08, cycleMs: 160 });
        },
      },
    ]);
  }

  function updateActor(actor: Actor, dtMs: number, state: GameState): void {
    actor.runner.update(dtMs);
    if (actor.careHoldMs > 0) actor.careHoldMs -= dtMs;

    const resting = actor.pip.activity === PipActivity.Resting;
    const sulking = actor.pip.activity === PipActivity.Sulking;

    // Mood cache (spec §4.3 mood-informed idling; Chaotic's display
    // offset is a render-side roll — display-only, per the quirk).
    actor.moodRefreshMs -= dtMs;
    if (actor.moodRefreshMs <= 0) {
      actor.moodRefreshMs = 1500 + jitter.int(700);
      actor.mood = deriveDisplayedMood(
        deriveMood(actor.pip.needs),
        actor.pip.personalityId,
        jitter,
      );
    }
    const idle = MOOD_IDLE[actor.mood];

    // --- Movement / behavior (frozen during ceremony + care moments +
    // the conga, whose updateParade drives positions directly, and — new
    // in round 2K — while mid-interaction with a decoration or mid-hello
    // with another Pip: both are moments, and a moment you amble away
    // from is not a moment) ---
    if (actor.decorHoldMs > 0) actor.decorHoldMs -= dtMs;
    if (actor.greetHoldMs > 0) actor.greetHoldMs -= dtMs;
    const frozen =
      actor.ceremony ||
      actor.careHoldMs > 0 ||
      actor.parading ||
      actor.decorHoldMs > 0 ||
      actor.greetHoldMs > 0;
    if (!frozen) {
      refreshMode(actor, state);
      if (actor.target !== null) {
        const arrived = walk(actor, dtMs);
        if (arrived) {
          actor.anim.rot = 0;
          if (actor.mode === "roam") {
            // ROUND 2K — arrived at something worth looking at.
            const motif = actor.decorMotif;
            actor.decorMotif = null;
            if (motif !== null) {
              playDecorInteraction(actor, motif);
            }
            // Night makes an Idle Pip likelier to settle than to set off
            // again: the pause between wanders stretches (bible §4.2).
            const nightBias =
              daylight?.phase === "night"
                ? contentTuning.liveliness.daylight.nightSettleBias
                : 1;
            actor.pauseMs = (1400 + jitter.int(2800)) * nightBias;
          } else {
            actor.seated = true;
            if (actor.mode === "work") {
              actor.facing = 1; // face the basket (drawn center-right)
            }
          }
        }
      } else if (actor.mode === "roam") {
        actor.pauseMs -= dtMs;
        if (actor.pauseMs <= 0) pickRoamTarget(actor, state);
      } else if (actor.mode === "work" && actor.seated) {
        actor.rummageInMs -= dtMs;
        if (actor.rummageInMs <= 0 && actor.runner.active === 0) {
          actor.rummageInMs = 2400 + jitter.int(2200);
          rummage(actor);
        }
        actor.produceInMs -= dtMs;
        if (actor.produceInMs <= 0) {
          actor.produceInMs = 6000 + jitter.int(5000);
          producePop(actor);
        }
      }
    } else {
      actor.walkBob = 0;
    }

    // --- ROUND 2K: the visitor's own beats ------------------------------
    const visiting = actor.visitor;
    if (visiting !== null) {
      if (visiting.leaving && actor.target === null) {
        // Reached the edge: the visit is genuinely over. No dust poof —
        // they walked out, they did not evaporate.
        actors.delete(`${VISITOR_ACTOR_PREFIX}${visiting.placementId}`);
        actor.runner.clear();
        actor.helloBubble?.destroy({ children: true });
        actor.sprite.destroy();
        actor.root.removeFromParent();
        actor.root.destroy({ children: true });
        return;
      }
      // The drifting motif — keyed off the ATTRACTION's icon, so what
      // drifts around a visitor tells you which thing drew it here.
      visiting.motifInMs -= dtMs;
      if (visiting.motifInMs <= 0) {
        visiting.motifInMs = 2600 + jitter.int(2400);
        visitorMotifPuff(actor);
      }
      // At full trust they carry a soft, NON-PULSING glow: "ready", never
      // "urgent" (2C §0.3 bans urgency surfaces as a category).
      const ready = visitorReadyToWelcome(actor);
      const targetGlow = ready ? 0.5 : 0;
      actor.glow.alpha += (targetGlow - actor.glow.alpha) * 0.06;
    }

    // --- ROUND 2K: snow keeps a record of where everyone went -----------
    if (
      weather !== null &&
      leavesFootprints(weather.kind) &&
      actor.target !== null &&
      !frozen
    ) {
      actor.footprintCooldownMs -= dtMs;
      if (actor.footprintCooldownMs <= 0) {
        actor.footprintCooldownMs = 260;
        dropFootprint(actor);
      }
    }

    // --- Idle juice (bob, blink, wiggle) --------------------------------
    const walking = actor.target !== null && !frozen;
    // ROUND 2K — how long this actor has been standing still and
    // unoccupied. The greeting rule's "both idle ≥ 1.5 s" precondition
    // (bible §4.5): it stops two Pips who merely pass each other
    // mid-stride from stopping dead to say hello.
    actor.idleMs = walking || frozen ? 0 : actor.idleMs + dtMs;
    actor.bobPhase += (dtMs / 1000) * (resting ? 1.6 : idle.bobSpeed);
    const bobAmp = sulking ? 0.8 : resting ? 1.6 : idle.bobAmp;
    const bobY = walking
      ? -actor.walkBob
      : Math.sin(actor.bobPhase) * bobAmp * Math.max(0.5, visualScale(actor));

    if (actor.runner.active === 0 && !walking) {
      const breathe = Math.sin(actor.bobPhase) * 0.012;
      const rig = actor.sprite.rig;
      rig.scale.x += (1 + breathe - rig.scale.x) * 0.3;
      rig.scale.y += (1 - breathe - rig.scale.y) * 0.3;
    }

    // Blink (skipped while resting — eyes already shut).
    const eyesTarget = actor.eyesForced ?? idle.eyes;
    if (!resting) {
      if (actor.blinkT >= 0) {
        actor.blinkT += dtMs;
        const t = actor.blinkT / 150;
        actor.eyesCurrent =
          t >= 1 ? eyesTarget : eyesTarget * Math.abs(Math.cos(Math.PI * t));
        if (t >= 1) actor.blinkT = -1;
      } else {
        actor.blinkInMs -= dtMs;
        if (actor.blinkInMs <= 0) {
          actor.blinkT = 0;
          // ROUND 2K (bible §4.2) — blinks stretch at night. A sleepy
          // Keep is a night-time Keep, and this costs one multiply.
          const nightBlink =
            daylight?.phase === "night"
              ? contentTuning.liveliness.daylight.nightBlinkMultiplier
              : 1;
          actor.blinkInMs = (2000 + jitter.int(2800)) * nightBlink;
        }
        actor.eyesCurrent += (eyesTarget - actor.eyesCurrent) * 0.25;
      }
    } else {
      actor.eyesCurrent += (eyesTarget - actor.eyesCurrent) * 0.2;
    }
    actor.sprite.setEyesOpen(actor.eyesCurrent);

    // Occasional idle flourish — the mood picks the move (spec §4.3).
    if (!walking && !resting && !sulking && !frozen && actor.runner.active === 0) {
      actor.wiggleInMs -= dtMs;
      if (actor.wiggleInMs <= 0) {
        actor.wiggleInMs = 5000 + jitter.int(6000);
        if (actor.mood === "beaming") {
          // A happy hop.
          const s = visualScale(actor);
          actor.runner.sequence([
            {
              durationMs: 200,
              ease: easeOut,
              onUpdate: (t) => {
                actor.anim.y = -26 * s * t;
              },
            },
            {
              durationMs: 190,
              ease: easeIn,
              onUpdate: (t) => {
                actor.anim.y = -26 * s * (1 - t);
              },
              onComplete: () => {
                actor.anim.y = 0;
                squashStretch(actor.runner, actor.sprite.rig, {
                  amount: 0.12,
                  cycleMs: 160,
                });
              },
            },
          ]);
        } else if (actor.mood === "grumpy") {
          // A slow, put-upon head shake.
          actor.runner.add({
            durationMs: 700,
            ease: linear,
            onUpdate: (t) => {
              actor.anim.rot = Math.sin(t * Math.PI * 2) * 0.04 * (1 - t);
            },
            onComplete: () => {
              actor.anim.rot = 0;
            },
          });
        } else if (actor.mood === "miserable") {
          // The heavy sigh (spec §4.3 differentiation): sink slowly,
          // hold flat at the bottom, deflate-recover — nothing like
          // Grumpy's brisk shake. Scale on the rig so the breathe lerp
          // (runner.active guard above) stays out of the way.
          const rig = actor.sprite.rig;
          actor.runner.sequence([
            {
              durationMs: 650,
              ease: easeInOut,
              onUpdate: (t) => {
                rig.scale.y = 1 - 0.09 * t;
                rig.scale.x = 1 + 0.05 * t;
                actor.anim.y = 3.5 * t;
              },
            },
            { durationMs: 420, onUpdate: () => {} }, // hold the slump
            {
              durationMs: 780,
              ease: easeInOut,
              onUpdate: (t) => {
                rig.scale.y = 0.91 + 0.09 * t;
                rig.scale.x = 1.05 - 0.05 * t;
                actor.anim.y = 3.5 * (1 - t);
              },
              onComplete: () => {
                rig.scale.set(1, 1);
                actor.anim.y = 0;
              },
            },
          ]);
        } else {
          actor.runner.add({
            durationMs: 560,
            ease: linear,
            onUpdate: (t) => {
              actor.anim.rot = Math.sin(t * Math.PI * 3) * 0.055 * (1 - t);
            },
            onComplete: () => {
              actor.anim.rot = 0;
            },
          });
        }
      }
    }

    // Drifting Z's while Resting.
    if (resting && actor.seated) {
      actor.zInMs -= dtMs;
      if (actor.zInMs <= 0) {
        actor.zInMs = 850 + jitter.int(500);
        const s = visualScale(actor);
        fxAbove.floatZ(actor.x + 26 * s, actor.y + actor.sprite.headTopY * s + 6);
      }
    }

    // Evolution-ready glow (spec §4.6: glows and waits for the tap).
    const ready = actor.pip.readyToEvolve && !actor.ceremony;
    if (ready) {
      actor.glowPhase += (dtMs / 1000) * 2.4;
      actor.glow.alpha = 0.55 + Math.sin(actor.glowPhase) * 0.25;
      const gs = 1 + Math.sin(actor.glowPhase) * 0.06;
      actor.glow.scale.set(gs);
      actor.glowSparkleInMs -= dtMs;
      if (actor.glowSparkleInMs <= 0) {
        actor.glowSparkleInMs = 1400 + jitter.int(2200);
        const s = visualScale(actor);
        fxAbove.burst({
          x: actor.x + (jitter.next() - 0.5) * PIP_BODY_WIDTH * s,
          y: actor.y - jitter.next() * PIP_BODY_HEIGHT * s,
          count: 3,
          shape: "sparkle",
          colors: ["#ffffff", "#ffe9a3", "#f9d47d"],
          speed: 30,
          gravity: -28,
          lifeMs: 750,
          sizeMin: 2.5,
          sizeMax: 4,
        });
      }
    } else if (!actor.ceremony) {
      actor.glow.alpha = 0;
    }

    // Iridescent-variant glint (genome.shiny): an occasional two-fleck
    // pastel shimmer off the flank. Deliberately quieter than the
    // evolution glow's gold sparkles — a secret you notice, not a siren.
    if (actor.pip.genome.shiny && !actor.ceremony) {
      actor.shinySparkleInMs -= dtMs;
      if (actor.shinySparkleInMs <= 0) {
        actor.shinySparkleInMs = 2600 + jitter.int(3800);
        const s = visualScale(actor);
        fxAbove.burst({
          x: actor.x + (jitter.next() - 0.5) * PIP_BODY_WIDTH * 0.8 * s,
          y: actor.y - (0.3 + jitter.next() * 0.6) * PIP_BODY_HEIGHT * s,
          count: 2,
          shape: "sparkle",
          colors: ["#ffffff", "#ffd9ec", "#d3f4e2", "#dbe4ff"],
          speed: 16,
          gravity: -20,
          lifeMs: 620,
          sizeMin: 1.8,
          sizeMax: 3,
        });
      }
    }

    // Active-pip ring: a soft breathing pulse.
    if (actor.ring.visible) {
      actor.ring.alpha = 0.75 + Math.sin(actor.bobPhase * 0.7) * 0.2;
    }

    // --- Composite -------------------------------------------------------
    applyActorScale(actor);
    actor.sprite.rig.position.set(actor.anim.x, bobY + actor.anim.y);
    // Standing posture: the Sulking slump and the Miserable mood-wilt
    // never stack (max, not sum) — a sulking pip is already down bad.
    const postureSlump = frozen
      ? actor.slumpRot
      : Math.max(actor.slumpRot, idle.slumpRad);
    actor.sprite.rig.rotation = postureSlump + actor.anim.rot;
    // ROUND 2K (bible §4.2) — THE SHADOW SKEW. Two float writes, and the
    // single cheapest thing that makes the light read as REAL rather than
    // as a colour filter over the top: at dawn the shadows fall long to
    // the right, at dusk long to the left, and at noon they sit under
    // everyone. `sunAngle` is -1 (hard left) .. +1 (hard right), so the
    // shadow leans the OPPOSITE way to the light.
    if (daylight !== null) {
      const skew = tuningAmbience.shadowSkewMax;
      const stretch = tuningAmbience.shadowStretchMax;
      const lean = -daylight.sunAngle;
      actor.sprite.shadow.x = lean * PIP_BODY_WIDTH * 0.5 * skew;
      actor.sprite.shadow.scale.x = 1 + Math.abs(lean) * stretch;
    }
    actor.root.position.set(actor.x, actor.y);
    actor.root.zIndex = actor.seated && actor.seatZ !== null ? actor.seatZ : actor.y;
    if (actor.helloBubble !== null && !actor.helloBubble.destroyed) {
      const s = visualScale(actor);
      actor.helloBubble.position.set(
        actor.x,
        actor.y + (actor.sprite.headTopY - 10) * s,
      );
    }
  }

  // --- The conga (playParade) ------------------------------------------------
  //
  // Cosmetic-only by construction: this block touches actor positions,
  // particles, and the sound seam — never the store, never GameState.
  // The only state it reads is the roster the scene already mirrors.

  /** Wink lines for the closer — one random marcher gets the last word. */
  const PARADE_WINK_LINES: readonly string[] = [
    "We practiced that. Don't ask when.",
    "You saw nothing. Okay — you saw everything.",
    "Same time next never?",
    "The kazoo was imaginary. The joy was not.",
    "That was for morale. Morale is up.",
  ];

  interface ParadeMarcher {
    readonly pipId: string;
    readonly home: { x: number; y: number };
  }

  interface ParadeState {
    t: number;
    marchers: readonly ParadeMarcher[];
    confettiInMs: number;
  }

  let paradeQueued = false;
  let parade: ParadeState | null = null;

  /** Foreground marching lane, recomputed live so resizes stay sane.
   * Capped just above the measured bottom chrome — a conga nobody can see is
   * a wasted kazoo. (This used to be a flat `h * 0.78`, which on a 375×812
   * phone put the lane's floor at 633px against chrome starting at 655: it
   * happened to clear, but only because 0.78 and the chrome's real height
   * were independently chosen and got lucky.) */
  function paradeLaneY(): number {
    const gridBottom = layout.originY + layout.rows * layout.tileH;
    return Math.min(h - bottomInset - 12, gridBottom + layout.tileH * 0.55);
  }

  function paradeSpacing(): number {
    return Math.max(46, PIP_BODY_WIDTH * pipScale() * 0.95);
  }

  function paradeSpeedPxPerMs(): number {
    return Math.max(0.09, w / 7000); // leader crosses in ~7s tops
  }

  function startParade(): void {
    paradeQueued = false;
    if (parade !== null || lastState === null) return;
    // Adults lead, Piplings trail (roster order within each group) —
    // strictly the roster the scene already renders; absent (expedition)
    // pips simply aren't in `actors`.
    const adults: ParadeMarcher[] = [];
    const piplings: ParadeMarcher[] = [];
    for (const id of lastState.rosterOrder) {
      const actor = actors.get(id);
      if (actor === undefined) continue;
      const marcher: ParadeMarcher = {
        pipId: id,
        home: { x: actor.x, y: actor.y },
      };
      (actor.pip.lifeStage === LifeStage.Pipling ? piplings : adults).push(marcher);
      actor.parading = true;
      actor.target = null;
      actor.walkBob = 0;
      actor.seated = false;
      actor.anim.rot = 0;
    }
    const marchers = [...adults, ...piplings];
    if (marchers.length === 0) return;
    parade = { t: 0, marchers, confettiInMs: 260 };
    sound("parade.kazoo");
  }

  function endParade(state: ParadeState): void {
    parade = null;
    const survivors: Actor[] = [];
    for (const marcher of state.marchers) {
      const actor = actors.get(marcher.pipId);
      if (actor === undefined) continue;
      survivors.push(actor);
      actor.parading = false;
      // Amble back to whatever they were doing: roam pips walk home to
      // their old spot; resting/working/sulking pips re-derive their
      // seat on the next refreshMode pass (modeKey reset forces it).
      actor.mode = "roam";
      actor.modeKey = "roam";
      actor.seated = false;
      actor.seatZ = null;
      actor.target = { ...marcher.home };
      actor.pauseMs = 0;
      actor.facing = -1;
    }
    // The last word: a tiny wink from one random marcher as they head in.
    const winker = survivors.length > 0 ? jitter.pick(survivors) : undefined;
    if (winker !== undefined) {
      showHelloBubble(winker, jitter.pick(PARADE_WINK_LINES));
    }
  }

  function updateParade(dtMs: number): void {
    const state = parade;
    if (state === null) return;
    state.t += dtMs;

    const lane = paradeLaneY();
    const spacing = paradeSpacing();
    const speed = paradeSpeedPxPerMs();
    let anyOnStage = false;

    state.marchers.forEach((marcher, index) => {
      const actor = actors.get(marcher.pipId);
      if (actor === undefined) return; // left mid-parade (e.g. sent away)
      if (actor.ceremony) return; // evolution outranks the conga — hold still
      const x = -70 - index * spacing + state.t * speed;
      if (x <= w + 80) anyOnStage = true;
      actor.x = x;
      // The conga: a snaking lane plus a per-marcher hop out of phase.
      actor.y = lane + Math.sin(state.t * 0.004 + index * 0.85) * 5;
      actor.facing = 1;
      actor.anim.y = -Math.abs(Math.sin(state.t * 0.011 + index * 0.7)) * 7;
      actor.anim.rot = Math.sin(state.t * 0.012 + index * 0.9) * 0.09;
    });

    state.confettiInMs -= dtMs;
    if (state.confettiInMs <= 0) {
      state.confettiInMs = 320 + jitter.int(420);
      const onStage = state.marchers.filter((m) => {
        const a = actors.get(m.pipId);
        return a !== undefined && a.x > -40 && a.x < w + 40;
      });
      const around = onStage.length > 0 ? jitter.pick(onStage) : undefined;
      const a = around !== undefined ? actors.get(around.pipId) : undefined;
      if (a !== undefined) {
        fxAbove.burst({
          x: a.x + (jitter.next() - 0.5) * 40,
          y: a.y - PIP_BODY_HEIGHT * 0.9 * pipScale(),
          count: 9,
          shape: "dot",
          colors: [...keepPalette.flowerPetals, "#ffffff", "#f9d47d"],
          speed: 150,
          directionRad: -Math.PI / 2,
          spreadRad: Math.PI * 1.2,
          gravity: 240,
          lifeMs: 900,
        });
      }
    }

    if (!anyOnStage) endParade(state);
  }

  // --- Evolution ceremony (spec §4.6 — the witnessed moment, < 4s) -----------

  let evolveInit = false;
  let seenEvolveOutcome: EvolveOutcome | null = null;

  function drawFlash(): void {
    flashG.clear().rect(0, 0, w, h).fill(0xffffff);
  }

  function startCeremony(pipId: string): void {
    const actor = actors.get(pipId);
    if (actor === undefined || actor.ceremony) return;
    actor.ceremony = true;
    actor.suppressRebuild = true;
    actor.target = null;
    actor.walkBob = 0;
    actor.anim.rot = 0;
    sound("evolve.gather");

    const look = (): Actor | undefined => actors.get(pipId);
    const s = visualScale(actor);

    // 1) Gather-light: the glow swells and sparkles spiral in (0–900ms).
    sceneRunner.add({
      durationMs: 900,
      ease: easeInOut,
      onUpdate: (t) => {
        const a = look();
        if (a === undefined) return;
        a.glow.alpha = 0.2 + t * 1;
        a.glow.scale.set(1.7 - 0.7 * t);
        a.anim.rot = Math.sin(t * 26) * 0.02 * t; // excited tremble
      },
    });
    for (const delay of [140, 420, 680]) {
      sceneRunner.after(delay, () => {
        const a = look();
        if (a === undefined) return;
        fxAbove.burst({
          x: a.x,
          y: a.y - PIP_BODY_HEIGHT * 0.55 * s,
          count: 7,
          shape: "sparkle",
          colors: ["#ffffff", "#ffe9a3", "#fdf3c0"],
          speed: 26,
          gravity: -34,
          lifeMs: 700,
          sizeMin: 2.5,
          sizeMax: 4.5,
        });
      });
    }

    // 2) White flash in (880–1050ms); the silhouette swap at the peak.
    sceneRunner.add({
      delayMs: 880,
      durationMs: 170,
      ease: easeIn,
      onUpdate: (t) => {
        flashG.alpha = t;
      },
      onComplete: () => {
        const a = look();
        if (a !== undefined) {
          a.glow.alpha = 0;
          a.glow.scale.set(1);
          a.anim.rot = 0;
          rebuildActorSprite(a); // a.pip already carries the new species
          a.suppressRebuild = false;
          // Arrival pop, bigger than the usual hello.
          squashStretch(a.runner, a.sprite.rig, {
            amount: 0.24,
            cycleMs: 220,
            cycles: 2,
          });
        }
      },
    });

    // 3) Flash out + confetti + fanfare slot (1050–1600ms).
    sceneRunner.add({
      delayMs: 1050,
      durationMs: 480,
      ease: easeOut,
      onUpdate: (t) => {
        flashG.alpha = 1 - t;
      },
      onComplete: () => {
        flashG.alpha = 0;
      },
    });
    sceneRunner.after(1080, () => {
      const a = look();
      if (a === undefined) return;
      sound("evolve.fanfare");
      const accent = resolvePipPalette(a.pip.speciesId, a.pip.genome.palette).accent;
      fxAbove.burst({
        x: a.x,
        y: a.y - PIP_BODY_HEIGHT * 0.5 * s,
        count: 26,
        shape: "dot",
        colors: [...keepPalette.flowerPetals, "#ffffff", accent],
        speed: 240,
        directionRad: -Math.PI / 2,
        spreadRad: Math.PI * 1.5,
        gravity: 330,
        lifeMs: 1000,
      });
      fxAbove.burst({
        x: a.x,
        y: a.y - PIP_BODY_HEIGHT * 0.8 * s,
        count: 10,
        shape: "sparkle",
        colors: ["#ffffff", "#ffe9a3", accent],
        speed: 90,
        gravity: -12,
        lifeMs: 900,
        sizeMin: 3,
        sizeMax: 5,
      });
    });

    // 4) Happy wiggle, then back to ordinary Keep life (~2.6s total).
    sceneRunner.after(1650, () => {
      const a = look();
      if (a === undefined) return;
      a.runner.add({
        durationMs: 700,
        ease: linear,
        onUpdate: (t) => {
          a.anim.rot = Math.sin(t * Math.PI * 4) * 0.09 * (1 - t);
        },
        onComplete: () => {
          a.anim.rot = 0;
        },
      });
    });
    sceneRunner.after(2600, () => {
      const a = look();
      if (a === undefined) return;
      a.ceremony = false;
      a.suppressRebuild = false;
      a.pauseMs = 600;
    });
  }

  function syncActors(state: GameState): void {
    // Evolution outcome diff FIRST so the ceremony can suppress the
    // same-sync sprite-key rebuild (the swap happens at the flash peak).
    if (!evolveInit) {
      evolveInit = true;
      seenEvolveOutcome = state.lastEvolveOutcome;
    } else if (state.lastEvolveOutcome !== seenEvolveOutcome) {
      seenEvolveOutcome = state.lastEvolveOutcome;
      if (state.lastEvolveOutcome?.ok === true) {
        startCeremony(state.lastEvolveOutcome.pipId);
      }
    }

    const present = new Set<string>();
    for (const id of state.rosterOrder) {
      const pip = state.pips[id];
      if (pip === undefined) continue;
      if (pip.activity === PipActivity.OnExpedition) continue; // absent
      present.add(id);
      let actor = actors.get(id);
      if (actor === undefined) {
        const fromHatch = pendingHatchSpawn?.pipId === id;
        actor = createActor(pip);
        actors.set(id, actor);
        if (fromHatch) {
          const hello =
            pickLineFromPools(
              pip.personalityId,
              "beaming",
              undefined,
              jitter,
              dialoguePools,
            )?.text ?? "…hi. Hello! Hi.";
          actor.pauseMs = 4200; // stay put while saying hello
          showHelloBubble(actor, hello);
        }
      } else {
        actor.pip = pip;
        const key = actorSpriteKey(pip);
        if (key !== actor.spriteKey && !actor.suppressRebuild) {
          rebuildActorSprite(actor);
        } else {
          applyActivityLook(actor);
        }
      }
      actor.ring.visible = id === state.activePipId;
    }
    for (const [id, actor] of actors) {
      if (present.has(id)) continue;
      if (actor.visitor !== null) continue; // visitors are synced below
      actors.delete(id);
      destroyActor(actor);
    }
  }

  // -------------------------------------------------------------------------
  // ROUND 2K — VISITORS (docs/liveliness-bible.md §1.5)
  // -------------------------------------------------------------------------
  //
  // ⚠️ THIS SECTION IS THE DIFFERENCE BETWEEN THE FEATURE AND THE TENTH
  // DEAD FEATURE. `state.visitors[placementId]` is written by
  // `core/attractions` on every TICK and CATCHUP whether or not one line
  // of this file exists; spec §16 v1.3's standing rule — "written to
  // state" and "visible to the player" are SEPARATE acceptance criteria —
  // has been earned nine times, and a visitor nobody can see would have
  // earned it a tenth.
  //
  // A visitor is a full Actor: same `resolvePipSprite` rig, same jitter,
  // same accessory, same pattern, same shininess, same wander, same idle
  // set. That is deliberate — bible §1.5's "a real, individual, jittered,
  // accessorised Pip on sight". It differs ONLY in the four "not yours"
  // tells (no selection ring, lighter shadow, a drifting motif, a
  // different card on tap) and in walking in from, and back out to, the
  // screen edge.

  /** `state.visitors` key → its actor. Lives in the same `actors` map (so
   * it y-sorts, updates and taps identically) under a namespaced id that
   * can never collide with a real `pip-<n>`. */
  const VISITOR_ACTOR_PREFIX = "visitor:";

  /** Every catalogue item's `icon.motif` — the field bible §4.4 keys the
   * whole interaction table off, and which already exists on all 45
   * shipped items, so every FUTURE item inherits an interaction the
   * moment it is given an icon. */
  const ITEM_MOTIF: Readonly<Record<string, string>> = (() => {
    const out: Record<string, string> = {};
    for (const def of [...contentPlaceables, ...contentDecorations]) {
      out[def.id] = def.icon.motif;
    }
    return out;
  })();

  /** Attraction item id → the biome it draws from. Read structurally off
   * the SAME `attraction` effect core reads, so a content pass that adds
   * a seventh attraction needs no render change. */
  const ATTRACTION_BIOME: Readonly<Record<string, string>> = (() => {
    const out: Record<string, string> = {};
    for (const def of contentPlaceables) {
      const biomeId = attractionBiomeIdFor(def.id, { [def.id]: def });
      if (biomeId !== undefined) out[def.id] = biomeId;
    }
    return out;
  })();

  const isAttraction = (itemId: string): boolean => ATTRACTION_BIOME[itemId] !== undefined;

  /**
   * A `VisitorRecord` rendered as a Pip.
   *
   * `createPipFromGenome` is the SAME constructor `WELCOME_VISITOR` uses,
   * so what the player sees loitering by the Clover Ring is pixel-for-
   * pixel the Pip they get if they ask it to stay. Building it here
   * (rather than inventing a sprite-shaped object) is what makes that
   * promise structural: there is no second code path to drift.
   *
   * The id is namespaced so it can never collide with a roster `pip-<n>`
   * — `computeJitter` keys off the id, so a visitor's freckles are its
   * own and stay its own across every reload.
   */
  function visitorPip(placementId: string, record: VisitorRecord): PipState {
    return createPipFromGenome(record.genome, {
      id: `${VISITOR_ACTOR_PREFIX}${placementId}`,
      name: record.name,
      hatchedAt: record.arrivedAt,
      lifeStage: LifeStage.Adult,
    });
  }

  /** The point a visitor loiters around: its attraction's anchor. */
  function attractionAnchor(placementId: string, state: GameState): { x: number; y: number } | null {
    const placement = state.keep.placements[placementId];
    if (placement === undefined) return null;
    const anchor = footprintAnchor(
      layout,
      placement.x,
      placement.y,
      footprintOf(placement.itemId),
    );
    return { x: anchor.x, y: anchor.y };
  }

  /** The nearest screen edge to `pos` — where a visitor walks in from and
   * back out to (bible §1.5 items 1 and 4). */
  function edgePointNear(pos: { x: number; y: number }): { x: number; y: number } {
    const leftDist = pos.x;
    const rightDist = w - pos.x;
    const margin = layout.tileW * 1.5;
    return leftDist <= rightDist
      ? { x: -margin, y: pos.y }
      : { x: w + margin, y: pos.y };
  }

  /**
   * The drifting motif — the "not yours" tell that costs no persistent
   * object (bible §1.5 item 2). Three slow petals for a leaf motif, snow
   * motes for a snowflake, a faint glow for a lantern: keyed off the
   * ATTRACTION'S own icon, so what drifts around the visitor tells you
   * which thing drew it here.
   */
  function visitorMotifPuff(actor: Actor): void {
    const v = actor.visitor;
    if (v === null) return;
    const motif = ITEM_MOTIF[v.itemId] ?? "leaf";
    const colors =
      motif === "snowflake"
        ? ["#ffffff", "#e6f1ff"]
        : motif === "lantern" || motif === "flame" || motif === "spark"
          ? ["#ffe9a3", "#ffd479"]
          : motif === "shell" || motif === "droplet"
            ? ["#bfe6ef", "#e8f6fa"]
            : [...keepPalette.flowerPetals];
    const s = visualScale(actor);
    fxAbove.burst({
      x: actor.x + actor.facing * layout.tileW * 0.35,
      y: actor.y + actor.sprite.headTopY * s * 0.6,
      count: 3,
      shape: "dot",
      colors,
      speed: 16,
      directionRad: -Math.PI / 2,
      spreadRad: Math.PI * 0.9,
      gravity: -6,
      lifeMs: 1500,
      sizeMin: 2,
      sizeMax: 3.4,
    });
  }

  function createVisitorActor(
    placementId: string,
    record: VisitorRecord,
    state: GameState,
  ): Actor | null {
    const home = attractionAnchor(placementId, state);
    if (home === null) return null;
    const placement = state.keep.placements[placementId];
    if (placement === undefined) return null;

    const pip = visitorPip(placementId, record);
    // Spawn OFF-SCREEN at the nearest edge, then walk in. `createActor`
    // would otherwise drop it on a random free tile with a puff of dust,
    // which is the arrival of something that hatched, not of something
    // that came a long way.
    const entry = edgePointNear(home);
    const actor = createActor(pip, { x: entry.x, y: home.y });
    // Claim "roam" BEFORE the first `refreshMode` runs. Otherwise the
    // mode transition from "" to "roam" would null the walk-in target on
    // frame one and the visitor would materialise at the screen edge and
    // stroll off to a random tile instead of heading for the thing that
    // drew it here.
    actor.mode = "roam";
    actor.modeKey = "roam";
    actor.target = { x: home.x, y: home.y + layout.tileH * 0.6 };
    actor.pauseMs = 0;
    actor.visitor = {
      placementId,
      itemId: placement.itemId,
      home,
      leaving: false,
      trust: record.trust,
      motifInMs: 1200,
    };
    // The four "not yours" tells. The ring is the loudest one: the
    // selection ring means "this is the Pip you are caring for", and a
    // visitor is emphatically not that.
    actor.ring.visible = false;
    actor.sprite.shadow.alpha = 0.55;
    return actor;
  }

  /**
   * Reconcile the visitor actors against `state.visitors`.
   *
   * Presence is `visitorIsPresent(record, now)` — the SAME predicate core
   * uses, so the Pip standing in the Keep and the Visitor card's "are
   * they here" agree by construction rather than by two clocks that
   * mostly match. `state.lastTickAt` is the scene's "now": it is the
   * newest timestamp the reducer has stamped, it advances on every TICK,
   * and using it keeps the render free of any clock of its own (spec §2).
   */
  function syncVisitors(state: GameState): void {
    const records = state.visitors ?? {};
    const now = state.lastTickAt;
    const wanted = new Set<string>();

    for (const [placementId, record] of Object.entries(records)) {
      if (!visitorIsPresent(record, now)) continue;
      if (state.keep.placements[placementId] === undefined) continue;
      const actorId = `${VISITOR_ACTOR_PREFIX}${placementId}`;
      wanted.add(actorId);
      const existing = actors.get(actorId);
      if (existing === undefined) {
        const actor = createVisitorActor(placementId, record, state);
        if (actor !== null) actors.set(actorId, actor);
        continue;
      }
      const v = existing.visitor;
      if (v === null) continue;
      // A DIFFERENT visitor at the same attraction (the old one was
      // welcomed or the record was re-rolled): swap the whole sprite
      // rather than mutating a stranger into another stranger.
      if (existing.pip.name !== record.name || existing.pip.speciesId !== record.speciesId) {
        actors.delete(actorId);
        destroyActor(existing);
        const actor = createVisitorActor(placementId, record, state);
        if (actor !== null) actors.set(actorId, actor);
        continue;
      }
      v.trust = record.trust;
      const home = attractionAnchor(placementId, state);
      if (home !== null) v.home = home;
    }

    // Anyone still on screen whose visit has ended walks back off the
    // way they came. They are NOT snapped out of existence — leaving is
    // a beat, and it is the beat that makes "they were really here" true.
    for (const [id, actor] of actors) {
      const v = actor.visitor;
      if (v === null) continue;
      if (wanted.has(id)) continue;
      if (v.leaving) continue;
      v.leaving = true;
      actor.decorHoldMs = 0;
      actor.greetHoldMs = 0;
      actor.target = edgePointNear({ x: actor.x, y: actor.y });
      actor.pauseMs = 0;
    }
  }

  /** True while a welcome-ready visitor should carry its soft glow. */
  function visitorReadyToWelcome(actor: Actor): boolean {
    const v = actor.visitor;
    if (v === null || v.leaving) return false;
    return v.trust >= contentTuning.attractions.welcomeTrust;
  }

  // -------------------------------------------------------------------------
  // ROUND 2K — AMBIENT BEHAVIOUR (docs/liveliness-bible.md §4.3/§4.5)
  // -------------------------------------------------------------------------

  /**
   * One footprint in the snow: a single pooled ellipse that fades over
   * 400 ms. It goes into `world` at a depth below every standing thing,
   * so a Pip never walks BEHIND its own footprint.
   */
  function dropFootprint(actor: Actor): void {
    const s = visualScale(actor);
    const g = new Graphics()
      .ellipse(0, 0, 4.5 * s, 2.4 * s)
      .fill({ color: "#9fb4c4", alpha: 0.5 });
    g.position.set(actor.x + (jitter.next() - 0.5) * 6, actor.y + 2);
    g.zIndex = -99000;
    world.addChild(g);
    sceneRunner.add({
      durationMs: 2200,
      ease: linear,
      onUpdate: (t) => {
        if (!g.destroyed) g.alpha = 0.5 * (1 - t);
      },
      onComplete: () => {
        if (!g.destroyed) g.destroy();
      },
    });
  }

  /**
   * PIP ↔ PIP GREETINGS (bible §4.5) — the second-cheapest and
   * second-best thing in the round, and one of the two the cut order
   * says may NEVER be cut.
   *
   * Cost: C(n,2) squared-distance tests per frame — 15 at the spec §1
   * roster of 6 actors, and zero persistent objects (the emote rides the
   * existing pooled particle system; the line rides the existing speech
   * bubble).
   *
   * ⚠️ Cosmetic by contract, like the conga: no dispatch, no state write,
   * and nothing here reads a need or changes one.
   */
  const greetCooldowns = new Map<string, number>();

  function greetPairKey(a: Actor, b: Actor): string {
    return a.pip.id < b.pip.id ? `${a.pip.id}|${b.pip.id}` : `${b.pip.id}|${a.pip.id}`;
  }

  /** Mood → the emote a greeting Pip throws. Chaotic gets its own branch
   * at the call site (spec §4.2: "occasionally 'helps' wrong"). */
  const GREET_EMOTE: Readonly<Record<Mood, { colors: readonly string[]; shape: "dot" | "heart" }>> =
    {
      beaming: { colors: ["#ff9ec0", "#ffd0e0"], shape: "heart" },
      content: { colors: ["#ffe9a3", "#fff6d8"], shape: "dot" },
      grumpy: { colors: ["#c8c2b6", "#e2ddd3"], shape: "dot" },
      miserable: { colors: ["#9aa3ad"], shape: "dot" },
    };

  function playGreeting(a: Actor, b: Actor): void {
    // Stop and face each other — one x-flip each. This alone is most of
    // the read: two Pips squaring up is unmistakable at a glance.
    a.facing = b.x > a.x ? 1 : -1;
    b.facing = a.x > b.x ? 1 : -1;
    a.target = null;
    b.target = null;
    a.greetHoldMs = 1200;
    b.greetHoldMs = 1200;
    a.walkBob = 0;
    b.walkBob = 0;

    // One of the two emotes. Chaotic emits the WRONG one 20% of the time,
    // which is that personality's whole contract and funnier here than
    // anywhere else it currently fires.
    const speaker = jitter.chance(0.5) ? a : b;
    let mood = speaker.mood;
    if (
      speaker.pip.personalityId === "chaotic" &&
      jitter.chance(tuningAmbience.greetChaoticWrongEmoteChance)
    ) {
      mood = jitter.pick(["beaming", "content", "grumpy", "miserable"] as const);
    }
    const emote = GREET_EMOTE[mood];
    const s = visualScale(speaker);
    fxAbove.burst({
      x: speaker.x,
      y: speaker.y + speaker.sprite.headTopY * s - 6,
      count: emote.shape === "heart" ? 3 : 2,
      shape: emote.shape,
      colors: [...emote.colors],
      speed: 34,
      directionRad: -Math.PI / 2,
      spreadRad: Math.PI * 0.5,
      gravity: -14,
      lifeMs: 900,
      sizeMin: 3,
      sizeMax: 5,
    });

    // …and sometimes one of them actually says something.
    if (jitter.chance(tuningAmbience.greetSpeakChance)) {
      // Keyed by PERSONALITY only, not by mood: the mood already picked
      // the emote above, and a greeting is what this Pip is like, not how
      // its needs happen to be doing.
      const line = pickLineFromPools(
        speaker.pip.personalityId,
        "greeting",
        undefined,
        jitter,
        dialoguePools,
      );
      if (line !== null) {
        speaker.greetHoldMs = 2400;
        showHelloBubble(speaker, line.text);
      }
    }
    squashStretch(a.runner, a.sprite.rig, { amount: 0.12, cycleMs: 190, cycles: 2 });
    squashStretch(b.runner, b.sprite.rig, { amount: 0.12, cycleMs: 190, cycles: 2 });
  }

  /** One pass over the actor pairs. Called once per frame from `update`. */
  function updateGreetings(dtMs: number): void {
    // Age every cooldown first, and forget the expired ones so the map
    // cannot grow without bound across a long session.
    for (const [key, remaining] of greetCooldowns) {
      const next = remaining - dtMs;
      if (next <= 0) greetCooldowns.delete(key);
      else greetCooldowns.set(key, next);
    }

    const list = [...actors.values()].filter(
      (a) =>
        a.idleMs >= tuningAmbience.greetIdleMs &&
        a.greetHoldMs <= 0 &&
        a.decorHoldMs <= 0 &&
        !a.ceremony &&
        !a.parading &&
        a.careHoldMs <= 0 &&
        a.mode === "roam" &&
        a.visitor?.leaving !== true,
    );
    if (list.length < 2) return;
    const radius = tuningAmbience.greetRadiusTiles * layout.tileW;
    const r2 = radius * radius;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i] as Actor;
        const b = list[j] as Actor;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        if (dx * dx + dy * dy > r2) continue;
        const key = greetPairKey(a, b);
        if (greetCooldowns.has(key)) continue;
        greetCooldowns.set(key, tuningAmbience.greetCooldownMs);
        playGreeting(a, b);
        return; // one hello per frame — a crowd should not all pop at once
      }
    }
  }

  // -------------------------------------------------------------------------
  // Egg layer (Phase 4, spec §7.2) — re-homed onto grid tiles
  // -------------------------------------------------------------------------

  const EGG_SHELL_COLOR = "#f8f1e0";
  const EGG_SPECKLE_COLOR = "#cdbb95";
  const EGG_OUTLINE_COLOR = "#c9b892";
  const EGG_CRACK_COLOR = "#8f7f5f";

  interface EggVisual {
    readonly root: Container;
    readonly rig: Container;
    readonly ring: Graphics;
    readonly cracks: Graphics;
    readonly bang: Text;
    arrivalTween: TweenHandle | null;
    egg: Egg;
    slot: number;
    breathePhase: number;
    bangPhase: number;
    wobbleInMs: number;
    wobbleT: number;
    shakeT: number;
    lastRingProgress: number;
  }

  const eggVisuals = new Map<string, EggVisual>();

  /** Egg tap hit box in root-local px (before the eggScale). */
  const EGG_TAP_HALF_WIDTH = 30;
  const EGG_TAP_TOP = -70;
  const EGG_TAP_BOTTOM = 12;

  function eggSlotPos(slot: number): { x: number; y: number } {
    const tile = EGG_TILE_SLOTS[slot % EGG_TILE_SLOTS.length] ?? { x: 3, y: 3 };
    const center = tileCenter(layout, tile.x, tile.y);
    return { x: center.x, y: center.y + layout.tileH * 0.2 };
  }

  function drawEggShell(g: Graphics): void {
    g.ellipse(0, -18, 15, 20)
      .fill(EGG_SHELL_COLOR)
      .stroke({ width: 2.5, color: EGG_OUTLINE_COLOR, alpha: 0.6 });
    const speckles: readonly (readonly [number, number, number])[] = [
      [-6, -26, 1.8],
      [4, -30, 1.5],
      [8, -18, 2],
      [-8, -12, 1.5],
      [2, -8, 1.6],
      [-2, -20, 1.2],
    ];
    for (const [sx, sy, r] of speckles) {
      g.circle(sx, sy, r);
    }
    g.fill({ color: EGG_SPECKLE_COLOR, alpha: 0.85 });
    g.ellipse(-5, -24, 4.5, 7).fill({ color: 0xffffff, alpha: 0.3 });
  }

  function drawEggCracks(g: Graphics): void {
    g.moveTo(-10, -27)
      .lineTo(-5, -23)
      .lineTo(-1, -28)
      .lineTo(4, -23)
      .lineTo(9, -27)
      .stroke({ width: 2, color: EGG_CRACK_COLOR, alpha: 0.8, cap: "round" });
    g.moveTo(-3, -14)
      .lineTo(1, -11)
      .lineTo(5, -14)
      .stroke({ width: 1.6, color: EGG_CRACK_COLOR, alpha: 0.6, cap: "round" });
  }

  function redrawEggRing(v: EggVisual, progress: number): void {
    v.ring.clear();
    if (progress <= 0) return;
    v.ring
      .arc(0, -18, 26, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2)
      .stroke({ width: 3, color: 0x7cc283, alpha: 0.5, cap: "round" });
  }

  function applyEggLook(v: EggVisual): void {
    const pipping = v.egg.state === EggState.Pipping;
    v.cracks.visible = pipping;
    v.bang.visible = pipping;
    v.ring.visible = !pipping;
    v.root.cursor = pipping ? "pointer" : "default";
  }

  function createEggVisual(egg: Egg, slot: number): EggVisual {
    const root = new Container();
    const rig = new Container();

    const shadow = new Graphics()
      .ellipse(0, 2, 14, 5)
      .fill({ color: 0x3a4a3a, alpha: 0.12 });
    const ring = new Graphics();
    const shell = new Graphics();
    drawEggShell(shell);
    const cracks = new Graphics();
    drawEggCracks(cracks);
    const bang = new Text({
      text: "!",
      style: {
        fontFamily: "Arial, sans-serif",
        fontSize: 24,
        fontWeight: "800",
        fill: "#ff8a5c",
        stroke: { color: "#fffdf6", width: 4 },
      },
    });
    bang.anchor.set(0.5);
    bang.position.set(0, -54);

    rig.addChild(shell, cracks);
    root.addChild(shadow, ring, rig, bang);

    const v: EggVisual = {
      root,
      rig,
      ring,
      cracks,
      bang,
      egg,
      slot,
      breathePhase: jitter.next() * Math.PI * 2,
      bangPhase: jitter.next() * Math.PI * 2,
      wobbleInMs: 500 + jitter.int(900),
      wobbleT: -1,
      shakeT: -1,
      lastRingProgress: -1,
      arrivalTween: null,
    };

    const pos = eggSlotPos(slot);
    root.position.set(pos.x, pos.y);
    root.zIndex = pos.y;
    world.addChild(root);

    // Arrival pop (guarded + handle-tracked, as in Phase 4).
    const targetScale = eggScale();
    root.scale.set(0);
    v.arrivalTween = eggRunner.add({
      durationMs: 420,
      ease: easeOutBack,
      onUpdate: (t) => {
        if (!root.destroyed) root.scale.set(t * targetScale);
      },
      onComplete: () => {
        if (!root.destroyed) root.scale.set(targetScale);
      },
    });

    applyEggLook(v);
    return v;
  }

  function destroyEggVisual(v: EggVisual): void {
    v.arrivalTween?.cancel();
    v.arrivalTween = null;
    v.root.removeFromParent();
    v.root.destroy({ children: true });
  }

  /** Little Pixi speech bubble for a newborn's hello line. */
  function buildHelloBubble(text: string): Container {
    const bubble = new Container();
    const label = new Text({
      text,
      style: {
        fontFamily:
          "-apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
        fontSize: 13,
        fontWeight: "600",
        fill: "#3d4a3d",
        wordWrap: true,
        wordWrapWidth: 168,
        align: "center",
      },
    });
    label.anchor.set(0.5, 1);
    const bw = label.width + 22;
    const bh = label.height + 16;
    const g = new Graphics()
      .roundRect(-bw / 2, -bh - 8, bw, bh, 11)
      .fill("#ffffff")
      .stroke({ width: 2, color: 0x5f8a5e, alpha: 0.35 });
    g.poly([-6, -9, 6, -9, 0, 0]).fill("#ffffff");
    label.position.set(0, -16);
    bubble.addChild(g, label);
    return bubble;
  }

  /** lastTickAt from the most recent sync + frame time accrued since —
   * the scene's clockless "now" for the incubation progress ring. */
  let syncedTickAt = 0;
  let sinceSyncMs = 0;
  let eggSeenInit = false;
  let seenHatchOutcome: HatchOutcome | null = null;

  /** The hatch moment (spec §7.2 — always player-witnessed): shell pop,
   * confetti, and the newborn's REAL wandering actor spawning right at
   * the shell's tile (syncActors runs after this and picks it up). */
  function celebrateHatch(v: EggVisual, newborn: PipState): void {
    const x = v.root.position.x;
    const y = v.root.position.y;
    destroyEggVisual(v);
    eggVisuals.delete(v.egg.id);

    sound("egg.hatch");
    fxAbove.burst({
      x,
      y: y - 18,
      count: 14,
      shape: "crumb",
      colors: [EGG_SHELL_COLOR, EGG_SPECKLE_COLOR],
      speed: 190,
      gravity: 430,
      lifeMs: 760,
      sizeMin: 2.5,
      sizeMax: 4.5,
    });
    fxAbove.burst({
      x,
      y: y - 22,
      count: 22,
      shape: "dot",
      colors: [...keepPalette.flowerPetals, "#ffffff", "#7cc283"],
      speed: 210,
      directionRad: -Math.PI / 2,
      spreadRad: Math.PI * 1.3,
      gravity: 320,
      lifeMs: 950,
    });
    fxAbove.burst({
      x,
      y: y - 26,
      count: 8,
      shape: "sparkle",
      colors: ["#ffffff", "#fdf3c0", "#f9d47d"],
      speed: 60,
      gravity: -20,
      lifeMs: 800,
      sizeMin: 2.5,
      sizeMax: 4.5,
    });

    // Iridescent newborn: the shell dust settles and… wait. A second,
    // unmistakably pastel sparkle wave (the toast asks about glitter —
    // this is the glitter). Sound slot per spec §12's no-op seam.
    if (newborn.genome.shiny) {
      sound("egg.hatchShiny");
      fxAbove.burst({
        x,
        y: y - 30,
        count: 18,
        shape: "sparkle",
        colors: ["#ffffff", "#ffd9ec", "#d3f4e2", "#dbe4ff"],
        speed: 95,
        directionRad: -Math.PI / 2,
        spreadRad: Math.PI * 1.6,
        gravity: -8,
        lifeMs: 1200,
        sizeMin: 2.5,
        sizeMax: 5,
      });
    }

    pendingHatchSpawn = { pipId: newborn.id, x, y };
  }

  function startEggShake(v: EggVisual): void {
    sound("egg.snug");
    v.shakeT = 0;
  }

  /** Diff `state.eggs` + `lastHatchOutcome` (called from sync). */
  function syncEggs(state: GameState): void {
    if (!eggSeenInit) {
      eggSeenInit = true;
      seenHatchOutcome = state.lastHatchOutcome;
    } else if (state.lastHatchOutcome !== seenHatchOutcome) {
      const outcome = state.lastHatchOutcome;
      seenHatchOutcome = outcome;
      if (outcome !== null) {
        const v = eggVisuals.get(outcome.eggId);
        if (outcome.ok) {
          const newborn = state.pips[outcome.pipId];
          if (v !== undefined && newborn !== undefined) {
            celebrateHatch(v, newborn);
          }
        } else if (outcome.reason === "rosterFull" && v !== undefined) {
          startEggShake(v);
        }
      }
    }

    const present = new Set<string>();
    state.eggs.forEach((egg, index) => {
      present.add(egg.id);
      const existing = eggVisuals.get(egg.id);
      if (existing === undefined) {
        eggVisuals.set(egg.id, createEggVisual(egg, index));
        return;
      }
      const stateChanged = existing.egg.state !== egg.state;
      existing.egg = egg;
      if (existing.slot !== index) {
        existing.slot = index;
        const pos = eggSlotPos(index);
        existing.root.position.set(pos.x, pos.y);
        existing.root.zIndex = pos.y;
      }
      if (stateChanged) {
        applyEggLook(existing);
        if (egg.state === EggState.Pipping) {
          sound("egg.crack");
          existing.wobbleT = 0;
          fxAbove.burst({
            x: existing.root.position.x,
            y: existing.root.position.y - 30,
            count: 5,
            shape: "crumb",
            colors: [EGG_SHELL_COLOR, EGG_SPECKLE_COLOR],
            speed: 70,
            gravity: 300,
            lifeMs: 600,
            sizeMin: 1.5,
            sizeMax: 3,
          });
        }
      }
    });
    for (const [id, v] of eggVisuals) {
      if (!present.has(id)) {
        destroyEggVisual(v);
        eggVisuals.delete(id);
      }
    }

    syncedTickAt = state.lastTickAt;
    sinceSyncMs = 0;
  }

  /** Per-frame egg animation (called from update). */
  function updateEggs(dtMs: number): void {
    eggRunner.update(dtMs);
    sinceSyncMs += dtMs;
    const approxNow = syncedTickAt + sinceSyncMs;

    for (const v of eggVisuals.values()) {
      const incubating = v.egg.state === EggState.Incubating;
      const pipping = v.egg.state === EggState.Pipping;

      if (incubating) {
        v.breathePhase += (dtMs / 1000) * 2.1;
        const breathe = Math.sin(v.breathePhase);
        v.rig.scale.y = 1 + breathe * 0.025;
        v.rig.scale.x = 1 - breathe * 0.016;

        const started = v.egg.incubationStartedAt;
        if (started !== null && v.egg.incubationMs > 0) {
          const progress = Math.min(
            1,
            Math.max(0, (approxNow - started) / v.egg.incubationMs),
          );
          if (Math.abs(progress - v.lastRingProgress) > 0.004) {
            v.lastRingProgress = progress;
            redrawEggRing(v, progress);
          }
        }
      } else {
        v.rig.scale.set(1, 1);
      }

      if (pipping) {
        v.bangPhase += (dtMs / 1000) * 4.2;
        v.bang.position.y = -54 + Math.sin(v.bangPhase) * 3.5;
        const pulse = 1 + Math.sin(v.bangPhase * 1.5) * 0.08;
        v.bang.scale.set(pulse);

        if (v.wobbleT < 0 && v.shakeT < 0) {
          v.wobbleInMs -= dtMs;
          if (v.wobbleInMs <= 0) {
            v.wobbleInMs = 900 + jitter.int(1400);
            v.wobbleT = 0;
            fxAbove.burst({
              x: v.root.position.x + (jitter.next() - 0.5) * 10,
              y: v.root.position.y - 32,
              count: 2,
              shape: "crumb",
              colors: [EGG_SHELL_COLOR, EGG_SPECKLE_COLOR],
              speed: 55,
              gravity: 280,
              lifeMs: 520,
              sizeMin: 1.2,
              sizeMax: 2.4,
            });
          }
        }
      }

      if (v.wobbleT >= 0) {
        v.wobbleT += dtMs;
        const t = v.wobbleT / 640;
        if (t >= 1) {
          v.wobbleT = -1;
          v.rig.rotation = 0;
        } else {
          v.rig.rotation = Math.sin(t * Math.PI * 5) * 0.14 * (1 - t);
        }
      }

      if (v.shakeT >= 0) {
        v.shakeT += dtMs;
        const t = v.shakeT / 560;
        if (t >= 1) {
          v.shakeT = -1;
          v.rig.rotation = 0;
        } else {
          v.rig.rotation = Math.sin(t * Math.PI * 7) * 0.055 * (1 - t);
        }
      }
    }
  }

  function repositionEggs(): void {
    const scale = eggScale();
    for (const v of eggVisuals.values()) {
      const pos = eggSlotPos(v.slot);
      v.root.position.set(pos.x, pos.y);
      v.root.zIndex = pos.y;
      if (v.arrivalTween === null || v.arrivalTween.done) {
        v.root.scale.set(scale);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Placement mode (spec §9 tap-to-place — the UI's render hook)
  // -------------------------------------------------------------------------

  interface PlacementModeState {
    readonly itemId: string;
    readonly onPlaced: (x: number, y: number) => void;
    readonly movePlacementId: string | undefined;
    readonly ghost: Container;
    readonly highlight: Graphics;
    readonly item: PlaceableSprite;
    tile: { x: number; y: number } | null;
    valid: boolean;
  }

  let placementMode: PlacementModeState | null = null;

  function updateGhost(mode: PlacementModeState, worldX: number, worldY: number): void {
    const fp = footprintOf(mode.itemId);
    const tile = snapFootprint(layout, worldX, worldY, fp);
    mode.tile = tile;
    if (tile === null) {
      mode.ghost.visible = false;
      mode.valid = false;
      return;
    }
    mode.ghost.visible = true;

    let valid = false;
    if (lastState !== null) {
      const result =
        mode.movePlacementId !== undefined
          ? moveItem(lastState.keep, mode.movePlacementId, tile.x, tile.y)
          : placeItem(lastState.keep, "__ghost__", mode.itemId, tile.x, tile.y);
      valid = result.ok;
    }
    mode.valid = valid;

    // Footprint highlight in world coords.
    const px = layout.originX + tile.x * layout.tileW;
    const py = layout.originY + tile.y * layout.tileH;
    mode.highlight
      .clear()
      .roundRect(px, py, fp.w * layout.tileW, fp.h * layout.tileH, layout.tileW * 0.12)
      .fill({ color: valid ? 0x7cc283 : 0xe06060, alpha: 0.34 })
      .stroke({ width: 2.5, color: valid ? 0x4f9e58 : 0xc24848, alpha: 0.85 });

    const anchor = footprintAnchor(layout, tile.x, tile.y, fp);
    mode.item.view.position.set(anchor.x, anchor.y);
    mode.item.view.alpha = 0.8;
    mode.item.view.tint = valid ? 0xffffff : 0xffb0a8;
  }

  function enterPlacementMode(
    itemId: string,
    onPlaced: (x: number, y: number) => void,
    opts?: { movePlacementId?: string },
  ): void {
    exitPlacementMode();
    gridOverlay.visible = true;

    const ghost = new Container();
    const highlight = new Graphics();
    const item = resolvePlaceableSprite(
      itemId,
      footprintOf(itemId),
      layout.tileW,
      layout.tileH,
    );
    ghost.addChild(highlight, item.view);
    ghostLayer.addChild(ghost);

    const mode: PlacementModeState = {
      itemId,
      onPlaced,
      movePlacementId: opts?.movePlacementId,
      ghost,
      highlight,
      item,
      tile: null,
      valid: false,
    };
    placementMode = mode;

    // Start snapped to the grid center (or the moved item's spot).
    const moving =
      opts?.movePlacementId !== undefined
        ? lastState?.keep.placements[opts.movePlacementId]
        : undefined;
    const start =
      moving !== undefined
        ? footprintAnchor(layout, moving.x, moving.y, footprintOf(itemId))
        : tileCenter(layout, Math.floor(layout.cols / 2), Math.floor(layout.rows / 2));
    updateGhost(mode, start.x, start.y);
    sound("place.enter");
  }

  function exitPlacementMode(): void {
    if (placementMode !== null) {
      placementMode.item.destroy();
      placementMode.ghost.removeFromParent();
      placementMode.ghost.destroy({ children: true });
      placementMode = null;
    }
    gridOverlay.visible = false;
  }

  // -------------------------------------------------------------------------
  // Pointer routing — placement first, then eggs, then pips
  // -------------------------------------------------------------------------

  function handleEggTap(v: EggVisual): void {
    if (v.egg.state === EggState.Pipping) {
      sound("egg.tap");
      emitEggTap(v.egg.id);
    } else if (v.wobbleT < 0 && v.shakeT < 0) {
      v.wobbleT = 0; // shy jiggle — not ready, appreciates the attention
    }
  }

  view.eventMode = "static";
  view.hitArea = new Rectangle(-1e6, -1e6, 2e6, 2e6);

  view.on("pointertap", (event) => {
    const g = event.global;

    if (placementMode !== null) {
      const mode = placementMode;
      updateGhost(mode, g.x, g.y);
      if (mode.valid && mode.tile !== null) {
        sound("place.confirm");
        mode.onPlaced(mode.tile.x, mode.tile.y);
      }
      return;
    }

    // ROUND 2J FIX STAGE — a placed Craft Table opens the recipe book.
    // Checked BEFORE eggs and pips because a bench is a big, deliberate
    // target and the two never overlap in practice (a station blocks its
    // own tiles, so nothing else stands there). Manual hit-testing against
    // the sprite's own anchor, the same technique the egg loop below uses.
    for (const [pid, v] of placeableVisuals) {
      if (!CRAFTING_STATION_ITEM_IDS.has(v.itemId)) continue;
      const fp = footprintOf(v.itemId);
      const halfW = (layout.tileW * fp.w) / 2;
      const dx = g.x - v.sprite.view.position.x;
      const dy = g.y - v.sprite.view.position.y;
      if (dx >= -halfW && dx <= halfW && dy >= -layout.tileH * 1.4 && dy <= layout.tileH * 0.25) {
        sound("ui.tap");
        emitCraftTableTap(pid);
        return;
      }
    }

    // Eggs first (small targets under big pips). Manual hit-testing
    // against known root positions — see Phase 4 note on Pixi v8 lazy
    // world transforms.
    const es = eggScale();
    for (const v of eggVisuals.values()) {
      const dx = g.x - v.root.position.x;
      const dy = g.y - v.root.position.y;
      if (
        dx >= -EGG_TAP_HALF_WIDTH * es &&
        dx <= EGG_TAP_HALF_WIDTH * es &&
        dy >= EGG_TAP_TOP * es &&
        dy <= EGG_TAP_BOTTOM * es
      ) {
        handleEggTap(v);
        return;
      }
    }

    // Pips: frontmost (largest depth y) hit wins.
    let best: Actor | null = null;
    for (const actor of actors.values()) {
      const s = visualScale(actor);
      const dx = g.x - actor.x;
      const dy = g.y - actor.y;
      if (
        Math.abs(dx) <= PIP_BODY_WIDTH * 0.58 * s &&
        dy >= (actor.sprite.headTopY - 16) * s &&
        dy <= 10
      ) {
        if (best === null || actor.y > best.y) best = actor;
      }
    }
    if (best !== null) {
      sound("pip.tap");
      // ROUND 2K — a visitor is NOT your Pip: it has no needs, no job and
      // no expedition, so its tap goes out through its own seam to the
      // Visitor card, never to the focus view (bible §1.5). Routing this
      // here — at the ONE place a tap becomes an identity — is what makes
      // that separation structural rather than a branch the focus view
      // has to remember to make.
      const visitorTapped = best.visitor;
      if (visitorTapped !== null) {
        emitVisitorTap(visitorTapped.placementId);
      } else {
        emitPipTap(best.pip.id);
      }
    }
  });

  view.on("globalpointermove", (event) => {
    if (placementMode === null) return;
    updateGhost(placementMode, event.global.x, event.global.y);
  });

  // -------------------------------------------------------------------------
  // Layout plumbing
  // -------------------------------------------------------------------------

  function relayout(): void {
    const old = layout;
    const level = lastState?.keep.level ?? 1;
    const bounds = gridBounds(level);
    bottomInset = measureBottomChrome(h);
    layout = computeGridLayout(w, h, bounds.cols, bounds.rows, {
      bottomInsetPx: bottomInset,
    });
    drawBackground();
    drawGridOverlay();
    drawFlash();
    flashG.alpha = 0;
    // ROUND 2K — the daylight tint covers the whole viewport (drawn
    // white; `tint` does the colouring, so this geometry never needs to
    // be redrawn for a colour change) and the ambient layer re-seeds its
    // flitters for the new box.
    daylightOverlay.clear().rect(0, 0, w, h).fill(0xffffff);
    // ⚠️ FIX STAGE — the ambient layer is bounded to the PLOT, not to the
    // viewport. At 1440×900 the Keep occupies about 28% of the width with
    // flat undifferentiated green either side, and handing ambience the
    // whole canvas put grass tufts and rain streaks out in that dead
    // margin — level with, and immediately beside, the Feed/Clean/Play
    // buttons. The round's stated goal is that the Keep stops looking like
    // a diorama, and animating the empty space around it is precisely what
    // makes it read as one.
    //
    // The padding collapses to zero when the plot already fills the
    // screen, so at 375px (where the composition was fine) this is a
    // no-op and the ambience still lands inside the scene.
    const plotW = layout.cols * layout.tileW;
    const pad = Math.max(0, Math.min(plotW * 0.25, (w - plotW) / 2));
    const boxLeft = Math.max(0, layout.originX - pad);
    ambience.view.x = boxLeft;
    ambience.resize({
      width: Math.min(w - boxLeft, plotW + pad * 2),
      height: h,
      groundTop: layout.originY,
    });

    for (const [pid, v] of placeableVisuals) {
      // Tile size may have changed — rebuild the drawing at the new size.
      const wasAt = { itemId: v.itemId, x: v.x, y: v.y };
      v.sprite.destroy();
      const next = resolvePlaceableSprite(
        wasAt.itemId,
        footprintOf(wasAt.itemId),
        layout.tileW,
        layout.tileH,
      );
      // PlaceableVisual.sprite is readonly by shape; rebuild via Map set.
      placeableVisuals.set(pid, {
        sprite: next,
        seq: v.seq,
        itemId: wasAt.itemId,
        x: wasAt.x,
        y: wasAt.y,
        dropTween: null,
        // The ring belonged to the destroyed sprite; the next `sync`
        // redraws it from state on the new one. Same for round 2K's
        // stock ring; the lantern glow is rebuilt by the next
        // `setDaylight` sample, at most a second later.
        craftRing: null,
        lanternGlow: null,
        stockRing: null,
      });
      world.addChild(next.view);
      const rebuilt = placeableVisuals.get(pid);
      if (rebuilt !== undefined) positionPlaceable(rebuilt);
    }

    repositionEggs();

    for (const actor of actors.values()) {
      // Keep each pip on "the same tile" across the transform.
      const tile = {
        x: Math.min(
          layout.cols - 1,
          Math.max(0, Math.floor((actor.x - old.originX) / old.tileW)),
        ),
        y: Math.min(
          layout.rows - 1,
          Math.max(0, Math.floor((actor.y - old.originY) / old.tileH)),
        ),
      };
      const pos = tileCenter(layout, tile.x, tile.y);
      actor.x = pos.x;
      actor.y = pos.y;
      actor.target = null;
      actor.seated = false;
      actor.modeKey = ""; // re-derive destinations at the new scale
      if (!actor.ceremony) {
        applyActorScale(actor);
        drawActorRing(actor);
        drawActorGlow(actor);
      }
    }

    // Ghost sizes are tile-relative — rebuild placement mode in place.
    if (placementMode !== null) {
      const { itemId, onPlaced, movePlacementId } = placementMode;
      enterPlacementMode(itemId, onPlaced, { ...(movePlacementId !== undefined ? { movePlacementId } : {}) });
    }
  }

  drawBackground();
  drawGridOverlay();
  gridOverlay.visible = false;
  drawFlash();
  // ROUND 2K — the tint geometry, once. Until `setDaylight` lands (1 s
  // after boot at the latest) `alpha` is 0, so an un-wired scene renders
  // exactly what shipped before this round.
  daylightOverlay.clear().rect(0, 0, w, h).fill(0xffffff);

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  return {
    view,

    sync(state: GameState): void {
      const levelBounds = gridBounds(state.keep.level);
      const needsRelayout =
        levelBounds.cols !== layout.cols || levelBounds.rows !== layout.rows;
      lastState = state;
      if (needsRelayout) relayout();

      syncPlaceables(state); // occupancy before actors pick targets
      syncEggs(state); // may queue a pendingHatchSpawn for syncActors
      syncActors(state);
      // ROUND 2K — visitors AFTER the roster, so a welcome (which deletes
      // the record and adds a roster Pip in the same dispatch) has
      // already spawned the newcomer's real actor before the visitor
      // actor is asked to leave.
      syncVisitors(state);
    },

    update(dtMs: number): void {
      sceneRunner.update(dtMs);
      fxAbove.update(dtMs);
      updateEggs(dtMs);
      const state = lastState;
      if (state === null) return;
      // Queued conga starts only once every care animation and ceremony
      // has finished (queue after — never interrupt a moment mid-flight).
      if (paradeQueued && parade === null) {
        const busy = [...actors.values()].some(
          (a) => a.ceremony || a.careHoldMs > 0,
        );
        if (actors.size === 0) {
          paradeQueued = false; // nobody home — quietly forget it
        } else if (!busy) {
          startParade();
        }
      }
      updateParade(dtMs);
      for (const actor of actors.values()) {
        updateActor(actor, dtMs, state);
      }
      // ROUND 2K — ambience last, so greetings see this frame's positions
      // and the flitters draw over everything that just moved.
      updateGreetings(dtMs);
      ambience.update(dtMs);
    },

    setDaylight(sample: DaylightSample): void {
      daylight = sample;
      // The full-screen tint is free to update every sample: two property
      // writes on one Graphics.
      daylightOverlay.tint = sample.overlayColor;
      daylightOverlay.alpha = sample.overlayAlpha;
      ambience.setPhase(sample.phase);
      syncLanternGlow();
      // `drawBackground` is a teardown-and-rebuild of the whole
      // background container, so it fires ONLY when the sky has actually
      // moved past the epsilon — ~94 times a day at the 1 Hz sample rate,
      // measured in `daylight.test.ts`, not once a second and never per
      // frame.
      if (daylightChangedEnough(paintedDaylight, sample)) {
        paintedDaylight = sample;
        drawBackground();
      }
    },

    setWeather(sample: WeatherSample): void {
      const changed = weather === null || weather.window !== sample.window;
      weather = sample;
      ambience.setWeather(sample);
      // Overcast desaturates the sky, which lives in the background —
      // so a window that changes the sky's look needs the same redraw
      // the daylight ramp takes.
      if (changed) {
        paintedDaylight = daylight;
        drawBackground();
      }
    },

    playCareOutcome(outcome: CareOutcome, consumedItemId?: string): void {
      const actor = actors.get(outcome.pipId);
      if (actor === undefined || actor.ceremony) return;
      const rig = actor.sprite.rig;
      const s = visualScale(actor);
      const ax = actor.x;
      const ay = actor.y;
      const mouthWorld = { x: ax, y: ay - PIP_BODY_HEIGHT * 0.42 * s };
      const headY = ay + actor.sprite.headTopY * s;
      const runner = actor.runner;

      // Hold the amble so the moment lands where the player is looking.
      actor.careHoldMs = 1500;
      actor.target = null;
      actor.walkBob = 0;
      actor.anim.rot = 0;

      if (!outcome.applied) {
        if (!VOICED_REFUSALS.has(outcome.refusalReason ?? "")) return;
        sound("care.refuse");
        runner.add({
          durationMs: 480,
          ease: linear,
          onUpdate: (t) => {
            actor.anim.x = Math.sin(t * Math.PI * 5) * 7 * (1 - t);
          },
          onComplete: () => {
            actor.anim.x = 0;
          },
        });
        return;
      }

      switch (outcome.action) {
        case "feed":
        case "giveItem": {
          const isGift = outcome.action === "giveItem";
          sound(isGift ? "care.give" : "care.feed");
          const color = itemColors[consumedItemId ?? ""] ?? itemFallbackColor;
          const morsel = new Graphics().circle(0, 0, 9 * Math.max(0.7, s)).fill(color);
          morsel.circle(2, -9 * Math.max(0.7, s), 3).fill(keepPalette.tuft);
          const from = { x: ax - 120 * Math.max(0.7, s), y: mouthWorld.y - 70 * s };
          fxAbove.view.addChild(morsel);
          morsel.position.set(from.x, from.y);
          runner.sequence([
            {
              durationMs: 430,
              ease: linear,
              onUpdate: (t) => {
                morsel.x = from.x + (mouthWorld.x - from.x) * t;
                morsel.y =
                  from.y +
                  (mouthWorld.y - from.y) * t -
                  Math.sin(Math.PI * t) * 64 * Math.max(0.7, s);
                morsel.rotation = t * 4;
              },
              onComplete: () => {
                morsel.removeFromParent();
                morsel.destroy();
                squashStretch(runner, rig, {
                  amount: 0.14,
                  cycleMs: 150,
                  cycles: 3,
                });
                fxAbove.burst({
                  x: mouthWorld.x,
                  y: mouthWorld.y + 6,
                  count: isGift ? 6 : 9,
                  shape: isGift ? "heart" : "crumb",
                  colors: isGift ? ["#f27d9d", color] : [color, "#e8d9b0"],
                  speed: 85,
                  directionRad: Math.PI / 2,
                  spreadRad: Math.PI * 1.2,
                  gravity: 260,
                  lifeMs: 620,
                });
              },
            },
          ]);
          break;
        }

        case "clean": {
          sound("care.clean");
          const sweepY = ay - PIP_BODY_HEIGHT * 0.6 * s;
          for (let i = 0; i < 4; i++) {
            runner.after(i * 110, () => {
              fxAbove.burst({
                x: ax + (-46 + i * 30) * s,
                y: sweepY + (i % 2 === 0 ? -14 : 10) * s,
                count: 5,
                shape: "sparkle",
                colors: ["#ffffff", "#bfe9f5", "#fdf3c0"],
                speed: 34,
                gravity: -22,
                lifeMs: 560,
                sizeMin: 2.5,
                sizeMax: 4.5,
              });
            });
          }
          runner.add({
            delayMs: 380,
            durationMs: 300,
            ease: easeOutBack,
            onUpdate: (t) => {
              const sc = 1 + 0.06 * t;
              rig.scale.x = sc;
              rig.scale.y = sc;
            },
            onComplete: () => rig.scale.set(1, 1),
          });
          break;
        }

        case "play": {
          sound("care.play");
          const jump = 74 * Math.max(0.6, s);
          runner.sequence([
            {
              durationMs: 280,
              ease: easeOut,
              onUpdate: (t) => {
                actor.anim.y = -jump * t;
              },
            },
            {
              durationMs: 250,
              ease: easeIn,
              onUpdate: (t) => {
                actor.anim.y = -jump * (1 - t);
              },
              onComplete: () => {
                actor.anim.y = 0;
                squashStretch(runner, rig, { amount: 0.2, cycleMs: 200 });
                fxAbove.burst({
                  x: ax,
                  y: ay - 8,
                  count: 14,
                  shape: "dot",
                  colors: [...keepPalette.flowerPetals, "#ffffff"],
                  speed: 150,
                  directionRad: -Math.PI / 2,
                  spreadRad: Math.PI * 0.9,
                  gravity: 330,
                  lifeMs: 700,
                });
              },
            },
          ]);
          runner.add({
            durationMs: 530,
            ease: easeInOut,
            onUpdate: (t) => {
              const c = Math.cos(t * Math.PI * 2);
              rig.scale.x = Math.sign(c) * Math.max(0.16, Math.abs(c));
            },
            onComplete: () => {
              rig.scale.x = 1;
            },
          });
          break;
        }

        case "pet": {
          sound("care.pet");
          runner.sequence([
            {
              durationMs: 240,
              ease: easeOut,
              onUpdate: (t) => {
                actor.anim.rot = 0.13 * t;
                actor.anim.y = -4 * t;
              },
              onComplete: () => {
                fxAbove.burst({
                  x: ax + 20 * s,
                  y: headY,
                  count: 5,
                  shape: "heart",
                  colors: ["#f27d9d", "#f6a8b8", "#e0607e"],
                  speed: 52,
                  directionRad: -Math.PI / 2,
                  spreadRad: Math.PI * 0.7,
                  gravity: -26,
                  lifeMs: 900,
                  sizeMin: 3,
                  sizeMax: 5,
                });
              },
            },
            { durationMs: 320, onUpdate: () => {} },
            {
              durationMs: 300,
              ease: easeInOut,
              onUpdate: (t) => {
                actor.anim.rot = 0.13 * (1 - t);
                actor.anim.y = -4 * (1 - t);
              },
              onComplete: () => {
                actor.anim.rot = 0;
                actor.anim.y = 0;
              },
            },
          ]);
          break;
        }

        case "restToggle": {
          const nowResting = actor.pip.activity === PipActivity.Resting;
          sound(nowResting ? "care.rest" : "care.wake");
          if (nowResting) {
            runner.sequence([
              {
                durationMs: 430,
                ease: easeInOut,
                onUpdate: (t) => {
                  rig.scale.y = 1 - 0.15 * Math.sin(Math.PI * t);
                  rig.scale.x = 1 + 0.1 * Math.sin(Math.PI * t);
                },
                onComplete: () => rig.scale.set(1, 1),
              },
            ]);
          } else {
            runner.sequence([
              {
                durationMs: 340,
                ease: easeOutBack,
                onUpdate: (t) => {
                  rig.scale.y = 1 + 0.12 * t;
                  rig.scale.x = 1 - 0.07 * t;
                },
              },
              {
                durationMs: 240,
                ease: easeOut,
                onUpdate: (t) => {
                  rig.scale.y = 1.12 - 0.12 * t;
                  rig.scale.x = 0.93 + 0.07 * t;
                },
                onComplete: () => rig.scale.set(1, 1),
              },
            ]);
          }
          break;
        }

        default:
          break;
      }
    },

    resize(nextWidth: number, nextHeight: number): void {
      w = nextWidth;
      h = nextHeight;
      relayout();
    },

    getBubbleAnchor(): { x: number; y: number } {
      const actor =
        lastState !== null ? actors.get(lastState.activePipId) : undefined;
      if (actor === undefined) {
        return { x: w / 2, y: h * 0.5 };
      }
      const s = visualScale(actor);
      return { x: actor.x, y: actor.y + actor.sprite.headTopY * s - 14 };
    },

    enterPlacementMode,
    exitPlacementMode,

    playParade(): void {
      if (parade !== null || paradeQueued) return; // one at a time
      paradeQueued = true;
    },
  };
}
