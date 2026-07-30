/**
 * THE MILESTONE RIBBON — pure model tests (docs/progression-bible.md §6):
 * race-proof detection, batching (never a chain), the queue (mirrors
 * `levelUp.ts`'s, one ribbon at a time), and the "queues behind the reveal
 * queue/Doorstep" blocking signal — PLUS the controller, which is no longer
 * "verified manually in the browser".
 *
 * ROUND 2F: a review mutation kept `knownEarned.add(id)` and deleted
 * `pendingIds.push(...newIds)` from `initMilestoneCelebrationUi`'s store
 * subscription, and the whole suite stayed green — newly-earned milestones were
 * detected and remembered, and the ribbon never appeared. Since the ribbon IS
 * the round's answer to the owner's "need better notification when milestones
 * are completed", that one line is load-bearing. The ribbon factory and the
 * stage host are now injectable, so the controller runs end to end here against
 * a real `Store` and a fake ribbon. No DOM: vitest runs `node` in this repo and
 * jsdom is outside the spec §1 dependency allowlist.
 */

import { describe, expect, it } from "vitest";
import { createNewGame } from "../core/state";
import type { GameAction, GameState } from "../core/state";
import { createStore } from "../core/store";
import type { Store } from "../core/store";
import { MILESTONES } from "../content/milestones";
import {
  EMPTY_RIBBON_QUEUE,
  advanceRibbonQueue,
  buildMilestoneCelebrationBatch,
  dismissRibbon,
  enqueueRibbon,
  initMilestoneCelebrationUi,
  isMilestoneRibbonBlocked,
  newlyEarnedMilestoneIds,
} from "./milestoneCelebration";
import type {
  MilestoneCelebrationBatch,
  MilestoneRibbonDeps,
  RibbonQueueState,
} from "./milestoneCelebration";

const SEED = 7;
const T0 = 10_000_000;

function fresh(overrides: Partial<GameState> = {}): GameState {
  return { ...createNewGame(SEED, T0), ...overrides };
}

function earn(state: GameState, ids: readonly string[], at = T0): GameState {
  const earned = { ...state.milestones.earned };
  for (const id of ids) earned[id] = at;
  return { ...state, milestones: { ...state.milestones, earned } };
}

describe("newlyEarnedMilestoneIds — the append-only-map diff (race-proof by construction)", () => {
  it("reports nothing when the earned map hasn't grown", () => {
    const state = fresh();
    expect(newlyEarnedMilestoneIds(new Set(), state)).toEqual([]);
  });

  it("reports exactly the ids not yet in the known set", () => {
    const state = earn(fresh(), ["first-feed", "first-nap"]);
    const known = new Set<string>(["first-feed"]);
    expect(newlyEarnedMilestoneIds(known, state)).toEqual(["first-nap"]);
  });

  it("reports nothing once the caller has folded every id into its known set", () => {
    const state = earn(fresh(), ["first-feed", "first-nap"]);
    const known = new Set(Object.keys(state.milestones.earned));
    expect(newlyEarnedMilestoneIds(known, state)).toEqual([]);
  });

  it("does not care HOW MANY nested dispatches produced the growth — one diff catches a whole burst", () => {
    // Simulates dailies.ts's bankEarnedMilestones loop having already run
    // several CLAIM_MILESTONE dispatches before this module's listener
    // gets its turn (the race described in the module doc): by the time
    // it sees the state, several ids landed in `earned` at once.
    const state = earn(fresh(), ["first-feed", "first-nap", "first-trip-home"]);
    const ids = newlyEarnedMilestoneIds(new Set(), state);
    expect(new Set(ids)).toEqual(new Set(["first-feed", "first-nap", "first-trip-home"]));
  });
});

describe("buildMilestoneCelebrationBatch — content-sourced name/blurb/reward/xp", () => {
  it("an empty id list is an empty, zero-xp batch", () => {
    expect(buildMilestoneCelebrationBatch([], fresh())).toEqual({ entries: [], totalXp: 0 });
  });

  it("pulls xp straight from content/milestones.ts, summed", () => {
    const def = MILESTONES.find((m) => m.id === "first-feed");
    if (def === undefined) throw new Error("fixture assumes first-feed exists");
    const state = earn(fresh(), ["first-feed"]);
    const batch = buildMilestoneCelebrationBatch(["first-feed"], state);
    expect(batch.entries).toHaveLength(1);
    expect(batch.entries[0]?.id).toBe("first-feed");
    expect(batch.entries[0]?.xp).toBe(def.xp ?? 0);
    expect(batch.totalXp).toBe(def.xp ?? 0);
  });

  it("sums xp across a batch of several ids", () => {
    const ids = ["first-feed", "first-nap"] as const;
    const state = earn(fresh(), ids);
    const batch = buildMilestoneCelebrationBatch([...ids], state);
    const expectedTotal = ids.reduce(
      (sum, id) => sum + (MILESTONES.find((m) => m.id === id)?.xp ?? 0),
      0,
    );
    expect(batch.entries).toHaveLength(2);
    expect(batch.totalXp).toBe(expectedTotal);
  });

  it("drops an id with no matching row rather than rendering a blank entry", () => {
    const state = fresh();
    const batch = buildMilestoneCelebrationBatch(["not-a-real-id"], state);
    expect(batch.entries).toEqual([]);
    expect(batch.totalXp).toBe(0);
  });
});

