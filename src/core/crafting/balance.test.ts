/**
 * CRAFTING BALANCE — the guards round 2J named and did not write.
 *
 * Two comments in the shipped tree pointed at "crafting.balance.test.ts"
 * as the file that asserted the round's own second named guard
 * (`content/tuning.ts`'s `poulticeMinMinutesPerCraft` block, and
 * `core/crafting/index.ts`'s `effectiveCraftDurationMs` doc). The file did
 * not exist, `poulticeMinMinutesPerCraft` had zero consumers anywhere in
 * the repo, and `effectiveCraftDurationMs` was only ever exercised against
 * `index.test.ts`'s hand-written `FIXTURE_TUNING` — which hard-codes its
 * own `speedFloorWithLevel: 0.82` and `pipLevelSpeed: [1, 0.95, 0.9]`.
 * The SHIPPED numbers were therefore free to drift to anything: a mutation
 * setting `speedFloorWithLevel` to 0.2 and the last `pipLevelSpeed` entry
 * to 0.2 produced a 15-minute Poultice with a fully green suite.
 *
 * ⚠️ EVERY ASSERTION BELOW READS THE REAL `content/tuning.ts` AND THE REAL
 * `content/recipes.ts`. That is the entire point — a balance test against
 * a fixture proves the arithmetic and nothing about the game.
 */

import { describe, expect, it } from "vitest";
import { tuning } from "../../content/tuning";
import { recipes } from "../../content/recipes";
import { decorations } from "../../content/decorations";
import { placeables } from "../../content/placeables";
import { keepLevels } from "../../content/keep";
import { foods } from "../../content/foods";
import { expeditions } from "../../content/expeditions";
import { jobs } from "../../content/jobs";
import { POULTICE_ITEM_ID } from "../../content/ailments";
import { RESOURCE_IDS } from "../economy";
import { effectiveCraftDurationMs } from "./index";

const MINUTE_MS = 60_000;

/** The best CRAFT-SPEED multiplier any Keep can actually reach: the
 * product of every `craftSpeed` effect in the content tree, clamped once
 * at `crafting.speedMin` exactly as `core/keep/effects.ts` clamps it.
 * Derived from the registries so a future `craftSpeed` item is covered
 * without editing this file. */
function bestBuildingCraftSpeedMultiplier(): number {
  let product = 1;
  for (const item of [...placeables, ...decorations]) {
    for (const effect of item.effects ?? []) {
      // A single item can be placed many times, so the honest worst case
      // for this guard is "as many as you like" — which the clamp below
      // is what actually bounds.
      if (effect.kind === "craftSpeed") product *= effect.multiplier ** 20;
    }
  }
  return Math.min(Math.max(product, tuning.crafting.speedMin), 1);
}

/** The highest Pip level the shipped ladder defines. */
const MAX_PIP_LEVEL = tuning.crafting.pipLevelSpeed.length;

