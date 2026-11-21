const BASE = '/api'

export interface GeneratedVideo { id: string; problem: string; title: string; status: 'pending' | 'ready' | 'error'; stage: string; error: string | null; steps: { title: string; lines: string[]; text: string }[]; created_at: string }
export const listGeneratedVideos = (): Promise<{ videos: GeneratedVideo[] }> => apiFetch('/videos')
export const generateVideo = (problem: string): Promise<GeneratedVideo> => apiFetch('/videos', { method: 'POST', body: JSON.stringify({ problem }) })
export const retryVideo = (id: string): Promise<GeneratedVideo> => apiFetch(`/videos/${id}/retry`, { method: 'POST' })

export interface WorkPhoto { id: string; filename: string; task_ids: number[]; warning: string; submitted: boolean }
export const getWorkPhotos = (sid: string): Promise<{ pages: WorkPhoto[] }> => apiFetch(`/sessions/${sid}/photos`)
export async function addWorkPhotos(sid: string, files: File[]): Promise<{ pages: WorkPhoto[] }> {
  const form = new FormData()
  files.forEach((f) => form.append('files', f))
  const r = await fetch(`${BASE}/sessions/${sid}/photos`, { method: 'POST', headers: authHeader(), body: form })
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? `Ошибка загрузки (${r.status})`)
  return r.json()
}
export const saveWorkPhotos = (sid: string, pages: WorkPhoto[]) => apiFetch(`/sessions/${sid}/photos`, { method: 'PUT', body: JSON.stringify({ pages: pages.map(({ id, task_ids }) => ({ id, task_ids })) }) })
export const checkWorkPhotos = (sid: string, retry = false): Promise<{ task_ids: number[] }> => apiFetch(`/sessions/${sid}/photos/check${retry ? '?retry_errors=true' : ''}`, { method: 'POST' })
export async function workPhotoPreview(sid: string, id: string): Promise<string> {
  const r = await fetch(`${BASE}/sessions/${sid}/photos/${id}/image`, { headers: authHeader() })
  if (!r.ok) throw new Error('Превью недоступно')
  return URL.createObjectURL(await r.blob())
}

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
  Me, Dashboard, PlanData, DiagRun, DiagResult, NotificationItem, ChatMsg, TeacherOverview, StudentDetail, Textbook, MaterialOut, MaterialHead, Slide,
  TaskMapData, TmAnswer, TmFile, SkillExplain, BankItem, BankTask, PracticeItem, VariantSummary, VariantFull,
  MyPath, PathOut, PathStage, TeacherPaths, DiagWork, Target, Walkthrough, DiagListItem, DiagAnalytics, Check1Result, Check1Item, Check2Result, Check2Item, RedoItem, WeekReport, ClassWeek, MyEvent,
  PushSettings, AdminStats, AdminUser,
} from '../types'

export const authConfig = (): Promise<{ email_confirm: boolean }> => apiFetch('/auth/config')
export const sendCode = (email: string, purpose: 'register' | 'reset'): Promise<{ sent: boolean }> =>
  apiFetch('/auth/code', { method: 'POST', body: JSON.stringify({ email, purpose }) })
export const resetPassword = (email: string, code: string, password: string) =>
  apiFetch('/auth/reset', { method: 'POST', body: JSON.stringify({ email, code, password }) })
export async function registerFull(body: { email: string; password: string; name?: string; role: string; grade?: string | null; exam?: string | null; code?: string }) {
  return apiFetch('/auth/register', { method: 'POST', body: JSON.stringify(body) })
}
export const demoLogin = () => apiFetch('/auth/demo', { method: 'POST' })
export const getMe = (): Promise<Me> => apiFetch('/me')
export const putProfile = (body: Partial<Pick<Me, 'name' | 'role' | 'grade' | 'exam'>>): Promise<Me> =>
  apiFetch('/me/profile', { method: 'PUT', body: JSON.stringify(body) })
export const putSettings = (body: Record<string, unknown>) => apiFetch('/me/settings', { method: 'PUT', body: JSON.stringify(body) })

export const startDiagnostic = (mode: 'first' | 'mock', exam = false): Promise<DiagRun> =>
  apiFetch('/diagnostics', { method: 'POST', body: JSON.stringify({ mode, exam }) })
export const openDiagnostic = (mode: 'first' | 'mock'): Promise<({ open: true } & DiagRun) | { open: false }> => apiFetch(`/diagnostics/open/${mode}`)
export const saveAnswer = (id: number, item_id: string, answer: string, position: number | null = null) =>
  apiFetch(`/diagnostics/${id}/answer`, { method: 'PUT', body: JSON.stringify({ item_id, answer, position }) })
