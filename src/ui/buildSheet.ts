/**
 * Build bottom sheet (spec §9 placement UI, §6.3 costs; docs/
 * progression-bible.md §4.1/§5.5): every placeable and decoration as a
 * tap card — icon, what it DOES (generated effect lines), footprint,
 * cost with affordability, set progress, and a lock label for stations
 * not yet reached. Grouped so a 45-item catalog scrolls cleanly:
 * Stations first (locked ones shown greyed, never hidden), then the six
 * themed decoration sets as their own collapsible groups, then Rearrange.
 * `buildMode.ts` owns the model; this file is dumb DOM around it.
 *
 * Tapping a live card hands off to placement mode (the render hooks, via
 * the controller in phase5.ts). Below the catalog, the REARRANGE rows:
 * every current placement with thumb-friendly Move / Tuck away buttons
 * (the select-then-move pattern — no fiddly tap-and-hold needed).
 */

import type { GameState } from "../core/state";
import type { BuildEntryModel, BuildSetGroupModel } from "./buildMode";
import { buildSheetModel } from "./buildMode";
import type { PlacementId } from "../core/keep";
import { renderIcon } from "./icons";
import { sound } from "../app/sound";
import "./buildSheet.css";

export interface BuildSheetDeps {
  getState(): GameState;
  /** Start placing this catalog item (closes the sheet first). */
  startPlace(itemId: string): void;
  /** Start moving this placement (closes the sheet first). */
  startMove(placementId: PlacementId): void;
  /** Remove this placement (sheet stays open and re-syncs). */
  remove(placementId: PlacementId): void;
  /**
   * Fired whenever the sheet opens or closes. The keep bar lives inside
   * `.pk-phase5`, which is its own stacking context, so it cannot be
   * z-index'd under this sheet — the caller hides it instead (same
   * mechanism placement mode already uses).
   */
  onOpenChange?(open: boolean): void;
}

export interface BuildSheet {
  readonly el: HTMLElement;
  open(): void;
  close(): void;
  sync(state: GameState): void;
}

/** One tap card — shared by the Stations list and every set group, so a
 * station and a decoration render with identical structure. */
function renderCard(entry: BuildEntryModel, onTap: (itemId: string) => void): HTMLElement {
  const card = document.createElement("button");
  card.type = "button";
  const classes = ["pk-item", "pk-build-card"];
  if (!entry.buyable) classes.push("pk-build-card--short");
  card.className = classes.join(" ");
  card.disabled = !entry.buyable;

  const head = document.createElement("div");
  head.className = "pk-build-head";
  head.appendChild(renderIcon(entry.resolvedIcon, entry.tint, "md"));
  const nameWrap = document.createElement("div");
  nameWrap.className = "pk-build-name-wrap";
  const name = document.createElement("div");
  name.className = "pk-item-name";
  name.textContent = entry.name;
  nameWrap.appendChild(name);
  head.appendChild(nameWrap);
  card.appendChild(head);

  if (entry.isNew && !entry.locked) {
    // Absolutely positioned against `.pk-item`'s own `position: relative`
    // (ui.css) — same corner `.pk-item-count` already uses — so a long
    // name never has to share its line with this badge (bible §4.1's
    // card mock shows NEW in the corner, not inline).
    const badge = document.createElement("span");
    badge.className = "pk-build-new";
    badge.textContent = "NEW";
    card.appendChild(badge);
  }

  const foot = document.createElement("div");
  foot.className = "pk-build-foot";
  foot.textContent = entry.footprintLabel;
  card.appendChild(foot);

  for (const line of entry.effectLines) {
    const effectEl = document.createElement("div");
    effectEl.className = "pk-build-effect";
    effectEl.textContent = line;
    card.appendChild(effectEl);
  }

  if (entry.setLabel !== null) {
    const setEl = document.createElement("div");
    setEl.className = entry.setBonusActive
      ? "pk-build-set pk-build-set--active"
      : "pk-build-set";
    setEl.textContent = entry.setBonusActive ? `${entry.setLabel} ✓ bonus active` : entry.setLabel;
    card.appendChild(setEl);
  }

  const flavor = document.createElement("div");
  flavor.className = "pk-build-flavor";
  flavor.textContent = entry.flavor;
  card.appendChild(flavor);

  if (entry.locked) {
    const lock = document.createElement("div");
    lock.className = "pk-build-lock";
    lock.textContent = `${entry.lockLabel} — something to grow toward.`;
    card.appendChild(lock);

    // A LOCKED CARD STILL SHOWS ITS PRICE. It used to show the effect, the
    // flavour and "Opens at Keep level 6" but NOT the cost, so a player could
    // not save toward the Larder or the Beacon — which is the single main thing
    // a named future unlock is for. Bible §5.5's "locked-but-visible is a
    // deliberate reversal of the hide-what-you-can't-do instinct" only pays off
    // if the card says what it will take.
    const cost = document.createElement("div");
    cost.className = "pk-build-cost pk-build-cost--locked";
    cost.textContent = `Will cost ${entry.costLabel}`;
    card.appendChild(cost);
  } else {
    const cost = document.createElement("div");
    cost.className = "pk-build-cost";
    cost.textContent = entry.costLabel;
    card.appendChild(cost);

    // THE KEEPSAKE SHELF (round 2F integrate): a granted copy is placed for
    // free, so say so on the card. Before this round `state.keepsakes` was
    // written by streak/milestone rewards and read by nothing at all — the
    // player was charged full price for a decoration they had been given.
    if (entry.keepsakeLabel !== null) {
      const keepsake = document.createElement("div");
      keepsake.className = "pk-build-keepsake";
      keepsake.textContent = entry.keepsakeLabel;
      card.appendChild(keepsake);
    }

    if (entry.firstBuildLabel !== null) {
      const first = document.createElement("div");
      first.className = "pk-build-first";
      first.textContent = entry.firstBuildLabel;
      card.appendChild(first);
    }

    if (!entry.affordable) {
      const missing = document.createElement("div");
      missing.className = "pk-build-missing";
      missing.textContent = entry.missingLabel;
      card.appendChild(missing);
    }
  }

  card.addEventListener("click", () => {
    if (card.disabled) return;
    sound("ui.tap");
    onTap(entry.id);
  });
  return card;
}

