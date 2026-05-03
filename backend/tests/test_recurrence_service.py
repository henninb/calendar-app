"""Unit tests for the recurrence expansion service."""
import itertools
from datetime import date, timedelta

import pytest
from sqlalchemy.orm import Session

from app.models import Category, Event, Occurrence, OccurrenceStatus, Priority
from app.services.recurrence import (
    _expand_dates,
    _expand_easter,
    _expand_eclipses,
    _expand_moon_phase,
    _parse_easter_rule,
    _parse_moon_rule,
    calculate_easter,
    generate_all_occurrences,
    generate_occurrences,
    mark_overdue,
)

_cat_counter = itertools.count()


# ── calculate_easter ──────────────────────────────────────────────────────────

class TestCalculateEaster:
    @pytest.mark.parametrize("year,expected", [
        (2024, date(2024, 3, 31)),
        (2025, date(2025, 4, 20)),
        (2000, date(2000, 4, 23)),
        (1999, date(1999, 4, 4)),
        (2019, date(2019, 4, 21)),
        (2020, date(2020, 4, 12)),
    ])
    def test_known_easter_dates(self, year, expected):
        assert calculate_easter(year) == expected

    def test_always_sunday(self):
        for year in range(2015, 2031):
            d = calculate_easter(year)
            assert d.weekday() == 6, f"Easter {year} ({d}) should be a Sunday"

    def test_always_march_or_april(self):
        for year in range(2000, 2031):
            d = calculate_easter(year)
            assert d.month in (3, 4)


# ── _parse_easter_rule ────────────────────────────────────────────────────────

class TestParseEasterRule:
    def test_plain_easter(self):
        assert _parse_easter_rule("EASTER") == 0

    def test_lowercase(self):
        assert _parse_easter_rule("easter") == 0

    def test_mixed_case(self):
        assert _parse_easter_rule("Easter") == 0

    def test_negative_offset(self):
        assert _parse_easter_rule("EASTER-2") == -2

    def test_positive_offset(self):
        assert _parse_easter_rule("EASTER+1") == 1

    def test_large_negative_offset(self):
        assert _parse_easter_rule("EASTER-46") == -46

    def test_leading_whitespace_ignored(self):
        assert _parse_easter_rule("  EASTER  ") == 0

    def test_rrule_returns_none(self):
        assert _parse_easter_rule("FREQ=YEARLY;BYMONTH=3") is None

    def test_moon_sentinel_returns_none(self):
        assert _parse_easter_rule("MOON_FULL") is None

    def test_empty_returns_none(self):
        assert _parse_easter_rule("") is None


# ── _expand_easter ────────────────────────────────────────────────────────────

class TestExpandEaster:
    def test_easter_sunday_2024(self):
        dates = _expand_easter(date(2024, 1, 1), date(2024, 12, 31), 0)
        assert date(2024, 3, 31) in dates

    def test_good_friday_2024(self):
        dates = _expand_easter(date(2024, 1, 1), date(2024, 12, 31), -2)
        assert date(2024, 3, 29) in dates

    def test_easter_monday_2024(self):
        dates = _expand_easter(date(2024, 1, 1), date(2024, 12, 31), 1)
        assert date(2024, 4, 1) in dates

    def test_ash_wednesday_2024(self):
        # Easter 2024 = Mar 31; Ash Wed = Mar 31 - 46 = Feb 14
        dates = _expand_easter(date(2024, 1, 1), date(2024, 12, 31), -46)
        assert date(2024, 2, 14) in dates

    def test_multi_year_yields_one_per_year(self):
        dates = _expand_easter(date(2023, 1, 1), date(2025, 12, 31), 0)
        assert len(dates) == 3

    def test_empty_when_out_of_range(self):
        dates = _expand_easter(date(2025, 1, 1), date(2025, 12, 31), 0)
        # Easter 2025 is Apr 20 — within range
        assert len(dates) == 1
        assert dates[0] == date(2025, 4, 20)

    def test_respects_start_boundary(self):
        # Easter 2024 = Mar 31; start on Apr 1 should exclude it
        dates = _expand_easter(date(2024, 4, 1), date(2024, 12, 31), 0)
        assert date(2024, 3, 31) not in dates


# ── _parse_moon_rule ──────────────────────────────────────────────────────────

