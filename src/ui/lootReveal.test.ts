/**
 * Loot reveal — pure controller tests (node): script sequencing (the
 * spec §6.1 "staged reveals" timing contract), tier flair placement, the
 * warm summary copy, and queue-aware sequential playback through
 * ACKNOWLEDGE_REVEAL. The DOM shell is chrome around these.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PendingReveal } from "../core/expeditions";
import type { GameAction } from "../core/state";
import { createEgg } from "../core/eggs";
import {
  REVEAL_EGG_HOLD_MS,
  REVEAL_EGG_LEAD_MS,
  REVEAL_FIRST_FLIP_MS,
  REVEAL_STEP_GAP_MS,
  REVEAL_SUMMARY_LAG_MS,
  REVEAL_TIER_HOLD_MS,
  REVEAL_TIER_LEAD_MS,
  buildRevealScript,
  createLootRevealModal,
  createRevealQueueController,
  itemLabel,
} from "./lootReveal";
import type { RevealQueueStateView, RevealScript } from "./lootReveal";
import { asHtml, installFakeDom } from "./fakeDom";
import type { FakeDomHandle, FakeElement } from "./fakeDom";
import { tuning } from "../content/tuning";
import { EXPEDITION_IDS } from "../content/expeditions";

const PIPS = { "pip-1": { name: "Moss" } };

function reveal(overrides: Partial<PendingReveal> = {}): PendingReveal {
  return {
    pipId: "pip-1",
    expeditionId: "meadow",
    completedAt: 10_000,
    items: ["berry", "fiber"],
    egg: null,
    ...overrides,
  };
}

describe("buildRevealScript — staged timing", () => {
  it("commons flip on the steady heartbeat, in item order", () => {
    const script = buildRevealScript(reveal({ items: ["berry", "wood"] }), PIPS);
    expect(script.steps.map((s) => s.kind)).toStrictEqual(["item", "item"]);
    expect(script.steps[0]?.flipAtMs).toBe(REVEAL_FIRST_FLIP_MS);
    expect(script.steps[1]?.flipAtMs).toBe(
      REVEAL_FIRST_FLIP_MS + REVEAL_STEP_GAP_MS,
    );
    expect(script.steps.map((s) => s.tier)).toStrictEqual(["common", "common"]);
    expect(script.readyAtMs).toBe(
      REVEAL_FIRST_FLIP_MS + 2 * REVEAL_STEP_GAP_MS + REVEAL_SUMMARY_LAG_MS,
    );
  });

  it("an uncommon item gets a pregnant pause before and a longer hold after", () => {
    const script = buildRevealScript(
      reveal({ items: ["berry", "stew", "wood"] }),
      PIPS,
    );
    const [berry, stew, wood] = script.steps;
    expect(stew?.tier).toBe("uncommon");
    // Pause BEFORE the uncommon flip…
    expect(stew!.flipAtMs - berry!.flipAtMs).toBe(
      REVEAL_STEP_GAP_MS + REVEAL_TIER_LEAD_MS,
    );
    // …and extra hold AFTER it, before the next common lands.
    expect(wood!.flipAtMs - stew!.flipAtMs).toBe(
      REVEAL_STEP_GAP_MS + REVEAL_TIER_HOLD_MS,
    );
  });

  // ROUND 2B (content bible §8.2.3): the eight new foods must not flip past
  // as plain commons — the default tiers now come from `FoodDef.revealTier`
  // (content/foods.ts), not just the two hardcoded ids this file used to
  // pin. Without this, the Feastpot — the rarest, richest item in the game
  // — would present with no more ceremony than a twig.
  it("Feastpot (the rarest item in the game) defaults to the 'rare' showstopper tier", () => {
    const script = buildRevealScript(reveal({ items: ["berry", "feastpot"] }), PIPS);
    const feastpot = script.steps.find((s) => s.itemId === "feastpot");
    expect(feastpot?.tier).toBe("rare");
  });

  it("Emberloaf, Glowcap, and Cocoa Bun default to 'uncommon' (joining Stew/Driftwood)", () => {
    const script = buildRevealScript(
      reveal({ items: ["emberloaf", "glowcap", "cocoabun", "driftwood"] }),
      PIPS,
    );
    const tierOf = (id: string): unknown =>
      script.steps.find((s) => s.itemId === id)?.tier;
    expect(tierOf("emberloaf")).toBe("uncommon");
    expect(tierOf("glowcap")).toBe("uncommon");
    expect(tierOf("cocoabun")).toBe("uncommon");
    expect(tierOf("driftwood")).toBe("uncommon");
  });

  // ROUND 2J (docs/economy-bible.md §1.4/§6.3): the fifth resource gets the
  // same ceremony Driftwood does — a late, scarce find, never a bare common.
  it("Lodestone defaults to 'uncommon', joining Driftwood", () => {
    const script = buildRevealScript(reveal({ items: ["wood", "lodestone"] }), PIPS);
    expect(script.steps.find((s) => s.itemId === "lodestone")?.tier).toBe("uncommon");
  });

  it("a plain resource with no FoodDef and no hardcoded entry stays common", () => {
    const script = buildRevealScript(reveal({ items: ["shell"] }), PIPS);
    expect(script.steps[0]?.tier).toBe("common");
  });

  it("the egg is always the last beat, with the showstopper lead-in", () => {
    const egg = createEgg({ id: "egg-1", foundAt: 0, sourceExpeditionId: "meadow" });
    const script = buildRevealScript(reveal({ items: ["berry"], egg }), PIPS);
    const last = script.steps[script.steps.length - 1];
    expect(script.hasEgg).toBe(true);
    expect(last?.kind).toBe("egg");
    expect(last?.flipAtMs).toBe(
      REVEAL_FIRST_FLIP_MS + REVEAL_STEP_GAP_MS + REVEAL_EGG_LEAD_MS,
    );
    expect(script.readyAtMs).toBe(
      last!.flipAtMs + REVEAL_EGG_HOLD_MS + REVEAL_SUMMARY_LAG_MS,
    );
  });

  it("flip times are strictly increasing whatever the mix", () => {
    const egg = createEgg({ id: "egg-2", foundAt: 0, sourceExpeditionId: "shore" });
    const script = buildRevealScript(
      reveal({ items: ["shell", "stew", "driftwood", "berry"], egg }),
      PIPS,
    );
    const times = script.steps.map((s) => s.flipAtMs);
    for (let i = 1; i < times.length; i++) {
      expect(times[i]!).toBeGreaterThan(times[i - 1]!);
    }
    expect(script.readyAtMs).toBeGreaterThan(times[times.length - 1]!);
  });
});

describe("buildRevealScript — names and copy", () => {
  it("resolves labels: food registry names, capitalized resource ids", () => {
    expect(itemLabel("berry")).toBe("Berry");
    expect(itemLabel("stew")).toBe("Stew");
    expect(itemLabel("wood")).toBe("Wood");
    expect(itemLabel("driftwood")).toBe("Driftwood");
  });

  it("uses the pip's name and the expedition's registry name", () => {
    const script = buildRevealScript(reveal(), PIPS);
    expect(script.pipName).toBe("Moss");
    expect(script.expeditionName).toBe("Meadow");
  });

  it("falls back gracefully for unknown pips and expeditions", () => {
    const script = buildRevealScript(
      reveal({ pipId: "pip-9", expeditionId: "swamp" }),
      PIPS,
    );
    expect(script.pipName).toBe("Your Pip");
    expect(script.expeditionName).toBe("Swamp");
  });

  it("summary counts the treasures; the egg gets its own clause", () => {
    const egg = createEgg({ id: "egg-3", foundAt: 0, sourceExpeditionId: "meadow" });
    expect(
      buildRevealScript(reveal({ items: ["berry", "fiber", "wood"] }), PIPS)
        .summaryLine,
    ).toContain("3 treasures");
    expect(
      buildRevealScript(reveal({ items: ["berry"], egg }), PIPS).summaryLine,
    ).toContain("round");
    expect(
      buildRevealScript(reveal({ items: [], egg }), PIPS).summaryLine,
    ).toContain("egg");
  });

  it("an empty-handed return still gets a warm line (never an error)", () => {
    const script = buildRevealScript(reveal({ items: [] }), PIPS);
    expect(script.steps).toHaveLength(0);
    expect(script.summaryLine).toContain("stories");
    expect(script.readyAtMs).toBe(REVEAL_FIRST_FLIP_MS + REVEAL_SUMMARY_LAG_MS);
  });
});

describe("reveal queue controller — sequential playback", () => {
  function makeQueue(reveals: PendingReveal[]): {
    dispatched: GameAction[];
    controller: ReturnType<typeof createRevealQueueController>;
  } {
    let queue = [...reveals];
    const dispatched: GameAction[] = [];
    const getState = (): RevealQueueStateView => ({
      pendingReveals: queue,
      pips: PIPS,
    });
    const controller = createRevealQueueController({
      getState,
      dispatch: (action) => {
        dispatched.push(action);
        if (action.type === "ACKNOWLEDGE_REVEAL") queue = queue.slice(1);
      },
      now: () => 5_555,
    });
    return { dispatched, controller };
  }

  it("openScript peeks the head without dispatching", () => {
    const { dispatched, controller } = makeQueue([
      reveal({ expeditionId: "meadow" }),
      reveal({ expeditionId: "forest" }),
    ]);
    expect(controller.openScript()?.expeditionId).toBe("meadow");
    expect(controller.openScript()?.expeditionId).toBe("meadow"); // idempotent
    expect(dispatched).toHaveLength(0);
  });

  it("collectAndNext acknowledges the head at now() and hands over the next reveal", () => {
    const { dispatched, controller } = makeQueue([
      reveal({ expeditionId: "meadow" }),
      reveal({ expeditionId: "forest" }),
    ]);
    const second = controller.collectAndNext();
    expect(dispatched).toStrictEqual([{ type: "ACKNOWLEDGE_REVEAL", at: 5_555 }]);
    expect(second?.expeditionId).toBe("forest");

    const done = controller.collectAndNext();
    expect(done).toBeNull();
    expect(dispatched).toHaveLength(2);
  });

  it("an empty queue is a no-op: no script, no dispatch", () => {
    const { dispatched, controller } = makeQueue([]);
    expect(controller.openScript()).toBeNull();
    expect(controller.collectAndNext()).toBeNull();
    expect(dispatched).toHaveLength(0);
  });
});


/**
 * ROUND 2F — THE REVEAL'S `+N Keep XP` CHIP (progression bible §1.3 row 10).
 *
 * XP was granted at roughly fifteen kinds of moment and displayed at five, and
 * the richest ACTIVE source — the one the bible calls "the dopamine core" —
 * showed none of it: a returning Meadow trip rendered its haul and its warm
 * summary line and granted +27 XP with no XP text anywhere on the card.
 */
