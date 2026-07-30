/**
 * THE COPY LINT (docs/retention-bible.md §0.3) — no player-facing string
 * in the new content registries may read as urgency, guilt, or a
 * restore-my-streak upsell. Turns §15.5's tone paragraph into a mechanical
 * guard, per the bible's own instruction: "Enforced by a copy lint:
 * `retention.copy.test.ts` asserts no player-facing string in the new
 * content registries matches
 * `/missed you|don't lose|streak (lost|at risk)|hurry|last chance|
 * expires? in|only \d+ (hours?|days?) left/i`."
 *
 * THIS IS THE CONTENT-REGISTRY HALF ONLY. `src/ui/retention.copy.test.ts` is
 * the other half and the more important one: almost every sentence a returning
 * player actually reads is UI copy (the Doorstep's greeting/streak line/nudge,
 * the dailies sheet's headline/rain-day toast/grace note/reward labels, the
 * Long Meadow's refusals, the Album's cover lines), and a test under `core/`
 * may not import from `ui/` (spec §2's dependency direction) — which is why
 * the guard is split rather than extended in place. Round-2C review found the
 * registry-only scope "cannot catch a regression in any of the strings that
 * matter"; do not treat this file alone as the §0.3 guard.
 */

import { describe, expect, it } from "vitest";
import { MILESTONES } from "../../content/milestones";
import { EVENTS } from "../../content/events";
import { BOUNTY_TEMPLATES } from "../../content/bountyTemplates";

const FORBIDDEN =
  /missed you|don't lose|streak (lost|at risk)|hurry|last chance|expires? in|only \d+ (hours?|days?) left/i;

function collectStrings(): readonly { readonly source: string; readonly text: string }[] {
  const out: { source: string; text: string }[] = [];
  for (const m of MILESTONES) {
    out.push({ source: `milestone:${m.id}:name`, text: m.name });
    out.push({ source: `milestone:${m.id}:blurb`, text: m.blurb });
  }
  for (const e of EVENTS) {
    out.push({ source: `event:${e.id}:name`, text: e.name });
    out.push({ source: `event:${e.id}:blurb`, text: e.blurb });
  }
  for (const b of BOUNTY_TEMPLATES) {
    out.push({ source: `bounty:${b.id}:name`, text: b.name });
  }
  return out;
}

describe("retention.copy — the forbidden-phrase lint", () => {
  const strings = collectStrings();

  it("scanned a real, non-trivial number of strings", () => {
    expect(strings.length).toBeGreaterThan(30);
  });

  for (const { source, text } of strings) {
    it(`${source} contains no urgency/guilt phrasing`, () => {
      expect(FORBIDDEN.test(text), `${source}: "${text}"`).toBe(false);
    });
  }

  it("no countdown-shaped phrasing anywhere (\"N days left\", \"expires in\")", () => {
    for (const { source, text } of strings) {
      expect(/\bleft\b.*\d|\d.*\bleft\b/i.test(text), `${source}: "${text}"`).toBe(false);
    }
  });
});
