/**
 * WEATHER (round 2K, docs/liveliness-bible.md §4.3, test plan §7.5.6).
 *
 * Four claims, and the last one is the one that matters:
 *   1. Determinism — the same save at the same instant gets the same
 *      weather on every reload and every device.
 *   2. Window boundaries — weather changes on the window edge and only
 *      there.
 *   3. The weight distribution actually matches the authored table.
 *   4. ⚠️ NOTHING UNDER `src/core/` IMPORTS THIS MODULE. Weather having
 *      no mechanical effect is invariant I4, and the honest enforcement
 *      of "purely cosmetic" is a grep, not a comment — the same shape as
 *      the repo's existing purity greps. A future round that wants
 *      weather to matter has to delete this test in the open.
 */

import { describe, expect, it } from "vitest";
import { FakeClock } from "../core/clock";
import { tuning } from "../content/tuning";
import { OffsetClock } from "./appClock";
import {
  WEATHER_KINDS,
  invitesPlay,
  leavesFootprints,
  seeksShelter,
  weatherAt,
} from "./weather";
import type { WeatherKind } from "./weather";

const WINDOW = tuning.liveliness.weather.windowMs;
const BASE = 1_780_000_000_000;

describe("weatherAt — determinism", () => {
  it("is a pure function of (seed, time): same inputs, same weather, forever", () => {
    for (let i = 0; i < 50; i++) {
      const t = BASE + i * 137_000;
      expect(weatherAt(12345, t)).toEqual(weatherAt(12345, t));
    }
  });

  it("survives a reload — no cursor, no stored field, nothing to lose", () => {
    // Simulated "reload": a brand-new call with nothing carried over.
    const before = weatherAt(999, BASE + 5 * WINDOW + 12_345);
    const after = weatherAt(999, BASE + 5 * WINDOW + 12_345);
    expect(after.kind).toBe(before.kind);
    expect(after.window).toBe(before.window);
  });

  it("gives different saves different weather at the same instant", () => {
    const kinds = new Set<WeatherKind>();
    for (let seed = 0; seed < 200; seed++) {
      kinds.add(weatherAt(seed, BASE).kind);
    }
    // Not a distribution claim — just that the seed is actually an input.
    expect(kinds.size).toBeGreaterThan(1);
  });
});

describe("weatherAt — windows", () => {
  it("holds one weather for a whole window and re-rolls on the edge", () => {
    const start = Math.floor(BASE / WINDOW) * WINDOW;
    const first = weatherAt(7, start);
    for (let ms = 0; ms < WINDOW; ms += WINDOW / 20) {
      const s = weatherAt(7, start + ms);
      expect(s.kind).toBe(first.kind);
      expect(s.window).toBe(first.window);
    }
    expect(weatherAt(7, start + WINDOW).window).toBe(first.window + 1);
  });

  it("reports progress 0..1 through the window", () => {
    const start = Math.floor(BASE / WINDOW) * WINDOW;
    expect(weatherAt(7, start).progress).toBeCloseTo(0, 6);
    expect(weatherAt(7, start + WINDOW / 2).progress).toBeCloseTo(0.5, 6);
    expect(weatherAt(7, start + WINDOW - 1).progress).toBeGreaterThan(0.99);
  });

  it("changes a handful of times a day, not constantly", () => {
    const perDay = 24 * 3_600_000 / WINDOW;
    expect(perDay).toBe(8);
  });
});

describe("weatherAt — distribution", () => {
  it("matches the authored weights within tolerance over 10 000 windows", () => {
    const counts: Record<string, number> = {};
    const N = 10_000;
    for (let w = 0; w < N; w++) {
      const k = weatherAt(4242, w * WINDOW).kind;
      counts[k] = (counts[k] ?? 0) + 1;
    }
    const weights = tuning.liveliness.weather.weights;
    const total = WEATHER_KINDS.reduce((s, k) => s + weights[k], 0);
    for (const k of WEATHER_KINDS) {
      const expected = weights[k] / total;
      const actual = (counts[k] ?? 0) / N;
      // ±3 percentage points is generous for 10k draws and still catches
      // a table that has been silently re-ordered or dropped a kind.
      expect(Math.abs(actual - expected)).toBeLessThan(0.03);
    }
  });

  it("can produce every authored kind", () => {
    const seen = new Set<WeatherKind>();
    for (let w = 0; w < 5000; w++) seen.add(weatherAt(1, w * WINDOW).kind);
    expect([...seen].sort()).toEqual([...WEATHER_KINDS].sort());
  });

  it("keeps the Keep a green meadow: clear + overcast is the clear majority", () => {
    const weights = tuning.liveliness.weather.weights;
    const total = WEATHER_KINDS.reduce((s, k) => s + weights[k], 0);
    expect((weights.clear + weights.overcast) / total).toBeGreaterThan(0.75);
  });

  it("honours a caller-supplied weight table (2C's unused seasonal seam)", () => {
    const allSnow = { clear: 0, overcast: 0, rain: 0, snow: 1, petalfall: 0 };
    for (let w = 0; w < 50; w++) {
      expect(weatherAt(3, w * WINDOW, allSnow).kind).toBe("snow");
    }
  });

  it("falls back to clear rather than throwing on a degenerate table", () => {
    const none = { clear: 0, overcast: 0, rain: 0, snow: 0, petalfall: 0 };
    expect(weatherAt(3, BASE, none).kind).toBe("clear");
  });
});

