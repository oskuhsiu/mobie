# 20 — 全面改名 → Mobie（M18）

> 來源：使用者要把專案「pokemon / 寶可夢 / pokemon-mezastar」自有品牌詞彙全改 **mobie / Mobie**。
> 本檔是 **M18** 的真相來源；`CHECKLIST.md` / `handoff.md` 只引用。**取代並擴大原 M15**（輕量品牌改名）。
>
> **拆檔說明（2026-06-24）**：原 `16-mobie-card-partner-rename.md` 已拆成三獨立檔——
> `16-mobie-info-card.md`（M16）、`19-partner-player-skills.md`（M17）、本檔（M18）。
>
> **⚠️ 執行順序變更（2026-06-24 使用者拍板）：改名「先做」，不再排最後。**
> 原計畫把 M18 排最後是怕機械式大改動撞 merge——但本專案單人單分支無此風險。改名提前的理由更強：
> ①現在（M10 完成）程式碼最少、key 最少（7 個），改名成本最低；
> ②之後 M19/M16/M11 寫的新碼會「天生」就用對的命名，不必再回頭改一輪；
> ③`mz.*`→`mobie.*` key 遷移現在只 7 個 key，越晚做要遷移的 key 越多。
> **新順序：M18（本檔，先）→ M19 多招式 → M16 資訊卡 → M11。**

---

## 目標
把專案的**自有品牌詞彙** `pokemon` / `寶可夢` / `pokemon-mezastar` 全改 **mobie / Mobie**，含檔名、程式識別符、
UI 字串、持久化 key、docs。**這是分類精準改名，不是一鍵 find-replace。**

## ⚠️ 絕不可改（會破圖/破資料/破外部服務名）
- **artwork URL 字面**：`data/species.ts` 的 `artwork()` helper 與 `gen_dex.mjs` 內
  `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`
  ——含 `PokeAPI` 與路徑 `/pokemon/`，改了立繪全破。`dataIntegrity.test.ts` 也斷言此 URL。
- **外部服務名 `PokéAPI`/`PokeAPI`/`pokeapi`**（gen_dex.mjs、註解、`ATTRIBUTION.md`、IP 政策說明）——真實 API 名，保留。
- 物種 zh-Hant **正典名稱**（海星星、寶石海星…）來自 PokéAPI，不動（資料，非品牌字）。

## 改名詞彙對照（全用 mobie）
| 類別 | 改前 | 改後 |
|---|---|---|
| 核心型別 | `BattlePokemon` | `BattleMobie` |
| 建構函式 | `buildBattlePokemon`（stats.ts） | `buildBattleMobie` |
| 元件＋檔名 | `PokemonSprite.tsx` | `MobieSprite.tsx` |
| 3D 造型＋檔名 | `PokemonVisual.tsx`（scene/r3f） | `MobieVisual.tsx` |
| 變數 | `pokemon` / 區域性 `mon` | `mobie` |
| UI 中文 | 「寶可夢」 | 「Mobie」（必要處可加註「小怪物」） |
| 專案名 | `pokemon-mezastar`（package.json/repo/docs） | `mobie` |
| HTML title | `Mezastar Clone`（index.html） | `Mobie` |
| PWA manifest | name/short_name（manifest.webmanifest） | Mobie |

## 範圍（已量化，2026-06-24 掃描；實作前重掃確認）
- src 內 `Pokemon`/`pokemon` 識別符：**約 137 處 / 32 檔**（扣除上述「不可改」的 URL/PokéAPI 字面）。
- 「寶可夢」：**約 32 處 / 24 檔** → 「Mobie」。
- 改檔名：`PokemonSprite.tsx`、`PokemonVisual.tsx`（含所有 import 路徑）。
- 品牌字串：`package.json` name、`index.html` title、`public/manifest.webmanifest`、docs（handoff/README/CLAUDE/ARCHITECTURE/plan/*）。
- repo 目錄 `pokemon-mezastar/` → `mobie/`（含 git remote；最後做、單獨一步，**由使用者執行**）。

## 持久化遷移（改 key ＋ 向後相容）
7 個 key：`mz-cards`、`mz-models`、`mz-save-backup`、`mz.itembag.v1`、`mz.roster.v2`、`mz.savemeta.v1`、`mz.settings.v1`
→ `mobie-*` / `mobie.*`。
- **localStorage（roster/itembag/savemeta/settings）**：load 時加**一次性遷移**——先讀新 key，沒有就讀舊 key 搬過去
  （搬後可選刪舊）。集中一個 `migrateKeys()` helper。
- **IndexedDB（cards/models/save-backup）**：開新 DB 名 `mobie-*` 並首次啟動搬遷，**或建議保留舊 DB 名**（key 純內部、
  不影響品牌、IDB 遷移成本高）——二選一明文記錄。
- **`.save` 檔**：`bundle.ts`/`saveMeta.ts` 的 manifest schema 加「舊欄位名／schemaVersion 識別」，匯入舊檔對映舊→新欄位
  （向後相容），匯出一律新格式。加 round-trip ＋ 舊檔匯入 vitest。

## 切分（**先做，M19/M16/M11 之前**）
- **M18.a** 程式識別符＋檔名改名（型別/函式/元件/變數；含 import 路徑）＋ typecheck 綠。
- **M18.b** UI 中文「寶可夢」→「Mobie」＋ 品牌字串（title/manifest/package.json）。
- **M18.c** 持久化 key 改名 ＋ `migrateKeys()` ＋ `.save` 向後相容 ＋ vitest。
- **M18.d** docs 全域改名（handoff/README/CLAUDE/ARCHITECTURE/plan）。
- **M18.e** repo 目錄改名（最後、單獨；含 git remote 與 `npm run dev` 路徑確認）——**由使用者執行**（會動到工作目錄絕對路徑）。

## 驗證
- `npm run typecheck` && `npm test` && `npm run build` 全綠。
- vitest（migrateKeys 舊→新搬遷、`.save` 舊檔匯入向後相容）。
- Chrome CDP：既有存檔升級後 roster/設定/背包不掉 ＋ 立繪仍正常載入（驗證 artwork URL 未被誤改）。

## 待玩測調參（不阻塞）
- 改名 UI「Mobie」是否中文化為「小怪物」（目前定英文品牌字；可玩測再定）。
