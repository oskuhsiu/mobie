# CLAUDE.md — mobie

**Read [`ARCHITECTURE.md`](ARCHITECTURE.md) first**, then [`handoff.md`](handoff.md) for the current
working state. Design rationale and milestones live in [`plan/`](plan/) — treat those as the source of
truth and reference them instead of re-deriving.

## Hard constraints (do not violate)

- **Platform is Web/PWA** (iPad-first), not native iOS. Native is only a future performance escape hatch.
- **No infringing assets** in the repo. Artwork = PokéAPI runtime URLs; audio = procedural; 3D models =
  user drop-in only (`public/models/` is gitignored).
- **Generated data files are off-limits to hand edits:** `src/game/data/{species,moves,regions,playerCards}.ts`
  come from `scripts/gen_dex.mjs`. Change the generator and re-run `node scripts/gen_dex.mjs`.
  `src/game/data/practiceRegion.ts` is the one hand-authored data file.
- **Keep the battle reducer pure** (`src/game/battle/reducer.ts`): no UI/animation vocabulary; it emits
  domain events that `BattleScreen` plays out. Persist only canonical `OwnedUnit` — never derived/RNG state.
- **Performance red-line:** high-frequency values (QTE pointer, future MediaPipe coords) go through
  refs/rAF/DOM/Zustand, never React top-level state.
- **Move system is now MULTI-MOVE (Pokémon-style), not single-move.** Earlier docs (plan/09–12, code
  comments) say 「單招街機 / 每隻單一專屬招」— **that constraint was relaxed by the user (2026-06-24; M19,
  see `plan/17-mobie-multimove-skills.md`).** Each mobie has up to 4 equipped moves from a species learnset
  (learn/forget, capped); identity is carried by the single **star-strike finisher**. **Still invariant:**
  the arcade resolves **one `ATTACK` action per turn** (player picks a slot → QTE), the reducer stays pure
  (`slotIndex` in, `resolvedMoveId` out), and passive/auto effects stay in the **ability** system (M7),
  not in move slots. Treat `plan/17` as the current truth over older 單招 wording.

## Workflow expectations (user preferences)

- Use **npm**, not pnpm.
- **Explain what a package does before installing it.**
- **Auto-commit after each small, green stage** (typecheck + build + tests passing). Conventional-style
  Chinese commit messages, matching `git log`.
- Aim for a **polished, complete** game — don't skip detail.

## Verify changes

`npm run typecheck` && `npm test` && `npm run build` must stay green. For visual/E2E checks there is no
Playwright; drive local Google Chrome headless via CDP (see ARCHITECTURE.md §10).
