// Requires a running app server and a Chrome CDP target. Hardware ANGLE provides the gating verdict;
// SwiftShader is reported but skipped because it exaggerates the app's layered-canvas cost.
// When --evidence=true (or --output=<path>) is supplied, the app's diagnostics are written beside the
// other M23 evidence. Active-frame gaps are read from the DEV diagnostics port; idle cadence is reported
// separately and never contributes to the active-frame governor verdict.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value = 'true'] = arg.replace(/^--/, '').split('=', 2)
    return [key, value]
  }),
)

const port = Number(args.port ?? 9222)
const appUrl = args.url ?? 'http://127.0.0.1:5173/'
const sampleMs = Number(args['sample-ms'] ?? 1500)
const maxMedianMs = Number(args['max-median-ms'] ?? 25)
const maxP95Ms = Number(args['max-p95-ms'] ?? 34)
const maxFrameGapMs = Number(args['max-frame-gap-ms'] ?? 34)
const maxJankRate = Number(args['max-jank-rate'] ?? 0.05)
const deviceScaleFactor = args.dpr ? Number(args.dpr) : null
const scenarioId = args.scenario ?? 'm23-current-parity-v1'
const driverScenarioId = 'm23-current-parity-v1'
const seed = args.seed ?? `${scenarioId}-perf`
const graphics = args.graphics ?? 'auto'
const requestedRendererRoute = args.renderer ?? args.rendererRoute ?? null
const rendererRoute = requestedRendererRoute ?? 'next'
const motion = args.motion ?? 'full'
const deviceName = args.device ?? 'chrome-local'
const outputPath = args.output
  ?? (args.evidence === 'true' ? `test-runs/m23/${deviceName}/${scenarioId}/metrics.json` : null)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function safeSegment(value, name) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value) || value === '.' || value === '..') {
    throw new Error(`--${name} must be one safe path segment`)
  }
  return value
}

if (!['next', 'compatibility'].includes(rendererRoute)) {
  throw new Error('--renderer must be one of next, compatibility')
}

safeSegment(deviceName, 'device')
safeSegment(scenarioId, 'scenario')

function percentile(values, ratio) {
  const sorted = [...values].filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0
}

function summarizeGaps(values) {
  const gaps = values.filter((value) => Number.isFinite(value) && value >= 0)
  if (gaps.length === 0) return null
  const overBudgetCount = gaps.filter((gap) => gap > maxFrameGapMs).length
  return {
    sampleCount: gaps.length,
    p50Ms: percentile(gaps, 0.5),
    p95Ms: percentile(gaps, 0.95),
    maxMs: Math.max(...gaps),
    overBudgetCount,
    overBudgetRate: overBudgetCount / gaps.length,
  }
}

