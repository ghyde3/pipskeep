/**
 * app/audio/ — the procedural sound engine (Round 2A scope change: sound
 * is REAL now, synthesized in code, still zero new dependencies).
 *
 * Layering, outermost last:
 *
 *   notes.ts     the pentatonic grid every pitch sits on          (pure)
 *   plan.ts      cue specs + the pure spec → timed-voices planner (pure)
 *   palette.ts   the authored sound design, one cue per slot id   (pure)
 *   budget.ts    cooldowns + the voice cap                        (pure)
 *   schedule.ts  planned voices → real Web Audio nodes    (needs a ctx)
 *   engine.ts    master chain, mute, autoplay unlock       (needs a ctx)
 *
 * Everything above `schedule.ts` is testable with no AudioContext at all;
 * `schedule.ts` and `engine.ts` take an injected context factory, and
 * `stubContext.ts` provides the recording double the tests use.
 *
 * The seam the game calls — `sound(slotId)` — lives one level up in
 * ../sound.ts and is the only thing render/ and ui/ ever import.
 */

export { degreeHz, degreeSemitones, detuneHz, PENTATONIC_SEMITONES, ROOT_HZ } from "./notes";
export { DEFAULT_JITTER_CENTS, noteCost, planCue } from "./plan";
export type {
  CuePlan,
  CueSpec,
  NoiseSpec,
  NoteSpec,
  PlannedNoise,
  PlannedTone,
  PlannedVoice,
  ToneSpec,
  VibratoSpec,
} from "./plan";
export { cueFor, DEFAULT_CUE, SOUND_PALETTE } from "./palette";
export { createVoiceBudget, DEFAULT_MAX_VOICES } from "./budget";
export type { VoiceBudget } from "./budget";
export {
  applyAdsr,
  applyAhr,
  createNoiseBuffer,
  NOISE_BUFFER_SECONDS,
  schedulePlan,
  scheduleVoice,
} from "./schedule";
export type { ScheduleTarget } from "./schedule";
export {
  createAudioEngine,
  LIMITER,
  MASTER_GAIN,
  MUTE_RAMP,
  SCHEDULE_LEAD,
  WARMTH_HZ,
} from "./engine";
export type { AudioEngine, AudioEngineOptions } from "./engine";
export type {
  AudioContextFactory,
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  OscWave,
} from "./types";
