/**
 * PATTERN (and, round 2D, ACCESSORY) PARITY GUARD.
 *
 * A pip's pattern is drawn THREE separate times by three unrelated
 * implementations: the Pixi scene (render/spriteResolver.ts, a real
 * spiral/dot/band drawing), the focus-view DOM portrait (ui.css
 * `.pk-portrait-blob--<pattern>`), and the Album's DOM portrait
 * (pipdex.css `.pk-pipdex-blob--pattern-<pattern>`).
 *
 * That triplication is how they drifted: `swirl` shipped as a real spiral in
 * the scene but as a full-body `repeating-conic-gradient` in BOTH stylesheets,
 * which renders as a STARBURST across the pip's face — reported by the owner
 * in the Album and visible in the focus view too. Round 2B also added six new
 * pattern primitives, any of which could have been added to the resolver and
 * silently forgotten in one or both stylesheets.
 *
 * These tests cannot judge whether a pattern looks *right* — that needs eyes.
 * What they can do is make a MISSING or ORPHANED implementation impossible, so
 * a new content pattern can never render as a blank portrait in one surface
 * while looking fine in another.
 *
 * ROUND 2D (docs/BACKLOG.md "Round 2D" item 3) extends this exact discipline
 * to the new worn-accessory layer, which is drawn by the SAME three
 * implementations (render/spriteResolver.ts's `drawAccessory`, ui.css's
 * `.pk-portrait-accessory--<id>`, pipdex.css's `.pk-pipdex-accessory--<id>`)
 * for exactly the reason this file exists: a fourth new visual layer is a
 * fourth new chance to author a CSS rule nothing emits, or emit a class
 * nothing styles.
 */

import { describe, expect, it } from "vitest";
import { species } from "../content/species";
import { albumPatternClassSuffix, albumAccessoryClassSuffix, buildPortraitEl } from "./pipdex";
import { focusAccessoryClassSuffix, createFocusView } from "./focusView";
import { ACCESSORY_IDS, NO_ACCESSORY_ID } from "../content/accessories";
import { createNewGame } from "../core/state";
import type { GameState } from "../core/state";
import { installFakeDom } from "./fakeDom";
import type { FakeElement } from "./fakeDom";
// `?raw` (declared by vite/client, already in tsconfig's "types") loads the
// file as a plain string through Vite/Vitest's own pipeline — no Node `fs`
// needed, so this stays inside the project's dependency allowlist (no
// `@types/node`, CLAUDE.md rule #2).
import uiCss from "./ui.css?raw";
import pipdexCss from "./pipdex.css?raw";

/** Declarations only. Without this, the starburst check below matches the
 * comment that EXPLAINS the starburst bug and fails on its own docs. */
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Every pattern id any species can actually roll (content is the source of
 * truth — a pattern nothing uses does not need a portrait rule). */
const contentPatterns = [
  ...new Set(Object.values(species).flatMap((s) => s.sprite.patterns)),
].sort();

/** "plain" is the deliberate no-overlay case: no rule is correct for it. */
const patternsNeedingOverlay = contentPatterns.filter((p) => p !== "plain");

describe("portrait pattern parity across the three implementations", () => {
  it("content actually declares patterns to check (guards against a vacuous suite)", () => {
    expect(patternsNeedingOverlay.length).toBeGreaterThan(3);
  });

  it.each(patternsNeedingOverlay)(
    "focus-view portrait (ui.css) draws '%s'",
    (pattern) => {
      expect(uiCss).toContain(`.pk-portrait-blob--${pattern}`);
    },
  );

  it.each(patternsNeedingOverlay)(
    "Album portrait (pipdex.css) draws '%s'",
    (pattern) => {
      expect(pipdexCss).toContain(`.pk-pipdex-blob--pattern-${pattern}`);
    },
  );

  // An authored rule is worthless if the TypeScript never emits its class.
  // The Album previously bucketed ember/flake/puff/glowdot into one shared
  // "fleck" class, which silently discarded four dedicated rules — four
  // species wore identical dots in the Album while looking distinct in the
  // Keep. CSS-exists and TS-emits-it are separate acceptance criteria
  // (spec §16 v1.3's standing rule), so assert both.
  it.each(patternsNeedingOverlay)(
    "the Album emits a class that EXISTS for '%s'",
    (pattern) => {
      const suffix = albumPatternClassSuffix(pattern);
      expect(
        pipdexCss,
        `'${pattern}' emits '.pk-pipdex-blob--pattern-${suffix}', which has no rule`,
      ).toContain(`.pk-pipdex-blob--pattern-${suffix}`);
    },
  );

  // Injectivity is the real guard. A pure alias is fine (`speckled` and
  // `dots` are the same motif, aliased the same way in spriteResolver.ts),
  // but two DISTINCT motifs sharing one class is the bug that shipped: four
  // species wore identical dots in the Album while looking distinct in the
  // Keep.
  it("no two distinct content patterns collapse to the same Album class", () => {
    const byClass = new Map<string, string[]>();
    for (const pattern of patternsNeedingOverlay) {
      const suffix = albumPatternClassSuffix(pattern);
      byClass.set(suffix, [...(byClass.get(suffix) ?? []), pattern]);
    }
    const collisions = [...byClass.entries()].filter(([, ps]) => ps.length > 1);
    expect(collisions, `collapsed: ${JSON.stringify(collisions)}`).toEqual([]);
  });

  // The specific regression: a pattern overlay spanning the WHOLE blob with
  // radial repetition reads as a starburst over the face. `swirl` is one
  // small curl on the upper flank in the Pixi resolver, and both DOM
  // portraits must agree.
  it("no portrait pattern uses a full-body repeating-conic-gradient (the starburst bug)", () => {
    for (const [name, css] of [
      ["ui.css", stripComments(uiCss)],
      ["pipdex.css", stripComments(pipdexCss)],
    ] as const) {
      expect(
        css.includes("repeating-conic-gradient"),
        `${name} still uses repeating-conic-gradient — that renders as a starburst across the pip's face; use a bounded, off-center motif instead`,
      ).toBe(false);
    }
  });
});

