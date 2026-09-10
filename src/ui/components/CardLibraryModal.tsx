import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import QRCode from 'qrcode'
import { getSpecies } from '@/game/data/species'
import { SPECIES_SORTED, matchesSpecies } from '@/game/data/speciesQuery'
import {
  addCards,
  CARD_LIBRARY_OWNER,
  CardLibraryError,
  inferCardSource,
  listCards,
  deleteCard,
  subscribeCards,
} from '@/game/cardLibrary'
import { parseCardsImport } from '@/game/cardsImport'
import { makeCardCode } from '@/game/cardCode'
import { audio } from '@/audio/audioEngine'
import { MobieSprite } from '@/ui/components/MobieSprite'
import type { Card, CardSource } from '@/game/types'
import { ModalSurface } from '@/ui/shell/ModalSurface'
import { useOverlayController } from '@/ui/shell/OverlayController'

type Panel = 'none' | 'add' | 'import'
type LibraryState = 'loading' | 'ready' | 'empty' | 'error'
type Notice = { tone: 'status' | 'error'; text: string }

// A pushed delete confirmation temporarily unmounts the library surface. Keep
// one short-lived success message outside that surface so the returned list can
// announce the completed mutation without adding an undo stack or another store.
let pendingLibraryNotice: Notice | null = null
let cachedCards: Card[] = []

const SOURCE_LABEL: Record<CardSource, string> = {
  starter: '起始卡',
  manual: '手動建立',
  import: '手動匯入',
}

function sourceLabel(card: Card): string {
  return SOURCE_LABEL[card.source ?? inferCardSource(card.cardId)]
}

