/**
 * ROUND 2I — THE SCHEDULER (docs/notifications-bible.md §2, §7.1's
 * `channel.ts`/`scheduler.ts`, spec §16 v1.6's Web Push item).
 *
 * THE ARCHITECTURE THIS FILE IMPLEMENTS (bible §2.1/§2.3 — "arm on hide,
 * recompute on wake"): `app/ticker.ts` pauses the game loop the moment the
 * document goes hidden, so no reducer ever dispatches while the tab is
 * hidden and no state TRANSITION is ever there to watch. This module is
 * therefore DERIVATION-driven rather than transition-driven: on
 * `visibilitychange → hidden` it arms a single timer for the next due
 * moment (`core/notifications`'s `nextDueAt`); when that timer fires it
 * does NOT trust the payload it armed — it recomputes
 * `dueNotifications(state, now, settings)` from scratch against whatever
 * the (unadvanced) store holds, delivers exactly what that pure function
 * says should exist, records each delivery in the ledger, and re-arms for
 * the next moment. Becoming visible again cancels the timer and closes
 * every `pk-*` notification still in the shade (bible §2.6 — "a missed
 * delivery is invisible", never replayed, never stale).
 *
 * OWNERSHIP: this file owns the `notify-ledger` SaveStore key (this
 * round's own delivery history) and the Tier-1 timer/registration
 * plumbing. It deliberately REUSES, rather than reimplements, the peer
 * round's `src/ui/notificationPermission.ts` (permission + iOS Home-
 * Screen detection — that module's own doc explicitly invites this: "OWNERSHIP
 * NOTE for the peer round (src/app/push.ts / src/core/notifications/, not
 * touched here): … Either import `detectPermissionState` + `NotificationHost`
 * from here, or re-derive it") and `src/ui/notify.ts`'s `registerPushChannel`
 * seam (the SAME division of labour `app/alerts.ts` already keeps — app/
 * importing types from ui/ is an established pattern in this codebase, not
 * a new one). Nothing here duplicates `src/ui/notificationPrefs.ts`'s
 * stored-preference shape or its earned-ask flow — `getPrefs()` below is
 * injected precisely so this module never needs to know where prefs live.
 *
 * TIER 2 (the pre-rendered outbox a service worker opportunistically
 * drains) and the SW file itself are explicitly OUT OF SCOPE here — that
 * is "service worker config" territory this round fences off from this
 * file. Tier 1 (armed while the page is alive, hidden or not) is "the
 * workhorse" per the bible and is what ships in full below.
 *
 * Every browser surface is injected (`PushSchedulerDeps`) so the whole
 * scheduler runs — arm, wake, cancel, permission checks — inside a plain
 * Vitest/node environment with fakes; nothing here calls a global
 * `Notification`/`navigator`/`setTimeout` directly.
 */

import { tuning as contentTuning } from "../content/tuning";
import { dayIndex } from "../core/progression/streak";
import {
  dueNotifications,
  EMPTY_LEDGER,
  nextDueAt,
  recordDelivery,
} from "../core/notifications";
import type {
  DueNotification,
  NotificationHostTuning,
  NotificationLedger,
  NotificationLedgerEntry,
  NotificationPrefs,
  NotificationStateSlice,
  NotificationTypeId,
} from "../core/notifications";
import {
  defaultNotificationHost,
  detectPermissionState,
} from "../ui/notificationPermission";
import type { NotificationHost } from "../ui/notificationPermission";
import { notify, registerPushChannel } from "../ui/notify";
import type { NotifyKind, NotifyPush, PushChannel } from "../ui/notify";

/** IndexedDB key for this round's delivery ledger — the SAME key-value
 * seam `app/sound.ts`'s `pref-sound` / `src/ui/notificationPrefs.ts`'s
 * `pref-notify` already use (`app/persistence.ts`'s `SaveStore`). Device-
 * local: a delivery history means nothing shared across machines, and the
 * debug menu's save export must never carry it (bible §8's reasoning,
 * restated for this key). */
export const NOTIFY_LEDGER_KEY = "notify-ledger";

/** The minimal key-value seam this module needs — structural, so it
 * imports nothing from `app/persistence.ts` (mirrors `SoundPrefStore`/
 * `NotifyPrefStore`'s own precedent exactly). */
export interface PushLedgerStore {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
}

/** One shown notification's OS-level handle — the slice of a real
 * `Notification` object `getNotifications()` returns that this module
 * needs (bible §2.6/§4.5 mechanism 3: close every `pk-*` entry on
 * becoming visible). */
