import { useEffect, useState } from 'react'
import SolutionBoard from '../components/SolutionBoard'
import GeoFig from '../components/GeoFig'
import { getDiagnosticWalkthrough, getPractice, getWalkthrough, sendEvent } from '../api/client'
import { useApp } from '../app/store'
import { Icon, plural } from '../design/ui'
import { VTASK } from './videoData'
import type { Step } from './videoData'
import { TYPICAL_DIAGRAMS } from './videoGeometry'
import GeneratedVideos from '../components/GeneratedVideos'
import ProblemText from '../components/ProblemText'
import { examRange } from '../types'
import ExamSwitch from '../components/ExamSwitch'
import type { PracticeItem, Walkthrough } from '../types'
import type { DiagnosticWalkthrough } from '../types'
import { DiagnosticFigure } from './Diagnostic'

/** «Разборы»: tabs 1-19. In each: the typical walkthrough of the task and walkthroughs of the bank problems.
 * Routes: #video (tab 1), #video/t5 (tab 5), #video/5 (typical board), #video/p-<ref> (bank problem),
 * #video/diag-<diagnostic id>-<item id> (personal diagnostic walkthrough), #video/custom-<id>. */
export default function Videos() {
  const app = useApp()
  const id = app.view.id ?? ''
  const diagnostic = id.match(/^diag-(\d+)-(.+)$/)
  if (diagnostic) return <DiagnosticBoard key={id} diagnosticId={Number(diagnostic[1])} itemId={diagnostic[2]} />
  if (id.startsWith('custom-')) return <GeneratedVideos detailId={id.slice(7)} />
  if (id.startsWith('p-')) return <BankBoard key={id} r={id.slice(2)} />
  const ex = app.exam
  if (ex === 'prof' && /^\d+$/.test(id) && +id >= 1 && +id <= 19) return <Board key={id} n={+id} />
  const tab = /^t\d+$/.test(id) ? Math.min(examRange(ex).n, Math.max(1, +id.slice(1))) : 1
  return <List tab={tab} />
}

