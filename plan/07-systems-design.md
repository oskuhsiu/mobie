# 07 — 意外機制 + 個體差異/成長性 設計

> 來源：agent-chat 三方共識（`.claude/agent-chat/session-20260622-163656/conclusion.md`）＋
> 查證 Mezastar 機台與本傳機制（`plan/06-battle-reference.md`）。
> 原則：取 Mezastar 招牌、貼既有 QTE+純reducer 架構、不引入侵權資產、有趣但不臃腫。

---

## A. Mezastar 機台機制（查證摘要）
- **攻擊輪盤**：依寶可夢 Grade 顯示 5–50 的數值，按鈕停下決定基礎攻擊力。
- **連打蓄力**：停下後狂按 1/2 鈕衝高攻擊力，色階 red→blue→yellow→purple→rainbow。
- **支援輪盤**：累積後出現，含「攻擊UP 箭頭」格與「支援寶可夢」格（召喚待命夥伴先補一刀）。
- **Z/Dynamax/Terastal Chance**：輪盤/限時挑戰觸發大招 finisher。
- **連鎖攻擊 Chance**：六角形符號合一時按鈕，最多 3 隻連續攻擊。
- **捕獲球輪盤**：精靈/超級/高級/大師球輪盤旋轉，球種 + Get Gauge + Grade 決定捕獲率。
- **Grade/星級**：1–5 星，Grade 5 = Star 寶可夢。

## B. 本作採用（意外機制定案）
> 砍掉**畏縮**與完整異常狀態（硬控場在快節奏街機=挫折感，且讓 reducer 複雜化）。保留**命中 + 會心(1/16, ×1.5)**。

1. **攻擊 QTE = 攻擊輪盤 + 連打蓄力合一**
   - 現有 timing bar 決定基礎倍率 → 停下接一段**極短連打蓄力**色階加成(red→rainbow)。
   - 兩段都走 `qualityFromPointer` / 連打計數 → 最終 QTE 倍率。
2. **支援輪盤（隨機意外核心）**
   - 每隔 N 回合觸發（N 待玩測）。隨機獎項：`攻擊UP` / `必定會心` / `支援寶可夢補刀`（隊上待命的一隻打一下）/ `摃龜`。
3. **捕獲球輪盤**
   - 捕獲時轉球種（精靈/超級/高級）→ 對 `captureChance` 套不同係數（取代固定捕獲率）。
4. **星擊 Finisher（M1.5h，延後）**
   - 能量槽**只由 QTE 表現 + 連鎖累積、不綁隨機**（保留玩家可控感，非抽獎）。
   - 槽做極簡細條避免 UI 臃腫；滿了放自製大招「**星擊**」（無侵權，取代 Z/Dynamax/Terastal）。

### 隨機事件統一格式（測試 + 戰鬥 log 共用）
所有隨機點（命中/會心/支援輪盤/球輪盤/IV·性格 roll）由 reducer 注入的 rng 決定，並記成統一 domain event：
```ts
interface RandomEvent {
  type: 'accuracy' | 'crit' | 'supportRoulette' | 'ballRoulette' | 'ivNatureRoll'
  actorId: string
  roll: number       // 原始亂數
  outcome: string    // 結果（hit/miss、critYes、attackUp…）
  source: string     // 觸發來源
}
```

---

## C. 個體差異 / 成長性（定案）
### 個體差異（M1.5e）
- 每隻（自有/野生）以 **seed** 決定論產生：
  - 自有 = `cardId`；野生 = 遭遇 seed。
  - roll **IV(0–31/項) + 性格(25 種, ±10%)**，併入能力值公式（IV 管線 + nature 乘數）。**EV 不做**。
- UI：**星級 IV(1–5 星 / 評價字)** + 性格名 + 能力值**紅(加)藍(減)色標** + 異色；0–31 細節放長按/debug。
  - 星級門檻：IV 總和(0–186) → 1–5 星（門檻待定）。

### 成長（M1.5f）
- 勝利得 **EXP**（依被擊敗者等級，公式參數待定）。
- 統一 **Medium Fast `n^3`** 升級曲線 → 升級重算能力值（IV/性格不變）。

---

## D. 資料模型 / 持久化
```ts
// canonical，持久化（只存這個！）
interface OwnedUnit {
  id: string            // 實例 id
  speciesId: number
  level: number
  exp: number
  ivs: Stats            // 0–31 / 項
  nature: NatureId
  seed: string
  shiny: boolean
}

// 派生，不持久化（每場戰鬥由 OwnedUnit 算出）
interface BattleUnit {
  // 最終 stats（含 IV/nature/level）
  // + 暫時 modifier（支援UP、會心保證等，僅該場有效）
}
```
- **PersistenceAdapter 介面**：現在用 **localStorage 墊檔**（只存 canonical OwnedUnit roster + exp），M2 無痛換 **Dexie/IndexedDB**。
- **護欄（codex）**：Adapter **只存 canonical OwnedUnit**，不存 derived stats / battle modifiers / 輪盤結果 / RNG 中間態 → 保持 Dexie 遷移與重播測試乾淨。

```ts
interface PersistenceAdapter {
  loadRoster(): Promise<OwnedUnit[]>
  saveUnit(u: OwnedUnit): Promise<void>
  // M1.5f: localStorage 實作；M2: Dexie 實作
}
```

---

## E. 架構影響
- `stats.ts`：補 nature 乘數 + seeded IV/nature roll（seededRng）。
- 新 `growth.ts`：`n^3` 曲線、`gainExp`、`levelUp`、重算 stats。
- 新 `individual.ts`：seed → {ivs, nature, shiny}（決定論）。
- `reducer.ts`：在隨機點輸出統一 `RandomEvent`；支援輪盤/球輪盤併入回合解算。
- 新 `persistence/`：`PersistenceAdapter` + `LocalStorageAdapter`。
- UI：個體面板（星級/紅藍色標）、支援輪盤 overlay、球輪盤、星擊極簡槽（h）。

## F. 開發切分（疊在 M1.5a–d 之後）
- **M1.5e 個體差異**：seeded IV/性格 + nature 公式 + 個體 UI。
- **M1.5f 成長**：EXP/升級(n^3) + PersistenceAdapter(localStorage) + roster 持久化。
- **M1.5g 意外**：支援輪盤 + 球輪盤 + 連打蓄力（reducer 隨機點 + 統一 event + UI）。
- **M1.5h 星擊**：QTE/連鎖累積能量槽 + 大招演出（延後）。

## G. 待定參數（玩測平衡）
- 支援輪盤觸發頻率 N、各獎項權重。
- 星級 IV 分級門檻（IV 總和 → 1–5 星）。
- EXP 取得量公式（依被擊敗者等級）。
- 球種對捕獲率的係數。
