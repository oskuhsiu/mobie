# pokemon-mezastar

A personal-use, **iPad-first** Pokémon Mezastar-style game. Pick a region → meet wild Pokémon →
build a 3-mon team → play a turn-based 3v3 battle with touch QTEs → win, gain EXP, and capture the
boss. Built as a **Web/PWA** (React + Vite + TypeScript), targeting iPad Safari (iPhone-compatible).

> This is a hobby project for personal use. It bundles **no copyrighted assets** — artwork is loaded
> at runtime from official PokéAPI URLs, audio is procedurally synthesized, and any 3D models are
> user-supplied drop-ins. See `uninstall.txt`.

## Features

- **3v3 single battles** with active switching + defensive QTE damage reduction.
- **Touch QTEs**: timing bar (attack accuracy) + mash-charge (extra damage).
- **Accidents & flair**: support roulette, capture-ball roulette, particle FX, procedural SFX,
  Star-Strike finisher (charges from QTE performance, not RNG).
- **Individuality & growth**: seeded IV/nature/shiny, Medium-Fast `n³` EXP curve, persisted roster.
- **Capture**: defeat a region boss to add it to your roster (persisted).
- **Practice mode**: low-level, low-risk battles to grind EXP safely.
- **Team-select helper**: per-card "counters N / weak to N" badges vs the whole foe team, plus a
  one-tap "recommend team".
- **Turn cap** to prevent unwinnable stalemates.
- Content: national dex 1–251, 8 themed regions (+ practice), 16 cross-type starter cards.

## Getting started

```bash
npm install
npm run dev        # Vite dev server on http://localhost:5173
```

Open `http://localhost:5173/` in a browser. For **iPad testing**, run `npm run dev -- --host` and
open the Mac's LAN IP (e.g. `http://192.168.x.x:5173/`) in iPad Safari, or build and install as a PWA.

### Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server (HMR) |
| `npm run build` | `tsc --noEmit` typecheck + production build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm run typecheck` | TypeScript check only |
| `npm test` | Run the Vitest suite |
| `npm run test:watch` | Vitest in watch mode |

## Project layout

```
src/
  app/        React shell + XState game-machine provider
  game/       Pure domain logic (battle reducer/engine, data, growth, individuality, recommend)
  store/      Zustand stores (battle display state, persistent roster)
  ui/         Screens, components, global.css
  audio/  scene/fx/  input/   Audio, particle FX, QTE seam
scripts/gen_dex.mjs   PokéAPI data generator
plan/                 Design docs & milestones (source of truth)
```

See **[ARCHITECTURE.md](ARCHITECTURE.md)** for the full system design, and **[handoff.md](handoff.md)**
for the current working state.

## Regenerating game data

`src/game/data/{species,moves,regions,playerCards}.ts` are **generated** from PokéAPI:

```bash
node scripts/gen_dex.mjs
```

Edit the generator (`scripts/gen_dex.mjs`), not the generated output. `src/game/data/practiceRegion.ts`
is the only hand-authored data file.

## Status

M1 + M1.5 (a–h) complete and device-verified; content expanded to dex 1–251 / 8 regions / 16 starters.
Latest round added capture-to-roster, loss EXP, practice mode, turn cap, near-character HP plates, and
team-select recommendations. **Next: M2 — QR scan + card library** (see `plan/03-milestone-M2.md`).
