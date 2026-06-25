# EXT.3 — 地形 / 天氣視覺化

> 上層真相＝[`EXT.0`](EXT.0-enhancement-report.md)。無硬依賴（可與 EXT.2 並行）。
> **範圍**：B3——M13 已把 16 區地形（雨/晴/沙/電場/草地…天氣/場地/特殊型）做進**資料**，但戰鬥畫面零反映。
> **一句話**：讓 `field.terrainEffects.current` 與 region 主題在 R3F 戰鬥場景**看得見**，純 display、reducer 不動。

---

## 1. 現況
- `BattleState.field.terrainEffects.{initial,current}` 持有 `TerrainId[]`（reducer 只存 id，倍率由注入 resolver 解析）。
- M11「地形突變」野外意外會改 `current` 並發 `wildAccident{kind:'terrainShift'}` event。
- 但 `BattleStage`/`sceneParts` 目前**不讀** terrain → 不同主題區戰鬥畫面長一樣。

## 2. 紅線
- 純 display：只讀 `field.terrainEffects.current` / region 主題 / 消費 `wildAccident` event；不寫 battle state。
- 資產原創/procedural：雨絲/陽光/沙塵/電場用 **Canvas 粒子或 R3F 程序材質**（不抓圖、不引侵權貼圖）。
- 效能：粒子/著色器走 R3F 既有 rAF 迴圈與 `FxCanvas`，不進 React 頂層 state；低階裝置可退場（接 `juice`）。

## 3. 設計
- 新 `src/scene/r3f/terrainVisual.ts`（宣告式純資料表，比照 `fxCatalog`）：
  `TerrainId → { groundTint, ambient, particle: 'rain'|'sun'|'sand'|'spark'|'leaf'|none, fog? }`。
- `BattleStage`/`sceneParts` 讀目前 terrain → 套地面色調/環境光/天氣粒子層。
- **天氣粒子** 用既有 `FxCanvas` 疊一層持續發射（雨/沙/電光），或 R3F instanced points；強度隨 `juice` 分級。
- **地形突變**：消費 `wildAccident{terrainShift}` → 過場切換新地形視覺（淡入＋一次性 flash），呼應既有事件。
- billboard fallback 路徑：至少套背景色調與 2D 天氣覆蓋層（不需 3D 也有差異）。

## 4. 落點檔案
- 新增：`src/scene/r3f/terrainVisual.ts`（資料表＋resolver）、可選 `src/scene/r3f/WeatherParticles.tsx`。
- 修改：`src/scene/r3f/BattleStage.tsx`、`src/scene/r3f/sceneParts.tsx`、`src/ui/screens/BattleScreen.tsx`（傳 terrain/region 給場景；接 terrainShift 過場）。
- **不改**：`reducer.ts` / `engine.ts` / `game/data/*`（terrain 資料已由 gen_dex 產生；本檔只加「視覺對照表」，非戰鬥資料）。

## 5. 驗收
- 16 區/各 terrain 至少有可辨識的畫面差異（CDP 逐區抽驗截圖）。
- 地形突變過場正確切換；`juice:'reduced'/'off'` 時粒子降載/退場仍不報錯。
- 同一 seed 戰鬥 `nextState` 不變（純視覺）。typecheck/test/build 全綠。
