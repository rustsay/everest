import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import { AgentVerdict, JudgeDecision, TASK_INFO } from '../types'
import ReviewConversation from './ReviewConversation'

interface Props {
  sessionId: string
  taskId: number
  judge: JudgeDecision
  verdicts: AgentVerdict[]
  onClose: () => void
}

const CONSENSUS_LABEL: Record<string, string> = {
  full: 'Единогласно',
  majority: 'Большинство',
  judge_decision: 'Решение судьи',
  teacher: 'Решение учителя',
}

function ScoreBadge({ score, max }: { score: number; max: number }) {
  const pct = score / max
  const cls = pct === 1 ? 'p-em' : pct >= 0.5 ? 'p-gold' : 'p-bad'
  return (
    <span className={`pill ${cls} num`} style={{ fontSize: 13 }}>
      {score}/{max}
    </span>
  )
}

export default function ResultModal({ sessionId, taskId, judge, verdicts, onClose }: Props) {
  const info = TASK_INFO[taskId]
  const [chat, setChat] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    close.current?.focus()
    return () => { document.body.style.overflow = overflow; previous?.focus() }
  }, [])

  // portal: the page wrapper is animated (transform), which would trap a fixed overlay inside it
  return createPortal(
    <div className="scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={panel} className={`modal ${chat ? 'review-chat-modal' : ''}`} role="dialog" aria-modal="true" aria-labelledby="resultTitle" style={{ maxWidth: 720 }} onKeyDown={(e) => {
        if (e.key === 'Escape') { e.stopPropagation(); onClose() }
        if (e.key === 'Tab') {
          const items = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],textarea:not(:disabled),[tabindex="0"]')
          if (!items?.length) return
          const first = items[0], last = items[items.length - 1]
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
          if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
        }
      }}>
        <div className="modal-h">
          <div>
            <h2 id="resultTitle">Задание {taskId}: {info.topic}</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <ScoreBadge score={judge.final_score} max={judge.max_score} />
              <span className="muted" style={{ fontSize: 13 }}>{CONSENSUS_LABEL[judge.consensus_level] ?? judge.consensus_level}</span>
            </div>
          </div>
          <div className="result-actions">
            <button onClick={() => setChat((v) => !v)} className="iconbtn result-question" aria-label="Задать вопрос по проверке" title="Задать вопрос по проверке" aria-pressed={chat}>?</button>
            <button ref={close} onClick={onClose} className="iconbtn" aria-label="Закрыть">×</button>
          </div>
        </div>

        {chat ? <><button className="btn btn-sm btn-ghost review-back" onClick={() => setChat(false)}>← К подробному разбору</button><ReviewConversation sessionId={sessionId} taskId={taskId} mini /></> : <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Judge reasoning */}
          <section>
            <h3 style={{ marginBottom: 6 }}>Итоговый вердикт</h3>
            <p style={{ whiteSpace: 'pre-wrap' }}>{judge.reasoning}</p>
          </section>

          {/* Agent scores */}
          <section>
            <h3 style={{ marginBottom: 8 }}>Оценки экспертов</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {verdicts.map((v) => (
                <div key={v.agent_id} className="crit" style={{ flexDirection: 'column' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700 }}>Эксперт {v.agent_id}</span>
                    <ScoreBadge score={v.score} max={v.max_score} />
                    <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>
                      уверенность {Math.round(v.confidence * 100)}%
                    </span>
                  </div>
                  <p style={{ whiteSpace: 'pre-wrap', fontSize: 14 }}>{v.reasoning}</p>
                  {v.errors_found.length > 0 && (
                    <div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--red)' }}>Ошибки:</span>
                      <ul style={{ fontSize: 12.5, color: 'var(--red)', paddingLeft: 18, listStyle: 'disc' }}>
                        {v.errors_found.map((e, i) => <li key={i}>{e}</li>)}
                      </ul>
                    </div>
                  )}
                  {v.correct_steps.length > 0 && (
                    <div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--em-ink)' }}>Верно:</span>
                      <ul style={{ fontSize: 12.5, color: 'var(--em-ink)', paddingLeft: 18, listStyle: 'disc' }}>
                        {v.correct_steps.map((s, i) => <li key={i}>{s}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

        </div>}
      </div>
    </div>
  , document.body)
}
