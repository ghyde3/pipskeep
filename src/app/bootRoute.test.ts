/**
 * Boot routing (spec §8) — kills the historical worst-case mutation:
 * boot() silently calling createNewGame on a CORRUPT blob. These tests
 * drive main.ts's actual decision point (routeBoot) through loadPipskeep
 * and assert that on `{ save: null, loadError }` the recovery prompt is
 * shown and startGame is NOT called — the game may start only after the
 * player's explicit Start Fresh, and exactly once.
 */

import { describe, expect, it } from "vitest";
import { FakeClock } from "../core/clock";
import { createNewGame } from "../core/state";
import { toSaveBlob } from "../core/save/serialize";
import { createRecoveryController } from "../ui/recovery";
import { routeBoot } from "./bootRoute";
import type { RecoveryPrompt } from "./bootRoute";
import { LATEST_SAVE_KEY, loadPipskeep } from "./persistence";
import type { LoadResult, SaveStore } from "./persistence";

class MemorySaveStore implements SaveStore {
  readonly data = new Map<string, unknown>();

  get(key: string): Promise<unknown> {
    return Promise.resolve(this.data.get(key));
  }

  put(key: string, value: unknown): Promise<void> {
    this.data.set(key, value);
    return Promise.resolve();
  }
}

interface Spy {
  prompts: RecoveryPrompt[];
  starts: LoadResult[];
}

function makeDeps() {
  const spy: Spy = { prompts: [], starts: [] };
  return {
    spy,
    deps: {
      showRecovery: (prompt: RecoveryPrompt) => {
        spy.prompts.push(prompt);
      },
      startGame: (loaded: LoadResult) => {
        spy.starts.push(loaded);
      },
    },
  };
}

async function loadCorrupt(): Promise<LoadResult> {
  const saveStore = new MemorySaveStore();
  saveStore.data.set(LATEST_SAVE_KEY, { schemaVersion: 1, seed: "scrambled" });
  return loadPipskeep(saveStore);
}

describe("routeBoot — corrupt blob (spec §8: never a silent wipe)", () => {
  it("routes a real corrupt load to recovery and does NOT start the game", async () => {
    const loaded = await loadCorrupt();
    expect(loaded.save).toBeNull();
    expect(loaded.loadError).toBeDefined(); // corrupt, not merely missing

    const { spy, deps } = makeDeps();
    const route = await routeBoot(loaded, deps);

    expect(route).toBe("recovery");
    expect(spy.starts).toHaveLength(0); // the mutation this test kills
    expect(spy.prompts).toHaveLength(1);
    expect(spy.prompts[0]?.loadError).toBe(loaded.loadError);
    expect(spy.prompts[0]?.rawBlob).toBe(loaded.rawBlob);
  });

  it("starts the game only after onStartFresh fires, with the original LoadResult", async () => {
    const loaded = await loadCorrupt();
    const { spy, deps } = makeDeps();
    await routeBoot(loaded, deps);

    expect(spy.starts).toHaveLength(0);
    spy.prompts[0]?.onStartFresh();
    expect(spy.starts).toHaveLength(1);
    // The original LoadResult flows through so initPersistence still sees
    // loadError + rawBlob and quarantines before its first autosave.
    expect(spy.starts[0]).toBe(loaded);
  });

  it("wired through the real recovery controller: Start Fresh gates the game, once", async () => {
    const loaded = await loadCorrupt();
    const { spy, deps } = makeDeps();
    await routeBoot(loaded, deps);

    const prompt = spy.prompts[0];
    expect(prompt).toBeDefined();
    if (prompt === undefined) throw new Error("unreachable");
    const controller = createRecoveryController({
      rawBlob: prompt.rawBlob,
      exportedAt: 0,
      download: () => undefined,
      onStartFresh: () => {
        prompt.onStartFresh();
      },
    });

    controller.downloadBrokenSave(); // downloading is not a decision
    expect(spy.starts).toHaveLength(0);

    expect(controller.chooseStartFresh()).toBe(true);
    expect(spy.starts).toHaveLength(1);

    // A double-click must not boot a second game.
    expect(controller.chooseStartFresh()).toBe(false);
    expect(spy.starts).toHaveLength(1);
  });
});

describe("routeBoot — non-corrupt paths", () => {
  it("nothing stored (fresh install): starts directly, no recovery prompt", async () => {
    const loaded = await loadPipskeep(new MemorySaveStore());
    expect(loaded.save).toBeNull();
    expect(loaded.loadError).toBeUndefined();

    const { spy, deps } = makeDeps();
    const route = await routeBoot(loaded, deps);

    expect(route).toBe("start");
    expect(spy.prompts).toHaveLength(0);
    expect(spy.starts).toHaveLength(1);
    expect(spy.starts[0]).toBe(loaded);
  });

  it("valid save: starts directly with the loaded blob, no recovery prompt", async () => {
    const clock = new FakeClock(5_000);
    const saveStore = new MemorySaveStore();
    saveStore.data.set(
      LATEST_SAVE_KEY,
      toSaveBlob(createNewGame(7, clock.now()), clock.now()),
    );
    const loaded = await loadPipskeep(saveStore);
    expect(loaded.save).not.toBeNull();

    const { spy, deps } = makeDeps();
    const route = await routeBoot(loaded, deps);

    expect(route).toBe("start");
    expect(spy.prompts).toHaveLength(0);
    expect(spy.starts).toHaveLength(1);
    expect(spy.starts[0]).toBe(loaded);
  });

  it("awaits startGame on the start path (boot errors propagate)", async () => {
    const loaded = await loadPipskeep(new MemorySaveStore());
    await expect(
      routeBoot(loaded, {
        showRecovery: () => undefined,
        startGame: () => Promise.reject(new Error("boot failed")),
      }),
    ).rejects.toThrow("boot failed");
  });
});
