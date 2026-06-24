# Handoff — mobie

接手者請先讀本檔，再讀 `plan/`（設計真相在那裡，本檔不重複）。專案為 **iPad 為主、自用的 Pokémon Mezastar 風格遊戲**，Web/PWA。

---

## 1. 現況一句話
**M1.x + M3 + M2 + M5 + M6 + M7 + M8 + M9 + M10 全部完成並 Chrome CDP 驗證**（271 測試 / typecheck / build 全綠）。
> **全專案實際案例驗證（2026-06-23）**：①**資料完整性**（全 251 物種/招式/8 區+競技場/起始卡/相剋表逐筆掃過，14 測試）②**模擬戰鬥壓力**（324 場完整對戰＝9 區×18 seed×模組關/開，每步驗 HP 邊界/無 NaN/必定終局/決定論，5 測試）③**道具持久化全鏈路**（ownedToCard→build→sanitize→.save 往返，6 測試）④**CDP 真機**（競技場勝→純經驗不捕獲、野外勝→收服 boss roster 16→17、M7 三模組戰鬥生效、4 個 Title modal 開啟皆零 console error）。結論：M1–M7 功能與資料正確、可正常遊玩。
- **M1.x**（M1 + M1.5 a–h）：3v3 戰鬥、換人＋防禦 QTE、FxCanvas 粒子、Tone.js 音效、個體差異、成長＋持久化、意外機制、星擊 Finisher。
- **M3（R3F 3D 場景 + 造型層）**：`scene/r3f/` 的 `BattleStage`（地台/光照/相機/ContactShadows，lazy 載入 three）、`PokemonVisual`（①IndexedDB drop-in GLB → ②PokéAPI billboard，正規化+ErrorBoundary）、`Combatant3D`（撲擊/受擊/倒下/入場走 useFrame/ref，imperative `StageHandle`，守效能紅線）、`CaptureStage`（收服 3D）、`ModelManagerModal`（GLB 匯入 UI）。注入測試方塊 GLB 端對端驗證渲染。
- **M2（QR 掃描 + 卡庫）**：`game/cardCode.ts`（MZ1+CRC16 解析，純函數+測試）、`game/cardsImport.ts`（JSON/CSV，純函數+測試）、`game/cardLibrary.ts`（IndexedDB cards 表，PLAYER_CARDS 種子）、`CardScannerModal`（jsQR 相機掃 + 手動輸入後備 + 明確錯誤 UI，掃到→`captureUnit` 入隊去重）、`CardLibraryModal`（檢視/匯入/新增自製卡/可列印 QR 產生器，qrcode）。Title 加「📷 掃卡 / 🗂 卡庫 / 🧩 3D 模型」入口。
- **M5（可攜存檔檔案）**：見下方 2026-06-23 註記。**設計重定位為「使用者自有雲端」而非後端同步**。
- **M6（共用地基）**：見下方 2026-06-23 M6 註記。延伸系統的掛載地基 + 模式 contract 已落地。
- **M7（戰鬥條件 hook 層）**：見下方 2026-06-23 M7 註記。羈絆（S2）/ 持有道具（S1/S3/S4）/ 特性（S1/S3）+ 設定 UI，全複用 M6 引擎、reducer/engine 不動。
- **M8（場域/地形）**：見下方 2026-06-23 M8 註記。地形只影響攻擊 power（engine 屬性相剋後乘注入倍率）、`fieldState` 容器、混合/隨機地形區、開場揭示 UI；全複用 M6 注入機制、reducer/engine 不認識地形語意。
- **M9（連鎖攻擊 Combo 基底）**：見下方 2026-06-24 M9 註記。連鎖槽（`BattleState.chainGauge` 暫態）滿 → `chainOpportunity` → `SUBMIT_CHAIN_RESULT` 單一 action（reducer 重驗存活/目標、吃速度、倒下截斷）；複用 M6 S5 注入 + `performAttack`，純 reducer/單招不變式不破。
- **M10（養成·收集·孵化）**：見下方 2026-06-24 M10 註記。進化（S6 postGrowth 改 speciesId、個體保留、單招）/ 星級 Grade（純派生零 buff）/ 圖鑑成就（`mz.meta.v1` 三層語義、registered 單調進化不倒退）/ 抽蛋孵化（`mz.incubator.v1` egg 只存 seed/pool/progress、決定論孵化）。各自 S8 命名空間、不碰 roster canonical；CDP 14/14 全過。
- 多個里程碑畫面都經 **三/四方 agent-chat 設計審查**（P0/P1 已落地，conclusion 在各 session）。**下一步：M16 Mobie 資訊卡（純 UI、無相依，直接修「戰鬥中看不到自己夥伴」痛點），或 **M19 Mobie 多招式制（plan/17，放寬單招、戰鬥核心，含 M17 修訂；~~M20 DQ 來源~~ ⛔ **已棄置·無官方 API**，見下方 2026-06-24 註記）**，或 M11 模式·長線·野外意外（連勝塔/Ascension/野外意外），或 M4（MediaPipe 體感，使用者目前略過）。見 CHECKLIST M16/M19/M11（M20 已棄置）/ `16`/`17`/`18` / `14-roadmap-m6-m13.md`。**

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

