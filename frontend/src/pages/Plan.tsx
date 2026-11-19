import { FormEvent, useCallback, useEffect, useState } from 'react'
import { getPlan, putEvents, putSettings, setTarget, togglePlanBlock } from '../api/client'
import { useApp } from '../app/store'
import type { ExamInfo, Part2Info, PathStageInfo, PlanBlock, MyEvent, PlanData, RouteBasis, Target } from '../types'
import { Icon, dkey, fmtD, plural, taskLabel } from '../design/ui'

type App = ReturnType<typeof useApp>

/** An honest line about what the route rests on: a trajectory, answers, or nothing yet; nothing after a diagnostic without a trajectory. */
export function RouteNote({ basis, exam, stage }: { basis?: RouteBasis; exam: ExamInfo; stage?: PathStageInfo | null }) {
  const app = useApp()
  if (!basis || basis === 'diag') return null
  const tasks = exam.key === 'prof'
  if (basis === 'path') {
    return (
      <div className="route-note">
        <Icon n="flag" s={16} />
        <span style={{ flex: 1 }}>
          <b>Маршрут идёт по траектории{stage?.approved ? ', которую утвердил учитель' : ''}</b>
          {stage?.title ? <>: этап «{stage.title}» ({(stage.index ?? 0) + 1} из {stage.count}).{stage.goal ? ` Цель: ${stage.goal}` : ''}</> : '.'}
          <span className="route-note-btns"><button className="btn btn-sm btn-line" onClick={() => app.go('path')}>Траектория</button></span>
        </span>
      </div>
    )
  }
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
          <button className="btn btn-sm btn-line" onClick={() => app.go('path')}>Собрать траекторию</button>
        </span>
      </span>
    </div>
  )
}

/** The goal in test points (profile exam): decides which tasks the schedule and the trajectory need. */
export function TargetPick({ value, onSaved, compact }: { value?: Target | null; onSaved: (t: Target) => void; compact?: boolean }) {
  const [v, setV] = useState(value?.test ? String(value.test) : '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const save = async (n: number) => {
    if (!n || n < 27 || n > 100) { setErr('От 27 до 100 тестовых баллов'); return }
    setBusy(true); setErr('')
    try { const r = await setTarget(n); setV(String(n)); onSaved(r.target) } catch (e) { setErr(String((e as Error).message || e)) }
    setBusy(false)
  }
  return (
    <div className={`tgt ${compact ? 'compact' : ''}`}>
      <div className="tgt-row">
        {[70, 80, 90, 100].map((n) => <button key={n} className={`chip ${String(n) === v ? 'on' : ''}`} aria-pressed={String(n) === v} disabled={busy} onClick={() => save(n)}>{n}</button>)}
        <input className="input tgt-in" inputMode="numeric" placeholder="другой" value={[70, 80, 90, 100].includes(+v) ? '' : v} aria-label="Желаемый балл"
          onChange={(e) => setV(e.target.value.replace(/\D/g, '').slice(0, 3))} onBlur={() => v && ![70, 80, 90, 100].includes(+v) && save(+v)} />
      </div>
      {value && <p className="muted tgt-note">{value.test} тестовых = {value.primary} первичных из 32 по шкале 2026 года (шкалу 2027 года утвердят позже).</p>}
      {err && <p className="auth-msg">{err}</p>}
    </div>
  )
}

export function Part2Note({ p2, target }: { p2?: Part2Info; target?: Target | null }) {
  if (!p2) return null
  if (!p2.needed) return <p className="muted" style={{ fontSize: 13 }}>{target ? 'Для твоей цели хватает первой части: второй части в расписании нет.' : ''}</p>
  return <p className="muted" style={{ fontSize: 13 }}>{p2.open_from ? `Вторая часть в расписании с ${fmtD(p2.open_from)}: ` : 'Вторая часть пока не в расписании: '}
    она появляется, когда по диагностике решается хотя бы часть её заданий или первая часть освоена в среднем на 70%.</p>
}

