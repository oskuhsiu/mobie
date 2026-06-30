# Handoff — mobie

**精簡版：只記「現況／最近完成／下一步」。** 設計真相在 `plan/`、架構與已知坑在 `ARCHITECTURE.md`、
硬性約束在 `CLAUDE.md`（已自動載入）、里程碑勾選在 `plan/CHECKLIST.md`、完整歷史在 `git log`——
本檔不重抄這些，過時就刪。專案＝iPad 為主、自用的 Pokémon Mezastar 風格遊戲，Web/PWA。

## 現況
**M0–M22 全部完成**並 Chrome CDP 驗證；版號 v0.1.19。內容＝全國圖鑑 1–1025（G1–G9）、16 主題野外區 +
競技場 + 連勝塔、16 起始卡。下一輪主路線＝**EXT 強化系列**（`plan/EXT.0`，尚未動工）。

**本 session 已完成並提交：** 戰鬥「力量 / 集氣」大圓點擊範圍（typecheck / 428 test / build 全綠、已 commit）。
dev server 跑在 `http://localhost:5173/`（使用者自測中）。

## 真相來源（先讀，別重抄）
- 架構 / 分層 / 資料流 / 不變式 / 已知坑 / CDP 驗證：`ARCHITECTURE.md`（§10 坑、§11 驗證 ≈ 第 277 行起）
- 硬性約束與偏好：`CLAUDE.md`　·　跑法：`README.md`
- 設計總覽 + 各里程碑：`plan/README.md`、`plan/NN-*.md`、`plan/EXT.*`
- 哪些做了 / 沒做：`plan/CHECKLIST.md`　·　決策脈絡：`.claude/agent-chat/*/conclusion.md`

## 最近完成（本 session，已提交）— 戰鬥「力量 / 集氣」大圓點擊範圍
> 使用者需求原話：力量選擇 bar（攻擊發動前）與集氣的點擊範圍要大，最好戰鬥畫面中心「那一圈」都能點；
> 要有圓形 blur 感範圍提示（力量＝透明白、集氣＝不同色）；集氣點擊要有「強烈的點擊互動感」。
> **純顯示層**：未碰 reducer/engine/持久化，符合 EXT.1「局內爽感」精神。

改動三檔（`git status` 可見）：
- `src/ui/components/TimingBar.tsx`：root 包成 `.tap-field.tap-field--timing`（半透明白 blur 大圓，
  `min(82vw,60vh,520px)`），`onPointerDown` 移到外圈→圈內任意處都停指針；原 `.qte` bar 降為圈中央 `.tap-field__inner`。
  **此 component 被 qte / statusQte / defenseQte(off) / chainQte 共用→全部變白圈（一致）。**
- `src/ui/screens/BattleScreen.tsx`：`MashMeter` 重寫為 `.tap-field.tap-field--charge`（橘色 blur 大圓）；
  每次點擊：點處噴 `.tap-field__ripple`（8 個 DOM 池循環）+ 整圈 `is-hit` 瞬縮 thump，**全走 DOM class
  重觸發（`offsetWidth` reflow trick），不過 React state**（守效能紅線）。import 加 `type PointerEvent as ReactPointerEvent`。
- `src/ui/styles/global.css`：新增 `.tap-field*` 全套（glow/breathe/ripple/hit 動畫、timing 白＋charge 橘兩變體）
  + `.battle-action:has(.tap-field)` 去掉外層方卡（避免大圓外再框一層）。**用到 CSS `:has()`**（iPad Safari 15.4+ OK）。
  未用 `.tap-field` 的增強模式元件（`RhythmTap` 攻擊節奏 / `ShieldSwipe` 防禦下滑，皆預設 off）維持原方卡外觀、未動。

驗證狀態：
- ✅ typecheck 綠 · ✅ `npm test` 428 全綠 · ✅ `npm run build` 綠（864KB chunk 警告是既有 bundle follow-up，非本次引入）。
- ✅ Chrome CDP 實機：集氣橘圈 + blur + 連點進度條正確，截圖 `/private/tmp/mz_shots/mash-circle.png`。
- ⚠️ **白圈（timing）未拿到乾淨單張截圖**：相位會自動逾時循環（playerChoice 8s → qte 10s → mash 2.8s →
  解算 → 下一輪），且戰鬥易自動打完。已確認 `.tap-field--timing` 確實渲染（className/rect 量到 520px），
  但建議下一手或靠使用者自測再目視確認白圈與漣漪 mid-animation。

## 下一步
1. **收使用者自測回饋**（集氣手感夠不夠爽）。可能加碼：更大 thump / Haptics 震動（Vibration API，屬 EXT.1 C1）/
   點擊噴粒子 / 力量圈也加單擊回饋。使用者曾說「不知道怎麼弄就叫 codex 畫」→ 要更華麗可走 `/codex`。
2. 之後回主路線 **EXT 強化系列**（`plan/EXT.0`）：EXT.1 局內爽感（這次的大圓正是其一環）→ EXT.2 星擊電影化
   → EXT.3 地形/天氣視覺化 → EXT.4 狀態異常 module（唯一動 reducer）→ EXT.5 養成 meta。

## 其他未完成 / 待辦（皆非阻塞，詳見舊紀錄）
- 稀疏初始配招（memory `mobie-sparse-initial-loadout`）；bundle 分檔（主 bundle 864KB）。
- M18.e repo 目錄 + git remote 改名 `pokemon-mezastar`→`mobie`（**待使用者本機執行**）。
- 棄置：M4 體感、M20 DQ 來源、M11 backlog。
- follow-up：氣勢披帶/威嚇需動 engine 縫；`.save` 未含 itembag/meta/incubator/playerskills/skillpoints；
  framer 4 個置中 overlay 仍用 translate（memory `framer-centering-overlays-followup`）；M19.e moveLearned 結算 UI。

## 跑 / 驗證
`npm install`（設 git hook）→ `npm run dev`（5173；現正在跑）；`npm run typecheck` / `npm test` / `npm run build`。
視覺/E2E 無 Playwright：本機 Google Chrome headless + CDP（Node 24 內建 WebSocket）。**戰鬥畫面必帶**
`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`（R3F 要 GL context）。詳見 `ARCHITECTURE.md §10/§11`。

**本 session 的 CDP 小工具（scratchpad，可重用）**：`cdp.mjs`（吃 JS 檔在頁面執行 + 可選截圖）、
`probe.js`/`probe2.js`（dump 畫面 clickables）、`step.js`（依 text 陣列依序點擊）、`driverA.js`（再戰→點招式槽→等 timing 圈）。
Chrome 已 headless 起在 port 9222（profile 在 scratchpad/chrome-profile）；驅動流程：開始遊戲→常綠森林→出戰→
✨ 推薦出戰→⚔ 出戰→戰鬥；招式槽 class＝`.move-slot`，大圓＝`.tap-field`（`--timing`白 / `--charge`橘）。

## Suggested skills
- **`/code-review`、`/simplify`** — commit 前對這次 UI 改動做品質把關（CSS `:has()` 相容、ripple 池無洩漏、效能紅線）。
- **`/codex`（或 codex-code/codex-review）** — 若使用者要更華麗的集氣點擊特效，照其指示交給 codex 設計。
- **`/run` 或 Chrome CDP** — 啟動 app 截圖驗證白圈/漣漪（本專案 browser-driven；上面已有可重用工具）。
- **`/karpathy-guidelines`** — 加碼特效時保持 surgical、純顯示、可驗證。
- **`/agent-chat`** — 進 EXT 系列下一項前的開放式設計抉擇（先上網查證再開）。
