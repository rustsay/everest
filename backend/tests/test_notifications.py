"""Notification read state, using a disposable PostgreSQL schema."""
import os
import unittest
import uuid

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import learning
from app.config import settings
from app.db.database import Base
from app.db.models import Notification, User


@unittest.skipUnless(os.getenv('RUN_DB_TESTS') == '1', 'Set RUN_DB_TESTS=1 for isolated PostgreSQL tests')
class NotificationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.schema = 'test_notifications_' + uuid.uuid4().hex
        self.admin = create_async_engine(settings.database_url)
        async with self.admin.begin() as conn:
            await conn.execute(text(f'CREATE SCHEMA {self.schema}'))
        self.engine = create_async_engine(settings.database_url, connect_args={'server_settings': {'search_path': self.schema}})
        async with self.engine.begin() as conn:
            await conn.run_sync(lambda sync: Base.metadata.create_all(sync, tables=[User.__table__, Notification.__table__]))
        self.factory = async_sessionmaker(self.engine, expire_on_commit=False)
        async with self.factory() as db:
            self.owner = User(email='owner@example.test', password_hash='unused', role='student', grade='9', exam='oge')
            other = User(email='other@example.test', password_hash='unused', role='student', grade='9', exam='oge')
            db.add_all([self.owner, other])
            await db.flush()
            self.notes = [Notification(user_id=self.owner.id, text=f'Уведомление {i}') for i in range(25)]
            self.foreign = Notification(user_id=other.id, text='Чужое уведомление')
            db.add_all([*self.notes, self.foreign])
            await db.commit()
        app = FastAPI()
        app.include_router(learning.router, prefix='/api')

        async def get_db():
            async with self.factory() as db:
                yield db

        app.dependency_overrides[learning.get_db] = get_db
        app.dependency_overrides[learning.get_current_user] = lambda: self.owner
        self.client = AsyncClient(transport=ASGITransport(app=app), base_url='http://test')

    async def asyncTearDown(self):
        await self.client.aclose()
        await self.engine.dispose()
        async with self.admin.begin() as conn:
            await conn.execute(text(f'DROP SCHEMA {self.schema} CASCADE'))
        await self.admin.dispose()

    async def test_only_notifications_shown_in_the_list_are_marked_read(self):
        notes = (await self.client.get('/api/notifications')).json()['notifications']
        self.assertEqual(len(notes), 20)
        response = await self.client.post('/api/notifications/read', json={'ids': [n['id'] for n in notes]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['unread'], 5)
        reopened = (await self.client.get('/api/notifications')).json()['notifications']
        self.assertTrue(all(n['read'] for n in reopened))

    async def test_empty_selection_does_not_mark_everything_read(self):
        response = await self.client.post('/api/notifications/read', json={'ids': []})
        self.assertEqual(response.json()['unread'], 25)

    async def test_other_users_notification_cannot_be_marked_read(self):
        response = await self.client.post('/api/notifications/read', json={'ids': [self.notes[0].id, self.foreign.id]})
        self.assertEqual(response.json()['unread'], 24)
        async with self.factory() as db:
            foreign = await db.scalar(select(Notification).where(Notification.id == self.foreign.id))
            self.assertFalse(foreign.read)

    async def test_single_notification_and_read_all_remain_supported(self):
        response = await self.client.post('/api/notifications/read', json={'id': self.notes[0].id})
        self.assertEqual(response.json()['unread'], 24)
        response = await self.client.post('/api/notifications/read', json={})
        self.assertEqual(response.json()['unread'], 0)
