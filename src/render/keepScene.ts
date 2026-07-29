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
 */

import { Container, Graphics } from "pixi.js";
import type { GameState } from "../core/state";
import type { CareOutcome } from "../core/pips/care";
import { LifeStage, PipActivity } from "../core/pips/types";
import type { PipState } from "../core/pips/types";
import { createRng } from "../core/rng";
import {
  itemColors,
  itemFallbackColor,
  keepPalette,
} from "../content/palette";
import { sound } from "../app/sound";
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
  const pipLayer = new Container();
  const fxAbove = new ParticleSystem(jitter);
  view.addChild(background, pipLayer, fxAbove.view);

  const runner = new TweenRunner();

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

  drawBackground();

  return {
    view,

    sync(state: GameState): void {
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
    },

    getBubbleAnchor(): { x: number; y: number } {
      return { x: pipX(), y: headWorldY() - 14 };
    },
  };
}
