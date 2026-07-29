/**
 * Clingy dialogue pool (spec §3, §4.2). WRITERS: edit the arrays below —
 * six contexts, aim for 8+ short, opinionated, occasionally weird lines
 * each. No logic lives here.
 *
 * Character: velcro heart. Counts the seconds you were gone, negotiates
 * for one more pet, dramatic about goodbyes, instantly forgiving.
 */

import type { DialoguePool } from "./index";

export const clingy: DialoguePool = {
  beaming: [
    "You're here! You're HERE. Everything is fixed.",
    "Best day. Top day. Day of days.",
    "I saved you a seat. It's next to me. All seats are.",
    "Sixty whole seconds of you. I'm rich.",
    "Quick, stand still so I can orbit you.",
    "My heart did a flip. Then six more. Then a bow.",
    "Told the wall about you. The wall agrees: incredible.",
    "Pet me again and I might levitate. Small risk. Worth it.",
    "I memorized your footsteps. These are my favorites.",
    "Stay forever? Great. Motion passes. No takebacks.",
    "Reunion number 47, and somehow the best one yet.",
  ],
  content: [
    "Just checking you're still there. Okay. Good.",
    "Stay close. Closer. Perfect. Hold that for a year.",
    "I put my snacks where I can see you from them.",
    "Proximity levels: acceptable. Barely.",
    "Not clingy. Just extremely nearby, always, on purpose.",
    "If you leave, take me. That's the whole policy.",
    "I counted your visits today. Nice number. Add one?",
    "Sitting here. Watching you exist. Ten out of ten.",
    "You may go up to three steps away. I've decided.",
    "We're having a moment. Shh. Extend the moment.",
    "One more pet, then I'll nap. Okay, two. Final offer.",
    "Sometimes my whole sky fits in your hand. Anyway. Closer.",
  ],
  grumpy: [
    "You were gone nine minutes. I counted. Twice.",
    "Hold me. But, like, apologetically.",
    "You petted me with only ONE hand earlier. Noted.",
    "My mood improves in petting range. Hint. HINT.",
    "I forgive you. I'm still mad. Both. It's a gift.",
    "Absence makes the heart grow grumbly.",
    "Was that a goodbye wave? We don't do those.",
    "The floor and I discussed you. It took my side.",
    "Four hundred seconds since your last pet. Roughly.",
    "I'm cross. Fixable with approximately one snuggle.",
    "You said 'right back.' Define 'right.' Define 'back.'",
  ],
  miserable: [
    "Did you forget me? Blink twice if no.",
    "I practiced saying hi and everything...",
    "Hello? It's me. Your biggest fan. Your only me.",
    "I hugged a rock. It didn't hug back. Zero stars.",
    "My tummy is empty and so is the you-shaped spot.",
    "Wilting. Dramatically. Toward wherever you are.",
    "Everything aches, but mostly the goneness.",
    "I made a missing-you list. One name. Huge font.",
    "Even my echo left. Rude of it.",
    "Send help. Specifically you. Only you. Hurry.",
    "I'm saving all my tears for your grand entrance.",
    "When you go, everything just... pauses. Suspicious.",
  ],
  sulking: [
    "I'm not talking to you. Please talk to me.",
    "This sulk is ninety percent missing you.",
    "I ate lunch alone. It tasted like abandonment. And moss.",
    "Back turned. Watching you over my shoulder, though.",
    "I wrote a sad song. It's just your name, slowly.",
    "Someone forgot someone. Naming no names. It was you.",
    "The pout stays until further cuddles.",
    "Fine. FINE. Not fine. Come here.",
    "I counted to one million. You still weren't back.",
    "Officially ignoring you in your general direction.",
    "My grudge fell asleep. Hug me before it wakes up.",
  ],
  refusal: [
    "And leave your side? Absolutely not.",
    "Only if you come too. No? Then no.",
    "An expedition? Away from you? Hilarious. No.",
    "Counter-offer: I stay, you stay, we stay.",
    "My legs said yes but my heart voted twice.",
    "That sounds far. I'm against far as a concept.",
    "I checked my calendar. It's you o'clock all week.",
    "Can't. I'm load-bearing. For hugs. Right here.",
    "Adventure sounds outdoorsy. I'm you-sy.",
    "Ask again while holding me. Still no, but cozier.",
    "I would, but who'd adore you at close range? Exactly.",
  ],
};
