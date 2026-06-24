# Architecture — mobie

iPad-first, personal-use **Pokémon Mezastar-style** game. Web/PWA, runs in iPad Safari
(iPhone-compatible). This document describes the system's structure and the invariants a
contributor must respect. Milestone/design rationale lives in [`plan/`](plan/) — this file
does not repeat it.

> Source-of-truth map: high-level design `plan/README.md`; architecture/data-model/state-machine
> `plan/01-architecture.md`; battle reference (damage/type/crit/speed) `plan/06-battle-reference.md`;
> accidents + individuality/growth `plan/07-systems-design.md`; extension systems + seam design
> `plan/09-extension-systems.md` (§0) and `plan/10-extension-systems-wave2.md`; milestone re-numbering
> `plan/14-roadmap-m6-m13.md`; live onboarding `handoff.md`.

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
  ext/      Extension seams (S1–S8) + optional modules: synergy/items/abilities + shared statPatch (M6/M7)
  machine/  XState gameMachine (screen flow)
  save/     Portable save file (M5): envelope meta, zip pack/unpack, export/import I/O, backup slot
  settings.ts  Per-system module toggle slice (mz.settings.v1, M6)
  cardCode/cardsImport/cardLibrary   QR card-code parse + import + IndexedDB card store (M2)
store/      Zustand: battleStore (display), rosterStore (persistence), settingsStore + ext (assemble
            extension hooks), bagStore (item bag mz.itembag.v1, M7)
ui/         React screens + components + global.css + type metadata
audio/      Tone.js audio engine (lazy)
scene/fx/   Canvas particle/flash FX (imperative handle, off React state)
scene/r3f/  React-three-fiber 3D battle/capture stage (M3, lazy three)
scene/models/  User drop-in GLB store (IndexedDB) + normalize (M3)
input/      QTE seam (qualityFromPointer / zones)
```

**Dependency direction:** `ui → store → game`. `game/` never imports React/UI. Extension modules
(`game/ext/`) are pure data + pure hook functions; `store/ext.ts` is the *only* place that knows
which modules are enabled (it reads `settings` and assembles the injected hooks). Keeping domain logic
pure is what makes the battle system testable (428 tests) and the animation layer swappable.

## 3. Screen flow (XState — `game/machine/gameMachine.ts`)

```
title → regionSelect → encounter → cardSelect → battle → result
   ↑            ↑  ↘ OPEN_TOWER → towerSetup → battle ↗        |
   |  BACK      |___________________________________________|
   (result: PLAY_AGAIN rerolls foes → encounter; TO_REGIONS → regionSelect)
