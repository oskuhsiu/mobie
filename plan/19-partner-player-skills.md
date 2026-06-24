# 19 — Partner 技能系（M17，玩家/訓練師技能）

> 來源：使用者「玩家與 mob 是**夥伴而非從屬**」理念。**範圍修訂（2026-06-24）**：M17 現專指
> **玩家本人(訓練師)能用的帳號級技能**（看穿/全隊支援/丟道具），**不掛 OwnedUnit、無 per-creature 上限**。
> 原本掛在怪物身上的 buff（鼓舞/守護/疾風/回復/整地）**已下放成怪物變化招 → M19**（`17`）。
> 設計經四方 agent-chat 收斂：`.claude/agent-chat/session-20260624-012214/conclusion.md`。
>
> **拆檔說明（2026-06-24）**：原 `16-mobie-card-partner-rename.md` 已拆成三獨立檔——
> `16-mobie-info-card.md`（M16）、本檔（M17）、`20-rename-to-mobie.md`（M18）。
> 本檔是 **M17** 的真相來源；`CHECKLIST.md` / `handoff.md` 只引用。
>
> **執行順序（2026-06-24「先改名」）**：M18 改名 → M19 多招式 → M16 → M11。**M17 排在以上之後**
> （看穿要揭露的就是 M19 的招式/數值，且要接上 M16 的 MobCard）。

---

## 分界線（務必守）
**主動施放=招式（M19，佔槽，掛怪物）／被動常駐=特性（M7，掛怪物）／玩家自有工具=Partner 技能（M17，掛帳號）**。
玩家技能**不讀也不寫** `OwnedUnit` 的招式欄；它是訓練師的能力，跨怪物共用，靠玩家養成解鎖。

## 目標
玩家（訓練師）的帳號級戰術工具，**不綁單一怪物、無 per-creature 上限**。複用 M8 的 `fieldState`、顯示層 `revealedFoes`，
做到**戰鬥機制零 reducer/engine 改動**。範圍＝看穿（接 M16 揭露對手深度）＋全隊級訓練師支援＋（選）丟道具，以及 SP 取得。
**不含**：怪物招式 loadout/訓練/解鎖（→ M19）、合體技（M12.d）、對手 profile（M12.e）——各自里程碑。

## 啟動模型（玩家技能＝帳號級工具，非怪物身上的東西）
- **🔍 看穿（主動鈕、每場一次、純顯示層）＝核心**：
  按鈕 → 設 battleStore `revealedFoes.add(activeIndex)` ＋ FxCanvas 揭露演出 ＋ 扣每場一次預算
  （預算住 display state，不持久化）。**不進 reducer、不耗回合、對手不回擊**（純偵查，守相位契約）。
  M16 的 `MobCard`/`HpPlate` 讀 `revealedFoes` → 揭露對手深度資訊。**兩里程碑在此接合。**
- **全隊級訓練師支援（選配，帳號級）**：如「訓練師加油」一次性給全隊小 buff、或強化既有支援輪盤的權重。
  若純顯示/開場灌注（寫 `fieldState` 或 display 預算）＝零 reducer 改動；若要回合中改戰況再評估有界 action（**本輪不做**）。
- **丟道具（選配）**：訓練師於戰鬥中投擲消耗品（回復/淨化）——若做，走有界的玩家 action，留待後輪設計。

