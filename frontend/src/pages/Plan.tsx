import { useCallback, useEffect, useState } from 'react'
import { getPlan, putSettings, togglePlanBlock } from '../api/client'
import { useApp } from '../app/store'
import type { ExamInfo, PlanBlock, PlanData, RouteBasis } from '../types'
import { Icon, dkey, fmtD, plural, taskLabel } from '../design/ui'

type App = ReturnType<typeof useApp>

/** Where a schedule block leads. */
/** An honest line about what the route rests on; nothing once a diagnostic is done. */
export function RouteNote({ basis, exam }: { basis?: RouteBasis; exam: ExamInfo }) {
  const app = useApp()
  if (!basis || basis === 'diag') return null
  const tasks = exam.key === 'prof'
  return (
    <div className="route-note">
      <Icon n="bulb" s={16} />
      <span style={{ flex: 1 }}>
        {basis === 'start'
          ? <><b>Стартовый маршрут:</b> идём по порядку с основ. {tasks ? 'Пройди диагностику или порешай задачи, и он подстроится под тебя.' : 'Пройди диагностику, и он подстроится под тебя.'}</>
          : <><b>Маршрут по твоим ответам</b> в банке задач, картах заданий и проверках по фото. С диагностикой он станет точнее.</>}
        <span className="route-note-btns">
          <button className="btn btn-sm btn-line" onClick={() => window.dispatchEvent(new Event('everest:diag'))}>Диагностика</button>
          {tasks && basis === 'start' && <button className="btn btn-sm btn-line" onClick={() => app.go('practice')}>Банк задач</button>}
        </span>
      </span>
    </div>
  )
}

export function blockGo(b: PlanBlock, app: App) {
  if (b.k === 'mock') { window.dispatchEvent(new Event('everest:mock')); return }
  const prof = app.me.exam_info.key === 'prof'
  if (b.k === 'topic' && b.node) {
    // the topic opens the map of the first exam task that needs it
    const t = app.dash?.model.tasks.find((x) => x.need.includes(b.node!) && typeof x.n === 'number')
    if (prof && t) { app.go({ v: 'task', id: String(t.n) }); return }
    app.go({ v: 'chat', id: `Объясни тему «${b.title}» с примером. Начни с вопроса ко мне.` }); return
  }
  if (b.k === 'school') { app.go({ v: 'chat', id: `Объясни тему «${b.title}» с примером. Начни с вопроса ко мне.` }); return }
  const t = b.tasks?.[0]
  if (t && typeof t.n === 'number' && app.me.exam_info.key === 'prof') { app.go({ v: 'video', id: String(t.n) }); return }
  if (t) { app.go({ v: 'chat', id: `Задание «${t.name}»: с чего начать? Начни с вопроса ко мне.` }); return }
  app.go('check')
}

