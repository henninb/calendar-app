"""Unit tests for the credit card billing calculation service."""
from datetime import date, timedelta

import pytest

from app.models import CreditCard, WeekendShift
from app.services.credit_card import (
    adjust_weekend,
    close_date_for_month,
    due_date_for_close,
    next_annual_fee_date,
    next_statement_close,
    previous_statement_close,
    tracker_row,
)


def _weekday_date(target_weekday: int, base: date = date(2024, 1, 1)) -> date:
    """Return the first date on or after `base` whose weekday() equals target_weekday."""
    d = base
    while d.weekday() != target_weekday:
        d += timedelta(days=1)
    return d


def _fixed_card(close_day: int = 15, weekend_shift=None, grace=21) -> CreditCard:
    c = CreditCard()
    c.name = "TestFixed"
    c.statement_close_day = close_day
    c.weekend_shift = weekend_shift
    c.cycle_days = None
    c.cycle_reference_date = None
    c.grace_period_days = grace
    c.due_day_same_month = None
    c.due_day_next_month = None
    c.annual_fee_month = None
    c.id = 1
    c.issuer = "TestBank"
    c.last_four = "1234"
    return c


def _rolling_card(cycle_days: int, ref_date: date, grace: int = 21) -> CreditCard:
    c = CreditCard()
    c.name = "TestRolling"
    c.statement_close_day = None
    c.weekend_shift = None
    c.cycle_days = cycle_days
    c.cycle_reference_date = ref_date
    c.grace_period_days = grace
    c.due_day_same_month = None
    c.due_day_next_month = None
    c.annual_fee_month = None
    c.id = 2
    c.issuer = "TestBank"
    c.last_four = "5678"
    return c


# ── adjust_weekend ─────────────────────────────────────────────────────────────

class TestAdjustWeekend:
    def test_weekday_unchanged_for_back(self):
        monday = _weekday_date(0)
        assert adjust_weekend(monday, WeekendShift.back) == monday

    def test_weekday_unchanged_for_forward(self):
        wednesday = _weekday_date(2)
        assert adjust_weekend(wednesday, WeekendShift.forward) == wednesday

    def test_back_shifts_saturday_to_friday(self):
        sat = _weekday_date(5)
        assert adjust_weekend(sat, WeekendShift.back) == sat - timedelta(days=1)

    def test_back_shifts_sunday_to_friday(self):
        sun = _weekday_date(6)
        assert adjust_weekend(sun, WeekendShift.back) == sun - timedelta(days=2)

    def test_forward_shifts_saturday_to_monday(self):
        sat = _weekday_date(5)
        assert adjust_weekend(sat, WeekendShift.forward) == sat + timedelta(days=2)

    def test_forward_shifts_sunday_to_monday(self):
        sun = _weekday_date(6)
        assert adjust_weekend(sun, WeekendShift.forward) == sun + timedelta(days=1)

    def test_back_sat_only_shifts_saturday_to_friday(self):
        sat = _weekday_date(5)
        assert adjust_weekend(sat, WeekendShift.back_sat_only) == sat - timedelta(days=1)

    def test_back_sat_only_leaves_sunday_unchanged(self):
        sun = _weekday_date(6)
        assert adjust_weekend(sun, WeekendShift.back_sat_only) == sun

    def test_nearest_shifts_saturday_to_friday(self):
        sat = _weekday_date(5)
        assert adjust_weekend(sat, WeekendShift.nearest) == sat - timedelta(days=1)

    def test_nearest_shifts_sunday_to_monday(self):
        sun = _weekday_date(6)
        assert adjust_weekend(sun, WeekendShift.nearest) == sun + timedelta(days=1)

    def test_back_result_is_weekday(self):
        for wday in (5, 6):
            d = _weekday_date(wday)
            result = adjust_weekend(d, WeekendShift.back)
            assert result.weekday() not in (5, 6)

    def test_forward_result_is_weekday(self):
        for wday in (5, 6):
            d = _weekday_date(wday)
            result = adjust_weekend(d, WeekendShift.forward)
            assert result.weekday() not in (5, 6)


