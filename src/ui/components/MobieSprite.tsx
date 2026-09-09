import { useEffect, useMemo, useState } from 'react'

interface MobieSpriteProps {
  src: string
  alt: string
  shiny?: boolean
  /** 背面朝向（自家Mobie看背面）— M1 用官方 artwork，統一正面，僅水平翻轉示意 */
  flip?: boolean
  /** EXT.1.d：idle 微浮動（CSS transform，低頻）。由呼叫端依 juice 決定是否開（off＝靜止）。 */
  idle?: boolean
  className?: string
  /** Notify an owner when remote artwork completes or falls back. */
  onStateChange?: (state: 'loading' | 'loaded' | 'failed') => void
}

export function MobieSprite({ src, alt, shiny, flip, idle, className, onStateChange }: MobieSpriteProps) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>(() => src ? 'loading' : 'failed')

  useEffect(() => {
    setState(src ? 'loading' : 'failed')
  }, [src])

  useEffect(() => {
    onStateChange?.(state)
  }, [onStateChange, state])

  const initial = useMemo(() => {
    const compact = alt.trim().replace(/\s+/g, '')
    return compact.slice(0, 2) || '◇'
  }, [alt])

  return (
    <div
      className={`sprite ${shiny ? 'sprite--shiny' : ''} ${idle ? 'sprite--idle' : ''} ${className ?? ''}`}
      data-artwork-state={state}
      aria-busy={state === 'loading' ? 'true' : undefined}
      role={state === 'failed' ? 'img' : undefined}
      aria-label={state === 'failed' ? alt : undefined}
    >
      {state === 'loading' && <div className="sprite__skeleton" aria-hidden="true" />}
      {state === 'failed' && (
        <div className="sprite__fallback" aria-hidden="true">
          <span className="sprite__fallback-mark">{initial}</span>
        </div>
      )}
      <img
        className="sprite__img"
        src={src || undefined}
        alt={state === 'failed' ? '' : alt}
        style={{
          opacity: state === 'loaded' ? 1 : 0,
          transform: flip ? 'scaleX(-1)' : undefined,
          transition: 'opacity 0.35s ease',
        }}
        onLoad={() => setState('loaded')}
        onError={() => setState('failed')}
        draggable={false}
      />
    </div>
  )
}
