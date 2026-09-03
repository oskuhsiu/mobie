import { useEffect, useId, useRef, useState } from 'react'
import type { ComboCastMark, Side, StatusEffect } from '@/game/battle/reducer'
import { terrainDefsOf } from '@/game/data/terrains'
import type { TerrainId } from '@/game/types'
import { displaySourceName } from './BattleHudAdapter'

interface StatusViewItem {
  key: string
  icon: string
  label: string
  source: string
  remaining: number
}

function StatusOverflow({
  buttonLabel,
  dialogLabel,
  items,
  hiddenCount,
  className = '',
  onRestore,
}: {
  buttonLabel: string
  dialogLabel: string
  items: readonly StatusViewItem[]
  hiddenCount: number
  className?: string
  onRestore?: () => void
}) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const close = () => {
    setOpen(false)
    buttonRef.current?.focus()
    onRestore?.()
  }

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  return (
    <div className={`battle-status-overflow ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        className="battle-status-more"
        aria-label={buttonLabel}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        +{hiddenCount}
      </button>
      {open && (
        <div id={panelId} className="battle-status-details" role="dialog" aria-label={dialogLabel}>
          <ul>
            {items.map((item) => (
              <li key={item.key}>
                <span aria-hidden="true">{item.icon}</span>
                <strong>{item.label}</strong>
                <span>來源：{item.source}</span>
                <span>剩餘 {item.remaining} 回合</span>
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn--ghost btn--sm" onClick={close}>關閉</button>
        </div>
      )}
    </div>
  )
}

const SIDE_LABEL: Record<Side, string> = {
  player: '我方全隊',
  foe: '對手全隊',
}

function statusView(status: StatusEffect, index: number): StatusViewItem {
  return {
    key: `${status.stat}:${status.source}:${index}`,
    icon: status.mult >= 1 ? '▲' : '▼',
    label: status.label,
    source: displaySourceName({ kind: 'status', source: status.source, label: status.label }),
    remaining: status.remaining,
  }
}

export function SideStatusRail({ side, statuses }: { side: Side; statuses: readonly StatusEffect[] }) {
  if (statuses.length === 0) return null
  const sideLabel = SIDE_LABEL[side]
  const items = statuses.map(statusView)
  return (
    <div className="battle-side-status" aria-label={`${sideLabel}狀態`} data-status-side={side}>
      {items.slice(0, 3).map((item) => (
        <span
          key={item.key}
          className="battle-status-chip"
          title={`${item.label}；來源：${item.source}；剩餘 ${item.remaining} 回合`}
        >
          <span aria-hidden="true">{item.icon}</span>
          <span className="battle-status-chip__label">{item.label}</span>
          <span className="battle-status-chip__turns">{item.remaining}</span>
        </span>
      ))}
      {items.length > 3 && (
        <StatusOverflow
          buttonLabel={`展開${sideLabel}全部 ${items.length} 個狀態`}
          dialogLabel={`${sideLabel}完整狀態`}
          items={items}
          hiddenCount={items.length - 3}
          className="battle-status-overflow--wide"
        />
      )}
      {items.length > 1 && (
        <StatusOverflow
          buttonLabel={`精簡展開${sideLabel}全部 ${items.length} 個狀態`}
          dialogLabel={`${sideLabel}完整狀態`}
          items={items}
          hiddenCount={items.length - 1}
          className="battle-status-overflow--compact"
        />
      )}
    </div>
  )
}

function fieldMarkView(mark: ComboCastMark): StatusViewItem {
  return {
    key: mark.key,
    icon: mark.icon,
    label: mark.label,
    source: displaySourceName({ kind: 'combo', key: mark.key, label: mark.label }),
    remaining: mark.remaining,
  }
}

export function FieldStatusBar({
  terrainIds,
  initiative,
  turn,
  fieldMarks,
  onOverflowRestore,
}: {
  terrainIds: TerrainId[]
  initiative: string
  turn: number
  fieldMarks: readonly ComboCastMark[]
  onOverflowRestore?: () => void
}) {
  const terrains = terrainDefsOf(terrainIds)
  const marks = fieldMarks.map(fieldMarkView)
  return (
    <div className="battle-field-bar" data-field-status aria-label={`${initiative}，回合 ${turn}`}>
      <strong className="battle-field-bar__initiative">{initiative}</strong>
      <span className="battle-field-bar__turn">回合 {turn}</span>
      {terrains.map((terrain) => (
        <span key={terrain.id} className="battle-field-bar__terrain" title="場域地形：影響該屬性招式的威力">
          {terrain.icon} {terrain.name}
        </span>
      ))}
      {marks.slice(0, 2).map((mark) => (
        <span
          key={mark.key}
          className="battle-field-bar__mark"
          title={`${mark.label}；來源：${mark.source}；剩餘 ${mark.remaining} 回合`}
        >
          <span aria-hidden="true">{mark.icon}</span> {mark.label} {mark.remaining}
        </span>
      ))}
      {marks.length > 2 && (
        <StatusOverflow
          buttonLabel={`展開全部 ${marks.length} 個場域標記`}
          dialogLabel="完整場域標記"
          items={marks}
          hiddenCount={marks.length - 2}
          onRestore={onOverflowRestore}
        />
      )}
    </div>
  )
}
