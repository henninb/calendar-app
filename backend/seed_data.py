#!/usr/bin/env python3
"""
Seed the database with default categories and example events.

Run once after the DB is created:
    python seed_data.py

Requires DATABASE_URL in .env or environment.
"""
import urllib.request
import json
from datetime import date, datetime, timezone, timedelta
from app.config import settings
from app.database import SessionLocal, Base, engine
from app.models import Category, CreditCard, Event, Occurrence, Priority, WeekendShift
from app.services.recurrence import generate_all_occurrences
from app.services.credit_card import ensure_card_events, generate_credit_card_occurrences

Base.metadata.create_all(bind=engine)


def _to_ct(dt: datetime) -> str:
    """Convert a UTC-aware datetime to a Central Time string."""
    year = dt.year
    # DST starts 2nd Sunday of March at 2am, ends 1st Sunday of November at 2am
    # Approximate using fixed offsets (close enough for display purposes)
    mar_second_sun = date(year, 3, 8 + (6 - date(year, 3, 1).weekday()) % 7)
    nov_first_sun  = date(year, 11, 1 + (6 - date(year, 11, 1).weekday()) % 7)
    dst_start = datetime(year, mar_second_sun.month, mar_second_sun.day, 8, 0, tzinfo=timezone.utc)
    dst_end   = datetime(year, nov_first_sun.month,  nov_first_sun.day,  7, 0, tzinfo=timezone.utc)
    offset = timedelta(hours=-5) if dst_start <= dt < dst_end else timedelta(hours=-6)
    return (dt + offset).strftime('%I:%M %p CT')


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
    """Fetch the Timberwolves schedule for the given season start year from fixturedownload.com.

    season_year=2025 → the 2025-26 NBA season.
    """
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
    """Fetch the Wild schedule for the given season start year from fixturedownload.com.

    season_year=2025 → the 2025-26 NHL season.
    """
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


CATEGORIES = settings.categories

# (title, category_name, rrule, dtstart, description, priority, reminder_days, amount)
# RRULE reference:
#   FREQ=YEARLY;BYMONTH=M;BYMONTHDAY=D  → every year on month M, day D
#   FREQ=MONTHLY;BYMONTHDAY=D           → every month on day D
#   FREQ=MONTHLY;INTERVAL=N             → every N months from dtstart
#   FREQ=YEARLY;BYMONTH=M1,M2           → twice a year in M1 and M2
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
    ("Black Hat USA 2026",                "other",         None,
     date(2026, 8, 1),    "Black Hat USA 2026 — Mandalay Bay, Las Vegas. Trainings Aug 1-4, Briefings Aug 5-6", Priority.high, [30, 7], None),
    ("DEF CON 2026",                      "other",         None,
     date(2026, 8, 6),    "DEF CON 2026 — Las Vegas Convention Center, Aug 6-9",  Priority.high, [30, 7], None),
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


def clear(db):
    """Delete all seeded data in dependency order."""
    synced = db.query(Occurrence).filter(Occurrence.gcal_event_id.isnot(None)).count()
    if synced:
        raise RuntimeError(
            f"{synced} occurrence(s) are still linked to Google Calendar events "
            f"(gcal_event_id is set). Wipe Google Calendar first using the "
            f"'💣 Wipe Google Cal' button in the UI, then re-run seed_data.py. "
            f"Re-seeding without wiping GCal first creates orphaned GCal events "
            f"and breaks all sync linkage."
        )
    db.query(Occurrence).delete()
    db.query(Event).delete()
    db.query(CreditCard).delete()
    db.query(Category).delete()
    db.commit()
    print("Cleared all existing data.")


