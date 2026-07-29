/**
 * Migration harness tests (spec §8: migrations from day one, with a
 * fixture save per historical version).
 *
 * The version sweep below is self-extending: when Phase 3 bumps
 * CURRENT_SCHEMA_VERSION, it fails until fixtures/v<N>.json exists and
 * migrates cleanly — forcing the fixture + step to land together.
 */

import { describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, fromSaveBlob, toSaveBlob } from "./serialize";
import { MIGRATIONS, migrate } from "./migrate";

/** Raw fixture text per file, via Vite's glob import (no node types
 * needed; vitest runs through Vite). Keys look like "./fixtures/v1.json". */
const rawFixtures = import.meta.glob("./fixtures/v*.json", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function fixtureRaw(version: number): string | undefined {
  return rawFixtures[`./fixtures/v${version}.json`];
}

function loadFixture(version: number): unknown {
  const raw = fixtureRaw(version);
  if (raw === undefined) {
    throw new Error(`fixtures/v${version}.json missing`);
  }
  return JSON.parse(raw) as unknown;
}

describe("migrate fixtures", () => {
  it("has a fixture for every schema version 1..CURRENT, and each migrates cleanly", () => {
    for (let version = 1; version <= CURRENT_SCHEMA_VERSION; version++) {
      expect(fixtureRaw(version), `fixtures/v${version}.json missing`).toBeDefined();
      const result = migrate(loadFixture(version));
      expect(result.ok, `fixtures/v${version}.json failed to migrate`).toBe(true);
      if (result.ok) {
        expect(result.fromVersion).toBe(version);
        expect(result.save.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      }
    }
  });

  it("passes a current-version blob through untouched", () => {
    const raw = loadFixture(CURRENT_SCHEMA_VERSION);
    const migrated = migrate(raw);
    const direct = fromSaveBlob(raw);
    expect(migrated.ok).toBe(true);
    expect(direct.ok).toBe(true);
    if (migrated.ok && direct.ok) {
      expect(migrated.save).toStrictEqual(direct.save);
    }
  });

  it("current fixture re-wraps to an identical envelope (fixture stays canonical)", () => {
    const result = migrate(loadFixture(CURRENT_SCHEMA_VERSION));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rewrapped = toSaveBlob(result.save.state, result.save.savedAt);
    expect(rewrapped).toStrictEqual(result.save);
  });

  it("has a registered step for every historical version below CURRENT", () => {
    // Fails the moment CURRENT bumps without its vN→vN+1 step.
    for (let version = 1; version < CURRENT_SCHEMA_VERSION; version++) {
      expect(MIGRATIONS[version], `MIGRATIONS[${version}] missing`).toBeDefined();
    }
  });

  it("v1 → v2 → v3 fills phase defaults and derives the pip counter", () => {
    const result = migrate(loadFixture(1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const state = result.save.state;
    expect(state.keep).toEqual({ level: 1, placements: {} });
    expect(state.eggs).toEqual([]);
    expect(state.pendingReveals).toEqual([]);
    // v1 fixture has pip-1 and pip-2 → the next id is pip-3.
    expect(state.nextPipNumber).toBe(3);
    expect(state.nextEggNumber).toBe(1);
    expect(state.lastAssignOutcome).toBeNull();
    expect(state.lastHatchOutcome).toBeNull();
  });

  it("v2 → v3 restructures keepLevel into keep and fills Phase 5 defaults", () => {
    const result = migrate(loadFixture(2));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const state = result.save.state;
    // The v2 fixture is at keepLevel 2 — the level carries over; nothing
    // was placeable before v3, so the grid starts empty.
    expect(state.keep).toEqual({ level: 2, placements: {} });
    expect(state.jobs).toEqual({});
    expect(state.rosterUpgradePurchased).toBe(false);
    expect(state.nextPlacementNumber).toBe(1);
    expect(state.lastJobOutcome).toBeNull();
    expect(state.lastEvolveOutcome).toBeNull();
    // No pip could have evolved before v3.
    for (const pip of Object.values(state.pips)) {
      expect(pip.evolved).toBeNull();
    }
    // The flat v2 field is gone, not left dangling.
    expect("keepLevel" in state).toBe(false);
  });
});

describe("migrate error handling", () => {
  it("rejects non-objects", () => {
    for (const bad of [null, undefined, 7, "save", [1]]) {
      const result = migrate(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("not-an-object");
    }
  });

  it("rejects a missing or malformed schemaVersion", () => {
    for (const version of [undefined, "1", 0, -1, 1.5, Number.NaN]) {
      const result = migrate({ schemaVersion: version });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("invalid-field");
        expect(result.error.path).toBe("schemaVersion");
      }
    }
  });

  it("rejects saves from a newer build (schemaVersion above CURRENT)", () => {
    const result = migrate({ schemaVersion: CURRENT_SCHEMA_VERSION + 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unsupported-schema-version");
  });

  it("surfaces body corruption from final validation as a typed error", () => {
    const result = migrate({ schemaVersion: 1, seed: 1, savedAt: 1, state: null });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid-field");
      expect(result.error.path).toBe("state");
    }
  });

  it("never throws on hostile input", () => {
    const hostile: unknown[] = [null, [], {}, { schemaVersion: 99 }, { schemaVersion: {} }, "x"];
    for (const input of hostile) {
      expect(() => migrate(input)).not.toThrow();
      expect(migrate(input).ok).toBe(false);
    }
  });
});
