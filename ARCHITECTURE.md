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
  `@react-three/fiber` / `@react-three/drei`, `qrcode`, `tone`, `fflate`, and the capability-gated
  Scanner entry (which owns `jsqr`). Scanner is absent from the default Tools menu and its chunk is
  requested only after `scannerEnabled` is turned on and the player selects 掃卡.

## 2. Layered structure (`src/`)

```
app/        AppShell + cached bootstrap coordinator + GameProvider (XState context via React context)
game/       Pure domain logic (no React). The testable core.
  data/     Seed/generated data + type chart + region lookup
  battle/   Pure battle engine + reducer + fixtures + tests
  ext/      Extension seams + fixed productRuntime: synergy/items/abilities/chain/combo/evolution
  machine/  XState gameMachine (screen flow)
  save/     Portable save file (M5): envelope meta, zip pack/unpack, export/import I/O, backup slot
  settings.ts  Exact Settings v2 + read-only v1 migration and capability preferences
  cardCode/cardsImport/cardLibrary   QR card-code parse + import + IndexedDB card store (M2)
store/      Zustand: battleStore (display), rosterStore (persistence), prefs-only settingsStore,
            bagStore (item bag mz.itembag.v1, M7)
ui/         React screens + components + shell overlay controller/surface + global.css + type metadata
audio/      Tone.js audio engine (lazy)
scene/fx/   Canvas particle/flash FX (imperative handle, off React state)
scene/battle/ Three-free renderer contracts + host, one lazy next entry, DOM compatibility adapter
scene/r3f/  React-three-fiber 3D battle/capture stage (M3, lazy three)
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
  the latter opens a scrollable secondary menu grouped under **成長與收藏** and **資料與設定** for
  library / moves / partner skills / dex / achievements / incubator / replay / save / settings, plus
  Scanner only when its capability is enabled (all utility entries are lazy-loaded). Every utility
  remains reachable without flattening it into the primary hunt loop. `regionSelect` adds
  `BACK → title` (a 🏠 button); it is the in-game hub returned to after each result.
- **App shell and cold boot (M24 Tickets 23–24):** `app/bootstrapCoordinator.tsx` owns one cached
  bootstrap promise and snapshot outside React component lifetime. It starts roster and incubator
  loading together, waits for the canonical roster, then hydrates meta from that roster. The UI only
  exposes `loading`, `ready`, or `partial-error`; a failed attempt stays on the Title with an explicit
  Retry and leaves safe Settings/More actions available. `ui/shell/AppShell.tsx` owns the full viewport,
  safe-area padding, route background, `TaskHeader`, `ScreenViewport`, and `UtilityDock`. It does not
  create a second screen machine: route changes remain XState events, while resize/orientation are CSS
  layout concerns. The browser app keeps its one XState actor outside the React root, so a dev/test root
  remount preserves the current route while the coordinator keeps its cached snapshot. Data-dependent
  actions carry a readable disabled reason until bootstrap is ready.
- **Overlay contract (M24 Ticket 24):** `ui/shell/OverlayController.tsx` is the only top-level overlay
  owner inside `AppShell`. It records the current route, a stack snapshot, dismiss policy, and the exact
  invoker for `open` / `push` / `pop` / `close`; `pop` returns to a parent entry and `close` clears the
  stack back to the root invoker. Route changes clear the stack without restoring focus to the old route.
  `ui/shell/ModalSurface.tsx` is the shared portal surface: it marks `#root` inert,
  locks body scrolling, traps focus, exposes labelled dialog header/description/body/footer regions,
  applies safe-area padding, and implements `escape-and-backdrop`, `escape-only`, or
  `explicit-action-only`. Tool content keeps its store and gameplay actions, while More→Settings, Team
  details, replay playback, QR details, encounter supply, and gesture gates use the shared stack.
  BattleScreen keeps its battle-specific overlay ownership and uses the surface only for its existing
  MobCard focus contract.
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
   BattleScreen collects input and supplies scene/HUD/audio/haptic ports. Non-damage events
   use `eventChoreography` for prepare/cast/apply/clear timing, with synchronous UI adapters and
   token-fenced field projection at the apply safe point. A display-only switch prelude recalls
   and frames the entry before defense input. Star/outcome skip opens after 600ms and fast-forwards
   the current turn clock through safe points; ordinary aborts still cancel without commit.
   The Director finally releases camera, timing, transient FX and overlays. During playback,
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
`GraphicsPreference` (`auto`/missing → Balanced, explicit High capped at DPR 1.5, or Compatibility) and a
post-M23 `BattleRendererRoute`. Production and ordinary development resolve an absent route to `next`;
`compatibility` remains the recovery entry. `NextBattleScene` is the only full-scene lazy entry and
exposes the stable `BattleSceneHandle`; the compatibility adapter consumes the same snapshot, input,
session, and presentation coordinator. Data loading and renderer boot are observable DOM states;
commands mount only after the selected entry or compatibility readiness. The Release A/B legacy route is
retained in the release history only; stale `renderer=legacy` links resolve to the current next default.
Chunk rejection, 8-second readiness timeout, WebGL unsupported, shader fatal, context loss, and sustained
performance pressure all latch compatibility in the non-persisted session. Late ready/restore events and
same-session remounts cannot upgrade it; Retry creates a fresh token and may probe again. The DOM
compatibility adapter reuses the same HUD, FxCanvas, WeatherCanvas, store projection, and coordinator,
so renderer changes never rerun resolver/input or duplicate canonical commit. Route and fallback reason
are available through the DEV diagnostics port only; no telemetry or player data is uploaded.

