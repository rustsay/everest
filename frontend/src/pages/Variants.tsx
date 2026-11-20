import ProblemText from '../components/ProblemText'
import { FormEvent, useCallback, useEffect, useState } from 'react'
import { createVariant, deleteVariant, editVariant, getVariant, listVariants, submitVariant, teacherOverview, variantCandidates } from '../api/client'
import { useApp } from '../app/store'
import type { PracticeItem, VariantFull, VariantSummary } from '../types'
import { Icon, fmtD } from '../design/ui'

const ALL = Array.from({ length: 19 }, (_, i) => i + 1)

/** Teacher / tutor: compose variants from the task bank and give them to a class. */
export default function Variants() {
  const app = useApp()
  const [list, setList] = useState<VariantSummary[] | null>(null)
  const [classes, setClasses] = useState<{ id: number; name: string }[]>([])
  const [mode, setMode] = useState<'auto' | 'hand'>('auto')
  const [title, setTitle] = useState('')
  const [tasks, setTasks] = useState<number[]>(ALL.slice(0, 12))
  const [pickTask, setPickTask] = useState(1)
  const [cands, setCands] = useState<PracticeItem[]>([])
  const [picked, setPicked] = useState<PracticeItem[]>([])
  const [cls, setCls] = useState<string>('')
  const [due, setDue] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => listVariants().then((r) => setList(r.variants)).catch(() => setList([])), [])
  useEffect(() => { load(); teacherOverview().then((o) => setClasses(o.classes)).catch(() => null) }, [load])
  useEffect(() => { if (mode === 'hand') variantCandidates(pickTask).then((r) => setCands(r.items)).catch(() => setCands([])) }, [mode, pickTask])

  const create = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const r = await createVariant({
        title: title.trim() || `Вариант от ${fmtD(new Date())}`,
        ...(mode === 'auto' ? { auto_tasks: tasks } : { items: picked.map((p) => p.ref) }),
        class_id: cls ? Number(cls) : null, due: cls && due ? due : null,
      })
      app.toast(r.missing.length ? `Вариант собран: ${r.items} задач. Нет задач в банке для № ${r.missing.join(', ')}` : `Вариант собран: ${r.items} задач`)
      setTitle(''); setPicked([])
      app.go({ v: 'variant', id: String(r.id) })
    } catch (err) { app.toast(String(err).replace('Error: ', '')) } finally { setBusy(false) }
  }

  return (
    <>
      <div><p className="muted">Из задач банка</p><h1>Варианты</h1></div>
      <form className="card" onSubmit={create}>
        <div className="card-h"><h2>Новый вариант</h2>
          <div className="seg" role="group" aria-label="Как собрать">
            <button type="button" aria-pressed={mode === 'auto'} onClick={() => setMode('auto')}>Автоматически</button>
            <button type="button" aria-pressed={mode === 'hand'} onClick={() => setMode('hand')}>Выбрать задачи</button>
          </div>
        </div>
        <div className="field"><label htmlFor="vTitle">Название</label>
          <input id="vTitle" className="input" value={title} maxLength={200} placeholder="Например, Пробник 1, 11А" onChange={(e) => setTitle(e.target.value)} /></div>

        {mode === 'auto' ? (
          <div className="field" style={{ marginTop: 12 }}><label>По одной случайной опубликованной задаче на каждое задание</label>
            <div className="tm-tabs">
              {ALL.map((k) => <button type="button" key={k} className={`${tasks.includes(k) ? 'on' : ''} ${k >= 13 ? 'p2' : ''}`}
                onClick={() => setTasks(tasks.includes(k) ? tasks.filter((x) => x !== k) : [...tasks, k].sort((a, b) => a - b))}>{k}</button>)}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setTasks(ALL.slice(0, 12))}>Часть 1</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setTasks(ALL)}>Весь вариант</button>
            </div>
          </div>
        ) : (
          <div className="grid2" style={{ marginTop: 12, alignItems: 'start' }}>
            <div>
              <div className="tm-tabs">{ALL.map((k) => <button type="button" key={k} className={`${k === pickTask ? 'on' : ''} ${k >= 13 ? 'p2' : ''}`} onClick={() => setPickTask(k)}>{k}</button>)}</div>
              <div className="var-cands">
                {cands.length === 0 && <p className="muted" style={{ fontSize: 13 }}>Опубликованных задач по № {pickTask} пока нет.</p>}
                {cands.map((c) => {
                  const on = picked.some((p) => p.ref === c.ref)
                  return (
                    <div key={c.ref} className={`var-cand ${on ? 'on' : ''}`}>
                      <div style={{ fontSize: 13.5 }}><ProblemText q={c.q} img={c.img} small /></div>
                      <p className="muted" style={{ fontSize: 12 }}>{c.proto_name}{c.answer ? ` · ответ ${c.answer}` : ' · по фото'}{c.src ? ` · ${c.src}` : ''}</p>
                      <button type="button" className={`btn btn-sm ${on ? 'btn-ghost' : 'btn-line'}`} onClick={() => setPicked(on ? picked.filter((p) => p.ref !== c.ref) : [...picked, c].sort((a, b) => a.task - b.task))}>{on ? 'Убрать' : 'Добавить'}</button>
                    </div>
                  )
                })}
              </div>
            </div>
            <div>
              <b>В варианте: {picked.length}</b>
              <ol className="tm-know">{picked.map((p) => <li key={p.ref}>№ {p.task}. {p.q.slice(0, 90)}{p.q.length > 90 ? '…' : ''}</li>)}</ol>
            </div>
          </div>
        )}

        <div className="bank-import" style={{ marginTop: 14 }}>
          <div className="field"><label htmlFor="vCls">Выдать классу</label>
            <select id="vCls" className="input" value={cls} onChange={(e) => setCls(e.target.value)}>
              <option value="">пока никому</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></div>
          {cls && <div className="field" style={{ flex: '0 1 200px' }}><label htmlFor="vDue">Сдать до</label><input id="vDue" type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} /></div>}
          <button className="btn btn-em" type="submit" disabled={busy || (mode === 'auto' ? !tasks.length : !picked.length)}><Icon n="ok" s={18} />{busy ? 'Собираю…' : 'Собрать вариант'}</button>
        </div>
      </form>

      <section>
        <h2 style={{ marginBottom: 10 }}>Мои варианты</h2>
        {list === null && <p className="muted">Загружаю…</p>}
        {list?.length === 0 && <p className="muted">Вариантов пока нет.</p>}
        <div className="tm-links">
          {list?.map((v) => (
            <div key={v.id} className="item">
              <Icon n="pen" s={18} />
              <button className="t-strong" style={{ flex: 1, textAlign: 'left', background: 'none', border: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', padding: 0 }} onClick={() => app.go({ v: 'variant', id: String(v.id) })}>
                {v.title}<small className="muted" style={{ display: 'block', fontWeight: 600 }}>{v.count} задач{v.class_name ? ` · выдан ${v.class_name}` : ' · не выдан'}{v.due ? ` · до ${fmtD(v.due)}` : ''}</small>
              </button>
              <button className="iconbtn" aria-label={'Удалить ' + v.title} onClick={async () => { await deleteVariant(v.id).catch(() => null); load() }}><Icon n="trash" s={18} /></button>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}

/** One variant: the teacher sees the key, results and can print it; the student solves and submits it. */
export function VariantPage({ id }: { id: number }) {
  const app = useApp()
  const [v, setV] = useState<VariantFull | null>(null)
  const [err, setErr] = useState('')
  const [ans, setAns] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [classes, setClasses] = useState<{ id: number; name: string }[]>([])
  const load = useCallback(() => getVariant(id).then(setV).catch((e) => setErr(String(e).replace('Error: ', ''))), [id])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (v?.owner) teacherOverview().then((o) => setClasses(o.classes)).catch(() => null) }, [v?.owner])
  if (err) return <p className="muted">{err}</p>
  if (!v) return <p className="muted">Загружаю вариант…</p>

  const left = v.items.filter((i) => i.check === 'answer' && !(ans[i.ref] ?? '').trim()).length
  const submit = async () => {
    setBusy(true)
    try { const r = await submitVariant(v.id, ans); app.toast(`Результат: ${r.score} из ${r.max}`); if (r.score === r.max && r.max) app.confetti(); load() }
    catch (e) { app.toast(String(e).replace('Error: ', '')) } finally { setBusy(false) }
  }
  return (
    <>
      <div className="card-h" style={{ margin: 0 }}>
        <div>
          <button className="btn btn-sm btn-ghost no-print" style={{ marginBottom: 8 }} onClick={() => app.go(v.owner ? 'variants' : 'practice')}><Icon n="prev" s={16} />{v.owner ? 'Варианты' : 'Банк задач'}</button>
          <p className="muted">Вариант · {v.items.length} задач{v.due ? ` · сдать до ${fmtD(v.due)}` : ''}</p>
          <h1>{v.title}</h1>
        </div>
        {v.owner && <button className="btn btn-line no-print" onClick={() => window.print()}><Icon n="copy" s={18} />Печать с ответами</button>}
      </div>

      {v.owner && (
        <section className="card no-print">
          <div className="bank-import" style={{ marginBottom: 0 }}>
            <div className="field"><label htmlFor="vpCls">Выдать классу</label>
              <select id="vpCls" className="input" value={classes.length ? String(v.class_id ?? '') : ''} disabled={!classes.length && v.class_id != null} onChange={async (e) => {
                const c = e.target.value
                await editVariant(v.id, c ? { class_id: Number(c), due: v.due } : { unassign: true }).catch(() => null); load()
              }}>
                <option value="">не выдан</option>
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
            {v.class_id && <div className="field" style={{ flex: '0 1 200px' }}><label htmlFor="vpDue">Сдать до</label>
              <input id="vpDue" type="date" className="input" defaultValue={v.due ?? ''} onChange={async (e) => { await editVariant(v.id, { class_id: v.class_id, due: e.target.value || null }).catch(() => null); load() }} /></div>}
          </div>
          {v.results && <div style={{ marginTop: 14 }}>
            <b>Результаты · сдали {v.results.length}</b>
            {v.results.length ? <table className="var-res"><tbody>{v.results.map((r, i) => <tr key={i}><td>{r.name}</td><td className="num"><b>{r.score}</b> из {r.max}</td></tr>)}</tbody></table>
              : <p className="muted" style={{ fontSize: 13.5, marginTop: 4 }}>Пока никто не сдал.</p>}
          </div>}
        </section>
      )}

      {v.attempt && <section className="card" style={{ borderColor: 'var(--em-3)' }}><b>Сдано: {v.attempt.score} из {v.attempt.max}</b>
        <p className="muted" style={{ fontSize: 13.5, marginTop: 4 }}>Ниже правильные ответы и решения. Задания второй части без короткого ответа решай на листе и отправляй на проверку по фото.</p></section>}

      <ol className="var-list">
        {v.items.map((it) => {
          const res = v.attempt?.results[it.ref]
          return (
            <li key={it.ref} className={`tm-prob ${res === 1 ? 'ok' : res === 0 ? 'no' : ''}`}>
              <p className="muted" style={{ fontSize: 12 }}>Задание № {it.task}{it.proto_name ? ` · ${it.proto_name}` : ''}</p>
              <div style={{ marginTop: 4 }}><ProblemText q={it.q} img={it.img} /></div>
              {v.owner || v.attempt ? (
                <div className="tm-res">
                  <p>{it.answer ? <><b>Ответ: {it.answer}.</b>{!v.owner && v.attempt && it.check === 'answer' ? ` Твой ответ: ${v.attempt.answers[it.ref] || '-'}.` : ''}</> : <b>Решение проверяется по фото.</b>}</p>
                  {it.sol && <p className="muted" style={{ marginTop: 4 }}>{it.sol}</p>}
                </div>
              ) : it.check === 'answer' ? (
                <input className="input" style={{ marginTop: 10, maxWidth: 260 }} inputMode="decimal" placeholder="Ответ" value={ans[it.ref] ?? ''} onChange={(e) => setAns({ ...ans, [it.ref]: e.target.value })} aria-label={`Ответ к заданию ${it.task}`} />
              ) : (
                <button className="btn btn-sm btn-line" style={{ marginTop: 10 }} onClick={() => app.go('check')}><Icon n="check" s={16} />Решить и проверить по фото</button>
              )}
            </li>
          )
        })}
      </ol>
      {!v.owner && !v.attempt && <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-em" onClick={submit} disabled={busy}><Icon n="ok" s={18} />{busy ? 'Проверяю…' : 'Сдать вариант'}</button>
        {left > 0 && <span className="muted" style={{ fontSize: 13.5 }}>Без ответа: {left}. Пустой ответ засчитается как неверный, сдать можно один раз.</span>}
      </div>}
    </>
  )
}
