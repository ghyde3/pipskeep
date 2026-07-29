/**
 * The mechanical half: planned voices → real Web Audio nodes.
 *
 * Per tone the graph is
 *
 *   osc ─┐
 *        ├─▶ [lowpass] ─▶ gain(ADSR) ─▶ destination
 *   osc ─┘   (optional)
 *
 * with the second oscillator present only for detuned "chime" pairs, and
 * an optional LFO ─▶ lfoGain ─▶ osc.detune for vibrato. Noise bursts swap
 * the oscillators for a buffer source reading the ONE shared noise buffer
 * (generating a fresh buffer per burst would allocate a megabyte an hour
 * for no audible gain).
 *
 * Every node is created, scheduled, and forgotten. Source nodes are
 * `stop()`ed at the end of their envelope, which is what lets the browser
 * release the whole little subgraph — there is nothing to dispose.
 *
 * No DOM, no `Date.now()`, no `Math.random()`: the noise buffer is filled
 * from an injected `core/rng` stream, and all times arrive as absolute
 * audio-clock seconds inside the plan.
 */

import type { RngStream } from "../../core/rng";
import type { CuePlan, PlannedNoise, PlannedTone } from "./plan";
import type {
  AudioBufferLike,
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
} from "./types";

/** Length of the shared white-noise buffer, seconds. Longer than the
 * longest noise burst in the palette, so no burst ever runs off the end. */
export const NOISE_BUFFER_SECONDS = 1.5;

/** Peak amplitude of the generated noise — a little headroom so the
 * per-voice gains are the only thing shaping level. */
const NOISE_AMPLITUDE = 0.85;

/** Extra time a source stays alive past its envelope, seconds. Covers
 * float rounding on the release ramp; without it a voice can click. */
const STOP_PAD = 0.02;

/** Fill a one-channel buffer with deterministic white noise. */
export function createNoiseBuffer(
  ctx: AudioContextLike,
  rng: RngStream,
  seconds: number = NOISE_BUFFER_SECONDS,
): AudioBufferLike {
  const frames = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (rng.next() * 2 - 1) * NOISE_AMPLITUDE;
  }
  return buffer;
}

/** Where a cue's voices are wired and what they read from. */
export interface ScheduleTarget {
  readonly ctx: AudioContextLike;
  /** Usually the engine's master gain, never the raw destination. */
  readonly destination: AudioNodeLike;
  readonly noiseBuffer: AudioBufferLike;
}

/**
 * ADSR onto a gain param.
 *
 *   0 ──attack──▶ peak ──decay──▶ peak×sustain ──hold──▶ ──release──▶ 0
 *
 * Linear ramps throughout: `exponentialRampToValueAtTime` cannot reach 0
 * (it throws on a zero target), and the audible difference on voices this
 * short is nil.
 */
export function applyAdsr(
  param: AudioParamLike,
  start: number,
  peak: number,
  env: {
    attack: number;
    decay: number;
    sustain: number;
    hold: number;
    release: number;
  },
): void {
  const attackEnd = start + env.attack;
  const decayEnd = attackEnd + env.decay;
  const holdEnd = decayEnd + env.hold;
  const end = holdEnd + env.release;
  const sustained = peak * env.sustain;
  param.setValueAtTime(0, start);
  param.linearRampToValueAtTime(peak, attackEnd);
  param.linearRampToValueAtTime(sustained, decayEnd);
  if (env.hold > 0) param.setValueAtTime(sustained, holdEnd);
  param.linearRampToValueAtTime(0, end);
}

/** Attack–hold–release, for noise bursts (no sustain stage). */
export function applyAhr(
  param: AudioParamLike,
  start: number,
  peak: number,
  env: { attack: number; hold: number; release: number },
): void {
  const attackEnd = start + env.attack;
  const holdEnd = attackEnd + env.hold;
  param.setValueAtTime(0, start);
  param.linearRampToValueAtTime(peak, attackEnd);
  if (env.hold > 0) param.setValueAtTime(peak, holdEnd);
  param.linearRampToValueAtTime(0, holdEnd + env.release);
}

function scheduleTone(target: ScheduleTarget, voice: PlannedTone): void {
  const { ctx } = target;
  const gain = ctx.createGain();
  applyAdsr(gain.gain, voice.start, voice.peak, voice);

  let head: AudioNodeLike = gain;
  if (voice.lowpass !== undefined) {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(voice.lowpass, voice.start);
    filter.Q.setValueAtTime(voice.q ?? 0.7, voice.start);
    filter.connect(gain);
    head = filter;
  }
  gain.connect(target.destination);

  // A detuned pair shares the peak so a chime is not twice as loud as a
  // single tone at the same authored gain.
  const pair = voice.detune !== 0;
  const offsets = pair ? [-voice.detune / 2, voice.detune / 2] : [0];
  const stopAt = voice.end + STOP_PAD;
  for (const cents of offsets) {
    const osc = ctx.createOscillator();
    osc.type = voice.wave;
    osc.frequency.setValueAtTime(voice.freq, voice.start);
    if (voice.glideTo !== voice.freq) {
      // Exponential is the musically correct glide shape (pitch is
      // logarithmic); both endpoints are non-zero frequencies, so it is
      // always legal here.
      osc.frequency.exponentialRampToValueAtTime(voice.glideTo, voice.end);
    }
    if (cents !== 0) osc.detune.setValueAtTime(cents, voice.start);
    if (pair) {
      const trim = ctx.createGain();
      trim.gain.setValueAtTime(0.5, voice.start);
      osc.connect(trim);
      trim.connect(head);
    } else {
      osc.connect(head);
    }
    if (voice.vibrato !== undefined) {
      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.setValueAtTime(voice.vibrato.rateHz, voice.start);
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(voice.vibrato.cents, voice.start);
      lfo.connect(depth);
      depth.connect(osc.detune);
      lfo.start(voice.start);
      lfo.stop(stopAt);
    }
    osc.start(voice.start);
    osc.stop(stopAt);
  }
}

function scheduleNoise(target: ScheduleTarget, voice: PlannedNoise): void {
  const { ctx } = target;
  const source = ctx.createBufferSource();
  source.buffer = target.noiseBuffer;
  source.playbackRate.setValueAtTime(voice.rate, voice.start);

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(voice.lowpass, voice.start);
  if (voice.lowpassTo !== voice.lowpass) {
    filter.frequency.exponentialRampToValueAtTime(voice.lowpassTo, voice.end);
  }
  filter.Q.setValueAtTime(voice.q, voice.start);

  const gain = ctx.createGain();
  applyAhr(gain.gain, voice.start, voice.peak, voice);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(target.destination);

  // Deterministic per-voice seek: two bursts in the same cue read
  // different slices of the shared buffer, so they do not phase-lock into
  // one louder burst. Derived from the (already jittered) rate — pure.
  const offset = ((voice.rate * 13.37) % 1) * (NOISE_BUFFER_SECONDS - 0.8);
  source.start(voice.start, Math.max(0, offset));
  source.stop(voice.end + STOP_PAD);
}

/** Realise one planned voice as nodes. */
export function scheduleVoice(
  target: ScheduleTarget,
  voice: CuePlan["voices"][number],
): void {
  if (voice.kind === "tone") scheduleTone(target, voice);
  else scheduleNoise(target, voice);
}

/** Realise a whole cue. */
export function schedulePlan(target: ScheduleTarget, plan: CuePlan): void {
  for (const voice of plan.voices) scheduleVoice(target, voice);
}
