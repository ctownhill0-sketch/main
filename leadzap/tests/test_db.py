"""Tests for db.py: Places response parsing into the schema, the
dedupe/upsert guarantees, and the Needs Follow-Up filter's date-boundary
logic. Every test gets its own throwaway database via the `db` fixture
in conftest.py."""
from __future__ import annotations

from datetime import date, timedelta


def _place(place_id, **overrides):
    base = {
        "id": place_id,
        "displayName": {"text": "Test Business"},
        "formattedAddress": "1 Main St",
        "nationalPhoneNumber": "555-0000",
        "websiteUri": None,
        "rating": 4.0,
        "userRatingCount": 1,
        "businessStatus": "OPERATIONAL",
    }
    base.update(overrides)
    return base


class TestPlacesResponseParsing:
    def test_extracts_nested_display_name_text(self, db):
        db.upsert_lead(_place("p1", displayName={"text": "Joe's Pizza", "languageCode": "en"}), "q")
        lead = db.get_leads()[0]
        assert lead["name"] == "Joe's Pizza"

    def test_missing_optional_fields_become_null_not_string_none(self, db):
        place = {"id": "p2", "displayName": {"text": "No Phone Biz"}, "businessStatus": "OPERATIONAL"}
        db.upsert_lead(place, "q")
        lead = db.get_leads()[0]
        assert lead["phone"] is None
        assert lead["website"] is None
        assert lead["rating"] is None
        assert lead["review_count"] is None
        assert lead["phone"] != "None"  # the literal string, which a naive str() cast could produce

    def test_zero_review_business_is_stored_as_zero_not_null(self, db):
        db.upsert_lead(_place("p3", rating=0.0, userRatingCount=0), "q")
        lead = db.get_leads()[0]
        assert lead["rating"] == 0.0
        assert lead["review_count"] == 0

    def test_non_operational_business_is_skipped(self, db):
        outcome = db.upsert_lead(_place("p4", businessStatus="CLOSED_PERMANENTLY"), "q")
        assert outcome == "skipped"
        assert db.get_leads() == []

    def test_missing_place_id_is_skipped(self, db):
        place = {"displayName": {"text": "No ID Biz"}, "businessStatus": "OPERATIONAL"}
        assert db.upsert_lead(place, "q") == "skipped"

    def test_missing_display_name_falls_back_to_placeholder(self, db):
        place = {"id": "p5", "businessStatus": "OPERATIONAL"}
        db.upsert_lead(place, "q")
        lead = db.get_leads()[0]
        assert lead["name"]  # non-empty, doesn't crash


