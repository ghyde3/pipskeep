/**
 * Recipe registry (spec §6.2's registry promise, cashed — docs/
 * economy-bible.md §3–§4): the Craft Table's book. Recipes are content;
 * `core/crafting` only executes them (spec §3) — adding a recipe is a
 * registry edit here and nothing else.
 *
 * THE BOOK, AND THE TWO THINGS THE FIX STAGE CHANGED ABOUT IT.
 *
 * The round's first cut shipped four recipes: Poultice, Feastpot,
 * Toastnut and Honeydrop. The economy audit killed the last two and
 * restored the five the round had cut, for one reason each:
 *
 *   ✂ **Toastnut** (`1 wood + 4 berry → 2 Toastnut`) was strictly
 *     NUTRITION-NEGATIVE: 4 Berries are 180 Hunger, 2 Toastnut are 110
 *     Hunger + 12 Energy. It destroyed 70 Hunger and 30 minutes of a
 *     Pip's life to gain 12 Energy, draining a surplus (berry banks 3307
 *     over 30 engaged days) into another surplus (toastnut banks 896 with
 *     no crafting at all, mostly from one Stockpot). Its card line —
 *     "turns a glut of Berries into something that travels" — described
 *     the berries→toastnut→Waybread/Trail Kit chain, and Waybread and
 *     Trail Kit were cut, so the middle of the web led nowhere. A recipe
 *     a rational player never makes is a shipped dead feature (spec §16
 *     v1.3). CUT, not repriced: nothing downstream wants it.
 *
 *   ✂ **Honeydrop** (`2 fiber + 4 berry → 2 Honeydrop`) was DOMINATED by
 *     the tier-1 trail it existed to save you from revisiting. One
 *     Bramblewick trip drops 1.974 Honeydrop — plus 3.55 fiber, 1.58
 *     berry, 1.58 toastnut, 0.32 poultice and a 25% egg chance — so 30
 *     engaged days bank 65 Honeydrops nobody asked for. Its only real
 *     demand is one per Mosspip you want to push to the "sunorchard"
 *     variant: a handful, ever. CUT.
 *
 *   ✚ **The five craft-only KEEPSAKES** (§4.4) are back, because the
 *     audit found the round had no repeatable sink at all: measured over
 *     30 engaged days at tier 12, lodestone income was 312 against a
 *     plausible spend of 4, and no build item cost lodestone. Every sink
 *     the round shipped was one-time (the 11-purchase ladder, the 45-item
 *     catalogue), so from day 18 a player had an income and nothing to
 *     spend it on. A craft-only decoration is repeatable, permanent, and
 *     priced in lodestone — you can place as many as you have grid for.
 *
 * That leaves the book at SEVEN: the cure, the Album's last key, and five
 * things for the Keep that cannot be bought.
 *
 * WHY THEY ARE CRAFT-ONLY, which is the part the first cut got right and
 * then used as a reason to cut them: a crafted decoration that is ALSO on
 * the Build sheet is a recipe a rational player never uses — buying is
 * instant and ties up no Pip, so purchase strictly dominates crafting.
 * The fix is not to cut the recipe, it is to take away the other door:
 * `DecorationDef.craftOnly` (with `cost: {}`), filtered out of
 * `ui/buildMode.ts`'s catalogue and refused by `core/state.ts`'s
 * PLACE_ITEM unless a copy is on the Keepsake Shelf. All 32 shipped
 * decorations remain directly purchasable, untouched.
 *
 * I2 (bible §0.2, restated so a future addition cannot violate it by
 * accident): NO RECIPE MAY OUTPUT A BASE RESOURCE. `reachability.test.ts`
 * models expeditions as the only faucet; a recipe minting wood, fiber,
 * shell, driftwood or lodestone would be invisible to it and could break
 * the gating claim silently. Asserted over the whole registry in
 * `core/crafting/balance.test.ts`.
 *
 * Every resource/Satchel input named below is obtainable at or before the
 * recipe's own `unlockKeepLevel` — enforced, not asserted by hand, by
 * `content/validate.ts`'s `itemsObtainableFromExpeditionsAt` check AND by
 * `core/economy/reachability.test.ts`'s `pricedRecipes` rows (both
 * layers: structural and rate).
 *
 * STILL DELIBERATELY CUT, and recorded here rather than discovered later:
 * **Waybread** and **Trail Kit**, the two one-trip PROVISIONS of bible
 * §4.3. They need a consumption seam at send-off (`ASSIGN_EXPEDITION` →
 * `ActiveExpedition`, exactly the shape round 2H's `careful` flag already
 * uses), a send-off card row, and two new non-food inventory ids. That is
 * a coherent, self-contained round of its own; `tuning.crafting`'s
 * `waybreadBonusRollChance`/`trailKitContractReduction` were REMOVED with
 * them, so no live number is left drifting out of calibration unread.
 */

