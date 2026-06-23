# Handoff — pokemon-mezastar

接手者請先讀本檔，再讀 `plan/`（設計真相在那裡，本檔不重複）。專案為 **iPad 為主、自用的 Pokémon Mezastar 風格遊戲**，Web/PWA。

---

## 1. 現況一句話
**M1.x + M3 + M2 + M5 + M6 全部完成並 Chrome CDP 驗證**（139 測試 / typecheck / build 全綠）。
- **M1.x**（M1 + M1.5 a–h）：3v3 戰鬥、換人＋防禦 QTE、FxCanvas 粒子、Tone.js 音效、個體差異、成長＋持久化、意外機制、星擊 Finisher。
- **M3（R3F 3D 場景 + 造型層）**：`scene/r3f/` 的 `BattleStage`（地台/光照/相機/ContactShadows，lazy 載入 three）、`PokemonVisual`（①IndexedDB drop-in GLB → ②PokéAPI billboard，正規化+ErrorBoundary）、`Combatant3D`（撲擊/受擊/倒下/入場走 useFrame/ref，imperative `StageHandle`，守效能紅線）、`CaptureStage`（收服 3D）、`ModelManagerModal`（GLB 匯入 UI）。注入測試方塊 GLB 端對端驗證渲染。
- **M2（QR 掃描 + 卡庫）**：`game/cardCode.ts`（MZ1+CRC16 解析，純函數+測試）、`game/cardsImport.ts`（JSON/CSV，純函數+測試）、`game/cardLibrary.ts`（IndexedDB cards 表，PLAYER_CARDS 種子）、`CardScannerModal`（jsQR 相機掃 + 手動輸入後備 + 明確錯誤 UI，掃到→`captureUnit` 入隊去重）、`CardLibraryModal`（檢視/匯入/新增自製卡/可列印 QR 產生器，qrcode）。Title 加「📷 掃卡 / 🗂 卡庫 / 🧩 3D 模型」入口。
- **M5（可攜存檔檔案）**：見下方 2026-06-23 註記。**設計重定位為「使用者自有雲端」而非後端同步**。
- **M6（共用地基）**：見下方 2026-06-23 M6 註記。延伸系統的掛載地基 + 模式 contract 已落地。
- 兩里程碑畫面都經 **三方 agent-chat 設計審查**（P0/P1 已落地，conclusion 在各 session）。**下一步：M7 戰鬥條件 hook 層（羈絆/道具/特性，複用 M6 的 S1–S8 引擎），或 M4（MediaPipe 體感，使用者目前略過）。見 CHECKLIST / `14-roadmap-m6-m13.md`。**

> **M5 可攜存檔（2026-06-23，已完成 Chrome CDP 驗證）**：使用者要求**不要後端伺服器，用自己的雲端空間**——打包成 `<profileName>.save`(zip) → 自己丟 Google Drive/其他 → 下載放回 → 解析判斷新舊 → 同意才覆蓋。
> 故砍掉 `08-cloud-sync.md` 的 `CloudSyncAdapter`/`SyncCoordinator`/自動 pull-push（**零後端/零 secret/零 vendor**）。檔案結構：`src/game/save/`＝`saveMeta.ts`(mz.savemeta.v1 信封中繼+純 `compareSaves`)、`bundle.ts`(fflate zip 純打包/解包+crc32 校驗+分類錯誤)、`saveIO.ts`(store I/O 接線+`navigator.share`/下載+匯入套用)、`backupStore.ts`(IDB `mz-save-backup` 覆蓋前自動備份單槽)；UI＝`SaveManagerModal`(Title「☁️ 存檔」入口，lazy，含 fflate 不進主 bundle)。
> **新增依賴 `fflate@0.8.3`**（~8KB 零依賴 zip）。**新增持久化：`mz.savemeta.v1`(localStorage)、`mz-save-backup`(IDB)**。新增 store/lib 方法：`rosterStore.replaceAll`、`cardLibrary.replaceAllCards`、`modelStore.getModelBlob`/`clearAllModels`。匯出預設**不含模型**（可選開關，因 GLB 大）。新舊判斷半自動（一律顯示對照由使用者拍板，不做跨裝置 3-way merge）。+22 vitest（saveMeta 12 / bundle 10）。
> **正確性驗證（三層，皆通過）**：①22 vitest（純邏輯/壞檔分類）②Chrome CDP 真實 app round-trip（自訂狀態→app 匯出→清成新裝置→匯入→**逐欄含模型二進位深度比對**，過程修掉兩個*測試腳本*的競態/IDB-schema bug，產品本身無誤）③**5-agent 盲測雙向交叉驗證**——3 個獨立 packer（各自手寫 codec、禁用專案 `packSave`）打包→app 匯入逐欄一致；2 個獨立 unpacker 解 app 匯出檔→獨立重算 crc32 通過、逐欄一致。5 個 agent 只憑讀 `bundle.ts` 就各自得出相同 crc32 標準與 payload 順序＝格式無歧義。**結論：匯出/匯入正確、無待修產品碼。** 驗證腳本在 /tmp（ephemeral，未入庫，符合專案 CDP 慣例）。
>
> M3/M2 新增依賴：`three`/`@react-three/fiber@8`/`@react-three/drei@9`、`jsqr`、`qrcode`。重的 overlay（BattleStage/CaptureStage/掃卡/卡庫/模型）全 lazy，主 bundle ~406KB。**新增 IndexedDB：`mz-models`(GLB blob)、`mz-cards`(cards 表)；roster 仍 `mz.roster.v2`(localStorage)。** `createOwnedUnit` 現吃 card 顯式 ivs/nature/shiny 覆寫 seed roll。已知 follow-up：`cardLibrary`/`modelStore` 的 IndexedDB plumbing 可抽共用 factory（本輪未動已出貨碼）。BarcodeDetector 在 iPad Safari 不可靠 → 掃碼改 jsQR（getUserMedia+canvas），plan 原寫 zxing fallback 不需。

