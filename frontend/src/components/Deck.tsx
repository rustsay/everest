/* Presentation of a lesson: looks (themes), slide layouts by kind, show mode with click-by-click builds, slide editor.
   Sizes are in cqw (container query units), so one slide looks the same in the preview card, in print and on a projector. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Slide } from '../types'
import { Icon } from '../design/ui'
import GeoFig from './GeoFig'

export const THEMES: { k: string; name: string; sub: string; sw: [string, string] }[] = [
  { k: 'everest', name: 'Эверест', sub: 'светлая, зелёная с золотом', sw: ['#FFFFFF', '#174A3C'] },
  { k: 'board', name: 'Школьная доска', sub: 'мел на зелёной доске', sw: ['#1F3B33', '#F4EFD8'] },
  { k: 'paper', name: 'Тетрадь', sub: 'клетка и синие чернила', sw: ['#FBF8EF', '#1F3F8F'] },
  { k: 'night', name: 'Ночное небо', sub: 'тёмная, для яркого проектора', sw: ['#101B30', '#7FD6C2'] },
]
export const KINDS: Record<string, string> = {
  title: 'Титульный', goal: 'Цель урока', def: 'Определение', theorem: 'Теорема, формула', example: 'Разбор примера',
  task: 'Задачи', quiz: 'Проверь себя', exam: 'Экзамен', summary: 'Главное за урок', other: 'Слайд',
}
export const FIG_KEYS: Record<string, string> = {
  right: 'прямоугольный треугольник', iso: 'равнобедренный треугольник', general: 'треугольник с высотой и медианой', quad: 'параллелограмм',
  trap: 'трапеция', angles: 'вписанный и центральный углы', chords: 'хорды и касательная', incircle: 'вписанная окружность',
  circum: 'описанная окружность', trig: 'угол в треугольнике (sin, cos)', area: 'площадь многоугольника', unit: 'единичная окружность',
  parab: 'парабола', expg: 'показательная функция', logg: 'логарифм', sing: 'синусоида', tangent: 'касательная к графику',
  line: 'числовая прямая', cube: 'куб', pyramid: 'пирамида', cyl: 'цилиндр', cone: 'конус', sphere: 'шар',
}
/** «Дополнение: …» from the model is shown apart from the textbook text */
const isAdd = (t: string) => /^\s*Дополнение:/i.test(t)

