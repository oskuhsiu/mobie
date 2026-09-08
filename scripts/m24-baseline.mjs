// Re-runnable post-M23 non-battle Chrome baseline.
//
// Start Vite and Chrome separately, for example:
//   npm run dev -- --host 127.0.0.1
//   chrome --remote-debugging-port=9222 --user-data-dir=/tmp/mobie-m24-chrome
//   node scripts/m24-baseline.mjs --viewport=wide-landscape
//   node scripts/m24-baseline.mjs --all --device=m24-chrome-matrix

import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

const SCENARIO_ID = 'm24-post-m23-chrome-v1'
const BASELINE_COMMIT = 'd6514e8'
const BASELINE_SEED = 'm24-post-m23-chrome-seed'
const OUTPUT_ROOT = resolve('test-runs', 'm24', 'post-m23-chrome')

const VIEWPORTS = [
  { id: 'wide-landscape', width: 1180, height: 820, dpr: 1 },
  { id: 'mid-landscape', width: 1024, height: 768, dpr: 1 },
  { id: 'short-landscape', width: 852, height: 393, dpr: 1 },
  { id: 'tablet-portrait', width: 1024, height: 1366, dpr: 1 },
  { id: 'phone-portrait', width: 393, height: 852, dpr: 1 },
]

// This is the reviewable route/data/event/storage/lazy-capability index. The
// captured metrics repeat the entry used for each checkpoint so an individual
// evidence directory remains understandable on its own.
const CHECKPOINT_CATALOG = {
  title: {
    route: 'title', event: 'boot', next: ['START', 'open ToolsMenu'],
    storage: ['mobie.roster.v2', 'mobie.settings.v1'], lazy: [], capability: 'normal app shell',
  },
  'tools-more': {
    route: 'title', event: 'ToolsMenu.moreOpen', next: ['open one utility modal'],
    storage: ['mobie.meta.v1', 'mobie.incubator.v1'], lazy: ['utility modal entries'], capability: 'utility hub',
  },
  'replay-load-start': {
    route: 'title/modal:replays', event: 'ToolsMenu.open(replays)', next: ['wait for list', '關閉'],
    storage: ['mz-replays'], lazy: ['ReplayListModal'], capability: 'IndexedDB read',
  },
  'replay-empty': {
    route: 'title/modal:replays', event: 'listReplayMetas()', next: ['設定→錄製回放', '關閉'],
    storage: ['mz-replays'], lazy: ['ReplayListModal'], capability: 'empty-state; no replay data',
  },
  'incubator-empty': {
    route: 'title/modal:incubator', event: 'ToolsMenu.open(incubator)', next: ['取得成就/重複捕獲/塔獎勵', '關閉'],
    storage: ['mobie.incubator.v1'], lazy: ['IncubatorModal'], capability: 'empty-state',
  },
  'my-mobies': {
    route: 'title/modal:team', event: 'ToolsMenu.open(team)', next: ['open MobCard', '裝備', '關閉'],
    storage: ['mobie.roster.v2', 'mobie.itembag.v1'], lazy: ['TeamModal'], capability: 'local canonical roster',
  },
  'my-mobies-detail': {
    route: 'title/modal:team/detail', event: 'TeamModal.openDetail', next: ['Escape', '關閉'],
    storage: ['mobie.roster.v2'], lazy: ['TeamModal'], capability: 'owner-full info card',
  },
  'card-library': {
    route: 'title/modal:card-library', event: 'ToolsMenu.open(library)', next: ['新增自製卡', '匯入 JSON/CSV', 'QR', '關閉'],
    storage: ['mz-cards', 'mobie.savemeta.v1'], lazy: ['CardLibraryModal', 'qrcode'], capability: 'IndexedDB cards',
  },
  'card-library-add': {
    route: 'title/modal:card-library/add', event: 'CardLibrary.panel=add', next: ['select species', '關閉'],
    storage: ['mz-cards'], lazy: ['CardLibraryModal'], capability: 'real species catalog',
  },
  'card-library-import-error': {
    route: 'title/modal:card-library/import', event: 'parseCardsImport(invalid)', next: ['修正資料再匯入', '關閉'],
    storage: ['mz-cards'], lazy: ['CardLibraryModal'], capability: 'validation error state',
  },
  'card-library-qr': {
    route: 'title/modal:card-library/qr', event: 'CardLibrary.setQrCard', next: ['列印', '關閉'],
    storage: ['mz-cards'], lazy: ['qrcode'], capability: 'runtime QR generation',
  },
  'move-trainer': {
    route: 'title/modal:moves', event: 'ToolsMenu.open(moves)', next: ['open loadout', '關閉'],
    storage: ['mobie.roster.v2', 'mobie.skillpoints.v1'], lazy: ['MoveTrainerModal'], capability: 'canonical learned/equipped moves',
  },
  'move-trainer-open': {
    route: 'title/modal:moves/loadout', event: 'MoveTrainer.openId', next: ['toggle move', '學新招', '關閉'],
    storage: ['mobie.roster.v2', 'mobie.skillpoints.v1'], lazy: ['MoveTrainerModal'], capability: 'SP-gated loadout',
  },
  'partner-skills': {
    route: 'title/modal:partner-skills', event: 'ToolsMenu.open(partner)', next: ['解鎖 SP', '關閉'],
    storage: ['mobie.playerskills.v1', 'mobie.skillpoints.v1'], lazy: ['PartnerSkillModal'], capability: 'account skill wallet',
  },
  dex: {
    route: 'title/modal:dex', event: 'ToolsMenu.open(dex)', next: ['filter', '關閉'],
    storage: ['mobie.meta.v1', 'mobie.roster.v2'], lazy: ['DexModal'], capability: 'real 1–1025 generated species data',
  },
  'dex-registered': {
    route: 'title/modal:dex/registered', event: 'Dex.filter=registered', next: ['filter', '關閉'],
    storage: ['mobie.meta.v1', 'mobie.roster.v2'], lazy: ['DexModal'], capability: 'registered/owned projection',
  },
  achievements: {
    route: 'title/modal:achievements', event: 'ToolsMenu.open(achievements)', next: ['領取', '關閉'],
    storage: ['mobie.meta.v1'], lazy: ['AchievementsModal'], capability: 'derived progress',
  },
  'achievements-claimed': {
    route: 'title/modal:achievements/claimed', event: 'Meta.claimAchievement', next: ['開啟孵化所', '關閉'],
    storage: ['mobie.meta.v1', 'mobie.incubator.v1'], lazy: ['AchievementsModal'], capability: 'exactly-once reward',
  },
  'incubator-ready': {
    route: 'title/modal:incubator/ready', event: 'Incubator.advance', next: ['孵化', '關閉'],
    storage: ['mobie.incubator.v1'], lazy: ['IncubatorModal'], capability: 'ready egg state',
  },
  'incubator-hatch-reveal': {
    route: 'title/modal:incubator/reveal', event: 'Incubator.hatch', next: ['點擊關閉'],
    storage: ['mobie.incubator.v1', 'mobie.roster.v2', 'mobie.meta.v1'], lazy: ['IncubatorModal'], capability: 'deterministic hatch reveal',
  },
  'model-manager': {
    route: 'title/modal:models', event: 'ToolsMenu.open(models)', next: ['匯入 GLB', '關閉'],
    storage: ['mz-models'], lazy: ['ModelManagerModal'], capability: 'legacy model archive isolated from battle',
  },
  save: {
    route: 'title/modal:save', event: 'ToolsMenu.open(save)', next: ['匯出存檔', '選擇 .save 檔', '關閉'],
    storage: ['mobie.savemeta.v1', 'mobie.roster.v2', 'mz-cards', 'mz-models', 'mz-save-backup'], lazy: ['SaveManagerModal', 'fflate'], capability: 'local portable save I/O',
  },
  'save-busy': {
    route: 'title/modal:save/busy', event: 'buildSaveFile', next: ['wait for export', '取消分享/下載'],
    storage: ['mobie.savemeta.v1', 'mobie.roster.v2', 'mz-cards'], lazy: ['SaveManagerModal', 'fflate'], capability: 'busy guard',
  },
  'save-result': {
    route: 'title/modal:save/result', event: 'deliverSaveFile', next: ['檢查下載檔', '關閉'],
    storage: ['mobie.savemeta.v1', 'mz-cards'], lazy: ['SaveManagerModal', 'fflate'], capability: 'download/share fallback',
  },
  'save-import-error': {
    route: 'title/modal:save/import-error', event: 'readSaveFile(invalid)', next: ['選擇有效 .save 檔', '關閉'],
    storage: ['mobie.savemeta.v1'], lazy: ['SaveManagerModal', 'fflate'], capability: 'invalid save validation',
  },
  'save-compare-older': {
    route: 'title/modal:save/compare', event: 'compareSaves', next: ['勾選確認', '取消', '覆蓋並匯入'],
    storage: ['mobie.savemeta.v1', 'mobie.roster.v2', 'mz-cards'], lazy: ['SaveManagerModal', 'fflate'], capability: 'older-save warning',
  },
  'save-backup-ready': {
    route: 'title/modal:save/backup', event: 'backupCurrentSave', next: ['還原', '關閉'],
    storage: ['mz-save-backup'], lazy: ['SaveManagerModal', 'fflate'], capability: 'pre-import backup',
  },
  'save-restore-result': {
    route: 'title/modal:save/restore', event: 'restoreBackup', next: ['關閉'],
    storage: ['mz-save-backup', 'mz-cards', 'mobie.savemeta.v1', 'mobie.roster.v2'], lazy: ['SaveManagerModal', 'fflate'], capability: 'backup restore result',
  },
  settings: {
    route: 'title/modal:settings', event: 'ToolsMenu.open(settings)', next: ['修改偏好', '關閉'],
    storage: ['mobie.settings.v1'], lazy: ['SettingsModal'], capability: 'UX-only preferences',
  },
  'region-select': {
    route: 'regionSelect', event: 'START', next: ['SELECT_REGION', 'OPEN_TOWER', 'BACK'],
    storage: ['mobie.roster.v2'], lazy: [], capability: 'hunt hub + utility hub',
  },
  encounter: {
    route: 'encounter', event: 'SELECT_REGION', next: ['ENGAGE', 'BACK', 'open target card'],
    storage: ['mobie.meta.v1', 'mobie.incubator.v1'], lazy: [], capability: 'real encounter data/accidents',
  },
  'encounter-supply': {
    route: 'encounter/modal:supply', event: 'rollEncounterAccidents', next: ['choose supply'],
    storage: ['mobie.skillpoints.v1', 'mobie.incubator.v1'], lazy: [], capability: 'wild-only optional supply',
  },
  'encounter-card': {
    route: 'encounter/modal:mob-card', event: 'Encounter.openCard', next: ['Escape', '關閉'],
    storage: [], lazy: [], capability: 'foe info masked',
  },
  'team-select': {
    route: 'cardSelect', event: 'ENGAGE', next: ['SELECT_TEAM', 'BACK', '顯示建議'],
    storage: ['mobie.roster.v2'], lazy: [], capability: 'real roster/recommendation',
  },
  'team-select-advice': {
    route: 'cardSelect', event: 'CardSelect.showAdvice', next: ['choose three cards', 'BACK'],
    storage: [], lazy: [], capability: 'matchup projection',
  },
  'battle-handoff': {
    route: 'battle', event: 'SELECT_TEAM', next: ['ATTACK', 'SWITCH', 'END_BATTLE', 'ABORT_BATTLE'],
    storage: ['mobie.settings.v1', 'mz-replays'], lazy: ['NextBattleScene'], capability: 'M23 renderer handoff',
  },
  'battle-artwork-fallback': {
    route: 'battle', event: 'artwork load failure', next: ['continue battle', 'ABORT_BATTLE'],
    storage: [], lazy: [], capability: 'silhouette fallback boundary',
  },
  'battle-error': {
    route: 'battle/error', event: 'BattleStore.battleError', next: ['重新開始本場', '離開戰鬥'],
    storage: [], lazy: [], capability: 'recoverable error and abort boundary',
  },
  'wild-win-result': {
    route: 'result/wild-win', event: 'END_BATTLE{outcome:win}', next: ['capture', 'PLAY_AGAIN', 'TO_REGIONS'],
    storage: ['mobie.roster.v2', 'mobie.meta.v1', 'mobie.incubator.v1'], lazy: ['CaptureStage'], capability: 'capture-eligible result',
  },
  'practice-result': {
    route: 'result/arena-win', event: 'END_BATTLE{outcome:win}', next: ['PLAY_AGAIN', 'TO_REGIONS'],
    storage: ['mobie.roster.v2', 'mobie.meta.v1'], lazy: [], capability: 'arena EXP-only result',
  },
  'practice-play-again-encounter': {
    route: 'result→encounter', event: 'PLAY_AGAIN', next: ['ENGAGE', 'BACK'],
    storage: ['mobie.meta.v1'], lazy: [], capability: 'rerolled encounter branch',
  },
  'tower-setup': {
    route: 'towerSetup', event: 'OPEN_TOWER', next: ['START_TOWER', 'BACK'],
    storage: ['mobie.run.v1', 'mobie.roster.v2'], lazy: [], capability: 'tower team/ascension setup',
  },
  'tower-win-result': {
    route: 'result/tower-win', event: 'END_BATTLE{outcome:win}', next: ['TOWER_CONTINUE', 'TOWER_QUIT'],
    storage: ['mobie.run.v1', 'mobie.skillpoints.v1'], lazy: [], capability: 'tower progression result',
  },
  'tower-continue-battle': {
    route: 'result→battle/tower-floor-2', event: 'TOWER_CONTINUE', next: ['END_BATTLE', 'TOWER_QUIT after result'],
    storage: ['mobie.run.v1'], lazy: ['NextBattleScene'], capability: 'tower continuation handoff',
  },
  'tower-lose-result': {
    route: 'result/tower-lose', event: 'END_BATTLE{outcome:lose}', next: ['TOWER_QUIT'],
    storage: ['mobie.run.v1', 'mobie.skillpoints.v1'], lazy: [], capability: 'tower loss settlement',
  },
  'lose-result': {
    route: 'result/lose', event: 'END_BATTLE{outcome:lose}', next: ['TO_REGIONS', 'PLAY_AGAIN'],
    storage: ['mobie.roster.v2', 'mobie.meta.v1'], lazy: [], capability: 'loss EXP settlement',
  },
  'replays-populated': {
    route: 'title/modal:replays', event: 'listReplayMetas()', next: ['open replay', '戰報', '刪除', '關閉'],
    storage: ['mz-replays'], lazy: ['ReplayListModal'], capability: 'real battle replay record',
  },
  'replay-player': {
    route: 'title/modal:replay-player', event: 'ReplayList.open', next: ['播放', '單步', '關閉'],
    storage: ['mz-replays'], lazy: [], capability: 'event-stream projection (nested in ReplayListModal)',
  },
}