describe("⚠️ THE CURE CEILING (docs/economy-bible.md §4.1, this round's second named guard)", () => {
  /**
   * The claim, in the bible's own words: "the best-equipped Keep in the
   * game cannot produce more than one Poultice per RATED hour, which is
   * strictly slower than farming them on the deep trails. Crafting is the
   * slower route, and its whole value is that it is the safe one and the
   * certain one."
   *
   * Countdowns are measured in RATED time (36–48h), which is why a
   * cadence — not a chance — is the right guard: making poultices
   * craftable must raise the FLOOR ("you can always make one, at a
   * price") without raising the RATE at which anyone can attempt cures.
   */
  it("the best equipment in the entire game cannot make a Poultice faster than the stated ceiling", () => {
    const floorMs = tuning.crafting.poulticeMinMinutesPerCraft * MINUTE_MS;
    const best = effectiveCraftDurationMs(
      recipes.poultice.durationMs,
      MAX_PIP_LEVEL,
      bestBuildingCraftSpeedMultiplier(),
      tuning.crafting,
    );
    expect(best).toBeGreaterThanOrEqual(floorMs);
  });

  it("...and the recipe's own BASE duration clears it too, so no future speed channel starts underwater", () => {
    // The composed floor above can only ever be reached from the base, so
    // a base that already breached the ceiling would make the whole guard
    // unreachable. Stated separately, exactly like
    // `expeditionSpeedFloorWithQuirk` states its own two halves.
    expect(recipes.poultice.durationMs).toBeGreaterThanOrEqual(
      tuning.crafting.poulticeMinMinutesPerCraft * MINUTE_MS,
    );
  });

  it("the composed speed floor is what binds, and it is stated where it can be read", () => {
    // If `speedFloorWithLevel` ever drops below this, the ceiling breaks —
    // and the failure names the actual number rather than surfacing as a
    // confusing duration somewhere else.
    const requiredFloor =
      (tuning.crafting.poulticeMinMinutesPerCraft * MINUTE_MS) / recipes.poultice.durationMs;
    expect(tuning.crafting.speedFloorWithLevel).toBeGreaterThanOrEqual(requiredFloor);
  });

  it("crafting is SLOWER than the free daily route is generous: at most one cure's worth per rated hour", () => {
    const best = effectiveCraftDurationMs(
      recipes.poultice.durationMs,
      MAX_PIP_LEVEL,
      bestBuildingCraftSpeedMultiplier(),
      tuning.crafting,
    );
    const perRatedHour = (60 * MINUTE_MS) / best;
    expect(perRatedHour).toBeLessThanOrEqual(1);
  });

  it("the cure's POWER is untouched by this round (I4): exactly one cure item, at its shipped odds", () => {
    const ailments = tuning.lifecycle.ailments;
    expect(ailments.poulticeCureChance).toBe(0.55);
    expect(ailments.devotedCareCureChance).toBe(0.35);
    expect(ailments.cureEscalationPerAttempt).toBe(0.1);
    expect(ailments.cureBonusMax).toBe(0.45);
    // And the registry still names exactly one cure item.
    const cureOutputs = Object.values(recipes).filter(
      (r) => r.output.kind === "item" && r.output.itemId === POULTICE_ITEM_ID,
    );
    expect(cureOutputs).toHaveLength(1);
    expect(foods[POULTICE_ITEM_ID].hungerRestore).toBe(0);
  });
});

/**
 * ⚠️ ROUND 2J FIX STAGE — §4.5's OFFLINE CAP, guarded where it can be.
 *
 * The review noted the cap is held by exactly ONE unit test with an
 * INJECTED cap value, and that the reducer-level suite explicitly defers
 * on proving the shipped 16h figure bites. Investigating that turned up
 * something better than a synthetic truncation test: with the shipped
 * numbers the cap CANNOT truncate a craft, and that is the bible's own
 * claim — "`maxDurationMs` is 1/10.7 of `offlineRateCapMs`, and a full
 * three-deep queue of the longest recipe is 4.5h, so the cap does not
 * bite until the queue has been empty for eleven hours. It can never cost
 * the player a craft they started."
 *
 * So the honest guard is the RELATIONSHIP, not a faked boundary: raising
 * `maxDurationMs` or `queueMax` past safety is the edit that would make
 * the cap start eating crafts, and it fails here rather than in play.
 */
describe("the offline rate cap can never cost a player a craft they started (§4.5, bible §3.5)", () => {
  it("a full queue of the LONGEST recipe finishes well inside one capped absence", () => {
    const { queueMax, maxDurationMs } = tuning.crafting;
    // The active order plus a full queue behind it.
    const worstCaseMs = (queueMax + 1) * maxDurationMs;
    expect(worstCaseMs).toBeLessThan(tuning.offlineRateCapMs);
    // ...and with real headroom, not by a minute: the bible's stated
    // margin is eleven hours of empty bench before the cap can bite.
    expect(tuning.offlineRateCapMs - worstCaseMs).toBeGreaterThanOrEqual(10 * 60 * MINUTE_MS);
  });

  it("no shipped recipe is longer than the bound, or shorter than the game's slowest existing rhythm", () => {
    for (const recipe of Object.values(recipes)) {
      expect(recipe.durationMs, recipe.id).toBeGreaterThanOrEqual(tuning.crafting.minDurationMs);
      expect(recipe.durationMs, recipe.id).toBeLessThanOrEqual(tuning.crafting.maxDurationMs);
    }
    // 30 minutes is the Simmering cadence — nothing crafts faster than the
    // slowest tick a player already waits for comfortably.
    expect(tuning.crafting.minDurationMs).toBe(tuning.jobs.simmering.intervalMs);
  });
});

describe("I2 — no recipe mints a base resource (docs/economy-bible.md §0.2)", () => {
  it("every recipe output is an item or a keepsake, never one of the five resources", () => {
    for (const recipe of Object.values(recipes)) {
      expect([...RESOURCE_IDS], recipe.id).not.toContain(recipe.output.itemId);
    }
  });
});

