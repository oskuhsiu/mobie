// M5：把純粹的 packSave/unpackSave（bundle.ts）接到真實的 store I/O 與瀏覽器的
// 分享 / 下載。本檔有副作用（讀 IndexedDB、碰 navigator / DOM），故不在 vitest 覆蓋；
// 純邏輯都在 bundle.ts / saveMeta.ts。匯入套用（apply）在 M5-4 補上。

import type { OwnedUnit } from '@/game/types'
import { packSave, type SaveModel } from './bundle'
import { loadMeta, type SaveMeta } from './saveMeta'
import { listCards } from '@/game/cardLibrary'
import { listModelIds, getModelBlob } from '@/scene/models/modelStore'

async function gatherModels(): Promise<SaveModel[]> {
  const ids = await listModelIds()
  const out: SaveModel[] = []
  for (const id of ids) {
    const blob = await getModelBlob(id)
    if (blob) out.push({ speciesId: id, bytes: new Uint8Array(await blob.arrayBuffer()) })
  }
  return out
}

export interface BuiltSave {
  bytes: Uint8Array
  filename: string
  meta: SaveMeta
  /** 打包後的位元組大小（給 UI 顯示 / 判斷分享可行性） */
  size: number
  modelCount: number
}

/**
 * 打包目前存檔成 `<profileName>.save`。roster 由呼叫端（讀 useRoster 的 live 狀態）傳入，
 * cards / models 從各自的 IndexedDB 取。includeModels=false 時不含 GLB（小而快）。
 */
export async function buildSaveFile(roster: OwnedUnit[], includeModels: boolean): Promise<BuiltSave> {
  const meta = loadMeta()
  const cards = await listCards()
  const models = includeModels ? await gatherModels() : undefined
  const bytes = packSave({ meta, roster, cards, models })
  const filename = `${meta.profileName || 'trainer'}.save`
  return { bytes, filename, meta, size: bytes.byteLength, modelCount: models?.length ?? 0 }
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
