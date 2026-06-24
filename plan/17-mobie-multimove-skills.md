# 17 — Mobie 多招式制（M19；放寬單招、寶可夢式招式系統）

> 來源：使用者回饋「mobie 技能不會只有一個，現在只有一個」；拍板**放寬「每隻單一專屬招」硬約束 → 寶可夢式多招式制**。
> 並澄清原 plan/16 把「玩家技能」與「怪物技能」混為一談——**怪物(Mobie)技能＝可學可忘、有上限**；**玩家(Partner)技能另立**（見 `plan/19`，M17 修訂版）。
> 設計經四方 agent-chat（Claude/gemini/codex/mistral）round-robin 收斂全體 agree，結論全文：
> `.claude/agent-chat/session-20260624-012214/conclusion.md`。
> 招式系統知識基準：寶可夢維基（領悟/學習/繼承/出生自帶/招式回憶/招式遺忘/4 招上限）。
>
> **本檔是 M19 的真相來源**；`CHECKLIST.md` / `handoff.md` / `plan/14` 只引用，不重抄。
> **一句話**：每隻 Mobie 有「種族學習表」，出生帶 1 招、可學可忘、出戰裝備上限 4 招（攻擊招＋變化招）；
> 戰鬥「選槽即開打」、reducer 仍單一 ATTACK action；身分由星擊 finisher 承載。

---

## 0. 與既有設計的關係（重要：本里程碑取代/吸收了什麼）

| 既有 | 本里程碑後的狀態 |
|---|---|
| **CLAUDE.md 硬約束「每隻單一專屬招」** | **放寬**為多招式（≤4）。簽名身分改由**星擊 finisher** 承載（仍單一）。其他硬約束（純 reducer/高頻值紅線/canonical 持久化/不內建侵權資產）**全部不變**。 |
| **原 M17「Partner 技能系」混入怪物 buff（鼓舞/守護/疾風…）** | 那些 buff **下放回怪物招式槽**＝變化招。M17 **瘦身**成純玩家(訓練師)技能（看穿/支援/道具）。見 `plan/19`。 |
| **plan/12 M12「技能 loadout（原 M8.a）＋訓練解鎖（原 M8.b）」** | **由本 M19 取代並落實**為「怪物多招式 loadout＋招式訓練所」。M12 剩餘（合體技 M8.d / 對手 profile M8.e / 孵化繼承 M8.c）**續留**，且改建在 M19 的多招式之上。 |
| **species 既有單一 `moveId`** | 成為學習表頂端、落位為 **slot0「出生自帶招」**＝向後相容（既有存檔不壞）。 |

**分界線（agent-chat 全體強調，務必守住）**：
- **主動選擇施放 = 招式（佔招式槽，本里程碑）**：攻擊招 + 變化招（劍舞/鐵壁/神速/小回復/設地形類）。
- **被動/自動/常駐觸發 = 特性（Ability，M7 已實作，不進招式槽）**：威嚇/絕境爆發/引火類。

---

## 1. 戰鬥嵌入：多招式如何進「QTE 單一行動街機」

### 1.1 選招手感（display 層）
- **招式槽上限 = 4**。每回合：玩家**選 1 招 → 立即進入該招 QTE**。
- **UI＝四鍵/方向映射「選槽即開打」**（非 RPG 巢狀選單）：按下方向鍵的瞬間即選定並進入 QTE 倒數，靠肌肉記憶維持 Mezastar 流暢打擊感。槽位顯示招式名＋屬性圖示（簡化預覽，降記憶負擔）。
- **逾時自動 slot0 / 上回合招**，不停頓。
- **星擊 finisher** 維持獨立觸發（吃能量槽的單體必殺，long-press/雙擊或既有觸發點），與 4 槽操作明確分離＝身分感。

### 1.2 reducer / engine 改動（**全部 additive，不破純度、不開新相位**）
- `BattleAction` 的 ATTACK 加 **`slotIndex?: number`（0–3）**：
  `{ type: 'ATTACK'; quality?; mashCount?; starStrike?; slotIndex? }`。
  忠實反映「玩家按了哪槽」（防客戶端送未裝備招）。`slotIndex` 省略＝slot0（向後相容、逾時預設）。
- reducer 用 **`equippedMoves[slotIndex]` 重驗並 resolve**，把 **`resolvedMoveId` 寫進 `damageApplied` event**（安全 + 回放除錯 + M9/M12 連鎖判定皆有據；display 層讀此演出該招特效）。
- `BattlePokemon.move: Move` → **`moves: Move[]`**（slot0＝出生自帶；長度＝裝備招數 ≤4）。
  - `engine.resolveAttack(attacker, target, opts)` 目前讀 `attacker.move` → 改為吃明確 `move`（或 `attacker.moves[moveIndex]`）。`terrainMult` 由 `move.type` 算（既有 line 268 同理）。
  - `performAttack`/`AttackParams` 加 `moveIndex`（預設 0）；玩家側由 `action.slotIndex` 帶入、對手側由 `chooseOpponentMove` 帶入。
