import { ReactNode, useEffect, useRef, useState } from 'react'
import { finishDiagnostic, getDiagWork, openDiagnostic, saveAnswer, saveDiagnosticProgress, setDiagChoice, setDiagMode, skipDiagTask, skipDiagnostic, startDiagnostic, uploadDiagWork } from '../api/client'
import ProblemText from '../components/ProblemText'
import type { DiagChoice, DiagItem, DiagResult, DiagRun, DiagWork, ExamInfo } from '../types'
import { Icon, plural } from '../design/ui'

interface Props {
  mode: 'first' | 'mock'
  required: boolean
  exam: ExamInfo
  onFinished: (r: DiagResult) => void
  onSkip?: () => void
  onPause?: () => void
}

export default function Diagnostic({ mode, required, exam, onFinished, onSkip, onPause }: Props) {
  const [run, setRun] = useState<DiagRun | null>(null)
  const [phase, setPhase] = useState<'intro' | 'mockintro' | 'q' | 'finishing'>(mode === 'mock' ? 'q' : 'intro')
  const [i, setI] = useState(0)
  const [err, setErr] = useState('')
  const [deadline, setDeadline] = useState<number | null>(null)

  const begin = (r: DiagRun) => {
    setRun(r); setI(Math.min(r.position, r.items.length - 1))
    if (r.exam_mode) setDeadline(Date.now() + r.exam_mode.left * 1000)
  }
  useEffect(() => {
    const fail = (e: unknown) => setErr(String(e).replace('Error: ', ''))
    if (mode === 'mock') {
      // an unfinished mock goes on; a new one: choose between a usual mock and exam conditions
      openDiagnostic('mock').then((o) => { if (o.open) begin(o); else setPhase('mockintro') }).catch(fail)
    } else startDiagnostic(mode).then(begin).catch(fail)
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps
  const startMock = (examMode: boolean) => {
    setErr('')
    startDiagnostic('mock', examMode).then((r) => { begin(r); setPhase('q') }).catch((e) => setErr(String(e).replace('Error: ', '')))
  }

  const [waitMsg, setWaitMsg] = useState('')
  const finish = async (r: DiagRun) => {
    setPhase('finishing'); setErr('')
    try {
      await Promise.all(Object.entries(r.answers).filter(([k]) => !k.startsWith('_')).map(([k, v]) => saveAnswer(r.id, k, v, null).catch(() => null)))
      // photos are checked in the background: wait until every check is done
      for (let k = 0; k < 120; k++) {
        const w = (await getDiagWork(r.id)).work
        const pend = Object.values(w).filter((x) => x.status === 'pending').length
        if (!pend) break
        setWaitMsg(`Проверяю решения по фото: осталось ${pend}`)
        await new Promise((res) => setTimeout(res, 2500))
      }
      onFinished(await finishDiagnostic(r.id))
    } catch (e) {
      const msg = String(e).replace('Error: ', '')
      setErr(msg); setPhase('q')
      const m = msg.match(/заданиях: (\d+)/)
      if (m) setI(Math.max(0, Number(m[1]) - 1))
    }
  }

  /** Answer saved, photo / «не знаю» set: go to the next task or finish. */
  const next = (r: DiagRun) => {
    if (i + 1 < r.items.length) { setI(i + 1); setErr(''); return }
    if (r.exam_mode && !window.confirm('Завершить пробник? Пустые задания засчитаются как нерешённые.')) return
    finish(r)
  }
  // exam conditions: when the time is over the mock is handed in as it is
  const runRef = useRef(run)
  runRef.current = run
  useEffect(() => {
    if (!deadline || phase !== 'q') return
    const t = window.setInterval(() => { if (Date.now() >= deadline && runRef.current) { clearInterval(t); finish(runRef.current) } }, 1000)
    return () => clearInterval(t)
  }, [deadline, phase]) // eslint-disable-line react-hooks/exhaustive-deps
  const setAnswer = (value: string) => {
    if (!run) return
    const it = run.items[i]
    const r = { ...run, answers: { ...run.answers, [it.id]: value } }
    setRun(r)
    saveAnswer(run.id, it.id, value, i + 1).catch(() => { /* retried on finish */ })
    return r
  }
  const setWork = (work: Record<string, DiagWork>) => setRun((r) => (r ? { ...r, work } : r))

  // Persist the current item as the student moves around; answers and photos are already saved independently.
  useEffect(() => {
    if (phase !== 'q' || !run) return
    saveDiagnosticProgress(run.id, i).catch(() => { /* progress is also recovered from saved answers */ })
  }, [phase, run?.id, i])

  const saveAndExit = async () => {
    if (!run) { onPause?.(); return }
    try {
      await saveDiagnosticProgress(run.id, i)
      if (mode === 'first') onPause?.()
      else onPause?.()
    } catch (e) {
      setErr('Не удалось сохранить позицию. Проверь интернет и попробуй ещё раз.')
    }
  }

  /** The diagnostic by types: «не знаю» twice in a row inside one task - offer to skip the rest of its types. */
  const afterDontKnow = async (r: DiagRun) => {
    const it = r.items[i], prev = r.items[i - 1]
    const rest = r.items.slice(i + 1).filter((x) => x.type && x.n === it.n)
    const prevDk = prev && prev.type && prev.n === it.n && (r.work[prev.id]?.mode === 'dont_know' || r.answers[prev.id] === '?')
    if (r.typed && it.type && prevDk && rest.length && window.confirm(`Два раза подряд «Не знаю» в задании № ${it.n}. Пропустить остальные типы этого задания (${rest.length})?`)) {
      try {
        const w = (await skipDiagTask(r.id, it.n!)).work
        const nr = { ...r, work: w, answers: { ...r.answers, ...Object.fromEntries(rest.map((x) => [x.id, r.answers[x.id] || '?'])) } }
        setRun(nr)
        const k = nr.items.findIndex((x, idx) => idx > i && x.n !== it.n)
        if (k >= 0) { setI(k); setErr('') } else finish(nr)
        return
      } catch { /* fall through: go on type by type */ }
    }
    next(r)
  }

  if (phase === 'mockintro') {
    const mins = exam.key === 'base' ? 180 : 235
    return (
      <Frame top={<button className="ob-link" onClick={() => onPause?.()}>Назад</button>}>
        <div className="ob-intro">
          <span className="ob-badge"><Icon n="flag" s={18} />Пробник</span>
          <h1 className="ob-h">Как пишем пробник?</h1>
          <div className="mock-pick">
            <button className="mock-opt" onClick={() => startMock(false)}>
              <b>Обычный</b><span>Как диагностика: к каждому заданию фото решения или «Не знаю», можно с паузами.</span></button>
            {exam.key !== 'g10' && exam.key !== 'g58' && <button className="mock-opt gold" onClick={() => startMock(true)}>
              <b>Как на экзамене · {Math.floor(mins / 60)} ч {mins % 60 ? `${mins % 60} мин` : ''}</b>
              <span>Один таймер на всё, задания в любом порядке, можно оставить пустыми. Подсказок и пауз нет: время идёт, даже если выйти. В первой части достаточно ответа, во второй - фото решения. Разбор после конца.</span></button>}
          </div>
          {err && <p className="auth-msg">{err}</p>}
        </div>
      </Frame>
    )
  }
  if (err && !run) return <Frame><p className="auth-msg">{err}</p></Frame>
  if (!run) return <Frame><p className="ob-sub">Готовлю задания…</p></Frame>

  if (phase === 'intro') {
    const nNum = run.items.filter((x) => x.t === 'num').length, nSelf = run.items.length - nNum
    const resume = run.position > 0
    return (
      <Frame>
        <div className="ob-intro">
          <span className="ob-badge"><Icon n="flag" s={18} />{required ? 'Обязательный шаг' : 'По желанию'}</span>
          <h1 className="ob-h">Диагностика</h1>
          {run.typed ? (
            <p className="ob-sub">
              Проверяем каждый тип каждого задания: {nNum} {plural(nNum, 'задача', 'задачи', 'задач')} с ответом (типы 1.1, 1.2 и дальше по порядку)
              {nSelf ? <>, во второй части {nSelf} {plural(nSelf, 'задание', 'задания', 'заданий')}: в каждом выбираешь, какой тип решать</> : null}.
              Задачи из демоверсии {exam.key === 'oge' ? 'ОГЭ' : 'ЕГЭ'} 2027 и открытого банка ФИПИ.
            </p>
          ) : (
            <p className="ob-sub">
              {exam.key === 'prof' ? 'Задания из демоверсии ЕГЭ 2027 года (ФИПИ): ' : exam.key === 'oge' ? 'Задания в формате ОГЭ: ' : exam.key === 'g10' ? 'Только темы, которые прошли с 1 сентября: ' : ''}
              {nNum} {plural(nNum, 'задание', 'задания', 'заданий')} с ответом{nSelf ? ` и ${nSelf} ${plural(nSelf, 'задание', 'задания', 'заданий')} второй части` : ''}.
            </p>
          )}
          <ul className="ob-rules">
            {exam.key === 'base'
              ? <li>Впиши ответ. Если у тебя есть решение, можешь прикрепить фото: я посмотрю, где ошибка. Можно и без решения.</li>
              : <li>К каждому заданию прикрепи фото решения или нажми «Не знаю». {exam.key === 'prof' ? 'Только задание 8 можно отметить «Решил устно». ' : exam.key === 'oge' ? 'Задания 1, 11 и 19 можно отметить «Решил устно». ' : ''}По фото видно, где просто ошибка в счёте, а где непонятен способ.</li>}
            <li>Во второй части решение проверяется по критериям ФИПИ, как на экзамене.</li>
            <li>Правильные ответы не показываю до конца: это проверка, а не урок.</li>
            {run.typed && <li>Если два раза подряд нажмёшь «Не знаю» в одном задании, предложу пропустить остальные его типы.</li>}
            {run.typed && <li>Во второй части решай тот тип, который знаешь лучше. Остальные типы траектория проверит позже.</li>}
            <li>В любой момент можно сохранить прогресс и выйти, а затем продолжить с того же задания.</li>
            <li>По ответам посчитаю прогноз, найду первопричину ошибок и соберу расписание.</li>
          </ul>
          {resume && <p className="ob-sub" style={{ marginTop: 4 }}>Ответы и фото сохранены. Можно выйти и вернуться позже, хоть с другого устройства: продолжишь с того же места.</p>}
          <button className="btn btn-em ob-go" onClick={() => setPhase('q')}>{resume ? `Продолжить с задания ${i + 1}` : 'Начать диагностику'}</button>
          {!required && onSkip && <button className="ob-link" onClick={async () => { await skipDiagnostic().catch(() => null); onSkip() }}>{resume ? 'Выйти, продолжу позже' : 'Пропустить'}</button>}
        </div>
      </Frame>
    )
  }

  if (phase === 'finishing') return <Frame><p className="ob-sub">{waitMsg || 'Считаю результат…'}</p></Frame>

  const it = run.items[i], n = run.items.length
  const ex = !!run.exam_mode
  const filled = (x: DiagItem) => (x.t === 'num' ? !!run.answers[x.id] && run.answers[x.id] !== '?' : run.work[x.id]?.mode === 'photo')
  return (
    <Frame top={<>
      {ex && deadline && <Timer deadline={deadline} />}
      {ex && <button className="ob-link" onClick={() => { if (window.confirm('Сдать пробник сейчас? Пустые задания засчитаются как нерешённые.')) finish(run) }}>Сдать</button>}
      <button className="ob-link" onClick={saveAndExit}>{ex ? 'Сохранить и выйти (время идёт)' : 'Сохранить прогресс и выйти'}</button>
    </>}>
      <div className="q-prog"><span style={{ width: `${(i / n) * 100}%` }} /></div>
      <div className="q-grid" aria-label="Навигация по заданиям">{run.items.map((x, k) => (
        <button key={x.id} className={`${k === i ? 'on' : ''} ${filled(x) ? 'done' : ''}`} onClick={() => { setI(k); setErr('') }} aria-label={`Задание ${x.n ?? k + 1}${filled(x) ? ', есть ответ' : ''}`}>{x.n ?? k + 1}</button>
      ))}</div>
      <p className="q-meta">{mode === 'mock' ? 'Пробник' : 'Диагностика'} · {i + 1} из {n}
        {it.type ? ` · задание № ${it.n}, тип ${it.type} из ${it.of_types}: ${it.type_name}` : it.choices ? ` · часть 2, задание № ${it.n}` : it.n ? ` · ${it.t === 'self' ? 'часть 2' : 'часть 1'}, задание № ${it.n}` : ''}</p>
      {it.choices
        ? <ChoiceBox key={it.id} run={run} item={it} onChoice={(c, w) => setRun((r) => (r ? { ...r, choice: c, work: w } : r))} />
        : <>
          <div className="q-text">{it.img ? <ProblemText q={it.q} img={it.img} ctx={it.ctx_img} /> : it.q.split('\n').map((l, k) => <span key={k}>{l}<br /></span>)}</div>
          {it.fig && <Figure k={it.fig} />}
          <p className="q-src">{it.src}</p>
        </>}
      {it.t === 'self'
        ? <SelfAssess item={it} value={run.answers[it.id]} onPick={(v) => { const r = setAnswer(v); if (r) next(r) }} />
        : <ItemWork key={it.id} run={run} item={it} llm={run.llm_ready} exam={ex} onAnswer={setAnswer} onWork={setWork} onNext={() => next(run)}
            onDontKnow={(r) => afterDontKnow(r)} locked={it.choices && !run.choice?.[it.id] ? 'Сначала выбери тип задания выше' : ''} />}
      {i > 0 && <button className="ob-link" onClick={() => { setI(i - 1); setErr('') }}>Назад</button>}
      {err && <p className="auth-msg">{err}</p>}
    </Frame>
  )
}

function Timer({ deadline }: { deadline: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  const left = Math.max(0, Math.round((deadline - now) / 1000))
  const h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60), sec = left % 60
  return <span className={`q-timer ${left < 900 ? 'low' : ''}`} role="timer" aria-label={`Осталось ${h} ч ${m} мин`}>{h}:{String(m).padStart(2, '0')}:{String(sec).padStart(2, '0')}</span>
}

function Frame({ children, top }: { children: ReactNode; top?: ReactNode }) {
  return (
    <div className="ob">
      <div className="ob-top"><span /><span />{top}</div>
      <div className="ob-screen">{children}</div>
    </div>
  )
}

const STATUS: Record<string, string> = {
  pending: 'фото загружено', done: 'решение проверено', skipped: 'фото сохранено', error: 'фото сохранено, проверить не удалось',
}

/** Answer (first part) + the photo of the solution, «решил устно» (task 8) or «не знаю». */
function ItemWork({ run, item, llm, exam, onAnswer, onWork, onNext, onDontKnow, locked }: {
  run: DiagRun; item: DiagItem; llm: boolean; exam?: boolean
  onAnswer: (v: string) => DiagRun | undefined; onWork: (w: Record<string, DiagWork>) => void; onNext: () => void
  /** after «не знаю»: the parent decides where to go (the diagnostic by types may offer to skip the task) */
  onDontKnow?: (r: DiagRun) => void
  /** a reason why the photo cannot be attached yet (part 2 by types: no type chosen) */
  locked?: string
}) {
  const num = item.t === 'num'
  const init = run.answers[item.id]
  const [ans, setAns] = useState(init && init !== '?' ? init : '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const w = run.work[item.id]
  const mode = w?.mode && w.mode !== 'dont_know' ? w.mode : null
  // in exam conditions any task can be left (blank = not solved), and the first part needs only the answer; base: photo optional
  const optional = item.photo === 'optional'
  const ready = exam || ((!num || ans.trim() !== '') && (mode === 'photo' || mode === 'oral' || optional))

  const upload = async (files: File[] | FileList | null) => {
    if (!files?.length) return
    setBusy(true); setMsg('')
    try { onWork((await uploadDiagWork(run.id, item.id, Array.from(files))).work) } catch (e) { setMsg(String(e).replace('Error: ', '')) }
    setBusy(false)
    if (fileRef.current) fileRef.current.value = ''
  }
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (busy || locked) return
      const imageItems = Array.from(event.clipboardData?.items ?? []).filter((x) => x.type.startsWith('image/'))
      if (!imageItems.length) return
      const files = imageItems.map((x, idx) => x.getAsFile()).filter((x): x is File => !!x)
        .map((file, idx) => new File([file], file.name || `clipboard-${Date.now()}-${idx}.png`, { type: file.type || 'image/png' }))
      if (files.length) { event.preventDefault(); void upload(files) }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [run.id, item.id, busy, locked])

  const pick = async (m: 'dont_know' | 'oral' | 'clear') => {
    setBusy(true); setMsg('')
    try {
      const r = await setDiagMode(run.id, item.id, m)
      onWork(r.work)
      if (m === 'dont_know') {
        const nr = onAnswer('?')
        if (onDontKnow && nr) onDontKnow({ ...nr, work: r.work }); else onNext()
      }
    } catch (e) { setMsg(String(e).replace('Error: ', '')) }
    setBusy(false)
  }
  const go = () => { if (num && (ans.trim() || !exam)) onAnswer(ans.trim()); onNext() }

  return (
    <div className="dw">
      {num && (
        <form className="ob-form" onSubmit={(e) => { e.preventDefault(); if (ready) go() }}>
          <label htmlFor="qIn" className="sr">Ответ</label>
          <input id="qIn" className="input ob-input" inputMode="text" autoComplete="off" placeholder="Ответ" value={ans} onChange={(e) => setAns(e.target.value)} />
        </form>
      )}
      <div className="dw-box">
        <p className="dw-h">{num ? (exam || optional ? 'Если у тебя есть решение, можешь прикрепить фото: я посмотрю, где ошибка' : 'Решение') : `Решение (максимум ${item.max} б.)`}</p>
        <input ref={fileRef} type="file" accept="image/*,.pdf,.heic,.heif" multiple hidden onChange={(e) => upload(e.target.files)} />
        <p className="dw-hint">Можно вставить скопированное изображение сочетанием Ctrl+V или ⌘V.</p>
        <div className="dw-btns">
          <button className={`btn ${mode === 'photo' ? 'btn-line' : 'btn-em'}`} disabled={busy || !!locked} onClick={() => fileRef.current?.click()}>
            <Icon n="check" s={18} />{mode === 'photo' ? 'Заменить фото' : 'Прикрепить фото решения'}</button>
          {item.oral && <button className={`btn ${mode === 'oral' ? 'btn-em' : 'btn-line'}`} disabled={busy} onClick={() => pick(mode === 'oral' ? 'clear' : 'oral')}>
            {mode === 'oral' ? <Icon n="ok" s={18} /> : null}Решил устно</button>}
        </div>
        {mode === 'photo' && w && <p className={`dw-st ${w.status === 'pending' ? 'pend' : ''}`}>{w.files} {plural(w.files, 'страница', 'страницы', 'страниц')} · {STATUS[w.status ?? 'pending']}{w.comment && w.status !== 'pending' ? `: ${w.comment}` : ''}</p>}
        {mode === 'photo' && !llm && <p className="dw-st">ИИ не подключён: решение сохранено, засчитается ответ.</p>}
        {mode === 'oral' && <p className="dw-st">Отмечено: решено устно, засчитается ответ.</p>}
        {locked && <p className="dw-st">{locked}</p>}
        {msg && <p className="auth-msg">{msg}</p>}
      </div>
      <div className="dw-go">
        <button className="btn btn-em" disabled={!ready || busy} onClick={go}>Дальше</button>
        {!exam && <button className="ob-link" disabled={busy} onClick={() => pick('dont_know')}>{num ? 'Не знаю' : 'Не знаю, как решать'}</button>}
      </div>
      {exam && <p className="dw-hint">Можно пропустить и вернуться: номера заданий сверху.</p>}
      {!ready && optional && <p className="dw-hint">Впиши ответ или нажми «Не знаю».</p>}
      {!ready && !optional && <p className="dw-hint">{(num && !ans.trim() ? 'Впиши ответ и п' : 'П') + (item.oral ? 'рикрепи решение или отметь «Решил устно».' : 'рикрепи фото решения.')} Или нажми «Не знаю».</p>}
    </div>
  )
}

/** Part 2 of the diagnostic by types: the student picks one type of the task and solves its problem. */
function ChoiceBox({ run, item, onChoice }: { run: DiagRun; item: DiagItem; onChoice: (c: Record<string, string>, w: Record<string, DiagWork>) => void }) {
  const cur = run.choice?.[item.id]
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const pick = async (c: DiagChoice) => {
    if (c.type === cur) return
    if (run.work[item.id]?.mode === 'photo' && !window.confirm('Фото решения прикреплено к другому типу. Выбрать этот тип? Фото придётся прикрепить заново.')) return
    setBusy(true); setMsg('')
    try { const r = await setDiagChoice(run.id, item.id, c.type); onChoice(r.choice, r.work) } catch (e) { setMsg(String(e).replace('Error: ', '')) }
    setBusy(false)
  }
  const sel = item.choices!.find((c) => c.type === cur)
  return (
    <div className="dch">
      <p className="q-ask">Выбери тип задания № {item.n}, который будешь решать (максимум {item.max} б.). Остальные типы траектория проверит позже.</p>
      <div className="dch-list" role="radiogroup" aria-label={`Типы задания ${item.n}`}>
        {item.choices!.map((c) => (
          <button key={c.type} role="radio" aria-checked={c.type === cur} className={`dch-opt ${c.type === cur ? 'on' : ''}`} disabled={busy} onClick={() => pick(c)}>
            <b className="num">{c.type}</b><span>{c.name}</span>
          </button>
        ))}
      </div>
      {msg && <p className="auth-msg">{msg}</p>}
      {sel && (
        <div className="dch-prob">
          <div className="q-text">{sel.img ? <ProblemText q={sel.q} img={sel.img} /> : sel.q.split('\n').map((l, k) => <span key={k}>{l}<br /></span>)}</div>
          <p className="q-src">{sel.src}</p>
        </div>
      )}
    </div>
  )
}

function SelfAssess({ item, value, onPick }: { item: DiagItem; value?: string; onPick: (v: string) => void }) {
  const opts: [string, string, string][] = [['full', 'Решу полностью', 'с обоснованием каждого шага'], ['part', 'Решу частично', 'один пункт или только модель'], ['none', 'Не возьмусь', 'пока не знаю, как подступиться']]
  return (
    <>
      <p className="q-ask">Как бы ты справился с этим заданием (максимум {item.max} б.)? Будь честен: от этого зависит расписание.</p>
      <div className="ob-list">
        {opts.map(([v, l, s]) => (
          <button key={v} className={`ob-choice ${value === v ? 'on' : ''}`} onClick={() => onPick(v)}>
            <span><b>{l}</b><small>{s}</small></span><Icon n="next" s={18} />
          </button>
        ))}
      </div>
    </>
  )
}

/* ---------- figures for tasks 8 and 11 (drawn from the demo data) ---------- */
function Figure({ k }: { k: string }) {
  const grid = (x0: number, x1: number, y0: number, y1: number, s: number) => {
    const out = []
    for (let x = x0; x <= x1; x++) out.push(<line key={'x' + x} x1={(x - x0) * s} y1={0} x2={(x - x0) * s} y2={(y1 - y0) * s} stroke="#dfe6e2" />)
    for (let y = y0; y <= y1; y++) out.push(<line key={'y' + y} x1={0} y1={(y1 - y) * s} x2={(x1 - x0) * s} y2={(y1 - y) * s} stroke="#dfe6e2" />)
    return out
  }
  const axes = (x0: number, x1: number, y0: number, y1: number, s: number) => (
    <g>
      <line x1={0} y1={y1 * s} x2={(x1 - x0) * s} y2={y1 * s} stroke="#16231F" strokeWidth={1.4} />
      <line x1={-x0 * s} y1={0} x2={-x0 * s} y2={(y1 - y0) * s} stroke="#16231F" strokeWidth={1.4} />
      <text x={(x1 - x0) * s - 10} y={y1 * s - 6} fontSize={13} fontStyle="italic">x</text>
      <text x={-x0 * s + 6} y={12} fontSize={13} fontStyle="italic">y</text>
      <text x={-x0 * s - 12} y={y1 * s + 14} fontSize={12}>0</text>
    </g>
  )
  const curve = (f: (x: number) => number, x0: number, y0: number, y1: number, s: number, a: number, b: number) => {
    let d = '', pen = false
    for (let x = a; x <= b + 1e-9; x += 0.05) {
      const y = f(x)
      if (!isFinite(y) || y < y0 - 0.3 || y > y1 + 0.3) { pen = false; continue }
      d += `${pen ? 'L' : 'M'}${((x - x0) * s).toFixed(1)} ${((y1 - y) * s).toFixed(1)} `
      pen = true
    }
    return <path d={d.trim()} fill="none" stroke="#174A3C" strokeWidth={2.4} />
  }
  const dot = (x: number, y: number, x0: number, y1: number, s: number) => <circle cx={(x - x0) * s} cy={(y1 - y) * s} r={4} fill="#C8372D" />
  if (k === 'tangent') {
    const [x0, x1, y0, y1, s] = [-3, 6, -1, 5, 34]
    const f = (x: number) => 2.6 - 0.2 * (x - 1) - 0.4 * (x - 1) * (x - 1), L = (x: number) => 3 - 0.2 * (x + 1)
    return (
      <svg viewBox={`-6 -6 ${(x1 - x0) * s + 12} ${(y1 - y0) * s + 12}`} className="qfig" role="img" aria-label="График функции и касательная">
        {grid(x0, x1, y0, y1, s)}{axes(x0, x1, y0, y1, s)}{curve(f, x0, y0, y1, s, -1.6, 3.6)}
        <line x1={0} y1={(y1 - L(-3)) * s} x2={(6 - x0) * s} y2={(y1 - L(6)) * s} stroke="#16231F" strokeWidth={1.6} />
        {dot(-1, 3, x0, y1, s)}{dot(4, 2, x0, y1, s)}
        <line x1={(1 - x0) * s} y1={(y1 - 2.6) * s} x2={(1 - x0) * s} y2={y1 * s} stroke="#16231F" strokeDasharray="4 4" />
        <text x={(1 - x0) * s - 6} y={y1 * s + 16} fontSize={13} fontStyle="italic">x₀</text>
        <text x={(4 - x0) * s - 4} y={y1 * s + 16} fontSize={12}>4</text>
        <text x={(-1 - x0) * s - 8} y={y1 * s + 16} fontSize={12}>−1</text>
      </svg>
    )
  }
  if (k === 'trig') {
    // f(x) = 2cos x + 1; one cell along x is π/2
    const [x0, x1, y0, y1, s] = [-1, 5, -2, 4, 30]
    const lbl = ['', 'π/2', 'π', '3π/2', '2π']
    return (
      <svg viewBox={`-6 -6 ${(x1 - x0) * s + 12} ${(y1 - y0) * s + 12}`} className="qfig" role="img" aria-label="График функции a·cos x + b">
        {grid(x0, x1, y0, y1, s)}{axes(x0, x1, y0, y1, s)}{curve((X) => 2 * Math.cos((X * Math.PI) / 2) + 1, x0, y0, y1, s, -1, 5)}
        {dot(0, 3, x0, y1, s)}{dot(2, -1, x0, y1, s)}
        {[1, 2, 3, 4].map((X) => <text key={X} x={(X - x0) * s - 10} y={y1 * s + 16} fontSize={11}>{lbl[X]}</text>)}
        <text x={-x0 * s - 14} y={(y1 - 1) * s + 4} fontSize={12}>1</text>
        <text x={-x0 * s - 14} y={(y1 - 3) * s + 4} fontSize={12}>3</text>
      </svg>
    )
  }
  if (k === 'hyper') {
    const [x0, x1, y0, y1, s] = [-4, 7, -4, 7, 26]
    return (
      <svg viewBox={`-6 -6 ${(x1 - x0) * s + 12} ${(y1 - y0) * s + 12}`} className="qfig" role="img" aria-label="График функции k/x">
        {grid(x0, x1, y0, y1, s)}{axes(x0, x1, y0, y1, s)}
        {curve((x) => 5 / x, x0, y0, y1, s, 0.72, 7)}{curve((x) => 5 / x, x0, y0, y1, s, -4, -0.72)}
        {dot(1, 5, x0, y1, s)}{dot(5, 1, x0, y1, s)}
        <text x={(1 - x0) * s - 4} y={y1 * s + 16} fontSize={12}>1</text>
        <text x={(5 - x0) * s - 4} y={y1 * s + 16} fontSize={12}>5</text>
        <text x={-x0 * s - 14} y={(y1 - 1) * s + 4} fontSize={12}>1</text>
      </svg>
    )
  }
  if (k === 'expo') {
    const [x0, x1, y0, y1, s] = [-3, 4, -1, 7, 30]
    return (
      <svg viewBox={`-6 -6 ${(x1 - x0) * s + 12} ${(y1 - y0) * s + 12}`} className="qfig" role="img" aria-label="График показательной функции">
        {grid(x0, x1, y0, y1, s)}{axes(x0, x1, y0, y1, s)}{curve((x) => Math.pow(0.25, x), x0, y0, y1, s, -1.4, 4)}
        {dot(-1, 4, x0, y1, s)}{dot(0, 1, x0, y1, s)}
        <text x={(-1 - x0) * s - 10} y={y1 * s + 16} fontSize={12}>−1</text>
        <text x={-x0 * s - 14} y={(y1 - 4) * s + 4} fontSize={12}>4</text>
        <text x={(1 - x0) * s - 4} y={y1 * s + 16} fontSize={12}>1</text>
      </svg>
    )
  }
  return null
}
