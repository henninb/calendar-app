#!/usr/bin/env python3
"""
seed_datav2.py — Reconciliation-based seed for the calendar-app database.

Unlike seed_data.py (wipe-and-replace), this script performs per-record upserts:
  - INSERT if the record does not exist (by natural key)
  - UPDATE only changed fields if the record exists
  - DELETE seeded records removed from seed data (via is_seeded flag)
  - Preserve user-created records and GCal linkage on unchanged occurrences

The is_seeded column is added to categories, events, and credit_cards on first
run via ALTER TABLE ADD COLUMN IF NOT EXISTS (idempotent, PostgreSQL).

Commands:
  reconcile   Upsert all seed data (default)
  seed        Alias for reconcile
  reseed      Legacy wipe-and-replace (kept for emergencies — destroys GCal linkage)
  cards       Reconcile credit cards only
"""
import sys
import urllib.request
import json
from datetime import date, datetime, timezone, timedelta
from sqlalchemy import text

from app.config import settings
from app.database import SessionLocal, Base, engine
from app.models import Category, CreditCard, Event, Occurrence, OccurrenceStatus, Priority, WeekendShift
from app.services.recurrence import generate_occurrences, generate_all_occurrences
from app.services.credit_card import ensure_card_events, generate_credit_card_occurrences

Base.metadata.create_all(bind=engine)


# ── Central Time helper ───────────────────────────────────────────────────────

def _to_ct(dt: datetime) -> str:
    """Convert a UTC-aware datetime to a Central Time string."""
    year = dt.year
    mar_second_sun = date(year, 3, 8 + (6 - date(year, 3, 1).weekday()) % 7)
    nov_first_sun  = date(year, 11, 1 + (6 - date(year, 11, 1).weekday()) % 7)
    dst_start = datetime(year, mar_second_sun.month, mar_second_sun.day, 8, 0, tzinfo=timezone.utc)
    dst_end   = datetime(year, nov_first_sun.month,  nov_first_sun.day,  7, 0, tzinfo=timezone.utc)
    offset = timedelta(hours=-5) if dst_start <= dt < dst_end else timedelta(hours=-6)
    return (dt + offset).strftime('%I:%M %p CT')


# ── Sports schedule fetchers ──────────────────────────────────────────────────

def fetch_mlb_schedule(year: int) -> list[tuple]:
    """Fetch the Twins regular-season schedule for the given year from the MLB Stats API."""
    url = (
        f"https://statsapi.mlb.com/api/v1/schedule"
        f"?startDate=01/01/{year}&endDate=12/31/{year}"
        f"&gameTypes=R&sportId=1&teamId=142&hydrate=decisions"
    )
    try:
        with urllib.request.urlopen(url, timeout=15) as r:
            data = json.loads(r.read())
    except Exception as e:
        print(f"WARNING: Could not fetch MLB schedule ({e}) — skipping Twins games.")
        return []

    games = []
    for day in data.get("dates", []):
        for game in day.get("games", []):
            game_date = game.get("officialDate") or game.get("gameDate", "")[:10]
            dt = datetime.fromisoformat(game["gameDate"].replace("Z", "+00:00"))
            ct_time = _to_ct(dt)
            home = game["teams"]["home"]["team"]
            away = game["teams"]["away"]["team"]
            is_home = home["id"] == 142
            opp   = away["name"] if is_home else home["name"]
            venue = game.get("venue", {}).get("name", "")
            y, m, d = map(int, game_date.split("-"))
            if is_home:
                title = f"Twins vs {opp}"
                desc  = f"Minnesota Twins vs {opp} at {venue} — {ct_time}"
            else:
                title = f"Twins @ {opp}"
                desc  = f"Minnesota Twins at {opp} ({venue}) — {ct_time}"
            games.append((title, "mlb", None, date(y, m, d), desc, Priority.low, [], None))

    print(f"Fetched {len(games)} Twins games ({year} season).")
    return games


def fetch_nba_schedule(season_year: int) -> list[tuple]:
    """Fetch the Timberwolves schedule for the given season start year."""
    url = f"https://fixturedownload.com/feed/json/nba-{season_year}/minnesota-timberwolves"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read())
    except Exception as e:
        print(f"WARNING: Could not fetch NBA schedule ({e}) — skipping Wolves games.")
        return []

    games = []
    for g in data:
        dt = datetime.strptime(g["DateUtc"], "%Y-%m-%d %H:%M:%SZ").replace(tzinfo=timezone.utc)
        ct_time = _to_ct(dt)
        year = dt.year
        mar_second_sun = date(year, 3, 8 + (6 - date(year, 3, 1).weekday()) % 7)
        nov_first_sun  = date(year, 11, 1 + (6 - date(year, 11, 1).weekday()) % 7)
        dst_start = datetime(year, mar_second_sun.month, mar_second_sun.day, 8, 0, tzinfo=timezone.utc)
        dst_end   = datetime(year, nov_first_sun.month,  nov_first_sun.day,  7, 0, tzinfo=timezone.utc)
        offset = timedelta(hours=-5) if dst_start <= dt < dst_end else timedelta(hours=-6)
        local_dt = dt + offset
        is_home = g["HomeTeam"] == "Minnesota Timberwolves"
        opp   = g["AwayTeam"] if is_home else g["HomeTeam"]
        venue = g["Location"]
        y, m, d = local_dt.year, local_dt.month, local_dt.day
        if is_home:
            title = f"Wolves vs {opp}"
            desc  = f"Minnesota Timberwolves vs {opp} at {venue} — {ct_time}"
        else:
            title = f"Wolves @ {opp}"
            desc  = f"Minnesota Timberwolves at {opp} ({venue}) — {ct_time}"
        games.append((title, "nba", None, date(y, m, d), desc, Priority.low, [], None))

    print(f"Fetched {len(games)} Wolves games ({season_year}-{str(season_year + 1)[-2:]} season).")
    return games


def fetch_nhl_schedule(season_year: int) -> list[tuple]:
    """Fetch the Wild schedule for the given season start year."""
    url = f"https://fixturedownload.com/feed/json/nhl-{season_year}/minnesota-wild"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read())
    except Exception as e:
        print(f"WARNING: Could not fetch NHL schedule ({e}) — skipping Wild games.")
        return []

    games = []
    for g in data:
        dt = datetime.strptime(g["DateUtc"], "%Y-%m-%d %H:%M:%SZ").replace(tzinfo=timezone.utc)
        ct_time = _to_ct(dt)
        year = dt.year
        mar_second_sun = date(year, 3, 8 + (6 - date(year, 3, 1).weekday()) % 7)
        nov_first_sun  = date(year, 11, 1 + (6 - date(year, 11, 1).weekday()) % 7)
        dst_start = datetime(year, mar_second_sun.month, mar_second_sun.day, 8, 0, tzinfo=timezone.utc)
        dst_end   = datetime(year, nov_first_sun.month,  nov_first_sun.day,  7, 0, tzinfo=timezone.utc)
        offset = timedelta(hours=-5) if dst_start <= dt < dst_end else timedelta(hours=-6)
        local_dt = dt + offset
        is_home = g["HomeTeam"] == "Minnesota Wild"
        opp   = g["AwayTeam"] if is_home else g["HomeTeam"]
        venue = g["Location"]
        y, m, d = local_dt.year, local_dt.month, local_dt.day
        if is_home:
            title = f"Wild vs {opp}"
            desc  = f"Minnesota Wild vs {opp} at {venue} — {ct_time}"
        else:
            title = f"Wild @ {opp}"
            desc  = f"Minnesota Wild at {opp} ({venue}) — {ct_time}"
        games.append((title, "nhl", None, date(y, m, d), desc, Priority.low, [], None))

    print(f"Fetched {len(games)} Wild games ({season_year}-{str(season_year + 1)[-2:]} season).")
    return games