describe("I3 — nothing crafted touches need decay (docs/economy-bible.md §0.2)", () => {
  /**
   * Round 2H's arithmetic is exact: the binding personality is Curious,
   * whose worst capped-window drop is `3.7 × 1.15 × 16h = 68.08`, and
   * "still Grumpy from a 90 save" requires `68.08 × (1 − r) > 50`, i.e.
   * `r < 0.26557`. Building comfort already spends 0.25 of that. There are
   * 1.557 percentage points of decay-reduction headroom in the entire
   * game and they are spoken for.
   */
  it("no craft-only keepsake carries a comfort effect", () => {
    for (const item of decorations.filter((d) => d.craftOnly === true)) {
      for (const effect of item.effects ?? []) {
        expect(effect.kind, item.id).not.toBe("comfort");
      }
    }
  });

  it("no recipe outputs anything that could carry one, by construction", () => {
    // A recipe outputs either a food id or a placement item id. Foods have
    // no `effects` field at all; placement items are covered by the
    // craft-only check above plus the content-wide budget guard in
    // `core/keep/effects.balance.test.ts`.
    for (const recipe of Object.values(recipes)) {
      if (recipe.output.kind !== "keepsake") continue;
      const item = decorations.find((d) => d.id === recipe.output.itemId);
      expect(item, `recipe "${recipe.id}"`).toBeDefined();
      expect(item?.craftOnly, recipe.id).toBe(true);
    }
  });
});

