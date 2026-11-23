"""Bank photo uploads keep the selected problem and the existing profile grading pipeline."""
import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, PropertyMock, patch

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.api import diag_work, router as api
from app.config import settings
from app.learning import problems
from app.models.schemas import JudgeDecision


class BankPhotoUploadTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.user = SimpleNamespace(id=1, role='student', grade='11', exam='prof')
        self.problem = {'ref': 'b42', 'task': 13, 'exam': 'prof', 'q': 'Решите уравнение sin(x) = 0.'}
        app = FastAPI()
        app.include_router(api.router, prefix='/api')
        app.dependency_overrides[api.get_current_user] = lambda: self.user
        app.dependency_overrides[api.get_db] = lambda: None
        self.client = AsyncClient(transport=ASGITransport(app=app), base_url='http://test')
        self.patches = [
            patch.object(type(settings), 'llm_ready', new_callable=PropertyMock, return_value=True),
            patch.object(api, 'get_session', AsyncMock(return_value=SimpleNamespace(user_id=1))),
            patch.object(api, 'save_scan', AsyncMock()),
            patch.object(api, 'upsert_task_result', AsyncMock()),
            patch.object(api, '_process_task', AsyncMock()),
            patch.object(problems, 'resolve', AsyncMock(return_value={'b42': self.problem})),
        ]
        for p in self.patches:
            p.start()

    async def asyncTearDown(self):
        await self.client.aclose()
        for p in reversed(self.patches):
            p.stop()

    async def upload(self, ref=None):
        return await self.client.post('/api/sessions/test-session/tasks/13/upload',
                                      data={'ref': ref} if ref else {}, files={'files': ('solution.jpg', b'photo', 'image/jpeg')})

    async def test_selected_bank_problem_reaches_background_check(self):
        response = await self.upload('b42')
        self.assertEqual(response.status_code, 200, response.text)
        await asyncio.sleep(0)
        api._process_task.assert_awaited_once_with('test-session', 13, [(b'photo', 'solution.jpg')], problem=self.problem)

    async def test_regular_session_upload_still_works_without_a_bank_reference(self):
        response = await self.upload()
        self.assertEqual(response.status_code, 200, response.text)
        await asyncio.sleep(0)
        api._process_task.assert_awaited_once_with('test-session', 13, [(b'photo', 'solution.jpg')], problem=None)
        problems.resolve.assert_not_awaited()

    async def test_unknown_problem_wrong_task_and_wrong_exam_are_rejected_before_upload(self):
        for resolved, status in (({}, 404), ({'b42': {**self.problem, 'task': 14}}, 400),
                                 ({'b42': {**self.problem, 'exam': 'oge'}}, 400)):
            with self.subTest(resolved=resolved):
                problems.resolve.return_value = resolved
                response = await self.upload('b42')
                self.assertEqual(response.status_code, status, response.text)
        api.save_scan.assert_not_awaited()
        api._process_task.assert_not_awaited()

    async def test_other_users_session_cannot_be_used(self):
        api.get_session.return_value = SimpleNamespace(user_id=2)
        response = await self.upload('b42')
        self.assertEqual(response.status_code, 403)
        problems.resolve.assert_not_awaited()
        api.save_scan.assert_not_awaited()


class BankPhotoGradingTests(unittest.IsolatedAsyncioTestCase):
    async def test_experts_receive_the_exact_problem_and_its_picture(self):
        db = MagicMock()
        context = MagicMock()
        context.__aenter__ = AsyncMock(return_value=db)
        context.__aexit__ = AsyncMock(return_value=False)
        judge = JudgeDecision(final_score=2, max_score=2, reasoning='Верно', consensus_level='full', agent_scores=[2, 2, 2])
        with patch.object(api, 'AsyncSessionLocal', return_value=context), \
                patch.object(api, 'run_ocr', return_value={'text': 'Решение ученика', 'confidence': 1.0, 'low_confidence': False}), \
                patch.object(api, 'get_scan_jpegs', return_value=[b'solution']), \
                patch.object(api, 'upsert_task_result', AsyncMock()) as save, \
                patch.object(api, 'get_session', AsyncMock(return_value=None)), \
                patch.object(api._ws, 'broadcast', AsyncMock()), \
                patch.object(diag_work, '_problem_image', return_value=b'condition'), \
                patch.object(api, 'check_task', AsyncMock(return_value=([], judge))) as grade:
            await api._process_task('test-session', 13, [], problem={'q': 'Решите sin(x) = 0.'})
        self.assertEqual(grade.await_args.kwargs['problem'], 'Решите sin(x) = 0.')
        self.assertEqual(grade.await_args.kwargs['problem_image'], b'condition')
        self.assertEqual(grade.await_args.kwargs['image_bytes_list'], [b'solution'])
        self.assertEqual(save.await_args.args[2].judge_decision.final_score, 2)
