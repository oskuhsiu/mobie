# 21 — 戰鬥技能特效系統（M21；簡單低成本、非電影級）

> 來源：使用者要求「每個技能都要有特效……可以先做簡單特效，比如火系一個、物理一個、水系一個……
> 因為成本關係不要求電影級，用來增加效果（打擊感）」。
> 設計經四方 agent-chat（Claude / gemini / codex / mistral）round-robin，**3 輪全體 agree、無未解分歧**，
> 結論全文：`.claude/agent-chat/session-20260624-112739/conclusion.md`。
>
> **本檔是 M21 的真相來源**；`CHECKLIST.md` / `handoff.md` 只引用，不重抄。
> **一句話**：特效 = `type（材質）× category（投放）` 正交組合，宣告式純資料表驅動，FxCanvas 擴一個 `travel`
> 原語，演出全留 display 層（reducer/event 不動）。

---

## 0. 現況與痛點

- 既有特效層 `src/scene/fx/FxCanvas.tsx`：imperative canvas2D 粒子層（**不過 React state，守效能紅線**），
  自有 rAF 迴圈、閒置即停。原語只有三個：`burst({nx,ny,color,count,power,kind:'hit'|'spark'|'puff'})`、
  `ring({nx,ny,color})`、`flash(color,alpha)`。
- `src/ui/typeMeta.ts`：`TYPE_HEX: Record<TypeName,string>`（18 型 hex，對齊 `global.css` 的 `--t-*`）。
- `BattleScreen.playEvents`（`src/ui/screens/BattleScreen.tsx`）在 `damageApplied` 時：
  從 `e.resolvedMoveId`（M19.b 起，多招式下對手也用非 slot0 招）解析實際出招 → `TYPE_HEX[move.type]` 上色 →
  `fxRef.current?.burst(...)`；會心加金星 spark+ring+flash、效果絕佳加 ring；另有 3D `lunge/hitReact`、
  `rootShake`、Tone.js `audio.play('hit'|'super'|'crit')`。
- **痛點**：所有招式特效**形狀其實都一樣**（放射狀 `burst`），只是換顏色。火/水/草「看起來一樣」、
  物理近戰 vs 特殊遠程波無區分、變化招（M19.d）還沒特效。**這正是本里程碑要補的「打擊感差異化」。**

## 1. 設計主軸：`type × category` 正交（最終定案）

特效以**兩個既有 canonical 欄位**為 key，**不做個別招式特效**（數十上百招 ROI 太低、維護爆炸，agent-chat 全體否決）：

- **`Move.type`（18 型）→ 材質**：顏色（palette）、粒子形狀（dot/streak/shard）、音色。
- **`Move.category`（physical/special/status）→ 投放**：運動軌跡 / 目標位置 / ring / flash。

> 兩欄皆**已存在於 `game/types.ts`**（`Move.type: TypeName`、`Move.category: 'physical'|'special'|'status'`、
> 變化招 `Move.effect: MoveEffect` 亦已為 M19.d 預留）——**本里程碑零資料 schema 變更、零 reducer 變更**。

正交組合本身就是「preset」（如 `fire × physical` ＝ 紅色上衝撞擊），**不另開具名 `fxPresets` 表**（會變第三真相、
與正交表打架）。真正套不進正交的個案才走 `moveFxOverrides[moveId]` 逃生口。

```
一招特效 = typePalette[move.type] ⊕ classDelivery[move.category] ⊕ moveFxOverrides[move.id]
```

## 2. 資料模型（宣告式純資料，**嚴禁存 function/callback**）

新檔 `src/scene/fx/fxCatalog.ts`（純資料 + 純合成函式，無 React、無 imperative 繪製）：

