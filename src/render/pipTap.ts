/**
 * Pip-tap seam between the Keep scene's wandering-pip layer
 * (render/keepScene.ts) and the UI (focus view / evolution tap).
 *
 * Same shape as render/eggTap.ts: the scene and the UI are wired
 * independently in app/main.ts and hold no reference to each other, so
 * the tap crosses through this module-level registry. The scene calls
 * `emitPipTap(pipId)` on a pointer tap over a pip; the UI registers the
 * handler that decides what the tap means (open focus view, or dispatch
 * EVOLVE_PIP when the pip is glowing readyToEvolve — spec §4.6).
 *
 * Deliberately free of Pixi (and everything else) so ui/ and node tests
 * can import it without pulling the render stack.
 */

export type PipTapHandler = (pipId: string) => void;

let handler: PipTapHandler | null = null;

/** Register (or clear, with null) the tap handler. Last caller wins —
 * there is exactly one Keep UI per page. */
export function setPipTapHandler(next: PipTapHandler | null): void {
  handler = next;
}

/** Called by the scene when a pip is tapped. Silently dropped when no
 * handler is registered (scene without the UI, e.g. tests). */
export function emitPipTap(pipId: string): void {
  handler?.(pipId);
}
