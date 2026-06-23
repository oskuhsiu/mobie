# 圓桌結論 — 延伸系統第二批選 5（M6 wave-2）

## 任務
從 plan/09 §7 backlog 14 個剩餘候選挑第二批 5 個可模組化/可選掛載系統，沿用 wave-1 的 M6 掛載機制（S1–S8 + ext 注入 + §0.4 相位契約 + 獨立 save slice + RunState 防火牆），且與 wave-1 互補不重疊。

## 共識：選出的 5 個（M6 wave-2）
**2 特性 / 10 星級Grade / 11 圖鑑成就 / 15 難度修飾Ascension / 18 抽蛋孵化**
定位＝「戰鬥深度第二層(特性) + 收集三件套(Grade/圖鑑/孵化) + 挑戰二階(Ascension)」。

- 開場我提 12 跨場療傷，gemini/codex 一致反對並換成 **18**：12 把戰損變 OwnedUnit canonical 欄(currentHp/restingUntil)會持續侵蝕 RunState 防火牆、所有入口都要想回寫/休息/復原 tick；若要輪替壓力應日後做成塔/遠征局內 modifier。**12 退回 backlog。**

## 鎖定的設計邊界（B1–B5，進設計階段硬前提）
- **B1 特性 vs 道具**：特性＝種族內建/固定/不可換（species 資料指派）；道具＝可裝可換外掛槽。效果池自製不抄本傳名（防侵權），類別＝statMod/damageHook/onceTrigger + onSwitchIn(入場觸發)。**不做「同類不疊加」硬限制**（gemini：會讓 reducer 充滿來源判斷髒碼、扼殺單人 high-roll 樂趣）→ 同類加法疊加、**靠數值池上限控平衡**。UI 分開顯示來源。
- **B2 Grade**：**完全零 buff**、純展示派生徽章（gemini：IV 已提供實質戰力，Grade 再加 buff＝double-dipping）。由 `shiny + IV 總和 tier + 來源` 純函數派生 1–6 階（貼 Mezastar Grade1–6/Star=5/Superstar=6），不另存、與既有 IV 星級語義分離（IV=素質軸、Grade=稀有展示軸）。
- **B3 成就發獎**：成就判定/領取狀態存獨立 `mz.meta.v1` slice；發獎走明確 action `claimAchievementReward(id)` 產 egg/incubator entry（**非**圖鑑讀取時自動寫入）→ 11 維持純 meta 系統、18 為獨立經濟入口、副作用可測可防重領。
- **B4 egg 來源**：①塔/遠征獎勵 + ③重複捕獲轉化 + 少量成就首領取；孵化進度＝「有效戰鬥完成數 + 塔層完成數加權」（**不用**真實時間/每日簽到/步數，避免手遊體力感）。防線寫死：egg 只存 `seed/source/speciesPool/progress/requiredProgress`，孵化才生成 OwnedUnit；不可付費、不可刷新池、不可存預生成結果。
- **B5 Ascension**：嚴守 §0.4 相位契約、**不新增專屬戰鬥規則**；所有難度修飾（Fate/負面/敵強化）打包成 `runModifier`，戰鬥初始化/S1 經 `ext` 注入（如 `ext.enemyHpMulti`）；meta 存解鎖階級（通關塔解鎖更高難）。零成本複用連勝塔基建。

## Backlog 更新（記下，暫不做）
12 全域跨場療傷（改做塔局內 modifier）、3 場地效果、4 狀態/關鍵字、7 隊長/覺醒、9 努力值EV、16 計時/王者連戰、17 每日任務、19 幽靈對戰/排行(需網路)、20 協力對戰(需即時網路)。

## 待設計階段定 / 玩測
特性效果池內容與數值上限、Grade 階級門檻、成就清單與發獎曲線、egg 進度權重與 speciesPool、Ascension 各階修飾與解鎖門檻。

## 三方立場
gemini/codex 一致換 12→18；gemini 主導 B1(反硬限疊加)/B2(Grade 零 buff)/B5(Ascension 純 runModifier)，codex 主導 B3(發獎走 action)/B4(egg 來源與經濟化防線)。無未解分歧。
