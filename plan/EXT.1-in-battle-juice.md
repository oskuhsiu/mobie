# EXT.1 — 局內爽感（打擊感 ＋ Haptics ＋ Sprite 動態 ＋ 引導）

> **狀態：✅ 已完成（2026-06-30，typecheck/443 test/build 全綠 + CDP 驗收）。** 落地細節見 `plan/CHECKLIST.md` EXT 段。

> 上層真相＝[`EXT.0`](EXT.0-enhancement-report.md)（分層、紅線、agent-chat 結論）。本檔只展開 EXT.1 的落地。
> **範圍**：B1 打擊感、C1 Haptics、C3 圖示/音效優先、B4 Sprite 動態＋轉場＋修 4 置中 overlay、C2 脈衝引導、
> 並在此鋪 **`cinematicCoordinator`** 演出協調 seam（供 [`EXT.2`](EXT.2-star-strike-cinematic.md) 接）。
> **一句話**：把現有「flash＋shake」升級成「**數字＋圖示＋頓格＋震動**」的完整打擊回饋，全程純 display、零碰 reducer。

---

## 1. 為什麼這是第一梯（EXT.0 §2）

對 5 歲 iPad 玩家「回饋爽感即遊戲」。且 `damageApplied` event **已攜帶全部所需資料**
（`amount / crit / effectiveness / effectivenessText / hpBefore / hpAfter / maxHp / resolvedMoveId`），
所以最高價值的視覺回饋**不需要動 reducer**——只在 `BattleScreen` 的事件消費迴圈疊演出。

---

## 2. 紅線（承 EXT.0 §3，本檔強化）

- **純 display**：只 consume `BattleEvent` / selector；不新增 reducer side-effect、不寫 `BattleState`。
- **hit-stop ＝ presentation clock pause**：暫停的是 BattleScreen 的「演出推進」（event queue 消費節奏），
  **不是** reducer 的回合時間線（reducer 早已一次算完整回合）。實作＝在消費 `damageApplied` 後插入一段
  await 的微延遲（會心/效果絕佳時加長），期間凍結 sprite/數字。**不可**因此改變最終 `nextState`。
- **效能**：傷害數字的座標/位移、頓格時鐘、震動排程全走 ref/rAF/DOM；數字 DOM 節點用物件池複用，
  **絕不**讓「每幀數字位置」進 React 頂層 state（比照 `FxCanvas`/`TimingBar`）。
- **prefs 不混 modules**：新增的都是 UX 偏好 → 住 `settings.prefs`，不進 `MODULE_IDS`。

---

## 3. 設定地基（`game/settings.ts`，純函式）

`GamePrefs` 新增兩欄（沿用既有 `migratePrefs` 缺欄補預設模式，向後相容）：

```ts
export interface GamePrefs {
  enhancedInteractivity: { mode: InteractMode; surfaces: Record<InteractSurface, boolean> }
  recordReplays: boolean
  attackInputVariant: AttackInputVariant
  // EXT.1 新增——預設值＝「升級後的爽感」，但仍是純 display、可關：
  juice: 'full' | 'reduced' | 'off'   // 數字/頓格/sprite 動態強度（off＝回到 M22 純 flash+shake）
  haptics: boolean                     // 觸覺回饋總開關（裝置不支援時自動 no-op）
}
```

> **預設值抉擇**：與 EXT.0「預設零殘留」的張力——B1/B4 是**升級既有演出**而非新戰鬥規則，故 `juice` 預設 `'full'`、
> `haptics` 預設 `true`（裝置不支援即靜默 no-op）。**但**必須提供 `'off'/'reduced'` 完整退場，且
> `juice:'off'` 時 DOM 與 M22 截圖一致（無新增 wrapper）——這是驗收項。selector：`juiceLevelOf(settings)` / `hapticsEnabledOf(settings)`。
> settingsStore 加 `setJuice(level)` / `setHaptics(on)`（低頻、一般 state、寫回 localStorage）。

---

## 4. 子里程碑

### EXT.1.a — 觸覺回饋 Haptics（C1，先做＝最高 juice/effort）
- 新 `src/input/haptics.ts`（純薄封裝）：`vibrate(pattern: number | number[])`，內部 feature-detect
  `navigator.vibrate`（iOS Safari 目前多半 no-op，Android/部分裝置有效）→ 不支援即靜默。讀 `hapticsEnabledOf`。
- 語意化排程表：`HAPTIC.hit`（命中，短）/ `HAPTIC.crit`（會心，雙擊長）/ `HAPTIC.superEffective`（效果絕佳）/
  `HAPTIC.faint` / `HAPTIC.qteGood` / `HAPTIC.capture`。在 `BattleScreen` 既有 `damageApplied`/`memberFainted`/
  QTE 完成點、`CaptureGestures`/`ResultScreen` 捕獲揭曉點各呼叫一次。
- **驗收**：`haptics:false` 或不支援裝置 → 全程零呼叫、零報錯；純函式 vitest（pattern 表、feature-detect 分支）。

### EXT.1.b — 浮動傷害數字 ＋ 效果絕佳橫幅 ＋ 會心強調（B1，揉入 C3）
- 新 `src/ui/components/DamageNumbers.tsx`：imperative handle（`ref.spawn({ nx, ny, amount, crit, effectiveness })`），
  內部 rAF + DOM 物件池上拋飄字（比照 FxCanvas 不進 React state）。掛在戰鬥區覆蓋層。
