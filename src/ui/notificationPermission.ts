/**
 * Round 2I (docs/notifications-bible.md §3.5) — the two browser primitives
 * the permission-ask surface and the settings sheet both need:
 * `Notification.permission` / `Notification.requestPermission()`, plus the
 * iOS "must be added to the Home Screen first" gate, detected WITHOUT UA
 * sniffing (UA strings rot; a capability probe does not).
 *
 * Structural and fully injectable — no `Notification`/`navigator` needed
 * to unit-test this (spec §1's node test environment has neither), the
 * same decoupling `app/sound.ts` uses for its `AudioContextFactory`.
 *
 * OWNERSHIP NOTE for the peer round (src/app/push.ts / src/core/
 * notifications/, not touched here): the scheduler needs to know the SAME
 * five states this module derives before arming anything (bible §4's
 * `"no-permission"`/`"master-off"`/`"type-off"` suppression reasons all
 * key off exactly this). Either import `detectPermissionState` +
 * `NotificationHost` from here, or re-derive it — the logic is five lines
 * and deliberately has zero DOM-shell dependencies, so importing it pulls
 * in nothing but this file.
 */

/** Every permission-relevant state the UI has to render or gate on. */
export type PermissionState =
  | "unsupported" // no Notification API and not the iOS Home-Screen gate shape
  | "ios-gate" // iOS Safari, not added to the Home Screen (bible §3.5)
  | "default" // Notification exists; nobody has decided yet (or we asked and were declined by OUR card — that distinction lives in NotificationPrefs.declined, not here)
  | "granted"
  | "denied"; // the BROWSER said no — bible §3.4's "holding the door shut"

/** The slice of the global browser surface this module reads. Every field
 * is a plain value or a single async function — no live objects — so a
 * test can construct exactly the shape it wants. */
export interface NotificationHost {
  readonly hasNotification: boolean;
  readonly notificationPermission?: "default" | "granted" | "denied";
  readonly hasServiceWorker: boolean;
  /** `navigator.standalone` — an iOS-Safari-only property. `undefined`
   * on every other platform, which is exactly what excludes them below. */
  readonly standalone?: boolean;
  requestPermission?(): Promise<"default" | "granted" | "denied">;
}

/** Reads the real globals. Never throws under SSR/node — every access is
 * guarded by a `typeof` check first.
 *
 * `notificationPermission` is a GETTER, not a snapshot — this matters.
 * Callers (`notificationAsk.ts`) construct one host once at boot and hold
 * it for the whole session; if this were a plain field it would freeze
 * whatever `Notification.permission` happened to be at that instant, and
 * a grant/deny reached through OUR OWN "Yes, tap me" flow — or the player
 * changing it in the browser's site settings mid-session — would never
 * be seen again without a full reload. Reading live is what lets
 * `shouldOfferAsk`'s "permission !== 'default'" check actually stop
 * offering the ask the moment permission resolves. */
export function defaultNotificationHost(): NotificationHost {
  const hasNotification = typeof Notification !== "undefined";
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  const navWithStandalone = nav as (Navigator & { standalone?: boolean }) | undefined;
  return {
    hasNotification,
    get notificationPermission(): "default" | "granted" | "denied" | undefined {
      return hasNotification ? Notification.permission : undefined;
    },
    hasServiceWorker: nav !== undefined && "serviceWorker" in nav,
    standalone: navWithStandalone?.standalone,
    requestPermission: hasNotification
      ? () => Notification.requestPermission()
      : undefined,
  };
}

/**
 * Bible §3.5's exact detection: *the platform has service workers but is
 * hiding `Notification` from us, and it is a browser that has the
 * `standalone` concept and says we are not in it.* That describes iOS
 * Safari precisely (outside the installed PWA) and degrades to
 * `"unsupported"` — i.e. "just don't offer it" — everywhere else a
 * `Notification`-less environment shows up (an ancient browser, a
 * locked-down webview).
 */
export function detectPermissionState(host: NotificationHost): PermissionState {
  if (!host.hasNotification) {
    const looksLikeHomeScreenGate = host.hasServiceWorker && host.standalone === false;
    return looksLikeHomeScreenGate ? "ios-gate" : "unsupported";
  }
  return host.notificationPermission ?? "default";
}

/**
 * Must be invoked SYNCHRONOUSLY inside a user gesture's click handler —
 * Safari requires the gesture and Chrome heuristically penalises a
 * detached call (bible §3.2/§9.4/§9.6). Never throws: a browser that
 * defines `Notification` but throws on `requestPermission` (some locked-
 * down embeds do) is treated as a denial rather than an app crash.
 */
export async function requestBrowserPermission(
  host: NotificationHost,
): Promise<"default" | "granted" | "denied"> {
  if (host.requestPermission === undefined) return "denied";
  try {
    return await host.requestPermission();
  } catch {
    return "denied";
  }
}