# ── Seed data constants ───────────────────────────────────────────────────────

CATEGORIES = settings.categories

# (title, category_name, rrule, dtstart, description, priority, reminder_days, amount)
EXAMPLE_EVENTS = [
    # ── Birthdays ────────────────────────────────────────────────────────────
    ("Birthday: Johnny",             "birthday",          "FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=2",
     date(2000, 3, 2),    "Johnny's birthday",                 Priority.high,   [7, 1],  None),
    ("Birthday: Frank Walsh",        "birthday",          "FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=23",
     date(2000, 3, 23),   "Frank Walsh's birthday",            Priority.high,   [7, 1],  None),

    # ── Car Maintenance ──────────────────────────────────────────────────────
    ("Oil Change — Toyota Highlander","car_maintenance",  "FREQ=MONTHLY;INTERVAL=3",
     date(2026, 4, 1),    "Toyota Highlander oil change every 3 months", Priority.medium, [14, 3], None),
    ("Oil Change — Ford Taurus",     "car_maintenance",   "FREQ=MONTHLY;INTERVAL=3",
     date(2026, 4, 1),    "Ford Taurus oil change every 3 months",       Priority.medium, [14, 3], None),
    ("Oil Change — Hyundai Sonata",  "car_maintenance",   "FREQ=MONTHLY;INTERVAL=3",
     date(2026, 4, 1),    "Hyundai Sonata oil change every 3 months",    Priority.medium, [14, 3], None),
    ("Oil Change — Hyundai Entourage","car_maintenance",  "FREQ=MONTHLY;INTERVAL=3",
     date(2026, 4, 1),    "Hyundai Entourage oil change every 3 months", Priority.medium, [14, 3], None),
    ("Car Insurance Renewal",        "car_maintenance",   "FREQ=MONTHLY;INTERVAL=6",
     date(2026, 6, 18),   "Car insurance policy renewal every 6 months", Priority.high, [30], None),
    ("Tabs — Toyota Highlander",     "car_maintenance",   "FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=-1",
     date(2026, 11, 30),  "Toyota Highlander registration tabs expire", Priority.high, [30], None),
    ("Tabs — Ford Taurus",           "car_maintenance",   "FREQ=YEARLY;BYMONTH=12;BYMONTHDAY=-1",
     date(2026, 12, 31),  "Ford Taurus registration tabs expire",       Priority.high, [30], None),
    ("Tabs — Hyundai Sonata",        "car_maintenance",   "FREQ=YEARLY;BYMONTH=4;BYMONTHDAY=30",
     date(2026, 4, 30),   "Hyundai Sonata registration tabs expire",    Priority.high, [30], None),
    ("Tabs — Hyundai Entourage",     "car_maintenance",   "FREQ=YEARLY;BYMONTH=5;BYMONTHDAY=-1",
     date(2026, 5, 31),   "Hyundai Entourage registration tabs expire", Priority.high, [30], None),

    # ── House Maintenance ────────────────────────────────────────────────────
    ("Homeowners Insurance Renewal", "house_maintenance", "FREQ=YEARLY;BYMONTH=6;BYMONTHDAY=28",
     date(2026, 6, 28),   "Homeowners insurance policy renewal", Priority.high, [30],    None),
    ("Furnace Filter Change",        "house_maintenance", "FREQ=MONTHLY;BYMONTHDAY=15",
     date(2026, 1, 15),   "Replace furnace filter",            Priority.medium, [7],     None),
    ("Smoke Detector Battery",       "house_maintenance", "FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=1",
     date(2026, 11, 1),   "Replace smoke/CO detector batteries", Priority.high, [7],     None),
    ("Water Heater Flush",           "house_maintenance", "FREQ=MONTHLY;INTERVAL=6",
     date(2026, 4, 4),    "Flush sediment from water heater",  Priority.low,    [14],    None),
    ("HVAC Annual Service",          "house_maintenance", "FREQ=YEARLY;BYMONTH=5",
     date(2026, 5, 1),    "Annual HVAC tune-up",               Priority.medium, [14, 3], None),

    # ── Medical ──────────────────────────────────────────────────────────────
    ("Sleep Doctor — Virtual Visit",  "medical",           None,
     date(2026, 6, 18),  "Virtual visit with sleep doctor at 8:45am", Priority.high, [7, 1], None),
    ("Annual Physical",              "medical",           "FREQ=YEARLY;BYMONTH=8",
     date(2026, 8, 1),    "Annual wellness exam",              Priority.high,   [30, 7], None),
    ("Eye Exam",                     "medical",           "FREQ=YEARLY;BYMONTH=9",
     date(2026, 9, 1),    "Annual eye exam",                   Priority.medium, [14, 3], None),

    # ── Dental ───────────────────────────────────────────────────────────────
    ("Dental Cleaning",              "dental",            "FREQ=MONTHLY;INTERVAL=6",
     date(2026, 11, 19),  "Teeth cleaning at 10am",            Priority.high,   [14, 3], None),

    # ── Payments ─────────────────────────────────────────────────────────────
    ("Mortgage — ServiceMac",        "payment",           "FREQ=MONTHLY;BYMONTHDAY=1",
     date(2026, 4, 1),    "Monthly mortgage payment due — ServiceMac", Priority.high, [5, 1], None),
    ("CenterPoint Energy Gas Bill",  "payment",           "FREQ=MONTHLY;BYMONTHDAY=8",
     date(2026, 4, 8),    "CenterPoint Energy monthly gas bill due", Priority.high, [5, 1], None),
    ("Connexus Energy Electric Bill", "payment",           "FREQ=MONTHLY;BYMONTHDAY=9",
     date(2026, 4, 9),    "Connexus Energy monthly electric bill due (meter #200003856)", Priority.high, [5, 1], None),
    ("T-Mobile — Internet & Cell Phone", "payment",        "FREQ=MONTHLY;BYMONTHDAY=26",
     date(2026, 4, 26),   "T-Mobile monthly bill due — internet and cell phone ($219.20); bill issued on the 7th of each month", Priority.high, [5, 1], None),
    ("City of Ramsey Utility Bill",  "payment",           "FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=25",
     date(2026, 4, 25),   "City of Ramsey acct #735816 — Water, Sewer, Street Light, Recycling, Storm Water", Priority.high, [5, 1], None),
    ("Curbside Bill",                "payment",           "FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=1",
     date(2026, 4, 1),    "Curbside bi-monthly statement balance due", Priority.high, [5, 1], None),
    ("Curbside Waste Promo Expires", "payment",           None,
     date(2026, 8, 1),    "Curbside Waste annual promotion expires — expect rate change", Priority.high, [30, 7], None),
    ("T-Mobile Pixel 8a — Free Payments End", "payment",   None,
     date(2026, 9, 1),    "T-Mobile 24-month free device payments on Pixel 8a end — expect new charge", Priority.high, [30, 7], None),
    ("Cell Phone — Kids",            "payment",           "FREQ=MONTHLY;BYMONTHDAY=10",
     date(2026, 1, 10),   "Kids' cell phone payments due",     Priority.high,   [5, 1],  None),
    ("Auto Insurance — Kids",        "payment",           "FREQ=MONTHLY;BYMONTHDAY=-1",
     date(2026, 1, 31),   "Kids' auto insurance payments due", Priority.high,   [5, 1],  None),

    # ── Property Tax ─────────────────────────────────────────────────────────
    ("Property Tax — Spring",        "property_tax",      "FREQ=YEARLY;BYMONTH=5;BYMONTHDAY=15",
     date(2026, 5, 15),   "Anoka County first half property tax installment", Priority.high, [30, 25, 7], None),
    ("Property Tax — Fall",          "property_tax",      "FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=15",
     date(2026, 10, 15),  "Anoka County second half property tax installment", Priority.high, [30, 25, 7], None),

    # ── Taxes ────────────────────────────────────────────────────────────────
    ("Federal Taxes Due",            "tax",               "FREQ=YEARLY;BYMONTH=4;BYMONTHDAY=15",
     date(2026, 4, 15),   "Federal income tax filing deadline", Priority.high,  [60, 30, 7], None),
    ("Minnesota State Taxes Due",    "tax",               "FREQ=YEARLY;BYMONTH=4;BYMONTHDAY=15",
     date(2026, 4, 15),   "Minnesota state income tax filing deadline", Priority.high, [60, 30, 7], None),
    ("Quarterly Estimated Tax — Q1", "tax",               "FREQ=YEARLY;BYMONTH=4;BYMONTHDAY=15",
     date(2026, 4, 15),   "Q1 estimated tax payment",          Priority.high,   [14, 3], None),
    ("Quarterly Estimated Tax — Q2", "tax",               "FREQ=YEARLY;BYMONTH=6;BYMONTHDAY=15",
     date(2026, 6, 15),   "Q2 estimated tax payment",          Priority.high,   [14, 3], None),
    ("Quarterly Estimated Tax — Q3", "tax",               "FREQ=YEARLY;BYMONTH=9;BYMONTHDAY=15",
     date(2026, 9, 15),   "Q3 estimated tax payment",          Priority.high,   [14, 3], None),
    ("Quarterly Estimated Tax — Q4", "tax",               "FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=15",
     date(2027, 1, 15),   "Q4 estimated tax payment",          Priority.high,   [14, 3], None),

    # ── Finance ──────────────────────────────────────────────────────────────
    ("TGT Earnings Report",          "finance",           "FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=20",
     date(2026, 5, 20),   "Target Corporation (TGT) quarterly earnings report (estimated — verify date each quarter)", Priority.medium, [7, 1], None),
    ("TGT Ex-Dividend Date",         "finance",           "FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=13",
     date(2026, 5, 13),   "Target Corporation (TGT) ex-dividend date — must own shares before this date", Priority.high, [7, 1], None),
    ("TGT Dividend Payout",          "finance",           "FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=1",
     date(2026, 6, 1),    "Target Corporation (TGT) quarterly dividend payout — $1.14/share ($4.56 annual)", Priority.medium, [1],  None),
    ("Huntington CD Maturity",       "finance",           None,
     date(2026, 6, 5),    "Huntington Certificate of Deposit matures — decide to withdraw or renew", Priority.high, [30, 7], None),
    ("HUMAN Quarter End",            "finance",           "FREQ=MONTHLY;BYMONTH=3,6,9,12;BYMONTHDAY=-1",
     date(2026, 3, 31),   "HUMAN work quarter ends — Mar 31, Jun 30, Sep 30, Dec 31", Priority.high, [7, 1], None),
    ("Annual Finance Review",        "finance",           "FREQ=YEARLY;BYMONTH=1",
     date(2026, 1, 1),    "Review budget, investments, net worth", Priority.high, [14], None),

    # ── Software ─────────────────────────────────────────────────────────────
    ("Anthropic Subscription Renewal",   "software",       "FREQ=YEARLY;BYMONTH=7;BYMONTHDAY=27",
     date(2026, 7, 27),   "Anthropic annual subscription renewal",     Priority.medium, [30, 7], None),
    ("LanguageTool Subscription Renewal","software",       "FREQ=YEARLY;BYMONTH=7;BYMONTHDAY=14",
     date(2026, 7, 14),   "LanguageTool annual subscription renewal",  Priority.medium, [30, 7], None),
    ("Perplexity Subscription Renewal",  "software",       "FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=4",
     date(2026, 11, 4),   "Perplexity annual subscription renewal",    Priority.medium, [30, 7], None),
    ("Domain Renewal — bhenning.xyz",    "software",      None,
     date(2026, 6, 5),    "Namecheap — bhenning.xyz domain expires",     Priority.high, [90, 30], None),
    ("Domain Renewal — brianhenning.com", "software",      None,
     date(2035, 2, 16),   "Namecheap — brianhenning.com domain expires", Priority.high, [90, 30], None),
    ("Domain Renewal — bhenning.com",    "software",      None,
     date(2035, 1, 24),   "Namecheap — bhenning.com domain expires",     Priority.high, [90, 30], None),
    ("Backup — finance_db",          "software",          "FREQ=WEEKLY;BYDAY=SU",
     date(2026, 4, 5),    "Weekly backup of finance_db database", Priority.high, [1],  None),
    ("OS Update — Raspberry Pi",     "software",          "FREQ=MONTHLY;BYMONTHDAY=5",
     date(2026, 4, 5),    "Monthly OS update for Raspberry Pi", Priority.medium, [1],  None),
    ("OS Update — pfSense",          "software",          "FREQ=MONTHLY;BYMONTHDAY=12",
     date(2026, 4, 12),   "Monthly OS update for pfSense",     Priority.medium, [1],  None),
    ("OS Update — Proxmox",          "software",          "FREQ=MONTHLY;BYMONTHDAY=19",
     date(2026, 4, 19),   "Monthly OS update for Proxmox",     Priority.medium, [1],  None),
    ("OS Update — DD-WRT Router",    "software",          "FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=3",
     date(2026, 4, 3),    "DD-WRT router firmware update",     Priority.medium, [1],  None),
    ("OS Update — K8s Debian Nodes", "software",          "FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=10",
     date(2026, 4, 10),   "OS update for Kubernetes Debian instances", Priority.medium, [1], None),
    ("K8s Version Update",           "software",          "FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=10",
     date(2026, 4, 10),   "Update Kubernetes version on the cluster", Priority.medium, [1], None),
    ("OS Update — Silverfox",        "software",          "FREQ=DAILY;INTERVAL=30",
     date(2026, 4, 1),    "Silverfox (Arch Linux) OS update every 30 days", Priority.medium, [1], None),
    ("Update — Forgejo",             "software",          "FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=24",
     date(2026, 4, 24),   "Forgejo (git server) version update", Priority.medium, [1], None),
    ("Update — Spring Boot Finance App", "software",      "FREQ=MONTHLY;BYMONTHDAY=8",
     date(2026, 4, 8),    "Spring Boot finance app dependency and version update", Priority.medium, [1], None),
    ("Update — Next.js Finance App", "software",          "FREQ=MONTHLY;BYMONTHDAY=16",
     date(2026, 4, 16),   "Next.js finance app dependency and version update", Priority.medium, [1], None),

    # ── Other ────────────────────────────────────────────────────────────────
    ("Chairman's Club — Fairmont Mayakoba","other",         None,
     date(2026, 5, 19),  "Chairman's Club trip — Fairmont Mayakoba, Mexico (May 19–22)", Priority.high, [30, 7, 1], None),
    ("Kathryn — Confirmation",            "other",         None,
     date(2026, 5, 10),  "Kathryn's confirmation — Mother's Day", Priority.high, [14, 7, 1], None),
    ("Kathryn — Candle Passing",          "other",         None,
     date(2026, 5, 28),  "Kathryn's candle passing at 8am",       Priority.high, [14, 7, 1], None),
    ("Kathryn — Graduation",              "other",         None,
     date(2026, 5, 30),  "Kathryn's graduation at 5pm",           Priority.high, [14, 7, 1], None),
    ("Maggie — Cancel Spotify",           "other",         None,
     date(2026, 4, 1),    "Maggie to cancel Spotify subscription",     Priority.high,   [1],     None),

    # ── NCAA Frozen Four ─────────────────────────────────────────────────────
    # Semifinals: first Thursday on or after April 6
    # Championship: first Saturday on or after April 8 (2 days after semis)
    ("NCAA Frozen Four — Semifinals",   "other", "FREQ=YEARLY;BYMONTH=4;BYMONTHDAY=6,7,8,9,10,11,12;BYDAY=TH",
     date(2023, 4, 6),   "NCAA Men's Ice Hockey Frozen Four — Semifinal games (two games, evening ET)", Priority.high, [7, 1], None),
    ("NCAA Frozen Four — Championship", "other", "FREQ=YEARLY;BYMONTH=4;BYMONTHDAY=8,9,10,11,12,13,14;BYDAY=SA",
     date(2023, 4, 8),   "NCAA Men's Ice Hockey Frozen Four — Championship game (evening ET)",          Priority.high, [7, 1], None),

    # ── French Open (Roland Garros) ──────────────────────────────────────────
    # Main draw starts on the Sunday falling May 24–30 (last Sunday of May before the 31st)
    # Women's final: Saturday of the second week (June 6–12)
    # Men's final: Sunday of the second week (June 7–13)
    ("French Open — Main Draw Begins",  "other", "FREQ=YEARLY;BYMONTH=5;BYDAY=SU;BYMONTHDAY=24,25,26,27,28,29,30",
     date(2024, 5, 26),  "Roland Garros main draw begins — two-week Grand Slam clay-court tournament in Paris", Priority.medium, [7, 1], None),
    ("French Open — Women's Final",     "other", "FREQ=YEARLY;BYMONTH=6;BYDAY=SA;BYMONTHDAY=6,7,8,9,10,11,12",
     date(2024, 6, 8),   "Roland Garros Women's Singles Final (Saturday of the second week)",           Priority.high,   [3, 1], None),
    ("French Open — Men's Final",       "other", "FREQ=YEARLY;BYMONTH=6;BYDAY=SU;BYMONTHDAY=7,8,9,10,11,12,13",
     date(2024, 6, 9),   "Roland Garros Men's Singles Final (Sunday of the second week)",               Priority.high,   [3, 1], None),

    # ── Wimbledon Championships ──────────────────────────────────────────────
    # Always starts Monday of ISO week 27 (June 28 – July 4 window)
    # Finals on the last weekend: Women's Saturday of week 28, Men's Sunday of week 28
    ("Wimbledon — Main Draw Begins",    "other", "FREQ=YEARLY;BYWEEKNO=27;BYDAY=MO",
     date(2023, 7, 3),   "Wimbledon Championships main draw begins — two-week Grand Slam grass-court tournament in London", Priority.medium, [7, 1], None),
    ("Wimbledon — Women's Final",       "other", "FREQ=YEARLY;BYWEEKNO=28;BYDAY=SA",
     date(2023, 7, 15),  "Wimbledon Women's Singles Final (Saturday of the second week)",               Priority.high,   [3, 1], None),
    ("Wimbledon — Men's Final",         "other", "FREQ=YEARLY;BYWEEKNO=28;BYDAY=SU",
     date(2023, 7, 16),  "Wimbledon Men's Singles Final (Sunday of the second week)",                   Priority.high,   [3, 1], None),

    # ── US Open (hard court, Flushing Meadows, New York) ─────────────────────
    # Main draw starts Monday of ISO week 35 (last Monday of August)
    # Note: from ~2025 onward the tournament opens Sunday of week 34 (one day earlier)
    # Women's Final: Saturday of ISO week 36; Men's Final: Sunday of ISO week 36
    ("US Open — Main Draw Begins",      "other", "FREQ=YEARLY;BYWEEKNO=35;BYDAY=MO",
     date(2023, 8, 28),  "US Open main draw begins — two-week Grand Slam hard-court tournament in Flushing Meadows, New York", Priority.medium, [7, 1], None),
    ("US Open — Women's Final",         "other", "FREQ=YEARLY;BYWEEKNO=36;BYDAY=SA",
     date(2023, 9, 9),   "US Open Women's Singles Final (Saturday of the second week)",                 Priority.high,   [3, 1], None),
    ("US Open — Men's Final",           "other", "FREQ=YEARLY;BYWEEKNO=36;BYDAY=SU",
     date(2023, 9, 10),  "US Open Men's Singles Final (Sunday of the second week)",                     Priority.high,   [3, 1], None),

    # ── Australian Open (hard court, Melbourne Park, Australia) ──────────────
    # Main draw starts Monday of ISO week 3 (historically; from ~2024 opens Sunday of week 2)
    # Women's Final: Saturday of ISO week 4; Men's Final: Sunday of ISO week 4
    ("Australian Open — Main Draw Begins", "other", "FREQ=YEARLY;BYWEEKNO=3;BYDAY=MO",
     date(2023, 1, 16),  "Australian Open main draw begins — two-week Grand Slam hard-court tournament in Melbourne", Priority.medium, [7, 1], None),
    ("Australian Open — Women's Final", "other", "FREQ=YEARLY;BYWEEKNO=4;BYDAY=SA",
     date(2023, 1, 28),  "Australian Open Women's Singles Final (Saturday of the second week)",         Priority.high,   [3, 1], None),
    ("Australian Open — Men's Final",   "other", "FREQ=YEARLY;BYWEEKNO=4;BYDAY=SU",
     date(2023, 1, 29),  "Australian Open Men's Singles Final (Sunday of the second week)",             Priority.high,   [3, 1], None),

    # ── Kentucky Derby ───────────────────────────────────────────────────────
    # Always the first Saturday in May; Churchill Downs, Louisville KY; dirt surface
    ("Kentucky Derby",                  "other", "FREQ=YEARLY;BYMONTH=5;BYDAY=1SA",
     date(2023, 5, 6),   "Kentucky Derby — first Saturday in May at Churchill Downs, Louisville, KY",  Priority.high,   [7, 1], None),

    ("Maggie — Associates Degree Graduation", "other",      None,
     date(2026, 5, 15),  "Maggie graduates with Associates degree from community college", Priority.high, [14, 7, 1], None),
    ("Maggie — Graduation Ceremony",      "other",         None,
     date(2026, 6, 1),   "Maggie's graduation ceremony",      Priority.high,   [14, 7, 1], None),
    ("Maggie — Graduation Party",         "other",         None,
     date(2026, 6, 6),   "Maggie's graduation party",         Priority.high,   [14, 7, 1], None),
    ("Maggie — Basic Training Begins",    "other",         None,
     date(2026, 7, 29),  "Maggie departs for basic training at Fort Sill, OK", Priority.high, [14, 7, 1], None),
    ("Maggie — Arrives Fort Gordon GA",   "other",         None,
     date(2026, 10, 7),  "Maggie arrives at Fort Gordon, GA for AIT after completing basic training", Priority.high, [7, 1], None),
    ("Maggie — Completes Fort Gordon",    "other",         None,
     date(2027, 2, 1),   "Maggie completes training at Fort Gordon, GA — update with exact date", Priority.high, [14, 7, 1], None),
    ("Black Hat USA",                     "other",         "FREQ=YEARLY;BYMONTH=8;BYDAY=1SA",
     date(2026, 8, 1),    "Black Hat USA — Mandalay Bay, Las Vegas. Trainings early Aug, Briefings mid-Aug", Priority.high, [30, 7], None),
    ("DEF CON",                           "other",         "FREQ=YEARLY;BYMONTH=8;BYDAY=2SA",
     date(2026, 8, 6),    "DEF CON — Las Vegas Convention Center, typically second weekend of August", Priority.high, [30, 7], None),
    ("Kids Fishing Event — Lake George",  "other",         "FREQ=YEARLY;BYMONTH=8;BYDAY=1FR",
     date(2026, 8, 7),    "Kids fishing event at Lake George, Oak Grove — first Friday of August", Priority.high, [14, 7, 1], None),
    ("CAST Fishing Tournament — Sign Up", "other",         "FREQ=YEARLY;BYMONTH=6;BYMONTHDAY=1",
     date(2026, 6, 1),    "Sign up for Anoka County CAST fishing tournament before July 1 start", Priority.high, [14, 7], None),
    ("CAST Fishing Tournament Begins",   "other",         "FREQ=YEARLY;BYMONTH=7;BYMONTHDAY=1",
     date(2026, 7, 1),    "Anoka County CAST fishing tournament starts — also sign-up opens for Kids Fishing Event at Lake George", Priority.high, [7, 1], None),
    ("MN Fishing Opener",                 "other",         "FREQ=YEARLY;BYMONTH=5;BYDAY=2SA",
     date(2026, 5, 9),    "Minnesota walleye & northern pike fishing opener — 2nd Saturday of May", Priority.high, [7, 1], None),
    ("MN Fishing License Expires",        "other",         "FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=31",
     date(2026, 3, 31),   "Minnesota fishing license expires March 31 — renew before opener", Priority.high, [30, 7], None),
    ("TSA Precheck Renewal",              "other",         "FREQ=YEARLY;INTERVAL=5;BYMONTH=8",
     date(2029, 8, 1),   "TSA Precheck expires — renew every 5 years", Priority.high, [90, 30], None),
    ("Passport Renewal",                  "other",         "FREQ=YEARLY;INTERVAL=10;BYMONTH=5",
     date(2029, 5, 1),   "Passport expires — renew every 10 years",    Priority.high, [90, 30], None),
    ("MN Driver's License Renewal",       "other",         "FREQ=YEARLY;INTERVAL=4;BYMONTH=9;BYMONTHDAY=15",
     date(2029, 9, 15),  "Minnesota driver's license expires every 4 years", Priority.high, [30, 7], None),
    ("MN Driver's License Renewal — Wife","other",         "FREQ=YEARLY;INTERVAL=4;BYMONTH=8;BYMONTHDAY=11",
     date(2029, 8, 11),  "Wife's Minnesota driver's license expires every 4 years", Priority.high, [30, 7], None),

    # ── US Holidays (fixed date) ─────────────────────────────────────────────
    ("New Year's Day",               "holiday",           "FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=1",
     date(2026, 1, 1),    "New Year's Day",                    Priority.high,   [1],     None),
    ("Valentine's Day",              "holiday",           "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=14",
     date(2026, 2, 14),   "Valentine's Day",                   Priority.medium, [7, 1],  None),
    ("St. Patrick's Day",            "holiday",           "FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=17",
     date(2026, 3, 17),   "St. Patrick's Day",                 Priority.low,    [1],     None),
    ("Pi Day",                       "holiday",           "FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=14",
     date(2026, 3, 14),   "National Pi Day — 3.14",            Priority.low,    [1],     None),
    ("Ides of March",                "holiday",           "FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=15",
     date(2026, 3, 15),   "Ides of March — beware!",           Priority.low,    [1],     None),
    ("Independence Day",             "holiday",           "FREQ=YEARLY;BYMONTH=7;BYMONTHDAY=4",
     date(2026, 7, 4),    "Independence Day — July 4th",       Priority.high,   [7, 1],  None),
    ("Juneteenth",                   "holiday",           "FREQ=YEARLY;BYMONTH=6;BYMONTHDAY=19",
     date(2026, 6, 19),   "Juneteenth National Independence Day", Priority.medium, [1],  None),
    ("Halloween",                    "holiday",           "FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=31",
     date(2026, 10, 31),  "Halloween",                         Priority.medium, [7, 1],  None),
    ("Veterans Day",                 "holiday",           "FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=11",
     date(2026, 11, 11),  "Veterans Day",                      Priority.medium, [1],     None),
    ("Christmas Eve",                 "holiday",           "FREQ=YEARLY;BYMONTH=12;BYMONTHDAY=24",
     date(2026, 12, 24),  "Christmas Eve",                     Priority.high,   [7, 1],  None),
    ("Christmas",                    "holiday",           "FREQ=YEARLY;BYMONTH=12;BYMONTHDAY=25",
     date(2026, 12, 25),  "Christmas Day",                     Priority.high,   [30, 7, 1], None),
    ("New Year's Eve",               "holiday",           "FREQ=YEARLY;BYMONTH=12;BYMONTHDAY=31",
     date(2026, 12, 31),  "New Year's Eve",                    Priority.medium, [7, 1],  None),

    # ── US Holidays (floating — nth weekday) ─────────────────────────────────
    ("Martin Luther King Jr. Day",   "holiday",           "FREQ=YEARLY;BYMONTH=1;BYDAY=3MO",
     date(2026, 1, 19),   "MLK Day — 3rd Monday of January",  Priority.medium, [1],     None),
    ("Presidents' Day",              "holiday",           "FREQ=YEARLY;BYMONTH=2;BYDAY=3MO",
     date(2026, 2, 16),   "Presidents' Day — 3rd Monday of February", Priority.medium, [1], None),
    ("Mother's Day",                 "holiday",           "FREQ=YEARLY;BYMONTH=5;BYDAY=2SU",
     date(2026, 5, 10),   "Mother's Day — 2nd Sunday of May",  Priority.high,   [14, 1], None),
    ("Memorial Day",                 "holiday",           "FREQ=YEARLY;BYMONTH=5;BYDAY=-1MO",
     date(2026, 5, 25),   "Memorial Day — last Monday of May", Priority.medium, [7, 1],  None),
    ("Father's Day",                 "holiday",           "FREQ=YEARLY;BYMONTH=6;BYDAY=3SU",
     date(2026, 6, 21),   "Father's Day — 3rd Sunday of June", Priority.high,   [14, 1], None),
    ("Columbus Day",                 "holiday",           "FREQ=YEARLY;BYMONTH=10;BYDAY=2MO",
     date(2026, 10, 12),  "Columbus Day / Indigenous Peoples' Day — 2nd Monday of October", Priority.low, [1], None),
    ("Labor Day",                    "holiday",           "FREQ=YEARLY;BYMONTH=9;BYDAY=1MO",
     date(2026, 9, 7),    "Labor Day — 1st Monday of September", Priority.medium, [7, 1], None),
    ("Thanksgiving",                 "holiday",           "FREQ=YEARLY;BYMONTH=11;BYDAY=4TH",
     date(2026, 11, 26),  "Thanksgiving — 4th Thursday of November", Priority.high, [14, 7, 1], None),

    # ── First day of each season ─────────────────────────────────────────────
    ("First Day of Spring",          "holiday",           "FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=20",
     date(2026, 3, 20),   "Spring equinox",                    Priority.low,    [1],     None),
    ("First Day of Summer",          "holiday",           "FREQ=YEARLY;BYMONTH=6;BYMONTHDAY=21",
     date(2026, 6, 21),   "Summer solstice",                   Priority.low,    [1],     None),
    ("First Day of Fall",            "holiday",           "FREQ=YEARLY;BYMONTH=9;BYMONTHDAY=22",
     date(2026, 9, 22),   "Fall equinox",                      Priority.low,    [1],     None),
    ("First Day of Winter",          "holiday",           "FREQ=YEARLY;BYMONTH=12;BYMONTHDAY=21",
     date(2026, 12, 21),  "Winter solstice",                   Priority.low,    [1],     None),

    # ── Daylight Saving Time (US) ─────────────────────────────────────────────
    ("Daylight Saving Time Begins",  "holiday",           "FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
     date(2026, 3, 8),    "Spring forward — clocks ahead 1 hour", Priority.medium, [1], None),
    ("Daylight Saving Time Ends",    "holiday",           "FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
     date(2026, 11, 1),   "Fall back — clocks back 1 hour",    Priority.medium, [1],     None),

    # ── Eclipses ──────────────────────────────────────────────────────────────
    ("Solar Eclipse",                "holiday",           "ECLIPSE_SOLAR",
     date(2026, 1, 1),    "Solar eclipse (total, annular, or partial)", Priority.medium, [30, 7], None),
    ("Lunar Eclipse",                "holiday",           "ECLIPSE_LUNAR",
     date(2026, 1, 1),    "Lunar eclipse (total, partial, or penumbral)", Priority.medium, [7, 1], None),

    # ── Moon phases ───────────────────────────────────────────────────────────
    ("New Moon",                     "holiday",           "MOON_NEW",
     date(2026, 1, 1),    "New moon",                          Priority.low,    [1],     None),
    ("First Quarter Moon",           "holiday",           "MOON_FIRST_QUARTER",
     date(2026, 1, 1),    "First quarter moon",                Priority.low,    [1],     None),
    ("Full Moon",                    "holiday",           "MOON_FULL",
     date(2026, 1, 1),    "Full moon",                         Priority.low,    [1],     None),
    ("Last Quarter Moon",            "holiday",           "MOON_LAST_QUARTER",
     date(2026, 1, 1),    "Last quarter moon",                 Priority.low,    [1],     None),

    # ── Easter & related holy days (lunar — use EASTER sentinel) ─────────────
    ("Easter Sunday",                "holiday",           "EASTER",
     date(2026, 1, 1),    "Easter Sunday",                     Priority.medium, [7],  None),
    ("Good Friday",                  "holiday",           "EASTER-2",
     date(2026, 1, 1),    "Good Friday — 2 days before Easter", Priority.medium, [3],  None),
    ("Easter Monday",                "holiday",           "EASTER+1",
     date(2026, 1, 1),    "Easter Monday",                     Priority.low,    [1],  None),
    ("Palm Sunday",                  "holiday",           "EASTER-7",
     date(2026, 1, 1),    "Palm Sunday — one week before Easter", Priority.low, [1],  None),
    ("Ash Wednesday",                "holiday",           "EASTER-46",
     date(2026, 1, 1),    "Ash Wednesday — start of Lent",     Priority.low,    [1],  None),

    # ── Local fairs ──────────────────────────────────────────────────────────
    # Anoka County Fair: Tuesday in July 21–27 (6-day run Tue–Sun); 2024 started Sunday (outlier*)
    # MN State Fair: Thursday in Aug 22–28 — runs 12 days, ending on or just after Labor Day
    ("Anoka County Fair",               "other", "FREQ=YEARLY;BYMONTH=7;BYDAY=TU;BYMONTHDAY=21,22,23,24,25,26,27",
     date(2026, 7, 21),  "Anoka County Fair, Anoka MN — 6-day fair (Tue-Sun). 4-H exhibits, livestock shows, demo derby, rides, vendors, entertainment, food, and fireworks.", Priority.high, [14, 7, 1], None),
    ("Minnesota State Fair",            "other", "FREQ=YEARLY;BYMONTH=8;BYDAY=TH;BYMONTHDAY=22,23,24,25,26,27,28",
     date(2026, 8, 27),  "Minnesota State Fair (The Great Minnesota Get-Together), Falcon Heights MN — 12-day fair (Thu–Mon) ending on or just after Labor Day. Carnival rides, concerts, competitions, exhibits, food vendors, and more.", Priority.high, [30, 14, 7, 1], None),

    # ── Local parades ────────────────────────────────────────────────────────
    # Pioneer Days (St. Francis): last Friday of May — 3-day festival (Fri–Sun), parade on Saturday
    # Happy Days (Ramsey): Saturday in Sept 6–12 — always the Saturday after Labor Day
    # Anoka Halloween: two parade Saturdays in October — 3rd Sat (opener) and 4th Sat (Grande Day)
    ("St. Francis Pioneer Days Festival",       "other", "FREQ=YEARLY;BYMONTH=5;BYDAY=-1FR",
     date(2026, 5, 29),  "St. Francis Pioneer Days — 3-day festival (Fri-Sun), last weekend of May. Parade on Saturday.", Priority.high,   [14, 7, 1], None),
    ("Happy Days Parade — Ramsey",              "other", "FREQ=YEARLY;BYMONTH=9;BYDAY=SA;BYMONTHDAY=6,7,8,9,10,11,12",
     date(2026, 9, 12),  "Happy Days Parade in Ramsey, MN — Saturday after Labor Day (Sept 6–12)",     Priority.high,   [7, 1], None),
    ("Halloween Parade — Anoka",                "other", "FREQ=YEARLY;BYMONTH=10;BYDAY=3SA",
     date(2025, 10, 18), "Anoka Halloween parade — 3rd Saturday of October (opening parade of the season)", Priority.high, [7, 1], None),
    ("Halloween Grande Day Parade — Anoka",     "other", "FREQ=YEARLY;BYMONTH=10;BYDAY=4SA",
     date(2026, 10, 24), "Halloween Grande Day Parade in Anoka, MN — 4th Saturday of October (main parade)", Priority.high, [7, 1], None),
]

