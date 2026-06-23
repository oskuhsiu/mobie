# Handoff — pokemon-mezastar

接手者請先讀本檔，再讀 `plan/`（設計真相在那裡，本檔不重複）。專案為 **iPad 為主、自用的 Pokémon Mezastar 風格遊戲**，Web/PWA。

---

## 1. 現況一句話
**M1.x + M3 + M2 全部完成並 Chrome CDP 驗證**（100 測試 / typecheck / build 全綠）。
- **M1.x**（M1 + M1.5 a–h）：3v3 戰鬥、換人＋防禦 QTE、FxCanvas 粒子、Tone.js 音效、個體差異、成長＋持久化、意外機制、星擊 Finisher。
- **M3（R3F 3D 場景 + 造型層）**：`scene/r3f/` 的 `BattleStage`（地台/光照/相機/ContactShadows，lazy 載入 three）、`PokemonVisual`（①IndexedDB drop-in GLB → ②PokéAPI billboard，正規化+ErrorBoundary）、`Combatant3D`（撲擊/受擊/倒下/入場走 useFrame/ref，imperative `StageHandle`，守效能紅線）、`CaptureStage`（收服 3D）、`ModelManagerModal`（GLB 匯入 UI）。注入測試方塊 GLB 端對端驗證渲染。
- **M2（QR 掃描 + 卡庫）**：`game/cardCode.ts`（MZ1+CRC16 解析，純函數+測試）、`game/cardsImport.ts`（JSON/CSV，純函數+測試）、`game/cardLibrary.ts`（IndexedDB cards 表，PLAYER_CARDS 種子）、`CardScannerModal`（jsQR 相機掃 + 手動輸入後備 + 明確錯誤 UI，掃到→`captureUnit` 入隊去重）、`CardLibraryModal`（檢視/匯入/新增自製卡/可列印 QR 產生器，qrcode）。Title 加「📷 掃卡 / 🗂 卡庫 / 🧩 3D 模型」入口。
- 兩里程碑畫面都經 **三方 agent-chat 設計審查**（P0/P1 已落地，conclusion 在各 session）。**下一步：M4（MediaPipe 體感）或 M5（雲端同步）。**

> M3/M2 新增依賴：`three`/`@react-three/fiber@8`/`@react-three/drei@9`、`jsqr`、`qrcode`。重的 overlay（BattleStage/CaptureStage/掃卡/卡庫/模型）全 lazy，主 bundle ~406KB。**新增 IndexedDB：`mz-models`(GLB blob)、`mz-cards`(cards 表)；roster 仍 `mz.roster.v2`(localStorage)。** `createOwnedUnit` 現吃 card 顯式 ivs/nature/shiny 覆寫 seed roll。已知 follow-up：`cardLibrary`/`modelStore` 的 IndexedDB plumbing 可抽共用 factory（本輪未動已出貨碼）。BarcodeDetector 在 iPad Safari 不可靠 → 掃碼改 jsQR（getUserMedia+canvas），plan 原寫 zxing fallback 不需。

> **內容擴充（2026-06-22）**：圖鑑由 12 隻擴到 **全國 dex 1–251**、區域由 3 個擴到 **8 個主題區**（覆蓋全 18 型、等級帶遞增、各區末項為高等 boss）、起始 roster 由 5 隻擴到 **跨屬性 16 隻**。資料（zh-Hant 名/屬性/種族值）全由 PokéAPI 經 **`scripts/gen_dex.mjs`** 一次性產生（`node scripts/gen_dex.mjs` 可重產）；artwork 走官方 raw URL、runtime 載入、**不內建侵權資產**。`moves.ts` 改為 18 型×3 power tier 主題招式池，species.moveId 依主屬性+BST tier 決定論指派。`src/game/data/{species,moves,regions,playerCards}.ts` 為**產生檔，請勿手改**——要改改產生器。持久化 KEY bump 至 `mz.roster.v2`（讓既有存檔重新種子出新 roster）。typecheck/64 測試/build 全綠；Chrome CDP 走完勝/敗兩路徑、iPad (A16) 模擬器實機載入皆正常。