## 資料模型（玩家技能＝帳號級 slice，**不掛 OwnedUnit**）
```ts
// game/ext/partnerSkills.ts （catalog 手寫非產生檔）
type PartnerSkillId = string
interface PartnerSkillDef {
  id; name; icon; desc
  mode: 'active' | 'support'              // active＝主動鈕(看穿)；support＝開場/全隊一次性
  reveal?: boolean                        // active：揭露對手深度資訊
  effect?: { teamBuff?; terrainId?; turns? }   // support：寫 fieldState/display 預算，不進 reducer
}
// 玩家技能存在帳號級 slice（不掛任何怪物）：
// mobie.playerskills.v1 = { learnedSkillIds: PartnerSkillId[] }
```
- **怪物的招式欄（learnedMoveIds/equippedMoveIds）已移到 M19 的 `OwnedUnit`**；M17 不碰 OwnedUnit。
- 起始 catalog（小樣本）：🔍 看穿(active/reveal)、（選）📣 訓練師加油(support/teamBuff 一次性)、（選）🎒 丟道具(後輪)。
  原 鼓舞/守護/疾風/回復/整地 **已成怪物變化招（M19）**，不在此。

## SP 訓練經濟（與 M19 共用單一貨幣）
- **SP 錢包**：slice `mobie.skillpoints.v1`（帳號級單一數值）。**M17 玩家技能與 M19 怪物招式訓練共用同一 SP**。
- **SP 取得**：打贏 wild 區 **boss 給 SP**（接 `rosterStore` 勝利結算，與 `grantBattleExp` 同處）；塔層 SP 預留 M11。
- **訓練所 UI 分池**：玩家技能在「✨ 夥伴技能」分頁花 SP 解鎖（→ `mobie.playerskills.v1`）；怪物招式在「📖 招式」分頁（M19）。
  **兩分頁/兩成本表分池顯示**（codex 護欄），避免玩家誤以為同類；可同一 modal 兩 tab。
- **個體面板**：M16 `MobCard` 顯示的是**怪物的招式 loadout（M19）**；玩家技能顯示在夥伴技能分頁，不在怪物卡。

## 模組關閉時的行為（守可選式掛載）
`mobie.settings.v1` 加 `modules.partnerSkills` toggle（預設關）。關閉＝看穿鈕不顯示、支援不掛、
夥伴技能分頁可瀏覽但提示去設定開啟（比照 `TeamModal` 對道具/特性的提示）。

## 切分
- **M17.a** schema/catalog/persistence 純資料：`PartnerSkillDef`/起始 catalog ＋ 帳號級 `mobie.playerskills.v1` slice
  ＋ vitest（護欄：無直接傷害、不寫 OwnedUnit）。
- **M17.b** 看穿主動鈕：戰鬥行動列加「✨ 夥伴技能 → 🔍 看穿」鈕（每場一次，display state）＋ 揭露演出 ＋ 接 M16 `revealedFoes`。
- **M17.c**（選）全隊支援：開場/一次性 teamBuff 寫 `fieldState`（零 reducer 改動）。
- **M17.d** SP 取得 + 夥伴技能分頁（與 M19 招式分頁共用 SP、分池顯示）。

## 驗證
- `npm run typecheck` && `npm test` && `npm run build` 全綠。
- vitest 護欄（玩家技能無直接傷害、不寫 OwnedUnit、關閉零殘留）＋ CDP 開模組→按看穿揭露對手卡
  ＋夥伴技能分頁花 SP 解鎖玩家技能。

## 與 M12 / M19 的關係
- 原規劃「M17＝提前實作 M12 技能 loadout」**已修訂**：怪物招式 loadout/訓練/解鎖**全部移到 M19**（`17`）。
- M17 收斂為**純玩家(訓練師)技能**；M12 剩餘（合體技、對手 profile、孵化繼承）續留，改建在 M19 之上。
- `fieldState.teamStatuses/enemyStatuses` 子欄首次填用改由 **M19 怪物變化招**承擔；M17 的 support 技能亦可寫入。

## 待玩測調參（不阻塞）
- 看穿是否「每場一次」夠用 vs 每隻一次；對手卡揭露範圍（要不要連 IV 都給）。
- 玩家技能起始 catalog 是否再加 1–2 技（訓練師加油/丟道具）；partnerSkills 模組預設開或關。
- SP 曲線（boss 給多少、玩家技能 vs 怪物招式各花多少）——M17/M19 共用 SP 但分池成本。