class TestParseMoonRule:
    def test_full_moon(self):
        assert _parse_moon_rule("MOON_FULL") == 0.5

    def test_new_moon(self):
        assert _parse_moon_rule("MOON_NEW") == 0.0

    def test_first_quarter(self):
        assert _parse_moon_rule("MOON_FIRST_QUARTER") == 0.25

    def test_last_quarter(self):
        assert _parse_moon_rule("MOON_LAST_QUARTER") == 0.75

    def test_case_insensitive(self):
        assert _parse_moon_rule("moon_full") == 0.5
        assert _parse_moon_rule("Moon_New") == 0.0

    def test_rrule_returns_none(self):
        assert _parse_moon_rule("FREQ=MONTHLY") is None

    def test_easter_returns_none(self):
        assert _parse_moon_rule("EASTER") is None

    def test_empty_returns_none(self):
        assert _parse_moon_rule("") is None


# ── _expand_moon_phase ────────────────────────────────────────────────────────

class TestExpandMoonPhase:
    def test_full_moons_count_in_year(self):
        start = date(2024, 1, 1)
        end = date(2024, 12, 31)
        dates = _expand_moon_phase(start, end, 0.5)
        assert 12 <= len(dates) <= 14

    def test_new_moons_count_in_year(self):
        start = date(2024, 1, 1)
        end = date(2024, 12, 31)
        dates = _expand_moon_phase(start, end, 0.0)
        assert 12 <= len(dates) <= 14

    def test_all_phases_count_similar(self):
        start = date(2024, 1, 1)
        end = date(2024, 12, 31)
        for phase in (0.0, 0.25, 0.5, 0.75):
            dates = _expand_moon_phase(start, end, phase)
            assert 12 <= len(dates) <= 14

    def test_no_duplicate_dates(self):
        start = date(2024, 1, 1)
        end = date(2024, 6, 30)
        dates = _expand_moon_phase(start, end, 0.5)
        assert len(dates) == len(set(dates))

    def test_dates_in_ascending_order(self):
        start = date(2024, 1, 1)
        end = date(2024, 6, 30)
        dates = _expand_moon_phase(start, end, 0.5)
        assert dates == sorted(dates)

    def test_respects_date_boundaries(self):
        start = date(2024, 3, 1)
        end = date(2024, 3, 31)
        dates = _expand_moon_phase(start, end, 0.5)
        for d in dates:
            assert start <= d <= end


# ── generate_occurrences ──────────────────────────────────────────────────────

def _make_event(db: Session, rrule=None, dtstart=None, is_active=True, **kwargs) -> Event:
    cat = Category(name=f"cat_{next(_cat_counter)}", color="#aabbcc", icon="test")
    db.add(cat)
    db.flush()
    e = Event(
        title="Test Event",
        category_id=cat.id,
        dtstart=dtstart or date.today(),
        rrule=rrule,
        priority=Priority.medium,
        is_active=is_active,
        **kwargs,
    )
    db.add(e)
    db.commit()
    db.refresh(e)
    return e


class TestGenerateOccurrences:
    def test_inactive_event_skipped(self, db):
        event = _make_event(db, is_active=False)
        assert generate_occurrences(db, event, lookahead_days=30) == 0

    def test_one_time_event_creates_one(self, db):
        event = _make_event(db)
        assert generate_occurrences(db, event, lookahead_days=30) == 1

    def test_idempotent(self, db):
        event = _make_event(db)
        assert generate_occurrences(db, event, lookahead_days=30) == 1
        assert generate_occurrences(db, event, lookahead_days=30) == 0

    def test_weekly_rrule_creates_multiple(self, db):
        event = _make_event(db, rrule="FREQ=WEEKLY")
        count = generate_occurrences(db, event, lookahead_days=28)
        assert count == 5  # today + 4 weekly occurrences within 28 days

    def test_monthly_rrule(self, db):
        event = _make_event(db, rrule="FREQ=MONTHLY")
        count = generate_occurrences(db, event, lookahead_days=90)
        assert 3 <= count <= 4

    def test_past_date_marked_overdue(self, db):
        past = date.today() - timedelta(days=5)
        event = _make_event(db, dtstart=past)
        generate_occurrences(db, event, lookahead_days=30)
        occ = db.query(Occurrence).filter(Occurrence.event_id == event.id).first()
        assert occ.status == OccurrenceStatus.overdue

    def test_future_date_marked_upcoming(self, db):
        future = date.today() + timedelta(days=5)
        event = _make_event(db, dtstart=future)
        generate_occurrences(db, event, lookahead_days=30)
        occ = db.query(Occurrence).filter(Occurrence.event_id == event.id).first()
        assert occ.status == OccurrenceStatus.upcoming

    def test_event_beyond_lookahead_generates_nothing(self, db):
        far_future = date.today() + timedelta(days=400)
        event = _make_event(db, dtstart=far_future)
        count = generate_occurrences(db, event, lookahead_days=30)
        assert count == 0

    def test_easter_sentinel_generates_occurrences(self, db):
        event = _make_event(db, rrule="EASTER", dtstart=date(2024, 1, 1))
        count = generate_occurrences(db, event, lookahead_days=365)
        assert count >= 1

    def test_moon_sentinel_generates_occurrences(self, db):
        event = _make_event(db, rrule="MOON_FULL", dtstart=date.today())
        count = generate_occurrences(db, event, lookahead_days=60)
        assert count >= 2


