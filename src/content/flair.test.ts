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
import {
  FLAIR,
  RENOWN_FLAIR,
  RENOWN_TOP_FLAIR_LEVEL,
  activePageFrame,
  earnedFlairOfKind,
  flairById,
  renownFlairEarnedBetween,
  renownFlairForLevel,
} from "./flair";
import type { FlairKind } from "./flair";
import { MILESTONES } from "./milestones";
import { tuning } from "./tuning";

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
    // TWO grant paths since round 2F: a milestone reward, or a Renown level
    // (bible §1.7). Everything in the registry must be on one of them —
    // an unreachable flourish is the dead reward this file exists to prevent.
    const promisedIds = new Set(
      MILESTONES.flatMap((m) => (m.reward.kind === "flair" ? [m.reward.flairId] : [])),
    );
    for (const def of FLAIR) {
      const reachable = promisedIds.has(def.id) || def.renownLevel !== undefined;
      expect(
        reachable,
        `flair "${def.id}" is in the registry but nothing grants it — no milestone promises it and it carries no renownLevel`,
      ).toBe(true);
    }
  });

  it("a Renown flourish is granted by Renown ONLY — never double-sourced from a milestone too", () => {
    const promisedIds = new Set(
      MILESTONES.flatMap((m) => (m.reward.kind === "flair" ? [m.reward.flairId] : [])),
    );
    for (const def of RENOWN_FLAIR) {
      expect(
        promisedIds.has(def.id),
        `renown flair "${def.id}" is ALSO promised by a milestone — pick one source`,
      ).toBe(false);
    }
  });

  it("flair grants nothing but decoration — no resource, item or tuning field anywhere on a def", () => {
    // Bible §0.4/§4.3: flair pays in nothing. Structural guard, so a future
    // "and also 3 wood" can't be smuggled into the registry. `renownLevel` is
    // allowed and is itself decoration-only: it names WHICH level mints the
    // flourish, it grants nothing.
    const allowed = new Set([
      "id",
      "kind",
      "name",
      "note",
      "glyph",
      "rank",
      "renownLevel",
    ]);
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

/**
 * RENOWN (docs/progression-bible.md §1.7) — the endgame, and the round's
 * fourth dead feature until now: `tuning.progression.renown` shipped with its
 * `flairEveryLevels` DELETED because this registry had no `renown-*` entries
 * to mint, so clearing a Renown level paid literally nothing. Tier 12 lands
 * around day 17 on the bible's own income model, which meant the entire named
 * ladder was exhausted from day 17 with nothing behind it.
 */
describe("Renown flair (bible §1.7)", () => {
  it("ships a flourish for EVERY Renown level from 1 up, with no gaps", () => {
    expect(RENOWN_FLAIR.length).toBeGreaterThan(0);
    const levels = RENOWN_FLAIR.map((f) => f.renownLevel);
    expect(levels).toEqual(RENOWN_FLAIR.map((_, i) => i + 1));
    expect(RENOWN_TOP_FLAIR_LEVEL).toBe(RENOWN_FLAIR.length);
  });

  it("every level mints one — `flairEveryLevels` is 1, not the 5 that made a flourish a rumour", () => {
    // At every FIFTH level (the figure the bible first floated) a flourish
    // costs 5 × xpPerLevel ≈ 20 engaged days. That is not a reward.
    expect(tuning.progression.renown.flairEveryLevels).toBe(1);
  });

  it("spreads across ALL FIVE kinds, so the endgame keeps changing a different surface", () => {
    const kinds = new Set(RENOWN_FLAIR.map((f) => f.kind));
    for (const kind of ALL_KINDS) {
      expect(kinds.has(kind), `no Renown flourish of kind "${kind}"`).toBe(true);
    }
  });

  it("renown page frames outrank every milestone frame, so reaching Renown visibly changes the Album", () => {
    const milestoneFrames = FLAIR.filter(
      (f) => f.kind === "pageFrame" && f.renownLevel === undefined,
    );
    const renownFrames = RENOWN_FLAIR.filter((f) => f.kind === "pageFrame");
    expect(renownFrames.length).toBeGreaterThan(0);
    const topMilestone = Math.max(...milestoneFrames.map((f) => f.rank ?? 0));
    for (const f of renownFrames) {
      expect(f.rank ?? 0, f.id).toBeGreaterThan(topMilestone);
    }
  });

  it("renownFlairForLevel picks exactly the level's flourish, and nothing off the ends", () => {
    expect(renownFlairForLevel(1)?.renownLevel).toBe(1);
    expect(renownFlairForLevel(RENOWN_TOP_FLAIR_LEVEL)?.renownLevel).toBe(
      RENOWN_TOP_FLAIR_LEVEL,
    );
    expect(renownFlairForLevel(0)).toBeNull();
    expect(renownFlairForLevel(-3)).toBeNull();
    expect(renownFlairForLevel(RENOWN_TOP_FLAIR_LEVEL + 1)).toBeNull();
  });

  it("renownFlairEarnedBetween pays every level a multi-level jump crossed — a long absence skips nothing", () => {
    expect(renownFlairEarnedBetween(0, 3).map((f) => f.renownLevel)).toEqual([1, 2, 3]);
    expect(renownFlairEarnedBetween(2, 3).map((f) => f.renownLevel)).toEqual([3]);
  });

  it("pays nothing when the level did not move, and never for a decrease", () => {
    expect(renownFlairEarnedBetween(4, 4)).toEqual([]);
    expect(renownFlairEarnedBetween(7, 2)).toEqual([]);
    expect(renownFlairEarnedBetween(0, 0)).toEqual([]);
  });

  it("stops paying past the last flourish instead of throwing or repeating one", () => {
    const past = renownFlairEarnedBetween(
      RENOWN_TOP_FLAIR_LEVEL,
      RENOWN_TOP_FLAIR_LEVEL + 5,
    );
    expect(past).toEqual([]);
  });

  it("a jump that spans the end of the ladder pays the remaining flourishes and no more", () => {
    const spanning = renownFlairEarnedBetween(
      RENOWN_TOP_FLAIR_LEVEL - 2,
      RENOWN_TOP_FLAIR_LEVEL + 4,
    );
    expect(spanning.map((f) => f.renownLevel)).toEqual([
      RENOWN_TOP_FLAIR_LEVEL - 1,
      RENOWN_TOP_FLAIR_LEVEL,
    ]);
  });

  it("the whole Renown ladder is a real long haul, not a fortnight of nothing", () => {
    // 12 flourishes × 2,000 XP = 24,000 XP past tier 12 — ~32 engaged days at
    // the bible §1.6 engaged rate of 750/day. That is the "what is there at
    // day 30/60" answer the bible called the LAST thing to cut.
    const totalXp = RENOWN_TOP_FLAIR_LEVEL * tuning.progression.renown.xpPerLevel;
    expect(totalXp).toBeGreaterThanOrEqual(20_000);
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
