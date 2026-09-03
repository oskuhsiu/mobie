import { describe, expect, it } from 'vitest'
import {
  EMPTY_CAMERA_QUEUE,
  acquireCamera,
  cameraShot,
  hasCameraOwnership,
  releaseCamera,
  resetCamera,
  updateCamera,
} from './battleCamera'

const first = { cueId: 'cue-1', owner: 'normal-attack', caster: 'player' as const, target: 'foe' as const }
const second = { cueId: 'cue-2', owner: 'normal-attack', caster: 'foe' as const, target: 'player' as const }

describe('battle camera ownership queue', () => {
  it('acquires, updates, and releases the exact owner back to wide', () => {
    const acquired = acquireCamera(EMPTY_CAMERA_QUEUE, first)
    expect(cameraShot(acquired, false)).toBe('caster')
    const impact = updateCamera(acquired, first.cueId, first.owner, 'impact')
    expect(cameraShot(impact, false)).toBe('impact')
    expect(releaseCamera(impact, first.cueId, first.owner)).toEqual(EMPTY_CAMERA_QUEUE)
  })

  it('hands ownership to queued cues and rejects a mismatched release', () => {
    const queued = acquireCamera(acquireCamera(EMPTY_CAMERA_QUEUE, first), second)
    expect(hasCameraOwnership(queued, second.cueId, second.owner)).toBe(true)
    expect(hasCameraOwnership(queued, second.cueId, 'different-owner')).toBe(false)
    expect(releaseCamera(queued, first.cueId, 'different-owner')).toEqual(queued)
    const handedOff = releaseCamera(queued, first.cueId, first.owner)
    expect(handedOff.active).toMatchObject(second)
    expect(handedOff.queued).toEqual([])
  })

  it('updates a queued cue without stealing active ownership and resets exactly', () => {
    const queued = acquireCamera(acquireCamera(EMPTY_CAMERA_QUEUE, first), second)
    const updated = updateCamera(queued, second.cueId, second.owner, 'impact')
    expect(updated.active).toMatchObject(first)
    expect(updated.queued[0]?.shot).toBe('impact')
    expect(resetCamera()).toEqual(EMPTY_CAMERA_QUEUE)
  })

  it('forces wide for reduced motion without discarding ownership', () => {
    const acquired = acquireCamera(EMPTY_CAMERA_QUEUE, first, 'impact')
    expect(cameraShot(acquired, true)).toBe('wide')
    expect(cameraShot(acquired, false)).toBe('impact')
  })
})