# ── close_date_for_month ──────────────────────────────────────────────────────

class TestCloseDateForMonth:
    def test_standard_day(self):
        assert close_date_for_month(2024, 3, 15, None) == date(2024, 3, 15)

    def test_clamps_day_31_in_april(self):
        assert close_date_for_month(2024, 4, 31, None) == date(2024, 4, 30)

    def test_clamps_day_31_in_leap_february(self):
        assert close_date_for_month(2024, 2, 31, None) == date(2024, 2, 29)

    def test_clamps_day_31_in_non_leap_february(self):
        assert close_date_for_month(2025, 2, 31, None) == date(2025, 2, 28)

    def test_no_shift_on_none(self):
        # 2024-03-15 is a Friday — no shift applied
        assert close_date_for_month(2024, 3, 15, None) == date(2024, 3, 15)

    def test_weekend_shift_moves_saturday(self):
        # 2024-03-30 is a Saturday; back shift → Friday Mar 29
        result = close_date_for_month(2024, 3, 30, WeekendShift.back)
        assert result == date(2024, 3, 29)
        assert result.weekday() == 4  # Friday


# ── due_date_for_close ────────────────────────────────────────────────────────

class TestDueDateForClose:
    def test_grace_period(self):
        card = _fixed_card(grace=21)
        close = date(2024, 3, 15)
        assert due_date_for_close(close, card) == date(2024, 4, 5)

    def test_due_day_same_month(self):
        card = _fixed_card()
        card.due_day_same_month = 28
        card.grace_period_days = None
        close = date(2024, 3, 15)
        assert due_date_for_close(close, card) == date(2024, 3, 28)

    def test_due_day_same_month_clamps_to_end_of_month(self):
        card = _fixed_card()
        card.due_day_same_month = 31
        card.grace_period_days = None
        # Feb 2024 is a leap year
        close = date(2024, 2, 15)
        assert due_date_for_close(close, card) == date(2024, 2, 29)

    def test_due_day_next_month(self):
        card = _fixed_card()
        card.due_day_next_month = 20
        card.grace_period_days = None
        close = date(2024, 3, 15)
        assert due_date_for_close(close, card) == date(2024, 4, 20)

    def test_due_day_next_month_december_wraps(self):
        card = _fixed_card()
        card.due_day_next_month = 20
        card.grace_period_days = None
        close = date(2024, 12, 15)
        assert due_date_for_close(close, card) == date(2025, 1, 20)

    def test_no_due_method_raises_value_error(self):
        card = _fixed_card()
        card.grace_period_days = None
        with pytest.raises(ValueError, match="cannot compute due date"):
            due_date_for_close(date(2024, 3, 15), card)

    def test_same_month_takes_priority_over_grace(self):
        card = _fixed_card(grace=21)
        card.due_day_same_month = 28
        close = date(2024, 3, 15)
        assert due_date_for_close(close, card) == date(2024, 3, 28)


# ── next_statement_close ──────────────────────────────────────────────────────

class TestNextStatementClose:
    def test_same_month_when_not_yet_passed(self):
        card = _fixed_card(close_day=20)
        assert next_statement_close(card, date(2024, 3, 10)) == date(2024, 3, 20)

    def test_next_month_when_day_already_passed(self):
        card = _fixed_card(close_day=15)
        assert next_statement_close(card, date(2024, 3, 20)) == date(2024, 4, 15)

    def test_on_the_close_day_itself(self):
        card = _fixed_card(close_day=15)
        assert next_statement_close(card, date(2024, 3, 15)) == date(2024, 3, 15)

    def test_wraps_to_january_at_year_end(self):
        card = _fixed_card(close_day=25)
        assert next_statement_close(card, date(2024, 12, 30)) == date(2025, 1, 25)

    def test_rolling_cycle_on_reference_date(self):
        card = _rolling_card(cycle_days=29, ref_date=date(2024, 1, 1))
        assert next_statement_close(card, date(2024, 1, 1)) == date(2024, 1, 1)


# ── previous_statement_close ──────────────────────────────────────────────────

