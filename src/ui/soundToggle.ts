/**
 * The mute control — ONE small speaker button, and the only DOM the sound
 * feature adds to the game.
 *
 * Deliberately self-contained: its own module, its own stylesheet, its
 * own class prefix. It mounts itself into the existing UI root (`#ui`,
 * falling back to whatever mount point it is handed) and edits no other
 * ui/ module.
 *
 * Accessibility, since a speaker glyph on its own tells a screen-reader
 * user nothing:
 * - a real `<button>`, so it is in the tab order and responds to
 *   Enter/Space with no key handling of our own;
 * - a STABLE accessible name ("Mute sound") plus `aria-pressed`, which is
 *   the pattern assistive tech announces correctly as
 *   "Mute sound, toggle button, pressed";
 * - `title` carries the friendlier hover copy for sighted players;
 * - a visible `:focus-visible` ring (soundToggle.css);
 * - state is legible without colour vision: muted swaps the sound waves
 *   for a cross, not merely a hue.
 *
 * Unmuting plays a confirmation chime — otherwise the only feedback that
 * sound came back on is silence, which is indistinguishable from failure.
 */

import "./soundToggle.css";
import type { SoundController } from "../app/sound";

/** Hover/tooltip copy. Pure — unit-testable without a DOM. */
export function soundToggleTitle(muted: boolean): string {
  return muted ? "Sound off — tap to turn it back on" : "Sound on — tap to mute";
}

/** The stable accessible name. Never changes with state: `aria-pressed`
 * carries the state, and a name that mutates mid-press confuses AT. */
export const SOUND_TOGGLE_LABEL = "Mute sound";

const SPEAKER_SVG = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
     focusable="false">
  <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor" stroke-linejoin="round"/>
  <g class="pk-sound-wave">
    <path d="M15.4 9.2a4 4 0 0 1 0 5.6"/>
    <path d="M18 6.8a7.5 7.5 0 0 1 0 10.4"/>
  </g>
  <g class="pk-sound-cross">
    <path d="M16.2 9.8l5 4.4"/>
    <path d="M21.2 9.8l-5 4.4"/>
  </g>
</svg>`;

export interface SoundToggle {
  readonly el: HTMLButtonElement;
  /** Re-read the controller's state (also called on every change). */
  sync(): void;
  dispose(): void;
}

export interface SoundToggleDeps {
  /** Where to mount. `#ui` is preferred when it exists. */
  readonly mount: HTMLElement;
  readonly controller: SoundController;
}

/**
 * Build, wire, and mount the toggle. Returns the handle; callers that
 * never tear down can ignore it.
 */
export function mountSoundToggle(deps: SoundToggleDeps): SoundToggle {
  const { controller } = deps;
  const el = document.createElement("button");
  el.type = "button";
  el.className = "pk-sound-toggle";
  el.setAttribute("aria-label", SOUND_TOGGLE_LABEL);
  el.innerHTML = SPEAKER_SVG;

  const sync = (): void => {
    const muted = controller.isMuted();
    el.setAttribute("aria-pressed", muted ? "true" : "false");
    el.title = soundToggleTitle(muted);
  };
  sync();

  const onClick = (): void => {
    const muted = controller.toggle();
    // Sound just came back: say so out loud. (While muting, the engine
    // is already ramping to silence — nothing to play.)
    if (!muted) controller.play("ui.confirm");
  };
  el.addEventListener("click", onClick);

  const unsubscribe = controller.subscribe(sync);

  // The UI root when it exists (the button then lives in the same
  // overlay as everything else); otherwise whatever the caller passed.
  const root = document.getElementById("ui") ?? deps.mount;
  root.appendChild(el);

  return {
    el,
    sync,
    dispose(): void {
      unsubscribe();
      el.removeEventListener("click", onClick);
      el.remove();
    },
  };
}
