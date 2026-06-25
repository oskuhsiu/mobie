# EXT.2 — 星擊電影化

> 上層真相＝[`EXT.0`](EXT.0-enhancement-report.md)。依賴＝[`EXT.1`](EXT.1-in-battle-juice.md) 的 `cinematicCoordinator`（§6）。
> **範圍**：B2——把星擊 finisher（情緒峰值）從「單擊放招＋orb 特效」升級成 **letterbox ＋ 慢動作 ＋ 運鏡 ＋ 全螢幕 cut-in**。
> **一句話**：Mezastar 風格的核心賣點是終極技的儀式感；本檔讓星擊變成兒童的記憶點，全程純 display、`runStarStrike` 簽名不動。

---

## 1. 定位（承 EXT.0「架構同梯、交付分梯」）
- EXT.1 已鋪 `cinematicCoordinator`（`pause/resume` 實作、`cutIn` stub）。**EXT.2 只填 `cutIn` 與運鏡**，不重構。
- 星擊現況：star-orb `onClick → runStarStrike()`；energy 滿才可放，傷害 `STAR_STRIKE_MULT=3`、必會心（reducer 既有）。
- **純度鐵律**：`runStarStrike` 簽名與星擊傷害**完全不動**；cinematic 只是「放招前後的演出包裝」。
  若日後想讓蓄力影響特效強度，走 display 層 FX intensity，**不進 reducer**（同 plan/22 §2.2 既有裁定）。

---

## 2. 演出設計（純原創資產，零侵權）
1. **進場**：偵測星擊觸發（star-orb 確認放招的當下）→ `coordinator.cutIn(...)`：
   - **letterbox** 上下黑邊滑入（CSS，低頻）＋背景去飽和/暗化。
   - **慢動作**：演出時鐘降速（coordinator 內部 rAF 時鐘，疊在 EXT.1 hit-stop 之上）。
   - **運鏡**：對施放者 plate 推近（transform scale/translate；3D 路徑可動 R3F 相機，billboard 路徑動 CSS）。
   - **全螢幕 cut-in**：施放者大頭像（PokéAPI artwork，已是 runtime URL）＋招式名（`resolvedMoveId` 帶出）＋
     per-type 光影特效（複用 `fxCatalog` typePalette；爆發用 `FxCanvas.burst/ring/flash`）。
2. **命中**：放大版 hit-stop（複用 EXT.1）＋ `HAPTIC.crit` 強震＋專屬星擊音色（Tone.js）。
3. **退場**：letterbox 收起、時鐘回速、相機歸位 → `coordinator.resume()` → 接既有 `damageApplied` 演出。

> **安全退場**：cut-in 期間若被中斷（切背景/逾時）→ coordinator 保證 `resume()` 必被呼叫，演出絕不卡死
> （比照 plan/22 手勢「中斷/逾時安全退場」契約）。

---

## 3. 落點檔案
- 修改：`src/ui/screens/battleCinematic.ts`（填 `cutIn` 實作）、`src/ui/screens/BattleScreen.tsx`（星擊觸發點包 cutIn）、
  `src/ui/components/StarStrikeGestures.tsx`（與 lite/arcade 蓄力手勢的銜接：手勢完成 → cutIn → runStarStrike）、
  `src/ui/styles/global.css`（letterbox/cut-in keyframes、用 flex 置中避免 EXT.1.e 的漂移坑）、
  `src/scene/r3f/BattleStage.tsx`（3D 路徑的相機推近，選配）。
- **不改**：`reducer.ts` / `engine.ts`（`runStarStrike`/`STAR_STRIKE_MULT` 一字不動）。

---

## 4. 與增強互動性（plan/22）的關係
- plan/22 的 `starStrike` surface（lite＝長按蓄力環、arcade＝節奏三連點）負責「**輸入**」；本檔負責「**輸出演出**」。
- 兩者正交且互補：手勢完成 → 觸發 cinematic → `runStarStrike`。`enhancedInteractivity.mode==='off'` 時仍單擊放招，
  但 cinematic **照演**（cinematic 受 `juice` 而非 `enhancedInteractivity` 控制；`juice:'off'` 才回退單純 orb）。

---

## 5. 驗收
- `juice:'full'`：星擊全套 letterbox/慢動作/運鏡/cut-in CDP 真機抽驗；中斷/逾時必 `resume`、不卡死。
- `juice:'off'`：回退到 M22 的單純 orb 放招（無 cut-in），DOM 與舊版一致。
- 同一 seed 戰鬥：星擊傷害與 `nextState` 與 EXT.1 前**完全相同**（cinematic 不改戰果）。
- typecheck / test / build 全綠。
