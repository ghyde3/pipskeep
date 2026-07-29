/**
 * Egg-tap seam between the Keep scene's egg layer (render/keepScene.ts)
 * and the Phase 4 UI wiring (ui/phase4.ts).
 *
 * The scene is created inside app/main.ts and the Phase 4 UI is wired
 * separately via `initPhase4Ui(store, clock)` — neither holds a reference
 * to the other, so the tap crosses through this tiny module-level
 * registry instead (the same shape as ui/notify.ts's `initNotify` +
 * `notify` seam): the scene calls `emitEggTap(eggId)` on a pointer tap;
 * phase4 registers the handler that dispatches HATCH_EGG.
 *
 * Deliberately free of Pixi (and everything else) so ui/ and node tests
 * can import it without pulling the render stack.
 */

export type EggTapHandler = (eggId: string) => void;

let handler: EggTapHandler | null = null;

/** Register (or clear, with null) the tap handler. Last caller wins —
 * there is exactly one Phase 4 UI per page. */
export function setEggTapHandler(next: EggTapHandler | null): void {
  handler = next;
}

/** Called by the scene when a Pipping egg is tapped. Silently dropped
 * when no handler is registered (scene without the Phase 4 UI). */
export function emitEggTap(eggId: string): void {
  handler?.(eggId);
}
