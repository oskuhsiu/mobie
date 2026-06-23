# CHECKLIST — Pokémon Mezastar Clone

> 獨立進度勾選檔。完成一項就把 `[ ]` 改成 `[x]`。

## M0 — 專案骨架
- [x] `git init` + `.gitignore`（node_modules、dist、public/models、*.local）
- [x] Vite + React + TypeScript 骨架
- [x] 依賴：xstate、@xstate/react、zustand、framer-motion、vitest（Dexie 延到 M2 才需要持久化）
- [x] tsconfig 嚴格模式、路徑別名 `@/`
- [x] PWA manifest（service worker 後補）
- [x] 初次 commit

## M1 — 純觸控完整 Game Loop（精美）✅ 完成
### 資料層
- [x] `types.ts`：TypeName、Species、Move、Card、MyPokemon、BattlePokemon
- [x] 18 型相剋表常數
- [x] 12 隻種族 seed（含種族值、屬性、artwork URL）
- [x] 各自專屬招式 seed
- [x] 區域表（3 區，每區野生寶可夢權重）
- [x] 假卡 roster（玩家手牌 5 張）
- [~] Dexie db schema（cards / myPokemon）→ 延到 M2（M1 用記憶體 seed）
### 戰鬥引擎 + 測試
- [x] `resolveAttack()` 純函數：傷害公式 + STAB + 相剋 + 命中 + 暴擊 + QTE 倍率
- [x] 捕獲判定（captureChance / attemptCapture）
- [x] vitest：傷害公式邊界、相剋（剋/被剋/無效/雙倍）、STAB、命中（21 測試）
### 流程與狀態
- [x] XState 流程狀態機（title→regionSelect→encounter→cardSelect→battle→result）
- [x] 戰鬥回合解算（runTurn：依速度先後手 + 結束判定）
- [x] Zustand 瞬時 store（HP、攻擊/受擊 FX、banner）
- [x] QTE 共用契約 `qualityFromPointer`（觸控現用、M4 MediaPipe 共用）
### UI 與演出
- [x] 區域選擇畫面（主題化、過場）
- [x] 遭遇畫面（入場動畫、字幕）
- [x] 選卡畫面（手牌、選取動畫、屬性剋制提示）
- [x] 戰鬥畫面：HP 條補間、等級、屬性 badge
- [x] Timing QTE bar（觸控停指針 → 倍率，rAF 不過 React state）
- [x] 攻擊演出：前衝/閃光/震動/受擊閃白/浮動傷害數字/相剋提示
- [x] 結算畫面：勝利捕獲動畫（寶貝球晃動）、失敗再戰
- [x] 全域主題 CSS、iPad 直/橫式觸控與安全區適配、載入骨架
### 驗證
- [x] `tsc --noEmit` 無錯
- [x] `vite build` 通過（331KB / gzip 108KB）
- [x] vitest 全綠（21 測試）
- [x] dev server 跑通完整 loop（直式+橫式截圖：勝利捕獲 + 落敗兩條路徑）

## M1.5 — 完成戰鬥：3v3 + 主動換人 + 聲光（依 06-battle-reference.md）
### M1.5a 隊伍模型 + 3v3 依序 + 純 reducer ✅ 完成（含 UI 接線、實機驗證勝利+捕獲）
- [x] party 模型型別（`reducer.ts`：`BattleSide` = members[3] + activeIndex、`BattleState`）
- [x] `engine.ts` 加 `damageMult` option + `defenseMultiplier()`（不破壞既有 21 測試）
- [x] `resolveTurn(state, action, {rng}) → { nextState, events[] }` 純函數
- [x] domain events：damageApplied / memberFainted / activeChanged / switchDefenseResolved / battleEnded
- [x] 倒下→自動送下一隻（`applyForcedSwitch` 依序）、全滅判定勝負
- [x] vitest：先後手、3v3 依序 KO、強制換、換上即倒、防禦抵減、全滅雙向、純函數不變性（11 測試）
- [x] cardSelect 改多選 3 隻組隊（序號徽章、n/3 計數、選滿才解鎖出戰）
- [x] gameMachine context 改帶 `playerTeam`/`foeTeam`（3 隻）；`rollEncounterTeam`；末隻為 boss=捕獲對象
- [x] battleStore 改持 `BattleState`(display) + 逐 event setter；BattleScreen 用 reducer 跑回合、依序消費 events 演出
- [x] 底部隊伍 tray（雙方各 3 HP pip + 倒下灰階/✕ + active 高亮）
- [x] 實機（Chrome headless+CDP）驗證：遭遇顯示對手 3 隻 → 選 3 隻 → 3v3 攻擊+自動換上 → 勝利捕獲 boss
### M1.5b 主動換人 + 防禦 QTE + 隊伍 UI ✅ 完成（實機驗證）
- [x] 換人行動：選隊友→防禦 QTE→`resolveTurn(SWITCH)`→對手打換上的、抵減（90/60/30/0）
- [x] 防濫用：換人＝整回合（每回合一次）、剛換下鎖一回合不能換回；換上即倒→立即強制換（reducer 測試覆蓋）
- [x] 攻擊 QTE / 防禦 QTE 共用 `qualityFromPointer` seam（`TimingBar` 加 `hint` prop 切換文案）
- [x] 底部隊伍 tray（3 HP pip + 倒下灰階，M1.5a 已做）+ 換人面板（active/倒下/剛換下 disabled）
### M1.5c 視覺特效 ✅ 完成（實機驗證粒子）
- [x] `scene/fx/FxCanvas`（imperative canvas2D 粒子，自有 rAF、不過 React state）：屬性色受擊粒子 + 會心金星 spark + 倒下灰煙 puff + 擴張環 ring + 螢幕閃光 flash
- [x] framer-motion：角色 lunge 位移、螢幕 shake（rootShake 依會心/剋制加重）、受擊 brightness flash、倒下淡出（`fainting` 旗標 grayscale 淡出）
- [x] 換人動畫：放出開球閃光（activeChanged → ring + white flash）；收回光束簡化為換上入場（remount entrance）
- [x] BattleScreen display-state 依序消費 events、在對應節點觸發 FX（`fxRef.burst/ring/flash`）
### M1.5d 音效 + BGM ✅ 完成（驗證動態載入+零錯）
- [x] `audio/audioEngine` 介面：`unlock()`（START 首次觸控）/ `play(sfxId)` / `setIntensity(level)` / `startBgm`/`stopBgm`
- [x] Tone.js 在 unlock 時**動態 import**（驗證：tone.js 獨立 chunk gzip 81KB，不進主 bundle 348KB）
- [x] 程序化 preset SFX（零取樣）：select/attack/hit/super/crit/faint/switch/lowhp/victory/defeat/capture；chiptune BGM（melody+bass Sequence on Transport）
- [x] `setIntensity`：依我方 HP 調低通濾波（緊張變悶）+ 低血量警報嗶，**不停 transport**
- [x] 驗證：START→動態載 tone、全場戰鬥 SFX/BGM 零 console error

