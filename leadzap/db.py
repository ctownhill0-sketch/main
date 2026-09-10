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
    raw_json            TEXT
);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_followup_date ON leads(followup_date);
"""

# Columns a caller may update via update_lead(). Kept explicit as an
# allowlist so a bad key can never be interpolated into SQL.
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
    """Create the leads table and indexes if they don't already exist."""
    with get_conn() as conn:
        conn.executescript(SCHEMA)


def insert_lead(place: dict[str, Any], search_query: str) -> bool:
    """Insert one Places API result as a lead.

    Skips (returns False) businesses missing an id, businesses that are
    not OPERATIONAL, and duplicates already present by place_id.
    Returns True only when a new row was inserted.
    """
    place_id = place.get("id")
    if not place_id:
        return False
    if place.get("businessStatus") != "OPERATIONAL":
        return False

    display_name = (place.get("displayName") or {}).get("text", "") or "Unnamed business"
    website = place.get("websiteUri")

    with get_conn() as conn:
        cur = conn.execute(
            """INSERT OR IGNORE INTO leads
               (place_id, name, address, phone, website, rating, review_count,
                enrichment_status, status, search_query, date_added, raw_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)""",
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
                date.today().isoformat(),
                json.dumps(place),
            ),
        )
        return cur.rowcount > 0


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
