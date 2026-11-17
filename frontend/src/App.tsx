import { useCallback, useEffect, useState } from 'react'
import { getMe, putSettings } from './api/client'
import Shell from './app/Shell'
import { AppProvider, useApp, viewHash } from './app/store'
import Chat from './pages/Chat'
import Check from './pages/Check'
import Diagnostic from './pages/Diagnostic'
import Home from './pages/Home'
import Materials from './pages/Materials'
import Onboarding from './pages/Onboarding'
import Plan from './pages/Plan'
import Result from './pages/Result'
import Session from './pages/Session'
import Stars from './pages/Stars'
import Teacher from './pages/Teacher'
import Tour from './pages/Tour'
import TaskMap from './pages/TaskMap'
import Bank from './pages/Bank'
import Practice from './pages/Practice'
import Variants, { VariantPage } from './pages/Variants'
import TrajectoryPage from './pages/Trajectory'
import PathPage, { TeacherPaths } from './pages/Path'
import Videos from './pages/Videos'
import type { DiagResult, Me } from './types'

type Stage = 'loading' | 'onb' | 'profile' | 'diag' | 'result' | 'app'

export default function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'))
  const [me, setMe] = useState<Me | null>(null)
  const [stage, setStage] = useState<Stage>(token ? 'loading' : 'onb')
  const [result, setResult] = useState<DiagResult | null>(null)
  const [tour, setTour] = useState(false)

  const logout = useCallback(() => {
    localStorage.removeItem('token')
    localStorage.removeItem('email')
    setToken(null)
    setMe(null)
    setStage('onb')
    history.replaceState(null, '', '/')
  }, [])

  const route = useCallback((m: Me) => {
    setMe(m)
    if (m.role === 'student' && m.needs_profile) return setStage('profile')
    // the diagnostic is offered once after sign-up and can be skipped; later it starts from the home screen
    if (m.role === 'student' && !m.diag_done && m.settings.onb === 'new') return setStage('diag')
    setStage('app')
    if (m.settings.onb !== 'done') reveal(m)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!token) return
    getMe().then(route).catch(() => logout())
  }, [token, route, logout])

  const reveal = (m: Me) => {
    history.replaceState(null, '', viewHash({ v: m.role === 'student' ? 'home' : 'teacher' }))
    document.body.classList.add('reveal')
    setTimeout(() => document.body.classList.remove('reveal'), 2400)
    setTimeout(() => setTour(true), 1700)
  }

  useEffect(() => {
    const on = () => setStage('diag')
    addEventListener('everest:diag', on)
    return () => removeEventListener('everest:diag', on)
  }, [])

  const onToken = (t: string, email: string) => {
    localStorage.setItem('token', t)
    localStorage.setItem('email', email)
    setStage('loading')
    setToken(t)
  }

  if (stage === 'loading') return <div className="ob"><div className="ob-screen"><p className="ob-sub">Загружаю…</p></div></div>
  if (stage === 'onb' || !me) return <Onboarding onToken={onToken} />
  if (stage === 'profile') return <Onboarding me={me} onToken={onToken} onProfile={route} />
  if (stage === 'diag') {
    return (
      <Diagnostic mode="first" required={false} exam={me.exam_info}
        onFinished={(r) => { setResult(r); setStage('result') }}
        onSkip={() => { const m = { ...me, settings: { ...me.settings, onb: 'skipped' } }; setMe(m); setStage('app'); reveal(m) }} />
    )
  }
  if (stage === 'result' && result) {
    return <Result r={result} name={me.name || 'друг'} sound={me.settings.sound !== false} onGo={() => { const m = { ...me, diag_done: true }; setMe(m); setStage('app'); reveal(m) }} />
  }
  return (
    <AppProvider me={me} onLogout={logout}>
      <Main />
      {tour && <Tour teacher={me.role !== 'student'} onEnd={() => { setTour(false); putSettings({ onb: 'done' }).catch(() => null) }} />}
    </AppProvider>
  )
}

function Main() {
  const app = useApp()
  const { view, me } = app
  const [mock, setMock] = useState(false)
  const [mockRes, setMockRes] = useState<DiagResult | null>(null)
  useEffect(() => {
    const on = () => setMock(true)
    addEventListener('everest:mock', on)
    return () => removeEventListener('everest:mock', on)
  }, [])
  const teacher = me.role !== 'student'

  if (mockRes) return <Result r={mockRes} name={me.name} sound={me.settings.sound !== false} onGo={() => { setMockRes(null); app.reload(); app.go('home') }} />
  if (mock) return <Diagnostic mode="mock" required={false} exam={me.exam_info} onFinished={(r) => { setMock(false); setMockRes(r) }} onPause={() => { setMock(false); app.toast('Пробник на паузе. Продолжишь из расписания') }} />

  let page
  switch (view.v) {
    case 'session': page = view.id ? <Session sessionId={view.id} onBack={() => app.go('check')} onOpenTrajectory={(id) => app.go({ v: 'trajectory', id })} onChecked={app.reload} /> : <Check />; break
    case 'trajectory': page = view.id ? <TrajectoryPage sessionId={view.id} onBack={() => app.go({ v: 'session', id: view.id })} /> : <Check />; break
    case 'check': page = <Check />; break
    case 'teacher': page = teacher ? <Teacher /> : <Home />; break
    case 'materials': page = teacher ? <Materials /> : <Home />; break
    case 'tchat': page = teacher ? <Chat teacher /> : <Chat teacher={false} />; break
    case 'plan': page = teacher ? <Teacher /> : <Plan />; break
    case 'video': page = <Videos />; break
    case 'task': page = <TaskMap n={Number(view.id) || 1} />; break
    case 'bank': page = teacher ? <Bank /> : <Practice />; break
    case 'practice': page = <Practice />; break
    case 'path': page = teacher ? <TeacherPaths /> : <PathPage />; break
    case 'paths': page = teacher ? <TeacherPaths /> : <PathPage />; break
    case 'variants': page = teacher ? <Variants /> : <Practice />; break
    case 'variant': page = view.id ? <VariantPage id={Number(view.id)} /> : teacher ? <Variants /> : <Practice />; break
    case 'chat': page = teacher ? <Chat teacher /> : <Chat teacher={false} />; break
    case 'awards': page = teacher ? <Teacher /> : <Stars />; break
    default: page = teacher ? <Teacher /> : <Home />
  }
  return <Shell>{page}</Shell>
}
