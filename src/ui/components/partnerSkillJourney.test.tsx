// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PARTNER_SKILLS } from '@/game/ext/partnerSkills'
import { PLAYER_SKILLS_KEY, usePlayerSkills } from '@/store/playerSkillsStore'
import { SKILL_POINTS_KEY, useSkillPoints } from '@/store/skillPointsStore'
import { PartnerSkillModal } from './PartnerSkillModal'

vi.mock('@/audio/audioEngine', () => ({
  audio: { play: vi.fn(), unlock: vi.fn(async () => undefined) },
}))

function installStorage() {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
    clear: () => { values.clear() },
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  return storage
}

function seedAccount(sp: number, learnedSkillIds: string[] = []) {
  localStorage.setItem(SKILL_POINTS_KEY, JSON.stringify(sp))
  localStorage.setItem(PLAYER_SKILLS_KEY, JSON.stringify({ learnedSkillIds }))
  useSkillPoints.setState({ sp })
  usePlayerSkills.setState({ learnedSkillIds, loaded: true, loadError: null })
}

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(globalThis, 'localStorage')
})

describe('PartnerSkillModal', () => {
  beforeEach(() => {
    window.scrollTo = vi.fn()
    installStorage()
    seedAccount(6)
  })

  it('shows the real catalog and commits one unlock with readable status', async () => {
    render(<PartnerSkillModal onClose={vi.fn()} />)

    expect(screen.getByText(PARTNER_SKILLS[0].unlockCondition)).toBeTruthy()
    expect(screen.getByText(PARTNER_SKILLS[1].battleUse)).toBeTruthy()
    expect(document.querySelector('[data-partner-skill-id="rally"]')?.getAttribute('data-partner-skill-state')).toBe('available')

    fireEvent.keyDown(screen.getByRole('button', { name: /解鎖 訓練師加油/ }), { key: 'Enter', code: 'Enter' })
    await waitFor(() => {
      expect(useSkillPoints.getState().sp).toBe(0)
      expect(usePlayerSkills.getState().learnedSkillIds).toEqual(['rally'])
      expect(document.querySelector('[data-partner-skill-id="rally"]')?.getAttribute('data-partner-skill-state')).toBe('learned')
    })
    expect(document.querySelector('[data-partner-notice]')?.textContent).toContain('已解鎖「訓練師加油」')
  })

  it('keeps a locked action disabled and explains insufficient SP', () => {
    seedAccount(0)
    render(<PartnerSkillModal onClose={vi.fn()} />)

    const button = screen.getByRole('button', { name: /解鎖 訓練師加油.*SP/ })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(button.getAttribute('data-disabled-reason')).toBe('sp-insufficient')
    expect(screen.getByText(/目前 SP 0/)).toBeTruthy()
  })
})
