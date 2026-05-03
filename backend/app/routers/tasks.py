from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from ..crud import apply_patch, get_or_404
from ..database import get_db
from ..models import Category, Subtask, Task, TaskStatus
from ..schemas import SubtaskCreate, SubtaskOut, SubtaskUpdate, TaskCreate, TaskOut, TaskUpdate
from ..services.task_generation import spawn_recurring_task

log = logging.getLogger(__name__)

router = APIRouter(prefix="/tasks", tags=["tasks"])

_TASK_LOAD_OPTIONS = [joinedload(Task.assignee), joinedload(Task.category), joinedload(Task.subtasks)]


def _update_completed_at(obj: Task | Subtask, new_status: TaskStatus | None) -> None:
    """Set or clear completed_at based on the incoming status transition."""
    if new_status == TaskStatus.done and obj.completed_at is None:
        obj.completed_at = datetime.now(timezone.utc)
    elif new_status is not None and new_status != TaskStatus.done:
        obj.completed_at = None


def _get_subtask_or_404(db: Session, task_id: int, subtask_id: int) -> Subtask:
    subtask = db.query(Subtask).filter(
        Subtask.id == subtask_id, Subtask.task_id == task_id
    ).first()
    if not subtask:
        raise HTTPException(status_code=404, detail="Subtask not found")
    return subtask


def _load_task(db: Session, task_id: int) -> Task:
    task = (
        db.query(Task)
        .options(*_TASK_LOAD_OPTIONS)
        .filter(Task.id == task_id)
        .first()
    )
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


# ── Tasks ─────────────────────────────────────────────────────────────────────

@router.get("", response_model=list[TaskOut])
def list_tasks(
    status: TaskStatus | None = Query(None),
    assignee_id: int | None = Query(None),
    category_id: int | None = Query(None),
    occurrence_id: int | None = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
) -> list[Task]:
    q = (
        db.query(Task)
        .options(*_TASK_LOAD_OPTIONS)
        .order_by(Task.due_date.asc().nullslast(), Task.created_at)
    )
    if status:
        q = q.filter(Task.status == status)
    if assignee_id:
        q = q.filter(Task.assignee_id == assignee_id)
    if category_id:
        q = q.filter(Task.category_id == category_id)
    if occurrence_id:
        q = q.filter(Task.occurrence_id == occurrence_id)
    return q.offset(offset).limit(limit).all()


@router.post("", response_model=TaskOut, status_code=201)
def create_task(body: TaskCreate, db: Session = Depends(get_db)) -> Task:
    if body.category_id is not None:
        get_or_404(db, Category, body.category_id, "Category not found")
    task = Task(**body.model_dump())
    db.add(task)
    db.flush()
    task_id, task_title = task.id, task.title
    db.commit()
    log.info("Created task %d (%s)", task_id, task_title)
    return _load_task(db, task_id)


@router.get("/{task_id}", response_model=TaskOut)
def get_task(task_id: int, db: Session = Depends(get_db)) -> Task:
    return _load_task(db, task_id)


@router.patch("/{task_id}", response_model=TaskOut)
def update_task(task_id: int, body: TaskUpdate, db: Session = Depends(get_db)) -> Task:
    task = _load_task(db, task_id)
    changes = body.model_dump(exclude_unset=True)
    new_status = changes.get("status")
    apply_patch(task, changes)
    _update_completed_at(task, new_status)
    task_title, task_status = task.title, task.status
    # Spawn before commit so the status change and the new task are atomic.
    # Cancelling a recurring task should also advance the chain, not terminate it.
    if new_status in (TaskStatus.done, TaskStatus.cancelled):
        spawn_recurring_task(db, task)
    db.commit()
    db.refresh(task)
    log.info("Updated task %d (%s) → status=%s", task_id, task_title, task_status)
    return task


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: int, db: Session = Depends(get_db)) -> None:
    task = get_or_404(db, Task, task_id, "Task not found")
    log.info("Deleted task %d (%s)", task.id, task.title)
    db.delete(task)
    db.commit()


# ── Subtasks ──────────────────────────────────────────────────────────────────

@router.post("/{task_id}/subtasks", response_model=SubtaskOut, status_code=201)
def create_subtask(task_id: int, body: SubtaskCreate, db: Session = Depends(get_db)) -> Subtask:
    get_or_404(db, Task, task_id, "Task not found")
    subtask = Subtask(task_id=task_id, **body.model_dump())
    db.add(subtask)
    db.commit()
    db.refresh(subtask)
    return subtask


@router.patch("/{task_id}/subtasks/{subtask_id}", response_model=SubtaskOut)
def update_subtask(
    task_id: int, subtask_id: int, body: SubtaskUpdate, db: Session = Depends(get_db)
) -> Subtask:
    subtask = _get_subtask_or_404(db, task_id, subtask_id)
    update_data = body.model_dump(exclude_unset=True)
    new_status = update_data.get("status")
    _update_completed_at(subtask, new_status)
    apply_patch(subtask, update_data)
    db.commit()
    db.refresh(subtask)
    return subtask


@router.delete("/{task_id}/subtasks/{subtask_id}", status_code=204)
def delete_subtask(task_id: int, subtask_id: int, db: Session = Depends(get_db)) -> None:
    subtask = _get_subtask_or_404(db, task_id, subtask_id)
    db.delete(subtask)
    db.commit()
