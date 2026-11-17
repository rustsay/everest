import { KeyboardEvent, ReactElement, useEffect, useState } from 'react'
import { listTaskMaps, mapAnalysis, nodeQuiz, sendEvent } from '../api/client'
import { useApp } from '../app/store'
import type { Dashboard, ExamTask, GraphNode } from '../types'
import { Icon, Md, fmt1, reduceMotion, taskLabel } from '../design/ui'

const QUIZ: Record<string, [string, string[], number][]> = {
  CIRC: [['В какой четверти лежит точка −5π/4?', ['I', 'II', 'III', 'IV'], 1], ['Чему равен cos(−2π/3)?', ['−1/2', '1/2', '−√3/2', '√3/2'], 0], ['Сколько корней у sin x = 1/2 на отрезке [−2π; 0]?', ['1', '2', '3', '4'], 1]],
  FRAC: [['Найдите 15 % от 80.', ['12', '8', '15', '1,2'], 0], ['Что больше: 5/6 или 7/9?', ['5/6', '7/9', 'Равны'], 0], ['3/4 + 1/6 = ?', ['11/12', '4/10', '1/2', '5/6'], 0]],
  RAD: [['60° в радианах:', ['π/3', 'π/6', 'π/4', '2π/3'], 0], ['3π/4 в градусах:', ['135°', '120°', '150°', '45°'], 0], ['Сколько радиан в полном обороте?', ['2π', 'π', '360', 'π/2'], 0]],
  TEQ: [['Решения sin x = 0:', ['x = πk', 'x = π/2 + πk', 'x = 2πk'], 0], ['Решения cos x = −1:', ['x = π + 2πk', 'x = πk', 'x = −π/2 + 2πk'], 0], ['Решения sin x = 2:', ['нет корней', 'x = π/2 + 2πk', 'x = arcsin 2'], 0]],
  TFORM: [['sin(π − x) = ?', ['sin x', '−sin x', 'cos x'], 0], ['cos 2x = ?', ['cos²x − sin²x', '2sin x cos x', '1 + 2sin²x'], 0], ['sin²x + cos²x = ?', ['1', '0', '2'], 0]],
  TTRI: [['Теорема косинусов: c² = ?', ['a² + b² − 2ab·cos C', 'a² + b² + 2ab·cos C', 'a² − b²'], 0], ['В прямоугольном треугольнике sin A = ?', ['противолежащий катет / гипотенуза', 'прилежащий катет / гипотенуза', 'катет / катет'], 0], ['Теорема синусов: a / sin A = ?', ['2R', 'R', 'R/2'], 0]],
  QUAD: [['Корни x² − 5x + 6 = 0:', ['2 и 3', '−2 и −3', '1 и 6'], 0], ['Дискриминант 2t² − 3t + 1:', ['1', '17', '−1'], 0], ['Корни x² = 9:', ['±3', '3', '9'], 0]],
  DER: [['(x³)′ = ?', ['3x²', 'x²', '3x'], 0], ['Производная в точке максимума:', ['равна 0 или не существует', 'положительна', 'отрицательна'], 0], ['(5)′ = ?', ['0', '5', '1'], 0]],
  LOG: [['log₂ 8 = ?', ['3', '4', '2'], 0], ['log₃ 1 = ?', ['0', '1', '3'], 0], ['lg 100 = ?', ['2', '10', '1'], 0]],
  INEQ: [['Решение (x − 1)(x + 2) < 0:', ['(−2; 1)', '(−∞; −2) ∪ (1; +∞)', '(1; 2)'], 0], ['Знак (x − 3)² при x ≠ 3:', ['плюс', 'минус', 'любой'], 0], ['При переходе через корень чётной кратности знак:', ['не меняется', 'меняется'], 0]],
  PROB: [['Вероятность выпадения орла при одном броске монеты:', ['0,5', '0,25', '1'], 0], ['P(A) = 0,3. P(не A) = ?', ['0,7', '0,3', '1,3'], 0], ['Независимые события: P(A и B) = ?', ['P(A)·P(B)', 'P(A) + P(B)', 'P(A) − P(B)'], 0]],
  POW: [['2⁻³ = ?', ['1/8', '−8', '−6'], 0], ['√49 · √4 = ?', ['14', '53', '28'], 0], ['8^(1/3) = ?', ['2', '8/3', '24'], 0]],
}

