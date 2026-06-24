// crc32 校驗（非加密，只為偵測下載截斷 / 手改 / 損毀）。
// save/bundle.ts（位元組區塊）與 replay/codec.ts（JSON 字串）共用同一張表與演算法。

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

/** 對一串位元組區塊算 crc32 → 8 位 hex。順序敏感：pack / unpack 須用相同串接順序。 */
export function crc32Bytes(chunks: Uint8Array[]): string {
  let crc = 0xffffffff
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      crc = CRC_TABLE[(crc ^ chunk[i]) & 0xff] ^ (crc >>> 8)
    }
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0')
}

/** 對 UTF-8 字串算 crc32 → 8 位 hex。 */
export function crc32Str(s: string): string {
  return crc32Bytes([new TextEncoder().encode(s)])
}