const JOURNEY = [
  'title', 'tools-more', 'replay-load-start', 'replay-empty', 'incubator-empty',
  'my-mobies', 'my-mobies-detail', 'card-library', 'card-library-add',
  'card-library-import-error', 'card-library-qr', 'move-trainer', 'move-trainer-open',
  'partner-skills', 'dex', 'dex-registered', 'achievements', 'achievements-claimed',
  'incubator-ready', 'incubator-hatch-reveal', 'model-manager', 'save', 'save-busy',
  'save-result', 'save-import-error', 'save-compare-older', 'save-backup-ready',
  'save-restore-result', 'settings', 'region-select', 'encounter', 'team-select',
  'team-select-advice', 'battle-handoff', 'battle-artwork-fallback', 'battle-error', 'wild-win-result',
  'practice-result', 'practice-play-again-encounter', 'tower-setup', 'tower-win-result',
  'tower-continue-battle', 'tower-lose-result', 'lose-result',
  'replays-populated', 'replay-player',
]
const OPTIONAL_CHECKPOINTS = ['encounter-supply']

function validateCheckpointCatalog() {
  const labels = [...JOURNEY, ...OPTIONAL_CHECKPOINTS]
  if (new Set(labels).size !== labels.length) throw new Error('M24 checkpoint catalog contains duplicate journey labels')
  for (const label of labels) {
    const entry = CHECKPOINT_CATALOG[label]
    if (!entry) throw new Error(`M24 checkpoint ${label} has no route/event catalog entry`)
    if (!entry.route || !entry.event || !Array.isArray(entry.next) || !Array.isArray(entry.storage) || !Array.isArray(entry.lazy) || !entry.capability) {
      throw new Error(`M24 checkpoint ${label} has incomplete route/event/storage/lazy/capability metadata`)
    }
  }
}
validateCheckpointCatalog()