> **M6 共用地基（2026-06-23，已完成 Chrome CDP 驗證）**：延伸系統（M7–M12）的前提地基，分兩塊。
> **① 掛載地基 + 相位契約（原 M6.0）**：`game/ext/seams.ts` 定義 8 擴充縫 S1–S8（plan/09 §0）＋ `ExtBundle`（S3 damageHook / S4 turnEndTrigger / S5 chain）＋ `ExtensionModule`＋`EMPTY_EXT`。
> `resolveTurn(state, action, {rng, ext})` 加第三參數 `ext`（**預設空＝行為等同 M1.x**，既有測試全綠）；reducer 不認識「道具/羈絆」字眼、只認 hook。S3 穿過 `engine.resolveAttack`（同位階純倍率、兩方攻擊皆注入、hook 自行依 attacker 過濾）；
> S4 在回合末同步段、§0.4 contract D **在 MAX_TURNS timeout 判定「之前」跑**（HP 變動才納入剩餘血量比例）。`starStrike` 早已是 `ATTACK` 的 mode（非獨立 action）。
> 設定 slice `mz.settings.v1`（`game/settings.ts`，獨立命名空間、逐系統開關、**預設全關**）；`store/ext.ts` `assembleExt(settings)`（住 store 層、唯一知道哪些模組開著；**註冊表 `MODULE_REGISTRY` M6 為空＝永遠回 EMPTY_EXT，M7+ 各系統 push 自己的模組**）；`store/settingsStore.ts` 組 ext，`BattleScreen` 端對端接上（3 處 resolveTurn 都傳 ext）。
> **② 模式 contract（原 M7.0）**：`Region.mode:'arena'|'wild'`（`types.ts`）。`gen_dex.mjs` 主題區 emit `mode:'wild'` → 重產 `regions.ts`（**只動 regions.ts，species/moves/playerCards 確定性不變**）。
> 練習場 → **競技場** relabel（`practiceRegion.ts` 設 `mode:'arena'`、中性地形、純得經驗、**保留支援輪盤**）。捕獲資格集中由 `regionLookup.canCaptureIn(id)`（mode==='wild'）決定，**移除未用的 `isPracticeRegion`**、不讓 OwnedUnit 帶戰鬥臨時資訊；
> `ResultScreen` 競技場勝利走新 `ArenaWinView`（不進捕獲流程）。**新增持久化：`mz.settings.v1`(localStorage)。新增依賴：無。** +13 vitest（ext 7 / settings 6）+4（regionLookup mode contract）＝139 全綠。
> **CDP 驗證（SwiftShader WebGL）**：競技場勝利→ArenaWinView（純經驗、無寶貝球）；野外（常綠森林）勝利→WinView 捕獲（超級球→收服成功→加入隊伍）；全程零 console error。
> **關鍵約束守住**：純 reducer（ext 是注入純能力包，如 rng）、只存 canonical roster（settings 是另一命名空間）、可選掛載（預設全關、關掉零殘留）。M7 直接複用此 S1–S8 引擎，把 ItemDef/SynergyRule/AbilityDef push 進 MODULE_REGISTRY 即可。
>
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

