/**
 * Scheduling: planned voices → real nodes. Runs against the recording
 * stub context (./stubContext.ts), so every assertion here is about the
 * actual Web Audio graph the browser would be handed — oscillator types,
 * frequencies, envelope breakpoints, connections — with no browser.
 */

import { describe, expect, it } from "vitest";
import { createRng } from "../../core/rng";
import { planCue } from "./plan";
import type { CueSpec, PlannedNoise, PlannedTone } from "./plan";
import {
  applyAdsr,
  applyAhr,
  createNoiseBuffer,
  NOISE_BUFFER_SECONDS,
  schedulePlan,
  scheduleVoice,
} from "./schedule";
import type { ScheduleTarget } from "./schedule";
import { createStubAudioContext, StubGain, StubParam } from "./stubContext";
import type { StubAudioContext } from "./stubContext";

function target(ctx: StubAudioContext): ScheduleTarget {
  const destination = ctx.createGain();
  const noiseBuffer = ctx.createBuffer(1, 128, ctx.sampleRate);
  ctx.clearNodes();
  return { ctx, destination, noiseBuffer };
}

const tone = (over: Partial<PlannedTone> = {}): PlannedTone => {
  const base: PlannedTone = {
    kind: "tone",
    wave: "triangle",
    start: 1,
    end: 1.4,
    freq: 440,
    glideTo: 440,
    detune: 0,
    attack: 0.01,
    decay: 0.09,
    sustain: 0.5,
    hold: 0.1,
    release: 0.2,
    peak: 0.2,
    ...over,
  };
  // A voice only glides when glideTo differs — keep them locked together
  // unless a test deliberately sets one.
  return over.glideTo === undefined ? { ...base, glideTo: base.freq } : base;
};

const noiseVoice = (over: Partial<PlannedNoise> = {}): PlannedNoise => ({
  kind: "noise",
  start: 1,
  end: 1.2,
  attack: 0.02,
  hold: 0.03,
  release: 0.15,
  peak: 0.06,
  lowpass: 900,
  lowpassTo: 900,
  q: 0.7,
  rate: 1,
  ...over,
});

describe("envelopes", () => {
  it("ADSR walks 0 → peak → sustain → 0 at the right instants", () => {
    const param = new StubParam();
    applyAdsr(param, 2, 0.4, {
      attack: 0.01,
      decay: 0.05,
      sustain: 0.5,
      hold: 0.1,
      release: 0.2,
    });
    expect(param.events.map((e) => [e.kind, e.value])).toEqual([
      ["set", 0],
      ["linear", 0.4],
      ["linear", 0.2],
      ["set", 0.2],
      ["linear", 0],
    ]);
    const times = param.events.map((e) => e.time);
    for (const [i, expected] of [2, 2.01, 2.06, 2.16, 2.36].entries()) {
      expect(times[i]).toBeCloseTo(expected, 9);
    }
  });

  it("skips the hold breakpoint for a purely percussive voice", () => {
    const param = new StubParam();
    applyAdsr(param, 0, 1, { attack: 0.01, decay: 0.05, sustain: 0, hold: 0, release: 0.1 });
    expect(param.events.map((e) => e.kind)).toEqual(["set", "linear", "linear", "linear"]);
  });

  it("AHR holds a flat top (noise bursts have no sustain stage)", () => {
    const param = new StubParam();
    applyAhr(param, 0, 0.5, { attack: 0.02, hold: 0.03, release: 0.15 });
    expect(param.events).toEqual([
      { kind: "set", value: 0, time: 0 },
      { kind: "linear", value: 0.5, time: 0.02 },
      { kind: "set", value: 0.5, time: 0.05 },
      { kind: "linear", value: 0, time: 0.2 },
    ]);
  });

  it("always ends at exactly zero — a voice that never closes clicks", () => {
    const param = new StubParam();
    applyAdsr(param, 0, 0.9, { attack: 0.005, decay: 0.02, sustain: 0.8, hold: 0, release: 0.3 });
    expect(param.events.at(-1)).toEqual({ kind: "linear", value: 0, time: 0.325 });
  });
});

