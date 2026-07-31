/**
 * ⚠️ ROUND 2K FIX STAGE — GUARD #3 (docs/liveliness-bible.md §6.1.2), the
 * one the round specified and did not build.
 *
 * `portraitPatterns.test.ts` proves an accessory rule EXISTS, is UNIQUE and
 * is MOUNTED. All three pass with the scarf drawn straight across the
 * mouth — which is exactly what shipped, on both DOM portrait surfaces, on
 * every silhouette. A live sweep of 12 accessories × 5 silhouettes × 3
 * surfaces found 36 collisions: the scarf covering 54% of a `wide` Pip's
 * mouth, the ember-bead 82% and sitting inside the mouth arc so it read as
 * a tongue.
 *
 * The bible's own line explains why nothing caught it: *a guard that never
 * measures is not a guard.* So this file measures. It resolves each
 * accessory rule's real geometry out of the stylesheet — including its
 * `::before`/`::after`, its `box-shadow` spread, its rotation and the
 * shared `drop-shadow` contour — and asserts the painted band never
 * overlaps the painted mouth or either eye, for every silhouette at every
 * portrait box size and at both extremes of the per-individual jitter.
 *
 * It is a deliberately small CSS evaluator rather than a browser: the
 * rules it has to understand are `<n>%`, `<n>px`, `var()` and one level of
 * `calc()`, because part of this fix was removing the `min-height` pixel
 * floors that made the geometry unpredictable in the first place. If a
 * future rule needs more than that, it needs more than that on purpose —
 * and this suite will say so loudly rather than quietly stop measuring.
 */

import { describe, expect, it } from "vitest";
import uiCss from "./ui.css?raw";
import pipdexCss from "./pipdex.css?raw";
import { ACCESSORY_IDS, resolveAccessory } from "../content/accessories";
import {
  ACCESSORY_ZONE_PCT,
  SILHOUETTE_FRACTIONS,
  JITTER_MAX_BODY_SHRINK,
  accessoryZoneStyleVars,
} from "../render/pipGeometry";
import type { AccessorySlot } from "../content/accessories";

// ---------------------------------------------------------------------------
// A very small CSS value evaluator.
// ---------------------------------------------------------------------------

type Env = Readonly<Record<string, string>>;

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** All declarations of the LAST rule whose selector list contains
 * `selector` exactly (later rules win, as in a real cascade). */
function ruleBody(css: string, selector: string): Record<string, string> | null {
  const clean = stripComments(css);
  const out: Record<string, string> = {};
  let found = false;
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    const selectors = (m[1] ?? "").split(",").map((s) => s.trim());
    if (!selectors.includes(selector)) continue;
    found = true;
    for (const decl of (m[2] ?? "").split(";")) {
      const i = decl.indexOf(":");
      if (i < 0) continue;
      out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
    }
  }
  return found ? out : null;
}

/**
 * Resolve a length to px against `base` (the percentage basis). Handles
 * `<n>px`, `<n>%`, `var(--x, fallback)`, and `calc()` over `+ - *`.
 * Throws on anything else — silence is how the last guard went vacuous.
 */
function resolveLength(value: string, base: number, env: Env): number {
  const out = evalExpr(expandVars(value, env), base);
  // A NaN here is the failure mode that matters most: `Math.min`/`>` both
  // go quiet on NaN, so an unparsed value would make every overlap check
  // pass without measuring anything — the precise way the last guard was
  // vacuous. Never let it through.
  if (!Number.isFinite(out)) throw new Error(`CSS length '${value}' did not evaluate to a number`);
  return out;
}

function expandVars(value: string, env: Env): string {
  let out = value;
  for (let guard = 0; guard < 8 && out.includes("var("); guard += 1) {
    out = out.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*?))?\s*\)/g, (_all, name, fallback) => {
      const v = env[name as string];
      if (v !== undefined) return v;
      if (fallback !== undefined) return String(fallback);
      throw new Error(`unresolved CSS variable ${String(name)} (and no fallback)`);
    });
  }
  return out;
}

/**
 * A recursive-descent parser over `+ - * /` with parentheses, because
 * `var(--pk-acc-top)` expands to a `calc()` that is itself nested inside
 * another `calc()` — and a flat left-to-right splitter silently produced
 * `NaN` for exactly the three rules this fix re-authored. Percentages
 * resolve against `base`; unitless numbers are multipliers.
 */