/** what appears click by click on a slide, in order */
export function builds(s: Slide): number {
  const all = s.bullets ?? []
  const own = all.filter((x) => !isAdd(x)).length, add = all.length - own
  const bl = s.kind === 'title' ? own : s.kind === 'quiz' ? own - (!s.question && own ? 1 : 0) + add : own + add
  return (s.formula ? 1 : 0) + bl + (s.kind === 'example' ? (s.steps ?? []).length : 0) + (s.kind === 'quiz' && s.answer ? 1 : 0) + (s.fig && s.kind !== 'title' ? 1 : 0)
}

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** One slide. step - how many builds are shown (Infinity: all); still - no animation (print, editor) */
export function SlideView({ s, i, n, theme = 'everest', step = Infinity, still, topic }: { s: Slide; i: number; n: number; theme?: string; step?: number; still?: boolean; topic?: string }) {
  let b = 0
  // every build gets its number; it is visible when the number is below step
  const at = (cls = '') => {
    const k = b++
    const on = k < step
    return { className: `bld ${cls} ${on ? 'on' : ''}`, style: still ? undefined : { animationDelay: step === Infinity ? `${0.15 + k * 0.12}s` : '0s' } }
  }
  const bullets = s.bullets ?? []
  const own = bullets.filter((x) => !isAdd(x)), add = bullets.filter(isAdd)
  const label = KINDS[s.kind ?? 'other'] ?? 'Слайд'
  // long text from the model must not be cut off: the font gets smaller until everything fits
  const box = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    let k = 1
    el.style.setProperty('--k', '1')
    for (let t = 0; t < 8 && el.scrollHeight > el.clientHeight + 2; t++) { k *= 0.9; el.style.setProperty('--k', k.toFixed(3)) }
  }, [s, theme])
  // functions, not values: builds are numbered in the order they are rendered
  const fig = () => s.fig ? <div {...at()}><div className={`d-fig ${still ? '' : 'draw'}`}><GeoFig k={s.fig} w={300} color="currentColor" /></div></div> : null
  const formula = () => s.formula ? <div {...at()}><p className="d-formula"><span>{s.formula}</span></p></div> : null
  const list = (cls = 'd-list') => own.length > 0 && <ul className={cls}>{own.map((x, k) => <li key={k} {...at()}><span>{x}</span></li>)}</ul>
  const extra = () => add.map((x, k) => <p key={'a' + k} {...at('d-add')}>{x}</p>)

  let body
  if (s.kind === 'title') {
    body = (
      <div className="d-titlepage">
        <span className="d-kicker">{topic && topic !== s.title ? topic : 'Урок математики'}</span>
        <h2 className="d-h1">{s.title}</h2>
        {own[0] && <p {...at('d-sub')}>{own[0]}</p>}
        {own.slice(1).map((x, k) => <p key={k} {...at('d-sub2')}>{x}</p>)}
        {formula()}
        {s.page && <span className="d-page">{s.page}</span>}
        <svg className="d-peaks" viewBox="0 0 1200 260" preserveAspectRatio="none" aria-hidden="true">
          <path className="pk3" d="M0 260 L170 120 L300 190 L470 60 L640 170 L800 90 L980 180 L1200 100 L1200 260Z" />
          <path className="pk2" d="M0 260 L120 170 L260 220 L420 130 L560 210 L720 140 L900 220 L1060 160 L1200 210 L1200 260Z" />
          <path className="pk1" d="M0 260 L200 210 L380 245 L600 200 L820 240 L1000 215 L1200 240 L1200 260Z" />
        </svg>
      </div>
    )
  } else if (s.kind === 'example') {
    const steps = s.steps ?? []
    body = (<>
      <h3 className="d-h">{s.title}</h3>
      <div className="d-cols">
        <div className="d-col">{formula()}{list('d-list d-cond')}{fig()}</div>
        {steps.length > 0 && <div className="d-col d-solve"><span className="d-solve-h">Решение</span>
          <ol className="d-steps">{steps.map((x, k) => <li key={k} {...at()}><b>{k + 1}</b><span>{x}</span></li>)}</ol></div>}
      </div>
      {extra()}
    </>)
  } else if (s.kind === 'quiz') {
    body = (
      <div className="d-quiz">
        <span className="d-qmark" aria-hidden="true">?</span>
        <h3 className="d-h">{s.title}</h3>
        <p className="d-question">{s.question || own[0] || ''}</p>
        {(s.question ? own : own.slice(1)).map((x, k) => <p key={k} {...at('d-sub2')}>{x}</p>)}
        {formula()}{fig()}{extra()}
        {s.answer && <div {...at()}><p className="d-answer"><span>Ответ</span>{s.answer}</p></div>}
      </div>
    )
  } else if (s.kind === 'summary' || s.kind === 'goal') {
    body = (<>
      <h3 className="d-h">{s.title}</h3>
      {formula()}
      {own.length > 0 && <ul className={`d-checks ${s.kind}`}>{own.map((x, k) => <li key={k} {...at()}>
        <svg viewBox="0 0 24 24" aria-hidden="true">{s.kind === 'goal' ? <path d="M5 21V4h11l-2 4 2 4H5" /> : <path d="M4 12.5 9 17.5 20 6.5" />}</svg><span>{x}</span></li>)}</ul>}
      {extra()}{fig()}
    </>)
  } else if (s.kind === 'task') {
    body = (<>
      <h3 className="d-h">{s.title}</h3>
      <div className="d-cols"><div className="d-col">{formula()}
        {own.length > 0 && <ol className="d-tasks">{own.map((x, k) => <li key={k} {...at()}><b>{k + 1}</b><span>{x}</span></li>)}</ol>}{extra()}</div>
        {s.fig && <div className="d-col d-side">{fig()}</div>}</div>
    </>)
  } else {
    body = (<>
      <h3 className="d-h">{s.title}</h3>
      <div className="d-cols"><div className="d-col">{formula()}{list()}{extra()}</div>{s.fig && <div className="d-col d-side">{fig()}</div>}</div>
    </>)
  }
  return (
    <div className={`deck th-${theme} k-${s.kind ?? 'other'} ${still ? 'still' : ''}`}>
      <div className="d-in" ref={box}>
        {s.kind !== 'title' && <span className="d-label">{label}{s.page ? ` · ${s.page}` : ''}</span>}
        {body}
      </div>
      <span className="d-num">{i + 1} / {n}</span>
    </div>
  )
}

