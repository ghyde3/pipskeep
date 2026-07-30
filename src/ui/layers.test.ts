/**
 * THE LAYER LADDER — the round-2C integrate stage's regression guard for
 * this project's one recurring UI bug.
 *
 * The bug, on the record: `.pk-keepbar` (the Keep chip + Build button) lives
 * inside `.pk-phase5`, which declares `z-index: 6` and therefore opens its
 * OWN stacking context. Every z-index inside it is relative to that 6, so
 * the keep bar could not be pushed under a sheet by raising the sheet's
 * z-index — it had to be HIDDEN instead (`onOpenChange` in buildSheet.ts /
 * phase5.ts). Round 2C then added five more overlays, three of them
 * reachable from each other, and the shipped values had them TIED at 20
 * with the focus view — a tie that CSS resolves by DOM order, i.e. by
 * main.ts's mount sequence, i.e. by accident.
 *
 * So the ladder is written down here, once, and asserted against the actual
 * stylesheets. This test is deliberately not clever: it reads the CSS as
 * text and checks the numbers, because the failure mode it guards is
 * someone changing a number in one file without looking at the others.
 *
 * Two invariants matter more than the individual numbers:
 *
 *   A. `.pk-phase5` MUST keep declaring a z-index. That is what makes it a
 *      stacking context, which is what clamps the keep bar (9) and the
 *      Phase 5 sheets (8) beneath every full-screen surface. If someone
 *      "cleans up" that declaration, the keep bar escapes to the root
 *      stacking context at 9 — still under the sheets at 20, but now
 *      ABOVE the Nook popover at 12, and the bug is back in a new costume.
 *
 *   B. No two overlays that can be open at the same time may share a rung.
 *      Peers that are mutually exclusive by construction (the items sheet
 *      and the focus view; the Album and the Long Meadow) are allowed to
 *      share, and main.ts's `onPick` is what makes that true.
 */

import { describe, expect, it } from "vitest";

const cssFiles = import.meta.glob("./*.css", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function css(file: string): string {
  const text = cssFiles[`./${file}`];
  if (text === undefined) throw new Error(`${file} not found`);
  return text;
}

/** The declared value of one property on one selector, or null. */
function declOf(file: string, selector: string, prop: string): string | null {
  const text = css(file).replace(/\/\*[\s\S]*?\*\//g, "");
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = ruleRe.exec(text)) !== null) {
    const selectors = (match[1] ?? "")
      .split(",")
      .map((sel) => sel.trim())
      .filter((sel) => sel.length > 0);
    if (!selectors.includes(selector)) continue;
    const re = new RegExp(`(?:^|[;\\s])${prop}:\\s*([^;]+)`);
    const found = re.exec(match[2] ?? "");
    if (found !== null) return (found[1] ?? "").trim();
  }
  return null;
}

/**
 * The z-index a selector declares in a file, or null when it declares
 * none. Flat top-level rules only, which is all the ladder uses.
 */
function zIndexOf(file: string, selector: string): number | null {
  // Strip comments from the WHOLE file FIRST. Doing it per-selector after
  // splitting on "," is wrong: these stylesheets are heavily commented and
  // several comments contain commas, which shreds the selector list.
  const text = css(file).replace(/\/\*[\s\S]*?\*\//g, "");
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = ruleRe.exec(text)) !== null) {
    const selectors = (match[1] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (!selectors.includes(selector)) continue;
    const z = /(?:^|[;\s])z-index:\s*(-?\d+)/.exec(match[2] ?? "");
    if (z !== null) return Number(z[1]);
  }
  return null;
}

/**
 * THE LADDER. Order in this array IS the assertion: each entry must sit at
 * a z-index greater than or equal to the one before it, and `distinct`
 * entries must be strictly greater than everything before them.
 */
interface Rung {
  readonly layer: string;
  readonly file: string;
  readonly selector: string;
  readonly z: number;
  /** What this layer is, in one line — the reason the rung exists. */
  readonly why: string;
  /** May share its number with the rung before it (mutually exclusive). */
  readonly peer?: boolean;
}

