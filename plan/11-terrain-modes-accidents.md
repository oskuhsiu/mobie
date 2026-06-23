# 11 — 地形系統 + 模式分流 + 野外意外（M7）

> 三方圓桌（Claude/gemini/codex）收斂，結論 `.claude/agent-chat/session-20260623-102647/conclusion.md`。
> 本批是**核心玩法擴充**（非 M6 那種可選模組）：地形改變核心戰鬥、模式分流改 region/capture、野外意外擴 M1.5g。
> 守鐵律：**純 reducer**（地形倍率如 rng/QTE 般注入，不寫死）、**只存 canonical OwnedUnit**（地形/意外全為戰鬥內暫態或 encounter/reward flag）、**單招街機**（地形不做持續回合/設置招式）、**不重引硬控**。
> 取代延伸 backlog #3「場地效果」（原為可選模組，現升為核心）；野外意外接續 `07-systems-design.md` 的意外機制。

---

## 1. 地形系統（Terrain）

### 1.1 核心模型（圓桌 A 定案）
- **地形只影響攻擊 power**（不碰防禦，最直覺、傷害式最乾淨）。
- 落點：`engine.resolveAttack` 在 **type 相剋之後**乘一個**注入的 terrain mult**（與既有 QTE mult 同位階的純倍率）；reducer 透過注入帶入地形（像 rng），**不認識地形語意**。
- 依**招式屬性**套倍率：每隻單招≈該隻屬性，故「地形影響該屬性寶可夢的戰力」（需求原文）。

```ts
type TerrainId = string
interface TerrainDef {
  id: TerrainId; name: string; icon: string
  mods: Partial<Record<TypeName, number>>   // type → 招式 power 倍率，>1 增、<1 減
}
// 純函數：算某招式屬性在當前地形（可多個=混合）下的最終倍率
function terrainMultiplier(moveType: TypeName, terrains: TerrainDef[]): number {
  let m = 1
  for (const t of terrains) m *= (t.mods[moveType] ?? 1)   // 混合＝逐屬性相乘
  return Math.min(1.5, Math.max(0.5, m))                   // 最終每屬性夾 [0.5,1.5]（單一/混合同一 clamp，無例外）
}
```

### 1.2 混合地形（圓桌 A 定案）
- 一個區域可帶 **2 個 TerrainDef** → `mods` **逐屬性相乘**，再經同一 `clamp [0.5,1.5]`（防兩個 ×1.3 疊成 1.69 爆數值）。
- 例：水濱 + 草原 → water↑ 且 grass↑（各自夾上限）。

### 1.3 隨機地形（圓桌 A 定案）
- 某些 wild 區域標記為隨機地形：**開場從地形池決定論抽**（沿用 mulberry32 / encounter seed），UI 開場揭示。
- 抽出的地形即該場 `initialTerrains`，之後可被「地形突變」意外改成 `currentTerrains`。

### 1.4 戰鬥內狀態（圓桌 ② 定案）
- `BattleState` 加 **`initialTerrains` / `currentTerrains`**（戰鬥內暫態，**不持久化、不回寫 Region**）；分清「初始 vs 目前」供 UI/戰報說明變化。
- 「地形突變」意外＝一個 `RandomEvent` 改 `currentTerrains`；攻擊結算讀 `currentTerrains`。
- **不做持續回合計時 / 設置招式**（守單招、避免複雜狀態）。

