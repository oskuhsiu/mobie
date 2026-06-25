# EXT.4 — 狀態異常 module（statusAilments）＋ 頭目階段 rider

> 上層真相＝[`EXT.0`](EXT.0-enhancement-report.md)。**這是 EXT 系列唯一會動 reducer/engine 的計劃**，故純度設計最關鍵。
> **範圍**：A1 中毒/灼傷/麻痺/睡眠/冰凍，做成 `modules.statusAilments`（預設 off、零殘留）；A4 頭目多階段為其 rider。
> **定調（agent-chat 全體）**：不走 prefs（它改規則語意）；狀態資料放 battle state、與 OwnedUnit 解耦不持久化；
> 所有 tick/傷害/恢復/跳行動由 **deterministic turn phase 發 event**，禁 UI timer / 外部 random 回寫；
> off 時 reducer case 完全跳過、關閉時清空狀態態。

---

## 0. 命名警示（避免撞名既有型別）
`FieldState` 已有 `StatusEffect`（M19.d）＝**能力值增益**（atk/def/spa/spd × mult），**不是**異常狀態。
本檔的中毒/灼傷… 一律稱 **ailment**，型別命 `Ailment` / `AilmentState`，**不得**重用 `StatusEffect`。

---

## 1. 純度路徑（核心設計）

異常狀態有兩類行為，掛點不同：

| 類 | 例 | 何時生效 | 既有 seam 夠嗎 |
|---|---|---|---|
| **持續型（DoT/回合末）** | 中毒、灼傷（每回合末扣血） | 回合末同步段 | ✅ **S4 `turnEndTrigger` 直接夠**——回傳 `damageApplied` 風格 event，**engine/reducer 零改** |
| **行動阻斷型** | 麻痺(機率不能動)、睡眠/冰凍(數回合不能動) | 回合中、解算行動**前** | ❌ 現有 S1/S3/S4 都不覆蓋「否決/改寫行動」 |

→ 故切兩階：**EXT.4.a 只做持續型（零新 seam、零 engine 改）**；**EXT.4.b 才加新 seam 處理行動阻斷型**。
這讓「每里程碑可玩」：4.a 上線就有中毒/灼傷的戰術，4.b 再補麻痺/睡眠/冰凍。

### 1.1 ailment 狀態住哪
- 新增 `BattleState.ailments`（或 `field.ailments`）：`Record<\`${Side}:${index}\`, AilmentState>`，戰鬥內暫態。
  ```ts
  export interface AilmentState { kind: 'poison'|'burn'|'paralysis'|'sleep'|'freeze'; remaining: number; meta?: {...} }
  ```
- **零殘留鐵律**：module off（`ext.ailments` undefined）→ 此欄恆空、所有 ailment case `if (!enabled) return state` 完全跳過；
  關閉模組時清空。**不持久化**（不進 OwnedUnit / save）。

### 1.2 施加 ailment（需要 post-attack 掛點）
- 「某招命中後賦予中毒」發生在傷害結算**後**。現況**無** post-damage/post-attack seam（ARCHITECTURE §6「Deferred」已列：
  氣勢披帶 post-damage 縫、威嚇 onSwitchIn 縫——刻意延後）。
- **EXT.4 順勢補上 `postAttack` seam（S 系列擴充）**：`(ctx) => BattleEvent[]`，reducer 在 `damageApplied` 後呼叫；
  default `EMPTY_EXT` 無此 hook ＝ 行為與今日一字不差。**一併解鎖氣勢披帶/post-damage 類延後項**（額外紅利）。
- 招式→ailment 對映走**模組內純查表**（`ailmentForMove(moveId)` 或依 move metadata 推導，比照 abilities 的
  `abilityForType`），**不手改 generated `moves.ts`**。

### 1.3 行動阻斷（EXT.4.b 新 seam `actionGate`）
- 新 `actionGate` seam（S 系列擴充，注入 ExtBundle）：reducer 解算某方行動**前**呼叫
  `actionGate(ctx) → { skip: boolean; events: BattleEvent[] }`；`skip` → 該方本回合行動作廢（發 `ailmentBlocked` event）。
- reducer 仍**不認識**「睡眠/麻痺」——它只認識「有個 gate 可能否決行動」（泛化縫，同 turnEndTrigger 模式）。
  睡眠回合遞減、麻痺擲骰（用**注入的 rng**，非外部 random）全在模組的 gate 內，deterministic、可回放。
