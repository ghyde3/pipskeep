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

import { describe, expect, it } from "vitest";
import { tuning as contentTuning } from "../content/tuning";
import { keepLevels } from "../content/keep";
import {
  buildXpBarModel,
  computeFillPaint,
  formatXpCount,
  minAdvancePx,
  xpBarNextLabel,
  xpGainSinceLast,
} from "./xpBar";
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

describe("xpBarNextLabel — the bar always names something to aim at", () => {
  it("below the top tier it names the next tier's headline", () => {
    const model = buildXpBarModel({ keepXp: 0, keep: { level: 1, placements: {} } });
    expect(xpBarNextLabel(model)).toBe(`Next: ${model.nextTierName as string}`);
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
