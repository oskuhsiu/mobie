// 自動升版（patch）：每次 commit 由 .githooks/pre-commit 呼叫。
// 同步更新 package.json 與 package-lock.json 的「自身」版號（不動相依套件版號），
// 保持 2-space + 結尾換行格式，與 npm 輸出一致、diff 乾淨。
import { readFileSync, writeFileSync } from 'node:fs'

const bumpPatch = (v) => {
  const m = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(v)
  if (!m) throw new Error(`版號格式非預期：${v}`)
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}${m[4]}`
}

const root = new URL('../', import.meta.url)
const readJson = (rel) => JSON.parse(readFileSync(new URL(rel, root), 'utf8'))
const writeJson = (rel, obj) => writeFileSync(new URL(rel, root), JSON.stringify(obj, null, 2) + '\n')

const pkg = readJson('package.json')
const next = bumpPatch(pkg.version)
pkg.version = next
writeJson('package.json', pkg)

// package-lock 的版號鏡像：root 與 packages[""] 兩處同步，其餘相依不碰。
try {
  const lock = readJson('package-lock.json')
  lock.version = next
  if (lock.packages && lock.packages['']) lock.packages[''].version = next
  writeJson('package-lock.json', lock)
} catch {
  /* 無 lock（或讀取失敗）時略過，不阻斷 commit */
}

console.log(next)
