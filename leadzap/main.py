"""LeadZap: local lead generation, enrichment, and outreach tracker.

Run with: uvicorn main:app --reload
"""
from __future__ import annotations

import concurrent.futures
import csv
import io
import os
import threading
from contextlib import asynccontextmanager
from datetime import date, timedelta
from typing import Any, AsyncIterator, Optional

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


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    db.init_db()
    yield


app = FastAPI(title="LeadZap", lifespan=lifespan)

# In-memory state for the currently running (if any) enrichment batch.
# A single-user local tool only ever has one job running at a time, so a
# module-level dict is sufficient — no job queue needed. _progress_lock
# guards both this dict (mutated from multiple worker threads once a
# batch is running concurrently) and the "is a job already running"
# check-and-set below, which closes a race where two rapid requests could
# otherwise both start a batch before either had set running=True.
enrichment_progress: dict[str, Any] = {
    "running": False,
    "total": 0,
    "done": 0,
    "current_name": "",
}
_progress_lock = threading.Lock()

# How many leads are enriched at once within a batch. Different domains
# fetch fully in parallel; the per-domain rate limiter in enrich.py is
# what keeps requests to the SAME domain to 1/sec regardless of this
# number — see enrich._respect_rate_limit.
ENRICH_CONCURRENCY = 5

# Hard wall-clock cap on a single lead's enrichment, independent of *why*
# it's slow. enrich.py's regex-backtracking fix addresses the one known
# cause of an effectively-unbounded hang, but the actual guarantee wanted
# here is "no single lead can occupy a worker indefinitely, whatever the
# cause" -- belt and suspenders. 30s covers the normal worst case (4
# pages x up to ~10s httpx timeout each, plus rate-limit waits) with some
# margin, while still bounding a genuine hang.
ENRICH_PER_LEAD_TIMEOUT_SECONDS = 30

# A separate, dedicated pool just for enforcing that per-lead timeout.
# concurrent.futures cannot forcibly kill a running thread -- calling
# future.result(timeout=...) only stops WAITING on it; the underlying
# call keeps running to completion (or forever) on its own. Sizing this
# larger than ENRICH_CONCURRENCY means a stuck call doesn't prevent the
# next lead's guarded call from getting its own worker; the cost, in the
# pathological case of many simultaneous true hangs, is this pool's own
# thread count growing rather than being strictly bounded -- an
# acceptable trade for a cap that should essentially never fire.
_timeout_guard_pool = concurrent.futures.ThreadPoolExecutor(
    max_workers=ENRICH_CONCURRENCY * 4, thread_name_prefix="enrich-guard"
)


def _enrich_with_timeout(website: Optional[str]) -> enrich.Enrichment:
    future = _timeout_guard_pool.submit(enrich.enrich_lead, website)
    try:
        return future.result(timeout=ENRICH_PER_LEAD_TIMEOUT_SECONDS)
    except concurrent.futures.TimeoutError:
        return enrich.Enrichment(status="failed")


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
        outcome = places.search_text(query, api_key, max_results)
    except places.PlacesAPIError as exc:
        # A search can fail after already making one or more real,
        # possibly-billed API calls (e.g. page 1 ok, page 2 errors) --
        # record those before surfacing the failure, so the persisted
        # counter never under-counts actual usage.
        if exc.requests_made:
            db.increment_places_request_count(exc.requests_made)
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    db.increment_places_request_count(outcome.requests_made)

    inserted = updated = skipped = 0
    for place in outcome.places:
        result = db.upsert_lead(place, query)
        if result == "inserted":
            inserted += 1
        elif result == "updated":
            updated += 1
        else:
            skipped += 1

    return {
        "total_found": len(outcome.places),
        "inserted": inserted,
        "updated": updated,
        "skipped": skipped,
        "requests_made": outcome.requests_made,
    }


# ---------------------------------------------------------------------------
# API usage tracking (Places API request counter + soft-cap warning)
# ---------------------------------------------------------------------------

# Optional soft cap: not a hard block, just a periodic reminder so usage
# can't silently run past a budget you meant to watch. Unset by default.
_warn_at_raw = os.environ.get("LEADZAP_REQUEST_WARN_AT", "").strip()
REQUEST_WARN_AT = int(_warn_at_raw) if _warn_at_raw.isdigit() else None


