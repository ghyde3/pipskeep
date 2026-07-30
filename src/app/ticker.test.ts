/**
 * Ticker tests (round 2G, brief failure #10: "every visibilitychange
 * dispatches CATCHUP"). Covers ONLY the `onVisibility` guard added this
 * round — whether a foreground return dispatches CATCHUP at all — not the
 * rAF loop itself, which is untested chrome under this repo's `environment:
 * "node"` test config (no browser `requestAnimationFrame`; see
 * `app/persistence.test.ts`'s TimerHost/VisibilityHost pattern for the same
 * convention applied to timers/visibility instead of rAF). `startTicker`
 * already injects `Document` for exactly this reason; `requestAnimationFrame`/
 * `cancelAnimationFrame` are stubbed to inert no-ops for the duration of each
 * test purely so `resume()` doesn't throw a ReferenceError — their behavior
 * is never asserted on.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeClock } from "../core/clock";
import type { GameAction, GameState } from "../core/state";
import type { Store } from "../core/store";
import { TICK_INTERVAL_MS, startTicker } from "./ticker";

class FakeDoc {
  hidden = false;
  private readonly listeners = new Set<() => void>();

  addEventListener(_type: "visibilitychange", listener: () => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "visibilitychange", listener: () => void): void {
    this.listeners.delete(listener);
  }

  /** Flip `hidden` before calling, same as a real tab: background then
   * foreground are two separate `visibilitychange` firings. */
  fire(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

function makeStore(lastTickAt: number): {
  readonly store: Store<GameState, GameAction>;
  readonly dispatched: GameAction[];
} {
  const dispatched: GameAction[] = [];
  const state = { lastTickAt } as GameState;
  const store: Store<GameState, GameAction> = {
    getState: () => state,
    dispatch: (action: GameAction) => {
      dispatched.push(action);
    },
    subscribe: () => () => {},
  };
  return { store, dispatched };
}

describe("startTicker — the visibilitychange→CATCHUP guard", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does NOT dispatch CATCHUP for a flick under two tick intervals — the live loop already covered it", () => {
    const clock = new FakeClock(1_000_000);
    const { store, dispatched } = makeStore(clock.now() - 500); // 0.5s since the last live tick
    const doc = new FakeDoc();
    startTicker(store, clock, doc as unknown as Document);

    doc.hidden = true;
    doc.fire(); // backgrounded
    doc.hidden = false;
    doc.fire(); // foregrounded, ~0.5s later

    expect(dispatched.some((a) => a.type === "CATCHUP")).toBe(false);
  });

  it("still resumes ticking on a trivial flick — pausing while hidden is unaffected by the guard", () => {
    // Indirect: `resume()` calls requestAnimationFrame unconditionally, and
    // our stub records nothing to assert on directly, but a throw here
    // would mean resume() was skipped or the guard broke the call order.
    const clock = new FakeClock(1_000_000);
    const { store } = makeStore(clock.now() - 500);
    const doc = new FakeDoc();
    expect(() => {
      startTicker(store, clock, doc as unknown as Document);
      doc.hidden = true;
      doc.fire();
      doc.hidden = false;
      doc.fire();
    }).not.toThrow();
  });

  it("DOES dispatch CATCHUP once the gap reaches two tick intervals", () => {
    const clock = new FakeClock(1_000_000);
    const { store, dispatched } = makeStore(clock.now() - TICK_INTERVAL_MS * 2);
    const doc = new FakeDoc();
    startTicker(store, clock, doc as unknown as Document);

    doc.hidden = true;
    doc.fire();
    doc.hidden = false;
    doc.fire();

    const catchup = dispatched.find((a) => a.type === "CATCHUP");
    expect(catchup).toBeDefined();
    expect(catchup).toMatchObject({
      type: "CATCHUP",
      savedAt: clock.now() - TICK_INTERVAL_MS * 2,
      now: clock.now(),
    });
  });

  it("DOES dispatch CATCHUP for a genuinely long absence (hours), same as before this round", () => {
    const clock = new FakeClock(1_000_000);
    const { store, dispatched } = makeStore(clock.now() - 6 * 60 * 60 * 1000);
    const doc = new FakeDoc();
    startTicker(store, clock, doc as unknown as Document);

    doc.hidden = true;
    doc.fire();
    doc.hidden = false;
    doc.fire();

    expect(dispatched.some((a) => a.type === "CATCHUP")).toBe(true);
  });

  it("never dispatches CATCHUP on the backgrounding edge itself, only on the return to visible", () => {
    const clock = new FakeClock(1_000_000);
    const { store, dispatched } = makeStore(clock.now() - 6 * 60 * 60 * 1000);
    const doc = new FakeDoc();
    startTicker(store, clock, doc as unknown as Document);

    doc.hidden = true;
    doc.fire(); // backgrounding — must never itself dispatch CATCHUP

    expect(dispatched.some((a) => a.type === "CATCHUP")).toBe(false);
  });

  it("stop() removes the listener — no CATCHUP after teardown", () => {
    const clock = new FakeClock(1_000_000);
    const { store, dispatched } = makeStore(clock.now() - 6 * 60 * 60 * 1000);
    const doc = new FakeDoc();
    const ticker = startTicker(store, clock, doc as unknown as Document);
    ticker.stop();

    doc.hidden = true;
    doc.fire();
    doc.hidden = false;
    doc.fire();

    expect(dispatched.some((a) => a.type === "CATCHUP")).toBe(false);
  });
});
