/**
 * THE ISOLATION RULE (docs/retention-bible.md §0.4/§12.1) — the fragile
 * invariant of this round, the equivalent of round 2B's level-1 wood
 * ceiling: nothing in the progression stack may read or reference the
 * tuning keys round 2A/2B's balance rests on. This test makes that
 * mechanical rather than aspirational, per the bible's own instruction:
 * "Add one guard: `retention.isolation.test.ts` asserts that no module
 * under the new retention systems imports or references those tuning
 * keys."
 *
 * Comments are stripped before scanning — several of these modules
 * document the isolation rule BY NAME in their own doc comments (that is
 * the whole point of writing it down), so the guard must check CODE, not
 * prose about the rule.
 */

import { describe, expect, it } from "vitest";

const rawSources = import.meta.glob(
  [
    "./streak.ts",
    "./mastery.ts",
    "./multipliers.ts",
    "./pity.ts",
    "./bounties.ts",
    "./milestones.ts",
    "./events.ts",
    "../../content/milestones.ts",
    "../../content/events.ts",
    "../../content/bountyTemplates.ts",
  ],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

/** Strip `/* … *\/` block comments and `// …` line comments so the scan
 * below only ever sees CODE. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** The isolation list (bible §0.4 / §12.1), as CODE patterns: a bare key
 * for the top-level ones, and a `.care.` / `.foods.` property-access
 * pattern for the two nested ones (so an unrelated "foods" substring in
 * an import path or a variable name like `contentFoods` never false-
 * positives — the ACCESS `something.foods.xxx` is what's forbidden). */
const BANNED_PATTERNS: readonly RegExp[] = [
  /\bneedDecayPerHour\b/,
  /\bpersonalityDecayMultipliers\b/,
  /\bofflineRateCapMs\b/,
  /\bsulkExitThreshold\b/,
  /\bplayRefusal\b/,
  /\.care\s*\./,
  /\.foods\s*\./,
];

describe("retention.isolation — no progression module touches the isolation list", () => {
  const entries = Object.entries(rawSources);

  it("scanned at least the expected number of files (not a vacuous pass)", () => {
    expect(entries.length).toBe(10);
  });

  for (const [path, raw] of entries) {
    it(`${path} references none of the isolation-list tuning keys in code`, () => {
      const code = stripComments(raw);
      for (const pattern of BANNED_PATTERNS) {
        expect(pattern.test(code), `${path} matched ${pattern}`).toBe(false);
      }
    });
  }
});
