# 圓桌結論 — 延伸系統選 5（可模組化、可選式掛載）

## 任務
從 20 個「類卡牌戰鬥遊戲特點」候選中，挑出最適合 pokemon-mezastar 做成「可模組化、可選式掛載」延伸系統的 5 個。判準：工程落地乾淨度（關掉零殘留、不破壞純 reducer / 只存 canonical OwnedUnit 兩大不變式）＋ 自用單人遊戲的實際樂趣增益。

## 各方立場演進
- **Claude（開場）**：主張 1 道具、5 連鎖、8 進化、13 連勝塔、**11 圖鑑成就**。
- **gemini**：認同 5/8/13 骨架，但主張 **11 圖鑑成就 → 換 6 隊伍羈絆**（6 是「最乾淨掛載」極致：開場一個純函數 `(Roster)→Modifiers`，完全不碰持久化、拔掉零殘留；11 僅是 OwnedUnit 的 derived view，當獨立系統太單薄）。提醒 1 道具的庫存/裝備對 canonical 侵入比預期大。
- **codex**：接受 11→6，但加嚴：6 必須做成**可視化 team tags / synergy rules**（否則隱形加成＝低存在感數值膨脹）；12 跨場療傷不放前 5（除非限定為連勝塔 run 內 overlay，禁止寫全域 OwnedUnit.currentHp/restingUntil）；1 道具可接受但 heldItemId 為 canonical 槽、庫存放 module save slice、reducer 只吃 resolved modifier。

## 共識（三方一致）
**選出的 5 個**：
1. **1 持有道具（Held Items）** — 戰前養成
2. **5 連鎖攻擊（Chain Attack）** — 戰中爽度（Mezastar 招牌）
3. **6 隊伍羈絆（Team Synergy）** — 戰前組隊深度（最乾淨掛載）
4. **8 進化（Evolution）** — 戰後成長回饋
5. **13 連勝塔／遠征（Roguelike Run / Tower）** — 長線重玩，串起以上全部

→ 鋪成「戰前(道具+羈絆) / 戰中(連鎖) / 戰後(進化) / 長線(連勝塔)」一條龍。

**Backlog（記下，暫不做）順位**：`11 圖鑑成就 > 12 全域跨場療傷 > 15 難度修飾(Ascension)`。15 應依附連勝塔成熟後做（當塔的二階變體最安全）。其餘 2/3/4/7/9/10/14/16/17/18/19/20 一併留 backlog。

## 鎖定的設計護欄（進設計階段的硬前提）
- **1 道具**：`OwnedUnit.heldItemId` 為 canonical 單欄裝備槽；背包庫存放**獨立 module save slice**（不塞 OwnedUnit）。效果**只允許三類**：stat modifier / damage hook / once-per-battle trigger。中斷型效果（致命傷消耗道具回血等）必須收斂到傷害結算最後段一個**同步** `applyItemTriggers` 階段——禁止 async/callback/reducer 重入。禁用模組＝忽略該槽。
- **5 連鎖**：reducer 只核發 `CHAIN_OPPORTUNITY`（連鎖資格），前端 XState 接管連續 QTE 演出與收集，最後以**單一** `SUBMIT_CHAIN_RESULT` action 打回 reducer 做最終結算（杜絕 UI/reducer 脫節與重入）。禁用＝不出現連鎖提示。
- **6 羈絆**：純函數 `computeSynergy(team)→NamedModifier[]`，只在「戰鬥初始化 / 編隊變更」**單次**呼叫、拍板成扁平靜態 `BattleModifiers` 注入。所有 modifier **必須帶 `label/source/icon` 可回顯**（禁止隱形加成）。拔掉零殘留。
- **8 進化**：只替換 `species / base stats / artwork URL`，**個體欄位全保留**（IV/EXP/nature/seed/shiny/heldItemId 不變）；招式維持單一專屬（守 Mezastar 單招，不因進化解鎖新招）。觸發以**等級為主**（最少互動成本）。可選關掉＝不檢查觸發。
- **13 連勝塔**：獨立 `RunState` 容器（層數/路線/暫時增益/run 內 HP），**絕不**回寫全域 roster persistence；戰鬥載入時 `OwnedUnit + RunModifiers → BattleUnit` 合成、run 結束只結算獎勵、暫態即丟。可收編「傷病/療傷」為 run 內 overlay（救回 backlog #12 的點子而不污染全域）。

## 未解 / 待設計階段定的點
- 連勝塔的節點型別（戰鬥/事件/營火/商店）要做到哪一層、地圖是否用決定論種子產生。
- 羈絆規則集合（哪些 tag、加成數值）與道具池（自製、不侵權）的具體內容與平衡，留設計+玩測。
- 進化鏈資料如何併入既有 `gen_dex.mjs` 產生器（PokéAPI evolution-chain endpoint）。
- 「可選式掛載」的統一機制：是 feature-flag config 還是 module registry —— 設計階段需給一個一致的掛載/卸載介面。