> **內容補完路線圖（plan/13-content-roadmap.md）**：寶可夢分階段補完 G3→G9（共 1025，現 1–251）、地形擴充（天氣/場地/特殊型，依本傳整理）；資料 PokéAPI、圖走**官方 artwork runtime URL（不內建侵權）**；每階段重產 `gen_dex.mjs`。

> **里程碑重編號 M6–M13（plan/14-roadmap-m6-m13.md，2026-06-23）**：原本把 22 項擠在 M6/M7/M8（M6.a–j、M7.a–c、M8.a–e），現**依類型歸類後拆成獨立里程碑**、依賴排序：
> **M6 共用地基（掛載+相位契約+模式contract）→ M7 戰鬥hook層（羈絆/道具/特性同引擎）→ M8 場域地形（導入fieldState）→ M9 連鎖 → M10 養成收集孵化（進化/Grade/圖鑑/孵化）→ M11 模式長線意外（連勝塔/Ascension/野外意外）→ M12 技能大模組（技能/合體技/對手，縱向小樣本先打穿）→ M13 內容補完**。
> 設計細節仍在 09–13（內容未變，只是里程碑歸屬重編）；CHECKLIST 已改成 M6–M13、每項標原子編號對照；plan/14 §3 有「舊 Mx.y → 新里程碑」完整對應表（22 項全數歸位無漏）。
> 4 個跨里程碑合併點：道具/特性/技能=同一 S1–S8 hook 引擎、連鎖/合體技=同一 Combo 系統、地形/合體灌注/buff=共用 fieldState、進化↔技能槽/孵化↔技能繼承。

> **收尾改名 M14（所有里程碑完成後才做）**：把專案/app 改名 `pokemon-mezastar` → **`mobie`（小怪物）**——repo 目錄/git remote、`package.json` name、`index.html` title、PWA manifest、app 品牌字串、docs 全域。**關鍵：別弄壞既有存檔**——`mz.*`/`mz-*` persistence key 建議保留（或寫遷移）；`<profileName>.save` 不受影響；PokéAPI/物種資料來源照舊。見 CHECKLIST M14。

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

