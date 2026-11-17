import uuid
from datetime import datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    # profile (added in new-design; columns are added to old databases in init_db)
    name: Mapped[str | None] = mapped_column(String(80))
    role: Mapped[str] = mapped_column(String(20), default="student", server_default="student")  # student | teacher | tutor
    grade: Mapped[str | None] = mapped_column(String(4))   # "5".."11"
    exam: Mapped[str | None] = mapped_column(String(10))   # prof | base | oge | none
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    sessions: Mapped[list["Session"]] = relationship("Session", back_populates="user")


class GeneratedVideo(Base):
    __tablename__ = "generated_videos"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    problem: Mapped[str] = mapped_column(Text)
    title: Mapped[str] = mapped_column(String(200), default="Разбор задачи")
    status: Mapped[str] = mapped_column(String(20), default="pending")
    stage: Mapped[str] = mapped_column(String(250), default="В очереди")
    html: Mapped[str | None] = mapped_column(Text)
    steps: Mapped[list | None] = mapped_column(JSONB)
    error: Mapped[str | None] = mapped_column(Text)
    duration: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    user: Mapped[User] = relationship("User", back_populates="sessions")
    task_results: Mapped[list["TaskResult"]] = relationship(
        "TaskResult", back_populates="session"
    )
    trajectory: Mapped["Trajectory | None"] = relationship(
        "Trajectory", back_populates="session", uselist=False
    )


class TaskResult(Base):
    __tablename__ = "task_results"
    __table_args__ = (UniqueConstraint("session_id", "task_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id"), nullable=False
    )
    task_id: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    ocr_text: Mapped[str | None] = mapped_column(Text)
    ocr_confidence: Mapped[float | None] = mapped_column(Float)
    agent_verdicts: Mapped[dict | None] = mapped_column(JSONB)
    judge_decision: Mapped[dict | None] = mapped_column(JSONB)
    error: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    session: Mapped[Session] = relationship("Session", back_populates="task_results")


class Trajectory(Base):
    __tablename__ = "trajectories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id"), unique=True, nullable=False
    )
    data: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    session: Mapped[Session] = relationship("Session", back_populates="trajectory")


# ---------- learning (new-design) ----------

