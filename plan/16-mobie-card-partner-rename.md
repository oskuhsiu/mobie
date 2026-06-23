# 16 — Mobie 資訊卡 · Partner 技能系 · 全面改名（M16 / M17 / M18）

> 來源：使用者實玩回饋（看不到自己夥伴的型別/技能/數值）＋ 提出「玩家與 mob 是**夥伴而非從屬**」理念
> ＋ 要把專案「pokemon」字眼全改 **mobie**。設計決策經 AskUserQuestion 與使用者逐項拍板（見 §0）。
> 本檔是 M16–M18 的**真相來源**；`CHECKLIST.md` / `handoff.md` 只引用，不重抄。
>
> **共同身分軸線**：「你的 mob 是**夥伴**，這個遊戲叫 **Mobie**」——三個里程碑同一條線。
> M16（看得到夥伴）→ M17（夥伴技能系，看穿把 M16 接起來）→ M18（全面正名 Mobie）。

---

## 0. 已拍板的設計決策（使用者）

1. **自己夥伴資訊一律完整可見**；對手**基本面**（名稱/型別/Lv）免費，**深度**（精確招式/數值/IV 星級）**鎖在「看穿」後**。
2. 技能啟動＝**混合：自動為主 ＋ 1 個每場一次的主動槽**（看穿＝主動鈕、鼓舞＝HP 低自動）。
3. 技能取得＝**完整 SP 訓練經濟**（boss/塔得 SP、訓練所學技能、進化/節點解第 2 槽）。
4. 改名詞彙＝**全用 `mobie`**（`BattlePokemon`→`BattleMobie`、`PokemonSprite`→`MobieSprite`、UI「寶可夢」→「Mobie」）。
5. 存檔 key＝`mz.*`/`mz-*` → `mobie.*`/`mobie-*` ＋ **寫一次性遷移**；`.save` 舊欄位名要能向後相容匯入。

**守住的硬約束**：純 reducer 不含 UI 字眼、只持久化 canonical `OwnedUnit`、可選式掛載（預設全關、關掉零殘留）、
單招街機（技能不引新攻擊招、不直接大傷害）、高頻值只走 ref/rAF/Zustand、不內建侵權資產（artwork 走 PokéAPI runtime URL）。

## 與既有里程碑的調和
- **M16** 全新，無重疊（純 UI、無相依，可先做）。
- **M17 = 提前並重定位 M12** 的「技能 hook+loadout（原 M8.a）＋ 訓練/解鎖（原 M8.b）」為 partner 技能系；
  M12 剩餘子項（合體技 M8.d、對手 profile M8.e、孵化繼承 M8.c）**續留原里程碑**，本檔已預留接點。
- **M18 取代並擴大 M15**（M15 輕量品牌改名 → 併入 M18 的「含檔名/內容/key 遷移/.save 相容」精準改名）。

---

# M16 — Mobie 資訊卡（檢視自己 ＋ 對手）

## 目標
可複用、精美的檢視卡，顯示任何 mob 的完整資訊。自己的夥伴一律全顯示；對手基本面全顯示、深度資訊遮罩
（給 M17 看穿揭露）。**純 UI／顯示層，不動 reducer/engine/持久化。**

## 現況缺口（已查證）
- `BattlePokemon`（`game/types.ts`）早已含全部資料：`types`、`move`（id/nameZh/type/power/accuracy/category）、
  解析後六維、`ivs`/`nature`/`shiny`、`heldItemId`/`abilityId`。但 UI 從沒把 `move` 細節揭露給任何 mob。
- 戰鬥中 `HpPlate`（`ui/screens/BattleScreen.tsx`）對自己與對手都只顯示 名稱/Lv/特性/道具/血條——**無型別、無招式、無星級**。
- `EncounterScreen` 只有領頭野生顯示型別＋星級；其餘隊員只有縮圖。`CardSelectScreen` 對手條只有縮圖＋型別。

## 設計
新元件 **`src/ui/components/MobCard.tsx`**——modal（複用 `.modal-backdrop`/`.modal-card` framer-motion 模式，見 `TeamModal.tsx`）。
簽名 `MobCard({ mon, owner, revealed, onClose })`：

| 區塊 | 自己（owner）/ 已看穿 | 對手未看穿 |
|---|---|---|
| 立繪＋名稱＋Lv＋✦異色 | 全顯示 | 全顯示 |
| 型別徽章（`TypeBadges`） | 全顯示 | **顯示**（基本面） |
| 招式：名稱＋型別＋物理/特殊＋威力＋命中 | 全顯示（**新**） | `？？？`／占位「🔍 看穿後揭露」 |
| 六維數值條（HP/攻/防/特攻/特防/速） | 全顯示（**新** mini bar） | 遮罩 `？？？` |
| 星級＋性格（`IndividualInfo`） | 全顯示 | 遮罩 |
| 特性＋持有道具（`getAbility`/`getItem`） | 全顯示 | 遮罩 |
| 裝備中的 partner 技能 | 全顯示（**M17 落地後填**） | — |

