import { useRef, useState } from 'react'
import { TaskResult, TaskStatus, TASK_INFO } from '../types'
import ResultModal from './ResultModal'
import { clipboardImages } from '../utils/clipboard'

interface Props {
  sessionId: string
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
    <div className="dots">
      {[1, 2, 3].map((id) => (
        <span key={id}>
          <i className={id in agentProgress ? 'on' : ''} />
          {id in agentProgress ? `эксперт ${id}: ${agentProgress[id]} б.` : `эксперт ${id}`}
        </span>
      ))}
    </div>
  )
}

export default function TaskCard({ sessionId, taskId, result, agentProgress, onUpload }: Props) {
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
    return pct === 1 ? 'var(--em-ink)' : pct >= 0.5 ? 'var(--gold-ink)' : 'var(--red)'
  }

  return (
    <>
      <div
        tabIndex={0}
        className={`tcard ${dragging ? 'drag' : status === 'done' ? 'done' : status === 'error' ? 'err' : ''}`}
        onPaste={(event) => {
          if (status !== 'pending' && status !== 'error') return
          const files = clipboardImages(event.clipboardData)
          if (files.length) { event.preventDefault(); onUpload(files) }
        }}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          handleFiles(e.dataTransfer.files)
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div>
            <span className="label">Задание {taskId}</span>
            <h3 style={{ marginTop: 2 }}>{info.topic}</h3>
            <span className="muted" style={{ fontSize: 12 }}>максимум {info.max_score} б.</span>
          </div>
          {judge && (
            <button onClick={() => setShowModal(true)} className="score num" style={{ border: 0, background: 'none', cursor: 'pointer', color: scoreColor() }} title="Подробнее">
              {judge.final_score}/{judge.max_score}
            </button>
          )}
        </div>
        <p className="muted" style={{ fontSize: 13.5 }}>{STATUS_LABEL[status]}</p>
        {(status === 'ocr' || status === 'checking') && <div className="phase run" style={{ alignSelf: 'flex-start' }}>{status === 'ocr' ? 'Распознаём почерк' : 'Проверяем по критериям'}</div>}
        {status === 'checking' && <ProgressDots agentProgress={agentProgress} />}
        {status === 'error' && result?.error && <p style={{ fontSize: 12.5, color: 'var(--red)', wordBreak: 'break-word' }}>{result.error}</p>}
        {(status === 'pending' || status === 'error') && (
          <button onClick={() => inputRef.current?.click()} className="drop" style={{ padding: 14, cursor: 'pointer', font: 'inherit', color: 'inherit' }}>
            <b>Сфотографируйте или перетащите сюда</b>
            <span className="muted" style={{ fontSize: 12 }}>можно несколько фото, jpg, png или pdf · вставка фото: Ctrl+V или ⌘V</span>
          </button>
        )}
        {status === 'done' && <button onClick={() => setShowModal(true)} className="btn btn-sm btn-ghost">Подробный разбор →</button>}
        <input
          ref={inputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.pdf"
          capture="environment"
          multiple
          className="hidden"
          hidden
          onChange={(e) => { handleFiles(e.target.files); e.target.value = '' }}
        />
      </div>

      {showModal && judge && (
        <ResultModal
          sessionId={sessionId}
          taskId={taskId}
          judge={judge}
          verdicts={result?.agent_verdicts ?? []}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  )
}
