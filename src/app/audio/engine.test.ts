/**
 * The engine: autoplay lock, master chain, mute, and the drop policy.
 *
 * `play()` returns the plan it scheduled or null when it refused, which
 * makes "did that tap actually make a noise?" a plain assertion.
 */

import { describe, expect, it, vi } from "vitest";
import { createRng } from "../../core/rng";
import type { RngStream } from "../../core/rng";
import {
  createAudioEngine,
  LIMITER,
  MASTER_GAIN,
  MUTE_RAMP,
  SCHEDULE_LEAD,
  WARMTH_HZ,
} from "./engine";
import type { AudioEngine } from "./engine";
import type { CueSpec } from "./plan";
import { createStubAudioContext } from "./stubContext";
import type { StubAudioContext } from "./stubContext";

function stream(seed = 42): RngStream {
  return createRng(seed).stream("audio-jitter");
}

interface Harness {
  readonly ctx: StubAudioContext;
  readonly engine: AudioEngine;
}

function harness(
  options: {
    palette?: Readonly<Record<string, CueSpec>>;
    muted?: boolean;
    maxVoices?: number;
    seed?: number;
  } = {},
): Harness {
  // A small sample rate keeps the noise-buffer fill cheap in tests.
  const ctx = createStubAudioContext({ sampleRate: 4000 });
  const engine = createAudioEngine({
    createContext: () => ctx,
    rng: stream(options.seed),
    ...(options.palette !== undefined ? { palette: options.palette } : {}),
    ...(options.muted !== undefined ? { muted: options.muted } : {}),
    ...(options.maxVoices !== undefined ? { maxVoices: options.maxVoices } : {}),
    onError: () => undefined,
  });
  return { ctx, engine };
}

const blipCue = (over: Partial<CueSpec> = {}): CueSpec => ({
  cooldownMs: 100,
  notes: [
    {
      kind: "tone",
      wave: "sine",
      degree: 0,
      at: 0,
      attack: 0.005,
      decay: 0.02,
      sustain: 0.3,
      hold: 0,
      release: 0.08,
      gain: 0.2,
    },
  ],
  ...over,
});

