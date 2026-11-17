import { useApp } from '../app/store'
import { Orn, StarBot, StarIcon } from '../design/ui'

const STAGES: [number, string][] = [[0, 'Подножие'], [2000, 'Этап 1'], [4000, 'Этап 2'], [6000, 'Этап 3'], [8000, 'Этап 4'], [8848, 'Вершина']]

export default function Stars() {
  const app = useApp()
  const d = app.dash
  if (!d) return <p className="muted">Загружаю…</p>
  const S = d.stars, achN = Object.keys(S.ach).length, eggN = Object.keys(S.eggs).length, days = Math.min(14, d.streak)
  return (
    <>
      <div><p className="muted">Твой подъём</p><h1>Звёзды и высота</h1></div>
      <section className="card stars-hero">
        <div className="sh-l"><button className="greet-star" onClick={() => app.say(`У тебя ${S.total} звёзд. Секретных найдено: ${eggN} из 3.`)} aria-label="Звёздочка"><StarBot size={92} /></button>
          <div><span className="label">Всего звёзд</span><div className="big num">{S.total}</div><p className="muted" style={{ fontSize: 13 }}>за дела: {achN} из {S.achievements.length} · секретные: {eggN} из 3</p></div></div>
        <Orn style={{ marginTop: 16 }} />
      </section>
      <section className="card">
        <div className="card-h"><h2 className="num">{d.xp.toLocaleString('ru-RU')} м · {d.stage.current}</h2><span className="muted">до вершины {Math.max(0, 8848 - d.xp).toLocaleString('ru-RU')} м</span></div>
        <div className="stage-line"><i style={{ width: `${Math.min(100, (d.xp / 8848) * 100)}%` }} />
          {STAGES.map(([m, l]) => <span key={l} className={`stage-dot ${d.xp >= m ? 'on' : ''}`} style={{ left: `${(m / 8848) * 100}%` }}><small>{l}</small></span>)}</div>
        <p className="muted" style={{ fontSize: 13.5 }}>Метры дают за проверку решений, диагностику, задачу дня и блоки расписания. Каждый этап это новый уровень задач.</p>
      </section>
      <section>
        <h2 style={{ marginBottom: 12 }}>Звёзды за дела · {achN} из {S.achievements.length}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 12 }}>
          {S.achievements.map((a) => (
            <button key={a.id} className={`ach ${S.ach[a.id] ? '' : 'locked'}`} style={{ cursor: 'pointer', font: 'inherit', color: 'inherit' }} onClick={() => app.toast(S.ach[a.id] ? `${a.name}: получено` : `Как получить: ${a.desc.toLowerCase()}`)}>
              <span className="medal"><StarIcon s={30} on={!!S.ach[a.id]} /></span><b style={{ fontSize: 13.5 }}>{a.name}</b><span className="muted" style={{ fontSize: 12 }}>{a.desc}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="card">
        <div className="card-h"><h2>Звёзды дней</h2><span className="muted num">{d.streak} дней подряд</span></div>
        <div className="wstars">{Array.from({ length: 14 }, (_, i) => <span key={i} style={{ animationDelay: `${(i * 0.04).toFixed(2)}s` }} title={i < days ? 'занимались' : 'впереди'}><StarIcon s={30} on={i < days} /></span>)}</div>
        <p className="muted" style={{ marginTop: 10, fontSize: 13.5 }}>Каждый день с задачами зажигает звезду.</p>
      </section>
      <section className="card">
        <div className="card-h"><h2>Секретные звёзды</h2><span className="muted num">{eggN} из 3</span></div>
        <div className="eggs">{Object.entries(S.egg_meta).map(([id, m]) => S.eggs[id]
          ? <div key={id} className="egg got"><StarIcon s={34} /><b style={{ fontSize: 13 }}>{m.name}</b></div>
          : <button key={id} className="egg" onClick={() => app.say('Подсказка: ' + m.hint.toLowerCase() + '.')}><StarIcon s={34} on={false} /><b style={{ fontSize: 13 }}>???</b><span className="muted" style={{ fontSize: 11.5 }}>подсказка</span></button>)}</div>
      </section>
    </>
  )
}