function validateCheckpointEvidence(record) {
  if (record.schemaVersion !== 1 || !record.scenarioId || !record.checkpoint || !record.baselineCommit) throw new Error('M24 checkpoint evidence has an invalid identity')
  if (!record.viewport?.id || !Number.isInteger(record.viewport.width) || !Number.isInteger(record.viewport.height)) throw new Error(`M24 checkpoint ${record.checkpoint} has an invalid viewport`)
  if (!record.route || !record.event || !Array.isArray(record.legalNext) || !Array.isArray(record.storageBoundary) || !Array.isArray(record.lazyBoundary) || !record.capabilityBoundary) throw new Error(`M24 checkpoint ${record.checkpoint} has incomplete route metadata`)
  if (!record.dom?.viewport || !record.dom.domCounts || !record.dom.horizontalOverflow || !record.dom.focus || !record.dom.storage || !Array.isArray(record.dom.resources)) throw new Error(`M24 checkpoint ${record.checkpoint} has incomplete DOM diagnostics`)
  if (!Array.isArray(record.errors?.console) || !Array.isArray(record.errors?.unhandled) || !Array.isArray(record.errors?.networkFailed)) throw new Error(`M24 checkpoint ${record.checkpoint} has incomplete browser error diagnostics`)
}

function validateViewportIndex(index) {
  if (index.schemaVersion !== 1 || index.scenarioId !== SCENARIO_ID || !index.viewport?.id) throw new Error('M24 viewport index has an invalid identity')
  if (!Array.isArray(index.journey) || !Array.isArray(index.checkpoints) || index.checkpoints.length === 0) throw new Error(`M24 ${index.viewport.id} index has no checkpoint list`)
  const labels = new Set(index.checkpoints.map(({ checkpoint }) => checkpoint))
  for (const label of index.journey) if (!labels.has(label)) throw new Error(`M24 ${index.viewport.id} index is missing ${label}`)
}

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

function selectViewports(args) {
  if (args.all === 'true' || args.viewport === 'all') return VIEWPORTS
  const id = args.viewport ?? 'wide-landscape'
  const viewport = VIEWPORTS.find((candidate) => candidate.id === id)
  if (!viewport) throw new Error(`--viewport must be one of ${VIEWPORTS.map(({ id: name }) => name).join(', ')}`)
  return [viewport]
}

async function connect(port) {
  let response
  try {
    response = await fetch(`http://127.0.0.1:${port}/json/list`)
  } catch (error) {
    throw new Error(`Cannot reach Chrome CDP on port ${port}: ${error.message}`)
  }
  if (!response.ok) throw new Error(`CDP target list returned ${response.status}`)
  const targets = await response.json()
  const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
  if (!page) throw new Error(`No page target found on CDP port ${port}`)

  const socket = new WebSocket(page.webSocketDebuggerUrl)
  const pending = new Map()
  const listeners = new Map()
  let nextId = 0
  let observation = { console: [], unhandled: [], networkFailed: [] }
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

  const remoteValue = (remoteObject) => {
    if (Object.hasOwn(remoteObject, 'value')) return remoteObject.value
    if (remoteObject.unserializableValue) return remoteObject.unserializableValue
    return remoteObject.description ?? remoteObject.type
  }
  const currentObservation = () => observation
  listeners.set('Runtime.consoleAPICalled', [({ type, args: values, stackTrace }) => {
    if (type !== 'error' && type !== 'assert') return
    currentObservation().console.push({ type, text: values.map(remoteValue).join(' '), stack: stackTrace?.callFrames ?? [] })
  }])
  listeners.set('Runtime.exceptionThrown', [({ exceptionDetails }) => {
    currentObservation().unhandled.push({
      text: exceptionDetails?.exception?.description ?? exceptionDetails?.text ?? 'Unhandled page exception',
      url: exceptionDetails?.url ?? '', lineNumber: exceptionDetails?.lineNumber ?? 0,
      columnNumber: exceptionDetails?.columnNumber ?? 0,
    })
  }])
  listeners.set('Log.entryAdded', [({ entry }) => {
    if (entry?.level === 'error') currentObservation().console.push({ type: 'log', text: entry.text, url: entry.url ?? '' })
  }])
  listeners.set('Network.loadingFailed', [({ requestId, errorText, canceled }) => {
    currentObservation().networkFailed.push({ requestId, errorText, canceled: Boolean(canceled) })
  }])

  return {
    close: () => socket.close(),
    on(method, listener) {
      const registered = listeners.get(method) ?? []
      registered.push(listener)
      listeners.set(method, registered)
      return () => listeners.set(method, (listeners.get(method) ?? []).filter((candidate) => candidate !== listener))
    },
    call(method, params = {}) {
      return new Promise((resolveCall, reject) => {
        const id = ++nextId
        pending.set(id, { method, resolve: resolveCall, reject })
        socket.send(JSON.stringify({ id, method, params }))
      })
    },
    resetObservation() { observation = { console: [], unhandled: [], networkFailed: [] } },
    observation() { return observation },
  }
}

function axNodeSnapshot(nodes) {
  return nodes
    .filter((node) => !node.ignored && node.role?.value && node.name?.value?.trim())
    .map((node) => {
      const properties = Object.fromEntries((node.properties ?? []).map((property) => [property.name, property.value?.value]))
      const entry = { role: String(node.role.value), name: String(node.name.value) }
      if (node.value?.value !== undefined && node.value.value !== '' && (typeof node.value.value === 'string' || typeof node.value.value === 'number')) entry.value = node.value.value
      if (node.description?.value) entry.description = String(node.description.value)
      if (typeof properties.disabled === 'boolean') entry.disabled = properties.disabled
      return entry
    })
    .slice(0, 800)
}

