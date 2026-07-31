/**
 * Name pool content tests (round 2D, docs/BACKLOG.md "Round 2D" item 1):
 * enough names, no duplicates, never a bare species display name (the
 * exact tell `core/save/migrate.ts`'s v9→v10 step uses to find Pips that
 * still need one) — and, added by the round's fix stage, never a word the
 * game already uses for a THING.
 *
 * WHY THE VOCABULARY SWEEP EXISTS (see `names.ts`'s own module doc): the
 * pool's first pass shipped nine collisions, and each one broke a real
 * sentence — "Feed Berry a Berry", "Send Meadow to the Meadow", a Pip
 * named Sprout when a sprout is the accent feature every Pip wears, a
 * shiny called Glimmer when "glimmer" IS the game's word for shiny. A
 * hand-written blocklist would rot the moment either side grew, so this
 * file derives the forbidden vocabulary from the content registries
 * themselves: add a food called "Quince" or a palette called "hazel" in
 * five rounds' time and THIS test fails, pointing at the name to retire.
 */

import { describe, expect, it } from "vitest";
import { NAME_POOL } from "./names";
import { species } from "./species";
import { foods } from "./foods";
import { expeditions } from "./expeditions";
import { decorations } from "./decorations";
import { placeables } from "./placeables";
import { keepLevels, keepUpgrades } from "./keep";
import { speciesPalettes } from "./palette";
import { personalities } from "./personalities";
import { jobs } from "./jobs";
import { ailments } from "./ailments";
import { accessories } from "./accessories";
import { decorSets } from "./decorSets";
import { EVENTS } from "./events";
import { MILESTONES } from "./milestones";

/** Every alphabetic word in a display string — a name collides with
 * "Cocoa Bun" or "Berry Crown" just as badly as with a bare "Berry",
 * because the player reads the words, not the id. */
function words(value: string | undefined): readonly string[] {
  if (typeof value !== "string") return [];
  return value.split(/[^A-Za-z]+/).filter((w) => w.length > 0);
}

/**
 * Every id and display word the content tree uses for a THING, mapped to
 * where it came from so a failure names the actual conflict instead of
 * just asserting false.
 */
function contentVocabulary(): ReadonlyMap<string, readonly string[]> {
  const vocab = new Map<string, string[]>();
  const add = (token: string | undefined, where: string): void => {
    if (typeof token !== "string" || token.length === 0) return;
    const key = token.toLowerCase();
    const seen = vocab.get(key);
    if (seen === undefined) vocab.set(key, [where]);
    else if (!seen.includes(where)) seen.push(where);
  };
  const addWords = (value: string | undefined, where: string): void => {
    for (const word of words(value)) add(word, where);
  };

  for (const def of Object.values(species)) {
    add(def.id, "species id");
    addWords(def.name, "species name");
    for (const paletteId of def.sprite.palettes) add(paletteId, "palette id");
    for (const patternId of def.sprite.patterns) add(patternId, "pattern id");
  }
  for (const def of Object.values(foods)) {
    add(def.id, "food id");
    addWords(def.name, `food "${def.name}"`);
  }
  for (const def of Object.values(expeditions)) {
    add(def.id, "expedition id");
    addWords(def.name, `expedition "${def.name}"`);
  }
  for (const def of decorations) {
    add(def.id, "decoration id");
    addWords(def.name, `decoration "${def.name}"`);
  }
  for (const def of placeables) {
    add(def.id, "placeable id");
    addWords(def.name, `placeable "${def.name}"`);
  }
  for (const def of keepLevels) {
    addWords(def.headline, `Keep level headline "${def.headline}"`);
    for (const unlock of def.unlocks) addWords(unlock, `Keep unlock "${unlock}"`);
  }
  for (const def of Object.values(keepUpgrades)) {
    addWords(def.name, `Keep upgrade "${def.name}"`);
  }
  for (const [speciesId, def] of Object.entries(speciesPalettes)) {
    for (const variantId of Object.keys(def.variants)) {
      add(variantId, `${speciesId} palette variant`);
    }
  }
  for (const def of Object.values(personalities)) {
    add(def.id, "personality id");
    addWords(def.name, `personality "${def.name}"`);
  }
  for (const def of Object.values(jobs)) {
    add(def.id, "job id");
    addWords(def.name, `job "${def.name}"`);
  }
  for (const def of Object.values(ailments)) {
    add(def.id, "ailment id");
    addWords(def.name, `ailment "${def.name}"`);
  }
  for (const def of Object.values(accessories)) {
    add(def.id, "accessory id");
    addWords(def.name, `accessory "${def.name}"`);
  }
  for (const def of decorSets) addWords(def.name, `decor set "${def.name}"`);
  for (const def of EVENTS) addWords(def.name, `event "${def.name}"`);
  for (const def of MILESTONES) addWords(def.name, `milestone "${def.name}"`);

  return vocab;
}

describe("NAME_POOL — round 2D individual names", () => {
  it("has at least 100 names (collisions rare across a long game)", () => {
    expect(NAME_POOL.length).toBeGreaterThanOrEqual(100);
  });

  it("has no duplicate entries", () => {
    expect(new Set(NAME_POOL).size).toBe(NAME_POOL.length);
  });

  it("never collides with a species display name (the migration's own tell)", () => {
    const speciesNames = new Set(Object.values(species).map((def) => def.name));
    for (const name of NAME_POOL) {
      expect(speciesNames.has(name)).toBe(false);
    }
  });

  it("never reuses a word the content tree uses for a THING", () => {
    const vocab = contentVocabulary();
    const collisions = NAME_POOL.filter((name) => vocab.has(name.toLowerCase())).map(
      (name) => `${name} (already ${(vocab.get(name.toLowerCase()) ?? []).join(", ")})`,
    );
    expect(collisions).toEqual([]);
  });

  it("the vocabulary sweep is actually loaded (guards against an empty registry import)", () => {
    // Without this, a refactor that made `contentVocabulary()` return an
    // empty map would leave the collision test above vacuously green — the
    // exact failure mode round 2D's mutation stage keeps finding.
    const vocab = contentVocabulary();
    expect(vocab.size).toBeGreaterThan(150);
    expect(vocab.has("berry")).toBe(true);
    expect(vocab.has("meadow")).toBe(true);
    expect(vocab.has("mosspip")).toBe(true);
  });

  it("never builds a name from the game's own species root", () => {
    for (const name of NAME_POOL) {
      expect(name.toLowerCase()).not.toContain("pip");
    }
  });

  it("every name is non-empty, trimmed, and reasonably short", () => {
    for (const name of NAME_POOL) {
      expect(name.trim()).toBe(name);
      expect(name.length).toBeGreaterThan(0);
      expect(name.length).toBeLessThanOrEqual(24);
    }
  });
});
