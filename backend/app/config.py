from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # empty or left as in .env.example = no model connected: everything except LLM features still works
    llm_base_url: str = ""
    llm_api_key: str = ""
    llm_model: str = "google/gemma-4-26b-a4b-it"
    agent_strategy: str = "temperature"
    uploads_dir: str = "/app/uploads"

    agent_temperatures: list[float] = [0.3, 0.7, 1.0]
    judge_temperature: float = 0.1

    database_url: str = "postgresql+asyncpg://postgres:postgres@db:5432/ege_checker"
    secret_key: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_days: int = 30

    # email codes (registration and «Забыли пароль»). No SMTP_HOST: the code is written to the backend log
    email_confirm: bool = True
    smtp_host: str = ""
    smtp_port: int = 465
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""

    class Config:
        env_file = ".env"

    @property
    def llm_ready(self) -> bool:
        url, key = self.llm_base_url.strip(), self.llm_api_key.strip()
        return bool(url and key) and "your-llm-server" not in url and key != "your-api-key"

    @property
    def smtp_ready(self) -> bool:
        return bool(self.smtp_host.strip())


settings = Settings()

NO_LLM = ("Модель пока не подключена: впишите LLM_BASE_URL и LLM_API_KEY в .env и перезапустите сервис. "
          "Без неё работают диагностика, прогноз, расписание, карта знаний, разборы и кабинет учителя.")
