import { useLoader } from '@react-three/fiber'
import { TextureLoader, type Texture } from 'three'

export const ARTWORK_CACHE_LIMIT = 24

export interface ArtworkCacheDiagnostics {
  totalEntries: number
  activeEntries: number
  inactiveEntries: number
  estimatedDecodedBytes: number
  evictions: number
}

interface ArtworkEntry {
  url: string
  texture: Texture
  users: number
  lastUsed: number
}

const entries = new Map<string, ArtworkEntry>()
let clock = 0
let evictionCount = 0

function decodedBytes(texture: Texture): number {
  const image = texture.image as { width?: number; height?: number } | undefined
  const width = Number.isFinite(image?.width) ? image?.width ?? 0 : 0
  const height = Number.isFinite(image?.height) ? image?.height ?? 0 : 0
  return Math.max(0, width * height * 4)
}

function evictInactive(): void {
  while (entries.size > ARTWORK_CACHE_LIMIT) {
    const candidate = [...entries.values()]
      .filter((entry) => entry.users === 0)
      .sort((a, b) => a.lastUsed - b.lastUsed)[0]
    if (!candidate) return
    entries.delete(candidate.url)
    useLoader.clear(TextureLoader, candidate.url)
    candidate.texture.dispose()
    evictionCount += 1
  }
}

export function retainArtworkTexture(url: string, texture: Texture): void {
  clock += 1
  const current = entries.get(url)
  if (current && current.texture !== texture && current.users === 0) {
    current.texture.dispose()
  }
  entries.set(url, {
    url,
    texture,
    users: (current?.users ?? 0) + 1,
    lastUsed: clock,
  })
  evictInactive()
}

export function releaseArtworkTexture(url: string, texture: Texture): void {
  const current = entries.get(url)
  if (!current || current.texture !== texture) return
  clock += 1
  current.users = Math.max(0, current.users - 1)
  current.lastUsed = clock
  evictInactive()
}

export function artworkCacheDiagnostics(): ArtworkCacheDiagnostics {
  let activeEntries = 0
  let estimatedDecodedBytes = 0
  for (const entry of entries.values()) {
    if (entry.users > 0) activeEntries += 1
    estimatedDecodedBytes += decodedBytes(entry.texture)
  }
  return {
    totalEntries: entries.size,
    activeEntries,
    inactiveEntries: entries.size - activeEntries,
    estimatedDecodedBytes,
    evictions: evictionCount,
  }
}

/** Test-only reset; battle sessions intentionally keep the bounded cache warm. */
export function resetArtworkCacheForTests(): void {
  for (const entry of entries.values()) {
    useLoader.clear(TextureLoader, entry.url)
    entry.texture.dispose()
  }
  entries.clear()
  clock = 0
  evictionCount = 0
}
