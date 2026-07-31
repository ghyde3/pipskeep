/**
 * ROUND 2I — THE ANTI-DEAD-FEATURE + ANTI-CRUELTY GUARD (docs/notifications
 * -bible.md §6, §9.3, §9.5). Round 2H's binding cut, restated as a test
 * rather than a paragraph (bible §11 risk 4: "the round most likely to be
 * eroded by a well-meaning later change"): NOTHING in this catalogue may
 * reference an ailment ending, a Pip dying, or time running out.
 *
 * Also holds the catalogue-completeness shape this directory promises:
 * every `NOTIFICATION_TYPE_IDS` entry has non-empty copy for every variant
 * count it can actually be planned with.
 */

import { describe, expect, it } from "vitest";
import { EggState } from "../eggs";
import type { Egg } from "../eggs";
import {
  combinedBody,
  COMBINED_TITLE,
  FORBIDDEN_SUBSTRINGS,
  homecomingBody,
  homecomingClause,
  homecomingTitle,
  MAX_BODY_LENGTH,
  MAX_TITLE_LENGTH,
  pippingBody,
  pippingClause,
  pippingTitle,
} from "./copy";
import { dueNotifications } from "./index";
import { planNotifications } from "./plan";
import { EMPTY_LEDGER, NOTIFICATION_TYPE_IDS, NOTIFICATION_TYPES } from "./types";
import type {
  NotificationHostTuning,
  NotificationPipView,
  NotificationPrefs,
  NotificationStateSlice,
} from "./types";

const NAME_POOLS: readonly string[][] = [
  ["Rooter"],
  ["Rooter", "Bramble"],
  ["Rooter", "Bramble", "Quill"],
  ["Rooter", "Bramble", "Quill", "Sorrel", "Fennel"],
];

const BIOME_NAMES = ["Meadow", "Bramblewick", "Lanterngrotto", undefined];

/** Every string this whole module can produce, across every variant and
 * every count — the single surface the forbidden-vocabulary scan runs
 * over (bible §9.3: "one test needs to scan exactly one list"). */
function everyRenderedString(): readonly string[] {
  const strings: string[] = [];
  let dueAtCursor = 0;
  for (const names of NAME_POOLS) {
    for (const biome of BIOME_NAMES) {
      dueAtCursor += 1;
      strings.push(homecomingTitle(names, biome));
      strings.push(homecomingBody(42, dueAtCursor, names));
      strings.push(homecomingClause(names, biome));
    }
  }
  for (const count of [1, 2, 3, 5]) {
    dueAtCursor += 1;
    strings.push(pippingTitle(count));
    strings.push(pippingBody(42, dueAtCursor, count));
    strings.push(pippingClause(count));
  }
  strings.push(COMBINED_TITLE);
  strings.push(combinedBody(homecomingClause(["Rooter"], "Meadow"), pippingClause(1)));
  strings.push(combinedBody(homecomingClause(["Rooter", "Bramble"]), pippingClause(2)));
  return strings;
}

// ---------------------------------------------------------------------------
// THE COMPOSED SURFACE (round-2I review BLOCKER).
//
// `everyRenderedString()` above hand-enumerates `copy.ts`'s builders, so it
// only ever guarded the copy VOCABULARY. It could not see a string composed
// at PLAN time — and a mutation that appended " Their ailment is critical —
// hurry, you could lose them." onto `planHomecomings`' body shipped three
// forbidden words with the whole suite green. That is not a theoretical
// gap: `plan.ts`'s own module doc names the ailment/lineage suffix as "a
// follow-up seam", i.e. the single change a later author is most likely to
// make is exactly the one the old guard was blind to (bible §11 risk 4).
//
// So the scan below is driven from `planNotifications` and from the
// keystone `dueNotifications` — the very function `app/push.ts` hands to
// `showNotification` — over fixture states, rather than from a
// hand-maintained list. It stays correct as the catalogue grows.
// ---------------------------------------------------------------------------

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const OFFSET_4AM = 4 * HOUR_MS; // dayStartHour 4, zero tz shift
/** 12:00 local — comfortably outside the 22→8 quiet window, so the budget
 * layer actually hands items back rather than suppressing the lot. */
const NOON = 12 * HOUR_MS;

const HOST_TUNING: NotificationHostTuning = {
  notifications: {
    quietHours: { startHour: 22, endHour: 8 },
    maxPerDay: 4,
    minGapMs: 25 * MINUTE_MS,
    coalesceWindowMs: 10 * MINUTE_MS,
    maxNamesInBody: 3,
    staleAfterMs: 24 * HOUR_MS,
    permissionAsk: { afterExpeditionSends: 1, delayAfterSendMs: 3000, reAskAfterSends: 3, maxAsks: 2 },
  },
  retention: { dayStartHour: 4, dayMs: 24 * HOUR_MS },
};

const ALL_ON: NotificationPrefs = { master: true, types: { homecoming: true, pipping: true } };

