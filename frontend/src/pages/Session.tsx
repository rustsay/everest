import { useEffect, useRef, useState } from 'react'
import { getResults, openWs, uploadTask, downloadReportFile } from '../api/client'
import TaskCard from '../components/TaskCard'
import { TaskResult, TASK_INFO, WsEvent } from '../types'

interface Props {
  sessionId: string
  onBack: () => void
  onOpenTrajectory?: (id: string) => void
}

const TASK_IDS = Object.keys(TASK_INFO).map(Number)
const MAX_TOTAL = 20

export default function Session({ sessionId, onBack, onOpenTrajectory }: Props) {
  const [results, setResults] = useState<Record<number, TaskResult>>({})
  const [agentProgress, setAgentProgress] = useState<Record<number, Record<number, number>>>({})
  const [reportLoading, setReportLoading] = useState<'pdf' | 'html' | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  // Load existing results when opening a past session
  useEffect(() => {
    getResults(sessionId)
      .then((data) => setResults(data.tasks ?? {}))
      .catch(() => {})
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
        [taskId]: { task_id: taskId, status: 'error', error: String(err) },
      }))
    }
  }

  const totalScore = TASK_IDS.reduce((sum, tid) => {
    const r = results[tid]
    return sum + (r?.judge_decision?.final_score ?? 0)
  }, 0)

  const doneCount = TASK_IDS.filter((tid) => results[tid]?.status === 'done').length

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="text-gray-400 hover:text-gray-600 text-lg">←</button>
            <div>
              <h1 className="text-xl font-bold text-gray-900">ЕГЭ Checker</h1>
              <p className="text-xs text-gray-400">Сессия: {sessionId.slice(0, 8)}…</p>
            </div>
          </div>
          {doneCount > 0 && (
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-2xl font-bold text-blue-600">
                  {totalScore} <span className="text-gray-400 text-lg">/ {MAX_TOTAL}</span>
                </div>
                <div className="text-xs text-gray-400">{doneCount} из {TASK_IDS.length} проверено</div>
              </div>
              <button
                onClick={async () => { setReportLoading('pdf'); try { await downloadReportFile(sessionId, 'pdf') } finally { setReportLoading(null) } }}
                disabled={reportLoading !== null}
                className="px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 text-sm font-medium transition-colors"
              >
                {reportLoading === 'pdf' ? '…' : '↓ PDF'}
              </button>
              {onOpenTrajectory && (
                <button
                  onClick={() => onOpenTrajectory(sessionId)}
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-colors"
                >
                  Траектория →
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Task grid */}
      <main className="max-w-5xl mx-auto px-6 py-8">
        <p className="text-gray-500 text-sm mb-6">
          Загружайте сканы заданий — проверка запустится автоматически после каждой загрузки.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {TASK_IDS.map((tid) => (
            <TaskCard
              key={tid}
              taskId={tid}
              result={results[tid]}
              agentProgress={agentProgress[tid] ?? {}}
              onUpload={(files) => handleUpload(tid, files)}
            />
          ))}
        </div>

        {/* Score summary — show when at least one task is done */}
        {doneCount > 0 && (
          <div className="mt-8 rounded-2xl bg-white border-2 border-blue-100 p-6 text-center shadow-sm">
            <div className="text-5xl font-bold text-blue-600 mb-1">
              {totalScore} / {MAX_TOTAL}
            </div>
            <div className="text-gray-500">
              {Math.round((totalScore / MAX_TOTAL) * 100)}% от максимума · {doneCount} из {TASK_IDS.length} заданий
            </div>
            <div className="grid grid-cols-7 gap-2 mt-6">
              {TASK_IDS.map((tid) => {
                const r = results[tid]
                const j = r?.judge_decision
                const pct = j ? j.final_score / j.max_score : 0
                return (
                  <div key={tid} className="text-center">
                    <div className="text-xs text-gray-400 mb-1">№{tid}</div>
                    <div className={`text-sm font-bold ${
                      !j ? 'text-gray-300' :
                      pct === 1 ? 'text-green-600' : pct >= 0.5 ? 'text-yellow-600' : 'text-red-600'
                    }`}>
                      {j ? `${j.final_score}/${j.max_score}` : '—'}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