```ts
import type { TypeName, MoveCategory } from '@/game/types'

/** 材質：顏色 / 粒子形狀 / 音色。住 typePalette，逐型一筆。 */
export interface FxRecipe {
  colors: string[]                      // 1–3 色（主色 + accent），對齊 global.css --t-*
  shape: 'dot' | 'streak' | 'shard'     // dot=圓點(預設) / streak=拉長條紋 / shard=尖碎片
  sound?: string                        // 選配音色 key；缺省沿用 category/結果預設
}

/** 投放：軌跡 / 目標 / ring / flash。住 classDelivery，三筆。 */
export interface ClassDelivery {
  mode: 'impact' | 'travel' | 'aura'    // impact=守方定點爆發 / travel=攻→守拋射 / aura=攻方原地光暈
  ring?: boolean
  flash?: number                        // 0–1 螢幕閃光強度；缺省不閃
}

/** 逃生口：個案微調，**收窄**避免變後門。初期空表。 */
export interface MoveFxOverride {
  paletteAccent?: string
  intensity?: number                    // 粒子數 / power 係數
  durationScale?: number
  sound?: string
  deliveryTweak?: { speed?: number; arc?: number; scale?: number }  // **不能改 mode**
}

export const typePalette: Record<TypeName, FxRecipe>        = { /* M21.b 逐型 */ }
export const classDelivery: Record<MoveCategory, ClassDelivery> = {
  physical: { mode: 'impact', ring: false },
  special:  { mode: 'travel', ring: true },
  status:   { mode: 'aura' },
}
export const moveFxOverrides: Record<number, MoveFxOverride> = {}   // 初期空

/** 純合成：把三層疊成一份「演出指令」（仍為純資料，給 display 層的 playMoveFx 消費）。 */
export function resolveFx(type: TypeName, category: MoveCategory, moveId: number) { /* ⊕ 合成 */ }
```

**責任邊界（codex/mistral 收窄，務必守）**：`colors/shape/sound` 歸 `typePalette`；`mode/ring/flash` 歸
`classDelivery`；個案微調歸 `moveFxOverrides`。`deliveryTweak` **只能調 speed/arc/scale、不能改 mode**，
override **不新增專屬流程**。`colors`（非 `palette`）避免與表名衝突。

> **持久化**：無。fxCatalog 全為 runtime 常數資料，不進 roster/save。**不是 generated 檔**（手寫維護，
> 比照 `data/terrains.ts`）——與 `species/moves/regions/playerCards.ts` 產生檔無關。

## 3. FxCanvas 擴充（最終四原語 `burst / ring / flash / travel`）

- **新增 `travel` 原語**（採 codex 版，**否決**「給 burst 加 start/end/speed 參數」或「沿途反覆呼叫 burst」）：
  單一 rAF item 自畫 `core + trail`（從 `fromPos` 平移到 `toPos`），**抵達時觸發一次 impact burst**。
  生命週期 / 取消 / 疊招由它自管，不污染 `burst`。
  ```ts
  travel: (o: { from:{nx,ny}; to:{nx,ny}; color:string; speed?:number; arc?:number; onArrive?:'impact' }) => void
  ```
  > `onArrive` 不是存 callback（守「嚴禁 function」）——是 enum 旗標，到點後 FxCanvas 內部自放一次 impact burst。
- **`burst` 擴 `shape` 參數**（dot/streak/shard）：現有 `kind:'hit'|'spark'|'puff'` 保留（crit 金星/倒下灰煙仍用）；
  `shape` 控粒子幾何（dot=圓、streak=拉長、shard=尖碎），模擬「圓點水滴 / 條紋電光 / 碎片岩石」。
- `ring` / `flash` 不動。

`FxHandle` 最終 = `burst / ring / flash / travel` **四個，到頂**（不再擴）。全程序化生成、零侵權資產。

## 4. 整合（display 層 helper，**不引 Zustand 佇列**）

- 新增 display 層 helper `playMoveFx(fxRef, recipe, fromPos, toPos)`（住 BattleScreen 或 `scene/fx/`）：
  讀 `resolveFx(...)` 合成結果 → 依 `mode` 一次性點原語（impact→burst@to / travel→travel(from→to,onArrive:impact) /
  aura→burst@from 上升光暈）+ `ring/flash` + `audio.play(recipe.sound ?? 預設)`。
- **否決 Zustand FxCommand 佇列**（codex 原議）：「一份 recipe 同時宣告視覺＋soundKey」已滿足音畫同源；
  現有 `playEvents` 的 `fxRef.current?.burst()` + `await wait()` 時序（banner→hit→fx）已在 display 層，
  改佇列是大重構且無收益。
- `BattleScreen.playEvents` 的 `damageApplied` 分支：把現有「直驅 `burst` 上色」**換成 `playMoveFx`**
  （`fromPos = FX_POS[attackerSide]`、`toPos = FX_POS[targetSide]`）。
