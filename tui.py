#!/usr/bin/env python3
"""
Calendar App — Terminal UI (direct PostgreSQL connection)
Connects to the same database as the backend using gopass for credentials.

Usage:
  python3 tui.py [options]

Options:
  --db-host     Database host        (default: postgresql.bhenning.com)
  --db-port     Database port        (default: 5432)
  --db-name     Database name        (default: calendar_db)
  --db-user     Username             (default: gopass or PGUSER env)
  --db-password Password             (default: gopass or PGPASSWORD env)

Keys (shown in status bar):
  1-4 / Tab   Switch tabs (Calendar / Upcoming / Cards / Tasks)
  r           Refresh current tab
  q           Quit
"""

import argparse
import calendar
import curses
import os
import subprocess
import sys
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, Dict, List, Optional

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("psycopg2 is required: pip install psycopg2-binary", file=sys.stderr)
    sys.exit(1)


# ── Credit card calculation (ported from backend/app/services/credit_card.py) ─

def _adjust_weekend(d: date, shift: str) -> date:
    if shift == "back_sat_only":
        return d - timedelta(days=1) if d.weekday() == 5 else d
    if shift == "nearest":
        if d.weekday() == 5: return d - timedelta(days=1)
        if d.weekday() == 6: return d + timedelta(days=1)
        return d
    if d.weekday() == 5:
        return d - timedelta(days=1) if shift == "back" else d + timedelta(days=2)
    if d.weekday() == 6:
        return d - timedelta(days=2) if shift == "back" else d + timedelta(days=1)
    return d


def _close_for_month(year: int, month: int, close_day: int,
                     weekend_shift: Optional[str]) -> date:
    import calendar as _cal
    last_day = _cal.monthrange(year, month)[1]
    d = date(year, month, min(close_day, last_day))
    if weekend_shift:
        d = _adjust_weekend(d, weekend_shift)
    return d


@dataclass
class _Card:
    """Lightweight stand-in for the ORM CreditCard model."""
    id: int
    name: str
    issuer: Optional[str]
    last_four: Optional[str]
    statement_close_day: Optional[int]
    grace_period_days: Optional[int]
    weekend_shift: Optional[str]
    cycle_days: Optional[int]
    cycle_reference_date: Optional[date]
    due_day_same_month: Optional[int]
    due_day_next_month: Optional[int]
    annual_fee_month: Optional[int]


def _rolling_close_for_month(year: int, month: int, card: _Card) -> Optional[date]:
    ref   = card.cycle_reference_date
    cycle = card.cycle_days
    n     = round((date(year, month, 1) - ref).days / cycle)
    for offset in range(n - 2, n + 3):
        c = ref + timedelta(days=offset * cycle)
        if c.year == year and c.month == month:
            return c
    return None


def _next_close(card: _Card, ref: date) -> date:
    if card.cycle_days:
        y, m = ref.year, ref.month
        for _ in range(3):
            d = _rolling_close_for_month(y, m, card)
            if d and d >= ref:
                return d
            m += 1
            if m > 12: m, y = 1, y + 1
        raise ValueError(f"Cannot find next close for {card.name}")
    d = _close_for_month(ref.year, ref.month, card.statement_close_day, card.weekend_shift)
    if d < ref:
        if ref.month == 12:
            d = _close_for_month(ref.year + 1, 1, card.statement_close_day, card.weekend_shift)
        else:
            d = _close_for_month(ref.year, ref.month + 1, card.statement_close_day, card.weekend_shift)
    return d


def _prev_close(card: _Card, ref: date) -> date:
    import calendar as _cal
    nc = _next_close(card, ref)
    if card.cycle_days:
        return nc - timedelta(days=card.cycle_days)
    if nc.month == 1:
        return _close_for_month(nc.year - 1, 12, card.statement_close_day, card.weekend_shift)
    return _close_for_month(nc.year, nc.month - 1, card.statement_close_day, card.weekend_shift)


def _due_for_close(close: date, card: _Card) -> date:
    import calendar as _cal
    if card.due_day_same_month:
        last = _cal.monthrange(close.year, close.month)[1]
        return date(close.year, close.month, min(card.due_day_same_month, last))
    if card.due_day_next_month:
        if close.month == 12:
            return date(close.year + 1, 1, card.due_day_next_month)
        last = _cal.monthrange(close.year, close.month + 1)[1]
        return date(close.year, close.month + 1, min(card.due_day_next_month, last))
    if card.grace_period_days is None:
        raise ValueError(f"Card '{card.name}' has no due date config")
    return close + timedelta(days=card.grace_period_days)


def _next_fee_date(card: _Card, ref: date) -> Optional[date]:
    if not card.annual_fee_month:
        return None
    month = card.annual_fee_month
    for year in [ref.year, ref.year + 1]:
        d = (_rolling_close_for_month(year, month, card) if card.cycle_days
             else _close_for_month(year, month, card.statement_close_day, card.weekend_shift))
        if d and d >= ref:
            return d
    return None


def _grace_str(card: _Card) -> str:
    if card.due_day_same_month or card.due_day_next_month:
        today = date.today()
        return f"{(_due_for_close(_prev_close(card, today), card) - _prev_close(card, today)).days}V"
    return str(card.grace_period_days or "?")


def _make_tracker_row(card: _Card, today: date) -> Dict:
    try:
        pc = _prev_close(card, today)
        nc = _next_close(card, today)
        pd = _due_for_close(pc, card)
        nd = _due_for_close(nc, card)
        fd = _next_fee_date(card, today)
        return {
            "id": card.id, "name": card.name, "issuer": card.issuer,
            "last_four": card.last_four, "grace": _grace_str(card),
            "prev_close": pc.isoformat(), "prev_due": pd.isoformat(),
            "next_close": nc.isoformat(), "next_close_days": (nc - today).days,
            "next_due": nd.isoformat(), "next_due_days": (nd - today).days,
            "annual_fee_date": fd.isoformat() if fd else None,
            "annual_fee_days": (fd - today).days if fd else None,
            "prev_due_overdue": pd < today,
        }
    except Exception as exc:
        return {
            "id": card.id, "name": card.name, "issuer": card.issuer,
            "last_four": card.last_four, "grace": "?", "error": str(exc),
            "prev_close": None, "prev_due": None,
            "next_close": None, "next_close_days": None,
            "next_due": None, "next_due_days": None,
            "annual_fee_date": None, "annual_fee_days": None,
            "prev_due_overdue": False,
        }


# ── Credentials ───────────────────────────────────────────────────────────────

def _gopass(path: str) -> str:
    try:
        r = subprocess.run(["gopass", "show", "-o", path],
                           capture_output=True, text=True, timeout=10)
        if r.returncode == 0:
            return r.stdout.strip()
    except Exception:
        pass
    return ""


# ── Database layer ────────────────────────────────────────────────────────────

class APIError(RuntimeError):
    pass