class TestDedupeAndUpsert:
    """The single most important guarantee in this app: re-running a
    search must never lose pipeline data on an existing lead."""

    def test_duplicate_place_id_does_not_create_a_second_row(self, db):
        db.upsert_lead(_place("dup1"), "q")
        db.upsert_lead(_place("dup1"), "q")
        assert len(db.get_leads()) == 1

    def test_resarch_refreshes_business_fields(self, db):
        db.upsert_lead(_place("p1", nationalPhoneNumber="555-0001", rating=4.0), "first query")
        lead_id = db.get_leads()[0]["id"]
        db.upsert_lead(_place("p1", nationalPhoneNumber="555-9999", rating=4.8, userRatingCount=99), "second query")
        lead = db.get_lead(lead_id)
        assert lead["phone"] == "555-9999"
        assert lead["rating"] == 4.8
        assert lead["review_count"] == 99
        assert lead["date_last_refreshed"] is not None

    def test_research_never_touches_pipeline_fields(self, db):
        db.upsert_lead(_place("p1"), "original query")
        lead_id = db.get_leads()[0]["id"]
        db.update_lead(
            lead_id,
            status="contacted",
            notes="Left voicemail, promising lead",
            date_contacted="2026-09-01",
            followup_date="2026-09-04",
            email="joe@testbusiness.com",
            email_confidence="high",
            enrichment_status="found",
        )

        db.upsert_lead(_place("p1", nationalPhoneNumber="555-9999"), "a completely different query")

        lead = db.get_lead(lead_id)
        assert lead["status"] == "contacted"
        assert lead["notes"] == "Left voicemail, promising lead"
        assert lead["date_contacted"] == "2026-09-01"
        assert lead["followup_date"] == "2026-09-04"
        assert lead["email"] == "joe@testbusiness.com"
        assert lead["email_confidence"] == "high"
        assert lead["enrichment_status"] == "found"
        assert lead["search_query"] == "original query"  # never overwritten to the newer query
        assert len(db.get_leads()) == 1  # still no duplicate

    def test_website_appearing_resets_enrichment_status_to_pending(self, db):
        db.upsert_lead(_place("p1", websiteUri=None), "q")
        lead_id = db.get_leads()[0]["id"]
        db.update_lead(lead_id, status="contacted", notes="called", enrichment_status="no_website")

        db.upsert_lead(_place("p1", websiteUri="https://newsite.com"), "q")

        lead = db.get_lead(lead_id)
        assert lead["enrichment_status"] == "pending"
        assert lead["website"] == "https://newsite.com"
        assert lead["status"] == "contacted"  # pipeline fields still untouched
        assert lead["notes"] == "called"

    def test_stale_found_or_failed_verdict_also_resets_on_website_change(self, db):
        for start_status in ("failed", "not_found", "found"):
            place_id = f"p_{start_status}"
            db.upsert_lead(_place(place_id, websiteUri=None), "q")
            lead_id = next(l["id"] for l in db.get_leads() if l["place_id"] == place_id)
            db.update_lead(
                lead_id, enrichment_status=start_status, email="old@stale.com", email_confidence="high"
            )
            db.upsert_lead(_place(place_id, websiteUri="https://fixed-site.com"), "q")
            lead = db.get_lead(lead_id)
            assert lead["enrichment_status"] == "pending"
            assert lead["email"] == "old@stale.com"  # old email KEPT, not cleared

    def test_domain_migration_also_resets_enrichment_status(self, db):
        db.upsert_lead(_place("p1", websiteUri="https://old-domain.com"), "q")
        lead_id = db.get_leads()[0]["id"]
        db.update_lead(lead_id, enrichment_status="found", email="joe@old-domain.com")
        db.upsert_lead(_place("p1", websiteUri="https://new-domain.com"), "q")
        lead = db.get_lead(lead_id)
        assert lead["enrichment_status"] == "pending"
        assert lead["website"] == "https://new-domain.com"
        assert lead["email"] == "joe@old-domain.com"

    def test_unchanged_website_does_not_reset_enrichment_status(self, db):
        db.upsert_lead(_place("p1", websiteUri="https://stable.com"), "q")
        lead_id = db.get_leads()[0]["id"]
        db.update_lead(lead_id, enrichment_status="found", email="x@stable.com")
        db.upsert_lead(_place("p1", websiteUri="https://stable.com", displayName={"text": "Renamed Biz"}), "q")
        lead = db.get_lead(lead_id)
        assert lead["enrichment_status"] == "found"
        assert lead["name"] == "Renamed Biz"  # business fields still refresh normally

    def test_website_disappearing_resets_to_no_website(self, db):
        db.upsert_lead(_place("p1", websiteUri="https://gone-soon.com"), "q")
        lead_id = db.get_leads()[0]["id"]
        db.update_lead(lead_id, enrichment_status="found", email="x@gone-soon.com")
        db.upsert_lead(_place("p1", websiteUri=None), "q")
        lead = db.get_lead(lead_id)
        assert lead["enrichment_status"] == "no_website"
        assert lead["email"] == "x@gone-soon.com"


