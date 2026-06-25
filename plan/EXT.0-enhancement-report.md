# EXT.0 — mobie 強化報告（遊戲性 / 視覺 / 操作性）

> **本檔是 EXT 系列的總覽與真相來源。** 子計劃 `EXT.1`–`EXT.5` 只引用本檔的分層與紅線，不重抄。
> 來源：使用者要求「精研現況，找出能增強遊戲性、強化視覺與操作性的項目；先表列，再四方 agent-chat 深度討論」。
> 四方圓桌（Claude / gemini / codex / mistral）round-robin **2 輪全體 agree、無未解分歧**，
> 結論全文：`.claude/agent-chat/session-20260625-092816/conclusion.md`。
>
> **一句話**：在 M0–M22 已完成的基礎上，**先把「戰鬥局內的即時爽感」打磨到極致**（純 display、零碰 reducer、最快見效），
> 再做唯一需要動核心的 **狀態異常**（嚴格 module 化、預設 off 零殘留），最後補 **養成 meta 循環**（貨幣/商店/任務）。

---

## 0. 現況盤點（程式碼實查，非臆測）

| 面向 | 已有 | 事實缺口 |
|---|---|---|
| 戰鬥深度 | 多招式(≤4)＋星擊 finisher、相剋/會心/速度、地形 fieldState、延伸模組(synergy/items/abilities/chain/combo/evolution)、連鎖、對手 profile | **無狀態異常系統**（`FieldState.StatusEffect` 只是 M19.d 能力值增益，非中毒/灼傷/麻痺/睡眠/冰凍）；**無招式 PP** |
| 長線循環 | EXP/成長、捕獲、孵化、圖鑑、成就、連勝塔 | **無貨幣 / 商店 / sink**（贏戰只給 EXP）；**無任務 / 每日目標** |
| 視覺 | screen-shake(`rootShake`)＋`fxRef.flash`＋per-type FX(`fxCatalog`)＋FxCanvas(`burst/ring/flash/travel`)＋R3F 3D 場景 | **無浮動傷害數字**、**無「效果絕佳」橫幅**、**無 hit-stop 頓格**；**地形/天氣只是資料，畫面零反映**；billboard sprite 靜止；4 個置中 overlay 仍用 translate 漂移 |
| 操作 | TimingBar / MashMeter / 手勢層(swipe/circle/hold/rhythm) | **無觸覺回饋(Vibration)**；**無首玩引導**；大量中文字（幼兒不識字）；無慣用手/誤觸保護 |

> 關鍵：`damageApplied` event **已攜帶** `amount / crit / effectiveness / effectivenessText / hpBefore / hpAfter / maxHp / resolvedMoveId`
> ——所以「傷害數字＋效果絕佳＋會心強調」**完全不需動 reducer**，純 display 消費既有事件即可。

---

## 1. 13 項清單三維評估（價值 × 成本 × 對不變式風險）

> 價值＝對「iPad 兒童」即時體驗的貢獻；成本＝工程量；風險＝對 pure reducer / 效能紅線 / 零殘留 / 無侵權資產的衝擊。

### A 遊戲性
| # | 項目 | 價值 | 成本 | 風險 | 裁決 |
|---|---|---|---|---|---|
| A1 | 狀態異常（中毒/灼傷/麻痺/睡眠/冰凍） | 高（戰術深度） | 中 | ⚠️ **唯一動 reducer/engine**——須 module 化守純度 | **做（EXT.4）** |
| A2 | 貨幣與商店循環 | 中（養成 meta） | 中 | 低（純加法、牽涉持久化/經濟平衡） | **後段（EXT.5）** |
| A3 | 任務/每日目標 | 中（session 間拉力） | 低-中 | 低 | **後段（EXT.5，與 A2 綁）** |
| A4 | 頭目多階段戰 | 中（成就感/氛圍） | 低 | 低（走 encounterProfile，不開 boss reducer 分支） | **不獨立，A1 rider（EXT.4）** |
| A5 | 招式 PP / 戰術資源 | 低（兒童負擔） | 中 | ⚠️ 動 reducer＋污染招式資料/UI | **否決** |

### B 視覺
| # | 項目 | 價值 | 成本 | 風險 | 裁決 |
|---|---|---|---|---|---|
| B1 | 打擊感（傷害數字＋效果絕佳＋會心＋hit-stop 頓格） | **極高** | 低 | 無（純 display，事件已備） | **必做（EXT.1）** |
| B2 | 星擊電影化（letterbox/慢動作/運鏡/cut-in） | 高（情緒峰值） | 中 | 無（純 display，消費 cast 攔截 seam） | **緊接（EXT.2）** |
| B3 | 地形/天氣視覺化 | 中 | 中 | 無（R3F 讀 region/fieldState） | **續做（EXT.3）** |
| B4 | Sprite 動態＋轉場＋修 4 置中 overlay | 中-高 | 低 | 無（純 display；overlay 改 flex 置中） | **必做（EXT.1）** |

