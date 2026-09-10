// Final M24 qualification for the web app at iPad-sized Safari viewports.
//
// The owner treats Mobie as a web app, so this gate uses a real browser/CDP
// target with iPad CSS dimensions.  It records the browser contract, route
// journeys, touch-style input, safe-area/zoom/scroll checks, accessibility
// snapshots, and the already completed Ticket 48/49/50 closure evidence.
//
// Run with Vite and a Chrome CDP target:
//   npm run dev -- --host 0.0.0.0
//   chrome --remote-debugging-port=9222 --user-data-dir=/tmp/mobie-ticket51 about:blank
//   npm run qualification:m24 -- --port=9222

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFileSync, spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const ROOT = resolve('.')
const OUTPUT_ROOT = resolve('test-runs', 'm24', 'ticket51-ipad-safari')
const APP_PORT = Number(process.argv.find((value) => value.startsWith('--app-port='))?.slice(11) ?? 5173)
const CDP_PORT = Number(process.argv.find((value) => value.startsWith('--port='))?.slice(7) ?? 9222)
const DEVICE = process.argv.find((value) => value.startsWith('--device='))?.slice(9) ?? 'web-ipad-safari'
const ORIGIN = `http://127.0.0.1:${APP_PORT}`

const VIEWPORTS = [
  { id: 'ipad-portrait', width: 810, height: 1080, orientation: 'portrait' },
  { id: 'ipad-landscape', width: 1080, height: 810, orientation: 'landscape' },
  { id: 'ipad-narrow-portrait', width: 768, height: 1024, orientation: 'portrait' },
  { id: 'ipad-short-landscape', width: 1024, height: 768, orientation: 'landscape' },
]

const TICKET_COMMITS = {
  1: 'a4375ff', 2: '1c7add4', 3: '1cde938', 4: 'ddb73b7', 5: '8bc7d52',
  6: 'c7c7d9b', 7: 'b805d6e', 8: '1e888a7', 9: 'da2cc51', 10: 'bdd878a',
  11: 'cfe6b4a', 12: '7e7b965', 13: '7a2e1a6', 14: '4d20169', 15: '72aaea8',
  16: '1ef1579', 17: 'bc77798', 18: 'd284a13', 19: 'd6514e8', 20: '2c57001',
  21: '2121098', 22: '7ba23ca', 23: 'ea42cd1', 24: '65954f4', 25: 'e715bf6',
  26: 'e095d22', 27: '1eded58', 28: '525e5be', 29: '040eb54', 30: 'be69013',
  31: 'b79ad4b', 32: 'f3ce6d9', 33: '7b730c2', 34: '71c6b1d', 35: 'f3e95cd',
  36: '5900c8c', 37: 'fee52d7', 38: 'faf5266', 39: '512162c', 40: '1d1474f',
  41: '78e2cfa', 42: '99751bd', 43: '4d03516', 44: '6767166', 45: '7ecb51b',
  46: '46174c0', 47: '6f26e70', 48: '8f262dd', 49: '402c862', 50: '0e4e197',
}

const GATES = [
  {
    ticket: 48,
    path: resolve('test-runs', 'm24', 'ticket48-chrome', 'evidence.json'),
    assertions: ['routeJourney', 'recoveryStates', 'settlementRecovery', 'explicitSupply', 'scannerDefaultOff', 'noHorizontalOverflow', 'targetMinimum44', 'noCustomModels', 'noUnhandledRejections'],
  },
  {
    ticket: 49,
    path: resolve('test-runs', 'm24', 'ticket49-chrome', 'evidence.json'),
    assertions: ['collectionJourney', 'dexJourney', 'achievementJourney', 'hatchJourney', 'operationCollisionRecoverable', 'rosterDomBounded', 'dexDomBounded', 'noHorizontalOverflow', 'targetMinimum44', 'artworkFallbacks', 'noCustomModels', 'noUnhandledRejections'],
  },
  {
    ticket: 50,
    path: resolve('test-runs', 'm24', 'ticket50-shell-data-tools', 'ticket50-final-regression', 'evidence.json'),
    fallback: resolve('test-runs', 'm24', 'ticket50-shell-data-tools', 'ticket50-shell-data-tools-final2', 'evidence.json'),
    assertions: ['coldBootIdempotent', 'bootstrapStageFailures', 'saveTransactionRecovery', 'overlaySingleOwner', 'scannerOffZeroIOLazyPermission', 'scannerOnCapabilityFlow', 'portableSaveExcludesOperationsAndModels', 'saveGuards', 'replayEventOnly', 'recoverableFailures', 'saveDeliveryFallback', 'cardStorageRecovery', 'lazyChunkRecovery', 'artworkRecovery', 'noHorizontalOverflow', 'targetMinimum44', 'noModelResources', 'productionGraphHasNoModelAssets', 'noUnhandledRejections', 'fiveViewports', 'reducedMotionEvidence'],
  },
]

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))

async function readJson(path) {
  try { return { path, value: JSON.parse(await readFile(path, 'utf8')) } } catch (error) {
    return { path, error: error instanceof Error ? error.message : String(error) }
  }
}

function gitOutput(args) {
  try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim() } catch { return '' }
}