- **戰鬥中 loadout 不可變（snapshot）**：`equippedMoves` 在 `createBattleState` / buildBattleMobie 時固定進 `BattlePokemon.moves`；學/忘/換招**只在非戰鬥流程**。杜絕 race condition。

### 1.3 變化招（status move）的結算與 QTE（B 題定案）
- 變化招＝**無傷害**，選到就施放效果：**複用 M7 的 S1/S3/S4 effect 引擎**（statMod/guard/terrainSet/heal），差別只是**改由「玩家選招」主動觸發**（而非道具/特性的被動 hook）。效果寫進 M8 既有 `fieldState`（teamStatuses/enemyStatuses 子欄由此**首次填用**，呼應 plan/14「M8 導入容器→補全子欄」）。
- **變化招走「輕量 QTE → 決定效果強度」**：Perfect/Good/Miss 影響 buff **倍率/回合數**。
  - **硬約束**：QTE **只影響幅度/回合數、不影響是否成功**（操作失誤不會把變化招變廢回合、也不讓 buff 鏈爆表）；強度有**硬上限**。
  - 可用**不同 QTE 模式**（按住/連打 vs 攻擊招的命中時機）視覺區分攻擊 vs 變化招，並顯示效果預覽（「Perfect：+2 回合」）。
- 變化招不造成 `damageApplied`；改發新的（或既有）domain event（如 `statusApplied`/`heal`）給 display 演出。reducer 仍純。

### 1.4 對手 AI（守「對手簡單」硬約束）
- reducer 內**純函式 `chooseOpponentMove(state, rng): slotIndex`**：加權隨機（剋制×3、本系×2）。**不新增 AI 相位、不引決策樹**——對手仍只「提交 ATTACK」，選哪槽由此純函式決定論（seed 走既有 rng）。
- 加分（可後補）：招式冷卻（用過短暫降權避免連續重複）、能量滿時提升星擊權重。

---

## 2. 資料模型（canonical 只存 id 陣列）

```ts
// game/types.ts
export interface OwnedUnit {           // …既有欄位…
  /** 已學會的招式庫（canonical，隨 roster 序列化、含 .save）。來源：領悟/學習/繼承/出生 */
  learnedMoveIds?: number[]
  /** 出戰裝備（≤ 招式槽數；canonical）。slot0 慣例＝出生自帶招 */
  equippedMoveIds?: number[]
  // 上限與學習表非持久化——由 species 學習表＋等級於 runtime 算出
}

export interface BattlePokemon {       // …既有欄位…
  moves: Move[]                        // 取代單一 move；slot0＝出生自帶；長度＝裝備數 ≤4
}

// game/data/species.ts（產生檔）每隻新增：
export interface Species {             // …既有…
  moveId: number                       // 保留＝slot0/出生自帶（向後相容）
  learnset: { level: number; moveId: number }[]   // 領悟表（等級→招），約 3–6 項跨 tier
  teachableMoveIds: number[]           // 招式機/教學可學清單（型別相容的精簡集）
  eggMoveIds?: number[]                // 蛋招池（M10 孵化繼承來源；可選）
}
```

- **不存**派生 Move 物件、學習表、QTE 派生強度、runtime cooldown。
- `sanitizeRoster` 只留**該種族學習表/teachable/egg 內合法**的 moveId；`equippedMoveIds` 去掉未在 `learnedMoveIds` 者、截到上限。
- **遷移**：既有 OwnedUnit 無此兩欄 → load 時 lazy 補：`learnedMoveIds = 出生自帶回填`、`equippedMoveIds = [species.moveId]`（等同現況單招），不破既有存檔。

---

## 3. 招式四來源 → 本遊戲迴圈映射（無大地圖 NPC）

