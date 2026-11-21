import { FormEvent, useEffect, useRef, useState } from 'react'
import { assignmentDone, dailyAnswer, dailyHint, mapAnalysis, sendEvent, togglePlanBlock } from '../api/client'
import { useApp } from '../app/store'
import type { Dashboard, PlanBlock } from '../types'
import { Icon, Md, Orn, STAR_D, StarBot, Typed, fmt1, fmtD, plural, prepareSpeech, reduceMotion, taskLabel } from '../design/ui'
import { RouteNote, blockGo } from './Plan'

const hello = () => { const h = new Date().getHours(); return h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер' }

function greetLine(d: Dashboard) {
  const h = new Date().getHours()
  if (h >= 22 || h < 6) return 'Уже поздно. Сон помогает запоминать: сегодня лучше отдохнуть, продолжим утром.'
  if (d.deadline.kind === 'hw') return `Учитель выдал работу: «${d.deadline.title}». Начнём с неё?`
  if (d.today.rest) return 'Сегодня по расписанию отдых. Можно просто погулять.'
  const b = d.today.blocks
  return `На сегодня ${b.length} ${plural(b.length, 'блок', 'блока', 'блоков')}, всего ${b.reduce((a, x) => a + x.min, 0)} минут. Начнём с «${b[0]?.title}»?`
}

export default function Home() {
  const app = useApp()
  const { dash: d, me } = app
  const [talk, setTalk] = useState(false)
  const greeting = d ? greetLine(d) : ''
  useEffect(() => {
    if (app.voice && greeting) void prepareSpeech(greeting).catch(() => {})
  }, [app.voice, greeting])
  if (!d) return <p className="muted">Загружаю…</p>
  const ex = d.exam
  return (
    <>
      <section className="greet" aria-label="Приветствие">
        <button className="greet-star" onClick={() => app.say(greeting)} aria-label="Поговорить со Звёздочкой"><StarBot size={80} talk={talk} /></button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p className="muted">{me.grade ? `${me.grade} класс · ` : ''}{ex.short}</p>
          <h1>{hello()}, {me.name || 'друг'}</h1>
          <Typed className="greet-say tw" text={greeting} speed={24} onTyping={setTalk} />
        </div>
        <Orn />
      </section>
      <Deadline d={d} />
      <div className="row stagger">
        <Hero d={d} />
        <Route d={d} />
      </div>
      <Rises d={d} />
      {(d.redo?.due ?? 0) > 0 && (
        <section className="card redo-cta" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 240px' }}><b>Работа над ошибками: {d.redo!.due} {plural(d.redo!.due, 'задача', 'задачи', 'задач')} на сегодня</b>
            <p className="muted" style={{ fontSize: 13.5 }}>Задачи, где была ошибка. Реши заново: две верные подряд, и ошибка исправлена.</p></div>
          <button className="btn btn-gold" onClick={() => { app.go('practice'); setTimeout(() => document.getElementById('redo')?.scrollIntoView({ behavior: 'smooth' }), 400) }}>Исправить</button>
        </section>
      )}
      <div className="grid2 stagger">
        {d.diag_done === false ? <DiagOffer open={d.diag_open} mock={d.mock_open} /> : <RootCard d={d} />}
        {d.diag_done !== false && d.mock_open && <MockResume mock={d.mock_open} />}
        <Daily d={d} />
      </div>
      <div className="grid2 stagger">
        <Secret d={d} />
        <Hunt d={d} />
      </div>
    </>
  )
}

function Deadline({ d }: { d: Dashboard }) {
  const app = useApp()
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  const dl = d.deadline
  if (dl.kind === 'hw') {
    const due = new Date(dl.due + (dl.due.endsWith('Z') ? '' : 'Z')).getTime()
    const ms = due - now, late = ms <= 0, urgent = !late && ms < 3 * 3600000
    const s = Math.max(0, Math.floor(ms / 1000))
    const cd = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((v) => String(v).padStart(2, '0')).join(':')
    return (
      <section className={`deadline ${urgent ? 'urgent' : ''}`} aria-label="Дедлайн">
        <span className="clock"><Icon n="clock" s={24} c="#fff" w={2.4} /></span>
        <div className="dl-txt"><span className="label">Дедлайн · от учителя</span><b>{dl.title}</b><span className="muted">{dl.count} задач · сдать до {new Date(due).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</span></div>
        <div className="dl-cd"><span className="num">{late ? 'срок вышел' : s > 86400 ? `${Math.floor(s / 86400)} дн.` : cd}</span><span className="muted">{late ? 'сдайте как можно скорее' : 'осталось'}</span></div>
        <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {dl.task_id && <button className="btn btn-gold" onClick={() => app.go('check')}><Icon n="check" s={18} c="#16231F" />Сдать по фото</button>}
          <button className="btn btn-line" onClick={async () => { await assignmentDone(dl.id); app.toast('Отмечено: работа сдана'); app.reload() }}>Готово</button>
        </span>
      </section>
    )
  }
  return (
    <section className="deadline calm" aria-label="Ближайший срок">
      <span className="clock"><Icon n="flag" s={24} c="#fff" w={2.2} /></span>
      <div className="dl-txt"><span className="label">Ближайший срок</span><b>{dl.title}, {fmtD(dl.date, { weekday: 'long', day: 'numeric', month: 'long' })}</b>
        <span className="muted">{d.exam.pct ? 'до конца учебного года' : 'до экзамена'} {dl.exam_days} {plural(dl.exam_days, 'день', 'дня', 'дней')} · {d.exam.date_note}</span></div>
      <div className="dl-cd"><span className="num">{dl.days_left}</span><span className="muted">{plural(dl.days_left, 'день', 'дня', 'дней')}</span></div>
      <button className="btn btn-line" onClick={() => app.go('plan')}><Icon n="cal" s={18} />Расписание</button>
    </section>
  )
}

function Hero({ d }: { d: Dashboard }) {
  const app = useApp()
  const path = useRef<SVGPathElement | null>(null)
  const svg = useRef<SVGSVGElement | null>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [n, setN] = useState(reduceMotion ? d.forecast : 0)
  useEffect(() => {
    const t0 = performance.now()
    let raf = 0
    const step = (t: number) => {
      const k = reduceMotion ? 1 : Math.min(1, (t - t0) / 1600), e = 1 - Math.pow(1 - k, 3)
      setN(Math.round(d.forecast * e))
      const p = path.current, s = svg.current
      if (p && s) {
        const L = p.getTotalLength(), pt = p.getPointAtLength(L * Math.min(1, d.xp / 8848) * e), r = s.getBoundingClientRect()
        setPos({ x: (pt.x * r.width) / 700, y: (pt.y * r.height) / 170 })
      }
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [d.forecast, d.xp])
  const ex = d.exam
  return (
    <section className="hero" aria-label="Прогноз">
      <div className="snow" aria-hidden="true">{Array.from({ length: 16 }, (_, i) => <i key={i} style={{ left: `${(i * 61) % 100}%`, animationDuration: `${6 + (i % 5) * 1.7}s`, animationDelay: `-${(i * 1.3) % 7}s`, opacity: 0.3 + (i % 4) * 0.15 }} />)}</div>
      <div className="cloud" style={{ top: 30, width: 90, animationDuration: '28s' }} aria-hidden="true" />
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        {d.diag_done === false ? (
          <div><p className="muted">{ex.label}</p>
            <p style={{ fontSize: 18, fontWeight: 800, marginTop: 6, maxWidth: 360 }}>Прогноз появится после диагностики</p>
            <p className="muted" style={{ fontSize: 13.5, marginTop: 4, maxWidth: 380 }}>Без неё нам не на чем его посчитать. Это около 40 минут, можно с паузами.</p></div>
        ) : (
          <div><p className="muted">{ex.label}</p>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}><span className="hero-score num">{n}</span><span className="muted">{ex.pct ? '%' : `из ${ex.max}`}</span></div></div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {d.diag_done === false
            ? <button className="btn btn-sm btn-gold" onClick={() => dispatchEvent(new Event('everest:diag'))}>{d.diag_open ? 'Продолжить диагностику' : 'Пройти диагностику'}</button>
            : <>
              <button className="btn btn-sm btn-gold" onClick={() => app.openModal('Как считается прогноз', <Forecast d={d} />, true)}>Как считается</button>
              <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,.1)', color: 'var(--on-em)' }} onClick={() => app.go({ v: 'task', id: String(rootTaskN(d) ?? 1) })}>Что поднимет балл</button>
              <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,.1)', color: 'var(--on-em)' }} onClick={() => app.go('diag')}>Разбор диагностики</button>
            </>}
        </div>
      </div>
      <div className="ridge-wrap">
        <svg ref={svg} viewBox="0 0 700 170" width="100%" role="img" aria-label={`Путь к вершине: высота ${d.xp} метров, ${d.stage.current}`} style={{ display: 'block', overflow: 'visible' }}>
          <path d="M0 170 L0 150 L60 125 L110 138 L180 98 L220 112 L300 76 L350 90 L430 52 L480 68 L560 18 L620 46 L700 34 L700 170 Z" fill="var(--hero-2)" />
          <path d="M0 170 L0 158 L90 142 L160 154 L250 124 L330 138 L420 104 L520 122 L610 92 L700 108 L700 170 Z" fill="var(--hero-3)" opacity={0.6} />
          <path ref={path} d="M0 150 L60 125 L110 138 L180 98 L220 112 L300 76 L350 90 L430 52 L480 68 L560 18" fill="none" stroke="var(--gold)" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
          <line x1={560} y1={18} x2={560} y2={-8} stroke="#fff" strokeWidth={2} /><path d="M560 -8 L582 -1 L560 6 Z" fill="var(--gold)" />
          <text x={590} y={4} fontSize={14} fontWeight={800} fill="var(--gold-hi)">8848 м</text>
          {[[180, 98, 'Этап 1'], [300, 76, 'Этап 2'], [430, 52, 'Этап 3'], [480, 68, 'Этап 4']].map(([x, y, l], i) => (
            <g key={i}><circle cx={x} cy={y} r={5} fill="#fff" /><text x={x} y={(y as number) + 24} textAnchor="middle" fontSize={12} fontWeight={700} fill="var(--on-em-muted)">{l}</text></g>
          ))}
        </svg>
        <div className="climber" style={{ left: pos.x, top: pos.y }} />
      </div>
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', fontSize: 13, flexWrap: 'wrap', gap: 6 }} className="muted">
        <span>Вы на высоте <b className="num" style={{ color: 'var(--on-em)' }}>{d.xp.toLocaleString('ru-RU')} м</b> · {d.stage.current}</span><span>до «{d.stage.next}» {d.stage.left.toLocaleString('ru-RU')} м</span>
      </div>
    </section>
  )
}

export function Forecast({ d }: { d: Dashboard }) {
  const ex = d.exam, E = Object.fromEntries(d.model.nodes.map((n) => [n.id, n]))
  return (
    <>
      <p className="muted">Для каждого {ex.pct ? 'раздела' : 'задания'} берём результат диагностики и проверок (вес 60%) и освоение самой слабой нужной темы (вес 40%). Умножаем на максимум и складываем. Все числа из твоих ответов.</p>
      <div style={{ overflowX: 'auto', marginTop: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, minWidth: 380 }}>
          <thead><tr style={{ textAlign: 'left', color: 'var(--muted)' }}><th style={{ padding: 6 }}>{ex.pct ? 'Раздел' : 'Задание'}</th><th>Диагностика</th><th>Слабейшая тема</th><th className="num">Ожидаемо</th></tr></thead>
          <tbody>{d.model.tasks.map((t) => {
            const w = t.need.reduce((a, k) => (E[k].m < E[a].m ? k : a), t.need[0]), wn = E[w]
            const cls = wn.unknown ? 'p-gold' : wn.m < 0.5 ? 'p-bad' : wn.m < 0.8 ? 'p-gold' : 'p-em'
            return (
              <tr key={t.id} style={{ borderTop: '1px solid var(--line)' }}>
                <td style={{ padding: '8px 6px' }}><b>{taskLabel(t)}</b> · {t.max} б.</td>
                <td className="num">{t.obs == null ? '-' : Math.round(t.obs * 100) + '%'}</td>
                <td><span className={`pill ${cls}`}>{wn.name} {wn.unknown ? '?' : Math.round(wn.m * 100) + '%'}</span></td>
                <td className="num"><b>{fmt1(t.exp)}</b></td>
              </tr>
            )
          })}</tbody>
        </table>
      </div>
      <p style={{ marginTop: 12, fontWeight: 800 }}>Итого: {d.forecast}{ex.pct ? '%' : ' из ' + ex.max}</p>
      {!ex.pct && <p className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>Перевод в тестовые баллы делается по официальной шкале ФИПИ текущего года.</p>}
    </>
  )
}

function Route({ d }: { d: Dashboard }) {
  const app = useApp()
  const blocks: (PlanBlock | null)[] = d.today.rest ? [] : d.today.blocks.slice(0, 3)
  const done = blocks.filter((b) => b && b.done).length
  const cur = blocks.findIndex((b) => b && !b.done)
  return (
    <section className="card" style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 10 }} aria-label="Маршрут на сегодня">
      <div className="card-h" style={{ margin: 0 }}><h2>Маршрут на сегодня{d.today.time ? ` · ${d.today.time}` : ''}</h2><span className="muted num">{done} из {blocks.length || 0}</span></div>
      <div className="bar"><i style={{ width: `${blocks.length ? (done / blocks.length) * 100 : 0}%`, background: 'var(--em)' }} /></div>
      <RouteNote basis={d.route_basis} exam={d.exam} stage={d.path_stage} />
      {(d.today.events ?? []).map((e) => <div key={e.id} className={`pev ${e.kind}`}><b>{e.start ? `${e.start} ` : ''}{e.title}</b>{e.min ? <small>{e.min} мин</small> : null}</div>)}
      {d.today.busy && <div className="item" style={{ cursor: 'default' }}><Icon n="cal" /><span style={{ flex: 1 }}><span className="t-strong">Сегодня день занят</span><span className="t-sub">математика перенесена на следующий день</span></span><button className="btn btn-sm btn-line" onClick={() => app.go('plan')}>Неделя</button></div>}
      {d.today.rest && <div className="item" style={{ cursor: 'default' }}><Icon n="moon" /><span style={{ flex: 1 }}><span className="t-strong">Сегодня отдых</span><span className="t-sub">выходной день в расписании</span></span><button className="btn btn-sm btn-line" onClick={() => app.go('plan')}>Неделя</button></div>}
      {blocks.map((b, i) => b && (
        <div key={b.key} className={`item ${i === cur ? 'current' : ''}`} style={{ cursor: 'default' }}>
          <button className={`tick ${b.done ? 'on' : ''}`} aria-pressed={!!b.done} aria-label={`Отметить: ${b.title}`} onClick={async () => {
            const r = await togglePlanBlock(b.key!)
            if (r.done) app.toast('+30 м высоты · блок расписания', 'gold')
            app.reload()
          }}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5 L6.8 11.5 L12.5 5" fill="none" stroke={b.done ? 'var(--gold)' : 'transparent'} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <span style={{ flex: 1, minWidth: 0 }}><span className="t-strong" style={b.done ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}>{b.title}</span><span className="t-sub">{b.min} мин · {b.sub}</span></span>
          <button className="btn btn-sm btn-line" onClick={() => blockGo(b, app)}>Открыть</button>
        </div>
      ))}
    </section>
  )
}

function Rises({ d }: { d: Dashboard }) {
  const h = d.history, ex = d.exam, max = ex.pct ? 100 : ex.max
  if (h.length < 2) {
    return (
      <section className="card" aria-label="Взлёты и падения">
        <div className="card-h"><div><h2>Взлёты и падения</h2><p className="muted" style={{ fontSize: 13 }}>{ex.pct ? 'готовность, %' : 'прогноз по замерам'}</p></div></div>
        <p className="muted">{h.length ? `Первая точка: ${h[0].value}${ex.pct ? '%' : ' из ' + ex.max} (${h[0].source}, ${fmtD(h[0].date)}). График появится после следующего замера: пробника из расписания или проверки по фото.` : 'Пройди диагностику, и здесь появится первая точка.'}</p>
      </section>
    )
  }
  const W = 640, H = 236, pl = 34, pr = 18, pt = 34, pb = 30, n = h.length
  const X = (i: number) => pl + (i * (W - pl - pr)) / (n - 1), Y = (v: number) => pt + (1 - v / max) * (H - pt - pb)
  let ups = 0, downs = 0
  const segs = h.slice(1).map((p, j) => {
    const i = j + 1, dv = p.value - h[i - 1].value, up = dv >= 0
    up ? ups++ : downs++
    const x1 = X(i - 1), y1 = Y(h[i - 1].value), x2 = X(i), y2 = Y(p.value), len = Math.hypot(x2 - x1, y2 - y1), del = 0.22 * i
    return (
      <g key={i}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={up ? 'var(--em-3)' : 'var(--red)'} strokeWidth={4} strokeLinecap="round" strokeDasharray={len} strokeDashoffset={reduceMotion ? 0 : len} style={{ animation: `draw .3s ${del}s linear forwards` }} />
        <text x={(x1 + x2) / 2} y={Math.min(y1, y2) - 10} textAnchor="middle" fontSize={12} fontWeight={800} fill={up ? 'var(--em-ink)' : 'var(--red)'} style={{ animation: `fade .3s ${del + 0.25}s both` }}>{up ? '+' : '−'}{Math.abs(dv)}</text>
      </g>
    )
  })
  const demo = h.some((p) => p.source === 'пример')
  return (
    <section className="card" aria-label="Взлёты и падения">
      <div className="card-h"><div><h2>Взлёты и падения</h2><p className="muted" style={{ fontSize: 13 }}>{ex.pct ? 'готовность, %' : 'прогноз, ' + ex.unit + ' баллы'} · {n} {plural(n, 'замер', 'замера', 'замеров')}</p></div>{demo && <span className="pill p-gold">есть точки-примеры</span>}</div>
      <div className="rise-grid">
        <div style={{ minWidth: 0 }}>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Замеры: ${h.map((p) => p.value).join(', ')}`} style={{ display: 'block', overflow: 'visible' }}>
            {[0, 0.25, 0.5, 0.75, 1].map((f) => { const v = Math.round(max * f); return <g key={f}><line x1={pl} x2={W - pr} y1={Y(v)} y2={Y(v)} stroke="var(--line)" strokeDasharray={f ? '3 4' : undefined} /><text x={pl - 8} y={Y(v) + 4} textAnchor="end" fontSize={11} fill="var(--muted)">{v}</text></g> })}
            {segs}
            {h.map((p, i) => <g key={i}><circle cx={X(i)} cy={Y(p.value)} r={5.5} fill="var(--surface)" stroke={i && p.value < h[i - 1].value ? 'var(--red)' : 'var(--em-3)'} strokeWidth={3}><title>{fmtD(p.date)}: {p.value} ({p.source})</title></circle>
              <text x={X(i)} y={H - 8} textAnchor="middle" fontSize={10.5} fill="var(--muted)">{fmtD(p.date, { day: 'numeric', month: 'numeric' })}</text></g>)}
          </svg>
          <div className="rise-legend"><span><i style={{ background: 'var(--em-3)' }} />взлёт · {ups}</span><span><i style={{ background: 'var(--red)' }} />падение · {downs}</span></div>
        </div>
        <div>
          <h3 style={{ marginBottom: 12 }}>Темы: последний замер к предыдущему</h3>
          {d.deltas.length ? d.deltas.map((x, i) => (
            <div className="dbar" key={x.node}><span>{x.name}</span>
              <span className="trk"><i style={{ ...(x.delta >= 0 ? { left: '50%', background: 'var(--em-3)' } : { right: '50%', background: 'var(--red)', transformOrigin: 'right' }), width: `${Math.min(50, (Math.abs(x.delta) / 40) * 50)}%`, animationDelay: `${0.3 + i * 0.12}s` }} /></span>
              <b className="num" style={{ color: x.delta >= 0 ? 'var(--em-ink)' : 'var(--red)' }}>{x.delta > 0 ? '+' : '−'}{Math.abs(x.delta)}%</b></div>
          )) : <p className="muted">Между двумя последними замерами темы не изменились.</p>}
        </div>
      </div>
    </section>
  )
}

/** The exam task that suffers most from the root cause (for the task map link); only for the profile exam. */
function rootTaskN(d: Dashboard): number | null {
  if (d.exam.key !== 'prof') return null
  const t = d.model.tasks.find((x) => d.model.root_tasks.includes(x.id) && typeof x.n === 'number')
    ?? [...d.model.tasks].filter((x) => typeof x.n === 'number').sort((a, b) => a.p - b.p)[0]
  return t && typeof t.n === 'number' ? t.n : null
}

function DiagOffer({ open, mock }: { open?: { done: number; total: number } | null; mock?: { done: number; total: number; exam_mode: boolean } | null }) {
  return (
    <section className="card" aria-label="Диагностика" style={{ borderColor: 'var(--gold)', borderWidth: 1.5 }}>
      <span className="pill p-gold">Диагностика</span>
      {open ? <>
        <h2 style={{ fontSize: 19, marginTop: 10 }}>Диагностика на паузе</h2>
        <p className="muted" style={{ marginTop: 8 }}>Сделано {open.done} из {open.total}. Ответы и фото сохранены, продолжишь с того же места.</p>
        <div className="bar" style={{ marginTop: 10 }} aria-hidden="true"><i style={{ width: `${Math.round((open.done / open.total) * 100)}%`, background: 'var(--gold)' }} /></div>
        <button className="btn btn-em" style={{ marginTop: 14 }} onClick={() => dispatchEvent(new Event('everest:diag'))}>Продолжить диагностику</button>
      </> : <>
        <h2 style={{ fontSize: 19, marginTop: 10 }}>Узнай свой прогноз и слабое место</h2>
        <p className="muted" style={{ marginTop: 8 }}>Задания из демоверсии: по ответам посчитаем прогноз, найдём, где теряются баллы, и подстроим расписание. Её можно поставить на паузу.</p>
        <button className="btn btn-em" style={{ marginTop: 14 }} onClick={() => dispatchEvent(new Event('everest:diag'))}>Начать диагностику</button>
      </>}
      {mock && <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
        <b>Пробник не завершён</b>
        <p className="muted" style={{ marginTop: 5 }}>{mock.done} из {mock.total} заданий · {mock.exam_mode ? 'экзаменационный режим: таймер продолжает идти' : 'обычный режим'}</p>
        <button className="btn btn-line" style={{ marginTop: 10 }} onClick={() => dispatchEvent(new Event('everest:mock'))}>Продолжить пробник</button>
      </div>}
    </section>
  )
}

function MockResume({ mock }: { mock: { done: number; total: number; exam_mode: boolean } }) {
  return (
    <section className="card" aria-label="Незавершённый пробник">
      <span className="pill p-gold">Пробник</span>
      <h2 style={{ fontSize: 19, marginTop: 10 }}>Пробник не завершён</h2>
      <p className="muted" style={{ marginTop: 8 }}>{mock.done} из {mock.total} заданий · {mock.exam_mode ? 'экзаменационный режим: таймер продолжает идти' : 'обычный режим'}</p>
      <button className="btn btn-em" style={{ marginTop: 14 }} onClick={() => dispatchEvent(new Event('everest:mock'))}>Продолжить пробник</button>
    </section>
  )
}

function Analysis() {
  const app = useApp()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(true)
  useEffect(() => {
    mapAnalysis().then((r) => { setText(r.text); app.reload() }).catch((e) => setText(String(e).replace('Error: ', ''))).finally(() => setBusy(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return busy ? <div className="typing" aria-label="Думаю"><i /><i /><i /></div> : <div className="ai-out"><Md text={text} /></div>
}

function RootCard({ d }: { d: Dashboard }) {
  const app = useApp()
  const M = d.model, ex = d.exam, nodes = Object.fromEntries(M.nodes.map((n) => [n.id, n]))
  const root = M.root ? nodes[M.root] : null
  const rootTasks = M.tasks.filter((t) => M.root_tasks.includes(t.id))
  const title = !root ? 'Явной первопричины нет: все проверенные темы выше 50%'
    : M.basics ? `Почти все задания пока не получились: начинаем с основ, с темы «${root.name}»`
    : ex.pct ? `«${root.name}» тянет вниз ${rootTasks.length} ${plural(rootTasks.length, 'тему', 'темы', 'тем')}`
      : `Около ${fmt1(M.at_risk)} ${ex.unit === 'б.' ? 'баллов' : 'первичных баллов'} теряется из-за темы «${root.name}»`
  return (
    <section className="card" aria-label="Первопричина" style={{ borderColor: 'var(--bad)', borderWidth: 1.5 }}>
      <div className="card-h"><span className="pill p-bad">Первопричина</span><span className="muted" style={{ fontSize: 13 }}>{d.history.length ? `по ${d.history.length} ${plural(d.history.length, 'замеру', 'замерам', 'замерам')}` : 'пока нет замеров'}</span></div>
      <h2 style={{ fontSize: 19 }}>{title}</h2>
      <p className="muted" style={{ marginTop: 8 }}>{root && M.basics
        ? <>Когда не получилось почти ничего, выбирать «главную» слабую тему наугад нечестно. Начинаем с базовых тем по порядку, расписание идёт от лёгкого к сложному.</>
        : root
        ? <>Слабое место: <b style={{ color: 'var(--ink)' }}>{root.name}</b> ({Math.round(root.m * 100)}%). От неё зависят: {rootTasks.slice(0, 8).map(taskLabel).join(', ') || 'задания выше по карте'}.</>
        : 'Продолжай по расписанию: оно уже чередует задания так, чтобы ничего не забылось.'}</p>
      {root && !M.basics && <p style={{ marginTop: 10, fontWeight: 700 }}>Закрыть пробел: примерно <span style={{ color: 'var(--em-ink)' }}>+{ex.pct ? Math.round((d.gain / ex.max) * 100) + '%' : fmt1(d.gain)}</span> к прогнозу</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
        {rootTaskN(d) != null && <button className="btn btn-em" onClick={() => { sendEvent('ach', 'root').catch(() => null); app.go({ v: 'task', id: String(rootTaskN(d)) }) }}>Карта задания № {rootTaskN(d)}</button>}
        <button className="btn btn-line" onClick={() => app.openModal('Подробный разбор пробелов', <Analysis />, true)}>Подробный разбор</button>
      </div>
    </section>
  )
}

function Daily({ d }: { d: Dashboard }) {
  const app = useApp()
  const [hints, setHints] = useState(d.daily.hints)
  const [msg, setMsg] = useState('')
  const [shake, setShake] = useState(false)
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const v = String(new FormData(e.currentTarget).get('a') || '').trim()
    if (!v) return
    const r = await dailyAnswer(v)
    if (r.ok) { app.toast('+150 м высоты · задача дня', 'gold'); app.confetti(180); app.reload() }
    else { setMsg(r.message); setShake(true); setTimeout(() => setShake(false), 500) }
  }
  return (
    <section className="daily" aria-label="Задача дня">
      <div className="card-h" style={{ marginBottom: 8 }}><span className="label">Задача дня · +150 м</span><span className="pill p-gold">{d.model.nodes.find((n) => n.id === d.daily.node)?.name}</span></div>
      {d.daily.done ? (<><h2>Решено! Завтра будет новая.</h2><p className="muted" style={{ marginTop: 6 }}>{d.daily.sol}</p></>) : (
        <>
          <p style={{ fontWeight: 700, fontSize: 16 }}>{d.daily.q}</p>
          <form onSubmit={submit} style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <label htmlFor="dailyIn" className="sr">Ответ</label>
            <input id="dailyIn" name="a" className="input" style={{ flex: '1 1 140px', animation: shake ? 'shake .45s' : undefined }} placeholder="Ответ, например 0,5" inputMode="text" autoComplete="off" />
            <button className="btn btn-em" type="submit">Проверить</button>
          </form>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
            {hints.length < d.daily.hint_count && <button className="btn btn-sm btn-ghost" onClick={async () => setHints((await dailyHint()).hints)}><Icon n="bulb" s={16} />Подсказка ({hints.length + 1} из {d.daily.hint_count})</button>}
            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--bad-ink)' }}>{msg}</span>
          </div>
          {hints.length > 0 && <p className="muted" style={{ marginTop: 8, fontSize: 13.5 }}>{hints.map((h, i) => <span key={i}>{h}<br /></span>)}</p>}
        </>
      )}
    </section>
  )
}

function Secret({ d }: { d: Dashboard }) {
  const app = useApp()
  const ready = !d.chest && (d.daily.done || d.today.blocks.filter((b) => b.done).length >= 2)
  const [shake, setShake] = useState(false)
  return (
    <section className="card" style={{ display: 'flex', gap: 16, alignItems: 'center' }} aria-label="Секрет Звёздочки">
      <button className={`chest ${d.chest ? '' : ready ? 'ready' : 'locked'}`} style={shake ? { animation: 'shake .45s' } : undefined} aria-label={d.chest ? 'Секрет открыт' : ready ? 'Открыть секрет' : 'Секрет закрыт'} onClick={async () => {
        if (d.chest) { app.toast('Секрет уже открыт: лайфхак на карточке'); return }
        try { await sendEvent('chest'); app.toast('+100 м высоты · секрет Звёздочки', 'gold'); app.confetti(160); app.reload() }
        catch { app.toast('Закройте 2 пункта маршрута или решите задачу дня'); setShake(true); setTimeout(() => setShake(false), 460) }
      }}>
        <svg width="50" height="50" viewBox="0 0 24 24" aria-hidden="true">
          <path d={STAR_D} fill={d.chest ? 'var(--gold)' : '#3E8A70'} stroke={d.chest ? '#fff' : 'var(--gold)'} strokeWidth={1.2} strokeLinejoin="round" />
          {!d.chest && <><rect x="10" y="11" width="4" height="4" rx="1" fill="var(--gold)" /><path d="M10.8 11v-1.2a1.2 1.2 0 0 1 2.4 0V11" fill="none" stroke="var(--gold)" strokeWidth={1} /></>}
        </svg>
      </button>
      <div style={{ minWidth: 0 }}><span className="label">Секрет Звёздочки</span>
        <p style={{ fontWeight: 700, marginTop: 4 }}>{d.chest ? 'Лайфхак: проверяйте отбор корней подстановкой k = −1, 0, 1. Почти все ответы на отрезке длиной меньше 2π находятся среди них.' : ready ? 'Секрет можно открыть! Нажми на звезду.' : 'Откроется, когда закроешь 2 пункта маршрута или решишь задачу дня.'}</p></div>
    </section>
  )
}

const HUNT = ['2sin²x − 3sin x + 1 = 0', 't = sin x:  2t² − 3t + 1 = 0', 'D = 9 − 8 = 1,  t = 1 или t = 1/2', 'sin x = 1/2  ⇒  x = π/6 + 2πk', 'sin x = 1  ⇒  x = π/2 + 2πk']
function HuntBody() {
  const app = useApp()
  const [wrong, setWrong] = useState(-1)
  const [found, setFound] = useState(false)
  return (
    <>
      <p className="muted">Нажмите на строку, где спряталась ошибка.</p>
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {HUNT.map((l, i) => (
          <button key={i} className={`code-line ${found && i === 3 ? 'found' : ''} ${wrong === i ? 'wrong' : ''}`} onClick={async () => {
            if (i === 3) { setFound(true); setWrong(-1); const r = await sendEvent('hunt').catch(() => null); if (r) app.toast('+200 м высоты · ошибка найдена', 'gold'); app.confetti(); app.reload() }
            else { setWrong(-1); setTimeout(() => setWrong(i), 10) }
          }}>{l}</button>
        ))}
      </div>
      <p style={{ marginTop: 12, fontWeight: 700 }} aria-live="polite">{found ? 'Точно! У sin x = 1/2 две серии: π/6 + 2πk и 5π/6 + 2πk. Вторую потеряли.' : wrong >= 0 ? 'Эта строка верная. Посмотрите внимательнее, сколько серий корней у sin x = 1/2.' : ''}</p>
    </>
  )
}
function Hunt({ d }: { d: Dashboard }) {
  const app = useApp()
  return (
    <section className="card" style={{ display: 'flex', gap: 16, alignItems: 'center' }} aria-label="Охота на ошибку">
      <div style={{ width: 84, height: 84, borderRadius: 22, background: 'var(--bad-soft)', display: 'grid', placeItems: 'center', flex: 'none' }}>
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--bad)" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /><path d="M11 8v3" /><path d="M11 14h.01" /></svg>
      </div>
      <div style={{ minWidth: 0, flex: 1 }}><span className="label">Охота на ошибку · +200 м</span>
        <p style={{ fontWeight: 700, marginTop: 4 }}>{d.hunt ? 'Пройдено. Можно посмотреть ещё раз.' : 'В этом решении спряталась одна ошибка. Найдёте?'}</p>
        <button className={`btn btn-sm ${d.hunt ? 'btn-ghost' : 'btn-em'}`} style={{ marginTop: 10 }} onClick={() => app.openModal('Охота на ошибку', <HuntBody />)}>{d.hunt ? 'Посмотреть ещё раз' : 'Начать охоту'}</button></div>
    </section>
  )
}