async function verifyRepositoryInventory() {
  const tickets = {}
  for (const [ticket, sha] of Object.entries(TICKET_COMMITS)) {
    const resolved = gitOutput(['rev-parse', '--verify', `${sha}^{commit}`])
    const subject = resolved ? gitOutput(['show', '-s', '--format=%s', resolved]) : ''
    tickets[ticket] = { commit: sha, resolved: Boolean(resolved), subject }
  }
  const allCommitsPresent = Object.values(tickets).every((ticket) => ticket.resolved)
  const source = await readFile(resolve('src', 'game', 'ext', 'productRuntime.ts'), 'utf8').catch(() => '')
  const partnerSkills = await readFile(resolve('src', 'game', 'ext', 'partnerSkills.ts'), 'utf8').catch(() => '')
  const shell = await readFile(resolve('src', 'ui', 'shell', 'AppShell.tsx'), 'utf8').catch(() => '')
  const overlay = await readFile(resolve('src', 'ui', 'shell', 'OverlayController.tsx'), 'utf8').catch(() => '')
  const packageJson = JSON.parse(await readFile(resolve('package.json'), 'utf8'))
  const forbiddenSource = [...source.matchAll(/(?:glb|gltf|custom.?model|encounterSkills)/gi)].map((match) => match[0])
  return {
    allCommitsPresent,
    tickets,
    sourceInvariants: {
      fixedProductRuntime: ['synergy', 'heldItems', 'abilities', 'chain', 'combo', 'evolution'].every((name) => source.includes(name)),
      partnerSkillsRuntime: partnerSkills.includes("id: 'insight'") && partnerSkills.includes("id: 'rally'"),
      appShellOwnsOverlay: shell.includes('<OverlayControllerProvider route={route}>') && shell.includes('<OverlayHost />'),
      oneOverlayProvider: (overlay.match(/export function OverlayControllerProvider/g) ?? []).length === 1,
      noForbiddenRuntimeTokens: forbiddenSource.length === 0,
      runtimeDependencies: Object.keys(packageJson.dependencies ?? {}).sort(),
    },
  }
}

function runProjectChecks() {
  const commands = [
    ['typecheck', ['run', 'typecheck']],
    ['test', ['test', '--', '--run']],
    ['build', ['run', 'build']],
  ]
  const checks = commands.map(([label, args]) => {
    const result = spawnSync('npm', args, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, CI: '1' }, timeout: 180_000 })
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
    return { label, command: `npm ${args.join(' ')}`, passed: result.status === 0, exitCode: result.status, outputTail: output.slice(-1_200) }
  })
  return { checks, allGreen: checks.every((check) => check.passed) }
}

function persistenceRetained(before, after) {
  const parse = (value) => { try { return JSON.parse(value) } catch { return value } }
  const exactKeys = ['mobie.playerskills.v1', 'mobie.roster.v2', 'mobie.incubator.v1', 'mobie.savemeta.v1', 'mobie.skillpoints.v1', 'mobie.run.v1', 'mobie.settings.v2']
  if (JSON.stringify(before.databases) !== JSON.stringify(after.databases)) return false
  if (!before.indexedDb || !after.indexedDb || !Array.isArray(before.indexedDb.cards) || !Array.isArray(before.indexedDb.replays) || !Array.isArray(after.indexedDb.cards) || !Array.isArray(after.indexedDb.replays)) return false
  if (JSON.stringify(before.indexedDb) !== JSON.stringify(after.indexedDb)) return false
  if (!exactKeys.every((key) => before.localStorage[key] === after.localStorage[key])) return false
  const beforeMeta = parse(before.localStorage['mobie.meta.v1'])
  const afterMeta = parse(after.localStorage['mobie.meta.v1'])
  if (!beforeMeta || !afterMeta || typeof beforeMeta !== 'object' || typeof afterMeta !== 'object') return false
  if (!beforeMeta.registered.every((speciesId) => afterMeta.registered.includes(speciesId))) return false
  if (!beforeMeta.seen.every((speciesId) => afterMeta.seen.includes(speciesId))) return false
  return Object.keys(beforeMeta.stats ?? {}).every((key) => Number(afterMeta.stats?.[key] ?? 0) >= Number(beforeMeta.stats?.[key] ?? 0))
}

async function verifyChromeGates() {
  const checks = []
  for (const gate of GATES) {
    let result = await readJson(gate.path)
    if (result.error && gate.fallback) result = await readJson(gate.fallback)
    const evidence = result.value
    const assertions = Object.fromEntries(gate.assertions.map((key) => [key, evidence?.assertions?.[key] === true]))
    const errors = evidence?.errors ?? {}
    checks.push({
      ticket: gate.ticket,
      path: result.path,
      available: Boolean(evidence),
      assertions,
      allAssertionsGreen: Boolean(evidence) && Object.values(assertions).every(Boolean),
      consoleErrors: Array.isArray(errors.console) ? errors.console.length : null,
      runtimeErrors: Array.isArray(errors.runtime) ? errors.runtime.length : null,
      unhandledRejections: Array.isArray(errors.unhandledRejections ?? errors.unhandled) ? (errors.unhandledRejections ?? errors.unhandled).length : null,
      checkpoints: Array.isArray(evidence?.checkpoints) ? evidence.checkpoints.length : 0,
      viewportChecks: Array.isArray(evidence?.matrix) ? evidence.matrix.length : 0,
    })
  }
  return { checks, allGreen: checks.every((check) => check.available && check.allAssertionsGreen && check.consoleErrors === 0 && check.runtimeErrors === 0 && check.unhandledRejections === 0) }
}

