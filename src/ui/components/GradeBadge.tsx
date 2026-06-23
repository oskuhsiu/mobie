// M10 — 星級 Grade 徽章（純展示，零 buff）。讀個體+species 派生 Grade，高 Grade（≥5）給光效。
import { computeGrade, GRADE_LABEL, isShiningGrade, type GradeInput } from '@/game/grade'
import { getSpecies } from '@/game/data/species'

/** Grade 徽章：依個體（ivs/shiny）+ speciesId 派生稀有度，Star/Superstar 發光。 */
export function GradeBadge({ indiv, speciesId, size = 'md' }: {
  indiv: GradeInput
  speciesId: number
  size?: 'sm' | 'md'
}) {
  const grade = computeGrade(indiv, getSpecies(speciesId))
  const shining = isShiningGrade(grade)
  return (
    <span
      className={`grade-badge grade-badge--${size} grade-badge--g${grade} ${shining ? 'grade-badge--shine' : ''}`}
      title={`稀有度 ${GRADE_LABEL[grade]}（純展示、不影響戰力）`}
    >
      <span className="grade-badge__star">{shining ? '✦' : '◆'}</span>
      {grade === 6 ? 'SS' : grade === 5 ? 'S' : grade}
    </span>
  )
}
