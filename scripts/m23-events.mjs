// Chrome/CDP event choreography evidence, using actual UI commands and the production reducer.
// Start Vite :5173 and isolated Chrome CDP :9222. No runtime/dev dependencies.
// CASES=heal,buff MOTION=reduced GRAPHICS=compatibility node scripts/m23-events.mjs
import { mkdir, writeFile } from 'node:fs/promises'
const config = { port: Number(process.env.CDP_PORT ?? 9222), graphics: process.env.GRAPHICS ?? 'balanced', motion: process.env.MOTION ?? 'full', asset: process.env.ASSET ?? null }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
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


const cdp = await connect()
const call = cdp.call
const errors = []
function expectedAssetError(event) {
  if (!config.asset) return false
  const text = JSON.stringify(event)
  return text.includes('/__m23__/missing-artwork.png') || text.includes('data:image/png;base64,bm90LWFuLWltYWdl')
    || text.includes('The above error occurred in the <BillboardSprite> component')
}

cdp.on('Runtime.exceptionThrown', (event) => errors.push(event))
cdp.on('Runtime.consoleAPICalled', (event) => { if (event.type === 'error') errors.push(event) })
const evaluate = async (expression) => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result.value
}
const waitFor = async (expression, timeout = 20000) => {
  const end = Date.now() + timeout
  while (Date.now() < end) { if (await evaluate(expression)) return; await sleep(80) }
  throw new Error(`Timeout: ${expression}`)
}
const click = (expression) => evaluate(`(${expression}).click()`)
const outputSuffix = process.env.OUTPUT_SUFFIX ?? ''
if (outputSuffix && !/^[a-zA-Z0-9_-]+$/.test(outputSuffix)) throw new Error('Invalid OUTPUT_SUFFIX')
const outputRoot = `test-runs/m23/chrome-ticket15/${config.graphics}-${config.motion}${outputSuffix ? '-' + outputSuffix : ''}`
const records = []
async function boot() {
  await call('Page.navigate', { url: `http://127.0.0.1:5173/?m23Scenario=m23-current-parity-v1&graphics=${config.graphics}&motion=${config.motion}&cueStep=0${config.asset ? '' : '&vfxLab=1'}` })
  await waitFor('Boolean(window.__MOBIE_M23_BASELINE__?.active)')
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
  await waitFor('Boolean(document.querySelector(".battle-scene-host"))', 25_000)


  await evaluate('window.__MOBIE_M23_BASELINE__.resume()')
  await waitFor('Boolean(document.querySelector(".move-slot"))')
  await sleep(600)
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: config.motion === 'full' ? 'no-preference' : 'reduce' }] })
}

