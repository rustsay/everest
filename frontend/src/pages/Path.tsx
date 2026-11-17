import { useCallback, useEffect, useRef, useState } from 'react'
import {
  followPath, generateMyPath, getMyPath, teacherApprovePath, teacherEditPath, teacherGenPath, teacherPath, teacherPaths, teacherRejectPath,
} from '../api/client'
import { useApp } from '../app/store'
import type { MyPath, PathData, PathOut, PathStage, TeacherPaths as TP } from '../types'
import { Icon, fmtD, plural } from '../design/ui'

const short = (d: PathData, id: string) => (d.nums?.[id] != null ? `№ ${d.nums[id]}` : (d.labels?.[id] ?? id))
const span = (s: PathStage) => `${fmtD(s.from, { day: 'numeric', month: 'short' })} - ${fmtD(s.to, { day: 'numeric', month: 'short' })}`
const todayIso = () => new Date().toISOString().slice(0, 10)

function Source({ p }: { p: PathOut }) {
  const d = p.data
  return (
    <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      <span className={`pill ${d.source === 'ai' ? 'p-em' : 'p-gold'}`}>{d.source === 'ai' ? 'Составил ИИ, проверено сервером' : 'Собрано по правилам'}</span>
      {d.edited && <span className="pill p-em">поправлено учителем</span>}
      {p.kind === 'class' && <span className="pill p-gold">траектория класса {p.class_name}</span>}
    </span>
  )
}

