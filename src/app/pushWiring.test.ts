/**
 * ROUND-2I REVIEW FIX (major) — THE COMPOSITION ROOT'S OWN GUARD.
 *
 * `main.ts` is where the stored notification preference meets the
 * scheduler, and it was the one link in the chain nothing tested. A
 * mutation that severed the two while leaving storage, persistence and the
 * settings sheet fully intact —
 *
 *   getPrefs: () => ({ ...notifyPrefsCtl.get(), types: { homecoming: true, pipping: true } }),
 *
 * — passed the whole suite. The player would toggle "When a trip comes
 * home" off in the Nook, watch it persist and re-render as off, and keep
 * getting homecoming notifications: spec §16 v1.3's dead-feature shape
 * ("written to state" and "visible to the player" are separate acceptance
 * criteria) for the ninth time.
 *
 * `push.test.ts` proves the controller→scheduler path works when wired
 * correctly (its "the REAL persisted prefs controller drives it" case).
 * This file proves `main.ts` is wired that way — a source-level assertion
 * for the same reason `pushServiceWorker.test.ts` makes source-level
 * assertions about `registerSW`: composition-root wiring has no runtime
 * seam a unit test can reach, and this is where the feature dies silently.
 */

import { describe, expect, it } from "vitest";

const appFiles = import.meta.glob("./*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

function raw(key: string): string {
  const text = appFiles[key];
  if (typeof text !== "string") throw new Error(`${key} not found`);
  return text;
}

/** The argument object literal of `call(` in `source`, by brace matching —
 * so an assertion about "what main.ts passes to initPushNotifications"
 * cannot be satisfied by an identical-looking line somewhere else in the
 * file (there are three `getPrefs:` call sites; only one of them is this
 * one). */
function argumentBlock(source: string, call: string): string {
  const start = source.indexOf(call);
  if (start < 0) throw new Error(`${call} not found`);
  let depth = 0;
  for (let i = start + call.length - 1; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces after ${call}`);
}

describe("main.ts wires the stored preference straight into the scheduler", () => {
  const main = raw("./main.ts");
  const block = argumentBlock(main, "initPushNotifications({");

  it("the block extractor found the real call (not a comment or a lookalike)", () => {
    expect(block).toContain("initPushNotifications({");
    expect(block).toContain("getState:");
    expect(block).toContain("getDayOffsetMs:");
    expect(block.length).toBeGreaterThan(100);
  });

  it("passes the live prefs controller through unmodified", () => {
    expect(block).toContain("getPrefs: () => notifyPrefsCtl.get(),");
  });

  it("bakes no preference VALUES into the call site", () => {
    // Any literal `master:`/`types:`/`homecoming:`/`pipping:` here would
    // mean the scheduler is reading something other than what the player
    // toggled — the exact severing mutation this file exists to catch.
    for (const literal of ["master:", "types:", "homecoming:", "pipping:"]) {
      expect(block).not.toContain(literal);
    }
  });

  it("the settings sheet and the ask flow read the same controller", () => {
    // All three surfaces share one in-memory prefs object; if any of them
    // ever forked its own copy, a toggle would stop being one decision.
    expect(main.match(/getPrefs: \(\) => notifyPrefsCtl\.get\(\),/g)).toHaveLength(3);
  });
});
