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
- **QR cards & library** (M2): scan a card QR (or hand-enter the code) to add Pokémon; browse, import
  (JSON/CSV), make custom cards, and print QR codes from the in-app library.
- **3D battle stage** (M3): React-three-fiber stage with user drop-in GLB models (IndexedDB), falling
  back to PokéAPI billboard sprites.
- **Portable saves** (M5): export your roster/cards (+ optional 3D models) as a `username.save` (zip)
  to your own Google Drive/Files via the iOS share sheet; re-import with old/new detection, consented
  overwrite, and an automatic pre-import backup. **No backend** — your cloud, your file.
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
    save/     Portable save file: envelope meta, zip pack/unpack, export/import I/O, backup (M5)
  store/      Zustand stores (battle display state, persistent roster)
  ui/         Screens, components (incl. card scanner/library, model & save manager modals), global.css
  scene/r3f/  scene/models/   3D battle stage + user GLB store (M3)
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

**M1 + M1.5 (a–h), M2 (QR scan + card library), M3 (R3F 3D stage + GLB drop-in), and M5 (portable
save files) are complete** and device/CDP-verified — 122 Vitest tests, typecheck, and build all green.
Content: national dex 1–251, 8 regions (+ practice), 16 starters. M5 save export/import correctness was
additionally cross-validated by an independent **5-agent blind interop test** (both directions,
byte-level fidelity incl. binary 3D models).

**Next:** M4 (MediaPipe motion-control QTE — currently skipped by the owner) or the M6+ extension
milestones; the terrain / mode-split system (formerly M7) is being developed in parallel. See
`plan/CHECKLIST.md` for the milestone breakdown and `handoff.md` for the live working state.
