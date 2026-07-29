/**
 * The musicality guards: per-slot cooldowns and the global voice cap.
 * Pure bookkeeping, so these tests need neither an AudioContext nor time.
 */

import { describe, expect, it } from "vitest";
import { createVoiceBudget, DEFAULT_MAX_VOICES } from "./budget";

describe("cooldowns — the anti machine-gun rule", () => {
  it("allows a slot that has never played", () => {
    const budget = createVoiceBudget();
    expect(budget.canPlay("ui.tap", 0, 0.05)).toBe(true);
  });

  it("refuses a repeat inside the cooldown and allows it exactly after", () => {
    const budget = createVoiceBudget();
    budget.commit("ui.tap", 1, 1.1, 1);
    expect(budget.canPlay("ui.tap", 1.02, 0.05)).toBe(false);
    expect(budget.canPlay("ui.tap", 1.049, 0.05)).toBe(false);
    expect(budget.canPlay("ui.tap", 1.05, 0.05)).toBe(true);
  });

  it("tracks slots independently — a tap never gags a hatch", () => {
    const budget = createVoiceBudget();
    budget.commit("ui.tap", 1, 1.1, 1);
    expect(budget.canPlay("egg.hatch", 1.001, 1)).toBe(true);
  });

  it("survives the audio clock restarting (a rebuilt context)", () => {
    const budget = createVoiceBudget();
    budget.commit("ui.tap", 40, 40.1, 1);
    // New context → currentTime back near zero. Without this the slot
    // would stay locked out for forty seconds.
    expect(budget.canPlay("ui.tap", 0.2, 0.05)).toBe(true);
  });
});

describe("voice cap — the anti-mud rule", () => {
  it("counts only voices still ringing", () => {
    const budget = createVoiceBudget(10);
    budget.commit("a", 0, 0.5, 4);
    budget.commit("b", 0, 2, 3);
    expect(budget.activeVoices(0.1)).toBe(7);
    expect(budget.activeVoices(0.6)).toBe(3); // the first cue finished
    expect(budget.activeVoices(2.1)).toBe(0);
  });

  it("refuses a normal cue that would overflow the cap", () => {
    const budget = createVoiceBudget(6);
    budget.commit("a", 0, 1, 5);
    expect(budget.hasRoom(0.1, 1, 1)).toBe(true);
    expect(budget.hasRoom(0.1, 2, 1)).toBe(false);
  });

  it("lets priority-2 moments through regardless — a hatch is never eaten by chatter", () => {
    const budget = createVoiceBudget(4);
    budget.commit("chatter", 0, 5, 4);
    expect(budget.hasRoom(0.1, 8, 1)).toBe(false);
    expect(budget.hasRoom(0.1, 8, 2)).toBe(true);
  });

  it("frees the cap again once the pile-up has rung out", () => {
    const budget = createVoiceBudget(4);
    budget.commit("a", 0, 0.4, 4);
    expect(budget.hasRoom(0.1, 1, 1)).toBe(false);
    expect(budget.hasRoom(0.5, 1, 1)).toBe(true);
  });

  it("reset() forgets cooldowns and bookings", () => {
    const budget = createVoiceBudget(4);
    budget.commit("a", 0, 10, 4);
    budget.reset();
    expect(budget.activeVoices(0.1)).toBe(0);
    expect(budget.canPlay("a", 0.001, 5)).toBe(true);
  });

  it("ships a sane default cap", () => {
    expect(DEFAULT_MAX_VOICES).toBeGreaterThanOrEqual(8);
    expect(DEFAULT_MAX_VOICES).toBeLessThanOrEqual(48);
  });
});