> **M7 戰鬥條件 hook 層（2026-06-23，已完成 Chrome CDP 驗證）**：羈絆 / 持有道具 / 特性，全複用 M6 的 S1–S8 引擎，**reducer/engine 不動**（唯一 additive：BattleEvent 加 `heal` 變體供 S4 回血演出）。
> **掛載分流**：戰前縫（S1 buildUnit / S2 preBattleModifiers）走新的 `store/ext.ts` `assembleBattlePrep`＋`applyBattlePrep`（BattleScreen 初始化套到玩家隊；對手只吃 S1）；戰中縫（S3 damageHook / S4 turnEnd）走既有 `assembleExt`/`ExtBundle`。**hook 讀 BattlePokemon 暫態 `heldItemId`/`abilityId` 自行分流**（縫關閉＝該欄不存在＝零殘留）。
> ① **羈絆**（`game/ext/synergy.ts`）：`computeSynergy(team)` 純函數 + 3 規則（多樣陣容速度 / 同屬共鳴攻特攻 / 世代羈絆 HP），每 modifier 帶 label/source/icon；只玩家隊吃；選卡 tag + 開場 banner/log。
> ② **持有道具**（`game/ext/items.ts`）：`OwnedUnit.heldItemId`（canonical）+ 7 道具三類（statMod S1 / damageHook S3 / turnEnd S4 剩飯）；`mz.itembag.v1` 背包（`store/bagStore.ts` exactly-once 對帳）、`rosterStore.setHeldItem`、`sanitizeRoster` 只留已知 id；`TeamModal`（🎒 隊伍）裝備 UI + HpPlate icon。**致命傷攔截型 onceTrigger（氣勢披帶）需改 engine→刻意延後。**
> ③ **特性**（`game/ext/abilities.ts`）：`AbilityDef` 6 種 + **依主屬性決定論指派**（`abilityForType`，不改 generated species.ts、不連網）；S1 寫 abilityId+statMod、S3 攻擊方 pinch（HP≤1/3 ×1.5）+ 防守方 guard（剋制 ×0.8）同 hook 讀雙方；對戰雙方皆生效。**onSwitchIn（威嚇）需改 reducer→刻意延後。**
> ④ **設定 UI**（`SettingsModal`，Title「⚙️ 設定」）：逐系統 toggle，未實作模組（chain/evolution/tower）標敬請期待；`ModuleId`/`MODULE_IDS` 加 `abilities`。共用 `game/ext/statPatch.ts`（scale/applyStatMod/createLookup）。
> **持久化**：新增 `mz.itembag.v1`(localStorage)；`OwnedUnit` 加 canonical `heldItemId`（隨 roster 序列化，含 .save 匯出匯入）。**新增依賴：無。** +30 vitest（synergy 8 / items 11 / abilities 11）= 169 全綠。
> **CDP 驗證（SwiftShader）**：開三模組+裝道具→選卡顯羈絆 tag→戰鬥雙方顯特性徽章（絕境爆發）+ 道具 icon（生命寶珠）+ 打一回合（注入 S3）零 console error。
> **已知 follow-up**：氣勢披帶（post-damage 縫）/ 威嚇（onSwitchIn 縫）待補；背包 `mz.itembag.v1` 尚未進 .save 匯出（heldItemId 在 roster 內已含）。
>
> **M8 場域 / 地形（2026-06-23，已完成 Chrome CDP 驗證）**：地形系統，**reducer/engine 仍不認識地形語意**——倍率如 rng 般注入。
> **① 核心模型**（`game/data/terrains.ts`，手寫非產生檔）：12 種 `TerrainDef{mods: 屬性→power 倍率}`；`terrainMultiplier(moveType, defs)` 混合**逐屬性相乘**再**夾 [0.5,1.5]**（單一/混合同界）；`resolveTerrainMult(moveType, ids)`（id→def→倍率，供注入）、`rollRandomTerrain(pool, seed)`（沿用 `individual.hashSeed` 決定論抽）、`resolveBattleTerrains(region, seed)`（arena→空 / 固定→terrains / 隨機→抽 1）、`terrainDefsOf`（UI 過濾未知+中性，BattleScreen 與 RegionSelect/TerrainChip 共用）；`lookupTerrain` 用共用 `createLookup`。
> **② 落點**：`engine.resolveAttack` 加 `terrainMult`（**屬性相剋後乘**，預設 1＝既有測試不動，miss/免疫早返不套）；`BattleState.field: FieldState`（`terrainEffects.{initial,current}`，**戰鬥暫態不持久化**、不回寫 Region/OwnedUnit；M12 fieldState 再補 teamStatuses/enemyStatuses/comboCastEffects）；`createBattleState(p, f, terrains?)`；`TurnOptions.terrainMultiplier` 注入，reducer 內建 `terrainResolve` 閉包綁 `w.field.terrainEffects.current`（M11 地形突變改 current 即時反映）、串三攻擊點。`TerrainId` 型別住 `types.ts`（避免型別↔資料循環）。
> **③ 資料 / UI**：`gen_dex` `REGION_THEMES` 8 主題區各加固定地形 + emitter 輸出 `terrains`/`randomTerrain`；新增**混合地形區 ×2**（海濱濕地 coastal+grassland / 火山岩窟 volcanic+cavern）+ **隨機地形區 ×1**（幻象之境，6 地形池決定論抽）；重產 `regions.ts`（**11 區，只動 regions.ts**，species/moves/playerCards 確定性不變）；`practiceRegion` 加 `terrains:['neutral']`。UI：BattleScreen 依 region 解析地形（隨機以 foe cardId 串接當 seed）、注入 resolver、開場 banner+log 揭示 + 常駐 `TerrainChip`；RegionSelect 區域卡顯地形提示膠囊。
> **持久化**：無新增（field 全暫態）。**新增依賴：無。** +33 vitest（terrains 19 / terrain 注入 7 / regionLookup +3 / simulation 地形納入壓力）= 223 全綠。
> **CDP 驗證（SwiftShader）**：11 區地形提示正確（8 單一 / 2 混合 / 1 隨機）；常綠森林戰鬥顯 TerrainChip「🌿 草原」+ 開場揭示 log；模擬壓力測試 11 區×18 seed×模組關/開把地形納入 HP 邊界/終局/決定論；正確性審查（7 關注點逐一查核）無 bug；零 console error。
> **守住約束**：純 reducer（地形如 rng 注入）、engine 收純倍率不 import 地形資料、只存 canonical OwnedUnit（field 暫態）、單招街機（地形不引新攻擊招）、生成檔只動 regions.ts。
> **已知 follow-up（不阻塞）**：M11 地形突變（terrainShift 改 field.current，野外意外）/ M12 fieldState 補三子欄；live 的 current 突變路徑目前只單測覆蓋（M11 落地補整合）。
>
> **M9 連鎖攻擊（2026-06-24，已完成 Chrome CDP 驗證）**：Mezastar 招牌連鎖，**複用 M6 S1–S8 注入地基，reducer 純函數/單招不變式不破**。
> **① 模組**（`game/ext/chain.ts`）：`CHAIN_RULES{maxHits:3, gaugeFull:100, gainBase:30}`；`CHAIN_MODULE` 只掛 **S5 chainResolve**（= 規則），push `MODULE_REGISTRY`。停用＝`ext.chain` undefined＝連鎖槽恆 0、不 emit、回單體攻擊（零殘留）。
> **② reducer**（`battle/reducer.ts`）：`BattleState.chainGauge`（戰鬥暫態，`createBattleState`/`cloneState` 帶上）——玩家普攻**命中**依 QTE 品質（`CHAIN_GAIN_BY_QUALITY`，星擊不續槽）累積；滿則回合末 emit `chainOpportunity{maxHits, eligibleIndices}`（`chainEligible`＝active 在前+存活隊友，cap maxHits；**reducer/display 共用** export）。`SUBMIT_CHAIN_RESULT{hits}` 單一 action：佔玩家攻擊型相位一格、**吃速度**（`playerActsFirst`，§0.4 B 不開特例）；`resolvePlayerChain` 逐段**重驗**（死亡攻擊者跳過不計連段 / 目標非同一 active 即截斷 / 領銜者被敵先手 KO 連鎖發不出），各段複用 `performAttack`（單招、不引新招）+ emit `chainHit{comboCount}`；提交即把 chainGauge 歸零（消耗）。
> **③ display**（`BattleScreen`/`battleStore`）：連鎖槽 bar（**鏡像 star-gauge** class）讀 `battle.chainGauge`；`chainReady` 亮 🔗連鎖鈕 → `startChain` 算 participants → `chainQte` 相位逐段跑 `TimingBar`（key 重掛重置指針，ref/rAF 守效能紅線）收集 `ChainHit[]` → `runChain` 派 `SUBMIT_CHAIN_RESULT`；`chainHit` 演連段 combo overlay（`store.combo`）+ spark FX。`SettingsModal` chain 標 available。
> **持久化**：無新增（chainGauge 暫態）。**新增依賴：無。** +14 vitest = 237 全綠。**simplify**：合併 chain/foe `opts`、去除無效 `Omit<AttackParams>` 標註（欄位本就 optional）。
> **CDP 驗證（SwiftShader）**：開 chain 模組 → 普攻填滿連鎖槽（0→100%）→ 🔗連鎖鈕 → 發動 → 逐段 foe tray 證**皆命中同一 active 敵、目標倒下即截斷剩餘 hits**（熔岩蟲 28→61→倒下，第 3 段截斷、不追擊新上場敵）、零 console error。
> **已知 follow-up（不阻塞）**：合體技（M12）＝連鎖升級變體（`ComboDef` + `SUBMIT_CHAIN_RESULT` 升級判定 + `comboCastEffects` 灌注 fieldState），此處基底已備。
>
> **M10 養成·收集·孵化（2026-06-24，已完成 Chrome CDP 驗證）**：收集養成四件套，**皆獨立 save slice（S8），不碰 roster canonical**。
> **① 進化**（`game/ext/evolution.ts`，S6 postGrowth）：`gen_dex.mjs` 抓 PokéAPI evolution-chain → `species.evolvesTo/evolveLevel`（本傳道具/通信/親密度進化**一律簡化為等級觸發**＝街機簡化、分歧取鏈中第一子代＝決定論；重產 species.ts，**只動 species.ts，moves/regions/playerCards 確定性不變**）。`evolvedSpeciesId` 連跳多階；`EVOLUTION_MODULE` 只掛 S6、`assemblePostGrowth(settings)` 組好交 `rosterStore.grantBattleExp`（applyExp 之後套用）：**只改 canonical speciesId、個體欄位全保留（IV/EXP/nature/seed/shiny/heldItemId）、招式維持單一**。記 `lastEvolutions`，`EvolutionOverlay` 結算演出（剪影→閃光→定格，可跳過）。停用＝升級不檢查進化（零殘留）。
> **② 星級 Grade**（`game/grade.ts`，**純派生零 buff/零新欄/零持久化**）：`computeGrade(indiv, species)→1..6`（shiny + IV 總和 tier + species BST 稀有度，與 IV 星級嚴格分軸）；`GradeBadge` 接 IndividualInfo→CardSelect/Encounter/Dex，5=Star/6=Superstar 漸層光效。**無 settings 開關（純展示恆顯）**。
> **③ 圖鑑/成就**（`game/meta.ts` `mz.meta.v1` / `game/achievements.ts`）：**三層語義避免雙真相**——`currentlyOwned`(roster 即時派生不存) / `registered`(歷史已捕，**單調遞增→進化不倒退**) / `seen`；stats + achievements claimedAt。`metaStore` 事件點更新（Encounter→recordSeen / Result→recordWin·recordEvolutions / capture→recordCapture），`computeAchievements`(7 成就純派生)，`claimAchievement` exactly-once 回傳 reward。`DexModal`(1–251 三態 + Grade 篩選，registered/seen Set 化 O(1)/格) / `AchievementsModal`(進度 + 領取→產蛋)。
> **④ 抽蛋孵化**（`game/incubator.ts` `mz.incubator.v1`）：**egg 只存 seed/source/speciesPool/progress（不付費/不刷池/不存預生成結果）**、決定論 id/seed；`advanceAll` 每場戰鬥推進、`hatchEgg` 由 seed 在 pool 內定種 + individual roll 產 **canonical** OwnedUnit。來源：成就領取（`addRewardEgg`）/ 重複捕獲轉化（**overflow policy=自動轉蛋、絕不刪既有個體**，plan/10 §5.3.1 允許 policy）/ 塔（留 source 給 M11）。`incubatorStore.hatch`＝移蛋 + `rosterStore.addUnit`(id 去重) + 登錄圖鑑；`IncubatorModal` 蛋進度 + 孵化 reveal（+Grade）。
> **持久化新增**：`mz.meta.v1` / `mz.incubator.v1`（localStorage，各自命名空間）。**新增依賴：無。** +44 vitest（evolution 9 / grade 8 / meta 10 / incubator 7 …）= 271 全綠。store/ext 加 `assemblePostGrowth`、settingsStore 暴露 `postGrowth`。Title 加 📖圖鑑/🏆成就(可領紅點)/🥚孵化所(可孵!)。
> **CDP 驗證（SwiftShader，14/14 全過、零 console error）**：A 全 7 Title modal 煙霧；B 注入近進化 roster→競技場勝→進化演出（獨角蟲→鐵殼蛹）+ 圖鑑同時登錄進化前(010/013/016)後(011/014/017)物種證**單調不倒退**；C 注入 meta/incubator→成就 6 可領→領 1→蛋入孵化所→孵化皮卡丘(+Grade ◆3 入隊)。
> **守住約束**：只存 canonical OwnedUnit（meta/incubator 另命名空間、egg 不存預生成結果）、Grade 純派生、進化只改 speciesId 不解鎖新招、`game/` 純（store 才知模組開關）。simplify 清理（metaStore commit / DexModal O(1) 三態 / 共用 gradeShort / 去 computeAchievements 死參數）。
> **已知 follow-up（不阻塞）**：完整 `pendingCaptures` 斷線復原 transaction（自用單機刻意簡化為同步轉蛋）；`mz.meta.v1`/`mz.incubator.v1`/`mz.itembag.v1` 尚未進 `.save` 匯出（roster 內 heldItemId 已含）；進化解鎖技能槽 / 蛋帶技能 接點待 M12；塔來源 egg + SP 待 M11。
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

