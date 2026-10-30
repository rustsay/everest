from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.service import decode_token
from app.db.crud import get_user_by_email
from app.db.database import get_db
from app.db.models import User

_bearer = HTTPBearer()


async def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    try:
        user_id = decode_token(creds.credentials)
    except ValueError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверный токен")

    result = await db.get(User, user_id)
    if result is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Пользователь не найден")
    return result
