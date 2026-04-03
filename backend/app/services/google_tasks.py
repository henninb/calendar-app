"""
Google Tasks API wrapper — one-way push.

Reuses the OAuth credentials managed by google_calendar.py.
Note: if the user authenticated before the tasks scope was added,
they will need to re-authenticate via GET /api/sync/auth.
"""
from __future__ import annotations

from datetime import datetime

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from sqlalchemy.orm import Session

from ..models import Subtask, Task, TaskStatus
from .google_calendar import get_credentials

_TASKLIST_TITLE = "Calendar App Tasks"

_STATUS_MAP = {
    TaskStatus.todo: "needsAction",
    TaskStatus.in_progress: "needsAction",
    TaskStatus.done: "completed",
    TaskStatus.cancelled: "needsAction",
}


def _service():
    creds = get_credentials()
    if not creds:
        raise RuntimeError("Not authenticated with Google — visit /api/sync/auth")
    return build("tasks", "v1", credentials=creds)


def _get_or_create_tasklist(svc) -> str:
    """Return the ID of our app task list, creating it if absent."""
    for tl in svc.tasklists().list().execute().get("items", []):
        if tl["title"] == _TASKLIST_TITLE:
            return tl["id"]
    return svc.tasklists().insert(body={"title": _TASKLIST_TITLE}).execute()["id"]


def _sync_subtask(svc, tasklist_id: str, subtask: Subtask, parent_gtask_id: str) -> None:
    """Push a single subtask to Google Tasks as a child of parent_gtask_id."""
    body: dict = {
        "title": subtask.title,
        "status": _STATUS_MAP.get(subtask.status, "needsAction"),
    }
    if subtask.gtask_id:
        try:
            svc.tasks().update(
                tasklist=tasklist_id,
                task=subtask.gtask_id,
                body={**body, "id": subtask.gtask_id},
            ).execute()
            return
        except HttpError as e:
            if e.resp.status != 404:
                raise
    result = svc.tasks().insert(
        tasklist=tasklist_id, parent=parent_gtask_id, body=body
    ).execute()
    subtask.gtask_id = result["id"]


def get_or_create_tasklist() -> tuple[object, str]:
    """Return (svc, tasklist_id), creating the task list if absent. Call once before threading."""
    svc = _service()
    return svc, _get_or_create_tasklist(svc)


def sync_task(db: Session, task: Task, svc=None, tasklist_id: str = None) -> str:
    """Push a single task (and its subtasks) to Google Tasks. Returns 'inserted' or 'updated'."""
    if svc is None:
        svc = _service()
    if tasklist_id is None:
        tasklist_id = _get_or_create_tasklist(svc)

    body: dict = {
        "title": task.title,
        "notes": task.description or "",
        "status": _STATUS_MAP.get(task.status, "needsAction"),
    }
    if task.due_date:
        body["due"] = f"{task.due_date.isoformat()}T00:00:00.000Z"

    try:
        if task.gtask_id:
            try:
                svc.tasks().update(
                    tasklist=tasklist_id, task=task.gtask_id, body={**body, "id": task.gtask_id}
                ).execute()
                task.synced_at = datetime.utcnow()
                action = "updated"
            except HttpError as e:
                if e.resp.status != 404:
                    raise
                task.gtask_id = None
                action = None
        else:
            action = None

        if action is None:
            result = svc.tasks().insert(tasklist=tasklist_id, body=body).execute()
            task.gtask_id = result["id"]
            task.synced_at = datetime.utcnow()
            action = "inserted"

        for subtask in sorted(task.subtasks, key=lambda s: s.order):
            _sync_subtask(svc, tasklist_id, subtask, task.gtask_id)

        db.commit()
        return action
    except HttpError as e:
        raise RuntimeError(f"Google Tasks API error: {e}") from e


def sync_all_tasks(db: Session) -> dict:
    """Push all non-cancelled tasks to Google Tasks. Returns summary dict."""
    tasks = db.query(Task).filter(Task.status != TaskStatus.cancelled).all()
    synced, failed, errors = 0, 0, []
    for task in tasks:
        try:
            sync_task(db, task)
            synced += 1
        except Exception as exc:
            failed += 1
            errors.append(f"task {task.id}: {exc}")
    return {"synced": synced, "failed": failed, "errors": errors}