CREDIT_CARDS = [
    CreditCard(name="T-Mobile Visa",         issuer="Capital One",    last_four="XXXX",
               statement_close_day=25, grace_period_days=25, weekend_shift=None),
    CreditCard(name="Blue Cash Preferred",   issuer="American Express", last_four="XXXX",
               statement_close_day=2,  grace_period_days=25, weekend_shift=WeekendShift.back_sat_only,
               annual_fee_month=9),
    CreditCard(name="Delta SkyMiles Amex",   issuer="American Express", last_four="XXXX",
               statement_close_day=17, grace_period_days=25, weekend_shift=WeekendShift.back),
    CreditCard(name="Costco Anywhere Visa",  issuer="Citi",            last_four="XXXX",
               statement_close_day=7,  grace_period_days=28, weekend_shift=WeekendShift.back),
    CreditCard(name="Target Circle Card",    issuer="Target/TD Bank",  last_four="XXXX",
               statement_close_day=1,  due_day_same_month=28, weekend_shift=WeekendShift.forward),
    CreditCard(name="Barclays Cash Forward", issuer="Barclays",        last_four="XXXX",
               statement_close_day=4,  due_day_next_month=1),
    CreditCard(name="Old Navy Encore",       issuer="Barclays",        last_four="XXXX",
               statement_close_day=4,  due_day_next_month=1),
    CreditCard(name="U.S. Bank Cash+ (9th)", issuer="U.S. Bank",       last_four="XXXX",
               statement_close_day=9,  due_day_next_month=6,  weekend_shift=WeekendShift.nearest,
               annual_fee_month=5),
    CreditCard(name="U.S. Bank Cash+ (13th)",issuer="U.S. Bank",       last_four="XXXX",
               statement_close_day=13, due_day_next_month=9,  weekend_shift=WeekendShift.nearest,
               annual_fee_month=10),
    CreditCard(name="U.S. Bank Altitude Go", issuer="U.S. Bank",       last_four="XXXX",
               cycle_days=29, cycle_reference_date=date(2026, 3, 26),
               due_day_next_month=24, annual_fee_month=5),
    CreditCard(name="Autograph Visa",        issuer="Wells Fargo",     last_four="XXXX",
               statement_close_day=17, due_day_next_month=11, weekend_shift=WeekendShift.back),
]


