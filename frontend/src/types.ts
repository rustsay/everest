export type TaskStatus = 'pending' | 'ocr' | 'checking' | 'done' | 'error'

export interface AgentVerdict {
  agent_id: number
  score: number
  max_score: number
  reasoning: string
  errors_found: string[]
  correct_steps: string[]
  confidence: number
}

export interface JudgeDecision {
  final_score: number
  max_score: number
  reasoning: string
  consensus_level: 'full' | 'majority' | 'judge_decision' | 'teacher'
  agent_scores: number[]
}

export interface TaskResult {
  task_id: number
  status: TaskStatus
  ocr_text?: string
  ocr_confidence?: number
  agent_verdicts?: AgentVerdict[]
  judge_decision?: JudgeDecision
  error?: string
}

export interface AuthState {
  token: string
  email: string
}

export interface SessionSummary {
  session_id: string
  created_at: string
  total_score: number
  max_total: number
  completed_tasks: number
  task_scores: Record<number, number>
}

export type WsEvent =
  | { event: 'ocr_started'; task_id: number }
  | { event: 'ocr_done'; task_id: number; confidence: number; low_confidence: boolean }
  | { event: 'agents_started'; task_id: number }
  | { event: 'agent_done'; task_id: number; agent_id: number; score: number }
  | { event: 'judge_done'; task_id: number; final_score: number }
  | { event: 'task_complete'; task_id: number; final_score: number; max_score: number }
  | { event: 'task_error'; task_id: number; error: string }
  | { event: 'trajectory_done' }
  | { event: 'trajectory_error'; error: string }

export interface PracticeProblem {
  problem: string
  hint: string
  solution: string
}

export interface TaskPlan {
  task_id: number
  topic: string
  current_score: number
  max_score: number
  target_score: number
  priority: 'высокий' | 'средний' | 'низкий'
  weak_aspects: string[]
  recommended_hours: number
  key_theory: string[]
  practice_problems: PracticeProblem[]
}

export interface WeekPlan {
  week_label: string
  focus_tasks: number[]
  hours_per_day: number
  goals: string[]
}

export interface Trajectory {
  overall_analysis: string
  current_score: number
  days_until_exam: number
  strong_topics: string[]
  weak_topics: string[]
  week_plans: WeekPlan[]
  task_plans: TaskPlan[]
}

export const TASK_INFO: Record<number, { topic: string; max_score: number }> = {
  13: { topic: 'Уравнение', max_score: 2 },
  14: { topic: 'Стереометрия', max_score: 3 },
  15: { topic: 'Неравенство', max_score: 2 },
  16: { topic: 'Финансовая задача', max_score: 2 },
  17: { topic: 'Планиметрия', max_score: 3 },
  18: { topic: 'Задача с параметром', max_score: 4 },
  19: { topic: 'Задача олимпиадного типа', max_score: 4 },
}

// ---------------- new design ----------------
export type Role = 'student' | 'teacher' | 'tutor'

export interface ExamInfo {
  key: 'prof' | 'base' | 'oge' | 'g10' | 'g58'
  title: string
  short: string
  label: string
  max: number
  pct: boolean
  unit: string
  date: string
  date_note: string
}

export interface Me {
  id: number
  email: string
  name: string
  role: Role
  grade: string | null
  exam: string | null
  is_demo: boolean
  exam_info: ExamInfo
  needs_profile: boolean
  diag_required: boolean
  diag_done?: boolean
  diag_in_progress?: boolean
  classes?: { id: number; name: string }[]
  settings: {
    plan?: { date?: string; days?: number; min?: number }
    care?: { breaks?: boolean; sleep?: boolean; every?: number }
    sound?: boolean
    voice?: boolean
    onb?: string
  }
}