| 寶可夢來源 | 分類 | 本遊戲落點 |
|---|---|---|
| **領悟（升級）** | 後天·主來源 | 升級時把學習表「≤現等級」的招自動放進 `learnedMoveIds`（自動、免費）。`rosterStore.applyExp/grantBattleExp` 升級結算處掛 `onLevelUp` 補招（發 `moveLearned` event 供 UI 提示）。 |
| **學習（技能機 TM／教學 tutor）** | 後天 | 合併成「**招式訓練所** UI」：花 **SP** 學該種族 `teachableMoveIds` 內的招（→`learnedMoveIds`）。 |
| **繼承（蛋招）** | 遺傳 | M10 孵化落地時 egg 帶父母一個蛋招進 `learnedMoveIds`（須在該種族 `eggMoveIds` 內才生效）。**預留接點給 M10**。 |
| **出生自帶** | 出生 | 捕獲/孵化時依學習表回填「現等級以下最靠近的數招」進 `equippedMoveIds`（寶可夢式）。`captureUnit`/`createOwnedUnit` 處實作。 |
| **招式回憶** | 後天·補回 | 招式訓練所提供：把學習表上漏學/被忘的招補回 `learnedMoveIds`（可選小額 SP/免費，待玩測）。 |
| **招式遺忘 + loadout 編輯** | 移除/編輯 | 招式訓練所提供：從 `equippedMoveIds` 清出招位、調整出戰 4 招（`learnedMoveIds`→`equippedMoveIds` ≤上限）。 |

**全部只在非戰鬥流程**（守「戰鬥中 loadout 不可變」）。

### 3.1 SP 單一經濟（含護欄）
- **SP（玩家技能點，打 boss / 通塔層得）為單一貨幣**，同時供「**Mobie 招式訓練**」與「**Partner 玩家技能**（`plan/19` M17）」。塔層 SP 預留 M11、里程碑 SP 選配。
- **護欄**：雖共用來源，**UI 與成本曲線分池顯示**（怪物招式 vs 訓練師技能兩分頁/兩成本表），避免玩家誤以為同類。
- SP 錢包 slice：`mobie.skillpoints.v1`（帳號級單一數值）。與 `plan/19` M17 共用同一 slice。

---

## 4. 招式池 / 學習表資料產生（gen_dex）

- **維持精簡招式池**：不吃 PokéAPI 數百真實招（街機平衡災難）。沿用既有 18 型×power-tier 思路，**擴充**：
  - 攻擊招池：18 型 × 3 tier（既有，弱45/中70/強95）。
  - **新增變化招池**：少量通用變化招（如 自我攻擊↑、自我防禦↑、自我速度↑、小回復、設地形），跨型別共用或型別輕關聯。
- **學習表＝降維映射**：gen_dex 從 PokéAPI `/pokemon` 的 `moves[].version_group_details`（`level_learned_at` + `move_learn_method`：level-up/machine/egg/tutor）抓真實節奏，**映射到我們的招式池**：
  - level-up → 產 `learnset: {level, moveId}[]`（約 3–6 項，跨 tier；用真實 level 當節奏、moveId 取我們池中同型對應 tier）。
  - machine/tutor → 產 `teachableMoveIds`（該隻型別相容的招，精簡）。
  - egg → 產 `eggMoveIds`（可選；M10 用）。
  - **slot0 向後相容**：`species.moveId`（現行單招）= learnset 最低階項，確保既有存檔/邏輯不變。
- 四個產生檔仍為**產生檔勿手改**（改 gen_dex 再 `node scripts/gen_dex.mjs`）。重產只動 `species.ts`/`moves.ts`（新增變化招），`regions.ts`/`playerCards.ts` 確定性不變。
- **平衡驗證**：`simulation.test.ts` 擴入「多招式 + AI 選招」維度跑數百場壓力（HP 邊界/無 NaN/必定終局/決定論）。

---

## 5. 連鎖(M9) / 合體技(M12) 與多招式的接點

- **攻擊招**：推進傷害連鎖（M9）/ 觸發合體技（M12）。連鎖各段沿用「該隻的攻擊招」（slot0 或當段宣告招；`resolvePlayerChain` 既有重驗存活/同一目標不變）。
- **變化招**：**不斷鏈**，但貢獻轉化為「**連鎖支援值 / buff 強度**」（不參與傷害倍率）。
- **合體技門檻**：本次鏈中**至少 1 個攻擊招**，否則只結算輔助合體效果（如全隊回復）。
  → 杜絕「純 buff 鏈爆傷」漏洞，又讓輔助配招有戰術價值。
- `resolveAttack`/`performAttack` 既有連鎖路徑（reducer.ts §連鎖）改吃 `moveIndex`；連鎖規則 `CHAIN_RULES` 不動。

---

## 6. UI 一覽