`GraphicsGovernor` is a separate, pure cost policy. It receives only rendered frames marked active by
the battle presentation; the stage runs an idle demand loop at roughly 20fps and an active loop at up to
60fps. A rolling 120-gap window is evaluated every 60 active gaps, and two failing windows are required
before a downgrade is queued. The queue applies only at a Director cue boundary and follows
`DPR → post grade → particles/weather → compatibility`; it has no in-battle upgrade path. The active
quality profile carries DPR, compositor-grade, VFX/weather scale, and bounded DOM-particle capacity,
while reduced motion and juice remain independent axes.

`BattleStage` owns the neutral world, lights, camera, and both combatant rigs in one R3F Canvas. Each rig
publishes root/center/head/ground/cast/impact world anchors; the stage projects them through the live camera,
with `presentation/battle/battleAnchors.ts` retained only as a pre-first-frame/compatibility fallback. Normal
damage cues drive anticipate/contact/hit-react/recover through the scene handle. A cue-owned camera queue
hands off caster and impact shots and automatically returns to wide; cancellation resets the queue. Reduced
motion keeps the same cue/anchor semantics while forcing a fixed wide camera and suppressing bob/shake/dolly.
Artwork billboards and named procedural silhouettes remain storage-independent and share the same rig.
`artworkResourceCache.ts` owns a 24-entry inactive LRU, retains active textures, disposes evicted
textures, and exposes current entries, estimated decoded bytes, and evictions to the DEV diagnostics port.

`vite build` emits a manifest plus explicit `NextBattleScene`, `CaptureStage`, Three-vendor, and
compatibility categories. Rollup's explicit-only manual chunks keep Three out of the main and
compatibility static graphs. Custom GLB/GLTF tooling is retired and has no runtime or lazy chunk.

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
(items/abilities on both, synergy on player only), and applies evolution inside the roster settlement
destination (`settleBattleResult`). Replay
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
the fixed product runtime. Runtime `GameSettingsV2` is the exact `{ schemaVersion: 2, prefs }` envelope
written to `mobie.settings.v2`. Loading tries valid v2 first, then projects valid `mobie.settings.v1`
into v2 and writes the migration, then falls back to defaults. The v1 `modules` subtree is never
projected; it remains untouched rollback input. The v2 prefs contain enhanced interaction, replay
recording, attack input, juice, haptics, graphics preference, and the default-off `scannerEnabled`
capability. Settings never assemble battle features; Team/Partner surfaces contain no module-off
warnings.

## 7. Persistence & progression

- **`game/persistence.ts`** — `PersistenceAdapter` interface; `LocalStorageAdapter` (key `mobie.roster.v2`)
  reads legacy canonical `OwnedUnit[]` arrays and writes a marker-bearing envelope for the capture boundary.
  `MemoryAdapter` is for tests.
