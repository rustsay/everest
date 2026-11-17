import { useEffect, useState } from 'react'
import { createSession, listSessions } from '../api/client'
import { useApp } from '../app/store'
import { SessionSummary, TASK_INFO } from '../types'
import { Icon, StarBot } from '../design/ui'

const TASK_IDS = Object.keys(TASK_INFO).map(Number)

/** Photo check (existing multi-agent service): history of sessions and a new check. */
export default function Check() {
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
      <div className="card-h" style={{ margin: 0 }}>
        <div><p className="muted">Вторая часть ЕГЭ · задания 13-19</p><h1>Проверка решения по фото</h1></div>
        <button className="btn btn-gold" onClick={startNew} disabled={creating}><Icon n="check" s={18} c="#16231F" />{creating ? 'Создаю…' : 'Новая проверка'}</button>
      </div>
      <section className="card check-intro">
        <StarBot size={64} />
        <div style={{ flex: '1 1 260px' }}>
          <b>Как проверяем</b>
          <p className="muted" style={{ marginTop: 4 }}>Сфотографируй решение целиком. Почерк распознаётся, затем три эксперта независимо ставят баллы по критериям ФИПИ. Если они расходятся, решает судья, а спорные работы видит учитель.</p>
        </div>
      </section>
      <section>
        <h2 style={{ marginBottom: 12 }}>История проверок</h2>
        {sessions === null && <p className="muted">Загружаю…</p>}
        {sessions?.length === 0 && <p className="muted">Проверок пока нет. Нажми «Новая проверка».</p>}
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
