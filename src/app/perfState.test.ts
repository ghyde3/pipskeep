import { describe, expect, it } from "vitest";
import {
  buildPerfState,
  decorationFootprint,
  PERF_DECORATION_COUNT,
  PERF_PIP_COUNT,
} from "./perfState";
import { gridBounds } from "../core/keep";
import { PipActivity } from "../core/pips/types";
import { decorations } from "../content/decorations";

describe("perfState — the spec §1 budget scenario, forever", () => {
  it("is exactly 5 pips + 30 decorations", () => {
    const state = buildPerfState();
    expect(PERF_PIP_COUNT).toBe(5);
    expect(PERF_DECORATION_COUNT).toBe(30);
    expect(state.rosterOrder).toHaveLength(5);
    expect(Object.keys(state.pips)).toHaveLength(5);
    expect(Object.keys(state.keep.placements)).toHaveLength(30);
  });

  it("every pip is Idle (all five wander — the 'animated' in the budget)", () => {
    const state = buildPerfState();
    for (const id of state.rosterOrder) {
      expect(state.pips[id]?.activity).toBe(PipActivity.Idle);
    }
    expect(state.activePipId).toBe(state.rosterOrder[0]);
  });

  it("every placement uses a real decoration id from the registry", () => {
    const state = buildPerfState();
    const known = new Set(decorations.map((d) => d.id));
    for (const placement of Object.values(state.keep.placements)) {
      expect(known.has(placement.itemId)).toBe(true);
    }
  });

  it("all footprints are in the level-1 grid and never overlap", () => {
    const state = buildPerfState();
    const bounds = gridBounds(1);
    const occupied = new Set<string>();
    for (const placement of Object.values(state.keep.placements)) {
      const fp = decorationFootprint(placement.itemId);
      for (let dy = 0; dy < fp.h; dy++) {
        for (let dx = 0; dx < fp.w; dx++) {
          const tx = placement.x + dx;
          const ty = placement.y + dy;
          expect(tx).toBeGreaterThanOrEqual(0);
          expect(ty).toBeGreaterThanOrEqual(0);
          expect(tx).toBeLessThan(bounds.cols);
          expect(ty).toBeLessThan(bounds.rows);
          const key = `${tx},${ty}`;
          expect(occupied.has(key), `tile ${key} placed twice`).toBe(false);
          occupied.add(key);
        }
      }
    }
    // Wander room: pips need free tiles to roam between.
    expect(occupied.size).toBeLessThan(bounds.cols * bounds.rows);
  });

  it("is deterministic — same synthetic state every run", () => {
    expect(buildPerfState()).toEqual(buildPerfState());
  });

  it("rejects unknown decoration ids in the footprint lookup", () => {
    expect(() => decorationFootprint("nonsense-item")).toThrow(/unknown decoration/);
  });
});
