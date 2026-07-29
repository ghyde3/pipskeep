/**
 * Persistence wiring tests (spec §8): ANCHORED autosave debounce (the
 * first unsaved dispatch arms the 2s timer; later dispatches never push
 * it back, so no action waits on disk longer than AUTOSAVE_DEBOUNCE_MS —
 * the Phase 3 gate's "kill-tab loses ≤ 2s" bound, proven below under a
 * continuous 1 Hz TICK stream), immediate flush on visibility→hidden AND
 * on pagehide (Safari's kill-tab event), load-on-init (empty / valid /
 * corrupt), and dispose. The idb layer is an in-memory SaveStore stub;
 * timers are driven by FakeClock so the debounce boundary is tested at
 * exactly AUTOSAVE_DEBOUNCE_MS.
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
  QUARANTINE_KEY_PREFIX,
  initPersistence,
  loadPipskeep,
  quarantineCorruptSave,
  savePipskeepNow,
} from "./persistence";
import type {
  PageHideHost,
  SaveStore,
  TimerHost,
  VisibilityHost,
} from "./persistence";

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

class FakePageHide implements PageHideHost {
  private readonly listeners = new Set<() => void>();

  addEventListener(_type: "pagehide", listener: () => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "pagehide", listener: () => void): void {
    this.listeners.delete(listener);
  }

  fire(): void {
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
  pageHide: FakePageHide;
  saveStore: MemorySaveStore;
  store: Store<GameState, GameAction>;
}

function makeHarness(startAt = 1_000): Harness {
  const clock = new FakeClock(startAt);
  return {
    clock,
    timers: new FakeTimers(clock),
    visibility: new FakeVisibility(),
    pageHide: new FakePageHide(),
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
    pageHide: h.pageHide,
  });
}

describe("loadPipskeep", () => {
  it("reports no save on an empty store", async () => {
    const result = await loadPipskeep(new MemorySaveStore());
    expect(result.save).toBeNull();
    expect(result.loadError).toBeUndefined();
    expect(result.rawBlob).toBeUndefined();
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
    expect(result.loadError?.code).toBe("invalid-field");
    expect(result.rawBlob).toBe(broken);
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

  it("reports loaded: false plus loadError and quarantineKey on a corrupt blob", async () => {
    const h = makeHarness();
    h.saveStore.data.set(LATEST_SAVE_KEY, { schemaVersion: 1 });
    const persistence = await init(h);
    expect(persistence.loaded).toBe(false);
    expect(persistence.loadError).toBeDefined();
    expect(persistence.quarantineKey?.startsWith(QUARANTINE_KEY_PREFIX)).toBe(true);
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

  it("anchors to the FIRST unsaved dispatch: two dispatches 1s apart yield one save, 2s after the first, holding the latest state", async () => {
    const h = makeHarness();
    const persistence = await init(h);
    tick(h); // t = 1000 — arms the timer for t = 3000
    h.timers.advance(1_000); // t = 2000
    tick(h); // must NOT push the timer back
    h.timers.advance(AUTOSAVE_DEBOUNCE_MS - 1_001); // t = 2999
    await settle();
    expect(h.saveStore.puts).toHaveLength(0);

    h.timers.advance(1); // t = 3000 — anchored deadline
    await settle();
    expect(h.saveStore.puts).toHaveLength(1);
    const blob = h.saveStore.puts[0]?.value as SaveBlob;
    expect(blob.savedAt).toBe(3_000);
    // The save carries everything dispatched so far, including the
    // second tick — anchoring bounds latency, it never drops actions.
    expect(blob.state).toBe(h.store.getState());
    persistence.dispose();
  });

  it("gate bound: under a continuous 1 Hz TICK stream, every dispatch is on disk within AUTOSAVE_DEBOUNCE_MS (a re-arming debounce would never save at all)", async () => {
    const h = makeHarness();
    const persistence = await init(h);
    const dispatchTimes: number[] = [];
    for (let i = 0; i < 10; i++) {
      tick(h);
      dispatchTimes.push(h.clock.now());
      h.timers.advance(1_000);
      await settle();
    }
    // Let the final armed timer run out too.
    h.timers.advance(AUTOSAVE_DEBOUNCE_MS);
    await settle();

    const saveTimes = h.saveStore.puts.map(
      (put) => (put.value as SaveBlob).savedAt,
    );
    expect(saveTimes.length).toBeGreaterThan(0);
    // THE Phase 3 claim, verbatim: kill the tab at any instant and the
    // unsaved window behind it is at most AUTOSAVE_DEBOUNCE_MS old.
    for (const at of dispatchTimes) {
      const covered = saveTimes.some(
        (savedAt) => savedAt >= at && savedAt <= at + AUTOSAVE_DEBOUNCE_MS,
      );
      expect(covered, `dispatch at ${at} not saved within ${AUTOSAVE_DEBOUNCE_MS}ms`).toBe(true);
    }
    // And the anchored cadence is exactly one save per debounce window.
    expect(saveTimes).toStrictEqual([3_000, 5_000, 7_000, 9_000, 11_000]);
    persistence.dispose();
  });

  it("a dispatch followed by hidden at 500ms flushes immediately and cancels the pending debounce", async () => {
    const h = makeHarness();
    const persistence = await init(h);
    tick(h); // t = 1000, debounce armed for 3000
    h.timers.advance(500); // t = 1500
    h.visibility.hide();
    await settle();
    expect(h.saveStore.puts).toHaveLength(1);
    const blob = h.saveStore.puts[0]?.value as SaveBlob;
    expect(blob.savedAt).toBe(1_500);
    // The flush persisted the dispatched action's state, not a stale one.
    expect(blob.state).toBe(h.store.getState());
    expect(h.timers.pendingCount()).toBe(0);

    // The canceled debounce never fires a second save.
    h.timers.advance(AUTOSAVE_DEBOUNCE_MS * 2);
    await settle();
    expect(h.saveStore.puts).toHaveLength(1);
    persistence.dispose();
  });

  it("a dispatch followed by pagehide at 500ms flushes immediately (Safari kill-tab path)", async () => {
    const h = makeHarness();
    const persistence = await init(h);
    tick(h); // t = 1000, debounce armed for 3000
    h.timers.advance(500); // t = 1500
    h.pageHide.fire();
    await settle();
    expect(h.saveStore.puts).toHaveLength(1);
    const blob = h.saveStore.puts[0]?.value as SaveBlob;
    expect(blob.savedAt).toBe(1_500);
    expect(blob.state).toBe(h.store.getState());
    expect(h.timers.pendingCount()).toBe(0);

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

  it("dispose() stops autosave, visibility flushes, and pagehide flushes", async () => {
    const h = makeHarness();
    const persistence = await init(h);
    tick(h);
    persistence.dispose();
    h.timers.advance(AUTOSAVE_DEBOUNCE_MS * 2);
    h.visibility.hide();
    h.pageHide.fire();
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

describe("corrupt-save quarantine (spec §8: never destroy the evidence)", () => {
  const BROKEN = { schemaVersion: 1, seed: "definitely not a number" };

  it("stashes the broken blob under quarantine-<timestamp> BEFORE any overwrite of latest", async () => {
    const h = makeHarness(1_000);
    h.saveStore.data.set(LATEST_SAVE_KEY, BROKEN);
    const persistence = await init(h);

    // The quarantine write is the very first put — before any autosave
    // exists that could overwrite the corrupt blob.
    expect(h.saveStore.puts).toHaveLength(1);
    expect(h.saveStore.puts[0]?.key).toBe(`${QUARANTINE_KEY_PREFIX}1000`);
    expect(h.saveStore.puts[0]?.value).toBe(BROKEN);
    expect(persistence.quarantineKey).toBe(`${QUARANTINE_KEY_PREFIX}1000`);
    // Nothing has touched the latest slot yet.
    expect(h.saveStore.data.get(LATEST_SAVE_KEY)).toBe(BROKEN);

    // A fresh game's autosave then overwrites latest — but the evidence
    // is already stashed and stays byte-for-byte intact.
    tick(h);
    h.timers.advance(AUTOSAVE_DEBOUNCE_MS);
    await settle();
    expect(h.saveStore.puts).toHaveLength(2);
    expect(h.saveStore.puts[1]?.key).toBe(LATEST_SAVE_KEY);
    expect(h.saveStore.data.get(`${QUARANTINE_KEY_PREFIX}1000`)).toBe(BROKEN);
    const reloaded = await loadPipskeep(h.saveStore);
    expect(reloaded.save?.state).toStrictEqual(h.store.getState());
    persistence.dispose();
  });

  it("quarantineCorruptSave picks a fresh key on a same-millisecond collision", async () => {
    const saveStore = new MemorySaveStore();
    const first = await quarantineCorruptSave({ a: 1 }, 42, saveStore);
    const second = await quarantineCorruptSave({ b: 2 }, 42, saveStore);
    expect(first).toBe(`${QUARANTINE_KEY_PREFIX}42`);
    expect(second).toBe(`${QUARANTINE_KEY_PREFIX}42-2`);
    expect(saveStore.data.get(first)).toStrictEqual({ a: 1 });
    expect(saveStore.data.get(second)).toStrictEqual({ b: 2 });
  });

  it("does not quarantine on a fresh install or a valid save", async () => {
    const fresh = makeHarness();
    const p1 = await init(fresh);
    expect(p1.quarantineKey).toBeUndefined();
    expect(fresh.saveStore.puts).toHaveLength(0);
    p1.dispose();

    const valid = makeHarness();
    const blob = toSaveBlob(valid.store.getState(), 500);
    valid.saveStore.data.set(LATEST_SAVE_KEY, JSON.parse(JSON.stringify(blob)));
    const p2 = await init(valid);
    expect(p2.quarantineKey).toBeUndefined();
    expect(valid.saveStore.puts).toHaveLength(0);
    p2.dispose();
  });
});
