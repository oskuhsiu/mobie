// 偵測使用者實際遊玩的裝置，作為標題副標（取代寫死的 'iPad'）。純外觀用途；
// 偵測不到（或非瀏覽器環境，如 vitest node）時回退為 'Web'。每個 session 裝置不變，故由呼叫端算一次即可。
export function detectDeviceLabel(): string {
  if (typeof navigator === 'undefined') return 'Web'
  const ua = navigator.userAgent
  const touch = navigator.maxTouchPoints ?? 0

  // iPadOS 13+ 預設 UA 偽裝成 Mac，靠多點觸控辨別出 iPad
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touch > 1)) return 'iPad'
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPod/.test(ua)) return 'iPod'
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android' : 'Android 平板'
  if (/Macintosh|Mac OS X/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows'
  if (/CrOS/.test(ua)) return 'Chromebook'
  if (/Linux/.test(ua)) return 'Linux'
  return 'Web'
}
