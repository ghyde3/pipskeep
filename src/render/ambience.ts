/**
 * AMBIENT LIFE (round 2K, docs/liveliness-bible.md §4.1/§4.3/§5).
 *
 * The garnish layer: flitters (butterflies by day, moths at dusk,
 * FIREFLIES AT NIGHT) and weather particles. Everything here is what
 * §5.4's cut order sacrifices FIRST, which is exactly why it lives in its
 * own module — a cut is a call-site deletion, not surgery inside 2 800
 * lines of keepScene.
 *
 * ⚠️ THE SKYBIRD WAS CUT BY THE FIX STAGE, and it is the cut order
 * working as designed. Two independent findings landed on it: the scene
 * measured 346 display objects against a 310 budget, and §5.4 names
 * skybirds as the FIRST thing to go ("pure garnish"); and a mutation
 * stage proved the entire bird could be deleted with the suite fully
 * green, including all three tests named "the skybird" — every assertion
 * about it was an upper bound (`toBeLessThanOrEqual(base + 1)`) or a
 * zero, so nothing anywhere required a bird to ever fly. Given a breached
 * budget and a feature no test could distinguish from its own absence,
 * deleting it is the honest resolution of both. The flitters and the
 * weather it shared this module with keep exact-count assertions, which
 * is why the same mutation against THEM failed three tests each.
 *
 * ⚠️ THE OBJECT BUDGET IS THE POINT (bible §5.2). This layer's whole
 * persistent cost is `flitterCount[phase]` Graphics plus one weather
 * emitter's particles — asserted as literals in `ambience.test.ts`, and
 * modelled against the real budget in `app/perfBudget.test.ts`, so a
 * regression is a failing test rather than a slow game. `objectCount()`
 * exists for those tests and for the `?perf` readout; nothing in the game
 * reads it.
 *
 * PURELY COSMETIC BY CONTRACT, same rule as `render/particles.ts`: no
 * state is read, nothing is dispatched, and the randomness is a
 * render-local seeded stream whose cursor deliberately does NOT live in
 * `GameState` (no gameplay outcome reads it). Time never enters —
 * everything advances on `update(dtMs)` frame time, and the only
 * "when" this module knows is the daylight phase and the weather kind
 * the scene hands it.
 */

import { Container, Graphics } from "pixi.js";
import { createRng } from "../core/rng";
import type { RngStream } from "../core/rng";
import { tuning } from "../content/tuning";
import { keepPalette } from "../content/palette";
import type { DaylightPhase } from "../app/daylight";
import type { WeatherKind, WeatherSample } from "../app/weather";

/** Fixed render-local seed — cosmetic randomness, never a save cursor. */
const AMBIENCE_SEED = 0x5eed_11fe;

export interface AmbienceBounds {
  readonly width: number;
  readonly height: number;
  /** Top of the playfield: flitters stay below it. */
  readonly groundTop: number;
}

export interface AmbienceLayer {
  /** Add above `world` (and above the daylight overlay, so fireflies
   * actually glow at night instead of being tinted into the dark). */
  readonly view: Container;
  setPhase(phase: DaylightPhase): void;
  setWeather(sample: WeatherSample): void;
  resize(bounds: AmbienceBounds): void;
  update(dtMs: number): void;
  /** Live display-object count — bible §5.2's budget, made measurable. */
  objectCount(): number;
  /** Drop every ambient object (the §5.4 cut, at runtime). */
  clear(): void;
  destroy(): void;
}

/** One drifting flitter on a sine path. One Graphics, no container. */
interface Flitter {
  readonly g: Graphics;
  /** Path parameters — a slow lissajous so no two ever share a track. */
  t: number;
  readonly speed: number;
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
  readonly phase: number;
  readonly wing: number;
}

interface Mote {
  readonly g: Graphics;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Petals and snow rock; rain does not. */
  spin: number;
  life: number;
}

/** What a flitter looks like in each phase — the reason night is worth
 * having is on this table (bible §4.1 item 8). */
/** ⚠️ FIX STAGE — every `size` raised (was 1 / 1 / 0.95 / 0.8) and the
 * daytime colours deepened. A design pass at 375px found a flitter to be
 * "a ~4×6px pink rounded tick with a lighter centre line and no visible
 * wing motion… reads as dust, dead pixels or render artifacts rather than
 * as life". Since the object budget forced the COUNT down anyway, the
 * survivors get to be bigger: three butterflies you can see beat five you
 * mistake for a rendering bug. */
const FLITTER_LOOK: Readonly<
  Record<DaylightPhase, { color: string; glow: boolean; size: number }>
