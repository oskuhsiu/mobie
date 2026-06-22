# 01 — 整體架構

## 專案結構（提案）

```
pokemon-mezastar/
├─ plan/                      # 本計劃
├─ public/
│  ├─ manifest.webmanifest    # PWA
│  └─ models/                 # 使用者本機 drop-in 的 GLB（git-ignored，不入庫）
├─ src/
│  ├─ main.tsx
│  ├─ app/                    # App 殼、路由/畫面切換
│  ├─ game/
│  │  ├─ machine/             # XState 遊戲流程狀態機
│  │  ├─ battle/              # 戰鬥引擎：傷害公式、屬性相剋、回合解算
│  │  ├─ data/                # PokéAPI client + 快取、種族/招式/屬性表
│  │  └─ types.ts             # 共用型別
│  ├─ store/                  # Zustand stores（瞬時/高頻狀態）
│  ├─ db/                     # Dexie/IndexedDB schema：cards、myPokemon、models
│  ├─ scan/                   # QR 掃描（BarcodeDetector）+ MZ1 解析
│  ├─ scene/                  # R3F 場景、造型抽象層、billboard/GLB loader
│  ├─ input/                  # 輸入抽象層：touch / mediapipe gesture
│  ├─ vision/                 # MediaPipe Tasks Vision 封裝（M4）
│  └─ ui/                     # React UI 元件（HUD、選單、結算）
├─ index.html
├─ vite.config.ts
└─ package.json
```

## 分層原則

- **遊戲流程（XState）**：唯一的「真相來源」描述 game loop 階段轉換。UI 只 render 當前 state、發 event。
- **瞬時/高頻狀態（Zustand）**：HP 條動畫、集氣值、輪盤角度等每幀變動的數值，不進 XState、也**不進 React 頂層 state**。
- **持久化（IndexedDB / Dexie）**：cards 表、myPokemon 表、imported models（GLB blob）。
- **輸入抽象層**：戰鬥引擎只認識「action（攻擊 / 集氣量 / timing 命中度）」，不認識 touch 或 mediapipe；M1 用 touch 實作，M4 加 mediapipe 實作同一介面。

---

## 遊戲流程狀態機（XState）

```
idle
 └─(start)→ regionSelect
              └─(pickRegion)→ encounter        # 依區域權重隨機生成野生寶可夢
                                └─(engage)→ loadOwn   # M1 選假卡 / M2 掃 QR
                                              └─(loaded)→ battle
                                                            ├─(turn loop)→ battle
                                                            ├─(playerWin)→ result.win   # 可捕獲
                                                            └─(playerLose)→ result.lose
                                                                              └─(again)→ regionSelect
```

戰鬥子狀態（`battle`）：`selectAction → resolveTurn → checkEnd`，回到 `selectAction` 或進 `result`。

---

## 資料模型

### Species（種族，來自 PokéAPI，本地快取）
```ts
interface Species {
  id: number;            // 全國圖鑑編號
  name: string;
  types: TypeName[];     // 1–2 屬性
  baseStats: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
  artworkUrl: string;    // official-artwork / home render，billboard fallback 用
}
```

### Card（實體卡 → 本地 cards 表）
```ts
interface Card {
  cardId: string;        // QR 反查鍵
  speciesId: number;
  level: number;
  moveId: number;        // 單一專屬招式（Mezastar 風格）
  ivSeed?: string;       // 決定個體值的種子（可選）
  shiny?: boolean;
}
```

### MyPokemon（掃卡後存入）
```ts
interface MyPokemon extends Card {
  currentHp: number;
  maxHp: number;
  obtainedAt: number;
}
```

### Move（招式，來自 PokéAPI）
```ts
interface Move {
  id: number; name: string; type: TypeName;
  power: number; accuracy: number;
  category: 'physical' | 'special';
}
```

---

## QR 卡片格式（已定案）

```
MZ1:<cardId>:<crc>
```
- `MZ1` — 版本碼，利於日後 schema 升級。
- `<cardId>` — 反查本地 `cards` 表的鍵。
- `<crc>` — CRC 校驗，**防掃描誤讀，非防偽**（自用防偽無意義）。
- 反對 JSON / 簽章：高密度 QR 會拖慢 BarcodeDetector 對焦辨識，低密度才有實體卡俐落感。
- 卡片完整資料放本地 `cards` 表，支援 JSON / CSV 匯入。

---

## 戰鬥模型（已定案：貼 Mezastar 街機感）

- **1v1**，每隻**單一專屬招式**（資料模型保留 `moves[]` 概念但 MVP 只取一招）。
- MVP **砍掉 PP 與異常狀態**。
- 保留**屬性相剋表** + **標準傷害公式（含隨機數）** + **HP 歸零判定**捕獲 / 勝負。

傷害公式（簡化自本傳）：
```
damage = (((2*level/5 + 2) * power * atk/def) / 50 + 2)
         * STAB          # 同屬性 1.5
         * typeEffect    # 相剋 0 / 0.25 / 0.5 / 1 / 2 / 4
         * random(0.85, 1.0)
         * qteMultiplier # 體感 QTE 增益（M4；M1 觸控時固定 1.0 或由 timing bar 決定）
```

屬性相剋：18 型相剋表存成 `Record<TypeName, Record<TypeName, number>>` 常數。

---

## 效能紅線（gemini 強調，務必遵守）

M3（3D 渲染）與 M4（體感）銜接時：**MediaPipe 回傳的連續數據（集氣值、手部座標）禁止直接寫入 React 頂層 state**，否則 DOM tree 與 3D Canvas 一起無效重繪會摧毀 iPad Safari 幀率。

正確做法：
- MediaPipe → 寫入 **Zustand**（transient，`useStore.setState`）。
- 3D 場景透過 **R3F `useFrame`** 或 **Zustand `subscribe`** 直接讀取，繞過 React render。
- React UI 只在「階段切換」等低頻事件時 re-render。