describe("buildRevealScript — the trip's Keep XP (bible §1.3 row 10)", () => {
  const durations = {
    meadow: { durationMs: 5 * 60_000 },
    grotto: { durationMs: 90 * 60_000 },
  };

  it("pays the bible's own per-biome figure: a 5-minute Meadow trip is 7", () => {
    const script = buildRevealScript(reveal(), PIPS, { expeditionDurations: durations });
    expect(script.xpAward).toBe(
      tuning.progression.xp.revealBase + tuning.progression.xp.revealPer5Min * 1,
    );
    expect(script.xpAward).toBe(7);
  });

  it("scales with trip length — a 90-minute trip pays far more than a 5-minute one", () => {
    const short = buildRevealScript(reveal(), PIPS, { expeditionDurations: durations });
    const long = buildRevealScript(reveal({ expeditionId: "grotto" }), PIPS, {
      expeditionDurations: durations,
    });
    expect(long.xpAward).toBeGreaterThan(short.xpAward);
    expect(long.xpAward).toBe(
      tuning.progression.xp.revealBase + tuning.progression.xp.revealPer5Min * 18,
    );
  });

  it("applies the Keep's xpBonus, rounded UP so a bonus is never invisible", () => {
    // Mirrors `core/state.ts`'s own `Math.ceil(gained * (1 + fraction))`: at
    // +5% a 7-XP trip pays 8, never a silent 7.
    const boosted = buildRevealScript(reveal(), PIPS, {
      expeditionDurations: durations,
      xpBonusFraction: 0.05,
    });
    expect(boosted.xpAward).toBe(8);
  });

  it("an unbuilt Keep shows the base rate exactly — the bonus is opt-in, never a hidden tax", () => {
    const plain = buildRevealScript(reveal(), PIPS, {
      expeditionDurations: durations,
      xpBonusFraction: 0,
    });
    expect(plain.xpAward).toBe(7);
  });

  it("is positive for every real biome — no trip is ever worth showing a +0 chip for", () => {
    for (const id of EXPEDITION_IDS) {
      const script = buildRevealScript(reveal({ expeditionId: id }), PIPS);
      expect(script.xpAward, id).toBeGreaterThan(0);
    }
  });

  it("an unknown biome degrades to 0 rather than NaN (defensive: content removed mid-flight)", () => {
    const script = buildRevealScript(reveal({ expeditionId: "no-such-biome" }), PIPS, {
      expeditionDurations: durations,
    });
    expect(script.xpAward).toBe(tuning.progression.xp.revealBase);
    expect(Number.isFinite(script.xpAward)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// THE MODAL — the surface, not just the script
// ---------------------------------------------------------------------------

/**
 * ROUND 2G REVIEW, MUTATION 4 (survived 2,230 tests): `play`'s
 *
 *     xpChip.textContent = `+${script.xpAward} Keep XP`;
 *     xpChip.hidden = script.xpAward <= 0;
 *
 * replaced with `xpChip.textContent = ""; xpChip.hidden = true;`. Everything
 * stayed green, because this file tested `buildRevealScript(...).xpAward` nine
 * ways — base value, duration scaling, xpBonus scaling, every expedition id,
 * finiteness — and never asserted the number reached a pixel. `.pk-reveal-xp`
 * appeared in exactly two files in the repo, `lootReveal.ts` and `modals.css`,
 * and in no test.
 *
 * That matters more here than anywhere: `RevealScript.xpAward`'s own doc
 * records that this exact defect already shipped once — the bible calls the
 * reveal "the dopamine core", and it displayed NO XP at all, a returning
 * Meadow trip granting +27 while the card said nothing. Round 2F restored the
 * chip; nothing pinned it there. A bulletproof model behind an unguarded
 * surface is the precise shape of a silently-dead feature.
 */
describe("createLootRevealModal — the card actually says what the trip paid", () => {
  let dom: FakeDomHandle;

  beforeEach(() => {
    dom = installFakeDom();
  });
  afterEach(() => {
    dom.uninstall();
  });

  function open(script: RevealScript): {
    readonly modal: ReturnType<typeof createLootRevealModal>;
    readonly root: FakeElement;
  } {
    const modal = createLootRevealModal({
      mount: asHtml(dom.ui),
      onCollect: () => {},
    });
    modal.play(script);
    return { modal, root: modal.el as unknown as FakeElement };
  }

  it("renders the +N Keep XP chip with the script's own award", () => {
    const script = buildRevealScript(reveal(), PIPS);
    expect(script.xpAward).toBeGreaterThan(0);

    const { root } = open(script);
    const chip = root.querySelector(".pk-reveal-xp") as FakeElement;
    expect(chip.hidden).toBe(false);
    expect(chip.textContent).toBe(`+${script.xpAward} Keep XP`);
  });

  it("hides the chip — rather than printing '+0 Keep XP' — when a trip pays none", () => {
    const script: RevealScript = { ...buildRevealScript(reveal(), PIPS), xpAward: 0 };
    const { root } = open(script);
    const chip = root.querySelector(".pk-reveal-xp") as FakeElement;
    expect(chip.hidden).toBe(true);
  });

  it("re-shows the chip on a later trip that DOES pay (the guard is not one-way)", () => {
    const modal = createLootRevealModal({
      mount: asHtml(dom.ui),
      onCollect: () => {},
    });
    const root = modal.el as unknown as FakeElement;
    const chip = root.querySelector(".pk-reveal-xp") as FakeElement;

    const paying = buildRevealScript(reveal(), PIPS);
    modal.play({ ...paying, xpAward: 0 });
    expect(chip.hidden).toBe(true);

    modal.play(paying);
    expect(chip.hidden).toBe(false);
    expect(chip.textContent).toBe(`+${paying.xpAward} Keep XP`);
  });

  it("Collect only fires once the beats have finished — juice first, then the seam", () => {
    let collected = 0;
    const modal = createLootRevealModal({
      mount: asHtml(dom.ui),
      onCollect: () => (collected += 1),
    });
    const root = modal.el as unknown as FakeElement;
    const script = buildRevealScript(reveal(), PIPS);
    modal.play(script);

    const collect = root.querySelector(".pk-reveal-collect") as FakeElement;
    collect.click();
    expect(collected).toBe(0);

    // A tap anywhere else fast-forwards every remaining beat…
    const card = root.querySelector(".pk-reveal-card") as FakeElement;
    card.dispatch("click", { target: card });
    // …after which Collect is live.
    collect.click();
    expect(collected).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ROUND 2H — the lineage egg's payoff (spec §16 v1.5 promise 4).
//
// The gap this closes was found by playing, not by reading: everything else
// about the thread was visible (the Nook's "Someone to find" card, the
// per-biome hint on the send-off row, the seed in state), but the moment a
// player went back for their lost Pip and SUCCEEDED read exactly like any
// other loot egg — "and something round and full of promise". A quest whose
// completion goes unremarked is not a quest.
// ---------------------------------------------------------------------------

describe("ROUND 2H — a lineage egg is named, not anonymous", () => {
  const genome = {
    speciesId: "pebblepip",
    palette: "sandstone",
    pattern: "banded",
    personalityId: "curious",
    shiny: false,
  };

  const lineageEgg = (parentIds: readonly string[]) => ({
    id: "egg-9",
    state: "found" as const,
    sourceExpeditionId: "bramblewick",
    foundAt: 10_000,
    incubationStartedAt: null,
    incubationMs: 60_000,
    lineageGenome: genome,
    lineageParentIds: parentIds,
    lineageLevel: 4,
    lineageResistances: {},
    lineageGeneration: 2,
  });

  // The lost parent is NOT in the roster — being lost is what seeded the
  // egg — so the name has to come from the Long Meadow.
  const NAMES = { "pip-1": { name: "Moss" }, "pip-gone": { name: "Pebblepip" } };

  it("names the lost parent in both the summary line and the egg caption", () => {
    const script = buildRevealScript(
      reveal({ egg: lineageEgg(["pip-gone"]) as never }),
      NAMES,
    );
    expect(script.summaryLine).toContain("Pebblepip's egg");
    expect(script.eggCaption).toBe("Pebblepip's egg.");
    expect(script.steps.find((s) => s.kind === "egg")?.label).toBe("Pebblepip's egg.");
    // ...and never the generic line, which is the whole failure being fixed.
    expect(script.summaryLine).not.toContain("round and full of promise");
  });

  it("leaves an ORDINARY egg's copy byte-identical", () => {
    const plain = buildRevealScript(
      reveal({ egg: { id: "egg-1", state: "found" } as never }),
      NAMES,
    );
    expect(plain.eggCaption).toBe("An egg?!");
    expect(plain.summaryLine).toContain("round and full of promise");
  });

  it("does NOT claim a two-parent (bred) egg was found on a trail", () => {
    // A bred egg carries the same `lineageGenome` but names two parents and
    // never reaches a reveal. If it ever does, it must not borrow promise
    // 4's copy — nobody went and fetched it.
    const bred = buildRevealScript(
      reveal({ egg: lineageEgg(["pip-1", "pip-gone"]) as never }),
      NAMES,
    );
    expect(bred.eggCaption).toBe("An egg?!");
    expect(bred.summaryLine).toContain("round and full of promise");
  });

  it("falls back gracefully when the parent's name cannot be resolved", () => {
    const orphan = buildRevealScript(
      reveal({ egg: lineageEgg(["pip-nobody"]) as never }),
      NAMES,
    );
    expect(orphan.eggCaption).toBe("An egg?!");
  });
});

describe("ROUND 2H — the queue controller resolves names from the Long Meadow", () => {
  it("merges sanctuary residents into the name lookup so a lost parent can be named", () => {
    const state: RevealQueueStateView = {
      pendingReveals: [
        reveal({
          egg: {
            id: "egg-9",
            state: "found",
            sourceExpeditionId: "bramblewick",
            lineageGenome: {
              speciesId: "pebblepip",
              palette: "sandstone",
              pattern: "banded",
              personalityId: "curious",
              shiny: false,
            },
            lineageParentIds: ["pip-gone"],
          } as never,
        }),
      ],
      pips: { "pip-1": { name: "Moss" } },
      sanctuary: { pips: { "pip-gone": { pip: { name: "Pebblepip" } } } },
    };
    const controller = createRevealQueueController({
      getState: () => state,
      dispatch: () => {},
      now: () => 0,
    });
    expect(controller.openScript()?.eggCaption).toBe("Pebblepip's egg.");
  });
});
