# 09 — 延伸系統設計（可模組化、可選式掛載）

> 來源：上網查證 20 個「類卡牌戰鬥遊戲特點」（roguelike deckbuilder / Mezastar 機台 / gacha RPG /
> TCG fusion·combo / 寶可夢本傳特性·場地·道具·進化）→ 三方圓桌（Claude/gemini/codex）收斂選 5。
> 原始結論：`.claude/agent-chat/session-20260623-090044/conclusion.md`。候選全表見本檔 §7。
>
> **總原則**：每個延伸系統都是**可選式掛載模組**——能整顆關掉、關掉後核心 loop（M1.x）零殘留、
> 不破壞兩大不變式：**①純 reducer 不含 UI/動畫字眼 ②只持久化 canonical OwnedUnit（roster）**。
> 本檔規劃排在 M2（QR/卡庫）之後，作為 **M6 延伸系統群**，彼此獨立、不互相阻塞。

---

## 0. 統一掛載機制（Module Mount）— 五個系統共用的地基

「可選式掛載」不是每個系統各自 if/else，而是核心定義固定的**擴充縫（seams）**，模組註冊到它要的縫；
**停用＝不註冊＝零殘留**。reducer 維持純函數——擴充能力如同 `rng` 一樣是**注入的純能力包**，不是 import 進來的依賴。

### 0.1 擴充縫（seams）一覽
| 縫 | 觸發位置 | 純度 | 誰用 |
|----|----------|------|------|
| **S1 `buildUnit`** | `stats.buildBattlePokemon` 算完能力值後 | 純函數 patch | 道具(statMod) |
| **S2 `preBattleModifiers`** | 戰鬥初始化 / 編隊變更（單次） | 純函數 `(team)→NamedModifier[]` | 羈絆 |
| **S3 `damageHook`** | `engine.resolveAttack` 傷害結算中段 | 純倍率函數 | 道具(damageHook) |
| **S4 `turnEndTrigger`** | reducer 回合末**同步**段 | 純 state→state | 道具(onceTrigger/剩飯) |
| **S5 `chainResolve`** | reducer `SUBMIT_CHAIN_RESULT` action | 純 state→state+events | 連鎖 |
| **S6 `postGrowth`** | `growth.applyExp` 升級後 | 純 unit→unit | 進化 |
| **S7 `gameMode`** | XState 流程（平行子狀態） | 流程層 | 連勝塔 |
| **S8 `saveSlice`** | persistence（獨立命名空間） | 序列化 | itemBag / runState / settings |

### 0.2 reducer 簽章演進（守純函數）
```ts
// 現況：resolveTurn(state, action, { rng })
// 擴充：第三參數加 ext（純能力包，從「已啟用模組」由非-reducer 的 assembler 組好再傳入）
resolveTurn(state, action, { rng, ext }): TurnResult
interface ExtBundle {                  // 全為純資料 / 純函數，停用模組就不在裡面
  damageHooks: DamageHook[]            // S3
  turnEndTriggers: TurnEndTrigger[]    // S4
  chain?: ChainRules                   // S5（undefined = 連鎖關閉）
}
```
- `ext` **預設 `{}`**：不傳＝行為與 M1.x 完全一致（既有 69 測試不需改）。
- reducer **不認識**「道具」「羈絆」字眼，只認識 `damageHooks`/`triggers`——保持與 UI/資料無關的純淨。
- 組裝 `ext` 的 `assembleExt(enabledModules)` 住在 `store/`（非 reducer），是唯一知道「哪些模組開著」的地方。

### 0.3 模組註冊表 + 設定
```ts
interface ExtensionModule {
  id: 'heldItems' | 'synergy' | 'chain' | 'evolution' | 'tower'
  enabled: boolean                     // 來自 settings save slice，預設可全關
  seams: Partial<Record<SeamId, unknown>>  // 只填它用到的縫
  ownsSaveSlices?: string[]            // S8：它獨佔的存檔命名空間
}
```
- **設定持久化**：`mz.settings.v1`（獨立 slice，與 roster 不同命名空間）。不違反「只存 canonical roster」——
  該不變式約束的是 **roster 序列化**永遠 canonical；模組自有 slice 是另一命名空間（圓桌 codex 認可的 module save slice）。
- **預設全部關閉**：新玩家＝純 M1.x 體驗；在設定頁逐一開啟。每個系統下方都標「停用行為」確保零殘留。

### 0.4 回合相位契約（turn-phase / KO-promotion contract）— M6.0 地基，先補 + tests
> 圓桌設計審查最重要產出：連鎖/道具/連勝塔都依賴一份明文的相位契約，否則各系統測試各寫各的假設。
> **此契約不寫死「玩家先手」**——一律走既有速度先後手 `playerActsFirst`。

