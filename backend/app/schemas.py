from __future__ import annotations
from datetime import date, datetime
from decimal import Decimal
from typing import Optional
from pydantic import BaseModel, field_validator
from .models import Priority, OccurrenceStatus, WeekendShift


# ── Category ────────────────────────────────────────────────────────────────

class CategoryBase(BaseModel):
    name: str
    color: str = "#3b82f6"
    icon: str = "📅"
    description: Optional[str] = None


class CategoryCreate(CategoryBase):
    pass


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    icon: Optional[str] = None
    description: Optional[str] = None


class CategoryOut(CategoryBase):
    id: int

    model_config = {"from_attributes": True}


# ── Event ───────────────────────────────────────────────────────────────────

class EventBase(BaseModel):
    title: str
    category_id: int
    rrule: Optional[str] = None          # None → one-time
    dtstart: date
    dtend_rule: Optional[date] = None
    duration_days: int = 1
    description: Optional[str] = None
    location: Optional[str] = None
    reminder_days: list[int] = [7, 1]
    priority: Priority = Priority.medium
    amount: Optional[Decimal] = None
    is_active: bool = True
    gcal_calendar_id: Optional[str] = None

    @field_validator("rrule")
    @classmethod
    def normalize_rrule(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        # Strip leading RRULE: prefix so we store a clean rule string
        if v.upper().startswith("RRULE:"):
            v = v[6:]
        return v


class EventCreate(EventBase):
    pass


class EventUpdate(BaseModel):
    title: Optional[str] = None
    category_id: Optional[int] = None
    rrule: Optional[str] = None
    dtstart: Optional[date] = None
    dtend_rule: Optional[date] = None
    duration_days: Optional[int] = None
    description: Optional[str] = None
    location: Optional[str] = None
    reminder_days: Optional[list[int]] = None
    priority: Optional[Priority] = None
    amount: Optional[Decimal] = None
    is_active: Optional[bool] = None
    gcal_calendar_id: Optional[str] = None

    @field_validator("rrule")
    @classmethod
    def normalize_rrule(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if v.upper().startswith("RRULE:"):
            v = v[6:]
        return v


class EventOut(EventBase):
    id: int
    created_at: datetime
    updated_at: datetime
    category: CategoryOut

    model_config = {"from_attributes": True}


class EventWithOccurrences(EventOut):
    occurrences: list[OccurrenceOut] = []

    model_config = {"from_attributes": True}


# ── Occurrence ───────────────────────────────────────────────────────────────

class OccurrenceBase(BaseModel):
    occurrence_date: date
    status: OccurrenceStatus = OccurrenceStatus.upcoming
    notes: Optional[str] = None


class OccurrenceUpdate(BaseModel):
    status: Optional[OccurrenceStatus] = None
    notes: Optional[str] = None


class OccurrenceOut(OccurrenceBase):
    id: int
    event_id: int
    gcal_event_id: Optional[str] = None
    synced_at: Optional[datetime] = None
    created_at: datetime
    event: Optional[EventOut] = None

    model_config = {"from_attributes": True}


# Resolve forward references
EventWithOccurrences.model_rebuild()


# ── Credit Card ──────────────────────────────────────────────────────────────

class CreditCardBase(BaseModel):
    name: str
    issuer: Optional[str] = None
    last_four: Optional[str] = None
    statement_close_day: Optional[int] = None
    grace_period_days: Optional[int] = None
    weekend_shift: Optional[WeekendShift] = None
    cycle_days: Optional[int] = None
    cycle_reference_date: Optional[date] = None
    due_day_same_month: Optional[int] = None
    due_day_next_month: Optional[int] = None
    annual_fee_month: Optional[int] = None
    is_active: bool = True


class CreditCardCreate(CreditCardBase):
    pass


class CreditCardUpdate(BaseModel):
    name: Optional[str] = None
    issuer: Optional[str] = None
    last_four: Optional[str] = None
    statement_close_day: Optional[int] = None
    grace_period_days: Optional[int] = None
    weekend_shift: Optional[WeekendShift] = None
    cycle_days: Optional[int] = None
    cycle_reference_date: Optional[date] = None
    due_day_same_month: Optional[int] = None
    due_day_next_month: Optional[int] = None
    annual_fee_month: Optional[int] = None
    is_active: Optional[bool] = None


class CreditCardOut(CreditCardBase):
    id: int
    created_at: datetime

    model_config = {"from_attributes": True}


class CreditCardTrackerRow(BaseModel):
    id: int
    name: str
    issuer: Optional[str]
    last_four: Optional[str]
    grace: str
    prev_close: str
    prev_due: str
    next_close: str
    next_close_days: int
    next_due: str
    next_due_days: int
    annual_fee_date: Optional[str]
    annual_fee_days: Optional[int]
    prev_due_overdue: bool


# ── Sync / Misc ──────────────────────────────────────────────────────────────

class GenerateResult(BaseModel):
    events_processed: int
    occurrences_created: int


class SyncResult(BaseModel):
    synced: int
    failed: int
    errors: list[str] = []
    message: Optional[str] = None


class AuthStatus(BaseModel):
    authenticated: bool
    email: Optional[str] = None
