import { ReactNode, useEffect, useRef, useState } from 'react'
import { getNotifications, joinClass, putSettings, readNotifications, sendEvent } from '../api/client'
import type { NotificationItem } from '../types'
import { Icon, Orn, SideMountains, StarBot, StarIcon, Typed, WideMountains, hush, plural, speak } from '../design/ui'
import { Logo } from '../pages/Onboarding'
import PhonePush from '../components/PhonePush'
import { STAR_LINES, defaultStarLine } from '../utils/starSpeech'
import { useApp, ViewName } from './store'

const NAV_S: [ViewName, string, string][] = [['home', 'Главная', 'home'], ['path', 'Траектория', 'flag'], ['plan', 'Расписание', 'cal'], ['check', 'Проверка', 'check'], ['task', 'Карты заданий', 'map'], ['practice', 'Банк задач', 'book'], ['video', 'Разборы', 'play'], ['diag', 'Разбор диагностики', 'bulb'], ['report', 'Итоги недели', 'clock'], ['chat', 'Помощник', 'chat'], ['awards', 'Звёзды', 'star']]
const BOT_S: [ViewName, string, string][] = [['home', 'Главная', 'home'], ['plan', 'План', 'cal'], ['check', 'Проверка', 'check'], ['practice', 'Банк', 'book'], ['chat', 'Помощник', 'chat']]
const NAV_T: [ViewName, string, string][] = [['teacher', 'Класс', 'class'], ['paths', 'Траектории', 'flag'], ['materials', 'Конспекты и презентации', 'slides'], ['task', 'Карты заданий', 'map'], ['bank', 'Банк задач', 'book'], ['variants', 'Варианты', 'pen'], ['tchat', 'Помощник учителя', 'chat'], ['report', 'Итоги недели', 'clock'], ['check', 'Проверка', 'check']]
const BOT_T: [ViewName, string, string][] = [['teacher', 'Класс', 'class'], ['paths', 'Пути', 'flag'], ['bank', 'Банк', 'book'], ['variants', 'Варианты', 'pen'], ['tchat', 'Помощник', 'chat']]

