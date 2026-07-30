/**
 * A MINIMAL DOM, FOR TESTS ONLY (round 2G review, findings 1/4/14/15).
 *
 * WHY THIS EXISTS. Round 2G's review ran mutation testing over the round's
 * five headline DOM factories and found that two of them could be gutted
 * with the whole suite green:
 *
 *  - `createXpBar`'s Ready-affordance click handler could be replaced with a
 *    bare `return;` — the bar still rendered, still pulsed gold, still
 *    carried its aria-label, and swallowed every tap. 2230/2230 passed.
 *  - `createLootRevealModal`'s `+N Keep XP` chip could be blanked and hidden
 *    — the bible's "dopamine core" showing no XP, which is the EXACT defect
 *    round 2F had already fixed once. 2230/2230 passed.
 *
 * Both survived for the same reason: `xpBar.test.ts` and `lootReveal.test.ts`
 * were 100% pure-model. Every arithmetic helper was tested to death; nothing
 * asserted a number ever reached a pixel. The same audit found
 * `createTopBar`, `createDoorstep` and `createXpBar` had no DOM test at all,
 * and that `sync` could discard `computeFillPaint` entirely — reintroducing,
 * one frame up, the very bypass that function was extracted to prevent.
 *
 * WHY NOT JSDOM. `vite.config.ts` runs vitest with `environment: "node"`,
 * and jsdom is outside spec §1's dependency allowlist (CLAUDE.md rule 2:
 * `pixi.js`, `idb`, `vite`, `typescript`, `vitest`, the PWA plugin — anything
 * else means stop and ask). `levelUp.test.ts` set the in-repo precedent for
 * the alternative: make the seam injectable and drive the controller against
 * a fake. That works for a controller whose collaborator is one object; it
 * does not scale to a 218-line factory that builds forty elements, because
 * injecting a factory per element is more scaffolding than the thing tested.
 *
 * So this is the other half of the same idea: a fake `document` small enough
 * to read in one sitting, installed as a global for the duration of a test.
 * Production code is untouched — `createTopBar` and friends keep calling
 * `document.createElement` exactly as they do in a browser.
 *
 * WHAT IT IS NOT. Not a browser. No layout, no cascade, no computed style,
 * no event bubbling beyond a direct dispatch, no selector combinators. It
 * models exactly the surface `src/ui/`'s factories actually touch, which the
 * round-2G audit enumerated: element creation, class/attribute/text/style
 * mutation, child manipulation, direct listeners, and the two geometry reads
 * (`getBoundingClientRect`, `clientWidth`) that the code branches on. Layout
 * numbers are INJECTED by the test (`setRect` / `clientWidth`) rather than
 * computed, because a fake that guessed at layout would be a fake that lies.
 *
 * Anything asserting real layout — that a strip is 96px tall, that two boxes
 * do not overlap — belongs in the browser pass, not here. This file's job is
 * narrower and it is the job the mutations proved was undone: pinning that
 * the wiring exists.
 */

// ---------------------------------------------------------------------------
// Rects
// ---------------------------------------------------------------------------

export interface FakeRectInit {
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
}

/** A structural `DOMRect` — the read-only shape `getBoundingClientRect`
 * returns. `toJSON` is present so it satisfies `DOMRect` structurally when a
 * test hands one back through a production type. */
export class FakeRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;

  constructor(init: FakeRectInit = {}) {
    this.x = init.x ?? 0;
    this.y = init.y ?? 0;
    this.width = init.width ?? 0;
    this.height = init.height ?? 0;
  }

  get top(): number {
    return this.y;
  }
  get left(): number {
    return this.x;
  }
  get right(): number {
    return this.x + this.width;
  }
  get bottom(): number {
    return this.y + this.height;
  }
  toJSON(): FakeRectInit {
    return { x: this.x, y: this.y, width: this.width, height: this.height };
  }
}

// ---------------------------------------------------------------------------
// classList / style
// ---------------------------------------------------------------------------

class FakeClassList {
  private readonly names = new Set<string>();

