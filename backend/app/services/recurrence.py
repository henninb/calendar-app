"""
Recurrence expansion service.

Supports two recurrence types:

1. RFC 5545 RRULE strings parsed by python-dateutil, e.g.:
       FREQ=YEARLY;BYMONTH=6;BYMONTHDAY=15

2. Easter-relative sentinel strings (since Easter cannot be expressed as
   an RRULE):
       EASTER          → Easter Sunday
       EASTER-2        → Good Friday   (2 days before Easter)
       EASTER-46       → Ash Wednesday (46 days before Easter)
       EASTER-7        → Palm Sunday
       EASTER+1        → Easter Monday

   The offset is in days and may be positive or negative.
"""
import math
import re
from datetime import date, datetime, timedelta

from dateutil.rrule import rrulestr
from sqlalchemy.orm import Session

from ..config import settings
from ..models import Event, Occurrence, OccurrenceStatus

# ── Easter calculation (Meeus/Jones/Butcher algorithm) ────────────────────────

def calculate_easter(year: int) -> date:
    """Return the date of Easter Sunday for the given Gregorian year."""
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    return date(year, month, day)


_EASTER_RE = re.compile(r'^EASTER([+-]\d+)?$', re.IGNORECASE)

# ── Moon phase calculation (Meeus, Astronomical Algorithms Ch. 49) ────────────

_MOON_PHASE_RE = re.compile(
    r'^MOON_(NEW|FULL|FIRST_QUARTER|LAST_QUARTER)$', re.IGNORECASE
)
_MOON_PHASE_OFFSETS = {
    'new': 0.0,
    'first_quarter': 0.25,
    'full': 0.5,
    'last_quarter': 0.75,
}


