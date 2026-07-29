/**
 * The audio engine: one lazily-built master chain, plus the policy that
 * decides whether a given `sound(slotId)` actually gets to make a noise.
 *
 * Master chain (built once, on the first user gesture):
 *
 *   cues ─▶ masterGain ─▶ lowpass(warmth) ─▶ limiter ─▶ destination
 *
 * `masterGain` is also the mute control — ramped, never switched, because
 * a hard gain step on a ringing chime is an audible click. The warmth
 * lowpass shaves the top off everything so the palette sits together
 * instead of sounding like separate effects. The limiter is a
 * DynamicsCompressor squashed into limiter duty: with a dozen voices
 * overlapping, peaks WILL sum past 1.0, and clipping is the least cozy
 * sound a computer can make.
 *
 * Autoplay policy: browsers refuse to start an AudioContext outside a
 * user gesture, and a context created too early sits suspended while
 * scheduled events pile up behind it — they then all fire at once on
 * resume. So the context is created inside `unlock()` (wired to the first
 * pointer/key event) and `play()` is a no-op until then. Nothing is
 * queued while locked; the sounds for events the player never saw are
 * simply not owed to anyone.
 *
 * Purity: no DOM, no `Date.now()`, no `Math.random()`. The audio clock is
 * `ctx.currentTime`; the pitch jitter and the noise buffer come from an
 * injected `core/rng` stream.
 */

import type { RngStream } from "../../core/rng";
import { createVoiceBudget, DEFAULT_MAX_VOICES } from "./budget";
import type { VoiceBudget } from "./budget";
import { DEFAULT_CUE, SOUND_PALETTE } from "./palette";
import { planCue } from "./plan";
import type { CuePlan, CueSpec } from "./plan";
import { createNoiseBuffer, schedulePlan } from "./schedule";
import type { ScheduleTarget } from "./schedule";
import type { AudioBufferLike, AudioContextFactory, AudioContextLike, GainLike } from "./types";

/** Master level. Every authored gain sits under this, so the palette can
 * be re-balanced in one number without touching the sound design. */
export const MASTER_GAIN = 0.5;

/** Warmth lowpass — takes the glassy top off the whole mix. */
export const WARMTH_HZ = 9_000;

/** Limiter shape: fast, high ratio, low knee. */
export const LIMITER = {
  threshold: -8,
  knee: 3,
  ratio: 14,
  attack: 0.003,
  release: 0.14,
} as const;

/** Schedule this far ahead of `currentTime`, seconds. Ramps must never
 * start in the past — a ramp scheduled behind the clock jumps instead of
 * ramping, which clicks. */
export const SCHEDULE_LEAD = 0.012;

/** Mute/unmute fade, seconds. */
export const MUTE_RAMP = 0.07;

export interface AudioEngineOptions {
  /** Called ONCE, inside `unlock()`. Production: `() => new AudioContext()`. */
  readonly createContext: AudioContextFactory;
  /** Pitch jitter + noise generation. A presentation-only stream — see
   * the note in ../sound.ts about why it never touches GameState. */
  readonly rng: RngStream;
  readonly palette?: Readonly<Record<string, CueSpec>>;
  readonly masterGain?: number;
  readonly maxVoices?: number;
  /** Initial mute state (restored from the player's preference). */
  readonly muted?: boolean;
  /** Audio never breaks the game: failures land here, not in a throw. */
  readonly onError?: (error: unknown) => void;
}

export interface AudioEngine {
  /** Build/resume the context. MUST be called from a user gesture. */
  unlock(): void;
  /** True once a context exists and cues can be scheduled. */
  isReady(): boolean;
  /**
   * Play a slot. Returns the plan that was scheduled, or null when the
   * cue was refused (locked, muted, on cooldown, or over the voice cap)
   * — which is exactly what the tests assert on.
   */
  play(slot: string): CuePlan | null;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  /** Voices still ringing right now (0 before unlock). */
  activeVoices(): number;
  dispose(): void;
}

interface Chain {
  readonly ctx: AudioContextLike;
  readonly master: GainLike;
  readonly noiseBuffer: AudioBufferLike;
  readonly target: ScheduleTarget;
}

