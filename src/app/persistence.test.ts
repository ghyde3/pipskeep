/**
 * Persistence wiring tests (spec §8): debounced autosave (2s trailing,
 * re-armed by every dispatch), immediate flush on visibility→hidden,
 * load-on-init (empty / valid / corrupt), and dispose. The idb layer is
 * an in-memory SaveStore stub; timers are driven by FakeClock so the
 * debounce boundary is tested at exactly AUTOSAVE_DEBOUNCE_MS.
 */

import { describe, expect, it } from "vitest";
import { FakeClock } from "../core/clock";
import { createStore } from "../core/store";
import type { Store } from "../core/store";
import { createNewGame, rootReducer } from "../core/state";
import type { GameAction, GameState } from "../core/state";
import { toSaveBlob } from "../core/save/serialize";
import type { SaveBlob } from "../core/save/serialize";
import {
  AUTOSAVE_DEBOUNCE_MS,
  LATEST_SAVE_KEY,
  initPersistence,
  loadPipskeep,
  savePipskeepNow,
} from "./persistence";
import type { SaveStore, TimerHost, VisibilityHost } from "./persistence";

const SEED = 7;

class MemorySaveStore implements SaveStore {
  readonly data = new Map<string, unknown>();
  readonly puts: Array<{ key: string; value: unknown }> = [];
  gets = 0;

  get(key: string): Promise<unknown> {
    this.gets += 1;
    return Promise.resolve(this.data.get(key));
  }

  put(key: string, value: unknown): Promise<void> {
    this.data.set(key, value);
    this.puts.push({ key, value });
    return Promise.resolve();
  }
}

/** FakeClock-driven timers: advance() moves the clock and fires due
 * callbacks in timestamp order, so debounce boundaries are exact. */
class FakeTimers implements TimerHost {
  private nextId = 1;
  private readonly tasks = new Map<number, { at: number; fn: () => void }>();

  constructor(private readonly clock: FakeClock) {}

  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.tasks.set(id, { at: this.clock.now() + ms, fn });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.tasks.delete(handle as number);
  }

  advance(ms: number): void {
    const target = this.clock.now() + ms;
    for (;;) {
      let dueId: number | null = null;
      let dueAt = Number.POSITIVE_INFINITY;
      for (const [id, task] of this.tasks) {
        if (task.at <= target && task.at < dueAt) {
          dueId = id;
          dueAt = task.at;
        }
      }
      if (dueId === null) break;
      const task = this.tasks.get(dueId);
      this.tasks.delete(dueId);
      if (task !== undefined) {
        this.clock.set(task.at);
        task.fn();
      }
    }
    this.clock.set(target);
  }

  pendingCount(): number {
    return this.tasks.size;
  }
}

class FakeVisibility implements VisibilityHost {
  visibilityState = "visible";
  private readonly listeners = new Set<() => void>();

  addEventListener(_type: "visibilitychange", listener: () => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "visibilitychange", listener: () => void): void {
    this.listeners.delete(listener);
  }

  hide(): void {
    this.visibilityState = "hidden";
    for (const listener of [...this.listeners]) listener();
  }
}

