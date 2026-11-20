import { useEffect, useState } from 'react'
import { editMyPath, getMyPath } from '../api/client'
import { useApp } from '../app/store'
import { Icon, fmtD, plural } from '../design/ui'
import type { MyPath, PathStage } from '../types'

/** What each module of the methodology needs before it (mirror of backend learning/method.py MODULES[...]["req"]). */
const REQ: Record<string, string[]> = {
  T15: ['P1', 'T13'], T16: ['P1', 'T13'], T17: ['P1', 'T13', 'T15', 'T16'], T19: ['P1', 'T13', 'T15', 'T16'],
  T18: ['P1', 'T13', 'T15', 'T16'], T14: ['P1', 'T13', 'T15', 'T16'],
}
const DAY = 86400000
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
const ms = (d: string) => Date.parse(d + 'T00:00:00Z')
const weeksOf = (s: PathStage) => Math.max(1, Math.round((ms(s.to) - ms(s.from) + DAY) / (7 * DAY)))

/** Dates again: stages one after another from the start of the first one, each its number of weeks; the last one runs to the exam. */
function redate(stages: PathStage[], weeks: number[], end: string): PathStage[] {
  let t = ms(stages[0].from)
  return stages.map((s, i) => {
    const last = i === stages.length - 1 && s.module === 'REV'
    const to = last ? Math.max(t, ms(end)) : t + weeks[i] * 7 * DAY - DAY
    const out = { ...s, from: iso(t), to: iso(to), weeks: last ? undefined : weeks[i] }
    t = to + DAY
    return out
  })
}

function orderError(stages: PathStage[]): string {
  const pos: Record<string, number> = {}
  stages.forEach((s, i) => { if (s.module) pos[s.module] = i })
  for (const [m, i] of Object.entries(pos)) {
    for (const r of REQ[m] ?? []) {
      if (pos[r] !== undefined && pos[r] > i) return `«${stages[i].title}» нельзя ставить раньше «${stages[pos[r]].title}»`
    }
  }
  return ''
}

/** In the schedule: the stages of the trajectory as a strip. The student changes the length of a module, its order (the
 * methodology's requirements are checked) and puts a pause (holidays). On his own the change works at once; in a class it
 * goes to the teacher, like any edit of the trajectory. */
