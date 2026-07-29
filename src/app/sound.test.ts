/**
 * The seam itself: `sound(slotId)`, the autoplay unlock, and the mute
 * preference round-trip.
 *
 * Everything is injected — the AudioContext factory, the gesture source,
 * the preference store — so this runs in the repo's node test env with no
 * browser, no DOM, and no IndexedDB.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createStubAudioContext } from "./audio/stubContext";
import type { StubAudioContext } from "./audio/stubContext";
import {
  initSound,
  resetSound,
  sound,
  SOUND_DEFAULT_MUTED,
  SOUND_PREF_KEY,
} from "./sound";
import type { GestureHost, SoundPrefStore } from "./sound";

class FakeGestureHost implements GestureHost {
  private readonly listeners = new Map<string, Set<() => void>>();

  addEventListener(type: string, listener: () => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  fire(type = "pointerdown"): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }

  get attached(): number {
    let total = 0;
    for (const set of this.listeners.values()) total += set.size;
    return total;
  }
}

function fakePrefs(initial?: unknown): SoundPrefStore & { written: unknown[] } {
  const written: unknown[] = [];
  return {
    written,
    get: (key) => Promise.resolve(key === SOUND_PREF_KEY ? initial : undefined),
    put: (key, value) => {
      if (key === SOUND_PREF_KEY) written.push(value);
      return Promise.resolve();
    },
  };
}

function stub(): StubAudioContext {
  return createStubAudioContext({ sampleRate: 4000 });
}

afterEach(() => {
  resetSound();
});

describe("sound() — always safe to call", () => {
  it("is a silent no-op before initSound (every unit test in the repo relies on this)", () => {
    expect(() => {
      sound("care.feed");
      sound("ui.tap");
      sound("anything.at.all");
    }).not.toThrow();
  });

  it("is a no-op again after resetSound", async () => {
    const ctx = stub();
    const host = new FakeGestureHost();
    await initSound({ createContext: () => ctx, gestureHost: host });
    host.fire();
    resetSound();
    ctx.clearNodes();
    sound("care.feed");
    expect(ctx.oscillators).toHaveLength(0);
  });
});

describe("autoplay unlock", () => {
  it("stays silent until the player touches the page, then plays", async () => {
    const ctx = stub();
    const host = new FakeGestureHost();
    const controller = await initSound({
      createContext: () => ctx,
      gestureHost: host,
    });

    expect(controller.isReady()).toBe(false);
    sound("care.feed");
    expect(ctx.oscillators).toHaveLength(0);

    host.fire("pointerdown");
    expect(controller.isReady()).toBe(true);
    sound("care.feed");
    expect(ctx.oscillators.length).toBeGreaterThan(0);
  });

  it("accepts a keypress as the unlocking gesture (keyboard players count)", async () => {
    const ctx = stub();
    const host = new FakeGestureHost();
    const controller = await initSound({
      createContext: () => ctx,
      gestureHost: host,
    });
    host.fire("keydown");
    expect(controller.isReady()).toBe(true);
  });

  it("detaches its gesture listeners once unlocked", async () => {
    const ctx = stub();
    const host = new FakeGestureHost();
    await initSound({ createContext: () => ctx, gestureHost: host });
    expect(host.attached).toBeGreaterThan(0);
    host.fire();
    expect(host.attached).toBe(0);
  });

  it("works with no gesture source at all (node, tests) without throwing", async () => {
    const controller = await initSound({
      createContext: stub,
      gestureHost: null,
    });
    expect(controller.isReady()).toBe(false);
    expect(() => sound("ui.tap")).not.toThrow();
  });

  it("never rejects when the browser has no Web Audio", async () => {
    const controller = await initSound({
      createContext: () => {
        throw new Error("no AudioContext");
      },
      gestureHost: new FakeGestureHost(),
    });
    expect(controller.isReady()).toBe(false);
    expect(() => sound("care.feed")).not.toThrow();
  });
});

describe("mute preference", () => {
  it("defaults to sound ON for a new player", async () => {
    const prefs = fakePrefs(undefined);
    const controller = await initSound({
      prefs,
      createContext: stub,
      gestureHost: null,
    });
    expect(SOUND_DEFAULT_MUTED).toBe(false);
    expect(controller.isMuted()).toBe(false);
  });

  it("restores a stored preference", async () => {
    const controller = await initSound({
      prefs: fakePrefs({ muted: true }),
      createContext: stub,
      gestureHost: null,
    });
    expect(controller.isMuted()).toBe(true);
  });

  it("ignores a junk record rather than breaking boot", async () => {
    for (const junk of [null, 42, "muted", {}, { muted: "yes" }]) {
      const controller = await initSound({
        prefs: fakePrefs(junk),
        createContext: stub,
        gestureHost: null,
      });
      expect(controller.isMuted()).toBe(false);
      controller.dispose();
    }
  });

  it("survives a preference store that fails to read", async () => {
    const prefs: SoundPrefStore = {
      get: () => Promise.reject(new Error("idb is having a day")),
      put: () => Promise.resolve(),
    };
    const controller = await initSound({
      prefs,
      createContext: stub,
      gestureHost: null,
    });
    expect(controller.isMuted()).toBe(false);
  });

  it("persists every change under its own key", async () => {
    const prefs = fakePrefs(undefined);
    const controller = await initSound({
      prefs,
      createContext: stub,
      gestureHost: null,
    });
    expect(controller.toggle()).toBe(true);
    expect(controller.toggle()).toBe(false);
    expect(prefs.written).toEqual([{ muted: true }, { muted: false }]);
  });

  it("does not write when nothing changed", async () => {
    const prefs = fakePrefs(undefined);
    const controller = await initSound({
      prefs,
      createContext: stub,
      gestureHost: null,
    });
    controller.setMuted(false);
    expect(prefs.written).toEqual([]);
  });

  it("works with no preference store — session-only, still functional", async () => {
    const controller = await initSound({ createContext: stub, gestureHost: null });
    expect(() => controller.setMuted(true)).not.toThrow();
    expect(controller.isMuted()).toBe(true);
  });
});

describe("mute behaviour", () => {
  it("silences the seam and restores it", async () => {
    const ctx = stub();
    const host = new FakeGestureHost();
    const controller = await initSound({
      createContext: () => ctx,
      gestureHost: host,
    });
    host.fire();

    controller.setMuted(true);
    ctx.clearNodes();
    sound("care.feed");
    sound("egg.hatch");
    expect(ctx.oscillators).toHaveLength(0);

    controller.setMuted(false);
    sound("care.feed");
    expect(ctx.oscillators.length).toBeGreaterThan(0);
  });

  it("boots muted when the stored preference says so — before any gesture", async () => {
    const ctx = stub();
    const host = new FakeGestureHost();
    await initSound({
      prefs: fakePrefs({ muted: true }),
      createContext: () => ctx,
      gestureHost: host,
    });
    host.fire();
    sound("care.feed");
    expect(ctx.oscillators).toHaveLength(0);
    // The master gain was built already muted, not ramped down after.
    expect(ctx.gains[0]?.gain.events[0]?.value).toBe(0);
  });

  it("notifies subscribers (the button re-renders from this)", async () => {
    const controller = await initSound({ createContext: stub, gestureHost: null });
    const seen: boolean[] = [];
    const unsubscribe = controller.subscribe((muted) => seen.push(muted));
    controller.toggle();
    controller.toggle();
    unsubscribe();
    controller.toggle();
    expect(seen).toEqual([true, false]);
  });
});

describe("controller lifecycle", () => {
  it("play() returns the scheduled plan, or null when refused", async () => {
    const ctx = stub();
    const host = new FakeGestureHost();
    const controller = await initSound({
      createContext: () => ctx,
      gestureHost: host,
    });
    expect(controller.play("care.feed")).toBeNull(); // still locked
    host.fire();
    const plan = controller.play("care.feed");
    expect(plan?.slot).toBe("care.feed");
    expect(plan?.voices.length).toBeGreaterThan(0);
    expect(controller.play("care.feed")).toBeNull(); // cooldown
  });

  it("a second initSound replaces the first engine", async () => {
    const first = stub();
    const second = stub();
    const hostA = new FakeGestureHost();
    const hostB = new FakeGestureHost();
    await initSound({ createContext: () => first, gestureHost: hostA });
    hostA.fire();
    await initSound({ createContext: () => second, gestureHost: hostB });
    hostB.fire();
    first.clearNodes();
    sound("care.feed");
    expect(first.oscillators).toHaveLength(0);
    expect(second.oscillators.length).toBeGreaterThan(0);
  });

  it("dispose() detaches listeners, closes the context and mutes the seam", async () => {
    const ctx = stub();
    const host = new FakeGestureHost();
    const controller = await initSound({
      createContext: () => ctx,
      gestureHost: host,
    });
    host.fire();
    controller.dispose();
    expect(host.attached).toBe(0);
    expect(ctx.closeCalls).toBe(1);
    ctx.clearNodes();
    sound("care.feed");
    expect(ctx.oscillators).toHaveLength(0);
  });

  it("uses core/rng, never Math.random", async () => {
    const spy = vi.spyOn(Math, "random");
    const ctx = stub();
    const host = new FakeGestureHost();
    await initSound({ createContext: () => ctx, gestureHost: host });
    host.fire(); // builds the noise buffer — the most random-hungry step
    for (const slot of ["care.feed", "egg.hatchShiny", "parade.kazoo"]) {
      sound(slot);
    }
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