## M1.5 進階 — 意外機制 + 個體差異/成長（依 07-systems-design.md）
### M1.5e 個體差異 ✅ 完成（實機驗證）
- [x] `individual.ts`：seed→{ivs(0-31), nature(25種), shiny} 決定論 roll（mulberry32+fnv1a hash）
- [x] `stats.ts` 補 nature 乘數（±10%、最後套用）；`buildBattlePokemon` 依 cardId roll 個體；野生不再用固定 IV
- [x] 個體 UI（`IndividualInfo`）：星級 IV(1-5)、性格名+加紅減藍箭頭、異色；Encounter 顯 0-31 明細、CardSelect 卡片顯星級+性格
- [x] vitest（10）：seed 決定論、IV 範圍、性格表(25/5 neutral)、nature 乘數、IV→星級單調
### M1.5f 成長 ✅ 完成（實機驗證 EXP+持久化）
- [x] `growth.ts`：Medium Fast `n^3`（expForLevel/levelFromExp 互逆）、`expYield`(依被擊敗者等級)、`applyExp` 升級重算（等級只增不減）、`createOwnedUnit`/`ownedToCard`
- [x] 資料模型 `OwnedUnit`(canonical：id/level/exp/ivs/nature/seed/shiny) → buildBattlePokemon 派生
- [x] `PersistenceAdapter` 介面 + `LocalStorageAdapter`（只存 canonical OwnedUnit）+ `MemoryAdapter`(測試)
- [x] `rosterStore`：開場 load/seed、勝利 `grantBattleExp` 加經驗存檔；CardSelect 從 roster、結算顯示 EXP/升級
- [x] vitest（11）：n^3 往返、expYield 單調、applyExp 升級/不降/封頂、create 決定論、Adapter 契約；實機驗證 +334EXP 與 localStorage 持久化
### M1.5g 意外機制 ✅ 完成（實機驗證四項）
- [x] 統一 `RandomEvent {type,actorId,roll,outcome,source}`；reducer 隨機點（accuracy/crit/supportRoulette）全走它；engine 回報 accuracyRoll/critRoll
- [x] 支援輪盤：每 `SUPPORT_EVERY`(3) 回合，攻擊UP/必定會心(forceCrit)/支援補刀(待命隊友多打一刀)/摃龜 + overlay
- [x] 捕獲球輪盤：`rollBall`→精靈/超級/高級球，`captureChanceWithBall` 套係數封頂 0.98；結算顯示球種
- [x] 攻擊 QTE 加「連打蓄力」：`chargeTier`(red→rainbow)、`attackQteMultiplier`=timing×色階；MashMeter（計數走 ref）
- [x] vitest（+9）：球輪盤/連打/支援輪盤決定論、補刀 attackerIndex、共用 RandomEvent；實機驗證 mash/support/ball
### M1.5h 星擊 Finisher ✅ 完成（實機驗證 118 傷）
- [x] 能量槽：只由 QTE 表現(quality)+連打+連鎖累積（**不綁隨機**）；極簡彩虹細條 UI + 滿槽高亮
- [x] 滿槽放自製大招「星擊」（`starStrike` action：×3 倍率+必定會心+跳過支援輪盤）+ 演出（FxCanvas flash/ring/spark + shake + audio）
- [x] vitest（+2）：星擊傷害遠高於普攻且必定會心、星擊跳過支援輪盤

