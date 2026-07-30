/**
 * Keep level upgrade UI (spec §9 level gates, §6.3 costs, §7.4 roster
 * upgrade; docs/progression-bible.md §1.2/§2/§4.3): the cozy "Keep Lv N"
 * chip opens a card showing THIS tier's XP bar, the NEXT tier's resource
 * bundle and unlock by name, a compact 12-tier road-ahead ladder, the
 * "How the Keep helps" Comfort readout (bible §4.3 — the surface that
 * stops building effects being a dead feature), and the roster upgrade
 * (Cozy Bunks) once the Keep reaches its prerequisite level.
 *
 * ROUND 2F widens the ladder 3 → 12 tiers and adds a SECOND gate: a tier
 * is now EARNED with Keep XP and PAID FOR with resources (bible §1.2) —
 * `affordable` keeps its EXISTING meaning (resources only, so every test
 * written against the shipped card keeps passing unchanged); the new
 * `xpReady` flag is the other half, and `buyable` is both combined. The
 * core reducer (`PURCHASE_KEEP_LEVEL`) already refuses a tap that clears
 * resources but not XP, so this UI-side gate is belt-and-braces honesty,
 * not the only thing standing between a player and a silent no-op.
 *
 * Split like focusView: `buildUpgradeCardModel`/`buildKeepComfortModel`
 * are PURE (node-testable); `createUpgradeCard` is the dumb DOM shell.
 * Costs and prerequisites are read from content/keep.ts and
 * content/tuning.ts — no numbers live here (spec §3).
 */

import type { GameAction, GameState } from "../core/state";
import { keepLevels, keepUpgrades, ROSTER_UPGRADE_ID } from "../content/keep";
import { decorSets } from "../content/decorSets";
import { jobs as contentJobs } from "../content/jobs";
import { renownFlairForLevel } from "../content/flair";
import { tuning as contentTuning } from "../content/tuning";
import type { BuildingEffect } from "../content/buildingEffects";
import { canAfford } from "../core/economy";
import { NEED_IDS } from "../core/pips";
import type { NeedId } from "../core/pips";
import { resolveKeepEffects } from "../core/keep/effects";
import { isNextTierXpReady, tierBarProgress, xpRequiredForLevel } from "../core/progression/xp";
import { buildCatalog, formatBundle, formatMissing, missingFor } from "./buildMode";
import { buildXpBarModel } from "./xpBar";
import { sound } from "../app/sound";
import "./keepUpgrade.css";

/**
 * What each level opens up, as a warm one-liner (spec §15.5). Keyed by
 * the level being BOUGHT. Content lists the mechanical unlocks; this is
 * the player-facing sell.
 *
 * ROUND 2F (progression bible §2) — the ladder widened 3 → 12 tiers;
 * every tier gets its own headline (a tier that only raises a number is
 * a dead tier, so there are none).
 */
export const LEVEL_UNLOCK_COPY: Readonly<Record<number, string>> = {
  2: "The Forest trail opens, plus room to build.",
  3: "The Snowdrift opens up — and set bonuses start paying off.",
  4: "The Shore opens up, and Cozy Bunks become available.",
  5: "The Lanterngrotto opens, with two more columns of ground.",
  6: "The Larder and the Nest Warmer — plus 5-of-a-set bonuses.",
  7: "More ground, and the Trail Post for richer trips home.",
  8: "The Workbench and the Mending job — and the Sun Bunks.",
  9: "The last of the ground, and the Chronicle to look back on.",
  10: "The Beacon — every trip comes home a little sooner.",
  11: "A sixth bed — room for one more in the roster.",
  12: "The Weathervane, and Renown begins.",
};

/**
 * Celebration copy for the moment a level lands.
 *
 * ROUND 2F: this used to be `diffPhase5`'s post-purchase toast. It is now
 * the tier-up BANNER's flavour line (`ui/levelUp.ts`'s `levelUpFlavor`) —
 * the same warm sentence, on the surface that also lists what the tier
 * actually unlocked. Moved rather than deleted: the copy is good, and a
 * toast plus a banner announced the same purchase twice.
 */
