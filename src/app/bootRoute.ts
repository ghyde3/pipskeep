/**
 * Boot routing (spec §8) — the decision point between "start the game"
 * and "halt at the corrupt-save recovery modal", extracted from main.ts
 * so it is testable without Pixi or a DOM.
 *
 * The historical failure mode this file exists to prevent: a corrupt
 * blob and a missing blob both arrive as `loaded.save === null`, and a
 * careless boot treats them the same — silently wiping the corrupt save
 * with `createNewGame`. Spec §8 forbids exactly that ("never silently
 * wipe"). The two cases are distinguished by `loadError`:
 *
 * - `{ save: null, loadError }` → show the recovery modal and HALT. The
 *   game starts only when the modal's Start Fresh continuation fires.
 * - `{ save: null }` (no loadError) → genuinely fresh install → start.
 * - `{ save }` → valid save → start.
 *
 * main.ts wires `showRecovery` to the real showRecoveryModal and
 * `startGame` to the Pixi/UI boot continuation; bootRoute.test.ts wires
 * both to spies and asserts the routing — including that startGame is
 * NOT reachable on the corrupt path except through onStartFresh.
 */

import type { SaveBlobError } from "../core/save/serialize";
import type { LoadResult } from "./persistence";

/** What the recovery UI needs to mount. `onStartFresh` is the one and
 * only way boot continues past a corrupt blob. */
export interface RecoveryPrompt {
  readonly loadError: SaveBlobError;
  readonly rawBlob: unknown;
  onStartFresh(): void;
}

export interface BootRouteDeps {
  /** Mount the blocking recovery UI (showRecoveryModal in production). */
  showRecovery(prompt: RecoveryPrompt): void;
  /** The rest of boot: store, world, UI, ticker. Receives the original
   * LoadResult so the corrupt path still quarantines via initPersistence. */
  startGame(loaded: LoadResult): void | Promise<void>;
}

export type BootRoute = "recovery" | "start";

/**
 * Route a completed load. Resolves after `startGame` on the start path;
 * on the recovery path it resolves immediately with the modal up — boot
 * is halted, and `startGame` runs later, iff the player chooses Start
 * Fresh (fired at most once by the recovery controller).
 */
export async function routeBoot(
  loaded: LoadResult,
  deps: BootRouteDeps,
): Promise<BootRoute> {
  if (loaded.save === null && loaded.loadError !== undefined) {
    const loadError = loaded.loadError;
    deps.showRecovery({
      loadError,
      rawBlob: loaded.rawBlob,
      onStartFresh: () => {
        void deps.startGame(loaded);
      },
    });
    return "recovery";
  }
  await deps.startGame(loaded);
  return "start";
}
