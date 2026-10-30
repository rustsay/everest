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
  consensus_level: 'full' | 'majority' | 'judge_decision'
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