export default function KnowledgeMap() {
  const app = useApp()
  const d = app.dash
  const [sel, setSel] = useState<string>(app.view.id && app.view.id !== 'analysis' ? app.view.id : d?.model.root ?? 'CIRC')
  const [all, setAll] = useState(false)
  const [ai, setAi] = useState<{ busy: boolean; text: string }>({ busy: false, text: '' })

  const runAi = async () => {
    setAi({ busy: true, text: '' })
    try { setAi({ busy: false, text: (await mapAnalysis()).text }); app.reload() } catch (e) { setAi({ busy: false, text: '' }); app.toast(String(e).replace('Error: ', '')) }
  }
  useEffect(() => { if (app.view.id === 'analysis') runAi() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [maps, setMaps] = useState<{ n: number; name: string }[]>([])
  useEffect(() => { listTaskMaps().then((r) => setMaps(r.maps)).catch(() => null) }, [])

  if (!d) return <p className="muted">Загружаю…</p>
  const M = d.model, ex = d.exam
  const nodes = Object.fromEntries(M.nodes.map((n) => [n.id, n]))
  const node = nodes[sel], task = M.tasks.find((t) => t.id === sel)
  const root = M.root ? nodes[M.root] : null
  const atRisk = M.tasks.filter((t) => t.risk)

  return (
    <>
      <div><p className="muted">{ex.title}</p><h1>Карта знаний</h1></div>
      <div className="row stagger">
        <section className="card" style={{ flex: '1 1 220px', borderColor: 'var(--bad)', borderWidth: 1.5 }}>
          <span className="label">Первопричина</span><h2 style={{ marginTop: 6 }}>{root ? root.name : 'не найдена'}</h2>
          <p className="muted" style={{ fontSize: 13.5, marginTop: 4 }}>{root ? `освоено на ${Math.round(root.m * 100)}%` : 'Все проверенные темы выше 50%'}</p>
          {root && <button className="btn btn-sm btn-em" style={{ marginTop: 10 }} onClick={() => { setSel(root.id); sendEvent('ach', 'root').catch(() => null) }}>Открыть</button>}
        </section>
        <section className="card" style={{ flex: '1 1 220px' }}><span className="label">Под угрозой</span><h2 style={{ marginTop: 6 }}><span className="num">{atRisk.length}</span> {ex.pct ? 'тем' : 'заданий'}</h2>
          <p className="muted" style={{ fontSize: 13.5, marginTop: 4 }}>{root ? `из-за темы «${root.name}» и того, что над ней` : 'красных тем нет'}</p></section>
        <section className="card" style={{ flex: '1 1 220px' }}><span className="label">Если закрыть пробел</span><h2 style={{ marginTop: 6, color: 'var(--em-ink)' }}>+{ex.pct ? Math.round((d.gain / ex.max) * 100) + '%' : fmt1(d.gain) + ' ' + (ex.unit === 'б.' ? 'балла' : 'первичных')}</h2>
          <p className="muted" style={{ fontSize: 13.5, marginTop: 4 }}>прогноз сейчас {d.forecast}{ex.pct ? '%' : ' из ' + ex.max}</p></section>
      </div>
      {d.exam.key === 'prof' && maps.length > 0 && (
        <section className="card" style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 260px' }}><b>Карты заданий</b>
            <p className="muted" style={{ fontSize: 13.5, marginTop: 4 }}>Из каких прототипов состоит каждое задание 1-19 и какие сквозные умения в нём нужны. Задачи для проверки, объяснения по учебнику и процент выполняемости по каждому прототипу.</p></div>
          <div className="tm-tabs" aria-label="Карты заданий">
            {maps.map((m) => <button key={m.n} className={m.n >= 13 ? 'p2' : ''} title={m.name} onClick={() => app.go({ v: 'task', id: String(m.n) })}>{m.n}</button>)}
          </div>
        </section>
      )}
      <section aria-label="Граф тем">
        <div className="card-h"><h2>Как темы связаны с {ex.pct ? 'разделами' : 'заданиями'}</h2>
          <div style={{ display: 'flex', gap: 10, fontSize: 12.5, flexWrap: 'wrap' }} className="muted"><span className="pill p-bad">меньше 50%</span><span className="pill p-gold">50-79%</span><span className="pill p-em">80% и выше</span></div></div>
        <div className="graph-box"><Graph d={d} sel={sel} all={all} onPick={(id) => { setSel(id); if (id === M.root) sendEvent('ach', 'root').catch(() => null) }} /></div>
        <p className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>Нажмите на тему или задание. Красный пунктир показывает, куда расходится пробел. Проценты посчитаны по диагностике и проверкам, «?» значит, что данных по теме пока нет.
          <button className="ob-link" style={{ padding: 4 }} onClick={() => setAll(!all)}>{all ? 'Показать только важные' : 'Показать все задания'}</button></p>
      </section>
      <div className="grid2 stagger">
        <section className="card" aria-live="polite">{node ? <NodePanel n={node} d={d} onPick={setSel} /> : task ? <TaskPanel t={task} d={d} onPick={setSel} maps={maps.map((m) => m.n)} /> : <NodePanel n={M.nodes[0]} d={d} onPick={setSel} />}</section>
        <section className="card">
          <div className="card-h"><h2>Подробный разбор пробелов</h2></div>
          <div className="ai-out">{ai.text ? <Md text={ai.text} /> : <p className="muted">Помощник посмотрит на карту и объяснит, какие темы и задания ты теряешь из-за первопричины и что делать на этой неделе.</p>}</div>
          {ai.busy && <div className="typing" aria-label="Думаю"><i /><i /><i /></div>}
          <button className="btn btn-gold" style={{ marginTop: 12 }} onClick={runAi} disabled={ai.busy}><Icon n="pen" s={18} c="#16231F" />{ai.text ? 'Разобрать заново' : 'Разобрать мои пробелы'}</button>
        </section>
      </div>
    </>
  )
}

const lvl = (n: GraphNode) => (n.unknown ? 'gold' : n.m < 0.5 ? 'bad' : n.m < 0.8 ? 'gold' : 'em')
const COL: Record<string, [string, string]> = { bad: ['var(--bad-soft)', 'var(--bad)'], gold: ['var(--gold-soft)', 'var(--gold)'], em: ['var(--em-soft)', 'var(--em-3)'] }

function Graph({ d, sel, all, onPick }: { d: Dashboard; sel: string; all: boolean; onPick: (id: string) => void }) {
  const M = d.model
  const X = [10, 196, 382, 568, 772], W = [172, 172, 172, 186, 214]
  const cols = [0, 1, 2, 3].map((c) => M.nodes.filter((n) => n.col === c))
  const tasks = M.tasks.filter((t) => all || t.risk || t.p < 0.7 || M.tasks.length <= 12)
  const H = Math.max(420, Math.max(...cols.map((c) => c.length)) * 60 + 60, tasks.length * 42 + 60)
  const pos: Record<string, { x: number; y: number; w: number }> = {}
  cols.forEach((c, ci) => c.forEach((n, i) => { pos[n.id] = { x: X[ci], y: 52 + ((i + 0.5) * (H - 60)) / c.length, w: W[ci] } }))
  tasks.forEach((t, i) => { pos[t.id] = { x: X[4], y: 52 + ((i + 0.5) * (H - 60)) / tasks.length, w: W[4] } })
  const weak = new Set(M.weak), threat = new Set(M.threat)
  const bad = (id: string) => weak.has(id) || threat.has(id)
  const edges: ReactElement[] = []
  const edge = (a: string, b: string, danger: boolean) => {
    const A = pos[a], B = pos[b]
    if (!A || !B) return
    const x1 = A.x + A.w, y1 = A.y, x2 = B.x, y2 = B.y, mx = (x1 + x2) / 2
    edges.push(<path key={a + b} d={`M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2 - 6} ${y2}`} fill="none" stroke={danger ? 'var(--bad)' : 'var(--line)'} strokeWidth={danger ? 2 : 1.3} className={danger ? 'flow' : undefined} markerEnd={`url(#${danger ? 'arrB' : 'arrN'})`} />)
  }
  M.nodes.forEach((n) => n.pre.forEach((p) => edge(p, n.id, bad(p))))
  tasks.forEach((t) => t.need.forEach((k) => edge(k, t.id, bad(k))))
  const short = (s: string, k: number) => (s.length > k ? s.slice(0, k - 1) + '…' : s)
  const key = (id: string) => (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(id) } }
  return (
    <svg viewBox={`0 0 1000 ${H}`} role="group" aria-label="Граф тем и заданий" style={{ minWidth: 760 }}>
      <defs>
        <marker id="arrN" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--line)" /></marker>
        <marker id="arrB" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--bad)" /></marker>
      </defs>
      {['БАЗА', 'ОПОРА', 'ИНСТРУМЕНТЫ', 'СЛОЖНЫЕ ТЕМЫ', d.exam.pct ? 'ТЕМЫ' : 'ЗАДАНИЯ'].map((l, i) => <text key={l} x={X[i]} y={22} fontSize={11} fontWeight={800} fill="var(--muted)" letterSpacing={1}>{l}</text>)}
      {edges}
      {M.nodes.map((n, i) => {
        const P = pos[n.id], [f, s] = COL[lvl(n)], isRoot = n.id === M.root, on = sel === n.id
        return (
          <g key={n.id} className={`gnode ${isRoot ? 'pulse-node' : ''}`} role="button" tabIndex={0} onClick={() => onPick(n.id)} onKeyDown={key(n.id)}
            aria-label={`${n.name}, ${n.unknown ? 'нет данных' : 'освоено ' + Math.round(n.m * 100) + '%'}${isRoot ? ', первопричина' : ''}`}
            style={{ animation: isRoot || reduceMotion ? undefined : `pop .4s ${0.03 * i}s both`, transformBox: 'fill-box', transformOrigin: 'center' }}>
            <rect x={P.x} y={P.y - 22} width={P.w} height={44} rx={12} fill={n.unknown ? 'var(--surface)' : f} stroke={on ? 'var(--ink)' : s} strokeWidth={on ? 3 : isRoot ? 2.5 : 1.5} strokeDasharray={n.unknown ? '4 4' : undefined} />
            <text x={P.x + 10} y={P.y - 3} fontSize={11.5} fontWeight={700} fill="var(--ink)">{short(n.name, 24)}</text>
            <rect x={P.x + 10} y={P.y + 8} width={P.w - 56} height={5} rx={2.5} fill="var(--surface-2)" />
            {!n.unknown && <rect x={P.x + 10} y={P.y + 8} width={(P.w - 56) * n.m} height={5} rx={2.5} fill={s} />}
            <text x={P.x + P.w - 10} y={P.y + 14} textAnchor="end" fontSize={11} fontWeight={800} fill="var(--ink)">{n.unknown ? '?' : Math.round(n.m * 100) + '%'}</text>
          </g>
        )
      })}
      {tasks.map((t, i) => {
        const P = pos[t.id], on = sel === t.id
        return (
          <g key={t.id} className="gnode" role="button" tabIndex={0} onClick={() => onPick(t.id)} onKeyDown={key(t.id)} aria-label={`${taskLabel(t)}, ${t.risk ? 'под угрозой' : 'в порядке'}`}
            style={{ animation: reduceMotion ? undefined : `pop .4s ${0.4 + 0.03 * i}s both`, transformBox: 'fill-box', transformOrigin: 'center' }}>
            <rect x={P.x} y={P.y - 16} width={P.w} height={32} rx={10} fill={t.risk ? 'var(--bad-soft)' : 'var(--surface)'} stroke={on ? 'var(--ink)' : t.risk ? 'var(--bad)' : 'var(--em-3)'} strokeWidth={on ? 3 : 1.5} strokeDasharray={t.risk ? '5 4' : undefined} />
            <text x={P.x + 10} y={P.y + 4} fontSize={11.5} fontWeight={800} fill="var(--ink)">{(t.n ? `№ ${t.n} · ` : '') + short(t.name, 22)}</text>
          </g>
        )
      })}
    </svg>
  )
}