class TestPreviousStatementClose:
    def test_returns_prior_month(self):
        card = _fixed_card(close_day=15)
        # next close is Apr 15 (ref is before Apr 15), previous is Mar 15
        assert previous_statement_close(card, date(2024, 4, 10)) == date(2024, 3, 15)

    def test_january_wraps_to_december(self):
        card = _fixed_card(close_day=15)
        # next close is Jan 15 (ref is before Jan 15), previous is Dec 15
        assert previous_statement_close(card, date(2024, 1, 10)) == date(2023, 12, 15)

    def test_rolling_cycle_is_one_cycle_before(self):
        card = _rolling_card(cycle_days=29, ref_date=date(2024, 1, 1))
        # next close on Jan 1, previous = Jan 1 - 29 = Dec 3
        prev = previous_statement_close(card, date(2024, 1, 1))
        assert prev == date(2024, 1, 1) - timedelta(days=29)


# ── next_annual_fee_date ──────────────────────────────────────────────────────

class TestNextAnnualFeeDate:
    def test_no_annual_fee_returns_none(self):
        card = _fixed_card()
        assert next_annual_fee_date(card) is None

    def test_returns_same_year_when_not_past(self):
        card = _fixed_card(close_day=15)
        card.annual_fee_month = 6
        ref = date(2024, 3, 1)
        fee = next_annual_fee_date(card, ref)
        assert fee is not None
        assert fee.year == 2024
        assert fee.month == 6

    def test_returns_next_year_when_month_passed(self):
        card = _fixed_card(close_day=15)
        card.annual_fee_month = 3
        ref = date(2024, 6, 1)
        fee = next_annual_fee_date(card, ref)
        assert fee is not None
        assert fee.year == 2025
        assert fee.month == 3

    def test_fee_date_in_current_month(self):
        card = _fixed_card(close_day=15)
        card.annual_fee_month = 4
        ref = date(2024, 4, 10)
        fee = next_annual_fee_date(card, ref)
        assert fee is not None
        assert fee >= ref


# ── tracker_row ───────────────────────────────────────────────────────────────

class TestTrackerRow:
    def test_returns_all_expected_keys(self):
        card = _fixed_card()
        row = tracker_row(card, date(2024, 3, 10))
        expected = {
            "id", "name", "issuer", "last_four", "grace",
            "prev_close", "prev_due", "next_close", "next_close_days",
            "next_due", "next_due_days", "annual_fee_date", "annual_fee_days",
            "prev_due_overdue",
        }
        assert set(row.keys()) == expected

    def test_dates_are_iso_strings(self):
        card = _fixed_card()
        row = tracker_row(card, date(2024, 3, 10))
        for key in ("prev_close", "prev_due", "next_close", "next_due"):
            date.fromisoformat(row[key])

    def test_next_close_days_positive_before_close(self):
        card = _fixed_card(close_day=20)
        row = tracker_row(card, date(2024, 3, 10))
        assert row["next_close_days"] > 0

    def test_no_annual_fee(self):
        card = _fixed_card()
        row = tracker_row(card, date(2024, 3, 10))
        assert row["annual_fee_date"] is None
        assert row["annual_fee_days"] is None

    def test_with_annual_fee(self):
        card = _fixed_card(close_day=15)
        card.annual_fee_month = 6
        row = tracker_row(card, date(2024, 3, 10))
        assert row["annual_fee_date"] is not None
        assert row["annual_fee_days"] is not None

    def test_prev_due_overdue_is_bool(self):
        card = _fixed_card()
        row = tracker_row(card, date(2024, 3, 10))
        assert isinstance(row["prev_due_overdue"], bool)

    def test_grace_string_for_grace_period_card(self):
        card = _fixed_card(grace=21)
        row = tracker_row(card, date(2024, 3, 10))
        assert row["grace"] == "21"

    def test_name_and_issuer_in_row(self):
        card = _fixed_card()
        row = tracker_row(card, date(2024, 3, 10))
        assert row["name"] == "TestFixed"
        assert row["issuer"] == "TestBank"