export interface OsNotificationHandle {
  readonly tag: string;
  close(): void;
}

/** The slice of `ServiceWorkerRegistration` this module needs. Structural
 * so a test can construct exactly this shape with no real SW involved. */
export interface ServiceWorkerRegistrationLike {
  showNotification(
    title: string,
    options?: {
      readonly body?: string;
      readonly tag?: string;
      readonly renotify?: boolean;
      readonly icon?: string;
    },
  ): Promise<void>;
  getNotifications(options?: {
    readonly tag?: string;
  }): Promise<readonly OsNotificationHandle[]>;
}

/** The slice of `navigator.serviceWorker` this module needs — just the
 * `ready` promise vite-plugin-pwa's `generateSW` already registers into
 * (bible §7.3: "no strategy change, no second registration"). This module
 * never calls `.register()` itself. */
export interface ServiceWorkerHost {
  readonly ready: Promise<ServiceWorkerRegistrationLike>;
}

export interface PushTimerHost {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface PushVisibilityHost {
  readonly visibilityState: string;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

/** A `Clock` (spec §2 rule 2 — this module never calls `Date.now()`). */
export interface PushClock {
  now(): number;
}

/** Icon shown on the notification (bible §12 finding 4 — the asset is
 * already precached by the PWA manifest's own globs, so this costs
 * nothing at delivery time). Root-relative: the SW's scope is the app
 * root. No `badge` — that needs a monochrome asset we do not have, and a
 * missing badge degrades silently to the OS default. */
export const NOTIFICATION_ICON_URL = "icons/pip-192.png";

/** How long to wait for `navigator.serviceWorker.ready` before giving up
 * and trying the `Notification` constructor instead.
 *
 * INTEGRATION-STAGE FINDING — this guard is load-bearing, not defensive
 * decoration: `serviceWorker.ready` is a promise that resolves when a SW
 * takes control and **never rejects** if none ever does. `npm run dev`
 * registers no service worker at all (vite-plugin-pwa injects one only
 * for the production build), so without this timeout the very first
 * `await deps.serviceWorker.ready` in `wake()` would hang FOREVER — no
 * delivery, no re-arm, no error, no log. The whole feature would have
 * been dead in dev and in any browser where SW registration is blocked
 * (some private-browsing modes, enterprise policy), and dead silently. */
const SW_READY_TIMEOUT_MS = 4000;

export interface PushSchedulerDeps {
  readonly clock: PushClock;
  /** The live game state, read fresh on every arm/wake — never cached,
   * so a recompute always sees whatever the store currently holds (bible
   * §2.3's "never trust the armed payload"). */
  getState(): NotificationStateSlice;
  /** Wherever `pref-notify` actually lives (`src/ui/notificationPrefs.ts`'s
   * richer shape satisfies this structurally — see `core/notifications`'
   * `NotificationPrefs` doc for why no import is needed either way). */
  getPrefs(): NotificationPrefs;
  /** `GameState.dayOffsetMs` — the same local-day boundary the streak and
   * bounties already use. */
  getDayOffsetMs(): number;
  /** `null`/omitted when no SW registration is available (SSR, a browser
   * without service workers, a test) — every method below no-ops rather
   * than throwing. */
  readonly serviceWorker?: ServiceWorkerHost | null;
  /** Overridable for tests; defaults to the real `Notification` globals
   * via `src/ui/notificationPermission.ts`'s `defaultNotificationHost()`. */
  readonly notificationHost?: NotificationHost;
  /** Omitted → deliveries still compute correctly but nothing persists
   * across a reload (defensive default, mirrors `initSound`'s "no prefs
   * store ⇒ session-only" contract). */
  readonly ledgerStore?: PushLedgerStore;
  readonly timers?: PushTimerHost;
  readonly tuning?: NotificationHostTuning;
  /** Consulted by `wake()` so a timer that fires in the same instant the
   * player returns does NOT hand `notify()` a push event it would render
   * as a toast — the ticker's own CATCHUP is about to produce the real
   * expedition-return toast, and two toasts for one homecoming is a bug.
   * `undefined` ⇒ the real `document`; `null`/no document (node) ⇒ never
   * skip, which is what keeps this suite's fakes delivering. */
  readonly visibility?: PushVisibilityHost | null;
  /** Last-resort delivery when no service-worker registration is
   * available (see `SW_READY_TIMEOUT_MS`). Defaults to the global
   * `Notification` constructor, which desktop browsers support and
   * mobile/PWA contexts do not. Injectable so a node test can prove the
   * fallback actually fires rather than trusting it. */
  readonly showLocalNotification?: (
    title: string,
    options: { readonly body: string; readonly tag: string; readonly icon: string },
  ) => boolean;
}

export interface PushScheduler {
  /** Arm a single timer for the next due moment (or do nothing if there
   * is none outstanding). Safe to call repeatedly — always clears any
   * existing timer first. */
  arm(): void;
  /** Recompute and deliver whatever is due RIGHT NOW, then re-arm for the
   * next moment. Exposed directly (not just as the timer's callback) so
   * the debug menu / a manual "check now" affordance can drive it. */
  wake(): Promise<void>;
  /** Cancel the armed timer and close every `pk-*` notification currently
   * in the shade (bible §2.6/§4.5 mechanism 3 — "a missed delivery is
   * invisible"). */
  cancelAll(): Promise<void>;
  /** Read-only peek at the in-memory ledger, for tests. */
  getLedger(): NotificationLedger;
  dispose(): void;
}

const defaultTimers: PushTimerHost = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** `new Notification(...)` where the platform has it (desktop browsers),
 * `false` where it does not (mobile Chrome and every installed PWA throw
 * "Illegal constructor" — there, only the SW path exists). Never throws. */
function showLocalNotificationDefault(
  title: string,
  options: { readonly body: string; readonly tag: string; readonly icon: string },
): boolean {
  if (typeof Notification === "undefined") return false;
  try {
    new Notification(title, options);
    return true;
  } catch {
    return false;
  }
}

/** Resolve `promise`, or `null` if it has not settled within `ms`.
 *
 * Deliberately on REAL time (`defaultTimers`), not the injected game
 * timer host: this bounds an IO wait on the browser, not a game-time
 * delay. Under a FakeClock whose timers only fire when a test advances
 * them, a fake-timed bound would never expire — the guard would be
 * decorative — and it would also show up in tests' pending-timer counts
 * as a phantom armed notification. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  const timers = defaultTimers;
  return new Promise<T | null>((resolve) => {
    let settled = false;
    const handle = timers.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, ms);
    const finish = (value: T | null): void => {
      if (settled) return;
      settled = true;
      timers.clearTimeout(handle);
      resolve(value);
    };
    promise.then(finish, () => finish(null));
  });
}

/** The toast `kind` a due notification would carry if `notify()` ever
 * took the toast branch for it. The push branch ignores it; it exists so
 * the seam receives a well-formed event either way. */
function kindForType(typeId: NotificationTypeId): NotifyKind {
  return typeId === "pipping" ? "eggPipping" : "expeditionReturn";
}

function isLedgerEntry(value: unknown): value is NotificationLedgerEntry {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Partial<NotificationLedgerEntry>;
  return (
    typeof e.typeId === "string" &&
    Array.isArray(e.subjectIds) &&
    typeof e.dueAt === "number" &&
    typeof e.deliveredAt === "number"
  );
}

/** Tolerant read: anything missing or malformed falls back to
 * `EMPTY_LEDGER` wholesale (a delivery ledger with a broken shape is
 * exactly as good as an empty one — it only ever costs a redundant
 * delivery, never a lost one, since a missing "already-delivered" record
 * just means the item is treated as fresh). */
function readLedger(raw: unknown): NotificationLedger {
  if (typeof raw !== "object" || raw === null) return EMPTY_LEDGER;
  const r = raw as Partial<NotificationLedger>;
  if (typeof r.day !== "number" || !Array.isArray(r.deliveries)) return EMPTY_LEDGER;
  return { day: r.day, deliveries: r.deliveries.filter(isLedgerEntry) };
}

/**
 * The Tier-1 scheduler: arm/wake/cancel over the pure `core/notifications`
 * layer. Every side effect (timers, `showNotification`,
 * `getNotifications().close()`, ledger IO) goes through the injected
 * `PushSchedulerDeps` — nothing here reaches for a browser global.
 */
export function createPushScheduler(deps: PushSchedulerDeps): PushScheduler {
  const timers = deps.timers ?? defaultTimers;
  const tuning = deps.tuning ?? contentTuning;
  const dayIndexOf = (at: number): number => dayIndex(at, deps.getDayOffsetMs(), tuning.retention.dayMs);

  let ledger: NotificationLedger = EMPTY_LEDGER;
  let ledgerLoaded = false;
  let timerHandle: unknown = null;
  let disposed = false;

  // Registered up front so `notify()` — the seam every delivery below
  // routes through — has somewhere to send a hidden-tab push payload.
  // Torn down in `dispose()`.
  const channel = createNotifyPushChannel(deps);
  registerPushChannel(channel);

  async function loadLedgerOnce(): Promise<void> {
    if (ledgerLoaded) return;
    ledgerLoaded = true;
    if (deps.ledgerStore === undefined) return;
    try {
      ledger = readLedger(await deps.ledgerStore.get(NOTIFY_LEDGER_KEY));
    } catch {
      ledger = EMPTY_LEDGER;
    }
  }

  function persistLedger(): void {
    void deps.ledgerStore?.put(NOTIFY_LEDGER_KEY, ledger).catch(() => {
      // A ledger that fails to save costs, at worst, one redundant
      // delivery later — never a crash, and never a lost one (mirrors
      // `app/persistence.ts`'s "write failures reach the console only").
    });
  }

  function permissionGranted(): boolean {
    const host = deps.notificationHost ?? defaultNotificationHost();
    return detectPermissionState(host) === "granted";
  }

  const registration = (): Promise<ServiceWorkerRegistrationLike | null> =>
    resolveRegistration(deps.serviceWorker);

  /** True only when we POSITIVELY know the page is on screen. No document
   * (node) reads as "not visible" so tests still deliver. */
  function pageIsVisible(): boolean {
    const host = deps.visibility === undefined ? defaultVisibilityHost() : deps.visibility;
    return host !== null && host.visibilityState === "visible";
  }

  function clearTimer(): void {
    if (timerHandle !== null) {
      timers.clearTimeout(timerHandle);
      timerHandle = null;
    }
  }

  function arm(): void {
    if (disposed) return;
    clearTimer();
    const now = deps.clock.now();
    const due = nextDueAt(deps.getState(), now, tuning.notifications);
    if (due === null) return;
    timerHandle = timers.setTimeout(() => {
      timerHandle = null;
      void wake();
    }, Math.max(0, due - now));
  }

  /**
   * Delivery goes THROUGH `src/ui/notify.ts`'s seam, never around it —
   * that seam is the one place in the codebase that answers "toast or
   * system notification?", and a scheduler calling `showNotification`
   * itself would be the parallel path this round exists to avoid. It also
   * keeps `notify()`'s push branch live code rather than an unreachable
   * `if` (the round's own dead-feature guard, applied to itself).
   */
  async function deliverOne(item: DueNotification): Promise<boolean> {
    const push: NotifyPush = {
      typeId: item.typeIds[0] ?? "homecoming",
      title: item.title,
      body: item.body,
      tag: item.tag,
    };
    const result = notify({
      kind: kindForType(push.typeId),
      message: `${item.title} — ${item.body}`,
      push,
    });
    // "toast" cannot happen here (wake() has already refused to run while
    // visible) and "dropped" means our own channel was torn down mid-
    // flight. Neither is a delivery, so neither is recorded: an unshown
    // notification consuming its own daily-cap slot would be exactly the
    // "written to state but never visible to the player" shape spec §16
    // v1.3 keeps catching.
    return result.route === "push" ? await (result.delivered ?? Promise.resolve(false)) : false;
  }

  async function wake(): Promise<void> {
    if (disposed) return;
    clearTimer();
    // The player is back. The ticker's CATCHUP is about to tell them
    // everything this notification would have (bible §2.6 — "we never
    // replay"), so say nothing and just re-arm.
    if (pageIsVisible()) {
      arm();
      return;
    }
    await loadLedgerOnce();

    if (permissionGranted()) {
      const now = deps.clock.now();
      const items = dueNotifications(deps.getState(), now, {
        prefs: deps.getPrefs(),
        ledger,
        dayOffsetMs: deps.getDayOffsetMs(),
        permissionGranted: true,
        tuning,
      });
      let changed = false;
      // Sequential, deliberately (not Promise.all): `applyBudget` already
      // decided the full batch's min-gap/daily-cap accounting up front, so
      // this loop's only job is to hand each survivor to the seam and fold
      // its result into `ledger` one at a time, keeping delivery order
      // legible and avoiding concurrent OS notification calls for no
      // benefit.
      for (const item of items) {
        if (await deliverOne(item)) {
          // Bucketed by when it was DELIVERED, not by when it came due —
          // the same instant `applyBudget` counts the daily cap against
          // (see `budget.ts`'s module doc), and the same instant
          // `deliveredCountForDay` reads back out of every entry.
          ledger = recordDelivery(ledger, item, now, dayIndexOf(now), dayIndexOf);
          changed = true;
        }
      }
      if (changed) persistLedger();
    }

    arm();
  }

  async function cancelAll(): Promise<void> {
    clearTimer();
    const reg = await registration();
    if (reg === null) return;
    try {
      const existing = await reg.getNotifications();
      for (const handle of existing) {
        if (handle.tag.startsWith("pk-")) handle.close();
      }
    } catch {
      // Best effort (bible §2.6) — a failure here leaves a stale
      // notification in the shade at worst, never a crash.
    }
  }

  return {
    arm,
    wake,
    cancelAll,
    getLedger: () => ledger,
    dispose(): void {
      disposed = true;
      clearTimer();
      registerPushChannel(null);
    },
  };
}

/** `navigator.serviceWorker.ready`, bounded. Returns `null` rather than
 * hanging or throwing when there is no service worker — see
 * `SW_READY_TIMEOUT_MS` for why the bound is the important part. */
async function resolveRegistration(
  host: ServiceWorkerHost | null | undefined,
): Promise<ServiceWorkerRegistrationLike | null> {
  if (host === undefined || host === null) return null;
  return withTimeout(host.ready, SW_READY_TIMEOUT_MS);
}

/**
 * THE ONE PERFORMER (bible §7.2's seam, `src/ui/notify.ts`'s
 * `registerPushChannel`). Everything that ever reaches the OS goes
 * through here: the Tier-1 scheduler routes its due items into
 * `notify()`, which routes them into this. Deliberately does not consult
 * `applyBudget` — by the time a payload arrives, quiet hours, the daily
 * cap, the toggles and coalescing have all already been decided by the
 * pure layer; this channel only performs.
 *
 * Two delivery mechanisms, in order: the service worker's
 * `showNotification` (works everywhere, required on Android and in an
 * installed PWA), then the `Notification` constructor (desktop only) for
 * the case where no SW registration is available — `npm run dev` being
 * the one every developer meets.
 */
export function createNotifyPushChannel(
  deps: Pick<
    PushSchedulerDeps,
    "serviceWorker" | "notificationHost" | "showLocalNotification"
  >,
): PushChannel {
  return {
    async deliver(push: NotifyPush): Promise<boolean> {
      const host = deps.notificationHost ?? defaultNotificationHost();
      if (detectPermissionState(host) !== "granted") return false;
      const reg = await resolveRegistration(deps.serviceWorker);
      if (reg !== null) {
        try {
          await reg.showNotification(push.title, {
            body: push.body,
            tag: push.tag,
            renotify: false,
            icon: NOTIFICATION_ICON_URL,
          });
          return true;
        } catch {
          // Fall through to the constructor — same fail-open discipline
          // as everywhere else in this file.
        }
      }
      const showLocal = deps.showLocalNotification ?? showLocalNotificationDefault;
      return showLocal(push.title, {
        body: push.body,
        tag: push.tag,
        icon: NOTIFICATION_ICON_URL,
      });
    },
  };
}

function defaultVisibilityHost(): PushVisibilityHost | null {
  return typeof document === "undefined" ? null : (document as unknown as PushVisibilityHost);
}

export interface PushNotifications {
  readonly scheduler: PushScheduler;
  dispose(): void;
}

/**
 * Wire the scheduler to `visibilitychange` — the one call `app/main.ts`
 * makes to turn this whole directory on. (`createPushScheduler` has
 * already registered the push channel with `src/ui/notify.ts`'s seam.)
 *
 * On hidden: arm. On visible: cancel everything and close every `pk-*`
 * notification already in the shade (bible §2.6 — never a stale buzz
 * about something the player just walked back in to see for themselves).
 */
export function initPushNotifications(deps: PushSchedulerDeps): PushNotifications {
  const scheduler = createPushScheduler(deps);
  const visibility = deps.visibility === undefined ? defaultVisibilityHost() : deps.visibility;
  const onVisibility = (): void => {
    if (visibility?.visibilityState === "hidden") {
      scheduler.arm();
    } else {
      void scheduler.cancelAll();
    }
  };
  visibility?.addEventListener("visibilitychange", onVisibility);

  return {
    scheduler,
    dispose(): void {
      registerPushChannel(null);
      visibility?.removeEventListener("visibilitychange", onVisibility);
      scheduler.dispose();
    },
  };
}

export type { NotificationTypeId };
