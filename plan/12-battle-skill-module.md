# 12 — 戰鬥技能大模組（M8 Battle Skill Module）

> 三方圓桌（Claude/gemini/codex）收斂，結論 `.claude/agent-chat/session-20260623-104127/conclusion.md`。
> 涵蓋：**技能 訓練/學習/繼承 + 合體技(含施放效果) + 對手技能多樣性**。
> 本檔是「單招約束總控」：相關機制散在多份 plan，這裡統一引用回 **09 連鎖 / 10 孵化·特性 / 11 地形**。
> **硬約束守住**：CLAUDE.md「每隻寶可夢單一專屬招式（Mezastar 風）」**不放寬**——專屬 QTE 大招維持單一＝身分；
> 「技能」是**非傷害的主動戰術輔助層**，不是新招式。掛載沿用 M6 §0 的 S1–S8 縫 + `ext` 注入 + §0.4 相位契約。

---

## 0. 一句話定位
- **專屬招**（QTE 大招）＝唯一直接攻擊、寶可夢身分（不變）。
- **技能（Skill）**＝戰前 loadout(1–2 槽) + 戰中**條件自動觸發**的輔助層（buff/debuff/地形/條件改寫，**不可直接大傷害**）。
- **合體技（Combo）**＝連鎖系統的特殊 Combo 變體（兩隻合成一發大招 + 施放效果）。直接傷害只存在於「專屬招 + 合體技/星擊 finisher 家族」。
- **對手多樣性**＝Encounter Skill Profile（單招 + 技能標籤的純反射 hook；AI 仍只會 ATTACK）。

---

## 1. 技能（Skill）— 主動戰術輔助層

### 1.1 護欄（圓桌核心）
- **不可造成直接大傷害**：效果只能是狀態/倍率/地形/條件改寫/小回復。直接傷害保留給專屬招 + 合體技/finisher。
- **不新增玩家 action、不動 §0.4**：玩家能動性在「裝哪些技能 + 訓練解鎖」，不在戰鬥中途按鈕。
- **deterministic hook**：觸發輸入只有 canonical battle state / unit snapshot / phase context → 輸出 effect commands；
  若需機率，seed **走既有 reducer RNG**；**禁止讀 UI/外部隨機狀態**。

### 1.2 資料模型
```ts
type SkillId = string
type SkillTrigger = 'onBattleStart' | 'onSwitchIn' | 'preAttack' | 'onDamaged' | 'onTurnEnd' | 'onLowHp'
interface SkillDef {                       // 手寫 catalog（非產生檔）
  id: SkillId; name: string; icon: string; desc: string
  trigger: SkillTrigger
  condition?: string                       // 額外閘（如 hpBelow:1/3、firstTurn）
  effect: SkillEffect                      // 見下；NEVER 直接大傷害
  cost?: 'oncePerBattle' | { cooldown: number }
}
type SkillEffect =
  | { kind: 'statMod';      stat; mult; turns }       // 自身/隊友能力暫時加成
  | { kind: 'enemyDebuff';  stat; mult; turns }       // 降敵
  | { kind: 'terrainSet';   terrainId; turns }        // 設地形（接 plan/11）
  | { kind: 'selfHeal';     fraction }                // 小回復
  | { kind: 'conditionRewrite'; what: 'forceCritNext'|'accuracyUp'|'priorityNext'|... }
// 刻意沒有 {kind:'damage'}——技能不直接傷害（護欄）
```
- 掛載（沿用 M6 S1–S8）：`onBattleStart/onSwitchIn`→換人解析或開戰、`preAttack`→S1/S3 前、`onDamaged/onTurnEnd/onLowHp`→S4 同步段。觸發走 deterministic hook。

### 1.3 與特性（plan/10 §1）的關係：共引擎、分語義
- **底層共用 S1–S8 hook 引擎**（降複雜度）；資料語義嚴格分：
  - **特性**＝種族綁定、**不可換**、唯讀**被動**（1 個，`species.abilityId`）。
  - **技能**＝玩家**可學/可換/可繼承**的**條件主動**（1–2 槽）。

