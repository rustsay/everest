"""DB integration: RUN_DB_TESTS=1 python -m unittest discover -s tests -v.

Each test uses a disposable PostgreSQL schema; application data is untouched.
"""
import asyncio
import os
import unittest
import uuid
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, PropertyMock, patch

from fastapi import FastAPI, Header
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import review_chats as api
from app.config import settings
from app.db.database import Base
from app.db.models import ReviewChat, Session, TaskResult, User


@unittest.skipUnless(os.getenv('RUN_DB_TESTS') == '1', 'Set RUN_DB_TESTS=1 for isolated PostgreSQL tests')
class ReviewChatTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.schema = 'test_review_' + uuid.uuid4().hex
        self.admin = create_async_engine(settings.database_url)
        async with self.admin.begin() as conn:
            await conn.execute(text(f'CREATE SCHEMA {self.schema}'))
        self.engine = create_async_engine(settings.database_url, connect_args={
            'server_settings': {'search_path': self.schema}})
        async with self.engine.begin() as conn:
            await conn.run_sync(lambda sync: Base.metadata.create_all(sync, tables=[
                User.__table__, Session.__table__, TaskResult.__table__, ReviewChat.__table__]))
        self.factory = async_sessionmaker(self.engine, expire_on_commit=False)
        self.sid = uuid.uuid4()
        async with self.factory() as db:
            self.owner = User(email='owner@example.test', password_hash='unused', role='student')
            self.other = User(email='other@example.test', password_hash='unused', role='student')
            db.add_all([self.owner, self.other])
            await db.flush()
            db.add(Session(id=self.sid, user_id=self.owner.id))
            await db.flush()
            self.result = TaskResult(session_id=self.sid, task_id=15, status='done',
                ocr_text='3^x > 9; x > 2', updated_at=datetime(2026, 11, 17, 12),
                judge_decision={'final_score': 2, 'max_score': 2, 'reasoning': 'Решение верное'},
                agent_verdicts=[{'agent_id': 1, 'reasoning': 'Замена переменной верна'}])
            db.add(self.result)
            await db.commit()
        app = FastAPI()
        app.include_router(api.router, prefix='/api')

        async def get_db():
            async with self.factory() as db:
                yield db

        async def get_user(x_test_user: str = Header(default='owner')):
            return self.other if x_test_user == 'other' else self.owner

        app.dependency_overrides[api.get_db] = get_db
        app.dependency_overrides[api.get_current_user] = get_user
        self.client = AsyncClient(transport=ASGITransport(app=app), base_url='http://test')
        self.ready_patch = patch.object(type(settings), 'llm_ready', new_callable=PropertyMock, return_value=True)
        self.ready = self.ready_patch.start()
        self.llm_patch = patch.object(api.llm, 'review_chat', AsyncMock(return_value='Логарифм по основанию 3 возрастает.'))
        self.llm = self.llm_patch.start()

    async def asyncTearDown(self):
        self.llm_patch.stop()
        self.ready_patch.stop()
        await self.client.aclose()
        await self.engine.dispose()
        async with self.admin.begin() as conn:
            await conn.execute(text(f'DROP SCHEMA {self.schema} CASCADE'))
        await self.admin.dispose()

    async def open(self, **kwargs):
        return await self.client.post(f'/api/sessions/{self.sid}/tasks/15/chat', **kwargs)

    async def test_reopen_same_check_preserves_history_and_supplies_context(self):
        first = (await self.open()).json()
        response = await self.client.post(f"/api/review-chats/{first['id']}/messages", json={'text': 'Почему x > 2?'})
        self.assertEqual(response.status_code, 200, response.text)
        context, history = self.llm.call_args.args
        self.assertIn('3^x > 9', context['ocr_text'])
        self.assertEqual(context['judge_decision']['reasoning'], 'Решение верное')
        self.assertEqual(context['agent_verdicts'][0]['agent_id'], 1)
        self.assertTrue(context['criteria'])
        self.assertEqual(history[-1]['content'], 'Почему x > 2?')
        reopened = (await self.open()).json()
        self.assertEqual(reopened['id'], first['id'])
        self.assertEqual(len(reopened['messages']), 2)
        listing = (await self.client.get('/api/review-chats')).json()['chats']
        self.assertEqual(listing[0]['id'], first['id'])
        self.assertEqual(listing[0]['message_count'], 2)

    async def test_other_user_cannot_access_session_or_conversation(self):
        chat = (await self.open()).json()
        headers = {'x-test-user': 'other'}
        self.assertEqual((await self.open(headers=headers)).status_code, 404)
        self.assertEqual((await self.client.get(f"/api/review-chats/{chat['id']}", headers=headers)).status_code, 404)
        self.assertEqual((await self.client.post(f"/api/review-chats/{chat['id']}/messages", headers=headers, json={'text': 'Вопрос'})).status_code, 404)
        self.assertEqual((await self.client.get('/api/review-chats', headers=headers)).json()['chats'], [])
        self.llm.assert_not_awaited()

    async def test_recheck_creates_separate_thread_and_keeps_original_context(self):
        old = (await self.open()).json()
        async with self.factory() as db:
            result = await db.get(TaskResult, self.result.id)
            result.judge_decision = {'final_score': 1, 'max_score': 2, 'reasoning': 'Новый вердикт'}
            result.ocr_text = 'Новое решение'
            result.updated_at += timedelta(seconds=1)
            await db.commit()
        new = (await self.open()).json()
        self.assertNotEqual(new['id'], old['id'])
        await self.client.post(f"/api/review-chats/{old['id']}/messages", json={'text': 'Объясни старый балл'})
        self.assertEqual(self.llm.call_args.args[0]['judge_decision']['final_score'], 2)
        self.assertEqual(len((await self.client.get('/api/review-chats')).json()['chats']), 2)

    async def test_failed_or_empty_request_does_not_change_history(self):
        chat = (await self.open()).json()
        url = f"/api/review-chats/{chat['id']}/messages"
        self.assertEqual((await self.client.post(url, json={'text': '   '})).status_code, 422)
        self.llm.side_effect = RuntimeError('Model offline')
        self.assertEqual((await self.client.post(url, json={'text': 'Вопрос'})).status_code, 502)
        self.assertEqual((await self.client.get(f"/api/review-chats/{chat['id']}")).json()['messages'], [])
        self.ready.return_value = False
        self.assertEqual((await self.client.post(url, json={'text': 'Вопрос'})).status_code, 503)

    async def test_simultaneous_questions_keep_both_turns(self):
        chat = (await self.open()).json()
        async def reply(context, history):
            await asyncio.sleep(0.05)
            return f"Ответ на {history[-1]['content']}"
        self.llm.side_effect = reply
        url = f"/api/review-chats/{chat['id']}/messages"
        responses = await asyncio.gather(*(self.client.post(url, json={'text': q}) for q in ['Первый', 'Второй']))
        self.assertTrue(all(r.status_code == 200 for r in responses))
        messages = (await self.client.get(f"/api/review-chats/{chat['id']}")).json()['messages']
        self.assertEqual([m['role'] for m in messages], ['user', 'assistant', 'user', 'assistant'])
        self.assertEqual(len(self.llm.call_args.args[1]), 3)

    async def test_pending_result_cannot_start_chat(self):
        async with self.factory() as db:
            result = await db.get(TaskResult, self.result.id)
            result.status = 'checking'
            await db.commit()
        self.assertEqual((await self.open()).status_code, 409)
