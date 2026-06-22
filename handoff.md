# Handoff — pokemon-mezastar

接手者請先讀本檔，再讀 `plan/`（設計真相在那裡，本檔不重複）。專案為 **iPad 為主、自用的 Pokémon Mezastar 風格遊戲**，Web/PWA。

---

## 1. 現況一句話
**M1.x 全部完成並實機驗證**（M1 + M1.5 a–h）：3v3 戰鬥、主動換人＋防禦 QTE、FxCanvas 粒子、Tone.js 音效、個體差異、成長＋持久化、意外機制（支援/球輪盤+連打蓄力+RandomEvent）、星擊 Finisher。**M1.x 里程碑達成。** 下一步進入 **M2（QR 掃描 + 卡庫）**（見 `plan/04-milestone-M2.md` / CHECKLIST M2）。

> **內容擴充（2026-06-22）**：圖鑑由 12 隻擴到 **全國 dex 1–251**、區域由 3 個擴到 **8 個主題區**（覆蓋全 18 型、等級帶遞增、各區末項為高等 boss）、起始 roster 由 5 隻擴到 **跨屬性 16 隻**。資料（zh-Hant 名/屬性/種族值）全由 PokéAPI 經 **`scripts/gen_dex.mjs`** 一次性產生（`node scripts/gen_dex.mjs` 可重產）；artwork 走官方 raw URL、runtime 載入、**不內建侵權資產**。`moves.ts` 改為 18 型×3 power tier 主題招式池，species.moveId 依主屬性+BST tier 決定論指派。`src/game/data/{species,moves,regions,playerCards}.ts` 為**產生檔，請勿手改**——要改改產生器。持久化 KEY bump 至 `mz.roster.v2`（讓既有存檔重新種子出新 roster）。typecheck/64 測試/build 全綠；Chrome CDP 走完勝/敗兩路徑、iPad (A16) 模擬器實機載入皆正常。

> commit 節奏：使用者要求**每個小階段自動 commit**（見 memory `auto-commit-per-stage`）。每步驗證綠燈即 commit。typecheck/build/test（32）全綠。

## 2. 真相來源（不要重抄，直接讀）
- 設計總覽與里程碑：`plan/README.md`
- 架構/資料模型/狀態機/QR/戰鬥：`plan/01-architecture.md`
- 各里程碑：`plan/02-milestone-M1.md` … `05-milestone-M4.md`
- **對戰常識查證**（Bulbapedia：傷害公式/相剋/會心/先制/狀態/能力值/性格表/經驗）：`plan/06-battle-reference.md`
- **意外機制 + 個體差異/成長設計**（Mezastar 機台查證 + 三方共識）：`plan/07-systems-design.md`
- **獨立進度勾選表**：`plan/CHECKLIST.md`（M0、M1 已勾完；M1.5a–h 待做）
- 三方 agent-chat 結論（決策脈絡與分歧收斂）：
  - `.claude/agent-chat/session-20260622-145615/conclusion.md`（技術棧定案）
  - `.claude/agent-chat/session-20260622-161613/conclusion.md`（3v3+換人+聲光）
  - `.claude/agent-chat/session-20260622-163656/conclusion.md`（意外機制+個體/成長）
- 反安裝說明（含機器原有套件勿動）：`uninstall.txt`

## 3. 已完成（git log）
- `9cd91a0` **M1**：XState 流程（title→region→encounter→cardSelect→battle→result）、12 種族 seed、18 型相剋表、戰鬥引擎（`resolveAttack`）21 vitest 全綠、直/橫式實機截圖驗證勝敗兩路徑。
- `f54db94` docs：對戰常識查證 + 3v3/換人/聲光設計。
- `fed020b` docs：意外機制 + 個體差異/成長性設計。
- `3e7fb96` **M1.5a reducer 地基**：`engine.damageMult`/`defenseMultiplier`、`reducer.ts`（`resolveTurn` 純函數 + 5 domain events + `applyForcedSwitch`）、11 測試。
- **（未 commit）M1.5a UI 接線**：見 §5、§1。

