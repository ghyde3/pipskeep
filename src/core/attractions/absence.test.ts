/**
 * Offline catch-up (docs/liveliness-bible.md §1.5/§1.6, I3: "absence may
 * cost a bonus and nothing else") — visit scheduling rides the SAME
 * `offlineRateCapMs` job production already obeys (no third clock), via
 * the real `runCatchup` engine's `extraEvents` seam (an authentic
 * integration check, not a hand-rolled substitute for it):
 *
 * - a 7-day absence yields exactly `floor(offlineRateCapMs /
 *   visitIntervalMs)` = `floor(16/6)` = 2 scheduled visits per
 *   attraction, collapsed into ONE materialised record (bible §1.6);
 * - the held-open rule: `leavesAt` is stamped to `returnAt + lingerMs`,
 *   never the scheduled tick's own (possibly long-past) timestamp, so a
 *   returning player always finds someone freshly arrived;
 * - trust never decreases across any absence, however long;
 * - a short absence (< one interval) produces nothing at all.
 */

import { describe, expect, it } from "vitest";
import { HOUR_MS, tuning as contentTuning } from "../../content/tuning";
import { runCatchup } from "../pips/catchup";
import type { CatchupState } from "../pips/catchup";
import { collectAttractionCatchupEvents, settleAttractionVisits } from "./index";
import type {
  AttractionContent,
  AttractionScheduleByPlacement,
  AttractionStockByPlacement,
  AttractionVisitTick,
  CaughtPredicate,
  VisitorsByPlacement,
} from "./index";
import type { KeepState } from "../keep";

const SAVED_AT = 10_000_000;
const CAP_MS = contentTuning.offlineRateCapMs; // 16h, shipped
const INTERVAL_MS = contentTuning.attractions.visitIntervalMs; // 6h, shipped
const LINGER_MS = contentTuning.attractions.lingerMs;

const CONTENT: AttractionContent = {
  items: { "attraction-a": { effects: [{ kind: "attraction", biomeId: "meadow" }] } },
  biomes: { meadow: { eggSpecies: ["alpha"] } },
  species: {
    alpha: { id: "alpha", rarity: "common", sprite: { palettes: ["p"], patterns: ["s"] } },
  },
};

const isCaught: CaughtPredicate = () => true;

interface Adapter extends CatchupState {
  readonly keep: KeepState;
  readonly attractionStock: AttractionStockByPlacement;
  readonly attractionSchedule: AttractionScheduleByPlacement;
  readonly firedAttractionVisits: readonly AttractionVisitTick[];
}

function keepWithAttraction(): KeepState {
  return { level: 6, placements: { "place-1": { itemId: "attraction-a", x: 0, y: 0 } } };
}

function runAbsence(
  elapsedMs: number,
  overrides: Partial<Adapter> = {},
): { adapter: Adapter; next: Adapter } {
  const adapter: Adapter = {
    pips: [],
    keep: keepWithAttraction(),
    attractionStock: { "place-1": 4 },
    attractionSchedule: { "place-1": SAVED_AT },
    firedAttractionVisits: [],
    ...overrides,
  };
  const now = SAVED_AT + elapsedMs;
  const result = runCatchup(adapter, SAVED_AT, now, contentTuning, (s, windowStart, windowEnd) =>
    collectAttractionCatchupEvents(s, windowStart, windowEnd, isCaught, contentTuning, CONTENT),
  );
  return { adapter, next: result.state };
}

describe("the rate cap (I3: no third clock) — a 7-day absence produces exactly floor(cap/interval) visits", () => {
  it("collapses into ONE fired tick consuming exactly 2 charges (16h ÷ 6h = 2)", () => {
    const { next } = runAbsence(7 * 24 * HOUR_MS);
    expect(next.firedAttractionVisits).toHaveLength(1);
    expect(next.firedAttractionVisits[0]).toMatchObject({ placementId: "place-1", ticksConsumed: 2 });
    expect(next.attractionStock["place-1"]).toBe(2); // 4 - 2
    // The schedule baseline advances by exactly the consumed ticks, never
    // "backfilling" the rate-frozen tail (spec §4.5 rule 3).
    expect(next.attractionSchedule["place-1"]).toBe(SAVED_AT + 2 * INTERVAL_MS);
  });

  it("a 20h absence is ALREADY capped at 16h — same 2 ticks as a week away, not floor(20/6)=3", () => {
    const { next } = runAbsence(20 * HOUR_MS);
    expect(next.firedAttractionVisits[0]?.ticksConsumed).toBe(2);
  });

  it("an absence just under one interval short of the cap (10h) yields exactly 1 — the cap, not raw elapsed, governs", () => {
    const { next } = runAbsence(10 * HOUR_MS);
    expect(next.firedAttractionVisits[0]?.ticksConsumed).toBe(1);
  });

  it("an absence shorter than one interval produces nothing at all", () => {
    const { adapter, next } = runAbsence(3 * HOUR_MS);
    expect(next.firedAttractionVisits).toEqual([]);
    expect(next.attractionStock).toEqual(adapter.attractionStock);
    expect(next.attractionSchedule).toEqual(adapter.attractionSchedule);
  });

  it("stock exhaustion caps ticksConsumed at whatever remains, never more", () => {
    const { next } = runAbsence(7 * 24 * HOUR_MS, { attractionStock: { "place-1": 1 } });
    expect(next.firedAttractionVisits[0]?.ticksConsumed).toBe(1);
    expect(next.attractionStock["place-1"]).toBe(0);
  });
});

