import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { getDashboard } from '../api/client'
import type { Dashboard, Me } from '../types'
import { hush, reduceMotion, speak } from '../design/ui'

export type ViewName =
  | 'home' | 'plan' | 'check' | 'session' | 'trajectory' | 'video' | 'chat' | 'awards' | 'teacher' | 'materials' | 'tchat' | 'task' | 'bank' | 'practice' | 'variants' | 'variant' | 'path' | 'paths' | 'diag' | 'report'
export interface View { v: ViewName; id?: string }

export function parseHash(h: string): View {
  const [v, id] = h.replace(/^#/, '').split('/')
  const known: ViewName[] = ['home', 'plan', 'check', 'session', 'trajectory', 'video', 'chat', 'awards', 'teacher', 'materials', 'tchat', 'task', 'bank', 'practice', 'variants', 'variant', 'path', 'paths', 'diag', 'report']
  return known.includes(v as ViewName) ? { v: v as ViewName, id: id ? decodeURIComponent(id) : undefined } : { v: 'home' }
}
export const viewHash = (v: View) => '#' + v.v + (v.id ? '/' + encodeURIComponent(v.id) : '')

interface Toast { id: number; text: string; kind: string }
interface ModalState { title: string; body: ReactNode; wide?: boolean }

interface Ctx {
  me: Me
  setMe: (m: Me) => void
  dash: Dashboard | null
  reload: () => Promise<void>
  view: View
  go: (v: ViewName | View) => void
  toast: (text: string, kind?: string) => void
  openModal: (title: string, body: ReactNode, wide?: boolean) => void
  closeModal: () => void
  say: (text: string) => void
  speech: { text: string; id: number } | null
  hideSpeech: () => void
  talking: boolean
  setTalking: (t: boolean) => void
  confetti: (n?: number, snow?: boolean) => void
  logout: () => void
  voice: boolean
  setVoice: (v: boolean) => void
}

const C = createContext<Ctx | null>(null)
export const useApp = () => {
  const c = useContext(C)
  if (!c) throw new Error('useApp outside provider')
  return c
}

/* ---------- confetti and snow on one canvas ---------- */
interface Part { x: number; y: number; vx: number; vy: number; s: number; r: number; vr: number; c: string; life: number; g: number; max: number; round: boolean }
function useConfetti() {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const parts = useRef<Part[]>([])
  const raf = useRef(0)
  const tick = useCallback(() => {
    const cv = ref.current
    if (!cv) return
    const cx = cv.getContext('2d')!
    cx.clearRect(0, 0, innerWidth, innerHeight)
    parts.current.forEach((p) => {
      p.vy += p.g; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life++
      cx.save(); cx.translate(p.x, p.y); cx.rotate(p.r); cx.fillStyle = p.c
      cx.globalAlpha = Math.max(0, 1 - p.life / p.max)
      if (p.round) { cx.beginPath(); cx.arc(0, 0, p.s / 2, 0, 6.29); cx.fill() } else cx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2)
      cx.restore()
    })
    parts.current = parts.current.filter((p) => p.life < p.max && p.y < innerHeight + 40)
    raf.current = parts.current.length ? requestAnimationFrame(tick) : (cx.clearRect(0, 0, innerWidth, innerHeight), 0)
  }, [])
  const fire = useCallback((n = 140, snow = false) => {
    const cv = ref.current
    if (!cv || reduceMotion) return
    cv.width = innerWidth * devicePixelRatio
    cv.height = innerHeight * devicePixelRatio
    cv.getContext('2d')!.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
    const cols = snow ? ['#A9C9DE', '#CFE2EE', '#7FB0CF', '#E6F1F8'] : ['#F0883E', '#FFD3AE', '#174A3C', '#3E8A70', '#F4C64E', '#2A6B57']
    for (let i = 0; i < n; i++) {
      parts.current.push(snow
        ? { x: Math.random() * innerWidth, y: -20 - Math.random() * innerHeight * 0.7, vx: (Math.random() - 0.5) * 1.6, vy: 2 + Math.random() * 3, s: 4 + Math.random() * 8, r: 0, vr: 0, c: cols[i % cols.length], life: 0, g: 0.05, max: 240, round: true }
        : { x: innerWidth / 2 + (Math.random() - 0.5) * 160, y: innerHeight * 0.45, vx: (Math.random() - 0.5) * 13, vy: -Math.random() * 13 - 4, s: 4 + Math.random() * 6, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: cols[i % cols.length], life: 0, g: 0.35, max: 110, round: false })
    }
    if (!raf.current) tick()
  }, [tick])
  return { ref, fire }
}

export function AppProvider({ me: initialMe, onLogout, children }: { me: Me; onLogout: () => void; children: ReactNode }) {
  const [me, setMe] = useState<Me>(initialMe)
  const [dash, setDash] = useState<Dashboard | null>(null)
  const [view, setView] = useState<View>(() => parseHash(location.hash || (initialMe.role === 'student' ? '#home' : '#teacher')))
  const [toasts, setToasts] = useState<Toast[]>([])
  const [modal, setModal] = useState<ModalState | null>(null)
  const [speech, setSpeech] = useState<{ text: string; id: number } | null>(null)
  const [talking, setTalking] = useState(false)
  const [voice, setVoiceState] = useState<boolean>(!!initialMe.settings?.voice)
  const conf = useConfetti()

  const reload = useCallback(async () => {
    if (me.role !== 'student' || !me.grade) return
    try { setDash(await getDashboard()) } catch { /* shown as empty states */ }
  }, [me.role, me.grade])
  useEffect(() => { reload() }, [reload])

  useEffect(() => {
    const on = () => setView(parseHash(location.hash))
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  useEffect(() => { document.body.dataset.view = view.v; setSpeech(null) }, [view.v])

  const go = useCallback((v: ViewName | View) => {
    const nv = typeof v === 'string' ? { v } : v
    if (location.hash !== viewHash(nv)) history.pushState(null, '', viewHash(nv))
    setView(nv)
    setModal(null)
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })
  }, [])

  const toast = useCallback((text: string, kind = '') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, text, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2900)
  }, [])

  const say = useCallback((text: string) => {
    setSpeech({ text, id: Date.now() })
    if (voice) speak(text)
  }, [voice])

  const value: Ctx = {
    me, setMe, dash, reload, view, go, toast,
    openModal: (title, body, wide) => setModal({ title, body, wide }),
    closeModal: () => setModal(null),
    say, speech, hideSpeech: () => { setSpeech(null); hush() }, talking, setTalking,
    confetti: conf.fire, logout: onLogout, voice, setVoice: setVoiceState,
  }

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setModal(null) }
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [])

  return (
    <C.Provider value={value}>
      {children}
      {modal && (
        <div className="scrim" onClick={(e) => { if (e.target === e.currentTarget) setModal(null) }}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="mt" style={modal.wide ? { maxWidth: 720 } : undefined}>
            <div className="modal-h">
              <h2 id="mt">{modal.title}</h2>
              <button className="iconbtn" onClick={() => setModal(null)} aria-label="Закрыть"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg></button>
            </div>
            <div id="mbody">{modal.body}</div>
          </div>
        </div>
      )}
      <div className="toasts" aria-live="polite">{toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}</div>
      <canvas id="confetti" ref={conf.ref} aria-hidden="true" />
    </C.Provider>
  )
}
