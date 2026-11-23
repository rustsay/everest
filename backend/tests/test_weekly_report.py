"""Weekly summaries and in-app reminders remain available without email delivery."""
import unittest
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.api import report
from app.auth import mail


class WeeklyReportTests(unittest.IsolatedAsyncioTestCase):
    async def test_summary_only_returns_report_data_and_retired_settings_route_is_absent(self):
        app = FastAPI()
        app.include_router(report.router, prefix='/api')
        app.dependency_overrides[report.get_current_user] = lambda: SimpleNamespace(id=1)
        app.dependency_overrides[report.get_db] = lambda: None
        summary = {'active': 3, 'forecast': 18, 'lines': ['За неделю решено 5 задач.']}
        row = SimpleNamespace(data={'parent_email': 'old-setting@example.test'})
        with patch.object(report.service, 'get_state', AsyncMock(return_value=row)), \
                patch.object(report, '_week', AsyncMock(return_value=summary)):
            async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
                response = await client.get('/api/report/week')
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), summary)
                self.assertEqual((await client.put('/api/me/parent', json={'email': 'test@example.test'})).status_code, 404)

    async def test_active_student_gets_one_in_app_notification_per_week_and_no_email(self):
        class Monday(datetime):
            @classmethod
            def now(cls):
                return cls(2026, 11, 23, 10)

        row = SimpleNamespace(user_id=1, data={'parent_email': 'old-setting@example.test'})
        db = MagicMock()
        db.execute = AsyncMock(return_value=MagicMock())
        db.execute.return_value.scalars.return_value.all.return_value = [row]
        db.get = AsyncMock(return_value=SimpleNamespace(id=1, role='student', is_demo=False))
        db.commit = AsyncMock()
        context = MagicMock()
        context.__aenter__ = AsyncMock(return_value=db)
        context.__aexit__ = AsyncMock(return_value=False)
        with patch.object(report, 'datetime', Monday), \
                patch.object(report, 'AsyncSessionLocal', return_value=context), \
                patch.object(report, '_week', AsyncMock(return_value={'active': 3})), \
                patch.object(report.service, 'touch'), \
                patch.object(report.service, 'notify', AsyncMock()) as notify, \
                patch.object(mail, '_send_smtp') as send:
            self.assertEqual(await report.weekly_tick(), 1)
            self.assertEqual(await report.weekly_tick(), 0)
        notify.assert_awaited_once_with(db, 1, 'Итоги недели готовы: что сделано и что дальше', 'report')
        send.assert_not_called()

    async def test_teacher_report_still_returns_classes(self):
        db = AsyncMock()
        teacher = SimpleNamespace(id=1)
        with patch.object(report.crud, 'teacher_classes', AsyncMock(return_value=[])):
            result = await report.class_week(teacher=teacher, db=db)
        self.assertEqual(result['classes'], [])
        self.assertIn('from', result)
        self.assertIn('to', result)
