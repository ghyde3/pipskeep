/**
 * THE KEEP XP BAR — pure model tests (docs/progression-bible.md §0.2/§1).
 *
 * ROUND 2F: `minAdvancePx` (the 2px tick floor) was thoroughly tested while its
 * CALL SITE was not — replacing `minAdvancePx(lastPaintedPx, rawPx, maxPx)` with
 * a bare `rawPx` left the suite green, which is exactly the bug the floor exists
 * to prevent: at the Renown span a 4-XP care action is a fraction of a pixel, so
 * the fill paints no change and the late-game bar reads as frozen. The whole
 * paint decision is now one pure function (`computeFillPaint`) and it is the
 * tested unit, so the shell has nothing left to get wrong.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tuning as contentTuning } from "../content/tuning";
import { keepLevels } from "../content/keep";
import {
  buildXpBarModel,
  computeFillPaint,
  createXpBar,
  formatXpCount,
  minAdvancePx,
  xpBarAriaLabel,
  xpBarNextLabel,
  xpGainSinceLast,
} from "./xpBar";
import type { GameState } from "../core/state";
import { installFakeDom } from "./fakeDom";
import type { FakeDomHandle, FakeElement } from "./fakeDom";
import { RENOWN_TOP_FLAIR_LEVEL, renownFlairForLevel } from "../content/flair";

const levelXp = contentTuning.progression.levelXp;

describe("formatXpCount", () => {
  it("groups thousands and floors negatives/decimals defensively", () => {
    expect(formatXpCount(0)).toBe("0");
    expect(formatXpCount(1240)).toBe("1,240");
    expect(formatXpCount(9830)).toBe("9,830");
    expect(formatXpCount(-5)).toBe("0");
    expect(formatXpCount(4.6)).toBe("5");
  });
});

describe("xpGainSinceLast", () => {
  it("is the plain positive delta, clamped at 0 (bible §0.3: forward-only)", () => {
    expect(xpGainSinceLast(100, 104)).toBe(4);
    expect(xpGainSinceLast(100, 100)).toBe(0);
    // Defensive: a state observed out of order must never paint a negative
    // chip, even though keepXp itself never legitimately decreases.
    expect(xpGainSinceLast(100, 90)).toBe(0);
  });
});

describe("minAdvancePx — the tick floor (bible §0.2)", () => {
  it("bumps a sub-pixel advance up to the minimum, clamped to the track width", () => {
    // A raw target 0.3px ahead of what's painted still visibly nudges by 2px.
    expect(minAdvancePx(10, 10.3, 200)).toBe(12);
  });

  it("passes through an advance that already clears the floor", () => {
    expect(minAdvancePx(10, 20, 200)).toBe(20);
  });

  it("never overshoots the track's own width", () => {
    expect(minAdvancePx(199, 199.1, 200)).toBe(200);
  });

  it("is a no-op (never advances) when the raw target does not increase", () => {
    expect(minAdvancePx(50, 50, 200)).toBe(50);
    expect(minAdvancePx(50, 40, 200)).toBe(40);
  });
});

describe("buildXpBarModel — the per-tier bar, asserted at EVERY tier", () => {
  it("computes into/span/pct straight from core/progression/xp's tierBarProgress, for every tier 1..11", () => {
    for (let level = 1; level < levelXp.length; level++) {
      const lo = levelXp[level - 1] ?? 0;
      const hi = levelXp[level] as number;
      const span = hi - lo;
      // Halfway into the tier.
      const keepXp = lo + Math.floor(span / 2);
      const model = buildXpBarModel({ keepXp, keep: { level, placements: {} } });
      expect(model.level).toBe(level);
      expect(model.atTopTier).toBe(false);
      expect(model.span).toBe(span);
      expect(model.into).toBe(keepXp - lo);
      expect(model.pct).toBeCloseTo((keepXp - lo) / span, 6);
      expect(model.ready).toBe(false);
      expect(model.numerals).toBe(`${formatXpCount(keepXp - lo)} / ${formatXpCount(span)}`);
    }
  });

  it("flips to Ready exactly at the next tier's XP gate, and the chip says so", () => {
    const level = 1;
    const gate = levelXp[level] as number;
    const short = buildXpBarModel({ keepXp: gate - 1, keep: { level, placements: {} } });
    expect(short.ready).toBe(false);
    expect(short.levelLabel).toBe("Lv 1");

    const exact = buildXpBarModel({ keepXp: gate, keep: { level, placements: {} } });
    expect(exact.ready).toBe(true);
    expect(exact.levelLabel).toBe("Lv 1 ▸ Ready");
    expect(exact.pct).toBeGreaterThanOrEqual(1);
  });

  it("names the NEXT tier's headline unlock straight from content/keep.ts, never invented copy", () => {
    const model = buildXpBarModel({ keepXp: 0, keep: { level: 1, placements: {} } });
    const nextDef = keepLevels.find((d) => d.level === 2);
    expect(model.nextTierName).toBe(nextDef?.headline);
    expect(model.nextTierName).not.toBeNull();
  });

  /**
   * THE BAR'S ONLY JOB IS TO NAME THE CARROT. It read `unlocks[0]`, and
   * `unlocks[0]` for tier 7 is "+2 rows of ground" and for tier 9 "+2 columns
   * of ground" — so at levels 6 and 8 the bar advertised the next tier as a
   * NUMBER. Reading the dedicated `headline` field fixes it; asserting EVERY
   * tier (not the endpoints) is what stops it regressing when someone reorders
   * an `unlocks` array.
   */
  it("names a THING at every tier — never a bare '+N rows/columns' number", () => {
    for (let level = 1; level < levelXp.length; level++) {
      const model = buildXpBarModel({ keepXp: 0, keep: { level, placements: {} } });
      const name = model.nextTierName;
      expect(name, `tier ${level + 1} has no headline`).not.toBeNull();
      expect(
        (name as string).trimStart().startsWith("+"),
        `the bar advertises tier ${level + 1} as "${name}" — a number, not a thing`,
      ).toBe(false);
      expect((name as string).length).toBeGreaterThan(3);
    }
  });

  it("says BANKED rather than printing past 100% while a Ready tier waits to be paid for", () => {
    // `into` keeps growing while the player has not yet spent resources on a
    // Ready tier, so the raw form printed "460 / 300" — which reads as a bug,
    // not as progress in hand. Five of the eleven tiers are resource-gated, so
    // this is the NORMAL state for the whole gated stretch.
    const gate = levelXp[1] as number;
    const over = buildXpBarModel({
      keepXp: gate + 160,
      keep: { level: 1, placements: {} },
    });
    expect(over.ready).toBe(true);
    expect(over.numerals).toBe(`${formatXpCount(gate)} / ${formatXpCount(gate)} · banked`);
    expect(over.numerals).not.toContain(`${gate + 160}`);
    expect(over.pct).toBe(1);
  });

  it("the tier-12 (top tier) row: nextTierName is null, atTopTier flips to Renown math", () => {
    const topReq = levelXp[levelXp.length - 1] as number;
    const model = buildXpBarModel({ keepXp: topReq, keep: { level: 12, placements: {} } });
    expect(model.atTopTier).toBe(true);
    expect(model.nextTierName).toBeNull();
    expect(model.ready).toBe(false); // there is no next tier to be ready for
    expect(model.renownLevel).toBe(0);
    expect(model.levelLabel).toBe("Lv 12");
  });
});

