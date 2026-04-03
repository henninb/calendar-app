"""
Google Calendar sync and ICS export endpoints.

OAuth flow:
  1. GET  /api/sync/auth            → redirect user to Google consent screen
  2. GET  /api/sync/auth/callback   → Google posts code here; token saved to disk
  3. GET  /api/sync/auth/status     → check authentication
  4. POST /api/sync/gcal            → push unsynced occurrences to Google Calendar
  5. GET  /api/sync/export/ics      → download all upcoming events as .ics
"""
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta
from typing import Generator, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, Response
from fastapi.responses import RedirectResponse, StreamingResponse
from icalendar import Calendar, Event as ICalEvent
from sqlalchemy.orm import Session, joinedload

from ..config import settings
from ..database import SessionLocal, get_db
from ..models import Event, Occurrence, OccurrenceStatus, Task, TaskStatus
from ..schemas import AuthStatus, SyncResult
from ..services import google_calendar as gcal
from ..services import google_tasks as gtasks

_SYNC_WORKERS = 10

router = APIRouter(prefix="/sync", tags=["sync"])


# ── OAuth ─────────────────────────────────────────────────────────────────────

def _redirect_uri(request: Request) -> str:
    """Build the OAuth callback URI from the incoming request's headers.

    Respects X-Forwarded-Proto / X-Forwarded-Host set by the reverse proxy so
    the URI is correct whether the app is reached via localhost,
    calendar.bhenning.com, or any other domain.
    """
    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = request.headers.get(
        "x-forwarded-host",
        request.headers.get("host", request.url.netloc),
    )
    return f"{proto}://{host}/api/sync/auth/callback"


@router.get("/auth")
def start_auth(request: Request):
    """Redirect the browser to Google's OAuth consent screen."""
    url = gcal.get_auth_url(redirect_uri=_redirect_uri(request))
    return RedirectResponse(url)


@router.get("/auth/callback")
def auth_callback(code: str, request: Request, db: Session = Depends(get_db)):
    """Exchange the authorization code for credentials."""
    try:
        gcal.exchange_code(code, redirect_uri=_redirect_uri(request))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return RedirectResponse(url="/")


@router.get("/auth/status", response_model=AuthStatus)
def auth_status():
    authenticated, email = gcal.is_authenticated()
    return AuthStatus(authenticated=authenticated, email=email)


# ── Sync ──────────────────────────────────────────────────────────────────────

def _sync_one(occ_id: int) -> tuple[int, str, str, str]:
    """
    Per-thread worker — owns its own DB session and GCal service instance.
    Returns (occ_id, action, occ_date_str, gcal_id) where action is one of:
      "inserted" | "updated" | "skipped" | "failed:<message>"
    Never raises — all exceptions are captured in the action string.
    """
    db = SessionLocal()
    try:
        occ = (
            db.query(Occurrence)
            .options(joinedload(Occurrence.event).joinedload(Event.category))
            .filter(Occurrence.id == occ_id)
            .first()
        )
        if occ is None:
            return occ_id, "skipped", "", ""
        occ_date = str(occ.occurrence_date)
        action = gcal.sync_occurrence(db, occ)
        return occ_id, action, occ_date, occ.gcal_event_id or ""
    except Exception as exc:
        return occ_id, f"failed:{exc}", "", ""
    finally:
        db.close()


def _gcal_sync_events(days_ahead: int, force: bool = False) -> Generator[str, None, None]:
    """
    Generator that yields SSE-formatted events for a GCal sync.
    Collects occurrence IDs in one session, fans out to _SYNC_WORKERS threads,
    and emits a 'progress' event per occurrence plus a final 'done' event.
    """
    def sse(data: dict) -> str:
        return f"data: {json.dumps(data)}\n\n"

    # Phase 1: collect IDs
    db = SessionLocal()
    try:
        until = date.today() + timedelta(days=days_ahead)
        q = (
            db.query(Occurrence)
            .filter(
                Occurrence.occurrence_date <= until,
                Occurrence.status.in_([OccurrenceStatus.upcoming, OccurrenceStatus.overdue]),
            )
        )
        if not force:
            q = q.filter(Occurrence.synced_at.is_(None))
        occ_ids = [occ.id for occ in q.all()]
    finally:
        db.close()

    total = len(occ_ids)
    print(f"[gcal sync] {total} occurrences to sync across {_SYNC_WORKERS} workers…")
    yield sse({"type": "start", "total": total})

    inserted, updated, skipped, failed = 0, 0, 0, 0
    errors = []

    # Phase 2: fan out — each worker owns its session and GCal service
    with ThreadPoolExecutor(max_workers=_SYNC_WORKERS) as pool:
        futures = {pool.submit(_sync_one, occ_id): occ_id for occ_id in occ_ids}
        for i, future in enumerate(as_completed(futures), 1):
            occ_id, action, occ_date, gcal_id = future.result()
            if action == "inserted":
                inserted += 1
                msg = f"{i}/{total} occ {occ_id} ({occ_date}): inserted {gcal_id}"
            elif action == "updated":
                updated += 1
                msg = f"{i}/{total} occ {occ_id} ({occ_date}): updated {gcal_id}"
            elif action == "skipped":
                skipped += 1
                msg = f"{i}/{total} occ {occ_id}: skipped"
            else:
                failed += 1
                err_msg = action[7:]
                errors.append(f"occ {occ_id}: {err_msg}")
                msg = f"{i}/{total} occ {occ_id}: FAILED {err_msg}"
            print(f"[gcal sync] {msg}")
            yield sse({"type": "progress", "i": i, "total": total, "action": action.split(":")[0], "msg": msg})

    print(f"[gcal sync] done — inserted={inserted} updated={updated} skipped={skipped} failed={failed}")
    yield sse({"type": "done", "synced": inserted + updated, "failed": failed, "errors": errors})


