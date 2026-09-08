// M5：把純粹的 packSave/unpackSave（bundle.ts）接到真實的 store I/O 與瀏覽器的
// 分享 / 下載。本檔有副作用（讀 IndexedDB、碰 navigator / DOM），故不在 vitest 覆蓋；
// 純邏輯都在 bundle.ts / saveMeta.ts。custom GLB 已停用，舊存檔模型只在 bundle codec
// 驗證 checksum，永不進入這層。

import type { OwnedUnit } from '@/game/types'
import { packSave, unpackSave, type UnpackResult, type UnpackOk } from './bundle'
import { loadMeta, adoptMeta, type SaveMeta } from './saveMeta'
import { listCards, replaceAllCards } from '@/game/cardLibrary'
import { saveBackup, loadBackupBytes } from './backupStore'
import { useRoster } from '@/store/rosterStore'

export interface BuiltSave {
  bytes: Uint8Array
  filename: string
  meta: SaveMeta
  /** 打包後的位元組大小（給 UI 顯示 / 判斷分享可行性） */
  size: number
}

/**
 * 打包目前存檔成 `<profileName>.save`。roster 由呼叫端（讀 useRoster 的 live 狀態）傳入，
 * cards 從 IndexedDB 取。新格式固定只含 canonical roster / cards。
 */
export async function buildSaveFile(roster: OwnedUnit[]): Promise<BuiltSave> {
  const meta = loadMeta()
  const cards = await listCards()
  const bytes = packSave({ meta, roster, cards })
  const filename = `${meta.profileName || 'trainer'}.save`
  return { bytes, filename, meta, size: bytes.byteLength }
}

export type DeliverResult = 'shared' | 'downloaded'

/**
 * 把存檔交給使用者。iPad PWA 優先 Web Share（叫出系統分享面板 → 可直接送 Google Drive /
 * Files / AirDrop，無需任何雲端 API），桌機 / 不支援時退回 `<a download>`。
 * 使用者在分享面板按取消 → 丟 AbortError（不自動改下載，避免誤觸又冒出檔案）。
 */
export async function deliverSaveFile(built: BuiltSave): Promise<DeliverResult> {
  // fflate 回傳 Uint8Array<ArrayBufferLike>；TS 嚴格泛型下需轉型才能當 BlobPart
  const blob = new Blob([built.bytes as BlobPart], { type: 'application/zip' })
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  if (typeof navigator.share === 'function') {
    const file = new File([blob], built.filename, { type: 'application/zip' })
    if (!nav.canShare || nav.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: built.filename })
        return 'shared'
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') throw e // 使用者取消：原樣回報，不退下載
        // 其他分享錯誤（權限/不支援檔案）→ 落到下載
      }
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = built.filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
  return 'downloaded'
}

// ── 匯入 ──────────────────────────────────────────────────────────────────

/** 讀 .save 檔並解析（純解析在 bundle.unpackSave；這裡只負責讀檔位元組）。 */
export async function readSaveFile(file: File): Promise<UnpackResult> {
  const buf = await file.arrayBuffer()
  return unpackSave(new Uint8Array(buf))
}

/**
 * 覆蓋「之前」備份目前狀態（安全紅線：永遠可救回）。
 * 備份內容 = 當前 roster + cards 打包（不含模型；模型可重新 drop-in，進度才不可逆）。
 */
export async function backupCurrentSave(now: number): Promise<void> {
  const meta = loadMeta()
  const roster = useRoster.getState().roster
  const cards = await listCards()
  const bytes = packSave({ meta, roster, cards })
  await saveBackup(bytes, meta, now)
}

/**
 * 套用一份已解析的存檔（整包取代）：roster → cards 整批取代 → 最後 adoptMeta 鎖定
 * 新舊血統。舊版模型已在 unpackSave 完成 opaque checksum 驗證並丟棄，因此這裡不碰
 * `mz-models`。
 */
export async function applyImportedSave(parsed: UnpackOk): Promise<void> {
  await useRoster.getState().replaceAll(parsed.roster)
  await replaceAllCards(parsed.cards)
  adoptMeta(parsed.meta)
}

/** 還原最近一次「匯入前備份」。無備份回 null；有則解析並套用（不再建立新備份）。 */
export async function restoreBackup(): Promise<UnpackResult | null> {
  const bytes = await loadBackupBytes()
  if (!bytes) return null
  const parsed = unpackSave(bytes)
  if (parsed.ok) await applyImportedSave(parsed)
  return parsed
}
