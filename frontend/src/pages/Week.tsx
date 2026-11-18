import { FormEvent, useEffect, useState } from 'react'
import { classWeek, setParentEmail, weekReport } from '../api/client'
import { useApp } from '../app/store'
import type { ClassWeek, WeekReport } from '../types'
import { fmtD } from '../design/ui'

/** #report for a student: the last 7 days, the forecast, the goal, what is next; a weekly email to a parent. */
export default function WeekPage() {
  const app = useApp()
  const [w, setW] = useState<WeekReport | null>(null)
  useEffect(() => { weekReport().then(setW).catch(() => null) }, [])
  if (!w) return <p className="muted">Собираю итоги…</p>
  const unit = w.pct ? '%' : ` из ${w.max}`
  return (
    <>
      <div><p className="muted">{fmtD(w.from)} - {fmtD(w.to)}</p><h1>Итоги недели</h1></div>
      <section className="card">
        <div className="da-sum">
          <div><span className="label">Дней с занятиями</span><b className="num">{w.active} из 7</b></div>
          <div><span className="label">Задач решено</span><b className="num">{w.solved}</b><small className="muted">{w.acc != null ? `верно ${w.acc}%` : 'с первой попытки'}</small></div>
          <div><span className="label">Прогноз</span><b className="num">{w.forecast}{unit}</b>{w.delta != null && <small className={w.delta >= 0 ? 'up' : 'down'}>{w.delta > 0 ? '+' : ''}{w.delta} за неделю</small>}</div>
          {w.gap != null && <div><span className="label">До цели {w.target?.test}</span><b className="num">{w.gap ? `${w.gap} перв.` : 'достигнута'}</b></div>}
          {(w.checks + w.checks1) > 0 && <div><span className="label">Проверок по фото</span><b className="num">{w.checks + w.checks1}</b></div>}
          {w.fixed > 0 && <div><span className="label">Исправлено ошибок</span><b className="num">{w.fixed}</b></div>}
        </div>
        <ul className="da-facts">{w.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
        <div className="week-days" aria-label="Дни с занятиями">{Array.from({ length: 7 }, (_, i) => {
          const d = new Date(w.from); d.setDate(d.getDate() + i)
          const iso = d.toISOString().slice(0, 10)
          return <span key={i} className={w.active_days.includes(iso) ? 'on' : ''} title={fmtD(iso)}>{d.toLocaleDateString('ru-RU', { weekday: 'short' })}</span>
        })}</div>
      </section>
      {w.focus.length > 0 && (
        <section className="card"><h2>Что дальше</h2>
          <div className="tm-links" style={{ marginTop: 8 }}>{w.focus.map((f) => (
            <button key={f.task} className="item" onClick={() => app.go({ v: 'task', id: f.task.replace('№ ', '') })}>
              <span className="t-strong" style={{ flex: 1 }}>{f.task} · {f.name}</span><span className="pill p-gold num">{f.p}%</span></button>
          ))}</div>
          {w.redo_due > 0 && <button className="btn btn-gold" style={{ marginTop: 10 }} onClick={() => app.go('practice')}>Работа над ошибками: {w.redo_due}</button>}
        </section>
      )}
      <Parent w={w} />
    </>
  )
}

function Parent({ w }: { w: WeekReport }) {
  const app = useApp()
  const [mail, setMail] = useState(w.parent_email ?? '')
  const [saved, setSaved] = useState(w.parent_email ?? null)
  const save = async (e: FormEvent) => {
    e.preventDefault()
    try { const r = await setParentEmail(mail.trim() || null); setSaved(r.parent_email); app.toast(r.parent_email ? 'Почта сохранена' : 'Отчёт родителю выключен') }
    catch (err) { app.toast(String(err).replace('Error: ', '')) }
  }
  return (
    <section className="card">
      <h2>Отчёт родителю</h2>
      <p className="muted" style={{ fontSize: 13.5, marginTop: 4 }}>Раз в неделю, в понедельник, родитель получит на почту эти итоги. {w.smtp ? '' : 'Почтовый сервер пока не подключён: письма начнут уходить, когда его настроят.'}</p>
      <form className="mat-form" onSubmit={save} style={{ marginTop: 10 }}>
        <div className="field" style={{ flex: '1 1 240px' }}><label htmlFor="parMail">Почта родителя</label>
          <input id="parMail" className="input" type="email" value={mail} onChange={(e) => setMail(e.target.value)} placeholder="name@mail.ru" /></div>
        <button className="btn btn-em" type="submit">{saved && !mail.trim() ? 'Выключить' : 'Сохранить'}</button>
      </form>
    </section>
  )
}

/** #report for a teacher: the last 7 days of every student, the ones who need attention first. */
export function ClassReport() {
  const app = useApp()
  const [d, setD] = useState<ClassWeek | null>(null)
  useEffect(() => { classWeek().then(setD).catch(() => null) }, [])
  if (!d) return <p className="muted">Собираю итоги…</p>
  return (
    <>
      <div><p className="muted">{fmtD(d.from)} - {fmtD(d.to)}</p><h1>Итоги недели класса</h1></div>
      {d.classes.length === 0 && <section className="card"><p className="muted">Классов пока нет.</p></section>}
      {d.classes.map((c) => (
        <section key={c.id} className="card">
          <h2>{c.name}</h2>
          {c.students.length === 0 ? <p className="muted">В классе пока нет учеников.</p> : (
            <div className="stu-tw" style={{ marginTop: 10 }}><table className="stu-t">
              <thead><tr><th>Ученик</th><th>Дней</th><th>Задач</th><th>Верно</th><th>Фото</th><th>Прогноз</th><th>Ошибки ждут</th><th></th></tr></thead>
              <tbody>{c.students.map((s) => (
                <tr key={s.id} className={s.flag ? 'risk' : ''}>
                  <td><b>{s.name}</b>{s.flag && <small className="muted" style={{ display: 'block', color: 'var(--bad)' }}>{s.flag}</small>}</td>
                  <td className="num">{s.active}/7</td><td className="num">{s.solved}</td><td className="num">{s.acc != null ? `${s.acc}%` : '-'}</td>
                  <td className="num">{s.checks + s.checks1}</td>
                  <td className="num">{s.forecast}{s.pct ? '%' : ''}{s.delta != null && s.delta !== 0 ? <small className={s.delta > 0 ? 'up' : 'down'}> {s.delta > 0 ? '+' : ''}{s.delta}</small> : null}</td>
                  <td className="num">{s.redo_due || '-'}</td>
                  <td><button className="btn btn-sm btn-ghost" onClick={() => app.go({ v: 'tchat', id: `Что делать с учеником ${s.name}? За неделю: ${s.active} дней с занятиями, ${s.solved} задач, верно ${s.acc ?? 0}%, прогноз ${s.forecast}${s.delta != null ? ` (${s.delta > 0 ? '+' : ''}${s.delta})` : ''}.` })}>Совет</button></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
      ))}
    </>
  )
}