export const LEVEL_UP_TOASTS: Readonly<Record<number, string>> = {
  2: "The Keep grew! The Forest trail is open, and there's fresh ground to build on.",
  3: "The Keep grew again! The Snowdrift beckons, and sets are starting to pay off.",
  4: "The Keep grew! The Shore glitters below — and Cozy Bunks are on offer.",
  5: "The Keep grew! The Lanterngrotto glows, and the ground stretches wider.",
  6: "The Keep grew! The Larder and the Nest Warmer are open, and sets got better.",
  7: "The Keep grew! More ground underfoot, and the Trail Post is up.",
  8: "The Keep grew! The Workbench is open, and naps finish sooner in the Sun Bunks.",
  9: "The Keep grew! The last of the ground is yours — and the Chronicle remembers it all.",
  10: "The Keep grew! The Beacon is lit — every trip comes home a little sooner now.",
  11: "The Keep grew! A sixth bed — one more Pip can call this home.",
  12: "The Keep grew! The Weathervane turns, and Renown begins.",
};

/** The compact, one-line-per-tier name for the road-ahead ladder (bible
 * §2's own "HEADLINE" column) — shorter than `LEVEL_UNLOCK_COPY`'s full
 * sell sentence, because the ladder shows all twelve at once. */
export const TIER_HEADLINES: Readonly<Record<number, string>> = {
  1: "The Meadow & the Bramblewick",
  2: "The Forest Trail",
  3: "The Snowdrift",
  4: "The Shore",
  5: "The Lanterngrotto",
  6: "The Larder & the Nest Warmer",
  7: "More Ground & the Trail Post",
  8: "The Workbench & Mending",
  9: "The Chronicle",
  10: "The Beacon",
  11: "A Sixth Bed",
  12: "The Weathervane & Renown",
};

/** Fallbacks so an unexpected level never renders blank copy. */
export const LEVEL_UNLOCK_FALLBACK = "New ground, new possibilities.";
export const LEVEL_UP_TOAST_FALLBACK = "The Keep grew!";
export const TIER_HEADLINE_FALLBACK = "A new tier";

export const ROSTER_UPGRADE_TOAST =
  "Cozy Bunks built — the Keep now sleeps five happy Pips.";

// ---------------------------------------------------------------------------
// The tier bar (bible §1.2: "the same bar" the Keep chip shows, plus the
// next tier's headline by name) + the compact road-ahead ladder (bible
// §2: "a sense of the road ahead ... without becoming a wall of text").
// ---------------------------------------------------------------------------

export interface TierBarModel {
  readonly keepXp: number;
  readonly into: number;
  readonly span: number;
  /** `into / span`, clamped to 1 when `span` is 0 (top tier — the bar
   * reads full; Renown owns what happens next, bible §1.7). */
  readonly fraction: number;
  /**
   * The readout, from `xpBar.ts`'s own model — NOT formatted here.
   *
   * ROUND 2G REVIEW (hud-redesign.md N3): this card printed
   * `${into} / ${span} Keep XP` itself, so once a tier went Ready and `into`
   * kept climbing it read "2,970 / 2,300 Keep XP" — while the Keep strip,
   * which the player had just TAPPED to open this card, read
   * "2,300 / 2,300 · banked" from the same state. Two surfaces, one number,
   * two answers, and the card's answer looked like a bug. Measured at three
   * tiers (2,970 / 2,300 · 920 / 900 · 171 / 1,150).
   *
   * Six of the eleven tiers are resource-gated, so Ready-with-overflow is the
   * NORMAL state for that whole stretch — this is not an edge case. Consuming
   * `buildXpBarModel().numerals` verbatim means the two can never disagree
   * again, because there is only one place that decides.
   */
  readonly numerals: string;
}

function buildTierBar(state: GameState): TierBarModel {
  const { into, span } = tierBarProgress(state.keepXp, state.keep.level, contentTuning);
  return {
    keepXp: state.keepXp,
    into,
    span,
    fraction: span > 0 ? Math.min(1, into / span) : 1,
    numerals: buildXpBarModel(state, contentTuning).numerals,
  };
}

export type TierStatus = "reached" | "next" | "locked";

export interface TierRowModel {
  readonly level: number;
  readonly headline: string;
  readonly status: TierStatus;
}

/** All twelve tiers, reached/next/locked relative to the Keep's current
 * level — bible §2's ladder table, condensed to what a card can show
 * without becoming a wall of text. */
