# M2 — QR 掃描 + 卡庫

> 用實體卡取代 M1 的假卡手牌。

## 成功標準
1. 相機掃到 `MZ1:<cardId>:<crc>` 能解析、CRC 校驗、反查本地 `cards` 表，載入成 `MyPokemon`。
2. 支援 JSON/CSV 匯入 `cards` 表；掃過的寶可夢進 IndexedDB「我的寶可夢」。
3. 掃描失敗（CRC 錯、查無卡、相機權限拒）有明確 UI 回饋。

## 範圍
- **QR 掃描**：優先用 `BarcodeDetector`（iPad Safari 支援），fallback `@zxing/browser`。
- **MZ1 解析器**：`parseCardCode(raw) → { version, cardId, crc, valid }`；CRC 防誤讀非防偽。
- **卡庫管理**：`cards` 表（Dexie），匯入/檢視；產卡工具（自製 QR 給自己的卡印出來）。
- 替換 M1 選卡畫面：保留「假卡」為開發模式 fallback。

## 不做
- 卡片防偽簽章、線上卡片庫、交易。
