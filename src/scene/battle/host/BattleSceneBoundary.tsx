import { Component, type ErrorInfo, type ReactNode } from 'react'

export class BattleSceneBoundary extends Component<{
  children: ReactNode
  onFatal: (error: unknown) => void
}, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown, _info: ErrorInfo): void {
    this.props.onFatal(error)
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}
