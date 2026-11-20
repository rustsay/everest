import { EXAM_NAMES, useApp } from '../app/store'
import type { ExamKey } from '../app/store'

/** A teacher or tutor picks whose tasks to see: ЕГЭ профиль, ЕГЭ база or ОГЭ. Students never see it. */
export default function ExamSwitch({ onChange }: { onChange?: (k: ExamKey) => void }) {
  const app = useApp()
  if (app.me.role === 'student') return null
  return (
    <div className="seg" role="group" aria-label="Экзамен">
      {(Object.keys(EXAM_NAMES) as ExamKey[]).map((k) => (
        <button key={k} type="button" aria-pressed={app.exam === k} onClick={() => { app.setExam(k); onChange?.(k) }}>{EXAM_NAMES[k]}</button>
      ))}
    </div>
  )
}
