// Zero-dependency Chrome/CDP evidence harness for the M23 current-parity baseline.
//
// Start Vite and Chrome separately, for example:
//   npm run dev -- --host 127.0.0.1
//   chrome --remote-debugging-port=9222 --user-data-dir=/tmp/mobie-m23-chrome
//   node scripts/m23-baseline.mjs --port=9222 --device=ipad-pro-11

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

const SCENARIO_ID = 'm23-current-parity-v1'
// Standalone Node harness mirror; evidenceSchema.test.ts enforces equality with the typed contract.
const REQUIRED_CHECKPOINTS = [
  'player-choice',
  'qte',
  'normal-attack',
  'star',
  'terrain',
  'terrain-rain',
  'switch',
  'faint',
  'outcome',
]
const GRAPHICS = new Set(['auto', 'high', 'balanced', 'compatibility'])
const MOTION = new Set(['full', 'reduced', 'off'])
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))

function parseArgs(argv) {
  const parsed = {}
  for (const raw of argv) {
    if (!raw.startsWith('--')) throw new Error(`Unexpected positional argument: ${raw}`)
    const separator = raw.indexOf('=')
    const key = raw.slice(2, separator < 0 ? undefined : separator)
    const value = separator < 0 ? 'true' : raw.slice(separator + 1)
    if (!key) throw new Error(`Invalid argument: ${raw}`)
    parsed[key] = value
  }
  return parsed
}

function finitePositive(value, name, { integer = false } = {}) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0 || (integer && !Number.isInteger(number))) {
    throw new Error(`--${name} must be a ${integer ? 'positive integer' : 'positive number'}`)
  }
  return number
}

function safeSegment(value, name) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value) || value === '.' || value === '..') {
    throw new Error(`--${name} must be one safe path segment (letters, digits, dot, underscore, or hyphen)`)
  }
  return value
}

async function collectBattleChunks() {
  const assetsDir = resolve('dist', 'assets')
  let entries
  try {
    entries = await readdir(assetsDir, { withFileTypes: true })
  } catch (error) {
    throw new Error(`Production chunks are unavailable; run npm run build first (${error.message})`)
  }
  const files = []
  for (const entry of entries.filter((candidate) => candidate.isFile() && candidate.name.endsWith('.js')).sort((a, b) => a.name.localeCompare(b.name))) {
    const bytes = await readFile(resolve(assetsDir, entry.name))
    files.push({
      name: entry.name,
      bytes: bytes.length,
      gzipBytes: gzipSync(bytes).length,
      battleRelevant: /^(BattleStage|CaptureStage|MobieVisual|index)-/.test(entry.name),
    })
  }
  if (!files.some((file) => file.battleRelevant)) throw new Error('No battle-relevant production chunk was found in dist/assets')
  return { files }
}