class DB:
    """
    Direct-to-PostgreSQL data layer.
    Presents the same get/post/patch/delete interface as the old HTTP API
    class so that the UI code is unchanged.
    """

    def __init__(self, conn):
        self.conn = conn

    # ── row helpers ───────────────────────────────────────────────────────────

    @staticmethod
    def _occ_dict(row) -> Dict:
        return {
            "id":              row["id"],
            "occurrence_date": str(row["occurrence_date"]),
            "status":          row["status"],
            "notes":           row["notes"],
            "event": {
                "id":           row["event_id"],
                "title":        row["event_title"],
                "description":  row["event_desc"],
                "priority":     row["event_priority"],
                "amount":       str(row["event_amount"]) if row["event_amount"] is not None else None,
                "reminder_days": row["event_reminder_days"],
                "category": {
                    "id":    row["cat_id"],
                    "name":  row["cat_name"],
                    "color": row["cat_color"],
                    "icon":  row["cat_icon"],
                },
            },
        }

    @staticmethod
    def _task_dict(row) -> Dict:
        cat = ({"id": row["cat_id"], "name": row["cat_name"],
                "color": row["cat_color"], "icon": row["cat_icon"]}
               if row["cat_id"] else None)
        assignee = ({"id": row["assignee_id"], "name": row["assignee_name"]}
                    if row["assignee_id"] else None)
        return {
            "id":                row["id"],
            "title":             row["title"],
            "description":       row["description"],
            "status":            row["status"],
            "priority":          row["priority"],
            "due_date":          str(row["due_date"]) if row["due_date"] else None,
            "estimated_minutes": row["estimated_minutes"],
            "recurrence":        row["recurrence"],
            "completed_at":      str(row["completed_at"]) if row["completed_at"] else None,
            "category":          cat,
            "assignee":          assignee,
            "subtasks":          [],
        }

    # ── routing ───────────────────────────────────────────────────────────────

    def get(self, path: str, params: Optional[Dict] = None) -> Any:
        p = params or {}
        if path == "/categories":           return self._categories()
        if path == "/credit-cards/tracker": return self._cc_tracker()
        if path == "/occurrences":          return self._occurrences(p)
        if path == "/tasks":                return self._tasks(p)
        if path == "/persons":              return self._persons()
        raise APIError(f"Unknown GET {path}")

    def post(self, path: str, data: Optional[Dict] = None) -> Any:
        d    = data or {}
        parts = path.strip("/").split("/")
        if path == "/tasks":
            return self._create_task(d)
        if (len(parts) == 3 and parts[0] == "occurrences" and parts[2] == "task"):
            return self._task_from_occ(int(parts[1]))
        raise APIError(f"Unknown POST {path}")

    def patch(self, path: str, data: Dict) -> Any:
        parts = path.strip("/").split("/")
        if parts[0] == "occurrences":
            return self._update_occ(int(parts[1]), data)
        if parts[0] == "tasks":
            if len(parts) == 4 and parts[2] == "subtasks":
                return self._update_subtask(int(parts[1]), int(parts[3]), data)
            return self._update_task(int(parts[1]), data)
        raise APIError(f"Unknown PATCH {path}")

    def delete(self, path: str) -> None:
        parts = path.strip("/").split("/")
        if parts[0] == "tasks":
            if len(parts) == 4 and parts[2] == "subtasks":
                self._delete_subtask(int(parts[1]), int(parts[3]))
                return
            self._delete_task(int(parts[1]))
            return
        raise APIError(f"Unknown DELETE {path}")

    # ── queries ───────────────────────────────────────────────────────────────

    def _occurrences(self, params: Dict) -> List[Dict]:
        start = params.get("start_date", date.today().isoformat())
        end   = params.get("end_date",   (date.today() + timedelta(days=60)).isoformat())
        limit = int(params.get("limit", 500))
        with self.conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT  o.id, o.occurrence_date, o.status, o.notes,
                        e.id          AS event_id,
                        e.title       AS event_title,
                        e.description AS event_desc,
                        e.priority    AS event_priority,
                        e.amount      AS event_amount,
                        e.reminder_days AS event_reminder_days,
                        c.id    AS cat_id,  c.name  AS cat_name,
                        c.color AS cat_color, c.icon AS cat_icon
                FROM occurrences o
                JOIN events      e ON o.event_id    = e.id
                JOIN categories  c ON e.category_id = c.id
                WHERE o.occurrence_date BETWEEN %s AND %s
                ORDER BY o.occurrence_date ASC
                LIMIT %s
            """, (start, end, limit))
            return [self._occ_dict(r) for r in cur.fetchall()]

    def _update_occ(self, occ_id: int, data: Dict) -> Dict:
        status = data.get("status")
        try:
            with self.conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("UPDATE occurrences SET status = %s WHERE id = %s",
                            (status, occ_id))
                cur.execute("""
                    SELECT  o.id, o.occurrence_date, o.status, o.notes,
                            e.id AS event_id, e.title AS event_title,
                            e.description AS event_desc,
                            e.priority AS event_priority,
                            e.amount   AS event_amount,
                            e.reminder_days AS event_reminder_days,
                            c.id AS cat_id, c.name AS cat_name,
                            c.color AS cat_color, c.icon AS cat_icon
                    FROM occurrences o
                    JOIN events     e ON o.event_id    = e.id
                    JOIN categories c ON e.category_id = c.id
                    WHERE o.id = %s
                """, (occ_id,))
                row = cur.fetchone()
            if not row:
                raise APIError(f"Occurrence {occ_id} not found")
            return self._occ_dict(row)
        except psycopg2.Error as e:
            self.conn.rollback()
            raise APIError(str(e))

    def _tasks(self, params: Dict) -> List[Dict]:
        limit = int(params.get("limit", 500))
        with self.conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT  t.id, t.title, t.description,
                        t.status, t.priority, t.due_date,
                        t.estimated_minutes, t.recurrence, t.completed_at,
                        p.id    AS assignee_id,  p.name  AS assignee_name,
                        c.id    AS cat_id,        c.name  AS cat_name,
                        c.color AS cat_color,     c.icon  AS cat_icon
                FROM tasks t
                LEFT JOIN persons    p ON t.assignee_id = p.id
                LEFT JOIN categories c ON t.category_id = c.id
                ORDER BY t.due_date ASC NULLS LAST, t.created_at ASC
                LIMIT %s
            """, (limit,))
            tasks = [self._task_dict(r) for r in cur.fetchall()]

        if tasks:
            ids = [t["id"] for t in tasks]
            with self.conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("""
                    SELECT id, task_id, title, status, due_date, "order"
                    FROM subtasks
                    WHERE task_id = ANY(%s)
                    ORDER BY task_id, "order" ASC, id ASC
                """, (ids,))
                sub_map: Dict[int, List] = {}
                for r in cur.fetchall():
                    sub_map.setdefault(r["task_id"], []).append({
                        "id":       r["id"],
                        "task_id":  r["task_id"],
                        "title":    r["title"],
                        "status":   r["status"],
                        "due_date": str(r["due_date"]) if r["due_date"] else None,
                        "order":    r["order"],
                    })
            for t in tasks:
                t["subtasks"] = sub_map.get(t["id"], [])
        return tasks

    def _single_task(self, task_id: int) -> Dict:
        with self.conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT  t.id, t.title, t.description,
                        t.status, t.priority, t.due_date,
                        t.estimated_minutes, t.recurrence, t.completed_at,
                        p.id AS assignee_id, p.name AS assignee_name,
                        c.id AS cat_id, c.name AS cat_name,
                        c.color AS cat_color, c.icon AS cat_icon
                FROM tasks t
                LEFT JOIN persons    p ON t.assignee_id = p.id
                LEFT JOIN categories c ON t.category_id = c.id
                WHERE t.id = %s
            """, (task_id,))
            row = cur.fetchone()
            if not row:
                raise APIError(f"Task {task_id} not found")
            task = self._task_dict(row)
            cur.execute("""
                SELECT id, task_id, title, status, due_date, "order"
                FROM subtasks WHERE task_id = %s ORDER BY "order", id
            """, (task_id,))
            task["subtasks"] = [
                {"id": r["id"], "task_id": r["task_id"], "title": r["title"],
                 "status": r["status"],
                 "due_date": str(r["due_date"]) if r["due_date"] else None,
                 "order": r["order"]}
                for r in cur.fetchall()
            ]
        return task

    def _update_task(self, task_id: int, data: Dict) -> Dict:
        status = data.get("status")
        try:
            with self.conn.cursor() as cur:
                if status == "done":
                    cur.execute("""
                        UPDATE tasks
                        SET status = %s, completed_at = NOW(), updated_at = NOW()
                        WHERE id = %s
                    """, (status, task_id))
                elif status is not None:
                    cur.execute("""
                        UPDATE tasks
                        SET status = %s, completed_at = NULL, updated_at = NOW()
                        WHERE id = %s
                    """, (status, task_id))
                else:
                    allowed = {"priority", "due_date", "estimated_minutes", "title"}
                    fields  = {k: v for k, v in data.items() if k in allowed}
                    if fields:
                        set_sql = ", ".join(f"{k} = %s" for k in fields)
                        cur.execute(
                            f"UPDATE tasks SET {set_sql}, updated_at = NOW() WHERE id = %s",
                            list(fields.values()) + [task_id],
                        )
        except psycopg2.Error as e:
            self.conn.rollback()
            raise APIError(str(e))
        return self._single_task(task_id)

    def _delete_task(self, task_id: int) -> None:
        try:
            with self.conn.cursor() as cur:
                cur.execute("DELETE FROM tasks WHERE id = %s", (task_id,))
        except psycopg2.Error as e:
            self.conn.rollback()
            raise APIError(str(e))

    def _create_task(self, data: Dict) -> Dict:
        try:
            with self.conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("""
                    INSERT INTO tasks
                        (title, priority, due_date, recurrence,
                         status, created_at, updated_at)
                    VALUES (%s, %s, %s, %s, 'todo', NOW(), NOW())
                    RETURNING id
                """, (
                    data.get("title"),
                    data.get("priority", "medium"),
                    data.get("due_date"),
                    data.get("recurrence", "none"),
                ))
                new_id = cur.fetchone()["id"]
        except psycopg2.Error as e:
            self.conn.rollback()
            raise APIError(str(e))
        return self._single_task(new_id)

    def _task_from_occ(self, occ_id: int) -> Dict:
        try:
            with self.conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("""
                    SELECT e.title, e.priority, o.occurrence_date
                    FROM occurrences o JOIN events e ON o.event_id = e.id
                    WHERE o.id = %s
                """, (occ_id,))
                row = cur.fetchone()
                if not row:
                    raise APIError(f"Occurrence {occ_id} not found")
                cur.execute("""
                    INSERT INTO tasks
                        (occurrence_id, title, due_date, priority,
                         recurrence, status, created_at, updated_at)
                    VALUES (%s, %s, %s, %s, 'none', 'todo', NOW(), NOW())
                    RETURNING id
                """, (occ_id, row["title"], row["occurrence_date"], row["priority"]))
                new_id = cur.fetchone()["id"]
        except psycopg2.Error as e:
            self.conn.rollback()
            raise APIError(str(e))
        return {"id": new_id}

    def _update_subtask(self, task_id: int, subtask_id: int, data: Dict) -> Dict:
        status = data.get("status")
        try:
            with self.conn.cursor() as cur:
                cur.execute("""
                    UPDATE subtasks SET status = %s, updated_at = NOW()
                    WHERE id = %s AND task_id = %s
                """, (status, subtask_id, task_id))
        except psycopg2.Error as e:
            self.conn.rollback()
            raise APIError(str(e))
        return {"id": subtask_id, "task_id": task_id, "status": status}

    def _delete_subtask(self, task_id: int, subtask_id: int) -> None:
        try:
            with self.conn.cursor() as cur:
                cur.execute("DELETE FROM subtasks WHERE id = %s AND task_id = %s",
                            (subtask_id, task_id))
        except psycopg2.Error as e:
            self.conn.rollback()
            raise APIError(str(e))

    def _categories(self) -> List[Dict]:
        with self.conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT id, name, color, icon FROM categories ORDER BY name")
            return [dict(r) for r in cur.fetchall()]

    def _persons(self) -> List[Dict]:
        with self.conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT id, name, email FROM persons ORDER BY name")
            return [dict(r) for r in cur.fetchall()]

    def _cc_tracker(self) -> List[Dict]:
        with self.conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT id, name, issuer, last_four,
                       statement_close_day, grace_period_days, weekend_shift,
                       cycle_days, cycle_reference_date,
                       due_day_same_month, due_day_next_month, annual_fee_month
                FROM credit_cards
                WHERE is_active IS NOT FALSE
                ORDER BY name
            """)
            rows = cur.fetchall()
        today = date.today()
        result = []
        for r in rows:
            card = _Card(
                id=r["id"], name=r["name"], issuer=r["issuer"],
                last_four=r["last_four"],
                statement_close_day=r["statement_close_day"],
                grace_period_days=r["grace_period_days"],
                weekend_shift=r["weekend_shift"],
                cycle_days=r["cycle_days"],
                cycle_reference_date=r["cycle_reference_date"],
                due_day_same_month=r["due_day_same_month"],
                due_day_next_month=r["due_day_next_month"],
                annual_fee_month=r["annual_fee_month"],
            )
            result.append(_make_tracker_row(card, today))
        return result