### 1.5 地形清單（先設計 ~12 種，玩測再調數值）
| id | 名 | 主要 mods（示意，待平衡） | 用於 |
|----|----|--------------------------|------|
| grassland 草原 | 🌿 | grass1.3 bug1.2 ground1.1 fire0.8 | 常綠森林 |
| volcanic 熔岩 | 🌋 | fire1.4 rock1.1 ice0.6 water0.8 | 灼熱火山 |
| coastal 水濱 | 🌊 | water1.3 ice1.1 electric1.1 fire0.7 | 澄澈水濱 |
| stormfield 雷原 | ⚡ | electric1.4 flying1.2 ground0.7 | 雷鳴高原 |
| cavern 岩窟 | 🪨 | rock1.3 ground1.3 fighting1.1 flying0.7 | 岩窟洞穴 |
| haunt 幽域 | 👻 | ghost1.4 dark1.2 poison1.1 psychic0.7 | 幽魂古塔 |
| mystic 靈域 | 🧚 | psychic1.3 fairy1.3 dark0.7 | 神秘花圃 |
| dragons-peak 龍峰 | 🐉 | dragon1.3 steel1.2 ice1.1 fairy0.8 | 巨龍峰頂 |
| sandstorm 沙暴 | 🏜️ | rock1.2 ground1.2 steel1.1 water0.8 | 新混合/特殊區 |
| snowfield 雪原 | ❄️ | ice1.4 water1.1 grass0.8 fire0.7 | 新混合/特殊區 |
| flowerfield 花海 | 🌸 | fairy1.3 grass1.2 bug1.1 poison0.8 | 新混合區 |
| neutral 中性 | ⬜ | （無 mods） | **arena 競技場** |

- **更多地形 / 混合地形落地**：新增 1–2 個混合地形 wild 區（如「海濱濕地＝coastal+grassland」「火山岩窟＝volcanic+cavern」）+ 1 個隨機地形 wild 區（「幻象之境」每場抽）。
- **擴充地形完整目錄（天氣型 / 場地型 / 特殊型）與分階段推出見 [`13-content-roadmap.md`](13-content-roadmap.md) §2**（依本傳 weather/terrain/環境整理）。合體技灌注的地形（plan/12 §4.2）亦取自該目錄。

---

## 2. 模式分流：競技場 vs 野外（圓桌 B 定案）

### 2.1 玩法 contract（不是 UI 分類）
```ts
interface Region { /* …既有… */ mode: 'arena' | 'wild'; terrains?: TerrainId[]; randomTerrain?: boolean }
```
| 模式 | 地形 | 野外意外 | 捕獲 | 經驗 | 既有支援輪盤 |
|------|------|----------|------|------|--------------|
| **arena 競技場**（原練習場） | 中性（無倍率） | ❌ 無 | ❌ 不可捕獲 | ✅ 只得經驗 | ✅ **保留**（核心手感） |
| **wild 野外**（其餘區） | ✅ 地形（含混合/隨機） | ✅ 5 種 | ✅ 可捕獲 boss | ✅ | ✅ |

- **arena 保留既有支援輪盤**（圓桌 ③）：那是街機戰鬥手感核心，全關會讓練等淪為枯燥自動播放；只把**新的 5 個野外意外**鎖在 wild。
- 練習場 → 競技場：relabel + 設 `mode:'arena'`（可再加幾個競技場變體）。

### 2.2 gating 集中（圓桌 B）
- **集中在 encounter / battle setup**：只有 `mode==='wild'` 才 roll terrains / wild-RandomEvents / capture eligibility。
- **移除散落的 `isPracticeRegion` 替代品**，改讀 `region.mode`。
- **捕獲資格 / 稀有 boss / 幸運加碼一律 encounter/reward 層 flag**（圓桌 ④），**不讓 OwnedUnit / canonical unit schema 帶戰鬥臨時資訊**。

---

## 3. 野外意外（wild-only，最終 5；圓桌 C）

> 全走既有統一 `RandomEvent`，wild 專屬。接續 M1.5g（支援輪盤/球輪盤/連打/星擊）。

1. **亂入野生（intrusion）**：一次性傷害/支援事件（對隨機一方補一刀），**不新增第 4 隻 canonical unit**（純事件，state 乾淨）。
2. **地形突變（terrainShift）**：戰中地形隨機改變 → 改 `BattleState.currentTerrains` 的一個 `RandomEvent`，戰力天平一瞬翻轉。
6. **天降補給（supplyCache）**：三選一獎勵（回血 / 攻擊 buff / 額外球）。**嚴格限開場前或戰鬥結算後彈出、絕不戰鬥回合中途**（守單招心流，圓桌紅線）。
7. **稀有閃光 boss（rareBoss）**：encounter 生成時機率 flag → boss 升異色 / 高 Grade（接 wave-2 Grade），捕獲報酬更香。
9. **幸運加碼（luckyBonus）**：純 reward modifier（本場勝利額外經驗 / 捕獲率提升）。

