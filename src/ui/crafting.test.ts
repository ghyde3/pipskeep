/**
 * The Craft Table screen — pure-model tests (node-style, matching every
 * other UI suite in this repo: the DOM shell is dumb chrome around
 * `craftingSheetModel`, which is what gets asserted here).
 */

import { describe, expect, it } from "vitest";
import { tuning as contentTuning } from "../content/tuning";
import { recipes as contentRecipes } from "../content/recipes";
import { LifeStage, PipActivity } from "../core/pips/types";
import type { PipState } from "../core/pips/types";
import { createNewGame } from "../core/state";
import type { GameState } from "../core/state";
import { craftOutcomeNote, craftingSheetModel } from "./crafting";
import { MOTIF_IDS } from "../content/icons";

const T0 = 1_000_000;

function makePip(id: string, overrides: Partial<PipState> = {}): PipState {
  return {
    id,
    speciesId: "mosspip",
    name: "Ribbon",
    genome: {
      speciesId: "mosspip",
      palette: "fern",
      pattern: "plain",
      personalityId: "curious",
      shiny: false,
    },
    personalityId: "curious",
    lifeStage: LifeStage.Adult,
    hatchedAt: T0,
    ageMs: 0,
    happinessIntegral: 0,
    needs: { hunger: 90, cleanliness: 90, happiness: 90, energy: 90 },
    activity: PipActivity.Idle,
    pendingSulk: false,
    readyToEvolve: false,
    evolved: null,
    lastGiftItemId: null,
    expedition: null,
    needsUpdatedAt: T0,
    ...overrides,
  };
}

function stateWith(overrides: Partial<GameState> = {}): GameState {
  const fresh = createNewGame(3, T0);
  return { ...fresh, ...overrides };
}

describe("craftingSheetModel — no Craft Table placed yet", () => {
  it("locks every recipe below Keep level 4, sorted by tier then name, with unlock labels", () => {
    const model = craftingSheetModel(stateWith(), T0);
    expect(model.stations).toEqual([]);
    expect(model.targetStationId).toBeNull();
    expect(model.readyRecipes).toEqual([]);
    // ROUND 2J FIX STAGE — the book is seven: the cure, the Album's last
    // key, and the five craft-only keepsakes. Toastnut and Honeydrop were
    // cut (see content/recipes.ts's header for the arithmetic).
    expect(model.lockedRecipes.map((r) => r.id)).toEqual([
      "lodestone-cairn",
      "poultice",
      "herb-rail",
      "chime-rail",
      "feastpot",
      "compass-rose",
      "wayhome-lantern",
    ]);
    for (const recipe of model.lockedRecipes) {
      expect(recipe.locked).toBe(true);
      expect(recipe.lockLabel).toMatch(/Unlocks at Keep level \d+/);
      expect(recipe.craftable).toBe(false);
      // A locked card still shows what it would cost and what it's for —
      // "an invisible recipe book teaches nothing" (the round's own brief).
      expect(recipe.effectCopy.length).toBeGreaterThan(0);
      expect(recipe.inputs.length).toBeGreaterThan(0);
    }
  });

  it("says the Craft Table isn't open yet, naming the tier", () => {
    const model = craftingSheetModel(stateWith({ keep: { level: 1, placements: {} } }), T0);
    expect(model.bookNote).toContain("Keep level 4");
  });

  it("once the tier is reached but nothing is built, nudges toward the Build sheet", () => {
    const model = craftingSheetModel(stateWith({ keep: { level: 4, placements: {} } }), T0);
    expect(model.bookNote).toMatch(/build a craft table/i);
    // Every tier-4 recipe is now unlocked (in the book), even with no
    // station to craft it at yet.
    expect(model.readyRecipes.map((r) => r.id).sort()).toEqual(
      ["lodestone-cairn", "poultice"].sort(),
    );
    expect(model.lockedRecipes.map((r) => r.id)).toEqual([
      "herb-rail",
      "chime-rail",
      "feastpot",
      "compass-rose",
      "wayhome-lantern",
    ]);
  });
});

describe("craftingSheetModel — a placed, unstaffed Craft Table", () => {
  function withUnstaffedTable(keepLevel = 4): GameState {
    return stateWith({
      keep: {
        level: keepLevel,
        placements: { "place-1": { itemId: "craft-table", x: 0, y: 0 } },
      },
      jobs: {},
    });
  }

  it("reports the station unstaffed, and no recipe is craftable", () => {
    const model = craftingSheetModel(withUnstaffedTable(), T0);
    expect(model.stations).toHaveLength(1);
    expect(model.stations[0]).toMatchObject({
      label: "Craft Table",
      workerName: null,
      active: null,
      queue: [],
      queueFull: false,
      acceptsNewOrders: false,
    });
    expect(model.targetStationId).toBeNull();
    expect(model.bookNote).toMatch(/no craft table is staffed/i);
    for (const recipe of model.readyRecipes) expect(recipe.craftable).toBe(false);
  });
});

