# Handoff — mobie

**精簡版：只記「現況／最近完成／下一步」。** 設計真相在 `plan/`、架構與已知坑在 `ARCHITECTURE.md`、
硬性約束在 `CLAUDE.md`（已自動載入）、里程碑勾選在 `plan/CHECKLIST.md`、完整歷史在 `git log`——
本檔不重抄這些，過時就刪。專案＝iPad 為主、自用的 Pokémon Mezastar 風格遊戲，Web/PWA。

## 現況
**M0–M22 全部完成**＋ **EXT.1（局內爽感）/ EXT.2（星擊電影化，含三拍 redo）完成**並 Chrome CDP 驗證；版號 v0.1.32。
內容＝全國圖鑑 1–1025（G1–G9）、16 主題野外區 + 競技場 + 連勝塔、16 起始卡。
下一輪主路線＝**EXT.3 地形/天氣視覺化**（`plan/EXT.3`，尚未動工）→ EXT.4 狀態異常 module → EXT.5 養成 meta。

**本 session 已完成並提交（typecheck / 443 test / build 全綠）：** EXT.1 全套（juice/haptics prefs 地基 +
cinematicCoordinator seam + Haptics + 浮動傷害數字/效果圖示/會心 + hit-stop + sprite idle + 修 4 個置中 overlay
漂移 + 戰鬥進場淡入/C2 脈衝引導 + SettingsModal 打擊感/觸覺開關）、EXT.2 星擊電影化 cut-in（後又依使用者回饋重做成三拍弧）。
**dev server 已於 session 結束時關閉**（重啟＝`npm run dev`）。

## 真相來源（先讀，別重抄）
- 架構 / 分層 / 資料流 / 不變式 / 已知坑 / CDP 驗證：`ARCHITECTURE.md`（§10 坑、§11 驗證 ≈ 第 277 行起）
- 硬性約束與偏好：`CLAUDE.md`　·　跑法：`README.md`
- 設計總覽 + 各里程碑：`plan/README.md`、`plan/NN-*.md`、`plan/EXT.*`
- 哪些做了 / 沒做：`plan/CHECKLIST.md`　·　決策脈絡：`.claude/agent-chat/*/conclusion.md`

## 最近完成（本 session，已提交）— EXT.1 局內爽感 + EXT.2 星擊電影化
> 全程**純 display、零碰 reducer/engine**；新偏好 `juice`(full/reduced/off)＋`haptics` 住 `settings.prefs`
> （不入 `MODULE_IDS`）。`juice:'off'` 嚴格回退 M22 基線（DOM 無新增 wrapper）。詳見 `plan/CHECKLIST.md` EXT 段。

新增檔：`src/input/haptics.ts`（Vibration 薄封裝 + `HAPTIC` 表 + 總開關，不支援/關閉 no-op）、
`src/ui/components/DamageNumbers.tsx`（imperative DOM 池飄字、CSS keyframe、圖示優先）、
`src/ui/screens/battleCinematic.ts`（cinematicCoordinator：`pause/resume` hit-stop + `cutIn` letterbox/卡片）。
改動：`game/settings.ts`/`store/settingsStore.ts`（juice/haptics prefs+selector+setter+開機同步觸覺）、
`BattleScreen.tsx`（damage spawn/haptic/hit-stop、4 overlay 改 `.overlay-center` flex 置中、進場淡入、C2 引導、
星擊 cut-in 包裝 + try/finally 保證 resume）、`MobieSprite.tsx`/`EncounterScreen.tsx`（billboard idle）、
`SettingsModal.tsx`（打擊感/觸覺段）、`global.css`（`.dmg-num*`/`.overlay-center*`/`.battle-enter`/`.choice-guide`/
`.cinematic-*`/`.cutin-card*`/`.sprite--idle`）。**關鍵不變式**：reducer/engine 一字未動；`runStarStrike` 簽名與
星擊傷害不變；hit-stop ＝ presentation pause 不改 `nextState`。

**EXT.2 後續重做（使用者回饋「星擊視覺很差」）：** 開四方圓桌（`.claude/agent-chat/session-20260630-162857`，
含三方 ASCII 示意圖確認）→ 把星擊 cut-in 重做成「蓄力→蓋章→衝擊」三拍弧：拍1 R3F 舞台 timeScale 0.15 慢鏡
+ letterbox + FxCanvas `converge` 四邊吸入粒子 + Tone 上升 sweep；拍2 卡片硬「印章」砸 + timeScale 0 定格 + tick 音；
拍3 卡片 brightness(4) 過曝退場 + FxCanvas `shockwave`（lighter 全屏大環）+ 白閃 + 震動×1.5 + 相機急推 + sub-bass boom。
新增 FxCanvas converge/shockwave、audio starChargeSweep/StampTick/ImpactBoom、BattleStage `setTimeScale`（Combatant3D
delta 乘倍率 + 虛擬時間）。**鐵則**：不在疊 WebGL 的 DOM 用 mix-blend（iPad Safari 掉幀）→ filter:brightness + Canvas
lighter。CDP screencast 連拍三拍全捕捉、產出 GIF/APNG（本地 `starstrike.gif`，已 gitignore）。

驗證：✅ typecheck · ✅ `npm test` 443 全綠（settings+6/haptics+5/cinematic+5） · ✅ build。
✅ Chrome CDP 實機（截圖在本 session scratchpad）：
- 浮傷 `-69` 帶 `dmg-num--super`（紅↑↑）於受擊方 spawn；`.dmg-num-layer` 存在（juice=full）。
- `battle-banner` cx=50%（**EXT.1.e 漂移已修**，原右下偏移消除）；4 個 `.overlay-center` 層皆在。
- 野生立繪 `sprite--idle` 浮動；SettingsModal「打擊感/觸覺」段渲染正常。
- 星擊 cut-in：`火花/小火龍/fire #ff5a32/letterbox 2 條/垂直置中` 全確認（`ext2-cutin.png` 見 letterbox 框）。