## 3. 程式地圖（里程碑歷史見 `git log`）
完整里程碑歷史在 `git log`（M1 → M1.5a–h → M2 → M3 → M5 → M6，每小階段一 commit、訊息為 Conventional 中文）。本節只列接手常碰的點；完整分層/資料流見 `ARCHITECTURE.md`。
- `game/types.ts` 型別（含 `Region.mode:'arena'|'wild'`）；`game/data/`（typeChart 相剋表+測試、species/moves/regions/playerCards **產生檔**、**`practiceRegion.ts`（競技場，手動維護）**、`regionLookup.ts`＝`lookupRegion`/`canCaptureIn`）；`game/stats.ts` 能力值；`game/encounter.ts`（`rollEncounter`/`rollEncounterTeam`）；`game/recommend.ts`（選隊評分+推薦）；`game/individual.ts`/`growth.ts`/`persistence.ts`/**`settings.ts`**（個體/成長/roster 持久化/設定 slice）。
- **`game/ext/seams.ts`（M6 擴充縫 S1–S8 + ExtBundle + ExtensionModule）**；`game/battle/engine.ts`（`resolveAttack` + QTE/防禦/球倍率 + **S3 damageHook**）；**`game/battle/reducer.ts`（3v3 純 reducer，`resolveTurn(state, action, {rng, ext})` + **S4 turnEndTrigger** + `MAX_TURNS`）**；`game/machine/gameMachine.ts`（XState 流程，`lookupRegion`）。
- `store/battleStore.ts`（Zustand display）；`store/rosterStore.ts`（持久 roster：`grantBattleExp`/`captureUnit`）；**`store/ext.ts`（`assembleExt` + `MODULE_REGISTRY`）/`store/settingsStore.ts`（組 ext，BattleScreen 消費）**。
- `input/qte.ts`（`qualityFromPointer` seam）。
- `ui/`：screens（Title/RegionSelect[**含競技場入口**]/Encounter/CardSelect[對手條+剋弱徽章+推薦]/Battle[**resolveTurn 傳 ext**]/Result[**WinView 捕獲 vs ArenaWinView 純經驗，依 `canCaptureIn` 分流**]）、components（HpBar/TypeBadge/PokemonSprite/TimingBar/IndividualInfo）、`styles/global.css`。

## 5. 下一步（建議 M7：戰鬥條件 hook 層）
M6 地基已備好（S1–S8 縫、`resolveTurn(…, {rng, ext})`、`mz.settings.v1` 開關、`store/ext.ts` 的 `MODULE_REGISTRY`、模式 contract）。
**M7 直接複用此引擎，reducer/engine 不用再動**——只把模組 push 進 `MODULE_REGISTRY`、在 settings 開關即生效。規格真相見 `plan/09`（道具/羈絆/特性）、`plan/14`（里程碑歸屬）、`plan/CHECKLIST.md` M7 區。
- **羈絆**（最乾淨、先驗證）：`computeSynergy(team)→NamedModifier[]` 純函數 + 規則集 + S2 掛載 + 選卡 UI tag。
- **持有道具**：`ItemDef` 手寫表（statMod/damageHook/onceTrigger 三類）+ `mz.itembag.v1` 獨立 slice + S1/S3/S4（同步 `applyItemTriggers`，禁 async/重入）+ 裝備 UI。
- **特性**：species `abilityId` + `AbilityDef` + 複用道具引擎 + 「換人解析內同步」onSwitchIn（bounded/non-reentrant）。
- **先補的小東西**：目前**沒有設定 UI**——模組雖可開關但使用者無入口。M7 第一步可順手加一個 settings 面板（Title 入口，逐系統開關 toggle，呼 `useSettings.setModuleEnabled`）。
- 守地基不變式：純 reducer（ext 是注入純能力包）、只存 canonical roster（itemBag/settings 是另一命名空間）、可選掛載（預設全關、關掉零殘留）、單招街機（道具/特性不引新攻擊招）。

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
>   - **戰鬥畫面 CDP 必帶軟體 WebGL**（M6 踩過）：R3F `BattleStage` 要 GL context，headless 加 `--disable-gpu` 會讓 three 報 `Could not create a WebGL context` → 戰鬥畫面掛掉。改用 `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`（Chrome 149 起 SwiftShader 自動 fallback 已移除，需顯式旗標）。非戰鬥畫面（title/region/卡庫）不需。
>   - 完整戰鬥 loop CDP 驅動：`攻擊`→等 ~330ms→在 `.qte` dispatch `pointerdown`(停指針)→對 `.qte__bar`/`body` 連續 dispatch ~15 次(連打蓄力)→等 ~2.6s(回合演出+對手回擊)，迴圈到出現「再戰一場/回到區域」。`推薦出戰` 含「出戰」字會被 `includes('出戰')` 誤點，精準鈕用 `includes('3/3')`。
- **存檔匯出/匯入的 CDP 驗證**（M5 用過）：`npm run preview`(4173) 服務 dist；CDP 用 `Browser.setDownloadBehavior`(收匯出檔)、`DOM.setFileInputFiles`(餵匯入檔)、`Storage.clearDataForOrigin`(模擬新裝置)、`Emulation.setDeviceMetricsOverride`(高視窗)。**踩過的坑**：手寫 IDB helper `indexedDB.open` 一定要帶與 app 一致的 `onupgradeneeded`(建 `glb`/`cards` store)，否則把 DB 建成無 store 污染 app；讀狀態要等 UI 成功訊息出現再讀(避免在 IDB commit 前的競態)。**跨實作盲測**：可派獨立 agent 各寫 codec、與 app 互通交叉驗證(M5 用 5-agent 雙向驗過)。

## 8. 已知坑
- `vite.config.ts` 故意**不在 `tsconfig.json` 的 include**（避免 node:url / vitest `test` 欄位的型別錯誤；它由 esbuild 轉譯、runtime 才跑）。
- iOS Safari 音訊需**首次觸控解鎖 AudioContext**；Tone.js 要在解鎖時才**動態 import**（控 bundle）。
- M1 為求 offline 用本地 seed 資料；造型走 PokéAPI 官方 artwork raw URL（runtime 載入，有 skeleton fallback）。

## Suggested skills
- **`/agent-chat`** — 遇到開放式設計抉擇時（這專案前三個大決策都用它三方收斂）。先上網查證再開，效果最好。
- **`/run`** — 啟動 app 並截圖驗證「精美度」與完整 loop（本專案是 browser-driven，用 Chrome headless + CDP）。
- **`/karpathy-guidelines`** — 寫/改碼時保持 surgical、簡潔、可驗證（本專案已沿用）。
- **`/code-review`** 或 **`/simplify`** — 實作完一個里程碑子步、綠燈 commit 前做品質把關。
- 跨實作互通正確性（如存檔格式）可派**獨立 agent 盲測**（各寫 codec、與 app 雙向交叉驗證），比自寫自測更能抓盲點。
- 安裝前說明、Web/PWA、精美不略過等偏好已存在 memory（`pokemon-mezastar-project`、`explain-before-install`），新 session 會自動帶入。
