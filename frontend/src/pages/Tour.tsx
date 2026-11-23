import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { StarBot, Typed, reduceMotion } from '../design/ui'
import { useApp } from '../app/store'

const STUDENT: [string, string][] = [
  ['.hero', 'Это твой прогноз. Он посчитан по ответам диагностики и меняется после каждой проверки и пробника.'],
  ['[aria-label="Маршрут на сегодня"]', 'Маршрут на сегодня: блоки из твоего расписания. Отмечай галочкой, что сделал.'],
  ['[data-v="plan"]', 'Здесь расписание до экзамена: каждое задание по чуть-чуть, слабые чаще.'],
  ['[data-v="check"]', 'Сфотографируй решение, и я проверю его по критериям ФИПИ.'],
  ['#streakChip', 'За дела ты получаешь звёзды. А ещё тут спрятаны секретные. Удачи!'],
]
const TEACHER: [string, string][] = [
  ['.class-code', 'Это код класса. Ученики вводят его в профиле, и их результаты появляются здесь.'],
  ['[data-v="materials"]', 'Здесь конспекты и презентации. Они строятся строго по прикреплённым учебникам.'],
  ['[data-v="tchat"]', 'А здесь помощник: план урока, кому помочь первым.'],
]

function visibleEl(sel: string): HTMLElement | null {
  return ([...document.querySelectorAll(sel)] as HTMLElement[]).find((e) => {
    const r = e.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }) ?? null
}

export default function Tour({ teacher, onEnd }: { teacher: boolean; onEnd: () => void }) {
  const steps = teacher ? TEACHER : STUDENT
  const endRef = useRef(onEnd)
  endRef.current = onEnd
  const [i, setI] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [talk, setTalk] = useState(false)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const [bubbleSize, setBubbleSize] = useState({ width: 320, height: 0 })
  const hasTarget = rect !== null
  // the tour points at the first screen; if the user leaves it, the tour ends
  const { view, dash } = useApp()
  const waitingForDashboard = !teacher && !dash
  const v0 = useRef(view.v)
  useEffect(() => { if (view.v !== v0.current) endRef.current() }, [view.v])

  useEffect(() => {
    if (waitingForDashboard) return
    if (i >= steps.length) { endRef.current(); return }
    const el = visibleEl(steps[i][0])
    if (!el) { setI(i + 1); return }
    let frame: number | null = null
    const updateRect = () => {
      frame = null
      setRect(el.getBoundingClientRect())
    }
    const scheduleUpdate = () => {
      if (frame === null) frame = requestAnimationFrame(updateRect)
    }
    // Capture scrolls from the page and any scrollable ancestor of the target.
    window.addEventListener('scroll', scheduleUpdate, { capture: true, passive: true })
    window.addEventListener('resize', scheduleUpdate)
    const observer = new ResizeObserver(scheduleUpdate)
    observer.observe(el)
    updateRect()
    el.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' })
    return () => {
      window.removeEventListener('scroll', scheduleUpdate, true)
      window.removeEventListener('resize', scheduleUpdate)
      observer.disconnect()
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [i, steps, waitingForDashboard])

  useLayoutEffect(() => {
    const bubble = bubbleRef.current
    if (!bubble) return
    const measure = () => setBubbleSize({ width: bubble.offsetWidth, height: bubble.offsetHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(bubble)
    return () => observer.disconnect()
  }, [i, hasTarget])

  if (i >= steps.length || !rect) return null
  const pad = 8, margin = 16, gap = 16
  const { width, height } = bubbleSize
  const clamp = (n: number, max: number) => Math.max(margin, Math.min(max, n))
  let left = rect.left, top = rect.bottom + gap
  if (top + height > innerHeight - margin) {
    if (rect.top - gap - height >= margin) {
      top = rect.top - gap - height
    } else if (rect.right + gap + width <= innerWidth - margin) {
      left = rect.right + gap
      top = rect.top
    } else if (rect.left - gap - width >= margin) {
      left = rect.left - gap - width
      top = rect.top
    } else if (rect.top > innerHeight - rect.bottom) {
      top = rect.top - gap - height
    }
  }
  left = clamp(left, innerWidth - width - margin)
  top = clamp(top, innerHeight - height - margin)
  const visible = height > 0 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth
  return (
    <div style={{ visibility: visible ? 'visible' : 'hidden' }}>
      <div className="tour-spot" style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />
      <div ref={bubbleRef} className="tour-bub" style={{ left, top }}>
        <div className="tour-message">
          <StarBot size={46} talk={talk} />
          <div className="tour-text">
            <p className="tw" aria-hidden="true" style={{ visibility: 'hidden' }}>{steps[i][1]}▍</p>
            <Typed key={i} text={steps[i][1]} speed={20} onTyping={setTalk} />
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
          <span className="muted num">{i + 1} из {steps.length}</span>
          <span style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-sm btn-ghost" onClick={onEnd}>Пропустить</button>
            <button className="btn btn-sm btn-em" onClick={() => { setRect(null); setI(i + 1) }}>{i === steps.length - 1 ? 'Готово' : 'Дальше'}</button>
          </span>
        </div>
      </div>
    </div>
  )
}