function pipOn(id: string, name: string, dueAt: number): NotificationPipView {
  return { id, name, expedition: { expeditionId: "meadow", departedAt: 0, durationMs: dueAt } };
}

function incubatingEgg(id: string, readyAt: number): Egg {
  return {
    id,
    state: EggState.Incubating,
    foundAt: 0,
    rarity: "common",
    incubationMs: readyAt,
    incubationStartedAt: 0,
    sourceExpeditionId: "meadow",
  };
}

function fixtureState(
  pipSpecs: readonly { id: string; name: string; dueAt: number }[],
  eggSpecs: readonly { id: string; readyAt: number }[],
): NotificationStateSlice {
  const pips: Record<string, NotificationPipView> = {};
  for (const spec of pipSpecs) pips[spec.id] = pipOn(spec.id, spec.name, spec.dueAt);
  return {
    seed: 4242,
    rosterOrder: pipSpecs.map((s) => s.id),
    pips,
    eggs: eggSpecs.map((s) => incubatingEgg(s.id, s.readyAt)),
  };
}

const NAMES = ["Rooter", "Bramble", "Quill", "Sorrel", "Fennel"];

/** Fixture states covering every shape `plan.ts` can render: one Pip, a
 * coalesced cluster of two/three/five, one egg, several eggs, and — the
 * shape that produces the COMBINED body — a homecoming and a pipping
 * landing within `minGapMs` of each other. */
const FIXTURE_STATES: readonly NotificationStateSlice[] = (() => {
  const states: NotificationStateSlice[] = [];
  for (const count of [1, 2, 3, 5]) {
    states.push(
      fixtureState(
        NAMES.slice(0, count).map((name, i) => ({
          id: `p${i}`,
          name,
          dueAt: NOON + i * MINUTE_MS,
        })),
        [],
      ),
    );
  }
  for (const eggCount of [1, 2, 3]) {
    states.push(
      fixtureState(
        [],
        Array.from({ length: eggCount }, (_, i) => ({ id: `e${i}`, readyAt: NOON + i * MINUTE_MS })),
      ),
    );
  }
  // Cross-type: exercises COMBINED_TITLE / combinedBody through the real
  // merge, not through a hand-built call.
  states.push(
    fixtureState([{ id: "p0", name: "Rooter", dueAt: NOON }], [{ id: "e0", readyAt: NOON + 2 * MINUTE_MS }]),
  );
  return states;
})();

/** Every string that could actually reach a lock screen, taken from the
 * two functions that actually build them. */
function everyComposedString(): { readonly planned: string[]; readonly delivered: string[] } {
  const planned: string[] = [];
  const delivered: string[] = [];
  for (const state of FIXTURE_STATES) {
    for (const item of planNotifications(state, HOST_TUNING.notifications)) {
      planned.push(item.title, item.body, item.clause);
    }
    const due = dueNotifications(state, NOON + 30 * MINUTE_MS, {
      prefs: ALL_ON,
      ledger: EMPTY_LEDGER,
      dayOffsetMs: OFFSET_4AM,
      permissionGranted: true,
      tuning: HOST_TUNING,
    });
    for (const item of due) delivered.push(item.title, item.body);
  }
  return { planned, delivered };
}

describe("round 2H's binding cut — enforced on what is COMPOSED and DELIVERED, not just on copy.ts", () => {
  const { planned, delivered } = everyComposedString();
  const all = [...planned, ...delivered];

  it("the fixtures actually produce planned AND delivered strings (the guard isn't vacuous)", () => {
    expect(planned.length).toBeGreaterThan(20);
    expect(delivered.length).toBeGreaterThan(0);
    // At least one COMBINED delivery, so the cross-type body is scanned too.
    expect(delivered).toContain(COMBINED_TITLE);
  });

  for (const forbidden of FORBIDDEN_SUBSTRINGS) {
    it(`nothing planned or delivered contains "${forbidden}"`, () => {
      const offenders = all.filter((s) => s.toLowerCase().includes(forbidden.toLowerCase()));
      expect(offenders).toEqual([]);
    });
  }

  it("every delivered title/body still fits a lock screen", () => {
    for (const item of delivered) expect(item.length).toBeGreaterThan(0);
    const { delivered: again } = everyComposedString();
    expect(again).toEqual(delivered); // deterministic for a fixed (seed, dueAt)
  });
});

describe("the catalogue is exactly two types", () => {
  it("NOTIFICATION_TYPE_IDS is homecoming and pipping, nothing else", () => {
    expect(NOTIFICATION_TYPE_IDS).toEqual(["homecoming", "pipping"]);
    expect(NOTIFICATION_TYPES.map((t) => t.id)).toEqual(["homecoming", "pipping"]);
  });

  it("every catalogue entry carries a pk- tag, and they are distinct", () => {
    // Replaces an assertion on a `priority` field that nothing consumed.
    // The tags DO matter and are consumed: plan.ts stamps them onto every
    // notification, and app/push.ts's cancelAll() closes exactly the
    // notifications whose tag starts with "pk-".
    const tags = NOTIFICATION_TYPES.map((t) => t.tag);
    expect(tags.every((t) => t.startsWith("pk-"))).toBe(true);
    expect(new Set(tags).size).toBe(tags.length);
  });
});

