import { FormEvent, useEffect, useRef, useState } from 'react'
import { askReviewChat, getReviewChat, openReviewChat, ReviewChatDetail } from '../api/client'
import { useApp } from '../app/store'
import { Icon, Md } from '../design/ui'
import NoLlm from './NoLlm'

interface Props { chatId?: string; sessionId?: string; taskId?: number; onUpdated?: () => void; mini?: boolean }

export default function ReviewConversation({ chatId, sessionId, taskId, onUpdated, mini }: Props) {
  const app = useApp()
  const [chat, setChat] = useState<ReviewChatDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [text, setText] = useState('')
  const [pending, setPending] = useState('')
  const [attempt, setAttempt] = useState(0)
  const messages = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const sending = useRef(false)

  useEffect(() => {
    let active = true
    setLoading(true); setError(''); setChat(null)
    const request = chatId ? getReviewChat(chatId) : openReviewChat(sessionId!, taskId!)
    request.then((value) => { if (active) setChat(value) })
      .catch((e: Error) => { if (active) setError(e.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [chatId, sessionId, taskId, attempt])

  useEffect(() => {
    const el = messages.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat, pending])
  useEffect(() => { if (!loading && chat) input.current?.focus() }, [loading, chat?.id])

  const send = async (question: string) => {
    question = question.trim()
    if (!chat || sending.current || !question || question.length > 2000) return
    sending.current = true
    setBusy(true); setError(''); setPending(question); setText('')
    try {
      setChat(await askReviewChat(chat.id, question))
      onUpdated?.()
    } catch (e) { setError((e as Error).message); setText(question) }
    finally { setBusy(false); setPending(''); sending.current = false; input.current?.focus() }
  }
  const submit = (e: FormEvent) => { e.preventDefault(); void send(text) }

  if (loading) return <p role="status">Открываем диалог по проверке…</p>
  if (!chat) return <div><p role="alert">{error}</p><button className="btn btn-ghost" onClick={() => setAttempt((v) => v + 1)}>Попробовать ещё раз</button></div>
  return <section className="review-conversation" aria-label={`Диалог: ${chat.title}`}>
    <div className="review-context">
      <div><b>{chat.title}</b><p className="muted">Проверка от {new Date(chat.checked_at).toLocaleString('ru-RU')} · {chat.score}/{chat.max_score} баллов</p></div>
      {mini ? <button className="btn btn-sm btn-ghost" onClick={() => app.go({ v: app.me.role === 'student' ? 'chat' : 'tchat', id: `review:${chat.id}` })}>В помощник <Icon n="next" s={16} /></button>
        : <button className="btn btn-sm btn-ghost" onClick={() => app.go({ v: 'session', id: chat.session_id })}>Открыть проверку</button>}
    </div>
    <NoLlm what="Помощник" />
    <div className="msgs review-messages" ref={messages} role="log" aria-live="polite" aria-relevant="additions">
      <div className="msg ai">Я вижу распознанное решение, итоговый вердикт и замечания экспертов. Спрашивай о шагах решения или о том, почему выставлен такой балл.</div>
      {chat.messages.map((m, i) => <div key={i} className={`msg ${m.role === 'user' ? 'me' : 'ai'}`}><Md text={m.content} /></div>)}
      {pending && <><div className="msg me"><Md text={pending} /></div><div className="msg ai" role="status">Думаю над вопросом…</div></>}
    </div>
    {!chat.messages.length && !busy && <div className="qchips">{['Объясни итоговый вердикт', 'Разбери ключевой шаг решения', 'Что можно улучшить в оформлении?'].map((q) => <button key={q} disabled={!app.me.llm_ready} onClick={() => void send(q)}>{q}</button>)}</div>}
    {error && <p className="review-error" role="alert">{error}</p>}
    <form className="composer review-composer" onSubmit={submit}>
      <label className="sr" htmlFor="reviewQuestion">Вопрос по проверенному заданию</label>
      <textarea ref={input} id="reviewQuestion" rows={2} maxLength={2000} value={text} disabled={busy || !app.me.llm_ready} placeholder="Задай вопрос по решению или оценке" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(text) }
      }} />
      <button className="iconbtn" type="submit" aria-label="Отправить вопрос" disabled={busy || !text.trim() || !app.me.llm_ready}><Icon n="send" s={18} /></button>
    </form>
  </section>
}
