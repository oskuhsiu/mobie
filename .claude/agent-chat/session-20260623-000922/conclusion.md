# 結論：pokemon-mezastar code review 兩個判斷題

三方（claude / gemini / codex）一輪即達成共識，無未解分歧。

## Q1 — 載入存檔的健全性檢查：改（採最小邊界防護）

- 共識：在 `LocalStorageAdapter.loadRoster()` 載入時加一層守門：
  - 丟棄 `speciesId` 不存在於 dex 的單位；
  - clamp `level`→1..100、每項 `iv`→0..31、`nature`→0..24、`exp`→>=0（且 level 與 exp 一致）。
- 不做：完整 schema 驗證 / 把 localStorage 當不可信外部輸入大做文章。
- 理由（三方一致）：唯一寫入者雖是遊戲自己，但 `speciesId` 無效會讓 `getSpecies()` 回 undefined、後續 `.baseStats` crash；因為壞檔已存，重開仍持續 crash（死迴圈），iPad PWA 下使用者幾乎只能手動清 localStorage。這是最致命且最難 debug 的失敗類別，約 15 行成本即可擋掉，性價比高。

## Q2 — 能量/QTE 調校常數位置：不改（留在 UI）

- 共識：`QUALITY_ENERGY` / `energyGain()` 維持在 `ui/screens/BattleScreen.tsx`。
- 理由（三方一致）：星擊能量是重度依賴點擊與畫面表現的手感 juice 參數、非戰鬥結果的領域真理，無單測需求，且目前只有 BattleScreen 單一消費者。架構規定的是「依賴方向 ui→store→game」，UI-only 常數放在 UI 並不違反；硬下沉只是形式分層、徒增跨層耦合，也不利於邊玩邊調。
- 未來再評估的觸發條件（codex）：出現非 UI 的戰鬥模擬、需要固定能量模型的單測、或多個 battle presenter 共用其一時，再下沉到 `game/engine`。

## 後續行動
實作 Q1 的最小 sanitization、保留 Q2 現狀，跑 typecheck + test + build 後 commit。
