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

## M2 — QR 掃描 + 卡庫
- [ ] `parseCardCode()`：MZ1 解析 + CRC 校驗
- [ ] BarcodeDetector 掃描 + zxing fallback
- [ ] cards 表 JSON/CSV 匯入
- [ ] 掃描→反查→存入「我的寶可夢」
- [ ] 自製產卡/印卡工具
- [ ] 掃描失敗 UI 回饋
- [ ] **持久化換 Dexie 時導入 `SaveEnvelope`（`updatedAt`/`revision`/`deviceId`/`schemaVersion`）** → 為 M5 雲端同步鋪路（見 `08-cloud-sync.md` C/H 段）

## M3 — R3F 3D 場景 + 造型層
- [ ] R3F 戰鬥舞台（台座、光照、運鏡）
- [ ] `PokemonVisual` 抽象介面
- [ ] GLB 檔案匯入 → IndexedDB → 正規化
- [ ] billboard fallback（PokéAPI artwork）
- [ ] 攻擊/受擊/捕獲演出移植 3D
- [ ] Zustand subscribe / useFrame 橋接（效能紅線）
- [ ] iPad ≥ 30fps 驗證

## M4 — MediaPipe 體感 QTE
- [ ] @mediapipe/tasks-vision 接入（Hand + Gesture）
- [ ] 相機權限/延遲/電量/WebGL 並存 PoC 報告
- [ ] 手勢對應：連打=蓄力、握拳=停輪盤
- [ ] `MediaPipeInput` 實作 `InputSource`，與 TouchInput 熱切換
- [ ] 主執行緒節流 PoC → Worker/OffscreenCanvas 升級
- [ ] 效能紅線：連續座標只寫 Zustand

## M5 — 雲端同步記錄（見 `08-cloud-sync.md`）
- [ ] `SaveEnvelope` 信封（`schemaVersion`/`deviceId`/`updatedAt`/`revision`/`roster`）+ 本地遷移（裸陣列 → 信封）
- [ ] `rosterStore` 存檔時 bump `updatedAt`/`revision`
- [ ] `CloudSyncAdapter` 介面（`pull`/`push`/可選 `subscribe`）+ 後端供應商抉擇（vendor 中立、secret 不入庫）
- [ ] `SyncCoordinator`：Pull→Merge→Push、觸發點（開啟/online/visibility/存檔 debounce）、非阻塞容錯
- [ ] 比對新舊：LWW by `updatedAt`→`revision`→server time；divergence 偵測 + 舊檔本地備份
- [ ] 同步狀態 UI：上次同步時間 / 已最新 / 同步中 / 離線 / 手動立即同步
- [ ] 邊界：雲端空、本地空（新裝置）、schema 遷移、時鐘偏移

## M6 — 延伸系統群（可模組化、可選式掛載；見 `09-extension-systems.md`）
> 每個系統能整顆關掉、關掉零殘留、不破壞「純 reducer / 只存 canonical OwnedUnit」兩不變式。預設全關。

### M6.0 掛載地基 + 回合相位契約（地基，先做）
- [ ] `ExtensionModule` + 擴充縫（S1–S8）定義；`assembleExt(enabledModules)` 住 store 層
- [ ] `resolveTurn(state, action, {rng, ext})` 第三參數加 `ext`（預設 `{}`，既有 69 測試不動）
- [ ] settings save slice（`mz.settings.v1`，獨立命名空間，逐系統開關）
- [ ] §0.4 回合相位契約落地：`starStrike` 收成 `ATTACK` mode、S4 在 timeout 判定前、攻擊型動作吃速度排序 + 對應測試
### M6.a 隊伍羈絆（最乾淨，先驗證地基）
- [ ] `computeSynergy(team)→NamedModifier[]` 純函數 + 規則集（每 modifier 帶 label/source/icon）
- [ ] S2 掛載：戰鬥初始化/編隊變更單次重算（換 active 不重算）；選卡畫面顯示生效 tag
### M6.b 持有道具
- [ ] `OwnedUnit.heldItemId` 一欄（canonical）+ `ItemDef` 手寫表（三類：statMod/damageHook/onceTrigger）
- [ ] `mz.itembag.v1` 獨立背包 slice；S1/S3/S4 掛載；同步 `applyItemTriggers`（禁 async/callback/重入）
- [ ] 裝備 UI + 戰鬥道具 icon + onceTrigger 演出
### M6.c 進化
- [ ] `gen_dex.mjs` 加 PokéAPI evolution-chain → species `evolvesTo`/`evolveLevel`
- [ ] S6 postGrowth：等級觸發改 `speciesId`、個體欄位全保留、招式維持單一；結算進化演出（可取消）
### M6.d 連鎖攻擊
- [ ] 連鎖槽（QTE/連續命中累積，不綁隨機）+ `chainOpportunity` event
- [ ] `SUBMIT_CHAIN_RESULT{hits}` 單一 action（payload 只是 quality 宣告）；reducer 重驗存活/目標、吃速度、倒下截斷
- [ ] 連續 QTE overlay（高頻走 ref/rAF）+ 連段 FX
### M6.e 連勝塔 / 遠征
- [ ] `RunState` 獨立 slice（`mz.run.v1`，只參照 roster id；防火牆：暫態不逆寫 OwnedUnit）
- [ ] `generateRunMap(seed)` 決定論節點（battle/elite/event/campfire/shop/boss）+ 分支選路
- [ ] XState `tower` 平行子模式 + RegionSelect 入口；run 內合成載入（OwnedUnit+runModifiers+runHp→BattleUnit）
- [ ] run 結算才寫回 roster（EXP/道具/捕獲/進化）；二階 Ascension（backlog #15）延後
