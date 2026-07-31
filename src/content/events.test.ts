import { describe, expect, it } from "vitest";
import { EVENTS } from "./events";
import { foods } from "./foods";
import { decorations } from "./decorations";
import { expeditions } from "./expeditions";

/** Raw source text of the files this suite scans, via Vite's glob import
 * (no Node type dependency needed — the same `?raw` pattern
 * `core/save/migrate.test.ts` already uses for fixtures). This test's job
 * is to prove NOBODY wrote a `.filter(...availableWindow...)` gate
 * anywhere a registry is read, which is a property of the SOURCE, not of
 * any one export. */
const rawSources = import.meta.glob(
  [
    "./expeditions.ts",
    "./foods.ts",
    "./decorations.ts",
    // ROUND 2J FIX STAGE — the fifth registry with the seam.
    "./recipes.ts",
    "../core/progression/events.ts",
  ],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

function readSource(key: string): string {
  const src = rawSources[key];
  if (src === undefined) {
    throw new Error(`events.test.ts: source glob missing ${key} — check the import.meta.glob patterns`);
  }
  return src;
}

describe("EVENTS registry shape", () => {
  it("every window is annual (month-day only, never a year)", () => {
    for (const e of EVENTS) {
      expect(e.window.from).not.toMatch(/\d{4}/);
      expect(e.window.to).not.toMatch(/\d{4}/);
    }
  });

  it("has unique ids", () => {
    const ids = EVENTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every effect is a bonus or a feature — NEVER an exclusive grant of something otherwise unobtainable", () => {
    for (const e of EVENTS) {
      // featuredItemIds must already exist in the food registry (obtainable
      // all year via ordinary loot tables).
      for (const itemId of e.featuredItemIds ?? []) {
        expect(Object.keys(foods), `${e.id} → ${itemId}`).toContain(itemId);
      }
      // featuredDecorationIds must already exist in the decoration registry.
      const decorationIds = new Set(decorations.map((d) => d.id));
      for (const decoId of e.featuredDecorationIds ?? []) {
        expect(decorationIds.has(decoId), `${e.id} → ${decoId}`).toBe(true);
      }
      // eggChanceBonusPoints / pityThresholdOverride must key an expedition
      // that ALREADY exists and is not newly gated by the event.
      for (const expeditionId of Object.keys(e.eggChanceBonusPoints ?? {})) {
        expect(Object.keys(expeditions), `${e.id} → ${expeditionId}`).toContain(expeditionId);
      }
      for (const expeditionId of Object.keys(e.pityThresholdOverride ?? {})) {
        expect(Object.keys(expeditions), `${e.id} → ${expeditionId}`).toContain(expeditionId);
      }
    }
  });
});

describe("no registry lookup path filters by availableWindow (the guard against a future gating dev)", () => {
  /**
   * These registries are PURE DATA and `availableWindow` is documented as
   * consumed by nothing (spec §12's seam: "content registries accept optional
   * `availableWindow` field (unused)"). So the guard is simply: the field must
   * not appear in these files at all.
   *
   * It used to be `/\.filter\([^)]*availableWindow/`, which could not match the
   * only spelling a contributor here would actually write: `[^)]*` cannot cross
   * the `)` in a parenthesised arrow parameter, so `.filter((d) => d.availableWindow …)`
   * — this codebase's prevailing style, and what Prettier emits — slipped
   * straight past it (round-2C review, mutation 11). An unanchored search for
   * the field name cannot have that failure mode.
   */
  // ROUND 2J FIX STAGE — `./recipes.ts` joins the list. It declares the
  // same seam (`content/recipes.ts`'s `availableWindow?`) and was not
  // guarded, so a future contributor could have added seasonal recipe
  // gating with the whole suite green. This list is the known-fragile
  // part (it was already tightened once after round-2C mutation 11), so
  // a new registry with the seam MUST be appended here.
  for (const file of ["./expeditions.ts", "./foods.ts", "./decorations.ts", "./recipes.ts"]) {
    it(`content${file.slice(1)} DECLARES availableWindow and never reads it`, () => {
      const src = readSource(file);
      const mentions = src.match(/availableWindow/g) ?? [];
      // Exactly one mention, and it is the optional TYPE DECLARATION (spec
      // §12's named seam). Any read — `d.availableWindow`, `seasonOpen(
      // d.availableWindow)`, a destructure — necessarily adds a second.
      expect(mentions.length, `${file}: ${mentions.length} mentions`).toBe(1);
      expect(src).toMatch(/availableWindow\?:/);
    });
  }

  it("the guard itself bites, in BOTH arrow spellings (the old one only caught half)", () => {
    // Proof this is not a silently-inert lint. `count === 1` catches a gating
    // dev however they spell the arrow; the old `/\.filter\([^)]*availableWindow/`
    // could not cross the `)` in a parenthesised parameter, which is this
    // codebase's prevailing style and what Prettier emits (round-2C review,
    // mutation 11 — the behavioural tests caught it; this grep did not).
    const declaration = `  availableWindow?: { from: string; to: string };`;
    const parenArrow = `${declaration}\nexport const decorations = ALL.filter((d) => d.availableWindow === undefined);`;
    const bareArrow = `${declaration}\nexport const decorations = ALL.filter(d => d.availableWindow === undefined);`;
    const count = (src: string): number => (src.match(/availableWindow/g) ?? []).length;
    expect(count(declaration)).toBe(1); // the innocent seam passes
    expect(count(parenArrow)).toBeGreaterThan(1); // both gating spellings fail
    expect(count(bareArrow)).toBeGreaterThan(1);
    // …and the regex this replaces demonstrably missed the parenthesised one.
    expect(/\.filter\([^)]*availableWindow/.test(parenArrow)).toBe(false);
  });

  it("core/progression/events.ts's only .filter() call narrows the EVENT registry by window, not a content registry", () => {
    const src = readSource("../core/progression/events.ts");
    const filterCalls = src.match(/\w+\.filter\(/g) ?? [];
    // resolveActiveEvents does exactly one filter, over its own `registry`
    // parameter (the events list) — never over foods/decorations/expeditions.
    expect(filterCalls).toEqual(["registry.filter("]);
  });
});

describe("an inactive window never makes content permanently unobtainable", () => {
  it("every featured item is present in the registry regardless of whether its event is active right now", () => {
    // The registries themselves carry no window-based exclusion at all —
    // `foods`/`decorations` are plain objects/arrays with no "active"
    // concept. Proven simply by the fact every featured id resolves.
    for (const e of EVENTS) {
      for (const itemId of e.featuredItemIds ?? []) {
        expect(foods[itemId as keyof typeof foods]).toBeDefined();
      }
    }
  });
});
