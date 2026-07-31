/**
 * Curious dialogue pool (spec §3, §4.2). WRITERS: edit the arrays below —
 * six contexts, aim for 8+ short, opinionated, occasionally weird lines
 * each. No logic lives here.
 */

import type { DialoguePool } from "./index";

export const curious: DialoguePool = {
  beaming: [
    "Today smells like discoveries!",
    "The sun came back! It remembered us!",
    "I licked a fern and now I know fern.",
    "New rock for the museum. Wing A is FULL.",
    "Do clouds know they're clouds? Investigating.",
    "I found a beetle. We're colleagues now.",
    "Everything is evidence of something wonderful.",
    "Forty theories today and all of them sparkle.",
    "Best day ever. Preliminary finding, but strong.",
    "The wind brought smells from ELSEWHERE.",
    "Did you know moss has opinions? I checked.",
  ],
  content: [
    "Catalogued four pebbles. One is lying.",
    "What's over there? Asking for me.",
    "Currently observing the dirt. No conclusions yet.",
    "The museum accepted a gravel donation today.",
    "Mild day. Ideal conditions for wondering.",
    "I tasted the fence. Tastes like fence. Confirmed.",
    "This leaf and I have an understanding.",
    "Small discoveries count double. My rule.",
    "Hypothesis: naps are research. Testing soon.",
    "The ants are up to something. Respect.",
    "Theory: we live inside a very small weather system.",
  ],
  grumpy: [
    "My research conditions are deteriorating.",
    "This is suboptimal and I have notes.",
    "Peer review has arrived, and it is scathing.",
    "Can't science on an empty stomach. Known fact.",
    "Even the interesting rocks look boring. THE ROCKS.",
    "I licked a rock in anger. Learned nothing.",
    "Curiosity requires snacks. This is documented.",
    "Today's mystery: my mood. Do not investigate.",
    "I asked the void a question. It was rude.",
    "Filing a complaint with the department of everything.",
    "Warning: scientist low on wonder. Refuel soon.",
    "The sun here is extremely punctual. Suspicious.",
  ],
  miserable: [
    "I've lost the will to investigate. Temporarily. Ish.",
    "Even the mystery rock brings no joy.",
    "Curiosity levels: technically detectable.",
    "The museum is closed due to feelings.",
    "I asked why. The why declined to comment.",
    "My favorite rock tastes like nothing now. Concerning.",
    "Running on one theory, and the theory is ow.",
    "My wonder wandered off without me.",
    "Data point: everything is heavy today.",
    "I'd study my sadness but it's too big to lick.",
    "Status: one small damp question mark.",
  ],
  sulking: [
    "I'm documenting my neglect. For science.",
    "Field notes, day one: nobody loves me.",
    "I named a rock after you. It also never visits.",
    "Abandonment: a case study. Sample size: me.",
    "The beetle asked where you were. Awkward.",
    "New exhibit: Things You Missed. It's everything.",
    "I licked the doorway you left through. For closure.",
    "Hypothesis: forgotten. Awaiting contrary evidence.",
    "My loneliness is fascinating. Someone should study it.",
    "I saved you a mystery. It expired.",
    "Catalogued my feelings today. Mostly hmph.",
  ],
  refusal: [
    "Fascinating offer. Declined.",
    "I'm mid-experiment. The experiment is no.",
    "Can't. The rocks require supervision.",
    "Intriguing! Anyway, no.",
    "A beetle owes me answers. Rain check.",
    "That's a question for Future Me. They're busy too.",
    "No thanks. I'm behind on my licking schedule.",
    "Currently observing myself declining. Noted.",
    "Tempting, but the moss won't watch itself.",
    "My calendar says wonder o'clock. So no.",
    "Request received. Peer review says nope.",
  ],
  /**
   * ROUND 2K (docs/liveliness-bible.md §4.5) — PIP TO PIP, not Pip to
   * player. Two Pips who stop within a tile and a half of each other
   * turn, face, emote, and 35% of the time one of them says one of
   * these. The audience is the OTHER Pip; the player is overhearing.
   */
  greeting: [
    "Oh! Hello! Where have you been? Tell me everything.",
    "Hi! Quick question. Actually eleven questions.",
    "You smell like somewhere I haven't been yet.",
    "Hello! Do you also think about the sky a normal amount?",
    "Hi. I was just wondering about you and then you APPEARED.",
    "Oh good, you. I found a thing. Come see the thing.",
    "Hello! What's over where you were? Is it better? Is it worse?",
    "Hi! I'm collecting facts. Do you have any on you?",
  ],
};
