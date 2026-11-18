from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import mail
from app.auth.service import create_token, hash_password, verify_password
from app.config import settings
from app.db.crud import create_user, get_user_by_email
from app.db.database import get_db

router = APIRouter(prefix="/auth", tags=["auth"])


class AuthRequest(BaseModel):
    email: EmailStr
    password: str


class RegisterRequest(AuthRequest):
    # profile from the onboarding steps (optional: old clients send only email + password)
    name: str | None = Field(None, max_length=80)
    role: str = "student"
    grade: str | None = None
    exam: str | None = None
    code: str | None = Field(None, max_length=10)  # from the email (needed when EMAIL_CONFIRM is on)


class CodeRequest(BaseModel):
    email: EmailStr
    purpose: str = Field("register", pattern="^(register|reset)$")


class ResetRequest(BaseModel):
    email: EmailStr
    code: str = Field(..., max_length=10)
    password: str


def _email(e: str) -> str:
    return e.strip().lower()


class AuthResponse(BaseModel):
    token: str
    email: str
    name: str | None = None
    role: str = "student"


@router.get("/config")
async def auth_config():
    """The client asks for the code step only when it is on."""
    return {"email_confirm": settings.email_confirm}


@router.post("/code")
async def send_code(body: CodeRequest, db: AsyncSession = Depends(get_db)):
    email = _email(body.email)
    exists = await get_user_by_email(db, email) is not None
    if body.purpose == "register" and exists:
        raise HTTPException(status.HTTP_409_CONFLICT, "Эта почта уже зарегистрирована. Войдите или восстановите пароль")
    if body.purpose == "reset" and not exists:
        return {"sent": True}  # the same answer: nobody learns which emails are registered
    await mail.send_code(db, email, body.purpose)
    return {"sent": True}


@router.post("/reset", response_model=AuthResponse)
async def reset_password(body: ResetRequest, db: AsyncSession = Depends(get_db)):
    email = _email(body.email)
    if len(body.password) < 6:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Минимум 6 символов")
    user = await get_user_by_email(db, email)
    if user is None or user.is_demo:
        raise HTTPException(400, "Код устарел или не запрашивался. Запросите новый")
    await mail.check_code(db, email, "reset", body.code)
    user.password_hash = hash_password(body.password)
    await db.commit()
    return AuthResponse(token=create_token(user.id), email=user.email, name=user.name, role=user.role or "student")


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    body.email = _email(body.email)
    if await get_user_by_email(db, body.email):
        raise HTTPException(status.HTTP_409_CONFLICT, "Email уже зарегистрирован")
    if len(body.password) < 6:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Минимум 6 символов")
    if body.role not in ("student", "teacher", "tutor"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Роль: student, teacher или tutor")
    if body.grade is not None and body.grade not in {"5", "6", "7", "8", "9", "10", "11"}:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Класс от 5 до 11")
    if settings.email_confirm:
        if not body.code:
            raise HTTPException(400, "Нужен код из письма")
        await mail.check_code(db, body.email, "register", body.code)
    user = await create_user(db, body.email, hash_password(body.password))
    user.name = (body.name or "").strip()[:80] or None
    user.role = body.role
    user.grade = body.grade if body.role == "student" else None
    user.exam = body.exam if body.role == "student" else None
    await db.commit()
    return AuthResponse(token=create_token(user.id), email=user.email, name=user.name, role=user.role)


@router.post("/login", response_model=AuthResponse)
async def login(body: AuthRequest, db: AsyncSession = Depends(get_db)):
    user = await get_user_by_email(db, _email(body.email))
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверный email или пароль")
    return AuthResponse(token=create_token(user.id), email=user.email, name=user.name, role=user.role or "student")


@router.post("/demo", response_model=AuthResponse)
async def demo(db: AsyncSession = Depends(get_db)):
    """«Посмотреть пример»: a throwaway student with preset diagnostic answers.
    Everything else (forecast, root cause, schedule) is computed by the same model."""
    from app.learning.demo import create_demo_user
    user = await create_demo_user(db)
    return AuthResponse(token=create_token(user.id), email=user.email, name=user.name, role=user.role)
