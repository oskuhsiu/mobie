// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { mon } from '@/game/battle/testFixtures'
import { ResourceAction } from './ResourceAction'
import { SwitchSheet } from './SwitchSheet'

describe('battle action controls', () => {
  afterEach(cleanup)

  it('shows truthful resource states and submits a ready action once', () => {
    const onActivate = vi.fn()
    const view = render(<ResourceAction kind="star" current={38} max={100} activating={false} onActivate={onActivate} />)
    expect(screen.getByRole('meter', { name: '星擊能量' }).getAttribute('aria-valuenow')).toBe('38')
    expect(screen.queryByRole('button', { name: '星擊發動' })).toBeNull()

    view.rerender(<ResourceAction kind="star" current={100} max={100} activating={false} onActivate={onActivate} />)
    const ready = screen.getByRole('button', { name: '星擊發動' })
    fireEvent.click(ready)
    fireEvent.click(ready)
    expect(onActivate).toHaveBeenCalledTimes(1)

    view.rerender(<ResourceAction kind="star" current={0} max={100} activating onActivate={onActivate} />)
    expect((screen.getByRole('button', { name: '星擊發動中' }) as HTMLButtonElement).disabled).toBe(true)
    expect(document.querySelector('[data-resource-state="activating"]')).toBeTruthy()
  })

  it('renders only legal switch targets and cancels with Escape', () => {
    const onCancel = vi.fn()
    const onPick = vi.fn()
    render(<SwitchSheet
      members={[mon({ nameZh: '在場' }), mon({ nameZh: '合法替補' }), mon({ nameZh: '倒下替補', currentHp: 0 })]}
      legalIndices={[1]}
      onPick={onPick}
      onCancel={onCancel}
    />)

    const legal = screen.getByRole('button', { name: /換上合法替補/ })
    expect(screen.queryByText('在場')).toBeNull()
    expect(screen.queryByText('倒下替補')).toBeNull()
    expect(document.activeElement).toBe(legal)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
