import { describe, it, expect } from 'vitest'
import { makeCardCode, parseCardCode, cardCrc, CARD_CODE_VERSION } from './cardCode'

describe('cardCode', () => {
  it('make → parse 來回一致且 valid', () => {
    const code = makeCardCode('ABC-123')
    expect(code.startsWith(`${CARD_CODE_VERSION}:ABC-123:`)).toBe(true)
    const p = parseCardCode(code)
    expect(p.valid).toBe(true)
    expect(p.cardId).toBe('ABC-123')
    expect(p.version).toBe('MZ1')
  })

  it('CRC 是 4 碼大寫 hex', () => {
    const crc = cardCrc('MZ1:ABC-123')
    expect(crc).toMatch(/^[0-9A-F]{4}$/)
  })

  it('CRC 對不同 payload 不同（防誤讀）', () => {
    expect(cardCrc('MZ1:A')).not.toBe(cardCrc('MZ1:B'))
  })

  it('CRC 被竄改 → reason=crc', () => {
    const p = parseCardCode('MZ1:ABC-123:0000')
    expect(p.valid).toBe(false)
    expect(p.reason).toBe('crc')
  })

  it('版本不符 → reason=version', () => {
    const p = parseCardCode('MZ9:ABC-123:0000')
    expect(p.valid).toBe(false)
    expect(p.reason).toBe('version')
  })

  it('格式不對（段數錯）→ reason=format', () => {
    expect(parseCardCode('garbage').reason).toBe('format')
    expect(parseCardCode('MZ1:onlytwo').reason).toBe('format')
    expect(parseCardCode('MZ1::0000').reason).toBe('format') // 空 cardId
  })

  it('CRC 段小寫也接受（只 CRC 大小寫不敏感）', () => {
    const [v, id, crc] = makeCardCode('XY9').split(':')
    const p = parseCardCode(`${v}:${id}:${crc.toLowerCase()}`)
    expect(p.valid).toBe(true)
  })

  it('前後空白會被 trim', () => {
    const code = makeCardCode('PAD')
    expect(parseCardCode(`  ${code}\n`).valid).toBe(true)
  })
})
