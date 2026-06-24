# 18 — DQ 魔物來源（M20；第二 mobie 來源，可開關）

> ## ⛔ 狀態：棄置／不執行（2026-06-24，使用者拍板）
> **「當前要先棄置，因為沒有官方 API。」** DQ 沒有 PokéAPI 式的官方合法資料/圖床來源
> （見 §0 紅線：美術無合法圖床、SE Material Usage Policy 明文排除 DQ），故 **M20 整個里程碑暫不執行**。
> 本檔**保留供日後參考**（若日後出現合法官方 API 或授權來源可重啟）；CHECKLIST/roadmap/README 對應條目同步標棄置。
> **不影響 M19**（多招式制獨立，不依賴 M20）。

---

> 來源：使用者「DQ 系列也是很好的 mobie 來源，寫計劃加入 DQ 魔物」。決策（AskUserQuestion）：
> **資料比照 Pokémon 從 wiki/攻略抓取；設定可開關是否使用 DQ 資料。**
> 研究全文見本輪 general-purpose agent 報告（資料源 URL／資料模型／14 系統族／9 屬性耐性／呪文 vs 特技／IP）。
>
> **本檔是 M20 的真相來源**。**一句話**：把《勇者鬥惡龍》魔物做成**第二個 mobie 資料來源**，
> 沿用本遊戲既有的 type/相剋/戰鬥引擎；**資料層可行且低風險**，但**美術與 Pokémon 不同**——見 §1 紅線。

---

## 0. ⚠️ 關鍵紅線：DQ 美術 ≠ Pokémon（誠實標註）

使用者直覺「跟 Pokémon 一樣全由 wiki 抓取」——**對「資料」成立，對「美術」不成立**：

| 面向 | Pokémon（現況） | DQ（本計劃） |
|---|---|---|
| **資料（名稱/數值/屬性/系統）** | PokéAPI 公開 API | wiki/攻略可抓。**數值是事實、不受著作權保護**＝低風險。✅ |
| **美術（立繪）** | `raw.githubusercontent.com/PokeAPI/...` ＝官方**合法圖床**、runtime URL | **DQ 沒有合法官方圖床**。鳥山明/Square Enix 著作權，且 SE Material Usage Policy **明文排除 DQ**。熱連結 wiki 圖＝**盜連版權圖**。❌ |

**故美術一律不走 runtime 熱連結**，改沿用本 repo 既有政策：
- **使用者本機 drop-in**（新增 gitignored 目錄如 `public/dq-sprites/`，比照 `public/models/`）。
- **或程序化佔位**（emoji / 幾何 / 既有 sprite fallback）。
- repo **不內建任何 SE 資產**，資料檔註解標出處與授權。

> 這守住 CLAUDE.md 硬約束「不內建/不抓取/不散布侵權資產」。**資料抓、美術不抓**＝本里程碑的根本原則。

---

## 1. 目標與範圍
- DQ 魔物成為**第二 mobie 來源**，與 Pokémon 並存；**設定可開關**（預設關，避免混淆新玩家）。
- **最大化複用既有引擎**：type 相剋表、`resolveAttack`、地形、個體/成長、捕獲、M19 多招式——DQ 魔物儘量「長得像一隻 mobie」，只是資料來源不同。
- 本里程碑只做**資料層 + 來源抽象 + 開關 + 屬性對映**；DQ 專屬機制（吸收回血、系統族專剋）列為選配/後輪。

---

## 2. 多來源 mobie 抽象（Species 一般化）

現況 `Species` 綁死 PokéAPI（全國圖鑑 id、PokeAPI artwork URL）。一般化為「來源無關」：

```ts
// game/types.ts
export type MobSource = 'pokemon' | 'dq'
export interface Species {            // …既有…
  source: MobSource                   // 預設 'pokemon'（既有資料 lazy 補）
  // id 命名空間化：pokemon 用 1–1025；dq 用偏移段（如 100000+）避免撞號
  // artworkUrl 對 dq＝空/佔位 key（不放侵權 URL）；改由 sprite 解析層決定 drop-in/placeholder
  family?: string                     // dq 用：14 系統族之一（pokemon 無）
  resist?: Partial<Record<TypeName, 'weak'|'resist'|'null'|'absorb'>>  // dq 用：個別耐性 override（選配）
}
```