**開啟點（tap-to-inspect）**：
- **BattleScreen**（核心修復）：點自己的 `HpPlate` → 自己全卡；點對手 `HpPlate`/`TeamTray` 成員 → 對手卡
  （`revealed` 接 battleStore 看穿旗標，M17 前恆 false → 顯示占位）。
- **EncounterScreen**：點任一對手隊伍縮圖 → 對手卡。
- **CardSelectScreen**：點自己的 `poke-card` → 自己全卡；點對手條 `foe-strip__mon` → 對手卡
  （保留既有 inline 徽章與點選出戰手感，開卡走 ⓘ 角標或長按）。

## 複用 / 新增
- **複用**：`.modal-backdrop`/`.modal-card`（global.css）、`TypeBadges`（TypeBadge.tsx）、`IndividualInfo`
  （已有 detailed IV 模式）、`PokemonSprite`、`getItem`/`getAbility`、`TYPE_LABEL_ZH`/`typeColor`（typeMeta.ts）。
- **新增**：`MobCard.tsx`、六維 mini-bar 與招式 row 的少量 CSS、各畫面 onClick 接線、
  battleStore 加 `revealedFoes`（M17 用；M16 先放空 set）。

## 切分（每步綠燈即 commit）
- **M16.a** `MobCard.tsx` ＋ CSS（吃 `BattlePokemon`+`revealed`，先在 Encounter 接一個開啟點驗證）。
- **M16.b** 戰鬥中接線：點 HpPlate/TeamTray 開卡（自己全顯、對手遮罩占位）。
- **M16.c** CardSelect 接線（自己卡＋對手卡）。

---

# M17 — Partner 技能系（Partner Skill System）

## 目標
把 **M12 技能大模組**核心**提前並重定位**為「partner 技能系」（夥伴而非從屬）。複用 M7 的 S1–S8 hook 引擎
＋ M8 的 `fieldState`，做到**戰鬥機制零 reducer/engine 改動**（與道具/特性同模式）。
範圍＝技能 loadout ＋ 自動/主動啟動 ＋ 看穿/鼓舞起始 catalog ＋ 完整 SP 訓練經濟。
**不含** 合體技（M9/M12.d）與對手技能 profile（M12.e）——續留各自里程碑。

## 啟動模型（混合：自動為主 ＋ 1 主動槽）—— 關鍵架構選擇
- **自動技能（改變戰況）＝既有 hook 模組，零新機制**：
  `game/ext/partnerSkills.ts` 結構同 `items.ts`/`abilities.ts`，push 進 `MODULE_REGISTRY`（store/ext.ts）。
  - 鼓舞（HP 低 → 攻擊↑）＝**S3 damageHook**，與特性「絕境爆發 pinch（HP≤1/3 ×1.5）」同位階。
  - 守護（劣勢時受傷↓）＝**S3 guard**，與特性 guard 同位階。
  - 疾風（速度↑）＝**S1 buildUnit statMod**，與道具 statMod 同位階。
  - （選）回復（回合末小回血）＝**S4 turnEnd**，複用 M7 `heal` event。
  - （選）整地（開場灌注地形）＝寫 `field.terrainEffects.current`（M8 已備 current/initial 分流）。
  - hook 讀 `BattlePokemon` 暫態 `equippedSkillIds` 自行分流（縫關閉＝該欄不存在＝零殘留），
    與 `heldItemId`/`abilityId` 完全同路（`applyBattlePrep` 與 `buildBattleMobie` 帶進暫態）。
- **主動槽（1 個、每場一次、手動鈕）＝純顯示層的資訊/工具技**：
  - 看穿＝按鈕 → 設 battleStore `revealedFoes.add(activeIndex)` ＋ FxCanvas 揭露演出 ＋ 扣每場一次預算
    （預算住 display state，不持久化）。**不進 reducer、不耗回合、對手不回擊**（純偵查，手感好且守相位契約）。
  - M16 的 `MobCard`/`HpPlate` 讀 `revealedFoes` → 揭露對手深度資訊。兩里程碑在此接合。
- **未來擴充（記下不做）**：若日後要「主動且改變戰況」的技能，再加有界的 `USE_PARTNER_SKILL{skillId}`
  action（resolveTurn 內依速度結算、foe 回應）——**本輪不需**，故 reducer/engine 完全不動。

