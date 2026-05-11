"""Tests for app/database.py"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


class TestGetDb:
    def test_yields_session_and_closes(self):
        from app.database import get_db

        mock_session = MagicMock()
        with patch("app.database.SessionLocal", return_value=mock_session):
            gen = get_db()
            db = next(gen)
            assert db is mock_session
            with pytest.raises(StopIteration):
                next(gen)
        mock_session.close.assert_called_once()

    def test_rollback_on_exception(self):
        from app.database import get_db

        mock_session = MagicMock()
        with patch("app.database.SessionLocal", return_value=mock_session):
            gen = get_db()
            next(gen)
            with pytest.raises(RuntimeError):
                gen.throw(RuntimeError("db error"))
        mock_session.rollback.assert_called_once()
        mock_session.close.assert_called_once()

    def test_close_called_even_without_exception(self):
        from app.database import get_db

        mock_session = MagicMock()
        with patch("app.database.SessionLocal", return_value=mock_session):
            gen = get_db()
            next(gen)
            try:
                next(gen)
            except StopIteration:
                pass
        mock_session.close.assert_called_once()
        mock_session.rollback.assert_not_called()
