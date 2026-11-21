import { FormEvent, useEffect, useState } from 'react'
import { check1History, checkFirstPart, getPractice } from '../api/client'
import { useApp } from '../app/store'
import type { Check1Item, Check1Result, PracticeItem } from '../types'
import { Icon, fmtD } from '../design/ui'
import ProblemText from './ProblemText'
import useImagePaste from '../hooks/useImagePaste'

const VERDICT: Record<string, [string, string]> = {
  ok: ['Верно', 'p-em'], ok_doubt: ['Ответ верный, но решение стоит проверить', 'p-gold'],
  slip: ['Способ верный, ошибка в счёте', 'p-gold'], method: ['Неверно: нужен другой способ', 'p-bad'],
}

/** Photo check of the tasks with a short answer (profile 1-12, OGE 1-19, base 1-21): a bank problem (the key decides)
    or an own problem (the model solves it, no key). */
export default function Check1({ preset, presetTask, from = 1, to = 12, title }: { preset?: string; presetTask?: number; from?: number; to?: number; title?: string }) {
  const app = useApp()
  const exam = app.me.role === 'student' ? undefined : app.exam
  const [task, setTask] = useState(presetTask && presetTask >= from && presetTask <= to ? presetTask : from)
  const [mode, setMode] = useState<'bank' | 'own'>('bank')
  const [items, setItems] = useState<PracticeItem[] | null>(null)
  const [ref, setRef] = useState(preset ?? '')
  const [problem, setProblem] = useState('')
  const [answer, setAnswer] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<Check1Result | null>(null)
  const [hist, setHist] = useState<Check1Item[]>([])
  useImagePaste((images) => setFiles((previous) => [...previous, ...images].slice(0, 5)), busy)
  const loadHist = () => check1History(exam).then((r) => setHist(r.items)).catch(() => null)
  useEffect(() => { loadHist() }, [exam]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setItems(null)
    getPractice(task, undefined, exam).then((r) => {
      const list = r.items.filter((x) => x.check === 'answer')
      setItems(list)
      if (preset && list.some((x) => x.ref === preset)) setRef(preset)
      else setRef((v) => (list.some((x) => x.ref === v) ? v : list[0]?.ref ?? ''))
    }).catch(() => setItems([]))
  }, [task, exam]) // eslint-disable-line react-hooks/exhaustive-deps
  const cur = items?.find((x) => x.ref === ref)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!files.length) return app.toast('Прикрепи фото решения')
    if (mode === 'own' && !problem.trim()) return app.toast('Впиши условие задачи')
    if (mode === 'bank' && !ref) return app.toast('Выбери задачу из банка')
    setBusy(true); setRes(null)
    try {
      const r = await checkFirstPart({ task, answer, files, exam, ...(mode === 'bank' ? { ref } : { problem }) })
      setRes(r); loadHist(); app.reload()
    } catch (err) { app.toast(String(err).replace('Error: ', '')) } finally { setBusy(false) }
  }

  return (
    <section className="card c1">
      <div className="card-h"><div><h2>{title ?? `Задания ${from}-${to}`}</h2>
        <p className="muted" style={{ fontSize: 13 }}>Ответ и фото решения. Звёздочка скажет, верно ли, и найдёт ошибку: в счёте или в способе.</p></div></div>
      <form onSubmit={submit} className="c1-form">
        <div className="mat-form">
          <div className="field" style={{ flex: '0 1 130px' }}><label htmlFor="c1Task">Задание</label>
            <select id="c1Task" className="input" value={task} onChange={(e) => { setTask(Number(e.target.value)); setRes(null) }}>
              {Array.from({ length: to - from + 1 }, (_, i) => <option key={from + i} value={from + i}>№ {from + i}</option>)}</select></div>
          <div style={{ flex: '1 1 260px' }}><span className="flabel">Какая задача</span>
            <div className="seg" role="group" aria-label="Какая задача">
              <button type="button" aria-pressed={mode === 'bank'} onClick={() => setMode('bank')}>Из банка</button>
              <button type="button" aria-pressed={mode === 'own'} onClick={() => setMode('own')}>Своя</button></div></div>
        </div>
        {mode === 'bank' ? (
          <div className="field"><label htmlFor="c1Ref">Задача</label>
            <select id="c1Ref" className="input" value={ref} onChange={(e) => { setRef(e.target.value); setRes(null) }} disabled={!items?.length}>
              {items?.map((x, i) => <option key={x.ref} value={x.ref}>{i + 1}. {x.proto_name ? `${x.proto_name}: ` : ''}{x.q.slice(0, 80)}</option>)}</select>
            {cur && <div className="c1-q"><ProblemText q={cur.q} img={cur.img} ctx={cur.ctx_img} /></div>}
          </div>
        ) : (
          <div className="field"><label htmlFor="c1Prob">Условие задачи</label>
            <textarea id="c1Prob" className="input" rows={3} maxLength={3000} value={problem} onChange={(e) => setProblem(e.target.value)} placeholder="Перепиши условие или сфотографируй его вместе с решением" />
            <small className="muted">У своей задачи нет ключа ответа: Звёздочка решит её сама, и проверка может ошибаться.</small></div>
        )}
        <div className="mat-form">
          <div className="field" style={{ flex: '0 1 200px' }}><label htmlFor="c1Ans">Твой ответ</label>
            <input id="c1Ans" className="input" inputMode="text" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="например, 0,5" /></div>
          <div className="field" style={{ flex: '1 1 260px' }}><label htmlFor="c1Files">Фото решения (до 5)</label>
            <input id="c1Files" className="input" type="file" accept="image/*,.pdf,.heic" multiple style={{ paddingTop: 10 }}
              onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 5))} /></div>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>Фото можно вставить из буфера: Ctrl+V или ⌘V.{files.length > 0 && ` Прикреплено: ${files.map((file) => file.name).join(', ')}.`}</p>
        <button className="btn btn-gold" type="submit" disabled={busy}><Icon n="check" s={18} c="#16231F" />{busy ? 'Проверяю…' : 'Проверить'}</button>
      </form>
      {res && <Verdict r={res} />}
      {hist.length > 0 && (
        <details className="c1-hist"><summary>Прошлые проверки ({hist.length})</summary>
          {hist.map((h, i) => (
            <div key={i} className="stu-row">
              <span className={`pill ${VERDICT[h.kind]?.[1] ?? 'p-gold'} num`}>№ {h.task}</span>
              <span style={{ flex: 1, minWidth: 0 }}><b>{VERDICT[h.kind]?.[0]}</b>{h.answer ? ` · ответ ${h.answer}` : ''}{h.right ? ` · верный ${h.right}` : ''}{h.keyed ? '' : ' · без ключа'}
                <small className="muted" style={{ display: 'block' }}>{fmtD(h.at.slice(0, 10))} · {h.problem.slice(0, 90)}</small></span>
            </div>
          ))}
        </details>
      )}
    </section>
  )
}

function Verdict({ r }: { r: Check1Result }) {
  const [t, cls] = VERDICT[r.kind] ?? VERDICT.method
  return (
    <div className={`c1-res ${cls}`}>
      <p><span className={`pill ${cls}`}>{t}</span>{r.right && !r.ok && <> Верный ответ: <b>{r.right}</b></>}</p>
      {r.comment && <p style={{ marginTop: 6 }}>{r.comment}</p>}
      {r.sol && <p className="muted" style={{ marginTop: 6, fontSize: 14 }}>Решение из банка: {r.sol}</p>}
      {!r.keyed && <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>Проверка без ключа ответа: Звёздочка решила задачу сама и может ошибиться.</p>}
      {r.first && <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>Первая попытка этой задачи засчитана на карте задания.</p>}
    </div>
  )
}
