/**
 * THE KEEP TIER-UP MOMENT — pure model tests (docs/progression-bible.md
 * §1.2/§6.3): the queue (never overlapping, drains once unblocked) and the
 * content-generated copy — PLUS the controller, which is no longer "verified
 * manually in the browser".
 *
 * ROUND 2F: a review mutation deleted the single line
 * `queue = enqueueLevelUp(queue, state.lastLevelUp)` from `initLevelUpUi`'s
 * store subscription and the whole suite stayed green — detection ran and the
 * banner never appeared. `createLevelUpBanner`'s factory and the stage host are
 * now injectable, so the controller is driven end to end here against a real
 * `Store` and a fake banner. No DOM: vitest runs `node` in this repo and jsdom
 * is outside the spec §1 dependency allowlist.
 */

import { describe, expect, it } from "vitest";
import { keepLevels } from "../content/keep";
import type { LevelUpOutcome } from "../core/state";
import { createNewGame } from "../core/state";
import type { GameAction, GameState } from "../core/state";
import { createStore } from "../core/store";
import type { Store } from "../core/store";
import type { KeepLevelDef } from "../content/keep";
import {
  EMPTY_LEVEL_UP_QUEUE,
  advanceLevelUpQueue,
  dismissLevelUp,
  enqueueLevelUp,
  hasOpenBlockingSurface,
  initLevelUpUi,
  levelUpHeadline,
  levelUpUnlockLines,
} from "./levelUp";
import type { LevelUpQueueState } from "./levelUp";

function outcome(toLevel: number, at = 0): LevelUpOutcome {
  return { at, fromLevel: toLevel - 1, toLevel };
}

describe("levelUpHeadline / levelUpUnlockLines — generated from content, never hand-authored", () => {
  it("names the level in the headline", () => {
    expect(levelUpHeadline(5)).toBe("The Keep is Level 5");
    expect(levelUpHeadline(12)).toBe("The Keep is Level 12");
  });

  it("the unlock lines are EXACTLY content/keep.ts's own list for that tier — no drift possible", () => {
    for (const def of keepLevels) {
      if (def.level === 1) continue; // tier 1 is the starting state, never "reached"
      expect(levelUpUnlockLines(def.level)).toEqual(def.unlocks);
      expect(levelUpUnlockLines(def.level).length).toBeGreaterThan(0);
    }
  });

  it("an unknown level (defensive) returns an empty list rather than throwing", () => {
    expect(levelUpUnlockLines(999)).toEqual([]);
  });
});