describe("buildXpBarModel — Renown, past tier 12 (bible §1.7)", () => {
  const topReq = levelXp[levelXp.length - 1] as number;
  const perLevel = contentTuning.progression.renown.xpPerLevel;

  it("the bar keeps filling forever — never full and dead", () => {
    const model = buildXpBarModel({
      keepXp: topReq + Math.floor(perLevel / 2),
      keep: { level: 12, placements: {} },
    });
    expect(model.atTopTier).toBe(true);
    expect(model.renownLevel).toBe(0);
    expect(model.span).toBe(perLevel);
    expect(model.pct).toBeCloseTo(0.5, 6);
  });

  it("increments Renown level exactly at each xpPerLevel boundary and labels it", () => {
    const atThreeLevels = buildXpBarModel({
      keepXp: topReq + perLevel * 3 + 10,
      keep: { level: 12, placements: {} },
    });
    expect(atThreeLevels.renownLevel).toBe(3);
    expect(atThreeLevels.into).toBe(10);
    expect(atThreeLevels.levelLabel).toBe("Lv 12 · Renown 3");
  });

  it("is never ready and never names a next tier — Renown is flair only", () => {
    const model = buildXpBarModel({
      keepXp: topReq + perLevel * 10,
      keep: { level: 12, placements: {} },
    });
    expect(model.ready).toBe(false);
    expect(model.nextTierName).toBeNull();
  });
});


