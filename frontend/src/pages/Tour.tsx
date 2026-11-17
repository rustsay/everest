import { useEffect, useRef, useState } from 'react'
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
  // the tour points at the first screen; if the user leaves it, the tour ends
  const { view } = useApp()
  const v0 = useRef(view.v)
  useEffect(() => { if (view.v !== v0.current) endRef.current() }, [view.v])

  useEffect(() => {
    if (i >= steps.length) { endRef.current(); return }
    const el = visibleEl(steps[i][0])
    if (!el) { setI(i + 1); return }
    el.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' })
    const t = setTimeout(() => setRect(el.getBoundingClientRect()), reduceMotion ? 0 : 380)
    return () => clearTimeout(t)
  }, [i, steps])

  if (i >= steps.length || !rect) return null
  const pad = 8, below = rect.bottom + 200 < innerHeight
  return (
    <div>
      <div className="tour-spot" style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />
      <div className="tour-bub" style={{ left: Math.max(16, Math.min(innerWidth - 336, rect.left)), ...(below ? { top: rect.bottom + 16 } : { bottom: innerHeight - rect.top + 16 }) }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <StarBot size={46} talk={talk} />
          <Typed key={i} text={steps[i][1]} speed={20} onTyping={setTalk} />
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