describe("the level-up queue — never more than one showing, drains once unblocked", () => {
  it("enqueue does not show anything by itself", () => {
    const q = enqueueLevelUp(EMPTY_LEVEL_UP_QUEUE, outcome(2));
    expect(q.showing).toBeNull();
    expect(q.pending).toHaveLength(1);
  });

  it("advancing while blocked leaves the queue untouched (same reference)", () => {
    const q = enqueueLevelUp(EMPTY_LEVEL_UP_QUEUE, outcome(2));
    const advanced = advanceLevelUpQueue(q, true);
    expect(advanced).toBe(q);
    expect(advanced.showing).toBeNull();
  });

  it("advancing while clear pops the oldest pending outcome onto the stage", () => {
    const q = enqueueLevelUp(EMPTY_LEVEL_UP_QUEUE, outcome(2));
    const advanced = advanceLevelUpQueue(q, false);
    expect(advanced.showing).toEqual(outcome(2));
    expect(advanced.pending).toHaveLength(0);
  });

  it("never shows a second one while the first is still on stage, even if unblocked", () => {
    let q: LevelUpQueueState = EMPTY_LEVEL_UP_QUEUE;
    q = enqueueLevelUp(q, outcome(2));
    q = enqueueLevelUp(q, outcome(3));
    q = advanceLevelUpQueue(q, false);
    expect(q.showing).toEqual(outcome(2));
    expect(q.pending).toHaveLength(1);

    // Still unblocked, but something is already showing — no change.
    const stillOne = advanceLevelUpQueue(q, false);
    expect(stillOne).toBe(q);
    expect(stillOne.showing).toEqual(outcome(2));
  });

  it("dismissing clears the stage, and the NEXT advance pops the second one", () => {
    let q: LevelUpQueueState = EMPTY_LEVEL_UP_QUEUE;
    q = enqueueLevelUp(q, outcome(2));
    q = enqueueLevelUp(q, outcome(3));
    q = advanceLevelUpQueue(q, false);
    q = dismissLevelUp(q);
    expect(q.showing).toBeNull();
    q = advanceLevelUpQueue(q, false);
    expect(q.showing).toEqual(outcome(3));
    expect(q.pending).toHaveLength(0);
  });

  it("a veteran's migration-backfill scenario: several tiers queued at once play ONE AT A TIME", () => {
    let q: LevelUpQueueState = EMPTY_LEVEL_UP_QUEUE;
    for (let lvl = 2; lvl <= 5; lvl++) q = enqueueLevelUp(q, outcome(lvl));
    const seen: number[] = [];
    // Simulate the controller: advance, dismiss, advance, dismiss...
    for (let i = 0; i < 4; i++) {
      q = advanceLevelUpQueue(q, false);
      expect(q.showing).not.toBeNull();
      seen.push(q.showing?.toLevel as number);
      q = dismissLevelUp(q);
    }
    expect(seen).toEqual([2, 3, 4, 5]);
    expect(q.pending).toHaveLength(0);
    expect(q.showing).toBeNull();
  });

  it("dismissing an already-empty stage is a same-reference no-op", () => {
    expect(dismissLevelUp(EMPTY_LEVEL_UP_QUEUE)).toBe(EMPTY_LEVEL_UP_QUEUE);
  });

  it("advancing an empty queue while unblocked is a same-reference no-op", () => {
    expect(advanceLevelUpQueue(EMPTY_LEVEL_UP_QUEUE, false)).toBe(EMPTY_LEVEL_UP_QUEUE);
  });
});

describe("hasOpenBlockingSurface — the cross-module Doorstep/reveal signal", () => {
  it("is false when neither class is present", () => {
    expect(hasOpenBlockingSurface({ querySelector: () => null })).toBe(false);
  });

  it("is true when the Doorstep or the reveal modal's open class is found", () => {
    expect(hasOpenBlockingSurface({ querySelector: () => ({}) })).toBe(true);
  });

  it("queries exactly the classes those modules toggle", () => {
    let queried = "";
    hasOpenBlockingSurface({
      querySelector: (sel) => {
        queried = sel;
        return null;
      },
    });
    expect(queried).toBe(
      ".pk-doorstep--open, .pk-reveal--open, .pk-loss--open",
    );
  });

  // ROUND 2H (spec §16 v1.5). The tier-up banner and the milestone ribbon
  // (which blocks through this same function) must never fire over
  // `ui/memorial.ts`'s loss moment. This is the assertion that keeps the
  // fix from being silently reverted by a later "tidy the selector" edit.
  it("counts the memorial loss moment as a blocking surface", () => {
    expect(
      hasOpenBlockingSurface({
        querySelector: (sel) => (sel.includes(".pk-loss--open") ? {} : null),
      }),
    ).toBe(true);
  });
});


// ---------------------------------------------------------------------------
// THE CONTROLLER (mutation 11b's target)
// ---------------------------------------------------------------------------

interface FakeBanner {
  readonly el: { remove?: () => void };
  readonly shown: LevelUpOutcome[];
  show(o: LevelUpOutcome, defs: readonly KeepLevelDef[]): void;
  hide(): void;
  isShowing(): boolean;
  dismiss(): void;
}

