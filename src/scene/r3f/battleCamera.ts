import type { Side } from '@/game/battle/reducer'
import type { BattleCameraShot } from '@/scene/battle/contracts'

export interface CameraOwnership {
  cueId: string
  owner: string
  caster: Side
  target: Side
  shot: Exclude<BattleCameraShot, 'wide'>
}

export interface CameraQueueState {
  active: CameraOwnership | null
  queued: CameraOwnership[]
}

export const EMPTY_CAMERA_QUEUE: CameraQueueState = { active: null, queued: [] }

const isOwner = (entry: CameraOwnership, cueId: string, owner: string) =>
  entry.cueId === cueId && entry.owner === owner

export function hasCameraOwnership(state: CameraQueueState, cueId: string, owner: string): boolean {
  return Boolean(state.active && isOwner(state.active, cueId, owner))
    || state.queued.some((entry) => isOwner(entry, cueId, owner))
}

export function acquireCamera(
  state: CameraQueueState,
  ownership: Omit<CameraOwnership, 'shot'>,
  shot: CameraOwnership['shot'] = 'caster',
): CameraQueueState {
  const entry = { ...ownership, shot }
  if (!state.active) return { active: entry, queued: state.queued }
  if (isOwner(state.active, ownership.cueId, ownership.owner)) {
    return { ...state, active: { ...state.active, ...entry } }
  }
  const queuedIndex = state.queued.findIndex((queued) => isOwner(queued, ownership.cueId, ownership.owner))
  if (queuedIndex >= 0) {
    return {
      ...state,
      queued: state.queued.map((queued, index) => index === queuedIndex ? entry : queued),
    }
  }
  return { ...state, queued: [...state.queued, entry] }
}

export function updateCamera(
  state: CameraQueueState,
  cueId: string,
  owner: string,
  shot: CameraOwnership['shot'],
): CameraQueueState {
  if (state.active && isOwner(state.active, cueId, owner)) {
    return { ...state, active: { ...state.active, shot } }
  }
  return {
    ...state,
    queued: state.queued.map((queued) => isOwner(queued, cueId, owner) ? { ...queued, shot } : queued),
  }
}

export function releaseCamera(state: CameraQueueState, cueId: string, owner: string): CameraQueueState {
  if (state.active && isOwner(state.active, cueId, owner)) {
    return { active: state.queued[0] ?? null, queued: state.queued.slice(1) }
  }
  return { ...state, queued: state.queued.filter((queued) => !isOwner(queued, cueId, owner)) }
}

export function resetCamera(): CameraQueueState {
  return EMPTY_CAMERA_QUEUE
}

export function cameraShot(state: CameraQueueState, reducedMotion: boolean): BattleCameraShot {
  return reducedMotion ? 'wide' : state.active?.shot ?? 'wide'
}
