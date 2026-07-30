/**
 * THE CHRONICLE (progression bible §2, Keep tier 9) — pure model tests.
 *
 * The reason this file exists at all: tier 9's headline named the Chronicle
 * across three surfaces (the ladder, the level-up banner, the tier copy) and
 * nothing implemented it. These tests pin the two things that make the
 * headline honest — it is LOCKED below tier 9 and it actually lists what the
 * Keep has done, dated, above it.
 */

import { describe, expect, it } from "vitest";
import { buildChronicleModel, CHRONICLE_KEEP_LEVEL } from "./chronicle";
import type { MilestoneDef } from "../content/milestones";
import { MILESTONES } from "../content/milestones";
import type { GameState } from "../core/state";

type Slice = Pick<GameState, "milestones" | "keep" | "keepXp">;

const DAY = 86_400_000;

function slice(
  level: number,
  earned: Record<string, number>,
  keepXp = 1234,
): Slice {
  return {
    milestones: { earned, pending: [] } as unknown as GameState["milestones"],
    keep: { level, placements: {} } as unknown as GameState["keep"],
    keepXp,
  };
}

const registry: readonly MilestoneDef[] = [
  {
    id: "alpha",
    name: "The first day",
    blurb: "It began.",
    metric: { kind: "counter", counterId: "careActions" },
    threshold: 1,
    reward: { kind: "none" },
    xp: 15,
  },
  {
    id: "beta",
    name: "The second day",
    blurb: "It continued.",
    metric: { kind: "counter", counterId: "careActions" },
    threshold: 2,
    reward: { kind: "none" },
    xp: 30,
  },
];

describe("buildChronicleModel — the tier-9 gate", () => {
  it("is LOCKED below Keep tier 9, with copy that grows toward it rather than scolding", () => {
    for (let level = 1; level < CHRONICLE_KEEP_LEVEL; level++) {
      const model = buildChronicleModel(slice(level, { alpha: DAY }), registry);
      expect(model.unlocked, `level ${level}`).toBe(false);
      expect(model.lockLabel).toContain(`Keep level ${CHRONICLE_KEEP_LEVEL}`);
      expect(model.lockLabel).toContain("grow toward");
    }
  });

  it("unlocks exactly AT tier 9 and stays unlocked above it", () => {
    for (const level of [9, 10, 11, 12]) {
      expect(buildChronicleModel(slice(level, {}), registry).unlocked).toBe(true);
    }
  });

  it("the gate matches the tier that content actually advertises", () => {
    // If someone re-spreads the ladder, this catches the Chronicle's own
    // headline drifting away from the tier that opens it.
    expect(CHRONICLE_KEEP_LEVEL).toBe(9);
  });
});

describe("buildChronicleModel — the page itself", () => {
  it("lists earned milestones NEWEST FIRST, each with its own date", () => {
    const model = buildChronicleModel(
      slice(9, { alpha: DAY, beta: 5 * DAY }),
      registry,
    );
    expect(model.entries.map((e) => e.id)).toEqual(["beta", "alpha"]);
    expect(model.entries[0]?.name).toBe("The second day");
    expect(model.entries[0]?.dateLabel).toMatch(/^\d{1,2} [A-Z][a-z]{2} \d{4}$/);
    expect(model.entries[0]?.dateLabel).not.toBe(model.entries[1]?.dateLabel);
  });

  it("orders ties by id so two milestones earned on one dispatch render stably", () => {
    const a = buildChronicleModel(slice(9, { beta: DAY, alpha: DAY }), registry);
    const b = buildChronicleModel(slice(9, { alpha: DAY, beta: DAY }), registry);
    expect(a.entries.map((e) => e.id)).toEqual(["alpha", "beta"]);
    expect(a.entries.map((e) => e.id)).toEqual(b.entries.map((e) => e.id));
  });

  it("carries each entry's XP and the lifetime total, so the page shows what it all paid", () => {
    const model = buildChronicleModel(slice(9, { alpha: DAY }, 4321), registry);
    expect(model.entries[0]?.xp).toBe(15);
    expect(model.keepXp).toBe(4321);
    expect(model.countLabel).toBe("1 of 2 written");
  });

  it("renders a milestone whose id has left the registry rather than dropping the row", () => {
    // Spec §4.4's "never punish the player" applies to their own record: a
    // content edit must not erase history they earned.
    const model = buildChronicleModel(slice(9, { "retired-id": DAY }), registry);
    expect(model.entries).toHaveLength(1);
    expect(model.entries[0]?.name).toBe("retired-id");
    expect(model.entries[0]?.xp).toBe(0);
  });

  it("is empty, not broken, on a Keep that has earned nothing", () => {
    const model = buildChronicleModel(slice(9, {}), registry);
    expect(model.entries).toEqual([]);
    expect(model.countLabel).toBe("0 of 2 written");
  });

  it("works against the REAL milestone registry (no fixture-only assumptions)", () => {
    const real = MILESTONES[0]!;
    const model = buildChronicleModel(slice(9, { [real.id]: DAY }));
    expect(model.entries[0]?.name).toBe(real.name);
    expect(model.entries[0]?.blurb).toBe(real.blurb);
    expect(model.countLabel).toBe(`1 of ${MILESTONES.length} written`);
  });
});
