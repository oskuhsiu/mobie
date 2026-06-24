// M18.c — 應用啟動前置：在任何 store 模組載入「之前」跑 localStorage key 遷移（mz.* → mobie.*）。
// 由 main.tsx 以「最前 side-effect import」載入；本檔無其他相依，確保其副作用先於 stores 的 import-time 讀取。
import { migrateKeys } from '@/game/keyMigration'

migrateKeys()
