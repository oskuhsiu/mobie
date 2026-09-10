// M24 Ticket 40 — durable achievement progress / claim surface.
import { useEffect, useState } from 'react'
import { useMeta } from '@/store/metaStore'
import { computeAchievements } from '@/game/achievements'
import { ModalSurface } from '@/ui/shell/ModalSurface'

function rewardLabel(reward: { kind: 'egg' | 'sp'; label: string; amount?: number }): string {
  return reward.kind === 'egg'
    ? `🥚 ${reward.label}`
    : `✨ ${reward.label}${reward.amount && reward.amount > 0 ? `（${reward.amount} SP）` : ''}`
}

export function AchievementsModal({ onClose }: { onClose: () => void }) {
  const meta = useMeta((s) => s.meta)
  const loaded = useMeta((s) => s.loaded)
  const claimAchievement = useMeta((s) => s.claimAchievement)
  const reconcileAchievementClaims = useMeta((s) => s.reconcileAchievementClaims)
  const claimBusy = useMeta((s) => s.claimBusy)
  const claimErrors = useMeta((s) => s.claimErrors)
  const [announcement, setAnnouncement] = useState('')
  const views = computeAchievements(meta)
  const done = views.filter((v) => v.unlocked).length

  const reconcile = async () => {
    try {
      const recovery = await reconcileAchievementClaims()
      if (recovery.completed > 0) setAnnouncement(`已恢復 ${recovery.completed} 項成就獎勵。`)
      else if (recovery.attempted > 0 && recovery.errors.length === 0) setAnnouncement('成就資料已重新載入。')
    } catch {
      setAnnouncement('成就資料讀取失敗，請稍後重試。')
    }
  }

  useEffect(() => {
    if (!loaded) return
    void reconcile()
  }, [loaded, reconcileAchievementClaims])

  const claim = async (id: string) => {
    setAnnouncement('正在保存成就領取…')
    try {
      const result = await claimAchievement(id)
      if (result) {
        const rewardText = result.reward.kind === 'egg' ? '蛋已送往孵化所' : `${result.reward.amount} SP 已加入帳號資源`
        setAnnouncement(result.status === 'already-applied' ? '成就獎勵已完成對帳。' : `成就獎勵已領取，${rewardText}。`)
      } else {
        setAnnouncement('成就狀態已更新，請查看最新進度。')
      }
    } catch {
      // The store retains a durable pending outbox and exposes the recoverable
      // reason beside the row. Keeping the modal open makes retry explicit.
      setAnnouncement('成就領取需要重試。')
    }
  }

  return (
    <ModalSurface
      title="🏆 成就"
      description={`已達成 ${done} / ${views.length}　獎勵會送到孵化所或帳號資源`}
      onClose={onClose}
    >
      <div className="modal-surface__stack" data-achievements-root data-achievements-state={loaded ? 'ready' : 'loading'}>
        <div className="sr-only" aria-live="polite" data-achievement-announcement>{announcement}</div>
        {claimErrors['*'] && (
          <div className="achievements-error" role="alert" data-achievements-global-error>
            <span>{claimErrors['*']}</span>
            <button className="btn btn--ghost btn--sm" onClick={() => { void reconcile() }}>重新載入</button>
          </div>
        )}
        {!loaded && (
          <div className="utility-empty" data-achievements-state="loading" role="status">成就資料載入中…</div>
        )}
        {loaded && views.length === 0 && (
          <div className="utility-empty" data-achievements-state="empty">目前沒有可顯示的成就。</div>
        )}
        {loaded && views.map((v) => {
          const pct = Math.round((v.progress / v.target) * 100)
          const error = claimErrors[v.def.id]
          const busy = claimBusy === v.def.id
          return (
            <div
              key={v.def.id}
              className={`ach-row ach-row--${v.status} ${v.unlocked ? 'ach-row--done' : ''}`}
              data-achievement-id={v.def.id}
              data-achievement-status={v.status}
            >
              <span className="ach-row__icon" aria-hidden="true">{v.def.icon}</span>
              <div className="ach-row__body">
                <div className="ach-row__top">
                  <span className="ach-row__name">{v.def.name}</span>
                  <span className="ach-row__count">{v.progress}/{v.target}</span>
                </div>
                <div className="ach-row__desc">
                  {v.def.desc}　<span className="ach-row__reward">{rewardLabel(v.def.reward)}</span>
                </div>
                <div className="ach-row__track" aria-label={`${v.def.name}進度 ${v.progress}/${v.target}`}>
                  <div className="ach-row__fill" style={{ width: `${pct}%` }} />
                </div>
                {error && <div className="ach-row__error" role="alert" data-achievement-error>{error}</div>}
              </div>
              {v.status === 'claimed'
                ? <span className="ach-row__claimed" data-achievement-claim-state="claimed">✓ 已領取</span>
                : v.status === 'pending'
                  ? <button
                      className="btn btn--sm ach-row__claim"
                      disabled={busy}
                      aria-busy={busy}
                      data-achievement-claim
                      data-achievement-claim-state="pending"
                      onClick={() => { void claim(v.def.id) }}
                    >{busy ? '處理中…' : '繼續領取'}</button>
                  : v.status === 'ready'
                    ? <button
                        className="btn btn--sm ach-row__claim"
                        disabled={claimBusy !== null}
                        aria-busy={busy}
                        data-achievement-claim
                        data-achievement-claim-state="ready"
                        onClick={() => { void claim(v.def.id) }}
                      >{busy ? '處理中…' : '領取'}</button>
                    : <span className="ach-row__lock">進行中</span>}
            </div>
          )
        })}
      </div>
    </ModalSurface>
  )
}
