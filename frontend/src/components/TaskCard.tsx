import { useRef, useState } from 'react'
import { TaskResult, TaskStatus, TASK_INFO } from '../types'
import ResultModal from './ResultModal'

interface Props {
  taskId: number
  result?: TaskResult
  agentProgress: Record<number, number>
  onUpload: (files: File[]) => void
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: 'Ожидает загрузки',
  ocr: 'Распознавание текста…',
  checking: 'Проверка агентами…',
  done: 'Проверено',
  error: 'Ошибка',
}

function ProgressDots({ agentProgress }: { agentProgress: Record<number, number> }) {
  return (
    <div className="flex gap-2 mt-2">
      {[1, 2, 3].map((id) => (
        <div key={id} className="flex items-center gap-1 text-xs text-gray-500">
          <span className={`w-2 h-2 rounded-full ${id in agentProgress ? 'bg-blue-500' : 'bg-gray-300'}`} />
          {id in agentProgress ? `Эксп. ${id}: ${agentProgress[id]}б` : `Эксп. ${id}`}
        </div>
      ))}
    </div>
  )
}

export default function TaskCard({ taskId, result, agentProgress, onUpload }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [showModal, setShowModal] = useState(false)
  const [dragging, setDragging] = useState(false)
  const info = TASK_INFO[taskId]
  const status = result?.status ?? 'pending'
  const judge = result?.judge_decision

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return
    onUpload(Array.from(fileList))
  }

  const scoreColor = () => {
    if (!judge) return ''
    const pct = judge.final_score / judge.max_score
    return pct === 1 ? 'text-green-600' : pct >= 0.5 ? 'text-yellow-600' : 'text-red-600'
  }

  return (
    <>
      <div
        className={`rounded-xl border-2 bg-white p-5 transition-all ${
          dragging ? 'border-blue-400 bg-blue-50' :
          status === 'done' ? 'border-green-200' :
          status === 'error' ? 'border-red-200' :
          'border-gray-200'
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          handleFiles(e.dataTransfer.files)
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div>
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wide">
              Задание {taskId}
            </span>
            <h3 className="font-semibold text-gray-800">{info.topic}</h3>
            <span className="text-xs text-gray-400">макс. {info.max_score} б</span>
          </div>
          {judge && (
            <button
              onClick={() => setShowModal(true)}
              className={`text-2xl font-bold ${scoreColor()} hover:scale-110 transition-transform`}
              title="Подробнее"
            >
              {judge.final_score}/{judge.max_score}
            </button>
          )}
        </div>

        {/* Status */}
        <p className="text-sm text-gray-500 mb-3">{STATUS_LABEL[status]}</p>

        {/* Agent progress while checking */}
        {status === 'checking' && <ProgressDots agentProgress={agentProgress} />}

        {/* Error */}
        {status === 'error' && result?.error && (
          <p className="text-xs text-red-500 mt-1 break-words">{result.error}</p>
        )}

        {/* Upload button — show when pending or to re-upload */}
        {(status === 'pending' || status === 'error') && (
          <button
            onClick={() => inputRef.current?.click()}
            className="mt-3 w-full py-2 rounded-lg border-2 border-dashed border-gray-300 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-500 transition-colors"
          >
            Нажмите или перетащите сканы
            <span className="block text-xs text-gray-400 mt-0.5">можно несколько фото</span>
          </button>
        )}

        {/* Show result link when done */}
        {status === 'done' && (
          <button
            onClick={() => setShowModal(true)}
            className="mt-3 w-full py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm text-gray-600 transition-colors"
          >
            Подробный разбор →
          </button>
        )}

        <input
          ref={inputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.pdf"
          multiple
          className="hidden"
          onChange={(e) => { handleFiles(e.target.files); e.target.value = '' }}
        />
      </div>

      {showModal && judge && result?.agent_verdicts && (
        <ResultModal
          taskId={taskId}
          judge={judge}
          verdicts={result.agent_verdicts}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  )
}