```
A. 一個玩家回合 = 一個玩家動作「宣告」，互斥：
   - 攻擊型宣告：ATTACK（starStrike 是 ATTACK 的 mode，非獨立 action）/ SUBMIT_CHAIN_RESULT
   - 換人型宣告：SWITCH（獨立例外）
B. 攻擊型相位（吃速度，不寫死誰先）：
   依既有 playerActsFirst 排雙方先後 →
   先手 action 結算 → KO 檢查 / applyForcedSwitch → 後手 action 結算 → KO 檢查 / applyForcedSwitch
   - 連鎖一樣進此排序、**吃速度**：玩家較慢則敵方先打 active。連鎖不是 priority 特例。
   - 玩家較慢而 active 先被 KO → 照既有規則略過後手（連鎖發不出），不為連鎖開特例。
   - 連鎖/多 hit 命中「當前 active 敵」；該 active 倒下即截斷剩餘 hits（不轉移、不追擊）。
C. 換人型相位（既有規則不變）：
   SWITCH 先完成換上 → 防禦 QTE resolve → 敵方打換上的一次 → KO 檢查 / 強制換。
D. 收尾：雙方 action / QTE / 強制換**全部 resolve 後**，
   若 winner === null → 回合末 turnEndTrigger(S4，如剩飯) → turn+1 → **最後**才做 MAX_TURNS timeout 判定。
   （S4 在 timeout 前跑，剩飯等回合末 HP 變動才會納入 timeout 的剩餘血量比例。）
E. 延伸系統不得新增相位、不得在 action 內插入非同步等待；onceTrigger 一律走 S4 同步段；
   進入 S4 前所有 QTE 暫態與換人必須徹底 resolve。
```

M6.0 同時把既有 `starStrike` 從獨立 action 收斂成 `ATTACK` 的 mode，並補這份契約的 reducer 重構與測試。

---

## 1. 持有道具（Held Items）— 戰前養成

### 1.1 概念
每隻可裝一個被動道具，補「戰鬥前」深度。對應 Slay the Spire relics + 寶可夢 held item，但**效果嚴格限三類**（圓桌 codex 護欄，防效果失控）。

### 1.2 資料模型
```ts
// canonical：OwnedUnit 只加「一個參照欄」（仍只存 canonical）
interface OwnedUnit { /* …既有… */ heldItemId?: ItemId }

// 道具表：手寫非產生檔（如 practiceRegion），不抓 PokéAPI、icon 用 emoji/程序化，零侵權
interface ItemDef {
  id: ItemId; name: string; icon: string; desc: string
  kind: 'statMod' | 'damageHook' | 'onceTrigger'   // 只此三類
  params: Record<string, number>
}
```
- **背包庫存**（擁有數量）放**獨立 save slice** `mz.itembag.v1`：`Record<ItemId, number>`，**不塞進 OwnedUnit**。
- 三類效果：
  - `statMod`（S1）：建構 BattleUnit 時套能力值 patch（例：講究頭巾 Atk ×1.5、突擊背心 SpD ×1.5）。
  - `damageHook`（S3）：傷害結算中段乘倍率（例：達人帶 對剋制目標 ×1.2、命玉 ×1.3）。
  - `onceTrigger`（S4）：每場一次的同步反應（例：氣勢披帶 致命傷→保留 1HP 一次；剩飯每回合末回 HP/16=持續型 trigger）。

### 1.3 與不變式相容
- 中斷型效果（致命傷消耗道具回血）**全部收斂進傷害結算最後段一個同步 `applyItemTriggers`**（圓桌 gemini 護欄）：
  **禁止** async / callback / reducer 重入——所有 state 變更在該次 action 內同步算完。
- BattleUnit 帶 resolved item modifier + `itemConsumed` 旗標（戰鬥內暫態，**不持久化**）。

### 1.4 UI
- 隊伍/卡片詳情頁：裝備槽（從背包選），顯示 icon + 效果敘述。
- 戰鬥中：active 角色旁顯示道具 icon；onceTrigger 觸發時走 FxCanvas + banner。

### 1.5 可選掛載 — 停用行為
忽略 `heldItemId`、不組 S1/S3/S4 縫、不顯背包頁＝回到無道具的 M1.x 戰鬥。

---

## 2. 隊伍羈絆（Team Synergy）— 戰前組隊深度（最乾淨掛載）

### 2.1 概念
同屬性/同世代/屬性多樣等組隊條件給**可視化**全隊加成（AFK Arena faction synergy 精神）。圓桌公認**最乾淨**：純函數、零持久化、拔掉零殘留。