/** Stages of a trajectory: dates, goal, task focus, how the stage is checked, problems from the bank. */
export function PathTimeline({ p }: { p: PathOut }) {
  const app = useApp()
  const d = p.data
  const now = todayIso()
  const prof = d.exam === 'prof'
  return (
    <>
      <div style={{ display: 'grid', gap: 8 }}>
        <Source p={p} />
        {d.fallback && <p className="muted" style={{ fontSize: 13 }}>{d.fallback}.</p>}
        {d.summary && <p>{d.summary}</p>}
        {d.why?.length > 0 && <ul className="path-why">{d.why.map((w, i) => <li key={i}>{w}</li>)}</ul>}
      </div>
      <ol className="path-stages">
        {d.stages.map((s, i) => {
          const cur = s.from <= now && now <= s.to
          const past = s.to < now
          return (
            <li key={i} className={`path-stage ${cur ? 'cur' : ''} ${past ? 'past' : ''}`}>
              <span className="path-dot" aria-hidden="true">{i + 1}</span>
              <div className="path-body">
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <b className="path-title">{s.title}</b>
                  <span className="muted num" style={{ fontSize: 13 }}>{span(s)}</span>
                  {cur && <span className="pill p-em">сейчас</span>}
                </div>
                {s.goal && <p style={{ marginTop: 4 }}><span className="muted">Цель: </span>{s.goal}</p>}
                <div className="path-tasks">
                  {s.tasks.map((t) => prof && d.nums?.[t] != null
                    ? <button key={t} className="chip" title={d.labels?.[t]} onClick={() => app.go({ v: 'task', id: String(d.nums[t]) })}>{short(d, t)}</button>
                    : <span key={t} className="chip" title={d.labels?.[t]}>{short(d, t)}</span>)}
                </div>
                {s.check && <p className="muted" style={{ fontSize: 13, marginTop: 6 }}><Icon n="flag" s={14} /> Конец этапа: {s.check}</p>}
                {prof && (s.problems?.length ?? 0) > 0 && (
                  <button className="btn btn-sm btn-line" style={{ marginTop: 8 }} onClick={() => app.go({ v: 'practice', id: String(d.nums[s.tasks[0]] ?? 1) })}>
                    <Icon n="book" s={16} />Задачи этапа в банке ({s.problems!.length})
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </>
  )
}

// ---------- student ----------

export default function PathPage() {
  const app = useApp()
  const [m, setM] = useState<MyPath | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const load = useCallback(() => getMyPath().then(setM).catch((e) => setErr(String(e.message || e))), [])
  useEffect(() => { load() }, [load])

  const build = async () => {
    setBusy(true); setErr('')
    try {
      const p = await generateMyPath()
      app.toast(p.status === 'pending' ? 'Траектория отправлена учителю' : 'Траектория готова, расписание идёт по ней', 'gold')
      await load(); app.reload()
    } catch (e) { setErr(String((e as Error).message || e)) }
    setBusy(false)
  }
  if (!m) return <section className="card"><p className="muted">{err || 'Загружаю…'}</p></section>
  const solo = m.mode === 'solo'
  const shown = m.active ?? m.class_path
  return (
    <>
      <div className="card-h" style={{ margin: 0 }}>
        <div><p className="muted">Этапы до экзамена с целями</p><h1>Образовательная траектория</h1></div>
        <button className="btn btn-gold" disabled={busy} onClick={build}><Icon n="restart" s={18} c="#16231F" />
          {busy ? 'Собираю…' : solo ? (m.active ? 'Собрать заново' : 'Собрать траекторию') : 'Собрать и отправить учителю'}</button>
      </div>

      <section className="card path-status">
        {solo ? (
          <>
            <p><b>Ты занимаешься сам</b>, поэтому траектория твоя: собирай её когда хочешь. Пока переключатель включён, расписание на каждый день идёт по текущему этапу.</p>
            {m.active && (
              <label className="path-follow">
                <input type="checkbox" checked={m.follow} onChange={async (e) => { await followPath(e.target.checked); await load(); app.reload() }} />
                Расписание идёт по траектории
              </label>
            )}
          </>
        ) : (
          <p><b>Ты в классе</b>, поэтому траекторию утверждает учитель{m.teachers.length ? ` (${m.teachers.join(', ')})` : ''}. Собери её, учитель проверит и утвердит, и расписание пойдёт по ней.</p>
        )}
        <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
          {m.llm_ready ? 'Траекторию составляет ИИ по твоим результатам, а сервер проверяет: только задания этого экзамена, даты до экзамена, задачи только из банка.'
            : 'ИИ пока не подключён: траектория собирается по правилам из твоих результатов. С ИИ она будет подробнее.'}
        </p>
        {err && <p style={{ color: 'var(--red)', marginTop: 6 }}>{err}</p>}
      </section>

      {m.rejected && (
        <section className="card path-note bad">
          <b>Учитель вернул траекторию на доработку</b>
          {m.rejected.note && <p style={{ marginTop: 4 }}>{m.rejected.note}</p>}
          <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>Порешай задачи по слабым заданиям и собери заново.</p>
        </section>
      )}
      {m.pending && (
        <section className="card">
          <div className="card-h"><h2>Ждёт утверждения учителем</h2><span className="pill p-gold">отправлена {m.pending.created_at ? fmtD(m.pending.created_at) : ''}</span></div>
          <PathTimeline p={m.pending} />
        </section>
      )}
      {shown ? (
        <section className="card">
          <div className="card-h">
            <h2>{m.active ? 'Твоя траектория' : 'Траектория класса'}</h2>
            {shown.approved_by && shown.approved_by !== shown.student_name
              ? <span className="pill p-em">утвердил{shown.approved_at ? ` ${fmtD(shown.approved_at)}` : ''}: {shown.approved_by}</span>
              : <span className="muted" style={{ fontSize: 13 }}>{shown.created_at ? `собрана ${fmtD(shown.created_at)}` : ''}</span>}
          </div>
          {shown.note && <p className="path-note"><b>Комментарий учителя:</b> {shown.note}</p>}
          <PathTimeline p={shown} />
        </section>
      ) : !m.pending && (
        <section className="card path-empty">
          <h2>Траектории пока нет</h2>
          <p className="muted" style={{ marginTop: 6 }}>Траектория разбивает время до экзамена на этапы. У каждого этапа есть задания, цель и проверка в конце.
            Собирается по твоим результатам: диагностике, ответам в банке задач и картах заданий, проверке по фото. Чем больше данных, тем точнее.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <button className="btn btn-line btn-sm" onClick={() => window.dispatchEvent(new Event('everest:diag'))}>Пройти диагностику</button>
            <button className="btn btn-line btn-sm" onClick={() => app.go('practice')}>Банк задач</button>
          </div>
        </section>
      )}
    </>
  )
}

// ---------- teacher / tutor ----------

const STATUS: Record<string, string> = { draft: 'черновик', pending: 'ждёт утверждения', active: 'утверждена', archived: 'в архиве', rejected: 'возвращена' }

function Refs({ r }: { r: { active: number | null; pending: number | null; draft: number | null } }) {
  return (
    <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {r.pending && <span className="pill p-gold">ждёт утверждения</span>}
      {r.active && <span className="pill p-em">утверждена</span>}
      {r.draft && <span className="pill p-draft">черновик</span>}
      {!r.active && !r.pending && !r.draft && <span className="muted" style={{ fontSize: 13 }}>нет траектории</span>}
    </span>
  )
}

export function TeacherPaths() {
  const app = useApp()
  const [t, setT] = useState<TP | null>(null)
  const [open, setOpen] = useState<PathOut | null>(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const top = useRef<HTMLDivElement>(null)
  const load = useCallback(() => teacherPaths().then(setT).catch((e) => setErr(String(e.message || e))), [])
  useEffect(() => { load() }, [load])

  const show = async (id: number) => { setOpen(await teacherPath(id)); setTimeout(() => top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50) }
  const gen = async (target: { student_id?: number; class_id?: number }, key: string) => {
    setBusy(key); setErr('')
    try { const p = await teacherGenPath(target); setOpen(p); await load(); setTimeout(() => top.current?.scrollIntoView({ behavior: 'smooth' }), 50) } catch (e) { setErr(String((e as Error).message || e)) }
    setBusy('')
  }
  const open1 = (r: { active: number | null; pending: number | null; draft: number | null }) => r.pending ?? r.draft ?? r.active
  if (!t) return <section className="card"><p className="muted">{err || 'Загружаю…'}</p></section>
  return (
    <>
      <div className="card-h" style={{ margin: 0 }} ref={top}>
        <div><p className="muted">Для учеников и для класса</p><h1>Образовательные траектории</h1></div>
      </div>
      <p className="muted" style={{ fontSize: 13.5, margin: '-4px 0 0' }}>
        Ученики ваших классов собирают траекторию, а вы её утверждаете: только после этого расписание ученика идёт по ней.
        Можно собрать траекторию самому, для ученика или для всего класса. Траектория класса действует у тех, у кого нет своей.
        {t.llm_ready ? ' Составляет ИИ, сервер проверяет ответ.' : ' ИИ не подключён: траектории собираются по правилам из результатов.'}
      </p>
      {err && <p style={{ color: 'var(--red)' }}>{err}</p>}

      {open && <PathEditor key={open.id} p={open} onClose={() => setOpen(null)} onDone={async (msg) => { app.toast(msg, 'gold'); setOpen(null); await load() }} />}

      {t.pending.length > 0 && (
        <section className="card">
          <div className="card-h"><h2>Ждут утверждения</h2><span className="pill p-gold num">{t.pending.length}</span></div>
          <div className="tm-links">
            {t.pending.map((p) => (
              <button key={p.id} className="item" onClick={() => show(p.id)}>
                <Icon n="flag" s={18} />
                <span className="t-strong" style={{ flex: 1 }}>{p.student_name}<small className="muted" style={{ display: 'block', fontWeight: 600 }}>
                  {p.data.stages.length} {plural(p.data.stages.length, 'этап', 'этапа', 'этапов')} · прислал {p.created_at ? fmtD(p.created_at) : ''}</small></span>
                <span className="btn btn-sm btn-line">Открыть</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-h"><h2>Классы</h2></div>
        {t.classes.length === 0 && <p className="muted">Классов пока нет. Создайте класс в разделе «Класс».</p>}
        <div className="tm-links">
          {t.classes.map((c) => (
            <div key={c.id} className="item path-row" style={{ cursor: 'default' }}>
              <Icon n="class" s={18} />
              <span className="path-row-txt"><span className="t-strong">{c.name}</span><span className="t-sub">{c.students} {plural(c.students, 'ученик', 'ученика', 'учеников')}</span><Refs r={c} /></span>
              <span className="path-row-btns">
                {open1(c) && <button className="btn btn-sm btn-line" onClick={() => show(open1(c)!)}>Открыть</button>}
                <button className="btn btn-sm btn-em" disabled={!!busy || c.students === 0} onClick={() => gen({ class_id: c.id }, `c${c.id}`)}>{busy === `c${c.id}` ? 'Собираю…' : 'Собрать'}</button>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-h"><h2>Ученики</h2></div>
        {t.students.length === 0 && <p className="muted">Учеников пока нет: они вступают в класс по коду.</p>}
        <div className="tm-links">
          {t.students.map((s) => (
            <div key={s.id} className="item path-row" style={{ cursor: 'default' }}>
              <span className="path-ava" aria-hidden="true">{(s.name || '?')[0]}</span>
              <span className="path-row-txt"><span className="t-strong">{s.name}</span><span className="t-sub">{s.exam} · {s.classes.join(', ')}</span><Refs r={s} /></span>
              <span className="path-row-btns">
                {open1(s) && <button className="btn btn-sm btn-line" onClick={() => show(open1(s)!)}>Открыть</button>}
                <button className="btn btn-sm btn-em" disabled={!!busy} onClick={() => gen({ student_id: s.id }, `s${s.id}`)}>{busy === `s${s.id}` ? 'Собираю…' : 'Собрать'}</button>
              </span>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}

/** The teacher checks a trajectory: edits stages, leaves a comment, approves or sends back. */
function PathEditor({ p, onClose, onDone }: { p: PathOut; onClose: () => void; onDone: (msg: string) => void }) {
  const [stages, setStages] = useState<PathStage[]>(p.data.stages.map((s) => ({ ...s, tasks: [...s.tasks] })))
  const [note, setNote] = useState(p.note || '')
  const [edit, setEdit] = useState(p.status !== 'active')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const all = Object.keys(p.data.labels || {})
  const set = (i: number, patch: Partial<PathStage>) => setStages(stages.map((s, k) => (k === i ? { ...s, ...patch } : s)))
  const who = p.kind === 'class' ? `класс ${p.class_name}` : p.student_name
  const run = async (f: () => Promise<unknown>, msg: string) => {
    setBusy(true); setErr('')
    try { await f(); onDone(msg) } catch (e) { setErr(String((e as Error).message || e)) }
    setBusy(false)
  }
  const save = () => teacherEditPath(p.id, { stages, note })
  return (
    <section className="card path-editor">
      <div className="card-h">
        <div><h2>Траектория: {who}</h2><p className="muted" style={{ fontSize: 13 }}>{STATUS[p.status]}{p.author ? ` · собрал(а): ${p.author}` : ''}</p></div>
        <button className="btn btn-sm btn-line" onClick={onClose} aria-label="Закрыть"><Icon n="close" s={16} /></button>
      </div>
      {!edit ? (
        <>
          {p.note && <p className="path-note"><b>Ваш комментарий:</b> {p.note}</p>}
          <PathTimeline p={p} />
          <div className="path-actions">
            <button className="btn btn-line" onClick={() => setEdit(true)}><Icon n="pen" s={16} />Изменить</button>
            <button className="btn btn-line" disabled={busy} onClick={() => run(() => teacherRejectPath(p.id), 'Траектория отменена')}>Отменить траекторию</button>
          </div>
        </>
      ) : (
        <>
          <div style={{ display: 'grid', gap: 6 }}>
            <Source p={p} />
            {p.data.summary && <p>{p.data.summary}</p>}
            {p.data.why?.length > 0 && <ul className="path-why">{p.data.why.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          </div>
          <ol className="path-stages edit">
            {stages.map((s, i) => (
              <li key={i} className="path-stage">
                <span className="path-dot" aria-hidden="true">{i + 1}</span>
                <div className="path-body" style={{ display: 'grid', gap: 8 }}>
                  <div className="mat-form">
                    <div className="field" style={{ flex: '2 1 220px' }}><label htmlFor={`ps${i}t`}>Этап</label>
                      <input id={`ps${i}t`} className="input" value={s.title} maxLength={80} onChange={(e) => set(i, { title: e.target.value })} /></div>
                    <div className="field" style={{ flex: '1 1 140px' }}><label htmlFor={`ps${i}f`}>С</label>
                      <input id={`ps${i}f`} type="date" className="input" value={s.from} onChange={(e) => set(i, { from: e.target.value })} /></div>
                    <div className="field" style={{ flex: '1 1 140px' }}><label htmlFor={`ps${i}e`}>По</label>
                      <input id={`ps${i}e`} type="date" className="input" value={s.to} onChange={(e) => set(i, { to: e.target.value })} /></div>
                  </div>
                  <div className="field"><label htmlFor={`ps${i}g`}>Цель</label>
                    <textarea id={`ps${i}g`} className="input" rows={2} maxLength={300} value={s.goal} onChange={(e) => set(i, { goal: e.target.value })} /></div>
                  <div>
                    <span className="label">Задания этапа</span>
                    <div className="path-tasks">
                      {all.map((id) => {
                        const on = s.tasks.includes(id)
                        return <button key={id} className={`chip ${on ? 'on' : ''}`} aria-pressed={on} title={p.data.labels[id]}
                          onClick={() => set(i, { tasks: on ? s.tasks.filter((x) => x !== id) : [...s.tasks, id].slice(0, 8) })}>{short(p.data, id)}</button>
                      })}
                    </div>
                  </div>
                  <div className="field"><label htmlFor={`ps${i}c`}>Чем проверить конец этапа</label>
                    <input id={`ps${i}c`} className="input" maxLength={200} value={s.check} onChange={(e) => set(i, { check: e.target.value })} /></div>
                  {stages.length > 1 && <button className="btn btn-sm btn-line" style={{ justifySelf: 'start' }} onClick={() => setStages(stages.filter((_, k) => k !== i))}><Icon n="trash" s={14} />Убрать этап</button>}
                </div>
              </li>
            ))}
          </ol>
          {stages.length < 6 && (
            <button className="btn btn-sm btn-line" onClick={() => {
              const last = stages[stages.length - 1]
              setStages([...stages, { title: 'Новый этап', from: last?.to ?? todayIso(), to: p.data.end, goal: '', check: '', tasks: [] }])
            }}><Icon n="plus" s={16} />Добавить этап</button>
          )}
          <div className="field" style={{ marginTop: 12 }}><label htmlFor="pnote">Комментарий {p.kind === 'class' ? 'классу' : 'ученику'}</label>
            <textarea id="pnote" className="input" rows={2} maxLength={1000} value={note} placeholder="Например: начни с № 1, потом № 5" onChange={(e) => setNote(e.target.value)} /></div>
          {err && <p style={{ color: 'var(--red)', marginTop: 8 }}>{err}</p>}
          <div className="path-actions">
            {p.status === 'active'
              ? <button className="btn btn-em" disabled={busy} onClick={() => run(save, 'Изменения сохранены')}><Icon n="ok" s={16} />Сохранить</button>
              : <button className="btn btn-em" disabled={busy} onClick={() => run(async () => { await save(); await teacherApprovePath(p.id) }, p.kind === 'class' ? 'Траектория класса утверждена' : 'Траектория утверждена')}>
                <Icon n="ok" s={16} />Утвердить</button>}
            {p.status !== 'active' && <button className="btn btn-line" disabled={busy} onClick={() => run(save, 'Черновик сохранён')}>Сохранить без утверждения</button>}
            {p.status === 'pending' && <button className="btn btn-line" disabled={busy} onClick={() => run(() => teacherRejectPath(p.id, note), 'Траектория возвращена ученику')}>Вернуть на доработку</button>}
            {p.status === 'draft' && <button className="btn btn-line" disabled={busy} onClick={() => run(() => teacherRejectPath(p.id), 'Черновик удалён')}><Icon n="trash" s={16} />Удалить черновик</button>}
          </div>
        </>
      )}
    </section>
  )
}
