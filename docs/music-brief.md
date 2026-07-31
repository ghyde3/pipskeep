# Music brief — generating PipsKeep's soundtrack

For generating tracks on Suno (or similar). Written 2026-07-31, when the game had 3350 tests, six biomes, finite Pips, and a procedural SFX engine but no music.

---

## 1. The single most important constraint: match the SFX engine

Round 2A shipped a **procedural WebAudio engine** (`src/app/audio/`) that already defines this game's sound. Every effect is synthesized in a **pentatonic scale** — soft marimba and kalimba blips, gentle wooden pops, airy chimes, a warm low "purr" for petting, an ascending four-note fanfare on hatch.

**The music must live in that same world**, or every care tap will clash with the bed underneath it. Concretely:

- **Pentatonic or modal, not functional major/minor.** Pentatonic has no semitone clashes, which is exactly why the SFX engine uses it — any blip lands consonantly over any chord.
- **Keep it in one key family across all tracks.** Suggest **C or F pentatonic** so SFX (which are fixed-pitch) never fight the music.
- **Instrumentation to echo, not repeat:** kalimba, marimba, celeste, music box, felt/muted piano, nylon-string guitar, glockenspiel, soft clarinet or recorder, brushed or hand percussion, upright bass. Avoid drum kits, synths with hard attack, and anything with a strong beat — the game has no rhythm-action.
- **Leave space.** Sparse arrangements let the SFX be the foreground. A dense track makes the game feel noisy the moment anyone taps Feed.

---

## 2. Do NOT use Suno for short stings

Hatch chimes, level-up fanfares, tap blips and the parade kazoo are **already synthesized and already good**. They are a few hundred bytes of code versus a few hundred kilobytes of audio, they never clash because they share the engine's scale, and they respond instantly with no decode latency.

**Use Suno only for the long ambient beds** — the things synthesis genuinely can't do well: melody, texture, warmth, a sense of place. That is where generated audio earns its file size.

---

## 3. Priority order — do not generate all fourteen

**Generate these five first.** They cover the game as it exists and are enough to judge whether the direction is right:

1. The Keep — Day (the screen players stare at most)
2. Title / First Light
3. Out in the World (expeditions)
4. The Long Meadow
5. The Album

**Then, if the direction feels right:** the Keep's Dusk and Night variants (round 2K adds time-of-day, so the sky will already be changing), then the six biome tracks, then the memorial.

---

## 4. Technical spec

**Length.** Ask Suno for 2–3 minutes. You only need ~60–90 seconds of usable material — you will trim to a loop.

**Looping.** Suno does not produce seamless loops. Plan to trim in Audacity/Reaper: find a bar line, cut, and crossfade ~200 ms. **The game already has a WebAudio engine**, so load music as an `AudioBuffer` and use `loopStart`/`loopEnd` — that loops sample-accurately and gaplessly regardless of format, which an `<audio>` element cannot do (MP3 encoder padding inserts an audible gap).

**Format and size.** Mono, 96–112 kbps, `.m4a`/AAC (safest across Safari) or `.ogg`. A 90-second mono bed lands around **1.0–1.3 MB**. Music is the biggest asset class this project will ever have.

**Do NOT precache it.** The service worker currently precaches 17 entries / ~1.2 MB, and spec §1 pins time-to-interactive at ≤3 s on Fast 3G. Adding 8 MB of music to the precache would wreck that. Instead: lazy-load the current track on demand and let the runtime cache keep it. The game must stay fully playable with the music still downloading.

**Volume.** Master the beds quiet — around **−18 to −20 LUFS**. They sit *under* SFX, and a cosy game that starts loud gets muted permanently on the first launch.

**Licensing.** Check Suno's current terms for commercial use and attribution before shipping anything publicly. Worth resolving before the tracks are woven in.

---

## 5. The prompts

Suno responds best to comma-separated descriptors. Every prompt below ends with `instrumental, no vocals` — Suno will add singing otherwise.

### Tier 1 — generate these first

**1. The Keep — Day** *(the main bed; must survive hundreds of hours)*
```
gentle cozy game soundtrack, kalimba and marimba over soft felt piano, warm nylon guitar,
light brushed percussion, C pentatonic, 72 BPM, unhurried and sunny, very sparse with lots
of space between phrases, no strong beat, loopable ambient bed, Studio Ghibli morning
warmth, instrumental, no vocals
```
*Note: the most important quality here is **non-fatigue**. If it has a catchy hook, it is wrong — you will hear it ten thousand times.*

**2. Title / First Light** *(the wordmark, the starter pick — the first ten seconds anyone hears)*
```
warm hopeful music box and celeste melody, soft strings swelling gently underneath,
nylon guitar, C pentatonic, 68 BPM, tender and a little magical, a small theme that
resolves kindly, storybook opening, instrumental, no vocals
```
*This is the only track allowed a real, memorable melody — it is the game's identity.*

**3. Out in the World** *(a Pip is away on an expedition)*
```
light curious wandering instrumental, plucked nylon guitar and glockenspiel, soft clarinet
countermelody, gentle shaker and hand percussion, F pentatonic, 96 BPM, forward motion but
never urgent, cheerful travelling music, sparse and airy, instrumental, no vocals
```

