// @vitest-environment jsdom

import { fireEvent, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Card } from '@/game/types'
import { renderGameJourney } from '@/test/renderGameJourney'
import { useSettings } from '@/store/settingsStore'

vi.mock('@/audio/audioEngine', () => ({
  audio: { play: vi.fn() },
}))

const FOES: Card[] = [
  { cardId: 'hunt-front', speciesId: 1, level: 10 },
  { cardId: 'hunt-support', speciesId: 4, level: 11 },
  { cardId: 'hunt-boss', speciesId: 7, level: 12 },
]

describe('wild hunt target journey', () => {
  beforeEach(() => {
    useSettings.getState().setInteractMode('off')
  })

  it('keeps the final foe as the capture target from encounter into team selection', async () => {
    renderGameJourney({
      state: 'encounter',
      context: { regionId: 'verdant-forest', foeTeam: FOES },
    })

    const target = screen.getByRole('region', { name: '可收服目標 傑尼龜' })
    expect(within(target).getByText('擊敗後可嘗試收服')).toBeTruthy()
    expect(within(target).getByRole('button', { name: '查看傑尼龜資訊卡' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '妙蛙種子，Boss 隊伍成員' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '傑尼龜，可收服目標' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /出戰/ }))

    expect(await screen.findByText('可收服目標：傑尼龜')).toBeTruthy()
  })

  it('reveals two-sided advice without selecting, then labels manual pick order', () => {
    renderGameJourney({
      state: 'cardSelect',
      context: { regionId: 'verdant-forest', foeTeam: FOES },
    })

    const engage = screen.getByRole('button', { name: /出戰.*0\/3/ })
    expect(screen.queryByText('⭐ 建議候選')).toBeNull()
    expect(screen.queryByText(/^進攻：/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '顯示建議' }))

    expect(engage.textContent).toContain('0/3')
    expect(screen.getAllByText(/^進攻：/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/^風險：/).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: '選擇 妙蛙種子' }))
    expect(screen.getByRole('button', { name: '取消選擇 妙蛙種子，先發' })).toBeTruthy()
    expect(engage.textContent).toContain('1/3')

    fireEvent.click(screen.getByRole('button', { name: '選擇 小火龍' }))
    expect(screen.getByRole('button', { name: '取消選擇 小火龍，後備 1' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '取消選擇 妙蛙種子，先發' }))
    expect(screen.getByRole('button', { name: '取消選擇 小火龍，先發' })).toBeTruthy()
  })

  it('does not promise capture for an arena encounter', () => {
    renderGameJourney({
      state: 'encounter',
      context: { regionId: 'practice', foeTeam: FOES },
    })

    expect(screen.getByRole('region', { name: '對戰主將 傑尼龜' })).toBeTruthy()
    expect(screen.queryByText('擊敗後可嘗試收服')).toBeNull()
    expect(screen.queryByText('可收服目標')).toBeNull()
  })

  it('keeps malformed encounter handoff recoverable in Team Select', async () => {
    renderGameJourney({
      state: 'cardSelect',
      context: { regionId: 'verdant-forest', foeTeam: [] },
    })

    expect(await screen.findByRole('alert')).toBeTruthy()
    const back = screen.getByRole('button', { name: '返回 Encounter' })
    expect(back).toBeTruthy()
    expect(document.activeElement).toBe(back)
  })
})