## M2 — QR 掃描 + 卡庫 ✅ 完成（Chrome CDP 驗證）
- [x] `parseCardCode()`：MZ1 解析 + CRC16-CCITT 校驗 → `game/cardCode.ts`（失敗分類 format/version/crc，+8 測試）
- [x] 相機掃描 → **改用 jsQR**（getUserMedia+canvas，比 BarcodeDetector 在 iPad Safari 可靠；zxing fallback 不需）+ 手動輸入後備（永遠可用、可測）
- [x] cards 表 JSON/CSV 匯入 → `game/cardsImport.ts`（+7 測試）+ `CardLibraryModal` 貼上/選檔
- [x] 掃描→反查→存入「我的寶可夢」→ `game/cardLibrary.ts`（IndexedDB cards 表，PLAYER_CARDS 種子）+ `rosterStore.captureUnit`（去重）
- [x] 自製產卡/印卡工具 → `CardLibraryModal` 新增自製卡 + 每卡產生可列印 QR（qrcode）
- [x] 掃描失敗 UI 回饋 → CRC 錯 / 查無卡 / 相機被拒（縮成提示＋手動主 CTA）皆明確
- [~] `SaveEnvelope`（M5 鋪路）→ **未觸發**：roster 維持 `LocalStorageAdapter`、cards 用獨立 raw-IDB；本里程碑未把 roster 換 Dexie，故信封延到 M5 真正導入持久化遷移時做
- 入口：Title「📷 掃卡 / 🗂 卡庫」；造型/個體：掃描卡的顯式 ivs/nature/shiny 經 `createOwnedUnit` 覆寫落到 canonical

## M3 — R3F 3D 場景 + 造型層 ✅ 完成（Chrome CDP 驗證）
- [x] R3F 戰鬥舞台（台座、光照、運鏡）→ `scene/r3f/BattleStage`（ContactShadows + lazy 載入）
- [x] `PokemonVisual` 抽象介面 → `scene/r3f/PokemonVisual`（GLB → billboard，含 ErrorBoundary）
- [x] GLB 檔案匯入 → IndexedDB → 正規化 → `ModelManagerModal` + `scene/models/{modelStore,normalize}`（注入測試方塊 GLB 端對端驗證渲染）
- [x] billboard fallback（PokéAPI artwork，永遠面向相機）
- [x] 攻擊/受擊/捕獲演出移植 3D → `Combatant3D`（撲擊/受擊/倒下/入場）+ `CaptureStage`（收服縮沉）
- [x] Zustand subscribe / useFrame 橋接（效能紅線）→ 動畫全走 useFrame/ref，imperative `StageHandle`，不過 React 頂層 state
- [~] iPad ≥ 30fps 實機驗證 → 待實體 iPad；headless 渲染正常、幾何輕量、架構守紅線

## M4 — MediaPipe 體感 QTE
- [ ] @mediapipe/tasks-vision 接入（Hand + Gesture）
- [ ] 相機權限/延遲/電量/WebGL 並存 PoC 報告
- [ ] 手勢對應：連打=蓄力、握拳=停輪盤
- [ ] `MediaPipeInput` 實作 `InputSource`，與 TouchInput 熱切換
- [ ] 主執行緒節流 PoC → Worker/OffscreenCanvas 升級
- [ ] 效能紅線：連續座標只寫 Zustand

## M5 — 可攜存檔檔案（使用者自有雲端，非後端同步）✅ 完成（Chrome CDP 驗證）
> **設計重定位（2026-06-23）**：使用者要求不要後端伺服器，改用「打包成 `<profileName>.save`(zip) →
> 自己丟 Google Drive/其他 → 下載放回 → 解析判斷新舊 → 同意才覆蓋」。故砍掉 `08-cloud-sync.md`
> 的 `CloudSyncAdapter`/`SyncCoordinator`/自動 pull-push（零後端/零 secret/零 vendor），只留信封中繼。
- [x] `saveMeta`（`mz.savemeta.v1`：schemaVersion/profileName/updatedAt/revision）取代 `SaveEnvelope`；本地不改 roster shape（檔案層 manifest 即信封），純函數 `compareSaves`/`migrateMeta`/`sanitizeProfileName`（+12 vitest）
- [x] roster 成長/收服、卡庫匯入/刪、模型匯入/刪 等使用者進度寫入點 `bumpSaveMeta`
- [x] `SaveBundle` 打包/解包（`bundle.ts`，fflate zip：manifest+roster+cards+可選 models/<id>.glb）+ crc32 payload 校驗 + 分類錯誤（not-zip/no-manifest/bad-manifest/schema-too-new/bad-payload/checksum-mismatch）（+10 vitest）
- [x] 匯出 UI（`SaveManagerModal`，lazy）：存檔名稱、含模型開關（預設關）、`navigator.share` 優先（iPad 分享面板送 Drive/Files，零雲端 API）、`<a download>` 退路；`modelStore.getModelBlob`
- [x] 比對新舊：匯入時顯示「本地 vs 匯入」對照表 + `compareSaves` 方向標；較舊→紅色警告 + 必須勾選同意（匯入鈕同意前 disabled）
- [x] 安全紅線：覆蓋前 `backupCurrentSave` 自動備份（IDB `mz-save-backup` 單槽）+ 一鍵還原；整包取代 `applyImportedSave`（roster→cards→含模型才 clear+put→最後 `adoptMeta`）
- [x] 邊界：本地空（新裝置匯入）、schema 太新拒絕、壞檔/截斷（crc32）、含/不含模型；Chrome CDP 走完匯出 + 較新/較舊(需同意)/還原備份全路徑
- [~] 時鐘偏移：採「半自動」——一律顯示對照由使用者拍板，故偏移不會自動毀資料（單一使用者自有裝置間足夠；未做跨裝置真分歧 3-way merge，刻意不做）

> **M6–M13 延伸里程碑**：依 `14-roadmap-m6-m13.md` 把原 M6.x/M7.x/M8.x 共 22 項依類型重歸成獨立里程碑、依賴排序。
> 兩不變式不變：**純 reducer / 只存 canonical OwnedUnit**；可選掛載（預設全關、關掉零殘留）。各項括號標原子編號方便對照。

