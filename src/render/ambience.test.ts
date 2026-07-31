/**
 * AMBIENT LIFE'S OBJECT BUDGET (round 2K, docs/liveliness-bible.md
 * §5.2/§7.5.7).
 *
 * ⚠️ THE BUDGETS BELOW ARE ASSERTED AS LITERALS ON PURPOSE. Bible §5.2's
 * whole argument — that ambience is affordable — rests on numbers that
 * nothing enforced. A regression in this module (a flitter that forgets
 * to recycle, a weather emitter rebuilt instead of pooled, a skybird that
 * never gets destroyed) does not throw and does not fail a type check; it
 * just makes the game slowly worse on the exact devices least able to
 * absorb it. So a leak is a FAILING TEST here rather than a slow phone
 * three rounds from now.
 *
 * `pixi.js` reads `navigator` at IMPORT time — same shim
 * `spriteResolver.test.ts` / `keepScene.test.ts` already use.
 */

import { describe, expect, it } from "vitest";

Object.defineProperty(globalThis, "navigator", {
  value: { userAgent: "node" },
  configurable: true,
});

const { createAmbience } = await import("./ambience");
const { tuning } = await import("../content/tuning");
const { weatherAt } = await import("../app/weather");

type Ambience = ReturnType<typeof createAmbience>;

const BOUNDS = { width: 390, height: 844, groundTop: 300 };

function make(): Ambience {
  return createAmbience(BOUNDS);
}

/** Live Graphics under the layer — `objectCount()` includes the root
 * container, so the drawable count is one less. */
function drawables(layer: Ambience): number {
  return layer.objectCount() - 1;
}

/** A `WeatherSample` for a kind, without hunting for a seed that rolls it. */
function weather(kind: "clear" | "overcast" | "rain" | "snow" | "petalfall", window = 0) {
  const counts = tuning.liveliness.weather.particleCount;
  return {
    kind,
    window,
    progress: 0,
    desaturate: kind === "overcast" ? 0.12 : 0,
    sunGlowScale: 1,
    particleCount:
      kind === "rain"
        ? counts.rain
        : kind === "snow"
          ? counts.snow
          : kind === "petalfall"
            ? counts.petalfall
            : 0,
  };
}

describe("flitters — the persistent cost, per phase", () => {
  it("starts at the DAY count (the phase an un-told layer assumes)", () => {
    const layer = make();
    expect(drawables(layer)).toBe(tuning.liveliness.ambience.flitterCount.day);
    layer.destroy();
  });

  it("matches the tuned count in every phase, and NIGHT is the expensive one", () => {
    const layer = make();
    const counts = tuning.liveliness.ambience.flitterCount;
    layer.setPhase("day");
    expect(drawables(layer)).toBe(counts.day);
    layer.setPhase("dusk");
    expect(drawables(layer)).toBe(counts.dusk);
    layer.setPhase("night");
    expect(drawables(layer)).toBe(counts.night);
    layer.setPhase("dawn");
    expect(drawables(layer)).toBe(counts.dusk); // dawn borrows dusk's count
    expect(counts.night).toBeGreaterThanOrEqual(counts.day);
    layer.destroy();
  });

  it("does not leak across repeated phase flips — the object count returns", () => {
    const layer = make();
    const before = drawables(layer);
    for (let i = 0; i < 40; i++) {
      layer.setPhase(i % 2 === 0 ? "night" : "day");
    }
    layer.setPhase("day");
    expect(drawables(layer)).toBe(before);
    layer.destroy();
  });

  it("a repeated setPhase to the SAME phase allocates nothing", () => {
    const layer = make();
    layer.setPhase("night");
    const after = drawables(layer);
    for (let i = 0; i < 20; i++) layer.setPhase("night");
    expect(drawables(layer)).toBe(after);
    layer.destroy();
  });
});

describe("weather particles — bible §5.2's worst case", () => {
  it("costs exactly the tuned particle count on top of the flitters", () => {
    const layer = make();
    const base = drawables(layer);
    layer.setWeather(weather("rain"));
    expect(drawables(layer)).toBe(base + tuning.liveliness.weather.particleCount.rain);
    layer.destroy();
  });

  it("clear and overcast cost ZERO particles", () => {
    const layer = make();
    const base = drawables(layer);
    layer.setWeather(weather("clear"));
    expect(drawables(layer)).toBe(base);
    layer.setWeather(weather("overcast", 1));
    expect(drawables(layer)).toBe(base);
    layer.destroy();
  });

  it("swaps pools on a window change without leaking the old one", () => {
    const layer = make();
    const base = drawables(layer);
    layer.setWeather(weather("rain", 0));
    layer.setWeather(weather("snow", 1));
    expect(drawables(layer)).toBe(base + tuning.liveliness.weather.particleCount.snow);
    layer.setWeather(weather("clear", 2));
    expect(drawables(layer)).toBe(base);
    layer.destroy();
  });

  it("re-pushing the SAME window does not rebuild the pool", () => {
    // The rebuild-on-window-edge rule (not on kind): two adjacent windows
    // can roll the same kind, and tearing down 40 live particles then
    // would be a visible hitch for no reason.
    const layer = make();
    layer.setWeather(weather("rain", 5));
    const after = drawables(layer);
    for (let i = 0; i < 10; i++) layer.setWeather(weather("rain", 5));
    expect(drawables(layer)).toBe(after);
    layer.destroy();
  });

  it("recycles particles rather than growing the pool as they fall off-screen", () => {
    const layer = make();
    layer.setWeather(weather("rain"));
    const after = drawables(layer);
    // 10 seconds of rain at 60fps — every streak leaves the screen many
    // times over at 620+ px/s down an 844 px viewport.
    for (let i = 0; i < 600; i++) layer.update(16.7);
    expect(drawables(layer)).toBe(after);
    layer.destroy();
  });
});

