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
const pendingLoads = new Map<string, Promise<Texture>>()
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
    candidate.texture.dispose()
    evictionCount += 1
  }
}

function touch(entry: ArtworkEntry): void {
  clock += 1
  entry.lastUsed = clock
}

function rememberArtworkTexture(url: string, texture: Texture): Texture {
  const current = entries.get(url)
  if (current && current.texture !== texture) {
    if (current.users > 0) {
      texture.dispose()
      touch(current)
      return current.texture
    }
    current.texture.dispose()
  }
  entries.set(url, {
    url,
    texture,
    users: current?.users ?? 0,
    lastUsed: clock,
  })
  evictInactive()
  return texture
}

/** Return a decoded texture already owned by the bounded cache. */
export function getArtworkTexture(url: string): Texture | null {
  const entry = entries.get(url)
  if (!entry) return null
  touch(entry)
  return entry.texture
}

/** Load artwork once per URL and retain an inactive cache entry for later users. */
export function loadArtworkTexture(url: string): Promise<Texture> {
  const cached = getArtworkTexture(url)
  if (cached) return Promise.resolve(cached)
  const pending = pendingLoads.get(url)
  if (pending) return pending

  const request = new Promise<Texture>((resolve, reject) => {
    new TextureLoader().load(url, (texture) => resolve(texture), undefined, reject)
  }).then((texture) => rememberArtworkTexture(url, texture))
  pendingLoads.set(url, request)
  void request.finally(() => pendingLoads.delete(url)).catch(() => undefined)
  return request
}

export function retainArtworkTexture(url: string, texture: Texture): void {
  const owned = rememberArtworkTexture(url, texture)
  const entry = entries.get(url)
  if (!entry || entry.texture !== owned) return
  touch(entry)
  entry.users += 1
  evictInactive()
}

export function releaseArtworkTexture(url: string, texture: Texture): void {
  const current = entries.get(url)
  if (!current || current.texture !== texture) return
  touch(current)
  current.users = Math.max(0, current.users - 1)
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
    entry.texture.dispose()
  }
  entries.clear()
  pendingLoads.clear()
  clock = 0
  evictionCount = 0
}
