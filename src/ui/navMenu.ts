/**
 * The Nook menu (round 2C integrate stage): ONE floating button in the
 * bottom-left thumb zone that opens a short list of the game's non-care
 * destinations — the Album, the Long Meadow, and Today.
 *
 * WHY A MENU AND NOT MORE BUTTONS. Round 2C shipped three new browsable
 * screens, and the obvious wiring (a floating button each, the pattern
 * `soundToggle.ts` established) does not survive contact with a 375px
 * screen. The bottom-left column is already occupied by the Keep bar
 * (`.pk-keepbar`: the Keep chip + Build, `left: 12px`, rising from
 * `bottom + 118px`), and the dailies entry button as shipped sat at
 * `left: 12px; bottom + 178px` — geometrically ON TOP of the Keep bar's
 * upper button, on a lower z-index, i.e. an unreachable Build button. One
 * button that expands is the fix: the thumb zone gains a single 44px
 * target, the care bar is untouched, and each destination gets a readable
 * label instead of an emoji the player has to guess at.
 *
 * The glyph is drawn in CSS (three rounded sage bars), not an emoji: the
 * menu holds three unrelated things, so no single pictogram is honest, and
 * CSS avoids the cross-platform emoji roulette the rest of the UI already
 * risks.
 *
 * LAYERING (see `src/ui/layers.css` — the ladder this round had to fix):
 * the button sits at `--pk-z-float` (under every sheet, like the sound
 * toggle) and the popover at `--pk-z-nav`, above the Phase 5 chrome's
 * stacking context but below every full-screen surface. Opening a
 * destination closes the popover first, so a menu never floats over the
 * screen it just opened.
 *
 * Split as usual: `navBadgeTotal` and `buildNavRows` are PURE (state in,
 * view model out); `createNavMenu` is the dumb DOM shell.
 */

import "./navMenu.css";
import type { GameState } from "../core/state";
import { dailyBadgeCount } from "./dailies";
import { entryTier, pipdexGridOrder } from "./pipdex";
import { sound } from "../app/sound";

/** A destination in the menu. */
export interface NavRowModel {
  readonly id: string;
  /** Row label — a place, in the game's own words. */
  readonly label: string;
  /** One-line "what is this" under the label. */
  readonly hint: string;
  /**
   * Count shown as a badge, or 0 for none. A count is only ever a
   * *positive* thing to look at (pages to see, residents to visit, rewards
   * to claim) — never a chore count, never a deadline (bible §0.3).
   */
  readonly badge: number;
}

/** How many Album pages have something on them (met or caught). Used as
 * the Album's badge — "there is something in here", not "you are behind". */
export function albumFilledCount(state: GameState): number {
  let filled = 0;
  for (const speciesId of pipdexGridOrder(state)) {
    if (entryTier(state.pipdex.entries[speciesId]) !== "blank") filled += 1;
  }
  return filled;
}

/** The three destinations, in a fixed order (nearest-to-thumb last is
 * handled by CSS: the popover grows upward, so this order reads top-down). */
export function buildNavRows(state: GameState): readonly NavRowModel[] {
  const residents = state.sanctuary.order.length;
  return [
    {
      id: "album",
      label: "The Album",
      hint: "Every Pip you've met, pressed between the pages.",
      badge: albumFilledCount(state),
    },
    {
      id: "meadow",
      label: "The Long Meadow",
      hint:
        residents === 0
          ? "Where Pips go to help out. Nobody's there yet."
          : residents === 1
            ? "One Pip is helping out there. Visit any time."
            : `${residents} Pips are helping out there. Visit any time.`,
      badge: residents,
    },
    {
      id: "today",
      label: "Today",
      hint: "Your streak, today's round, and the milestone shelf.",
      badge: dailyBadgeCount(state),
    },
  ];
}

/**
 * The number on the closed menu button. Only the *claimable* count
 * (dailies) earns a badge on the button itself — the Album's and Meadow's
 * counts are informational and a permanent badge would read as a chore.
 */
export function navBadgeTotal(state: GameState): number {
  return dailyBadgeCount(state);
}

export interface NavMenuDeps {
  readonly mount: HTMLElement;
  getState(): GameState;
  /** Called with a row id when the player picks a destination. The menu
   * has already closed itself by then. */
  onPick(id: string): void;
}

export interface NavMenu {
  readonly el: HTMLElement;
  readonly button: HTMLElement;
  open(): void;
  close(): void;
  readonly isOpen: boolean;
  sync(state: GameState): void;
  dispose(): void;
}

export function createNavMenu(deps: NavMenuDeps): NavMenu {
  const el = document.createElement("div");
  el.className = "pk-nav";

  // The closed affordance.
  const button = document.createElement("button");
  button.type = "button";
  button.className = "pk-nav-btn";
  button.title = "The Album, the Long Meadow, and Today";
  button.setAttribute("aria-label", "Menu — the Album, the Long Meadow, and Today");
  button.setAttribute("aria-expanded", "false");
  const glyph = document.createElement("span");
  glyph.className = "pk-nav-glyph";
  glyph.setAttribute("aria-hidden", "true");
  glyph.append(
    document.createElement("i"),
    document.createElement("i"),
    document.createElement("i"),
  );
  const badge = document.createElement("span");
  badge.className = "pk-nav-badge";
  button.append(glyph, badge);

  // The popover.
  const wrap = document.createElement("div");
  wrap.className = "pk-nav-wrap";
  const backdrop = document.createElement("div");
  backdrop.className = "pk-nav-backdrop";
  const panel = document.createElement("div");
  panel.className = "pk-nav-panel";
  wrap.append(backdrop, panel);

  el.append(button, wrap);
  deps.mount.appendChild(el);

  let isOpen = false;

  const close = (): void => {
    isOpen = false;
    wrap.classList.remove("pk-nav-wrap--open");
    button.setAttribute("aria-expanded", "false");
  };

  const render = (state: GameState): void => {
    panel.replaceChildren();
    for (const row of buildNavRows(state)) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "pk-nav-item";

      const label = document.createElement("span");
      label.className = "pk-nav-item-label";
      label.textContent = row.label;
      if (row.badge > 0) {
        const count = document.createElement("span");
        count.className = "pk-nav-item-count";
        count.textContent = String(row.badge);
        label.appendChild(count);
      }

      const hint = document.createElement("span");
      hint.className = "pk-nav-item-hint";
      hint.textContent = row.hint;

      item.append(label, hint);
      item.addEventListener("click", () => {
        sound("ui.tap");
        // Close FIRST: the destination opens over a settled screen, never
        // under a floating menu.
        close();
        deps.onPick(row.id);
      });
      panel.appendChild(item);
    }
  };

  const open = (): void => {
    render(deps.getState());
    isOpen = true;
    sound("ui.sheet");
    wrap.classList.add("pk-nav-wrap--open");
    button.setAttribute("aria-expanded", "true");
  };

  button.addEventListener("click", () => {
    if (isOpen) {
      sound("ui.tap");
      close();
    } else {
      open();
    }
  });
  backdrop.addEventListener("click", () => {
    sound("ui.tap");
    close();
  });

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && isOpen) close();
  };
  document.addEventListener("keydown", onKey);

  return {
    el,
    button,
    get isOpen(): boolean {
      return isOpen;
    },
    open,
    close,
    sync(state: GameState): void {
      const total = navBadgeTotal(state);
      badge.textContent = total > 0 ? String(total) : "";
      badge.classList.toggle("pk-nav-badge--on", total > 0);
      if (isOpen) render(state);
    },
    dispose(): void {
      document.removeEventListener("keydown", onKey);
      el.remove();
    },
  };
}