export default function Shell({ children }: { children: ReactNode }) {
  const app = useApp()
  const bubbleTimer = useRef<number>()
  useEffect(() => () => clearTimeout(bubbleTimer.current), [app.speech?.id])
  const { me, dash, view, go } = app
  const teacher = me.role !== 'student'
  const nav = [...(teacher ? NAV_T.map(([v, l, i]) => (v === 'teacher' && me.role === 'tutor' ? [v, 'Мои ученики', i] : [v, l, i]) as [ViewName, string, string]) : NAV_S),
    ...(me.admin ? [['admin', 'Админка', 'chart'] as [ViewName, string, string]] : [])]
  const bot = teacher ? BOT_T : BOT_S
  // on the phone the side menu is hidden: everything that is not in the bottom bar opens from «Ещё»
  const more = nav.filter(([v]) => !bot.some(([b]) => b === v))
  const cur = view.v === 'session' || view.v === 'trajectory' ? 'check' : view.v === 'variant' ? (teacher ? 'variants' : 'practice') : view.v
  const inMore = more.some(([v]) => v === cur)
  const [pop, setPop] = useState<NotificationItem[] | null>(null)
  const [notesBusy, setNotesBusy] = useState(false)
  const sayIdx = useRef<Record<string, number>>({})
  const clicks = useRef<number[]>([])
  const logoClicks = useRef<number[]>([])
  const [spin, setSpin] = useState(false)
  const [shake, setShake] = useState(false)
  const [unread, setUnread] = useState(dash?.unread ?? 0)
  useEffect(() => { setUnread(dash?.unread ?? 0) }, [dash?.unread])

  /* ---------- easter eggs ---------- */
  const egg = async (id: string, msg: string) => {
    try {
      const r = await sendEvent('egg', id)
      app.say(msg + (r.fresh_egg ? ' Секретная звезда твоя!' : ' Эту звезду ты уже находил.'))
      app.confetti(r.fresh_egg ? 160 : 60)
      app.reload()
    } catch { app.say(msg) }
  }
  const onLogo = () => {
    const now = Date.now()
    logoClicks.current = [...logoClicks.current.filter((t) => now - t < 3000), now]
    if (logoClicks.current.length >= 5) {
      logoClicks.current = []
      app.confetti(240, true)
      setShake(true)
      setTimeout(() => setShake(false), 1100)
      egg('avalanche', 'Лавина! Ты сорвал снег с вершины.')
    }
  }
  useEffect(() => {
    let buf = ''
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest && t.closest('input,textarea,select,[contenteditable]')) return
      if (!e.key || e.key.length !== 1) return
      buf = (buf + e.key.toLowerCase()).slice(-12)
      if (buf.endsWith('8848') || buf.endsWith('эверест') || buf.endsWith('everest')) {
        buf = ''
        app.openModal('Вершина!', (
          <>
            <div className="summit-egg"><WideMountains /></div>
            <p style={{ marginTop: 12, fontWeight: 700 }}>8848 метров. Ты напечатал высоту Эвереста.</p>
            <p className="muted" style={{ marginTop: 6 }}>А настоящая вершина на экзамене это все баллы. Идём дальше?</p>
          </>
        ))
        egg('summit', 'Ты на вершине!')
      }
    }
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  })

  const mascot = () => {
    const now = Date.now()
    clicks.current = [...clicks.current.filter((t) => now - t < 4000), now]
    if (clicks.current.length >= 7) {
      clicks.current = []
      setSpin(true)
      setTimeout(() => setSpin(false), 1200)
      egg('spin', 'Ух, голова кружится!')
      return
    }
    const lines = STAR_LINES[view.v] ?? [defaultStarLine]
    const i = (sayIdx.current[view.v] ?? 0) % lines.length
    sayIdx.current[view.v] = i + 1
    app.say(lines[i])
  }

  const markNotesRead = async (ids?: number[]) => {
    const result = await readNotifications(ids)
    setPop((notes) => notes?.map((n) => !ids || ids.includes(n.id) ? { ...n, read: true } : n) ?? null)
    setUnread(result.unread)
    void app.reload()
  }
  const openBell = async () => {
    if (notesBusy) return
    if (pop) { setPop(null); return }
    setNotesBusy(true)
    try {
      const notes = (await getNotifications()).notifications
      setPop(notes)
      const ids = notes.filter((n) => !n.read).map((n) => n.id)
      if (ids.length) {
        try { await markNotesRead(ids) }
        catch { app.toast('Не удалось отметить уведомления прочитанными. Попробуй «Прочитать все».') }
      }
    } catch { app.toast('Не удалось загрузить уведомления. Попробуй ещё раз.') }
    finally { setNotesBusy(false) }
  }

  const profile = () => app.openModal('Профиль', <Profile />)

  return (
    <div className={`app ev ${shake ? 'shaking' : ''}`} id="app">
      <aside className="side" aria-label="Меню">
        <div className="side-mtn" aria-hidden="true"><SideMountains /></div>
        <button className="brand" onClick={() => { onLogo(); go(teacher ? 'teacher' : 'home') }} aria-label="Эверест, на главную">
          <span className="brand-logo"><Logo /></span>
          <span><b>Эверест</b><br /><small style={{ color: 'var(--side-muted)' }}>подготовка к экзаменам</small></span>
        </button>
        <Orn style={{ margin: '-8px 0 -6px' }} />
        <nav className="nav" aria-label="Разделы">
          {nav.map(([v, l, i]) => (
            <button key={v} data-v={v} onClick={() => go(v)} aria-current={view.v === v || (v === 'check' && view.v === 'session') || (v === 'practice' && view.v === 'variant') || (v === 'variants' && view.v === 'variant') ? 'page' : undefined}><Icon n={i} />{l}</button>
          ))}
        </nav>
        <div className="side-foot">
          <button className="prof-row" onClick={profile} aria-label="Профиль">
            <span className="av-in">{(me.name || me.email || '?')[0].toUpperCase()}</span>
            <span style={{ minWidth: 0, flex: 1 }}><b>{me.name || me.email}</b><small>{me.role === 'tutor' ? 'Репетитор' : me.role === 'teacher' ? 'Учитель' : `Ученик${me.grade ? ', ' + me.grade + ' класс' : ''}`}</small></span>
          </button>
          <button className="btn btn-gold" onClick={() => go('check')}><Icon n="check" s={18} c="#16231F" />Проверить решение</button>
        </div>
      </aside>

      <div className="main">
        <header className="top">
          <button className="brand mob-brand" onClick={() => { onLogo(); go(teacher ? 'teacher' : 'home') }} aria-label="На главную" style={{ color: 'var(--ink)' }}>
            <span className="brand-logo" style={{ width: 40, height: 40 }}><Logo s={26} /></span>
          </button>
          <span className="top-spacer" />
          {!teacher && dash && (
            <>
              <button className="chip" id="altChip" onClick={() => go('awards')} aria-label="Высота и звёзды">
                <svg width="18" height="18" viewBox="0 0 30 30" aria-hidden="true"><path d="M2 25 L12 9 L16 15 L19 11 L28 25 Z" fill="var(--em-3)" /><path d="M12 9 L14.8 13.4 L12.6 12.4 L10.6 13.8 Z" fill="var(--gold)" /></svg>
                <span className="num">{dash.xp.toLocaleString('ru-RU')} м</span><span className="hide-m muted" style={{ fontWeight: 600 }}>· {dash.stage.current}</span>
              </button>
              <button className="chip alt" id="streakChip" onClick={() => go('awards')} aria-label="Звёзды">
                <StarIcon s={18} /><span className="num">{dash.stars.total}</span><span className="hide-m muted" style={{ fontWeight: 600 }}>{plural(dash.stars.total, 'звезда', 'звезды', 'звёзд')}</span>
              </button>
            </>
          )}
          <button className="iconbtn" id="bellBtn" onClick={openBell} disabled={notesBusy} aria-busy={notesBusy} aria-label={unread ? `Уведомления, непрочитанных: ${unread}` : 'Уведомления'} aria-expanded={!!pop}>
            <Icon n="bell" />
            {unread > 0 && <span className="badge num">{unread}</span>}
          </button>
          <button className="iconbtn avatar" onClick={profile} aria-label={'Профиль: ' + (me.name || me.email)}><span className="av-in">{(me.name || me.email || '?')[0].toUpperCase()}</span></button>
        </header>
        <main id="view" className="view" key={view.v + (view.id ?? '')}>{children}</main>
      </div>

      <nav className="bottom" aria-label="Разделы">
        {bot.map(([v, l, i]) => (
          <button key={v} data-v={v} onClick={() => go(v)} aria-current={view.v === v || (v === 'practice' && view.v === 'variant') || (v === 'variants' && view.v === 'variant') || (v === 'check' && view.v === 'session') ? 'page' : undefined}><Icon n={i} s={22} />{l}</button>
        ))}
        <button data-v="more" onClick={() => app.openModal('Все разделы', <MoreMenu items={more} />)} aria-current={inMore ? 'page' : undefined} aria-label="Ещё разделы"><Icon n="more" s={22} />Ещё</button>
      </nav>

      {pop && (
        <div className="pop" role="dialog" aria-label="Уведомления">
          <div className="card-h" style={{ padding: '6px 6px 0', marginBottom: 6 }}>
            <h2>Уведомления</h2>
            <button className="btn btn-sm btn-ghost" disabled={notesBusy || (!unread && pop.every((n) => n.read))} onClick={async () => {
              setNotesBusy(true)
              try { await markNotesRead() }
              catch { app.toast('Не удалось отметить уведомления прочитанными. Попробуй ещё раз.') }
              finally { setNotesBusy(false) }
            }}>Прочитать все</button>
          </div>
          {pop.length ? pop.map((n) => (
            <button key={n.id} className={`note ${n.read ? 'read' : ''}`} disabled={notesBusy} onClick={async () => {
              if (!n.read) await markNotesRead([n.id]).catch(() => app.toast('Не удалось отметить уведомление прочитанным.'))
              setPop(null); if (n.go) go(n.go as ViewName)
            }}>
              <span className="nd" />
              <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: 'block', fontWeight: n.read ? 600 : 800, fontSize: 14 }}>{n.text}</span>
                <span className="muted" style={{ fontSize: 12 }}>{n.created_at ? new Date(n.created_at + (n.created_at.endsWith('Z') ? '' : 'Z')).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</span></span>
            </button>
          )) : <p className="muted" style={{ padding: 10 }}>Пока пусто</p>}
        </div>
      )}

      <button className="mascot-fab" onClick={mascot} aria-label="Звёздочка: подсказка"><StarBot size={76} talk={app.talking} spin={spin} /></button>
      {app.speech && (
        <div className="bubble" role="status" key={app.speech.id}>
          <div className="bubble-h"><b>Звёздочка</b>
            <span style={{ display: 'flex', gap: 6 }}>
              <button className="bub-btn" aria-pressed={app.voice} aria-label={app.voice ? 'Выключить голос' : 'Включить голос'} onClick={() => { const v = !app.voice; app.setVoice(v); putSettings({ voice: v }).catch(() => null); if (v) speak(app.speech!.text); else hush() }}><Icon n={app.voice ? 'vol' : 'mute'} s={18} /></button>
              <button className="bub-btn" aria-label="Закрыть" onClick={app.hideSpeech}><Icon n="close" s={18} /></button>
            </span>
          </div>
          <Typed text={app.speech.text} onTyping={app.setTalking} onDone={() => { clearTimeout(bubbleTimer.current); bubbleTimer.current = window.setTimeout(() => app.hideSpeech(), 9000) }} />
        </div>
      )}
      <Care />
    </div>
  )
}