# ── Formatting helpers ────────────────────────────────────────────────────────

def fmt_date(ds: Optional[str]) -> str:
    if not ds:
        return "—"
    try:
        return date.fromisoformat(ds[:10]).strftime("%b %-d, %Y")
    except Exception:
        return ds or "—"


def days_until(ds: str) -> str:
    try:
        diff = (date.fromisoformat(ds[:10]) - date.today()).days
        if diff == 0:  return "Today"
        if diff == 1:  return "Tomorrow"
        if diff < 0:   return f"{abs(diff)}d ago"
        return f"in {diff}d"
    except Exception:
        return ""


def days_badge(ds: Optional[str]) -> str:
    if not ds:
        return ""
    try:
        diff = (date.fromisoformat(ds[:10]) - date.today()).days
        if diff < 0:   return f"{abs(diff)}d overdue"
        if diff == 0:  return "today"
        return f"{diff}d"
    except Exception:
        return ""


def trunc(s: str, n: int) -> str:
    s = str(s)
    if n <= 0: return ""
    return s if len(s) <= n else s[:n - 1] + "…"


def pad(s: str, n: int) -> str:
    return trunc(s, n).ljust(n)


# ── Color pair IDs ────────────────────────────────────────────────────────────

C_HEADER  = 1
C_TAB_ON  = 2
C_TAB_OFF = 3
C_GREEN   = 4
C_RED     = 5
C_YELLOW  = 6
C_BLUE    = 7
C_GRAY    = 8
C_SEL     = 9
C_TITLE   = 10
C_STATUS  = 11

