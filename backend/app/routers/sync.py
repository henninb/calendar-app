"""
Google Calendar sync and ICS export endpoints.

OAuth flow:
  1. GET  /api/sync/auth            → redirect user to Google consent screen
  2. GET  /api/sync/auth/callback   → Google posts code here; token saved to disk
  3. GET  /api/sync/auth/status     → check authentication
  4. POST /api/sync/gcal            → push unsynced occurrences to Google Calendar
  5. GET  /api/sync/export/ics      → download all upcoming events as .ics
"""
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response
from fastapi.responses import RedirectResponse
from icalendar import Calendar, Event as ICalEvent
from sqlalchemy.orm import Session, joinedload

from ..config import settings
from ..database import SessionLocal, get_db
from ..models import Event, Occurrence, OccurrenceStatus
from ..schemas import AuthStatus, SyncResult
from ..services import google_calendar as gcal

router = APIRouter(prefix="/sync", tags=["sync"])


# ── OAuth ─────────────────────────────────────────────────────────────────────

@router.get("/auth")
def start_auth():
    """Redirect the browser to Google's OAuth consent screen."""
    url = gcal.get_auth_url()
    return RedirectResponse(url)


@router.get("/auth/callback")
def auth_callback(code: str, db: Session = Depends(get_db)):
    """Exchange the authorization code for credentials."""
    try:
        gcal.exchange_code(code)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return RedirectResponse(url="/")


@router.get("/auth/status", response_model=AuthStatus)
def auth_status():
    authenticated, email = gcal.is_authenticated()
    return AuthStatus(authenticated=authenticated, email=email)


# ── Sync ──────────────────────────────────────────────────────────────────────

def _run_gcal_sync(days_ahead: int, force: bool = False):
    """Background worker — opens its own DB session so it outlives the request."""
    db = SessionLocal()
    try:
        until = date.today() + timedelta(days=days_ahead)
        q = (
            db.query(Occurrence)
            .options(joinedload(Occurrence.event).joinedload(Event.category))
            .filter(
                Occurrence.occurrence_date <= until,
                Occurrence.status.in_([OccurrenceStatus.upcoming, OccurrenceStatus.overdue]),
            )
        )
        if not force:
            q = q.filter(Occurrence.synced_at.is_(None))
        occ_ids = [occ.id for occ in q.all()]
        total = len(occ_ids)
        print(f"[gcal sync] {total} occurrences to sync…")
        synced, skipped, failed = 0, 0, 0
        for i, occ_id in enumerate(occ_ids, 1):
            # Reload each occurrence fresh — a rollback in a prior iteration expires
            # all session objects, so referencing the original list triggers a DB
            # refresh that raises ObjectDeletedError if the row was deleted.
            occ = (
                db.query(Occurrence)
                .options(joinedload(Occurrence.event).joinedload(Event.category))
                .filter(Occurrence.id == occ_id)
                .first()
            )
            if occ is None:
                skipped += 1
                continue
            occ_date = occ.occurrence_date
            try:
                inserted = gcal.sync_occurrence(db, occ)
                if inserted:
                    synced += 1
                    print(f"[gcal sync] {i}/{total} synced occ {occ_id} ({occ_date})")
                else:
                    skipped += 1
            except Exception as exc:
                failed += 1
                db.rollback()
                print(f"[gcal sync] {i}/{total} FAILED occ {occ_id} ({occ_date}): {exc}")
        print(f"[gcal sync] done — synced={synced} skipped={skipped} failed={failed}")
    finally:
        db.close()


@router.post("/gcal", response_model=SyncResult)
def sync_to_gcal(
    background_tasks: BackgroundTasks,
    days_ahead: int = Query(settings.occurrence_lookahead_days, ge=1, le=730),
    force: bool = Query(False, description="Re-sync all occurrences, overwriting existing Google Calendar events"),
):
    """
    Enqueue a background sync to Google Calendar.
    Use force=true to overwrite already-synced events (prevents duplicates).
    Returns immediately — watch server logs for progress.
    """
    background_tasks.add_task(_run_gcal_sync, days_ahead, force)
    mode = "force (overwrite)" if force else "new only"
    return SyncResult(synced=0, failed=0, errors=[], message=f"Sync started in background [{mode}] — check server logs for progress.")


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
