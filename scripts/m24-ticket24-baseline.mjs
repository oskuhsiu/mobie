// Ticket 24 overlay evidence. Run against an isolated Chrome CDP target:
//   npm run dev -- --host 127.0.0.1
//   open -na 'Google Chrome' --args --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/mobie-m24-ticket24 about:blank
//   npm run baseline:m24-overlay -- --port=9222

import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const SCENARIO_ID = 'm24-ticket24-overlay-v1'
const BASELINE_COMMIT = 'ea42cd1'
const OUTPUT_ROOT = resolve('test-runs', 'm24', 'ticket24-overlay')
const VIEWPORT = { id: 'compact-landscape', width: 620, height: 720, dpr: 1 }
const JOURNEY = [
  'title-more', 'settings-open', 'settings-keyboard', 'settings-escape-restore',
  'region-settings-scrolled', 'region-settings-backdrop-restore', 'route-change-cleanup',
  'nested-push-pop',
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
    resetErrors() {
      errors.console.length = 0
      errors.unhandled.length = 0
      errors.networkFailed.length = 0
    },
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
    .slice(0, 600)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const port = positiveInteger(args.port ?? 9222, 'port')
  const device = safeSegment(args.device ?? 'ticket24-chrome', 'device')
  const outputRoot = resolve(OUTPUT_ROOT, device)
  const cdp = await connect(port)
  const call = cdp.call
  await mkdir(outputRoot, { recursive: true })
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
  const click = async (selector) => {
    const clicked = await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element || element.disabled) return false; element.scrollIntoView({ block: 'center', inline: 'center' }); element.click(); return true })()`)
    if (!clicked) throw new Error(`Could not click ${selector}`)
  }
  const clickText = async (text) => {
    const clicked = await evaluate(`(() => { const element = [...document.querySelectorAll('button')].find((candidate) => !candidate.disabled && (candidate.textContent || '').includes(${JSON.stringify(text)})); if (!element) return false; element.scrollIntoView({ block: 'center', inline: 'center' }); element.click(); return true })()`)
    if (!clicked) throw new Error(`Could not click button containing ${text}`)
  }
  const key = async (keyValue, modifiers = 0) => {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: keyValue, code: keyValue === 'Escape' ? 'Escape' : 'Tab', windowsVirtualKeyCode: keyValue === 'Escape' ? 27 : 9, nativeVirtualKeyCode: keyValue === 'Escape' ? 27 : 9, modifiers })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: keyValue, code: keyValue === 'Escape' ? 'Escape' : 'Tab', windowsVirtualKeyCode: keyValue === 'Escape' ? 27 : 9, nativeVirtualKeyCode: keyValue === 'Escape' ? 27 : 9, modifiers })
  }
  const domDiagnostics = async () => evaluate(`(() => {
    const root = document.getElementById('root')
    const shell = document.querySelector('[data-app-shell]')
    const surface = document.querySelector('[data-modal-surface]')
    const dialog = surface?.closest('[role="dialog"]')
    const body = surface?.querySelector('[data-modal-body]')
    const footer = surface?.querySelector('[data-modal-footer]')
    const screen = document.querySelector('[data-screen-viewport]')
    const labelledBy = dialog?.getAttribute('aria-labelledby') ?? null
    const describedBy = dialog?.getAttribute('aria-describedby') ?? null
    const active = document.activeElement
    const label = active?.getAttribute?.('aria-label') || active?.textContent?.trim().replace(/\\s+/g, ' ').slice(0, 90) || null
    const visible = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' }
    return {
      route: shell?.dataset.route ?? null,
      overlay: window.__MOBIE_OVERLAY__?.snapshot?.() ?? null,
      overlayId: document.querySelector('[data-overlay-host]')?.dataset.overlayId ?? null,
      overlayDepth: Number(document.querySelector('[data-overlay-host]')?.dataset.overlayDepth ?? 0),
      surfaceCount: document.querySelectorAll('[data-modal-surface]').length,
      dialogCount: document.querySelectorAll('[role="dialog"]').length,
      rootInert: root?.inert ?? false,
      rootAriaHidden: root?.getAttribute('aria-hidden') ?? null,
      bodyOverlayOpen: document.body.dataset.overlayOpen ?? null,
      bodyOverflow: document.body.style.overflow,
      active: { tag: active?.tagName ?? null, className: active?.className ?? null, label, mobieInvoker: active?.getAttribute?.('data-mobie-invoker') ?? null, insideSurface: Boolean(surface && active && surface.contains(active)) },
      dialogSemantics: { role: dialog?.getAttribute('role') ?? null, ariaModal: dialog?.getAttribute('aria-modal') ?? null, labelledBy, labelledByExists: Boolean(labelledBy && document.getElementById(labelledBy)), describedBy, describedByExists: Boolean(describedBy && document.getElementById(describedBy)) },
      modal: surface ? { visible: visible(surface), policy: document.querySelector('[data-modal-backdrop]')?.dataset.dismissPolicy ?? null, body: { scrollTop: body.scrollTop, scrollHeight: body.scrollHeight, clientHeight: body.clientHeight }, footer: footer ? { bottom: footer.getBoundingClientRect().bottom, surfaceBottom: surface.getBoundingClientRect().bottom, visible: visible(footer), action: Boolean(footer.querySelector('button:not([disabled])')) } : null } : null,
      underlying: screen ? { scrollTop: screen.scrollTop, scrollHeight: screen.scrollHeight, clientHeight: screen.clientHeight } : null,
      moreVisible: Boolean(document.querySelector('button[aria-label="更多"]')),
      text: (document.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 3000),
    }
  })()`)
  const capture = async (checkpoint, source, observation = null) => {
    await sleep(220)
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
    return { checkpoint, route: dom.route, overlay: dom.overlay, observation }
  }

  try {
    await Promise.all([call('Runtime.enable'), call('Page.enable'), call('Accessibility.enable'), call('Log.enable'), call('Network.enable')])
    await call('Storage.clearDataForOrigin', { origin: 'http://127.0.0.1:5173', storageTypes: 'all' })
    await call('Emulation.setDeviceMetricsOverride', { width: VIEWPORT.width, height: VIEWPORT.height, deviceScaleFactor: VIEWPORT.dpr, mobile: true, screenWidth: VIEWPORT.width, screenHeight: VIEWPORT.height, screenOrientation: { type: 'landscapePrimary', angle: 0 } })

    const url = new URL('http://127.0.0.1:5173/')
    url.searchParams.set('m24Scenario', 'm24-post-m23-chrome-v1')
    url.searchParams.set('ticket24Run', String(Date.now()))
    cdp.resetErrors()
    await call('Page.navigate', { url: url.href })
    await waitFor('document.readyState === "complete"', 20_000, 'app document')
    await waitFor('document.querySelector("[data-app-shell]")?.dataset.bootstrapStatus === "ready"', 20_000, 'ready bootstrap')
    await waitFor('Boolean(document.querySelector("button[aria-label=\\"更多\\"]"))', 10_000, 'More button')

    const checkpoints = []
    await click('button[aria-label="更多"]')
    await waitFor('Boolean(document.querySelector("#tools-menu-more"))', 5_000, 'More menu')
    await waitFor('(() => { const first = [...document.querySelectorAll("#tools-menu-more button")].find((button) => !button.disabled); return first === document.activeElement })()', 5_000, 'first legal More focus')
    const menu = await evaluate(`(() => { const menu = document.querySelector('#tools-menu-more'); const first = [...document.querySelectorAll('#tools-menu-more button')].find((button) => !button.disabled); return { headings: [...document.querySelectorAll('#tools-menu-more h2')].map((h) => h.textContent?.trim()), headingRects: [...document.querySelectorAll('#tools-menu-more h2')].map((h) => ({ top: h.getBoundingClientRect().top, bottom: h.getBoundingClientRect().bottom })), menuRect: menu ? { top: menu.getBoundingClientRect().top, bottom: menu.getBoundingClientRect().bottom, scrollTop: menu.scrollTop, scrollHeight: menu.scrollHeight, clientHeight: menu.clientHeight } : null, firstFocus: document.activeElement?.textContent?.trim() ?? null, firstLegal: first?.textContent?.trim() ?? null, focusedFirstLegal: first === document.activeElement } })()`)
    if (!menu.headings.includes('成長與收藏') || !menu.headings.includes('資料與設定') || !menu.focusedFirstLegal) throw new Error(`More menu focus/group contract failed: ${JSON.stringify(menu)}`)
    checkpoints.push(await capture('title-more', 'Title More grouping and first legal focus', menu))

    await clickText('設定')
    await waitFor('Boolean(document.querySelector("[data-modal-surface]"))', 10_000, 'Settings surface')
    await waitFor('!document.querySelector("#tools-menu-more")', 5_000, 'More menu close')
    const opened = await domDiagnostics()
    if (opened.surfaceCount !== 1 || opened.dialogCount !== 1 || !opened.rootInert || opened.rootAriaHidden !== 'true' || opened.bodyOverlayOpen !== 'true' || !opened.active.insideSurface || opened.dialogSemantics.labelledByExists !== true || opened.dialogSemantics.describedByExists !== true) throw new Error(`Settings surface contract failed: ${JSON.stringify(opened)}`)
    checkpoints.push(await capture('settings-open', 'More to Settings portal, inert root, labelled dialog and focus entry', opened))

    const focusableCount = await evaluate('document.querySelectorAll("[data-modal-surface] button:not([disabled]), [data-modal-surface] a[href], [data-modal-surface] input:not([disabled]), [data-modal-surface] select:not([disabled]), [data-modal-surface] textarea:not([disabled]), [data-modal-surface] [tabindex]:not([tabindex=\\"-1\\"])" ).length')
    if (focusableCount < 2) throw new Error(`Settings does not expose enough focusable controls: ${focusableCount}`)
    const keyboard = []
    for (let i = 0; i < focusableCount; i++) {
      await key('Tab')
      keyboard.push(await evaluate('(() => ({ inside: Boolean(document.querySelector("[data-modal-surface]")?.contains(document.activeElement)), label: document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent?.trim().slice(0, 80) || null }))()'))
    }
    const wrapped = await evaluate('document.activeElement === document.querySelector("[data-modal-close]")')
    await evaluate('document.querySelector("[data-modal-close]")?.focus(); true')
    await key('Tab', 8)
    const shiftTab = await evaluate('(() => { const surface = document.querySelector("[data-modal-surface]"); const focusable = [...surface.querySelectorAll("button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex=\\"-1\\"])" )]; return { inside: Boolean(surface?.contains(document.activeElement)), last: focusable.at(-1) === document.activeElement, label: document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent?.trim().slice(0, 80) || null } })()')
    if (keyboard.some((item) => !item.inside) || !wrapped || !shiftTab.inside || !shiftTab.last) throw new Error(`Settings focus trap failed: ${JSON.stringify({ focusableCount, keyboard, wrapped, shiftTab })}`)
    const zoom = await (async () => {
      await call('Emulation.setPageScaleFactor', { pageScaleFactor: 2 })
      await sleep(120)
      const result = await evaluate('(() => { const surface = document.querySelector("[data-modal-surface]"); const rect = surface?.getBoundingClientRect(); return { scale: visualViewport?.scale ?? null, visible: Boolean(rect && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0), overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 || document.body.scrollWidth > document.body.clientWidth + 1, inside: Boolean(surface?.contains(document.activeElement)) } })()')
      await call('Emulation.setPageScaleFactor', { pageScaleFactor: 1 })
      return result
    })()
    if (!zoom.visible || zoom.overflow || !zoom.inside) throw new Error(`Settings zoom boundary failed: ${JSON.stringify(zoom)}`)
    checkpoints.push(await capture('settings-keyboard', 'complete Tab/Shift-Tab cycle and browser zoom stay inside Settings', { focusableCount, keyboard, wrapped, shiftTab, zoom }))

    await key('Escape')
    await waitFor('!document.querySelector("[data-modal-surface]")', 5_000, 'Settings Escape close')
    const escapeRestore = await evaluate('(() => ({ route: document.querySelector("[data-app-shell]")?.dataset.route, focusIsMore: document.activeElement === document.querySelector("button[aria-label=\\"更多\\"]"), rootInert: document.getElementById("root")?.inert ?? false, stack: window.__MOBIE_OVERLAY__?.snapshot?.() ?? null }))()')
    if (!escapeRestore.focusIsMore || escapeRestore.rootInert || escapeRestore.stack?.stack?.length !== 0) throw new Error(`Escape focus restore failed: ${JSON.stringify(escapeRestore)}`)
    checkpoints.push(await capture('settings-escape-restore', 'Escape closes Settings and restores the More invoker', escapeRestore))

    await click('button[aria-label="開始冒險"]')
    await waitFor('document.querySelector("[data-app-shell]")?.dataset.route === "regionSelect"', 10_000, 'Region Select')
    await waitFor('Boolean(document.querySelector(".region-card"))', 10_000, 'Region content')
    const underlyingBefore = await evaluate('(() => { const owner = document.querySelector(".region-grid"); if (owner) owner.scrollTop = Math.min(120, owner.scrollHeight); return { owner: owner?.className ?? null, top: owner?.scrollTop ?? 0, scrollHeight: owner?.scrollHeight ?? 0, clientHeight: owner?.clientHeight ?? 0 } })()')
    await click('button[aria-label="更多"]')
    await waitFor('Boolean(document.querySelector("#tools-menu-more"))', 5_000, 'Region More menu')
    await clickText('設定')
    await waitFor('Boolean(document.querySelector("[data-modal-surface]"))', 10_000, 'Region Settings surface')
    await waitFor('!document.querySelector("#tools-menu-more")', 5_000, 'Region More menu close')
    const scrolled = await evaluate(`(() => { const body = document.querySelector('[data-modal-body]'); const owner = document.querySelector('.region-grid'); if (body) body.scrollTop = body.scrollHeight; const footer = document.querySelector('[data-modal-footer]'); const surface = document.querySelector('[data-modal-surface]'); return { underlyingBefore: ${JSON.stringify(underlyingBefore)}, underlyingAfter: owner?.scrollTop ?? 0, bodyScrollable: Boolean(body && body.scrollHeight > body.clientHeight), bodyScrollTop: body?.scrollTop ?? 0, footerVisible: Boolean(footer && surface && footer.getBoundingClientRect().bottom <= surface.getBoundingClientRect().bottom + 1), footerAction: Boolean(footer?.querySelector('button:not([disabled])')) } })()`)
    if (!scrolled.bodyScrollable || scrolled.underlyingAfter !== scrolled.underlyingBefore.top || !scrolled.footerVisible || !scrolled.footerAction) throw new Error(`Settings scroll ownership failed: ${JSON.stringify(scrolled)}`)
    checkpoints.push(await capture('region-settings-scrolled', 'Region scroll position survives Settings open while only modal body scrolls', scrolled))

    await evaluate('document.querySelector("[data-modal-backdrop]")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); true')
    await waitFor('!document.querySelector("[data-modal-surface]")', 5_000, 'Settings backdrop close')
    const backdropRestore = await evaluate('(() => ({ focusIsMore: document.activeElement === document.querySelector("button[aria-label=\\"更多\\"]"), route: document.querySelector("[data-app-shell]")?.dataset.route, rootInert: document.getElementById("root")?.inert ?? false, routeScrollTop: document.querySelector(".region-grid")?.scrollTop ?? null }))()')
    if (!backdropRestore.focusIsMore || backdropRestore.route !== 'regionSelect' || backdropRestore.rootInert || backdropRestore.routeScrollTop !== underlyingBefore.top) throw new Error(`Backdrop focus/scroll restore failed: ${JSON.stringify({ backdropRestore, underlyingBefore })}`)
    checkpoints.push(await capture('region-settings-backdrop-restore', 'Backdrop policy closes Settings and restores More on Region', backdropRestore))

    await click('button[aria-label="更多"]')
    await waitFor('Boolean(document.querySelector("#tools-menu-more"))', 5_000, 'Region More menu for cleanup')
    await clickText('設定')
    await waitFor('Boolean(document.querySelector("[data-modal-surface]"))', 10_000, 'Settings surface for route cleanup')
    await waitFor('!document.querySelector("#tools-menu-more")', 5_000, 'More menu close for route cleanup')
    await evaluate('window.__MOBIE_M24_BASELINE__?.sendGameEvent({ type: "BACK" }); true')
    await waitFor('document.querySelector("[data-app-shell]")?.dataset.route === "title"', 10_000, 'route cleanup Title')
    await waitFor('!document.querySelector("[data-modal-surface]")', 5_000, 'route cleanup overlay close')
    const cleanup = await domDiagnostics()
    if (cleanup.overlayDepth !== 0 || cleanup.rootInert || cleanup.bodyOverlayOpen !== null) throw new Error(`Route cleanup failed: ${JSON.stringify(cleanup)}`)
    checkpoints.push(await capture('route-change-cleanup', 'Route change clears the overlay stack and unlocks the app root', cleanup))

    await click('button[aria-label="我的 Mobie"]')
    await waitFor('document.querySelector("[data-overlay-id=\\"team\\"]") && Boolean(document.querySelector("[data-modal-surface]"))', 10_000, 'Team surface')
    await waitFor('Boolean(document.querySelector(".team-row__main"))', 10_000, 'Team rows')
    await click('.team-row__main')
    await waitFor('document.querySelector("[data-overlay-host]")?.dataset.overlayDepth === "2"', 5_000, 'nested detail push')
    const pushed = await domDiagnostics()
    if (pushed.surfaceCount !== 1 || pushed.overlay?.stack?.length !== 2) throw new Error(`Nested push contract failed: ${JSON.stringify(pushed)}`)
    await key('Escape')
    await waitFor('document.querySelector("[data-overlay-host]")?.dataset.overlayDepth === "1"', 5_000, 'nested detail pop')
    await waitFor('Boolean(document.querySelector("[data-modal-surface]"))', 5_000, 'Team surface after nested pop')
    await waitFor('Boolean(document.activeElement?.getAttribute("data-mobie-invoker"))', 5_000, 'nested invoker restore')
    const popped = await domDiagnostics()
    if (popped.overlayId !== 'team' || popped.surfaceCount !== 1 || !popped.active.mobieInvoker) throw new Error(`Nested pop contract failed: ${JSON.stringify(popped)}`)
    checkpoints.push(await capture('nested-push-pop', 'Mobie detail uses push/pop with one active ModalSurface', { pushed, popped }))

    const final = await domDiagnostics()
    const index = { schemaVersion: 1, scenarioId: SCENARIO_ID, baselineCommit: BASELINE_COMMIT, device, viewport: VIEWPORT, journey: JOURNEY, checkpoints, errors: cdp.errors, final }
    await writeFile(resolve(outputRoot, 'index.json'), `${JSON.stringify(index, null, 2)}\n`)
    if (cdp.errors.console.length || cdp.errors.unhandled.length || cdp.errors.networkFailed.length) throw new Error(`Unexpected browser errors: ${JSON.stringify(cdp.errors)}`)
    console.log(`Ticket 24 overlay baseline passed: ${checkpoints.length} checkpoints`)
  } catch (error) {
    await writeFile(resolve(outputRoot, 'failure.json'), `${JSON.stringify({ schemaVersion: 1, scenarioId: SCENARIO_ID, baselineCommit: BASELINE_COMMIT, viewport: VIEWPORT, error: error instanceof Error ? error.message : String(error), errors: cdp.errors }, null, 2)}\n`)
    throw error
  } finally {
    cdp.close()
  }
}

main().catch((error) => {
  console.error(`Ticket 24 overlay baseline failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
