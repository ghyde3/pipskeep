/**
 * Speech-bubble placement (spec §5/§10.1.3).
 *
 * ROUND 2G REVIEW: `place()` wrote the Pip's world x straight into `left`
 * while the CSS centres the bubble on it (`translate(-50%, -100%)`), and Pips
 * spawn and loiter near the left of the plot — so the bubble routinely
 * started at a negative x and the game's entire personality delivery was cut
 * in half on the first launch. Measured at 375px, cold start, two consecutive
 * lines: x = -30.3 with a 215.3px box (14% clipped, rendering as "ole Keep to
 * sniff! …ywhere. Good."), then x = -71.5 with a 297.7px box — 24% of the
 * bubble off-screen. `max-width: min(270px, 78vw)` capped the width; nothing
 * capped the position.
 *
 * The clamp is pure so it can be tested here (vitest runs `node` in this
 * repo — see `fakeDom.ts`'s header for why there is no jsdom).
 */

import { describe, expect, it } from "vitest";
import { BUBBLE_EDGE_MARGIN, clampBubbleX } from "./speechBubble";

const VIEWPORT = 375;

describe("clampBubbleX", () => {
  it("leaves a bubble that already fits exactly where the Pip is", () => {
    expect(clampBubbleX(200, 220, VIEWPORT)).toBe(200);
    expect(clampBubbleX(VIEWPORT / 2, 270, VIEWPORT)).toBe(VIEWPORT / 2);
  });

  it("pulls the two measured real-world failures fully on screen", () => {
    // "A whole Keep to sniff! Where do we start? Everywhere. Good."
    const a = clampBubbleX(-30.3 + 215.3 / 2, 215.3, VIEWPORT);
    expect(a - 215.3 / 2).toBeGreaterThanOrEqual(0);
    // "Do clouds know they're clouds? Investigating."
    const b = clampBubbleX(-71.5 + 297.7 / 2, 297.7, VIEWPORT);
    expect(b - 297.7 / 2).toBeGreaterThanOrEqual(0);
  });

  it("keeps both edges inside the viewport, with the margin, at either end", () => {
    const width = 240;
    const left = clampBubbleX(-500, width, VIEWPORT);
    expect(left - width / 2).toBeCloseTo(BUBBLE_EDGE_MARGIN, 6);

    const right = clampBubbleX(9999, width, VIEWPORT);
    expect(right + width / 2).toBeCloseTo(VIEWPORT - BUBBLE_EDGE_MARGIN, 6);
  });

  it("moves the bubble the MINIMUM distance — it does not re-centre a bubble that is only slightly out", () => {
    const width = 100;
    const nudged = clampBubbleX(20, width, VIEWPORT);
    expect(nudged).toBe(width / 2 + BUBBLE_EDGE_MARGIN);
    expect(nudged).toBeLessThan(VIEWPORT / 2);
  });

  it("centres — rather than pinning one edge and clipping the other — when the bubble cannot fit", () => {
    // Reachable: `max-width: 78vw` leaves slack, but a long unbreakable word
    // on a narrow viewport still overflows. Pinning would silently pick a
    // side to cut off, which is the bug this whole function exists to stop.
    expect(clampBubbleX(0, VIEWPORT + 40, VIEWPORT)).toBe(VIEWPORT / 2);
    expect(clampBubbleX(9999, VIEWPORT + 40, VIEWPORT)).toBe(VIEWPORT / 2);
  });

  it("leaves the anchor alone when nothing is measurable yet, rather than pinning it to 0", () => {
    // A detached node reports width 0; a zero-width host reports no bound.
    // "Unknown" must not be treated as "the chrome fills the screen".
    expect(clampBubbleX(123, 0, VIEWPORT)).toBe(123);
    expect(clampBubbleX(123, Number.NaN, VIEWPORT)).toBe(123);
    expect(clampBubbleX(123, 200, 0)).toBe(123);
  });

  it("is stable — clamping an already-clamped x is a no-op", () => {
    const once = clampBubbleX(-400, 260, VIEWPORT);
    expect(clampBubbleX(once, 260, VIEWPORT)).toBe(once);
  });
});