- **id 命名空間**：DQ 魔物 id 走獨立段（如 `100001+`），`getSpecies`/`SPECIES` 合併兩來源 Record；artwork 解析層依 `source` 分流（pokemon→既有 URL；dq→drop-in/placeholder）。
- **資料檔分離**：`game/data/species.ts`（Pokémon，產生檔）＋新 `game/data/dqMonsters.ts`（DQ，產生檔）。合併在 lookup 層，不混檔。
- **`OwnedUnit` 不變**（仍只 speciesId 等 canonical）；speciesId 落在哪個來源段即決定來源＝零新持久化欄位。

---

## 3. 屬性 / 耐性對映（DQ → 既有 18 型相剋）

**策略：把 DQ 9 屬性對映到既有 18 型**（複用同一張相剋表、地形、STAB），**不另開平行屬性系統**（避免引擎分叉）。

| DQ 屬性系 | 代表 | → 既有型別 |
|---|---|---|
| メラ系 Mera | 火 | `fire` |
| ギラ系 Gira | 光/熱 | `fire`（或 `fairy` 當光，待定） |
| イオ系 Io | 爆發 | `normal`（無屬性爆發）或 `fighting` |
| ヒャド系 Hyado | 冰 | `ice` |
| バギ系 Bagi | 風 | `flying` |
| デイン系 Dein | 雷/聖 | `electric` |
| ドルマ系 Dorma | 暗 | `dark` |
| ジバリア系 Jibaria | 土 | `ground` |
| ザバ系 Zaba | 水 | `water` |
| （無屬性物理） | 打擊 | `normal` |

- **魔物防守型別**：由 **14 系統族 → 既有型別**對映（如 ゾンビ系→`ghost`/`poison`、ドラゴン系→`dragon`、マシン系→`steel`、しょくぶつ系→`grass`、あくま系→`dark`…）。一隻可給 1–2 型別＝完全相容既有 `Species.types`。
- **耐性**：預設走「既有相剋表 ×（系統族→型別）」；招牌魔物可用 `resist` 個別 override（§2）。
- **DQ 獨有「吸收＝回血」**：既有引擎無此檔。**列為選配**——若做，`resolveAttack` 加一個「吸收＝負傷害（回血）」分支（類似 heal event），守純 reducer；不做則 `absorb` 退化為 `null`(無效)。本里程碑**先不做**，記為後輪。

> 此對映讓 DQ 魔物直接吃既有 type 相剋、地形 power 倍率、推薦系統（recommend.ts）、模擬壓力測試，**引擎零分叉**。

---

## 4. 招式（呪文/特技）套用 M19 多招式

DQ 魔物無 Pokémon learnset，但有**呪文（spells，耗 MP、帶屬性傷害/回復/狀態）＋特技（skills，低/零 MP 物理）**——天然對映 M19 招式模型：

- **呪文 → 攻擊招/變化招**：屬性傷害呪文（メラ/ヒャド…）＝攻擊招（type 由 §3 對映、power 由階級）；回復/強化/弱化呪文＝變化招（複用 S1/S3/S4 effect）。
- **特技 → 攻擊招**（多為物理、低 MP）。
- **DQ 魔物的 learnset**：由其呪文/特技清單映射到我們招式池，**產出與 Pokémon 同形的 `learnset`/`teachableMoveIds`**（M19 §2 schema）。出生帶 1、可學可忘、上限 4 全部沿用 M19。
- **MP**：本遊戲現無 MP 資源。**先不引入 MP**（街機簡化）；DQ 呪文/特技一律當無消耗招（如同 Pokémon）。MP 列為選配後輪（若要還原 DQ 資源管理）。

---

## 5. 開關（設定可開關 DQ 資料）

- `mobie.settings.v1` 加 **`source.dq` toggle（預設關）**（沿用 M6 settings slice 模式）。
- **關閉＝DQ 段 speciesId 不進**：encounter roll（`rollEncounter`）、區域遭遇表、卡庫種子、推薦——全部過濾掉 dq 來源。已捕獲的 DQ 怪物（若曾開啟過）：roster 保留但提示「需開啟 DQ 來源才能出戰」（比照 sanitize 容錯，不刪 canonical）。
- **DQ 區域**：DQ 魔物可放進**既有區域**（混入遭遇表）或**獨立 DQ 主題區**（如「魔王城」）。建議獨立區（gen 時 mode='wild'、給 DQ 系列地形），開關關閉時整區隱藏。

