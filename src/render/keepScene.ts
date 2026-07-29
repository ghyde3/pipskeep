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
  const fxAbove = new ParticleSystem(jitter);
  /** Evolution white-out. */
  const flashG = new Graphics();
  flashG.alpha = 0;
  view.addChild(background, gridOverlay, world, ghostLayer, fxAbove.view, flashG);

  /** Scene-wide tweens (flash, ceremony timeline, placeable drops) —
   * never cleared by actor sprite rebuilds. */
  const sceneRunner = new TweenRunner();
  /** Egg tweens — separate runner, mirroring Phase 4's isolation. */
  const eggRunner = new TweenRunner();

  let w = width;
  let h = height;
  let lastState: GameState | null = null;
  let layout: GridLayout = computeGridLayout(w, h, 8, 8);
  let blockedTiles: ReadonlySet<string> = new Set();
  /** Depth tiebreak counter (stable y-sorting via creation order). */
  let seqCounter = 0;

  const pipScale = (): number =>
    Math.min(0.92, Math.max(0.34, (layout.tileW * 1.35) / PIP_BODY_WIDTH));
  const eggScale = (): number =>
    Math.min(1.1, Math.max(0.6, layout.tileW / 60));

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
    // Sky: soft pastel bands above the meadow.
    g.rect(0, 0, w, gridTop * 0.55).fill(keepPalette.skyTop);
    g.rect(0, gridTop * 0.55, w, gridTop * 0.3).fill("#dff0ef");
    g.rect(0, gridTop * 0.85, w, h - gridTop * 0.85).fill(keepPalette.skyBottom);
    // Sun glow.
    g.circle(w * 0.78, gridTop * 0.34, Math.min(w, h) * 0.12).fill({
      color: keepPalette.sunGlow,
      alpha: 0.7,
    });
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
  }

  const placeableVisuals = new Map<string, PlaceableVisual>();
  let placeablesInit = false;

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

  /** Resolve with the LIVE species (evolution changes it, spec §4.6);
   * genome stays the immutable birth record for palette/pattern — UNLESS
   * the Pip has evolved with a gift-selected variant (`pip.evolved.
   * variantId`, content-bible §8.2.2), in which case that variant id
   * stands in for the palette lookup key (spriteResolver.ts's optional
   * third param). Without this, every evolution gift variant authored in
   * content/palette.ts is dead: `applyEvolution` writes `variantId` and
   * nothing ever read it back. */
  function resolveActorSprite(pip: PipState): PipSprite {
    return resolvePipSprite(
      { ...pip.genome, speciesId: pip.speciesId },
      pip.lifeStage,
      pip.evolved?.variantId,
    );
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

  function actorSpriteKey(pip: PipState): string {
    // `variantId` joins the key (content-bible §8.2.2): two Pips of the
    // same evolved species that were fed different gift items must NOT
    // share a cached sprite just because species/palette/pattern match.
    return `${pip.id}|${pip.lifeStage}|${pip.speciesId}|${pip.genome.palette}|${pip.genome.pattern}|${pip.evolved?.variantId ?? ""}`;
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

  function createActor(pip: PipState): Actor {
    const root = new Container();
    const ring = new Graphics();
    ring.visible = false;
    const glow = new Graphics();
    glow.alpha = 0;
    root.addChild(ring, glow);

    const pos = spawnPos(pip);
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
    };
    attachSprite(actor);
    root.position.set(actor.x, actor.y);
    root.zIndex = actor.y;
    world.addChild(root);

    // Arrival: a little dust + hello wiggle (alive from frame one).
    dustPoof(actor.x, actor.y, 0.8);
    squashStretch(actor.runner, actor.sprite.rig, {
      amount: 0.12,
      cycleMs: 180,
      cycles: 2,
    });
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

  function pickRoamTarget(actor: Actor, state: GameState): void {
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
    // the conga, whose updateParade drives positions directly) ---
    const frozen = actor.ceremony || actor.careHoldMs > 0 || actor.parading;
    if (!frozen) {
      refreshMode(actor, state);
      if (actor.target !== null) {
        const arrived = walk(actor, dtMs);
        if (arrived) {
          actor.anim.rot = 0;
          if (actor.mode === "roam") {
            actor.pauseMs = 1400 + jitter.int(2800);
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

    // --- Idle juice (bob, blink, wiggle) --------------------------------
    const walking = actor.target !== null && !frozen;
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
          actor.blinkInMs = 2000 + jitter.int(2800);
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
   * Capped at ~78% of the view height: the grid band runs to 0.97h and
   * the bottom ~17% sits under the DOM action bar — a conga nobody can
   * see is a wasted kazoo. */
  function paradeLaneY(): number {
    const gridBottom = layout.originY + layout.rows * layout.tileH;
    return Math.min(h * 0.78, gridBottom + layout.tileH * 0.55);
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
      actors.delete(id);
      destroyActor(actor);
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
      emitPipTap(best.pip.id);
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
    layout = computeGridLayout(w, h, bounds.cols, bounds.rows);
    drawBackground();
    drawGridOverlay();
    drawFlash();
    flashG.alpha = 0;

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
