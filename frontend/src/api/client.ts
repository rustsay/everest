const BASE = '/api'

function authHeader(): Record<string, string> {
  const token = localStorage.getItem('token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function apiFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeader(), ...(init.headers ?? {}) },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail ?? `HTTP ${res.status}`)
  }
  return res.json()
}

// Auth
export async function register(email: string, password: string) {
  return apiFetch('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export async function login(email: string, password: string) {
  return apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

// Sessions
export async function createSession(): Promise<string> {
  const data = await apiFetch('/sessions', { method: 'POST' })
  return data.session_id
}

export async function listSessions() {
  return apiFetch('/sessions')
}

export async function uploadTask(sessionId: string, taskId: number, files: File[]): Promise<void> {
  const form = new FormData()
  for (const f of files) form.append('files', f)
  const res = await fetch(`${BASE}/sessions/${sessionId}/tasks/${taskId}/upload`, {
    method: 'POST',
    headers: authHeader(),
    body: form,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail ?? 'Ошибка загрузки')
  }
}

export async function getResults(sessionId: string) {
  return apiFetch(`/sessions/${sessionId}/results`)
}

export async function startTrajectory(sessionId: string) {
  return apiFetch(`/sessions/${sessionId}/trajectory`, { method: 'POST' })
}

export async function fetchTrajectory(sessionId: string) {
  return apiFetch(`/sessions/${sessionId}/trajectory`)
}

export async function downloadReportFile(sessionId: string, format: 'pdf' | 'html'): Promise<void> {
  const res = await fetch(`${BASE}/sessions/${sessionId}/report.${format}`, {
    headers: authHeader(),
  })
  if (!res.ok) throw new Error('Ошибка генерации отчёта')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `ege-report-${sessionId.slice(0, 8)}.${format}`
  a.click()
  URL.revokeObjectURL(url)
}

export function openWs(sessionId: string): WebSocket {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return new WebSocket(`${proto}://${location.host}/api/ws/${sessionId}`)
}