> **玩測回饋修正（2026-06-22 晚）**：使用者實玩後回報。已做並 Chrome CDP 實機驗證完整 loop：
> 1) **修勝利畫面卡死**（WinView 計時器依賴不穩定 onCaptured 被 cleanup 清掉）→ callback ref + 一次性 effect。
> 2) **捕獲真的入隊**：`rosterStore.captureUnit`（cardId 當 seed，個體與戰鬥一致），收服 boss 加入並存檔。
> 3) **戰敗也給部分經驗**（`grantBattleExp` 加 ratio，`LOSS_EXP_RATIO=0.15`），破解「要先贏才能變強」死結。
> 4) **練習模式**：`practiceRegion`（低等級常見、無傳說 boss）+ `regionLookup`，RegionSelect 練習入口。
> 5) **戰鬥回合上限** `MAX_TURNS=30`（reducer 依剩餘血量判勝，避免免疫/極低傷打不完）。
> 6) **HP 牌貼角色同側**（不易看錯）；**選寶可夢對全 3 隻對手剋制建議 + 一鍵推薦**（`recommend.ts`）。
> 詳見 `plan/07-systems-design.md` H 段。`species/moves/regions/playerCards.ts` 仍為產生檔勿手改；`practiceRegion.ts` 是手動維護的非產生檔。

> **延伸系統設計（2026-06-23，尚未實作）**：上網查 20 個類卡牌戰鬥遊戲特點 → 三方圓桌選 5 個**可模組化、可選式掛載**系統：
> **1 持有道具 / 6 隊伍羈絆 / 5 連鎖攻擊 / 8 進化 / 13 連勝塔遠征**（戰前→戰中→戰後→長線一條龍）。設計＋審查全文 `plan/09-extension-systems.md`，
> 排 **M6**（CHECKLIST 已加 M6.0→a–e）。關鍵地基：統一擴充縫 S1–S8 + `resolveTurn(…, {rng, ext})` 注入純能力包（`ext` 預設 `{}`＝行為等同 M1.x）
> + **§0.4 回合相位契約**（吃速度不寫死先手、starStrike 收成 ATTACK mode、S4 在 timeout 前）。獨立 save slice（itemBag/runState/settings）+ RunState 防火牆（暫態不逆寫 OwnedUnit）。
> Backlog 順位：11 圖鑑成就 > 12 全域療傷 > 15 Ascension。圓桌結論：`.claude/agent-chat/session-20260623-090044`（選 5）+ `session-20260623-090958`（設計審查）。
> M6 為 M2 之後的可選擴充，不阻塞 M2–M5。

> **延伸系統 wave-2（2026-06-23，尚未實作）**：從 wave-1 backlog 再選第二批 5 個：**2 特性 / 10 星級Grade / 11 圖鑑成就 / 15 Ascension / 18 抽蛋孵化**
> （戰鬥深度第二層 + 收集三件套 + 挑戰二階）。設計＋審查全文 `plan/10-extension-systems-wave2.md`（CHECKLIST 已加 M6.f–j）。**幾乎全複用 wave-1 機制**（驗證掛載地基可延展）：
> 特性複用道具 S1/S3/S4 +「換人解析內同步」onSwitchIn(bounded/non-reentrant)；Grade 純派生零 buff 零新欄；圖鑑/孵化只加 meta/incubator 兩獨立 slice；
> Ascension 拆「敵強化 pre-bake 進 buildUnit」vs「回合修飾走 ext」。關鍵護欄：圖鑑三層語義(currentlyOwned 派生 / registered 單調 / seen)防進化倒退；
> 孵化 egg 只存 seed（不存預生成結果）+ 重複轉化只處理新候選不刪既有 + `pendingCaptures` 持久 transaction(exactly-once 防斷線遺失)。
> 12 跨場療傷退回 backlog（改做塔局內 modifier）。圓桌結論：`session-20260623-094704`（選 5）+ `session-20260623-095457`（設計審查）。

> **地形 + 模式分流 + 野外意外 = M7（2026-06-23，尚未實作）**：設計＋圓桌全文 `plan/11-terrain-modes-accidents.md`（CHECKLIST 已加 M7.0–c）。核心擴充（非可選模組）：
> ①**地形影響戰力**——只影響攻擊 power，engine.resolveAttack 在相剋後乘注入的 terrainMult；混合地形逐屬性相乘 + **每屬性夾 [0.5,1.5]**；隨機地形開場決定論抽；
> BattleState 分 initial/current terrains(暫態不持久化)。②**模式 contract** `Region.mode:'arena'|'wild'`——競技場(原練習場)中性地形/無意外/不可捕獲/純經驗但**保留支援輪盤**，
> 野外=地形+捕獲+意外；gating 集中 setup、捕獲改依 mode、移除 isPracticeRegion 散落。③**野外意外×5**(wild-only,走 RandomEvent)：亂入野生(不新增第4隻)/地形突變/天降補給(限開場·戰後)/稀有閃光boss(encounter flag)/幸運加碼(reward)。
> 升級了延伸 backlog #3 場地效果為核心。Backlog：暴擊潮/氣象疊加/狂暴化/背水一戰/狙擊先制。圓桌結論：`session-20260623-102647`。
> 連帶要改：`types.ts`(Region+mode/terrains)、`gen_dex.mjs` REGION_THEMES(重產 regions.ts)、新 `data/terrains.ts`、engine/reducer/BattleState、捕獲 gating。

