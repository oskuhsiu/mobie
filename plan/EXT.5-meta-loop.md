# EXT.5 — 養成 meta loop（貨幣 / 商店 / 任務每日）

> 上層真相＝[`EXT.0`](EXT.0-enhancement-report.md)。後段里程碑（排在視覺梯 B 與 A1 之後）。
> **範圍**：A2 貨幣＋商店、A3 任務/每日目標，綁成一個閉環。**不碰戰鬥 reducer**——純 store slice ＋ UI ＋ 結算掛點。
> **定調（agent-chat）**：5 歲兒童延遲滿足弱，故 meta 後置；但它是「session 間拉力」的長線價值，值得做。

---

## 1. 閉環設計
```
打贏/捕獲/完成任務 → 賺幣 → 商店買（寶貝球/孵蛋道具/持有道具/造型素材）→ 每日任務給新目標 → 回到戰鬥
```
- **貨幣**：戰後結算發放（贏＞輸；首勝/捕獲加成）。單一軟貨幣，避免兒童被多幣搞混。
- **商店**：花幣買既有系統的消耗品——球（提升捕獲演出/既有機率不被 meta 偷改）、孵蛋/道具（接 `bagStore` 既有 `mz.itembag.v1`）。
- **任務/每日**：純資料任務表（`捕一隻火系 / 連勝3 / 用星擊收尾 / 孵一顆蛋`）；達成偵測掛在**既有 event/結算**，達標給幣/道具。

## 2. 紅線
- **不碰 reducer/engine**：任務達成偵測只 **consume** 戰後結算與既有 domain event（不新增戰鬥規則）。
  捕獲機率等**戰鬥/捕獲數值不被經濟系統偷改**（買「好球」只改演出/既有 ball 類別，不暗改難度——延續 plan/22「UX 不當隱性難度開關」鐵律）。
- **持久化**：新 store slice 自成 namespace（仿 `bagStore` 的 `mz.itembag.v1`）：`mz.wallet.v1`（貨幣）、`mz.quests.v1`（任務進度/每日種子）。
  **不污染 canonical roster**（`mz.roster.v2` 只存 OwnedUnit）。
- **每日**：每日刷新用**日期種子**（非 `Math.random`，與專案決定論一致）；跨時區/補登行為要明確（離線也能玩，不卡網）。
- **存檔**：`.save` 目前未含 itembag/meta 等 slice（handoff 已記的 follow-up）；EXT.5 落地時**順手把 wallet/quests 納入 `.save` bundle**（補齊既有缺口）。

## 3. 子里程碑
- **EXT.5.a — 貨幣地基**：`store/walletStore.ts`（`mz.wallet.v1`，純函式可測的 earn/spend）＋ 戰後結算發放（接 `rosterStore.grantBattleExp` 同一結算點）＋ HUD 顯示。
- **EXT.5.b — 商店**：`ShopModal`（複用 ToolsMenu 入口；花幣買球/道具→寫 `bagStore`）；經濟初值表（純資料，可調）。
- **EXT.5.c — 任務/每日**：`game/quests.ts`（純任務定義＋達成判定）＋ `store/questStore.ts`（`mz.quests.v1`，每日種子刷新）＋ `QuestsModal`＋達標領獎。
- **EXT.5.d — 存檔納入**：把 wallet/quests slice 加進 `save/bundle.ts` 的 pack/unpack（補 handoff follow-up）＋ round-trip 測試。

## 4. 落點檔案
- 新增：`src/store/walletStore.ts`、`src/store/questStore.ts`、`src/game/quests.ts`（＋ tests）、
  `src/ui/components/ShopModal.tsx`、`src/ui/components/QuestsModal.tsx`。
- 修改：`src/store/rosterStore.ts`（結算點發幣，或在 BattleScreen 結算處呼叫 wallet）、`src/ui/components/ToolsMenu.tsx`（商店/任務入口）、
  `src/game/save/bundle.ts`＋`saveIO.ts`（納入新 slice）、HUD。
- **不改**：`reducer.ts` / `engine.ts` / `game/data/*` generated。

## 5. 驗收
- 閉環可玩：打贏得幣 → 商店花幣 → 任務達標領獎 → 每日刷新。
- 純函式（earn/spend/任務判定/每日種子）走 vitest；經濟不可變負、每日刷新決定論。
- **捕獲/戰鬥數值回歸**：開啟 meta 後，同 seed 戰鬥與捕獲機率**與關閉時相同**（經濟不偷改難度）。
- `.save` 含 wallet/quests 的 round-trip 綠燈。typecheck/test/build 全綠。

---

## 6. backlog（不進 EXT.5 MVP）
- 慣用手切換（C4 後半，UX prefs）。
- 成就/圖鑑與任務的交叉獎勵。
- 經濟平衡長線調參（先給可調資料表，數值留待實玩回饋）。
