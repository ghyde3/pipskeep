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
import { runCatchup } from "../core/pips/catchup";
import type { PipState } from "../core/pips/types";
import { OffsetClock } from "../app/appClock";
import { LATEST_SAVE_KEY, loadPipskeep } from "../app/persistence";
import type { SaveStore } from "../app/persistence";
import {
  CORRUPT_SENTINEL,
  DEBUG_EXPORT_FILENAME,
  GRANT_BERRY_COUNT,
  GRANT_EACH_RESOURCE_COUNT,
  GRANT_STEW_COUNT,
  SKEW_UNITS,
  SKEW_UNIT_MAX,
  clampSkewValue,
  createDebugMenuController,
  createSkewSliderController,
  formatOffset,
  skewValueToMs,
} from "./debugMenu";
import type { DebugMenuController } from "./debugMenu";

/** Local mirror of the file's internal `DAY_MS` (kept unexported since it
 * is a structural calendar fact, not public API). */
const DAY_MS = 24 * HOUR_MS;

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

describe("skew — default mode now dispatches CATCHUP, not TICK (finding #4 fix)", () => {
  it("skewBy(+1h) advances the clock, CATCHUPs over the skewed window, and decays exactly 1h", () => {
    const h = makeHarness();
    h.controller.skewBy(HOUR_MS);

    expect(h.controller.offsetMs()).toBe(HOUR_MS);
    const state = h.store.getState();
    expect(state.lastTickAt).toBe(50_000 + HOUR_MS);
    // 1h is well under the offline rate cap, so CATCHUP's math matches
    // plain per-hour decay exactly: hunger 60 − 1h × rate × 1.0 (curious
    // hunger multiplier), ±0.
    expect(state.pips["pip-1"]?.needs.hunger).toBe(
      60 - -tuning.needDecayPerHour.hunger,
    );
    // CATCHUP recorded a summary; a plain TICK never sets lastCatchup.
    expect(state.lastCatchup?.elapsedMs).toBe(HOUR_MS);
  });

  it("skews accumulate: +1h, +6h, +24h reads back as +31h", () => {
    const h = makeHarness();
    for (const hours of [1, 6, 24]) h.controller.skewBy(hours * HOUR_MS);
    expect(h.controller.offsetMs()).toBe(31 * HOUR_MS);
    expect(h.store.getState().lastTickAt).toBe(50_000 + 31 * HOUR_MS);
  });

  it('mode "raw" applies uncapped, instantaneous decay — the secondary QA toggle ("live decay (no cap)")', () => {
    const h = makeHarness();
    h.controller.skewBy(24 * HOUR_MS, "raw");

    const rate =
      tuning.needDecayPerHour.cleanliness *
      tuning.personalityDecayMultipliers["curious"]!.cleanliness;
    // No lastCatchup: raw mode dispatches a plain TICK, exactly as the
    // debug menu always did before this round.
    expect(h.store.getState().lastCatchup).toBeNull();
    expect(h.store.getState().pips["pip-1"]?.needs.cleanliness).toBeCloseTo(
      Math.max(0, 100 + rate * 24),
      10,
    );
  });

  it("the default (catchup) mode respects the §4.5 offline rate cap where raw mode does not", () => {
    const cappedHours = tuning.offlineRateCapMs / HOUR_MS;
    // This comparison only proves something if the cap actually binds
    // over a 24h skip — guard the premise before trusting the assertion.
    expect(cappedHours).toBeLessThan(24);

    const rate =
      tuning.needDecayPerHour.cleanliness *
      tuning.personalityDecayMultipliers["curious"]!.cleanliness;

    const capped = makeHarness();
    capped.controller.skewBy(24 * HOUR_MS); // default mode
    const rawH = makeHarness();
    rawH.controller.skewBy(24 * HOUR_MS, "raw");

    const cappedCleanliness = capped.store.getState().pips["pip-1"]?.needs
      .cleanliness;
    const rawCleanliness = rawH.store.getState().pips["pip-1"]?.needs
      .cleanliness;

    expect(cappedCleanliness).toBeCloseTo(100 + rate * cappedHours, 10);
    expect(rawCleanliness).toBeCloseTo(Math.max(0, 100 + rate * 24), 10);
    // The whole point of finding #4: a real absence is milder than the
    // old raw-tick tool made it look.
    expect(cappedCleanliness ?? -1).toBeGreaterThan(rawCleanliness ?? -1);
  });
});

