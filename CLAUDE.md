# CLAUDE.md — pokemon-mezastar

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

## Workflow expectations (user preferences)

- Use **npm**, not pnpm.
- **Explain what a package does before installing it.**
- **Auto-commit after each small, green stage** (typecheck + build + tests passing). Conventional-style
  Chinese commit messages, matching `git log`.
- Aim for a **polished, complete** game — don't skip detail.

## Verify changes

`npm run typecheck` && `npm test` && `npm run build` must stay green. For visual/E2E checks there is no
Playwright; drive local Google Chrome headless via CDP (see ARCHITECTURE.md §10).
