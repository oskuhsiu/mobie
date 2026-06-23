# 10 — 延伸系統第二批設計（M6 wave-2，可模組化、可選式掛載）

> 接續 `09-extension-systems.md`（wave-1）。**掛載機制完全沿用 09 §0**（擴充縫 S1–S8、`resolveTurn(…,{rng,ext})`
> 注入純能力包、§0.4 回合相位契約、獨立 save slice + RunState 防火牆）——本批是該機制的**第二次驗證**：
> 幾乎不需新縫，只新增 2 個獨立 save slice 與 1 個 trigger timing。
> 來源：三方圓桌（Claude/gemini/codex）選 5 + 邊界定案 `.claude/agent-chat/session-20260623-094704/conclusion.md`。

## 0. 本批 5 個 + 與 wave-1 的關係
| # | 系統 | 定位 | 掛載點（沿用 09 §0） |
|---|------|------|---------------------|
| 2 | **特性 Abilities** | 戰鬥深度第二層（配道具） | S1/S3/S4（+onSwitchIn timing） |
| 10 | **星級 Grade** | 收集稀有感（純展示零 buff） | 純派生函數（無縫、UI helper） |
| 11 | **圖鑑/成就 Dex·Achievements** | 收集長線目標 | 新 meta slice（S8）+ 純讀函數 |
| 15 | **難度修飾 Ascension** | 連勝塔二階挑戰 | 複用 tower + ext runModifier 注入 |
| 18 | **抽蛋孵化 Incubator** | 收集養成閉環產出 | 新 incubator slice（S8）+ individual roll |

**互補不重疊（圓桌釘死的邊界）**：特性≠道具（內建固定 vs 可換外掛）；Grade≠IV 星級（稀有展示軸 vs 個體素質軸）；
Ascension≠塔本身（只加難度參數，不新增規則）；孵化的產出吃 Grade/圖鑑/塔三系統回饋形成閉環。

### 0.1 機制增補（相對 wave-1，經圓桌審查修正）
- **特性入場效果 `onSwitchIn`：不是 S4 新 timing**（圓桌 R1）。改為在「主動換人 / 強制換 / 開場放第一隻」的
  **換人解析步驟內立即同步結算**（chain-link 式）——「換人是原子操作」：換上當下狀態即刷新，下一行動者的
  S1/S3 讀到已更新狀態。S4 維持「回合末」純淨定義。**bounded / non-reentrant**（圓桌 codex）：
  onSwitchIn 效果**不得再觸發換人**（杜絕遞迴 / 同一單位多次 fire）。
- **新增 2 個獨立 save slice（S8）**：`mz.meta.v1`（圖鑑/成就/統計）、`mz.incubator.v1`（蛋）。與 roster 不同命名空間，不違反「只存 canonical OwnedUnit」。
- **Ascension 不開新縫，且拆兩條注入（圓桌 R5）**：靜態敵人強化（enemyHpMulti/enemyLevelBonus）在
  **encounter 生成 / buildUnit 階段 pre-bake 進敵人 base stats、不進 reducer**；只有真正影響回合演算的修飾
  （如 playerHealReduced 改 S4、開場 Fate debuff）才打包成 `runModifier` 經 `ext` 注入。reducer **永不認識「難度倍率」**。
- **Grade 不開縫**：純派生 UI helper，零持久化。

---

## 1. 特性（Abilities）— 戰鬥深度第二層

### 1.1 概念與邊界（圓桌 B1）
每種族一個**內建、固定、不可換**的被動特性（對比道具的可裝可換外掛槽）。配合 Mezastar 單招身分＝「種族識別」的一部分。
**效果池自製、不抄本傳特性名**（防侵權，自創如「銳擊／鐵壁／逆境／疾風入場」等）。

### 1.2 資料模型
```ts
// species 加一欄（產生檔指派，或手寫對照表）
interface Species { /* …既有… */ abilityId?: AbilityId }

// 特性表：手寫非產生檔，icon 用 emoji/程序化
interface AbilityDef {
  id: AbilityId; name: string; icon: string; desc: string
  kind: 'statMod' | 'damageHook' | 'onceTrigger' | 'onSwitchIn'   // 比道具多一類入場觸發
  params: Record<string, number>
}
```

