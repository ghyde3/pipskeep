/**
 * FLAIR REGISTRY tests — the guard against round 2C's worst bug coming back:
 * 22 milestone rewards of `kind: "flair"` against no registry, no state field
 * and no renderer, so every long-haul target in the game paid nothing while
 * the sheet promised "a flourish for the Album".
 *
 * The load-bearing assertion here is the cross-check with `content/milestones.ts`
 * in BOTH directions: every promised flourish exists, and every registered
 * flourish is actually promised by something.
 */

import { describe, expect, it } from "vitest";
import { FLAIR, activePageFrame, earnedFlairOfKind, flairById } from "./flair";
import type { FlairKind } from "./flair";
import { MILESTONES } from "./milestones";

const ALL_KINDS: readonly FlairKind[] = [
  "coverStamp",
  "ribbon",
  "pageFrame",
  "pipTitle",
  "sanctuarySign",
];

describe("the flair registry", () => {
  it("has unique ids and no empty copy", () => {
    const ids = FLAIR.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const def of FLAIR) {
      expect(def.name.length, def.id).toBeGreaterThan(0);
      expect(def.note.length, def.id).toBeGreaterThan(0);
      expect(def.glyph.length, def.id).toBeGreaterThan(0);
    }
  });

  it("every entry's kind is one the UI actually draws", () => {
    for (const def of FLAIR) {
      expect(ALL_KINDS, def.id).toContain(def.kind);
    }
  });

  it("EVERY milestone that promises a flourish has one in the registry", () => {
    const promised = MILESTONES.filter((m) => m.reward.kind === "flair");
    // Sanity: the bible §4.3 asks flair to carry most of the long haul, so
    // this must not silently become an empty list.
    expect(promised.length).toBeGreaterThan(10);
    for (const m of promised) {
      const flairId = m.reward.kind === "flair" ? m.reward.flairId : "";
      expect(
        flairById(flairId),
        `milestone "${m.id}" promises flair "${flairId}" that does not exist — a reward that pays nothing`,
      ).toBeDefined();
    }
  });

  it("EVERY registered flourish is reachable — nothing in here is decoration for its own sake", () => {
    const promisedIds = new Set(
      MILESTONES.flatMap((m) => (m.reward.kind === "flair" ? [m.reward.flairId] : [])),
    );
    for (const def of FLAIR) {
      expect(
        promisedIds.has(def.id),
        `flair "${def.id}" is in the registry but no milestone grants it`,
      ).toBe(true);
    }
  });

  it("flair grants nothing but decoration — no resource, item or tuning field anywhere on a def", () => {
    // Bible §0.4/§4.3: flair pays in nothing. Structural guard, so a future
    // "and also 3 wood" can't be smuggled into the registry.
    const allowed = new Set(["id", "kind", "name", "note", "glyph", "rank"]);
    for (const def of FLAIR) {
      for (const key of Object.keys(def)) {
        expect(allowed.has(key), `flair "${def.id}" has an unexpected field "${key}"`).toBe(true);
      }
    }
  });

  it("every pageFrame carries a rank, so 'which frame is showing' is never arbitrary", () => {
    for (const def of FLAIR) {
      if (def.kind !== "pageFrame") continue;
      expect(typeof def.rank, def.id).toBe("number");
    }
  });
});

describe("earnedFlairOfKind", () => {
  it("returns only earned entries of that kind, in registry order", () => {
    const earned = {
      "album-curator-stamp": 5,
      "album-week-ribbon": 6,
      "sanctuary-gate-sign": 7,
    };
    expect(earnedFlairOfKind(earned, "coverStamp").map((f) => f.id)).toEqual([
      "album-curator-stamp",
    ]);
    expect(earnedFlairOfKind(earned, "ribbon").map((f) => f.id)).toEqual(["album-week-ribbon"]);
    expect(earnedFlairOfKind(earned, "sanctuarySign").map((f) => f.id)).toEqual([
      "sanctuary-gate-sign",
    ]);
    expect(earnedFlairOfKind({}, "coverStamp")).toEqual([]);
  });
});

describe("activePageFrame", () => {
  it("is null with nothing earned", () => {
    expect(activePageFrame({})).toBeNull();
  });

  it("picks the highest-ranked earned frame", () => {
    const both = { "album-bounty-frame": 1, "album-ledger-frame": 2 };
    expect(activePageFrame(both)?.id).toBe("album-ledger-frame"); // rank 5 > rank 2
  });

  it("ignores non-frame flair entirely", () => {
    expect(activePageFrame({ "album-curator-stamp": 1 })).toBeNull();
  });
});
