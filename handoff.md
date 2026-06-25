# Handoff — mobie

**精簡版：只記「現況／最近完成／下一步」。** 設計真相在 `plan/`、架構與已知坑在 `ARCHITECTURE.md`、
硬性約束在 `CLAUDE.md`（已自動載入）、里程碑勾選在 `plan/CHECKLIST.md`、完整歷史在 `git log`——
本檔不重抄這些，過時就刪。專案＝iPad 為主、自用的 Pokémon Mezastar 風格遊戲，Web/PWA。

## 現況
**M0–M22 全部完成**並 Chrome CDP 驗證；**typecheck / build / 428 測試全綠**。
版號 v0.1.x（每次 commit 自動升 patch、首頁顯示）。內容＝**全國圖鑑 1–1025（G1–G9）**、**16 主題野外區**
（含天氣/場地/特殊/混合/隨機地形）+ 競技場 + 連勝塔、16 起始卡。
最後一輪（本 session）補完 M12（合體技/對手 profile/孵化繼承/fieldState）、M13（dex G3–G9 + 地形擴充）、
M14（戰鬥回放整段）、M21.e（per-type 音色）、M22.f–j（增強互動 backlog）。

## 真相來源（先讀，別重抄）
- 架構 / 分層 / 資料流 / 不變式 / 已知坑 / CDP 驗證：`ARCHITECTURE.md`（§10 坑、§11 驗證）
- 硬性約束與偏好：`CLAUDE.md`　·　跑法：`README.md`
- 設計總覽 + 各里程碑設計：`plan/README.md`、`plan/NN-*.md`
- 哪些做了 / 沒做：`plan/CHECKLIST.md`　·　對戰常識查證：`plan/06-battle-reference.md`
- 決策脈絡：`.claude/agent-chat/*/conclusion.md`　·　智財宣告：`ATTRIBUTION.md`

## 最近完成（本 session，已 push origin/main：14 commits `ce96720..bb9a316`）
1. **M14 戰鬥回放整段**：抽 `game/rng.ts`（seeded RNG，BattleScreen 整場單一 stream）→ `game/replay/{types,codec,report}`
   （canonical JSON log + 穩定鍵序 encode/分類錯誤 decode/crc + 中文戰報投影器，KNOWN_EVENT_MAP 綁 BattleEvent union
   做耦合治理）→ `store/replayRecorder` + IDB `mz-replays`（去重 + FIFO 50）→ `ReplayPlayerModal`（折疊事件重建 HP/active
   + 戰報側欄同步 + 播放控制）+ `ReplayListModal`（Title🎬入口 + .txt 匯出）。開關＝`prefs.recordReplays`（預設 off）。
2. **M12 合體技等**：`ext/combo`（ComboDef + 純 matchCombo + 注入 ext.combo，連鎖後段升級合成大招 + 施放效果寫
   fieldState；usedComboKeys 每場一次；ModuleId `combo`）+ `fieldState.comboCastEffects` 子欄 + `encounterProfile`
   （對手 0–2 反射標籤，ModuleId `encounterSkills`）+ 孵化蛋招繼承（Egg.inheritedMoveId）。回放 bump v2 + migrate。
3. **M13 內容補完**：gen_dex `MAX_ID 251→1025` 重產（dex G1–G9、型別主題區自動納入晚代物種、16 區）+ 11 種天氣/場地/特殊地形。
4. **M21.e** per-type 音色（6 音色家族）；**M22.f–j** 防禦下滑/攻擊節奏/撥草/孵化/破門（皆 prefs，預設 off 零殘留）。

## 下一步（擇一，皆非阻塞）
- **EXT 強化系列（新，四方圓桌收斂）**：`plan/EXT.0` 強化報告＝下一輪 13 項（遊戲性/視覺/操作性）優先級分層；細拆 `plan/EXT.1`（局內爽感 B1+C1+C3+B4+C2，純 display 先做）→ `EXT.2` 星擊電影化 → `EXT.3` 地形視覺化 → `EXT.4` 狀態異常 module（唯一動 reducer）→ `EXT.5` 養成 meta。結論 `.claude/agent-chat/session-20260625-092816/`。
- **稀疏初始配招**（使用者已拍板、最小改動）：`autoEquip`→`rollInitialLoadout`。詳見 memory `mobie-sparse-initial-loadout`。
- **bundle 分檔**：dex 1025 後主 bundle 864KB（gzip 219KB）——species.ts 可按需/分檔載入（plan/13 §4 已記）。
- **M18.e** repo 目錄 + git remote 改名 `pokemon-mezastar`→`mobie`（**待使用者本機執行**）。

## 尚未做 / 已棄置
- **M4** MediaPipe 體感 —— 使用者略過（M22 觸控手勢為同源前身）。**M20** DQ 來源 ⛔ 棄置（無官方 API）。**M15** 併入 M18（只剩 M18.e）。
- backlog：M11 暴擊潮/氣象疊加等（暫不做）。

## 開放 follow-up（不阻塞）
- **主 bundle 864KB**（dex 變大）——日後 species 分檔/按需載入（plan/13 §4）。
- 氣勢披帶需 post-damage 縫、威嚇需 onSwitchIn 縫（皆改 engine/reducer，刻意延後）。
- `.save` 匯出尚未含 `mobie.itembag/meta/incubator/playerskills/skillpoints` slice（roster 內 heldItemId/learnedMoveIds 已含）。
- 回放未含 `.txt` 持久化（刻意，存 derived 違反戒律；匯出即時投影）；播放器折疊 HP 重建未含 3D/FX（用 BattleScreen 既有演出層是未竟理想）。
- framer-motion 動 scale/y 蓋掉 CSS `translate(-50%)` 置中——`star-orb`/`battle-banner`/`support-overlay`/`combo-overlay` 4 個仍用舊法（memory `framer-centering-overlays-followup`）。
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
