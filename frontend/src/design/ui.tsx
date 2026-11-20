import { CSSProperties, ReactNode, useEffect, useRef, useState } from 'react'
export { speak, hush, prepareSpeech, prepareSpeeches, setSpeechRate } from '../utils/speech'

/* ---------- icons ---------- */
const I: Record<string, string> = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  check: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  map: '<circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.5"/>',
  play: '<circle cx="12" cy="12" r="10"/><path d="m10 8 6 4-6 4z"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  class: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
  pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  img: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
  send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  restart: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  bulb: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  star: '<path d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.3l-5.6 2.9 1.1-6.3L2.9 9.5l6.3-.9z"/>',
  slides: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  ok: '<path d="M4 12.5 9 17.5 20 6.5"/>',
  vol: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a9 9 0 0 1 0 14"/>',
  mute: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6M16 9l6 6"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  prev: '<path d="m15 18-6-6 6-6"/>',
  next: '<path d="m9 18 6-6-6-6"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  full: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  book: '<path d="M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4z"/><path d="M20 4h-6a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h7z"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 6-7"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M9 2h6"/>',
  note: '<path d="M4 4h16v12l-4 4H4z"/><path d="M16 20v-4h4"/><path d="M8 9h8M8 13h5"/>',
}

export function Icon({ n, s = 20, c = 'currentColor', w = 2 }: { n: string; s?: number; c?: string; w?: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={w} strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: I[n] ?? '' }} />
  )
}

export const STAR_D = 'M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.3l-5.6 2.9 1.1-6.3L2.9 9.5l6.3-.9z'
export function StarIcon({ s = 18, on = true }: { s?: number; on?: boolean }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true">
      <path d={STAR_D} fill={on ? 'var(--gold)' : 'var(--surface-2)'} stroke={on ? '#C9971F' : 'var(--line)'} strokeWidth={1.3} strokeLinejoin="round" />
    </svg>
  )
}

/* ---------- mascot «Звёздочка» ---------- */
export function StarBot({ size = 64, talk = false, spin = false, className = '' }: { size?: number; talk?: boolean; spin?: boolean; className?: string }) {
  return (
    <svg className={`star-bot ${talk ? 'talk' : ''} ${spin ? 'spin' : ''} ${className}`} width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <path d="M50 5 L62.5 35.5 L95 37.5 L70 58.5 L78.5 91 L50 73 L21.5 91 L30 58.5 L5 37.5 L37.5 35.5 Z" fill="#F4C64E" stroke="#C9971F" strokeWidth={3.5} strokeLinejoin="round" />
      <path d="M50 15 L59 37.5 L83 39.5" fill="none" stroke="#FFE9A6" strokeWidth={3} strokeLinecap="round" />
      <g className="eyes">
        <ellipse cx={41} cy={49} rx={4.2} ry={5.6} fill="#16231F" />
        <ellipse cx={59} cy={49} rx={4.2} ry={5.6} fill="#16231F" />
        <circle cx={42.4} cy={47} r={1.4} fill="#fff" />
        <circle cx={60.4} cy={47} r={1.4} fill="#fff" />
      </g>
      <circle cx={33.5} cy={58} r={4} fill="#EE8E7B" opacity={0.55} />
      <circle cx={66.5} cy={58} r={4} fill="#EE8E7B" opacity={0.55} />
      <ellipse className="mouth" cx={50} cy={61} rx={5} ry={3.4} fill="#7A2A1C" />
      <path className="smile" d="M44 59 Q50 66 56 59" fill="none" stroke="#16231F" strokeWidth={2.8} strokeLinecap="round" />
    </svg>
  )
}

