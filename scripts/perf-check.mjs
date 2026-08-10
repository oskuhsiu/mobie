// Requires a running app server and a Chrome CDP target. Hardware ANGLE provides the gating verdict;
// SwiftShader is reported but skipped because it exaggerates the app's layered-canvas cost.
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value = 'true'] = arg.replace(/^--/, '').split('=', 2)
    return [key, value]
  }),
)

const port = Number(args.port ?? 9222)
const appUrl = args.url ?? 'http://127.0.0.1:5173/'
const sampleMs = Number(args['sample-ms'] ?? 1500)
const maxFrameGapMs = Number(args['max-frame-gap-ms'] ?? 34)
const maxJankRate = Number(args['max-jank-rate'] ?? 0.25)
const deviceScaleFactor = args.dpr ? Number(args.dpr) : null

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function connect() {
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => {
    if (!response.ok) throw new Error(`CDP target list returned ${response.status}`)
    return response.json()
  })
  const page = targets.find((target) => target.type === 'page')
  if (!page) throw new Error(`No page target found on CDP port ${port}`)

  const socket = new WebSocket(page.webSocketDebuggerUrl)
  const pending = new Map()
  let nextId = 0

  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = reject
  })

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (!message.id) return
    const request = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message.result)
  }

  return {
    close: () => socket.close(),
    call(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++nextId
        pending.set(id, { resolve, reject })
        socket.send(JSON.stringify({ id, method, params }))
      })
    },
  }
}