describe("the recipe book is a set of decisions, not a list (spec §16 v1.3's standing rule)", () => {
  /**
   * The economy audit killed two of the round's four shipped recipes on
   * exactly this test, applied by hand: the Toastnut destroyed 70 Hunger
   * to gain 12 Energy, and the Honeydrop was dominated on every axis but
   * one by a single tier-1 trip. Both were recipes a rational player never
   * makes — dead features by the standing rule, from a quieter door than
   * "nothing can craft it".
   *
   * The mechanical half of that judgement, held here: a recipe whose
   * output is a FOOD must not consume more nutrition than it produces.
   * The taste half cannot be a test, and is argued in
   * `content/recipes.ts`'s header instead.
   */
  /**
   * THE ORGANISING PRINCIPLE, made mechanical (bible §4): "crafting
   * converts what you have too much of into what you have too little of".
   * An inverted conversion — spending a scarce food to make an abundant
   * one — is a recipe nobody would ever make, and it is checkable against
   * the real drop tables rather than by eye.
   *
   * Measured per trip across every expedition. The shipped Feastpot's
   * tightest ratio is its Tideroll input at 3.15×; the Emberloaf and
   * Glowcap are 7.5× and 10×.
   */
  it("every food a recipe consumes is MORE abundant than the food it produces", () => {
    const perTrip: Record<string, number> = {};
    for (const expedition of Object.values(expeditions)) {
      const weightSum = expedition.lootTable.reduce((sum, entry) => sum + entry.weight, 0);
      if (weightSum <= 0) continue;
      for (const entry of expedition.lootTable) {
        perTrip[entry.itemId] =
          (perTrip[entry.itemId] ?? 0) + expedition.lootRolls * (entry.weight / weightSum);
      }
    }
    for (const recipe of Object.values(recipes)) {
      if (recipe.output.kind !== "item") continue;
      const output = perTrip[recipe.output.itemId] ?? 0;
      for (const inputId of Object.keys(recipe.items ?? {})) {
        expect(
          perTrip[inputId] ?? 0,
          `recipe "${recipe.id}" spends ${inputId} to make something more common`,
        ).toBeGreaterThan(output);
      }
    }
  });

  /**
   * ⚠️ THE RULE THAT WOULD HAVE CAUGHT THE TOASTNUT. A station produces
   * on a cadence, for free, forever: one Stockpot banks ~28.8 Toastnuts a
   * day on its own. A recipe that makes the SAME item is dominated by the
   * station on every axis — it costs inputs, it occupies a Pip, and it is
   * slower — so it is a recipe a rational player never makes, i.e. a
   * shipped dead feature by spec §16 v1.3's standing rule.
   */
  it("no recipe produces something a job station already produces for free", () => {
    const jobOutputs = new Set<string>();
    for (const job of Object.values(jobs)) {
      for (const entry of job.table) jobOutputs.add(entry.itemId);
    }
    for (const recipe of Object.values(recipes)) {
      expect(
        [...jobOutputs],
        `recipe "${recipe.id}" makes what a station already produces on a cadence`,
      ).not.toContain(recipe.output.itemId);
    }
  });

  it("every recipe consumes at least one resource, so crafting always drains the economy", () => {
    for (const recipe of Object.values(recipes)) {
      const total = Object.values(recipe.resources).reduce<number>(
        (sum, n) => sum + (n ?? 0),
        0,
      );
      expect(total, recipe.id).toBeGreaterThan(0);
    }
  });

  /**
   * THE SINK, asserted rather than asserted-about. The blocker this fix
   * stage answers was that lodestone had no REPEATABLE sink: the ladder is
   * 11 one-time purchases, the catalogue is 45 one-time items, and the
   * round's four recipes made consumables whose demand is bounded by how
   * often a Pip falls ill. A craft-only keepsake is repeatable forever.
   */
  /**
   * ⚠️ THE SINK, SIZED. "There is a repeatable sink" is necessary and not
   * sufficient — the audit's measurement was 312 lodestone of income over
   * 30 engaged days against a plausible spend of 4. So this asks the
   * sharper question: how much lodestone does a player spend who builds
   * every CRAFTED channel up to the cap the game already clamps it at?
   *
   * That is genuinely motivated demand, not manufactured waste: each of
   * these effects keeps helping until its own shipped ceiling, and the
   * ceilings are the ones round 2F and 2H already set.
   *
   * Measured against the whole 11-tier ladder (135 lodestone), which is
   * the biggest one-time sink in the game.
   */
  it("building every crafted channel to its shipped cap costs MORE lodestone than the entire Keep ladder", () => {
    const caps = tuning.progression.effectCaps;
    const copiesToReachFraction = (per: number, cap: number): number =>
      per <= 0 ? 0 : Math.ceil(cap / per);
    const copiesToReachFloor = (per: number, floor: number): number =>
      per >= 1 ? 0 : Math.ceil(Math.log(floor) / Math.log(per));

    let lodestone = 0;
    for (const recipe of Object.values(recipes)) {
      if (recipe.output.kind !== "keepsake") continue;
      const item = decorations.find((d) => d.id === recipe.output.itemId);
      const per = recipe.resources.lodestone ?? 0;
      let copies = 0;
      for (const effect of item?.effects ?? []) {
        switch (effect.kind) {
          case "xpBonus":
            copies = Math.max(copies, copiesToReachFraction(effect.fraction, caps.xpBonusMax));
            break;
          case "expeditionSpeed":
            copies = Math.max(
              copies,
              copiesToReachFloor(effect.multiplier, caps.expeditionSpeedMin),
            );
            break;
          case "craftSpeed":
            copies = Math.max(
              copies,
              copiesToReachFloor(effect.multiplier, tuning.crafting.speedMin),
            );
            break;
          case "remedy":
            copies = Math.max(
              copies,
              copiesToReachFraction(
                effect.contractReduction,
                tuning.crafting.buildingRemedyMax.contractReduction,
              ),
              copiesToReachFraction(
                effect.cureBonus,
                tuning.crafting.buildingRemedyMax.cureBonus,
              ),
            );
            break;
          default:
            break;
        }
      }
      lodestone += per * copies;
    }

    const ladderLodestone = keepLevels.reduce(
      (sum, level) => sum + (level.cost.lodestone ?? 0),
      0,
    );
    expect(ladderLodestone).toBeGreaterThan(0);
    expect(lodestone).toBeGreaterThan(ladderLodestone);
  });

  it("lodestone has a repeatable sink: craft-only keepsakes priced in it, at more than one tier", () => {
    const lodestoneKeepsakes = Object.values(recipes).filter(
      (r) => r.output.kind === "keepsake" && (r.resources.lodestone ?? 0) > 0,
    );
    expect(lodestoneKeepsakes.length).toBeGreaterThanOrEqual(3);
    const tiers = new Set(lodestoneKeepsakes.map((r) => r.unlockKeepLevel));
    expect(tiers.size).toBeGreaterThanOrEqual(3);
    // And the build catalogue spends it too, so it is not a crafting-only
    // curiosity: the audit measured the whole catalogue at lodestone 0.
    const catalogueLodestone = [...placeables, ...decorations].reduce(
      (sum, item) => sum + (item.cost.lodestone ?? 0),
      0,
    );
    expect(catalogueLodestone).toBeGreaterThan(0);
  });
});
