/**
 * The WebAudio seam — structural interfaces covering EXACTLY the slice of
 * the Web Audio API the synth uses, and nothing else.
 *
 * Why not just use the DOM lib types? Because the whole synthesis layer
 * has to be unit-testable in the repo's `environment: "node"` Vitest run,
 * where `AudioContext` does not exist. Every audio entry point takes an
 * `AudioContextFactory`; production passes `() => new AudioContext()`
 * (a real AudioContext satisfies these interfaces structurally), tests
 * pass `createStubAudioContext()` from ./stubContext and then assert on
 * the graph that was scheduled — oscillator types, frequencies, envelope
 * breakpoints, connections.
 *
 * Nothing in this directory touches the DOM, `Date.now()`, or
 * `Math.random()`: time comes from `ctx.currentTime` (the audio clock is
 * the only correct timebase for sample-accurate scheduling) and all
 * randomness comes from a `core/rng` stream injected by the caller.
 */

/** An `AudioParam` — the automation surface the envelopes drive. */
export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, startTime: number): unknown;
  linearRampToValueAtTime(value: number, endTime: number): unknown;
  exponentialRampToValueAtTime(value: number, endTime: number): unknown;
}

/** Anything that can be a `connect()` target. The union in `connect`
 * mirrors the real API's two overloads: node→node for audio, node→param
 * for modulation (the vibrato LFO drives an oscillator's `detune`). */
export interface AudioNodeLike {
  connect(destination: AudioNodeLike | AudioParamLike): unknown;
  disconnect(): unknown;
}

export type OscWave = "sine" | "triangle" | "square" | "sawtooth";

export interface OscillatorLike extends AudioNodeLike {
  type: string;
  readonly frequency: AudioParamLike;
  readonly detune: AudioParamLike;
  start(when: number): unknown;
  stop(when: number): unknown;
}

export interface GainLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}

export interface BiquadLike extends AudioNodeLike {
  type: string;
  readonly frequency: AudioParamLike;
  readonly Q: AudioParamLike;
}

export interface AudioBufferLike {
  readonly length: number;
  readonly sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

export interface BufferSourceLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  readonly playbackRate: AudioParamLike;
  /** `offset` seeks into the shared noise buffer so two bursts fired at
   * once never play the identical slice of noise. */
  start(when: number, offset?: number): unknown;
  stop(when: number): unknown;
}

/** The master limiter (a DynamicsCompressor squashed into limiter duty). */
export interface CompressorLike extends AudioNodeLike {
  readonly threshold: AudioParamLike;
  readonly knee: AudioParamLike;
  readonly ratio: AudioParamLike;
  readonly attack: AudioParamLike;
  readonly release: AudioParamLike;
}

export interface AudioContextLike {
  /** The audio clock, in SECONDS. Everything schedules against this. */
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly destination: AudioNodeLike;
  /** "suspended" until a user gesture resumes it (autoplay policy). */
  readonly state: string;
  createOscillator(): OscillatorLike;
  createGain(): GainLike;
  createBiquadFilter(): BiquadLike;
  createBufferSource(): BufferSourceLike;
  createBuffer(
    numberOfChannels: number,
    length: number,
    sampleRate: number,
  ): AudioBufferLike;
  createDynamicsCompressor(): CompressorLike;
  resume(): Promise<void>;
  close(): Promise<void>;
}

/** Lazily builds the context — called on the FIRST user gesture, never
 * at module load (browsers block/penalise contexts created before one). */
export type AudioContextFactory = () => AudioContextLike;