/* ---------- mountains and ornament ---------- */
export function SideMountains() {
  return (
    <svg viewBox="0 0 248 420" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <circle cx={200} cy={96} r={20} fill="var(--gold)" opacity={0.28} />
      <g className="s-cloud"><ellipse cx={40} cy={120} rx={26} ry={8} fill="#fff" opacity={0.9} /><ellipse cx={56} cy={114} rx={16} ry={8} fill="#fff" opacity={0.9} /></g>
      <g className="s-cloud b"><ellipse cx={10} cy={168} rx={20} ry={6} fill="#fff" opacity={0.8} /></g>
      <path d="M0 262 L30 228 L60 246 L86 200 L108 222 L150 150 L178 190 L206 168 L248 206 L248 420 L0 420Z" fill="var(--mt-1)" />
      <path d="M150 150 L165.4 172 L158 168 L152 176 L146 168 L137.2 172Z" fill="var(--snow)" />
      <path d="M0 330 L36 290 L64 304 L96 220 L124 70 L150 176 L170 160 L206 236 L248 214 L248 420 L0 420Z" fill="var(--mt-2)" />
      <path d="M124 70 L137.5 125 L131 119 L126 128 L120 118 L113.7 125Z" fill="var(--snow)" />
      <path d="M60 392 Q88 330 100 262 T122 78" fill="none" stroke="var(--gold)" strokeWidth={2} className="s-trail" opacity={0.9} />
      <line x1={124} y1={71} x2={124} y2={46} stroke="var(--side-ink)" strokeWidth={1.6} />
      <path className="s-flag" d="M124 46 L142 51 L124 57Z" fill="var(--red)" />
      <path d="M0 352 L40 318 L80 336 L130 292 L170 322 L210 300 L248 318 L248 420 L0 420Z" fill="var(--mt-3)" />
      <path d="M0 394 L50 374 L110 390 L170 368 L248 386 L248 420 L0 420Z" fill="var(--mt-4)" />
    </svg>
  )
}

export function WideMountains() {
  return (
    <svg viewBox="0 0 1200 400" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <circle cx={930} cy={80} r={34} fill="var(--gold)" opacity={0.3} />
      <g className="s-cloud"><ellipse cx={200} cy={90} rx={60} ry={14} fill="#fff" opacity={0.9} /><ellipse cx={236} cy={80} rx={34} ry={14} fill="#fff" opacity={0.9} /></g>
      <path d="M0 260 L120 200 L220 230 L360 140 L470 210 L600 120 L700 180 L820 150 L960 220 L1080 170 L1200 210 L1200 400 L0 400Z" fill="var(--mt-1)" />
      <path d="M0 300 L140 250 L260 280 L420 190 L520 230 L600 40 L680 200 L780 170 L900 260 L1040 220 L1200 270 L1200 400 L0 400Z" fill="var(--mt-2)" />
      <path d="M600 40 L635 110 L622 102 L612 116 L600 104 L588 116 L570.5 110Z" fill="var(--snow)" />
      <line x1={600} y1={41} x2={600} y2={8} stroke="var(--side-ink)" strokeWidth={2} />
      <path className="s-flag" d="M600 8 L626 15 L600 22Z" fill="var(--red)" />
      <path d="M0 340 L160 300 L300 330 L460 280 L620 320 L780 290 L940 330 L1080 300 L1200 320 L1200 400 L0 400Z" fill="var(--mt-3)" />
      <path d="M0 375 L200 355 L420 372 L640 352 L880 370 L1200 356 L1200 400 L0 400Z" fill="var(--mt-4)" />
    </svg>
  )
}

export const Orn = ({ style }: { style?: CSSProperties }) => <div className="orn" aria-hidden="true" style={style} />

/* ---------- text helpers ---------- */
export const reduceMotion = typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export const plural = (n: number, a: string, b: string, c: string) => {
  const m = Math.abs(n) % 100, k = m % 10
  return m > 10 && m < 20 ? c : k === 1 ? a : k >= 2 && k <= 4 ? b : c
}
export const fmt1 = (v: number) => (Math.round(v * 10) / 10).toString().replace('.', ',')
export const fmtD = (d: string | Date, o: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }) =>
  new Date(typeof d === 'string' && d.length === 10 ? d + 'T12:00' : d).toLocaleDateString('ru-RU', o)
