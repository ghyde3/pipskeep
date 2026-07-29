/**
 * Debug menu controller tests (spec §14 — logic only; the DOM shell is
 * dev-build chrome around this controller). Everything runs in the node
 * environment: FakeClock under the shared OffsetClock, an in-memory
 * SaveStore, and spy seams for download/dispose.
 *
 * The load-bearing claims:
 * - skew + TICK produces exactly the skewed decay (QA fast-forward);
 * - grants land as exact inventory/resource deltas;
 * - import NEVER crashes: invalid blobs come back as typed SaveBlobErrors
 *   with the running game untouched, and a valid export round-trips;
 * - corrupt-my-save disposes persistence BEFORE writing garbage, so no
 *   autosave can un-corrupt the slot before the reload.
 */

import { describe, expect, it } from "vitest";
import { FakeClock } from "../core/clock";
import { HOUR_MS, MINUTE_MS, tuning } from "../content/tuning";
import { RESOURCE_IDS } from "../core/economy";
import { createStore } from "../core/store";
import type { Store } from "../core/store";
import { createNewGame, rootReducer } from "../core/state";
import type { GameAction, GameState, StarterContent } from "../core/state";
import { CURRENT_SCHEMA_VERSION, toSaveBlob } from "../core/save/serialize";
import { OffsetClock } from "../app/appClock";
import { LATEST_SAVE_KEY, loadPipskeep } from "../app/persistence";
import type { SaveStore } from "../app/persistence";
import {
  CORRUPT_SENTINEL,
  DEBUG_EXPORT_FILENAME,
  GRANT_BERRY_COUNT,
  GRANT_EACH_RESOURCE_COUNT,
  GRANT_STEW_COUNT,
  createDebugMenuController,
  formatOffset,
} from "./debugMenu";
import type { DebugMenuController } from "./debugMenu";

/** Pin the starter personality so decay numbers are exact (curious:
 * hunger ×1.0). */
const CURIOUS_ONLY: StarterContent = {
  speciesId: "mosspip",
  palettes: ["fern"],
  patterns: ["plain"],
  accessorySlots: 1,
  personalityIds: ["curious"],
  startingInventory: { berry: 3 },
};

class MemorySaveStore implements SaveStore {
  readonly data = new Map<string, unknown>();

  constructor(private readonly events: string[] = []) {}

  get(key: string): Promise<unknown> {
    return Promise.resolve(this.data.get(key));
  }

  put(key: string, value: unknown): Promise<void> {
    this.data.set(key, value);
    this.events.push(`put:${key}`);
    return Promise.resolve();
  }
}

interface Harness {
  clock: OffsetClock;
  inner: FakeClock;
  store: Store<GameState, GameAction>;
  saveStore: MemorySaveStore;
  events: string[];
  downloads: Array<{ filename: string; json: string }>;
  controller: DebugMenuController;
}

function makeHarness(startAt = 50_000, seed = 1): Harness {
  const inner = new FakeClock(startAt);
  const clock = new OffsetClock(inner);
  const store = createStore(
    rootReducer,
    createNewGame(seed, clock.now(), CURIOUS_ONLY),
  );
  const events: string[] = [];
  const saveStore = new MemorySaveStore(events);
  const downloads: Array<{ filename: string; json: string }> = [];
  const controller = createDebugMenuController({
    store,
    clock,
    saveStore,
    persistence: {
      dispose: () => {
        events.push("dispose");
      },
    },
    download: (filename, json) => {
      downloads.push({ filename, json });
    },
  });
  return { clock, inner, store, saveStore, events, downloads, controller };
}

describe("skew buttons (+1h/+6h/+24h → skew then TICK)", () => {
  it("skewBy(+1h) advances the clock, TICKs at the skewed time, and decays exactly 1h", () => {
    const h = makeHarness();
    h.controller.skewBy(HOUR_MS);

    expect(h.controller.offsetMs()).toBe(HOUR_MS);
    const state = h.store.getState();
    expect(state.lastTickAt).toBe(50_000 + HOUR_MS);
    // Hunger 60 − 1h × 6/h × 1.0 (curious adult, idle) = 54, ±0.
    expect(state.pips["pip-1"]?.needs.hunger).toBe(
      60 - -tuning.needDecayPerHour.hunger,
    );
  });

  it("skews accumulate: +1h, +6h, +24h reads back as +31h", () => {
    const h = makeHarness();
    for (const hours of [1, 6, 24]) h.controller.skewBy(hours * HOUR_MS);
    expect(h.controller.offsetMs()).toBe(31 * HOUR_MS);
    expect(h.store.getState().lastTickAt).toBe(50_000 + 31 * HOUR_MS);
  });
});