class TestMigration:
    def test_init_db_adds_missing_column_without_touching_existing_data(self, db, monkeypatch):
        import sqlite3

        # Simulate a database created BEFORE date_last_refreshed existed.
        conn = sqlite3.connect(db.DB_PATH)
        conn.execute("DROP TABLE IF EXISTS leads")
        conn.execute(
            """CREATE TABLE leads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                place_id TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'new',
                notes TEXT,
                date_contacted TEXT,
                followup_date TEXT
            )"""
        )
        conn.execute(
            "INSERT INTO leads (place_id, name, status, notes, date_contacted, followup_date) "
            "VALUES ('legacy_1', 'Legacy Lead Co', 'contacted', 'called twice', '2026-08-01', '2026-08-04')"
        )
        conn.commit()
        conn.close()

        db.init_db()

        lead = db.get_leads()[0]
        assert "date_last_refreshed" in lead
        assert lead["status"] == "contacted"
        assert lead["notes"] == "called twice"
        assert lead["date_contacted"] == "2026-08-01"
        assert lead["followup_date"] == "2026-08-04"
        assert lead["name"] == "Legacy Lead Co"


class TestNeedsFollowupFilter:
    """Boundary cases around today's date and status. Fires for
    new/contacted/replied/call_booked with a followup_date today or
    earlier; excludes terminal statuses without ever clearing their
    date; a lead with no followup_date never appears."""

    def _make(self, db, place_id, status, followup_date):
        db.upsert_lead(_place(place_id), "q")
        lead_id = next(l["id"] for l in db.get_leads() if l["place_id"] == place_id)
        db.update_lead(lead_id, status=status, followup_date=followup_date)
        return lead_id

    def test_boundary_cases(self, db):
        today = date.today().isoformat()
        yesterday = (date.today() - timedelta(days=1)).isoformat()
        tomorrow = (date.today() + timedelta(days=1)).isoformat()

        cases = {
            "a_new_today": ("new", today, True),
            "b_contacted_today": ("contacted", today, True),
            "c_replied_today": ("replied", today, True),
            "d_call_booked_today": ("call_booked", today, True),
            "e_contacted_overdue": ("contacted", yesterday, True),
            "f_contacted_future": ("contacted", tomorrow, False),
            "g_contacted_no_date": ("contacted", None, False),
            "h_closed_won_overdue": ("closed_won", yesterday, False),
            "i_closed_lost_today": ("closed_lost", today, False),
            "j_not_a_fit_today": ("not_a_fit", today, False),
        }
        for place_id, (status, followup, _) in cases.items():
            self._make(db, place_id, status, followup)

        matching = {l["place_id"] for l in db.get_leads(needs_followup=True)}

        for place_id, (_, _, expected) in cases.items():
            assert (place_id in matching) == expected, f"{place_id} expected {expected}"

    def test_reopening_a_terminal_lead_makes_its_old_date_relevant_again(self, db):
        # Terminal statuses never CLEAR followup_date -- moving back to
        # an active status should make that date matter again.
        yesterday = (date.today() - timedelta(days=1)).isoformat()
        lead_id = self._make(db, "p1", "closed_lost", yesterday)
        assert "p1" not in {l["place_id"] for l in db.get_leads(needs_followup=True)}

        db.update_lead(lead_id, status="contacted")
        assert "p1" in {l["place_id"] for l in db.get_leads(needs_followup=True)}


class TestPlacesRequestCounter:
    """The persisted usage counter Phase 7 added, so the UI's cumulative
    count and soft-cap warning can be trusted."""

    def test_starts_at_zero(self, db):
        assert db.get_places_request_count() == 0

    def test_increments_and_persists(self, db):
        assert db.increment_places_request_count(3) == 3
        assert db.increment_places_request_count(2) == 5
        assert db.get_places_request_count() == 5

    def test_zero_or_negative_increment_is_a_no_op(self, db):
        db.increment_places_request_count(5)
        assert db.increment_places_request_count(0) == 5
        assert db.get_places_request_count() == 5

    def test_survives_a_fresh_connection(self, db):
        db.increment_places_request_count(7)
        # get_places_request_count opens its own connection, same as a
        # real second request would -- confirms it's actually persisted
        # to disk, not just held in memory.
        assert db.get_places_request_count() == 7

    def test_last_warned_tracking(self, db):
        assert db.get_last_warned_request_count() == 0
        db.set_last_warned_request_count(250)
        assert db.get_last_warned_request_count() == 250
        db.set_last_warned_request_count(500)
        assert db.get_last_warned_request_count() == 500
