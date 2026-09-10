// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ReplayPlayerModal } from './ReplayPlayerModal'
import type { ReplayLog } from '@/game/replay/types'

vi.mock('@/audio/audioEngine', () => ({
  audio: { play: vi.fn() },
}))

const LOG: ReplayLog = {
  header: {
    formatVersion: 2,
    battleId: 'battle-1',
    battleSeed: 'seed-1',
    createdAt: 1,
    regionId: 'practice',
    mode: 'arena',
    outcome: 'win',
    snapshot: [
      { instanceId: 'player:0', side: 'player', slot: 0, speciesId: 1, displayName: '我方', level: 10, maxHp: 40, initialHp: 40, shiny: false },
      { instanceId: 'foe:0', side: 'foe', slot: 0, speciesId: 4, displayName: '對手', level: 10, maxHp: 40, initialHp: 40, shiny: false },
    ],
  },
  turns: [{
    input: { type: 'ATTACK' },
    events: [
      { type: 'damageApplied', attackerSide: 'player', attackerIndex: 0, targetSide: 'foe', targetIndex: 0, amount: 10, missed: false, crit: false, effectiveness: 1, effectivenessText: null, hpBefore: 40, hpAfter: 30, maxHp: 40 },
      { type: 'damageApplied', attackerSide: 'foe', attackerIndex: 0, targetSide: 'player', targetIndex: 0, amount: 5, missed: false, crit: false, effectiveness: 1, effectivenessText: null, hpBefore: 40, hpAfter: 35, maxHp: 40 },
    ],
  }],
}

describe('ReplayPlayerModal transport', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    HTMLElement.prototype.scrollTo = vi.fn()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('pauses, steps backward/forward once, and offers the exact speed controls', () => {
    const { container } = render(<ReplayPlayerModal log={LOG} onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '⏸ 暫停' }))
    expect(screen.getByRole('button', { name: '▶ 播放' })).toBeTruthy()

    const previous = screen.getByRole('button', { name: '⏮ 上一步' })
    const next = screen.getByRole('button', { name: '下一步 ⏭' })
    expect((previous as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(next)
    expect((previous as HTMLButtonElement).disabled).toBe(false)
    expect(container.querySelector<HTMLElement>('.replay-progress__fill')?.style.width).toBe('50%')
    expect(screen.getByRole('button', { name: '▶ 播放' })).toBeTruthy()

    fireEvent.click(previous)
    expect((previous as HTMLButtonElement).disabled).toBe(true)
    expect(container.querySelector<HTMLElement>('.replay-progress__fill')?.style.width).toBe('0%')

    const speedLabels = ['0.5×', '1×', '2×', '4×']
    expect(speedLabels.map((label) => screen.getByRole('button', { name: label }).textContent)).toEqual(speedLabels)
    for (const label of speedLabels) {
      const button = screen.getByRole('button', { name: label })
      fireEvent.click(button)
      expect(button.className).toContain('btn--primary')
    }
  })

  it('keeps decode and empty player states recoverable', () => {
    const retry = vi.fn()
    render(<ReplayPlayerModal log={null} loadState="decode-error" error="資料損毀" onRetry={retry} onClose={vi.fn()} />)
    expect(screen.getByRole('alert').textContent).toContain('資料損毀')
    fireEvent.click(screen.getByRole('button', { name: '重新載入' }))
    expect(retry).toHaveBeenCalledOnce()

    cleanup()
    const { container } = render(<ReplayPlayerModal log={{ ...LOG, turns: [] }} onClose={vi.fn()} />)
    expect(screen.getByText('此回放沒有可播放的事件。')).toBeTruthy()
    expect((container.querySelector('[data-replay-toggle]') as HTMLButtonElement).disabled).toBe(true)
  })
})