/** Full-screen show: arrows, space, a clicker (PageDown/PageUp), swipe; builds appear by click */
export function SlideShow({ slides, topic, theme, start = 0, onClose }: { slides: Slide[]; topic: string; theme: string; start?: number; onClose: (at: number) => void }) {
  const [idx, setIdx] = useState(start)
  const [step, setStep] = useState(0)
  const [dir, setDir] = useState<'next' | 'prev'>('next')
  const [byClick, setByClick] = useState(() => localStorage.getItem('deck-click') !== '0')
  const [notes, setNotes] = useState(false)
  const [black, setBlack] = useState(false)
  const [idle, setIdle] = useState(false)
  const [t0] = useState(() => Date.now())
  const [now, setNow] = useState(Date.now())
  const root = useRef<HTMLDivElement | null>(null)
  const touch = useRef<number | null>(null)
  const n = slides.length
  const s = slides[idx]
  const total = builds(s)
  const shown = byClick ? step : Infinity

  const go = useCallback((to: number, d: 'next' | 'prev', last = false) => {
    if (to < 0 || to >= n) return
    setDir(d); setIdx(to); setStep(last ? builds(slides[to]) : 0)
  }, [n, slides])
  const next = useCallback(() => {
    setBlack(false)
    if (byClick && step < total) setStep(step + 1)
    else go(idx + 1, 'next')
  }, [byClick, step, total, idx, go])
  const prev = useCallback(() => {
    setBlack(false)
    if (byClick && step > 0) setStep(step - 1)
    else go(idx - 1, 'prev', true)
  }, [byClick, step, idx, go])
  const close = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => null)
    onClose(idx)
  }, [idx, onClose])

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); next() }
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); prev() }
      else if (e.key === 'Home') go(0, 'prev')
      else if (e.key === 'End') go(n - 1, 'next', true)
      else if (e.key === 'Escape') close()
      else if (e.key === 'n' || e.key === 'т') setNotes((x) => !x)
      else if (e.key === 'b' || e.key === 'и' || e.key === '.') setBlack((x) => !x)
      else if (e.key === 'f' || e.key === 'а') { if (document.fullscreenElement) document.exitFullscreen().catch(() => null); else root.current?.requestFullscreen().catch(() => null) }
    }
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [next, prev, go, close, n])
  // leaving full screen with the browser's Esc closes the show too
  useEffect(() => {
    let was = !!document.fullscreenElement
    const on = () => { if (was && !document.fullscreenElement) onClose(idx); was = !!document.fullscreenElement }
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [idx, onClose])
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  useEffect(() => {
    // the cursor and the controls hide while the teacher talks
    let t = setTimeout(() => setIdle(true), 2500)
    const on = () => { setIdle(false); clearTimeout(t); t = setTimeout(() => setIdle(true), 2500) }
    addEventListener('mousemove', on)
    return () => { clearTimeout(t); removeEventListener('mousemove', on) }
  }, [])
  useEffect(() => { document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = '' } }, [])

  const sec = Math.floor((now - t0) / 1000)
  const clock = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
  return createPortal(
    <div ref={root} className={`show ${idle ? 'idle' : ''}`} role="dialog" aria-modal="true" aria-label={`Показ: ${topic}`}
      onTouchStart={(e) => { touch.current = e.touches[0].clientX }}
      onTouchEnd={(e) => { const x0 = touch.current; touch.current = null; if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 50) { if (dx < 0) next(); else prev() } }}>
      <div className="show-stage" onClick={next}>
        <div key={idx} className={`show-slide ${reduced() ? '' : 'tr-' + dir}`}>
          <SlideView s={s} i={idx} n={n} theme={theme} step={shown} topic={topic} />
        </div>
        {black && <div className="show-black" />}
      </div>
      <div className="show-bar" aria-hidden="true"><i style={{ width: `${((idx + (total ? Math.min(step, total) / total : 1)) / n) * 100}%` }} /></div>
      {notes && <div className="show-notes"><b>Заметка учителю</b> (её видит весь класс, N - скрыть)<p>{s.note || 'К этому слайду заметки нет'}</p></div>}
      <div className="show-ctl" onClick={(e) => e.stopPropagation()}>
        <button className="iconbtn" onClick={prev} aria-label="Назад"><Icon n="prev" /></button>
        <span className="num">{idx + 1} / {n}{byClick && total > 0 ? ` · ${Math.min(step, total)}/${total}` : ''}</span>
        <button className="iconbtn" onClick={next} aria-label="Дальше"><Icon n="next" /></button>
        <span className="show-sep" />
        <button className={`show-tg ${byClick ? 'on' : ''}`} onClick={() => { const v = !byClick; setByClick(v); setStep(0); localStorage.setItem('deck-click', v ? '1' : '0') }} title="Пункты появляются по щелчку, как в PowerPoint">По щелчку</button>
        <button className={`show-tg ${notes ? 'on' : ''}`} onClick={() => setNotes(!notes)} title="Клавиша N"><Icon n="note" s={16} />Заметки</button>
        <span className="show-clock" title="Сколько идёт показ"><Icon n="timer" s={16} />{clock}</span>
        <button className="iconbtn" onClick={() => { if (document.fullscreenElement) document.exitFullscreen().catch(() => null); else root.current?.requestFullscreen().catch(() => null) }} aria-label="Полный экран (F)"><Icon n="full" /></button>
        <button className="iconbtn" onClick={close} aria-label="Закончить показ (Esc)"><Icon n="close" /></button>
      </div>
    </div>,
    document.body,
  )
}

