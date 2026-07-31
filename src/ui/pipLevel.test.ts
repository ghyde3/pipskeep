import { describe, expect, it } from "vitest";
import { tuning as contentTuning } from "../content/tuning";
import { LifeStage, PipActivity } from "../core/pips/types";
import type { PipState } from "../core/pips/types";
import { createNewGame } from "../core/state";
import type { GameState } from "../core/state";
import {
  buildLevelChannels,
  buildPipLevelModel,
  createPipLevelView,
  growthLine,
  nextLevelHint,
  pipLevelChipLabel,
} from "./pipLevel";
import { installFakeDom } from "./fakeDom";
import type { FakeElement } from "./fakeDom";

function makePip(overrides: Partial<PipState> = {}): PipState {
  return {
    id: "pip-1",
    speciesId: "mosspip",
    name: "Mossy",
    genome: {
      speciesId: "mosspip",
      palette: "fern",
      pattern: "plain",
      personalityId: "curious",
      shiny: false,
    },
    personalityId: "curious",
    lifeStage: LifeStage.Adult,
    hatchedAt: 0,
    ageMs: 0,
    happinessIntegral: 0,
    needs: { hunger: 80, cleanliness: 80, happiness: 80, energy: 80 },
    activity: PipActivity.Idle,
    pendingSulk: false,
    readyToEvolve: false,
    evolved: null,
    lastGiftItemId: null,
    expedition: null,
    needsUpdatedAt: 0,
    ...overrides,
  };
}

const LEVEL_XP = contentTuning.lifecycle.level.levelXp;
const MAX_LEVEL = contentTuning.lifecycle.level.maxLevel;

describe("buildPipLevelModel — a fresh, level-1 Pip", () => {
  const pip = makePip();
  const model = buildPipLevelModel(pip);

  it("starts at level 1 with an empty bar", () => {
    expect(model.level).toBe(1);
    expect(model.xp).toBe(0);
    expect(model.xpIntoLevel).toBe(0);
    expect(model.xpForNextLevel).toBe(LEVEL_XP[1]);
    expect(model.progress).toBe(0);
    expect(model.atMaxLevel).toBe(false);
  });

  it("has no unlocked channels yet", () => {
    expect(model.channels).toEqual({
      careEasePct: 0,
      trailSpeedPct: 0,
      resistancePct: 0,
      staminaPct: 0,
      cureBonusPct: 0,
      lifespanPct: 0,
    });
  });

  it("reads as just getting started, with a next-level hint", () => {
    expect(model.growthLine).toBe("Just getting started.");
    expect(model.nextLevelHint).not.toBeNull();
    expect(model.nextLevelHint).toContain("Level 2");
  });

  it("has no chip label at level 1 (nothing to show yet)", () => {
    expect(pipLevelChipLabel(pip)).toBeNull();
  });
});

describe("buildPipLevelModel — a max-level Pip", () => {
  const pip = makePip({ level: MAX_LEVEL, pipXp: LEVEL_XP[MAX_LEVEL - 1] });
  const model = buildPipLevelModel(pip);

  it("is capped at max level with a full, static bar", () => {
    expect(model.level).toBe(MAX_LEVEL);
    expect(model.atMaxLevel).toBe(true);
    expect(model.xpForNextLevel).toBeNull();
    expect(model.progress).toBe(1);
    expect(model.nextLevelHint).toBeNull();
  });

  it("matches the bible's §1.3 worked numbers exactly (seasoning -12%, trail x0.94, etc.)", () => {
    expect(model.channels.careEasePct).toBe(12);
    expect(model.channels.trailSpeedPct).toBe(6);
    expect(model.channels.resistancePct).toBe(40);
    expect(model.channels.staminaPct).toBeCloseTo(35, 5);
    expect(model.channels.cureBonusPct).toBe(18);
    expect(model.channels.lifespanPct).toBe(36);
  });

  it("shows a growth line with three clauses and a chip label", () => {
    expect(growthLine(pip).split(" ").length).toBeGreaterThan(3);
    expect(pipLevelChipLabel(pip)).toBe(`Lv ${MAX_LEVEL}`);
  });
});

describe("buildPipLevelModel — a mid-level Pip landing partway through a level", () => {
  it("computes xpIntoLevel/progress from the real curve, never negative or over 1", () => {
    const level = 5;
    const thisLevelXp = LEVEL_XP[level - 1] as number;
    const nextLevelXp = LEVEL_XP[level] as number;
    const xp = thisLevelXp + Math.floor((nextLevelXp - thisLevelXp) / 2);
    const pip = makePip({ level, pipXp: xp });
    const model = buildPipLevelModel(pip);
    expect(model.xpIntoLevel).toBe(xp - thisLevelXp);
    expect(model.progress).toBeGreaterThan(0);
    expect(model.progress).toBeLessThan(1);
  });
});