/** Where a schedule block leads. */
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
  if (t && typeof t.n === 'number' && prof) {
    // warm-up: problems from the bank; main task and the next step: the task map with its prototypes
    if (b.k === 'warm') { app.go({ v: 'practice', id: String(t.n) }); return }
    if (b.k === 'deep' || b.k === 'step') { app.go({ v: 'task', id: String(t.n) }); return }
  }
  if (t && typeof t.n === 'number' && app.me.exam_info.key === 'prof') { app.go({ v: 'video', id: String(t.n) }); return }
  if (t) { app.go({ v: 'chat', id: `Задание «${t.name}»: с чего начать? Начни с вопроса ко мне.` }); return }
  app.go('check')
}

const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const SUBJECTS = ['Русский язык', 'Физика', 'Информатика', 'Обществознание', 'Химия', 'Биология', 'История', 'Английский язык', 'Литература', 'География']

/** The student's own plans: other subjects for the exams and personal things. A day marked as taken moves mathematics on. */
function MyEvents({ events, onSaved }: { events: MyEvent[]; onSaved: () => void }) {
  const app = useApp()
  const [open, setOpen] = useState(false)
  const blank: MyEvent = { id: '', title: '', kind: 'subject', repeat: 'weekly', weekdays: [], date: null, start: '', min: 60, busy: false }
  const [e, setE] = useState<MyEvent>(blank)
  const save = async (list: MyEvent[], msg: string) => {
    try { await putEvents(list); app.toast(msg); onSaved(); return true } catch (err) { app.toast(String(err).replace('Error: ', '')); return false }
  }
  const add = async (ev: FormEvent) => {
    ev.preventDefault()
    if (!e.title.trim()) return app.toast('Как назвать?')
    if (e.repeat === 'weekly' && !e.weekdays.length) return app.toast('Выбери дни недели')
    if (e.repeat === 'once' && !e.date) return app.toast('Выбери дату')
    const list = e.id ? events.map((x) => (x.id === e.id ? e : x)) : [...events, { ...e, id: '' }]
    if (await save(list, e.busy ? 'Сохранено: в этот день математика перенесётся' : 'Сохранено')) { setE(blank); setOpen(false) }
  }
  const fmt = (x: MyEvent) => (x.repeat === 'weekly' ? x.weekdays.map((i) => WD[i]).join(', ') : fmtD(x.date ?? '')) + (x.start ? `, ${x.start}` : '') + (x.min ? `, ${x.min} мин` : '')
  return (
    <section className="card">
      <div className="card-h"><div><h2>Мои дела и другие предметы</h2>
        <p className="muted" style={{ fontSize: 13 }}>Подготовка к другим экзаменам, кружки, тренировки. Они видны в расписании; если день занят целиком, математика переносится.</p></div>
        {!open && <button className="btn btn-sm btn-line" onClick={() => { setE(blank); setOpen(true) }}><Icon n="plus" s={16} />Добавить</button>}</div>
      {events.length > 0 && <div className="myev">{events.map((x) => (
        <div key={x.id} className={`myev-i ${x.kind}`}>
          <span style={{ flex: 1, minWidth: 0 }}><b>{x.title}</b>{x.busy && <span className="pill p-gold" style={{ marginLeft: 6 }}>день занят</span>}<small className="muted" style={{ display: 'block' }}>{x.kind === 'subject' ? 'Предмет · ' : ''}{fmt(x)}</small></span>
          <button className="btn btn-sm btn-ghost" onClick={() => { setE({ ...x }); setOpen(true) }}>Изменить</button>
          <button className="iconbtn" aria-label={`Удалить ${x.title}`} onClick={() => save(events.filter((y) => y.id !== x.id), 'Удалено')}><Icon n="trash" s={16} /></button>
        </div>
      ))}</div>}
      {open && (
        <form className="myev-form" onSubmit={add}>
          <div className="seg" role="group" aria-label="Что это">
            <button type="button" aria-pressed={e.kind === 'subject'} onClick={() => setE({ ...e, kind: 'subject' })}>Другой предмет</button>
            <button type="button" aria-pressed={e.kind === 'own'} onClick={() => setE({ ...e, kind: 'own' })}>Своё дело</button></div>
          {e.kind === 'subject' && <div className="qchips">{SUBJECTS.map((x) => <button type="button" key={x} className={e.title === x ? 'on' : ''} onClick={() => setE({ ...e, title: x })}>{x}</button>)}</div>}
          <div className="mat-form">
            <div className="field" style={{ flex: '2 1 200px' }}><label htmlFor="evT">Название</label>
              <input id="evT" className="input" maxLength={60} value={e.title} onChange={(x) => setE({ ...e, title: x.target.value })} placeholder={e.kind === 'subject' ? 'Физика' : 'Тренировка, репетитор, кружок'} /></div>
            <div className="field" style={{ flex: '0 1 120px' }}><label htmlFor="evS">Начало</label>
              <input id="evS" type="time" className="input" value={e.start ?? ''} onChange={(x) => setE({ ...e, start: x.target.value })} /></div>
            <div className="field" style={{ flex: '0 1 120px' }}><label htmlFor="evM">Минут</label>
              <input id="evM" type="number" min={0} max={720} step={15} className="input" value={e.min ?? 0} onChange={(x) => setE({ ...e, min: Number(x.target.value) || 0 })} /></div>
          </div>
          <div className="seg" role="group" aria-label="Как часто">
            <button type="button" aria-pressed={e.repeat === 'weekly'} onClick={() => setE({ ...e, repeat: 'weekly' })}>Каждую неделю</button>
            <button type="button" aria-pressed={e.repeat === 'once'} onClick={() => setE({ ...e, repeat: 'once' })}>Один раз</button></div>
          {e.repeat === 'weekly'
            ? <div className="wd-pick">{WD.map((w, i) => { const on = e.weekdays.includes(i); return <button type="button" key={i} aria-pressed={on} className={on ? 'on' : ''} onClick={() => setE({ ...e, weekdays: on ? e.weekdays.filter((x) => x !== i) : [...e.weekdays, i].sort() })}>{w}</button> })}</div>
            : <div className="field" style={{ maxWidth: 200 }}><label htmlFor="evD">Дата</label><input id="evD" type="date" className="input" value={e.date ?? ''} onChange={(x) => setE({ ...e, date: x.target.value })} /></div>}
          <label className="mat-check"><input type="checkbox" checked={!!e.busy} onChange={(x) => setE({ ...e, busy: x.target.checked })} /><span><b>Весь день занят</b><small className="muted">в этот день математику не ставить, она сдвинется</small></span></label>
          <div style={{ display: 'flex', gap: 8 }}><button className="btn btn-em" type="submit">Сохранить</button><button className="btn btn-line" type="button" onClick={() => setOpen(false)}>Отмена</button></div>
        </form>
      )}
    </section>
  )
}

