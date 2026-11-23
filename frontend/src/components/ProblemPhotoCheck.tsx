import { FormEvent, useEffect, useId, useRef, useState } from 'react'
import { checkFirstPart, checkSecondPart, createSession, getResults, uploadTask } from '../api/client'
import { useApp } from '../app/store'
import type { Check1Result, Check2Result, TaskResult } from '../types'
import { examRange } from '../types'
import { Icon } from '../design/ui'
import { clipboardImages } from '../utils/clipboard'
import { Verdict } from './Check1'
import TaskCard from './TaskCard'
import PhotoFiles from './PhotoFiles'

/** Check the selected bank problem without leaving its card or losing the bank filters. */
export default function ProblemPhotoCheck({ task, problemRef, initialAnswer, onDone, onClose }: {
  task: number; problemRef: string; initialAnswer: string; onDone: () => void; onClose: () => void
}) {
  const app = useApp()
  const id = useId()
  const firstPart = task < examRange(app.exam).p2
  const profile = !firstPart && app.exam === 'prof'
  const [answer, setAnswer] = useState(initialAnswer)
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [shortResult, setShortResult] = useState<Check1Result | null>(null)
  const [longResult, setLongResult] = useState<Check2Result | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [taskResult, setTaskResult] = useState<TaskResult | undefined>()
  const processing = taskResult?.status === 'ocr' || taskResult?.status === 'checking'
  const blocked = busy || processing
  const completeRef = useRef(() => {})
  completeRef.current = () => { onDone(); void app.reload() }

  useEffect(() => {
    if (!sessionId) return
    let active = true
    const refresh = async () => {
      try {
        const data = await getResults(sessionId)
        if (!active) return
        const result: TaskResult | undefined = data.tasks?.[task]
        if (!result) return
        setTaskResult(result)
        setError('')
        if (result.status === 'done' || result.status === 'error') {
          active = false
          window.clearInterval(timer)
          if (result.status === 'done') completeRef.current()
        }
      } catch {
        if (active) setError('Не удалось обновить результат. Пробуем ещё раз…')
      }
    }
    const timer = window.setInterval(refresh, 2000)
    void refresh()
    return () => { active = false; window.clearInterval(timer) }
  }, [sessionId, task])

  const check = async (selected: File[]) => {
    if (blocked) return
    if (!selected.length) { setError('Прикрепи фото решения'); return }
    setBusy(true); setError('')
    setShortResult(null); setLongResult(null)
    try {
      if (profile) {
        setSessionId(null)
        setTaskResult({ task_id: task, status: 'ocr' })
        const sid = await createSession()
        await uploadTask(sid, task, selected, problemRef)
        setSessionId(sid)
      } else if (firstPart) {
        setShortResult(await checkFirstPart({ task, ref: problemRef, answer, files: selected, exam: app.exam }))
        completeRef.current()
      } else {
        setLongResult(await checkSecondPart({ task, ref: problemRef, files: selected, exam: app.exam }))
        completeRef.current()
      }
    } catch (err) {
      const message = String(err).replace('Error: ', '')
      setError(message)
      if (profile) setTaskResult({ task_id: task, status: 'error', error: message })
    } finally { setBusy(false) }
  }
  const submit = (event: FormEvent) => { event.preventDefault(); void check(files) }

  return (
    <section className="c1-form" style={{ marginTop: 12 }} aria-label={`Проверка по фото задачи ${problemRef}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
        <b>Проверка решения по фото</b>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} disabled={busy}>Свернуть</button>
      </div>
      <form onSubmit={submit} className="c1-form" onPaste={(event) => {
        if (blocked) return
        const images = clipboardImages(event.clipboardData)
        if (!images.length) return
        event.preventDefault(); event.stopPropagation()
        setFiles((previous) => [...previous, ...images].slice(0, 5))
      }}>
        <fieldset disabled={blocked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} className="c1-form">
          {firstPart && <div className="field"><label htmlFor={`${id}-answer`}>Твой ответ</label>
            <input id={`${id}-answer`} className="input" value={answer} maxLength={40} onChange={(event) => setAnswer(event.target.value)} placeholder="например, 0,5" />
          </div>}
          <PhotoFiles id={`${id}-files`} files={files} onChange={setFiles} disabled={blocked}
            accept={profile ? '.jpg,.jpeg,.png,.pdf' : undefined}
            formats={profile ? 'JPG, PNG или PDF' : undefined} />
          <button className="btn btn-gold" type="submit" disabled={blocked || !files.length}>
            <Icon n="check" s={18} c="#16231F" />{blocked ? 'Проверяю…' : 'Проверить решение'}
          </button>
        </fieldset>
      </form>
      {error && <p role="alert" className="auth-msg">{error}</p>}
      {shortResult && <div aria-live="polite"><Verdict r={shortResult} /></div>}
      {longResult && <div className="c1-res" aria-live="polite">
        <span className={`pill num ${longResult.score === longResult.max ? 'p-em' : longResult.score ? 'p-gold' : 'p-bad'}`}>{longResult.score} из {longResult.max}</span>
        <p style={{ marginTop: 6 }}>{longResult.comment}</p>
        <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>Балл учтён в прогнозе и расписании.</p>
      </div>}
      {sessionId && taskResult && <TaskCard sessionId={sessionId} taskId={task} result={taskResult} agentProgress={{}}
        onUpload={(selected) => { setFiles(selected); void check(selected) }} />}
    </section>
  )
}