function List({ tab }: { tab: number }) {
  const app = useApp()
  const done = app.dash?.vdone ?? {}
  const cnt = Object.keys(done).length
  const [items, setItems] = useState<PracticeItem[] | null>(null)
  useEffect(() => {
    setItems(null)
    getPractice(tab, undefined, app.me.role === 'student' ? undefined : app.exam).then((r) => setItems(r.items.filter((x) => !x.analog))).catch(() => setItems([]))  // the board: prototypes only
  }, [tab, app.exam]) // eslint-disable-line react-hooks/exhaustive-deps
  const ex = app.exam
  const prof = ex === 'prof'  // typical walkthroughs are written for the profile exam; OGE and base have the bank problems on the board
  const range = examRange(ex)
  const v = VTASK[tab]
  const open = (it: PracticeItem) => {
    const go = () => { app.closeModal(); app.go({ v: 'video', id: 'p-' + it.ref }) }
    if (app.me.role !== 'student' || it.done != null || it.check === 'photo') return go()
    app.openModal('Разбор до решения', (
      <div style={{ display: 'grid', gap: 12 }}>
        <p>Ты ещё не решал эту задачу. Если открыть разбор сейчас, на карте задания она будет считаться нерешённой.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-em" onClick={() => { app.closeModal(); app.go({ v: 'practice', id: String(tab) }) }}>Сначала решу сам</button>
          <button className="btn btn-line" onClick={go}>Всё равно открыть разбор</button>
        </div>
      </div>
    ))
  }
  return (
    <>
      <div className="card-h" style={{ margin: 0 }}><div><p className="muted">Видеоразборы</p><h1>Разборы заданий</h1></div>{prof && app.me.role === 'student' && <span className="pill p-em num">типовых понято {cnt} из 19</span>}<ExamSwitch onChange={() => app.go({ v: 'video', id: 't1' })} /></div>
      <GeneratedVideos />
      <section className="card">
        <div className="tm-tabs" aria-label="Задания">
          {Array.from({ length: range.n }, (_, i) => i + 1).map((k) => (
            <button key={k} className={`${k === tab ? 'on' : ''} ${k >= range.p2 ? 'p2' : ''}`} onClick={() => app.go({ v: 'video', id: 't' + k })}
              title={prof ? VTASK[k].t : `Задание ${k}`}>{k}{prof && done[String(k)] ? <sup className="tm-cnt">✓</sup> : null}</button>
          ))}
        </div>
        {prof && <div className="vt-typ">
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="label">Типовой разбор · задание {tab}</p>
            <b>{v.t}</b>
            <p className="muted" style={{ fontSize: 13 }}>{v.s.length} {plural(v.s.length, 'шаг', 'шага', 'шагов')}{done[String(tab)] ? ' · понял ✓' : ''}</p>
          </div>
          <button className="btn btn-em" onClick={() => app.go({ v: 'video', id: String(tab) })}><Icon n="play" s={18} />Смотреть</button>
        </div>}
      </section>

      <section>
        <h2 style={{ marginBottom: 6 }}>Задачи банка · задание {tab}</h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 10 }}>Звёздочка разбирает на доске любую задачу банка. Разбор собирается один раз и потом открывается сразу.</p>
        {items == null && <p className="muted">Загружаю задачи…</p>}
        {items?.length === 0 && <p className="muted">По этому заданию в банке пока нет задач.</p>}
        <div style={{ display: 'grid', gap: 10 }}>
          {items?.map((it, i) => (
            <div key={it.ref}>
              {(i === 0 || items[i - 1].proto !== it.proto) && <p className="label" style={{ margin: i ? '12px 0 6px 4px' : '0 0 6px 4px' }}>{it.proto_name || 'Без прототипа'}</p>}
              <div className="card vt-item">
                {it.fig && !it.img && <div className="vt-fig"><GeoFig k={it.fig} w={96} /></div>}
                <div className="vt-q"><ProblemText q={it.q} img={it.img} ctx={it.ctx_img} small /></div>
                <div className="vt-act">
                  {it.done != null && <span className={`pill ${it.done ? 'p-em' : 'p-gold'}`}>{it.done ? 'решена' : 'не решена'}</span>}
                  <button className="btn btn-sm btn-line" onClick={() => open(it)}><Icon n="play" s={16} />Разбор на доске</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
      <p className="muted" style={{ fontSize: 12.5 }}>{prof ? 'Типовые разборы собраны на задачах в формате ЕГЭ. ' : ''} Разборы задач банка строятся по условию, ответу и решению из банка. Голос включается в пузыре Звёздочки.</p>
    </>
  )
}

function DiagnosticBoard({ diagnosticId, itemId }: { diagnosticId: number; itemId: string }) {
  const app = useApp()
  const [w, setW] = useState<DiagnosticWalkthrough | null>(null)
  const [err, setErr] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let disposed = false
    setErr(''); setW(null)
    getDiagnosticWalkthrough(diagnosticId, itemId).then((value) => { if (!disposed) setW(value) })
      .catch((e) => { if (!disposed) setErr(e instanceof Error ? e.message : 'Не удалось собрать разбор') })
    return () => { disposed = true }
  }, [diagnosticId, itemId, retry])
  const back = () => app.go({ v: 'diag', id: String(diagnosticId) })
  if (err) return <section className="card" style={{ display: 'grid', gap: 10 }}>
    <h2>Разбор не получился</h2><p className="muted">{err}</p>
    <div style={{ display: 'flex', gap: 8 }}><button className="btn btn-line" onClick={back}>К результатам</button><button className="btn btn-em" onClick={() => setRetry((n) => n + 1)}>Попробовать ещё раз</button></div>
  </section>
  if (!w) return <section className="card"><p className="muted">Готовлю разбор этой задачи с учётом твоего ответа и замечаний проверки…</p></section>
  const task = { t: w.title, c: w.q, s: w.steps.map((s): Step => [s.title, s.lines, s.text, s.explanation]) }
  return <SolutionBoard n={w.task ?? undefined} proto={null} task={task} img={w.img} ctx={w.ctx_img} feedback={w.feedback} diagram={w.diagram}
    conditionFigure={w.condition_fig ? <DiagnosticFigure k={w.condition_fig} /> : undefined}
    label="Разбор задачи из диагностики" backLabel="К результатам" doneLabel="Понял, к результатам"
    onBack={back} onUnderstood={back}
    onNotUnderstood={(step) => app.go({ v: 'chat', id: `Разбор моей задачи из диагностики${w.task ? ', задание ' + w.task : ''}. Условие: ${w.q}. Мой ответ: ${w.feedback.answer ?? 'нет ответа'}. Замечания проверки: ${w.feedback.note} ${w.feedback.errors.join('; ')}. Не понял шаг «${step[0]}»: ${step[1].join('; ')}. Объясни по-другому.` })} />
}