const LADDER: readonly Rung[] = [
  {
    layer: "float",
    file: "soundToggle.css",
    selector: ".pk-sound-toggle",
    z: 5,
    why: "floating round button — must be COVERED by any open surface",
  },
  {
    layer: "float",
    file: "navMenu.css",
    selector: ".pk-nav-btn",
    z: 5,
    why: "the Nook button — same rung as the sound toggle, its neighbour",
    peer: true,
  },
  {
    layer: "float",
    file: "dailies.css",
    selector: ".pk-daily-entry",
    z: 5,
    why: "the dailies button (no longer mounted by the app; kept in sync)",
    peer: true,
  },
  {
    layer: "phase5-chrome",
    file: "ui.css",
    selector: ".pk-phase5",
    z: 6,
    why: "STACKING CONTEXT — clamps the keep bar (9) and phase5 sheets (8)",
  },
  {
    layer: "nav-popover",
    file: "navMenu.css",
    selector: ".pk-nav-wrap",
    z: 12,
    why: "the Nook popover — above the phase5 chrome, below every screen",
  },
  {
    layer: "sheet",
    file: "ui.css",
    selector: ".pk-sheet-wrap--open",
    z: 20,
    why: "the items sheet",
  },
  {
    layer: "sheet",
    file: "ui.css",
    selector: ".pk-focus-wrap--open",
    z: 20,
    why: "the Pip focus view — peer of the items sheet, never both open",
    peer: true,
  },
  {
    layer: "dailies-sheet",
    file: "dailies.css",
    selector: ".pk-daily-wrap--open",
    z: 21,
    why: "the Today sheet",
  },
  {
    layer: "screen",
    file: "pipdex.css",
    selector: ".pk-pipdex-wrap--open",
    z: 22,
    why: "the Album",
  },
  {
    layer: "screen",
    file: "sanctuary.css",
    selector: ".pk-sanctuary-wrap--open",
    z: 22,
    why: "the Long Meadow list — peer of the Album, never both open",
    peer: true,
  },
  {
    layer: "confirm",
    file: "sanctuary.css",
    selector: ".pk-sanctuary-confirm-wrap--open",
    z: 26,
    why: "retire/retrieve confirm — reachable FROM the focus view AND the list",
  },
  {
    layer: "coach",
    file: "onboarding.css",
    selector: ".pk-onboard-guide",
    z: 30,
    why: "onboarding coach marks",
  },
  {
    layer: "trot",
    file: "ui.css",
    selector: ".pk-trot",
    z: 40,
    why: "the departure-trot flourish",
  },
  {
    layer: "phase4",
    file: "modals.css",
    selector: ".pk-phase4",
    z: 44,
    why: "STACKING CONTEXT — the loot reveal and the Doorstep live inside",
  },
  {
    layer: "toasts",
    file: "ui.css",
    selector: ".pk-toasts",
    z: 45,
    why: "toasts must float above every blocking surface, including the reveal",
  },
  {
    layer: "recovery",
    file: "ui.css",
    selector: ".pk-recovery",
    z: 50,
    why: "the corrupt-save modal — boot halts under it",
  },
  {
    layer: "confetti",
    file: "ui.css",
    selector: ".pk-confetti",
    z: 60,
    why: "celebration particles, over everything but onboarding",
  },
  {
    layer: "onboarding",
    file: "onboarding.css",
    selector: ".pk-onboard",
    z: 70,
    why: "the new-game ceremony — the world boots underneath it",
  },
];