## M6 — 共用地基（Foundation；全部前提，先做）✅ 完成（Chrome CDP 驗證）
> 見 `09 §0`（掛載地基/相位契約）、`11 §2`（模式 contract）。
### 掛載地基 + 回合相位契約（原 M6.0）
- [x] `ExtensionModule` + 擴充縫（S1–S8）定義（`game/ext/seams.ts`）；`assembleExt(settings)` 住 store 層（`store/ext.ts`，註冊表 M7+ 填）
- [x] `resolveTurn(state, action, {rng, ext})` 第三參數加 `ext`（預設空＝行為等同 M1.x，既有測試全綠）；S3 damageHook 穿 engine、S4 turnEndTrigger 在回合末
- [x] settings save slice（`mz.settings.v1`，獨立命名空間，逐系統開關，預設全關）+ `store/settingsStore.ts` 組 ext，BattleScreen 端對端接上
- [x] §0.4 回合相位契約：`starStrike` 已是 `ATTACK` mode、S4 在 timeout 判定「前」跑、攻擊型動作吃速度排序——皆有 vitest（ext.test 7 / settings.test 6）
### 模式 contract：競技場 vs 野外（原 M7.0）
- [x] `Region.mode: 'arena'|'wild'`（`types.ts`）；gen_dex 主題區 emit `mode:'wild'` 重產 regions.ts；gating 集中 result setup（依 mode 決定捕獲）
- [x] 捕獲改依 `canCaptureIn(id)`（mode==='wild'）；移除未用的 `isPracticeRegion`；練習場→競技場 relabel（mode='arena'、中性地形、純得經驗、保留支援輪盤）+ ArenaWinView（+4 vitest）

## M7 — 戰鬥條件 hook 層（道具/特性/技能同一 S1–S8 引擎；見 `09`/`10`）✅ 完成（Chrome CDP 驗證）
> 守住硬約束「reducer/engine 不動」：S1（statMod）/S2（羈絆）走戰前縫 `applyBattlePrep`、S3（damageHook）/S4（剩飯）
> 走既有 `ext`／`ExtBundle`；hook 讀 BattlePokemon 暫態 heldItemId/abilityId 自行分流。reducer 只 additive 加一個 `heal` event。
> **先補的設定 UI**：`SettingsModal`（Title「⚙️ 設定」，逐系統 toggle，未實作模組標敬請期待）；ModuleId/MODULE_IDS 加 `abilities`。
### 隊伍羈絆（原 M6.a，最乾淨先驗證地基）
- [x] `computeSynergy(team)→NamedModifier[]` 純函數 + 規則集（多樣陣容/同屬共鳴/世代羈絆，每 modifier 帶 label/source/icon）
- [x] S2 掛載：戰鬥初始化單次套用（換 active 不重算）；選卡畫面顯示生效 tag + 開場 banner/log（只玩家隊吃羈絆）
### 持有道具（原 M6.b，**建立 S1/S3/S4 hook 引擎**）
- [x] `OwnedUnit.heldItemId` 一欄（canonical）+ `ItemDef` 手寫表（statMod/damageHook/turnEnd 三類；`onceTrigger` 致命傷攔截需改 engine→刻意延後）
- [x] `mz.itembag.v1` 獨立背包 slice（`bagStore` exactly-once 對帳）；S1 進 prep、S3/S4 進 ext；同步 turnEnd（禁 async/重入）
- [x] 裝備 UI（`TeamModal`，🎒 隊伍）+ 戰鬥道具 icon（HpPlate）+ 剩飯回血演出（heal event，綠 spark）
### 特性 Abilities（原 M6.g，**複用道具引擎**）
- [x] `AbilityDef` 手寫表 + **依主屬性決定論指派**（不改 generated species.ts；statMod/pinch/guard 三類）
- [x] 掛載：S1（寫 abilityId + statMod）/ S3（pinch 攻擊方 + guard 防守方，同 hook 讀雙方）；onSwitchIn（威嚇）需改 reducer→刻意延後
- [x] 與道具同類加法疊加（數值池上限控平衡，不做來源攔截）；TeamModal/HpPlate 特性與道具分區顯示
> **CDP 驗證**：開三模組 + 裝道具 → 選卡顯羈絆 tag（多樣陣容/世代羈絆）→ 戰鬥雙方顯特性徽章（絕境爆發）+ 道具 icon（生命寶珠）
> + 完整打一回合（注入 S3 damageHooks）零 console error。共 +30 vitest（synergy 8 / items 11 / abilities 11）= 169 全綠。

