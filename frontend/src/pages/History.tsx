import { useEffect, useState } from 'react'
import { createSession, listSessions } from '../api/client'
import { SessionSummary, TASK_INFO } from '../types'

const TASK_IDS = Object.keys(TASK_INFO).map(Number)

interface Props {
  email: string
  onOpenSession: (id: string) => void
  onLogout: () => void
}

function ScoreBar({ score, max }: { score: number; max: number }) {
  const pct = max ? (score / max) * 100 : 0
  const color = pct === 100 ? 'bg-green-500' : pct >= 50 ? 'bg-yellow-400' : 'bg-red-400'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-sm font-semibold tabular-nums w-12 text-right">
        {score}/{max}
      </span>
    </div>
  )
}

function SessionCard({ s, onOpen }: { s: SessionSummary; onOpen: () => void }) {
  const date = new Date(s.created_at).toLocaleString('ru-RU', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  return (
    <div
      className="bg-white border rounded-xl p-5 hover:border-blue-300 hover:shadow-sm transition-all cursor-pointer"
      onClick={onOpen}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-xs text-gray-400">{date}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {s.completed_tasks} из {TASK_IDS.length} заданий
          </p>
        </div>
        <span className="text-xl font-bold text-blue-600">
          {s.total_score}<span className="text-gray-300 text-base">/{s.max_total}</span>
        </span>
      </div>

      <ScoreBar score={s.total_score} max={s.max_total} />

      <div className="grid grid-cols-7 gap-1 mt-3">
        {TASK_IDS.map((tid) => {
          const score = s.task_scores[tid]
          const max = TASK_INFO[tid].max_score
          const hasDot = score !== undefined
          return (
            <div key={tid} className="text-center">
              <p className="text-xs text-gray-400">№{tid}</p>
              <p className={`text-xs font-semibold ${
                !hasDot ? 'text-gray-300' :
                score === max ? 'text-green-600' :
                score >= max / 2 ? 'text-yellow-600' : 'text-red-500'
              }`}>
                {hasDot ? `${score}/${max}` : '—'}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function History({ email, onOpenSession, onLogout }: Props) {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    listSessions()
      .then((d) => setSessions(d.sessions))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const handleNew = async () => {
    setCreating(true)
    try {
      const id = await createSession()
      onOpenSession(id)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">ЕГЭ Checker</h1>
            <p className="text-xs text-gray-400">{email}</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleNew}
              disabled={creating}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              {creating ? '…' : '+ Новая проверка'}
            </button>
            <button
              onClick={onLogout}
              className="text-sm text-gray-400 hover:text-gray-600"
            >
              Выйти
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">История проверок</h2>

        {loading && (
          <p className="text-gray-400 text-sm">Загрузка…</p>
        )}

        {!loading && sessions.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <p className="text-lg">Проверок пока нет</p>
            <p className="text-sm mt-1">Нажми «+ Новая проверка» чтобы начать</p>
          </div>
        )}

        <div className="space-y-3">
          {sessions.map((s) => (
            <SessionCard key={s.session_id} s={s} onOpen={() => onOpenSession(s.session_id)} />
          ))}
        </div>
      </main>
    </div>
  )
}
