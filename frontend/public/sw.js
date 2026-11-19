/* «Эверест»: service worker. Only push notifications and opening the app by a tap on them.
   Pages are not cached: the site always loads fresh from the server. */

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { d = { body: e.data ? e.data.text() : '' } }
  const title = d.title || 'Эверест'
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: d.tag || undefined,
    lang: 'ru',
    data: { go: d.go || 'home' },
  }))
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const go = (e.notification.data && e.notification.data.go) || 'home'
  const url = new URL('/#' + go, self.location.origin).href
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin) {
        await w.focus()
        try { await w.navigate(url) } catch { w.postMessage({ type: 'go', go }) }
        return
      }
    }
    await self.clients.openWindow(url)
  })())
})

/* The browser may replace the subscription: tell the server, the old address serves as the proof. */
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil((async () => {
    const old = e.oldSubscription
    let sub = e.newSubscription
    if (!sub) {
      const r = await fetch('/api/push/key')
      const { key } = await r.json()
      if (!key) return
      const raw = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (key.length % 4)) % 4)), (c) => c.charCodeAt(0))
      sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw })
    }
    if (!old) return
    await fetch('/api/push/renew', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ old_endpoint: old.endpoint, subscription: sub.toJSON() }),
    })
  })())
})
