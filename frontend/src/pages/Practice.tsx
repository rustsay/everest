import { useCallback, useEffect, useState } from 'react'
import { getPractice, listVariants } from '../api/client'
import { useApp } from '../app/store'
import type { BankTask, PracticeItem, VariantSummary } from '../types'
import { Icon, fmtD } from '../design/ui'
import { Problem } from './TaskMap'
import Redo from '../components/Redo'

/** The task bank for students: published problems by task and prototype, plus variants from the teacher. */
export default function Practice() {
  const app = useApp()
  const [task, setTask] = useState<number>(Number(app.view.id) || 1)
  const [proto, setProto] = useState('')
  const [data, setData] = useState<{ items: PracticeItem[]; counts: Record<string, number>; tasks: BankTask[] } | null>(null)
  const [vars, setVars] = useState<VariantSummary[]>([])
  const load = useCallback(() => getPractice(task, proto || undefined).then(setData).catch(() => null), [task, proto])
  useEffect(() => { load() }, [load])
  useEffect(() => { listVariants().then((r) => setVars(r.variants)).catch(() => null) }, [])

  const t = data?.tasks.find((x) => x.n === task)
  const solved = data?.items.filter((i) => i.done != null).length ?? 0
  return (
    <>
      <div className="card-h" style={{ margin: 0 }}>
        <div><p className="muted">Задачи открытого банка и подборки учителей</p><h1>Банк задач</h1></div>
        <button className="btn btn-line" onClick={() => app.go({ v: 'task', id: String(task) })}><Icon n="map" s={18} />Карта задания № {task}</button>
      </div>

      {app.me.role === 'student' && <Redo />}

      {vars.length > 0 && (
        <section className="card">
          <div className="card-h"><h2>Варианты от учителя</h2></div>
          <div className="tm-links">
            {vars.map((v) => (
              <button key={v.id} className="item" onClick={() => app.go({ v: 'variant', id: String(v.id) })}>
                <Icon n="pen" s={18} />
                <span className="t-strong" style={{ flex: 1 }}>{v.title}<small className="muted" style={{ display: 'block', fontWeight: 600 }}>{v.count} задач{v.due ? ` · сдать до ${fmtD(v.due)}` : ''}{v.class_name ? ` · ${v.class_name}` : ''}</small></span>
                {v.attempt ? <span className="pill p-em num">{v.attempt.score} из {v.attempt.max}</span> : <span className="pill p-gold">не решён</span>}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <div className="tm-tabs" aria-label="Задания">
          {Array.from({ length: 19 }, (_, i) => i + 1).map((k) => (
            <button key={k} className={`${k === task ? 'on' : ''} ${k >= 13 ? 'p2' : ''}`} onClick={() => { setTask(k); setProto('') }}
              title={data?.tasks.find((x) => x.n === k)?.name}>{k}<sup className="tm-cnt">{data?.counts[String(k)] ?? 0}</sup></button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
          <b style={{ flex: '1 1 200px' }}>№ {task} · {t?.name ?? ''}</b>
          <select className="input" style={{ maxWidth: 360 }} value={proto} onChange={(e) => setProto(e.target.value)} aria-label="Прототип">
            <option value="">Все прототипы</option>
            {t?.protos.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        {data && <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>{data.items.length ? `Задач: ${data.items.length}, решено: ${solved}. В процент карты задания идёт первая попытка.` : 'По этому заданию задач пока нет: их добавляет учитель через банк задач.'}</p>}
      </section>

      <div style={{ display: 'grid', gap: 10 }}>
        {data?.items.map((it, i) => (
          <div key={it.ref}>
            {(i === 0 || data.items[i - 1].proto !== it.proto) && <p className="label" style={{ margin: i ? '12px 0 6px 4px' : '0 0 6px 4px' }}>{it.proto_name || 'Без прототипа'}</p>}
            <Problem n={it.task} i={i} q={{ id: it.pid, q: it.q, done: it.done, sol: it.sol, src: it.src, check: it.check, img: it.img, ans_img: it.ans_img }} onDone={load} />
          </div>
        ))}
      </div>
    </>
  )
}
