import { useEffect, useRef, useState } from 'react'
import { addWorkPhotos, checkWorkPhotos, getWorkPhotos, saveWorkPhotos, workPhotoPreview, WorkPhoto } from '../api/client'
import { TASK_INFO } from '../types'

function Photo({ sid, page }: { sid: string; page: WorkPhoto }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let disposed = false, url = ''
    workPhotoPreview(sid, page.id).then((value) => { url = value; if (disposed) URL.revokeObjectURL(value); else setSrc(value) }).catch(() => {})
    return () => { disposed = true; if (url) URL.revokeObjectURL(url) }
  }, [sid, page.id])
  return src ? <a href={src} target="_blank" rel="noreferrer" aria-label={`Открыть фото ${page.filename}`}><img src={src} alt={page.filename} style={{ width: '100%', height: 190, objectFit: 'contain', background: 'var(--surface-2)', borderRadius: 12 }} /></a> : <p className="muted">Загружаем превью…</p>
}

export default function WorkUpload({ sessionId, onStarted, hasErrors }: { sessionId: string; onStarted: (tasks: number[]) => void; hasErrors: boolean }) {
  const [pages, setPages] = useState<WorkPhoto[]>([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    getWorkPhotos(sessionId).then((r) => setPages(r.pages)).catch((e) => setError(e.message))
  }, [sessionId])
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const add = async (files: File[]) => {
    if (!files.length || busy) return
    if (files.some((f) => !/\.(jpe?g|png|webp)$/i.test(f.name))) { setError('Для общей загрузки выберите фотографии JPG, PNG или WebP. PDF можно загрузить в режиме «По заданиям».'); return }
    if (pages.length + files.length > 30 || files.some((f) => f.size > 15 * 1024 * 1024) || files.reduce((n, f) => n + f.size, 0) > 80 * 1024 * 1024) { setError('До 30 фото, не более 15 МБ на фото и 80 МБ за одну загрузку.'); return }
    setBusy('Распределяем фотографии по заданиям…'); setError('')
    try {
      if (dirty) await saveWorkPhotos(sessionId, pages)
      setPages((await addWorkPhotos(sessionId, files)).pages); setDirty(false)
    } catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }
  const change = (next: WorkPhoto[]) => { setPages(next); setDirty(true) }
  const move = (i: number, delta: number) => { const next = [...pages]; [next[i], next[i + delta]] = [next[i + delta], next[i]]; change(next) }
  const save = async () => {
    setBusy('Сохраняем распределение…'); setError('')
    try { await saveWorkPhotos(sessionId, pages); setDirty(false) } catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }
  const start = async (retry = false) => {
    setBusy('Запускаем проверку…'); setError('')
    try {
      await saveWorkPhotos(sessionId, pages); setDirty(false)
      const r = await checkWorkPhotos(sessionId, retry)
      if (!retry) setPages((prev) => prev.map((p) => ({ ...p, submitted: true })))
      onStarted(r.task_ids)
    } catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }
  const pending = pages.filter((p) => !p.submitted)
  return <section className="card" aria-label="Фотографии всей работы">
    <h2>Загрузите всю работу сразу</h2>
    <p className="muted" style={{ margin: '8px 0 16px' }}>Выберите фотографии всех страниц одним разом. Мы предложим номера заданий — проверьте распределение перед отправкой. Продолжение решения отнесите к тому же заданию; если на листе несколько заданий, отметьте все.</p>
    <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void add(Array.from(e.dataTransfer.files)) }}>
      <button className="drop" disabled={!!busy} onClick={() => input.current?.click()} style={{ width: '100%', padding: 24, font: 'inherit', color: 'inherit', cursor: 'pointer' }}><b>{pages.length ? 'Добавить фотографии' : 'Выбрать фотографии работы'}</b><span className="muted">или перетащите их сюда · до 30 фото · JPG, PNG, WebP</span></button>
      <input ref={input} type="file" multiple accept=".jpg,.jpeg,.png,.webp" hidden onChange={(e) => { void add(Array.from(e.target.files ?? [])); e.target.value = '' }} />
    </div>
    {busy && <p role="status" style={{ marginTop: 12 }}>{busy}</p>}
    {error && <p role="alert" style={{ color: 'var(--red)', marginTop: 12 }}>{error}</p>}
    {!!pages.length && <>
      <p className="muted" style={{ margin: '16px 0' }}>Фото идут в порядке ниже. Поменяйте порядок стрелками, если продолжение оказалось раньше начала.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(240px,100%),1fr))', gap: 16 }}>
        {pages.map((p, i) => <article key={p.id} style={{ border: '1px solid var(--line)', borderRadius: 16, padding: 12, minWidth: 0 }}>
          <Photo sid={sessionId} page={p} />
          <p style={{ overflowWrap: 'anywhere', marginTop: 8 }}><b>Фото {i + 1}</b> · {p.filename}</p>
          {p.submitted ? <p className="muted">Отправлено: {p.task_ids.map((n) => `№${n}`).join(', ')}</p> : <>
            <fieldset disabled={!!busy} style={{ border: 0, padding: 0, margin: '8px 0' }}><legend className="muted">Какие задания на фото?</legend><div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>{Object.keys(TASK_INFO).map(Number).map((t) => <label key={t} style={{ display: 'flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={p.task_ids.includes(t)} onChange={() => change(pages.map((x) => x.id === p.id ? { ...x, task_ids: x.task_ids.includes(t) ? x.task_ids.filter((v) => v !== t) : [...x.task_ids, t] } : x))} />№{t}</label>)}</div></fieldset>
            {p.warning && <p className="muted" style={{ fontSize: 13 }}>{p.warning}</p>}
            {!p.task_ids.length && <p style={{ color: 'var(--red)', fontSize: 13 }}>Выберите задание или уберите фото.</p>}
          </>}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
            <button className="btn btn-sm btn-ghost" aria-label={`Фото ${i + 1} выше`} disabled={!!busy || i === 0 || p.submitted} onClick={() => move(i, -1)}>↑</button>
            <button className="btn btn-sm btn-ghost" aria-label={`Фото ${i + 1} ниже`} disabled={!!busy || i === pages.length - 1 || p.submitted} onClick={() => move(i, 1)}>↓</button>
            {!p.submitted && <button className="btn btn-sm btn-ghost" disabled={!!busy} onClick={() => change(pages.filter((x) => x.id !== p.id))}>Убрать</button>}
          </div>
        </article>)}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 18 }}>
        <button className="btn btn-em" disabled={!!busy || !pending.length || pending.some((p) => !p.task_ids.length)} onClick={() => void start()}>Проверить работу</button>
        <button className="btn btn-ghost" disabled={!!busy || !dirty} onClick={() => void save()}>Сохранить распределение</button>
        {hasErrors && <button className="btn btn-ghost" disabled={!!busy} onClick={() => void start(true)}>Повторить задания с ошибкой</button>}
      </div>
      {pending.some((p) => p.task_ids.some((t) => pages.some((old) => old.submitted && old.task_ids.includes(t)))) && <p className="muted" style={{ marginTop: 10 }}>Для дополненных заданий проверка запустится заново с учётом ранее отправленных фото.</p>}
    </>}
  </section>
}