function createdLabel(createdAt: number | undefined): { text: string; dateTime?: string } {
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt) || createdAt <= 0) {
    return { text: '時間未記錄（舊卡）' }
  }
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return { text: '時間未記錄（舊卡）' }
  return {
    text: new Intl.DateTimeFormat('zh-TW', {
      year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(date),
    dateTime: date.toISOString(),
  }
}

function cardMutationMessage(cause: unknown, fallback: string): string {
  if (cause instanceof CardLibraryError) return cause.message
  if (cause instanceof Error && cause.message) return `${fallback}：${cause.message}`
  return fallback
}

function cardFocus(cardId: string): HTMLElement | null {
  const candidates = [...document.querySelectorAll<HTMLElement>('[data-card-detail-invoker]')]
  return candidates.find((element) => element.dataset.cardDetailInvoker === cardId)
    ?? candidates[0]
    ?? null
}

function cardDeleteFocus(cardId: string): HTMLElement | null {
  const candidates = [...document.querySelectorAll<HTMLElement>('[data-card-delete]')]
  return candidates.find((element) => element.dataset.cardDelete === cardId)
    ?? cardFocus(cardId)
}

/** 卡庫管理：檢視、匯入（JSON/CSV）、新增自製卡、產生可列印 QR。 */
export function CardLibraryModal({ onClose }: { onClose: () => void }) {
  const [cards, setCards] = useState<Card[]>(() => cachedCards)
  const [state, setState] = useState<LibraryState>(() => cachedCards.length > 0 ? 'ready' : 'loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [panel, setPanel] = useState<Panel>('none')
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState<Notice | null>(() => pendingLibraryNotice)
  const noticeRef = useRef<HTMLDivElement>(null)
  const aliveRef = useRef(true)
  const controller = useOverlayController()

  useEffect(() => {
    pendingLibraryNotice = null
  }, [])

  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  const loadCards = useCallback(async (showLoading = false) => {
    if (showLoading) setState('loading')
    try {
      const next = await listCards()
      if (!aliveRef.current) return
      cachedCards = next
      setCards(next)
      setLoadError(null)
      setState(next.length > 0 ? 'ready' : 'empty')
    } catch (cause) {
      if (!aliveRef.current) return
      setLoadError(cardMutationMessage(cause, '卡庫資料暫時無法載入，請再試一次。'))
      setState('error')
    }
  }, [])

  useEffect(() => {
    void loadCards(cachedCards.length === 0)
    return subscribeCards(() => { void loadCards() })
  }, [loadCards])

  const announce = useCallback((next: Notice) => {
    setNotice(next)
  }, [])

  useEffect(() => {
    if (!notice) return
    const focus = () => noticeRef.current?.focus()
    const frame = requestAnimationFrame(focus)
    const timers = [120, 320, 700].map((delay) => window.setTimeout(focus, delay))
    return () => {
      cancelAnimationFrame(frame)
      timers.forEach((timer) => window.clearTimeout(timer))
    }
  }, [notice])

  const filteredCards = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return cards
    return cards.filter((card) => {
      const species = getSpecies(card.speciesId)
      return `${species.nameZh} ${species.name} ${species.id} ${card.cardId}`.toLocaleLowerCase().includes(needle)
    })
  }, [cards, query])

  const openQr = useCallback((card: Card, restoreFocus?: () => HTMLElement | null) => {
    controller.push({
      id: `card-qr:${card.cardId}`,
      policy: 'escape-and-backdrop',
      content: <QrOverlay card={card} onClose={controller.pop} />,
    }, {
      restoreFocus: restoreFocus ?? (() => cardFocus(card.cardId)),
    })
  }, [controller])

  const openDetail = useCallback((card: Card) => {
    controller.push({
      id: `card-detail:${card.cardId}`,
      policy: 'escape-and-backdrop',
      content: (
        <CardDetailOverlay
          card={card}
          onClose={controller.pop}
          onOpenQr={() => openQr(card, () => document.querySelector<HTMLElement>('[data-card-detail-qr]'))}
          onDelete={() => openDeleteOverlay(controller, card, 'detail')}
        />
      ),
    }, { restoreFocus: () => cardFocus(card.cardId) })
  }, [controller, openQr])

  const onSaved = useCallback((text: string) => {
    setPanel('none')
    announce({ tone: 'status', text })
  }, [announce])

  const onActionError = useCallback((cause: unknown, fallback: string) => {
    announce({ tone: 'error', text: cardMutationMessage(cause, fallback) })
  }, [announce])

  const openDelete = useCallback((card: Card) => {
    openDeleteOverlay(controller, card, 'library')
  }, [controller])

  const description = state === 'loading' ? '正在載入卡庫…' : `${cards.length} 張卡。建立、匯入、查看卡片，或產生可列印的 QR。`
  const libraryState = state === 'ready' && filteredCards.length === 0 ? 'filtered-empty' : state

  return (
    <ModalSurface
      title="🗂 卡庫"
      description={description}
      onClose={onClose}
      className="card-library-surface"
      footer={<div className="utility-foot">卡片資料存在這台裝置的 IndexedDB。每張卡都會顯示持有人、來源與建立時間；QR 只作為卡片識別與列印備份。</div>}
    >
      <div className="card-library" data-card-library data-card-library-state={libraryState}>
        <div className="card-library__actions" data-card-library-actions>
          <button
            className={`btn btn--sm ${panel === 'add' ? '' : 'btn--ghost'}`}
            data-card-library-create
            onClick={() => setPanel(panel === 'add' ? 'none' : 'add')}
          >➕ 新增自製卡</button>
          <button
            className={`btn btn--sm ${panel === 'import' ? '' : 'btn--ghost'}`}
            data-card-library-import
            onClick={() => setPanel(panel === 'import' ? 'none' : 'import')}
          >📥 匯入 JSON/CSV</button>
        </div>

        {notice && (
          <div
            ref={noticeRef}
            className={`card-library__notice card-library__notice--${notice.tone}`}
            data-card-library-feedback={notice.tone}
            role={notice.tone === 'error' ? 'alert' : 'status'}
            aria-live={notice.tone === 'error' ? 'assertive' : 'polite'}
            tabIndex={-1}
          >{notice.text}</div>
        )}

        <AnimatePresence mode="wait">
          {panel === 'add' && (
            <AddCardPanel
              key="add"
              existing={cards}
              onSaved={(card) => onSaved(`已建立 ${getSpecies(card.speciesId).nameZh} Lv.${card.level}（#${card.cardId}）。`)}
              onError={(cause) => onActionError(cause, '卡片建立失敗，資料未變更。')}
            />
          )}
          {panel === 'import' && (
            <ImportPanel
              key="import"
              onSaved={(count) => onSaved(`已匯入 ${count} 張卡。`)}
              onError={(cause, fallback) => onActionError(cause, fallback)}
            />
          )}
        </AnimatePresence>

        {state === 'loading' && (
          <div className="card-library__state" role="status" data-card-library-loading>
            <div className="eyebrow">Card Library</div>
            <h3>正在載入卡庫…</h3>
            <p>正在讀取本機卡片資料，請稍候。</p>
          </div>
        )}

        {state === 'error' && (
          <div className="card-library__state card-library__state--error" role="alert" data-card-library-error>
            <div className="eyebrow">Card Library</div>
            <h3>卡庫暫時無法載入</h3>
            <p>{loadError ?? '資料讀取失敗，既有卡片未被修改。'}</p>
            <button className="btn btn--sm" data-card-library-retry onClick={() => void loadCards(true)}>重新載入</button>
          </div>
        )}

        {state === 'empty' && (
          <div className="card-library__state" data-card-library-empty>
            <div className="eyebrow">Card Library</div>
            <h3>卡庫是空的</h3>
            <p>先建立自製卡或匯入 JSON／CSV；完成後卡片會留在這台裝置。</p>
            <div className="card-library__empty-actions">
              <button className="btn btn--sm" onClick={() => setPanel('add')}>建立第一張卡</button>
              <button className="btn btn--ghost btn--sm" onClick={() => setPanel('import')}>匯入卡片</button>
            </div>
          </div>
        )}

        {state === 'ready' && (
          <div className="card-library__content" data-card-library-content>
            <div className="card-library__list-head">
              <label className="card-library__search">
                <span className="sr-only">搜尋卡庫</span>
                <input
                  className="utility-search"
                  type="search"
                  value={query}
                  placeholder="搜尋名稱、編號或 card ID…"
                  aria-label="搜尋卡庫"
                  data-card-library-search
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <span className="card-library__count" data-card-library-count>顯示 {filteredCards.length} / {cards.length}</span>
            </div>
            {filteredCards.length > 0 ? (
              <div className="card-library__list" data-card-library-list role="list" aria-label="卡庫清單">
                {filteredCards.map((card) => (
                  <CardLibraryRow
                    key={card.cardId}
                    card={card}
                    onDetail={() => openDetail(card)}
                    onQr={() => openQr(card)}
                    onDelete={() => openDelete(card)}
                  />
                ))}
              </div>
            ) : (
              <div className="card-library__no-results" data-card-library-no-results>找不到符合「{query}」的卡片。</div>
            )}
          </div>
        )}
      </div>
    </ModalSurface>
  )
}