> = {
  dawn: { color: "#ffc98a", glow: false, size: 1.5 },
  day: { color: "#ef8fa6", glow: false, size: 1.5 },
  dusk: { color: "#c9ae87", glow: false, size: 1.45 },
  night: { color: "#f7f27a", glow: true, size: 1.25 },
};

export function createAmbience(bounds: AmbienceBounds): AmbienceLayer {
  const view = new Container();
  // Ambience never receives input — the scene's taps must fall through
  // to the Pips and eggs underneath it.
  view.eventMode = "none";
  view.interactiveChildren = false;

  const rng: RngStream = createRng(AMBIENCE_SEED).stream("ambience");
  const cfg = tuning.liveliness.ambience;

  let box = bounds;
  let phase: DaylightPhase = "day";
  let weather: WeatherSample | null = null;
  let weatherWindow: number | null = null;

  const flitters: Flitter[] = [];
  const motes: Mote[] = [];

  // --- flitters ----------------------------------------------------------

  function drawFlitter(g: Graphics, look: (typeof FLITTER_LOOK)[DaylightPhase]): void {
    g.clear();
    const s = look.size;
    if (look.glow) {
      // A firefly: a soft halo with a hot centre. Two circles, no filter
      // (a Pixi filter here would cost a render target per flitter).
      g.circle(0, 0, 5 * s).fill({ color: look.color, alpha: 0.18 });
      g.circle(0, 0, 2.6 * s).fill({ color: look.color, alpha: 0.55 });
      g.circle(0, 0, 1.3 * s).fill({ color: "#ffffff", alpha: 0.9 });
      return;
    }
    // A butterfly/moth: two little wings either side of a thread body.
    g.ellipse(-2.2 * s, 0, 2.4 * s, 3.2 * s).fill({ color: look.color, alpha: 0.85 });
    g.ellipse(2.2 * s, 0, 2.4 * s, 3.2 * s).fill({ color: look.color, alpha: 0.85 });
    g.ellipse(0, 0, 0.8 * s, 2.4 * s).fill({ color: "#6d5a49", alpha: 0.7 });
  }

  function spawnFlitter(): Flitter {
    const look = FLITTER_LOOK[phase];
    const g = new Graphics();
    drawFlitter(g, look);
    view.addChild(g);
    const top = box.groundTop;
    const usable = Math.max(60, box.height - top);
    return {
      g,
      t: rng.next() * Math.PI * 2,
      speed: 0.18 + rng.next() * 0.22,
      cx: box.width * (0.15 + rng.next() * 0.7),
      cy: top + usable * (0.1 + rng.next() * 0.7),
      rx: box.width * (0.08 + rng.next() * 0.16),
      ry: usable * (0.05 + rng.next() * 0.12),
      phase: rng.next() * Math.PI * 2,
      wing: rng.next() * Math.PI * 2,
    };
  }

  function targetFlitterCount(): number {
    const counts = cfg.flitterCount;
    switch (phase) {
      case "night":
        return counts.night;
      case "dusk":
        return counts.dusk;
      case "dawn":
        return counts.dusk;
      case "day":
        return counts.day;
    }
  }

  function syncFlitters(): void {
    const want = targetFlitterCount();
    while (flitters.length > want) {
      const f = flitters.pop();
      f?.g.destroy();
    }
    while (flitters.length < want) flitters.push(spawnFlitter());
    // Rebuild the LOOK in place on a phase change — same objects, new
    // geometry, so a dusk→night flip costs zero allocations.
    const look = FLITTER_LOOK[phase];
    for (const f of flitters) drawFlitter(f.g, look);
  }

  // --- weather -----------------------------------------------------------

  /**
   * ⚠️ FIX STAGE — every mote redrawn LONGER, THICKER and more OPAQUE.
   * The counts were cut (§5.4 step 3, for the object budget), and a design
   * pass had independently found the old ones illegible: "a ~1×8px pale
   * blue-grey diagonal at very low contrast against the green ground,
   * with only a couple visible per screen region… reads as dust". A
   * particle nobody can see is not weather; it is noise with a frame cost.
   * Ten visible streaks communicate rain, forty invisible ones do not.
   */
  function drawMote(g: Graphics, kind: WeatherKind): void {
    g.clear();
    switch (kind) {
      case "rain":
        // A streak, not a drop — a falling line reads as rain at 1/60 s.
        g.moveTo(0, 0).lineTo(2.4, 15).stroke({ width: 2.4, color: "#dcefff", alpha: 0.8 });
        break;
      case "snow":
        g.circle(0, 0, 3).fill({ color: "#ffffff", alpha: 0.95 });
        break;
      case "petalfall": {
        const petals = keepPalette.flowerPetals;
        const color = petals[rng.int(petals.length)] ?? "#f6a8b8";
        g.ellipse(0, 0, 4.6, 2.6).fill({ color, alpha: 0.95 });
        break;
      }
      default:
        break;
    }
  }

  function spawnMote(kind: WeatherKind, seeded: boolean): Mote {
    const g = new Graphics();
    drawMote(g, kind);
    view.addChild(g);
    const fast = kind === "rain";
    return {
      g,
      x: rng.next() * (box.width + 80) - 40,
      // `seeded` fills the screen on the first frame so weather does not
      // visibly "start" at the top edge when a window flips mid-session.
      y: seeded ? rng.next() * box.height : -rng.next() * 60 - 10,
      vx: fast ? 40 + rng.next() * 20 : (rng.next() - 0.5) * 26,
      vy: fast ? 620 + rng.next() * 180 : kind === "snow" ? 26 + rng.next() * 22 : 34 + rng.next() * 26,
      spin: fast ? 0 : (rng.next() - 0.5) * 3,
      life: 0,
    };
  }

  function clearMotes(): void {
    for (const m of motes) m.g.destroy();
    motes.length = 0;
  }

  function syncWeather(): void {
    const kind = weather?.kind ?? "clear";
    const want = weather?.particleCount ?? 0;
    if (want === 0) {
      clearMotes();
      return;
    }
    while (motes.length > want) {
      const m = motes.pop();
      m?.g.destroy();
    }
    const seeded = motes.length === 0;
    while (motes.length < want) motes.push(spawnMote(kind, seeded));
  }

  // --- lifecycle ---------------------------------------------------------

  syncFlitters();

  return {
    view,

    setPhase(next: DaylightPhase): void {
      if (next === phase) return;
      phase = next;
      syncFlitters();
    },

    setWeather(sample: WeatherSample): void {
      weather = sample;
      // Rebuild on the WINDOW edge, not on the kind: two adjacent windows
      // can roll the same kind, and rebuilding then is a pointless
      // teardown of 40 live particles.
      if (weatherWindow !== sample.window) {
        weatherWindow = sample.window;
        clearMotes();
      }
      syncWeather();
    },

    resize(next: AmbienceBounds): void {
      box = next;
      // Flitters are laid out in absolute px around a centre point, so a
      // resize has to re-seed them or they orbit off-screen.
      for (const f of flitters) f.g.destroy();
      flitters.length = 0;
      syncFlitters();
      clearMotes();
      syncWeather();
    },

    update(dtMs: number): void {
      const dt = dtMs / 1000;

      for (const f of flitters) {
        f.t += dt * f.speed;
        const x = f.cx + Math.cos(f.t + f.phase) * f.rx;
        const y = f.cy + Math.sin(f.t * 1.7 + f.phase) * f.ry;
        f.g.position.set(x, y);
        if (phase === "night") {
          // Fireflies pulse rather than flap.
          f.g.alpha = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(f.t * 4 + f.wing));
        } else {
          // Wingbeat as a horizontal squash — one write, no new objects.
          f.g.alpha = 1;
          f.g.scale.x = 0.55 + 0.45 * Math.abs(Math.sin(f.t * 9 + f.wing));
        }
      }

      if (motes.length > 0) {
        const kind = weather?.kind ?? "clear";
        const drift = kind === "snow" || kind === "petalfall";
        for (const m of motes) {
          m.life += dt;
          m.x += (m.vx + (drift ? Math.sin(m.life * 1.3) * 18 : 0)) * dt;
          m.y += m.vy * dt;
          if (m.spin !== 0) m.g.rotation += m.spin * dt;
          if (m.y > box.height + 12 || m.x < -50 || m.x > box.width + 50) {
            // Recycle in place — the pool never grows or shrinks mid-weather.
            m.x = rng.next() * (box.width + 80) - 40;
            m.y = -rng.next() * 40 - 10;
            m.life = 0;
          }
          m.g.position.set(m.x, m.y);
        }
      }
    },

    objectCount(): number {
      return countObjects(view);
    },

    clear(): void {
      for (const f of flitters) f.g.destroy();
      flitters.length = 0;
      clearMotes();
    },

    destroy(): void {
      view.destroy({ children: true });
    },
  };
}

/** Recursive display-object count — the same shape the perf overlay uses. */
function countObjects(node: Container): number {
  let n = 1;
  for (const child of node.children) {
    n += child instanceof Container ? countObjects(child) : 1;
  }
  return n;
}
