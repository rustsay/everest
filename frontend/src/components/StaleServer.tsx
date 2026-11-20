/** The frontend is mounted live in docker compose, the backend is baked into its image: after `git pull` without
    `docker compose up -d --build backend` an old server answers with profile tasks. Say so instead of showing the wrong exam. */
export default function StaleServer({ want, got }: { want: string; got?: string | null }) {
  if (!want || got === want) return null
  return (
    <section className="card" role="alert" style={{ borderColor: 'var(--gold)', background: 'var(--gold-soft)' }}>
      <b>Сервер показывает задачи не того экзамена</b>
      <p style={{ fontSize: 13.5, marginTop: 4 }}>
        Нужны задачи {want === 'base' ? 'ЕГЭ базы' : want === 'oge' ? 'ОГЭ' : 'ЕГЭ профиля'}, а пришли {got === 'base' ? 'базы' : got === 'oge' ? 'ОГЭ' : 'профиля'}.
        Обычно это значит, что на сервере обновили код, но не пересобрали backend. Администратору: <code>docker compose up -d --build backend</code>
      </p>
    </section>
  )
}
