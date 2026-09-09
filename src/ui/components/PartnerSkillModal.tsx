import { useCallback, useEffect, useRef, useState } from 'react'
import { audio } from '@/audio/audioEngine'
import {
  PARTNER_SKILLS,
  isPartnerSkillLearned,
  type PartnerSkillDef,
} from '@/game/ext/partnerSkills'
import {
  PartnerSkillUnlockError,
  usePlayerSkills,
} from '@/store/playerSkillsStore'
import { useSkillPoints } from '@/store/skillPointsStore'
import { ModalSurface } from '@/ui/shell/ModalSurface'

type Notice = {
  tone: 'error' | 'status'
  text: string
  skillId?: string
}

type SkillState = 'learned' | 'available' | 'locked'

function modeLabel(mode: PartnerSkillDef['mode']): string {
  return mode === 'active' ? '戰中主動' : '全隊支援'
}

function errorMessage(cause: unknown): string {
  if (cause instanceof PartnerSkillUnlockError) return cause.message
  if (cause instanceof Error && cause.message) return cause.message
  return '夥伴技能沒有完成保存，請再試一次。'
}

function stateLabel(skill: PartnerSkillDef, state: SkillState, accountReady: boolean): string {
  if (state === 'learned') return skill.cost === 0 ? '起始可用' : '已解鎖'
  if (state === 'available') return '可解鎖'
  return accountReady ? 'SP 不足' : '帳號未就緒'
}

function stateReason(skill: PartnerSkillDef, state: SkillState, sp: number, accountReady: boolean): string {
  if (state === 'learned') return '這個帳號技能已可在合法 battle state 使用。'
  if (state === 'available') return `現在可解鎖；一次扣除 ${skill.cost} SP，之後跨所有 Mobie 共用。`
  if (!accountReady) return '帳號技能資料尚未就緒；請重新載入帳號後再試一次。'
  return `目前 SP ${sp}，還需要 ${Math.max(0, skill.cost - sp)} SP 才能解鎖。`
}

/**
 * Account-level Partner Skills: the catalog is always visible, while only a
 * canonical unlock transaction can move a card from locked/available to learned.
 */
