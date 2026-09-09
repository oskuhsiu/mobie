import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SKILL_POINTS_KEY, useSkillPoints } from '@/store/skillPointsStore'
import {
  PLAYER_SKILLS_KEY,
  usePlayerSkills,
} from './playerSkillsStore'

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
  Reflect.deleteProperty(globalThis, 'localStorage')
})

describe('Partner account unlock boundary', () => {
  beforeEach(() => {
    installStorage()
    seedAccount(6)
  })

  it('spends and persists once, then treats a duplicate request as already learned', async () => {
    const first = await usePlayerSkills.getState().unlockWithSp('rally')
    expect(first).toEqual({ status: 'applied', skillId: 'rally', cost: 6, remainingSp: 0 })
    expect(useSkillPoints.getState().sp).toBe(0)
    expect(usePlayerSkills.getState().learnedSkillIds).toEqual(['rally'])
    expect(JSON.parse(localStorage.getItem(SKILL_POINTS_KEY) ?? 'null')).toBe(0)
    expect(JSON.parse(localStorage.getItem(PLAYER_SKILLS_KEY) ?? 'null')).toEqual({ learnedSkillIds: ['rally'] })

    const duplicate = await usePlayerSkills.getState().unlockWithSp('rally')
    expect(duplicate).toEqual({ status: 'already-learned', skillId: 'rally', cost: 6, remainingSp: 0 })
    expect(useSkillPoints.getState().sp).toBe(0)
  })

  it('rejects a changed canonical account as stale without spending', async () => {
    localStorage.setItem(SKILL_POINTS_KEY, JSON.stringify(12))

    await expect(usePlayerSkills.getState().unlockWithSp('rally')).rejects.toMatchObject({
      name: 'PartnerSkillUnlockError',
      code: 'stale-account',
    })
    expect(useSkillPoints.getState().sp).toBe(6)
    expect(usePlayerSkills.getState().learnedSkillIds).toEqual([])
    expect(JSON.parse(localStorage.getItem(PLAYER_SKILLS_KEY) ?? 'null')).toEqual({ learnedSkillIds: [] })
  })

  it('rolls back the SP write when the learned-skill write fails', async () => {
    const storage = installStorage()
    seedAccount(6)
    const originalSetItem = storage.setItem
    storage.setItem = (key, value) => {
      if (key === PLAYER_SKILLS_KEY && value.includes('rally')) throw new Error('simulated skill storage failure')
      originalSetItem(key, value)
    }

    await expect(usePlayerSkills.getState().unlockWithSp('rally')).rejects.toMatchObject({
      code: 'storage-error',
    })
    expect(useSkillPoints.getState().sp).toBe(6)
    expect(usePlayerSkills.getState().learnedSkillIds).toEqual([])
    expect(JSON.parse(localStorage.getItem(SKILL_POINTS_KEY) ?? 'null')).toBe(6)
    expect(JSON.parse(localStorage.getItem(PLAYER_SKILLS_KEY) ?? 'null')).toEqual({ learnedSkillIds: [] })
  })

  it('reports insufficient SP without changing either account slice', async () => {
    seedAccount(5)

    await expect(usePlayerSkills.getState().unlockWithSp('rally')).rejects.toMatchObject({
      code: 'insufficient-sp',
    })
    expect(useSkillPoints.getState().sp).toBe(5)
    expect(usePlayerSkills.getState().learnedSkillIds).toEqual([])
  })

  it('rejects a same-tick duplicate while the first unlock is busy', async () => {
    const first = usePlayerSkills.getState().unlockWithSp('rally')
    await expect(usePlayerSkills.getState().unlockWithSp('rally')).rejects.toMatchObject({ code: 'busy' })
    await expect(first).resolves.toMatchObject({ status: 'applied', remainingSp: 0 })
  })

  it('reloads both account slices after an external change', () => {
    localStorage.setItem(SKILL_POINTS_KEY, JSON.stringify(9))
    localStorage.setItem(PLAYER_SKILLS_KEY, JSON.stringify({ learnedSkillIds: ['rally'] }))

    usePlayerSkills.getState().reload()

    expect(useSkillPoints.getState().sp).toBe(9)
    expect(usePlayerSkills.getState().learnedSkillIds).toEqual(['rally'])
    expect(usePlayerSkills.getState().loadError).toBeNull()
  })
})
