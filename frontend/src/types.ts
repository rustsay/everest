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
  /** false when the language model is not configured on the server */
  llm_ready?: boolean
  diag_done?: boolean
  diag_in_progress?: boolean
  classes?: { id: number; name: string }[]
  /** the email is in ADMIN_EMAILS on the server */
  admin?: boolean
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
  k: 'warm' | 'topic' | 'deep' | 'step' | 'p2' | 'school' | 'rep' | 'mock'
  min: number; title: string; sub: string; node?: string
  /** day block: geometry, algebra, probability, functions; proto: the prototype of the task map */
  block?: string; proto?: string
  tasks?: { id: string; n: number | string | null; name: string }[]
  key?: string; done?: boolean
}
export interface PlanEvent { id: string; title: string; kind: 'own' | 'subject'; start?: string; min?: number; busy?: boolean }
export interface MyEvent extends PlanEvent { repeat: 'weekly' | 'once'; weekdays: number[]; date?: string | null; until?: string | null }
export interface PlanDay { date: string; rest?: boolean; busy?: boolean; heavy?: boolean; past?: boolean; mock?: number; blocks: PlanBlock[]; events?: PlanEvent[] }

export type RouteBasis = 'path' | 'diag' | 'practice' | 'start'
export interface Dashboard {
  exam: ExamInfo
  redo?: { due: number; total: number; done: number }
  diag_done?: boolean
  /** what the schedule rests on: a diagnostic, answers and photo checks, or nothing yet */
  route_basis?: RouteBasis
  /** the stage of the educational trajectory the schedule follows today */
  path_stage?: PathStageInfo | null
  target?: Target | null
  part2?: Part2Info
  forecast: number
  gain: number
  model: { nodes: GraphNode[]; tasks: ExamTask[]; root: string | null; root_tasks: string[]; at_risk: number; weak: string[]; threat: string[]; basics?: boolean }
  history: { date: string; value: number; source: string }[]
  deltas: { node: string; name: string; delta: number }[]
  today: { date: string; rest: boolean; busy?: boolean; blocks: PlanBlock[]; events?: PlanEvent[]; time?: string }
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
  settings: { date: string; days: number; min: number; wd?: number[]; time?: string }
  events?: MyEvent[]; week_index?: number
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
  route_basis?: RouteBasis
  path_stage?: PathStageInfo | null
  target?: Target | null
  part2?: Part2Info
  needed?: string[]
}
/** The score the student wants: test points and the primary points they need (scale of 2026). */
export interface Target { test: number; primary: number }
/** Is the second part in the schedule, and from which day (it waits until the first part is mastered). */
export interface Part2Info { needed: boolean; open_from: string | null }

