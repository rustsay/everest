import { useEffect, useRef, useState } from 'react'
import { sendEvent } from '../api/client'
import { useApp } from '../app/store'
import { Icon, StarBot, hush, plural, reduceMotion, speak } from '../design/ui'
import { VTASK } from './videoData'

/** «Разборы»: 19 folders; inside each a board where Звёздочка writes the solution and explains it. */
export default function Videos() {
  const app = useApp()
  const n = app.view.id ? +app.view.id : 0
  if (n >= 1 && n <= 19) return <Board key={n} n={n} />
  const done = app.dash?.vdone ?? {}
  const cnt = Object.keys(done).length
  const folder = (k: number) => {
    const v = VTASK[k], p2 = k >= 13, ok = done[String(k)]
    return (
      <button key={k} className={`folder ${p2 ? 'p2' : ''} ${ok ? 'ok' : ''}`} onClick={() => app.go({ v: 'video', id: String(k) })} style={{ animation: `rise .35s ${(k * 0.025).toFixed(3)}s both` }}>
        <svg width="44" height="34" viewBox="0 0 40 32" aria-hidden="true">
          <path d="M2 6a3 3 0 0 1 3-3h10l4 4h16a3 3 0 0 1 3 3v17a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3z" fill={p2 ? 'var(--gold-soft)' : 'var(--em-soft)'} stroke={p2 ? 'var(--gold)' : 'var(--em-3)'} strokeWidth={2} />
          <text x="20" y="23" textAnchor="middle" fontSize="12" fontWeight="800" fill={p2 ? 'var(--gold-ink)' : 'var(--em-ink)'}>{k}</text>
        </svg>
        <b>Задание {k}</b><span className="muted">{v.t}</span>
        <span className="f-meta">{ok ? <span className="pill p-em">понял ✓</span> : <span className="muted">{v.s.length} {plural(v.s.length, 'шаг', 'шага', 'шагов')}</span>}</span>
      </button>
    )
  }
  return (
    <>
      <div className="card-h" style={{ margin: 0 }}><div><p className="muted">Видеоразборы</p><h1>Разборы всех заданий</h1></div><span className="pill p-em num">понял {cnt} из 19</span></div>
      <div className="bar" style={{ height: 10 }}><i style={{ width: `${(cnt / 19) * 100}%`, background: 'var(--em-3)' }} /></div>
      <section><h2 style={{ marginBottom: 12 }}>Часть 1 · задания 1-12</h2><div className="folders">{Array.from({ length: 12 }, (_, i) => folder(i + 1))}</div></section>
      <section><h2 style={{ marginBottom: 12 }}>Часть 2 · задания 13-19</h2><div className="folders">{Array.from({ length: 7 }, (_, i) => folder(i + 13))}</div></section>
      <p className="muted" style={{ fontSize: 12.5 }}>Разборы собраны на типовых задачах в формате ЕГЭ. Звёздочка пишет на доске и рассказывает. Голос включается в её пузыре.</p>
    </>
  )
}

