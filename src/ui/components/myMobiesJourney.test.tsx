// @vitest-environment jsdom

import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createOwnedUnit, ownedToCard } from '@/game/growth'
import { useRoster } from '@/store/rosterStore'
import { useSkillPoints } from '@/store/skillPointsStore'
import { buildBattleMobie } from '@/game/stats'
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
    localStorage.clear()
    const unit = createOwnedUnit('journey-owned-1', 1, 5)
    useRoster.setState({ roster: [{ ...unit, exp: 150 }], loaded: true })
    useSkillPoints.setState({ sp: 6 })
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

  it('hands off from owner detail to the real trainer and preserves canonical move order', async () => {
    renderGameJourney()

    fireEvent.click(screen.getByRole('button', { name: '我的 Mobie' }))
    fireEvent.click(await screen.findByRole('button', { name: /妙蛙種子.*Lv\.5/ }))
    fireEvent.click(await screen.findByRole('button', { name: /管理招式/ }))

    expect(await screen.findByRole('dialog', { name: /招式訓練所/ })).toBeTruthy()
    expect(screen.getByText('出戰招式槽 1–4')).toBeTruthy()
    expect(screen.getAllByText('命中 100%').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: /花費 3 SP 學習 能量球/ }))
    await waitFor(() => {
      expect(useSkillPoints.getState().sp).toBe(3)
      expect(useRoster.getState().roster[0].learnedMoveIds).toContain(1041)
      expect(JSON.parse(localStorage.getItem('mobie.skillpoints.v1') ?? 'null')).toBe(3)
    })

    fireEvent.click(await screen.findByRole('button', { name: /裝備 能量球 到第 2 槽/ }))
    await waitFor(() => expect(useRoster.getState().roster[0].equippedMoveIds).toEqual([1040, 1041]))

    fireEvent.click(screen.getByRole('button', { name: /將 能量球 往前移到第 1 槽/ }))
    await waitFor(() => {
      expect(useRoster.getState().roster[0].equippedMoveIds).toEqual([1041, 1040])
      expect(buildBattleMobie(ownedToCard(useRoster.getState().roster[0])).moves.map((move) => move.id)).toEqual([1041, 1040])
    })

    fireEvent.click(screen.getByRole('button', { name: /將 能量球（第 1 槽）\s+卸下/ }))
    await waitFor(() => {
      expect(useRoster.getState().roster[0].equippedMoveIds).toEqual([1040])
      expect(useRoster.getState().roster[0].learnedMoveIds).toContain(1041)
      expect(useSkillPoints.getState().sp).toBe(3)
    })
  })
})
