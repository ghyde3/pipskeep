/**
 * Speech bubble (spec §5: every action produces one dialogue line;
 * spec §10.1.3): a DOM bubble above the Pip, typewriter-in, auto-dismiss
 * ~2.5s after the line finishes. Refusal lines get a warmer tint (funny,
 * not frustrating — spec §5).
 */

const TYPE_MS_PER_CHAR = 22;
const HOLD_MS = 2500;

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
      el.style.left = `${anchor.x}px`;
      el.style.top = `${anchor.y}px`;
    },

    hide,
  };
}
