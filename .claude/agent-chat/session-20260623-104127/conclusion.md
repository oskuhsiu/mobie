# 圓桌結論 — 戰鬥技能大模組（M8 Battle Skill Module）

## 任務
設計「技能 訓練/學習/繼承 + 合體技(含施放效果) + 對手技能多樣性」，與現有計畫合併，並守住硬約束「單一專屬招式」。三方達成完全共識。

## 核心定案：選項 A（守單招）
- **專屬招(QTE 大招)維持單一＝寶可夢身分**，**硬約束不破**。
- **技能**＝獨立的「主動戰術輔助層」：戰前 loadout(1–2 槽) + 戰中**deterministic 條件自動觸發**。
  - 觸發 hook 輸入只有 canonical battle state / unit snapshot / phase context → 輸出 effect commands；機率走既有 reducer RNG；不讀 UI/外部狀態。
  - **不新增玩家 action、不動 §0.4 相位契約**（玩家能動性在 loadout 選擇與訓練，不在中途按鈕）。
  - **護欄：技能不可造成直接大傷害**（只狀態/倍率/地形/條件改寫）；**直接傷害只留給「專屬招 + 合體技/finisher 家族」**——這是守單招身分的關鍵。

## 特性 vs 技能（共引擎、分語義）
- 底層共用 S1–S8 hook 引擎降複雜度；資料語義嚴格分：
  - **特性**＝種族綁定、不可換、唯讀被動(1)。
  - **技能**＝可學/可換/可繼承的條件主動(1–2 槽)。

## 訓練 / 學習 / 繼承
- **訓練**＝教學點(打 boss/塔層獲得)買技能 + **進化/稀有節點解鎖技能槽**（解鎖的是「技能槽」非新攻擊招 → plan/09 §4「進化不解鎖新攻擊招」仍成立）。**不做戰鬥刷技能 EXP**（避免與成長/孵化疊太多）。
- **繼承**＝孵化蛋帶一個父母已學技能（合併 plan/10 incubator 的蛋招）。
- **持久化**：OwnedUnit 只加 canonical `learnedSkillIds[] / equippedSkillIds[] / inheritedSkillIds[]?`；開戰由 catalog resolve 成 runtime hooks；**不存派生倍率/cooldown**。

## 合體技（合併連鎖系統）
- **＝連鎖 Combo 變體**：既有 chain 窗口提交 2 名符合條件(屬性配對/指定種族/羈絆)的隊友 → `SUBMIT_CHAIN_RESULT` 自動升級成合成大招 + 施放效果。
- **不吃額外能量、每組合每場一次**（用 chain 門檻 + once-per-combination 限流）；星擊維持能量槽 → 兩者定位不打架（星擊＝單體必殺能量槽；合體技＝吃選角與連鎖順序的 Combo）。
- **施放效果三類**（接 Pledge 範本 + plan/11 地形）：①灌注地形(生效 N 回合)②全隊增益③敵方弱化。
- 每場一次記錄放 BattleState runtime `usedComboKeys`，**不回寫 OwnedUnit**。

## 對手技能多樣性（守對手簡單）
- **Encounter Skill Profile**：每個敵單位仍只有一個專屬攻擊 + 0–2 個技能標籤(aggressive/disruptor/terrain/sustain/combo_seed)。
- 標籤是**純條件反射 hook**，引擎底層被動執行；**AI 決策樹永遠只提交 ATTACK、不知道自己有技能**（守「對手 AI 簡單」硬約束，不變招式選擇器）。
- 合體技限 boss/雙人組，由 encounter profile **明確宣告**，非 AI 臨場搜尋。

## 場域狀態統一（E3）
- 統一單一 `fieldState` 容器，但**分清子欄位來源與 expiry**：`terrainEffects / teamStatuses / enemyStatuses / comboCastEffects`（避免變雜物桶、杜絕 S1–S8 結算 race condition）。地形(plan/11)與合體施放效果共用此容器。

## 落點與里程碑（E1/E2）
- **新 plan「12 Battle Skill Module」**，引用回 09 連鎖 / 10 孵化 / 11 地形（當單招約束總控）。獨立里程碑 **M8**。
- **M8 縱向先做完（小樣本）**：M8.0 schema/catalog/persistence 純資料 → M8.a 技能 hook 觸發(玩家 loadout) → M8.b 訓練/解鎖 → M8.c 孵化繼承 → M8.d 合體技(chain variant+施放效果) → M8.e 對手 profiles。
- **用極小測試資料(如初代御三家)一次打穿 8.0–8.e 全套地基並驗收平衡**，**再**把世代寶可夢/新地形/技能圖鑑「橫向鋪開」分階段（內容 roadmap 另立 plan）。

## 三方立場
gemini：主導 A 選型、合體技=chain 條件獎勵不吃能量、fieldState 統一防 race、對手=純反射 hook 守 AI 簡單、E2 反對綁世代分階段(先打穿地基)。
codex：主導護欄(技能不可直接傷害)、deterministic hook、訓練=教學點+進化槽不刷 EXP、持久化只存 skill ids、fieldState 分子欄位、usedComboKeys 不回寫 OwnedUnit、支持獨立 M8。
無未解分歧。