### 1.3 掛載（沿用道具的縫）
- `statMod`→S1、`damageHook`→S3、`onceTrigger`→S4(回合末)、`onSwitchIn`→**換人解析步驟內同步結算**（見 §0.1，非 S4；bounded/non-reentrant，不可再觸發換人）。
- **「換上即倒」時 onSwitchIn 仍先 fire**（換上→onSwitchIn 結算→才輪對手打），符合本傳入場特性先觸發語意。
- **疊加規則（圓桌 B1 裁決）**：特性與道具**同類效果加法疊加，不做「同類不疊加」硬限制**——
  硬限制會讓 reducer 充滿「判斷效果來源」的特例髒碼、且扼殺單人 high-roll 構築樂趣。
  **平衡靠數值池上限**（每個 param 設計上限），不靠 reducer 攔截。
- reducer 仍只認 `damageHooks/turnEndTriggers/switchInTriggers`，不認「特性/道具」字眼（來源在 assembleExt 抹平）。

### 1.4 與不變式相容
species `abilityId` 是產生檔資料、非 canonical 個體欄；特性效果與道具同走暫態 modifier，不持久化。

### 1.5 UI
個體面板特性名 + icon + 敘述（與道具**分區顯示**，標明「內建特性 / 持有道具」兩來源）；戰鬥入場 onSwitchIn 觸發走 banner+FX。

### 1.6 可選掛載 — 停用行為
忽略 `abilityId`、不組特性的 S1/S3/S4 縫＝回到無特性戰鬥。（與道具各自獨立開關。）

---

## 2. 星級（Grade）— 收集稀有感（純展示零 buff）

### 2.1 概念與邊界（圓桌 B2）
貼 Mezastar Grade 1–6（Star=5、Superstar=6）的**稀有度展示徽章**。
**與既有 IV 星級嚴格分軸**：IV 星級＝個體素質（隱性實質戰力）；Grade＝稀有度展示。

### 2.2 設計（純派生、零 buff、零新欄）
```ts
function computeGrade(unit: OwnedUnit, species: Species): 1|2|3|4|5|6   // 純函數，不另存
// 只由「已存在 / 靜態」資料派生（圓桌 R2：不為 Grade 加 origin 欄）：
//   shiny + IV 總和 tier + species 靜態稀有度（如傳說/boss species 的靜態標記）。
//   例：shiny→至少 5；IV 總和最高 tier→+1；傳說 species + shiny + 滿 IV→6 Superstar。
```
- **不加 `origin` 欄**（圓桌 R2 裁決）：只用 shiny（已有）+ IV（已有）+ species 靜態稀有度（產生檔靜態資料），
  否則「純派生零新欄」是假的。**不為 Grade 動 OwnedUnit。**
- **完全零 buff**（圓桌 B2 裁決）：IV 已提供實質戰力，Grade 再加 buff＝double-dipping、語義不清。Grade 只做收集成就感。
- 零持久化（每次由 OwnedUnit + species 派生）。

### 2.3 UI
卡片/隊伍/遭遇/孵化結果顯示 Grade 徽章 + 高 Grade 專屬光效（FxCanvas）；圖鑑可按 Grade 篩選。

### 2.4 可選掛載 — 停用行為
不顯 Grade 徽章＝其餘體驗不變（因為零 buff，關掉對戰力零影響）。

---

## 3. 圖鑑 / 成就（Dex · Achievements）— 收集長線目標

### 3.1 概念
用既有全國 dex 1–251 當天然長線目標 + 成就解鎖。純 meta 層，**不碰戰鬥**。

### 3.2 資料模型（獨立 meta slice，三層語義避免雙真相）
> 圓桌 R3：09 的進化會改 `OwnedUnit.speciesId`，若 owned 純由 roster 派生，曾捕過的低階種在進化後會從圖鑑「已捕」**倒退**。故拆三層：
```ts
// 當前擁有：由 roster 即時派生（不存 meta），代表「現在隊上/庫裡有哪些種」
function currentlyOwnedSpecies(roster: OwnedUnit[]): Set<number>

// mz.meta.v1（獨立命名空間，與 roster 無關）
interface MetaState {
  registered: Set<number>      // 歷史登錄「曾捕獲」——單調遞增，進化不倒退（圖鑑「已捕」用這個）
  seen: Set<number>            // 看過但沒捕（roster 推不出，必存）
  stats: { captures: number; wins: number; towerClears: number; shinies: number; /* … */ }   // 累計量，roster 推不出
  achievements: Record<AchievementId, { unlockedAt?: number; claimedAt?: number }>
}
```
- 圖鑑三態＝`seen` / `registered`(歷史已捕) / `currentlyOwned`(當前擁有)，語義分離、**非雙真相**。
- meta 在 canonical 事件點（捕獲/勝利/塔通關）由 `metaStore` 更新——**獨立 store，不寫 roster**。

