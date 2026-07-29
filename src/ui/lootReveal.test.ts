/**
 * Loot reveal — pure controller tests (node): script sequencing (the
 * spec §6.1 "staged reveals" timing contract), tier flair placement, the
 * warm summary copy, and queue-aware sequential playback through
 * ACKNOWLEDGE_REVEAL. The DOM shell is chrome around these.
 */

import { describe, expect, it } from "vitest";
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
  createRevealQueueController,
  itemLabel,
} from "./lootReveal";
import type { RevealQueueStateView } from "./lootReveal";

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
