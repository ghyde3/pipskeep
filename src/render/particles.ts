/**
 * Simple particle helper (spec §5 "small particle/sound-slot hook",
 * §10.1.3 juice): crumbs, sparkles, hearts, confetti dots, drifting Z's.
 *
 * Purely visual. Randomness comes from an injected core/rng stream with a
 * render-local fixed seed (repo rule: no `Math.random()` outside
 * core/rng.ts — render juice goes through the same PRNG module). The
 * jitter stream's cursor is deliberately NOT part of GameState: no
 * gameplay outcome ever reads it (spec §2 rule 3 covers gameplay
 * streams).
 */

import { Container, Graphics, Text } from "pixi.js";
import type { RngStream } from "../core/rng";

export type ParticleShape = "dot" | "sparkle" | "heart" | "crumb";

export interface BurstOptions {
  readonly x: number;
  readonly y: number;
  readonly count: number;
  readonly shape: ParticleShape;
  readonly colors: readonly string[];
  /** Mean launch speed, px/s. */
  readonly speed?: number;
  /** Center of the launch cone, radians (0 = right, -PI/2 = up). */
  readonly directionRad?: number;
  /** Full cone width, radians. Defaults to a full circle. */
  readonly spreadRad?: number;
  /** Downward acceleration, px/s². */
  readonly gravity?: number;
  readonly lifeMs?: number;
  readonly sizeMin?: number;
  readonly sizeMax?: number;
}

interface Particle {
  view: Container;
  vx: number;
  vy: number;
  gravity: number;
  ageMs: number;
  lifeMs: number;
  spin: number;
  /** Horizontal sway (Z's) — amplitude px; 0 = ballistic. */
  sway: number;
  swayPhase: number;
  baseX: number;
  grow: number;
}

function drawShape(shape: ParticleShape, size: number, color: string): Graphics {
  const g = new Graphics();
  switch (shape) {
    case "dot":
      g.circle(0, 0, size).fill(color);
      break;
    case "crumb":
      g.roundRect(-size, -size * 0.7, size * 2, size * 1.4, size * 0.5).fill(color);
      break;
    case "sparkle": {
      const s = size * 1.6;
      const w = s * 0.28;
      g.poly([0, -s, w, -w, s, 0, w, w, 0, s, -w, w, -s, 0, -w, -w]).fill(color);
      break;
    }
    case "heart": {
      const s = size * 1.5;
      g.circle(-s * 0.35, -s * 0.28, s * 0.42).fill(color);
      g.circle(s * 0.35, -s * 0.28, s * 0.42).fill(color);
      g.poly([-s * 0.73, -s * 0.02, s * 0.73, -s * 0.02, 0, s * 0.8]).fill(color);
      break;
    }
  }
  return g;
}

export class ParticleSystem {
  readonly view = new Container();
  private particles: Particle[] = [];

  constructor(private readonly jitter: RngStream) {}

  burst(options: BurstOptions): void {
    const speed = options.speed ?? 90;
    const spread = options.spreadRad ?? Math.PI * 2;
    const direction = options.directionRad ?? -Math.PI / 2;
    const gravity = options.gravity ?? 160;
    const lifeMs = options.lifeMs ?? 700;
    const sizeMin = options.sizeMin ?? 2;
    const sizeMax = options.sizeMax ?? 4;
    for (let i = 0; i < options.count; i++) {
      const color =
        options.colors.length > 0
          ? this.jitter.pick(options.colors)
          : "#ffffff";
      const size = sizeMin + this.jitter.next() * (sizeMax - sizeMin);
      const g = drawShape(options.shape, size, color);
      g.position.set(options.x, options.y);
      const angle = direction + (this.jitter.next() - 0.5) * spread;
      const v = speed * (0.55 + this.jitter.next() * 0.9);
      this.view.addChild(g);
      this.particles.push({
        view: g,
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v,
        gravity,
        ageMs: 0,
        lifeMs: lifeMs * (0.75 + this.jitter.next() * 0.5),
        spin: (this.jitter.next() - 0.5) * 6,
        sway: 0,
        swayPhase: 0,
        baseX: options.x,
        grow: 0,
      });
    }
  }

  /** One sleepy "z" drifting up-right with a lazy sway (Resting pips). */
  floatZ(x: number, y: number, color = "#7f8bbd"): void {
    const size = 13 + this.jitter.int(6);
    const z = new Text({
      text: "z",
      style: {
        fontFamily: "Georgia, 'Times New Roman', serif",
        fontSize: size,
        fontWeight: "700",
        fill: color,
      },
    });
    z.anchor.set(0.5);
    z.position.set(x, y);
    z.alpha = 0;
    this.view.addChild(z);
    this.particles.push({
      view: z,
      vx: 9 + this.jitter.next() * 8,
      vy: -26 - this.jitter.next() * 10,
      gravity: 0,
      ageMs: 0,
      lifeMs: 2100 + this.jitter.int(500),
      spin: 0,
      sway: 6 + this.jitter.next() * 5,
      swayPhase: this.jitter.next() * Math.PI * 2,
      baseX: x,
      grow: 0.35,
    });
  }

  update(dtMs: number): void {
    if (this.particles.length === 0) return;
    const dt = dtMs / 1000;
    for (const p of this.particles) {
      p.ageMs += dtMs;
      p.vy += p.gravity * dt;
      p.baseX += p.vx * dt;
      p.view.y += p.vy * dt;
      p.view.x =
        p.sway > 0
          ? p.baseX + Math.sin(p.swayPhase + (p.ageMs / 1000) * 2.4) * p.sway
          : p.baseX;
      p.view.rotation += p.spin * dt;
      const t = Math.min(1, p.ageMs / p.lifeMs);
      // Pop in fast, fade out over the back 40% of life.
      p.view.alpha = Math.min(1, t * 6) * (t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1);
      if (p.grow > 0) {
        const s = 0.7 + p.grow * t;
        p.view.scale.set(s);
      }
    }
    const dead = this.particles.filter((p) => p.ageMs >= p.lifeMs);
    if (dead.length > 0) {
      this.particles = this.particles.filter((p) => p.ageMs < p.lifeMs);
      for (const p of dead) {
        p.view.removeFromParent();
        p.view.destroy();
      }
    }
  }

  clear(): void {
    for (const p of this.particles) {
      p.view.removeFromParent();
      p.view.destroy();
    }
    this.particles = [];
  }
}