  add(...names: string[]): void {
    for (const n of names) if (n !== "") this.names.add(n);
  }
  remove(...names: string[]): void {
    for (const n of names) this.names.delete(n);
  }
  contains(name: string): boolean {
    return this.names.has(name);
  }
  /** Mirrors the real two-argument form: `force` sets rather than flips. */
  toggle(name: string, force?: boolean): boolean {
    const on = force ?? !this.names.has(name);
    if (on) this.names.add(name);
    else this.names.delete(name);
    return on;
  }
  get value(): string {
    return [...this.names].join(" ");
  }
  set value(next: string) {
    this.names.clear();
    for (const n of next.split(/\s+/)) if (n !== "") this.names.add(n);
  }
  get length(): number {
    return this.names.size;
  }
}

/** Property-bag style object: named properties (`el.style.width = "4px"`)
 * and custom properties (`setProperty("--pk-hud-top", "96px")`) both land in
 * the same map, which is what lets a test read either back. */
class FakeStyle {
  private readonly props = new Map<string, string>();

  setProperty(name: string, value: string): void {
    this.props.set(name, value);
  }
  getPropertyValue(name: string): string {
    return this.props.get(name) ?? "";
  }
  removeProperty(name: string): void {
    this.props.delete(name);
  }

  constructor() {
    // Named properties are assigned directly (`style.background = …`), so
    // trap them into the same map rather than letting them become plain
    // own-properties invisible to `getPropertyValue`.
    return new Proxy(this, {
      get(target, key, receiver): unknown {
        if (typeof key === "string" && !(key in target)) {
          return target.getPropertyValue(key);
        }
        return Reflect.get(target, key, receiver) as unknown;
      },
      set(target, key, value): boolean {
        if (typeof key === "string" && !(key in target)) {
          target.setProperty(key, String(value));
          return true;
        }
        return Reflect.set(target, key, value);
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Selector matching — compound selectors only, no combinators
// ---------------------------------------------------------------------------

interface Compound {
  readonly tag: string | null;
  readonly classes: readonly string[];
  readonly id: string | null;
}

function parseSelectorList(selector: string): readonly Compound[] {
  return selector
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const classes: string[] = [];
      let tag: string | null = null;
      let id: string | null = null;
      // Split on the leading punctuation of each simple selector, keeping it.
      for (const token of part.split(/(?=[.#])/)) {
        if (token.startsWith(".")) classes.push(token.slice(1));
        else if (token.startsWith("#")) id = token.slice(1);
        else if (token !== "") tag = token.toUpperCase();
      }
      return { tag, classes, id };
    });
}

// ---------------------------------------------------------------------------
// The element
// ---------------------------------------------------------------------------

type Listener = (event: FakeEvent) => void;

export interface FakeEvent {
  readonly type: string;
  target?: unknown;
  currentTarget?: unknown;
  key?: string;
  preventDefault(): void;
  stopPropagation(): void;
}

export class FakeElement {
  readonly tagName: string;
  readonly classList = new FakeClassList();
  readonly style = new FakeStyle() as FakeStyle & Record<string, string>;
  readonly children: FakeElement[] = [];
  parentNode: FakeElement | null = null;

  /** Set by the test; read by production code's geometry branches. */
  rect = new FakeRect();
  clientWidth = 0;
  clientHeight = 0;

  /** `data-*` attributes, as the real `HTMLElement.dataset` bag. CSS keys off
   * these (`.pk-action[data-action="feed"]`, onboarding.css), so a test can
   * read back what a factory tagged. */
  readonly dataset: Record<string, string> = {};

  /** Plain DOM properties production code assigns directly. */
  id = "";
  title = "";
  type = "";
  value = "";
  hidden = false;
  disabled = false;
  innerHTML = "";

  private ownText = "";
  private readonly attrs = new Map<string, string>();
  private readonly listeners = new Map<string, Listener[]>();

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  // --- class ---------------------------------------------------------------

  get className(): string {
    return this.classList.value;
  }
  set className(next: string) {
    this.classList.value = next;
  }

  // --- text ----------------------------------------------------------------

  get textContent(): string {
    if (this.children.length === 0) return this.ownText;
    return this.children.map((c) => c.textContent).join("");
  }
  set textContent(next: string) {
    for (const child of this.children) child.parentNode = null;
    this.children.length = 0;
    this.ownText = next;
  }

  // --- attributes ----------------------------------------------------------

  setAttribute(name: string, value: string): void {
    if (name === "class") {
      this.className = value;
      return;
    }
    this.attrs.set(name, value);
  }
  getAttribute(name: string): string | null {
    if (name === "class") return this.className;
    return this.attrs.get(name) ?? null;
  }
  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }
  hasAttribute(name: string): boolean {
    return name === "class" ? this.className !== "" : this.attrs.has(name);
  }

  // --- tree ----------------------------------------------------------------

  appendChild<T extends FakeElement>(child: T): T {
    child.remove();
    child.parentNode = this;
    this.children.push(child);
    // A node with children has no own text (matches real `textContent`).
    this.ownText = "";
    return child;
  }
  append(...nodes: FakeElement[]): void {
    for (const node of nodes) this.appendChild(node);
  }
  replaceChildren(...nodes: FakeElement[]): void {
    for (const child of this.children) child.parentNode = null;
    this.children.length = 0;
    this.ownText = "";
    for (const node of nodes) this.appendChild(node);
  }
  insertBefore<T extends FakeElement>(node: T, ref: FakeElement | null): T {
    node.remove();
    node.parentNode = this;
    const at = ref === null ? this.children.length : this.children.indexOf(ref);
    this.children.splice(at < 0 ? this.children.length : at, 0, node);
    return node;
  }
  remove(): void {
    const parent = this.parentNode;
    if (parent === null) return;
    const at = parent.children.indexOf(this);
    if (at >= 0) parent.children.splice(at, 1);
    this.parentNode = null;
  }

  get firstChild(): FakeElement | null {
    return this.children[0] ?? null;
  }
  get childElementCount(): number {
    return this.children.length;
  }

  /** True once this node's root chain reaches an element flagged as
   * document-attached (see `FakeDocument.body` / `installFakeDom`). */
  get isConnected(): boolean {
    let node: FakeElement | null = this;
    while (node !== null) {
      if (connectedRoots.has(node)) return true;
      node = node.parentNode;
    }
    return false;
  }

  // --- queries -------------------------------------------------------------

  matches(selector: string): boolean {
    return parseSelectorList(selector).some(
      (c) =>
        (c.tag === null || c.tag === this.tagName) &&
        (c.id === null || c.id === this.id) &&
        c.classes.every((cls) => this.classList.contains(cls)),
    );
  }

  querySelector(selector: string): FakeElement | null {
    for (const child of this.children) {
      if (child.matches(selector)) return child;
      const nested = child.querySelector(selector);
      if (nested !== null) return nested;
    }
    return null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    const found: FakeElement[] = [];
    const walk = (node: FakeElement): void => {
      for (const child of node.children) {
        if (child.matches(selector)) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }

  closest(selector: string): FakeElement | null {
    let node: FakeElement | null = this;
    while (node !== null) {
      if (node.matches(selector)) return node;
      node = node.parentNode;
    }
    return null;
  }

  // --- geometry ------------------------------------------------------------

  getBoundingClientRect(): FakeRect {
    return this.rect;
  }
  /** Chainable test helper — real elements get their rect from layout. */
  setRect(init: FakeRectInit): this {
    this.rect = new FakeRect(init);
    return this;
  }

  // --- events --------------------------------------------------------------

  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type);
    if (list === undefined) this.listeners.set(type, [listener]);
    else list.push(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type);
    if (list === undefined) return;
    const at = list.indexOf(listener);
    if (at >= 0) list.splice(at, 1);
  }

  /** Direct dispatch — no capture, no bubbling. `target` defaults to this
   * element, and is overridable for the handlers that branch on it (e.g.
   * `lootReveal.ts`'s "a tap anywhere but Collect fast-forwards"). */
  dispatch(type: string, init: Partial<FakeEvent> = {}): FakeEvent {
    const event: FakeEvent = {
      type,
      target: init.target ?? this,
      currentTarget: this,
      ...(init.key === undefined ? {} : { key: init.key }),
      preventDefault: () => {},
      stopPropagation: () => {},
    };
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(event);
    }
    return event;
  }

  /** The obvious spelling, so tests read like the interaction they model.
   * A disabled control swallows the click exactly as a real one does — this
   * is what makes "omitting the callback yields an inert control" assertable
   * rather than merely visible. */
  click(): void {
    if (this.disabled) return;
    this.dispatch("click");
  }

  /** Every listener type currently registered — lets a test assert that a
   * handler was attached at all without knowing what it does. */
  listenerCount(type: string): number {
    return this.listeners.get(type)?.length ?? 0;
  }
}

/** Elements treated as document-attached, so `isConnected` is meaningful. */
const connectedRoots = new WeakSet<FakeElement>();

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

export class FakeDocument {
  readonly documentElement = new FakeElement("html");
  readonly body = new FakeElement("body");

  constructor() {
    connectedRoots.add(this.documentElement);
    this.documentElement.appendChild(this.body);
  }

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName);
  }

  getElementById(id: string): FakeElement | null {
    return this.documentElement.querySelector(`#${id}`);
  }

  querySelector(selector: string): FakeElement | null {
    return this.documentElement.querySelector(selector);
  }

  querySelectorAll(selector: string): FakeElement[] {
    return this.documentElement.querySelectorAll(selector);
  }
}

// ---------------------------------------------------------------------------
// Installation
// ---------------------------------------------------------------------------

export interface FakeDomHandle {
  readonly document: FakeDocument;
  /** `#ui` — the host every self-contained `ui/` module mounts into. */
  readonly ui: FakeElement;
  /** Restores whatever globals were there before. Call in `afterEach`. */
  uninstall(): void;
}

interface GlobalPatch {
  document?: unknown;
  window?: unknown;
  ResizeObserver?: unknown;
}

/**
 * Installs a fake `document`/`window` as globals and returns a handle.
 *
 * `ResizeObserver` is deliberately left UNDEFINED: every module that uses one
 * guards with `typeof ResizeObserver !== "undefined"`, so leaving it absent
 * exercises the same "no observer available" path a server render takes, and
 * keeps the fake from having to model layout it cannot compute. A test that
 * wants the observed behaviour asserts on the code path that writes the
 * variable, not on the observer firing.
 *
 * `window.setTimeout` forwards to the ambient timer functions, so
 * `vi.useFakeTimers()` continues to control anything the UI schedules.
 */
export function installFakeDom(viewportHeight = 812): FakeDomHandle {
  const doc = new FakeDocument();
  const ui = doc.createElement("div");
  ui.id = "ui";
  doc.body.appendChild(ui);

  const scope = globalThis as unknown as GlobalPatch;
  const had = {
    document: "document" in scope,
    window: "window" in scope,
  };
  const prev = { document: scope.document, window: scope.window };

  const fakeWindow = {
    innerHeight: viewportHeight,
    innerWidth: 375,
    document: doc,
    setTimeout: (fn: () => void, ms?: number): number =>
      setTimeout(fn, ms) as unknown as number,
    clearTimeout: (id: number): void => {
      clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
    },
    addEventListener: (): void => {},
    removeEventListener: (): void => {},
  };

  scope.document = doc;
  scope.window = fakeWindow;

  return {
    document: doc,
    ui,
    uninstall(): void {
      if (had.document) scope.document = prev.document;
      else delete scope.document;
      if (had.window) scope.window = prev.window;
      else delete scope.window;
    },
  };
}

/** Cast helper: hands a `FakeElement` to production code typed for
 * `HTMLElement`. Confined to this file so no test has to write the cast (and
 * so every one of them is greppable from one place). */
export function asHtml(el: FakeElement): HTMLElement {
  return el as unknown as HTMLElement;
}