export function buildTierLadder(currentLevel: number): readonly TierRowModel[] {
  return keepLevels.map((def) => ({
    level: def.level,
    headline: TIER_HEADLINES[def.level] ?? TIER_HEADLINE_FALLBACK,
    status: def.level <= currentLevel ? "reached" : def.level === currentLevel + 1 ? "next" : "locked",
  }));
}

/** Past the top tier, `keepXp` keeps paying out Renown (bible §1.7):
 * flair only, forever — never power, never a cap change. `null` until
 * the Keep actually reaches the top tier. */
export interface RenownModel {
  readonly level: number;
  readonly into: number;
  readonly span: number;
  /** ROUND 2F: the flourish the CURRENT level minted, or null below level 1 /
   * past the end of the ladder. Renown grants flair and nothing else, so
   * naming it is the only way this card can state a reward at all. */
  readonly earnedFlairName: string | null;
  /** The flourish the NEXT level will mint, or null past the ladder's end —
   * so the endgame card has a named thing in front of it, not just a count. */
  readonly nextFlairName: string | null;
}

function buildRenown(state: GameState): RenownModel | null {
  const topLevel = keepLevels[keepLevels.length - 1]?.level;
  if (topLevel === undefined || state.keep.level < topLevel) return null;
  const floor = xpRequiredForLevel(topLevel, contentTuning);
  const perLevel = contentTuning.progression.renown.xpPerLevel;
  const past = Math.max(0, state.keepXp - floor);
  const level = Math.floor(past / perLevel);
  return {
    level,
    into: past % perLevel,
    span: perLevel,
    earnedFlairName: renownFlairForLevel(level)?.name ?? null,
    nextFlairName: renownFlairForLevel(level + 1)?.name ?? null,
  };
}

export interface NextLevelModel {
  readonly level: number;
  readonly costLabel: string;
  readonly unlockCopy: string;
  /** Resource affordability ONLY — unchanged meaning from the shipped
   * card, so every existing assertion against it keeps holding. */
  readonly affordable: boolean;
  /** Friendly shortfall line, "" when affordable. */
  readonly missingLabel: string;
  /** The OTHER gate (bible §1.2): has `keepXp` cleared this tier's bar? */
  readonly xpReady: boolean;
  /** "820 more Keep XP", "" once xpReady. */
  readonly xpNeededLabel: string;
  /** Both gates cleared — the only state in which the Buy button acts. */
  readonly buyable: boolean;
}

export interface RosterUpgradeModel {
  /** Shown at all once the Keep meets the prerequisite level (spec §9:
   * "roster upgrade purchasable" is a level-4 unlock, moved from 3 —
   * bible §2.1, following the Shore). */
  readonly visible: boolean;
  readonly owned: boolean;
  readonly name: string;
  readonly costLabel: string;
  readonly affordable: boolean;
  readonly missingLabel: string;
}

export interface UpgradeCardModel {
  readonly currentLevel: number;
  readonly currentHeadline: string;
  readonly bar: TierBarModel;
  /** Null at max level — the card celebrates instead of selling. */
  readonly next: NextLevelModel | null;
  readonly roster: RosterUpgradeModel;
  /** Shown when there is nothing left to buy at all. */
  readonly maxedCopy: string;
  /** Non-null only once the top tier is reached (bible §1.7). */
  readonly renown: RenownModel | null;
  readonly ladder: readonly TierRowModel[];
}

export const MAXED_COPY =
  "The Keep is as grand as it gets (for now). The Pips are impressed.";

