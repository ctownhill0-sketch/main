"""SQLite schema and query helpers for LeadZap.

Plain SQL, no ORM — this is a single-user local tool. All functions open
and close their own connection; SQLite handles the concurrency fine for a
tool used by one person at a time.
"""
from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import date
from typing import Any, Iterator, Optional

DB_PATH = os.environ.get("LEADZAP_DB_PATH", os.path.join(os.path.dirname(__file__), "leadzap.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS leads (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    place_id            TEXT UNIQUE NOT NULL,
    name                TEXT NOT NULL,
    address             TEXT,
    phone               TEXT,
    website             TEXT,
    rating              REAL,
    review_count        INTEGER,
    email               TEXT,
    email_source_url    TEXT,
    email_confidence    TEXT,
    enrichment_status   TEXT NOT NULL DEFAULT 'pending',
    status              TEXT NOT NULL DEFAULT 'new',
    notes               TEXT,
    search_query        TEXT,
    date_added          TEXT,
    date_contacted       TEXT,
    followup_date       TEXT,
    date_last_refreshed TEXT,
    raw_json            TEXT
);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_followup_date ON leads(followup_date);
"""

# Columns added after a database may already exist on disk. Checked against
# PRAGMA table_info on every startup and added with ALTER TABLE if missing,
# so upgrading LeadZap never requires dropping (or migrating by hand) an
# existing leads.db. Add future new columns here, never by editing SCHEMA
# alone — SCHEMA's CREATE TABLE only runs for a brand-new database.
SCHEMA_MIGRATIONS: dict[str, str] = {
    "date_last_refreshed": "ALTER TABLE leads ADD COLUMN date_last_refreshed TEXT",
}

# Columns a caller may update via update_lead(). Kept explicit as an
# allowlist so a bad key can never be interpolated into SQL. Deliberately
# excludes date_last_refreshed, which only upsert_lead() should touch.
UPDATABLE_COLUMNS = {
    "name", "address", "phone", "website", "rating", "review_count",
    "email", "email_source_url", "email_confidence", "enrichment_status",
    "status", "notes", "date_contacted", "followup_date",
}


@contextmanager
def get_conn() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    """Create the leads table and indexes if missing, then apply any
    pending column migrations. Safe to call on every startup — never
    drops or rewrites existing data."""
    with get_conn() as conn:
        conn.executescript(SCHEMA)
        existing_columns = {row["name"] for row in conn.execute("PRAGMA table_info(leads)")}
        for column, ddl in SCHEMA_MIGRATIONS.items():
            if column not in existing_columns:
                conn.execute(ddl)


def upsert_lead(place: dict[str, Any], search_query: str) -> str:
    """Insert a new lead from a Places API result, or refresh an existing
    one's business-sourced fields if it was already saved (matched by
    place_id).

    On a re-search hit, ONLY business-sourced fields are touched: name,
    address, phone, website, rating, review_count, raw_json, plus
    date_last_refreshed. Pipeline fields — status, notes, date_contacted,
    followup_date, enrichment_status, email, email_confidence,
    email_source_url, search_query (the query that *first* found it),
    date_added — are never modified on an existing row. This is the one
    guarantee re-running a search must never break.

    Returns "inserted", "updated", or "skipped" (missing id, or the
    business is not OPERATIONAL).
    """
    place_id = place.get("id")
    if not place_id:
        return "skipped"
    if place.get("businessStatus") != "OPERATIONAL":
        return "skipped"

    display_name = (place.get("displayName") or {}).get("text", "") or "Unnamed business"
    website = place.get("websiteUri")
    today = date.today().isoformat()

    with get_conn() as conn:
        existing = conn.execute(
            "SELECT id FROM leads WHERE place_id = ?", (place_id,)
        ).fetchone()

        if existing is None:
            conn.execute(
                """INSERT INTO leads
                   (place_id, name, address, phone, website, rating, review_count,
                    enrichment_status, status, search_query, date_added,
                    date_last_refreshed, raw_json)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?)""",
                (
                    place_id,
                    display_name,
                    place.get("formattedAddress"),
                    place.get("nationalPhoneNumber"),
                    website,
                    place.get("rating"),
                    place.get("userRatingCount"),
                    "no_website" if not website else "pending",
                    search_query,
                    today,
                    today,
                    json.dumps(place),
                ),
            )
            return "inserted"

        conn.execute(
            """UPDATE leads
               SET name = ?, address = ?, phone = ?, website = ?,
                   rating = ?, review_count = ?, date_last_refreshed = ?, raw_json = ?
               WHERE place_id = ?""",
            (
                display_name,
                place.get("formattedAddress"),
                place.get("nationalPhoneNumber"),
                website,
                place.get("rating"),
                place.get("userRatingCount"),
                today,
                json.dumps(place),
                place_id,
            ),
        )
        return "updated"


def get_lead(lead_id: int) -> Optional[dict[str, Any]]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM leads WHERE id = ?", (lead_id,)).fetchone()
        return dict(row) if row else None


def get_leads(
    status: Optional[str] = None,
    has_email: Optional[bool] = None,
    needs_followup: bool = False,
    q: Optional[str] = None,
) -> list[dict[str, Any]]:
    """Return leads matching the given filters, newest first."""
    query = "SELECT * FROM leads WHERE 1=1"
    params: list[Any] = []

    if status:
        query += " AND status = ?"
        params.append(status)

    if has_email is True:
        query += " AND email IS NOT NULL AND email != ''"
    elif has_email is False:
        query += " AND (email IS NULL OR email = '')"

    if needs_followup:
        query += (
            " AND status = 'contacted' AND followup_date IS NOT NULL"
            " AND followup_date != '' AND date(followup_date) <= date('now')"
        )

    if q:
        query += " AND (name LIKE ? OR address LIKE ?)"
        like = f"%{q}%"
        params.extend([like, like])

    query += " ORDER BY id DESC"

    with get_conn() as conn:
        rows = conn.execute(query, params).fetchall()
        return [dict(r) for r in rows]


def get_lead_ids_missing_enrichment() -> list[int]:
    """IDs of leads that have a website but have never been enriched."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id FROM leads WHERE enrichment_status = 'pending'"
            " AND website IS NOT NULL AND website != ''"
        ).fetchall()
        return [r["id"] for r in rows]


def update_lead(lead_id: int, **fields: Any) -> None:
    """Update arbitrary columns on a lead. Unknown columns are rejected."""
    fields = {k: v for k, v in fields.items() if k in UPDATABLE_COLUMNS}
    if not fields:
        return
    columns = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [lead_id]
    with get_conn() as conn:
        conn.execute(f"UPDATE leads SET {columns} WHERE id = ?", values)


def get_stats() -> dict[str, int]:
    """Summary counts for the stats row."""
    with get_conn() as conn:
        def count(where: str = "1=1", params: tuple = ()) -> int:
            return conn.execute(f"SELECT COUNT(*) c FROM leads WHERE {where}", params).fetchone()["c"]

        return {
            "total": count(),
            "contacted": count("status = 'contacted'"),
            "replied": count("status = 'replied'"),
            "call_booked": count("status = 'call_booked'"),
            "closed_won": count("status = 'closed_won'"),
            "emails_found": count("email IS NOT NULL AND email != ''"),
        }