export function createBuildSheet(deps: BuildSheetDeps): BuildSheet {
  const el = document.createElement("div");
  el.className = "pk-sheet-wrap";

  const backdrop = document.createElement("div");
  backdrop.className = "pk-sheet-backdrop";
  const sheet = document.createElement("div");
  sheet.className = "pk-sheet pk-build-sheet";

  const handle = document.createElement("div");
  handle.className = "pk-sheet-handle";
  const title = document.createElement("div");
  title.className = "pk-sheet-title";
  title.textContent = "Build";

  // THE KEEPSAKE SHELF, at the TOP (bible §5.5 item 1) — free, yours already.
  // Hidden entirely when the shelf is empty, which is the common case.
  const keepsakesTitle = document.createElement("div");
  keepsakesTitle.className = "pk-build-group-title pk-build-group-title--bonus";
  keepsakesTitle.textContent = "Keepsakes — yours already";
  const keepsakesGrid = document.createElement("div");
  keepsakesGrid.className = "pk-sheet-grid";

  const stationsTitle = document.createElement("div");
  stationsTitle.className = "pk-build-group-title";
  stationsTitle.textContent = "Stations";
  const stationsGrid = document.createElement("div");
  stationsGrid.className = "pk-sheet-grid";

  const setsWrap = document.createElement("div");
  setsWrap.className = "pk-build-sets";

  /*
   * LOCKED STATIONS GO BELOW THE SETS, BEHIND ONE COLLAPSIBLE HEADER.
   *
   * Locked-but-visible is deliberate (bible §5.5) and stays — a named future
   * unlock with its price on it is how a player saves toward the Larder. But
   * at Keep level 1 that is TEN of the thirteen station cards, each four
   * lines tall, all of them things you cannot do yet, stacked between the
   * three you can and the set groups: measured `scrollHeight` 2,778px in a
   * 527px window, with the sets starting at scrollTop 1,943 — 70% of the way
   * down. So the answer to "what are sets, and are they worth chasing" was
   * behind three and a half phone screens of things that are not buyable.
   *
   * One header, collapsed by default, same per-instance (not persisted)
   * convention the set groups use. The catalogue is still fully browsable;
   * it just stops being the sheet's centre of gravity.
   */
  const lockedWrap = document.createElement("div");
  lockedWrap.className = "pk-build-group";

  const rearrangeTitle = document.createElement("div");
  rearrangeTitle.className = "pk-sheet-title pk-build-rearrange-title";
  rearrangeTitle.textContent = "Rearrange";
  const rearrangeList = document.createElement("div");
  rearrangeList.className = "pk-build-rearrange";

  sheet.append(
    handle,
    title,
    keepsakesTitle,
    keepsakesGrid,
    stationsTitle,
    stationsGrid,
    setsWrap,
    lockedWrap,
    rearrangeTitle,
    rearrangeList,
  );
  el.append(backdrop, sheet);

  let isOpen = false;
  let lastState: GameState | null = null;

  const close = (): void => {
    isOpen = false;
    el.classList.remove("pk-sheet-wrap--open");
    deps.onOpenChange?.(false);
  };
  backdrop.addEventListener("click", close);

  const onTap = (itemId: string): void => {
    close();
    deps.startPlace(itemId);
  };

  /**
   * COLLAPSED BY DEFAULT (bible §5.5 item 3: "six collapsible groups").
   *
   * 45 cards made this sheet 6,882px of scroll in a 527px window — 13 screens,
   * with the same two lines repeated on nearly every card. Collapsing the six
   * set groups turns that into six headers plus whichever one the player opened,
   * and the header itself carries the whole reason to open it (the set's two
   * bonus tiers and the next step). Per-sheet-instance state, not persisted:
   * reopening the sheet starts tidy again, which is the point.
   */
  const expandedSets = new Set<string>();
  /** Same convention, for the locked-station catalogue below the sets. */
  let lockedExpanded = false;

  const renderSetGroup = (group: BuildSetGroupModel): HTMLElement => {
    const wrap = document.createElement("div");
    wrap.className = "pk-build-group";
    const expanded = expandedSets.has(group.setId);

    const header = document.createElement("button");
    header.type = "button";
    header.className = group.bonusActive
      ? "pk-build-group-title pk-build-group-title--bonus pk-build-group-toggle"
      : "pk-build-group-title pk-build-group-toggle";
    header.setAttribute("aria-expanded", expanded ? "true" : "false");
    const count = `${group.placedCount} of ${group.totalMembers} placed`;
    header.textContent = `${expanded ? "▾" : "▸"} ${group.setName} · ${count}${
      group.bonusActive ? " · bonus active" : ""
    }`;
    header.addEventListener("click", () => {
      sound("ui.tap");
      if (expandedSets.has(group.setId)) expandedSets.delete(group.setId);
      else expandedSets.add(group.setId);
      if (lastState !== null) rebuild(lastState);
    });
    wrap.appendChild(header);

    // ROUND 2F — WHAT THE BONUS IS, IN WORDS (bible §3.5). The header used to
    // be the whole story: a tally, plus "· bonus active" once earned, and
    // nothing about WHAT was active or what it took. Six sets × two tiers is
    // 12 discrete non-random long-haul goals, and all 12 were invisible — which
    // matters most because a decoration's OWN effect is 1–2%, i.e. noise, so
    // the set payoff is the only legible reason a decoration exists at all.
    if (group.bonusInfo !== null) {
      const info = document.createElement("div");
      info.className = "pk-build-group-bonus";
      const tiers: readonly { readonly text: string; readonly tier: 1 | 2 }[] = [
        { text: group.bonusInfo.tier1Line, tier: 1 },
        { text: group.bonusInfo.tier2Line, tier: 2 },
      ];
      for (const { text, tier } of tiers) {
        const line = document.createElement("div");
        line.className =
          group.bonusInfo.activeTier === tier
            ? "pk-build-group-bonus-line pk-build-group-bonus-line--live"
            : "pk-build-group-bonus-line";
        line.textContent =
          group.bonusInfo.activeTier === tier ? `✓ ${text}` : `○ ${text}`;
        info.appendChild(line);
      }
      // The actual next step, by count ("two more for the set bonus"), and the
      // Keep-level gate when the members are there but the tier is not yet live
      // — without which three placed Moss Tufts at Keep 2 just look broken.
      for (const note of [group.bonusInfo.nextStepLine, group.bonusInfo.notYetLiveLine]) {
        if (note === null) continue;
        const line = document.createElement("div");
        line.className = "pk-build-group-bonus-note";
        line.textContent = note;
        info.appendChild(line);
      }
      wrap.appendChild(info);
    }

    // WHICH ITEMS ACTUALLY COUNT. The header priced the bonus ("3 placed: a
    // 2% better chance of an extra find… three more for the set bonus") but
    // never said which seven decorations were in the set, so a set bonus
    // could be evaluated and not shopped for — you had to open the group to
    // discover what was even in it. One line of names, only while collapsed
    // (open, the cards themselves say it).
    if (!expanded && group.entries.length > 0) {
      const members = document.createElement("div");
      members.className = "pk-build-group-members";
      members.textContent = group.entries.map((entry) => entry.name).join(" · ");
      wrap.appendChild(members);
    }

    // The cards themselves are only built when the group is open — 45 cards
    // collapsed to six headers is the whole scroll fix.
    if (expanded) {
      const grid = document.createElement("div");
      grid.className = "pk-sheet-grid";
      for (const entry of group.entries) grid.appendChild(renderCard(entry, onTap));
      wrap.appendChild(grid);
    }
    return wrap;
  };

  const rebuild = (state: GameState): void => {
    const model = buildSheetModel(state);

    keepsakesGrid.replaceChildren();
    for (const entry of model.keepsakes) keepsakesGrid.appendChild(renderCard(entry, onTap));
    const hasKeepsakes = model.keepsakes.length > 0;
    keepsakesTitle.hidden = !hasKeepsakes;
    keepsakesGrid.hidden = !hasKeepsakes;

    // Buildable stations lead; the locked catalogue moves below the sets
    // (see `lockedWrap`'s note).
    const openStations = model.stations.filter((entry) => !entry.locked);
    const lockedStations = model.stations.filter((entry) => entry.locked);

    stationsGrid.replaceChildren();
    for (const entry of openStations) stationsGrid.appendChild(renderCard(entry, onTap));
    stationsTitle.hidden = openStations.length === 0;
    stationsGrid.hidden = openStations.length === 0;

    setsWrap.replaceChildren();
    for (const group of model.sets) {
      if (group.entries.length === 0) continue;
      setsWrap.appendChild(renderSetGroup(group));
    }

    lockedWrap.replaceChildren();
    lockedWrap.hidden = lockedStations.length === 0;
    if (lockedStations.length > 0) {
      const header = document.createElement("button");
      header.type = "button";
      header.className = "pk-build-group-title pk-build-group-toggle";
      header.setAttribute("aria-expanded", lockedExpanded ? "true" : "false");
      header.textContent = `${lockedExpanded ? "▾" : "▸"} Coming as the Keep grows · ${lockedStations.length}`;
      header.addEventListener("click", () => {
        sound("ui.tap");
        lockedExpanded = !lockedExpanded;
        if (lastState !== null) rebuild(lastState);
      });
      lockedWrap.appendChild(header);
      if (lockedExpanded) {
        const grid = document.createElement("div");
        grid.className = "pk-sheet-grid";
        for (const entry of lockedStations) grid.appendChild(renderCard(entry, onTap));
        lockedWrap.appendChild(grid);
      }
    }

    rearrangeList.replaceChildren();
    if (model.rearrange.length === 0) {
      rearrangeTitle.style.display = "none";
      return;
    }
    rearrangeTitle.style.display = "";
    for (const row of model.rearrange) {
      const rowEl = document.createElement("div");
      rowEl.className = "pk-build-row";

      rowEl.appendChild(renderIcon(row.resolvedIcon, row.tint, "sm"));

      const label = document.createElement("div");
      label.className = "pk-build-row-name";
      label.textContent = row.name;
      const where = document.createElement("div");
      where.className = "pk-build-row-where";
      where.textContent =
        row.workerName !== null
          ? `Tile ${row.x + 1}, ${row.y + 1} — ${row.workerName} works here`
          : `Tile ${row.x + 1}, ${row.y + 1}`;
      const text = document.createElement("div");
      text.className = "pk-build-row-text";
      text.append(label, where);

      const move = document.createElement("button");
      move.type = "button";
      move.className = "pk-item-btn";
      move.textContent = "Move";
      move.addEventListener("click", () => {
        sound("ui.tap");
        close();
        deps.startMove(row.placementId);
      });

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "pk-item-btn pk-build-remove";
      remove.textContent = "Tuck away";
      remove.addEventListener("click", () => {
        sound("ui.tap");
        deps.remove(row.placementId);
      });

      const actions = document.createElement("div");
      actions.className = "pk-item-actions pk-build-row-actions";
      actions.append(move, remove);

      rowEl.append(text, actions);
      rearrangeList.appendChild(rowEl);
    }
  };

  return {
    el,
    open(): void {
      isOpen = true;
      sound("ui.sheet");
      lastState = deps.getState();
      rebuild(lastState);
      el.classList.add("pk-sheet-wrap--open");
      deps.onOpenChange?.(true);
    },
    close,
    sync(state: GameState): void {
      lastState = state;
      if (isOpen) rebuild(state);
    },
  };
}
