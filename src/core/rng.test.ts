import { describe, expect, it } from "vitest";
import { createRng, createRngFromState, fnv1a } from "./rng";

function draw(count: number, next: () => number): number[] {
  return Array.from({ length: count }, () => next());
}

describe("golden known-answer vectors (algorithm pin)", () => {
  // These constants were precomputed from INDEPENDENT reference
  // implementations (canonical FNV-1a via BigInt arithmetic; bryc's
  // textbook mulberry32) — not from this repo's code. Self-comparison
  // tests prove determinism but never pin the algorithm; these do.
  // If one of these fails, the algorithm changed — which silently breaks
  // every saved stream cursor across app versions ("reloading never
  // re-rolls or skips an outcome", rng.ts header). Do not "fix" the
  // constants; fix the algorithm.

  it("fnv1a matches the published FNV-1a 32-bit test vectors", () => {
    expect(fnv1a("")).toBe(0x811c9dc5); // the FNV offset basis
    expect(fnv1a("a")).toBe(0xe40c292c);
    expect(fnv1a("foobar")).toBe(0xbf9cf968);
    expect(fnv1a("expedition-loot")).toBe(0x75e5ad77);
  });

  it("streams are exactly mulberry32 seeded with seed XOR fnv1a(name)", () => {
    // First five raw uint32 outputs of mulberry32(12345 ^ fnv1a("expedition-loot")),
    // i.e. mulberry32(0x75e59d4e).
    const expectedU32 = [0xa5d08c55, 0x6777629c, 0x83abb521, 0x29c4844c, 0xa9d364ec];
    const s = createRng(12345).stream("expedition-loot");
    for (const u32 of expectedU32) {
      expect(s.next()).toBe(u32 / 2 ** 32);
    }
  });

  it("degenerate corner pins too: seed 0, empty stream name", () => {
    // mulberry32(0 ^ fnv1a("")) = mulberry32(0x811c9dc5).
    const s = createRng(0).stream("");
    expect(s.next()).toBe(0x9c7a8434 / 2 ** 32);
    expect(s.next()).toBe(0x7e579ba5 / 2 ** 32);
    expect(s.next()).toBe(0xc6267ea9 / 2 ** 32);
  });
});

describe("fnv1a", () => {
  it("is deterministic and 32-bit unsigned", () => {
    expect(fnv1a("expedition-loot")).toBe(fnv1a("expedition-loot"));
    expect(fnv1a("expedition-loot")).not.toBe(fnv1a("egg-traits"));
    const h = fnv1a("anything");
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(h)).toBe(true);
  });
});

