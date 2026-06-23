# 13 — 內容補完路線圖（寶可夢補完 + 地形擴充，階段性推出）

> 使用者要求：①寶可夢補完計劃（到維基/PokéAPI 抓資料、圖片找清晰來源）②地形再增加 ③地形與寶可夢**階段性推出**。
> 本檔是**內容 roadmap**（資料/數量/分階段），與引擎無關——技能引擎（`12-battle-skill-module.md` / M8）依圓桌定「縱向先打穿地基、再橫向鋪內容」，
> 故本 roadmap 的內容批次在 M8 引擎驗收後逐階段上。守硬約束：**不內建/不抓取/不散布侵權資產**（資料 PokéAPI、圖走官方 artwork runtime URL）。

---

## 1. 寶可夢補完（Dex Completion）

### 1.1 現況與目標
- **現況**：全國 dex **1–251（G1–G2）**，由 `scripts/gen_dex.mjs` 從 PokéAPI 一次性產生 `data/{species,moves,regions,playerCards}.ts`（產生檔，勿手改）。
- **目標**：分階段補完到 **G1–G9 共 1025**。各世代新增數：G3 +135、G4 +107、G5 +156、G6 +72、G7 +88、G8 +96、G9 +120。

### 1.2 資料與圖片來源（守不內建侵權資產）
- **資料**：PokéAPI（zh-Hant 名 / 屬性 / 種族值 / 進化鏈），沿用 `gen_dex.mjs` 既有 client（快取、並發、重試）。
- **圖片（清晰來源）**：PokéAPI 的 **official-artwork**（`sprites.other['official-artwork'].front_default`，高解析、最清晰）為主，
  `home` render 為備；**runtime URL 載入、不落地、不入庫**（沿用既有 billboard fallback 與 skeleton）。異色用 official-artwork 的 shiny 變體 URL。
- 3D 造型仍維持「使用者本機 drop-in GLB」（`public/models/` gitignored），補完只擴 2D artwork URL 與資料。

### 1.3 分階段（每階段重產 regions/playerCards、擴 encounter 帶新世代）
| 階段 | 新增世代 | dex 範圍 | 配套 |
|------|----------|----------|------|
| **內容階段 1** | G3 | 252–386 | 新增 2–3 個 G3 主題野外區、起始 roster 可選擴充 |
| **內容階段 2** | G4–G5 | 387–649 | 新增主題區、補進化鏈（接 plan/09 進化）、孵化 speciesPool 擴充（接 plan/10） |
| **內容階段 3** | G6–G9 | 650–1025 | 補完；稀有/傳說 boss 池擴充、Grade 稀有判定資料（接 plan/10 Grade） |

### 1.4 產生器工作（每階段）
- `gen_dex.mjs`：擴 dex 抓取範圍 + 新 `REGION_THEMES`（含 plan/11 的 `mode`/`terrains`）；`node scripts/gen_dex.mjs` 重產。
- 與既有系統對齊：進化鏈欄（plan/09 §4）、孵化 speciesPool（plan/10 §5）、Grade species 靜態稀有度（plan/10 §2）。
- **效能**：artwork 全 runtime lazy；dex 變大注意 `species.ts` 體積（必要時分檔/按需載入，留意 bundle）。

---

## 2. 地形擴充（接 `11-terrain-modes-accidents.md`）

> 使用者：「去寶可夢維基把地形都抄一抄。」依本傳 **天氣（weather）+ 場地（terrain）+ 環境（Nature Power 場所）** 整理成我們的地形池，
> 全部走 plan/11 的 `TerrainDef.mods`（type→攻擊 power 倍率，每屬性夾 [0.5,1.5]）。數值為示意、待玩測平衡。分階段上。

### 2.1 地形階段 A — 區域主題地形（已在 plan/11，現況 8 區 + 中性）
grassland 草原 / volcanic 熔岩 / coastal 水濱 / stormfield 雷原 / cavern 岩窟 / haunt 幽域 / mystic 靈域 / dragons-peak 龍峰 / neutral 中性（competition）。