- **`store/rosterStore.ts`** — `load`, `grantBattleExp(unitIds, foeLevels, ratio)` (win = full,
  loss ≈ 0.15), `settleBattleResult(identity, payload)` (durable roster growth/evolution applyOnce),
  `captureUnit(card)` (legacy scanner/import entry), and `replaceAll(units)` (whole-roster replace used by
  save import). Result capture writes go through `CaptureSettlementCoordinator` and its roster/meta/egg
  destinations.
- **`game/growth.ts`** — Medium-Fast `n³` exp curve, `applyExp`, `createOwnedUnit`, `ownedToCard`.
- **`game/recommend.ts`** — pure team-selection scoring vs the *whole* foe team (offense type
  effectiveness minus defensive risk + level/stat tiebreak); powers advisory badges and the revealed
  recommended trio. Advice never mutates selection: the player still chooses and orders the team.

**Storage map (all client-side, no backend):** `mobie.roster.v2` (localStorage, canonical roster, incl.
`heldItemId`; legacy arrays remain readable, while capture settlement writes a roster envelope containing
`resultSettlements`) · `mobie.roster.growth.v1` (roster settlement marker) · `mobie.roster.capture.v1`
(captured-new roster child marker) · `mobie.skillpoints.settlement.v1` (SP child marker) ·
`mobie.meta.settlement.v1` (Result Meta child marker) · `mobie.meta.capture.v1` (capture/Dex Meta child marker) ·
`mobie.run.v1` (canonical Tower run metadata) · `mobie.incubator.v1` (canonical incubator eggs/progress) ·
`mobie.tower.settlement.v1` (Tower child mirror) · `mobie.incubator.settlement.v1`
(incubator child mirror) · `mobie.incubator.capture.v1` (duplicate-egg child marker) · `mobie.result.settlement.v1`
(Result orchestration journal) · `mobie.achievement.claim.meta.v1`, `mobie.achievement.claim.incubator.v1`,
and `mobie.achievement.claim.sp.v1` (best-effort claim receipt mirrors; canonical claim outboxes live in
the Meta, incubator, and SP envelopes) · `mz-cards` (IndexedDB card library, seeded from `playerCards`, M2) · `mz.savemeta.v1`
(localStorage save envelope meta, M5) · `mz-save-backup`
(IndexedDB single-slot pre-import backup, M5) · `mobie.settings.v2` (writable runtime preferences) ·
`mobie.settings.v1` (read-only migration/rollback source) ·
`mz.itembag.v1` (localStorage item bag, M7) · `mz-replays` (IndexedDB, M14 battle replays — canonical
`encodeReplay` JSON only, `battleId`-deduped, FIFO-capped 50). The portable save bundles the roster (so
`heldItemId` travels with it); the item-bag slice is not yet included in the `.save` (a known follow-up).

The retired `mz-models` IndexedDB may still exist on a user's device. It is deliberately absent from
the migration list and every product store path: the app does not open, read, write, or delete it, and
does not perform a cleanup migration.

### 7.3 Result settlement (M24 Tickets 29–32)

`game/resultSettlement.ts` is the first durable Result child destination. `ResultScreen` forwards the
battle handoff pair (`resultId = battleSessionId`, independent `resultFingerprint`) and keeps `outcome` in
the reward payload. `ResultSettlementCoordinator` is orchestration only; `RosterGrowthDestination` owns the
canonical roster EXP, level, learned-move, and evolution mutation. Its serialized write-ahead marker stores
the exact before/after unit subset, so a canonical write followed by a failed receipt write can reconcile
without recalculating or rolling back later roster edits.

The destination marker is persisted under `mobie.roster.growth.v1`; the coordinator journal is persisted under
`mobie.result.settlement.v1`. Both retain the result identity pair and reject an ID reused with a different
fingerprint. Pending markers remain durable until reconciled. Retention is invoked only after the Result leave
boundary and keeps current/unsettled entries plus the newest 128 settled entries. The journal never serves as
the exactly-once authority: every replayed settled receipt asks the child destination to reconcile its own
marker first.

