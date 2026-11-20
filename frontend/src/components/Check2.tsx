import { FormEvent, useEffect, useState } from 'react'
import { check2History, checkSecondPart, getPractice } from '../api/client'
import { useApp } from '../app/store'
import type { Check2Item, Check2Result, PracticeItem } from '../types'
import { Icon, fmtD } from '../design/ui'
import ProblemText from './ProblemText'

/** OGE, second part (20-25): a photo of the full solution, 0-2 points. A bank problem is graded against the answer of the collection. */
export default function Check2() {
  const app = useApp()
  const exam = app.me.role === 'student' ? undefined : app.exam
  const [task, setTask] = useState(20)
  const [mode, setMode] = useState<'bank' | 'own'>('bank')
  const [items, setItems] = useState<PracticeItem[] | null>(null)
  const [ref, setRef] = useState('')
  const [problem, setProblem] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<Check2Result | null>(null)
  const [hist, setHist] = useState<Check2Item[]>([])
  const loadHist = () => check2History().then((r) => setHist(r.items)).catch(() => null)
  useEffect(() => { loadHist() }, [])
  useEffect(() => {
    setItems(null)
    getPractice(task, undefined, exam).then((r) => {
      const list = r.items.filter((x) => !x.analog)  // prototypes of the collection; analogs are in «Банк задач»
      setItems(list)
      setRef((v) => (list.some((x) => x.ref === v) ? v : list[0]?.ref ?? ''))
    }).catch(() => setItems([]))
  }, [task, exam])
  const cur = items?.find((x) => x.ref === ref)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!files.length) return app.toast('Прикрепи фото решения')
    if (mode === 'own' && !problem.trim()) return app.toast('Впиши условие задачи')
    if (mode === 'bank' && !ref) return app.toast('Выбери задачу из банка')
    setBusy(true); setRes(null)
    try {
      setRes(await checkSecondPart({ task, files, exam, ...(mode === 'bank' ? { ref } : { problem }) }))
      loadHist(); app.reload()
    } catch (err) { app.toast(String(err).replace('Error: ', '')) } finally { setBusy(false) }
  }
  const tone = (r: Check2Result) => (r.score === r.max ? 'p-em' : r.score > 0 ? 'p-gold' : 'p-bad')

  return (
    <section className="card c1">
      <div className="card-h"><div><h2>Задания 20-25</h2>
        <p className="muted" style={{ fontSize: 13 }}>Фото полного решения. Звёздочка поставит от 0 до 2 баллов, как эксперт ОГЭ, и скажет, чего не хватает.</p></div></div>
      <form onSubmit={submit} className="c1-form">
        <div className="mat-form">
          <div className="field" style={{ flex: '0 1 130px' }}><label htmlFor="c2Task">Задание</label>
            <select id="c2Task" className="input" value={task} onChange={(e) => { setTask(Number(e.target.value)); setRes(null) }}>
              {[20, 21, 22, 23, 24, 25].map((n) => <option key={n} value={n}>№ {n}</option>)}</select></div>
          <div style={{ flex: '1 1 260px' }}><span className="flabel">Какая задача</span>
            <div className="seg" role="group" aria-label="Какая задача">
              <button type="button" aria-pressed={mode === 'bank'} onClick={() => setMode('bank')}>Из банка</button>
              <button type="button" aria-pressed={mode === 'own'} onClick={() => setMode('own')}>Своя</button></div></div>
        </div>
        {mode === 'bank' ? (
          <div className="field"><label htmlFor="c2Ref">Задача</label>
            <select id="c2Ref" className="input" value={ref} onChange={(e) => { setRef(e.target.value); setRes(null) }} disabled={!items?.length}>
              {items?.map((x, i) => <option key={x.ref} value={x.ref}>{i + 1}. {x.proto_name ? `${x.proto_name}: ` : ''}{x.q.slice(0, 80)}</option>)}</select>
            {cur && <div className="c1-q"><ProblemText q={cur.q} img={cur.img} /></div>}
          </div>
        ) : (
          <div className="field"><label htmlFor="c2Prob">Условие задачи</label>
            <textarea id="c2Prob" className="input" rows={3} maxLength={3000} value={problem} onChange={(e) => setProblem(e.target.value)} placeholder="Перепиши условие или сфотографируй его вместе с решением" />
            <small className="muted">У своей задачи нет ответа из сборника: Звёздочка оценит решение сама и может ошибиться.</small></div>
        )}
        <div className="field"><label htmlFor="c2Files">Фото решения (до 5)</label>
          <input id="c2Files" className="input" type="file" accept="image/*,.pdf,.heic" multiple style={{ paddingTop: 10 }}
            onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 5))} /></div>
        <button className="btn btn-gold" type="submit" disabled={busy}><Icon n="check" s={18} c="#16231F" />{busy ? 'Проверяю…' : 'Проверить'}</button>
      </form>
      {res && (
        <div className={`c1-res ${tone(res)}`}>
          <p><span className={`pill ${tone(res)} num`}>{res.score} из {res.max}</span></p>
          {res.comment && <p style={{ marginTop: 6 }}>{res.comment}</p>}
          {res.ans_img ? <details style={{ marginTop: 8 }}><summary>Ответ из сборника</summary><img src={res.ans_img} alt="Ответ из сборника" style={{ maxWidth: '100%', marginTop: 6 }} /></details>
            : res.answer_text ? <p className="muted" style={{ marginTop: 6 }}>Ответ из сборника: {res.answer_text}</p> : null}
          {!res.keyed && <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>Проверка без ответа из сборника: Звёздочка могла ошибиться.</p>}
          <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>Балл учтён в прогнозе и расписании.</p>
        </div>
      )}
      {hist.length > 0 && (
        <details className="c1-hist"><summary>Прошлые проверки ({hist.length})</summary>
          {hist.map((h, i) => (
            <div key={i} className="stu-row">
              <span className={`pill ${tone(h)} num`}>№ {h.task} · {h.score}/{h.max}</span>
              <span style={{ flex: 1, minWidth: 0 }}>{h.comment || 'без комментария'}{h.keyed ? '' : ' · без ответа из сборника'}
                <small className="muted" style={{ display: 'block' }}>{fmtD(h.at.slice(0, 10))} · {h.problem.slice(0, 90)}</small></span>
            </div>
          ))}
        </details>
      )}
    </section>
  )
}