## M8 — 場域 / 地形（見 `11`；**導入 `fieldState` 容器**）✅ 完成（Chrome CDP 驗證）
> 守鐵律：純 reducer（地形倍率如 rng 般注入，reducer 不認識地形語意）、engine 收純倍率不 import 地形資料、
> 只存 canonical OwnedUnit（field 是戰鬥暫態，不持久化）、生成檔只動 regions.ts（改 gen_dex 重產）。
### 地形效果（原 M7.a，影響攻擊 power）
- [x] `data/terrains.ts`（手寫非產生檔）：12 種 `TerrainDef{mods}` + `terrainMultiplier(moveType, terrains)`（混合逐屬性相乘 → **每屬性夾 [0.5,1.5]**）+ `resolveTerrainMult`（id→倍率注入）/ `rollRandomTerrain`（決定論抽）/ `resolveBattleTerrains`（依 region 解析）/ `terrainDefsOf`（UI 共用）
- [x] engine `resolveAttack` 在 type 相剋後乘 `terrainMult`（預設 1，既有測試不動）；地形放 **`BattleState.field.terrainEffects`**（`{initial,current}`，暫態不持久化）；`TurnOptions.terrainMultiplier` 如 rng 般注入，reducer 把 `current` 交給 resolver
- [x] 開場地形 UI 揭示（intro banner + log）+ 常駐 `TerrainChip` 徽章 + RegionSelect 區域卡地形提示；vitest（clamp/混合相乘/中性=1/未知 id/決定論抽，terrains 19 + terrain 注入 7）
### 更多 / 混合 / 隨機地形（原 M7.b）
- [x] gen_dex `REGION_THEMES` 8 主題區各加 `terrains`；新增混合地形 wild 區 ×2（海濱濕地 coastal+grassland / 火山岩窟 volcanic+cavern）+ 隨機地形 wild 區 ×1（幻象之境，6 地形池決定論抽）；重產 regions.ts（11 區，只動 regions.ts）；practiceRegion `terrains:['neutral']`
> **CDP 驗證（SwiftShader）**：11 區地形提示正確（8 單一/2 混合/1 隨機）；常綠森林戰鬥顯 TerrainChip「🌿 草原」+ 開場揭示 log；模擬壓力測試（11 區×18 seed×模組關/開）地形納入 HP 邊界/終局/決定論；零 console error。共 +33 vitest = 223 全綠。
> **M7 收尾 follow-up（氣勢披帶 post-damage 縫 / 威嚇 onSwitchIn 縫）本輪未碰 engine/reducer 換人段，續留 M9+。**

## M9 — 連鎖攻擊（Combo 基底；見 `09`）✅ 完成（Chrome CDP 驗證）
> 守鐵律：純 reducer（連鎖規則 `ext.chain` 如 rng 般注入，reducer 不認識「連鎖槽 UI」）、
> 連鎖槽戰鬥暫態（`BattleState.chainGauge`，不持久化）、單招街機（各段用自己專屬招、不引新招）、
> 可選掛載（`CHAIN_MODULE` 只掛 S5；停用＝連鎖槽恆 0、不 emit、回單體攻擊＝零殘留）。
### 連鎖攻擊（原 M6.d）
- [x] 連鎖槽（玩家普攻命中依 QTE 品質累積，不綁隨機）+ `chainOpportunity` event（含 maxHits/eligibleIndices）；`game/ext/chain.ts`（S5 ChainRules）push `MODULE_REGISTRY`
- [x] `SUBMIT_CHAIN_RESULT{hits}` 單一 action（payload 只是 quality 宣告）；reducer 重驗存活/目標（防幽靈傷害）、吃速度（§0.4 B 不開特例）、目標倒下即截斷剩餘 hits、領銜者被 KO 連鎖發不出；各段複用 `performAttack`
- [x] 連續 QTE overlay（複用 `TimingBar` ref/rAF，逐段 remount）+ 連段 combo overlay/FX；連鎖槽 bar（鏡像 star-gauge）+ 🔗連鎖鈕；`chainEligible` reducer/display 共用
- [x] → 合體技（M12）是其升級變體，此處建好基底
> **CDP 驗證（SwiftShader）**：開 chain 模組 → 普攻填滿連鎖槽（gauge 0→100%）→ 🔗連鎖鈕亮起 → 發動連鎖 → 逐段 foe tray 確認皆命中同一 active 敵、目標倒下即截斷剩餘 hits、零 console error。
> +14 vitest（資格/累積/截斷/重驗死亡攻擊者/領銜者 KO/決定論/純函數）= 237 全綠；typecheck/build 綠。simplify 清理（合併重複 opts、去除無效 Omit 標註）。

## M10 — 養成 · 收集 · 孵化（見 `09`/`10`）
### 進化（原 M6.c；**預留技能槽解鎖接點**給 M12）
- [ ] `gen_dex.mjs` 加 PokéAPI evolution-chain → species `evolvesTo`/`evolveLevel`
- [ ] S6 postGrowth：等級觸發改 `speciesId`、個體欄位全保留、招式維持單一；結算進化演出（可取消）
### 星級 Grade（原 M6.f）
- [ ] `computeGrade(unit, species)` 純函數（shiny + IV tier + species 靜態稀有度；**零 buff、零新欄**）
- [ ] Grade 徽章 UI + 高 Grade 光效；圖鑑按 Grade 篩選
### 圖鑑 / 成就（原 M6.h）
- [ ] `mz.meta.v1` 三層語義：`currentlyOwned`(roster 派生) / `registered`(meta 單調) / `seen`(meta) + stats
- [ ] `metaStore` 事件點更新（捕獲/勝利/塔通關）+ `computeAchievements` + `claimAchievementReward(id)` action
- [ ] 圖鑑頁（1–251 三態 + Grade 篩選）+ 成就頁（進度 + 領取）
### 抽蛋孵化（原 M6.i；**預留蛋帶技能接點**給 M12）
- [ ] `mz.incubator.v1`：egg 只存 `seed/source/speciesPool/progress/requiredProgress`（不付費/不刷池/不存預生成結果）
- [ ] egg 來源（塔/重複捕獲轉化/成就首領取）+ 進度權重（戰鬥數+塔層數，非真實時間/每日/步數）
- [ ] 捕獲結算 keep/convert + `pendingCaptures` 持久 transaction（exactly-once、重啟復原、不刪既有個體）
- [ ] `hatchEgg(egg)` 由 seed+speciesPool 走 individual roll 產 canonical OwnedUnit + 孵化頁/動畫