M24 Ticket 30 adds `SkillPointsDestination` and `MetaSettlementDestination`. Each child owns its
canonical write plus write-ahead marker (the canonical `mobie.skillpoints.v1` / `mobie.meta.v1`
envelopes carry a `resultSettlements` field) as the authoritative state; the standalone marker keys
`mobie.skillpoints.settlement.v1` and `mobie.meta.settlement.v1` are best-effort evidence mirrors, and old
number/object values remain readable. Each child exposes `applyOnce`/`hasApplied`/`markResultLeft`. The coordinator
serializes roster, SP, and Result meta receipts independently; a failed child is retried through its
own marker without rolling back or resending another child. The coordinator now also serializes Tower
run and incubator-progress receipts independently; a failed child is retried from its own marker without
rolling back or resending another child. Meta settlement currently covers the
Result win counter and evolution receipt derived from the roster child. Ticket 31 adds two independent
children: `TowerProgressionDestination` owns the
monotonic `mobie.run.v1` floor/unlock metadata, and `IncubatorProgressionDestination` advances only
already-created achievement or duplicate-capture eggs in `mobie.incubator.v1`. Each canonical envelope
stores its `resultSettlements` marker beside the mutation; standalone progression marker keys are best-effort
inspection mirrors. Tower never creates an egg, and legacy `tower` egg records remain readable without being
advanced by the Result child. Ticket 32 adds `CaptureSettlementCoordinator`, which derives the ball and
capture roll from the battle identity plus the original target inputs and stores the outcome-specific plan
before invoking independent `RosterCaptureDestination`, `CaptureMetaDestination`, and
`DuplicateEggDestination` children. A captured-new plan writes the canonical `mobie.roster.v2` roster envelope
with its capture marker and
`mobie.meta.v1` registration/capture stats; a duplicate plan writes capture stats and one duplicate egg in
`mobie.incubator.v1`; an escaped plan writes no capture child. The capture marker keys are
`mobie.roster.capture.v1`, `mobie.meta.capture.v1`, and `mobie.incubator.capture.v1`; Meta and Incubator
capture markers share their canonical envelopes with their existing Result children and remain independently
reconcilable after a receipt failure. The Result UI only presents the stored decision and never writes capture,
Dex, roster, or egg state directly.

Ticket 36 extends that projection to Tower Result. The screen reads EXP, SP, incubator, evolution, floor,
best-floor, and Ascension data from the settled child receipts; Continue is enabled only when the stored
Tower outcome, floor, and Ascension match the current run. Running, missing, stale, malformed, and timeout
states keep a recoverable status and safe Region Hub exit, while `TOWER_CONTINUE` creates the next floor
from the existing XState run context without granting a second reward.

M24 Ticket 40 adds `game/achievementClaim.ts` for durable achievement claims. `AchievementClaimCoordinator`
writes a namespaced `achievement-claim:v1:<id>` outbox and exact reward payload into the Meta envelope before
calling either `AchievementEggDestination` or `AchievementSpDestination`. Each reward boundary writes its
own `achievementClaims` marker beside the canonical egg/SP value and exposes `applyOnce`/`hasApplied`.
Only after the child reports success does the coordinator finalize `meta.achievements[id]` and the Meta receipt;
a failed finalize therefore retries the receipt without sending another egg or SP. A changed reward fingerprint
for an existing operation is a recoverable collision. Bootstrap and the Achievements modal reconcile pending
outboxes after reload, while egg creation remains restricted to the `achievement` source (Tower never produces
eggs).

Ticket 33 adds `ResultSettlementProjectionController` and the
`store/resultSettlementProjection.ts` adapter. The adapter assembles the
complete Result payload once, prepares any capture plan before child writes,
and exposes only the `idle` / `running` / `settled` / `error` projection to
`ResultScreen`; receipt data, capture outcome, growth rows, and evolution rows
are read from that projection. A generation fence ignores late Promise
completions after a new result or collision, while same-pair remounts reuse the
active operation and retry delegates back to each destination's `applyOnce`.
The process-local `resultSettlementGuard` is checked by Save Manager UI and
`saveIO` export/import/restore commands, so those commands cannot race a
running Result settlement.

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
- **`bundle.ts`** — pure `packSave`/`unpackSave`. New `.save` files are a **zip** containing only
  `manifest.json`, `roster.json`, and `cards.json`, with a **crc32 payload checksum** and classified
  unpack errors (`not-zip`/`no-manifest`/`bad-manifest`/`schema-too-new`/`bad-payload`/
  `checksum-mismatch`, mirroring `cardCode.ts`). For old files, `models/<speciesId>.glb/.gltf` bytes are
  treated as opaque checksum input and discarded immediately after verification; no model bytes are
  returned by the codec.
