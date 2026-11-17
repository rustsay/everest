import { FormEvent, ReactNode, useEffect, useState } from 'react'
import { finishDiagnostic, saveAnswer, skipDiagnostic, startDiagnostic } from '../api/client'
import type { DiagItem, DiagResult, DiagRun, ExamInfo } from '../types'
import { Icon, plural } from '../design/ui'

interface Props {
  mode: 'first' | 'mock'
  required: boolean
  exam: ExamInfo
  onFinished: (r: DiagResult) => void
  onSkip?: () => void
  onPause?: () => void
}

export default function Diagnostic({ mode, required, exam, onFinished, onSkip, onPause }: Props) {
  const [run, setRun] = useState<DiagRun | null>(null)
  const [phase, setPhase] = useState<'intro' | 'q' | 'finishing'>(mode === 'mock' ? 'q' : 'intro')
  const [i, setI] = useState(0)
  const [err, setErr] = useState('')

  useEffect(() => {
    startDiagnostic(mode).then((r) => { setRun(r); setI(Math.min(r.position, r.items.length - 1)) }).catch((e) => setErr(String(e).replace('Error: ', '')))
  }, [mode])

  const answer = async (value: string) => {
    if (!run) return
    const it = run.items[i]
    const answers = { ...run.answers, [it.id]: value }
    setRun({ ...run, answers })
    saveAnswer(run.id, it.id, value, i + 1).catch(() => { /* retried on finish: answers stay in memory */ })
    if (i + 1 < run.items.length) { setI(i + 1); return }
    setPhase('finishing')
    try {
      // make sure every answer reached the server before scoring
      await Promise.all(Object.entries(answers).map(([k, v], idx) => saveAnswer(run.id, k, v, idx + 1)))
      onFinished(await finishDiagnostic(run.id))
    } catch (e) { setErr(String(e).replace('Error: ', '')); setPhase('q') }
  }

  if (err && !run) return <Frame><p className="auth-msg">{err}</p></Frame>
  if (!run) return <Frame><p className="ob-sub">Готовлю задания…</p></Frame>

  if (phase === 'intro') {
    const nNum = run.items.filter((x) => x.t === 'num').length, nSelf = run.items.length - nNum
    const resume = run.position > 0
    return (
      <Frame>
        <div className="ob-intro">
          <span className="ob-badge"><Icon n="flag" s={18} />{required ? 'Обязательный шаг' : 'По желанию'}</span>
          <h1 className="ob-h">Диагностика</h1>
          <p className="ob-sub">
            {exam.key === 'prof' ? 'Задания из демоверсии ЕГЭ 2027 года (ФИПИ): ' : exam.key === 'oge' ? 'Задания в формате ОГЭ: ' : exam.key === 'g10' ? 'Только темы, которые прошли с 1 сентября: ' : ''}
            {nNum} {plural(nNum, 'задание', 'задания', 'заданий')} с ответом{nSelf ? ` и ${nSelf} ${plural(nSelf, 'задание', 'задания', 'заданий')} второй части, где честно оценишь себя` : ''}.
          </p>
          <ul className="ob-rules">
            <li>Пиши ответ числом. Не знаешь - жми «Не знаю», это честнее, чем угадывать.</li>
            <li>Правильные ответы не показываю до конца: это проверка, а не урок.</li>
            <li>Можно сделать паузу, прогресс сохранится.</li>
            <li>По ответам посчитаю прогноз, найду первопричину ошибок и соберу расписание.</li>
          </ul>
          <button className="btn btn-em ob-go" onClick={() => setPhase('q')}>{resume ? `Продолжить с задания ${i + 1}` : 'Начать диагностику'}</button>
          {!required && onSkip && <button className="ob-link" onClick={async () => { await skipDiagnostic().catch(() => null); onSkip() }}>Пропустить</button>}
        </div>
      </Frame>
    )
  }

  if (phase === 'finishing') return <Frame><p className="ob-sub">Считаю результат…</p></Frame>

  const it = run.items[i], n = run.items.length
  return (
    <Frame top={<button className="ob-link" onClick={() => { if (mode === 'mock') onPause?.(); else setPhase('intro') }}>Пауза</button>}>
      <div className="q-prog"><span style={{ width: `${(i / n) * 100}%` }} /></div>
      <p className="q-meta">{mode === 'mock' ? 'Пробник' : 'Диагностика'} · {i + 1} из {n}{it.n ? ` · ${it.t === 'self' ? 'часть 2' : 'часть 1'}, задание № ${it.n}` : ''}</p>
      <div className="q-text">{it.q.split('\n').map((l, k) => <span key={k}>{l}<br /></span>)}</div>
      {it.fig && <Figure k={it.fig} />}
      <p className="q-src">{it.src}</p>
      {it.t === 'self' ? <SelfAssess item={it} value={run.answers[it.id]} onPick={answer} /> : <NumAnswer key={it.id} initial={run.answers[it.id]} onAnswer={answer} />}
      {err && <p className="auth-msg">{err}</p>}
    </Frame>
  )
}

