/**
 * Visitor-tap seam between the Keep scene's visitor actors
 * (render/keepScene.ts) and the UI's Visitor card (ui/visitorCard.ts).
 *
 * Identical shape to render/pipTap.ts and render/eggTap.ts, and it is a
 * SEPARATE seam from pipTap on purpose: a visitor is not your Pip. It has
 * no needs, no job and no expedition, so a tap on one must never reach
 * the focus view (bible §1.5: "deliberately NOT the focus view"). Giving
 * it its own emitter means that separation is structural rather than a
 * branch someone can forget inside the pip handler — and it is what the
 * Visitor card's own test can drive without a canvas.
 *
 * The payload is the ATTRACTION'S placement id, not a visitor id: the
 * `VisitorRecord` lives at `state.visitors[placementId]`, one per
 * attraction, so the placement is the stable identity for the whole
 * feature (a welcome clears the record; the placement outlives it).
 *
 * Deliberately free of Pixi (and everything else) so ui/ and node tests
 * can import it without pulling the render stack.
 */

export type VisitorTapHandler = (placementId: string) => void;

let handler: VisitorTapHandler | null = null;

/** Register (or clear, with null) the tap handler. Last caller wins —
 * there is exactly one Keep UI per page. */
export function setVisitorTapHandler(next: VisitorTapHandler | null): void {
  handler = next;
}

/** Called by the scene when a visitor is tapped. Silently dropped when no
 * handler is registered (scene without the UI, e.g. tests). */
export function emitVisitorTap(placementId: string): void {
  handler?.(placementId);
}