---

## 6. 資料抓取管線（gen_dq.mjs，比照 gen_dex）

- 新 `scripts/gen_dq.mjs`（比照 `gen_dex.mjs`：快取 + 並發 + 重試），從選定來源抓**數值事實**，產出 `game/data/dqMonsters.ts`（產生檔勿手改）。
- **來源候選**（研究已列具體 URL）：
  - **Woodus "Dragons Den" Global Bestiary**（自稱可自由使用、有整理 Sheet）＝**首選**。
  - dragon-quest.org wiki（系統族/屬性命名對照）、gamepedia.jp / omoteura（日文數值）、kyokugen DQM3（屬性耐性最乾淨）。
  - ⚠️ Fandom 等對 server-side fetch 常 403，需快取/瀏覽器；GitHub `DQMonstersDB-API` 可參考 **CSV schema** 但**無 LICENSE，勿直接搬資料**。
- 產生器只取：名稱、HP→maxHp 對映、攻/守/敏→atk/def/spe（spa/spd 由規則派生或等於 spd）、系統族→types、（選）耐性、呪文/特技→learnset。**EXP/Gold/MP 暫不用**（本遊戲成長走自有 growth.ts）。
- **名稱**：個人/非商用引用風險低；若日後商用需改寫或自創名（記下，不阻塞自用）。
- **美術**：產生器**不寫任何圖片 URL**；`dqMonsters.ts` 的 artwork 欄＝佔位/空，sprite 解析層走 drop-in/placeholder（§0）。

---

## 7. 守住的不變式
- 不內建侵權資產（**資料抓、美術不抓**；DQ 美術走 drop-in/placeholder）。
- 引擎零分叉（DQ 對映到既有 18 型相剋 + M19 招式 + 既有 growth/捕獲）。
- canonical 持久化不變（OwnedUnit 只 speciesId；來源由 id 段決定）。
- 產生檔勿手改（新增 gen_dq.mjs；`dqMonsters.ts` 為產生檔）。
- 可選式（預設關、關掉 DQ 段不進任何流程、已捕獲容錯保留）。

---

## 8. 開發切分
| 子步 | 內容 |
|---|---|
| **M20.a** | 多來源抽象：`Species.source`/id 命名空間/lookup 合併/artwork 解析層分流（pokemon 不變、dq 走 placeholder）＋ vitest。 |
| **M20.b** | DQ 屬性/系統族 → 18 型對映表（手寫）＋ 少量手寫樣本 DQ 魔物（如史萊姆/德拉肯/骷髏）跑通戰鬥＋ vitest。 |
| **M20.c** | 設定開關 `source.dq`：encounter/區域/卡庫/推薦過濾；已捕獲容錯；獨立 DQ 區（gen）。 |
| **M20.d** | 呪文/特技 → M19 learnset 映射（依賴 M19 落地）。 |
| **M20.e** | `gen_dq.mjs` 抓取管線（Woodus 優先）＋重產 `dqMonsters.ts`＋資料完整性測試＋模擬壓力納入 DQ。 |
| **M20.f**（選） | DQ 獨有：吸收=回血耐性檔、系統族專剋、MP 資源、DQ 系列地形。 |

> **相依**：M20.d 依賴 **M19**（多招式 learnset schema）；其餘可獨立。建議 M19 後做。

---

## 9. 待定 / 玩測
- ギラ→fire vs fairy(光)、イオ→normal vs fighting 的具體對映微調。
- DQ 魔物混入既有區 vs 獨立 DQ 區；DQ 數值如何正規化到本遊戲等級帶（DQ 原生數值範圍與寶可夢種族值不同，需縮放規則）。
- 是否引入 MP / 吸收回血（還原度 vs 街機簡化）。
- 商用化時的命名/美術合規（自用階段不阻塞）。
- spa/spd 對映規則（DQ 無「特攻/特防」之分，需派生）。