## 4. 程式碼地圖（`src/`）
- `game/types.ts` 型別；`game/data/`（typeChart 相剋表+測試、species/moves/regions/playerCards seed）；`game/stats.ts` 能力值；`game/encounter.ts`（`rollEncounter` + `rollEncounterTeam` 3 隻）。
- `game/battle/engine.ts`（`resolveAttack` + `qteMultiplier`/`defenseMultiplier`/`damageMult` + 測試）；**`game/battle/reducer.ts`（3v3 純 reducer + 測試）**；`game/machine/gameMachine.ts`（XState 流程，context 帶 `playerTeam`/`foeTeam`、`TEAM_SIZE`）。
- `store/battleStore.ts`（Zustand，**已改 party**：持 `BattleState`(display) + `setMemberHp`/`setActiveIndex`/`setBattle`/`showHit`… 逐 event setter）。
- `input/qte.ts`（`qualityFromPointer` 共用 seam，攻擊/防禦 QTE 共用）。
- `ui/`：screens（Title/RegionSelect/Encounter[對手3隻縮圖]/CardSelect[多選3]/Battle[reducer 驅動+隊伍 tray]/Result[捕獲 boss]）、components（HpBar/TypeBadge/PokemonSprite/TimingBar）、`styles/global.css`（加 `.tray`/`.poke-card--picked`）。

## 5. 已完成：M1.5a 完整（reducer 已 commit `3e7fb96`；UI 接線未 commit）
**純 reducer**（`src/game/battle/reducer.ts`，無 UI/動畫字眼）：
- 型別：`Side` / `BattleSide`(members[≤3]+activeIndex) / `BattleState`(player/foe/turn/winner) / `BattleAction`(`ATTACK{quality?}` | `SWITCH{index,defenseQuality?}`) / `BattleEvent`（5 種 domain events）/ `TurnResult`。
- `createBattleState`、`resolveTurn(state, action, {rng}) → {nextState, events}`。ATTACK 依速度先後手、先手秒殺則後手略過、倒下 `applyForcedSwitch` 依序換、全滅 `battleEnded`。SWITCH 防禦 QTE 抵減（`defenseMultiplier` perfect .1/good .4/normal .7/weak 1）、換上即倒立即強制換。
- **注意**：經 SWITCH「換上即倒」**不會**讓玩家全滅（被換下的原 active 仍存活可接回）。`RandomEvent` 統一格式留 **M1.5g**。

**UI 接線（已實作＋實機驗證，未 commit）**：
- `gameMachine` context = `playerTeam`/`foeTeam`（各 3）、`TEAM_SIZE`；`rollEncounterTeam` roll 3 隻、末隻 boss；`SELECT_TEAM{cards}`。
- `CardSelectScreen` 多選 3（序號徽章、n/3、選滿才解鎖）；`EncounterScreen` 對手 3 隻縮圖（boss 描金邊）。
- `battleStore` 改持 `BattleState`(display) + `setMemberHp/setActiveIndex/setBattle/showHit/...`。
- `BattleScreen` 用 `resolveTurn` 算整回合 → **依序消費 events 演出**（damage=lunge+受擊+浮傷+HP tween；fainted；activeChanged=換上入場；end=won/lost）→ `setBattle(nextState)` 收尾；底部雙方隊伍 tray（3 HP pip + 倒下灰階/✕ + active 高亮）。
- `ResultScreen` 捕獲對象＝foeTeam 末隻 boss；LoseView 用 playerTeam lead。
- 驗證：Chrome headless+CDP 跑完整 loop，**勝利並捕獲 boss**（截圖在 `/tmp/mz_shots/`）。

## 5b. 已完成 M1.5b：主動換人 + 防禦 QTE（實機驗證）
- 行動選單「攻擊 / 換人」；`SwitchPanel`（player 隊友卡，active/倒下/剛換下 disabled）→ 選人 → **防禦 QTE**（`TimingBar` 加 `hint` prop）→ `runSwitchTurn` 呼 `resolveTurn(SWITCH)` → 依序演出 `activeChanged(forced:false)`/`switchDefenseResolved`(banner 減傷%)/`damageApplied`。
- 防濫用在 **display 層**：換人＝整回合；`lockedIndex` 鎖住剛換下的那隻一回合（攻擊後解鎖）。reducer 維持純淨。
- 驗證：換人面板→傑尼龜換上→對手剋制攻擊（效果絕佳/減傷 30%）正確。