function NodePanel({ n, d, onPick }: { n: GraphNode; d: Dashboard; onPick: (id: string) => void }) {
  const app = useApp()
  const M = d.model, nodes = Object.fromEntries(M.nodes.map((x) => [x.id, x]))
  const kids = M.nodes.filter((x) => x.pre.includes(n.id)), tasks = M.tasks.filter((t) => t.need.includes(n.id))
  const cls = (x: GraphNode) => `pill p-${lvl(x)}`
  return (
    <>
      <div className="card-h"><h2>{n.name}</h2><span className={`${cls(n)} num`}>{n.unknown ? 'нет данных' : Math.round(n.m * 100) + '%'}</span></div>
      <div className="bar"><i style={{ width: `${n.unknown ? 0 : n.m * 100}%`, background: COL[lvl(n)][1] }} /></div>
      {n.id === M.root && <p style={{ marginTop: 10, fontWeight: 700, color: 'var(--bad-ink)' }}>Это первопричина: отсюда пробел расходится выше по карте.</p>}
      {n.unknown && <p className="muted" style={{ marginTop: 10, fontSize: 13.5 }}>По этой теме ещё не было заданий. Мини-диагностика или проверка по фото уточнит процент.</p>}
      <div style={{ marginTop: 12, display: 'grid', gap: 6, fontSize: 13.5 }}>
        <div><span className="label">Нужно знать</span><br />{n.pre.length ? n.pre.map((p) => <button key={p} className={cls(nodes[p])} style={{ border: 0, cursor: 'pointer', margin: '4px 4px 0 0', minHeight: 28 }} onClick={() => onPick(p)}>{nodes[p].name}</button>) : <span className="muted">базовая тема</span>}</div>
        <div><span className="label">Нужна для</span><br />
          {[...kids.map((k) => <button key={k.id} className="pill p-gold" style={{ border: 0, cursor: 'pointer', margin: '4px 4px 0 0', minHeight: 28 }} onClick={() => onPick(k.id)}>{k.name}</button>),
            ...tasks.map((t) => <button key={t.id} className={`pill ${t.risk ? 'p-bad' : 'p-em'}`} style={{ border: 0, cursor: 'pointer', margin: '4px 4px 0 0', minHeight: 28 }} onClick={() => onPick(t.id)}>{taskLabel(t)}</button>)]}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
        {QUIZ[n.id] && <button className="btn btn-em" onClick={() => app.openModal('Диагностика: ' + n.name, <Quiz id={n.id} />)}>Мини-диагностика · 3 вопроса</button>}
        <button className="btn btn-ghost" onClick={() => app.go({ v: 'chat', id: `Объясни тему «${n.name}» на примере из экзамена. Начни с вопроса ко мне.` })}>Спросить помощника</button>
      </div>
    </>
  )
}

