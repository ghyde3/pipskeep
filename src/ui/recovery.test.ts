/**
 * Corrupt-save recovery flow (spec §8) — logic-level tests, node env.
 *
 * The DOM shell (showRecoveryModal) is a thin wrapper; everything with a
 * decision in it lives in the pure controller and is tested here:
 * download is repeatable and never starts a game, Start Fresh fires
 * exactly once and only on an explicit call, and the export JSON is the
 * raw blob verbatim. The final describe drives the whole boot-decision
 * sequence against an in-memory SaveStore to prove the stored corrupt
 * blob survives untouched until the choice, then gets quarantined
 * before the fresh game's first write.
 */

import { describe, expect, it } from "vitest";
import { FakeClock } from "../core/clock";
import { createStore } from "../core/store";
import { createNewGame, rootReducer } from "../core/state";
import {
  LATEST_SAVE_KEY,
  QUARANTINE_KEY_PREFIX,
  initPersistence,
  loadPipskeep,
} from "../app/persistence";
import type { SaveStore, TimerHost } from "../app/persistence";
import { brokenSaveFilename, createRecoveryController } from "./recovery";

const RAW_BLOB = { schemaVersion: 1, seed: "scrambled", extra: [1, 2, 3] };
const EXPORTED_AT = 1_753_747_200_000; // 2025-07-29T00:00:00.000Z

interface Spy {
  downloads: Array<{ filename: string; json: string }>;
  freshStarts: number;
}

function makeController(rawBlob: unknown = RAW_BLOB) {
  const spy: Spy = { downloads: [], freshStarts: 0 };
  const controller = createRecoveryController({
    rawBlob,
    exportedAt: EXPORTED_AT,
    download: (filename, json) => spy.downloads.push({ filename, json }),
    onStartFresh: () => {
      spy.freshStarts += 1;
    },
  });
  return { controller, spy };
}

