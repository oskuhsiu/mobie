# 增強互動性（Enhanced Interactivity）設定開關 — 四方 agent-chat 結論

參與：Claude / gemini / codex / mistral，round-robin，3 輪後**全體 agree、無未解分歧**而自動終止。

## 一句話
新增一顆 **UX 偏好分級開關**（非戰鬥模組）：`off | lite | arcade`，預設 `off`＝**現狀一字不差**。
開啟後在目前「零互動」或「單純 tap」的環節，疊上**不同身體動作的手勢**（畫圈/長按/節奏/下滑），
給兒童參與感。**手勢只輸出離散純量或純演出，pure reducer / 效能紅線 / 設定 slice 結構全不破。**

## 各方立場與收斂
- **定調（全體同意）**：增強互動性＝「**輸入形式多樣化**」而非「更多次點擊」。使用者嫌的「點一下又點一下」
  正是現在 tap→TimingBar→連打全是 tap；arcade 要靠 swipe/畫圈/長按/節奏帶來不同肌肉記憶。
- **分級而非 boolean**（gemini 提，全體採）：`off | lite | arcade` 控管疲勞風險。lite=直覺單一手勢；arcade=機台式高頻。
- **資料結構**（codex/mistral 收斂）：`prefs.enhancedInteractivity = { mode, surfaces: Record<Surface, boolean> }`。
  **不做使用者 intensity 滑桿**（過早複雜化）——強度由 mode 派生內部常數。`surfaces` 即使 off 也預設填滿
  （避免日後新增 surface 出現 undefined gating）。各頁統一用 selector `isEnhancedSurfaceEnabled(settings, 'capture')`。
- **Q1 既有攻擊 MashMeter 怎麼辦？分歧 → 裁定 (a)**：gemini 原主張 (b)（off 跳過連打只留 TimingBar）；
  **codex 反對並獲 mistral 附議、gemini 最終接受**：選 (a) 維持 MashMeter 不動，死守「off = 現狀一字不差」鐵律，
  避免把「增強互動性」混成「簡化戰鬥節奏」造成 QA/玩家理解與回歸風險。arcade 想把連打換節奏點擊＝
  獨立後續旗標 `attackInputVariant: 'mash' | 'rhythm'`，列 backlog，不進 MVP。
- **Q3 範圍（全體同意）**：MVP 只做**捕獲 + 星擊**兩個情緒峰值最高點；攻擊變體/遭遇/孵化/塔列同 plan 後續階段。

## 定案：MVP 兩個 surface
1. **捕獲 `capture`**：lite = swipe/flick 丟球（單一動作）；arcade = swipe 丟球 + 晃動時**畫圈注入封印**。
   **命中維持預先決定**（ResultScreen 的 Math.random 不動），手勢只決定演出 + 「再搏一下」**純演出寬限**
   （失敗後可再畫一次，僅影響動畫、UI 標娛樂性，絕不改機率/難度）。
2. **星擊 `starStrike`**：lite = 長按蓄力環；arcade = 節奏三連點。**不沿用攻擊連打避免重複**。
   中斷/逾時**安全退場**（保留部分蓄力或自動以基準放招）。

## 定案：手勢肌肉記憶分流（避免全是 tap）
攻擊=連打（既有不動）／防禦=下滑拉護盾（取代短連打，仍映射 quality）／捕獲=畫圈／星擊=長按或節奏。

## 定案：同一 plan 的後續階段（backlog，不進 MVP）
- 防禦下滑護盾 `defense`
- 攻擊節奏變體 `attackInputVariant`
- 遭遇前撥草/刮刮樂 `encounter`
- 孵化摩擦生熱 `hatch`
- 連勝塔開場選路/破門 `tower`（隨 M11 連勝塔落地）

## 落地骨架（守三鐵律）
- 新增偏好住 `mobie.settings.v1` 的 `prefs`（**不塞進 modules**，因為它不註冊 seam）；migrateSettings 向後相容（缺欄＝off）。
- 新增 `src/input/gestures/`：純手勢函式（swipeFromPointer / circleProgress / holdCharge / rhythmTaps），
  比照 `input/qte.ts` 契約輸出**單一純量**；component 高頻值（trail/圈數/速度）全 ref/rAF/DOM，不進 React 頂層 state。
- **與 M4 體感同源**：日後 MediaPipe 餵同樣的 pointer/progress，手勢層即觸控前身。
- reducer/engine/event **零變更**；捕獲互動屬 ResultScreen 顯示層。

## 驗收準則（codex 補，採納）
- `mode=off`：跑既有 golden path 戰鬥/捕獲，**DOM 不得出現新增互動 wrapper**（零回歸、零殘留）。
- `mode=lite/arcade`：測手勢**逾時 / 取消 / 多指誤觸 / 低 FPS** 下仍**只 dispatch 一次 completion**。
