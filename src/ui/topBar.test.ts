/**
 * Cast-strip controller tests (spec §10 active Pip selector; round 2G's
 * hud-redesign doc §2.7's N1 fix) — the pure helpers only: status glyph
 * mapping (sulking-first, per the standing spec rule), the who-line
 * builder, the lowest-need clause, the alert-ring level, and the
 * aria-label builders. Selector switching itself is a reducer concern,
 * covered by the SET_ACTIVE_PIP tests in core/state.test.ts.
 *
 * ROUND 2G REVIEW: the DOM shell is no longer "untested chrome". See the
 * `createTopBar` block at the bottom of this file for why that framing cost
 * the round two silently-dead features elsewhere.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LifeStage, NEED_IDS, PipActivity } from "../core/pips/types";
import type { PipNeeds, PipState } from "../core/pips/types";
import {
  buildHudWhoLine,
  castChipAlertLevel,
  castChipAriaLabel,
  identitySubtitle,
  createTopBar,
  lowestNeedClause,
  statusGlyph,
} from "./topBar";
import type { GameAction, GameState } from "../core/state";
import { installFakeDom } from "./fakeDom";
import type { FakeDomHandle, FakeElement } from "./fakeDom";

const needs = (overrides: Partial<PipNeeds> = {}): PipNeeds => ({
  hunger: 80,
  cleanliness: 80,
  happiness: 80,
  energy: 80,
  ...overrides,
});

function makePip(overrides: Partial<PipState> = {}): PipState {
  return {
    id: "pip-1",
    speciesId: "mosspip",
    name: "Mosspip",
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
    lastGiftItemId: null,
    expedition: null,
    needsUpdatedAt: 0,
    ...overrides,
  };
}

describe("statusGlyph — tiny selector badges (spec §10)", () => {
  it("badges exactly the away/resting/sulking states", () => {
    expect(statusGlyph(makePip({ activity: PipActivity.OnExpedition }))?.glyph).toBe("»");
    expect(statusGlyph(makePip({ activity: PipActivity.Returning }))?.glyph).toBe("!");
    expect(statusGlyph(makePip({ activity: PipActivity.Resting }))?.glyph).toBe("z");
    expect(statusGlyph(makePip({ activity: PipActivity.Sulking }))?.glyph).toBe("…");
  });

  it("Idle pips carry no badge; working pips wear the basket (spec §6.2)", () => {
    expect(statusGlyph(makePip({ activity: PipActivity.Idle }))).toBeNull();
    expect(statusGlyph(makePip({ activity: PipActivity.AssignedJob }))?.glyph).toBe("🧺");
    expect(statusGlyph(makePip({ activity: PipActivity.AssignedJob }))?.label).toBe(
      "gathering away",
    );
  });

  /**
   * THE N1 REGRESSION TEST (hud-redesign doc §1.6/§2.7 — the "highest-value
   * item" in the round). A Pip can nap through a sulk: `sulking: true` while
   * `activity` still reads "idle" or "resting". `statusGlyph` MUST check
   * `isSulking(pip)` before it ever looks at `pip.activity`, or this Pip
   * gets no badge at all while a DIFFERENT Pip whose bare `activity` happens
   * to equal "sulking" gets one — the same fact, reported inconsistently.
   */
  it("badges sulking EVEN when activity is idle or resting (a Pip can nap through a sulk)", () => {
    const idleButSulking = makePip({ activity: PipActivity.Idle, sulking: true });
    expect(statusGlyph(idleButSulking)?.glyph).toBe("…");
    expect(statusGlyph(idleButSulking)?.label).toBe("sulking");
    expect(statusGlyph(idleButSulking)?.kind).toBe("sulking");

    const restingButSulking = makePip({ activity: PipActivity.Resting, sulking: true });
    expect(statusGlyph(restingButSulking)?.label).toBe("sulking");
  });
});

