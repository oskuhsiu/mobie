// Ticket 50 Chrome closure matrix for the real shell and data tools.
//
// Run with Vite and an isolated Chrome CDP target:
//   npm run dev -- --host 127.0.0.1
//   chrome --remote-debugging-port=9222 --user-data-dir=/tmp/mobie-ticket50 about:blank
//   node scripts/m24-ticket50-closure.mjs --port=9222
//
// This runner deliberately uses the production route, stores, overlay host,
// lazy imports, and browser APIs. DEV seams only make slow/failing storage and
// canonical fixtures deterministic; no component is mocked.

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'

const SCENARIO = 'm24-post-m23-chrome-v1'
const OUTPUT_ROOT = resolve('test-runs', 'm24', 'ticket50-shell-data-tools')
const ORIGIN = 'http://127.0.0.1:5173'
const VIEWPORTS = [
  { id: 'wide-landscape', width: 1180, height: 820 },
  { id: 'mid-landscape', width: 1024, height: 768 },
  { id: 'short-landscape', width: 852, height: 393 },
  { id: 'tablet-portrait', width: 1024, height: 1366 },
  { id: 'phone-portrait', width: 393, height: 852 },
]

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
const arg = (name, fallback) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
const port = Number(arg('port', '9222'))
const device = arg('device', 'ticket50-chrome')

async function productionBuildGraph() {
  const files = []
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else files.push(path)
    }
  }
  try {
    await visit(resolve('dist'))
  } catch {
    return { available: false, files: [], forbiddenAssets: [], manifest: null }
  }
  const forbiddenAssets = files.filter((path) => {
    const relative = path.replace(`${resolve('dist')}/`, '')
    if (relative === 'models/.gitkeep') return false
    return /(?:^|[\\/])models[\\/]|\\.(?:glb|gltf)$/i.test(relative) || /custom.?model/i.test(relative)
  })
  let manifest = null
  for (const path of [resolve('dist/.vite/manifest.json'), resolve('dist/manifest.json')]) {
    try { manifest = JSON.parse(await readFile(path, 'utf8')); break } catch { /* optional manifest */ }
  }
  return { available: true, files: files.map((path) => path.replace(`${resolve('dist')}/`, '')), forbiddenAssets, manifest }
}

