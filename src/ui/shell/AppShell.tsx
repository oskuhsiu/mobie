import type { CSSProperties, ReactNode } from 'react'
import { useBootstrap, type BootstrapStatus } from '@/app/bootstrapCoordinator'

export function AppShell({
  children,
  background,
  route,
}: {
  children: ReactNode
  background: CSSProperties['background']
  route: string
}) {
  const { snapshot } = useBootstrap()

  return (
    <div
      className="app app-shell"
      data-app-shell
      data-route={route}
      data-bootstrap-status={snapshot.status}
      data-bootstrap-attempt={snapshot.attempt}
      style={{ background, transition: 'background 0.6s ease' }}
    >
      {children}
    </div>
  )
}

export function ScreenViewport({ children }: { children: ReactNode }) {
  return (
    <main className="screen screen-viewport" data-screen-viewport>
      {children}
    </main>
  )
}

export function TaskHeader({
  eyebrow,
  title,
  tagline,
  className = '',
}: {
  eyebrow: ReactNode
  title: ReactNode
  tagline?: ReactNode
  className?: string
}) {
  return (
    <header className={`task-header ${className}`.trim()} data-task-header>
      <div className="eyebrow task-header__eyebrow">{eyebrow}</div>
      <h1 className="h-title task-header__title">{title}</h1>
      {tagline && <p className="task-header__tagline">{tagline}</p>}
    </header>
  )
}

export function UtilityDock({ children }: { children: ReactNode }) {
  return (
    <nav className="utility-dock" data-utility-dock aria-label="工具入口">
      {children}
    </nav>
  )
}

export function BootstrapStatus() {
  const { snapshot, retry } = useBootstrap()
  if (snapshot.status === 'ready') return null
  const failed = snapshot.status === 'partial-error'
  return (
    <div
      className={`bootstrap-status ${failed ? 'bootstrap-status--error' : ''}`}
      data-bootstrap-status={snapshot.status}
      role={failed ? 'alert' : 'status'}
      aria-live="polite"
    >
      <div className="bootstrap-status__title">{failed ? '資料需要再試一次' : '正在準備你的冒險資料'}</div>
      <div className="bootstrap-status__copy">
        {failed ? snapshot.error : '你的既有進度會保持原樣；完成後即可開始冒險。'}
      </div>
      {failed && (
        <button className="btn btn--ghost btn--sm" onClick={() => void retry()}>
          重新嘗試
        </button>
      )}
    </div>
  )
}

export function bootstrapActionReason(status: BootstrapStatus): string | null {
  if (status === 'loading') return '資料準備中，完成後即可使用。'
  if (status === 'partial-error') return '資料載入未完成，請先按「重新嘗試」。'
  return null
}
