// @vitest-environment jsdom

import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createOwnedUnit } from '@/game/growth'
import { useRoster } from '@/store/rosterStore'
import { renderGameJourney } from '@/test/renderGameJourney'

vi.mock('@/audio/audioEngine', () => ({
  audio: {
    unlock: vi.fn(async () => undefined),
    play: vi.fn(),
  },
}))

describe('我的 Mobie journey', () => {
  beforeEach(() => {
    window.scrollTo = vi.fn()
    const unit = createOwnedUnit('journey-owned-1', 1, 5)
    useRoster.setState({ roster: [{ ...unit, exp: 150 }] })
  })

  it('opens growth-focused owner details from the primary collection entry', async () => {
    renderGameJourney()

    expect(screen.getByRole('button', { name: '開始冒險' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '我的 Mobie' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '更多' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /掃卡/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '我的 Mobie' }))
    expect(await screen.findByText('我的 Mobie')).toBeTruthy()
    expect(screen.getByText('25 / 91 EXP')).toBeTruthy()
    expect(screen.getByText('Lv.6 門檻 216')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /妙蛙種子.*Lv\.5/ }))

    await waitFor(() => {
      expect(screen.getByText('招式')).toBeTruthy()
      expect(screen.getByText('能力值')).toBeTruthy()
      expect(screen.getByText('個體')).toBeTruthy()
      expect(screen.getByText('總 EXP 150')).toBeTruthy()
    })

    fireEvent.click(screen.getAllByRole('button', { name: '關閉' }).at(-1)!)
    await waitFor(() => expect(screen.queryByText('總 EXP 150')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '關閉' }))

    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    expect(screen.queryByRole('button', { name: /掃卡/ })).toBeNull()
    expect(screen.getByRole('button', { name: /設定/ })).toBeTruthy()
  })
})