> **戰鬥回放系統 = M14（plan/15-battle-replay.md，2026-06-23，尚未實作）**：四方圓桌（Claude/gemini/codex/mistral）收斂，結論 `.claude/agent-chat/session-20260623-164122/conclusion.md`。需求：把一場戰鬥**完全文字化**成可保存紀錄、並能**用文字記錄完整回放**（使用者已接受「戰鬥改動都動到回放」耦合）。
> **定案 canonical = 結構化 JSON log（事件流 + header 含 seed/輸入）+ 唯讀戰報投影 `eventToReportLine`**——**否決雙向文字 parser**（隨戰鬥系統長新機制＝指數維護債）、**否決純 seed 重模擬當 canonical**（引擎一改舊紀錄重看結果就變、版本脆弱）。
> 複用既有兩半架構：reducer **完全不動**（只消費它既有吐的有序 domain events）、回放＝把 events 從 live 改成 from-log 餵回 BattleScreen 既有消費器。**前置必做**：把 `resolveTurn` 的 rng 從預設 `Math.random` 接成 seeded（抽 `game/rng.ts` 複用 individual.ts 的 `mulberry32`/`hashSeed`），否則無法重模擬。
> 分層：純 codec `game/replay/`（比照 save/bundle.ts，formatVersion + 嚴格 decoder + unknown-event fail-fast + 分類錯誤 + crc）；獨立持久化 slice **IndexedDB `mz-replays`**（battleId 去重 + FIFO 上限，**只存 .json、不存 derived .txt**）；播放器複用 BattleScreen 消費器。**降規格裁定**：不做 i18n 多語抽象層（YAGNI）、golden-master 重模擬比對 UI 延到 M8（M14 只放單測骨架）。切分 M14.0–M14.f 見 CHECKLIST。
> **編號**：原 M14（改名 mobie）順延 **M15**。回放排在戰鬥機制 M8–M13 大多落地之後、改名之前（屆時 event 詞彙已完整，codec/handler 一次到位）。**待使用者確認編號**。

