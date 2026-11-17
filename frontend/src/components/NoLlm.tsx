import { useApp } from '../app/store'

/** Shown on screens that need the language model while LLM_BASE_URL / LLM_API_KEY are not set. */
export default function NoLlm({ what }: { what: string }) {
  const { me } = useApp()
  if (me.llm_ready !== false) return null
  return (
    <div className="card" role="note" style={{ borderColor: 'var(--gold-ink)', background: 'var(--gold-soft)' }}>
      <b>{what} заработает после подключения модели</b>
      <p className="muted" style={{ marginTop: 4, fontSize: 14 }}>
        Нужно вписать LLM_BASE_URL и LLM_API_KEY в файл .env и перезапустить сервис. Остальное уже работает: диагностика, прогноз, расписание, карта знаний, разборы.
      </p>
    </div>
  )
}
