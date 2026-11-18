import { FormEvent, useCallback, useEffect, useState } from 'react'
import { createAssignment, createClass, deleteAssignment, reviewTask, teacherOverview, teacherStudent } from '../api/client'
import { useApp } from '../app/store'
import type { StudentDetail, TeacherOverview } from '../types'
import { Icon, fmtD, taskLabel } from '../design/ui'

export default function Teacher() {
  const app = useApp()
  const tutor = app.me.role === 'tutor'
  const [o, setO] = useState<TeacherOverview | null>(null)
  const [col, setCol] = useState(-1)
  const load = useCallback(() => teacherOverview().then(setO).catch((e) => app.toast(String(e).replace('Error: ', ''))), [app])
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!o) return <p className="muted">Загружаю…</p>
  const newClass = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const name = String(new FormData(e.currentTarget).get('name') || '').trim()
    if (!name) return
    const c = await createClass(name)
    app.toast(`Класс создан, код ${c.code}`)
    load()
  }
  const shade = (g: number | undefined, m: number): [string, string] => g == null ? ['var(--surface-2)', 'var(--muted)'] : g === 0 ? ['var(--gold-soft)', 'var(--gold-ink)'] : g === m ? ['var(--em)', 'var(--on-em)'] : g / m > 0.5 ? ['var(--em-3)', '#0F2A22'] : ['var(--em-soft)', 'var(--ink)']
  const avg = o.students.length ? Math.round(o.students.reduce((a, s) => a + (s.pct ? s.forecast : (s.forecast / s.max) * 100), 0) / o.students.length) : 0

  return (
    <>
      <div className="card-h" style={{ margin: 0 }}>
        <div><p className="muted">{tutor ? 'Кабинет репетитора' : 'Кабинет учителя'}</p><h1>{tutor ? 'Мои ученики' : 'Мои классы'}</h1></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-line" onClick={() => app.go('materials')}><Icon n="slides" s={18} />Конспект и презентация</button>
          {o.classes.length > 0 && <button className="btn btn-gold" onClick={() => app.openModal('Выдать работу', <AssignForm o={o} onDone={load} />)}><Icon n="plus" s={18} c="#16231F" />Выдать работу</button>}
        </div>
      </div>

      <section className="card">
        <div className="card-h"><h2>{tutor ? 'Группы' : 'Классы'}</h2><span className="muted" style={{ fontSize: 13 }}>ученик вводит код в своём профиле</span></div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {o.classes.map((c) => <div key={c.id} className="item" style={{ cursor: 'default', flex: '1 1 220px' }}><span style={{ flex: 1 }}><span className="t-strong">{c.name}</span><span className="t-sub">{c.student_ids.length} учеников</span></span><span className="pill p-gold class-code">{c.code}</span></div>)}
          <form onSubmit={newClass} style={{ display: 'flex', gap: 8, flex: '1 1 280px' }}>
            <input name="name" className="input" placeholder={tutor ? 'Название группы' : 'Например, 11 А'} maxLength={80} />
            <button className="btn btn-em" type="submit">Создать</button>
          </form>
        </div>
      </section>

      <div className="row stagger">
        {[['Средний прогноз', o.students.length ? avg + '%' : '-', 'от максимума экзамена'], ['Учеников', String(o.students.length), 'во всех классах'], ['Ждут решения', String(o.reviews.length), 'агенты разошлись']].map(([a, b, c], i) => (
          <section key={a} className="card" style={{ flex: '1 1 180px', ...(i === 2 && o.reviews.length ? { background: 'var(--gold-soft)', borderColor: 'var(--gold)' } : {}) }}>
            <span className="label">{a}</span><div style={{ fontFamily: 'var(--f-display)', fontSize: 30, marginTop: 4 }} className="num">{b}</div><p className="muted" style={{ fontSize: 13 }}>{c}</p>
          </section>
        ))}
      </div>

      <section className="card">
        <div className="card-h"><h2>Последние проверки по фото, задания 13-19</h2><span className="muted" style={{ fontSize: 13 }}>{col < 0 ? 'Нажмите номер задания или ученика' : `Выделено задание ${o.tasks[col].n}`}</span></div>
        {o.students.length === 0 ? <p className="muted">Пока никого нет. Дайте ученикам код класса: после диагностики и проверок их результаты появятся здесь.</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="heat">
              <thead><tr><th>Ученик</th>{o.tasks.map((t, ci) => <th key={t.n}><button className="colbtn" aria-pressed={col === ci} onClick={() => setCol(col === ci ? -1 : ci)}>№ {t.n}</button></th>)}<th>Прогноз</th></tr></thead>
              <tbody>{o.students.map((s) => (
                <tr key={s.id}>
                  <th><button className="namebtn" onClick={() => app.openModal(s.name, <Student id={s.id} />, true)}>{s.name}</button></th>
                  {o.tasks.map((t, ci) => { const g = s.scores[String(t.n)]; const [b, f] = shade(g, t.max); return <td key={t.n}><button className="num" style={{ background: b, color: f, opacity: col < 0 || col === ci ? 1 : 0.3 }} onClick={() => app.openModal(s.name, <Student id={s.id} />, true)} aria-label={`${s.name}, задание ${t.n}: ${g ?? 'нет'} из ${t.max}`}>{g == null ? '-' : `${g}/${t.max}`}</button></td> })}
                  <td className="num" style={{ fontFamily: 'var(--f-display)', textAlign: 'center' }}>{s.forecast}{s.pct ? '%' : `/${s.max}`}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid2 stagger">
        <section className="card"><h2>Карта ошибок</h2><p className="muted" style={{ fontSize: 13, margin: '4px 0 12px' }}>сколько учеников ошиблись за 2 недели (по замечаниям экспертов)</p>
          {o.errors.map((e, i) => (
            <button key={e.name} className="item" style={{ background: 'none', padding: '6px 0', flexDirection: 'column', alignItems: 'stretch', gap: 5 }} onClick={() => app.go({ v: 'tchat', id: `Как за один урок разобрать ошибки типа «${e.name}»?` })}>
              <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}><b>{e.name}</b><b className="num">{e.count}</b></span>
              <span className="bar"><i style={{ width: `${o.students.length ? (e.count / o.students.length) * 100 : 0}%`, background: i ? 'var(--em)' : 'var(--gold)' }} /></span>
            </button>
          ))}
        </section>
        <section className="card"><h2>Ждут вашего решения</h2><p className="muted" style={{ fontSize: 13, margin: '4px 0 12px' }}>три агента поставили разные баллы, судья выбрал свой</p>
          {o.reviews.length ? o.reviews.map((r) => (
            <div key={r.id} className="item" style={{ cursor: 'default', flexWrap: 'wrap', marginBottom: 8 }}>
              <span style={{ flex: '1 1 160px', minWidth: 0 }}><span className="t-strong">{r.student} · задание {r.task}</span><span className="t-sub">агенты: {r.agents.join(', ')} · судья: {r.judge}</span></span>
              <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{Array.from({ length: r.max + 1 }, (_, b) => (
                <button key={b} className={`btn btn-sm ${r.agents.includes(b) ? 'btn-line' : 'btn-ghost'}`} style={{ minWidth: 44 }} aria-label={`Поставить ${b}`} onClick={async () => { await reviewTask(r.id, b); app.toast(`${r.student}: поставлено ${b} за задание ${r.task}`); load() }}>{b}</button>
              ))}</span>
            </div>
          )) : <p className="muted">Спорных работ нет.</p>}
        </section>
      </div>

      <section className="card" style={{ background: 'var(--hero)', color: 'var(--on-em)', border: 0 }}>
        <div className="card-h"><h2>Помощник {tutor ? 'репетитора' : 'учителя'}</h2></div>
        <p style={{ color: 'var(--on-em-muted)' }}>Помощник видит прогнозы и первопричины ваших учеников. Может предложить план урока или подобрать задачи.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <button className="btn btn-gold" onClick={() => app.go({ v: 'tchat', id: 'План урока на 45 минут по самой частой первопричине в классе' })}>План урока</button>
          <button className="btn" style={{ background: 'rgba(255,255,255,.1)', color: 'var(--on-em)' }} onClick={() => app.go({ v: 'tchat', id: 'Кому из учеников нужна помощь в первую очередь и почему?' })}>Кому помочь первым</button>
        </div>
      </section>

      {o.assignments.length > 0 && (
        <section className="card"><h2>Выданные работы</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>{o.assignments.map((a) => {
            const days = Math.ceil((new Date(a.due + (a.due.endsWith('Z') ? '' : 'Z')).getTime() - Date.now()) / 86400000)
            return (
              <div key={a.id} className="item" style={{ cursor: 'default' }}>
                <span className="pill p-em num">{a.count} задач</span>
                <span style={{ flex: 1, minWidth: 0 }}><span className="t-strong">{a.topic}{a.task_id ? ` · задание ${a.task_id} по фото` : ''}</span>
                  <span className="t-sub"><span className={`pill ${days <= 2 ? 'p-bad' : 'p-em'} dl-pill`}><Icon n="clock" s={13} />до {fmtD(a.due.slice(0, 10))} · {days < 0 ? 'срок прошёл' : days === 0 ? 'сегодня' : days === 1 ? 'завтра' : `через ${days} дн.`}</span> · сдали {a.done}</span></span>
                <button className="btn btn-sm btn-ghost" onClick={async () => { await deleteAssignment(a.id); app.toast('Работа отозвана'); load() }}>Отозвать</button>
              </div>
            )
          })}</div>
        </section>
      )}
    </>
  )
}

const BAD = new Set(['неверно', 'не знаю', 'нет ответа', 'нет решения', '0 из 1', '0 из 2', '0 из 3', '0 из 4'])

function Student({ id }: { id: number }) {
  const app = useApp()
  const [s, setS] = useState<StudentDetail | null>(null)
  useEffect(() => { teacherStudent(id).then(setS).catch(() => null) }, [id])
  if (!s) return <p className="muted">Загружаю…</p>
  const errs = (s.checks ?? []).flatMap((c) => c.errors.map((e) => `№ ${c.n}: ${e}`)).slice(0, 6)
  const diagBad = (s.diag?.items ?? []).filter((x) => BAD.has(x.status) || x.status === 'ошибка в счёте').map((x) => `№ ${x.n ?? x.task}: ${x.status}`)
  const ask = `Что посоветуете для ученика ${s.name}? Прогноз ${s.forecast}${s.target ? `, цель ${s.target.test} баллов` : ''}, первопричина ${s.root ?? 'нет'}.`
    + (diagBad.length ? ` Диагностика: ${diagBad.join('; ')}.` : '') + (errs.length ? ` Ошибки проверки по фото: ${errs.join('; ')}.` : '')
  return (
    <div className="stu">
      <div className="stu-sum">
        <div><span className="label">Прогноз</span><b className="num">{s.forecast}{s.pct ? '%' : ` из ${s.max}`}</b><small className="muted">{s.exam}</small></div>
        {s.target && <div><span className="label">Цель</span><b className="num">{s.target.test}</b><small className="muted">{s.target.primary} первичных</small></div>}
        {s.diag && <div><span className="label">Диагностика</span><b className="num">{s.diag.right} из {s.diag.count}</b><small className="muted">{s.diag.date ? fmtD(s.diag.date) : ''}</small></div>}
        <div><span className="label">Траектория</span><b>{s.path ? (s.path.stage ?? 'действует') : 'нет'}</b><small className="muted">{s.path ? `${s.path.count} этапов` : 'можно собрать в «Траекториях»'}</small></div>
        {s.taskmap && s.taskmap.done > 0 && <div><span className="label">Задачи банка</span><b className="num">{s.taskmap.ok} из {s.taskmap.done}</b><small className="muted">верно с первой попытки</small></div>}
      </div>
      <p>{s.root ? <>Первопричина: <b>{s.root}</b>. </> : 'Явной первопричины нет. '}{s.weak.length ? `Слабые темы: ${s.weak.join(', ')}.` : ''}</p>

      <h3 className="stu-h">По заданиям</h3>
      <div className="stu-tw"><table className="stu-t">
        <thead><tr><th>Задание</th><th>Оценка</th><th>Диагностика</th><th>Банк</th><th>Фото</th></tr></thead>
        <tbody>{s.tasks.map((t) => (
          <tr key={t.id} className={t.risk ? 'risk' : ''}>
            <td><b>{taskLabel(t)}</b> <small className="muted">{t.name}</small></td>
            <td className="num">{Math.round(t.p * 100)}%</td>
            <td className={t.diag && (BAD.has(t.diag) || t.diag === 'ошибка в счёте') ? 'bad' : ''}>{t.diag ?? '-'}</td>
            <td className="num">{t.prac ? `${t.prac.ok}/${t.prac.all}` : '-'}</td>
            <td className="num">{t.check ? `${t.check.score}/${t.check.max}` : '-'}</td>
          </tr>
        ))}</tbody>
      </table></div>

      {(s.checks?.length ?? 0) > 0 && (<>
        <h3 className="stu-h">Проверки по фото</h3>
        <div className="stu-list">{s.checks!.map((c) => (
          <div key={c.id} className="stu-row">
            <span className={`pill ${c.score === c.max ? 'p-em' : c.score === 0 ? 'p-bad' : 'p-gold'} num`}>№ {c.n} · {c.score}/{c.max}</span>
            <span style={{ flex: 1, minWidth: 0 }}>{c.errors.length ? c.errors.join('; ') : <span className="muted">ошибок не отмечено</span>}
              <small className="muted" style={{ display: 'block' }}>{c.date ? fmtD(c.date) : ''}{c.teacher ? ' · балл учителя' : ''}</small></span>
          </div>
        ))}</div>
      </>)}

      {s.diag && (s.diag.summary || (s.diag.gains?.length ?? 0) > 0) && (<>
        <h3 className="stu-h">Итог диагностики</h3>
        {s.diag.summary ? <p>{s.diag.summary}</p> : <ul className="da-facts">{(s.diag.facts ?? []).map((f, i) => <li key={i}>{f}</li>)}</ul>}
        {(s.diag.blocks?.length ?? 0) > 0 && <p className="muted" style={{ fontSize: 13 }}>По блокам: {s.diag.blocks!.map((b) => `${b.name} ${b.pct}%`).join(' · ')}</p>}
        {(s.diag.gains?.length ?? 0) > 0 && <p style={{ fontSize: 14 }}><b>Быстрее всего баллы:</b> {s.diag.gains!.slice(0, 4).map((g) => `${g.task} (${g.why})`).join('; ')}</p>}
      </>)}
      {s.diag && (
        <details className="stu-d"><summary>Ответы диагностики{s.diag.mode === 'mock' ? ' (пробник)' : ''}</summary>
          <div className="stu-list">{s.diag.items.map((x) => (
            <div key={x.id} className="stu-row">
              <span className={`pill num ${BAD.has(x.status) ? 'p-bad' : x.status.startsWith('верно') ? 'p-em' : 'p-gold'}`}>№ {x.n ?? x.task}</span>
              <span style={{ flex: 1, minWidth: 0 }}><b>{x.status}</b>{x.answer != null && x.answer !== '?' ? ` · ответ ${x.answer}, верный ${x.right}` : ''}{x.photo ? ' · есть фото' : ''}
                {x.note && <small style={{ display: 'block' }}>{x.note}</small>}
                <small className="muted stu-q">{x.q}</small></span>
            </div>
          ))}</div>
        </details>
      )}

      {(s.variants?.length ?? 0) > 0 && (<>
        <h3 className="stu-h">Варианты</h3>
        <div className="stu-list">{s.variants!.map((v, i) => <div key={i} className="stu-row"><span className="pill p-em num">{v.score}/{v.max}</span><span>{v.title} <small className="muted">{v.date ? fmtD(v.date) : ''}</small></span></div>)}</div>
      </>)}

      {s.history.length > 0 && <p className="muted" style={{ fontSize: 13 }}>Замеры: {s.history.map((h) => `${h.value} (${h.source})`).join(' → ')}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-line" onClick={() => { app.closeModal(); app.go({ v: 'tchat', id: ask }) }}>Совет помощника</button>
        <button className="btn btn-ghost" onClick={() => { app.closeModal(); app.go('paths') }}>Траектории</button>
      </div>
    </div>
  )
}

function AssignForm({ o, onDone }: { o: TeacherOverview; onDone: () => void }) {
  const app = useApp()
  const d = new Date(); d.setDate(d.getDate() + 3)
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const task = String(f.get('task') || '')
    await createAssignment({ class_id: +String(f.get('cls')), topic: String(f.get('topic') || '').trim() || 'Задание', count: +String(f.get('count') || 5), due: String(f.get('due')), task_id: task ? +task : null })
    app.closeModal(); app.toast('Работа выдана'); app.confetti(60); onDone()
  }
  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="field"><label htmlFor="aCls">Класс</label><select id="aCls" name="cls" className="input">{o.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      <div className="field"><label htmlFor="aTopic">Тема</label><input id="aTopic" name="topic" className="input" placeholder="например, Отбор корней на отрезке" required maxLength={200} /></div>
      <div className="field"><label htmlFor="aTask">Проверка по фото</label><select id="aTask" name="task" className="input"><option value="">без проверки по фото</option>{o.tasks.map((t) => <option key={t.n} value={t.n}>задание {t.n}: {t.topic}</option>)}</select></div>
      <div className="field"><label htmlFor="aCount">Сколько задач</label><select id="aCount" name="count" className="input" defaultValue="5"><option>3</option><option>5</option><option>10</option></select></div>
      <div className="field"><label htmlFor="aDue">Срок</label><input id="aDue" name="due" type="date" className="input" defaultValue={d.toISOString().slice(0, 10)} required /></div>
      <button className="btn btn-gold" type="submit">Выдать</button>
    </form>
  )
}
