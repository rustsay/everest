import { ReactNode, useEffect, useRef, useState } from 'react'
import { useApp } from '../app/store'
import { Icon, StarBot, hush, prepareSpeech, reduceMotion, setSpeechRate, speak } from '../design/ui'
import type { VTask, Step } from '../pages/videoData'
import BoardFig from './BoardFig'
import BoardMath from './BoardMath'
import ProblemText from './ProblemText'
import GeometryFigure from './GeometryFigure'
import type { GeometryDiagram, WalkthroughFeedback } from '../types'

export default function SolutionBoard({ n, task, onBack, onUnderstood, onNotUnderstood, proto, label, backLabel, doneLabel, img, ctx, feedback, conditionFigure, diagram, onRefresh, refreshing }: {
  n?: number; task: VTask; onBack: () => void; onUnderstood: () => void; onNotUnderstood: (step: Step) => void
  /** figure of a task map prototype (bank problems: string or null, so the typical drawing is not shown); label: line above the title */
  proto?: string | null; label?: string; backLabel?: string; doneLabel?: string
  /** picture of the condition (open FIPI bank) */
  img?: string | null
  /** OGE 1-5: the shared text above the problem */
  ctx?: string | null
  feedback?: WalkthroughFeedback
  conditionFigure?: ReactNode
  diagram?: GeometryDiagram | null
  onRefresh?: () => void
  refreshing?: boolean
}) {
  const app = useApp()
  const v = task
  const [k, setK] = useState(0)
  const [written, setWritten] = useState(0)
  const [playing, setPlaying] = useState(!reduceMotion)
  const [end, setEnd] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [voicing, setVoicing] = useState(false)
  const [loadingVoice, setLoadingVoice] = useState(false)
  const [voiceError, setVoiceError] = useState('')
  const speedRef = useRef(speed)
  speedRef.current = speed
  useEffect(() => { setSpeechRate(speed) }, [speed])
  const [playbackId, setPlaybackId] = useState(0)
  const replayStep = (index: number) => { setEnd(false); setK(index); setPlaying(true); setPlaybackId((id) => id + 1) }
  const st = v.s[k]
  const narration = st[2]
  const explanation = st[3]?.trim() || ''
  const compact = (s: string) => s.trim().replace(/\s+/g, ' ')
  const reason = compact(explanation) === compact(st[1].join(' ')) || (st[1].length > 0 && compact(explanation) === compact(narration))
    ? '' : explanation
  const lineCount = st[1].length
  const stepCount = v.s.length

  useEffect(() => {
    if (!playing) { setWritten(Infinity); setVoicing(false); setLoadingVoice(false); return }
    let cancelled = false
    let timer: number | undefined
    let writingDone = false, voiceDone = !app.voice
    const advance = () => {
      if (cancelled || !writingDone || !voiceDone) return
      timer = window.setTimeout(() => {
        if (k < stepCount - 1) setK(k + 1)
        else { setPlaying(false); setEnd(true) }
      }, 600 / speedRef.current)
    }
    setWritten(reduceMotion ? lineCount : 1)
    setVoiceError(''); setVoicing(false); setLoadingVoice(app.voice)
    const perLine = 680
    const duration = Math.max(1700, lineCount * perLine, narration.length * 30, Math.min(15000, reason.length * 42))
    let elapsed = 0, previous = performance.now()
    const iv = window.setInterval(() => {
      const now = performance.now()
      elapsed += (now - previous) * speedRef.current
      previous = now
      if (!reduceMotion) setWritten(Math.min(lineCount, 1 + Math.floor(elapsed / perLine)))
      if (elapsed >= duration) {
        clearInterval(iv)
        writingDone = true
        advance()
      }
    }, 60)
    if (app.voice) {
      void speak(narration, speedRef.current, () => {
        if (!cancelled) { setLoadingVoice(false); setVoicing(true) }
      }, 'board').then((result) => {
        if (cancelled) return
        setVoicing(false); setLoadingVoice(false)
        if (result === 'cancelled') { setPlaying(false); return }
        if (result === 'error' || result === 'blocked') {
          setVoiceError(result === 'blocked' ? 'Нажмите «Смотреть», чтобы включить звук.' : 'Озвучка не загрузилась. Нажмите «Смотреть», чтобы повторить.')
          setPlaying(false); return
        }
        voiceDone = true
        advance()
      })
      // The next clips load while the current one plays, rather than between steps.
      for (const next of v.s.slice(k + 1, k + 3)) void prepareSpeech(next[2]).catch(() => {})
    }
    return () => { cancelled = true; clearInterval(iv); clearTimeout(timer); hush('board') }
  }, [k, playing, app.voice, narration, reason, stepCount, lineCount, playbackId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (end) app.say('Разбор закончен. Если понял, жми «Понял» и переходи к следующему заданию.')
  }, [end]) // eslint-disable-line react-hooks/exhaustive-deps

  const previousLine = v.s[k - 1]?.[1].slice(-1)[0]
  const visibleLines = st[1].slice(0, written)
  const talk = playing && (app.voice ? voicing : written < lineCount)
  const got = onUnderstood
  const notGot = () => onNotUnderstood(lineCount ? st : [st[0], [reason || narration], narration, st[3]])

  return (
    <>
      <div className="v-head"><button className="btn btn-sm btn-ghost" onClick={onBack}><Icon n="prev" s={16} />{backLabel ?? 'Все задания'}</button>
        <div style={{ minWidth: 0 }}><p className="muted">{label ?? (n ? 'Разбор · задание ' + n : 'Разбор своей задачи')}</p><h1><BoardMath text={v.t} /></h1></div>
        {onRefresh && <button className="btn btn-sm btn-line" onClick={onRefresh} disabled={refreshing}>Обновить разбор</button>}
      </div>
      <div className="v-cond"><span className="label">Условие</span>{img || ctx ? <ProblemText q={v.c} img={img} ctx={ctx} small /> : <p><BoardMath text={v.c} /></p>}</div>
      {conditionFigure}
      {feedback && <section className="card" aria-label="Твой результат в диагностике">
        <b>Твой результат: {feedback.label}</b>
        {feedback.answer != null && <p style={{ marginTop: 6 }}>Твой ответ: <b>{feedback.answer}</b>{feedback.right != null && <> · верный: <b>{feedback.right}</b></>}</p>}
        {feedback.note && feedback.note !== feedback.errors.join('; ') && <p style={{ marginTop: 6 }}>{feedback.note}</p>}
        {feedback.errors.length > 0 && <ul style={{ marginTop: 6, paddingLeft: 20, listStyle: 'disc' }}>{feedback.errors.map((error, i) => <li key={i}>{error}</li>)}</ul>}
        {!feedback.note && !feedback.errors.length && <p className="muted" style={{ marginTop: 6 }}>{feedback.kind === 'dont_know' || feedback.kind === 'none'
          ? 'В диагностике решения не было. Разберём задачу с начала.'
          : 'Точный шаг ошибки не определён. Сравни своё решение с шагами разбора.'}</p>}
      </section>}
      <div className="row">
        <section style={{ flex: '1.5 1 440px', minWidth: 0 }} aria-label="Видеоразбор">
          <div className={diagram ? 'board board--geometry' : 'board'}>
            <div className="board-top"><span className="label" style={{ color: 'var(--gold-hi)' }}>Шаг {k + 1} из {v.s.length} · <BoardMath text={st[0]} /></span><span className="board-n">{n ? '№ ' + n : 'Решение'}</span></div>
            <div className="board-mid">
              <div className="board-lines">
                {previousLine && <div className="ln old" aria-hidden="true"><BoardMath text={previousLine} /></div>}
                <div className="board-work" aria-live="polite">
                  {visibleLines.map((line, i) => <div key={i} className="ln"><BoardMath text={line} /></div>)}
                  {reason && (visibleLines.length > 0 || lineCount === 0) && <p className="board-reason"><BoardMath text={reason} /></p>}
                </div>
              </div>
              {diagram ? <GeometryFigure diagram={diagram} step={k + 1} /> : <BoardFig n={proto === undefined ? n : undefined} proto={proto} />}
            </div>
            <div className="board-say"><StarBot size={54} talk={talk} /><p className="say-b"><BoardMath text={narration} /></p></div>
          </div>
          <div className="bprog">{v.s.map((_, i) => <i key={i} className={i < k || (end && i === k) ? 'done' : i === k ? 'cur' : ''} />)}</div>
          <div className="vctl">
            <button className="iconbtn" onClick={() => replayStep(0)} aria-label="С начала"><Icon n="restart" s={18} /></button>
            <button className="iconbtn" disabled={k === 0} onClick={() => replayStep(Math.max(0, k - 1))} aria-label="Предыдущий шаг"><Icon n="prev" /></button>
            <button className="iconbtn play" onClick={() => { if (end) { setEnd(false); setK(0) } setPlaying(!playing || end) }} aria-label={playing ? 'Пауза' : 'Смотреть'}>
              {playing ? <svg width="20" height="20" viewBox="0 0 24 24" fill="#16231F" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
                : <svg width="20" height="20" viewBox="0 0 24 24" fill="#16231F" aria-hidden="true"><path d="M7 4v16l13-8z" /></svg>}
            </button>
            <button className="iconbtn" onClick={() => { if (k < v.s.length - 1) replayStep(k + 1); else { setPlaying(false); setEnd(true) } }} aria-label="Следующий шаг"><Icon n="next" /></button>
            <button className="chip" onClick={() => setSpeed(speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1)} aria-label="Скорость">{String(speed).replace('.', ',')}×</button>
          </div>
          {loadingVoice && <p className="muted" role="status">Готовим озвучку…</p>}
          {voiceError && <p role="status">{voiceError}</p>}
        </section>
        <section style={{ flex: '1 1 280px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }} className="steps" aria-label="Шаги решения">
          <h2>Шаги решения</h2>
          {v.s.map((s, i) => <button key={i} aria-current={i === k ? 'step' : undefined} onClick={() => replayStep(i)}><span>{i + 1}. <BoardMath text={s[0]} /></span><span>{i < k || (proto === undefined && app.dash?.vdone?.[String(n)]) ? '✓' : ''}</span></button>)}
          {end && <p style={{ fontWeight: 700, marginTop: 6 }}>Разбор закончен. Всё понятно?</p>}
          <button className="btn btn-em" style={{ marginTop: 6 }} onClick={got}><Icon n="ok" s={18} />{doneLabel ?? (n != null && n < 19 ? `Понял, к заданию ${n + 1}` : 'Понял, к списку заданий')}</button>
          <button className="btn btn-line" onClick={notGot}>Не понял</button>
          <button className="btn btn-ghost" onClick={() => app.go('check')}>Решить похожую и проверить</button>
        </section>
      </div>
    </>
  )
}
