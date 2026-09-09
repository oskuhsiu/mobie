// Ticket 23 cold-boot evidence. Run against an isolated Chrome CDP target:
//   npm run dev -- --host 127.0.0.1
//   chrome --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/mobie-m24-ticket23 about:blank
//   npm run baseline:m24-shell -- --port=9222

import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const SCENARIO_ID = 'm24-ticket23-app-shell-v1'
const BASELINE_COMMIT = '7ba23ca'
const OUTPUT_ROOT = resolve('test-runs', 'm24', 'ticket23-app-shell')
const VIEWPORT = { id: 'wide-landscape', width: 1180, height: 820, dpr: 1 }
const JOURNEY = [
  'bootstrap-loading', 'bootstrap-partial-error', 'bootstrap-safe-actions', 'bootstrap-safe-settings',
  'bootstrap-scanner-gate', 'bootstrap-retry-loading', 'title-ready', 'region-select', 'app-remount', 'title-after-route', 'my-mobies', 'tools-more', 'storage-failure', 'reload',
]

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

function positiveInteger(value, name) {
  const number = Number(value)
  if (!Number.isInteger(number) || number <= 0) throw new Error(`--${name} must be a positive integer`)
  return number
}

function safeSegment(value, name) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value) || value === '.' || value === '..') {
    throw new Error(`--${name} must be one safe path segment`)
  }
  return value
}

