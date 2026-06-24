# 16 — Mobie 資訊卡（M16）

> 來源：使用者實玩回饋——戰鬥中**看不到自己夥伴的型別/招式/數值**。
> 本檔是 **M16** 的真相來源；`CHECKLIST.md` / `handoff.md` 只引用，不重抄。
>
> **拆檔說明（2026-06-24）**：原 `16-mobie-card-partner-rename.md` 已拆成三獨立檔——
> 本檔（M16 資訊卡）、`19-partner-player-skills.md`（M17 玩家技能）、`20-rename-to-mobie.md`（M18 改名）。
> 共同身分軸線：「你的 mob 是**夥伴**，這個遊戲叫 **Mobie**」。
>
> **執行順序（2026-06-24 使用者拍板「先改名」）**：M18 改名 → M19 多招式 → **M16（本檔）** → M11。
> 理由：M16 招式區要顯示招式細節，待 **M19 多招式**落地後一次做對（顯示 4 招 loadout），不為單招而建再返工。

---

## 已拍板的設計決策（使用者）
1. **自己夥伴資訊一律完整可見**；對手**基本面**（名稱/型別/Lv）免費，**深度**（精確招式/數值/IV 星級）**鎖在「看穿」後**（看穿＝M17 玩家技能，見 `19`）。
2. **守住硬約束**：純 UI／顯示層，**不動 reducer/engine/持久化**、高頻值只走 ref/rAF/Zustand、不內建侵權資產（artwork 走 PokéAPI runtime URL）。

## 目標
可複用、精美的檢視卡，顯示任何 mob 的完整資訊。自己的夥伴一律全顯示；對手基本面全顯示、深度資訊遮罩
（給 M17 看穿揭露）。**純 UI／顯示層，不動 reducer/engine/持久化。**

## 現況缺口（已查證）
- `BattleMobie`（M18 改名後；原 `BattlePokemon`，`game/types.ts`）早已含全部資料：`types`、招式（id/nameZh/type/power/accuracy/category）、
  解析後六維、`ivs`/`nature`/`shiny`、`heldItemId`/`abilityId`。但 UI 從沒把招式細節揭露給任何 mob。
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
| 招式 loadout（≤4 招，M19） | 全顯示（**M19 落地後＝上方招式區擴成 4 招**） | 遮罩（看穿後揭露） |
| （玩家技能不在怪物卡） | — 玩家技能屬訓練師、顯示在夥伴技能分頁 | — |

**開啟點（tap-to-inspect）**：
- **BattleScreen**（核心修復）：點自己的 `HpPlate` → 自己全卡；點對手 `HpPlate`/`TeamTray` 成員 → 對手卡
  （`revealed` 接 battleStore 看穿旗標，M17 前恆 false → 顯示占位）。
- **EncounterScreen**：點任一對手隊伍縮圖 → 對手卡。
- **CardSelectScreen**：點自己的 `poke-card` → 自己全卡；點對手條 `foe-strip__mon` → 對手卡
  （保留既有 inline 徽章與點選出戰手感，開卡走 ⓘ 角標或長按）。

## 複用 / 新增
- **複用**：`.modal-backdrop`/`.modal-card`（global.css）、`TypeBadges`（TypeBadge.tsx）、`IndividualInfo`
  （已有 detailed IV 模式）、`MobieSprite`（M18 改名後；原 `PokemonSprite`）、`getItem`/`getAbility`、`TYPE_LABEL_ZH`/`typeColor`（typeMeta.ts）。
- **新增**：`MobCard.tsx`、六維 mini-bar 與招式 row 的少量 CSS、各畫面 onClick 接線、
  battleStore 加 `revealedFoes`（M17 用；M16 先放空 set）。

## 切分（每步綠燈即 commit）
- **M16.a** `MobCard.tsx` ＋ CSS（吃 `BattleMobie`+`revealed`，先在 Encounter 接一個開啟點驗證）。
- **M16.b** 戰鬥中接線：點 HpPlate/TeamTray 開卡（自己全顯、對手遮罩占位）。
- **M16.c** CardSelect 接線（自己卡＋對手卡）。

## 驗證
- `npm run typecheck` && `npm test` && `npm run build` 全綠。
- Chrome CDP（SwiftShader WebGL）戰鬥中點自己/對手開卡、Encounter/CardSelect 開卡，零 console error。

## 與其他里程碑的關係
- **M19（`17`）**：MobCard 招式區於 M19 多招式落地後顯示 4 招 loadout。**故 M16 排在 M19 之後**。
- **M17（`19`）**：玩家「看穿」主動鈕設 `revealedFoes` → MobCard 讀它揭露對手深度。兩里程碑在 `revealedFoes` 接合。M16 先放空 set，對手深度區顯示占位「🔍 看穿後揭露」，非永久遮死。