async function connect() {
  const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)
  if (!response.ok) throw new Error(`Chrome target list returned ${response.status}`)
  const target = (await response.json()).find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl)
  if (!target) throw new Error('No Chrome page target')
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  const pending = new Map()
  const events = []
  let nextId = 0
  await new Promise((resolveOpen, rejectOpen) => {
    socket.onopen = resolveOpen
    socket.onerror = () => rejectOpen(new Error('Chrome CDP WebSocket connection failed'))
  })
  socket.onmessage = (message) => {
    const value = JSON.parse(message.data)
    if (value.id && pending.has(value.id)) {
      const request = pending.get(value.id)
      pending.delete(value.id)
      if (value.error) request.reject(new Error(`${request.method}: ${value.error.message}`))
      else request.resolve(value.result)
      return
    }
    events.push(value)
  }
  socket.onclose = () => {
    for (const request of pending.values()) request.reject(new Error('Chrome CDP WebSocket closed'))
    pending.clear()
  }
  return {
    events,
    call(method, params = {}) {
      return new Promise((resolveCall, rejectCall) => {
        const id = ++nextId
        pending.set(id, { method, resolve: resolveCall, reject: rejectCall })
        socket.send(JSON.stringify({ id, method, params }))
      })
    },
    close: () => socket.close(),
  }
}

const DIAGNOSTICS = `(async () => {
  const visible = (node) => {
    if (!node) return false
    const rect = node.getBoundingClientRect(); const style = getComputedStyle(node)
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
  }
  const app = document.querySelector('[data-app-shell]')
  const root = document.getElementById('root')
  const overlayHost = document.querySelectorAll('[data-overlay-host]')
  const surface = document.querySelectorAll('[data-modal-surface]')
  const targets = [...document.querySelectorAll('button, [role="button"], [role="switch"]')].filter(visible)
  const scrollOwners = [...document.querySelectorAll('*')].filter((node) => {
    if (!visible(node) || node === document.documentElement || node === document.body) return false
    const style = getComputedStyle(node)
    return (style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 1
  }).map((node) => ({ tag: node.tagName, id: node.id || null, className: String(node.className), scrollTop: node.scrollTop, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight }))
  const text = (document.body.innerText || '').replace(/\\s+/g, ' ').trim()
  const prohibited = ['GLB', 'GLTF', 'custom model', 'encounter style', 'module off', 'style tags', 'style stats'].filter((needle) => text.toLowerCase().includes(needle.toLowerCase()))
  const resources = performance.getEntriesByType('resource').map((entry) => String(entry.name))
  const toolNodes = [...document.querySelectorAll('[data-tool]')].filter(visible).map((node) => ({ tool: node.dataset.tool || null, text: (node.textContent || '').trim(), disabled: Boolean(node.disabled) }))
  const safe = ['--safe-t', '--safe-r', '--safe-b', '--safe-l'].reduce((out, key) => { out[key] = getComputedStyle(document.documentElement).getPropertyValue(key).trim(); return out }, {})
  const visibleSurface = [...surface].find(visible)
  const action = (visibleSurface && [...visibleSurface.querySelectorAll('button, [role="button"]')].find((node) => visible(node) && !node.disabled && node.getAttribute('aria-disabled') !== 'true'))
    || [...document.querySelectorAll('button, [role="button"]')].find((node) => visible(node) && !node.disabled && node.getAttribute('aria-disabled') !== 'true')
  const actionRect = action?.getBoundingClientRect()
  const visualHeight = visualViewport?.height ?? innerHeight
  const visualWidth = visualViewport?.width ?? innerWidth
  const safeTop = parseFloat(safe['--safe-t'] || '0')
  const safeBottom = parseFloat(safe['--safe-b'] || '0')
  return {
    route: app?.dataset.route ?? null,
    bootstrap: app?.dataset.bootstrapStatus ?? null,
    blank: !app || !root || text.length < 8,
    textLength: text.length,
    overlayHostCount: overlayHost.length,
    overlayDepth: Number(overlayHost[0]?.dataset.overlayDepth ?? 0),
    surfaceCount: surface.length,
    rootInert: root?.inert ?? false,
    bodyLocked: document.body.dataset.overlayOpen === 'true' && getComputedStyle(document.body).overflow === 'hidden',
    focus: { tag: document.activeElement?.tagName ?? null, insideOverlay: Boolean(surface[0]?.contains(document.activeElement)), text: (document.activeElement?.textContent || '').trim().slice(0, 80) },
    overflow: { document: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, body: document.body.scrollWidth > document.body.clientWidth + 1, root: (root?.scrollWidth ?? 0) > (root?.clientWidth ?? 0) + 1 },
    targetHeights: { count: targets.length, allAtLeast44: targets.every((node) => node.getBoundingClientRect().height >= 44), minimum: targets.length ? Math.min(...targets.map((node) => node.getBoundingClientRect().height)) : null },
    scrollOwners,
    safe,
    primaryAction: actionRect ? { text: (action.textContent || '').trim().slice(0, 100), top: actionRect.top, bottom: actionRect.bottom, inViewport: actionRect.top >= -2 && actionRect.bottom <= innerHeight + 2, inVisualViewport: actionRect.top >= -2 && actionRect.bottom <= visualHeight + 2, clearOfSafeArea: actionRect.top >= safeTop && actionRect.bottom <= visualHeight - safeBottom + 2, withinVisualWidth: actionRect.left >= -2 && actionRect.right <= visualWidth + 2 } : null,
    tools: toolNodes,
    scannerVisible: Boolean([...document.querySelectorAll('[data-tool="scanner"]')].find(visible)),
    scannerChunkLoaded: resources.some((name) => /(?:CardScannerModal|jsqr|scanner)/i.test(name)),
    cameraRequests: Number(window.__M24_CAMERA_REQUESTS__ ?? 0),
    modelResources: resources.filter((name) => /(?:models|\\.glb|\\.gltf)(?:[/?#]|$)/i.test(name)),
    share: { share: typeof navigator.share === 'function', download: 'download' in document.createElement('a'), clipboard: Boolean(navigator.clipboard), execCommand: typeof document.execCommand === 'function' },
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    viewport: { innerWidth, innerHeight, visualWidth, visualHeight, dpr: devicePixelRatio, scale: visualViewport?.scale ?? null },
    prohibited,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  }
})()`

