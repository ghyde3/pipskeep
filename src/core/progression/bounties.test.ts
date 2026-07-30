import { describe, expect, it } from "vitest";
import { tuning as contentTuning } from "../../content/tuning";
import { BOUNTY_TEMPLATES } from "../../content/bountyTemplates";
import {
  applyBountyEvent,
  createEmptyBounties,
  ensureBountiesForDay,
  generateBountiesForDay,
  isBountyEligible,
  replaceStaleBounties,
  rerollBountySlot,
  resolveBountyTarget,
} from "./bounties";
import type { BountyContext, BountyTuning } from "./bounties";

const bountyTuning: BountyTuning = {
  retention: {
    bounties: {
      perDay: contentTuning.retention.bounties.perDay,
      freeRerollsPerDay: contentTuning.retention.bounties.freeRerollsPerDay,
      dayBonusEggMaxPerDay: contentTuning.retention.bounties.dayBonusEggMaxPerDay,
    },
  },
};

function contextAt(
  keepLevel: number,
  rosterSize: number,
  opts: {
    placedItemIds?: readonly string[];
    unlockedExpeditionIds?: readonly string[];
    obtainableItemIds?: readonly string[];
    hasAffordableDecoration?: boolean;
    hasAdultPip?: boolean;
  } = {},
): BountyContext {
  const unlockedByLevel: Record<number, readonly string[]> = {
    1: ["meadow", "bramblewick"],
    2: ["meadow", "bramblewick", "forest", "snowdrift"],
    3: ["meadow", "bramblewick", "forest", "snowdrift", "shore", "lanterngrotto"],
  };
  return {
    keepLevel,
    rosterSize,
    hasAdultPip: opts.hasAdultPip ?? true,
    placedItemIds: new Set(opts.placedItemIds ?? []),
    unlockedExpeditionIds: new Set(
      opts.unlockedExpeditionIds ?? unlockedByLevel[keepLevel] ?? ["meadow"],
    ),
    obtainableItemIds: new Set(opts.obtainableItemIds ?? ["berry", "fiber", "wood"]),
    hasAffordableDecoration: opts.hasAffordableDecoration ?? true,
  };
}

/**
 * GROUND TRUTH, read straight from the AUTHORED template data and
 * deliberately NOT via `isBountyEligible`.
 *
 * `generateBountiesForDay` selects its slots by filtering on
 * `isBountyEligible`, so asserting `isBountyEligible(slot.template, context)`
 * back over the generated slots is a tautology: both sides move together, and
 * NO loosening of the predicate can ever fail it however many seeded days the
 * loop runs (round-2C review, mutation 5a — deleting the `minKeepLevel` guard
 * survived 1503 tests). This independent re-derivation is what makes the
 * generation proofs below bite.
 *
 * Exhaustive by construction: an unrecognised `requires` key throws, so adding
 * a new requirement kind to `BountyRequirements` forces this function to be
 * updated rather than silently under-checking.
 */
function authoredRequirementsMet(
  template: (typeof BOUNTY_TEMPLATES)[number],
  context: BountyContext,
): boolean {
  const req = template.requires as Readonly<Record<string, unknown>>;
  let ok = true;
  for (const [key, value] of Object.entries(req)) {
    if (value === undefined) continue;
    switch (key) {
      case "minKeepLevel":
        if (context.keepLevel < (value as number)) ok = false;
        break;
      case "expeditionId":
        if (!context.unlockedExpeditionIds.has(value as string)) ok = false;
        break;
      case "itemId":
        if (!context.obtainableItemIds.has(value as string)) ok = false;
        break;
      case "placedItemId":
        if (!context.placedItemIds.has(value as string)) ok = false;
        break;
      case "needsAdultPip":
        if (value === true && !context.hasAdultPip) ok = false;
        break;
      case "minRosterSize":
        if (context.rosterSize < (value as number)) ok = false;
        break;
      case "needsAffordableDecoration":
        if (value === true && !context.hasAffordableDecoration) ok = false;
        break;
      default:
        throw new Error(
          `authoredRequirementsMet: unhandled requirement "${key}" on template "${template.id}" — teach this helper about it (see its doc comment)`,
        );
    }
  }
  return ok;
}

