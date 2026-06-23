import { useEffect, useState } from 'react'
import { getModelUrl, subscribeModels } from './modelStore'

/**
 * 解析某 speciesId 的自訂 GLB objectURL。
 * - `undefined`：查詢中（先別決定要不要 fallback）
 * - `null`：無自訂模型 → 用 billboard fallback
 * - `string`：objectURL → 載 GLB
 * 匯入/刪除模型時自動重解析（透過 modelStore 訂閱）。
 */
export function useModelUrl(speciesId: number): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    let alive = true
    const resolve = () => {
      getModelUrl(speciesId).then((u) => {
        if (alive) setUrl(u)
      })
    }
    resolve()
    const unsub = subscribeModels(resolve)
    return () => {
      alive = false
      unsub()
    }
  }, [speciesId])

  return url
}
