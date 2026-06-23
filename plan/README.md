# Pokémon Mezastar Clone — 開發計劃

iPad 為主（iPhone 相容）的自用 Mezastar 風格遊戲。流程：**選區域 → 遇野生寶可夢 → 掃描實體卡 QRCode 載入自有寶可夢 → 回合戰鬥 → 結果**。目標類 3D 表現，並接入相機以 MediaPipe 做體感 QTE。

本計劃由三方 AI 圓桌（Claude / gemini / codex）討論收斂，原始結論見 `../../.claude/agent-chat/session-20260622-145615/conclusion.md`。

---

## 文件索引

| 檔案 | 內容 |
|------|------|
| `README.md` | 本檔。總覽、技術棧、設計哲學、索引 |
| `01-architecture.md` | 整體架構、資料模型、狀態機、QR/戰鬥 schema、效能紅線 |
| `02-milestone-M1.md` | M1 純觸控完整 game loop |
| `03-milestone-M2.md` | M2 QR 掃描 + 卡庫 |
| `04-milestone-M3.md` | M3 R3F 3D 戰鬥場景 + 可插拔造型層 |
| `05-milestone-M4.md` | M4 MediaPipe 體感 QTE |
| `06-battle-reference.md` | **寶可夢對戰常識查證**（Bulbapedia：傷害/相剋/會心/先制/狀態/能力值/性格/經驗/換人）＋MVP 簡化標註 |
| `07-systems-design.md` | **意外機制 + 個體差異/成長性設計**（Mezastar 機台查證＋三方共識） |
| `08-cloud-sync.md` | **雲端同步記錄設計**（存檔信封 + timestamp 比對新舊 + 衝突解決，排 M5） |
| `09-extension-systems.md` | **延伸系統設計 wave-1**（道具/羈絆/連鎖/進化/連勝塔 + 統一掛載機制 S1–S8 + 回合相位契約，排 M6）（三方圓桌選 5 + 設計審查） |
| `10-extension-systems-wave2.md` | **延伸系統設計 wave-2**（特性/Grade/圖鑑成就/Ascension/孵化，沿用 09 §0 機制，排 M6 wave-2）（三方圓桌選 5 + 設計審查） |
| `11-terrain-modes-accidents.md` | **地形系統 + 模式分流 + 野外意外**（地形影響戰力/混合/隨機、競技場vs野外、野外意外選 5，排 M7）（三方圓桌收斂） |
| `12-battle-skill-module.md` | **戰鬥技能大模組**（技能訓練/學習/繼承 + 合體技含施放效果 + 對手技能多樣性，守單招、排 M8）（三方圓桌好好討論收斂） |
| `13-content-roadmap.md` | **內容補完路線圖**（寶可夢 G3–G9 補完 + 地形擴充天氣/場地/特殊型，階段性推出；資料 PokéAPI、圖官方 artwork） |
| `14-roadmap-m6-m13.md` | **延伸里程碑路線圖 M6–M13**（22 項依類型歸 7 家族、拆成獨立里程碑 M6–M13 依賴排序 + 完整性檢視；找出道具/特性/技能等跨里程碑合併點） |
| `15-battle-replay.md` | **戰鬥回放系統（M14）**（一場戰鬥完全文字化成 JSON log + 唯讀戰報投影、完整回放；canonical=事件流+seed/輸入 header，否決雙向 parser/純重模擬，reducer 不動，複用 BattleScreen 消費器）（四方圓桌收斂） |
| `CHECKLIST.md` | **獨立的進度 check list**（跨全里程碑，勾選用） |

---

## 技術棧（已定案）

- **前端 / 3D**：React + react-three-fiber（Three.js）
- **狀態**：Zustand（高頻 / 瞬時狀態）+ XState（遊戲流程狀態機）
- **儲存**：IndexedDB（卡庫、匯入的 GLB、我的寶可夢）— 透過 Dexie.js 封裝
- **體感**：@mediapipe/tasks-vision（Hand Landmarker / Gesture Recognizer）
- **載體**：PWA，跑在 iPad Safari（iPhone 相容），加 manifest + service worker
- **建置**：Vite + TypeScript + pnpm

### 否決的選項與理由
- **Unity**：3D / 資產生態最強，但 MediaPipe 需第三方 plugin、包體重 → 否決。
- **原生 Swift（RealityKit + Apple Vision）**：效能最佳、姿態可用 Apple Vision 原生取代 MediaPipe，但工最大；且使用者點名 MediaPipe → 否決，保留為日後效能不足時的**逃生路線**。

