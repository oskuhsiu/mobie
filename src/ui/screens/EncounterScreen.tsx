import { motion } from 'framer-motion'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useGame } from '@/app/GameProvider'
import { buildBattleMobie } from '@/game/stats'
import { useMeta } from '@/store/metaStore'
import { useAccidents } from '@/store/accidentStore'
import { useSkillPoints } from '@/store/skillPointsStore'
import type { BattleMobie, Card, Region } from '@/game/types'
import { canCaptureIn, lookupRegion } from '@/game/data/regionLookup'
import { rollEncounterAccidents, type EncounterAccidents, type SupplyOption } from '@/game/accidents'
import { MobieSprite } from '@/ui/components/MobieSprite'
import { TypeBadges } from '@/ui/components/TypeBadge'
import { IndividualInfo } from '@/ui/components/IndividualInfo'
import { MobCard } from '@/ui/components/MobCard'
import { GestureGate } from '@/ui/components/GestureGate'
import { useSettings } from '@/store/settingsStore'
import { interactModeOf, juiceLevelOf } from '@/game/settings'
import { audio } from '@/audio/audioEngine'
import { captureTargetOf } from '@/game/hunt'
import { TEAM_SIZE } from '@/game/machine/gameMachine'
import { useOverlayController } from '@/ui/shell/OverlayController'
import { ModalSurface } from '@/ui/shell/ModalSurface'

type EncounterErrorKind = 'missing-context' | 'missing-target' | 'context-mismatch' | 'load-error'
type EncounterFixture = 'missing-target' | 'context-mismatch' | 'artwork-failure'

type EncounterView =
  | {
      status: 'ready'
      region: Region
      foes: BattleMobie[]
      target: BattleMobie
      captureEligible: boolean
      accidents: EncounterAccidents
    }
  | {
      status: 'error'
      kind: EncounterErrorKind
      title: string
      message: string
      canRetry: boolean
    }

type EncounterErrorView = Extract<EncounterView, { status: 'error' }>

const ENCOUNTER_ERROR_COPY: Record<EncounterErrorKind, Pick<EncounterErrorView, 'title' | 'message'>> = {
  'missing-context': {
    title: '遭遇內容尚未準備好',
    message: '找不到這次遭遇的目的地。請返回區域重新選擇，避免進入沒有對手資料的空白畫面。',
  },
  'missing-target': {
    title: '對手資料尚未載入',
    message: '這次遭遇沒有 featured target 或對手隊伍。可以重新擲出同一區域的遭遇，或返回區域放棄。',
  },
  'context-mismatch': {
    title: '遭遇目的地需要重新選擇',
    message: '目前的區域資料與這次遭遇不一致。請重新嘗試；若仍失敗，返回區域重新進入。',
  },
  'load-error': {
    title: '遭遇資料載入失敗',
    message: '對手資料無法安全解析。請重新嘗試；若仍失敗，返回區域重新選擇目的地。',
  },
}

function encounterError(kind: EncounterErrorKind, canRetry: boolean, overrides: Partial<Pick<EncounterErrorView, 'title' | 'message'>> = {}): EncounterErrorView {
  return { status: 'error', kind, ...ENCOUNTER_ERROR_COPY[kind], ...overrides, canRetry }
}

function buildEncounterView(regionId: string | null, foeCards: readonly Card[]): EncounterView {
  if (!regionId) {
    return encounterError('missing-context', false)
  }

  let region: Region
  try {
    region = lookupRegion(regionId)
  } catch {
    return encounterError('context-mismatch', false)
  }

  if (!Array.isArray(foeCards) || foeCards.length === 0) {
    return encounterError('missing-target', true)
  }
  if (foeCards.length !== TEAM_SIZE) {
    return encounterError('context-mismatch', true, {
      title: '對手隊伍資料不完整',
      message: `這次遭遇需要 ${TEAM_SIZE} 名對手，但目前收到 ${foeCards.length} 名。請重新嘗試，避免把不完整的隊伍送進出戰流程。`,
    })
  }

  try {
    const foes = foeCards.map(buildBattleMobie)
    const target = captureTargetOf(foes)
    if (!target) {
      return encounterError('missing-target', true, {
        title: '找不到 featured target',
        message: '這次遭遇沒有可展示的主將。請重新嘗試或返回區域。',
      })
    }
    return {
      status: 'ready',
      region,
      foes,
      target,
      captureEligible: canCaptureIn(region.id),
      accidents: rollEncounterAccidents(region, foeCards),
    }
  } catch {
    return encounterError('load-error', true)
  }
}