describe("autoplay policy", () => {
  it("makes no sound and builds no context before a gesture", () => {
    const ctx = createStubAudioContext({ sampleRate: 4000 });
    const create = vi.fn(() => ctx);
    const engine = createAudioEngine({ createContext: create, rng: stream() });
    expect(engine.play("care.feed")).toBeNull();
    expect(engine.isReady()).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it("builds the context exactly once, on unlock, and resumes it", () => {
    const ctx = createStubAudioContext({ sampleRate: 4000 });
    const create = vi.fn(() => ctx);
    const engine = createAudioEngine({ createContext: create, rng: stream() });
    engine.unlock();
    engine.unlock();
    expect(create).toHaveBeenCalledTimes(1);
    expect(ctx.resumeCalls).toBeGreaterThanOrEqual(1);
    expect(engine.isReady()).toBe(true);
  });

  it("rebuilds after the context is closed (iOS backgrounding)", () => {
    const first = createStubAudioContext({ sampleRate: 4000 });
    const second = createStubAudioContext({ sampleRate: 4000 });
    const contexts = [first, second];
    const engine = createAudioEngine({
      createContext: () => contexts.shift() as StubAudioContext,
      rng: stream(),
    });
    engine.unlock();
    first.setState("closed");
    expect(engine.isReady()).toBe(false);
    engine.unlock();
    expect(engine.isReady()).toBe(true);
    expect(second.resumeCalls).toBeGreaterThanOrEqual(1);
  });

  it("survives a browser with no Web Audio at all — silently", () => {
    const onError = vi.fn();
    const engine = createAudioEngine({
      createContext: () => {
        throw new Error("no Web Audio here");
      },
      rng: stream(),
      onError,
    });
    expect(() => engine.unlock()).not.toThrow();
    expect(engine.play("care.feed")).toBeNull();
    expect(engine.isReady()).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
    // Latched: a broken context is not retried on every single tap.
    engine.unlock();
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe("master chain", () => {
  it("wires master gain → warmth lowpass → limiter → destination", () => {
    const { ctx, engine } = harness();
    engine.unlock();

    const master = ctx.gains[0];
    const warmth = ctx.filters[0];
    const limiter = ctx.compressors[0];
    expect(master?.gain.events[0]?.value).toBe(MASTER_GAIN);
    expect(master?.outputs).toContain(warmth);
    expect(warmth?.type).toBe("lowpass");
    expect(warmth?.frequency.events[0]?.value).toBe(WARMTH_HZ);
    expect(warmth?.outputs).toContain(limiter);
    expect(limiter?.outputs).toContain(ctx.destination);
  });

  it("configures the compressor as a limiter, not a gentle glue bus", () => {
    const { ctx, engine } = harness();
    engine.unlock();
    const limiter = ctx.compressors[0];
    expect(limiter?.threshold.events[0]?.value).toBe(LIMITER.threshold);
    expect(limiter?.ratio.events[0]?.value).toBe(LIMITER.ratio);
    expect(LIMITER.ratio).toBeGreaterThanOrEqual(10);
    expect(LIMITER.attack).toBeLessThanOrEqual(0.01);
  });

  it("routes cues through the master gain, never straight to the destination", () => {
    const { ctx, engine } = harness({ palette: { "test.blip": blipCue() } });
    engine.unlock();
    const master = ctx.gains[0];
    engine.play("test.blip");
    const voiceGain = ctx.gains.at(-1);
    expect(voiceGain?.outputs).toContain(master);
    expect(voiceGain?.outputs).not.toContain(ctx.destination);
  });
});

describe("play", () => {
  it("schedules a cue slightly ahead of the audio clock", () => {
    const { ctx, engine } = harness({ palette: { "test.blip": blipCue() } });
    engine.unlock();
    ctx.advance(3);
    const plan = engine.play("test.blip");
    expect(plan?.slot).toBe("test.blip");
    expect(plan?.start).toBeCloseTo(3 + SCHEDULE_LEAD, 9);
    expect(ctx.oscillators[0]?.startedAt).toBeCloseTo(3 + SCHEDULE_LEAD, 9);
  });

  it("plays a real care cue end to end", () => {
    const { ctx, engine } = harness();
    engine.unlock();
    const plan = engine.play("care.feed");
    expect(plan).not.toBeNull();
    expect(ctx.oscillators.length).toBeGreaterThan(0);
    expect(ctx.sources.length).toBeGreaterThan(0); // the munchy noise layer
  });

  it("gives an unknown slot the default cue rather than silence", () => {
    const { engine } = harness();
    engine.unlock();
    expect(engine.play("some.slot.nobody.scored")).not.toBeNull();
  });
});

describe("cooldowns — mashing a button does not machine-gun", () => {
  it("drops repeats inside the slot's cooldown", () => {
    const { ctx, engine } = harness({
      palette: { "test.blip": blipCue({ cooldownMs: 100 }) },
    });
    engine.unlock();
    expect(engine.play("test.blip")).not.toBeNull();
    expect(engine.play("test.blip")).toBeNull();
    ctx.advance(0.05);
    expect(engine.play("test.blip")).toBeNull();
    ctx.advance(0.06);
    expect(engine.play("test.blip")).not.toBeNull();
  });

  it("twenty frantic taps produce a handful of blips, not twenty", () => {
    const { ctx, engine } = harness();
    engine.unlock();
    let played = 0;
    for (let i = 0; i < 20; i++) {
      if (engine.play("ui.tap") !== null) played++;
      ctx.advance(0.01); // a tap every 10ms — faster than any human
    }
    expect(played).toBeGreaterThan(0);
    expect(played).toBeLessThanOrEqual(6);
  });

  it("does not burn an rng draw on a cue it refuses", () => {
    const palette = { "test.blip": blipCue({ jitterCents: 400 }) };
    const a = harness({ palette });
    a.engine.unlock();
    const first = a.engine.play("test.blip");
    a.engine.play("test.blip"); // refused — must not advance the stream
    a.ctx.advance(0.2);
    const second = a.engine.play("test.blip");

    const b = harness({ palette });
    b.engine.unlock();
    const firstB = b.engine.play("test.blip");
    b.ctx.advance(0.2);
    const secondB = b.engine.play("test.blip");

    const freq = (plan: typeof first): number =>
      plan?.voices[0]?.kind === "tone" ? plan.voices[0].freq : -1;
    expect(freq(first)).toBe(freq(firstB));
    expect(freq(second)).toBe(freq(secondB));
  });
});

describe("voice cap", () => {
  it("refuses ordinary cues once too much is ringing", () => {
    const long = blipCue({ cooldownMs: 0 });
    const palette = { a: long, b: long, c: long, d: long };
    const { engine } = harness({ palette, maxVoices: 3 });
    engine.unlock();
    expect(engine.play("a")).not.toBeNull();
    expect(engine.play("b")).not.toBeNull();
    expect(engine.play("c")).not.toBeNull();
    expect(engine.play("d")).toBeNull();
    expect(engine.activeVoices()).toBe(3);
  });

  it("never drops a priority-2 moment", () => {
    const long = blipCue({ cooldownMs: 0 });
    const palette = { a: long, b: long, c: long, big: blipCue({ cooldownMs: 0, priority: 2 }) };
    const { engine } = harness({ palette, maxVoices: 2 });
    engine.unlock();
    engine.play("a");
    engine.play("b");
    expect(engine.play("c")).toBeNull();
    expect(engine.play("big")).not.toBeNull();
  });

  it("frees up again as voices ring out", () => {
    const palette = { a: blipCue({ cooldownMs: 0 }), b: blipCue({ cooldownMs: 0 }) };
    const { ctx, engine } = harness({ palette, maxVoices: 1 });
    engine.unlock();
    expect(engine.play("a")).not.toBeNull();
    expect(engine.play("b")).toBeNull();
    ctx.advance(1);
    expect(engine.activeVoices()).toBe(0);
    expect(engine.play("b")).not.toBeNull();
  });
});

describe("mute", () => {
  it("starts muted when the restored preference says so", () => {
    const { ctx, engine } = harness({ muted: true });
    engine.unlock();
    expect(engine.isMuted()).toBe(true);
    expect(ctx.gains[0]?.gain.events[0]?.value).toBe(0);
    expect(engine.play("care.feed")).toBeNull();
    expect(ctx.oscillators).toHaveLength(0);
  });

  it("schedules nothing at all while muted — silence is free", () => {
    const { ctx, engine } = harness();
    engine.unlock();
    engine.setMuted(true);
    for (let i = 0; i < 10; i++) {
      expect(engine.play("care.play")).toBeNull();
      ctx.advance(1);
    }
    expect(ctx.oscillators).toHaveLength(0);
  });

  it("fades the master gain instead of cutting it (a hard step clicks)", () => {
    const { ctx, engine } = harness();
    engine.unlock();
    ctx.advance(2);
    engine.setMuted(true);
    const master = ctx.gains[0];
    const ramp = master?.gain.events.at(-1);
    expect(ramp?.kind).toBe("linear");
    expect(ramp?.value).toBe(0);
    expect(ramp?.time).toBeCloseTo(2 + MUTE_RAMP, 9);
    // …from wherever it was, so a ringing chime fades out rather than
    // being chopped off.
    expect(master?.gain.events.at(-2)?.kind).toBe("set");
  });

  it("comes back to full level on unmute and plays again", () => {
    const { ctx, engine } = harness();
    engine.unlock();
    engine.setMuted(true);
    engine.setMuted(false);
    expect(engine.isMuted()).toBe(false);
    expect(ctx.gains[0]?.gain.events.at(-1)?.value).toBe(MASTER_GAIN);
    expect(engine.play("care.feed")).not.toBeNull();
  });

  it("ignores a no-op toggle", () => {
    const { ctx, engine } = harness();
    engine.unlock();
    const before = ctx.gains[0]?.gain.events.length;
    engine.setMuted(false);
    expect(ctx.gains[0]?.gain.events.length).toBe(before);
  });
});

describe("determinism", () => {
  it("two engines on the same seed hear the identical performance", () => {
    const play = (seed: number): number[] => {
      const { ctx, engine } = harness({ seed });
      engine.unlock();
      const freqs: number[] = [];
      for (const slot of ["care.feed", "care.play", "egg.hatch", "care.feed"]) {
        const plan = engine.play(slot);
        for (const voice of plan?.voices ?? []) {
          if (voice.kind === "tone") freqs.push(voice.freq);
        }
        ctx.advance(2);
      }
      return freqs;
    };
    expect(play(1234)).toEqual(play(1234));
    expect(play(1234)).not.toEqual(play(9876));
  });

  it("wobbles the same cue between plays — repeated blips are never robotic", () => {
    const { ctx, engine } = harness();
    engine.unlock();
    const freqs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const plan = engine.play("pip.tap");
      const voice = plan?.voices[0];
      if (voice?.kind === "tone") freqs.push(voice.freq);
      ctx.advance(1);
    }
    expect(freqs).toHaveLength(5);
    expect(new Set(freqs).size).toBe(5);
    // …but always within the authored wobble, never a wrong note.
    const spread = Math.max(...freqs) / Math.min(...freqs);
    expect(spread).toBeLessThan(2 ** (1 / 6)); // < two semitones
  });
});

describe("dispose", () => {
  it("closes the context and goes quiet", async () => {
    const { ctx, engine } = harness();
    engine.unlock();
    engine.dispose();
    await Promise.resolve();
    expect(ctx.closeCalls).toBe(1);
    expect(engine.isReady()).toBe(false);
    expect(engine.play("care.feed")).toBeNull();
    expect(engine.activeVoices()).toBe(0);
  });
});
