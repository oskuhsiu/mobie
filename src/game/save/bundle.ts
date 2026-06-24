// M5：可攜存檔檔案 `<profileName>.save`（其實是個 zip）的打包 / 解包。
//
// 純函數：輸入是「已從各 store 取出的資料」（roster 陣列 / cards 陣列 / 可選 model bytes），
// 輸出 / 輸入是 zip 的 Uint8Array。讀 IndexedDB / localStorage 的 I/O 由呼叫端（exportSave /
// importSave）負責，故本檔可在 node 直接 vitest round-trip。
//
// zip 內容：
//   manifest.json          ← 信封：版本 / profile / updatedAt / revision / checksum / 計數
//   roster.json            ← OwnedUnit[]
//   cards.json             ← Card[]（保全 ivs/nature/shiny）
//   models/<speciesId>.glb ← 二進位（可選；includesModels=false 時整個省略）
//
// 解包採「分類錯誤」風格（對齊 cardCode.ts 的 format/version/crc）：壞檔給明確 error 而非默默吞掉。

import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'
import type { Card, OwnedUnit, Stats } from '@/game/types'
import { SAVE_SCHEMA_VERSION, migrateMeta, type SaveMeta } from './saveMeta'
import { sanitizeRoster } from '@/game/rosterSanitize'
import { crc32Bytes } from '@/game/crc32'

const MANIFEST = 'manifest.json'
const ROSTER = 'roster.json'
const CARDS = 'cards.json'
const MODEL_DIR = 'models/'

export interface SaveManifest {
  schemaVersion: number
  profileName: string
  updatedAt: number
  revision: number
  includesModels: boolean
  counts: { roster: number; cards: number; models: number }
  /** payload（roster/cards/models 的原始位元組）的 crc32 十六進位；擋下載截斷 / 壞檔 */
  checksum: string
}

export interface SaveModel {
  speciesId: number
  bytes: Uint8Array
}

/** packSave 的輸入：已從各 store 取出的純資料。省略 models 即「不含模型」備份。 */
export interface SaveSlices {
  meta: SaveMeta
  roster: OwnedUnit[]
  cards: Card[]
  models?: SaveModel[]
}

export type UnpackErrorCode =
  | 'not-zip' // 根本不是 zip / 解壓失敗
  | 'no-manifest' // 缺 manifest.json
  | 'bad-manifest' // manifest 壞 / 非預期結構
  | 'schema-too-new' // 由更新版遊戲產生，本版讀不了
  | 'bad-payload' // roster.json / cards.json 解析失敗
  | 'checksum-mismatch' // payload 校驗不符（截斷 / 竄改 / 損毀）

export interface UnpackOk {
  ok: true
  meta: SaveMeta
  manifest: SaveManifest
  roster: OwnedUnit[]
  cards: Card[]
  models: SaveModel[]
  includesModels: boolean
}
export interface UnpackFail {
  ok: false
  error: UnpackErrorCode
  message: string
}
export type UnpackResult = UnpackOk | UnpackFail

/** payload 校驗的固定順序：roster → cards → models(依 speciesId 升冪) 的原始位元組。 */
function payloadChunks(rosterBytes: Uint8Array, cardsBytes: Uint8Array, models: SaveModel[]): Uint8Array[] {
  const sorted = [...models].sort((a, b) => a.speciesId - b.speciesId)
  return [rosterBytes, cardsBytes, ...sorted.map((m) => m.bytes)]
}

// ── 打包 ──────────────────────────────────────────────────────────────────
export function packSave(slices: SaveSlices): Uint8Array {
  const models = slices.models ?? []
  const includesModels = models.length > 0
  const rosterBytes = strToU8(JSON.stringify(slices.roster))
  const cardsBytes = strToU8(JSON.stringify(slices.cards))

  const manifest: SaveManifest = {
    schemaVersion: SAVE_SCHEMA_VERSION,
    profileName: slices.meta.profileName,
    updatedAt: slices.meta.updatedAt,
    revision: slices.meta.revision,
    includesModels,
    counts: { roster: slices.roster.length, cards: slices.cards.length, models: models.length },
    checksum: crc32Bytes(payloadChunks(rosterBytes, cardsBytes, models)),
  }

  const files: Record<string, Uint8Array> = {
    [MANIFEST]: strToU8(JSON.stringify(manifest, null, 2)),
    [ROSTER]: rosterBytes,
    [CARDS]: cardsBytes,
  }
  for (const m of models) files[`${MODEL_DIR}${m.speciesId}.glb`] = m.bytes

  return zipSync(files, { level: 6 })
}

// ── 解包 ──────────────────────────────────────────────────────────────────
function fail(error: UnpackErrorCode, message: string): UnpackFail {
  return { ok: false, error, message }
}