/* ---------- «Ещё» on the phone: the sections that do not fit into the bottom bar ---------- */
function MoreMenu({ items }: { items: [ViewName, string, string][] }) {
  const { go, view } = useApp()
  return (
    <div className="more-grid">
      {items.map(([v, l, i]) => (
        <button key={v} className={`more-item ${view.v === v ? 'on' : ''}`} onClick={() => go(v)}><Icon n={i} s={22} /><span>{l}</span></button>
      ))}
    </div>
  )
}

/* ---------- profile modal ---------- */
function Profile() {
  const { me, dash, setMe, logout, toast, closeModal, voice, setVoice, go } = useApp()
  const [care, setCare] = useState({ breaks: me.settings.care?.breaks ?? true, sleep: me.settings.care?.sleep ?? true })
  const [code, setCode] = useState('')
  const [msg, setMsg] = useState('')
  const toggle = async (k: 'breaks' | 'sleep') => {
    const nc = { ...care, [k]: !care[k] }
    setCare(nc)
    await putSettings({ care: nc }).catch(() => null)
    setMe({ ...me, settings: { ...me.settings, care: nc } })
  }
  return (
    <>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        <span className="avatar-big">{(me.name || me.email || '?')[0].toUpperCase()}</span>
        <div style={{ minWidth: 0 }}><b style={{ fontSize: 17 }}>{me.name || 'Без имени'}</b><br /><span className="muted">{me.role === 'tutor' ? 'Репетитор' : me.role === 'teacher' ? 'Учитель' : 'Ученик'} · {me.email}</span></div>
      </div>
      {dash && (
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <span className="pill p-gold"><StarIcon s={14} /> {dash.stars.total} звёзд</span>
          <span className="pill p-em">{dash.xp.toLocaleString('ru-RU')} м · {dash.stage.current}</span>
          <span className="pill p-em">{me.grade} класс · {me.exam_info.short}</span>
        </div>
      )}
      <Orn style={{ margin: '16px 0' }} />
      {me.role === 'student' && (
        <form style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }} onSubmit={async (e) => {
          e.preventDefault()
          try { const c = await joinClass(code); setMsg(`Вы в классе «${c.name}»`); toast(`Вы в классе «${c.name}»`) } catch (err) { setMsg(String(err).replace('Error: ', '')) }
        }}>
          <div className="field" style={{ flex: '1 1 160px' }}><label htmlFor="clsCode">Код класса от учителя</label><input id="clsCode" className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="например, 4F2A9C" /></div>
          <button className="btn btn-line" style={{ alignSelf: 'flex-end' }} type="submit">Вступить</button>
          {(msg || (me.classes && me.classes.length > 0)) && <p className="muted" style={{ width: '100%', fontSize: 13 }}>{msg || 'Классы: ' + me.classes!.map((c) => c.name).join(', ')}</p>}
        </form>
      )}
      <span className="flabel">Забота о себе</span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className={`btn btn-sm ${care.breaks ? 'btn-em' : 'btn-ghost'}`} onClick={() => toggle('breaks')}><Icon n="eye" s={16} />Перерыв каждые 45 мин: {care.breaks ? 'вкл' : 'выкл'}</button>
        <button className={`btn btn-sm ${care.sleep ? 'btn-em' : 'btn-ghost'}`} onClick={() => toggle('sleep')}><Icon n="moon" s={16} />Напоминать про сон: {care.sleep ? 'вкл' : 'выкл'}</button>
        <button className="btn btn-sm btn-ghost" onClick={() => { closeModal(); window.dispatchEvent(new Event('everest:break')) }}>Сделать перерыв сейчас</button>
      </div>
      <PhonePush />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
        <button className="btn btn-ghost" onClick={() => { const v = !voice; setVoice(v); putSettings({ voice: v }).catch(() => null) }}><Icon n={voice ? 'vol' : 'mute'} s={18} />Голос Звёздочки: {voice ? 'вкл' : 'выкл'}</button>
        {me.admin && <button className="btn btn-ghost" onClick={() => go('admin')}><Icon n="chart" s={18} />Админка</button>}
        <button className="btn btn-line" onClick={() => { closeModal(); logout() }}><Icon n="logout" s={18} />Выйти</button>
      </div>
    </>
  )
}

