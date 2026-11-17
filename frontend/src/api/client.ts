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

// ---------------- new design: profile, learning model, teacher ----------------
import type {
  Me, Dashboard, PlanData, DiagRun, DiagResult, NotificationItem, ChatMsg, TeacherOverview, StudentDetail, Textbook, MaterialOut,
  TaskMapData, TmAnswer, TmFile, SkillExplain, BankItem, BankTask,
} from '../types'

export async function registerFull(body: { email: string; password: string; name?: string; role: string; grade?: string | null; exam?: string | null }) {
  return apiFetch('/auth/register', { method: 'POST', body: JSON.stringify(body) })
}
export const demoLogin = () => apiFetch('/auth/demo', { method: 'POST' })
export const getMe = (): Promise<Me> => apiFetch('/me')
export const putProfile = (body: Partial<Pick<Me, 'name' | 'role' | 'grade' | 'exam'>>): Promise<Me> =>
  apiFetch('/me/profile', { method: 'PUT', body: JSON.stringify(body) })
export const putSettings = (body: Record<string, unknown>) => apiFetch('/me/settings', { method: 'PUT', body: JSON.stringify(body) })

export const startDiagnostic = (mode: 'first' | 'mock'): Promise<DiagRun> =>
  apiFetch('/diagnostics', { method: 'POST', body: JSON.stringify({ mode }) })
export const saveAnswer = (id: number, item_id: string, answer: string, position: number) =>
  apiFetch(`/diagnostics/${id}/answer`, { method: 'PUT', body: JSON.stringify({ item_id, answer, position }) })
export const finishDiagnostic = (id: number): Promise<DiagResult> => apiFetch(`/diagnostics/${id}/finish`, { method: 'POST' })
export const skipDiagnostic = () => apiFetch('/diagnostics/skip', { method: 'POST' })

export const getDashboard = (): Promise<Dashboard> => apiFetch('/dashboard')
export const getPlan = (): Promise<PlanData> => apiFetch('/plan')
export const togglePlanBlock = (key: string): Promise<{ done: boolean; xp: number }> =>
  apiFetch('/plan/done', { method: 'POST', body: JSON.stringify({ key }) })
export const dailyHint = (): Promise<{ hints: string[] }> => apiFetch('/daily/hint', { method: 'POST' })
export const dailyAnswer = (answer: string): Promise<{ ok: boolean; message: string; sol: string | null; xp: number }> =>
  apiFetch('/daily/answer', { method: 'POST', body: JSON.stringify({ answer }) })
export const sendEvent = (event: string, id?: string): Promise<{ xp: number; new_ach: boolean; fresh_egg: boolean; stars: number }> =>
  apiFetch('/events', { method: 'POST', body: JSON.stringify({ event, id }) })
export const nodeQuiz = (node: string, ok: number, total: number): Promise<{ before: number; after: number }> =>
  apiFetch(`/nodes/${node}/quiz`, { method: 'POST', body: JSON.stringify({ ok, total }) })

export const getNotifications = (): Promise<{ notifications: NotificationItem[] }> => apiFetch('/notifications')
export const readNotifications = (id?: number) => apiFetch('/notifications/read', { method: 'POST', body: JSON.stringify({ id: id ?? null }) })

export const getChat = (kind: 'student' | 'teacher'): Promise<{ messages: ChatMsg[] }> => apiFetch(`/chat/${kind}`)
export const postChat = (kind: 'student' | 'teacher', text: string, image?: string): Promise<{ reply: string }> =>
  apiFetch(`/chat/${kind}`, { method: 'POST', body: JSON.stringify({ text, image: image ?? null }) })
export const clearChat = (kind: 'student' | 'teacher') => apiFetch(`/chat/${kind}`, { method: 'DELETE' })
export const mapAnalysis = (): Promise<{ text: string }> => apiFetch('/map/analysis', { method: 'POST' })

export const joinClass = (code: string): Promise<{ id: number; name: string }> =>
  apiFetch('/classes/join', { method: 'POST', body: JSON.stringify({ code }) })
export const assignmentDone = (id: number) => apiFetch(`/assignments/${id}/done`, { method: 'POST' })

export const teacherOverview = (): Promise<TeacherOverview> => apiFetch('/teacher/overview')
export const teacherStudent = (id: number): Promise<StudentDetail> => apiFetch(`/teacher/students/${id}`)
export const createClass = (name: string): Promise<{ id: number; name: string; code: string }> =>
  apiFetch('/teacher/classes', { method: 'POST', body: JSON.stringify({ name }) })