async function collectBattleChunks() {
  const assetsDir = resolve('dist', 'assets')
  let entries
  try {
    entries = await readdir(assetsDir, { withFileTypes: true })
  } catch {
    return { files: [], limitation: 'Production chunks unavailable; run npm run build before release evidence.' }
  }
  const files = []
  for (const entry of entries.filter((candidate) => candidate.isFile() && candidate.name.endsWith('.js')).sort((a, b) => a.name.localeCompare(b.name))) {
    const bytes = await readFile(resolve(assetsDir, entry.name))
    files.push({
      name: entry.name,
      bytes: bytes.length,
      gzipBytes: gzipSync(bytes).length,
      battleRelevant: /^(NextBattleScene|CaptureStage|MobieVisual|three-vendor|battle-compatibility|battleRenderer|index)-/.test(entry.name),
    })
  }
  return { files }
}

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
    const diagnostics = await evaluate('window.__MOBIE_M23_BASELINE__?.diagnostics?.() ?? null')
    return {
      name,
      ...framePacing,
      diagnostics,
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

  const targetUrl = new URL(appUrl)
  targetUrl.searchParams.set('m23Scenario', driverScenarioId)
  targetUrl.searchParams.set('seed', seed)
  targetUrl.searchParams.set('graphics', graphics)
  if (requestedRendererRoute !== null) targetUrl.searchParams.set('renderer', rendererRoute)
  targetUrl.searchParams.set('motion', motion)
  await call('Page.navigate', { url: targetUrl.href })
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
  await waitFor('Boolean(document.querySelector(".battle-input-surface .tap-field"))')
  await evaluate('document.querySelector(".battle-input-surface .tap-field").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))')
  await waitFor('!document.querySelector(".battle-input-surface")', 12_000)
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
  let failures = results
    .filter(({ name }) => required.has(name))
    .filter(({ p50, p95, jankRate }) => (
      p50 > maxMedianMs || p95 > maxP95Ms || jankRate > maxJankRate
    ))

  const diagnostics = battleTurn.diagnostics
  const activeFrameSummary = summarizeGaps(diagnostics?.activeFrameGapsMs ?? [])
  const idleCadenceSummary = summarizeGaps(diagnostics?.idleCadenceGapsMs ?? [])
  const activeSamplesRequired = args['require-active-samples'] === 'true'
  if (activeSamplesRequired && (!activeFrameSummary || activeFrameSummary.sampleCount < 120)) {
    failures = [...failures, { name: 'active-rendered-frames', p50: 0, p95: 0, jankRate: 1 }]
  } else if (
    activeFrameSummary
    && activeFrameSummary.sampleCount >= 120
    && (
      activeFrameSummary.p50Ms > maxMedianMs
      || activeFrameSummary.p95Ms > maxP95Ms
      || activeFrameSummary.overBudgetRate > maxJankRate
    )
  ) {
    failures = [...failures, {
      name: 'active-rendered-frames',
      p50: activeFrameSummary.p50Ms,
      p95: activeFrameSummary.p95Ms,
      jankRate: activeFrameSummary.overBudgetRate,
    }]
  }

  console.log('Active diagnostics:', activeFrameSummary ?? 'unavailable')
  console.log('Idle cadence (reported separately):', idleCadenceSummary ?? 'unavailable')
  if (diagnostics?.governor) {
    console.log(`Governor profile: ${diagnostics.governor.profile.stage}; pending: ${diagnostics.governor.pending?.action ?? 'none'}`)
  }

  if (outputPath) {
    const browser = await call('Browser.getVersion')
    const viewport = await evaluate('({ width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio })')
    const platform = await evaluate('({ platform: navigator.platform, userAgent: navigator.userAgent })')
    const chunks = await collectBattleChunks()
    const limitations = [
      ...(diagnostics?.limitations ?? ['DEV diagnostics port was not available for this run.']),
      ...(chunks.limitation ? [chunks.limitation] : []),
      ...(softwareRenderer ? ['SwiftShader/software renderer: functional result only; performance verdict skipped.'] : []),
      ...(activeFrameSummary && activeFrameSummary.sampleCount < 120
        ? ['Fewer than 120 active rendered frame gaps were captured; governor performance gate is incomplete.']
        : []),
      ...(!activeFrameSummary ? ['Active rendered frame diagnostics were unavailable; performance verdict is incomplete.'] : []),
    ]
    const rendererResources = diagnostics?.rendererResources ?? {
      geometries: 0, textures: 0, programs: 0, triangles: 0, drawCalls: 0,
    }
    const pools = diagnostics?.pools ?? {}
    const dpr = diagnostics?.dpr ?? viewport.dpr
    const tier = diagnostics?.effectiveTier ?? 'unknown'
    const assetComplexity = diagnostics?.assetComplexity ?? { diagnosticPort: 0 }
    await mkdir(dirname(resolve(outputPath)), { recursive: true })
    await writeFile(resolve(outputPath), JSON.stringify({
      schemaVersion: 2,
      evidenceKind: 'performance',
      scenarioId,
      environment: {
        device: deviceName,
        os: { name: platform?.platform ?? 'unknown', version: 'unknown' },
        browser: { name: browser?.product ?? 'Chrome', version: platform?.userAgent ?? 'unknown' },
      },
      viewport: { width: viewport.width, height: viewport.height },
      seed,
      graphics,
      requestedRendererRoute: diagnostics?.requestedRendererRoute ?? rendererRoute,
      rendererRoute: diagnostics?.rendererRoute ?? rendererRoute,
      motion,
      checkpoints: diagnostics?.checkpoints ?? [],
      activeFrameGapsMs: diagnostics?.activeFrameGapsMs ?? [],
      idleCadenceGapsMs: diagnostics?.idleCadenceGapsMs ?? [],
      longTasks: diagnostics?.longTasks ?? [],
      rendererResources,
      pools,
      dpr,
      tier,
      activeCue: diagnostics?.activeCue ?? null,
      assetComplexity,
      firstCastLatencyMs: diagnostics?.firstCastLatencyMs ?? 0,
      governor: diagnostics?.governor ?? null,
      artworkCache: diagnostics?.artworkCache ?? null,
      hardware: { renderer, softwareRenderer },
      samples: results,
      activeFrameSummary,
      idleCadenceSummary,
      diagnostics,
      battleChunks: chunks,
      limitations,
    }, null, 2))
    console.log(`Wrote release metrics to ${resolve(outputPath)}`)
  }

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

  if (calibration.p50 > maxMedianMs || calibration.p95 > maxP95Ms || calibration.jankRate > maxJankRate) {
    throw new Error(
      `Chrome calibration is too slow (${calibration.p50.toFixed(1)}ms p50, ${calibration.p95.toFixed(1)}ms p95, ${(calibration.jankRate * 100).toFixed(1)}% jank); benchmark is invalid`,
    )
  }
  if (softwareRenderer && args['allow-software'] !== 'true') {
    console.warn('SKIP: SwiftShader exaggerates layered canvas performance; rerun on a hardware ANGLE target')
    return
  }
  if (failures.length) {
    process.exitCode = 1
    console.error(
      `FAIL: ${failures.map(({ name, p50, p95, jankRate }) => `${name} ${p50.toFixed(1)}ms p50 / ${p95.toFixed(1)}ms p95 / ${(jankRate * 100).toFixed(1)}% jank`).join(', ')}`,
    )
  } else {
    console.log(
      `PASS: screen entry, steady state and an active battle turn stay within ${maxMedianMs}ms p50, ${maxP95Ms}ms p95 and ${(maxJankRate * 100).toFixed(0)}% gaps over ${maxFrameGapMs}ms`,
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
