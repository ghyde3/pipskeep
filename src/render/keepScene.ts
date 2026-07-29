/**
 * Keep scene (Phase 2 minimal Keep view, spec §13): a pastel ground
 * diorama with the active Pip centered, idle bob + occasional blink and
 * wiggle, Resting Z's, Sulking slump, and the six juicy care animations
 * (spec §5, §10.1.3 — every one lands in under 1.5s).
 *
 * Reads state, never mutates it (spec §2 rule 4): `sync(state)` diffs the
 * active Pip and its activity; `playCareOutcome` animates the outcome the
 * reducer parked in `lastCareOutcome`. All Pip visuals load through the
 * SpriteResolver (spec §11).
 *
 * Randomness: render-only juice (blink timing, particle scatter, tuft
 * placement) draws from a core/rng stream with a fixed local seed — the
 * repo's single PRNG module, no Math.random. Its cursor is not in
 * GameState because no gameplay outcome depends on it (spec §2 rule 3
 * governs gameplay streams).
 *
 * Phase 4 egg layer (spec §7.2, additive): `state.eggs` render as
 * speckled eggs on deterministic slots near the Pip. Incubating eggs
 * breathe gently under a subtle progress ring (progress derives from
 * `lastTickAt` plus locally-accrued frame time — the scene never reads a
 * clock); Pipping eggs wobble, shed crack chips, and wear a bouncing "!"
 * tap affordance. A tap on a Pipping egg goes out through the
 * render/eggTap seam (ui/phase4.ts turns it into HATCH_EGG); the scene
 * self-diffs `lastHatchOutcome` in sync() to play the hatch burst (shell
 * pop + confetti + the newborn Pipling bouncing in at Pipling scale with
 * a hello line from the dialogue pools) or the roster-full "not yet"
 * wiggle (spec §7.4 — the toast is phase4's job). Egg tweens live on
 * their own TweenRunner so active-Pip sprite rebuilds never cancel them.
 */

import { Container, Graphics, Rectangle, Text } from "pixi.js";
import type { GameState } from "../core/state";
import type { CareOutcome } from "../core/pips/care";
import { LifeStage, PipActivity } from "../core/pips/types";
import type { PipState } from "../core/pips/types";
import { createRng } from "../core/rng";
import { EggState } from "../core/eggs";
import type { Egg, HatchOutcome } from "../core/eggs";
import { pickLineFromPools } from "../core/pips/dialogue";
import { dialogue as dialoguePools } from "../content/dialogue";
import {
  itemColors,
  itemFallbackColor,
  keepPalette,
} from "../content/palette";
import { sound } from "../app/sound";
import { emitEggTap } from "./eggTap";
import { resolvePipSprite, PIPLING_SCALE, PIP_BODY_HEIGHT } from "./spriteResolver";
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

export interface KeepScene {
  readonly view: Container;
  /** Re-render from new state (active pip identity, activity, stage). */
  sync(state: GameState): void;
  /** Per-frame advance: tweens, particles, idle bob, blink timers. */
  update(dtMs: number): void;
  /** Animate a care outcome (< 1.5s, spec §5). `consumedItemId` lets Feed
   * color the morsel by what was actually eaten. */
  playCareOutcome(outcome: CareOutcome, consumedItemId?: string): void;
  resize(width: number, height: number): void;
  /** Screen-space (CSS px) anchor just above the Pip's head — the UI
   * hangs the speech bubble here. */
  getBubbleAnchor(): { x: number; y: number };
}

/** Pip-voiced refusals get the shake + line; structural blocks (cooldown,
 * empty pantry) are the UI's problem (spec §5: no line, no drama). */
const VOICED_REFUSALS: ReadonlySet<string> = new Set([
  "tooTired",
  "lazyTooTired",
  "lazyWhim",
  "machine",
]);