function Frame({ children, top }: { children: ReactNode; top?: ReactNode }) {
  return (
    <div className="ob">
      <div className="ob-top"><span /><span />{top}</div>
      <div className="ob-screen">{children}</div>
    </div>
  )
}

function NumAnswer({ initial, onAnswer }: { initial?: string; onAnswer: (v: string) => void }) {
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const v = String(new FormData(e.currentTarget).get('ans') || '').trim()
    if (v) onAnswer(v)
  }
  return (
    <>
      <form className="ob-form" onSubmit={submit}>
        <label htmlFor="qIn" className="sr">Ответ</label>
        <input id="qIn" name="ans" className="input ob-input" inputMode="decimal" autoComplete="off" placeholder="Ответ" defaultValue={initial && initial !== '?' ? initial : ''} autoFocus={innerWidth > 900} />
        <button className="btn btn-em" type="submit">Дальше</button>
      </form>
      <button className="ob-link" onClick={() => onAnswer('?')}>Не знаю</button>
    </>
  )
}

function SelfAssess({ item, value, onPick }: { item: DiagItem; value?: string; onPick: (v: string) => void }) {
  const opts: [string, string, string][] = [['full', 'Решу полностью', 'с обоснованием каждого шага'], ['part', 'Решу частично', 'один пункт или только модель'], ['none', 'Не возьмусь', 'пока не знаю, как подступиться']]
  return (
    <>
      <p className="q-ask">Как бы ты справился с этим заданием (максимум {item.max} б.)? Будь честен: от этого зависит расписание.</p>
      <div className="ob-list">
        {opts.map(([v, l, s]) => (
          <button key={v} className={`ob-choice ${value === v ? 'on' : ''}`} onClick={() => onPick(v)}>
            <span><b>{l}</b><small>{s}</small></span><Icon n="next" s={18} />
          </button>
        ))}
      </div>
    </>
  )
}

