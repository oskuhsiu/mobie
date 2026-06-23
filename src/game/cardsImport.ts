import type { Card } from '@/game/types'

// 匯入 cards 表：支援 JSON（陣列或 {cards:[...]}）與 CSV（首列為表頭）。
// 純函數、不碰 I/O；存進卡庫由 cardLibrary 負責。每筆壞資料記成 error、跳過不中斷。

export interface CardsImportResult {
  cards: Card[]
  errors: string[]
}

function toCard(raw: unknown, label: string): Card | string {
  if (typeof raw !== 'object' || raw === null) return `${label}：不是物件`
  const o = raw as Record<string, unknown>
  const cardId = typeof o.cardId === 'string' ? o.cardId.trim() : ''
  const speciesId = Number(o.speciesId)
  const level = Number(o.level)
  if (!cardId) return `${label}：缺 cardId`
  if (!Number.isInteger(speciesId) || speciesId <= 0) return `${label}：speciesId 無效（${String(o.speciesId)}）`
  if (!Number.isFinite(level) || level < 1 || level > 100) return `${label}：level 需 1..100（${String(o.level)}）`
  const card: Card = { cardId, speciesId, level: Math.floor(level) }
  if (typeof o.nature === 'number') card.nature = o.nature
  if (o.shiny === true || o.shiny === 'true' || o.shiny === 1 || o.shiny === '1') card.shiny = true
  return card
}

// CSV 表頭（大小寫不敏感）→ Card 欄位名
const CSV_KEY: Record<string, string> = {
  cardid: 'cardId', speciesid: 'speciesId', level: 'level', nature: 'nature', shiny: 'shiny',
}

function parseCsv(text: string): CardsImportResult {
  const cards: Card[] = []
  const errors: string[] = []
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0)
  if (lines.length < 2) return { cards, errors: ['CSV 至少需表頭 + 1 列資料'] }
  const header = lines[0].split(',').map((h) => CSV_KEY[h.trim().toLowerCase()] ?? h.trim())
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',').map((c) => c.trim())
    const obj: Record<string, string> = {}
    header.forEach((h, j) => { obj[h] = cells[j] ?? '' })
    const r = toCard(obj, `第 ${i + 1} 列`)
    typeof r === 'string' ? errors.push(r) : cards.push(r)
  }
  return { cards, errors }
}

function parseJson(text: string): CardsImportResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { cards: [], errors: ['JSON 解析失敗'] }
  }
  const arr = Array.isArray(data)
    ? data
    : typeof data === 'object' && data !== null && Array.isArray((data as { cards?: unknown }).cards)
      ? (data as { cards: unknown[] }).cards
      : null
  if (!arr) return { cards: [], errors: ['JSON 需為陣列或 {cards:[...]}'] }
  const cards: Card[] = []
  const errors: string[] = []
  arr.forEach((raw, i) => {
    const r = toCard(raw, `第 ${i + 1} 筆`)
    typeof r === 'string' ? errors.push(r) : cards.push(r)
  })
  return { cards, errors }
}

/** 自動辨識 JSON / CSV 並解析成 Card[]。 */
export function parseCardsImport(text: string): CardsImportResult {
  const t = (text ?? '').trim()
  if (!t) return { cards: [], errors: ['內容為空'] }
  return t.startsWith('[') || t.startsWith('{') ? parseJson(t) : parseCsv(t)
}
