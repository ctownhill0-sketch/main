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
   if you always run this locally, to your IP.
5. Enable billing on the project — the Places API requires it, even though
   Google provides a recurring free monthly credit.

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

Open [http://localhost:8000](http://localhost:8000). The SQLite database
(`leadzap.db`) is created automatically in the `leadzap/` folder on first
run.

## A note on API cost

The Places API (New) Text Search endpoint is billed per request (with tiers
based on which fields you request — LeadZap requests `rating` and
`userRatingCount`, which are billed at a higher "Enterprise + Atmosphere"
tier, not the base tier). A single search with `pageSize=20` and multiple
pages of results costs one request per page fetched, not per result
returned. Google publishes a monthly free credit and current per-request
prices at their [Places API pricing page](https://mapsplatform.google.com/pricing/) —
check it before running large batches of searches, since costs scale with
the number of searches and the fields you choose to fetch.

Email enrichment (the website scraping step) does not call any paid API —
it's plain HTTP requests to the businesses' own websites, done politely
(rate-limited, robots.txt-respecting, capped at 4 pages per business).

## How it works

1. **Search** — enter a query like "HVAC companies in Hartford CT", pick how
   many results to pull (up to 60), and click **Find Leads**. Results are
   deduplicated by Google's place ID and saved to SQLite; non-operational
   businesses are skipped.
2. **Enrich** — select leads (or use "Enrich All Missing") and click
   **Enrich Selected**. LeadZap fetches each business's website looking for
   a `mailto:` link first, then falls back to scanning the page for an email
   address, then tries `/contact`, `/contact-us`, `/about`, `/about-us`.
   Runs as a background job with a live progress indicator.
3. **Track** — update each lead's pipeline status, notes, and follow-up date
   right in the table. Moving a lead to "Contacted" auto-stamps today's date
   and suggests a follow-up 3 days out. Leads due for follow-up are
   highlighted and filterable.
4. **Export** — "Export CSV" downloads whatever the current filters show.

## Project structure

```
leadzap/
  main.py            # FastAPI app + routes
  places.py           # Google Places API client
  enrich.py            # Email scraping logic
  db.py                 # SQLite schema + queries
  static/
    index.html         # Single-page UI
    style.css
    app.js
  .env.example
  requirements.txt
```
