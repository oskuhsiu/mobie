import { describe, it, expect } from 'vitest'
import { zipSync, unzipSync, strToU8 } from 'fflate'
import { packSave, unpackSave, type SaveSlices } from './bundle'
import { SAVE_SCHEMA_VERSION } from './saveMeta'
import type { OwnedUnit } from '@/game/types'
import { crc32Bytes } from '@/game/crc32'

// SPECIES 含 1（妙蛙種子）/ 4（小火龍）等；sanitizeRoster 會丟棄不在圖鑑的 speciesId。
const unit = (id: string, speciesId: number): OwnedUnit => ({
  id,
  speciesId,
  level: 12,
  exp: 1728,
  ivs: { hp: 31, atk: 20, def: 5, spa: 15, spd: 8, spe: 30 },
  nature: 3,
  seed: id,
  shiny: false,
})

const slices = (over: Partial<SaveSlices> = {}): SaveSlices => ({
  meta: { schemaVersion: SAVE_SCHEMA_VERSION, profileName: 'Red', updatedAt: 1000, revision: 4 },
  roster: [unit('a', 1), unit('b', 4)],
  cards: [
    { cardId: 'C1', speciesId: 1, level: 5 },
    { cardId: 'C2', speciesId: 7, level: 9, ivs: { hp: 31, atk: 31 }, nature: 2, shiny: true, owner: '本機訓練家', source: 'import', createdAt: 1234 },
  ],
  ...over,
})

describe('bundle：packSave / unpackSave round-trip', () => {
  it('roster / cards 完整往返（含 ivs/nature/shiny）', () => {
    const r = unpackSave(packSave(slices()))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.roster).toHaveLength(2)
    expect(r.roster[0]).toMatchObject({ id: 'a', speciesId: 1, level: 12 })
    expect(r.cards).toHaveLength(2)
    // 掃描/自製卡的 ivs/nature/shiny 必須保全（不可被丟棄）
    expect(r.cards[1]).toMatchObject({ cardId: 'C2', ivs: { hp: 31, atk: 31 }, nature: 2, shiny: true })
    expect(r.cards[1]).toMatchObject({ owner: '本機訓練家', source: 'import', createdAt: 1234 })
    expect(r.meta).toMatchObject({ profileName: 'Red', updatedAt: 1000, revision: 4 })
  })

  it('新格式固定 no-model，manifest 與 zip 都沒有模型', () => {
    const packed = packSave(slices())
    const entries = unzipSync(packed)
    const r = unpackSave(packed)
    expect(JSON.parse(new TextDecoder().decode(entries['manifest.json']))).toMatchObject({
      includesModels: false,
      counts: { models: 0 },
    })
    expect(Object.keys(entries).some((path) => path.startsWith('models/'))).toBe(false)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.legacyModelCount).toBe(0)
    expect(r).not.toHaveProperty('models')
  })

  it('舊版模型 bytes 只參與 checksum，驗證後立即丟棄', () => {
    const rosterBytes = strToU8(JSON.stringify(slices().roster))
    const cardsBytes = strToU8(JSON.stringify(slices().cards))
    // 刻意不是有效 GLB；legacy codec 只應把它視為 opaque bytes。
    const opaqueBytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x00])
    const manifest = {
      schemaVersion: SAVE_SCHEMA_VERSION,
      profileName: 'Red',
      updatedAt: 1000,
      revision: 4,
      includesModels: true,
      counts: { roster: 2, cards: 2, models: 1 },
      checksum: crc32Bytes([rosterBytes, cardsBytes, opaqueBytes]),
    }
    const packed = zipSync({
      'manifest.json': strToU8(JSON.stringify(manifest)),
      'roster.json': rosterBytes,
      'cards.json': cardsBytes,
      'models/4.gltf': opaqueBytes,
    })

    const r = unpackSave(packed)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.legacyModelCount).toBe(1)
    expect(r.manifest.includesModels).toBe(true)
    expect(r).not.toHaveProperty('models')
  })

  it('manifest.counts 反映實際數量', () => {
    const r = unpackSave(packSave(slices()))
    expect(r.ok && r.manifest.counts).toEqual({ roster: 2, cards: 2, models: 0 })
  })
})

describe('bundle：壞檔分類（對齊 cardCode 的明確錯誤）', () => {
  it('非 zip → not-zip', () => {
    const r = unpackSave(strToU8('totally not a zip'))
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toBe('not-zip')
  })

  it('缺 manifest → no-manifest', () => {
    const z = zipSync({ 'roster.json': strToU8('[]'), 'cards.json': strToU8('[]') })
    const r = unpackSave(z)
    expect(!r.ok && r.error).toBe('no-manifest')
  })

  it('manifest JSON 壞 → bad-manifest', () => {
    const z = zipSync({ 'manifest.json': strToU8('{ broken') })
    const r = unpackSave(z)
    expect(!r.ok && r.error).toBe('bad-manifest')
  })

  it('schemaVersion 比本版新 → schema-too-new', () => {
    const manifest = JSON.stringify({ schemaVersion: SAVE_SCHEMA_VERSION + 99, checksum: 'deadbeef' })
    const z = zipSync({ 'manifest.json': strToU8(manifest) })
    const r = unpackSave(z)
    expect(!r.ok && r.error).toBe('schema-too-new')
  })

  it('缺 roster/cards → bad-payload', () => {
    const manifest = JSON.stringify({ schemaVersion: SAVE_SCHEMA_VERSION, checksum: 'deadbeef' })
    const z = zipSync({ 'manifest.json': strToU8(manifest) })
    const r = unpackSave(z)
    expect(!r.ok && r.error).toBe('bad-payload')
  })

  it('payload 被竄改 → checksum-mismatch', () => {
    const packed = packSave(slices())
    const entries = unzipSync(packed)
    entries['roster.json'][0] ^= 0xff // 翻一個位元組
    const r = unpackSave(zipSync(entries))
    expect(!r.ok && r.error).toBe('checksum-mismatch')
  })
})