def seed(reseed: bool = False):
    db = SessionLocal()
    try:
        if db.query(Category).count() > 0:
            if not reseed:
                print("Database already seeded — skipping.")
                return
            clear(db)

        # Insert categories
        cat_map: dict[str, int] = {}
        for data in CATEGORIES:
            cat = Category(**data)
            db.add(cat)
            db.flush()
            cat_map[cat.name] = cat.id
        db.commit()
        print(f"Inserted {len(CATEGORIES)} categories.")

        # Insert events (static + dynamically fetched sports schedules)
        today = date.today()
        mlb_year = today.year
        # NBA season: if before July the current season started last year
        nba_season_year = today.year if today.month >= 7 else today.year - 1
        # NHL season: same cadence as NBA — starts in October
        nhl_season_year = today.year if today.month >= 7 else today.year - 1
        all_events = (EXAMPLE_EVENTS
                      + fetch_mlb_schedule(mlb_year)
                      + fetch_nba_schedule(nba_season_year)
                      + fetch_nhl_schedule(nhl_season_year))
        for title, cat_name, rrule, dtstart, desc, priority, reminder_days, amount in all_events:
            ev = Event(
                title=title,
                category_id=cat_map[cat_name],
                rrule=rrule,
                dtstart=dtstart,
                description=desc,
                priority=priority,
                reminder_days=reminder_days,
                amount=amount,
            )
            db.add(ev)
        db.commit()
        print(f"Inserted {len(all_events)} events ({len(EXAMPLE_EVENTS)} static + sports schedules).")

        # Insert credit cards + auto-create their close/due/fee events
        cc_cat_id = cat_map["credit_card"]
        for card in CREDIT_CARDS:
            db.add(card)
            db.flush()
            ensure_card_events(db, card, cc_cat_id)
        db.commit()
        print(f"Inserted {len(CREDIT_CARDS)} credit cards.")

        # Generate occurrences (events + credit cards)
        result = generate_all_occurrences(db)
        print(
            f"Generated {result['occurrences_created']} occurrences "
            f"across {result['events_processed']} events."
        )

        cc_total = 0
        for card in db.query(CreditCard).all():
            cc_total += generate_credit_card_occurrences(db, card)
        print(f"Generated {cc_total} credit card occurrences.")

    finally:
        db.close()


def seed_cards():
    """Seed only credit cards — safe to run when categories/events already exist."""
    db = SessionLocal()
    try:
        if db.query(CreditCard).count() > 0:
            print("Credit cards already seeded — skipping.")
            return
        cc_cat = db.query(Category).filter(Category.name == "credit_card").first()
        if not cc_cat:
            print("ERROR: credit_card category not found. Run seed() first.")
            return
        for card in CREDIT_CARDS:
            db.add(card)
            db.flush()
            ensure_card_events(db, card, cc_cat.id)
        db.commit()
        print(f"Inserted {len(CREDIT_CARDS)} credit cards.")
        total = 0
        for card in db.query(CreditCard).all():
            total += generate_credit_card_occurrences(db, card)
        print(f"Generated {total} credit card occurrences.")
    finally:
        db.close()


if __name__ == "__main__":
    import sys
    args = sys.argv[1:]
    if not args or "--help" in args or "-h" in args:
        print("Usage: seed_data.py [command]")
        print()
        print("Commands:")
        print("  seed      Seed the database (default — skips if already seeded)")
        print("  reseed    Clear all data and re-seed from scratch")
        print("  cards     Seed credit cards only (requires categories to exist)")
        print()
        print("Examples:")
        print("  ./seed_data.py")
        print("  ./seed_data.py reseed")
        print("  ./seed_data.py cards")
        sys.exit(0)
    if "cards" in args:
        seed_cards()
    elif "reseed" in args:
        print()
        print("  WARNING: reseed is a destructive operation!")
        print("  This will wipe ALL existing data and re-seed from scratch.")
        print("  All GCal linkage and user-created records will be permanently destroyed.")
        print("  Use 'seed' instead unless you are certain this is what you want.")
        print()
        answer = input("  Type YES to continue, or anything else to abort: ").strip()
        if answer != "YES":
            print("Aborted.")
            sys.exit(0)
        print()
        seed(reseed=True)
    elif "seed" in args:
        seed()
    else:
        print(f"Unknown command: {args[0]}")
        print("Run ./seed_data.py --help for usage.")
        sys.exit(1)
