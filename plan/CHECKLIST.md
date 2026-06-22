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
### M1.5a 隊伍模型 + 3v3 依序 + 純 reducer
- [ ] BattlePokemon party 模型（雙方各 3 隻 + activeIndex）
- [ ] cardSelect 改多選 3 隻組隊
- [ ] `resolveTurn(state, action) → { nextState, events[] }` 純函數
- [ ] domain events：damageApplied / memberFainted / activeChanged / switchDefenseResolved / battleEnded
- [ ] 倒下→自動送下一隻、全滅判定勝負
- [ ] vitest：3v3 依序 KO、強制換、全滅勝負
### M1.5b 主動換人 + 防禦 QTE + 隊伍 UI
- [ ] 換人行動：收回→放出→對手打換上的→防禦 QTE 抵減（90/60/30/0）
- [ ] 防濫用：每回合一次、剛換上不能換回；換上即倒→立即強制換（測試）
- [ ] 攻擊 QTE / 防禦 QTE 共用 qualityFromPointer seam
- [ ] 底部隊伍 tray（3 隻 HP pip + 倒下灰階）+ 換人面板
### M1.5c 視覺特效
- [ ] FxCanvas（imperative canvas2D 粒子，不過 React state）：屬性受擊粒子/攻擊軌跡/會心
- [ ] framer-motion：角色位移、螢幕 shake、受擊 flash、倒下淡出
- [ ] 換人動畫：收回光束/放出開球閃光
- [ ] BattleScreen display-state 依序消費 event queue（await FX/motion callback）
### M1.5d 音效 + BGM
- [ ] audioEngine 介面：unlock()（iOS 首次觸控）/ play(sfxId) / setIntensity(level)
- [ ] Tone.js 在 unlock 時動態 import（控 bundle）
- [ ] 程序化 preset SFX：命中/倒下/選取/效果絕佳/低血量嗶；chiptune BGM loop
- [ ] setIntensity：低血量警報 / BGM crossfade，不停 transport

## M2 — QR 掃描 + 卡庫
- [ ] `parseCardCode()`：MZ1 解析 + CRC 校驗
- [ ] BarcodeDetector 掃描 + zxing fallback
- [ ] cards 表 JSON/CSV 匯入
- [ ] 掃描→反查→存入「我的寶可夢」
- [ ] 自製產卡/印卡工具
- [ ] 掃描失敗 UI 回饋

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