function assertNormalTransactionTrace(trace) {
  if (!Array.isArray(trace)) throw new Error('Normal-turn presentation trace is unavailable')
  const groups = new Map()
  trace.forEach((event, index) => {
    const entries = groups.get(event.transactionId) ?? []
    entries.push({ ...event, index })
    groups.set(event.transactionId, entries)
  })
  const committed = [...groups.entries()]
    .filter(([, events]) => events.some((event) => event.stage === 'commit'))
    .sort((a, b) => a[1][0].index - b[1][0].index)
  if (committed.length < 2) {
    throw new Error(`Expected two committed normal-turn transactions, received ${committed.length}`)
  }

  const selected = committed.slice(0, 2)
  for (const [transactionId, events] of selected) {
    for (const stage of ['begin', 'resolve', 'record', 'present', 'commit']) {
      const count = events.filter((event) => event.stage === stage).length
      if (count !== 1) throw new Error(`${transactionId} expected one ${stage} event, received ${count}`)
    }
    const observableEffects = events.filter((event) => event.stage === 'audio' || event.stage === 'feed')
    const effectKeys = observableEffects.map((event) => `${event.stage}:${event.cueId ?? ''}:${event.detail ?? ''}`)
    if (new Set(effectKeys).size !== effectKeys.length) {
      throw new Error(`${transactionId} repeated a feed/audio cue`)
    }
    const normalCues = events.filter((event) => event.stage === 'cue' && event.detail?.startsWith('normal-attack:'))
    const expectedAudioCount = normalCues.reduce(
      (count, event) => count + (event.detail === 'normal-attack:impact' ? 3 : 1),
      0,
    )
    const audioCount = events.filter((event) => event.stage === 'audio').length
    const feedCount = events.filter((event) => event.stage === 'feed').length
    if (audioCount !== expectedAudioCount || feedCount !== normalCues.length) {
      throw new Error(`${transactionId} feed/audio counts do not match compiled normal-attack cues`)
    }
    const beginTurn = events.find((event) => event.stage === 'begin')?.turn
    const commitTurn = events.find((event) => event.stage === 'commit')?.turn
    if (!Number.isInteger(beginTurn) || commitTurn !== beginTurn + 1) {
      throw new Error(`${transactionId} did not advance canonical turn exactly once`)
    }
  }

  const firstEvents = selected[0][1]
  const secondEvents = selected[1][1]
  const firstCommitTurn = firstEvents.find((event) => event.stage === 'commit')?.turn
  const secondBeginTurn = secondEvents.find((event) => event.stage === 'begin')?.turn
  const firstPresentationId = firstEvents[0].presentationId
  const secondPresentationId = secondEvents[0].presentationId
  if (secondBeginTurn !== firstCommitTurn || secondPresentationId <= firstPresentationId) {
    throw new Error('Normal-turn transactions were not consecutive with monotonic presentation IDs')
  }

  return {
    transactionIds: selected.map(([transactionId]) => transactionId),
    presentationIds: [firstPresentationId, secondPresentationId],
    canonicalTurns: [
      firstEvents.find((event) => event.stage === 'begin')?.turn,
      firstCommitTurn,
      secondEvents.find((event) => event.stage === 'commit')?.turn,
    ],
    resolveCount: selected.reduce((count, [, events]) => count + events.filter((event) => event.stage === 'resolve').length, 0),
    recordCount: selected.reduce((count, [, events]) => count + events.filter((event) => event.stage === 'record').length, 0),
    commitCount: selected.reduce((count, [, events]) => count + events.filter((event) => event.stage === 'commit').length, 0),
  }
}

const args = parseArgs(process.argv.slice(2))
const config = {
  port: finitePositive(args.port ?? 9222, 'port', { integer: true }),
  app: args.app ?? 'http://127.0.0.1:5173/',
  device: safeSegment(args.device ?? 'chrome-local', 'device'),
  width: finitePositive(args.width ?? 1024, 'width', { integer: true }),
  height: finitePositive(args.height ?? 1366, 'height', { integer: true }),
  dpr: finitePositive(args.dpr ?? 2, 'dpr'),
  graphics: args.graphics ?? 'auto',
  motion: args.motion ?? 'full',
  seed: args.seed ?? `${SCENARIO_ID}-seed`,
}
if (!GRAPHICS.has(config.graphics)) throw new Error(`--graphics must be one of ${[...GRAPHICS].join(', ')}`)
if (!MOTION.has(config.motion)) throw new Error(`--motion must be one of ${[...MOTION].join(', ')}`)
if (!config.seed.trim()) throw new Error('--seed must not be empty')
const appUrl = new URL(config.app)
if (!['http:', 'https:'].includes(appUrl.protocol)) throw new Error('--app must be an http(s) URL')
appUrl.searchParams.set('m23Scenario', SCENARIO_ID)
appUrl.searchParams.set('width', String(config.width))
appUrl.searchParams.set('height', String(config.height))
appUrl.searchParams.set('graphics', config.graphics)
appUrl.searchParams.set('motion', config.motion)
appUrl.searchParams.set('seed', config.seed)
appUrl.searchParams.set('cueStep', '0')

const outputRoot = resolve('test-runs', 'm23', config.device)
const consoleErrors = []
const unhandledErrors = []
const checkpointRecords = new Map()
let latestScreencastFrame = null
let screencastActive = false
let screencastFrameCounter = 0

