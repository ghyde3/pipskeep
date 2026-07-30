/**
 * Speech bubble (spec §5: every action produces one dialogue line;
 * spec §10.1.3): a DOM bubble above the Pip, typewriter-in, auto-dismiss
 * ~2.5s after the line finishes. Refusal lines get a warmer tint (funny,
 * not frustrating — spec §5).
 *
 * THE BUBBLE IS CLAMPED TO THE VIEWPORT, and that is not a nicety. `place`
 * writes the Pip's world x straight into `left` while `ui.css` applies
 * `transform: translate(-50%, -100%)`, so the bubble is CENTRED on the Pip
 * — and Pips spawn and loiter near the left of the plot, so the box
 * routinely started at a negative x. Measured on a 375px viewport, cold
 * start, two consecutive lines: "A whole Keep to sniff! …" rendered at
 * x = -30.3 (14% clipped) and "Do clouds know they're clouds? …" at
 * x = -71.5 with a 297.7px box — 24% of the bubble off-screen, painting as
 * "s know they're clouds? …ting.". `max-width: min(270px, 78vw)` capped the
 * WIDTH and nothing capped the POSITION.
 *
 * This is the game's entire personality delivery and it was cut in half on
 * the first launch, so the clamp is `clampBubbleX` below — pure, unit-tested,
 * and applied on every `place` call rather than once at show time (the Pip
 * wanders while it is talking).
 */

const TYPE_MS_PER_CHAR = 22;
const HOLD_MS = 2500;

/** Breathing room between the bubble's edge and the viewport's. */
export const BUBBLE_EDGE_MARGIN = 8;

/**
 * The bubble's centre x, moved the minimum distance needed to keep its whole
 * box on screen. Pure so it is testable without a DOM (this repo's vitest
 * environment is `node`).
 *
 * A bubble too wide to fit at all is CENTRED rather than pinned to one
 * margin: pinning would push the opposite edge off-screen and quietly pick a
 * side to clip, which is the bug this function exists to prevent. That case
 * is reachable — `max-width: 78vw` leaves 22vw of slack, but a narrow
 * viewport plus a long word can still overflow.
 */
export function clampBubbleX(
  x: number,
  bubbleWidth: number,
  viewportWidth: number,
  margin: number = BUBBLE_EDGE_MARGIN,
): number {
  // Nothing measurable yet (detached node, zero-width host) — leave the
  // anchor alone rather than clamping against a bound we do not have.
  if (!Number.isFinite(bubbleWidth) || bubbleWidth <= 0) return x;
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return x;
  const half = bubbleWidth / 2;
  const min = half + margin;
  const max = viewportWidth - half - margin;
  if (min > max) return viewportWidth / 2;
  return Math.min(Math.max(x, min), max);
}

export type BubbleTone = "normal" | "refusal";

export interface SpeechBubble {
  readonly el: HTMLElement;
  show(text: string, tone: BubbleTone): void;
  /** Re-anchor above the Pip (CSS px, canvas-aligned coordinates). */
  place(anchor: { x: number; y: number }): void;
  hide(): void;
}

export function createSpeechBubble(): SpeechBubble {
  const el = document.createElement("div");
  el.className = "pk-bubble";
  const textEl = document.createElement("span");
  el.appendChild(textEl);

  let typeTimer: number | null = null;
  let hideTimer: number | null = null;

  const clearTimers = (): void => {
    if (typeTimer !== null) window.clearInterval(typeTimer);
    if (hideTimer !== null) window.clearTimeout(hideTimer);
    typeTimer = null;
    hideTimer = null;
  };

  const hide = (): void => {
    clearTimers();
    el.classList.remove("pk-bubble--in");
  };

  return {
    el,

    show(text: string, tone: BubbleTone): void {
      clearTimers();
      el.classList.toggle("pk-bubble--refusal", tone === "refusal");
      el.classList.add("pk-bubble--in");
      textEl.textContent = "";
      let i = 0;
      typeTimer = window.setInterval(() => {
        i += 1;
        textEl.textContent = text.slice(0, i);
        if (i >= text.length) {
          if (typeTimer !== null) window.clearInterval(typeTimer);
          typeTimer = null;
          hideTimer = window.setTimeout(hide, HOLD_MS);
        }
      }, TYPE_MS_PER_CHAR);
    },

    place(anchor: { x: number; y: number }): void {
      // `offsetWidth`, NOT `getBoundingClientRect().width`: the bubble's
      // resting transform includes `scale(0.7)`, so the rect would report a
      // box 30% narrower than the one that actually paints once it animates
      // in — and under-clamping is the whole bug.
      const width = el.offsetWidth;
      // `#ui` is `position: absolute; inset: 0`, so `left` is already in
      // viewport coordinates; its own width is the honest bound (it tracks
      // the canvas, which `window.innerWidth` does not on a split view).
      const viewportWidth =
        (el.parentElement?.clientWidth ?? 0) ||
        (typeof window === "undefined" ? 0 : window.innerWidth);
      el.style.left = `${clampBubbleX(anchor.x, width, viewportWidth)}px`;
      el.style.top = `${anchor.y}px`;
    },

    hide,
  };
}