export const saveDiagnosticProgress = (id: number, position: number) =>
  apiFetch(`/diagnostics/${id}/progress`, { method: 'PUT', body: JSON.stringify({ position }) })
export const finishDiagnostic = (id: number): Promise<DiagResult> => apiFetch(`/diagnostics/${id}/finish`, { method: 'POST' })
export async function uploadDiagWork(id: number, item: string, files: File[]): Promise<{ work: Record<string, DiagWork> }> {
  const form = new FormData()
  files.forEach((f) => form.append('files', f))
  const r = await fetch(`${BASE}/diagnostics/${id}/items/${encodeURIComponent(item)}/work`, { method: 'POST', headers: authHeader(), body: form })
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? `Ошибка загрузки (${r.status})`)
  return r.json()
}
export const setDiagMode = (id: number, item: string, mode: 'dont_know' | 'oral' | 'clear'): Promise<{ work: Record<string, DiagWork> }> =>
  apiFetch(`/diagnostics/${id}/items/${encodeURIComponent(item)}/mode`, { method: 'PUT', body: JSON.stringify({ mode }) })
export const getDiagWork = (id: number): Promise<{ work: Record<string, DiagWork> }> => apiFetch(`/diagnostics/${id}/work`)
/** Part 2 of the diagnostic by types: which type the student solves. */
export const setDiagChoice = (id: number, item: string, type: string): Promise<{ work: Record<string, DiagWork>; choice: Record<string, string> }> =>
  apiFetch(`/diagnostics/${id}/items/${item}/choice`, { method: 'PUT', body: JSON.stringify({ type }) })
/** «Не знаю» twice in a row: the rest of the types of task n become «не знаю». */
export const skipDiagTask = (id: number, n: number): Promise<{ work: Record<string, DiagWork> }> =>
  apiFetch(`/diagnostics/${id}/tasks/${n}/skip`, { method: 'POST' })
export const skipDiagnostic = () => apiFetch('/diagnostics/skip', { method: 'POST' })

export const getDashboard = (): Promise<Dashboard> => apiFetch('/dashboard')
export const getPlan = (week = 0): Promise<PlanData> => apiFetch(`/plan?week=${week}`)
export const putEvents = (events: MyEvent[]): Promise<{ events: MyEvent[] }> => apiFetch('/me/events', { method: 'PUT', body: JSON.stringify({ events }) })
export const setTarget = (test: number): Promise<{ target: Target }> => apiFetch('/me/target', { method: 'PUT', body: JSON.stringify({ test }) })
/** OGE and base: the goal is the mark. */
export const setGradeTarget = (grade: number): Promise<{ target: Target }> => apiFetch('/me/target', { method: 'PUT', body: JSON.stringify({ grade }) })

// Educational trajectory
const post = (body?: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body ?? {}) })
export const getMyPath = (): Promise<MyPath> => apiFetch('/path')
export const generateMyPath = (): Promise<PathOut> => apiFetch('/path/generate', post())
export const editMyPath = (stages: PathStage[], comment: string): Promise<PathOut> =>
  apiFetch('/path/mine', { method: 'PUT', body: JSON.stringify({ stages, comment }) })
export const pathAdvice = (question: string, stages: PathStage[]): Promise<{ text: string }> =>
  apiFetch('/path/advice', { method: 'POST', body: JSON.stringify({ question, stages }) })
export const followPath = (follow: boolean): Promise<{ follow: boolean }> => apiFetch('/path/follow', post({ follow }))
export const teacherPaths = (): Promise<TeacherPaths> => apiFetch('/teacher/paths')
export const teacherPath = (id: number): Promise<PathOut> => apiFetch(`/teacher/paths/${id}`)
export const teacherGenPath = (target: { student_id?: number; class_id?: number }): Promise<PathOut> => apiFetch('/teacher/paths/generate', post(target))
export const teacherEditPath = (id: number, body: { stages?: PathStage[]; summary?: string; note?: string }): Promise<PathOut> =>
  apiFetch(`/teacher/paths/${id}`, { method: 'PUT', body: JSON.stringify(body) })