describe("the UI layer ladder", () => {
  it("every rung declares exactly the z-index the ladder documents", () => {
    for (const rung of LADDER) {
      expect(
        zIndexOf(rung.file, rung.selector),
        `${rung.file} ${rung.selector} (${rung.layer}: ${rung.why})`,
      ).toBe(rung.z);
    }
  });

  it("is monotonic, and strictly increasing except at declared peers", () => {
    for (let i = 1; i < LADDER.length; i++) {
      const prev = LADDER[i - 1] as Rung;
      const rung = LADDER[i] as Rung;
      if (rung.peer === true) {
        expect(
          rung.z,
          `${rung.selector} is declared a peer of ${prev.selector}`,
        ).toBe(prev.z);
      } else {
        expect(
          rung.z,
          `${rung.selector} (${rung.layer}) must outrank ${prev.selector} (${prev.layer})`,
        ).toBeGreaterThan(prev.z);
      }
    }
  });

  /** Invariant A — the named bug's actual mechanism. */
  it("keeps .pk-phase5 a stacking context, so the keep bar stays clamped", () => {
    const phase5 = zIndexOf("ui.css", ".pk-phase5");
    expect(
      phase5,
      ".pk-phase5 must declare a z-index — it is what clamps .pk-keepbar",
    ).not.toBeNull();

    // The keep bar's 9 and the phase5 sheets' 8 are relative to that
    // context, so BOTH are painted at the phase5 root's rung. The bar
    // therefore cannot cover the Nook popover, any sheet, or any screen.
    const keepbar = zIndexOf("ui.css", ".pk-keepbar");
    expect(keepbar).not.toBeNull();
    expect(keepbar as number).toBeGreaterThan(0);

    const overlayRungs = LADDER.filter((r) =>
      ["nav-popover", "sheet", "dailies-sheet", "screen", "confirm"].includes(r.layer),
    );
    expect(overlayRungs.length).toBeGreaterThan(0);
    for (const rung of overlayRungs) {
      expect(
        rung.z,
        `${rung.selector} must outrank the .pk-phase5 root (${phase5 as number}) to cover the keep bar`,
      ).toBeGreaterThan(phase5 as number);
    }
  });

  /** Invariant B — no accidental ties among simultaneously-openable things. */
  it("has no undeclared ties (a tie is resolved by DOM order, i.e. by accident)", () => {
    const seen = new Map<number, string>();
    for (const rung of LADDER) {
      const existing = seen.get(rung.z);
      if (existing !== undefined && rung.peer !== true) {
        throw new Error(
          `${rung.selector} silently ties with ${existing} at z ${rung.z} — ` +
            "declare it a peer (and make it mutually exclusive) or give it its own rung",
        );
      }
      if (existing === undefined) seen.set(rung.z, rung.selector);
    }
  });

  /**
   * The Doorstep is mounted INSIDE `.pk-phase4` (see phase4.ts), so its
   * z-index competes only with its siblings there: the loot reveal
   * (undeclared → auto) and the legacy away sheet (2). It must win, because
   * bible §10.2 puts the Doorstep first and the reveal after "Come in".
   * And because the whole context is 44, toasts (45) still float over it.
   */
  it("puts the Doorstep above its .pk-phase4 siblings, and toasts above all of it", () => {
    const doorstep = zIndexOf("dailies.css", ".pk-doorstep");
    const away = zIndexOf("modals.css", ".pk-away");
    expect(doorstep).not.toBeNull();
    expect(away).not.toBeNull();
    expect(doorstep as number).toBeGreaterThan(away as number);
    // The reveal deliberately declares none — it is the floor of that context.
    expect(zIndexOf("modals.css", ".pk-reveal")).toBeNull();

    const phase4 = LADDER.find((r) => r.layer === "phase4") as Rung;
    const toasts = LADDER.find((r) => r.layer === "toasts") as Rung;
    expect(toasts.z).toBeGreaterThan(phase4.z);
  });

  /**
   * The dev debug menu (its CSS is injected from debugMenu.ts, not a .css
   * file) floats at 60 so the time slider stays reachable over any surface
   * — including the Doorstep it is used to trigger. Asserted so a future
   * ladder change doesn't quietly bury the QA tool.
   */
  it("keeps the dev debug menu above every player-facing surface", () => {
    const confetti = LADDER.find((r) => r.layer === "confetti") as Rung;
    expect(confetti.z).toBeGreaterThanOrEqual(
      (LADDER.find((r) => r.layer === "recovery") as Rung).z,
    );
    // debugMenu.ts hard-codes `.pk-debug-root { ... z-index: 60 }`.
    const onboard = LADDER.find((r) => r.layer === "onboarding") as Rung;
    expect(60).toBeGreaterThan((LADDER.find((r) => r.layer === "phase4") as Rung).z);
    expect(onboard.z).toBeGreaterThan(60);
  });
});

/**
 * FITTING IN 375px. Lives beside the ladder because it is the same class of
 * bug: a cross-file CSS invariant that no unit test can see and only a real
 * browser reveals.
 *
 * The concrete bug this caught (round 2C browser smoke, measured at 375x812):
 * `.pk-pipdex` declared `width: min(460px, 94vw)` with `padding: 18px 16px`
 * and a 1.5px border. This project has NO global `box-sizing: border-box`
 * reset, so the default `content-box` ADDED that 35px to the width — the
 * Album card laid out 386px wide inside a 375px viewport and the whole
 * document scrolled sideways behind the backdrop.
 *
 * Every panel that sizes itself in `vw` therefore has to opt into
 * border-box explicitly, and that is what this asserts.
 */
describe("overlay panels fit the narrowest supported viewport", () => {
  const VW_SIZED_PANELS: readonly { readonly file: string; readonly selector: string }[] = [
    { file: "pipdex.css", selector: ".pk-pipdex" },
    { file: "sanctuary.css", selector: ".pk-sanctuary" },
    { file: "sanctuary.css", selector: ".pk-sanctuary-confirm" },
    { file: "dailies.css", selector: ".pk-doorstep-card" },
  ];

  it("declares border-box on any panel whose width is a vw expression", () => {
    for (const panel of VW_SIZED_PANELS) {
      const width = declOf(panel.file, panel.selector, "width");
      if (width === null || !width.includes("vw")) continue;
      expect(
        declOf(panel.file, panel.selector, "box-sizing"),
        `${panel.selector} sizes itself with ${width} but does not declare box-sizing; ` +
          "without a global reset its padding and border are ADDED to that width " +
          "and the page scrolls horizontally at 375px",
      ).toBe("border-box");
    }
  });

  it("never lets a vw-sized panel exceed the viewport even so", () => {
    // `max-width: 100%` is the second line of defence: it survives someone
    // later raising the padding or swapping the width unit.
    const width = declOf("pipdex.css", ".pk-pipdex", "width");
    expect(width).toContain("vw");
    expect(declOf("pipdex.css", ".pk-pipdex", "max-width")).toBe("100%");
  });
});
