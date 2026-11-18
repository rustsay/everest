import { useCallback, useEffect, useState } from 'react'
import { bankTasks, deleteBank, downloadBankTemplate, editBank, importBank, listBank } from '../api/client'
import { useApp } from '../app/store'
import type { BankItem, BankTask } from '../types'
import { Icon } from '../design/ui'
import NoLlm from '../components/NoLlm'

/** Teacher / methodist: import problems from files, check them and publish them into the task maps. */
export default function Bank() {
  const app = useApp()
  const [tasks, setTasks] = useState<BankTask[]>([])
  const [task, setTask] = useState(1)
  const [tab, setTab] = useState<'draft' | 'approved'>('draft')
  const [items, setItems] = useState<BankItem[] | null>(null)
  const [counts, setCounts] = useState<Record<string, { approved: number; draft: number }>>({})
  const [fipi, setFipi] = useState<{ c: Record<string, number>; src: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => listBank(tab, task).then((r) => { setItems(r.items); setCounts(r.counts); if (r.fipi) setFipi({ c: r.fipi, src: r.fipi_source ?? '' }) }).catch(() => setItems([])), [tab, task])
  useEffect(() => { bankTasks().then((r) => setTasks(r.tasks)).catch(() => null) }, [])
  useEffect(() => { setItems(null); load() }, [load])

  const t = tasks.find((x) => x.n === task)
  const c = counts[String(task)] ?? { approved: 0, draft: 0 }
  const doImport = async (f: File | undefined) => {
    if (!f) return
    setBusy(true)
    try {
      const r = await importBank(task, f)
      app.toast(`Добавлено ${r.added}, повторов пропущено ${r.skipped}`)
      setTab('draft'); load()
    } catch (e) { app.toast(String(e).replace('Error: ', '')) } finally { setBusy(false) }
  }

  return (
    <>
      <div><p className="muted">Кабинет учителя</p><h1>Банк задач</h1></div>
      <NoLlm what="Разбор PDF и текстовых файлов" />
      {fipi && (
        <section className="card" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <Icon n="book" s={24} />
          <div style={{ flex: '1 1 260px' }}><b>Открытый банк ФИПИ уже загружен: {Object.values(fipi.c).reduce((a, b) => a + b, 0)} задач с ответами</b>
            <p className="muted" style={{ fontSize: 13 }}>По заданию № {task}: {fipi.c[String(task)] ?? 0}. Ученики видят их в «Банке задач», на картах заданий и в разборах, вы можете брать их в варианты. Источник: {fipi.src}.</p></div>
          <button className="btn btn-sm btn-line" onClick={() => app.go({ v: 'practice', id: String(task) })}>Посмотреть задачи</button>
        </section>
      )}
      <section className="card">
        <div className="card-h"><div><h2>Импорт задач</h2>
          <p className="muted" style={{ fontSize: 13 }}>Задачи попадают в черновики. На карте задания их видно только после проверки и публикации.</p></div></div>
        <div className="bank-import">
          <div className="field"><label htmlFor="bankTask">Задание</label>
            <select id="bankTask" className="input" value={task} onChange={(e) => setTask(Number(e.target.value))}>
              {tasks.map((x) => <option key={x.n} value={x.n}>№ {x.n} · {x.name}</option>)}
            </select></div>
          <label className="btn btn-em" style={{ alignSelf: 'flex-end' }}><Icon n="plus" s={18} />{busy ? 'Разбираю файл…' : 'Загрузить файл'}
            <input type="file" hidden accept=".json,.csv,.pdf,.docx,.txt,.md" disabled={busy} onChange={(e) => { doImport(e.target.files?.[0]); e.target.value = '' }} /></label>
          <button className="btn btn-ghost" style={{ alignSelf: 'flex-end' }} onClick={() => downloadBankTemplate().catch((e) => app.toast(String(e)))}><Icon n="copy" s={18} />Шаблон CSV</button>
        </div>
        <ul className="tm-know" style={{ fontSize: 13.5 }}>
          <li><b>CSV или JSON</b> - точный импорт без ИИ: задание, прототип, условие, ответ, решение, источник. Удобно для выгрузки открытого банка ФИПИ или своих подборок.</li>
          <li><b>PDF с текстом, Word (.docx) или TXT</b> (вариант, сборник; формулы-картинки из Word не читаются) - помощник найдёт задачи этого задания и разложит по прототипам. Условие он переписывает дословно, ответ берёт только из файла. Всё равно проверьте перед публикацией.</li>
          <li>Задачи с чужих сайтов загружайте, только если у вас есть право их использовать.</li>
        </ul>
      </section>

      <section>
        <div className="card-h">
          <div className="seg" role="group" aria-label="Статус задач">
            <button aria-pressed={tab === 'draft'} onClick={() => setTab('draft')}>Черновики · {c.draft ?? 0}</button>
            <button aria-pressed={tab === 'approved'} onClick={() => setTab('approved')}>Опубликовано · {c.approved ?? 0}</button>
          </div>
          {t && <button className="btn btn-sm btn-line" onClick={() => app.go({ v: 'task', id: String(task) })}><Icon n="map" s={16} />Карта задания № {task}</button>}
        </div>
        {items === null && <p className="muted">Загружаю…</p>}
        {items?.length === 0 && <p className="muted">{tab === 'draft' ? 'Черновиков нет. Загрузите файл с задачами.' : 'Опубликованных задач по этому заданию пока нет.'}</p>}
        <div style={{ display: 'grid', gap: 10 }}>
          {items?.map((it) => <BankRow key={it.id} it={it} task={t} onChanged={load} />)}
        </div>
      </section>
    </>
  )
}

