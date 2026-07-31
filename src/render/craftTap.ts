/**
 * Craft-Table-tap seam between the Keep scene (render/keepScene.ts) and
 * the app wiring (app/main.ts), exactly mirroring `render/eggTap.ts`.
 *
 * ROUND 2J FIX STAGE. Before this, the physical bench standing in the
 * Keep was entirely inert: it could not be opened, and it could not tell
 * you it was working. The recipe book was reachable ONLY from the Nook
 * menu — economy-bible §6.3 specifies "a recipe sheet opened from the
 * Craft Table (and from the nav menu)", and only the nav route was wired.
 *
 * Deliberately free of Pixi (and everything else) so ui/ and node tests
 * can import it without pulling the render stack.
 */

export type CraftTableTapHandler = (stationPlacementId: string) => void;

let handler: CraftTableTapHandler | null = null;

/** Register (or clear, with null) the tap handler. Last caller wins —
 * there is exactly one app wiring per page. */
export function setCraftTableTapHandler(next: CraftTableTapHandler | null): void {
  handler = next;
}

/** Called by the scene when a placed Craft Table is tapped. Silently
 * dropped when no handler is registered (a scene without the app UI). */
export function emitCraftTableTap(stationPlacementId: string): void {
  handler?.(stationPlacementId);
}