/** The whole upgrade card's view model. Pure: state in, model out. */
export function buildUpgradeCardModel(state: GameState): UpgradeCardModel {
  const nextDef = keepLevels.find((def) => def.level === state.keep.level + 1);
  const next: NextLevelModel | null =
    nextDef === undefined
      ? null
      : (() => {
          const affordable = canAfford(state.resources, nextDef.cost);
          const xpReady = isNextTierXpReady(state.keepXp, state.keep.level, contentTuning);
          const required = xpRequiredForLevel(nextDef.level, contentTuning);
          return {
            level: nextDef.level,
            costLabel: formatBundle(nextDef.cost),
            unlockCopy: LEVEL_UNLOCK_COPY[nextDef.level] ?? LEVEL_UNLOCK_FALLBACK,
            affordable,
            missingLabel: affordable ? "" : formatMissing(missingFor(state.resources, nextDef.cost)),
            xpReady,
            xpNeededLabel: xpReady ? "" : `${required - state.keepXp} more Keep XP`,
            buyable: affordable && xpReady,
          };
        })();

  const upgrade = keepUpgrades[ROSTER_UPGRADE_ID];
  const roster: RosterUpgradeModel =
    upgrade === undefined
      ? {
          visible: false,
          owned: state.rosterUpgradePurchased,
          name: "",
          costLabel: "",
          affordable: false,
          missingLabel: "",
        }
      : {
          visible:
            state.keep.level >= upgrade.prerequisiteLevel ||
            state.rosterUpgradePurchased,
          owned: state.rosterUpgradePurchased,
          name: upgrade.name,
          costLabel: formatBundle(upgrade.cost),
          affordable: canAfford(state.resources, upgrade.cost),
          missingLabel: canAfford(state.resources, upgrade.cost)
            ? ""
            : formatMissing(missingFor(state.resources, upgrade.cost)),
        };

  return {
    currentLevel: state.keep.level,
    currentHeadline: TIER_HEADLINES[state.keep.level] ?? TIER_HEADLINE_FALLBACK,
    bar: buildTierBar(state),
    next,
    roster,
    maxedCopy: MAXED_COPY,
    renown: buildRenown(state),
    ladder: buildTierLadder(state.keep.level),
  };
}

// ---------------------------------------------------------------------------
// THE KEEP COMFORT READOUT (bible §4.3) — "the surface that stops effects
// being a dead feature". Reads the SAME `resolveKeepEffects` derivation
// `core/pips/needs.ts` consumes, so it cannot drift from the simulation;
// the per-channel SOURCE lists are a display-only attribution computed by
// scanning the same placements + content this round's aggregator does.
// ---------------------------------------------------------------------------

const COMFORT_NEED_LABELS: Readonly<Record<NeedId, string>> = {
  hunger: "Hunger",
  cleanliness: "Clean",
  happiness: "Happy",
  energy: "Energy",
};

export interface ComfortNeedRow {
  readonly need: NeedId;
  readonly label: string;
  readonly pct: number;
  readonly capPct: number;
  readonly atCap: boolean;
  readonly sources: readonly string[];
}

export interface ComfortScalarRow {
  readonly key: "rest" | "trips" | "loot" | "eggs" | "xp";
  readonly label: string;
  readonly valueLabel: string;
  readonly sources: readonly string[];
  /** ROUND 2F: this channel is pinned at its `effectCaps` ceiling. Only the
   * comfort rows said "at the Keep's limit"; "Naps ×1.6" is EXACTLY
   * `restSpeedMax` and read as though more was still available. The two
   * deliberately-uncapped channels (loot, egg points — bible §3.3) are never
   * `atCap`, because their real ceiling lives downstream in
   * `core/progression/multipliers.ts`. */
  readonly atCap: boolean;
}

export interface ComfortSetRow {
  readonly setId: string;
  readonly setName: string;
  readonly placedCount: number;
  readonly totalMembers: number;
  readonly bonusActive: boolean;
}

export interface KeepComfortModel {
  /** Only needs with a nonzero reduction — an unbuilt Keep shows none. */
  readonly needs: readonly ComfortNeedRow[];
  /** Only scalar channels with a real (non-identity) value. */
  readonly scalars: readonly ComfortScalarRow[];
  /** Every set, always — "2 of 5" is as informative as "5 of 5". */
  readonly sets: readonly ComfortSetRow[];
  /**
   * ROUND 2F — names of the jobs a CURRENTLY PLACED station hosts, from
   * `ResolvedKeepEffects.hostedJobIds`.
   *
   * That field was aggregated and returned and then read by nothing outside
   * its own unit test: a computed value with no consumer, the mildest instance
   * of exactly the pattern this round exists to kill. It is also genuinely the
   * information a player wants from this readout ("what work can I hand out
   * right now?"), so consuming it beats deleting it.
   */
  readonly jobs: readonly string[];
}

/** Trim a multiplier to at most 2 decimals with no trailing zeros —
 * "1.5", not "1.50" or "1.500000000001". */
function trimMultiplier(value: number): string {
  return `${Math.round(value * 100) / 100}`;
}