## 下一步
1. **收使用者自測回饋**（打擊感/震動/cut-in 是否夠爽；juice 預設 full）。若要更華麗的 cut-in 運鏡/粒子，
   可走 `/codex`（使用者已授權「需要做圖就叫 codex，等久一點」）。
2. 回主路線 **EXT.3 地形/天氣視覺化**（`plan/EXT.3`，R3F 讀 region/fieldState）→ EXT.4 狀態異常 module
   （唯一動 reducer，嚴格 module 化）→ EXT.5 養成 meta。
3. **未驗的小回歸**：`juice:'off'` 的 golden-path DOM 與 M22 完全一致（結構上由三元式保證 FloatDamage 回退，
   尚未 CDP 抽張對照截圖）；可下一手補驗。

## 其他未完成 / 待辦（皆非阻塞，詳見舊紀錄）
- 稀疏初始配招（memory `mobie-sparse-initial-loadout`）；bundle 分檔（主 bundle 864KB）。
- M18.e repo 目錄 + git remote 改名 `pokemon-mezastar`→`mobie`（**待使用者本機執行**）。
- 棄置：M4 體感、M20 DQ 來源、M11 backlog。
- follow-up：氣勢披帶/威嚇需動 engine 縫；`.save` 未含 itembag/meta/incubator/playerskills/skillpoints；
  framer 4 個置中 overlay 仍用 translate（memory `framer-centering-overlays-followup`）；M19.e moveLearned 結算 UI。

## 跑 / 驗證
`npm install`（設 git hook）→ `npm run dev`（5173）；`npm run typecheck` / `npm test` / `npm run build`。
視覺/E2E 無 Playwright：本機 Google Chrome headless + CDP（Node 24 內建 WebSocket）。**戰鬥畫面必帶**
`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`（R3F 要 GL context）。詳見 `ARCHITECTURE.md §10/§11`。
headless 用軟體 GL（swiftshader）戰鬥只 ~3fps → screencast 動圖偏頓，真機 GPU 順很多。

**CDP 慣例 + 驅動流程**：`cdp.mjs`（吃 JS 檔在頁面 context 執行 + 可選截圖；找 localhost:5173 page target）。
Chrome headless 在 port 9222。流程：開始遊戲→`.region-card`（常綠森林）→⚔ 出戰→✨ 推薦出戰→⚔ 出戰 3/3→戰鬥；
招式槽＝`.move-slot`（變化招＝`.move-slot--status`）、大圓＝`.tap-field`（`--timing`白/`--charge`橘）、
滿能星擊＝`.star-orb`、cut-in 卡片＝`.cutin-card`、letterbox＝`.cinematic-letterbox`、置中層＝`.overlay-center`。
> 註：本 session 的 driver/capture 腳本住 ephemeral scratchpad（已隨 session 消失），下個 agent 需照下方配方重建。

**★ 星擊 cut-in 擷取配方（本 session 踩過的坑，務必照做）**：
1. **集滿能量很難**：每場戰鬥能量歸零、隊伍多半無變化招、攻擊太快 KO 敵人（~2 回合）→ energy 常卡 ~78% 戰鬥就結束。
   可靠解＝**臨時插樁**：把 `BattleScreen.tsx` 的 `energyGain` 暫改 `=> 100`（一回合集滿），擷取後 `git checkout` 還原。
2. **headless 取樣太疏**：cut-in 真實 ~1s 但 swiftshader ~3fps → 只拍到 1–3 幀。擷取時把 `battleCinematic.ts` 的
   `CUTIN_CHARGE_MS`(720→2200)/`CUTIN_STAMP_FREEZE_MS`(120→550) 暫時拉長，多取幾幀，事後一併 `git checkout` 還原。
3. **抓幀用 `Page.startScreencast`（format jpeg）**，不要 `Page.captureScreenshot`（重頁 ~1s/張）。先到 `.star-orb`、
   開 screencast、`o.click()`、收 ~5s 幀、`Page.stopScreencast`。組圖：`ffmpeg -framerate 9 -i g%03d.jpg ... palettegen` →
   GIF；`-f apng` → APNG（ffmpeg 7.1 + apngasm 在 PATH）。本次成品在專案根 `starstrike.gif`/`starstrike-apng.png`（已 gitignore）。
4. 寫 `~/Desktop` 會被 macOS TCC 擋；改寫專案目錄或 `~/`。

## Suggested skills
- **`/agent-chat`** — 開 EXT.3（或任何 EXT）前先開四方圓桌敲定方向、動工前請各 agent 畫 ASCII 示意圖確認，
  本 session 證實這流程能避免「做完才發現方向錯」（星擊重做即此教訓）。結論存 `.claude/agent-chat/*/conclusion.md`。
- **`/code-review`、`/simplify`** — commit 前對 UI/FX 改動把關（效能紅線：高頻值走 ref/rAF/DOM 不進 React state；
  暫態 Tone/Canvas 節點要 dispose；iPad Safari 別在 WebGL 上疊 mix-blend）。
- **`/codex`** — 使用者已授權「需要做圖就叫 codex，等久一點」；要更華麗的 cut-in 運鏡/粒子可交給它，接回現有
  `cinematicCoordinator` seam（介面已備，不必重構）。
- **`/run` 或 Chrome CDP** — browser-driven 驗證；星擊類擷取照上方「擷取配方」（臨時插樁 + screencast）。
- **`/karpathy-guidelines`** — EXT.3 起加視覺時保持 surgical、純 display、可驗證、勿違反硬約束。
