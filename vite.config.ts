import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'

// 版號真相＝package.json（由 .githooks/pre-commit 每次 commit 自動升 patch）。
// 在建置/dev 時注入成 __APP_VERSION__ 編譯期常數，首頁顯示用。
const pkgVersion = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
).version

// GitHub Pages 綁定自訂網域後，Mobie 從網域根目錄提供服務。
export default defineConfig({
  base: '/',
  define: { __APP_VERSION__: JSON.stringify(pkgVersion) },
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    manifest: true,
    rollupOptions: {
      output: {
        onlyExplicitManualChunks: true,
        manualChunks(id) {
          const normalized = id.replaceAll('\\', '/')
          if (
            normalized.includes('/node_modules/three/')
            || normalized.includes('/node_modules/three-stdlib/')
            || normalized.includes('/node_modules/@react-three/')
          ) return 'three-vendor'
          if (normalized.includes('/src/scene/battle/compat/')) return 'battle-compatibility'
          return undefined
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'node',
  },
})