describe("identitySubtitle — the active pip's one-line readout", () => {
  it("shows just the personality while the pip is around", () => {
    expect(identitySubtitle(makePip())).toBe("Curious");
  });

  it("appends the warm status while away / resting / sulking", () => {
    expect(
      identitySubtitle(makePip({ activity: PipActivity.OnExpedition })),
    ).toBe("Curious — off exploring");
    expect(identitySubtitle(makePip({ activity: PipActivity.Sulking }))).toBe(
      "Curious — sulking",
    );
  });

  it("appends sulking even when napping through it (N1)", () => {
    expect(
      identitySubtitle(makePip({ activity: PipActivity.Resting, sulking: true })),
    ).toBe("Curious — sulking");
  });

  it("falls back to the raw id for an unknown personality", () => {
    expect(identitySubtitle(makePip({ personalityId: "moody" }))).toBe("moody");
  });
});

describe("lowestNeedClause — the who-line's / aria-label's single named need", () => {
  it("is null while every need is comfortable", () => {
    expect(lowestNeedClause(makePip())).toBeNull();
  });

  it("names the lowest need as 'low' between 15 and 40", () => {
    expect(lowestNeedClause(makePip({ needs: needs({ happiness: 30 }) }))).toBe(
      "Happy is low",
    );
  });

  it("names the lowest need as 'empty' below 15", () => {
    expect(lowestNeedClause(makePip({ needs: needs({ cleanliness: 5 }) }))).toBe(
      "Clean is empty",
    );
  });

  it("breaks ties in NEED_IDS order (hunger, cleanliness, happiness, energy)", () => {
    expect(
      lowestNeedClause(makePip({ needs: needs({ happiness: 10, energy: 10 }) })),
    ).toBe("Happy is empty");
  });
});

describe("buildHudWhoLine — the pinned example lines (hud-redesign doc §2.3)", () => {
  // The doc's own examples name "Bold", a personality this registry does not
  // (yet) define (PERSONALITY_IDS: lazy/curious/hardworking/chaotic/clingy —
  // round 2D, still pending, is where a roster expansion like that would
  // land). Substituted with a real id; the assertion is about the FORMAT
  // (name, then "· Personality", nothing else), not this specific word.
  it("Pipsqueak · Hardworking (no status, no low need)", () => {
    const pip = makePip({ name: "Pipsqueak", personalityId: "hardworking" });
    const line = buildHudWhoLine(pip);
    expect(`${line.name} ${line.rest}`).toBe("Pipsqueak · Hardworking");
  });

  it("Marigold · Curious · gathering away · Clean is empty", () => {
    const pip = makePip({
      name: "Marigold",
      personalityId: "curious",
      activity: PipActivity.AssignedJob,
      needs: needs({ cleanliness: 5 }),
    });
    const line = buildHudWhoLine(pip);
    expect(`${line.name} ${line.rest}`).toBe(
      "Marigold · Curious · gathering away · Clean is empty",
    );
  });

  it("Thistledown · Chaotic · sulking · Clean is empty (napping through a sulk — N1)", () => {
    const pip = makePip({
      name: "Thistledown",
      personalityId: "chaotic",
      activity: PipActivity.Idle,
      sulking: true,
      needs: needs({ cleanliness: 5 }),
    });
    const line = buildHudWhoLine(pip);
    expect(`${line.name} ${line.rest}`).toBe(
      "Thistledown · Chaotic · sulking · Clean is empty",
    );
  });

  it("Bramblewick · Lazy · off exploring · Happy is low", () => {
    const pip = makePip({
      name: "Bramblewick",
      personalityId: "lazy",
      activity: PipActivity.OnExpedition,
      needs: needs({ happiness: 30 }),
    });
    const line = buildHudWhoLine(pip);
    expect(`${line.name} ${line.rest}`).toBe(
      "Bramblewick · Lazy · off exploring · Happy is low",
    );
  });
});

describe("castChipAlertLevel — the roster-wide 'does anything need me' ring", () => {
  it("is null while every need is comfortable and the pip isn't sulking", () => {
    expect(castChipAlertLevel(makePip())).toBeNull();
  });

  it("is 'care' once any need drops below 40", () => {
    expect(castChipAlertLevel(makePip({ needs: needs({ energy: 35 }) }))).toBe("care");
  });

  it("is 'urgent' once any need drops below 15", () => {
    expect(castChipAlertLevel(makePip({ needs: needs({ energy: 10 }) }))).toBe("urgent");
  });

  it("is 'urgent' whenever the pip is sulking, however comfortable its needs read (N1)", () => {
    expect(
      castChipAlertLevel(makePip({ activity: PipActivity.Idle, sulking: true })),
    ).toBe("urgent");
  });
});