```

- The machine only carries `regionId`, `foeTeam` (3 Cards, last = boss/capture target),
  `playerTeam` (3 Cards), `outcome`, `captured`, and the M11 `tower` run. **It does not run the
  battle** — turn/HP/QTE/switch are handled by `battleStore` + the pure reducer.
- **Hub + tools (mid-game access):** `title` and `regionSelect` both render the shared
  `ui/components/ToolsMenu` (scan / library / team / moves / partner skills / dex / achievements /
  incubator / 3D models / save / settings — all lazy-loaded modals), so every tool stays reachable
  after the game starts, not just from the title. `regionSelect` adds `BACK → title` (a 🏠 button);
  it is the in-game hub returned to after each result.
- `SELECT_REGION { regionId }` rolls foes via `rollEncounterTeam`. The arena (id `'practice'`) resolves
  through `data/regionLookup.lookupRegion` to the hand-authored `data/practiceRegion.ts` — so it reuses
  the entire normal flow with no special-casing.
- **Mode contract (M6):** `Region.mode` is `'arena' | 'wild'` (not a UI label). Capture eligibility is
  centralized in `data/regionLookup.canCaptureIn(id)` (`mode === 'wild'`). The arena is neutral-terrain,
  no-capture, EXP-only (→ `ArenaWinView`); wild regions allow capturing the boss (→ `WinView`). The
  result screen branches on `canCaptureIn`, so no battle-temporary capture flags leak onto `OwnedUnit`.

## 4. Data model (`game/types.ts`)

- **`Species`** — national-dex entry (types, base stats, `moveId` = slot-0 star-strike identity,
  plus the M19 `learnset` / `teachableMoveIds`, PokéAPI artwork URL).
- **`Card`** — a battle entry (speciesId + level, optional ivs/nature/shiny). Sourced from local
  `playerCards`, scanned QR codes (M2), or imported save files (M5).
- **`OwnedUnit`** — the **only persisted, canonical** shape (id, speciesId, level, exp, ivs, nature,
  seed, shiny, optional `heldItemId` [M7], and M19 `learnedMoveIds` / `equippedMoveIds`). Derived
  battle numbers are never persisted.
- **`BattleMobie`** — fully-resolved battle instance, computed by `stats.buildBattleMobie(card)`.
  Holds the resolved `moves[]` loadout (≤4; `move` = slot-0 kept for back-compat, M19) and
  battle-transient extension fields (`heldItemId` from the card, `abilityId` assigned by the abilities
  module's S1 hook); these are never persisted and are absent when a module is off. The read-only
  `MobCard` detail view (M16) renders one of these — in battle it reads the live, prep-applied member;
  outside battle (the Team modal) it builds a fresh one from an `OwnedUnit` for an owner-full view.
- **`Region.mode`** — `'arena' | 'wild'` (M6 mode contract, see §3).

**Determinism:** `game/individual.rollIndividual(seed)` derives ivs/nature/shiny from a seeded RNG
(FNV-1a hash → mulberry32). The seed is the `cardId`, so the same card always yields the same
individual — wild encounters, captures, and re-renders stay consistent without storing intermediate state.

## 5. Battle architecture (the important part)

Two halves, deliberately separated:

1. **Pure reducer — `game/battle/reducer.ts`** (no UI/animation vocabulary).
   `resolveTurn(state, action, { rng, ext }) → { nextState, events }` resolves a *whole turn at once*
   (player action + foe response, speed order, forced switches on faint, win/lose) and emits ordered
   **domain events** (`damageApplied`, `memberFainted`, `heal`, `activeChanged`, `switchDefenseResolved`,
   `battleEnded`, `random`). `engine.ts` holds the formulas (`resolveAttack`, QTE/defense multipliers,
   crit/accuracy, ball/capture, charge tier, `playerActsFirst`).
   - `ext` is an injected **pure capability bundle** (like `rng`) — the reducer never imports modules
     and never knows the words "item"/"ability". Default `EMPTY_EXT` ⇒ behavior identical to M1.x. See §6.
   - **Multi-move (M19):** `ATTACK` carries an additive `slotIndex`; the reducer resolves it against the
     immutable battle loadout and writes the chosen `resolvedMoveId` back into the event. It is still
     **one `ATTACK` action per turn** (no new phase); identity is the single star-strike finisher; status
     moves write `fieldState` via the M7 S1/S3/S4 seams. Missing `slotIndex` ⇒ slot 0 (back-compat).
   - **Turn cap:** `MAX_TURNS = 30`. If a turn resolves with no natural winner past the cap, the winner
     is decided by remaining team-HP fraction (ties favor the player) and a `battleEnded{reason:'timeout'}`
     event is emitted — guards against type-immunity stalemates.
2. **Animation/display layer — `ui/screens/BattleScreen.tsx` + `store/battleStore.ts`.**
   BattleScreen calls `resolveTurn` (computing the full turn), then **consumes the event queue one by
   one**, driving framer-motion + FxCanvas + audio, and writing display HP/active via `battleStore`.
   Final `setBattle(nextState)` snaps turn/winner. The reducer stays pure; all "play it out slowly"
   logic is here. The move picker stays in the bottom strip, but timing-critical inputs (attack QTE,
   mash-charge, defense/chain QTE) render in a centered `.battle-action` overlay so they sit in the
   battle area, not pinned to the screen bottom. (Centering uses a full-bleed flex layer, **not** a CSS
   `translate(-50%,-50%)` — framer-motion writes its own `transform` for the scale/opacity entrance and
   would clobber a translate-based centering.)

**Performance red-line:** high-frequency values (QTE pointer position, future MediaPipe coords) go
through refs/rAF/DOM or Zustand — **never** React top-level state. See `TimingBar`, `MashMeter`, `FxCanvas`.

## 6. Extension system (optional modules via seams — M6 / M7)

Optional gameplay systems (held items, team synergy, abilities, chain, evolution) are
**not** if/else'd into the core. The core defines fixed **seams (S1–S8)**; a module registers only the
seams it uses. **Disabled = not registered = zero residue** (the core loop is byte-for-byte M1.x).
Design source: `plan/09-extension-systems.md` §0; the seam definitions live in `game/ext/seams.ts`.
`ModuleId` lists toggleable modules — `synergy / heldItems / abilities / chain / combo / evolution`
(seam-registered; **`combo`** = M12.d 合體技, a chain-upgrade riding an injected `ext.combo` capability) plus
`partnerSkills` (M17) and `encounterSkills` (M12.e, deterministic foe tags applied as a display-layer foe stat
patch) — the last two are display-layer/fieldState gates, **not** in `MODULE_REGISTRY`.
**The tower (M11) is a game *mode* entered from `regionSelect`, not a settings toggle**, so it is not a
`ModuleId` — an earlier dead "tower" toggle that read "coming soon" was removed.

| Seam | Where it runs | Purity | Used by |
|---|---|---|---|
| **S1 `buildUnit`** | after `buildBattleMobie` (battle init) | `unit → unit` | items (statMod), abilities (statMod + writes `abilityId`) |
| **S2 `preBattleModifiers`** | battle init / team change (once) | `team → NamedModifier[]` | synergy |
| **S3 `damageHook`** | mid-`resolveAttack` | `ctx → multiplier` | items (life orb / expert belt), abilities (pinch / guard) |
| **S4 `turnEndTrigger`** | end-of-turn sync phase (before MAX_TURNS judging) | `state → events` | items (leftovers heal → `heal` event) |
| S5 `chainResolve` / S6 `postGrowth` / S7 `gameMode` / S8 `saveSlice` | — | — | reserved for M9–M11 |

**Two injection paths** (assembled in `store/ext.ts`, the only layer that reads `settings`):

- **`ExtBundle`** (S3/S4/S5) is passed to `resolveTurn(…, { rng, ext })`. Built by `assembleExt(settings)`.
  Hooks read battle-transient `heldItemId`/`abilityId` off the `BattleMobie` and self-filter — one
  static hook per module, no per-unit closures.
- **`BattlePrep`** (S1/S2) is applied at battle init by `applyBattlePrep(team, prep, withSynergy)`
  (built by `assembleBattlePrep(settings)`). `BattleScreen` applies it to the player team (synergy on)
  and the foe team (synergy off; abilities still apply since they're species-based).

**Modules** (`game/ext/`, hand-authored data — no PokéAPI, emoji icons, zero IP):
- `synergy.ts` — `computeSynergy(team)` pure function + rules (diverse / kinship / generation); each
  modifier carries `label/source/icon` (no hidden buffs). Player team only.
- `items.ts` — `ItemDef` table, three effect kinds: `statMod` (S1) / `damageHook` (S3) / `turnEnd`
  (S4 leftovers). Bag inventory is the separate `mz.itembag.v1` slice (`store/bagStore.ts`,
  exactly-once equip accounting); `OwnedUnit.heldItemId` is the canonical equip.
- `abilities.ts` — `AbilityDef` + **deterministic assignment by primary type** (`abilityForType`, no
  generated-file edit, no network); kinds `statMod`/`pinch`/`guard`. Applies to both sides.
- `statPatch.ts` — shared `scale`/`applyStatMod`/`createLookup` used by the three modules.

The reducer/engine were **not** modified for M7 beyond an additive `heal` `BattleEvent` variant.
Settings live in `mz.settings.v1` (`game/settings.ts`, default all-off, separate namespace — does not
violate "persist only canonical roster"). `MODULE_REGISTRY` (`store/ext.ts`) lists registered modules.
**Deferred** (would touch engine/reducer): focus-sash style lethal-intercept `onceTrigger` (needs a
post-damage seam) and Intimidate-style `onSwitchIn` (needs a switch-resolution seam).

UI: `SettingsModal` (Title "⚙️ 設定", per-system toggles) and `TeamModal` (Title "🎒 隊伍", equip items /
view abilities); battle plate shows ability + item badges; synergy tags show in card-select and a battle
opening banner.

## 7. Persistence & progression

- **`game/persistence.ts`** — `PersistenceAdapter` interface; `LocalStorageAdapter` (key `mz.roster.v2`)
  serializes only canonical `OwnedUnit[]`. `MemoryAdapter` for tests.
- **`store/rosterStore.ts`** — `load`, `grantBattleExp(unitIds, foeLevels, ratio)` (win = full,
  loss ≈ 0.15), `captureUnit(card)` (builds a canonical unit from the captured boss and persists it),
  `replaceAll(units)` (whole-roster replace used by save import).
- **`game/growth.ts`** — Medium-Fast `n³` exp curve, `applyExp`, `createOwnedUnit`, `ownedToCard`.
- **`game/recommend.ts`** — pure team-selection scoring vs the *whole* foe team (offense type
  effectiveness minus defensive risk + level/stat tiebreak); powers the card-select badges and
  one-tap "recommend team".

**Storage map (all client-side, no backend):** `mz.roster.v2` (localStorage, canonical roster, incl.
`heldItemId`) · `mz-cards` (IndexedDB card library, seeded from `playerCards`, M2) · `mz-models`
(IndexedDB GLB blobs, M3) · `mz.savemeta.v1` (localStorage save envelope meta, M5) · `mz-save-backup`
(IndexedDB single-slot pre-import backup, M5) · `mz.settings.v1` (localStorage module toggles, M6) ·
`mz.itembag.v1` (localStorage item bag, M7) · `mz-replays` (IndexedDB, M14 battle replays — canonical
`encodeReplay` JSON only, `battleId`-deduped, FIFO-capped 50). The portable save bundles the roster (so
`heldItemId` travels with it); the item-bag slice is not yet included in the `.save` (a known follow-up).

### 7.2 Battle replay (M14 — `game/replay/`, `store/replayRecorder.ts`)

Canonical = a structured JSON log (`ReplayLog`: header with `battleSeed`/`DisplayUnitSnapshot[]` + ordered
`BattleEvent[]` per turn). **The reducer/engine are untouched** — replay reuses the events the reducer
already emits. `game/rng.ts` (M14.0; `hashSeed`/`mulberry32`/`makeRng`) gives each battle one seeded RNG
stream so a recorded log can be re-simulated. `codec.ts` does stable-key-order `encodeReplay` + strict
`decodeReplay` (classified errors + crc, mirroring `save/bundle.ts`); `KNOWN_EVENT_MAP` is a
`Record<BattleEvent['type'], true>` so a new event variant **fails to compile** until the codec, the
`report.ts` projector (one Chinese handler per variant), and `REPLAY_FORMAT_VERSION` + `migrateReplay` are
all updated — plan/15 §10 coupling-governance made mechanical (M12.d's `comboCast` bumped it to v2).
`ReplayRecorder` collects turns single-point in `BattleScreen` (gated by `prefs.recordReplays`, default
off); `ReplayPlayerModal` re-folds the event stream to reconstruct HP/active with a synced text-report
sidebar. **No `.txt` is persisted** — it's a pure projection generated on export.

### 7.1 Portable save files (M5 — `game/save/`)

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

## 8. Content generation (do not hand-edit generated files)

`scripts/gen_dex.mjs` pulls from **PokéAPI** (zh-Hant names, types, base stats; cached, concurrent,
retrying) and regenerates `game/data/{species,moves,regions,playerCards}.ts`. Run `node scripts/gen_dex.mjs`
to rebuild. **These four files are generated — change the generator, not the output.**
`game/data/practiceRegion.ts` is the exception: hand-authored, not produced by the generator.

## 9. Asset / IP policy (hard constraint)

The repo **does not bundle, fetch, or distribute infringing assets**. Artwork uses official PokéAPI
raw URLs loaded at runtime (with skeleton fallback). Audio is fully procedural (Tone.js). 3D models are
user drop-in only (`public/models/` is gitignored). See `uninstall.txt` for the responsibility framing.

## 10. Known gotchas

- `vite.config.ts` is intentionally **excluded from `tsconfig.json` `include`** (avoids node:url /
  vitest `test`-field type errors; it is esbuild-transpiled at runtime).
- iOS Safari needs a **first-touch AudioContext unlock**; Tone.js is dynamic-imported at unlock time
  to keep the bundle lean.
- The app is `localhost`-bound in dev. For real iPad testing run `vite --host` and open the Mac's LAN
  IP from iPad Safari, or build static files and install as a PWA.
- **framer-motion clobbers CSS `transform`:** a `motion.*` element that animates `scale`/`y` writes its
  own inline `transform`, overriding any CSS `transform: translate(-50%, …)` used for centering — the
  element drifts off-center. Center such overlays with a flex layer instead (see `.battle-action-layer`).
  Four older battle overlays (`star-orb`, `battle-banner`, `support-overlay`, `combo-overlay`) still use
  translate-based centering under scale animation and may drift slightly — a known follow-up.

## 11. Testing & verification

- `npm test` (Vitest) — **428 tests.** Domain logic (type chart, individuality, growth, engine,
  reducer incl. turn cap, accidents, recommend, card-code/import, roster sanitize, save meta
  `compareSaves` + bundle round-trip & corruption classification) plus the M6/M7 extension suites
  (ext/settings, synergy, items, abilities, held-item persistence) and the project-wide verification
  pass: **`data/dataIntegrity.test.ts`** (all 1025 species/moves/regions/cards/type-chart swept) and
  **`battle/simulation.test.ts`** (hundreds of full seeded battles asserting HP bounds / no-NaN /
  always-terminates / determinism, modules off vs all-on).
- `npm run typecheck` / `npm run build` must stay green.
- No Playwright/chromium-cli installed. Visual/E2E verification uses local Google Chrome via
  `--headless=new --remote-debugging-port=9222` + a Node CDP script (buttons via `el.click()`, QTE via
  dispatched `PointerEvent('pointerdown')`; file inputs via `DOM.setFileInputFiles`, downloads via
  `Browser.setDownloadBehavior`). **Battle screens need software WebGL** — add `--use-gl=angle
  --use-angle=swiftshader --enable-unsafe-swiftshader` (Chrome 149+ dropped the automatic SwiftShader
  fallback, so R3F's `BattleStage` fails to get a GL context without these). Screenshots land in
  `/tmp/mz_shots/` (volatile).
