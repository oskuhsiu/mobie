# 08 — 雲端同步記錄（Cloud Sync）

> 設計文件（2026-06-22 提出）。**規劃，尚未實作。** 目標：存檔可跨裝置雲端同步，
> 並以 **timestamp 比對記錄新舊**，避免較新的存檔被舊的覆蓋。排為 **M5（M2 之後）**，
> 純擴充持久化層，不阻塞戰鬥 / 3D / 體感。

## A. 目標
- 跨裝置同步養成進度（roster），讓 iPad / iPhone / 其他裝置共用同一份存檔。
- **用 timestamp 比對記錄新舊**：同步時取較新的一份，舊的不可蓋掉新的。
- **Offline-first**：雲端不可用時遊戲照常跑（本地仍是離線真相），連線後再對帳。
- 沿用既有不變式：**只同步 canonical 狀態，不同步 derived / RNG 中間態**。

## B. 同步什麼
- 主體：canonical `OwnedUnit[]` roster（與 `game/persistence.ts` 既有持久化一致）。
- 未來可擴充進同一信封：設定、上次區域、捕獲/戰績統計等。

## C. 存檔信封（Save Envelope）— 比對新舊的核心
現況 `LocalStorageAdapter` 直接存裸 `OwnedUnit[]`（key `mz.roster.v2`），**沒有時間戳，無法比對新舊**。
雲端同步需要 metadata，導入版本化信封（本地與雲端共用同一格式）：

```ts
interface SaveEnvelope {
  schemaVersion: number   // 存檔格式版本（遷移用）
  deviceId: string        // 裝置 UUID（首次產生並存本地）
  updatedAt: number       // epoch ms，最後一次「本地寫入」時間 ← 比對新舊的主鍵
  revision: number        // 單調遞增計數，每次本地存檔 +1（打破時鐘偏移/同時間平手）
  roster: OwnedUnit[]
}
```

- **`updatedAt` 是使用者要的「比對記錄新舊」主鍵**：誰的 `updatedAt` 大，誰較新。
- **`revision` 為補強**：wall-clock 不可信（使用者可改系統時間、跨裝置有偏移）。先比 `updatedAt`、
  相同再比 `revision`；雲端後端若能蓋「server received time」可當第三方裁判。

## D. 衝突解決（Conflict Resolution）
- **基線：Last-Write-Wins（LWW）by `updatedAt`** — 正是使用者要的「新的贏」。
  排序鍵：`updatedAt` → `revision` →（雲端）server time；全相同視為同一份（no-op）。
- **Divergence 偵測**：本地記住上次同步成功的 base `{revision, updatedAt}`。若本地與雲端都在 base
  之後各自有改動 → 真衝突。處理策略（實作前再定）：
  - **(a) 預設 LWW**：取較新者；較舊者備份成 `mz.roster.conflict.<ts>` 以防誤刪（自用單人足夠）。
  - **(b) 進階逐隻合併**：每隻 `OwnedUnit` 自帶 `updatedAt`，逐隻取新 → 不整份覆蓋，但較複雜，列未來精修。
- 自用單人遊戲先採 **(a)**；待真有多裝置併發編輯痛點再上 (b)。

## E. 同步流程（Pull → Merge → Push）
1. **觸發點**：app 開啟、`online` / `visibilitychange` 回前景、每次本地存檔後（debounce 數秒）。
2. **Pull**：抓雲端信封（或空 / 未變）。
3. **Merge**：本地 vs 雲端比 `updatedAt` / `revision` → 決定 winner（或 (b) 合併）。
4. **Apply**：winner 寫回本地（更新 `rosterStore` + LocalStorage / Dexie）。
5. **Push**：若本地較新（或合併後有變）→ 上傳信封。
6. 記錄 `lastSyncedAt` / `lastSyncedRevision`，更新同步狀態給 UI。
- 全程**非阻塞**：失敗（離線 / 配額 / 認證）就忽略、保留本地，下次再試（沿用 `LocalStorageAdapter` 容錯風格）。

## F. 架構落點（不改戰鬥）
- 既有 `PersistenceAdapter`（local）維持 offline 真相來源。
- 新增 **`CloudSyncAdapter`** 介面：`pull(): Promise<SaveEnvelope|null>`、`push(env): Promise<void>`、可選 `subscribe()`。
- 新增 **`SyncCoordinator`**（無 UI）：協調 pull–merge–push、節流、狀態旗標。
- `rosterStore` 每次存檔 bump `updatedAt` / `revision`，並通知 coordinator。
- **後端 vendor 中立**（介面解耦）：候選 Firebase/Firestore、Supabase、自建 serverless KV、或使用者自有
  Drive/Gist。自用單人 → 一把私有 token + 單一 document 即可；多人才需帳號/auth。
  **不入庫任何 secret**（走環境變數 / 本地設定），符合資產責任化精神。

## G. UI
- 標題 / 設定顯示同步狀態：上次同步時間（`updatedAt` 友善格式）、「已是最新 / 同步中 / 離線」、手動「立即同步」。
- LWW 時靜默 + log；若日後做 (b) 合併，提供「以哪份為準」對話框。

## H. 與里程碑關係
- **依賴 M2**：M2 把持久化換 Dexie，是導入 SaveEnvelope（加 `updatedAt` / `revision`）的自然時機。
  **建議 M2 落地 Dexie 時就讓本地存檔帶時間戳**，雲端同步（M5）才有得比。
- 本功能排 **M5**，純擴充持久化，不阻塞其他里程碑。

## I. 邊界與風險
- 時鐘不可信 → `revision` + server time 補強。
- 首次：雲端空 → 直接上傳本地；本地空（新裝置）→ 直接套雲端。
- Schema 遷移：`schemaVersion` + 遷移函式；舊雲端信封先升版再合併。
- 隱私：個人存檔資料，端點需私有 / 加密傳輸；多人才需 per-user 隔離。
- **絕不**把 derived / RNG 中間態進雲端（守「只存 canonical」不變式）。

## J. 待定（實作前再決）
- 後端供應商與 auth 模型（自用單人 token vs 多人帳號）。
- 同步頻率 / debounce 參數。
- 衝突策略最終 (a) LWW 還是上 (b) 逐隻合併。
