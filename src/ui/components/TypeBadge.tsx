import type { TypeName } from '@/game/types'
import { TYPE_LABEL_ZH, typeColor } from '@/ui/typeMeta'

export function TypeBadge({ type }: { type: TypeName }) {
  return (
    <span className="type-badge" style={{ background: typeColor(type) }}>
      {TYPE_LABEL_ZH[type]}
    </span>
  )
}

export function TypeBadges({ types }: { types: TypeName[] }) {
  return (
    <span className="row" style={{ gap: 6 }}>
      {types.map((t) => <TypeBadge key={t} type={t} />)}
    </span>
  )
}