function fakeBanner(): { banner: FakeBanner; make: (onDismiss: () => void) => FakeBanner } {
  const shown: LevelUpOutcome[] = [];
  let showing = false;
  let onDismissRef: () => void = () => {};
  const banner: FakeBanner = {
    el: {},
    shown,
    show(o): void {
      shown.push(o);
      showing = true;
    },
    hide(): void {
      showing = false;
    },
    isShowing: () => showing,
    dismiss(): void {
      showing = false;
      onDismissRef();
    },
  };
  return {
    banner,
    make: (onDismiss): FakeBanner => {
      onDismissRef = onDismiss;
      return banner;
    },
  };
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

function baseState(): GameState {
  return createNewGame(7, 1_000_000);
}

describe("initLevelUpUi — the store IS connected to the stage (kills mutation 11b)", () => {
  it("shows the banner for a NEW lastLevelUp pushed through the store", () => {
    const { banner, make } = fakeBanner();
    const { store, push } = pushStore(baseState());
    const ui = initLevelUpUi({
      store,
      host: noopHost,
      createBanner: make,
      isBlocked: () => false,
    });

    expect(banner.shown).toEqual([]);
    push({ ...store.getState(), lastLevelUp: outcome(5, 42) });
    expect(banner.shown).toEqual([outcome(5, 42)]);
    expect(banner.isShowing()).toBe(true);
    ui.dispose();
  });

  it("does NOT re-show the same lastLevelUp on later ticks", () => {
    const { banner, make } = fakeBanner();
    const { store, push } = pushStore(baseState());
    const ui = initLevelUpUi({ store, host: noopHost, createBanner: make, isBlocked: () => false });

    const up = outcome(5, 42);
    push({ ...store.getState(), lastLevelUp: up });
    push({ ...store.getState(), lastLevelUp: up });
    push({ ...store.getState(), lastLevelUp: up });
    expect(banner.shown).toHaveLength(1);
    ui.dispose();
  });

  it("ignores a lastLevelUp that was already in the state at construction — only NEW moments fire", () => {
    const { banner, make } = fakeBanner();
    const { store, push } = pushStore({ ...baseState(), lastLevelUp: outcome(3) });
    const ui = initLevelUpUi({ store, host: noopHost, createBanner: make, isBlocked: () => false });
    // Already present at construction: not a new moment, so nothing fires.
    push({ ...store.getState() });
    expect(banner.shown).toEqual([]);
    ui.dispose();
  });

  it("QUEUES behind a blocking surface and drains on the next tick once it clears (bible §6.3)", () => {
    const { banner, make } = fakeBanner();
    const { store, push } = pushStore(baseState());
    let isBlocked = true;
    const ui = initLevelUpUi({
      store,
      host: noopHost,
      createBanner: make,
      isBlocked: () => isBlocked,
    });

    push({ ...store.getState(), lastLevelUp: outcome(6, 7) });
    expect(banner.shown).toEqual([]); // held, not lost

    isBlocked = false;
    push({ ...store.getState() });
    expect(banner.shown).toEqual([outcome(6, 7)]);
    ui.dispose();
  });

  it("plays several queued tier-ups ONE AT A TIME — a migrated veteran's first session back", () => {
    const { banner, make } = fakeBanner();
    const { store, push } = pushStore(baseState());
    const ui = initLevelUpUi({ store, host: noopHost, createBanner: make, isBlocked: () => false });

    push({ ...store.getState(), lastLevelUp: outcome(4, 1) });
    push({ ...store.getState(), lastLevelUp: outcome(5, 2) });
    // Still only the first — never two banners at once.
    expect(banner.shown).toEqual([outcome(4, 1)]);

    banner.dismiss();
    expect(banner.shown).toEqual([outcome(4, 1), outcome(5, 2)]);
    ui.dispose();
  });

  it("stops listening after dispose — a stale controller cannot resurrect a banner", () => {
    const { banner, make } = fakeBanner();
    const { store, push } = pushStore(baseState());
    const ui = initLevelUpUi({ store, host: noopHost, createBanner: make, isBlocked: () => false });
    ui.dispose();
    push({ ...store.getState(), lastLevelUp: outcome(7, 9) });
    expect(banner.shown).toEqual([]);
  });

  it("mounts the banner into the host exactly once", () => {
    const appended: unknown[] = [];
    const { make } = fakeBanner();
    const { store, push } = pushStore(baseState());
    const ui = initLevelUpUi({
      store,
      host: { appendChild: (el: unknown) => appended.push(el) },
      createBanner: make,
      isBlocked: () => false,
    });
    expect(appended).toHaveLength(1);
    ui.dispose();
  });
});
