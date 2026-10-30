from pydantic import BaseModel
from typing import Optional
from enum import Enum


class TaskStatus(str, Enum):
    pending = "pending"
    ocr = "ocr"
    checking = "checking"
    done = "done"
    error = "error"


class AgentVerdict(BaseModel):
    agent_id: int
    score: int
    max_score: int
    reasoning: str
    errors_found: list[str]
    correct_steps: list[str]
    confidence: float


class JudgeDecision(BaseModel):
    final_score: int
    max_score: int
    reasoning: str
    consensus_level: str  # "full" | "majority" | "judge_decision"
    agent_scores: list[int]


class TaskResult(BaseModel):
    task_id: int
    status: TaskStatus
    ocr_text: Optional[str] = None
    ocr_confidence: Optional[float] = None
    agent_verdicts: Optional[list[AgentVerdict]] = None
    judge_decision: Optional[JudgeDecision] = None
    error: Optional[str] = None


class SessionResult(BaseModel):
    session_id: str
    tasks: dict[int, TaskResult]
    total_score: Optional[int] = None
    max_total: int = 20