> **收尾改名 M15（所有里程碑完成後才做；原 M14 順延）**：把專案/app 改名 `pokemon-mezastar` → **`mobie`（小怪物）**——repo 目錄/git remote、`package.json` name、`index.html` title、PWA manifest、app 品牌字串、docs 全域。**關鍵：別弄壞既有存檔**——`mz.*`/`mz-*` persistence key 建議保留（或寫遷移）；`<profileName>.save` 不受影響；PokéAPI/物種資料來源照舊。見 CHECKLIST M15。**⚠️ 已升級為 M18（見下，取代並擴大）。**

> **Mobie 資訊卡 + Partner 技能系 + 全面改名 = M16–M18（2026-06-24，尚未實作）**：使用者實玩回饋（戰鬥中看不到自己夥伴的型別/技能/數值）+「玩家與 mob 是**夥伴而非從屬**」理念 + 把「pokemon」字眼全改 **mobie**。設計+決策全文**已拆三檔**（2026-06-24）：`plan/16-mobie-info-card.md`（M16）/`plan/19-partner-player-skills.md`（M17）/`plan/20-rename-to-mobie.md`（M18）（CHECKLIST 已加 M16.a–M18.e）。共同身分軸線：「你的 mob 是夥伴，這個遊戲叫 Mobie」。
> **M16 Mobie 資訊卡（純 UI，無相依，可先做）**：可複用 `MobCard`（複用既有 `.modal-backdrop`/`TypeBadges`/`IndividualInfo`/`PokemonSprite`），首度揭露 mob 的**招式細節 + 六維數值**；點 HpPlate/TeamTray/縮圖開卡。**自己一律全顯；對手基本面（名稱/型別/Lv）顯示、深度（招式/數值/IV 星級）遮罩** → 留給 M17 看穿揭露。不動 reducer/engine/持久化。
> **M17 Partner 技能系（提前並重定位 M12 核心，複用 M7 S1–S8 引擎 + M8 fieldState，戰鬥機制零 reducer/engine 改動）**：①**自動技能**＝既有 hook 模組（鼓舞=S3 pinch / 守護=S3 guard / 疾風=S1 statMod，`partnerSkills.ts` push `MODULE_REGISTRY`、讀暫態 `equippedSkillIds` 自行分流，同道具/特性路）。②**主動槽**（1 個、每場一次、手動鈕）＝**純顯示層**的看穿（設 `revealedFoes` + 揭露演出，不進 reducer/不耗回合/對手不回擊），接 M16 的卡。③**完整 SP 訓練經濟**（`mobie.skillpoints.v1` 錢包、boss 勝利給 SP、`PartnerSkillModal` 訓練所學/裝、第 2 槽 SP/等級解鎖；塔 SP 預留 M11、進化解槽預留 M10）。`OwnedUnit` 只加 canonical `learnedSkillIds/equippedSkillIds`。**M12 剩餘子項（合體技/對手 profile/孵化繼承）續留原里程碑。**
> **M18 全面改名 → Mobie（取代並擴大 M15）**：**分類精準改名非一鍵替換**。詞彙全用 `mobie`（`BattlePokemon`→`BattleMobie`、`PokemonSprite`→`MobieSprite`、UI「寶可夢」→「Mobie」）。範圍 src 約 137 處/32 檔 + 「寶可夢」32 處/24 檔 + 2 檔名 + 品牌字串 + docs + repo 目錄。**⚠️ 絕不可改**：`artwork()` helper / gen_dex 的 `raw.githubusercontent.com/PokeAPI/.../pokemon/...` URL、外部服務名 `PokéAPI`、物種 zh-Hant 正典名。存檔 key `mz.*`/`mz-*` → `mobie.*`/`mobie-*` + 一次性 `migrateKeys()`，`.save` 舊欄位向後相容匯入。**放 M16/M17 之後做**（機械式大改動避免衝突）。
> **先後（⚠️ 已於 2026-06-24 更新為「先改名」，見下）**：原排 M16 → M17 → M18（最後改名）。

