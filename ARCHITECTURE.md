# Architecture — mobie

iPad-first, personal-use **Pokémon Mezastar-style** game. Web/PWA, runs in iPad Safari
(iPhone-compatible). This document describes the system's structure and the invariants a
contributor must respect. Existing tracked milestone/design rationale lives in [`plan/`](plan/) —
this file does not repeat it. Locally generated agent specs/tickets under `plan/` are intentionally
gitignored; that workflow does not alter the authority of documents already tracked there.

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
- **Vitest** — unit tests (`environment: node`) plus opt-in `jsdom` semantic UI journeys. Package
  manager: **npm** (not pnpm).
- Path alias `@/* → src/*` (configured in both `vite.config.ts` and `tsconfig.json`).
- **Lazy-loaded heavies** (dynamic-imported so they stay out of the main bundle): `three` /
  `@react-three/fiber` / `@react-three/drei`, `qrcode`, `tone`, and `fflate`. The dormant M23 Scanner
  source still references `jsqr`, but no reachable import edge or production Scanner chunk exists.

## 2. Layered structure (`src/`)

```
app/        App shell + GameProvider (XState machine context via React context)
game/       Pure domain logic (no React). The testable core.
  data/     Seed/generated data + type chart + region lookup
  battle/   Pure battle engine + reducer + fixtures + tests
  ext/      Extension seams + fixed productRuntime: synergy/items/abilities/chain/combo/evolution
  machine/  XState gameMachine (screen flow)
  save/     Portable save file (M5): envelope meta, zip pack/unpack, export/import I/O, backup slot
  settings.ts  Runtime UX preferences + read-only legacy v1 module-data preservation
  cardCode/cardsImport/cardLibrary   QR card-code parse + import + IndexedDB card store (M2)
store/      Zustand: battleStore (display), rosterStore (persistence), prefs-only settingsStore,
            bagStore (item bag mz.itembag.v1, M7)
ui/         React screens + components + global.css + type metadata
audio/      Tone.js audio engine (lazy)
scene/fx/   Canvas particle/flash FX (imperative handle, off React state)
scene/battle/ Three-free renderer contracts + host, DOM compatibility adapter, provisional next entry
scene/r3f/  React-three-fiber 3D battle/capture stage (M3, lazy three)
scene/models/  Legacy custom-model tooling; Battle/Capture never import or read it
input/      QTE seam (qualityFromPointer / zones)
```

**Dependency direction:** `ui → presentation/store → game`; battleStore implements the presentation
transaction seam and may import its pure contracts/runtime identity helpers. `presentation/battle` and
`game/` never import React, scene, or UI. Extension modules are pure data + pure hook functions;
`game/ext/productRuntime.ts` permanently composes mature battle capabilities behind one interface.
Writable settings never participate in gameplay assembly. Keeping domain logic pure makes the battle
system testable and the animation layer swappable. `scene/battle/host/BattleSceneHost.tsx` is the only
battle-route dynamic Three entry; main, presentation, DOM boot, and compatibility graphs are Three-free.

## 3. Screen flow (XState — `game/machine/gameMachine.ts`)

```
title → regionSelect → encounter → cardSelect → battle → result
   ↑            ↑  ↘ OPEN_TOWER → towerSetup → battle ↗        |
   |  BACK      |___________________________________________|
   (result: PLAY_AGAIN rerolls foes → encounter; TO_REGIONS → regionSelect)
```

- The machine only carries `regionId`, `foeTeam` (3 Cards; `game/hunt.captureTargetOf` defines the
  final member as the featured boss/capture target),
  `playerTeam` (3 Cards), `outcome`, `captured`, and the M11 `tower` run. **It does not run the
  battle** — turn/HP/QTE/switch are handled by `battleStore` + the pure reducer.
- `ABORT_BATTLE` is the non-result exit from battle: it targets `regionSelect`, clears encounter/tower
  runtime through `resetEncounter`, and never records an outcome or result handoff.
