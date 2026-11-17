import { FormEvent, useEffect, useRef, useState } from 'react'
import { clearChat, getChat, postChat, listReviewChats, ReviewChatSummary } from '../api/client'
import { useApp } from '../app/store'
import type { ChatMsg } from '../types'
import { Icon, Md } from '../design/ui'
import NoLlm from '../components/NoLlm'
import ReviewConversation from '../components/ReviewConversation'

const CHIPS_S = ['Не понимаю, как отбирать корни на отрезке', 'Дай подсказку к задаче дня', 'Почему у меня проседает первопричина?', 'Объясни единичную окружность простыми словами']
const CHIPS_T = ['План урока на 45 минут по отбору корней', 'Кому из класса нужна помощь в первую очередь?', 'Объясните критерии задания 13', 'Подберите 5 задач на единичную окружность']

function toB64(f: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result).split(',')[1] ?? '')
    r.onerror = rej
    r.readAsDataURL(f)
  })
}

export default function Chat({ teacher }: { teacher: boolean }) {
  const app = useApp()
  const [chats, setChats] = useState<ReviewChatSummary[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const reviewId = app.view.id?.startsWith('review:') ? app.view.id.slice(7) : undefined
  const refresh = () => listReviewChats().then((r) => { setChats(r.chats); setError('') }).catch((e: Error) => setError(e.message)).finally(() => setLoading(false))
  useEffect(() => { void refresh() }, [app.view.id])
  return <div className="assistant-layout">
    <aside className="assistant-dialogs" aria-label="Диалоги помощника">
      <button className={`assistant-thread ${!reviewId ? 'active' : ''}`} aria-current={!reviewId ? 'page' : undefined} onClick={() => app.go(teacher ? 'tchat' : 'chat')}><b>Общий диалог</b><small>Вопросы по математике</small></button>
      <h2>По проверкам</h2>
      {loading && <p className="muted" role="status">Загружаем диалоги…</p>}
      {!loading && !chats.length && !error && <p className="muted">Нажми «?» в подробном разборе задания — здесь появится диалог по этой проверке.</p>}
      {error && <div role="alert"><p>{error}</p><button className="btn btn-sm btn-ghost" onClick={() => void refresh()}>Повторить загрузку</button></div>}
      {chats.map((c) => <button key={c.id} className={`assistant-thread ${reviewId === c.id ? 'active' : ''}`} aria-current={reviewId === c.id ? 'page' : undefined} onClick={() => app.go({ v: teacher ? 'tchat' : 'chat', id: `review:${c.id}` })}>
        <b>{c.title}</b><small>{new Date(c.created_at + 'Z').toLocaleString('ru-RU')}</small><span>{c.last_message || 'Задай первый вопрос по проверке'}</span>
      </button>)}
    </aside>
    <div className="assistant-content">
      {reviewId ? <><h1>Помощник по проверке</h1><ReviewConversation key={reviewId} chatId={reviewId} onUpdated={() => void refresh()} /></> : <GeneralChat teacher={teacher} />}
    </div>
  </div>
}

function GeneralChat({ teacher }: { teacher: boolean }) {
  const app = useApp()
  const kind = teacher ? 'teacher' : 'student'
  const [list, setList] = useState<ChatMsg[]>([])
  const [busy, setBusy] = useState(false)
  const [img, setImg] = useState<File | null>(null)
  const [text, setText] = useState('')
  const sent = useRef(false)
  const end = useRef<HTMLDivElement | null>(null)

  const send = async (t: string) => {
    t = t.trim()
    if (!t || busy) return
    const image = img
    setList((l) => [...l, { role: 'user', content: t + (image ? ' [приложено фото решения]' : '') }])
    setText(''); setImg(null); setBusy(true)
    try {
      const r = await postChat(kind, t, image ? await toB64(image) : undefined)
      setList((l) => [...l, { role: 'assistant', content: r.reply }])
      app.reload()
    } catch (e) { app.toast(String(e).replace('Error: ', '')) } finally { setBusy(false) }
  }

  useEffect(() => {
    getChat(kind).then((r) => {
      setList(r.messages)
      if (app.view.id && !sent.current) { sent.current = true; send(app.view.id) }
    }).catch(() => null)
  }, [kind]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [list, busy])

  const submit = (e: FormEvent) => { e.preventDefault(); send(text) }
  const chips = teacher ? CHIPS_T : CHIPS_S
  return (
    <>
      <div className="card-h" style={{ margin: 0 }}>
        <div><p className="muted">{teacher ? 'Для учителя' : 'Задай вопрос по математике'}</p><h1>{teacher ? 'Помощник учителя' : 'Помощник'}</h1></div>
        {list.length > 0 && <button className="btn btn-sm btn-ghost" onClick={async () => { await clearChat(kind); setList([]) }}>Новый диалог</button>}
      </div>
      <NoLlm what="Помощник" />
      <section className="chat">
        <div className="msgs">
          <div className="msg ai">{teacher ? 'Здравствуйте! Я вижу результаты ваших учеников. Могу предложить план урока, подобрать задачи или объяснить критерии.' : 'Привет! Я не решаю за тебя, но помогу дойти до ответа самому. Можно прислать фото решения.'}</div>
          {list.map((m, i) => <div key={i} className={`msg ${m.role === 'user' ? 'me' : 'ai'}`}><Md text={m.content} /></div>)}
          {busy && <div className="msg ai"><span className="typing"><i /><i /><i /></span></div>}
          <div ref={end} />
        </div>
        {list.length < 2 && <div className="qchips">{chips.map((c) => <button key={c} onClick={() => send(c)}>{c}</button>)}</div>}
        {img && <div className="crit" style={{ alignItems: 'center' }}><span className="pill p-gold">фото: {img.name}</span><button className="btn btn-sm btn-ghost" onClick={() => setImg(null)}>Убрать</button></div>}
        <form className="composer" onSubmit={submit}>
          {!teacher && <label className="iconbtn" role="button" tabIndex={0} aria-label="Прикрепить фото"><Icon n="img" /><input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setImg(f) }} /></label>}
          <label htmlFor="chatIn" className="sr">Сообщение</label>
          <textarea id="chatIn" rows={1} value={text} placeholder={teacher ? 'Спросите про класс или урок' : 'Напиши вопрос'} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text) } }} />
          <button type="submit" className="iconbtn" aria-label="Отправить" disabled={busy} style={{ background: 'var(--em)', borderColor: 'var(--em)', color: 'var(--on-em)' }}><Icon n="send" s={18} /></button>
        </form>
      </section>
    </>
  )
}