export function createKeepScene(width: number, height: number): KeepScene {
  // Render-local deterministic jitter (see module doc).
  const jitter = createRng(0x6a756963).stream("keep-juice");

  const view = new Container();
  const background = new Container();
  const eggLayer = new Container();
  const pipLayer = new Container();
  const fxAbove = new ParticleSystem(jitter);
  view.addChild(background, eggLayer, pipLayer, fxAbove.view);

  const runner = new TweenRunner();
  /** Egg/hatchling tweens — separate runner so rebuildSprite's
   * runner.clear() never cancels an egg drop or a hatch celebration. */
  const eggRunner = new TweenRunner();

  let w = width;
  let h = height;
  let sprite: PipSprite | null = null;
  /** Identity of the currently composed sprite (rebuild on change). */
  let spriteKey = "";
  let activePip: PipState | null = null;

  // Animation channels — composited every frame so idle bob, slump and
  // care tweens never fight over the same property.
  const anim = { x: 0, y: 0, rot: 0 };
  let bobPhase = jitter.next() * Math.PI * 2;
  let slumpRot = 0;
  let eyesTarget = 1;
  let eyesCurrent = 1;
  let blinkInMs = 2000 + jitter.int(2500);
  let blinkT = -1; // >= 0 while a blink is in flight
  let wiggleInMs = 5000 + jitter.int(5000);
  let zInMs = 0;

  const pipX = () => w / 2;
  const groundY = () => h * 0.6;

  function drawBackground(): void {
    background.removeChildren().forEach((c) => c.destroy());
    const g = new Graphics();
    // Sky: three soft pastel bands.
    g.rect(0, 0, w, h * 0.28).fill(keepPalette.skyTop);
    g.rect(0, h * 0.28, w, h * 0.2).fill("#dff0ef");
    g.rect(0, h * 0.44, w, h * 0.56).fill(keepPalette.skyBottom);
    // Sun glow.
    g.circle(w * 0.78, h * 0.16, Math.min(w, h) * 0.13).fill({
      color: keepPalette.sunGlow,
      alpha: 0.7,
    });
    // Far hills.
    g.ellipse(w * 0.2, h * 0.5, w * 0.45, h * 0.09).fill(keepPalette.hillFar);
    g.ellipse(w * 0.85, h * 0.52, w * 0.5, h * 0.1).fill(keepPalette.hillNear);
    // Main ground slab.
    g.rect(0, h * 0.52, w, h * 0.48).fill(keepPalette.ground);
    g.ellipse(w / 2, h * 0.52, w * 0.62, h * 0.05).fill(keepPalette.ground);
    // Near apron of slightly deeper green.
    g.ellipse(w / 2, h * 1.02, w * 0.75, h * 0.3).fill(keepPalette.groundNear);
    // A little path pad under the Pip.
    g.ellipse(pipX(), groundY() + 8, 90, 20).fill({
      color: keepPalette.path,
      alpha: 0.65,
    });
    background.addChild(g);

    // Grass tufts + flowers, deterministically scattered.
    const detail = new Graphics();
    for (let i = 0; i < 16; i++) {
      const tx = jitter.next() * w;
      const ty = h * (0.56 + jitter.next() * 0.4);
      if (Math.abs(tx - pipX()) < 80 && Math.abs(ty - groundY()) < 46) continue;
      for (const blade of [-3, 0, 3]) {
        detail
          .moveTo(tx + blade, ty)
          .quadraticCurveTo(tx + blade * 1.6, ty - 7, tx + blade * 2.2, ty - 12);
      }
      detail.stroke({ width: 2, color: keepPalette.tuft, alpha: 0.8, cap: "round" });
    }
    for (let i = 0; i < 7; i++) {
      const fx = jitter.next() * w;
      const fy = h * (0.58 + jitter.next() * 0.38);
      if (Math.abs(fx - pipX()) < 90 && Math.abs(fy - groundY()) < 50) continue;
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

  function spriteScale(): number {
    return sprite?.stage === LifeStage.Pipling ? PIPLING_SCALE : 1;
  }

  function headWorldY(): number {
    const s = sprite;
    if (s === null) return groundY() - PIP_BODY_HEIGHT;
    return groundY() + (s.headTopY - 12) * spriteScale();
  }

  function mouthLocal(): { x: number; y: number } {
    return { x: 0, y: -PIP_BODY_HEIGHT * 0.42 };
  }

  function rebuildSprite(pip: PipState): void {
    sprite?.destroy();
    runner.clear();
    anim.x = 0;
    anim.y = 0;
    anim.rot = 0;
    sprite = resolvePipSprite(pip.genome, pip.lifeStage);
    sprite.view.position.set(pipX(), groundY());
    pipLayer.addChild(sprite.view);
    // Arrival wiggle — a small hello (spec §10.1 step 2 energy).
    squashStretch(runner, sprite.rig, { amount: 0.1, cycleMs: 180, cycles: 2 });
  }

  function applyActivityLook(pip: PipState): void {
    if (sprite === null) return;
    const sulking = pip.activity === PipActivity.Sulking;
    const resting = pip.activity === PipActivity.Resting;
    sprite.setSulkTint(sulking);
    slumpRot = sulking ? 0.09 : 0;
    eyesTarget = resting ? 0.08 : sulking ? 0.45 : 1;
  }

  // -------------------------------------------------------------------------
  // Egg layer (Phase 4, spec §7.2) — see module doc. Everything below is
  // additive: the active-Pip pipeline above is untouched.
  // -------------------------------------------------------------------------

  const EGG_SHELL_COLOR = "#f8f1e0";
  const EGG_SPECKLE_COLOR = "#cdbb95";
  const EGG_OUTLINE_COLOR = "#c9b892";
  const EGG_CRACK_COLOR = "#8f7f5f";

  /** Deterministic slots near the Pip (offset fraction + ground drop),
   * assigned by `state.eggs` order; stable across resize. */
  const EGG_SLOTS: readonly { fx: number; dy: number }[] = [
    { fx: -0.3, dy: 18 },
    { fx: 0.32, dy: 22 },
    { fx: -0.15, dy: 42 },
    { fx: 0.17, dy: 46 },
    { fx: -0.44, dy: 30 },
    { fx: 0.46, dy: 34 },
  ];

  interface EggVisual {
    readonly root: Container;
    /** Wobble/breathe target; pivot at the egg's base so it rocks. */
    readonly rig: Container;
    readonly ring: Graphics;
    readonly cracks: Graphics;
    readonly bang: Text;
    /** Arrival-pop handle — cancelled on destroy so a tween frozen by a
     * hidden tab (RAF paused) can never touch a destroyed root. */
    arrivalTween: TweenHandle | null;
    egg: Egg;
    slot: number;
    breathePhase: number;
    bangPhase: number;
    /** ms until the next Pipping wobble burst. */
    wobbleInMs: number;
    /** Elapsed ms of the in-flight wobble; -1 while idle. */
    wobbleT: number;
    /** Elapsed ms of the roster-full "not yet" wiggle; -1 while idle. */
    shakeT: number;
    lastRingProgress: number;
  }

  const eggVisuals = new Map<string, EggVisual>();

  /** Egg tap hit box in root-local px (egg body + the "!" affordance). */
  const EGG_TAP_HALF_WIDTH = 30;
  const EGG_TAP_TOP = -70;
  const EGG_TAP_BOTTOM = 12;

  function handleEggTap(v: EggVisual): void {
    if (v.egg.state === EggState.Pipping) {
      sound("egg.tap");
      emitEggTap(v.egg.id);
    } else if (v.wobbleT < 0 && v.shakeT < 0) {
      // A shy jiggle — not ready yet, but it appreciates the attention.
      v.wobbleT = 0;
    }
  }

  // Stage-level tap routing with MANUAL hit-testing: egg roots are plain
  // slot-positioned containers, so `event.global` against their known
  // positions is exact — and immune to Pixi v8's lazily-updated child
  // worldTransforms, which made per-container hitArea tests unreliable
  // for containers created outside the render loop.
  view.eventMode = "static";
  view.hitArea = new Rectangle(-1e6, -1e6, 2e6, 2e6);
  view.on("pointertap", (event) => {
    const g = event.global;
    for (const v of eggVisuals.values()) {
      const dx = g.x - v.root.position.x;
      const dy = g.y - v.root.position.y;
      if (
        dx >= -EGG_TAP_HALF_WIDTH &&
        dx <= EGG_TAP_HALF_WIDTH &&
        dy >= EGG_TAP_TOP &&
        dy <= EGG_TAP_BOTTOM
      ) {
        handleEggTap(v);
        return;
      }
    }
  });

  interface HatchlingVisual {
    readonly sprite: PipSprite;
    bubble: Container | null;
    readonly helloText: string;
    readonly homeX: number;
    readonly homeY: number;
    ageMs: number;
    bubbleShown: boolean;
    leaving: boolean;
    disposed: boolean;
    /** Every tween touching this hatchling — cancelled on dispose. */
    readonly tweens: TweenHandle[];
  }

  let hatchling: HatchlingVisual | null = null;

  /** lastTickAt from the most recent sync + frame time accrued since —
   * the scene's clockless "now" for the incubation progress ring. */
  let syncedTickAt = 0;
  let sinceSyncMs = 0;
  let eggSeenInit = false;
  let seenHatchOutcome: HatchOutcome | null = null;

  function eggSlotPos(slot: number): { x: number; y: number } {
    const s = EGG_SLOTS[slot % EGG_SLOTS.length] ?? { fx: 0.3, dy: 20 };
    const spread = Math.min(w * 0.9, 700);
    const x = Math.min(w - 34, Math.max(34, w / 2 + s.fx * spread));
    return { x, y: groundY() + s.dy };
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
    // A soft highlight so the shell reads as curved.
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

  /** State-derived look: Incubating = ring; Pipping = cracks + "!". */
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
    eggLayer.addChild(root);

    // Arrival pop. Guarded AND handle-tracked: a hidden tab pauses RAF,
    // so this tween can still be pending whenever the egg is destroyed.
    root.scale.set(0);
    v.arrivalTween = eggRunner.add({
      durationMs: 420,
      ease: easeOutBack,
      onUpdate: (t) => {
        if (!root.destroyed) root.scale.set(t);
      },
      onComplete: () => {
        if (!root.destroyed) root.scale.set(1);
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

  /** Little Pixi speech bubble for the hatchling's hello line. */
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

  function disposeHatchling(): void {
    if (hatchling === null) return;
    hatchling.disposed = true;
    // Cancel BEFORE destroying: a paused-RAF tween must never resume
    // against a destroyed sprite/bubble (it would kill the ticker).
    for (const handle of hatchling.tweens) handle.cancel();
    hatchling.tweens.length = 0;
    hatchling.bubble?.destroy({ children: true });
    hatchling.sprite.destroy();
    hatchling = null;
  }

  /** The hatch moment (spec §7.2 — always player-witnessed): shell pop,
   * confetti, and the newborn Pipling bouncing in at Pipling scale. */
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

    disposeHatchling();
    const newbornSprite = resolvePipSprite(newborn.genome, LifeStage.Pipling);
    newbornSprite.view.position.set(x, y - 74);
    eggLayer.addChild(newbornSprite.view);

    const hello =
      pickLineFromPools(
        newborn.personalityId,
        "beaming",
        undefined,
        jitter,
        dialoguePools,
      )?.text ?? "…hi. Hello! Hi.";

    const hl: HatchlingVisual = {
      sprite: newbornSprite,
      bubble: null,
      helloText: hello,
      homeX: x,
      homeY: y,
      ageMs: 0,
      bubbleShown: false,
      leaving: false,
      disposed: false,
      tweens: [],
    };
    hatchling = hl;

    // Drop in: fall to the ground, land with a squash.
    hl.tweens.push(
      eggRunner.sequence([
        {
          durationMs: 380,
          ease: easeIn,
          onUpdate: (t) => {
            if (hl.disposed) return;
            hl.sprite.view.y = y - 74 + 74 * t;
          },
          onComplete: () => {
            if (hl.disposed) return;
            hl.sprite.view.y = y;
            hl.tweens.push(
              squashStretch(eggRunner, hl.sprite.rig, {
                amount: 0.22,
                cycleMs: 190,
                cycles: 2,
              }),
            );
          },
        },
      ]),
    );
  }

  function startEggShake(v: EggVisual): void {
    // Polite "not yet" — the Keep is full; the egg snuggles back down.
    sound("egg.snug");
    v.shakeT = 0;
  }

  /** Diff `state.eggs` + `lastHatchOutcome` (called from sync). */
  function syncEggs(state: GameState): void {
    if (!eggSeenInit) {
      eggSeenInit = true;
      // Baseline: never replay an outcome that predates this scene.
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
      }
      if (stateChanged) {
        applyEggLook(existing);
        if (egg.state === EggState.Pipping) {
          // The crack moment: a proud pop + first chips.
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

  /** Per-frame egg + hatchling animation (called from update). */
  function updateEggs(dtMs: number): void {
    eggRunner.update(dtMs);
    sinceSyncMs += dtMs;
    const approxNow = syncedTickAt + sinceSyncMs;

    for (const v of eggVisuals.values()) {
      const incubating = v.egg.state === EggState.Incubating;
      const pipping = v.egg.state === EggState.Pipping;

      if (incubating) {
        // Gentle breathing pulse.
        v.breathePhase += (dtMs / 1000) * 2.1;
        const breathe = Math.sin(v.breathePhase);
        v.rig.scale.y = 1 + breathe * 0.025;
        v.rig.scale.x = 1 - breathe * 0.016;

        // Subtle derived progress ring (spec §7.2 derived timers).
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
        // Bouncing "!" affordance.
        v.bangPhase += (dtMs / 1000) * 4.2;
        v.bang.position.y = -54 + Math.sin(v.bangPhase) * 3.5;
        const pulse = 1 + Math.sin(v.bangPhase * 1.5) * 0.08;
        v.bang.scale.set(pulse);

        // Scheduled wobble bursts with crack chips.
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

      // Wobble burst timeline (also the Incubating "shy jiggle").
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

      // Roster-full "not yet" wiggle — smaller, apologetic.
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

    // Hatchling timeline: hello, then hop off to join the Keep.
    const hl = hatchling;
    if (hl !== null && !hl.disposed) {
      hl.ageMs += dtMs;

      if (!hl.bubbleShown && hl.ageMs >= 820) {
        hl.bubbleShown = true;
        sound("egg.hello");
        const bubble = buildHelloBubble(hl.helloText);
        bubble.position.set(
          hl.homeX,
          hl.homeY + (hl.sprite.headTopY - 10) * PIPLING_SCALE,
        );
        bubble.scale.set(0);
        eggLayer.addChild(bubble);
        hl.bubble = bubble;
        hl.tweens.push(
          eggRunner.add({
            durationMs: 260,
            ease: easeOutBack,
            onUpdate: (t) => {
              if (!bubble.destroyed) bubble.scale.set(t);
            },
          }),
        );
        fxAbove.burst({
          x: hl.homeX + 16,
          y: hl.homeY + hl.sprite.headTopY * PIPLING_SCALE,
          count: 4,
          shape: "heart",
          colors: ["#f27d9d", "#f6a8b8"],
          speed: 46,
          directionRad: -Math.PI / 2,
          spreadRad: Math.PI * 0.6,
          gravity: -24,
          lifeMs: 850,
          sizeMin: 3,
          sizeMax: 4.5,
        });
      }

      if (!hl.leaving && hl.ageMs >= 4400) {
        hl.leaving = true;
        hl.bubble?.destroy({ children: true });
        hl.bubble = null;
        const dir = hl.homeX < w / 2 ? -1 : 1;
        const startX = hl.sprite.view.x;
        const dist = dir * (w * 0.25 + 140);
        hl.tweens.push(
          eggRunner.add({
            durationMs: 1150,
            ease: linear,
            onUpdate: (t) => {
              if (hl.disposed) return;
              hl.sprite.view.x = startX + dist * t;
              hl.sprite.view.y =
                hl.homeY - Math.abs(Math.sin(t * Math.PI * 4)) * 14;
              if (t > 0.65) hl.sprite.view.alpha = 1 - (t - 0.65) / 0.35;
            },
            onComplete: () => {
              if (hatchling === hl) disposeHatchling();
            },
          }),
        );
      }
    }
  }

  function repositionEggs(): void {
    for (const v of eggVisuals.values()) {
      const pos = eggSlotPos(v.slot);
      v.root.position.set(pos.x, pos.y);
    }
  }

  drawBackground();

  return {
    view,

    sync(state: GameState): void {
      // Egg layer first — it must run even with no active pip.
      syncEggs(state);

      const pip = state.pips[state.activePipId];
      if (pip === undefined) {
        sprite?.destroy();
        sprite = null;
        activePip = null;
        spriteKey = "";
        return;
      }
      const key = `${pip.id}|${pip.lifeStage}|${pip.speciesId}|${pip.genome.palette}|${pip.genome.pattern}`;
      if (sprite === null || key !== spriteKey) {
        spriteKey = key;
        rebuildSprite(pip);
      }
      activePip = pip;
      applyActivityLook(pip);
    },

    update(dtMs: number): void {
      runner.update(dtMs);
      fxAbove.update(dtMs);
      updateEggs(dtMs); // before the active-pip early-return below
      if (sprite === null || activePip === null) return;

      const resting = activePip.activity === PipActivity.Resting;
      const sulking = activePip.activity === PipActivity.Sulking;

      // Idle bob (slower while resting, nearly still while sulking).
      bobPhase += (dtMs / 1000) * (resting ? 1.6 : 3.4);
      const bobAmp = sulking ? 0.8 : resting ? 1.6 : 2.6;
      const bobY = Math.sin(bobPhase) * bobAmp;

      // Gentle breathing when no care tween owns the rig.
      if (runner.active === 0) {
        const breathe = Math.sin(bobPhase) * 0.012;
        sprite.rig.scale.x += (1 + breathe - sprite.rig.scale.x) * 0.3;
        sprite.rig.scale.y += (1 - breathe - sprite.rig.scale.y) * 0.3;
      }

      // Composite the channels.
      sprite.rig.position.set(anim.x, bobY + anim.y);
      sprite.rig.rotation = slumpRot + anim.rot;

      // Blink timer (skipped while resting — eyes are already shut).
      if (!resting) {
        if (blinkT >= 0) {
          blinkT += dtMs;
          const t = blinkT / 150;
          eyesCurrent =
            t >= 1 ? eyesTarget : eyesTarget * Math.abs(Math.cos(Math.PI * t));
          if (t >= 1) blinkT = -1;
        } else {
          blinkInMs -= dtMs;
          if (blinkInMs <= 0) {
            blinkT = 0;
            blinkInMs = 2000 + jitter.int(2800);
          }
          eyesCurrent += (eyesTarget - eyesCurrent) * 0.25;
        }
      } else {
        eyesCurrent += (eyesTarget - eyesCurrent) * 0.2;
      }
      sprite.setEyesOpen(eyesCurrent);

      // Occasional idle wiggle (alive > static, spec §9 spirit).
      if (!resting && !sulking && runner.active === 0) {
        wiggleInMs -= dtMs;
        if (wiggleInMs <= 0) {
          wiggleInMs = 5000 + jitter.int(6000);
          runner.add({
            durationMs: 560,
            ease: linear,
            onUpdate: (t) => {
              anim.rot = Math.sin(t * Math.PI * 3) * 0.055 * (1 - t);
            },
            onComplete: () => {
              anim.rot = 0;
            },
          });
        }
      }

      // Drifting Z's while Resting.
      if (resting) {
        zInMs -= dtMs;
        if (zInMs <= 0) {
          zInMs = 850 + jitter.int(500);
          fxAbove.floatZ(pipX() + 26 * spriteScale(), headWorldY() + 6);
        }
      }
    },

    playCareOutcome(outcome: CareOutcome, consumedItemId?: string): void {
      if (sprite === null) return;
      const rig = sprite.rig;
      const scale = spriteScale();
      const mouth = mouthLocal();
      const mouthWorld = {
        x: pipX() + mouth.x * scale,
        y: groundY() + mouth.y * scale,
      };

      if (!outcome.applied) {
        if (!VOICED_REFUSALS.has(outcome.refusalReason ?? "")) return;
        // Gentle refusal shake (spec §5: funny, not frustrating).
        sound("care.refuse");
        runner.add({
          durationMs: 480,
          ease: linear,
          onUpdate: (t) => {
            anim.x = Math.sin(t * Math.PI * 5) * 7 * (1 - t);
          },
          onComplete: () => {
            anim.x = 0;
          },
        });
        return;
      }

      switch (outcome.action) {
        case "feed":
        case "giveItem": {
          const isGift = outcome.action === "giveItem";
          sound(isGift ? "care.give" : "care.feed");
          const color =
            itemColors[consumedItemId ?? ""] ?? itemFallbackColor;
          // The item arcs in from the left...
          const morsel = new Graphics().circle(0, 0, 9).fill(color);
          morsel.circle(2, -9, 3).fill(keepPalette.tuft);
          const from = { x: pipX() - 120, y: mouthWorld.y - 70 };
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
                  Math.sin(Math.PI * t) * 64;
                morsel.rotation = t * 4;
              },
              onComplete: () => {
                morsel.removeFromParent();
                morsel.destroy();
                // ...then munch-munch-munch + crumbs (or sparkle thanks).
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
          // Sparkle sweep across the body, left to right.
          const sweepY = groundY() - PIP_BODY_HEIGHT * 0.6 * scale;
          for (let i = 0; i < 4; i++) {
            runner.after(i * 110, () => {
              fxAbove.burst({
                x: pipX() + (-46 + i * 30) * scale,
                y: sweepY + (i % 2 === 0 ? -14 : 10),
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
          // A proud little pop once the sweep passes.
          runner.add({
            delayMs: 380,
            durationMs: 300,
            ease: easeOutBack,
            onUpdate: (t) => {
              const s = 1 + 0.06 * t;
              rig.scale.x = s;
              rig.scale.y = s;
            },
            onComplete: () => rig.scale.set(1, 1),
          });
          break;
        }

        case "play": {
          sound("care.play");
          // Bounce + coin-flip spin, land with a squash + confetti.
          runner.sequence([
            {
              durationMs: 280,
              ease: easeOut,
              onUpdate: (t) => {
                anim.y = -74 * t;
              },
            },
            {
              durationMs: 250,
              ease: easeIn,
              onUpdate: (t) => {
                anim.y = -74 * (1 - t);
              },
              onComplete: () => {
                anim.y = 0;
                squashStretch(runner, rig, { amount: 0.2, cycleMs: 200 });
                fxAbove.burst({
                  x: pipX(),
                  y: groundY() - 8,
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
              // Yaw-spin illusion: scale.x sweeps through a full cosine.
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
          // Lean into the hand, hearts drift up.
          runner.sequence([
            {
              durationMs: 240,
              ease: easeOut,
              onUpdate: (t) => {
                anim.rot = 0.13 * t;
                anim.y = -4 * t;
              },
              onComplete: () => {
                fxAbove.burst({
                  x: pipX() + 20 * scale,
                  y: headWorldY(),
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
                anim.rot = 0.13 * (1 - t);
                anim.y = -4 * (1 - t);
              },
              onComplete: () => {
                anim.rot = 0;
                anim.y = 0;
              },
            },
          ]);
          break;
        }

        case "restToggle": {
          const nowResting = activePip?.activity === PipActivity.Resting;
          sound(nowResting ? "care.rest" : "care.wake");
          if (nowResting) {
            // Yawn: slow sink, then settle — Z's take over from update().
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
            // Wake stretch: tall pop, sparkles of alertness.
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
      drawBackground();
      sprite?.view.position.set(pipX(), groundY());
      repositionEggs();
    },

    getBubbleAnchor(): { x: number; y: number } {
      return { x: pipX(), y: headWorldY() - 14 };
    },
  };
}