## M11 — 模式 · 長線 · 野外意外（見 `09`/`11`）
### 連勝塔 / 遠征（原 M6.e；依賴 M6 模式 contract、給 M12 技能 SP）
- [ ] `RunState` 獨立 slice（`mz.run.v1`，只參照 roster id；防火牆：暫態不逆寫 OwnedUnit）
- [ ] `generateRunMap(seed)` 決定論節點（battle/elite/event/campfire/shop/boss）+ 分支選路
- [ ] XState `tower` 平行子模式 + RegionSelect 入口；run 內合成載入（OwnedUnit+runModifiers+runHp→BattleUnit）
- [ ] run 結算才寫回 roster（EXP/道具/捕獲/進化）
### 難度修飾 Ascension（原 M6.j，依附連勝塔）
- [ ] 拆兩條：靜態敵強化（enemyHpMulti/levelBonus）pre-bake 進 encounter/buildUnit；回合修飾（Fate/healReduced）走 ext
- [ ] tower ascension 選擇器（meta `ascensionUnlocked` 解鎖階級）+ run 內生效修飾 tag；嚴守 §0.4 不新增戰鬥規則
### 野外意外 ×5（原 M7.c，wild-only，走 RandomEvent）
- [ ] 亂入野生（一次性傷害、不新增第 4 隻 unit）／地形突變（改 fieldState.currentTerrains）
- [ ] 天降補給（**開場前/戰後**三選一，絕不戰鬥中途）／稀有閃光 boss（encounter flag→異色/高 Grade）／幸運加碼（reward modifier）
- [ ] backlog：暴擊潮/氣象疊加/狂暴化/背水一戰/狙擊先制

## M12 — 戰鬥技能大模組（見 `12`；縱向小樣本一次打穿）
> 守單招（技能不直接傷害、進化只解鎖技能槽非新攻擊招）、純 reducer（deterministic hook）、只存 canonical skill id、不動 §0.4。
> **圓桌定：先用小樣本（如初代御三家）縱向打穿全套地基並驗收平衡，再進 M13 橫向鋪內容。**
### schema / catalog / persistence + `fieldState` 補全（原 M8.0 + 場域統一）
- [ ] `SkillDef`/`ComboDef`/`EncounterSkillProfile`/`FieldState` 型別 + 手寫 catalog（小樣本）+ `resolveSkillHooks` 純函數 + vitest
- [ ] OwnedUnit 加 canonical `learnedSkillIds/equippedSkillIds/inheritedSkillIds`（不存派生倍率/cooldown）
- [ ] `fieldState` 容器補全 4 子欄（terrainEffects/teamStatuses/enemyStatuses/comboCastEffects，各帶 source/expiry）
### 技能 hook + loadout（原 M8.a，複用 M7 引擎）
- [ ] S1–S8 掛載技能 deterministic hook（canonical 輸入→effect commands，機率走 reducer RNG）+ 戰前 loadout 套用
- [ ] 護欄測試：技能無直接傷害（只 statMod/debuff/terrain/heal/conditionRewrite）；個體面板技能區（與特性分區）
### 訓練 / 解鎖（原 M8.b，用 M10 進化槽 + M11 塔 SP）
- [ ] SP 取得（boss/塔層/里程碑，不刷技能 EXP）+ 技能訓練所 UI（學/裝）+ 進化/節點解鎖第 2 槽
### 孵化繼承（原 M8.c，擴 M10 孵化）
- [ ] incubator egg 帶 `inheritedSkillId`（plan/10）+ hatch 落到 `inheritedSkillIds`（種族可學才生效）
### 合體技（原 M8.d，擴 M9 連鎖 + M8 地形灌注）
- [ ] `ComboDef` + SUBMIT_CHAIN_RESULT 升級判定（屬性配對/種族/羈絆）+ `usedComboKeys` 每組合每場一次（不回寫 OwnedUnit）
- [ ] 三類施放效果（灌注地形/全隊增益/敵方弱化）寫 `fieldState` + 演出（FxCanvas/framer/audio）+ vitest
### 對手技能多樣性（原 M8.e，Encounter Skill Profile）
- [ ] 生成附 0–2 技能標籤（純反射 hook，AI 仍只提交 ATTACK）+ boss/雙人組宣告合體技

## M13 — 內容補完（見 `13`；引擎驗收後橫向鋪）
- [ ] 內容階段 1：寶可夢 G3(252–386) + 天氣型地形（晴/雨/沙暴/雪/霧/強風）
- [ ] 內容階段 2：G4–G5(387–649) + 場地型地形（草地/電氣/精神/薄霧）+ 混合地形區
- [ ] 內容階段 3：G6–G9(650–1025) 補完 + 特殊型地形（花海/沼澤/蒸氣/聖域）+ 隨機地形區
- [ ] 資料走 PokéAPI、圖走官方 artwork runtime URL（不內建侵權）；每階段重產 gen_dex