describe("createRng", () => {
  it("same seed => identical sequences", () => {
    const a = createRng(12345).stream("expedition-loot");
    const b = createRng(12345).stream("expedition-loot");
    expect(draw(50, () => a.next())).toEqual(draw(50, () => b.next()));
  });

  it("different seeds => different sequences", () => {
    const a = createRng(1).stream("expedition-loot");
    const b = createRng(2).stream("expedition-loot");
    expect(draw(10, () => a.next())).not.toEqual(draw(10, () => b.next()));
  });

  it("different stream names => different sequences", () => {
    const rng = createRng(12345);
    const loot = rng.stream("expedition-loot");
    const eggs = rng.stream("egg-traits");
    expect(draw(10, () => loot.next())).not.toEqual(draw(10, () => eggs.next()));
  });

  it("streams are independent — drawing from one does not perturb another", () => {
    const solo = createRng(7).stream("a");
    const expected = draw(10, () => solo.next());

    const rng = createRng(7);
    const a = rng.stream("a");
    const b = rng.stream("b");
    const interleaved: number[] = [];
    for (let i = 0; i < 10; i++) {
      interleaved.push(a.next());
      b.next(); // noise on another stream
    }
    expect(interleaved).toEqual(expected);
  });

  it("stream(name) returns the same stream object for the same name", () => {
    const rng = createRng(99);
    expect(rng.stream("x")).toBe(rng.stream("x"));
  });

  it("next() stays in [0, 1)", () => {
    const s = createRng(0xdeadbeef).stream("range");
    for (let i = 0; i < 1_000; i++) {
      const v = s.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("state round-trip", () => {
  it("getState/createRngFromState => identical continuation", () => {
    const original = createRng(42);
    const loot = original.stream("expedition-loot");
    const eggs = original.stream("egg-traits");
    draw(17, () => loot.next());
    draw(5, () => eggs.next());

    const snapshot = original.getState();
    const restored = createRngFromState(42, snapshot);

    // Continuations must match draw-for-draw on every stream.
    expect(draw(25, () => restored.stream("expedition-loot").next())).toEqual(
      draw(25, () => loot.next()),
    );
    expect(draw(25, () => restored.stream("egg-traits").next())).toEqual(
      draw(25, () => eggs.next()),
    );
  });

  it("snapshot only contains touched streams; untouched streams derive from seed", () => {
    const rng = createRng(42);
    rng.stream("touched").next();
    const snapshot = rng.getState();
    expect(Object.keys(snapshot)).toEqual(["touched"]);

    // A stream never drawn before the save must still match a fresh derivation.
    const restored = createRngFromState(42, snapshot);
    const fresh = createRng(42);
    expect(draw(10, () => restored.stream("never-touched").next())).toEqual(
      draw(10, () => fresh.stream("never-touched").next()),
    );
  });

  it("stream cursors are 32-bit unsigned integers (save-serializable)", () => {
    const rng = createRng(1234);
    const s = rng.stream("cursor");
    draw(3, () => s.next());
    const state = rng.getState();
    const cursor = state["cursor"];
    expect(cursor).toBeDefined();
    expect(Number.isInteger(cursor)).toBe(true);
    expect(cursor).toBeGreaterThanOrEqual(0);
    expect(cursor).toBeLessThanOrEqual(0xffffffff);
    expect(s.getState()).toBe(cursor);
  });

  it("restoring mid-sequence never re-rolls or skips an outcome", () => {
    // Reference sequence, no save/load involved.
    const reference = createRng(777).stream("s");
    const full = draw(30, () => reference.next());

    // Same sequence but saved/restored after every single draw.
    let rng = createRng(777);
    const replayed: number[] = [];
    for (let i = 0; i < 30; i++) {
      replayed.push(rng.stream("s").next());
      rng = createRngFromState(777, rng.getState());
    }
    expect(replayed).toEqual(full);
  });
});

describe("derived helpers determinism", () => {
  it("int() is deterministic and within [0, maxExclusive)", () => {
    const a = createRng(9).stream("ints");
    const b = createRng(9).stream("ints");
    for (let i = 0; i < 200; i++) {
      const v = a.int(6);
      expect(v).toBe(b.int(6));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it("int() rejects non-positive or non-integer bounds", () => {
    const s = createRng(9).stream("ints");
    expect(() => s.int(0)).toThrow(RangeError);
    expect(() => s.int(-3)).toThrow(RangeError);
    expect(() => s.int(2.5)).toThrow(RangeError);
  });

  it("pick() is deterministic and returns array elements", () => {
    const items = ["berry", "fiber", "wood", "shell", "driftwood"] as const;
    const a = createRng(31).stream("loot");
    const b = createRng(31).stream("loot");
    for (let i = 0; i < 100; i++) {
      const v = a.pick(items);
      expect(v).toBe(b.pick(items));
      expect(items).toContain(v);
    }
  });

  it("pick() throws on an empty array", () => {
    const s = createRng(31).stream("loot");
    expect(() => s.pick([])).toThrow(RangeError);
  });

  it("chance() is deterministic, chance(0) never, chance(1) always", () => {
    const a = createRng(55).stream("chance");
    const b = createRng(55).stream("chance");
    for (let i = 0; i < 100; i++) {
      expect(a.chance(0.3)).toBe(b.chance(0.3));
    }
    const zero = createRng(55).stream("zero");
    const one = createRng(55).stream("one");
    for (let i = 0; i < 100; i++) {
      expect(zero.chance(0)).toBe(false);
      expect(one.chance(1)).toBe(true);
    }
  });

  it("helpers consume the same cursor as next() (state round-trips through them)", () => {
    const rng = createRng(63);
    const s = rng.stream("mixed");
    s.int(10);
    s.pick([1, 2, 3]);
    s.chance(0.5);

    const restored = createRngFromState(63, rng.getState()).stream("mixed");
    expect(restored.next()).toBe(s.next());
  });
});