export default function Plan() {
  const app = useApp()
  const [p, setP] = useState<PlanData | null>(null)
  const load = useCallback(() => getPlan().then(setP).catch(() => null), [])
  useEffect(() => { load() }, [load])
  if (!p) return <p className="muted">Собираю расписание…</p>
  const ex = p.exam
  const totalW = Math.ceil(p.total_days / 7)
  const passed = p.tasks.filter((t) => p.freq[t.id] !== undefined || !t.from)
  const fmax = Math.max(1, ...passed.map((t) => p.freq[t.id] ?? 0))
  const today = dkey(new Date())

  const setPlan = async (k: string, v: string | number) => {
    await putSettings({ plan: { ...p.settings, [k]: v } })
    await load()
    app.reload()
    app.toast('Расписание пересобрано')
  }
  const tick = async (key: string) => {
    const r = await togglePlanBlock(key)
    if (r.done) app.toast('+30 м высоты · блок расписания', 'gold')
    load()
    app.reload()
  }

  return (
    <>
      <div className="card-h" style={{ margin: 0 }}>
        <div><p className="muted">{ex.title}</p><h1>Расписание</h1></div>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="pill p-em">{p.studied} занятий · {p.mocks} {plural(p.mocks, ex.pct ? 'замер' : 'пробник', ex.pct ? 'замера' : 'пробника', ex.pct ? 'замеров' : 'пробников')}</span>
          <button className="btn btn-sm btn-line" onClick={() => window.dispatchEvent(new Event('everest:mock'))}><Icon n="flag" s={16} />{ex.pct ? 'Замер сейчас' : 'Пробник сейчас'}</button>
        </span>
      </div>
      <section className="card plan-set">
        <div className="mat-form">
          <div className="field" style={{ flex: '1 1 170px' }}><label htmlFor="plDate">{ex.pct ? 'Конец учебного года' : 'Дата экзамена'}</label>
            <input id="plDate" type="date" className="input" defaultValue={p.settings.date} onChange={(e) => e.target.value && setPlan('date', e.target.value)} /></div>
          <div className="field" style={{ flex: '1 1 150px' }}><label htmlFor="plDays">Дней в неделю</label>
            <select id="plDays" className="input" value={p.settings.days} onChange={(e) => setPlan('days', +e.target.value)}>{[3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
          <div className="field" style={{ flex: '1 1 150px' }}><label htmlFor="plMin">Минут в день</label>
            <select id="plMin" className="input" value={p.settings.min} onChange={(e) => setPlan('min', +e.target.value)}>{[30, 45, 60, 90].map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
        </div>
        <RouteNote basis={p.route_basis} exam={ex} />
        <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>{ex.date_note}. Воскресенье всегда выходной. Занятия заканчиваются до 21:30, чтобы не сбивать сон.</p>
      </section>
      <section className="card">
        <div className="card-h"><h2>Этапы до {ex.pct ? 'конца года' : 'экзамена'}</h2><span className="muted num">{totalW} {plural(totalW, 'неделя', 'недели', 'недель')}</span></div>
        <div className="phases-bar">{p.phases.map((ph, i) => (
          <div key={i} className={`ph ph${i}`} style={{ flex: ph.share }}><b>Этап {i + 1}</b><span>{ph.name}</span><small>с {fmtD(ph.from, { day: 'numeric', month: 'short' })}</small></div>
        ))}</div>
      </section>
      <section>
        <div className="card-h"><h2>Эта неделя</h2><span className="muted">{fmtD(p.week[0].date)} - {fmtD(p.week[6].date)}</span></div>
        <div className="week">{p.week.map((x) => (
          <div key={x.date} className={`wday ${x.date === today ? 'today' : ''} ${x.rest ? 'rest' : ''} ${x.past ? 'past' : ''}`}>
            <div className="wd-h"><b>{fmtD(x.date, { weekday: 'short' })}</b><span className="num">{+x.date.slice(8)}</span></div>
            {x.past ? <p className="muted" style={{ fontSize: 12.5 }}>прошло</p> : x.rest ? <p className="rest-t"><Icon n="moon" s={16} /> отдых</p> : x.blocks.map((b) => (
              <div key={b.key} className={`pblock k-${b.k}`}>
                <button className={`tick ${b.done ? 'on' : ''}`} aria-pressed={!!b.done} aria-label={`Отметить: ${b.title}`} onClick={() => tick(b.key!)}>
                  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5 L6.8 11.5 L12.5 5" fill="none" stroke={b.done ? '#fff' : 'transparent'} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
                <button className="pb-main" onClick={() => blockGo(b, app)}><b>{b.title}</b><small>{b.min} мин · {b.sub}</small></button>
              </div>
            ))}
          </div>
        ))}</div>
      </section>
      <section className="card">
        <div className="card-h"><div><h2>Каждое {ex.pct ? 'тему' : 'задание'} по чуть-чуть</h2><p className="muted" style={{ fontSize: 13 }}>сколько раз встретится до {ex.pct ? 'конца года' : 'экзамена'}: слабые чаще, но ни одно не пропадает</p></div></div>
        <div className="freq">{passed.map((t, i) => (
          <div key={t.id} className="fq"><span>{taskLabel(t)}</span>
            <span className="trk"><i style={{ width: `${((p.freq[t.id] ?? 0) / fmax) * 100}%`, background: t.risk ? 'var(--red)' : 'var(--em-3)', animationDelay: `${(i * 0.03).toFixed(2)}s` }} /></span>
            <b className="num">{p.freq[t.id] ?? 0}</b></div>
        ))}</div>
      </section>
      <section className="card">
        <h2>Как собрано</h2>
        <ol className="how">
          <li>Темы ниже 80% выстроены снизу вверх по карте знаний, первой идёт первопричина{p.root_name ? ` («${p.root_name}»)` : ''}. Сейчас в очереди {p.queue} {plural(p.queue, 'занятие', 'занятия', 'занятий')} по темам.</li>
          <li>Разминка каждый день: два {ex.pct ? 'раздела' : 'задания первой части'} по очереди. Чем ниже результат по заданию, тем чаще оно выпадает.</li>
          {p.tasks.some((t) => typeof t.n === 'number' && t.n >= 13) && <li>Один шаг второй части почти каждый день: сначала самые достижимые задания.</li>}
          <li>Каждая 4-я неделя заканчивается {ex.pct ? 'контрольным замером' : 'пробником'}, последние 2 недели в основном пробники. После каждого замера расписание пересобирается.</li>
        </ol>
      </section>
    </>
  )
}