function Board({ n }: { n: number }) {
  const app = useApp()
  const v = VTASK[n]
  const [k, setK] = useState(0)
  const [c, setC] = useState(0)
  const [say, setSay] = useState(0)
  const [playing, setPlaying] = useState(!reduceMotion)
  const [end, setEnd] = useState(false)
  const [speed, setSpeed] = useState(1)
  const timers = useRef<number[]>([])
  const st = v.s[k]
  const total = st[1].join('').length

  useEffect(() => {
    timers.current.forEach(clearTimeout)
    timers.current = []
    if (!playing) { setC(Infinity); setSay(Infinity); return }
    setC(0); setSay(0)
    if (app.voice) speak(st[2])
    const typeMs = 55 / speed, sayMs = 30 / speed
    const iv = window.setInterval(() => setC((x) => x + 1), typeMs)
    const iv2 = window.setInterval(() => setSay((x) => x + 1), sayMs)
    const wait = Math.max(total * typeMs, st[2].length * sayMs) + 1400 + (app.voice ? Math.max(0, st[2].length * 70 - total * typeMs) : 0)
    timers.current.push(window.setTimeout(() => {
      clearInterval(iv); clearInterval(iv2)
      if (k < v.s.length - 1) setK(k + 1)
      else { setPlaying(false); setEnd(true); app.say('Разбор закончен. Если понял, жми «Понял» и переходи к следующему заданию.') }
    }, wait))
    return () => { clearInterval(iv); clearInterval(iv2); timers.current.forEach(clearTimeout); hush() }
  }, [k, playing, speed]) // eslint-disable-line react-hooks/exhaustive-deps

  const lines: { t: string; cls: string }[] = []
  const old: string[] = []
  for (let i = 0; i < k; i++) old.push(...v.s[i][1])
  old.slice(-3).forEach((t) => lines.push({ t, cls: 'old' }))
  let left = c
  for (const f of st[1]) {
    if (left <= 0) break
    const shown = f.slice(0, left)
    left -= f.length
    lines.push({ t: shown, cls: shown.length < f.length ? 'cur' : '' })
  }
  const talk = playing && say < st[2].length
  const got = async () => {
    const first = !app.dash?.vdone?.[String(n)]
    await sendEvent('video', String(n)).catch(() => null)
    if (first) app.toast(`+40 м высоты · разбор задания ${n} понят`, 'gold')
    app.reload()
    if (n < 19) { app.go({ v: 'video', id: String(n + 1) }); app.toast(`Задание ${n + 1}: ${VTASK[n + 1].t}`) } else { app.go('video'); app.confetti() }
  }
  const notGot = () => app.go({ v: 'chat', id: `Видеоразбор задания ${n} («${v.t}»). Условие: ${v.c} Не понял шаг «${st[0]}»: ${st[1].join('; ')}. Объясни по-другому и начни с вопроса ко мне.` })

  return (
    <>
      <div className="v-head"><button className="btn btn-sm btn-ghost" onClick={() => app.go('video')}><Icon n="prev" s={16} />Все задания</button>
        <div style={{ minWidth: 0 }}><p className="muted">Видеоразбор · задание {n}</p><h1>{v.t}</h1></div></div>
      <div className="v-cond"><span className="label">Условие</span><p>{v.c}</p></div>
      <div className="row">
        <section style={{ flex: '1.5 1 440px', minWidth: 0 }} aria-label="Видеоразбор">
          <div className="board">
            <div className="board-top"><span className="label" style={{ color: 'var(--gold-hi)' }}>Шаг {k + 1} из {v.s.length} · {st[0]}</span><span className="board-n">№ {n}</span></div>
            <div className="board-lines" aria-live="polite">{lines.map((l, i) => <div key={i} className={`ln ${l.cls}`}>{l.t}</div>)}</div>
            <div className="board-say"><StarBot size={54} talk={talk} /><p className="say-b">{st[2].slice(0, say)}</p></div>
          </div>
          <div className="bprog">{v.s.map((_, i) => <i key={i} className={i < k || (end && i === k) ? 'done' : i === k ? 'cur' : ''} />)}</div>
          <div className="vctl">
            <button className="iconbtn" onClick={() => { setEnd(false); setK(0); setPlaying(true) }} aria-label="С начала"><Icon n="restart" s={18} /></button>
            <button className="iconbtn" disabled={k === 0} onClick={() => { setEnd(false); setK(Math.max(0, k - 1)); setPlaying(true) }} aria-label="Предыдущий шаг"><Icon n="prev" /></button>
            <button className="iconbtn play" onClick={() => { if (end) { setEnd(false); setK(0) } setPlaying(!playing || end) }} aria-label={playing ? 'Пауза' : 'Смотреть'}>
              {playing ? <svg width="20" height="20" viewBox="0 0 24 24" fill="#16231F" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
                : <svg width="20" height="20" viewBox="0 0 24 24" fill="#16231F" aria-hidden="true"><path d="M7 4v16l13-8z" /></svg>}
            </button>
            <button className="iconbtn" onClick={() => { if (k < v.s.length - 1) { setK(k + 1); setPlaying(true) } else { setPlaying(false); setEnd(true) } }} aria-label="Следующий шаг"><Icon n="next" /></button>
            <button className="chip" onClick={() => setSpeed(speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1)} aria-label="Скорость">{String(speed).replace('.', ',')}×</button>
          </div>
        </section>
        <section style={{ flex: '1 1 280px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }} className="steps" aria-label="Шаги решения">
          <h2>Шаги решения</h2>
          {v.s.map((s, i) => <button key={i} aria-current={i === k ? 'step' : undefined} onClick={() => { setEnd(false); setK(i); setPlaying(true) }}><span>{i + 1}. {s[0]}</span><span>{i < k || app.dash?.vdone?.[String(n)] ? '✓' : ''}</span></button>)}
          {end && <p style={{ fontWeight: 700, marginTop: 6 }}>Разбор закончен. Всё понятно?</p>}
          <button className="btn btn-em" style={{ marginTop: 6 }} onClick={got}><Icon n="ok" s={18} />{n < 19 ? `Понял, к заданию ${n + 1}` : 'Понял, к списку заданий'}</button>
          <button className="btn btn-line" onClick={notGot}>Не понял</button>
          <button className="btn btn-ghost" onClick={() => app.go('check')}>Решить похожую и проверить</button>
        </section>
      </div>
    </>
  )
}
