/**
 * Chaotic dialogue pool (spec §3, §4.2). WRITERS: edit the arrays below —
 * six contexts, aim for 8+ short, opinionated, occasionally weird lines
 * each. No logic lives here.
 *
 * Voice: gremlin. Answers questions nobody asked, takes credit for the
 * weather, helps aggressively wrong. Unhinged confidence, zero malice.
 */

import type { DialoguePool } from "./index";

export const chaotic: DialoguePool = {
  beaming: [
    "EVERYTHING IS WONDERFUL AND I MUST YELL!",
    "I licked the Keep. It's mine now.",
    "The sun came out because I threatened it. You're welcome.",
    "Today's forecast: ME.",
    "Fun fact nobody asked for: I cannot be stopped.",
    "My plan worked! There was no plan. Even better.",
    "That breeze? Mine. I made it. Say thank you.",
    "I could fight a mountain right now and the mountain knows.",
    "Best day ever. Also I hid something. Unrelated.",
    "I fixed your garden. Everything is upside down now.",
    "Ask me anything. The answer is YES.",
    "Committing acts of joy at large. Catch me if you can.",
  ],
  content: [
    "Plotting something. It's nothing. It's something.",
    "Heh.",
    "Seven is the best number. This is not a debate.",
    "All quiet. Suspiciously quiet. I'll allow it.",
    "I put a pebble somewhere important. For later.",
    "You didn't ask, but eels are just angry ribbons.",
    "The clouds asked permission to move. I said fine.",
    "I know something the moss doesn't. Feels great.",
    "Do not perceive me. Okay, perceive me a little.",
    "Walked to where the sky ends. Found a corner. Hm.",
    "Between schemes at the moment. Taking a breather.",
  ],
  grumpy: [
    "I'm going to knock something over. Watch.",
    "Chaos requires fuel. I have none.",
    "The wind ignored me today. UNACCEPTABLE.",
    "Everything is slightly to the left of fine.",
    "I bit a rock. The rock won. Whatever.",
    "The grudge list is full. Take a number.",
    "Somebody nudged the sun. Wasn't me. Rude.",
    "Gremlin operating at forty percent power.",
    "This mood is load-bearing. Don't touch it.",
    "I demand a snack and an apology, in that order.",
    "Even my non sequiturs are tired today. Badgers. See?",
  ],
  miserable: [
    "Too sad to scheme. This is serious.",
    "The gremlin energy has left my body.",
    "I made the rain. I regret the rain.",
    "Flopped over. Legally part of the floor now.",
    "My chaos has a flat tire.",
    "Tell the pebbles I tried.",
    "I'd cause problems, but the problems must come here.",
    "Sighing at maximum volume, minimum quality.",
    "Even the mud looks smug about it.",
    "Today is canceled. By me. Out of sadness.",
    "Being this dramatic takes energy I don't have.",
    "Even the weather feels rehearsed lately.",
  ],
  sulking: [
    "I un-alphabetized your berries. You deserve it.",
    "Sulking, but make it dramatic.",
    "I wrote your name on a leaf, then sat on the leaf.",
    "Fine. FINE. This rock is my best friend now.",
    "I planned a heist for two. Guess who never showed.",
    "Saved you the best bug. It left. Typical.",
    "Not mad. Recalibrating my loyalty. Loudly.",
    "I told the wind about you. The wind gasped.",
    "My tantrum has a sequel and you're in it.",
    "I hid your favorite thing. Attention gets it back.",
    "The puddle agrees with me. The puddle gets it.",
  ],
  refusal: [
    "No. Unless...? No.",
    "The dice said no. I am the dice.",
    "Counteroffer: absolutely not, but with jazz hands.",
    "My schedule says 'gremlin stuff.' Booked solid.",
    "Consulted my gut. My gut is a menace. It's a no.",
    "Tempting. Rejected. Tempting again. Still rejected.",
    "That's a problem for a future, shinier me.",
    "Denied by prophecy. Don't ask who wrote it.",
    "I would, but the moon and I have an arrangement.",
    "Ask the other me. He is also unavailable.",
    "Nope, but I admire the confidence. Keep that.",
  ],
};
