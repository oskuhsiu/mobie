import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'

// 版號真相＝package.json（由 .githooks/pre-commit 每次 commit 自動升 patch）。
// 在建置/dev 時注入成 __APP_VERSION__ 編譯期常數，首頁顯示用。
const pkgVersion = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
).version

// GitHub Pages 專案站服務於 https://<user>.github.io/mobie/，故建置時 base 必須是 '/mobie/'。
// dev（vite/vitest）維持 '/'，本機開發與測試不受影響。
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/mobie/' : '/',
  define: { __APP_VERSION__: JSON.stringify(pkgVersion) },
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
  },
}))
