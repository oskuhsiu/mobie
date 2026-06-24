import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import QRCode from 'qrcode'
import { getSpecies } from '@/game/data/species'
import { SPECIES_SORTED, matchesSpecies } from '@/game/data/speciesQuery'
import { listCards, putCards, deleteCard, subscribeCards } from '@/game/cardLibrary'
import { parseCardsImport } from '@/game/cardsImport'
import { makeCardCode } from '@/game/cardCode'
import { audio } from '@/audio/audioEngine'
import type { Card } from '@/game/types'

type Panel = 'none' | 'add' | 'import'

/** 卡庫管理：檢視、匯入（JSON/CSV）、新增自製卡、產生可列印 QR。 */
export function CardLibraryModal({ onClose }: { onClose: () => void }) {
  const [cards, setCards] = useState<Card[]>([])
  const [panel, setPanel] = useState<Panel>('none')
  const [qrCard, setQrCard] = useState<Card | null>(null)

  useEffect(() => {
    let alive = true
    const refresh = () => listCards().then((c) => { if (alive) setCards(c) })
    refresh()
    return subscribeCards(() => { if (alive) refresh() })
  }, [])

  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="modal-card"
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 24, scale: 0.97 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-card__head">
          <div>
            <div className="h-title" style={{ fontSize: 24 }}>🗂 卡庫</div>
            <div className="h-sub">{cards.length} 張卡。匯入清單、新增自製卡，或產生可列印的 QR。</div>
          </div>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>關閉</button>
        </div>

        <div className="row" style={{ gap: 8 }}>
          <button className={`btn btn--sm ${panel === 'add' ? '' : 'btn--ghost'}`} onClick={() => setPanel(panel === 'add' ? 'none' : 'add')}>➕ 新增自製卡</button>
          <button className={`btn btn--sm ${panel === 'import' ? '' : 'btn--ghost'}`} onClick={() => setPanel(panel === 'import' ? 'none' : 'import')}>📥 匯入 JSON/CSV</button>
        </div>

        <AnimatePresence mode="wait">
          {panel === 'add' && <AddCardPanel key="add" existing={cards} onDone={() => setPanel('none')} />}
          {panel === 'import' && <ImportPanel key="import" onDone={() => setPanel('none')} />}
        </AnimatePresence>

        <div className="model-list scroll">
          {cards.map((c) => {
            const sp = getSpecies(c.speciesId)
            return (
              <div className="model-row" key={c.cardId}>
                <img className="model-row__art" src={sp.artworkUrl} alt={sp.nameZh} loading="lazy" draggable={false} />
                <div className="model-row__meta">
                  <div className="model-row__name">{sp.nameZh} <span className="model-row__id">Lv.{c.level}</span></div>
                  <div className="model-row__status">#{c.cardId}{c.shiny ? '　✦異色' : ''}</div>
                </div>
                <button
                  className="btn btn--ghost btn--sm lib-del"
                  onClick={() => { if (window.confirm(`刪除卡片 ${sp.nameZh}（#${c.cardId}）？`)) void deleteCard(c.cardId) }}
                >
                  刪除
                </button>
                <button className="btn btn--sm" onClick={() => setQrCard(c)}>QR</button>
              </div>
            )
          })}
          {cards.length === 0 && <div className="model-empty">卡庫是空的，先新增或匯入卡。</div>}
        </div>

        <div className="model-foot">卡庫存在你這台瀏覽器（IndexedDB）。掃卡時以 cardId 反查這裡。</div>
      </motion.div>

      <AnimatePresence>
        {qrCard && <QrOverlay card={qrCard} onClose={() => setQrCard(null)} />}
      </AnimatePresence>
    </motion.div>
  )
}