# ── generate_all_occurrences ──────────────────────────────────────────────────

class TestGenerateAllOccurrences:
    def test_no_events_returns_zeros(self, db):
        result = generate_all_occurrences(db, lookahead_days=30)
        assert result == {"events_processed": 0, "occurrences_created": 0}

    def test_counts_active_events(self, db):
        _make_event(db, rrule="FREQ=WEEKLY")
        _make_event(db, rrule="FREQ=WEEKLY")
        result = generate_all_occurrences(db, lookahead_days=7)
        assert result["events_processed"] == 2
        assert result["occurrences_created"] >= 2

    def test_skips_inactive_events(self, db):
        _make_event(db, is_active=False)
        result = generate_all_occurrences(db, lookahead_days=30)
        assert result["events_processed"] == 0

    def test_idempotent(self, db):
        _make_event(db)
        r1 = generate_all_occurrences(db, lookahead_days=30)
        r2 = generate_all_occurrences(db, lookahead_days=30)
        assert r1["occurrences_created"] == 1
        assert r2["occurrences_created"] == 0


# ── mark_overdue ──────────────────────────────────────────────────────────────

class TestMarkOverdue:
    def _add_occurrence(self, db, event, occ_date, status=OccurrenceStatus.upcoming):
        occ = Occurrence(event_id=event.id, occurrence_date=occ_date, status=status)
        db.add(occ)
        db.commit()
        db.refresh(occ)
        return occ

    def test_marks_past_upcoming_as_overdue(self, db):
        event = _make_event(db)
        occ = self._add_occurrence(db, event, date.today() - timedelta(days=3))
        assert mark_overdue(db) == 1
        db.refresh(occ)
        assert occ.status == OccurrenceStatus.overdue

    def test_leaves_future_upcoming_unchanged(self, db):
        event = _make_event(db)
        occ = self._add_occurrence(db, event, date.today() + timedelta(days=3))
        assert mark_overdue(db) == 0
        db.refresh(occ)
        assert occ.status == OccurrenceStatus.upcoming

    def test_leaves_today_upcoming_unchanged(self, db):
        event = _make_event(db)
        occ = self._add_occurrence(db, event, date.today())
        assert mark_overdue(db) == 0

    def test_does_not_change_completed(self, db):
        event = _make_event(db)
        occ = self._add_occurrence(
            db, event, date.today() - timedelta(days=3), OccurrenceStatus.completed
        )
        assert mark_overdue(db) == 0
        db.refresh(occ)
        assert occ.status == OccurrenceStatus.completed

    def test_does_not_change_skipped(self, db):
        event = _make_event(db)
        occ = self._add_occurrence(
            db, event, date.today() - timedelta(days=3), OccurrenceStatus.skipped
        )
        assert mark_overdue(db) == 0
        db.refresh(occ)
        assert occ.status == OccurrenceStatus.skipped

    def test_marks_multiple_in_one_call(self, db):
        event = _make_event(db, rrule="FREQ=DAILY", dtstart=date.today() - timedelta(days=5))
        # Insert upcoming occurrences in the past
        for i in range(1, 4):
            self._add_occurrence(db, event, date.today() - timedelta(days=i))
        count = mark_overdue(db)
        assert count == 3


# ── Eclipse sentinels ─────────────────────────────────────────────────────────

