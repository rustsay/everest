import SolutionBoard from '../components/SolutionBoard'
import { sendEvent } from '../api/client'
import { useApp } from '../app/store'
import { plural } from '../design/ui'
import { VTASK } from './videoData'
import GeneratedVideos from '../components/GeneratedVideos'

/** «Разборы»: 19 folders; inside each a board where Звёздочка writes the solution and explains it. */
export default function Videos() {
  const app = useApp()
  const n = app.view.id ? +app.view.id : 0
  if (app.view.id?.startsWith('custom-')) return <GeneratedVideos detailId={app.view.id.slice(7)} />
  if (n >= 1 && n <= 19) return <Board key={n} n={n} />
  const done = app.dash?.vdone ?? {}
  const cnt = Object.keys(done).length
  const folder = (k: number) => {
    const v = VTASK[k], p2 = k >= 13, ok = done[String(k)]
    return (
      <button key={k} className={`folder ${p2 ? 'p2' : ''} ${ok ? 'ok' : ''}`} onClick={() => app.go({ v: 'video', id: String(k) })} style={{ animation: `rise .35s ${(k * 0.025).toFixed(3)}s both` }}>
        <svg width="44" height="34" viewBox="0 0 40 32" aria-hidden="true">
          <path d="M2 6a3 3 0 0 1 3-3h10l4 4h16a3 3 0 0 1 3 3v17a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3z" fill={p2 ? 'var(--gold-soft)' : 'var(--em-soft)'} stroke={p2 ? 'var(--gold)' : 'var(--em-3)'} strokeWidth={2} />
          <text x="20" y="23" textAnchor="middle" fontSize="12" fontWeight="800" fill={p2 ? 'var(--gold-ink)' : 'var(--em-ink)'}>{k}</text>
        </svg>
        <b>Задание {k}</b><span className="muted">{v.t}</span>
        <span className="f-meta">{ok ? <span className="pill p-em">понял ✓</span> : <span className="muted">{v.s.length} {plural(v.s.length, 'шаг', 'шага', 'шагов')}</span>}</span>
      </button>
    )
  }
  return (
    <>
      <div className="card-h" style={{ margin: 0 }}><div><p className="muted">Видеоразборы</p><h1>Разборы всех заданий</h1></div><span className="pill p-em num">понял {cnt} из 19</span></div>
      <GeneratedVideos />
      <div className="bar" style={{ height: 10 }}><i style={{ width: `${(cnt / 19) * 100}%`, background: 'var(--em-3)' }} /></div>
      <section><h2 style={{ marginBottom: 12 }}>Часть 1 · задания 1-12</h2><div className="folders">{Array.from({ length: 12 }, (_, i) => folder(i + 1))}</div></section>
      <section><h2 style={{ marginBottom: 12 }}>Часть 2 · задания 13-19</h2><div className="folders">{Array.from({ length: 7 }, (_, i) => folder(i + 13))}</div></section>
      <p className="muted" style={{ fontSize: 12.5 }}>Разборы собраны на типовых задачах в формате ЕГЭ. Звёздочка пишет на доске и рассказывает. Голос включается в её пузыре.</p>
    </>
  )
}

function Board({ n }: { n: number }) {
  const app = useApp()
  const v = VTASK[n]
  return <SolutionBoard n={n} task={v} onBack={() => app.go('video')} onUnderstood={async () => {
    const first = !app.dash?.vdone?.[String(n)]
    await sendEvent('video', String(n)).catch(() => null)
    if (first) app.toast(`+40 м высоты · разбор задания ${n} понят`, 'gold')
    app.reload()
    if (n < 19) { app.go({ v: 'video', id: String(n + 1) }); app.toast(`Задание ${n + 1}: ${VTASK[n + 1].t}`) } else { app.go('video'); app.confetti() }
  }} onNotUnderstood={(step) => app.go({ v: 'chat', id: `Разбор задания ${n} («${v.t}»). Условие: ${v.c} Не понял шаг «${step[0]}»: ${step[1].join('; ')}. Объясни по-другому и начни с вопроса ко мне.` })} />
}