export const reviewTask = (id: number, score: number) => apiFetch(`/teacher/reviews/${id}`, { method: 'POST', body: JSON.stringify({ score }) })
export const createAssignment = (body: { class_id: number; topic: string; count: number; due: string; task_id?: number | null }) =>
  apiFetch('/teacher/assignments', { method: 'POST', body: JSON.stringify(body) })
export const deleteAssignment = (id: number) => apiFetch(`/teacher/assignments/${id}`, { method: 'DELETE' })

export const listTextbooks = (): Promise<{ textbooks: Textbook[] }> => apiFetch('/textbooks')
export async function addTextbook(title: string, authors: string, grade: string, file?: File): Promise<Textbook> {
  const form = new FormData()
  form.append('title', title)
  form.append('authors', authors)
  form.append('grade', grade)
  if (file) form.append('file', file)
  const res = await fetch(`${BASE}/textbooks`, { method: 'POST', headers: authHeader(), body: form })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail ?? 'Не удалось загрузить учебник')
  }
  return res.json()
}
export const deleteTextbook = (id: number) => apiFetch(`/textbooks/${id}`, { method: 'DELETE' })
export const generateMaterial = (body: {
  kind: 'conspect' | 'slides'; topic: string; textbook_id: number; section: string; paragraph: string; who: string; minutes: string
}): Promise<MaterialOut> => apiFetch('/materials/generate', { method: 'POST', body: JSON.stringify(body) })

// ---------- task maps ----------
export const listTaskMaps = (): Promise<{ maps: { n: number; name: string }[] }> => apiFetch('/taskmaps')
export const getTaskMap = (n: number): Promise<TaskMapData> => apiFetch(`/taskmaps/${n}`)
export const answerTaskMap = (n: number, problem_id: string, answer: string): Promise<TmAnswer> =>
  apiFetch(`/taskmaps/${n}/answer`, { method: 'POST', body: JSON.stringify({ problem_id, answer }) })
export async function uploadTaskFile(n: number, proto: string, file: File): Promise<TmFile> {
  const form = new FormData()
  form.append('proto', proto)
  form.append('file', file)
  const res = await fetch(`${BASE}/taskmaps/${n}/files`, { method: 'POST', headers: authHeader(), body: form })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail ?? 'Не удалось загрузить файл')
  }
  return res.json()
}
export async function downloadTaskFile(id: number, name: string): Promise<void> {
  const res = await fetch(`${BASE}/taskfiles/${id}`, { headers: authHeader() })
  if (!res.ok) throw new Error('Файл недоступен')
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export const deleteTaskFile = (id: number) => apiFetch(`/taskfiles/${id}`, { method: 'DELETE' })

export const explainSkill = (id: string, textbook_id?: number): Promise<SkillExplain> =>
  apiFetch(`/skills/${id}/explain`, { method: 'POST', body: JSON.stringify({ textbook_id: textbook_id ?? null }) })

// ---------- task bank ----------
export const bankTasks = (): Promise<{ tasks: BankTask[] }> => apiFetch('/bank/protos')
export const listBank = (status: 'draft' | 'approved', task?: number): Promise<{ items: BankItem[]; counts: Record<string, { approved: number; draft: number }> }> =>
  apiFetch(`/bank?status=${status}${task ? `&task=${task}` : ''}`)
export const editBank = (id: number, body: Partial<Pick<BankItem, 'text' | 'answer' | 'solution' | 'proto' | 'status'>>): Promise<BankItem> =>
  apiFetch(`/bank/${id}`, { method: 'PUT', body: JSON.stringify(body) })
export const deleteBank = (id: number) => apiFetch(`/bank/${id}`, { method: 'DELETE' })
export async function importBank(task: number, file: File): Promise<{ added: number; skipped: number; note: string }> {
  const form = new FormData()
  form.append('task', String(task))
  form.append('file', file)
  const res = await fetch(`${BASE}/bank/import`, { method: 'POST', headers: authHeader(), body: form })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail ?? 'Не удалось импортировать файл')
  }
  return res.json()
}
export async function downloadBankTemplate(): Promise<void> {
  const res = await fetch(`${BASE}/bank/template.csv`, { headers: authHeader() })
  if (!res.ok) throw new Error('Шаблон недоступен')
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = 'bank_template.csv'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