function pctLabel(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/** Every placed item's own effects, paired with its display name — the
 * raw material `buildKeepComfortModel` scans for per-channel sources.
 * Distinctness (no "Bowl, Bowl") is enforced by the Set the caller folds
 * these into, not here. */
function itemEffectContributions(
  state: GameState,
): readonly { readonly name: string; readonly effect: BuildingEffect }[] {
  const byId = new Map(buildCatalog().map((item) => [item.id, item]));
  const out: { readonly name: string; readonly effect: BuildingEffect }[] = [];
  for (const placement of Object.values(state.keep.placements)) {
    const item = byId.get(placement.itemId);
    if (item === undefined) continue;
    for (const effect of item.effects) out.push({ name: item.name, effect });
  }
  return out;
}

function setNameOf(setId: string): string {
  return decorSets.find((s) => s.id === setId)?.name ?? setId;
}

function scalarSources(
  contributions: readonly { readonly name: string; readonly effect: BuildingEffect }[],
  activeSetBonuses: readonly { readonly setId: string; readonly effect: BuildingEffect }[],
  kind: BuildingEffect["kind"],
): readonly string[] {
  const sources = new Set<string>();
  for (const { name, effect } of contributions) {
    if (effect.kind === kind) sources.add(name);
  }
  for (const bonus of activeSetBonuses) {
    if (bonus.effect.kind === kind) sources.add(`${setNameOf(bonus.setId)} set`);
  }
  return [...sources];
}

/** The whole "How the Keep helps" readout. Pure: state in, model out. */
export function buildKeepComfortModel(state: GameState): KeepComfortModel {
  const resolved = resolveKeepEffects(state.keep, state.keep.level);
  const caps = contentTuning.progression.effectCaps;
  const contributions = itemEffectContributions(state);

  const needs: ComfortNeedRow[] = [];
  for (const need of NEED_IDS) {
    const reduction = resolved.comfort[need];
    if (reduction <= 0) continue;
    const sources = new Set<string>();
    for (const { name, effect } of contributions) {
      if (effect.kind === "comfort" && (effect.need === need || effect.need === "all")) {
        sources.add(name);
      }
    }
    for (const bonus of resolved.activeSetBonuses) {
      if (
        bonus.effect.kind === "comfort" &&
        (bonus.effect.need === need || bonus.effect.need === "all")
      ) {
        sources.add(`${setNameOf(bonus.setId)} set`);
      }
    }
    needs.push({
      need,
      label: COMFORT_NEED_LABELS[need],
      pct: Math.round(reduction * 100),
      capPct: Math.round(caps.comfortReductionMax * 100),
      atCap: reduction >= caps.comfortReductionMax - 1e-9,
      sources: [...sources],
    });
  }

  const scalars: ComfortScalarRow[] = [];
  if (resolved.restSpeedMultiplier > 1) {
    scalars.push({
      key: "rest",
      label: "Naps",
      valueLabel: `×${trimMultiplier(resolved.restSpeedMultiplier)}`,
      sources: scalarSources(contributions, resolved.activeSetBonuses, "restSpeed"),
      atCap: resolved.restSpeedMultiplier >= caps.restSpeedMax - 1e-9,
    });
  }
  if (resolved.expeditionSpeedMultiplier < 1) {
    scalars.push({
      key: "trips",
      label: "Trips",
      valueLabel: `×${trimMultiplier(resolved.expeditionSpeedMultiplier)}`,
      sources: scalarSources(contributions, resolved.activeSetBonuses, "expeditionSpeed"),
      atCap: resolved.expeditionSpeedMultiplier <= caps.expeditionSpeedMin + 1e-9,
    });
  }
  if (resolved.expeditionLootBonusChance > 0) {
    scalars.push({
      key: "loot",
      label: "Trip finds",
      valueLabel: `+${pctLabel(resolved.expeditionLootBonusChance)}`,
      sources: scalarSources(contributions, resolved.activeSetBonuses, "expeditionLoot"),
      // Deliberately uncapped here (bible §3.3) — the ceiling is downstream.
      atCap: false,
    });
  }
  if (resolved.eggChanceBonusPoints > 0) {
    scalars.push({
      key: "eggs",
      label: "Eggs",
      valueLabel: `+${pctLabel(resolved.eggChanceBonusPoints)}`,
      sources: scalarSources(contributions, resolved.activeSetBonuses, "eggChancePoints"),
      atCap: false,
    });
  }
  if (resolved.xpBonusFraction > 0) {
    scalars.push({
      key: "xp",
      label: "Keep XP",
      valueLabel: `+${pctLabel(resolved.xpBonusFraction)}`,
      sources: scalarSources(contributions, resolved.activeSetBonuses, "xpBonus"),
      atCap: resolved.xpBonusFraction >= caps.xpBonusMax - 1e-9,
    });
  }

  const placedIds = new Set(Object.values(state.keep.placements).map((p) => p.itemId));
  const sets: ComfortSetRow[] = decorSets.map((set) => ({
    setId: set.id,
    setName: set.name,
    placedCount: set.memberItemIds.filter((id) => placedIds.has(id)).length,
    totalMembers: set.memberItemIds.length,
    bonusActive: resolved.activeSetBonuses.some((b) => b.setId === set.id),
  }));

  // `hostedJobIds` → player-facing job names, in registry order so the line
  // is stable between opens.
  const hosted = new Set(resolved.hostedJobIds);
  const jobs = Object.values(contentJobs)
    .filter((job) => hosted.has(job.id))
    .map((job) => job.name);

  return { needs, scalars, sets, jobs };
}

// ---------------------------------------------------------------------------
// DOM shell
// ---------------------------------------------------------------------------

export interface UpgradeCardDeps {
  dispatch(action: GameAction): void;
  getState(): GameState;
  /** ROUND 2C: both purchases are streak VISIT DAYS (docs/retention-bible.md
   * §3.2 "buy something"), so they carry an `at` timestamp — buying a Keep
   * level is a session the player played. */
  now(): number;
  /**
   * Fired whenever the card opens or closes — the SAME seam
   * `BuildSheetDeps` exposes, for the SAME reason (see this file's
   * `keepUpgrade.css` comment above `.pk-upcard-wrap--open`): the keep
   * bar cannot be z-index'd under this card from inside `.pk-phase5`, so
   * the caller should hide it instead. This round's CSS already outranks
   * the bar unconditionally, so wiring this is belt-and-braces, not a
   * required fix — optional so every existing caller keeps compiling.
   */
  onOpenChange?(open: boolean): void;
}

export interface UpgradeCard {
  readonly el: HTMLElement;
  open(): void;
  close(): void;
  sync(state: GameState): void;
}

function renderTierBar(bar: TierBarModel): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "pk-upcard-bar-wrap";
  const track = document.createElement("div");
  track.className = "pk-upcard-bar-track";
  const fill = document.createElement("div");
  fill.className = "pk-upcard-bar-fill";
  fill.style.width = `${Math.round(bar.fraction * 100)}%`;
  track.appendChild(fill);
  const label = document.createElement("div");
  label.className = "pk-upcard-bar-label";
  // `bar.numerals` — the Keep strip's own string, never re-formatted here.
  // See `TierBarModel.numerals` for the two-surfaces-one-number bug this
  // closes.
  label.textContent = bar.span > 0 ? `${bar.numerals} Keep XP` : "Keep XP";
  wrap.append(track, label);
  return wrap;
}

