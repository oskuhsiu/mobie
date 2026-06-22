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
| **M1** | XState game loop（選區→野生生成→假卡載入→單招互毆→結算）+ 本地假卡資料，純觸控 | ✅ 完整可玩 |
| **M2** | QR 掃描（`MZ1:<cardId>:<crc>`）+ IndexedDB 卡庫 + JSON/CSV 匯入 | ✅ 用實體卡 |
| **M3** | R3F 3D 戰鬥場景 + 可插拔造型層（GLB drop-in → billboard fallback） | ✅ 類 3D |
| **M4** | MediaPipe Tasks Vision QTE 疊加（連打集氣 / 握拳停輪盤） | ✅ 體感增益 |