async function connect() {
  let response
  try {
    response = await fetch(`http://127.0.0.1:${config.port}/json/list`)
  } catch (error) {
    throw new Error(`Cannot reach Chrome CDP on port ${config.port}: ${error.message}`)
  }
  if (!response.ok) throw new Error(`CDP target list returned ${response.status}`)
  const targets = await response.json()
  const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
  if (!page) throw new Error(`No page target found on CDP port ${config.port}`)

  const socket = new WebSocket(page.webSocketDebuggerUrl)
  const pending = new Map()
  const listeners = new Map()
  let nextId = 0
  await new Promise((resolveOpen, reject) => {
    socket.onopen = resolveOpen
    socket.onerror = () => reject(new Error('CDP WebSocket connection failed'))
  })
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.id) {
      const request = pending.get(message.id)
      if (!request) return
      pending.delete(message.id)
      if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`))
      else request.resolve(message.result)
      return
    }
    for (const listener of listeners.get(message.method) ?? []) listener(message.params ?? {})
  }
  socket.onclose = () => {
    for (const request of pending.values()) request.reject(new Error('CDP WebSocket closed'))
    pending.clear()
  }

  return {
    close: () => socket.close(),
    on(method, listener) {
      const registered = listeners.get(method) ?? []
      registered.push(listener)
      listeners.set(method, registered)
    },
    call(method, params = {}) {
      return new Promise((resolveCall, reject) => {
        const id = ++nextId
        pending.set(id, { method, resolve: resolveCall, reject })
        socket.send(JSON.stringify({ id, method, params }))
      })
    },
  }
}

function remoteValue(remoteObject) {
  if (Object.hasOwn(remoteObject, 'value')) return remoteObject.value
  if (remoteObject.unserializableValue) return remoteObject.unserializableValue
  return remoteObject.description ?? remoteObject.type
}

async function run(cdp) {
  const call = cdp.call
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'Page evaluation failed')
    }
    return result.result.value
  }
  const waitFor = async (expression, timeoutMs = 15_000, description = expression) => {
    const deadline = Date.now() + timeoutMs
    let lastError = null
    while (Date.now() < deadline) {
      try {
        if (await evaluate(expression)) return
      } catch (error) {
        lastError = error
      }
      await sleep(75)
    }
    throw new Error(`Timed out waiting for ${description}${lastError ? ` (${lastError.message})` : ''}`)
  }

  cdp.on('Runtime.consoleAPICalled', ({ type, args: values, stackTrace }) => {
    if (type !== 'error' && type !== 'assert') return
    consoleErrors.push({
      type,
      text: values.map(remoteValue).join(' '),
      stack: stackTrace?.callFrames ?? [],
    })
  })
  cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
    unhandledErrors.push({
      text: exceptionDetails?.exception?.description ?? exceptionDetails?.text ?? 'Unhandled page exception',
      url: exceptionDetails?.url ?? '',
      lineNumber: exceptionDetails?.lineNumber ?? 0,
      columnNumber: exceptionDetails?.columnNumber ?? 0,
    })
  })
  cdp.on('Log.entryAdded', ({ entry }) => {
    if (entry?.level !== 'error') return
    consoleErrors.push({ type: 'log', text: entry.text, url: entry.url ?? '' })
  })
  cdp.on('Page.screencastFrame', ({ data, sessionId, metadata }) => {
    screencastFrameCounter += 1
    latestScreencastFrame = { data, metadata, receivedAt: Date.now(), sequence: screencastFrameCounter }
    void call('Page.screencastFrameAck', { sessionId }).catch(() => {})
  })

  await Promise.all([
    call('Runtime.enable'),
    call('Page.enable'),
    call('Performance.enable'),
    call('Log.enable'),
    call('Accessibility.enable'),
  ])
  await call('Page.bringToFront')
  await call('Emulation.setFocusEmulationEnabled', { enabled: true })
  await call('Emulation.setDeviceMetricsOverride', {
    width: config.width,
    height: config.height,
    deviceScaleFactor: config.dpr,
    mobile: true,
    screenWidth: config.width,
    screenHeight: config.height,
  })
  if (config.motion !== 'full') {
    await call('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    })
  }

  await call('Page.navigate', { url: appUrl.href })
  await waitFor('document.readyState === "complete"', 20_000, 'the app document')
  await waitFor('Boolean(window.__MOBIE_M23_BASELINE__?.active)', 20_000, 'the DEV M23 baseline driver')
  const configured = await evaluate(`window.__MOBIE_M23_BASELINE__.configure(${JSON.stringify({
    scenarioId: SCENARIO_ID,
    seed: config.seed,
    viewport: { width: config.width, height: config.height },
    graphics: config.graphics,
    motion: config.motion,
    cueStep: 0,
  })})`)
  if (configured.scenarioId !== SCENARIO_ID) throw new Error('Baseline driver configured the wrong scenario')
  const deterministicScenario = await evaluate('window.__MOBIE_M23_BASELINE__.run()')
  if (deterministicScenario.scenarioId !== SCENARIO_ID || !deterministicScenario.digest) {
    throw new Error('Baseline driver did not return a valid deterministic scenario result')
  }

  const browserInfo = await call('Browser.getVersion')
  const renderer = await evaluate(`(() => {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
    if (!gl) return null
    const extension = gl.getExtension('WEBGL_debug_renderer_info')
    return extension
      ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER)
  })()`)
  const softwareRenderer = /swiftshader|software|llvmpipe/i.test(renderer ?? '')

  const axSnapshot = async () => {
    const { nodes } = await call('Accessibility.getFullAXTree', { depth: -1 })
    return nodes
      .filter((node) => !node.ignored && node.role?.value && node.name?.value?.trim())
      .map((node) => {
        const properties = Object.fromEntries((node.properties ?? []).map((property) => [property.name, property.value?.value]))
        const entry = { role: String(node.role.value), name: String(node.name.value) }
        if (
          node.value?.value !== undefined
          && node.value.value !== ''
          && (typeof node.value.value === 'string' || typeof node.value.value === 'number')
        ) entry.value = node.value.value
        if (node.description?.value) entry.description = String(node.description.value)
        if (typeof properties.disabled === 'boolean') entry.disabled = properties.disabled
        return entry
      })
      .slice(0, 500)
  }

  const screenshot = async (label, source) => {
    let data
    let captureSource = 'Page.captureScreenshot'
    // Drain frames captured before the DOM checkpoint. SwiftShader can be ~3 fps,
    // while hardware ANGLE usually needs only a short compositor settle.
    await sleep(softwareRenderer ? 1_600 : 500)
    const requestedAt = Date.now()
    const requestedSequence = screencastFrameCounter
    if (screencastActive) {
      // Chrome may deliver already-queued screencast frames after a DOM state change.
      // Require three newly captured frames so each labelled image reflects its checkpoint.
      const deadline = requestedAt + 5_000
      while (
        Date.now() < deadline
        && (!latestScreencastFrame || latestScreencastFrame.sequence < requestedSequence + 3)
      ) await sleep(16)
    }
    if (
      screencastActive
      && latestScreencastFrame
      && latestScreencastFrame.sequence >= requestedSequence + 3
    ) {
      data = latestScreencastFrame.data
      captureSource = 'Page.startScreencast'
    } else {
      ;({ data } = await call('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }))
    }
    const nodes = await axSnapshot()
    if (nodes.length === 0) throw new Error(`Accessibility tree was empty at ${label}`)
    checkpointRecords.set(label, {
      label,
      nodes,
      screenshot: Buffer.from(data, 'base64'),
      source,
      captureSource,
      capturedAt: new Date().toISOString(),
    })
    console.log(`Captured ${label} (${source}; ${captureSource})`)
  }

  const click = (expression) => evaluate(`(() => {
    const element = ${expression}
    if (!element) return false
    element.click()
    return true
  })()`)
  await waitFor('Boolean(document.querySelector(".title-screen__adventure"))', 15_000, 'Title')
  await click('document.querySelector(".title-screen__adventure")')
  await waitFor('Boolean(document.querySelector(".region-card"))', 15_000, 'Region Select')
  await click('document.querySelector(".region-card")')
  await waitFor('[...document.querySelectorAll("button")].some((button) => button.textContent?.includes("出戰"))', 15_000, 'Encounter')
  await evaluate(`(() => {
    const supply = document.querySelector('.supply-opt')
    if (supply) supply.click()
    const engage = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('出戰'))
    if (!engage) return false
    engage.click()
    return true
  })()`)
  await waitFor('document.querySelectorAll(".poke-card").length >= 3', 15_000, 'Team Select')
  await evaluate(`(() => {
    const cards = [...document.querySelectorAll('.poke-card')].slice(0, 3)
    cards.forEach((card) => card.click())
    return cards.length
  })()`)
  await waitFor('[...document.querySelectorAll("button")].some((button) => !button.disabled && button.textContent?.includes("3/3"))', 5_000, 'enabled Team Select engage action')
  await evaluate(`[...document.querySelectorAll('button')].find((button) => !button.disabled && button.textContent?.includes('3/3')).click()`)
  await waitFor('Boolean(document.querySelector(".battle-fg"))', 25_000, 'Battle')

  try {
    await call('Page.startScreencast', {
      format: 'png',
      maxWidth: Math.round(config.width * config.dpr),
      maxHeight: Math.round(config.height * config.dpr),
      everyNthFrame: 1,
    })
    screencastActive = true
    await sleep(150)
  } catch (error) {
    console.warn(`Screencast unavailable; falling back to captureScreenshot: ${error.message}`)
  }

  await waitFor('window.__MOBIE_M23_BASELINE__.diagnostics().checkpoints.includes("player-choice")', 15_000, 'player-choice cue')
  await evaluate('window.__MOBIE_M23_BASELINE__.step()')
  await waitFor('Boolean(document.querySelector(".move-slot"))', 5_000, 'player choice UI')
  await screenshot('player-choice', 'live journey cue')

  const preparedCheckpoint = async (label) => {
    await evaluate(`(() => {
      const driver = window.__MOBIE_M23_BASELINE__
      driver.prepareCheckpoint(${JSON.stringify(label)})
      void driver.checkpoint(${JSON.stringify(`harness:${label}`)}, ${JSON.stringify(label)})
      return true
    })()`)
    const readyExpression = {
      qte: 'Boolean(document.querySelector(".battle-action"))',
      star: 'Boolean(document.querySelector(".star-orb"))',
      terrain: 'Boolean(document.querySelector(".terrain-chip")?.textContent?.includes("熔岩"))',
      'terrain-rain': 'Boolean(document.querySelector(".terrain-chip")?.textContent?.includes("雨天"))',
      switch: 'Boolean(document.querySelector(".switch-panel"))',
    }[label]
    await waitFor(readyExpression, 5_000, `${label} prepared UI`)
    await screenshot(label, 'DEV driver prepared legacy UI state')
    await evaluate('window.__MOBIE_M23_BASELINE__.step()')
  }

  await preparedCheckpoint('qte')
  await evaluate('window.__MOBIE_M23_BASELINE__.prepareCheckpoint("player-choice")')
  await preparedCheckpoint('star')
  await evaluate('window.__MOBIE_M23_BASELINE__.prepareCheckpoint("player-choice")')
  await preparedCheckpoint('terrain')
  await evaluate('window.__MOBIE_M23_BASELINE__.prepareCheckpoint("player-choice")')
  await preparedCheckpoint('terrain-rain')
  await evaluate('window.__MOBIE_M23_BASELINE__.prepareCheckpoint("player-choice")')
  await preparedCheckpoint('switch')
  await evaluate('window.__MOBIE_M23_BASELINE__.prepareCheckpoint("player-choice")')

  // Natural battle events now run without cue blocking. The observer captures required
  // event checkpoints as soon as the live driver reports them.
  await evaluate('window.__MOBIE_M23_BASELINE__.resume()')
  const deadline = Date.now() + 240_000
  while (Date.now() < deadline && !checkpointRecords.has('outcome')) {
    const state = await evaluate(`(() => ({
      checkpoints: window.__MOBIE_M23_BASELINE__.diagnostics().checkpoints,
      result: Boolean(document.querySelector('.exp-summary')),
      choice: Boolean(document.querySelector('.move-slot')),
      switchChoice: Boolean(document.querySelector('.switch-card:not(:disabled)')),
      action: Boolean(document.querySelector('.battle-action .tap-field')),
    }))()`)
    for (const label of ['normal-attack', 'faint']) {
      if (state.checkpoints.includes(label) && !checkpointRecords.has(label)) {
        if (label === 'normal-attack') await sleep(500)
        if (label === 'faint') await waitFor(
          '[...document.querySelectorAll(".battle-log, .battle-banner, .feed-item")].some((node) => node.textContent?.includes("倒下"))',
          2_000,
          'faint presentation',
        ).catch(() => {})
        await screenshot(label, 'live journey event cue')
      }
    }
    if (state.result && state.checkpoints.includes('outcome') && !checkpointRecords.has('outcome')) {
      await screenshot('outcome', 'live Result projection after outcome cue')
    }
    if (state.result) break
    if (state.choice) {
      await click('[...document.querySelectorAll(".move-slot")].find((slot) => !slot.classList.contains("move-slot--status")) ?? document.querySelector(".move-slot")')
    } else if (state.switchChoice) {
      await click('document.querySelector(".switch-card:not(:disabled)")')
    } else if (state.action) {
      await evaluate(`(() => {
        const field = document.querySelector('.battle-action .tap-field')
        if (!field) return false
        for (let index = 0; index < 8; index += 1) {
          field.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: innerWidth / 2, clientY: innerHeight / 2 }))
        }
        return true
      })()`)
    }
    await sleep(80)
  }

  const missing = REQUIRED_CHECKPOINTS.filter((label) => !checkpointRecords.has(label))
  const diagnostics = await evaluate('window.__MOBIE_M23_BASELINE__.diagnostics()')
  if (!Number.isFinite(diagnostics.firstCastLatencyMs)) {
    throw new Error('First-cast impact latency was not recorded')
  }
  const normalTurnTransactions = assertNormalTransactionTrace(diagnostics.presentationTrace)
  const battleChunks = await collectBattleChunks()
  const performanceResult = await call('Performance.getMetrics')
  const cdpPerformance = Object.fromEntries(performanceResult.metrics.map(({ name, value }) => [name, value]))
  const heap = await call('Runtime.getHeapUsage')
  const userAgent = await evaluate('navigator.userAgent')
  const limitations = [...diagnostics.limitations]
  limitations.push('QTE, star, volcanic/rain terrain, and switch visual checkpoints use the DEV driver\'s explicit legacy-state preparation and are not represented as naturally reached reducer events.')
  limitations.push('Performance and heap values are descriptive CDP snapshots only; this harness does not make a release performance claim.')
  limitations.push('Auto starts from the conservative Balanced assumption; High is recorded as requested only and is not release-ready.')
  if (softwareRenderer) limitations.push(`Software renderer detected (${renderer}); performance values are non-gating and must not be used as a hardware verdict.`)
  if (!screencastActive) limitations.push('Page.startScreencast was unavailable; battle images use Page.captureScreenshot.')

  const environment = {
    device: config.device,
    os: {
      name: /Mac OS X/.test(userAgent) ? 'macOS' : /Windows/.test(userAgent) ? 'Windows' : /Linux/.test(userAgent) ? 'Linux' : 'unknown',
      version: userAgent.match(/(?:Mac OS X |Windows NT |Android )([^;)]+)/)?.[1]?.replaceAll('_', '.') ?? 'unknown',
    },
    browser: {
      name: browserInfo.product?.split('/')[0] || 'Chrome',
      version: browserInfo.product?.split('/')[1] || 'unknown',
    },
  }
  const metrics = {
    schemaVersion: 1,
    scenarioId: SCENARIO_ID,
    environment,
    viewport: { width: config.width, height: config.height },
    seed: config.seed,
    graphics: diagnostics.requestedGraphics,
    motion: diagnostics.motion,
    checkpoints: REQUIRED_CHECKPOINTS.filter((label) => checkpointRecords.has(label)),
    activeFrameGapsMs: diagnostics.activeFrameGapsMs,
    idleCadenceGapsMs: diagnostics.idleCadenceGapsMs,
    longTasks: diagnostics.longTasks,
    rendererResources: diagnostics.rendererResources,
    pools: diagnostics.pools,
    dpr: diagnostics.dpr,
    tier: diagnostics.effectiveTier,
    activeCue: diagnostics.activeCue,
    assetComplexity: diagnostics.assetComplexity,
    firstCastLatencyMs: diagnostics.firstCastLatencyMs,
    battleChunks,
    limitations,
    cdp: {
      performance: cdpPerformance,
      heap,
      renderer: renderer ?? 'unknown',
      softwareRenderer,
      browserProtocolVersion: browserInfo.protocolVersion,
    },
    driver: {
      options: configured,
      diagnostics,
      normalTurnTransactions,
      deterministicScenario: {
        digest: deterministicScenario.digest,
        caseIds: deterministicScenario.cases.map(({ id }) => id),
        productConfiguration: deterministicScenario.productConfiguration,
      },
    },
    errors: { console: consoleErrors, unhandled: unhandledErrors },
    checkpointDetails: Object.fromEntries([...checkpointRecords].map(([label, record]) => [label, {
      scenarioId: `${SCENARIO_ID}--${label}`,
      fileName: 'screenshot.png',
      source: record.source,
      captureSource: record.captureSource,
      capturedAt: record.capturedAt,
    }])),
  }
  const accessibility = {
    schemaVersion: 1,
    scenarioId: SCENARIO_ID,
    checkpoints: REQUIRED_CHECKPOINTS
      .filter((label) => checkpointRecords.has(label))
      .map((label) => ({ label, nodes: checkpointRecords.get(label).nodes })),
    limitations: [
      'AX snapshots contain the non-ignored, named nodes exposed by Chrome at each captured legacy UI checkpoint.',
      ...limitations,
    ],
  }

  for (const label of REQUIRED_CHECKPOINTS) {
    const record = checkpointRecords.get(label)
    if (!record) continue
    const scenarioId = `${SCENARIO_ID}--${label}`
    const scenarioDir = resolve(outputRoot, scenarioId)
    await mkdir(scenarioDir, { recursive: true })
    await Promise.all([
      writeFile(resolve(scenarioDir, 'screenshot.png'), record.screenshot),
      writeFile(resolve(scenarioDir, 'metrics.json'), `${JSON.stringify({ ...metrics, scenarioId }, null, 2)}\n`),
      writeFile(resolve(scenarioDir, 'accessibility.json'), `${JSON.stringify({ ...accessibility, scenarioId }, null, 2)}\n`),
    ])
  }

  if (screencastActive) {
    await call('Page.stopScreencast').catch(() => {})
    screencastActive = false
  }
  if (missing.length) throw new Error(`Missing required checkpoint evidence: ${missing.join(', ')}`)
  if (consoleErrors.length || unhandledErrors.length) {
    throw new Error(`Browser errors captured: ${consoleErrors.length} console/log error(s), ${unhandledErrors.length} unhandled exception(s)`)
  }
  console.log(`M23 evidence written to ${outputRoot}/${SCENARIO_ID}--<checkpoint>`)
  console.log(`Scenario digest: ${deterministicScenario.digest}`)
  if (softwareRenderer) console.warn('LIMITATION: software renderer detected; no hardware or release-performance verdict is claimed')
}

async function main() {
  await mkdir(outputRoot, { recursive: true })
  const cdp = await connect()
  try {
    await run(cdp)
  } finally {
    cdp.close()
  }
}

main().catch((error) => {
  console.error(`M23 baseline capture failed: ${error.message}`)
  process.exitCode = 1
})
