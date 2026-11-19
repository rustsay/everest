import { useEffect, useMemo, useState } from 'react'
import { adminStats, adminUsers } from '../api/client'
import { fmtD } from '../design/ui'
import type { AdminStats, AdminUser } from '../types'

const ROLE: Record<string, string> = { student: 'Ученик', teacher: 'Учитель', tutor: 'Репетитор' }
const EXAM: Record<string, string> = { prof: 'профиль', base: 'база', oge: 'ОГЭ', none: 'без экзамена' }

/** #admin: how the platform is used. Only for emails from ADMIN_EMAILS. */
export default function Admin() {
  const [days, setDays] = useState(30)
  const [s, setS] = useState<AdminStats | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { setS(null); adminStats(days).then(setS).catch((e) => setErr(String(e).replace('Error: ', ''))) }, [days])
  if (err) return <section className="card"><p className="muted">{err}</p></section>
  if (!s) return <p className="muted">Считаю статистику…</p>
  const u = s.users
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}><p className="muted">{fmtD(s.from)} - {fmtD(s.today)}</p><h1>Админка</h1></div>
        <div className="seg" role="group" aria-label="Период">{[7, 30, 90].map((d) => <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}>{d} дней</button>)}</div>
      </div>

      <section className="card">
        <h2>Пользователи</h2>
        <div className="da-sum" style={{ marginTop: 10 }}>
          <div><span className="label">Всего</span><b className="num">{u.total}</b><small className="muted">учеников {u.students}, учителей {u.teachers}, репетиторов {u.tutors}</small></div>
          <div><span className="label">Сегодня заходили</span><b className="num">{s.active.today}</b></div>
          <div><span className="label">За 7 дней</span><b className="num">{s.active.week}</b><small className="muted">{pct(s.active.week, u.total)} от всех</small></div>
          <div><span className="label">За {s.days} дней</span><b className="num">{s.active.period}</b></div>
          <div><span className="label">Новых за 7 дней</span><b className="num">{u.new7}</b><small className="muted">за {s.days} дней: {u.new}</small></div>
          <div><span className="label">Уведомления включены</span><b className="num">{u.push}</b></div>
          <div><span className="label">Учеников в классах</span><b className="num">{u.in_class}</b></div>
        </div>
        {u.demo > 0 && <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>Демо-входы не считаются: их {u.demo}.</p>}
      </section>

      <section className="card">
        <h2>Заходили по дням</h2>
        <p className="muted" style={{ fontSize: 13 }}>Сколько разных людей открыли платформу в этот день</p>
        <Bars data={s.series.map((d) => ({ date: d.date, v: d.active, sub: `учеников ${d.students}` }))} unit="чел." />
        <h2 style={{ marginTop: 18 }}>Регистрации по дням</h2>
        <Bars data={s.series.map((d) => ({ date: d.date, v: d.new }))} unit="новых" small />
        <details style={{ marginTop: 10 }}><summary className="muted" style={{ cursor: 'pointer', fontSize: 13 }}>Таблица по дням</summary>
          <div className="stu-tw" style={{ marginTop: 8 }}><table className="stu-t">
            <thead><tr><th>День</th><th>Заходили</th><th>Из них учеников</th><th>Новых</th></tr></thead>
            <tbody>{[...s.series].reverse().map((d) => <tr key={d.date}><td>{fmtD(d.date)}</td><td className="num">{d.active}</td><td className="num">{d.students}</td><td className="num">{d.new}</td></tr>)}</tbody>
          </table></div>
        </details>
      </section>

      <section className="card">
        <h2>Путь ученика</h2>
        <p className="muted" style={{ fontSize: 13 }}>Все ученики за всё время: на каком шаге отсеиваются</p>
        <div className="adm-funnel">{s.funnel.map((f) => (
          <div key={f.name} className="adm-row">
            <span className="adm-name">{f.name}</span>
            <span className="adm-track"><span className="adm-fill" style={{ width: `${s.funnel[0].value ? (100 * f.value) / s.funnel[0].value : 0}%` }} /></span>
            <b className="num">{f.value}</b><small className="muted num" style={{ width: 44, textAlign: 'right' }}>{pct(f.value, s.funnel[0].value)}</small>
          </div>
        ))}</div>
      </section>

      <section className="card">
        <h2>Разделы</h2>
        <p className="muted" style={{ fontSize: 13 }}>Сколько людей открывали раздел. Учёт идёт с момента обновления сайта.</p>
        {s.sections.length === 0 ? <p className="muted" style={{ marginTop: 8 }}>Пока нет данных.</p> : (
          <div className="stu-tw" style={{ marginTop: 10 }}><table className="stu-t">
            <thead><tr><th>Раздел</th><th>Людей за 7 дней</th><th>За {s.days} дней</th><th>Запросов за {s.days} дней</th></tr></thead>
            <tbody>{s.sections.map((r) => <tr key={r.name}><td><b>{r.name}</b></td><td className="num">{r.users7}</td><td className="num">{r.users}</td><td className="num">{r.hits.toLocaleString('ru-RU')}</td></tr>)}</tbody>
          </table></div>
        )}
      </section>

      <section className="card">
        <h2>Что делали за {s.days} дней</h2>
        <div className="stu-tw" style={{ marginTop: 10 }}><table className="stu-t">
          <tbody>{s.actions.map((a) => <tr key={a.name}><td>{a.name}</td><td className="num" style={{ textAlign: 'right' }}><b>{a.value.toLocaleString('ru-RU')}</b></td></tr>)}</tbody>
        </table></div>
        <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>Задачи, проверки и исправленные ошибки считаются по ученикам; эти счётчики хранятся 70 дней.</p>
      </section>

      <Users />
    </>
  )
}

