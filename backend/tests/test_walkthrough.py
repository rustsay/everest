"""Exact diagnostic walkthroughs, personal feedback, ownership and concurrent caching."""
import asyncio
import os
import unittest
import uuid
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, PropertyMock, patch

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.walkthrough import _persist_walkthrough
from app.api import learning, walkthrough as api
from app.config import settings
from app.db.database import Base
from app.db.models import Diagnostic, ProblemWalkthrough, User


@unittest.skipUnless(os.getenv("RUN_DB_TESTS") == "1", "Set RUN_DB_TESTS=1 for isolated PostgreSQL tests")
class WalkthroughTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.schema = "test_walkthrough_" + uuid.uuid4().hex
        self.admin = create_async_engine(settings.database_url)
        async with self.admin.begin() as conn:
            await conn.execute(text(f"CREATE SCHEMA {self.schema}"))
        self.engine = create_async_engine(settings.database_url, connect_args={
            "server_settings": {"search_path": self.schema},
        })
        async with self.engine.begin() as conn:
            await conn.run_sync(lambda sync: Base.metadata.create_all(sync, tables=[User.__table__, Diagnostic.__table__, ProblemWalkthrough.__table__]))
        self.factory = async_sessionmaker(self.engine, expire_on_commit=False)
        async with self.factory() as db:
            self.owner = User(email='owner@example.test', password_hash='unused', role='student', grade='11', exam='prof')
            self.other = User(email='other@example.test', password_hash='unused', role='student', grade='11', exam='prof')
            db.add_all([self.owner, self.other])
            await db.flush()
            self.run = Diagnostic(user_id=self.owner.id, mode='first', exam_key='prof', finished=True,
                                  answers={'t1_2': '5', '_choice': {'s13': '13.2'}, '_work': {
                                      't1_2': {'mode': 'photo', 'status': 'done', 'result': {
                                          'method_ok': True, 'error': 'вычислительная', 'comment': 'При вычитании потерян знак минус.'}},
                                      's13': {'mode': 'photo', 'status': 'done', 'result': {'score': 1, 'comment': 'Потерян корень.', 'errors': ['Не учтён x = 2.']}},
                                  }}, result={'analytics': {'rows': [{'id': 't1_2'}, {'id': 's13'}]}})
            db.add(self.run)
            await db.commit()
        self.items = [
            {'id': 't1_1', 'n': 1, 'task': 'T1', 't': 'num', 'q': 'Другая задача', 'a': '100', 'type_name': 'Первый тип'},
            {'id': 't1_2', 'n': 1, 'task': 'T1', 't': 'num', 'q': 'Вычисли 2 − 7.', 'a': '-5', 'type_name': 'Второй тип'},
            {'id': 's13', 'n': 13, 'task': 'T13', 't': 'work', 'q': '', 'max': 2, 'choices': [
                {'type': '13.1', 'name': 'Первый тип', 'q': 'x = 100', 'a': '100'},
                {'type': '13.2', 'name': 'Второй тип', 'q': '(x − 1)(x − 2) = 0', 'a': '1; 2'},
            ]},
        ]
        self.steps = [{'title': 'Проверяем знак', 'lines': ['2 − 7 = −5'], 'text': 'При вычитании большего числа получается отрицательное число.'},
                      {'title': 'Ответ', 'lines': ['−5'], 'text': 'Ответ: минус пять.'}]
        self.patches = [
            patch.object(api.engine, 'items_of', return_value=self.items),
            patch.object(type(settings), 'llm_ready', new_callable=PropertyMock, return_value=True),
            patch('app.video.steps.generate_steps', new_callable=AsyncMock, return_value={'title': 'Разбор', 'steps': self.steps}),
        ]
        started = [p.start() for p in self.patches]
        self.generate = started[-1]
        app = FastAPI()
        app.include_router(api.router, prefix='/api')
        app.include_router(learning.router, prefix='/api')

        async def get_db():
            async with self.factory() as db:
                yield db

        app.dependency_overrides[api.get_db] = get_db
        app.dependency_overrides[api.get_current_user] = lambda: self.owner
        self.app = app
        self.client = AsyncClient(transport=ASGITransport(app=app), base_url='http://test')
        self.base = f'/api/diagnostics/{self.run.id}/items'

    async def asyncTearDown(self):
        await self.client.aclose()
        for p in reversed(self.patches):
            p.stop()
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

    async def test_exact_first_part_problem_and_actual_error_are_used_and_cached(self):
        first = await self.client.post(self.base + '/t1_2/walkthrough')
        self.assertEqual(first.status_code, 200, first.text)
        data = first.json()
        self.assertEqual(data['q'], 'Вычисли 2 − 7.')
        self.assertEqual(data['feedback']['answer'], '5')
        self.assertEqual(data['feedback']['kind'], 'slip')
        self.assertIn('знак минус', data['feedback']['note'])
        prompt = self.generate.call_args.args[0]
        self.assertIn('Вычисли 2 − 7.', prompt)
        self.assertNotIn('Другая задача', prompt)
        self.assertEqual(self.generate.call_args.kwargs['feedback'], data['feedback'])
        second = await self.client.post(self.base + '/t1_2/walkthrough')
        self.assertEqual(second.json(), data)
        self.assertEqual(self.generate.await_count, 1)

    async def test_selected_second_part_type_and_error_are_used(self):
        r = await self.client.post(self.base + '/s13/walkthrough')
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()['q'], '(x − 1)(x − 2) = 0')
        self.assertEqual(r.json()['feedback']['errors'], ['Не учтён x = 2.'])
        self.assertIn('(x − 1)(x − 2) = 0', self.generate.call_args.args[0])
        self.assertNotIn('x = 100', self.generate.call_args.args[0])

    async def test_other_user_cannot_read_cached_personal_walkthrough(self):
        self.assertEqual((await self.client.post(self.base + '/t1_2/walkthrough')).status_code, 200)
        self.app.dependency_overrides[api.get_current_user] = lambda: self.other
        r = await self.client.post(self.base + '/t1_2/walkthrough')
        self.assertEqual(r.status_code, 404)
        self.assertEqual(self.generate.await_count, 1)

    async def test_same_problem_for_another_learner_gets_a_separate_cache(self):
        a = (await self.client.post(self.base + '/t1_2/walkthrough')).json()
        async with self.factory() as db:
            d = Diagnostic(user_id=self.other.id, mode='mock', exam_key='prof', finished=True, answers={'t1_2': '0'})
            db.add(d)
            await db.commit()
        self.app.dependency_overrides[api.get_current_user] = lambda: self.other
        b = (await self.client.post(f'/api/diagnostics/{d.id}/items/t1_2/walkthrough')).json()
        self.assertNotEqual(a['ref'], b['ref'])
        self.assertEqual(b['feedback']['answer'], '0')
        self.assertEqual(b['feedback']['note'], '')
        self.assertEqual(self.generate.await_count, 2)

    async def test_unfinished_diagnostic_and_unknown_item_are_rejected(self):
        self.assertEqual((await self.client.post(self.base + '/missing/walkthrough')).status_code, 404)
        async with self.factory() as db:
            d = await db.get(Diagnostic, self.run.id)
            d.finished = False
            await db.commit()
        self.assertEqual((await self.client.post(self.base + '/t1_2/walkthrough')).status_code, 404)
        self.generate.assert_not_called()

    async def test_no_type_selected_does_not_substitute_a_problem(self):
        async with self.factory() as db:
            d = await db.get(Diagnostic, self.run.id)
            d.answers = {}
            await db.commit()
        self.assertEqual((await self.client.post(self.base + '/s13/walkthrough')).status_code, 400)
        report = (await self.client.get(f'/api/diagnostics/{self.run.id}/analytics')).json()
        available = {row['id']: row['walkthrough_available'] for row in report['analytics']['rows']}
        self.assertFalse(available['s13'])
        self.assertTrue(available['t1_2'])
        self.generate.assert_not_called()

    async def test_original_condition_and_shared_picture_reach_generator(self):
        with tempfile.TemporaryDirectory() as folder:
            shared, condition = Path(folder) / 'shared.png', Path(folder) / 'condition.png'
            shared.write_bytes(b'shared-picture')
            condition.write_bytes(b'exact-condition')
            self.items[1].update(ctx_img='/shared.png', img='/condition.png')
            with patch('app.learning.exambank.path_of', side_effect=lambda url: shared if url == '/shared.png' else condition):
                r = await self.client.post(self.base + '/t1_2/walkthrough')
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()['img'], '/condition.png')
        import base64
        self.assertEqual([base64.b64decode(x) for x in self.generate.call_args.args[1]], [b'shared-picture', b'exact-condition'])

    async def test_without_model_use_only_the_original_written_solution(self):
        self.items[1]['sol'] = 'Из двух вычитаем семь. Получаем минус пять.'
        with patch.object(type(settings), 'llm_ready', new_callable=PropertyMock, return_value=False):
            r = await self.client.post(self.base + '/t1_2/walkthrough')
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()['source'], 'solution')
        self.assertIn('знак минус', r.json()['steps'][0]['text'])
        self.generate.assert_not_called()

    async def test_missing_solution_returns_error_instead_of_a_typical_walkthrough(self):
        with patch.object(type(settings), 'llm_ready', new_callable=PropertyMock, return_value=False):
            r = await self.client.post(self.base + '/t1_2/walkthrough')
        self.assertEqual(r.status_code, 503)
        self.assertIn('этой задачи', r.json()['detail'])
        self.generate.assert_not_called()

    async def test_graph_coordinates_are_included_with_the_original_condition(self):
        self.items[1]['fig'] = 'tangent'
        r = await self.client.post(self.base + '/t1_2/walkthrough')
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()['condition_fig'], 'tangent')
        self.assertIn('(−1; 3) и (4; 2)', self.generate.call_args.args[0])


if __name__ == "__main__":
    unittest.main()
