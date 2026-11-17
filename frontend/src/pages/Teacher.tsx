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
                  <th><button className="namebtn" onClick={() => app.openModal(s.name, <Student id={s.id} />)}>{s.name}</button></th>
                  {o.tasks.map((t, ci) => { const g = s.scores[String(t.n)]; const [b, f] = shade(g, t.max); return <td key={t.n}><button className="num" style={{ background: b, color: f, opacity: col < 0 || col === ci ? 1 : 0.3 }} onClick={() => app.openModal(s.name, <Student id={s.id} />)} aria-label={`${s.name}, задание ${t.n}: ${g ?? 'нет'} из ${t.max}`}>{g == null ? '-' : `${g}/${t.max}`}</button></td> })}
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

function Student({ id }: { id: number }) {
  const app = useApp()
  const [s, setS] = useState<StudentDetail | null>(null)
  useEffect(() => { teacherStudent(id).then(setS).catch(() => null) }, [id])
  if (!s) return <p className="muted">Загружаю…</p>
  return (
    <>
      <p className="muted">{s.exam} · прогноз <b style={{ color: 'var(--ink)' }} className="num">{s.forecast}{s.pct ? '%' : ` из ${s.max}`}</b></p>
      <p style={{ marginTop: 10 }}>{s.root ? <>Первопричина: <b>{s.root}</b>. </> : 'Явной первопричины нет. '}{s.weak.length ? `Слабые темы: ${s.weak.join(', ')}.` : ''}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(110px,1fr))', gap: 6, marginTop: 12 }}>
        {s.tasks.map((t) => <div key={t.id} style={{ textAlign: 'center', padding: '8px 4px', borderRadius: 10, background: t.risk ? 'var(--bad-soft)' : 'var(--em-soft)' }}><div style={{ fontSize: 11, opacity: 0.8 }}>{taskLabel(t)}</div><b className="num">{Math.round(t.p * 100)}%</b></div>)}
      </div>
      {s.history.length > 0 && <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>Замеры: {s.history.map((h) => `${h.value} (${h.source})`).join(' → ')}</p>}
      <button className="btn btn-line" style={{ marginTop: 14 }} onClick={() => app.go({ v: 'tchat', id: `Что посоветуете для ученика ${s.name}? Прогноз ${s.forecast}, первопричина ${s.root ?? 'нет'}.` })}>Совет помощника</button>
    </>
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