class LearnerState(Base):
    """Everything the learning model needs about one student, as one JSONB document:
    mastery, unknown topics, task observations, plan settings, stars, xp, care settings."""
    __tablename__ = "learner_states"

    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), primary_key=True)
    data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class Diagnostic(Base):
    """Entrance diagnostic or a mock exam. Answers are checked on the server."""
    __tablename__ = "diagnostics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    mode: Mapped[str] = mapped_column(String(10), nullable=False)  # first | mock
    exam_key: Mapped[str] = mapped_column(String(10), nullable=False)
    variant: Mapped[int] = mapped_column(Integer, default=0)
    answers: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    position: Mapped[int] = mapped_column(Integer, default=0)
    result: Mapped[dict | None] = mapped_column(JSONB)
    finished: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Measurement(Base):
    """One point of the "rises and falls" chart: forecast after a diagnostic, mock or photo check."""
    __tablename__ = "measurements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    value: Mapped[int] = mapped_column(Integer, nullable=False)
    source: Mapped[str] = mapped_column(String(80), nullable=False)
    mastery: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    unknown: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    text: Mapped[str] = mapped_column(String(300), nullable=False)
    go: Mapped[str | None] = mapped_column(String(30))
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)  # student | teacher
    role: Mapped[str] = mapped_column(String(10), nullable=False)  # user | assistant
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class ReviewChat(Base):
    __tablename__ = "review_chats"
    __table_args__ = (UniqueConstraint("user_id", "session_id", "task_id", "revision"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sessions.id"), index=True)
    task_id: Mapped[int] = mapped_column(Integer)
    revision: Mapped[str] = mapped_column(String(40))
    title: Mapped[str] = mapped_column(String(200))
    context: Mapped[dict] = mapped_column(JSONB)
    messages: Mapped[list] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class ClassGroup(Base):
    """A teacher's class or a tutor's group; students join by code."""
    __tablename__ = "class_groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    teacher_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    code: Mapped[str] = mapped_column(String(12), unique=True, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class ClassMember(Base):
    __tablename__ = "class_members"
    __table_args__ = (UniqueConstraint("class_id", "student_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    class_id: Mapped[int] = mapped_column(Integer, ForeignKey("class_groups.id"), nullable=False, index=True)
    student_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)


class Assignment(Base):
    """Homework from a teacher: shows up as a deadline for the class."""
    __tablename__ = "assignments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    teacher_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    class_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("class_groups.id"))
    topic: Mapped[str] = mapped_column(String(200), nullable=False)
    task_id: Mapped[int | None] = mapped_column(Integer)  # part-2 task to check by photo, if any
    count: Mapped[int] = mapped_column(Integer, default=5)
    due: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    done_by: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)  # student ids
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class TeacherReview(Base):
    """A teacher's final score for a checked task where the agents disagreed."""
    __tablename__ = "teacher_reviews"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    task_result_id: Mapped[int] = mapped_column(Integer, ForeignKey("task_results.id"), unique=True, nullable=False)
    teacher_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    score: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Textbook(Base):
    """A textbook from the teacher's library: conspects are built strictly from its text."""
    __tablename__ = "textbooks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    authors: Mapped[str] = mapped_column(String(200), default="")
    grade: Mapped[str] = mapped_column(String(10), default="")
    filename: Mapped[str | None] = mapped_column(String(255))
    text: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Material(Base):
    """Generated conspect or presentation."""
    __tablename__ = "materials"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)  # conspect | slides
    topic: Mapped[str] = mapped_column(String(200), nullable=False)
    textbook_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("textbooks.id"))
    section: Mapped[str] = mapped_column(String(80), default="")
    content: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class TaskFile(Base):
    """A file a teacher attached to a prototype on a task map (theory, problem sets)."""
    __tablename__ = "task_files"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    task_n: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    proto: Mapped[str] = mapped_column(String(40), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    path: Mapped[str] = mapped_column(String(300), nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class BankProblem(Base):
    """A problem of the task bank: imported from a file, checked by a teacher or methodist, then published."""
    __tablename__ = "bank_problems"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    task_n: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    proto: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    text: Mapped[str] = mapped_column(Text, nullable=False)
    answer: Mapped[str | None] = mapped_column(String(80))
    solution: Mapped[str] = mapped_column(Text, default="")
    source: Mapped[str] = mapped_column(String(300), default="")
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="draft", index=True)  # draft | approved
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class SkillExplanation(Base):
    """Cached explanation of a cross-cutting skill, written strictly from one textbook's text."""
    __tablename__ = "skill_explanations"
    __table_args__ = (UniqueConstraint("skill", "textbook_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    skill: Mapped[str] = mapped_column(String(10), nullable=False)
    textbook_id: Mapped[int] = mapped_column(Integer, ForeignKey("textbooks.id", ondelete="CASCADE"), nullable=False, index=True)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    pages: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Variant(Base):
    """A variant a teacher or tutor composed from the task bank; can be given to a class with a deadline."""
    __tablename__ = "variants"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    items: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)  # problem refs: "b12" (bank) or "s1:r2" (built-in)
    class_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("class_groups.id"), index=True)
    due: Mapped[datetime | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class VariantAttempt(Base):
    __tablename__ = "variant_attempts"
    __table_args__ = (UniqueConstraint("variant_id", "user_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    variant_id: Mapped[int] = mapped_column(Integer, ForeignKey("variants.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    answers: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    results: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)  # ref -> 0/1 for problems with a short answer
    score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class LearningPath(Base):
    """An educational trajectory for one student or for a whole class.
    status: draft (teacher works on it) | pending (student in a class asked, waits for the teacher) |
            active (in use) | archived | rejected."""
    __tablename__ = "learning_paths"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    class_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("class_groups.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="draft", index=True)
    data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    note: Mapped[str] = mapped_column(Text, nullable=False, default="")  # the teacher's comment
    approved_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    approved_at: Mapped[datetime | None] = mapped_column(DateTime)
