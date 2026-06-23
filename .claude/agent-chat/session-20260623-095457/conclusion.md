# 圓桌結論 — 延伸系統第二批設計審查（plan/10）

## 任務
審查第二批 5 系統（2 特性 / 10 Grade / 11 圖鑑成就 / 15 Ascension / 18 孵化）設計，抓漏洞與不變式風險。三方完全共識（末輪 codex agree、gemini 認定「無懈可擊」）。

## 共識裁決（已全數回寫 plan/10）
- **R1 特性 onSwitchIn**：**不是** S4 新 timing（放回合末是錯置）。改為在「主動換人/強制換/開場放第一隻」的**換人解析步驟內立即同步結算**（chain-link，「換人＝原子操作」，狀態當下刷新、下一行動者讀到新狀態）。**bounded/non-reentrant**：onSwitchIn 不得再觸發換人（杜絕遞迴/多次 fire）。「換上即倒」時 onSwitchIn 仍先 fire。
- **R2 Grade**：不為 Grade 加 `origin` 欄。只由 `shiny + IV tier + species 靜態稀有度`（已存在/靜態資料）派生，否則「零新欄」是假的。仍零 buff 純展示。
- **R3 圖鑑雙真相**：進化改 speciesId 會讓 roster 派生的 owned 倒退。三層語義：`currentlyOwned`(roster 即時派生) / `registered`(meta 單調遞增「曾捕獲」，進化不倒退) / `seen`(meta) + stats(meta)。非雙真相（歷史登錄≠當前擁有）。
- **R4 孵化決定論 + 重複轉化**：egg 存 seed 不算「預生成 OwnedUnit」（合 B4，防 save-scum）。重複轉蛋只在捕獲結算點處理本次新候選、以 `registered.has(speciesId)` 判定、給玩家 keep/convert 明確選擇，**絕不刪既有個體**。
- **R5 Ascension 注入**：reducer 絕不認識「難度倍率」。靜態敵人強化（enemyHpMulti/enemyLevelBonus）**pre-bake 進 encounter/buildUnit base stats、不進 reducer**；只有影響回合演算的修飾（playerHealReduced/Fate）才走 `ext`。

## round-2 最終加固
- **`pendingCaptures` 持久化 reward transaction**（gemini 提、codex 收斂）：捕獲候選進入 keep/convert UI 前先寫 meta/save（`pendingCaptureId + resolvedCandidate + reward id + choices`），**exactly-once consume**，重啟只復原同一候選、不可重抽 seed/重複領獎。防玩家在抉擇時強關遺失高 IV/shiny。不違反 B4（已過捕獲結算點）。
- **onSwitchIn bounded/non-reentrant**（codex）：入場效果不可再觸發換人，避免遞迴或同一單位多次 fire。

## 機制複用驗證
本批幾乎不需新縫：特性複用道具的 S1/S3/S4 +「換人解析內同步」onSwitchIn；Grade 純派生無縫；圖鑑/孵化只加 meta/incubator 兩個獨立 slice（S8）；Ascension 拆 pre-bake + ext，零新縫。證明 wave-1 的掛載機制可延展。

## 落地順序（定案）
M6.f Grade（最乾淨先做）→ M6.g 特性 → M6.h 圖鑑成就 → M6.i 孵化（含 pendingCaptures）→ M6.j Ascension。各依賴見 plan/10 §7。

## 三方立場
gemini：抓 R1 錯置 + R5 必須 pre-bake + 提出 pendingCaptures 防資料遺失。codex：擋 R2 假零欄 + 修 R3 進化倒退（三層語義）+ R4 不刪既有個體 + 收斂 pendingCaptures 成持久 transaction + onSwitchIn non-reentrant。Claude：彙整回寫。無未解分歧。