export const teacherApprovePath = (id: number): Promise<PathOut> => apiFetch(`/teacher/paths/${id}/approve`, post())
export const teacherRejectPath = (id: number, note = ''): Promise<{ ok: boolean }> => apiFetch(`/teacher/paths/${id}/reject`, post({ note }))
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
export interface ReviewChatSummary {
  id: string; session_id: string; task_id: number; title: string
  created_at: string; updated_at: string; checked_at: string; message_count: number; last_message: string
}
export interface ReviewChatDetail extends ReviewChatSummary { messages: ChatMsg[]; score: number; max_score: number }
export const listReviewChats = (): Promise<{ chats: ReviewChatSummary[] }> => apiFetch('/review-chats')
export const openReviewChat = (sid: string, task: number): Promise<ReviewChatDetail> => apiFetch(`/sessions/${sid}/tasks/${task}/chat`, { method: 'POST' })
export const getReviewChat = (id: string): Promise<ReviewChatDetail> => apiFetch(`/review-chats/${id}`)
export const askReviewChat = (id: string, text: string): Promise<ReviewChatDetail> => apiFetch(`/review-chats/${id}/messages`, { method: 'POST', body: JSON.stringify({ text }) })
export const postChat = (kind: 'student' | 'teacher', text: string, images: string[] = [], files: { name: string; data: string }[] = []): Promise<{ reply: string }> =>
  apiFetch(`/chat/${kind}`, { method: 'POST', body: JSON.stringify({ text, images, files }) })
export const clearChat = (kind: 'student' | 'teacher') => apiFetch(`/chat/${kind}`, { method: 'DELETE' })
export const mapAnalysis = (): Promise<{ text: string }> => apiFetch('/map/analysis', { method: 'POST' })

export const joinClass = (code: string): Promise<{ id: number; name: string; already?: boolean }> =>
  apiFetch('/classes/join', { method: 'POST', body: JSON.stringify({ code }) })
export interface InviteInfo { code: string; class: string; teacher: string; role: string }
export const inviteInfo = (code: string): Promise<InviteInfo> => apiFetch(`/invite/${encodeURIComponent(code)}`)
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
  kind: 'conspect' | 'slides'; topic: string; textbook_id: number; section: string; paragraph: string; pages: string; extra: boolean; who: string; minutes: string
}): Promise<MaterialOut> => apiFetch('/materials/generate', { method: 'POST', body: JSON.stringify(body) })
export const listMaterials = (): Promise<{ materials: MaterialHead[] }> => apiFetch('/materials')
export const getMaterial = (id: number): Promise<MaterialOut> => apiFetch(`/materials/${id}`)
export const editMaterial = (id: number, body: { topic?: string; theme?: string; text?: string; slides?: Slide[] }): Promise<MaterialOut> =>
  apiFetch(`/materials/${id}`, { method: 'PUT', body: JSON.stringify(body) })
export const deleteMaterial = (id: number) => apiFetch(`/materials/${id}`, { method: 'DELETE' })

// ---------- task maps ----------
const ex = (exam?: string, first = '?') => (exam ? `${first}exam=${exam}` : '')
export const listTaskMaps = (exam?: string): Promise<{ maps: { n: number; name: string }[] }> => apiFetch(`/taskmaps${ex(exam)}`)
export const getTaskMap = (n: number, exam?: string): Promise<TaskMapData> => apiFetch(`/taskmaps/${n}${ex(exam)}`)
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
export const listBank = (status: 'draft' | 'approved', task?: number): Promise<{ items: BankItem[]; counts: Record<string, { approved: number; draft: number }>; fipi?: Record<string, number>; fipi_source?: string }> =>
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

