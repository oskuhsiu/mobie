# 06 — 寶可夢對戰常識參考（查證 Bulbapedia）

> 本檔是上網查證的「正規寶可夢對戰機制」筆記，作為戰鬥系統設計依據。
> 每節最後標註 **本作 MVP** 的採用或簡化決定，避免憑記憶亂做。
> 主要來源：Bulbapedia（見文末 Sources）。

---

## 0. 對戰格式（澄清 3對3）
- **單打（Single Battle）**：每位訓練家一場帶最多 **6 隻**，競技常見「**選 3 出戰**」。本作的「3對3」＝**一位訓練家一場出動 3 隻**。
- **同時只有 1 隻在場**；其餘待命，可在回合開始時**換人**。
- 在場寶可夢被打倒（HP 歸 0）→ 換上下一隻；**全隊倒下＝落敗**。
- **本作 MVP**：雙方各 3 隻、單打依序；擊倒對方全部 3 隻＝勝。捕獲只在擊敗對方最後一隻（boss）時觸發。

---

## 1. 能力值（Stats）
六項：**HP / 攻擊 Atk / 防禦 Def / 特攻 SpA / 特防 SpD / 速度 Spe**。

由種族值 + 個體值(IV) + 努力值(EV) + 性格(Nature) + 等級算出：
```
HP        = ⌊(2×Base + IV + ⌊EV/4⌋) × Level / 100⌋ + Level + 10
其他能力值 = ⌊(⌊(2×Base + IV + ⌊EV/4⌋) × Level / 100⌋ + 5) × Nature⌋
```
- **IV**：個體值 0–31，同種個體差異。
- **EV**：努力值，戰鬥養成，單項上限 252、總和 510，每 4 EV = 1 點（Lv100）。
- **Nature**：性格，對某項 ×1.1、另一項 ×0.9，其餘 ×1.0。

**本作 MVP**：採用 HP / 其他能力值公式。
- M1（已完成）：IV 固定、忽略 EV/Nature（`src/game/stats.ts`）。
- **M1.5e 起（個體差異）**：每隻用 seed 決定論 roll **IV(0-31/項) + 性格(25 種, ±10%)**，併入公式（見 §12 性格表、`plan/07-systems-design.md`）。**EV 仍不做**。
- **M1.5f 起（成長）**：EXP/升級重算（見 §13）。

---

## 2. 出手順序（Turn Order / Priority）
1. **先制等級（priority bracket，+5…−7）** 高者先動，與速度無關。
2. 同先制等級 → **速度高者先**。
3. 速度相同 → **隨機**。
- 常見先制 +1 招式：電光一閃 Quick Attack、子彈拳、水流尾… 防禦類（Protect）+4。
- **換人 / 用道具**屬於特殊行動，**在所有招式之前結算**（換人後對手的招式會打到換上的寶可夢）。

**本作 MVP**：先制等級先做「攻擊 vs 攻擊」用**速度**定先後、相同隨機（已實作 `playerActsFirst`）。招式先制值先不做（單招、無 Quick Attack 類）。**換人先結算**＝換上的會挨對方一擊（對應我們的「防禦 QTE」）。

---

## 3. 傷害公式（Damage，Gen V+）
```
Damage = ( (2×Level/5 + 2) × Power × A / D / 50 + 2 )
         × Targets × Weather × Critical × random × STAB × Type × Burn × other
```
- **A / D**：物理用 Atk/Def、特殊用 SpA/SpD。
- **random**：0.85–1.00（整數 85–100 / 100）。
- **STAB**：本系一致 ×1.5。
- **Type**：屬性相剋（見 §4）。
- **Critical**：會心 ×1.5（見 §5）。
- **Burn**：灼傷且物理招 ×0.5。
- 全程除法**無條件捨去**。

**本作 MVP** 採用簡化版（已實作 `resolveAttack`）：
```
base = ⌊⌊⌊(2×Level/5+2) × Power × A / D⌋ / 50⌋ + 2⌋
damage = ⌊ base × STAB × Type × random(0.85–1) × Crit × QTE ⌋ ；命中且有效時至少 1
```
新增 **QTE 倍率**（街機手感，非正規）；Weather/Targets/Burn/other 先不做。

---

## 4. 屬性相剋（Type Effectiveness）
- 倍率：**0（免疫）/ 0.25 / 0.5 / 1 / 2 / 4**（雙屬性連乘；正規另有 0.125、8 的極端）。
- 18 屬性：一般/火/水/電/草/冰/格鬥/毒/地面/飛行/超能力/蟲/岩石/幽靈/龍/惡/鋼/妖精。
- 經典免疫：一般→幽靈 0、幽靈→一般 0、電→地面 0、地面→飛行 0、毒→鋼 0、超能力→惡 0、龍→妖精 0。

**本作 MVP**：完整 18 型相剋表已實作並單測（`src/game/data/typeChart.ts`，含上述免疫）。

---

## 5. 本系加成 STAB
- 招式屬性 ＝ 使用者屬性之一 → **×1.5**（特性「適應力」×2，本作不做）。

**本作 MVP**：已實作 ×1.5。

---

## 6. 會心一擊（Critical Hit，Gen VI+）
- 基礎機率 **1/24（≈4.17%）**；會心等級 +1=1/8、+2=1/2、+3=必定。
- 傷害 **×1.5**。
- **無視**：攻方的負能力等級、守方的正能力等級、與反射壁/光牆等防禦加成。

**本作 MVP**：基礎會心率 **1/16**（略高，街機爽度）、×1.5（已實作）。能力等級系統未做，故「無視能力等級」暫不適用。

---

