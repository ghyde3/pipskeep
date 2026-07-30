/**
 * Procedural glyph renderer — pure-layer tests (node-style, like every
 * other UI suite in this repo: the DOM shell (`renderIcon`'s actual
 * `<span>`/`<svg>` construction) is untested chrome, same as
 * `soundToggle.ts`'s `SPEAKER_SVG` injection). What matters here is the
 * DERIVATION bible §4.2 requires to be unauthored and honest:
 *
 *   - every motif and badge id in content/icons.ts's vocabulary actually
 *     has markup (a missing entry would render an item with a blank icon);
 *   - the badge is derived from an item's FIRST effect, never anything
 *     else, and is `undefined` when there is no effect to derive from;
 *   - the tint falls back safely for an unset/unknown set id.
 */

import { describe, expect, it } from "vitest";
import { BADGE_IDS, MOTIF_IDS } from "../content/icons";
import type { IconSpec } from "../content/icons";
import { decorSets } from "../content/decorSets";
import {
  badgeForEffects,
  foodIconSpec,
  iconSvgMarkup,
  resolveItemIcon,
  tintForSetId,
} from "./icons";

describe("iconSvgMarkup — every vocabulary id renders SOMETHING", () => {
  it("has non-empty markup for every motif", () => {
    for (const motif of MOTIF_IDS) {
      const spec: IconSpec = { motif };
      const svg = iconSvgMarkup(spec);
      expect(svg, motif).toContain("<svg");
      expect(svg.length, motif).toBeGreaterThan(40);
    }
  });

  it("has non-empty, distinct markup for every badge, layered over the motif", () => {
    const seen = new Set<string>();
    for (const badge of BADGE_IDS) {
      const svg = iconSvgMarkup({ motif: "bowl", badge });
      expect(svg, badge).toContain("<svg");
      // The badge markup is additional content beyond the bare motif.
      const bare = iconSvgMarkup({ motif: "bowl" });
      expect(svg.length, badge).toBeGreaterThan(bare.length);
      expect(seen.has(svg), `${badge} duplicates a previous badge's markup`).toBe(
        false,
      );
      seen.add(svg);
    }
  });

  it("a spec with no badge renders no corner-mark background disc", () => {
    const svg = iconSvgMarkup({ motif: "nest" });
    // Every badge draws its own contrasting disc; absence of a badge
    // means absence of that disc, not a stray empty one.
    expect(svg).not.toContain("stroke=\"rgba(61,74,61,");
  });
});

describe("badgeForEffects — derived from the FIRST effect, never authored", () => {
  it("maps every effect kind to a badge", () => {
    expect(badgeForEffects([{ kind: "comfort", need: "hunger", decayReduction: 0.06 }])).toBe(
      "heart",
    );
    expect(badgeForEffects([{ kind: "restSpeed", multiplier: 1.25 }])).toBe("moon");
    expect(badgeForEffects([{ kind: "incubationSpeed", multiplier: 0.85 }])).toBe("moon");
    expect(badgeForEffects([{ kind: "expeditionSpeed", multiplier: 0.92 }])).toBe("boot");
    expect(
      badgeForEffects([{ kind: "expeditionLoot", bonusRollChance: 0.03 }]),
    ).toBe("boot");
    expect(badgeForEffects([{ kind: "eggChancePoints", points: 0.01 }])).toBe("boot");
    expect(badgeForEffects([{ kind: "job", jobId: "gathering" }])).toBe("gear");
    expect(badgeForEffects([{ kind: "xpBonus", fraction: 0.05 }])).toBe("star");
  });

  it("reads only the FIRST effect when an item carries several", () => {
    expect(
      badgeForEffects([
        { kind: "job", jobId: "simmering" },
        { kind: "comfort", need: "hunger", decayReduction: 0.04 },
      ]),
    ).toBe("gear");
  });

  it("is undefined for no effects (undefined or empty) — a plain motif, no corner mark", () => {
    expect(badgeForEffects(undefined)).toBeUndefined();
    expect(badgeForEffects([])).toBeUndefined();
  });
});

describe("tintForSetId — every real set resolves, and the fallback is safe", () => {
  it("resolves every content/decorSets.ts id to a real hex colour", () => {
    for (const set of decorSets) {
      expect(tintForSetId(set.id)).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("undefined (a station) resolves to the neutral station tint", () => {
    expect(tintForSetId(undefined)).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("an unknown set id never throws and still returns a real hex colour", () => {
    expect(tintForSetId("some-future-set-nobody-tinted-yet")).toMatch(
      /^#[0-9a-f]{6}$/i,
    );
  });
});

describe("resolveItemIcon — the one-call composition Build entries use", () => {
  it("keeps the authored motif, derives the badge, and resolves the tint together", () => {
    const resolved = resolveItemIcon(
      { motif: "basket" },
      [{ kind: "job", jobId: "gathering" }],
      undefined,
    );
    expect(resolved.spec.motif).toBe("basket");
    expect(resolved.spec.badge).toBe("gear");
    expect(resolved.tint).toBe(tintForSetId(undefined));
  });

  it("a decoration's setId picks its set's tint", () => {
    const resolved = resolveItemIcon(
      { motif: "leaf" },
      [{ kind: "comfort", need: "happiness", decayReduction: 0.01 }],
      "meadow-green",
    );
    expect(resolved.tint).toBe(tintForSetId("meadow-green"));
    expect(resolved.spec.badge).toBe("heart");
  });
});

describe("foodIconSpec — every food gets a motif, unknowns fall back safely", () => {
  it("names a real vocabulary motif for the shipped foods", () => {
    for (const id of [
      "berry",
      "stew",
      "honeydrop",
      "toastnut",
      "frostberry",
      "cocoabun",
      "glowcap",
      "tideroll",
      "emberloaf",
      "feastpot",
    ]) {
      expect(MOTIF_IDS as readonly string[], id).toContain(foodIconSpec(id).motif);
    }
  });

  it("an unknown id still returns a valid motif, never blank", () => {
    expect(MOTIF_IDS as readonly string[]).toContain(foodIconSpec("mystery-item").motif);
  });
});