function retryArtworkUrl(url: string, attempt: number): string {
  if (attempt === 0) return url
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}encounterRetry=${attempt}`
}

function readEncounterFixture(): EncounterFixture | null {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null
  const value = new URLSearchParams(window.location.search).get('m24EncounterFixture')
    ?? new URLSearchParams(window.location.search).get('encounterFixture')
  return value === 'missing-target' || value === 'context-mismatch' || value === 'artwork-failure' ? value : null
}

function clearEncounterFixture(): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.delete('m24EncounterFixture')
  url.searchParams.delete('encounterFixture')
  window.history.replaceState({}, '', url)
}

export function EncounterScreen() {
  const { context, send } = useGame()
  const controller = useOverlayController()
  const controllerRef = useRef(controller)
  controllerRef.current = controller
  const grassOn = useSettings((s) => interactModeOf(s.settings, 'encounter') !== 'off')
  const spriteIdle = useSettings((s) => juiceLevelOf(s.settings) !== 'off')
  const [fixture, setFixture] = useState<EncounterFixture | null>(() => readEncounterFixture())
  const view = useMemo(() => {
    if (fixture === 'missing-target') {
      return encounterError('missing-target', true)
    }
    if (fixture === 'context-mismatch') {
      return encounterError('context-mismatch', true)
    }
    return buildEncounterView(context.regionId, context.foeTeam)
  }, [context.foeTeam, context.regionId, fixture])
  const encounterKey = `${context.regionId ?? 'none'}:${context.foeTeam.map((card) => card.cardId).join('|')}`
  const [supplyResolved, setSupplyResolved] = useState(false)
  const supplyResolvedRef = useRef(false)
  const supplyShownRef = useRef(false)
  const submitRef = useRef(false)
  const leavingRef = useRef(false)
  const [artworkState, setArtworkState] = useState<'loading' | 'loaded' | 'failed'>('loading')
  const [artworkRetry, setArtworkRetry] = useState(0)

  const handleArtworkState = useCallback((state: 'loading' | 'loaded' | 'failed') => {
    setArtworkState(state)
  }, [])

  const leaveEncounter = useCallback(() => {
    if (leavingRef.current) return
    leavingRef.current = true
    useAccidents.getState().reset()
    controllerRef.current.close()
    send({ type: 'BACK' })
  }, [send])

  const retryEncounter = useCallback(() => {
    setFixture(null)
    clearEncounterFixture()
    supplyShownRef.current = false
    supplyResolvedRef.current = false
    setSupplyResolved(false)
    submitRef.current = false
    controllerRef.current.close()
    send({ type: 'RETRY_ENCOUNTER' })
  }, [send])

  const pickSupply = useCallback((option: SupplyOption) => {
    if (supplyResolvedRef.current) return
    supplyResolvedRef.current = true
    setSupplyResolved(true)
    audio.play('super')
    useAccidents.getState().chooseSupply(option.kind)
    if (option.kind === 'sp') {
      // SP is the only supply with an immediate wallet effect; the store guard
      // above ensures a double click cannot grant it twice.
      useSkillPoints.getState().add(3)
    }
    controllerRef.current.pop()
  }, [])

  useEffect(() => {
    leavingRef.current = false
    submitRef.current = false
    supplyShownRef.current = false
    setArtworkRetry(0)
    setArtworkState('loading')
    const supply = view.status === 'ready' ? view.accidents.supply : null
    if (view.status !== 'ready') return

    useMeta.getState().recordSeen(context.foeTeam.map((card) => card.speciesId))
    useAccidents.getState().beginEncounter(encounterKey, view.accidents.luckyExpMult)
    const activeAccidents = useAccidents.getState()
    const alreadyResolved = Boolean(supply && activeAccidents.encounterKey === encounterKey && activeAccidents.supplyKind)
    supplyResolvedRef.current = alreadyResolved || !supply
    setSupplyResolved(alreadyResolved || !supply)
    if (supply && !supplyShownRef.current) {
      if (alreadyResolved) return
      supplyShownRef.current = true
      controllerRef.current.push({
        id: `encounter-supply:${encounterKey}`,
        policy: 'explicit-action-only',
        content: (
          <SupplySurface
            options={supply}
            onPick={pickSupply}
            onReturn={leaveEncounter}
          />
        ),
      })
    }
  }, [context.foeTeam, encounterKey, leaveEncounter, pickSupply, view])

  const openCard = useCallback((mon: BattleMobie) => {
    audio.play('select')
    controllerRef.current.push({
      id: `mobie-detail:${mon.speciesId}`,
      policy: 'escape-and-backdrop',
      content: <MobCard mon={mon} owner={false} revealed={false} onClose={controllerRef.current.pop} />,
    })
  }, [])

  const continueToTeam = useCallback(() => {
    if (submitRef.current || view.status !== 'ready') return
    if (view.accidents.supply && !supplyResolvedRef.current) return
    submitRef.current = true
    controllerRef.current.pop()
    send({ type: 'ENGAGE' })
  }, [send, view])

  const engage = useCallback(() => {
    if (view.status !== 'ready' || (view.accidents.supply && !supplyResolvedRef.current) || submitRef.current) return
    if (!grassOn) {
      continueToTeam()
      return
    }
    controllerRef.current.push({
      id: `encounter-grass-gate:${encounterKey}`,
      policy: 'explicit-action-only',
      content: (
        <GestureGate
          title="🌿 撥開草叢"
          icon="🌿"
          hint="來回撥動，撥開草叢找出對手！"
          timeoutHint="可以略過；完成、略過或逾時都會直接進入隊伍組建，不會改變這次遭遇。"
          skipLabel="略過手勢・直接出戰"
          onComplete={() => { controllerRef.current.pop(); continueToTeam() }}
          onCancel={controllerRef.current.pop}
        />
      ),
    })
  }, [continueToTeam, encounterKey, grassOn, view])

  if (view.status === 'error') {
    return (
      <div className="encounter-error" data-encounter data-encounter-state="error">
        <div className="encounter-error__card" role="alert" data-encounter-error data-encounter-error-kind={view.kind}>
          <div className="encounter-error__icon" aria-hidden="true">⚠️</div>
          <div className="eyebrow">Encounter recovery</div>
          <h1 className="h-title">{view.title}</h1>
          <p className="h-sub">{view.message}</p>
          <div className="row encounter-error__actions">
            {view.canRetry && <button className="btn" data-encounter-retry onClick={retryEncounter}>重新嘗試</button>}
            <button className="btn btn--ghost" data-encounter-back onClick={leaveEncounter}>返回區域</button>
          </div>
        </div>
      </div>
    )
  }

  const { region, foes, target, captureEligible, accidents } = view
  const targetSrc = fixture === 'artwork-failure'
    ? '/__m24__/missing-artwork.png'
    : retryArtworkUrl(target.artworkUrl, artworkRetry)
  const supplyPending = Boolean(accidents.supply && !supplyResolved)

  return (
    <div className="encounter-screen col" data-encounter data-encounter-state="ready" data-encounter-region={region.id} data-encounter-capture={captureEligible ? 'eligible' : 'ineligible'}>
      <button className="btn btn--ghost encounter-back" style={{ alignSelf: 'flex-start', padding: '10px 18px' }} onClick={leaveEncounter}>
        ← 返回區域
      </button>

      <div className="encounter-context" data-encounter-context>
        <div className="encounter-context__title">
          <span className="eyebrow">{region.name} · {region.mode === 'wild' ? '野外遭遇' : '競技場'}</span>
          <span className="h-sub">對手隊伍與出戰前資訊</span>
        </div>
        <div className="encounter-context__flags" data-accident-flags>
          {target.shiny && <span className="accident-tag accident-tag--rare">✦ 稀有閃光 boss</span>}
          {accidents.luckyExpMult > 1 && <span className="accident-tag">🍀 幸運加碼 · 勝利經驗 ×{accidents.luckyExpMult}</span>}
          {accidents.supply && <span className="accident-tag accident-tag--supply">📦 天降補給 · 必須選一項</span>}
          {!target.shiny && accidents.luckyExpMult <= 1 && !accidents.supply && <span className="h-sub">本場沒有額外事故旗標</span>}
        </div>
      </div>

      <div className="encounter-main hunt-target" role="region" aria-label={`${captureEligible ? '可收服目標' : '對戰主將'} ${target.nameZh}`}>
        <div className="encounter-target" data-encounter-target>
          <motion.div
            initial={{ opacity: 0, scale: 0.6, y: -40 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 120, damping: 12 }}
            className="encounter-target__art"
          >
            <div className="platform" />
            <MobieSprite
              key={targetSrc}
              src={targetSrc}
              alt={target.nameZh}
              shiny={target.shiny}
              idle={spriteIdle}
              onStateChange={handleArtworkState}
            />
          </motion.div>
          {artworkState === 'failed' && (
            <div className="encounter-artwork-error" role="status" data-encounter-artwork-error>
              <span>立繪載入失敗，已使用可辨識替代圖。</span>
              <button className="btn btn--ghost btn--sm" data-encounter-artwork-retry onClick={() => { setFixture(null); clearEncounterFixture(); setArtworkState('loading'); setArtworkRetry((attempt) => attempt + 1) }}>重新載入立繪</button>
            </div>
          )}
        </div>

        <div className="encounter-target__details col">
          <div className="eyebrow hunt-target__label">{captureEligible ? '可收服目標' : '對戰主將'}</div>
          <div className="h-title encounter-target__name">{target.nameZh} <span className="hpbar__lv">Lv.{target.level}</span></div>
          {captureEligible && <div className="hunt-target__promise">擊敗後可嘗試收服</div>}
          <TypeBadges types={target.types} />
          <IndividualInfo mon={target} detailed />
          <button className="btn btn--ghost btn--sm" aria-label={`查看${target.nameZh}資訊卡`} onClick={() => openCard(target)}>
            ⓘ 查看資訊卡
          </button>
        </div>
      </div>

      <section className="encounter-roster" aria-labelledby="encounter-roster-title" data-encounter-roster>
        <div className="encounter-roster__head">
          <div>
            <div className="eyebrow">Opponent roster</div>
            <h2 id="encounter-roster-title">{captureEligible ? 'Boss 隊伍' : '對手隊伍'}</h2>
          </div>
          <span className="h-sub">點選任一成員查看資訊卡；最後一名是 featured target</span>
        </div>
        <div className="encounter-roster__list">
          {foes.map((foe, index) => (
            <button
              key={`${foe.speciesId}-${index}`}
              className={`encounter-roster__member ${index === foes.length - 1 ? 'encounter-roster__member--boss' : ''}`}
              onClick={() => openCard(foe)}
              aria-label={`${foe.nameZh}，${index === foes.length - 1 && captureEligible ? '可收服目標' : captureEligible ? 'Boss 隊伍成員' : '對手隊伍成員'}`}
            >
              <span className="encounter-roster__sprite"><MobieSprite src={foe.artworkUrl} alt={foe.nameZh} shiny={foe.shiny} /></span>
              <span className="encounter-roster__meta"><b>{foe.nameZh}</b><span>Lv.{foe.level}</span><TypeBadges types={foe.types} /></span>
              {index === foes.length - 1 && <span className="encounter-roster__boss">BOSS</span>}
            </button>
          ))}
        </div>
      </section>

      <div className="encounter-engage">
        {supplyPending && <div className="encounter-engage__notice" role="status" data-encounter-supply-required>請先從補給箱選一項；選擇後才能進入隊伍組建。</div>}
        <motion.button
          className="btn"
          data-encounter-engage
          style={{ alignSelf: 'center', fontSize: 19, padding: '16px 44px' }}
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: supplyPending ? 0.5 : 1, y: 0 }} transition={{ delay: 0.5 }}
          whileTap={supplyPending ? undefined : { scale: 0.96 }}
          disabled={supplyPending}
          onClick={engage}
        >
          ⚔ 出戰
        </motion.button>
      </div>
    </div>
  )
}

function SupplySurface({ options, onPick, onReturn }: {
  options: SupplyOption[]
  onPick: (option: SupplyOption) => void
  onReturn: () => void
}) {
  return (
    <ModalSurface
      title="📦 天降補給"
      description="三項補給效果同等清楚；選一項帶進這場戰鬥，或返回區域放棄本次遭遇。"
      onClose={onReturn}
      closeLabel="返回區域"
      policy="explicit-action-only"
      className="encounter-supply-surface"
      style={{ maxWidth: 480 }}
    >
      <div className="encounter-supply" data-encounter-supply>
        <div className="encounter-supply__required" role="status">必須完成一項選擇後，才能按「出戰」。Esc、背景點擊與關閉手勢不會跳過選擇。</div>
        <div className="encounter-supply__options">
          {options.map((option) => (
            <button key={option.kind} className="supply-opt encounter-supply__option" data-supply-option={option.kind} onClick={() => onPick(option)}>
              <span className="supply-opt__icon" aria-hidden="true">{option.icon}</span>
              <span className="encounter-supply__copy"><b>{option.label}</b><span>{option.desc}</span></span>
              <span className="encounter-supply__choose">選擇</span>
            </button>
          ))}
        </div>
        <button className="btn btn--ghost" data-supply-return onClick={onReturn}>返回區域並放棄遭遇</button>
      </div>
    </ModalSurface>
  )
}