# ── Runtime migration ─────────────────────────────────────────────────────────

def _ensure_is_seeded_columns(db) -> None:
    """Add is_seeded BOOLEAN DEFAULT FALSE to tables that don't have it yet (idempotent)."""
    for table in ("categories", "events", "credit_cards"):
        db.execute(text(
            f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS is_seeded BOOLEAN DEFAULT FALSE"
        ))
    db.commit()


# ── is_seeded helpers (raw SQL — column not in ORM model) ────────────────────

def _mark_seeded(db, table: str, record_id: int) -> None:
    db.execute(
        text(f"UPDATE {table} SET is_seeded = TRUE WHERE id = :id"),
        {"id": record_id},
    )


def _get_seeded_ids(db, table: str) -> set[int]:
    """Return the set of IDs where is_seeded = TRUE."""
    rows = db.execute(
        text(f"SELECT id FROM {table} WHERE is_seeded = TRUE")
    ).fetchall()
    return {row[0] for row in rows}


# ── Category reconciliation ───────────────────────────────────────────────────

_CAT_COMPARE_FIELDS = ("color", "icon", "description")


def reconcile_categories(db) -> dict[str, int]:
    """
    Upsert categories by natural key (name).
    Returns {name: id} map needed for event FK resolution.
    """
    seed_map = {d["name"]: d for d in CATEGORIES}
    existing = {cat.name: cat for cat in db.query(Category).all()}
    seeded_ids = _get_seeded_ids(db, "categories")

    inserted = updated = skipped = deleted = 0
    cat_map: dict[str, int] = {}

    for name, data in seed_map.items():
        if name not in existing:
            cat = Category(
                name=data["name"],
                color=data.get("color", "#3b82f6"),
                icon=data.get("icon", "📅"),
                description=data.get("description"),
            )
            db.add(cat)
            db.flush()
            _mark_seeded(db, "categories", cat.id)
            cat_map[name] = cat.id
            inserted += 1
        else:
            cat = existing[name]
            changed = False
            for field in _CAT_COMPARE_FIELDS:
                new_val = data.get(field)
                if getattr(cat, field) != new_val:
                    setattr(cat, field, new_val)
                    changed = True
            _mark_seeded(db, "categories", cat.id)
            cat_map[name] = cat.id
            if changed:
                updated += 1
            else:
                skipped += 1

    # Delete seeded categories that were removed from seed data
    for name, cat in existing.items():
        if cat.id in seeded_ids and name not in seed_map:
            db.delete(cat)
            deleted += 1

    db.commit()
    print(f"Categories  — inserted: {inserted:3d}, updated: {updated:3d}, "
          f"skipped: {skipped:3d}, deleted: {deleted:3d}")
    return cat_map


