import { Box3, type Object3D } from 'three'

/** 把任意尺寸/置中狀態不一的 drop-in GLB 正規化到統一站位。 */
export interface ModelNorm {
  /** 等比縮放係數 */
  scale: number
  /** 縮放後要套用的位移，使腳底落在 y=0、x/z 置中 */
  offset: [number, number, number]
}

export interface BoxLike {
  min: { x: number; y: number; z: number }
  max: { x: number; y: number; z: number }
}

/**
 * 由包圍盒推導正規化：把模型縮放到 `targetHeight` 高，並位移使「腳底貼地（y=0）、水平置中」。
 * 純數學、不碰 three 物件狀態，方便單元測試。
 */
export function normalizeFromBox(box: BoxLike, targetHeight = 2): ModelNorm {
  const height = box.max.y - box.min.y
  // 退化盒（高度 0 / 非有限）→ 不縮放、不位移，交給呼叫端 fallback
  const scale = height > 1e-6 && Number.isFinite(height) ? targetHeight / height : 1
  const cx = (box.min.x + box.max.x) / 2
  const cz = (box.min.z + box.max.z) / 2
  return {
    scale,
    offset: [-cx * scale, -box.min.y * scale, -cz * scale],
  }
}

/** 對 three 物件取世界包圍盒後正規化（runtime 用）。 */
export function normalizeObject(object: Object3D, targetHeight = 2): ModelNorm {
  return normalizeFromBox(new Box3().setFromObject(object), targetHeight)
}
