import { FormEvent, useState } from 'react'
import { authConfig, demoLogin, login, putProfile, registerFull, resetPassword, sendCode } from '../api/client'
import type { Me } from '../types'
import { Icon, Orn, StarBot, Typed, WideMountains } from '../design/ui'

type Step = 'hello' | 'role' | 'name' | 'grade' | 'grade58' | 'exam' | 'account' | 'login'

interface Props {
  /** set when the user is logged in but has no class/exam yet */
  me?: Me | null
  onToken: (token: string, email: string) => void
  onProfile?: (me: Me) => void
}

function Choice({ label, sub, on, onClick }: { label: string; sub?: string; on?: boolean; onClick: () => void }) {
  return (
    <button className={`ob-choice ${on ? 'on' : ''}`} onClick={onClick}>
      <span><b>{label}</b>{sub && <small>{sub}</small>}</span>
      <Icon n="next" s={18} />
    </button>
  )
}

export default function Onboarding({ me, onToken, onProfile }: Props) {
  const [step, setStep] = useState<Step>(me ? 'grade' : 'hello')
  const [back, setBack] = useState<Step[]>([])
  const [d, setD] = useState<{ role: string; name: string; grade: string; exam: string }>({
    role: me?.role ?? 'student', name: me?.name ?? '', grade: '', exam: '',
  })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  // email code: at registration (when the server asks for it) and for «Забыли пароль»
  const [acc, setAcc] = useState<{ email: string; password: string } | null>(null)
  const [mode, setMode] = useState<'login' | 'reset' | 'reset2'>('login')
  const [resetEmail, setResetEmail] = useState('')
  const [info, setInfo] = useState('')
  const fail = (e2: unknown) => setErr(String(e2).replace('Error: ', ''))

  const show = (s: Step) => { setBack((b) => [...b, step]); setStep(s); setErr('') }
  const goBack = () => setBack((b) => { const nb = [...b]; const p = nb.pop(); if (p) setStep(p); return nb })

  const afterExam = async (exam: string) => {
    const nd = { ...d, exam }
    setD(nd)
    if (me) {
      setBusy(true)
      try { onProfile?.(await putProfile({ grade: nd.grade, exam })) } catch (e) { setErr(String(e).replace('Error: ', '')) } finally { setBusy(false) }
    } else show('account')
  }

  const register = async (email: string, password: string, code?: string) => {
    const student = d.role === 'student'
    const r = await registerFull({ email, password, name: d.name, role: d.role, grade: student ? d.grade : null, exam: student ? d.exam : null, code })
    onToken(r.token, r.email)
  }

  const createAccount = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const email = String(f.get('email') || '').trim().toLowerCase(), password = String(f.get('password') || '')
    if (!/^\S+@\S+\.\S+$/.test(email)) return setErr('Проверь почту: нужен адрес вида name@mail.ru')
    if (password.length < 6) return setErr('Пароль должен быть не короче 6 символов')
    setBusy(true); setErr('')
    try {
      const cfg = await authConfig().catch(() => ({ email_confirm: true }))
      if (!cfg.email_confirm) return await register(email, password)
      await sendCode(email, 'register')
      setAcc({ email, password })
    } catch (e2) { fail(e2) } finally { setBusy(false) }
  }

  const confirmAccount = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!acc) return
    const code = String(new FormData(e.currentTarget).get('code') || '').replace(/\D/g, '')
    if (code.length !== 6) return setErr('В коде 6 цифр')
    setBusy(true); setErr('')
    try { await register(acc.email, acc.password, code) } catch (e2) { fail(e2) } finally { setBusy(false) }
  }

  const resend = async (email: string, purpose: 'register' | 'reset') => {
    setErr(''); setInfo('')
    try { await sendCode(email, purpose); setInfo('Отправили новый код') } catch (e2) { fail(e2) }
  }

  const askReset = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const email = String(new FormData(e.currentTarget).get('email') || '').trim().toLowerCase()
    if (!/^\S+@\S+\.\S+$/.test(email)) return setErr('Нужен адрес вида name@mail.ru')
    setBusy(true); setErr(''); setInfo('')
    try { await sendCode(email, 'reset'); setResetEmail(email); setMode('reset2') } catch (e2) { fail(e2) } finally { setBusy(false) }
  }

  const doReset = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const code = String(f.get('code') || '').replace(/\D/g, ''), password = String(f.get('password') || '')
    if (code.length !== 6) return setErr('В коде 6 цифр')
    if (password.length < 6) return setErr('Пароль должен быть не короче 6 символов')
    setBusy(true); setErr('')
    try { const r = await resetPassword(resetEmail, code, password); onToken(r.token, r.email) } catch (e2) { fail(e2) } finally { setBusy(false) }
  }

  const doLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    setBusy(true)
    try {
      const r = await login(String(f.get('email') || '').trim().toLowerCase(), String(f.get('password') || ''))
      onToken(r.token, r.email)
    } catch (e2) { setErr(String(e2).replace('Error: ', '')) } finally { setBusy(false) }
  }

  const demo = async () => {
    setBusy(true)
    try { const r = await demoLogin(); onToken(r.token, r.email) } catch (e2) { setErr(String(e2).replace('Error: ', '')) } finally { setBusy(false) }
  }

  let body
  if (step === 'hello') {
    body = (
      <div className="ob-hello">
        <svg className="hello-svg" viewBox="0 0 520 170" role="img" aria-label="привет"><text x="50%" y="120" textAnchor="middle" className="hello-t">привет</text></svg>
        <p className="ob-l1">Хочешь вместе готовиться к профильной математике?</p>
        <p className="ob-l2">Тогда проверь свои силы сейчас</p>
        <div className="ob-l3">
          <button className="btn btn-em ob-go" onClick={() => show('role')}>Начать</button>
          <button className="ob-link" onClick={() => show('login')}>У меня уже есть аккаунт</button>
          <button className="ob-link" onClick={demo} disabled={busy}>Посмотреть пример</button>
          {err && <p className="auth-msg">{err}</p>}
        </div>
      </div>
    )
  } else if (step === 'role') {
    body = (<>
      <h1 className="ob-h">Кто ты?</h1>
      <div className="ob-list">
        <Choice label="Ученик" sub="готовлюсь к экзамену или учусь в школе" on={d.role === 'student'} onClick={() => { setD({ ...d, role: 'student' }); show('name') }} />
        <Choice label="Учитель" sub="веду класс" on={d.role === 'teacher'} onClick={() => { setD({ ...d, role: 'teacher' }); show('name') }} />
        <Choice label="Репетитор" sub="занимаюсь с учениками" on={d.role === 'tutor'} onClick={() => { setD({ ...d, role: 'tutor' }); show('name') }} />
      </div>
    </>)
  } else if (step === 'name') {
    body = (<>
      <h1 className="ob-h">Как тебя зовут?</h1>
      <form className="ob-form" onSubmit={(e) => { e.preventDefault(); const v = String(new FormData(e.currentTarget).get('name') || '').trim(); if (!v) return; setD({ ...d, name: v.slice(0, 40) }); show(d.role === 'student' ? 'grade' : 'account') }}>
        <input name="name" className="input ob-input" autoComplete="given-name" placeholder="Имя" defaultValue={d.name} maxLength={40} autoFocus />
        <button className="btn btn-em" type="submit">Дальше</button>
      </form>
    </>)
  } else if (step === 'grade') {
    body = (<>
      <h1 className="ob-h">В каком ты классе?</h1>
      <div className="ob-list">
        <Choice label="11 класс" sub="ЕГЭ в этом году" on={d.grade === '11'} onClick={() => { setD({ ...d, grade: '11' }); show('exam') }} />
        <Choice label="10 класс" sub="ЕГЭ в следующем году" on={d.grade === '10'} onClick={() => { setD({ ...d, grade: '10' }); show('exam') }} />
        <Choice label="9 класс" sub="ОГЭ в этом году" on={d.grade === '9'} onClick={() => { setD({ ...d, grade: '9' }); show('exam') }} />
        <Choice label="5-8 класс" sub="проверка заданий и своя траектория" on={['5', '6', '7', '8'].includes(d.grade)} onClick={() => show('grade58')} />
      </div>
    </>)
  } else if (step === 'grade58') {
    body = (<>
      <h1 className="ob-h">А точнее?</h1>
      <div className="ob-grid4">
        {['5', '6', '7', '8'].map((g) => (
          <button key={g} className={`ob-sq ${d.grade === g ? 'on' : ''}`} onClick={() => { setD({ ...d, grade: g }); show('exam') }}>{g}<small>класс</small></button>
        ))}
      </div>
    </>)
  } else if (step === 'exam') {
    const g = d.grade
    const opts: [string, string, string][] = g === '11' || g === '10'
      ? [['prof', 'Профильная математика', 'ЕГЭ, 19 заданий, вторая часть с решением'], ['base', 'Базовая математика', 'ЕГЭ, только ответы']]
      : g === '9' ? [['oge', 'ОГЭ', '25 заданий, вторая часть с решением']]
        : [['none', 'Пока ничего', 'проверка заданий и траектория'], ['oge', 'Готовлюсь к ОГЭ заранее', '']]
    body = (<>
      <h1 className="ob-h">Что ты сдаёшь?</h1>
      <div className="ob-list">{opts.map(([v, l, s]) => <Choice key={v} label={l} sub={s} on={d.exam === v} onClick={() => afterExam(v)} />)}</div>
      {err && <p className="auth-msg">{err}</p>}
    </>)
  } else if (step === 'account' && acc) {
    body = (<>
      <h1 className="ob-h">Проверь почту</h1>
      <p className="ob-sub">Мы отправили код на <b>{acc.email}</b>. Если письма нет, загляни в «Спам».</p>
      <form className="ob-form col" onSubmit={confirmAccount} noValidate>
        <input name="code" className="input ob-input code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="6 цифр из письма" autoFocus />
        <p className="auth-msg" aria-live="polite">{err || info}</p>
        <button className="btn btn-em" type="submit" disabled={busy}>{busy ? 'Создаю…' : 'Создать аккаунт'}</button>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => resend(acc.email, 'register')}>Отправить код ещё раз</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setAcc(null); setErr(''); setInfo('') }}>Другая почта</button>
        </div>
      </form>
    </>)
  } else if (step === 'account') {
    body = (<>
      <h1 className="ob-h">Сохраним прогресс</h1>
      <p className="ob-sub">{d.role === 'student' ? 'Чтобы расписание и результаты были с тобой на любом устройстве.' : 'Чтобы класс, учебники и материалы были на любом устройстве.'}</p>
      <form className="ob-form col" onSubmit={createAccount} noValidate>
        <input name="email" className="input ob-input" type="email" autoComplete="email" placeholder="Почта" />
        <input name="password" className="input ob-input" type="password" autoComplete="new-password" placeholder="Пароль, не короче 6 символов" />
        <p className="auth-msg">{err}</p>
        <button className="btn btn-em" type="submit" disabled={busy}>{busy ? 'Отправляю код…' : 'Дальше'}</button>
        <p className="muted" style={{ fontSize: 13, textAlign: 'center' }}>На почту придёт код из 6 цифр, чтобы подтвердить адрес.</p>
      </form>
    </>)
  } else {
    return (
      <div className="auth" role="dialog" aria-modal="true" aria-labelledby="authT">
        <div className="auth-bg"><WideMountains /></div>
        <div className="auth-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="brand-logo" style={{ background: 'var(--hero)' }}><Logo /></span>
            <div><b style={{ fontFamily: 'var(--f-display)', fontSize: 20 }}>Эверест</b><br /><span className="muted" style={{ fontSize: 13 }}>подготовка к экзаменам с проверкой по фото</span></div>
          </div>
          <Orn style={{ margin: '16px 0' }} />
          <div className="auth-hello"><StarBot size={58} /><Typed text="Привет! Я Звёздочка. Входи, продолжим подъём." speed={26} /></div>
          <h1 id="authT" className="sr">Вход</h1>
          {mode === 'login' && (
            <form className="auth-form" onSubmit={doLogin} noValidate>
              <div className="field"><label htmlFor="auEmail">Почта</label><input id="auEmail" name="email" className="input" type="email" autoComplete="email" placeholder="name@mail.ru" /></div>
              <div className="field"><label htmlFor="auPw">Пароль</label><input id="auPw" name="password" className="input" type="password" autoComplete="current-password" /></div>
              <p className="auth-msg" aria-live="polite">{err}</p>
              <button className="btn btn-gold" type="submit" style={{ width: '100%' }} disabled={busy}>{busy ? 'Вхожу…' : 'Войти'}</button>
              <button type="button" className="auth-link" onClick={() => { setMode('reset'); setErr(''); setInfo('') }}>Забыли пароль?</button>
            </form>
          )}
          {mode === 'reset' && (
            <form className="auth-form" onSubmit={askReset} noValidate>
              <p style={{ fontWeight: 700 }}>Восстановление пароля</p>
              <p className="muted" style={{ fontSize: 14 }}>Пришлём код на почту, с которой вы регистрировались.</p>
              <div className="field"><label htmlFor="rsEmail">Почта</label><input id="rsEmail" name="email" className="input" type="email" autoComplete="email" placeholder="name@mail.ru" /></div>
              <p className="auth-msg" aria-live="polite">{err}</p>
              <button className="btn btn-gold" type="submit" style={{ width: '100%' }} disabled={busy}>{busy ? 'Отправляю…' : 'Прислать код'}</button>
              <button type="button" className="auth-link" onClick={() => { setMode('login'); setErr('') }}>Я вспомнил пароль</button>
            </form>
          )}
          {mode === 'reset2' && (
            <form className="auth-form" onSubmit={doReset} noValidate>
              <p style={{ fontWeight: 700 }}>Новый пароль</p>
              <p className="muted" style={{ fontSize: 14 }}>Если почта {resetEmail} зарегистрирована, на неё пришёл код. Письма нет - проверьте «Спам».</p>
              <div className="field"><label htmlFor="rsCode">Код из письма</label><input id="rsCode" name="code" className="input code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="6 цифр" /></div>
              <div className="field"><label htmlFor="rsPw">Новый пароль</label><input id="rsPw" name="password" className="input" type="password" autoComplete="new-password" placeholder="не короче 6 символов" /></div>
              <p className="auth-msg" aria-live="polite">{err || info}</p>
              <button className="btn btn-gold" type="submit" style={{ width: '100%' }} disabled={busy}>{busy ? 'Сохраняю…' : 'Сменить пароль и войти'}</button>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <button type="button" className="auth-link" onClick={() => resend(resetEmail, 'reset')}>Прислать код ещё раз</button>
                <button type="button" className="auth-link" onClick={() => { setMode('login'); setErr(''); setInfo('') }}>Ко входу</button>
              </div>
            </form>
          )}
          <button className="btn btn-line" style={{ width: '100%', marginTop: 10 }} onClick={() => { setBack([]); setStep('role'); setErr('') }}>Я здесь впервые</button>
        </div>
      </div>
    )
  }

  const canBack = back.length > 0 && step !== 'hello' && !(me && step === 'grade')
  return (
    <div className="ob">
      <div className="ob-top">{canBack ? <button className="ob-back" onClick={goBack} aria-label="Назад"><Icon n="prev" s={20} /></button> : <span />}<span /></div>
      <div className="ob-screen" key={step}>{body}</div>
    </div>
  )
}

export function Logo({ s = 30 }: { s?: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 30 30" aria-hidden="true">
      <circle cx="23" cy="8" r="3.2" fill="#F0883E" /><path d="M2 25 L12 9 L16 15 L19 11 L28 25 Z" fill="#3E8A70" /><path d="M12 9 L14.8 13.4 L12.6 12.4 L10.6 13.8 Z" fill="#FFFDF7" />
    </svg>
  )
}