@app.get("/api/usage")
def get_usage() -> dict[str, Any]:
    count = db.get_places_request_count()
    should_warn = False
    if REQUEST_WARN_AT:
        last_warned = db.get_last_warned_request_count()
        # Fires again each time the count crosses another full multiple
        # of the threshold, not just once ever -- a warning that never
        # repeats stops being useful the moment usage keeps climbing.
        if count >= REQUEST_WARN_AT and count >= last_warned + REQUEST_WARN_AT:
            should_warn = True
    return {
        "places_api_request_count": count,
        "warn_threshold": REQUEST_WARN_AT,
        "should_warn": should_warn,
    }


@app.post("/api/usage/acknowledge-warning")
def acknowledge_usage_warning() -> dict[str, Any]:
    db.set_last_warned_request_count(db.get_places_request_count())
    return {"ok": True}


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


def _enrich_one(lead_id: int) -> None:
    """Enriches a single lead and writes its result. Runs inside the
    batch's ThreadPoolExecutor — one lead's failure (including a DB
    hiccup, not just a scraping failure) must never take down the rest
    of the batch, so everything here is caught."""
    try:
        lead = db.get_lead(lead_id)
        if not lead:
            return

        with _progress_lock:
            enrichment_progress["current_name"] = lead["name"]

        result = _enrich_with_timeout(lead.get("website"))

        confidence = result.confidence
        if result.status == "found" and result.email:
            # A web-agency address reused across many unrelated client
            # sites is suspect even when it happens to pass the
            # domain-match check. Two or more OTHER leads already
            # carrying this exact email is a reasonable bar for "shared."
            if db.count_other_leads_with_email(result.email, exclude_lead_id=lead_id) >= 2:
                confidence = "low"

        db.update_lead(
            lead_id,
            enrichment_status=result.status,
            email=result.email,
            email_source_url=result.source_url,
            email_confidence=confidence,
        )
    except Exception:
        try:
            db.update_lead(lead_id, enrichment_status="failed")
        except Exception:
            pass
    finally:
        with _progress_lock:
            enrichment_progress["done"] += 1


def _run_enrichment_job(lead_ids: list[int]) -> None:
    """Runs in a worker thread (via FastAPI's BackgroundTasks), which
    keeps it off the asyncio event loop so the server keeps answering
    other requests while it works. Enriches up to ENRICH_CONCURRENCY
    leads at once — different domains proceed in parallel; enrich.py's
    per-domain lock is what keeps any single domain to 1 req/sec
    regardless of this concurrency. (enrichment_progress's running/total
    fields are already set by _try_start_job before this was scheduled.)"""
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=ENRICH_CONCURRENCY) as executor:
            list(executor.map(_enrich_one, lead_ids))
    finally:
        with _progress_lock:
            enrichment_progress["running"] = False


def _try_start_job(lead_ids: list[int]) -> bool:
    """Atomically checks-and-sets the running flag so two near-
    simultaneous requests can't both start a batch — BackgroundTasks
    only actually starts running _run_enrichment_job after the response
    is sent, so without this lock the plain 'if running: reject' check in
    each endpoint has a real window where both could pass it."""
    with _progress_lock:
        if enrichment_progress["running"]:
            return False
        enrichment_progress.update(running=True, total=len(lead_ids), done=0, current_name="")
        return True


@app.post("/api/enrich/selected")
def enrich_selected(payload: EnrichRequest, background_tasks: BackgroundTasks) -> dict[str, Any]:
    if not payload.lead_ids:
        raise HTTPException(status_code=400, detail="No leads selected.")
    if not _try_start_job(payload.lead_ids):
        raise HTTPException(status_code=409, detail="An enrichment job is already running.")
    background_tasks.add_task(_run_enrichment_job, payload.lead_ids)
    return {"started": True, "count": len(payload.lead_ids)}


@app.post("/api/enrich/all-missing")
def enrich_all_missing(background_tasks: BackgroundTasks) -> dict[str, Any]:
    lead_ids = db.get_lead_ids_missing_enrichment()
    if not _try_start_job(lead_ids):
        raise HTTPException(status_code=409, detail="An enrichment job is already running.")
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
UTF8_BOM = "\ufeff"


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

    # Excel's "double-click to open" CSV import assumes the system's
    # ANSI codepage without a BOM, mangling any non-ASCII character
    # (accented business names, etc.) -- the UTF-8 BOM tells it to read
    # as UTF-8 instead. Google Sheets and Python's csv module both parse
    # correctly with or without it, so this is pure upside.
    content = UTF8_BOM + buffer.getvalue()

    return StreamingResponse(
        iter([content]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=leadzap_export.csv"},
    )
