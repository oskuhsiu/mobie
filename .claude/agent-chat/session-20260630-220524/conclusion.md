# EXT.3 地形/天氣視覺化 — 圓桌定調結論

四方圓桌（Claude + mistral + gemini + codex），2 輪收斂，gemini/codex 皆標 agree，無剩餘分歧。
此結論即 EXT.3 實作 spec，動工照此走。

## 各方立場摘要
- **天氣粒子層級**：mistral 提議「掛進 FxCanvas 的 persistent layer」省一個 canvas；Claude/gemini/codex 反對
  （混『事件型 scheduler』與『狀態型持續 renderer』生命週期 → juice 切換/清場殘留難除錯，且多一個 canvas 的
  composite 成本極低）。**3:1 定案：獨立 WeatherCanvas**。給 mistral 公道的關鍵反駁＝獨立層一樣能 idle-stop，
  拿到「職責分離 + 同等省電」兩全。
- **原型數**：mistral 把 Claude 初擬 7 個擴成 8 個並改良（none→mist 提辨識度）；gemini 補「per-particle 上色」
  讓 8 原型覆蓋 22 區不失辨識度；codex 收成「8 emitter + 每 terrain 一份 palette」並補 `none` 命名邊界。全體同意。

## 定案（LOCKED）

### A. 分層架構（4 層，z 序）
```
z10  DOM HUD/controls       — 不動
z5   FxCanvas               — 只收一次性爆發（含 terrainShift flash）；idle-stop 不變
z2   WeatherCanvas（新）     — 狀態型持續粒子；無天氣/juice=off 時自停 rAF（同等省電）
z0   R3F BattleStage        — 讀 palette：groundTint + ambient + fog（+ 既有立繪/舞台）
```
- **不碰 FxCanvas**（保住 EXT.1/EXT.2 的 idle-stop 命脈）。
- billboard fallback：R3F 換成 CSS tint（hue-rotate/brightness）+ 同一個 WeatherCanvas 疊在上面。

### B. 8 emitter 原型 + 每 terrain 一份 palette
- 原型：`rain / snow / sand / ember / electric / wind-petal / mist / none`（不新增第 9 個）。
- `palette = { groundTint, ambient, fog?, particleColor, emitter, sparkAccent? }`。辨識度靠 palette：
  同一 `wind-petal` 在 flowerfield＝粉花瓣、grassland＝綠落葉；同一 `mist` 在 haunt＝紫黑、fog＝灰白。
- **`none` 的命名邊界（codex）**：= 「無持續粒子 emitter」，**不**等於 WeatherCanvas 不能畫靜態 overlay。
  → sunny 用 `none` emitter + WeatherCanvas 畫 2–3 道低透明度斜向 god-ray 漸層光柱（palette overlay，非原型）。

### C. 22 → emitter 對照表（LOCKED）
| emitter | terrains |
|---|---|
| rain | rain, coastal, steam, swamp |
| snow | snowfield |
| sand | sandstorm |
| ember | volcanic, dragons-peak |
| electric | stormfield, electric-field |
| wind-petal | flowerfield, grassland, grassy-field, strong-winds, misty-field |
| mist | fog, haunt, mystic, cavern, holy-ground |
| none | sunny（+god-ray overlay）, neutral |
- **psychic-field**（唯一小分歧，已解）：emitter = `mist` + `palette.sparkAccent`（極稀紫藍電弧點），
  不新增原型、不歸 electric（『精神場』視覺偏霧不偏電弧）。

### D. juice 分級（嚴格）
- **full**：R3F palette + fog + WeatherCanvas 100% 密度。
- **reduced**：R3F palette + 輕 fog + WeatherCanvas ~25–35% 密度（或僅 mist），半透明。
- **off**：完全回 M22 基線 — 不動 R3F 場景、WeatherCanvas 停 rAF、無任何 terrain 視覺。

### E. terrainShift 過場
- 消費既有 `wildAccident{terrainShift}` event：R3F palette 淡入切換 + FxCanvas 放一次性對應色 flash。

## 落點檔案（同 plan/EXT.3 §4）
- 新增：`src/scene/r3f/terrainVisual.ts`（TerrainId → palette 資料表 + resolver，宣告式，比照 fxCatalog）；
  `src/scene/fx/WeatherCanvas.tsx`（canvas2D 持續層，8 emitter，imperative + 自管 rAF + idle-stop）。
- 修改：`BattleStage.tsx` / `sceneParts.tsx`（吃 palette 上 groundTint/ambient/fog）；
  `BattleScreen.tsx`（傳 terrains/region/juice 給場景與 WeatherCanvas；接 terrainShift 過場）。
- 不改：`reducer.ts` / `engine.ts` / `game/data/*`（純 display；同 seed nextState 不變）。

## 驗收
- 16 區/各 terrain 有可辨識畫面差異（CDP 逐區抽驗）；terrainShift 過場正確；
  reduced/off 降載不報錯、off 嚴格回 M22 基線；同 seed nextState 不變；typecheck/test/build 全綠。

## 確認用 ASCII（haunt，codex 版，動工目標長相）
```
z10 DOM HUD        HP bars / skills / turn state
z5  FxCanvas       idle; terrainShift 時紫黑 flash 一次
z2  WeatherCanvas  mist: 低飄紫黑霧，full 濃 / reduced 薄
z0  R3F Stage      groundTint #1d1726, ambient #6c4b8f, fog near 6 far 24

        faint violet fog drifting across screen
    ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~
        [ALLY A]                    [ENEMY X]
   _____________________________________________
        dark floor tint, low contrast, purple backlight
```