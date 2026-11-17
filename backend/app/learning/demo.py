"""«Посмотреть пример»: a demo student. Only the diagnostic answers are preset;
mastery, forecast, root cause and schedule are computed by the usual model."""
from __future__ import annotations

import secrets
from datetime import date, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.service import hash_password
from app.db.models import Diagnostic, Measurement, User
from app.learning import engine, service

RIGHT_TASKS = {1, 2, 3, 4, 6, 9, 10, 11}
SELF = {"s13": "part", "s14": "none", "s15": "part", "s16": "full", "s17": "none", "s18": "none", "s19": "part"}


async def create_demo_user(db: AsyncSession) -> User:
    user = User(email=f"demo-{secrets.token_hex(4)}@everest.local", password_hash=hash_password(secrets.token_hex(16)),
                name="Алина", role="student", grade="11", exam="prof", is_demo=True)
    db.add(user)
    await db.flush()
    items = engine.diag_items("prof", "11", 0, date.today())
    answers = {it["id"]: (it["a"] if it["n"] in RIGHT_TASKS else "?") for it in items if it["t"] == "num"}
    answers.update(SELF)
    row = await service.get_state(db, user.id)
    engine.apply_diag(row.data, items, answers, blend=False)
    row.data.update({"xp": 4120, "onb": "new"})
    for i in range(10):
        row.data["active_days"].append((date.today() - timedelta(days=i)).isoformat())
    value = engine.forecast_value(engine.build_model(row.data, "prof"), "prof")
    # earlier points of the chart are an example and are labelled so
    for weeks, delta in ((5, -5), (4, -3), (3, -4), (2, -1), (1, -2)):
        db.add(Measurement(user_id=user.id, value=max(0, value + delta), source="пример", mastery=dict(row.data["mastery"]),
                           unknown=list(row.data["unknown"]), created_at=datetime.utcnow() - timedelta(weeks=weeks)))
    await service.add_measurement(db, user, row, "диагностика")
    db.add(Diagnostic(user_id=user.id, mode="first", exam_key="prof", variant=0, answers=answers, finished=True,
                      result={"demo": True}, position=len(items)))
    await service.notify(db, user.id, "Это пример: ответы диагностики заданы, остальное посчитано моделью", "home")
    service.touch(row)
    await db.commit()
    await db.refresh(user)
    return user
