# M4 — MediaPipe 體感 QTE

> 把 M1 的觸控 timing QTE 升級為相機體感，貼 Mezastar 街機手感。

## 成功標準
1. iPad Safari 取得相機權限後，MediaPipe Hand/Gesture 即時辨識，延遲可接受。
2. 手勢對應：**連打/揮手 = 蓄力**、**握拳 = 停輪盤 / 結算 timing**，餵入 M1 既有的 `InputSource` 介面。
3. 與 WebGL 3D 場景並存時幀率、電量、發熱在可用範圍（PoC 報告）。
4. 觸控永遠保留為完整可通關路徑，手勢只是增益疊加。

## 範圍
- **@mediapipe/tasks-vision**：HandLandmarker + GestureRecognizer。
- **階段化**：先主執行緒節流 15–30fps 跑 PoC，驗證相機權限/延遲/電量/WebGL 並存；穩了再抽到 Web Worker / OffscreenCanvas。
- **MediaPipeInput**：實作 `InputSource`，輸出 `{ chargeLevel, timingHit }`，與 `TouchInput` 可熱切換。
- **效能紅線**：手部連續座標只寫 Zustand，3D/UI 經 `useFrame`/`subscribe` 讀取，禁寫 React 頂層 state。

## 不做
- 全身姿態、多手、雲端推論；體感成為通關必要條件。
