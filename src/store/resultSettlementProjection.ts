import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import type { Card, OwnedUnit } from '@/game/types'
import type { BattleResultHandoff, GameContext, Outcome, TowerRun } from '@/game/machine/gameMachine'
import { canCaptureIn } from '@/game/data/regionLookup'
import { captureTargetOf } from '@/game/hunt'
import { floorReward, towerExpMult } from '@/game/tower'
import { useAccidents } from '@/store/accidentStore'
import { useSettings } from '@/store/settingsStore'
import { interactModeOf, type InteractMode } from '@/game/settings'
import { buildOwnedMobieForDisplay } from '@/game/ownedMobie'
import { isResultSettlementRunning, setResultSettlementRunning } from '@/game/resultSettlementGuard'
import {
  legacyResultIdentity,
  ResultSettlementProjectionController,
  type CaptureDecision,
  type CaptureSettlementReceipt,
  type ResultIdentity,
  type ResultSettlementPayload,
  type ResultSettlementProjection,
  type ResultSettlementProjectionRequest,
} from '@/game/resultSettlement'
import { useRoster } from '@/store/rosterStore'

export interface ResultSettlementScreenContext {
  regionId: GameContext['regionId']
  foeTeam: readonly Card[]
  playerTeam: readonly Card[]
  outcome: Outcome | null
  battleResult: BattleResultHandoff | null
  tower: TowerRun | null
}

export interface ResultSettlementViewModel {
  projection: ResultSettlementProjection
  status: ResultSettlementProjection['status']
  identity: ResultIdentity | null
  outcome: Outcome | null
  isWin: boolean
  tower: TowerRun | null
  canCapture: boolean
  resultMode: 'wild' | 'arena'
  captureDecision: CaptureDecision | null
  captureReceipt: CaptureSettlementReceipt | null
  capturedUnit: OwnedUnit | null
  capturedMobie: ReturnType<typeof buildOwnedMobieForDisplay> | null
  duplicateConverted: boolean
  results: NonNullable<ResultSettlementProjection['receipt']>['results']
  evolutions: NonNullable<ResultSettlementProjection['receipt']>['evolutions']
  captureMode: InteractMode
  retry: () => void
  markLeft: () => Promise<void>
}

interface ResultSettlementProjectionStore {
  projection: ResultSettlementProjection
  retry: () => void
  markLeft: (identity?: ResultIdentity | null) => Promise<void>
}

const projectionController = new ResultSettlementProjectionController({
  prepare: (identity, payload) => useRoster.getState().prepareResultSettlement(identity, payload),
  settle: (identity, payload) => useRoster.getState().settleBattleResult(identity, payload),
  markResultLeft: (identity) => useRoster.getState().markBattleResultLeft(identity),
})

export const useResultSettlementProjectionStore = create<ResultSettlementProjectionStore>(() => ({
  projection: projectionController.getSnapshot(),
  retry: () => projectionController.retry(),
  markLeft: (identity) => projectionController.markResultLeft(identity),
}))

projectionController.subscribe(() => {
  const projection = projectionController.getSnapshot()
  setResultSettlementRunning(projection.status === 'running')
  useResultSettlementProjectionStore.setState({ projection })
})

/** Command-level guard used by Save Manager while a Result child is pending. */
export function resultSettlementBusy(): boolean {
  return isResultSettlementRunning()
}

function identityFor(context: ResultSettlementScreenContext, outcome: Outcome): ResultIdentity {
  if (context.battleResult) {
    return {
      resultId: context.battleResult.resultId,
      resultFingerprint: context.battleResult.resultFingerprint,
    }
  }
  return legacyResultIdentity({
    regionId: context.regionId,
    foeTeam: context.foeTeam,
    playerTeam: context.playerTeam,
    outcome,
  })
}

