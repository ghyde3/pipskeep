# Working agreement

How this project is built. Reconstructed from the owner's stated preferences and from what nine rounds proved actually works — it lived in machine-local agent memory, which does not travel with the repo.

## The owner's preferences

- **No AI attribution** in commits or PRs. Set project-wide in `.claude/settings.json` (`attribution.commit` and `.pr` are empty strings). Do not add trailers or co-author lines.
- **Propose infrastructure before building it.** For setup, tooling, config and process changes, present a reviewable list and wait for a go-ahead. Normal in-round coding does not need this — once a round is scoped, execute it autonomously.
- **Model-tiered delegation.** Cheap models for search, mid-tier for implementation, expensive only for design and adversarial review. The four agents in `.claude/agents/` encode this: scout (haiku), builder (sonnet), reviewer (opus), oracle (fable).
- **The oracle (fable) is expensive and rationed.** Use it only when explicitly sanctioned or for genuinely hard problems (catch-up segmentation, RNG determinism, save migrations, a bug that survived one fix). The owner sanctioned it once, by name, for round 2G's HUD visual pass.
- **`.claude/` is committed.** Settings, agents and workflows are shared artifacts — treat edits to them like code changes.
- **Build, don't ask permission to build.** The owner's standing instruction: "if you find value in building a feature, just build it." Reserve questions for decisions that are hard to reverse or genuinely theirs (tone, scope direction, what the game *is*).

## The round pattern that works

Every round since Phase 0 has used the same shape, and the verification stage has justified itself every single time:

```
Design (expensive model, writes a bible to docs/)
  → Build (sonnet, disjoint file ownership, sequential where state is shared)
  → Integrate (one agent owns the seams and the schema bump)
  → Verify, in parallel:
       • gate runner   — re-runs everything itself, maps each requirement to a named test
       • domain audit  — tone / dark-pattern / game-design / cruelty, depending on the round
       • mutation      — deliberately breaks the round's own guarantees
  → Fix (only if majors survive) → re-gate
```

Non-negotiables learned the hard way:

- **Design first, in a committed document.** `docs/*-bible.md` carry the reasoning; the code carries the result. Rounds that designed first found problems arithmetic could catch (the impossible 12-tier ladder, the second progression deadlock) before anyone wrote code.
- **The mutation stage is not optional.** It found the vacuous FakeClock test, the autosave that never fired, the silent bucketing, and a streak break that could destroy milestone progress. Tests passing has repeatedly not meant the feature worked.
- **"Written to state" and "visible to the player" are separate acceptance criteria** (spec §16 v1.3). Six dead features have shipped anyway. Every round should produce a visibility table: mechanic → where core applies it → where the player sees it.
- **Gate every round yourself before committing.** Re-run the tests, play the change in a browser, then log the gate in `PROGRESS.md`. Never trust a subagent's "it's green".
- **Never hand-edit files a running workflow owns.** Doing so during round 2B got the work reverted by that round's own fixer, which correctly flagged it as an unexplained change.
- **Restart the dev server before browser QA.** Stale Vite module graphs have produced phantom bugs more than once. Port 5317 is pinned deliberately (`autoPort: false`).

## Tone rules that outrank features

- §4.4's floor, as amended by §16 v1.5: Pips are finite now, but the **five promises** bind absolutely — loss is never a surprise, never caused by absence, old age is peaceful, every loss leaves a thread to pull, the Keep is never empty.
- Round 2C's guardrail: **reward showing up, never punish absence.** A broken streak costs a bonus, never progress.
- §15.5: warm, mischievous, opinionated. Never guilt the player. Even Sulking dialogue is funny-sad, not bleak.
- §0 vocabulary: Pip, Pipling, Pipping, the Keep. Never "Pal", "-gotchi", or any Pokémon/Palworld/Tamagotchi term anywhere — code, copy, assets or docs.