async function connect(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`)
  if (!response.ok) throw new Error(`CDP target list returned ${response.status}`)
  const target = (await response.json()).find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl)
  if (!target) throw new Error(`No page target found on CDP port ${port}`)

  const socket = new WebSocket(target.webSocketDebuggerUrl)
  const pending = new Map()
  const listeners = new Map()
  let nextId = 0
  const errors = { console: [], unhandled: [], networkFailed: [] }
  const remoteValue = (value) => Object.hasOwn(value, 'value') ? value.value : value.unserializableValue ?? value.description ?? value.type

  await new Promise((resolveOpen, rejectOpen) => {
    socket.onopen = resolveOpen
    socket.onerror = () => rejectOpen(new Error('CDP WebSocket connection failed'))
  })
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id)
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
  listeners.set('Runtime.consoleAPICalled', [({ type, args, stackTrace }) => {
    if (type === 'error' || type === 'assert') errors.console.push({ type, text: args.map(remoteValue).join(' '), stack: stackTrace?.callFrames ?? [] })
  }])
  listeners.set('Runtime.exceptionThrown', [({ exceptionDetails }) => {
    errors.unhandled.push({ text: exceptionDetails?.exception?.description ?? exceptionDetails?.text ?? 'Unhandled page exception', url: exceptionDetails?.url ?? '' })
  }])
  listeners.set('Log.entryAdded', [({ entry }) => {
    if (entry?.level === 'error') errors.console.push({ type: 'log', text: entry.text, url: entry.url ?? '' })
  }])
  listeners.set('Network.loadingFailed', [({ requestId, errorText, canceled }) => {
    errors.networkFailed.push({ requestId, errorText, canceled: Boolean(canceled) })
  }])

  return {
    errors,
    call(method, params = {}) {
      return new Promise((resolveCall, rejectCall) => {
        const id = ++nextId
        pending.set(id, { method, resolve: resolveCall, reject: rejectCall })
        socket.send(JSON.stringify({ id, method, params }))
      })
    },
    close() { socket.close() },
  }
}

function accessibilitySummary(nodes) {
  return nodes
    .filter((node) => !node.ignored && node.role?.value && node.name?.value?.trim())
    .map((node) => ({
      role: String(node.role.value),
      name: String(node.name.value),
      disabled: node.properties?.find((property) => property.name === 'disabled')?.value?.value ?? false,
    }))
    .slice(0, 400)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const port = positiveInteger(args.port ?? 9222, 'port')
  const app = args.app ?? 'http://127.0.0.1:5173/'
  const device = safeSegment(args.device ?? 'ticket23-chrome', 'device')
  const outputRoot = resolve(OUTPUT_ROOT, device)
  const cdp = await connect(port)
  const call = cdp.call
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'Page evaluation failed')
    return result.result.value
  }
  const waitFor = async (expression, timeoutMs = 15_000, description = expression) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return
      await sleep(50)
    }
    throw new Error(`Timed out waiting for ${description}`)
  }
  const clickText = async (text, selector = 'button') => {
    const clicked = await evaluate(`(() => {
      const element = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find((candidate) => !candidate.disabled && (candidate.textContent || '').includes(${JSON.stringify(text)}))
      if (!element) return false
      element.click()
      return true
    })()`)
    if (!clicked) throw new Error(`Could not click ${selector} containing ${text}`)
  }
  const clickSelector = async (selector) => {
    const clicked = await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element || element.disabled) return false; element.click(); return true })()`)
    if (!clicked) throw new Error(`Could not click ${selector}`)
  }
  const domDiagnostics = async () => evaluate(`(() => {
    const shell = document.querySelector('[data-app-shell]')
    const viewport = document.querySelector('[data-screen-viewport]')
    const status = shell?.dataset.bootstrapStatus ?? null
    const buttons = [...document.querySelectorAll('button')].map((button) => ({
      text: (button.textContent || '').trim(), disabled: button.disabled,
      gate: button.dataset.bootstrapGated === 'true', title: button.title || null,
    }))
    return {
      route: shell?.dataset.route ?? null, bootstrapStatus: status, bootstrapAttempt: Number(shell?.dataset.bootstrapAttempt ?? 0),
      shell: Boolean(shell), taskHeader: Boolean(document.querySelector('[data-task-header]')),
      screenViewport: Boolean(viewport), utilityDock: Boolean(document.querySelector('[data-utility-dock]')),
      viewport: { width: innerWidth, height: innerHeight },
      overflow: { document: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, body: document.body.scrollWidth > document.body.clientWidth + 1, shell: getComputedStyle(shell).overflow, viewport: getComputedStyle(viewport).overflow },
      viewportMeta: document.querySelector('meta[name="viewport"]')?.content ?? null,
      buttons, focus: document.activeElement?.getAttribute?.('aria-label') || document.activeElement?.textContent?.trim().slice(0, 80) || null,
      text: (document.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 4000),
    }
  })()`)
  const capture = async (checkpoint, source, observation = null, settleMs = 260) => {
    await sleep(settleMs)
    const screenshot = await call('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
    const dom = await domDiagnostics()
    const ax = await call('Accessibility.getFullAXTree', { depth: -1 })
    const record = {
      schemaVersion: 1, scenarioId: SCENARIO_ID, baselineCommit: BASELINE_COMMIT, checkpoint, source,
      capturedAt: new Date().toISOString(), viewport: VIEWPORT, dom, observation, errors: cdp.errors,
    }
    const checkpointRoot = resolve(outputRoot, checkpoint)
    await mkdir(checkpointRoot, { recursive: true })
    await Promise.all([
      writeFile(resolve(checkpointRoot, 'screenshot.png'), Buffer.from(screenshot.data, 'base64')),
      writeFile(resolve(checkpointRoot, 'metrics.json'), `${JSON.stringify(record, null, 2)}\n`),
      writeFile(resolve(checkpointRoot, 'accessibility.json'), `${JSON.stringify({ schemaVersion: 1, scenarioId: `${SCENARIO_ID}--${checkpoint}`, checkpoint, nodes: accessibilitySummary(ax.nodes), limitations: ['Chrome AX tree is a point-in-time snapshot.'] }, null, 2)}\n`),
    ])
    console.log(`Captured ${checkpoint}`)
    return { checkpoint, route: dom.route, bootstrapStatus: dom.bootstrapStatus, observation }
  }

  try {
    await Promise.all([call('Runtime.enable'), call('Page.enable'), call('Accessibility.enable'), call('Log.enable'), call('Network.enable')])
    await call('Storage.clearDataForOrigin', { origin: new URL(app).origin, storageTypes: 'all' })
    await call('Emulation.setDeviceMetricsOverride', { width: VIEWPORT.width, height: VIEWPORT.height, deviceScaleFactor: VIEWPORT.dpr, mobile: true, screenWidth: VIEWPORT.width, screenHeight: VIEWPORT.height })

    const url = new URL(app)
    url.searchParams.set('m24BootstrapFail', 'meta')
    url.searchParams.set('m24BootstrapDelay', '180')
    url.searchParams.set('ticket23Run', String(Date.now()))
    await call('Page.navigate', { url: url.href })
    await waitFor('document.readyState === "complete"', 20_000, 'app document')
    await waitFor('Boolean(document.querySelector("[data-app-shell]"))', 15_000, 'AppShell')
    await sleep(35)
    const checkpoints = []
    const loading = await evaluate(`(() => ({ status: document.querySelector('[data-app-shell]')?.dataset.bootstrapStatus, startDisabled: document.querySelector('[data-bootstrap-action="start-adventure"]')?.disabled ?? null, diagnostics: window.__MOBIE_BOOTSTRAP__?.diagnostics?.() ?? null }))()`)
    if (loading.status !== 'loading' || !loading.startDisabled || loading.diagnostics?.stageCalls?.roster !== 1 || loading.diagnostics?.stageCalls?.meta !== 0 || loading.diagnostics?.stageCalls?.incubator !== 1) throw new Error(`Cold boot loading gate failed: ${JSON.stringify(loading)}`)
    checkpoints.push(await capture('bootstrap-loading', 'cold boot while roster/meta/incubator are pending', loading, 0))

    await waitFor('Boolean(document.querySelector("[data-bootstrap-status=partial-error]"))', 15_000, 'partial bootstrap error')
    const partial = await evaluate(`(() => ({ status: document.querySelector('[data-app-shell]')?.dataset.bootstrapStatus, retry: Boolean([...document.querySelectorAll('button')].find((button) => (button.textContent || '').includes('重新嘗試'))), startDisabled: document.querySelector('[data-bootstrap-action="start-adventure"]')?.disabled ?? null, mobiesDisabled: document.querySelector('.tools-menu-primary__mobies')?.disabled ?? null, route: document.querySelector('[data-app-shell]')?.dataset.route, diagnostics: window.__MOBIE_BOOTSTRAP__?.diagnostics?.() ?? null }))()`)
    if (partial.status !== 'partial-error' || !partial.retry || !partial.startDisabled || !partial.mobiesDisabled || partial.route !== 'title') throw new Error(`Partial bootstrap gate failed: ${JSON.stringify(partial)}`)
    checkpoints.push(await capture('bootstrap-partial-error', 'simulated meta load failure with stable Title', partial))

    await clickText('更多')
    const safeActions = await evaluate(`(() => ({ menu: Boolean(document.querySelector('#tools-menu-more')), settingsDisabled: [...document.querySelectorAll('#tools-menu-more button')].find((button) => (button.textContent || '').includes('設定'))?.disabled ?? null, libraryDisabled: [...document.querySelectorAll('#tools-menu-more button')].find((button) => (button.textContent || '').includes('卡庫'))?.disabled ?? null, startDisabled: document.querySelector('[data-bootstrap-action="start-adventure"]')?.disabled ?? null }))()`)
    if (!safeActions.menu || safeActions.settingsDisabled || !safeActions.libraryDisabled || !safeActions.startDisabled) throw new Error(`Safe action boundary failed: ${JSON.stringify(safeActions)}`)
    checkpoints.push(await capture('bootstrap-safe-actions', 'More stays available while data actions are gated', safeActions))
    await clickText('設定', '#tools-menu-more button')
    await waitFor('Boolean(document.querySelector("[data-settings-preference=\\"scannerEnabled\\"]"))', 10_000, 'safe Settings action')
    checkpoints.push(await capture('bootstrap-safe-settings', 'safe Settings handoff during partial error', { settingsVisible: true, route: await evaluate('document.querySelector("[data-app-shell]")?.dataset.route ?? null') }))
    await clickSelector('[data-settings-preference="scannerEnabled"]')
    await clickText('關閉', '.modal-card button')
    await waitFor('!document.querySelector(".modal-card")', 5_000, 'safe Settings close')
    await waitFor('Boolean(document.querySelector("[data-bootstrap-status=partial-error]"))', 5_000, 'Title partial state after Settings')
    if (!await evaluate('Boolean(document.querySelector("#tools-menu-more"))')) await clickText('更多')
    const scannerGate = await evaluate('(() => { const button = document.querySelector("[data-tool=\\"scanner\\"]"); return { visible: Boolean(button), disabled: button?.disabled ?? null, gated: button?.dataset.bootstrapGated === "true", title: button?.title ?? null } })()')
    if (!scannerGate.visible || !scannerGate.disabled || !scannerGate.gated || !scannerGate.title?.includes('重新嘗試')) throw new Error('Scanner readiness gate failed')
    checkpoints.push(await capture('bootstrap-scanner-gate', 'scanner stays visible but disabled while canonical data is unavailable', scannerGate))

    if (await evaluate('Boolean(document.querySelector("#tools-menu-more"))')) {
      await clickText('更多')
      await waitFor('!document.querySelector("#tools-menu-more")', 5_000, 'More menu close before Retry')
    }
    const retryStarted = await evaluate(`(() => { window.__MOBIE_BOOTSTRAP_TEST__ = { failStage: null, delayMs: 700 }; document.querySelector('[data-bootstrap-status="partial-error"] button')?.click(); return true })()`)
    if (!retryStarted) throw new Error('Could not start bootstrap retry')
    await sleep(35)
    const retryLoading = await evaluate(`(() => ({ status: document.querySelector('[data-app-shell]')?.dataset.bootstrapStatus, route: document.querySelector('[data-app-shell]')?.dataset.route, diagnostics: window.__MOBIE_BOOTSTRAP__?.diagnostics?.() ?? null }))()`)
    if (retryLoading.status !== 'loading' || retryLoading.route !== 'title' || retryLoading.diagnostics?.promiseSerial !== 2) throw new Error(`Bootstrap retry was not cached/loading: ${JSON.stringify(retryLoading)}`)
    checkpoints.push(await capture('bootstrap-retry-loading', 'explicit Retry with simulated slow storage/data load', retryLoading, 0))
    await waitFor('document.querySelector("[data-app-shell]")?.dataset.bootstrapStatus === "ready"', 15_000, 'ready after Retry')

    if (await evaluate('Boolean(document.querySelector("#tools-menu-more"))')) {
      await clickText('更多')
      await waitFor('!document.querySelector("#tools-menu-more")', 5_000, 'More menu close before keyboard action')
    }
    await evaluate('document.querySelector("button[aria-label=\\"更多\\"]")?.focus()')
    await waitFor('document.activeElement === document.querySelector("button[aria-label=\\"更多\\"]")', 5_000, 'More button focus')
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    const keyboardTriggered = await evaluate('Boolean(document.querySelector("#tools-menu-more"))')
    if (!keyboardTriggered) throw new Error('Enter did not activate the focused More button')
    await waitFor('Boolean(document.querySelector("#tools-menu-more"))', 5_000, 'keyboard More action')
    const keyboard = await evaluate(`(() => ({ menu: Boolean(document.querySelector("#tools-menu-more")), focused: document.activeElement?.getAttribute("aria-label") ?? null, trigger: ${JSON.stringify(keyboardTriggered ? 'Enter' : 'click-fallback')} }))()`)
    if (!keyboard.menu) throw new Error('Keyboard More action failed')
    await clickText('更多')

    const beforeViewportEvents = await evaluate('JSON.stringify(window.__MOBIE_ROUTE_EVENTS__ ?? { total: 0, byType: {} })')
    await call('Emulation.setPageScaleFactor', { pageScaleFactor: 2 })
    await sleep(100)
    const zoom = await evaluate('(() => { const start = document.querySelector("[data-bootstrap-action=\\"start-adventure\\"]"); const rect = start?.getBoundingClientRect(); return { scale: visualViewport?.scale ?? null, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 || document.body.scrollWidth > document.body.clientWidth + 1, startVisible: Boolean(rect && rect.width > 0 && rect.height > 0), routeEvents: JSON.stringify(window.__MOBIE_ROUTE_EVENTS__ ?? { total: 0, byType: {} }) } })()')
    await call('Emulation.setPageScaleFactor', { pageScaleFactor: 1 })
    if (zoom.overflow || !zoom.startVisible || zoom.routeEvents !== beforeViewportEvents) throw new Error('Zoom changed layout/route boundary')
    await evaluate('document.body.style.fontSize = "200%"; true')
    await sleep(100)
    const textScale = await evaluate('(() => { const visible = (selector) => { const rect = document.querySelector(selector)?.getBoundingClientRect(); return Boolean(rect && rect.width > 0 && rect.height > 0 && rect.bottom <= innerHeight + 1) }; return { startVisible: visible("[data-bootstrap-action=\\"start-adventure\\"]"), moreVisible: visible("button[aria-label=\\"更多\\"]"), overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 || document.body.scrollWidth > document.body.clientWidth + 1, routeEvents: JSON.stringify(window.__MOBIE_ROUTE_EVENTS__ ?? { total: 0, byType: {} }) } })()')
    await evaluate('document.body.style.removeProperty("font-size"); true')
    if (!textScale.startVisible || !textScale.moreVisible || textScale.overflow || textScale.routeEvents !== beforeViewportEvents) throw new Error('Text scaling changed Title reachability')

    await call('Emulation.setDeviceMetricsOverride', { width: 820, height: 1180, deviceScaleFactor: VIEWPORT.dpr, mobile: true, screenWidth: 820, screenHeight: 1180, screenOrientation: { type: 'portraitPrimary', angle: 0 } })
    await sleep(100)
    const orientation = await evaluate('(() => ({ route: document.querySelector("[data-app-shell]")?.dataset.route, status: document.querySelector("[data-app-shell]")?.dataset.bootstrapStatus, width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, routeEvents: JSON.stringify(window.__MOBIE_ROUTE_EVENTS__ ?? { total: 0, byType: {} }) }))()')
    await call('Emulation.setDeviceMetricsOverride', { width: VIEWPORT.width, height: VIEWPORT.height, deviceScaleFactor: VIEWPORT.dpr, mobile: true, screenWidth: VIEWPORT.width, screenHeight: VIEWPORT.height, screenOrientation: { type: 'landscapePrimary', angle: 0 } })
    if (orientation.route !== 'title' || orientation.status !== 'ready' || orientation.routeEvents !== beforeViewportEvents) throw new Error('Orientation changed route/bootstrap boundary')

    await evaluate('document.documentElement.style.setProperty("--safe-t", "24px"); true')
    const safeArea = await evaluate('(() => { const shell = document.querySelector("[data-app-shell]"); const viewport = document.querySelector("[data-screen-viewport]"); return { shellPaddingTop: getComputedStyle(shell).paddingTop, viewportTop: viewport.getBoundingClientRect().top } })()')
    await evaluate('document.documentElement.style.removeProperty("--safe-t"); true')
    if (safeArea.shellPaddingTop !== '24px' || safeArea.viewportTop !== 24) throw new Error('AppShell does not own safe-area padding')

    const titleBase = await evaluate(`(() => {
      const text = document.body.innerText || ''
      const start = document.querySelector('[data-bootstrap-action="start-adventure"]')
      const mobies = document.querySelector('.tools-menu-primary__mobies')
      return {
        status: document.querySelector('[data-app-shell]')?.dataset.bootstrapStatus, route: document.querySelector('[data-app-shell]')?.dataset.route,
        brand: text.includes('MOBIE'), tagline: text.includes('鎖定目標'), start: text.includes('開始冒險'), mobies: text.includes('我的 Mobie'), more: text.includes('更多'),
        uniqueGoldPrimary: document.querySelectorAll('.title-screen > .btn:not(.btn--ghost)').length === 1,
        startEnabled: Boolean(start && !start.disabled), mobiesEnabled: Boolean(mobies && !mobies.disabled),
        shell: Boolean(document.querySelector('[data-app-shell]')), taskHeader: Boolean(document.querySelector('[data-task-header]')), screenViewport: Boolean(document.querySelector('[data-screen-viewport]')), utilityDock: Boolean(document.querySelector('[data-utility-dock]')),
        viewportMeta: document.querySelector('meta[name="viewport"]')?.content ?? null,
        diagnostics: window.__MOBIE_BOOTSTRAP__?.diagnostics?.() ?? null,
      }
    })()`)
    const title = { ...titleBase, keyboard: keyboard.menu, zoom, textScale, orientation, safeArea }
    if (title.status !== 'ready' || title.route !== 'title' || !title.brand || !title.tagline || !title.start || !title.mobies || !title.more || !title.uniqueGoldPrimary || !title.startEnabled || !title.mobiesEnabled || !title.shell || !title.taskHeader || !title.screenViewport || !title.utilityDock || /user-scalable|max-width|max-scale/i.test(title.viewportMeta)) throw new Error(`Ready Title contract failed: ${JSON.stringify(title)}`)
    checkpoints.push(await capture('title-ready', 'ready Title with AppShell primitives, keyboard navigation, zoom, and orientation checks', title))

    const beforeResize = await evaluate('JSON.stringify(window.__MOBIE_ROUTE_EVENTS__ ?? { total: 0, byType: {} })')
    await clickSelector('[data-bootstrap-action="start-adventure"]')
    await waitFor('document.querySelector("[data-app-shell]")?.dataset.route === "regionSelect"', 10_000, 'START→regionSelect')
    checkpoints.push(await capture('region-select', 'Title START handoff through XState route authority', { route: 'regionSelect', routeEvents: await evaluate('window.__MOBIE_ROUTE_EVENTS__ ?? null') }))
    await evaluate('window.__MOBIE_APP_TEST__?.remount(); true')
    await waitFor('document.querySelector("[data-app-shell]")?.dataset.route === "regionSelect"', 10_000, 'App remount route preservation')
    const remount = await evaluate('(() => ({ route: document.querySelector("[data-app-shell]")?.dataset.route, status: document.querySelector("[data-app-shell]")?.dataset.bootstrapStatus, routeEvents: window.__MOBIE_ROUTE_EVENTS__ ?? null, diagnostics: window.__MOBIE_BOOTSTRAP__?.diagnostics?.() ?? null }))()')
    if (remount.route !== 'regionSelect' || remount.status !== 'ready' || remount.routeEvents?.total !== 1 || remount.diagnostics?.stageCalls?.roster !== 1 || remount.diagnostics?.stageCalls?.meta !== 2 || remount.diagnostics?.stageCalls?.incubator !== 1) throw new Error('App remount changed route or repeated bootstrap stages')
    checkpoints.push(await capture('app-remount', 'DEV root remount preserves XState route and cached bootstrap', remount))
    await clickText('首頁')
    await waitFor('document.querySelector("[data-app-shell]")?.dataset.route === "title"', 10_000, 'BACK→title')
    const resizeCheck = await evaluate(`(() => { const before = JSON.stringify(window.__MOBIE_ROUTE_EVENTS__ ?? { total: 0, byType: {} }); window.dispatchEvent(new Event('resize')); return { before, after: JSON.stringify(window.__MOBIE_ROUTE_EVENTS__ ?? { total: 0, byType: {} }) } })()`)
    if (resizeCheck.before !== resizeCheck.after) throw new Error(`Resize changed route events: ${JSON.stringify(resizeCheck)}`)
    checkpoints.push(await capture('title-after-route', 'safe return from region selection without bootstrap mutation', { route: 'title', resizeCheck, routeEvents: await evaluate('window.__MOBIE_ROUTE_EVENTS__ ?? null') }))

    await clickSelector('.tools-menu-primary__mobies')
    await waitFor('Boolean(document.querySelector("[role=dialog]"))', 10_000, 'My Mobie handoff')
    await waitFor('Boolean(document.querySelector("[role=dialog] .team-row"))', 10_000, 'My Mobie content')
    const myMobies = await evaluate(`(() => ({ route: document.querySelector('[data-app-shell]')?.dataset.route, title: (document.body.innerText || '').includes('我的 Mobie'), rows: document.querySelectorAll('.team-row').length, routeEvents: window.__MOBIE_ROUTE_EVENTS__ ?? null }))()`)
    if (myMobies.route !== 'title' || !myMobies.title || myMobies.rows === 0) throw new Error(`My Mobie handoff failed: ${JSON.stringify(myMobies)}`)
    checkpoints.push(await capture('my-mobies', 'Title→我的 Mobie safe handoff', myMobies))
    await clickText('關閉', '[role=dialog] button')
    if (await evaluate('Boolean(document.querySelector("#tools-menu-more"))')) await clickText('更多')
    await clickText('更多')
    const tools = await evaluate(`(() => ({ route: document.querySelector('[data-app-shell]')?.dataset.route, dock: Boolean(document.querySelector('[data-utility-dock]')), menu: Boolean(document.querySelector('#tools-menu-more')), dataGated: [...document.querySelectorAll('#tools-menu-more [data-bootstrap-gated="true"]')].length, routeEvents: window.__MOBIE_ROUTE_EVENTS__ ?? null }))()`)
    if (tools.route !== 'title' || !tools.dock || !tools.menu || tools.dataGated !== 0) throw new Error(`More handoff failed: ${JSON.stringify(tools)}`)
    checkpoints.push(await capture('tools-more', 'Title→更多 compact utility handoff', tools))

    const routeEvents = await evaluate('window.__MOBIE_ROUTE_EVENTS__ ?? { total: 0, byType: {} }')
    if (routeEvents.byType?.START !== 1 || routeEvents.byType?.BACK !== 1 || routeEvents.total !== 2) throw new Error(`Unexpected route event count: ${JSON.stringify(routeEvents)}`)
    const beforeReloadDiagnostics = await evaluate('window.__MOBIE_BOOTSTRAP__?.diagnostics?.() ?? null')
    if (beforeReloadDiagnostics?.promiseSerial !== 2 || beforeReloadDiagnostics?.stageCalls?.roster !== 1 || beforeReloadDiagnostics?.stageCalls?.meta !== 2 || beforeReloadDiagnostics?.stageCalls?.incubator !== 1 || beforeReloadDiagnostics?.snapshot?.status !== 'ready') throw new Error('Bootstrap duplicate/retry invariant failed')

    await evaluate('localStorage.setItem("mobie.meta.v1", "{malformed"); true')
    await evaluate(`history.replaceState(null, '', ${JSON.stringify(app)}); true`)
    await call('Page.reload', { ignoreCache: true })
    await waitFor('document.readyState === "complete"', 20_000, 'cold reload document')
    await waitFor('Boolean(document.querySelector("[data-bootstrap-status=partial-error]"))', 15_000, 'strict storage failure state')
    const storageFailure = await evaluate('(() => { let roster = null; try { const payload = JSON.parse(localStorage.getItem("mobie.roster.v2") ?? "null"); roster = Array.isArray(payload) ? payload : payload?.roster } catch {} return { route: document.querySelector("[data-app-shell]")?.dataset.route, status: document.querySelector("[data-app-shell]")?.dataset.bootstrapStatus, retry: Boolean([...document.querySelectorAll("button")].find((button) => (button.textContent || "").includes("重新嘗試"))), rosterRows: Array.isArray(roster) ? roster.length : 0, metaRaw: localStorage.getItem("mobie.meta.v1"), diagnostics: window.__MOBIE_BOOTSTRAP__?.diagnostics?.() ?? null } })()')
    if (storageFailure.route !== 'title' || storageFailure.status !== 'partial-error' || !storageFailure.retry || storageFailure.rosterRows === 0 || storageFailure.metaRaw !== '{malformed') throw new Error('Strict storage failure was not recoverable')
    checkpoints.push(await capture('storage-failure', 'malformed persisted meta stays gated instead of seeding defaults', storageFailure))
    await evaluate('(() => { localStorage.removeItem("mobie.meta.v1"); document.querySelector("[data-bootstrap-status=partial-error] button")?.click(); return true })()')
    await waitFor('document.querySelector("[data-app-shell]")?.dataset.bootstrapStatus === "ready"', 15_000, 'ready after strict storage Retry')
    await call('Page.reload', { ignoreCache: true })
    await waitFor('document.readyState === "complete"', 20_000, 'cold reload document')
    await waitFor('document.querySelector("[data-app-shell]")?.dataset.bootstrapStatus === "ready"', 15_000, 'cold reload ready state')
    await waitFor('Boolean(document.querySelector(".title-screen__adventure"))', 15_000, 'cold reload Title')
    const reload = await evaluate('(() => { let roster = null; try { const payload = JSON.parse(localStorage.getItem("mobie.roster.v2") ?? "null"); roster = Array.isArray(payload) ? payload : payload?.roster } catch {} return { route: document.querySelector("[data-app-shell]")?.dataset.route, status: document.querySelector("[data-app-shell]")?.dataset.bootstrapStatus, rosterRows: Array.isArray(roster) ? roster.length : 0, diagnostics: window.__MOBIE_BOOTSTRAP__?.diagnostics?.() ?? null } })()')
    if (reload.route !== 'title' || reload.status !== 'ready' || reload.rosterRows === 0 || reload.diagnostics?.stageCalls?.roster !== 1 || reload.diagnostics?.stageCalls?.meta !== 1 || reload.diagnostics?.stageCalls?.incubator !== 1) throw new Error('Cold reload persistence/cache boundary failed')
    checkpoints.push(await capture('reload', 'cold reload returns to Title with persisted canonical roster', reload))

    const index = {
      schemaVersion: 1, scenarioId: SCENARIO_ID, baselineCommit: BASELINE_COMMIT, viewport: VIEWPORT,
      startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), journey: JOURNEY, checkpoints,
      bootstrap: { diagnostics: beforeReloadDiagnostics, storageFailure, reload, cachedPromiseAttempts: beforeReloadDiagnostics?.promiseSerial ?? null, statuses: ['loading', 'partial-error', 'ready'], retryObserved: true, slowLoadObserved: true, failureObserved: true },
      routeEvents, zoom: { viewportMeta: title.viewportMeta, resizeNoRouteEvent: true }, errors: cdp.errors,
      limitations: ['Chrome CDP is functional cold-boot evidence, not iPad Safari qualification.', 'Storage failure and delay are deterministic DEV fixtures; physical storage failures remain a separate platform check.'],
    }
    await mkdir(outputRoot, { recursive: true })
    await writeFile(resolve(outputRoot, 'index.json'), `${JSON.stringify(index, null, 2)}\n`)
    if (cdp.errors.console.length || cdp.errors.unhandled.length || cdp.errors.networkFailed.length) throw new Error(`Browser errors observed: ${JSON.stringify(cdp.errors)}`)
    console.log(`Ticket 23 evidence written to ${outputRoot}`)
  } finally {
    cdp.close()
  }
}

main().catch((error) => {
  console.error(`Ticket 23 baseline failed: ${error.message}`)
  process.exitCode = 1
})