### 3.3 成就發獎（圓桌 B3 裁決）
- 成就**判定/領取狀態**存 meta；`computeAchievements(meta, roster)` 純函數產進度展示。
- **發獎走明確 action `claimAchievementReward(id)`** → 產 egg/incubator entry（**不在圖鑑讀取時自動寫入**）。
  → 11 維持純 meta 系統、18 是獨立經濟入口、副作用可測且可防重領。

### 3.4 與不變式相容
全程 meta 獨立 slice，不碰 roster canonical。停用＝不記 meta、不顯圖鑑/成就頁。

### 3.5 UI
圖鑑頁（1–251 grid，未見/已見/已捕三態 + Grade 篩選）；成就清單（進度條 + 可領取按鈕→ claim action）。

### 3.6 可選掛載 — 停用行為
不掛 metaStore、隱藏圖鑑/成就頁＝零殘留（不寫 meta slice）。

---

## 4. 難度修飾（Ascension）— 連勝塔二階挑戰

### 4.1 概念與邊界（圓桌 B5）
Slay the Spire Ascension：通關塔解鎖更高難度修飾（敵更強/開場負面 Fate）。**依附 wave-1 連勝塔**。

### 4.2 設計（拆兩條注入；只加參數 + meta 解鎖，不新增戰鬥規則）
- **拆兩條（圓桌 R5）**：
  - **靜態敵人強化**（`enemyHpMulti` / `enemyLevelBonus`）：在 **encounter 生成 / buildUnit 階段 pre-bake 進敵人 base stats**，
    **不進 reducer**。reducer 永不認識「難度倍率」。
  - **影響回合演算的修飾**（如 `playerHealReduced` 改 S4、開場 Fate debuff）：打包成 `runModifier` 經 `ext` 注入。
- **嚴守 §0.4 相位契約**：不新增專屬戰鬥規則、不新增相位（圓桌 B5）。
- meta 存解鎖階級（`ascensionUnlocked: number`）：通關 ascension N → 解鎖 N+1。

### 4.3 與不變式相容
難度＝參數注入（runModifier/ext），不污染 reducer 規則；解鎖階級存 meta slice（小量），不碰 roster。

### 4.4 UI
塔入口的 ascension 選擇器（已解鎖可選、未解鎖灰階）；run 內顯示生效的 Fate/修飾 tag（沿用 runModifier 的 label/icon）。

### 4.5 可選掛載 — 停用行為（依賴 tower）
不掛＝塔永遠普通難度、無 ascension 選擇器。tower 關閉時 Ascension 自動無意義（依賴隱含）。

---

## 5. 抽蛋孵化（Incubator）— 收集養成閉環產出

### 5.1 概念與邊界（圓桌 B4）
用遊玩進度換隨機新寶可夢（**非付費 gacha**），複用既有 `individual` 決定論 roll。與塔（進度來源）、Grade/圖鑑（收集目標）形成單人閉環。

### 5.2 資料模型（獨立 incubator slice + 防線）
```ts
// mz.incubator.v1（獨立命名空間）
interface Egg {
  id: string; seed: string                  // seed 決定孵出個體（沿用 individual roll）
  source: 'tower' | 'duplicate' | 'achievement'
  speciesPool: number[]                      // 可能孵出的 speciesId 池（依來源主題）
  progress: number; requiredProgress: number
}
```
- **防線寫死（圓桌 B4）**：egg 只存上述欄位；**孵化才生成 OwnedUnit**；
  **不可付費、不可刷新池、不可存預生成結果**（避免抽卡經濟化）。

### 5.3 來源與進度（圓桌 B4）
- **egg 來源**：①塔/遠征獎勵 + ③重複捕獲轉化（多餘同種→蛋）+ 少量成就首領取（B3 的 claim）。
- **孵化進度**：「**有效戰鬥完成數 + 塔層完成數**」加權（**不用**真實時間/每日簽到/步數，避免手遊體力感）。

#### 5.3.1 重複捕獲轉化 + pendingCaptures（圓桌 R4 + round-2 加固）
- **只在捕獲結算點處理「本次新捕獲候選」**，以 `meta.registered.has(speciesId)` 判定是否重複；
  給玩家明確 **keep（入庫）/ convert（轉成 egg）** 選擇（或可設定 overflow policy）。**絕不自動刪既有個體**，
  防吞掉想留的高 IV/shiny。
- **`pendingCaptures` 持久化 reward transaction（防資料遺失）**：捕獲候選一旦生成並進入 keep/convert UI，
  先以 `{ pendingCaptureId, resolvedCandidate(OwnedUnit 雛形), encounter/rewardId, choices }` **寫入 meta/save**；
  決策為 **exactly-once consume**，重啟只復原同一候選——**不可重抽 seed、不可重複領獎**。
  不違反 B4：此時**已過捕獲結算點**（不是 egg 建立時預塞 OwnedUnit）。