function BankRow({ it, task, onChanged }: { it: BankItem; task?: BankTask; onChanged: () => void }) {
  const app = useApp()
  const [v, setV] = useState(it)
  const [busy, setBusy] = useState(false)
  const dirty = v.text !== it.text || (v.answer ?? '') !== (it.answer ?? '') || v.solution !== it.solution || v.proto !== it.proto
  const save = async (status?: 'draft' | 'approved') => {
    setBusy(true)
    try {
      await editBank(it.id, { text: v.text, answer: v.answer ?? '', solution: v.solution, proto: v.proto, ...(status ? { status } : {}) })
      app.toast(status === 'approved' ? 'Опубликовано на карте задания' : status === 'draft' ? 'Снято с публикации' : 'Сохранено')
      onChanged()
    } catch (e) { app.toast(String(e).replace('Error: ', '')) } finally { setBusy(false) }
  }
  const ro = !it.mine
  return (
    <div className={`card bank-row ${it.status === 'approved' ? 'ok' : ''}`}>
      <div className="bank-grid">
        <div className="field"><label>Прототип</label>
          <select className="input" value={v.proto} disabled={ro} onChange={(e) => setV({ ...v, proto: e.target.value })}>
            <option value="">не выбран</option>
            {task?.protos.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></div>
        <div className="field"><label>Ответ</label>
          <input className="input" value={v.answer ?? ''} disabled={ro} placeholder={it.task >= 13 ? 'необязательно' : 'нужен'} onChange={(e) => setV({ ...v, answer: e.target.value })} /></div>
      </div>
      <div className="field"><label>Условие</label>
        <textarea className="input" rows={3} value={v.text} disabled={ro} onChange={(e) => setV({ ...v, text: e.target.value })} /></div>
      <div className="field"><label>Решение</label>
        <textarea className="input" rows={2} value={v.solution} disabled={ro} placeholder="необязательно" onChange={(e) => setV({ ...v, solution: e.target.value })} /></div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="muted" style={{ fontSize: 12.5, flex: 1 }}>{it.source ? `Источник: ${it.source}` : 'Источник не указан'}{ro ? ' · добавил другой учитель' : ''}</span>
        {!ro && dirty && <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => save()}>Сохранить</button>}
        {!ro && it.status === 'draft' && <button className="btn btn-sm btn-em" disabled={busy} onClick={() => save('approved')}><Icon n="ok" s={16} />Проверено, опубликовать</button>}
        {!ro && it.status === 'approved' && <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => save('draft')}>Снять с публикации</button>}
        {!ro && <button className="iconbtn" aria-label="Удалить задачу" disabled={busy} onClick={async () => { await deleteBank(it.id).catch(() => null); onChanged() }}><Icon n="trash" s={18} /></button>}
      </div>
    </div>
  )
}
