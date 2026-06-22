# M3 — R3F 3D 戰鬥場景 + 可插拔造型層

> 把 M1 的 2D 對戰演出升級為類 3D 場景。

## 成功標準
1. R3F 場景渲染戰鬥舞台（台座、光照、相機運鏡），iPad Safari 穩定 ≥ 30fps。
2. 可插拔造型層：每隻寶可夢 visual 依序解析 ①使用者本機 drop-in 的 GLB → ②缺則 billboard（PokéAPI artwork 貼圖平面，永遠面向相機）。
3. 攻擊/受擊/捕獲演出在 3D 場景重現（M1 的演出語言移植）。

## 範圍
- **造型抽象介面** `PokemonVisual`：`loadModel(speciesId) → GLB | BillboardFallback`。
- **GLB 匯入**：使用者把 GLB 放入（檔案匯入 → IndexedDB blob），按 speciesId 對應；正規化縮放/置中/朝向。
- **billboard fallback**：`<Billboard>` + texture，預設方案，確保任何寶可夢都有畫面。
- **狀態橋接**（效能紅線）：戰鬥數值經 Zustand `subscribe` / `useFrame` 進場景，不經 React 頂層 render。

## 不做
- 內建/抓取/散布任何侵權模型；複雜骨架動畫（先 idle + 簡單 transform）。
