/**
 * ROUND 2I — the notification handler must stay INSIDE the one existing
 * service worker (docs/notifications-bible.md §7.3, and the owner's
 * "web only, no second service worker" decision).
 *
 * These assertions are deliberately about BUILD CONFIG rather than runtime
 * behaviour, because that is where this particular feature dies silently: a
 * notification that is delivered but does nothing when tapped is a dead end
 * at the exact moment the round exists to serve, and nothing else in the
 * suite would notice `importScripts` being dropped from `vite.config.ts` or
 * `public/pk-notify-sw.js` being deleted.
 *
 * Verified live at the integration gate against a real production build:
 * `dist/sw.js` contained `importScripts("pk-notify-sw.js")`, the precache
 * manifest held 12 entries and did NOT include the handler, and the offline
 * reload (server killed) still booted the game from cache.
 */

import { describe, expect, it } from "vitest";

/** `?raw` through Vite, the same way `src/ui/layers.test.ts` reads the
 * stylesheets it asserts against — no `node:fs`, so `tsc --noEmit` needs no
 * @types/node (which is not on the §1 allowlist). */
function raw(glob: Record<string, unknown>, key: string): string {
  const text = glob[key];
  if (typeof text !== "string") throw new Error(`${key} not found`);
  return text;
}

const rootFiles = import.meta.glob("../../*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});
const publicFiles = import.meta.glob("../../public/*.js", {
  query: "?raw",
  import: "default",
  eager: true,
});
const appFiles = import.meta.glob("./*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});
/** Every source file under `src/` — the second-registration guard below
 * has to scan all of them, not just `main.ts`, because a stray
 * `navigator.serviceWorker.register(...)` anywhere would compete for the
 * same scope. Test files are excluded (they quote the very pattern being
 * banned, this one included). */
const srcFiles = import.meta.glob("../**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

function productionSources(): readonly (readonly [string, string])[] {
  return Object.entries(srcFiles)
    .filter(([key]) => !key.endsWith(".test.ts"))
    .map(([key, value]) => [key, typeof value === "string" ? value : ""] as const);
}

const viteConfig = raw(rootFiles, "../../vite.config.ts");
const handler = raw(publicFiles, "../../public/pk-notify-sw.js");

describe("the notification service-worker handler", () => {
  it("is imported into the existing generateSW worker, not registered as a second one", () => {
    expect(viteConfig).toContain('importScripts: ["pk-notify-sw.js"]');
    // generateSW, unchanged: switching to injectManifest would pull
    // workbox-precaching in as a de facto runtime dependency, which the §1
    // allowlist forbids without asking.
    expect(viteConfig).not.toContain("injectManifest");
    expect(viteConfig).not.toContain("strategies:");
    // Exactly one registration call in the whole app.
    expect(raw(appFiles, "./main.ts").match(/registerSW\(/g)).toHaveLength(1);
  });

  it("nothing anywhere in src/ registers a service worker directly", () => {
    // ROUND-2I REVIEW FIX (major). The assertion above counts only the
    // vite-plugin-pwa helper `registerSW(`, so a raw
    // `navigator.serviceWorker.register("pk-notify-sw.js")` added right
    // beside it still yielded exactly one match and sailed through — the
    // test's comment promised "exactly one registration call in the whole
    // app" while enforcing something much narrower. A second worker
    // competing for scope "/" would mean duplicate notificationclick
    // handlers and controller thrash against the precache worker, and it
    // is the owner's explicit "web only, no second service worker"
    // decision (bible §7.3) that this guards.
    const offenders = productionSources()
      .filter(([, text]) => /serviceWorker\s*\.\s*register\s*\(/.test(text))
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });

  it("the scan above actually sees main.ts (the guard isn't looking at an empty set)", () => {
    const keys = productionSources().map(([key]) => key);
    expect(keys.some((k) => k.endsWith("/main.ts") || k === "./main.ts")).toBe(true);
    expect(keys.some((k) => k.includes("/ui/"))).toBe(true);
    expect(keys.length).toBeGreaterThan(20);
  });

  it("is excluded from the precache manifest", () => {
    // Precaching a service-worker script as if it were a page asset would
    // pin a stale copy behind the SW's own update cycle.
    expect(viteConfig).toContain('globIgnores: ["pk-notify-sw.js"]');
  });

  it("makes a delivered notification tappable", () => {
    expect(handler).toContain("notificationclick");
    expect(handler).toContain("event.notification.close()");
    // Focus an existing window if there is one, else open the app.
    expect(handler).toContain("clients.matchAll");
    expect(handler).toContain("openWindow");
  });

  it("carries no game logic — a service worker can never import our modules", () => {
    // Statements only — the file's own doc comment says the words.
    const code = handler.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/^\s*import\s/m);
    expect(code).not.toMatch(/\brequire\(/);
    // No decision-making: quiet hours, the daily cap, the toggles and the
    // copy are all decided by the tested pure layer before anything is shown.
    expect(code).not.toContain("showNotification");
  });
});
