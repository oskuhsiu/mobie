import '@/bootstrap' // 必須最前：在任何 store import-time 讀 key 之前跑 mz.*→mobie.* 遷移
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@/app/App'
import '@/ui/styles/global.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if (
  import.meta.env.DEV
  && new URLSearchParams(window.location.search).get('m23Scenario') === 'm23-current-parity-v1'
) {
  void import('@/dev/m23/installBaselineDriver').then(({ installM23BaselineDriver }) => {
    installM23BaselineDriver()
  })
}
