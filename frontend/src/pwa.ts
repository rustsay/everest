/* Install on the phone (PWA) and push notifications. */

interface InstallPrompt extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

let deferred: InstallPrompt | null = null
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((f) => f())

/** Called once from main.tsx: registers the service worker and keeps the browser's install offer for later. */
export function initPwa() {
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as InstallPrompt; changed() })
  addEventListener('appinstalled', () => { deferred = null; changed() })
  if ('serviceWorker' in navigator && isSecureContext) {
    navigator.serviceWorker.register('/sw.js').catch(() => null)
    // a tap on a notification when the window could not be navigated by the service worker
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'go' && typeof e.data.go === 'string') location.hash = '#' + e.data.go
    })
  }
}

export const onPwaChange = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f) } }

export const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true

export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export const canPrompt = () => deferred !== null

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false
  const d = deferred
  deferred = null
  await d.prompt()
  const r = await d.userChoice.catch(() => ({ outcome: 'dismissed' }))
  changed()
  return r.outcome === 'accepted'
}

/* ---------- push ---------- */

export type PushState = 'unsupported' | 'insecure' | 'ios-install' | 'denied' | 'off' | 'on'

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export async function pushState(): Promise<PushState> {
  if (!isSecureContext) return 'insecure'
  if (!pushSupported()) return isIos() && !isStandalone() ? 'ios-install' : 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = reg ? await reg.pushManager.getSubscription() : null
  return sub ? 'on' : 'off'
}

function keyBytes(b64: string): Uint8Array {
  const s = b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4)
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
}

/** Asks the permission, subscribes and returns the subscription to send to the server. */
export async function subscribePush(serverKey: string): Promise<PushSubscriptionJSON> {
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Уведомления запрещены в настройках браузера' : 'Разрешение не дано')
  const reg = await navigator.serviceWorker.register('/sw.js')
  await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(serverKey) as BufferSource })
  return sub.toJSON()
}

/** Unsubscribes this device; returns the endpoint to remove on the server. */
export async function unsubscribePush(): Promise<string | null> {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = reg ? await reg.pushManager.getSubscription() : null
  if (!sub) return null
  const ep = sub.endpoint
  await sub.unsubscribe().catch(() => null)
  return ep
}