describe("recovery controller", () => {
  it("never starts fresh on its own — construction has no side effects", () => {
    const { spy } = makeController();
    expect(spy.freshStarts).toBe(0);
    expect(spy.downloads).toHaveLength(0);
  });

  it("names the export after the injected timestamp, deterministically", () => {
    const { controller } = makeController();
    expect(controller.filename).toBe(
      "pipskeep-broken-save-2025-07-29T00-00-00-000Z.json",
    );
    expect(brokenSaveFilename(EXPORTED_AT)).toBe(controller.filename);
  });

  it("downloads the raw blob as JSON, repeatably, without starting fresh", () => {
    const { controller, spy } = makeController();
    controller.downloadBrokenSave();
    controller.downloadBrokenSave();
    expect(spy.downloads).toHaveLength(2);
    expect(spy.downloads[0]?.filename).toBe(controller.filename);
    expect(JSON.parse(spy.downloads[0]?.json ?? "")).toStrictEqual(RAW_BLOB);
    expect(spy.freshStarts).toBe(0);
    expect(controller.hasStartedFresh()).toBe(false);
  });

  it("starts fresh exactly once, only on the explicit choice", () => {
    const { controller, spy } = makeController();
    expect(controller.chooseStartFresh()).toBe(true);
    expect(spy.freshStarts).toBe(1);
    expect(controller.hasStartedFresh()).toBe(true);
    // A double-click must not create a second game.
    expect(controller.chooseStartFresh()).toBe(false);
    expect(spy.freshStarts).toBe(1);
  });

  it("still downloads after starting fresh (the evidence stays exportable)", () => {
    const { controller, spy } = makeController();
    controller.chooseStartFresh();
    controller.downloadBrokenSave();
    expect(spy.downloads).toHaveLength(1);
  });

  it("survives a blob that defeats JSON.stringify instead of throwing", () => {
    const cyclic: Record<string, unknown> = { schemaVersion: 1 };
    cyclic["self"] = cyclic;
    const { controller, spy } = makeController(cyclic);
    expect(() => controller.downloadBrokenSave()).not.toThrow();
    expect(typeof spy.downloads[0]?.json).toBe("string");
    expect((spy.downloads[0]?.json ?? "").length).toBeGreaterThan(0);
  });

  it("exports `undefined`-ish blobs as a string too (never a crash)", () => {
    const { controller } = makeController(undefined);
    expect(typeof controller.exportJson()).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// Full decision sequence against the persistence layer
// ---------------------------------------------------------------------------

class MemorySaveStore implements SaveStore {
  readonly data = new Map<string, unknown>();
  readonly puts: Array<{ key: string; value: unknown }> = [];

  get(key: string): Promise<unknown> {
    return Promise.resolve(this.data.get(key));
  }

  put(key: string, value: unknown): Promise<void> {
    this.data.set(key, value);
    this.puts.push({ key, value });
    return Promise.resolve();
  }
}

/** Timers that never fire — the test flushes via saveNow() explicitly. */
const inertTimers: TimerHost = {
  setTimeout: () => 0,
  clearTimeout: () => undefined,
};

describe("recovery flow end to end (logic level)", () => {
  it("keeps the corrupt blob untouched until Start Fresh, then quarantines before the new save lands", async () => {
    const saveStore = new MemorySaveStore();
    const broken = { schemaVersion: 1, seed: "scrambled" };
    saveStore.data.set(LATEST_SAVE_KEY, broken);
    const clock = new FakeClock(9_000);

    // Boot: load fails typed, raw preserved. No store, no writes.
    const loaded = await loadPipskeep(saveStore);
    expect(loaded.save).toBeNull();
    expect(loaded.loadError).toBeDefined();
    expect(loaded.rawBlob).toBe(broken);

    // The modal is up; the player is thinking. Nothing may write.
    let bootContinued = 0;
    const { controller, spy } = (() => {
      const s: Spy = { downloads: [], freshStarts: 0 };
      const c = createRecoveryController({
        rawBlob: loaded.rawBlob,
        exportedAt: clock.now(),
        download: (filename, json) => s.downloads.push({ filename, json }),
        onStartFresh: () => {
          bootContinued += 1;
        },
      });
      return { controller: c, spy: s };
    })();

    controller.downloadBrokenSave(); // downloading is not a decision
    expect(spy.downloads).toHaveLength(1);
    expect(bootContinued).toBe(0);
    expect(saveStore.puts).toHaveLength(0);
    expect(saveStore.data.get(LATEST_SAVE_KEY)).toBe(broken);

    // The explicit choice — and only now — continues boot.
    expect(controller.chooseStartFresh()).toBe(true);
    expect(bootContinued).toBe(1);

    // Boot continuation: new game + persistence, exactly as main.ts does.
    const store = createStore(rootReducer, createNewGame(7, clock.now()));
    const persistence = await initPersistence(store, clock, {
      saveStore,
      timers: inertTimers,
      visibility: null,
      preloaded: loaded,
    });

    // Quarantine happened before any overwrite of the latest slot.
    expect(saveStore.puts[0]?.key).toBe(`${QUARANTINE_KEY_PREFIX}9000`);
    expect(saveStore.puts[0]?.value).toBe(broken);
    expect(persistence.quarantineKey).toBe(`${QUARANTINE_KEY_PREFIX}9000`);
    expect(saveStore.data.get(LATEST_SAVE_KEY)).toBe(broken);

    // First save of the fresh game overwrites latest; evidence intact.
    await persistence.saveNow();
    expect(saveStore.puts[1]?.key).toBe(LATEST_SAVE_KEY);
    expect(saveStore.data.get(`${QUARANTINE_KEY_PREFIX}9000`)).toBe(broken);
    const reloaded = await loadPipskeep(saveStore);
    expect(reloaded.save?.state).toStrictEqual(store.getState());
    persistence.dispose();
  });
});