/**
 * THE PAINT DECISION (mutation 9b's target). The module doc calls the tick
 * floor "a rendering promise, not just a tuning one"; a promise whose only
 * enforcement is an untested call site is not enforced.
 */
describe("computeFillPaint — the tick floor as it is actually applied", () => {
  it("advances by at least 2px even when the real advance is sub-pixel", () => {
    // The late-game case: a 4-XP grant against a 2,000-XP Renown span on a
    // 200px track is 0.4px of real fill.
    const first = computeFillPaint(0.5, 200, 100);
    expect(first.paintedPx).toBe(100);
    const nudged = computeFillPaint(0.502, 200, first.paintedPx);
    expect(nudged.paintedPx).toBeGreaterThanOrEqual(102);
    expect(nudged.width).toBe(`${nudged.paintedPx}px`);
  });

  it("a real Renown-span grant still visibly moves the bar", () => {
    const span = contentTuning.progression.renown.xpPerLevel;
    const care = contentTuning.progression.xp.care;
    const trackPx = 200;
    const before = computeFillPaint(0.5, trackPx, 100);
    const after = computeFillPaint(0.5 + care / span, trackPx, before.paintedPx);
    // The RAW advance is under a pixel…
    expect((care / span) * trackPx).toBeLessThan(2);
    // …and the painted advance is still at least the floor.
    expect(after.paintedPx - before.paintedPx).toBeGreaterThanOrEqual(2);
  });

  it("passes an advance that already clears the floor straight through", () => {
    expect(computeFillPaint(0.5, 200, 20).paintedPx).toBe(100);
  });

  it("never overshoots the track", () => {
    expect(computeFillPaint(1, 200, 199.5).paintedPx).toBe(200);
    expect(computeFillPaint(1.5, 200, 0).paintedPx).toBe(200);
  });

  it("clamps a negative pct rather than painting a negative width", () => {
    const paint = computeFillPaint(-0.3, 200, 50);
    expect(paint.paintedPx).toBeLessThanOrEqual(50);
    expect(paint.paintedPx).toBeGreaterThanOrEqual(0);
  });

  it("falls back to a PERCENTAGE while the element has no layout yet", () => {
    // maxPx <= 0 means detached/hidden — pixel maths is meaningless there, and
    // a percentage keeps the bar correct the moment it becomes visible.
    const paint = computeFillPaint(0.37, 0, 0);
    expect(paint.width).toBe("37%");
    expect(paint.paintedPx).toBe(0);
  });
});

