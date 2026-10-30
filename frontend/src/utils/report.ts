import { TaskResult, TASK_INFO } from '../types'

const CONSENSUS_LABEL: Record<string, string> = {
  full: 'Полный консенсус (3/3)',
  majority: 'Большинство (2/3)',
  judge_decision: 'Решение судьи (3 разных балла)',
}

export function generateReport(
  sessionId: string,
  results: Record<number, TaskResult>,
  maxTotal: number,
): void {
  const taskIds = Object.keys(TASK_INFO).map(Number)
  const done = taskIds.filter((id) => results[id]?.status === 'done')
  const totalScore = done.reduce((s, id) => s + (results[id]?.judge_decision?.final_score ?? 0), 0)
  const date = new Date().toLocaleString('ru-RU')

  const taskRows = taskIds.map((tid) => {
    const r = results[tid]
    const info = TASK_INFO[tid]
    const j = r?.judge_decision

    if (!r || r.status !== 'done' || !j) {
      return `
        <div class="task">
          <div class="task-header">
            <span class="task-num">Задание ${tid}</span>
            <span class="task-topic">${info.topic}</span>
            <span class="score not-checked">не проверено</span>
          </div>
        </div>`
    }

    const pct = j.final_score / j.max_score
    const scoreClass = pct === 1 ? 'full' : pct >= 0.5 ? 'partial' : 'low'

    const agentRows = (r.agent_verdicts ?? []).map((v) => `
      <tr>
        <td>Эксперт ${v.agent_id}</td>
        <td class="score-cell ${v.score === j.max_score ? 'full' : v.score >= j.max_score / 2 ? 'partial' : 'low'}">
          ${v.score}/${v.max_score}
        </td>
        <td>${v.reasoning}</td>
        <td>${v.errors_found.join('; ') || '—'}</td>
      </tr>`).join('')

    return `
      <div class="task">
        <div class="task-header">
          <span class="task-num">Задание ${tid}</span>
          <span class="task-topic">${info.topic}</span>
          <span class="score ${scoreClass}">${j.final_score} / ${j.max_score}</span>
        </div>

        <div class="judge-block">
          <div class="label">Вердикт судьи</div>
          <div class="consensus-badge">${CONSENSUS_LABEL[j.consensus_level] ?? j.consensus_level}</div>
          <p class="reasoning">${j.reasoning}</p>
        </div>

        <div class="agents-block">
          <div class="label">Оценки экспертов</div>
          <table>
            <thead><tr><th>Эксперт</th><th>Балл</th><th>Обоснование</th><th>Ошибки</th></tr></thead>
            <tbody>${agentRows}</tbody>
          </table>
        </div>

        ${r.ocr_text ? `
        <details class="ocr-block">
          <summary>OCR-текст решения (уверенность: ${((r.ocr_confidence ?? 0) * 100).toFixed(0)}%)</summary>
          <pre>${escapeHtml(r.ocr_text)}</pre>
        </details>` : ''}
      </div>`
  }).join('')

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>Отчёт ЕГЭ — сессия ${sessionId.slice(0, 8)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 14px; color: #1a1a1a; background: #fff; padding: 32px; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  .meta { color: #666; font-size: 13px; margin-bottom: 24px; }
  .summary { display: flex; gap: 24px; background: #f0f4ff; border-radius: 12px; padding: 20px 24px; margin-bottom: 32px; }
  .summary-item { text-align: center; }
  .summary-item .val { font-size: 28px; font-weight: 700; color: #2563eb; }
  .summary-item .lbl { font-size: 12px; color: #888; margin-top: 2px; }
  .task { border: 1px solid #e5e7eb; border-radius: 10px; padding: 20px; margin-bottom: 20px; break-inside: avoid; }
  .task-header { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
  .task-num { font-weight: 700; font-size: 13px; color: #6b7280; text-transform: uppercase; letter-spacing: .05em; }
  .task-topic { font-weight: 600; font-size: 16px; flex: 1; }
  .score { font-size: 20px; font-weight: 800; }
  .score.full { color: #16a34a; }
  .score.partial { color: #d97706; }
  .score.low { color: #dc2626; }
  .score.not-checked { font-size: 13px; color: #9ca3af; font-weight: 400; }
  .label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: #9ca3af; margin-bottom: 6px; }
  .judge-block { background: #f9fafb; border-radius: 8px; padding: 12px 14px; margin-bottom: 12px; }
  .consensus-badge { display: inline-block; font-size: 11px; background: #e0e7ff; color: #3730a3; border-radius: 4px; padding: 2px 8px; margin-bottom: 8px; }
  .reasoning { font-size: 13px; line-height: 1.6; color: #374151; }
  .agents-block { margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 4px; }
  th { text-align: left; padding: 6px 8px; background: #f3f4f6; font-weight: 600; border-bottom: 1px solid #e5e7eb; }
  td { padding: 6px 8px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
  .score-cell { font-weight: 700; white-space: nowrap; }
  .score-cell.full { color: #16a34a; }
  .score-cell.partial { color: #d97706; }
  .score-cell.low { color: #dc2626; }
  .ocr-block { margin-top: 10px; }
  .ocr-block summary { cursor: pointer; font-size: 12px; color: #6b7280; padding: 4px 0; }
  pre { font-size: 11px; background: #f8f9fa; border-radius: 6px; padding: 10px; margin-top: 6px; white-space: pre-wrap; word-break: break-word; color: #374151; }
  @media print {
    body { padding: 16px; }
    .task { page-break-inside: avoid; }
    details { display: none; }
  }
</style>
</head>
<body>
  <h1>Отчёт о проверке ЕГЭ</h1>
  <div class="meta">Сессия: ${sessionId} &nbsp;·&nbsp; Сформирован: ${date}</div>

  <div class="summary">
    <div class="summary-item">
      <div class="val">${totalScore} / ${maxTotal}</div>
      <div class="lbl">Итоговый балл</div>
    </div>
    <div class="summary-item">
      <div class="val">${Math.round((totalScore / maxTotal) * 100)}%</div>
      <div class="lbl">От максимума</div>
    </div>
    <div class="summary-item">
      <div class="val">${done.length} / ${taskIds.length}</div>
      <div class="lbl">Проверено заданий</div>
    </div>
  </div>

  ${taskRows}
</body>
</html>`

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `ege-report-${sessionId.slice(0, 8)}.html`
  a.click()
  URL.revokeObjectURL(url)
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
