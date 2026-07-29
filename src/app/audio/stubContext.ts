/**
 * A recording stub AudioContext — the reason the whole synthesis layer is
 * unit-testable in the repo's `environment: "node"` Vitest run.
 *
 * It implements the `AudioContextLike` surface (./types.ts) and remembers
 * everything: which nodes were created, every automation event on every
 * AudioParam (value + time), every connection, and every start/stop. A
 * test can therefore assert "the hatch fanfare scheduled four sine pairs
 * rising through the pentatonic, and the last one rings for 1.1s" without
 * a browser anywhere in sight.
 *
 * `currentTime` is manual (`advance(seconds)`), so cooldown and voice-cap
 * behaviour is driven deterministically rather than by wall-clock luck.
 *
 * TEST DOUBLE — nothing in the production graph imports this file, so it
 * never reaches the bundle.
 */

import type {
  AudioBufferLike,
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  BiquadLike,
  BufferSourceLike,
  CompressorLike,
  GainLike,
  OscillatorLike,
} from "./types";

export interface ParamEvent {
  readonly kind: "set" | "linear" | "exponential";
  readonly value: number;
  readonly time: number;
}

export class StubParam implements AudioParamLike {
  value: number;
  readonly events: ParamEvent[] = [];

  constructor(initial = 0) {
    this.value = initial;
  }

  setValueAtTime(value: number, startTime: number): void {
    this.value = value;
    this.events.push({ kind: "set", value, time: startTime });
  }

  linearRampToValueAtTime(value: number, endTime: number): void {
    this.value = value;
    this.events.push({ kind: "linear", value, time: endTime });
  }

  exponentialRampToValueAtTime(value: number, endTime: number): void {
    this.value = value;
    this.events.push({ kind: "exponential", value, time: endTime });
  }

  /** Peak value this param was ever ramped/set to. */
  peak(): number {
    return this.events.reduce((max, e) => Math.max(max, e.value), 0);
  }
}

export class StubNode implements AudioNodeLike {
  readonly outputs: (AudioNodeLike | AudioParamLike)[] = [];
  disconnected = false;

  constructor(readonly nodeType: string) {}

  connect(destination: AudioNodeLike | AudioParamLike): AudioNodeLike {
    this.outputs.push(destination);
    return this;
  }

  disconnect(): void {
    this.disconnected = true;
  }
}

export class StubOscillator extends StubNode implements OscillatorLike {
  type = "sine";
  readonly frequency = new StubParam(440);
  readonly detune = new StubParam(0);
  startedAt: number | null = null;
  stoppedAt: number | null = null;

  constructor() {
    super("oscillator");
  }

  start(when: number): void {
    this.startedAt = when;
  }

  stop(when: number): void {
    this.stoppedAt = when;
  }
}

export class StubGain extends StubNode implements GainLike {
  readonly gain = new StubParam(1);

  constructor() {
    super("gain");
  }
}

export class StubBiquad extends StubNode implements BiquadLike {
  type = "lowpass";
  readonly frequency = new StubParam(350);
  readonly Q = new StubParam(1);

  constructor() {
    super("biquad");
  }
}

export class StubBufferSource extends StubNode implements BufferSourceLike {
  buffer: AudioBufferLike | null = null;
  readonly playbackRate = new StubParam(1);
  startedAt: number | null = null;
  startOffset: number | null = null;
  stoppedAt: number | null = null;

  constructor() {
    super("bufferSource");
  }

  start(when: number, offset?: number): void {
    this.startedAt = when;
    this.startOffset = offset ?? 0;
  }

  stop(when: number): void {
    this.stoppedAt = when;
  }
}

export class StubCompressor extends StubNode implements CompressorLike {
  readonly threshold = new StubParam(-24);
  readonly knee = new StubParam(30);
  readonly ratio = new StubParam(12);
  readonly attack = new StubParam(0.003);
  readonly release = new StubParam(0.25);

  constructor() {
    super("compressor");
  }
}

export class StubBuffer implements AudioBufferLike {
  private readonly data: Float32Array;

  constructor(
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.data = new Float32Array(length);
  }

  getChannelData(): Float32Array {
    return this.data;
  }
}

export interface StubAudioContext extends AudioContextLike {
  readonly oscillators: StubOscillator[];
  readonly gains: StubGain[];
  readonly filters: StubBiquad[];
  readonly sources: StubBufferSource[];
  readonly compressors: StubCompressor[];
  readonly buffers: StubBuffer[];
  readonly resumeCalls: number;
  readonly closeCalls: number;
  /** Move the audio clock forward (seconds). */
  advance(seconds: number): void;
  /** Pretend the browser granted the resume (state → "running"). */
  setState(state: string): void;
  /** Forget every recorded node — handy between assertions. */
  clearNodes(): void;
}

export interface StubContextOptions {
  readonly sampleRate?: number;
  /** Contexts start suspended, exactly like the real thing. */
  readonly state?: string;
  /** Small buffers keep noise-generation tests fast. */
  readonly startTime?: number;
}

export function createStubAudioContext(
  options: StubContextOptions = {},
): StubAudioContext {
  const oscillators: StubOscillator[] = [];
  const gains: StubGain[] = [];
  const filters: StubBiquad[] = [];
  const sources: StubBufferSource[] = [];
  const compressors: StubCompressor[] = [];
  const buffers: StubBuffer[] = [];
  let time = options.startTime ?? 0;
  let state = options.state ?? "suspended";
  let resumeCalls = 0;
  let closeCalls = 0;
  const destination = new StubNode("destination");

  const ctx: StubAudioContext = {
    get currentTime(): number {
      return time;
    },
    sampleRate: options.sampleRate ?? 48_000,
    destination,
    get state(): string {
      return state;
    },
    get resumeCalls(): number {
      return resumeCalls;
    },
    get closeCalls(): number {
      return closeCalls;
    },
    oscillators,
    gains,
    filters,
    sources,
    compressors,
    buffers,
    createOscillator(): OscillatorLike {
      const osc = new StubOscillator();
      oscillators.push(osc);
      return osc;
    },
    createGain(): GainLike {
      const gain = new StubGain();
      gains.push(gain);
      return gain;
    },
    createBiquadFilter(): BiquadLike {
      const filter = new StubBiquad();
      filters.push(filter);
      return filter;
    },
    createBufferSource(): BufferSourceLike {
      const source = new StubBufferSource();
      sources.push(source);
      return source;
    },
    createBuffer(_channels: number, length: number, rate: number): AudioBufferLike {
      const buffer = new StubBuffer(length, rate);
      buffers.push(buffer);
      return buffer;
    },
    createDynamicsCompressor(): CompressorLike {
      const comp = new StubCompressor();
      compressors.push(comp);
      return comp;
    },
    async resume(): Promise<void> {
      resumeCalls++;
      state = "running";
    },
    async close(): Promise<void> {
      closeCalls++;
      state = "closed";
    },
    advance(seconds: number): void {
      time += seconds;
    },
    setState(next: string): void {
      state = next;
    },
    clearNodes(): void {
      oscillators.length = 0;
      gains.length = 0;
      filters.length = 0;
      sources.length = 0;
    },
  };
  return ctx;
}