export interface GraphNode { id: string; name: string; col: number; pre: string[]; m: number; unknown: boolean }
export interface ExamTask {
  id: string; n: number | string | null; name: string; need: string[]; max: number; part: number; att: number
  from?: string | null; p: number; exp: number; risk: boolean; obs: number | null
}
export interface PlanBlock {
  k: 'warm' | 'topic' | 'deep' | 'p2' | 'school' | 'rep' | 'mock'
  min: number; title: string; sub: string; node?: string
  tasks?: { id: string; n: number | string | null; name: string }[]
  key?: string; done?: boolean
}
export interface PlanDay { date: string; rest?: boolean; past?: boolean; mock?: number; blocks: PlanBlock[] }

export interface Dashboard {
  exam: ExamInfo
  forecast: number
  gain: number
  model: { nodes: GraphNode[]; tasks: ExamTask[]; root: string | null; root_tasks: string[]; at_risk: number; weak: string[]; threat: string[] }
  history: { date: string; value: number; source: string }[]
  deltas: { node: string; name: string; delta: number }[]
  today: { date: string; rest: boolean; blocks: PlanBlock[] }
  daily: { q: string; node: string; hints: string[]; hint_count: number; done: boolean; sol: string | null }
  deadline:
    | { kind: 'hw'; id: number; title: string; due: string; task_id: number | null; count: number }
    | { kind: 'milestone'; title: string; date: string; days_left: number; exam_days: number }
  stars: {
    total: number
    ach: Record<string, string>
    eggs: Record<string, string>
    achievements: { id: string; name: string; desc: string }[]
    egg_meta: Record<string, { name: string; hint: string }>
  }
  xp: number
  stage: { current: string; next: string; left: number }
  streak: number
  chest: boolean
  hunt: boolean
  vdone: Record<string, boolean>
  mocks: number
  unread: number
}

export interface PlanData {
  exam: ExamInfo
  settings: { date: string; days: number; min: number }
  week: PlanDay[]
  phases: { name: string; share: number; from: string }[]
  freq: Record<string, number>
  studied: number
  mocks: number
  queue: number
  end: string
  total_days: number
  tasks: { id: string; n: number | string | null; name: string; risk: boolean; from?: string | null }[]
  root: string | null
  root_name: string | null
}

export interface DiagItem {
  id: string; t: 'num' | 'self'; task: string; n: number | null; q: string; nodes: string[]; src?: string; fig?: string; max?: number
}
export interface DiagRun { id: number; mode: 'first' | 'mock'; variant: number; position: number; answers: Record<string, string>; items: DiagItem[]; exam: ExamInfo }
export interface DiagResult {
  pts: number; right: number; of: number; mode: 'first' | 'mock'; value: number; prev: number | null; exam: ExamInfo
  strong: string[]; weak: string[]; root: string | null; root_name: string | null
  plan: { studied: number; days: number; min: number }; mocks: number
}

export interface NotificationItem { id: number; text: string; go: string | null; read: boolean; created_at: string | null }
export interface ChatMsg { role: 'user' | 'assistant'; content: string }

export interface TeacherOverview {
  classes: { id: number; name: string; code: string; student_ids: number[] }[]
  students: { id: number; name: string; grade: string | null; exam: string; pct: boolean; forecast: number; max: number; root: string | null; scores: Record<string, number> }[]
  tasks: { n: number; max: number; topic: string }[]
  errors: { name: string; count: number }[]
  reviews: { id: number; student: string; task: number; max: number; agents: number[]; judge: number }[]
  assignments: { id: number; class_id: number | null; topic: string; count: number; task_id: number | null; due: string; done: number }[]
}
export interface StudentDetail {
  id: number; name: string; exam: string; forecast: number; max: number; pct: boolean; root: string | null; weak: string[]
  tasks: { id: string; n: number | string | null; name: string; p: number; max: number; risk: boolean }[]
  history: { date: string | null; value: number; source: string }[]
}
export interface Textbook { id: number; title: string; authors: string; grade: string; filename: string | null; chars: number }
export interface Slide { title: string; bullets: string[]; note: string }
export interface MaterialOut { id: number; kind: 'conspect' | 'slides'; topic: string; text?: string; slides?: Slide[] }