| 畫面/元件 | 改動 |
|---|---|
| **BattleScreen** | 行動列加「四槽選招」UI（方向/四鍵映射、選槽即進 QTE）；攻擊招走命中 QTE、變化招走輕量強度 QTE（不同模式、效果預覽）；星擊維持獨立。`resolveTurn` 傳 `slotIndex`。 |
| **MobCard（`plan/16` M16）** | 招式區由「單招」→「**4 招 loadout** 逐招顯示（名/型別/物理特殊·變化/威力/命中）」。兩里程碑複用同卡。 |
| **招式訓練所（新 modal）** | Title 入口「📖 招式」或併入 TeamModal 分頁：學招（花 SP，teachable）/ 回憶 / 遺忘 / 調 loadout（≤4）/ 顯 SP 餘額；**與 Partner 技能分池**。 |
| **升級提示** | `moveLearned` event → 戰後/升級彈出「學會新招」提示，可即時調 loadout。 |

---

## 7. 守住的不變式（自我檢核表）

| 風險 | 守法 |
|---|---|
| 破純 reducer | 選招＝`slotIndex` 注入；`resolvedMoveId` 由 reducer 算並寫 event；無 UI/動畫字眼。 |
| 破相位契約 | 仍每回合單一 ATTACK action、不開新相位；變化招亦在同一 ATTACK 解算。 |
| 破 canonical 持久化 | OwnedUnit 只加 `learnedMoveIds`/`equippedMoveIds` 兩 id 陣列；moves[]/學習表/QTE 強度/cooldown 全 runtime。 |
| 破高頻值紅線 | QTE（攻擊/變化）指針仍走 ref/rAF/Zustand。 |
| 污染招式槽 | 被動效果歸特性（M7）、不入槽；只有主動施放招進槽。 |
| 變化招變廢回合 / buff 爆表 | QTE 只影響幅度不影響成敗；強度硬上限；純 buff 鏈不參與傷害、合體技需≥1 攻擊招。 |
| 既有存檔壞 | species.moveId→slot0；load 時 lazy 補兩欄＝等同現況單招。 |
| 對手 AI 變複雜 | 純函式 `chooseOpponentMove` 加權隨機、不新增相位。 |

---

## 8. 開發切分（每步綠燈即 commit；先小樣本縱向打穿、再橫向鋪）

> 比照 M12 圓桌定「先用極小樣本（如御三家）一次打穿全套地基、驗收平衡，再橫向鋪內容」。

| 子步 | 內容 | 核心工作 |
|---|---|---|
| **M19.a** | 資料模型 + 向後相容 | `OwnedUnit` 加兩欄、`Species` 加 learnset/teachable、`BattlePokemon.moves[]`；load lazy 遷移；`sanitizeRoster` 守法；vitest（遷移/合法性/上限）。**先手寫小樣本 learnset**，gen_dex 後補。 |
| **M19.b** | reducer/engine 多招式（additive） | ATTACK 加 `slotIndex`、`performAttack`/`resolveAttack`/`AttackParams` 吃 `moveIndex`、`resolvedMoveId` 寫 event、loadout snapshot；`chooseOpponentMove` 純函式；vitest（選槽/重驗/AI 決定論/向後相容預設 slot0）。 |
| **M19.c** | 戰鬥 UI 選招 | BattleScreen 四槽「選槽即開打」+ 攻擊招命中 QTE；星擊分離；MobCard 顯 4 招。CDP 實機。 |
| **M19.d** | 變化招（status move） | 變化招池 + 輕量強度 QTE（不影響成敗）+ 複用 S1/S3/S4 effect 寫 fieldState + 連鎖規則（不斷鏈/支援值/合體需攻擊招）；vitest（效果/上限/鏈不爆傷）。 |
| **M19.e** | 招式訓練所 + SP 經濟 | `mobie.skillpoints.v1` + boss/塔給 SP + 招式訓練所 UI（學/憶/忘/loadout，與 Partner 分池）+ 升級 `moveLearned` 自動領悟。 |
| **M19.f** | gen_dex 學習表產生 + 平衡 | gen_dex 抓 PokéAPI learnset 降維映射、重產 species.ts/moves.ts；`simulation.test.ts` 納入多招式壓力；CDP 全 loop。 |

> **接點預留**：M10 孵化繼承（eggMoveIds→learnedMoveIds）、M10 進化解鎖招位/學習表項、M12 合體技吃 loadout 屬性配對、M11 塔給 SP。

---

## 9. 待玩測調參（不阻塞）
- 招式槽上限 4 vs 3；SP 曲線（學一招花多少、boss 給多少）；變化招強度上限與 QTE 模式手感。
- learnset 降維每隻取幾招、跨 tier 分佈；變化招池大小與型別關聯。
- 星擊 finisher 與多招式的能量槽互動（哪些招蓄能、變化招蓄能率）。
- 招式回憶是否收費；slot0 是否永遠鎖出生招或可換。