/* ---------- figures for tasks 8 and 11 (drawn from the demo data) ---------- */
function Figure({ k }: { k: string }) {
  const grid = (x0: number, x1: number, y0: number, y1: number, s: number) => {
    const out = []
    for (let x = x0; x <= x1; x++) out.push(<line key={'x' + x} x1={(x - x0) * s} y1={0} x2={(x - x0) * s} y2={(y1 - y0) * s} stroke="#dfe6e2" />)
    for (let y = y0; y <= y1; y++) out.push(<line key={'y' + y} x1={0} y1={(y1 - y) * s} x2={(x1 - x0) * s} y2={(y1 - y) * s} stroke="#dfe6e2" />)
    return out
  }
  const axes = (x0: number, x1: number, y0: number, y1: number, s: number) => (
    <g>
      <line x1={0} y1={y1 * s} x2={(x1 - x0) * s} y2={y1 * s} stroke="#16231F" strokeWidth={1.4} />
      <line x1={-x0 * s} y1={0} x2={-x0 * s} y2={(y1 - y0) * s} stroke="#16231F" strokeWidth={1.4} />
      <text x={(x1 - x0) * s - 10} y={y1 * s - 6} fontSize={13} fontStyle="italic">x</text>
      <text x={-x0 * s + 6} y={12} fontSize={13} fontStyle="italic">y</text>
      <text x={-x0 * s - 12} y={y1 * s + 14} fontSize={12}>0</text>
    </g>
  )
  const curve = (f: (x: number) => number, x0: number, y0: number, y1: number, s: number, a: number, b: number) => {
    let d = '', pen = false
    for (let x = a; x <= b + 1e-9; x += 0.05) {
      const y = f(x)
      if (!isFinite(y) || y < y0 - 0.3 || y > y1 + 0.3) { pen = false; continue }
      d += `${pen ? 'L' : 'M'}${((x - x0) * s).toFixed(1)} ${((y1 - y) * s).toFixed(1)} `
      pen = true
    }
    return <path d={d.trim()} fill="none" stroke="#174A3C" strokeWidth={2.4} />
  }
  const dot = (x: number, y: number, x0: number, y1: number, s: number) => <circle cx={(x - x0) * s} cy={(y1 - y) * s} r={4} fill="#C8372D" />
  if (k === 'tangent') {
    const [x0, x1, y0, y1, s] = [-3, 6, -1, 5, 34]
    const f = (x: number) => 2.6 - 0.2 * (x - 1) - 0.4 * (x - 1) * (x - 1), L = (x: number) => 3 - 0.2 * (x + 1)
    return (
      <svg viewBox={`-6 -6 ${(x1 - x0) * s + 12} ${(y1 - y0) * s + 12}`} className="qfig" role="img" aria-label="График функции и касательная">
        {grid(x0, x1, y0, y1, s)}{axes(x0, x1, y0, y1, s)}{curve(f, x0, y0, y1, s, -1.6, 3.6)}
        <line x1={0} y1={(y1 - L(-3)) * s} x2={(6 - x0) * s} y2={(y1 - L(6)) * s} stroke="#16231F" strokeWidth={1.6} />
        {dot(-1, 3, x0, y1, s)}{dot(4, 2, x0, y1, s)}
        <line x1={(1 - x0) * s} y1={(y1 - 2.6) * s} x2={(1 - x0) * s} y2={y1 * s} stroke="#16231F" strokeDasharray="4 4" />
        <text x={(1 - x0) * s - 6} y={y1 * s + 16} fontSize={13} fontStyle="italic">x₀</text>
        <text x={(4 - x0) * s - 4} y={y1 * s + 16} fontSize={12}>4</text>
        <text x={(-1 - x0) * s - 8} y={y1 * s + 16} fontSize={12}>−1</text>
      </svg>
    )
  }
  if (k === 'hyper') {
    const [x0, x1, y0, y1, s] = [-4, 7, -4, 7, 26]
    return (
      <svg viewBox={`-6 -6 ${(x1 - x0) * s + 12} ${(y1 - y0) * s + 12}`} className="qfig" role="img" aria-label="График функции k/x">
        {grid(x0, x1, y0, y1, s)}{axes(x0, x1, y0, y1, s)}
        {curve((x) => 5 / x, x0, y0, y1, s, 0.72, 7)}{curve((x) => 5 / x, x0, y0, y1, s, -4, -0.72)}
        {dot(1, 5, x0, y1, s)}{dot(5, 1, x0, y1, s)}
        <text x={(1 - x0) * s - 4} y={y1 * s + 16} fontSize={12}>1</text>
        <text x={(5 - x0) * s - 4} y={y1 * s + 16} fontSize={12}>5</text>
        <text x={-x0 * s - 14} y={(y1 - 1) * s + 4} fontSize={12}>1</text>
      </svg>
    )
  }
  if (k === 'expo') {
    const [x0, x1, y0, y1, s] = [-3, 4, -1, 7, 30]
    return (
      <svg viewBox={`-6 -6 ${(x1 - x0) * s + 12} ${(y1 - y0) * s + 12}`} className="qfig" role="img" aria-label="График показательной функции">
        {grid(x0, x1, y0, y1, s)}{axes(x0, x1, y0, y1, s)}{curve((x) => Math.pow(0.25, x), x0, y0, y1, s, -1.4, 4)}
        {dot(-1, 4, x0, y1, s)}{dot(0, 1, x0, y1, s)}
        <text x={(-1 - x0) * s - 10} y={y1 * s + 16} fontSize={12}>−1</text>
        <text x={-x0 * s - 14} y={(y1 - 4) * s + 4} fontSize={12}>4</text>
        <text x={(1 - x0) * s - 4} y={y1 * s + 16} fontSize={12}>1</text>
      </svg>
    )
  }
  return null
}