**4. The Long Meadow** *(where retired Pips live — visitable, never sad)*
```
peaceful pastoral instrumental, warm cello and soft clarinet over sustained felt piano,
distant kalimba, C pentatonic, 60 BPM, serene and golden, a warm goodbye that is not an
ending, gentle and unhurried, no melancholy, instrumental, no vocals
```
*Tone note: this is a **retirement home, not a graveyard**. Warm afternoon light, not grief.*

**5. The Album** *(the collection scrapbook)*
```
nostalgic music box and celeste, soft vibraphone, faint tape warmth, C pentatonic, 64 BPM,
reflective and fond, like turning pages of an old photo album, very sparse, instrumental,
no vocals
```

### Tier 2 — the Keep across the day *(round 2K adds a changing sky)*

**6. The Keep — Dusk**
```
cozy evening instrumental, warm marimba and low felt piano, soft cello pad, muted
glockenspiel, C pentatonic, 66 BPM, golden hour calm, slower and warmer than daytime,
very sparse, loopable, instrumental, no vocals
```

**7. The Keep — Night**
```
quiet nocturne, music box and celeste, faint sustained pad, occasional soft kalimba note,
C pentatonic, 56 BPM, hushed and safe, almost silent in places, lullaby without being
sleepy, extremely sparse, loopable, instrumental, no vocals
```

### Tier 3 — the six biomes *(short beds that play while a Pip is on that trail)*

**8. Meadow** — *"Sun-warmed grass, suspiciously friendly bees, snacks and fallen twigs everywhere."*
```
bright sunny pastoral, kalimba and recorder, light shaker, warm nylon guitar, F pentatonic,
92 BPM, buoyant and simple, meadow in summer, instrumental, no vocals
```

**9. Bramblewick** — *"A hedge with opinions. Twine, honey, and one thorn that will absolutely find you."*
```
playful mischievous instrumental, pizzicato strings and woodblock, plucked banjo-like nylon
guitar, muted trumpet accent, F pentatonic, 104 BPM, cheeky and slightly chaotic, comic
timing, sparse, instrumental, no vocals
```

**10. Forest** — *"Tall trees, deep shadows, and something delicious simmering somewhere."*
```
deep woody instrumental, low marimba and bass clarinet, soft harp, distant wooden percussion,
D pentatonic, 76 BPM, mysterious but safe, dappled light under a canopy, instrumental,
no vocals
```

**11. Snowdrift** — *"Above the treeline everything is quiet, faintly ridiculous, and slightly frozen."*
```
sparse glassy instrumental, glockenspiel and celeste, breathy flute, soft sustained pad,
C pentatonic, 62 BPM, crisp and still, gently absurd, cold air and bright sun, very sparse,
instrumental, no vocals
```

**12. Shore** — *"Salt air, glittering tide pools, and treasures the sea forgot to keep."*
```
airy coastal instrumental, vibraphone and harp, soft brushed cymbal like distant surf,
gentle nylon guitar, F pentatonic, 80 BPM, glinting and open, salt air and sunlight on water,
instrumental, no vocals
```

**13. Lanterngrotto** — *"A sea cave that glows on purpose. The rocks are warm. Nobody knows why."*
```
warm glowing instrumental, bowed vibraphone and soft synth pad with long reverb, low kalimba,
occasional water drop percussion, D pentatonic, 68 BPM, wonder and quiet awe, luminous cave,
spacious reverb, instrumental, no vocals
```

### Tier 4 — the hardest one, generate last

**14. Memorial** *(a Pip has been lost — round 2H)*
```
brief tender instrumental, solo felt piano with one warm cello line, C pentatonic, 54 BPM,
dignified and quiet, a held breath then gentle warmth, grateful rather than grieving,
absolutely no sentimentality or sad-movie strings, very short and restrained, instrumental,
no vocals
```
*Tone note: spec §15.5 and round 2H's cruelty audit both bind here. This must read as **"thank you"**, not "how sad". If it makes you feel manipulated, regenerate it. Should be ~20–30 seconds, played once, not looped.*

---

## 6. What to listen for when judging takes

- **Does it survive the tenth listen?** The Keep bed especially. Hooks are a liability.
- **Can you talk over it?** If it demands attention, it will fight the game.
- **Does a marimba blip land consonantly on top?** Play the game with the track behind it before committing.
- **Is there space?** Silence is a feature in a cosy game.
- **Does it start gently?** Tracks that open on a downbeat feel like an ad.

---

## 7. When the files exist

`src/app/sound.ts` is the SFX seam and should be left alone. Music wants a sibling — `src/app/music.ts` — that decodes to `AudioBuffer`, crossfades between beds (~1.5 s), ducks under celebration SFX, obeys the existing mute toggle with its own separate music/SFX split, and never autoplays before a user gesture (browsers block it, and the sound engine already handles that gesture).

Track selection is a pure function of state — Keep vs Album vs Long Meadow vs which biome the active Pip is on, plus time of day once round 2K lands. That keeps it testable in `core/` style even though playback lives in `app/`.