/**
 * ⚠️ THE SKYBIRD WAS CUT (see ambience.ts's module doc). Its three tests
 * used to live here, and every one of them passed with ZERO birds: two
 * were upper bounds (`toBeLessThanOrEqual(base + 1)`) and one asserted a
 * night-phase count where the right answer is already zero. A mutation
 * that deleted the whole feature left the suite green.
 *
 * What replaces them is not another skybird test — it is this file
 * proving its OTHER two layers are measured by exact counts, which is why
 * the same mutation against them fails. An upper bound is not a test that
 * a thing exists; it is a test that it does not exist too much.
 */
describe("the layers that survived are pinned by EXACT counts, not upper bounds", () => {
  it("deleting the flitter layer would fail: the count is asserted exactly", () => {
    const layer = make();
    layer.setPhase("night");
    layer.update(16.7);
    expect(drawables(layer)).toBe(tuning.liveliness.ambience.flitterCount.night);
    expect(tuning.liveliness.ambience.flitterCount.night).toBeGreaterThan(0);
    layer.destroy();
  });

  it("deleting the weather layer would fail: the count is asserted exactly", () => {
    const layer = make();
    layer.setPhase("day");
    layer.setWeather(weather("rain"));
    layer.update(16.7);
    expect(drawables(layer)).toBe(
      tuning.liveliness.ambience.flitterCount.day + tuning.liveliness.weather.particleCount.rain,
    );
    expect(tuning.liveliness.weather.particleCount.rain).toBeGreaterThan(0);
    layer.destroy();
  });

  it("nothing transient is ever spawned any more — the count is STABLE over minutes", () => {
    // The property the skybird broke and that its own tests could not
    // check. Six minutes of frames: if any code path starts allocating a
    // one-off drawable again, this catches it whether or not anyone
    // remembers to write it a test.
    const layer = make();
    layer.setPhase("day");
    const base = drawables(layer);
    for (let i = 0; i < 6 * 60 * 60; i++) {
      layer.update(16.7);
      expect(drawables(layer)).toBe(base);
    }
    layer.destroy();
  });
});

describe("THE COMPOSITE BUDGET (bible §5.2's worst realistic case)", () => {
  it("night + rain stays inside the ambience layer's share", () => {
    const layer = make();
    layer.setPhase("night");
    layer.setWeather(weather("rain"));
    let worst = 0;
    for (let i = 0; i < 60 * 60; i++) {
      layer.update(16.7);
      worst = Math.max(worst, layer.objectCount());
    }
    // 1 root + the night flitters + the rain streaks. The literal is the
    // point: if this number moves, someone changed the budget and should
    // have to say so in the diff. (The skybird term is gone — see above.)
    const expected =
      1 +
      tuning.liveliness.ambience.flitterCount.night +
      tuning.liveliness.weather.particleCount.rain;
    expect(worst).toBe(expected);
    expect(worst).toBeLessThanOrEqual(16);
    layer.destroy();
  });

  it("the whole layer is well under the scene budget it has to fit inside", () => {
    // Bible §5.2: the round's ceiling is 310 display objects for the whole
    // scene. Ambience must be a rounding error against the Pips and the
    // placeables, not a competitor.
    const layer = make();
    layer.setPhase("night");
    layer.setWeather(weather("rain"));
    expect(layer.objectCount()).toBeLessThan(
      tuning.liveliness.perfBudget.maxSceneObjects * 0.2,
    );
    layer.destroy();
  });
});

describe("resize", () => {
  it("re-seeds without leaking", () => {
    const layer = make();
    layer.setPhase("night");
    layer.setWeather(weather("snow"));
    const before = drawables(layer);
    for (let i = 0; i < 12; i++) {
      layer.resize({ width: 375 + i, height: 812, groundTop: 280 });
    }
    expect(drawables(layer)).toBe(before);
    layer.destroy();
  });
});

describe("clear() — §5.4's cut, at runtime", () => {
  it("drops every ambient object and leaves only the root", () => {
    const layer = make();
    layer.setPhase("night");
    layer.setWeather(weather("rain"));
    expect(drawables(layer)).toBeGreaterThan(0);
    layer.clear();
    expect(layer.objectCount()).toBe(1);
    layer.destroy();
  });
});

describe("the layer never eats a tap", () => {
  it("is non-interactive, so every tap falls through to the Keep", () => {
    // The whole feature would be a bug if a butterfly could swallow a tap
    // meant for a Pip.
    const layer = make();
    expect(layer.view.eventMode).toBe("none");
    expect(layer.view.interactiveChildren).toBe(false);
    layer.destroy();
  });
});

describe("determinism", () => {
  it("two layers built the same way agree on their object counts", () => {
    // Cosmetic randomness comes from a FIXED render-local seed, never a
    // GameState cursor — so ambience can never desync a save.
    const a = make();
    const b = make();
    a.setPhase("night");
    b.setPhase("night");
    const sample = weatherAt(1234, 0);
    a.setWeather(sample);
    b.setWeather(sample);
    for (let i = 0; i < 120; i++) {
      a.update(16.7);
      b.update(16.7);
    }
    expect(a.objectCount()).toBe(b.objectCount());
    a.destroy();
    b.destroy();
  });
});
