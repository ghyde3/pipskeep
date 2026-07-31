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
import { HOUR_MS, tuning as tuningModule } from "../../content/tuning";
import { MILESTONES as contentMilestones } from "../../content/milestones";
import { pipSeason, updateAging } from "../pips/lifecycle";
import type { PipState } from "../pips/types";

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

/**
 * ROUND 2H (docs/lifecycle-bible.md §9.2) — `MIGRATIONS[8]` (v8 → v9)
 * grants every pip `level`/`pipXp`/`lifeMs`/`readyToRetire` generously and
 * changes NOTHING else about it. Used by the two pre-existing "nothing
 * was lost" integrate-gate tests below, which otherwise walk every field
 * of a pre-v9 pip expecting byte-identical output — this asserts the
 * grant is exactly right instead, and that it is the ONLY thing that
 * changed.
 */
function expectPipMigratedToV9(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): void {
  const grantLevel = tuningModule.lifecycle.level.migrationGrantLevel;
  const grantXp = tuningModule.lifecycle.level.levelXp[grantLevel - 1] ?? 0;
  const { level, pipXp, lifeMs, readyToRetire, ...restAfter } = after as Record<
    string,
    unknown
  > & {
    level?: number;
    pipXp?: number;
    lifeMs?: number;
    readyToRetire?: boolean;
  };
  expect(level).toBe(grantLevel);
  expect(pipXp).toBe(grantXp);
  expect(lifeMs).toBe(0);
  expect(readyToRetire).toBe(false);
  expect(restAfter).toEqual(before);
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

  it("v3 → v4 marks onboarding completed (existing saves never see the tutorial)", () => {
    const result = migrate(loadFixture(3));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.save.state.onboarding).toEqual({
      completed: true,
      step: "done",
    });
  });

  it("v3 → v4 moves resource Berries into the inventory (Berries are food)", () => {
    const result = migrate(loadFixture(3));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const state = result.save.state;
    // The v3 fixture holds 7 resource berries + 2 inventory berries.
    expect(state.resources["berry"]).toBeUndefined();
    expect(state.inventory["berry"]).toBe(9);
    // Non-berry resources ride along untouched.
    expect(state.resources).toEqual({ moss: 5, pebble: 12, wood: 9, fiber: 4 });
  });

  it("v3 → v4 defaults every genome to shiny: false (nothing pre-v4 rolled it)", () => {
    for (const version of [1, 2, 3]) {
      const result = migrate(loadFixture(version));
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      for (const pip of Object.values(result.save.state.pips)) {
        expect(pip.genome.shiny).toBe(false);
      }
    }
  });

  it("v4 → v5 derives sulking from the pre-v5 activity encoding (round 2A finding #2)", () => {
    // The v4 fixture's pips are onExpedition / assignedJob — neither was
    // ever the pre-v5 "sulking" encoding, so both migrate to false.
    const result = migrate(loadFixture(4));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const pip of Object.values(result.save.state.pips)) {
      expect(pip.sulking).toBe(false);
    }

    // A pip actually SAVED mid-Sulk (the only pre-v5 encoding) migrates
    // to sulking: true — the one case the flag must recover exactly.
    const raw = loadFixture(4) as {
      state: { pips: Record<string, Record<string, unknown>> };
    };
    raw.state.pips["pip-1"]!["activity"] = "sulking";
    const withSulker = migrate(raw);
    expect(withSulker.ok).toBe(true);
    if (!withSulker.ok) return;
    expect(withSulker.save.state.pips["pip-1"]?.sulking).toBe(true);
    expect(withSulker.save.state.pips["pip-1"]?.activity).toBe("sulking");
    expect(withSulker.save.state.pips["pip-2"]?.sulking).toBe(false);
  });

  it("v5 → v6 derives the Album from every pip already owned (bible §11.3)", () => {
    const result = migrate(loadFixture(5));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { pipdex, sanctuary } = result.save.state;

    // Nothing could have been retired before this round shipped.
    expect(sanctuary).toEqual({ pips: {}, order: [] });
    expect(result.save.state.lastSanctuaryOutcome).toBeNull();

    // The v5 fixture: pip-1 is a grovepip evolved FROM mosspip (shiny
    // false, evolved.variantId "verdant"); pip-2 is a shiny mosspip
    // pipling. Both LIVE species are caught; the veteran never loses
    // credit for either.
    expect(pipdex.entries["grovepip"]?.caughtAt).not.toBeNull();
    expect(pipdex.entries["grovepip"]?.caughtCount).toBe(1);
    // The frozen portrait's genome is the BIRTH genome (mosspip) — a
    // Pip's genome never changes on evolution.
    expect(pipdex.entries["grovepip"]?.firstPortrait?.genome.speciesId).toBe(
      "mosspip",
    );

    expect(pipdex.entries["mosspip"]?.caughtAt).not.toBeNull();
    expect(pipdex.entries["mosspip"]?.caughtCount).toBe(1);
    expect(pipdex.entries["mosspip"]?.shinyCaughtAt).not.toBeNull(); // pip-2's genome.shiny is true
    // The evolution's gift-variant leaf lands on the BASE (mosspip) page.
    expect(pipdex.entries["mosspip"]?.variantsCaught["verdant"]).toBe(88000000);

    expect(pipdex.formsCaught).toBe(2);

    // Never backfilled ABOVE the truth: nothing here was ever owned as a
    // lanternpip, snowpip, etc.
    expect(pipdex.entries["lanternpip"]?.caughtAt ?? null).toBeNull();

    // Seen-only Field notes: the v5 fixture is at Keep level 2, which
    // unlocks the Meadow (eggSpecies ["mosspip", "cloudpip"]) among
    // others — cloudpip is knowable but was never owned.
    expect(pipdex.entries["cloudpip"]?.seenAt).not.toBeNull();
    expect(pipdex.entries["cloudpip"]?.caughtAt).toBeNull();
  });

  /**
   * ROUND 2C REVIEW: v6 → v7 adds `flair` (docs/retention-bible.md §4.3).
   * Round 2C shipped 22 `kind: "flair"` milestone rewards with nowhere to
   * store them and nothing to draw them, so every long-haul target paid
   * literally nothing. v6 saves already existed by then, hence a version of
   * its own — and the step has one real job beyond seeding the field.
   */
  it("v6 → v7 seeds flair, and re-derives the founder veteran's Album stamp from the milestone they were already granted", () => {
    // A real v6 blob that predates the field entirely.
    const v6 = loadFixture(6) as {
      readonly state: Record<string, unknown>;
      readonly [k: string]: unknown;
    };
    expect(v6.state["flair"], "the v6 fixture must NOT have flair").toBeUndefined();
    const plain = migrate(v6);
    expect(plain.ok, "a v6 save without `flair` must still load").toBe(true);
    if (!plain.ok) return;
    expect(plain.save.state.flair).toEqual({});

    // A v5 veteran migrating all the way through: the step above grants the
    // hidden `founder` milestone, whose reward IS `album-founder-stamp`.
    // Granting the milestone without the flourish would leave the
    // apology-in-flair as the last place flair still paid nothing.
    const veteran = migrate(loadFixture(5));
    expect(veteran.ok).toBe(true);
    if (!veteran.ok) return;
    const founderAt = veteran.save.state.milestones.earned["founder"];
    expect(founderAt, "a v5 save is granted the founder milestone").toBeDefined();
    expect(veteran.save.state.flair["album-founder-stamp"]).toBe(founderAt);
  });

  it("v6 → v7 changes NOTHING except adding flair", () => {
    // Isolate THIS ONE step (`MIGRATIONS[6]`) rather than `migrate()`,
    // which now runs all the way to CURRENT (v8, round 2F) — that later
    // step has its own claim (below) about exactly what it changes.
    const v6 = loadFixture(6) as { readonly state: Record<string, unknown> };
    const after = MIGRATIONS[6]!(v6)["state"] as Record<string, unknown>;
    for (const [key, value] of Object.entries(v6.state)) {
      expect(JSON.stringify(after[key]), `state.${key} was altered`).toBe(
        JSON.stringify(value),
      );
    }
    const added = Object.keys(after).filter((k) => !(k in v6.state));
    expect(added).toEqual(["flair"]);
  });

  /**
   * ROUND 2F — THE PROGRESSION SPINE (docs/progression-bible.md §8.4):
   * v7 → v8 adds `keepXp` (backfilled) and `lastLevelUp` (null), and seeds
   * three NEW counter key families inside the ALREADY-EXISTING `counters`
   * bag (no new top-level field for them) — everything else is untouched.
   */
  it("v7 → v8 changes nothing except keepXp, lastLevelUp, and seeding the new counter key families", () => {
    const v7 = loadFixture(7) as { readonly state: Record<string, unknown> };
    const after = MIGRATIONS[7]!(v7)["state"] as Record<string, unknown>;
    for (const [key, value] of Object.entries(v7.state)) {
      if (key === "counters") continue; // asserted separately below
      expect(JSON.stringify(after[key]), `state.${key} was altered`).toBe(
        JSON.stringify(value),
      );
    }
    const added = Object.keys(after).filter((k) => !(k in v7.state));
    expect(added.sort()).toEqual(["keepXp", "lastLevelUp"]);

    // `counters` gains keys; every key already present keeps its value.
    const priorCounters = v7.state["counters"] as Record<string, number>;
    const nextCounters = after["counters"] as Record<string, number>;
    for (const [key, value] of Object.entries(priorCounters)) {
      expect(nextCounters[key], `counters.${key} was altered`).toBe(value);
    }
  });

  /**
   * ROUND 2F — a v6 save run all the way to CURRENT (through v7's flair
   * step and v8's Keep-XP step): the Keep LEVEL is preserved exactly (the
   * migration must never auto-purchase a tier), and `keepXp` lands on the
   * exact `deriveKeepXp` formula (progression bible §8.4) — computed here
   * independently from the fixture's own known values so this test would
   * catch a formula regression, not just "it didn't crash".
   */
  it("v6 → CURRENT preserves the Keep level exactly and derives a sane, provable keepXp", () => {
    const v6 = loadFixture(6) as {
      readonly state: {
        readonly keep: { readonly level: number };
        readonly counters: Readonly<Record<string, number>>;
        readonly milestones: { readonly earned: Readonly<Record<string, number>> };
      };
    };
    const result = migrate(v6);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The level itself never moves — only PURCHASE_KEEP_LEVEL (a player
    // tap) may ever do that.
    expect(result.save.state.keep.level).toBe(v6.state.keep.level);

    // Independently recompute the expected floor/provable-sum from the
    // fixture's own known shape (v6.json: level 2, careActions 30,
    // expeditionsTotal 5, 2 distinct placements, milestone "first-feed").
    const levelXp = tuningModule.progression.levelXp;
    const xpCfg = tuningModule.progression.xp;
    const floor = levelXp[v6.state.keep.level - 1] ?? 0;
    const c = v6.state.counters;
    const milestoneXp = Object.keys(v6.state.milestones.earned).reduce(
      (sum, id) => sum + (contentMilestones.find((m) => m.id === id)?.xp ?? 0),
      0,
    );
    const provable =
      xpCfg.care * (c["careActions"] ?? 0) +
      xpCfg.expeditionSend * (c["expeditionsTotal"] ?? 0) +
      25 * 2 + // 25 × distinct placed itemIds — the v6 fixture places 2
      milestoneXp;
    expect(result.save.state.keepXp).toBe(Math.max(floor, provable));

    // Never above the truth's OWN floor, and never a negative/undefined.
    expect(result.save.state.keepXp).toBeGreaterThanOrEqual(floor);
    // The migration must not have granted resources or auto-purchased —
    // resources are exactly what the v6 fixture already had.
    const rawV6 = loadFixture(6) as { readonly state: Record<string, unknown> };
    expect(result.save.state.resources).toEqual(rawV6.state["resources"] ?? {});

    // --- AND NOTHING WAS LOST (the integrate gate's third obligation) ---
    // THREE full schema steps now run over this blob (v7's flair, v8's
    // Keep-XP, v9's per-pip level/lifespan grant). Walk EVERY key the v6
    // save carried and prove it survived byte-identical, rather than
    // trusting "it didn't throw" — a migration that quietly drops an egg,
    // a placement or an rng cursor while adding a shiny new XP counter is
    // exactly the failure this round must not ship. `counters` is one
    // exemption (v8 SEEDS new key families into it) and is checked
    // key-by-key instead; `pips`/`sanctuary` are the other (v9 GRANTS
    // level/pipXp/lifeMs/readyToRetire onto every pip, active and
    // resident) and are checked below via `expectPipMigratedToV9`, so
    // even they cannot silently lose an entry.
    const after = result.save.state as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(rawV6.state)) {
      if (key === "counters" || key === "pips" || key === "sanctuary") continue;
      expect(JSON.stringify(after[key]), `state.${key} was lost or altered`).toBe(
        JSON.stringify(value),
      );
    }
    for (const [key, value] of Object.entries(
      rawV6.state["counters"] as Record<string, number>,
    )) {
      expect(
        (after["counters"] as Record<string, number>)[key],
        `counters.${key} was lost or altered`,
      ).toBe(value);
    }
    const beforePipsV6 = rawV6.state["pips"] as Record<string, Record<string, unknown>>;
    for (const [id, beforePip] of Object.entries(beforePipsV6)) {
      expectPipMigratedToV9(
        beforePip,
        (after["pips"] as Record<string, Record<string, unknown>>)[id] as Record<
          string,
          unknown
        >,
      );
    }
    const beforeResident = (
      (rawV6.state["sanctuary"] as { readonly pips: Record<string, { readonly pip: Record<string, unknown> }> })
        .pips["pip-9"] as { readonly pip: Record<string, unknown> }
    ).pip;
    const afterResident = (
      (after["sanctuary"] as { readonly pips: Record<string, { readonly pip: Record<string, unknown> }> })
        .pips["pip-9"] as { readonly pip: Record<string, unknown> }
    ).pip;
    expectPipMigratedToV9(beforeResident, afterResident);
    // The fields the three steps are ALLOWED to add, and no others.
    // (round 2H's `lineageEggs`/`lastLossOutcome`/per-pip ailment fields
    // are all OPTIONAL — `undefined ≡` a safe default — so this v8 → v9
    // step adds none of them; see MIGRATIONS[8]'s own doc comment.)
    const added = Object.keys(after).filter((k) => !(k in rawV6.state));
    expect(added.sort()).toEqual(["flair", "keepXp", "lastLevelUp"]);
  });

  /**
   * ROUND 2C INTEGRATE GATE. The round's whole premise is that a returning
   * player is REWARDED for having shown up before (bible §11.3: the
   * migration is "a gift, never a reset"). Two obligations follow, and this
   * test is the one place both are held at once:
   *
   *   1. every Pip the player already owns is marked caught in the Album —
   *      derived generically from `pips`, so it keeps holding when the
   *      fixture or the species registry changes;
   *   2. NOTHING the v5 save already contained is dropped, renamed or
   *      rewritten by the step that adds nine new fields.
   *
   * (2) is the half that was missing. A migration that silently loses an
   * egg, a placement or an rng cursor while adding a shiny new Album is the
   * exact failure this round must not ship, and "the migration ran without
   * throwing" does not detect it.
   */
  it("v5 → v6 marks every owned Pip caught and loses nothing that was already there", () => {
    const before = loadFixture(5) as {
      readonly seed: number;
      readonly savedAt: number;
      readonly state: Record<string, unknown>;
    };
    const result = migrate(before);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = result.save.state as unknown as Record<string, unknown>;
    const pipdex = result.save.state.pipdex;

    // --- (1) Every owned Pip's LIVE species is caught, generically ---
    const ownedPips = Object.values(result.save.state.pips);
    expect(ownedPips.length).toBeGreaterThan(0);
    for (const pip of ownedPips) {
      const entry = pipdex.entries[pip.speciesId];
      expect(entry, `${pip.name} (${pip.speciesId}) has no Album page`).toBeDefined();
      expect(
        entry?.caughtAt,
        `${pip.name} is owned but ${pip.speciesId} is not marked caught`,
      ).not.toBeNull();
      // A frozen first portrait exists for anything caught (bible §1.4) —
      // the Album must be able to DRAW the page, not just count it.
      expect(entry?.firstPortrait, `${pip.speciesId} has no frozen portrait`).not.toBeNull();
    }
    // The completion counter agrees with the entries (no double-count, no
    // undercount) for the distinct live species owned.
    const distinctOwned = new Set(ownedPips.map((p) => p.speciesId));
    expect(pipdex.formsCaught).toBe(distinctOwned.size);

    // --- (2) No lost data: every pre-round field survives untouched ---
    // Deep-equality per field, driven by the FIXTURE's own key list, so a
    // future field added to v5 is covered automatically rather than needing
    // this list to be maintained by hand. `lastCatchup` is the one honest
    // exception: it is a transient echo that LOAD_SAVE nulls by contract.
    // `pips` is the other (round 2H's v9 step GRANTS
    // level/pipXp/lifeMs/readyToRetire onto every pip — checked via
    // `expectPipMigratedToV9` below instead of byte-identity).
    const transient = new Set(["lastCatchup", "pips"]);
    for (const key of Object.keys(before.state)) {
      if (transient.has(key)) continue;
      expect(after[key], `state.${key} was changed or dropped by the migration`).toEqual(
        before.state[key],
      );
    }
    // Envelope, too: the seed decides the whole RNG universe, and savedAt
    // is what CATCHUP measures the absence from.
    expect(result.save.seed).toBe(before.seed);
    expect(result.save.savedAt).toBe(before.savedAt);

    // Every Pip is still present, by id, with its needs and age intact —
    // spelled out because "no Pip is ever lost" is a §4.4 tone rule, not
    // merely a data-integrity nicety. Every OTHER field (including the
    // round-2H per-pip grant) is checked field-by-field below.
    const beforePips = before.state["pips"] as Record<string, Record<string, unknown>>;
    expect(Object.keys(result.save.state.pips).sort()).toEqual(
      Object.keys(beforePips).sort(),
    );
    for (const [id, pip] of Object.entries(result.save.state.pips)) {
      const beforePip = beforePips[id] as Record<string, unknown>;
      expect(pip.needs).toEqual(beforePip["needs"]);
      expect(pip.ageMs).toBe(beforePip["ageMs"]);
      expectPipMigratedToV9(beforePip, pip as unknown as Record<string, unknown>);
    }

    // And the gift half of "a gift, never a reset": the hidden founder
    // milestone is granted, and the streak arrives with FULL grace rather
    // than mid-punishment (bible §11.1).
    expect(result.save.state.milestones.earned["founder"]).toBeDefined();
    expect(result.save.state.streak.current).toBe(0);
    expect(result.save.state.streak.graceBanked).toBeGreaterThan(0);
  });
});