function TaskPanel({ t, d, onPick, maps }: { t: ExamTask; d: Dashboard; onPick: (id: string) => void; maps: number[] }) {
  const app = useApp()
  const nodes = Object.fromEntries(d.model.nodes.map((x) => [x.id, x]))
  return (
    <>
      <div className="card-h"><h2>{t.n ? `Задание № ${t.n}: ` : ''}{t.name}</h2><span className={`pill ${t.risk ? 'p-bad' : 'p-em'}`}>{t.risk ? 'под угрозой' : 'в порядке'}</span></div>
      <p className="muted">Максимум {t.max} {d.exam.pct ? '' : 'перв. '}б. Ожидаемо сейчас: <b style={{ color: 'var(--ink)' }}>{fmt1(t.exp)}</b>{t.obs != null ? ` · по замерам ${Math.round(t.obs * 100)}%` : ''}.</p>
      <div style={{ marginTop: 12 }}><span className="label">Какие темы нужны</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          {t.need.map((k) => <button key={k} className="item" onClick={() => onPick(k)}><span className={`pill p-${lvl(nodes[k])} num`}>{nodes[k].unknown ? '?' : Math.round(nodes[k].m * 100) + '%'}</span><span className="t-strong" style={{ flex: 1 }}>{nodes[k].name}</span><Icon n="arrow" s={18} /></button>)}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
        {typeof t.n === 'number' && d.exam.key === 'prof' && maps.includes(t.n) && <button className="btn btn-em" onClick={() => app.go({ v: 'task', id: String(t.n) })}>Карта задания</button>}
        {typeof t.n === 'number' && d.exam.key === 'prof' && <button className="btn btn-line" onClick={() => app.go({ v: 'video', id: String(t.n) })}>Видеоразбор</button>}
        {typeof t.n === 'number' && t.n >= 13 && t.n <= 19 && <button className="btn btn-em" onClick={() => app.go('check')}>Решить и проверить по фото</button>}
      </div>
    </>
  )
}

