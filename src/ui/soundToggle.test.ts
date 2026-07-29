/**
 * The mute button's pure layer (node-style, like every other UI suite in
 * the repo — the DOM shell around these is untested chrome).
 *
 * What matters here is the accessibility contract: the accessible NAME
 * must be stable while `aria-pressed` carries the state, and the visible
 * tooltip must name both the current state and what a tap will do.
 */

import { describe, expect, it } from "vitest";
import { SOUND_TOGGLE_LABEL, soundToggleTitle } from "./soundToggle";

describe("soundToggleTitle", () => {
  it("says what the state IS and what a tap will do", () => {
    expect(soundToggleTitle(false)).toMatch(/sound on/i);
    expect(soundToggleTitle(false)).toMatch(/mute/i);
    expect(soundToggleTitle(true)).toMatch(/sound off/i);
    expect(soundToggleTitle(true)).toMatch(/back on/i);
  });

  it("distinguishes the two states", () => {
    expect(soundToggleTitle(true)).not.toBe(soundToggleTitle(false));
  });
});

describe("accessible name", () => {
  it("is stable across states — aria-pressed carries the state, not the name", () => {
    expect(SOUND_TOGGLE_LABEL).toBe("Mute sound");
    expect(SOUND_TOGGLE_LABEL.length).toBeGreaterThan(0);
  });
});