const DOM_DIAGNOSTICS = String.raw`(async () => {
  const visible = (el) => {
    const rect = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
  }
  const describe = (el) => ({
    tag: el.tagName.toLowerCase(), id: el.id || null, className: typeof el.className === 'string' ? el.className : null,
    role: el.getAttribute('role'), ariaLabel: el.getAttribute('aria-label'),
    scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
  })
  const all = [...document.querySelectorAll('*')]
  const scrollOwners = all.filter((el) => {
    if (!visible(el) || el === document.documentElement || el === document.body) return false
    const style = getComputedStyle(el)
    return (style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflow === 'auto' || style.overflow === 'scroll')
      && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)
  }).slice(0, 30).map(describe)
  const fixedOrSticky = all.filter((el) => {
    if (!visible(el)) return false
    const position = getComputedStyle(el).position
    return position === 'fixed' || position === 'sticky'
  }).slice(0, 30).map((el) => ({ ...describe(el), position: getComputedStyle(el).position, rect: (() => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom } })() }))
  const candidates = [
    document.querySelector('.modal-card .scroll'), document.querySelector('.region-grid'), document.querySelector('.hand'),
    document.querySelector('.screen'), document.querySelector('.scroll-y'), document.querySelector('.scroll'),
  ].filter((el) => el && visible(el))
  const primary = candidates.find((el) => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) ?? candidates[0] ?? null
  const images = [...document.images].map((img) => ({ alt: img.alt, src: img.currentSrc || img.src, complete: img.complete, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight }))
  const failedImages = images.filter((img) => img.complete && img.naturalWidth === 0)
  const active = document.activeElement
  const text = (document.body.innerText || '').replace(/\s+/g, ' ').trim()
  const html = document.documentElement
  const body = document.body
  const modal = document.querySelector('.modal-card')
  const contentRects = [...document.querySelectorAll('.screen, .modal-card .scroll, .hand, .region-grid')].filter(visible).map((el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right } })
  const actionRects = [...document.querySelectorAll('button, [role="button"]')].filter((el) => visible(el) && ['fixed', 'sticky'].includes(getComputedStyle(el).position)).map((el) => { const r = el.getBoundingClientRect(); return { label: el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 80), top: r.top, bottom: r.bottom, left: r.left, right: r.right } })
  const occluded = actionRects.filter((action) => contentRects.some((content) => action.bottom > content.top && action.top < content.bottom && action.right > content.left && action.left < content.right))
  const databases = typeof indexedDB.databases === 'function' ? await indexedDB.databases().then((dbs) => dbs.map((db) => db.name).filter(Boolean).sort()).catch(() => []) : []
  return {
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    routeHint: document.querySelector('.replay-player') ? 'modal' : document.querySelector('.modal-card') ? 'modal' : document.querySelector('.title-screen') ? 'title' : document.querySelector('.region-grid') ? 'regionSelect' : document.querySelector('.hunt-target') ? 'encounter' : document.querySelector('.asc-chip') ? 'towerSetup' : document.querySelector('.foe-strip') ? 'cardSelect' : document.querySelector('[data-battle-stage], .battle-scene-host') ? 'battle' : document.querySelector('.exp-summary') ? 'result' : 'unknown',
    horizontalOverflow: { document: html.scrollWidth > html.clientWidth + 1, body: body.scrollWidth > body.clientWidth + 1, documentScrollWidth: html.scrollWidth, bodyScrollWidth: body.scrollWidth },
    primaryScrollOwner: primary ? describe(primary) : null,
    scrollOwners,
    fixedOrSticky,
    stickyActionOcclusion: { inspected: actionRects.length, possibleOverlaps: occluded },
    focus: { tag: active?.tagName?.toLowerCase() ?? null, id: active?.id || null, className: typeof active?.className === 'string' ? active.className : null, ariaLabel: active?.getAttribute?.('aria-label') ?? null, text: (active?.textContent || '').trim().slice(0, 100), withinModal: Boolean(active && modal?.contains(active)) },
    domCounts: { buttons: document.querySelectorAll('button').length, links: document.querySelectorAll('a').length, images: images.length, failedImages: failedImages.length, canvases: document.querySelectorAll('canvas').length, dialogs: document.querySelectorAll('[role="dialog"]').length, modals: document.querySelectorAll('.modal-card').length, regions: document.querySelectorAll('.region-card').length, cards: document.querySelectorAll('.poke-card').length, teamRows: document.querySelectorAll('.team-row').length, scrollContainers: scrollOwners.length },
    artwork: { images, failedImages: failedImages.slice(0, 20), loaded: images.filter((img) => img.complete && img.naturalWidth > 0).length, pending: images.filter((img) => !img.complete).length, fallbackNodes: document.querySelectorAll('.battle-renderer__silhouette, .sprite__skeleton').length, rendererArtwork: document.querySelector('.battle-scene-host') ? { player: document.querySelector('.battle-scene-host')?.dataset.battleArtworkPlayer || null, foe: document.querySelector('.battle-scene-host')?.dataset.battleArtworkFoe || null } : null },
    capabilities: { scannerVisible: [...document.querySelectorAll('button, a, [role="button"]')].some((el) => (el.textContent || '').includes('掃卡')), mediaDevices: Boolean(navigator.mediaDevices?.getUserMedia), webgl: (() => { const c = document.createElement('canvas'); return Boolean(c.getContext('webgl2') || c.getContext('webgl')) })(), customModelInputVisible: Boolean(document.querySelector('input[type="file"][accept*="glb"]')) },
    storage: { localStorageKeys: Object.keys(localStorage).sort(), indexedDbNames: databases },
    resources: [...new Set(performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => /(?:\.js(?:\?|$)|@vite|src\/)/.test(name)))].slice(-250),
    text: text.slice(0, 12_000),
  }
})()`