async function prepare(kind) {
  return evaluate(`(async () => {
    const { useBattleStore } = await import('/src/store/battleStore.ts')
    const { MOVES } = await import('/src/game/data/moves.ts')
    const { resolveTurn, SUPPORT_EVERY } = await import('/src/game/battle/reducer.ts')
    const { makeRng } = await import('/src/game/rng.ts')
    const { PRODUCT_RUNTIME } = await import('/src/game/ext/productRuntime.ts')
    const { makeWildEvents } = await import('/src/game/accidents.ts')
    const { TERRAINS, resolveTerrainMult } = await import('/src/game/data/terrains.ts')
    const driver = window.__MOBIE_M23_BASELINE__
    const kind = ${JSON.stringify(kind)}
    const fixture = ({ heal: 'heal', buff: 'status-buff', debuff: 'status-buff', terrain: 'status-buff',
      switch: 'switch-forced-switch', chain: 'chain-combo', star: 'crit-super-star', 'star-skip': 'crit-super-star',
      win: 'win', lose: 'lose', timeout: 'timeout', 'timeout-skip': 'timeout',
      'star-skip-normal': 'crit-super-star', abort: 'status-buff', unmount: 'status-buff', supersede: 'status-buff',
    })[kind] ?? 'normal-hit-chain-ready'
    driver.resetDiagnostics()
    driver.prepareTransactionCase(fixture)
    let state = useBattleStore.getState()
    const battle = structuredClone(state.battle)
    const player = battle.player.members[battle.player.activeIndex]
    if (kind === 'buff' || kind === 'debuff' || kind === 'terrain') {
      const move = kind === 'terrain' ? MOVES[2004] : kind === 'debuff'
        ? { ...MOVES[2000], effect: { ...MOVES[2000].effect, mult: 0.7, label: '展示測試攻擊降低' } } : MOVES[2000]
      player.move = move
      player.moves = [move]
    }
    if (kind.startsWith('support')) battle.turn = SUPPORT_EVERY
    let seed = state.session.battleSeed
    let predictedEvents = null
    if (kind.startsWith('support')) {
      const desired = ({ support: 'attackUp', 'support-ally': 'ally', 'support-crit': 'crit', 'support-dud': 'dud' })[kind]
      for (let index = 0; index < 1000; index += 1) {
        const candidate = 'm23-events:' + kind + ':' + index
        const result = resolveTurn(battle, { type: 'ATTACK', quality: 'good', mashCount: 0, slotIndex: 0 }, {
          rng: makeRng(candidate), ext: PRODUCT_RUNTIME.turnExtensions,
        })
        if (result.events.some((event) => event.type === 'random' && event.event.type === 'supportRoulette' && event.event.outcome === desired)) {
          seed = candidate; predictedEvents = result.events; break
        }
      }
      if (!predictedEvents) throw new Error('Unable to find support seed')
    }
    if (kind === 'intrusion' || kind === 'wild-terrain') {
      battle.turn = 2
      // Clear preparedCase so BattleScreen uses the actual region's production wild hook.
      driver.prepareHudCase('choice-complete')
      state = useBattleStore.getState()
      const wildEvents = makeWildEvents({ terrainPool: TERRAINS.filter((terrain) => terrain.id !== 'neutral').map((terrain) => terrain.id) })
      const expected = kind === 'intrusion' ? 'intrusion' : 'terrainShift'
      for (let index = 0; index < 2000; index += 1) {
        const candidate = 'm23-events:' + kind + ':' + index
        const result = resolveTurn(battle, { type: 'ATTACK', quality: 'good', mashCount: 0, slotIndex: 0 }, {
          rng: makeRng(candidate), ext: PRODUCT_RUNTIME.turnExtensions, wildEvents, terrainMultiplier: resolveTerrainMult,
        })
        if (result.events.some((event) => event.type === 'wildAccident' && event.kind === expected)) {
          seed = candidate
          predictedEvents = result.events
          break
        }
      }
      if (!predictedEvents) throw new Error('Unable to find a deterministic wild seed')
    }
    useBattleStore.setState({ battle, phase: 'playerChoice', session: { ...state.session, battleSeed: seed, rngCursor: 0 } })
    driver.takeQteQuality = () => fixture === 'switch-forced-switch' ? 'weak' : 'good'
    driver.resume()
    const panel = document.querySelector('[data-vfx-panel-details]')
    if (panel) panel.open = false
    window.__m23EventUnsubscribe?.()
    window.__m23EventHistory = []
    window.__m23EventLive = []
    let previous = ''
    const sample = () => {
      const current = useBattleStore.getState()
      const canonical = current.battle
      const shown = current.presentation?.battle ?? canonical
      const scene = document.querySelector('.battle-scene-host')
      const value = {
        phase: current.phase, turn: canonical?.turn, shownTurn: shown?.turn,
        canonicalActive: canonical ? [canonical.player.activeIndex, canonical.foe.activeIndex] : null,
        shownActive: shown ? [shown.player.activeIndex, shown.foe.activeIndex] : null,
        hp: shown ? { player: shown.player.members.map((m) => m.currentHp), foe: shown.foe.members.map((m) => m.currentHp) } : null,
        canonicalHp: canonical ? { player: canonical.player.members.map((m) => m.currentHp), foe: canonical.foe.members.map((m) => m.currentHp) } : null,
        field: shown?.field, banner: current.presentation?.banner ?? current.banner,
        support: current.presentation?.support ?? current.support,
        feed: driver.feed().map((entry) => ({ id: entry.id, text: entry.text })),
        camera: scene?.dataset.battleCameraShot, error: current.battleError,
        pendingEvents: current.session?.pendingReplay?.turn?.events,
      }
      const digest = JSON.stringify(value)
      if (digest !== previous) { previous = digest; window.__m23EventHistory.push({ at: performance.now(), ...value }) }
    }
    sample()
    window.__m23EventUnsubscribe = useBattleStore.subscribe(sample)
    window.__m23LiveObserver?.disconnect()
    window.__m23LiveObserver = new MutationObserver(() => {
      const text = [...document.querySelectorAll('[aria-live]')].map((node) => node.textContent).filter(Boolean).join(' | ')
      if (text && window.__m23EventLive.at(-1)?.text !== text) window.__m23EventLive.push({ at: performance.now(), text })
    })
    window.__m23LiveObserver.observe(document.body, { subtree: true, childList: true, characterData: true })
    return { kind, fixture, seed, predictedEvents, before: battle,
      dataScope: kind === 'debuff' ? 'Synthetic presentation fixture using buff mult<1; no generated debuff move exists' : 'Production reducer via actual UI input and DEV state fixture' }
  })()`)
}