---

## 設計哲學

1. **每個里程碑都可玩**：M1 純觸控就要能完整通關，後續里程碑是漸進疊加，不互相阻塞。
2. **風險墊後**：MediaPipe（相機權限 / 延遲 / 電量 / 與 WebGL 並存）不確定性最高，墊到 M4；核心 game loop 永不依賴它。
3. **資產責任化**：repo 本身**不內建、不抓取、不散布**任何侵權模型；GLB pipeline 照建，模型由使用者本機 drop-in。數據全走 PokéAPI。
4. **手感優先**：貼 Mezastar 街機節奏——每隻寶可夢單一專屬招式、連打集氣、握拳停輪盤 timing。

---

## 里程碑總覽

| 里程碑 | 交付 | 可玩狀態 |
|--------|------|----------|
| **M1** ✅ | XState game loop（選區→野生生成→假卡載入→單招互毆→結算）+ 本地假卡，純觸控 | ✅ 已完成 |
| **M1.5 a–d** | 戰鬥升級：3v3 隊伍 + 主動換人(防禦QTE) + 聲光(FxCanvas+framer+Tone.js) + 純 reducer | 進行中 |
| **M1.5 e–h** | 意外機制(支援/球輪盤) + 個體差異(IV/性格) + 成長(EXP/n³+持久化) + 星擊 finisher | 設計完成 |
| **M2** | QR 掃描（`MZ1:<cardId>:<crc>`）+ IndexedDB 卡庫（PersistenceAdapter 換 Dexie）+ 匯入 | ✅ 用實體卡 |
| **M3** | R3F 3D 戰鬥場景 + 可插拔造型層（GLB drop-in → billboard fallback） | ✅ 類 3D |
| **M4** | MediaPipe Tasks Vision QTE 疊加（連打集氣 / 握拳停輪盤） | ✅ 體感增益 |
| **M5** | 雲端同步記錄（SaveEnvelope + `updatedAt`/`revision` 比對新舊 + LWW 衝突解決）→ `08-cloud-sync.md` | ☁️ 跨裝置存檔 |
| **M6** | 共用地基：掛載地基 S1–S8＋§0.4 相位契約（`09`）＋模式 contract arena/wild（`11`） | 🧱 地基 |
| **M7** | 戰鬥條件 hook 層：隊伍羈絆／持有道具（建 S1/S3/S4 引擎）／特性（`09`/`10`） | 🪝 hook 層 |
| **M8** | 場域 / 地形：地形效果（影響戰力，導入 `fieldState`）＋更多/混合/隨機地形（`11`） | 🗺️ 地形 |
| **M9** | 連鎖攻擊（Combo 基底，合體技前置）→ `09` | 🔗 連鎖 |
| **M10** | 養成 · 收集 · 孵化：進化／星級 Grade／圖鑑成就／抽蛋孵化（`09`/`10`） | 🌱 養成收集 |
| **M11** | 模式 · 長線 · 野外意外：連勝塔／Ascension／野外意外×5（`09`/`11`） | 🏯 長線挑戰 |
| **M12** | 戰鬥技能大模組：技能 loadout（訓練/學習/繼承）＋合體技（chain variant＋施放效果）＋對手 profile → `12`（縱向小樣本先打穿） | ⚔️ 技能與合體技 |
| **M13** | 內容補完：寶可夢 G3–G9（共 1025）＋地形擴充（天氣/場地/特殊型），階段性 → `13` | 📚 內容補完 |
| **M14** | 戰鬥回放系統：一場戰鬥完全文字化成 JSON log（事件流+seed/輸入）＋唯讀戰報投影，完整回放（reducer 不動、複用 BattleScreen 消費器）→ `15` | 🎬 戰鬥回放 |
| **M15** | 🏁 收尾改名：repo/套件/app 品牌 `pokemon-mezastar`→**`mobie`（小怪物）**，所有里程碑完成後執行（守舊存檔不壞） | 🏷️ 定名 mobie |
| 〔總控〕 | M6–M13 類型歸類 + 依賴排序 + 完整性檢視 → `14-roadmap-m6-m13.md`（舊 M6.x/M7.x/M8.x 子編號對應表在此） | 🧭 路線圖 |