async function runViewport(cdp, config, viewport, browserInfo) {
  const outputRoot = resolve(OUTPUT_ROOT, config.device, viewport.id)
  await mkdir(outputRoot, { recursive: true })
  cdp.resetObservation()
  const checkpoints = []
  const call = cdp.call
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'Page evaluation failed')
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
  const exists = (selector) => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)
  const clickVisible = async (elementExpression, description) => {
    const clicked = await evaluate(`(() => { const element = ${elementExpression}; if (!element || element.disabled) return false; element.scrollIntoView({ block: 'center', inline: 'center' }); const rect = element.getBoundingClientRect(); if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth) return false; element.click(); return true })()`)
    if (!clicked) throw new Error(`Could not click visible ${description}`)
  }
  const clickSelector = async (selector, index = 0) => {
    await clickVisible(`document.querySelectorAll(${JSON.stringify(selector)})[${index}]`, `selector ${selector}[${index}]`)
  }
  const clickOptionalSelector = async (selector, index = 0) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (!(await exists(selector))) return false
      try {
        await clickSelector(selector, index)
        return true
      } catch {
        await sleep(100)
      }
    }
    return false
  }
  const clickText = async (text, selector = 'button', index = 0) => {
    await clickVisible(`[...document.querySelectorAll(${JSON.stringify(selector)})].filter((element) => !element.disabled && (element.textContent || '').includes(${JSON.stringify(text)}))[${index}]`, `${selector} containing ${text}`)
  }
  const clickTeamEngage = async () => {
    await clickText('出戰')
  }
  const setValue = async (selector, value) => evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set; setter?.call(element, ${JSON.stringify(value)}); element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
  const holdShareBoundary = async () => evaluate(`(() => {
    const nav = navigator
    window.__M24_ORIGINAL_SHARE__ = nav.share
    window.__M24_ORIGINAL_CAN_SHARE__ = nav.canShare
    window.__M24_RELEASE_SHARE__ = null
    Object.defineProperty(nav, 'canShare', { configurable: true, value: () => true })
    Object.defineProperty(nav, 'share', { configurable: true, value: () => new Promise((resolve) => { window.__M24_RELEASE_SHARE__ = resolve }) })
    return true
  })()`)
  const releaseShareBoundary = async () => evaluate(`(() => {
    window.__M24_RELEASE_SHARE__?.()
    if (window.__M24_ORIGINAL_SHARE__) Object.defineProperty(navigator, 'share', { configurable: true, value: window.__M24_ORIGINAL_SHARE__ })
    else delete navigator.share
    if (window.__M24_ORIGINAL_CAN_SHARE__) Object.defineProperty(navigator, 'canShare', { configurable: true, value: window.__M24_ORIGINAL_CAN_SHARE__ })
    else delete navigator.canShare
    delete window.__M24_RELEASE_SHARE__
    delete window.__M24_ORIGINAL_SHARE__
    delete window.__M24_ORIGINAL_CAN_SHARE__
    return true
  })()`)
  const axSnapshot = async () => axNodeSnapshot((await call('Accessibility.getFullAXTree', { depth: -1 })).nodes)
  const capture = async (label, source, details = {}) => {
    await sleep(details.settleMs ?? 260)
    const screenshot = await call('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
    const dom = await evaluate(DOM_DIAGNOSTICS)
    const nodes = await axSnapshot()
    if (nodes.length === 0) throw new Error(`Accessibility tree was empty at ${label}`)
    const catalog = CHECKPOINT_CATALOG[label]
    if (!catalog) throw new Error(`Missing M24 checkpoint catalog entry: ${label}`)
    const screenshotBytes = Buffer.from(screenshot.data, 'base64')
    const contentDigest = createHash('sha256').update(JSON.stringify({ text: dom.text, domCounts: dom.domCounts, artwork: dom.artwork, focus: dom.focus })).digest('hex').slice(0, 16)
    const screenshotDigest = createHash('sha256').update(screenshotBytes).digest('hex').slice(0, 16)
    const record = {
      schemaVersion: 1, scenarioId: SCENARIO_ID, baselineCommit: BASELINE_COMMIT,
      checkpoint: label, source, capturedAt: new Date().toISOString(), viewport,
      contentDigest, screenshotDigest,
      route: catalog.route, event: catalog.event, legalNext: catalog.next,
      storageBoundary: catalog.storage, lazyBoundary: catalog.lazy, capabilityBoundary: catalog.capability,
      behavior: details.behavior ?? null, observation: details.observation ?? null,
      dom, errors: cdp.observation(),
    }
    validateCheckpointEvidence(record)
    const checkpointRoot = resolve(outputRoot, label)
    await mkdir(checkpointRoot, { recursive: true })
    await Promise.all([
      writeFile(resolve(checkpointRoot, 'screenshot.png'), screenshotBytes),
      writeFile(resolve(checkpointRoot, 'accessibility.json'), `${JSON.stringify({ schemaVersion: 1, scenarioId: `${SCENARIO_ID}--${label}`, checkpoint: label, nodes, limitations: ['Chrome AX tree is a point-in-time snapshot.'], }, null, 2)}\n`),
      writeFile(resolve(checkpointRoot, 'metrics.json'), `${JSON.stringify({ ...record, scenarioId: `${SCENARIO_ID}--${label}` }, null, 2)}\n`),
    ])
    console.log(`Captured ${viewport.id}/${label}`)
    return { checkpoint: label, source, route: catalog.route, event: catalog.event, legalNext: catalog.next, artifact: `${label}/`, contentDigest, screenshotDigest, behavior: details.behavior ?? null, routeHint: dom.routeHint, domCounts: dom.domCounts, horizontalOverflow: dom.horizontalOverflow, primaryScrollOwner: dom.primaryScrollOwner, artwork: { loaded: dom.artwork.loaded, failed: dom.artwork.failedImages.length, fallbackNodes: dom.artwork.fallbackNodes }, storage: dom.storage, resources: dom.resources.slice(-30) }
  }
  const probeEscape = async () => {
    const before = await evaluate('document.querySelectorAll(".modal-card").length')
    const activeBefore = await evaluate('document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent?.trim().slice(0, 80) || null')
    await evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }))')
    const deadline = Date.now() + 1_000
    let after = before
    while (Date.now() < deadline) {
      after = await evaluate('document.querySelectorAll(".modal-card").length')
      if (after < before) break
      await sleep(20)
    }
    const activeAfter = await evaluate('document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent?.trim().slice(0, 80) || null')
    return { before, after, closed: after < before, activeBefore, activeAfter }
  }
  const closeTopModal = async () => {
    const before = await evaluate('document.querySelectorAll(".modal-card").length')
    const closed = await evaluate(`(() => { const cards = [...document.querySelectorAll('.modal-card')]; const card = cards.at(-1); if (!card) return false; const button = [...card.querySelectorAll('button')].find((candidate) => (candidate.textContent || '').includes('關閉')); if (!button) return false; button.scrollIntoView({ block: 'center', inline: 'center' }); const rect = button.getBoundingClientRect(); if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth) return false; button.click(); return true })()`)
    if (!closed) throw new Error('Could not find visible close button for top modal')
    await waitFor(`document.querySelectorAll('.modal-card').length < ${before}`, 5_000, 'modal close animation')
  }
  const setFileInput = async (selector, fileName, bytes, type) => {
    const assigned = await evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)})
      if (!input) return false
      const transfer = new DataTransfer()
      transfer.items.add(new File([Uint8Array.from(${JSON.stringify(bytes)})], ${JSON.stringify(fileName)}, { type: ${JSON.stringify(type)} }))
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    })()`)
    if (!assigned) throw new Error(`Could not assign file input ${selector}`)
  }
  const openTool = async (label, title) => {
    if (!(await exists('#tools-menu-more'))) await clickText('更多')
    await clickText(label)
    await waitFor(`Boolean([...document.querySelectorAll('.modal-card .h-title')].some((element) => (element.textContent || '').includes(${JSON.stringify(title)})))`, 8_000, `${label} modal`)
  }
  const driver = async (expression) => evaluate(expression)
  const waitForStores = () => waitFor('Boolean(window.__MOBIE_M24_BASELINE__?.ready())', 20_000, 'M24 stores')
  const waitForBattle = async () => {
    await waitFor('Boolean(document.querySelector("[data-battle-stage], .battle-scene-host"))', 35_000, 'battle scene')
    // Escape is a supported intro action. It prevents a slow/paused renderer
    // intro from hiding the command deck while keeping the real battle route.
    await sleep(900)
    await evaluate('window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }))')
    try {
      await waitFor('Boolean(document.querySelector(".move-slot"))', 4_000, 'battle command deck')
    } catch {
      await driver('window.__MOBIE_M24_BASELINE__.prepareBattleChoice()')
      await waitFor('Boolean(document.querySelector(".move-slot"))', 8_000, 'battle command deck after intro release')
    }
  }
  const selectFirstThreeCards = async (label) => {
    for (let index = 0; index < 3; index += 1) await clickSelector('.hand .poke-card', index)
    await waitFor('[...document.querySelectorAll("button")].some((button) => !button.disabled && (button.textContent || "").includes("3/3"))', 5_000, `${label} selection ready`)
  }
  const chooseTeam = async () => {
    await waitFor('document.querySelectorAll(".hand .poke-card").length >= 3', 15_000, 'three player cards')
    await selectFirstThreeCards('player cards')
    await clickTeamEngage()
  }
  const chooseTowerTeam = async () => {
    await waitFor('document.querySelectorAll(".hand .poke-card").length >= 3', 15_000, 'three tower cards')
    await selectFirstThreeCards('tower cards')
    await waitFor('[...document.querySelectorAll("button")].some((button) => !button.disabled && (button.textContent || "").includes("3/3") && (button.textContent || "").includes("開始遠征"))', 5_000, 'tower selection ready')
    await clickText('開始遠征')
  }
  const enterBattleFromEncounter = async ({ captureTeam = false } = {}) => {
    await clickOptionalSelector('.supply-opt')
    await clickText('出戰')
    await waitFor('document.querySelectorAll(".hand .poke-card").length >= 3', 15_000, 'three player cards')
    if (captureTeam) {
      await waitFor('Boolean(document.querySelector(".hand .poke-card"))', 5_000, 'team select')
      checkpoints.push(await capture('team-select', 'real ENGAGE→cardSelect route'))
      await clickText('顯示建議')
      checkpoints.push(await capture('team-select-advice', 'real matchup advice projection'))
    }
    await chooseTeam()
    await waitForBattle()
  }
  const playRecordedTurn = async () => {
    await clickSelector('.move-slot:not(.move-slot--status)')
    await waitFor('Boolean(document.querySelector(".battle-input-surface .tap-field"))', 10_000, 'recorded turn input')
    await evaluate(`(() => {
      const field = document.querySelector('.battle-input-surface .tap-field')
      if (!field) return false
      for (let index = 0; index < 10; index += 1) {
        const init = { bubbles: true, clientX: innerWidth / 2, clientY: innerHeight / 2, pointerId: index + 1, isPrimary: index === 0 }
        field.dispatchEvent(new PointerEvent('pointerdown', init))
        field.dispatchEvent(new PointerEvent('pointerup', init))
      }
      return true
    })()`)
    await waitFor('Boolean((document.querySelector(".move-slot") && !document.querySelector(".battle-input-surface .tap-field")) || document.querySelector(".exp-summary") || document.querySelector(".capture-companion-actions"))', 20_000, 'recorded turn commit')
  }
  const finishBattle = async (outcome) => {
    await driver(`window.__MOBIE_M24_BASELINE__.endBattle(${JSON.stringify(outcome)})`)
    await waitFor('Boolean(document.querySelector(".exp-summary") || document.querySelector(".capture-companion-actions") || (document.body.innerText || "").includes("你被擊敗"))', 20_000, `${outcome} result`)
  }

  const origin = new URL(config.app).origin
  try {
    await call('Page.bringToFront')
    await call('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => undefined)
    try {
      await call('Storage.clearDataForOrigin', { origin, storageTypes: 'all' })
    } catch (error) {
      throw new Error(`Could not reset Chrome storage for ${origin}: ${error.message}`)
    }
    await call('Emulation.setDeviceMetricsOverride', {
      width: viewport.width, height: viewport.height, deviceScaleFactor: viewport.dpr, mobile: true,
      screenWidth: viewport.width, screenHeight: viewport.height,
    })
    const url = new URL(config.app)
    url.searchParams.set('m24Scenario', SCENARIO_ID)
    url.searchParams.set('width', String(viewport.width))
    url.searchParams.set('height', String(viewport.height))
    url.searchParams.set('seed', config.seed)
    url.searchParams.set('run', `${Date.now()}`)
    await call('Page.navigate', { url: url.href })
    await waitFor('document.readyState === "complete"', 20_000, 'app document')
    await waitFor('Boolean(window.__MOBIE_M24_BASELINE__?.active)', 20_000, 'M24 baseline driver')
    await waitForStores()
    await waitFor('Boolean(document.querySelector(".title-screen__adventure"))', 15_000, 'Title')
    checkpoints.push(await capture('title', 'real app boot'))
    await clickText('更多')
    await waitFor('Boolean(document.querySelector("#tools-menu-more"))', 5_000, 'More menu')
    checkpoints.push(await capture('tools-more', 'real ToolsMenu expansion'))

    await clickText('回放')
    checkpoints.push(await capture('replay-load-start', 'immediate lazy modal load observation', {
      settleMs: 0,
      observation: {
        modalMounted: await exists('.modal-card'),
        loadingTextObserved: (await evaluate('(document.body.innerText || "").includes("載入中")')),
      },
    }))
    await waitFor('Boolean(document.querySelector(".modal-card"))', 8_000, 'Replay modal mount')
    await waitFor('Boolean(document.querySelector(".replay-empty"))', 8_000, 'empty replay state')
    checkpoints.push(await capture('replay-empty', 'real empty IndexedDB state', { behavior: await probeEscape() }))
    await closeTopModal()

    await openTool('孵化所', '孵化所')
    await waitFor('(document.body.innerText || "").includes("還沒有蛋")', 8_000, 'empty incubator state')
    checkpoints.push(await capture('incubator-empty', 'real empty localStorage state', { behavior: await probeEscape() }))
    await closeTopModal()

    const seeded = await driver('window.__MOBIE_M24_BASELINE__.seedContent()')
    await waitFor('Boolean(window.__MOBIE_M24_BASELINE__.snapshot().readyEggs > 0)', 8_000, 'seeded baseline content')

    await clickSelector('.tools-menu-primary__mobies')
    await waitFor('Boolean(document.querySelector(".modal-card"))', 8_000, 'My Mobies modal')
    checkpoints.push(await capture('my-mobies', 'real roster and growth store'))
    await clickSelector('button.team-row__main')
    await waitFor('Boolean(document.querySelector(".mobcard"))', 5_000, 'MobCard detail')
    checkpoints.push(await capture('my-mobies-detail', 'real owner info card', { behavior: await probeEscape() }))
    if (await exists('.modal-card')) await closeTopModal()
    if (await exists('.modal-card')) await closeTopModal()

    await openTool('卡庫', '卡庫')
    await waitFor('Boolean(document.querySelector(".model-row") || (document.body.innerText || "").includes("卡庫是空的"))', 10_000, 'card library content')
    checkpoints.push(await capture('card-library', 'real IndexedDB card library'))
    await clickText('新增自製卡')
    await waitFor('Boolean(document.querySelector(".lib-matches"))', 5_000, 'card add panel')
    checkpoints.push(await capture('card-library-add', 'real species search panel'))
    await clickSelector('.lib-match')
    await sleep(300)
    await clickText('QR')
    await waitFor('Boolean(document.querySelector(".qr-card"))', 8_000, 'QR overlay')
    checkpoints.push(await capture('card-library-qr', 'real QR generation'))
    await clickText('關閉', '.qr-card button')
    await clickText('匯入 JSON/CSV')
    await setValue('.lib-textarea', '{invalid baseline payload')
    await clickText('匯入貼上內容')
    await waitFor('Boolean(document.querySelector(".lib-msg"))', 5_000, 'card import validation')
    checkpoints.push(await capture('card-library-import-error', 'real invalid import validation'))
    if (await exists('.modal-card')) await closeTopModal()

    await openTool('招式', '招式訓練所')
    await waitFor('Boolean(document.querySelector(".team-row"))', 8_000, 'move trainer content')
    checkpoints.push(await capture('move-trainer', 'real learned/equipped moves'))
    await clickSelector('.team-row__item-btn')
    checkpoints.push(await capture('move-trainer-open', 'real loadout editor'))
    await closeTopModal()

    await openTool('夥伴技能', '夥伴技能')
    await waitFor('Boolean(document.querySelector(".team-row"))', 8_000, 'partner skill content')
    checkpoints.push(await capture('partner-skills', 'real player skill wallet'))
    await closeTopModal()

    await openTool('圖鑑', '圖鑑')
    await waitFor('Boolean(document.querySelector(".dex-cell"))', 8_000, 'dex content')
    checkpoints.push(await capture('dex', 'real generated species catalog'))
    await clickText('已捕', 'button.chip')
    checkpoints.push(await capture('dex-registered', 'real registered filter'))
    await closeTopModal()

    await openTool('成就', '成就')
    await waitFor('Boolean(document.querySelector(".ach-row"))', 8_000, 'achievement content')
    checkpoints.push(await capture('achievements', 'real derived achievement progress'))
    if (await exists('.ach-row__claim')) {
      await clickSelector('.ach-row__claim')
      await sleep(300)
      checkpoints.push(await capture('achievements-claimed', 'real exactly-once achievement claim'))
    }
    await closeTopModal()

    await openTool('孵化所', '孵化所')
    await waitFor('Boolean(document.querySelector(".egg-row--ready"))', 8_000, 'ready egg content')
    checkpoints.push(await capture('incubator-ready', 'real ready incubator state'))
    await clickText('孵化', '.egg-row--ready button')
    await waitFor('Boolean(document.querySelector(".hatch-reveal"))', 10_000, 'hatch reveal')
    checkpoints.push(await capture('incubator-hatch-reveal', 'real deterministic hatch result'))
    await clickSelector('.hatch-reveal')
    await closeTopModal()

    await openTool('3D 模型', '3D 模型')
    await waitFor('Boolean(document.querySelector(".model-row") || (document.body.innerText || "").includes("沒有舊版模型資料"))', 15_000, 'model manager content')
    checkpoints.push(await capture('model-manager', 'real isolated model archive'))
    await closeTopModal()

    await openTool('存檔', '存檔')
    await waitFor('Boolean(document.querySelector(".modal-card"))', 8_000, 'save manager')
    checkpoints.push(await capture('save', 'real save manager'))
    await holdShareBoundary()
    await clickText('匯出存檔')
    await sleep(35)
    checkpoints.push(await capture('save-busy', 'real export busy window held at share boundary'))
    await releaseShareBoundary()
    await waitFor('Boolean(document.querySelector(".lib-msg"))', 12_000, 'save export result')
    checkpoints.push(await capture('save-result', 'real save export result'))
    await setFileInput('input[type="file"][accept*=".save"]', 'invalid.save', Array.from(new TextEncoder().encode('invalid save payload')), 'application/zip')
    await waitFor('Boolean(document.querySelector(".lib-msg"))', 8_000, 'save import validation')
    checkpoints.push(await capture('save-import-error', 'real invalid save validation'))
    const olderSaveBytes = await driver('window.__MOBIE_M24_BASELINE__.makeOlderSave()')
    await setFileInput('input[type="file"][accept*=".save"]', 'older.save', olderSaveBytes, 'application/zip')
    await waitFor('Boolean(document.querySelector(".save-compare"))', 12_000, 'older save comparison')
    checkpoints.push(await capture('save-compare-older', 'real older-save comparison'))
    await clickText('我了解', 'label')
    await clickText('仍要覆蓋並匯入')
    await waitFor('(document.body.innerText || "").includes("已匯入存檔")', 15_000, 'save import completion')
    await waitFor('(document.body.innerText || "").includes("有匯入前備份")', 15_000, 'pre-import backup')
    checkpoints.push(await capture('save-backup-ready', 'real pre-import backup state'))
    await clickText('還原')
    await waitFor('(document.body.innerText || "").includes("已還原匯入前的備份")', 15_000, 'save restore completion')
    checkpoints.push(await capture('save-restore-result', 'real backup restore result'))
    await closeTopModal()

    await openTool('設定', '設定')
    await clickText('錄製戰鬥回放', '[role="button"]')
    checkpoints.push(await capture('settings', 'real persisted UX preferences with replay recording enabled'))
    await closeTopModal()

    await clickSelector('.title-screen__adventure')
    await waitFor('Boolean(document.querySelector(".region-card"))', 15_000, 'Region Select')
    checkpoints.push(await capture('region-select', 'real START→regionSelect route'))
    await clickSelector('.region-card')
    await waitFor('Boolean(document.querySelector(".hunt-target"))', 15_000, 'Encounter')
    if (await exists('.supply-opt')) checkpoints.push(await capture('encounter-supply', 'real wild supply modal'))
    await clickOptionalSelector('.supply-opt')
    checkpoints.push(await capture('encounter', 'real SELECT_REGION encounter'))
    await clickText('查看資訊卡')
    await waitFor('Boolean(document.querySelector(".mobcard"))', 5_000, 'encounter MobCard')
    checkpoints.push(await capture('encounter-card', 'real foe info card', { behavior: await probeEscape() }))
    if (await exists('.modal-card')) await closeTopModal()
    await enterBattleFromEncounter({ captureTeam: true })
    checkpoints.push(await capture('battle-handoff', 'real SELECT_TEAM→battle handoff'))
    await driver('window.__MOBIE_M24_BASELINE__.prepareArtworkFailure()')
    await sleep(1_000)
    checkpoints.push(await capture('battle-artwork-fallback', 'real injected missing artwork fixture'))
    await driver('window.__MOBIE_M24_BASELINE__.prepareBattleError()')
    await waitFor('Boolean(document.querySelector(".battle-error-panel"))', 8_000, 'battle error state')
    checkpoints.push(await capture('battle-error', 'real recoverable battle error state'))
    await clickText('離開戰鬥')
    await waitFor('Boolean(document.querySelector(".region-card"))', 15_000, 'region after ABORT_BATTLE')

    await clickSelector('.region-card')
    await waitFor('Boolean(document.querySelector(".hunt-target"))', 15_000, 'wild result encounter')
    await clickOptionalSelector('.supply-opt')
    await enterBattleFromEncounter()
    await driver('window.__MOBIE_M24_BASELINE__.prepareRecordedWin()')
    await playRecordedTurn()
    await waitFor('Boolean(document.querySelector(".exp-summary") || document.querySelector(".capture-companion-actions"))', 20_000, 'recorded wild win result')
    await waitFor('[...document.querySelectorAll("button")].some((button) => (button.textContent || "").includes("回到區域"))', 12_000, 'wild result actions')
    checkpoints.push(await capture('wild-win-result', 'real wild result/capture branch'))

    await clickText('回到區域')
    await waitFor('Boolean(document.querySelector(".region-card"))', 15_000, 'Region after wild result')
    await clickSelector('.practice-cta')
    await waitFor('Boolean(document.querySelector(".hunt-target"))', 15_000, 'Practice encounter')
    await enterBattleFromEncounter()
    await finishBattle('win')
    await waitFor('(document.body.innerText || "").includes("競技勝利")', 12_000, 'practice result')
    checkpoints.push(await capture('practice-result', 'real arena EXP-only result'))

    await clickText('再戰一場')
    await waitFor('Boolean(document.querySelector(".hunt-target"))', 15_000, 'PLAY_AGAIN encounter')
    checkpoints.push(await capture('practice-play-again-encounter', 'real PLAY_AGAIN rerolled encounter'))
    await clickText('返回')
    await waitFor('Boolean(document.querySelector(".region-card"))', 15_000, 'Region after PLAY_AGAIN back')

    await waitFor('Boolean(document.querySelector(".region-card"))', 15_000, 'Region after practice result')
    await clickSelector('.tower-cta')
    await waitFor('(document.body.innerText || "").includes("挑戰連勝塔")', 15_000, 'Tower setup')
    checkpoints.push(await capture('tower-setup', 'real OPEN_TOWER route'))
    await chooseTowerTeam()
    await waitForBattle()
    await finishBattle('win')
    await waitFor('(document.body.innerText || "").includes("突破")', 12_000, 'tower win result')
    checkpoints.push(await capture('tower-win-result', 'real tower continuation result'))
    await clickText('攻向第')
    await waitForBattle()
    checkpoints.push(await capture('tower-continue-battle', 'real TOWER_CONTINUE floor handoff'))
    await finishBattle('lose')
    await waitFor('(document.body.innerText || "").includes("遠征結束")', 12_000, 'tower loss result')
    checkpoints.push(await capture('tower-lose-result', 'real tower loss settlement after continuation'))
    await clickText('結束遠征')
    await waitFor('Boolean(document.querySelector(".region-card"))', 15_000, 'Region after tower loss')

    await clickSelector('.region-card')
    await waitFor('Boolean(document.querySelector(".hunt-target"))', 15_000, 'wild loss encounter')
    await enterBattleFromEncounter()
    await finishBattle('lose')
    await waitFor('(document.body.innerText || "").includes("你被擊敗")', 12_000, 'loss result')
    checkpoints.push(await capture('lose-result', 'real loss result/EXP branch'))
    await clickText('回到區域')
    await waitFor('Boolean(document.querySelector(".region-card"))', 15_000, 'Region after loss')
    await clickText('首頁')
    await waitFor('Boolean(document.querySelector(".title-screen__adventure"))', 15_000, 'Title after back')

    await openTool('回放', '回放')
    await waitFor('Boolean(document.querySelector(".replay-item"))', 12_000, 'populated replay list')
    checkpoints.push(await capture('replays-populated', 'real replay IndexedDB record'))
    await clickSelector('.replay-item__main')
    await waitFor('Boolean(document.querySelector(".replay-player"))', 8_000, 'replay player')
    checkpoints.push(await capture('replay-player', 'real replay event projection'))
    await clickText('關閉', '.replay-player button')
    await closeTopModal()

    const capturedLabels = new Set(checkpoints.map(({ checkpoint }) => checkpoint))
    const missingCheckpoints = JOURNEY.filter((label) => !capturedLabels.has(label))
    if (missingCheckpoints.length > 0) throw new Error(`Missing required M24 checkpoints: ${missingCheckpoints.join(', ')}`)
    const index = {
      schemaVersion: 1, scenarioId: SCENARIO_ID, baselineCommit: BASELINE_COMMIT,
      seed: config.seed, device: config.device, viewport, browser: browserInfo,
      startedAt: checkpoints[0]?.capturedAt ?? new Date().toISOString(), finishedAt: new Date().toISOString(),
      seededContent: seeded, journey: JOURNEY, optionalCheckpoints: OPTIONAL_CHECKPOINTS, checkpoints,
      coverage: { scanner: { reachable: false, observed: false, reason: 'M23 product truth keeps CardScannerModal dormant and removes the entry from ToolsMenu.' },
        xstateEvents: ['START', 'SELECT_REGION', 'ENGAGE', 'SELECT_TEAM', 'END_BATTLE', 'ABORT_BATTLE', 'SET_CAPTURED', 'PLAY_AGAIN', 'TO_REGIONS', 'BACK', 'OPEN_TOWER', 'START_TOWER', 'TOWER_CONTINUE', 'TOWER_QUIT'],
        storage: [...new Set(checkpoints.flatMap((checkpoint) => checkpoint.storage ?? []))].sort(),
        lazyBoundaries: [...new Set(checkpoints.flatMap((checkpoint) => CHECKPOINT_CATALOG[checkpoint.checkpoint]?.lazy ?? []))].sort(),
      },
      errors: cdp.observation(),
      limitations: [
        'Chrome CDP evidence is functional/content parity evidence; it is not iPad Safari qualification.',
        'SwiftShader or other software rendering is not a hardware performance verdict.',
        'The direct END_BATTLE calls are DEV-only result-branch setup; the battle handoff itself is reached through the real START→SELECT_TEAM flow.',
        'Focus/Escape values are point-in-time observations. Utility modals without a dialog focus trap are recorded as observed behavior.',
      ],
    }
    validateViewportIndex(index)
    await writeFile(resolve(outputRoot, 'index.json'), `${JSON.stringify(index, null, 2)}\n`)
    return index
  } catch (error) {
    const failure = { schemaVersion: 1, scenarioId: SCENARIO_ID, baselineCommit: BASELINE_COMMIT, seed: config.seed, device: config.device, viewport, browser: browserInfo, error: error instanceof Error ? error.message : String(error), errors: cdp.observation(), capturedAt: new Date().toISOString() }
    await writeFile(resolve(outputRoot, 'failure.json'), `${JSON.stringify(failure, null, 2)}\n`)
    throw error
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const config = {
    port: positiveInteger(args.port ?? 9222, 'port'),
    app: args.app ?? 'http://127.0.0.1:5173/',
    device: safeSegment(args.device ?? 'chrome-local', 'device'),
    seed: args.seed ?? BASELINE_SEED,
  }
  if (!config.seed.trim()) throw new Error('--seed must not be empty')
  const appUrl = new URL(config.app)
  if (!['http:', 'https:'].includes(appUrl.protocol)) throw new Error('--app must be an http(s) URL')
  const viewports = selectViewports(args)
  await mkdir(resolve(OUTPUT_ROOT, config.device), { recursive: true })
  const cdp = await connect(config.port)
  try {
    await Promise.all([cdp.call('Runtime.enable'), cdp.call('Page.enable'), cdp.call('Accessibility.enable'), cdp.call('Log.enable'), cdp.call('Network.enable')])
    await cdp.call('Page.bringToFront')
    const browser = await cdp.call('Browser.getVersion')
    const browserInfo = { product: browser.product ?? 'unknown', revision: browser.revision ?? 'unknown', protocolVersion: browser.protocolVersion ?? 'unknown' }
    const runs = []
    const failures = []
    for (const viewport of viewports) {
      try {
        runs.push(await runViewport(cdp, config, viewport, browserInfo))
      } catch (error) {
        failures.push({ viewport: viewport.id, error: error instanceof Error ? error.message : String(error) })
        console.error(`M24 ${viewport.id} failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const index = { schemaVersion: 1, scenarioId: SCENARIO_ID, baselineCommit: BASELINE_COMMIT, seed: config.seed, device: config.device, viewports: viewports.map(({ id, width, height, dpr }) => ({ id, width, height, dpr })), runs: runs.map((run) => ({ viewport: run.viewport, index: `${run.viewport.id}/index.json`, checkpointCount: run.checkpoints.length, errors: run.errors })), failures, optionalCheckpoints: OPTIONAL_CHECKPOINTS, catalog: CHECKPOINT_CATALOG, limitations: ['Evidence is written under ignored test-runs/.', 'Physical iPad Safari and long-duration performance qualification remain separate gates.'] }
    await writeFile(resolve(OUTPUT_ROOT, config.device, 'index.json'), `${JSON.stringify(index, null, 2)}\n`)
    if (failures.length) throw new Error(`${failures.length} viewport journey(s) failed`)
    console.log(`M24 evidence written to ${resolve(OUTPUT_ROOT, config.device)}`)
  } finally {
    cdp.close()
  }
}

main().catch((error) => {
  console.error(`M24 baseline capture failed: ${error.message}`)
  process.exitCode = 1
})