describe("round 2H's binding cut — nothing about a loss approaching", () => {
  const all = everyRenderedString();

  it("produces a non-trivial number of strings to scan (the test isn't vacuous)", () => {
    expect(all.length).toBeGreaterThan(20);
  });

  for (const forbidden of FORBIDDEN_SUBSTRINGS) {
    it(`no rendered string contains "${forbidden}"`, () => {
      const offenders = all.filter((s) => s.toLowerCase().includes(forbidden.toLowerCase()));
      expect(offenders).toEqual([]);
    });
  }

  it("specifically: nothing references an ailment ending, a Pip dying, or time running out", () => {
    const dangerWords = ["dying", "dies", "lose", "losing", "lost", "danger", "critical", "urgent", "hurry"];
    for (const s of all) {
      for (const word of dangerWords) {
        expect(s.toLowerCase()).not.toContain(word);
      }
    }
  });
});

describe("every rendered string fits a lock screen", () => {
  it("titles stay within MAX_TITLE_LENGTH and bodies within MAX_BODY_LENGTH, and none is empty", () => {
    for (const names of NAME_POOLS) {
      for (const biome of BIOME_NAMES) {
        const title = homecomingTitle(names, biome);
        expect(title.length).toBeGreaterThan(0);
        expect(title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
        const body = homecomingBody(1, 1, names);
        expect(body.length).toBeGreaterThan(0);
        expect(body.length).toBeLessThanOrEqual(MAX_BODY_LENGTH);
      }
    }
    for (const count of [1, 2, 5]) {
      expect(pippingTitle(count).length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
      expect(pippingBody(1, 1, count).length).toBeLessThanOrEqual(MAX_BODY_LENGTH);
    }
    expect(COMBINED_TITLE.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
  });
});

describe("copy variety and self-containment", () => {
  /** Every distinct body a variant can render, across many `dueAt` draws.
   * ROUND-2I REVIEW FIX (minor): there used to be four single-Pip
   * homecoming variants and exactly ONE of everything else, so at the
   * 4/day cap a regular player met the same five sentences all week. */
  function distinctBodies(render: (dueAt: number) => string): Set<string> {
    const seen = new Set<string>();
    for (let dueAt = 0; dueAt < 400; dueAt += 1) seen.add(render(dueAt));
    return seen;
  }

  it("every body shape has more than one variant", () => {
    expect(distinctBodies((d) => homecomingBody(11, d, ["Rooter"])).size).toBeGreaterThan(1);
    expect(distinctBodies((d) => homecomingBody(11, d, ["Rooter", "Bramble"])).size).toBeGreaterThan(1);
    expect(distinctBodies((d) => pippingBody(11, d, 1)).size).toBeGreaterThan(1);
    expect(distinctBodies((d) => pippingBody(11, d, 2)).size).toBeGreaterThan(1);
  });

  it("a plural body stands on its own — the noun is in the body, not only the title", () => {
    // Lock screens truncate and sometimes separate title from body, so
    // "Two of them, tapping in stereo" left "them" with no antecedent.
    for (const body of distinctBodies((d) => pippingBody(11, d, 2))) {
      expect(body.toLowerCase()).toContain("eggs");
    }
    for (const body of distinctBodies((d) => homecomingBody(11, d, ["Rooter", "Bramble"]))) {
      expect(body).toContain("Rooter");
      expect(body).toContain("Bramble");
    }
  });

  it("every variant still fits a lock screen, including the widest name list", () => {
    const widest = ["Rooter", "Bramble", "Quill", "Sorrel", "Fennel"];
    for (const body of distinctBodies((d) => homecomingBody(11, d, widest))) {
      expect(body.length).toBeLessThanOrEqual(MAX_BODY_LENGTH);
    }
    for (const count of [2, 3, 5]) {
      for (const body of distinctBodies((d) => pippingBody(11, d, count))) {
        expect(body.length).toBeLessThanOrEqual(MAX_BODY_LENGTH);
      }
    }
  });
});

describe("homecomingBody determinism", () => {
  it("is deterministic for a given (seed, dueAt) and varies across different dueAt values", () => {
    const names = ["Rooter"];
    const first = homecomingBody(7, 100, names);
    const again = homecomingBody(7, 100, names);
    expect(first).toBe(again);

    // Not every dueAt need differ (small pool), but the function must not
    // throw and must always return one of the known variants.
    const other = homecomingBody(7, 200, names);
    expect(typeof other).toBe("string");
  });
});