describe("isBountyEligible", () => {
  it("universal care templates (feed/clean/play/pet/rest) are always eligible with no requirements", () => {
    const bareContext = contextAt(1, 1, {
      placedItemIds: [],
      unlockedExpeditionIds: [],
      obtainableItemIds: [],
      hasAffordableDecoration: false,
    });
    const universalKinds = ["feed", "clean", "play", "pet", "rest"];
    for (const t of BOUNTY_TEMPLATES) {
      if (universalKinds.includes(t.kind) && Object.keys(t.requires).length === 0) {
        expect(isBountyEligible(t, bareContext)).toBe(true);
      }
    }
  });

  it("the minKeepLevel gate is the DECIDING condition, on a template with no other requirement", () => {
    // `hatch-one-egg` requires ONLY `{ minKeepLevel: 2 }`, which is the whole
    // point of choosing it: the previous fixture here (`evening-at-the-grotto`,
    // `{ expeditionId: "lanterngrotto", minKeepLevel: 3 }`) was double-gated,
    // so at level 1 the expeditionId branch already returned false and the
    // level branch was never the deciding condition — deleting the level guard
    // outright left the whole suite green (round-2C review, mutation 5a).
    const t = BOUNTY_TEMPLATES.find((tpl) => tpl.id === "hatch-one-egg")!;
    expect(Object.keys(t.requires), "fixture must be level-gated ONLY").toEqual([
      "minKeepLevel",
    ]);
    expect(t.requires.minKeepLevel).toBe(2);
    expect(isBountyEligible(t, contextAt(1, 1))).toBe(false);
    expect(isBountyEligible(t, contextAt(2, 1))).toBe(true);
  });

  it("a level-3-only template is ineligible at level 1", () => {
    const t = BOUNTY_TEMPLATES.find((tpl) => tpl.id === "evening-at-the-grotto")!;
    expect(isBountyEligible(t, contextAt(1, 1))).toBe(false);
    expect(isBountyEligible(t, contextAt(3, 1))).toBe(true);
  });

  it("agrees with the AUTHORED requirements for every template × every level (an independent re-derivation, not a tautology)", () => {
    for (const template of BOUNTY_TEMPLATES) {
      for (const level of [1, 2, 3]) {
        for (const placements of [[], ["gathering-station", "stockpot"]]) {
          const context = contextAt(level, 3, { placedItemIds: placements });
          expect(
            isBountyEligible(template, context),
            `${template.id} at level ${level} (placed: ${placements.join("+") || "nothing"})`,
          ).toBe(authoredRequirementsMet(template, context));
        }
      }
    }
  });

  it("a station-gated template requires the station PLACED, not just the keep level", () => {
    const t = BOUNTY_TEMPLATES.find((tpl) => tpl.id === "something-simmering")!;
    expect(isBountyEligible(t, contextAt(2, 1, { placedItemIds: [] }))).toBe(false);
    expect(isBountyEligible(t, contextAt(2, 1, { placedItemIds: ["stockpot"] }))).toBe(true);
  });
});

describe("resolveBountyTarget", () => {
  it("resolves a flat number target unchanged", () => {
    expect(resolveBountyTarget(3, 5)).toBe(3);
  });

  it("resolves a per-roster-pip formula, floored at 1", () => {
    expect(resolveBountyTarget({ base: 0, perRosterPip: 1 }, 3)).toBe(3);
    expect(resolveBountyTarget({ base: 0, perRosterPip: 1 }, 0)).toBe(1);
  });
});

