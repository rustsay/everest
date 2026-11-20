import ProblemText, { AnswerPic } from '../components/ProblemText'
import { FormEvent, ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { answerTaskMap, deleteTaskFile, downloadTaskFile, explainSkill, getTaskMap, listTaskMaps, uploadTaskFile } from '../api/client'
import { useApp } from '../app/store'
import { examRange } from '../types'
import ExamSwitch from '../components/ExamSwitch'
import StaleServer from '../components/StaleServer'
import type { SkillExplain, TaskMapData, TmAnswer, TmProblem, TmProto, TmSkill, TmStat } from '../types'
import { Icon, Md } from '../design/ui'
import GeoFig from '../components/GeoFig'

type Sel = { kind: 'proto' | 'skill' | 'task'; id: string } | null

const lvl = (s: TmStat) => (s.pct == null ? 'none' : s.pct < 50 ? 'bad' : s.pct < 80 ? 'gold' : 'em')
const COLOR: Record<string, string> = { none: 'var(--line)', bad: 'var(--bad)', gold: 'var(--gold)', em: 'var(--em-3)' }
const pctText = (s: TmStat) => (s.pct == null ? 'ещё не решал' : `${s.pct}% · ${s.ok} из ${s.count}`)
/** A geometry drawing when there is one, otherwise the task number. */
function Fig({ k, n, w }: { k: string | null; n: number; w: number }) {
  if (k) return <GeoFig k={k} w={w} />
  return <span className="tm-badge" style={{ width: w, height: Math.round(w * 0.7), fontSize: Math.max(12, w / 4) }} aria-hidden="true">№{n}</span>
}

const zadach = (k: number) => (k % 10 === 1 && k % 100 !== 11 ? 'задача' : [2, 3, 4].includes(k % 10) && ![12, 13, 14].includes(k % 100) ? 'задачи' : 'задач')

/** Knowledge map of one exam task: prototypes → skills → task, with practice, materials and files. */
export default function TaskMap({ n }: { n: number }) {
  const app = useApp()
  const [d, setD] = useState<TaskMapData | null>(null)
  const [maps, setMaps] = useState<{ n: number; name: string }[]>([])
  const [err, setErr] = useState('')
  const [sel, setSel] = useState<Sel>(null)
  const [hover, setHover] = useState<string | null>(null)
  const exam = app.me.role === 'student' ? undefined : app.exam
  const load = useCallback(() => getTaskMap(n, exam).then((m) => { setD(m); setErr('') }).catch((e) => setErr(String(e).replace('Error: ', ''))), [n, exam])
  useEffect(() => { load() }, [load])
  useEffect(() => { listTaskMaps(exam).then((r) => setMaps(r.maps)).catch(() => null) }, [exam])

  if (err) return <><ExamSwitch onChange={() => app.go({ v: 'task', id: '1' })} /><p className="muted" style={{ marginTop: 10 }}>{err}</p></>
  if (!d) return <p className="muted">Загружаю карту задания…</p>
  const start = [...d.protos].filter((p) => p.count).sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0))[0] ?? d.protos.find((p) => !p.count)

  return (
    <>
      <div className="card-h" style={{ margin: 0, alignItems: 'flex-end' }}>
        <div>
          <p className="muted">Карта задания{d.exam && d.exam !== 'prof' ? ` · ${d.exam === 'oge' ? 'ОГЭ' : 'ЕГЭ база'}` : ''} · {d.part === 2 ? 'вторая часть' : 'первая часть'} · {d.protos.length} {d.exam && d.exam !== 'prof' ? 'типов' : 'прототипов'}</p>
          <h1>Задание № {d.n} · {d.name}</h1>
          <div style={{ marginTop: 8 }}><ExamSwitch onChange={() => app.go({ v: 'task', id: '1' })} /></div>
        </div>
        <div className="tm-tabs" role="tablist" aria-label="Задания">
          {Array.from({ length: examRange(d.exam).n }, (_, i) => i + 1).map((k) => {
            const m = maps.find((x) => x.n === k)
            return <button key={k} role="tab" aria-selected={k === n} disabled={!m} title={m ? m.name : 'Скоро'} className={`${k === n ? 'on' : ''} ${k >= examRange(d.exam).p2 ? 'p2' : ''}`} onClick={() => app.go({ v: 'task', id: String(k) })}>{k}</button>
          })}
        </div>
      </div>
      <StaleServer want={app.exam} got={d.exam ?? 'prof'} />

      <section className="card tm-sum">
        <TaskRing s={d.total} size={84} />
        <div style={{ flex: '1 1 220px' }}>
          <b>{d.total.pct == null ? 'Ты ещё не решал задачи этого задания' : `Выполняемость ${d.total.pct}%: верно ${d.total.ok} из ${d.total.count}`}</b>
          <p className="muted" style={{ fontSize: 13.5, marginTop: 4 }}>Пройдено прототипов: {d.total.covered} из {d.total.of}.{start ? <> Начни с «{start.name}».</> : null}</p>
        </div>
        {start && <button className="btn btn-em" onClick={() => setSel({ kind: 'proto', id: start.id })}>Открыть «{start.name.split(':')[0]}»</button>}
      </section>

      <section aria-label="Карта задания">
        <div className="card-h"><h2>Из чего состоит задание</h2>
          <div className="muted" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 12.5 }}>
            <span className="pill p-bad">меньше 50%</span><span className="pill p-gold">50-79%</span><span className="pill p-em">80% и выше</span><span className="pill" style={{ border: '1.5px dashed var(--line)' }}>не решал</span>
          </div>
        </div>
        <Graph d={d} hover={hover} sel={sel} onHover={setHover} onPick={setSel} />
        <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>Линии от прототипов сходятся в задание, цвет линии - уровень прототипа. Наведи на прототип или умение, чтобы увидеть их связь. Нажми на прототип: там что нужно знать, задачи, разбор и файлы. Процент считается по первой попытке в каждой задаче и по диагностике.</p>
      </section>

      {sel && <Drawer onClose={() => setSel(null)}>
        {sel.kind === 'proto' && <ProtoPanel d={d} p={d.protos.find((x) => x.id === sel.id)!} onChanged={load} onPick={setSel} />}
        {sel.kind === 'skill' && <SkillPanel d={d} s={d.skills.find((x) => x.id === sel.id)!} onPick={setSel} />}
        {sel.kind === 'task' && <TaskPanel d={d} onPick={setSel} />}
      </Drawer>}
    </>
  )
}

