# 戰鬥升級結論：3v3 + 主動換人 + 聲光（完成 M1 戰鬥）

三方（Claude / gemini / codex）3 輪達成完全共識（全員 agree）。

## 一、隊伍與勝負（共識，已查證對戰常識）
- **格式澄清**：3對3 ＝ 單打（Single Battle），**一位訓練家一場出動 3 隻、同時只有 1 隻在場、可換人**（查證 Bulbapedia，見 `plan/06-battle-reference.md`）。
- player 3 vs 對手 3，經典「倒下→換下一隻」依序對戰。
- 擊倒對方全部 3 隻即勝；捕獲只在擊敗最後一隻（視為 boss）時觸發。
- HP 跨換人持續、不自動回復。
- 戰鬥數值（傷害公式/相剋/會心/狀態/能力值）一律以 `plan/06-battle-reference.md` 查證版為準，MVP 簡化處該檔已逐項標註。

## 二、換人規則（最大爭點 → 收斂為「防禦 QTE」）
三方原本三種立場：
- Claude：經典，主動換人耗整回合、換上的挨一擊。
- gemini：街機感，免費換 + 冷卻 2 回合、換上可立即攻擊。
- codex：折衷，換人耗半回合 + 換上時打**防禦 QTE**。

**定案採 codex 的防禦 QTE**（同時解掉 gemini 的節奏顧慮——換人當下玩家在做 QTE、手在動有張力，不是呆站一回合）：
- 主動換人＝戰術動作：收回 → 放出新寶可夢 → 對方立刻對「換上的」攻擊一次，玩家打一個**防禦 QTE** 抵減。
- 防禦 QTE 數值（保守）：perfect=減傷 90%（近乎閃避）、good=60%、normal=30%、weak=0%。共用 `qualityFromPointer` 種子。
- 該回合玩家不能攻擊，下回合恢復。防濫用：每回合最多換一次、剛換上不能立刻再換回。
- 被擊倒＝免費強制換（無防禦 QTE）。
- **Edge case**：換上的若仍被該擊打倒 → 立即進入強制換人（列入測試）。
- 結果：QTE 系統長出兩種模式——攻擊 QTE（最大化輸出）/ 防禦 QTE（最小化受傷），同一 input seam。

## 三、回合 / UI 流程（共識）
- 行動選單：攻擊（走攻擊 QTE）/ 換人（開隊伍面板 → 選人 → 防禦 QTE）。
- 底部常駐隊伍 tray：3 隻 HP pip + 倒下灰階。
- 對手 AI：普通攻擊、倒下換下一隻；先不做 AI 主動換人。

## 四、聲光效果（共識）
### 視覺
- **FxCanvas**：一層 imperative canvas 2D 粒子層（不過 React state），畫各屬性受擊粒子（火爆/水花/電火花）、攻擊軌跡、會心強調、倒下淡出。
- **framer-motion**：角色位移、螢幕 shake、受擊 flash。
- 兩者解耦；M3 上 R3F 時可替換粒子層。
- 換人動畫：收回＝縮入光束回球；放出＝開球閃光放大。

### 音效（堅持零侵權資產）
- **Tone.js** 全程序化 preset（命中/倒下/選取/效果絕佳/低血量嗶 + chiptune BGM loop），零樣本。
- 包在 **`audioEngine` 介面**後（戰鬥邏輯不綁庫）：`unlock()`（iOS 首次觸控解鎖 AudioContext）、`play(sfxId)`、`setIntensity(level)`。
- **Tone.js 在 unlock 時才動態 import**，控制 PWA bundle 體積。
- `setIntensity` 用於 BGM 交叉淡入 / 低血量警報，不停 transport loop。

## 五、架構重構（共識）
- battleStore 由單體 player/foe → **party 陣列 + activeIndex（雙方）**；新增換人 / 強制換 / 全滅判定。
- **回合解算抽成純 reducer**：`resolveTurn(state, action) → { nextState, events[] }`。
  - `action`：攻擊QTE(quality) / 換人(index + 防禦QTE quality)。
  - `events` 是 **domain events**（`damageApplied` / `memberFainted` / `activeChanged` / `switchDefenseResolved` / `battleEnded`），**不含任何 UI/動畫字眼**，純函數可單測。
- BattleScreen 維護獨立 **display state**，把 events 映射成「動畫 + 音效 queue」依序消費，每步 await framer-motion / FxCanvas callback 再前進（reducer 一次算完、畫面慢慢演，解耦不互相污染）。
- 新增 `audio/`、`scene/fx/`、`game/battle/reducer.ts`。engine.resolveAttack（mon vs mon）維持不變。
- cardSelect 改成多選 3 隻組隊。

## 六、里程碑（完成 M1 戰鬥，每步可玩）
- **M1.5a**：隊伍模型 + 3v3 依序 KO 換 + `resolveTurn` 純 reducer 測試。
- **M1.5b**：主動換人 + 防禦 QTE + 隊伍 UI tray（含「換上即倒→強制換」測試）。
- **M1.5c**：FxCanvas 視覺特效 + framer-motion shake/flash + 換人動畫。
- **M1.5d**：Tone.js audioEngine（SFX + BGM + iOS 解鎖 + intensity）。

## 七、未解 / 後續驗證
- Tone.js 動態載入後的首音延遲（iOS 解鎖時機）需實測。
- 防禦 QTE 數值平衡需玩測微調（90/60/30/0 為起點）。
- BGM intensity crossfade 在 iPad Safari 的表現與電量。
