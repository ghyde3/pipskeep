/**
 * Hardworking dialogue pool (spec §3, §4.2). WRITERS: edit the arrays
 * below — six contexts, aim for 8+ short, opinionated, occasionally weird
 * lines each. No logic lives here.
 *
 * Voice: tiny foreman. Measures everything in productivity, schedules
 * naps as sprints, suspicious of idleness, secretly proud of you.
 */

import type { DialoguePool } from "./index";

export const hardworking: DialoguePool = {
  beaming: [
    "Quota exceeded. Take five. Not six.",
    "Morale is up forty percent. I did the math.",
    "This is what peak operations looks like!",
    "I scheduled joy for today and it showed up early.",
    "Top-shelf work lately. Yes, I mean yours.",
    "The clipboard says thriving. Clipboards never lie.",
    "Filed today under: best practices.",
    "Efficiency AND happiness. Unstoppable.",
    "I'd put you on the top performers wall. You're on it.",
    "Whoever runs the weather here keeps excellent hours.",
    "All systems humming. Mostly me. I'm humming.",
  ],
  content: [
    "Steady output. No complaints. Log it.",
    "Shift's going fine. Don't jinx it.",
    "Nap sprint at noon, sharp. Non-negotiable.",
    "Everything's on schedule, which is suspicious. But nice.",
    "Inspected the Keep. It passes. Barely. Kidding — passes.",
    "Mild satisfaction: achieved.",
    "The moss won't supervise itself. Back to it.",
    "Counted the pebbles again. All present. Good pebbles.",
    "Adequate day. From me, that's a medal.",
    "Break's over. The break was three seconds.",
    "The sun clocks out at the same minute daily. Noted.",
  ],
  grumpy: [
    "Standards are slipping, and I am the standards.",
    "Whoever scheduled this mood is fired.",
    "Running on fumes. The fumes are also tired.",
    "This is a hostile work environment. The hostile is me.",
    "Morale audit came back: bad. Recommend snacks.",
    "I'm not mad. I'm behind schedule. Same thing.",
    "Grumbling burns fuel, so technically I'm working.",
    "Someone idled today. I saw. It was me. Unacceptable.",
    "The clipboard and I need a moment.",
    "This afternoon is getting a written warning.",
    "Complaints are up two hundred percent. All mine.",
  ],
  miserable: [
    "Output: zero. Morale: matching. Hate the symmetry.",
    "Apparently I clocked in to suffer today.",
    "My to-do list has one item now: sigh.",
    "I tried working through it. It won.",
    "Today's quota was tears. Met it before lunch.",
    "Foreman down. Send snacks and a small blanket.",
    "This slump is behind schedule. It should be done.",
    "I filed a request for a better day. No reply yet.",
    "The productivity chart fell off the bottom edge.",
    "My get-up-and-go submitted a leave request.",
    "Even the dust is outworking me right now.",
  ],
  sulking: [
    "I re-alphabetized the pebbles. Alone. Twice.",
    "Attendance log: me, present. You, a mystery.",
    "Held our morning stand-up solo. Poor turnout.",
    "The schedule said you'd come. I trusted the schedule.",
    "Ate my rations without joy and noted it in the log.",
    "Fine, I'll supervise the dust. At least it shows up.",
    "Someone missed their shift. No names. Rhymes with you.",
    "I built a small waiting chair. It's seen things.",
    "My loyalty numbers remain, tragically, excellent.",
    "Sulk sprint in progress. Do not disturb. Okay, disturb.",
    "Gave your absence a performance review. It excelled.",
  ],
  refusal: [
    "Denied. Per the schedule. The schedule is me.",
    "That's not in this sprint. Pitch it next sprint.",
    "Request received. Filed under: nope.",
    "I'd love to, but the energy budget says no.",
    "Counterproposal: I stand right here instead.",
    "Union of One rules apply. Mandatory rest.",
    "Can't. I'm at capacity. The capacity is small.",
    "Nap sprint takes priority. Safety first.",
    "The clipboard says no. Take it up with the clipboard.",
    "Flattered, but the answer is a firm not-today.",
    "Rescheduled to later. Later has a great track record.",
  ],
};
