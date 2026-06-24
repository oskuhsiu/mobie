# mobie

**Mobie** (小怪物) — a personal-use, **iPad-first** monster-battler. Pick a region → meet wild Mobie →
build a 3-mob team → play a turn-based 3v3 battle with touch QTEs → win, gain EXP, and capture the
boss. Built as a **Web/PWA** (React + Vite + TypeScript), targeting iPad Safari (iPhone-compatible).

> This is a hobby project for personal use. It bundles **no copyrighted assets** — artwork is loaded
> at runtime from official PokéAPI URLs, audio is procedurally synthesized, and any 3D models are
> user-supplied drop-ins. Pokémon and all related marks/data are the property of their respective
> owners; this project is non-commercial and unaffiliated — see **[ATTRIBUTION.md](ATTRIBUTION.md)**.
> See also `uninstall.txt`.

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
- **QR cards & library** (M2): scan a card QR (or hand-enter the code) to add a Mobie; browse, import
  (JSON/CSV), make custom cards, and print QR codes from the in-app library.
- **3D battle stage** (M3): React-three-fiber stage with user drop-in GLB models (IndexedDB), falling
  back to PokéAPI billboard sprites.
- **Portable saves** (M5): export your roster/cards (+ optional 3D models) as a `username.save` (zip)
  to your own Google Drive/Files via the iOS share sheet; re-import with old/new detection, consented
  overwrite, and an automatic pre-import backup. **No backend** — your cloud, your file.
- **Arena vs wild modes** (M6): the arena is neutral, EXP-only, no-capture; wild regions let you capture
  the boss. Mode is a data contract on the region, not a special case in the flow.
- **Multi-move loadouts** (M19): each Mobie has a species learnset and up to 4 equipped moves
  (attack + status), learn/forget at the **Move Trainer** with SP; battle is "pick a slot → QTE".
  Identity is carried by the single star-strike finisher.
- **Mobie info card** (M16): tap a Mobie — in battle (HP plate / team tray) **or** in the **Team**
  screen — to see its moves, six stats, individuality, ability and held item.
- **Terrain** (M8): regions have fixed / mixed / random terrain that scales move power.
- **Combo chain** (M9) and **per-type battle FX** (M21) for extra arcade punch.
- **Collection & growth** (M10): evolution, star grade, a 1–251 **dex**, **achievements**, and an
  **egg incubator**.
- **Tower run & wild accidents** (M11): an escalating no-heal tower with Ascension difficulty tiers
  (entered from region select), plus wild-only events (rare shiny boss / lucky bonus / supply drop /
  terrain shift / intruder).
- **Partner (trainer) skills** (M17): account-level tactical tools — "see through" a foe's card,
  "rally" the whole team — unlocked with SP, separate from creature moves.
- **Enhanced interactivity** (M22, off by default): optional swipe/circle/hold/rhythm gestures for
  capture and star-strike, for a more hands-on feel.
- **Optional extension systems**, all off by default and toggled in the in-app **Settings** panel —
  each is a swappable module hooked onto fixed engine seams, so turning it off leaves zero residue:
  team synergy, held items, abilities, combo chain, evolution. (The tower is a game *mode*, not a
  toggle.)
- **Tools stay reachable mid-game**: the title's tools row is shared onto the region-select hub, so
  scan / library / team / moves / partner skills / dex / achievements / incubator / models / save /
  settings are available after the game starts, not only from the title.
- Content: national dex 1–251, 8 themed regions (+ arena), 16 cross-type starter cards.

## Getting started

```bash
npm install
npm run dev        # Vite dev server on http://localhost:5173
```

Open `http://localhost:5173/` in a browser. For **iPad testing**, run `npm run dev -- --host` and
open the Mac's LAN IP (e.g. `http://192.168.x.x:5173/`) in iPad Safari, or build and install as a PWA.

### Versioning

The app version (shown on the title screen) is `package.json`'s `version`, injected at build time as
`__APP_VERSION__`. A **`pre-commit` git hook auto-bumps the patch version on every commit**
(`scripts/bump-version.mjs`, kept in sync with `package-lock.json`). The hook lives in `.githooks/` and
is enabled by `npm install` (the `prepare` script sets `core.hooksPath`) — so after a fresh clone, run
`npm install` once.

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
    ext/      Extension seams (S1–S8) + modules: synergy / items / abilities / chain / evolution /
              partnerSkills + statPatch (M6/M7/M9/M10/M17)
    save/     Portable save file: envelope meta, zip pack/unpack, export/import I/O, backup (M5)
    settings.ts   Per-system module toggle + enhanced-interactivity prefs (M6/M22)
  store/      Zustand: battle display, persistent roster, settings+ext assembly, item bag, skill
              points, player skills, tower run, metadata, incubator
  ui/         Screens + components; shared ToolsMenu (title + region hub), MobCard info card,
              move/partner/team/settings/dex/etc. modals, global.css
  scene/r3f/  scene/models/   3D battle stage + user GLB store (M3)
  audio/  scene/fx/  input/   Audio, per-type battle FX, QTE + gesture seams
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

**M1 + M1.5 (a–h), M2 (QR scan + card library), M3 (R3F 3D stage + GLB drop-in), M5 (portable save
files), M6 (extension foundation: seams S1–S8 + arena/wild mode contract), M7 (synergy / held items /
abilities), M8 (field/terrain), M9 (combo chain), M10 (evolution / star grade / dex+achievements /
egg incubator), M11 (tower / Ascension / wild accidents), M16 (mob info card), M17 (partner skills),
M18 (rename to Mobie, code complete), M19 (multi-move learnsets + move trainer), M21 (battle FX), and
M22 a–e (enhanced-interactivity MVP) are complete** and CDP-verified — **372 Vitest tests**, typecheck,
and build all green. Content: national dex 1–251, 8 regions (+ arena), 16 starters.

The whole project has had a real-case verification pass: a **data-integrity** suite (every one of the
251 species / moves / regions / cards / type-chart entries swept), a **battle-simulation** stress suite
(hundreds of full seeded battles asserting HP bounds, no-NaN, guaranteed termination, and determinism —
modules off vs all-on), persistence round-trips, and CDP real-play (arena EXP-only win, wild win →
capture → roster growth, extension modules taking effect, tower run, all tool modals) with zero console
errors. M5 save correctness was earlier cross-validated by an independent **5-agent blind interop test**.

**Next:** sparse initial loadouts (seeded starting moves, trained up over time) and the M22 f–j
interaction backlog. M4 (MediaPipe motion-control QTE) remains skipped by the owner. **Owner-only
leftover:** M18.e renames the repo directory + git remote (`pokemon-mezastar` → `mobie`). See
`plan/CHECKLIST.md` for the milestone breakdown and `handoff.md` for the live working state.