function renderLadder(ladder: readonly TierRowModel[]): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "pk-upcard-ladder";
  for (const row of ladder) {
    const rowEl = document.createElement("div");
    rowEl.className = `pk-upcard-ladder-row pk-upcard-ladder-row--${row.status}`;
    const mark = document.createElement("span");
    mark.className = "pk-upcard-ladder-mark";
    mark.textContent = row.status === "reached" ? "✓" : `${row.level}`;
    const text = document.createElement("span");
    text.className = "pk-upcard-ladder-text";
    text.textContent = `Lv ${row.level} — ${row.headline}`;
    rowEl.append(mark, text);
    wrap.appendChild(rowEl);
  }
  return wrap;
}

function renderComfort(model: KeepComfortModel): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "pk-upcard-comfort";
  const title = document.createElement("div");
  title.className = "pk-upcard-comfort-title";
  title.textContent = "How the Keep helps";
  wrap.appendChild(title);

  if (model.needs.length === 0 && model.scalars.length === 0) {
    const empty = document.createElement("div");
    empty.className = "pk-upcard-comfort-empty";
    empty.textContent = "Build something — every placed item does SOMETHING here.";
    wrap.appendChild(empty);
  }

  for (const row of model.needs) {
    const rowEl = document.createElement("div");
    rowEl.className = "pk-upcard-comfort-row";
    const label = document.createElement("span");
    label.className = "pk-upcard-comfort-label";
    label.textContent = row.label;
    const track = document.createElement("span");
    track.className = "pk-upcard-comfort-track";
    const fill = document.createElement("span");
    fill.className = "pk-upcard-comfort-fill";
    fill.style.width = `${Math.min(100, (row.pct / row.capPct) * 100)}%`;
    track.appendChild(fill);
    const value = document.createElement("span");
    value.className = "pk-upcard-comfort-value";
    value.textContent = row.atCap
      ? `−${row.pct}% (at the Keep's limit)`
      : `−${row.pct}% of −${row.capPct}%`;
    rowEl.append(label, track, value);
    if (row.sources.length > 0) {
      const src = document.createElement("div");
      src.className = "pk-upcard-comfort-sources";
      src.textContent = row.sources.join(", ");
      rowEl.appendChild(src);
    }
    wrap.appendChild(rowEl);
  }

  for (const row of model.scalars) {
    const rowEl = document.createElement("div");
    rowEl.className = "pk-upcard-comfort-scalar";
    const label = document.createElement("span");
    label.className = "pk-upcard-comfort-label";
    label.textContent = row.label;
    const value = document.createElement("span");
    value.className = "pk-upcard-comfort-value";
    value.textContent = row.atCap
      ? `${row.valueLabel} (at the Keep's limit)`
      : row.valueLabel;
    rowEl.append(label, value);
    if (row.sources.length > 0) {
      const src = document.createElement("span");
      src.className = "pk-upcard-comfort-sources";
      src.textContent = `(${row.sources.join(", ")})`;
      rowEl.appendChild(src);
    }
    wrap.appendChild(rowEl);
  }

  // Which work is available right now (from `hostedJobIds`).
  if (model.jobs.length > 0) {
    const jobsLine = document.createElement("div");
    jobsLine.className = "pk-upcard-comfort-scalar";
    const label = document.createElement("span");
    label.className = "pk-upcard-comfort-label";
    label.textContent = "Work available";
    const value = document.createElement("span");
    value.className = "pk-upcard-comfort-value";
    value.textContent = model.jobs.join(", ");
    jobsLine.append(label, value);
    wrap.appendChild(jobsLine);
  }

  const setsLine = document.createElement("div");
  setsLine.className = "pk-upcard-comfort-sets";
  setsLine.textContent = model.sets
    .map((s) => (s.bonusActive ? `${s.setName} ✓${s.placedCount}` : `${s.setName} ${s.placedCount} of ${s.totalMembers}`))
    .join("  ·  ");
  wrap.appendChild(setsLine);

  return wrap;
}