# ── Event reconciliation ──────────────────────────────────────────────────────

_RECURRENCE_FIELDS = frozenset({"rrule", "dtstart"})
_EVENT_COMPARE_FIELDS = ("category_id", "rrule", "dtstart", "description",
                         "priority", "reminder_days", "amount")


def _event_diff(ev: Event, data: dict) -> tuple[bool, bool]:
    """Return (any_changed, recurrence_changed)."""
    any_ch = recur_ch = False
    for field in _EVENT_COMPARE_FIELDS:
        old_val = getattr(ev, field)
        new_val = data[field]
        # Normalize for comparison: Priority enum vs string, Decimal vs None, etc.
        if str(old_val) != str(new_val):
            any_ch = True
            if field in _RECURRENCE_FIELDS:
                recur_ch = True
    return any_ch, recur_ch


def reconcile_events(db, cat_map: dict[str, int]) -> None:
    """
    Upsert events (static + sports) by natural key (title, dtstart).

    When recurrence fields change:
      - Upcoming occurrences without a GCal link are deleted and regenerated.
      - GCal-linked occurrences are left in place (next sync will update them).
    When non-recurrence fields change:
      - Fields are updated in place; existing occurrences and GCal links preserved.
    For unchanged events:
      - Any new occurrence dates within the lookahead window are added.
    """
    today = date.today()
    mlb_year = today.year
    sports_season_year = today.year if today.month >= 7 else today.year - 1

    all_event_tuples = (
        EXAMPLE_EVENTS
        + fetch_mlb_schedule(mlb_year)
        + fetch_nba_schedule(sports_season_year)
        + fetch_nhl_schedule(sports_season_year)
    )

    # Build seed dict keyed by (title, dtstart)
    seed_events: dict[tuple, dict] = {}
    for title, cat_name, rrule, dtstart, desc, priority, reminder_days, amount in all_event_tuples:
        cat_id = cat_map.get(cat_name)
        if cat_id is None:
            print(f"  WARNING: category '{cat_name}' not found — skipping '{title}'")
            continue
        key = (title, dtstart)
        seed_events[key] = dict(
            title=title,
            category_id=cat_id,
            rrule=rrule,
            dtstart=dtstart,
            description=desc,
            priority=priority,
            reminder_days=reminder_days,
            amount=amount,
        )

    # Query existing non-credit-card events
    existing_evs: dict[tuple, Event] = {
        (ev.title, ev.dtstart): ev
        for ev in db.query(Event).filter(Event.credit_card_id.is_(None)).all()
    }
    seeded_ids = _get_seeded_ids(db, "events")

    inserted = updated = skipped = deleted = 0
    occ_added = occ_removed = 0

    for key, data in seed_events.items():
        if key not in existing_evs:
            ev = Event(
                title=data["title"],
                category_id=data["category_id"],
                rrule=data["rrule"],
                dtstart=data["dtstart"],
                description=data["description"],
                priority=data["priority"],
                reminder_days=data["reminder_days"],
                amount=data["amount"],
            )
            db.add(ev)
            db.flush()
            _mark_seeded(db, "events", ev.id)
            occ_added += generate_occurrences(db, ev)
            inserted += 1
        else:
            ev = existing_evs[key]
            any_ch, recur_ch = _event_diff(ev, data)
            _mark_seeded(db, "events", ev.id)

            if any_ch:
                for field in _EVENT_COMPARE_FIELDS:
                    setattr(ev, field, data[field])
                db.flush()

                if recur_ch:
                    # Remove upcoming occurrences without GCal linkage; regenerate
                    removed = (
                        db.query(Occurrence)
                        .filter(
                            Occurrence.event_id == ev.id,
                            Occurrence.status == OccurrenceStatus.upcoming,
                            Occurrence.gcal_event_id.is_(None),
                        )
                        .delete(synchronize_session=False)
                    )
                    occ_removed += removed
                    db.flush()

                occ_added += generate_occurrences(db, ev)
                updated += 1
            else:
                # Extend occurrences into the lookahead window if needed
                occ_added += generate_occurrences(db, ev)
                skipped += 1

    # Delete seeded events removed from seed data (cascades to occurrences)
    for key, ev in existing_evs.items():
        if ev.id in seeded_ids and key not in seed_events:
            db.delete(ev)
            deleted += 1

    db.commit()
    print(f"Events      — inserted: {inserted:3d}, updated: {updated:3d}, "
          f"skipped: {skipped:3d}, deleted: {deleted:3d}")
    print(f"Occurrences — added: {occ_added:4d}, removed (recurrence change): {occ_removed:4d}")


