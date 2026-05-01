from __future__ import annotations
from datetime import date, datetime
from decimal import Decimal
from pydantic import BaseModel, EmailStr, Field, field_validator
from .models import (
    Priority, OccurrenceStatus, TaskRecurrence, TaskStatus, WeekendShift,
    GroceryUnit, GroceryListStatus, GroceryListItemStatus,
)


def _normalize_rrule(v: str | None) -> str | None:
    if v is None:
        return v
    v = v.strip()
    if v.upper().startswith("RRULE:"):
        v = v[6:]
    return v


# ── Category ────────────────────────────────────────────────────────────────

class CategoryBase(BaseModel):
    name: str = Field(..., max_length=50)
    color: str = Field("#3b82f6", pattern=r'^#[0-9a-fA-F]{6}$')
    icon: str = Field("📅", max_length=10)
    description: str | None = Field(None, max_length=1000)


class CategoryCreate(CategoryBase):
    pass


class CategoryUpdate(BaseModel):
    name: str | None = Field(None, max_length=50)
    color: str | None = Field(None, pattern=r'^#[0-9a-fA-F]{6}$')
    icon: str | None = Field(None, max_length=10)
    description: str | None = Field(None, max_length=1000)


class CategoryOut(CategoryBase):
    id: int

    model_config = {"from_attributes": True}


# ── Event ───────────────────────────────────────────────────────────────────

class EventBase(BaseModel):
    title: str = Field(..., max_length=255)
    category_id: int
    rrule: str | None = Field(None, max_length=500)   # None → one-time
    dtstart: date
    dtend_rule: date | None = None
    duration_days: int = Field(1, ge=1)
    description: str | None = Field(None, max_length=4096)
    location: str | None = Field(None, max_length=512)
    reminder_days: list[int] = Field(default_factory=lambda: [7, 1])
    priority: Priority = Priority.medium
    amount: Decimal | None = None
    is_active: bool = True
    generates_tasks: bool = False
    gcal_calendar_id: str | None = Field(None, max_length=255)

    @field_validator("rrule")
    @classmethod
    def normalize_rrule(cls, v: str | None) -> str | None:
        return _normalize_rrule(v)


class EventCreate(EventBase):
    pass


class EventUpdate(BaseModel):
    title: str | None = Field(None, max_length=255)
    category_id: int | None = None
    rrule: str | None = Field(None, max_length=500)
    dtstart: date | None = None
    dtend_rule: date | None = None
    duration_days: int | None = None
    description: str | None = Field(None, max_length=4096)
    location: str | None = Field(None, max_length=512)
    reminder_days: list[int] | None = None
    priority: Priority | None = None
    amount: Decimal | None = None
    is_active: bool | None = None
    generates_tasks: bool | None = None
    gcal_calendar_id: str | None = Field(None, max_length=255)

    @field_validator("rrule")
    @classmethod
    def normalize_rrule(cls, v: str | None) -> str | None:
        return _normalize_rrule(v)


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
    notes: str | None = Field(None, max_length=2000)


class OccurrenceUpdate(BaseModel):
    status: OccurrenceStatus | None = None
    notes: str | None = Field(None, max_length=2000)


class OccurrenceOut(OccurrenceBase):
    id: int
    event_id: int
    gcal_event_id: str | None = None
    synced_at: datetime | None = None
    created_at: datetime
    event: EventOut | None = None

    model_config = {"from_attributes": True}


# Resolve forward references
EventWithOccurrences.model_rebuild()


# ── Credit Card ──────────────────────────────────────────────────────────────

class CreditCardBase(BaseModel):
    name: str
    issuer: str | None = None
    last_four: str | None = Field(None, pattern=r'^\d{4}$')
    statement_close_day: int | None = Field(None, ge=1, le=31)
    grace_period_days: int | None = Field(None, ge=0)
    weekend_shift: WeekendShift | None = None
    cycle_days: int | None = None
    cycle_reference_date: date | None = None
    due_day_same_month: int | None = Field(None, ge=1, le=31)
    due_day_next_month: int | None = Field(None, ge=1, le=31)
    annual_fee_month: int | None = Field(None, ge=1, le=12)
    is_active: bool = True

    @field_validator('is_active', mode='before')
    @classmethod
    def coerce_is_active(cls, v: bool | None) -> bool:
        return True if v is None else v


class CreditCardCreate(CreditCardBase):
    pass


class CreditCardUpdate(BaseModel):
    name: str | None = None
    issuer: str | None = None
    last_four: str | None = Field(None, pattern=r'^\d{4}$')
    statement_close_day: int | None = Field(None, ge=1, le=31)
    grace_period_days: int | None = Field(None, ge=0)
    weekend_shift: WeekendShift | None = None
    cycle_days: int | None = None
    cycle_reference_date: date | None = None
    due_day_same_month: int | None = Field(None, ge=1, le=31)
    due_day_next_month: int | None = Field(None, ge=1, le=31)
    annual_fee_month: int | None = Field(None, ge=1, le=12)
    is_active: bool | None = None


class CreditCardOut(CreditCardBase):
    id: int
    created_at: datetime | None = None
    last_four: str | None = None  # no pattern constraint — existing data may not be 4 digits

    model_config = {"from_attributes": True}


class CreditCardTrackerRow(BaseModel):
    id: int
    name: str
    issuer: str | None = None
    last_four: str | None = None
    grace: str
    prev_close: str
    prev_due: str
    next_close: str
    next_close_days: int
    next_due: str
    next_due_days: int
    annual_fee_date: str | None = None
    annual_fee_days: int | None = None
    prev_due_overdue: bool


# ── Sync / Misc ──────────────────────────────────────────────────────────────

class GenerateResult(BaseModel):
    events_processed: int
    occurrences_created: int