function evalExpr(expr: string, base: number): number {
  const tokens = expr.match(/[\d.]+(?:px|%)?|calc|[()+\-*/]/g) ?? [];
  let i = 0;
  const parseAdditive = (): number => {
    let v = parseMultiplicative();
    while (tokens[i] === "+" || tokens[i] === "-") {
      const op = tokens[i];
      i += 1;
      const r = parseMultiplicative();
      v = op === "-" ? v - r : v + r;
    }
    return v;
  };
  const parseMultiplicative = (): number => {
    let v = parseAtom();
    while (tokens[i] === "*" || tokens[i] === "/") {
      const op = tokens[i];
      i += 1;
      const r = parseAtom();
      v = op === "/" ? v / r : v * r;
    }
    return v;
  };
  const parseAtom = (): number => {
    let t = tokens[i];
    i += 1;
    if (t === "calc") {
      t = tokens[i];
      i += 1;
    }
    if (t === "(") {
      const v = parseAdditive();
      i += 1; // ")"
      return v;
    }
    if (t === "-") return -parseAtom();
    if (t === undefined) throw new Error(`ran out of tokens evaluating '${expr}'`);
    if (t.endsWith("%")) return (parseFloat(t) / 100) * base;
    if (t.endsWith("px")) return parseFloat(t);
    return parseFloat(t);
  };
  return parseAdditive();
}

/**
 * How far a `box-shadow` list paints ABOVE and BELOW its own box.
 *
 * This matters more than it sounds: several accessories are BUILT from
 * box-shadows (the flower's four petals, the pebble crown's stones), so a
 * shadow here is solid paint, not decoration, and a rule whose box clears
 * the eyes can still put a petal on one. Measured per shadow as
 * `|y| ± (blur + spread)` and maxed across the comma-separated list.
 */
function shadowReachY(decl: string | undefined): { up: number; down: number } {
  if (decl === undefined) return { up: 0, down: 0 };
  let up = 0;
  let down = 0;
  for (const part of decl.split(/,(?![^()]*\))/)) {
    const lengths = [...part.matchAll(/(-?[\d.]+)px/g)].map((m) => parseFloat(m[1] ?? "0"));
    const [, y = 0, blur = 0, spread = 0] = lengths;
    up = Math.max(up, -y + blur + spread);
    down = Math.max(down, y + blur + spread);
  }
  return { up: Math.max(0, up), down: Math.max(0, down) };
}

/** How far a `rotate(Ndeg)` pushes an w×h box beyond its own edges. */
function rotationReachY(decl: string | undefined, w: number, h: number): number {
  const m = decl?.match(/rotate\((-?[\d.]+)deg\)/);
  if (!m) return 0;
  const rad = (Math.abs(parseFloat(m[1] ?? "0")) * Math.PI) / 180;
  const rotatedH = w * Math.sin(rad) + h * Math.cos(rad);
  return Math.max(0, (rotatedH - h) / 2);
}

// ---------------------------------------------------------------------------
// The two DOM portrait surfaces, described exactly as their stylesheets do.
// ---------------------------------------------------------------------------

interface Surface {
  readonly name: string;
  readonly css: string;
  /** `.pk-pipdex-accessory` / `.pk-portrait-accessory` */
  readonly accessoryBase: string;
  readonly mouthSelector: string;
  readonly eyesSelector: string;
  readonly eyeSelector: string;
  /** Portrait boxes this surface renders at: [boxW, boxH] before fractions. */
  readonly boxes: readonly (readonly [string, number, number])[];
}

const SURFACES: readonly Surface[] = [
  {
    name: "Album / cast strip / Long Meadow (pipdex.css)",
    css: pipdexCss,
    accessoryBase: ".pk-pipdex-accessory",
    mouthSelector: ".pk-pipdex-mouth",
    eyesSelector: ".pk-pipdex-eyes",
    eyeSelector: ".pk-pipdex-eyes i",
    boxes: [
      ["chip", 44, 40],
      ["small", 58, 48],
      ["large", 112, 92],
    ],
  },
  {
    name: "focus view (ui.css)",
    css: uiCss,
    accessoryBase: ".pk-portrait-accessory",
    mouthSelector: ".pk-portrait-mouth",
    eyesSelector: ".pk-portrait-eyes",
    eyeSelector: ".pk-portrait-eyes i",
    // `.pk-portrait` is 116×108 and the blob is `calc((100% - 8px) * ...)`.
    boxes: [["focus", 108, 100]],
  },
];

const SILHOUETTES = Object.keys(SILHOUETTE_FRACTIONS) as (keyof typeof SILHOUETTE_FRACTIONS)[];
/** Both ends of the shrink-only jitter range (`computeJitter`). */
const JITTERS = [1, 1 - JITTER_MAX_BODY_SHRINK] as const;

interface Band {
  readonly top: number;
  readonly bottom: number;
}

const overlap = (a: Band, b: Band): number =>
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

