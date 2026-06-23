# 15 — 戰鬥回放系統（M14 Battle Replay）

> 四方圓桌（Claude/gemini/codex/mistral）收斂，結論 `.claude/agent-chat/session-20260623-164122/conclusion.md`。
> 需求（使用者原話）：把一場戰鬥**完全文字化**成可保存紀錄，並能**用這些文字記錄完整回放**（含聲光演出）；
> 並接受「**戰鬥相關的修改都會動到回放**」這個耦合。
> 本檔定義 canonical 紀錄形態、版本化、分層落點、MVP 邊界，以及把上述耦合「治理」起來的方法。
> **掛載前提**：複用既有兩半架構——純 reducer 吐有序 domain events（`reducer.ts`）、`BattleScreen` 逐一消費演出。
> 回放幾乎是把「events 從 live 改成 from-log」。

---

## 0. 一句話定位
- **canonical 回放紀錄＝結構化 JSON log**（事件流 + header 含 seed/輸入），**不是**人類手寫的戰報文字。
- **人類可讀戰報＝純投影**（`eventToReportLine`），唯讀、由 log 投影產生，**永不反向 parse**。
- **視覺回放＝把事件流餵回 `BattleScreen` 既有 event 消費器**，所見即所存（版本獨立）。
- **seed + 完整玩家輸入**一併錄進 header，供未來「重模擬 = 引擎決定論回歸測試」（golden-master），M14 只放單測骨架。

---

## 1. 回放模型抉擇（圓桌核心）

開場給三條路，四方第一輪即收斂、第二輪全員 agree：

| 模型 | canonical | 優點 | 致命傷 | 裁定 |
|------|-----------|------|--------|------|
| (a) 事件流 | events | 版本獨立、所見即所存 | 缺初始隊伍快照（渲染要） | **採其精神** |
| (b) seed+輸入重模擬 | seed+inputs | 檔最小 | **版本脆弱**：引擎一改，舊紀錄重看結果就不同 → 破壞「保存的回放」 | 否決為 canonical，**降為 header metadata** |
| (c) 混合 | 兩者 | 兼顧 | 兩份資料須自洽 | **採用** |

**最終 = (ii) 結構化 log（JSON）為 canonical + 唯讀戰報投影**。否決的另一條岔路：

- **否決「(i) 人類可讀戰報文字即 canonical」**：要為一個**持續長新機制（M8 地形 / M9 連鎖 / M12 技能）的戰鬥系統**維護一套**雙向文字文法 + parser**，每加一個機制就要動文法/parser/migration——維護債隨戰鬥系統指數成長。(i) 唯一勝出情境是「手寫/手改戰報造一場戰鬥」，但那是**劇本編輯**、不是回放，超出 M14。
- JSON 也是文字 → 滿足「文字化」；log 就是那份「文字記錄」→ 滿足「能用文字記錄回放」；外加一份唯讀戰報投影 → 滿足「完全文字化」的人類可讀直覺。三個需求一次滿足，且零 parser 維護債。

---

## 2. Canonical schema（`game/replay/types.ts`）

```ts
export const REPLAY_FORMAT_VERSION = 1

/** 回放只需「畫面/FX 分派」要的穩定欄位；引擎內部（ivs/nature/derived stats）一律不進 */
export interface DisplayUnitSnapshot {
  instanceId: string          // 穩定 id：side:slot，FX/動畫分派用
  side: 'player' | 'foe'
  slot: number                // 隊伍索引 0..2
  speciesId: number
  displayName: string         // 已解析的中文名（戰報/牌面顯示）
  level: number
  maxHp: number
  initialHp: number           // 開場 HP（跨場/換人 HP 持續，未必＝maxHp）
  shiny: boolean
  heldItemId?: string         // 顯示徽章用（id + 顯示名由 catalog 查）
  abilityId?: string          // 同上
}

/** 玩家本回合輸入（重模擬用；視覺回放不靠它，靠 events） */
export type ReplayInput =
  | { type: 'ATTACK'; quality?: QteQuality; mashCount?: number; starStrike?: boolean }
  | { type: 'SWITCH'; index: number; defenseQuality?: QteQuality }

export interface ReplayTurn {
  input: ReplayInput
  events: BattleEvent[]        // 直接存 reducer 吐的 domain events（已是純資料）
  fieldEvents?: unknown[]      // 預留：M8+ 地形/場域事件（M14 一律不填）
}

export interface ReplayHeader {
  formatVersion: number       // = REPLAY_FORMAT_VERSION
  battleId: string            // FNV-1a(seed + snapshot) 去重 key
  battleSeed: string          // 開場 seed（mulberry32 推進來源）
  createdAt: number           // epoch ms（錄製當下，存進來而非由 codec 產）
  regionId: string
  mode: 'arena' | 'wild'
  outcome: 'win' | 'lose'
  snapshot: DisplayUnitSnapshot[]   // 雙方全員（6 隻）
  initialFieldState?: unknown       // 預留：M8 地形（M14 不填）
}

export interface ReplayLog {
  header: ReplayHeader
  turns: ReplayTurn[]         // 一個 resolveTurn 呼叫 = 一個 turn entry
}
```

