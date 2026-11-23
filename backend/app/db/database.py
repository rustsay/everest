from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

engine = create_async_engine(settings.database_url, echo=False, pool_pre_ping=True)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:  # type: ignore[return]
    async with AsyncSessionLocal() as session:
        yield session


async def init_db() -> None:
    from app.db import models  # noqa: F401 — registers models with Base

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # create_all does not add columns to an existing table: add the profile columns by hand
        if conn.dialect.name == "postgresql":
            from sqlalchemy import text

            for ddl in (
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS name VARCHAR(80)",
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'student'",
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS grade VARCHAR(4)",
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS exam VARCHAR(10)",
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false",
                "ALTER TABLE generated_videos ADD COLUMN IF NOT EXISTS diagram JSONB",
                "ALTER TABLE generated_videos ADD COLUMN IF NOT EXISTS format_version INTEGER NOT NULL DEFAULT 0",
                "ALTER TABLE problem_walkthroughs ADD COLUMN IF NOT EXISTS diagram JSONB",
            ):
                await conn.execute(text(ddl))