/** The mouth's painted band, in px from the blob's top edge. */
function mouthBand(s: Surface, blobH: number): Band {
  const rule = ruleBody(s.css, s.mouthSelector);
  if (rule === null) throw new Error(`${s.name}: no mouth rule — the face has no lower landmark`);
  const top = resolveLength(rule["top"] ?? "0", blobH, {});
  const height = resolveLength(rule["height"] ?? "0", blobH, {});
  const stroke = parseFloat(rule["border-bottom"]?.match(/([\d.]+)px/)?.[1] ?? "0");
  return { top, bottom: top + height + stroke };
}

/** Either eye's painted band. The eyes row has no height of its own — it
 * is a flex row whose height IS the eye's. */
function eyeBand(s: Surface, blobW: number, blobH: number): Band {
  const eyes = ruleBody(s.css, s.eyesSelector);
  const eye = ruleBody(s.css, s.eyeSelector);
  if (eyes === null || eye === null) throw new Error(`${s.name}: no eye rules`);
  // `--pk-jeye-dy` is a jitter offset in whole percent; 0 is the neutral
  // case the fallbacks encode, and the extremes are swept via `blobH`.
  const top = resolveLength(eyes["top"] ?? "0", blobH, { "--pk-jeye-dy": "0" });
  const wRaw = resolveLength(eye["width"] ?? "0", blobW, {
    "--pk-jeye-w": "1",
    "--pk-jeye-h": "1",
  });
  const w = Math.max(wRaw, parseFloat(eye["min-width"] ?? "0"));
  // Square by construction on both surfaces (an explicit `height` on the
  // focus view, `aspect-ratio: jw/jh` = 1 at neutral jitter on the Album).
  const h = eye["height"] !== undefined ? resolveLength(eye["height"], blobH, {}) : w;
  return { top, bottom: top + h };
}

/**
 * The union of every pixel an accessory paints, in px from the blob's top
 * edge — element box, both pseudo-elements, box-shadow reach, rotation
 * expansion and the shared drop-shadow contour.
 */
function paintedBand(s: Surface, accessoryId: string, slot: AccessorySlot, blobH: number): Band {
  const sel = `${s.accessoryBase}--${accessoryId}`;
  const base = ruleBody(s.css, s.accessoryBase) ?? {};
  const rule = ruleBody(s.css, sel);
  if (rule === null) throw new Error(`${s.name}: no rule for ${accessoryId}`);

  // The zone vars the TS writes inline, plus this surface's own base-class
  // derived vars (`--pk-acc-top` / `--pk-acc-bottom`).
  const env: Record<string, string> = {
    ...accessoryZoneStyleVars(slot),
    ...Object.fromEntries(Object.entries(base).filter(([k]) => k.startsWith("--"))),
    ...Object.fromEntries(Object.entries(rule).filter(([k]) => k.startsWith("--"))),
  };

  const top = resolveLength(rule["top"] ?? "0", blobH, env);
  const height = Math.max(
    resolveLength(rule["height"] ?? "0", blobH, env),
    rule["min-height"] !== undefined ? resolveLength(rule["min-height"], blobH, env) : 0,
  );
  const width = resolveLength(rule["width"] ?? "0", blobH, env); // rotation only

  let minY = top;
  let maxY = top + height;

  for (const pseudo of ["::before", "::after"] as const) {
    const p = ruleBody(s.css, `${sel}${pseudo}`);
    if (p === null) continue;
    const pEnv = { ...env, ...Object.fromEntries(Object.entries(p).filter(([k]) => k.startsWith("--"))) };
    const pH = Math.max(
      resolveLength(p["height"] ?? "0", height, pEnv),
      p["min-height"] !== undefined ? resolveLength(p["min-height"], height, pEnv) : 0,
    );
    let pTop: number;
    if (p["top"] !== undefined) {
      pTop = top + resolveLength(p["top"], height, pEnv);
    } else if (p["bottom"] !== undefined) {
      // Offset UP from the element's own bottom edge.
      pTop = top + height - resolveLength(p["bottom"], height, pEnv) - pH;
    } else {
      pTop = top;
    }
    const pShadow = shadowReachY(p["box-shadow"]);
    minY = Math.min(minY, pTop - pShadow.up);
    maxY = Math.max(maxY, pTop + pH + pShadow.down);
  }

  const shadow = shadowReachY(rule["box-shadow"]);
  const spin = rotationReachY(rule["transform"], width, height);
  // NOT counted: the base class's `drop-shadow(0 0.5px 0.7px)` contour.
  // That is a soft, sub-pixel, semi-transparent outline whose whole job is
  // to sit ON the edge of the shape — treating it as paint would make
  // every rule fail by ~1px and force the real geometry to be tuned
  // against a shadow. What IS counted is solid paint: box-shadow petals,
  // pseudo-elements, and rotation.
  return { top: minY - shadow.up - spin, bottom: maxY + shadow.down + spin };
}

// ---------------------------------------------------------------------------