describe("scheduleVoice — tones", () => {
  it("builds osc → gain → destination and stops the source after the tail", () => {
    const ctx = createStubAudioContext();
    const t = target(ctx);
    scheduleVoice(t, tone({ wave: "square", freq: 220 }));

    expect(ctx.oscillators).toHaveLength(1);
    const osc = ctx.oscillators[0];
    expect(osc?.type).toBe("square");
    expect(osc?.frequency.events).toEqual([{ kind: "set", value: 220, time: 1 }]);
    expect(osc?.startedAt).toBe(1);
    expect(osc?.stoppedAt).toBeGreaterThan(1.4); // outlives its envelope

    expect(ctx.gains).toHaveLength(1);
    expect(ctx.gains[0]?.outputs).toContain(t.destination);
    expect(osc?.outputs).toContain(ctx.gains[0]);
  });

  it("inserts the lowpass between oscillator and gain when asked", () => {
    const ctx = createStubAudioContext();
    const t = target(ctx);
    scheduleVoice(t, tone({ lowpass: 800, q: 1.2 }));

    expect(ctx.filters).toHaveLength(1);
    const filter = ctx.filters[0];
    expect(filter?.type).toBe("lowpass");
    expect(filter?.frequency.events[0]?.value).toBe(800);
    expect(filter?.Q.events[0]?.value).toBe(1.2);
    expect(ctx.oscillators[0]?.outputs).toContain(filter);
    expect(filter?.outputs).toContain(ctx.gains[0]);
  });

  it("writes the ADSR onto the voice's own gain", () => {
    const ctx = createStubAudioContext();
    scheduleVoice(target(ctx), tone({ peak: 0.25 }));
    const gain = ctx.gains[0] as StubGain;
    expect(gain.gain.peak()).toBeCloseTo(0.25, 9);
    expect(gain.gain.events.at(-1)?.value).toBe(0);
    expect(gain.gain.events.at(-1)?.time).toBeCloseTo(1.4, 9);
  });

  it("glides with an exponential ramp (pitch is logarithmic)", () => {
    const ctx = createStubAudioContext();
    scheduleVoice(target(ctx), tone({ freq: 400, glideTo: 200 }));
    expect(ctx.oscillators[0]?.frequency.events).toEqual([
      { kind: "set", value: 400, time: 1 },
      { kind: "exponential", value: 200, time: 1.4 },
    ]);
  });

  it("makes a detuned PAIR that splits the gain instead of doubling it", () => {
    const ctx = createStubAudioContext();
    const t = target(ctx);
    scheduleVoice(t, tone({ detune: 12 }));

    expect(ctx.oscillators).toHaveLength(2);
    expect(ctx.oscillators.map((o) => o.detune.events[0]?.value)).toEqual([-6, 6]);
    // Each half runs through its own 0.5 trim.
    const trims = ctx.gains.filter((g) => g.gain.events[0]?.value === 0.5);
    expect(trims).toHaveLength(2);
  });

  it("wires vibrato as LFO → depth → detune (a real modulation graph)", () => {
    const ctx = createStubAudioContext();
    scheduleVoice(target(ctx), tone({ vibrato: { rateHz: 13, cents: 45 } }));

    expect(ctx.oscillators).toHaveLength(2); // carrier + LFO
    const lfo = ctx.oscillators[1];
    expect(lfo?.type).toBe("sine");
    expect(lfo?.frequency.events[0]?.value).toBe(13);
    const depth = ctx.gains.find((g) => g.gain.events[0]?.value === 45);
    expect(depth).toBeDefined();
    expect(lfo?.outputs).toContain(depth);
    // The depth gain drives the carrier's detune PARAM, not another node.
    expect(depth?.outputs).toContain(ctx.oscillators[0]?.detune);
    expect(lfo?.stoppedAt).toBe(ctx.oscillators[0]?.stoppedAt);
  });
});