export default function Plan() {
  const app = useApp()
  const [p, setP] = useState<PlanData | null>(null)
  const [wk, setWk] = useState(0)
  const load = useCallback(() => getPlan(wk).then(setP).catch(() => null), [wk])
  useEffect(() => { load() }, [load])
  if (!p) return <p className="muted">Собираю расписание…</p>
  const ex = p.exam
  const totalW = Math.ceil(p.total_days / 7)
  const passed = p.tasks.filter((t) => p.freq[t.id] !== undefined || !t.from)
  const fmax = Math.max(1, ...passed.map((t) => p.freq[t.id] ?? 0))
  const today = dkey(new Date())

  const setPlan = async (k: string, v: string | number | number[]) => {
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
          <div style={{ flex: '2 1 300px' }}><span className="flabel">Дни для математики</span>
            <div className="wd-pick" role="group" aria-label="Дни для математики">{WD.map((w, i) => {
              const on = (p.settings.wd ?? []).includes(i)
              return <button key={i} type="button" aria-pressed={on} className={on ? 'on' : ''} onClick={() => {
                const next = on ? (p.settings.wd ?? []).filter((x) => x !== i) : [...(p.settings.wd ?? []), i]
                if (!next.length) { app.toast('Нужен хотя бы один день'); return }
                setPlan('wd', next.sort())
              }}>{w}</button>
            })}</div></div>
          <div className="field" style={{ flex: '0 1 130px' }}><label htmlFor="plTime">Во сколько</label>
            <input id="plTime" type="time" className="input" defaultValue={p.settings.time ?? ''} onBlur={(e) => e.target.value !== (p.settings.time ?? '') && setPlan('time', e.target.value)} /></div>
          <div className="field" style={{ flex: '1 1 150px' }}><label htmlFor="plMin">Минут в день</label>
            <select id="plMin" className="input" value={p.settings.min} onChange={(e) => setPlan('min', +e.target.value)}>{[30, 45, 60, 90].map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
        </div>
        {ex.key === 'prof' && <div className="field" style={{ marginTop: 12 }}><span className="label">Цель: на сколько баллов хочу сдать</span>
          <TargetPick value={p.target} onSaved={() => { load(); app.reload() }} /></div>}
        <Part2Note p2={p.part2} target={p.target} />
        <RouteNote basis={p.route_basis} exam={ex} stage={p.path_stage} />
        <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>{ex.date_note}. Хотя бы один день в неделю лучше оставить для отдыха. Занятия лучше заканчивать до 21:30, чтобы не сбивать сон.</p>
      </section>
      <section className="card">
        <div className="card-h"><h2>Этапы до {ex.pct ? 'конца года' : 'экзамена'}</h2><span className="muted num">{totalW} {plural(totalW, 'неделя', 'недели', 'недель')}</span></div>
        <div className="phases-bar">{p.phases.map((ph, i) => (
          <div key={i} className={`ph ph${i}`} style={{ flex: ph.share }}><b>Этап {i + 1}</b><span>{ph.name}</span><small>с {fmtD(ph.from, { day: 'numeric', month: 'short' })}</small></div>
        ))}</div>
      </section>
      <MyEvents events={p.events ?? []} onSaved={() => { load(); app.reload() }} />
      <section>
        <div className="card-h"><h2>{wk === 0 ? 'Эта неделя' : wk === 1 ? 'Следующая неделя' : `Через ${wk} ${plural(wk, 'неделю', 'недели', 'недель')}`}</h2>
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button className="iconbtn" disabled={wk === 0} onClick={() => setWk(wk - 1)} aria-label="Предыдущая неделя"><Icon n="prev" s={16} /></button>
            <span className="muted">{fmtD(p.week[0].date)} - {fmtD(p.week[6].date)}</span>
            <button className="iconbtn" disabled={wk >= 26} onClick={() => setWk(wk + 1)} aria-label="Следующая неделя"><Icon n="next" s={16} /></button>
          </span></div>
        <div className="week">{p.week.map((x) => (
          <div key={x.date} className={`wday ${x.date === today ? 'today' : ''} ${x.rest ? 'rest' : ''} ${x.past ? 'past' : ''} ${x.busy ? 'busy' : ''}`}>
            <div className="wd-h"><b>{fmtD(x.date, { weekday: 'short' })}</b><span className="num">{+x.date.slice(8)}</span></div>
            {!x.past && !x.rest && x.blocks[0]?.block && <span className="wd-blk">{x.blocks[0].block}{p.settings.time ? ` · ${p.settings.time}` : ''}</span>}
            {!x.past && (x.events ?? []).map((e) => <div key={e.id} className={`pev ${e.kind}`}><b>{e.start ? `${e.start} ` : ''}{e.title}</b>{e.min ? <small>{e.min} мин{e.busy ? ' · весь день занят' : ''}</small> : e.busy ? <small>весь день занят</small> : null}</div>)}
            {!x.past && x.heavy && <p className="wd-warn">Много дел на день: больше 5 часов занятий</p>}
            {x.past ? <p className="muted" style={{ fontSize: 12.5 }}>прошло</p> : x.busy ? <p className="rest-t">математика переносится</p> : x.rest ? <p className="rest-t"><Icon n="moon" s={16} /> {x.events?.length ? 'без математики' : 'отдых'}</p> : x.blocks.map((b) => (
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
        <div className="card-h"><div><h2>Каждое {ex.pct ? 'тему' : 'задание'} по чуть-чуть</h2><p className="muted" style={{ fontSize: 13 }}>сколько раз встретится до {ex.pct ? 'конца года' : 'экзамена'}: по блокам, от лёгких к трудным{p.target ? '; задания, которые не нужны для цели, не ставятся' : ''}</p></div></div>
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
