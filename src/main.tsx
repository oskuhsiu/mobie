import '@/bootstrap' // 必須最前：在任何 store import-time 讀 key 之前跑 mz.*→mobie.* 遷移
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@/app/App'
import '@/ui/styles/global.css'
import { M23_BASELINE_SCENARIO_ID } from '@/dev/m23/contracts'
import { M24_BASELINE_SCENARIO_ID } from '@/dev/m24/contracts'

declare global {
  interface Window {
    /** DEV-only root remount seam for cold-boot lifecycle evidence. */
    __MOBIE_APP_TEST__?: { remount: () => void }
  }
}

const rootNode = document.getElementById('root')!
let root = createRoot(rootNode)
const renderApp = () => root.render(
  <StrictMode>
    <App />
  </StrictMode>,
)
renderApp()

if (import.meta.env.DEV) {
  window.__MOBIE_APP_TEST__ = {
    remount: () => {
      root.unmount()
      root = createRoot(rootNode)
      renderApp()
    },
  }
}

if (
  import.meta.env.DEV
  && new URLSearchParams(window.location.search).get('m23Scenario') === M23_BASELINE_SCENARIO_ID
) {
  void import('@/dev/m23/installBaselineDriver').then(({ installM23BaselineDriver }) => {
    installM23BaselineDriver()
  })
}

if (
  import.meta.env.DEV
  && new URLSearchParams(window.location.search).get('m24Scenario') === M24_BASELINE_SCENARIO_ID
) {
  void import('@/dev/m24/installBaselineDriver').then(({ installM24BaselineDriver }) => {
    installM24BaselineDriver()
  })
}