describe("accessory parity across the three implementations (round 2D item 3)", () => {
  it("content actually declares accessories to check (guards against a vacuous suite)", () => {
    expect(ACCESSORY_IDS.length).toBeGreaterThan(3);
  });

  it.each(ACCESSORY_IDS)("focus-view portrait (ui.css) draws '%s'", (accessoryId) => {
    expect(uiCss).toContain(`.pk-portrait-accessory--${accessoryId}`);
  });

  it.each(ACCESSORY_IDS)("Album portrait (pipdex.css) draws '%s'", (accessoryId) => {
    expect(pipdexCss).toContain(`.pk-pipdex-accessory--${accessoryId}`);
  });

  // Same discipline as `albumPatternClassSuffix` above: an authored CSS
  // rule is worthless if the TypeScript that decides the class never
  // emits it.
  it.each(ACCESSORY_IDS)(
    "the focus view emits a class that EXISTS for '%s'",
    (accessoryId) => {
      const suffix = focusAccessoryClassSuffix(accessoryId);
      expect(
        uiCss,
        `'${accessoryId}' emits '.pk-portrait-accessory--${suffix}', which has no rule`,
      ).toContain(`.pk-portrait-accessory--${suffix}`);
    },
  );

  it.each(ACCESSORY_IDS)("the Album emits a class that EXISTS for '%s'", (accessoryId) => {
    const suffix = albumAccessoryClassSuffix(accessoryId);
    expect(
      pipdexCss,
      `'${accessoryId}' emits '.pk-pipdex-accessory--${suffix}', which has no rule`,
    ).toContain(`.pk-pipdex-accessory--${suffix}`);
  });

  it("no two distinct accessories SHARE a CSS rule (a grouped selector renders them identically)", () => {
    // ROUND 2D FIX STAGE. The two checks above are `toContain` substring
    // matches, so rewriting
    //   `.pk-pipdex-accessory--acorncap {`
    // as
    //   `.pk-pipdex-accessory--leafcap,\n.pk-pipdex-accessory--acorncap {`
    // satisfies both while making leafcap and acorncap visually identical
    // on the Album — and it survived mutation testing. The CSS-authoring
    // side is precisely where round 2E's "11 missing pattern overlays"
    // regression lived, so it gets a structural check, not a substring one.
    //
    // Selector lists that merely REFERENCE an accessory class inside
    // `:has(…)` (the sprout-displacement rule) are not styling the
    // accessory and are stripped before the check.
    for (const [name, css] of [
      ["ui.css", stripComments(uiCss)],
      ["pipdex.css", stripComments(pipdexCss)],
    ] as const) {
      const selectorLists = [...css.matchAll(/(^|[};])([^{};]+)\{/g)].map((m) =>
        (m[2] as string).replace(/:has\([^)]*\)/g, ""),
      );
      for (const list of selectorLists) {
        if (list.trim().startsWith("@")) continue;
        const ids = new Set(
          [...list.matchAll(/pk-(?:portrait|pipdex)-accessory--([a-z]+)/g)].map(
            (m) => m[1] as string,
          ),
        );
        expect(
          ids.size,
          `${name}: one rule styles ${[...ids].join(" + ")} together — they would render identically:\n${list.trim()}`,
        ).toBeLessThanOrEqual(1);
      }
    }
  });

  it("every accessory has a rule of its OWN (not only a shared one)", () => {
    for (const [name, css, prefix] of [
      ["ui.css", stripComments(uiCss), "pk-portrait-accessory"],
      ["pipdex.css", stripComments(pipdexCss), "pk-pipdex-accessory"],
    ] as const) {
      for (const accessoryId of ACCESSORY_IDS) {
        const owned = [...css.matchAll(/(^|[};])([^{};]+)\{/g)]
          .map((m) => (m[2] as string).replace(/:has\([^)]*\)/g, ""))
          .filter((list) => list.includes(`.${prefix}--${accessoryId}`));
        expect(
          owned.length,
          `${name}: '${accessoryId}' has no rule of its own`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("no two distinct accessories collapse to the same class, on either DOM surface", () => {
    for (const classify of [focusAccessoryClassSuffix, albumAccessoryClassSuffix]) {
      const byClass = new Map<string, string[]>();
      for (const accessoryId of ACCESSORY_IDS) {
        const suffix = classify(accessoryId) as string;
        byClass.set(suffix, [...(byClass.get(suffix) ?? []), accessoryId]);
      }
      const collisions = [...byClass.entries()].filter(([, ids]) => ids.length > 1);
      expect(collisions, `collapsed: ${JSON.stringify(collisions)}`).toEqual([]);
    }
  });

  it("every 'bare' spelling (undefined, null, the \"none\" sentinel) draws nothing on either surface", () => {
    for (const bare of [undefined, null, NO_ACCESSORY_ID] as const) {
      expect(focusAccessoryClassSuffix(bare)).toBeNull();
      expect(albumAccessoryClassSuffix(bare)).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// THE MOUNTED-DOM HALF (round 2D fix stage)
// ---------------------------------------------------------------------------

/**
 * WHY THIS SECTION EXISTS, in one sentence: everything above this line is
 * string matching, and a build that constructs the accessory element and
 * never appends it passed all of it.
 *
 * That is not hypothetical. Mutation testing removed
 * `pBlob.appendChild(pAccessory)` from `ui/focusView.ts` AND
 * `blob.appendChild(accessory)` from `ui/pipdex.ts` — the accessory built,
 * coloured, titled, and thrown away on BOTH flat portrait surfaces — and
 * the whole 2789-test suite stayed green. A second mutation deleted
 * `accessoryId` from both Album model builders and from `ui/sanctuary.ts`'s
 * `portraitVisualOf`, silently stripping the accessory from the Album, the
 * Album detail page and every Long Meadow resident. Also green.
 *
 * The Pixi surface was never at risk: `spriteResolver.test.ts` asserts
 * `accessoryAnchor.children.length`, and three of its tests fail the moment
 * `drawAccessory` is skipped. The two DOM surfaces had no equivalent —
 * `grep -rn 'pk-portrait-accessory|pk-pipdex-accessory' src` outside the
 * stylesheets returned only this file plus the two construction sites, and
 * nothing here ever touched `document`.
 *
 * So: build the real DOM, query the real node. This is the "written to
 * state vs visible to the player" standing rule (spec §16 v1.3) applied to
 * the exact layer the round added.
 */

function stateWithAccessory(accessoryId: string | null | undefined): GameState {
  const base = createNewGame(7, 0);
  const pipId = base.activePipId;
  const pip = base.pips[pipId];
  if (pip === undefined) throw new Error("fixture has no starter Pip");
  return {
    ...base,
    pips: {
      [pipId]: { ...pip, genome: { ...pip.genome, accessoryId } },
    },
  };
}

/** Open the real focus view on a Pip wearing `accessoryId` and hand back
 * its root for querying. */
function focusPortraitRoot(accessoryId: string | null | undefined): FakeElement {
  const state = stateWithAccessory(accessoryId);
  const view = createFocusView({
    dispatch: () => {},
    getState: () => state,
    clock: { now: () => 0 },
  } as unknown as Parameters<typeof createFocusView>[0]);
  view.sync(state);
  view.open();
  return view.el as unknown as FakeElement;
}

describe("the accessory is actually MOUNTED on the focus-view portrait", () => {
  it.each(ACCESSORY_IDS)("'%s' appears as a real node inside the portrait", (accessoryId) => {
    const dom = installFakeDom();
    try {
      const root = focusPortraitRoot(accessoryId);
      const blob = root.querySelector(".pk-portrait-blob");
      expect(blob, "the focus portrait rendered no blob at all").not.toBeNull();
      const node = root.querySelector(`.pk-portrait-accessory--${accessoryId}`);
      expect(
        node,
        `the focus portrait built no .pk-portrait-accessory--${accessoryId} node`,
      ).not.toBeNull();
      // …and it is INSIDE the portrait, not merely somewhere in the panel.
      expect(
        blob?.querySelector(`.pk-portrait-accessory--${accessoryId}`),
        `the accessory node exists but is not a child of .pk-portrait-blob`,
      ).not.toBeNull();
      // Content-as-data really reached the element.
      expect(node?.style.getPropertyValue("--pk-acc-primary")).toMatch(/^#/);
    } finally {
      dom.uninstall();
    }
  });

  it.each([undefined, null, NO_ACCESSORY_ID])(
    "a bare Pip (%s) mounts NO accessory node at all",
    (bare) => {
      const dom = installFakeDom();
      try {
        const root = focusPortraitRoot(bare);
        expect(root.querySelector(".pk-portrait-blob")).not.toBeNull();
        expect(root.querySelectorAll(".pk-portrait-accessory")).toHaveLength(0);
      } finally {
        dom.uninstall();
      }
    },
  );

  it("the focus portrait also mounts a mouth and honours the species silhouette", () => {
    // Parity with the Pixi resolver, and the landmark that stops every
    // neck accessory from reading as a mouth (see ui.css).
    const dom = installFakeDom();
    try {
      const root = focusPortraitRoot("scarf");
      expect(root.querySelector(".pk-portrait-mouth")).not.toBeNull();
      const portrait = root.querySelector(".pk-portrait");
      expect(portrait?.style.getPropertyValue("--pk-wfrac")).not.toBe("");
      expect(portrait?.style.getPropertyValue("--pk-hfrac")).not.toBe("");
      // …and its own per-individual jitter.
      expect(portrait?.style.getPropertyValue("--pk-jw")).not.toBe("");
    } finally {
      dom.uninstall();
    }
  });
});

describe("the accessory is actually MOUNTED on the Album/Long Meadow portrait", () => {
  const visual = {
    speciesId: "mosspip",
    paletteId: "fern",
    pattern: "speckled",
    shiny: false,
  } as const;

  it.each(ACCESSORY_IDS)("'%s' appears as a real node inside the portrait", (accessoryId) => {
    const dom = installFakeDom();
    try {
      const el = buildPortraitEl(
        { ...visual, accessoryId },
        "small",
      ) as unknown as FakeElement;
      const blob = el.querySelector(".pk-pipdex-blob");
      expect(blob, "the Album portrait rendered no blob at all").not.toBeNull();
      const node = blob?.querySelector(`.pk-pipdex-accessory--${accessoryId}`);
      expect(
        node,
        `buildPortraitEl built no .pk-pipdex-accessory--${accessoryId} child`,
      ).not.toBeNull();
      expect(node?.style.getPropertyValue("--pk-acc-primary")).toMatch(/^#/);
    } finally {
      dom.uninstall();
    }
  });

  it.each([undefined, null, NO_ACCESSORY_ID])(
    "a bare Pip (%s) mounts NO accessory node at all",
    (bare) => {
      const dom = installFakeDom();
      try {
        const el = buildPortraitEl(
          { ...visual, accessoryId: bare },
          "small",
        ) as unknown as FakeElement;
        expect(el.querySelector(".pk-pipdex-blob")).not.toBeNull();
        expect(el.querySelectorAll(".pk-pipdex-accessory")).toHaveLength(0);
      } finally {
        dom.uninstall();
      }
    },
  );

  it("mounts a mouth, and writes jitter vars only when a seed is given", () => {
    const dom = installFakeDom();
    try {
      const bare = buildPortraitEl(visual, "small") as unknown as FakeElement;
      expect(bare.querySelector(".pk-pipdex-mouth")).not.toBeNull();
      // No seed → no properties written → the CSS fallbacks (all 1) apply,
      // so every pre-round-2D caller renders exactly as it used to.
      expect(bare.style.getPropertyValue("--pk-jw")).toBe("");

      const jittered = buildPortraitEl(
        { ...visual, jitterSeed: "pip-9" },
        "small",
      ) as unknown as FakeElement;
      for (const name of ["--pk-jw", "--pk-jh", "--pk-jgap", "--pk-jeye-w", "--pk-jeye-h"]) {
        expect(
          Number(jittered.style.getPropertyValue(name)),
          `${name} was not written`,
        ).toBeGreaterThan(0);
      }
    } finally {
      dom.uninstall();
    }
  });

  it("two Pips with the SAME genome but different ids render differently", () => {
    // The identity claim of item 4, asserted on a DOM surface rather than
    // only on the Keep's 46px sprite.
    const dom = installFakeDom();
    try {
      const a = buildPortraitEl(
        { ...visual, jitterSeed: "pip-1" },
        "small",
      ) as unknown as FakeElement;
      const b = buildPortraitEl(
        { ...visual, jitterSeed: "pip-2" },
        "small",
      ) as unknown as FakeElement;
      const read = (el: FakeElement): string =>
        ["--pk-jw", "--pk-jh", "--pk-jgap", "--pk-jeye-w", "--pk-jeye-h"]
          .map((n) => el.style.getPropertyValue(n))
          .join("|");
      expect(read(a)).not.toBe(read(b));
    } finally {
      dom.uninstall();
    }
  });
});