## 7. 命中與迴避（Accuracy / Evasion）
- 招式有**命中率**（如 100、90）；命中判定亦受能力等級（命中/迴避階級）影響。

**本作 MVP**：採招式命中率做 miss 判定（已實作）；命中/迴避階級不做。

---

## 8. 狀態異常（Status Conditions）— 非揮發性
| 狀態 | 效果 | 每回合傷害 | 備註 |
|---|---|---|---|
| 灼傷 Burn | 物理傷害減半 | 最大HP **1/16** | 持續至治癒 |
| 冰凍 Freeze | 無法行動 | 無 | 每回合 20% 解凍 |
| 麻痺 Paralysis | 速度 **×0.5**、**25%** 無法行動 | 無 | 持續至治癒 |
| 中毒 Poison | — | 最大HP **1/8** | 持續至治癒 |
| 劇毒 Badly Poisoned | — | 1/16 起，**每回合 +1/16** | 換下場重置 |
| 睡眠 Sleep | 無法行動 | 無 | 持續 **2–4 回合** |

**本作 MVP**：**不做狀態異常**（圓桌定案砍掉，集中於 3v3+換人+聲光）。本表留作日後 M2+ 擴充依據。

---

## 9. 換人機制（Switching）
- 主動換人**會用掉該回合的行動**；換人在招式之前結算，故**對手的招式會打到換上的寶可夢**。
- 若換上的寶可夢當場被打倒 → 下回合再被迫換下一隻。
- 寶可夢倒下後送出下一隻**不消耗額外回合**（強制換）。
- 進階（本作不做）：追擊 Pursuit 可在換人時攔截、樹果/特性觸發、入場特性等。

**本作 MVP**（圓桌定案的街機化調整）：
- 主動換人＝戰術動作：收回→放出→對手攻擊換上的一次，但玩家可打**防禦 QTE** 抵減（perfect 90%/good 60%/normal 30%/weak 0%）。該回合不能攻擊。
- 防濫用：每回合最多換一次、剛換上不能立刻換回。
- 被擊倒＝**免費強制換**（無防禦 QTE）。換上若仍被該擊打倒→立即再強制換。

---

## 10. PP（Power Points）
- 每招有使用次數上限（PP），用盡不能再用該招。

**本作 MVP**：**不做 PP**（每隻單一專屬招式、無限使用）。

---

## 11. 勝負條件
- 一方**全隊倒下**＝落敗。本作另有「擊敗對方最後一隻 → 觸發捕獲」。

---

## 12. 性格（Nature）— 25 種，±10%
- 每隻生成時固定一個性格，不可改。一項能力 ×1.1、另一項 ×0.9（同一項則互相抵銷＝中性）。
- 5 個中性性格（無影響）：Hardy、Docile、Serious、Bashful、Quirky。

| 性格 | ↑ | ↓ | | 性格 | ↑ | ↓ |
|---|---|---|---|---|---|---|
| Lonely 孤獨 | Atk | Def | | Mild 溫和 | SpA | Def |
| Brave 勇敢 | Atk | Spe | | Quiet 冷靜 | SpA | Spe |
| Adamant 固執 | Atk | SpA | | Rash 馬虎 | SpA | SpD |
| Naughty 頑皮 | Atk | SpD | | Calm 溫順 | SpD | Atk |
| Bold 大膽 | Def | Atk | | Gentle 慎重→溫文 | SpD | Def |
| Relaxed 悠閒 | Def | Spe | | Sassy 自大 | SpD | Spe |
| Impish 淘氣 | Def | SpA | | Careful 慎重 | SpD | SpA |
| Lax 樂天 | Def | SpD | | Timid 膽小 | Spe | Atk |
| Modest 內向 | SpA | Atk | | Hasty 急躁 | Spe | Def |
| Jolly 爽朗 | Spe | SpA | | Naive 天真 | Spe | SpD |
| (中性) Hardy/Docile/Serious/Bashful/Quirky | — | — | | | | |

**本作 MVP**：M1.5e 起採用全部 25 性格（±10%）；UI 以能力值紅(加)藍(減)色標呈現。

## 13. 經驗 / 成長（Experience）
- 擊敗對手獲得 EXP，**被擊敗者等級越高給越多**。
- 6 種成長曲線（Erratic/Fast/Medium Fast/Medium Slow/Slow/Fluctuating）。
- **Medium Fast** 最常見、公式最簡：到 N 級總經驗 = `N^3`（Lv100 = 1,000,000）。

**本作 MVP**：M1.5f 起，**全部寶可夢統一用 Medium Fast `n^3`**（簡化），勝利得 EXP→升級→重算能力值。EXP 取得量公式參數待定（見 `plan/07-systems-design.md`）。

## Sources
- [Bulbapedia — Damage](https://bulbapedia.bulbagarden.net/wiki/Damage)
- [Bulbapedia — Critical hit](https://bulbapedia.bulbagarden.net/wiki/Critical_hit)
- [Bulbapedia — Priority](https://bulbapedia.bulbagarden.net/wiki/Priority)
- [Bulbapedia — Status condition](https://bulbapedia.bulbagarden.net/wiki/Status_condition)
- [Bulbapedia — Statistic](https://bulbapedia.bulbagarden.net/wiki/Statistic)
- [Bulbapedia — Type](https://bulbapedia.bulbagarden.net/wiki/Type)
- [Bulbapedia — Nature](https://bulbapedia.bulbagarden.net/wiki/Nature)
- [Bulbapedia — Experience](https://bulbapedia.bulbagarden.net/wiki/Experience)
- [Bulbapedia — Pokémon Mezastar](https://bulbapedia.bulbagarden.net/wiki/Pok%C3%A9mon_Mezastar)（機台機制）
