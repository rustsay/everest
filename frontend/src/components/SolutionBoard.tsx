import { useEffect, useRef, useState } from 'react'
import { useApp } from '../app/store'
import { Icon, StarBot, hush, prepareSpeech, reduceMotion, setSpeechRate, speak } from '../design/ui'
import type { VTask, Step } from '../pages/videoData'

export default function SolutionBoard({ n, task, onBack, onUnderstood, onNotUnderstood }: { n?: number; task: VTask; onBack: () => void; onUnderstood: () => void; onNotUnderstood: (step: Step) => void }) {
  const app = useApp()
  const v = task
  const [k, setK] = useState(0)
  const [c, setC] = useState(0)
  const [say, setSay] = useState(0)
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
  const total = st[1].join('').length
  const narration = st[2]
  const stepLines = st[1].join('\n')
  const stepCount = v.s.length

  useEffect(() => {
    if (!playing) { setC(Infinity); setSay(Infinity); setVoicing(false); setLoadingVoice(false); return }
    let cancelled = false
    let timer: number | undefined
    let iv: number | undefined
    let writingDone = false, voiceDone = !app.voice
    const advance = () => {
      if (cancelled || !writingDone || !voiceDone) return
      timer = window.setTimeout(() => {
        if (k < stepCount - 1) setK(k + 1)
        else { setPlaying(false); setEnd(true) }
      }, 600 / speedRef.current)
    }
    setC(0); setSay(0)
    setVoiceError(''); setVoicing(false); setLoadingVoice(app.voice)
    const startWriting = () => {
      if (cancelled) return
      setLoadingVoice(false); setVoicing(app.voice)
      let elapsed = 0, previous = performance.now()
      iv = window.setInterval(() => {
        const now = performance.now()
        elapsed += (now - previous) * speedRef.current
        previous = now
        setC(Math.floor(elapsed / 55)); setSay(Math.floor(elapsed / 30))
        if (elapsed >= Math.max(total * 55, narration.length * 30)) {
          clearInterval(iv)
          setC(Infinity); setSay(Infinity)
          writingDone = true
          advance()
        }
      }, 30)
    }
    if (app.voice) {
      void speak(narration, speedRef.current, startWriting, 'board').then((result) => {
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
    } else startWriting()
    return () => { cancelled = true; clearInterval(iv); clearTimeout(timer); hush('board') }
  }, [k, playing, app.voice, narration, stepLines, stepCount, total, playbackId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (end) app.say('Разбор закончен. Если понял, жми «Понял» и переходи к следующему заданию.')
  }, [end]) // eslint-disable-line react-hooks/exhaustive-deps

  const lines: { t: string; cls: string }[] = []
  const old: string[] = []
  for (let i = 0; i < k; i++) old.push(...v.s[i][1])
  old.slice(-3).forEach((t) => lines.push({ t, cls: 'old' }))
  let left = c
  for (const f of st[1]) {
    if (left <= 0) break
    const shown = f.slice(0, left)
    left -= f.length
    lines.push({ t: shown, cls: shown.length < f.length ? 'cur' : '' })
  }
  const talk = playing && (app.voice ? voicing : say < st[2].length)
  const got = onUnderstood
  const notGot = () => onNotUnderstood(st)

  return (
    <>
      <div className="v-head"><button className="btn btn-sm btn-ghost" onClick={onBack}><Icon n="prev" s={16} />Все задания</button>
        <div style={{ minWidth: 0 }}><p className="muted">{n ? 'Разбор · задание ' + n : 'Разбор своей задачи'}</p><h1>{v.t}</h1></div></div>
      <div className="v-cond"><span className="label">Условие</span><p>{v.c}</p></div>
      <div className="row">
        <section style={{ flex: '1.5 1 440px', minWidth: 0 }} aria-label="Видеоразбор">
          <div className="board">
            <div className="board-top"><span className="label" style={{ color: 'var(--gold-hi)' }}>Шаг {k + 1} из {v.s.length} · {st[0]}</span><span className="board-n">{n ? '№ ' + n : 'Решение'}</span></div>
            <div className="board-lines" aria-live="polite">{lines.map((l, i) => <div key={i} className={`ln ${l.cls}`}>{l.t}</div>)}</div>
            <div className="board-say"><StarBot size={54} talk={talk} /><p className="say-b">{st[2].slice(0, say)}</p></div>
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
          {v.s.map((s, i) => <button key={i} aria-current={i === k ? 'step' : undefined} onClick={() => replayStep(i)}><span>{i + 1}. {s[0]}</span><span>{i < k || app.dash?.vdone?.[String(n)] ? '✓' : ''}</span></button>)}
          {end && <p style={{ fontWeight: 700, marginTop: 6 }}>Разбор закончен. Всё понятно?</p>}
          <button className="btn btn-em" style={{ marginTop: 6 }} onClick={got}><Icon n="ok" s={18} />{n != null && n < 19 ? `Понял, к заданию ${n + 1}` : 'Понял, к списку заданий'}</button>
          <button className="btn btn-line" onClick={notGot}>Не понял</button>
          <button className="btn btn-ghost" onClick={() => app.go('check')}>Решить похожую и проверить</button>
        </section>
      </div>
    </>
  )
}