export default function PathStagesEdit({ onChanged }: { onChanged: () => void }) {
  const app = useApp()
  const [mp, setMp] = useState<MyPath | null>(null)
  const [st, setSt] = useState<PathStage[] | null>(null)
  const [wk, setWkArr] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const load = () => getMyPath().then((m) => { setMp(m); setSt(null) }).catch(() => setMp(null))
  useEffect(() => { load() }, [])
  if (!mp) return null
  const base = mp.pending ?? mp.active ?? mp.class_path
  if (!base) {
    return (
      <section className="card"><h2>Этапы траектории</h2>
        <p className="muted" style={{ marginTop: 4 }}>Траектории пока нет. Её можно собрать, тогда расписание пойдёт по этапам.</p>
        <button className="btn btn-sm btn-line" style={{ marginTop: 8 }} onClick={() => app.go('path')}><Icon n="flag" s={16} />К траектории</button>
      </section>
    )
  }
  const orig = base.data.stages
  const cur = st ?? orig
  const weeks = st ? wk : orig.map(weeksOf)
  const end = base.data.end
  const today = new Date().toISOString().slice(0, 10)
  const err = orderError(cur)
  const tooLong = cur.length > 1 && cur[cur.length - 1].module === 'REV' && ms(cur[cur.length - 2].to) >= ms(end)
  const change = (stages: PathStage[], w: number[]) => { setSt(redate(stages, w, end)); setWkArr(w) }
  const move = (i: number, d: number) => {
    const j = i + d
    if (j < 0 || j >= cur.length || cur[j].module === 'REV' || cur[i].module === 'REV') return
    const s = [...cur], w = [...weeks];
    [s[i], s[j]] = [s[j], s[i]]; [w[i], w[j]] = [w[j], w[i]]
    change(s, w)
  }
  const resize = (i: number, d: number) => { const w = [...weeks]; w[i] = Math.max(1, Math.min(20, w[i] + d)); change(cur, w) }
  const pause = (i: number) => {
    const next = cur[i + 1] ?? cur[i]
    const p: PathStage = { title: 'Пауза', from: cur[i].to, to: cur[i].to, goal: 'Отдых: математики в эти дни нет', check: '', tasks: next.tasks.slice(0, 12), steps: [], module: 'PAUSE' }
    change([...cur.slice(0, i + 1), p, ...cur.slice(i + 1)], [...weeks.slice(0, i + 1), 1, ...weeks.slice(i + 1)])
  }
  const drop = (i: number) => change(cur.filter((_, k) => k !== i), weeks.filter((_, k) => k !== i))
  const save = async () => {
    if (!st || err) return
    setBusy(true)
    try {
      const r = await editMyPath(st, 'Изменено в расписании: длина, порядок этапов или пауза')
      app.toast(r.status === 'pending' ? 'Изменения отправлены учителю на утверждение' : 'Траектория и расписание обновлены')
      await load()
      onChanged()
    } catch (e) { app.toast(String(e).replace('Error: ', '')) }
    setBusy(false)
  }
  const locked = cur.length >= 8
  return (
    <section className="card">
      <div className="card-h"><h2>Этапы траектории</h2>
        {mp.pending && <span className="pill p-gold">ждёт утверждения учителем</span>}
        {!mp.pending && !mp.active && mp.class_path && <span className="pill p-em">траектория класса</span>}</div>
      <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>Можно поменять длину этапа, порядок и поставить паузу на каникулы.
        {mp.mode === 'class' ? ' Ты в классе: изменения уйдут учителю, пока он не утвердит, действует прежний вариант.' : ' Расписание сразу пересоберётся.'}</p>
      <ol className="pse">{cur.map((s, i) => {
        const now = s.from <= today && today <= s.to
        const rev = s.module === 'REV'
        return (
          <li key={i + s.title} className={`pse-i ${now ? 'cur' : ''} ${s.module === 'PAUSE' ? 'pause' : ''}`}>
            <div className="pse-t"><b>{s.title}</b>
              <small className="muted num">{fmtD(s.from, { day: 'numeric', month: 'short' })} - {fmtD(s.to, { day: 'numeric', month: 'short' })}
                {!rev ? ` · ${weeks[i]} ${plural(weeks[i], 'неделя', 'недели', 'недель')}` : ' · до экзамена'}{s.hours ? ` · ${s.hours} ч` : ''}</small></div>
            {!rev && (
              <div className="pse-b">
                <button className="iconbtn sm" onClick={() => resize(i, -1)} disabled={weeks[i] <= 1} aria-label={`Короче: ${s.title}`}>−</button>
                <button className="iconbtn sm" onClick={() => resize(i, 1)} aria-label={`Длиннее: ${s.title}`}>+</button>
                <button className="iconbtn sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Раньше: ${s.title}`}><Icon n="prev" s={14} /></button>
                <button className="iconbtn sm" onClick={() => move(i, 1)} disabled={i + 1 >= cur.length || cur[i + 1].module === 'REV'} aria-label={`Позже: ${s.title}`}><Icon n="next" s={14} /></button>
                {s.module === 'PAUSE'
                  ? <button className="btn btn-sm btn-ghost" onClick={() => drop(i)}>Убрать паузу</button>
                  : !locked && <button className="btn btn-sm btn-ghost" onClick={() => pause(i)} title="Пауза после этого этапа"><Icon n="moon" s={14} />Пауза после</button>}
              </div>
            )}
          </li>
        )
      })}</ol>
      {err && <p className="auth-msg">{err}. По методике сначала идут модули, которые нужны для следующего.</p>}
      {!err && tooLong && <p className="wd-warn">Этапы не помещаются до экзамена: последние будут обрезаны. Сократи этапы или добавь часы в день.</p>}
      {st && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-em" disabled={busy || !!err} onClick={save}>{mp.mode === 'class' ? 'Отправить учителю' : 'Сохранить'}</button>
          <button className="btn btn-ghost" disabled={busy} onClick={() => setSt(null)}>Отменить</button>
        </div>
      )}
    </section>
  )
}