const slotOf = (id: string): AccessorySlot => {
  const def = resolveAccessory(id);
  if (def === null) throw new Error(`no accessory content for '${id}'`);
  return def.slot;
};

describe("the shared accessory zone table", () => {
  it("is real, covers every slot, and every band is non-empty", () => {
    const slots: AccessorySlot[] = ["crown", "neck", "shoulder", "side"];
    for (const slot of slots) {
      const zone = ACCESSORY_ZONE_PCT[slot];
      expect(zone, `no band for slot '${slot}'`).toBeDefined();
      expect(zone.bottom).toBeGreaterThan(zone.top);
    }
    // Everything worn on the BODY must start below the painted mouth; a
    // table that let `neck` start at 0 would satisfy every structural
    // check in portraitPatterns.test.ts and reintroduce the whole defect.
    expect(ACCESSORY_ZONE_PCT.neck.top).toBeGreaterThan(55);
    expect(ACCESSORY_ZONE_PCT.crown.bottom).toBeLessThan(ACCESSORY_ZONE_PCT.neck.top);
  });

  it("both DOM surfaces derive their band from it, rather than hand-picking percentages", () => {
    // The structural half of the guard: a rule that goes back to
    // `top: 59%` stops tracking the mouth the moment a box size changes,
    // even if today's numbers happen to clear it.
    for (const s of SURFACES) {
      const bodyWorn = ACCESSORY_IDS.filter((id) => slotOf(id) !== "crown");
      expect(bodyWorn.length).toBeGreaterThan(2);
      for (const id of bodyWorn) {
        const rule = ruleBody(s.css, `${s.accessoryBase}--${id}`);
        expect(
          rule?.["top"],
          `${s.name}: '${id}' does not position from the shared band`,
        ).toContain("--pk-acc-top");
      }
    }
  });
});

describe("no accessory is painted across the mouth or an eye (the shipped blocker)", () => {
  it("sweeps a non-trivial matrix (guards against a vacuous suite)", () => {
    const cases = SURFACES.reduce((n, s) => n + s.boxes.length, 0) * SILHOUETTES.length *
      JITTERS.length * ACCESSORY_IDS.length;
    expect(SILHOUETTES.length).toBe(5);
    expect(ACCESSORY_IDS.length).toBeGreaterThan(8);
    expect(cases).toBeGreaterThan(300);
  });

  for (const surface of SURFACES) {
    for (const [boxName, boxW, boxH] of surface.boxes) {
      describe(`${surface.name} @ ${boxName}`, () => {
        it.each(ACCESSORY_IDS)("'%s' clears the face on every silhouette", (accessoryId) => {
          const slot = slotOf(accessoryId);
          const failures: string[] = [];
          for (const silhouette of SILHOUETTES) {
            const f = SILHOUETTE_FRACTIONS[silhouette];
            for (const jitter of JITTERS) {
              const blobH = boxH * f.h * jitter;
              const blobW = boxW * f.w * jitter;
              const painted = paintedBand(surface, accessoryId, slot, blobH);
              const mouth = mouthBand(surface, blobH);
              const eyes = eyeBand(surface, blobW, blobH);
              const onMouth = overlap(painted, mouth);
              const onEyes = overlap(painted, eyes);
              if (onMouth > 0) {
                failures.push(
                  `${silhouette} (jitter ${jitter}): covers ${onMouth.toFixed(2)}px of the ` +
                    `mouth [${mouth.top.toFixed(1)}, ${mouth.bottom.toFixed(1)}] with paint ` +
                    `[${painted.top.toFixed(1)}, ${painted.bottom.toFixed(1)}]`,
                );
              }
              if (onEyes > 0) {
                failures.push(
                  `${silhouette} (jitter ${jitter}): covers ${onEyes.toFixed(2)}px of the ` +
                    `eye row [${eyes.top.toFixed(1)}, ${eyes.bottom.toFixed(1)}] with paint ` +
                    `[${painted.top.toFixed(1)}, ${painted.bottom.toFixed(1)}]`,
                );
              }
            }
          }
          expect(failures, `'${accessoryId}':\n  ${failures.join("\n  ")}`).toEqual([]);
        });

        it.each(ACCESSORY_IDS)("'%s' stays on the body (never below the feet)", (accessoryId) => {
          const slot = slotOf(accessoryId);
          for (const silhouette of SILHOUETTES) {
            const blobH = boxH * SILHOUETTE_FRACTIONS[silhouette].h;
            const painted = paintedBand(surface, accessoryId, slot, blobH);
            expect(
              painted.bottom,
              `'${accessoryId}' on ${silhouette} hangs ${(painted.bottom - blobH).toFixed(1)}px ` +
                `past the feet`,
            ).toBeLessThanOrEqual(blobH);
          }
        });
      });
    }
  }
});