> **戰鬥技能大模組 = M8（2026-06-23，尚未實作）**：上維基查 weather/terrain/招式學習/合體技(Pledge) → 三方圓桌「好好討論」收斂。全文 `plan/12-battle-skill-module.md`（CHECKLIST 已加 M8.0–e）。
> **守住單招硬約束**：選「技能 loadout(選項A)」——專屬 QTE 大招維持單一＝身分；**技能＝非傷害的主動戰術輔助層**（戰前 loadout 1–2 槽 + 戰中 deterministic 條件自動觸發，buff/debuff/地形/條件改寫，**不可直接大傷害**，直接傷害只留專屬招+合體技/星擊）。
> 特性 vs 技能＝共 S1–S8 hook 引擎、分語義（種族被動 vs 可學主動）。訓練＝SP(boss/塔)買技能+進化解鎖技能槽(非新攻擊招，故 plan/09 §4 仍成立)；繼承＝孵化蛋帶技能(plan/10)。
> **合體技＝連鎖 Combo 變體**（既有 SUBMIT_CHAIN_RESULT 提交 2 符合隊友→合成大招+施放效果三類「灌注地形/全隊增益/敵方弱化」；不吃能量、每組合每場一次 usedComboKeys、與星擊分流）。
> **對手多樣性＝Encounter Skill Profile**（單招+0–2 技能標籤的純反射 hook，AI 仍只提交 ATTACK，守對手簡單）。場域狀態統一 `fieldState`(terrainEffects/teamStatuses/enemyStatuses/comboCastEffects)。
> 持久化只加 canonical `learnedSkillIds/equippedSkillIds/inheritedSkillIds`。圓桌定**先小樣本縱向打穿 M8.0–e、再橫向鋪內容**。圓桌結論：`session-20260623-104127`。

> **內容補完路線圖（plan/13-content-roadmap.md）**：寶可夢分階段補完 G3→G9（共 1025，現 1–251）、地形擴充（天氣/場地/特殊型，依本傳整理）；資料 PokéAPI、圖走**官方 artwork runtime URL（不內建侵權）**；每階段重產 `gen_dex.mjs`。引擎(M6/M7/M8)各自縱向做完後，內容按階段 1/2/3 橫向鋪。

> commit 節奏：使用者要求**每個小階段自動 commit**（見 memory `auto-commit-per-stage`）。每步驗證綠燈即 commit。typecheck/build/test（69）全綠。

## 2. 真相來源（不要重抄，直接讀）
- **系統架構/分層/資料流/不變式**：`ARCHITECTURE.md`（先讀這份）；硬性約束摘要：`CLAUDE.md`；跑法：`README.md`
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

> 完整分層/資料流見 `ARCHITECTURE.md`，此處只列接手常碰的點。
- `game/types.ts` 型別；`game/data/`（typeChart 相剋表+測試、species/moves/regions/playerCards **產生檔**、**`practiceRegion.ts` 手動維護**、**`regionLookup.ts` 含練習場的 `lookupRegion`**）；`game/stats.ts` 能力值；`game/encounter.ts`（`rollEncounter`/`rollEncounterTeam`）；`game/recommend.ts`（**選隊評分 vs 全隊 + 一鍵推薦，純函數+測試**）；`game/individual.ts`/`growth.ts`/`persistence.ts`（個體/成長/持久化）。
- `game/battle/engine.ts`（`resolveAttack` + QTE/防禦/球/捕獲倍率 + 測試）；**`game/battle/reducer.ts`（3v3 純 reducer + 測試；含 `MAX_TURNS` 回合上限依剩餘血量判勝）**；`game/machine/gameMachine.ts`（XState 流程，改用 `lookupRegion`）。
- `store/battleStore.ts`（Zustand display：`BattleState` + 逐 event setter）；`store/rosterStore.ts`（持久 roster：`load`/`grantBattleExp(…, ratio)`/**`captureUnit(card)`**）。
- `input/qte.ts`（`qualityFromPointer` seam）。
- `ui/`：screens（Title/RegionSelect[**含練習入口**]/Encounter/CardSelect[**對手條+剋弱徽章+推薦**]/Battle[**HpPlate 貼角色同側**]/Result[**捕獲入隊+勝敗經驗**]）、components（HpBar/TypeBadge/PokemonSprite/TimingBar/IndividualInfo）、`styles/global.css`。

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