## M14 — 戰鬥回放系統（見 `15`；排在戰鬥機制 M8–M13 之後、改名之前）
> 把一場戰鬥**完全文字化**成可保存 JSON log（事件流 + seed/輸入 header），並用它**完整回放**（複用 BattleScreen 演出）。
> 圓桌結論 `.claude/agent-chat/session-20260623-164122/conclusion.md`。canonical=結構化 log + 唯讀戰報投影（**非雙向 parser**）。
### M14.0 — seeded RNG 地基（必做前置）
- [ ] 抽 `game/rng.ts`（`hashSeed`/`mulberry32`/`makeRng`），individual.ts 改 import（零行為變動）
- [ ] store 層 `resolveTurn` 改傳 seeded rng + 開戰生成 battleSeed（runtime，不回寫 OwnedUnit）+ 決定論 vitest 骨架
### M14.a — schema + 純 codec
- [ ] `replay/types.ts`（ReplayLog/Header/DisplayUnitSnapshot/ReplayInput/ReplayTurn；引擎內部 ivs/nature/derived 不進）
- [ ] `replay/codec.ts`（encode 穩定鍵序 / decode 嚴格 + 分類錯誤 + crc 校驗 / migrate；整檔單一 formatVersion + unknown-event fail-fast）+ vitest round-trip & 壞檔分類
### M14.b — 戰報投影器（「完全文字化」交付物）
- [ ] `replay/report.ts` `eventToReportLine`（一 variant 一 handler、依 type 分派、直吐中文、未知 variant 回退 `[type]`）+ `logToReport` + 每 handler vitest
### M14.c — Recorder + 持久化 slice
- [ ] `store/replayRecorder.ts` 單點錄製（seed+輸入+事件流同時，非事後補）
- [ ] `store/replayStore.ts` + IndexedDB `mz-replays`（battleId=FNV-1a(seed+snapshot) 去重 + FIFO 上限；**只存 .json、不存 derived .txt**）+ BattleScreen 接 recordTurn/finishRecording
### M14.d — 播放器
- [ ] 抽 BattleScreen event 消費器為可切換來源（live vs replay）+ 回放模式（禁玩家輸入 + 播放/暫停/單步/倍速）+ 文字戰報側欄同步高亮
### M14.e — 回放清單 + 匯出
- [ ] Title「🎬 回放」入口 + 清單畫面（region/outcome/時間/雙方）+ `.txt` 戰報匯出（即時投影）+ 壞檔分類 UI
### M14.f — 驗收
- [ ] Chrome CDP：打一場 → 回放清單出現 → 播放與當場一致 → 匯出戰報；typecheck/build/test 全綠
> **耦合治理**：M8/M9/M12 等動戰鬥的里程碑，checklist 須含「延伸回放」子項（新 event variant → 加 handler + bump formatVersion + migrate；golden-master 重模擬回歸於 M8 起正式啟用）。
> **降規格**：不做 i18n 多語抽象層（YAGNI、自用單語）；golden-master 比對 UI 延到 M8（M14 只放單測骨架）。

## M15 — 收尾改名 mobie（🏁 所有里程碑完成後才做；依賴 M1–M14 全綠）
> **⚠️ 已併入 M18（取代並擴大）**：使用者要求改名擴大為「含檔名/內容/key 遷移/.save 相容」的精準全面改名，
> 本輕量版（保留 mz.* key、只改品牌字）由 **M18** 取代。完整規格見 `plan/16` §M18，下列子項保留作對照。
> **mobie＝「小怪物」之意**。把專案 / app 識別正式改名（repo、套件、app 品牌）並定名。
> **守則：不破壞既有存檔**——persistence key（`mz.*` localStorage / `mz-*` IndexedDB）若改名會孤立既有存檔，
> 自用單人**建議保留現有 key 前綴**（只改顯示品牌），或寫一次性遷移；存檔檔案 `<profileName>.save` 不受影響。
- [ ] repo 目錄改名 `pokemon-mezastar` → `mobie`（本機資料夾 + git remote 名稱，使用者執行）
- [ ] `package.json` `name` → `mobie`；`index.html` `<title>` + `manifest.webmanifest` `name`/`short_name` → mobie / 小怪物
- [ ] app 內品牌字串（Title 畫面標題等使用者可見文字）改 mobie；**PokéAPI 等技術引用與 Pokémon 物種資料來源照舊不動**
- [ ] docs 全域更新「pokemon-mezastar」專案名 → mobie：`CLAUDE.md`/`ARCHITECTURE.md`/`README.md`/`handoff.md`/`plan/*`（路徑/標題/敘述）
- [ ] persistence key 決策：**保留 `mz.*`/`mz-*`（不破壞既有存檔）** 或寫遷移；二選一明文記錄
- [ ] 驗證：typecheck/build/test 全綠、Chrome CDP 跑通、PWA 重裝顯示新名、**既有存檔仍可載入**

## M16 — Mobie 資訊卡（檢視自己＋對手；見 `16` §M16）
> 修「戰鬥中看不到自己夥伴的型別/技能/數值」痛點。**純 UI／顯示層，不動 reducer/engine/持久化。**
> 自己一律全顯；對手基本面（名稱/型別/Lv）顯示、深度（招式/數值/IV 星級）遮罩 → 留給 M17 看穿揭露。
### M16.a — MobCard 元件
- [ ] `ui/components/MobCard.tsx`（吃 `BattlePokemon`+`revealed`；複用 `.modal-backdrop`/`.modal-card`/`TypeBadges`/`IndividualInfo`/`PokemonSprite`/`getItem`/`getAbility`）
- [ ] **新**：招式 row（名稱+型別+物理/特殊+威力+命中）＋ 六維 mini-bar CSS；先在 Encounter 接一個開啟點驗證
### M16.b — 戰鬥中接線（核心修復）
- [ ] 點自己 `HpPlate` → 自己全卡；點對手 `HpPlate`/`TeamTray` 成員 → 對手卡（遮罩占位「🔍 看穿後揭露」）
- [ ] `battleStore` 加 `revealedFoes`（M17 用；M16 先放空 set，對手 `revealed` 恆 false）
### M16.c — CardSelect / Encounter 接線
- [ ] CardSelect 點自己 `poke-card` → 全卡、點 `foe-strip__mon` → 對手卡（保留既有點選出戰手感，開卡走 ⓘ/長按）
- [ ] Chrome CDP：各畫面開卡零 console error；typecheck/test/build 全綠

