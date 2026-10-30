from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    llm_base_url: str
    llm_api_key: str
    llm_model: str = "google/gemma-4-26b-a4b-it"
    agent_strategy: str = "temperature"
    uploads_dir: str = "/app/uploads"

    agent_temperatures: list[float] = [0.3, 0.7, 1.0]
    judge_temperature: float = 0.1

    database_url: str = "postgresql+asyncpg://postgres:postgres@db:5432/ege_checker"
    secret_key: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_days: int = 30

    class Config:
        env_file = ".env"


settings = Settings()
