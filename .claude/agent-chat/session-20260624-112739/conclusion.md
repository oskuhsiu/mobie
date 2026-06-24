# 結論 — mobie 戰鬥技能特效系統（簡單低成本版，M21）

四方圓桌（Claude / gemini / codex / mistral）round-robin，**3 輪達全體 agree、無未解分歧**。

## 一句話定案
特效以「**type（材質）× category（投放）正交組合**」為 key，**不做個別招式特效**；
資料走宣告式純資料表（typePalette ⊕ classDelivery ⊕ moveFxOverrides 逃生口）；
FxCanvas 由現有 burst/ring/flash 擴成 **burst/ring/flash/travel 四原語**；
演出全留 display 層（playMoveFx helper 直驅，reducer/event 不動）。

## 各方立場與收斂
- **共同起點（全體一致）**：type×category 正交解耦——**type 只決定材質**（顏色/粒子形狀/音色）、**category 只決定投放**（軌跡/目標/ring/flash）；個別招式 ROI 太低、維護爆炸，**否決**。資料表必為**宣告式純資料、嚴禁存 function/callback**（gemini：純資料才能做調參工具熱更新；codex：TS literal config + union schema 即可，不必硬 JSON-serializable，型別推導反而防呆）。
- **分歧 1：travel 怎麼實作**——gemini/mistral 想避免新原語（給 burst 加 start/end/speed 參數、或移動中反覆呼叫 burst 產生拖尾）；codex 主張獨立 `travel` 原語（單一 rAF item 自畫 core+trail、抵達觸發一次 impact burst，生命週期/取消/疊招好控）。**裁定採 codex 版**：獨立 travel 比污染 burst 更省心智，gemini 明確被說服。
- **分歧 2：要不要 Zustand FxCommand 佇列**——codex 提（音畫同源、event schema 不含 fx 字眼）。**裁定不引入**：用「一份 recipe 同時宣告視覺＋soundKey」即滿足音畫同源；現有 playEvents 直驅 + await wait 時序已在 display 層，改佇列是大重構無收益；reducer/event 不含 fx 字眼「現已滿足」（從 resolvedMoveId→type/category 反查）。gemini 買單。
- **分歧 3：要不要 fxPresets 具名組合表**——mistral 提（DRY "fire-physical"）。**裁定不要**：正交組合本身就是 preset，再開具名表會變第三真相、和正交表打架。真正套不進的個案才走 moveFxOverrides。
- **codex/mistral 收窄（已納入）**：moveFxOverrides 收窄成 `{ paletteAccent?, intensity?, durationScale?, sound?, deliveryTweak?{speed?,arc?,scale?} }`，**deliveryTweak 不能改 mode**、不新增專屬流程、初期空表；責任邊界 `shape` 歸 typePalette、`ring/flash/mode` 歸 classDelivery；`palette`→`colors` 避免與表名衝突。
- **音效範圍（Claude 收，全體接受）**：v1 recipe 帶 optional soundKey、預設沿用既有 hit/super/crit；per-type Tone.js 音色列**獨立選配子步**，不卡視覺主線。

## 最終 schema
```
FxRecipe(材質, typePalette)        = { colors: string[]; shape: 'dot'|'streak'|'shard'; sound?: string }
ClassDelivery(投放, classDelivery) = { mode:'impact'|'travel'|'aura'; ring?: boolean; flash?: number }
MoveFxOverride(逃生口, moveFxOverrides) = { paletteAccent?; intensity?; durationScale?; sound?; deliveryTweak?{speed?;arc?;scale?} }
一招特效 = typePalette[move.type] ⊕ classDelivery[move.category] ⊕ moveFxOverrides[move.id]
```
既有型別已支撐：`Move.category:'physical'|'special'|'status'` 與 `Move.effect`（M19.d）皆已存在。

## FxCanvas 與整合
- 四原語 burst/ring/flash/travel。travel=單一 rAF item 自畫 core+trail、抵達觸發一次 impact burst；burst 擴 shape（dot/streak/shard）。
- display 層 `playMoveFx(recipe, fromPos, toPos)` 讀 catalog 一次點原語＋audio。crit/super 既有金星 spark+ring+flash **疊加其上**（額外層、不取代）。
- 守住：reducer/event 不動、高頻值仍走 ref/rAF、特效全程序化生成（零侵權資產）。

## 開發切分（M21.a–e）
- **M21.a** FxCanvas 加 travel + burst.shape；playMoveFx helper + classDelivery 三模式跑通（全型別共用預設 palette）。
- **M21.b** 18 型 typePalette 逐型上色/形狀；BattleScreen damageApplied 接 playMoveFx 取代現有直驅 burst。
- **M21.c** physical/special 投放差異打磨（impact vs travel）；moveFxOverrides 逃生口 schema 落地（空表）。
- **M21.d** status/aura（併 M19.d 變化招，掛 statusApplied/heal event；不阻塞傷害招全覆蓋）。
- **M21.e（選配）** per-type Tone.js 音色。
每步 typecheck+test+build 綠燈即 commit；最後 Chrome CDP（SwiftShader）驗 18 型 + 三投放 + 變化招特效、零 console error。

## 無未解分歧
全部三點裁定皆獲明確 agree；待玩測微調（不阻塞）：travel 速度/弧度手感、各型 palette 美感、shard/streak 三形狀夠不夠用、是否要 M21.e 音色。
