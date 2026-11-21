import { useEffect, useRef, useState } from 'react'
import { getResults, openWs, uploadTask, downloadReportFile } from '../api/client'
import TaskCard from '../components/TaskCard'
import { TaskResult, TASK_INFO, WsEvent } from '../types'
import NoLlm from '../components/NoLlm'
import WorkUpload from '../components/WorkUpload'

interface Props {
  sessionId: string
  onBack: () => void
  /** called after each finished check: the dashboard reloads the forecast */
  onChecked?: () => void
}

const TASK_IDS = Object.keys(TASK_INFO).map(Number)
const MAX_TOTAL = 20

export default function Session({ sessionId, onBack, onChecked }: Props) {
  const [results, setResults] = useState<Record<number, TaskResult>>({})
  const [mode, setMode] = useState<'all' | 'manual'>('all')
  const [agentProgress, setAgentProgress] = useState<Record<number, Record<number, number>>>({})
  const [reportLoading, setReportLoading] = useState<'pdf' | 'html' | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  // Load existing results when opening a past session
  useEffect(() => {
    getResults(sessionId)
      .then((data) => setResults(data.tasks ?? {}))
      .catch(() => {})
  }, [sessionId])

  // Recover final results even if a socket event was missed or the page was reopened.
  useEffect(() => {
    const timer = window.setInterval(() => {
      getResults(sessionId).then((data) => setResults(data.tasks ?? {})).catch(() => {})
    }, 5000)
    return () => window.clearInterval(timer)
  }, [sessionId])

  useEffect(() => {
    const ws = openWs(sessionId)
    wsRef.current = ws

    ws.onmessage = (e) => {
      const ev: WsEvent = JSON.parse(e.data)

      if (ev.event === 'ocr_done') {
        setResults((prev) => ({
          ...prev,
          [ev.task_id]: { ...prev[ev.task_id], task_id: ev.task_id, status: 'checking' },
        }))
      }

      if (ev.event === 'agent_done') {
        setAgentProgress((prev) => ({
          ...prev,
          [ev.task_id]: { ...(prev[ev.task_id] ?? {}), [ev.agent_id]: ev.score },
        }))
      }

      if (ev.event === 'task_complete') {
        onChecked?.()
        getResults(sessionId)
          .then((data) => setResults(data.tasks ?? {}))
          .catch(() => {})
      }

      if (ev.event === 'task_error') {
        setResults((prev) => ({
          ...prev,
          [ev.task_id]: {
            ...prev[ev.task_id],
            task_id: ev.task_id,
            status: 'error',
            error: ev.error,
          },
        }))
      }
    }

    return () => ws.close()
  }, [sessionId])

  const handleUpload = async (taskId: number, files: File[]) => {
    setResults((prev) => ({
      ...prev,
      [taskId]: { task_id: taskId, status: 'ocr' },
    }))
    setAgentProgress((prev) => ({ ...prev, [taskId]: {} }))
    try {
      await uploadTask(sessionId, taskId, files)
    } catch (err) {
      setResults((prev) => ({
        ...prev,
        [taskId]: { task_id: taskId, status: 'error', error: String(err).replace('Error: ', '') },
      }))
    }
  }

  const totalScore = TASK_IDS.reduce((sum, tid) => {
    const r = results[tid]
    return sum + (r?.judge_decision?.final_score ?? 0)
  }, 0)

  const doneCount = TASK_IDS.filter((tid) => results[tid]?.status === 'done').length

  return (
    <>
      <div className="card-h" style={{ margin: 0 }}>
        <div>
          <button className="btn btn-sm btn-ghost" onClick={onBack} style={{ marginBottom: 8 }}>← Все проверки</button>
          <p className="muted">Проверка второй части · сессия {sessionId.slice(0, 8)}</p>
          <h1>Проверка решения по фото</h1>
        </div>
        {doneCount > 0 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="pill p-em num" style={{ fontSize: 14 }}>{totalScore} / {MAX_TOTAL} · {doneCount} из {TASK_IDS.length}</span>
            <button
              onClick={async () => { setReportLoading('pdf'); try { await downloadReportFile(sessionId, 'pdf') } finally { setReportLoading(null) } }}
              disabled={reportLoading !== null}
              className="btn btn-sm btn-ghost"
            >
              {reportLoading === 'pdf' ? '…' : '↓ PDF'}
            </button>
          </div>
        )}
      </div>
      <NoLlm what="Проверка по фото" />
      <p className="muted">Три эксперта проверяют каждое задание отдельно по критериям ФИПИ. Итог обновит прогноз и расписание.</p>
      <div className="seg" role="group" aria-label="Способ загрузки" style={{ marginBottom: 16 }}>
        <button aria-pressed={mode === 'all'} onClick={() => setMode('all')}>Все фото сразу</button>
        <button aria-pressed={mode === 'manual'} onClick={() => setMode('manual')}>По заданиям вручную</button>
      </div>
      <div hidden={mode !== 'all'}><WorkUpload key={sessionId} sessionId={sessionId} hasErrors={Object.values(results).some((r) => r.status === 'error')} onStarted={(tasks) => {
        setResults((prev) => { const next = { ...prev }; tasks.forEach((t) => { next[t] = { task_id: t, status: 'ocr' } }); return next })
        setAgentProgress({})
      }} /></div>
      {mode === 'manual' && <p className="muted">Выберите фото для каждого задания. Проверка начнётся сразу после загрузки в карточку.</p>}
      <div className="sess-grid">
        {TASK_IDS.filter((tid) => mode === 'manual' || results[tid]).map((tid) => (
          <TaskCard
            sessionId={sessionId}
            key={tid}
            taskId={tid}
            result={results[tid]}
            agentProgress={agentProgress[tid] ?? {}}
            onUpload={(files) => handleUpload(tid, files)}
          />
        ))}
      </div>
      {doneCount > 0 && (
        <section className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 44 }} className="num">{totalScore} / {MAX_TOTAL}</div>
          <p className="muted">{Math.round((totalScore / MAX_TOTAL) * 100)}% от максимума второй части · {doneCount} из {TASK_IDS.length} заданий</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,minmax(0,1fr))', gap: 6, marginTop: 16 }}>
            {TASK_IDS.map((tid) => {
              const j = results[tid]?.judge_decision
              const pct = j ? j.final_score / j.max_score : 0
              return (
                <div key={tid}>
                  <div className="muted" style={{ fontSize: 12 }}>№{tid}</div>
                  <b className="num" style={{ color: !j ? 'var(--muted)' : pct === 1 ? 'var(--em-ink)' : pct >= 0.5 ? 'var(--gold-ink)' : 'var(--red)' }}>{j ? `${j.final_score}/${j.max_score}` : '-'}</b>
                </div>
              )
            })}
          </div>
        </section>
      )}
    </>
  )
}
