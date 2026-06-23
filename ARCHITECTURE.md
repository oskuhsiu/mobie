# Architecture — pokemon-mezastar

iPad-first, personal-use **Pokémon Mezastar-style** game. Web/PWA, runs in iPad Safari
(iPhone-compatible). This document describes the system's structure and the invariants a
contributor must respect. Milestone/design rationale lives in [`plan/`](plan/) — this file
does not repeat it.

> Source-of-truth map: high-level design `plan/README.md`; architecture/data-model/state-machine
> `plan/01-architecture.md`; battle reference (damage/type/crit/speed) `plan/06-battle-reference.md`;
> accidents + individuality/growth `plan/07-systems-design.md`; live onboarding `handoff.md`.

## 1. Tech stack

- **React 18** + **Vite 6** + **TypeScript** (strict, `noUnusedLocals/Parameters`, `noEmit`).
- **XState 5** (`@xstate/react`) — high-level screen flow only.
- **Zustand 5** — battle display state and persistent roster store.
- **framer-motion** — UI/battle animation; **Tone.js** — procedural audio (dynamic-imported on first touch).
- **Vitest** — unit tests (`environment: node`). Package manager: **npm** (not pnpm).
- Path alias `@/* → src/*` (configured in both `vite.config.ts` and `tsconfig.json`).
- **Lazy-loaded heavies** (dynamic-imported so they stay out of the ~408 KB main bundle): `three` /
  `@react-three/fiber` / `@react-three/drei` (3D, M3), `jsqr` (QR scan, M2), `qrcode` (QR gen, M2),
  `tone` (audio), `fflate` (save-file zip, M5).

## 2. Layered structure (`src/`)

```
app/        App shell + GameProvider (XState machine context via React context)
game/       Pure domain logic (no React). The testable core.
  data/     Seed/generated data + type chart + region lookup
  battle/   Pure battle engine + reducer + fixtures + tests
  machine/  XState gameMachine (screen flow)
  save/     Portable save file (M5): envelope meta, zip pack/unpack, export/import I/O, backup slot
  cardCode/cardsImport/cardLibrary   QR card-code parse + import + IndexedDB card store (M2)
store/      Zustand stores (battleStore display-state, rosterStore persistence)
ui/         React screens + components + global.css + type metadata
audio/      Tone.js audio engine (lazy)
scene/fx/   Canvas particle/flash FX (imperative handle, off React state)
scene/r3f/  React-three-fiber 3D battle/capture stage (M3, lazy three)
scene/models/  User drop-in GLB store (IndexedDB) + normalize (M3)
input/      QTE seam (qualityFromPointer / zones)
```

**Dependency direction:** `ui → store → game`. `game/` never imports React/UI. Keeping domain
logic pure is what makes the battle system testable (122 tests) and the animation layer swappable.

## 3. Screen flow (XState — `game/machine/gameMachine.ts`)

```
title → regionSelect → encounter → cardSelect → battle → result
                ↑__________________________________________|
        (result: PLAY_AGAIN rerolls foes → encounter; TO_REGIONS → regionSelect)
```

- The machine only carries `regionId`, `foeTeam` (3 Cards, last = boss/capture target),
  `playerTeam` (3 Cards), `outcome`, `captured`. **It does not run the battle** — turn/HP/QTE/switch
  are handled by `battleStore` + the pure reducer.
- `SELECT_REGION { regionId }` rolls foes via `rollEncounterTeam`. Region id `'practice'` resolves
  through `data/regionLookup.lookupRegion` to the hand-authored `data/practiceRegion.ts` (low-level,
  no legendary boss) — so the practice mode reuses the entire normal flow with no special-casing.

## 4. Data model (`game/types.ts`)

- **`Species`** — national-dex entry (types, base stats, single `moveId`, PokéAPI artwork URL).
- **`Card`** — a battle entry (speciesId + level, optional ivs/nature/shiny). Sourced from local
  `playerCards`, scanned QR codes (M2), or imported save files (M5).
- **`OwnedUnit`** — the **only persisted, canonical** shape (id, speciesId, level, exp, ivs, nature,
  seed, shiny). Derived battle numbers are never persisted.
- **`BattlePokemon`** — fully-resolved battle instance, computed by `stats.buildBattlePokemon(card)`.

**Determinism:** `game/individual.rollIndividual(seed)` derives ivs/nature/shiny from a seeded RNG
(FNV-1a hash → mulberry32). The seed is the `cardId`, so the same card always yields the same
individual — wild encounters, captures, and re-renders stay consistent without storing intermediate state.

## 5. Battle architecture (the important part)

Two halves, deliberately separated:

1. **Pure reducer — `game/battle/reducer.ts`** (no UI/animation vocabulary).
   `resolveTurn(state, action, { rng }) → { nextState, events }` resolves a *whole turn at once*
   (player action + foe response, speed order, forced switches on faint, win/lose) and emits ordered
   **domain events** (`damageApplied`, `memberFainted`, `activeChanged`, `switchDefenseResolved`,
   `battleEnded`, `random`). `engine.ts` holds the formulas (`resolveAttack`, QTE/defense multipliers,
   crit/accuracy, ball/capture, charge tier, `playerActsFirst`).
   - **Turn cap:** `MAX_TURNS = 30`. If a turn resolves with no natural winner past the cap, the winner
     is decided by remaining team-HP fraction (ties favor the player) and a `battleEnded{reason:'timeout'}`
     event is emitted — guards against type-immunity stalemates.
2. **Animation/display layer — `ui/screens/BattleScreen.tsx` + `store/battleStore.ts`.**
   BattleScreen calls `resolveTurn` (computing the full turn), then **consumes the event queue one by
   one**, driving framer-motion + FxCanvas + audio, and writing display HP/active via `battleStore`.
   Final `setBattle(nextState)` snaps turn/winner. The reducer stays pure; all "play it out slowly"
   logic is here.