/** 校正單張 Card：保全 ivs/nature/shiny，丟棄結構不對者。回 null=丟棄。 */
function coerceCard(raw: unknown): Card | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const cardId = typeof o.cardId === 'string' ? o.cardId.trim() : ''
  const speciesId = Number(o.speciesId)
  const level = Number(o.level)
  if (!cardId) return null
  if (!Number.isInteger(speciesId) || speciesId <= 0) return null
  if (!Number.isFinite(level) || level < 1 || level > 100) return null
  const card: Card = { cardId, speciesId, level: Math.floor(level) }
  if (o.ivs && typeof o.ivs === 'object') {
    const iv = o.ivs as Partial<Record<keyof Stats, unknown>>
    const part: Partial<Stats> = {}
    for (const k of ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const) {
      if (typeof iv[k] === 'number' && Number.isFinite(iv[k])) part[k] = Math.floor(iv[k] as number)
    }
    if (Object.keys(part).length > 0) card.ivs = part
  }
  if (typeof o.nature === 'number') card.nature = o.nature
  if (o.shiny === true) card.shiny = true
  return card
}

function parseManifest(raw: unknown): SaveManifest | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.schemaVersion !== 'number' || typeof o.checksum !== 'string') return null
  const m = migrateMeta(o) // 借 saveMeta 的欄位校正（profileName/updatedAt/revision）
  const c = (o.counts && typeof o.counts === 'object' ? o.counts : {}) as Record<string, unknown>
  return {
    schemaVersion: o.schemaVersion,
    profileName: m.profileName,
    updatedAt: m.updatedAt,
    revision: m.revision,
    includesModels: o.includesModels === true,
    counts: {
      roster: typeof c.roster === 'number' ? c.roster : 0,
      cards: typeof c.cards === 'number' ? c.cards : 0,
      models: typeof c.models === 'number' ? c.models : 0,
    },
    checksum: o.checksum,
  }
}

export function unpackSave(bytes: Uint8Array): UnpackResult {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(bytes)
  } catch {
    return fail('not-zip', '這不是有效的存檔檔（無法解壓縮）。請確認選到 .save 檔。')
  }

  const manifestBytes = entries[MANIFEST]
  if (!manifestBytes) return fail('no-manifest', '存檔缺少 manifest，可能不是本遊戲的存檔或已損毀。')

  let manifestRaw: unknown
  try {
    manifestRaw = JSON.parse(strFromU8(manifestBytes))
  } catch {
    return fail('bad-manifest', '存檔的 manifest 損毀（JSON 解析失敗）。')
  }
  const manifest = parseManifest(manifestRaw)
  if (!manifest) return fail('bad-manifest', '存檔的 manifest 結構不正確。')
  if (manifest.schemaVersion > SAVE_SCHEMA_VERSION) {
    return fail('schema-too-new', `此存檔由更新版本（schema v${manifest.schemaVersion}）產生，請先更新遊戲再匯入。`)
  }

  const rosterBytes = entries[ROSTER]
  const cardsBytes = entries[CARDS]
  if (!rosterBytes || !cardsBytes) return fail('bad-payload', '存檔缺少進度資料（roster / cards）。')

  // 收集 model bytes（依檔名 models/<id>.glb）
  const models: SaveModel[] = []
  for (const [path, data] of Object.entries(entries)) {
    if (!path.startsWith(MODEL_DIR)) continue
    const idStr = path.slice(MODEL_DIR.length).replace(/\.glb$/i, '')
    const speciesId = Number(idStr)
    if (Number.isInteger(speciesId) && speciesId > 0) models.push({ speciesId, bytes: data })
  }

  // 校驗 payload（用原始位元組，與 pack 同順序）
  const expect = crc32Bytes(payloadChunks(rosterBytes, cardsBytes, models))
  if (expect !== manifest.checksum) {
    return fail('checksum-mismatch', '存檔校驗失敗，檔案可能在下載 / 傳輸中損毀或被竄改。')
  }

  let rosterRaw: unknown
  let cardsRaw: unknown
  try {
    rosterRaw = JSON.parse(strFromU8(rosterBytes))
    cardsRaw = JSON.parse(strFromU8(cardsBytes))
  } catch {
    return fail('bad-payload', '存檔的進度資料損毀（JSON 解析失敗）。')
  }

  const roster = sanitizeRoster(Array.isArray(rosterRaw) ? rosterRaw : [])
  const cards = (Array.isArray(cardsRaw) ? cardsRaw : [])
    .map(coerceCard)
    .filter((c): c is Card => c !== null)

  const meta: SaveMeta = {
    schemaVersion: SAVE_SCHEMA_VERSION,
    profileName: manifest.profileName,
    updatedAt: manifest.updatedAt,
    revision: manifest.revision,
  }

  return { ok: true, meta, manifest, roster, cards, models, includesModels: manifest.includesModels }
}
