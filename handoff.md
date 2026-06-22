# Handoff — pokemon-mezastar

接手者請先讀本檔，再讀 `plan/`（設計真相在那裡，本檔不重複）。專案為 **iPad 為主、自用的 Pokémon Mezastar 風格遊戲**，Web/PWA。

---

## 1. 現況一句話
M1（純觸控完整 game loop）**已完成並驗證**；M1.5a 的**純邏輯地基（戰鬥 reducer + 11 測試 + engine `damageMult`）已實作並全綠（typecheck/build/test 皆過）**，但**尚未接線到 UI**（遊戲執行時仍是舊的 1v1 store；reducer 目前只被測試引用）。下一步是 **M1.5a 的 UI 接線 → 真正可玩 3v3**（見 §5）。

> ⚠️ 工作樹**有未 commit 變更**（`engine.ts` 加 option、新增 `reducer.ts` + `reducer.test.ts`、更新 `CHECKLIST.md`/本檔）。使用者全域規則為「**未經要求不 commit**」，故留待使用者決定。

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

## 4. 程式碼地圖（`src/`）
- `game/types.ts` 型別；`game/data/`（typeChart 相剋表+測試、species/moves/regions/playerCards seed）；`game/stats.ts` 能力值；`game/encounter.ts` 野生生成。
- `game/battle/engine.ts`（`resolveAttack` 純函數 + 測試）；`game/machine/gameMachine.ts`（XState 流程）。
- `store/battleStore.ts`（Zustand，**目前是 1v1**，M1.5a 要改成 party+activeIndex）。
- `input/qte.ts`（`qualityFromPointer` 共用 seam）。
- `ui/`：screens（Title/RegionSelect/Encounter/CardSelect/Battle/Result）、components（HpBar/TypeBadge/PokemonSprite/TimingBar）、`styles/global.css`。

## 5. 已完成：M1.5a 純 reducer 地基（已實作、未 commit）
`src/game/battle/reducer.ts`（純函數，無 UI/動畫字眼）：
- 型別：`Side` / `BattleSide`(members[≤3]+activeIndex) / `BattleState`(player/foe/turn/winner) / `BattleAction`(`ATTACK{quality?}` | `SWITCH{index,defenseQuality?}`) / `BattleEvent`（5 種 domain events）/ `TurnResult{nextState,events}`。
- `createBattleState(playerMembers, foeMembers)`、`resolveTurn(state, action, {rng}) → {nextState, events}`。
- ATTACK：依速度先後手雙方各打一次；先手秒掉後手 active → 後手該攻擊略過；倒下 `applyForcedSwitch` 依序送下一隻、無人可換→該方落敗 `battleEnded`。
- SWITCH：玩家換上 index（耗攻擊權）→ 對手打換上的一隻 → `defenseMultiplier`(perfect .1/good .4/normal .7/weak 1) 抵減；換上即倒→立即強制換。**注意**：經 SWITCH 換上即倒**不會**讓玩家全滅（被換下的原 active 仍存活可接回）。
- `engine.ts` 既有 `resolveAttack` 不動語意，新增 `damageMult` option + `defenseMultiplier()`；既有 21 測試仍綠。
- `RandomEvent` 統一格式**未做**——依 `CHECKLIST` 屬 **M1.5g**（意外機制）才導入，本步只出 5 種 domain events。

## 5b. 下一步：M1.5a UI 接線 → 可玩 3v3（attack-only，併 M1.5b 隊伍 tray）
讓遊戲真的跑 3v3（先不做手動換人按鈕/防禦 QTE，那是 M1.5b）：
- `gameMachine`：context `wild/playerCard` → `foeTeam: Card[3]` / `playerTeam: Card[3]`；`SELECT_REGION` 改 roll 3 隻（`encounter.ts` 加 `rollEncounterTeam`，最後一隻當 boss/可捕）；`SELECT_CARD` → `SELECT_TEAM{cards}`。
- `CardSelectScreen`：改多選 3 隻（選滿 3 才能出戰，含已選計數/取消）。
- `EncounterScreen`：顯示對手隊伍 lead（+2 待命提示）。
- `battleStore`：改持 `BattleState`(display) + 顯示欄位；提供 `setMemberHp/setActiveIndex/setBattle/setAttacking/setHitFx/setBanner/setPhase/pushLog`。
- `BattleScreen`：玩家攻擊 QTE → `resolveTurn(battle, {type:'ATTACK',quality})` → **依序消費 events** 演出（damageApplied=lunge+受擊+浮傷+HP tween；memberFainted=淡出；activeChanged=換上入場；battleEnded=won/lost），結束 `setBattle(nextState)` 收尾。底部隊伍 tray：雙方各 3 顆 HP pip + 倒下灰階 + active 高亮。
- `ResultScreen`：捕獲對象＝對手 boss（foeTeam 末隻）；LoseView 用 playerTeam lead。
- 用 **`/run`**（Chrome headless+CDP）截圖驗證 3v3 依序換上、勝/敗兩路徑、直/橫式。

後續順序：M1.5b 手動換人+防禦 QTE+tray 互動 → c 視覺特效(FxCanvas+framer) → d 音效(Tone.js audioEngine) → e 個體差異 → f 成長(+PersistenceAdapter localStorage) → g 意外(輪盤+`RandomEvent`) → h 星擊。

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
