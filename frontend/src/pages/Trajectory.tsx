import { useEffect, useState } from 'react'
import { fetchTrajectory, openWs, startTrajectory } from '../api/client'
import { TASK_INFO, Trajectory, TaskPlan, WeekPlan, PracticeProblem, WsEvent } from '../types'

interface Props {
  sessionId: string
  onBack: () => void
}

const PRIORITY_STYLE: Record<string, string> = {
  'высокий': 'bg-red-100 text-red-700',
  'средний': 'bg-yellow-100 text-yellow-700',
  'низкий':  'bg-green-100 text-green-700',
}

function ProblemCard({ p, idx }: { p: PracticeProblem; idx: number }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        className="w-full text-left px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <span className="font-medium text-gray-700 text-sm">Задача {idx + 1}</span>
        <span className="float-right text-gray-400 text-sm">{open ? '▲' : '▼'}</span>
        <p className="text-sm text-gray-600 mt-1 pr-6 line-clamp-2">{p.problem}</p>
      </button>
      {open && (
        <div className="px-4 py-3 space-y-3 border-t border-gray-200">
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase mb-1">Условие</p>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{p.problem}</p>
          </div>
          <div className="bg-yellow-50 rounded-lg p-3">
            <p className="text-xs font-bold text-yellow-700 uppercase mb-1">Подсказка</p>
            <p className="text-sm text-yellow-800">{p.hint}</p>
          </div>
          <details>
            <summary className="text-sm text-blue-600 cursor-pointer hover:text-blue-800 font-medium">
              Показать решение
            </summary>
            <div className="mt-2 bg-blue-50 rounded-lg p-3">
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{p.solution}</p>
            </div>
          </details>
        </div>
      )}
    </div>
  )
}