describe("castChipAriaLabel — extends the shape with mood, status, low need", () => {
  it("matches the redesign doc's worked example", () => {
    const pip = makePip({
      name: "Thistledown",
      activity: PipActivity.Idle,
      sulking: true,
      needs: needs({ cleanliness: 5 }),
    });
    expect(castChipAriaLabel(pip, "miserable", true)).toBe(
      "Thistledown — miserable, sulking, Clean is empty",
    );
  });

  it("appends '. Select' only when the chip isn't the active one", () => {
    const pip = makePip();
    expect(castChipAriaLabel(pip, "content", false)).toBe("Mosspip — content. Select");
    expect(castChipAriaLabel(pip, "content", true)).toBe("Mosspip — content");
  });
});


// ---------------------------------------------------------------------------
// THE STRIP ITSELF — 218 lines of DOM that had no test at all
// ---------------------------------------------------------------------------

/**
 * ROUND 2G REVIEW, the systemic finding behind the two surviving mutations:
 * of the round's five headline DOM factories, only `createLevelUpBanner` and
 * `createRibbon` were exercised by any test. `createTopBar` — the round's
 * headline rewrite — had none, and this file grew by 182 lines in round 2G
 * without acquiring a single `document.` reference.
 *
 * The recommendation was to treat "every DOM factory gets at least one
 * construct-sync-assert test" as this round's gate, the way `layers.test.ts`
 * is the gate for the z-index ladder. This is that test for the cast strip,
 * and it deliberately asserts the things a mutation could quietly delete: the
 * comb heights, the alert ring, the status badge, the tap wiring, and the
 * structural-rebuild key (whose whole purpose is NOT rebuilding, which is
 * exactly the kind of behaviour a "looks fine in the browser" pass misses).
 */