### 2.2 設計
```ts
interface SynergyRule {
  id: string; label: string; icon: string                 // 必帶可回顯（禁隱形加成）
  test: (team: BattleUnit[]) => boolean
  modifier: NamedModifier                                  // { label, source, icon, apply }
}
function computeSynergy(team: BattleUnit[]): NamedModifier[]  // 純函數
```
- 規則集（手寫資料，可平衡）：例
  - 「同屬性 ≥2 → 該屬性招式傷害 +15%」
  - 「隊伍涵蓋 ≥3 種屬性 → 全隊速度 +10%」
  - 「全隊同世代（dex 區段）→ 全隊 HP +8%」
- **只在「戰鬥初始化 / 編隊變更」單次呼叫**（圓桌 gemini 護欄），結果拍板成扁平靜態 `BattleModifiers` 注入戰鬥容器，**不每幀/每招重算**。
- 每個 modifier **必帶 `label/source/icon`**（圓桌 codex 護欄）供 UI 回顯。

### 2.3 與不變式相容
派生自當前 team，**完全不持久化**。掛 S2 縫，reducer 收到的是已拍板的 modifier 陣列，不認識「羈絆」。
- **重算時機（圓桌裁決）**：只在「出戰隊伍**組成**變更」時重算；戰鬥內**換 active 不算組成變更、不重算**——
  否則速度/HP 類 modifier 會在 mid-battle 重算，撞上「HP 跨換人持續、不自動回復」的不變式。

### 2.4 UI
選卡畫面：選滿隊即時顯示生效的 synergy tag（icon + label）；戰鬥開場 banner 列生效羈絆。

### 2.5 可選掛載 — 停用行為
`computeSynergy` 回傳 `[]`、不顯 tag＝無任何加成。

---

## 3. 連鎖攻擊（Chain Attack）— 戰中爽度（Mezastar 招牌）

### 3.1 概念
Mezastar 招牌：六角符號合一→按鈕，最多 3 隻連續攻擊。複用既有「連打蓄力 / 星擊能量」地基，最對味。

### 3.2 流程（嚴守 reducer 不重入）
1. **資格**：連鎖槽（由 QTE 表現 / 連續命中累積，沿用既有能量地基，**不綁隨機**）滿 → reducer 在回合結算時 emit `chainOpportunity` event。
2. **演出**：前端 XState/BattleScreen 接管，對最多 3 隻**未倒下**隊友依序跑連續 QTE、收集結果（高頻值走 ref/rAF，守效能紅線）。
3. **回提**：以**單一** action `SUBMIT_CHAIN_RESULT { hits: ChainHit[] }` 打回 reducer（圓桌 gemini/codex 護欄），reducer **同步**依序結算每隻對當前 active 敵的傷害、emit 多個 `damageApplied`。
```ts
interface ChainHit { attackerIndex: number; quality: number }   // 每隻自己的專屬招式
type BattleAction = /* …既有… */ | { type: 'SUBMIT_CHAIN_RESULT'; hits: ChainHit[] }
```
- **payload 只是「玩家宣告/輸入」（quality），不是權威傷害/命中結果**（圓桌 codex 最終防線）。

### 3.3 與不變式相容
- reducer 只負責「核發資格 + 結算提交結果」，**不跑 QTE 演出**（演出在 display 層）→ 杜絕 UI/reducer 脫節與重入。
- **reducer 重新驗證**（防「幽靈傷害」）：輪到玩家（可能後手）結算 chain 時，reducer 必須重查
  ①我方參與者是否仍存活合法 ②目標是否仍為同一個 enemy active（敵方可能先手 KO/強制換）——
  任一不符 → 整串 chain no-op 或截斷。**禁止**直接採信 UI 預算結果。
- 相位完全遵守 §0.4 契約：連鎖吃速度、active 敵倒下截斷剩餘 hits、不轉移目標、不為連鎖特例化 KO 反擊。
- 連鎖**不引入新招式**：每隻連鎖時用自己的單一專屬招（守 Mezastar 單招），倒下隊友不可連鎖。
- 連鎖槽 = 戰鬥內暫態，不持久化。

### 3.4 UI
六角連鎖槽（極簡，沿用星擊細條風格）；滿槽高亮可觸發；連續 QTE overlay；連段 FxCanvas + 連擊數字。

### 3.5 可選掛載 — 停用行為
`ext.chain = undefined`＝不累積連鎖槽、不 emit `chainOpportunity`、不顯六角槽＝回到單體攻擊。

---

## 4. 進化（Evolution）— 戰後成長回饋

