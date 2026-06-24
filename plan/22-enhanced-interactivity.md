# 22 — 增強互動性設定開關（M22；給兒童參與感，預設關）

> 來源：使用者要求「設定裡打開『增強互動性』後，會多出很多操作（比如集氣時要連點之類的），
> 給兒童參與感，而不是只有點一下又點一下這種無聊的過程」。
> 設計經四方 agent-chat（Claude / gemini / codex / mistral）round-robin，**3 輪全體 agree、無未解分歧**，
> 結論全文：`.claude/agent-chat/session-20260624-132835/conclusion.md`。
>
> **本檔是 M22 的真相來源**；`CHECKLIST.md` / `handoff.md` 只引用，不重抄。
> **一句話**：新增 UX 偏好分級開關 `off | lite | arcade`（**預設 off ＝現狀一字不差**），開啟後在目前「零互動」
> 或「單純 tap」的環節疊上**不同身體動作的手勢**（畫圈/長按/節奏/下滑）。手勢只輸出離散純量或純演出，
> **pure reducer / 效能紅線 / 設定 slice 結構全不破。**

---

## 0. 現況與痛點

### 0.1 現有互動盤點（戰鬥）
| 環節 | 現況互動 | 純量出口 |
|---|---|---|
| 攻擊 | 選招槽(1–4) → `TimingBar` 抓準停指針 → `MashMeter` 連打蓄力 950ms | `quality` + `mashCount` |
| 變化招 | `TimingBar` 輕量（只影響強度） | `quality` |
| 換人防禦 | `TimingBar` | `quality` |
| **星擊** | 能量滿時**單擊一下**即放（零蓄力互動） | — |
| 連鎖 | 逐段 `TimingBar` | `quality[]` |
| **捕獲（寶貝球）** | **全自動**——`ResultScreen` 掛載時 `Math.random` 預先決定，丟球+晃動全是動畫，玩家零操作 | — |
| 天降補給（M11） | 三選一 modal | — |

### 0.2 痛點
- 使用者嫌「點一下又點一下很無聊」——**現在 tap→TimingBar→連打全都是 tap**，輸入形式單一。
- **星擊**（情緒峰值）只單擊、**捕獲**（情緒峰值）零操作，最有「儀式感」的兩個環節反而沒有參與感。
- **定調（agent-chat 全體同意）**：增強互動性的本質是「**輸入形式多樣化**」，不是「更多次點擊」。
  arcade 要靠 swipe / 畫圈 / 長按 / 節奏帶來**不同肌肉記憶**，而非把點擊次數加倍。

---

## 1. 設計主軸：UX 偏好分級開關（最終定案）

### 1.1 為什麼是「偏好」不是「模組」
延伸模組（synergy/heldItems/abilities/chain/evolution/tower）住 `settings.modules`，會註冊 S1–S8 seam 改戰鬥邏輯。
**增強互動性不註冊任何 seam、不碰 reducer/engine**——它只在 display 層替換/疊加互動 component。
故它是**另一類設定（UX 偏好）**，住新的 `settings.prefs`，**不混進 `modules`**（避免被當成戰鬥模組、避免 `MODULE_IDS` 污染）。

### 1.2 分級而非 boolean
```
mode: 'off' | 'lite' | 'arcade'
```
- `off`（預設）＝**現狀一字不差**（守專案「預設零殘留」鐵律，也最貼合使用者「打開後『多出』操作」＝加法）。
- `lite`＝直覺**單一手勢**（滑動丟球、長按蓄力），保留參與感又不累。
- `arcade`＝機台式高頻（畫圈、節奏點擊），參與感最強。
> 強度（閾值/速度）由 **mode 派生內部常數**（`INTENSITY_BY_MODE`），**不做使用者 intensity 滑桿**（agent-chat：別過早複雜化 UI）。

### 1.3 資料結構
```ts
// game/settings.ts —— 與 modules 同一檔、不同欄位
export type InteractSurface = 'capture' | 'starStrike' | 'defense' | 'encounter' | 'hatch' | 'tower'
export type InteractMode = 'off' | 'lite' | 'arcade'

export interface GamePrefs {
  enhancedInteractivity: {
    mode: InteractMode
    surfaces: Record<InteractSurface, boolean>  // 即使 off 也預設填滿，避免日後 undefined gating
  }
}
export interface GameSettings {
  schemaVersion: number
  modules: Record<ModuleId, boolean>
  prefs: GamePrefs                                 // 新增；migrateSettings 缺欄→預設
}
```
- `migrateSettings` 向後相容：舊存檔無 `prefs` → 補預設（`mode:'off'`、surfaces 全 `true`「待 mode 開啟才生效」）。
- **統一 selector**（agent-chat codex 補）：各頁一律用
  `isEnhancedSurfaceEnabled(settings, 'capture') → mode !== 'off' && surfaces.capture`，
  別讓各頁自己判斷 mode/surface。再加 `interactModeOf(settings, surface)` 回 `'off'|'lite'|'arcade'` 供 component 取閾值。