### Backlog（記下，暫不做）
- **10 暴擊潮**（與既有支援輪盤 crit 重疊）、**3 氣象疊加**（與地形突變概念重疊）、**4 狂暴化**（要追蹤持續 buff、違反避免複雜狀態）、**5 背水一戰**（像保底機制非野外意外）、**8 狙擊先制**（不可互動開場懲罰、體感比驚喜差）。

---

## 4. 資料 / 產生器變更

- `Region` 型別加 `mode`、`terrains?`、`randomTerrain?`（`types.ts`）。
- `scripts/gen_dex.mjs` 的 `REGION_THEMES` 各區加 `mode:'wild'` + `terrains`；新增 1–2 混合地形區 + 1 隨機地形區；重產 `regions.ts`。
- `practiceRegion.ts`（手寫）relabel 競技場、設 `mode:'arena'`、`terrains:['neutral']`。
- 新 `data/terrains.ts`（手寫非產生檔，如 practiceRegion）：`TERRAINS` 表 + `lookupTerrain`。
- `regionLookup` / `isPracticeRegion` → 改提供 `region.mode` 判斷（保留薄相容或直接改呼叫點）。

---

## 5. 架構落點 / 不變式相容

- **engine**：`resolveAttack` 加 `terrainMult`（type 相剋後乘；預設 1＝無地形，既有測試不動）。
- **reducer**：`resolveTurn(…, {rng, ext, terrain?})`——terrain 當前值（`currentTerrains` 解析出的 mult 來源）如 rng 般注入；reducer 不認識地形語意。wild-RandomEvent（intrusion/terrainShift）走既有隨機點 + `RandomEvent`。
- **BattleState**：加 `initialTerrains`/`currentTerrains`（暫態）。
- **setup 層**：encounter/battle setup 依 `region.mode` 決定 roll 什麼（terrains / wild-events / capture flag）。
- **持久化**：地形、意外、稀有 boss、幸運加碼**全不進 OwnedUnit**；捕獲到的稀有 boss 落地時，其異色/個體仍由既有 `captureUnit`（cardId seed）決定論產（稀有只是 encounter flag 提高遇到機率）。
- **效能紅線**：地形 UI 揭示/突變是低頻事件，走一般 state；無高頻值。

---

## 6. 開發切分（M7；可在 M6 之外獨立推進）

| 子里程碑 | 內容 | 核心工作 |
|----------|------|----------|
| **M7.0** | 模式 contract | `Region.mode` + gating 集中 setup + 捕獲改 `mode==='wild'` + 移除 isPracticeRegion 散落；練習場→競技場 relabel |
| **M7.a** | 地形效果 | `terrains.ts` + `TerrainDef`/`terrainMultiplier`(clamp) + engine `terrainMult` + BattleState initial/current + 開場 UI 揭示 + vitest（clamp/混合相乘） |
| **M7.b** | 更多/混合/隨機地形 | gen_dex `REGION_THEMES` 加 mode/terrains + 新混合區 + 隨機地形區（決定論抽）+ 重產 regions.ts |
| **M7.c** | 野外意外 ×5 | intrusion / terrainShift / supplyCache(開場·戰後) / rareBoss(encounter flag) / luckyBonus(reward)——走 RandomEvent + UI + wild-only gating |

每子步：純函數先 vitest → UI 接線 → Chrome CDP 實機 → 綠燈即 commit。

## 7. 待設計階段定 / 玩測平衡
- 各地形 mods 數值與每區指派、混合/隨機區的組合與地形池。
- 野外意外觸發頻率/權重（與既有 SUPPORT_EVERY 協調，避免一場太吵）。
- 稀有 boss 機率、幸運加碼幅度、天降補給選項池與出現時機（開場 vs 戰後）。
- arena 是否再加變體（不同等級帶競技場）。
