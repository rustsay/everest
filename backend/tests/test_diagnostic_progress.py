"""RUN_DB_TESTS=1 python -m unittest discover -s tests -p test_diagnostic_progress.py -v.

Uses a disposable PostgreSQL schema; no application records or uploaded files are changed.
"""
import io
import os
import tempfile
import unittest
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import AsyncMock, PropertyMock, patch

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import diag_work, learning
from app.config import settings
from app.db.database import Base
from app.db.models import Diagnostic, User
from app.learning import engine


@unittest.skipUnless(os.getenv('RUN_DB_TESTS') == '1', 'Set RUN_DB_TESTS=1 for isolated PostgreSQL tests')
class DiagnosticProgressTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.schema = 'test_diagnostic_' + uuid.uuid4().hex
        self.admin = create_async_engine(settings.database_url)
        async with self.admin.begin() as conn:
            await conn.execute(text(f'CREATE SCHEMA {self.schema}'))
        self.engine = create_async_engine(settings.database_url, connect_args={
            'server_settings': {'search_path': self.schema}})
        async with self.engine.begin() as conn:
            await conn.run_sync(lambda sync: Base.metadata.create_all(sync, tables=[User.__table__, Diagnostic.__table__]))
        self.factory = async_sessionmaker(self.engine, expire_on_commit=False)
        async with self.factory() as db:
            self.owner = User(email='owner@example.test', password_hash='unused', role='student', grade='9', exam='oge')
            self.other = User(email='other@example.test', password_hash='unused', role='student', grade='9', exam='oge')
            db.add_all([self.owner, self.other])
            await db.flush()
            self.run = Diagnostic(id=int(uuid.uuid4().hex[:7], 16), user_id=self.owner.id, mode='first', exam_key='oge',
                                  answers={'_fmt': 'types', '_choice': {'s20': '20.1'}, 's20': '?',
                                           '_work': {'s20': {'mode': 'dont_know', 'status': 'done'}}})
            db.add(self.run)
            await db.commit()
        self.items = [
            {'id': 't1', 't': 'num', 'n': 1, 'task': 'T1', 'q': '1 + 1', 'a': '2'},
            {'id': 's20', 't': 'work', 'n': 20, 'task': 'T20', 'q': '', 'max': 2, 'choices': [
                {'type': '20.1', 'q': 'x + 1 = 2', 'a': '1'},
                {'type': '20.2', 'q': '2x = 4', 'a': '2'},
            ]},
        ]
        self.temp = tempfile.TemporaryDirectory()
        self.patches = [
            patch.object(engine, 'items_of', return_value=self.items),
            patch.object(diag_work, 'AsyncSessionLocal', self.factory),
            patch.object(diag_work, '_folder', return_value=Path(self.temp.name)),
            patch.object(type(settings), 'llm_ready', new_callable=PropertyMock, return_value=False),
        ]
        for p in self.patches:
            p.start()
        app = FastAPI()
        app.include_router(learning.router, prefix='/api')
        app.include_router(diag_work.router, prefix='/api')

        async def get_db():
            async with self.factory() as db:
                yield db

        app.dependency_overrides[learning.get_db] = get_db
        app.dependency_overrides[learning.get_current_user] = lambda: self.owner
        self.app = app
        self.client = AsyncClient(transport=ASGITransport(app=app), base_url='http://test')
        self.base = f'/api/diagnostics/{self.run.id}'

    async def asyncTearDown(self):
        await self.client.aclose()
        for p in reversed(self.patches):
            p.stop()
        self.temp.cleanup()
        await self.engine.dispose()
        async with self.admin.begin() as conn:
            await conn.execute(text(f'DROP SCHEMA {self.schema} CASCADE'))
        await self.admin.dispose()

    async def answers(self):
        async with self.factory() as db:
            return (await db.get(Diagnostic, self.run.id)).answers

    async def store(self, answers):
        async with self.factory() as db:
            d = await db.get(Diagnostic, self.run.id)
            d.answers = answers
            await db.commit()

    async def test_answers_do_not_override_saved_navigation_position(self):
        r = await self.client.put(self.base + '/progress', json={'position': 1})
        self.assertEqual(r.status_code, 200)
        r = await self.client.put(self.base + '/answer', json={'item_id': 't1', 'answer': '2'})
        self.assertEqual(r.status_code, 200)
        r = (await self.client.get('/api/diagnostics/open/first')).json()
        self.assertEqual(r['position'], 1)
        self.assertEqual(r['answers']['t1'], '2')

    async def test_changing_type_clears_previous_dont_know(self):
        r = await self.client.put(self.base + '/items/s20/choice', json={'type': '20.2'})
        self.assertEqual(r.status_code, 200)
        answers = await self.answers()
        self.assertNotIn('s20', answers)
        self.assertNotIn('s20', answers['_work'])
        self.assertEqual(answers['_choice']['s20'], '20.2')
        answers['_work']['s20'] = {'mode': 'photo', 'status': 'done', 'result': {'score': 2}}
        self.assertEqual(engine.eval_item(self.items[1], answers)['pts'], 2)

    async def test_upload_to_same_type_clears_previous_dont_know(self):
        from app.api import batch
        with patch.object(batch, 'file_pages', return_value=[(b'jpeg', 'p0.jpg')]), \
                patch.object(diag_work, '_analyze', new_callable=AsyncMock):
            r = await self.client.post(self.base + '/items/s20/work', files={'files': ('scan.png', io.BytesIO(b'png'), 'image/png')})
        self.assertEqual(r.status_code, 200)
        answers = await self.answers()
        self.assertNotEqual(answers.get('s20'), '?')
        self.assertEqual(answers['_work']['s20']['mode'], 'photo')
        self.assertNotIn('upload_id', r.json()['work']['s20'])
        answers['_work']['s20'].update(status='done', result={'score': 2})
        self.assertEqual(engine.eval_item(self.items[1], answers)['pts'], 2)

    async def test_old_photo_check_cannot_overwrite_a_replacement(self):
        answers = {'_work': {'s20': {'mode': 'photo', 'status': 'pending', 'files': 2, 'upload_id': 'new'}}}
        await self.store(answers)
        await diag_work._analyze(self.run.id, 's20', self.items[1], [], upload_id='old')
        self.assertEqual(await self.answers(), answers)
        await diag_work._analyze(self.run.id, 's20', self.items[1], [], upload_id='new')
        work = (await self.answers())['_work']['s20']
        self.assertEqual(work['status'], 'skipped')
        self.assertEqual(work['files'], 2)

    async def test_progress_is_clamped_and_other_user_cannot_write_it(self):
        r = await self.client.put(self.base + '/progress', json={'position': 1000})
        self.assertEqual(r.json()['position'], 1)
        self.app.dependency_overrides[learning.get_current_user] = lambda: self.other
        r = await self.client.put(self.base + '/progress', json={'position': 0})
        self.assertEqual(r.status_code, 404)

    async def test_type_cannot_change_after_exam_deadline(self):
        answers = await self.answers()
        answers['_exam'] = {'start': (datetime.utcnow() - timedelta(minutes=300)).isoformat(), 'limit': 235}
        await self.store(answers)
        r = await self.client.put(self.base + '/items/s20/choice', json={'type': '20.2'})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(await self.answers(), answers)
