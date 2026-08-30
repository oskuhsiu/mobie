import { describe, expect, it } from 'vitest'
import { displaySourceName } from './BattleHudAdapter'

describe('BattleHudAdapter source display names', () => {
  it.each([
    [{ kind: 'status', source: 1010, label: '灼熱' } as const, '火花'],
    [{ kind: 'status', source: -1, label: '訓練師加油' } as const, '訓練師加油'],
    [{ kind: 'combo', key: 'steam-burst', label: '蒸氣爆破' } as const, '蒸氣爆破'],
    [{ kind: 'combo', key: 'future-combo', label: '未來合體技' } as const, '未來合體技'],
    [{ kind: 'status', source: 999_999, label: '' } as const, '未知來源'],
    [{ kind: 'status', source: -1, label: '   ' } as const, '未知來源'],
    [{ kind: 'combo', key: '', label: '' } as const, '未知來源'],
  ])('projects %o without exposing reducer provenance', (source, expected) => {
    expect(displaySourceName(source)).toBe(expected)
  })
})
