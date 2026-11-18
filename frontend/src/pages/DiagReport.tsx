import { useEffect, useState } from 'react'
import { getDiagAnalytics, listDiagnostics } from '../api/client'
import { useApp } from '../app/store'
import type { DiagAnalytics, DiagListItem, DiagResult } from '../types'
import { Icon, fmtD } from '../design/ui'

const TONE: Record<string, string> = {
  ok: 'ok', full: 'ok', ok_doubt: 'mid', part: 'mid', slip: 'mid', unchecked: 'mid',
  method: 'bad', wrong: 'bad', dont_know: 'bad', none: 'bad', zero: 'bad',
}
const KINDS: [string, string][] = [['slip', 'ошибка в счёте'], ['method', 'не тот способ'], ['wrong', 'неверный ответ без фото'], ['dont_know', 'без ответа или «не знаю»'], ['part', 'часть баллов во 2 части'], ['zero', '0 баллов во 2 части']]

/** #diag - list of diagnostics and mocks; #diag/N - the full analytics of one of them. */
export default function DiagReport() {
  const app = useApp()
  const id = Number(app.view.id) || 0
  const [list, setList] = useState<DiagListItem[] | null>(null)
  const [r, setR] = useState<(DiagResult & { date: string | null; analytics: DiagAnalytics }) | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { listDiagnostics().then((x) => setList(x.items)).catch(() => setList([])) }, [])
  useEffect(() => {
    setR(null); setErr('')
    if (id) getDiagAnalytics(id).then(setR).catch((e) => setErr(String(e).replace('Error: ', '')))
  }, [id])
  const pick = id || list?.[0]?.id
  useEffect(() => { if (!id && pick) app.go({ v: 'diag', id: String(pick) }) }, [id, pick]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="card-h" style={{ margin: 0 }}>
        <div><p className="muted">Что получилось и где ошибки</p><h1>Разбор диагностики</h1></div>
        {list && list.length > 1 && (
          <select className="input" style={{ maxWidth: 280 }} value={id} onChange={(e) => app.go({ v: 'diag', id: e.target.value })} aria-label="Какую диагностику показать">
            {list.map((x, i) => <option key={x.id} value={x.id}>{x.mode === 'mock' ? `Пробник` : 'Диагностика'} {x.date ? fmtD(x.date) : ''}{i === 0 ? ' (последняя)' : ''}</option>)}
          </select>
        )}
      </div>
      {list?.length === 0 && <section className="card"><p>Диагностик пока нет. Пройди диагностику, и здесь появится разбор каждого задания.</p>
        <button className="btn btn-gold" style={{ marginTop: 10 }} onClick={() => dispatchEvent(new Event('everest:diag'))}>Пройти диагностику</button></section>}
      {err && <section className="card"><p className="muted">{err}</p></section>}
      {id > 0 && !r && !err && <section className="card"><p className="muted">Собираю разбор…</p></section>}
      {r && <DiagAnalyticsView r={r} a={r.analytics} />}
    </>
  )
}

