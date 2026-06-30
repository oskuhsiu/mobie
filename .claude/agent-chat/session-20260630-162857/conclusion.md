結論：星擊 cut-in 重做規格（四方圓桌共識 + 示意圖確認）

核心診斷（一致）：現況弱在沒有「蓄力→爆發→衝擊」的節奏弧、卡片靜態貼圖與 3D 場景脫節、per-type 只換邊框色。
解法不是加更多資訊/粒子，而是用「極端對比」榨乾現有武器：極暗/極亮、極慢/極快、空寂/轟然。

拍板規格：三拍弧（juice 控制，off 回退單純 orb）
- 拍1 蓄力（0–700ms）：R3F 舞台 timeScale→~0.15 慢鏡 + 環境光壓暗；FxCanvas 從四邊吸入 per-type 尾跡粒子匯聚中心；
  Tone.js lowpass filter sweep 200→8000Hz + tremolo；letterbox 滑入。卡片還沒出。
- 拍2 蓋章（~700–800ms）：卡片像「認證印章」啪地砸到中心（scale 1.5→1 硬切、非慢彈）+ 80ms 硬 freeze
  (coordinator.pause) + 印章 tick 音。儀式高潮。
- 拍3 衝擊（800ms+）：卡片 filter:brightness 瞬間衝白 + FxCanvas globalCompositeOperation='lighter' 畫單一
  巨大擴散星核/環填滿螢幕 + 白閃；screenshake×1.5 + Tone sub-bass noise；timeScale snap 回 1 + 相機急推；接既有傷害演出後 resume。

三拍板點裁決：
(A) 慢鏡只動 R3F 舞台本身，卡片維持銳利 DOM 絕對定位（全體同意）——刻意製造「3D 戰場被凍結 vs 2D 儀式超然其上」。
(B) 接真 timeScale（全體同意）：Combatant3D 的 useFrame delta（與相機）乘倍率，範圍限縮；FxCanvas 自走 rAF、
    Tone 走獨立 Web Audio clock 保持 real-time 剛好脫鉤；low-juice / prefers-reduced-motion 回退「凍結」。
    我 coordinator 預留的 setTimeScale stub 正好接這條。
(C) 效能/相容鐵則（gemini 提、codex 附議，覆蓋 mistral 的 color-dodge）：絕不在疊 WebGL canvas 的 DOM 上用
    mix-blend-mode（iPad Safari 極易掉幀/破圖）；改用廉價 filter:brightness() 衝白卡片，全屏過曝交給 FxCanvas
    globalCompositeOperation='lighter' 畫單一大圓。其他雷：大量全屏粒子（限 ~200）、多層全屏 blur；filter sweep
    相對安全但要先 audio unlock。

per-type ＝ 改「粒子行為+形狀+音」非只顏色：火=噴濺火星 / 水=同心波紋(ring 已有) / 電=鋸齒閃線(streak) /
草=旋葉(shard) / 幽靈=殘影拖尾。

優先級（首版）：Must-have = 拍1（吸入蓄力）+ 拍2（蓋章定格），這是儀式感與重量的靈魂；拍3 先做廉價版
（白閃 + 單一大 lighter 星核/環）。

被否決：mistral 一度建議把 PokéAPI sprite 貼到 R3F 3D 平面放大環繞 → gemini/codex 反對（低解析放大變玩具紙片、
打亂分層）。結論：sprite 留銳利 DOM 卡片，3D 只負責戰場慢鏡/壓暗/相機。

示意圖確認：第 3 輪三位各畫了拍1/拍2/拍3 的 ASCII 示意圖，版面高度一致（黑邊位置、粒子四邊吸入方向、卡片中心落點、
全屏擴散環範圍皆吻合），確認「文字描述」與「腦中畫面」一致，可開工。