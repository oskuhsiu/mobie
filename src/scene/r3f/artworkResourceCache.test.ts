import { afterEach, describe, expect, it } from 'vitest'
import { Texture } from 'three'
import {
  ARTWORK_CACHE_LIMIT,
  artworkCacheDiagnostics,
  releaseArtworkTexture,
  resetArtworkCacheForTests,
  retainArtworkTexture,
} from './artworkResourceCache'

function texture(width = 256, height = 256): Texture {
  const value = new Texture()
  value.image = { width, height } as never
  return value
}

describe('artwork resource cache', () => {
  afterEach(() => resetArtworkCacheForTests())

  it('keeps inactive artwork to a bounded LRU and reports decoded-byte estimates', () => {
    for (let index = 0; index < ARTWORK_CACHE_LIMIT + 3; index += 1) {
      const value = texture(128, 128)
      retainArtworkTexture(`artwork-${index}`, value)
      releaseArtworkTexture(`artwork-${index}`, value)
    }

    expect(artworkCacheDiagnostics()).toMatchObject({
      totalEntries: ARTWORK_CACHE_LIMIT,
      activeEntries: 0,
      inactiveEntries: ARTWORK_CACHE_LIMIT,
      evictions: 3,
      estimatedDecodedBytes: ARTWORK_CACHE_LIMIT * 128 * 128 * 4,
    })
  })

  it('never evicts an artwork texture still used by an active combatant', () => {
    const active = texture(64, 64)
    retainArtworkTexture('active', active)
    for (let index = 0; index < ARTWORK_CACHE_LIMIT + 2; index += 1) {
      const value = texture(64, 64)
      retainArtworkTexture(`inactive-${index}`, value)
      releaseArtworkTexture(`inactive-${index}`, value)
    }

    expect(artworkCacheDiagnostics()).toMatchObject({
      activeEntries: 1,
      totalEntries: ARTWORK_CACHE_LIMIT,
      evictions: 3,
    })
    releaseArtworkTexture('active', active)
  })
})
