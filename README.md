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
- **Team-select advice**: reveal a recommended trio with offense/risk reasons, then let the player
  choose and order the three Mobie instead of silently filling the team.
- **Turn cap** to prevent unwinnable stalemates.
- **QR card library** (M2): browse, import (JSON/CSV), make custom cards, and print QR codes. Scanner
  source is dormant and has no M23 UI/import/camera path.
- **3D battle stage** (M3): React-three-fiber arena with PokéAPI artwork billboards; Battle/Capture
  never read custom GLB/GLTF or model storage.
- **Safe renderer gate** (M23 Ticket 07): Auto starts Balanced, High caps DPR at 1.5, and chunk/WebGL/
  shader/context failures switch one-way to a playable DOM compatibility scene without rerunning turns.
- **Release quality governor** (M23 Ticket 16): active rendered frames use a 120-gap hysteresis window;
  sustained pressure applies DPR, post-grade, particle/weather, then compatibility reductions only at
  cue boundaries. Idle rendering is demand-capped, transient pools are bounded, and release metrics can
  be written with `npm run perf:check -- --evidence=true`.
- **Release A renderer rollout** (M23 Ticket 17): legacy remains the production default; the next
  renderer is available only through the DEV/test `renderer=next` flag, with the same seeded battle
  state and a compatibility rollback path that does not touch saves or replays.
- **Semantic battle HUD** (M23 Ticket 08): Legacy, Next, and Compatibility share one head-safe stage/command
  shell with real 1–4 move data, semantic HP/team controls, normal QTE body swaps, focus restoration,
  and a stable-ID full-session battle feed.
- **Complete battle command deck** (M23 Ticket 09): switch, Star, fixed chain/combo, learned Partner
  actions, MobCard gating, side/field statuses, and fixed ability/item source cues share truthful
  phase, resource, disabled, overflow, and accessibility semantics.
- **Responsive, accessible battle input** (M23 Ticket 10): five mutually exclusive viewport classes,
  44/56px targets, keyboard-complete QTEs, trapped/restored dialog focus, hidden/resume clocks, and an
  OS-level reduced-motion ceiling keep the full command journey playable under narrow and zoomed layouts.
- **Neutral arena camera tracer** (M23 Ticket 11): one R3F scene owns the arena, lights, combatants,
  world-space rig anchors, and reclaimable wide/caster/impact shots. Artwork billboards and named
  procedural silhouettes share the same projection contract, while reduced motion stays wide.
- **Procedural terrain worlds** (M23 Ticket 12): all 23 terrain IDs resolve to one of eight reusable
  R3F stage silhouettes with distinct palette, lighting, fog, and bounded weather. Mixed terrain keeps
  one primary world plus one sparse accent, with a 400ms palette/weather crossfade and tiered detail.
- **Portable saves** (M5): export your roster/cards (+ optional 3D models) as a `username.save` (zip)
  to your own Google Drive/Files via the iOS share sheet; re-import with old/new detection, consented
  overwrite, and an automatic pre-import backup. **No backend** — your cloud, your file.
- **Arena vs wild modes** (M6): the arena is neutral, EXP-only, no-capture; wild regions let you capture
  the boss. Mode is a data contract on the region, not a special case in the flow.
- **Multi-move loadouts** (M19): each Mobie has a species learnset and up to 4 equipped moves
  (attack + status), learn/forget at the **Move Trainer** with SP; battle is "pick a slot → QTE".
  Identity is carried by the single star-strike finisher.
- **My Mobie collection** (M16): the first-level **我的 Mobie** action shows every owned companion,
  current-level EXP progress and next threshold; tap one for moves, six stats, individuality, ability
  and held item. The same detail card remains available from battle HP plates / team trays.
- **Terrain** (M8): regions have fixed / mixed / random terrain that scales move power.
- **Combo chain** (M9) and **per-type battle FX** (M21) for extra arcade punch.
- **Collection & growth** (M10): evolution, star grade, a 1–1025 **dex**, **achievements**, and an
  **egg incubator**.
- **Tower run & wild accidents** (M11): an escalating no-heal tower with Ascension difficulty tiers
  (entered from region select), plus wild-only events (rare shiny boss / lucky bonus / supply drop /
  terrain shift / intruder).
- **Partner (trainer) skills** (M17): account-level tactical tools — "see through" a foe's card,
  "rally" the whole team — unlocked with SP, separate from creature moves.
- **Enhanced interactivity** (M22, off by default): optional swipe/circle/hold/rhythm gestures for
  capture and star-strike, for a more hands-on feel.
