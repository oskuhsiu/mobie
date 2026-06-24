import { useState } from 'react'

interface MobieSpriteProps {
  src: string
  alt: string
  shiny?: boolean
  /** 背面朝向（自家Mobie看背面）— M1 用官方 artwork，統一正面，僅水平翻轉示意 */
  flip?: boolean
  className?: string
}

export function MobieSprite({ src, alt, shiny, flip, className }: MobieSpriteProps) {
  const [loaded, setLoaded] = useState(false)

  return (
    <div className={`sprite ${shiny ? 'sprite--shiny' : ''} ${className ?? ''}`}>
      {!loaded && <div className="sprite__skeleton" />}
      <img
        className="sprite__img"
        src={src}
        alt={alt}
        style={{
          opacity: loaded ? 1 : 0,
          transform: flip ? 'scaleX(-1)' : undefined,
          transition: 'opacity 0.35s ease',
        }}
        onLoad={() => setLoaded(true)}
        draggable={false}
      />
    </div>
  )
}