**版本化規則（圓桌定，codex 防線）**：
- 整檔**單一 `formatVersion`** + 嚴格 decoder + **unknown event variant fail-fast**。**不要** per-event schemaVersion。
- **僅預先宣告的 optional placeholder（`fieldEvents` / `initialFieldState`）享前向相容**——M8 加地形可直接填，不必 bump 版本。
- **真正新增 event variant（M9 連鎖事件、M12 技能事件…）一律 bump `formatVersion` + 寫純 `migrate(vN→vN+1)`**。optional 欄位**不可**淪為「什麼都往裡塞」的逃生艙。

---

## 3. seeded RNG 前置（小重構，必做）

**現況雷**：`BattleScreen` 呼叫 `resolveTurn(b0, action, { ext })` **沒傳 `rng` → 預設 `Math.random`**，戰鬥目前**非決定性**。重模擬/golden-master 需要決定性。

- `reducer.ts` `TurnOptions.rng` 已是注入點（預設 `Math.random`）。把 store 層改成傳入**seeded RNG**。
- **複用 `individual.ts` 的 `mulberry32` + `hashSeed`**——但兩者目前是該檔**私有未匯出**。抽到共用 `game/rng.ts`（`hashSeed`/`mulberry32`/`makeRng(seed)`），individual.ts 改 import，零行為變動。
- **呼叫序敏感**：reducer 一個 `resolveTurn` 內多次 `rng()`（命中 → 會心 → 支援輪盤 → 速度決勝 → 球輪盤）。battleSeed 存「該場開場 seed」，整場用**同一條 mulberry32 stream 持續推進**；只要 rng 呼叫序不變即可完整重現。這也正是 golden-master 的價值——它就是抓「不小心改了 rng 呼叫順序/次數」的網。
- battleSeed 來源：開戰時生成（如 `cardId 串接 + 時間`，或沿用 encounter 既有 seed）；存進 header，**runtime 不回寫 OwnedUnit**（暫態）。

---

## 4. ReplayRecorder（單點錄製；`store/replayRecorder.ts`）

> codex 修正 gemini 的關鍵：seed+inputs **不能是事後補的惰性 metadata**，必須**從 v1 由單一 Recorder 單點產出**，否則早期紀錄事後不可驗證。

- 開戰時 `startRecording(header 基礎: seed/region/mode/snapshot)` → 內部累積 `turns`。
- `BattleScreen` 每次呼叫 `resolveTurn` 後，把 `{ input, events }` `recordTurn(...)`（**同一處**，與 ext 注入同層）。
- 戰鬥結束（`battleEnded`）`finishRecording(outcome)` → 組出 `ReplayLog` → 交給 codec 序列化 → 存 slice。
- Recorder 只**收集 canonical 資料**，不做任何演出/UI 判斷（純資料蒐集）。

---

## 5. ReplayCodec（純 codec；`game/replay/codec.ts`，比照 `save/bundle.ts`）

- `encodeReplay(log: ReplayLog): string`——deterministic ordering / 穩定鍵序的 JSON（codex 要求「可讀且穩定」，利 diff 與人讀）。
- `decodeReplay(text: string): DecodeResult`——**嚴格** decoder + **分類錯誤**（比照 `UnpackErrorCode`）：
  ```ts
  type ReplayDecodeError =
    | 'not-json' | 'bad-shape' | 'version-too-new' | 'unknown-event' | 'bad-checksum'
  ```
- **校驗**：log 體（turns）算一個 crc/雜湊放 header，decode 時比對，擋截斷/手改壞檔（沿用 bundle.ts crc32 精神）。
- `migrate(log, fromVersion): ReplayLog`——純函數版本升級；`version-too-new` fail-fast（不嘗試降級）。
- **player 只吃 decode 過的 `ReplayLog`**；`.txt` 戰報是另一條投影路徑（見 §6），**永不被 decode**。

---

## 6. eventToReportLine 投影器（「完全文字化」真正交付物；`game/replay/report.ts`）