function TaskRing({ s, size }: { s: TmStat; size: number }) {
  const r = size / 2 - 7, c = 2 * Math.PI * r, v = (s.pct ?? 0) / 100
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" style={{ flex: 'none' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={8} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={COLOR[lvl(s)]} strokeWidth={8} strokeLinecap="round"
        strokeDasharray={`${c * v} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize={size / 4.4} fontWeight={800} fill="var(--ink)">{s.pct == null ? '-' : s.pct + '%'}</text>
    </svg>
  )
}

/* ---------- graph: HTML cards + SVG arrows measured from the DOM ---------- */

type Geo = { stubs: { id: string; d: string }[]; trunk: string; toTask: string; links: { from: string; to: string; d: string }[] }

/** Lines: every prototype → one trunk → the task (colour = prototype level).
 *  Skill links are drawn only for the prototype or skill under the cursor / selected, so the map never turns into a mesh. */
function Graph({ d, hover, sel, onHover, onPick }: { d: TaskMapData; hover: string | null; sel: Sel; onHover: (id: string | null) => void; onPick: (s: Sel) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const refs = useRef<Record<string, HTMLElement | null>>({})
  const [g, setG] = useState<Geo | null>(null)
  const skillShort = (id: string) => d.skills.find((k) => k.id === id)?.short ?? id

  const measure = useCallback(() => {
    const B = box.current?.getBoundingClientRect(), T = refs.current.task
    if (!B || !T || !T.offsetParent) { setG(null); return }
    const rt = T.getBoundingClientRect()
    const taskY = rt.top + rt.height / 2 - B.top, taskX = rt.left - B.left
    const pts = d.protos.map((p) => { const r = refs.current[p.id]?.getBoundingClientRect(); return r ? { id: p.id, x: r.right - B.left, y: r.top + r.height / 2 - B.top } : null }).filter(Boolean) as { id: string; x: number; y: number }[]
    if (!pts.length) return
    const right = Math.max(...pts.map((q) => q.x)), tx = right + (taskX - right) * 0.45
    const ys = [...pts.map((q) => q.y), taskY]
    const links: Geo['links'] = []
    for (const p of d.protos) {
      const a = pts.find((q) => q.id === p.id)
      for (const sid of p.skills) {
        const el = refs.current['s:' + sid]
        if (!a || !el) continue
        const r = el.getBoundingClientRect(), x2 = r.left - B.left - 4, y2 = r.top + r.height / 2 - B.top
        const mx = a.x + (x2 - a.x) * 0.5
        links.push({ from: p.id, to: 's:' + sid, d: `M${a.x} ${a.y} C${mx} ${a.y} ${mx} ${y2} ${x2} ${y2}` })
      }
    }
    setG({
      stubs: pts.map((q) => ({ id: q.id, d: `M${q.x} ${q.y} H${tx}` })),
      trunk: `M${tx} ${Math.min(...ys)} V${Math.max(...ys)}`,
      toTask: `M${tx} ${taskY} H${taskX - 5}`,
      links,
    })
  }, [d])

  useLayoutEffect(() => {
    measure()
    const ro = new ResizeObserver(measure)
    if (box.current) ro.observe(box.current)
    return () => ro.disconnect()
  }, [measure])

  const active = hover ?? (sel ? (sel.kind === 'skill' ? 's:' + sel.id : sel.kind === 'task' ? 'task' : sel.id) : null)
  const activeSkill = active?.startsWith('s:') ? active.slice(2) : null
  const lit = (pid: string) => active == null || active === 'task' || active === pid || (activeSkill != null && d.protos.find((p) => p.id === pid)?.skills.includes(activeSkill))
  const shown = (g?.links ?? []).filter((l) => active != null && (l.from === active || l.to === active))
  const reg = (id: string) => (el: HTMLElement | null) => { refs.current[id] = el }
  const hov = (id: string) => ({ onMouseEnter: () => onHover(id), onMouseLeave: () => onHover(null), onFocus: () => onHover(id), onBlur: () => onHover(null) })

  return (
    <div className="tm-graph" ref={box}>
      {g && (
        <svg className="tm-edges" aria-hidden="true">
          <defs>
            <marker id="tmA" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--muted)" /></marker>
            <marker id="tmB" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--em-3)" /></marker>
          </defs>
          {g.stubs.map((s) => {
            const p = d.protos.find((x) => x.id === s.id)!
            return <path key={s.id} d={s.d} fill="none" stroke={p.pct == null ? 'var(--line)' : COLOR[lvl(p)]} strokeWidth={active === s.id ? 4 : 2.5} strokeLinecap="round" opacity={lit(s.id) ? 1 : 0.25} />
          })}
          <path d={g.trunk} fill="none" stroke="var(--muted)" strokeWidth={2.5} strokeLinecap="round" opacity={0.55} />
          <path d={g.toTask} fill="none" stroke="var(--muted)" strokeWidth={2.5} markerEnd="url(#tmA)" opacity={0.75} />
          {shown.map((l) => <path key={l.from + l.to} d={l.d} fill="none" stroke="var(--em-3)" strokeWidth={2.2} strokeDasharray="6 5" className="flow" markerEnd="url(#tmB)" />)}
        </svg>
      )}

      <div className="tm-col">
        <span className="label tm-colh">Прототипы</span>
        {d.protos.map((p) => (
          <button key={p.id} ref={reg(p.id)} className={`tm-card lvl-${lvl(p)} ${sel?.id === p.id ? 'sel' : ''} ${lit(p.id) ? '' : 'dim'}`} onClick={() => onPick({ kind: 'proto', id: p.id })} {...hov(p.id)}
            aria-label={`${p.name}, ${pctText(p)}`}>
            <Fig k={p.fig} n={d.n} w={64} />
            <span className="tm-card-b">
              <b>{p.name}</b>
              <span className="bar"><i style={{ width: `${p.pct ?? 0}%`, background: COLOR[lvl(p)] }} /></span>
              <small className="muted">{pctText(p)}{p.files.length ? ` · файлов ${p.files.length}` : ''}</small>
              {p.skills.length > 0 && <span className="tm-tags">{p.skills.map((sid) => <i key={sid} className={activeSkill === sid ? 'on' : ''}>{skillShort(sid)}</i>)}</span>}
            </span>
          </button>
        ))}
      </div>

      <div className="tm-col tm-end">
        <button ref={reg('task')} className={`tm-task lvl-${lvl(d.total)} ${sel?.kind === 'task' ? 'sel' : ''}`} onClick={() => onPick({ kind: 'task', id: 'task' })} {...hov('task')}
          aria-label={`Задание ${d.n}, ${pctText(d.total)}`}>
          <span className="label">Задание {d.n}</span>
          <b>{d.name}</b>
          <TaskRing s={d.total} size={92} />
          <small className="muted">прототипов {d.total.covered} из {d.total.of}</small>
        </button>
        <span className="label tm-colh" style={{ marginTop: 18 }}>Сквозные умения</span>
        {d.skills.map((s) => (
          <button key={s.id} ref={reg('s:' + s.id)} className={`tm-card tm-skill lvl-${lvl(s)} ${sel?.id === s.id ? 'sel' : ''}`} onClick={() => onPick({ kind: 'skill', id: s.id })} {...hov('s:' + s.id)}
            aria-label={`${s.name}, ${pctText(s)}`}>
            {s.fig ? <GeoFig k={s.fig} w={52} /> : <span className="tm-skico" aria-hidden="true"><Icon n="bulb" s={22} /></span>}
            <span className="tm-card-b"><b>{s.name}</b><small className="muted">{pctText(s)} · в {d.protos.filter((p) => p.skills.includes(s.id)).length} прототипах</small></span>
          </button>
        ))}
      </div>
    </div>
  )
}

/* ---------- side panel ---------- */

function Drawer({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [onClose])
  return createPortal(
    <div className="tm-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <aside className="tm-drawer" role="dialog" aria-modal="true">
        <button className="iconbtn tm-x" onClick={onClose} aria-label="Закрыть"><Icon n="close" /></button>
        {children}
      </aside>
    </div>, document.body)
}

function Head({ fig, n, title, s, sub }: { fig: string | null; n: number; title: string; s: TmStat; sub?: string }) {
  return (
    <>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', paddingRight: 44 }}>
        {fig || n ? <span className="tm-figbox"><Fig k={fig} n={n} w={110} /></span> : null}
        <div><h2 style={{ fontSize: 20 }}>{title}</h2>{sub && <p className="muted" style={{ fontSize: 13 }}>{sub}</p>}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
        <span className={`pill ${s.pct == null ? '' : 'p-' + lvl(s)} num`} style={s.pct == null ? { border: '1.5px dashed var(--line)' } : undefined}>{s.pct == null ? 'не решал' : s.pct + '%'}</span>
        <div className="bar" style={{ flex: 1 }}><i style={{ width: `${s.pct ?? 0}%`, background: COLOR[lvl(s)] }} /></div>
      </div>
    </>
  )
}

function Know({ items }: { items: string[] }) {
  if (!items.length) return null
  return (
    <div className="tm-sec"><span className="label">Что нужно знать</span>
      <ul className="tm-know">{items.map((k) => <li key={k}>{k}</li>)}</ul>
    </div>
  )
}

function ProtoPanel({ d, p, onChanged, onPick }: { d: TaskMapData; p: TmProto; onChanged: () => void; onPick: (s: Sel) => void }) {
  const app = useApp()
  const [busy, setBusy] = useState(false)
  const src = p.count ? `верно ${p.ok} из ${p.count}${p.from_diag ? ` (с диагностикой)` : ''}` : 'реши задачи ниже, и здесь появится процент'
  const upload = async (f: File | undefined) => {
    if (!f) return
    setBusy(true)
    try { await uploadTaskFile(d.n, p.id, f); app.toast('Файл добавлен'); onChanged() } catch (e) { app.toast(String(e).replace('Error: ', '')) } finally { setBusy(false) }
  }
  return (
    <>
      <Head fig={p.fig} n={d.n} title={p.name} s={p} sub={`Задание № ${d.n} · ${src}`} />
      {p.added && <p className="tm-note">{p.added}</p>}
      <Know items={p.know} />
      {p.skills.length > 0 && <div className="tm-sec"><span className="label">Нужны умения · нажми, чтобы прочитать объяснение по учебнику</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {p.skills.map((sid) => { const s = d.skills.find((x) => x.id === sid); return s ? <button key={sid} className={`pill ${s.pct == null ? '' : 'p-' + lvl(s)}`} style={{ border: s.pct == null ? '1.5px dashed var(--line)' : 0, cursor: 'pointer', minHeight: 30 }} onClick={() => onPick({ kind: 'skill', id: sid })}>{s.name} · {s.pct == null ? 'не решал' : s.pct + '%'}</button> : null })}
        </div></div>}
      <div className="tm-sec"><span className="label">Проверь себя · {p.problems.length} {zadach(p.problems.length)}</span>
        {p.problems.length ? <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>{p.problems.map((q, i) => <Problem key={q.id} n={d.n} i={i} q={q} onDone={onChanged} />)}</div>
          : <p className="muted" style={{ fontSize: 13.5, marginTop: 6 }}>Задач по этому прототипу пока нет. {d.can_upload ? 'Добавьте их в разделе «Банк задач».' : 'Их добавит учитель через банк задач.'}</p>}
      </div>
      <div className="tm-sec"><span className="label">Материалы</span>
        <div className="tm-links">
          <button className="item" onClick={() => app.go({ v: 'video', id: String(d.n) })}><Icon n="play" s={18} /><span className="t-strong" style={{ flex: 1 }}>Видеоразбор задания № {d.n}</span><Icon n="arrow" s={16} /></button>
          {p.links.map((l) => <a key={l.url} className="item" href={l.url} target="_blank" rel="noopener noreferrer"><Icon n="book" s={18} /><span className="t-strong" style={{ flex: 1 }}>{l.title}<small className="muted" style={{ display: 'block', fontWeight: 600 }}>{new URL(l.url).host}</small></span><Icon n="full" s={16} /></a>)}
          {p.files.map((f) => (
            <div key={f.id} className="item">
              <Icon n="slides" s={18} />
              <button className="t-strong" style={{ flex: 1, textAlign: 'left', background: 'none', border: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', padding: 0 }} onClick={() => downloadTaskFile(f.id, f.name).catch((e) => app.toast(String(e).replace('Error: ', '')))}>
                {f.name}<small className="muted" style={{ display: 'block', fontWeight: 600 }}>{Math.max(1, Math.round(f.size / 1024))} КБ · скачать</small>
              </button>
              {f.mine && <button className="iconbtn" aria-label={'Удалить ' + f.name} onClick={async () => { await deleteTaskFile(f.id).catch(() => null); onChanged() }}><Icon n="trash" s={18} /></button>}
            </div>
          ))}
          {!p.links.length && !p.files.length && <p className="muted" style={{ fontSize: 13 }}>Файлов к этому прототипу пока нет{d.can_upload ? '. Прикрепите теорию или подборку задач.' : '. Их добавит учитель.'}</p>}
        </div>
        {d.can_upload && <label className="btn btn-sm btn-line" style={{ marginTop: 10 }}><Icon n="plus" s={16} />{busy ? 'Загружаю…' : 'Прикрепить файл'}
          <input type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.docx,.pptx" disabled={busy} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = '' }} /></label>}
      </div>
      <button className="btn btn-ghost" style={{ marginTop: 14 }} onClick={() => app.go({ v: 'chat', id: `Задание № ${d.n}, прототип «${p.name}». Объясни, как такие задачи решать, начни с вопроса ко мне.` })}><Icon n="chat" s={18} />Спросить помощника</button>
    </>
  )
}

export function Problem({ n, i, q, onDone }: { n: number; i: number; q: TmProblem; onDone: () => void }) {
  const app = useApp()
  const [v, setV] = useState('')
  const [res, setRes] = useState<TmAnswer | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!v.trim() || busy) return
    setBusy(true)
    try { const r = await answerTaskMap(n, q.id, v); setRes(r); onDone() } finally { setBusy(false) }
  }
  const was = q.done
  return (
    <div className={`tm-prob ${res ? (res.ok ? 'ok' : 'no') : was === 1 ? 'ok' : was === 0 ? 'no' : ''}`}>
      <div className="prob-q"><b>{i + 1}.</b> <ProblemText q={q.q} img={q.img} ctx={q.ctx_img} small /></div>
      {q.src && <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>Источник: {q.src}</p>}
      {q.check === 'photo' && !res && was == null ? (
        <><button className="btn btn-sm btn-line" style={{ marginTop: 10 }} onClick={() => app.go('check')}><Icon n="check" s={16} />Решить и проверить по фото</button><AnswerPic src={q.ans_img} /></>
      ) : res ? (
        <p className="tm-res"><b>{res.ok ? 'Верно.' : `Неверно, ответ ${res.answer}.`}</b> {res.sol}{!res.first && !res.redo && <span className="muted"> В процент идёт первая попытка.</span>}
          {res.redo === 'added' && <span className="muted"> Задача вернётся в «Работе над ошибками» через 3 дня.</span>}
          {res.redo === 'next' && <span className="muted"> Исправлено! Ещё раз через 7 дней, чтобы закрепить.</span>}
          {res.redo === 'done' && <span className="muted"> Ошибка исправлена окончательно: +40 м.</span>}
          {res.redo === 'again' && <span className="muted"> Пока не вышло: задача вернётся через 3 дня.</span>}</p>
      ) : was != null ? (
        <p className="tm-res"><b>{was ? 'Решено с первой попытки.' : 'С первой попытки не получилось.'}</b> {q.sol}</p>
      ) : (
        <form className="tm-ans" onSubmit={submit}>
          <input className="input" inputMode="decimal" placeholder="Ответ" value={v} onChange={(e) => setV(e.target.value)} aria-label={`Ответ к задаче ${i + 1}`} />
          <button className="btn btn-em" type="submit" disabled={busy || !v.trim()}>Проверить</button>
          {n <= 12 && <button type="button" className="btn btn-ghost" title="Ответ и фото решения: найдём ошибку"
            onClick={() => app.go({ v: 'check', id: `1-${n}-${/^[fb]\d+$/.test(q.id) ? q.id : `s${n}:${q.id}`}` })}><Icon n="check" s={16} />По фото</button>}
        </form>
      )}
    </div>
  )
}

function SkillPanel({ d, s, onPick }: { d: TaskMapData; s: TmSkill; onPick: (s: Sel) => void }) {
  const app = useApp()
  const users = d.protos.filter((p) => p.skills.includes(s.id))
  const [ex, setEx] = useState<SkillExplain | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const explain = async () => {
    setBusy(true); setErr('')
    try { setEx(await explainSkill(s.id)) } catch (e) { setErr(String(e).replace('Error: ', '')) } finally { setBusy(false) }
  }
  return (
    <>
      <Head fig={s.fig} n={0} title={s.name} s={s} sub={s.count ? `верно ${s.ok} из ${s.count} в задачах, где нужно это умение` : 'процент появится после задач, где нужно это умение'} />
      <Know items={s.know} />
      <div className="tm-sec"><span className="label">Объяснение по учебнику</span>
        {ex?.text ? (
          <div className="tm-explain">
            <Md text={ex.text} />
            <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>Источник: «{ex.book.title}»{ex.book.authors ? `, ${ex.book.authors}` : ''}{ex.pages.length ? `, ${ex.pages.join(', ')}` : ''}. Написано помощником строго по этим страницам; если что-то расходится с учебником, верен учебник.</p>
          </div>
        ) : ex ? <p className="muted" style={{ fontSize: 13.5, marginTop: 6 }}>{ex.message}</p>
          : <p className="muted" style={{ fontSize: 13.5, marginTop: 6 }}>Помощник найдёт страницы про это умение в учебнике и объяснит по ним, со ссылками на страницы.</p>}
        {err && <p className="auth-msg" style={{ marginTop: 6 }}>{err}</p>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {!ex?.text && <button className="btn btn-em" onClick={explain} disabled={busy}><Icon n="book" s={18} />{busy ? 'Ищу в учебнике…' : 'Объяснить по учебнику'}</button>}
          <button className="btn btn-ghost" onClick={() => app.go({ v: 'chat', id: `Умение «${s.name}». Объясни на примере из ЕГЭ, начни с вопроса ко мне.` })}><Icon n="chat" s={18} />Спросить помощника</button>
        </div>
      </div>
      <div className="tm-sec"><span className="label">Где нужно в задании № {d.n}</span>
        <div className="tm-links">{users.map((p) => <button key={p.id} className="item" onClick={() => onPick({ kind: 'proto', id: p.id })}><Fig k={p.fig} n={d.n} w={40} /><span className="t-strong" style={{ flex: 1 }}>{p.name}</span><span className="muted num" style={{ fontSize: 13 }}>{p.pct == null ? '-' : p.pct + '%'}</span></button>)}</div>
      </div>
    </>
  )
}

function TaskPanel({ d, onPick }: { d: TaskMapData; onPick: (s: Sel) => void }) {
  const app = useApp()
  const order = [...d.protos].sort((a, b) => (a.pct ?? -1) - (b.pct ?? -1))
  return (
    <>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', paddingRight: 44 }}>
        <TaskRing s={d.total} size={96} />
        <div><span className="label">Задание № {d.n}</span><h2 style={{ fontSize: 20 }}>{d.name}</h2>
          <p className="muted" style={{ fontSize: 13 }}>{d.total.count ? `верно ${d.total.ok} из ${d.total.count} · прототипов ${d.total.covered} из ${d.total.of}` : 'задачи ещё не решались'}</p></div>
      </div>
      <div className="tm-sec"><span className="label">Сквозные умения задания</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {d.skills.map((k) => <button key={k.id} className={`pill ${k.pct == null ? '' : 'p-' + lvl(k)}`} style={{ border: k.pct == null ? '1.5px dashed var(--line)' : 0, cursor: 'pointer', minHeight: 30 }} onClick={() => onPick({ kind: 'skill', id: k.id })}>{k.short} · {k.pct == null ? 'не решал' : k.pct + '%'}</button>)}
        </div>
      </div>
      <div className="tm-sec"><span className="label">Прототипы, от слабых к сильным</span>
        <div className="tm-links">{order.map((p) => <button key={p.id} className="item" onClick={() => onPick({ kind: 'proto', id: p.id })}><Fig k={p.fig} n={d.n} w={40} /><span className="t-strong" style={{ flex: 1 }}>{p.name}</span><span className={`pill ${p.pct == null ? '' : 'p-' + lvl(p)} num`} style={p.pct == null ? { border: '1.5px dashed var(--line)' } : undefined}>{p.pct == null ? 'не решал' : p.pct + '%'}</span></button>)}</div>
      </div>
      <button className="btn btn-line" style={{ marginTop: 14 }} onClick={() => app.go({ v: 'video', id: String(d.n) })}><Icon n="play" s={18} />Видеоразбор задания № {d.n}</button>
    </>
  )
}