function CardLibraryRow({ card, onDetail, onQr, onDelete }: {
  card: Card
  onDetail: () => void
  onQr: () => void
  onDelete: () => void
}) {
  const species = getSpecies(card.speciesId)
  const created = createdLabel(card.createdAt)
  return (
    <article className="utility-row card-library-row" data-card-row data-card-id={card.cardId} role="listitem">
      <button
        className="card-library-row__main"
        data-card-detail-invoker={card.cardId}
        aria-label={`${species.nameZh} Lv.${card.level}，查看卡片詳情`}
        onClick={onDetail}
      >
        <MobieSprite src={species.artworkUrl} alt={species.nameZh} shiny={card.shiny} className="card-library-row__art" />
        <span className="card-library-row__copy">
          <span className="card-library-row__name">{species.nameZh} <span className="utility-row__id">Lv.{card.level}</span></span>
          <span className="card-library-row__identity">#{card.cardId}{card.shiny ? '　✦異色' : ''}</span>
          <span className="card-library-row__facts">
            <span>持有人：{card.owner || CARD_LIBRARY_OWNER}</span>
            <span>來源：{sourceLabel(card)}</span>
            <time dateTime={created.dateTime}>建立：{created.text}</time>
          </span>
        </span>
        <span className="card-library-row__hint" aria-hidden="true">詳情 ›</span>
      </button>
      <div className="card-library-row__actions">
        <button className="btn btn--ghost btn--sm" data-card-qr-invoker={card.cardId} aria-label={`${species.nameZh} 產生 QR`} onClick={onQr}>QR</button>
        <button className="btn btn--danger btn--sm" data-card-delete={card.cardId} aria-label={`刪除 ${species.nameZh} 卡片 #${card.cardId}`} onClick={onDelete}>刪除</button>
      </div>
    </article>
  )
}