export const dkey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const taskLabel = (t: { n: number | string | null; name: string }) => (t.n ? `№ ${t.n}` : t.name)

/** **bold**, headings and bullets in plain model text, without HTML injection */
export function Md({ text }: { text: string }) {
  const lines = text.split('\n')
  return (
    <>
      {lines.map((ln, i) => {
        const clean = ln.replace(/^#+\s*/, '').replace(/^\s*[-•]\s+/, '• ')
        const parts = clean.split(/\*\*(.+?)\*\*/g)
        return (
          <span key={i}>
            {parts.map((p, j) => (j % 2 ? <b key={j}>{p}</b> : <span key={j}>{p}</span>))}
            {i < lines.length - 1 && <br />}
          </span>
        )
      })}
    </>
  )
}

/* ---------- typewriter ---------- */
export function useTypewriter(text: string, speed = 22, onDone?: () => void) {
  const [shown, setShown] = useState(reduceMotion ? text : '')
  const doneRef = useRef(onDone)
  doneRef.current = onDone
  useEffect(() => {
    if (reduceMotion) { setShown(text); doneRef.current?.(); return }
    setShown('')
    let i = 0
    const t = setInterval(() => {
      i++
      setShown(text.slice(0, i))
      if (i >= text.length) { clearInterval(t); doneRef.current?.() }
    }, speed)
    return () => clearInterval(t)
  }, [text, speed])
  return { shown, typing: shown.length < text.length }
}

export function Typed({ text, speed = 22, className = 'tw', onDone, onTyping }: { text: string; speed?: number; className?: string; onDone?: () => void; onTyping?: (t: boolean) => void }) {
  const { shown, typing } = useTypewriter(text, speed, onDone)
  useEffect(() => { onTyping?.(typing) }, [typing, onTyping])
  return <p className={`${className} ${typing ? 'typing' : ''}`} aria-live="polite">{shown}</p>
}

/* ---------- sound and voice ---------- */
let AC: AudioContext | null = null
export function chime(final: boolean) {
  try {
    const W = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
    const Ctor = W.AudioContext ?? W.webkitAudioContext
    if (!Ctor) return
    AC = AC ?? new Ctor()
    const t0 = AC.currentTime + 0.05
    const notes = final ? [523.25, 659.25, 783.99, 1046.5] : [659.25, 987.77]
    notes.forEach((f, i) => {
      const o = AC!.createOscillator(), g = AC!.createGain()
      o.type = i % 2 ? 'sine' : 'triangle'
      o.frequency.value = f
      const st = t0 + i * (final ? 0.12 : 0.09)
      g.gain.setValueAtTime(0, st)
      g.gain.linearRampToValueAtTime(0.16, st + 0.02)
      g.gain.exponentialRampToValueAtTime(0.001, st + (final ? 1.4 : 0.6))
      o.connect(g).connect(AC!.destination)
      o.start(st)
      o.stop(st + 1.5)
    })
    if (final) {
      ;[523.25, 659.25, 783.99].forEach((f) => {
        const o = AC!.createOscillator(), g = AC!.createGain()
        o.type = 'sine'
        o.frequency.value = f / 2
        const st = t0 + 0.55
        g.gain.setValueAtTime(0, st)
        g.gain.linearRampToValueAtTime(0.07, st + 0.3)
        g.gain.exponentialRampToValueAtTime(0.001, st + 2.6)
        o.connect(g).connect(AC!.destination)
        o.start(st)
        o.stop(st + 2.7)
      })
    }
  } catch { /* audio not available */ }
}

export function Pill({ kind = 'em', children }: { kind?: 'em' | 'gold' | 'bad'; children: ReactNode }) {
  return <span className={`pill p-${kind}`}>{children}</span>
}