describe("grant buttons — exact deltas, nothing else touched", () => {
  it("grantBerries adds exactly 5 berries on top of the starting 3", () => {
    const h = makeHarness();
    const before = h.store.getState();
    h.controller.grantBerries();
    const after = h.store.getState();
    expect(after.inventory).toStrictEqual({ berry: 3 + GRANT_BERRY_COUNT });
    expect(after.resources).toStrictEqual(before.resources);
    expect(after.pips).toBe(before.pips); // untouched, structurally shared
  });

  it("grantStew adds exactly 1 stew without disturbing berries", () => {
    const h = makeHarness();
    h.controller.grantStew();
    expect(h.store.getState().inventory).toStrictEqual({
      berry: 3,
      stew: GRANT_STEW_COUNT,
    });
  });

  it("grantAllResources adds exactly 10 of every base resource, and stacks", () => {
    const h = makeHarness();
    h.controller.grantAllResources();
    const expected: Record<string, number> = {};
    for (const id of RESOURCE_IDS) expected[id] = GRANT_EACH_RESOURCE_COUNT;
    expect(h.store.getState().resources).toStrictEqual(expected);

    h.controller.grantAllResources();
    for (const id of RESOURCE_IDS) {
      expect(h.store.getState().resources[id]).toBe(
        2 * GRANT_EACH_RESOURCE_COUNT,
      );
    }
    expect(h.store.getState().inventory).toStrictEqual({ berry: 3 });
  });
});

describe("export save", () => {
  it("downloads pipskeep-save.json containing a valid, clock-stamped blob", async () => {
    const h = makeHarness();
    h.controller.skewBy(HOUR_MS); // prove savedAt uses the skewed clock
    const blob = h.controller.exportSave();

    expect(h.downloads).toHaveLength(1);
    expect(h.downloads[0]?.filename).toBe(DEBUG_EXPORT_FILENAME);
    expect(blob.savedAt).toBe(50_000 + HOUR_MS);
    expect(blob.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);

    // The downloaded text is itself a loadable save.
    const parsed = JSON.parse(h.downloads[0]?.json ?? "") as unknown;
    const store = new MemorySaveStore();
    store.data.set(LATEST_SAVE_KEY, parsed);
    const reloaded = await loadPipskeep(store);
    expect(reloaded.save?.state).toStrictEqual(h.store.getState());
  });
});

describe("import save — never crashes, typed rejection, valid round-trip", () => {
  const rejects = (h: Harness, text: string) => {
    const before = h.store.getState();
    const result = h.controller.importSaveText(text);
    expect(result.ok).toBe(false);
    expect(h.store.getState()).toBe(before); // running game untouched
    return result.ok ? undefined : result.error;
  };

  it("rejects unparseable JSON with a typed error", () => {
    const h = makeHarness();
    const error = rejects(h, "{ definitely not json");
    expect(error?.code).toBe("not-an-object");
    expect(error?.message).toContain("not valid JSON");
  });

  it("rejects valid JSON that is not a save object", () => {
    const h = makeHarness();
    expect(rejects(h, "42")?.code).toBe("not-an-object");
    expect(rejects(h, '"a string"')?.code).toBe("not-an-object");
    expect(rejects(h, "[1,2,3]")?.code).toBe("not-an-object");
  });

  it("rejects a future schemaVersion with the migrate error", () => {
    const h = makeHarness();
    const error = rejects(
      h,
      JSON.stringify({ schemaVersion: CURRENT_SCHEMA_VERSION + 1 }),
    );
    expect(error?.code).toBe("unsupported-schema-version");
  });

  it("rejects a structurally broken blob with the validator's field path", () => {
    const h = makeHarness();
    const broken = JSON.parse(
      JSON.stringify(toSaveBlob(h.store.getState(), 1_000)),
    ) as { state: { seed: unknown } };
    broken.state.seed = "nope";
    const error = rejects(h, JSON.stringify(broken));
    expect(error?.code).toBe("invalid-field");
    expect(error?.path).toContain("seed");
  });

  it("accepts a valid export and replaces the running game (round-trip)", () => {
    // Game B is a different universe (seed 2), exported at exactly the
    // import-time clock so CATCHUP spans 0ms and needs are untouched.
    const h = makeHarness(50_000, 1);
    const gameB = createNewGame(2, h.clock.now(), CURIOUS_ONLY);
    const exported = JSON.stringify(toSaveBlob(gameB, h.clock.now()));

    const result = h.controller.importSaveText(exported);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.fromVersion).toBe(CURRENT_SCHEMA_VERSION);

    const state = h.store.getState();
    expect(state.seed).toBe(2);
    expect(state.pips).toStrictEqual(gameB.pips);
    expect(state.inventory).toStrictEqual(gameB.inventory);
    expect(state.rngState).toStrictEqual(gameB.rngState);
    expect(state.lastTickAt).toBe(h.clock.now());
    // Transient UI echoes never replay across an import.
    expect(state.lastCareOutcome).toBeNull();
  });

  it("an older savedAt goes through CATCHUP on import (absence applied)", () => {
    const h = makeHarness(50_000 + 2 * HOUR_MS);
    const gameB = createNewGame(2, 50_000, CURIOUS_ONLY);
    const exported = JSON.stringify(toSaveBlob(gameB, 50_000)); // 2h ago

    const result = h.controller.importSaveText(exported);
    expect(result.ok).toBe(true);
    const state = h.store.getState();
    // 2h of hunger decay applied by the CATCHUP that follows LOAD_SAVE.
    expect(state.pips["pip-1"]?.needs.hunger).toBe(
      60 - 2 * -tuning.needDecayPerHour.hunger,
    );
    expect(state.lastCatchup?.elapsedMs).toBe(2 * HOUR_MS);
  });
});

