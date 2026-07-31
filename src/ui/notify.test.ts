/**
 * Round 2I (docs/notifications-bible.md §7.2): the seam's routing
 * decision — "never both" made structurally impossible by the type
 * system and pinned here so it stays that way. `notify.ts` had no direct
 * test before this round (its toast path was only ever exercised
 * indirectly through other modules' fake-DOM tests); this file is the
 * first one that owns it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../app/sound", () => ({ sound: vi.fn() }));

import { sound } from "../app/sound";
import { installFakeDom, asHtml } from "./fakeDom";
import type { FakeDomHandle } from "./fakeDom";
import {
  initNotify,
  notify,
  registerPushChannel,
  setNotifyVisibilityHost,
} from "./notify";
import type { NotifyPush, PushChannel } from "./notify";

const PUSH: NotifyPush = {
  typeId: "homecoming",
  title: "Rooter is back from the Meadow",
  body: "Pockets full, feet muddy. Come see what they found.",
  tag: "pk-homecoming",
};

function toastCount(dom: FakeDomHandle): number {
  const stack = dom.document.querySelector(".pk-toasts");
  return stack?.children.length ?? -1;
}

describe("notify() — the toast-vs-push seam", () => {
  let dom: FakeDomHandle;

  let hadRaf: boolean;
  let prevRaf: typeof requestAnimationFrame | undefined;

  beforeEach(() => {
    dom = installFakeDom();
    initNotify(asHtml(dom.ui));
    vi.mocked(sound).mockClear();
    // requestAnimationFrame isn't part of fakeDom.ts's minimal surface
    // (nothing else in ui/ calls it directly) — stub it locally rather
    // than growing the shared fake for one call site.
    hadRaf = "requestAnimationFrame" in globalThis;
    prevRaf = (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame })
      .requestAnimationFrame;
    (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame = (
      cb: FrameRequestCallback,
    ) => setTimeout(() => cb(0), 0) as unknown as number;
  });

  afterEach(() => {
    registerPushChannel(null);
    setNotifyVisibilityHost(null);
    dom.uninstall();
    if (hadRaf) {
      (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame =
        prevRaf;
    } else {
      delete (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame })
        .requestAnimationFrame;
    }
  });

  it("an event with no `push` field always toasts, regardless of visibility", () => {
    setNotifyVisibilityHost({ visibilityState: "hidden" });
    const channel: PushChannel = { deliver: vi.fn() };
    registerPushChannel(channel);

    notify({ kind: "info", message: "hello" });

    expect(toastCount(dom)).toBe(1);
    expect(channel.deliver).not.toHaveBeenCalled();
    expect(sound).toHaveBeenCalledWith("notify.toast");
  });

  it("a push-carrying event toasts (and never reaches the channel) while visible", () => {
    setNotifyVisibilityHost({ visibilityState: "visible" });
    const channel: PushChannel = { deliver: vi.fn() };
    registerPushChannel(channel);

    notify({ kind: "expeditionReturn", message: "Rooter is home!", push: PUSH });

    expect(toastCount(dom)).toBe(1);
    expect(channel.deliver).not.toHaveBeenCalled();
    expect(sound).toHaveBeenCalledWith("notify.toast");
  });

  it("a push-carrying event skips the toast and reaches the channel while hidden", () => {
    setNotifyVisibilityHost({ visibilityState: "hidden" });
    const channel: PushChannel = { deliver: vi.fn() };
    registerPushChannel(channel);

    notify({ kind: "expeditionReturn", message: "Rooter is home!", push: PUSH });

    expect(toastCount(dom)).toBe(0);
    expect(channel.deliver).toHaveBeenCalledExactlyOnceWith(PUSH);
    // The OS's own notification sound is the channel's business, not
    // ours — round 2I's finding: this must NOT play alongside it.
    expect(sound).not.toHaveBeenCalled();
  });

  it("a push-carrying event while hidden with no channel registered is a silent no-op", () => {
    setNotifyVisibilityHost({ visibilityState: "hidden" });

    expect(() =>
      notify({ kind: "expeditionReturn", message: "Rooter is home!", push: PUSH }),
    ).not.toThrow();
    expect(toastCount(dom)).toBe(0);
  });

  it("defaults to 'visible' when no visibility host has been set", () => {
    const channel: PushChannel = { deliver: vi.fn() };
    registerPushChannel(channel);

    notify({ kind: "expeditionReturn", message: "Rooter is home!", push: PUSH });

    expect(toastCount(dom)).toBe(1);
    expect(channel.deliver).not.toHaveBeenCalled();
  });
});