describe("weatherAt — the injected clock is authoritative", () => {
  it("moves with the debug time slider, exactly like the sky", () => {
    const fake = new FakeClock(BASE);
    const clock = new OffsetClock(fake);
    const before = weatherAt(77, clock.now());
    // Skew far enough to guarantee a different window.
    clock.skew(WINDOW * 3);
    const after = weatherAt(77, clock.now());
    expect(after.window).toBe(before.window + 3);
  });
});

describe("the cosmetic contract", () => {
  it("only rain sends Pips for cover, only snow marks the ground, only petalfall invites play", () => {
    for (const k of WEATHER_KINDS) {
      expect(seeksShelter(k)).toBe(k === "rain");
      expect(leavesFootprints(k)).toBe(k === "snow");
      expect(invitesPlay(k)).toBe(k === "petalfall");
    }
  });

  it("clear weather costs literally nothing", () => {
    const s = weatherAt(1, BASE, { clear: 1, overcast: 0, rain: 0, snow: 0, petalfall: 0 });
    expect(s.particleCount).toBe(0);
    expect(s.desaturate).toBe(0);
    expect(s.sunGlowScale).toBe(1);
  });

  it("never asks for more particles than the tuned cap", () => {
    const caps = tuning.liveliness.weather.particleCount;
    const max = Math.max(caps.rain, caps.snow, caps.petalfall);
    for (let w = 0; w < 500; w++) {
      expect(weatherAt(5, w * WINDOW).particleCount).toBeLessThanOrEqual(max);
    }
    // The existing pooled emitter budget (render/particles.ts) is 41.
    expect(max).toBeLessThanOrEqual(41);
  });
});

/**
 * ⚠️ INVARIANT I4, ENFORCED RATHER THAN ASSERTED (bible §4.3).
 *
 * Weather is mood only. The way that stops being true is not a designer
 * changing their mind in the open — it is one `import { weatherAt }` in a
 * core module, six months from now, to make rain "just slightly" change
 * something. This grep is the thing that fails then.
 */
describe("I4: core/ never learns what the weather is", () => {
  const coreFiles = import.meta.glob("../core/**/*.ts", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;

  it("finds core files to check (a glob that matches nothing proves nothing)", () => {
    expect(Object.keys(coreFiles).length).toBeGreaterThan(50);
  });

  it("no file under src/core/ imports app/weather", () => {
    const offenders: string[] = [];
    for (const [path, text] of Object.entries(coreFiles)) {
      if (/from\s+["'][^"']*app\/weather["']/.test(text) || /weatherAt\s*\(/.test(text)) {
        offenders.push(path);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no file under src/core/ mentions a weather kind as a behavioural branch", () => {
    // Deliberately narrow: the words appear in content flavour text
    // (`weathered driftwood`) and would make a bare word-search useless.
    // What is banned is a core module BRANCHING on a weather kind.
    const offenders: string[] = [];
    for (const [path, text] of Object.entries(coreFiles)) {
      if (/WeatherKind|seeksShelter|leavesFootprints|invitesPlay/.test(text)) {
        offenders.push(path);
      }
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * ⚠️ ROUND 2K FIX STAGE — THE CONSUMER GUARD.
 *
 * The suite above is a PURITY guard: it proves no `core/` module branches
 * on the weather. Nothing proved the opposite direction — that the render
 * layer actually branches on it — and one of the three predicates shipped
 * unused. `invitesPlay` appeared in `render/keepScene.ts` exactly once, on
 * the import line: petalfall's "something in the air worth batting at"
 * beat was designed, exported, documented, imported, and then fed by
 * nobody, while rain's and snow's equivalents both worked.
 *
 * That is spec §16 v1.3's dead-feature shape for the tenth time, and it
 * shipped inside the round whose brief was to close the ninth. A weather
 * predicate that nothing consumes is not a seam; it is a lie about what
 * the game does when it rains.
 *
 * `tsconfig.json` sets no `noUnusedLocals`, so the compiler will not do
 * this. This test will.
 */
describe("every weather predicate has a real consumer (the tenth dead feature)", () => {
  const renderFiles = import.meta.glob("../render/**/*.ts", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;

  const PREDICATES = ["seeksShelter", "leavesFootprints", "invitesPlay"] as const;

  /** Every occurrence outside an `import` statement, comment or doc. */
  function callSites(source: string, name: string): number {
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "")
      .replace(/import\s+[\s\S]*?from\s+["'][^"']+["'];?/g, "");
    return [...code.matchAll(new RegExp(`\\b${name}\\s*\\(`, "g"))].length;
  }

  it("finds render files to check (a glob that matches nothing proves nothing)", () => {
    expect(Object.keys(renderFiles).length).toBeGreaterThan(3);
    expect(PREDICATES.length).toBe(3);
  });

  it.each(PREDICATES)("'%s' is CALLED somewhere in render/, not merely imported", (name) => {
    const total = Object.values(renderFiles).reduce((n, src) => n + callSites(src, name), 0);
    expect(
      total,
      `'${name}' has no call site under src/render/. It is exported, documented and imported — ` +
        `and the game does nothing with it. Either wire the behaviour it describes, or delete it.`,
    ).toBeGreaterThan(0);
  });

  it("guards against a vacuous matcher: an invented predicate finds nothing", () => {
    const total = Object.values(renderFiles).reduce(
      (n, src) => n + callSites(src, "seeksNothingAtAll"),
      0,
    );
    expect(total).toBe(0);
  });
});
