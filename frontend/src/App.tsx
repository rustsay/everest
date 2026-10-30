import { useState } from 'react'
import Auth from './pages/Auth'
import History from './pages/History'
import Session from './pages/Session'
import TrajectoryPage from './pages/Trajectory'

type View = { page: 'history' } | { page: 'session'; id: string } | { page: 'trajectory'; id: string }

export default function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'))
  const [email, setEmail] = useState<string>(() => localStorage.getItem('email') ?? '')
  const [view, setView] = useState<View>(() => {
    const sid = new URLSearchParams(location.search).get('session')
    return sid ? { page: 'session', id: sid } : { page: 'history' }
  })

  const handleAuth = (t: string, e: string) => {
    localStorage.setItem('token', t)
    localStorage.setItem('email', e)
    setToken(t)
    setEmail(e)
  }

  const handleLogout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('email')
    setToken(null)
    setEmail('')
    setView({ page: 'history' })
    history.pushState({}, '', '/')
  }

  const openSession = (id: string) => {
    history.pushState({}, '', `?session=${id}`)
    setView({ page: 'session', id })
  }

  const openTrajectory = (id: string) => {
    history.pushState({}, '', `?session=${id}&trajectory=1`)
    setView({ page: 'trajectory', id })
  }

  const goHistory = () => {
    history.pushState({}, '', '/')
    setView({ page: 'history' })
  }

  if (!token) return <Auth onAuth={handleAuth} />

  if (view.page === 'trajectory') {
    return <TrajectoryPage sessionId={view.id} onBack={() => openSession(view.id)} />
  }

  if (view.page === 'session') {
    return <Session sessionId={view.id} onBack={goHistory} onOpenTrajectory={openTrajectory} />
  }

  return <History email={email} onOpenSession={openSession} onLogout={handleLogout} />
}