describe("craftingSheetModel — a staffed, idle Craft Table", () => {
  function withStaffedTable(
    overrides: Partial<GameState> & { keepLevel?: number } = {},
  ): GameState {
    const { keepLevel = 4, ...rest } = overrides;
    return stateWith({
      keep: {
        level: keepLevel,
        placements: { "place-1": { itemId: "craft-table", x: 0, y: 0 } },
      },
      pips: { "pip-1": makePip("pip-1", { activity: PipActivity.AssignedJob }) },
      rosterOrder: ["pip-1"],
      jobs: {
        "pip-1": { jobId: "crafting", stationPlacementId: "place-1", assignedAt: T0, lastProducedAt: T0 },
      },
      resources: {},
      inventory: {},
      ...rest,
    });
  }

  it("names the working Pip, and picks the station as the enqueue target", () => {
    const model = craftingSheetModel(withStaffedTable(), T0);
    expect(model.stations[0]).toMatchObject({ workerName: "Ribbon", acceptsNewOrders: true });
    expect(model.targetStationId).toBe("place-1");
    expect(model.bookNote).toBeNull();
  });

  it("marks a recipe unaffordable, warmly, with the exact shortfall", () => {
    const model = craftingSheetModel(
      withStaffedTable({ resources: { fiber: 4 } }), // Poultice needs fiber 6, lodestone 1
      T0,
    );
    const poultice = model.readyRecipes.find((r) => r.id === "poultice");
    expect(poultice?.affordable).toBe(false);
    expect(poultice?.craftable).toBe(false);
    expect(poultice?.missingLabel).toMatch(/2 more Fiber/);
    expect(poultice?.missingLabel).toMatch(/1 more Lodestone/);
    const fiberRow = poultice?.inputs.find((i) => i.id === "fiber");
    expect(fiberRow).toMatchObject({ need: 6, have: 4, short: 2 });
  });

  it("marks a fully-affordable, unlocked recipe as craftable", () => {
    const model = craftingSheetModel(
      withStaffedTable({ resources: { fiber: 6, lodestone: 1 }, inventory: {} }),
      T0,
    );
    const poultice = model.readyRecipes.find((r) => r.id === "poultice");
    expect(poultice?.affordable).toBe(true);
    expect(poultice?.craftable).toBe(true);
    expect(poultice?.missingLabel).toBe("");
  });

  it("checks BOTH resources and Satchel items for a recipe that needs food inputs", () => {
    // Herb Rail: fiber 8 + lodestone 2 (resources) + glowcap 1 (Satchel).
    const short = craftingSheetModel(
      withStaffedTable({
        keepLevel: 5,
        resources: { fiber: 8, lodestone: 2 },
        inventory: {},
      }),
      T0,
    ).readyRecipes.find((r) => r.id === "herb-rail");
    expect(short?.affordable).toBe(false);
    expect(short?.missingLabel).toMatch(/1 more Glowcap/i);

    const full = craftingSheetModel(
      withStaffedTable({
        keepLevel: 5,
        resources: { fiber: 8, lodestone: 2 },
        inventory: { glowcap: 1 },
      }),
      T0,
    ).readyRecipes.find((r) => r.id === "herb-rail");
    expect(full?.affordable).toBe(true);
  });

  it("a keepsake recipe names its output as a placement item, not a Satchel item", () => {
    const model = craftingSheetModel(withStaffedTable({ resources: { lodestone: 4, shell: 2 } }), T0);
    const cairn = model.readyRecipes.find((r) => r.id === "lodestone-cairn");
    expect(cairn?.outputLabel).toBe("1 × Lodestone Cairn");
    expect(cairn?.affordable).toBe(true);
    expect(cairn?.craftable).toBe(true);
  });

  it("names what a recipe outputs and how long it takes", () => {
    const model = craftingSheetModel(withStaffedTable(), T0);
    const poultice = model.readyRecipes.find((r) => r.id === "poultice");
    expect(poultice?.outputLabel).toBe("1 × Poultice");
    expect(poultice?.durationLabel).toBe("Takes 1 h 15 min");
  });
});