function BankBoard({ r }: { r: string }) {
  const app = useApp()
  const [w, setW] = useState<Walkthrough | null>(null)
  const [err, setErr] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let disposed = false
    setErr(''); setW(null)
    getWalkthrough(r).then((value) => { if (!disposed) setW(value) })
      .catch((e) => { if (!disposed) setErr(e instanceof Error ? e.message : 'Не удалось собрать разбор') })
    return () => { disposed = true }
  }, [r, retry])
  const back = (n?: number) => app.go({ v: 'video', id: 't' + (n ?? w?.task ?? 1) })
  if (err) return (
    <section className="card" style={{ display: 'grid', gap: 10 }}>
      <h2>Разбор не получился</h2><p className="muted">{err}</p>
      <div className="row"><button className="btn btn-line" onClick={() => back()}><Icon n="prev" s={16} />К задачам</button>
        <button className="btn btn-em" onClick={() => setRetry((n) => n + 1)}>Попробовать ещё раз</button></div>
    </section>
  )
  if (!w) return <section className="card"><p className="muted" role="status">Звёздочка готовит решение и проверяет построения. Это может занять несколько минут.</p></section>
  const task = { t: w.title, c: w.q, s: w.steps.map((s): Step => [s.title, s.lines, s.text, s.explanation]) }
  return <SolutionBoard n={w.task} proto={w.fig} img={w.img} ctx={w.ctx_img} task={task} diagram={w.diagram} label={`Разбор · задание ${w.task} · банк задач`} backLabel="К задачам" doneLabel="Понял, к задачам"
    onBack={() => back()}
    onUnderstood={() => { app.toast('Отлично! Попробуй похожую задачу сам'); back() }}
    onNotUnderstood={(step) => app.go({ v: 'chat', id: `Разбор задачи из банка (задание ${w.task}). Условие: ${w.q} Не понял шаг «${step[0]}»: ${step[1].join('; ')}. Объясни по-другому и начни с вопроса ко мне.` })} />
}

function Board({ n }: { n: number }) {
  const app = useApp()
  const v = VTASK[n]
  return <SolutionBoard n={n} task={v} diagram={TYPICAL_DIAGRAMS[n]} backLabel="К разборам" onBack={() => app.go({ v: 'video', id: 't' + n })} onUnderstood={async () => {
    const first = !app.dash?.vdone?.[String(n)]
    await sendEvent('video', String(n)).catch(() => null)
    if (first) app.toast(`+40 м высоты · разбор задания ${n} понят`, 'gold')
    app.reload()
    if (n < 19) { app.go({ v: 'video', id: String(n + 1) }); app.toast(`Задание ${n + 1}: ${VTASK[n + 1].t}`) } else { app.go('video'); app.confetti() }
  }} onNotUnderstood={(step) => app.go({ v: 'chat', id: `Разбор задания ${n} («${v.t}»). Условие: ${v.c} Не понял шаг «${step[0]}»: ${step[1].join('; ')}. Объясни по-другому и начни с вопроса ко мне.` })} />
}
