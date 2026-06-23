import { describe, it, expect } from 'vitest'
import { parseCardsImport } from './cardsImport'

describe('parseCardsImport', () => {
  it('JSON 陣列', () => {
    const { cards, errors } = parseCardsImport(JSON.stringify([
      { cardId: 'A1', speciesId: 25, level: 12 },
      { cardId: 'A2', speciesId: 4, level: 8, shiny: true },
    ]))
    expect(errors).toHaveLength(0)
    expect(cards).toHaveLength(2)
    expect(cards[1]).toMatchObject({ cardId: 'A2', speciesId: 4, level: 8, shiny: true })
  })

  it('JSON {cards:[...]} 包裹', () => {
    const { cards } = parseCardsImport(JSON.stringify({ cards: [{ cardId: 'B', speciesId: 1, level: 5 }] }))
    expect(cards).toHaveLength(1)
    expect(cards[0].cardId).toBe('B')
  })

  it('CSV 含表頭', () => {
    const { cards, errors } = parseCardsImport('cardId,speciesId,level\nC1,7,10\nC2,133,15')
    expect(errors).toHaveLength(0)
    expect(cards.map((c) => c.cardId)).toEqual(['C1', 'C2'])
    expect(cards[1]).toMatchObject({ speciesId: 133, level: 15 })
  })

  it('壞列被記成 error 並跳過、好列保留', () => {
    const { cards, errors } = parseCardsImport(JSON.stringify([
      { cardId: 'ok', speciesId: 25, level: 12 },
      { cardId: '', speciesId: 25, level: 12 },
      { cardId: 'badlevel', speciesId: 25, level: 999 },
      { cardId: 'badspecies', speciesId: 0, level: 5 },
    ]))
    expect(cards).toHaveLength(1)
    expect(cards[0].cardId).toBe('ok')
    expect(errors).toHaveLength(3)
  })

  it('JSON 解析失敗 → error', () => {
    expect(parseCardsImport('{ not json').errors[0]).toMatch(/JSON/)
  })

  it('空內容 → error', () => {
    expect(parseCardsImport('   ').errors[0]).toMatch(/空/)
  })

  it('CSV 只有表頭沒資料 → error', () => {
    expect(parseCardsImport('cardId,speciesId,level').errors).toHaveLength(1)
  })
})
