# LeadZap

A local lead generation tool: find nearby businesses via Google Places, enrich
them with a public contact email, and track your outreach pipeline — all in
one single-user app with no external database and no build step.

## Install

```bash
cd leadzap
python3 -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## Get a Google Places API key

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and
   create (or pick) a project.
2. In **APIs & Services > Library**, search for **Places API (New)** and
   enable it. (This is a distinct product from the older "Places API" —
   LeadZap uses the new `places:searchText` endpoint.)
3. In **APIs & Services > Credentials**, create an API key.
4. Optional but recommended: restrict the key to the Places API (New) and,
   if you always run this locally, to your IP. Do **not** apply an HTTP
   referrer restriction — that's for browser-side use and will block this
   server-side app entirely.
5. Enable billing on the project — the Places API requires it, even though
   Google provides a free monthly quota (see below).

Copy `.env.example` to `.env` and paste your key in:

```bash
cp .env.example .env
```

```
GOOGLE_PLACES_API_KEY=your_key_here
```

`.env` is gitignored — never commit your key.

## Run

```bash
uvicorn main:app --reload
```

Open [http://localhost:8000](http://localhost:8000). Uvicorn binds to
`127.0.0.1` by default — do **not** pass `--host 0.0.0.0`; this app has no
authentication and isn't meant to be reachable from your network. The SQLite
database (`leadzap.db`) is created automatically in the `leadzap/` folder on
first run.

## A note on API cost

**Every search using this app's field mask bills at the Enterprise SKU
tier: $35.00 per 1,000 requests, with 1,000 free requests per month**
(Google replaced the old flat $200/month credit with per-SKU free
quotas in 2025). This tier applies because the field mask includes
`rating`, `userRatingCount`, `nationalPhoneNumber`, and `websiteUri` —
each of those independently triggers Enterprise pricing; dropping them
would fall back to the cheaper Pro tier ($32.00/1,000), but you'd lose
the rating/phone/website data this app is built around.

A single search costs one request per **page** fetched (Google returns up
to 20 results per page), not one request per result — searching for 60
results costs at most 3 requests, not 60. LeadZap shows a live "~N Places
API requests" estimate next to the **Find Leads** button before you search.

This pricing was current as of when this section was last checked, sourced
from third-party trackers (this environment couldn't reach
`developers.google.com` or `mapsplatform.google.com` directly to confirm
against Google's own pages) — **verify current pricing and your free quota
in [Google Cloud Console](https://console.cloud.google.com/billing) or the
[Maps Platform pricing page](https://mapsplatform.google.com/pricing/)
before running large batches**, since Google can change pricing at any time.

LeadZap also keeps its own persisted, cumulative counter of every Places
API request it has made (shown near the search bar), independent of and in
addition to whatever Google Cloud Console reports — use it as a quick local
sanity check, not a replacement for checking your actual bill. Set
`LEADZAP_REQUEST_WARN_AT` in `.env` (e.g. `250`) to get a dismissible
warning banner once that cumulative count crosses the threshold — it
reappears each time usage crosses another full multiple of it. This is a
soft nudge, not a hard cap; it never blocks a search.

Email enrichment (the website scraping step) does not call any paid API —
it's plain HTTP requests to the businesses' own websites, done politely
(rate-limited per domain, robots.txt-respecting, capped at 4 pages per
business, with a 30-second hard cap per lead).

## How it works

1. **Search** — enter a query like "HVAC companies in Hartford CT", pick how
   many results to pull (up to 60), and click **Find Leads**. Results are
   deduplicated by Google's place ID; a business you've already saved gets
   its business fields (name, phone, website, address, rating) refreshed
   without touching your pipeline status, notes, or dates. Non-operational
   businesses are skipped.
2. **Enrich** — select leads (or use "Enrich All Missing") and click
   **Enrich Selected**. LeadZap discovers each business's real contact/about
   links from its homepage (falling back to a few guessed paths only if none
   are found), and looks for a `mailto:` link first, then a plain-text or
   obfuscated ("name [at] domain [dot] com") email, preferring a role-based
   address (`info@`, `contact@`, etc.) when a page has more than one. Up to
   5 leads enrich concurrently — different domains proceed in parallel,
   while the same domain is always throttled to 1 request/second. Runs as a
   background job with a live progress indicator; safe to navigate away or
   close the tab, it keeps running server-side.
3. **Track** — update each lead's pipeline status, notes, and follow-up date
   right in the table. Moving a lead to "Contacted" auto-stamps today's date
   and suggests a follow-up 3 days out. A lead in an active status (new,
   contacted, replied, call booked) with a follow-up date today or earlier
   is highlighted and filterable; moving a lead to a closed/not-a-fit status
   removes it from that filter without erasing its follow-up date, so
   reopening it later picks the reminder back up.
4. **Export** — "Export CSV" downloads whatever the current filters show,
   with a UTF-8 BOM so accented names open correctly in Excel.

## Tests

```bash
cd leadzap
source .venv/bin/activate
pip install -r requirements-dev.txt
pytest
```

Runs fully offline in under 2 seconds — every network call (Google Places,
website fetches) is mocked. One test file
(`tests/test_frontend_security.py`) runs the real `static/app.js` through
Node to regression-test the `javascript:`/`data:` URL-scheme allowlist that
keeps the website link from becoming an XSS vector; it's skipped
automatically if Node isn't installed.

## Project structure

```
leadzap/
  main.py               # FastAPI app + routes
  places.py              # Google Places API client
  enrich.py               # Email scraping logic
  db.py                    # SQLite schema + queries
  tests/                    # pytest suite (see Tests above)
  static/
    index.html             # Single-page UI
    style.css
    app.js
  .env.example
  requirements.txt
  requirements-dev.txt
```