export function DiagAnalyticsView({ r, a }: { r: DiagResult & { date?: string | null }; a: DiagAnalytics }) {
  const app = useApp()
  const [all, setAll] = useState(false)
  const rows = all ? a.rows : a.rows.filter((x) => TONE[x.kind] !== 'ok')
  return (
    <div className="da">
      <section className="card da-head">
        <div className="da-sum">
          <div><span className="label">{r.mode === 'mock' ? 'Пробник' : 'Диагностика'}{r.date ? ` · ${fmtD(r.date)}` : ''}</span>
            <b className="num">{r.value}{r.exam.pct ? '%' : ` из ${r.exam.max}`}</b><small className="muted">{r.exam.pct ? 'готовность' : 'прогноз'}</small></div>
          <div><span className="label">Первая часть</span><b className="num">{a.part1.pts} из {a.part1.max}</b><small className="muted">заданий верно</small></div>
          {a.part2 && <div><span className="label">Вторая часть</span><b className="num">{a.part2.pts} из {a.part2.max}</b><small className="muted">первичных баллов</small></div>}
        </div>
        {a.summary ? <p className="da-say"><b>Звёздочка:</b> {a.summary}</p>
          : <ul className="da-facts">{a.facts.map((f, i) => <li key={i}>{f}</li>)}</ul>}
      </section>

      <div className="row" style={{ alignItems: 'stretch' }}>
        <section className="card" style={{ flex: '1 1 300px' }}>
          <h2>Где теряются баллы</h2>
          <div className="da-kinds">
            {KINDS.filter(([k]) => a.counts[k] || (k === 'dont_know' && a.counts.none)).map(([k, l]) => (
              <div key={k} className={`da-kind ${TONE[k]}`}><b className="num">{(a.counts[k] ?? 0) + (k === 'dont_know' ? a.counts.none ?? 0 : 0)}</b><span>{l}</span></div>
            ))}
            {!KINDS.some(([k]) => a.counts[k]) && <p className="muted">Потерь нет: всё решено верно.</p>}
          </div>
          {a.advice.length > 0 && <ul className="da-advice">{a.advice.map((x) => <li key={x.kind}><b>{x.tasks.join(', ')}.</b> {x.text}</li>)}</ul>}
        </section>
        <section className="card" style={{ flex: '1 1 300px' }}>
          <h2>По блокам</h2>
          <div className="da-blocks">{a.blocks.map((b) => (
            <div key={b.name} className="da-block"><span>{b.name}</span>
              <div className="bar"><i style={{ width: `${b.pct}%`, background: b.pct >= 70 ? 'var(--em-3)' : b.pct >= 40 ? 'var(--gold)' : 'var(--bad)' }} /></div>
              <b className="num">{b.pct}%</b></div>
          ))}</div>
        </section>
      </div>

      {a.gains.length > 0 && (
        <section className="card">
          <h2>Быстрее всего прибавят баллы</h2>
          <ol className="da-gains">{a.gains.map((g) => (
            <li key={g.task}><b>{g.task}</b> <span className="muted">{g.name}</span> - {g.why}{g.pts > 0 ? <span className="pill p-em num">+{g.pts}</span> : null}
              {/^№ \d+$/.test(g.task) && <button className="btn btn-sm btn-ghost" onClick={() => app.go({ v: 'task', id: g.task.slice(2) })}>Карта задания</button>}</li>
          ))}</ol>
        </section>
      )}

      <section className="card">
        <div className="card-h"><h2>По заданиям</h2>
          <button className="btn btn-sm btn-line" onClick={() => setAll(!all)}>{all ? 'Только ошибки' : `Показать все (${a.rows.length})`}</button></div>
        {rows.length === 0 && <p className="muted">Ошибок нет.</p>}
        <div className="da-rows">{rows.map((x) => (
          <div key={x.id} className={`da-row ${TONE[x.kind]}`}>
            <span className="da-n">{x.n ? `№ ${x.n}` : '•'}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="da-t"><b>{x.name}</b><span className={`pill ${TONE[x.kind] === 'ok' ? 'p-em' : TONE[x.kind] === 'mid' ? 'p-gold' : 'p-bad'}`}>{x.label}{x.part === 2 ? ` · ${x.pts} из ${x.max}` : ''}</span></div>
              {x.answer != null && x.right != null && TONE[x.kind] !== 'ok' && <p className="da-ans">Твой ответ: <b>{x.answer}</b> · верный: <b>{x.right}</b></p>}
              {x.note && <p className="da-note">{x.note}</p>}
              {x.errors.length > 0 && <ul className="da-err">{x.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
              {x.topics.length > 0 && TONE[x.kind] !== 'ok' && <p className="muted" style={{ fontSize: 12.5 }}>Темы: {x.topics.join(', ')}</p>}
            </div>
            {x.n && TONE[x.kind] !== 'ok' && <button className="btn btn-sm btn-ghost" onClick={() => app.go({ v: 'video', id: 't' + x.n })} title="Разборы этого задания"><Icon n="play" s={16} /></button>}
          </div>
        ))}</div>
      </section>
    </div>
  )
}
