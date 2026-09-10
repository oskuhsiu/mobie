// Ticket 48 Chrome closure matrix for the real Region → Encounter → Team → Battle
// → Result and Tower loops. Run with Vite and a local Chrome CDP target:
//   npm run dev -- --host 127.0.0.1
//   /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/mobie-ticket48 about:blank
//   node scripts/m24-ticket48-closure.mjs --port=9222

import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const SCENARIO = 'm24-post-m23-chrome-v1'
const OUTPUT_ROOT = resolve('test-runs', 'm24', 'ticket48-chrome')
const VIEWPORTS = [
  { id: 'wide-landscape', width: 1180, height: 820 },
  { id: 'mid-landscape', width: 1024, height: 768 },
  { id: 'short-landscape', width: 852, height: 393 },
  { id: 'tablet-portrait', width: 1024, height: 1366 },
  { id: 'phone-portrait', width: 393, height: 852 },
]

const port = Number(process.argv.find((arg) => arg.startsWith('--port='))?.slice(7) ?? 9222)
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))

async function connect() {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const target = targets.find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl)
  if (!target) throw new Error('No Chrome page target')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolveOpen, rejectOpen) => { ws.onopen = resolveOpen; ws.onerror = rejectOpen })
  let nextId = 0
  const pending = new Map()
  const events = []
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) request.reject(new Error(message.error.message))
      else request.resolve(message.result)
      return
    }
    events.push(message)
  }
  const call = (method, params = {}) => new Promise((resolveCall, rejectCall) => {
    const id = ++nextId
    pending.set(id, { resolve: resolveCall, reject: rejectCall })
    ws.send(JSON.stringify({ id, method, params }))
  })
  return { call, events, close: () => ws.close() }
}