### 4.1 概念
到等級觸發 → 種族變更、重算能力值，補「戰鬥後」最對味的養成回饋。

### 4.2 資料模型
```ts
// species 產生檔加兩欄（由 gen_dex.mjs 從 PokéAPI evolution-chain endpoint 產生）
interface Species { /* …既有… */ evolvesTo?: number; evolveLevel?: number }
```
- 觸發**以等級為主**（圓桌共識，最少互動成本）；道具/親密度觸發留 backlog。

### 4.3 流程（守個體欄位）
- `growth.applyExp` 升級後掛 **S6 `postGrowth`**：若 `level >= evolveLevel` 且有 `evolvesTo` → 改 `OwnedUnit.speciesId`，**個體欄位全保留**（IV/EXP/nature/seed/shiny/heldItemId 不變，圓桌 codex 護欄），用新 base stats 重算。
- **只替換 `species / base stats / artwork URL`**；招式維持單一專屬（守 Mezastar 單招，不因進化解鎖新招，避免招式系統爆炸）。

### 4.4 與不變式相容
只改 canonical `speciesId`（仍只存 canonical）。停用＝不掛 S6＝不檢查觸發。可選「取消進化」設定（如本傳按 B）。
- **連勝塔 run 內時機（圓桌裁決）**：run 中**不**於戰鬥途中 mutate roster；EXP 與進化**一律延到節點結算/run 結算**跑、
  **下一場才生效**。避免引入 run-scoped unit snapshot 而與「RunState 只參照 roster id、不複製 OwnedUnit」衝突。

### 4.5 UI
結算畫面進化演出（剪影→定格「XX 進化成 YY！」+ FxCanvas 光效 + audio）；可設定關閉演出/取消進化。

### 4.6 可選掛載 — 停用行為
不掛 S6＝升級永不進化＝純 M1.x 成長。

---

## 5. 連勝塔 / 遠征（Roguelike Run / Tower）— 長線重玩，串起全部

### 5.1 概念
Slay the Spire 式連續戰鬥不回血、節點分支、越深獎勵越大、有 boss、team wipe = run 結束。給 M1.x 欠缺的長線重玩，並讓道具/羈絆/連鎖/進化在 run 內都有舞台。

### 5.2 RunState（獨立容器，絕不回寫 roster）
```ts
interface RunState {                  // 獨立 save slice mz.run.v1，可中途續玩
  seed: string                        // 決定論產地圖
  floor: number
  path: NodeId[]                      // 已選節點
  partyUnitIds: string[]             // 參戰隊（參照 roster 的 id，不複製 OwnedUnit）
  runHp: Record<string, number>      // run 內各隻當前 HP（跨戰持續、不回滿）
  runModifiers: NamedModifier[]      // run 內暫時增益（relic-like，含 label/icon）
  pendingRewards: Reward[]
}
```
- 戰鬥載入：`OwnedUnit + runModifiers + runHp → BattleUnit` **合成**（圓桌 codex 護欄）；run 結束**只結算獎勵**（EXP/道具/捕獲寫回全域 roster），暫態（runHp/runModifiers）**即丟、絕不回寫 OwnedUnit**。
- **救回 backlog #12 跨場療傷**：以 run 內 overlay 呈現（營火回血、傷病跨戰持續），不污染全域 roster。

### 5.3 地圖 / 節點
- `generateRunMap(seed) → MapNode[]`：決定論（沿用 mulberry32），節點型別 `battle / elite / event / campfire / shop / boss`；分支選路、頂層 boss。
- 戰鬥節點隨層數遞增難度（沿用既有 encounter 等級帶）。

### 5.4 流程落點
- XState 加平行子模式 `tower`（與既有 region 流程並列，**S7 `gameMode`**）；RegionSelect 加「連勝塔」入口（如練習模式）。
- run 內戰鬥**完整複用**既有 BattleScreen + reducer（只是 BattleUnit 多套 runModifiers、HP 來自 runHp）。

### 5.5 與不變式相容
RunState 是**獨立命名空間**、純 run 容器，從不冒充 canonical roster；雲端同步（08）只同步 roster，RunState 暫不上雲（或日後另議）。停用＝入口隱藏、無 RunState slice。
- **防火牆不變式（圓桌明定）**：RunState 暫態（runHp/runModifiers）**絕不逆寫 OwnedUnit**；
  它只能在「節點結算 / run 結算」時把獎勵（EXP/道具/捕獲）核發寫回 roster。為支援中途續玩而持久化 runHp
  屬中斷點快照，不違反「不存 RNG/derived 中間態」——因為它從不被當成 canonical roster、且只單向核發獎勵。