export function PartnerSkillModal({ onClose }: { onClose: () => void }) {
  const learnedSkillIds = usePlayerSkills((state) => state.learnedSkillIds)
  const accountLoaded = usePlayerSkills((state) => state.loaded)
  const accountError = usePlayerSkills((state) => state.loadError)
  const reloadAccount = usePlayerSkills((state) => state.reload)
  const unlockWithSp = usePlayerSkills((state) => state.unlockWithSp)
  const sp = useSkillPoints((state) => state.sp)
  const [pendingSkillId, setPendingSkillId] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const focusRefs = useRef(new Map<string, HTMLElement>())
  const focusKey = useRef<string | null>(null)

  const registerFocus = useCallback((key: string, element: HTMLElement | null) => {
    if (element) focusRefs.current.set(key, element)
    else focusRefs.current.delete(key)
  }, [])

  const focusAfterRender = useCallback((key: string) => {
    focusKey.current = key
    requestAnimationFrame(() => {
      const element = focusRefs.current.get(key)
      if (element?.isConnected && !element.hasAttribute('disabled')) element.focus()
    })
  }, [])

  useEffect(() => {
    const key = focusKey.current
    if (!key) return
    const frame = requestAnimationFrame(() => {
      const element = focusRefs.current.get(key)
      if (element?.isConnected && !element.hasAttribute('disabled')) element.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [accountError, accountLoaded, learnedSkillIds, pendingSkillId, sp, notice])

  const accountReady = accountLoaded && !accountError
  const busy = pendingSkillId !== null
  const catalog = PARTNER_SKILLS

  const refresh = useCallback(() => {
    reloadAccount()
    setNotice(null)
    focusAfterRender('account-reload')
  }, [focusAfterRender, reloadAccount])

  const unlock = useCallback(async (skill: PartnerSkillDef) => {
    if (busy) return
    setPendingSkillId(skill.id)
    setNotice(null)
    try {
      const result = await unlockWithSp(skill.id)
      if (result.status === 'already-learned') {
        setNotice({ tone: 'status', skillId: skill.id, text: `「${skill.name}」已解鎖，沒有再次扣除 SP。` })
        focusAfterRender(`skill:${skill.id}`)
        return
      }
      audio.play('super')
      setNotice({ tone: 'status', skillId: skill.id, text: `已解鎖「${skill.name}」；SP −${result.cost}，目前剩餘 ${result.remainingSp}。` })
      focusAfterRender(`skill:${skill.id}`)
    } catch (cause) {
      audio.play('defeat')
      setNotice({ tone: 'error', skillId: skill.id, text: errorMessage(cause) })
      focusAfterRender(`unlock:${skill.id}`)
    } finally {
      setPendingSkillId(null)
    }
  }, [busy, focusAfterRender, unlockWithSp])

  return (
    <ModalSurface
      title="✨ 夥伴技能"
      description="訓練師自己的帳號級戰術工具；技能跨所有 Mobie 共用，固定功能不需要到設定開啟。"
      onClose={onClose}
      className="partner-skill-surface"
      headerAside={<span className="sp-badge" data-sp-ledger data-sp-current={sp}>✦ SP {sp}</span>}
      footer={<div className="utility-foot">SP 與「📖 招式訓練所」共用同一個帳號錢包，但兩者資料和語意分開保存。解鎖成功後會留在 <b>{'mobie.playerskills.v1'}</b>，不掛任何 Mobie。</div>}
    >
      <div className="partner-skills" data-partner-skills data-partner-busy={busy ? 'true' : 'false'}>
        <div className="partner-skill-ledger" aria-label={`帳號技能 SP ${sp}`}>
          <div>
            <span className="eyebrow">Account skill wallet</span>
            <strong>{sp} SP</strong>
          </div>
          <span>打倒 boss 或完成既有結算可取得 SP；每個技能只解鎖一次。</span>
        </div>

        {!accountReady && (
          <div className="partner-skill-account-state" role={accountError ? 'alert' : 'status'} data-partner-account-state={accountError ? 'error' : 'loading'}>
            <strong>{accountError ?? '正在載入帳號技能…'}</strong>
            <span>{accountError ? '目前不會寫入 SP 或 learned state。修復資料後可重新載入。' : '完成後會顯示每個技能的可用條件。'}</span>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              ref={(element) => registerFocus('account-reload', element)}
              onClick={refresh}
              disabled={busy}
            >
              {accountError ? '重新載入帳號' : '重新載入'}
            </button>
          </div>
        )}

        <div className="partner-skill-list" role="list" aria-label="夥伴技能目錄">
          {catalog.map((skill) => {
            const learned = isPartnerSkillLearned(skill.id, learnedSkillIds)
            const state: SkillState = learned ? 'learned' : accountReady && sp >= skill.cost ? 'available' : 'locked'
            const pending = pendingSkillId === skill.id
            const reasonId = `partner-skill-reason-${skill.id}`
            const cardNotice = notice?.skillId === skill.id ? notice : null
            return (
              <article
                key={skill.id}
                ref={(element) => registerFocus(`skill:${skill.id}`, element)}
                className={`partner-skill-card partner-skill-card--${state}`}
                data-partner-skill-id={skill.id}
                data-partner-skill-state={state}
                data-partner-skill-busy={pending ? 'true' : 'false'}
                role="listitem"
                tabIndex={-1}
              >
                <div className="partner-skill-card__head">
                  <span className="partner-skill-card__icon" aria-hidden="true">{skill.icon}</span>
                  <div className="partner-skill-card__heading">
                    <h3 className="partner-skill-card__name">{skill.name}</h3>
                    <span className="hpbar__lv">{modeLabel(skill.mode)}</span>
                  </div>
                  <span className={`partner-skill-card__status partner-skill-card__status--${state}`}>{stateLabel(skill, state, accountReady)}</span>
                </div>

                <p className="partner-skill-card__desc">{skill.desc}</p>
                <dl className="partner-skill-card__facts">
                  <div><dt>解鎖條件</dt><dd>{skill.unlockCondition}</dd></div>
                  <div><dt>SP 成本</dt><dd>{skill.cost === 0 ? '0（起始）' : `${skill.cost} SP`}</dd></div>
                  <div><dt>戰鬥使用</dt><dd>{skill.battleUse}</dd></div>
                </dl>

                <div className="partner-skill-card__action">
                  {pending && <span className="partner-skill-card__busy" role="status" aria-live="polite">正在保存「{skill.name}」…</span>}
                  {state === 'available' && !pending && (
                    <button
                      type="button"
                      className="btn btn--sm trainer-action trainer-action--learn"
                      ref={(element) => registerFocus(`unlock:${skill.id}`, element)}
                      disabled={busy}
                      aria-label={`解鎖 ${skill.name}，花費 ${skill.cost} SP`}
                      aria-describedby={reasonId}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return
                        event.preventDefault()
                        if (!busy) void unlock(skill)
                      }}
                      onClick={() => { void unlock(skill) }}
                    >
                      解鎖・花費 {skill.cost} SP
                    </button>
                  )}
                  {state === 'locked' && !pending && (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm trainer-action"
                      ref={(element) => registerFocus(`unlock:${skill.id}`, element)}
                      disabled
                      data-disabled-reason={!accountReady ? 'account-unavailable' : sp < skill.cost ? 'sp-insufficient' : 'account-unavailable'}
                      aria-label={`解鎖 ${skill.name}：${stateReason(skill, state, sp, accountReady)}`}
                      aria-describedby={reasonId}
                    >
                      {accountReady ? `需要 ${skill.cost} SP` : '帳號資料未就緒'}
                    </button>
                  )}
                  <span id={reasonId} className="partner-skill-card__reason">{cardNotice?.text ?? stateReason(skill, state, sp, accountReady)}</span>
                </div>
              </article>
            )
          })}
        </div>

        {notice && !notice.skillId && (
          <div className={`partner-skill-notice partner-skill-notice--${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'} data-partner-notice>
            {notice.text}
          </div>
        )}
        {notice?.skillId && (
          <div className={`partner-skill-notice partner-skill-notice--${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'} data-partner-notice>
            {notice.text}
            {notice.tone === 'error' && <button type="button" className="btn btn--ghost btn--sm" onClick={refresh} disabled={busy}>重新載入帳號</button>}
          </div>
        )}
      </div>
    </ModalSurface>
  )
}
