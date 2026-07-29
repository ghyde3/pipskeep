/**
 * notify(event) seam (spec §10, §12): in-app toast stack ONLY for MVP.
 * Web Push / service-worker notifications are explicitly out of scope —
 * when they arrive, they plug in HERE (route events to both the toast
 * stack and the push channel); call sites never change.
 *
 * Toast events (spec §10): expedition return, egg pipping, need < 25,
 * Sulking — plus a generic "info" for onboarding nudges.
 */

import { sound } from "../app/sound";

export type NotifyKind =
  | "expeditionReturn"
  | "eggPipping"
  | "needLow"
  | "sulking"
  | "info";

export interface NotifyEvent {
  readonly kind: NotifyKind;
  readonly message: string;
  /** Optional tap action (e.g. an expedition-return toast opening the
   * loot reveal). Tappable toasts get pointer-events and a pressed look;
   * plain toasts stay pass-through. */
  readonly onTap?: () => void;
}

const MAX_TOASTS = 4;
const TOAST_MS = 3600;

let stack: HTMLElement | null = null;

/** Mount the toast stack into the UI root. Call once at boot. */
export function initNotify(root: HTMLElement): void {
  stack = document.createElement("div");
  stack.className = "pk-toasts";
  // Announce toasts to assistive tech without stealing focus.
  stack.setAttribute("aria-live", "polite");
  stack.setAttribute("role", "status");
  root.appendChild(stack);
}

/** THE seam (spec §12). In-app only for MVP. */
export function notify(event: NotifyEvent): void {
  if (stack === null) return; // UI not mounted yet — MVP drops silently
  while (stack.children.length >= MAX_TOASTS) {
    stack.firstElementChild?.remove();
  }
  const toast = document.createElement("div");
  toast.className = `pk-toast pk-toast--${event.kind}`;
  toast.textContent = event.message;
  const onTap = event.onTap;
  if (onTap !== undefined) {
    toast.classList.add("pk-toast--tap");
    // Tappable toasts are real buttons for keyboard/AT users.
    toast.setAttribute("role", "button");
    toast.setAttribute("tabindex", "0");
    toast.addEventListener("click", () => {
      toast.remove();
      onTap();
    });
    toast.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        toast.remove();
        onTap();
      }
    });
  }
  stack.appendChild(toast);
  sound("notify.toast");
  // Slide in on the next frame so the transition runs.
  requestAnimationFrame(() => toast.classList.add("pk-toast--in"));
  window.setTimeout(() => {
    toast.classList.remove("pk-toast--in");
    window.setTimeout(() => toast.remove(), 260);
  }, TOAST_MS);
}
