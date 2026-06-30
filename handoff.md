# Handoff — mobie

**精簡版：只記「現況／最近完成／下一步」。** 設計真相在 `plan/`、架構與已知坑在 `ARCHITECTURE.md`、
硬性約束在 `CLAUDE.md`（已自動載入）、里程碑勾選在 `plan/CHECKLIST.md`、完整歷史在 `git log`——
本檔不重抄這些，過時就刪。專案＝iPad 為主、自用的 Pokémon Mezastar 風格遊戲，Web/PWA。

## 現況
**M0–M22 全部完成**＋ **EXT.1（局內爽感）/ EXT.2（星擊電影化，含三拍 redo）/ EXT.3（地形天氣視覺化）完成**
並 Chrome CDP 驗證；版號 v0.1.36。內容＝全國圖鑑 1–1025（G1–G9）、16 主題野外區 + 競技場 + 連勝塔、16 起始卡。
下一輪主路線＝**EXT.4 狀態異常 module**（`plan/EXT.4`，唯一動 reducer，嚴格 module 化）→ EXT.5 養成 meta。

**本 session 已完成並提交（typecheck / 452 test / build 全綠）：** EXT.3 地形/天氣視覺化全套——
先開 `/agent-chat` 四方圓桌定調（`.claude/agent-chat/session-20260630-220524`，2 輪收斂、含三方 ASCII），
再四階段實作：terrainVisual palette 表 + WeatherCanvas 持續層 + R3F tint/ambient/fog 接線 + terrainShift 過場。
**dev server 仍開在 :5173**（本機真機 GPU 可試玩；headless swiftshader 只 ~3fps 偏頓）。

## 真相來源（先讀，別重抄）
- 架構 / 分層 / 資料流 / 不變式 / 已知坑 / CDP 驗證：`ARCHITECTURE.md`（§10 坑、§11 驗證 ≈ 第 277 行起）
- 硬性約束與偏好：`CLAUDE.md`　·　跑法：`README.md`
- 設計總覽 + 各里程碑：`plan/README.md`、`plan/NN-*.md`、`plan/EXT.*`
- 哪些做了 / 沒做：`plan/CHECKLIST.md`　·　決策脈絡：`.claude/agent-chat/*/conclusion.md`

## 最近完成（本 session，已提交）— EXT.3 地形/天氣視覺化
> 全程**純 display、零碰 reducer/engine/data**；同 seed `nextState` 不變。詳見 `plan/CHECKLIST.md` EXT.3 段。
> 動工前先開 `/agent-chat` 四方圓桌定調（結論 `.claude/agent-chat/session-20260630-220524/conclusion.md`，含三方 ASCII）。

**架構（圓桌定案）**：戰鬥畫面四層 z 序——R3F `BattleStage`(z0) / 新 `WeatherCanvas`(z2) / `FxCanvas`(z5) / DOM HUD(z10)。
**獨立 WeatherCanvas、不碰 FxCanvas**（保住 FxCanvas idle-stop 命脈；mistral 提的「塞進 FxCanvas persistent layer」3:1 否決）。
新增檔：`src/scene/r3f/terrainVisual.ts`（22 terrain → 8 emitter 原型 `rain/snow/sand/ember/electric/wind-petal/mist/none`
＋每 terrain palette{groundTint,ambient,fog?,particleColor,sparkAccent?,overlay?}；**neutral palette＝M22 基線** #0a0e22/#bcd0ff；
辨識度靠 palette 上色非加原型）、`src/scene/fx/WeatherCanvas.tsx`（canvas2D 持續層、8 emitter 自管 rAF + **同等 idle-stop**：
density 0 或 emitter none 無 overlay 即停；池回收不配新物件；sunny god-ray 靜態 overlay）。
改動：`sceneParts.tsx`（StageLights 吃 ambient / ArenaFloor 吃 tint）、`BattleStage.tsx`（加 `<fog>`）、`MobieVisual.tsx`
（立繪材質 `fog={false}` 保讀性——fog 只營造背景地板深度、不洗主角）、`BattleScreen.tsx`（resolve palette 傳舞台、off→undefined＝
基線；掛 WeatherCanvas，**off 不掛/reduced 0.3/full 1.0**；terrainShift 一次性 flash 改用新地形代表色）。

驗證：✅ typecheck · ✅ `npm test` 452 全綠（terrainVisual +9） · ✅ build。✅ Chrome CDP 實機（截圖在本 session scratchpad）：
- **rain**：藍雨絲灑滿 + 冷藍地板 tint + fog 背景深度，立繪銳利；terrain chip 雨天；3 canvas z 序 `["",2,5]`。
- **volcanic**：橘色上升火星(ember) + 暖紅地板 + 紅霧深度；與 rain 辨識度天差地別。
- **juice=off 嚴格回基線**：canvas 數＝**2**、**無 z2 WeatherCanvas**、palette=undefined 無 fog（上半紅底＝`.app` 既有 region
  主題背景 `radial-gradient`，非 EXT.3）。**＝順手補掉了上 session 標記未驗的 off-baseline 回歸。**

## 下一步
1. **收使用者自測回饋**（dev server 仍開 :5173，真機 GPU 看天氣/fog/tint 是否夠美；headless 只 ~3fps 偏頓）。
   若要更華麗的天氣（如真閃電 bolt、體積霧、god-ray 加強），接 `cinematicCoordinator`/WeatherCanvas seam 給 `/codex`。
2. 主路線 **EXT.4 狀態異常 module**（`plan/EXT.4`，**唯一動 reducer**，嚴格 module 化）→ EXT.5 養成 meta。
3. **可選微調**：terrainShift 目前 palette 瞬切 + flash 遮（夠用）；若要真淡入需在 R3F lerp material color（未做、低優先）。

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
