/**
 * Job registry (spec §6.2). Gathering (Gathering Station) shipped at MVP;
 * ROUND 2B adds Simmering (Stockpot, content bible §5.4) as PURE content —
 * `core/keep/jobs.ts` and `ui/focusView.ts` find a job by scanning this
 * registry for a placement whose `itemId` hosts one, so a second job is
 * no core/render change at all. Structured as a REGISTRY so
 * Crafting/Decorating slot in later the same way (spec §6.2's named
 * seam); numbers live in tuning.ts like every other tunable.
 */

import { tuning } from "./tuning";

export interface JobLootEntry {
  /** A resource id or food id; validation is the source of truth. */
  itemId: string;
  /** Relative weight, > 0. */
  weight: number;
}

export interface JobDef {
  id: string;
  name: string;
  /** Placeable that hosts this job (spec §6.2: a PLACED station). */
  stationItemId: string;
  /** One resource produced per this many ms (spec §6.2: 10 min default). */
  intervalMs: number;
  /** The station's weighted production table (Berries 70 / Fiber 30). */
  table: readonly JobLootEntry[];
  /**
   * ROUND 2B (content bible §8.2.4, a fence exception): present-participle
   * verb for the focus view's assigned-job note — "${pip.name} is
   * ${verbing} away". Without this, `ui/focusView.ts` hard-coded
   * "gathering", so a Pip working the Stockpot was described as gathering.
   */
  verbing: string;
  /** Shown in place of the assigned note when the working Pip is Resting
   * instead (content bible §8.2.4) — job-specific, so "the basket can
   * wait" doesn't describe a pot. */
  restingNote: string;
  /**
   * ROUND 2J FIX STAGE — the warm one-liner on the focus view's job card.
   * `ui/focusView.ts` hard-coded ONE Gathering-Station string ("Steady
   * paws, steady snacks — the basket fills itself. Almost.") onto every
   * job card in the game, so the Stockpot, the Workbench and the Craft
   * Table all described a basket. For Crafting that is not merely wrong
   * but misleading — it is the one job that fills nothing on its own.
   * Content-owned for the same reason `verbing`/`restingNote` are.
   */
  cardFlavor: string;
  /**
   * ROUND 2J (docs/economy-bible.md §3.2) — "production" (Gathering/
   * Simmering/Mending: a weighted table on a fixed interval) or
   * "crafting" (a queue of recipes, `core/crafting`). Absent ≡
   * "production", so all three shipped jobs stay byte-identical.
   * `content/validate.ts`'s job rules (`intervalMs > 0`, non-empty
   * `table`) branch on this; `core/keep/jobs.ts`'s `processJobProduction`/
   * `collectJobCatchupEvents` need no edit at all — a crafting job's
   * `intervalMs: 0` already trips their existing `intervalMs <= 0` skip.
   */
  kind?: "production" | "crafting";
}

export const jobs: Readonly<Record<string, JobDef>> = {
  gathering: {
    id: "gathering",
    name: "Gathering",
    stationItemId: "gathering-station",
    intervalMs: tuning.gathering.intervalMs,
    table: Object.entries(tuning.gathering.table).map(([itemId, weight]) => ({
      itemId,
      weight,
    })),
    verbing: "gathering",
    restingNote: "Fast asleep. The basket can wait; the dream cannot.",
    cardFlavor: "Steady paws, steady snacks — the basket fills itself. Almost.",
  },
  /**
   * ROUND 2B (content bible §5.4): the Stockpot's job — the pantry to
   * Gathering's materials faucet. Slower (30 min vs 10) and food-only
   * (Berry/Toastnut, deliberately no Stew — see tuning.ts's `jobs.simmering`
   * comment), so it never competes with Gathering as the wood/fiber route.
   */
  simmering: {
    id: "simmering",
    name: "Simmering",
    stationItemId: "stockpot",
    intervalMs: tuning.jobs.simmering.intervalMs,
    table: Object.entries(tuning.jobs.simmering.table).map(([itemId, weight]) => ({
      itemId,
      weight,
    })),
    verbing: "simmering",
    restingNote: "Fast asleep. The pot will keep without them; the dream cannot.",
    cardFlavor: "Something has been on the heat since this morning. Nobody is entirely sure what.",
  },
  /**
   * ROUND 2F (docs/progression-bible.md §3.4): the THIRD job, at the
   * Workbench (tier 8) — pure content again, same registry-scan mechanism
   * as Simmering. Slowest cadence and materials-only, the late-game
   * complement to Gathering's mixed faucet and Simmering's pantry.
   */
  mending: {
    id: "mending",
    name: "Mending",
    stationItemId: "workbench",
    intervalMs: tuning.jobs.mending.intervalMs,
    table: Object.entries(tuning.jobs.mending.table).map(([itemId, weight]) => ({
      itemId,
      weight,
    })),
    verbing: "mending",
    restingNote: "Fast asleep. The mending will keep.",
    cardFlavor: "Split handles, frayed rope, a wobbly leg. All of it fixable, given an afternoon.",
  },
  /**
   * ROUND 2J (docs/economy-bible.md §3.1–§3.2): the Craft Table's job.
   * Unlike its three siblings this is a QUEUE of recipes, not a weighted
   * table on a fixed interval — `intervalMs: 0` and an empty `table` are
   * deliberate (see `kind`'s own doc comment: the existing
   * `intervalMs <= 0` skip in `core/keep/jobs.ts` already treats this as
   * "nothing to produce here", so `processJobProduction`/
   * `collectJobCatchupEvents` need no change at all). The ACTUAL recipe
   * queue lives in `state.crafts[stationPlacementId]`, owned by
   * `core/crafting`.
   */
  crafting: {
    id: "crafting",
    name: "Crafting",
    stationItemId: "craft-table",
    kind: "crafting",
    intervalMs: 0,
    table: [],
    verbing: "crafting",
    restingNote: "Fast asleep. The bench will keep; the dream cannot.",
    cardFlavor: "Nothing gets made here until somebody says what. Open the Craft Table and pick a recipe.",
  },
};
