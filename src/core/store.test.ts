import { describe, expect, it } from "vitest";
import { createStore } from "./store";

interface CounterState {
  count: number;
}

type CounterAction = { type: "increment" } | { type: "add"; amount: number };

function counterReducer(state: CounterState, action: CounterAction): CounterState {
  switch (action.type) {
    case "increment":
      return { count: state.count + 1 };
    case "add":
      return { count: state.count + action.amount };
  }
}

describe("createStore", () => {
  it("getState() returns the initial state before any dispatch", () => {
    const store = createStore(counterReducer, { count: 0 });
    expect(store.getState()).toEqual({ count: 0 });
  });

  it("dispatch() runs the reducer and updates state", () => {
    const store = createStore(counterReducer, { count: 0 });
    store.dispatch({ type: "increment" });
    expect(store.getState()).toEqual({ count: 1 });
    store.dispatch({ type: "add", amount: 41 });
    expect(store.getState()).toEqual({ count: 42 });
  });

  it("subscribe() is called with the new state after each dispatch", () => {
    const store = createStore(counterReducer, { count: 0 });
    const seen: CounterState[] = [];
    store.subscribe((s) => seen.push(s));
    store.dispatch({ type: "increment" });
    store.dispatch({ type: "increment" });
    expect(seen).toEqual([{ count: 1 }, { count: 2 }]);
  });

  it("unsubscribe stops notifications", () => {
    const store = createStore(counterReducer, { count: 0 });
    const seen: CounterState[] = [];
    const unsubscribe = store.subscribe((s) => seen.push(s));
    store.dispatch({ type: "increment" });
    unsubscribe();
    store.dispatch({ type: "increment" });
    expect(seen).toEqual([{ count: 1 }]);
  });

  it("supports multiple independent listeners", () => {
    const store = createStore(counterReducer, { count: 0 });
    let a = 0;
    let b = 0;
    store.subscribe(() => {
      a += 1;
    });
    store.subscribe(() => {
      b += 1;
    });
    store.dispatch({ type: "increment" });
    expect(a).toBe(1);
    expect(b).toBe(1);
  });

  it("one-way flow: the reducer returns new state; prior snapshots are not mutated", () => {
    const initial = { count: 0 };
    const store = createStore(counterReducer, initial);
    const before = store.getState();
    store.dispatch({ type: "increment" });
    expect(initial).toEqual({ count: 0 }); // untouched
    expect(before).toEqual({ count: 0 }); // untouched
    expect(store.getState()).not.toBe(before); // new object, not a mutation
  });

  it("one-way flow: dispatching from inside a reducer throws", () => {
    interface S {
      n: number;
    }
    type A = { type: "reenter" };
    const store = createStore<S, A>((state) => {
      store.dispatch({ type: "reenter" }); // illegal back door
      return state;
    }, { n: 0 });
    expect(() => store.dispatch({ type: "reenter" })).toThrow(
      /one-way flow/,
    );
  });

  it("a throwing reducer propagates the error but leaves the store usable", () => {
    type A = { type: "boom" } | { type: "increment" };
    const store = createStore<CounterState, A>((state, action) => {
      if (action.type === "boom") {
        throw new Error("reducer exploded");
      }
      return { count: state.count + 1 };
    }, { count: 0 });
    const seen: CounterState[] = [];
    store.subscribe((s) => seen.push(s));

    expect(() => store.dispatch({ type: "boom" })).toThrow("reducer exploded");
    expect(store.getState()).toEqual({ count: 0 }); // state untouched
    expect(seen).toEqual([]); // no notification for a failed dispatch

    // Without the finally-reset of the dispatching flag, the store would
    // now be permanently bricked ("one-way flow" on every dispatch).
    store.dispatch({ type: "increment" });
    expect(store.getState()).toEqual({ count: 1 });
    expect(seen).toEqual([{ count: 1 }]);
  });

  it("getState() returns the live current-state reference, stable between dispatches", () => {
    // Contract: getState() hands out the live reference (no defensive
    // copy); callers must treat it as read-only. Reducers return NEW
    // objects (test above), so the reference only changes on dispatch.
    const store = createStore(counterReducer, { count: 0 });
    expect(store.getState()).toBe(store.getState());
    const before = store.getState();
    store.dispatch({ type: "increment" });
    expect(store.getState()).toBe(store.getState());
    expect(store.getState()).not.toBe(before);
  });

  it("listener subscribed during a notification wave is not called until the next dispatch", () => {
    const store = createStore(counterReducer, { count: 0 });
    const calls: string[] = [];
    let lateSubscribed = false;
    store.subscribe(() => {
      calls.push("outer");
      if (!lateSubscribed) {
        lateSubscribed = true;
        store.subscribe(() => {
          calls.push("late");
        });
      }
    });
    store.dispatch({ type: "increment" });
    expect(calls).toEqual(["outer"]); // "late" not called in the same wave
    store.dispatch({ type: "increment" });
    expect(calls).toEqual(["outer", "outer", "late"]);
  });
});