/** 新增自製卡：選 Mobie + 等級 → 產生 cardId 存入卡庫。 */
function AddCardPanel({ existing, onSaved, onError }: {
  existing: Card[]
  onSaved: (card: Card) => void
  onError: (cause: unknown) => void
}) {
  const [q, setQ] = useState('')
  const [level, setLevel] = useState(15)
  const [shiny, setShiny] = useState(false)
  const [busy, setBusy] = useState(false)
  const matches = useMemo(() => {
    const s = q.trim()
    return (s ? SPECIES_SORTED.filter((sp) => matchesSpecies(sp, s)) : SPECIES_SORTED).slice(0, 8)
  }, [q])

  const add = async (speciesId: number) => {
    if (busy) return
    const lv = Math.max(1, Math.min(100, Math.round(Number.isFinite(level) ? level : 15)))
    const base = `SELF-${speciesId}-L${lv}`
    let n = 1
    while (existing.some((card) => card.cardId === `${base}-${n}`)) n++
    const card: Card = { cardId: `${base}-${n}`, speciesId, level: lv, ...(shiny ? { shiny: true } : {}) }
    setBusy(true)
    try {
      await addCards([card], 'manual')
      audio.play('select')
      onSaved(card)
    } catch (cause) {
      audio.play('defeat')
      onError(cause)
    } finally {
      setBusy(false)
    }
  }

  return (
    <motion.div className="lib-panel card-library-panel" data-card-library-add-panel initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
      <div className="card-library-panel__heading">
        <div>
          <div className="eyebrow">Create</div>
          <h3>建立一張自製卡</h3>
        </div>
        <span className="lib-hint">選擇 Mobie 後立即保存</span>
      </div>
      <label className="card-library-panel__search">
        <span className="sr-only">搜尋要建立的 Mobie</span>
        <input className="utility-search" aria-label="搜尋要建立的 Mobie" placeholder="搜尋 Mobie 名稱／編號…" value={q} onChange={(event) => setQ(event.target.value)} disabled={busy} />
      </label>
      <div className="row card-library-panel__options">
        <label className="lib-level">等級
          <input type="number" min={1} max={100} value={level} onChange={(event) => setLevel(Number(event.target.value))} disabled={busy} />
        </label>
        <label className="lib-shiny"><input type="checkbox" checked={shiny} onChange={(event) => setShiny(event.target.checked)} disabled={busy} /> 異色</label>
      </div>
      <div className="lib-matches" data-card-library-species-list role="list" aria-label="可建立的 Mobie">
        {matches.map((species) => (
          <button key={species.id} className="lib-match" data-card-library-species={species.id} onClick={() => void add(species.id)} disabled={busy}>
            <MobieSprite src={species.artworkUrl} alt={species.nameZh} />
            <span>{species.nameZh} <span className="utility-row__id">#{species.id}</span></span>
          </button>
        ))}
        {matches.length === 0 && <div className="card-library__no-results">找不到符合的 Mobie。</div>}
      </div>
      {busy && <div className="lib-inline-status" role="status">正在保存卡片…</div>}
    </motion.div>
  )
}

