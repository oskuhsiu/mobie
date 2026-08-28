/// <reference types="vite/client" />

// 由 vite.config.ts 的 define 注入（編譯期常數）＝package.json 的版號。
declare const __APP_VERSION__: string

interface Window {
  /** DEV-only M23 deterministic baseline surface; production builds must tree-shake it completely. */
  __MOBIE_M23_BASELINE__?: import('@/dev/m23/installBaselineDriver').M23BaselineDriver
}
