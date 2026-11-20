import { FormEvent, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { addTextbook, deleteMaterial, deleteTextbook, editMaterial, generateMaterial, getMaterial, listMaterials, listTextbooks } from '../api/client'
import { useApp } from '../app/store'
import type { MaterialHead, MaterialOut, Slide, Textbook } from '../types'
import { Icon, Md, Orn, StarBot, fmtD } from '../design/ui'
import NoLlm from '../components/NoLlm'
import { SlideEditor, SlideShow, SlideView, THEMES } from '../components/Deck'

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
  const outRef = useRef<HTMLElement | null>(null)
  // «Мои материалы»: everything generated is saved; here it is opened, renamed, edited and deleted
  const [mats, setMats] = useState<MaterialHead[]>([])
  const [mf, setMf] = useState<'all' | 'conspect' | 'slides'>('all')
  const [allMats, setAllMats] = useState(false)
  const [draft, setDraft] = useState<Slide[] | null>(null)
  const [textDraft, setTextDraft] = useState<string | null>(null)
  const [show, setShow] = useState(false)
  const loadMats = () => listMaterials().then((r) => setMats(r.materials)).catch(() => null)
  useEffect(() => { loadMats() }, [])

  const load = () => listTextbooks().then((r) => { setBooks(r.textbooks); setBook((b) => b ?? r.textbooks[0]?.id ?? null) }).catch(() => null)
  useEffect(() => { load() }, [])
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const n = (draft ?? out?.slides)?.length ?? 0
      if (!n || show || (e.target as HTMLElement).closest('input,textarea,select')) return
      if (e.key === 'ArrowRight') setSi((i) => Math.min(n - 1, i + 1))
      if (e.key === 'ArrowLeft') setSi((i) => Math.max(0, i - 1))
    }
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [out, draft, show])

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
    const pages = String(f.get('pages') || '')
    if (!paragraph.trim() && !b?.chars) { app.toast('В этом учебнике нет текста: вставьте параграф вручную'); return }
    setBusy(true); setOut(null)
    try {
      const r = await generateMaterial({ kind, topic: String(f.get('topic') || '').trim() || 'Тема', textbook_id: book, section: String(f.get('section') || ''), paragraph, pages, extra: f.get('extra') === 'on', who: String(f.get('who')), minutes: String(f.get('len')) })
      setOut(r); setSi(0); setDraft(null); setTextDraft(null); loadMats()
      if (r.pages?.length) app.toast(`Взяты страницы: ${r.pages.map((x) => x.replace('стр. ', '')).join(', ')}`)
      app.say(kind === 'conspect' ? 'Конспект готов и сохранён в «Мои материалы». Сверьте определения с учебником перед уроком.' : 'Презентация готова и сохранена. Выберите оформление и нажмите «Показать».')
    } catch (err) { app.toast(String(err).replace('Error: ', '')) } finally { setBusy(false) }
  }

  const copy = async () => {
    if (!out) return
    const text = out.text ?? (out.slides ?? []).map((s, i) => `${i + 1}. ${s.title}\n${[...s.bullets, ...(s.steps ?? []).map((x, k) => `шаг ${k + 1}: ${x}`), ...(s.question ? [`Вопрос: ${s.question}`] : []), ...(s.answer ? [`Ответ: ${s.answer}`] : [])].map((b) => '- ' + b).join('\n')}${s.formula ? '\nФормула: ' + s.formula : ''}${s.note ? '\nЗаметка: ' + s.note : ''}`).join('\n\n')
    try { await navigator.clipboard.writeText(text); app.toast('Скопировано') } catch { app.toast('Не получилось скопировать. Выделите текст вручную') }
  }
  const open = async (id: number) => {
    try {
      const m = await getMaterial(id)
      setOut(m); setSi(0); setDraft(null); setTextDraft(null)
      setTimeout(() => outRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
    } catch (err) { app.toast(String(err).replace('Error: ', '')) }
  }
  const save = async (body: { topic?: string; theme?: string; text?: string; slides?: Slide[] }, msg = 'Сохранено') => {
    if (!out) return
    try { const m = await editMaterial(out.id, body); setOut(m); app.toast(msg); loadMats(); return true } catch (err) { app.toast(String(err).replace('Error: ', '')); return false }
  }
  const remove = async (m: MaterialHead) => {
    if (!confirm(`Удалить «${m.topic}»? Вернуть не получится.`)) return
    try { await deleteMaterial(m.id); if (out?.id === m.id) setOut(null); loadMats(); app.toast('Удалено') } catch (err) { app.toast(String(err).replace('Error: ', '')) }
  }
  const rename = async () => {
    const t = prompt('Новое название', out?.topic ?? '')?.trim()
    if (t && t !== out?.topic) await save({ topic: t.slice(0, 200) }, 'Название изменено')
  }
  const startShow = () => {
    // full screen must be asked right in the click
    document.documentElement.requestFullscreen?.().catch(() => null)
    setShow(true)
  }
  const slides = draft ?? out?.slides ?? []
  const s = slides[Math.min(si, Math.max(0, slides.length - 1))]
  const theme = out?.theme ?? 'everest'
  const edit = (k: number, v: Slide) => setDraft(slides.map((x, i) => (i === k ? v : x)))
  const move = (d: -1 | 1) => {
    const j = si + d
    if (j < 0 || j >= slides.length) return
    const a = [...slides]; [a[si], a[j]] = [a[j], a[si]]; setDraft(a); setSi(j)
  }
  const cur = books.find((b) => b.id === book)
  const shownMats = mats.filter((m) => mf === 'all' || m.kind === mf)
  return (
    <>
      <div><p className="muted">{tutor ? 'Кабинет репетитора' : 'Кабинет учителя'}</p><h1>Конспекты и презентации</h1></div>
      <NoLlm what="Сборка конспектов и презентаций" />
      {mats.length > 0 && (
        <section className="card">
          <div className="card-h"><div><h2>Мои материалы</h2><p className="muted" style={{ fontSize: 13 }}>всё, что вы собрали, сохраняется здесь</p></div>
            <div className="seg" role="group" aria-label="Что показать">{([['all', 'Все'], ['conspect', 'Конспекты'], ['slides', 'Презентации']] as const).map(([k, l]) => <button type="button" key={k} aria-pressed={mf === k} onClick={() => setMf(k)}>{l}</button>)}</div></div>
          <div className="mats">
            {shownMats.slice(0, allMats ? undefined : 6).map((m) => (
              <div key={m.id} className={`mat-row ${out?.id === m.id ? 'on' : ''}`}>
                <button className="bk-main" onClick={() => open(m.id)}>
                  <span className={`mat-ic ${m.kind === 'slides' ? 'sl' : ''}`}><Icon n={m.kind === 'slides' ? 'slides' : 'book'} s={20} /></span>
                  <span><b>{m.topic}</b><small>{m.kind === 'slides' ? `Презентация · ${m.count} слайдов · ${THEMES.find((t) => t.k === m.theme)?.name ?? 'Эверест'}` : 'Конспект'}{m.section ? ` · ${m.section}` : ''}{m.created_at ? ` · ${fmtD(m.created_at.slice(0, 10))}` : ''}{m.edited ? ' · изменено вами' : ''}</small></span>
                </button>
                <button className="iconbtn" aria-label={`Удалить «${m.topic}»`} onClick={() => remove(m)}><Icon n="trash" s={18} /></button>
              </div>
            ))}
            {shownMats.length === 0 && <p className="muted">Здесь пока ничего нет</p>}
          </div>
          {shownMats.length > 6 && <button className="btn btn-sm btn-ghost" style={{ marginTop: 8 }} onClick={() => setAllMats(!allMats)}>{allMats ? 'Свернуть' : `Показать все (${shownMats.length})`}</button>}
        </section>
      )}
      <section className="card">
        <div className="card-h"><div><h2>Библиотека учебников</h2><p className="muted" style={{ fontSize: 13 }}>конспекты строятся только по этим учебникам</p></div>
          <button className="btn btn-sm btn-line" onClick={() => setAdding(!adding)}><Icon n="plus" s={16} />Добавить учебник</button></div>
        {adding && (
          <form onSubmit={addBook} className="mat-form" style={{ marginBottom: 12 }}>
            <div className="field" style={{ flex: '2 1 240px' }}><label htmlFor="bTitle">Название</label><input id="bTitle" name="title" className="input" required placeholder="Алгебра и начала математического анализа, 10-11" /></div>
            <div className="field" style={{ flex: '1 1 180px' }}><label htmlFor="bAuth">Авторы</label><input id="bAuth" name="authors" className="input" placeholder="Ш.А. Алимов и др." /></div>
            <div className="field" style={{ flex: '0 1 100px' }}><label htmlFor="bGrade">Класс</label><input id="bGrade" name="grade" className="input" placeholder="10-11" /></div>
            <div className="field" style={{ flex: '1 1 220px' }}><label htmlFor="bFile">Файл (.pdf с текстом, .docx, .txt)</label><input id="bFile" name="file" type="file" accept=".pdf,.docx,.txt,.md" className="input" style={{ paddingTop: 10 }} /></div>
            <button className="btn btn-em" type="submit">Сохранить</button>
          </form>
        )}
        {books.length === 0 && !adding && <p className="muted">Учебников пока нет. Добавьте учебник из федерального перечня, по которому вы работаете.</p>}
        <div className="books">{books.map((b) => (
          <div key={b.id} className={`bookc ${b.id === book ? 'on' : ''}`}>
            <button className="bk-main" onClick={() => setBook(b.id)}><Icon n="book" s={22} />
              <span><b>{b.title}</b><small>{b.authors}{b.grade ? ` · ${b.grade}` : ''}</small><small className={b.chars ? 'ok' : 'no'}>{b.chars ? (b.pages ? `${b.pages} стр. с текстом` : `текст: ${Math.round(b.chars / 1000)} тыс. знаков`) : b.filename ? `файл без текстового слоя: ${b.filename}` : 'без файла: вставляйте параграф'}</small></span></button>
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
          <div className="field" style={{ flex: '1 1 220px' }}><label htmlFor="mPages">Страницы учебника</label>
            <input id="mPages" name="pages" className="input" placeholder={cur?.pages ? 'например, 112-118' : 'нет номеров страниц'} disabled={!cur?.pages} autoComplete="off" />
            <small className="muted" style={{ fontSize: 12 }}>{cur?.pages ? `Номера страниц файла PDF (всего ${cur.pages}). Пусто - найду страницы по теме сам.` : cur?.chars ? 'Учебник без номеров страниц: страницы по теме найду сам.' : 'В учебнике нет текста: вставьте параграф ниже.'}</small></div>
          <label className="mat-check" style={{ flex: '1 1 260px' }}><input type="checkbox" name="extra" defaultChecked /><span><b>ИИ может дополнить</b><small className="muted">то, чего нет на страницах. Такие места помечены «Дополнение»</small></span></label>
          <details className="mat-paste" style={{ flex: '1 1 100%' }} open={!cur?.chars}><summary>Вставить текст параграфа вручную</summary>
            <textarea id="mPara" name="para" className="input" rows={5} placeholder="Необязательно. Если вставить текст, материал будет строиться по нему, а не по страницам." /></details>
          <div style={{ flex: '1 1 100%' }}><span className="flabel">Что сделать</span>
            <div className="seg" role="group" aria-label="Тип материала">{([['conspect', 'Конспект урока'], ['slides', 'Презентация']] as const).map(([k, l]) => <button type="button" key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>{l}</button>)}</div></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', width: '100%', alignItems: 'center' }}>
            <button className="btn btn-gold" type="submit" disabled={busy}><Icon n="pen" s={18} c="#16231F" />{busy ? 'Собираю…' : 'Собрать по учебнику'}</button>
            <button type="button" className="btn btn-ghost" onClick={() => app.openModal('Шаблон конспекта', (<><p className="muted">Каждый конспект строится по этим разделам по выбранным страницам учебника, определения и формулы дословно со ссылкой на страницу. Если включено «ИИ может дополнить», недостающее он добавляет с пометкой «Дополнение», иначе пишет «в учебнике нет».</p><ol className="how" style={{ marginTop: 10 }}>{TEMPLATE.map((t) => <li key={t}>{t}</li>)}</ol></>))}>Показать шаблон</button>
          </div>
        </form>
      </section>

      {!out && !busy && <section className="card" style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}><StarBot size={64} /><div style={{ flex: 1, minWidth: 220 }}><b>Здесь появится {kind === 'conspect' ? 'конспект урока' : 'презентация'}</b><p className="muted" style={{ marginTop: 4 }}>{kind === 'conspect' ? 'Укажите страницы учебника или только тему. Определения дословно со ссылкой на страницу, задачи с номерами из учебника, связь с заданиями экзамена.' : 'Слайды по учебнику с оформлением на выбор: пункты и шаги решения появляются по щелчку, формулы проявляются, рисунки чертятся, ответ на вопрос открывается в нужный момент.'}</p></div></section>}
      {busy && <section className="card"><span className="typing" aria-label="Собираю"><i /><i /><i /></span></section>}
      {out?.kind === 'conspect' && (
        <section className="card mat-out" ref={outRef}>
          <div className="card-h"><h2>Конспект: {out.topic}</h2>{out.pages?.length ? <span className="muted" style={{ fontSize: 13 }}>по страницам {out.pages.map((x) => x.replace('стр. ', '')).join(', ')}</span> : null}</div><Orn style={{ marginBottom: 14 }} />
          {textDraft == null ? <div className="md"><Md text={out.text ?? ''} /></div>
            : <textarea className="input" rows={22} value={textDraft} onChange={(e) => setTextDraft(e.target.value)} aria-label="Текст конспекта" style={{ fontFamily: 'inherit', lineHeight: 1.5 }} />}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
            {textDraft == null ? <>
              <button className="btn btn-ghost" onClick={() => setTextDraft(out.text ?? '')}><Icon n="pen" s={18} />Редактировать</button>
              <button className="btn btn-ghost" onClick={rename}>Переименовать</button>
              <button className="btn btn-ghost" onClick={copy}><Icon n="copy" s={18} />Скопировать</button>
            </> : <>
              <button className="btn btn-em" onClick={async () => { if (await save({ text: textDraft })) setTextDraft(null) }}>Сохранить</button>
              <button className="btn btn-ghost" onClick={() => setTextDraft(null)}>Отменить</button>
            </>}
          </div>
        </section>
      )}
      {out?.kind === 'slides' && s && (
        <section className="card" ref={outRef}>
          <div className="card-h"><div><h2>Презентация: {out.topic}</h2>{out.pages?.length ? <p className="muted" style={{ fontSize: 13 }}>по страницам {out.pages.map((x) => x.replace('стр. ', '')).join(', ')}</p> : null}</div><span className="muted num">{si + 1} / {slides.length}</span></div>
          <div className="themes" role="group" aria-label="Оформление" style={{ marginBottom: 12 }}>
            {THEMES.map((t) => <button key={t.k} className="theme-b" aria-pressed={theme === t.k} onClick={() => theme !== t.k && save({ theme: t.k }, `Оформление: ${t.name}`)}>
              <i style={{ background: `linear-gradient(135deg,${t.sw[0]} 55%,${t.sw[1]} 55%)` }} /><span><b>{t.name}</b><small>{t.sub}</small></span></button>)}
          </div>
          <div className="deck-prev" aria-live="polite" key={`${si}-${theme}`}><SlideView s={s} i={si} n={slides.length} theme={theme} topic={out.topic} /></div>
          <div className="vctl">
            <button className="iconbtn" disabled={si === 0} onClick={() => setSi(si - 1)} aria-label="Предыдущий слайд"><Icon n="prev" /></button>
            <span className="muted" style={{ fontSize: 13 }}>стрелки на клавиатуре листают</span>
            <button className="iconbtn" disabled={si === slides.length - 1} onClick={() => setSi(si + 1)} aria-label="Следующий слайд"><Icon n="next" /></button>
          </div>
          <div className="strip" aria-label="Все слайды">{slides.map((x, i) => <button key={i} aria-label={`Слайд ${i + 1}: ${x.title}`} aria-current={i === si} onClick={() => setSi(i)}><SlideView s={x} i={i} n={slides.length} theme={theme} still topic={out.topic} /></button>)}</div>
          {s.note && !draft && <p style={{ marginTop: 6, background: 'var(--surface-2)', borderRadius: 14, padding: '10px 12px' }}><b>Заметка учителю:</b> {s.note}</p>}
          {draft && <>
            <SlideEditor s={s} onChange={(v) => edit(si, v)} />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              <button className="btn btn-sm btn-line" onClick={() => move(-1)} disabled={si === 0}>Сдвинуть влево</button>
              <button className="btn btn-sm btn-line" onClick={() => move(1)} disabled={si === slides.length - 1}>Сдвинуть вправо</button>
              <button className="btn btn-sm btn-line" onClick={() => { const a = [...slides]; a.splice(si + 1, 0, { title: 'Новый слайд', kind: 'other', bullets: [], note: '' }); setDraft(a); setSi(si + 1) }}><Icon n="plus" s={16} />Слайд после этого</button>
              <button className="btn btn-sm btn-line" disabled={slides.length < 2} onClick={() => { setDraft(slides.filter((_, i) => i !== si)); setSi(Math.max(0, si - 1)) }}><Icon n="trash" s={16} />Удалить слайд</button>
            </div>
          </>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
            {draft ? <>
              <button className="btn btn-em" onClick={async () => { if (await save({ slides: draft }, 'Презентация сохранена')) setDraft(null) }}>Сохранить изменения</button>
              <button className="btn btn-ghost" onClick={() => { setDraft(null); setSi(Math.min(si, (out.slides?.length ?? 1) - 1)) }}>Отменить</button>
            </> : <>
              <button className="btn btn-gold" onClick={startShow}><Icon n="play" s={18} c="#16231F" />Показать</button>
              <button className="btn btn-ghost" onClick={() => setDraft(out.slides ?? [])}><Icon n="pen" s={18} />Редактировать</button>
              <button className="btn btn-ghost" onClick={rename}>Переименовать</button>
              <button className="btn btn-ghost" onClick={() => window.print()}><Icon n="slides" s={18} />Печать или PDF</button>
              <button className="btn btn-ghost" onClick={copy}><Icon n="copy" s={18} />Скопировать текст</button>
            </>}
          </div>
          {!draft && <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>В показе: щелчок, пробел или пульт - следующий пункт, стрелки - назад и вперёд, N - заметки, B - тёмный экран, Esc - выход.</p>}
          {show && <SlideShow slides={out.slides ?? []} topic={out.topic} theme={theme} start={si} onClose={(at) => { setShow(false); setSi(at) }} />}
          {createPortal(<div className="print-slides" aria-hidden="true">{(out.slides ?? []).map((x, i) => <SlideView key={i} s={x} i={i} n={out.slides!.length} theme={theme} still topic={out.topic} />)}</div>, document.body)}
        </section>
      )}
    </>
  )
}