### 2.2 地形階段 B — 天氣型地形（本傳 weather）
| id | 名 | mods（示意） | 本傳依據 |
|----|----|--------------|----------|
| sunny 晴天 | ☀️ | fire1.5 water0.6 | 晴：火↑水↓ |
| rain 雨天 | 🌧️ | water1.5 fire0.6 electric1.1 | 雨：水↑火↓ |
| sandstorm 沙暴 | 🏜️ | rock1.3 ground1.2 steel1.1 water0.85 fire0.9 | 沙暴：岩/地/鋼利 |
| snow 雪／冰雹 | ❄️ | ice1.4 water1.1 fire0.6 grass0.85 | 冰雹/雪：冰↑ |
| fog 濃霧 | 🌫️ | ghost1.2 dark1.2 （整體略降命中→改以小幅 power 降表現）normal0.9 | 霧：朦朧 |
| strong-winds 強風 | 🌪️ | flying1.3 dragon1.1 ground0.8 | 強風：飛行域 |

### 2.3 地形階段 C — 場地／特殊型地形（本傳 terrain + 環境）
| id | 名 | mods（示意） | 本傳依據 |
|----|----|--------------|----------|
| grassy-field 草地場 | 🌱 | grass1.3 ground0.85 | 草地場地 grass↑（+每回合微回，可選） |
| electric-field 電氣場 | ⚡ | electric1.3 | 電氣場地 electric↑ |
| psychic-field 精神場 | 🔮 | psychic1.3 | 精神場地 psychic↑ |
| misty-field 薄霧場 | 🌸 | fairy1.3 dragon0.5 | 薄霧場地：龍傷半、妖精域 |
| flowerfield 花海 | 🌼 | fairy1.3 grass1.2 bug1.1 poison0.85 | 花原（混合） |
| swamp 沼澤 | 🪻 | ground1.2 water1.2 poison1.1 fire0.8 flying0.85 | 濕沼（合體技施放亦可生成） |
| steam 蒸氣 | ♨️ | fire1.2 water1.2 ice0.8 | 水火合體灌注（接 plan/12 合體技） |
| holy-ground 聖域 | ✨ | psychic1.2 fairy1.2 dark0.7 ghost0.8 | 神聖領域（特殊） |

- **混合地形**（plan/11）：任兩個 terrain 逐屬性相乘 + 每屬性夾 [0.5,1.5]。
- **隨機地形區**：從上述池決定論抽（plan/11 §1.3）。
- **合體技灌注**：plan/12 §4.2 的 `infuseTerrain` 直接灌注階段 B/C 的地形數回合。

### 2.4 地形分階段（與寶可夢階段同步上）
| 階段 | 新增地形 |
|------|----------|
| **內容階段 1** | 地形階段 B（天氣型 6 種）+ 對應新區指派 |
| **內容階段 2** | 地形階段 C 前半（場地型 4 種：草地/電氣/精神/薄霧）+ 混合地形區 |
| **內容階段 3** | 地形階段 C 後半（花海/沼澤/蒸氣/聖域）+ 隨機地形區 + 合體技灌注 |

---

## 3. 推出節奏總表（內容 horizontally，引擎先 vertically）
> 引擎地基（M6 延伸系統 / M7 地形·模式 / M8 技能模組）**先各自縱向做完**；本 roadmap 是內容批次，鋪在引擎之上。

| 階段 | 寶可夢 | 地形 | 對齊引擎能力 |
|------|--------|------|--------------|
| 1 | G3（252–386） | 天氣型地形 | M7 地形 + M8.0/a 技能地基 |
| 2 | G4–G5（387–649） | 場地型 + 混合區 | M8.b/c 訓練·繼承 + plan/09 進化/10 孵化擴池 |
| 3 | G6–G9（650–1025） | 特殊型 + 隨機區 | M8.d/e 合體技·對手 profile + plan/10 Grade 稀有 |

## 4. 待定 / 注意
- dex 變大的 bundle / 載入策略（分檔、按需）。
- 各世代 artwork URL 可用性抽查（PokéAPI 缺圖時 skeleton fallback）。
- 地形數值平衡（玩測）、每區地形指派、隨機地形池組成。
- zh-Hant 名稱在 PokéAPI 的覆蓋率（缺名 fallback 英/日或編號）。
