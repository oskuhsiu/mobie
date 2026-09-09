import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react'
import { ModalSurface } from '@/ui/shell/ModalSurface'
import { useMeta } from '@/store/metaStore'
import { useRoster } from '@/store/rosterStore'
import { currentlyOwnedSpecies, type DexState } from '@/game/meta'
import { computeGrade, GRADE_LABEL, gradeShort, type Grade } from '@/game/grade'
import { getSpecies } from '@/game/data/species'
import { TypeBadges } from '@/ui/components/TypeBadge'
import { TYPE_LABEL_ZH } from '@/ui/typeMeta'
import {
  DEX_PAGE_SIZE,
  DEX_TOTAL,
  dexStateForSpecies,
  filterDexSpecies,
  loadDexCatalog,
  paginateDex,
  type DexFilter,
} from '@/game/dex'
import type { Species } from '@/game/types'

const FILTERS: { id: DexFilter; label: string; hint: string }[] = [
  { id: 'all', label: '全部', hint: '顯示完整 1025 筆圖鑑' },
  { id: 'registered', label: '已登錄', hint: '曾經登錄的物種，包含目前擁有者' },
  { id: 'owned', label: '擁有', hint: '目前庫存中的物種' },
  { id: 'shining', label: '閃耀 Grade（S／SS）', hint: '目前擁有 Grade S 或 SS 的物種' },
]

const STATE_LABEL: Record<DexState, string> = {
  unseen: '未發現',
  seen: '已發現',
  registered: '已登錄',
  owned: '擁有',
}

type DexFixture = 'load-error' | 'artwork-failure' | null

type DexCatalogState =
  | { status: 'ready'; catalog: readonly Species[]; artworkFailure: boolean }
  | { status: 'error'; message: string }

function readDexFixture(): DexFixture {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null
  const query = new URLSearchParams(window.location.search)
  const value = query.get('m24DexFixture') ?? query.get('dexFixture')
  if (value === 'artwork-failure') return value
  if (value === 'load-error' || value === 'error' || value === 'missing') return 'load-error'
  return null
}

function clearDexFixture(): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.delete('m24DexFixture')
  url.searchParams.delete('dexFixture')
  window.history.replaceState({}, '', url)
}

function readDexCatalog(fixture: DexFixture): DexCatalogState {
  try {
    return {
      status: 'ready',
      catalog: loadDexCatalog(fixture === 'load-error'),
      artworkFailure: fixture === 'artwork-failure',
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return {
      status: 'error',
      message: `圖鑑資料目前無法載入：${detail}。可以重新載入，或先關閉圖鑑回到工具。`,
    }
  }
}

function scheduleFrame(callback: () => void): void {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(callback)
  } else {
    callback()
  }
}

function stateCopy(state: DexState): string {
  if (state === 'owned') return '目前擁有這個物種'
  if (state === 'registered') return '曾經登錄，目前沒有擁有個體'
  if (state === 'seen') return '已看過，但尚未登錄'
  return '尚未發現'
}

function gradeCopy(grade: Grade | undefined): string {
  return grade === undefined
    ? 'Grade：尚未擁有個體'
    : `${GRADE_LABEL[grade]}（${gradeShort(grade)}）`
}

function DexArtwork({ species, src, detail = false, silhouette = false }: { species: Species; src: string; detail?: boolean; silhouette?: boolean }) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>(() => src ? 'loading' : 'failed')

  useEffect(() => {
    setState(src ? 'loading' : 'failed')
  }, [src])

  return (
    <div
      className={`dex-artwork ${detail ? 'dex-artwork--detail' : ''} ${silhouette ? 'dex-artwork--silhouette' : ''} dex-artwork--${state}`}
      data-dex-artwork
      data-dex-artwork-state={state}
      aria-busy={state === 'loading' ? 'true' : undefined}
      role={state === 'failed' ? 'img' : undefined}
      aria-label={state === 'failed' ? species.nameZh : undefined}
    >
      {state === 'loading' && <span className="dex-artwork__skeleton" aria-hidden="true" />}
      {state === 'failed' && <span className="dex-artwork__fallback" aria-hidden="true">◇</span>}
      <img
        src={src || undefined}
        alt={state === 'failed' ? '' : species.nameZh}
        loading="lazy"
        draggable={false}
        onLoad={() => setState('loaded')}
        onError={() => setState('failed')}
      />
    </div>
  )
}