describe("growthLine / nextLevelHint — monotonic, never a number", () => {
  it("accumulates more clauses as level rises, capped at three", () => {
    const l2 = growthLine(makePip({ level: 2 }));
    const l3 = growthLine(makePip({ level: 3 }));
    const l10 = growthLine(makePip({ level: 10 }));
    expect(l2.split(" ").length).toBeGreaterThan(1);
    expect(l3.length).toBeGreaterThanOrEqual(l2.length);
    // Never more than three clauses (three sentences, three periods).
    expect((l10.match(/\./g) ?? []).length).toBeLessThanOrEqual(3);
  });

  it("never prints a percentage or a raw number in the growth line", () => {
    for (let level = 1; level <= MAX_LEVEL; level++) {
      const line = growthLine(makePip({ level }));
      expect(line).not.toMatch(/\d/);
      const hint = nextLevelHint(makePip({ level }));
      // The hint DOES name the level ("Level 4: …") — that's fine, it's a
      // milestone name, not a stat; just confirm it never carries a %.
      if (hint !== null) expect(hint).not.toContain("%");
    }
  });
});

describe("buildLevelChannels — every channel is a strict no-op at level 1", () => {
  it("is the identity for every channel", () => {
    const channels = buildLevelChannels(makePip({ level: 1 }));
    for (const value of Object.values(channels)) expect(value).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// DOM wiring (round-2G review lesson: pure-model tests alone missed real
// wiring bugs — see fakeDom.ts's module doc).
// ---------------------------------------------------------------------------

function baseState(pip: PipState): GameState {
  const game = createNewGame(7, 0);
  return { ...game, pips: { [pip.id]: pip }, rosterOrder: [pip.id], activePipId: pip.id };
}

describe("createPipLevelView — DOM wiring", () => {
  it("is closed until opened, and opening paints the Pip's name and level", () => {
    const dom = installFakeDom();
    try {
      const pip = makePip({ level: 4 });
      const state = baseState(pip);
      const view = createPipLevelView({ getState: () => state });
      const root = view.el as unknown as FakeElement;
      expect(view.isOpen).toBe(false);
      expect(root.querySelector(".pk-growth-wrap--open")).toBeNull();

      view.open(pip.id);
      expect(view.isOpen).toBe(true);
      expect(root.className).toContain("pk-growth-wrap--open");
      expect(root.querySelector(".pk-growth-name")?.textContent).toBe("Mossy");
      expect(root.querySelector(".pk-growth-level")?.textContent).toContain("4");
    } finally {
      dom.uninstall();
    }
  });

  it("is a no-op for an unknown Pip id (defensive — never opens on a dead id)", () => {
    const dom = installFakeDom();
    try {
      const state = baseState(makePip());
      const view = createPipLevelView({ getState: () => state });
      view.open("no-such-pip");
      expect(view.isOpen).toBe(false);
    } finally {
      dom.uninstall();
    }
  });

  it("the detail toggle reveals the channel breakdown only when expanded", () => {
    const dom = installFakeDom();
    try {
      const pip = makePip({ level: 6 });
      const state = baseState(pip);
      const view = createPipLevelView({ getState: () => state });
      const root = view.el as unknown as FakeElement;
      view.open(pip.id);

      expect(root.querySelector(".pk-growth-detail")).toBeNull();
      const toggle = root.querySelector(".pk-growth-expand");
      expect(toggle).not.toBeNull();
      toggle?.click();
      expect(root.querySelector(".pk-growth-detail")).not.toBeNull();
    } finally {
      dom.uninstall();
    }
  });

  it("close() hides the sheet, and the backdrop click does the same", () => {
    const dom = installFakeDom();
    try {
      const pip = makePip();
      const state = baseState(pip);
      const view = createPipLevelView({ getState: () => state });
      const root = view.el as unknown as FakeElement;
      view.open(pip.id);
      view.close();
      expect(view.isOpen).toBe(false);

      view.open(pip.id);
      const backdrop = root.querySelector(".pk-growth-backdrop");
      backdrop?.dispatch("click");
      expect(view.isOpen).toBe(false);
    } finally {
      dom.uninstall();
    }
  });

  it("sync() repaints only while open, and only on a real state change", () => {
    const dom = installFakeDom();
    try {
      const pip = makePip({ level: 2 });
      let state = baseState(pip);
      const view = createPipLevelView({ getState: () => state });
      const root = view.el as unknown as FakeElement;
      view.open(pip.id);

      const bumped = { ...state, pips: { ...state.pips, [pip.id]: { ...pip, level: 3 } } };
      state = bumped;
      view.sync(bumped);
      expect(root.querySelector(".pk-growth-level")?.textContent).toContain("3");
    } finally {
      dom.uninstall();
    }
  });
});