async function run(cdp) {
  const call = cdp.call

  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'Page evaluation failed')
    }
    return result.result.value
  }

  const waitFor = async (expression, timeoutMs = 12_000) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return
      await sleep(50)
    }
    throw new Error(`Timed out waiting for: ${expression}`)
  }

  const metrics = async () => {
    const result = await call('Performance.getMetrics')
    return Object.fromEntries(result.metrics.map(({ name, value }) => [name, value]))
  }

  const sample = async (name) => {
    const before = await metrics()
    const framePacing = await evaluate(`new Promise((resolve) => {
      const gaps = []
      const start = performance.now()
      let previous = start
      const tick = (now) => {
        gaps.push(now - previous)
        previous = now
        if (now - start >= ${sampleMs}) {
          const sorted = [...gaps].sort((a, b) => a - b)
          const percentile = (ratio) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0
          resolve({
            frames: gaps.length,
            elapsed: now - start,
            p50: percentile(0.5),
            p95: percentile(0.95),
            max: Math.max(...gaps),
            jankRate: gaps.filter((gap) => gap > ${maxFrameGapMs}).length / gaps.length,
          })
          return
        }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })`)
    const after = await metrics()
    const elapsedSeconds = framePacing.elapsed / 1000
    return {
      name,
      ...framePacing,
      taskMsPerSecond: ((after.TaskDuration - before.TaskDuration) * 1000) / elapsedSeconds,
      scriptMsPerSecond: ((after.ScriptDuration - before.ScriptDuration) * 1000) / elapsedSeconds,
      layoutMsPerSecond: ((after.LayoutDuration - before.LayoutDuration) * 1000) / elapsedSeconds,
    }
  }

  await call('Runtime.enable')
  await call('Page.enable')
  await call('Performance.enable')
  await call('Page.bringToFront')
  await call('Emulation.setFocusEmulationEnabled', { enabled: true })
  if (deviceScaleFactor) {
    await call('Emulation.setDeviceMetricsOverride', {
      width: Number(args.width ?? 1024),
      height: Number(args.height ?? 1366),
      deviceScaleFactor,
      mobile: true,
    })
  } else {
    await call('Emulation.clearDeviceMetricsOverride')
  }

  await call('Page.navigate', {
    url: 'data:text/html,<style>body{background:%23111}</style><main>calibration</main>',
  })
  await waitFor('document.readyState === "complete"')
  await sleep(500)
  const calibration = await sample('calibration')
  const renderer = await evaluate(`(() => {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl')
    const info = gl?.getExtension('WEBGL_debug_renderer_info')
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER)
  })()`)
  const softwareRenderer = /swiftshader/i.test(renderer ?? '')

  await call('Page.navigate', { url: appUrl })
  await waitFor('Boolean(document.querySelector(".title-screen__adventure"))')
  await sleep(250)
  const titleEntry = await sample('title-entry')
  await sleep(2500)
  const titleSteady = await sample('title-steady')

  await evaluate('document.querySelector(".title-screen__adventure").click()')
  await waitFor('Boolean(document.querySelector(".region-card"))')
  await sleep(250)
  const regionsEntry = await sample('regions-entry')
  await sleep(2500)
  const regionsSteady = await sample('regions-steady')

  await evaluate('document.querySelector(".region-card").click()')
  await waitFor('[...document.querySelectorAll("button")].some((button) => button.textContent?.includes("出戰"))')
  await evaluate('[...document.querySelectorAll("button")].find((button) => button.textContent?.includes("出戰")).click()')
  await waitFor('document.querySelectorAll(".poke-card").length >= 3')
  await evaluate('[...document.querySelectorAll(".poke-card")].slice(0, 3).forEach((card) => card.click())')
  await evaluate('[...document.querySelectorAll("button")].find((button) => button.textContent?.includes("出戰")).click()')
  await waitFor('Boolean(document.querySelector(".move-slot"))', 20_000)
  await sleep(500)
  const battleEntry = await sample('battle-entry')
  await sleep(3000)
  const battleSteady = await sample('battle-steady')

  await evaluate('[...document.querySelectorAll(".move-slot")].find((slot) => !slot.classList.contains("move-slot--status")).click()')
  await waitFor('Boolean(document.querySelector(".battle-action [role=button]"))')
  await evaluate('document.querySelector(".battle-action [role=button]").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))')
  await waitFor('!document.querySelector(".battle-action")', 12_000)
  const battleTurn = await sample('battle-turn')

  const results = [
    calibration,
    titleEntry,
    titleSteady,
    regionsEntry,
    regionsSteady,
    battleEntry,
    battleSteady,
    battleTurn,
  ]
  const required = new Set([
    'title-entry',
    'title-steady',
    'regions-entry',
    'regions-steady',
    'battle-entry',
    'battle-steady',
    'battle-turn',
  ])
  const failures = results
    .filter(({ name }) => required.has(name))
    .filter(({ p50, jankRate }) => p50 > maxFrameGapMs || jankRate > maxJankRate)

  console.log(`GPU: ${renderer ?? 'unknown'}`)
  console.table(
    results.map((result) => ({
      screen: result.name,
      frames: result.frames,
      'p50 (ms)': result.p50.toFixed(1),
      'p95 (ms)': result.p95.toFixed(1),
      'max (ms)': result.max.toFixed(1),
      'jank %': (result.jankRate * 100).toFixed(1),
      'task ms/s': result.taskMsPerSecond.toFixed(1),
      'script ms/s': result.scriptMsPerSecond.toFixed(1),
      'layout ms/s': result.layoutMsPerSecond.toFixed(1),
    })),
  )

  if (calibration.p50 > maxFrameGapMs || calibration.jankRate > maxJankRate) {
    throw new Error(
      `Chrome calibration is too slow (${calibration.p50.toFixed(1)}ms p50, ${(calibration.jankRate * 100).toFixed(1)}% jank); benchmark is invalid`,
    )
  }
  if (softwareRenderer && args['allow-software'] !== 'true') {
    console.warn('SKIP: SwiftShader exaggerates layered canvas performance; rerun on a hardware ANGLE target')
    return
  }
  if (failures.length) {
    process.exitCode = 1
    console.error(
      `FAIL: ${failures.map(({ name, p50, jankRate }) => `${name} ${p50.toFixed(1)}ms p50 / ${(jankRate * 100).toFixed(1)}% jank`).join(', ')}`,
    )
  } else {
    console.log(
      `PASS: screen entry, steady state and an active battle turn stay within ${maxFrameGapMs}ms p50 and ${(maxJankRate * 100).toFixed(0)}% jank`,
    )
  }
}

async function main() {
  const cdp = await connect()
  try {
    await run(cdp)
  } finally {
    cdp.close()
  }
}

main().catch((error) => {
  console.error(`Performance check failed: ${error.message}`)
  process.exitCode = 1
})