async function screenshot(kind, label) {
  const file = `${kind}-${label.replace(/[^a-zA-Z0-9_-]/g, '_')}.png`
  const { data } = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await writeFile(`${outputRoot}/${file}`, Buffer.from(data, 'base64'))
  return file
}

async function runCase(kind) {
  await boot()
  const prepared = await prepare(kind)
  if (process.env.ASSET) {
    await evaluate(`window.__MOBIE_M23_BASELINE__.prepareArtworkFixture(${JSON.stringify(process.env.ASSET)})`)
    await sleep(600)
  }
  const startAt = await evaluate('performance.now()')
  const captures = []
  const observations = []
  const seen = new Set()
  if (kind === 'switch') {
    await click('document.querySelector(\'[data-battle-action="switch"]\')')
    await waitFor('Boolean(document.querySelector(".switch-card"))')
    captures.push(await screenshot(kind, 'switch-sheet'))
    await click('document.querySelector(".switch-card")')
  } else if (kind === 'chain' || kind.startsWith('star')) {
    await waitFor(`Boolean(document.querySelector('[data-battle-action="${kind === 'chain' ? 'chain' : 'star'}"]'))`)
    await click(`document.querySelector('[data-battle-action="${kind === 'chain' ? 'chain' : 'star'}"]')`)
  } else {
    await waitFor('Boolean(document.querySelector(".move-slot"))')
    await click('document.querySelector(".move-slot")')
  }
  let completed = false
  let skipClicked = false
  let earlySkip = null
  let normalAfterStarStarted = false
  let intervention = null
  const cancellation = ['abort', 'unmount', 'supersede'].includes(kind)
  const deadline = Date.now() + 45000
  while (Date.now() < deadline) {
    const state = await evaluate(`(() => {
      const d = window.__MOBIE_M23_BASELINE__
      const trace = d.diagnostics().presentationTrace
      return { at: performance.now(), phase: d.runtimeState().phase, trace, skip: (() => { const node = document.querySelector('[data-presentation-skip]'); return node ? { kind: node.dataset.presentationSkip, ready: node.getAttribute('aria-disabled') === 'false' } : null })(),
        compatibility: [...document.querySelectorAll('[data-compat-state]')].map((node) => ({ side: node.dataset.battleCombatant, mode: node.dataset.compatState, opacity: getComputedStyle(node.querySelector('.battle-renderer__combatant-motion')).opacity })), outcome: Boolean(document.querySelector('.exp-summary')),
        banner: document.querySelector('.battle-banner')?.textContent,
        cutIn: document.querySelector('.cutin')?.textContent, starPhase: document.querySelector('[data-star-phase]')?.dataset.starPhase, outcomePhase: document.querySelector('[data-outcome]')?.dataset.outcome,
        support: document.querySelector('.support-overlay')?.textContent,
        camera: document.querySelector('.battle-scene-host')?.dataset.battleCameraShot,
      }
    })()`)
    observations.push({ at: state.at, phase: state.phase, camera: state.camera, starPhase: state.starPhase, outcomePhase: state.outcomePhase, skip: state.skip, compatibility: state.compatibility })
    const cue = [...state.trace].reverse().find((entry) => entry.stage === 'cue')?.detail ?? ''
    const ordinal = state.trace.filter((entry) => entry.stage === 'cue').length
    const label = `${state.phase}-${ordinal}-${state.starPhase || state.outcomePhase || cue || state.support || state.cutIn || 'ready'}`
    if (!seen.has(label) && (state.phase !== 'busy' || cue)) {
      seen.add(label)
      captures.push(await screenshot(kind, label))
    }
    if (kind.includes('skip') && state.skip && !state.skip.ready && !earlySkip) {
      const before = { skips: state.trace.filter((entry) => entry.stage === 'skip').length, commits: state.trace.filter((entry) => entry.stage === 'commit' && entry.purpose === 'turn').length }
      await evaluate('document.querySelector("[data-presentation-skip]")?.click()')
      const after = await evaluate('(() => { const trace = window.__MOBIE_M23_BASELINE__.diagnostics().presentationTrace; return { skips: trace.filter((entry) => entry.stage === "skip").length, commits: trace.filter((entry) => entry.stage === "commit" && entry.purpose === "turn").length } })()')
      earlySkip = { at: state.at, gate: state.skip, before, after }
      if (before.skips !== after.skips || before.commits !== after.commits) throw new Error('Skip gate accepted an early click')
    }
    if (kind.includes('skip') && !skipClicked) {
      skipClicked = await evaluate(`(() => {
        const button = document.querySelector('[data-presentation-skip][aria-disabled="false"]')
        if (!button) return false
        button.click()
        return true
      })()`)
    }
    if (cancellation && !intervention && state.phase === 'busy' && state.trace.some((entry) => entry.stage === 'cue' && entry.detail === 'statusApplied:begin')) {
      intervention = { at: await evaluate('performance.now()'), kind }
      if (kind === 'unmount') await evaluate('window.dispatchEvent(new Event("mobie:m23-unmount-battle"))')
      else await evaluate('(async () => { const { endRegisteredBattleLifecycle } = await import("/src/presentation/battle/battleLifecycleBridge.ts"); return endRegisteredBattleLifecycle(' + JSON.stringify(kind === 'abort' ? 'leave' : 'superseded') + ') })()')
      await sleep(2200)
      completed = true
      break
    }
    if (kind === 'context-loss' && !intervention && state.phase === 'busy' && state.trace.some((entry) => entry.stage === 'cue')) {
      const lost = await evaluate('(() => { const canvas = document.querySelector(".battle-next-canvas canvas"); const gl = canvas?.getContext("webgl2"); const ext = gl?.getExtension("WEBGL_lose_context"); if (!ext) return false; ext.loseContext(); return true })()')
      if (!lost) throw new Error('Live WebGL context-loss extension unavailable')
      intervention = { kind, at: await evaluate('performance.now()') }
    }
    const committed = state.trace.filter((entry) => entry.stage === 'commit' && entry.purpose === 'turn')
    if (kind === 'star-skip-normal' && committed.length === 1 && state.phase === 'playerChoice' && !normalAfterStarStarted) {
      normalAfterStarStarted = true
      await click('document.querySelector(".move-slot")')
      continue
    }
    if (committed.length >= (kind === 'star-skip-normal' ? 2 : 1) && (state.phase === 'playerChoice' || state.phase === 'ended' || state.outcome)) {
      completed = true
      break
    }
    if (['qte', 'statusQte', 'defenseQte', 'chainQte', 'starQte'].includes(state.phase)) await evaluate(`(() => {
      const field = document.querySelector('.battle-input-surface .tap-field')
      if (field && field.classList.contains('tap-field--timing')) field.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 512, clientY: 384 }))
      const star = document.querySelector('.gesture-surface--star')
      if (star) star.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 512, clientY: 384 }))
    })()`)
    await sleep(70)
  }
  const { nodes } = await call('Accessibility.getFullAXTree')
  const evidence = await evaluate(`({ history: window.__m23EventHistory, live: window.__m23EventLive,
    diagnostics: window.__MOBIE_M23_BASELINE__.diagnostics(), audio: window.__MOBIE_M23_BASELINE__.audioState(),
    actualReducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, scene: { ...(document.querySelector('.battle-scene-host')?.dataset ?? {}) }, runtime: window.__MOBIE_M23_BASELINE__.runtimeState(), battle: window.__MOBIE_M23_BASELINE__.battleState(),
  })`)
  const stages = evidence.diagnostics.presentationTrace
  const counts = Object.fromEntries(['begin','resolve','record','present','commit'].map((stage) => [stage, stages.filter((entry) => entry.stage === stage && entry.purpose === 'turn').length]))
  captures.push(await screenshot(kind, 'final'))
  const record = { ...prepared, startAt, completed, skipClicked, earlySkip, normalAfterStarStarted, intervention, counts, captures, observations, evidence,
    ax: nodes.filter((node) => !node.ignored && node.name?.value).map((node) => ({ role: node.role?.value, name: node.name?.value })),
  }
  records.push(record)
  await writeFile(`${outputRoot}/events.json`, JSON.stringify({ config, browser: await call('Browser.getVersion'), records, errors, expectedAssetFailures: errors.filter(expectedAssetError).length, unexpectedErrors: errors.filter((event) => !expectedAssetError(event)) }, null, 2))
  await evaluate('window.__m23EventUnsubscribe?.(); window.__m23LiveObserver?.disconnect()')
  if (!completed) throw new Error(`${kind} did not complete`)
  if (Object.entries(counts).some(([stage, count]) => count !== (cancellation && stage === 'commit' ? 0 : kind === 'star-skip-normal' ? 2 : 1))) throw new Error(`${kind} transaction counts were not exactly once: ${JSON.stringify(counts)}`)
  if (kind.includes('skip') && !skipClicked) throw new Error(`${kind} skip control was not exercised`)
  if (cancellation) {
    if (!intervention || evidence.battle?.turn !== prepared.before.turn) throw new Error('Cancelled presentation advanced canonical turn')
    for (const side of ['player', 'foe']) {
      if (JSON.stringify(evidence.battle?.[side].members.map((member) => member.currentHp)) !== JSON.stringify(prepared.before[side].members.map((member) => member.currentHp))) throw new Error('Cancelled presentation changed canonical HP')
    }
    if (evidence.audio.sfx.owner || evidence.audio.bgm.owner) throw new Error('Cancelled presentation retained audio owner')
  }
  if (kind === 'context-loss' && evidence.runtime.session?.rendererFallbackReason !== 'context-lost') throw new Error('Context loss did not switch to compatibility')
  if (kind === 'star-skip-normal') {
    const lastCommit = [...stages].reverse().find((entry) => entry.stage === 'commit' && entry.purpose === 'turn')
    const secondAudio = stages.filter((entry) => entry.presentationId === lastCommit?.presentationId && entry.stage === 'audio')
    if (!normalAfterStarStarted || secondAudio.some((entry) => entry.detail === 'star-impact')) throw new Error('Normal turn inherited star audio')
  }
  if (kind === 'switch' && config.graphics === 'compatibility' && !observations.some((state) => state.phase === 'defenseQte' && state.compatibility.some((mon) => mon.side === 'player' && mon.mode === 'recall' && Number(mon.opacity) === 0))) throw new Error('Compatibility recall was not held empty during defense QTE')
  if (config.asset && evidence.scene?.battleArtworkPlayer !== 'silhouette') throw new Error('Asset failure did not produce player silhouette fallback')
  console.log(`PASS ${kind}`)
}

try {
  await call('Runtime.enable')
  // Runtime.enable replays buffered messages from the previously inspected page.
  await call('Runtime.discardConsoleEntries')
  errors.length = 0
  await call('Page.enable')
  await call('Accessibility.enable')
  await call('Page.bringToFront')
  await call('Emulation.setFocusEmulationEnabled', { enabled: true })
  await call('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false })
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: config.motion === 'full' ? 'no-preference' : 'reduce' }] })
  await mkdir(outputRoot, { recursive: true })
  const cases = (process.env.CASES ?? 'heal,buff,debuff,terrain,switch,support,support-ally,support-crit,support-dud,intrusion,wild-terrain,chain,star,star-skip,star-skip-normal,win,lose,timeout,timeout-skip,context-loss,abort,unmount,supersede').split(',')
  for (const kind of cases) await runCase(kind)
  const unexpected = errors.filter((event) => !expectedAssetError(event))
  if (unexpected.length) throw new Error(`Collected ${unexpected.length} unexpected console/runtime errors`)
} finally {
  await evaluate('window.__m23EventUnsubscribe?.(); window.__m23LiveObserver?.disconnect()').catch(() => {})
  cdp.close()
}
