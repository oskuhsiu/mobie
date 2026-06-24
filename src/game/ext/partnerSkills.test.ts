// M17 — Partner 技能 catalog 護欄（plan/19 §驗證）：純玩家技能、無直接傷害、不掛 OwnedUnit。
import { describe, it, expect } from 'vitest'
import {
  PARTNER_SKILLS,
  STARTER_PARTNER_SKILL_IDS,
  getPartnerSkill,
  isPartnerSkillLearned,
  learnedPartnerSkills,
  teamBuffStatuses,
} from '@/game/ext/partnerSkills'
import { usePlayerSkills } from '@/store/playerSkillsStore'

// 玩家技能絕不可有「直接傷害」語意，也不可帶 OwnedUnit/怪物招式欄位（守分界線）。
const FORBIDDEN_KEYS = ['power', 'damage', 'category', 'speciesId', 'learnedMoveIds', 'equippedMoveIds', 'level', 'ivs']

describe('M17 partnerSkills catalog 護欄', () => {
  it('每個技能只含玩家工具語意，無傷害/無 OwnedUnit 欄位', () => {
    for (const s of PARTNER_SKILLS) {
      for (const k of FORBIDDEN_KEYS) expect(s).not.toHaveProperty(k)
      expect(s.mode === 'active' || s.mode === 'support').toBe(true)
      expect(s.cost).toBeGreaterThanOrEqual(0)
      expect(s.id.length).toBeGreaterThan(0)
      expect(s.name.length).toBeGreaterThan(0)
    }
  })

  it('看穿＝核心 active/reveal、cost 0（起始可用）', () => {
    const insight = getPartnerSkill('insight')
    expect(insight?.mode).toBe('active')
    expect(insight?.reveal).toBe(true)
    expect(insight?.cost).toBe(0)
    expect(STARTER_PARTNER_SKILL_IDS).toContain('insight')
  })

  it('support 技能的 teamBuff 一律是「增益」（mult>1、turns>0），不是減益', () => {
    for (const s of PARTNER_SKILLS) {
      if (s.mode !== 'support') continue
      expect(s.cost).toBeGreaterThan(0) // 選配技能需花 SP 解鎖
      expect(s.teamBuff && s.teamBuff.length > 0).toBe(true)
      for (const b of s.teamBuff!) {
        expect(b.mult).toBeGreaterThan(1)
        expect(b.turns).toBeGreaterThan(0)
      }
    }
  })

  it('teamBuffStatuses 映射到 StatusEffect（source=-1＝非招式來源、remaining=turns）', () => {
    const rally = getPartnerSkill('rally')!
    const statuses = teamBuffStatuses(rally)
    expect(statuses.length).toBe(rally.teamBuff!.length)
    for (const st of statuses) {
      expect(st.source).toBe(-1)
      expect(st.remaining).toBeGreaterThan(0)
      expect(st.mult).toBeGreaterThan(1)
      expect(st.label).toBe(rally.name)
    }
    // 看穿無 teamBuff → 空
    expect(teamBuffStatuses(getPartnerSkill('insight')!)).toEqual([])
  })
})

describe('M17 isPartnerSkillLearned / learnedPartnerSkills', () => {
  it('起始技能（cost 0）恆習得；選配技能需在 learnedIds', () => {
    expect(isPartnerSkillLearned('insight', [])).toBe(true) // 起始
    expect(isPartnerSkillLearned('rally', [])).toBe(false) // 未解鎖
    expect(isPartnerSkillLearned('rally', ['rally'])).toBe(true) // 解鎖後
    expect(isPartnerSkillLearned('bogus', ['bogus'])).toBe(false) // catalog 沒有 → false
  })

  it('預設（無解鎖）只回起始技能；解鎖後納入', () => {
    expect(learnedPartnerSkills([]).map((s) => s.id)).toEqual(['insight'])
    expect(learnedPartnerSkills(['rally']).map((s) => s.id)).toEqual(['insight', 'rally'])
  })
})

describe('M17 playerSkillsStore（mobie.playerskills.v1，不掛 OwnedUnit）', () => {
  it('learn 冪等、has 反映狀態', () => {
    const store = usePlayerSkills.getState()
    store.learn('rally')
    store.learn('rally') // 重複不重覆加
    expect(usePlayerSkills.getState().learnedSkillIds.filter((x) => x === 'rally')).toEqual(['rally'])
    expect(usePlayerSkills.getState().has('rally')).toBe(true)
    expect(usePlayerSkills.getState().has('nope')).toBe(false)
  })
})