### 1.4 持久化（只存 canonical id）
```ts
interface OwnedUnit { /* …既有… */
  learnedSkillIds?: SkillId[]      // 已學會（庫）
  equippedSkillIds?: SkillId[]     // 出戰裝備（≤ 槽數）
  inheritedSkillIds?: SkillId[]    // 孵化繼承來的（可學池，見 §3）
}
```
- **不存派生倍率 / runtime cooldown**；開戰由 catalog `resolveSkillHooks(unit) → RuntimeHook[]` 解析（如 ext 注入）。

---

## 2. 訓練 / 學習（不肝、自用）
- **技能點 SP**：打 boss / 通塔層 / 達成里程碑獲得（**不做戰鬥刷技能 EXP**，避免與成長/孵化疊太多）。
- **技能訓練所（UI）**：花 SP 學技能（進 `learnedSkillIds`）、調整 `equippedSkillIds`（loadout）。
- **技能槽解鎖**：升級到門檻 / **進化 / 稀有訓練節點**解鎖第 2 槽。
  - **與 plan/09 §4 相容**：進化解鎖的是**技能槽**，**不是新攻擊招** → 「進化不解鎖新攻擊招、招式維持單一專屬」仍成立。

---

## 3. 繼承（合併 plan/10 孵化）
- **孵化蛋帶一個父母已學技能**（本傳蛋招精神）：`hatchEgg` 產出的 OwnedUnit 帶 `inheritedSkillIds`（該種族可學的才生效）。
- 蛋招只是「可學池」加成，仍需符合該技能的種族可學規則；不繞過 SP 直接裝備（除非設計為附贈，待玩測）。
- incubator slice（plan/10 §5）擴一欄記蛋帶的繼承技能 id（egg 仍只存 seed/source/pool/progress + 一個 inheritedSkillId）。

---

## 4. 合體技（Combo）— 合併連鎖系統（plan/09 §3）

### 4.1 機制（chain variant，不開新相位）
- 既有 chain 窗口提交 **2 名符合條件**的隊友（屬性配對 / 指定種族 / 羈絆）→ `SUBMIT_CHAIN_RESULT` 自動**升級**成合成大招 + 施放效果。
- **不吃額外能量、每組合每場一次**：用 chain 門檻 + `usedComboKeys` 限流。
- **與星擊分流**：星擊＝累積能量槽的單體必殺；合體技＝吃選角與連鎖順序的 Combo 變體。定位不重疊。
```ts
interface ComboDef {                       // 手寫 catalog
  id: string; name: string; icon: string
  requires: { typePair?: [TypeName, TypeName]; speciesPair?: [number, number]; bond?: string }
  power: number                            // 高合成威力（直接傷害僅此家族允許）
  castEffect: ComboCastEffect
}
```

### 4.2 施放效果（要設計的「合體技施放效果」，接 Pledge 範本 + plan/11）
三類，合體招命中後生效 N 回合，寫進 `fieldState`（見 §6）：
1. **灌注地形 `infuseTerrain`**：把某地形灌注全場 N 回合（接 plan/11 terrain mult）。例：水+火合體 → 灌注「蒸氣場」。
2. **全隊增益 `teamBuff`**：如追加效果機率↑ / 速度↑ / 攻擊↑ 數回合。
3. **敵方弱化 `enemyDebuff`**：如沼澤化降速 / 降防 / 命中↓ 數回合。
```ts
type ComboCastEffect =
  | { kind: 'infuseTerrain'; terrainId: string; turns: number }
  | { kind: 'teamBuff';      stat: string; mult: number; turns: number }
  | { kind: 'enemyDebuff';   stat: string; mult: number; turns: number }
```
- **演出（用戶要的「施放效果」演出）**：走既有 FxCanvas + framer + audio（合成光束匯聚 → 大招閃光 → 場域特效持續顯示），display 層演出，reducer 只發 domain event。

---

## 5. 對手技能多樣性 — Encounter Skill Profile（守對手簡單）
```ts
interface EncounterSkillProfile {
  tags: ('aggressive'|'disruptor'|'terrain'|'sustain'|'combo_seed')[]   // 0–2
  declaredCombos?: string[]            // 只有 boss / 雙人組宣告；非 AI 臨場搜尋
}
```
- 每個敵單位仍只有**一個專屬攻擊**；技能標籤是**純條件反射 hook**，在引擎底層被動執行。
- **AI 決策樹永遠只提交 ATTACK、不知道自己有技能**——狀態機推進到對應相位時自動解析 Profile 疊加效果。
  → 守「對手 AI 簡單」硬約束，不變招式選擇器。
