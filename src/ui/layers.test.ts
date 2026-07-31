/**
 * THE LAYER LADDER — the round-2C integrate stage's regression guard for
 * this project's one recurring UI bug.
 *
 * The bug, on the record: the OLD `.pk-keepbar` (the Keep chip + Build
 * button, deleted in round 2G — see ui.css) lived inside `.pk-phase5`,
 * which declares `z-index: 6` and therefore opens its OWN stacking
 * context. Every z-index inside it is relative to that 6, so the keep bar
 * could not be pushed under a sheet by raising the sheet's z-index — it
 * had to be HIDDEN instead (`onOpenChange` in buildSheet.ts / phase5.ts).
 * Round 2C then added five more overlays, three of them reachable from
 * each other, and the shipped values had them TIED at 20 with the focus
 * view — a tie that CSS resolves by DOM order, i.e. by main.ts's mount
 * sequence, i.e. by accident.
 *
 * ROUND 2G moved the Keep XP bar + Build button OUT of `.pk-phase5`
 * entirely, into a root-level float (`.pk-keepstrip`, z 5 — same rung as
 * the sound toggle / Nook button) — the stacking-context trick this file
 * guards no longer applies to them at all, because they no longer live
 * inside the context that trick was needed for. What remains inside
 * `.pk-phase5` (the placement pill at z 7, the Build sheet / upgrade card
 * wraps at z 8) still needs the clamp, so invariant A below now checks
 * `.pk-placebar` instead of the deleted `.pk-keepbar`.
 *
 * So the ladder is written down here, once, and asserted against the actual
 * stylesheets. This test is deliberately not clever: it reads the CSS as
 * text and checks the numbers, because the failure mode it guards is
 * someone changing a number in one file without looking at the others.
 *
 * Two invariants matter more than the individual numbers:
 *
 *   A. `.pk-phase5` MUST keep declaring a z-index. That is what makes it a
 *      stacking context, which is what clamps its remaining internal chrome
 *      (the placement pill at 7, the Phase 5 sheets at 8) beneath every
 *      full-screen surface. If someone "cleans up" that declaration, that
 *      chrome escapes to the root stacking context — still under the
 *      sheets at 20, but now ABOVE the Nook popover at 12, and the bug is
 *      back in a new costume.
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
    layer: "float",
    file: "progression.css",
    selector: ".pk-keepstrip",
    z: 5,
    why:
      "ROUND 2G: the Keep strip (XP bar + Build button) — round 2G moved " +
      "this rung here from `.pk-xpbar` (now a plain flex child of the " +
      "strip, needing no z-index of its own) when it fixed the bar's " +
      "final home in the layout. Like every other float it sits UNDER " +
      "any real overlay rather than floating on top of one",
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
    layer: "dailies-sheet",
    file: "notificationSettings.css",
    selector: ".pk-notify-wrap--open",
    z: 21,
    why:
      "ROUND 2I: the \"Tap on the shoulder\" settings sheet — a peer of the " +
      "Today sheet, both Nook destinations `main.ts`'s `onPick` never opens together",
    peer: true,
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
    layer: "screen",
    file: "crafting.css",
    selector: ".pk-craft-wrap--open",
    z: 22,
    why:
      "ROUND 2J: the Craft Table's recipe book — peer of the Album/Long " +
      "Meadow, reached the same way (the Nook menu) and made mutually " +
      "exclusive with them by the same app/main.ts onPick routine",
    peer: true,
  },
  {
    layer: "growth-sheet",
    file: "lifecycle.css",
    selector: ".pk-growth-wrap--open",
    z: 23,
    why: "ROUND 2H: a Pip's own Growth sheet (docs/lifecycle-bible.md §1)",
  },
  {
    layer: "ailment-card",
    file: "lifecycle.css",
    selector: ".pk-ailment-wrap--open",
    z: 24,
    why: "ROUND 2H: the ailment card — which Pip, what she has, what to do (bible §3–§4)",
  },
  {
    layer: "lineage-board",
    file: "lifecycle.css",
    selector: ".pk-lineage-wrap--open",
    z: 25,
    why: "ROUND 2H: \"Someone to find\" — every unfound lineage egg (bible §5.3)",
  },
  {
    layer: "confirm",
    file: "sanctuary.css",
    selector: ".pk-sanctuary-confirm-wrap--open",
    z: 26,
    why: "retire/retrieve confirm — reachable FROM the focus view AND the list",
  },
  {
    layer: "confirm",
    file: "lifecycle.css",
    selector: ".pk-breed-wrap--open",
    z: 26,
    why:
      "ROUND 2H (bible §9.5's own pin): the clutch sheet — a peer of the " +
      "Long Meadow's retire confirm, reachable from the focus view and the roster alike",
    peer: true,
  },
  {
    layer: "risk-confirm",
    file: "lifecycle.css",
    selector: ".pk-ailment-risk-wrap--open",
    z: 27,
    why:
      "ROUND 2H: \"before a Pip leaves for a biome that can make her ill\" (bible §7.1) — " +
      "reachable from an expedition picker this module does not own, so it must clear everything above",
  },
  {
    layer: "retirement-ready",
    file: "lifecycle.css",
    selector: ".pk-retireready-wrap--open",
    z: 28,
    why: "ROUND 2H: old age's own moment (bible §2.5/§4) — never a lesser death, never queued behind chores",
  },
  {
    layer: "rename-dialog",
    file: "ui.css",
    selector: ".pk-rename-wrap--open",
    z: 29,
    why:
      "ROUND 2D: the rename dialog — reachable ONLY from an already-open " +
      "focus view (20), so it only needs to clear that one surface",
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
    layer: "levelup",
    file: "progression.css",
    selector: ".pk-levelup",
    z: 46,
    why:
      "ROUND 2F: the Keep tier-up banner — a bigger deal than an ordinary " +
      "toast, so it floats above the toast stack (45); never a modal (no " +
      "backdrop) and structurally never open at the same time as the " +
      "Doorstep/reveal (levelUp.ts's own queue defers it defensively too)",
  },
  {
    layer: "milestone-ribbon",
    file: "progression.css",
    selector: ".pk-ribbon",
    z: 47,
    why:
      "ROUND 2F: the milestone ribbon — replaces the old text toast for " +
      "milestone completions (bible §6.2); floats above ordinary toasts " +
      "for the same reason the tier banner does, and queues behind the " +
      "Doorstep/reveal queue itself (milestoneCelebration.ts)",
  },
  {
    layer: "loss",
    file: "lifecycle.css",
    selector: ".pk-loss",
    z: 48,
    why:
      "ROUND 2H (bible §9.5's own pin): the loss moment — above the milestone " +
      "ribbon, below the recovery modal, because nothing except a corrupt save may ever cover it",
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
    layer: "notify-ask",
    file: "notificationAsk.css",
    selector: ".pk-ask-wrap--open",
    z: 65,
    why:
      "ROUND 2I: the earned-ask card (bible §3) and its iOS Home-Screen " +
      "substitute (§3.5) — a one-time, earned interstitial that outranks every " +
      "ordinary screen/sheet, but stays below onboarding (70), which can never " +
      "be active when this fires (bible §3.2 defers to the next qualifying send)",
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

  /**
   * Invariant A — the named bug's actual mechanism, now checked against
   * `.pk-placebar` (round 2G moved the Keep chip + Build button OUT of
   * `.pk-phase5` entirely — see this file's module doc — so the deleted
   * `.pk-keepbar` is no longer the right selector to prove the clamp with;
   * the placement pill is the internal chrome that still needs it).
   */
  it("keeps .pk-phase5 a stacking context, so its internal chrome stays clamped", () => {
    const phase5 = zIndexOf("ui.css", ".pk-phase5");
    expect(
      phase5,
      ".pk-phase5 must declare a z-index — it is what clamps its internal chrome",
    ).not.toBeNull();

    // The placement pill's 7 and the phase5 sheets' 8 are relative to that
    // context, so BOTH are painted at the phase5 root's rung. Neither can
    // cover the Nook popover, any sheet, or any screen.
    const placebar = zIndexOf("ui.css", ".pk-placebar");
    expect(placebar).not.toBeNull();
    expect(placebar as number).toBeGreaterThan(0);

    const overlayRungs = LADDER.filter((r) =>
      ["nav-popover", "sheet", "dailies-sheet", "screen", "confirm"].includes(r.layer),
    );
    expect(overlayRungs.length).toBeGreaterThan(0);
    for (const rung of overlayRungs) {
      expect(
        rung.z,
        `${rung.selector} must outrank the .pk-phase5 root (${phase5 as number}) to cover its internal chrome`,
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
   * ROUND 2G INTEGRATE — THE TWO HUD STRIPS, and the surfaces that must
   * clear them.
   *
   * The redesign replaced one growing top bar with two fixed strips: the
   * cast strip (`.pk-hud-top`, top-anchored, no z-index — it is the FLOOR,
   * so every real surface covers it) and the Keep strip (`.pk-keepstrip`,
   * bottom-anchored at the float rung 5). Both are registered here because
   * "which strip is the floor" is a cross-file invariant exactly like the
   * ladder itself, and because the Keep strip introduced a NEW band of
   * chrome that other stylesheets did not know about — see the sibling
   * describe block below for the regression that caused.
   */
  it("keeps the cast strip the floor: it declares no z-index of its own", () => {
    expect(
      zIndexOf("ui.css", ".pk-hud-top"),
      ".pk-hud-top must NOT declare a z-index — it is the bottom of the " +
        "stack, so `.pk-phase5` (6) and every sheet/screen above it cover " +
        "it for free. Giving it one would let it punch through overlays.",
    ).toBeNull();

    // The Keep strip sits at the float rung, i.e. UNDER `.pk-phase5` (6).
    // That is what makes round 2G's escape from the documented stacking
    // trap real: the Build sheet and upgrade card live INSIDE phase5 and
    // now cover this strip by ordinary z-index, instead of needing it
    // hidden. (`--hide` is still wired, belt-and-braces, for placement mode.)
    const keepstrip = zIndexOf("progression.css", ".pk-keepstrip") as number;
    const phase5 = zIndexOf("ui.css", ".pk-phase5") as number;
    expect(keepstrip).toBeLessThan(phase5);
  });

  /**
   * `.pk-phase5`'s internal surfaces, all clamped by its z 6 context. The
   * Build sheet is the one that is easy to miss: it reuses the items
   * sheet's `.pk-sheet-wrap` class but is mounted inside `.pk-phase5`,
   * where a later, equal-specificity rule re-scopes it from 20 to 8.
   */
  it("clamps every .pk-phase5 internal surface beneath the context root", () => {
    const phase5 = zIndexOf("ui.css", ".pk-phase5") as number;
    const internal: readonly (readonly [string, string, number])[] = [
      ["ui.css", ".pk-placebar", 7],
      // The Build sheet + the plan/upgrade wraps share this declaration.
      ["ui.css", ".pk-phase5 .pk-sheet-wrap", 8],
      ["keepUpgrade.css", ".pk-phase5 .pk-upcard-wrap.pk-upcard-wrap--open", 10],
    ];
    for (const [file, selector, z] of internal) {
      expect(zIndexOf(file, selector), `${file} ${selector}`).toBe(z);
    }
    // Every one of them is painted at the phase5 root's rung, so the Nook
    // popover (12) and everything above still covers them.
    const nav = LADDER.find((r) => r.layer === "nav-popover") as Rung;
    expect(nav.z).toBeGreaterThan(phase5);
  });

  /** The ribbon's flying `+N XP` chip must ride at its parent's rung. */
  it("keeps the ribbon fly-chip on the ribbon's own rung", () => {
    const ribbon = LADDER.find((r) => r.layer === "milestone-ribbon") as Rung;
    expect(zIndexOf("progression.css", ".pk-ribbon-flychip")).toBe(ribbon.z);
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
/**
 * CLEARING THE HUD STRIPS. The round-2G counterpart to the ladder: the
 * ladder governs what paints OVER what, this governs what OVERLAPS what.
 *
 * The bug this guards, measured at 375x812 during the round-2G integrate
 * pass: round 2G moved the Keep XP bar + Build button into a new
 * bottom-anchored strip occupying 84px→157px above the viewport bottom.
 * Three surfaces in two *other* files were still anchored with pixel
 * literals tuned when the 84px action bar was the only bottom chrome:
 *
 *   - `.pk-onboard-cue`  (108px) covered 62.7% of the XP bar
 *   - `.pk-onboard-skip` (108px) covered 64% of the Build button and WON
 *                                its hit-test
 *   - `.pk-debug-root`   (132px) covered 30% of the Build button
 *
 * Nobody owned the interaction: each builder stayed inside their files and
 * the strip's new band was invisible from outside them. So the fix is the
 * same one round 2G already applied at the top — publish the measurement
 * (`--pk-hud-bottom`, written by xpBar.ts's ResizeObserver, mirroring
 * topBar.ts's `--pk-hud-top`) and make every consumer key off it.
 *
 * These tests read the stylesheets as text for the same reason the ladder
 * does: the failure mode is someone typing a plausible-looking number in
 * one file without knowing what occupies that band in another.
 */
describe("surfaces clear the HUD strips by measurement, not by literal", () => {
  const tsFiles = import.meta.glob("./*.ts", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;

  it("anchors every below-the-top-bar surface to --pk-hud-top", () => {
    const consumers: readonly (readonly [string, string])[] = [
      ["ui.css", ".pk-toasts"],
      ["progression.css", ".pk-levelup"],
      ["progression.css", ".pk-ribbon"],
    ];
    for (const [file, selector] of consumers) {
      const top = declOf(file, selector, "top");
      expect(top, `${selector} must declare a top`).not.toBeNull();
      expect(
        top as string,
        `${selector} must clear the cast strip via var(--pk-hud-top) — a ` +
          "pixel literal here is the round-2F bug that printed the tier " +
          "banner straight through the top bar",
      ).toContain("--pk-hud-top");
    }
  });

  it("anchors every above-the-action-bar surface to --pk-hud-bottom", () => {
    for (const selector of [".pk-onboard-cue", ".pk-onboard-skip"]) {
      const bottom = declOf("onboarding.css", selector, "bottom");
      expect(bottom, `${selector} must declare a bottom`).not.toBeNull();
      expect(
        bottom as string,
        `${selector} must clear the Keep strip via var(--pk-hud-bottom)`,
      ).toContain("--pk-hud-bottom");
    }
    // debugMenu.ts injects its CSS from a template string, so it is read
    // here as TypeScript source rather than through the .css glob.
    const debugSrc = tsFiles["./debugMenu.ts"];
    expect(debugSrc, "debugMenu.ts not found").toBeDefined();
    const rootRule = /\.pk-debug-root\s*\{([^}]*)\}/.exec(debugSrc as string);
    expect(rootRule, ".pk-debug-root rule not found").not.toBeNull();
    expect(
      (rootRule as RegExpExecArray)[1] as string,
      ".pk-debug-root must clear the Keep strip too — it is the tool used " +
        "to TEST that strip, and at bottom:132px it covered the Build button",
    ).toContain("--pk-hud-bottom");
  });

  /**
   * ROUND 2G REVIEW — THE ACTION BAR IS NOT A FIXED HEIGHT, AND THE KEEP
   * STRIP MUST NOT ASSUME IT IS.
   *
   * `.pk-keepstrip` shipped at `bottom: calc(env(safe-area-inset-bottom) +
   * 84px)` under a comment asserting "the action bar is a fixed 84px tall by
   * design". It is not: `.pk-actionbar-reason` is `grid-column: 1 / -1` and
   * grows the bar to 124px whenever the active Pip cannot take care — the
   * ordinary day-2 state. Measured at 375×812 with the Pip on a trip, the
   * bar's top moved 729→688 while the strip stayed at 655, so the reason
   * pill and `.pk-xpbar-next` painted on the same 351×14 band. And because
   * the strip carries `z-index: 5` and the action bar carries none,
   * `elementFromPoint` at the pill's centre returned `.pk-xpbar-next`: the
   * documented one-tap escape from a fully greyed-out care bar was not
   * hit-testable.
   *
   * `--pk-actionbar-h` (actionBar.ts's ResizeObserver) is the fix; this
   * pins it, because the next author to "simplify" it back to a literal
   * will reintroduce exactly this bug.
   */
  it("anchors the Keep strip to the action bar's MEASURED height, never a literal", () => {
    const css = cssFiles["./progression.css"];
    expect(css, "progression.css not found").toBeDefined();
    const rule = /\.pk-keepstrip\s*\{([^}]*)\}/.exec(
      (css as string).replace(/\/\*[\s\S]*?\*\//g, ""),
    );
    expect(rule, ".pk-keepstrip rule not found").not.toBeNull();
    const bottom = /(?:^|[;\s])bottom:\s*([^;]+)/.exec(
      (rule as RegExpExecArray)[1] as string,
    );
    expect(bottom, ".pk-keepstrip must declare a bottom").not.toBeNull();
    expect(
      ((bottom as RegExpExecArray)[1] ?? "").trim(),
      "the action bar grows to 124px when the reason pill shows — a literal " +
        "here puts the strip on top of it, and the strip wins the hit-test",
    ).toContain("--pk-actionbar-h");
  });

  /**
   * The catch-all, and the one that will actually fire on the next author:
   * no bottom-anchored surface may use a pixel literal that lands inside
   * the Keep strip's band. `.pk-keepstrip` is exempt only because the test
   * above pins its anchor more strictly than this one could.
   */
  it("lets no bottom-anchored surface park a literal inside the Keep strip", () => {
    const BAND_TOP = 157; // strip top edge, measured at 375x812
    const BAND_FLOOR = 84; // action-bar height the strip sits on
    const EXEMPT = new Set([".pk-keepstrip", ".pk-actionbar"]);
    const offenders: string[] = [];

    for (const [path, raw] of Object.entries(cssFiles)) {
      const text = raw.replace(/\/\*[\s\S]*?\*\//g, "");
      const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
      let match: RegExpExecArray | null;
      while ((match = ruleRe.exec(text)) !== null) {
        const selectors = (match[1] ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (selectors.some((s) => EXEMPT.has(s))) continue;
        const body = match[2] ?? "";
        const decl = /(?:^|[;\s])bottom:\s*([^;]+)/.exec(body);
        if (decl === null) continue;
        const value = (decl[1] ?? "").trim();
        if (value.includes("--pk-hud-bottom")) continue;
        for (const px of value.matchAll(/(\d+(?:\.\d+)?)px/g)) {
          const n = Number(px[1]);
          if (n > BAND_FLOOR && n < BAND_TOP) {
            offenders.push(
              `${path.replace("./", "")} ${selectors.join(", ")} → bottom: ${value}`,
            );
          }
        }
      }
    }

    expect(
      offenders,
      "these surfaces sit INSIDE the Keep strip's band " +
        `(${BAND_FLOOR}px–${BAND_TOP}px above the viewport bottom) and will ` +
        "overlap the XP bar or the Build button at 375px. Anchor them to " +
        "calc(var(--pk-hud-bottom) + N) instead:\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });
});

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