**Performance red-line:** high-frequency values (QTE pointer position, future MediaPipe coords) go
through refs/rAF/DOM or Zustand — **never** React top-level state. See `TimingBar`, `MashMeter`, `FxCanvas`.

## 6. Persistence & progression

- **`game/persistence.ts`** — `PersistenceAdapter` interface; `LocalStorageAdapter` (key `mz.roster.v2`)
  serializes only canonical `OwnedUnit[]`. `MemoryAdapter` for tests.
- **`store/rosterStore.ts`** — `load`, `grantBattleExp(unitIds, foeLevels, ratio)` (win = full,
  loss ≈ 0.15), `captureUnit(card)` (builds a canonical unit from the captured boss and persists it),
  `replaceAll(units)` (whole-roster replace used by save import).
- **`game/growth.ts`** — Medium-Fast `n³` exp curve, `applyExp`, `createOwnedUnit`, `ownedToCard`.
- **`game/recommend.ts`** — pure team-selection scoring vs the *whole* foe team (offense type
  effectiveness minus defensive risk + level/stat tiebreak); powers the card-select badges and
  one-tap "recommend team".

**Storage map (all client-side, no backend):** `mz.roster.v2` (localStorage, canonical roster) ·
`mz-cards` (IndexedDB card library, seeded from `playerCards`, M2) · `mz-models` (IndexedDB GLB
blobs, M3) · `mz.savemeta.v1` (localStorage save envelope meta, M5) · `mz-save-backup` (IndexedDB
single-slot pre-import backup, M5).

### 6.1 Portable save files (M5 — `game/save/`)

User-owned, **file-based export/import** — *not* cloud sync with a backend (the "cloud" is the user's
own Drive/Files via the OS share sheet). The original backend design in `plan/08-cloud-sync.md` was
deliberately dropped: zero backend, zero secret, zero vendor.

- **`saveMeta.ts`** — envelope meta (`schemaVersion`/`profileName`/`updatedAt`/`revision`) in
  `mz.savemeta.v1`; bumped on every progress write. Pure `compareSaves` (newer/older/same) drives
  import old/new detection. `adoptMeta` locks lineage after an import.
- **`bundle.ts`** — pure `packSave`/`unpackSave`. A `.save` is a **zip**: `manifest.json` +
  `roster.json` + `cards.json` + optional `models/<speciesId>.glb`, with a **crc32 payload checksum**
  and classified unpack errors (`not-zip`/`no-manifest`/`bad-manifest`/`schema-too-new`/`bad-payload`/
  `checksum-mismatch`, mirroring `cardCode.ts`).
- **`saveIO.ts`** — wires the pure codec to store I/O + browser delivery. Export prefers
  `navigator.share` (iPad share sheet → Drive/Files), falling back to `<a download>`. Import does a
  **whole-save replace** (roster → cards → optional models → `adoptMeta`) after auto-backing-up.
- **`backupStore.ts`** — IndexedDB single-slot backup written *before* any overwrite; restorable
  one-tap. Backs up roster+cards (not models — those are re-importable drop-ins).

UI: `SaveManagerModal` (Title "☁️ 存檔" entry, lazy so `fflate` stays out of the main bundle). New/old
judgement is **semi-automatic** — a comparison table is always shown and an older-save overwrite
requires explicit consent; no field-level merge (whole-save replace + backup). Correctness was
cross-validated by an independent **5-agent blind interop test** (both pack and unpack directions,
byte-level fidelity incl. binary models) — see the M5 commits.

## 7. Content generation (do not hand-edit generated files)

`scripts/gen_dex.mjs` pulls from **PokéAPI** (zh-Hant names, types, base stats; cached, concurrent,
retrying) and regenerates `game/data/{species,moves,regions,playerCards}.ts`. Run `node scripts/gen_dex.mjs`
to rebuild. **These four files are generated — change the generator, not the output.**
`game/data/practiceRegion.ts` is the exception: hand-authored, not produced by the generator.

## 8. Asset / IP policy (hard constraint)

The repo **does not bundle, fetch, or distribute infringing assets**. Artwork uses official PokéAPI
raw URLs loaded at runtime (with skeleton fallback). Audio is fully procedural (Tone.js). 3D models are
user drop-in only (`public/models/` is gitignored). See `uninstall.txt` for the responsibility framing.

## 9. Known gotchas

- `vite.config.ts` is intentionally **excluded from `tsconfig.json` `include`** (avoids node:url /
  vitest `test`-field type errors; it is esbuild-transpiled at runtime).
- iOS Safari needs a **first-touch AudioContext unlock**; Tone.js is dynamic-imported at unlock time
  to keep the bundle lean.
- The app is `localhost`-bound in dev. For real iPad testing run `vite --host` and open the Mac's LAN
  IP from iPad Safari, or build static files and install as a PWA.

## 10. Testing & verification

- `npm test` (Vitest) — domain logic: type chart, individuality, growth, engine, reducer (incl. turn
  cap), accidents, recommend, card-code/import, roster sanitize, **save meta `compareSaves` + bundle
  pack/unpack round-trip & corruption classification**. **122 tests.**
- `npm run typecheck` / `npm run build` must stay green.
- No Playwright/chromium-cli installed. Visual/E2E verification uses local Google Chrome via
  `--headless=new --remote-debugging-port=9222` + a Node CDP script (buttons via `el.click()`, QTE via
  dispatched `PointerEvent('pointerdown')`; file inputs via `DOM.setFileInputFiles`, downloads via
  `Browser.setDownloadBehavior`). Screenshots land in `/tmp/mz_shots/` (volatile).
