"""Tests for app/services/google_tasks.py"""
from __future__ import annotations

import json
from datetime import date
from unittest.mock import MagicMock, Mock, patch

import pytest
from googleapiclient.errors import HttpError

from app.services.google_tasks import (
    _get_or_create_tasklist,
    _sync_subtask,
    get_or_create_tasklist,
    sync_task,
    _TASKLIST_TITLE,
    _STATUS_MAP,
)
from app.models import TaskStatus


# ── Helpers ───────────────────────────────────────────────────────────────────

def _http_error(status: int, reason: str = "") -> HttpError:
    resp = Mock()
    resp.status = status
    resp.reason = reason  # str(HttpError) uses resp.reason for the retryable-reason check
    content = json.dumps({"error": {"errors": [{"reason": reason}]}}).encode()
    return HttpError(resp, content)


def _make_task(*, gtask_id=None, status=TaskStatus.todo, due_date=None, subtasks=None):
    task = MagicMock()
    task.id = 1
    task.title = "My Task"
    task.description = "desc"
    task.status = status
    task.gtask_id = gtask_id
    task.due_date = due_date
    task.synced_at = None
    task.subtasks = subtasks or []
    return task


def _make_subtask(*, gtask_id=None, status=TaskStatus.todo, order=0):
    sub = MagicMock()
    sub.id = 10
    sub.title = "Sub"
    sub.status = status
    sub.gtask_id = gtask_id
    sub.order = order
    return sub


# ── _get_or_create_tasklist ───────────────────────────────────────────────────

def test_get_or_create_tasklist_finds_existing():
    svc = MagicMock()
    with patch("app.services.google_tasks._execute") as mock_exec:
        mock_exec.return_value = {"items": [{"id": "tl_123", "title": _TASKLIST_TITLE}]}
        result = _get_or_create_tasklist(svc)
    assert result == "tl_123"
    svc.tasklists.return_value.insert.assert_not_called()


def test_get_or_create_tasklist_creates_when_absent():
    svc = MagicMock()
    call_count = [0]
    def mock_exec(request):
        call_count[0] += 1
        if call_count[0] == 1:
            return {"items": [{"id": "other", "title": "Other List"}]}
        return {"id": "new_tl"}
    with patch("app.services.google_tasks._execute", side_effect=mock_exec):
        result = _get_or_create_tasklist(svc)
    assert result == "new_tl"


def test_get_or_create_tasklist_creates_when_list_is_empty():
    svc = MagicMock()
    call_count = [0]
    def mock_exec(request):
        call_count[0] += 1
        if call_count[0] == 1:
            return {"items": []}
        return {"id": "created_tl"}
    with patch("app.services.google_tasks._execute", side_effect=mock_exec):
        result = _get_or_create_tasklist(svc)
    assert result == "created_tl"


def test_get_or_create_tasklist_skips_non_matching_titles():
    svc = MagicMock()
    call_count = [0]
    def mock_exec(request):
        call_count[0] += 1
        if call_count[0] == 1:
            return {"items": [
                {"id": "x1", "title": "Shopping"},
                {"id": "x2", "title": "Work"},
            ]}
        return {"id": "app_tl"}
    with patch("app.services.google_tasks._execute", side_effect=mock_exec):
        result = _get_or_create_tasklist(svc)
    assert result == "app_tl"


# ── _sync_subtask ─────────────────────────────────────────────────────────────

def test_sync_subtask_updates_existing_subtask():
    svc = MagicMock()
    sub = _make_subtask(gtask_id="sub_id_123")
    with patch("app.services.google_tasks._execute") as mock_exec:
        mock_exec.return_value = {"id": "sub_id_123"}
        _sync_subtask(svc, "tl_id", sub, "parent_id")
    mock_exec.assert_called_once()
    assert sub.gtask_id == "sub_id_123"


def test_sync_subtask_inserts_when_update_returns_404():
    svc = MagicMock()
    sub = _make_subtask(gtask_id="old_sub_id")
    call_count = [0]
    def mock_exec(request):
        call_count[0] += 1
        if call_count[0] == 1:
            raise _http_error(404)
        return {"id": "new_sub_id"}
    with patch("app.services.google_tasks._execute", side_effect=mock_exec):
        _sync_subtask(svc, "tl_id", sub, "parent_id")
    assert sub.gtask_id == "new_sub_id"