- **crit / 效果絕佳既有演出疊加其上**（額外層、**不取代**）：命中後仍加金星 spark + ring + flash（`#ffd23f`）。
- **reducer / event schema 不動**——本就從 `resolvedMoveId → move.type/category` 反查，event 無動畫語意
  （守「純 reducer 不含 UI/動畫字眼」）。**高頻值仍只走 ref/rAF**（FxCanvas 自有 rAF），`resolveFx` 查表
  是每事件一次性、直驅無虞。

## 5. 變化招（M19.d）特效預留 — `aura` 模式

- `category === 'status'` → `classDelivery.status.mode = 'aura'`：攻方原地上升光暈（buff=向上金/綠粒子、
  無撞擊），由 `move.effect.kind`（buff/heal/terrain）微調色相。
- 掛在 M19.d 將發的 `statusApplied` / 既有 `heal` event（**非 `damageApplied`**，變化招無傷害）。
- **不阻塞**：傷害招（physical/special）特效 M21.a–c 先全覆蓋，status/aura 併 M19.d 最後接（M21.d）。

## 6. 守住的不變式（自我檢核表）

| 風險 | 守法 |
|---|---|
| 破純 reducer | 特效全在 display 層；reducer/event 不含 fx 字眼，從 `resolvedMoveId→type/category` 反查。 |
| 破高頻值紅線 | FxCanvas 自有 rAF/ref，`travel` 亦走 rAF；`resolveFx` 查表每事件一次性，不寫 React 頂層 state。 |
| 侵權資產 | 全程序化粒子/幾何生成，零外部素材。 |
| 資料表腐化成第三真相 | 不開 `fxPresets`；正交組合即 preset，個案才走收窄的 `moveFxOverrides`（不能改 mode）。 |
| override 變後門 | schema 收窄成 accent/強度/節奏/音色/deliveryTweak（speed/arc/scale），不新增流程，初期空表。 |
| 存 function 進資料 | catalog 全宣告式純資料；`travel` 的 `onArrive` 是 enum 旗標非 callback。 |
| FxCanvas 原語膨脹 | 封頂四原語 burst/ring/flash/travel；`burst` 只加 `shape` 參數不再生新 kind 函式。 |
| 變化招拖累傷害招上線 | status/aura 排 M21.d 併 M19.d，傷害招 M21.a–c 先獨立全覆蓋。 |

## 7. 開發切分（每步 typecheck+test+build 綠燈即 commit；先跑通骨架、再鋪 18 型）

| 子步 | 內容 | 核心工作 |
|---|---|---|
| **M21.a** | FxCanvas `travel` + `burst.shape`；helper 跑通 | 加 `travel` 原語（core+trail+抵達 impact）、`burst` 吃 `shape`；`fxCatalog.ts` 骨架（三 classDelivery + 預設 palette）；`playMoveFx` helper + `resolveFx` 純合成；單測（resolveFx 三層合成/override 收窄/預設 fallback）。 |
| **M21.b** | 18 型 typePalette + 接線 | 逐型上色（對齊 TYPE_HEX）+ 形狀指派（火=shard 上衝、水=dot 下墜、電=streak…）；`BattleScreen.damageApplied` 改用 `playMoveFx` 取代現有直驅 `burst`。 |
| **M21.c** | physical/special 投放差異 + 逃生口落地 | impact（近戰定點）vs travel（遠程拋射）手感打磨；`moveFxOverrides` schema + 合成路徑落地（空表）；CDP 抽驗數型。 |
| **M21.d** | status/aura（併 M19.d 變化招） | `aura` 模式 + 掛 `statusApplied`/`heal` event；buff/heal/terrain 色相微調；不阻塞傷害招。 |
| **M21.e（選配）** | per-type Tone.js 音色 | 火=噪音爆、電=高頻 zap、水=低頻…；recipe `sound` key 接 audio 引擎擴充音色。 |

**驗收**：`npm run typecheck && npm test && npm run build` 全綠；Chrome CDP（SwiftShader WebGL）驗
18 型 + 三投放（impact/travel/aura）+ 變化招特效正確、零 console error（比照既有里程碑 CDP 慣例）。

## 8. 待玩測調參（不阻塞）
- `travel` 速度 / 弧度（`arc`）手感；各型 palette 美感與辨識度；`dot/streak/shard` 三形狀是否夠用（不夠再議第 4 形狀）。
- crit/super 金星疊加在新特效上會不會過曝（必要時降強度）。
- 是否要 M21.e 音色（視 v1 打擊感是否已足）。
- override 逃生口最終要不要對少數招牌招（如星擊對應招）開特例。
