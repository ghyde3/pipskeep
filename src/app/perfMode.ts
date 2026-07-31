/**
 * Perf harness (?perf — DEV BUILDS ONLY, spec §1 performance budgets).
 *
 * Reached solely through the `import.meta.env.DEV` dynamic import in
 * main.ts, exactly like the debug menu, so production builds never ship
 * it. Open http://localhost:5317/?perf to use it.
 *
 * What it does INSTEAD of a normal boot:
 * - renders the spec §1 budget scenario — 5 animated Pips + 30
 *   decorations (perfState.ts) — through the REAL keep scene, sprite
 *   resolvers, wander/idle systems;
 * - never opens IndexedDB, never creates a store, never autosaves: the
 *   synthetic state exists only inside the scene layer, so the player's
 *   real save cannot be touched;
 * - overlays an fps meter fed by a raw requestAnimationFrame delta ring
 *   buffer (perfStats.ts): avg fps, p95/worst frame time, and a
 *   cumulative count of >50 ms spikes (the spec's spike budget).
 *
 * Measurement methodology (keep it honest): the meter uses the rAF
 * callback timestamps, NOT Pixi's ticker, so it observes real vsync
 * cadence including any time Pixi itself stalls. For the phone-profile
 * budget, run this under Chrome DevTools 4× CPU throttle.
 *
 * Styles are inlined (debugMenu convention) — nothing perf-flavored in
 * the shipped CSS.
 */

import { Application } from "pixi.js";
import { createKeepScene } from "../render/keepScene";
import {
  buildAmbiencePerfState,
  buildPerfState,
  PERF_ATTRACTION_LAYOUT,
  PERF_DECORATION_COUNT,
  PERF_PIP_COUNT,
} from "./perfState";
// ROUND 2K (docs/liveliness-bible.md §5.3) — the ambience scenario forces
// the two things the player cannot turn off to their WORST values, so the
// number the harness reports is the number a real night-time player in
// the rain would get, not a best case.
import { daylightAt } from "./daylight";
import { weatherAt } from "./weather";
import { createFrameStats, SPIKE_THRESHOLD_MS } from "./perfStats";

/** Unique needle for the prod-bundle tree-shake check (`grep dist/`). */
export const PERF_MODE_MARKER = "pipskeep-perf-mode";

/** HUD refresh cadence in frames (~2×/s at 60fps) — frame-counted so the
 * harness needs no interval timer of its own. */
const HUD_REFRESH_FRAMES = 30;

function buildHud(): { root: HTMLElement; readout: HTMLElement; objectsEl: HTMLElement } {
  const root = document.createElement("div");
  root.dataset["marker"] = PERF_MODE_MARKER;
  root.style.cssText = [
    "position:fixed",
    "top:8px",
    "left:8px",
    "z-index:9999",
    "background:rgba(20,28,20,0.82)",
    "color:#d8f3d0",
    "font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace",
    "padding:8px 10px",
    "border-radius:8px",
    "pointer-events:none",
    "white-space:pre",
  ].join(";");

  const title = document.createElement("div");
  title.textContent = `PERF MODE — synthetic scene (${PERF_PIP_COUNT} pips / ${PERF_DECORATION_COUNT} decorations), save untouched`;
  title.style.cssText = "font-weight:700;color:#ffe9a3;margin-bottom:4px";

  const readout = document.createElement("div");
  readout.textContent = "warming up…";

  // ROUND 2K — the object count sits above the frame numbers because it
  // is the one line that explains a bad one.
  const objectsEl = document.createElement("div");
  objectsEl.textContent = "objects    …";

  root.append(title, objectsEl, readout);
  return { root, readout, objectsEl };
}

/** Boot the perf scene in place of the real game. Never returns to the
 * normal boot path. */