describe("craftingSheetModel — a Craft Table with an order in flight", () => {
  function withActiveOrder(startedAt: number, effectiveMs: number): GameState {
    return stateWith({
      keep: { level: 4, placements: { "place-1": { itemId: "craft-table", x: 0, y: 0 } } },
      pips: { "pip-1": makePip("pip-1", { activity: PipActivity.AssignedJob }) },
      rosterOrder: ["pip-1"],
      jobs: {
        "pip-1": { jobId: "crafting", stationPlacementId: "place-1", assignedAt: T0, lastProducedAt: T0 },
      },
      crafts: {
        "place-1": { pipId: "pip-1", recipeId: "poultice", startedAt, effectiveMs, queue: ["lodestone-cairn"] },
      },
    });
  }

  it("shows the active recipe's name and a live remaining-time label", () => {
    const model = craftingSheetModel(withActiveOrder(T0, 75 * 60_000), T0 + 40 * 60_000);
    const station = model.stations[0];
    expect(station?.active).toMatchObject({ name: "Poultice" });
    expect(station?.active?.remainingLabel).toMatch(/ready in 35 min/);
  });

  it("reads 'any moment now' once inside the last minute, never '0 min'", () => {
    const model = craftingSheetModel(withActiveOrder(T0, 75 * 60_000), T0 + 75 * 60_000 - 10_000);
    expect(model.stations[0]?.active?.remainingLabel).toBe("ready any moment now");
  });

  it("lists the queue with its recipe names, and a Craft Table with an active order still 'accepts' unless its queue is full", () => {
    const model = craftingSheetModel(withActiveOrder(T0, 75 * 60_000), T0);
    expect(model.stations[0]?.queue).toEqual([
      { recipeId: "lodestone-cairn", name: "Lodestone Cairn", queueIndex: 0 },
    ]);
    expect(model.stations[0]?.queueFull).toBe(false);
    expect(model.stations[0]?.acceptsNewOrders).toBe(true);
  });

  it("refuses new orders once the queue is at tuning.crafting.queueMax", () => {
    const full: GameState = withActiveOrder(T0, 75 * 60_000);
    const atMax = {
      ...full,
      crafts: {
        "place-1": {
          ...(full.crafts?.["place-1"] as NonNullable<GameState["crafts"]>[string]),
          queue: Array.from({ length: contentTuning.crafting.queueMax }, () => "lodestone-cairn"),
        },
      },
    };
    const model = craftingSheetModel(atMax, T0);
    expect(model.stations[0]?.queueFull).toBe(true);
    expect(model.stations[0]?.acceptsNewOrders).toBe(false);
    expect(model.targetStationId).toBeNull();
    expect(model.bookNote).toMatch(/queue is full/i);
  });
});

describe("craftingSheetModel — multiple Craft Tables", () => {
  it("labels them distinctly and enqueues at the first station that accepts orders", () => {
    const state = stateWith({
      keep: {
        level: 4,
        placements: {
          "place-1": { itemId: "craft-table", x: 0, y: 0 },
          "place-2": { itemId: "craft-table", x: 3, y: 0 },
        },
      },
      pips: {
        "pip-1": makePip("pip-1", { name: "Ribbon", activity: PipActivity.AssignedJob }),
        "pip-2": makePip("pip-2", { name: "Sprout", activity: PipActivity.AssignedJob }),
      },
      rosterOrder: ["pip-1", "pip-2"],
      jobs: {
        "pip-2": { jobId: "crafting", stationPlacementId: "place-2", assignedAt: T0, lastProducedAt: T0 },
      },
    });
    const model = craftingSheetModel(state, T0);
    expect(model.stations.map((s) => s.label)).toEqual(["Craft Table 1", "Craft Table 2"]);
    // place-1 is unstaffed; place-2 (Sprout) is the only one that accepts.
    expect(model.stations[0]?.workerName).toBeNull();
    expect(model.stations[1]?.workerName).toBe("Sprout");
    expect(model.targetStationId).toBe("place-2");
  });
});

describe("craftingSheetModel — every shipped recipe never outputs a base resource (I2)", () => {
  it("resolves every output to a real, named item — never wood/fiber/shell/driftwood/lodestone", () => {
    const BASE_RESOURCES = ["wood", "fiber", "shell", "driftwood", "lodestone"];
    for (const recipe of Object.values(contentRecipes)) {
      expect(BASE_RESOURCES).not.toContain(recipe.output.itemId);
    }
  });
});