---

## 2. MVP 範圍（agent-chat 全體同意：只做兩個情緒峰值）

### 2.1 捕獲 `capture`（`ResultScreen` 的 `WinView`，純顯示層）
- `lite`：**swipe / flick 丟球**（單一動作）→ 套既有 throw/wobble 動畫 → 揭曉。
- `arcade`：swipe 丟球 + 晃動時**畫圈注入封印**（持續畫圈累進度，iPad 上比連打沉浸且不累）。
- **純度鐵律**：命中**維持預先決定**——`WinView` 既有的 `caught = Math.random() < captureChanceWithBall(...)` **一字不動**。
  手勢只決定**演出**與「再搏一下」**純演出寬限**（失敗後可再畫一次，**僅影響動畫、UI 標娛樂性**，
  絕不改 `caught`/機率/難度）。把 UX 開關變成隱性難度開關＝**明確否決**。
- 落點：`WinView` 讀 selector；off → 現有自動流程不變；lite/arcade → 在 `throw` 階段插入手勢 wrapper，
  手勢完成（或逾時）才推進到 `wobble`/`result`。`caught` 仍在掛載時算好，手勢層讀它決定演哪種收尾。

### 2.2 星擊 `starStrike`（`BattleScreen` 的 star-orb，純顯示層）
- `lite`：**長按蓄力環**（環填滿即放）。
- `arcade`：**節奏三連點**（太鼓式準確度判定）。**不沿用攻擊連打**（避免與 `MashMeter` 重複，agent-chat codex）。
- 中斷 / 逾時**安全退場**：保留部分蓄力、或自動以基準放招（絕不卡死）。
- 落點：star-orb 現為 `onClick={() => runStarStrike()}`；off → 不變；lite/arcade → 點擊改成開啟蓄力/節奏 wrapper，
  完成後才 `runStarStrike()`。**`runStarStrike` 簽名不動**（星擊傷害不吃手勢結果，手勢只是「儀式」+ 特效強度；
  若日後要讓蓄力影響特效強度，走 display 層 FX intensity，不進 reducer）。

> **Q1 裁定（agent-chat）＝既有攻擊 `MashMeter` 不動**。gemini 原想讓 off 跳過連打只留 TimingBar（選 b），
> codex 反對、mistral 附議、gemini 接受：守「off = 現狀一字不差」，避免把「增強互動性」混成「簡化戰鬥節奏」。
> arcade 想把攻擊連打換節奏點擊＝後續旗標 `attackInputVariant`（見 §4），不進 MVP。

---

## 3. 手勢肌肉記憶分流（避免全是 tap）
| 環節 | 動作 | 階段 |
|---|---|---|
| 攻擊 | **連打**（既有 `MashMeter`，不動） | baseline |
| 防禦 | **下滑拉護盾**（取代短連打，仍映射 `quality`） | backlog §4 |
| 捕獲 | **畫圈** | MVP |
| 星擊 | **長按 / 節奏** | MVP |

四種不同身體動作＝四種兒童肌肉記憶，從根本解決「全是 tap」的單調感。

---

## 4. 後續階段（同一 plan 的 backlog，不進 MVP）
- **防禦下滑護盾** `defense`：`defenseQte` 的 `TimingBar` 在 lite/arcade 疊「向下滑動拉起護盾」，仍輸出 `quality`。
- **攻擊節奏變體** `attackInputVariant: 'mash' | 'rhythm'`：arcade 把 `MashMeter` 換太鼓式節奏；
  **只在 mode≠off 且該變體啟用時替換**，off 不受影響。獨立旗標、獨立驗收。
- **遭遇前撥草** `encounter`：`EncounterScreen` 前置「撥開草叢 / 刮刮樂塗抹」純演出，達標才 dispatch 既有 encounter。
- **孵化摩擦生熱** `hatch`：`IncubatorModal` 孵化前「來回快速滑」摩擦進度條，達標才 `hatchEgg`。
- **連勝塔開場選路 / 破門** `tower`：**隨 M11 連勝塔落地**，開場一次手勢選路，**不在每場戰鬥加負擔**（agent-chat codex）。

---

## 5. 落地骨架（守三鐵律）