export function createAudioEngine(options: AudioEngineOptions): AudioEngine {
  const palette = options.palette ?? SOUND_PALETTE;
  const masterLevel = options.masterGain ?? MASTER_GAIN;
  const budget: VoiceBudget = createVoiceBudget(
    options.maxVoices ?? DEFAULT_MAX_VOICES,
  );
  const onError =
    options.onError ??
    ((error: unknown): void => {
      console.warn("PipsKeep sound disabled:", error);
    });

  let muted = options.muted ?? false;
  let chain: Chain | null = null;
  /** Latched on the first failure: a broken context is never retried in
   * a loop, and the game plays on in silence. */
  let broken = false;

  function build(): Chain | null {
    if (broken) return null;
    try {
      const ctx = options.createContext();
      const master = ctx.createGain();
      master.gain.setValueAtTime(muted ? 0 : masterLevel, ctx.currentTime);

      const warmth = ctx.createBiquadFilter();
      warmth.type = "lowpass";
      warmth.frequency.setValueAtTime(WARMTH_HZ, ctx.currentTime);
      warmth.Q.setValueAtTime(0.7, ctx.currentTime);

      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.setValueAtTime(LIMITER.threshold, ctx.currentTime);
      limiter.knee.setValueAtTime(LIMITER.knee, ctx.currentTime);
      limiter.ratio.setValueAtTime(LIMITER.ratio, ctx.currentTime);
      limiter.attack.setValueAtTime(LIMITER.attack, ctx.currentTime);
      limiter.release.setValueAtTime(LIMITER.release, ctx.currentTime);

      master.connect(warmth);
      warmth.connect(limiter);
      limiter.connect(ctx.destination);

      const noiseBuffer = createNoiseBuffer(ctx, options.rng);
      return {
        ctx,
        master,
        noiseBuffer,
        target: { ctx, destination: master, noiseBuffer },
      };
    } catch (error) {
      broken = true;
      onError(error);
      return null;
    }
  }

  function resumeIfNeeded(ctx: AudioContextLike): void {
    if (ctx.state === "running") return;
    try {
      void ctx.resume().catch(() => undefined);
    } catch (error) {
      onError(error);
    }
  }

  return {
    unlock(): void {
      if (broken) return;
      // A closed context (tab backgrounded on iOS, or an explicit
      // dispose) is rebuilt rather than resumed.
      if (chain !== null && chain.ctx.state === "closed") {
        chain = null;
        budget.reset();
      }
      chain ??= build();
      if (chain !== null) resumeIfNeeded(chain.ctx);
    },

    isReady(): boolean {
      return chain !== null && chain.ctx.state !== "closed";
    },

    play(slot: string): CuePlan | null {
      // Locked (no gesture yet) or muted: refuse BEFORE drawing from the
      // rng, so a muted session and an unmuted one hear the same jitter
      // sequence once sound comes back on.
      if (muted || chain === null || broken) return null;
      const { ctx } = chain;
      if (ctx.state === "closed") return null;
      if (ctx.state !== "running") resumeIfNeeded(ctx);

      const spec = palette[slot] ?? DEFAULT_CUE;
      const at = ctx.currentTime + SCHEDULE_LEAD;
      if (!budget.canPlay(slot, at, spec.cooldownMs / 1000)) return null;

      const plan = planCue(slot, spec, at, options.rng.next());
      if (!budget.hasRoom(at, plan.voiceCost, spec.priority ?? 1)) return null;
      budget.commit(slot, at, plan.end, plan.voiceCost);

      try {
        schedulePlan(chain.target, plan);
      } catch (error) {
        broken = true;
        onError(error);
        return null;
      }
      return plan;
    },

    setMuted(next: boolean): void {
      if (next === muted) return;
      muted = next;
      if (chain === null) return;
      const { ctx, master } = chain;
      const now = ctx.currentTime;
      // Ramp from the CURRENT value, so muting mid-chime fades that
      // chime out instead of chopping it.
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(
        muted ? 0 : masterLevel,
        now + MUTE_RAMP,
      );
    },

    isMuted(): boolean {
      return muted;
    },

    activeVoices(): number {
      if (chain === null) return 0;
      return budget.activeVoices(chain.ctx.currentTime);
    },

    dispose(): void {
      const current = chain;
      chain = null;
      budget.reset();
      if (current === null) return;
      try {
        current.master.disconnect();
        void current.ctx.close().catch(() => undefined);
      } catch (error) {
        onError(error);
      }
    },
  };
}