export interface DiagChoice { type: string; proto: string; name: string; q: string; img?: string | null; src: string }
export interface DiagItem {
  id: string; t: 'num' | 'self' | 'work'; task: string; n: number | null; q: string; nodes: string[]; src?: string; fig?: string; max?: number
  /** task 8 of the profile exam: may be solved orally, without a photo */
  oral?: boolean
  /** the diagnostic by types: the type of a first-part item ("1.3"), its name and how many types the task has */
  type?: string; type_name?: string; of_types?: number
  /** a problem of the open FIPI bank: its picture */
  img?: string | null
  /** part 2 of the diagnostic by types: the student chooses one type */
  choices?: DiagChoice[]
}
export interface DiagWork { mode: 'photo' | 'dont_know' | 'oral' | null; status: 'pending' | 'done' | 'skipped' | 'error' | null; files: number; comment: string }
export interface DiagRun {
  id: number; mode: 'first' | 'mock'; variant: number; position: number; answers: Record<string, string>; items: DiagItem[]; exam: ExamInfo
  work: Record<string, DiagWork>; llm_ready: boolean
  /** the diagnostic by types: part-2 item id -> chosen type */
  choice?: Record<string, string>; typed?: boolean
  /** a mock in exam conditions: minutes in all and seconds left */
  exam_mode?: { limit: number; left: number } | null
}
export interface DiagResult {
  pts: number; right: number; of: number; mode: 'first' | 'mock'; value: number; prev: number | null; exam: ExamInfo
  strong: string[]; weak: string[]; root: string | null; root_name: string | null; basics?: boolean
  plan: { studied: number; days: number; min: number }; mocks: number
  id?: number; analytics?: DiagAnalytics
}
export interface DiagRow {
  id: string; n: number | null; task: string; name: string; part: number; block: string; kind: string; label: string; note: string
  errors: string[]; pts: number; max: number; answer: string | null; right: string | null; photo: boolean; topics: string[]
  /** the diagnostic by types: "1.3" */
  type?: string | null
}
export interface DiagAnalytics {
  rows: DiagRow[]; counts: Record<string, number>; blocks: { name: string; pts: number; max: number; pct: number }[]
  part1: { pts: number; max: number }; part2: { pts: number; max: number } | null
  gains: { task: string; name: string; why: string; pts: number; kind: string; part: number }[]
  advice: { kind: string; text: string; tasks: string[] }[]; facts: string[]; summary: string | null
}
export interface DiagListItem { id: number; mode: 'first' | 'mock'; date: string | null; value: number | null; right: number | null; of: number | null }

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
  tasks: { id: string; n: number | string | null; name: string; p: number; max: number; risk: boolean
    prac?: { ok: number; all: number } | null; check?: { score: number; max: number; date: string | null } | null; diag?: string | null }[]
  history: { date: string | null; value: number; source: string }[]
  target?: Target | null
  diag?: { date: string | null; mode: string; right: number; count: number; summary?: string | null; facts?: string[]
    blocks?: { name: string; pts: number; max: number; pct: number }[]; gains?: { task: string; name: string; why: string; pts: number }[]
    items: { id: string; task: string; n: number | null; q: string; status: string; note: string; answer: string | null; right: string | null; photo: boolean }[] } | null
  checks?: { id: number; n: number; score: number; max: number; date: string | null; errors: string[]; teacher: boolean }[]
  variants?: { title: string; score: number; max: number; date: string | null }[]
  path?: { id: number; stage: string | null; count: number } | null
  taskmap?: { done: number; ok: number }
}
export interface Textbook { id: number; title: string; authors: string; grade: string; filename: string | null; chars: number; pages?: number }
export interface Slide { title: string; bullets: string[]; note: string; formula?: string; fig?: string; kind?: string; page?: string }
export interface MaterialOut { id: number; kind: 'conspect' | 'slides'; topic: string; text?: string; slides?: Slide[]; pages?: string[] }

// ---------- task maps (knowledge map of one exam task) ----------
export interface TmStat { pct: number | null; ok: number; count: number }
export interface TmProblem { id: string; q: string; done: 0 | 1 | null; sol: string | null; src: string; check: 'answer' | 'photo'; img?: string | null; ans_img?: string | null }
export interface TmFile { id: number; name: string; size: number; mine: boolean }
export interface TmProto extends TmStat {
  id: string; name: string; fig: string | null; skills: string[]; know: string[]; added: string | null
  links: { title: string; url: string }[]; from_diag: number; problems: TmProblem[]; files: TmFile[]
}
export interface TmSkill extends TmStat { id: string; name: string; short: string; know: string[]; fig: string | null }
export interface TaskMapData {
  n: number; name: string; part: 1 | 2
  skills: TmSkill[]; protos: TmProto[]
  total: TmStat & { covered: number; of: number }
  can_upload: boolean
}
export interface TmAnswer { ok: boolean; first: boolean; answer: string; sol: string; redo?: 'added' | 'next' | 'done' | 'again' | null }
export interface SkillExplain { text: string | null; book: { id: number; title: string; authors: string }; pages: string[]; cached?: boolean; message?: string }

// ---------- task bank ----------
export interface BankItem { id: number; task: number; proto: string; text: string; answer: string | null; solution: string; source: string; status: 'draft' | 'approved'; mine: boolean }
export interface BankTask { n: number; name: string; protos: { id: string; name: string }[] }

// ---------- practice bank and variants ----------
export interface PracticeItem { ref: string; pid: string; task: number; proto: string; proto_name: string; q: string; src: string; check: 'answer' | 'photo'; done: 0 | 1 | null; sol: string | null; answer?: string | null; fig?: string | null; img?: string | null; ans_img?: string | null }
export interface VariantSummary { id: number; title: string; count: number; class_id: number | null; class_name: string | null; due: string | null; attempt: { score: number; max: number } | null }
export interface VariantFull {
  id: number; title: string; class_id: number | null; due: string | null; owner: boolean; items: PracticeItem[]
  attempt?: { answers: Record<string, string>; results: Record<string, 0 | 1>; score: number; max: number }
  results?: { name: string; score: number; max: number; results: Record<string, 0 | 1> }[]
}