### 5.6 可選掛載 — 停用行為
不掛 S7、入口隱藏＝遊戲只有既有區域模式。

### 5.7 二階（backlog #15）
難度修飾（Ascension / Fate run modifier）依附本塔成熟後再加——通關解鎖更高難度、開場負面增益，最安全的擴充點。

---

## 6. 資料流總圖（5 系統 × 縫）

```
戰前   buildBattlePokemon ──S1 道具statMod──┐
       computeSynergy(team) ──S2 羈絆───────┼─→ BattleUnit(+modifiers, runHp)
                                            │
戰中   resolveTurn(state, action, {rng, ext})
         ├ engine.resolveAttack ──S3 道具damageHook
         ├ 回合末 ──S4 道具onceTrigger/剩飯（同步 applyItemTriggers）
         └ SUBMIT_CHAIN_RESULT ──S5 連鎖（單一 action 回提）
戰後   growth.applyExp ──S6 進化（postGrowth，改 speciesId）
長線   XState tower ──S7（RunState 獨立容器，run 內串起以上全部）
存檔   roster(canonical OwnedUnit) │ itemBag │ runState │ settings  ──S8（各自命名空間）
```

---

## 7. 候選全表（20 個）與 backlog（記下，暫不做）

> 由 §0 機制，未選的也都能日後以同一套 seam 掛上，不需重構。

**選出（本檔 §1–5）**：1 持有道具、6 隊伍羈絆、5 連鎖攻擊、8 進化、13 連勝塔。

**Backlog 順位**（圓桌定）：
1. **11 圖鑑完成度 / 成就** — meta 層讀 roster（dex 1–251 天然長線）。連勝塔已先提供長線目標故降序。
2. **12 全域跨場療傷** — OwnedUnit 加 `currentHp/restingUntil`；其精神已由連勝塔 run 內 overlay 先行。
3. **15 難度修飾（Ascension）** — 依附連勝塔成熟後做（塔的二階）。
4. 其餘：2 特性、3 場地效果、4 狀態/關鍵字、7 隊長/覺醒、9 努力值 EV、10 星級/稀有 Grade、
   14 地圖節點（已併入連勝塔）、16 計時/王者連戰、17 每日任務、18 抽蛋孵化、19 幽靈對戰/排行（需網路）、
   20 協力對戰（需即時網路）。

完整 20 候選的描述/適配★/掛載點/持久化衝突評分，見圓桌種子 `scratchpad/ext-catalog.md`（摘要已併入本檔 §7 與 conclusion.md）。

---

## 8. 開發切分（M6 延伸系統群，排 M2 之後；彼此獨立不阻塞）

| 子里程碑 | 系統 | 依賴 | 核心工作 |
|----------|------|------|----------|
| **M6.0** | 掛載地基 + 相位契約 | — | `ExtensionModule`/seam 定義、`assembleExt`、settings slice、`resolveTurn` 第三參數加 `ext`（預設 `{}`，既有測試全綠）、**§0.4 回合相位契約落地（reducer 重構 + 測試，starStrike 收成 ATTACK mode、S4 在 timeout 前）** |
| **M6.a** | 6 隊伍羈絆 | M6.0 | `computeSynergy` 純函數 + 規則集 + S2 + 選卡 UI tag（最乾淨，先做驗證地基） |
| **M6.b** | 1 持有道具 | M6.0 | ItemDef 表 + itemBag slice + S1/S3/S4（含同步 applyItemTriggers）+ 裝備 UI |
| **M6.c** | 8 進化 | M6.0 | gen_dex 加 evolution-chain 欄 + S6 postGrowth + 結算進化演出 |
| **M6.d** | 5 連鎖攻擊 | M6.0 | 連鎖槽 + `chainOpportunity`/`SUBMIT_CHAIN_RESULT` + 連續 QTE overlay + FX |
| **M6.e** | 13 連勝塔 | M6.0,a–d | RunState slice + `generateRunMap` + XState tower 子模式 + 入口 + run 內合成載入 |

每子步：純函數先 vitest → UI 接線 → Chrome CDP 實機驗證 → 綠燈即 commit（沿用既有節奏）。

## 9. 待設計階段定 / 玩測平衡
- 道具池內容與數值、synergy 規則集與加成、進化等級門檻微調。
- 連鎖槽累積速率 / 觸發頻率、連鎖最多隻數（暫 3，貼 Mezastar）。
- 連勝塔節點權重 / 層數 / 獎勵曲線 / 營火回血量。
- settings 預設（全關 vs 預開某些）、模組間互動（如 run 內道具是 run-scoped 還永久）。
