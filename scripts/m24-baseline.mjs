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
const BASELINE_COMMIT = '2121098'
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
    storage: ['mobie.roster.v2', 'mobie.settings.v2'], lazy: [], capability: 'normal app shell',
  },
  'settings-v1-migrated': {
    route: 'title', event: 'boot→loadSettings(v1→v2)', next: ['open ToolsMenu', 'reload'],
    storage: ['mobie.settings.v1', 'mobie.settings.v2'], lazy: [], capability: 'valid v1 projected to exact v2; modules ignored',
  },
  'tools-more': {
    route: 'title', event: 'ToolsMenu.moreOpen', next: ['open one utility modal'],
    storage: ['mobie.meta.v1', 'mobie.incubator.v1', 'mz-models'], lazy: ['utility modal entries'], capability: 'utility hub; custom GLB entry removed; sentinel archive untouched',
  },
  'scanner-off': {
    route: 'title', event: 'scannerEnabled=false', next: ['設定→顯示掃卡工具'],
    storage: ['mobie.settings.v2'], lazy: [], capability: 'no scanner UI/chunk/camera request',
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
    route: 'title/modal:incubator', event: 'ToolsMenu.open(incubator)', next: ['取得成就/重複捕獲', '關閉'],
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
  'move-trainer-detail': {
    route: 'title/modal:team/detail/move-trainer', event: 'MobCard.openMoveTrainer', next: ['學新招', '裝備', '卸下', '排序', '關閉'],
    storage: ['mobie.roster.v2', 'mobie.skillpoints.v1'], lazy: ['MoveTrainerModal'], capability: 'owner detail handoff with focused canonical target',
  },
  'move-trainer-actions': {
    route: 'title/modal:team/detail/move-trainer/loadout', event: 'MoveTrainer atomic learn/equip/unequip/reorder', next: ['reload', '關閉'],
    storage: ['mobie.roster.v2', 'mobie.skillpoints.v1'], lazy: ['MoveTrainerModal'], capability: 'SP ledger and fixed four-slot battle handoff',
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
  'move-trainer-reloaded': {
    route: 'title/modal:moves/loadout', event: 'Page.reload→MoveTrainer.openId', next: ['確認順序', '關閉'],
    storage: ['mobie.roster.v2', 'mobie.skillpoints.v1'], lazy: ['MoveTrainerModal'], capability: 'canonical loadout survives reload',
  },
  'move-trainer-insufficient-sp': {
    route: 'title/modal:moves/loadout', event: 'SP=0→learn disabled', next: ['補充 SP', '關閉'],
    storage: ['mobie.roster.v2', 'mobie.skillpoints.v1'], lazy: ['MoveTrainerModal'], capability: 'insufficient-resource reason and no spend',
  },
  'move-trainer-storage-error': {
    route: 'title/modal:moves/loadout', event: 'MoveTrainer persistence failure', next: ['再試一次', '關閉'],
    storage: ['mobie.roster.v2', 'mobie.skillpoints.v1'], lazy: ['MoveTrainerModal'], capability: 'recoverable storage error with unchanged ledger',
  },
  'partner-skills': {
    route: 'title/modal:partner-skills', event: 'ToolsMenu.open(partner)', next: ['解鎖 SP', '重新載入帳號', '關閉'],
    storage: ['mobie.playerskills.v1', 'mobie.skillpoints.v1'], lazy: ['PartnerSkillModal'], capability: 'account skill wallet',
  },
  'partner-skills-insufficient-sp': {
    route: 'title/modal:partner-skills', event: 'SP=0→Partner unlock disabled', next: ['補充 SP', '關閉'],
    storage: ['mobie.playerskills.v1', 'mobie.skillpoints.v1'], lazy: ['PartnerSkillModal'], capability: 'insufficient-resource reason and no spend',
  },
  'partner-skills-stale-account': {
    route: 'title/modal:partner-skills', event: 'canonical account changed outside current modal', next: ['重新載入帳號', '再試一次', '關閉'],
    storage: ['mobie.playerskills.v1', 'mobie.skillpoints.v1'], lazy: ['PartnerSkillModal'], capability: 'stale account recovery without spend',
  },
  'partner-skills-storage-error': {
    route: 'title/modal:partner-skills', event: 'Partner persistence failure', next: ['重新載入帳號', '再試一次', '關閉'],
    storage: ['mobie.playerskills.v1', 'mobie.skillpoints.v1'], lazy: ['PartnerSkillModal'], capability: 'recoverable storage error with unchanged account ledger',
  },
  'partner-skills-unlock': {
    route: 'title/modal:partner-skills', event: 'PartnerSkill.unlockWithSp(rally)', next: ['battle', 'reload', '關閉'],
    storage: ['mobie.playerskills.v1', 'mobie.skillpoints.v1', 'mobie.savemeta.v1'], lazy: ['PartnerSkillModal'], capability: 'single account unlock and SP deduction',
  },
  'partner-skills-reloaded': {
    route: 'title/modal:partner-skills', event: 'Page.reload→PartnerSkillModal', next: ['battle', '關閉'],
    storage: ['mobie.playerskills.v1', 'mobie.skillpoints.v1'], lazy: ['PartnerSkillModal'], capability: 'learned state and SP survive reload',
  },
  dex: {
    route: 'title/modal:dex', event: 'ToolsMenu.open(dex)', next: ['搜尋', 'filter', 'page', 'detail', '關閉'],
    storage: ['mobie.meta.v1', 'mobie.roster.v2'], lazy: ['DexModal'], capability: 'real 1–1025 generated species data; bounded page ≤60',
  },
  'dex-registered': {
    route: 'title/modal:dex/registered', event: 'Dex.filter=registered', next: ['搜尋', 'Grade S/SS', 'detail', '關閉'],
    storage: ['mobie.meta.v1', 'mobie.roster.v2'], lazy: ['DexModal'], capability: 'registered/owned projection with bounded pagination',
  },
  'dex-page-last': {
    route: 'title/modal:dex/page-last', event: 'Dex.page=18', next: ['detail', '上一頁', '關閉'],
    storage: ['mobie.meta.v1', 'mobie.roster.v2'], lazy: ['DexModal'], capability: 'last-page boundary with five current cells',
  },
  'dex-detail': {
    route: 'title/modal:dex/detail', event: 'Dex.openDetail', next: ['返回清單', '關閉'],
    storage: ['mobie.meta.v1', 'mobie.roster.v2'], lazy: ['DexModal'], capability: 'real species detail with artwork/status/Grade/type',
  },
  'dex-detail-restore': {
    route: 'title/modal:dex/page-last', event: 'Dex.closeDetail', next: ['搜尋', 'filter', '關閉'],
    storage: ['mobie.meta.v1', 'mobie.roster.v2'], lazy: ['DexModal'], capability: 'page and exact item focus restore',
  },
  'dex-search': {
    route: 'title/modal:dex/search', event: 'Dex.search=皮卡丘', next: ['Grade S/SS', '清除', '關閉'],
    storage: ['mobie.meta.v1', 'mobie.roster.v2'], lazy: ['DexModal'], capability: 'name/number search over the full catalog',
  },
  'dex-grade': {
    route: 'title/modal:dex/grade', event: 'Dex.filter=shining', next: ['清除', '關閉'],
    storage: ['mobie.meta.v1', 'mobie.roster.v2'], lazy: ['DexModal'], capability: '閃耀 Grade S/SS filter semantics',
  },
  'dex-empty': {
    route: 'title/modal:dex/empty', event: 'Dex.search=invalid', next: ['清除搜尋與篩選', '關閉'],
    storage: ['mobie.meta.v1', 'mobie.roster.v2'], lazy: ['DexModal'], capability: 'actionable empty result',
  },
  'dex-artwork-fallback': {
    route: 'title/modal:dex/artwork-fallback', event: 'Dex.artworkError', next: ['搜尋', '關閉'],
    storage: ['mobie.meta.v1', 'mobie.roster.v2'], lazy: ['DexModal'], capability: 'fixed artwork slot with accessible fallback',
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
  save: {
    route: 'title/modal:save', event: 'ToolsMenu.open(save)', next: ['匯出存檔', '選擇 .save 檔', '關閉'],
    storage: ['mobie.savemeta.v1', 'mobie.roster.v2', 'mz-cards', 'mz-save-backup', 'mz-models'], lazy: ['SaveManagerModal', 'fflate'], capability: 'local portable save I/O; fixed no-model export; sentinel archive untouched',
  },
  'save-busy': {
    route: 'title/modal:save/busy', event: 'buildSaveFile', next: ['wait for export', '取消分享/下載'],
    storage: ['mobie.savemeta.v1', 'mobie.roster.v2', 'mz-cards', 'mz-models'], lazy: ['SaveManagerModal', 'fflate'], capability: 'busy guard; no model read',
  },
  'save-result': {
    route: 'title/modal:save/result', event: 'deliverSaveFile', next: ['檢查下載檔', '關閉'],
    storage: ['mobie.savemeta.v1', 'mz-cards', 'mz-models'], lazy: ['SaveManagerModal', 'fflate'], capability: 'download/share fallback; no-model archive',
  },
  'save-import-error': {
    route: 'title/modal:save/import-error', event: 'readSaveFile(malformed legacy model)', next: ['選擇有效 .save 檔', '關閉'],
    storage: ['mobie.savemeta.v1', 'mz-models'], lazy: ['SaveManagerModal', 'fflate'], capability: 'malformed legacy checksum error; archive untouched',
  },
  'save-compare-older': {
    route: 'title/modal:save/compare', event: 'compareSaves', next: ['勾選確認', '取消', '覆蓋並匯入'],
    storage: ['mobie.savemeta.v1', 'mobie.roster.v2', 'mz-cards', 'mz-models'], lazy: ['SaveManagerModal', 'fflate'], capability: 'older-save warning; legacy model entries are ignored',
  },
  'save-backup-ready': {
    route: 'title/modal:save/backup', event: 'backupCurrentSave', next: ['還原', '關閉'],
    storage: ['mz-save-backup', 'mz-models'], lazy: ['SaveManagerModal', 'fflate'], capability: 'pre-import backup; archive untouched',
  },
  'save-restore-result': {
    route: 'title/modal:save/restore', event: 'restoreBackup', next: ['關閉'],
    storage: ['mz-save-backup', 'mz-cards', 'mobie.savemeta.v1', 'mobie.roster.v2', 'mz-models'], lazy: ['SaveManagerModal', 'fflate'], capability: 'backup restore result; archive untouched',
  },
  settings: {
    route: 'title/modal:settings', event: 'ToolsMenu.open(settings)', next: ['修改偏好', '關閉'],
    storage: ['mobie.settings.v1', 'mobie.settings.v2'], lazy: ['SettingsModal'], capability: 'Settings v2 migration/preferences',
  },
  'settings-reloaded': {
    route: 'title/modal:settings', event: 'Page.reload→loadSettings(v2)', next: ['確認偏好仍在', '關閉'],
    storage: ['mobie.settings.v2'], lazy: ['SettingsModal'], capability: 'reload persistence',
  },
  'settings-malformed-recovery': {
    route: 'title/modal:settings', event: 'Page.reload→malformed settings recovery', next: ['修改偏好', '關閉'],
    storage: ['mobie.settings.v1', 'mobie.settings.v2'], lazy: ['SettingsModal'], capability: 'malformed v1/v2 safely falls back to defaults',
  },
  'scanner-on-fallback': {
    route: 'title/modal:scanner', event: 'ToolsMenu.open(scanner)', next: ['手動輸入卡碼', '關閉'],
    storage: ['mobie.settings.v2', 'mz-cards'], lazy: ['CardScannerModal', 'jsqr'], capability: 'explicit capability on; unsupported/denied fallback',
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
    storage: ['mobie.settings.v2', 'mz-replays'], lazy: ['NextBattleScene'], capability: 'M23 renderer handoff',
  },
  'battle-partner-result': {
    route: 'battle/playerChoice', event: 'PartnerSkill.commit→PartnerSkillResultIntent', next: ['ATTACK', 'SWITCH', 'use once', 'END_BATTLE'],
    storage: ['mobie.playerskills.v1'], lazy: [], capability: 'learned Partner action returns to playerChoice without a turn',
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
  'title', 'settings-v1-migrated', 'tools-more', 'scanner-off', 'replay-load-start', 'replay-empty', 'incubator-empty',
  'my-mobies', 'my-mobies-detail', 'move-trainer-detail', 'move-trainer-actions', 'card-library', 'card-library-add',
  'card-library-import-error', 'card-library-qr', 'move-trainer', 'move-trainer-open', 'move-trainer-reloaded', 'move-trainer-insufficient-sp', 'move-trainer-storage-error',
  'partner-skills', 'partner-skills-stale-account', 'partner-skills-insufficient-sp', 'partner-skills-storage-error', 'partner-skills-unlock', 'partner-skills-reloaded',
  'dex', 'dex-registered', 'dex-page-last', 'dex-detail', 'dex-detail-restore', 'dex-search', 'dex-grade', 'dex-empty', 'dex-artwork-fallback', 'achievements', 'achievements-claimed',
  'incubator-ready', 'incubator-hatch-reveal', 'save', 'save-busy',
  'save-result', 'save-import-error', 'save-compare-older', 'save-backup-ready',
  'save-restore-result', 'settings-malformed-recovery', 'settings', 'settings-reloaded', 'scanner-on-fallback', 'region-select', 'encounter', 'team-select',
  'team-select-advice', 'battle-handoff', 'battle-partner-result', 'battle-artwork-fallback', 'battle-error', 'wild-win-result',
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
  if (!record.dom?.viewport || !record.dom.domCounts || !record.dom.horizontalOverflow || !record.dom.focus || !record.dom.storage || !record.dom.modelStorage?.available || !Array.isArray(record.dom.resources)) throw new Error(`M24 checkpoint ${record.checkpoint} has incomplete DOM diagnostics`)
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
  const modelUi = typeof window.__M24_MODEL_UI_STATUS__ === 'function'
    ? window.__M24_MODEL_UI_STATUS__()
    : { customModelInputVisible: false, customModelControlsVisible: false }
  const modelStorage = typeof window.__M24_MODEL_DB_SNAPSHOT__ === 'function'
    ? await window.__M24_MODEL_DB_SNAPSHOT__()
    : null
  const html = document.documentElement
  const body = document.body
  const modal = document.querySelector('.modal-card')
  const contentRects = [...document.querySelectorAll('.screen, .modal-card .scroll, .hand, .region-grid')].filter(visible).map((el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right } })
  const actionRects = [...document.querySelectorAll('button, [role="button"]')].filter((el) => visible(el) && ['fixed', 'sticky'].includes(getComputedStyle(el).position)).map((el) => { const r = el.getBoundingClientRect(); return { label: el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 80), top: r.top, bottom: r.bottom, left: r.left, right: r.right } })
  const occluded = actionRects.filter((action) => contentRects.some((content) => action.bottom > content.top && action.top < content.bottom && action.right > content.left && action.left < content.right))
  const databases = typeof indexedDB.databases === 'function' ? await indexedDB.databases().then((dbs) => dbs.map((db) => db.name).filter(Boolean).sort()).catch(() => []) : []
  const resources = [...new Set(performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => /(?:\.js(?:\?|$)|@vite|src\/)/.test(name)))].slice(-250)
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
    capabilities: { scannerVisible: [...document.querySelectorAll('button, a, [role="button"]')].some((el) => (el.textContent || '').includes('掃卡')), scannerChunkLoaded: resources.some((name) => /CardScanner|jsqr/i.test(name)), cameraRequests: Number(window.__M24_CAMERA_REQUESTS__ ?? 0), mediaDevices: Boolean(navigator.mediaDevices?.getUserMedia), webgl: (() => { const c = document.createElement('canvas'); return Boolean(c.getContext('webgl2') || c.getContext('webgl')) })(), customModelInputVisible: modelUi.customModelInputVisible, customModelControlsVisible: modelUi.customModelControlsVisible },
    storage: { localStorageKeys: Object.keys(localStorage).sort(), indexedDbNames: databases },
    modelStorage,
    resources,
    text: text.slice(0, 12_000),
  }
})()`

async function runViewport(cdp, config, viewport, browserInfo) {
  const outputRoot = resolve(OUTPUT_ROOT, config.device, viewport.id)
  await mkdir(outputRoot, { recursive: true })
  cdp.resetObservation()
  const checkpoints = []
  const call = cdp.call
  let modelDbSignature = null
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
  const verifyModelDb = (status, label) => {
    if (!status?.available) throw new Error(`Sentinel mz-models archive is unavailable at ${label}: ${status?.error ?? 'unknown error'}`)
    const io = Object.entries(status.io ?? {}).filter(([, value]) => Number(value) > 0)
    if (io.length > 0) throw new Error(`App touched retired mz-models at ${label}: ${JSON.stringify(io)}`)
    const record = status.records?.find(({ key }) => key === 777)
    const expectedBytes = [77, 79, 66, 73, 69, 45, 83, 69, 78, 84, 73, 78, 69, 76]
    if (JSON.stringify(status.keys) !== JSON.stringify(['777']) || !record || record.name !== 'sentinel.glb' || record.type !== 'model/gltf-binary' || record.lastModified !== 1700000000000 || JSON.stringify(record.bytes) !== JSON.stringify(expectedBytes)) {
      throw new Error(`Sentinel mz-models archive has an unexpected shape at ${label}`)
    }
    const signature = JSON.stringify({ keys: status.keys, records: status.records })
    if (modelDbSignature === null) modelDbSignature = signature
    else if (signature !== modelDbSignature) throw new Error(`Sentinel mz-models archive changed at ${label}`)
    return status
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
    window.__M24_SHARED_SAVE_FILE__ = null
    window.__M24_SHARED_SAVE_BYTES__ = null
    Object.defineProperty(nav, 'canShare', { configurable: true, value: () => true })
    Object.defineProperty(nav, 'share', { configurable: true, value: (data) => {
      const file = data?.files?.[0]
      window.__M24_SHARED_SAVE_FILE__ = file ? { name: file.name, size: file.size, type: file.type } : null
      if (file) file.arrayBuffer().then((buffer) => { window.__M24_SHARED_SAVE_BYTES__ = Array.from(new Uint8Array(buffer)) })
      return new Promise((resolve) => { window.__M24_RELEASE_SHARE__ = resolve })
    } })
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
    verifyModelDb(dom.modelStorage, label)
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
    return { checkpoint: label, source, route: catalog.route, event: catalog.event, legalNext: catalog.next, artifact: `${label}/`, contentDigest, screenshotDigest, behavior: details.behavior ?? null, routeHint: dom.routeHint, domCounts: dom.domCounts, horizontalOverflow: dom.horizontalOverflow, primaryScrollOwner: dom.primaryScrollOwner, artwork: { loaded: dom.artwork.loaded, failed: dom.artwork.failedImages.length, fallbackNodes: dom.artwork.fallbackNodes }, modelStorage: dom.modelStorage, storage: dom.storage, resources: dom.resources.slice(-30) }
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
  const forceUnsupportedCamera = async () => evaluate(`(() => {
    const devices = navigator.mediaDevices
    if (!devices) return true
    try {
      Object.defineProperty(devices, 'getUserMedia', { configurable: true, value: undefined })
      return true
    } catch {
      return false
    }
  })()`)
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
    // Team Select and Tower Setup keep the selectable action inside each
    // card.  Target the aria-pressed control so the info-card button is never
    // mistaken for a team selection during a real CDP journey.
    for (let index = 0; index < 3; index += 1) await clickSelector('.hand .poke-card button[aria-pressed]', index)
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
  let scannerOffEvidence = null
  let scannerOnEvidence = null
  let startupScriptIdentifier = null
  const clearStartupScript = async () => {
    if (!startupScriptIdentifier) return
    await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: startupScriptIdentifier }).catch(() => undefined)
    startupScriptIdentifier = null
  }
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
    const startupScript = `(() => {
      try {
        if (localStorage.getItem('mobie.settings.v1') === null) {
          localStorage.setItem('mobie.settings.v1', ${JSON.stringify(JSON.stringify({
            schemaVersion: 1,
            modules: { synergy: true, heldItems: true, encounterSkills: true },
            prefs: { recordReplays: false },
          }))})
        }
      } catch {}
      // Create one sentinel legacy model record before the app boots. The
      // observer uses the original IndexedDB methods, while the wrapped
      // methods count only app attempts to touch this retired store.
      window.__M24_MODEL_DB_READY__ = false
      window.__M24_MODEL_DB_IO__ = { opens: 0, transactions: 0, readonly: 0, readwrite: 0, puts: 0, gets: 0, deletes: 0, clears: 0, getAllKeys: 0 }
      window.__M24_MODEL_DB_OBSERVING__ = false
      const modelDbName = 'mz-models'
      const modelStoreName = 'glb'
      const modelSentinelKey = 777
      const factoryPrototype = typeof IDBFactory !== 'undefined' ? IDBFactory.prototype : null
      const databasePrototype = typeof IDBDatabase !== 'undefined' ? IDBDatabase.prototype : null
      const objectStorePrototype = typeof IDBObjectStore !== 'undefined' ? IDBObjectStore.prototype : null
      const originalOpen = factoryPrototype?.open
      const originalTransaction = databasePrototype?.transaction
      const originalMethods = {
        get: objectStorePrototype?.get,
        put: objectStorePrototype?.put,
        delete: objectStorePrototype?.delete,
        clear: objectStorePrototype?.clear,
        getAllKeys: objectStorePrototype?.getAllKeys,
      }
      const openModelDb = () => new Promise((resolve, reject) => {
        if (!originalOpen) { reject(new Error('IndexedDB open is unavailable')); return }
        const request = originalOpen.call(indexedDB, modelDbName, 1)
        request.onupgradeneeded = () => {
          const db = request.result
          if (!db.objectStoreNames.contains(modelStoreName)) db.createObjectStore(modelStoreName)
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error || new Error('Could not open sentinel model DB'))
      })
      const copyIo = () => ({ ...window.__M24_MODEL_DB_IO__ })
      const installModelDbSpies = () => {
        if (!factoryPrototype || !originalOpen || !databasePrototype || !originalTransaction || !objectStorePrototype || Object.values(originalMethods).some((method) => typeof method !== 'function')) {
          throw new Error('IndexedDB model I/O instrumentation is incomplete')
        }
        Object.defineProperty(factoryPrototype, 'open', { configurable: true, value: function (...args) {
          if (!window.__M24_MODEL_DB_OBSERVING__ && args[0] === modelDbName) window.__M24_MODEL_DB_IO__.opens += 1
          return originalOpen.apply(this, args)
        } })
        Object.defineProperty(databasePrototype, 'transaction', { configurable: true, value: function (...args) {
          if (!window.__M24_MODEL_DB_OBSERVING__ && this.name === modelDbName) {
            window.__M24_MODEL_DB_IO__.transactions += 1
            const mode = args[1] || 'readonly'
            if (mode === 'readwrite') window.__M24_MODEL_DB_IO__.readwrite += 1
            else if (mode === 'readonly') window.__M24_MODEL_DB_IO__.readonly += 1
          }
          return originalTransaction.apply(this, args)
        } })
        for (const [method, field] of [['get', 'gets'], ['put', 'puts'], ['delete', 'deletes'], ['clear', 'clears'], ['getAllKeys', 'getAllKeys']]) {
          const original = originalMethods[method]
          Object.defineProperty(objectStorePrototype, method, { configurable: true, value: function (...args) {
            if (!window.__M24_MODEL_DB_OBSERVING__ && this.transaction?.db?.name === modelDbName) window.__M24_MODEL_DB_IO__[field] += 1
            return original.apply(this, args)
          } })
        }
      }
      window.__M24_MODEL_DB_SNAPSHOT__ = async () => {
        if (!originalOpen || !originalTransaction || !originalMethods.get || !originalMethods.getAllKeys) return { available: false, io: copyIo() }
        window.__M24_MODEL_DB_OBSERVING__ = true
        try {
          const db = await openModelDb()
          const result = await new Promise((resolve, reject) => {
            const transaction = originalTransaction.call(db, modelStoreName, 'readonly')
            const store = transaction.objectStore(modelStoreName)
            let keys = []
            let value
            let failed = false
            const fail = (error) => { if (!failed) { failed = true; reject(error) } }
            const keysRequest = originalMethods.getAllKeys.call(store)
            const valueRequest = originalMethods.get.call(store, modelSentinelKey)
            keysRequest.onsuccess = () => { keys = keysRequest.result || [] }
            keysRequest.onerror = () => fail(keysRequest.error || new Error('Could not read sentinel keys'))
            valueRequest.onsuccess = () => { value = valueRequest.result }
            valueRequest.onerror = () => fail(valueRequest.error || new Error('Could not read sentinel value'))
            transaction.onerror = () => fail(transaction.error || new Error('Could not observe sentinel model DB'))
            transaction.onabort = () => fail(new Error('Sentinel model DB read aborted'))
            transaction.oncomplete = async () => {
              if (failed) return
              try {
                const bytes = value && typeof value.arrayBuffer === 'function' ? Array.from(new Uint8Array(await value.arrayBuffer())) : null
                resolve({
                  keys: keys.map((key) => String(key)).sort(),
                  records: value ? [{ key: modelSentinelKey, name: value.name || null, size: value.size ?? null, type: value.type || null, lastModified: value.lastModified ?? null, bytes }] : [],
                  io: copyIo(),
                })
              } catch (error) { fail(error) }
            }
          })
          db.close()
          return { available: true, ...result }
        } catch (error) {
          return { available: false, error: String(error), io: copyIo() }
        } finally {
          window.__M24_MODEL_DB_OBSERVING__ = false
        }
      }
      window.__M24_MODEL_UI_STATUS__ = () => {
        const modelInputSelector = 'input[type="file"][accept*="glb"], input[type="file"][accept*="gltf"]'
        const controls = [...document.querySelectorAll('button, label, input')]
        const controlText = controls.map((element) => (element.textContent || '') + ' ' + (element.getAttribute('aria-label') || '') + ' ' + (element.getAttribute('accept') || '')).join(' ')
        return {
          customModelInputVisible: Boolean(document.querySelector(modelInputSelector)),
          customModelControlsVisible: /3D 模型|模型管理|匯入 GLB|custom model/i.test(controlText),
        }
      }
      window.__M24_MODEL_DB_SETUP__ = (async () => {
        if (!originalOpen || !originalTransaction || !originalMethods.put) return false
        let db
        try {
          db = await openModelDb()
          await new Promise((resolve, reject) => {
            const transaction = originalTransaction.call(db, modelStoreName, 'readwrite')
            const file = new File([new Uint8Array([77, 79, 66, 73, 69, 45, 83, 69, 78, 84, 73, 78, 69, 76])], 'sentinel.glb', { type: 'model/gltf-binary', lastModified: 1700000000000 })
            originalMethods.put.call(transaction.objectStore(modelStoreName), file, modelSentinelKey)
            transaction.oncomplete = resolve
            transaction.onerror = () => reject(transaction.error || new Error('Could not write sentinel model'))
            transaction.onabort = () => reject(new Error('Sentinel model write aborted'))
          })
          db.close()
          installModelDbSpies()
          return true
        } catch {
          db?.close()
          return false
        }
      })().then((ready) => { window.__M24_MODEL_DB_READY__ = ready; return ready }, () => { window.__M24_MODEL_DB_READY__ = false; return false })
      window.__M24_CAMERA_REQUESTS__ = 0
      const devices = navigator.mediaDevices
      const original = devices?.getUserMedia
      window.__M24_CAMERA_PROBE_INSTALLED__ = !devices || typeof original !== 'function'
      if (!devices || typeof original !== 'function') return
      try {
        Object.defineProperty(window, '__M24_ORIGINAL_GET_USER_MEDIA__', { configurable: true, value: original })
        Object.defineProperty(devices, 'getUserMedia', { configurable: true, value: function (...args) {
          window.__M24_CAMERA_REQUESTS__ += 1
          return window.__M24_ORIGINAL_GET_USER_MEDIA__.apply(this, args)
        } })
        window.__M24_CAMERA_PROBE_INSTALLED__ = true
      } catch {
        window.__M24_CAMERA_PROBE_INSTALLED__ = false
      }
    })()`
    startupScriptIdentifier = (await call('Page.addScriptToEvaluateOnNewDocument', { source: startupScript })).identifier
    const url = new URL(config.app)
    url.searchParams.set('m24Scenario', SCENARIO_ID)
    url.searchParams.set('width', String(viewport.width))
    url.searchParams.set('height', String(viewport.height))
    url.searchParams.set('seed', config.seed)
    url.searchParams.set('run', `${Date.now()}`)
    await call('Page.navigate', { url: url.href })
    await waitFor('document.readyState === "complete"', 20_000, 'app document')
    await waitFor('window.__M24_MODEL_DB_READY__ === true', 15_000, 'mz-models sentinel setup')
    verifyModelDb(await evaluate('window.__M24_MODEL_DB_SNAPSHOT__()'), 'startup')
    await waitFor('Boolean(window.__MOBIE_M24_BASELINE__?.active)', 20_000, 'M24 baseline driver')
    await waitForStores()
    await waitFor('Boolean(document.querySelector(".title-screen__adventure"))', 15_000, 'Title')
    checkpoints.push(await capture('title', 'real app boot'))
    const migration = await evaluate(`(() => {
      const read = (key) => {
        try { return JSON.parse(localStorage.getItem(key) ?? 'null') } catch { return null }
      }
      const legacy = read('mobie.settings.v1')
      const current = read('mobie.settings.v2')
      return {
        legacyModules: legacy?.modules ?? null,
        schemaVersion: current?.schemaVersion ?? null,
        hasModules: Boolean(current?.modules),
        scannerEnabled: current?.prefs?.scannerEnabled ?? null,
        graphicsPreference: current?.prefs?.graphicsPreference ?? null,
        cameraProbeInstalled: Boolean(window.__M24_CAMERA_PROBE_INSTALLED__),
      }
    })()`)
    if (migration.legacyModules?.synergy !== true || migration.schemaVersion !== 2 || migration.hasModules || migration.scannerEnabled !== false || migration.graphicsPreference !== 'auto' || !migration.cameraProbeInstalled) {
      throw new Error(`Settings v1 migration/probe failed: ${JSON.stringify(migration)}`)
    }
    checkpoints.push(await capture('settings-v1-migrated', 'real v1→v2 migration and fixed-module omission', { observation: migration }))
    await clickText('更多')
    await waitFor('Boolean(document.querySelector("#tools-menu-more"))', 5_000, 'More menu')
    const toolsModelBoundary = await evaluate(`(() => {
      const menu = document.querySelector('#tools-menu-more')
      const text = menu?.textContent || ''
      const modelUi = window.__M24_MODEL_UI_STATUS__()
      return {
        modelToolVisible: /3D 模型|模型管理|匯入 GLB|custom model/i.test(text) || modelUi.customModelControlsVisible,
        modelInputVisible: modelUi.customModelInputVisible,
      }
    })()`)
    if (toolsModelBoundary.modelToolVisible || toolsModelBoundary.modelInputVisible) throw new Error(`Retired custom model UI is reachable: ${JSON.stringify(toolsModelBoundary)}`)
    checkpoints.push(await capture('tools-more', 'real ToolsMenu expansion', { observation: { toolsModelBoundary } }))
    scannerOffEvidence = await evaluate(`(() => ({
      scannerVisible: Boolean(document.querySelector('[data-tool="scanner"]')),
      scannerChunkLoaded: [...performance.getEntriesByType('resource')].some((entry) => /CardScanner|jsqr/i.test(entry.name)),
      cameraRequests: Number(window.__M24_CAMERA_REQUESTS__ ?? 0),
    }))()`)
    if (scannerOffEvidence.scannerVisible || scannerOffEvidence.scannerChunkLoaded || scannerOffEvidence.cameraRequests !== 0) {
      throw new Error(`Scanner off boundary failed: ${JSON.stringify(scannerOffEvidence)}`)
    }
    checkpoints.push(await capture('scanner-off', 'default-off scanner capability boundary', { observation: scannerOffEvidence }))

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
    if (await exists('.modal-card')) await closeTopModal()

    await openTool('孵化所', '孵化所')
    await waitFor('(document.body.innerText || "").includes("還沒有蛋")', 8_000, 'empty incubator state')
    checkpoints.push(await capture('incubator-empty', 'real empty localStorage state', { behavior: await probeEscape() }))
    if (await exists('.modal-card')) await closeTopModal()

    const seeded = await driver('window.__MOBIE_M24_BASELINE__.seedContent({ learnedPartnerSkills: [] })')
    await waitFor('Boolean(window.__MOBIE_M24_BASELINE__.snapshot().readyEggs > 0)', 8_000, 'seeded baseline content')

    await clickSelector('.tools-menu-primary__mobies')
    await waitFor('Boolean(document.querySelector(".modal-card"))', 8_000, 'My Mobies modal')
    checkpoints.push(await capture('my-mobies', 'real roster and growth store'))
    await clickSelector('button.team-row__main')
    await waitFor('Boolean(document.querySelector(".mobcard"))', 5_000, 'MobCard detail')
    // Keep the detail panel open for the Ticket 37 handoff; Escape coverage is
    // exercised by the surrounding overlay checkpoints.
    checkpoints.push(await capture('my-mobies-detail', 'real owner info card'))

    // Ticket 37's primary path starts from the owner MobCard. Exercise the
    // real SP/loadout boundary here before returning to the collection shell.
    await clickSelector('[data-mobcard-move-trainer]')
    await waitFor('Boolean(document.querySelector("[data-move-trainer]"))', 8_000, 'Move Trainer from MobCard')
    checkpoints.push(await capture('move-trainer-detail', 'owner detail → focused Move Trainer'))
    const trainerActionEvidence = await evaluate(`(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
      const rosterRead = () => {
        try { return JSON.parse(localStorage.getItem('mobie.roster.v2') ?? '[]') } catch { return [] }
      }
      const rosterOf = () => {
        const value = rosterRead()
        return Array.isArray(value) ? value : value?.roster ?? []
      }
      const targetId = document.querySelector('[data-trainer-unit]')?.dataset.trainerUnit ?? null
      const beforeSp = Number(document.querySelector('[data-sp-ledger]')?.dataset.spCurrent ?? -1)
      const learnButton = [...document.querySelectorAll('[data-move-state="learnable"] button')].find((button) => !button.disabled)
      if (!targetId || !learnButton) return { targetId, beforeSp, error: 'no legal learn action' }
      const moveId = Number(learnButton.closest('[data-move-id]')?.getAttribute('data-move-id') ?? NaN)
      const moveName = learnButton.getAttribute('aria-label') ?? ''
      learnButton.click()
      await wait(450)
      const afterLearn = rosterOf().find((unit) => unit.id === targetId)
      const learned = Array.isArray(afterLearn?.learnedMoveIds) && afterLearn.learnedMoveIds.includes(moveId)
      const spAfterLearn = Number(document.querySelector('[data-sp-ledger]')?.dataset.spCurrent ?? -1)
      const equipButton = [...document.querySelectorAll('[data-move-state="learned"] button')].find((button) => !button.disabled && button.getAttribute('aria-label')?.includes(moveName.replace(/^花費 [0-9]+ SP 學習 /, '')))
        ?? [...document.querySelectorAll('[data-move-state="learned"] button')].find((button) => !button.disabled)
      equipButton?.click()
      await wait(350)
      const afterEquip = rosterOf().find((unit) => unit.id === targetId)
      const equippedAfterEquip = Array.isArray(afterEquip?.equippedMoveIds) ? afterEquip.equippedMoveIds : []
      const reorderButton = [...document.querySelectorAll('[data-move-slot] button[aria-label*="往前移"]')].find((button) => !button.disabled)
      reorderButton?.click()
      await wait(350)
      const afterReorder = rosterOf().find((unit) => unit.id === targetId)
      const equippedAfterReorder = Array.isArray(afterReorder?.equippedMoveIds) ? afterReorder.equippedMoveIds : []
      const duplicateFree = new Set(equippedAfterReorder).size === equippedAfterReorder.length && equippedAfterReorder.length >= 1 && equippedAfterReorder.length <= 4
      const unequipButton = [...document.querySelectorAll('[data-move-slot] button[aria-label*="卸下"]')].find((button) => button.getAttribute('aria-label')?.includes(moveName.replace(/^花費 [0-9]+ SP 學習 /, '')))
        ?? [...document.querySelectorAll('[data-move-slot] button[aria-label*="卸下"]')].at(-1)
      unequipButton?.click()
      await wait(350)
      const afterUnequip = rosterOf().find((unit) => unit.id === targetId)
      const learnedAfterUnequip = Array.isArray(afterUnequip?.learnedMoveIds) && afterUnequip.learnedMoveIds.includes(moveId)
      const equippedAfterUnequip = Array.isArray(afterUnequip?.equippedMoveIds) ? afterUnequip.equippedMoveIds : []
      const spAfter = Number(document.querySelector('[data-sp-ledger]')?.dataset.spCurrent ?? -1)
      return {
        targetId, moveId, beforeSp, spAfterLearn, spAfter,
        learned, learnedAfterUnequip,
        equippedAfterEquip, equippedAfterReorder, equippedAfterUnequip,
        duplicateFree, moveName,
      }
    })()`)
    if (!trainerActionEvidence.learned || !trainerActionEvidence.learnedAfterUnequip || !trainerActionEvidence.duplicateFree || trainerActionEvidence.spAfter !== trainerActionEvidence.spAfterLearn) {
      throw new Error(`Move Trainer canonical action boundary failed: ${JSON.stringify(trainerActionEvidence)}`)
    }
    checkpoints.push(await capture('move-trainer-actions', 'real learn/equip/unequip/reorder with SP ledger', { observation: trainerActionEvidence }))
    // A pushed overlay swaps the single visible modal surface, so wait for
    // the parent stack entry after closing the trainer before closing TeamModal.
    await clickText('關閉', '[data-modal-close]')
    await waitFor(`(() => { const id = document.querySelector('[data-overlay-host]')?.dataset.overlayId ?? ''; return id === 'team' || id.startsWith('mobie-detail:') })()`, 5_000, 'return to My Mobies after trainer')
    if (await evaluate(`document.querySelector('[data-overlay-host]')?.dataset.overlayId?.startsWith('mobie-detail:') ?? false`)) {
      await clickText('關閉', '[data-modal-close]')
      await waitFor(`document.querySelector('[data-overlay-host]')?.dataset.overlayId === 'team'`, 5_000, 'return to collection after compact trainer')
    }
    await closeTopModal()

    await openTool('卡庫', '卡庫')
    await waitFor('Boolean(document.querySelector(".utility-row") || (document.body.innerText || "").includes("卡庫是空的"))', 10_000, 'card library content')
    checkpoints.push(await capture('card-library', 'real IndexedDB card library'))
    await clickText('新增自製卡')
    await waitFor('Boolean(document.querySelector(".lib-matches"))', 5_000, 'card add panel')
    checkpoints.push(await capture('card-library-add', 'real species search panel'))
    await clickSelector('.lib-match')
    await sleep(300)
    await clickText('QR')
    await waitFor('Boolean(document.querySelector(".qr-card"))', 8_000, 'QR overlay')
    checkpoints.push(await capture('card-library-qr', 'real QR generation'))
    await clickText('關閉', '[data-modal-surface] button')
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

    // Reload is a first-class part of the trainer contract: the next route
    // must read the exact canonical order rather than a component draft.
    const savedSkillPoints = await evaluate('localStorage.getItem("mobie.skillpoints.v1")')
    const savedLoadout = await evaluate(`(() => {
      try {
        const raw = JSON.parse(localStorage.getItem('mobie.roster.v2') ?? '[]')
        const roster = Array.isArray(raw) ? raw : raw?.roster ?? []
        return roster[0]?.equippedMoveIds ?? []
      } catch { return [] }
    })()`)
    await call('Page.reload', { ignoreCache: true })
    await waitFor('document.readyState === "complete"', 20_000, 'Move Trainer reload')
    await waitFor('Boolean(document.querySelector(".title-screen__adventure"))', 15_000, 'Title after Move Trainer reload')
    await openTool('招式', '招式訓練所')
    await clickSelector('.team-row__item-btn')
    await waitFor('Boolean(document.querySelector("[data-trainer-panel]"))', 8_000, 'Move Trainer panel after reload')
    const reloadedLoadout = await evaluate(`(() => ({
      storage: (() => { try { const raw = JSON.parse(localStorage.getItem('mobie.roster.v2') ?? '[]'); const roster = Array.isArray(raw) ? raw : raw?.roster ?? []; return roster[0]?.equippedMoveIds ?? [] } catch { return [] } })(),
      slots: (() => { const unit = document.querySelector('[data-trainer-unit]'); return unit ? [...unit.querySelectorAll('[data-move-slot][data-slot-state="filled"] [data-move-definition]')].map((element) => Number(element.getAttribute('data-move-id'))) : [] })(),
    }))()`)
    if (JSON.stringify(reloadedLoadout.storage) !== JSON.stringify(savedLoadout) || JSON.stringify(reloadedLoadout.slots) !== JSON.stringify(savedLoadout)) {
      throw new Error(`Move Trainer loadout did not survive reload: ${JSON.stringify({ savedLoadout, reloadedLoadout })}`)
    }
    checkpoints.push(await capture('move-trainer-reloaded', 'real canonical loadout after page reload', { observation: { savedLoadout, reloadedLoadout } }))
    await closeTopModal()

    // Force the wallet to zero for a real disabled-resource checkpoint, then
    // restore the exact marker-bearing value before continuing the journey.
    await evaluate('localStorage.setItem("mobie.skillpoints.v1", "0")')
    await call('Page.reload', { ignoreCache: true })
    await waitFor('document.readyState === "complete"', 20_000, 'insufficient SP reload')
    await waitFor('Boolean(document.querySelector(".title-screen__adventure"))', 15_000, 'Title after insufficient SP reload')
    await openTool('招式', '招式訓練所')
    await clickSelector('.team-row__item-btn')
    await waitFor(`Boolean(document.querySelector('[data-disabled-reason="sp-insufficient"]'))`, 8_000, 'insufficient SP disabled reason')
    const insufficientEvidence = await evaluate(`({
      sp: document.querySelector('[data-sp-ledger]')?.dataset.spCurrent ?? null,
      disabled: [...document.querySelectorAll('[data-disabled-reason="sp-insufficient"]')].slice(0, 4).map((element) => ({ label: element.getAttribute('aria-label'), describedBy: element.getAttribute('aria-describedby'), reason: element.parentElement?.querySelector('[id]')?.textContent ?? '' })),
    })`)
    if (insufficientEvidence.sp !== '0' || insufficientEvidence.disabled.length === 0) throw new Error(`SP insufficient guard failed: ${JSON.stringify(insufficientEvidence)}`)
    checkpoints.push(await capture('move-trainer-insufficient-sp', 'real SP=0 disabled learn actions', { observation: insufficientEvidence }))
    await closeTopModal()
    await evaluate(`localStorage.setItem('mobie.skillpoints.v1', ${JSON.stringify(savedSkillPoints)})`)

    // Make localStorage fail at the canonical write boundary. The modal must
    // retain the old wallet and expose a retryable alert instead of a half-applied move.
    await evaluate('localStorage.setItem("mobie.skillpoints.v1", "10")')
    await call('Page.reload', { ignoreCache: true })
    await waitFor('document.readyState === "complete"', 20_000, 'storage failure reload')
    await waitFor('Boolean(document.querySelector(".title-screen__adventure"))', 15_000, 'Title after storage failure reload')
    await openTool('招式', '招式訓練所')
    await clickSelector('.team-row__item-btn')
    await waitFor('Boolean(document.querySelector("[data-trainer-panel]"))', 8_000, 'Move Trainer storage failure panel')
    const storageFailure = await evaluate(`(() => {
      window.__M24_OLD_STORAGE_SET_ITEM__ = Storage.prototype.setItem
      Storage.prototype.setItem = function () { throw new Error('M24 simulated storage failure') }
      const action = [...document.querySelectorAll('[data-move-state="learnable"] button')].find((button) => !button.disabled)
      action?.click()
      return Boolean(action)
    })()`)
    if (!storageFailure) throw new Error('Could not find a learn action for storage failure checkpoint')
    await waitFor('Boolean(document.querySelector("[data-trainer-notice]"))', 8_000, 'Move Trainer storage error')
    const storageFailureEvidence = await evaluate(`({
      sp: document.querySelector('[data-sp-ledger]')?.dataset.spCurrent ?? null,
      notice: document.querySelector('[data-trainer-notice]')?.textContent ?? '',
    })`)
    if (storageFailureEvidence.sp !== '10' || !storageFailureEvidence.notice.includes('保存失敗')) throw new Error(`Storage error was not recoverable: ${JSON.stringify(storageFailureEvidence)}`)
    checkpoints.push(await capture('move-trainer-storage-error', 'real simulated storage failure and unchanged SP', { observation: storageFailureEvidence }))
    await evaluate(`(() => { Storage.prototype.setItem = window.__M24_OLD_STORAGE_SET_ITEM__; delete window.__M24_OLD_STORAGE_SET_ITEM__; localStorage.setItem('mobie.skillpoints.v1', ${JSON.stringify(savedSkillPoints)}); return true })()`)
    await call('Page.reload', { ignoreCache: true })
    await waitFor('document.readyState === "complete"', 20_000, 'Move Trainer state restore')
    await waitFor('Boolean(document.querySelector(".title-screen__adventure"))', 15_000, 'Title after Move Trainer state restore')

    await openTool('夥伴技能', '夥伴技能')
    await waitFor('Boolean(document.querySelector("[data-partner-skills]"))', 8_000, 'partner skill content')
    checkpoints.push(await capture('partner-skills', 'real player skill wallet'))
    const partnerInitial = await evaluate(`(() => ({
      sp: document.querySelector('[data-sp-ledger]')?.dataset.spCurrent ?? null,
      rallyState: document.querySelector('[data-partner-skill-id="rally"]')?.dataset.partnerSkillState ?? null,
      unlockAction: Boolean(document.querySelector('[data-partner-skill-id="rally"] button:not([disabled])')),
      hasBattleUseCopy: (document.querySelector('[data-partner-skill-id="rally"]')?.textContent || '').includes('戰鬥使用'),
    }))()`)
    if (partnerInitial.rallyState !== 'available' || !partnerInitial.unlockAction || !partnerInitial.hasBattleUseCopy) throw new Error(`Partner catalog is not unlock-ready: ${JSON.stringify(partnerInitial)}`)

    // Simulate another tab changing the shared wallet while this modal is
    // open. The transaction must refuse the stale snapshot and keep both
    // the rendered balance and learned state unchanged until refresh.
    await evaluate('localStorage.setItem("mobie.skillpoints.v1", "10")')
    await clickSelector('[data-partner-skill-id="rally"] button:not([disabled])')
    await waitFor('Boolean(document.querySelector("[data-partner-notice]"))', 8_000, 'Partner stale account notice')
    const partnerStale = await evaluate(`(() => ({
      sp: document.querySelector('[data-sp-ledger]')?.dataset.spCurrent ?? null,
      state: document.querySelector('[data-partner-skill-id="rally"]')?.dataset.partnerSkillState ?? null,
      notice: document.querySelector('[data-partner-notice]')?.textContent ?? '',
      storedSp: localStorage.getItem('mobie.skillpoints.v1'),
      storedLearned: (() => { try { return JSON.parse(localStorage.getItem('mobie.playerskills.v1') ?? 'null') } catch { return null } })(),
    }))()`)
    if (partnerStale.sp !== String(savedSkillPoints) || partnerStale.state !== 'available' || !partnerStale.notice.includes('其他分頁') || partnerStale.storedLearned?.learnedSkillIds?.includes('rally')) throw new Error(`Partner stale account guard failed: ${JSON.stringify(partnerStale)}`)
    checkpoints.push(await capture('partner-skills-stale-account', 'real stale account unlock recovery', { observation: partnerStale }))
    await evaluate(`localStorage.setItem('mobie.skillpoints.v1', ${JSON.stringify(savedSkillPoints)})`)
    await clickText('重新載入帳號')
    await waitFor(`Boolean(document.querySelector('[data-partner-skill-id="rally"] button:not([disabled])'))`, 8_000, 'Partner stale account refresh')

    // The same account wallet must expose a real disabled reason at SP=0 and
    // recover by reloading the persisted snapshot before any unlock attempt.
    await evaluate('localStorage.setItem("mobie.skillpoints.v1", "0")')
    await call('Page.reload', { ignoreCache: true })
    await waitFor('document.readyState === "complete"', 20_000, 'Partner insufficient SP reload')
    await waitFor('Boolean(document.querySelector(".title-screen__adventure"))', 15_000, 'Title after Partner insufficient SP reload')
    await openTool('夥伴技能', '夥伴技能')
    await waitFor(`Boolean(document.querySelector('[data-disabled-reason="sp-insufficient"]'))`, 8_000, 'Partner insufficient SP reason')
    const partnerInsufficient = await evaluate(`(() => ({
      sp: document.querySelector('[data-sp-ledger]')?.dataset.spCurrent ?? null,
      state: document.querySelector('[data-partner-skill-id="rally"]')?.dataset.partnerSkillState ?? null,
      disabled: [...document.querySelectorAll('[data-disabled-reason="sp-insufficient"]')].map((element) => ({ label: element.getAttribute('aria-label'), reason: element.getAttribute('aria-describedby') ? document.getElementById(element.getAttribute('aria-describedby'))?.textContent ?? '' : '' })),
      storedLearned: (() => { try { return JSON.parse(localStorage.getItem('mobie.playerskills.v1') ?? 'null') } catch { return null } })(),
    }))()`)
    if (partnerInsufficient.sp !== '0' || partnerInsufficient.state !== 'locked' || partnerInsufficient.disabled.length === 0 || partnerInsufficient.storedLearned?.learnedSkillIds?.includes('rally')) throw new Error(`Partner insufficient SP guard failed: ${JSON.stringify(partnerInsufficient)}`)
    checkpoints.push(await capture('partner-skills-insufficient-sp', 'real SP=0 disabled Partner unlock', { observation: partnerInsufficient }))
    await closeTopModal()
    await evaluate(`localStorage.setItem('mobie.skillpoints.v1', ${JSON.stringify(savedSkillPoints)})`)

    // Fail the canonical write after the SP step. The store must roll the
    // wallet back and expose a retryable notice without granting rally.
    await call('Page.reload', { ignoreCache: true })
    await waitFor('document.readyState === "complete"', 20_000, 'Partner storage failure reload')
    await waitFor('Boolean(document.querySelector(".title-screen__adventure"))', 15_000, 'Title after Partner storage failure reload')
    await openTool('夥伴技能', '夥伴技能')
    await waitFor(`Boolean(document.querySelector('[data-partner-skill-id="rally"] button:not([disabled])'))`, 8_000, 'Partner unlock action')
    const partnerStorageFailure = await evaluate(`(() => {
      window.__M24_OLD_STORAGE_SET_ITEM__ = Storage.prototype.setItem
      Storage.prototype.setItem = function () { throw new Error('M24 simulated Partner storage failure') }
      const action = document.querySelector('[data-partner-skill-id="rally"] button:not([disabled])')
      action?.click()
      return Boolean(action)
    })()`)
    if (!partnerStorageFailure) throw new Error('Could not find Partner unlock action for storage failure checkpoint')
    await waitFor('Boolean(document.querySelector("[data-partner-notice]"))', 8_000, 'Partner storage error notice')
    const partnerStorageEvidence = await evaluate(`(() => ({
      sp: document.querySelector('[data-sp-ledger]')?.dataset.spCurrent ?? null,
      state: document.querySelector('[data-partner-skill-id="rally"]')?.dataset.partnerSkillState ?? null,
      notice: document.querySelector('[data-partner-notice]')?.textContent ?? '',
      storedSp: localStorage.getItem('mobie.skillpoints.v1'),
      storedLearned: (() => { try { return JSON.parse(localStorage.getItem('mobie.playerskills.v1') ?? 'null') } catch { return null } })(),
    }))()`)
    if (partnerStorageEvidence.sp !== String(savedSkillPoints) || partnerStorageEvidence.state !== 'available' || !partnerStorageEvidence.notice.includes('保存失敗') || partnerStorageEvidence.storedLearned?.learnedSkillIds?.includes('rally')) throw new Error(`Partner storage failure was not recoverable: ${JSON.stringify(partnerStorageEvidence)}`)
    checkpoints.push(await capture('partner-skills-storage-error', 'real simulated Partner storage failure and rollback', { observation: partnerStorageEvidence }))
    await evaluate(`(() => { Storage.prototype.setItem = window.__M24_OLD_STORAGE_SET_ITEM__; delete window.__M24_OLD_STORAGE_SET_ITEM__; localStorage.setItem('mobie.skillpoints.v1', ${JSON.stringify(savedSkillPoints)}); return true })()`)
    await closeTopModal()

    await call('Page.reload', { ignoreCache: true })
    await waitFor('document.readyState === "complete"', 20_000, 'Partner unlock reload')
    await waitFor('Boolean(document.querySelector(".title-screen__adventure"))', 15_000, 'Title after Partner unlock reload')
    await openTool('夥伴技能', '夥伴技能')
    await waitFor(`Boolean(document.querySelector('[data-partner-skill-id="rally"] button:not([disabled])'))`, 8_000, 'Partner unlock retry action')
    const partnerKeyboardFocus = await evaluate(`(() => {
      const action = document.querySelector('[data-partner-skill-id="rally"] button:not([disabled])')
      if (!action) return false
      action.focus()
      if (document.activeElement !== action) return false
      action.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }))
      return true
    })()`)
    if (!partnerKeyboardFocus) throw new Error('Partner unlock action did not accept focus before keyboard activation')
    await waitFor(`document.querySelector('[data-partner-skill-id="rally"]')?.dataset.partnerSkillState === 'learned'`, 8_000, 'Partner unlock commit')
    const partnerUnlock = await evaluate(`(() => ({
      sp: document.querySelector('[data-sp-ledger]')?.dataset.spCurrent ?? null,
      state: document.querySelector('[data-partner-skill-id="rally"]')?.dataset.partnerSkillState ?? null,
      keyboardFocus: ${JSON.stringify(partnerKeyboardFocus)},
      unlockActionStillPresent: Boolean(document.querySelector('[data-partner-skill-id="rally"] button:not([disabled])')),
      storedSp: localStorage.getItem('mobie.skillpoints.v1'),
      storedLearned: (() => { try { return JSON.parse(localStorage.getItem('mobie.playerskills.v1') ?? 'null') } catch { return null } })(),
      notice: document.querySelector('[data-partner-notice]')?.textContent ?? '',
    }))()`)
    if (partnerUnlock.sp !== String(Number(savedSkillPoints) - 6) || partnerUnlock.state !== 'learned' || !partnerUnlock.storedLearned?.learnedSkillIds?.includes('rally') || partnerUnlock.unlockActionStillPresent) throw new Error(`Partner unlock commit failed: ${JSON.stringify(partnerUnlock)}`)
    checkpoints.push(await capture('partner-skills-unlock', 'real single-click Partner unlock and SP deduction', { observation: partnerUnlock }))
    await closeTopModal()

    await call('Page.reload', { ignoreCache: true })
    await waitFor('document.readyState === "complete"', 20_000, 'Partner learned state reload')
    await waitFor('Boolean(document.querySelector(".title-screen__adventure"))', 15_000, 'Title after Partner learned state reload')
    await openTool('夥伴技能', '夥伴技能')
    await waitFor(`document.querySelector('[data-partner-skill-id="rally"]')?.dataset.partnerSkillState === 'learned'`, 8_000, 'Partner learned state after reload')
    const partnerReloaded = await evaluate(`(() => ({
      sp: document.querySelector('[data-sp-ledger]')?.dataset.spCurrent ?? null,
      state: document.querySelector('[data-partner-skill-id="rally"]')?.dataset.partnerSkillState ?? null,
      storedSp: localStorage.getItem('mobie.skillpoints.v1'),
      storedLearned: (() => { try { return JSON.parse(localStorage.getItem('mobie.playerskills.v1') ?? 'null') } catch { return null } })(),
      focusInside: Boolean(document.querySelector('[data-modal-surface]')?.contains(document.activeElement)),
    }))()`)
    if (partnerReloaded.sp !== String(Number(savedSkillPoints) - 6) || partnerReloaded.state !== 'learned' || !partnerReloaded.storedLearned?.learnedSkillIds?.includes('rally') || !partnerReloaded.focusInside) throw new Error(`Partner reload persistence failed: ${JSON.stringify(partnerReloaded)}`)
    checkpoints.push(await capture('partner-skills-reloaded', 'real learned Partner state after page reload', { observation: partnerReloaded }))
    await closeTopModal()

    await openTool('圖鑑', '圖鑑')
    await waitFor('Boolean(document.querySelector(".dex-cell"))', 8_000, 'dex content')
    checkpoints.push(await capture('dex', 'real generated species catalog'))
    await clickSelector('[data-dex-filter="registered"]')
    checkpoints.push(await capture('dex-registered', 'real registered filter'))
    await clickSelector('[data-dex-filter="all"]')
    await waitFor("document.querySelector('[data-dex-root]')?.dataset.dexVisible === '1025'", 8_000, 'dex all filter')
    await clickSelector('[data-dex-page="18"]')
    await waitFor("document.querySelector('[data-dex-root]')?.dataset.dexPage === '18'", 8_000, 'dex last page')
    await sleep(250)
    const dexLastPage = await evaluate(`(() => ({
      page: document.querySelector('[data-dex-root]')?.dataset.dexPage ?? null,
      visible: document.querySelector('[data-dex-root]')?.dataset.dexVisible ?? null,
      cells: document.querySelectorAll('[data-dex-cell]').length,
      first: document.querySelector('[data-dex-cell]')?.dataset.dexSpeciesId ?? null,
      last: [...document.querySelectorAll('[data-dex-cell]')].at(-1)?.dataset.dexSpeciesId ?? null,
      focus: document.activeElement?.getAttribute('data-dex-species-id') ?? null,
    }))()`)
    if (dexLastPage.page !== '18' || dexLastPage.cells !== 5 || dexLastPage.first !== '1021' || dexLastPage.last !== '1025' || dexLastPage.focus !== '1021') throw new Error(`Dex last page boundary/focus failed: ${JSON.stringify(dexLastPage)}`)
    checkpoints.push(await capture('dex-page-last', 'real last-page pagination boundary', { observation: dexLastPage }))
    await clickSelector('[data-dex-cell]')
    await waitFor('Boolean(document.querySelector("[data-dex-detail]"))', 8_000, 'dex detail')
    await waitFor('document.activeElement?.matches("[data-dex-detail-close]")', 8_000, 'dex detail focus')
    const dexDetail = await evaluate(`(() => ({
      id: document.querySelector('[data-dex-detail]')?.getAttribute('aria-label') ?? null,
      number: document.querySelector('.dex-detail__number')?.textContent?.trim() ?? null,
      state: document.querySelector('[data-dex-detail-status]')?.textContent?.trim() ?? null,
      grade: document.querySelector('[data-dex-detail-grade]')?.textContent?.trim() ?? null,
      focus: document.activeElement?.getAttribute('aria-label') ?? null,
      cells: document.querySelectorAll('[data-dex-cell]').length,
    }))()`)
    if (dexDetail.number !== '#1021' || !dexDetail.id?.includes('猛雷鼓') || dexDetail.focus !== '返回清單' || dexDetail.cells !== 5) throw new Error(`Dex detail contract failed: ${JSON.stringify(dexDetail)}`)
    checkpoints.push(await capture('dex-detail', 'real detail with bounded list retained', { observation: dexDetail }))
    await clickSelector('[data-dex-detail-close]')
    await waitFor('!document.querySelector("[data-dex-detail]")', 8_000, 'dex detail close')
    await sleep(250)
    const dexRestore = await evaluate(`(() => ({
      page: document.querySelector('[data-dex-root]')?.dataset.dexPage ?? null,
      focus: document.activeElement?.getAttribute('data-dex-species-id') ?? null,
      cells: document.querySelectorAll('[data-dex-cell]').length,
    }))()`)
    if (dexRestore.page !== '18' || dexRestore.focus !== '1021' || dexRestore.cells !== 5) throw new Error(`Dex detail restore failed: ${JSON.stringify(dexRestore)}`)
    checkpoints.push(await capture('dex-detail-restore', 'real detail close restores page and item focus', { observation: dexRestore }))
    await setValue('[aria-label="搜尋圖鑑名稱或編號"]', '皮卡丘')
    await waitFor("document.querySelector('[data-dex-root]')?.dataset.dexVisible === '1'", 8_000, 'dex search')
    const dexSearch = await evaluate(`(() => ({
      visible: document.querySelector('[data-dex-root]')?.dataset.dexVisible ?? null,
      page: document.querySelector('[data-dex-root]')?.dataset.dexPage ?? null,
      id: document.querySelector('[data-dex-cell]')?.dataset.dexSpeciesId ?? null,
      text: document.querySelector('[data-dex-cell]')?.getAttribute('aria-label') ?? null,
    }))()`)
    if (dexSearch.visible !== '1' || dexSearch.page !== '1' || dexSearch.id !== '25' || !dexSearch.text?.includes('皮卡丘')) throw new Error(`Dex search failed: ${JSON.stringify(dexSearch)}`)
    checkpoints.push(await capture('dex-search', 'real name search resets to page one', { observation: dexSearch }))
    await clickSelector('[data-dex-filter="shining"]')
    await waitFor("document.querySelector('[data-dex-root]')?.dataset.dexVisible === '1'", 8_000, 'dex Grade S/SS filter')
    const dexGrade = await evaluate(`(() => ({
      visible: document.querySelector('[data-dex-root]')?.dataset.dexVisible ?? null,
      filter: document.querySelector('[data-dex-filter="shining"]')?.getAttribute('aria-pressed') ?? null,
      id: document.querySelector('[data-dex-cell]')?.dataset.dexSpeciesId ?? null,
      label: document.querySelector('[data-dex-cell]')?.getAttribute('aria-label') ?? null,
    }))()`)
    if (dexGrade.visible !== '1' || dexGrade.filter !== 'true' || dexGrade.id !== '25' || !dexGrade.label?.includes('Grade S')) throw new Error(`Dex Grade S/SS filter failed: ${JSON.stringify(dexGrade)}`)
    checkpoints.push(await capture('dex-grade', 'real 閃耀 Grade S/SS filter', { observation: dexGrade }))
    await setValue('[aria-label="搜尋圖鑑名稱或編號"]', 'not-a-real-mobie')
    await waitFor('document.querySelector("[data-dex-state=\\"empty\\"]") !== null', 8_000, 'dex empty result')
    const dexEmpty = await evaluate(`(() => ({
      state: document.querySelector('[data-dex-state="empty"]')?.dataset.dexState ?? null,
      clear: Boolean(document.querySelector('[data-dex-clear]')),
      text: document.querySelector('[data-dex-state="empty"]')?.textContent?.trim() ?? null,
    }))()`)
    if (dexEmpty.state !== 'empty' || !dexEmpty.clear) throw new Error(`Dex empty recovery failed: ${JSON.stringify(dexEmpty)}`)
    checkpoints.push(await capture('dex-empty', 'real invalid query with clear action', { observation: dexEmpty }))
    await clickSelector('[data-dex-clear]')
    await waitFor("document.querySelector('[data-dex-root]')?.dataset.dexVisible === '1025'", 8_000, 'dex clear')
    await evaluate(`(() => { const image = document.querySelector('[data-dex-artwork] img'); if (!image) return false; image.src = '/__m24__/missing-dex-artwork.png'; return true })()`)
    await waitFor('Boolean(document.querySelector("[data-dex-artwork-state=\\"failed\\"]"))', 8_000, 'dex artwork fallback')
    const dexArtwork = await evaluate(`(() => ({
      failed: document.querySelectorAll('[data-dex-artwork-state="failed"]').length,
      accessible: document.querySelector('[data-dex-artwork-state="failed"]')?.getAttribute('aria-label') ?? null,
      cells: document.querySelectorAll('[data-dex-cell]').length,
    }))()`)
    if (dexArtwork.failed < 1 || !dexArtwork.accessible || dexArtwork.cells !== 60) throw new Error(`Dex artwork fallback failed: ${JSON.stringify(dexArtwork)}`)
    checkpoints.push(await capture('dex-artwork-fallback', 'real image failure with fixed fallback slot', { observation: dexArtwork }))
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

    await openTool('存檔', '存檔')
    await waitFor('Boolean(document.querySelector(".modal-card"))', 8_000, 'save manager')
    const saveModelBoundary = await evaluate(`(() => ({
      modelControlsVisible: window.__M24_MODEL_UI_STATUS__().customModelControlsVisible,
      modelInputVisible: window.__M24_MODEL_UI_STATUS__().customModelInputVisible,
      modelCountRowVisible: [...document.querySelectorAll('td, th')].some((el) => (el.textContent || '').trim() === '模型'),
    }))()`)
    if (saveModelBoundary.modelControlsVisible || saveModelBoundary.modelInputVisible || saveModelBoundary.modelCountRowVisible) throw new Error(`Retired custom model controls remain in Save: ${JSON.stringify(saveModelBoundary)}`)
    checkpoints.push(await capture('save', 'real save manager', { observation: { saveModelBoundary } }))
    await holdShareBoundary()
    await clickText('匯出存檔')
    await sleep(35)
    checkpoints.push(await capture('save-busy', 'real export busy window held at share boundary'))
    await releaseShareBoundary()
    await waitFor('Boolean(document.querySelector(".lib-msg"))', 12_000, 'save export result')
    await waitFor('Array.isArray(window.__M24_SHARED_SAVE_BYTES__) && window.__M24_SHARED_SAVE_BYTES__.length > 0', 5_000, 'shared no-model save bytes')
    const exportedArchive = await evaluate(`(() => {
      const bytes = window.__M24_SHARED_SAVE_BYTES__ || []
      const has = (needle) => {
        const target = Array.from(new TextEncoder().encode(needle))
        return bytes.some((_, index) => target.every((value, offset) => bytes[index + offset] === value))
      }
      return { file: window.__M24_SHARED_SAVE_FILE__, size: bytes.length, hasManifest: has('manifest.json'), hasRoster: has('roster.json'), hasCards: has('cards.json'), hasModelsEntry: has('models/') }
    })()`)
    if (!exportedArchive.file || !exportedArchive.hasManifest || !exportedArchive.hasRoster || !exportedArchive.hasCards || exportedArchive.hasModelsEntry) throw new Error(`Exported save is not fixed no-model shape: ${JSON.stringify(exportedArchive)}`)
    checkpoints.push(await capture('save-result', 'real no-model save export', { observation: { exportedArchive } }))
    const malformedLegacySaveBytes = await driver('window.__MOBIE_M24_BASELINE__.makeMalformedLegacySave()')
    await setFileInput('input[type="file"][accept*=".save"]', 'malformed-legacy.save', malformedLegacySaveBytes, 'application/zip')
    await waitFor('Boolean(document.querySelector(".lib-msg"))', 8_000, 'save import validation')
    const malformedLegacyImport = await evaluate(`(() => ({
      recoverableError: (document.querySelector('.lib-msg')?.textContent || '').includes('校驗失敗'),
      modelInputVisible: window.__M24_MODEL_UI_STATUS__().customModelInputVisible,
    }))()`)
    if (!malformedLegacyImport.recoverableError || malformedLegacyImport.modelInputVisible) throw new Error(`Malformed legacy save was not safely rejected: ${JSON.stringify(malformedLegacyImport)}`)
    checkpoints.push(await capture('save-import-error', 'real malformed legacy model checksum error', { observation: { malformedLegacyImport } }))
    const olderSaveBytes = await driver('window.__MOBIE_M24_BASELINE__.makeOlderSave()')
    await setFileInput('input[type="file"][accept*=".save"]', 'older.save', olderSaveBytes, 'application/zip')
    await waitFor('Boolean(document.querySelector(".save-compare"))', 12_000, 'older save comparison')
    const legacyImport = await evaluate(`(() => ({
      notice: (document.querySelector('.save-compare')?.textContent || '').includes('舊版存檔含'),
      modelControlsVisible: window.__M24_MODEL_UI_STATUS__().customModelControlsVisible || window.__M24_MODEL_UI_STATUS__().customModelInputVisible,
    }))()`)
    if (!legacyImport.notice || legacyImport.modelControlsVisible) throw new Error(`Legacy model import boundary is incomplete: ${JSON.stringify(legacyImport)}`)
    checkpoints.push(await capture('save-compare-older', 'real legacy model entry checksum-only import', { observation: { legacyImport } }))
    await clickText('我了解', 'label')
    await clickText('仍要覆蓋並匯入')
    await waitFor('(document.body.innerText || "").includes("已匯入存檔")', 15_000, 'save import completion')
    await waitFor('(document.body.innerText || "").includes("有匯入前備份")', 15_000, 'pre-import backup')
    checkpoints.push(await capture('save-backup-ready', 'real pre-import backup state'))
    await clickText('還原')
    await waitFor('(document.body.innerText || "").includes("已還原匯入前的備份")', 15_000, 'save restore completion')
    checkpoints.push(await capture('save-restore-result', 'real backup restore result'))
    await closeTopModal()

    await evaluate(`(() => {
      localStorage.setItem('mobie.settings.v2', '{malformed-v2')
      localStorage.setItem('mobie.settings.v1', '{malformed-v1')
      return true
    })()`)
    await call('Page.reload', { ignoreCache: true })
    await waitFor('document.readyState === "complete"', 20_000, 'malformed settings recovery reload')
    await waitFor('Boolean(document.querySelector(".title-screen__adventure"))', 15_000, 'Title after malformed settings reload')
    await clickText('更多')
    await waitFor('Boolean(document.querySelector("#tools-menu-more"))', 5_000, 'More after malformed settings reload')
    await clickText('設定')
    await waitFor('Boolean(document.querySelector("[data-settings-preference=\\"scannerEnabled\\"]"))', 8_000, 'malformed settings defaults')
    const malformedRecovery = await evaluate(`(() => ({
      scannerEnabled: document.querySelector('[data-settings-preference="scannerEnabled"]')?.getAttribute('aria-pressed') === 'true',
      graphicsPreference: document.querySelector('[data-settings-preference="graphicsPreference"][data-settings-value="auto"]')?.classList.contains('interact-seg__btn--on') ?? false,
    }))()`)
    if (malformedRecovery.scannerEnabled || !malformedRecovery.graphicsPreference) throw new Error(`Malformed settings did not recover to defaults: ${JSON.stringify(malformedRecovery)}`)
    checkpoints.push(await capture('settings-malformed-recovery', 'real malformed v1/v2 recovery to defaults', { observation: malformedRecovery }))
    await clickText('錄製戰鬥回放', '[role="button"]')
    await clickSelector('[data-settings-preference="graphicsPreference"][data-settings-value="high"]')
    await clickSelector('[data-settings-preference="scannerEnabled"]')
    checkpoints.push(await capture('settings', 'real persisted UX preferences with replay recording enabled'))
    await closeTopModal()

    await call('Page.reload', { ignoreCache: true })
    await waitFor('document.readyState === "complete"', 20_000, 'settings persistence reload')
    await waitFor('Boolean(document.querySelector(".title-screen__adventure"))', 15_000, 'Title after settings reload')
    await clickText('更多')
    await waitFor('Boolean(document.querySelector("#tools-menu-more"))', 5_000, 'More after settings reload')
    await clickText('設定')
    await waitFor('Boolean(document.querySelector("[data-settings-preference=\\"scannerEnabled\\"]"))', 8_000, 'reloaded settings')
    if (!(await evaluate('Boolean(document.querySelector("[data-settings-preference=\\"scannerEnabled\\"]")?.getAttribute("aria-pressed") === "true")'))) throw new Error('scannerEnabled did not persist after reload')
    if (!(await exists('[data-settings-preference="graphicsPreference"][data-settings-value="high"].interact-seg__btn--on'))) throw new Error('graphicsPreference did not persist after reload')
    checkpoints.push(await capture('settings-reloaded', 'real v2 settings after page reload'))
    await closeTopModal()
    await forceUnsupportedCamera()
    if (!(await exists('#tools-menu-more'))) await clickText('更多')
    const scannerEntryVisible = await exists('[data-tool="scanner"]')
    await clickText('掃卡')
    await waitFor('Boolean(document.querySelector(".scan-nocam"))', 8_000, 'scanner unsupported fallback')
    scannerOnEvidence = await evaluate(`(() => ({
      scannerVisible: ${JSON.stringify(scannerEntryVisible)},
      scannerChunkLoaded: [...performance.getEntriesByType('resource')].some((entry) => /CardScanner|jsqr/i.test(entry.name)),
      cameraRequests: Number(window.__M24_CAMERA_REQUESTS__ ?? 0),
      fallbackVisible: Boolean(document.querySelector('.scan-nocam')),
    }))()`)
    if (!scannerOnEvidence.scannerVisible || !scannerOnEvidence.scannerChunkLoaded || !scannerOnEvidence.fallbackVisible) {
      throw new Error(`Scanner on fallback boundary failed: ${JSON.stringify(scannerOnEvidence)}`)
    }
    checkpoints.push(await capture('scanner-on-fallback', 'explicit scanner capability fallback', { observation: scannerOnEvidence }))
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
    // Use the newly unlocked account skill through the real battle command
    // deck. The intent returns to playerChoice without advancing the turn.
    await waitFor(`Boolean(document.querySelector('[data-battle-action="partner"][data-partner-skill-id="rally"]:not([disabled])'))`, 12_000, 'unlocked Partner battle action')
    const partnerActionBefore = await evaluate(`(() => ({
      phase: document.querySelector('[data-command-phase]')?.getAttribute('data-command-phase') ?? null,
      action: document.querySelector('[data-battle-action="partner"][data-partner-skill-id="rally"]')?.getAttribute('aria-label') ?? null,
      latestFeed: document.querySelector('.battle-feed__latest-text')?.textContent ?? '',
    }))()`)
    await clickSelector('[data-battle-action="partner"][data-partner-skill-id="rally"]')
    await waitFor(`document.querySelector('[data-command-phase]')?.getAttribute('data-command-phase') === 'playerChoice' && (document.querySelector('.battle-feed__latest-text')?.textContent || '').includes('訓練師加油')`, 20_000, 'Partner result intent')
    const partnerBattleResult = await evaluate(`(() => ({
      beforePhase: ${JSON.stringify(partnerActionBefore.phase)},
      phase: document.querySelector('[data-command-phase]')?.getAttribute('data-command-phase') ?? null,
      latestFeed: document.querySelector('.battle-feed__latest-text')?.textContent ?? '',
      actionUsed: Boolean(document.querySelector('[data-battle-action="partner"][data-partner-skill-id="rally"]')?.disabled),
      actionLabel: document.querySelector('[data-battle-action="partner"][data-partner-skill-id="rally"]')?.getAttribute('aria-label') ?? null,
    }))()`)
    if (partnerBattleResult.beforePhase !== 'playerChoice' || partnerBattleResult.phase !== 'playerChoice' || !partnerBattleResult.latestFeed.includes('訓練師加油') || !partnerBattleResult.actionUsed) throw new Error(`Partner battle intent did not return to legal choice: ${JSON.stringify(partnerBattleResult)}`)
    checkpoints.push(await capture('battle-partner-result', 'real Partner action and non-turn result intent', { observation: partnerBattleResult }))
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
      coverage: { scanner: { reachable: Boolean(scannerOnEvidence), observed: Boolean(scannerOffEvidence && scannerOnEvidence), defaultOff: Boolean(scannerOffEvidence), offHasZeroUiChunkPermission: Boolean(scannerOffEvidence && !scannerOffEvidence.scannerVisible && !scannerOffEvidence.scannerChunkLoaded && scannerOffEvidence.cameraRequests === 0), onFallback: scannerOnEvidence ? 'unsupported' : null, reason: 'Settings v2 keeps the entry absent until explicit enable; the journey then opens the existing lazy scanner and observes its unsupported fallback.' }, customModels: { store: 'mz-models', observed: Boolean(modelDbSignature), zeroAppIo: checkpoints.every((checkpoint) => Object.entries(checkpoint.modelStorage?.io ?? {}).every(([, value]) => Number(value) === 0)), sentinelUnchanged: Boolean(modelDbSignature && checkpoints.every((checkpoint) => JSON.stringify({ keys: checkpoint.modelStorage?.keys, records: checkpoint.modelStorage?.records }) === modelDbSignature)) },
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
    await clearStartupScript()
    return index
  } catch (error) {
    await clearStartupScript()
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