describe("the ribbon queue — never a chain, one on stage at a time (bible §6.2)", () => {
  const batchA: MilestoneCelebrationBatch = {
    entries: [{ id: "a", name: "A", blurb: "", rewardLabel: "", xp: 15 }],
    totalXp: 15,
  };
  const batchB: MilestoneCelebrationBatch = {
    entries: [{ id: "b", name: "B", blurb: "", rewardLabel: "", xp: 30 }],
    totalXp: 30,
  };

  it("enqueueRibbon drops an empty batch rather than queuing a blank ribbon", () => {
    const q = enqueueRibbon(EMPTY_RIBBON_QUEUE, { entries: [], totalXp: 0 });
    expect(q).toBe(EMPTY_RIBBON_QUEUE);
  });

  it("advances only when clear, and never shows a second ribbon over the first", () => {
    let q: RibbonQueueState = EMPTY_RIBBON_QUEUE;
    q = enqueueRibbon(q, batchA);
    q = enqueueRibbon(q, batchB);

    expect(advanceRibbonQueue(q, true)).toBe(q); // blocked: no-op

    q = advanceRibbonQueue(q, false);
    expect(q.showing).toEqual(batchA);
    expect(q.pending).toEqual([batchB]);

    const stillA = advanceRibbonQueue(q, false);
    expect(stillA).toBe(q); // something already showing: no-op even if unblocked
  });

  it("dismiss then advance plays the next queued batch", () => {
    let q: RibbonQueueState = EMPTY_RIBBON_QUEUE;
    q = enqueueRibbon(q, batchA);
    q = enqueueRibbon(q, batchB);
    q = advanceRibbonQueue(q, false);
    q = dismissRibbon(q);
    expect(q.showing).toBeNull();
    q = advanceRibbonQueue(q, false);
    expect(q.showing).toEqual(batchB);
    expect(q.pending).toEqual([]);
  });
});

describe("isMilestoneRibbonBlocked — queues behind the WHOLE reveal queue draining, not just 'modal closed'", () => {
  const clearRoot = { querySelector: () => null };
  const openRoot = { querySelector: () => ({}) };

  it("is false with an empty reveal queue and no open Doorstep/reveal", () => {
    expect(isMilestoneRibbonBlocked({ pendingReveals: [] }, clearRoot)).toBe(false);
  });

  it("is true while ANY reveal is still pending, even if no modal is visible right now", () => {
    expect(
      isMilestoneRibbonBlocked(
        { pendingReveals: [{} as never] },
        clearRoot,
      ),
    ).toBe(true);
  });

  it("is true while the Doorstep/reveal modal is open, even with an empty reveal queue", () => {
    expect(isMilestoneRibbonBlocked({ pendingReveals: [] }, openRoot)).toBe(true);
  });
});


// ---------------------------------------------------------------------------
// THE CONTROLLER (mutation 11's target)
// ---------------------------------------------------------------------------

interface FakeRibbon {
  readonly el: { remove?: () => void };
  readonly shown: MilestoneCelebrationBatch[];
  show(batch: MilestoneCelebrationBatch): void;
  hide(): void;
  isShowing(): boolean;
  dismiss(): void;
}

function fakeRibbon(): {
  ribbon: FakeRibbon;
  make: (deps: MilestoneRibbonDeps) => FakeRibbon;
} {
  const shown: MilestoneCelebrationBatch[] = [];
  let showing = false;
  const ribbon: FakeRibbon = {
    el: {},
    shown,
    show(batch): void {
      shown.push(batch);
      showing = true;
    },
    hide(): void {
      showing = false;
    },
    isShowing: () => showing,
    dismiss(): void {
      showing = false;
    },
  };
  return { ribbon, make: () => ribbon };
}

const noopHost = { appendChild: (): void => {} };

/**
 * A real `Store<GameState, GameAction>` whose reducer simply hands back
 * whatever snapshot the test staged — so these tests exercise the CONTROLLER's
 * subscription against the real store implementation (re-entrancy guard,
 * listener snapshotting and all) without having to construct action sequences
 * that produce a given state. `push` stages and notifies in one call.
 */
function pushStore(initial: GameState): {
  readonly store: Store<GameState, GameAction>;
  push(state: GameState): void;
} {
  let staged = initial;
  const store = createStore<GameState, GameAction>(() => staged, initial);
  return {
    store,
    push(state: GameState): void {
      staged = state;
      store.dispatch({ type: "TICK", at: 0 });
    },
  };
}

