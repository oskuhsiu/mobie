import { forwardRef, useEffect, useRef, useState } from 'react'
import type { BattleFeedEntry } from '@/presentation/battle/contracts'

export interface BattleFeedProps {
  entries: readonly BattleFeedEntry[]
}

export const BattleFeed = forwardRef<HTMLDivElement, BattleFeedProps>(function BattleFeed({ entries }, ref) {
  const [expanded, setExpanded] = useState(false)
  const latest = entries.at(-1)
  const latestId = latest?.id ?? null
  const lastObservedIdRef = useRef(latestId)
  const [announcement, setAnnouncement] = useState<{ id: string; text: string } | null>(null)

  useEffect(() => {
    if (!latest || latest.id === lastObservedIdRef.current) return
    lastObservedIdRef.current = latest.id
    if (!latest.announce) {
      setAnnouncement(null)
      return
    }
    const timeout = window.setTimeout(() => {
      setAnnouncement({ id: latest.id, text: latest.text })
    }, 80)
    return () => window.clearTimeout(timeout)
  }, [latest?.announce, latest?.text, latestId])

  return (
    <section className="battle-feed" aria-label="戰鬥紀錄">
      <div ref={ref} className="battle-feed__latest" tabIndex={-1} data-battle-feed-focus>
        <span className="battle-feed__eyebrow">最新戰況</span>
        <span className="battle-feed__latest-text">{latest?.text ?? '戰鬥開始！'}</span>
      </div>
      <button
        type="button"
        className="battle-feed__toggle"
        aria-expanded={expanded}
        aria-controls="battle-feed-history"
        onClick={() => setExpanded((current) => !current)}
      >
        {expanded ? '收合完整戰報' : `展開完整戰報（${entries.length}）`}
      </button>
      {expanded && (
        <ol id="battle-feed-history" className="battle-feed__history">
          {entries.map((entry) => (
            <li key={entry.id} className={`battle-feed__entry battle-feed__entry--${entry.kind}`}>
              {entry.text}
            </li>
          ))}
        </ol>
      )}
      <div
        className="battle-sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="battle-feed-live"
      >
        {announcement && (
          <span key={announcement.id} data-announcement-id={announcement.id}>
            {announcement.text}
          </span>
        )}
      </div>
    </section>
  )
})

BattleFeed.displayName = 'BattleFeed'
