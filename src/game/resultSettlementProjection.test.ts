import { describe, expect, it, vi } from 'vitest'
import {
  ResultSettlementProjectionController,
  type ResultIdentity,
  type ResultSettlementPayload,
  type ResultSettlementProjectionDriver,
  type ResultSettlementReceipt,
} from './resultSettlement'
import { beginSaveMutation } from './save/saveOperationGuard'

const identity: ResultIdentity = { resultId: 'projection-result', resultFingerprint: 'projection-fp' }
const payload: ResultSettlementPayload = {
  unitIds: [],
  foeLevels: [],
  ratio: 1,
  outcome: 'win',
}

const receipt: ResultSettlementReceipt = {
  ...identity,
  status: 'applied',
  results: [],
  evolutions: [],
  moveLearns: [],
  appliedAt: 1,
}

function driver(overrides: Partial<ResultSettlementProjectionDriver> = {}): ResultSettlementProjectionDriver {
  return {
    prepare: vi.fn().mockResolvedValue(identity),
    settle: vi.fn().mockResolvedValue(receipt),
    markResultLeft: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

describe('ResultSettlementProjectionController', () => {
  it('runs one serialized settlement for StrictMode/remount starts and exposes settled only after the receipt', async () => {
    const dependencies = driver()
    const controller = new ResultSettlementProjectionController(dependencies)

    controller.start({ identity, payload })
    controller.start({ identity, payload })
    expect(controller.getSnapshot().status).toBe('running')
    await flush()

    expect(controller.getSnapshot().status).toBe('settled')
    expect(dependencies.prepare).toHaveBeenCalledTimes(1)
    expect(dependencies.settle).toHaveBeenCalledTimes(1)
  })

  it('turns a same-id different-fingerprint start into a recoverable collision without settling', async () => {
    const dependencies = driver()
    const controller = new ResultSettlementProjectionController(dependencies)
    controller.start({ identity, payload })
    await flush()

    const collision = { ...identity, resultFingerprint: 'other-fp' }
    controller.start({ identity: collision, payload })

    expect(controller.getSnapshot()).toMatchObject({ status: 'error', identity: collision, error: { code: 'collision' } })
    expect(dependencies.settle).toHaveBeenCalledTimes(1)
  })

  it('retries a failed projection while retaining the same identity and never retries a collision', async () => {
    const settle = vi.fn()
      .mockRejectedValueOnce(new Error('temporary storage failure'))
      .mockResolvedValueOnce(receipt)
    const dependencies = driver({ settle })
    const controller = new ResultSettlementProjectionController(dependencies)

    controller.start({ identity, payload })
    await flush()
    expect(controller.getSnapshot()).toMatchObject({ status: 'error', error: { code: 'storage' } })

    controller.retry()
    await flush()
    expect(controller.getSnapshot()).toMatchObject({ status: 'settled', identity })
    expect(settle).toHaveBeenCalledTimes(2)

    const collision = { ...identity, resultFingerprint: 'collision-fp' }
    controller.start({ identity: collision, payload })
    controller.retry()
    expect(settle).toHaveBeenCalledTimes(2)
  })

  it('ignores a late completion from an older result after a new pair starts', async () => {
    let releaseFirst!: (value: ResultIdentity) => void
    const firstPreparation = new Promise<ResultIdentity>((resolve) => { releaseFirst = resolve })
    const secondIdentity = { resultId: 'projection-result-2', resultFingerprint: 'projection-fp-2' }
    const dependencies = driver({
      prepare: vi.fn()
        .mockReturnValueOnce(firstPreparation)
        .mockResolvedValue(secondIdentity),
      settle: vi.fn().mockResolvedValue({ ...receipt, ...secondIdentity }),
    })
    const controller = new ResultSettlementProjectionController(dependencies)

    controller.start({ identity, payload })
    controller.start({ identity: secondIdentity, payload })
    releaseFirst(identity)
    await flush()

    expect(controller.getSnapshot()).toMatchObject({ status: 'settled', identity: secondIdentity })
    expect(dependencies.settle).toHaveBeenCalledTimes(1)
    expect(dependencies.settle).toHaveBeenCalledWith(secondIdentity, payload)
  })

  it('does not start Result after Save acquires the shared mutation mutex', async () => {
    const dependencies = driver()
    const controller = new ResultSettlementProjectionController(dependencies)
    const release = beginSaveMutation()

    controller.start({ identity, payload })
    expect(controller.getSnapshot()).toMatchObject({ status: 'error', error: { code: 'storage' } })
    expect(dependencies.prepare).not.toHaveBeenCalled()

    release()
    controller.retry()
    await flush()
    expect(controller.getSnapshot().status).toBe('settled')
    expect(dependencies.settle).toHaveBeenCalledTimes(1)
  })
})
