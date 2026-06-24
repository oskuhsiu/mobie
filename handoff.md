# Handoff — mobie

**精簡版：只記「現況／最近完成／下一步」。** 設計真相在 `plan/`、架構與已知坑在 `ARCHITECTURE.md`、
硬性約束在 `CLAUDE.md`（已自動載入）、里程碑勾選在 `plan/CHECKLIST.md`、完整歷史在 `git log`——
本檔不重抄這些，過時就刪。專案＝iPad 為主、自用的 Pokémon Mezastar 風格遊戲，Web/PWA。

## 現況
M0–M11 + M16–M22 全部完成並 Chrome CDP 驗證；**typecheck / build / 372 測試全綠**。
版號 v0.1.x（每次 commit 自動升 patch、首頁顯示）。內容＝全國圖鑑 1–251、8 主題區（+競技場）、16 起始卡。

## 真相來源（先讀，別重抄）
- 架構 / 分層 / 資料流 / 不變式 / 已知坑 / CDP 驗證：`ARCHITECTURE.md`（§10 坑、§11 驗證）
- 硬性約束與偏好：`CLAUDE.md`　·　跑法：`README.md`
- 設計總覽 + 各里程碑設計：`plan/README.md`、`plan/NN-*.md`
- 哪些做了 / 沒做：`plan/CHECKLIST.md`　·　對戰常識查證：`plan/06-battle-reference.md`
- 決策脈絡：`.claude/agent-chat/*/conclusion.md`　·　智財宣告：`ATTRIBUTION.md`

## 最近完成（已 push origin/main）
1. **玩測回饋 5 修**（commit `4e85731`…`9ef72ac`）：①隊伍頁點 Mobie 開 `MobCard` 資訊卡（選單裡也看得到自己 Mobie 詳情）②抽 `ui/components/ToolsMenu` 共用到 RegionSelect 中樞 + 🏠首頁鈕（gameMachine regionSelect `BACK→title`）③設定移除 tower 誤導開關（連勝塔是 RegionSelect 進入的**模式**、非掛載模組）④QTE/連打抬到戰鬥區中央 `.battle-action`（**flex 層置中**，非 transform）⑤連打視窗 950ms→2.8s + 倒數條。
2. **版號 + 自動升版**（commit `06bd115`）：`vite.config` 注入 `__APP_VERSION__`（＝`package.json` 版號），首頁 eyebrow 顯示 `v{版號}`；`.githooks/pre-commit`→`scripts/bump-version.mjs` 每次 commit 升 patch 並同步 `package-lock`，`prepare` script 於 `npm install` 設 `core.hooksPath`。注意：amend/rebase 會再升一次；新 clone 須先 `npm install` 才有 hook。

## 下一步（擇一）
- **稀疏初始配招**（使用者已拍板、最小改動、不碰戰鬥核心）：`autoEquip`→`rollInitialLoadout(species,level,seed)` 種子決定論，每隻≥1 招、排除星擊+威力95、招數＝等級基底+稀有加成，靠訓練補滿。詳見 memory `mobie-sparse-initial-loadout`。
- **M14 戰鬥回放**（玩法最完整、event 詞彙已齊）：先做 seeded RNG 地基（抽 `game/rng.ts`）→ codec → 文字戰報 → 錄製 → 播放器。見 `plan/15` + CHECKLIST M14。

## 尚未做的里程碑（細節見 CHECKLIST）
- **M4** MediaPipe 體感 —— 使用者略過（M22 觸控手勢為同源前身）。
- **M12** 剩餘：合體技（ComboDef+連鎖升級）／對手 Encounter Skill Profile／孵化技能繼承／`fieldState.comboCastEffects` 子欄。（核心「多招式／玩家技能」已由 M19/M17 提前做掉。）
- **M13** 內容補完 G3→G9（252–1025）+ 天氣/場地/特殊型地形。
- **M14** 戰鬥回放（整段）。
- **M18.e** repo 目錄 + git remote 改名 `pokemon-mezastar`→`mobie` —— **待使用者本機執行**。
- **M20** DQ 來源 ⛔ 已棄置（無官方 API）。　**M15** 已被 M18 取代（只剩 M18.e）。
- backlog：M11 暴擊潮等 / M21.e per-type 音色 / M22.f–j 互動（防禦下滑·攻擊節奏·撥草·孵化·連勝塔選路）。

## 開放 follow-up（不阻塞）
- 氣勢披帶需 post-damage 縫、威嚇需 onSwitchIn 縫（皆改 engine/reducer，刻意延後）。
- `.save` 匯出尚未含 `mobie.itembag/meta/incubator/playerskills/skillpoints` slice（roster 內 heldItemId/learnedMoveIds 已含）。
- 看穿目前「每場一次、揭露當下 active」，對手換上後無法再看穿（待玩測 per-battle vs per-creature）。
- framer-motion 動 scale/y 蓋掉 CSS `translate(-50%)` 置中——`star-orb`/`battle-banner`/`support-overlay`/`combo-overlay` 4 個仍用舊法、可能輕微偏移，待比照 `.battle-action-layer` 統一（memory `framer-centering-overlays-followup`）。
- M19.e：moveLearned 結算提示 UI、招式回憶顯式分頁。

## 跑 / 驗證
`npm install`（會設 git hook）→ `npm run dev`（5173）；`npm run typecheck` / `npm test` / `npm run build`。
視覺/E2E 無 Playwright：本機 Google Chrome headless + CDP（Node 24 內建 WebSocket）。**戰鬥畫面必帶**
`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`（R3F 要 GL context）。其餘 CDP
細節（戰鬥 loop 驅動、按鈕字串雷區、存檔匯入匯出）見 `ARCHITECTURE.md §10/§11`。

## Suggested skills
- `/agent-chat` — 開放式設計抉擇（先上網查證再開，這專案前幾個大決策都用它收斂）。
- `/run` 或 Chrome CDP — 啟動 app 截圖驗證完整 loop（本專案 browser-driven）。
- `/code-review`、`/simplify` — 子步綠燈 commit 前品質把關。
- `/karpathy-guidelines` — 寫/改碼保持 surgical、簡潔、可驗證。