async function runBrowserQualification(repository, chromeGates, verification) {
  const cdp = await connect()
  const checkpoints = []
  const matrix = []
  const focusRestores = []
  let runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  let activeViewport = { ...VIEWPORTS[0], scale: 1 }
  const output = resolve(OUTPUT_ROOT, DEVICE, runId)
  await mkdir(output, { recursive: true })
  const evaluate = async (expression) => {
    const result = await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'Runtime.evaluate failed')
    return result.result?.value
  }
  const waitFor = async (expression, timeout = 15_000) => {
    const deadline = Date.now() + timeout
    let last
    while (Date.now() < deadline) {
      last = await evaluate(expression)
      if (last) return last
      await sleep(60)
    }
    throw new Error(`Timed out waiting for ${expression}; last=${JSON.stringify(last)}`)
  }
  const setViewport = async ({ width, height }, scale = 1) => {
    await cdp.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true, screenWidth: width, screenHeight: height, screenOrientation: { type: width >= height ? 'landscapePrimary' : 'portraitPrimary', angle: 0 } })
    await cdp.call('Emulation.setPageScaleFactor', { pageScaleFactor: scale })
    activeViewport = { ...VIEWPORTS.find((viewport) => viewport.width === width && viewport.height === height) ?? { id: `${width}x${height}`, width, height, orientation: width >= height ? 'landscape' : 'portrait' }, scale }
    await sleep(140)
  }
  const capture = async (id, description, meta = {}) => {
    // Let lazy portal content and Framer Motion's mount pass settle before
    // measuring; a screenshot taken in the same frame can otherwise show a
    // surface that the DOM diagnostics have not mounted yet.
    await sleep(120)
    const diagnostics = await evaluate(DIAGNOSTICS)
    const scroll = await evaluate(`(() => {
      const visible = (node) => { const rect = node.getBoundingClientRect(); const style = getComputedStyle(node); return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' }
      const nodes = [...document.querySelectorAll('*')].filter((node) => visible(node) && node !== document.documentElement && node !== document.body && ['auto', 'scroll'].includes(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 1)
      const before = nodes.map((node) => node.scrollTop)
      nodes.forEach((node, index) => {
        const max = Math.max(0, node.scrollHeight - node.clientHeight)
        const delta = Math.max(1, Math.min(96, max))
        node.scrollTop = before[index] < max - 1 ? Math.min(max, before[index] + delta) : Math.max(0, before[index] - delta)
      })
      const after = nodes.map((node) => node.scrollTop)
      nodes.forEach((node, index) => { node.scrollTop = before[index] })
      return { tested: nodes.length, moved: nodes.every((node, index) => node.scrollHeight <= node.clientHeight + 1 || after[index] !== before[index]), restored: nodes.every((node, index) => node.scrollTop === before[index]), overscroll: nodes.map((node) => getComputedStyle(node).overscrollBehaviorY).every((value) => value === 'contain' || value === 'none'), overscrollValues: nodes.map((node) => getComputedStyle(node).overscrollBehaviorY) }
    })()`)
    const checkpointRoot = resolve(output, id)
    await mkdir(checkpointRoot, { recursive: true })
    const screenshot = await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    await writeFile(resolve(checkpointRoot, 'screenshot.png'), Buffer.from(screenshot.data, 'base64'))
    const ax = await cdp.call('Accessibility.getFullAXTree', { depth: -1 })
    const nodes = (ax.nodes ?? []).filter((node) => !node.ignored && node.role?.value && node.name?.value).map((node) => ({ role: String(node.role.value), name: String(node.name.value), checked: node.properties?.find((property) => property.name === 'checked')?.value?.value ?? null })).slice(0, 900)
    await writeFile(resolve(checkpointRoot, 'accessibility.json'), `${JSON.stringify({ schemaVersion: 1, ticket: 51, id, nodes }, null, 2)}\n`)
    const record = { id, description, capturedAt: new Date().toISOString(), ...meta, viewport: activeViewport, diagnostics, scroll, screenshot: `${id}/screenshot.png`, accessibility: `${id}/accessibility.json` }
    checkpoints.push(record)
    console.log(`Captured ${id}`)
    return record
  }
  const semanticActivate = async (selector, index) => evaluate(`(() => { const node = [...document.querySelectorAll(${JSON.stringify(selector)})][${index}]; if (!node || node.disabled || node.getAttribute('aria-disabled') === 'true') return false; node.focus?.({ preventScroll: true }); node.click(); return true })()`)
  const pressTab = async () => {
    await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 })
    await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 })
  }
  const keyboardFocusProbe = async () => {
    await pressTab()
    await pressTab()
    return evaluate('Boolean([...document.querySelectorAll("[data-modal-surface]")].find((surface) => surface.getBoundingClientRect().width > 0 && surface.contains(document.activeElement)))')
  }
  const click = async (selector, index = 0, input = 'click') => {
    if (input === 'touch') {
      const point = await evaluate(`(() => { const node = [...document.querySelectorAll(${JSON.stringify(selector)})][${index}]; if (!node || node.disabled || node.getAttribute('aria-disabled') === 'true') return null; const rect = node.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } })()`)
      if (!point) throw new Error(`Cannot touch-style activate ${selector}[${index}]`)
      await cdp.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, pointerType: 'touch' })
      await cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1, pointerType: 'touch' })
      await cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1, pointerType: 'touch' })
      return
    }
    const ok = await semanticActivate(selector, index)
    if (!ok) throw new Error(`Cannot click ${selector}[${index}]`)
  }
  const driver = async (method, value) => evaluate(`(async () => { const driver = window.__MOBIE_M24_BASELINE__; if (!driver || typeof driver[${JSON.stringify(method)}] !== 'function') throw new Error('M24 baseline driver is unavailable'); return await driver[${JSON.stringify(method)}](${value === undefined ? '' : JSON.stringify(value)}); })()`)
  const closeOverlay = async () => {
    if (await evaluate('Boolean(document.querySelector("[data-modal-close]"))')) await click('[data-modal-close]')
    await waitFor('!document.querySelector("[data-overlay-host]")', 6_000)
    const restored = await waitFor('Boolean(document.activeElement?.matches("[aria-controls=tools-menu-more], [data-tool=team]"))', 2_000).catch(() => false)
    focusRestores.push(restored)
    return restored
  }
  const closeMore = async () => {
    if (await evaluate('document.querySelector("[data-tools-menu]")?.dataset.toolsMenuState === "open"')) {
      await click('[aria-controls="tools-menu-more"]', 0, 'touch')
      await waitFor('document.querySelector("[data-tools-menu]")?.dataset.toolsMenuState === "closed"', 6_000)
    }
  }
  const openMore = async () => {
    if (!(await evaluate('document.querySelector("[data-tools-menu]")?.dataset.toolsMenuState === "open"'))) {
      await click('[aria-controls="tools-menu-more"]', 0, 'touch')
      await sleep(220)
    }
    if (!(await evaluate('document.querySelector("[data-tools-menu]")?.dataset.toolsMenuState === "open"'))) throw new Error('More menu did not open')
  }
  const openTool = async (tool) => {
    if (tool === 'team') {
      await click('[data-tool="team"]', 0, 'touch')
      await waitFor('Boolean([...document.querySelectorAll("[data-modal-surface]")].find((node) => { const rect = node.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 }))')
      return
    }
    await openMore()
    await click(`[data-tool="${tool}"]`, 0, 'touch')
    await waitFor('Boolean([...document.querySelectorAll("[data-modal-surface]")].find((node) => { const rect = node.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 }))')
  }

  const setSafeArea = async (enabled) => evaluate(`(() => {
    const values = ${enabled ? "['24px', '18px', '32px', '18px']" : "['', '', '', '']"}
    for (const [index, key] of ['--safe-t', '--safe-r', '--safe-b', '--safe-l'].entries()) {
      if (values[index]) document.documentElement.style.setProperty(key, values[index])
      else document.documentElement.style.removeProperty(key)
    }
    return true
  })()`)

  const installBrowserProbes = async () => evaluate(`(() => {
    const installCameraProbe = () => {
      const devices = navigator.mediaDevices
      if (!devices || typeof devices.getUserMedia !== 'function' || devices.__t51Wrapped) return
      const original = devices.getUserMedia.bind(devices)
      Object.defineProperty(devices, 'getUserMedia', { configurable: true, value: (...args) => { window.__M24_CAMERA_REQUESTS__ += 1; return original(...args) } })
      Object.defineProperty(devices, '__t51Wrapped', { configurable: true, value: true })
    }
    installCameraProbe()
    window.setTimeout(installCameraProbe, 0)
    return true
  })()`)

  await cdp.call('Runtime.enable')
  await cdp.call('Page.enable')
  await cdp.call('Network.enable')
  await cdp.call('Log.enable')
  await cdp.call('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { window.__T51_UNHANDLED__=[]; window.__M24_CAMERA_REQUESTS__=0; const installCameraProbe=()=>{ const devices=navigator.mediaDevices; if(!devices||typeof devices.getUserMedia!=='function'||devices.__t51Wrapped)return; const original=devices.getUserMedia.bind(devices); Object.defineProperty(devices,'getUserMedia',{configurable:true,value:(...args)=>{window.__M24_CAMERA_REQUESTS__+=1;return original(...args)}}); Object.defineProperty(devices,'__t51Wrapped',{configurable:true,value:true}) }; installCameraProbe(); window.setTimeout(installCameraProbe,0); window.addEventListener('unhandledrejection', event => window.__T51_UNHANDLED__.push(String(event.reason?.stack || event.reason || 'unhandled rejection'))); window.addEventListener('error', event => window.__T51_UNHANDLED__.push(String(event.error?.stack || event.message || 'window error'))); })();` })
  await cdp.call('Storage.clearDataForOrigin', { origin: ORIGIN, storageTypes: 'all' })
  await cdp.call('Page.navigate', { url: `${ORIGIN}/?m24Scenario=m24-post-m23-chrome-v1&ticket51Run=${runId}` })
  await waitFor('document.querySelector("[data-app-shell]")?.dataset.bootstrapStatus === "ready" && document.querySelector("[data-app-shell]")?.dataset.route === "title"', 20_000)
  await waitFor('Boolean(window.__MOBIE_M24_BASELINE__)')
  await installBrowserProbes()
  await driver('seedContent')
  const baselineSnapshot = await driver('snapshot')
  const cards = await evaluate('window.__MOBIE_M24_BASELINE__.rosterPreview().slice(0, 3).map((unit) => ({ cardId: unit.id, speciesId: unit.speciesId, level: unit.level, shiny: false }))')

  const runHuntJourney = async (viewport, prefix) => {
    await setViewport(viewport)
    await capture(`${prefix}-region`, 'region hub hunt entry', { viewport, journey: 'hunt', input: 'touch-style' })
    await driver('sendGameEvent', { type: 'SELECT_REGION', regionId: 'verdant-forest' })
    await waitFor('document.querySelector("[data-app-shell]")?.dataset.route === "encounter"')
    await capture(`${prefix}-encounter`, 'encounter and explicit supply gate', { viewport, journey: 'hunt', input: 'touch-style' })
    await driver('sendGameEvent', { type: 'ENGAGE' })
    await waitFor('document.querySelector("[data-app-shell]")?.dataset.route === "cardSelect"')
    await capture(`${prefix}-team`, 'team selection narrow/dual-pane boundary', { viewport, journey: 'hunt', input: 'touch-style' })
    await driver('sendGameEvent', { type: 'SELECT_TEAM', cards })
    await waitFor('document.querySelector("[data-app-shell]")?.dataset.route === "battle"')
    await driver('prepareBattleChoice')
    await capture(`${prefix}-battle`, 'battle handoff and touch command surface', { viewport, journey: 'hunt', input: 'touch-style' })
    await driver('endBattle', 'win')
    await waitFor('document.querySelector("[data-app-shell]")?.dataset.route === "result"')
    await capture(`${prefix}-result`, 'result CTA and settlement projection', { viewport, journey: 'result', input: 'touch-style' })
    await driver('sendGameEvent', { type: 'TO_REGIONS' })
    await waitFor('document.querySelector("[data-app-shell]")?.dataset.route === "regionSelect"')
  }

  for (const viewport of VIEWPORTS) {
    await setViewport(viewport)
    await capture(`${viewport.id}-title`, 'cold boot and title', { viewport, input: 'touch-capable', orientation: viewport.orientation })
  }

  await setViewport(VIEWPORTS[0])
  await click('[data-tool="team"]', 0, 'touch')
  await waitFor('Boolean([...document.querySelectorAll("[data-modal-surface]")].find((node) => { const rect = node.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 }))')
  await capture('team-overlay', 'My Mobies growth shell', { viewport: VIEWPORTS[0], journey: 'growth' })
  await closeOverlay()
  await openMore()
  const scannerOff = await capture('scanner-off', 'scanner default-off capability gate', { viewport: VIEWPORTS[0], journey: 'data-tools' })
  await closeMore()

  await driver('sendGameEvent', { type: 'START' })
  await waitFor('document.querySelector("[data-app-shell]")?.dataset.route === "regionSelect"')
  await runHuntJourney(VIEWPORTS[0], 'hunt')
  await driver('sendGameEvent', { type: 'OPEN_TOWER' })
  await waitFor('document.querySelector("[data-app-shell]")?.dataset.route === "towerSetup"')
  await capture('tower-setup', 'Tower setup and fixed ascension truth', { viewport: VIEWPORTS[0], journey: 'tower' })
  await driver('sendGameEvent', { type: 'START_TOWER', cards, ascension: 0, seed: 'ticket51-tower' })
  await waitFor('document.querySelector("[data-app-shell]")?.dataset.route === "battle"')
  await driver('prepareBattleChoice')
  await driver('endBattle', 'win')
  await waitFor('document.querySelector("[data-app-shell]")?.dataset.route === "result"')
  await capture('tower-result', 'Tower result loop and next-floor guard', { viewport: VIEWPORTS[0], journey: 'tower' })
  await driver('sendGameEvent', { type: 'TOWER_QUIT' })
  await waitFor('document.querySelector("[data-app-shell]")?.dataset.route === "regionSelect"')

  for (const viewport of VIEWPORTS.slice(1)) await runHuntJourney(viewport, `matrix-${viewport.id}-hunt`)

  await setViewport(VIEWPORTS[1])
  await driver('sendGameEvent', { type: 'OPEN_TOWER' })
  await waitFor('document.querySelector("[data-app-shell]")?.dataset.route === "towerSetup"')
  await capture('matrix-ipad-landscape-tower-setup', 'Tower setup landscape regression', { viewport: VIEWPORTS[1], journey: 'tower', input: 'touch-style' })
  await driver('sendGameEvent', { type: 'START_TOWER', cards, ascension: 0, seed: 'ticket51-tower-landscape' })
  await waitFor('document.querySelector("[data-app-shell]")?.dataset.route === "battle"')
  await driver('prepareBattleChoice')
  await driver('endBattle', 'win')
  await waitFor('document.querySelector("[data-app-shell]")?.dataset.route === "result"')
  await capture('matrix-ipad-landscape-tower-result', 'Tower result landscape regression', { viewport: VIEWPORTS[1], journey: 'tower', input: 'touch-style' })
  await driver('sendGameEvent', { type: 'TOWER_QUIT' })
  await waitFor('document.querySelector("[data-app-shell]")?.dataset.route === "regionSelect"')

  const tools = ['library', 'moves', 'partner', 'dex', 'achievements', 'incubator', 'replays', 'save', 'settings']
  for (const tool of tools) {
    await openTool(tool)
    const keyboardFocus = tool === 'settings' ? await keyboardFocusProbe() : undefined
    await capture(`tool-${tool}`, `${tool} data-tool surface`, { viewport: VIEWPORTS[0], journey: 'data-tools', keyboardFocus })
    await closeOverlay()
  }

  for (const viewport of VIEWPORTS) {
    await setViewport(viewport)
    await setSafeArea(true)
    for (const tool of tools) {
      await openTool(tool)
      const keyboardFocus = tool === 'settings' ? await keyboardFocusProbe() : undefined
      const record = await capture(`matrix-${viewport.id}-${tool}`, 'orientation/safe-area/touch/scroll data-tool matrix', { viewport, orientation: viewport.orientation, journey: 'full-app', tool, keyboardFocus })
      matrix.push({ viewport: viewport.id, viewportSpec: viewport, orientation: viewport.orientation, tool, keyboardFocus, diagnostics: record.diagnostics, scroll: record.scroll })
      await closeOverlay()
    }
    // Open the Settings surface while its invoker is reachable at scale 1;
    // then apply browser zoom to the mounted surface, matching how Safari's
    // page zoom preserves the current focus instead of hiding the menu button.
    await setViewport(viewport)
    await setSafeArea(true)
    await openTool('settings')
    const zoomedCssViewport = { width: Math.max(320, Math.round(viewport.width / 2)), height: Math.max(320, Math.round(viewport.height / 2)) }
    await setViewport(zoomedCssViewport)
    activeViewport = { ...viewport, scale: 2, zoomedCssViewport }
    await sleep(180)
    const keyboardFocus = await keyboardFocusProbe()
    const zoomRecord = await capture(`matrix-${viewport.id}-settings-200`, '200% browser zoom and safe-area inset simulation', { scale: 2, safeArea: true, orientation: viewport.orientation, journey: 'settings', tool: 'settings', keyboardFocus, zoomedCssViewport })
    matrix.push({ viewport: viewport.id, viewportSpec: viewport, scale: 2, orientation: viewport.orientation, tool: 'settings', keyboardFocus, zoomedCssViewport, diagnostics: zoomRecord.diagnostics, scroll: zoomRecord.scroll })
    await closeOverlay()
    await setSafeArea(false)
  }

  const readPersistence = () => evaluate(`(async () => {
    const readKeys = (database, store) => new Promise((resolve) => {
      let request
      try { request = indexedDB.open(database) } catch { resolve(null); return }
      request.onerror = () => resolve(null)
      request.onsuccess = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(store)) { db.close(); resolve(null); return }
        let transaction
        try { transaction = db.transaction(store, 'readonly'); const get = transaction.objectStore(store).getAllKeys(); get.onsuccess = () => { const keys = [...(get.result || [])].map(String).sort(); db.close(); resolve(keys) }; get.onerror = () => { db.close(); resolve(null) } } catch { db.close(); resolve(null) }
      }
    })
    return {
      localStorage: Object.fromEntries(Object.entries(localStorage).filter(([key]) => /^(?:mobie\\.(?:roster\\.v2|meta\\.v1|incubator\\.v1|run\\.v1|settings\\.v2|playerskills\\.v1|skillpoints\\.v1|bag\\.v1|savemeta\\.v1))$/.test(key))),
      databases: (await indexedDB.databases()).map(({ name, version }) => ({ name, version })).sort((a, b) => String(a.name).localeCompare(String(b.name))),
      indexedDb: { cards: await readKeys('mz-cards', 'cards'), replays: await readKeys('mz-replays', 'replays') },
    }
  })()`)
  const persistenceBefore = await readPersistence()
  await setViewport(VIEWPORTS[0])
  await cdp.call('Page.reload', { ignoreCache: true })
  await waitFor('document.querySelector("[data-app-shell]")?.dataset.route === "title" && document.querySelector("[data-app-shell]")?.dataset.bootstrapStatus === "ready"', 20_000)
  const persistenceAfter = await readPersistence()
  const reload = await capture('reload-persistence', 'reload and IndexedDB persistence boundary', { viewport: activeViewport, journey: 'persistence', persistence: { before: persistenceBefore, after: persistenceAfter, retained: persistenceRetained(persistenceBefore, persistenceAfter) } })
  const finalDiagnostics = await evaluate(DIAGNOSTICS)
  const unhandled = await evaluate('window.__T51_UNHANDLED__ ?? []')
  const consoleErrors = cdp.events.filter((event) => event.method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(event.params?.type))
  const runtimeErrors = cdp.events.filter((event) => event.method === 'Runtime.exceptionThrown')
  const networkFailed = cdp.events.filter((event) => event.method === 'Network.loadingFailed')
  const allRecords = [...checkpoints, ...matrix, reload]
  const assertions = {
    projectChecks: verification.allGreen,
    chromeGates: chromeGates.allGreen,
    tickets01To50Complete: repository.allCommitsPresent,
    routeMatrix: ['hunt-region', 'hunt-encounter', 'hunt-team', 'hunt-battle', 'hunt-result', 'tower-setup', 'tower-result'].every((id) => checkpoints.some((record) => record.id === id)),
    dataToolsMatrix: ['library', 'moves', 'partner', 'dex', 'achievements', 'incubator', 'replays', 'save', 'settings'].every((tool) => checkpoints.some((record) => record.id === `tool-${tool}`)) && checkpoints.some((record) => record.id === 'team-overlay'),
    orientationMatrix: new Set(matrix.map((record) => record.viewport)).size === VIEWPORTS.length,
    noBlankScreens: allRecords.every((record) => !record.diagnostics.blank && record.diagnostics.textLength >= 8),
    noHorizontalOverflow: allRecords.every((record) => !record.diagnostics.overflow.document && !record.diagnostics.overflow.body && !record.diagnostics.overflow.root),
    targetMinimum44: allRecords.every((record) => record.diagnostics.targetHeights.allAtLeast44),
    safeAreaAndZoom: matrix.filter((record) => record.scale === 2).length === VIEWPORTS.length && matrix.filter((record) => record.scale === 2).every((record) => record.zoomedCssViewport?.width === Math.round(record.viewportSpec.width / 2) && record.zoomedCssViewport?.height === Math.round(record.viewportSpec.height / 2) && record.diagnostics.safe['--safe-b'] === '32px' && record.diagnostics.primaryAction?.inVisualViewport === true && record.diagnostics.primaryAction?.clearOfSafeArea === true && record.diagnostics.primaryAction?.withinVisualWidth === true && !record.diagnostics.overflow.document && !record.diagnostics.overflow.body),
    scrollAndOverscroll: allRecords.every((record) => record.scroll.moved && record.scroll.restored && record.scroll.overscroll),
    keyboardFocusFallback: [...checkpoints, ...matrix].filter((record) => record.keyboardFocus !== undefined).every((record) => record.keyboardFocus === true),
    focusRestored: focusRestores.length > 0 && focusRestores.every(Boolean),
    overlayOwnership: allRecords.filter((record) => record.diagnostics.surfaceCount > 0).every((record) => record.diagnostics.overlayHostCount === 1 && record.diagnostics.surfaceCount === 1 && record.diagnostics.rootInert && record.diagnostics.bodyLocked && record.diagnostics.focus.insideOverlay),
    scannerOff: scannerOff.diagnostics.scannerVisible === false && scannerOff.diagnostics.scannerChunkLoaded === false && scannerOff.diagnostics.cameraRequests === 0,
    noProhibitedRuntimeTruth: allRecords.every((record) => record.diagnostics.prohibited.length === 0),
    noModelResources: allRecords.every((record) => record.diagnostics.modelResources.length === 0),
    fixedProductTruth: repository.sourceInvariants.fixedProductRuntime && repository.sourceInvariants.partnerSkillsRuntime && repository.sourceInvariants.noForbiddenRuntimeTokens && baselineSnapshot.learnedPartnerSkills.includes('rally'),
    reloadReady: reload.diagnostics.route === 'title' && reload.diagnostics.bootstrap === 'ready' && reload.persistence?.retained === true,
    noUnhandledRejections: unhandled.length === 0 && consoleErrors.length === 0 && runtimeErrors.length === 0,
  }
  const evidence = {
    schemaVersion: 1,
    ticket: 51,
    qualification: 'web-app-ipad-safari',
    capturedAt: new Date().toISOString(),
    device: { kind: 'web-app', physicalDeviceTest: false, ownerBoundary: 'owner-confirmed web app acceptance', browser: finalDiagnostics.userAgent, platform: finalDiagnostics.platform },
    viewportMatrix: VIEWPORTS,
    verification,
    focusRestores,
    chromeGates,
    repository,
    checkpoints,
    matrix,
    capabilities: finalDiagnostics.share,
    errors: { console: consoleErrors, runtime: runtimeErrors, unhandledRejections: unhandled, networkFailed },
    assertions,
    limitations: [
      'The owner accepts Mobie as a web app; native iPad Safari hardware is intentionally outside this gate.',
      'Chrome mobile emulation supplies iPad CSS viewport/orientation/touch-style input. Safari-only console tooling is unavailable in this web-app qualification.',
      'Share API availability is recorded from the active browser; Ticket 50 exercises download, clipboard, and manual delivery fallbacks in the production Save surface.',
    ],
  }
  await writeFile(resolve(output, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`)
  await writeFile(resolve(OUTPUT_ROOT, 'latest.json'), `${JSON.stringify({ schemaVersion: 1, ticket: 51, run: `${DEVICE}/${runId}`, evidence: `${DEVICE}/${runId}/evidence.json` }, null, 2)}\n`)
  const failedAssertions = Object.entries(assertions).filter(([, value]) => value !== true)
  if (failedAssertions.length > 0) throw new Error(`Ticket 51 assertions failed: ${JSON.stringify(failedAssertions)}`)
  console.log(`Ticket 51 web iPad qualification passed: ${checkpoints.length} checkpoints; ${matrix.length} viewport checks`)
  console.log(`Evidence: ${resolve(output, 'evidence.json')}`)
  cdp.close()
}

async function main() {
  const verification = runProjectChecks()
  if (!verification.allGreen) throw new Error(`Project checks failed: ${JSON.stringify(verification.checks)}`)
  const repository = await verifyRepositoryInventory()
  const chromeGates = await verifyChromeGates()
  if (!chromeGates.allGreen) throw new Error(`Chrome closure prerequisites are not green: ${JSON.stringify(chromeGates.checks)}`)
  await runBrowserQualification(repository, chromeGates, verification)
}

main().catch((error) => {
  console.error(`Ticket 51 web iPad qualification failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