> 這是使用者「完全文字化」直覺的實體。mistral 的結構：**一 event variant 一 handler + 依 type 分派**純函數鏈。

```ts
export function eventToReportLine(ev: BattleEvent, ctx: ReportCtx): string | null {
  switch (ev.type) {
    case 'damageApplied':  return renderDamage(ev, ctx)
    case 'memberFainted':  return renderFaint(ev, ctx)
    case 'heal':           return renderHeal(ev, ctx)
    case 'activeChanged':  return renderSwitch(ev, ctx)
    case 'switchDefenseResolved': return renderDefense(ev, ctx)
    case 'battleEnded':    return renderEnd(ev, ctx)
    case 'random':         return renderRandom(ev, ctx)   // 命中/會心/支援輪盤/球輪盤
    default:               return `[${(ev as { type: string }).type}]`  // 未知 variant 回退，不丟例外
  }
}
export function logToReport(log: ReplayLog): string  // 全場投影成多行中文戰報
```

- **handler 直吐正體中文字串**（如「皮卡丘對小火龍造成 24 傷害（效果絕佳！會心一擊）」）。`ReportCtx` 帶 snapshot（instanceId → 顯示名/側別）做 id→名稱解析。
- **擴充性**：M8/M9/M12 加新 event variant 時，**只新增 handler**、不動既有；未知 variant 已有安全回退。每 handler 純函數、可單獨 vitest（呼應「194 測試全綠」文化）。
- 戰報用途：①回放畫面側邊「文字戰報」同步高亮 ②匯出 `.txt` 分享 ③debug。

---

## 7. 持久化（獨立 slice；`store/replayStore.ts` + IndexedDB `mz-replays`）

- **載體 = IndexedDB `mz-replays`**（比照 `mz-cards` / `mz-models`）。**不用 localStorage**——JSON log 陣列累積輕易破 5MB。
- **key = `battleId`**（`FNV-1a(seed + snapshot)`）去重，重看同一場不重存。
- **FIFO 保留上限**（預設如 50 場）；超過丟最舊。
- **只存 canonical `.json`（`encodeReplay` 的字串）**。**裁定：不持久化 `.txt` 戰報**——它是 `.json` 的純投影，存它＝存 derived data，違反本專案「**只存 canonical、不存 derived**」核心戒律。`.txt` 在「匯出/分享」當下用 `logToReport` 即時生成。
- **獨立命名空間**，**不污染 roster**（回放是 derived/RNG 紀錄，比照 settings/itembag/savemeta 各住獨立 slice）。

---

## 8. 播放器 UI（複用 BattleScreen 消費器）

- **抽出 BattleScreen 既有「event queue 消費器」**為可餵來源切換的部件：live（`resolveTurn` 即時）vs replay（從 `ReplayLog.turns` 串接 events）。
- 回放模式：禁用玩家輸入（QTE/換人/星擊），改放**播放控制**（播放/暫停/單步/下一回合/倍速）。HP/active/FX/audio 全沿用既有演出路徑。
- **回放清單畫面**（Title 入口，如「🎬 回放」）：列出 `mz-replays` 內各場（region/outcome/時間/雙方縮圖）→ 點選進播放器。
- 載入時 `decodeReplay`；壞檔走分類錯誤 UI（比照 SaveManager 的壞檔提示）。

---

## 9. 不變式相容總結

| 風險 | 守法 |
|------|------|
| 破純 reducer | reducer/engine **完全不動**；回放只消費它既有吐的 events；Recorder 在 store 層蒐集 |
| 破 canonical 持久化 | 回放 log 住獨立 `mz-replays` slice，不進 roster；battleSeed/輸入 runtime 不回寫 OwnedUnit；不存 `.txt`（derived） |
| 破效能紅線 | 回放沿用既有 FX/演出路徑（已守紅線）；播放控制是低頻 UI state，不碰高頻值 |
| 版本脆弱 | canonical 是事件流（所見即所存），非重模擬；引擎改不影響舊紀錄重看 |
| 雙向 parser 維護債 | 戰報是唯讀投影，永不反向 parse |

---

## 10. 「戰鬥改動都動到回放」耦合治理（使用者已接受此耦合，此處把它變可控）

