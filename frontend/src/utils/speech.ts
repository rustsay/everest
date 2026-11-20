/** One narrator and one active playback across the entire app. */
export type SpeechResult = 'ended' | 'cancelled' | 'error' | 'blocked'
let stop: (() => void) | undefined
let player: HTMLAudioElement | undefined
type SpeechChannel = 'mascot' | 'board'
let channel: SpeechChannel | undefined
const cache = new Map<string, Blob>()
const pending = new Map<string, Promise<Blob>>()
let cacheBytes = 0

/** Preload without interrupting the current narrator. Failed loads remain retryable. */
export function prepareSpeech(text: string): Promise<Blob> {
  const token = localStorage.getItem('token') ?? ''
  const key = token + ':' + text
  const cached = cache.get(key)
  if (cached) {
    cache.delete(key); cache.set(key, cached)
    return Promise.resolve(cached)
  }
  const existing = pending.get(key)
  if (existing) return existing
  const request = new AbortController()
  const timeout = setTimeout(() => request.abort(), 45000)
  const download = (async () => {
    try {
      const response = await fetch('/api/speech', {
        method: 'POST', signal: request.signal,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ text }),
      })
      if (!response.ok) throw new Error('Speech unavailable')
      const blob = await response.blob()
      cache.set(key, blob); cacheBytes += blob.size
      while (cache.size > 64 || cacheBytes > 16 * 1024 * 1024) {
        const oldest = cache.keys().next().value!
        cacheBytes -= cache.get(oldest)!.size; cache.delete(oldest)
      }
      return blob
    } finally {
      clearTimeout(timeout)
      pending.delete(key)
    }
  })()
  pending.set(key, download)
  return download
}

/** Warm a bounded number of phrases in parallel without blocking the interface. */
export async function prepareSpeeches(texts: readonly string[], concurrency = 4): Promise<void> {
  const queue = [...new Set(texts.map((text) => text.trim()).filter(Boolean))]
  let cursor = 0
  const worker = async () => {
    while (cursor < queue.length) {
      const text = queue[cursor++]
      try { await prepareSpeech(text) } catch { /* an actual playback retries later */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker))
}

export function hush(only?: SpeechChannel) {
  if (!only || channel === only) stop?.()
}

export function setSpeechRate(rate: number) {
  if (player) player.playbackRate = rate
}

export function speak(text: string, rate = 1, onStart?: () => void, owner: SpeechChannel = 'mascot'): Promise<SpeechResult> {
  hush()
  if (!text.trim()) return Promise.resolve('ended')
  const audio = new Audio()
  player = audio
  channel = owner
  audio.preload = 'auto'
  audio.hidden = true
  audio.setAttribute('data-everest-narration', '')
  document.body.appendChild(audio)
  audio.playbackRate = rate
  let url: string | undefined
  let settled = false
  return new Promise((resolve) => {
    const finish = (result: SpeechResult) => {
      if (settled) return
      settled = true
      audio.onended = audio.onerror = null
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      audio.remove()
      if (url) URL.revokeObjectURL(url)
      if (stop === cancel) stop = undefined
      if (player === audio) { player = undefined; channel = undefined }
      if (result === 'error') window.dispatchEvent(new Event('voice-error'))
      resolve(result)
    }
    const cancel = () => finish('cancelled')
    stop = cancel
    audio.onended = () => finish('ended')
    audio.onerror = () => finish('error')
    void (async () => {
      try {
        const blob = await prepareSpeech(text)
        if (settled) return
        url = URL.createObjectURL(blob)
        audio.src = url
        await audio.play()
        if (!settled) onStart?.()
      } catch (error) {
        if (!settled) finish(error instanceof DOMException && error.name === 'NotAllowedError' ? 'blocked' : 'error')
      }
    })()
  })
}