describe("createTopBar — the cast strip", () => {
  let dom: FakeDomHandle;

  beforeEach(() => {
    dom = installFakeDom();
  });
  afterEach(() => {
    dom.uninstall();
  });

  interface Calls {
    dispatched: GameAction[];
    focus: number;
    reveal: number;
  }

  function mount(): {
    readonly bar: ReturnType<typeof createTopBar>;
    readonly root: FakeElement;
    readonly calls: Calls;
  } {
    const calls: Calls = { dispatched: [], focus: 0, reveal: 0 };
    const bar = createTopBar({
      dispatch: (action) => calls.dispatched.push(action),
      openFocus: () => (calls.focus += 1),
      openReveal: () => (calls.reveal += 1),
    });
    const root = bar.el as unknown as FakeElement;
    dom.ui.appendChild(root);
    return { bar, root, calls };
  }

  function stateWith(pips: readonly PipState[], overrides: Partial<GameState> = {}): GameState {
    const byId: Record<string, PipState> = {};
    for (const pip of pips) byId[pip.id] = pip;
    return {
      pips: byId,
      rosterOrder: pips.map((p) => p.id),
      activePipId: pips[0]?.id ?? "",
      pendingReveals: [],
      seed: 42,
      rngState: {},
      ...overrides,
    } as unknown as GameState;
  }

  it("renders one chip per roster pip, each with a four-bar need comb", () => {
    const { bar, root } = mount();
    bar.sync(
      stateWith([
        makePip({ id: "a", name: "Aster" }),
        makePip({ id: "b", name: "Bram" }),
        makePip({ id: "c", name: "Clove" }),
      ]),
    );

    expect(root.querySelectorAll(".pk-castchip")).toHaveLength(3);
    expect(root.querySelectorAll(".pk-comb-fill")).toHaveLength(3 * NEED_IDS.length);
    // The chip width formula keys off this, which is what makes the roster
    // cap fit BY CONSTRUCTION rather than by a special case.
    const cast = root.querySelector(".pk-cast") as FakeElement;
    expect(cast.style.getPropertyValue("--pk-cast-n")).toBe("3");
  });

  it("ROUND 2D — every chip shows the Pip's NAME, not just the active one's", () => {
    // THE fix-stage blocker for this file. The cast strip is the only
    // roster list on screen 100% of the time, and it carried no name, no
    // pattern, no accessory, no silhouette and no jitter — so twelve Pips
    // with twelve different accessories rendered as twelve identical
    // chips, and two same-palette Pips of one species were
    // indistinguishable. `title` is hover-only and this game targets
    // 430x932 mobile, so there was literally no way to identify a chip
    // except by tapping it.
    const { bar, root } = mount();
    bar.sync(
      stateWith([
        makePip({ id: "a", name: "Aster" }),
        makePip({ id: "b", name: "Bram" }),
        makePip({ id: "c", name: "Clove" }),
      ]),
    );
    const labels = root.querySelectorAll(".pk-castchip-name").map((el) => el.textContent);
    expect(labels).toEqual(["Aster", "Bram", "Clove"]);
  });

  it("ROUND 2D — a rename updates the chip label AND its tooltip", () => {
    // The structural rebuild key used to be `id|speciesId|palette`, so a
    // rename left the chip's tooltip showing the old name indefinitely
    // while the who-line and aria-label updated correctly.
    const { bar, root } = mount();
    bar.sync(stateWith([makePip({ id: "a", name: "Bracken" })]));
    expect(root.querySelector(".pk-castchip-name")?.textContent).toBe("Bracken");
    bar.sync(stateWith([makePip({ id: "a", name: "Thistledown" })]));
    expect(root.querySelector(".pk-castchip-name")?.textContent).toBe("Thistledown");
    expect(root.querySelector(".pk-castchip")?.title).toBe("Thistledown");
  });

  it("ROUND 2D — chips render the worn accessory and the pattern, so same-palette Pips differ", () => {
    const { bar, root } = mount();
    const twin = (id: string, accessoryId: string | null, pattern: string): PipState => {
      const base = makePip({ id, name: id });
      return {
        ...base,
        genome: { ...base.genome, accessoryId, pattern },
      } as PipState;
    };
    bar.sync(
      stateWith([
        twin("a", "leafcap", "plain"),
        twin("b", "scarf", "speckled"),
        twin("c", null, "swirl"),
      ]),
    );
    // Same species, same palette — the accessory and pattern are the only
    // things telling these three apart.
    expect(root.querySelectorAll(".pk-pipdex-accessory--leafcap")).toHaveLength(1);
    expect(root.querySelectorAll(".pk-pipdex-accessory--scarf")).toHaveLength(1);
    expect(root.querySelectorAll(".pk-pipdex-accessory")).toHaveLength(2);
    const patternClasses = root
      .querySelectorAll(".pk-pipdex-blob")
      .map((el) => el.className.split(" ").find((c) => c.startsWith("pk-pipdex-blob--pattern-")));
    expect(new Set(patternClasses).size).toBe(3);
  });

  it("ROUND 2D — chips carry per-individual jitter, so identical genomes still differ", () => {
    const { bar, root } = mount();
    bar.sync(
      stateWith([makePip({ id: "pip-1", name: "One" }), makePip({ id: "pip-2", name: "Two" })]),
    );
    const portraits = root.querySelectorAll(".pk-pipdex-portrait");
    expect(portraits).toHaveLength(2);
    const read = (el: FakeElement): string =>
      ["--pk-jw", "--pk-jh", "--pk-jgap", "--pk-jeye-w"]
        .map((n) => el.style.getPropertyValue(n))
        .join("|");
    expect(read(portraits[0] as FakeElement)).not.toBe(read(portraits[1] as FakeElement));
  });

  it("an empty need paints a visible 1% slot, never a missing bar", () => {
    const { bar, root } = mount();
    bar.sync(stateWith([makePip({ id: "a", needs: needs({ cleanliness: 0 }) })]));

    const fills = root.querySelectorAll(".pk-comb-fill");
    const cleanlinessAt = NEED_IDS.indexOf("cleanliness");
    expect(fills[cleanlinessAt]?.style.getPropertyValue("height")).toBe("1%");
    expect(fills[NEED_IDS.indexOf("hunger")]?.style.getPropertyValue("height")).toBe("80%");
  });

  it("tapping an INACTIVE chip selects that pip; tapping the ACTIVE one opens the focus view", () => {
    const { bar, root, calls } = mount();
    bar.sync(stateWith([makePip({ id: "a" }), makePip({ id: "b" })]));

    const chips = root.querySelectorAll(".pk-castchip");
    chips[1]?.click();
    expect(calls.dispatched).toEqual([{ type: "SET_ACTIVE_PIP", pipId: "b" }]);
    expect(calls.focus).toBe(0);

    chips[0]?.click(); // "a" is the active pip
    expect(calls.focus).toBe(1);
    expect(calls.dispatched).toHaveLength(1);
  });

  it("the who-line is a button that opens the focus view, and names the active pip", () => {
    const { bar, root, calls } = mount();
    bar.sync(stateWith([makePip({ id: "a", name: "Aster" })]));

    const who = root.querySelector(".pk-hud-who") as FakeElement;
    expect(who.textContent).toContain("Aster");
    expect(who.getAttribute("aria-label")).toBe("Aster, Curious — open details");
    who.click();
    expect(calls.focus).toBe(1);
  });

  it("a Pip sulking through a nap gets the badge, the urgent ring and the words (N1)", () => {
    const { bar, root } = mount();
    // The exact shape the spec rule exists for: `sulking: true` while
    // `activity` reads something else entirely.
    bar.sync(
      stateWith([
        makePip({ id: "a", name: "Thistledown", activity: PipActivity.Idle, sulking: true }),
      ]),
    );

    const chip = root.querySelector(".pk-castchip") as FakeElement;
    expect(chip.classList.contains("pk-castchip--urgent")).toBe(true);
    expect(chip.getAttribute("aria-label")).toContain("sulking");
    expect((root.querySelector(".pk-chip-status") as FakeElement).textContent).toBe("…");
    expect((root.querySelector(".pk-hud-who") as FakeElement).textContent).toContain("sulking");
  });

  it("drops the status badge again when the state that earned it clears", () => {
    const { bar, root } = mount();
    bar.sync(stateWith([makePip({ id: "a", activity: PipActivity.Resting })]));
    expect(root.querySelectorAll(".pk-chip-status")).toHaveLength(1);

    bar.sync(stateWith([makePip({ id: "a", activity: PipActivity.Idle })]));
    expect(root.querySelectorAll(".pk-chip-status")).toHaveLength(0);
  });

  it("the reveal chip appears only with pending reveals, OUTSIDE .pk-cast so nothing reflows (N5)", () => {
    const { bar, root, calls } = mount();
    const pips = [makePip({ id: "a" }), makePip({ id: "b" })];
    bar.sync(stateWith(pips));
    expect(root.querySelectorAll(".pk-hud-alert")).toHaveLength(0);

    bar.sync(
      stateWith(pips, {
        pendingReveals: [{ pipId: "a" }, { pipId: "b" }] as unknown as GameState["pendingReveals"],
      }),
    );
    const alert = root.querySelector(".pk-hud-alert") as FakeElement;
    expect(alert.textContent).toBe("!2");
    // A returning Pip must never shove every other portrait sideways.
    expect((root.querySelector(".pk-cast") as FakeElement).children).toHaveLength(2);
    expect(alert.parentNode?.className).toContain("pk-cast-row");

    alert.click();
    expect(calls.reveal).toBe(1);
  });

  it("live-updates needs WITHOUT rebuilding the chips — the comb's transition must not restart every tick", () => {
    const { bar, root } = mount();
    bar.sync(stateWith([makePip({ id: "a" })]));
    const before = root.querySelector(".pk-castchip");

    bar.sync(stateWith([makePip({ id: "a", needs: needs({ hunger: 12 }) })]));
    expect(root.querySelector(".pk-castchip")).toBe(before); // same node
    expect(root.querySelector(".pk-comb-fill")?.style.getPropertyValue("height")).toBe("12%");
    expect(before?.classList.contains("pk-castchip--urgent")).toBe(true);
  });

  it("rebuilds when the roster's SHAPE changes", () => {
    const { bar, root } = mount();
    bar.sync(stateWith([makePip({ id: "a" })]));
    expect(root.querySelectorAll(".pk-castchip")).toHaveLength(1);

    bar.sync(stateWith([makePip({ id: "a" }), makePip({ id: "b" })]));
    expect(root.querySelectorAll(".pk-castchip")).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// ROUND 2H — the cast strip answers "does anything need me" (spec §16 v1.5).
//
// The strip is the ONE surface on screen at all times, so it is where promise
// 1 ("loss is never a surprise") either holds or quietly fails: a Pip on a
// countdown the player never sees is precisely the surprise the promise
// forbids. These pin the ordering, not just the presence.
// ---------------------------------------------------------------------------

describe("ROUND 2H — an ailing Pip on the cast strip", () => {
  const ailing = (overrides: Partial<PipState> = {}): PipState =>
    makePip({
      ailment: {
        id: "brambleburr",
        contractedAt: 0,
        fromExpeditionId: "bramblewick",
        remainingMs: 10 * 60 * 60 * 1000,
        totalMs: 48 * 60 * 60 * 1000,
        cureAttempts: 0,
      },
      ...overrides,
    });

  it("wears the poorly badge", () => {
    expect(statusGlyph(ailing())?.kind).toBe("ailing");
    expect(statusGlyph(ailing())?.label).toBe("poorly");
  });

  it("reports POORLY ahead of sulking, resting, gathering or a trail", () => {
    // The N1 rule this file already enforces for sulking, one notch up: a
    // Pip can be poorly AND doing any of these, and reporting the other
    // thing would hide the only status with a countdown attached.
    expect(statusGlyph(ailing({ sulking: true }))?.kind).toBe("ailing");
    expect(
      statusGlyph(ailing({ activity: PipActivity.Sulking }))?.kind,
    ).toBe("ailing");
    for (const activity of [
      PipActivity.Resting,
      PipActivity.AssignedJob,
      PipActivity.OnExpedition,
      PipActivity.Returning,
      PipActivity.Idle,
    ]) {
      expect(statusGlyph(ailing({ activity }))?.kind, activity).toBe("ailing");
    }
  });

  it("rings urgent even with every need full", () => {
    // A Pip fed to 100 can still be poorly. If the ring keyed off needs
    // alone, the one Pip on a clock would be the calmest chip on screen.
    expect(castChipAlertLevel(makePip())).toBeNull();
    expect(castChipAlertLevel(ailing())).toBe("urgent");
  });

  // THE BUG THIS ROUND ACTUALLY SHIPPED, caught in the browser and not by
  // any test: `core/pips/ailment.ts` writes an explicit `ailment: null` on a
  // cure (a Pip who has never been ill has `undefined` instead). A check
  // written as `!== undefined` therefore left a CURED Pip wearing the
  // "poorly" badge and an urgent ring forever — the player pays a poultice,
  // watches the cure land, and the HUD keeps insisting something is wrong.
  it("drops the badge and the ring the instant a cure lands (ailment: null, not undefined)", () => {
    const cured = makePip({ ailment: null, scars: ["brambleburr"] });
    expect(statusGlyph(cured)).toBeNull();
    expect(castChipAlertLevel(cured)).toBeNull();
    // ...and the same Pip mid-nap or mid-sulk falls back to reporting THAT,
    // rather than staying stuck on the healed ailment.
    expect(
      statusGlyph(makePip({ ailment: null, activity: PipActivity.Resting }))?.kind,
    ).toBe("resting");
  });

  it("leaves a healthy Pip's badge and ring exactly as they were", () => {
    // The 2H clause is additive: no `ailment` field, no behaviour change.
    expect(statusGlyph(makePip({ activity: PipActivity.Resting }))?.kind).toBe(
      "resting",
    );
    expect(statusGlyph(makePip({ activity: PipActivity.Idle }))).toBeNull();
    expect(castChipAlertLevel(makePip({ sulking: true }))).toBe("urgent");
  });
});