describe("corrupt my save — the recovery-flow QA path", () => {
  it("disposes persistence BEFORE writing garbage over the latest slot", async () => {
    const h = makeHarness();
    await h.controller.corruptSave();
    expect(h.events).toStrictEqual(["dispose", `put:${LATEST_SAVE_KEY}`]);
    expect(h.saveStore.data.get(LATEST_SAVE_KEY)).toBe(CORRUPT_SENTINEL);
    // The running game is untouched — only the disk copy is broken.
    expect(h.store.getState().pips["pip-1"]).toBeDefined();
  });

  it("the corrupted slot loads back as a typed error with the raw garbage", async () => {
    const h = makeHarness();
    await h.controller.corruptSave();
    const reloaded = await loadPipskeep(h.saveStore);
    expect(reloaded.save).toBeNull();
    expect(reloaded.loadError?.code).toBe("not-an-object");
    expect(reloaded.rawBlob).toBe(CORRUPT_SENTINEL);
  });
});

describe("formatOffset (the clock readout)", () => {
  it("formats zero, whole units, mixed units, and negatives", () => {
    expect(formatOffset(0)).toBe("+0s");
    expect(formatOffset(HOUR_MS)).toBe("+1h");
    expect(formatOffset(25 * HOUR_MS)).toBe("+25h");
    expect(formatOffset(HOUR_MS + 30 * MINUTE_MS)).toBe("+1h 30m");
    expect(formatOffset(-45 * MINUTE_MS)).toBe("-45m");
    expect(formatOffset(1_500)).toBe("+1.5s");
  });
});

describe("spawn egg — instant Pipping for QA (spec §14)", () => {
  it("spawnEgg lands one egg already in Pipping, waiting for its tap", () => {
    const h = makeHarness();
    h.controller.spawnEgg();

    const eggs = h.store.getState().eggs;
    expect(eggs).toHaveLength(1);
    expect(eggs[0]?.state).toBe("pipping");
    // Backdated spawn: incubation began one full incubation before now.
    expect(eggs[0]?.incubationStartedAt).toBe(
      h.clock.now() - eggs[0]!.incubationMs,
    );
    // No clock skew involved — the trick is all in the payload timestamps.
    expect(h.controller.offsetMs()).toBe(0);
  });

  it("spawned eggs stack and keep deterministic ids", () => {
    const h = makeHarness();
    h.controller.spawnEgg();
    h.controller.spawnEgg();
    const eggs = h.store.getState().eggs;
    expect(eggs.map((egg) => egg.id)).toStrictEqual(["egg-1", "egg-2"]);
    expect(eggs.every((egg) => egg.state === "pipping")).toBe(true);
  });
});
