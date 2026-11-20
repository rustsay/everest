"""Concurrent walkthrough creation uses one row instead of raising a unique-key error."""
import asyncio
import os
import unittest
import uuid

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.walkthrough import _persist_walkthrough
from app.config import settings
from app.db.database import Base
from app.db.models import ProblemWalkthrough


@unittest.skipUnless(os.getenv("RUN_DB_TESTS") == "1", "Set RUN_DB_TESTS=1 for isolated PostgreSQL tests")
class WalkthroughRaceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.schema = "test_walkthrough_" + uuid.uuid4().hex
        self.admin = create_async_engine(settings.database_url)
        async with self.admin.begin() as conn:
            await conn.execute(text(f"CREATE SCHEMA {self.schema}"))
        self.engine = create_async_engine(settings.database_url, connect_args={
            "server_settings": {"search_path": self.schema},
        })
        async with self.engine.begin() as conn:
            await conn.run_sync(lambda sync: Base.metadata.create_all(sync, tables=[ProblemWalkthrough.__table__]))
        self.factory = async_sessionmaker(self.engine, expire_on_commit=False)

    async def asyncTearDown(self):
        await self.engine.dispose()
        async with self.admin.begin() as conn:
            await conn.execute(text(f"DROP SCHEMA {self.schema} CASCADE"))
        await self.admin.dispose()

    async def test_two_requests_return_one_saved_walkthrough(self):
        async def save(source, text_value):
            async with self.factory() as db:
                return await _persist_walkthrough(db, "f746", source, [{"title": text_value}])

        first, second = await asyncio.gather(save("ai", "первый"), save("solution", "второй"))
        self.assertEqual(first.id, second.id)
        async with self.factory() as db:
            count = await db.scalar(select(func.count()).select_from(ProblemWalkthrough))
            self.assertEqual(count, 1)


if __name__ == "__main__":
    unittest.main()