export function createUpgradeCard(deps: UpgradeCardDeps): UpgradeCard {
  const el = document.createElement("div");
  el.className = "pk-upcard-wrap";

  const backdrop = document.createElement("div");
  backdrop.className = "pk-upcard-backdrop";
  const card = document.createElement("div");
  card.className = "pk-upcard";
  el.append(backdrop, card);

  let isOpen = false;
  const close = (): void => {
    isOpen = false;
    el.classList.remove("pk-upcard-wrap--open");
    deps.onOpenChange?.(false);
  };
  backdrop.addEventListener("click", close);

  const rebuild = (state: GameState): void => {
    const model = buildUpgradeCardModel(state);
    card.replaceChildren();

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "pk-focus-close";
    closeBtn.textContent = "×";
    closeBtn.title = "Back to the Keep";
    closeBtn.setAttribute("aria-label", "Close — back to the Keep");
    closeBtn.addEventListener("click", () => {
      sound("ui.tap");
      close();
    });

    const title = document.createElement("div");
    title.className = "pk-upcard-title";
    title.textContent = `The Keep — Level ${model.currentLevel}: ${model.currentHeadline}`;
    card.append(closeBtn, title);
    card.appendChild(renderTierBar(model.bar));

    if (model.next !== null) {
      const next = model.next;
      const section = document.createElement("div");
      section.className = "pk-upcard-section";
      const head = document.createElement("div");
      head.className = "pk-upcard-head";
      head.textContent = `Level ${next.level} — ${TIER_HEADLINES[next.level] ?? TIER_HEADLINE_FALLBACK}`;
      const unlock = document.createElement("div");
      unlock.className = "pk-upcard-unlock";
      unlock.textContent = next.unlockCopy;
      const cost = document.createElement("div");
      cost.className = "pk-upcard-cost";
      cost.textContent = next.costLabel;
      section.append(head, unlock, cost);

      const buy = document.createElement("button");
      buy.type = "button";
      buy.className = "pk-upcard-buy";
      buy.textContent = "Grow the Keep";
      buy.disabled = !next.buyable;
      buy.addEventListener("click", () => {
        sound("ui.tap");
        deps.dispatch({ type: "PURCHASE_KEEP_LEVEL", at: deps.now() });
      });
      section.appendChild(buy);
      if (!next.affordable && next.missingLabel !== "") {
        const missing = document.createElement("div");
        missing.className = "pk-upcard-missing";
        missing.textContent = `${next.missingLabel} — expeditions will get you there.`;
        section.appendChild(missing);
      }
      if (!next.xpReady) {
        const xpMissing = document.createElement("div");
        xpMissing.className = "pk-upcard-missing";
        xpMissing.textContent = `${next.xpNeededLabel} — keep playing, it'll get there.`;
        section.appendChild(xpMissing);
      }
      card.appendChild(section);
    } else if (!model.roster.visible || model.roster.owned) {
      const maxed = document.createElement("div");
      maxed.className = "pk-upcard-maxed";
      maxed.textContent = model.maxedCopy;
      card.appendChild(maxed);
      if (model.renown !== null) {
        const renownEl = document.createElement("div");
        renownEl.className = "pk-upcard-renown";
        // Names the flourish, both the one just earned and the one coming —
        // Renown pays in flair and nothing else, so the names ARE the reward.
        const earned =
          model.renown.level > 0 && model.renown.earnedFlairName !== null
            ? ` You have the ${model.renown.earnedFlairName}.`
            : "";
        const coming =
          model.renown.nextFlairName !== null
            ? ` Next: the ${model.renown.nextFlairName}.`
            : " Every flourish is yours — the count keeps going.";
        renownEl.textContent =
          model.renown.level > 0
            ? `Renown ${model.renown.level} — ${model.renown.into.toLocaleString()} / ${model.renown.span.toLocaleString()} to the next.${earned}${coming}`
            : `${model.renown.into.toLocaleString()} / ${model.renown.span.toLocaleString()} toward the first Renown level.${coming}`;
        card.appendChild(renownEl);
      }
    }

    if (model.roster.visible) {
      const section = document.createElement("div");
      section.className = "pk-upcard-section";
      const head = document.createElement("div");
      head.className = "pk-upcard-head";
      head.textContent = model.roster.name;
      const unlock = document.createElement("div");
      unlock.className = "pk-upcard-unlock";
      unlock.textContent = model.roster.owned
        ? "Built and cozy — the Keep sleeps five Pips now."
        : "Two more beds — room for five Pips in the Keep.";
      section.append(head, unlock);

      if (!model.roster.owned) {
        const cost = document.createElement("div");
        cost.className = "pk-upcard-cost";
        cost.textContent = model.roster.costLabel;
        section.appendChild(cost);
        const buy = document.createElement("button");
        buy.type = "button";
        buy.className = "pk-upcard-buy";
        buy.textContent = "Build the Bunks";
        buy.disabled = !model.roster.affordable;
        buy.addEventListener("click", () => {
          sound("ui.tap");
          deps.dispatch({ type: "PURCHASE_ROSTER_UPGRADE", at: deps.now() });
        });
        section.appendChild(buy);
        if (!model.roster.affordable && model.roster.missingLabel !== "") {
          const missing = document.createElement("div");
          missing.className = "pk-upcard-missing";
          missing.textContent = `${model.roster.missingLabel} — the Shore has what you need.`;
          section.appendChild(missing);
        }
      }
      card.appendChild(section);
    }

    card.appendChild(renderComfort(buildKeepComfortModel(state)));

    const ladderTitle = document.createElement("div");
    ladderTitle.className = "pk-upcard-comfort-title";
    ladderTitle.textContent = "The road ahead";
    card.appendChild(ladderTitle);
    card.appendChild(renderLadder(model.ladder));
  };

  return {
    el,
    open(): void {
      isOpen = true;
      sound("ui.sheet");
      rebuild(deps.getState());
      el.classList.add("pk-upcard-wrap--open");
      deps.onOpenChange?.(true);
    },
    close,
    sync(state: GameState): void {
      if (isOpen) rebuild(state);
    },
  };
}
