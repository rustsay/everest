import { FormEvent, useEffect, useState } from 'react'
import { GeneratedVideo, generateVideo, listGeneratedVideos, retryVideo } from '../api/client'
import { useApp } from '../app/store'
import type { VTask } from '../pages/videoData'
import SolutionBoard from './SolutionBoard'
import NoLlm from './NoLlm'

export default function GeneratedVideos({ detailId }: { detailId?: string }) {
  const app = useApp()
  const [items, setItems] = useState<GeneratedVideo[]>([])
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = async () => { setItems((await listGeneratedVideos()).videos) }
  useEffect(() => {
    let stopped = false
    const refresh = () => listGeneratedVideos().then((r) => { if (!stopped) { setItems(r.videos); setLoading(false) } }).catch((e) => { if (!stopped) { setError(e.message); setLoading(false) } })
    void refresh()
    const timer = window.setInterval(refresh, 4000)
    return () => { stopped = true; window.clearInterval(timer) }
  }, [])
  const pending = items.some((v) => v.status === 'pending')
  const open = (id: string) => app.go({ v: 'video', id: 'custom-' + id })
  const active = items.find((v) => v.id === detailId)
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('')
    try { const v = await generateVideo(problem.trim()); setProblem(''); await load(); open(v.id) }
    catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  if (detailId) {
    if (active?.steps?.length) {
      const task: VTask = { t: active.title, c: active.problem, s: active.steps.map((s) => [s.title, s.lines, s.text]) }
      return <SolutionBoard key={active.id} task={task} onBack={() => app.go('video')} onUnderstood={() => { app.toast('Разбор пройден'); app.go('video') }} onNotUnderstood={(step) => app.go({ v: 'chat', id: `Условие: ${active.problem}\nНе понял шаг «${step[0]}»: ${step[1].join('; ')}. Объясни по-другому и начни с вопроса.` })} />
    }
    return <>
      <button className="btn btn-sm btn-ghost" onClick={() => app.go('video')}>← Все задания</button>
      <section className="card"><h1>{active?.title || 'Разбор своей задачи'}</h1>
        {active && <p className="muted" style={{ margin: '12px 0', whiteSpace: 'pre-wrap' }}>{active.problem}</p>}
        {loading ? <p role="status">Загружаем разбор…</p> : active?.status === 'pending' ? <p role="status">{active.stage || 'Готовим пошаговое решение'}… Можно вернуться позже — разбор сохранится.</p> : <p role="alert">{error || (active ? 'Не удалось подготовить решение. Попробуйте ещё раз.' : 'Разбор не найден.')}</p>}
        {active?.status === 'error' && <button className="btn btn-em" disabled={busy || pending} onClick={async () => { setBusy(true); setError(''); try { await retryVideo(active.id); await load() } catch (e) { setError((e as Error).message) } finally { setBusy(false) } }}>Повторить</button>}
        {error && active?.status === 'error' && <p role="alert">{error}</p>}
      </section>
    </>
  }
  return <section className="card" aria-label="Разбор своей задачи">
    <h2>Разобрать свою задачу</h2>
    <p className="muted" style={{ margin: '8px 0 16px' }}>Введите условие — Звёздочка разберёт решение по шагам на доске. Можно поставить объяснение на паузу или перейти к любому шагу. Ваши разборы сохранятся здесь.</p>
    <NoLlm what="Разбор своей задачи" />
    <form onSubmit={submit}>
      <label htmlFor="videoProblem">Условие задачи</label>
      <textarea id="videoProblem" className="input" rows={4} minLength={5} maxLength={6000} required value={problem} onChange={(e) => setProblem(e.target.value)} placeholder="Например: решите уравнение 2sin²x − 3sin x + 1 = 0 и найдите корни на отрезке…" style={{ width: '100%', margin: '8px 0 12px' }} />
      <button className="btn btn-em" disabled={busy || pending || problem.trim().length < 5}>{busy ? 'Отправляем…' : pending ? 'Разбор готовится…' : 'Разобрать по шагам'}</button>
    </form>
    {error && <p role="alert" style={{ color: 'var(--red)', marginTop: 12 }}>{error}</p>}
    {items.length > 0 && <div style={{ marginTop: 20 }}>
      <h3 style={{ marginBottom: 12 }}>Мои разборы</h3>
      <div className="folders">{items.map((v) => <button key={v.id} className="folder" style={{ textAlign: 'left' }} onClick={() => open(v.id)}>
        <b>{v.title === 'Разбор задачи' ? v.problem.slice(0, 70) : v.title}</b>
        <span className="muted">{v.steps?.length ? `${v.steps.length} шагов · открыть доску` : v.status === 'pending' ? 'Готовим решение…' : 'Повторить подготовку'}</span>
      </button>)}</div>
    </div>}
  </section>
}