## 資料模型（catalog 手寫非產生檔；持久化只存 canonical id）
```ts
// game/ext/partnerSkills.ts （比照 items.ts / abilities.ts）
type PartnerSkillId = string
interface PartnerSkillDef {
  id; name; icon; desc
  mode: 'auto' | 'active'                 // active 只放資訊/工具技（本輪＝看穿）
  hook?: 'statMod' | 'pinch' | 'guard' | 'turnEnd' | 'terrainSet'   // auto 用，對映 S1/S3/S4
  effect: { stat?; mult?; fraction?; terrainId?; turns? }
  reveal?: boolean                        // active 用：揭露對手深度資訊
}
// OwnedUnit 加（canonical，隨 roster 序列化、含 .save）：
interface OwnedUnit { /* …既有… */
  learnedSkillIds?: PartnerSkillId[]      // 已學會（庫）
  equippedSkillIds?: PartnerSkillId[]     // 出戰裝備（≤ 槽數）
  // inheritedSkillIds 蛋招繼承 → 續留 M10 孵化落地
}
```
起始 catalog（小樣本，圓桌定「縱向先打穿」）：🔍 看穿(active/reveal)、📣 鼓舞(auto/pinch)、🛡 守護(auto/guard)、
💨 疾風(auto/statMod spe)、（選）🌿 整地(auto/terrainSet)、（選）💗 回復(auto/turnEnd)。

## SP 訓練經濟
- **SP 錢包**：新 slice `mobie.skillpoints.v1`（帳號級單一數值；簡單、不肝）。
- **SP 取得**：打贏 wild 區 **boss 給 SP**（接 `rosterStore` 勝利結算，與 `grantBattleExp` 同處）。
  塔層 SP → **預留 hook 給 M11**；里程碑 SP → 選配。
- **技能訓練所 UI**：新 modal `PartnerSkillModal`（Title 入口「✨ 夥伴技能」，或併入 `TeamModal` 分頁；
  複用 `team-row`/`item-picker`/`item-chip` 樣式）。花 SP 學技能（→`learnedSkillIds`）、調 loadout（≤ 槽數）、顯示 SP 餘額。
- **技能槽解鎖**：預設 1 槽；第 2 槽＝**SP 購買**或**等級門檻**（現在可做，不依賴未建的進化）；進化解槽 → **預留接點給 M10**。
- **個體面板技能區**：直接顯示在 M16 的 `MobCard`（partner 技能列）——兩里程碑複用同一張卡。

## 模組關閉時的行為（守可選式掛載）
`mobie.settings.v1` 加 `modules.partnerSkills` toggle（預設關）。關閉＝hook 不註冊、主動鈕不顯示、
訓練所可瀏覽但提示去設定開啟（比照 `TeamModal` 對道具/特性的提示）。

## 切分
- **M17.a** schema/catalog/persistence 純資料：`PartnerSkillDef`/起始 catalog ＋ `OwnedUnit` 加 skill id 欄
  ＋ `resolveSkillHooks(unit)` 純函數 ＋ `sanitizeRoster` 只留已知 id ＋ vitest（含護欄：無 `damage` 效果）。
- **M17.b** 自動技能掛載：`partnerSkills.ts` push `MODULE_REGISTRY`、`assembleExt`/`assembleBattlePrep` 帶進
  `equippedSkillIds`、戰鬥雙方/玩家隊套用、HpPlate 顯技能徽章 ＋ vitest（觸發/分流/關閉零殘留）。
- **M17.c** 看穿主動槽：戰鬥行動列加「✨ 夥伴技能 → 🔍 看穿」鈕（每場一次，display state）＋ 揭露演出 ＋ 接 M16 `revealedFoes`。
- **M17.d** SP 經濟：SP slice ＋ boss 勝利給 SP ＋ `PartnerSkillModal` 訓練所（學/裝/解槽）＋ MobCard 技能列。

## 與 M12 的關係（標註於 CHECKLIST/handoff）
本里程碑＝**提前實作 M12 的「技能 hook+loadout（原 M8.a）＋ 訓練/解鎖（原 M8.b）」**。M12 剩餘子項
（合體技、對手 profile、孵化繼承）續留 M9/M10/M12，且已預留接點（進化解槽、塔給 SP、蛋帶技能）。
`fieldState.teamStatuses/enemyStatuses` 子欄位於本里程碑由自動技能效果**首次填用**
（呼應 plan/14「M8 導入容器 → M12 補全子欄」）。

---

# M18 — 全面改名 → Mobie（含檔名與內容、專案名）

## 目標
把專案的**自有品牌詞彙** `pokemon` / `寶可夢` / `pokemon-mezastar` 全改 **mobie / Mobie**，含檔名、程式識別符、
UI 字串、持久化 key、docs。**這是分類精準改名，不是一鍵 find-replace。**