- **Hub + tools (mid-game access):** `title` and `regionSelect` both render the shared
  `ui/components/ToolsMenu`. Its first level is deliberately limited to **我的 Mobie** and **更多**;
  the latter opens a scrollable secondary menu for library / moves / partner skills / dex /
  achievements / incubator / 3D models / save / settings (all lazy-loaded). Every utility therefore
  remains reachable without flattening it into the primary hunt loop. `regionSelect` adds
  `BACK → title` (a 🏠 button); it is the in-game hub returned to after each result.
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
  battle-transient extension fields (`heldItemId` from the card, `abilityId` assigned by the fixed
  abilities S1 hook); these derived fields are never persisted. The read-only
  `MobCard` detail view (M16) renders one of these — in battle it reads the live, prep-applied member;
  outside battle (the **我的 Mobie** modal) it builds a fresh one from an `OwnedUnit` for an
  owner-full view through `game/ownedMobie.buildOwnedMobieForDisplay`, alongside canonical `n³` EXP
  progress from `game/growth.growthProgress`.
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
     and never knows the words "item"/"ability". Production always injects `PRODUCT_RUNTIME`; direct
     reducer compatibility tests may omit the bundle. See §6.
   - **Multi-move (M19):** `ATTACK` carries an additive `slotIndex`; the reducer resolves it against the
     immutable battle loadout and writes the chosen `resolvedMoveId` back into the event. It is still
     **one `ATTACK` action per turn** (no new phase); identity is the single star-strike finisher; status
     moves write `fieldState` via the M7 S1/S3/S4 seams. Missing `slotIndex` ⇒ slot 0 (back-compat).
   - **Turn cap:** `MAX_TURNS = 30`. If a turn resolves with no natural winner past the cap, the winner
     is decided by remaining team-HP fraction (ties favor the player) and a `battleEnded{reason:'timeout'}`
     event is emitted — guards against type-immunity stalemates.
2. **Presentation/display layer — `presentation/battle/` + `ui/screens/BattleScreen.tsx` adapters +
   `store/battleStore.ts`.** `BattleTurnCoordinator` is the only turn transaction owner for every
   `ReplayInput`: allocate a fenced token → resolve once → record once → compile/present ordered cues →
   atomically commit once. `compileBattleCues` and the Director do not import React, scene, or UI;
   BattleScreen only collects input and supplies legacy scene/HUD/audio/haptic ports. During playback,
   battleStore exposes a token-owned shadow for HP/active/feed while canonical `BattleState`, energy,
   lock, combo, phase, replay finish, and `END_BATTLE` remain unchanged until `commitTurn`. Its
   non-persisted runtime session owns the Web Crypto result identity pair, seeded RNG, replay recorder,
   and monotonic presentation counter across component remounts. Turn jobs and display-only intent jobs
   share one `BattleDirector` cancellation/degradation/reset seam. Intro and already-committed Partner
   results use separately tagged intent tokens, an immutable post-commit display snapshot, and an
   intent-only feed/banner shadow. The feed is a full-session `BattleFeedEntry[]`; producer-owned IDs
   combine the session identity, presentation ID, and cue/intent-local ID, so duplicate projection writes
   are idempotent and cancelled turns cannot leak entries. `BattleFeed` keeps visible latest/history
   separate from its one-shot live projection, so opening the drawer never re-announces or deletes data;
   `BattleIntentCoordinator` can only begin, fence, and complete that display projection, so it has no
   `BattleState`, energy, recorder, canonical turn commit, or `END_BATTLE` interface. Intro skip publishes
   one precomputed terrain/synergy feed safe point, while Partner usage and reveal/team-status mutation
   commit atomically in the runtime store before its result intent begins. The reducer stays pure.
   `BattleScreen` composes one renderer-independent DOM shell: a clipped stage containing the host/FX/HUD
   and a sibling command deck. Player choice, timing/mash/status/defense/chain/Star input, switch select,
   busy, and outcome states replace the same command body; the scene never owns focus. Pure
   `BattleActionModel` projections provide phase reasons and switch/resource legality, while semantic
   `ResourceAction`, `SwitchSheet`, `SideStatusRail`, and `FieldStatusBar` components keep actions and
   side/field ownership identical across Next and Compatibility renderers.

Battle lifecycle is split by authority. `battleStore` fences canonical session state with the full Web
Crypto identity pair, owns recoverable resolver/init errors, retires a session before Retry/Leave, and
rechecks the current session inside recorder publication. React-independent `BattleSessionLifecycle`
owns only volatile presentation/audio resources. `PausableScheduler` preserves remaining presentation
and input time while `document.hidden`; the Director, TimingBar, Mash, rhythm/hold, and shield inputs all
resume rather than auto-submit. `BattleAudioSession` is presentation-token-owned, while
`BattleBgmSession` is battle-session-owned across turns; old A cleanup cannot cancel or reset B. Retry
reuses the single battle initializer with `forceNew`, and Leave fences resources before `ABORT_BATTLE`.

Renderer lifecycle is a separate display-only seam. `BattleSceneHost` receives a storage-independent
`GraphicsPreference` (`auto`/missing → Balanced, explicit High capped at DPR 1.5, or Compatibility),
loads `NextBattleScene` explicitly, and exposes one stable `BattleSceneHandle` while swapping child
adapters. Data loading and renderer boot are observable DOM states; commands mount only after next or
compatibility readiness. Chunk rejection, 8-second readiness timeout, WebGL unsupported, shader fatal,
and context loss all latch compatibility in the non-persisted session. Late ready/restore events and
same-session remounts cannot upgrade it; Retry creates a fresh token and may probe again. The DOM
compatibility adapter reuses the same HUD, FxCanvas, WeatherCanvas, store projection, and coordinator,
so renderer changes never rerun resolver/input or duplicate canonical commit.