/** 新增自製卡：選Mobie + 等級 → 產生 cardId 存入卡庫。 */
function AddCardPanel({ existing, onDone }: { existing: Card[]; onDone: () => void }) {
  const [q, setQ] = useState('')
  const [level, setLevel] = useState(15)
  const [shiny, setShiny] = useState(false)
  const matches = useMemo(() => {
    const s = q.trim()
    return (s ? SPECIES_SORTED.filter((sp) => matchesSpecies(sp, s)) : SPECIES_SORTED).slice(0, 8)
  }, [q])

  const add = async (speciesId: number) => {
    const lv = Math.max(1, Math.min(100, Math.round(level)))
    // 產生穩定且不撞號的 cardId
    const base = `SELF-${speciesId}-L${lv}`
    let n = 1
    while (existing.some((c) => c.cardId === `${base}-${n}`)) n++
    const card: Card = { cardId: `${base}-${n}`, speciesId, level: lv }
    if (shiny) card.shiny = true
    await putCards([card])
    audio.play('select')
    onDone()
  }

  return (
    <motion.div className="lib-panel" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
      <input className="model-search" placeholder="搜尋Mobie名稱/編號…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="row" style={{ gap: 14, alignItems: 'center' }}>
        <label className="lib-level">Lv.
          <input type="number" min={1} max={100} value={level} onChange={(e) => setLevel(Number(e.target.value))} />
        </label>
        <label className="lib-shiny"><input type="checkbox" checked={shiny} onChange={(e) => setShiny(e.target.checked)} /> 異色</label>
        <span className="lib-hint">點下方Mobie即新增</span>
      </div>
      <div className="lib-matches">
        {matches.map((sp) => (
          <button key={sp.id} className="lib-match" onClick={() => void add(sp.id)}>
            <img src={sp.artworkUrl} alt={sp.nameZh} loading="lazy" />
            <span>{sp.nameZh} <span className="model-row__id">#{sp.id}</span></span>
          </button>
        ))}
      </div>
    </motion.div>
  )
}

/** 匯入卡庫：貼上或選檔（JSON/CSV）。 */
function ImportPanel({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  const doImport = async (raw: string) => {
    const { cards, errors } = parseCardsImport(raw)
    if (cards.length > 0) {
      await putCards(cards)
      audio.play('select')
    }
    const parts = [`匯入 ${cards.length} 張`]
    if (errors.length) parts.push(`${errors.length} 筆有誤：${errors.slice(0, 3).join('；')}${errors.length > 3 ? '…' : ''}`)
    setMsg(parts.join('，'))
    if (cards.length > 0 && errors.length === 0) setTimeout(onDone, 900)
  }

  return (
    <motion.div className="lib-panel" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
      <textarea
        className="lib-textarea"
        placeholder={'貼上 JSON：[{"cardId":"A1","speciesId":25,"level":12}]\n或 CSV：cardId,speciesId,level（首列為表頭）'}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn--sm" onClick={() => void doImport(text)} disabled={!text.trim()}>匯入貼上內容</button>
        <label className="btn btn--ghost btn--sm">
          選檔…
          <input type="file" accept=".json,.csv,text/*" hidden onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) f.text().then(doImport)
            e.target.value = ''
          }} />
        </label>
      </div>
      {msg && <div className="lib-msg">{msg}</div>}
    </motion.div>
  )
}

/** 顯示一張卡的可列印 QR + 卡碼。 */
function QrOverlay({ card, onClose }: { card: Card; onClose: () => void }) {
  const code = makeCardCode(card.cardId)
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const sp = getSpecies(card.speciesId)

  useEffect(() => {
    let alive = true
    QRCode.toDataURL(code, { margin: 1, width: 260, errorCorrectionLevel: 'M' })
      .then((u) => { if (alive) setDataUrl(u) })
      .catch(() => { if (alive) setDataUrl(null) })
    return () => { alive = false }
  }, [code])

  return (
    <motion.div className="modal-backdrop" style={{ zIndex: 110 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div className="qr-card" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} onClick={(e) => e.stopPropagation()}>
        <div className="qr-card__title">{sp.nameZh} Lv.{card.level}</div>
        {dataUrl ? <img className="qr-card__img" src={dataUrl} alt="QR" /> : <div className="qr-card__img qr-card__img--loading">產生中…</div>}
        <div className="qr-card__code">{code}</div>
        <div className="qr-card__hint">列印或拍下此 QR 當實體卡；掃它即可加入隊伍。</div>
        <div className="row" style={{ gap: 8, justifyContent: 'center' }}>
          <button className="btn btn--sm" onClick={() => window.print()}>列印</button>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>關閉</button>
        </div>
      </motion.div>
    </motion.div>
  )
}