### 5.4 孵化
`hatchEgg(egg) → OwnedUnit`：progress ≥ required 時，從 speciesPool 依 seed 決定種類 + `individual` roll 個體 → 入 roster 存檔。

### 5.5 與不變式相容
incubator 是獨立 slice；孵化產出即 canonical OwnedUnit（一次性、決定論）。停用＝無 incubator slice、不產蛋。

### 5.6 UI
孵化頁（蛋列表 + 進度條 + 來源標籤）；孵化動畫（蛋裂→定格新寶可夢 + Grade 徽章 + FX）。

### 5.7 可選掛載 — 停用行為
不掛＝無孵化頁、不產蛋、重複捕獲不轉化（照常入庫或堆疊，依設定）。

---

## 6. 資料流 / save slice 總圖（wave-1 + wave-2）

```
戰前   buildBattlePokemon ─S1─ 道具statMod + 特性statMod          ┐
       computeSynergy(team) ─S2─ 羈絆                              ├→ BattleUnit
       computeGrade(unit,species) ─(純派生 UI)─ 稀有徽章           │   (+modifiers, runHp, runModifiers)
       ascension：敵強化 pre-bake 進 encounter/buildUnit；          │
                  回合修飾(Fate/healReduced) ─ext─ reducer          │
戰中   resolveTurn(state, action, {rng, ext})  （守 §0.4 相位契約）
         ├ resolveAttack ─S3─ 道具/特性 damageHook
         ├ 觸發 ─S4(when:turnEnd)─ 道具/特性 onceTrigger（同步）
         ├ 換上 ─S4(when:onSwitchIn)─ 特性入場觸發（同步，新 timing）
         └ SUBMIT_CHAIN_RESULT ─S5─ 連鎖
戰後   growth.applyExp ─S6─ 進化
長線   XState tower ─S7─（RunState；Ascension 注入難度）
收集   metaStore（圖鑑/成就/統計）→ claimAchievementReward → incubator
       hatchEgg(seed) → OwnedUnit（individual roll）
存檔   roster(canonical) │ itemBag │ runState │ settings │ meta │ incubator   ─S8（各自命名空間）
```

---

## 7. 開發切分（M6 wave-2，疊在 wave-1 之後；彼此獨立）

| 子里程碑 | 系統 | 依賴 | 核心工作 |
|----------|------|------|----------|
| **M6.f** | 10 星級 Grade | M6.0 | `computeGrade` 純函數 + 徽章 UI + 高 Grade 光效（最乾淨，先做） |
| **M6.g** | 2 特性 | M6.0,b | species `abilityId` + `AbilityDef` 表 + S1/S3/S4(+onSwitchIn timing) + 疊加(數值池上限) + 個體面板分區 UI |
| **M6.h** | 11 圖鑑/成就 | M6.0 | `mz.meta.v1` + `metaStore`（事件點更新）+ `computeAchievements` + `claimAchievementReward` action + 圖鑑/成就頁 |
| **M6.i** | 18 抽蛋孵化 | M6.0,e,h | `mz.incubator.v1` + egg 來源(塔/重複/成就) + **捕獲結算 keep/convert + `pendingCaptures` 持久 transaction(exactly-once)** + 進度權重 + `hatchEgg`(individual roll) + 孵化頁/動畫 |
| **M6.j** | 15 Ascension | M6.0,e | tower ascension 選擇器 + `runModifier` 難度池 + ext 注入 + meta 解鎖階級 |

每子步：純函數先 vitest → UI 接線 → Chrome CDP 實機 → 綠燈即 commit（沿用既有節奏）。

## 8. 待設計階段定 / 玩測平衡
- 特性效果池內容與**數值上限**（控疊加平衡）、特性與道具的 UI 區分呈現。
- Grade 階級門檻（shiny/IV tier/來源 → 1–6 的對應）。
- 成就清單、發獎曲線、egg 來源權重與各 speciesPool 主題。
- 孵化進度權重（戰鬥數 vs 塔層數）、重複捕獲轉化門檻。
- Ascension 各階修飾組合與解鎖門檻。

## 9. Backlog 更新（記下，暫不做）
12 全域跨場療傷（改做塔/遠征**局內 modifier** 而非全域 OwnedUnit 狀態）、3 場地效果、4 狀態/關鍵字、
7 隊長/覺醒、9 努力值 EV、16 計時/王者連戰、17 每日任務、19 幽靈對戰/排行（需網路）、20 協力對戰（需即時網路）。
