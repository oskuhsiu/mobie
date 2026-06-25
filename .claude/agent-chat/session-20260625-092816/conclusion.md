# 結論 — mobie 增強路線（EXT 系列）四方圓桌

參與：Claude（主持＋參與）、gemini、codex、mistral。模式 round-robin，2 輪達全體 agree、無未解分歧。

## 各方立場
- **Claude**：以「對兒童的即時爽感 × 成本 × 對不變式風險」三維排序；主張純 display 項先行、唯一動核心的 A1 走 module 化、養成 meta 後置、A5 否決。
- **gemini（兒童 UX/視覺）**：強調「回饋爽感即遊戲」；C3 非讀者友善應揉進 B1（大圖示+音效，不靠文字）；C2 教學降級為複用 B1 UI 的脈衝動畫（發光手指），不立專項；A4 頭目要的是「大怪獸暴怒」氛圍而非機制解謎；5 歲兒童延遲滿足弱→局內回饋優先於養成 meta。
- **codex（純度/seam 守門）**：把「純 display」邊界寫死＝只 consume event/selector、不新增 reducer side-effect、hit-stop 是 presentation clock pause 不改戰鬥時間線；A1 須 modules.statusEffects（非 prefs，因會改規則語義）、狀態資料放 battle state、tick/傷害/恢復由 deterministic turn phase 發 event、禁 UI timer/外部 random 回寫；A4＝encounterProfile phase thresholds 發 phaseChanged，不開 boss 專用 reducer 分支；A2/A3 牽涉持久化/經濟/資料管線→留 meta loop。
- **mistral（模組邊界/測試）**：B2 與 B1 可共用事件攔截架構（onCast→cinematic→resume）；要求 23.1 就定義 cinematicCoordinator 介面（pauseBattle/resumeBattle、支援疊層 hit-stop+慢鏡）避免 B2 重構；A1 零殘留須 if(!enabled)return state 完全跳過且關閉時清空 battle.statusEffects。

## 共識（定案）
1. **優先級分層**
   - 必做・最快見效（純 display）：B1 打擊感 + C1 Haptics + C3 圖示音效 + B4 Sprite動態/轉場/修4置中overlay + C2 脈衝引導 + 鋪 cinematicCoordinator seam。
   - 緊接交付：B2 星擊電影化（消費上面 seam）。
   - 視覺續做：B3 地形/天氣視覺化。
   - 唯一動核心（module 化）：A1 狀態異常（modules.statusEffects 預設 off）；A4 頭目階段為其衍生 rider。
   - 養成 meta（後段）：A2 貨幣+商店 + A3 任務每日。
   - 否決：A5 招式 PP（兒童負擔、動核心、污染招式資料/UI、ROI 低）。
2. **B2 折衷**：架構同梯、交付分梯——23.1 鋪 onCast 攔截 + presentation pause API；B2 的 letterbox/cut-in/運鏡留 23.2。
3. **A1 純度路徑**：modules.statusEffects 預設 off；獨立 battle.statusEffects（與 OwnedUnit 解耦、不持久化）；deterministic turn phase 發 status event（沿用 S4 turnEndTrigger 風格）；off 時 case 完全跳過、關閉清空狀態。
4. **A4**：encounterProfile HP 門檻發 phaseChanged event tag，視覺/招式消費，不開 boss 專用 reducer 分支。
5. **A2/A3**：綁成一包養成 meta loop（賺幣→商店買球/孵蛋/道具→每日任務），排在 B 視覺梯與 A1 之後。
6. **C 軸打磨**：C3 揉進 B1（驗收準則）；C2 降級為複用 B1 UI 的脈衝提示；C4 操作人因（慣用手/誤觸確認）併入 B1 局內操作打磨，慣用手切換列 backlog。

## 全程紅線（寫進每份文件）
- display-only 項不得寫 battle state；hit-stop=presentation clock pause。
- A1 只能 module off-by-default、零殘留；不持久化衍生/RNG 狀態。
- 新資產走原創/procedural；PokéAPI 僅 runtime URL；generated files 不手改（改 generator）。
- 高頻值走 ref/rAF/DOM/Zustand，絕不進 React 頂層 state。

## EXT 產出結構（plan/）
- EXT.0 強化報告（總覽＋13項評估＋分層＋取捨＋紅線）
- EXT.1 局內爽感（B1+C1+C3+B4+C2+cinematicCoordinator seam）
- EXT.2 星擊電影化（B2）
- EXT.3 地形/天氣視覺化（B3）
- EXT.4 狀態異常 module（A1＋A4 rider）
- EXT.5 養成 meta loop（A2+A3）

## 未解分歧
無。三方於第 2 輪全數 agree。