> **⚠️ 技能系重構 + 多招式制 + DQ 來源 = M17 修訂 / M19 / M20（2026-06-24，使用者回饋；plan/17、plan/18、plan/16 修訂、CLAUDE.md 更新）**：
> 使用者澄清「mobie 技能不只一個（現在只有一個）」並拍板**放寬單招硬約束 → 寶可夢式多招式制**，且**把「玩家技能」與「怪物技能」徹底分離**。
> **⚠️ 上面 M17 那段（自動技能 鼓舞/守護/疾風 掛怪物、`learnedSkillIds/equippedSkillIds` 掛 OwnedUnit）已被本段取代。** 四方 agent-chat 收斂全體 agree：`.claude/agent-chat/session-20260624-012214/conclusion.md`。
> - **M19 Mobie 多招式制（plan/17，新；戰鬥核心）**：每隻怪物有種族**學習表**（領悟/學習/繼承/出生自帶，照寶可夢維基），出生帶 1、**可學可忘、出戰上限 4**（攻擊招＋變化招）。戰鬥「**選槽即開打**」（四鍵/方向映射、逾時 slot0）；reducer **additive**——ATTACK 加 `slotIndex`、resolve 後寫 `resolvedMoveId` 進 event、loadout 戰中 snapshot 不可變、**仍單回合單一 ATTACK action 不開新相位、純 reducer 不破**；身分由**星擊 finisher** 承載；`species.moveId`→slot0 向後相容。變化招走輕量 QTE（**只影響強度不影響成敗**、硬上限）、複用 M7 S1/S3/S4 effect 寫 fieldState；連鎖：變化招不斷鏈/貢獻支援值、合體技需鏈中≥1 攻擊招；對手 AI 純函式 `chooseOpponentMove` 加權選槽（不新增相位）。canonical 只加 `learnedMoveIds`/`equippedMoveIds` 兩 id 陣列。**取代並落實原 M12 技能 loadout 核心**；gen_dex 從 PokéAPI learnset **降維映射**到精簡招式池。
> - **M17 修訂（plan/19）**：M17 從「混入怪物 buff」**瘦身成純玩家(訓練師)技能**（看穿/全隊支援/丟道具，**不掛 OwnedUnit**、無 per-creature 上限）。原 鼓舞/守護/疾風 等 buff **下放成怪物變化招（M19）**。**分界線：主動施放=招式（M19）／被動常駐=特性（M7）／玩家自有工具=Partner（M17）**。SP 為單一貨幣供 M17/M19 共用但**分池顯示**（`mobie.skillpoints.v1`；玩家技能改存帳號級 `mobie.playerskills.v1`）。
> - **M20 DQ 魔物來源（plan/18，新）** ⛔ **棄置／不執行（2026-06-24，使用者拍板：「當前要先棄置，因為沒有官方 API。」DQ 無 PokéAPI 式合法資料/圖床來源；保留規劃供日後重啟，不影響 M19）**：把《勇者鬥惡龍》魔物做成**第二 mobie 來源、設定可開關**（預設關）。**資料抓、美術不抓**——數值是事實低風險可從 wiki/攻略抓；但 **DQ ≠ Pokémon**：無 PokéAPI 式合法圖床，熱連結 wiki 圖＝盜連版權圖，故美術走 drop-in/placeholder（守不內建侵權資產）。對映既有 18 型相剋 + M19 招式＝引擎零分叉；`Species.source` + id 命名空間；DQ 呪文/特技→M19 learnset（M20.d 依賴 M19）。
> - **CLAUDE.md 已更新**：Hard constraints 新增「Move system is now MULTI-MOVE」條目，明載單招放寬、`plan/17` 為現行真相（舊 plan 的「單招」字眼歷史化）。
> - **建議先後（⚠️ 2026-06-24 使用者拍板「先改名」覆蓋舊序）**：**M18 改名（先做，plan/20）→ M19 多招式（plan/17）→ M16 資訊卡（plan/16）→ M11 模式長線**。M17（plan/19）順位其後；~~M20（依賴 M19）~~ ⛔ **已棄置（無官方 API）**。改名提前理由：影響後期所有資料命名，現在程式碼/key 最少（7 個）成本最低，新碼天生用對命名。**附帶**：建 `ATTRIBUTION.md`（PokéAPI/Pokémon 智財宣告）。M18.e repo 目錄改名由使用者執行。

