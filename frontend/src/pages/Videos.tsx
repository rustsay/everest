import { useEffect, useState } from 'react'
import SolutionBoard from '../components/SolutionBoard'
import GeoFig from '../components/GeoFig'
import { getPractice, getWalkthrough, sendEvent } from '../api/client'
import { useApp } from '../app/store'
import { Icon, plural } from '../design/ui'
import { VTASK } from './videoData'
import GeneratedVideos from '../components/GeneratedVideos'
import ProblemText from '../components/ProblemText'
import type { PracticeItem, Walkthrough } from '../types'

/** «Разборы»: tabs 1-19. In each: the typical walkthrough of the task and walkthroughs of the bank problems.
 * Routes: #video (tab 1), #video/t5 (tab 5), #video/5 (typical board), #video/p-<ref> (bank problem), #video/custom-<id>. */
export default function Videos() {
  const app = useApp()
  const id = app.view.id ?? ''
  if (id.startsWith('custom-')) return <GeneratedVideos detailId={id.slice(7)} />
  if (id.startsWith('p-')) return <BankBoard key={id} r={id.slice(2)} />
  if (/^\d+$/.test(id) && +id >= 1 && +id <= 19) return <Board key={id} n={+id} />
  const tab = /^t\d+$/.test(id) ? Math.min(19, Math.max(1, +id.slice(1))) : 1
  return <List tab={tab} />
}

function List({ tab }: { tab: number }) {
  const app = useApp()
  const done = app.dash?.vdone ?? {}
  const cnt = Object.keys(done).length
  const [items, setItems] = useState<PracticeItem[] | null>(null)
  useEffect(() => {
    setItems(null)
    getPractice(tab).then((r) => setItems(r.items)).catch(() => setItems([]))
  }, [tab])
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
      <div className="card-h" style={{ margin: 0 }}><div><p className="muted">Видеоразборы</p><h1>Разборы заданий</h1></div><span className="pill p-em num">типовых понято {cnt} из 19</span></div>
      <GeneratedVideos />
      <section className="card">
        <div className="tm-tabs" aria-label="Задания">
          {Array.from({ length: 19 }, (_, i) => i + 1).map((k) => (
            <button key={k} className={`${k === tab ? 'on' : ''} ${k >= 13 ? 'p2' : ''}`} onClick={() => app.go({ v: 'video', id: 't' + k })}
              title={VTASK[k].t}>{k}{done[String(k)] ? <sup className="tm-cnt">✓</sup> : null}</button>
          ))}
        </div>
        <div className="vt-typ">
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="label">Типовой разбор · задание {tab}</p>
            <b>{v.t}</b>
            <p className="muted" style={{ fontSize: 13 }}>{v.s.length} {plural(v.s.length, 'шаг', 'шага', 'шагов')}{done[String(tab)] ? ' · понял ✓' : ''}</p>
          </div>
          <button className="btn btn-em" onClick={() => app.go({ v: 'video', id: String(tab) })}><Icon n="play" s={18} />Смотреть</button>
        </div>
      </section>

      <section>
        <h2 style={{ marginBottom: 6 }}>Задачи банка · задание {tab}</h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 10 }}>Звёздочка разбирает на доске любую задачу банка. Разбор собирается один раз и потом открывается сразу.</p>
        {items == null && <p className="muted">Загружаю задачи…</p>}
        {items?.length === 0 && <p className="muted">По этому заданию в банке пока нет задач: их добавляет учитель.</p>}
        <div style={{ display: 'grid', gap: 10 }}>
          {items?.map((it, i) => (
            <div key={it.ref}>
              {(i === 0 || items[i - 1].proto !== it.proto) && <p className="label" style={{ margin: i ? '12px 0 6px 4px' : '0 0 6px 4px' }}>{it.proto_name || 'Без прототипа'}</p>}
              <div className="card vt-item">
                {it.fig && !it.img && <div className="vt-fig"><GeoFig k={it.fig} w={96} /></div>}
                <div className="vt-q"><ProblemText q={it.q} img={it.img} /></div>
                <div className="vt-act">
                  {it.done != null && <span className={`pill ${it.done ? 'p-em' : 'p-gold'}`}>{it.done ? 'решена' : 'не решена'}</span>}
                  <button className="btn btn-sm btn-line" onClick={() => open(it)}><Icon n="play" s={16} />Разбор на доске</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
      <p className="muted" style={{ fontSize: 12.5 }}>Типовые разборы собраны на задачах в формате ЕГЭ. Разборы задач банка строятся по условию, ответу и решению из банка. Голос включается в пузыре Звёздочки.</p>
    </>
  )
}

function BankBoard({ r }: { r: string }) {
  const app = useApp()
  const [w, setW] = useState<Walkthrough | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { getWalkthrough(r).then(setW).catch((e) => setErr(e instanceof Error ? e.message : 'Не удалось собрать разбор')) }, [r])
  const back = (n?: number) => app.go({ v: 'video', id: 't' + (n ?? w?.task ?? 1) })
  if (err) return (
    <section className="card" style={{ display: 'grid', gap: 10 }}>
      <h2>Разбор не получился</h2><p className="muted">{err}</p>
      <div><button className="btn btn-line" onClick={() => back()}><Icon n="prev" s={16} />К задачам</button></div>
    </section>
  )
  if (!w) return <section className="card"><p className="muted">Звёздочка готовит разбор. Первый раз это занимает до минуты.</p></section>
  const task = { t: w.title, c: w.q, s: w.steps.map((s) => [s.title, s.lines, s.text] as [string, string[], string]) }
  return <SolutionBoard n={w.task} proto={w.fig} img={w.img} task={task} label={`Разбор · задание ${w.task} · банк задач`} backLabel="К задачам" doneLabel="Понял, к задачам"
    onBack={() => back()}
    onUnderstood={() => { app.toast('Отлично! Попробуй похожую задачу сам'); back() }}
    onNotUnderstood={(step) => app.go({ v: 'chat', id: `Разбор задачи из банка (задание ${w.task}). Условие: ${w.q} Не понял шаг «${step[0]}»: ${step[1].join('; ')}. Объясни по-другому и начни с вопроса ко мне.` })} />
}

function Board({ n }: { n: number }) {
  const app = useApp()
  const v = VTASK[n]
  return <SolutionBoard n={n} task={v} backLabel="К разборам" onBack={() => app.go({ v: 'video', id: 't' + n })} onUnderstood={async () => {
    const first = !app.dash?.vdone?.[String(n)]
    await sendEvent('video', String(n)).catch(() => null)
    if (first) app.toast(`+40 м высоты · разбор задания ${n} понят`, 'gold')
    app.reload()
    if (n < 19) { app.go({ v: 'video', id: String(n + 1) }); app.toast(`Задание ${n + 1}: ${VTASK[n + 1].t}`) } else { app.go('video'); app.confetti() }
  }} onNotUnderstood={(step) => app.go({ v: 'chat', id: `Разбор задания ${n} («${v.t}»). Условие: ${v.c} Не понял шаг «${step[0]}»: ${step[1].join('; ')}. Объясни по-другому и начни с вопроса ко мне.` })} />
}