/** Let the async save promise chain settle after a synchronous trigger. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

interface Harness {
  clock: FakeClock;
  timers: FakeTimers;
  visibility: FakeVisibility;
  saveStore: MemorySaveStore;
  store: Store<GameState, GameAction>;
}

function makeHarness(startAt = 1_000): Harness {
  const clock = new FakeClock(startAt);
  return {
    clock,
    timers: new FakeTimers(clock),
    visibility: new FakeVisibility(),
    saveStore: new MemorySaveStore(),
    store: createStore(rootReducer, createNewGame(SEED, startAt)),
  };
}

function tick(h: Harness): void {
  h.store.dispatch({ type: "TICK", at: h.clock.now() });
}

async function init(h: Harness) {
  return initPersistence(h.store, h.clock, {
    saveStore: h.saveStore,
    timers: h.timers,
    visibility: h.visibility,
  });
}

describe("loadPipskeep", () => {
  it("reports no save on an empty store", async () => {
    const result = await loadPipskeep(new MemorySaveStore());
    expect(result.save).toBeNull();
    expect(result.error).toBeUndefined();
  });

  it("returns a migrated, validated blob when one exists", async () => {
    const h = makeHarness();
    const blob = toSaveBlob(h.store.getState(), 12_345);
    h.saveStore.data.set(LATEST_SAVE_KEY, JSON.parse(JSON.stringify(blob)));
    const result = await loadPipskeep(h.saveStore);
    expect(result.save).not.toBeNull();
    expect(result.save?.savedAt).toBe(12_345);
    expect(result.save?.state).toStrictEqual(h.store.getState());
  });

  it("surfaces a corrupt blob as a typed error plus the raw blob", async () => {
    const h = makeHarness();
    const broken = { schemaVersion: 1, seed: "nope" };
    h.saveStore.data.set(LATEST_SAVE_KEY, broken);
    const result = await loadPipskeep(h.saveStore);
    expect(result.save).toBeNull();
    expect(result.error?.code).toBe("invalid-field");
    expect(result.raw).toBe(broken);
  });
});

describe("savePipskeepNow", () => {
  it("writes the current state under the latest key, stamped by the clock", async () => {
    const h = makeHarness(50_000);
    const blob = await savePipskeepNow(h.store, h.clock, h.saveStore);
    expect(h.saveStore.puts).toHaveLength(1);
    expect(h.saveStore.puts[0]?.key).toBe(LATEST_SAVE_KEY);
    expect(blob.savedAt).toBe(50_000);
    expect((h.saveStore.puts[0]?.value as SaveBlob).state).toBe(h.store.getState());
  });
});

describe("initPersistence load-on-init", () => {
  it("reports loaded: false on a fresh install", async () => {
    const h = makeHarness();
    const persistence = await init(h);
    expect(persistence.loaded).toBe(false);
    expect(persistence.savedAt).toBeUndefined();
    expect(h.saveStore.puts).toHaveLength(0);
    persistence.dispose();
  });

  it("reports loaded: true with savedAt and the blob when a save exists", async () => {
    const h = makeHarness();
    const stored = toSaveBlob(h.store.getState(), 12_345);
    h.saveStore.data.set(LATEST_SAVE_KEY, JSON.parse(JSON.stringify(stored)));
    const persistence = await init(h);
    expect(persistence.loaded).toBe(true);
    expect(persistence.savedAt).toBe(12_345);
    expect(persistence.save?.state).toStrictEqual(h.store.getState());
    persistence.dispose();
  });

  it("reports loaded: false plus loadError on a corrupt blob", async () => {
    const h = makeHarness();
    h.saveStore.data.set(LATEST_SAVE_KEY, { schemaVersion: 1 });
    const persistence = await init(h);
    expect(persistence.loaded).toBe(false);
    expect(persistence.loadError).toBeDefined();
    persistence.dispose();
  });

  it("uses a preloaded LoadResult instead of reading again", async () => {
    const h = makeHarness();
    const preloaded = await loadPipskeep(h.saveStore);
    const getsAfterPreload = h.saveStore.gets;
    const persistence = await initPersistence(h.store, h.clock, {
      saveStore: h.saveStore,
      timers: h.timers,
      visibility: h.visibility,
      preloaded,
    });
    expect(h.saveStore.gets).toBe(getsAfterPreload);
    persistence.dispose();
  });
});

describe("autosave debounce (2s trailing, FakeClock-driven)", () => {
  it("saves exactly once, AUTOSAVE_DEBOUNCE_MS after a dispatch — not before", async () => {
    const h = makeHarness();
    const persistence = await init(h);
    tick(h);
    expect(h.saveStore.puts).toHaveLength(0);

    h.timers.advance(AUTOSAVE_DEBOUNCE_MS - 1);
    await settle();
    expect(h.saveStore.puts).toHaveLength(0);

    h.timers.advance(1);
    await settle();
    expect(h.saveStore.puts).toHaveLength(1);
    const blob = h.saveStore.puts[0]?.value as SaveBlob;
    expect(blob.savedAt).toBe(1_000 + AUTOSAVE_DEBOUNCE_MS);
    expect(blob.state).toBe(h.store.getState());
    persistence.dispose();
  });

  it("re-arms on every dispatch: two dispatches 1s apart yield one save, 2s after the last", async () => {
    const h = makeHarness();
    const persistence = await init(h);
    tick(h); // t = 1000
    h.timers.advance(1_000); // t = 2000
    tick(h); // re-arms to t = 4000
    h.timers.advance(AUTOSAVE_DEBOUNCE_MS - 1); // t = 3999
    await settle();
    expect(h.saveStore.puts).toHaveLength(0);

    h.timers.advance(1); // t = 4000
    await settle();
    expect(h.saveStore.puts).toHaveLength(1);
    expect((h.saveStore.puts[0]?.value as SaveBlob).savedAt).toBe(4_000);
    persistence.dispose();
  });

  it("flushes immediately on visibility→hidden and cancels the pending debounce", async () => {
    const h = makeHarness();
    const persistence = await init(h);
    tick(h); // t = 1000, debounce armed for 3000
    h.timers.advance(500); // t = 1500
    h.visibility.hide();
    await settle();
    expect(h.saveStore.puts).toHaveLength(1);
    expect((h.saveStore.puts[0]?.value as SaveBlob).savedAt).toBe(1_500);
    expect(h.timers.pendingCount()).toBe(0);

    // The canceled debounce never fires a second save.
    h.timers.advance(AUTOSAVE_DEBOUNCE_MS * 2);
    await settle();
    expect(h.saveStore.puts).toHaveLength(1);
    persistence.dispose();
  });

  it("saveNow() flushes immediately and disarms the pending debounce", async () => {
    const h = makeHarness();
    const persistence = await init(h);
    tick(h);
    const blob = await persistence.saveNow();
    expect(blob.savedAt).toBe(1_000);
    expect(h.saveStore.puts).toHaveLength(1);
    h.timers.advance(AUTOSAVE_DEBOUNCE_MS * 2);
    await settle();
    expect(h.saveStore.puts).toHaveLength(1);
    persistence.dispose();
  });

  it("dispose() stops autosave and visibility flushes", async () => {
    const h = makeHarness();
    const persistence = await init(h);
    tick(h);
    persistence.dispose();
    h.timers.advance(AUTOSAVE_DEBOUNCE_MS * 2);
    h.visibility.hide();
    await settle();
    expect(h.saveStore.puts).toHaveLength(0);
  });

  it("round-trips through the autosaved blob: what autosave wrote loads back deep-equal", async () => {
    const h = makeHarness();
    const persistence = await init(h);
    tick(h);
    h.timers.advance(AUTOSAVE_DEBOUNCE_MS);
    await settle();
    const wire = JSON.parse(JSON.stringify(h.saveStore.data.get(LATEST_SAVE_KEY)));
    const fresh = new MemorySaveStore();
    fresh.data.set(LATEST_SAVE_KEY, wire);
    const reloaded = await loadPipskeep(fresh);
    expect(reloaded.save?.state).toStrictEqual(h.store.getState());
    persistence.dispose();
  });
});