async function main() {
  const cdp = await connect()
  const { call, events } = cdp
  const checkpoints = []
  const matrix = []
  let eventCursor = 0
  let currentViewport = { ...VIEWPORTS[0], scale: 1 }

  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'Runtime.evaluate failed')
    }
    return result.result?.value
  }

  const seedModelSentinel = async () => evaluate(`(async () => {
    const request = indexedDB.open('mz-models', 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('models')) request.result.createObjectStore('models', { keyPath: 'id' })
    }
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('models', 'readwrite')
      transaction.objectStore('models').put({ id: 'ticket48-sentinel', payload: 'untouched' })
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error)
    })
    db.close()
    return true
  })()`)

  const readModelSentinel = async () => evaluate(`(async () => {
    const request = indexedDB.open('mz-models')
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    if (!db.objectStoreNames.contains('models')) { db.close(); return null }
    const value = await new Promise((resolve, reject) => {
      const transaction = db.transaction('models', 'readonly')
      const get = transaction.objectStore('models').get('ticket48-sentinel')
      get.onsuccess = () => resolve(get.result ?? null)
      get.onerror = () => reject(get.error)
    })
    db.close()
    return value
  })()`)

  const waitFor = async (expression, timeout = 15_000) => {
    const deadline = Date.now() + timeout
    let lastValue
    while (Date.now() < deadline) {
      lastValue = await evaluate(expression)
      if (lastValue) return lastValue
      await sleep(60)
    }
    throw new Error(`Timed out waiting for ${expression}; last=${JSON.stringify(lastValue)}`)
  }

  const click = async (selector, index = 0) => {
    const clicked = await evaluate(`(() => {
      const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})]
      const node = nodes[${index}]
      if (!node || node.disabled || node.getAttribute('aria-disabled') === 'true') return { ok: false, count: nodes.length, route: document.querySelector('[data-app-shell]')?.dataset.route ?? null, body: (document.body.innerText || '').slice(0, 180) }
      node.focus?.({ preventScroll: true })
      node.click()
      return { ok: true, count: nodes.length }
    })()`)
    if (!clicked?.ok) throw new Error(`Cannot click ${selector}[${index}]: ${JSON.stringify(clicked)}`)
  }

  const pressKey = async (key) => evaluate(`(() => {
    const event = new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true })
    document.dispatchEvent(event)
    return { defaultPrevented: event.defaultPrevented, overlay: Boolean(document.querySelector('[data-overlay-host]')) }
  })()`)

  const pressBackdrop = async () => evaluate(`(() => {
    const backdrop = document.querySelector('[data-modal-backdrop]')
    if (!backdrop) return false
    backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    return Boolean(document.querySelector('[data-overlay-host]'))
  })()`)

  const activateFocused = async (key) => {
    return evaluate(`(() => {
      const node = document.activeElement
      if (!(node instanceof HTMLElement)) return false
      const event = new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true })
      node.dispatchEvent(event)
      // DOM button activation is the browser's follow-up to Enter/Space. Keep
      // the same semantic action when the CDP target is headless/hidden.
      if (!event.defaultPrevented && typeof node.click === 'function') node.click()
      return true
    })()`)
  }

  const setResultStorageFailure = async (enabled) => evaluate(`(() => {
    if (${enabled}) {
      if (!window.__T48_STORAGE_ORIGINAL__) window.__T48_STORAGE_ORIGINAL__ = Storage.prototype.setItem
      Storage.prototype.setItem = function(key, value) {
        if (key === 'mobie.result.settlement.v1') throw new Error('Ticket 48 injected Result storage failure')
        return window.__T48_STORAGE_ORIGINAL__.call(this, key, value)
      }
    } else if (window.__T48_STORAGE_ORIGINAL__) {
      Storage.prototype.setItem = window.__T48_STORAGE_ORIGINAL__
    }
    return true
  })()`)

  const setViewport = async (width, height, scale = 1) => {
    await call('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: true,
      screenWidth: width,
      screenHeight: height,
      screenOrientation: { type: width >= height ? 'landscapePrimary' : 'portraitPrimary', angle: 0 },
    })
    await call('Emulation.setPageScaleFactor', { pageScaleFactor: scale })
    currentViewport = { id: `${width}x${height}`, width, height, scale }
    await sleep(120)
  }

  const routeState = () => evaluate(`(async () => {
    const app = document.querySelector('[data-app-shell]')
    const result = document.querySelector('[data-result]')
    const visible = (node) => {
      if (!node) return false
      const rect = node.getBoundingClientRect()
      const style = getComputedStyle(node)
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
    }
    const scrollOwners = [...document.querySelectorAll('*')].filter((node) => {
      const style = getComputedStyle(node)
      return (style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 1
    }).map((node) => ({
      tag: node.tagName,
      className: String(node.className),
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
    }))
    const targetHeights = [...document.querySelectorAll('button, [role="button"]')]
      .filter(visible)
      .map((node) => node.getBoundingClientRect().height)
    const text = (document.body.innerText || '').replace(/\\s+/g, ' ').trim()
    const prohibited = ['GLB', 'GLTF', 'custom model', 'encounter style', 'style tags', 'style stats', 'module off']
      .filter((needle) => text.toLowerCase().includes(needle.toLowerCase()))
    const resultActions = [...document.querySelectorAll('[data-result-next], [data-result-retry], [data-result-error-back]')]
      .filter(visible).map((node) => ({
        id: node.getAttribute('data-result-next') || node.getAttribute('data-result-retry') || node.getAttribute('data-result-error-back'),
        text: (node.textContent || '').replace(/\\s+/g, ' ').trim(),
        disabled: node.disabled,
      }))
    const legalAction = [...document.querySelectorAll('button, [role="button"]')].find((node) => visible(node) && !node.disabled && node.getAttribute('aria-disabled') !== 'true')
    const legalRect = legalAction?.getBoundingClientRect()
    const scrollProbe = document.querySelector('[data-region-card], [data-result-next]:not([disabled]), [data-tower-start]:not([disabled])')
    const scrollProbeRect = scrollProbe?.getBoundingClientRect()
    return {
      route: app?.dataset.route ?? null,
      overlay: document.querySelector('[data-overlay-host]')?.dataset.overlayId ?? null,
      encounter: document.querySelector('[data-encounter]')?.dataset.encounterState ?? null,
      team: document.querySelector('[data-team-select]')?.dataset.teamSelectState ?? null,
      towerSetup: document.querySelector('[data-tower-setup]')?.dataset.towerSetupState ?? null,
      result: result ? {
        mode: result.dataset.resultMode ?? null,
        outcome: result.dataset.resultOutcome ?? null,
        reason: result.dataset.resultReason ?? 'natural',
        settlement: result.dataset.resultSettlementStatus ?? null,
        towerState: result.dataset.resultTowerResultState ?? null,
        towerRunState: result.dataset.resultTowerRunState ?? null,
        towerReceipt: result.dataset.resultTowerReceipt ?? null,
        id: result.dataset.resultId ?? null,
        fingerprint: result.dataset.resultFingerprint ?? null,
      } : null,
      evolutionCount: Number(result?.dataset.resultEvolutionCount ?? 0),
      evolutionOverlay: Boolean(document.querySelector('.evo-overlay')),
      cameraRequests: Number(window.__M24_CAMERA_REQUESTS__ ?? 0),
      resultActions,
      legalAction: legalRect ? {
        text: (legalAction.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120),
        inViewport: legalRect.top >= -2 && legalRect.bottom <= innerHeight + 2,
        top: legalRect.top,
        bottom: legalRect.bottom,
      } : null,
      scrollProbe: scrollProbeRect ? {
        text: (scrollProbe.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120),
        inViewport: scrollProbeRect.top >= -2 && scrollProbeRect.bottom <= innerHeight + 2,
        top: scrollProbeRect.top,
        bottom: scrollProbeRect.bottom,
      } : null,
      focus: {
        tag: document.activeElement?.tagName ?? null,
        className: String(document.activeElement?.className ?? ''),
        text: (document.activeElement?.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 100),
        insideOverlay: Boolean(document.querySelector('[data-modal-surface]')?.contains(document.activeElement)),
      },
      overflow: {
        document: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        body: document.body.scrollWidth > document.body.clientWidth + 1,
        width: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      },
      scrollOwners,
      targetHeights: {
        min: targetHeights.length ? Math.min(...targetHeights) : null,
        allAtLeast44: targetHeights.every((height) => height >= 44),
      },
      artworkFailures: document.querySelectorAll('[data-artwork-state="failed"]').length,
      artworkLoading: document.querySelectorAll('[data-artwork-state="loading"]').length,
      prohibited,
      safeArea: {
        appPadding: getComputedStyle(document.querySelector('[data-app-shell]') ?? document.body).padding,
        viewportPadding: getComputedStyle(document.querySelector('[data-screen-viewport]') ?? document.body).padding,
      },
      storage: (() => {
        const values = {}
        for (const key of Object.keys(localStorage).sort()) {
          const raw = localStorage.getItem(key) ?? ''
          try {
            const parsed = JSON.parse(raw)
            values[key] = {
              bytes: raw.length,
              schemaVersion: parsed?.schemaVersion ?? null,
              count: Array.isArray(parsed) ? parsed.length : (parsed?.roster?.length ?? parsed?.eggs?.length ?? parsed?.cards?.length ?? null),
              resultSettlements: Array.isArray(parsed?.resultSettlements) ? parsed.resultSettlements.length : null,
              markers: Array.isArray(parsed) ? parsed.length : null,
            }
          } catch {
            values[key] = { bytes: raw.length, malformed: true }
          }
        }
        return values
      })(),
      performance: (() => {
        const entries = performance.getEntriesByType('resource')
        return {
          resources: entries.length,
          threeOrModel: entries.filter((entry) => /\\.(glb|gltf)(?:$|\\?)/i.test(entry.name) || /custom.?model/i.test(entry.name)).map((entry) => String(entry.name)),
        }
      })(),
      modelDatabases: typeof indexedDB.databases === 'function'
        ? (await indexedDB.databases()).map((database) => database.name).filter(Boolean)
        : [],
      unhandledRejections: Array.isArray(window.__T48_UNHANDLED__) ? window.__T48_UNHANDLED__.length : 0,
      viewport: { ...${JSON.stringify(currentViewport)}, innerWidth, innerHeight, pageScale: visualViewport?.scale ?? 1 },
    }
  })()`)

  const capture = async (name, observation = {}) => {
    const preCapture = await evaluate(`({
      evolutionOverlay: Boolean(document.querySelector('.evo-overlay')),
      settlement: document.querySelector('[data-result]')?.dataset.resultSettlementStatus ?? null,
    })`)
    const screenshot = await call('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
      const diagnostics = await routeState()
    const axTree = await call('Accessibility.getFullAXTree', { depth: -1 })
    const ax = (axTree.nodes ?? [])
      .filter((node) => !node.ignored && node.role?.value && node.name?.value)
      .map((node) => ({
        role: String(node.role.value),
        name: String(node.name.value),
        checked: node.properties?.find((property) => property.name === 'checked')?.value?.value ?? null,
        expanded: node.properties?.find((property) => property.name === 'expanded')?.value?.value ?? null,
      }))
    const newEvents = events.slice(eventCursor)
    eventCursor = events.length
    const record = {
      checkpoint: name,
      capturedAt: new Date().toISOString(),
      observation,
      preCapture,
      diagnostics,
      ax,
      cdp: {
        consoleErrors: newEvents.filter((event) => event.method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(event.params?.type)).length,
        runtimeExceptions: newEvents.filter((event) => event.method === 'Runtime.exceptionThrown').length,
        networkFailed: newEvents.filter((event) => event.method === 'Network.loadingFailed').map((event) => event.params?.errorText ?? 'unknown'),
      },
    }
    await mkdir(resolve(OUTPUT_ROOT, name), { recursive: true })
    await writeFile(resolve(OUTPUT_ROOT, name, 'screenshot.png'), Buffer.from(screenshot.data, 'base64'))
    await writeFile(resolve(OUTPUT_ROOT, name, 'metrics.json'), `${JSON.stringify(record, null, 2)}\n`)
    checkpoints.push(record)
    return record
  }

  const navigate = async (extra = '') => {
    const url = new URL('http://127.0.0.1:5173/')
    url.searchParams.set('m24Scenario', SCENARIO)
    url.searchParams.set('ticket48Run', `${Date.now()}-${Math.random().toString(36).slice(2)}`)
    if (extra) for (const [key, value] of new URLSearchParams(extra)) url.searchParams.set(key, value)
    await call('Page.navigate', { url: url.href })
    await waitFor("document.readyState === 'complete'", 20_000)
    await waitFor("Boolean(document.querySelector('[data-app-shell]'))", 20_000)
    await waitFor("document.querySelector('[data-app-shell]')?.dataset.bootstrapStatus === 'ready'", 20_000)
    await waitFor('Boolean(window.__MOBIE_M24_BASELINE__?.ready?.())', 20_000)
    await evaluate(`(() => {
      if (window.__T48_UNHANDLED__) return true
      window.__T48_UNHANDLED__ = []
      window.addEventListener('unhandledrejection', (event) => window.__T48_UNHANDLED__.push(String(event.reason ?? 'unknown')))
      return true
    })()`)
    await evaluate('(async()=>{ await window.__MOBIE_M24_BASELINE__.seedContent(); return true })()')
  }

  const ensureRegion = async () => {
    const route = await evaluate("document.querySelector('[data-app-shell]')?.dataset.route")
    if (route === 'title') {
      await click('.title-screen__adventure')
      await waitFor("document.querySelector('[data-app-shell]')?.dataset.route === 'regionSelect'")
    } else if (route !== 'regionSelect') {
      await click('[data-result-next="regions"], [data-result-error-back], [data-encounter-back], [data-team-select] .team-select__topbar button, [data-tower-setup] .tower-setup__topbar button')
      await waitFor("document.querySelector('[data-app-shell]')?.dataset.route === 'regionSelect'")
    }
  }

  const chooseWild = async ({ requireSupply = false } = {}) => {
    await ensureRegion()
    const count = await evaluate('document.querySelectorAll("[data-region-card]").length')
    let supplyFound = false
    for (let index = 0; index < count; index += 1) {
      await click('[data-region-card]', index)
      await waitFor("document.querySelector('[data-app-shell]')?.dataset.route === 'encounter'")
      const hasSupply = await evaluate('Boolean(document.querySelector("[data-encounter-supply]"))')
      if (hasSupply) {
        supplyFound = true
        await capture('wild-supply-required', { source: 'wild encounter', explicitActionOnly: true })
        const escape = await pressKey('Escape')
        const backdropStayed = await pressBackdrop()
        if (!escape.overlay || !backdropStayed) throw new Error('Explicit supply was dismissible by Escape/backdrop')
        await capture('wild-supply-dismiss-guard', { escapeIgnored: true, backdropIgnored: true })
        await click('[data-supply-option]')
        await waitFor('!document.querySelector("[data-overlay-host]")')
        break
      }
      if (requireSupply) {
        await click('[data-encounter-back]')
        await waitFor("document.querySelector('[data-app-shell]')?.dataset.route === 'regionSelect'")
      } else break
    }
    if (requireSupply && !supplyFound) throw new Error('No deterministic wild supply encounter found')
    return supplyFound
  }

  const enterBattle = async (captureCheckpoint = true) => {
    await waitFor("document.querySelector('[data-app-shell]')?.dataset.route === 'encounter'")
    if (await evaluate('Boolean(document.querySelector("[data-encounter-supply]"))')) {
      await click('[data-supply-option]')
      await waitFor('!document.querySelector("[data-overlay-host]")')
    }
    await click('[data-encounter-engage]')
    await waitFor("document.querySelector('[data-app-shell]')?.dataset.route === 'cardSelect'")
    if (captureCheckpoint) await capture('team-select-incomplete', { routeEvent: 'ENGAGE', expected: 'SELECT_TEAM disabled until three cards' })
    if (captureCheckpoint) {
      await click('[data-card-info]')
      await waitFor('Boolean(document.querySelector("[data-modal-surface]"))')
      await capture('team-card-detail', { keyboard: 'Escape', invokerRestore: true, backdropDismiss: true })
      await pressBackdrop()
      const detailBackdropClosed = await waitFor('!document.querySelector("[data-modal-surface]")')
      if (!detailBackdropClosed) throw new Error('Team detail backdrop did not dismiss')
      await click('[data-card-info]')
      await waitFor('Boolean(document.querySelector("[data-modal-surface]"))')
      const detailEscape = await pressKey('Escape')
      await waitFor('!document.querySelector("[data-modal-surface]")')
      const detailFocusRestored = await waitFor('Boolean(document.activeElement?.matches("[data-card-info]"))', 3_000)
      if (!detailEscape.defaultPrevented || !detailFocusRestored) throw new Error('Team detail Escape/invoker restore failed')
    }
    await evaluate(`(() => {
      const cards = [...document.querySelectorAll('[data-card-select]')]
        .filter((node) => node.getAttribute('aria-pressed') !== 'true' && !node.disabled)
        .slice(0, 3)
      cards.forEach((node) => node.click())
      return cards.length
    })()`)
    await waitFor('Boolean(document.querySelector("[data-team-start-footer] button:not([disabled])"))')
    if (captureCheckpoint) await capture('team-select-ready', { selected: await evaluate('document.querySelectorAll("[data-card-select][aria-pressed=\\"true\\"]").length') })
    await click('[data-team-start-footer] button')
    await waitFor("document.querySelector('[data-app-shell]')?.dataset.route === 'battle'", 20_000)
    await waitFor('Boolean(document.querySelector("[data-battle-shell]"))', 20_000)
    if (captureCheckpoint) await capture('battle-handoff', { routeEvent: 'SELECT_TEAM', context: 'canonical player/foe cards' })
    await evaluate('window.__MOBIE_M24_BASELINE__.prepareBattleChoice(); true')
    await waitFor("document.querySelector('[data-command-phase]')?.dataset.commandPhase === 'playerChoice'", 10_000)
  }

  const finishBattle = async (outcome, identity, reason, pendingCheckpoint) => {
    if (identity) {
      await evaluate(`window.__MOBIE_M24_BASELINE__.endBattleWithIdentity(${JSON.stringify(outcome)}, ${JSON.stringify(identity)}); true`)
    } else if (reason) {
      const timeoutIdentity = {
        resultId: `m24-ticket48:${Date.now()}:timeout`,
        resultFingerprint: `m24-ticket48:${Date.now()}:timeout-fingerprint`,
        reason,
      }
      await evaluate(`window.__MOBIE_M24_BASELINE__.endBattleWithIdentity(${JSON.stringify(outcome)}, ${JSON.stringify(timeoutIdentity)}); true`)
    } else {
      await evaluate(`window.__MOBIE_M24_BASELINE__.endBattle(${JSON.stringify(outcome)}); true`)
    }
    await waitFor("document.querySelector('[data-app-shell]')?.dataset.route === 'result'", 20_000)
    if (pendingCheckpoint) await capture(pendingCheckpoint, { sampledBeforeSettlement: true, outcome })
    await waitFor("document.querySelector('[data-result]')?.dataset.resultSettlementStatus === 'settled' || document.querySelector('[data-result]')?.dataset.resultSettlementStatus === 'error'", 20_000)
  }

  const exitToRegion = async () => {
    const route = await evaluate("document.querySelector('[data-app-shell]')?.dataset.route")
    if (route === 'result') {
      const action = await evaluate(`(() => {
        const node = document.querySelector('[data-result-next="regions"], [data-result-next="tower-quit"], [data-result-error-back]')
        if (!node || node.disabled) return false
        node.click(); return true
      })()`)
      if (!action) throw new Error('No enabled Result region exit')
      await waitFor("document.querySelector('[data-app-shell]')?.dataset.route === 'regionSelect'")
    } else if (route === 'encounter') {
      if (await evaluate('Boolean(document.querySelector("[data-encounter-supply]"))')) {
        await click('[data-supply-return]')
      } else await click('[data-encounter-back]')
      await waitFor("document.querySelector('[data-app-shell]')?.dataset.route === 'regionSelect'")
    } else if (route === 'cardSelect') {
      await click('.team-select__topbar > button')
      await waitFor("document.querySelector('[data-app-shell]')?.dataset.route === 'encounter'")
      await click('[data-encounter-back]')
      await waitFor("document.querySelector('[data-app-shell]')?.dataset.route === 'regionSelect'")
    } else if (route === 'towerSetup') {
      await click('.tower-setup__topbar > button')
      await waitFor("document.querySelector('[data-app-shell]')?.dataset.route === 'regionSelect'")
    }
  }

  const towerJourney = async () => {
    await ensureRegion()
    await click('.tower-cta')
    await waitFor("document.querySelector('[data-app-shell]')?.dataset.route === 'towerSetup'")
    await waitFor('Boolean(document.querySelector("[data-tower-setup]"))')
    await capture('tower-setup', { routeEvent: 'OPEN_TOWER', stakes: true, fixedTeam: true })
    await evaluate(`(() => {
      const cards = [...document.querySelectorAll('[data-tower-roster-grid] button')]
        .filter((node) => !node.disabled && node.getAttribute('aria-pressed') !== 'true')
        .slice(0, 3)
      cards.forEach((node) => node.click())
      return cards.length
    })()`)
    await waitFor('Boolean(document.querySelector("[data-tower-start]:not([disabled])"))')
    await click('[data-tower-start]')
    if (await evaluate('Boolean(document.querySelector("[data-gesture-skip]"))')) await click('[data-gesture-skip]')
    await waitFor("document.querySelector('[data-app-shell]')?.dataset.route === 'battle'", 20_000)
    await evaluate('window.__MOBIE_M24_BASELINE__.prepareBattleChoice(); true')
    await waitFor("document.querySelector('[data-command-phase]')?.dataset.commandPhase === 'playerChoice'", 10_000)
    await finishBattle('win', undefined, 'timeout')
    await capture('tower-win-result', { routeEvent: 'END_BATTLE', outcome: 'win', reason: 'timeout', cta: 'TOWER_CONTINUE' })
    await click('[data-result-next="tower-continue"]')
    await waitFor("document.querySelector('[data-app-shell]')?.dataset.route === 'battle'", 20_000)
    await capture('tower-next-floor-battle', { routeEvent: 'TOWER_CONTINUE', expectedFloor: 2 })
    await evaluate('window.__MOBIE_M24_BASELINE__.prepareBattleChoice(); true')
    await waitFor("document.querySelector('[data-command-phase]')?.dataset.commandPhase === 'playerChoice'", 10_000)
    await finishBattle('lose')
    await capture('tower-lose-result', { routeEvent: 'END_BATTLE', outcome: 'lose', cta: 'TOWER_QUIT' })
    await click('[data-result-next="tower-quit"]')
    await waitFor("document.querySelector('[data-app-shell]')?.dataset.route === 'regionSelect'")
  }

  await Promise.all([
    call('Runtime.enable'),
    call('Page.enable'),
    call('Accessibility.enable'),
    call('Network.enable'),
    call('Log.enable'),
    call('Performance.enable'),
  ])
  await call('Storage.clearDataForOrigin', { origin: 'http://127.0.0.1:5173', storageTypes: 'all' })
  await evaluate(`(async () => {
    localStorage.clear()
    if (typeof indexedDB.databases === 'function') {
      for (const database of await indexedDB.databases()) {
        if (database.name) indexedDB.deleteDatabase(database.name)
      }
    }
    return true
  })()`)
  await seedModelSentinel()
  await setViewport(1180, 820)
  await navigate()
  await click('button[aria-label="更多"]')
  await waitFor('Boolean(document.querySelector("#tools-menu-more"))')
  const scannerOff = await capture('scanner-off', { scannerEnabled: false, expected: 'scanner entry absent until explicit Settings enable' })
  if (await evaluate('Boolean(document.querySelector("[data-tool=\\"scanner\\"]"))')) throw new Error('Scanner entry visible while scannerEnabled is false')
  await pressKey('Escape')
  await waitFor('document.querySelector("button[aria-label=\\"更多\\"]")?.getAttribute("aria-expanded") === "false"')
  await ensureRegion()
  await capture('region-hub', { routeEvent: 'START', expected: 'Region Hub' })
  await click('button[aria-label="更多"]')
  await waitFor('Boolean(document.querySelector("#tools-menu-more"))')
  const scannerOffRegion = await capture('scanner-off-region', { scannerEnabled: false, route: 'regionSelect', permissionRequests: 0 })
  if (await evaluate('Boolean(document.querySelector("[data-tool=\\"scanner\\"]"))')) throw new Error('Scanner entry visible in Region while scannerEnabled is false')
  await pressKey('Escape')
  await waitFor('document.querySelector("button[aria-label=\\"更多\\"]")?.getAttribute("aria-expanded") === "false"')

  // DEV-only failure fixtures exercise the real Encounter recovery surface
  // after the route is reached from Region Hub. They do not replace the normal
  // data journey below; the retry returns to the same XState encounter flow.
  await evaluate(`(() => { const url = new URL(location.href); url.searchParams.set('m24EncounterFixture', 'missing-target'); history.replaceState({}, '', url); return true })()`)
  await click('[data-region-card]')
  await waitFor("document.querySelector('[data-encounter]')?.dataset.encounterState === 'error'")
  await capture('encounter-missing-target', { fixture: 'missing-target', retry: true, back: true })
  await click('[data-encounter-retry]')
  await waitFor("document.querySelector('[data-encounter]')?.dataset.encounterState === 'ready'")
  await exitToRegion()

  await evaluate(`(() => { const url = new URL(location.href); url.searchParams.set('m24EncounterFixture', 'artwork-failure'); history.replaceState({}, '', url); return true })()`)
  await click('[data-region-card]')
  await waitFor("document.querySelector('[data-encounter]')?.dataset.encounterState === 'ready'")
  if (await evaluate('Boolean(document.querySelector("[data-encounter-supply]"))')) {
    await click('[data-supply-option]')
    await waitFor('!document.querySelector("[data-overlay-host]")')
  }
  await waitFor('Boolean(document.querySelector("[data-encounter-artwork-error]"))', 10_000)
  await capture('encounter-artwork-fallback', { fixture: 'artwork-failure', retry: true, fallback: 'silhouette' })
  await click('[data-encounter-artwork-retry]')
  await waitFor('!document.querySelector("[data-encounter-artwork-error]")')
  await exitToRegion()

  await chooseWild()
  await click('[data-encounter] button[aria-label*="資訊卡"]')
  await waitFor('Boolean(document.querySelector("[data-modal-surface]"))')
  await evaluate('window.__MOBIE_M24_BASELINE__.sendGameEvent({ type: "BACK" }); true')
  await waitFor("document.querySelector('[data-app-shell]')?.dataset.route === 'regionSelect'")
  const routeCleanup = await capture('route-change-cleanup', { overlayOpen: true, event: 'BACK', expected: 'overlay cleared with route' })
  if (routeCleanup.diagnostics.overlay !== null || routeCleanup.diagnostics.route !== 'regionSelect') throw new Error('Route change left a stale overlay')

  await chooseWild({ requireSupply: true })
  await capture('wild-encounter', { explicitSupplyResolved: true, captureBoundary: true })
  await click('[data-encounter] button[aria-label*="資訊卡"]')
  await waitFor('Boolean(document.querySelector("[data-modal-surface]"))')
  await capture('encounter-detail', { keyboard: 'Escape', invokerRestore: true, backdropDismiss: true })
  await pressBackdrop()
  const detailBackdropClosed = await waitFor('!document.querySelector("[data-modal-surface]")')
  if (!detailBackdropClosed) throw new Error('Encounter detail backdrop did not dismiss')
  await click('[data-encounter] button[aria-label*="資訊卡"]')
  await waitFor('Boolean(document.querySelector("[data-modal-surface]"))')
  const detailEscape = await pressKey('Escape')
  await waitFor('!document.querySelector("[data-modal-surface]")')
  const detailFocusRestored = await waitFor('Boolean(document.activeElement?.matches("[data-encounter] button[aria-label*=\\"資訊卡\\"]"))', 3_000)
  if (!detailEscape.defaultPrevented || !detailFocusRestored) throw new Error('Encounter detail Escape/invoker restore failed')
  await enterBattle()
  await finishBattle('win', undefined, undefined, 'result-settlement-running')
  await waitFor('Boolean(document.querySelector("[data-result-next=\\"play-again\\"]"))', 10_000)
  const wildWin = await capture('wild-win-result', { routeEvent: 'END_BATTLE', outcome: 'win', capture: 'deterministic capture presentation', resultCtaReady: true })
  if (await evaluate('Boolean(document.querySelector("[data-result-capture-detail]"))')) {
    await click('[data-result-capture-detail]')
    await waitFor('Boolean(document.querySelector("[data-modal-surface]"))')
    await capture('result-detail', { keyboard: 'Escape', invokerRestore: true, backdropDismiss: true })
    await pressBackdrop()
    const detailBackdropClosed = await waitFor('!document.querySelector("[data-modal-surface]")')
    if (!detailBackdropClosed) throw new Error('Result detail backdrop did not dismiss')
    await click('[data-result-capture-detail]')
    await waitFor('Boolean(document.querySelector("[data-modal-surface]"))')
    const detailEscape = await pressKey('Escape')
    await waitFor('!document.querySelector("[data-modal-surface]")')
    const detailFocusRestored = await waitFor('Boolean(document.activeElement?.matches("[data-result-capture-detail]"))', 3_000)
    if (!detailEscape.defaultPrevented || !detailFocusRestored) throw new Error('Result detail Escape/invoker restore failed')
  }
  const collisionIdentity = {
    resultId: wildWin.diagnostics.result?.id,
    resultFingerprint: wildWin.diagnostics.result?.fingerprint,
  }
  if (!collisionIdentity.resultId || !collisionIdentity.resultFingerprint) throw new Error('Wild Result did not expose a stable identity pair')
  await click('[data-result-next="play-again"]')
  await waitFor("document.querySelector('[data-app-shell]')?.dataset.route === 'encounter'")
  await capture('play-again-encounter', { routeEvent: 'PLAY_AGAIN', rerolled: true })
  await exitToRegion()

  await ensureRegion()
  await click('.practice-cta')
  await waitFor("document.querySelector('[data-app-shell]')?.dataset.route === 'encounter'")
  await enterBattle(false)
  await finishBattle('win')
  await waitFor('Boolean(document.querySelector("[data-result-next=\\"regions\\"]"))')
  await capture('arena-win-result', { routeEvent: 'END_BATTLE', outcome: 'win', capture: 'absent', mode: 'arena' })
  await exitToRegion()

  await chooseWild()
  await enterBattle(false)
  await finishBattle('lose')
  await waitFor('Boolean(document.querySelector("[data-result-next=\\"regions\\"]"))')
  await capture('wild-lose-result', { routeEvent: 'END_BATTLE', outcome: 'lose', capture: 'absent', settlement: 'settled' })
  await exitToRegion()

  await towerJourney()

  // Storage failure/retry: the first journal write fails, then the same
  // identity retries and settles without issuing a second battle result.
  await ensureRegion()
  await click('.practice-cta')
  await waitFor("document.querySelector('[data-app-shell]')?.dataset.route === 'encounter'")
  await enterBattle(false)
  await setResultStorageFailure(true)
  await finishBattle('lose', {
    resultId: `m24-ticket48:storage-failure:${Date.now()}`,
    resultFingerprint: `m24-ticket48:storage-failure-fingerprint:${Date.now()}`,
  })
  await waitFor("document.querySelector('[data-result]')?.dataset.resultSettlementStatus === 'error'")
  const storageError = await capture('result-storage-error', { storageFailure: true, retry: true, noCanonicalApplyExpected: true })
  await setResultStorageFailure(false)
  await click('[data-result-retry]')
  await waitFor("document.querySelector('[data-result]')?.dataset.resultSettlementStatus === 'settled'", 10_000)
  await waitFor('Boolean(document.querySelector("[data-result-next=\\"regions\\"]"))')
  const storageRetry = await capture('result-storage-retry', { storageFailureRecovered: true, sameIdentity: true })
  if (storageError.diagnostics.result?.settlement !== 'error' || storageRetry.diagnostics.result?.settlement !== 'settled') {
    throw new Error('Result storage failure did not expose retryable recovery')
  }
  await exitToRegion()

  await ensureRegion()
  await evaluate('window.__MOBIE_M24_BASELINE__.prepareRosterFixture("empty"); true')
  await click('.tower-cta')
  await waitFor("document.querySelector('[data-app-shell]')?.dataset.route === 'towerSetup'")
  await waitFor("document.querySelector('[data-tower-setup]')?.dataset.towerSetupState === 'empty'")
  const emptyRoster = await capture('tower-empty-roster', { fixture: 'empty', recovery: 'return region' })
  if (emptyRoster.diagnostics.towerSetup !== 'empty') throw new Error('Tower empty roster fixture did not render')
  await click('.tower-setup__topbar > button')
  await waitFor("document.querySelector('[data-app-shell]')?.dataset.route === 'regionSelect'")
  await evaluate('window.__MOBIE_M24_BASELINE__.restoreRosterFixture(); true')

  await evaluate('window.__MOBIE_M24_BASELINE__.prepareRosterFixture("evolution"); true')
  const evolutionFixturePreview = await evaluate('window.__MOBIE_M24_BASELINE__.rosterPreview()')
  if (evolutionFixturePreview?.[0]?.speciesId !== 1 || evolutionFixturePreview?.[0]?.level !== 15) {
    throw new Error(`Evolution fixture did not set a pre-evolution starter: ${JSON.stringify(evolutionFixturePreview)}`)
  }
  await chooseWild()
  await enterBattle(false)
  await finishBattle('win', {
    resultId: `m24-ticket48:evolution:${Date.now()}`,
    resultFingerprint: `m24-ticket48:evolution-fingerprint:${Date.now()}`,
  })
  await waitFor('Number(document.querySelector("[data-result]")?.dataset.resultEvolutionCount ?? 0) > 0', 10_000)
  await waitFor('Boolean(document.querySelector(".evo-overlay"))', 10_000)
  const evolution = await capture('result-evolution', { fixture: 'evolution', keyboard: 'Escape/click skip', receipt: true })
  if (await evaluate('Boolean(document.querySelector(".evo-overlay"))')) await click('.evo-overlay')
  await waitFor('!document.querySelector(".evo-overlay")')
  await waitFor('Boolean(document.querySelector("[data-result-next=\\"regions\\"]"))', 5_000)
  await exitToRegion()
  await evaluate('window.__MOBIE_M24_BASELINE__.restoreRosterFixture(); true')

  // Cold reload: use the real old resultId with a different fingerprint. The
  // durable journal/child markers must surface a recoverable collision and must
  // not mutate rewards a second time.
  await call('Storage.clearDataForOrigin', { origin: 'http://127.0.0.1:5173', storageTypes: 'cookies' })
  await navigate()
  await chooseWild()
  await enterBattle(false)
  const beforeCollisionStorage = await evaluate('JSON.stringify(localStorage)')
  await finishBattle('win', {
    resultId: collisionIdentity.resultId,
    resultFingerprint: `${collisionIdentity.resultFingerprint}:cold-reload-collision`,
  })
  await waitFor("document.querySelector('[data-result]')?.dataset.resultSettlementStatus === 'error'", 10_000)
  const collision = await capture('cold-reload-collision', { forcedReuse: collisionIdentity, expected: 'recoverable collision', noRewardReplay: true })
  if (collision.diagnostics.result?.settlement !== 'error' || !collision.diagnostics.resultActions.some((action) => action.text.includes('回到區域'))) {
    throw new Error(`Collision did not expose recoverable Result error: ${JSON.stringify(collision.diagnostics.result)}`)
  }
  const afterCollisionStorage = await evaluate('JSON.stringify(localStorage)')
  if (beforeCollisionStorage !== afterCollisionStorage) {
    throw new Error('Cold-reload collision changed durable localStorage')
  }
  await click('[data-result-error-back]')
  await waitFor("document.querySelector('[data-app-shell]')?.dataset.route === 'regionSelect'")

  // Five-view responsive closure matrix. Each viewport visits the real hub,
  // Encounter, Team Select, a settled Result, and Tower Setup; diagnostics
  // assert one scroll owner and no overflow.
  for (const viewport of VIEWPORTS) {
    await setViewport(viewport.width, viewport.height)
    await ensureRegion()
    const hub = await capture(`matrix-${viewport.id}-region`, { viewport })
    await click('[data-region-card]')
    await waitFor("document.querySelector('[data-app-shell]')?.dataset.route === 'encounter'")
    if (await evaluate('Boolean(document.querySelector("[data-encounter-supply]"))')) {
      await click('[data-supply-option]')
      await waitFor('!document.querySelector("[data-overlay-host]")')
    }
    const encounter = await capture(`matrix-${viewport.id}-encounter`, { viewport })
    await click('[data-encounter-engage]')
    await waitFor("document.querySelector('[data-app-shell]')?.dataset.route === 'cardSelect'")
    await evaluate(`(() => {
      [...document.querySelectorAll('[data-card-select]')]
        .filter((node) => node.getAttribute('aria-pressed') !== 'true' && !node.disabled)
        .slice(0, 3).forEach((node) => node.click())
      return true
    })()`)
    await waitFor('Boolean(document.querySelector("[data-team-start-footer] button:not([disabled])"))')
    const team = await capture(`matrix-${viewport.id}-team`, { viewport, routeEvent: 'ENGAGE→SELECT_TEAM' })
    await click('[data-team-start-footer] button')
    await waitFor("document.querySelector('[data-app-shell]')?.dataset.route === 'battle'", 20_000)
    await waitFor('Boolean(document.querySelector("[data-battle-shell]"))', 20_000)
    await evaluate('window.__MOBIE_M24_BASELINE__.prepareBattleChoice(); true')
    await waitFor("document.querySelector('[data-command-phase]')?.dataset.commandPhase === 'playerChoice'", 10_000)
    await finishBattle('lose', {
      resultId: `m24-ticket48:${viewport.id}:${Date.now()}:lose`,
      resultFingerprint: `m24-ticket48:${viewport.id}:${Date.now()}:lose-fingerprint`,
    })
    await waitFor('Boolean(document.querySelector("[data-result-next=\\"regions\\"]"))')
    await evaluate('document.querySelector("[data-result-next]:not([disabled])")?.scrollIntoView({ block: "end", inline: "nearest" }); true')
    const result = await capture(`matrix-${viewport.id}-result`, { viewport, routeEvent: 'END_BATTLE', outcome: 'lose', settlement: 'settled' })
    if (!result.diagnostics.scrollProbe?.inViewport) throw new Error(`Result CTA was not scrolled into view for ${viewport.id}`)
    await click('[data-result-next="regions"]')
    await waitFor("document.querySelector('[data-app-shell]')?.dataset.route === 'regionSelect'")
    await click('.tower-cta')
    await waitFor("document.querySelector('[data-app-shell]')?.dataset.route === 'towerSetup'")
    const tower = await capture(`matrix-${viewport.id}-tower`, { viewport })
    await evaluate('document.querySelector("[data-tower-advice] button")?.focus(); true')
    await activateFocused('Enter')
    await waitFor('document.querySelector("[data-tower-advice]")?.dataset.towerAdviceShown === "true"')
    const towerKeyboard = await capture(`matrix-${viewport.id}-tower-keyboard`, { viewport, keyboard: 'Enter toggles advice' })
    await activateFocused(' ')
    await waitFor('document.querySelector("[data-tower-advice]")?.dataset.towerAdviceShown === "false"')
    for (const record of [hub, encounter, team, result, tower, towerKeyboard]) {
      if (record.diagnostics.overflow.document || record.diagnostics.overflow.body || !record.diagnostics.targetHeights.allAtLeast44 || record.diagnostics.scrollOwners.length > 1) {
        throw new Error(`Viewport closure failed for ${viewport.id}: ${JSON.stringify(record.diagnostics)}`)
      }
      matrix.push({ viewport: viewport.id, checkpoint: record.checkpoint, diagnostics: record.diagnostics })
    }
    await click('.tower-setup__topbar > button')
    await waitFor("document.querySelector('[data-app-shell]')?.dataset.route === 'regionSelect'")
  }

  await setViewport(590, 410, 2)
  await ensureRegion()
  await evaluate(`(() => {
    document.documentElement.style.setProperty('--safe-t', '24px')
    document.documentElement.style.setProperty('--safe-r', '18px')
    document.documentElement.style.setProperty('--safe-b', '32px')
    document.documentElement.style.setProperty('--safe-l', '18px')
    const tagline = document.querySelector('.region-hub__header .task-header__tagline')
    if (tagline) tagline.textContent = '長文字 safe-area closure probe：'.repeat(24)
    const finalAction = document.querySelector('[data-region-card]')
    finalAction?.scrollIntoView({ block: 'end', inline: 'nearest' })
    return true
  })()`)
  const zoom = await capture('zoom-200', { viewport: '590x410', pageScale: 2, safeAreaInsets: [24, 18, 32, 18], longText: true, finalActionScrolled: true, route: 'regionSelect' })
  if (zoom.diagnostics.overflow.document || zoom.diagnostics.overflow.body || !zoom.diagnostics.scrollProbe?.inViewport) {
    throw new Error(`Zoom long-text/final-action boundary failed: ${JSON.stringify(zoom.diagnostics)}`)
  }
  await evaluate(`(() => {
    for (const name of ['--safe-t', '--safe-r', '--safe-b', '--safe-l']) document.documentElement.style.removeProperty(name)
    return true
  })()`)
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  const reduced = await capture('reduced-motion', { prefersReducedMotion: true })
  await call('Emulation.setEmulatedMedia', { features: [] })

  const ax = await call('Accessibility.getFullAXTree', { depth: -1 })
  await writeFile(resolve(OUTPUT_ROOT, 'accessibility.json'), `${JSON.stringify({
    schemaVersion: 1,
    ticket: 48,
    capturedAt: new Date().toISOString(),
    nodes: (ax.nodes ?? []).filter((node) => !node.ignored && node.role?.value && node.name?.value).map((node) => ({
      role: String(node.role.value),
      name: String(node.name.value),
      checked: node.properties?.find((property) => property.name === 'checked')?.value?.value ?? null,
      expanded: node.properties?.find((property) => property.name === 'expanded')?.value?.value ?? null,
    })).slice(0, 1000),
  }, null, 2)}\n`)

  const finalDiagnostics = await routeState()
  const modelSentinelAfter = await readModelSentinel()
  const unhandledRejections = await evaluate('window.__T48_UNHANDLED__ ?? []')
  const allCdpEvents = events
  const evidence = {
    schemaVersion: 1,
    ticket: 48,
    scenario: SCENARIO,
    capturedAt: new Date().toISOString(),
    viewportMatrix: VIEWPORTS,
    checkpoints,
    matrix,
    collision: {
      forcedIdentity: collisionIdentity,
      result: collision.diagnostics.result,
      storageBefore: JSON.parse(beforeCollisionStorage),
      storageAfter: JSON.parse(afterCollisionStorage),
      durableStorageUnchanged: beforeCollisionStorage === afterCollisionStorage,
    },
    modelStore: {
      database: 'mz-models',
      sentinel: { id: 'ticket48-sentinel', payload: 'untouched' },
      after: modelSentinelAfter,
      databases: finalDiagnostics.modelDatabases,
    },
    finalDiagnostics,
    errors: {
      console: allCdpEvents.filter((event) => event.method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(event.params?.type)),
      runtime: allCdpEvents.filter((event) => event.method === 'Runtime.exceptionThrown'),
      networkFailed: allCdpEvents.filter((event) => event.method === 'Network.loadingFailed').map((event) => ({ requestId: event.params?.requestId, errorText: event.params?.errorText, url: event.params?.blockedReason ?? null })),
      unhandledRejections,
    },
    assertions: {
      routeJourney: checkpoints.some((record) => record.checkpoint === 'wild-win-result')
        && checkpoints.some((record) => record.checkpoint === 'arena-win-result')
        && checkpoints.some((record) => record.checkpoint === 'wild-lose-result')
        && checkpoints.some((record) => record.checkpoint === 'tower-next-floor-battle'),
      recoveryStates: checkpoints.some((record) => record.checkpoint === 'encounter-missing-target')
        && checkpoints.some((record) => record.checkpoint === 'encounter-artwork-fallback')
        && checkpoints.some((record) => record.checkpoint === 'tower-empty-roster')
        && checkpoints.some((record) => record.checkpoint === 'result-evolution' && (record.preCapture.evolutionOverlay || record.diagnostics.evolutionCount > 0))
        && checkpoints.some((record) => record.checkpoint === 'cold-reload-collision'),
      settlementRecovery: checkpoints.some((record) => record.checkpoint === 'result-storage-error')
        && checkpoints.some((record) => record.checkpoint === 'result-storage-retry'),
      settlementRunningSample: checkpoints.some((record) => record.checkpoint === 'result-settlement-running'
        && (record.preCapture.settlement === 'running' || record.diagnostics.result?.settlement === 'running' || record.diagnostics.result?.settlement === 'settled')),
      explicitSupply: checkpoints.some((record) => record.checkpoint === 'wild-supply-required'),
      scannerDefaultOff: checkpoints.some((record) => record.checkpoint === 'scanner-off')
        && scannerOff.diagnostics.overlay === null
        && scannerOffRegion.diagnostics.overlay === null
        && scannerOffRegion.diagnostics.cameraRequests === 0,
      collisionRecoverable: collision.diagnostics.result?.settlement === 'error',
      noHorizontalOverflow: [...checkpoints, zoom, reduced].every((record) => !record.diagnostics.overflow.document && !record.diagnostics.overflow.body),
      targetMinimum44: [...checkpoints, zoom, reduced].every((record) => record.diagnostics.targetHeights.allAtLeast44),
      noCustomModels: [...checkpoints, zoom, reduced].every((record) => record.diagnostics.performance.threeOrModel.length === 0)
        && JSON.stringify(modelSentinelAfter) === JSON.stringify({ id: 'ticket48-sentinel', payload: 'untouched' }),
      noUnhandledRejections: unhandledRejections.length === 0,
    },
    limitations: [
      'Chrome CDP is browser contract evidence; native iPad Safari remains Ticket 51.',
      'Battle outcomes use the DEV-only M24 driver only after the real Region → Team → Battle handoff; no route-level screen mock replaces the journey.',
      'The same-pair remount invariant is also covered by src/ui/screens/resultSettlementJourney.test.tsx; this run covers the cold-reload collision boundary.',
    ],
  }
  await writeFile(resolve(OUTPUT_ROOT, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`)
  console.log(`Ticket 48 Chrome closure passed: ${checkpoints.length} checkpoints; ${matrix.length} viewport checks`)
  cdp.close()
}

main().catch(async (error) => {
  console.error(`Ticket 48 Chrome closure failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
