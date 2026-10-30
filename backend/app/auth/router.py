from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.service import create_token, hash_password, verify_password
from app.db.crud import create_user, get_user_by_email
from app.db.database import get_db

router = APIRouter(prefix="/auth", tags=["auth"])


class AuthRequest(BaseModel):
    email: EmailStr
    password: str


class AuthResponse(BaseModel):
    token: str
    email: str


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def register(body: AuthRequest, db: AsyncSession = Depends(get_db)):
    if await get_user_by_email(db, body.email):
        raise HTTPException(status.HTTP_409_CONFLICT, "Email уже зарегистрирован")
    if len(body.password) < 6:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Минимум 6 символов")
    user = await create_user(db, body.email, hash_password(body.password))
    return AuthResponse(token=create_token(user.id), email=user.email)


@router.post("/login", response_model=AuthResponse)
async def login(body: AuthRequest, db: AsyncSession = Depends(get_db)):
    user = await get_user_by_email(db, body.email)
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверный email или пароль")
    return AuthResponse(token=create_token(user.id), email=user.email)