@router.post("/gcal")
def sync_to_gcal(
    days_ahead: int = Query(settings.occurrence_lookahead_days, ge=1, le=730),
    force: bool = Query(False, description="Re-sync all occurrences, overwriting existing Google Calendar events"),
):
    """
    Sync occurrences to Google Calendar, streaming progress via Server-Sent Events.
    Each SSE event is a JSON object with a 'type' field: 'start', 'progress', or 'done'.
    """
    return StreamingResponse(
        _gcal_sync_events(days_ahead, force),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _run_gcal_delete_all():
    """Background worker — deletes all synced Google Calendar events and clears sync state."""
    db = SessionLocal()
    try:
        occ_ids = [o.id for o in db.query(Occurrence).filter(Occurrence.gcal_event_id.isnot(None)).all()]
        total = len(occ_ids)
        print(f"[gcal delete] {total} synced occurrences to remove from Google Calendar…")
        deleted, failed = 0, 0
        for i, occ_id in enumerate(occ_ids, 1):
            occ = db.query(Occurrence).filter(Occurrence.id == occ_id).first()
            if occ is None:
                continue
            try:
                gcal.delete_gcal_event(occ)
                occ.gcal_event_id = None
                occ.synced_at = None
                db.commit()
                deleted += 1
                print(f"[gcal delete] {i}/{total} deleted occ {occ.id} ({occ.occurrence_date})")
            except Exception as exc:
                failed += 1
                db.rollback()
                print(f"[gcal delete] {i}/{total} FAILED occ {occ_id}: {exc}")
        print(f"[gcal delete] done — deleted={deleted} failed={failed}")
    finally:
        db.close()


@router.delete("/gcal", response_model=SyncResult)
def delete_all_gcal_events(background_tasks: BackgroundTasks):
    """
    Delete all synced events from Google Calendar and clear sync state,
    so they can be re-synced fresh. Runs in the background.
    """
    background_tasks.add_task(_run_gcal_delete_all)
    return SyncResult(synced=0, failed=0, errors=[], message="Google Calendar wipe started in background — check server logs for progress.")


@router.delete("/gcal/wipe-all", response_model=SyncResult)
def wipe_all_gcal_events(db: Session = Depends(get_db)):
    """Delete ALL events from the primary Google Calendar, including non-app events."""
    try:
        deleted = gcal.wipe_all_gcal_events()
        cleared = (
            db.query(Occurrence)
            .filter(Occurrence.gcal_event_id.isnot(None))
            .update({Occurrence.gcal_event_id: None, Occurrence.synced_at: None},
                    synchronize_session=False)
        )
        db.commit()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return SyncResult(
        synced=deleted,
        failed=0,
        message=f"Wiped {deleted} events from Google Calendar, cleared {cleared} DB records.",
    )


@router.post("/gcal/{occurrence_id}", response_model=SyncResult)
def sync_single(occurrence_id: int, db: Session = Depends(get_db)):
    """Force-sync a single occurrence to Google Calendar."""
    occ = (
        db.query(Occurrence)
        .options(joinedload(Occurrence.event).joinedload(Event.category))
        .filter(Occurrence.id == occurrence_id)
        .first()
    )
    if not occ:
        raise HTTPException(status_code=404, detail="Occurrence not found")
    try:
        gcal.sync_occurrence(db, occ)
        return SyncResult(synced=1, failed=0)
    except Exception as exc:
        return SyncResult(synced=0, failed=1, errors=[str(exc)])


# ── Google Tasks Sync ─────────────────────────────────────────────────────────

def _sync_one_task(task_id: int, tasklist_id: str) -> tuple[int, str, str]:
    """
    Per-thread worker — owns its own DB session and Tasks service instance.
    Returns (task_id, action, title) where action is one of:
      "inserted" | "updated" | "failed:<message>"
    Never raises — all exceptions are captured in the action string.
    """
    db = SessionLocal()
    try:
        task = db.query(Task).filter(Task.id == task_id).first()
        if task is None:
            return task_id, "skipped", ""
        title = task.title[:40]
        action = gtasks.sync_task(db, task, tasklist_id=tasklist_id)
        return task_id, action, title
    except Exception as exc:
        return task_id, f"failed:{exc}", ""
    finally:
        db.close()


def _gtasks_sync_events() -> Generator[str, None, None]:
    """
    Generator that yields SSE-formatted events for a Google Tasks sync.
    Collects task IDs in one session, fans out to _SYNC_WORKERS threads,
    and emits a 'progress' event per task plus a final 'done' event.
    """
    def sse(data: dict) -> str:
        return f"data: {json.dumps(data)}\n\n"

    db = SessionLocal()
    try:
        task_ids = [
            t.id for t in db.query(Task).filter(Task.status != TaskStatus.cancelled).all()
        ]
    finally:
        db.close()

    total = len(task_ids)
    print(f"[gtasks sync] {total} tasks to sync across {_SYNC_WORKERS} workers…")
    yield sse({"type": "start", "total": total})

    _, tasklist_id = gtasks.get_or_create_tasklist()

    synced, failed, errors = 0, 0, []
    with ThreadPoolExecutor(max_workers=_SYNC_WORKERS) as pool:
        futures = {pool.submit(_sync_one_task, task_id, tasklist_id): task_id for task_id in task_ids}
        for i, future in enumerate(as_completed(futures), 1):
            task_id, action, title = future.result()
            if action in ("inserted", "updated"):
                synced += 1
                msg = f"{i}/{total} task {task_id} ({title}): {action}"
            elif action == "skipped":
                msg = f"{i}/{total} task {task_id}: skipped"
            else:
                failed += 1
                err_msg = action[7:]
                errors.append(f"task {task_id}: {err_msg}")
                msg = f"{i}/{total} task {task_id}: FAILED {err_msg}"
            print(f"[gtasks sync] {msg}")
            yield sse({"type": "progress", "i": i, "total": total, "action": action.split(":")[0], "msg": msg})

    print(f"[gtasks sync] done — synced={synced} failed={failed}")
    yield sse({"type": "done", "synced": synced, "failed": failed, "errors": errors})


@router.post("/gtasks")
def sync_to_gtasks():
    """Push all non-cancelled tasks to Google Tasks, streaming progress via Server-Sent Events."""
    return StreamingResponse(
        _gtasks_sync_events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── ICS Export ────────────────────────────────────────────────────────────────

@router.get("/export/ics")
def export_ics(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
):
    """
    Download upcoming occurrences as an .ics file importable into any
    calendar application including Google Calendar.
    """
    today = date.today()
    start = start_date or today
    end = end_date or (today + timedelta(days=settings.occurrence_lookahead_days))

    occs = (
        db.query(Occurrence)
        .options(joinedload(Occurrence.event).joinedload(Event.category))
        .filter(
            Occurrence.occurrence_date >= start,
            Occurrence.occurrence_date <= end,
        )
        .order_by(Occurrence.occurrence_date)
        .all()
    )

    cal = Calendar()
    cal.add("prodid", "-//Calendar App//EN")
    cal.add("version", "2.0")
    cal.add("calscale", "GREGORIAN")

    for occ in occs:
        ev = occ.event
        vevent = ICalEvent()
        vevent.add("uid", f"occ-{occ.id}@calendar-app")
        vevent.add("summary", ev.title)
        vevent.add("dtstart", occ.occurrence_date)
        vevent.add(
            "dtend",
            occ.occurrence_date + timedelta(days=ev.duration_days),
        )
        if ev.description:
            vevent.add("description", ev.description)
        if ev.location:
            vevent.add("location", ev.location)
        vevent.add("categories", [ev.category.name.replace("_", " ").title()])
        if ev.amount:
            vevent.add("comment", f"Amount: ${ev.amount}")
        cal.add_component(vevent)

    ics_bytes = cal.to_ical()
    return Response(
        content=ics_bytes,
        media_type="text/calendar",
        headers={"Content-Disposition": "attachment; filename=calendar-app.ics"},
    )