import type { RecipeOutput, RecipeView } from "../core/crafting";
import type { KeepLevel } from "../core/keep";
import type { IconSpec } from "./icons";

export interface RecipeDef extends RecipeView {
  readonly name: string;
  readonly unlockKeepLevel: KeepLevel;
  readonly output: RecipeOutput;
  readonly icon: IconSpec;
  /** Warm, opinionated one-liner (spec §15.5) shown on the recipe card. */
  readonly flavor: string;
  /** THE "why would I make this" line (bible §4.6) — required, not
   * optional, the same discipline progression bible §4.1 already applies
   * to item copy. */
  readonly effectCopy: string;
  /** Seasonal seam (spec §12's surviving convention). Nothing reads this
   * yet. */
  readonly availableWindow?: { readonly from: string; readonly to: string };
}

export const RECIPE_IDS = [
  "poultice",
  "feastpot",
  "lodestone-cairn",
  "herb-rail",
  "chime-rail",
  "compass-rose",
  "wayhome-lantern",
] as const;
export type RecipeId = (typeof RECIPE_IDS)[number];

export const recipes: Readonly<Record<RecipeId, RecipeDef>> = {
  /**
   * THE CURE — the recipe this round exists for. Round 2H's cruelty audit
   * found the only working cure was undiscoverable: the Poultice drops at
   * weight 4 on the three DEEP trails, which are exactly the three trails
   * that inflict the ailments, so the game's answer to "my Pip came home
   * ill" was "go run the dangerous trail again and hope". The remedy and
   * the risk were the same activity.
   *
   * The fix is AVAILABILITY, not power: `poulticeCureChance` (0.55),
   * `cureEscalationPerAttempt`, `cureBonusMax` and the free daily devoted-
   * care roll are all untouched (I4). And it is guarded from the other
   * direction too — see `tuning.crafting.poulticeMinMinutesPerCraft` and
   * `core/crafting/balance.test.ts`'s CURE CEILING: the best-equipped Keep
   * in the game cannot produce more than one Poultice per RATED hour, which
   * is strictly slower than farming them on the deep trails. Crafting is
   * the slower route; its whole value is that it is the certain one.
   */
  poultice: {
    id: "poultice",
    name: "Poultice",
    unlockKeepLevel: 4,
    resources: { fiber: 6, lodestone: 1 },
    output: { kind: "item", itemId: "poultice", count: 1 },
    durationMs: 75 * 60_000,
    // ROUND 2J FIX STAGE — every recipe carries a DIFFERENT motif. The
    // round's first cut gave all four `{ motif: "bench" }`, so the book
    // read as four copies of one card on a 375px screen; the icon
    // vocabulary progression-bible §4.2 built exists precisely so that
    // does not happen.
    icon: { motif: "droplet" },
    flavor: "A warm wrap of leaves and something sharp-smelling underneath.",
    // Reuses the shipped cure item's own effect line (bible §4.6) — the
    // same cure, now with a door that does not depend on luck.
    effectCopy: "Give it to an ailing Pip — a real chance to cure them.",
  },
  /**
   * THE ALBUM'S LAST PAGE. The Feastpot is the rarest item in the game and
   * the sole gift key to the Lanternpip's "festival" variant — 2 in 112
   * across 16 rolls, i.e. one per 3.5 Grotto trips, a 5.25-hour expected
   * tail on the FINAL collectible. This removes that tail without touching
   * a single drop weight.
   *
   * It does not break round 2B's deep-trip identity: every Satchel input is
   * Lanterngrotto or Shore loot, so you still have to go to the Grotto. The
   * recipe converts the cave's abundant foods into its rare one; it is not
   * a second door.
   */
  feastpot: {
    id: "feastpot",
    name: "Feastpot",
    unlockKeepLevel: 6,
    resources: { lodestone: 4 },
    items: { emberloaf: 2, glowcap: 2, tideroll: 1 },
    output: { kind: "item", itemId: "feastpot", count: 1 },
    durationMs: 90 * 60_000,
    icon: { motif: "pot" },
    flavor: "Everything the cave had, in one pot. Somebody will remember this meal forever.",
    effectCopy: "The last page of the Album stops waiting on luck alone.",
  },
  /**
   * THE FIVE CRAFT-ONLY KEEPSAKES (bible §4.4) — the round's repeatable
   * sink, and the only things in the game whose price is paid in the late
   * resource. Each outputs `{ kind: "keepsake" }`: the copy lands on round
   * 2F's Keepsake Shelf, is placed with `Placement.granted = true`, and
   * REMOVE_ITEM returns it to the shelf while refunding NO resources — so
   * the refund-printer exploit is closed by shipped machinery, for free.
   *
   * Escalating in lodestone across the tiers they unlock on (4 → 2 → 3 → 8
   * → 12), so the resource keeps meaning something from the moment it
   * arrives to well past the end of the ladder.
   */
  "lodestone-cairn": {
    id: "lodestone-cairn",
    name: "Lodestone Cairn",
    unlockKeepLevel: 4,
    resources: { lodestone: 4, shell: 2 },
    output: { kind: "keepsake", itemId: "lodestone-cairn", count: 1 },
    durationMs: 45 * 60_000,
    icon: { motif: "stone" },
    flavor: "Three stones, balanced, pointing. Trips out go a little more carefully near it.",
    effectCopy: "The first thing you can build against risk — every trip out is 4% safer.",
  },
  "herb-rail": {
    id: "herb-rail",
    name: "Herb Rail",
    unlockKeepLevel: 5,
    resources: { fiber: 8, lodestone: 2 },
    items: { glowcap: 1 },
    output: { kind: "keepsake", itemId: "herb-rail", count: 1 },
    durationMs: 60 * 60_000,
    icon: { motif: "leaf" },
    flavor: "Everything drying in one place, where you can reach it at three in the morning.",
    effectCopy: "Every cure you try is 3% likelier to work — jars and free daily chances alike.",
  },
  "chime-rail": {
    id: "chime-rail",
    name: "Chime Rail",
    unlockKeepLevel: 6,
    resources: { lodestone: 3, driftwood: 4, fiber: 3 },
    output: { kind: "keepsake", itemId: "chime-rail", count: 1 },
    durationMs: 60 * 60_000,
    icon: { motif: "chime" },
    flavor: "Lodestone rings differently. Work goes quicker when something is keeping time.",
    effectCopy: "Every craft at every bench finishes 6% sooner.",
  },
  "compass-rose": {
    id: "compass-rose",
    name: "Compass Rose",
    unlockKeepLevel: 8,
    resources: { lodestone: 8, shell: 4, driftwood: 4 },
    output: { kind: "keepsake", itemId: "compass-rose", count: 1 },
    durationMs: 90 * 60_000,
    icon: { motif: "spark" },
    flavor: "Laid into the ground at the gate. Nobody gets lost on the way back.",
    effectCopy: "Trips come home 4% sooner — two tiers before the Beacon does it for you.",
  },
  "wayhome-lantern": {
    id: "wayhome-lantern",
    name: "Wayhome Lantern",
    unlockKeepLevel: 10,
    resources: { lodestone: 12, shell: 6, driftwood: 6, wood: 8 },
    output: { kind: "keepsake", itemId: "wayhome-lantern", count: 1 },
    durationMs: 90 * 60_000,
    icon: { motif: "lantern" },
    flavor: "The biggest light the Keep has. It is not for finding your way out.",
    effectCopy: "+3% Keep XP from everything you do, and the largest lodestone sink in the game.",
  },
};