`BattleStage` owns the neutral world, lights, camera, and both combatant rigs in one R3F Canvas. Each rig
publishes root/center/head/ground/cast/impact world anchors; the stage projects them through the live camera,
with `presentation/battle/battleAnchors.ts` retained only as a pre-first-frame/compatibility fallback. Normal
damage cues drive anticipate/contact/hit-react/recover through the scene handle. A cue-owned camera queue
hands off caster and impact shots and automatically returns to wide; cancellation resets the queue. Reduced
motion keeps the same cue/anchor semantics while forcing a fixed wide camera and suppressing bob/shake/dolly.
Artwork billboards and named procedural silhouettes remain storage-independent and share the same rig.

`vite build` emits a manifest plus explicit `NextBattleScene`, `CaptureStage`, Three-vendor, and
compatibility categories. Rollup's explicit-only manual chunks keep Three out of the main and
compatibility static graphs. Legacy ModelManager/Save model chunks remain isolated Ticket 22 work and
are not dependencies of the battle/capture graphs.

**Performance red-line:** high-frequency values (QTE pointer position, future MediaPipe coords) go
through refs/rAF/DOM or Zustand — **never** React top-level state. See `TimingBar`, `MashMeter`, `FxCanvas`.

## 6. Fixed product extensions via pure seams

Held items, team synergy, abilities, chain, combo, evolution, and partner skills are permanent product
truth, not Settings toggles. The reducer remains unaware of feature names: it consumes pure S1–S6 seams,
while `game/ext/productRuntime.ts` privately composes every mature extension exactly once. Its small
interface exposes turn extensions, two-team preparation, player-synergy preview, and post-growth
application. `BattleScreen`, `CardSelectScreen`, baseline fixtures, simulations, and `rosterStore` all
cross that same seam.

Encounter styles are hard-off: there is no profile stat patch, `BattleMobie` tag field, renderer branch,
warning, or reachable DOM. Partner skills are governed only by learned-skill state, legal battle phase,
and the per-session usage ledger. The tower remains a game mode entered from `regionSelect`.

| Seam | Where it runs | Purity | Used by |
|---|---|---|---|
| **S1 `buildUnit`** | after `buildBattleMobie` (battle init) | `unit → unit` | items (statMod), abilities (statMod + writes `abilityId`) |
| **S2 `preBattleModifiers`** | battle init / team change (once) | `team → NamedModifier[]` | synergy |
| **S3 `damageHook`** | mid-`resolveAttack` | `ctx → multiplier` | items (life orb / expert belt), abilities (pinch / guard) |
| **S4 `turnEndTrigger`** | end-of-turn sync phase (before MAX_TURNS judging) | `state → events` | items (leftovers heal → `heal` event) |
| S5 `chainResolve` / combo | reducer chain submission | pure rules/matcher | chain + combo |
| S6 `postGrowth` | roster growth boundary | `unit → unit` | evolution |

The fixed runtime passes one `ExtBundle` to every production `resolveTurn`, prepares both teams together
(items/abilities on both, synergy on player only), and applies evolution inside `grantBattleExp`. Replay
snapshots and events therefore derive from the same prepared canonical battle rather than a second config.

**Modules** (`game/ext/`, hand-authored data — no PokéAPI, emoji icons, zero IP):
- `synergy.ts` — `computeSynergy(team)` pure function + rules (diverse / kinship / generation); each
  modifier carries `label/source/icon` (no hidden buffs). Player team only.
- `items.ts` — `ItemDef` table, three effect kinds: `statMod` (S1) / `damageHook` (S3) / `turnEnd`
  (S4 leftovers). Bag inventory is the separate `mz.itembag.v1` slice (`store/bagStore.ts`,
  exactly-once equip accounting); `OwnedUnit.heldItemId` is the canonical equip.
- `abilities.ts` — `AbilityDef` + **deterministic assignment by primary type** (`abilityForType`, no
  generated-file edit, no network); kinds `statMod`/`pinch`/`guard`. Applies to both sides.
- `statPatch.ts` — shared `scale`/`applyStatMod`/`createLookup` used by the three modules.

The reducer/engine remain pure; direct compatibility tests omit `ext`, while production always passes
the fixed product runtime. Runtime
`GameSettings` contains UX preferences only. Existing `mobie.settings.v1.modules` data is ignored by
runtime and preserved unchanged when prefs are written, so it remains rollback input without becoming
an interim schema or writable toggle. `SettingsModal` contains only real interaction, feedback, and
replay preferences; Team/Partner surfaces contain no module-off warnings.

