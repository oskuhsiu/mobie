import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// GitHub Pages 專案站服務於 https://<user>.github.io/mobie/，故建置時 base 必須是 '/mobie/'。
// dev（vite/vitest）維持 '/'，本機開發與測試不受影響。
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/mobie/' : '/',
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
