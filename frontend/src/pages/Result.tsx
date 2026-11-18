import { useEffect, useRef, useState } from 'react'
import { putSettings } from '../api/client'
import type { DiagResult, Target } from '../types'
import { TargetPick } from './Plan'
import { StarBot, Typed, chime, reduceMotion } from '../design/ui'

/** Dark calm screen: the star lights up with a chime, the score counts up, the star speaks. */
export default function Result({ r, name, sound, onGo }: { r: DiagResult; name: string; sound: boolean; onGo: () => void }) {
  const [lit, setLit] = useState(reduceMotion)
  const [label, setLabel] = useState(reduceMotion)
  const [num, setNum] = useState(reduceMotion ? r.value : 0)
  const [speak, setSpeak] = useState(reduceMotion)
  const [talk, setTalk] = useState(false)
  const [cards, setCards] = useState(reduceMotion)
  const [go, setGo] = useState(reduceMotion)
  const [snd, setSnd] = useState(sound)
  const [target, setTargetV] = useState<Target | null>(null)
  const needGoal = r.exam.key === 'prof' && r.mode === 'first'
  const sndRef = useRef(snd)
  sndRef.current = snd

  useEffect(() => {
    if (reduceMotion) return
    const t: number[] = []
    t.push(window.setTimeout(() => { setLit(true); if (sndRef.current) chime(false) }, 700))
    t.push(window.setTimeout(() => {
      setLabel(true)
      const t0 = performance.now()
      const stp = (now: number) => {
        const k = Math.min(1, (now - t0) / 1300)
        setNum(Math.round(r.value * (1 - Math.pow(1 - k, 3))))
        if (k < 1) requestAnimationFrame(stp)
        else if (sndRef.current) chime(true)
      }
      requestAnimationFrame(stp)
    }, 1500))
    t.push(window.setTimeout(() => setSpeak(true), 3200))
    return () => t.forEach(clearTimeout)
  }, [r.value])

  const ex = r.exam
  const delta = r.prev != null ? r.value - r.prev : null
  const line = r.mode === 'mock'
    ? `Пробник № ${r.mocks} готов. ${ex.pct ? 'Готовность' : 'Прогноз'}: ${r.value}${ex.pct ? '%' : ''}. ${delta == null ? '' : delta >= 0 ? `Это взлёт: +${delta}.` : `Небольшое падение: ${delta}. Бывает, расписание уже перестроено.`}`
    : `Привет, ${name}! Я Звёздочка. Я посмотрела твою диагностику: ${r.right} из ${r.of} заданий с ответом решены верно. ${r.strong.length ? 'Сильнее всего: ' + r.strong.map((s) => s.toLowerCase()).join(', ') + '. ' : ''}${r.root_name ? (r.basics ? `Почти все задания пока не получились, поэтому начнём с основ: «${r.root_name.toLowerCase()}». ` : `Ошибки тянутся из темы «${r.root_name.toLowerCase()}», с неё и начнём. `) : ''}Я уже собрала тебе расписание. Пойдём, покажу платформу?`

  return (
    <div className="ob dark">
      <div className="ob-top"><span /><span /></div>
      <div className="ob-screen">
        <div className="res">
          <div className={`res-star ${lit ? 'lit' : ''}`}>
            <StarBot size={170} talk={talk} />
            <span className="res-glow" />
            {Array.from({ length: 10 }, (_, i) => <i key={i} className="ray" style={{ ['--a' as string]: `${i * 36}deg` }} />)}
          </div>
          <p className={`res-label ${label ? 'on' : ''}`}>{ex.label}</p>
          <div className="res-num"><span className="num">{num}</span><span>{ex.pct ? '%' : ` из ${ex.max}`}</span></div>
          <div className="res-say">
            {speak ? <Typed text={line} speed={26} onTyping={setTalk} onDone={() => { setTimeout(() => setCards(true), 200); setTimeout(() => setGo(true), 600) }} /> : <p className="tw" />}
          </div>
          <div className={`res-cards ${cards ? 'on' : ''}`}>
            <div className="rc"><span className="label">Получилось</span><b>{r.right} из {r.of}</b><small>задания с ответом</small></div>
            <div className="rc"><span className="label">Сильные</span><b>{r.strong.length ? r.strong.join(', ') : 'пока не выделились'}</b></div>
            <div className="rc"><span className="label">Начнём с</span><b>{r.root_name ?? (r.weak[0] || 'закрепления')}</b>{r.root_name && <small>{r.basics ? 'начинаем с основ' : 'первопричина ошибок'}</small>}</div>
            <div className="rc"><span className="label">Расписание</span><b>{r.plan.studied} занятий</b><small>{r.plan.days} дней в неделю по {r.plan.min} минут</small></div>
          </div>
          {needGoal && <div className={`res-goal ${go ? 'on' : ''}`}>
            <p className="res-label on">На сколько баллов хочешь сдать?</p>
            <TargetPick value={target} onSaved={setTargetV} />
            <small>От цели зависит, какие задания нужны и будет ли в расписании вторая часть. Поменять можно в расписании.</small>
          </div>}
          <div className={`res-go ${go ? 'on' : ''}`}>
            <button className="btn btn-gold ob-go" disabled={needGoal && !target} onClick={onGo}>{r.mode === 'mock' ? 'К платформе' : 'Покажи платформу'}</button>
            <button className="ob-link light" onClick={() => { const v = !snd; setSnd(v); putSettings({ sound: v }).catch(() => null) }}>{snd ? 'звук включён' : 'звук выключен'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
