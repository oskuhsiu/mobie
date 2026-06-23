# 圓桌結論 — 地形系統 + 模式分流 + 野外意外（選 5）

## 任務
設計：①更多地形（含混合地形）+ 地形影響戰力 + 隨機地形 ②練習場改競技場（純經驗、不可捕獲）vs 野外 ③從 10 種野外意外挑 5。三方全 agree、共識自動終止。

## A 地形系統（定案）
- **只影響攻擊 power**（不碰防禦）：`engine.resolveAttack` 在 type 相剋後加一個**注入的 terrain mult**（像既有 QTE mult）。
- `TerrainDef { id, name, icon, mods: Partial<Record<TypeName, number>> }`（type→招式 power 倍率，>1 增 <1 減）。
- **混合地形**＝2 個 TerrainDef 的 mods **逐屬性相乘**；**最終每屬性倍率嚴格夾 [0.5,1.5]**（單一/混合同一 clamp 函式、無例外規則，防爆數值）。
- **隨機地形**＝開場**決定論抽**（沿用 rng/seed）、UI 揭示。
- **不做持續回合/設置招式**（守單招、避免複雜）。
- 數量：設計約 10–12 種地形（對齊 8 區主題 + 幾個混合/特殊），每區指定 1–2 個 terrain（2=混合）。
- `BattleState` 分 **initialTerrains vs currentTerrains**（戰鬥內暫態、不持久化、不回寫 Region）；供 UI/戰報說明變化。

## B 模式分流（定案）
- `mode: 'arena' | 'wild'` 是**玩法 contract**，非 UI 分類。
  - **arena 競技場**（原練習場）＝中性地形（無倍率）+ **無野外意外** + **不可捕獲** + 純經驗；**保留既有支援輪盤**（核心街機手感，全關會變枯燥自動播放）。
  - **wild 野外**（其餘 8 區）＝地形 + 捕獲 + 野外意外 + 報酬波動。
- **gating 集中在 encounter/battle setup**：只有 `mode==='wild'` 才 roll terrains / wild-RandomEvents / capture eligibility。**移除散落的 isPracticeRegion 替代品**。
- 捕獲資格 / 稀有 boss / 幸運加碼一律 **encounter/reward 層 flag**，不讓 OwnedUnit / canonical unit schema 帶戰鬥臨時資訊。

## C 野外意外（最終 5，wild-only）
1. **亂入野生**：一次性傷害/支援事件，**不新增第 4 隻 canonical unit**。
2. **地形突變**：戰中地形隨機改變（改 `BattleState.currentTerrains`，一個 RandomEvent）。
6. **天降補給**：三選一獎勵（回血/攻擊buff/額外球），**嚴格限開場前或戰鬥結算後彈出、絕不戰鬥回合中途**（守單招心流）。
7. **稀有閃光 boss**：生成時機率 flag → boss 升異色/高 Grade（接 wave-2 Grade），encounter 層。
9. **幸運加碼**：純 reward modifier（本場勝利額外經驗 / 捕獲率提升）。

**Backlog（記下）**：10 暴擊潮（與既有 crit 重疊）、3 氣象疊加（與地形突變重疊）、4 狂暴化（要追蹤持續 buff 違反避免複雜狀態）、5 背水一戰（像保底非野外意外）、8 狙擊先制（不可互動開場懲罰、體感差）。

## 紅線總結
- 6 三選一不可戰鬥中途彈出。
- 地形只影響攻擊 power、每屬性倍率夾 [0.5,1.5]。
- 戰鬥臨時資訊（terrain/稀有/幸運）不進 canonical OwnedUnit；只進 BattleState 暫態或 encounter/reward flag。
- arena/wild 用 mode contract，gating 集中 setup，不散落。

## 待設計階段定 / 玩測
地形數值與每區指派、隨機地形池、意外觸發頻率與權重、稀有 boss 機率、幸運加碼幅度、天降補給選項池。
