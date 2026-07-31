/**
 * notify(event) seam (spec §10, §12): in-app toast stack ONLY for MVP.
 * Web Push / service-worker notifications are explicitly out of scope —
 * when they arrive, they plug in HERE (route events to both the toast
 * stack and the push channel); call sites never change.
 *
 * Toast events (spec §10): expedition return, egg pipping, need < 25,
 * Sulking — plus a generic "info" for onboarding nudges.
 *
 * ROUND 2I (docs/notifications-bible.md §7.2) makes the seam real: an
 * event may now carry an optional `push` payload — "what this looks like
 * on a lock screen". The routing decision lives in EXACTLY ONE place:
 *
 *   no `push`, OR the document is visible → toast (existing path, byte-
 *                                            identical for all 15 call
 *                                            sites that predate this round)
 *   `push` present AND the document is hidden → hand off to the
 *                                            registered push channel
 *
 * "Never both" is therefore structurally impossible rather than a rule
 * someone has to remember, and every existing toast (`needLow`, `sulking`,
 * `info`) stays in-app FOREVER by construction — it carries no `push`
 * field, so it can never take the other branch (bible §6 items 2/7).
 *
 * `sound("notify.toast")` moved INSIDE the toast branch here (round 2I
 * finding, bible §7.2): before this round it played unconditionally, which
 * would have chimed from a hidden tab alongside the OS's own notification
 * sound the moment a push event existed.
 *
 * THE PUSH CHANNEL SEAM: this module does not itself call
 * `Notification`/`ServiceWorkerRegistration.showNotification` — that is
 * the scheduling round's job (bible §7.1's `channel.ts`/`scheduler.ts`,
 * arm/wake/timers/outbox), which owns real side effects this module has
 * no business doing twice. `registerPushChannel` is the one seam that
 * round wires into; until it does, a hidden-tab `push` event is silently
 * dropped — the same "UI not mounted yet" tolerance `notify()` already
 * has for `stack === null`, never a thrown error.
 *
 * INTEGRATION STAGE: `src/app/push.ts`'s Tier-1 scheduler now delivers
 * THROUGH this function rather than calling `showNotification` itself, so
 * there is exactly one place in the codebase where "toast or system
 * notification?" is answered. That is what makes this a seam rather than
 * a second, parallel notification path.
 */

import { sound } from "../app/sound";
import type { NotificationTypeId } from "./notificationPrefs";

export type NotifyKind =
  | "expeditionReturn"
  | "eggPipping"
  | "needLow"
  | "sulking"
  | "info";

/** What an event looks like on a lock screen (bible §1's catalogue). Title
 * and body are already-rendered strings — no i18n/formatting happens on
 * this side of the seam. `tag` is the OS notification tag (bible §4.4:
 * `renotify: false`, so a second homecoming REPLACES rather than stacks). */
export interface NotifyPush {
  readonly typeId: NotificationTypeId;
  readonly title: string;
  readonly body: string;
  readonly tag: string;
}

export interface NotifyEvent {
  readonly kind: NotifyKind;
  readonly message: string;
  /** Optional tap action (e.g. an expedition-return toast opening the
   * loot reveal). Tappable toasts get pointer-events and a pressed look;
   * plain toasts stay pass-through. */
  readonly onTap?: () => void;
  /** ROUND 2I: present ⇒ this event is ALSO a candidate for a system
   * notification when the tab is hidden. Absent ⇒ in-app only, forever —
   * every call site written before this round omits it and therefore
   * cannot change behaviour. */
  readonly push?: NotifyPush;
}

/** The one thing `notify()` hands a hidden-tab `push` payload to. Real
 * delivery (permission checks, `showNotification`, budget/quiet-hours,
 * timers) lives entirely on the other side of this seam — see the module
 * doc above.
 *
 * INTEGRATION STAGE: `deliver` resolves `true` iff the OS actually showed
 * something. The scheduler needs that answer because it writes the
 * delivery ledger, and a ledger entry for a notification nobody saw is
 * exactly the "written to state but never visible to the player" shape
 * spec §16 v1.3 keeps catching (it would silently consume a daily-cap
 * slot AND suppress the redelivery). */
export interface PushChannel {
  deliver(push: NotifyPush): Promise<boolean>;
}

/** Which branch `notify()` took, and — for the push branch — whether the
 * OS ended up showing it. Returned so the ONE routing decision in this
 * file is observable to its callers instead of having to be re-derived
 * (or, worse, bypassed) by the scheduler. Every call site that predates
 * round 2I ignores it. */
export interface NotifyResult {
  readonly route: "toast" | "push" | "dropped";
  /** Push route only; `null` otherwise. */
  readonly delivered: Promise<boolean> | null;
}

const MAX_TOASTS = 4;
const TOAST_MS = 3600;

let stack: HTMLElement | null = null;
let pushChannel: PushChannel | null = null;

/** The slice of `document` the visibility check needs. Injectable so a
 * node test can drive both branches without a real DOM (mirrors
 * `app/persistence.ts`'s `VisibilityHost`). Defaults to the real
 * `document`; `undefined`/no document (SSR, a bare node test) reads as
 * "visible" — the same fail-open choice `initNotify`'s existing
 * `stack === null` no-op makes elsewhere in this file. */
export interface NotifyVisibilityHost {
  readonly visibilityState: string;
}

let visibilityHost: NotifyVisibilityHost | null =
  typeof document === "undefined" ? null : document;

/** Test/production override for the visibility source. Production code
 * never calls this — it exists so `notify.test.ts` can drive both the
 * toast and the push branch deterministically. */
export function setNotifyVisibilityHost(host: NotifyVisibilityHost | null): void {
  visibilityHost = host;
}

function documentIsVisible(): boolean {
  return visibilityHost === null || visibilityHost.visibilityState !== "hidden";
}

/** Round 2I's scheduling side registers its real channel here at boot.
 * Passing `null` tears it back down (tests, hot reload) — mirrors
 * `resetSound()`'s pattern in `app/sound.ts`. */
export function registerPushChannel(channel: PushChannel | null): void {
  pushChannel = channel;
}

/** Mount the toast stack into the UI root. Call once at boot. */
export function initNotify(root: HTMLElement): void {
  stack = document.createElement("div");
  stack.className = "pk-toasts";
  // Announce toasts to assistive tech without stealing focus.
  stack.setAttribute("aria-live", "polite");
  stack.setAttribute("role", "status");
  root.appendChild(stack);
}

function showToast(event: NotifyEvent): void {
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

/** THE seam (spec §12, made real by round 2I — bible §7.2). */
export function notify(event: NotifyEvent): NotifyResult {
  if (event.push === undefined || documentIsVisible()) {
    showToast(event);
    return { route: "toast", delivered: null };
  }
  // Hidden tab, a push-eligible event: the toast never fires (bible §2.6/
  // §6 item 8 — "never both"), and the OS-notification decision belongs
  // entirely to the registered channel (quiet hours, the daily cap,
  // per-type toggles, coalescing — none of that is this file's job).
  if (pushChannel === null) return { route: "dropped", delivered: null };
  return { route: "push", delivered: pushChannel.deliver(event.push) };
}