describe("the held-open rule (bible §1.6) — settled AFTER the pass, leavesAt anchored to the true return moment", () => {
  it("a fresh visitor's leavesAt is `returnAt + lingerMs`, not the scheduled tick's own timestamp", () => {
    const elapsed = 7 * 24 * HOUR_MS;
    const { next } = runAbsence(elapsed);
    const returnAt = SAVED_AT + elapsed;
    const settled = settleAttractionVisits(
      { seed: 1, rngState: {}, visitors: {} as VisitorsByPlacement },
      next.firedAttractionVisits,
      returnAt,
      isCaught,
      new Set(),
      CONTENT,
    );
    const visitor = settled.visitors["place-1"];
    expect(visitor).toBeDefined();
    expect(visitor?.arrivedAt).toBe(SAVED_AT + 2 * INTERVAL_MS); // the schedule's own moment
    expect(visitor?.leavesAt).toBe(returnAt + LINGER_MS); // NOT arrivedAt + lingerMs
    expect(visitor?.leavesAt).toBeGreaterThan(visitor!.arrivedAt + LINGER_MS); // strictly extended
  });

  it("an existing visitor's trust and identity survive the absence untouched — only presence refreshes", () => {
    const elapsed = 7 * 24 * HOUR_MS;
    const existingVisitor = {
      placementId: "place-1",
      speciesId: "alpha",
      name: "Old Friend",
      genome: { speciesId: "alpha", palette: "p", pattern: "s", personalityId: "curious", shiny: false },
      arrivedAt: SAVED_AT - 1000,
      leavesAt: SAVED_AT - 500, // already left before the absence began
      trust: 2,
      fedThisVisit: true,
      visits: 5,
    };
    const { next } = runAbsence(elapsed);
    const returnAt = SAVED_AT + elapsed;
    const settled = settleAttractionVisits(
      { seed: 1, rngState: {}, visitors: { "place-1": existingVisitor } },
      next.firedAttractionVisits,
      returnAt,
      isCaught,
      new Set(),
      CONTENT,
    );
    const visitor = settled.visitors["place-1"];
    expect(visitor?.name).toBe("Old Friend"); // same visitor — reused, not re-rolled
    expect(visitor?.trust).toBe(2); // TRUST NEVER DECREASES (2C §0.1)
    expect(visitor?.fedThisVisit).toBe(false); // a fresh visit resets the per-visit flag
    expect(visitor?.visits).toBe(6);
    expect(settled.rngState).toEqual({}); // zero rolls — reused, not rolled
  });

  /**
   * ⚠️ FIX STAGE — the two tests above pass whether `holdLastVisitOpen` is
   * read or not, because the shipped code applied the rule unconditionally
   * and they only ever ran with the shipped `true`. That made the knob a
   * lie: setting it to `false` in `content/tuning.ts` would have changed
   * nothing at all, and the next person to tune it would have had no way
   * to tell. A tuning field nothing branches on is a dead feature wearing
   * a config file's clothes.
   */
  it("is CONDITIONAL on holdLastVisitOpen — false leaves the visit on its own scheduled clock", () => {
    const elapsed = 7 * 24 * HOUR_MS;
    const { next } = runAbsence(elapsed);
    const returnAt = SAVED_AT + elapsed;
    const held = settleAttractionVisits(
      { seed: 1, rngState: {}, visitors: {} as VisitorsByPlacement },
      next.firedAttractionVisits,
      returnAt,
      isCaught,
      new Set(),
      CONTENT,
    ).visitors["place-1"];
    const notHeld = settleAttractionVisits(
      { seed: 1, rngState: {}, visitors: {} as VisitorsByPlacement },
      next.firedAttractionVisits,
      returnAt,
      isCaught,
      new Set(),
      {
        ...CONTENT,
        tuning: {
          attractions: { ...contentTuning.attractions, holdLastVisitOpen: false },
        },
      },
    ).visitors["place-1"];

    expect(held?.leavesAt).toBe(returnAt + LINGER_MS);
    // Off, the visit expires on its ORIGINAL schedule — long gone by the
    // time this player got back, which is precisely the unkindness the
    // shipped `true` exists to prevent.
    expect(notHeld?.leavesAt).toBe((notHeld?.arrivedAt ?? 0) + LINGER_MS);
    expect(notHeld?.leavesAt).toBeLessThan(held?.leavesAt ?? 0);
    // And the shipped value really is the kind one, so this suite proves
    // something about the GAME and not only about the branch.
    expect(contentTuning.attractions.holdLastVisitOpen).toBe(true);
  });
});

describe("trust never decreases across any absence (2C §0.1's may-never-decrease table)", () => {
  it("no absence, of any length, can ever reduce an existing visitor's trust", () => {
    for (const days of [0.1, 1, 3, 7, 30]) {
      const existingVisitor = {
        placementId: "place-1",
        speciesId: "alpha",
        name: "Regular",
        genome: { speciesId: "alpha", palette: "p", pattern: "s", personalityId: "curious", shiny: false },
        arrivedAt: SAVED_AT - 1000,
        leavesAt: SAVED_AT - 500,
        trust: 2,
        fedThisVisit: false,
        visits: 1,
      };
      const { next } = runAbsence(days * 24 * HOUR_MS);
      const settled = settleAttractionVisits(
        { seed: 1, rngState: {}, visitors: { "place-1": existingVisitor } },
        next.firedAttractionVisits,
        SAVED_AT + days * 24 * HOUR_MS,
        isCaught,
        new Set(),
        CONTENT,
      );
      const trust = settled.visitors["place-1"]?.trust ?? existingVisitor.trust;
      expect(trust).toBeGreaterThanOrEqual(2);
    }
  });
});