describe("xpBarAriaLabel — the strip's real button label (N6/failure 6)", () => {
  it("names the level, the honest into/span, and the open-upgrades verb", () => {
    const model = buildXpBarModel({ keepXp: 500, keep: { level: 3, placements: {} } });
    const label = xpBarAriaLabel(model);
    expect(label).toContain(`Keep level ${model.level}`);
    expect(label).toContain(formatXpCount(model.into));
    expect(label).toContain(formatXpCount(model.span));
    expect(label).toContain("Open Keep upgrades.");
    expect(label).not.toContain("ready");
  });

  it("says a tier is ready, once it is", () => {
    const gate = levelXp[1] as number;
    const model = buildXpBarModel({ keepXp: gate, keep: { level: 1, placements: {} } });
    expect(model.ready).toBe(true);
    expect(xpBarAriaLabel(model)).toContain("a tier is ready");
  });
});

describe("xpBarNextLabel — the bar always names something to aim at", () => {
  it("below the top tier it names the next tier's headline", () => {
    const model = buildXpBarModel({ keepXp: 0, keep: { level: 1, placements: {} } });
    expect(xpBarNextLabel(model)).toBe(`Next: ${model.nextTierName as string}`);
  });

  /**
   * ROUND 2G (hud-redesign doc §3/§4, failure 6): the Ready affordance IS
   * the tap target now, so its OWN label carries the call to action — the
   * carrot stays named (failure 7 must not regress into a bare "Ready!"),
   * and a verb is added on top of it.
   */
  it("keeps naming the carrot AND adds the call to action once Ready", () => {
    const gate = levelXp[1] as number;
    const model = buildXpBarModel({ keepXp: gate, keep: { level: 1, placements: {} } });
    expect(model.ready).toBe(true);
    expect(xpBarNextLabel(model)).toBe(
      `Ready — ${model.nextTierName as string}. Tap to grow the Keep.`,
    );
  });

  it("at Renown it names the next FLOURISH and how far off it is", () => {
    const topReq = levelXp[levelXp.length - 1] as number;
    const model = buildXpBarModel({ keepXp: topReq, keep: { level: 12, placements: {} } });
    const label = xpBarNextLabel(model);
    expect(label).toContain("Next flourish:");
    expect(label).toContain(model.renownFlairName as string);
    expect(label).toContain("XP");
  });

  it("names the FIRST flourish before any Renown level is earned", () => {
    const topReq = levelXp[levelXp.length - 1] as number;
    const model = buildXpBarModel({ keepXp: topReq, keep: { level: 12, placements: {} } });
    expect(model.renownLevel).toBe(0);
    expect(model.renownFlairName).toBe(renownFlairForLevel(1)?.name);
  });

  it("past the last flourish it says so instead of promising one that does not exist", () => {
    const topReq = levelXp[levelXp.length - 1] as number;
    const perLevel = contentTuning.progression.renown.xpPerLevel;
    const model = buildXpBarModel({
      keepXp: topReq + perLevel * (RENOWN_TOP_FLAIR_LEVEL + 2),
      keep: { level: 12, placements: {} },
    });
    expect(model.renownFlairName).toBeNull();
    expect(xpBarNextLabel(model)).toBe("Renown — every flourish earned. Still counting.");
  });

  it("the countdown to the next flourish shrinks as XP accrues, and never goes negative", () => {
    const topReq = levelXp[levelXp.length - 1] as number;
    const early = buildXpBarModel({ keepXp: topReq + 10, keep: { level: 12, placements: {} } });
    const late = buildXpBarModel({ keepXp: topReq + 900, keep: { level: 12, placements: {} } });
    expect(late.renownNextIn).toBeLessThan(early.renownNextIn);
    expect(late.renownNextIn).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// THE DOM SHELL — the half that was untested, and the half that broke
// ---------------------------------------------------------------------------

/**
 * ROUND 2G REVIEW: two mutations survived the whole 2,230-test suite here.
 *
 *  1. The body of `bar.addEventListener("click", …)` replaced with a bare
 *     `return;`. The bar still rendered, still pulsed gold, still carried its
 *     aria-label, and swallowed every tap — while `xpBarNextLabel`'s "Tap to
 *     grow the Keep." copy, which IS pinned above, kept asserting a call to
 *     action the button no longer honoured.
 *  2. `sync`'s `computeFillPaint(…)` replaced with `fill.style.width =
 *     `${model.pct * 100}%``. That is the exact bypass `computeFillPaint` was
 *     extracted to prevent, moved one frame up: at the Renown span a 4-XP care
 *     action is a fraction of a pixel, so the late-game bar paints nothing and
 *     reads as frozen. Extracting the decision raised the bar for an
 *     accidental regression; only a test that drives `sync` closes the hole.
 *
 * Everything below drives the real `createXpBar` against `fakeDom.ts` — see
 * that file for why a hand-rolled fake rather than jsdom (spec §1's dependency
 * allowlist; vitest runs `node` here).
 */
describe("createXpBar — the widget, not the model", () => {
  let dom: FakeDomHandle;

  beforeEach(() => {
    dom = installFakeDom();
  });
  afterEach(() => {
    dom.uninstall();
  });

  const stateAt = (keepXp: number, level = 1): GameState =>
    ({ keepXp, keep: { level, placements: {} } }) as GameState;

  /** The strip, with a laid-out track so pixel painting is meaningful. */
  function mountBar(deps: Parameters<typeof createXpBar>[0] = {}): {
    readonly handle: ReturnType<typeof createXpBar>;
    readonly root: FakeElement;
    readonly track: FakeElement;
  } {
    const handle = createXpBar(deps);
    const root = handle.el as unknown as FakeElement;
    dom.ui.appendChild(root);
    const track = root.querySelector(".pk-xpbar-track") as FakeElement;
    track.clientWidth = 200;
    return { handle, root, track };
  }

  it("a tap on the bar reaches onOpenUpgrades — the whole point of the Ready affordance", () => {
    let opened = 0;
    const { root, handle } = mountBar({ onOpenUpgrades: () => (opened += 1) });
    handle.sync(stateAt(0));

    const bar = root.querySelector(".pk-xpbar") as FakeElement;
    expect(bar.disabled).toBe(false);
    bar.click();
    expect(opened).toBe(1);
  });

  it("taps while READY too — the state where the bar pulses gold to demand one", () => {
    let opened = 0;
    const ready = (levelXp[1] as number) + 160; // banked past the tier gate
    const { root, handle } = mountBar({ onOpenUpgrades: () => (opened += 1) });
    handle.sync(stateAt(ready));

    const bar = root.querySelector(".pk-xpbar") as FakeElement;
    expect(bar.classList.contains("pk-xpbar--ready")).toBe(true);
    bar.click();
    expect(opened).toBe(1);
  });

  it("the Build icon reaches onOpenBuild", () => {
    let built = 0;
    const { root, handle } = mountBar({ onOpenBuild: () => (built += 1) });
    handle.sync(stateAt(0));

    const build = root.querySelector(".pk-build-btn") as FakeElement;
    expect(build.disabled).toBe(false);
    build.click();
    expect(built).toBe(1);
  });

  it("omitting a callback yields a DISABLED control — inert, but never lying", () => {
    const { root, handle } = mountBar({});
    handle.sync(stateAt(0));

    const bar = root.querySelector(".pk-xpbar") as FakeElement;
    const build = root.querySelector(".pk-build-btn") as FakeElement;
    expect(bar.disabled).toBe(true);
    expect(build.disabled).toBe(true);
    // And no handler was attached at all, so there is nothing to swallow.
    expect(bar.listenerCount("click")).toBe(0);
    expect(build.listenerCount("click")).toBe(0);
  });

  it("the 'Tap to grow the Keep.' line is INSIDE the button it instructs you to tap", () => {
    let opened = 0;
    const ready = (levelXp[1] as number) + 160;
    const { root, handle } = mountBar({ onOpenUpgrades: () => (opened += 1) });
    handle.sync(stateAt(ready));

    const bar = root.querySelector(".pk-xpbar") as FakeElement;
    const next = root.querySelector(".pk-xpbar-next") as FakeElement;
    expect(next.textContent).toContain("Tap to grow the Keep.");
    // Round 2G shipped this line as a SIBLING of the button: the one string
    // in the game that literally instructs a tap was the one part of the
    // widget that did not accept one.
    expect(next.closest(".pk-xpbar")).toBe(bar);
    expect(opened).toBe(0);
  });

  it("names the Keep in VISIBLE text, not only in the aria-label", () => {
    const { root, handle } = mountBar({});
    handle.sync(stateAt(30));

    const chip = root.querySelector(".pk-xpbar-chip") as FakeElement;
    // "Lv 1" under a single Pip reads as the PET's level to a new player.
    expect(chip.textContent).toContain("Keep");
    expect(chip.textContent).toContain("Lv 1");
  });

  it("paints the fill in PIXELS through computeFillPaint, not a raw percentage", () => {
    const { root, handle, track } = mountBar({});
    handle.sync(stateAt(30));

    const fill = root.querySelector(".pk-xpbar-fill") as FakeElement;
    expect(fill.style.getPropertyValue("width")).toMatch(/px$/);
    expect(Number.parseFloat(fill.style.getPropertyValue("width"))).toBeCloseTo(200 * (30 / (levelXp[1] as number)), 4);
    expect(track.clientWidth).toBe(200);
  });

  it("a sub-pixel grant still advances the fill by the 2px floor — the bar always acknowledges you", () => {
    const { root, handle } = mountBar({});
    handle.sync(stateAt(30));
    const fill = root.querySelector(".pk-xpbar-fill") as FakeElement;
    const before = Number.parseFloat(fill.style.getPropertyValue("width"));

    // +1 XP over a 100-XP span on a 200px track is 2px exactly; the
    // interesting case is smaller still, so use a fraction of that.
    handle.sync(stateAt(30.05));
    const after = Number.parseFloat(fill.style.getPropertyValue("width"));
    expect(after - before).toBeGreaterThanOrEqual(2);
  });

  it("spawns a +N chip on a gain, and none on the first sync (nothing to compare to)", () => {
    const { root, handle } = mountBar({});
    handle.sync(stateAt(30));
    expect(root.querySelectorAll(".pk-xpbar-gain")).toHaveLength(0);

    handle.sync(stateAt(34));
    const chips = root.querySelectorAll(".pk-xpbar-gain");
    expect(chips).toHaveLength(1);
    expect(chips[0]?.textContent).toBe("+4");
  });

  it("the sr-only status announces level/ready EDGES only, never a bare XP tick (N6)", () => {
    const { root, handle } = mountBar({});
    const sr = root.querySelector(".pk-sr-only") as FakeElement;
    expect(sr.getAttribute("role")).toBe("status");

    handle.sync(stateAt(30));
    expect(sr.textContent).toBe("Keep level 1");

    // An ordinary grant must not rewrite the live region.
    sr.textContent = "SENTINEL";
    handle.sync(stateAt(34));
    expect(sr.textContent).toBe("SENTINEL");

    // Crossing into Ready is news, and does.
    handle.sync(stateAt((levelXp[1] as number) + 10));
    expect(sr.textContent).toBe("Keep level 1 — a tier is ready");
  });

  it("setHidden drives the strip's own class — the documented alternative to z-indexing it", () => {
    const { root, handle } = mountBar({});
    handle.sync(stateAt(0));
    expect(root.classList.contains("pk-keepstrip")).toBe(true);

    handle.setHidden(true);
    expect(root.classList.contains("pk-keepstrip--hide")).toBe(true);
    handle.setHidden(false);
    expect(root.classList.contains("pk-keepstrip--hide")).toBe(false);
  });
});