describe("catchup equivalence — a debug skip must equal closing the tab (finding #4, the point)", () => {
  it("a 24h debug skip (default mode) matches a direct runCatchup call over the same window", () => {
    const h = makeHarness();
    const before = h.store.getState();
    const savedAt = h.clock.now();
    const skipMs = 24 * HOUR_MS;

    h.controller.skewBy(skipMs);
    const now = savedAt + skipMs;
    expect(h.clock.now()).toBe(now);

    const pipsList = before.rosterOrder
      .map((id) => before.pips[id])
      .filter((pip): pip is PipState => pip !== undefined);
    const direct = runCatchup({ pips: pipsList }, savedAt, now);

    const after = h.store.getState();
    expect(direct.state.pips.length).toBeGreaterThan(0);
    for (const pip of direct.state.pips) {
      expect(after.pips[pip.id]?.needs).toStrictEqual(pip.needs);
      expect(after.pips[pip.id]?.activity).toBe(pip.activity);
      expect(after.pips[pip.id]?.lifeStage).toBe(pip.lifeStage);
    }
    expect(after.lastCatchup?.elapsedMs).toBe(direct.summary.elapsedMs);
    expect(after.lastCatchup?.ratedMs).toBe(direct.summary.ratedMs);
    expect(after.lastCatchup?.cappedMs).toBe(direct.summary.cappedMs);
  });

  it("a 24h debug skip produces state IDENTICAL to closing the tab for 24h", () => {
    const seed = 7;
    const savedAt = 50_000;
    const now = savedAt + 24 * HOUR_MS;

    // "Closing the tab": exactly what src/app/main.ts's startGame() does
    // on load when a save's savedAt is in the past — dispatch CATCHUP
    // over the absence, no debug menu involved.
    const closedTabStore = createStore(
      rootReducer,
      createNewGame(seed, savedAt, CURIOUS_ONLY),
    );
    closedTabStore.dispatch({ type: "CATCHUP", savedAt, now });

    // The debug menu's default skip, from the identical starting point.
    const inner = new FakeClock(savedAt);
    const clock = new OffsetClock(inner);
    const debugStore = createStore(
      rootReducer,
      createNewGame(seed, savedAt, CURIOUS_ONLY),
    );
    const controller = createDebugMenuController({
      store: debugStore,
      clock,
      saveStore: new MemorySaveStore(),
      persistence: { dispose: () => {} },
      download: () => {},
    });
    controller.skewBy(now - savedAt);

    expect(debugStore.getState()).toStrictEqual(closedTabStore.getState());
  });
});

describe("time slider — pure controller (item #2: unit → max → clamped value → ms)", () => {
  it("SKEW_UNIT_MAX matches the requested per-unit dynamic max (minutes 60 / hours 24 / days 30)", () => {
    expect(SKEW_UNIT_MAX).toStrictEqual({ minutes: 60, hours: 24, days: 30 });
  });

  it("clampSkewValue clamps into [1, max] per unit, rounds, and rejects non-finite input", () => {
    for (const unit of SKEW_UNITS) {
      expect(clampSkewValue(unit, 0)).toBe(1);
      expect(clampSkewValue(unit, -5)).toBe(1);
      expect(clampSkewValue(unit, SKEW_UNIT_MAX[unit] + 1_000)).toBe(
        SKEW_UNIT_MAX[unit],
      );
      expect(clampSkewValue(unit, Number.NaN)).toBe(1);
      expect(clampSkewValue(unit, Number.POSITIVE_INFINITY)).toBe(1);
    }
    expect(clampSkewValue("hours", 3.6)).toBe(4);
  });

  it("skewValueToMs clamps then converts to the unit's milliseconds", () => {
    expect(skewValueToMs("minutes", 45)).toBe(45 * MINUTE_MS);
    expect(skewValueToMs("hours", 6)).toBe(6 * HOUR_MS);
    expect(skewValueToMs("days", 3)).toBe(3 * DAY_MS);
    expect(skewValueToMs("hours", 999)).toBe(SKEW_UNIT_MAX["hours"] * HOUR_MS);
  });

  it("createSkewSliderController defaults to 1 hour", () => {
    const controller = createSkewSliderController();
    expect(controller.getState()).toStrictEqual({ unit: "hours", value: 1 });
    expect(controller.getMax()).toBe(24);
    expect(controller.toMs()).toBe(HOUR_MS);
  });

  it("switching units re-clamps the existing value to the new max", () => {
    const controller = createSkewSliderController({
      unit: "minutes",
      value: 45,
    });
    expect(controller.toMs()).toBe(45 * MINUTE_MS);

    // Minutes(45) → Days: re-clamps down to the days max (30).
    expect(controller.setUnit("days")).toStrictEqual({
      unit: "days",
      value: 30,
    });
    expect(controller.toMs()).toBe(30 * DAY_MS);

    // Days(30) → Hours: re-clamps down to the hours max (24).
    expect(controller.setUnit("hours").value).toBe(24);

    expect(controller.setValue(5)).toStrictEqual({ unit: "hours", value: 5 });
    expect(controller.toMs()).toBe(5 * HOUR_MS);
  });

  it("setValue clamps within the current unit without touching the unit", () => {
    const controller = createSkewSliderController({ unit: "days", value: 1 });
    expect(controller.setValue(0)).toStrictEqual({ unit: "days", value: 1 });
    expect(controller.setValue(1_000)).toStrictEqual({
      unit: "days",
      value: 30,
    });
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

describe("formatOffset (the clock readout, item #3: human-friendly total)", () => {
  it("formats zero, whole units, mixed units, and negatives", () => {
    expect(formatOffset(0)).toBe("+0s");
    expect(formatOffset(HOUR_MS)).toBe("+1h");
    expect(formatOffset(HOUR_MS + 30 * MINUTE_MS)).toBe("+1h 30m");
    expect(formatOffset(-45 * MINUTE_MS)).toBe("-45m");
    expect(formatOffset(1_500)).toBe("+1.5s");
  });

  it("rolls up to days once the offset crosses 24h, dropping smaller units", () => {
    // 25h used to render as "+25h" (Round 2A: the readout now rolls over
    // to days, matching a real multi-day debug skip: "clock +2d 6h").
    expect(formatOffset(25 * HOUR_MS)).toBe("+1d 1h");
    expect(formatOffset(24 * HOUR_MS)).toBe("+1d");
    expect(formatOffset(2 * DAY_MS + 6 * HOUR_MS + 45 * MINUTE_MS)).toBe(
      "+2d 6h",
    );
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