- `BattleScreen` 消費 `damageApplied` 時：
  - 在 target plate 螢幕座標 `spawn` 傷害數字；`crit` → 放大＋金色＋驚嘆；`amount===0`/`missed` → 「MISS」/「沒效果」。
  - `effectivenessText`（既有欄）→ 觸發 **效果橫幅**：**大圖示優先**（↑↑ 紅色向上＝效果絕佳、↓ 藍色＝不太有效），
    文字僅輔助（C3：幼兒不識字）。橫幅本身複用既有 `.battle-banner` 演出層。
  - 各效果度配專屬音效（Tone.js，per-type 音色已存在 → 加「絕佳/不佳」音程）＋對應 `HAPTIC.*`。
- **驗收**：`juice:'off'` 時不 spawn 任何數字/橫幅（DOM 同 M22）；`'reduced'` 只留數字無頓格；CDP 真機抽驗。

### EXT.1.c — Hit-stop 頓格（B1，presentation pause）
- 在 BattleScreen event-queue 消費器加 `pausePresentation(ms)`：命中插 ~40ms、會心/效果絕佳插 ~120ms 凍結
  （sprite 定格、數字暫停上飄），純拉長演出節奏。封裝成 §6 `cinematicCoordinator.pause()` 的最小前身。
- **驗收**：頓格不改 `nextState`（同一場戰鬥 seed → 結果不變的回歸測試）；`juice:'off'` 不頓格。

### EXT.1.d — Sprite 動態（B4 上半）
- `MobieSprite`/`Combatant3D`：idle 微浮動（CSS/transform，低頻）、受擊位移回彈（消費 `damageApplied`）、
  倒下沉降（消費 `memberFainted`）。billboard 與 3D 兩路都加；高頻值走 transform 不進 state。
- **驗收**：`juice:'off'` 回到靜止；3D/billboard 皆生效；CDP 抽驗。

### EXT.1.e — 修 4 個置中 overlay 漂移（B4 下半，清既有技術債）
- `star-orb` / `battle-banner` / `support-overlay` / `combo-overlay`：把 translate(-50%) 置中改 **full-bleed flex 層**
  （比照已修好的 `.battle-action-layer`，見 ARCHITECTURE §10）——避免 framer 寫 inline transform 蓋掉置中。
- **驗收**：scale/y 入場動畫期間不漂移；CDP 截圖對位。同步更新 ARCHITECTURE §10 / handoff follow-up 清單與 memory `framer-centering-overlays-followup`。

### EXT.1.f — 畫面轉場 ＋ C2 脈衝引導（B4 轉場 ＋ C2）
- 螢幕間轉場：encounter「野生出現」掃場、battle 進場淡入（framer，低頻）。
- C2 引導**降級**（採 gemini）：複用 B1 的圖示/動畫資源，做「發光手指/脈衝箭頭」指向當前該操作處
  （首玩或閒置 N 秒才顯示）；首玩旗標存 `mz.*`（localStorage，非 roster）。**不新增任何 reducer 邏輯/狀態**。
- **驗收**：引導純 display、可關；首玩看得到、之後不打擾。

---

## 5. 落點檔案一覽
- 新增：`src/input/haptics.ts`、`src/ui/components/DamageNumbers.tsx`、`src/ui/components/EffectBanner.tsx`（或複用 battle-banner）。
- 修改：`src/game/settings.ts`（prefs 兩欄＋selector＋setter）、`src/store/settingsStore.ts`、
  `src/ui/screens/BattleScreen.tsx`（事件消費點掛 spawn/haptic/pause）、`src/ui/components/MobieSprite.tsx`、
  `src/scene/r3f/Combatant3D.tsx`、`src/ui/styles/global.css`（flex 置中＋keyframes）、`src/ui/components/SettingsModal.tsx`（爽感/震動開關）。
- **不改**：`reducer.ts` / `engine.ts` / 任何 `game/data/*` generated。

---

## 6. `cinematicCoordinator` 演出協調 seam（地基，供 EXT.2）

EXT.1 就定義介面，避免 EXT.2 重構（採 mistral）：

```ts
// src/ui/screens/battleCinematic.ts —— 純 display 協調器（非 ext seam，不碰 reducer）
export interface CinematicCoordinator {
  pause(ms: number): Promise<void>          // hit-stop / 慢鏡：凍結演出推進
  resume(): void
  cutIn(spec: CutInSpec): Promise<void>      // 全螢幕 cut-in（EXT.2 用，EXT.1 先留空實作）
  // 支援疊層：hit-stop 與 cut-in 慢鏡可同時生效，內部以單一 rAF 時鐘排程
}
```
- EXT.1 只實作 `pause/resume`（即 §4.c 的 hit-stop）；`cutIn` 留 stub。EXT.2 填 `cutIn` 與運鏡/letterbox。
- 協調器是 **BattleScreen 私有的演出層**，**不是** S1–S8 ext seam（那些碰 reducer）；命名為「seam」僅指「預留擴充點」。

---

## 7. 整體驗收（EXT.1 收尾）
- `juice:'off'` 跑 golden path：**DOM 不得出現任何新增 wrapper**，與 M22 截圖一致（零回歸）。
- `juice:'full'`＋`haptics:true`：傷害數字/效果橫幅/頓格/sprite 動態/震動全鏈路 CDP 真機抽驗。
- 同一 seed 戰鬥在 `off`/`full` 下 `nextState` **完全相同**（頓格不改戰果的回歸測試）。
- `npm run typecheck && npm test && npm run build` 全綠；純函式（haptics 表、settings selector）走 vitest。
