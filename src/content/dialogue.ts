/**
 * Dialogue registry (spec §3), keyed `personality × context`.
 * Contexts = the four moods (§4.3) + Sulking (§4.4) + Refusal (§5).
 *
 * Launch minimum is REQUIRED_LINES_PER_CONTEXT per pool (6 contexts ×
 * 5 personalities × 8 = 240 lines). Phase 2 budgets the real authoring
 * pass; these are placeholders, so validation currently WARNS (not errors)
 * on underfilled pools.
 */

import type { PersonalityId } from "./personalities";
import { PERSONALITY_IDS } from "./personalities";

export const DIALOGUE_CONTEXTS = [
  "beaming",
  "content",
  "grumpy",
  "miserable",
  "sulking",
  "refusal",
] as const;
export type DialogueContext = (typeof DIALOGUE_CONTEXTS)[number];

/** Launch minimum lines per `personality × context` pool (spec §3). */
export const REQUIRED_LINES_PER_CONTEXT = 8;

export type DialoguePools = Readonly<
  Record<PersonalityId, Readonly<Record<DialogueContext, readonly string[]>>>
>;

export const dialogue: DialoguePools = {
  lazy: {
    beaming: [
      "Peak comfort achieved. Do not perceive me.",
      "Everything is soft and nothing hurts.",
    ],
    content: ["This is... acceptable.", "Five more minutes. Forever."],
    grumpy: ["I was napping, and now I'm not. Explain.", "Hmph."],
    miserable: [
      "Even lying down feels like work now.",
      "The floor and I are one. A sad one.",
    ],
    sulking: [
      "It's fine. I'll just... be over here. Deflated.",
      "No no, don't mind me. Mind me a little.",
    ],
    refusal: ["Play? In this economy?", "Counter-offer: we both nap."],
  },
  curious: {
    beaming: [
      "Today smells like discoveries!",
      "Did you know moss has opinions? I checked.",
    ],
    content: [
      "I catalogued four new pebbles today.",
      "What's over there? Asking for me.",
    ],
    grumpy: [
      "My research conditions are deteriorating.",
      "This is suboptimal and I have notes.",
    ],
    miserable: [
      "I've lost the will to investigate.",
      "Even the mystery rock brings no joy.",
    ],
    sulking: [
      "I'm documenting my neglect. For science.",
      "Field notes, day one: nobody loves me.",
    ],
    refusal: [
      "Fascinating offer. Declined.",
      "I'm mid-experiment. The experiment is no.",
    ],
  },
  hardworking: {
    beaming: [
      "Systems nominal. Morale: excellent!",
      "A productive day in a well-run Keep.",
    ],
    content: ["Steady progress. I respect that.", "Back to it, then."],
    grumpy: [
      "Standards are slipping around here.",
      "I can't work under these conditions. I will anyway, but still.",
    ],
    miserable: [
      "Productivity: zero. Like my spirits.",
      "Even my to-do list gave up on me.",
    ],
    sulking: [
      "I have filed a formal complaint. It's a frown.",
      "Union rules say I sulk now.",
    ],
    refusal: [
      "Request denied. See attached frown.",
      "That's not on today's schedule.",
    ],
  },
  chaotic: {
    beaming: [
      "EVERYTHING IS WONDERFUL AND I MUST YELL!",
      "I licked the Keep. It's mine now.",
    ],
    content: ["Plotting something. It's nothing. It's something.", "Heh."],
    grumpy: [
      "I'm going to knock something over. Watch.",
      "Chaos requires fuel. I have none.",
    ],
    miserable: [
      "Too sad to scheme. This is serious.",
      "The gremlin energy has left my body.",
    ],
    sulking: [
      "I un-alphabetized your berries. You deserve it.",
      "Sulking, but make it dramatic.",
    ],
    refusal: ["No. Unless...? No.", "The dice said no. I am the dice."],
  },
  clingy: {
    beaming: [
      "You're here! Best day. BEST day!",
      "I saved you a seat. It's right next to me. And also me.",
    ],
    content: [
      "Just checking you're still there. Okay. Good.",
      "Stay close, alright?",
    ],
    grumpy: [
      "You were gone for nine minutes. I counted.",
      "Hold me. But, like, apologetically.",
    ],
    miserable: [
      "Did you forget me? Blink twice if no.",
      "I practiced saying hi and everything...",
    ],
    sulking: [
      "I'm not talking to you. Please talk to me.",
      "This sulk is ninety percent missing you.",
    ],
    refusal: [
      "And leave your side? Absolutely not.",
      "Only if you come too. No? Then no.",
    ],
  },
};

/**
 * Returns one warning per underfilled `personality × context` pool.
 * Deliberately warnings, not errors, until the Phase 2 authoring pass —
 * an empty repo should still boot; a silent 240-line gap should not.
 *
 * TODO(Phase 2 gate — BLOCKING): once the authoring pass lands, underfilled
 * pools are a spec §3 violation and MUST hard-fail validation. Move this
 * check into the `errors` bucket in validate.ts (console.error) before
 * logging the Phase 2 gate in PROGRESS.md. Do not let the warn downgrade
 * survive past Phase 2.
 */
export function findUnderfilledDialoguePools(
  pools: DialoguePools = dialogue,
  requiredLines: number = REQUIRED_LINES_PER_CONTEXT,
): string[] {
  const warnings: string[] = [];
  for (const personality of PERSONALITY_IDS) {
    for (const context of DIALOGUE_CONTEXTS) {
      const lines = pools[personality]?.[context];
      const count = lines?.length ?? 0;
      if (count < requiredLines) {
        warnings.push(
          `dialogue: pool ${personality}/${context} has ${count}/${requiredLines} lines (Phase 2 authoring pass pending)`,
        );
      }
    }
  }
  return warnings;
}