function Pagination({
  page,
  pageCount,
  onPage,
}: {
  page: number
  pageCount: number
  onPage: (page: number) => void
}) {
  return (
    <nav className="dex-pagination" aria-label="圖鑑分頁" data-dex-pagination>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        data-dex-page-prev
        disabled={page <= 1}
        aria-label="上一頁"
        onClick={() => onPage(page - 1)}
      >
        ← 上一頁
      </button>
      <ol className="dex-pagination__pages">
        {Array.from({ length: pageCount }, (_, index) => index + 1).map((number) => (
          <li key={number}>
            <button
              type="button"
              className={`btn btn--ghost btn--sm ${number === page ? 'dex-pagination__page--current' : ''}`}
              data-dex-page={number}
              aria-label={`第 ${number} 頁`}
              aria-current={number === page ? 'page' : undefined}
              onClick={() => onPage(number)}
            >
              {number}
            </button>
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        data-dex-page-next
        disabled={page >= pageCount}
        aria-label="下一頁"
        onClick={() => onPage(page + 1)}
      >
        下一頁 →
      </button>
    </nav>
  )
}

function DexDetail({
  species,
  state,
  grade,
  artworkSrc,
  closeRef,
  onClose,
}: {
  species: Species
  state: DexState
  grade: Grade | undefined
  artworkSrc: string
  closeRef: RefObject<HTMLButtonElement>
  onClose: () => void
}) {
  return (
    <aside className="dex-detail" data-dex-detail aria-label={`${species.nameZh} 詳情`}>
      <div className="dex-detail__topline">
        <span className="eyebrow">Dex detail</span>
        <button ref={closeRef} type="button" className="btn btn--ghost btn--sm" data-dex-detail-close aria-label="返回清單" onClick={onClose}>
          ← 返回清單
        </button>
      </div>
      <div className="dex-detail__art-wrap">
        <DexArtwork species={species} src={artworkSrc} detail silhouette={state === 'seen' || state === 'unseen'} />
      </div>
      <div className="dex-detail__heading">
        <span className="dex-detail__number">#{String(species.id).padStart(3, '0')}</span>
        <h3 className="dex-detail__name">{species.nameZh}</h3>
        <p className="dex-detail__english">{species.name}</p>
      </div>
      <div className={`dex-detail__state dex-detail__state--${state}`} data-dex-detail-status>
        <b>{STATE_LABEL[state]}</b>
        <span>{stateCopy(state)}</span>
      </div>
      <section className="dex-detail__section" aria-labelledby="dex-detail-types-heading">
        <h4 id="dex-detail-types-heading">屬性</h4>
        <div className="dex-detail__types" aria-label={`屬性：${species.types.map((type) => TYPE_LABEL_ZH[type]).join('、')}`}>
          <TypeBadges types={species.types} />
        </div>
      </section>
      <section className="dex-detail__section" aria-labelledby="dex-detail-grade-heading">
        <h4 id="dex-detail-grade-heading">Grade</h4>
        <p data-dex-detail-grade>{gradeCopy(grade)}</p>
      </section>
      <p className="dex-detail__hint">登錄與擁有狀態會隨你的本機進度更新。</p>
    </aside>
  )
}

export function DexModal({ onClose }: { onClose: () => void }) {
  const meta = useMeta((s) => s.meta)
  const roster = useRoster((s) => s.roster)
  const initialFixture = useRef<DexFixture>(readDexFixture()).current
  const [catalogState, setCatalogState] = useState<DexCatalogState>(() => readDexCatalog(initialFixture))
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<DexFilter>('all')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null)
  const cellRefs = useRef(new Map<number, HTMLButtonElement>())
  const lastSelectedId = useRef<number | null>(null)
  const selectedScrollTop = useRef(0)
  const focusIntent = useRef<'heading' | 'first' | null>(null)
  const detailCloseRef = useRef<HTMLButtonElement>(null)

  const owned = useMemo(() => currentlyOwnedSpecies(roster), [roster])
  const registered = useMemo(() => new Set(meta.registered), [meta.registered])
  const seen = useMemo(() => new Set(meta.seen), [meta.seen])
  const gradeBySpecies = useMemo(() => {
    const grades = new Map<number, Grade>()
    for (const unit of roster) {
      const grade = computeGrade(unit, getSpecies(unit.speciesId))
      if (grade > (grades.get(unit.speciesId) ?? 0)) grades.set(unit.speciesId, grade)
    }
    return grades
  }, [roster])

  const catalog = catalogState.status === 'ready' ? catalogState.catalog : []
  const registeredCount = useMemo(
    () => catalog.reduce((count, species) => count + (registered.has(species.id) ? 1 : 0), 0),
    [catalog, registered],
  )
  const filtered = useMemo(() => filterDexSpecies(catalog, {
    query,
    filter,
    registered,
    owned,
    gradeBySpecies,
  }), [catalog, filter, gradeBySpecies, owned, query, registered])
  const pageData = useMemo(() => paginateDex(filtered, page, DEX_PAGE_SIZE), [filtered, page])
  const selectedSpecies = selectedId === null ? null : catalog.find((species) => species.id === selectedId) ?? null
  const selectedState = selectedSpecies
    ? dexStateForSpecies(selectedSpecies.id, registered, owned, seen)
    : null
  const selectedGrade = selectedSpecies ? gradeBySpecies.get(selectedSpecies.id) : undefined
  const artworkFailure = catalogState.status === 'ready' && catalogState.artworkFailure

  const scrollOwner = useCallback((): HTMLElement | null => {
    const root = rootRef.current
    return root?.closest<HTMLElement>('[data-modal-body]') ?? null
  }, [])

  const restoreSelectedFocus = useCallback((speciesId: number | null, top: number) => {
    const attempt = (remaining: number) => {
      scheduleFrame(() => {
        const owner = scrollOwner()
        if (owner) owner.scrollTop = top
        const cell = speciesId === null ? null : cellRefs.current.get(speciesId)
        if (cell?.isConnected && !cell.disabled) {
          cell.focus()
          return
        }
        if (remaining > 0 && typeof window !== 'undefined') {
          window.setTimeout(() => attempt(remaining - 1), 80)
          return
        }
        resultsHeadingRef.current?.focus()
      })
    }
    attempt(4)
  }, [scrollOwner])

  const closeDetail = useCallback(() => {
    const speciesId = lastSelectedId.current
    const top = selectedScrollTop.current
    setSelectedId(null)
    restoreSelectedFocus(speciesId, top)
  }, [restoreSelectedFocus])

  const closeSurface = useCallback(() => {
    if (selectedId !== null) {
      closeDetail()
      return
    }
    onClose()
  }, [closeDetail, onClose, selectedId])

  const resetBrowse = useCallback((nextFilter: DexFilter) => {
    setFilter(nextFilter)
    setPage(1)
    setSelectedId(null)
    focusIntent.current = 'heading'
    const owner = scrollOwner()
    if (owner) owner.scrollTop = 0
  }, [scrollOwner])

  const updateQuery = useCallback((value: string) => {
    setQuery(value)
    setPage(1)
    setSelectedId(null)
    focusIntent.current = null
    const owner = scrollOwner()
    if (owner) owner.scrollTop = 0
  }, [scrollOwner])

  const goToPage = useCallback((requestedPage: number) => {
    const next = Math.min(pageData.pageCount, Math.max(1, Math.floor(requestedPage)))
    if (next === pageData.page) return
    setPage(next)
    focusIntent.current = 'first'
    const owner = scrollOwner()
    if (owner) owner.scrollTop = 0
  }, [pageData.page, pageData.pageCount, scrollOwner])

  const openDetail = useCallback((species: Species) => {
    selectedScrollTop.current = scrollOwner()?.scrollTop ?? 0
    lastSelectedId.current = species.id
    focusIntent.current = null
    setSelectedId(species.id)
  }, [scrollOwner])

  const retryCatalog = useCallback(() => {
    clearDexFixture()
    setCatalogState(readDexCatalog(null))
    setPage(1)
    setSelectedId(null)
  }, [])

  useEffect(() => {
    if (page !== pageData.page) {
      setPage(pageData.page)
      focusIntent.current = 'heading'
    }
  }, [page, pageData.page])

  useEffect(() => {
    if (selectedId !== null) return
    const intent = focusIntent.current
    if (!intent) return
    focusIntent.current = null
    scheduleFrame(() => {
      if (intent === 'first') {
        const first = pageData.items[0]
        const cell = first ? cellRefs.current.get(first.id) : null
        if (cell?.isConnected && !cell.disabled) {
          cell.focus()
          return
        }
      }
      resultsHeadingRef.current?.focus()
    })
  }, [filter, pageData.items, pageData.page, query, selectedId])

  useEffect(() => {
    if (selectedId === null) return
    scheduleFrame(() => detailCloseRef.current?.focus())
  }, [selectedId])

  if (catalogState.status === 'error') {
    return (
      <ModalSurface title="📖 圖鑑" description="完整 1–1025 圖鑑資料" onClose={onClose} className="dex-surface">
        <div className="dex-state dex-state--error" data-dex-state="error" role="alert">
          <div className="dex-state__icon" aria-hidden="true">⚠️</div>
          <h3>圖鑑資料需要再試一次</h3>
          <p>{catalogState.message}</p>
          <div className="row dex-state__actions">
            <button type="button" className="btn" data-dex-retry onClick={retryCatalog}>重新載入圖鑑</button>
            <button type="button" className="btn btn--ghost" data-dex-error-close onClick={onClose}>關閉圖鑑</button>
          </div>
        </div>
      </ModalSurface>
    )
  }

  const pageItems = pageData.items
  const countLabel = filtered.length === 0
    ? '目前沒有符合的項目'
    : `顯示 ${pageData.start + 1}–${pageData.end} / ${filtered.length}`
  const selectedArtwork = selectedSpecies
    ? artworkFailure ? '/__m24__/missing-dex-artwork.png' : selectedSpecies.artworkUrl
    : ''
  const moveCellFocus = (speciesId: number, offset: number) => {
    const index = pageItems.findIndex((species) => species.id === speciesId)
    const target = pageItems[index + offset]
    if (!target) return
    const cell = cellRefs.current.get(target.id)
    if (cell?.isConnected && !cell.disabled) cell.focus()
  }
  const handleCellKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, speciesId: number) => {
    const index = pageItems.findIndex((species) => species.id === speciesId)
    if (index < 0) return
    let offset: number | null = null
    if (event.key === 'ArrowRight') offset = 1
    if (event.key === 'ArrowLeft') offset = -1
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const grid = rootRef.current?.querySelector<HTMLElement>('[data-dex-grid]')
      const columns = grid
        ? Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length)
        : 1
      offset = event.key === 'ArrowDown' ? columns : -columns
    }
    if (event.key === 'Home') offset = -index
    if (event.key === 'End') offset = pageItems.length - 1 - index
    if (offset === null) return
    const target = pageItems[index + offset]
    if (!target) return
    event.preventDefault()
    moveCellFocus(speciesId, offset)
  }

  return (
    <ModalSurface
      title="📖 圖鑑"
      description={`已登錄 ${registeredCount} / ${DEX_TOTAL}　擁有 ${owned.size} 種`}
      onClose={closeSurface}
      className="dex-surface"
      footer={<div className="utility-foot">完整 1–1025 圖鑑資料；每頁最多 {DEX_PAGE_SIZE} 筆，圖片載入失敗會顯示替代圖像。</div>}
    >
      <div
        ref={rootRef}
        className="dex-layout"
        data-dex-root
        data-dex-state="ready"
        data-dex-total={catalog.length}
        data-dex-visible={filtered.length}
        data-dex-page={pageData.page}
        data-dex-page-count={pageData.pageCount}
        data-dex-page-size={DEX_PAGE_SIZE}
        data-dex-dom-cap={pageItems.length}
        data-dex-detail-open={selectedSpecies ? 'true' : 'false'}
      >
        <section className="dex-browser" aria-label="圖鑑清單">
          <div className="dex-controls">
            <label className="dex-search">
              <span className="dex-search__label">搜尋名稱或編號</span>
              <input
                className="utility-search"
                type="search"
                value={query}
                aria-label="搜尋圖鑑名稱或編號"
                placeholder="例如：妙蛙、Bulbasaur、001…"
                onChange={(event) => updateQuery(event.target.value)}
              />
            </label>
            <div className="dex-filter-group" role="group" aria-label="圖鑑篩選" data-dex-filters>
              {FILTERS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`chip ${filter === option.id ? 'chip--on' : ''}`}
                  data-dex-filter={option.id}
                  aria-pressed={filter === option.id}
                  title={option.hint}
                  onClick={() => resetBrowse(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="dex-results-head">
            <div>
              <div className="eyebrow">National Dex · {catalog.length} entries</div>
              <h3 ref={resultsHeadingRef} className="dex-results-heading" tabIndex={-1} data-dex-results-heading>
                {countLabel}
              </h3>
            </div>
            <span className="dex-results-status" role="status" aria-live="polite">第 {pageData.page} / {pageData.pageCount} 頁</span>
          </div>

          {pageItems.length > 0 ? (
            <div className="dex-grid" data-dex-grid>
              {pageItems.map((species) => {
                const state = dexStateForSpecies(species.id, registered, owned, seen)
                const grade = gradeBySpecies.get(species.id)
                const artworkSrc = artworkFailure ? '/__m24__/missing-dex-artwork.png' : species.artworkUrl
                return (
                  <button
                    key={species.id}
                    ref={(element) => {
                      if (element) cellRefs.current.set(species.id, element)
                      else cellRefs.current.delete(species.id)
                    }}
                    type="button"
                    className={`dex-cell dex-cell--${state}`}
                    data-dex-cell
                    data-dex-species-id={species.id}
                    data-dex-state={state}
                    aria-label={`#${String(species.id).padStart(3, '0')} ${species.nameZh}，${STATE_LABEL[state]}${grade ? `，Grade ${gradeShort(grade)}` : ''}`}
                    onKeyDown={(event) => handleCellKeyDown(event, species.id)}
                    onClick={() => openDetail(species)}
                  >
                    <span className="dex-cell__no">#{String(species.id).padStart(3, '0')}</span>
                    <DexArtwork species={species} src={artworkSrc} silhouette={state === 'seen' || state === 'unseen'} />
                    <span className="dex-cell__name">{species.nameZh}</span>
                    <span className="dex-cell__state">{STATE_LABEL[state]}</span>
                    <span className="dex-cell__types" aria-label={`屬性 ${species.types.map((type) => TYPE_LABEL_ZH[type]).join('、')}`}>
                      <TypeBadges types={species.types} />
                    </span>
                    {grade && <span className="dex-cell__grade">Grade {gradeShort(grade)}</span>}
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="dex-state dex-state--empty" data-dex-state="empty" role="status">
              <div className="dex-state__icon" aria-hidden="true">⌕</div>
              <h3>找不到符合的 Mobie</h3>
              <p>{query.trim() ? `「${query.trim()}」沒有對應的名稱或編號。` : '這個篩選目前沒有已登錄的項目。'}</p>
              <div className="row dex-state__actions">
                {(query.trim() || filter !== 'all') && <button type="button" className="btn" data-dex-clear onClick={() => { setQuery(''); resetBrowse('all') }}>清除搜尋與篩選</button>}
                {filter !== 'all' && <button type="button" className="btn btn--ghost" onClick={() => resetBrowse('all')}>顯示全部</button>}
              </div>
            </div>
          )}

          <Pagination page={pageData.page} pageCount={pageData.pageCount} onPage={goToPage} />
        </section>

        {selectedSpecies && selectedState && (
          <DexDetail
            species={selectedSpecies}
            state={selectedState}
            grade={selectedGrade}
            artworkSrc={selectedArtwork}
            closeRef={detailCloseRef}
            onClose={closeDetail}
          />
        )}
      </div>
    </ModalSurface>
  )
}
