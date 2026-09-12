"""CSV export tests: escaping (quotes, commas, embedded newlines) and
the UTF-8 BOM Excel needs for accented characters. Uses the real FastAPI
app end-to-end via TestClient."""
from __future__ import annotations

import csv
import io

from fastapi.testclient import TestClient


def _client(db):
    import main

    return TestClient(main.app)


class TestCsvExport:
    def test_has_utf8_bom(self, db):
        db.upsert_lead(
            {"id": "p1", "displayName": {"text": "Test Biz"}, "businessStatus": "OPERATIONAL"}, "q"
        )
        with _client(db) as client:
            resp = client.get("/api/export/csv")
        assert resp.content[:3] == b"\xef\xbb\xbf"

    def test_round_trips_quotes_newlines_commas_and_accents(self, db):
        db.upsert_lead(
            {
                "id": "p1",
                "displayName": {"text": "Café Résumé & Co."},
                "formattedAddress": "5 Rue de la Paix, Montréal",
                "businessStatus": "OPERATIONAL",
            },
            "q",
        )
        lead_id = db.get_leads()[0]["id"]
        note = 'He said "call back", then hung up\nCalled again next day'
        db.update_lead(lead_id, notes=note, status="contacted", email="jose@café.com")

        with _client(db) as client:
            resp = client.get("/api/export/csv")

        # utf-8-sig strips the BOM automatically, exactly what Excel does
        # when it sees one -- this is the realistic round trip to test.
        text = resp.content.decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(text))
        row = next(reader)

        assert row["name"] == "Café Résumé & Co."
        assert row["notes"] == note
        assert row["email"] == "jose@café.com"
        assert row["address"] == "5 Rue de la Paix, Montréal"

    def test_export_respects_active_filters(self, db):
        db.upsert_lead({"id": "p1", "displayName": {"text": "Biz A"}, "businessStatus": "OPERATIONAL"}, "q")
        db.upsert_lead({"id": "p2", "displayName": {"text": "Biz B"}, "businessStatus": "OPERATIONAL"}, "q")
        leads = db.get_leads()
        db.update_lead(leads[0]["id"], status="contacted")

        with _client(db) as client:
            resp = client.get("/api/export/csv", params={"status": "contacted"})

        text = resp.content.decode("utf-8-sig")
        rows = list(csv.DictReader(io.StringIO(text)))
        assert len(rows) == 1
        assert rows[0]["status"] == "contacted"

    def test_empty_export_still_has_header_row(self, db):
        with _client(db) as client:
            resp = client.get("/api/export/csv")
        text = resp.content.decode("utf-8-sig")
        rows = list(csv.reader(io.StringIO(text)))
        assert rows[0] == [
            "name", "phone", "email", "website", "address", "status",
            "notes", "date_contacted", "followup_date",
        ]
        assert len(rows) == 1
