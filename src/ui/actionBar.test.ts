/**
 * ROUND 2F — THE DAY-2 CARE BAR (the pure half).
 *
 * Measured on a 14h and a 20h return with a Pip clocked in at the Gathering
 * Station: Feed / Clean / Play / Pet / Rest all disabled at opacity 0.45, with
 * no explanation on the bar and no tap affordance. The header read "Pip1 —
 * Lazy — gathering away" but the greyed buttons said nothing, so the tap count
 * from cold open to a care action was THREE — "Come in", then another Pip's
 * portrait in the roster strip (discoverable only by tapping a dead button and
 * getting nothing), then Feed.
 *
 * Staffing a station before you close the app is the behaviour the game
 * teaches, so this is the DEFAULT day-2 state, not an edge case. Both halves of
 * the fix are pure functions and both are pinned here; the pill itself is dumb
 * DOM around them (the topBar.test.ts convention).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LifeStage, PipActivity } from "../core/pips/types";
import type { PipNeeds, PipState } from "../core/pips/types";
import { createNewGame } from "../core/state";
import type { GameState } from "../core/state";
import {
  ACTION_ARIA_LABELS,
  careUnavailableReason,
  createActionBar,
  firstCareablePipId,
  firstStockedFoodId,
} from "./actionBar";
import { tuning } from "../content/tuning";
import { installFakeDom } from "./fakeDom";
import type { FakeDomHandle, FakeElement } from "./fakeDom";

const T0 = 1_000_000;

const needs = (overrides: Partial<PipNeeds> = {}): PipNeeds => ({
  hunger: 70,
  cleanliness: 70,
  happiness: 70,
  energy: 70,
  ...overrides,
});

function makePip(id: string, overrides: Partial<PipState> = {}): PipState {
  return {
    id,
    speciesId: "mosspip",
    name: id === "pip-1" ? "Mossy" : "Fern",
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
    needs: needs(),
    activity: PipActivity.Idle,
    pendingSulk: false,
    readyToEvolve: false,
    evolved: null,
    ...overrides,
  } as PipState;
}

/** A two-Pip roster, so "switch to someone free" has somewhere to go. */
function roster(
  activeActivity: PipActivity,
  otherActivity: PipActivity = PipActivity.Idle,
): GameState {
  const base = createNewGame(7, T0);
  return {
    ...base,
    activePipId: "pip-1",
    rosterOrder: ["pip-1", "pip-2"],
    pips: {
      "pip-1": makePip("pip-1", { activity: activeActivity }),
      "pip-2": makePip("pip-2", { activity: otherActivity }),
    },
  };
}

describe("careUnavailableReason — says WHY the bar is grey, warmly", () => {
  it("is null when the Pip can be cared for (Idle)", () => {
    expect(careUnavailableReason(makePip("pip-1"))).toBeNull();
  });

  it("is null while Resting — a napping Pip can still be fussed over", () => {
    expect(
      careUnavailableReason(makePip("pip-1", { activity: PipActivity.Resting })),
    ).toBeNull();
  });

  it("names WORKING — the default day-2 state, and the one that used to say nothing", () => {
    expect(
      careUnavailableReason(makePip("pip-1", { activity: PipActivity.AssignedJob })),
    ).toBe("Mossy is busy working.");
  });

  it("names the trail while OnExpedition", () => {
    expect(
      careUnavailableReason(makePip("pip-1", { activity: PipActivity.OnExpedition })),
    ).toBe("Mossy is out on the trail.");
  });

  it("names the way home while Returning", () => {
    expect(
      careUnavailableReason(makePip("pip-1", { activity: PipActivity.Returning })),
    ).toBe("Mossy is on the way home.");
  });

  it("never blames the player — no reason contains 'you' or a scolding word", () => {
    for (const activity of [
      PipActivity.AssignedJob,
      PipActivity.OnExpedition,
      PipActivity.Returning,
    ]) {
      const why = careUnavailableReason(makePip("pip-1", { activity })) ?? "";
      expect(why.length).toBeGreaterThan(8);
      expect(why.toLowerCase()).not.toMatch(/\byou\b|should|forgot|failed|neglect/);
    }
  });
});

describe("firstCareablePipId — the one-tap way out", () => {
  it("finds a free Pip while the active one is working", () => {
    expect(firstCareablePipId(roster(PipActivity.AssignedJob))).toBe("pip-2");
  });

  it("never returns the ACTIVE Pip, even when that Pip is free", () => {
    expect(firstCareablePipId(roster(PipActivity.Idle))).toBe("pip-2");
    const soloIdle = roster(PipActivity.Idle, PipActivity.OnExpedition);
    expect(firstCareablePipId(soloIdle)).toBeNull();
  });

  it("is null when EVERY other Pip is also busy — the pill then just explains", () => {
    expect(
      firstCareablePipId(roster(PipActivity.AssignedJob, PipActivity.OnExpedition)),
    ).toBeNull();
  });

  it("respects roster ORDER, not object key order", () => {
    const state = roster(PipActivity.AssignedJob);
    const reordered: GameState = { ...state, rosterOrder: ["pip-2", "pip-1"] };
    expect(firstCareablePipId(reordered)).toBe("pip-2");
  });

  it("a Resting Pip counts as available (care is legal while napping)", () => {
    expect(
      firstCareablePipId(roster(PipActivity.AssignedJob, PipActivity.Resting)),
    ).toBe("pip-2");
  });

  it("a single-Pip roster has nowhere to switch", () => {
    const base = createNewGame(7, T0);
    const solo: GameState = {
      ...base,
      activePipId: "pip-1",
      rosterOrder: ["pip-1"],
      pips: { "pip-1": makePip("pip-1", { activity: PipActivity.AssignedJob }) },
    };
    expect(firstCareablePipId(solo)).toBeNull();
  });
});