export async function startPerfMode(): Promise<void> {
  const app = new Application();
  await app.init({
    background: "#eef7ea",
    resizeTo: window,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });

  const mount = document.getElementById("app");
  if (!mount) {
    throw new Error("PipsKeep perf mode: #app mount point missing");
  }
  mount.appendChild(app.canvas);

  const scene = createKeepScene(app.screen.width, app.screen.height);
  app.stage.addChild(scene.view);
  scene.resize(app.screen.width, app.screen.height);
  window.addEventListener("resize", () => {
    scene.resize(window.innerWidth, window.innerHeight);
  });

  // ROUND 2K — `?perf=ambience` measures the round's own worst case.
  // Anything else (including a bare `?perf`) is the shipped spec §1
  // scenario, byte-identical to what it measured before this round, so
  // the two runs are comparable.
  const ambienceScenario =
    new URLSearchParams(window.location.search).get("perf") === "ambience";

  // The whole scenario in one sync — state never changes afterwards;
  // everything that moves from here on is scene-local animation.
  const perfState = ambienceScenario ? buildAmbiencePerfState() : buildPerfState();
  scene.sync(perfState);

  if (ambienceScenario) {
    // Forced, not sampled: the harness must not report a healthy number
    // just because it happened to run at noon in clear weather.
    //
    // 02:00 local is deep night (the 0.22 overlay, the moon, the night
    // flitter count); a weather window is searched for the first one that
    // rolls RAIN, which is the heaviest emitter in the table (40 streaks)
    // and the one that also sends every Pip pathing for shelter.
    const nightMs = new Date(2026, 6, 31, 2, 0, 0, 0).getTime();
    scene.setDaylight(daylightAt(nightMs));
    const windowMs = 3 * 60 * 60 * 1000;
    let rain = weatherAt(perfState.seed, nightMs);
    for (let i = 0; i < 512 && rain.kind !== "rain"; i++) {
      rain = weatherAt(perfState.seed, nightMs + i * windowMs);
    }
    scene.setWeather(rain);
    console.info(
      `PipsKeep perf mode: AMBIENCE scenario — night + ${rain.kind}, ` +
        `${PERF_ATTRACTION_LAYOUT.length} attractions, 2 visitors (one shiny + accessorised).`,
    );
  }

  app.ticker.add((ticker) => {
    scene.update(ticker.deltaMS);
  });

  // --- FPS meter: raw rAF delta ring buffer -----------------------------
  const stats = createFrameStats();
  const hud = buildHud();
  document.body.appendChild(hud.root);

  let lastTs: number | null = null;
  let framesSinceHud = 0;
  const loop = (ts: number): void => {
    if (lastTs !== null) stats.record(ts - lastTs);
    lastTs = ts;
    if (++framesSinceHud >= HUD_REFRESH_FRAMES) {
      framesSinceHud = 0;
      const s = stats.snapshot();
      hud.readout.textContent = [
        `fps (avg)   ${s.avgFps.toFixed(1)}`,
        `frame avg   ${s.avgFrameMs.toFixed(2)} ms`,
        `frame p95   ${s.p95FrameMs.toFixed(2)} ms`,
        `frame worst ${s.maxFrameMs.toFixed(2)} ms`,
        `spikes >${SPIKE_THRESHOLD_MS}ms  ${s.spikeCount} / ${s.totalFrames} frames`,
      ].join("\n");
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  // ROUND 2K — the object count, printed rather than guessed. Bible §5.2
  // treats it as a LEADING INDICATOR (the gate is measured frame time),
  // but a count that moves by 60 between runs is worth seeing.
  const objects = countDisplayObjects(scene.view as unknown as { children?: unknown[] });
  console.info(
    `PipsKeep perf mode: ${ambienceScenario ? "AMBIENCE" : "budget"} scenario live ` +
      `(${PERF_PIP_COUNT} pips + ${PERF_DECORATION_COUNT} decorations` +
      `${ambienceScenario ? " + 4 attractions + 2 visitors, night + rain" : ""}). ` +
      `${objects} display objects. ` +
      "For the spec §1 phone profile, enable Chrome DevTools 4x CPU throttle.",
  );
  hud.objectsEl.textContent = `objects    ${objects}`;
}

/**
 * ROUND 2K — recursive display-object count for the HUD readout.
 *
 * Deliberately duck-typed on `children` rather than importing Pixi's
 * `Container`: this file is dev-only and tree-shaken from production
 * (pinned by the `PERF_MODE_MARKER` grep), and the count is a diagnostic,
 * not a contract.
 */
function countDisplayObjects(node: { children?: unknown[] }): number {
  let n = 1;
  for (const child of node.children ?? []) {
    n += countDisplayObjects(child as { children?: unknown[] });
  }
  return n;
}