### 5.1 純手勢層 `src/input/gestures/`
比照 `input/qte.ts` 的純函式契約——**輸入指針/座標序列、輸出單一純量**，戰鬥邏輯只認純量：
- `swipeFromPointer(samples) → { dir, speed, throwVector }`（捕獲丟球）
- `circleProgress(samples) → 0..1`（畫圈累進，捕獲封印）
- `holdCharge(durationMs, mode) → 0..1`（星擊長按蓄力環）
- `rhythmTaps(timestamps, mode) → quality`（星擊節奏判定，太鼓式）
> 與 **M4 體感同源**：日後 MediaPipe 餵同樣的 pointer/progress 序列，手勢層即「觸控前身」，零改寫沿用。

### 5.2 效能紅線
所有手勢 component（`SwipeThrow` / `CircleSeal` / `HoldChargeRing` / `RhythmTap`）的**高頻值
（trail 座標 / 圈數 / 速度 / 蓄力寬度）全走 ref / rAF / DOM style，絕不進 React 頂層 state**——
比照既有 `TimingBar` / `MashMeter` 範本。每個 component **只在完成/逾時時 `onDone(scalar)` 一次**。

### 5.3 pure reducer / event 零變更
- reducer / engine / `BattleEvent` **完全不動**。
- 捕獲互動屬 `ResultScreen` 顯示層（`caught` 預先決定不動）。
- 星擊互動屬 `BattleScreen` 顯示層（`runStarStrike` 簽名不動）。

### 5.4 設定 UI
`SettingsModal` 在模組清單**之外**加一段「🕹 互動偏好」：三態 selector（關 / 輕度 / 機台），
附一句兒童向說明。`settingsStore` 加 `setInteractMode(mode)`（低頻、走一般 state、寫回 localStorage）；
`prefs` 不參與 `assembleExt/prep/postGrowth`（它不是戰鬥注入）。

---

## 6. 驗收準則（agent-chat codex 補，採納）
- **`mode=off`**：跑既有 golden path 戰鬥 / 捕獲，**DOM 不得出現任何新增互動 wrapper**（零回歸、零殘留）。
  既有 `MashMeter` / `TimingBar` 行為與截圖一致。
- **`mode=lite/arcade`**：測手勢 **逾時 / 取消 / 多指誤觸 / 低 FPS** 下仍**只 dispatch 一次 completion action**，
  且**捕獲命中率與 off 完全相同**（手勢不改機率的回歸測試）。
- 純函式（`game/settings.ts` 的 migrate/selector、`input/gestures/*`）走 vitest；
  Chrome CDP（SwiftShader）抽驗捕獲畫圈 + 星擊長按/節奏的真機演出。

---

## 7. 里程碑切分（M22.a–e）

### M22.a — 設定地基（純函式，零 UI）
- `game/settings.ts` 加 `prefs.enhancedInteractivity`（型別 + `defaultPrefs` + `migrateSettings` 向後相容 + `setInteractModeIn`）
  + selector `isEnhancedSurfaceEnabled` / `interactModeOf` + `INTENSITY_BY_MODE` 常數；vitest（migrate 缺欄/壞檔、selector off→false、surfaces 預設填滿）。
- `settingsStore` 暴露 `setInteractMode`；`prefs` 不入 ext/prep/postGrowth。

### M22.b — 純手勢層 `src/input/gestures/`
- `swipeFromPointer` / `circleProgress` / `holdCharge` / `rhythmTaps` 純函式 + vitest（邊界/逾時/部分進度/決定論）。

### M22.c — 捕獲 surface（MVP-1）
- `WinView` 接 selector：off 不變；lite=`SwipeThrow`；arcade=`SwipeThrow`+`CircleSeal`。
- `caught` **不動**；「再搏一下」純演出寬限（UI 標娛樂性）；安全退場；高頻值 ref/rAF/DOM。
- 回歸測試：lite/arcade 捕獲率 == off。CDP 真機演出。

### M22.d — 星擊 surface（MVP-2）
- star-orb 接 selector：off 不變；lite=`HoldChargeRing`；arcade=`RhythmTap`。
- `runStarStrike` 簽名不動；中斷/逾時安全退場；不沿用攻擊連打。CDP 真機演出。

### M22.e — 設定面板 UI + 收尾
- `SettingsModal` 加「🕹 互動偏好」三態 selector + 兒童向說明。
- 驗收：off golden path 截圖無新增 wrapper；lite/arcade 逾時/取消/多指/低 FPS 單次 dispatch。typecheck/test/build 全綠 + CDP。

### Backlog（§4，另起子階段或後續里程碑）
- M22.f 防禦下滑護盾 `defense`／M22.g 攻擊節奏變體 `attackInputVariant`／M22.h 遭遇撥草 `encounter`／
  M22.i 孵化摩擦 `hatch`／M22.j 連勝塔選路 `tower`（依賴 M11 連勝塔）。
