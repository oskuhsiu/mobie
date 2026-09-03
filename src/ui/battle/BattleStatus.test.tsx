// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FieldStatusBar, SideStatusRail } from './BattleStatus'

describe('battle status disclosure', () => {
  afterEach(cleanup)

  it('keeps side ownership and restores the overflow invoker on Escape', () => {
    render(<SideStatusRail side="player" statuses={[
      { stat: 'atk', mult: 1.2, remaining: 3, source: -1, label: '訓練師加油' },
      { stat: 'def', mult: 1.3, remaining: 2, source: 1010, label: '防禦提升' },
      { stat: 'spa', mult: 1.2, remaining: 4, source: -1, label: '精神集中' },
      { stat: 'spd', mult: 1.1, remaining: 1, source: -1, label: '靈光守護' },
    ]} />)

    expect(screen.getByLabelText('我方全隊狀態')).toBeTruthy()
    const more = screen.getByRole('button', { name: '展開我方全隊全部 4 個狀態' })
    fireEvent.click(more)
    expect(screen.getByText('來源：火花')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '我方全隊完整狀態' })).toBeNull()
    expect(document.activeElement).toBe(more)
  })

  it('keeps combo marks in the field bar and exposes every mark', () => {
    const onRestore = vi.fn()
    render(<FieldStatusBar
      terrainIds={['rain']}
      initiative="你先攻"
      turn={3}
      fieldMarks={[
        { key: 'one', label: '第一標記', icon: '①', remaining: 4 },
        { key: 'two', label: '第二標記', icon: '②', remaining: 3 },
        { key: 'three', label: '第三標記', icon: '③', remaining: 2 },
      ]}
      onOverflowRestore={onRestore}
    />)

    const more = screen.getByRole('button', { name: '展開全部 3 個場域標記' })
    fireEvent.click(more)
    expect(screen.getByText('第三標記')).toBeTruthy()
    expect(screen.getByText('來源：第三標記')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.activeElement).toBe(more)
    expect(onRestore).toHaveBeenCalledTimes(1)
  })

  it('shows one field mark outside wide landscape and keeps all marks in overflow', () => {
    const view = render(<FieldStatusBar
      terrainIds={[]}
      initiative="你先攻"
      turn={2}
      windowClass="phone-portrait"
      fieldMarks={[
        { key: 'one', label: '第一標記', icon: '①', remaining: 4 },
        { key: 'two', label: '第二標記', icon: '②', remaining: 3 },
        { key: 'three', label: '第三標記', icon: '③', remaining: 2 },
      ]}
    />)

    expect(view.container.querySelectorAll('.battle-field-bar__mark')).toHaveLength(1)
    expect(screen.getByRole('button', { name: '展開全部 3 個場域標記' }).textContent).toBe('+2')
  })
})