def test_sync_subtask_raises_on_non_404_update_error():
    svc = MagicMock()
    sub = _make_subtask(gtask_id="sub_id")
    with patch("app.services.google_tasks._execute", side_effect=_http_error(500)):
        with pytest.raises(HttpError):
            _sync_subtask(svc, "tl_id", sub, "parent_id")


def test_sync_subtask_inserts_new_subtask_when_no_gtask_id():
    svc = MagicMock()
    sub = _make_subtask(gtask_id=None)
    with patch("app.services.google_tasks._execute") as mock_exec:
        mock_exec.return_value = {"id": "fresh_sub_id"}
        _sync_subtask(svc, "tl_id", sub, "parent_id")
    assert sub.gtask_id == "fresh_sub_id"


def test_sync_subtask_maps_done_status_to_completed():
    svc = MagicMock()
    sub = _make_subtask(gtask_id=None, status=TaskStatus.done)
    with patch("app.services.google_tasks._execute") as mock_exec:
        mock_exec.return_value = {"id": "sub_id"}
        _sync_subtask(svc, "tl_id", sub, "parent_id")
    insert_call = svc.tasks.return_value.insert.call_args
    assert insert_call is not None
    assert insert_call[1]["body"]["status"] == "completed"


def test_sync_subtask_passes_parent_id_on_insert():
    svc = MagicMock()
    sub = _make_subtask(gtask_id=None)
    with patch("app.services.google_tasks._execute") as mock_exec:
        mock_exec.return_value = {"id": "sub_id"}
        _sync_subtask(svc, "tl_id", sub, "parent_task_id")
    insert_call = svc.tasks.return_value.insert.call_args
    assert insert_call[1]["parent"] == "parent_task_id"


# ── get_or_create_tasklist (public) ──────────────────────────────────────────

def test_get_or_create_tasklist_public_returns_svc_and_id():
    creds = MagicMock()
    svc = MagicMock()
    with patch("app.services.google_tasks.get_credentials", return_value=creds), \
         patch("app.services.google_tasks.build", return_value=svc), \
         patch("app.services.google_tasks._get_or_create_tasklist", return_value="tl_42"):
        returned_svc, returned_id = get_or_create_tasklist()
    assert returned_svc is svc
    assert returned_id == "tl_42"


def test_get_or_create_tasklist_raises_when_not_authenticated():
    with patch("app.services.google_tasks.get_credentials", return_value=None):
        with pytest.raises(RuntimeError, match="Not authenticated"):
            get_or_create_tasklist()


# ── sync_task ─────────────────────────────────────────────────────────────────

def test_sync_task_inserts_new_task():
    db = MagicMock()
    task = _make_task(gtask_id=None)
    svc = MagicMock()
    with patch("app.services.google_tasks._execute") as mock_exec:
        mock_exec.return_value = {"id": "new_gtask_id"}
        result = sync_task(db, task, svc=svc, tasklist_id="tl_id")
    assert result == "inserted"
    assert task.gtask_id == "new_gtask_id"
    db.commit.assert_called_once()


def test_sync_task_updates_existing_task():
    db = MagicMock()
    task = _make_task(gtask_id="existing_gtask")
    svc = MagicMock()
    with patch("app.services.google_tasks._execute") as mock_exec:
        mock_exec.return_value = {"id": "existing_gtask"}
        result = sync_task(db, task, svc=svc, tasklist_id="tl_id")
    assert result == "updated"
    db.commit.assert_called_once()


def test_sync_task_inserts_after_404_on_update():
    db = MagicMock()
    task = _make_task(gtask_id="stale_id")
    svc = MagicMock()
    call_count = [0]
    def mock_exec(request):
        call_count[0] += 1
        if call_count[0] == 1:
            raise _http_error(404)
        return {"id": "new_id"}
    with patch("app.services.google_tasks._execute", side_effect=mock_exec):
        result = sync_task(db, task, svc=svc, tasklist_id="tl_id")
    assert result == "inserted"
    assert task.gtask_id == "new_id"


def test_sync_task_raises_runtime_error_on_http_error():
    db = MagicMock()
    task = _make_task(gtask_id=None)
    svc = MagicMock()
    with patch("app.services.google_tasks._execute", side_effect=_http_error(500)):
        with pytest.raises(RuntimeError, match="Google Tasks API error"):
            sync_task(db, task, svc=svc, tasklist_id="tl_id")


def test_sync_task_raises_runtime_error_on_non_404_update_error():
    db = MagicMock()
    task = _make_task(gtask_id="existing")
    svc = MagicMock()
    with patch("app.services.google_tasks._execute", side_effect=_http_error(403)):
        with pytest.raises(RuntimeError, match="Google Tasks API error"):
            sync_task(db, task, svc=svc, tasklist_id="tl_id")