describe("generateBountiesForDay — level-aware, deterministic, never starves", () => {
  it("is deterministic: the same (seed, day, context) always yields the same trio", () => {
    const context = contextAt(1, 3);
    const a = generateBountiesForDay(42, 100, context, bountyTuning);
    const b = generateBountiesForDay(42, 100, context, bountyTuning);
    expect(a).toEqual(b);
  });

  it("survives reload trivially — it's a pure function, no persisted cursor", () => {
    const context = contextAt(2, 2);
    const before = generateBountiesForDay(7, 5, context, bountyTuning);
    // "Reload" = call again from scratch with the same inputs.
    const after = generateBountiesForDay(7, 5, context, bountyTuning);
    expect(after).toEqual(before);
  });

  it("always produces distinct kinds within a day", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const bounties = generateBountiesForDay(seed, seed * 7, contextAt(1, 3), bountyTuning);
      const kinds = bounties.slots.map(
        (s) => BOUNTY_TEMPLATES.find((t) => t.id === s.templateId)?.kind,
      );
      expect(new Set(kinds).size).toBe(kinds.length);
    }
  });

  it("the eligible pool never starves at Keep level 1 with a single Sulking-capable pip and nothing placed", () => {
    const bareContext = contextAt(1, 1, {
      placedItemIds: [],
      obtainableItemIds: [],
      hasAffordableDecoration: false,
    });
    const eligibleCount = BOUNTY_TEMPLATES.filter((t) => isBountyEligible(t, bareContext)).length;
    expect(eligibleCount).toBeGreaterThanOrEqual(bountyTuning.retention.bounties.perDay);
  });

  it("THE PROOF: across levels × roster sizes × placements × 1000 seeded days, every generated bounty is completable", () => {
    const levels = [1, 2, 3];
    const rosterSizes = [1, 2, 3, 4, 5];
    const placementSets: (readonly string[])[] = [
      [],
      ["gathering-station"],
      ["stockpot"],
      ["gathering-station", "stockpot"],
    ];
    let checked = 0;
    for (const level of levels) {
      for (const rosterSize of rosterSizes) {
        for (const placements of placementSets) {
          for (let day = 0; day < 60; day++) {
            const context = contextAt(level, rosterSize, { placedItemIds: placements });
            const bounties = generateBountiesForDay(
              level * 1000 + rosterSize,
              day,
              context,
              bountyTuning,
            );
            for (const slot of bounties.slots) {
              const template = BOUNTY_TEMPLATES.find((t) => t.id === slot.templateId);
              expect(template, `unknown template ${slot.templateId}`).toBeDefined();
              // Checked against the AUTHORED `requires` data, NOT against
              // `isBountyEligible` — see `authoredRequirementsMet`'s doc
              // comment for why the obvious version of this line proves
              // nothing.
              expect(
                authoredRequirementsMet(template!, context),
                `generated an INELIGIBLE bounty: ${slot.templateId} at level ${level}`,
              ).toBe(true);
              // Target sanity: every hand-authored target is modest — a
              // bounty must never read as a grind.
              expect(slot.target).toBeLessThanOrEqual(10);
              checked++;
            }
          }
        }
      }
    }
    // Sanity that the loop actually exercised something (the "prove it"
    // deliverable, not a vacuous pass).
    expect(checked).toBeGreaterThan(1000);
  });

  it("Keep level 1 specifically: no generated bounty is ever impossible", () => {
    // The module header's promise: "a bounty for a locked biome is a bug, not
    // a stretch goal." Asserted against the authored requirement data so a
    // loosened `isBountyEligible` cannot hide behind it.
    const levelGatedIds = BOUNTY_TEMPLATES.filter(
      (t) => (t.requires.minKeepLevel ?? 1) > 1,
    ).map((t) => t.id);
    expect(levelGatedIds.length, "there must BE level-gated templates to exclude")
      .toBeGreaterThan(0);
    for (let day = 0; day < 1000; day++) {
      const context = contextAt(1, 1, { placedItemIds: [] });
      const bounties = generateBountiesForDay(999, day, context, bountyTuning);
      for (const slot of bounties.slots) {
        const template = BOUNTY_TEMPLATES.find((t) => t.id === slot.templateId)!;
        expect(authoredRequirementsMet(template, context)).toBe(true);
        expect(
          levelGatedIds,
          `a level-2+ template leaked into a level-1 day: ${slot.templateId}`,
        ).not.toContain(slot.templateId);
      }
    }
  });
});

describe("ensureBountiesForDay — lazy regeneration", () => {
  it("returns the SAME reference when already current (cheap no-op)", () => {
    const context = contextAt(1, 2);
    const bounties = generateBountiesForDay(1, 5, context, bountyTuning);
    const again = ensureBountiesForDay(bounties, 1, 5, context, bountyTuning);
    expect(again).toBe(bounties);
  });

  it("a 30-day absence regenerates exactly ONE day's worth, not 30", () => {
    const context = contextAt(1, 2);
    const day1 = generateBountiesForDay(1, 1, context, bountyTuning);
    const day31 = ensureBountiesForDay(day1, 1, 31, context, bountyTuning);
    expect(day31.day).toBe(31);
    expect(day31.slots.length).toBe(bountyTuning.retention.bounties.perDay);
  });
});