- **Fixed extension systems** — team synergy, held items, abilities, combo chain, evolution, and
  partner skills always run through one pure product-runtime seam; Settings only controls real UX
  preferences. Encounter styles are hard-off.
- **Focused hub navigation**: title and region-select keep **我的 Mobie** and **更多** at the first
  level. Library / moves / partner skills / dex / achievements / incubator / models / save /
  settings remain available in the scrollable secondary menu without competing with the hunt loop.
- Content: national dex 1–1025 (G1–G9), 16 themed regions (+ arena), 16 cross-type starter cards.

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
| `npm run perf:check -- --port=9223` | CDP frame-pacing check against a running app + hardware Chrome target |
| `node scripts/m23-baseline.mjs --renderer=<route>` | Seeded Release A Chrome evidence (`legacy`, `next`, or `compatibility`) |

## Project layout

```
src/
  app/        React shell + XState game-machine provider
  game/       Pure domain logic (battle reducer/engine, data, growth, individuality, recommend)
    ext/      Extension seams + fixed productRuntime: synergy / items / abilities / chain / combo /
              evolution; partner skills use learned-state authority
    save/     Portable save file: envelope meta, zip pack/unpack, export/import I/O, backup (M5)
    settings.ts   Runtime UX preferences + read-only legacy module-data preservation
  store/      Zustand: battle display, persistent roster, prefs-only settings, item bag, skill
              points, player skills, tower run, metadata, incubator
  ui/         Screens + components; semantic battle HUD/feed/actions/status, shared ToolsMenu
              (title + region hub), MobCard info card, move/partner/team/settings/dex/etc. modals
  scene/battle/ scene/r3f/    Three-free host + lazy legacy/next artwork-billboard entries + compatibility gate
  scene/models/                Isolated legacy model tooling (not in Battle/Capture graphs)
  audio/  scene/fx/  input/   Audio, per-type battle FX, QTE + gesture seams
scripts/gen_dex.mjs   PokéAPI data generator
plan/                 Existing tracked design docs; local generated specs/tickets are gitignored
```

See **[ARCHITECTURE.md](ARCHITECTURE.md)** for the full system design, and **[handoff.md](handoff.md)**
for the current working state. Release A route and rollback steps live in
**[docs/m23-release-a.md](docs/m23-release-a.md)**.

## Regenerating game data

`src/game/data/{species,moves,regions,playerCards}.ts` are **generated** from PokéAPI:

```bash
node scripts/gen_dex.mjs
```

Edit the generator (`scripts/gen_dex.mjs`), not the generated output. `src/game/data/practiceRegion.ts`
is the only hand-authored data file.

## Status

**M1 + M1.5 (a–h), M2 (QR scan + card library), M3 (R3F 3D stage + artwork billboard), M5 (portable save
files), M6 (extension foundation: seams S1–S8 + arena/wild mode contract), M7 (synergy / held items /
abilities), M8 (field/terrain), M9 (combo chain), M10 (evolution / star grade / dex+achievements /
egg incubator), M11 (tower / Ascension / wild accidents), M16 (mob info card), M17 (partner skills),
M18 (rename to Mobie, code complete), M19 (multi-move learnsets + move trainer), M21 (battle FX), and
M22 a–e (enhanced-interactivity MVP), and M23 Tickets 01–16 implementation checks are complete** for
the current Chrome qualification pass — **682 Vitest tests**, typecheck, and build are green. Content:
national dex 1–1025, 16 regions (+ arena),
16 starters.

The whole project has had a real-case verification pass: a **data-integrity** suite (every one of the
1025 species / moves / regions / cards / type-chart entries swept), a **battle-simulation** stress suite
(hundreds of full seeded battles asserting HP bounds, no-NaN, guaranteed termination, and determinism —
the fixed product runtime), persistence round-trips, and CDP real-play (arena EXP-only win, wild win →
capture → roster growth, extension modules taking effect, tower run, all tool modals) with zero console
errors. M5 save correctness was earlier cross-validated by an independent **5-agent blind interop test**.

**Next:** M23 Ticket 18 requires one stable Release A release and owner sign-off before next can become
the default. Physical iPad Safari qualification remains an external device evidence step for Ticket 16;
sparse initial loadouts and the M22 f–j interaction backlog remain later work. M4 (MediaPipe motion-control
QTE) remains skipped by the owner. **Owner-only leftover:** M18.e
renames the repo directory + git remote (`pokemon-mezastar` → `mobie`). See `plan/CHECKLIST.md` for the
milestone breakdown and `handoff.md` for the live working state.
