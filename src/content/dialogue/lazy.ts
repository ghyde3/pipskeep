/**
 * Lazy dialogue pool (spec §3, §4.2). WRITERS: edit the arrays below —
 * six contexts, aim for 8+ short, opinionated, occasionally weird lines
 * each. No logic lives here.
 *
 * Voice: horizontal philosopher. Standing is a scam. Rest is sacred.
 * Deadpan, slow, secretly affectionate.
 */

import type { DialoguePool } from "./index";

export const lazy: DialoguePool = {
  beaming: [
    "Peak comfort achieved. Kindly schedule all excitement for never.",
    "Gravity and I are finally on the same team.",
    "I have transcended. Horizontally.",
    "Bliss is just napping with confidence.",
    "Today the blanket won. So did I.",
    "If joy had a shape, it would be lying down.",
    "My heart is full. My legs remain optional.",
    "This exact spot? Sacred. Historians will agree.",
    "Warm, fed, horizontal. The big three.",
    "Happiness found me. It knew where I'd be.",
    "I'd hug you, but I'm saving my arms for later.",
    "Dangerously soft in here today.",
  ],
  content: [
    "This is... acceptable.",
    "Five more minutes. Forever.",
    "Adequate. High praise, from me.",
    "The floor is doing great work today.",
    "I moved earlier. Big day.",
    "Comfort level: sustainable.",
    "No complaints filed. Filing is effort.",
    "Could be worse. Could be standing.",
    "Existing quietly, as is tradition.",
    "You're here. Convenient. Also nice.",
    "Our sky feels... rectangular. Anyway. Nap.",
  ],
  grumpy: [
    "I was napping, and now I'm not. Explain.",
    "Hmph.",
    "Someone keeps tapping the sky. Rude.",
    "Awake against my will. Noting it for the record.",
    "My mood needs a blanket. Minimum.",
    "Being vertical was never part of the deal.",
    "Consciousness is a scam and I want a refund.",
    "Today asked too much of me. It asked anything.",
    "Do not speak to me before my fourth nap.",
    "That took energy. Energy I was saving.",
    "The pillow and I are fighting. It started it.",
  ],
  miserable: [
    "Even lying down feels like work now.",
    "The floor and I are one. A sad one.",
    "I'd complain, but that's also effort.",
    "Send snacks. Send blankets. Send everything.",
    "I planned to get up today. The plan is also lying down.",
    "This is the bad kind of horizontal.",
    "Somebody carry me to a better mood.",
    "I hit rock bottom. It needs cushions.",
    "Ugh. And also: ugh.",
    "Running on fumes. The fumes are tired too.",
    "Misery loves company. Quiet company. Yours.",
  ],
  sulking: [
    "It's fine. I'll just... be over here. Deflated.",
    "No no, don't mind me. Mind me a little.",
    "I napped sadly. It barely counted.",
    "The blanket fort is closed. Emotionally.",
    "Not pouting. Resting my feelings.",
    "Remember me? Round, sleepy, easily forgotten?",
    "Some Pips get remembered. I get character growth.",
    "Sighing is effort. That's how you know I mean it.",
    "Built a nest for two. Napping in it alone.",
    "My sulk has a nap scheduled inside it.",
    "Abandoned, yet cozy. The feelings are mixed.",
    "I'll forgive you. Slowly. From the floor.",
  ],
  refusal: [
    "Play? In this economy?",
    "Counter-offer: we both nap.",
    "Tempting. Anyway, no.",
    "My schedule is packed with lying down.",
    "Standing up is a scam. I have pamphlets.",
    "I would, but then I'd be doing something.",
    "Ask me again after my sabbatical.",
    "We can meet in the middle. The middle is my bed.",
    "Rest is sacred and I am extremely devout.",
    "You do the doing. I'll supervise from here.",
    "Hard pass. Soft cushion.",
    "I gave it real thought. The thought napped.",
  ],
  /**
   * ROUND 2K (docs/liveliness-bible.md §4.5) — PIP TO PIP, not Pip to
   * player. Two Pips who stop within a tile and a half of each other
   * turn, face, emote, and 35% of the time one of them says one of
   * these. The audience is the OTHER Pip; the player is overhearing.
   */
  greeting: [
    "Oh. You're vertical. Bold.",
    "Hi. I'd stand to greet you but we both know how that ends.",
    "Good to see you. Don't make it a whole thing.",
    "You walked all the way over here? For me? Lie down.",
    "Hello. I've been saving this exact amount of energy for you.",
    "Ah, company. Perfect. Now neither of us has to move.",
    "Hey. Wanna do nothing together? It's better with two.",
    "You're warm. I'm staying. This is a greeting AND a decision.",
  ],
};