未來每個動到戰鬥的里程碑（M8 地形 / M9 連鎖 / M12 技能），其 checklist **必須**含一條「延伸回放」子項：
1. 若加**新 `BattleEvent` variant** → 在 `eventToReportLine` 加對應 handler + bump `REPLAY_FORMAT_VERSION` + 寫 `migrate` + decoder 認得。
2. 若加**場域狀態** → 填既有 `fieldEvents`/`initialFieldState` placeholder（不必 bump）。
3. 若加**新玩家輸入維度** → 擴 `ReplayInput`（影響重模擬，視為破壞性 → bump）。
4. **golden-master 回歸**（M8 起正式啟用）：錄幾場真實戰鬥當 fixture → 重模擬 `makeRng(seed)+inputs → events` 斷言比對舊事件流；任何「無意間改了 rng 呼叫序/傷害」都會被它抓到。

> 這把「耦合」從**隱性風險**轉成**顯性 checklist 條目 + 自動回歸網**。

---

## 11. 開發切分（M14；純函數先打穿、UI 後接）

| 子里程碑 | 內容 | 核心工作 |
|----------|------|----------|
| **M14.0** | seeded RNG 地基 | 抽 `game/rng.ts`（`hashSeed`/`mulberry32`/`makeRng`），individual.ts 改 import（零行為變動）；store 層 `resolveTurn` 改傳 seeded rng + battleSeed 生成；vitest 決定論（同 seed+inputs → 同 events）骨架 |
| **M14.a** | schema + codec 純資料 | `replay/types.ts`（ReplayLog/Header/Snapshot/Input）+ `replay/codec.ts`（encode/decode/migrate/crc + 分類錯誤）+ vitest round-trip & 壞檔分類（比照 bundle.ts 測試） |
| **M14.b** | 戰報投影器 | `replay/report.ts` `eventToReportLine`（M1–M7 全 variant handler，中文）+ `logToReport` + vitest 每 handler |
| **M14.c** | Recorder + 持久化 slice | `store/replayRecorder.ts`（單點錄製）+ `store/replayStore.ts` + IndexedDB `mz-replays`（battleId 去重 + FIFO 上限）+ BattleScreen 接 recordTurn/finishRecording |
| **M14.d** | 播放器 | 抽 BattleScreen event 消費器為可切換來源；回放模式（禁輸入 + 播放控制）+ 文字戰報側欄同步高亮 |
| **M14.e** | 回放清單 + 匯出 | Title「🎬 回放」入口 + 清單畫面 + `.txt` 戰報匯出（即時投影）+ 壞檔分類 UI |
| **M14.f** | 驗收 | Chrome CDP 走「打一場 → 回放清單出現 → 播放與當場一致 → 匯出戰報」；typecheck/build/test 全綠 |

每子步：純函數先 vitest → UI 接線 → Chrome CDP 實機 → 綠燈即 commit（沿用專案節奏）。

---

## 12. 降規格裁定（Claude 主持，砍過度設計）
- **不做 i18n / 多語戰報抽象層**：自用單語（正體中文）遊戲、UI 全程硬寫中文、無 i18n 框架；為戰報引入 `t()`/locale 目錄是為不存在的需求鋪路（YAGNI）。handler 直吐中文，保留「一 variant 一 handler」結構即可，未來真要多語再抽。
- **不持久化 `.txt`**：見 §7（存 derived 違反核心戒律）。
- **golden-master 重模擬比對 UI 延後**：M14 只放單測骨架（§3/§11 M14.0）；完整比對網待 M8 引擎真的開始改時正式啟用（§10.4）。

---

## 13. 里程碑編號（交由使用者拍板）

> handoff/CHECKLIST 目前把 **M14 排給「改名 mobie」收尾**（定義上永遠最後、會動到所有碼含回放）。
> 本回放取 M14 會撞號。**建議：回放 = M14（排在 M8–M13 戰鬥機制大多落地之後、rename 之前，一次涵蓋完整 event 詞彙），改名順延 M15。**
> 早 build（M8 之前）也可行——前向相容機制（formatVersion/optional placeholder/per-variant handler）正是為此設計；
> 但**排在戰鬥機制之後 build 較省**：屆時 event 詞彙已完整，codec/handler 一次到位，少掉多輪 bump。
> 待使用者確認後，更新 CHECKLIST/handoff 的最終編號。

---

## 14. 待玩測 / 未解
- battleSeed 生成策略（沿用 encounter seed vs 獨立生成）與「同一場景想重玩不同結果」是否要每場新 seed。
- FIFO 保留上限預設值（50?）與是否要「我的最愛回放不被 FIFO 清掉」釘選功能。
- 戰報文字的詳略級別（逐 rng 都寫 vs 只寫關鍵事件）——影響可讀性，玩測定。
- 回放播放控制的倍速檔位與單步粒度（逐 event vs 逐回合）。
