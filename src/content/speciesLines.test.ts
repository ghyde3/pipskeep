/**
 * Species flavor lines (content-bible §6.2) — `pickSpeciesLine`'s
 * determinism contract (spec §2 rule 3 note: this hashes a Pip id, it
 * does NOT touch the RNG stream, so there is no cursor to protect — but
 * "the same Pip always greets you with the same line" is still a promise
 * worth pinning).
 */

import { describe, expect, it } from "vitest";
import { species } from "./species";
import { SPECIES_LINE_COUNT, pickSpeciesLine, speciesLines } from "./speciesLines";

describe("pickSpeciesLine", () => {
  it("is deterministic: the same species + id always returns the same line", () => {
    const a = pickSpeciesLine("mosspip", "pip-7");
    const b = pickSpeciesLine("mosspip", "pip-7");
    expect(a).toBe(b);
    expect(a).not.toBeNull();
  });

  it("returns null for a species with no authored lines", () => {
    expect(pickSpeciesLine("ghostpip", "pip-1")).toBeNull();
  });

  it("always returns one of the species' own four lines", () => {
    for (const speciesId of Object.keys(speciesLines)) {
      for (const key of ["a", "b", "pip-1", "pip-42", "pip-999"]) {
        const line = pickSpeciesLine(speciesId, key);
        expect(speciesLines[speciesId]).toContain(line);
      }
    }
  });

  it("spreads across the four lines as the key varies (not always the same index)", () => {
    const picks = new Set(
      Array.from({ length: 40 }, (_, i) => pickSpeciesLine("mosspip", `pip-${i}`)),
    );
    // With 40 distinct keys over 4 lines we expect to see more than one.
    expect(picks.size).toBeGreaterThan(1);
  });

  it("every registered species has exactly SPECIES_LINE_COUNT non-empty lines", () => {
    for (const [id, lines] of Object.entries(speciesLines)) {
      expect(lines).toHaveLength(SPECIES_LINE_COUNT);
      for (const line of lines) {
        expect(line.trim().length).toBeGreaterThan(0);
      }
      // And the species itself is a real registry entry (content/validate.ts
      // also asserts the reverse — every SPECIES has a lines entry).
      expect(species[id]).toBeDefined();
    }
  });
});