## 下一步：M1.5e → f → g → h（完成全部 M1.x）
- **c 視覺特效** ✅、**d 音效** ✅（`audio/audioEngine`，Tone.js 動態 import，SFX+BGM+intensity，驗證零錯）。
- **e 個體差異**：`individual.ts`（seed→ivs/nature/shiny 決定論）、`stats.ts` 補 nature 乘數、個體 UI（星級/紅藍色標/異色）+ 測試。
- **f 成長**：`growth.ts`（n^3 曲線/gainExp/levelUp）、`OwnedUnit`(canonical) vs `BattleUnit`、`PersistenceAdapter`+`LocalStorageAdapter`（只存 canonical）+ 測試。
- **g 意外**：統一 `RandomEvent`、支援輪盤（每 N 回合 攻擊UP/必定會心/支援補刀/摃龜）、捕獲球輪盤、連打蓄力 + 測試。
- **h 星擊**：QTE/連鎖累積能量槽（不綁隨機）+ 自製大招演出。
- 細節真相見 `plan/06`（對戰常識）、`plan/07`（意外+個體/成長）。

## 6. 硬性約束 / 偏好（務必遵守）
- **平台 Web/PWA**（使用者已拍板，非原生 iOS；原生留作日後效能逃生路線）。
- **不內建/不抓取/不散布侵權資產**：模型由使用者本機 drop-in；音效全程序化合成；造型 fallback 用 PokéAPI artwork。
- **安裝套件前先逐項說明**再裝（使用者要求）。用 **npm**（非 pnpm）。
- 目標是**精美、有趣、完整**的遊戲，不要略過細節。
- **效能紅線**：高頻值（QTE 指針、MediaPipe 座標）只走 ref/rAF/Zustand，**不寫 React 頂層 state**。
- **純 reducer 不含 UI/動畫字眼**；持久化只存 canonical `OwnedUnit`，不存 derived/RNG 中間態。

## 7. 如何跑 / 驗證
- 開發：`cd pokemon-mezastar && npm install && npm run dev`（Vite，預設 5173）。
- 型別/建置：`npm run typecheck`、`npm run build`。
- 測試：`npm test`（vitest）。
- 視覺驗證（無 playwright/chromium-cli）：本機有 Google Chrome，可用 `--headless=new --remote-debugging-port=9222` + Node 24 內建 WebSocket 寫 CDP 腳本截圖（按鈕用 `el.click()`，QTE 區需 dispatch `PointerEvent('pointerdown')`）。前次截圖在 `/tmp/mz_shots/`（會隨重開機清掉）。

## 8. 已知坑
- `vite.config.ts` 故意**不在 `tsconfig.json` 的 include**（避免 node:url / vitest `test` 欄位的型別錯誤；它由 esbuild 轉譯、runtime 才跑）。
- iOS Safari 音訊需**首次觸控解鎖 AudioContext**；Tone.js 要在解鎖時才**動態 import**（控 bundle）。
- M1 為求 offline 用本地 seed 資料；造型走 PokéAPI 官方 artwork raw URL（runtime 載入，有 skeleton fallback）。

## Suggested skills
- **`/agent-chat`** — 遇到開放式設計抉擇時（這專案前三個大決策都用它三方收斂）。先上網查證再開，效果最好。
- **`/run`** — 啟動 app 並截圖驗證「精美度」與完整 loop（本專案是 browser-driven，用 Chrome headless + CDP）。
- **`/karpathy-guidelines`** — 寫/改碼時保持 surgical、簡潔、可驗證（本專案已沿用）。
- **`/code-review`** 或 **`/simplify`** — 實作完一個 M1.5 子步後做品質把關。
- 安裝前說明、Web/PWA、精美不略過等偏好已存在 memory（`pokemon-mezastar-project`、`explain-before-install`），新 session 會自動帶入。
