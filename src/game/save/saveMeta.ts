// M5：可攜存檔的中繼資料（profile 名 + 新舊判斷）。
//
// 這不是「雲端同步」：沒有後端、沒有 secret、沒有自動 pull/push。
// 存檔 = 使用者自己打包/搬運的 `<profileName>.save`(zip) 檔；雲端那段（Google Drive…）由
// OS 分享面板 / 檔案挑選負責。本模組只回答一個問題：「我這份存檔多新？」——
// 讓匯入時能比對方向（較新 / 較舊 / 相同），由使用者拍板是否覆蓋（見 plan/08 重新定位）。
//
// 設計：純判斷邏輯（compareSaves / migrateMeta / sanitizeProfileName）可單獨 vitest；
// localStorage I/O 薄且在無 localStorage（node 測試）時安全退回預設。

export const SAVE_SCHEMA_VERSION = 1

export interface SaveMeta {
  /** 存檔格式版本；未來改 schema 時用來遷移舊 .save 檔 */
  schemaVersion: number
  /** 使用者自取的存檔名 → 成為 `<profileName>.save` 檔名 + manifest 標示；預設 'trainer' */
  profileName: string
  /** 最後一次有效寫入的 wall-clock（ms）；新舊判斷的主訊號 */
  updatedAt: number
  /** 單調遞增的本機存檔版本號；updatedAt 同分時的次要訊號 */
  revision: number
}

const KEY = 'mobie.savemeta.v1'

function hasLS(): boolean {
  return typeof localStorage !== 'undefined'
}

export function defaultMeta(): SaveMeta {
  return { schemaVersion: SAVE_SCHEMA_VERSION, profileName: 'trainer', updatedAt: 0, revision: 0 }
}

/**
 * 清洗 profile 名 → 可安全當檔名（保留各語系字母/數字/底線/連字號，去路徑與控制字元，截 24）。
 * 回 null 表非字串或清空後為空，交由呼叫端決定 fallback。
 */
export function sanitizeProfileName(v: unknown): string | null {
  if (typeof v !== 'string') return null
  // \p{L} 含 CJK，故中文名可保留；空白與符號一律去除避免檔名地雷
  const cleaned = v.replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 24)
  return cleaned.length > 0 ? cleaned : null
}

/** 把任意外來物正規化成合法 SaveMeta（遷移 / 防壞檔）。純函數，可測。 */
export function migrateMeta(raw: unknown): SaveMeta {
  const base = defaultMeta()
  if (!raw || typeof raw !== 'object') return base
  const o = raw as Record<string, unknown>
  return {
    schemaVersion: typeof o.schemaVersion === 'number' ? o.schemaVersion : base.schemaVersion,
    profileName: sanitizeProfileName(o.profileName) ?? base.profileName,
    updatedAt: typeof o.updatedAt === 'number' && o.updatedAt >= 0 ? o.updatedAt : base.updatedAt,
    revision:
      typeof o.revision === 'number' && o.revision >= 0 ? Math.floor(o.revision) : base.revision,
  }
}

export type SaveComparison = 'newer' | 'older' | 'same'

/**
 * 比 incoming 相對於 local 是「較新 / 較舊 / 相同」。
 * 主訊號 updatedAt（wall-clock），同分看 revision（本機單調）。
 * 注意：這只是建議方向；UI 永遠顯示完整對照並要求使用者明確同意才覆蓋（需求 4/5），
 * 故即使時鐘偏移造成誤判，也不會自動毀資料。
 */
export function compareSaves(local: SaveMeta, incoming: SaveMeta): SaveComparison {
  if (incoming.updatedAt > local.updatedAt) return 'newer'
  if (incoming.updatedAt < local.updatedAt) return 'older'
  if (incoming.revision > local.revision) return 'newer'
  if (incoming.revision < local.revision) return 'older'
  return 'same'
}

export function loadMeta(): SaveMeta {
  if (!hasLS()) return defaultMeta()
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaultMeta()
    return migrateMeta(JSON.parse(raw))
  } catch {
    return defaultMeta()
  }
}

function writeMeta(meta: SaveMeta): void {
  if (!hasLS()) return
  try {
    localStorage.setItem(KEY, JSON.stringify(meta))
  } catch {
    /* 配額 / 隱私模式失敗：忽略，不影響遊戲 */
  }
}

/**
 * 任一存檔資料（roster / cards / models）寫入後呼叫：revision++、updatedAt = now。
 * now 由呼叫端傳入（`Date.now()`），保持本模組可測、不直接相依時鐘。
 */
export function bumpSaveMeta(now: number): SaveMeta {
  const cur = loadMeta()
  const next: SaveMeta = { ...cur, updatedAt: now, revision: cur.revision + 1 }
  writeMeta(next)
  return next
}

export function setProfileName(name: string): SaveMeta {
  const cur = loadMeta()
  const next: SaveMeta = { ...cur, profileName: sanitizeProfileName(name) ?? cur.profileName }
  writeMeta(next)
  return next
}

/**
 * 匯入套用「之後」呼叫：採用匯入存檔的 updatedAt/revision 血統（讓後續本機比對一致），
 * 但 schemaVersion 鎖回本機當前版本。必須在所有資料寫入（含會 bump 的 putCards/putModel）之後呼叫，
 * 才不會被那些 bump 蓋掉。
 */
export function adoptMeta(incoming: SaveMeta): SaveMeta {
  const next: SaveMeta = { ...migrateMeta(incoming), schemaVersion: SAVE_SCHEMA_VERSION }
  writeMeta(next)
  return next
}
