import { useEffect, useState } from 'react'
import { createSession, listSessions } from '../api/client'
import { useApp } from '../app/store'
import { SessionSummary, TASK_INFO } from '../types'
import { Icon, StarBot } from '../design/ui'
import NoLlm from '../components/NoLlm'
import Check1 from '../components/Check1'
import Check2 from '../components/Check2'
import ExamSwitch from '../components/ExamSwitch'

const TASK_IDS = Object.keys(TASK_INFO).map(Number)

/** Parts of each exam: the first part has a short answer, the second a full solution. Base has one part. */
const PARTS: Record<string, { p1: [number, number]; p2?: [number, number] }> = {
  prof: { p1: [1, 12], p2: [13, 19] }, oge: { p1: [1, 19], p2: [20, 25] }, base: { p1: [1, 21] },
}

/** Photo check in one window: the switch of the parts on top, each exam with its own tasks. */
export default function Check() {
  const app = useApp()
  const exam = app.exam
  const parts = PARTS[exam] ?? PARTS.prof
  const id = app.view.id ?? ''
  const part: 1 | 2 = parts.p2 && id === 'p2' ? 2 : 1
  const preset = id.match(/^1-(\d+)-(.+)$/)  // #check/1-6-f300: a first-part problem opened from the bank
  const examName = exam === 'oge' ? 'ОГЭ' : exam === 'base' ? 'ЕГЭ база' : 'ЕГЭ профиль'
  return (
    <>
      <div className="card-h" style={{ margin: 0, alignItems: 'flex-end' }}>
        <div><p className="muted">{examName}</p><h1>Проверка решения по фото</h1></div>
        <ExamSwitch onChange={() => app.go('check')} />
      </div>
      {parts.p2 && (
        <div className="seg check-parts" role="tablist" aria-label="Часть экзамена">
          <button role="tab" aria-pressed={part === 1} aria-selected={part === 1} onClick={() => app.go('check')}>Первая часть · {parts.p1[0]}-{parts.p1[1]}</button>
          <button role="tab" aria-pressed={part === 2} aria-selected={part === 2} onClick={() => app.go({ v: 'check', id: 'p2' })}>Вторая часть · {parts.p2[0]}-{parts.p2[1]}</button>
        </div>
      )}
      <NoLlm what="Проверка по фото" />
      {part === 1 && <Check1 key={exam + id} from={parts.p1[0]} to={parts.p1[1]} presetTask={preset ? Number(preset[1]) : undefined} preset={preset?.[2]}
        title={parts.p2 ? `Первая часть · задания ${parts.p1[0]}-${parts.p1[1]}` : `Задания ${parts.p1[0]}-${parts.p1[1]}`} />}
      {part === 2 && exam === 'oge' && <Check2 key={exam} />}
      {part === 2 && exam === 'prof' && <Part2Prof />}
    </>
  )
}

/** Profile, tasks 13-19: the multi-agent check of a session (three experts, a judge, the teacher sees disputed works). */
function Part2Prof() {
  const app = useApp()
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null)
  const [creating, setCreating] = useState(false)
  useEffect(() => { listSessions().then((d) => setSessions(d.sessions)).catch(() => setSessions([])) }, [])
  const startNew = async () => {
    setCreating(true)
    try { app.go({ v: 'session', id: await createSession() }) } catch (e) { app.toast(String(e).replace('Error: ', '')) } finally { setCreating(false) }
  }
  return (
    <>
      <section className="card check-intro">
        <StarBot size={64} />
        <div style={{ flex: '1 1 260px' }}>
          <b>Задания 13-19: как проверяем</b>
          <p className="muted" style={{ marginTop: 4 }}>Сфотографируй решение целиком. Почерк распознаётся, затем три эксперта независимо ставят баллы по критериям ФИПИ. Если они расходятся, решает судья, а спорные работы видит учитель.</p>
        </div>
        <button className="btn btn-gold" onClick={startNew} disabled={creating}><Icon n="check" s={18} c="#16231F" />{creating ? 'Создаю…' : 'Новая проверка'}</button>
      </section>
      <section>
        <h2 style={{ marginBottom: 12 }}>История проверок</h2>
        {sessions === null && <p className="muted">Загружаю…</p>}
        {sessions?.length === 0 && <p className="muted">Проверок второй части пока нет. Нажми «Новая проверка».</p>}
        <div className="sess-grid">
          {sessions?.map((s) => (
            <button key={s.session_id} className="tcard" style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit' }} onClick={() => app.go({ v: 'session', id: s.session_id })}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span className="muted" style={{ fontSize: 12.5 }}>{new Date(s.created_at).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}<br />{s.completed_tasks} из {TASK_IDS.length} заданий</span>
                <span className="score num">{s.total_score}<span className="muted" style={{ fontSize: 15 }}>/{s.max_total}</span></span>
              </div>
              <div className="bar"><i style={{ width: `${s.max_total ? (s.total_score / s.max_total) * 100 : 0}%`, background: 'var(--em-3)' }} /></div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,minmax(0,1fr))', gap: 2, fontSize: 11.5, textAlign: 'center' }}>
                {TASK_IDS.map((tid) => { const sc = s.task_scores[tid], mx = TASK_INFO[tid].max_score; return <span key={tid}><span className="muted">№{tid}</span><br /><b style={{ color: sc === undefined ? 'var(--muted)' : sc === mx ? 'var(--em-ink)' : sc >= mx / 2 ? 'var(--gold-ink)' : 'var(--red)' }}>{sc === undefined ? '-' : `${sc}/${mx}`}</b></span> })}
              </div>
            </button>
          ))}
        </div>
      </section>
    </>
  )
}