- **`saveIO.ts`** — wires the pure codec to store I/O + browser delivery. Export prefers
  `navigator.share` (iPad share sheet → Drive/Files), falling back to `<a download>`. Import does a
  **whole-save replace** (roster → cards → `adoptMeta`) after auto-backing-up. It never touches the
  retired `mz-models` store.
- **`backupStore.ts`** — IndexedDB single-slot backup written *before* any overwrite; restorable
  one-tap. Backs up roster+cards only.

UI: `SaveManagerModal` (Title "☁️ 存檔" entry, lazy so `fflate` stays out of the main bundle). New/old
judgement is **semi-automatic** — a comparison table is always shown and an older-save overwrite
requires explicit consent; no field-level merge (whole-save replace + backup). A legacy save with
model entries shows that the entries were checksum-verified and ignored; it never offers model
restore or cleanup.

## 8. Content generation (do not hand-edit generated files)

`scripts/gen_dex.mjs` pulls from **PokéAPI** (zh-Hant names, types, base stats; cached, concurrent,
retrying) and regenerates `game/data/{species,moves,regions,playerCards}.ts`. Run `node scripts/gen_dex.mjs`
to rebuild. **These four files are generated — change the generator, not the output.**
`game/data/practiceRegion.ts` is the exception: hand-authored, not produced by the generator.

## 9. Asset / IP policy (hard constraint)

The repo **does not bundle, fetch, or distribute infringing assets**. Artwork uses official PokéAPI
raw URLs loaded at runtime (with skeleton fallback). Audio is fully procedural (Tone.js). Battle and
Capture combatants are artwork billboards and never read GLB/GLTF or custom model storage. Custom
model import, storage access, and playback are retired; future 3D Mobie work must use a separately
scoped Three.js procedural-geometry ticket.

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
- `npm run baseline:m24-shell` runs the Ticket 23 Chrome CDP cold-boot journey, including delayed
  loading, a controlled partial failure, Retry recovery, Title→region return, My Mobie/More handoffs,
  route-event counts, and the zoom-capable viewport meta.
- `npm run baseline:m24-overlay` runs the Ticket 24 Chrome CDP overlay journey: grouped More focus,
  More→Settings dialog semantics, root inertness, keyboard trap, body-only Settings scrolling, footer
  visibility, Escape/backdrop invoker restoration, route-change cleanup, and nested Team detail push/pop.
- Responsive visual verification runs in a real local browser at iPad and narrow-phone viewports;
  semantic assertions stay in Vitest so navigation and decision regressions do not depend on pixels.
  Headless battle screens need software WebGL flags when the environment does not provide a GL context.
  Ticket 09's deterministic Chrome matrix also covers truthful resource states, learned/absent Partner
  actions, legal/disabled switch states, side/field overflow, fixed-effect source cues, MobCard phase
  gating, forced switch, and win/lose/timeout command semantics.
  Ticket 10 adds exact five-viewport classification, minimum-target and head-safe metrics, keyboard/focus
  journeys, hidden/resume clock invariants, a 200%-zoom-equivalent layout run, and reduced-motion diagnostics.
  Ticket 16 adds pure governor hysteresis tests, active-versus-idle frame evidence, bounded VFX/weather/
  artwork diagnostics, and `npm run perf:check -- --evidence=true` release metrics output. Hardware
  ANGLE is required for performance claims; SwiftShader runs are functional evidence only. Tickets 18–19
  promote next, retire the temporary legacy route, preserve the release history, and keep the seeded
  Chrome compatibility/failure checklist in `docs/m23-release-b.md`.