## 7. Persistence & progression

- **`game/persistence.ts`** — `PersistenceAdapter` interface; `LocalStorageAdapter` (key `mz.roster.v2`)
  serializes only canonical `OwnedUnit[]`. `MemoryAdapter` for tests.
- **`store/rosterStore.ts`** — `load`, `grantBattleExp(unitIds, foeLevels, ratio)` (win = full,
  loss ≈ 0.15), `captureUnit(card)` (builds a canonical unit from the captured boss and persists it),
  `replaceAll(units)` (whole-roster replace used by save import).
- **`game/growth.ts`** — Medium-Fast `n³` exp curve, `applyExp`, `createOwnedUnit`, `ownedToCard`.
- **`game/recommend.ts`** — pure team-selection scoring vs the *whole* foe team (offense type
  effectiveness minus defensive risk + level/stat tiebreak); powers advisory badges and the revealed
  recommended trio. Advice never mutates selection: the player still chooses and orders the team.

**Storage map (all client-side, no backend):** `mz.roster.v2` (localStorage, canonical roster, incl.
`heldItemId`) · `mz-cards` (IndexedDB card library, seeded from `playerCards`, M2) · `mz-models`
(IndexedDB GLB blobs, M3) · `mz.savemeta.v1` (localStorage save envelope meta, M5) · `mz-save-backup`
(IndexedDB single-slot pre-import backup, M5) · `mobie.settings.v1` (runtime prefs plus untouched legacy
`modules` rollback data) ·
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
`ReplayRecorder` is owned by the non-persisted battle runtime session and is called exactly once by
`BattleTurnCoordinator` (gated by `prefs.recordReplays`, default off); recording failure disables only
that session's replay and never reruns the reducer. `ReplayPlayerModal` re-folds the event stream to
reconstruct HP/active with a synced text-report sidebar. **No `.txt` is persisted** — it's a pure
projection generated on export.

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
raw URLs loaded at runtime (with skeleton fallback). Audio is fully procedural (Tone.js). Battle and
Capture combatants are artwork billboards and never read GLB/GLTF or custom model storage. Legacy model
tooling remains isolated from those runtime chunks pending its separately owned retirement ticket.

## 10. Known gotchas

- `vite.config.ts` is intentionally **excluded from `tsconfig.json` `include`** (avoids node:url /
  vitest `test`-field type errors; it is esbuild-transpiled at runtime).
- iOS Safari needs a **first-touch AudioContext unlock**; Tone.js is dynamic-imported at unlock time
  to keep the bundle lean.
- The app is `localhost`-bound in dev. For real iPad testing run `vite --host` and open the Mac's LAN
  IP from iPad Safari, or build static files and install as a PWA.
- **framer-motion clobbers CSS `transform`:** a `motion.*` element that animates `scale`/`y` writes its
  own inline `transform`, overriding any CSS `transform: translate(-50%, …)` used for centering — the
  element drifts off-center. Center cinematic overlays with a separate full-bleed flex layer instead;
  `battle-banner`, `support-overlay`, `combo-overlay`, and the Star cut-in already follow this pattern.

## 11. Testing & verification

- `npm test` (Vitest) covers domain logic (type chart, individuality, growth, engine,
  reducer incl. turn cap, accidents, recommend, card-code/import, roster sanitize, save meta
  `compareSaves` + bundle round-trip & corruption classification) plus the M6/M7 extension suites
  (ext/settings, synergy, items, abilities, held-item persistence) and the project-wide verification
  pass: **`data/dataIntegrity.test.ts`** (all 1025 species/moves/regions/cards/type-chart swept) and
  **`battle/simulation.test.ts`** (hundreds of full seeded battles asserting HP bounds / no-NaN /
  always-terminates / determinism under the fixed product runtime), plus `jsdom` semantic journeys for the
  title/hub, owned-Mobie details, hunt target/advice/order, real battle decisions, and capture results.
- `npm run typecheck` / `npm run build` must stay green.
- Responsive visual verification runs in a real local browser at iPad and narrow-phone viewports;
  semantic assertions stay in Vitest so navigation and decision regressions do not depend on pixels.
  Headless battle screens need software WebGL flags when the environment does not provide a GL context.
  Ticket 09's deterministic Chrome matrix also covers truthful resource states, learned/absent Partner
  actions, legal/disabled switch states, side/field overflow, fixed-effect source cues, MobCard phase
  gating, forced switch, and win/lose/timeout command semantics.
  Ticket 10 adds exact five-viewport classification, minimum-target and head-safe metrics, keyboard/focus
  journeys, hidden/resume clock invariants, a 200%-zoom-equivalent layout run, and reduced-motion diagnostics.
