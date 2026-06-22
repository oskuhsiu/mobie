# 意外機制 + 個體差異/成長性 設計結論（查證 Mezastar 機台 + 本傳）

三方（Claude/gemini/codex）2 輪達成完全共識（全員 agree）。

## 一、意外機制（取 Mezastar 招牌，貼 QTE+reducer，砍臃腫）
- 砍掉「畏縮」、不做完整異常狀態（硬控場在快節奏街機=挫折感，且讓 reducer 複雜化）。保留命中 + 會心(1/16, ×1.5)。
- 支援輪盤（隨機意外核心）：每隔 N 回合觸發，隨機給 攻擊UP / 必定會心 / 支援寶可夢補刀(隊上待命一隻打一下) / 摃龜。
- 捕獲球輪盤：精靈/超級/高級球 → 影響捕獲成功率（取代原本固定捕獲率）。
- 星擊 Finisher（延後一子步）：能量槽只由 QTE 表現 + 連鎖累積、不綁隨機（保留玩家可控感，非抽獎）；槽做極簡細條避免 UI 臃腫；滿了放自製大招「星擊」（無侵權，取代 Z/Dynamax/Terastal）。
- 攻擊 QTE = 攻擊輪盤 + 連打蓄力合一：timing 決定基礎倍率，停下接極短「連打蓄力」色階加成(red→rainbow)。
- 所有隨機點由 reducer 注入的 rng 決定、輸出 domain event；隨機事件統一格式 `{type, actorId, roll, outcome, source}`（支援輪盤/球輪盤/命中會心/IV-nature roll 共用一套測試與戰鬥 log）。

## 二、個體差異 / 成長性（照本傳落地）
- 每隻（自有/野生）用 seed（自有=cardId、野生=遭遇seed）決定論 roll IV(0-31/項) + 性格(25種, ±10%)，併入能力值公式（現有 IV 管線 + 補 nature 乘數）。
- 成長：勝利得 EXP（依被擊敗者等級），用 Medium Fast `n^3` 升級重算能力值。
- UI：星級 IV(1-5星/評價字)、性格名 + 能力值紅(加)藍(減)色標、異色、等級/EXP 條；0-31 細節放長按/debug（休閒玩家不需看數學，保街機爽感）。

## 三、資料模型 / 持久化
- OwnedUnit（canonical，持久化）：`{ id, speciesId, level, exp, ivs, nature, seed, shiny }`。
- BattleUnit（派生，不持久化）：戰鬥用 stats + 暫時 modifier（支援UP等）。
- PersistenceAdapter 介面：現在用 localStorage 墊檔（只存 canonical OwnedUnit roster+exp），M2 無痛換 Dexie/IndexedDB。
- 護欄：Adapter 只存 canonical OwnedUnit，不存 derived stats / battle modifiers / 輪盤結果 / RNG 中間態（保持 Dexie 遷移與重播測試乾淨）。

## 四、開發切分（疊在 M1.5a–d 之後）
- M1.5e 個體差異：seeded IV/性格 + nature 公式 + 個體 UI（星級/紅藍色標）。
- M1.5f 成長：EXP/升級(n^3) + PersistenceAdapter(localStorage) + roster 持久化。
- M1.5g 意外：支援輪盤 + 球輪盤 + 連打蓄力（reducer 隨機點 + 統一 event + UI）。
- M1.5h 星擊：QTE/連鎖累積能量槽 + 大招演出（延後）。

## 五、各方立場與分歧收斂
- 砍畏縮、Persistence Adapter+localStorage、IV 用星級不顯示 0-31：三方一致。
- 唯一分歧「星擊來源」：gemini 主張併進支援輪盤(省 UI)，codex 主張綁 QTE 技術不綁隨機。→ 採 codex（保留可控感），並以「延後 + 極簡槽」化解 gemini 的 UI 顧慮。

## 六、未解 / 後續
- 支援輪盤觸發頻率 N、各獎項權重需玩測平衡。
- 星級 IV 的分級門檻（IV 總和 → 1-5 星對應）需定義。
- EXP 取得量公式（依被擊敗者等級）需定參數。