/* ---------- care: breaks, eyes, sleep ---------- */
const EYE_STEPS: [string, string, number][] = [['Следи за точкой глазами, голову не поворачивай', 'lr', 8], ['Теперь вверх и вниз', 'ud', 8], ['По кругу', 'circ', 8], ['Закрой глаза на 5 секунд', 'close', 5], ['Посмотри в окно, на что-то далеко, 20 секунд', 'far', 20]]

function Care() {
  const app = useApp()
  const appRef = useRef(app)
  appRef.current = app
  const [offer, setOffer] = useState<'offer' | 'eyes' | null>(null)
  const [step, setStep] = useState(0)
  const [left, setLeft] = useState(0)
  const sess = useRef(0)
  const lastAct = useRef(Date.now())
  const asked = useRef(0)
  const lateAsked = useRef('')
  const day = useRef<{ d: string; min: number }>({ d: '', min: 0 })

  useEffect(() => {
    const act = () => { lastAct.current = Date.now() }
    const evs = ['pointerdown', 'keydown', 'scroll', 'touchstart']
    evs.forEach((e) => addEventListener(e, act, { passive: true }))
    const manual = () => { sess.current = Math.max(sess.current, 1); setOffer('offer') }
    addEventListener('everest:break', manual)
    const t = setInterval(() => {
      if (document.visibilityState !== 'visible' || Date.now() - lastAct.current > 120000) return
      sess.current++
      const today = new Date().toDateString()
      if (day.current.d !== today) day.current = { d: today, min: 0 }
      day.current.min++
      const h = new Date().getHours() + new Date().getMinutes() / 60
      const care = appRef.current.me.settings.care ?? {}
      if (care.sleep !== false && (h >= 22.5 || h < 6) && lateAsked.current !== today) {
        lateAsked.current = today
        appRef.current.say('Уже поздно. Если лечь сейчас, завтра решится легче: сон закрепляет то, что ты выучил. Продолжим утром?')
      }
      if (care.breaks !== false && sess.current >= 45 && Date.now() - asked.current > 600000) { asked.current = Date.now(); setOffer('offer') }
      if (day.current.min === 180) appRef.current.say('Сегодня ты занимаешься уже 3 часа. Это много: лучше остановиться и отдохнуть.')
    }, 60000)
    return () => { clearInterval(t); evs.forEach((e) => removeEventListener(e, act)); removeEventListener('everest:break', manual) }
  }, [])

  useEffect(() => {
    if (offer !== 'eyes') return
    if (step >= EYE_STEPS.length) {
      setOffer(null)
      sendEvent('break').then(() => appRef.current.reload()).catch(() => null)
      appRef.current.say('Отлично! Глаза отдохнули, можно продолжать.')
      return
    }
    setLeft(EYE_STEPS[step][2])
    const t = setInterval(() => setLeft((l) => {
      if (l <= 1) { clearInterval(t); setStep((s) => s + 1); return 0 }
      return l - 1
    }), 1000)
    return () => clearInterval(t)
  }, [offer, step])

  if (!offer) return null
  return (
    <div className="scrim" onClick={(e) => { if (e.target === e.currentTarget) setOffer(null) }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="careT">
        <div className="modal-h"><h2 id="careT">{offer === 'offer' ? 'Пора сделать перерыв' : 'Гимнастика для глаз'}</h2><button className="iconbtn" onClick={() => setOffer(null)} aria-label="Закрыть"><Icon n="close" /></button></div>
        {offer === 'offer' ? (
          <>
            <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}><StarBot size={64} /><p style={{ fontWeight: 600 }}>Ты занимаешься {sess.current} {plural(sess.current, 'минуту', 'минуты', 'минут')} подряд. Давай 5 минут отдыха: встань, попей воды и сделай гимнастику для глаз.</p></div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
              <button className="btn btn-em" autoFocus onClick={() => { sess.current = 0; setStep(0); setOffer('eyes') }}><Icon n="eye" s={18} />Гимнастика для глаз</button>
              <button className="btn btn-ghost" onClick={() => { sess.current = 35; asked.current = 0; setOffer(null) }}>Через 10 минут</button>
            </div>
          </>
        ) : step < EYE_STEPS.length ? (
          <>
            <p style={{ fontWeight: 700, textAlign: 'center' }}>{EYE_STEPS[step][0]}</p>
            <div className="eyebox"><span className={`eyedot ${EYE_STEPS[step][1]}`} /></div>
            <p className="muted num" style={{ textAlign: 'center' }}>{left} с</p>
          </>
        ) : null}
      </div>
    </div>
  )
}