STATUS_CP = {
    "completed":   C_GREEN,
    "done":        C_GREEN,
    "overdue":     C_RED,
    "in_progress": C_YELLOW,
    "todo":        C_BLUE,
    "upcoming":    C_BLUE,
    "skipped":     C_GRAY,
    "cancelled":   C_GRAY,
}
PRIORITY_CP = {"high": C_RED, "medium": C_YELLOW, "low": C_GRAY}

TABS = ["Calendar", "Upcoming", "Cards", "Tasks"]
TAB_KEYS = {ord("1"): 0, ord("2"): 1, ord("3"): 2, ord("4"): 3}
STATUS_LABELS = {
    "todo": "To Do", "in_progress": "In Progress",
    "done": "Done",  "cancelled": "Cancelled",
}


# ── Application ───────────────────────────────────────────────────────────────

class App:
    def __init__(self, scr: "curses.window", api: DB):
        self.scr   = scr
        self.api   = api
        self.tab   = 3
        self.msg   = ""
        self.msg_err = False
        self.today = date.today()

        # Calendar
        self.cal_year  = self.today.year
        self.cal_month = self.today.month
        self.cal_day   = self.today.day
        self.cal_occs: List[Dict] = []
        self.cal_cats: List[Dict] = []
        self.cal_occ_idx = 0

        # Upcoming
        self.up_occs: List[Dict] = []
        self.up_idx    = 0
        self.up_scroll = 0
        self.up_days   = 60
        self.up_status = "upcoming,overdue"

        # Cards
        self.cards: List[Dict] = []

        # Tasks
        self.tasks: List[Dict] = []
        self.task_cursor = 0
        self.task_scroll = 0
        self.task_show_done = False
        self.task_expanded: set = set()

        curses.curs_set(0)
        curses.start_color()
        curses.use_default_colors()
        self._init_colors()
        self.scr.keypad(True)
        self._load_tab()

    def _init_colors(self):
        curses.init_pair(C_HEADER,  curses.COLOR_BLACK,  curses.COLOR_BLUE)
        curses.init_pair(C_TAB_ON,  curses.COLOR_WHITE,  curses.COLOR_BLUE)
        curses.init_pair(C_TAB_OFF, curses.COLOR_CYAN,   curses.COLOR_BLUE)
        curses.init_pair(C_GREEN,   curses.COLOR_GREEN,  -1)
        curses.init_pair(C_RED,     curses.COLOR_RED,    -1)
        curses.init_pair(C_YELLOW,  curses.COLOR_YELLOW, -1)
        curses.init_pair(C_BLUE,    curses.COLOR_CYAN,   -1)
        curses.init_pair(C_GRAY,    curses.COLOR_WHITE,  -1)
        curses.init_pair(C_SEL,     curses.COLOR_BLACK,  curses.COLOR_CYAN)
        curses.init_pair(C_TITLE,   curses.COLOR_CYAN,   -1)
        curses.init_pair(C_STATUS,  curses.COLOR_BLACK,  curses.COLOR_WHITE)

    # ── draw helpers ──────────────────────────────────────────────────────────

    def _put(self, row: int, col: int, text: str, attr: int = 0):
        try:
            H, W = self.scr.getmaxyx()
            if row < 0 or row >= H or col < 0 or col >= W:
                return
            avail = W - col - (1 if row == H - 1 else 0)
            text  = trunc(text, avail)
            if attr: self.scr.attron(attr)
            self.scr.addstr(row, col, text)
            if attr: self.scr.attroff(attr)
        except curses.error:
            pass

    def _fill(self, row: int, col: int, width: int, attr: int = 0):
        try:
            H, W = self.scr.getmaxyx()
            if row < 0 or row >= H:
                return
            width = min(width, W - col - (1 if row == H - 1 else 0))
            if width <= 0:
                return
            if attr: self.scr.attron(attr)
            self.scr.addstr(row, col, " " * width)
            if attr: self.scr.attroff(attr)
        except curses.error:
            pass

    # ── top-level draw ────────────────────────────────────────────────────────

    def draw(self):
        self.scr.erase()
        H, W = self.scr.getmaxyx()
        if H < 10 or W < 50:
            self._put(0, 0, "Terminal too small — resize to at least 50×10")
            self.scr.refresh()
            return
        self._draw_header(W)
        self._draw_body(H, W)
        self._draw_status(H, W)
        self.scr.refresh()

    def _draw_header(self, W: int):
        self._fill(0, 0, W, curses.color_pair(C_HEADER))
        title = " Calendar TUI "
        self._put(0, 0, title, curses.color_pair(C_TAB_ON) | curses.A_BOLD)
        x = len(title)
        for i, name in enumerate(TABS):
            label = f"  [{i+1}] {name}  "
            attr  = (curses.color_pair(C_TAB_ON) | curses.A_BOLD | curses.A_UNDERLINE
                     if i == self.tab else curses.color_pair(C_TAB_OFF))
            self._put(0, x, label, attr)
            x += len(label)
        ds = self.today.strftime("%a %b %-d %Y")
        self._put(0, W - len(ds) - 2, ds, curses.color_pair(C_TAB_OFF))

    def _draw_body(self, H: int, W: int):
        body_h = H - 2
        if self.tab == 0:   self._draw_calendar(body_h, W)
        elif self.tab == 1: self._draw_upcoming(body_h, W)
        elif self.tab == 2: self._draw_cards(body_h, W)
        elif self.tab == 3: self._draw_tasks(body_h, W)

    def _draw_status(self, H: int, W: int):
        HELPS = {
            0: "←/→:month  ↑/↓:week  [/]:day  d:done  s:skip  u:reopen  r:refresh  q:quit",
            1: "↑/↓:select  d:done  s:skip  u:reopen  t:→task  f:filter  +/-:days  r:refresh  q:quit",
            2: "r:refresh  q:quit",
            3: "↑/↓:select  Enter:expand  d:done  i:wip  o:reopen  c:cancel  n:new  x:delete  h:show-done  q:quit",
        }
        if self.msg:
            attr = (curses.color_pair(C_RED) | curses.A_BOLD if self.msg_err
                    else curses.color_pair(C_GREEN) | curses.A_BOLD)
            self._fill(H - 1, 0, W, attr)
            self._put(H - 1, 1, self.msg, attr)
        else:
            self._fill(H - 1, 0, W, curses.color_pair(C_STATUS))
            self._put(H - 1, 1, HELPS.get(self.tab, "q:quit"), curses.color_pair(C_STATUS))

    # ── Calendar tab ──────────────────────────────────────────────────────────

    def _draw_calendar(self, H: int, W: int):
        GRID_W = 24
        row = 1

        month_title = date(self.cal_year, self.cal_month, 1).strftime("%B %Y")
        self._put(row, 1, f" ◂  {month_title}  ▸ ",
                  curses.color_pair(C_TITLE) | curses.A_BOLD)
        row += 1
        self._put(row, 1, " Mo  Tu  We  Th  Fr  Sa  Su", curses.A_BOLD)
        row += 1

        occ_days: Dict[int, int] = {}
        for occ in self.cal_occs:
            ds = occ.get("occurrence_date", "")
            try:
                d = date.fromisoformat(ds[:10])
                if d.year == self.cal_year and d.month == self.cal_month:
                    occ_days[d.day] = occ_days.get(d.day, 0) + 1
            except Exception:
                pass

        today = self.today
        for week in calendar.monthcalendar(self.cal_year, self.cal_month):
            x = 1
            for day in week:
                if day == 0:
                    self._put(row, x, "    ")
                else:
                    is_today = (day == today.day and
                                self.cal_year == today.year and
                                self.cal_month == today.month)
                    is_sel  = (day == self.cal_day)
                    has_occ = day in occ_days

                    if is_sel:
                        attr = curses.color_pair(C_SEL) | curses.A_BOLD
                    elif is_today:
                        attr = curses.color_pair(C_TITLE) | curses.A_BOLD
                    elif has_occ:
                        attr = curses.color_pair(C_BLUE)
                    else:
                        attr = 0

                    dot = "•" if has_occ else " "
                    self._put(row, x, f"{day:2d}{dot} ", attr)
                x += 4
            row += 1

        row += 1
        self._put(row, 1, "• = has events", curses.color_pair(C_GRAY))
        row += 1
        self._put(row, 1, "[ ] = prev/next day   ← → = change month",
                  curses.color_pair(C_GRAY))

        if W > GRID_W + 25:
            self._draw_cal_panel(1, GRID_W + 2, H, W - GRID_W - 3)

    def _draw_cal_panel(self, top: int, left: int, H: int, W: int):
        sel_date = date(self.cal_year, self.cal_month, self.cal_day)
        day_occs = [o for o in self.cal_occs
                    if o.get("occurrence_date", "")[:10] == sel_date.isoformat()]

        # Vertical divider
        for r in range(top, H):
            self._put(r, left - 1, "│", curses.color_pair(C_GRAY))

        header = f" {sel_date.strftime('%A, %B %-d %Y')} "
        self._put(top, left, trunc(header, W), curses.color_pair(C_TITLE) | curses.A_BOLD)
        top += 1
        self._put(top, left, "─" * min(W, 36), curses.color_pair(C_GRAY))
        top += 1

        if not day_occs:
            self._put(top, left + 1, "No events today.", curses.color_pair(C_GRAY))
            return

        n = len(day_occs)
        if n > 1:
            self._put(top, left + 1, f"{n} events  PgUp/PgDn:select  d:done  s:skip",
                      curses.color_pair(C_GRAY))
            top += 1
        else:
            self._put(top, left + 1, "d:done  s:skip  u:reopen",
                      curses.color_pair(C_GRAY))
            top += 1

        for i, occ in enumerate(day_occs):
            if top >= H - 1:
                break
            is_sel   = (i == self.cal_occ_idx % n)
            status   = occ.get("status", "upcoming")
            ev       = occ.get("event", {}) or {}
            title    = ev.get("title", "(no title)")
            cat_name = (ev.get("category", {}) or {}).get("name", "").replace("_", " ")
            amt      = ev.get("amount")
            desc     = ev.get("description", "")

            color = STATUS_CP.get(status, 0)
            attr  = (curses.color_pair(C_SEL) | curses.A_BOLD if is_sel
                     else curses.color_pair(color))
            tag   = f"[{status}]"

            self._fill(top, left, W, attr)
            self._put(top, left + 1, trunc(title, W - len(tag) - 3), attr)
            self._put(top, left + W - len(tag) - 1, tag, attr)
            top += 1

            if is_sel or n == 1:
                if cat_name:
                    self._put(top, left + 3, f"Category: {cat_name}",
                              curses.color_pair(C_GRAY))
                    top += 1
                if amt:
                    self._put(top, left + 3, f"Amount:   ${float(amt):.2f}",
                              curses.color_pair(C_GREEN))
                    top += 1
                if desc:
                    self._put(top, left + 3, trunc(f"Note: {desc}", W - 4),
                              curses.color_pair(C_GRAY))
                    top += 1
                top += 1  # spacer

    # ── Upcoming tab ──────────────────────────────────────────────────────────

    def _draw_upcoming(self, H: int, W: int):
        row = 1
        filt = self.up_status or "all"
        info = (f"  Upcoming  |  {self.up_days} days  |  filter: {filt}  "
                f"|  {len(self.up_occs)} results  |  f:cycle  +/-:days")
        self._put(row, 0, trunc(info, W), curses.color_pair(C_TITLE) | curses.A_BOLD)
        row += 1

        DATE_W, WHEN_W, CAT_W, STAT_W = 12, 10, 14, 10
        EVT_W = max(12, W - DATE_W - WHEN_W - CAT_W - STAT_W - 6)
        COLS  = [("Date", DATE_W), ("When", WHEN_W), ("Event", EVT_W),
                 ("Category", CAT_W), ("Status", STAT_W)]

        x = 1
        for name, w in COLS:
            self._put(row, x, name.ljust(w), curses.A_BOLD | curses.A_UNDERLINE)
            x += w + 1
        row += 1

        if not self.up_occs:
            self._put(row, 2, "No occurrences found.", curses.color_pair(C_GRAY))
            return

        scroll   = self.up_scroll
        max_rows = H - row - 1
        for i, occ in enumerate(self.up_occs[scroll: scroll + max_rows]):
            idx    = scroll + i
            is_sel = (idx == self.up_idx)
            status = occ.get("status", "upcoming")
            od     = occ.get("occurrence_date", "")
            ev     = occ.get("event", {}) or {}
            title  = ev.get("title", "")
            cat    = (ev.get("category", {}) or {}).get("name", "").replace("_", " ")

            color = STATUS_CP.get(status, 0)
            attr  = (curses.color_pair(C_SEL) | curses.A_BOLD if is_sel
                     else curses.color_pair(color))

            self._fill(row, 0, W, attr)
            x = 1
            for val, w in [(fmt_date(od), DATE_W), (days_until(od), WHEN_W),
                           (title, EVT_W), (cat, CAT_W), (status, STAT_W)]:
                self._put(row, x, pad(val, w), attr)
                x += w + 1
            row += 1

    # ── Cards tab ─────────────────────────────────────────────────────────────

    def _draw_cards(self, H: int, W: int):
        row = 1
        self._put(row, 1, "Credit Card Billing Tracker",
                  curses.color_pair(C_TITLE) | curses.A_BOLD)
        row += 2

        if not self.cards:
            self._put(row, 2, "No credit cards found.", curses.color_pair(C_GRAY))
            return

        COLS = [("Card", 20), ("Issuer", 10), ("Last Close", 12),
                ("Prev Due", 13), ("Next Close", 15), ("Next Due", 15), ("Annual Fee", 15)]
        x = 1
        for name, w in COLS:
            self._put(row, x, name.ljust(w), curses.A_BOLD | curses.A_UNDERLINE)
            x += w + 1
        row += 1

        def _days_attr(days: Optional[int]) -> int:
            if days is None:  return 0
            if days <= 3:     return curses.color_pair(C_RED) | curses.A_BOLD
            if days <= 7:     return curses.color_pair(C_YELLOW)
            return 0

        def _cell(ds: Optional[str], days: Optional[int]) -> str:
            return "—" if not ds else (f"{fmt_date(ds)} ({days}d)" if days is not None else fmt_date(ds))

        for card in self.cards:
            if row >= H - 2:
                break
            name = card.get("name", "")
            l4   = card.get("last_four", "")
            if l4:
                name = f"{name} ({l4})"
            x = 1
            self._put(row, x, pad(name, 20), curses.A_BOLD);  x += 21
            self._put(row, x, pad(card.get("issuer") or "", 10));  x += 11
            self._put(row, x, pad(fmt_date(card.get("prev_close")), 12));  x += 13

            prev_attr = curses.color_pair(C_RED) if card.get("prev_due_overdue") else 0
            prev_str  = fmt_date(card.get("prev_due")) + (" !" if card.get("prev_due_overdue") else "")
            self._put(row, x, pad(prev_str, 13), prev_attr);  x += 14

            nc = card.get("next_close_days")
            self._put(row, x, pad(_cell(card.get("next_close"), nc), 15), _days_attr(nc));  x += 16

            nd = card.get("next_due_days")
            self._put(row, x, pad(_cell(card.get("next_due"), nd), 15), _days_attr(nd));    x += 16

            af = card.get("annual_fee_days")
            self._put(row, x, pad(_cell(card.get("annual_fee_date"), af), 15), _days_attr(af))
            row += 1

        row += 1
        if row < H - 1:
            self._put(row, 1, "Red = ≤3 days  ", curses.color_pair(C_RED))
            self._put(row, 16, "Yellow = ≤7 days", curses.color_pair(C_YELLOW))

    # ── Tasks tab ─────────────────────────────────────────────────────────────

    def _task_filtered(self) -> List[Dict]:
        if self.task_show_done:
            return self.tasks
        return [t for t in self.tasks if t.get("status") not in ("done", "cancelled")]

    def _task_display_rows(self, filtered: List[Dict]) -> List[Dict]:
        rows: List[Dict] = []
        for t in filtered:
            rows.append({"type": "task", "data": t})
            if t["id"] in self.task_expanded:
                for sub in t.get("subtasks", []):
                    rows.append({"type": "subtask", "data": sub, "parent": t})
        return rows

    def _draw_tasks(self, H: int, W: int):
        filtered     = self._task_filtered()
        display_rows = self._task_display_rows(filtered)

        row = 1
        mode = "all" if self.task_show_done else "active"
        info = (f"  Tasks ({mode}) — {len(filtered)} shown  "
                f"|  h:toggle-done  n:new task  d/i/o/c:set status  x:delete")
        self._put(row, 0, trunc(info, W), curses.color_pair(C_TITLE) | curses.A_BOLD)
        row += 1

        STAT_W, PRI_W, DUE_W, EST_W = 13, 9, 17, 5
        TITL_W = max(12, W - STAT_W - PRI_W - DUE_W - EST_W - 6)
        COLS   = [("Status", STAT_W), ("Title", TITL_W),
                  ("Priority", PRI_W), ("Due", DUE_W), ("Est", EST_W)]

        x = 1
        for name, w in COLS:
            self._put(row, x, name.ljust(w), curses.A_BOLD | curses.A_UNDERLINE)
            x += w + 1
        row += 1

        if not display_rows:
            self._put(row, 2, "No tasks. Press 'n' to create one.",
                      curses.color_pair(C_GRAY))
            return

        scroll   = self.task_scroll
        max_rows = H - row - 1

        for i, item in enumerate(display_rows[scroll: scroll + max_rows]):
            glob_idx = scroll + i
            is_sel   = (glob_idx == self.task_cursor)

            if item["type"] == "task":
                t        = item["data"]
                status   = t.get("status", "todo")
                priority = t.get("priority", "medium")
                due      = t.get("due_date") or ""
                est      = t.get("estimated_minutes")
                subtasks = t.get("subtasks") or []
                expanded = t["id"] in self.task_expanded
                recur    = t.get("recurrence", "none")

                sub_done = sum(1 for s in subtasks if s.get("status") == "done")
                overdue  = (bool(due) and
                            date.fromisoformat(due) < date.today() and
                            status not in ("done", "cancelled"))

                pfx       = ("▾ " if expanded else "▸ ") if subtasks else "  "
                title_str = pfx + (t.get("title") or "")
                if subtasks:
                    title_str += f" [{sub_done}/{len(subtasks)}]"
                if recur and recur != "none":
                    title_str += " ↻"

                badge   = days_badge(due) if due and status not in ("done", "cancelled") else ""
                due_str = (fmt_date(due) + (f" {badge}" if badge else "")) if due else "—"
                est_str = f"{est}m" if est else "—"
                stat_str = STATUS_LABELS.get(status, status)

                color = STATUS_CP.get(status, 0)
                if is_sel:
                    base_attr = curses.color_pair(C_SEL) | curses.A_BOLD
                elif overdue:
                    base_attr = curses.color_pair(C_RED)
                else:
                    base_attr = curses.color_pair(color)

                self._fill(row, 0, W, base_attr)
                x = 1
                self._put(row, x, pad(stat_str, STAT_W), base_attr);   x += STAT_W + 1
                self._put(row, x, pad(title_str, TITL_W), base_attr);  x += TITL_W + 1
                p_attr = base_attr if is_sel else curses.color_pair(PRIORITY_CP.get(priority, 0))
                self._put(row, x, pad(priority, PRI_W), p_attr);        x += PRI_W + 1
                self._put(row, x, pad(due_str, DUE_W), base_attr);      x += DUE_W + 1
                self._put(row, x, pad(est_str, EST_W), base_attr)

            elif item["type"] == "subtask":
                sub    = item["data"]
                s_stat = sub.get("status", "todo")
                color  = STATUS_CP.get(s_stat, 0)
                attr   = (curses.color_pair(C_SEL) | curses.A_BOLD if is_sel
                          else curses.color_pair(color))
                self._fill(row, 0, W, attr)
                self._put(row, 1, trunc(f"      └ {sub.get('title', '')}", W - 2), attr)

            row += 1

    # ── Key handling ──────────────────────────────────────────────────────────

    def handle_key(self, key: int) -> bool:
        self.msg = ""
        self.msg_err = False

        if key in (ord("q"), ord("Q")):
            return False

        if key in TAB_KEYS:
            new = TAB_KEYS[key]
            if new != self.tab:
                self.tab = new
                self._load_tab()
            return True

        if key == ord("\t"):
            self.tab = (self.tab + 1) % len(TABS)
            self._load_tab()
            return True

        if key in (ord("r"), ord("R")):
            self._load_tab()
            return True

        if self.tab == 0:   self._key_calendar(key)
        elif self.tab == 1: self._key_upcoming(key)
        elif self.tab == 3: self._key_tasks(key)

        return True

    # ── Calendar keys ─────────────────────────────────────────────────────────

    def _key_calendar(self, key: int):
        max_day = calendar.monthrange(self.cal_year, self.cal_month)[1]
        if key == curses.KEY_LEFT:
            self._cal_prev_month()
        elif key == curses.KEY_RIGHT:
            self._cal_next_month()
        elif key == curses.KEY_UP:
            if self.cal_day > 7:     self.cal_day -= 7
            else:                     self._cal_prev_month()
        elif key == curses.KEY_DOWN:
            if self.cal_day + 7 <= max_day: self.cal_day += 7
            else:                            self._cal_next_month()
        elif key == ord("["):
            if self.cal_day > 1:     self.cal_day -= 1
            else:
                self._cal_prev_month()
                self.cal_day = calendar.monthrange(self.cal_year, self.cal_month)[1]
        elif key == ord("]"):
            if self.cal_day < max_day: self.cal_day += 1
            else:
                self._cal_next_month()
                self.cal_day = 1
        elif key == curses.KEY_PPAGE:
            self.cal_occ_idx = max(0, self.cal_occ_idx - 1)
        elif key == curses.KEY_NPAGE:
            sel = date(self.cal_year, self.cal_month, self.cal_day).isoformat()
            n   = sum(1 for o in self.cal_occs if o.get("occurrence_date", "")[:10] == sel)
            self.cal_occ_idx = min(max(n - 1, 0), self.cal_occ_idx + 1)
        elif key in (ord("d"), ord("D")): self._cal_mark("completed")
        elif key in (ord("s"), ord("S")): self._cal_mark("skipped")
        elif key in (ord("u"), ord("U")): self._cal_mark("upcoming")

    def _cal_prev_month(self):
        if self.cal_month == 1: self.cal_month, self.cal_year = 12, self.cal_year - 1
        else:                   self.cal_month -= 1
        self.cal_day = min(self.cal_day, calendar.monthrange(self.cal_year, self.cal_month)[1])
        self.cal_occ_idx = 0
        self._load_calendar()

    def _cal_next_month(self):
        if self.cal_month == 12: self.cal_month, self.cal_year = 1, self.cal_year + 1
        else:                    self.cal_month += 1
        self.cal_day = min(self.cal_day, calendar.monthrange(self.cal_year, self.cal_month)[1])
        self.cal_occ_idx = 0
        self._load_calendar()

    def _cal_mark(self, status: str):
        sel  = date(self.cal_year, self.cal_month, self.cal_day).isoformat()
        occs = [o for o in self.cal_occs if o.get("occurrence_date", "")[:10] == sel]
        if not occs:
            self.msg = "No events on this day."
            return
        occ = occs[self.cal_occ_idx % len(occs)]
        try:
            self.api.patch(f"/occurrences/{occ['id']}", {"status": status})
            self._load_calendar()
            self.msg = f"Marked '{(occ.get('event') or {}).get('title', '')}' as {status}"
        except APIError as e:
            self.msg = str(e); self.msg_err = True

    # ── Upcoming keys ─────────────────────────────────────────────────────────

    def _key_upcoming(self, key: int):
        n        = len(self.up_occs)
        max_rows = curses.LINES - 5

        if key == curses.KEY_UP and self.up_idx > 0:
            self.up_idx -= 1
            if self.up_idx < self.up_scroll: self.up_scroll = self.up_idx
        elif key == curses.KEY_DOWN and self.up_idx < n - 1:
            self.up_idx += 1
            if self.up_idx >= self.up_scroll + max_rows:
                self.up_scroll = self.up_idx - max_rows + 1
        elif key in (ord("d"), ord("D")): self._up_mark("completed")
        elif key in (ord("s"), ord("S")): self._up_mark("skipped")
        elif key in (ord("u"), ord("U")): self._up_mark("upcoming")
        elif key in (ord("t"), ord("T")): self._up_make_task()
        elif key in (ord("f"), ord("F")): self._up_cycle_filter()
        elif key in (ord("+"), ord("=")):
            self.up_days = min(365, self.up_days + 30); self._load_upcoming()
        elif key == ord("-"):
            self.up_days = max(7, self.up_days - 30); self._load_upcoming()

    def _up_mark(self, status: str):
        if not self.up_occs or self.up_idx >= len(self.up_occs): return
        occ = self.up_occs[self.up_idx]
        try:
            self.api.patch(f"/occurrences/{occ['id']}", {"status": status})
            self._load_upcoming()
            self.msg = f"Marked '{(occ.get('event') or {}).get('title', '')}' as {status}"
        except APIError as e:
            self.msg = str(e); self.msg_err = True

    def _up_make_task(self):
        if not self.up_occs or self.up_idx >= len(self.up_occs): return
        occ = self.up_occs[self.up_idx]
        try:
            self.api.post(f"/occurrences/{occ['id']}/task")
            self.msg = f"Task created from '{(occ.get('event') or {}).get('title', '')}'"
        except APIError as e:
            self.msg = str(e); self.msg_err = True

    def _up_cycle_filter(self):
        options = ["upcoming,overdue", "upcoming", "overdue", "completed", ""]
        idx = options.index(self.up_status) if self.up_status in options else 0
        self.up_status  = options[(idx + 1) % len(options)]
        self.up_idx     = self.up_scroll = 0
        self._load_upcoming()

    # ── Tasks keys ────────────────────────────────────────────────────────────

    def _key_tasks(self, key: int):
        filtered     = self._task_filtered()
        display_rows = self._task_display_rows(filtered)
        n            = len(display_rows)
        max_rows     = curses.LINES - 5

        if key == curses.KEY_UP and self.task_cursor > 0:
            self.task_cursor -= 1
            if self.task_cursor < self.task_scroll: self.task_scroll = self.task_cursor
        elif key == curses.KEY_DOWN and self.task_cursor < n - 1:
            self.task_cursor += 1
            if self.task_cursor >= self.task_scroll + max_rows:
                self.task_scroll = self.task_cursor - max_rows + 1
        elif key in (curses.KEY_ENTER, ord("\n"), ord("\r")):
            if display_rows and self.task_cursor < n:
                item = display_rows[self.task_cursor]
                if item["type"] == "task":
                    tid = item["data"]["id"]
                    if tid in self.task_expanded: self.task_expanded.discard(tid)
                    elif item["data"].get("subtasks"): self.task_expanded.add(tid)
        elif key in (ord("d"), ord("D")): self._task_set_status("done", display_rows)
        elif key in (ord("i"), ord("I")): self._task_set_status("in_progress", display_rows)
        elif key in (ord("o"), ord("O")): self._task_set_status("todo", display_rows)
        elif key in (ord("c"), ord("C")): self._task_set_status("cancelled", display_rows)
        elif key in (ord("n"), ord("N")): self._task_new()
        elif key in (curses.KEY_DC, ord("x"), ord("X")): self._task_delete(display_rows)
        elif key in (ord("h"), ord("H")):
            self.task_show_done = not self.task_show_done
            self.task_cursor = self.task_scroll = 0

    def _task_set_status(self, status: str, display_rows: List[Dict]):
        if not display_rows or self.task_cursor >= len(display_rows): return
        item = display_rows[self.task_cursor]
        try:
            if item["type"] == "task":
                t = item["data"]
                self.api.patch(f"/tasks/{t['id']}", {"status": status})
                self._load_tasks()
                self.msg = f"'{t['title']}' → {status}"
            elif item["type"] == "subtask":
                sub    = item["data"]
                parent = item["parent"]
                self.api.patch(f"/tasks/{parent['id']}/subtasks/{sub['id']}", {"status": status})
                self._load_tasks()
                self.msg = f"Subtask '{sub['title']}' → {status}"
        except APIError as e:
            self.msg = str(e); self.msg_err = True

    def _task_delete(self, display_rows: List[Dict]):
        if not display_rows or self.task_cursor >= len(display_rows): return
        item = display_rows[self.task_cursor]
        try:
            if item["type"] == "task":
                t = item["data"]
                if not self._confirm(f"Delete task '{t['title']}'?"): return
                self.api.delete(f"/tasks/{t['id']}")
                self.task_cursor = max(0, self.task_cursor - 1)
                self._load_tasks()
                self.msg = f"Deleted '{t['title']}'"
            elif item["type"] == "subtask":
                sub    = item["data"]
                parent = item["parent"]
                if not self._confirm(f"Delete subtask '{sub['title']}'?"): return
                self.api.delete(f"/tasks/{parent['id']}/subtasks/{sub['id']}")
                self.task_cursor = max(0, self.task_cursor - 1)
                self._load_tasks()
                self.msg = f"Deleted subtask '{sub['title']}'"
        except APIError as e:
            self.msg = str(e); self.msg_err = True

    def _task_new(self):
        title = self._prompt("New task title: ")
        if not title:
            self.msg = "Cancelled."
            return
        today_str = date.today().isoformat()
        priority  = self._prompt("Priority (low/medium/high) [medium]: ").lower() or "medium"
        if priority not in ("low", "medium", "high"): priority = "medium"
        due = self._prompt(f"Due date (YYYY-MM-DD) [{today_str}]: ").strip() or today_str
        try:
            self.api.post("/tasks", {"title": title, "priority": priority,
                                     "due_date": due, "recurrence": "none"})
            self._load_tasks()
            self.msg = f"Created task '{title}'"
        except APIError as e:
            self.msg = str(e); self.msg_err = True

    # ── Prompts ───────────────────────────────────────────────────────────────

    def _prompt(self, prompt_text: str) -> str:
        H, W = self.scr.getmaxyx()
        prompt_text = trunc(prompt_text, W - 2)
        curses.echo()
        curses.curs_set(1)
        self._fill(H - 1, 0, W, curses.color_pair(C_STATUS) | curses.A_BOLD)
        self._put(H - 1, 0, prompt_text, curses.color_pair(C_STATUS) | curses.A_BOLD)
        self.scr.refresh()
        try:
            raw = self.scr.getstr(H - 1, len(prompt_text), W - len(prompt_text) - 1)
            return (raw or b"").decode("utf-8", errors="replace").strip()
        except Exception:
            return ""
        finally:
            curses.noecho()
            curses.curs_set(0)

    def _confirm(self, question: str) -> bool:
        return self._prompt(f"{question} [y/N]: ").lower() in ("y", "yes")

    # ── Data loading ──────────────────────────────────────────────────────────

    def _load_tab(self):
        if self.tab == 0:   self._load_calendar()
        elif self.tab == 1: self._load_upcoming()
        elif self.tab == 2: self._load_cards()
        elif self.tab == 3: self._load_tasks()

    def _load_calendar(self):
        try:
            start = date(self.cal_year, self.cal_month, 1)
            last  = calendar.monthrange(self.cal_year, self.cal_month)[1]
            end   = date(self.cal_year, self.cal_month, last)
            self.cal_occs = self.api.get("/occurrences", params={
                "start_date": start.isoformat(), "end_date": end.isoformat(), "limit": 500,
            })
            if not self.cal_cats:
                self.cal_cats = self.api.get("/categories")
        except APIError as e:
            self.msg = str(e); self.msg_err = True

    def _load_upcoming(self):
        try:
            today = date.today()
            end   = today + timedelta(days=self.up_days)
            data  = self.api.get("/occurrences", params={
                "start_date": today.isoformat(), "end_date": end.isoformat(), "limit": 500,
            })
            statuses  = [s for s in self.up_status.split(",") if s]
            self.up_occs = [o for o in data if not statuses or o.get("status") in statuses]
            self.up_idx  = min(self.up_idx, max(0, len(self.up_occs) - 1))
        except APIError as e:
            self.msg = str(e); self.msg_err = True

    def _load_cards(self):
        try:
            self.cards = self.api.get("/credit-cards/tracker")
        except APIError as e:
            self.msg = str(e); self.msg_err = True

    def _load_tasks(self):
        try:
            self.tasks = self.api.get("/tasks", params={"limit": 500})
            display    = self._task_display_rows(self._task_filtered())
            self.task_cursor = min(self.task_cursor, max(0, len(display) - 1))
            self.task_scroll = min(self.task_scroll, max(0, self.task_cursor))
        except APIError as e:
            self.msg = str(e); self.msg_err = True


