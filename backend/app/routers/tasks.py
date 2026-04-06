import calendar
import logging
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

log = logging.getLogger(__name__)

from ..database import get_db
from ..models import Category, Subtask, Task, TaskRecurrence, TaskStatus
from ..schemas import SubtaskCreate, SubtaskOut, SubtaskUpdate, TaskCreate, TaskOut, TaskUpdate

_RECURRENCE_DELTA = {
    TaskRecurrence.daily:      timedelta(days=1),
    TaskRecurrence.weekly:     timedelta(weeks=1),
    TaskRecurrence.biweekly:   timedelta(weeks=2),
    TaskRecurrence.monthly:    None,   # handled separately
    TaskRecurrence.quarterly:  None,   # handled separately
    TaskRecurrence.semiannual: None,   # handled separately
    TaskRecurrence.yearly:     None,   # handled separately
}


def _next_due(task: Task) -> Optional[date]:
    """Return the next due date for a recurring task, or None if one-time."""
    if task.recurrence == TaskRecurrence.none or not task.due_date:
        return None
    delta = _RECURRENCE_DELTA.get(task.recurrence)
    if delta:
        return task.due_date + delta
    today = task.due_date
    if task.recurrence in (TaskRecurrence.monthly, TaskRecurrence.quarterly, TaskRecurrence.semiannual):
        months = {TaskRecurrence.monthly: 1, TaskRecurrence.quarterly: 3, TaskRecurrence.semiannual: 6}[task.recurrence]
        month = today.month + months
        year = today.year + (month - 1) // 12
        month = ((month - 1) % 12) + 1
        day = min(today.day, calendar.monthrange(year, month)[1])
        return date(year, month, day)
    if task.recurrence == TaskRecurrence.yearly:
        year = today.year + 1
        day = min(today.day, calendar.monthrange(year, today.month)[1])
        return date(year, today.month, day)
    return None


def _spawn_next(db: Session, task: Task) -> None:
    """Create the next task instance for a recurring task."""
    next_date = _next_due(task)
    if not next_date:
        return
    already_exists = (
        db.query(Task)
        .filter(Task.title == task.title, Task.due_date == next_date, Task.recurrence == task.recurrence)
        .first()
    )
    if already_exists:
        log.debug("Skipping spawn for task %d — next instance (due %s) already exists as task %d", task.id, next_date, already_exists.id)
        return
    new_task = Task(
        title=task.title,
        description=task.description,
        priority=task.priority,
        assignee_id=task.assignee_id,
        category_id=task.category_id,
        due_date=next_date,
        estimated_minutes=task.estimated_minutes,
        recurrence=task.recurrence,
    )
    db.add(new_task)
    db.flush()
    for subtask in task.subtasks:
        db.add(Subtask(
            task_id=new_task.id,
            title=subtask.title,
            status=TaskStatus.todo,
            order=subtask.order,
        ))
    db.commit()

router = APIRouter(prefix="/tasks", tags=["tasks"])


# ── Tasks ─────────────────────────────────────────────────────────────────────

@router.get("", response_model=list[TaskOut])
def list_tasks(
    status: Optional[TaskStatus] = Query(None),
    assignee_id: Optional[int] = Query(None),
    category_id: Optional[int] = Query(None),
    occurrence_id: Optional[int] = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    q = (
        db.query(Task)
        .options(joinedload(Task.assignee), joinedload(Task.category), joinedload(Task.subtasks))
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
def create_task(body: TaskCreate, db: Session = Depends(get_db)):
    task = Task(**body.model_dump())
    db.add(task)
    db.commit()
    db.refresh(task)
    log.info("Created task %d (%s)", task.id, task.title)
    return db.query(Task).options(
        joinedload(Task.assignee), joinedload(Task.category), joinedload(Task.subtasks)
    ).filter(Task.id == task.id).first()


@router.get("/{task_id}", response_model=TaskOut)
def get_task(task_id: int, db: Session = Depends(get_db)):
    task = (
        db.query(Task)
        .options(joinedload(Task.assignee), joinedload(Task.category), joinedload(Task.subtasks))
        .filter(Task.id == task_id)
        .first()
    )
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.patch("/{task_id}", response_model=TaskOut)
def update_task(task_id: int, body: TaskUpdate, db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    changes = body.model_dump(exclude_unset=True)
    new_status = changes.get("status")
    for field, value in changes.items():
        setattr(task, field, value)
    db.commit()
    log.info("Updated task %d (%s) → status=%s", task_id, task.title, task.status)
    if new_status == TaskStatus.done:
        _spawn_next(db, task)
    return db.query(Task).options(
        joinedload(Task.assignee), joinedload(Task.category), joinedload(Task.subtasks)
    ).filter(Task.id == task_id).first()


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: int, db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    log.info("Deleted task %d (%s)", task.id, task.title)
    db.delete(task)
    db.commit()


# ── Subtasks ──────────────────────────────────────────────────────────────────

@router.post("/{task_id}/subtasks", response_model=SubtaskOut, status_code=201)
def create_subtask(task_id: int, body: SubtaskCreate, db: Session = Depends(get_db)):
    if not db.get(Task, task_id):
        raise HTTPException(status_code=404, detail="Task not found")
    subtask = Subtask(task_id=task_id, **body.model_dump())
    db.add(subtask)
    db.commit()
    db.refresh(subtask)
    return subtask


@router.patch("/{task_id}/subtasks/{subtask_id}", response_model=SubtaskOut)
def update_subtask(
    task_id: int, subtask_id: int, body: SubtaskUpdate, db: Session = Depends(get_db)
):
    subtask = db.query(Subtask).filter(
        Subtask.id == subtask_id, Subtask.task_id == task_id
    ).first()
    if not subtask:
        raise HTTPException(status_code=404, detail="Subtask not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(subtask, field, value)
    db.commit()
    db.refresh(subtask)
    return subtask


@router.delete("/{task_id}/subtasks/{subtask_id}", status_code=204)
def delete_subtask(task_id: int, subtask_id: int, db: Session = Depends(get_db)):
    subtask = db.query(Subtask).filter(
        Subtask.id == subtask_id, Subtask.task_id == task_id
    ).first()
    if not subtask:
        raise HTTPException(status_code=404, detail="Subtask not found")
    db.delete(subtask)
    db.commit()