# ── Credit card reconciliation ────────────────────────────────────────────────

_CARD_COMPARE_FIELDS = (
    "issuer", "last_four", "statement_close_day", "grace_period_days",
    "weekend_shift", "cycle_days", "cycle_reference_date",
    "due_day_same_month", "due_day_next_month", "annual_fee_month", "is_active",
)


def _card_diff(card: CreditCard, seed_card: CreditCard) -> bool:
    for field in _CARD_COMPARE_FIELDS:
        if str(getattr(card, field)) != str(getattr(seed_card, field)):
            return True
    return False


def reconcile_credit_cards(db, cat_map: dict[str, int]) -> None:
    """
    Upsert credit cards by natural key (name, issuer).
    Calls ensure_card_events and generate_credit_card_occurrences for new or changed cards.
    """
    cc_cat_id = cat_map.get("credit_card")
    if cc_cat_id is None:
        cc_cat = db.query(Category).filter(Category.name == "credit_card").first()
        if not cc_cat:
            print("ERROR: 'credit_card' category not found — skipping credit card reconciliation.")
            return
        cc_cat_id = cc_cat.id

    existing: dict[tuple, CreditCard] = {
        (c.name, c.issuer): c
        for c in db.query(CreditCard).all()
    }
    seeded_ids = _get_seeded_ids(db, "credit_cards")
    seed_keys = {(c.name, c.issuer) for c in CREDIT_CARDS}

    inserted = updated = skipped = deleted = 0
    occ_added = 0

    for seed_card in CREDIT_CARDS:
        key = (seed_card.name, seed_card.issuer)
        if key not in existing:
            db.add(seed_card)
            db.flush()
            _mark_seeded(db, "credit_cards", seed_card.id)
            ensure_card_events(db, seed_card, cc_cat_id)
            occ_added += generate_credit_card_occurrences(db, seed_card)
            inserted += 1
        else:
            card = existing[key]
            _mark_seeded(db, "credit_cards", card.id)
            if _card_diff(card, seed_card):
                for field in _CARD_COMPARE_FIELDS:
                    setattr(card, field, getattr(seed_card, field))
                db.flush()
                ensure_card_events(db, card, cc_cat_id)
                occ_added += generate_credit_card_occurrences(db, card)
                updated += 1
            else:
                occ_added += generate_credit_card_occurrences(db, card)
                skipped += 1

    # Delete seeded cards removed from seed data (cascades to events + occurrences)
    for key, card in existing.items():
        if card.id in seeded_ids and key not in seed_keys:
            db.delete(card)
            deleted += 1

    db.commit()
    print(f"CreditCards — inserted: {inserted:3d}, updated: {updated:3d}, "
          f"skipped: {skipped:3d}, deleted: {deleted:3d}")
    print(f"CC Occurrences added: {occ_added}")


