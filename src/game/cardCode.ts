// 實體卡 QR 內容格式：`MZ1:<cardId>:<crc>`。
// CRC 是「防誤讀」（相機掃歪/反光導致字元錯）不是防偽——自用卡，無需簽章。

export const CARD_CODE_VERSION = 'MZ1'

/** CRC16-CCITT（poly 0x1021, init 0xFFFF）→ 4 碼大寫 hex。 */
function crc16(s: string): number {
  let crc = 0xffff
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc & 0xffff
}

/** 卡碼校驗值（對 `version:cardId` 取 CRC16）。 */
export function cardCrc(versionedPayload: string): string {
  return crc16(versionedPayload).toString(16).toUpperCase().padStart(4, '0')
}

/** 由 cardId 產生完整卡碼（自製卡 / QR 產生器用）。 */
export function makeCardCode(cardId: string): string {
  const payload = `${CARD_CODE_VERSION}:${cardId}`
  return `${payload}:${cardCrc(payload)}`
}

export type CardCodeReason = 'format' | 'version' | 'crc'

export interface ParsedCardCode {
  version: string
  cardId: string
  crc: string
  valid: boolean
  reason?: CardCodeReason
}

/** 解析並校驗掃到的卡碼。valid=false 時 reason 指出失敗類別（給明確 UI 回饋）。 */
export function parseCardCode(raw: string): ParsedCardCode {
  const s = (raw ?? '').trim()
  const parts = s.split(':')
  if (parts.length !== 3) return { version: '', cardId: '', crc: '', valid: false, reason: 'format' }
  const [version, cardId, crc] = parts
  if (version !== CARD_CODE_VERSION) return { version, cardId, crc, valid: false, reason: 'version' }
  if (!cardId) return { version, cardId, crc, valid: false, reason: 'format' }
  const expect = cardCrc(`${version}:${cardId}`)
  if (expect !== crc.toUpperCase()) return { version, cardId, crc, valid: false, reason: 'crc' }
  return { version, cardId, crc: crc.toUpperCase(), valid: true }
}