// ---------- educational trajectory ----------
export interface PathStageInfo { title: string | null; goal: string | null; index: number | null; count: number; approved: boolean }
export interface PathStage {
  title: string; from: string; to: string; goal: string; check: string; tasks: string[]; problems?: string[]; steps?: string[]
  /** a module of the methodology (profile): id, hours of study, weeks, links to the walkthroughs */
  module?: string; hours?: number; weeks?: number; links?: { label: string; go: string }[]
}
export interface PathMethod {
  plan: number; plan_name: string; part1_share: number; expect_base: number[]; expect: number[]
  hours_week: number; hours_need: number; cut: string[]; high: boolean; review_weeks: number
}
export interface PathData {
  source: 'ai' | 'rules' | 'method'; fallback?: string; edited?: boolean; summary: string; why: string[]; stages: PathStage[]
  method?: PathMethod
  student_edit?: { comment: string; at: string }
  exam: string; end: string; built: string; labels: Record<string, string>; nums: Record<string, number | string | null>
}
export interface PathOut {
  id: number; status: 'draft' | 'pending' | 'active' | 'archived' | 'rejected'; kind: 'student' | 'class'
  student_id: number | null; student_name: string | null; class_id: number | null; class_name: string | null
  author: string | null; approved_by: string | null; note: string; data: PathData; created_at: string | null; approved_at: string | null
}
export interface MyPath {
  mode: 'solo' | 'class'; teachers: string[]; follow: boolean; llm_ready: boolean; building?: boolean; target?: Target | null
  active: PathOut | null; pending: PathOut | null; rejected: PathOut | null; class_path: PathOut | null
}
interface PathRefs { active: number | null; pending: number | null; draft: number | null }
export interface TeacherPaths {
  pending: PathOut[]; llm_ready: boolean
  classes: ({ id: number; name: string; students: number } & PathRefs)[]
  students: ({ id: number; name: string; exam: string; classes: string[] } & PathRefs)[]
}

// ---------- board walkthrough of a bank problem ----------
export interface Walkthrough {
  ref: string; task: number; q: string; title: string; proto_name: string; fig: string | null; source: 'ai' | 'solution'
  steps: { title: string; lines: string[]; text: string }[]; img?: string | null
}

// ---------- photo check of the first part ----------
export interface Check1Result {
  ok: boolean; right: string | null; keyed: boolean; method_ok: boolean; error: string; comment: string
  kind: 'ok' | 'ok_doubt' | 'slip' | 'method'; first?: boolean; sol?: string
}
export interface Check1Item extends Check1Result { at: string; task: number; ref: string | null; problem: string; answer: string }
export interface RedoItem extends PracticeItem { step: number; added: string; tries: number }

// ---------- weekly report ----------
export interface WeekReport {
  from: string; to: string; active: number; active_days: string[]; solved: number; ok: number; checks: number; checks1: number; fixed: number
  acc: number | null; forecast: number; delta: number | null; pct: boolean; max: number; target: Target | null; gap: number | null
  redo_due: number; redo_total: number; focus: { task: string; name: string; p: number }[]; lines: string[]
  parent_email?: string | null; smtp?: boolean
}
export interface ClassWeek {
  from: string; to: string
  classes: { id: number; name: string; students: { id: number; name: string; active: number; solved: number; ok: number; acc: number | null; checks: number; checks1: number
    fixed: number; forecast: number; delta: number | null; pct: boolean; max: number; gap: number | null; redo_due: number; flag: string | null }[] }[]
}

export interface PushSettings { key: string; devices: number; remind: boolean; time: string; student: boolean }

export interface AdminStats {
  today: string; days: number; from: string; admins: number
  users: { total: number; students: number; teachers: number; tutors: number; demo: number; new7: number; new: number; push: number; in_class: number }
  active: { today: number; week: number; period: number }
  series: { date: string; active: number; students: number; new: number }[]
  sections: { name: string; users7: number; users: number; hits: number }[]
  actions: { name: string; value: number }[]
  funnel: { name: string; value: number }[]
}

export interface AdminUser {
  id: number; name: string; email: string; role: Role; grade: string | null; exam: string | null
  created: string | null; last: string | null; days30: number; sections: string[]
  solved: number; ok: number; checks: number; diags: number; push: boolean; classes: number
}