function TaskPlanCard({ plan }: { plan: TaskPlan }) {
  const [expanded, setExpanded] = useState(plan.priority === 'высокий')
  const pct = plan.current_score / plan.max_score
  const scoreColor = pct === 1 ? 'text-green-600' : pct >= 0.5 ? 'text-yellow-600' : 'text-red-600'
  const info = TASK_INFO[plan.task_id]

  return (
    <div className={`rounded-xl border-2 bg-white transition-all ${
      plan.priority === 'высокий' ? 'border-red-200' :
      plan.priority === 'средний' ? 'border-yellow-200' : 'border-green-200'
    }`}>
      <button
        className="w-full text-left p-5"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-bold text-gray-400 uppercase">Задание {plan.task_id}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_STYLE[plan.priority] ?? 'bg-gray-100 text-gray-600'}`}>
                {plan.priority} приоритет
              </span>
            </div>
            <h3 className="font-semibold text-gray-800">{plan.topic ?? info?.topic}</h3>
          </div>
          <div className="text-right ml-4">
            <div className={`text-xl font-bold ${scoreColor}`}>
              {plan.current_score}/{plan.max_score}
            </div>
            <div className="text-xs text-gray-400">{plan.recommended_hours}ч</div>
          </div>
          <span className="ml-3 text-gray-400">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-5 space-y-4 border-t border-gray-100">
          {plan.weak_aspects.length > 0 && (
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase mb-2">Проблемные места</p>
              <div className="flex flex-wrap gap-2">
                {plan.weak_aspects.map((a, i) => (
                  <span key={i} className="text-xs bg-red-50 text-red-700 px-2 py-1 rounded-full">{a}</span>
                ))}
              </div>
            </div>
          )}

          {plan.key_theory?.length > 0 && (
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase mb-2">Ключевая теория</p>
              <ul className="space-y-1">
                {plan.key_theory.map((t, i) => (
                  <li key={i} className="text-sm text-gray-600 flex gap-2">
                    <span className="text-blue-400 flex-shrink-0">→</span>{t}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {plan.practice_problems?.length > 0 && (
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase mb-2">
                Практические задания ({plan.practice_problems.length})
              </p>
              <div className="space-y-2">
                {plan.practice_problems.map((p, i) => (
                  <ProblemCard key={i} p={p} idx={i} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function WeekCard({ week, idx }: { week: WeekPlan; idx: number }) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center">
        <div className="w-8 h-8 rounded-full bg-blue-600 text-white text-sm font-bold flex items-center justify-center flex-shrink-0">
          {idx + 1}
        </div>
        <div className="w-0.5 bg-blue-100 flex-1 mt-1" />
      </div>
      <div className="pb-6 flex-1">
        <div className="flex items-center gap-3 mb-2">
          <h3 className="font-semibold text-gray-800">{week.week_label}</h3>
          <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">
            {week.hours_per_day}ч/день
          </span>
          {week.focus_tasks.map(t => (
            <span key={t} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
              Зад. {t}
            </span>
          ))}
        </div>
        <ul className="space-y-1">
          {week.goals.map((g, i) => (
            <li key={i} className="text-sm text-gray-600 flex gap-2">
              <span className="text-green-400 flex-shrink-0">✓</span>{g}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export default function TrajectoryPage({ sessionId, onBack }: Props) {
  const [traj, setTraj] = useState<Trajectory | null>(null)
  const [status, setStatus] = useState<'loading' | 'generating' | 'done' | 'error'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    // Try fetching existing trajectory first
    fetchTrajectory(sessionId)
      .then((data) => { setTraj(data); setStatus('done') })
      .catch(() => {
        // Not found — start generation
        startTrajectory(sessionId)
          .then(() => setStatus('generating'))
          .catch((e) => { setStatus('error'); setError(String(e)) })
      })
  }, [sessionId])

  useEffect(() => {
    if (status !== 'generating') return
    const ws = openWs(sessionId)
    ws.onmessage = (e) => {
      const ev: WsEvent = JSON.parse(e.data)
      if (ev.event === 'trajectory_done') {
        fetchTrajectory(sessionId)
          .then((data) => { setTraj(data); setStatus('done') })
          .catch(() => { setStatus('error'); setError('Не удалось загрузить траекторию') })
      }
      if (ev.event === 'trajectory_error') {
        setStatus('error')
        setError(ev.error)
      }
    }
    return () => ws.close()
  }, [status, sessionId])

  const sortedPlans = traj?.task_plans.slice().sort((a, b) => {
    const order = { 'высокий': 0, 'средний': 1, 'низкий': 2 }
    return (order[a.priority] ?? 1) - (order[b.priority] ?? 1)
  }) ?? []

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-3">
          <button onClick={onBack} className="text-gray-400 hover:text-gray-600 text-lg">←</button>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Образовательная траектория</h1>
            <p className="text-xs text-gray-400">Сессия: {sessionId.slice(0, 8)}…</p>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">

        {/* Loading */}
        {(status === 'loading' || status === 'generating') && (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
            <p className="text-gray-600 font-medium">
              {status === 'loading' ? 'Загрузка…' : 'ИИ анализирует ошибки и строит траекторию…'}
            </p>
            {status === 'generating' && (
              <p className="text-sm text-gray-400 max-w-sm text-center">
                Это занимает 15–30 секунд. Не закрывайте страницу.
              </p>
            )}
          </div>
        )}

        {/* Error */}
        {status === 'error' && (
          <div className="rounded-xl bg-red-50 border border-red-200 p-6 text-center">
            <p className="text-red-600 font-medium mb-2">Ошибка генерации</p>
            <p className="text-sm text-red-500">{error}</p>
          </div>
        )}

        {/* Content */}
        {status === 'done' && traj && (
          <div className="space-y-8">

            {/* Summary banner */}
            <div className="rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 p-6 text-white">
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div>
                  <div className="text-3xl font-bold">{traj.current_score}/20</div>
                  <div className="text-blue-200 text-sm">Текущий балл</div>
                </div>
                <div>
                  <div className="text-3xl font-bold">{traj.days_until_exam}</div>
                  <div className="text-blue-200 text-sm">Дней до ЕГЭ</div>
                </div>
                <div>
                  <div className="text-3xl font-bold">20/20</div>
                  <div className="text-blue-200 text-sm">Цель</div>
                </div>
              </div>
              <p className="text-blue-100 text-sm leading-relaxed">{traj.overall_analysis}</p>
            </div>

            {/* Topics summary */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white rounded-xl border border-green-200 p-4">
                <p className="text-xs font-bold text-green-600 uppercase mb-3">Сильные темы</p>
                <div className="flex flex-wrap gap-2">
                  {traj.strong_topics.length ? traj.strong_topics.map((t, i) => (
                    <span key={i} className="text-sm bg-green-50 text-green-700 px-3 py-1 rounded-full">{t}</span>
                  )) : <span className="text-sm text-gray-400">—</span>}
                </div>
              </div>
              <div className="bg-white rounded-xl border border-red-200 p-4">
                <p className="text-xs font-bold text-red-600 uppercase mb-3">Слабые темы</p>
                <div className="flex flex-wrap gap-2">
                  {traj.weak_topics.length ? traj.weak_topics.map((t, i) => (
                    <span key={i} className="text-sm bg-red-50 text-red-700 px-3 py-1 rounded-full">{t}</span>
                  )) : <span className="text-sm text-gray-400">—</span>}
                </div>
              </div>
            </div>

            {/* Weekly timeline */}
            {traj.week_plans.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <h2 className="font-bold text-gray-800 mb-5">Недельный план</h2>
                <div>
                  {traj.week_plans.map((w, i) => (
                    <WeekCard key={i} week={w} idx={i} />
                  ))}
                </div>
              </div>
            )}

            {/* Task plans */}
            <div>
              <h2 className="font-bold text-gray-800 mb-4">Детальный план по заданиям</h2>
              <div className="space-y-3">
                {sortedPlans.map((plan) => (
                  <TaskPlanCard key={plan.task_id} plan={plan} />
                ))}
              </div>
            </div>

          </div>
        )}
      </main>
    </div>
  )
}
