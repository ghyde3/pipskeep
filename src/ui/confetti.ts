/**
 * DOM confetti burst — the celebration flourish for Keep level-ups,
 * Cozy Bunks, and evolutions (task: "celebratory toast + confetti via
 * notify/sound seams"). Pure presentation: spawns a handful of CSS-
 * animated flecks and removes itself; no state, no store.
 *
 * Randomness note: this is render-only jitter in the DOM layer (like
 * keepScene's local "keep-juice" stream, spec §2 rule 3 governs GAMEPLAY
 * streams) — but to keep the repo Math.random-free by convention, the
 * scatter derives from a simple counter hash instead.
 */

const COLORS = ["#7cc283", "#f9d47d", "#f27d9d", "#bfe9f5", "#ff8a5c", "#fffdf6"];
const FLECKS = 26;

let seedCounter = 0;

/** Cheap deterministic scatter in [0, 1) — no Math.random by repo rule. */
function jitter(): number {
  seedCounter = (seedCounter * 1664525 + 1013904223) >>> 0;
  return seedCounter / 0x100000000;
}

/** Fire one celebratory burst from the upper-middle of the screen. */
export function burstConfetti(mount: HTMLElement = document.body): void {
  const root = document.createElement("div");
  root.className = "pk-confetti";
  for (let i = 0; i < FLECKS; i++) {
    const fleck = document.createElement("i");
    const color = COLORS[i % COLORS.length] ?? "#fffdf6";
    fleck.style.background = color;
    fleck.style.left = `${18 + jitter() * 64}%`;
    fleck.style.setProperty("--pk-cf-x", `${(jitter() - 0.5) * 220}px`);
    fleck.style.setProperty("--pk-cf-r", `${(jitter() - 0.5) * 900}deg`);
    fleck.style.animationDelay = `${jitter() * 240}ms`;
    fleck.style.animationDuration = `${1100 + jitter() * 700}ms`;
    if (jitter() > 0.5) fleck.style.borderRadius = "50%";
    root.appendChild(fleck);
  }
  root.addEventListener("animationend", (event) => {
    if (event.target === root.lastElementChild) root.remove();
  });
  mount.appendChild(root);
  // Belt and braces: reduced-motion setups still clean up.
  window.setTimeout(() => root.remove(), 2600);
}
