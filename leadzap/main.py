"""LeadZap: local lead generation, enrichment, and outreach tracker.

Run with: uvicorn main:app --reload
"""
from __future__ import annotations

import csv
import io
import os
from datetime import date, timedelta
from typing import Any, Optional

from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import db
import enrich
import places

load_dotenv()

APP_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(APP_DIR, "static")
DEFAULT_FOLLOWUP_DAYS = 3

app = FastAPI(title="LeadZap")

# In-memory state for the currently running (if any) enrichment batch.
# A single-user local tool only ever has one job running at a time, so a
# module-level dict is sufficient — no job queue needed.
enrichment_progress: dict[str, Any] = {
    "running": False,
    "total": 0,
    "done": 0,
    "current_name": "",
}


@app.on_event("startup")
def on_startup() -> None:
    db.init_db()


# ---------------------------------------------------------------------------
# Static frontend
# ---------------------------------------------------------------------------

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


# ---------------------------------------------------------------------------
# Lead search
# ---------------------------------------------------------------------------

class SearchRequest(BaseModel):
    query: str
    max_results: int = 20


@app.post("/api/search")
def search_leads(payload: SearchRequest) -> dict[str, Any]:
    query = payload.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Search query is required.")

    max_results = max(1, min(payload.max_results, 60))
    api_key = os.environ.get("GOOGLE_PLACES_API_KEY", "")

    try:
        found = places.search_text(query, api_key, max_results)
    except places.PlacesAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    inserted = updated = skipped = 0
    for place in found:
        outcome = db.upsert_lead(place, query)
        if outcome == "inserted":
            inserted += 1
        elif outcome == "updated":
            updated += 1
        else:
            skipped += 1

    return {
        "total_found": len(found),
        "inserted": inserted,
        "updated": updated,
        "skipped": skipped,
    }


# ---------------------------------------------------------------------------
# Leads listing, filtering, stats
# ---------------------------------------------------------------------------

@app.get("/api/leads")
def list_leads(
    status: Optional[str] = None,
    has_email: Optional[bool] = None,
    needs_followup: bool = False,
    q: Optional[str] = None,
) -> list[dict[str, Any]]:
    return db.get_leads(status=status, has_email=has_email, needs_followup=needs_followup, q=q)


@app.get("/api/stats")
def get_stats() -> dict[str, int]:
    return db.get_stats()


class LeadUpdate(BaseModel):
    status: Optional[str] = None
    notes: Optional[str] = None
    followup_date: Optional[str] = None


@app.patch("/api/leads/{lead_id}")
def update_lead(lead_id: int, payload: LeadUpdate) -> dict[str, Any]:
    lead = db.get_lead(lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found.")

    fields: dict[str, Any] = {}

    if payload.status is not None and payload.status != lead["status"]:
        fields["status"] = payload.status
        if payload.status == "contacted":
            today = date.today()
            fields["date_contacted"] = today.isoformat()
            if payload.followup_date is None and not lead.get("followup_date"):
                fields["followup_date"] = (today + timedelta(days=DEFAULT_FOLLOWUP_DAYS)).isoformat()

    if payload.notes is not None:
        fields["notes"] = payload.notes

    if payload.followup_date is not None:
        fields["followup_date"] = payload.followup_date or None

    if fields:
        db.update_lead(lead_id, **fields)

    return db.get_lead(lead_id)


# ---------------------------------------------------------------------------
# Enrichment
# ---------------------------------------------------------------------------

class EnrichRequest(BaseModel):
    lead_ids: list[int]


def _run_enrichment_job(lead_ids: list[int]) -> None:
    """Runs in a worker thread (via FastAPI's BackgroundTasks) so the
    server keeps answering progress-poll requests while it works."""
    enrichment_progress.update(running=True, total=len(lead_ids), done=0, current_name="")
    try:
        for lead_id in lead_ids:
            lead = db.get_lead(lead_id)
            if not lead:
                enrichment_progress["done"] += 1
                continue

            enrichment_progress["current_name"] = lead["name"]
            result = enrich.enrich_lead(lead.get("website"))
            db.update_lead(
                lead_id,
                enrichment_status=result.status,
                email=result.email,
                email_source_url=result.source_url,
                email_confidence=result.confidence,
            )
            enrichment_progress["done"] += 1
    finally:
        enrichment_progress["running"] = False


@app.post("/api/enrich/selected")
def enrich_selected(payload: EnrichRequest, background_tasks: BackgroundTasks) -> dict[str, Any]:
    if enrichment_progress["running"]:
        raise HTTPException(status_code=409, detail="An enrichment job is already running.")
    if not payload.lead_ids:
        raise HTTPException(status_code=400, detail="No leads selected.")
    background_tasks.add_task(_run_enrichment_job, payload.lead_ids)
    return {"started": True, "count": len(payload.lead_ids)}


@app.post("/api/enrich/all-missing")
def enrich_all_missing(background_tasks: BackgroundTasks) -> dict[str, Any]:
    if enrichment_progress["running"]:
        raise HTTPException(status_code=409, detail="An enrichment job is already running.")
    lead_ids = db.get_lead_ids_missing_enrichment()
    background_tasks.add_task(_run_enrichment_job, lead_ids)
    return {"started": True, "count": len(lead_ids)}


@app.get("/api/enrich/progress")
def enrich_progress() -> dict[str, Any]:
    return enrichment_progress


# ---------------------------------------------------------------------------
# CSV export
# ---------------------------------------------------------------------------

EXPORT_COLUMNS = [
    "name", "phone", "email", "website", "address", "status",
    "notes", "date_contacted", "followup_date",
]


@app.get("/api/export/csv")
def export_csv(
    status: Optional[str] = None,
    has_email: Optional[bool] = None,
    needs_followup: bool = False,
    q: Optional[str] = None,
) -> StreamingResponse:
    leads = db.get_leads(status=status, has_email=has_email, needs_followup=needs_followup, q=q)

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(EXPORT_COLUMNS)
    for lead in leads:
        writer.writerow([lead.get(col) or "" for col in EXPORT_COLUMNS])
    buffer.seek(0)

    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=leadzap_export.csv"},
    )
