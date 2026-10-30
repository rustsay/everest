import { AgentVerdict, JudgeDecision, TASK_INFO } from '../types'

interface Props {
  taskId: number
  judge: JudgeDecision
  verdicts: AgentVerdict[]
  onClose: () => void
}

const CONSENSUS_LABEL: Record<string, string> = {
  full: 'Единогласно',
  majority: 'Большинство',
  judge_decision: 'Решение судьи',
}

function ScoreBadge({ score, max }: { score: number; max: number }) {
  const pct = score / max
  const cls =
    pct === 1 ? 'bg-green-100 text-green-800' :
    pct >= 0.5 ? 'bg-yellow-100 text-yellow-800' :
    'bg-red-100 text-red-800'
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-semibold ${cls}`}>
      {score}/{max}
    </span>
  )
}

export default function ResultModal({ taskId, judge, verdicts, onClose }: Props) {
  const info = TASK_INFO[taskId]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-xl font-bold">Задание {taskId} — {info.topic}</h2>
            <div className="flex items-center gap-2 mt-1">
              <ScoreBadge score={judge.final_score} max={judge.max_score} />
              <span className="text-sm text-gray-500">{CONSENSUS_LABEL[judge.consensus_level]}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Judge reasoning */}
          <section>
            <h3 className="font-semibold text-gray-700 mb-2">Итоговый вердикт</h3>
            <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{judge.reasoning}</p>
          </section>

          {/* Agent scores */}
          <section>
            <h3 className="font-semibold text-gray-700 mb-3">Оценки экспертов</h3>
            <div className="space-y-3">
              {verdicts.map((v) => (
                <div key={v.agent_id} className="border rounded-lg p-4 bg-gray-50">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="font-medium text-sm">Эксперт {v.agent_id}</span>
                    <ScoreBadge score={v.score} max={v.max_score} />
                    <span className="text-xs text-gray-400 ml-auto">
                      уверенность {Math.round(v.confidence * 100)}%
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 whitespace-pre-wrap mb-2">{v.reasoning}</p>
                  {v.errors_found.length > 0 && (
                    <div className="mt-2">
                      <span className="text-xs font-medium text-red-600">Ошибки:</span>
                      <ul className="list-disc list-inside text-xs text-red-600 mt-1">
                        {v.errors_found.map((e, i) => <li key={i}>{e}</li>)}
                      </ul>
                    </div>
                  )}
                  {v.correct_steps.length > 0 && (
                    <div className="mt-2">
                      <span className="text-xs font-medium text-green-600">Верно:</span>
                      <ul className="list-disc list-inside text-xs text-green-600 mt-1">
                        {v.correct_steps.map((s, i) => <li key={i}>{s}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

        </div>
      </div>
    </div>
  )
}