def test_sync_task_includes_due_date_in_body():
    db = MagicMock()
    task = _make_task(gtask_id=None, due_date=date(2026, 6, 15))
    svc = MagicMock()
    with patch("app.services.google_tasks._execute") as mock_exec:
        mock_exec.return_value = {"id": "gtask_id"}
        sync_task(db, task, svc=svc, tasklist_id="tl_id")
    insert_call = svc.tasks.return_value.insert.call_args
    body = insert_call[1]["body"]
    assert "due" in body
    assert "2026-06-15" in body["due"]


def test_sync_task_omits_due_when_none():
    db = MagicMock()
    task = _make_task(gtask_id=None, due_date=None)
    svc = MagicMock()
    with patch("app.services.google_tasks._execute") as mock_exec:
        mock_exec.return_value = {"id": "gtask_id"}
        sync_task(db, task, svc=svc, tasklist_id="tl_id")
    insert_call = svc.tasks.return_value.insert.call_args
    body = insert_call[1]["body"]
    assert "due" not in body


def test_sync_task_syncs_subtasks_in_order():
    db = MagicMock()
    sub1 = _make_subtask(order=0)
    sub2 = _make_subtask(order=1)
    task = _make_task(gtask_id=None, subtasks=[sub2, sub1])  # intentionally reversed
    svc = MagicMock()
    with patch("app.services.google_tasks._execute") as mock_exec, \
         patch("app.services.google_tasks._sync_subtask") as mock_sync_sub:
        mock_exec.return_value = {"id": "parent_id"}
        sync_task(db, task, svc=svc, tasklist_id="tl_id")
    assert mock_sync_sub.call_count == 2
    first_sub = mock_sync_sub.call_args_list[0][0][2]
    second_sub = mock_sync_sub.call_args_list[1][0][2]
    assert first_sub.order == 0
    assert second_sub.order == 1


def test_sync_task_creates_svc_and_tasklist_automatically():
    db = MagicMock()
    task = _make_task(gtask_id=None)
    creds = MagicMock()
    svc = MagicMock()
    with patch("app.services.google_tasks.get_credentials", return_value=creds), \
         patch("app.services.google_tasks.build", return_value=svc), \
         patch("app.services.google_tasks._get_or_create_tasklist", return_value="auto_tl"), \
         patch("app.services.google_tasks._execute") as mock_exec:
        mock_exec.return_value = {"id": "new_id"}
        result = sync_task(db, task)
    assert result == "inserted"


def test_sync_task_sets_synced_at_on_insert():
    db = MagicMock()
    task = _make_task(gtask_id=None)
    svc = MagicMock()
    with patch("app.services.google_tasks._execute") as mock_exec:
        mock_exec.return_value = {"id": "new_id"}
        sync_task(db, task, svc=svc, tasklist_id="tl_id")
    assert task.synced_at is not None


def test_sync_task_sets_synced_at_on_update():
    db = MagicMock()
    task = _make_task(gtask_id="existing")
    svc = MagicMock()
    with patch("app.services.google_tasks._execute") as mock_exec:
        mock_exec.return_value = {"id": "existing"}
        sync_task(db, task, svc=svc, tasklist_id="tl_id")
    assert task.synced_at is not None


def test_sync_task_maps_done_status_to_completed():
    db = MagicMock()
    task = _make_task(gtask_id=None, status=TaskStatus.done)
    svc = MagicMock()
    with patch("app.services.google_tasks._execute") as mock_exec:
        mock_exec.return_value = {"id": "gtask_id"}
        sync_task(db, task, svc=svc, tasklist_id="tl_id")
    insert_call = svc.tasks.return_value.insert.call_args
    assert insert_call[1]["body"]["status"] == "completed"


# ── _STATUS_MAP ───────────────────────────────────────────────────────────────

def test_status_map_covers_all_task_statuses():
    for status in TaskStatus:
        assert status in _STATUS_MAP


def test_status_map_done_maps_to_completed():
    assert _STATUS_MAP[TaskStatus.done] == "completed"


def test_status_map_non_done_maps_to_needs_action():
    assert _STATUS_MAP[TaskStatus.todo] == "needsAction"
    assert _STATUS_MAP[TaskStatus.in_progress] == "needsAction"
    assert _STATUS_MAP[TaskStatus.cancelled] == "needsAction"
