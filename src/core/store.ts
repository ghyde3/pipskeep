/**
 * Tiny typed store (spec §1 "State", §2 rule 4).
 *
 * One-way flow only: UI/render dispatch actions → the reducer produces new
 * state → subscribers react. There is no setter, and dispatching from
 * inside a reducer throws.
 */

export type Reducer<S, A> = (state: S, action: A) => S;

export type Listener<S> = (state: S) => void;

export interface Store<S, A> {
  getState(): S;
  dispatch(action: A): void;
  /** Returns an unsubscribe function. */
  subscribe(listener: Listener<S>): () => void;
}

export function createStore<S, A>(
  reducer: Reducer<S, A>,
  initialState: S,
): Store<S, A> {
  let state = initialState;
  let dispatching = false;
  const listeners = new Set<Listener<S>>();

  return {
    getState(): S {
      return state;
    },

    dispatch(action: A): void {
      if (dispatching) {
        throw new Error(
          "dispatch() called from inside a reducer — one-way flow only",
        );
      }
      dispatching = true;
      try {
        state = reducer(state, action);
      } finally {
        dispatching = false;
      }
      // Snapshot so listeners unsubscribing mid-notify don't skip anyone.
      for (const listener of [...listeners]) {
        listener(state);
      }
    },

    subscribe(listener: Listener<S>): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