/** 匯入卡庫：貼上或選檔（JSON/CSV）。 */
function ImportPanel({ onSaved, onError }: {
  onSaved: (count: number) => void
  onError: (cause: unknown, fallback: string) => void
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const errorRef = useRef<HTMLDivElement>(null)

  const showError = (message: string) => {
    setError(message)
  }

  useEffect(() => {
    if (!error) return
    const frame = requestAnimationFrame(() => errorRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [error])

  const doImport = async (raw: string) => {
    if (busy) return
    setError(null)
    const result = parseCardsImport(raw)
    if (result.errors.length > 0) {
      showError(`匯入未完成：${result.errors.slice(0, 4).join('；')}${result.errors.length > 4 ? '…' : ''}`)
      return
    }
    if (result.cards.length === 0) {
      showError('匯入未完成：沒有可匯入的卡片。')
      return
    }
    setBusy(true)
    try {
      const stored = await addCards(result.cards, 'import')
      audio.play('select')
      onSaved(stored.length)
    } catch (cause) {
      audio.play('defeat')
      const fallback = cause instanceof CardLibraryError && cause.code === 'duplicate-card'
        ? '匯入未完成：有 cardId 已存在，既有卡片未被覆寫。'
        : '匯入未完成，既有卡片未被修改。'
      onError(cause, fallback)
    } finally {
      setBusy(false)
    }
  }

  return (
    <motion.div className="lib-panel card-library-panel" data-card-library-import-panel initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
      <div className="card-library-panel__heading">
        <div>
          <div className="eyebrow">Import</div>
          <h3>匯入卡片資料</h3>
        </div>
        <span className="lib-hint">錯誤會保留在這裡，既有卡片不變</span>
      </div>
      <label className="sr-only" htmlFor="card-library-import-text">貼上卡片 JSON 或 CSV</label>
      <textarea
        id="card-library-import-text"
        className="lib-textarea"
        data-card-import-input
        aria-label="貼上卡片 JSON 或 CSV"
        placeholder={'貼上 JSON：[ {"cardId":"A1","speciesId":25,"level":12} ]\n或 CSV：cardId,speciesId,level（首列為表頭）'}
        value={text}
        onChange={(event) => setText(event.target.value)}
        disabled={busy}
      />
      <div className="row card-library-panel__import-actions">
        <button className="btn btn--sm" data-card-import-submit onClick={() => void doImport(text)} disabled={busy || !text.trim()}>匯入貼上內容</button>
        <label className="btn btn--ghost btn--sm" data-card-import-file-label>
          選檔…
          <input
            type="file"
            accept=".json,.csv,text/*"
            data-card-import-file
            hidden
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void file.text().then((contents) => doImport(contents)).catch((cause) => onError(cause, '檔案讀取失敗，請再選一次。'))
              event.target.value = ''
            }}
          />
        </label>
      </div>
      {busy && <div className="lib-inline-status" role="status">正在檢查並保存卡片…</div>}
      {error && <div ref={errorRef} className="lib-msg card-library__import-error" data-card-import-error role="alert" tabIndex={-1}>{error}</div>}
    </motion.div>
  )
}

function openDeleteOverlay(controller: ReturnType<typeof useOverlayController>, card: Card, from: 'library' | 'detail'): void {
  controller.push({
    id: `card-delete:${card.cardId}`,
    policy: 'escape-and-backdrop',
    content: (
      <DeleteCardOverlay
        card={card}
        onCancel={controller.pop}
        onDeleted={() => {
          controller.pop()
          if (from === 'detail') controller.pop()
        }}
      />
    ),
  }, {
    restoreFocus: () => from === 'detail'
      ? document.querySelector<HTMLElement>('[data-card-detail-delete]')
      : cardDeleteFocus(card.cardId),
  })
}

function DeleteCardOverlay({ card, onCancel, onDeleted }: {
  card: Card
  onCancel: () => void
  onDeleted: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const errorRef = useRef<HTMLDivElement>(null)
  const species = getSpecies(card.speciesId)

  const confirm = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await deleteCard(card.cardId)
      audio.play('select')
      pendingLibraryNotice = { tone: 'status', text: `已刪除 ${species.nameZh} Lv.${card.level}（#${card.cardId}）。` }
      onDeleted()
    } catch (cause) {
      audio.play('defeat')
      const message = cardMutationMessage(cause, '刪除失敗，卡片仍保留在卡庫。')
      setError(message)
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!error) return
    const frame = requestAnimationFrame(() => errorRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [error])

  return (
    <ModalSurface
      title="確認刪除卡片"
      description="這個動作會從本機卡庫移除卡片，且本票不提供復原或 undo。"
      onClose={onCancel}
      policy="escape-and-backdrop"
      className="card-confirm-surface"
      restoreFocus={false}
      footer={(
        <div className="card-confirm__actions">
          <button className="btn btn--ghost" data-card-delete-cancel onClick={onCancel} disabled={busy}>取消</button>
          <button className="btn btn--danger" data-card-delete-confirm onClick={() => void confirm()} disabled={busy}>
            {busy ? '刪除中…' : '確認刪除'}
          </button>
        </div>
      )}
    >
      <div className="card-confirm" data-card-delete-dialog data-card-id={card.cardId}>
        <MobieSprite src={species.artworkUrl} alt={species.nameZh} shiny={card.shiny} className="card-confirm__art" />
        <div className="card-confirm__identity">
          <strong>{species.nameZh} Lv.{card.level}</strong>
          <span>卡片 ID：#{card.cardId}</span>
          <span>持有人：{card.owner || CARD_LIBRARY_OWNER}</span>
        </div>
        {error && <div ref={errorRef} className="card-library__import-error" data-card-delete-error role="alert" tabIndex={-1}>{error}</div>}
      </div>
    </ModalSurface>
  )
}

function CardDetailOverlay({ card, onClose, onOpenQr, onDelete }: {
  card: Card
  onClose: () => void
  onOpenQr: () => void
  onDelete: () => void
}) {
  const species = getSpecies(card.speciesId)
  const created = createdLabel(card.createdAt)
  const individual = card.ivs
    ? Object.entries(card.ivs).map(([key, value]) => `${key.toUpperCase()} ${value}`).join(' · ')
    : '依 card ID 決定論產生'
  return (
    <ModalSurface
      title={`${species.nameZh} Lv.${card.level}`}
      description="卡片詳情與本機 provenance"
      onClose={onClose}
      className="card-detail-surface"
      headerLeading={<MobieSprite src={species.artworkUrl} alt={species.nameZh} shiny={card.shiny} className="card-detail__art" />}
      footer={(
        <div className="card-detail__actions">
          <button className="btn btn--sm" data-card-detail-qr onClick={onOpenQr}>顯示 QR</button>
          <button className="btn btn--danger" data-card-detail-delete onClick={onDelete}>刪除卡片</button>
        </div>
      )}
    >
      <div className="card-detail" data-card-detail data-card-id={card.cardId}>
        <div className="card-detail__identity">
          <span className="eyebrow">Card Identity</span>
          <strong>#{card.cardId}</strong>
          {card.shiny && <span className="card-detail__shiny">✦ 異色</span>}
        </div>
        <dl className="card-detail__facts">
          <div><dt>持有人</dt><dd>{card.owner || CARD_LIBRARY_OWNER}</dd></div>
          <div><dt>來源</dt><dd>{sourceLabel(card)}</dd></div>
          <div><dt>建立時間</dt><dd><time dateTime={created.dateTime}>{created.text}</time></dd></div>
          <div><dt>物種編號</dt><dd>#{species.id} · {species.name}</dd></div>
          <div><dt>個體值</dt><dd>{individual}</dd></div>
          <div><dt>性格</dt><dd>{typeof card.nature === 'number' ? `Nature #${card.nature}` : '依 card ID 決定論產生'}</dd></div>
        </dl>
      </div>
    </ModalSurface>
  )
}

/** 顯示一張卡的可列印 QR + 卡碼。 */
function QrOverlay({ card, onClose }: { card: Card; onClose: () => void }) {
  const code = makeCardCode(card.cardId)
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const sp = getSpecies(card.speciesId)

  useEffect(() => {
    let alive = true
    setDataUrl(null)
    setError(false)
    QRCode.toDataURL(code, { margin: 1, width: 260, errorCorrectionLevel: 'M' })
      .then((url) => { if (alive) setDataUrl(url) })
      .catch(() => { if (alive) setError(true) })
    return () => { alive = false }
  }, [code])

  return (
    <ModalSurface title={`${sp.nameZh} Lv.${card.level} · QR`} description={`卡片 ID：#${card.cardId}`} onClose={onClose} className="qr-surface">
      <div className="qr-card" data-card-qr>
        {dataUrl ? <img className="qr-card__img" src={dataUrl} alt={`${sp.nameZh} 卡片 QR`} /> : error ? <div className="qr-card__img qr-card__img--error" role="alert">QR 產生失敗，請關閉後再試一次。</div> : <div className="qr-card__img qr-card__img--loading" role="status">QR 產生中…</div>}
        <div className="qr-card__code" data-card-code>{code}</div>
        <div className="qr-card__hint">列印或保存此 QR 作為卡片識別備份。</div>
        <div className="row" style={{ gap: 8, justifyContent: 'center' }}>
          <button className="btn btn--sm" data-card-print onClick={() => window.print()}>列印</button>
        </div>
      </div>
    </ModalSurface>
  )
}