## ⚠️ 絕不可改（會破圖/破資料/破外部服務名）
- **artwork URL 字面**：`data/species.ts` 的 `artwork()` helper 與 `gen_dex.mjs` 內
  `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`
  ——含 `PokeAPI` 與路徑 `/pokemon/`，改了立繪全破。
- **外部服務名 `PokéAPI`/`PokeAPI`/`pokeapi`**（gen_dex.mjs、註解、IP 政策說明）——真實 API 名，保留。
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

## 範圍（已量化，2026-06-24 掃描）
- src 內 `Pokemon`/`pokemon` 識別符：**137 處 / 32 檔**（扣除上述「不可改」的 URL/PokéAPI 字面）。
- 「寶可夢」：**32 處 / 24 檔** → 「Mobie」。
- 改檔名：`PokemonSprite.tsx`、`PokemonVisual.tsx`（含所有 import 路徑）。
- 品牌字串：`package.json` name、`index.html` title、`public/manifest.webmanifest`、docs（handoff/README/CLAUDE/ARCHITECTURE/plan/*）。
- repo 目錄 `pokemon-mezastar/` → `mobie/`（含 git remote；最後做、單獨一步）。

## 持久化遷移（改 key ＋ 向後相容）
7 個 key：`mz-cards`、`mz-models`、`mz-save-backup`、`mz.itembag.v1`、`mz.roster.v2`、`mz.savemeta.v1`、`mz.settings.v1`
→ `mobie-*` / `mobie.*`。
- **localStorage（roster/itembag/savemeta/settings）**：load 時加**一次性遷移**——先讀新 key，沒有就讀舊 key 搬過去
  （可選刪舊）。集中一個 `migrateKeys()` helper。
- **IndexedDB（cards/models/save-backup）**：開新 DB 名 `mobie-*` 並首次啟動搬遷，**或建議保留舊 DB 名**（key 純內部、
  不影響品牌、IDB 遷移成本高）——二選一明文記錄。
- **`.save` 檔**：`bundle.ts`/`saveMeta.ts` 的 manifest schema 加「舊欄位名／schemaVersion 識別」，匯入舊檔對映舊→新欄位
  （向後相容），匯出一律新格式。加 round-trip ＋ 舊檔匯入 vitest。

## 切分（放在 M16、M17 之後）
- **M18.a** 程式識別符＋檔名改名（型別/函式/元件/變數；含 import 路徑）＋ typecheck 綠。
- **M18.b** UI 中文「寶可夢」→「Mobie」＋ 品牌字串（title/manifest/package.json）。
- **M18.c** 持久化 key 改名 ＋ `migrateKeys()` ＋ `.save` 向後相容 ＋ vitest。
- **M18.d** docs 全域改名（handoff/README/CLAUDE/ARCHITECTURE/plan）。
- **M18.e** repo 目錄改名（最後、單獨；含 git remote 與 `npm run dev` 路徑確認）。

---

# 先後順序 · 驗證 · 待調參

## 先後順序與相依
1. **M16**（純 UI，無相依）→ 立刻修好痛點、建好 MobCard。
2. **M17**（複用 M7/M8 地基 ＋ M16 的 MobCard/revealedFoes）→ 看穿揭露對手深度資訊在此接上。
   - M16 落地到 M17 之前，對手深度區顯示占位「🔍 看穿後揭露」，非永久遮死。
3. **M18**（機械式大改動）→ **最後做**，避免與 M16/M17 的功能開發彼此衝突 merge。

## 驗證（各里程碑實作輪皆須）
- `npm run typecheck` && `npm test` && `npm run build` 全綠。
- M16：Chrome CDP（SwiftShader WebGL）戰鬥中點自己/對手開卡、Encounter/CardSelect 開卡，零 console error。
- M17：vitest 護欄（技能無直接傷害、關閉零殘留、hook 分流）＋ CDP 開模組→裝技能→戰鬥自動觸發鼓舞徽章
  ＋按看穿揭露對手卡＋訓練所花 SP 學/裝技能。
- M18：vitest（migrateKeys 舊→新搬遷、`.save` 舊檔匯入向後相容）＋ CDP 既有存檔升級後 roster/設定/背包不掉
  ＋ 立繪仍正常載入（驗證 artwork URL 未被誤改）。

## 待玩測調參（不阻塞）
- 看穿是否「每場一次」夠用 vs 每隻一次；對手卡揭露範圍（要不要連 IV 都給）。
- 自動技能數值上限與觸發門檻（鼓舞 ×?、守護 ×?、疾風 ×?）；起始 catalog 是否再加 1–2 技。
- SP 曲線（boss 給多少、學一技花多少、第 2 槽門檻）；partnerSkills 模組預設開或關。
- 改名 UI「Mobie」是否中文化為「小怪物」（目前定英文品牌字；可玩測再定）。
