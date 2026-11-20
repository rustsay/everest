import { useCallback, useEffect, useState } from 'react'
import { getRedo } from '../api/client'
import { useApp } from '../app/store'
import type { RedoItem } from '../types'
import { fmtD, plural } from '../design/ui'
import { Problem } from '../pages/TaskMap'

/** «Работа над ошибками»: problems solved wrong come back in 3 days, then in 7, until solved twice in a row. */
export default function Redo() {
  const app = useApp()
  const [d, setD] = useState<{ items: RedoItem[]; later: number; next: string | null; done: number } | null>(null)
  const load = useCallback(() => getRedo().then(setD).catch(() => null), [])
  useEffect(() => { load() }, [load])
  if (!d || (!d.items.length && !d.later && !d.done)) return null
  return (
    <section className="card redo" id="redo">
      <div className="card-h"><div><h2>Работа над ошибками</h2>
        <p className="muted" style={{ fontSize: 13 }}>Задачи, где была ошибка, возвращаются через 3 дня, потом через 7. Две верные подряд - задача закрыта.</p></div>
        {d.done > 0 && <span className="pill p-em num">исправлено {d.done}</span>}</div>
      {d.items.length === 0
        ? <p className="muted">На сегодня всё исправлено.{d.later ? ` Ещё ${d.later} ${plural(d.later, 'задача вернётся', 'задачи вернутся', 'задач вернутся')}${d.next ? ` с ${fmtD(d.next)}` : ''}.` : ''}</p>
        : <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
          {d.items.map((it, i) => (
            <div key={it.ref}>
              <p className="label" style={{ margin: '0 0 6px 4px' }}>№ {it.task} · {it.proto_name || 'задача'} · {it.step ? 'второй повтор' : 'первый повтор'}</p>
              <Problem n={it.task} i={i} q={{ id: it.pid, q: it.q, done: null, sol: null, src: it.src, check: it.check, img: it.img }}
                onDone={() => { setTimeout(load, 1500); app.reload() }} />
            </div>
          ))}
          {d.later > 0 && <p className="muted" style={{ fontSize: 13 }}>Ещё {d.later} вернутся позже{d.next ? `, ближайшая ${fmtD(d.next)}` : ''}.</p>}
        </div>}
    </section>
  )
}
