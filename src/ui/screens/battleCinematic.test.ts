// EXT.1 §6 cinematicCoordinator 純行為測（plan/EXT.1 §4.c / plan/EXT.2 安全退場）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createCinematicCoordinator, type CutInSpec, type CinematicHooks } from '@/ui/screens/battleCinematic'

const SPEC: CutInSpec = { artworkUrl: 'x', casterName: '皮卡丘', moveName: '十萬伏特', type: 'electric', side: 'player' }

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('EXT.1 cinematicCoordinator', () => {
  it('pause(ms) 在時間到後 resolve', async () => {
    const c = createCinematicCoordinator()
    let done = false
    const p = c.pause(100).then(() => { done = true })
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(100)
    await p
    expect(done).toBe(true)
  })

  it('pause(0) 立即 resolve（無頓格）', async () => {
    const c = createCinematicCoordinator()
    await expect(c.pause(0)).resolves.toBeUndefined()
  })

  it('resume() 提前結束進行中的 pause 並收場（不卡死）', async () => {
    const hooks: Required<CinematicHooks> = { setCutIn: vi.fn(), setLetterbox: vi.fn(), setTimeScale: vi.fn() }
    const c = createCinematicCoordinator(hooks)
    let done = false
    const p = c.pause(99999).then(() => { done = true })
    c.resume() // 中斷
    await p
    expect(done).toBe(true)
    // 安全退場：收 cut-in / letterbox、時鐘回速
    expect(hooks.setCutIn).toHaveBeenCalledWith(null)
    expect(hooks.setLetterbox).toHaveBeenCalledWith(false)
    expect(hooks.setTimeScale).toHaveBeenCalledWith(1)
  })

  it('cutIn 依序：降速 → letterbox 進 → 顯示卡片 → 收卡片，且保留電影框（不自動 resume）', async () => {
    const calls: string[] = []
    const hooks: CinematicHooks = {
      setTimeScale: (s) => calls.push(`scale:${s}`),
      setLetterbox: (on) => calls.push(`letterbox:${on}`),
      setCutIn: (spec) => calls.push(`cutin:${spec ? spec.moveName : 'null'}`),
    }
    const c = createCinematicCoordinator(hooks)
    const p = c.cutIn(SPEC)
    await vi.advanceTimersByTimeAsync(2000)
    await p
    expect(calls).toEqual(['scale:0.45', 'letterbox:true', 'cutin:十萬伏特', 'cutin:null'])
    // 關鍵：cutIn 結束時 letterbox 仍 true（命中演出仍在框內），收尾交給呼叫端 resume()
    expect(calls).not.toContain('letterbox:false')
  })

  it('hooks 缺省（EXT.1 stub）→ cutIn 仍可呼叫、不丟例外', async () => {
    const c = createCinematicCoordinator()
    const p = c.cutIn(SPEC)
    await vi.advanceTimersByTimeAsync(2000)
    await expect(p).resolves.toBeUndefined()
  })
})
