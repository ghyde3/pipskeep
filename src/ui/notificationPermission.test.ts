/**
 * Round 2I (docs/notifications-bible.md §3.5) — the iOS detection is the
 * one piece of logic in this round that MUST be right without ever
 * running on an actual iPhone, so it gets its own pinned truth table.
 */

import { describe, expect, it } from "vitest";
import {
  defaultNotificationHost,
  detectPermissionState,
  requestBrowserPermission,
} from "./notificationPermission";
import type { NotificationHost } from "./notificationPermission";

function host(overrides: Partial<NotificationHost>): NotificationHost {
  return {
    hasNotification: true,
    notificationPermission: "default",
    hasServiceWorker: true,
    standalone: undefined,
    ...overrides,
  };
}

describe("detectPermissionState", () => {
  it("reads the browser's Notification.permission directly when Notification exists", () => {
    expect(detectPermissionState(host({ notificationPermission: "granted" }))).toBe("granted");
    expect(detectPermissionState(host({ notificationPermission: "denied" }))).toBe("denied");
    expect(detectPermissionState(host({ notificationPermission: "default" }))).toBe("default");
  });

  it("bible §3.5 — iOS Safari shape: no Notification, has serviceWorker, standalone === false", () => {
    const iosSafari = host({
      hasNotification: false,
      notificationPermission: undefined,
      hasServiceWorker: true,
      standalone: false,
    });
    expect(detectPermissionState(iosSafari)).toBe("ios-gate");
  });

  it("an installed iOS PWA (standalone === true) is NOT the gate shape", () => {
    // Real iOS installed PWAs DO define Notification (16.4+), so this
    // exercises the "standalone true" half of the exclusion independent
    // of that — the detector must not flag it even if Notification were
    // somehow still missing.
    const installed = host({
      hasNotification: false,
      notificationPermission: undefined,
      hasServiceWorker: true,
      standalone: true,
    });
    expect(detectPermissionState(installed)).toBe("unsupported");
  });

  it("no Notification, no serviceWorker, no standalone concept → unsupported, not ios-gate", () => {
    const ancientBrowser = host({
      hasNotification: false,
      notificationPermission: undefined,
      hasServiceWorker: false,
      standalone: undefined,
    });
    expect(detectPermissionState(ancientBrowser)).toBe("unsupported");
  });

  it("desktop Chrome (has Notification, has serviceWorker, no `standalone` property) reads permission normally", () => {
    const desktopChrome = host({
      hasNotification: true,
      notificationPermission: "default",
      hasServiceWorker: true,
      standalone: undefined,
    });
    expect(detectPermissionState(desktopChrome)).toBe("default");
  });
});

describe("requestBrowserPermission", () => {
  it("forwards the host's result", async () => {
    const granted = host({ requestPermission: async () => "granted" });
    await expect(requestBrowserPermission(granted)).resolves.toBe("granted");
  });

  it("treats a missing requestPermission as a denial rather than throwing", async () => {
    const noRequest = host({ requestPermission: undefined });
    await expect(requestBrowserPermission(noRequest)).resolves.toBe("denied");
  });

  it("treats a throwing requestPermission as a denial rather than propagating", async () => {
    const throwing = host({
      requestPermission: async () => {
        throw new Error("locked-down embed");
      },
    });
    await expect(requestBrowserPermission(throwing)).resolves.toBe("denied");
  });
});

describe("defaultNotificationHost", () => {
  it("never throws under node (no Notification, no navigator)", () => {
    expect(() => defaultNotificationHost()).not.toThrow();
    const result = defaultNotificationHost();
    expect(result.hasNotification).toBe(false);
  });
});