- 合體技限 boss/雙人組，由 encounter profile **明確宣告**。

---

## 6. 場域狀態統一 `fieldState`（E3）
- **單一容器**收攏所有環境影響，杜絕 S1–S8 結算 race condition；但**分清子欄位來源與 expiry**（別變雜物桶）：
```ts
interface FieldStatus { label: string; icon: string; source: string; mods?: Record<string, number>; expiresTurn: number }
interface FieldState {
  terrainEffects: { terrains: string[]; source: string; expiresTurn?: number }   // 含 plan/11 地形 + 合體灌注
  teamStatuses:  FieldStatus[]     // 技能/合體 全隊增益
  enemyStatuses: FieldStatus[]     // 技能/合體 敵方弱化
  comboCastEffects: FieldStatus[]  // 合體施放專屬標記（供 UI/戰報）
}
// BattleState 另存 usedComboKeys: string[]（每組合每場一次；runtime，不回寫 OwnedUnit）
```
- 地形（plan/11 currentTerrains）併入 `fieldState.terrainEffects`，全場攻擊結算統一讀此容器算 terrainMult / 暫時 buff。

---

## 7. 不變式相容總結
| 風險 | 守法 |
|------|------|
| 破單招 | 技能不直接傷害；直接傷害只在專屬招+合體技/finisher；進化只解鎖技能槽非新攻擊招 |
| 破 §0.4 相位 | 技能=條件自動 hook 非玩家 action；合體技=既有 SUBMIT_CHAIN_RESULT 變體不開新相位 |
| 破純 reducer | 觸發 deterministic（canonical 輸入→effect commands）；機率走 reducer RNG；演出在 display 層 |
| 破 canonical 持久化 | OwnedUnit 只加 skill id 陣列；usedCombo/fieldState/cooldown 全 runtime 暫態不持久化 |
| 對手 AI 變複雜 | profile 標籤是純反射 hook；AI 只提交 ATTACK |

---

## 8. 開發切分（M8；圓桌定「縱向先打穿、再橫向鋪內容」）
> **先用極小測試資料（如初代御三家）一次打穿 M8.0–M8.e 全套工程地基並驗收平衡**，**再**把世代寶可夢/新地形/技能圖鑑橫向鋪開（內容 roadmap 見 `13-content-roadmap.md`）。

| 子里程碑 | 內容 | 核心工作 |
|----------|------|----------|
| **M8.0** | schema/catalog/persistence 純資料 | `SkillDef`/`ComboDef`/`EncounterSkillProfile`/`FieldState` 型別 + 手寫 catalog（小樣本）+ OwnedUnit 加 skill id 欄 + `resolveSkillHooks` 純函數 + vitest |
| **M8.a** | 技能 hook 觸發（玩家 loadout） | S1–S8 掛載技能 deterministic hook + loadout 戰前套用 + 個體面板技能區 + vitest（觸發/護欄：無直接傷害） |
| **M8.b** | 訓練 / 解鎖 | SP 取得（boss/塔）+ 技能訓練所 UI（學/裝）+ 進化/節點解鎖第 2 槽 |
| **M8.c** | 孵化繼承 | incubator egg 帶 `inheritedSkillId` + hatch 落到 `inheritedSkillIds` |
| **M8.d** | 合體技（chain variant + 施放效果） | `ComboDef` + SUBMIT_CHAIN_RESULT 升級判定 + `usedComboKeys` 限流 + 三類施放效果寫 fieldState + 演出 + vitest |
| **M8.e** | 對手 profiles | `EncounterSkillProfile` + encounter 生成附標籤 + 純反射 hook + boss/雙人組宣告合體技 |

每子步：純函數先 vitest → UI 接線 → Chrome CDP 實機 → 綠燈即 commit。

## 9. 待設計階段定 / 玩測
- 技能 catalog 內容與數值上限、SP 取得/花費曲線、技能槽解鎖門檻。
- 合體技配對表（哪些屬性/種族能合體）、各施放效果數值與回合數、每場一次是否夠用。
- 對手 profile 標籤權重、boss 合體技頻率。
- 繼承蛋招是否附贈直接可裝 vs 僅入可學池。
