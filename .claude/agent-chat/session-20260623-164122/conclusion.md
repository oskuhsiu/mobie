# M14 戰鬥回放系統 — 圓桌結論（Claude + gemini + codex + mistral）

## 議題
把一場戰鬥「完全文字化」成可保存紀錄，並能用該紀錄完整回放（含聲光演出）。決定 canonical 紀錄的形態、版本化策略、分層落點、MVP 邊界。

## 四方立場與收斂
開場給三條路：(a) 事件流 canonical、(b) seed+輸入重模擬、(c) 混合。四方在第一輪即收斂到「事件流為視覺真相、header 一併記 seed+輸入鋪 golden-master」的務實混合，並在第二輪對「文字化」的真正語意達成全員 agree。

- gemini：力主 MVP 降載——(a) 為播放唯一真相，seed+輸入當 header metadata；快照最小化、嚴格切開引擎運算與 UI 渲染；整檔單一 formatVersion + 不可變文件 + 純 migrate；golden-master 推遲到 M8。
- codex：修正 gemini——seed+inputs 不能是「事後補的惰性 metadata」，必須從 v1 由單一 ReplayRecorder 單點產出，否則早期紀錄不可驗證。給出 DisplayUnitSnapshot 完整欄位清單。堅持 unknown-event fail-fast、optional 欄位不可成為逃生艙（新 event variant 仍須 bump 版本）。codec 輸出 deterministic/pretty、.json 回放 / .txt 戰報雙匯出，播放器只吃 .json。
- mistral：主張第一天就為混合打地基（避免後期大改）；eventToReportLine 設計成「一 event variant 一 handler + 依 type 分派」純函數鏈；提 battleId 去重、保留上限可設定。
- claude（主持+裁定）：點出全員默默假設 canonical=JSON、但使用者原話「文字化」可能指人類可讀戰報。釐清為兩條路並裁定 (ii)。最後砍掉兩個過度設計。

## 最終定案
1. canonical = 結構化 JSON log（非雙向文字 parser）：header{formatVersion, battleSeed, snapshot[雙方 DisplayUnitSnapshot], initialFieldState?} + turns[{input, events[], fieldEvents?}]。一個 resolveTurn 呼叫 = 一個 turn entry。
2. 人類可讀戰報 = 純投影：eventToReportLine(event) → 中文戰報文字行，唯讀、永不反向 parse。它才是「完全文字化」真正交付物，進 MVP。一 event variant 一 handler、依 type 分派；未知 variant 回退 [type] 行。
3. 版本化：整檔單一 formatVersion + 嚴格 decoder + unknown-event fail-fast + 純 migrate(vN→vN+1)。不要 per-event schemaVersion。僅預先宣告的 optional placeholder（fieldState/fieldEvents）享前向相容；真正新增 event variant 一律 bump 版本 + migration。
4. 單一 ReplayRecorder：從 v1 同時錄 seed + 完整玩家輸入(action/quality/mashCount/starStrike/switch index/defenseQuality) + 事件流。輸入進 header 供未來重模擬；事件流供視覺回放。
5. 分層：純 codec 住 game/replay/（比照 game/save/bundle.ts：pack/unpack + 分類錯誤 + 校驗）；持久化獨立 slice；播放器 UI 複用 BattleScreen 既有 event 消費器。
6. 載體：IndexedDB mz-replays（比照 mz-cards/mz-models），key = battleId(FNV-1a of seed+snapshot) 去重，FIFO 保留上限。只存 canonical .json；.txt 戰報於匯出時即時投影、不持久化（避免存 derived data）。
7. seeded RNG 前置：把 resolveTurn 的 rng 從預設 Math.random 接成 mulberry32(複用 individual.ts)，battleSeed 存開場 seed。reducer 內 rng 呼叫序敏感(命中→會心→支援輪盤→速度決勝)，呼叫序不變即可重現。

## MVP 邊界（M14）
做：seeded RNG 接線 + ReplayRecorder + ReplayCodec(formatVersion/嚴格 decoder) + eventToReportLine 投影器(涵蓋 M1–M7 既有 variant) + IndexedDB mz-replays slice + BattleScreen 掛載播放 + 回放清單/播放 UI + 決定論單元測試骨架。
不做（延後）：golden-master 重模擬比對的完整 UI 流程（留單測骨架，待 M8 引擎真的開始改時上）；i18n/多語戰報；手寫戰報造劇本(劇本編輯非回放，超範圍)。

## Claude 的兩個降規格裁定（砍過度設計）
- 不做 i18n 抽象層：自用單語(正體中文)遊戲、UI 全程硬寫中文無 i18n 框架，為戰報引入 locale 目錄是 YAGNI。handler 直吐中文。保留「一 variant 一 handler」結構即可。
- 不持久化 .txt：戰報是 .json 純投影，存它＝存 derived，違反「只存 canonical」戒律。只存 .json，.txt 匯出時即時生成。

## 未解 / 交由使用者
- 里程碑編號衝突：handoff 目前把 M14 排給「改名 mobie」收尾。本回放若取 M14，rename 應順延 M15（rename 定義上永遠最後、會動到所有碼含回放）。建議：回放=M14（排在 M8–M13 戰鬥機制大多落地之後、rename 之前，一次涵蓋完整 event 詞彙），rename=M15。待使用者拍板。
- 三方一致認為此架構「兼顧防禦力與務實落地」，無保留反對。