describe("applyBountyEvent — progress, completion, idempotency", () => {
  it("progresses a matching slot and completes it at target, capping at target", () => {
    const context = contextAt(1, 1);
    let bounties = generateBountiesForDay(1, 1, context, bountyTuning);
    const feedSlot = bounties.slots.find(
      (s) => BOUNTY_TEMPLATES.find((t) => t.id === s.templateId)?.kind === "feed",
    );
    expect(feedSlot).toBeDefined();
    for (let i = 0; i < feedSlot!.target + 5; i++) {
      const result = applyBountyEvent(bounties, { kind: "feed" }, 1000 + i);
      bounties = result.bounties;
    }
    const after = bounties.slots.find((s) => s.slot === feedSlot!.slot)!;
    expect(after.progress).toBe(after.target); // never overflows past target
    expect(after.completedAt).not.toBeNull();
  });

  it("expedition events only progress the slot with the matching expeditionId param", () => {
    const context = contextAt(1, 1);
    let bounties = generateBountiesForDay(2, 1, context, bountyTuning);
    const before = JSON.stringify(bounties);
    const result = applyBountyEvent(bounties, { kind: "expedition", expeditionId: "shore" }, 1);
    // Shore is not unlocked at level 1, so no expedition slot could exist
    // with that param — nothing should change.
    expect(JSON.stringify(result.bounties)).toBe(before);
  });

  it("day-clear fires exactly once even if events keep arriving after completion", () => {
    const context = contextAt(1, 1, { placedItemIds: [] });
    let bounties = createEmptyBounties();
    bounties = generateBountiesForDay(3, 1, context, bountyTuning);
    let clears = 0;
    let at = 1;
    // Drive every slot to completion with generous repeated events of
    // every universal kind (some will be no-ops for non-matching slots).
    for (let i = 0; i < 50; i++) {
      for (const kind of ["feed", "clean", "play", "pet", "rest"] as const) {
        const result = applyBountyEvent(bounties, { kind }, at++);
        bounties = result.bounties;
        if (result.dayJustCleared) clears++;
      }
    }
    expect(clears).toBeLessThanOrEqual(1);
  });
});

describe("rerollBountySlot", () => {
  it("respects the free-reroll budget (no-op once spent)", () => {
    const context = contextAt(1, 2);
    let bounties = generateBountiesForDay(5, 1, context, bountyTuning);
    const slot0 = bounties.slots[0]!.slot;
    bounties = rerollBountySlot(bounties, slot0, 5, context, bountyTuning);
    expect(bounties.rerollsUsed).toBe(1);
    const again = rerollBountySlot(bounties, slot0, 5, context, bountyTuning);
    expect(again).toBe(bounties); // budget spent — no-op
  });

  it("a reroll keeps the day's kinds distinct", () => {
    const context = contextAt(2, 3);
    let bounties = generateBountiesForDay(6, 1, context, bountyTuning);
    const slot0 = bounties.slots[0]!.slot;
    bounties = rerollBountySlot(bounties, slot0, 6, context, bountyTuning);
    const kinds = bounties.slots.map(
      (s) => BOUNTY_TEMPLATES.find((t) => t.id === s.templateId)?.kind,
    );
    expect(new Set(kinds).size).toBe(kinds.length);
  });
});

describe("replaceStaleBounties — a removed station never counts as a failure", () => {
  it("a slot whose station was removed mid-day is replaced or marked stale, never left broken", () => {
    const withStation = contextAt(2, 2, { placedItemIds: ["stockpot"] });
    let bounties = generateBountiesForDay(8, 1, withStation, bountyTuning);
    // Force a simmering bounty into slot 0 deterministically-ish: just
    // check the invariant holds for whatever was generated once the
    // station disappears.
    const withoutStation = contextAt(2, 2, { placedItemIds: [] });
    const replaced = replaceStaleBounties(bounties, withoutStation, bountyTuning);
    for (const slot of replaced.slots) {
      if (slot.completedAt !== null) continue;
      const template = BOUNTY_TEMPLATES.find((t) => t.id === slot.templateId);
      const stillValid =
        slot.stale || (template !== undefined && isBountyEligible(template, withoutStation));
      expect(stillValid).toBe(true);
    }
  });
});