function Quiz({ id }: { id: string }) {
  const app = useApp()
  const qs = QUIZ[id]
  const [i, setI] = useState(0)
  const [ok, setOk] = useState(0)
  const [picked, setPicked] = useState<number | null>(null)
  const [res, setRes] = useState<{ before: number; after: number } | null>(null)
  if (res) return (
    <>
      <p style={{ fontSize: 17, fontWeight: 700 }}>Верно {ok} из {qs.length}</p>
      <p className="muted" style={{ marginTop: 6 }}>Освоение: {Math.round(res.before * 100)}% → <b style={{ color: 'var(--ink)' }}>{Math.round(res.after * 100)}%</b>. Карта и прогноз пересчитаны.</p>
      <button className="btn btn-em" style={{ marginTop: 16 }} onClick={app.closeModal} autoFocus>Готово</button>
    </>
  )
  const q = qs[i]
  return (
    <>
      <p className="label">Вопрос {i + 1} из {qs.length}</p>
      <div className="bar" style={{ margin: '8px 0 14px' }}><i style={{ width: `${(i / qs.length) * 100}%`, background: 'var(--gold)', animation: 'none' }} /></div>
      <p style={{ fontSize: 18, fontWeight: 700 }}>{q[0]}</p>
      <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
        {q[1].map((o, j) => {
          const st = picked == null ? {} : j === q[2] ? { background: 'var(--em-soft)', borderColor: 'var(--em-3)' } : j === picked ? { background: 'var(--bad-soft)', borderColor: 'var(--bad)' } : {}
          return <button key={j} className="item" style={{ background: 'var(--surface)', border: '1.5px solid var(--line)', ...st }} disabled={picked != null} onClick={() => { setPicked(j); if (j === q[2]) setOk(ok + 1) }}><span className="t-strong">{o}</span></button>
        })}
      </div>
      {picked != null && <button className="btn btn-em" style={{ marginTop: 14 }} autoFocus onClick={async () => {
        if (i + 1 < qs.length) { setI(i + 1); setPicked(null); return }
        const r = await nodeQuiz(id, ok, qs.length)
        setRes(r)
        if (ok === qs.length) app.confetti()
        app.reload()
      }}>{i + 1 < qs.length ? 'Дальше' : 'Результат'}</button>}
    </>
  )
}
