import { motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { useGame } from '@/app/GameProvider'
import { canCaptureIn } from '@/game/data/regionLookup'
import { ToolsMenu } from '@/ui/components/ToolsMenu'
import {
  TaskHeader,
  UtilityDock,
} from '@/ui/shell/AppShell'
import {
  readRegionHubCatalog,
  regionCaptureLabel,
  regionLevelLabel,
  regionModeLabel,
  regionTerrainLabel,
  shouldInjectRegionHubFailure,
  type RegionHubCatalogResult,
} from './regionHub'

export function RegionSelectScreen() {
  const { send } = useGame()
  const primaryRegionRef = useRef<HTMLButtonElement>(null)
  const [catalogState, setCatalogState] = useState<RegionHubCatalogResult>(() => readRegionHubCatalog(shouldInjectRegionHubFailure()))

  useEffect(() => { primaryRegionRef.current?.focus() }, [])

  if (catalogState.status === 'error') {
    return (
      <div className="region-hub region-hub--error" data-region-hub data-region-hub-state="error">
        <div className="region-hub__error" role="alert" data-region-error>
          <div className="region-hub__error-icon" aria-hidden="true">⚠️</div>
          <div className="eyebrow">Adventure Hub</div>
          <h1 className="h-title">區域資料需要再試一次</h1>
          <p className="h-sub">{catalogState.message}</p>
          <div className="row region-hub__error-actions">
            <button className="btn" data-region-error-retry onClick={() => setCatalogState(readRegionHubCatalog())}>重新嘗試</button>
            <button className="btn btn--ghost" data-region-error-back onClick={() => send({ type: 'BACK' })}>返回首頁</button>
          </div>
        </div>
      </div>
    )
  }

  const { practice, regions } = catalogState.catalog

  return (
    <div className="region-hub" data-region-hub data-region-hub-state="ready">
      <div className="region-hub__scroll region-grid" data-region-scroll-owner>
        <div className="region-hub__topbar">
          <span className="eyebrow">Adventure Hub</span>
          <button className="btn btn--ghost btn--sm" onClick={() => send({ type: 'BACK' })}>🏠 首頁</button>
        </div>

        <TaskHeader
          className="region-hub__header"
          eyebrow="Step 1 · Choose a destination"
          title="選擇目的地"
          tagline="先看懂模式與場域，再決定今天要練等、爬塔，或捕獲新的夥伴。"
        />

        <section className="region-hub__section" aria-labelledby="region-modes-heading">
          <div className="region-hub__section-heading">
            <div>
              <div className="eyebrow">Modes</div>
              <h2 id="region-modes-heading">先選模式</h2>
            </div>
            <p>先用競技場熟悉節奏，或挑戰連勝塔累積更高的遠征獎勵。</p>
          </div>
          <div className="region-modes">
            <motion.button
              ref={primaryRegionRef}
              className="practice-cta region-mode-card"
              data-region-mode="arena"
              whileTap={{ scale: 0.98 }}
              onClick={() => send({ type: 'SELECT_REGION', regionId: practice.id })}
            >
              <span className="practice-cta__icon" aria-hidden="true">{practice.icon}</span>
              <span className="practice-cta__body">
                <span className="region-mode-card__eyebrow">{regionModeLabel(practice)} · {regionCaptureLabel(practice)}</span>
                <span className="practice-cta__title">{practice.name}</span>
                <span className="practice-cta__sub">{practice.blurb}</span>
                <span className="region-mode-card__meta">{regionTerrainLabel(practice)} · {regionLevelLabel(practice)}</span>
              </span>
              <span className="practice-cta__go">開始 →</span>
            </motion.button>

            <motion.button
              className="practice-cta tower-cta region-mode-card"
              data-region-mode="tower"
              whileTap={{ scale: 0.98 }}
              onClick={() => send({ type: 'OPEN_TOWER' })}
            >
              <span className="practice-cta__icon" aria-hidden="true">🗼</span>
              <span className="practice-cta__body">
                <span className="region-mode-card__eyebrow">連勝 Tower · 連續戰鬥</span>
                <span className="practice-cta__title">連勝塔 · 遠征</span>
                <span className="practice-cta__sub">連續對戰、樓層越高敵越強；通關得 SP 與難度解鎖。輸一場即結算。</span>
                <span className="region-mode-card__meta">固定隊伍 · 不可捕獲</span>
              </span>
              <span className="practice-cta__go">挑戰 →</span>
            </motion.button>
          </div>
        </section>

        <section className="region-hub__section" aria-labelledby="region-atlas-heading">
          <div className="region-hub__section-heading">
            <div>
              <div className="eyebrow">Wild atlas · {regions.length} destinations</div>
              <h2 id="region-atlas-heading">捕獲區域</h2>
            </div>
            <p>每張卡都標示真實地形、遭遇等級與首領捕獲資格。</p>
          </div>
          <div className="region-atlas" data-region-atlas>
            {regions.map((region) => {
              const modeLabel = regionModeLabel(region)
              const captureLabel = regionCaptureLabel(region)
              const terrainLabel = regionTerrainLabel(region)
              const captureEligible = canCaptureIn(region.id)
              const descriptionId = `region-description-${region.id}`
              const metadataId = `region-metadata-${region.id}`
              return (
                <motion.button
                  key={region.id}
                  className="region-card"
                  data-region-card
                  data-region-id={region.id}
                  data-region-mode={region.mode}
                  data-capture-eligibility={captureEligible ? 'capturable' : 'uncapturable'}
                  aria-label={`${region.name}，${modeLabel}`}
                  aria-describedby={`${descriptionId} ${metadataId}`}
                  style={{ background: `linear-gradient(150deg, ${region.gradient[0]}, ${region.gradient[1]})` }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => send({ type: 'SELECT_REGION', regionId: region.id })}
                >
                  <span className="region-card__glow" />
                  <span className="region-card__head">
                    <span className="region-card__icon" aria-hidden="true">{region.icon}</span>
                    <span className="region-card__mode">{modeLabel}</span>
                  </span>
                  <span className="region-card__body">
                    <span className="region-card__name">{region.name}</span>
                    <span id={descriptionId} className="region-card__blurb">{region.blurb}</span>
                  </span>
                  <span id={metadataId} className="region-card__meta">
                    <span className="region-card__terrain" data-region-terrain>{terrainLabel}</span>
                    <span className={`region-card__capture ${captureEligible ? 'region-card__capture--yes' : 'region-card__capture--no'}`} data-capture-label>{captureLabel}</span>
                    <span className="region-card__levels">{regionLevelLabel(region)}</span>
                  </span>
                </motion.button>
              )
            })}
          </div>
        </section>
      </div>

      <div className="region-tools region-hub__footer">
        <UtilityDock><ToolsMenu /></UtilityDock>
      </div>
    </div>
  )
}