const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '-')

/** Bar chart of one measure by day, with a tooltip on hover or tap. */
function Bars({ data, unit, small }: { data: { date: string; v: number; sub?: string }[]; unit: string; small?: boolean }) {
  const [hi, setHi] = useState<number | null>(null)
  const max = Math.max(1, ...data.map((d) => d.v))
  const h = small ? 70 : 140
  const top = niceTop(max)
  const step = Math.max(1, Math.ceil(data.length / 8))
  return (
    <div className="adm-chart" onMouseLeave={() => setHi(null)}>
      <div className="adm-y" style={{ height: h }}><span className="num">{top}</span><span className="num">0</span></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="adm-plot" style={{ height: h }} role="img" aria-label={`${unit} по дням, максимум ${max}`}>
          <span className="adm-grid" style={{ bottom: '50%' }} /><span className="adm-grid" style={{ bottom: '100%' }} />
          {data.map((d, i) => (
            <button key={d.date} type="button" className="adm-bar" onMouseEnter={() => setHi(i)} onFocus={() => setHi(i)} onClick={() => setHi(i)} aria-label={`${fmtD(d.date)}: ${d.v} ${unit}`}>
              <span style={{ height: `${(100 * d.v) / top}%`, opacity: hi === null || hi === i ? 1 : 0.55 }} />
            </button>
          ))}
          {hi !== null && (
            <div className="adm-tip" style={{ left: `${Math.min(85, Math.max(15, ((hi + 0.5) / data.length) * 100))}%` }}>
              <b>{fmtD(data[hi].date)}</b><br /><span className="num">{data[hi].v}</span> {unit}{data[hi].sub ? <><br /><span className="muted">{data[hi].sub}</span></> : null}
            </div>
          )}
        </div>
        <div className="adm-x">{data.map((d, i) => <span key={d.date}>{i % step === 0 ? fmtD(d.date, { day: 'numeric', month: 'short' }) : ''}</span>)}</div>
      </div>
    </div>
  )
}

function niceTop(m: number): number {
  for (const t of [2, 4, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000]) if (m <= t) return t
  return Math.ceil(m / 10000) * 10000
}

type SortKey = 'last' | 'created' | 'days30' | 'solved' | 'checks'

function Users() {
  const [list, setList] = useState<AdminUser[] | null>(null)
  const [q, setQ] = useState('')
  const [role, setRole] = useState('')
  const [sort, setSort] = useState<SortKey>('last')
  useEffect(() => { adminUsers().then((r) => setList(r.users)).catch(() => setList([])) }, [])
  const rows = useMemo(() => {
    if (!list) return []
    const t = q.trim().toLowerCase()
    return list
      .filter((u) => (!role || u.role === role) && (!t || u.email.toLowerCase().includes(t) || u.name.toLowerCase().includes(t)))
      .sort((a, b) => sort === 'last' || sort === 'created' ? String(b[sort] ?? '').localeCompare(String(a[sort] ?? '')) : b[sort] - a[sort])
  }, [list, q, role, sort])
  if (!list) return <section className="card"><p className="muted">Загружаю пользователей…</p></section>
  return (
    <section className="card">
      <h2>Пользователи <span className="muted num" style={{ fontWeight: 600 }}>{rows.length}</span></h2>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '10px 0' }}>
        <input className="input" style={{ flex: '1 1 200px', width: 'auto' }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Имя или почта" aria-label="Поиск" />
        <select className="input" style={{ flex: '0 1 160px', width: 'auto' }} value={role} onChange={(e) => setRole(e.target.value)} aria-label="Роль">
          <option value="">Все роли</option><option value="student">Ученики</option><option value="teacher">Учителя</option><option value="tutor">Репетиторы</option>
        </select>
        <select className="input" style={{ flex: '0 1 220px', width: 'auto' }} value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Сортировка">
          <option value="last">Последний вход</option><option value="created">Дата регистрации</option><option value="days30">Дней активности</option>
          <option value="solved">Задач решено</option><option value="checks">Проверок по фото</option>
        </select>
      </div>
      <div className="stu-tw"><table className="stu-t">
        <thead><tr><th>Пользователь</th><th>Роль</th><th>Регистрация</th><th>Последний вход</th><th>Дней за 30</th><th>Задач (верно)</th><th>Фото</th><th>Диагн.</th><th>Чаще всего</th></tr></thead>
        <tbody>{rows.slice(0, 300).map((u) => (
          <tr key={u.id}>
            <td><b>{u.name || 'Без имени'}</b><small className="muted" style={{ display: 'block' }}>{u.email}{u.push ? ' · уведомления' : ''}</small></td>
            <td>{ROLE[u.role] ?? u.role}{u.role === 'student' && u.grade ? <small className="muted" style={{ display: 'block' }}>{u.grade} кл., {EXAM[u.exam ?? ''] ?? '-'}</small> : u.classes ? <small className="muted" style={{ display: 'block' }}>классов {u.classes}</small> : null}</td>
            <td className="num">{u.created ? fmtD(u.created) : '-'}</td>
            <td className="num">{u.last ? fmtD(u.last) : 'не было'}</td>
            <td className="num">{u.days30 || '-'}</td>
            <td className="num">{u.solved ? `${u.solved} (${u.ok})` : '-'}</td>
            <td className="num">{u.checks || '-'}</td>
            <td className="num">{u.diags || '-'}</td>
            <td style={{ whiteSpace: 'normal', minWidth: 160 }}><small className="muted">{u.sections.join(', ') || '-'}</small></td>
          </tr>
        ))}</tbody>
      </table></div>
      {rows.length > 300 && <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>Показаны первые 300. Уточните поиск.</p>}
    </section>
  )
}