> commit 節奏：使用者要求**每個小階段自動 commit**（見 memory `auto-commit-per-stage`）。每步驗證綠燈即 commit。typecheck/build/test（271）全綠。

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
- `game/types.ts` 型別（含 `Region.mode:'arena'|'wild'`、**`Region.terrains?`/`randomTerrain?`、`TerrainId` 型別 M8**）；`game/data/`（typeChart 相剋表+測試、species/moves/regions/playerCards **產生檔**、**`practiceRegion.ts`（競技場，手動維護）**、**`terrains.ts`（M8 地形表+`terrainMultiplier`/`resolveTerrainMult`/`rollRandomTerrain`/`resolveBattleTerrains`/`terrainDefsOf`，手動維護）**、`regionLookup.ts`＝`lookupRegion`/`canCaptureIn`）；`game/stats.ts` 能力值；`game/encounter.ts`（`rollEncounter`/`rollEncounterTeam`）；`game/recommend.ts`（選隊評分+推薦）；`game/individual.ts`（含匯出 `hashSeed`）/`growth.ts`/`persistence.ts`/**`settings.ts`**（個體/成長/roster 持久化/設定 slice）。
- **`game/ext/seams.ts`（M6 擴充縫 S1–S8 + ExtBundle + ExtensionModule）**；**M7 模組：`game/ext/synergy.ts`（S2 羈絆 computeSynergy）/`items.ts`（S1/S3/S4 道具 ItemDef）/`abilities.ts`（S1/S3 特性 + abilityForType）/`statPatch.ts`（共用 scale/applyStatMod/createLookup）**；`game/battle/engine.ts`（`resolveAttack` + QTE/防禦/球倍率 + **S3 damageHook** + **M8 terrainMult**）；**`game/battle/reducer.ts`（3v3 純 reducer，`resolveTurn(state, action, {rng, ext, terrainMultiplier})` + **S4 turnEndTrigger** + `heal` event + `MAX_TURNS` + **M8 `BattleState.field`（FieldState.terrainEffects）**）**；`game/machine/gameMachine.ts`（XState 流程，`lookupRegion`）。
- `store/battleStore.ts`（Zustand display）；`store/rosterStore.ts`（持久 roster：`grantBattleExp`/`captureUnit`/**`setHeldItem`**）；**`store/bagStore.ts`（`mz.itembag.v1` 背包 + equip 對帳）**；**`store/ext.ts`（`assembleExt`/`assembleBattlePrep`/`applyBattlePrep` + `MODULE_REGISTRY`）/`store/settingsStore.ts`（組 ext+prep，BattleScreen 消費）**。
- `ui/components/`：**`SettingsModal`（逐系統開關）/`TeamModal`（裝備道具 + 顯特性）** 等 Title overlay（皆 lazy）。
- `input/qte.ts`（`qualityFromPointer` seam）。
- `ui/`：screens（Title[**含 ⚙️設定/🎒隊伍 入口**]/RegionSelect[**含競技場入口 + M8 地形提示膠囊**]/Encounter/CardSelect[對手條+剋弱徽章+推薦+**羈絆 tag**]/Battle[**resolveTurn 傳 ext+terrainMultiplier、applyBattlePrep 套 prep、特性/道具徽章、heal 演出、M8 開場地形揭示 + 常駐 TerrainChip**]/Result[**WinView 捕獲 vs ArenaWinView 純經驗，依 `canCaptureIn` 分流**]）、components（HpBar/TypeBadge/PokemonSprite/TimingBar/IndividualInfo/**SettingsModal/TeamModal**）、`styles/global.css`。

## 5. 下一步（✅M18 改名 + ✅M19.a/b 引擎核心完成；⏸ 暫停於 M19.c UI，待玩測/M18.e）
M1–M10 完成並 CDP 驗證；**M18 全面改名 → Mobie（a–d）完成並 CDP 驗證**；**M19 多招式 a/b（資料模型 + reducer/engine additive）完成，294 測試全綠**。**2026-06-24 使用者拍板執行序：先改名（M18）→ M19 → M16 → M11**。
- **⏸ 暫停點（使用者選擇）**：M19 引擎核心（a/b）已落地、戰鬥行為**零改變**（player 仍用 slot0；**對手已會用多招** via chooseOpponentMove）。使用者先玩測 + 做 M18.e，再續 M19.c。
  - **▶ 續做 M19.c（戰鬥 UI 選招）**：BattleScreen 四槽「選槽即開打」（方向/四鍵映射、逾時 slot0、攻擊招命中 QTE、星擊分離）+ MobCard 顯 4 招（MobCard 屬 M16）。dispatch `{ type:'ATTACK', slotIndex }`（引擎已備）。再 d 變化招 → e 招式訓練所+SP → f gen_dex learnset。
- **✅ M19.a/b 已落地**：`OwnedUnit` 加 `learnedMoveIds`/`equippedMoveIds`、`Species` 加 `learnset?`/`teachableMoveIds?`/`eggMoveIds?`、`BattleMobie.moves[]`（保留 `move`=slot0 過渡）、`Card.equippedMoveIds` 橋接；`game/learnset.ts`（派生 fallback／autoEquip ≤4／resolveEquippedMoves，**舊存檔/野生無 equippedMoveIds → 依等級自動裝備、零遷移寫入**）；engine `moveIndex`/`resolvedMoveId`、reducer ATTACK `slotIndex`、`chooseOpponentMove`（單招回 0 不耗 rng）。+16 vitest。**simulation 免疫測試改用純 ghost（夢妖 200）**——多招式下雙屬性會用次屬性招繞過免疫（正確）。
- **✅ Phase 0**：拆 `plan/16` 為三檔（`16` M16 / `19` M17 / `20` M18）、建 `ATTRIBUTION.md`（PokéAPI/Pokémon 智財宣告）、執行序更新。
- **✅ M18 改名（a–d 完成；e 待使用者）**：`BattlePokemon`→`BattleMobie` 等識別符 + `PokemonSprite/Visual` 檔名 + UI「寶可夢」/品牌字 → Mobie + TitleScreen「MOBIE」；**localStorage `mz.*`→`mobie.*` + `game/keyMigration.ts`（冪等、不刪舊）+ `src/bootstrap.ts` 最前 import**；**IDB DB 名 `mz-*` 保留**（純內部/不進 .save/跨 DB 搬遷易孤立，二選一明文記錄）；`.save` 不嵌 key 名故舊檔自動相容。**CDP 驗證**：標題=MOBIE、舊 `mz.roster.v2` 遷移到新 key（rosterLen=1=cdp-seed 而非預設 16 隻＝**證明遷移在 store 載入前跑、roster 不掉**）、savemeta 遷移、零 console error。
  - **⚠️ M18.e 待使用者**：repo 目錄 `pokemon-mezastar/`→`mobie/` + git remote（動工作目錄絕對路徑，需本機執行）。handoff §7 `cd pokemon-mezastar` / plan/01 tree root / memory slug `pokemon-mezastar-project` **刻意保留**至 M18.e 完成前。
- **絕不可改 artwork URL 的 `PokeAPI`/`/pokemon/` 與物種正典名**（`dataIntegrity.test.ts` 有斷言）；變化招（M19.d）走 S1/S3/S4 寫 fieldState；星擊 finisher=身分。
- **守地基不變式**：純 reducer（ext/terrain/slotIndex 是注入，resolvedMoveId 由 reducer 算，不寫死語意）、只存 canonical roster（itemBag/settings 另命名空間、field 是戰鬥暫態）、可選掛載（預設全關、關掉零殘留）、**多招式街機（M19：每回合單一 ATTACK action 不開新相位；道具/特性/地形/連鎖本身不引新攻擊招、招式由 M19 學習表管理；被動效果歸特性不入招式槽）**、高頻值只走 ref/rAF/Zustand。
- **M7/M8 收尾 follow-up（不阻塞、可順手）**：氣勢披帶需 post-damage 縫（改 engine）、威嚇需 onSwitchIn 縫（改 reducer 換人段）；M11 地形突變（terrainShift 改 `field.terrainEffects.current`）會用到 M8 已備的 current/initial 分流。

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