def _jde_to_date(jde: float) -> date:
    """Convert a Julian Day Number to a calendar date (UTC)."""
    jde += 0.5
    z = int(jde)
    if z < 2299161:
        a = z
    else:
        alpha = int((z - 1867216.25) / 36524.25)
        a = z + 1 + alpha - (alpha // 4)
    b = a + 1524
    c = int((b - 122.1) / 365.25)
    d_val = int(365.25 * c)
    e = int((b - d_val) / 30.6001)
    day = b - d_val - int(30.6001 * e)
    month = e - 1 if e < 14 else e - 13
    year = c - 4716 if month > 2 else c - 4715
    return date(year, month, day)


def _moon_phase_jde(k: float) -> float:
    """
    Return the JDE of the moon phase for the given k.
      k integer        → new moon
      k + 0.25         → first quarter
      k + 0.5          → full moon
      k + 0.75         → last quarter
    """
    T = k / 1236.85
    JDE = (2451550.09766
           + 29.530588861 * k
           + 0.00015437 * T**2
           - 0.000000150 * T**3
           + 0.00000000073 * T**4)

    E = 1 - 0.002516 * T - 0.0000074 * T**2
    M = math.radians((2.5534 + 29.10535670 * k
                      - 0.0000014 * T**2 - 0.00000011 * T**3) % 360)
    Mp = math.radians((201.5643 + 385.81693528 * k
                       + 0.0107582 * T**2 + 0.00001238 * T**3
                       - 0.000000058 * T**4) % 360)
    F = math.radians((160.7108 + 390.67050284 * k
                      - 0.0016118 * T**2 - 0.00000227 * T**3
                      + 0.000000011 * T**4) % 360)
    Om = math.radians((124.7746 - 1.56375588 * k
                       + 0.0020672 * T**2 + 0.00000215 * T**3) % 360)

    phase = round((k % 1.0) * 4) / 4  # normalise to 0, 0.25, 0.5, 0.75
    s, c = math.sin, math.cos

    if phase == 0.0:  # New moon
        corr = (
            -0.40720 * s(Mp)     + 0.17241 * E * s(M)   + 0.01608 * s(2*Mp)
            + 0.01039 * s(2*F)   + 0.00739 * E * s(Mp-M) - 0.00514 * E * s(Mp+M)
            + 0.00208 * E**2 * s(2*M) - 0.00111 * s(Mp-2*F) - 0.00057 * s(Mp+2*F)
            + 0.00056 * E * s(2*Mp+M) - 0.00042 * s(3*Mp) + 0.00042 * E * s(M+2*F)
            + 0.00038 * E * s(M-2*F)  - 0.00024 * E * s(2*Mp-M) - 0.00017 * s(Om)
            - 0.00007 * s(Mp+2*M) + 0.00004 * s(2*Mp-2*F) + 0.00004 * s(3*M)
            + 0.00003 * s(Mp+M-2*F)   + 0.00003 * s(2*Mp+2*F)
            - 0.00003 * s(Mp+M+2*F)   + 0.00003 * s(Mp-M+2*F)
            - 0.00002 * s(Mp-M-2*F)   - 0.00002 * s(3*Mp+M) + 0.00002 * s(4*Mp)
        )
    elif phase == 0.5:  # Full moon
        corr = (
            -0.40614 * s(Mp)     + 0.17302 * E * s(M)   + 0.01614 * s(2*Mp)
            + 0.01043 * s(2*F)   + 0.00734 * E * s(Mp-M) - 0.00515 * E * s(Mp+M)
            + 0.00209 * E**2 * s(2*M) - 0.00111 * s(Mp-2*F) - 0.00057 * s(Mp+2*F)
            + 0.00056 * E * s(2*Mp+M) - 0.00042 * s(3*Mp) + 0.00042 * E * s(M+2*F)
            + 0.00038 * E * s(M-2*F)  - 0.00024 * E * s(2*Mp-M) - 0.00017 * s(Om)
            - 0.00007 * s(Mp+2*M) + 0.00004 * s(2*Mp-2*F) + 0.00004 * s(3*M)
            + 0.00003 * s(Mp+M-2*F)   + 0.00003 * s(2*Mp+2*F)
            - 0.00003 * s(Mp+M+2*F)   + 0.00003 * s(Mp-M+2*F)
            - 0.00002 * s(Mp-M-2*F)   - 0.00002 * s(3*Mp+M) + 0.00002 * s(4*Mp)
        )
    else:  # Quarter moons (0.25 or 0.75)
        corr = (
            -0.62801 * s(Mp)     + 0.17172 * E * s(M)   - 0.01183 * E * s(Mp+M)
            + 0.00862 * s(2*Mp)  + 0.00804 * s(2*F)     + 0.00454 * E * s(Mp-M)
            + 0.00204 * E**2 * s(2*M) - 0.00180 * s(Mp-2*F) - 0.00070 * s(Mp+2*F)
            - 0.00040 * s(3*Mp)  - 0.00034 * E * s(2*Mp-M) + 0.00032 * E * s(M+2*F)
            + 0.00032 * E * s(M-2*F)  - 0.00028 * E**2 * s(Mp+2*M)
            + 0.00027 * E * s(2*Mp+M) - 0.00017 * s(Om)
            - 0.00005 * s(Mp-M-2*F)   + 0.00004 * s(2*Mp+2*F)
            - 0.00004 * s(Mp+M+2*F)   + 0.00004 * s(Mp-2*M)
            + 0.00003 * s(Mp+M-2*F)   + 0.00003 * s(3*M)
            + 0.00002 * s(2*Mp-2*F)   + 0.00002 * s(Mp-M+2*F)
            - 0.00002 * s(3*Mp+M)
        )
        W = (0.00306 - 0.00038 * E * c(M) + 0.00026 * c(Mp)
             - 0.00002 * c(Mp-M) + 0.00002 * c(Mp+M) + 0.00002 * c(2*F))
        corr += W if phase == 0.25 else -W

    return JDE + corr


_ECLIPSE_RE = re.compile(r'^ECLIPSE_(SOLAR|LUNAR)$', re.IGNORECASE)


def _eclipse_f1(k: float) -> float:
    """Return F1 (corrected argument of latitude, degrees) for the moon phase at k."""
    T = k / 1236.85
    F = (160.7108 + 390.67050284 * k
         - 0.0016118 * T**2
         - 0.00000227 * T**3
         + 0.000000011 * T**4) % 360
    Om = (124.7746 - 1.56375588 * k
          + 0.0020672 * T**2
          + 0.00000215 * T**3) % 360
    F1 = (F + 0.02665 * math.sin(math.radians(Om))) % 360
    # Normalise to angular distance from nearest node (0° or 180°)
    f = F1 % 180
    return f if f <= 90 else 180 - f   # 0–90°


def _check_solar_eclipse(k: float) -> bool:
    """True if the new moon at integer k produces a solar eclipse."""
    return _eclipse_f1(k) < 15.4


def _check_lunar_eclipse(k: float) -> bool:
    """True if the full moon at k+0.5 produces a lunar eclipse (umbral or penumbral)."""
    return _eclipse_f1(k) < 17.3


def _expand_eclipses(dtstart: date, until: date, solar: bool) -> list[date]:
    """Return all eclipse dates (solar or lunar) between dtstart and until."""
    phase_offset = 0.0 if solar else 0.5
    checker = _check_solar_eclipse if solar else _check_lunar_eclipse

    year_frac = dtstart.year + (dtstart.timetuple().tm_yday / 365.25)
    k = math.floor((year_frac - 2000.0) * 12.3685) + phase_offset - 1.0

    results: list[date] = []
    for _ in range(600):
        if checker(k):
            d = _jde_to_date(_moon_phase_jde(k))
            if d > until:
                break
            if d >= dtstart:
                results.append(d)
        else:
            # Even if not an eclipse, advance k and check termination via JDE
            d = _jde_to_date(_moon_phase_jde(k))
            if d > until:
                break
        k += 1.0

    return sorted(set(results))


def _parse_moon_rule(rrule: str) -> float | None:
    """Return phase offset (0.0/0.25/0.5/0.75) if rrule is a moon sentinel, else None."""
    m = _MOON_PHASE_RE.match(rrule.strip())
    if not m:
        return None
    return _MOON_PHASE_OFFSETS[m.group(1).lower()]


def _expand_moon_phase(dtstart: date, until: date, phase_offset: float) -> list[date]:
    """Return all dates of a given moon phase between dtstart and until."""
    year_frac = dtstart.year + (dtstart.timetuple().tm_yday / 365.25)
    k = math.floor((year_frac - 2000.0) * 12.3685) + phase_offset - 1.0

    results: list[date] = []
    for _ in range(600):  # ~50 years of phases
        d = _jde_to_date(_moon_phase_jde(k))
        if d > until:
            break
        if d >= dtstart:
            results.append(d)
        k += 1.0

    return sorted(set(results))


def _parse_easter_rule(rrule: str) -> int | None:
    """
    If *rrule* is an Easter sentinel, return the day offset (0 for plain
    EASTER).  Returns None if *rrule* is not an Easter sentinel.
    """
    m = _EASTER_RE.match(rrule.strip())
    if not m:
        return None
    return int(m.group(1)) if m.group(1) else 0


def _expand_easter(dtstart: date, until: date, offset: int) -> list[date]:
    """Yield one date per year from dtstart.year to until.year."""
    dates: list[date] = []
    for year in range(dtstart.year, until.year + 1):
        d = calculate_easter(year) + timedelta(days=offset)
        if dtstart <= d <= until:
            dates.append(d)
    return dates


# ── Core expansion ────────────────────────────────────────────────────────────

def _expand_dates(event: Event, until: date) -> list[date]:
    """Return all occurrence dates for *event* from dtstart up to *until*."""
    dtstart = event.dtstart

    if not event.rrule:
        # One-time event
        return [dtstart] if dtstart <= until else []

    # Check for Easter sentinel before trying dateutil
    easter_offset = _parse_easter_rule(event.rrule)
    if easter_offset is not None:
        return _expand_easter(dtstart, until, easter_offset)

    # Check for moon phase sentinels
    moon_offset = _parse_moon_rule(event.rrule)
    if moon_offset is not None:
        return _expand_moon_phase(dtstart, until, moon_offset)

    # Check for eclipse sentinels
    eclipse_m = _ECLIPSE_RE.match(event.rrule.strip())
    if eclipse_m:
        solar = eclipse_m.group(1).upper() == 'SOLAR'
        return _expand_eclipses(dtstart, until, solar)

    # Standard RFC 5545 RRULE
    rule_str = (
        f"DTSTART:{dtstart.strftime('%Y%m%d')}\n"
        f"RRULE:{event.rrule}"
    )
    if event.dtend_rule:
        rule_str += f";UNTIL={event.dtend_rule.strftime('%Y%m%d')}"

    rule = rrulestr(rule_str, ignoretz=True)
    start_dt = datetime.combine(dtstart, datetime.min.time())
    end_dt = datetime.combine(until, datetime.max.time())
    return [dt.date() for dt in rule.between(start_dt, end_dt, inc=True)]


def generate_occurrences(
    db: Session,
    event: Event,
    lookahead_days: int | None = None,
) -> int:
    """
    Create Occurrence rows for *event* up to *lookahead_days* from today.
    Skips dates that already have a row (unique constraint on event_id + date).
    Returns the number of new occurrences inserted.
    """
    if not event.is_active:
        return 0

    days = lookahead_days or settings.occurrence_lookahead_days
    today = date.today()
    until = today + timedelta(days=days)

    dates = _expand_dates(event, until)

    existing: set[date] = {
        o.occurrence_date
        for o in db.query(Occurrence.occurrence_date)
        .filter(Occurrence.event_id == event.id)
        .all()
    }

    new_occurrences: list[Occurrence] = []
    for d in dates:
        if d in existing:
            continue
        status = (
            OccurrenceStatus.overdue if d < today else OccurrenceStatus.upcoming
        )
        new_occurrences.append(
            Occurrence(event_id=event.id, occurrence_date=d, status=status)
        )

    if new_occurrences:
        db.bulk_save_objects(new_occurrences)
        db.commit()

    return len(new_occurrences)


def generate_all_occurrences(db: Session, lookahead_days: int | None = None) -> dict:
    """Generate occurrences for every active non-credit-card event. Returns summary stats."""
    events = db.query(Event).filter(
        Event.is_active == True,
        Event.credit_card_id.is_(None),   # credit card events are managed separately
    ).all()
    total_new = 0
    for event in events:
        total_new += generate_occurrences(db, event, lookahead_days)
    return {"events_processed": len(events), "occurrences_created": total_new}


def mark_overdue(db: Session) -> int:
    """Mark upcoming occurrences whose date has passed as overdue."""
    today = date.today()
    updated = (
        db.query(Occurrence)
        .filter(
            Occurrence.status == OccurrenceStatus.upcoming,
            Occurrence.occurrence_date < today,
        )
        .update({Occurrence.status: OccurrenceStatus.overdue}, synchronize_session=False)
    )
    db.commit()
    return updated