describe("v8 → v9 (round 2H, docs/lifecycle-bible.md §9.2): PER-PIP LEVELS + LIFESPAN — a veteran is not punished", () => {
  it("a 21-day-old, evolved, mastery-laden Pip migrates to lifeMs 0, reads as freshly Young, and is not readyToRetire", () => {
    const v8 = loadFixture(8) as { readonly state: Record<string, unknown> };
    const state = v8.state as Record<string, unknown>;
    const pipsRec = state["pips"] as Record<string, Record<string, unknown>>;
    const veteranId = Object.keys(pipsRec)[0] as string;
    const veteran = {
      ...(pipsRec[veteranId] as Record<string, unknown>),
      ageMs: 21 * 24 * HOUR_MS,
      happinessIntegral: 75 * 21 * 24 * HOUR_MS, // a well-cared-for veteran
      mastery: { meadow: 40 },
    };
    const blob = { ...v8, state: { ...state, pips: { ...pipsRec, [veteranId]: veteran } } };

    const after = MIGRATIONS[8]!(blob)["state"] as Record<string, unknown>;
    const migratedPip = (after["pips"] as Record<string, Record<string, unknown>>)[
      veteranId
    ] as Record<string, unknown>;

    // The hard requirement: NOT instantly old.
    expect(migratedPip["lifeMs"]).toBe(0);
    expect(migratedPip["readyToRetire"]).toBe(false);
    // The generous thank-you: a season already behind them.
    expect(migratedPip["level"]).toBe(tuningModule.lifecycle.level.migrationGrantLevel);
    expect(migratedPip["pipXp"]).toBe(
      tuningModule.lifecycle.level.levelXp[tuningModule.lifecycle.level.migrationGrantLevel - 1],
    );
    // Everything the Pip already DID survives untouched (mastery, the
    // veteran ageMs itself, evolution) — only the NEW fields are added.
    expect(migratedPip["ageMs"]).toBe(21 * 24 * HOUR_MS);
    expect(migratedPip["mastery"]).toEqual({ meadow: 40 });
    expect(migratedPip["evolved"]).toEqual((pipsRec[veteranId] as Record<string, unknown>)["evolved"]);

    // Derived from the migrated shape: this Pip reads as freshly Young,
    // never Elder, however long (by ageMs) it has already been played —
    // and `lifeMs` is NOT derived from `ageMs` (the bible's rejected
    // alternative, named in serialize.ts's own doc comment).
    const rebuilt = migratedPip as unknown as PipState;
    expect(pipSeason(rebuilt)).toBe("young");
    expect(updateAging(rebuilt).readyToRetire).toBe(false);
    expect(migratedPip["lifeMs"]).not.toBe(migratedPip["ageMs"]);
  });

  it("every migrated Pip — active AND resident in the Long Meadow — starts at the SAME generous level, regardless of how long it has already been owned", () => {
    const v8 = loadFixture(8) as { readonly state: Record<string, unknown> };
    const after = MIGRATIONS[8]!(v8)["state"] as Record<string, unknown>;
    const pipsRec = after["pips"] as Record<string, Record<string, unknown>>;
    const residentPip = (
      (
        after["sanctuary"] as {
          readonly pips: Record<string, { readonly pip: Record<string, unknown> }>;
        }
      ).pips["pip-9"] as { readonly pip: Record<string, unknown> }
    ).pip;

    for (const p of [...Object.values(pipsRec), residentPip]) {
      expect(p["level"]).toBe(tuningModule.lifecycle.level.migrationGrantLevel);
      expect(p["lifeMs"]).toBe(0);
      expect(p["readyToRetire"]).toBe(false);
    }
  });

  it("no field this step doesn't own (ailments, lineage, breeding) is invented from nothing", () => {
    // Round 2H's other slices of this SAME v9 bump are explicitly not
    // this step's job (module doc in migrate.ts) — pin that this step
    // adds ONLY the four lifecycle/level fields to a pip, nothing else.
    const v8 = loadFixture(8) as { readonly state: Record<string, unknown> };
    const state = v8.state as Record<string, unknown>;
    const pipsRec = state["pips"] as Record<string, Record<string, unknown>>;
    const anyId = Object.keys(pipsRec)[0] as string;
    const before = pipsRec[anyId] as Record<string, unknown>;

    const after = MIGRATIONS[8]!(v8)["state"] as Record<string, unknown>;
    const migrated = (after["pips"] as Record<string, Record<string, unknown>>)[anyId] as Record<
      string,
      unknown
    >;
    const addedKeys = Object.keys(migrated).filter((key) => !(key in before));
    expect(addedKeys.sort()).toEqual(["level", "lifeMs", "pipXp", "readyToRetire"]);
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
