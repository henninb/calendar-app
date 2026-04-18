from __future__ import annotations

import os

# Must precede all app imports so settings initialises from env, not gopass.
os.environ.setdefault("DB_HOST", "localhost")
os.environ.setdefault("DB_PORT", "5432")
os.environ.setdefault("DB_NAME", "calendar_test")
os.environ.setdefault("DB_USERNAME", "postgres")
os.environ.setdefault("DB_PASSWORD", "placeholder")
os.environ.setdefault("API_KEY", "")
os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3000")
os.environ.setdefault("DEFAULT_PERSON_NAME", "")

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.database as _db

# StaticPool forces all connections to share one in-memory DB so tables created
# by create_all are visible in every session.
_test_engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
_TestSession = sessionmaker(autocommit=False, autoflush=False, bind=_test_engine)
_db.engine = _test_engine
_db.SessionLocal = _TestSession

from app.models import Base  # noqa: E402

Base.metadata.create_all(bind=_test_engine)

# Replace the postgres-specific startup lifespan before importing app.main.
from contextlib import asynccontextmanager  # noqa: E402
import app.main as _main_module  # noqa: E402

@asynccontextmanager
async def _test_lifespan(application):
    yield  # tables already created above; skip migrations and scheduler

_main_module.app.router.lifespan_context = _test_lifespan

from app.main import app  # noqa: E402
from app.database import get_db  # noqa: E402


def _override_get_db():
    db = _TestSession()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


app.dependency_overrides[get_db] = _override_get_db


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient

    with TestClient(app, raise_server_exceptions=True) as c:
        yield c


@pytest.fixture(autouse=True)
def clean_tables():
    yield
    db = _TestSession()
    try:
        for table in reversed(Base.metadata.sorted_tables):
            db.execute(table.delete())
        db.commit()
    finally:
        db.close()