/** `state` with `ids` marked earned. */
function withEarned(state: GameState, ids: readonly string[]): GameState {
  const earned: Record<string, number> = { ...state.milestones.earned };
  for (const id of ids) earned[id] = T0;
  return { ...state, milestones: { ...state.milestones, earned } };
}

/** Two real milestone ids, so the batch has real names/blurbs to build from. */
const FIRST = MILESTONES[0]!.id;
const SECOND = MILESTONES[1]!.id;

describe("initMilestoneCelebrationUi — the store IS connected to the stage (kills mutation 11)", () => {
  it("shows a ribbon for a newly-earned milestone, after the batching microtask", async () => {
    const { ribbon, make } = fakeRibbon();
    const { store, push } = pushStore(fresh());
    const ui = initMilestoneCelebrationUi({
      store,
      host: noopHost,
      createRibbon: make,
      isBlocked: () => false,
      onOpenMilestones: () => {},
    });

    push(withEarned(store.getState(), [FIRST]));
    // Batched to the next microtask (bible §6.2: one ribbon, never a chain).
    expect(ribbon.shown).toEqual([]);
    await Promise.resolve();

    expect(ribbon.shown).toHaveLength(1);
    expect(ribbon.shown[0]?.entries.map((e) => e.id)).toEqual([FIRST]);
    expect(ribbon.isShowing()).toBe(true);
    ui.dispose();
  });

  it("BATCHES a synchronous burst into ONE ribbon, never a chain", async () => {
    const { ribbon, make } = fakeRibbon();
    const { store, push } = pushStore(fresh());
    const ui = initMilestoneCelebrationUi({
      store,
      host: noopHost,
      createRibbon: make,
      isBlocked: () => false,
      onOpenMilestones: () => {},
    });

    // Two back-to-back dispatches, as `dailies.ts`'s bankEarnedMilestones loop
    // produces, both inside the same microtask window.
    push(withEarned(store.getState(), [FIRST]));
    push(withEarned(store.getState(), [SECOND]));
    await Promise.resolve();

    expect(ribbon.shown).toHaveLength(1);
    expect(ribbon.shown[0]?.entries.map((e) => e.id)).toEqual([FIRST, SECOND]);
    expect(ribbon.shown[0]?.totalXp).toBeGreaterThan(0);
    ui.dispose();
  });

  it("never re-celebrates an already-known id", async () => {
    const { ribbon, make } = fakeRibbon();
    const { store, push } = pushStore(fresh());
    const ui = initMilestoneCelebrationUi({
      store,
      host: noopHost,
      createRibbon: make,
      isBlocked: () => false,
      onOpenMilestones: () => {},
    });

    push(withEarned(store.getState(), [FIRST]));
    await Promise.resolve();
    push({ ...store.getState() });
    push({ ...store.getState() });
    await Promise.resolve();

    expect(ribbon.shown).toHaveLength(1);
    ui.dispose();
  });

  it("ignores milestones already earned at construction — only NEW ones celebrate", async () => {
    const { ribbon, make } = fakeRibbon();
    const { store, push } = pushStore(withEarned(fresh(), [FIRST]));
    const ui = initMilestoneCelebrationUi({
      store,
      host: noopHost,
      createRibbon: make,
      isBlocked: () => false,
      onOpenMilestones: () => {},
    });
    push({ ...store.getState() });
    await Promise.resolve();
    expect(ribbon.shown).toEqual([]);
    ui.dispose();
  });

  it("QUEUES behind the Doorstep/reveal queue and drains on the next tick once clear (bible §6.3)", async () => {
    const { ribbon, make } = fakeRibbon();
    const { store, push } = pushStore(fresh());
    let isBlocked = true;
    const ui = initMilestoneCelebrationUi({
      store,
      host: noopHost,
      createRibbon: make,
      isBlocked: () => isBlocked,
      onOpenMilestones: () => {},
    });

    push(withEarned(store.getState(), [FIRST]));
    await Promise.resolve();
    expect(ribbon.shown).toEqual([]); // held, never dropped

    isBlocked = false;
    push({ ...store.getState() });
    expect(ribbon.shown).toHaveLength(1);
    ui.dispose();
  });

  it("stops listening after dispose", async () => {
    const { ribbon, make } = fakeRibbon();
    const { store, push } = pushStore(fresh());
    const ui = initMilestoneCelebrationUi({
      store,
      host: noopHost,
      createRibbon: make,
      isBlocked: () => false,
      onOpenMilestones: () => {},
    });
    ui.dispose();
    push(withEarned(store.getState(), [FIRST]));
    await Promise.resolve();
    expect(ribbon.shown).toEqual([]);
  });

  it("mounts the ribbon into the host exactly once", () => {
    const appended: unknown[] = [];
    const { make } = fakeRibbon();
    const { store, push } = pushStore(fresh());
    const ui = initMilestoneCelebrationUi({
      store,
      host: { appendChild: (el: unknown) => appended.push(el) },
      createRibbon: make,
      isBlocked: () => false,
      onOpenMilestones: () => {},
    });
    expect(appended).toHaveLength(1);
    ui.dispose();
  });
});
