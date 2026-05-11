"""Tests for app/services/scheduler.py"""
from __future__ import annotations

from unittest.mock import MagicMock, patch, call

import pytest


class TestRunDailyJob:
    def _make_db(self):
        return MagicMock()

    def test_calls_mark_overdue_and_generate(self):
        from app.services.scheduler import _run_daily_job

        mock_db = self._make_db()
        mock_db.query.return_value.filter.return_value.all.return_value = []

        with patch("app.services.scheduler.SessionLocal", return_value=mock_db):
            with patch("app.services.scheduler.mark_overdue", return_value=2) as mock_overdue:
                with patch("app.services.scheduler.generate_all_occurrences",
                           return_value={"occurrences_created": 5, "events_processed": 3}) as mock_gen:
                    with patch("app.services.scheduler.generate_credit_card_occurrences", return_value=0):
                        with patch("app.services.scheduler.generate_pending_tasks", return_value=1):
                            _run_daily_job()

        mock_overdue.assert_called_once_with(mock_db)
        mock_gen.assert_called_once_with(mock_db)

    def test_closes_session_on_success(self):
        from app.services.scheduler import _run_daily_job

        mock_db = self._make_db()
        mock_db.query.return_value.filter.return_value.all.return_value = []

        with patch("app.services.scheduler.SessionLocal", return_value=mock_db):
            with patch("app.services.scheduler.mark_overdue", return_value=0):
                with patch("app.services.scheduler.generate_all_occurrences",
                           return_value={"occurrences_created": 0, "events_processed": 0}):
                    with patch("app.services.scheduler.generate_credit_card_occurrences", return_value=0):
                        with patch("app.services.scheduler.generate_pending_tasks", return_value=0):
                            _run_daily_job()

        mock_db.close.assert_called_once()

    def test_closes_session_on_exception(self):
        from app.services.scheduler import _run_daily_job

        mock_db = self._make_db()

        with patch("app.services.scheduler.SessionLocal", return_value=mock_db):
            with patch("app.services.scheduler.mark_overdue", side_effect=RuntimeError("boom")):
                _run_daily_job()  # should not raise

        mock_db.close.assert_called_once()

    def test_exception_is_swallowed(self):
        from app.services.scheduler import _run_daily_job

        mock_db = self._make_db()

        with patch("app.services.scheduler.SessionLocal", return_value=mock_db):
            with patch("app.services.scheduler.mark_overdue", side_effect=Exception("fail")):
                _run_daily_job()  # must not propagate

    def test_credit_card_occurrences_generated_per_card(self):
        from app.services.scheduler import _run_daily_job
        from app.models import CreditCard

        mock_db = self._make_db()
        card1 = MagicMock(spec=CreditCard)
        card2 = MagicMock(spec=CreditCard)
        mock_db.query.return_value.filter.return_value.all.return_value = [card1, card2]

        with patch("app.services.scheduler.SessionLocal", return_value=mock_db):
            with patch("app.services.scheduler.mark_overdue", return_value=0):
                with patch("app.services.scheduler.generate_all_occurrences",
                           return_value={"occurrences_created": 0, "events_processed": 0}):
                    with patch("app.services.scheduler.generate_credit_card_occurrences",
                               return_value=3) as mock_cc:
                        with patch("app.services.scheduler.generate_pending_tasks", return_value=0):
                            _run_daily_job()

        assert mock_cc.call_count == 2


class TestStartScheduler:
    def test_adds_job_and_starts(self):
        from app.services import scheduler as sched_module

        with patch.object(sched_module.scheduler, "add_job") as mock_add:
            with patch.object(sched_module.scheduler, "start") as mock_start:
                with patch.object(sched_module.settings, "scheduler_interval_hours", 8):
                    sched_module.start_scheduler()

        mock_add.assert_called_once()
        call_kwargs = mock_add.call_args
        assert call_kwargs.kwargs.get("id") == "daily_occurrence_generation" or \
               call_kwargs[1].get("id") == "daily_occurrence_generation"
        mock_start.assert_called_once()

    def test_job_uses_configured_interval(self):
        from app.services import scheduler as sched_module
        from apscheduler.triggers.interval import IntervalTrigger

        captured = {}

        def capture_add_job(fn, trigger, **kwargs):
            captured["trigger"] = trigger

        with patch.object(sched_module.scheduler, "add_job", side_effect=capture_add_job):
            with patch.object(sched_module.scheduler, "start"):
                with patch.object(sched_module.settings, "scheduler_interval_hours", 4):
                    sched_module.start_scheduler()

        assert isinstance(captured["trigger"], IntervalTrigger)


class TestStopScheduler:
    def test_calls_shutdown(self):
        from app.services import scheduler as sched_module

        with patch.object(sched_module.scheduler, "shutdown") as mock_shutdown:
            sched_module.stop_scheduler()

        mock_shutdown.assert_called_once_with(wait=False)