describe("firstStockedFoodId — unchanged, pinned alongside", () => {
  it("returns null on an empty satchel and the first stocked food otherwise", () => {
    const base = createNewGame(7, T0);
    expect(firstStockedFoodId({ ...base, inventory: {} })).toBeNull();
    expect(firstStockedFoodId({ ...base, inventory: { berry: 2 } })).toBe("berry");
  });
});

/**
 * ROUND 2G REVIEW — THE COOLDOWN STATE, WHICH NOTHING RENDERED LEGIBLY AND
 * NOTHING ANNOUNCED AT ALL.
 *
 * Three visual states shipped with no legend and two of them shared a look:
 * ready (full opacity), cooling down (`opacity: 0.45`, a partial ring, a 9px
 * number), and unavailable (`opacity: 0.45`, nothing). Composited over the
 * bar's translucent cream the countdown digits came out at ~2.26 : 1 — a "47"
 * and a "21" both photographed as grey smudges — and nothing said what 47 was
 * a count OF: no unit, no "s".
 *
 * Assistive tech got less than that. `.pk-ring` is `aria-hidden="true"`, so a
 * screen-reader user was told "Clean this Pip", that it was disabled, and
 * nothing whatsoever about the wait. The contrast half of the fix is in
 * ui.css (a cooling-down button stops being faded, so its digits can carry
 * their own contrast); this pins the half that lives in TypeScript.
 */
describe("createActionBar — the cooldown states say what they are", () => {
  let dom: FakeDomHandle;

  beforeEach(() => {
    dom = installFakeDom();
  });
  afterEach(() => {
    dom.uninstall();
  });

  const CLEAN_COOLDOWN = tuning.care.clean.cooldownMs;

  function mount(state: GameState): {
    readonly bar: ReturnType<typeof createActionBar>;
    readonly root: FakeElement;
  } {
    let now = T0;
    const bar = createActionBar({
      dispatch: () => {},
      getState: () => state,
      clock: { now: () => now },
      openItems: () => {},
    });
    const root = bar.el as unknown as FakeElement;
    dom.ui.appendChild(root);
    bar.sync(state);
    bar.tick(now);
    return { bar, root };
  }

  const cleanButton = (root: FakeElement): FakeElement =>
    root.querySelectorAll(".pk-action").find((el) => el.getAttribute("aria-label")?.includes("Clean")) as FakeElement;

  it("a cooling-down button carries the wait in its accessible name, not just in a hidden ring", () => {
    const base = roster(PipActivity.Idle);
    const state: GameState = {
      ...base,
      cooldowns: { "pip-1": { clean: T0 - (CLEAN_COOLDOWN - 47_000) } },
    } as GameState;
    const { root } = mount(state);

    const clean = cleanButton(root);
    expect(clean.disabled).toBe(true);
    expect(clean.classList.contains("pk-action--cooldown")).toBe(true);
    expect(clean.getAttribute("aria-label")).toBe("Clean this Pip — ready in 47 seconds");
  });

  it("the visible countdown carries its unit — '47' alone names no quantity", () => {
    const base = roster(PipActivity.Idle);
    const state: GameState = {
      ...base,
      cooldowns: { "pip-1": { clean: T0 - (CLEAN_COOLDOWN - 47_000) } },
    } as GameState;
    const { root } = mount(state);
    const ring = cleanButton(root).querySelector(".pk-ring-text") as FakeElement;
    expect(ring.textContent).toBe("47s");
  });

  it("says 'second', singular, on the last tick", () => {
    const base = roster(PipActivity.Idle);
    const state: GameState = {
      ...base,
      cooldowns: { "pip-1": { clean: T0 - (CLEAN_COOLDOWN - 900) } },
    } as GameState;
    const { root } = mount(state);
    expect(cleanButton(root).getAttribute("aria-label")).toBe(
      "Clean this Pip — ready in 1 second",
    );
  });

  it("restores the plain label once the cooldown clears — the wait must not stick", () => {
    const base = roster(PipActivity.Idle);
    const state: GameState = {
      ...base,
      cooldowns: { "pip-1": { clean: T0 - (CLEAN_COOLDOWN - 5_000) } },
    } as GameState;
    const bar = createActionBar({
      dispatch: () => {},
      getState: () => state,
      clock: { now: () => T0 },
      openItems: () => {},
    });
    const root = bar.el as unknown as FakeElement;
    dom.ui.appendChild(root);
    bar.sync(state);
    bar.tick(T0);
    expect(cleanButton(root).getAttribute("aria-label")).toContain("ready in");

    bar.tick(T0 + CLEAN_COOLDOWN);
    const clean = cleanButton(root);
    expect(clean.getAttribute("aria-label")).toBe(ACTION_ARIA_LABELS.clean);
    expect(clean.classList.contains("pk-action--cooldown")).toBe(false);
    expect((clean.querySelector(".pk-ring-text") as FakeElement).textContent).toBe("");
  });

  it("an UNAVAILABLE button is a different state from a cooling-down one, and wears no countdown", () => {
    // The legend the three states were missing: away ≠ waiting.
    const { root } = mount(roster(PipActivity.OnExpedition));
    const clean = cleanButton(root);
    expect(clean.disabled).toBe(true);
    expect(clean.classList.contains("pk-action--cooldown")).toBe(false);
    expect(clean.getAttribute("aria-label")).toBe(ACTION_ARIA_LABELS.clean);
    // …and the reason pill explains it, rather than the bar going mute.
    const reason = root.querySelector(".pk-actionbar-reason") as FakeElement;
    expect(reason.hidden).toBe(false);
    expect(reason.textContent.length).toBeGreaterThan(0);
  });
});