- default `EMPTY_EXT` 無 gate ＝ 永不 skip ＝ byte-for-byte M1.x。

---

## 2. 新增 BattleEvent 變體 ＋ 回放耦合治理（重要）
- 新 event：`ailmentApplied` / `ailmentTicked`（DoT 扣血，亦可複用 `damageApplied` 的 source 標記）/ `ailmentCured` / `ailmentBlocked`。
- ⚠️ **耦合治理**（ARCHITECTURE §7.2 / plan/15）：`BattleEvent` union 一加變體，replay 的
  `KNOWN_EVENT_MAP`（`Record<BattleEvent['type'], true>`）**會編譯失敗**，直到下列全部更新：
  `replay/codec.ts`、`replay/report.ts`（每變體一個中文戰報 handler）、`REPLAY_FORMAT_VERSION` ＋ `migrateReplay`（bump 版本）。
  **這是設計上的好事**（強制同步），EXT.4 驗收必含「replay round-trip 綠燈」。

---

## 3. 子里程碑
- **EXT.4.a — 持續型 ailment（零新 seam）**：`modules.statusAilments` 註冊 S4 `turnEndTrigger`（中毒/灼傷回合末扣血，
  發 ailment event）＋ `ailments` battle 欄 ＋ 模組內施加查表（先用既有可掛點施加，或先以「開場/特定招」最小施加）。
  engine/reducer 主體不改（只加 off-gated 的 state 欄與 event 變體＋回放同步）。**上線即可玩**。
- **EXT.4.b — 行動阻斷 ailment（加 `actionGate` ＋ `postAttack` seam）**：麻痺/睡眠/冰凍；新增兩 seam，
  default 空＝零殘留；rng 走注入。施加改走 `postAttack`（招命中後賦予）。
- **EXT.4.c — 頭目階段 rider（A4）**：`encounterProfile` 加 HP 門檻 → reducer 在跨門檻時發 `phaseChanged` event tag；
  視覺（EXT.1/2 演出層）與招式/ailment 消費它（如「暴怒」加 ailment 施加率）。**不開 boss 專用 reducer 分支**——
  只是 encounterProfile 的資料 ＋ 一個泛化 phaseChanged event。

## 4. 落點檔案
- 新增：`src/game/ext/ailments.ts`（`Ailment`/`AilmentState`/`ailmentForMove`/S4＋actionGate＋postAttack hooks）、
  `src/game/ext/ailments.test.ts`。
- 修改：`src/game/ext/seams.ts`（加 `actionGate`/`postAttack` 型別 ＋ ExtBundle 欄 ＋ `EMPTY_EXT` 補空）、
  `src/game/battle/reducer.ts`（`ailments` state 欄、新 event 變體、行動前 gate 呼叫、damageApplied 後 postAttack 呼叫；
  **全部 off-gated**）、`src/game/settings.ts`（`MODULE_IDS` 加 `statusAilments`）＋ seams.ts 的 `ModuleId` union、
  `src/store/ext.ts`（`assembleExt` 納入 ailments）、`src/game/replay/{codec,report}.ts` ＋ `REPLAY_FORMAT_VERSION`/`migrateReplay`、
  `src/game/encounterProfile.ts`（A4 phase thresholds）、`SettingsModal`（模組開關）、`MobCard`/battle plate（ailment 徽章顯示）。
- **不改**：`game/data/*` generated（招式→ailment 走模組查表）。

## 5. 驗收
- **off**（預設）：`assembleExt` 不含 ailments → `simulation.test.ts` 全場與「modules 全 off」**byte 一致**（零殘留鐵律）；
  DOM 無 ailment 徽章。
- **on**：中毒/灼傷回合末扣血正確、麻痺/睡眠/冰凍跳行動正確、施加/治癒/解除流程正確；全程**只用注入 rng**（決定論）。
- **回放**：含 ailment event 的戰鬥 encode→decode round-trip 綠燈；戰報投影每變體有中文 handler；版本 bump＋migrate 測試。
- `simulation.test.ts` 擴充：on 模式數百場 seeded battle 仍 HP 有界 / 無 NaN / 必終止 / 決定論。
- typecheck/test/build 全綠。

> **本計劃定位＝design spike ＋ 最小實作**（agent-chat 用語）：4.a 先落地最小可玩，4.b/4.c 漸進。寧可分階上線，不一次吞下整套。