function payloadFor(
  context: ResultSettlementScreenContext,
  captureMult: number,
): { payload: ResultSettlementPayload; canCapture: boolean; resultMode: 'wild' | 'arena'; spReward: number } {
  const outcome = context.outcome!
  const isWin = outcome === 'win'
  const tower = context.tower
  const canCapture = isWin && !tower && canCaptureIn(context.regionId)
  const resultMode = !tower && canCaptureIn(context.regionId) ? 'wild' : 'arena'
  const captureTarget = canCapture ? captureTargetOf(context.foeTeam) : null
  const spReward = !isWin
    ? 0
    : tower
      ? floorReward(tower.floor, tower.ascension).sp
      : canCapture
        ? Math.max(1, 2 + Math.floor((captureTarget?.level ?? 1) / 10))
        : 1
  const payload: ResultSettlementPayload = {
    unitIds: context.playerTeam.map((card) => card.cardId),
    foeLevels: context.foeTeam.map((card) => card.level),
    ratio: isWin ? (tower ? towerExpMult(tower.floor) : useAccidents.getState().expMult) : 0.15,
    outcome,
    skillPoints: { delta: spReward },
    meta: isWin ? { winMode: resultMode } : {},
    ...(tower ? {
      tower: {
        floor: tower.floor,
        ascension: tower.ascension,
        outcome,
      },
    } : {}),
    incubator: { amount: isWin ? 2 : 1 },
    ...(captureTarget ? { capture: { target: captureTarget, captureMult } } : {}),
  }
  return { payload, canCapture, resultMode, spReward }
}

function requestFor(
  context: ResultSettlementScreenContext,
  captureMult: number,
): { request: ResultSettlementProjectionRequest | null; identity: ResultIdentity | null; canCapture: boolean; resultMode: 'wild' | 'arena'; spReward: number } {
  if (!context.outcome) return { request: null, identity: null, canCapture: false, resultMode: 'arena', spReward: 0 }
  const identity = identityFor(context, context.outcome)
  const built = payloadFor(context, captureMult)
  return {
    request: { identity, payload: built.payload },
    identity,
    canCapture: built.canCapture,
    resultMode: built.resultMode,
    spReward: built.spReward,
  }
}

/**
 * Result-facing adapter.  It owns payload assembly and orchestration; the
 * screen receives a read-only view model plus callbacks only.
 */
export function useResultSettlementProjection(context: ResultSettlementScreenContext): ResultSettlementViewModel {
  const captureMult = useAccidents((state) => state.captureMult)
  const captureMode = useSettings((state) => interactModeOf(state.settings, 'capture'))
  const outcome = context.battleResult?.outcome ?? context.outcome
  const normalizedContext = useMemo(() => ({ ...context, outcome }), [
    context.battleResult?.resultFingerprint,
    context.battleResult?.resultId,
    context.foeTeam,
    outcome,
    context.playerTeam,
    context.regionId,
    context.tower,
  ])
  const built = useMemo(() => requestFor(normalizedContext, captureMult), [
    normalizedContext,
    captureMult,
  ])
  const projection = useResultSettlementProjectionStore((state) => state.projection)
  const retry = useResultSettlementProjectionStore((state) => state.retry)
  const markLeft = useResultSettlementProjectionStore((state) => state.markLeft)

  // A stable request pair gates the controller.  The effect belongs to this
  // adapter rather than the screen, so presentation only consumes the model.
  useEffect(() => {
    projectionController.start(built.request)
  }, [built.request])

  const matches = Boolean(
    built.identity
    && projection.identity
    && projection.identity.resultId === built.identity.resultId
    && projection.identity.resultFingerprint === built.identity.resultFingerprint,
  )
  const receipt = matches
    ? projection.receipt
    : null
  const capturedUnit = receipt?.capture?.unit ?? null
  const visibleStatus: ResultSettlementProjection['status'] = !built.request
    ? 'idle'
    : matches
      ? projection.status
      : 'running'
  return {
    projection,
    status: visibleStatus,
    identity: built.identity,
    outcome,
    isWin: outcome === 'win',
    tower: context.tower,
    canCapture: built.canCapture,
    resultMode: built.resultMode,
    captureDecision: matches
      ? projection.captureDecision
      : null,
    captureReceipt: receipt?.capture ?? null,
    capturedUnit,
    capturedMobie: capturedUnit ? buildOwnedMobieForDisplay(capturedUnit) : null,
    duplicateConverted: matches && projection.captureOutcome === 'captured-duplicate-egg',
    results: receipt?.results ?? [],
    evolutions: receipt?.evolutions ?? [],
    captureMode,
    retry,
    markLeft: () => markLeft(built.identity),
  }
}