// ---------- practice bank and variants ----------
export const listDiagnostics = (): Promise<{ items: DiagListItem[] }> => apiFetch('/diagnostics')
export const getDiagAnalytics = (id: number): Promise<DiagResult & { date: string | null; analytics: DiagAnalytics }> => apiFetch(`/diagnostics/${id}/analytics`)
export async function checkFirstPart(body: { task: number; answer: string; ref?: string; problem?: string; files: File[]; exam?: string }): Promise<Check1Result> {
  const fd = new FormData()
  fd.append('task', String(body.task)); fd.append('answer', body.answer)
  if (body.exam) fd.append('exam', body.exam)
  if (body.ref) fd.append('ref', body.ref)
  if (body.problem) fd.append('problem', body.problem)
  body.files.forEach((f) => fd.append('files', f))
  const res = await fetch(`${BASE}/check1`, { method: 'POST', headers: authHeader(), body: fd })
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(typeof e.detail === 'string' ? e.detail : `HTTP ${res.status}`) }
  return res.json()
}
export const check1History = (exam?: string): Promise<{ items: Check1Item[] }> => apiFetch(`/check1${ex(exam)}`)
export async function checkSecondPart(body: { task: number; ref?: string; problem?: string; files: File[]; exam?: string }): Promise<Check2Result> {
  const fd = new FormData()
  fd.append('task', String(body.task))
  if (body.exam) fd.append('exam', body.exam)
  if (body.ref) fd.append('ref', body.ref)
  if (body.problem) fd.append('problem', body.problem)
  body.files.forEach((f) => fd.append('files', f))
  const res = await fetch(`${BASE}/check2`, { method: 'POST', headers: authHeader(), body: fd })
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail ?? `HTTP ${res.status}`) }
  return res.json()
}
export const check2History = (): Promise<{ items: Check2Item[] }> => apiFetch('/check2')
export const getRedo = (): Promise<{ items: RedoItem[]; later: number; next: string | null; done: number }> => apiFetch('/redo')
export const weekReport = (): Promise<WeekReport> => apiFetch('/report/week')
export const classWeek = (): Promise<ClassWeek> => apiFetch('/teacher/report/week')
export const setParentEmail = (email: string | null): Promise<{ parent_email: string | null; smtp: boolean }> =>
  apiFetch('/me/parent', { method: 'PUT', body: JSON.stringify({ email }) })
const walkthroughPending = new Map<string, Promise<Walkthrough>>()
export const getWalkthrough = (ref: string): Promise<Walkthrough> => {
  const current = walkthroughPending.get(ref)
  if (current) return current
  const request = (apiFetch('/walkthrough', { method: 'POST', body: JSON.stringify({ ref }) }) as Promise<Walkthrough>)
    .finally(() => walkthroughPending.delete(ref))
  walkthroughPending.set(ref, request)
  return request
}
export const getPractice = (task?: number, proto?: string, exam?: string): Promise<{ items: PracticeItem[]; counts: Record<string, number>; tasks: BankTask[]; total?: number; exam?: string }> =>
  apiFetch(`/practice?${task ? `task=${task}` : ''}${proto ? `&proto=${proto}` : ''}${ex(exam, '&')}`)
export const variantCandidates = (task: number): Promise<{ items: PracticeItem[] }> => apiFetch(`/variants/candidates?task=${task}`)
export const listVariants = (): Promise<{ variants: VariantSummary[] }> => apiFetch('/variants')
export const getVariant = (id: number): Promise<VariantFull> => apiFetch(`/variants/${id}`)
export const createVariant = (body: { title: string; items?: string[]; auto_tasks?: number[]; class_id?: number | null; due?: string | null }): Promise<{ id: number; items: number; missing: number[] }> =>
  apiFetch('/variants', { method: 'POST', body: JSON.stringify(body) })
export const editVariant = (id: number, body: { title?: string; items?: string[]; class_id?: number | null; due?: string | null; unassign?: boolean }) =>
  apiFetch(`/variants/${id}`, { method: 'PUT', body: JSON.stringify(body) })
export const deleteVariant = (id: number) => apiFetch(`/variants/${id}`, { method: 'DELETE' })
export const submitVariant = (id: number, answers: Record<string, string>): Promise<{ score: number; max: number }> =>
  apiFetch(`/variants/${id}/submit`, { method: 'POST', body: JSON.stringify({ answers }) })

// Push notifications
export const getPushSettings = (): Promise<PushSettings> => apiFetch('/push/settings')
export const pushSubscribe = (subscription: PushSubscriptionJSON): Promise<PushSettings> => apiFetch('/push/subscribe', {
  method: 'POST',
  body: JSON.stringify({
    subscription, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || '', tzo: new Date().getTimezoneOffset(),
    agent: navigator.userAgent.slice(0, 120),
  }),
})
export const pushUnsubscribe = (endpoint: string): Promise<PushSettings> => apiFetch('/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint }) })
export const putPushSettings = (remind: boolean): Promise<PushSettings> => apiFetch('/push/settings', { method: 'PUT', body: JSON.stringify({ remind }) })
export const pushTest = (): Promise<{ sent: number }> => apiFetch('/push/test', { method: 'POST' })

// Admin panel
export const adminStats = (days = 30): Promise<AdminStats> => apiFetch(`/admin/stats?days=${days}`)
export const adminUsers = (): Promise<{ users: AdminUser[]; today: string }> => apiFetch('/admin/users')