class SyncResult(BaseModel):
    synced: int
    failed: int
    errors: list[str] = []
    message: str | None = None


class AuthStatus(BaseModel):
    authenticated: bool
    email: str | None = None


# ── Person ───────────────────────────────────────────────────────────────────

class PersonBase(BaseModel):
    name: str = Field(..., max_length=255)
    email: EmailStr | None = None


class PersonCreate(PersonBase):
    pass


class PersonUpdate(BaseModel):
    name: str | None = Field(None, max_length=255)
    email: EmailStr | None = None


class PersonOut(PersonBase):
    id: int

    model_config = {"from_attributes": True}


# ── Subtask ──────────────────────────────────────────────────────────────────

class SubtaskBase(BaseModel):
    title: str = Field(..., max_length=255)
    status: TaskStatus = TaskStatus.todo
    due_date: date | None = None
    order: int = 0


class SubtaskCreate(SubtaskBase):
    pass


class SubtaskUpdate(BaseModel):
    title: str | None = Field(None, max_length=255)
    status: TaskStatus | None = None
    due_date: date | None = None
    order: int | None = None


class SubtaskOut(SubtaskBase):
    id: int
    task_id: int
    completed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Task ─────────────────────────────────────────────────────────────────────

class TaskBase(BaseModel):
    title: str = Field(..., max_length=255)
    description: str | None = Field(None, max_length=4096)
    status: TaskStatus = TaskStatus.todo
    priority: Priority = Priority.medium
    assignee_id: int | None = None
    category_id: int | None = None
    due_date: date | None = None
    estimated_minutes: int | None = None
    recurrence: TaskRecurrence = TaskRecurrence.none
    occurrence_id: int | None = None


class TaskCreate(TaskBase):
    pass


class TaskUpdate(BaseModel):
    title: str | None = Field(None, max_length=255)
    description: str | None = Field(None, max_length=4096)
    status: TaskStatus | None = None
    priority: Priority | None = None
    assignee_id: int | None = None
    category_id: int | None = None
    due_date: date | None = None
    estimated_minutes: int | None = None
    recurrence: TaskRecurrence | None = None
    order: int | None = None


class TaskOut(TaskBase):
    id: int
    order: int = 0
    gtask_id: str | None = None
    synced_at: datetime | None = None
    completed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    assignee: PersonOut | None = None
    category: CategoryOut | None = None
    subtasks: list[SubtaskOut] = []

    model_config = {"from_attributes": True}


# ── Store ─────────────────────────────────────────────────────────────────────

class StoreBase(BaseModel):
    name: str = Field(..., max_length=100)
    location: str | None = Field(None, max_length=200)
    is_active: bool = True


class StoreCreate(StoreBase):
    pass


class StoreUpdate(BaseModel):
    name: str | None = Field(None, max_length=100)
    location: str | None = Field(None, max_length=200)
    is_active: bool | None = None


class StoreOut(StoreBase):
    id: int
    created_at: datetime

    model_config = {"from_attributes": True}


# ── GroceryItem ───────────────────────────────────────────────────────────────

class GroceryItemBase(BaseModel):
    name: str = Field(..., max_length=200)
    default_unit: GroceryUnit = GroceryUnit.each
    default_store_id: int | None = None


class GroceryItemCreate(GroceryItemBase):
    pass


class GroceryItemUpdate(BaseModel):
    name: str | None = Field(None, max_length=200)
    default_unit: GroceryUnit | None = None
    default_store_id: int | None = None


class GroceryItemOut(GroceryItemBase):
    id: int
    created_at: datetime
    default_store: StoreOut | None = None

    model_config = {"from_attributes": True}


# ── OnHand ────────────────────────────────────────────────────────────────────

class OnHandUpsert(BaseModel):
    quantity: Decimal = Field(..., ge=0)
    unit: GroceryUnit


class OnHandOut(BaseModel):
    id: int
    item_id: int
    quantity: Decimal
    unit: GroceryUnit
    updated_at: datetime
    item: GroceryItemOut

    model_config = {"from_attributes": True}


# ── GroceryListItem ───────────────────────────────────────────────────────────

class GroceryListItemBase(BaseModel):
    item_id: int
    quantity: Decimal = Field(Decimal("1"), ge=0)
    unit: GroceryUnit = GroceryUnit.each
    price: Decimal | None = None
    status: GroceryListItemStatus = GroceryListItemStatus.needed
    notes: str | None = Field(None, max_length=1000)


class GroceryListItemCreate(GroceryListItemBase):
    pass


class GroceryListItemUpdate(BaseModel):
    quantity: Decimal | None = Field(None, ge=0)
    unit: GroceryUnit | None = None
    price: Decimal | None = None
    status: GroceryListItemStatus | None = None
    notes: str | None = Field(None, max_length=1000)


class GroceryListItemOut(GroceryListItemBase):
    id: int
    list_id: int
    created_at: datetime
    updated_at: datetime
    item: GroceryItemOut

    model_config = {"from_attributes": True}


# ── GroceryList ───────────────────────────────────────────────────────────────

class GroceryListBase(BaseModel):
    name: str = Field(..., max_length=200)
    store_id: int | None = None
    status: GroceryListStatus = GroceryListStatus.draft
    shopping_date: date | None = None


class GroceryListCreate(GroceryListBase):
    pass


class GroceryListUpdate(BaseModel):
    name: str | None = Field(None, max_length=200)
    store_id: int | None = None
    status: GroceryListStatus | None = None
    shopping_date: date | None = None


class GroceryListOut(GroceryListBase):
    id: int
    created_at: datetime
    updated_at: datetime
    store: StoreOut | None = None
    items: list[GroceryListItemOut] = []

    model_config = {"from_attributes": True}