const lines = (v: string) => v.split('\n').map((x) => x.trim()).filter(Boolean)

/** Editing one slide: text, kind, formula, steps, question with an answer, picture, note */
export function SlideEditor({ s, onChange }: { s: Slide; onChange: (s: Slide) => void }) {
  const set = (p: Partial<Slide>) => onChange({ ...s, ...p })
  return (
    <div className="deck-edit">
      <div className="field" style={{ flex: '2 1 260px' }}><label>Заголовок</label><input className="input" value={s.title} maxLength={140} onChange={(e) => set({ title: e.target.value })} /></div>
      <div className="field" style={{ flex: '1 1 170px' }}><label>Вид слайда</label>
        <select className="input" value={s.kind ?? 'other'} onChange={(e) => set({ kind: e.target.value })}>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      <div className="field" style={{ flex: '1 1 100%' }}><label>{s.kind === 'example' ? 'Условие, по строке' : s.kind === 'title' ? 'Подзаголовок (первая строка) и ещё строки' : 'Пункты, каждый с новой строки'}</label>
        <textarea className="input" rows={4} value={(s.bullets ?? []).join('\n')} onChange={(e) => set({ bullets: lines(e.target.value) })} /></div>
      {s.kind === 'example' && <div className="field" style={{ flex: '1 1 100%' }}><label>Шаги решения, по строке (появляются по одному)</label>
        <textarea className="input" rows={4} value={(s.steps ?? []).join('\n')} onChange={(e) => set({ steps: lines(e.target.value) })} /></div>}
      {s.kind === 'quiz' && <>
        <div className="field" style={{ flex: '2 1 260px' }}><label>Вопрос</label><input className="input" value={s.question ?? ''} maxLength={300} onChange={(e) => set({ question: e.target.value })} /></div>
        <div className="field" style={{ flex: '1 1 200px' }}><label>Ответ (откроется по щелчку)</label><input className="input" value={s.answer ?? ''} maxLength={300} onChange={(e) => set({ answer: e.target.value })} /></div>
      </>}
      <div className="field" style={{ flex: '2 1 240px' }}><label>Формула в рамке</label><input className="input" value={s.formula ?? ''} maxLength={160} placeholder="например, a² + b² = c²" onChange={(e) => set({ formula: e.target.value })} /></div>
      <div className="field" style={{ flex: '1 1 200px' }}><label>Рисунок</label>
        <select className="input" value={s.fig ?? ''} onChange={(e) => set({ fig: e.target.value })}><option value="">без рисунка</option>{Object.entries(FIG_KEYS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      <div className="field" style={{ flex: '0 1 140px' }}><label>Страница</label><input className="input" value={s.page ?? ''} maxLength={30} placeholder="стр. 112" onChange={(e) => set({ page: e.target.value })} /></div>
      <div className="field" style={{ flex: '1 1 100%' }}><label>Заметка учителю (на слайде её нет)</label>
        <textarea className="input" rows={2} value={s.note ?? ''} maxLength={400} onChange={(e) => set({ note: e.target.value })} /></div>
    </div>
  )
}