### C 操作性
| # | 項目 | 價值 | 成本 | 風險 | 裁決 |
|---|---|---|---|---|---|
| C1 | 觸覺回饋 Haptics（Vibration API） | **極高（juice/effort 最高）** | 極低 | 無（display 薄封裝＋prefs 開關） | **必做（EXT.1）** |
| C2 | 兒童引導/教學 | 中 | 低 | 無 | **降級：複用 B1 UI 的脈衝提示（EXT.1）** |
| C3 | 無障礙/非讀者友善（圖示/音效優先） | 高（受眾是幼兒） | 低 | 無 | **揉進 B1 驗收準則（EXT.1）** |
| C4 | 操作人因（慣用手/誤觸確認） | 中 | 低 | 無 | **誤觸確認併 EXT.1；慣用手列 backlog** |

---

## 2. 優先級分層（最終定案）

1. **必做・最快見效（純 display，零碰 reducer）→ EXT.1**
   B1 打擊感 ＋ C1 Haptics ＋ C3 圖示/音效 ＋ B4 Sprite/轉場/修 overlay ＋ C2 脈衝引導 ＋ **鋪 `cinematicCoordinator` seam**（供 EXT.2 接）。
2. **緊接交付（消費 EXT.1 的 seam）→ EXT.2**　B2 星擊電影化。
3. **視覺續做 → EXT.3**　B3 地形/天氣視覺化。
4. **唯一動核心（嚴格 module 化）→ EXT.4**　A1 狀態異常 `modules.statusAilments`（預設 off）＋ A4 頭目階段 rider。
5. **養成 meta（後段，牽涉持久化/經濟）→ EXT.5**　A2 貨幣＋商店 ＋ A3 任務/每日。
6. **否決**　A5 招式 PP。

**取捨理由**：5 歲兒童延遲滿足能力弱，「當下即時回饋」＞「外圍養成」→ 先把局內爽感做滿（B/C 軸）。
A1 雖最具戰術深度但唯一要動核心，故嚴格 module 化、墊到視覺梯之後。B2 工序大於 B1，採「**架構同梯、交付分梯**」：
EXT.1 就鋪 `cinematicCoordinator`（`pauseBattle/resumeBattle`、支援疊層 hit-stop＋慢鏡），避免 EXT.2 重構。

---

## 3. 全程紅線（每份 EXT 子計劃都必須遵守）

1. **display-only 項不得寫 battle state**；hit-stop ＝ presentation clock pause，**不改戰鬥時間線**；只 consume event/selector，不新增 reducer side-effect。
2. **A1 只能 `modules.statusAilments` off-by-default、零殘留**：off 時 reducer case 完全跳過（`if (!enabled) return state`）、關閉時清空狀態態；**不持久化任何衍生/RNG/狀態**；所有 tick/傷害/恢復由 deterministic turn phase（沿用 S4 `turnEndTrigger` 風格）發 event。
3. **資產責任**：新增特效一律原創/procedural（CSS/Canvas/Tone.js）；美術仍只走 PokéAPI runtime URL；3D 模型 user drop-in；**generated files（species/moves/regions/playerCards）不手改**——要改改 `scripts/gen_dex.mjs`。
4. **效能紅線**：高頻值（傷害數字座標、頓格時鐘、運鏡進度、震動排程）走 ref/rAF/DOM/Zustand，**絕不進 React 頂層 state**——比照 `TimingBar`/`MashMeter`/`FxCanvas`。
5. **modules vs prefs 不混**：戰鬥規則語意（A1）住 `modules`（註冊 seam）；UX 偏好（Haptics/教學/慣用手）住 `prefs`。

---

## 4. EXT 系列地圖與依賴

```
EXT.0 (本報告)
  ├─ EXT.1 局內爽感  [B1+C1+C3+B4+C2+cinematicCoordinator seam]  ← 先做，無依賴
  │     └─ EXT.2 星擊電影化 [B2]            ← 依賴 EXT.1 的 seam
  ├─ EXT.3 地形/天氣視覺化 [B3]             ← 無依賴（可與 EXT.2 並行）
  ├─ EXT.4 狀態異常 module [A1 + A4 rider]  ← 無硬依賴；建議 EXT.1 後做
  └─ EXT.5 養成 meta loop [A2 貨幣商店 + A3 任務每日]  ← 後段
```

| 子計劃 | 標題 | 軸 | 落點層 | 歸屬 |
|---|---|---|---|---|
| `EXT.1` | 局內爽感（打擊感＋Haptics＋Sprite＋引導） | B/C | display | prefs（`juice`/`haptics`） |
| `EXT.2` | 星擊電影化 | B | display | 消費 EXT.1 seam |
| `EXT.3` | 地形/天氣視覺化 | B | R3F display | 讀 region/fieldState |
| `EXT.4` | 狀態異常 module（＋頭目階段） | A | reducer module | `modules.statusAilments` |
| `EXT.5` | 養成 meta loop（貨幣/商店/任務） | A | store slice＋UI | 新 slice（仿 bagStore） |

> **每里程碑都可玩、預設零殘留**——延續專案設計哲學。各子計劃內自切 `.a/.b/.c` 小階段，逐步綠燈 commit。