async function connect() {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`)
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

const READ_CARD_RECORDS = `async () => {
  const request = indexedDB.open('mz-cards')
  const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
  if (!db.objectStoreNames.contains('cards')) { db.close(); throw new Error('cards store is unavailable') }
  const rows = await new Promise((resolve, reject) => { const tx = db.transaction('cards', 'readonly'); const get = tx.objectStore('cards').getAll(); get.onsuccess = () => resolve(get.result || []); get.onerror = () => reject(get.error) })
  db.close(); return rows
}`

const DIAGNOSTICS = `(async () => {
  const app = document.querySelector('[data-app-shell]')
  const root = document.getElementById('root')
  const surface = document.querySelector('[data-modal-surface]')
  const menu = document.querySelector('#tools-menu-more')
  const visible = (node) => {
    if (!node) return false
    const rect = node.getBoundingClientRect(); const style = getComputedStyle(node)
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
  }
  const tools = [...document.querySelectorAll('[data-tool]')].map((node) => ({
    tool: node.dataset.tool || null, text: (node.textContent || '').trim(), disabled: Boolean(node.disabled), visible: visible(node),
  }))
  const scrollOwners = [...document.querySelectorAll('*')].filter((node) => {
    if (node === document.documentElement || node === document.body) return false
    if (node.closest('#root')?.getAttribute('aria-hidden') === 'true') return false
    if (!visible(node)) return false
    const style = getComputedStyle(node)
    return (style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 1
  }).map((node) => ({ tag: node.tagName, className: String(node.className), id: node.id || null, scrollTop: node.scrollTop, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }))
  const targets = [...document.querySelectorAll('button, [role="button"], [role="switch"]')].filter(visible).map((node) => node.getBoundingClientRect().height)
  const safeGet = (key) => { try { return localStorage.getItem(key) } catch { return '__storage-error__' } }
  const resources = performance.getEntriesByType('resource').map((entry) => String(entry.name))
  const resourceEntries = performance.getEntriesByType('resource')
  const text = (document.body.innerText || '').replace(/\\s+/g, ' ').trim()
  const prohibited = ['encounter style', 'style tags', 'style stats', 'module off', 'model manager', 'custom glb', 'custom gltf']
    .filter((needle) => text.toLowerCase().includes(needle))
  const operationKeys = ['mobie.result.settlement.v1', 'mobie.meta.v1', 'mobie.incubator.v1', 'mobie.roster.growth.v1', 'mobie.meta.settlement.v1', 'mobie.incubator.hatch.v1', 'mobie.save.transaction.v1']
  const operationStorage = Object.fromEntries(operationKeys.map((key) => [key, safeGet(key)]))
  return {
    route: app?.dataset.route || null, bootstrapStatus: app?.dataset.bootstrapStatus || null, bootstrapAttempt: Number(app?.dataset.bootstrapAttempt || 0),
    overlay: window.__MOBIE_OVERLAY__?.snapshot?.() || null, overlayId: document.querySelector('[data-overlay-host]')?.dataset.overlayId || null,
    overlayHostCount: document.querySelectorAll('[data-overlay-host]').length, overlayDepth: Number(document.querySelector('[data-overlay-host]')?.dataset.overlayDepth || 0), surfaceCount: document.querySelectorAll('[data-modal-surface]').length,
    rootInert: Boolean(root?.inert), rootAriaHidden: root?.getAttribute('aria-hidden') || null, bodyOverflow: document.body.style.overflow, bodyOverlayOpen: document.body.dataset.overlayOpen || null,
    active: { tag: document.activeElement?.tagName || null, ariaLabel: document.activeElement?.getAttribute?.('aria-label') || null, text: (document.activeElement?.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 100), insideSurface: Boolean(surface && surface.contains(document.activeElement)) },
    menu: menu ? { visible: visible(menu), scrollTop: menu.scrollTop, scrollHeight: menu.scrollHeight, clientHeight: menu.clientHeight, groups: [...menu.querySelectorAll('h2')].map((node) => node.textContent?.trim()) } : null,
    tools,
    cardLibrary: (() => { const node = document.querySelector('[data-card-library]'); return node ? { state: node.dataset.cardLibraryState || null, rows: document.querySelectorAll('[data-card-row]').length, cardCount: document.querySelectorAll('[data-card-row]').length, importError: Boolean(document.querySelector('[data-card-import-error]')), deleteDialog: Boolean(document.querySelector('[data-card-delete-dialog]')) } : null })(),
    scanner: (() => { const node = document.querySelector('[data-scanner]'); return node ? { state: node.dataset.scannerState || null, cameraActive: document.querySelector('[data-scan-camera-active="true"]') !== null, permissionAction: Boolean(document.querySelector('[data-scan-camera]')), manualAction: Boolean(document.querySelector('[data-scan-manual]')), result: document.querySelector('[data-scan-result]')?.dataset.scanResult || null } : null })(),
    save: (() => { const node = document.querySelector('[data-save-export]'); const gate = document.querySelector('[data-save-operation-gate]'); return node ? { exportDisabled: Boolean(node.disabled), importDisabled: Boolean(document.querySelector('[data-save-import-trigger]')?.disabled), backupDisabled: Boolean(document.querySelector('[data-save-backup]')?.disabled), restoreDisabled: Boolean(document.querySelector('[data-save-restore]')?.disabled), gate: gate?.textContent?.trim() || null, message: [...document.querySelectorAll('.lib-msg')].at(-1)?.textContent?.trim() || null } : null })(),
    replay: (() => { const node = document.querySelector('[data-replay-list]'); const player = document.querySelector('[data-replay-player]'); return { listState: node?.dataset.replayListState || null, rows: document.querySelectorAll('[data-replay-row]').length, decodeErrors: document.querySelectorAll('[data-replay-row][data-replay-state="decode-error"]').length, playerState: player?.dataset.replayState || null, cursor: Number(player?.dataset.replayCursor || 0), events: Number(player?.dataset.replayEventCount || 0) } })(),
    settings: (() => { const node = document.querySelector('[data-settings]'); return node ? { schema: Number(node.dataset.settingsSchemaVersion || 0), scanner: document.querySelector('[data-settings-preference="scannerEnabled"]')?.getAttribute('aria-checked') || null, replay: document.querySelector('[data-settings-preference="recordReplays"]')?.getAttribute('aria-checked') || null, fixedRows: [...document.querySelectorAll('[data-settings-item]')].map((item) => item.dataset.settingsItem), sections: [...document.querySelectorAll('[data-settings-section]')].map((item) => item.dataset.settingsSection) } : null })(),
    routeEvents: window.__MOBIE_ROUTE_EVENTS__ || { total: 0, byType: {} }, cameraRequests: Number(window.__T50_CAMERA_REQUESTS__ || 0),
    overflow: { document: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, body: document.body.scrollWidth > document.body.clientWidth + 1, documentWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
    scrollOwners, targetMinimum: targets.length ? Math.min(...targets) : null, allTargetsAtLeast44: targets.every((height) => height >= 44),
    artwork: { failures: document.querySelectorAll('[data-artwork-state="failed"], [data-dex-artwork-state="failed"]').length, loading: document.querySelectorAll('[data-artwork-state="loading"], [data-dex-artwork-state="loading"]').length },
    prohibited, storage: Object.fromEntries(Object.keys(localStorage).sort().map((key) => [key, safeGet(key)?.length || 0])), operationStorage,
    reducedMotion: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
    performance: { resourceCount: resourceEntries.length, scriptCount: resourceEntries.filter((entry) => /\\.js(?:$|\\?)/i.test(entry.name)).length, maxDurationMs: resourceEntries.reduce((max, entry) => Math.max(max, Number(entry.duration) || 0), 0) },
    resources, scannerChunkLoaded: resources.some((name) => /CardScanner|jsqr/i.test(name)), modelResources: resources.filter((name) => /\\.(?:glb|gltf)(?:$|\\?)/i.test(name) || /custom.?model/i.test(name)),
    modelDatabases: typeof indexedDB.databases === 'function' ? (await indexedDB.databases()).map((db) => db.name).filter(Boolean) : [], modelIo: window.__T50_MODEL_IO__ || null,
    safeArea: { appPadding: getComputedStyle(app || document.body).padding, modalPadding: getComputedStyle(document.querySelector('[data-modal-backdrop]') || document.body).padding },
    viewport: { width: innerWidth, height: innerHeight, scale: visualViewport?.scale || 1 },
    text: text.slice(0, 6000),
  }
})()`

async function main() {
  const cdp = await connect()
  activeCdp = cdp
  const { call, events } = cdp
  const checkpoints = []
  const matrix = []
  let eventCursor = 0
  let currentViewport = { ...VIEWPORTS[0], scale: 1 }
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
    if (result.exceptionDetails) throw new Error(`${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'Runtime.evaluate failed'} :: ${expression.slice(0, 180)}`)
    return result.result?.value
  }
  const waitFor = async (expression, timeout = 15_000, description = expression) => {
    const deadline = Date.now() + timeout
    let last
    while (Date.now() < deadline) {
      last = await evaluate(expression)
      if (last) return last
      await sleep(60)
    }
    throw new Error(`Timed out waiting for ${description}; last=${JSON.stringify(last)}`)
  }
  const click = async (selector, index = 0) => {
    let result
    for (let attempt = 0; attempt < 6; attempt += 1) {
      result = await evaluate(`(() => { const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})]; const node = nodes[${index}]; if (!node || node.disabled || node.getAttribute('aria-disabled') === 'true') return { ok: false, count: nodes.length }; node.scrollIntoView({ block: 'center', inline: 'center' }); node.focus?.({ preventScroll: true }); node.click(); return { ok: true, count: nodes.length }; })()`)
      if (result?.ok) return
      await sleep(100)
    }
    throw new Error(`Cannot click ${selector}[${index}]: ${JSON.stringify(result)}`)
  }
  const press = async (key) => evaluate(`(() => { const event = new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, code: ${JSON.stringify(key)}, bubbles: true, cancelable: true }); document.dispatchEvent(event); return event.defaultPrevented; })()`)
  const nativeKey = async (key, modifiers = 0) => {
    const code = key === ' ' ? 'Space' : key === 'Escape' ? 'Escape' : key === 'Tab' ? 'Tab' : key.startsWith('Arrow') ? key : key
    const virtualKey = key === ' ' ? 32 : key === 'Escape' ? 27 : key === 'Tab' ? 9 : undefined
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers, ...(virtualKey ? { windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey } : {}) })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers, ...(virtualKey ? { windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey } : {}) })
  }
  const setInput = async (selector, value) => evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return false; const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set; setter?.call(node, ${JSON.stringify(value)}); node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`)
  const readStorage = async (key) => evaluate(`(() => { try { return JSON.parse(localStorage.getItem(${JSON.stringify(key)}) || 'null') } catch { return null } })()`)
  const canonicalState = () => evaluate(`(async () => {
    const parse = (key) => { try { return localStorage.getItem(key) } catch { return null } }
    const readCards = ${READ_CARD_RECORDS}
    let cards = null
    try { cards = (await readCards()).map((card) => card.cardId).sort() } catch { /* diagnostics remain useful when card storage is unavailable */ }
    return JSON.stringify({ roster: parse('mobie.roster.v2'), meta: parse('mobie.meta.v1'), incubator: parse('mobie.incubator.v1'), skillPoints: parse('mobie.skillpoints.v1'), run: parse('mobie.run.v1'), bag: parse('mobie.itembag.v1'), playerSkills: parse('mobie.playerskills.v1'), cards, route: document.querySelector('[data-app-shell]')?.dataset.route || null })
  })()`)
  const setStorage = async (key, value) => evaluate(`(() => { localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(value))}); window.dispatchEvent(new StorageEvent('storage', { key: ${JSON.stringify(key)}, newValue: localStorage.getItem(${JSON.stringify(key)}) })); return true })()`)
  const removeStorage = async (key) => evaluate(`(() => { localStorage.removeItem(${JSON.stringify(key)}); window.dispatchEvent(new StorageEvent('storage', { key: ${JSON.stringify(key)}, newValue: null })); return true })()`)
  const setViewport = async (width, height, scale = 1) => {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true, screenWidth: width, screenHeight: height, screenOrientation: { type: width >= height ? 'landscapePrimary' : 'portraitPrimary', angle: 0 } })
    await call('Emulation.setPageScaleFactor', { pageScaleFactor: scale })
    currentViewport = { id: `${width}x${height}`, width, height, scale }
    await sleep(140)
  }
  const seedModelSentinel = () => evaluate(`(async () => {
    const request = indexedDB.open('mz-models', 1)
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('models')) request.result.createObjectStore('models', { keyPath: 'id' }) }
    const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    await new Promise((resolve, reject) => { const tx = db.transaction('models', 'readwrite'); tx.objectStore('models').put({ id: 'ticket50-sentinel', payload: 'untouched' }); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error) })
    db.close(); return true
  })()`)
  const readModelSentinel = () => evaluate(`(async () => {
    if (window.__T50_MODEL_IO__) window.__T50_MODEL_IGNORE__ = true
    try {
      const request = indexedDB.open('mz-models'); const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
      if (!db.objectStoreNames.contains('models')) { db.close(); return null }
      const value = await new Promise((resolve, reject) => { const tx = db.transaction('models', 'readonly'); const get = tx.objectStore('models').get('ticket50-sentinel'); get.onsuccess = () => resolve(get.result || null); get.onerror = () => reject(get.error) })
      db.close(); return value
    } finally { if (window.__T50_MODEL_IO__) window.__T50_MODEL_IGNORE__ = false }
  })()`)
  const installRuntimeProbes = () => evaluate(`(() => {
    if (!window.__T50_UNHANDLED__) {
      window.__T50_UNHANDLED__ = []
      window.addEventListener('unhandledrejection', (event) => window.__T50_UNHANDLED__.push(String(event.reason || 'unknown')))
    }
    window.__T50_CAMERA_REQUESTS__ = 0
    const devices = navigator.mediaDevices
    if (devices && typeof devices.getUserMedia === 'function' && !devices.__t50Wrapped) {
      const original = devices.getUserMedia.bind(devices)
      Object.defineProperty(devices, '__t50Original', { configurable: true, value: original })
      Object.defineProperty(devices, 'getUserMedia', { configurable: true, value: (...args) => { window.__T50_CAMERA_REQUESTS__ += 1; return devices.__t50Failure ? Promise.reject(Object.assign(new Error('Ticket 50 camera denial'), { name: 'NotAllowedError' })) : original(...args) } })
      Object.defineProperty(devices, '__t50Wrapped', { configurable: true, value: true })
    }
    return true
  })()`)
  const setCameraFailure = (on) => evaluate(`(() => { const devices = navigator.mediaDevices; if (devices) devices.__t50Failure = ${on ? 'true' : 'false'}; return true })()`)

  const capture = async (name, source, observation = {}, options = {}) => {
    await sleep(options.settleMs ?? 240)
    const screenshot = await call('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
    const diagnostics = await evaluate(DIAGNOSTICS)
    const axTree = await call('Accessibility.getFullAXTree', { depth: -1 })
    const ax = (axTree.nodes || []).filter((node) => !node.ignored && node.role?.value && node.name?.value).map((node) => ({ role: String(node.role.value), name: String(node.name.value), disabled: node.properties?.find((property) => property.name === 'disabled')?.value?.value ?? false, expanded: node.properties?.find((property) => property.name === 'expanded')?.value?.value ?? null })).slice(0, 1400)
    const newEvents = events.slice(eventCursor); eventCursor = events.length
    const record = { schemaVersion: 1, ticket: 50, checkpoint: name, source, capturedAt: new Date().toISOString(), viewport: currentViewport, observation, diagnostics, ax, cdp: { consoleErrors: newEvents.filter((event) => event.method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(event.params?.type)), runtimeExceptions: newEvents.filter((event) => event.method === 'Runtime.exceptionThrown'), networkFailed: newEvents.filter((event) => event.method === 'Network.loadingFailed').map((event) => ({ errorText: event.params?.errorText || null, requestId: event.params?.requestId || null })) } }
    const checkpointRoot = resolve(OUTPUT_ROOT, device, name)
    await mkdir(checkpointRoot, { recursive: true })
    await Promise.all([
      writeFile(resolve(checkpointRoot, 'screenshot.png'), Buffer.from(screenshot.data, 'base64')),
      writeFile(resolve(checkpointRoot, 'metrics.json'), `${JSON.stringify(record, null, 2)}\n`),
      writeFile(resolve(checkpointRoot, 'accessibility.json'), `${JSON.stringify({ schemaVersion: 1, ticket: 50, checkpoint: name, nodes: ax, limitations: ['Chrome AX tree is a point-in-time snapshot.'] }, null, 2)}\n`),
    ])
    checkpoints.push(record)
    console.log(`Captured ${name}`)
    return record
  }
  const assertSurface = (record) => {
    if (record.diagnostics.overflow.document || record.diagnostics.overflow.body) throw new Error(`Horizontal overflow at ${record.checkpoint}`)
    if (!record.diagnostics.allTargetsAtLeast44) throw new Error(`Touch target below 44px at ${record.checkpoint}`)
    if (record.diagnostics.surfaceCount > 0 && (!record.diagnostics.rootInert || record.diagnostics.rootAriaHidden !== 'true' || record.diagnostics.bodyOverlayOpen !== 'true')) throw new Error(`Overlay ownership contract failed at ${record.checkpoint}`)
  }
  const closeOverlay = async () => {
    if (!(await evaluate('Boolean(document.querySelector("[data-overlay-host]"))'))) return
    await press('Escape')
    await waitFor('!document.querySelector("[data-overlay-host]")', 5_000, 'overlay close')
  }
  const openMore = async () => {
    if (!(await evaluate('Boolean(document.querySelector("#tools-menu-more"))'))) await click('button[aria-label="更多"]')
    await waitFor('Boolean(document.querySelector("#tools-menu-more"))', 5_000, 'More menu')
  }
  const openTool = async (tool, waitSelector) => {
    await openMore()
    await click(`[data-tool="${tool}"]`)
    await waitFor(`Boolean(document.querySelector(${JSON.stringify(waitSelector)}))`, 15_000, `${tool} surface`)
  }
  const navigate = async (extra = '', options = {}) => {
    const url = new URL(`${ORIGIN}/`)
    url.searchParams.set('m24Scenario', SCENARIO)
    url.searchParams.set('ticket50Run', `${Date.now()}-${Math.random().toString(36).slice(2)}`)
    for (const [key, value] of new URLSearchParams(extra)) url.searchParams.set(key, value)
    await call('Page.navigate', { url: url.href })
    await waitFor('document.readyState === "complete"', 20_000, 'app document')
    await waitFor('Boolean(document.querySelector("[data-app-shell]"))', 20_000, 'AppShell')
    if (options.ready !== false) await waitFor('document.querySelector("[data-app-shell]")?.dataset.bootstrapStatus === "ready"', 25_000, 'ready bootstrap')
    if (options.probe !== false) {
      await waitFor('Boolean(window.__MOBIE_M24_BASELINE__?.active)', 20_000, 'baseline driver')
      await installRuntimeProbes()
    }
    if (options.seed !== false) {
      await waitFor('Boolean(window.__MOBIE_M24_BASELINE__?.active)', 20_000, 'baseline driver for seed')
      await installRuntimeProbes()
      await evaluate('(async () => { await window.__MOBIE_M24_BASELINE__.seedContent({ learnedPartnerSkills: [] }); return true })()')
    }
  }
  const reloadReady = async () => {
    await call('Page.reload', { ignoreCache: true })
    await waitFor('document.readyState === "complete"', 20_000, 'reload document')
    await waitFor('document.querySelector("[data-app-shell]")?.dataset.bootstrapStatus === "ready"', 25_000, 'reload bootstrap')
    await waitFor('Boolean(window.__MOBIE_M24_BASELINE__?.active)', 20_000, 'reload driver')
    await installRuntimeProbes()
  }
  const insertReplays = () => evaluate(`(async () => {
    const dbRequest = indexedDB.open('mz-replays', 1)
    dbRequest.onupgradeneeded = () => { const db = dbRequest.result; if (!db.objectStoreNames.contains('replays')) { const store = db.createObjectStore('replays', { keyPath: 'battleId' }); store.createIndex('createdAt', 'createdAt') } }
    const db = await new Promise((resolve, reject) => { dbRequest.onsuccess = () => resolve(dbRequest.result); dbRequest.onerror = () => reject(dbRequest.error) })
    const snapshot = [
      { instanceId: 'player:0', side: 'player', slot: 0, speciesId: 1, displayName: '妙蛙種子', level: 12, maxHp: 40, initialHp: 40, shiny: false },
      { instanceId: 'foe:0', side: 'foe', slot: 0, speciesId: 4, displayName: '小火龍', level: 11, maxHp: 36, initialHp: 36, shiny: false },
    ]
    const ready = { header: { formatVersion: 2, battleId: 'ticket50-ready', battleSeed: 'ticket50-seed', createdAt: 1800000000200, regionId: 'practice', mode: 'arena', outcome: 'win', snapshot }, turns: [{ input: { type: 'ATTACK' }, events: [{ type: 'damageApplied', attackerSide: 'player', attackerIndex: 0, targetSide: 'foe', targetIndex: 0, amount: 36, missed: false, crit: false, effectiveness: 1, effectivenessText: null, hpBefore: 36, hpAfter: 0, maxHp: 36 }, { type: 'memberFainted', side: 'foe', index: 0 }, { type: 'battleEnded', winner: 'player' }] }] }
    const empty = { header: { formatVersion: 2, battleId: 'ticket50-empty', battleSeed: 'ticket50-empty-seed', createdAt: 1800000000100, regionId: 'practice', mode: 'arena', outcome: 'lose', snapshot }, turns: [] }
    const records = [
      { battleId: 'ticket50-ready', createdAt: ready.header.createdAt, regionId: 'practice', mode: 'arena', outcome: 'win', players: ['妙蛙種子'], foes: ['小火龍'], durationMs: 1200, turnCount: 1, eventCount: 3, json: JSON.stringify(ready) },
      { battleId: 'ticket50-empty', createdAt: empty.header.createdAt, regionId: 'practice', mode: 'arena', outcome: 'lose', players: ['妙蛙種子'], foes: ['小火龍'], durationMs: 0, turnCount: 0, eventCount: 0, json: JSON.stringify(empty) },
      { battleId: 'ticket50-broken', createdAt: 1800000000000, regionId: 'practice', mode: 'arena', outcome: 'lose', players: ['未知資料'], foes: [], durationMs: 0, turnCount: 0, eventCount: 1, json: '{broken replay' },
    ]
    await new Promise((resolve, reject) => { const tx = db.transaction('replays', 'readwrite'); records.forEach((record) => tx.objectStore('replays').put(record)); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error) })
    db.close(); return true
  })()`)
  const cardCode = (cardId) => {
    let crc = 0xffff
    const payload = `MZ1:${cardId}`
    for (const char of payload) { crc ^= char.charCodeAt(0) << 8; for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff }
    return `${payload}:${crc.toString(16).toUpperCase().padStart(4, '0')}`
  }
  const setFile = async (selector, name, bytes, type) => {
    const result = await evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); if (!input) return false; const transfer = new DataTransfer(); transfer.items.add(new File([Uint8Array.from(${JSON.stringify(bytes)})], ${JSON.stringify(name)}, { type: ${JSON.stringify(type)} })); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
    if (!result) throw new Error(`File input not found: ${selector}`)
  }
  const portableAudit = (bytes) => {
    const entries = unzipSync(Uint8Array.from(bytes))
    const names = Object.keys(entries).sort()
    const texts = Object.fromEntries(names.map((name) => [name, strFromU8(entries[name])]))
    const forbidden = ['resultSettlements', 'achievementClaims', 'hatchOutbox', 'settlement', 'receipt', 'marker', 'journal', 'diagnostics', 'models/', '.glb', '.gltf']
    return { names, manifest: texts['manifest.json'] ? JSON.parse(texts['manifest.json']) : null, forbidden: forbidden.filter((needle) => Object.values(texts).some((text) => text.includes(needle))) }
  }

  await Promise.all([call('Runtime.enable'), call('Page.enable'), call('Accessibility.enable'), call('Network.enable'), call('Log.enable'), call('Performance.enable')])
  await call('Storage.clearDataForOrigin', { origin: ORIGIN, storageTypes: 'all' })
  await evaluate(`(async () => { localStorage.clear(); if (typeof indexedDB.databases === 'function') for (const database of await indexedDB.databases()) if (database.name && database.name !== 'mz-models') indexedDB.deleteDatabase(database.name); return true })()`)
  await seedModelSentinel()
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const io = { opens: 0, transactions: 0, readonly: 0, readwrite: 0, gets: 0, puts: 0, adds: 0, deletes: 0, clears: 0 }
    window.__T50_MODEL_IO__ = io
    window.__T50_MODEL_IGNORE__ = false
    const open = IDBFactory.prototype.open
    IDBFactory.prototype.open = function(name, ...args) { if (name === 'mz-models' && !window.__T50_MODEL_IGNORE__) io.opens += 1; return open.call(this, name, ...args) }
    const transaction = IDBDatabase.prototype.transaction
    IDBDatabase.prototype.transaction = function(storeNames, mode, ...args) {
      if (this.name === 'mz-models' && !window.__T50_MODEL_IGNORE__) { io.transactions += 1; if (mode === 'readwrite') io.readwrite += 1; else io.readonly += 1 }
      return transaction.call(this, storeNames, mode, ...args)
    }
    for (const method of ['get', 'getAll', 'getAllKeys', 'count']) {
      const original = IDBObjectStore.prototype[method]
      if (!original) continue
      IDBObjectStore.prototype[method] = function(...args) { if (this.transaction?.db?.name === 'mz-models' && !window.__T50_MODEL_IGNORE__) io.gets += 1; return original.apply(this, args) }
    }
    for (const [method, key] of [['put', 'puts'], ['add', 'adds'], ['delete', 'deletes'], ['clear', 'clears']]) {
      const original = IDBObjectStore.prototype[method]
      if (!original) continue
      IDBObjectStore.prototype[method] = function(...args) { if (this.transaction?.db?.name === 'mz-models' && !window.__T50_MODEL_IGNORE__) io[key] += 1; return original.apply(this, args) }
    }
  })()` })
  await setViewport(1180, 820)

  // Cold boot and cached Retry/remount behaviour.
  await navigate('m24BootstrapDelay=3000', { ready: false, seed: false, probe: false })
  await sleep(45)
  const loading = await capture('bootstrap-loading', 'cold boot while canonical stages are delayed', { diagnostics: await evaluate('window.__MOBIE_BOOTSTRAP__?.diagnostics?.() || null') }, { settleMs: 0 })
  if (loading.diagnostics.route !== 'title' || loading.diagnostics.bootstrapStatus !== 'loading' || !await evaluate(`Boolean(document.querySelector('[data-bootstrap-action="start-adventure"]')?.disabled)`)) throw new Error('Cold boot loading gate failed')
  const loadingBefore = await evaluate('window.__MOBIE_BOOTSTRAP__?.diagnostics?.() || null')
  await evaluate('window.__MOBIE_APP_TEST__?.remount(); true')
  await sleep(40)
  const loadingAfter = await evaluate('window.__MOBIE_BOOTSTRAP__?.diagnostics?.() || null')
  if (loadingAfter.attempt !== loadingBefore.attempt || loadingAfter.promiseSerial !== loadingBefore.promiseSerial || JSON.stringify(loadingAfter.stageCalls) !== JSON.stringify(loadingBefore.stageCalls)) throw new Error(`Bootstrap remount was not idempotent: ${JSON.stringify({ loadingBefore, loadingAfter })}`)
  await capture('bootstrap-remount-loading', 'StrictMode/root remount during cached bootstrap', { attempt: loadingAfter.attempt, promiseSerial: loadingAfter.promiseSerial, stageCalls: loadingAfter.stageCalls }, { settleMs: 0 })
  await waitFor('document.querySelector("[data-app-shell]")?.dataset.bootstrapStatus === "ready"', 20_000, 'cold boot ready')
  const ready = await capture('bootstrap-ready', 'cold boot canonical ready state')
  if (ready.diagnostics.route !== 'title' || ready.diagnostics.bootstrapStatus !== 'ready') throw new Error('Cold boot did not reach ready Title')

  await navigate('m24BootstrapFail=meta&m24BootstrapDelay=100', { ready: false, seed: false, probe: false })
  await waitFor('document.querySelector("[data-app-shell]")?.dataset.bootstrapStatus === "partial-error"', 20_000, 'partial bootstrap error')
  const partial = await capture('bootstrap-partial-error', 'meta stage failure with stable Title and Retry')
  if (!partial.diagnostics.bootstrapStatus || !await evaluate(`Boolean(document.querySelector('[data-bootstrap-status="partial-error"] button'))`)) throw new Error('Partial bootstrap error did not expose Retry')
  await openMore()
  const safeMenu = await capture('bootstrap-safe-menu', 'safe More actions while canonical data is unavailable')
  if (!safeMenu.diagnostics.menu?.groups?.includes('資料與設定') || !safeMenu.diagnostics.tools.some((tool) => tool.tool === 'settings' && tool.visible) || !safeMenu.diagnostics.tools.some((tool) => tool.tool === 'library' && tool.disabled)) throw new Error('Partial bootstrap safe action boundary failed')
  await click('button[aria-label="更多"]')
  await evaluate(`window.__MOBIE_BOOTSTRAP_TEST__ = { failStage: null, delayMs: 700 }; document.querySelector('[data-bootstrap-status="partial-error"] button')?.click(); true`)
  await sleep(35)
  const retryLoading = await capture('bootstrap-retry-loading', 'explicit Retry reuses completed stages and exposes loading', {}, { settleMs: 0 })
  if (retryLoading.diagnostics.bootstrapStatus !== 'loading') throw new Error('Bootstrap Retry did not enter loading')
  await waitFor('document.querySelector("[data-app-shell]")?.dataset.bootstrapStatus === "ready"', 20_000, 'Retry ready')
  await capture('bootstrap-retry-ready', 'Retry reaches ready without a second route owner')

  for (const stage of ['roster', 'incubator']) {
    await navigate(`m24BootstrapFail=${stage}&m24BootstrapDelay=80`, { ready: false, seed: false, probe: false })
    await waitFor('document.querySelector("[data-app-shell]")?.dataset.bootstrapStatus === "partial-error"', 20_000, `${stage} partial bootstrap error`)
    const failedStage = await capture(`bootstrap-${stage}-partial-error`, `${stage} stage failure remains on a stable Title with Retry`)
    if (!failedStage.diagnostics.bootstrapStatus || !failedStage.diagnostics.text.includes('重新嘗試')) throw new Error(`${stage} bootstrap failure lost Retry`)
    await evaluate(`(async () => { window.__MOBIE_BOOTSTRAP_TEST__ = { failStage: null, delayMs: 90 }; return await window.__MOBIE_BOOTSTRAP__?.retry?.() })()`)
    await waitFor('document.querySelector("[data-app-shell]")?.dataset.bootstrapStatus === "ready"', 20_000, `${stage} Retry ready`)
    await capture(`bootstrap-${stage}-retry-ready`, `${stage} stage Retry reaches ready exactly once`)
  }

  await waitFor('Boolean(window.__MOBIE_M24_BASELINE__?.active)', 20_000, 'baseline driver before save journal')
  await evaluate('(async () => { await window.__MOBIE_M24_BASELINE__.seedContent({ learnedPartnerSkills: [] }); return true })()')
  const transactionCards = await evaluate(`(${READ_CARD_RECORDS})()`)
  const transactionCardIds = transactionCards.map((card) => card.cardId).sort()
  await evaluate(`(() => {
    const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || 'null') || fallback } catch { return fallback } }
    const rawRoster = read('mobie.roster.v2', [])
    const roster = Array.isArray(rawRoster) ? rawRoster : rawRoster?.roster || []
    const meta = read('mobie.meta.v1', { schemaVersion: 1, profileName: 'trainer', updatedAt: 0, revision: 0 })
    const before = { roster, cards: ${JSON.stringify(transactionCards)}, meta }
    const incoming = { roster: [], cards: [], meta: { ...meta, revision: Number(meta.revision || 0) + 1 } }
    localStorage.setItem('mobie.save.transaction.v1', JSON.stringify({ schemaVersion: 1, status: 'pending', kind: 'import', before, incoming, startedAt: Date.now() }))
    return true
  })()`)
  await navigate('', { ready: true, seed: false })
  const recoveredCardIds = await evaluate(`(async () => (await (${READ_CARD_RECORDS})()).map((card) => card.cardId).sort())()`)
  const transactionRecovery = await capture('bootstrap-save-transaction-recovery', 'cold reload reconciles a pending save journal before exposing canonical stores', { recoveredCardIds })
  if (transactionRecovery.diagnostics.operationStorage['mobie.save.transaction.v1'] !== null || transactionRecovery.diagnostics.bootstrapStatus !== 'ready' || JSON.stringify(recoveredCardIds) !== JSON.stringify(transactionCardIds)) throw new Error(`Pending save transaction did not preserve canonical cards: ${JSON.stringify({ transactionCardIds, recoveredCardIds })}`)

  // Route authority and root overlay owner.
  const routeBeforeStart = await evaluate('JSON.stringify(window.__MOBIE_ROUTE_EVENTS__ || { total: 0, byType: {} })')
  await click('button[aria-label="開始冒險"]')
  await waitFor('document.querySelector("[data-app-shell]")?.dataset.route === "regionSelect"', 10_000, 'Region Select')
  await evaluate('window.__MOBIE_APP_TEST__?.remount(); true')
  await waitFor('document.querySelector("[data-app-shell]")?.dataset.route === "regionSelect"', 5_000, 'route after remount')
  const routeRemount = await capture('route-remount', 'START route handoff survives root remount')
  const routeAfterStart = await evaluate('JSON.stringify(window.__MOBIE_ROUTE_EVENTS__ || { total: 0, byType: {} })')
  const routeEvents = JSON.parse(routeAfterStart)
  if (routeBeforeStart === routeAfterStart || routeRemount.diagnostics.route !== 'regionSelect' || routeEvents.total !== 1 || routeEvents.byType?.START !== 1) throw new Error(`START route dispatch was not exactly once: ${routeAfterStart}`)
  // More, Settings, persistence and the one overlay host.
  await navigate('', { ready: true, seed: true })
  await openMore()
  const more = await capture('more-menu', 'Title More groups and semantic tool handoff')
  if (!more.diagnostics.menu?.groups?.includes('成長與收藏') || !more.diagnostics.menu?.groups?.includes('資料與設定') || more.diagnostics.scannerChunkLoaded || more.diagnostics.cameraRequests !== 0 || more.diagnostics.tools.some((tool) => tool.tool === 'scanner' && tool.visible)) throw new Error('Scanner-off More boundary failed')
  await click('[data-tool="settings"]')
  await waitFor('Boolean(document.querySelector("[data-settings]"))', 12_000, 'Settings')
  const settingsOpen = await capture('settings-open', 'More→Settings single portal, inert root and focus entry')
  if (settingsOpen.diagnostics.surfaceCount !== 1 || !settingsOpen.diagnostics.rootInert || !settingsOpen.diagnostics.active.insideSurface) throw new Error('Settings overlay contract failed')
  const focusCount = await evaluate(`document.querySelectorAll('[data-modal-surface] button:not([disabled]), [data-modal-surface] input:not([disabled]), [data-modal-surface] [role="button"]:not([aria-disabled="true"])').length`)
  if (focusCount < 4) throw new Error('Settings did not expose keyboard controls')
  for (let index = 0; index < focusCount + 1; index += 1) await nativeKey('Tab')
  if (!await evaluate('Boolean(document.querySelector("[data-modal-surface]")?.contains(document.activeElement))')) throw new Error('Settings focus escaped surface')
  await click('[data-settings-preference="recordReplays"]')
  await click('[data-settings-preference="graphicsPreference"][data-settings-value="high"]')
  await click('[data-settings-preference="enhancedInteractivity"][data-settings-value="lite"]')
  const settingsMutated = await capture('settings-mutated', 'v2 preferences use real semantic controls')
  if (settingsMutated.diagnostics.settings?.replay !== 'true' || settingsMutated.diagnostics.settings?.schema !== 2) throw new Error('Settings v2 mutation did not persist live state')
  await closeOverlay()
  await reloadReady()
  await openTool('settings', '[data-settings]')
  const settingsReloaded = await capture('settings-reloaded', 'settings v2 survives reload')
  if (settingsReloaded.diagnostics.settings?.replay !== 'true' || !await evaluate(`Boolean(document.querySelector('[data-settings-preference="graphicsPreference"][data-settings-value="high"].interact-seg__btn--on'))`)) throw new Error('Settings persistence failed')
  if (settingsReloaded.diagnostics.prohibited.length > 0 || settingsReloaded.diagnostics.settings.fixedRows.some((row) => /synergy|held|ability|chain|combo|evolution|partner|encounter/i.test(row))) throw new Error(`Settings exposed retired feature rows: ${JSON.stringify(settingsReloaded.diagnostics.settings)}`)
  if (settingsReloaded.diagnostics.bodyOverflow !== 'hidden' || settingsReloaded.diagnostics.rootAriaHidden !== 'true') throw new Error('Settings did not lock the underlying page')
  await evaluate(`(() => { const backdrop = document.querySelector('[data-modal-backdrop]'); backdrop?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); return true })()`)
  await waitFor('!document.querySelector("[data-overlay-host]")', 5_000, 'Settings backdrop close')
  await waitFor(`Boolean(document.activeElement?.matches('button[aria-label="更多"]'))`, 5_000, 'Settings backdrop focus restore')
  await capture('settings-backdrop-restore', 'backdrop policy closes Settings and restores body scroll/focus')
  await openTool('settings', '[data-settings]')
  await evaluate('document.querySelector("[data-modal-close]")?.focus(); true')
  await closeOverlay()
  await waitFor(`Boolean(document.activeElement?.matches('button[aria-label="更多"]'))`, 5_000, 'Settings More focus restore')

  // Card Library, QR/detail stack, malformed import and confirmation delete.
  await reloadReady()
  await evaluate(`(() => { window.__T50_CARD_IDB_OPEN_ORIGINAL__ = indexedDB.open; Object.defineProperty(indexedDB, 'open', { configurable: true, value: () => { throw new Error('Ticket 50 card storage probe') } }); return true })()`)
  await openTool('library', '[data-card-library]')
  await waitFor('Boolean(document.querySelector("[data-card-library-error]"))', 8_000, 'card storage error')
  const cardStorageFailure = await capture('card-storage-failure', 'Card Library IndexedDB failure exposes retry without blanking the route')
  if (!cardStorageFailure.diagnostics.cardLibrary?.importError && !cardStorageFailure.diagnostics.text.includes('卡庫暫時無法載入')) throw new Error('Card storage failure lost safe recovery')
  await evaluate('Object.defineProperty(indexedDB, "open", { configurable: true, value: window.__T50_CARD_IDB_OPEN_ORIGINAL__ }); true')
  await closeOverlay()
  await reloadReady()
  await openTool('library', '[data-card-library]')
  await waitFor('document.querySelector("[data-card-library]")?.dataset.cardLibraryState === "ready"', 15_000, 'Card Library ready')
  const library = await capture('card-library-ready', 'real IndexedDB card library')
  if (!library.diagnostics.cardLibrary?.rows) throw new Error('Card Library did not read canonical cards')
  await evaluate(`(() => { const image = document.querySelector('[data-card-row] [data-artwork-state] img'); if (!image) return false; image.src = '/__ticket50__/missing-card-artwork.png'; return true })()`)
  await waitFor(`Boolean(document.querySelector('[data-card-row] [data-artwork-state="failed"]'))`, 8_000, 'card artwork fallback')
  await capture('card-artwork-fallback', 'Card Library artwork failure keeps a fixed accessible slot', { expectedNetworkPath: '/__ticket50__/' })
  await click('[data-card-library-create]')
  await waitFor('Boolean(document.querySelector("[data-card-library-add-panel]"))', 8_000, 'card create panel')
  await click('[data-card-library-species="1"]')
  await waitFor(`Boolean(document.querySelector('[data-card-row][data-card-id^="SELF-"]'))`, 10_000, 'created card row')
  const cardId = await evaluate(`document.querySelector('[data-card-row][data-card-id^="SELF-"]')?.dataset.cardId || null`)
  if (!cardId) throw new Error('Card Library has no card row')
  await click(`[data-card-detail-invoker="${cardId}"]`)
  await waitFor('Boolean(document.querySelector("[data-card-detail]"))', 10_000, 'card detail')
  await click('[data-card-detail-qr]')
  await waitFor('Boolean(document.querySelector("[data-card-qr]"))', 10_000, 'card QR')
  const cardQr = await capture('card-qr-stack', 'Card detail→QR nested OverlayController stack')
  if (cardQr.diagnostics.overlayDepth !== 3 || cardQr.diagnostics.surfaceCount !== 1) throw new Error(`Card overlay stack contract failed: ${JSON.stringify(cardQr.diagnostics.overlay)}`)
  await press('Escape'); await waitFor('Boolean(document.querySelector("[data-card-detail]"))', 5_000, 'QR pop')
  await press('Escape'); await waitFor('Boolean(document.querySelector("[data-card-library]"))', 5_000, 'detail pop')
  await waitFor(`Boolean(document.activeElement?.matches('[data-card-detail-invoker="${cardId}"]'))`, 5_000, 'card detail invoker focus restore')
  await click(`[data-card-library-import]`)
  await setInput('[data-card-import-input]', '{malformed')
  await click('[data-card-import-submit]')
  await waitFor('Boolean(document.querySelector("[data-card-import-error]"))', 8_000, 'card import error')
  const cardImportError = await capture('card-import-error', 'malformed card import remains recoverable')
  if (!cardImportError.diagnostics.cardLibrary?.importError) throw new Error('Malformed card import did not expose error')
  await click(`[data-card-delete="${cardId}"]`)
  await waitFor('Boolean(document.querySelector("[data-card-delete-dialog]"))', 8_000, 'card delete confirmation')
  await press('Escape'); await waitFor('!document.querySelector("[data-card-delete-dialog]")', 5_000, 'delete cancel')
  await click(`[data-card-delete="${cardId}"]`)
  await waitFor('Boolean(document.querySelector("[data-card-delete-dialog]"))', 8_000, 'card delete confirmation retry')
  await click('[data-card-delete-confirm]')
  await waitFor(`!document.querySelector('[data-card-row][data-card-id="${cardId}"]')`, 10_000, 'card delete')
  const cardDeleted = await capture('card-delete-confirmed', 'card delete only after explicit confirmation')
  if (cardDeleted.diagnostics.cardLibrary?.deleteDialog || cardDeleted.diagnostics.surfaceCount !== 1) throw new Error('Card delete did not return to library surface')
  await closeOverlay()
  await reloadReady()
  await openTool('library', '[data-card-library]')
  await waitFor(`!document.querySelector('[data-card-row][data-card-id="${cardId}"]')`, 10_000, 'card delete persists after reload')
  await capture('card-delete-reloaded', 'Card Library deletion survives a fresh canonical reload', { deletedCardId: cardId })
  await closeOverlay()

  // Scanner off → explicit on → denied/manual/invalid/duplicate/success.
  await openTool('settings', '[data-settings]')
  await click('[data-settings-preference="scannerEnabled"]')
  await closeOverlay()
  await reloadReady()
  await openMore()
  const scannerEntry = await capture('scanner-on-entry', 'scanner becomes visible only after explicit Settings enable')
  if (!scannerEntry.diagnostics.tools.some((tool) => tool.tool === 'scanner' && tool.visible) || scannerEntry.diagnostics.cameraRequests !== 0) throw new Error('Scanner on entry requested camera permission early')
  await click('[data-tool="scanner"]')
  await waitFor('document.querySelector("[data-scanner]")?.dataset.scannerState === "starting"', 10_000, 'scanner starting')
  const scannerStarting = await capture('scanner-starting', 'scanner lazy chunk loads only after explicit action')
  if (!scannerStarting.diagnostics.scanner?.permissionAction || scannerStarting.diagnostics.cameraRequests !== 0 || !scannerStarting.diagnostics.scannerChunkLoaded) throw new Error('Scanner starting capability contract failed')
  await setCameraFailure(true)
  await click('[data-scan-camera]')
  await waitFor('document.querySelector("[data-scanner]")?.dataset.scannerState === "denied"', 8_000, 'scanner denied')
  const scannerDenied = await capture('scanner-denied', 'camera permission denial has a manual fallback')
  if (!scannerDenied.diagnostics.scanner?.manualAction || scannerDenied.diagnostics.cameraRequests < 1) throw new Error('Scanner denied state missing recovery')
  await click('[data-scan-manual]')
  await setInput('[data-scan-manual-input]', 'not-a-card-code')
  await click('[data-scan-submit]')
  await waitFor('document.querySelector("[data-scan-result]")?.dataset.scanResult === "invalid"', 8_000, 'invalid scanner payload')
  await capture('scanner-invalid', 'malformed card code is recoverable')
  const validCode = cardCode('M24-BASELINE-25')
  await click('[data-scan-result-manual]')
  await setInput('[data-scan-manual-input]', validCode)
  const rosterBeforeScan = (await readStorage('mobie.roster.v2'))
  const rosterBeforeCount = Array.isArray(rosterBeforeScan) ? rosterBeforeScan.length : rosterBeforeScan?.roster?.length ?? 0
  await click('[data-scan-submit]')
  await waitFor('document.querySelector("[data-scan-result]")?.dataset.scanResult === "success" || document.querySelector("[data-scan-result]")?.dataset.scanResult === "duplicate"', 10_000, 'valid scanner payload')
  const scannerSuccess = await capture('scanner-success', 'valid manual code crosses the canonical capture boundary')
  const rosterAfterScan = await readStorage('mobie.roster.v2')
  const rosterAfterCount = Array.isArray(rosterAfterScan) ? rosterAfterScan.length : rosterAfterScan?.roster?.length ?? 0
  if (scannerSuccess.diagnostics.scanner?.result !== 'success' || rosterAfterCount !== rosterBeforeCount + 1) throw new Error(`Scanner success did not create one canonical unit: ${JSON.stringify({ rosterBeforeCount, rosterAfterCount })}`)
  await click('[data-scan-rescan]')
  await setInput('[data-scan-manual-input]', validCode)
  await click('[data-scan-submit]')
  await waitFor('document.querySelector("[data-scan-result]")?.dataset.scanResult === "duplicate"', 10_000, 'duplicate scanner payload')
  const scannerDuplicate = await capture('scanner-duplicate', 'duplicate card code does not mutate roster twice')
  const rosterDuplicate = await readStorage('mobie.roster.v2')
  const rosterDuplicateCount = Array.isArray(rosterDuplicate) ? rosterDuplicate.length : rosterDuplicate?.roster?.length ?? 0
  if (rosterDuplicateCount !== rosterAfterCount || scannerDuplicate.diagnostics.scanner?.result !== 'duplicate') throw new Error('Duplicate scanner flow mutated canonical roster')
  await closeOverlay()
  await openTool('scanner', '[data-scanner]')
  await evaluate(`(() => { window.__T50_MEDIA_DEVICES__ = navigator.mediaDevices; Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined }); return true })()`)
  await click('[data-scan-camera]')
  await waitFor('document.querySelector("[data-scanner]")?.dataset.scannerState === "unsupported"', 8_000, 'scanner unsupported')
  const scannerUnsupported = await capture('scanner-unsupported', 'unknown camera capability has a manual recovery')
  if (!scannerUnsupported.diagnostics.scanner?.manualAction) throw new Error('Unsupported scanner capability lost manual recovery')
  await evaluate(`(() => { if (window.__T50_MEDIA_DEVICES__) Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: window.__T50_MEDIA_DEVICES__ }); delete window.__T50_MEDIA_DEVICES__; return true })()`)
  await click('[data-scan-back]')
  await waitFor('document.querySelector("[data-overlay-host]")?.dataset.overlayId === "library"', 8_000, 'scanner back to library')
  const scannerBack = await capture('scanner-back-library', 'scanner back action replaces the root overlay and preserves scroll lock')
  if (scannerBack.diagnostics.overlayDepth !== 1 || scannerBack.diagnostics.surfaceCount !== 1) throw new Error('Scanner back created a second overlay owner')
  await closeOverlay()
  await waitFor(`Boolean(document.activeElement?.matches('button[aria-label="更多"]'))`, 5_000, 'scanner back focus restore')

  // Save Manager export/import/restore, portable audit, share fallback and all operation guards.
  await openTool('save', '[data-save-export]')
  await waitFor('Boolean(document.querySelector("[data-save-export]"))', 8_000, 'Save Manager')
  await evaluate(`(() => { const nav = navigator; window.__T50_ORIGINAL_SHARE__ = nav.share; window.__T50_ORIGINAL_CAN_SHARE__ = nav.canShare; window.__T50_SHARED_SAVE_BYTES__ = null; Object.defineProperty(nav, 'canShare', { configurable: true, value: () => true }); Object.defineProperty(nav, 'share', { configurable: true, value: async ({ files }) => { window.__T50_SHARED_SAVE_BYTES__ = Array.from(new Uint8Array(await files[0].arrayBuffer())); } }); return true })()`)
  await click('[data-save-export]')
  await waitFor('Array.isArray(window.__T50_SHARED_SAVE_BYTES__) && window.__T50_SHARED_SAVE_BYTES__.length > 0', 15_000, 'shared save bytes')
  const sharedBytes = await evaluate('window.__T50_SHARED_SAVE_BYTES__')
  const portable = portableAudit(sharedBytes)
  await capture('save-export-portable', 'share path exports canonical no-model portable payload', { portable })
  if (portable.names.join('|') !== 'cards.json|manifest.json|roster.json' || portable.manifest?.includesModels !== false || portable.forbidden.length > 0) throw new Error(`Portable payload audit failed: ${JSON.stringify(portable)}`)
  await evaluate(`(() => { window.__T50_RELEASE_SHARE__ = null; Object.defineProperty(navigator, 'share', { configurable: true, value: () => new Promise((resolve) => { window.__T50_RELEASE_SHARE__ = resolve }) }); return true })()`)
  await click('[data-save-export]')
  await sleep(80)
  const saveBusy = await capture('save-export-busy', 'settlement-safe save command stays disabled while share is pending', { busy: await evaluate('Boolean(document.querySelector("[data-save-export]")?.disabled)') })
  if (!saveBusy.diagnostics.save?.exportDisabled || !saveBusy.diagnostics.save?.importDisabled || !saveBusy.diagnostics.save?.backupDisabled) throw new Error('Save busy controls were not disabled')
  await evaluate('window.__T50_RELEASE_SHARE__?.(); true')
  await sleep(160)
  await evaluate(`(() => { if (window.__T50_ORIGINAL_SHARE__) Object.defineProperty(navigator, 'share', { configurable: true, value: window.__T50_ORIGINAL_SHARE__ }); else delete navigator.share; if (window.__T50_ORIGINAL_CAN_SHARE__) Object.defineProperty(navigator, 'canShare', { configurable: true, value: window.__T50_ORIGINAL_CAN_SHARE__ }); else delete navigator.canShare; return true })()`)
  await evaluate(`(() => { window.__T50_SAVE_FALLBACK_URL__ = URL.createObjectURL; window.__T50_SAVE_FALLBACK_CLIPBOARD__ = navigator.clipboard?.writeText; window.__T50_SAVE_FALLBACK_EXEC__ = document.execCommand; window.__T50_SAVE_FALLBACK_SHARE__ = navigator.share; Object.defineProperty(navigator, 'share', { configurable: true, value: () => Promise.reject(new Error('Ticket 50 share blocked')) }); Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => { throw new Error('Ticket 50 save download blocked') } }); if (navigator.clipboard) Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: () => Promise.reject(new Error('Ticket 50 save clipboard blocked')) }); Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false }); return true })()`)
  await click('[data-save-export]')
  await waitFor('Boolean(document.querySelector("[data-save-recovery]"))', 10_000, 'save manual recovery fallback')
  const saveDeliveryFallback = await capture('save-delivery-fallback', 'share and download failure exposes a manual portable recovery code')
  if (!saveDeliveryFallback.diagnostics.text.includes('手動保存復原碼')) throw new Error('Save delivery fallback did not expose manual recovery')
  await evaluate(`(() => { Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: window.__T50_SAVE_FALLBACK_URL__ }); if (navigator.clipboard && window.__T50_SAVE_FALLBACK_CLIPBOARD__) Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: window.__T50_SAVE_FALLBACK_CLIPBOARD__ }); if (window.__T50_SAVE_FALLBACK_EXEC__) Object.defineProperty(document, 'execCommand', { configurable: true, value: window.__T50_SAVE_FALLBACK_EXEC__ }); if (window.__T50_SAVE_FALLBACK_SHARE__) Object.defineProperty(navigator, 'share', { configurable: true, value: window.__T50_SAVE_FALLBACK_SHARE__ }); else delete navigator.share; return true })()`)
  await setFile('[data-save-import-trigger] + input, input[type="file"][accept*=".save"]', 'malformed.save', [1, 2, 3, 4], 'application/zip')
  await waitFor('Boolean(document.querySelector(".lib-msg"))', 10_000, 'malformed save error')
  await capture('save-import-error', 'malformed save remains recoverable')
  const olderBytes = await evaluate('window.__MOBIE_M24_BASELINE__.makeOlderSave()')
  await setFile('input[type="file"][accept*=".save"]', 'older.save', olderBytes, 'application/zip')
  await waitFor('Boolean(document.querySelector(".save-compare"))', 15_000, 'older save comparison')
  const saveOlder = await capture('save-compare-older', 'older legacy save requires explicit consent and ignores model bytes')
  if (!saveOlder.diagnostics.text.includes('舊版存檔含') || !saveOlder.diagnostics.save) throw new Error('Older save comparison did not render')
  await click('label:has(input[type="checkbox"])')
  await click('[data-save-import-confirm]')
  await waitFor('Boolean(document.body.innerText.includes("已匯入存檔"))', 15_000, 'save import complete')
  await waitFor('Boolean(document.querySelector("[data-save-restore]"))', 15_000, 'save backup ready')
  await click('[data-save-restore]')
  await waitFor('Boolean(document.body.innerText.includes("已還原匯入前的備份"))', 15_000, 'save restore complete')
  await capture('save-restore', 'atomic backup restore returns canonical save state')

  const guardFixtures = [
    ['result', 'mobie.result.settlement.v1', [{ status: 'pending', resultId: 'ticket50-result' }]],
    ['achievement', 'mobie.meta.v1', { ...(await readStorage('mobie.meta.v1') || {}), achievementClaims: [{ status: 'pending', achievementId: 'ticket50-achievement' }] }],
    ['hatch', 'mobie.incubator.v1', { ...(await readStorage('mobie.incubator.v1') || {}), hatchOutbox: [{ status: 'pending', eggId: 'ticket50-hatch' }] }],
  ]
  for (const [name, key, value] of guardFixtures) {
    await setStorage(key, value)
    await waitFor('Boolean(document.querySelector("[data-save-operation-gate]"))', 5_000, `${name} save guard`)
    const commandGuard = await evaluate(`(() => Object.fromEntries(['匯出', '匯入', '還原'].map((action) => { try { window.__MOBIE_SAVE_GUARD__?.assertIdle(action); return [action, { blocked: false, message: null }] } catch (error) { return [action, { blocked: true, message: String(error?.message || error) }] } })))()`)
    const record = await capture(`save-guard-${name}`, `save commands blocked by pending ${name} operation`, { key, commandGuard })
    if (!record.diagnostics.save?.exportDisabled || !record.diagnostics.save?.importDisabled || !record.diagnostics.save?.backupDisabled || !record.diagnostics.save?.restoreDisabled) throw new Error(`${name} save guard did not disable every command`)
    if (Object.values(commandGuard).some((result) => !result.blocked)) throw new Error(`${name} command guard allowed a pending save operation: ${JSON.stringify(commandGuard)}`)
    if (name === 'result') await removeStorage(key)
    else if (name === 'achievement') await setStorage(key, { ...(await readStorage(key) || {}), achievementClaims: [{ status: 'settled' }] })
    else await setStorage(key, { ...(await readStorage(key) || {}), hatchOutbox: [{ status: 'settled' }] })
    await waitFor('!document.querySelector("[data-save-operation-gate]")', 5_000, `${name} save guard release`)
  }
  await evaluate(`(() => { window.__T50_SAVE_GET_ORIGINAL__ = Storage.prototype.getItem; Storage.prototype.getItem = function(key) { if (key === 'mobie.result.settlement.v1') throw new Error('Ticket 50 storage probe'); return window.__T50_SAVE_GET_ORIGINAL__.call(this, key) }; window.dispatchEvent(new StorageEvent('storage', { key: 'mobie.result.settlement.v1' })); return true })()`)
  await waitFor('Boolean(document.querySelector("[data-save-operation-gate]"))', 5_000, 'save storage failure gate')
  const saveStorageFailure = await capture('save-storage-failure', 'unknown operation storage fails closed with a safe action')
  if (!saveStorageFailure.diagnostics.save?.exportDisabled || !saveStorageFailure.diagnostics.save?.gate?.includes('無法確認')) throw new Error('Save storage failure did not fail closed')
  await evaluate('Storage.prototype.getItem = window.__T50_SAVE_GET_ORIGINAL__; delete window.__T50_SAVE_GET_ORIGINAL__; true')
  await removeStorage('mobie.result.settlement.v1')
  await removeStorage('mobie.meta.v1')
  await removeStorage('mobie.incubator.v1')
  await closeOverlay()

  // Replay list/player event-only projection, malformed row, export fallback, delete and reload.
  await insertReplays()
  await openTool('replays', '[data-replay-list]')
  await waitFor('document.querySelector("[data-replay-list]")?.dataset.replayListState === "partial"', 15_000, 'Replay partial list')
  const replayList = await capture('replay-list-partial', 'real replay metadata with empty and decode-error rows')
  if (replayList.diagnostics.replay.rows < 3 || replayList.diagnostics.replay.decodeErrors < 1) throw new Error('Replay list did not classify malformed data')
  const canonicalBeforeReplay = await canonicalState()
  await click('[data-replay-play="ticket50-ready"]')
  await waitFor('Boolean(document.querySelector("[data-replay-player]"))', 12_000, 'Replay Player')
  await click('[data-replay-toggle]')
  await click('[data-replay-step-forward]')
  await click('[data-replay-speed-option="2"]')
  await press('ArrowRight')
  const replayPlayer = await capture('replay-player-projection', 'event-only player transport and projection controls')
  if (!replayPlayer.diagnostics.replay.playerState || replayPlayer.diagnostics.replay.cursor < 1) throw new Error('Replay player did not advance event cursor')
  await click('[data-replay-restart]')
  await click('[data-replay-exit]')
  await waitFor('Boolean(document.querySelector("[data-replay-list]"))', 8_000, 'Replay list after player')
  const canonicalAfterReplay = await canonicalState()
  if (canonicalAfterReplay !== canonicalBeforeReplay) throw new Error('Replay playback mutated canonical state')
  await evaluate(`(() => { window.__T50_REPLAY_ORIGINAL_URL__ = URL.createObjectURL; window.__T50_REPLAY_ORIGINAL_CLIPBOARD__ = navigator.clipboard?.writeText; Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => { throw new Error('Ticket 50 download blocked') } }); if (navigator.clipboard) Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: () => Promise.reject(new Error('Ticket 50 clipboard blocked')) }); return true })()`)
  await click('[data-replay-export="ticket50-ready"]')
  await waitFor('Boolean(document.querySelector("[data-replay-manual]"))', 8_000, 'Replay manual export fallback')
  await capture('replay-export-fallback', 'download failure exposes manual report fallback')
  await evaluate('Object.defineProperty(URL, "createObjectURL", { configurable: true, value: window.__T50_REPLAY_ORIGINAL_URL__ }); if (navigator.clipboard && window.__T50_REPLAY_ORIGINAL_CLIPBOARD__) Object.defineProperty(navigator.clipboard, "writeText", { configurable: true, value: window.__T50_REPLAY_ORIGINAL_CLIPBOARD__ }); true')
  await click('[data-replay-delete="ticket50-broken"]')
  await waitFor('Boolean(document.querySelector("[data-replay-delete-dialog]"))', 8_000, 'Replay delete confirmation')
  await press('Escape'); await waitFor('!document.querySelector("[data-replay-delete-dialog]")', 5_000, 'Replay delete cancel')
  await click('[data-replay-delete="ticket50-broken"]'); await waitFor('Boolean(document.querySelector("[data-replay-delete-dialog]"))', 8_000, 'Replay delete confirmation retry')
  await click('[data-replay-delete-confirm]'); await waitFor(`!document.querySelector('[data-replay-row][data-replay-id="ticket50-broken"]')`, 10_000, 'Replay delete')
  await capture('replay-delete-confirmed', 'replay delete requires explicit confirmation and returns focus')
  await waitFor('Boolean(document.activeElement?.matches("[data-replay-delete]") || document.activeElement?.matches("[data-replay-refresh]"))', 5_000, 'replay delete focus restore')
  await closeOverlay()
  await reloadReady()
  await openTool('replays', '[data-replay-list]')
  await waitFor(`!document.querySelector('[data-replay-row][data-replay-id="ticket50-broken"]')`, 12_000, 'replay delete persists')
  const replayReload = await capture('replay-reloaded', 'replay list reload preserves valid/empty records')
  if (replayReload.diagnostics.replay.rows < 2) throw new Error('Replay reload lost canonical records')
  await closeOverlay()
  await reloadReady()
  await evaluate(`(() => { window.__T50_IDB_OPEN_ORIGINAL__ = indexedDB.open; Object.defineProperty(indexedDB, 'open', { configurable: true, value: () => { throw new Error('Ticket 50 replay storage probe') } }); return true })()`)
  await openTool('replays', '[data-replay-list]')
  await waitFor('Boolean(document.querySelector("[data-replay-storage-error]"))', 8_000, 'replay storage error')
  const replayStorageFailure = await capture('replay-storage-failure', 'replay IndexedDB failure exposes retry without a blank surface')
  if (!replayStorageFailure.diagnostics.replay.listState || !replayStorageFailure.diagnostics.text.includes('儲存空間')) throw new Error('Replay storage failure lost safe recovery')
  await evaluate('Object.defineProperty(indexedDB, "open", { configurable: true, value: window.__T50_IDB_OPEN_ORIGINAL__ }); true')
  await closeOverlay()
  await reloadReady()

  await call('Network.setCacheDisabled', { cacheDisabled: true })
  await call('Network.setBlockedURLs', { urls: ['*CardLibraryModal*'] })
  await openMore()
  await click('[data-tool="library"]')
  await waitFor('Boolean(document.querySelector("[data-overlay-chunk-error]"))', 12_000, 'blocked library lazy chunk')
  const lazyChunkFailure = await capture('lazy-chunk-error', 'blocked lazy tool chunk leaves a recoverable overlay')
  if (lazyChunkFailure.diagnostics.overlayDepth !== 1 || !lazyChunkFailure.diagnostics.text.includes('暫時無法載入')) throw new Error('Lazy chunk failure did not expose a safe overlay action')
  await click('[data-overlay-chunk-close]')
  await waitFor('!document.querySelector("[data-overlay-host]")', 5_000, 'lazy chunk close')
  await call('Network.setBlockedURLs', { urls: [] })
  await call('Network.setCacheDisabled', { cacheDisabled: false })
  await reloadReady()

  // Five viewports, 200% zoom, safe-area variables, keyboard and long content.
  for (const viewport of VIEWPORTS) {
    await setViewport(viewport.width, viewport.height)
    const reduced = viewport.id === 'short-landscape'
    await call('Emulation.setEmulatedMedia', { features: reduced ? [{ name: 'prefers-reduced-motion', value: 'reduce' }] : [] })
    await openTool('settings', '[data-settings]')
    await evaluate(`(() => { document.documentElement.style.setProperty('--safe-t', '24px'); document.documentElement.style.setProperty('--safe-r', '18px'); document.documentElement.style.setProperty('--safe-b', '32px'); document.documentElement.style.setProperty('--safe-l', '18px'); const legend = document.querySelector('[data-settings] .settings-shell__legend'); if (legend) legend.textContent = 'Ticket 50 long settings content '.repeat(14); return true })()`)
    const settingsMatrix = await capture(`matrix-${viewport.id}-settings`, 'five viewport Settings/AX/safe-area matrix', { viewport, reducedMotion: reduced, nativeKeyboard: true })
    assertSurface(settingsMatrix); matrix.push({ viewport: viewport.id, surface: 'settings', diagnostics: settingsMatrix.diagnostics })
    await closeOverlay()
    await openTool('library', '[data-card-library]')
    const libraryMatrix = await capture(`matrix-${viewport.id}-cards`, 'five viewport Card Library matrix', { viewport })
    assertSurface(libraryMatrix); matrix.push({ viewport: viewport.id, surface: 'cards', diagnostics: libraryMatrix.diagnostics })
    await closeOverlay()
    await openTool('save', '[data-save-export]')
    const saveMatrix = await capture(`matrix-${viewport.id}-save`, 'five viewport Save Manager matrix', { viewport })
    assertSurface(saveMatrix); matrix.push({ viewport: viewport.id, surface: 'save', diagnostics: saveMatrix.diagnostics })
    await closeOverlay()
    await openTool('replays', '[data-replay-list]')
    const replayMatrix = await capture(`matrix-${viewport.id}-replays`, 'five viewport Replay List matrix', { viewport })
    assertSurface(replayMatrix); matrix.push({ viewport: viewport.id, surface: 'replays', diagnostics: replayMatrix.diagnostics })
    await closeOverlay()
    await call('Emulation.setPageScaleFactor', { pageScaleFactor: 2 })
    await sleep(120)
    await openTool('settings', '[data-settings]')
    const zoomMatrix = await capture(`matrix-${viewport.id}-settings-200`, '200% Settings zoom matrix', { viewport, scale: 2 })
    assertSurface(zoomMatrix); matrix.push({ viewport: viewport.id, surface: 'settings-200', diagnostics: zoomMatrix.diagnostics })
    await closeOverlay()
    await call('Emulation.setPageScaleFactor', { pageScaleFactor: 1 })
    await evaluate("document.documentElement.style.removeProperty('--safe-t'); document.documentElement.style.removeProperty('--safe-r'); document.documentElement.style.removeProperty('--safe-b'); document.documentElement.style.removeProperty('--safe-l'); true")
  }

  await setViewport(1180, 820)
  await call('Emulation.setEmulatedMedia', { features: [] })
  const finalDiagnostics = await evaluate(DIAGNOSTICS)
  const modelSentinel = await readModelSentinel()
  const buildGraph = await productionBuildGraph()
  const unhandled = await evaluate('window.__T50_UNHANDLED__ || []')
  const expectedLazyError = (event) => event.method === 'Runtime.exceptionThrown' && String(event.params?.exceptionDetails?.exception?.description || '').includes('Failed to fetch dynamically imported module')
  const expectedLazyConsole = (event) => event.method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(event.params?.type) && String(event.params?.args?.[0]?.value || '').includes('OverlayChunkBoundary')
  const runtimeErrors = events.filter((event) => event.method === 'Runtime.exceptionThrown' && !expectedLazyError(event))
  const consoleErrors = events.filter((event) => event.method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(event.params?.type) && !expectedLazyConsole(event))
  const expectedLazyFailures = events.filter((event) => expectedLazyError(event) || expectedLazyConsole(event))
  const networkFailed = events.filter((event) => event.method === 'Network.loadingFailed')
  const evidence = {
    schemaVersion: 1, ticket: 50, scenario: SCENARIO, capturedAt: new Date().toISOString(), checkpoints, matrix,
    modelPolicy: { database: 'mz-models', sentinel: modelSentinel, untouched: JSON.stringify(modelSentinel) === JSON.stringify({ id: 'ticket50-sentinel', payload: 'untouched' }), resources: finalDiagnostics.modelResources, databases: finalDiagnostics.modelDatabases, io: finalDiagnostics.modelIo, buildGraph },
    errors: { console: consoleErrors, runtime: runtimeErrors, networkFailed, unhandled, expectedLazyFailures },
    assertions: {
      coldBootIdempotent: checkpoints.some((item) => item.checkpoint === 'bootstrap-remount-loading') && checkpoints.some((item) => item.checkpoint === 'bootstrap-retry-ready'),
      bootstrapStageFailures: ['roster', 'incubator'].every((stage) => checkpoints.some((item) => item.checkpoint === `bootstrap-${stage}-partial-error`) && checkpoints.some((item) => item.checkpoint === `bootstrap-${stage}-retry-ready`)),
      saveTransactionRecovery: checkpoints.some((item) => item.checkpoint === 'bootstrap-save-transaction-recovery'),
      overlaySingleOwner: checkpoints.filter((item) => item.diagnostics.surfaceCount > 0).every((item) => item.diagnostics.surfaceCount === 1 && item.diagnostics.overlayHostCount === 1 && item.diagnostics.overlayDepth >= 1),
      scannerOffZeroIOLazyPermission: checkpoints.some((item) => item.checkpoint === 'more-menu' && !item.diagnostics.scannerChunkLoaded && item.diagnostics.cameraRequests === 0 && !item.diagnostics.tools.some((tool) => tool.tool === 'scanner' && tool.visible)),
      scannerOnCapabilityFlow: checkpoints.some((item) => item.checkpoint === 'scanner-denied') && checkpoints.some((item) => item.checkpoint === 'scanner-invalid') && checkpoints.some((item) => item.checkpoint === 'scanner-duplicate'),
      portableSaveExcludesOperationsAndModels: checkpoints.some((item) => item.checkpoint === 'save-export-portable' && item.observation.portable?.forbidden?.length === 0),
      saveGuards: ['result', 'achievement', 'hatch'].every((name) => checkpoints.some((item) => item.checkpoint === `save-guard-${name}` && item.diagnostics.save?.exportDisabled && item.diagnostics.save?.importDisabled && item.diagnostics.save?.restoreDisabled)),
      replayEventOnly: checkpoints.some((item) => item.checkpoint === 'replay-player-projection') && checkpoints.some((item) => item.checkpoint === 'replay-reloaded'),
      recoverableFailures: checkpoints.some((item) => item.checkpoint === 'card-import-error') && checkpoints.some((item) => item.checkpoint === 'save-storage-failure') && checkpoints.some((item) => item.checkpoint === 'replay-export-fallback'),
      saveDeliveryFallback: checkpoints.some((item) => item.checkpoint === 'save-delivery-fallback'),
      cardStorageRecovery: checkpoints.some((item) => item.checkpoint === 'card-storage-failure') && checkpoints.some((item) => item.checkpoint === 'card-delete-reloaded'),
      lazyChunkRecovery: checkpoints.some((item) => item.checkpoint === 'lazy-chunk-error'),
      artworkRecovery: checkpoints.some((item) => item.checkpoint === 'card-artwork-fallback'),
      noHorizontalOverflow: [...checkpoints, ...matrix].every((item) => !item.diagnostics.overflow.document && !item.diagnostics.overflow.body),
      targetMinimum44: [...checkpoints, ...matrix].every((item) => item.diagnostics.allTargetsAtLeast44),
      noModelResources: finalDiagnostics.modelResources.length === 0 && JSON.stringify(modelSentinel) === JSON.stringify({ id: 'ticket50-sentinel', payload: 'untouched' }) && Object.values(finalDiagnostics.modelIo || {}).every((value) => Number(value) === 0),
      productionGraphHasNoModelAssets: buildGraph.available && buildGraph.forbiddenAssets.length === 0,
      noUnhandledRejections: unhandled.length === 0 && runtimeErrors.length === 0 && consoleErrors.length === 0,
      fiveViewports: new Set(matrix.map((item) => item.viewport)).size === 5,
      reducedMotionEvidence: matrix.some((item) => item.diagnostics.reducedMotion === true && item.diagnostics.performance.resourceCount > 0),
    },
    limitations: ['Chrome CDP is browser contract evidence; native iPad Safari remains Ticket 51.', 'Expected artwork/network probes use /__ticket50__/ paths and are retained in checkpoint diagnostics.', 'Battle/Result settlement presentation remains covered by Ticket 48; this ticket verifies the save guard against its durable operation keys.'],
  }
  await mkdir(resolve(OUTPUT_ROOT, device), { recursive: true })
  await writeFile(resolve(OUTPUT_ROOT, device, 'accessibility.json'), `${JSON.stringify({ schemaVersion: 1, ticket: 50, nodes: (await call('Accessibility.getFullAXTree', { depth: -1 })).nodes?.filter((node) => !node.ignored && node.role?.value && node.name?.value).map((node) => ({ role: String(node.role.value), name: String(node.name.value) })).slice(0, 1600) }, null, 2)}\n`)
  await writeFile(resolve(OUTPUT_ROOT, device, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`)
  const failedAssertions = Object.entries(evidence.assertions).filter(([, value]) => value !== true)
  if (failedAssertions.length > 0) throw new Error(`Ticket 50 assertions failed: ${JSON.stringify(failedAssertions)}`)
  console.log(`Ticket 50 Chrome closure passed: ${checkpoints.length} checkpoints; ${matrix.length} viewport checks`)
  cdp.close()
  activeCdp = null
}

let activeCdp = null

main().catch(async (error) => {
  try {
    await activeCdp?.call('Network.setBlockedURLs', { urls: [] })
    await activeCdp?.call('Network.setCacheDisabled', { cacheDisabled: false })
    await activeCdp?.call('Page.reload', { ignoreCache: true })
  } catch { /* cleanup is best effort after a failed browser run */ }
  activeCdp?.close()
  activeCdp = null
  console.error(`Ticket 50 Chrome closure failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
