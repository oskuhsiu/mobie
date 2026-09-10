// Ticket 49 Chrome closure matrix for the real collection/growth utility
// surfaces. Run with Vite and a local Chrome CDP target:
//   npm run dev -- --host 127.0.0.1
//   /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/mobie-ticket49 about:blank
//   node scripts/m24-ticket49-closure.mjs --port=9222

import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const SCENARIO = 'm24-post-m23-chrome-v1'
const OUTPUT_ROOT = resolve('test-runs', 'm24', 'ticket49-chrome')
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
      transaction.objectStore('models').put({ id: 'ticket49-sentinel', payload: 'untouched' })
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
      const get = transaction.objectStore('models').get('ticket49-sentinel')
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
      if (node.closest('#root')?.getAttribute('aria-hidden') === 'true') return false
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
      collection: (() => {
        const root = document.querySelector('[data-collection-shell]')
        const list = document.querySelector('[data-collection-scroll-owner="list"]')
        const detail = document.querySelector('[data-collection-scroll-owner="detail"]')
        const body = root?.closest('[data-modal-body]')
        return root ? {
          state: root.dataset.collectionState ?? null,
          layout: root.dataset.layout ?? null,
          total: Number(root.dataset.collectionRosterTotal ?? root.dataset.collectionTotal ?? 0),
          filtered: Number(root.dataset.collectionTotal ?? 0),
          domCap: Number(root.dataset.collectionDomCap ?? 0),
          visible: document.querySelectorAll('[data-entity-list] [data-entity-id]').length,
          detailOpen: root.dataset.detailOpen === 'true',
          listScrollTop: list?.scrollTop ?? 0,
          detailScrollTop: detail?.scrollTop ?? 0,
          bodyScrollTop: body?.scrollTop ?? 0,
        } : null
      })(),
      trainer: (() => {
        const root = document.querySelector('[data-move-trainer]')
        return root ? {
          total: Number(root.dataset.trainerTotal ?? 0),
          domCap: Number(root.dataset.trainerDomCap ?? 0),
          visible: document.querySelectorAll('[data-trainer-unit]').length,
          hasMore: Boolean(document.querySelector('[data-trainer-load-more]')),
        } : null
      })(),
      partner: (() => {
        const root = document.querySelector('[data-partner-skills]')
        return root ? {
          busy: root.dataset.partnerBusy === 'true',
          cards: document.querySelectorAll('[data-partner-skill-id]').length,
          states: [...document.querySelectorAll('[data-partner-skill-id]')].map((node) => ({ id: node.dataset.partnerSkillId, state: node.dataset.partnerSkillState })),
        } : null
      })(),
      dex: (() => {
        const root = document.querySelector('[data-dex-root]')
        return root ? {
          state: root.dataset.dexState ?? null,
          total: Number(root.dataset.dexTotal ?? 0),
          visible: Number(root.dataset.dexVisible ?? 0),
          page: Number(root.dataset.dexPage ?? 0),
          pageCount: Number(root.dataset.dexPageCount ?? 0),
          pageSize: Number(root.dataset.dexPageSize ?? 0),
          domCap: Number(root.dataset.dexDomCap ?? 0),
          cells: document.querySelectorAll('[data-dex-cell]').length,
          detailOpen: root.dataset.dexDetailOpen === 'true',
        } : null
      })(),
      achievements: (() => {
        const root = document.querySelector('[data-achievements-root]')
        return root ? {
          state: root.dataset.achievementsState ?? null,
          rows: document.querySelectorAll('[data-achievement-id]').length,
          ready: document.querySelectorAll('[data-achievement-status="ready"]').length,
          pending: document.querySelectorAll('[data-achievement-status="pending"]').length,
          claimed: document.querySelectorAll('[data-achievement-status="claimed"]').length,
        } : null
      })(),
      incubator: (() => {
        const root = document.querySelector('[data-incubator-root]')
        return root ? {
          state: root.dataset.incubatorState ?? null,
          total: Number(root.dataset.incubatorTotal ?? 0),
          domCap: Number(root.dataset.incubatorDomCap ?? 0),
          visible: document.querySelectorAll('[data-egg-id]').length,
          sources: [...document.querySelectorAll('[data-egg-id]')].map((node) => node.dataset.eggSource),
        } : null
      })(),
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
        ariaLabel: document.activeElement?.getAttribute('aria-label') ?? null,
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
      artworkFailures: document.querySelectorAll('[data-artwork-state="failed"], [data-dex-artwork-state="failed"]').length,
      artworkLoading: document.querySelectorAll('[data-artwork-state="loading"], [data-dex-artwork-state="loading"]').length,
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
      unhandledRejections: Array.isArray(window.__T49_UNHANDLED__) ? window.__T49_UNHANDLED__.length : 0,
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
    url.searchParams.set('ticket49Run', `${Date.now()}-${Math.random().toString(36).slice(2)}`)
    if (extra) for (const [key, value] of new URLSearchParams(extra)) url.searchParams.set(key, value)
    await call('Page.navigate', { url: url.href })
    await waitFor("document.readyState === 'complete'", 20_000)
    await waitFor("Boolean(document.querySelector('[data-app-shell]'))", 20_000)
    await waitFor("document.querySelector('[data-app-shell]')?.dataset.bootstrapStatus === 'ready'", 20_000)
    await waitFor('Boolean(window.__MOBIE_M24_BASELINE__?.ready?.())', 20_000)
    await evaluate(`(() => {
      if (window.__T49_UNHANDLED__) return true
      window.__T49_UNHANDLED__ = []
      window.addEventListener('unhandledrejection', (event) => window.__T49_UNHANDLED__.push(String(event.reason ?? 'unknown')))
      return true
    })()`)
    await evaluate('(async()=>{ await window.__MOBIE_M24_BASELINE__.seedContent({ learnedPartnerSkills: [] }); return true })()')
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

  const openMenuTool = async (label, dataLabel, waitSelector) => {
    if (!(await evaluate('Boolean(document.querySelector("#tools-menu-more"))'))) await click('button[aria-label="更多"]')
    await waitFor('Boolean(document.querySelector("#tools-menu-more"))', 5_000)
    const opened = await evaluate(`(() => {
      const nodes = [...document.querySelectorAll('#tools-menu-more button')]
      const node = nodes.find((candidate) => (candidate.textContent || '').includes(${JSON.stringify(dataLabel)}))
      if (!node || node.disabled) return false
      node.click(); return true
    })()`)
    if (!opened) throw new Error(`Unable to open ${label} from More menu`)
    await waitFor(`Boolean(document.querySelector(${JSON.stringify(waitSelector)}))`, 12_000)
  }

  const closeOverlay = async () => {
    if (!(await evaluate('Boolean(document.querySelector("[data-overlay-host]"))'))) return
    const escaped = await pressKey('Escape')
    await waitFor('!document.querySelector("[data-overlay-host]")', 5_000)
    if (!escaped.defaultPrevented) throw new Error('Overlay Escape did not report prevented dismissal')
  }

  const readStorage = async (key) => evaluate(`(() => {
    try { return JSON.parse(localStorage.getItem(${JSON.stringify(key)}) ?? 'null') }
    catch { return null }
  })()`)
  const rosterFromStorage = async () => evaluate(`(() => {
    try { const raw = JSON.parse(localStorage.getItem('mobie.roster.v2') ?? '[]'); return Array.isArray(raw) ? raw : raw.roster ?? [] }
    catch { return [] }
  })()`)

  const hatchSnapshot = async (eggId) => evaluate(`(() => {
    const parse = (key) => { try { return JSON.parse(localStorage.getItem(key) ?? 'null') } catch { return null } }
    const rawRoster = parse('mobie.roster.v2')
    const roster = Array.isArray(rawRoster) ? rawRoster : rawRoster?.roster ?? []
    const incubator = parse('mobie.incubator.v1')
    const meta = parse('mobie.meta.v1')
    const entry = incubator?.hatchOutbox?.find((candidate) => candidate.eggId === ${JSON.stringify(eggId)}) ?? null
    return {
      rosterCount: roster.length,
      captures: Number(meta?.stats?.captures ?? 0),
      registered: Array.isArray(meta?.registered) ? meta.registered : [],
      eggPresent: Boolean(incubator?.eggs?.some((egg) => egg.id === ${JSON.stringify(eggId)})),
      receiptStatus: entry?.status ?? null,
      speciesId: entry?.payload?.unit?.speciesId ?? null,
    }
  })()`)

  const assertHatchApplied = async (eggId, before, label) => {
    const after = await hatchSnapshot(eggId)
    if (after.rosterCount !== before.rosterCount + 1 || after.captures !== before.captures + 1 || after.eggPresent || after.receiptStatus !== 'settled' || !after.speciesId || !after.registered.includes(after.speciesId)) {
      throw new Error(`${label} hatch postcondition failed: ${JSON.stringify({ before, after })}`)
    }
    return after
  }

  const assertScrollContract = (record, { collection = false } = {}) => {
    const owners = record.diagnostics.scrollOwners
    const allowed = owners.filter((owner) => /collection-list-pane|collection-detail-pane|modal-surface__body/.test(owner.className))
    if (record.diagnostics.overflow.document || record.diagnostics.overflow.body) throw new Error(`Horizontal overflow at ${record.checkpoint}`)
    if (!record.diagnostics.targetHeights.allAtLeast44) throw new Error(`Touch target below 44px at ${record.checkpoint}`)
    if (collection) {
      const max = record.diagnostics.collection?.layout === 'wide' ? 2 : 1
      if (owners.length > max || allowed.length !== owners.length) throw new Error(`Collection scroll contract failed at ${record.checkpoint}: ${JSON.stringify(owners)}`)
    } else if (owners.length > 1) {
      throw new Error(`Nested scroll owner at ${record.checkpoint}: ${JSON.stringify(owners)}`)
    }
  }

  await Promise.all([
    call('Runtime.enable'), call('Page.enable'), call('Accessibility.enable'), call('Network.enable'), call('Log.enable'), call('Performance.enable'),
  ])
  const origin = 'http://127.0.0.1:5173'
  await call('Storage.clearDataForOrigin', { origin, storageTypes: 'all' })
  await evaluate(`(async () => {
    localStorage.clear()
    if (typeof indexedDB.databases === 'function') for (const database of await indexedDB.databases()) if (database.name) indexedDB.deleteDatabase(database.name)
    return true
  })()`)
  await seedModelSentinel()
  await setViewport(1180, 820)
  await navigate()

  const title = await capture('title', { route: 'title', scanner: 'default-off' })
  if (title.diagnostics.route !== 'title') throw new Error('Title boot boundary failed')
  await click('button[aria-label="開始冒險"]')
  await waitFor("document.querySelector('[data-app-shell]')?.dataset.route === 'regionSelect'")
  const region = await capture('region-hub', { routeEvent: 'START', scanner: 'default-off' })
  if (region.diagnostics.route !== 'regionSelect') throw new Error('Region hub did not mount')
  await click('button[aria-label="更多"]')
  await capture('region-tools-scanner-off', { scannerEnabled: false, cameraRequests: 0 })
  if (await evaluate('Boolean(document.querySelector("[data-tool=\\"scanner\\"]"))')) throw new Error('Scanner appeared while disabled')
  await pressKey('Escape')

  await evaluate('window.__MOBIE_M24_BASELINE__.prepareCollectionFixture(48)')
  await sleep(120)
  await click('button[aria-label="我的 Mobie"]')
  await waitFor('Boolean(document.querySelector("[data-collection-shell]"))', 12_000)
  const collectionWide = await capture('collection-wide', { route: 'title/modal:team', fixture: '48 canonical roster units' })
  if (collectionWide.diagnostics.collection?.layout !== 'wide' || collectionWide.diagnostics.collection.total < 48 || collectionWide.diagnostics.collection.domCap > 24 || collectionWide.diagnostics.collection.visible > 24) throw new Error(`Collection wide list is not bounded: ${JSON.stringify(collectionWide.diagnostics.collection)}`)
  assertScrollContract(collectionWide, { collection: true })
  await evaluate(`(() => { const image = document.querySelector('[data-entity-list] [data-artwork-state] img'); if (!image) return false; image.src = '/__m24__/missing-ticket49-collection.png'; return true })()`)
  await waitFor('Boolean(document.querySelector("[data-entity-list] [data-artwork-state=\\"failed\\"]"))', 8_000)
  const collectionArtwork = await capture('collection-artwork-fallback', { partialArtwork: true, fixedFallbackSlot: true })
  assertScrollContract(collectionArtwork, { collection: true })

  const ownerId = 'm24-collection-1'
  await click(`[data-item-picker-toggle="${ownerId}"]`)
  await waitFor(`Boolean(document.querySelector('[data-item-picker-for="${ownerId}"]'))`)
  const itemBefore = { roster: await rosterFromStorage(), bag: await readStorage('mobie.itembag.v1') }
  const itemPicker = await capture('collection-item-picker', { ownerId, resourceLedger: itemBefore.bag })
  assertScrollContract(itemPicker, { collection: true })
  await click(`[data-item-picker-for="${ownerId}"] [data-item-equip="headband"]`)
  await waitFor(`(() => { const raw = JSON.parse(localStorage.getItem('mobie.roster.v2') || '[]'); const roster = Array.isArray(raw) ? raw : raw.roster || []; return roster.find((u) => u.id === ${JSON.stringify(ownerId)})?.heldItemId === 'headband' })()`, 8_000)
  const itemApplied = { roster: await rosterFromStorage(), bag: await readStorage('mobie.itembag.v1') }
  if (itemApplied.roster.find((unit) => unit.id === ownerId)?.heldItemId !== 'headband' || Number(itemApplied.bag?.headband ?? 0) !== Number(itemBefore.bag?.headband ?? 0) - 1) throw new Error(`Item equip ledger mismatch: ${JSON.stringify({ itemBefore, itemApplied })}`)
  await click(`[data-item-picker-toggle="${ownerId}"]`)
  await click(`[data-item-picker-for="${ownerId}"] [data-item-unequip="${ownerId}"]`)
  await waitFor(`(() => { const raw = JSON.parse(localStorage.getItem('mobie.roster.v2') || '[]'); const roster = Array.isArray(raw) ? raw : raw.roster || []; return !roster.find((u) => u.id === ${JSON.stringify(ownerId)})?.heldItemId })()`, 8_000)
  const itemRestored = { roster: await rosterFromStorage(), bag: await readStorage('mobie.itembag.v1') }
  if (itemRestored.roster.find((unit) => unit.id === ownerId)?.heldItemId || Number(itemRestored.bag?.headband ?? 0) !== Number(itemBefore.bag?.headband ?? 0)) throw new Error(`Item unequip did not restore ledger: ${JSON.stringify(itemRestored)}`)
  await click(`[data-item-picker-toggle="${ownerId}"]`)
  await evaluate(`(() => {
    window.__T49_BAG_SET_ORIGINAL__ = Storage.prototype.setItem
    Storage.prototype.setItem = function(key, value) { if (key === 'mobie.itembag.v1') throw new Error('Ticket 49 injected item bag failure'); return window.__T49_BAG_SET_ORIGINAL__.call(this, key, value) }
    return true
  })()`)
  await click(`[data-item-picker-for="${ownerId}"] [data-item-equip="headband"]`)
  await waitFor(`Boolean(document.querySelector('[data-item-picker-for="${ownerId}"] [role="alert"]'))`, 8_000)
  const itemFailure = await capture('collection-item-storage-error', { ownerId, expected: 'roster and bag unchanged' })
  const itemAfterFailure = { roster: await rosterFromStorage(), bag: await readStorage('mobie.itembag.v1') }
  if (itemAfterFailure.roster.find((unit) => unit.id === ownerId)?.heldItemId || Number(itemAfterFailure.bag?.headband ?? 0) !== Number(itemBefore.bag?.headband ?? 0)) throw new Error(`Item failure partially applied: ${JSON.stringify(itemAfterFailure)}`)
  await evaluate(`(() => { Storage.prototype.setItem = window.__T49_BAG_SET_ORIGINAL__; delete window.__T49_BAG_SET_ORIGINAL__; return true })()`)

  const listScrollBeforeDetail = await evaluate(`(() => { const node = document.querySelector('[data-collection-scroll-owner="list"]'); if (!node) return null; node.scrollTop = Math.min(120, node.scrollHeight); return node.scrollTop })()`)
  await click(`[data-mobie-invoker="${ownerId}"]`)
  await waitFor('Boolean(document.querySelector("[data-mobcard-layout=\\"panel\\"]"))')
  const collectionDetail = await capture('collection-mobcard-detail', { ownerId, listScrollBeforeDetail })
  assertScrollContract(collectionDetail, { collection: true })
  await click('[data-mobcard-close]')
  await waitFor('document.querySelector("[data-collection-shell]")?.dataset.detailOpen === "false"')
  const collectionRestored = await capture('collection-detail-focus-restore', { focus: ownerId, scrollRestore: true })
  if (!collectionRestored.diagnostics.focus.ariaLabel?.includes('查看完整資訊') || collectionRestored.diagnostics.collection?.listScrollTop !== listScrollBeforeDetail) throw new Error(`Collection focus/scroll restore failed: ${JSON.stringify(collectionRestored.diagnostics.collection)}`)
  assertScrollContract(collectionRestored, { collection: true })

  await click(`[data-mobie-invoker="${ownerId}"]`)
  await waitFor('Boolean(document.querySelector("[data-mobcard-layout=\\"panel\\"]"))')
  await click('[data-mobcard-move-trainer]')
  await waitFor('Boolean(document.querySelector("[data-move-trainer]"))', 12_000)
  const trainerBounded = await capture('move-trainer-bounded', { totalRoster: 48, domCap: 24 })
  if (!trainerBounded.diagnostics.trainer || trainerBounded.diagnostics.trainer.total < 48 || trainerBounded.diagnostics.trainer.domCap > 24 || trainerBounded.diagnostics.trainer.visible > 24) throw new Error(`Move Trainer roster DOM is unbounded: ${JSON.stringify(trainerBounded.diagnostics.trainer)}`)
  assertScrollContract(trainerBounded)
  await evaluate(`(() => { const image = document.querySelector('[data-trainer-unit] [data-artwork-state] img'); if (!image) return false; image.src = '/__m24__/missing-ticket49-trainer.png'; return true })()`)
  await waitFor('Boolean(document.querySelector("[data-trainer-unit] [data-artwork-state=\\"failed\\"]"))', 8_000)
  const trainerArtwork = await capture('move-trainer-artwork-fallback', { partialArtwork: true, fixedFallbackSlot: true })
  assertScrollContract(trainerArtwork)
  if (!(await evaluate(`document.querySelector('[data-trainer-unit="${ownerId}"]')?.dataset.trainerOpen === 'true'`))) await click(`[data-trainer-unit="${ownerId}"] .trainer-unit__toggle`)
  await waitFor(`Boolean(document.querySelector('[data-trainer-unit="${ownerId}"] [data-trainer-panel]'))`)
  const trainerBefore = { roster: await rosterFromStorage(), sp: await readStorage('mobie.skillpoints.v1') }
  const learnButton = await evaluate(`(() => { const node = document.querySelector('[data-trainer-unit="${ownerId}"] [data-move-state="learnable"] button:not([disabled])'); return node ? { moveId: Number(node.closest('[data-move-id]')?.getAttribute('data-move-id')), label: node.getAttribute('aria-label') } : null })()`)
  if (!learnButton?.moveId) throw new Error('No legal Move Trainer learn action')
  await click(`[data-trainer-unit="${ownerId}"] [data-move-state="learnable"][data-move-id="${learnButton.moveId}"] button:not([disabled])`)
  await waitFor(`(() => { const raw = JSON.parse(localStorage.getItem('mobie.roster.v2') || '[]'); const roster = Array.isArray(raw) ? raw : raw.roster || []; return roster.find((u) => u.id === ${JSON.stringify(ownerId)})?.learnedMoveIds?.includes(${learnButton.moveId}) })()`, 10_000)
  const trainerAfterLearn = { roster: await rosterFromStorage(), sp: await readStorage('mobie.skillpoints.v1') }
  const trainedUnit = trainerAfterLearn.roster.find((unit) => unit.id === ownerId)
  const learnedCost = Number((learnButton.label || '').match(/花費\s+(\d+)\s+SP/)?.[1] ?? NaN)
  if (!trainedUnit?.learnedMoveIds?.includes(learnButton.moveId) || !Number.isFinite(learnedCost) || Number(trainerAfterLearn.sp) !== Number(trainerBefore.sp) - learnedCost) throw new Error(`Move learn accounting failed: ${JSON.stringify({ trainerBefore, trainerAfterLearn, learnButton, learnedCost })}`)
  await click(`[data-trainer-unit="${ownerId}"] [data-move-state="learned"][data-move-id="${learnButton.moveId}"] button:not([disabled])`)
  await waitFor(`(() => { const raw = JSON.parse(localStorage.getItem('mobie.roster.v2') || '[]'); const roster = Array.isArray(raw) ? raw : raw.roster || []; return roster.find((u) => u.id === ${JSON.stringify(ownerId)})?.equippedMoveIds?.includes(${learnButton.moveId}) })()`, 8_000)
  const orderBefore = (await rosterFromStorage()).find((unit) => unit.id === ownerId)?.equippedMoveIds ?? []
  const reorderButton = await evaluate(`(() => [...document.querySelectorAll('[data-trainer-unit="${ownerId}"] [data-move-slot] button[aria-label*="往前移"]')].find((node) => !node.disabled)?.getAttribute('aria-label') ?? null)`)
  if (reorderButton) await click(`[data-trainer-unit="${ownerId}"] [data-move-slot] button[aria-label*="往前移"]:not([disabled])`)
  await sleep(180)
  const orderAfterReorder = (await rosterFromStorage()).find((unit) => unit.id === ownerId)?.equippedMoveIds ?? []
  const unequipTarget = await evaluate(`(() => [...document.querySelectorAll('[data-trainer-unit="${ownerId}"] [data-move-slot] button[aria-label*="卸下"]')].find((node) => (node.getAttribute('aria-label') || '').includes('能量球'))?.getAttribute('aria-label') ?? [...document.querySelectorAll('[data-trainer-unit="${ownerId}"] [data-move-slot] button[aria-label*="卸下"]')].at(-1)?.getAttribute('aria-label') ?? null)`)
  if (!unequipTarget) throw new Error('No legal Move Trainer unequip action')
  await click(`[data-trainer-unit="${ownerId}"] [data-move-slot]:has([data-move-definition][data-move-id="${learnButton.moveId}"]) button[aria-label*="卸下"]`)
  await waitFor(`(() => { const raw = JSON.parse(localStorage.getItem('mobie.roster.v2') || '[]'); const roster = Array.isArray(raw) ? raw : raw.roster || []; const unit = roster.find((u) => u.id === ${JSON.stringify(ownerId)}); return unit?.learnedMoveIds?.includes(${learnButton.moveId}) && !unit?.equippedMoveIds?.includes(${learnButton.moveId}) })()`, 8_000)
  const trainerAfterUnequip = { roster: await rosterFromStorage(), sp: await readStorage('mobie.skillpoints.v1') }
  const finalTrainerUnit = trainerAfterUnequip.roster.find((unit) => unit.id === ownerId)
  if (!finalTrainerUnit?.learnedMoveIds?.includes(learnButton.moveId) || finalTrainerUnit.equippedMoveIds?.includes(learnButton.moveId) || Number(trainerAfterUnequip.sp) !== Number(trainerAfterLearn.sp)) throw new Error(`Move unequip invariant failed: ${JSON.stringify({ trainerAfterLearn, trainerAfterUnequip, orderBefore, orderAfterReorder })}`)
  const trainerActions = await capture('move-trainer-actions', { learnMoveId: learnButton.moveId, orderBefore, orderAfterReorder, learnedAfterUnequip: true, spUnchangedAfterUnequip: true })
  assertScrollContract(trainerActions)
  await click('[data-trainer-load-more]')
  await waitFor('Number(document.querySelector("[data-move-trainer]")?.dataset.trainerPage || 0) === 2')
  const trainerExpanded = await capture('move-trainer-pagination', { boundedPage: true })
  if (trainerExpanded.diagnostics.trainer.domCap > 24 || trainerExpanded.diagnostics.trainer.visible > 24 || trainerExpanded.diagnostics.trainer.total < 48) throw new Error('Move Trainer pagination exceeded the bounded page')
  assertScrollContract(trainerExpanded)
  await click('[data-modal-close]')
  await waitFor('document.querySelector("[data-overlay-host]")?.dataset.overlayId === "team"')
  await click('[data-modal-close]')
  await waitFor('!document.querySelector("[data-overlay-host]")')

  // The collection surface keeps loading, empty, and failed reads recoverable.
  await evaluate('window.__MOBIE_M24_BASELINE__.prepareCollectionLoading(); true')
  await click('button[aria-label="我的 Mobie"]')
  await waitFor('Boolean(document.querySelector("[data-collection-loading]"))')
  const collectionLoading = await capture('collection-loading', { recovery: '重新載入' })
  assertScrollContract(collectionLoading, { collection: true })
  await click('[data-collection-loading] button')
  await waitFor('document.querySelector("[data-collection-shell]")?.dataset.collectionState === "ready"')
  await closeOverlay()
  await evaluate('window.__MOBIE_M24_BASELINE__.restoreRosterFixture(); true')

  await evaluate('window.__MOBIE_M24_BASELINE__.prepareCollectionError(); true')
  await click('button[aria-label="我的 Mobie"]')
  await waitFor('Boolean(document.querySelector("[data-collection-loading]"))')
  await click('[data-collection-loading] button')
  await waitFor('Boolean(document.querySelector("[data-collection-error]"))')
  const collectionError = await capture('collection-error', { recovery: 'retry remains visible' })
  assertScrollContract(collectionError, { collection: true })
  await evaluate('window.__MOBIE_M24_BASELINE__.restoreRosterFixture(); true')
  await closeOverlay()

  await evaluate('window.__MOBIE_M24_BASELINE__.prepareRosterFixture("empty"); true')
  await click('button[aria-label="我的 Mobie"]')
  await waitFor('Boolean(document.querySelector("[data-collection-empty]"))')
  const collectionEmpty = await capture('collection-empty', { recovery: '關閉收藏' })
  assertScrollContract(collectionEmpty, { collection: true })
  await closeOverlay()
  await evaluate('window.__MOBIE_M24_BASELINE__.restoreRosterFixture(); true')

  await setViewport(393, 852)
  await click('button[aria-label="我的 Mobie"]')
  await waitFor('Boolean(document.querySelector("[data-collection-shell]"))')
  const collectionNarrow = await capture('collection-narrow', { viewport: '393x852', expected: 'single-column collection' })
  if (collectionNarrow.diagnostics.collection?.layout !== 'compact' || collectionNarrow.diagnostics.collection.domCap > 24) throw new Error(`Narrow collection contract failed: ${JSON.stringify(collectionNarrow.diagnostics.collection)}`)
  assertScrollContract(collectionNarrow, { collection: true })
  const compactScrollBefore = await evaluate(`(() => { const body = document.querySelector('[data-collection-shell]')?.closest('[data-modal-body]'); if (!body) return null; body.scrollTop = Math.min(120, body.scrollHeight); return body.scrollTop })()`)
  await click(`[data-mobie-invoker="${ownerId}"]`)
  await waitFor('Boolean(document.querySelector("[data-mobcard-layout=\\"modal\\"]"))')
  const compactDetail = await capture('collection-narrow-detail', { invokerRestore: true })
  assertScrollContract(compactDetail)
  const escapeCompact = await pressKey('Escape')
  await waitFor('document.querySelector("[data-overlay-host]")?.dataset.overlayId === "team"')
  const compactRestored = await waitFor(`document.activeElement?.matches('[data-mobie-invoker="${ownerId}"]')`, 5_000)
  await sleep(150)
  const compactScrollAfter = await evaluate('document.querySelector("[data-collection-shell]")?.closest("[data-modal-body]")?.scrollTop ?? null')
  if (!escapeCompact.defaultPrevented || !compactRestored || compactScrollAfter !== compactScrollBefore) throw new Error(`Compact collection Escape/focus/scroll restore failed: ${JSON.stringify({ compactScrollBefore, compactScrollAfter })}`)
  const compactRestoredEvidence = await capture('collection-narrow-focus-scroll-restore', { invokerRestore: true, scrollRestore: true, compactScrollBefore, compactScrollAfter })
  assertScrollContract(compactRestoredEvidence, { collection: true })
  await closeOverlay()
  await setViewport(1180, 820)

  await openMenuTool('partner', '夥伴技能', '[data-partner-skills]')
  const partnerInitial = await capture('partner-skills', { resourceWallet: true })
  if (partnerInitial.diagnostics.partner?.states.find((entry) => entry.id === 'rally')?.state !== 'available') throw new Error('Partner rally was not available')
  const partnerSpBefore = Number((await readStorage('mobie.skillpoints.v1')) ?? 0)
  await click('[data-partner-skill-id="rally"] button:not([disabled])')
  await waitFor('document.querySelector("[data-partner-skill-id=\\"rally\\"]")?.dataset.partnerSkillState === "learned"')
  const partnerUnlock = await capture('partner-skills-unlock', { spBefore: partnerSpBefore, spAfter: await readStorage('mobie.skillpoints.v1') })
  assertScrollContract(partnerUnlock)
  await closeOverlay()
  await call('Page.reload', { ignoreCache: true })
  await waitFor('document.readyState === "complete"', 20_000)
  await waitFor('Boolean(document.querySelector("[data-app-shell]"))', 15_000)
  await openMenuTool('partner', '夥伴技能', '[data-partner-skills]')
  const partnerReloaded = await capture('partner-skills-reloaded', { learnedPersists: true })
  if (partnerReloaded.diagnostics.partner?.states.find((entry) => entry.id === 'rally')?.state !== 'learned') throw new Error('Partner learned state did not survive reload')
  assertScrollContract(partnerReloaded)
  await closeOverlay()

  await openMenuTool('dex', '圖鑑', '[data-dex-root]')
  const dexInitial = await capture('dex-full-catalog', { catalog: 1025, pageSize: 60 })
  if (!dexInitial.diagnostics.dex || dexInitial.diagnostics.dex.total !== 1025 || dexInitial.diagnostics.dex.pageSize !== 60 || dexInitial.diagnostics.dex.cells > 60) throw new Error(`Dex bound failed: ${JSON.stringify(dexInitial.diagnostics.dex)}`)
  assertScrollContract(dexInitial)
  await click('[data-dex-filter="registered"]')
  await waitFor('document.querySelector("[data-dex-root]")?.dataset.dexPage === "1"')
  const dexRegistered = await capture('dex-registered-filter', { canonicalRegistered: true })
  if ((dexRegistered.diagnostics.dex?.visible ?? 0) < 1) throw new Error('Dex registered filter returned no canonical entries')
  assertScrollContract(dexRegistered)
  await click('[data-dex-filter="owned"]')
  await waitFor('Number(document.querySelector("[data-dex-root]")?.dataset.dexVisible || 0) > 0')
  const dexOwned = await capture('dex-owned-filter', { canonicalOwned: true })
  assertScrollContract(dexOwned)
  await click('[data-dex-filter="all"]')
  await evaluate(`(() => { const input = document.querySelector('[aria-label="搜尋圖鑑名稱或編號"]'); if (!input) return false; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setter?.call(input, '皮卡丘'); input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '皮卡丘' })); return true })()`)
  await waitFor('document.querySelector("[data-dex-root]")?.dataset.dexVisible === "1"')
  const dexSearch = await capture('dex-positive-search', { query: '皮卡丘', fullCatalogSearch: true })
  if (dexSearch.diagnostics.dex?.cells !== 1) throw new Error('Dex positive search did not isolate one species')
  assertScrollContract(dexSearch)
  await evaluate(`(() => { const input = document.querySelector('[aria-label="搜尋圖鑑名稱或編號"]'); if (!input) return false; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setter?.call(input, ''); input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null })); return true })()`)
  await waitFor('document.querySelector("[data-dex-root]")?.dataset.dexVisible === "1025"')
  await click('[data-dex-page="18"]')
  await waitFor('document.querySelector("[data-dex-root]")?.dataset.dexPage === "18"')
  const dexLast = await capture('dex-last-page', { expectedCells: 5, firstSpecies: 1021, lastSpecies: 1025 })
  if (dexLast.diagnostics.dex?.cells !== 5) throw new Error('Dex last page must contain five cells')
  if (await evaluate('document.querySelector("[data-dex-cell]")?.dataset.dexSpeciesId') !== '1021') throw new Error('Dex last page starts at wrong species')
  await click('[data-dex-cell]')
  await waitFor('Boolean(document.querySelector("[data-dex-detail]"))')
  const dexDetail = await capture('dex-detail', { page: 18, focus: '返回清單', detailState: true })
  if (!dexDetail.diagnostics.dex?.detailOpen || dexDetail.diagnostics.focus.text !== '← 返回清單') throw new Error('Dex detail focus contract failed')
  assertScrollContract(dexDetail)
  await click('[data-dex-detail-close]')
  await waitFor('!document.querySelector("[data-dex-detail]")')
  await waitFor('document.activeElement?.getAttribute("data-dex-species-id") === "1021"', 5_000)
  const dexRestored = await capture('dex-detail-focus-restore', { page: 18, scrollRestore: true, focusSpecies: 1021 })
  assertScrollContract(dexRestored)
  await evaluate(`(() => { const input = document.querySelector('[aria-label="搜尋圖鑑名稱或編號"]'); if (!input) return false; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setter?.call(input, 'not-a-real-mobie'); input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'not-a-real-mobie' })); return true })()`)
  await waitFor('Boolean(document.querySelector("[data-dex-state=\\"empty\\"]"))')
  const dexEmpty = await capture('dex-invalid-search', { recoverable: true })
  if (!dexEmpty.diagnostics.dex || dexEmpty.diagnostics.dex.visible !== 0 || !await evaluate('Boolean(document.querySelector("[data-dex-clear]"))')) throw new Error('Dex invalid search recovery failed')
  assertScrollContract(dexEmpty)
  await click('[data-dex-clear]')
  await waitFor('document.querySelector("[data-dex-root]")?.dataset.dexVisible === "1025"')
  await click('[data-dex-filter="shining"]')
  await waitFor('Number(document.querySelector("[data-dex-root]")?.dataset.dexVisible || 0) > 0')
  const dexGrade = await capture('dex-shining-grade-filter', { semantics: 'Grade S/SS, not shiny flag' })
  const gradeLabel = await evaluate('document.querySelector("[data-dex-cell]")?.getAttribute("aria-label") || ""')
  if (!/Grade (S|SS)/.test(gradeLabel) || /異色|shiny/i.test(gradeLabel)) throw new Error(`Dex Grade semantics failed: ${gradeLabel}`)
  assertScrollContract(dexGrade)
  await click('[data-dex-filter="all"]')
  await waitFor('document.querySelector("[data-dex-root]")?.dataset.dexVisible === "1025"')
  await evaluate(`(() => { const image = document.querySelector('[data-dex-artwork] img'); if (!image) return false; image.src = '/__m24__/missing-ticket49-dex.png'; return true })()`)
  await waitFor('Boolean(document.querySelector("[data-dex-artwork-state=\\"failed\\"]"))', 8_000)
  const dexArtwork = await capture('dex-artwork-fallback', { fixedSlot: true, accessibleFallback: true })
  if (dexArtwork.diagnostics.artworkFailures < 1) throw new Error('Dex artwork fallback did not render')
  assertScrollContract(dexArtwork)
  await closeOverlay()

  await openMenuTool('achievements', '成就', '[data-achievements-root]')
  await waitFor('Boolean(document.querySelector("[data-achievement-status=\\"ready\\"] [data-achievement-claim]"))')
  await capture('achievements-ready', { canonicalProgress: true })
  const eggBeforeClaim = (await readStorage('mobie.incubator.v1'))?.eggs?.length ?? 0
  await evaluate(`(() => {
    window.__T49_META_SET_ORIGINAL__ = Storage.prototype.setItem; window.__T49_META_SET_COUNT__ = 0
    Storage.prototype.setItem = function(key, value) { if (key === 'mobie.meta.v1') { window.__T49_META_SET_COUNT__ += 1; if (window.__T49_META_SET_COUNT__ === 2) throw new Error('Ticket 49 achievement final receipt failure') } return window.__T49_META_SET_ORIGINAL__.call(this, key, value) }
    return true
  })()`)
  await click('[data-achievement-id="firstcatch"] [data-achievement-claim]')
  await waitFor('Boolean(document.querySelector("[data-achievement-id=\\"firstcatch\\"] [data-achievement-error]"))', 10_000)
  const achievementPartial = await capture('achievement-finalize-error', { downstreamEggSuccess: true, finalMetaFailure: true })
  const pendingClaim = await readStorage('mobie.meta.v1')
  const eggAfterPartial = await readStorage('mobie.incubator.v1')
  if (pendingClaim?.achievementClaims?.find((entry) => entry.achievementId === 'firstcatch')?.status !== 'pending' || (eggAfterPartial?.eggs?.length ?? 0) !== eggBeforeClaim + 1) throw new Error('Achievement partial window did not preserve one pending claim and one egg')
  await evaluate(`(() => { Storage.prototype.setItem = window.__T49_META_SET_ORIGINAL__; delete window.__T49_META_SET_ORIGINAL__; return true })()`)
  await closeOverlay()
  await call('Page.reload', { ignoreCache: true })
  await waitFor('document.readyState === "complete"', 20_000)
  await waitFor('Boolean(document.querySelector("[data-app-shell]"))', 15_000)
  await openMenuTool('achievements', '成就', '[data-achievements-root]')
  await waitFor('document.querySelector("[data-achievement-id=\\"firstcatch\\"]")?.dataset.achievementStatus === "claimed"', 12_000)
  await waitFor('Boolean(localStorage.getItem("mobie.incubator.v1"))', 5_000)
  const achievementRecovered = await capture('achievement-reload-recovery', { noDuplicateEgg: true, finalReceipt: true })
  const eggAfterRecovery = await readStorage('mobie.incubator.v1')
  if ((eggAfterRecovery?.eggs?.length ?? 0) !== eggAfterPartial.eggs.length || achievementRecovered.diagnostics.achievements?.pending !== 0) throw new Error(`Achievement recovery duplicated reward or left pending claim: ${JSON.stringify({ before: eggAfterPartial?.eggs?.length ?? null, after: eggAfterRecovery?.eggs?.length ?? null, pending: achievementRecovered.diagnostics.achievements?.pending ?? null })}`)
  assertScrollContract(achievementRecovered)
  await closeOverlay()

  await evaluate(`(() => {
    const key = 'mobie.meta.v1'; const meta = JSON.parse(localStorage.getItem(key) || '{}')
    meta.stats = { ...(meta.stats || {}), captures: Math.max(10, Number(meta.stats?.captures || 0)) }
    meta.achievementClaims = [...(meta.achievementClaims || []), { claimOperationId: 'achievement-claim:v1:catch10', rewardFingerprint: 'achievement-reward:v1:collision', destination: 'achievement-meta', status: 'pending', achievementId: 'catch10', reward: { kind: 'egg', label: 'common 蛋', speciesPool: [10] }, createdAt: Date.now(), canonicalApplied: false }]
    localStorage.setItem(key, JSON.stringify(meta)); return true
  })()`)
  await call('Page.reload', { ignoreCache: true })
  await waitFor('document.readyState === "complete"', 20_000)
  await waitFor('Boolean(document.querySelector("[data-app-shell]"))', 15_000)
  await openMenuTool('achievements', '成就', '[data-achievements-root]')
  await waitFor('Boolean(document.querySelector("[data-achievement-id=\\"catch10\\"] [data-achievement-claim]"))')
  const beforeCollisionEggs = (await readStorage('mobie.incubator.v1'))?.eggs?.length ?? 0
  await click('[data-achievement-id="catch10"] [data-achievement-claim]')
  await waitFor('Boolean(document.querySelector("[data-achievement-id=\\"catch10\\"] [data-achievement-error]"))', 8_000)
  const achievementCollision = await capture('achievement-operation-collision', { recoverableError: true, noRewardMutation: true })
  const afterCollisionEggs = (await readStorage('mobie.incubator.v1'))?.eggs?.length ?? 0
  if (beforeCollisionEggs !== afterCollisionEggs) throw new Error('Achievement operation collision mutated rewards')
  assertScrollContract(achievementCollision)
  await closeOverlay()

  await evaluate(`(() => {
    const key = 'mobie.incubator.v1'; const state = JSON.parse(localStorage.getItem(key) || '{}')
    state.eggs = [...(state.eggs || []), { id: 'egg-ticket49-tower', seed: 'egg-ticket49-tower', source: 'tower', speciesPool: [1], progress: 5, requiredProgress: 5, label: 'legacy tower egg' }]
    state.nextId = Math.max(Number(state.nextId || 1), 100); localStorage.setItem(key, JSON.stringify(state)); return true
  })()`)
  await call('Page.reload', { ignoreCache: true })
  await waitFor('document.readyState === "complete"', 20_000)
  await waitFor('Boolean(document.querySelector("[data-app-shell]"))', 15_000)
  await openMenuTool('incubator', '孵化所', '[data-incubator-root]')
  const incubatorSources = await capture('incubator-sources', { accepted: ['achievement', 'duplicate'], legacyTower: 'invalid-source' })
  const towerRow = await evaluate('document.querySelector("[data-egg-source=\\"tower\\"]")?.dataset.eggState || null')
  if (towerRow !== 'invalid-source' || await evaluate('Boolean(document.querySelector("[data-egg-source=\\"tower\\"] button:not([disabled])"))')) throw new Error('Tower egg was accepted by Incubator UI')
  assertScrollContract(incubatorSources)

  const duplicateEggId = await evaluate('document.querySelector("[data-egg-source=\\"duplicate\\"][data-egg-state=\\"ready\\"]")?.dataset.eggId || null')
  if (!duplicateEggId) throw new Error('No ready duplicate-capture egg for hatch closure')
  const rosterBeforeHatch = (await rosterFromStorage()).length
  const metaBeforeHatch = await readStorage('mobie.meta.v1')
  await evaluate(`(() => {
    window.__T49_INCUBATOR_SET_ORIGINAL__ = Storage.prototype.setItem; window.__T49_INCUBATOR_SET_COUNT__ = 0
    Storage.prototype.setItem = function(key, value) { if (key === 'mobie.incubator.v1') { window.__T49_INCUBATOR_SET_COUNT__ += 1; if (window.__T49_INCUBATOR_SET_COUNT__ === 2) throw new Error('Ticket 49 hatch final receipt failure') } return window.__T49_INCUBATOR_SET_ORIGINAL__.call(this, key, value) }
    return true
  })()`)
  await click(`[data-egg-id="${duplicateEggId}"] [data-egg-hatch]`)
  await waitFor(`Boolean(document.querySelector('[data-egg-id="${duplicateEggId}"][data-egg-state="error"]'))`, 12_000)
  await capture('hatch-finalize-error', { downstreamRosterMetaSuccess: true, incubatorFinalFailure: true, eggId: duplicateEggId })
  const rosterAfterHatchPartial = (await rosterFromStorage()).length
  const metaAfterHatchPartial = await readStorage('mobie.meta.v1')
  if (rosterAfterHatchPartial !== rosterBeforeHatch + 1 || Number(metaAfterHatchPartial?.stats?.captures ?? 0) !== Number(metaBeforeHatch?.stats?.captures ?? 0) + 1) throw new Error('Hatch children did not apply exactly once before final failure')
  await evaluate(`(() => { Storage.prototype.setItem = window.__T49_INCUBATOR_SET_ORIGINAL__; delete window.__T49_INCUBATOR_SET_ORIGINAL__; return true })()`)
  await closeOverlay().catch(() => undefined)
  await call('Page.reload', { ignoreCache: true })
  await waitFor('document.readyState === "complete"', 20_000)
  await waitFor('Boolean(document.querySelector("[data-app-shell]"))', 15_000)
  await openMenuTool('incubator', '孵化所', '[data-incubator-root]')
  await waitFor(`!document.querySelector('[data-egg-id="${duplicateEggId}"]')`, 12_000)
  const hatchRecovered = await capture('hatch-reload-recovery', { noDuplicateMobie: true, noDuplicateDexRegistration: true, eggId: duplicateEggId })
  const rosterAfterHatchRecovery = await rosterFromStorage(); const metaAfterHatchRecovery = await readStorage('mobie.meta.v1')
  const hatchReceiptEntry = (await readStorage('mobie.incubator.v1'))?.hatchOutbox?.find((entry) => entry.eggId === duplicateEggId)
  if (rosterAfterHatchRecovery.length !== rosterAfterHatchPartial || Number(metaAfterHatchRecovery?.stats?.captures ?? 0) !== Number(metaAfterHatchPartial?.stats?.captures ?? 0) || hatchReceiptEntry?.status !== 'settled' || !hatchReceiptEntry?.payload?.unit?.speciesId || !metaAfterHatchRecovery?.registered?.includes(hatchReceiptEntry.payload.unit.speciesId)) throw new Error(`Hatch recovery duplicated roster/meta or lost receipt/Dex registration: ${JSON.stringify({ hatchReceiptEntry, metaAfterHatchRecovery })}`)
  assertScrollContract(hatchRecovered)
  await closeOverlay()

  await evaluate('window.__MOBIE_M24_BASELINE__.prepareIncubatorLoading(); true')
  await openMenuTool('incubator', '孵化所', '[data-incubator-root]')
  await waitFor('Boolean(document.querySelector("[data-incubator-state=\\"loading\\"]"))')
  const incubatorLoading = await capture('incubator-loading', { recovery: '重新載入' })
  assertScrollContract(incubatorLoading)
  await click('[data-incubator-state="loading"] button')
  await waitFor('document.querySelector("[data-incubator-root]")?.dataset.incubatorState === "ready"')
  await closeOverlay()
  await evaluate('window.__MOBIE_M24_BASELINE__.restoreIncubatorFixture(); true')

  await evaluate('window.__MOBIE_M24_BASELINE__.prepareIncubatorError(); true')
  await openMenuTool('incubator', '孵化所', '[data-incubator-root]')
  await waitFor('Boolean(document.querySelector("[data-incubator-state=\\"error\\"]"))')
  const incubatorError = await capture('incubator-error', { recovery: '重新載入' })
  assertScrollContract(incubatorError)
  await click('[data-incubator-state="error"] button')
  await waitFor('document.querySelector("[data-incubator-root]")?.dataset.incubatorState === "ready"')
  await closeOverlay()
  await evaluate('window.__MOBIE_M24_BASELINE__.restoreIncubatorFixture(); true')

  await evaluate('window.__MOBIE_M24_BASELINE__.prepareIncubatorEmpty(); true')
  await openMenuTool('incubator', '孵化所', '[data-incubator-root]')
  await waitFor('Boolean(document.querySelector("[data-incubator-state=\\"empty\\"]"))')
  const incubatorEmpty = await capture('incubator-empty', { recovery: '取得成就或重複捕獲蛋' })
  assertScrollContract(incubatorEmpty)
  await closeOverlay()
  await evaluate('window.__MOBIE_M24_BASELINE__.restoreIncubatorFixture(); true')

  await evaluate(`(() => {
    const key = 'mobie.incubator.v1'; const state = JSON.parse(localStorage.getItem(key) || '{}')
    const filler = Array.from({ length: 30 }, (_, index) => ({ id: 'egg-ticket49-filler-' + (index + 1), seed: 'egg-ticket49-filler-' + (index + 1) + '-duplicate', source: 'duplicate', speciesPool: [1], progress: index % 8, requiredProgress: 8, label: '長清單蛋 ' + (index + 1) }))
    state.eggs = [...(state.eggs || []), { id: 'egg-ticket49-timeout', seed: 'egg-ticket49-timeout-duplicate', source: 'duplicate', speciesPool: [4], progress: 8, requiredProgress: 8, label: 'timeout test egg' }, { id: 'egg-ticket49-skip', seed: 'egg-ticket49-skip-achievement', source: 'achievement', speciesPool: [7], progress: 6, requiredProgress: 6, label: 'skip test egg' }, ...filler]
    state.nextId = Math.max(Number(state.nextId || 1), 101); localStorage.setItem(key, JSON.stringify(state))
    const settings = { schemaVersion: 2, prefs: { enhancedInteractivity: { mode: 'lite', surfaces: { capture: true, starStrike: true, defense: true, encounter: true, hatch: true, tower: true } }, recordReplays: false, attackInputVariant: 'mash', juice: 'full', haptics: true, graphicsPreference: 'auto', scannerEnabled: false } }; localStorage.setItem('mobie.settings.v2', JSON.stringify(settings)); return true
  })()`)
  await call('Page.reload', { ignoreCache: true }); await waitFor('document.readyState === "complete"', 20_000); await waitFor('Boolean(document.querySelector("[data-app-shell]"))', 15_000)
  await openMenuTool('incubator', '孵化所', '[data-incubator-root]'); const timeoutBefore = await hatchSnapshot('egg-ticket49-timeout'); await click('[data-egg-id="egg-ticket49-timeout"] [data-egg-hatch]'); await waitFor('Boolean(document.querySelector("[data-gesture-skip]"))', 8_000)
  const gestureGate = await capture('hatch-gesture-gate', { keyboardEscape: 'ignored', timeoutMs: 6000 }); if (gestureGate.diagnostics.overlay === null) throw new Error('Hatch gesture gate did not mount')
  const escapeGesture = await pressKey('Escape'); if (!escapeGesture.overlay) throw new Error('Hatch gesture gate dismissed by Escape')
  await sleep(6_300); await waitFor('Boolean(document.querySelector("[data-hatch-reveal]"))', 8_000)
  await evaluate(`(() => { const image = document.querySelector('[data-hatch-reveal] [data-artwork-state] img'); if (!image) return false; image.src = '/__m24__/missing-ticket49-hatch.png'; return true })()`)
  await waitFor('Boolean(document.querySelector("[data-hatch-reveal] [data-artwork-state=\\"failed\\"]"))', 8_000)
  const hatchArtwork = await capture('hatch-artwork-fallback', { partialArtwork: true, fixedFallbackSlot: true })
  assertScrollContract(hatchArtwork)
  const timeoutAfter = await assertHatchApplied('egg-ticket49-timeout', timeoutBefore, 'Timeout')
  const hatchTimeout = await capture('hatch-timeout-reveal', { timeout: true, canonicalReceipt: true, rosterCount: timeoutAfter.rosterCount, receiptStatus: timeoutAfter.receiptStatus })
  await click('[data-hatch-dismiss]'); await waitFor('document.querySelector("[data-overlay-host]")?.dataset.overlayId === "incubator"')
  const skipBefore = await hatchSnapshot('egg-ticket49-skip')
  await click('[data-egg-id="egg-ticket49-skip"] [data-egg-hatch]'); await waitFor('Boolean(document.querySelector("[data-gesture-skip]"))')
  await click('[data-gesture-skip]'); await waitFor('Boolean(document.querySelector("[data-hatch-reveal]"))')
  const skipAfter = await assertHatchApplied('egg-ticket49-skip', skipBefore, 'Skip')
  const hatchSkip = await capture('hatch-skip-reveal', { skip: true, canonicalReceipt: true, rosterCount: skipAfter.rosterCount, receiptStatus: skipAfter.receiptStatus }); assertScrollContract(hatchSkip); await click('[data-hatch-dismiss]'); await waitFor('document.querySelector("[data-overlay-host]")?.dataset.overlayId === "incubator"')
  await evaluate(`(() => { const settings = JSON.parse(localStorage.getItem('mobie.settings.v2') || '{}'); settings.schemaVersion = 2; settings.prefs = { ...(settings.prefs || {}), enhancedInteractivity: { ...(settings.prefs?.enhancedInteractivity || {}), mode: 'off', surfaces: { capture: true, starStrike: true, defense: true, encounter: true, hatch: true, tower: true } }, recordReplays: false, attackInputVariant: 'mash', juice: 'full', haptics: true, graphicsPreference: 'auto', scannerEnabled: false }; localStorage.setItem('mobie.settings.v2', JSON.stringify(settings)); return true })()`)

  await evaluate(`(() => {
    const key = 'mobie.incubator.v1'; const state = JSON.parse(localStorage.getItem(key) || '{}'); state.eggs = [{ id: 'egg-ticket49-reduced', seed: 'egg-ticket49-reduced-achievement', source: 'achievement', speciesPool: [7], progress: 6, requiredProgress: 6, label: 'reduced motion test egg' }, ...(state.eggs || [])]; state.nextId = Math.max(Number(state.nextId || 1), 102); localStorage.setItem(key, JSON.stringify(state)); return true
  })()`)
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }); await call('Page.reload', { ignoreCache: true }); await waitFor('document.readyState === "complete"', 20_000); await waitFor('Boolean(document.querySelector("[data-app-shell]"))', 15_000)
  await openMenuTool('incubator', '孵化所', '[data-incubator-root]'); const reducedBefore = await hatchSnapshot('egg-ticket49-reduced'); await click('[data-egg-id="egg-ticket49-reduced"] [data-egg-hatch]'); await waitFor('Boolean(document.querySelector("[data-hatch-reveal]"))', 12_000)
  const reducedAfter = await assertHatchApplied('egg-ticket49-reduced', reducedBefore, 'Reduced motion')
  const reduced = await capture('hatch-reduced-motion', { prefersReducedMotion: true, directHatch: true, rosterCount: reducedAfter.rosterCount, receiptStatus: reducedAfter.receiptStatus }); assertScrollContract(reduced); await click('[data-hatch-dismiss]'); await waitFor('document.querySelector("[data-overlay-host]")?.dataset.overlayId === "incubator"'); await closeOverlay(); await call('Emulation.setEmulatedMedia', { features: [] })

  await openMenuTool('incubator', '孵化所', '[data-incubator-root]')
  const incubatorPage1 = await capture('incubator-pagination-page-1', { boundedPage: true, totalExpectedAtLeast: 30 })
  if ((incubatorPage1.diagnostics.incubator?.domCap ?? 0) > 24 || !incubatorPage1.diagnostics.incubator?.total || incubatorPage1.diagnostics.incubator.total < 30) throw new Error('Incubator page one exceeded the bounded DOM cap')
  await click('[data-incubator-load-more]'); await waitFor('document.querySelector("[data-incubator-root]")?.dataset.incubatorPage === "2"')
  const incubatorPage2 = await capture('incubator-pagination-page-2', { boundedPage: true, page: 2 })
  if ((incubatorPage2.diagnostics.incubator?.domCap ?? 0) > 24) throw new Error('Incubator page two exceeded the bounded DOM cap')
  assertScrollContract(incubatorPage2); await closeOverlay()

  await openMenuTool('dex', '圖鑑', '[data-dex-root]'); await click('[data-dex-filter="owned"]'); await waitFor('Number(document.querySelector("[data-dex-root]")?.dataset.dexVisible || 0) > 0'); const handoffDex = await capture('roster-dex-handoff', { afterHatch: true, canonicalRoster: true, hatchedSpecies: hatchReceiptEntry?.payload?.unit?.speciesId ?? null }); if (handoffDex.diagnostics.dex?.total !== 1025 || handoffDex.diagnostics.dex.cells > 60 || !handoffDex.diagnostics.dex?.visible) throw new Error('Roster/Dex handoff lost bounded national catalog'); assertScrollContract(handoffDex); await closeOverlay()

  await setViewport(590, 410, 2); await click('button[aria-label="我的 Mobie"]'); await waitFor('Boolean(document.querySelector("[data-collection-shell]"))')
  await evaluate(`(() => { document.documentElement.style.setProperty('--safe-t', '24px'); document.documentElement.style.setProperty('--safe-r', '18px'); document.documentElement.style.setProperty('--safe-b', '32px'); document.documentElement.style.setProperty('--safe-l', '18px'); const heading = document.querySelector('[data-collection-shell] .collection-pane-head h3'); if (heading) heading.textContent = '長文字 collection safe-area closure probe：'.repeat(10); document.querySelector('[data-collection-scroll-owner="list"]')?.scrollTo({ top: 80, left: 0 }); return true })()`)
  const zoom = await capture('collection-zoom-200-safe-area', { viewport: '590x410', pageScale: 2, safeAreaInsets: [24, 18, 32, 18], longText: true }); if (zoom.diagnostics.overflow.document || zoom.diagnostics.overflow.body || !zoom.diagnostics.safeArea.appPadding.includes('24px')) throw new Error(`Collection 200% safe-area boundary failed: ${JSON.stringify(zoom.diagnostics)}`); assertScrollContract(zoom, { collection: true }); await closeOverlay()

  for (const viewport of VIEWPORTS) {
    await setViewport(viewport.width, viewport.height); const records = []
    await click('button[aria-label="我的 Mobie"]'); await waitFor('Boolean(document.querySelector("[data-collection-shell]"))'); const collection = await capture(`matrix-${viewport.id}-collection`, { viewport }); if (collection.diagnostics.collection?.domCap > 24 || collection.diagnostics.collection?.visible > 24) throw new Error(`Collection matrix bound failed for ${viewport.id}`); assertScrollContract(collection, { collection: true }); records.push(collection); await closeOverlay()
    await openMenuTool('moves', '招式', '[data-move-trainer]'); const trainer = await capture(`matrix-${viewport.id}-trainer`, { viewport }); if (trainer.diagnostics.trainer?.domCap > 24 || trainer.diagnostics.trainer?.visible > 24) throw new Error(`Trainer matrix bound failed for ${viewport.id}`); assertScrollContract(trainer); records.push(trainer); await closeOverlay()
    await openMenuTool('partner', '夥伴技能', '[data-partner-skills]'); const partner = await capture(`matrix-${viewport.id}-partner`, { viewport }); assertScrollContract(partner); records.push(partner); await closeOverlay()
    await openMenuTool('dex', '圖鑑', '[data-dex-root]'); const dex = await capture(`matrix-${viewport.id}-dex`, { viewport }); if (dex.diagnostics.dex?.cells > 60 || dex.diagnostics.dex?.total !== 1025) throw new Error(`Dex matrix bound failed for ${viewport.id}`); assertScrollContract(dex); records.push(dex); await closeOverlay()
    await openMenuTool('achievements', '成就', '[data-achievements-root]'); const achievements = await capture(`matrix-${viewport.id}-achievements`, { viewport }); assertScrollContract(achievements); records.push(achievements); await closeOverlay()
    await openMenuTool('incubator', '孵化所', '[data-incubator-root]'); const incubator = await capture(`matrix-${viewport.id}-incubator`, { viewport }); if (incubator.diagnostics.incubator?.domCap > 24) throw new Error(`Incubator matrix bound failed for ${viewport.id}`); assertScrollContract(incubator); records.push(incubator); await closeOverlay()
    for (const record of records) { if (record.diagnostics.overflow.document || record.diagnostics.overflow.body) throw new Error(`Overflow in ${record.checkpoint}`); matrix.push({ viewport: viewport.id, checkpoint: record.checkpoint, diagnostics: record.diagnostics }) }
  }

  await setViewport(1180, 820); await ensureRegion(); const finalDiagnostics = await routeState(); const modelSentinelAfter = await readModelSentinel(); const unhandledRejections = await evaluate('window.__T49_UNHANDLED__ ?? []'); const allCdpEvents = events; const accessibility = await call('Accessibility.getFullAXTree', { depth: -1 })
  await writeFile(resolve(OUTPUT_ROOT, 'accessibility.json'), `${JSON.stringify({ schemaVersion: 1, ticket: 49, capturedAt: new Date().toISOString(), nodes: (accessibility.nodes ?? []).filter((node) => !node.ignored && node.role?.value && node.name?.value).map((node) => ({ role: String(node.role.value), name: String(node.name.value) })).slice(0, 1200) }, null, 2)}\n`)
  const evidence = {
    schemaVersion: 1, ticket: 49, scenario: SCENARIO, capturedAt: new Date().toISOString(), viewportMatrix: VIEWPORTS, checkpoints, matrix,
    modelStore: { database: 'mz-models', sentinel: { id: 'ticket49-sentinel', payload: 'untouched' }, after: modelSentinelAfter, databases: finalDiagnostics.modelDatabases }, finalDiagnostics,
    errors: { console: allCdpEvents.filter((event) => event.method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(event.params?.type)), runtime: allCdpEvents.filter((event) => event.method === 'Runtime.exceptionThrown'), networkFailed: allCdpEvents.filter((event) => event.method === 'Network.loadingFailed').map((event) => ({ requestId: event.params?.requestId, errorText: event.params?.errorText, url: event.params?.blockedReason ?? null })), unhandledRejections },
    assertions: {
      collectionJourney: checkpoints.some((record) => record.checkpoint === 'collection-mobcard-detail') && checkpoints.some((record) => record.checkpoint === 'move-trainer-actions') && checkpoints.some((record) => record.checkpoint === 'partner-skills-unlock') && checkpoints.some((record) => record.checkpoint === 'collection-empty') && checkpoints.some((record) => record.checkpoint === 'collection-error'),
      dexJourney: checkpoints.some((record) => record.checkpoint === 'dex-last-page') && checkpoints.some((record) => record.checkpoint === 'dex-detail') && checkpoints.some((record) => record.checkpoint === 'dex-invalid-search') && checkpoints.some((record) => record.checkpoint === 'dex-positive-search') && checkpoints.some((record) => record.checkpoint === 'dex-shining-grade-filter'),
      achievementJourney: checkpoints.some((record) => record.checkpoint === 'achievement-finalize-error') && checkpoints.some((record) => record.checkpoint === 'achievement-reload-recovery'),
      hatchJourney: checkpoints.some((record) => record.checkpoint === 'hatch-finalize-error') && checkpoints.some((record) => record.checkpoint === 'hatch-reload-recovery') && checkpoints.some((record) => record.checkpoint === 'hatch-timeout-reveal') && checkpoints.some((record) => record.checkpoint === 'hatch-skip-reveal') && checkpoints.some((record) => record.checkpoint === 'hatch-reduced-motion') && checkpoints.some((record) => record.checkpoint === 'incubator-pagination-page-2'),
      operationCollisionRecoverable: checkpoints.some((record) => record.checkpoint === 'achievement-operation-collision'),
      rosterDomBounded: checkpoints.filter((record) => record.diagnostics.collection || record.diagnostics.trainer).every((record) => (record.diagnostics.collection?.domCap ?? record.diagnostics.trainer?.domCap ?? 0) <= 24),
      dexDomBounded: checkpoints.filter((record) => record.diagnostics.dex).every((record) => (record.diagnostics.dex?.cells ?? 0) <= 60),
      noHorizontalOverflow: [...checkpoints, ...matrix].every((record) => !record.diagnostics.overflow.document && !record.diagnostics.overflow.body),
      targetMinimum44: [...checkpoints, ...matrix].every((record) => record.diagnostics.targetHeights.allAtLeast44),
      artworkFallbacks: checkpoints.some((record) => record.checkpoint === 'collection-artwork-fallback') && checkpoints.some((record) => record.checkpoint === 'move-trainer-artwork-fallback') && checkpoints.some((record) => record.checkpoint === 'dex-artwork-fallback') && checkpoints.some((record) => record.checkpoint === 'hatch-artwork-fallback'),
      noCustomModels: [...checkpoints, ...matrix].every((record) => record.diagnostics.performance.threeOrModel.length === 0) && JSON.stringify(modelSentinelAfter) === JSON.stringify({ id: 'ticket49-sentinel', payload: 'untouched' }),
      noUnhandledRejections: unhandledRejections.length === 0,
    },
    limitations: ['Chrome CDP is browser contract evidence; native iPad Safari remains Ticket 51.', 'The DEV-only fixture creates a large canonical roster through the real roster store; UI actions use production boundaries.', 'Battle and Result routes remain covered by Ticket 48.'],
  }
  await writeFile(resolve(OUTPUT_ROOT, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`)
  if (evidence.errors.console.length || evidence.errors.runtime.length || evidence.errors.networkFailed.length || evidence.errors.unhandledRejections.length) throw new Error(`Chrome diagnostics reported errors: ${JSON.stringify(evidence.errors)}`)
  console.log(`Ticket 49 Chrome closure passed: ${checkpoints.length} checkpoints; ${matrix.length} viewport checks`)
  cdp.close()
}

main().catch(async (error) => {
  console.error(`Ticket 49 Chrome closure failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
