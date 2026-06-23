# 圓桌結論 — 延伸系統設計審查（plan/09）

## 任務
審查 5 個選定延伸系統（1 道具 / 6 羈絆 / 5 連鎖 / 8 進化 / 13 連勝塔）+ 統一掛載機制的設計草案，抓漏洞、確認不變式不破、定落地順序。三方達成完全共識（gemini/codex 末輪皆 agree）。

## 共識裁決（已全數回寫 plan/09）
- **Q1 掛載地基**：維持 `resolveTurn(state, action, {rng, ext})` 注入純能力包；`ext` 預設 `{}`＝行為等同 M1.x、69 測試不動。reducer 不認業務名詞，組裝 `ext` 的 `assembleExt` 住 store 層。直接改 reducer（塞 `if(enabled)`）被否決。**空物件＝零殘留**。
- **Q2 持久化邊界**：itemBag / runState / settings 為**獨立 save slice**（不同命名空間）。「只存 canonical OwnedUnit」約束的是 roster 序列化。**防火牆不變式**：RunState 暫態（runHp/runModifiers）絕不逆寫 OwnedUnit，只能在節點/run 結算核發獎勵寫回 roster；中斷續玩用的 runHp 快照不算違反「不存 derived/RNG 中間態」。
- **Q3 連鎖相位**：`SUBMIT_CHAIN_RESULT` = 玩家該回合唯一攻擊宣告；**吃速度**（非 priority 特例）；payload 只是玩家輸入(quality)非權威傷害，reducer 須**重新驗證**參與者存活/目標仍為同一 enemy active，否則 no-op/截斷（防幽靈傷害）；active 敵倒下截斷剩餘 hits、不轉移、不為連鎖特例化 KO 反擊。
- **Q4 進化/羈絆時機**：run 內 EXP/進化**延到節點/run 結算、下一場生效**（不引入 run-scoped snapshot）；羈絆只在出戰隊伍**組成**變更時重算，戰鬥內換 active 不重算（避免 mid-battle 重算撞 HP 持續不變式）。

## 最重要產出：§0.4 回合相位契約（M6.0 地基）
草案原把相位寫死「玩家先手→敵方」——gemini 抓出**致命 bug**（牴觸既有速度 `playerActsFirst`）。修正為：
- 玩家回合 = 一個動作宣告（互斥）：攻擊型 `ATTACK`(starStrike 為其 mode)/`SUBMIT_CHAIN_RESULT`；換人型 `SWITCH`(例外)。
- 攻擊型吃速度排先後 → 先手結算→KO/強制換→後手結算→KO/強制換。
- 收尾：全 resolve 後若 winner===null → S4 turnEndTrigger(剩飯等) → turn+1 → **最後**才 MAX_TURNS timeout（S4 在 timeout 前，回合末 HP 變動納入 timeout 比例）。
- `starStrike` 收斂成 `ATTACK` mode、非獨立 action。
- 此契約**前移 M6.0** 當地基重構（道具依賴 S4 精確時機、連鎖依賴行動互斥）。

## 落地順序（定案）
M6.0（掛載地基 + §0.4 契約 + reducer 重構 + tests）→ M6.a 羈絆（最乾淨先驗證）→ M6.b 道具 → M6.c 進化 → M6.d 連鎖 → M6.e 連勝塔。各子步：純函數先 vitest → UI 接線 → Chrome CDP 實機 → 綠燈即 commit。

## 未解 / 留玩測
道具池內容與數值、synergy 規則集、進化等級門檻、連鎖槽速率與最多隻數、連勝塔節點權重/層數/獎勵曲線/營火回血、settings 預設。皆列 plan/09 §9。

## 三方立場
gemini：力挺 ext 注入抽象、獨立 slice + 防火牆、抓出相位 bug、主張契約前移 M6.0。
codex：給出連鎖硬規則 + run EXP 延後 + 羈絆重算時機 + starStrike=mode + S4 在 timeout 前 + 連鎖吃速度 + payload 非權威須重驗。
Claude：彙整收斂、回寫文件、定落地序。**無未解分歧**，架構判定「足夠堅固、可動工」。