# ── Entry point ───────────────────────────────────────────────────────────────

def _curses_main(stdscr: "curses.window", db: DB):
    app = App(stdscr, db)
    app.draw()
    while True:
        key = stdscr.getch()
        if key == curses.KEY_RESIZE:
            app.draw()
            continue
        if not app.handle_key(key):
            break
        app.draw()


def main():
    parser = argparse.ArgumentParser(
        description="Calendar App — Terminal UI (direct PostgreSQL)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--db-host",     default="postgresql.bhenning.com",
                        help="DB host (default: postgresql.bhenning.com)")
    parser.add_argument("--db-port",     type=int, default=5432)
    parser.add_argument("--db-name",     default="calendar_db")
    parser.add_argument("--db-user",     default=None,
                        help="DB username (default: gopass or PGUSER env)")
    parser.add_argument("--db-password", default=None,
                        help="DB password (default: gopass or PGPASSWORD env)")
    args = parser.parse_args()

    # Resolve credentials: arg → env → gopass
    user = (args.db_user
            or os.environ.get("PGUSER")
            or _gopass("postgresql.bhenning.com/username"))
    password = (args.db_password
                or os.environ.get("PGPASSWORD")
                or _gopass("postgresql.bhenning.com/password"))

    if not user or not password:
        print("Could not determine DB credentials. "
              "Set --db-user/--db-password, PGUSER/PGPASSWORD, or configure gopass.",
              file=sys.stderr)
        sys.exit(1)

    try:
        conn = psycopg2.connect(
            host=args.db_host,
            port=args.db_port,
            dbname=args.db_name,
            user=user,
            password=password,
            connect_timeout=10,
            options="-c TimeZone=America/Chicago",
        )
        conn.autocommit = True
    except psycopg2.OperationalError as e:
        print(f"Cannot connect to database: {e}", file=sys.stderr)
        sys.exit(1)

    db = DB(conn)
    try:
        curses.wrapper(_curses_main, db)
    except KeyboardInterrupt:
        pass
    finally:
        conn.close()


if __name__ == "__main__":
    main()