/**
 * ⚠️ ROUND 2J FIX STAGE — `state.lastCraftOutcome` was written by the
 * reducer (three call sites) and READ BY NOBODY. The `cannotAfford` branch
 * carries a typed shortfall bundle that `core/crafting`'s module doc says
 * exists "so the UI can say '12 more Lodestone needed'"; the sheet
 * recomputed affordability itself and never looked at it, so the whole
 * echo was dead state.
 */
describe("the enqueue/cancel echo reaches the player (round 2J fix stage)", () => {
  it("says so when an order goes straight onto the bench", () => {
    expect(
      craftOutcomeNote({
        action: "enqueueCraft",
        ok: true,
        stationPlacementId: "place-1",
        recipeId: "poultice",
        pipId: "pip-1",
        at: T0,
        startedImmediately: true,
      }),
    ).toMatch(/Poultice is on the bench now/);
  });

  it("...and distinguishes 'queued behind something' from 'started'", () => {
    expect(
      craftOutcomeNote({
        action: "enqueueCraft",
        ok: true,
        stationPlacementId: "place-1",
        recipeId: "poultice",
        pipId: "pip-1",
        at: T0,
        startedImmediately: false,
      }),
    ).toMatch(/queued/i);
  });

  it("speaks the typed shortfall aloud — the whole reason the bundle exists", () => {
    const note = craftOutcomeNote({
      action: "enqueueCraft",
      ok: false,
      stationPlacementId: "place-1",
      recipeId: "poultice",
      at: T0,
      reason: "cannotAfford",
      missing: { lodestone: 12 },
    });
    expect(note).toMatch(/12 more Lodestone/i);
  });

  it("names the other refusals without jargon, and stays silent on an unknown one", () => {
    const base = {
      action: "enqueueCraft",
      ok: false,
      stationPlacementId: "place-1",
      recipeId: "poultice",
      at: T0,
    } as const;
    expect(craftOutcomeNote({ ...base, reason: "queueFull" })).toMatch(/queue is full/i);
    expect(craftOutcomeNote({ ...base, reason: "unstaffed" })).toMatch(/nobody/i);
    expect(craftOutcomeNote({ ...base, reason: "unknownStation" })).toBeNull();
    expect(craftOutcomeNote(null)).toBeNull();
  });

  it("a cancel says the materials came back — the refund is the reassuring part", () => {
    expect(
      craftOutcomeNote({
        action: "cancelCraft",
        ok: true,
        stationPlacementId: "place-1",
        recipeId: "poultice",
        at: T0,
      }),
    ).toMatch(/everything it cost is back/i);
  });

  it("a stale echo does not greet the player on reload — the note has a TTL", () => {
    const outcome = {
      action: "enqueueCraft",
      ok: true,
      stationPlacementId: "place-1",
      recipeId: "poultice",
      pipId: "pip-1",
      at: T0,
      startedImmediately: true,
    } as const;
    expect(craftOutcomeNote(outcome, T0 + 1_000)).not.toBeNull();
    expect(craftOutcomeNote(outcome, T0 + 3 * 24 * 3_600_000)).toBeNull();
  });

  it("the sheet model carries it, so the note is on a real surface and not just derivable", () => {
    const model = craftingSheetModel(
      { ...stateWith(), lastCraftOutcome: {
        action: "enqueueCraft",
        ok: false,
        stationPlacementId: "place-1",
        recipeId: "poultice",
        at: T0,
        reason: "cannotAfford",
        missing: { fiber: 3 },
      } },
      T0,
    );
    expect(model.outcomeNote).toMatch(/3 more Fiber/i);
  });
});

/**
 * ROUND 2J FIX STAGE — the book shipped with all four recipes on
 * `{ motif: "bench" }`, so on a 375px screen it read as four identical
 * cards differing only in tint. The icon vocabulary progression-bible
 * §4.2 built exists exactly so that does not happen.
 */
describe("the recipe book is legible at a glance", () => {
  it("every recipe carries a DIFFERENT motif", () => {
    const motifs = Object.values(contentRecipes).map((r) => r.icon.motif);
    expect(new Set(motifs).size).toBe(motifs.length);
  });

  it("every motif is one the renderer actually knows", () => {
    for (const recipe of Object.values(contentRecipes)) {
      expect(MOTIF_IDS as readonly string[], recipe.id).toContain(recipe.icon.motif);
    }
  });

  it("every recipe answers 'why would I make this' on its own card", () => {
    for (const recipe of Object.values(contentRecipes)) {
      expect(recipe.effectCopy.trim().length, recipe.id).toBeGreaterThan(10);
      expect(recipe.flavor.trim().length, recipe.id).toBeGreaterThan(10);
    }
  });
});
