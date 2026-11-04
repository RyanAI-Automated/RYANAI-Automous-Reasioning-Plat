"""Permission-aware interfaces for RyanAI communications orchestration.

This module defines contracts only. Concrete persistence adapters and provider
dispatchers must be supplied separately; this package never sends messages.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Protocol, runtime_checkable

CHANNELS = frozenset({"whatsapp", "sms", "voice", "email"})
ACTIONS = frozenset({"analyse", "draft"})


@dataclass(frozen=True)
class OrchestrationRequest:
    task_id: str
    owner_id: str
    idempotency_key: str
    channel: str
    action: str
    payload: Mapping[str, str]
    approved: bool = False


@dataclass(frozen=True)
class TaskReceipt:
    task_id: str
    status: str
    detail: str


@runtime_checkable
class TaskStore(Protocol):
    """Durable adapter contract. create_pending must be idempotent."""

    def create_pending(self, request: OrchestrationRequest) -> str: ...
    def claim(self, task_id: str, worker_id: str) -> bool: ...
    def mark_completed(self, task_id: str, result: str) -> None: ...
    def mark_failed(self, task_id: str, reason: str) -> None: ...


@runtime_checkable
class CommunicationsAgent(Protocol):
    """An analysis/draft-only agent; no provider credentials or dispatch method."""

    def execute(self, action: str, channel: str, payload: Mapping[str, str]) -> str: ...


class CommunicationsOrchestrator:
    """Persist first; execute only approved, claimed, non-dispatch work."""

    def __init__(self, store: TaskStore, agent: CommunicationsAgent, worker_id: str):
        if not worker_id.strip():
            raise ValueError("worker_id is required")
        self._store = store
        self._agent = agent
        self._worker_id = worker_id

    def submit(self, request: OrchestrationRequest) -> TaskReceipt:
        self._validate(request)
        persisted_id = self._store.create_pending(request)
        if persisted_id != request.task_id:
            raise RuntimeError("Task store returned an unexpected task identifier")
        if not request.approved:
            return TaskReceipt(request.task_id, "pending_approval", "Persisted; no agent execution occurred.")
        if not self._store.claim(request.task_id, self._worker_id):
            return TaskReceipt(request.task_id, "already_claimed", "No execution occurred.")
        try:
            result = self._agent.execute(request.action, request.channel, request.payload)
            self._store.mark_completed(request.task_id, result)
            return TaskReceipt(request.task_id, "completed", result)
        except Exception as error:
            self._store.mark_failed(request.task_id, type(error).__name__)
            raise

    @staticmethod
    def _validate(request: OrchestrationRequest) -> None:
        if not request.task_id.strip() or not request.owner_id.strip() or not request.idempotency_key.strip():
            raise ValueError("task_id, owner_id and idempotency_key are required")
        if request.channel not in CHANNELS:
            raise ValueError("Unsupported communications channel")
        if request.action not in ACTIONS:
            raise ValueError("Only analyse and draft actions are supported")
        if not request.payload or not all(
            isinstance(key, str) and isinstance(value, str)
            for key, value in request.payload.items()
        ):
            raise ValueError("payload must be a non-empty string-to-string mapping")