describe("scheduleVoice — noise", () => {
  it("reads the shared buffer through a lowpass with an AHR envelope", () => {
    const ctx = createStubAudioContext();
    const t = target(ctx);
    scheduleVoice(t, noiseVoice({ rate: 1.2 }));

    expect(ctx.sources).toHaveLength(1);
    const source = ctx.sources[0];
    expect(source?.buffer).toBe(t.noiseBuffer);
    expect(source?.playbackRate.events[0]?.value).toBe(1.2);
    expect(source?.outputs).toContain(ctx.filters[0]);
    expect(ctx.filters[0]?.outputs).toContain(ctx.gains[0]);
    expect(ctx.gains[0]?.outputs).toContain(t.destination);
    expect(ctx.gains[0]?.gain.peak()).toBeCloseTo(0.06, 9);
  });

  it("sweeps the cutoff when the burst asks for a whoosh", () => {
    const ctx = createStubAudioContext();
    scheduleVoice(target(ctx), noiseVoice({ lowpass: 300, lowpassTo: 4000 }));
    expect(ctx.filters[0]?.frequency.events).toEqual([
      { kind: "set", value: 300, time: 1 },
      { kind: "exponential", value: 4000, time: 1.2 },
    ]);
  });

  it("seeks into the buffer so two bursts never play the same slice", () => {
    const ctx = createStubAudioContext();
    const t = target(ctx);
    scheduleVoice(t, noiseVoice({ rate: 1 }));
    scheduleVoice(t, noiseVoice({ rate: 1.37 }));
    const [first, second] = ctx.sources;
    expect(first?.startOffset).not.toBe(second?.startOffset);
    for (const source of ctx.sources) {
      expect(source?.startOffset).toBeGreaterThanOrEqual(0);
      expect(source?.startOffset).toBeLessThan(NOISE_BUFFER_SECONDS);
    }
  });
});

describe("createNoiseBuffer", () => {
  it("fills a mono buffer from the injected rng — no Math.random anywhere", () => {
    const ctx = createStubAudioContext({ sampleRate: 1000 });
    const buffer = createNoiseBuffer(ctx, createRng(7).stream("audio-jitter"), 0.1);
    expect(buffer.length).toBe(100);
    const data = buffer.getChannelData(0);
    expect(data.some((v) => v !== 0)).toBe(true);
    for (const sample of data) {
      expect(Math.abs(sample)).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministic for a given seed", () => {
    const make = (): Float32Array => {
      const ctx = createStubAudioContext({ sampleRate: 1000 });
      return createNoiseBuffer(ctx, createRng(11).stream("audio-jitter"), 0.05).getChannelData(0);
    };
    expect(Array.from(make())).toEqual(Array.from(make()));
  });
});

describe("schedulePlan", () => {
  it("realises every voice of a real palette cue", () => {
    const ctx = createStubAudioContext();
    const t = target(ctx);
    const spec: CueSpec = {
      cooldownMs: 100,
      notes: [
        { kind: "noise", at: 0, attack: 0.004, hold: 0.008, release: 0.05, gain: 0.05, lowpass: 900 },
        { kind: "tone", wave: "triangle", degree: 2, at: 0, attack: 0.005, decay: 0.04, sustain: 0.3, hold: 0, release: 0.1, gain: 0.24, lowpass: 1700 },
        { kind: "tone", wave: "triangle", degree: 0, at: 0.08, attack: 0.005, decay: 0.04, sustain: 0.3, hold: 0, release: 0.12, gain: 0.2, lowpass: 1450 },
      ],
    };
    schedulePlan(t, planCue("care.feed", spec, 5, 0.5));
    expect(ctx.oscillators).toHaveLength(2);
    expect(ctx.sources).toHaveLength(1);
    // Two pops, the second later than the first — a munch, not a chord.
    expect(ctx.oscillators[1]?.startedAt).toBeGreaterThan(
      ctx.oscillators[0]?.startedAt as number,
    );
  });
});