## M17 — Partner 技能系（提前並重定位 M12 核心；見 `16` §M17）
> **與 M12 共 S1–S8 hook 引擎、提前實作**：技能 hook+loadout（原 M8.a）＋訓練/解鎖（原 M8.b）重定位為「夥伴技能」。
> 守單招（技能不直接傷害）、純 reducer（自動技能走既有 hook、看穿走顯示層）、只存 canonical skill id、不動 §0.4。
> M12 剩餘子項（合體技/對手 profile/孵化繼承）續留原里程碑，本里程碑預留接點（進化解槽/塔給 SP/蛋帶技能）。
### M17.a — schema / catalog / persistence 純資料
- [ ] `game/ext/partnerSkills.ts` `PartnerSkillDef` + 起始 catalog（看穿/鼓舞/守護/疾風，選配整地/回復）+ `resolveSkillHooks` 純函數
- [ ] `OwnedUnit` 加 canonical `learnedSkillIds/equippedSkillIds`（不存派生倍率/cooldown）+ `sanitizeRoster` 只留已知 id + vitest（護欄：無 `damage` 效果）
### M17.b — 自動技能掛載（複用 M7 引擎，零新機制）
- [ ] push `MODULE_REGISTRY`；鼓舞=S3 pinch / 守護=S3 guard / 疾風=S1 statMod（選 回復=S4 turnEnd / 整地=寫 field.current）
- [ ] `assembleExt`/`assembleBattlePrep` 帶 `equippedSkillIds` 進 `BattlePokemon` 暫態、hook 自行分流 + HpPlate 技能徽章 + vitest（觸發/分流/關閉零殘留）
### M17.c — 看穿主動槽（1 個、每場一次、純顯示層）
- [ ] 戰鬥行動列「✨ 夥伴技能 → 🔍 看穿」鈕 → 設 `revealedFoes.add(activeIndex)` + FxCanvas 揭露演出 + 扣每場一次預算（display state，不持久化）
- [ ] 接 M16 `MobCard`/`HpPlate` 讀 `revealedFoes` 揭露對手深度資訊（**不進 reducer、不耗回合、對手不回擊**）
### M17.d — SP 訓練經濟
- [ ] SP 錢包 slice `mobie.skillpoints.v1`（帳號級）+ wild 區 boss 勝利給 SP（接 `rosterStore`，與 `grantBattleExp` 同處；塔 SP 預留 M11）
- [ ] `PartnerSkillModal`（Title「✨ 夥伴技能」入口，複用 team-row/item-picker）：花 SP 學技能/調 loadout/第 2 槽解鎖（SP 或等級；進化解槽預留 M10）+ MobCard 技能列
- [ ] `mobie.settings.v1` 加 `modules.partnerSkills` toggle（預設關，關掉零殘留）+ vitest + Chrome CDP

## M18 — 全面改名 → Mobie（取代並擴大 M15；見 `16` §M18）
> **分類精準改名，不是一鍵 find-replace。** 放 M16/M17 之後做（機械式大改動，避免衝突 merge）。
> **⚠️ 絕不可改**：`artwork()` helper / gen_dex 的 `raw.githubusercontent.com/PokeAPI/.../pokemon/...` URL、外部服務名 `PokéAPI`、物種 zh-Hant 正典名。
### M18.a — 程式識別符＋檔名
- [ ] 型別/函式/元件/變數：`BattlePokemon`→`BattleMobie`、`buildBattlePokemon`→`buildBattleMobie`、`pokemon`→`mobie`（src 約 137 處/32 檔，扣除不可改 URL）
- [ ] 改檔名 `PokemonSprite.tsx`→`MobieSprite.tsx`、`PokemonVisual.tsx`→`MobieVisual.tsx`（含所有 import 路徑）+ typecheck 綠
### M18.b — UI 中文＋品牌字串
- [ ] 「寶可夢」→「Mobie」（約 32 處/24 檔）+ `package.json` name + `index.html` title（Mezastar Clone→Mobie）+ `manifest.webmanifest` name/short_name
### M18.c — 持久化 key 遷移＋.save 相容
- [ ] 7 個 key `mz.*`/`mz-*` → `mobie.*`/`mobie-*` + 集中 `migrateKeys()`（先讀新、無則搬舊）；IDB 二選一（搬遷 or 保留舊名）明文記錄
- [ ] `.save`：bundle/saveMeta manifest 加舊欄位/schemaVersion 識別、匯入舊檔對映舊→新、匯出新格式 + round-trip & 舊檔匯入 vitest
### M18.d — docs 全域改名
- [ ] handoff/README/CLAUDE/ARCHITECTURE/plan 的 `pokemon-mezastar`/「寶可夢」品牌字 → mobie/Mobie（PokéAPI 技術引用與物種資料來源照舊）
### M18.e — repo 目錄改名（最後、單獨）
- [ ] `pokemon-mezastar/` → `mobie/`（本機資料夾 + git remote，使用者執行）+ `npm run dev` 路徑確認 + 既有存檔載入驗證 + 立繪正常（artwork URL 未誤改）