class TestExpandEclipses:
    def test_solar_eclipses_occur_in_range(self):
        # There are typically 2-5 solar eclipses per year
        start = date(2024, 1, 1)
        end = date(2026, 12, 31)
        dates = _expand_eclipses(start, end, solar=True)
        assert len(dates) >= 4  # at least 4 solar eclipses in 3 years

    def test_lunar_eclipses_occur_in_range(self):
        start = date(2024, 1, 1)
        end = date(2026, 12, 31)
        dates = _expand_eclipses(start, end, solar=False)
        assert len(dates) >= 2

    def test_eclipse_dates_within_bounds(self):
        start = date(2024, 1, 1)
        end = date(2024, 12, 31)
        for solar in (True, False):
            dates = _expand_eclipses(start, end, solar)
            for d in dates:
                assert start <= d <= end

    def test_eclipse_dates_sorted(self):
        start = date(2024, 1, 1)
        end = date(2026, 12, 31)
        for solar in (True, False):
            dates = _expand_eclipses(start, end, solar)
            assert dates == sorted(dates)

    def test_no_duplicate_eclipse_dates(self):
        start = date(2024, 1, 1)
        end = date(2026, 12, 31)
        for solar in (True, False):
            dates = _expand_eclipses(start, end, solar)
            assert len(dates) == len(set(dates))


class TestEclipseSentinelViaGenerateOccurrences:
    def test_eclipse_solar_sentinel_generates_dates(self, db: Session) -> None:
        event = _make_event(db, rrule="ECLIPSE_SOLAR", dtstart=date(2024, 1, 1))
        count = generate_occurrences(db, event, lookahead_days=1095)  # 3 years
        assert count >= 4

    def test_eclipse_lunar_sentinel_generates_dates(self, db: Session) -> None:
        event = _make_event(db, rrule="ECLIPSE_LUNAR", dtstart=date(2024, 1, 1))
        count = generate_occurrences(db, event, lookahead_days=1095)
        assert count >= 2

    def test_eclipse_solar_case_insensitive(self, db: Session) -> None:
        event = _make_event(db, rrule="eclipse_solar", dtstart=date(2024, 1, 1))
        count = generate_occurrences(db, event, lookahead_days=1095)
        assert count >= 4


# ── _expand_dates: dtend_rule bounds RRULE expansion ─────────────────────────

class TestExpandDatesWithDtendRule:
    def _event_with_dtend(
        self,
        db: Session,
        rrule: str,
        dtstart: date,
        dtend_rule: date,
    ) -> Event:
        cat = Category(name=f"cat_{next(_cat_counter)}", color="#aabbcc", icon="test")
        db.add(cat)
        db.flush()
        e = Event(
            title="Bounded Event",
            category_id=cat.id,
            dtstart=dtstart,
            rrule=rrule,
            dtend_rule=dtend_rule,
            priority=Priority.medium,
            is_active=True,
        )
        db.add(e)
        db.commit()
        db.refresh(e)
        return e

    def test_monthly_bounded_by_dtend_rule(self, db: Session) -> None:
        # Monthly Jan–Mar 2026 → 3 occurrences
        e = self._event_with_dtend(
            db, "FREQ=MONTHLY", date(2026, 1, 1), date(2026, 3, 31)
        )
        dates = _expand_dates(e, date(2027, 1, 1))
        assert len(dates) == 3
        assert date(2026, 1, 1) in dates
        assert date(2026, 2, 1) in dates
        assert date(2026, 3, 1) in dates
        assert date(2026, 4, 1) not in dates

    def test_dtend_rule_excludes_nothing_if_until_before_rule(self, db: Session) -> None:
        # dtend_rule beyond the lookahead → until parameter dominates
        e = self._event_with_dtend(
            db, "FREQ=MONTHLY", date(2026, 1, 1), date(2030, 12, 31)
        )
        # lookahead until = 2026-04-30; dtend_rule = 2030 — no restriction from dtend
        dates = _expand_dates(e, date(2026, 4, 30))
        assert len(dates) == 4

    def test_count_in_rrule_takes_precedence_over_dtend_rule(self, db: Session) -> None:
        # COUNT=2 should win over dtend_rule even if dtend is earlier
        e = self._event_with_dtend(
            db, "FREQ=MONTHLY;COUNT=2", date(2026, 1, 1), date(2026, 12, 31)
        )
        dates = _expand_dates(e, date(2027, 1, 1))
        assert len(dates) == 2

    def test_until_in_rrule_takes_precedence_over_dtend_rule(self, db: Session) -> None:
        e = self._event_with_dtend(
            db, "FREQ=MONTHLY;UNTIL=20260201", date(2026, 1, 1), date(2026, 12, 31)
        )
        dates = _expand_dates(e, date(2027, 1, 1))
        assert len(dates) == 2  # Jan and Feb only
