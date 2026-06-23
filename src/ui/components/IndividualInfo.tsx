import type { BattlePokemon, Stats } from '@/game/types'
import { ivStars, getNature, IV_MAX } from '@/game/individual'
import { GradeBadge } from '@/ui/components/GradeBadge'

const STAT_LABEL: Record<keyof Stats, string> = {
  hp: 'HP', atk: '攻', def: '防', spa: '特攻', spd: '特防', spe: '速',
}
const STAT_ORDER: (keyof Stats)[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe']

const ivTitle = (ivs: Stats) =>
  STAT_ORDER.map((k) => `${STAT_LABEL[k]} ${ivs[k]}`).join(' / ')

// 個體值高低色標（綠=佳、藍=偏低）
const ivColor = (v: number) =>
  v >= 26 ? 'var(--good)' : v <= 5 ? '#5fa8ff' : 'var(--text)'

/** 個體資訊：星級 + 性格（加紅減藍）；detailed 時另顯 0–31 六項（debug） */
export function IndividualInfo({ mon, detailed = false }: { mon: BattlePokemon; detailed?: boolean }) {
  const stars = ivStars(mon.ivs)
  const nat = getNature(mon.nature)
  return (
    <div className="indiv">
      <div className="indiv__row">
        <span className="indiv__stars" title={ivTitle(mon.ivs)}>
          {'★'.repeat(stars)}
          <span className="indiv__stars--dim">{'★'.repeat(5 - stars)}</span>
        </span>
        <span className="indiv__nature">
          {nat.nameZh}
          {nat.up && <span style={{ color: 'var(--bad)' }}>{` ${STAT_LABEL[nat.up]}↑`}</span>}
          {nat.down && <span style={{ color: '#5fa8ff' }}>{` ${STAT_LABEL[nat.down]}↓`}</span>}
        </span>
        {mon.shiny && <span className="indiv__shiny">✦異色</span>}
        <GradeBadge indiv={mon} speciesId={mon.speciesId} size="sm" />
      </div>
      {detailed && (
        <div className="indiv__ivs" title={`個體值 0–${IV_MAX}`}>
          {STAT_ORDER.map((k) => (
            <span key={k} className="indiv__iv" style={{ color: ivColor(mon.ivs[k]) }}>
              {STAT_LABEL[k]}<b>{mon.ivs[k]}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