# ── Top-level commands ────────────────────────────────────────────────────────

def reconcile() -> None:
    """Reconcile all seed data against the DB (idempotent upsert)."""
    db = SessionLocal()
    try:
        print("Running is_seeded column migration...")
        _ensure_is_seeded_columns(db)

        print("\nReconciling categories...")
        cat_map = reconcile_categories(db)

        print("\nReconciling events...")
        reconcile_events(db, cat_map)

        print("\nReconciling credit cards...")
        reconcile_credit_cards(db, cat_map)

        print("\nDone.")
    finally:
        db.close()


def reconcile_cards_only() -> None:
    """Reconcile credit cards only (categories must already exist)."""
    db = SessionLocal()
    try:
        _ensure_is_seeded_columns(db)
        cat_map = {cat.name: cat.id for cat in db.query(Category).all()}
        print("Reconciling credit cards...")
        reconcile_credit_cards(db, cat_map)
        print("Done.")
    finally:
        db.close()


def legacy_reseed() -> None:
    """
    Legacy wipe-and-replace (v1 behavior). Kept for emergency use only.
    Destroys all GCal linkage and user-created records. Use reconcile() instead.
    """
    from seed_data import seed  # type: ignore[import]
    print()
    print("  WARNING: reseed is a destructive operation!")
    print("  This will wipe ALL existing data and re-seed from scratch.")
    print("  All GCal linkage and user-created records will be permanently destroyed.")
    print("  Use 'reconcile' instead unless you are certain this is what you want.")
    print()
    answer = input("  Type YES to continue, or anything else to abort: ").strip()
    if answer != "YES":
        print("Aborted.")
        sys.exit(0)
    print()
    seed(reseed=True)


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    args = sys.argv[1:]

    if not args or "--help" in args or "-h" in args:
        print("Usage: seed_datav2.py [command]")
        print()
        print("Commands:")
        print("  reconcile   Upsert all seed data (default — safe to re-run)")
        print("  seed        Alias for reconcile")
        print("  cards       Reconcile credit cards only")
        print("  reseed      Legacy wipe-and-replace (destroys GCal linkage)")
        print()
        print("Examples:")
        print("  ./seed_datav2.py")
        print("  ./seed_datav2.py reconcile")
        print("  ./seed_datav2.py cards")
        sys.exit(0)

    cmd = args[0]
    if cmd in ("reconcile", "seed"):
        reconcile()
    elif cmd == "cards":
        reconcile_cards_only()
    elif cmd == "reseed":
        legacy_reseed()
    else:
        print(f"Unknown command: {cmd}")
        print("Run ./seed_datav2.py --help for usage.")
        sys.exit(1)
