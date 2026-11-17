import { FormEvent, useEffect, useRef, useState } from 'react'
import { addTextbook, deleteTextbook, generateMaterial, listTextbooks } from '../api/client'
import { useApp } from '../app/store'
import type { MaterialOut, Textbook } from '../types'
import { Icon, Md, Orn, StarBot } from '../design/ui'
import NoLlm from '../components/NoLlm'

const TEMPLATE = ['Тема и параграф', 'Цель урока', 'Что повторить', 'Определения (дословно из учебника)', 'Теоремы и формулы (дословно)', 'Разобранный пример из учебника', 'Задачи из учебника: базовые и повышенные', 'Связь с экзаменом', 'Типичные ошибки по критериям ФИПИ', 'Домашнее задание (номера из учебника)']
const TOPICS = ['Отбор корней на отрезке', 'Логарифмические неравенства', 'Экономическая задача: кредиты', 'Задачи с параметром', 'Стереометрия: угол между плоскостями', 'Единичная окружность', 'Производная', 'Квадратные уравнения', 'Вероятность']

export default function Materials() {
  const app = useApp()
  const tutor = app.me.role === 'tutor'
  const [books, setBooks] = useState<Textbook[]>([])
  const [book, setBook] = useState<number | null>(null)
  const [kind, setKind] = useState<'conspect' | 'slides'>('conspect')
  const [busy, setBusy] = useState(false)
  const [out, setOut] = useState<MaterialOut | null>(null)
  const [si, setSi] = useState(0)
  const [adding, setAdding] = useState(false)
  const slideRef = useRef<HTMLDivElement | null>(null)

  const load = () => listTextbooks().then((r) => { setBooks(r.textbooks); setBook((b) => b ?? r.textbooks[0]?.id ?? null) }).catch(() => null)
  useEffect(() => { load() }, [])
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!out?.slides || (e.target as HTMLElement).closest('input,textarea,select')) return
      if (e.key === 'ArrowRight') setSi((i) => Math.min(out.slides!.length - 1, i + 1))
      if (e.key === 'ArrowLeft') setSi((i) => Math.max(0, i - 1))
    }
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [out])

  const addBook = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const file = f.get('file') as File | null
    try {
      const b = await addTextbook(String(f.get('title') || '').trim(), String(f.get('authors') || '').trim(), String(f.get('grade') || '').trim(), file && file.size ? file : undefined)
      app.toast(b.chars ? `Учебник загружен: ${Math.round(b.chars / 1000)} тыс. знаков текста` : 'Учебник добавлен. Текста в файле нет: вставляйте параграф вручную')
      setAdding(false); setBook(b.id); load()
    } catch (err) { app.toast(String(err).replace('Error: ', '')) }
  }

  const generate = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!book) { app.toast('Сначала добавьте учебник'); return }
    const f = new FormData(e.currentTarget)
    const b = books.find((x) => x.id === book)
    const paragraph = String(f.get('para') || '')
    if (!paragraph.trim() && !b?.chars) { app.toast('Нужен текст учебника: вставьте параграф или загрузите учебник с текстом'); return }
    setBusy(true); setOut(null)
    try {
      const r = await generateMaterial({ kind, topic: String(f.get('topic') || '').trim() || 'Тема', textbook_id: book, section: String(f.get('section') || ''), paragraph, who: String(f.get('who')), minutes: String(f.get('len')) })
      setOut(r); setSi(0)
      app.say(kind === 'conspect' ? 'Конспект готов. Сверьте определения с учебником перед уроком.' : 'Презентация готова. Листайте стрелками.')
    } catch (err) { app.toast(String(err).replace('Error: ', '')) } finally { setBusy(false) }
  }

  const copy = async () => {
    if (!out) return
    const text = out.text ?? (out.slides ?? []).map((s, i) => `${i + 1}. ${s.title}\n${s.bullets.map((b) => '- ' + b).join('\n')}${s.note ? '\nЗаметка: ' + s.note : ''}`).join('\n\n')
    try { await navigator.clipboard.writeText(text); app.toast('Скопировано') } catch { app.toast('Не получилось скопировать. Выделите текст вручную') }
  }
  const s = out?.slides?.[si]
  return (
    <>
      <div><p className="muted">{tutor ? 'Кабинет репетитора' : 'Кабинет учителя'}</p><h1>Конспекты и презентации</h1></div>
      <NoLlm what="Сборка конспектов и презентаций" />
      <section className="card">
        <div className="card-h"><div><h2>Библиотека учебников</h2><p className="muted" style={{ fontSize: 13 }}>конспекты строятся только по этим учебникам</p></div>
          <button className="btn btn-sm btn-line" onClick={() => setAdding(!adding)}><Icon n="plus" s={16} />Добавить учебник</button></div>
        {adding && (
          <form onSubmit={addBook} className="mat-form" style={{ marginBottom: 12 }}>
            <div className="field" style={{ flex: '2 1 240px' }}><label htmlFor="bTitle">Название</label><input id="bTitle" name="title" className="input" required placeholder="Алгебра и начала математического анализа, 10-11" /></div>
            <div className="field" style={{ flex: '1 1 180px' }}><label htmlFor="bAuth">Авторы</label><input id="bAuth" name="authors" className="input" placeholder="Ш.А. Алимов и др." /></div>
            <div className="field" style={{ flex: '0 1 100px' }}><label htmlFor="bGrade">Класс</label><input id="bGrade" name="grade" className="input" placeholder="10-11" /></div>
            <div className="field" style={{ flex: '1 1 220px' }}><label htmlFor="bFile">Файл (.pdf с текстом, .txt)</label><input id="bFile" name="file" type="file" accept=".pdf,.txt,.md" className="input" style={{ paddingTop: 10 }} /></div>
            <button className="btn btn-em" type="submit">Сохранить</button>
          </form>
        )}
        {books.length === 0 && !adding && <p className="muted">Учебников пока нет. Добавьте учебник из федерального перечня, по которому вы работаете.</p>}
        <div className="books">{books.map((b) => (
          <div key={b.id} className={`bookc ${b.id === book ? 'on' : ''}`}>
            <button className="bk-main" onClick={() => setBook(b.id)}><Icon n="book" s={22} />
              <span><b>{b.title}</b><small>{b.authors}{b.grade ? ` · ${b.grade}` : ''}</small><small className={b.chars ? 'ok' : 'no'}>{b.chars ? `текст: ${Math.round(b.chars / 1000)} тыс. знаков` : b.filename ? `файл без текстового слоя: ${b.filename}` : 'без файла: вставляйте параграф'}</small></span></button>
            <button className="iconbtn" aria-label="Удалить учебник" onClick={async () => { await deleteTextbook(b.id); if (book === b.id) setBook(null); load() }}><Icon n="trash" s={18} /></button>
          </div>
        ))}</div>
      </section>

      <section className="card">
        <form className="mat-form" onSubmit={generate}>
          <div className="field" style={{ flex: '2 1 240px' }}><label htmlFor="mTopic">Тема</label><input id="mTopic" name="topic" className="input" list="mTopics" defaultValue="Отбор корней на отрезке" autoComplete="off" /><datalist id="mTopics">{TOPICS.map((t) => <option key={t} value={t} />)}</datalist></div>
          <div className="field" style={{ flex: '1 1 140px' }}><label htmlFor="mSec">Параграф, пункт</label><input id="mSec" name="section" className="input" placeholder="например, § 26" /></div>
          <div className="field" style={{ flex: '1 1 180px' }}><label htmlFor="mWho">Для кого</label><select id="mWho" name="who" className="input">{(tutor ? ['Индивидуальное занятие', 'Мини-группа 3-5 человек'] : ['Весь класс', 'Группа слабых по теме', 'Индивидуально ученику']).map((x) => <option key={x}>{x}</option>)}</select></div>
          <div className="field" style={{ flex: '1 1 130px' }}><label htmlFor="mLen">Длительность</label><select id="mLen" name="len" className="input" defaultValue="45">{['20', '45', '90'].map((x) => <option key={x} value={x}>{x} минут</option>)}</select></div>
          <div className="field" style={{ flex: '1 1 100%' }}><label htmlFor="mPara">Текст параграфа из учебника «{books.find((b) => b.id === book)?.title ?? '…'}»</label>
            <textarea id="mPara" name="para" className="input" rows={5} placeholder="Вставьте сюда текст параграфа: определения, теоремы, примеры, номера задач. Конспект будет строго по нему. Если учебник загружен с текстом, поле можно оставить пустым." /></div>
          <div style={{ flex: '1 1 100%' }}><span className="flabel">Что сделать</span>
            <div className="seg" role="group" aria-label="Тип материала">{([['conspect', 'Конспект урока'], ['slides', 'Презентация']] as const).map(([k, l]) => <button type="button" key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>{l}</button>)}</div></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', width: '100%', alignItems: 'center' }}>
            <button className="btn btn-gold" type="submit" disabled={busy}><Icon n="pen" s={18} c="#16231F" />{busy ? 'Собираю…' : 'Собрать по учебнику'}</button>
            <button type="button" className="btn btn-ghost" onClick={() => app.openModal('Шаблон конспекта', (<><p className="muted">Каждый конспект строится по этим разделам и только по тексту прикреплённого учебника. Чего нет в учебнике, помощник не дописывает, а пишет «в учебнике нет».</p><ol className="how" style={{ marginTop: 10 }}>{TEMPLATE.map((t) => <li key={t}>{t}</li>)}</ol></>))}>Показать шаблон</button>
          </div>
        </form>
      </section>

      {!out && !busy && <section className="card" style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}><StarBot size={64} /><div style={{ flex: 1, minWidth: 220 }}><b>Здесь появится {kind === 'conspect' ? 'конспект урока' : 'презентация'}</b><p className="muted" style={{ marginTop: 4 }}>Разделы по шаблону, определения дословно из учебника, задачи с номерами из учебника, связь с заданиями экзамена.</p></div></section>}
      {busy && <section className="card"><span className="typing" aria-label="Собираю"><i /><i /><i /></span></section>}
      {out?.text && (
        <section className="card mat-out"><div className="card-h"><h2>Конспект: {out.topic}</h2></div><Orn style={{ marginBottom: 14 }} />
          <div className="md"><Md text={out.text} /></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}><button className="btn btn-ghost" onClick={copy}><Icon n="copy" s={18} />Скопировать</button></div>
        </section>
      )}
      {out?.slides && s && (
        <section className="card">
          <div className="card-h"><h2>Презентация: {out.topic}</h2><span className="muted num">{si + 1} / {out.slides.length}</span></div>
          <div className="slide" ref={slideRef} aria-live="polite">
            <Orn /><div className="slide-in"><span className="label">Слайд {si + 1}</span><h3 className="slide-t">{s.title}</h3><ul>{s.bullets.map((b, i) => <li key={si + '-' + i} style={{ animation: `rise .35s ${(i * 0.08).toFixed(2)}s both` }}>{b}</li>)}</ul></div>
            <span className="slide-brand">Эверест · {si + 1}/{out.slides.length}</span>
          </div>
          <div className="vctl">
            <button className="iconbtn" disabled={si === 0} onClick={() => setSi(si - 1)} aria-label="Предыдущий слайд"><Icon n="prev" /></button>
            <div className="sdots">{out.slides.map((_, i) => <button key={i} aria-label={`Слайд ${i + 1}`} aria-current={i === si} onClick={() => setSi(i)} />)}</div>
            <button className="iconbtn" disabled={si === out.slides.length - 1} onClick={() => setSi(si + 1)} aria-label="Следующий слайд"><Icon n="next" /></button>
          </div>
          {s.note && <p style={{ marginTop: 12, background: 'var(--surface-2)', borderRadius: 14, padding: '10px 12px' }}><b>Заметка учителю:</b> {s.note}</p>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
            <button className="btn btn-ghost" onClick={() => { try { slideRef.current?.requestFullscreen() } catch { app.toast('Полный экран недоступен') } }}><Icon n="full" s={18} />На весь экран</button>
            <button className="btn btn-ghost" onClick={copy}><Icon n="copy" s={18} />Скопировать текст</button>
          </div>
        </section>
      )}
    </>
  )
}
