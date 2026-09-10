"""Email enrichment: scrape a business website for a public contact email.

Politeness rules (do not remove): descriptive User-Agent, 10s timeout,
max 1 request/second per domain, robots.txt is checked before every
fetch, and at most 4 pages are fetched per business. Every network call
is wrapped so a single broken site can never crash a batch run.
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass
from typing import Optional
from urllib.parse import urljoin, urlparse
from urllib import robotparser

import httpx
from bs4 import BeautifulSoup

USER_AGENT = "LeadZapBot/1.0 (local lead-gen tool for outreach research)"
TIMEOUT_SECONDS = 10.0
MAX_PAGES_PER_BUSINESS = 4
MIN_SECONDS_BETWEEN_REQUESTS_PER_DOMAIN = 1.0
CONTACT_PATHS = ["/contact", "/contact-us", "/about", "/about-us"]

EMAIL_REGEX = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
BLOCKED_LOCAL_PREFIXES = ("noreply", "no-reply", "donotreply")
BLOCKED_DOMAINS = {"sentry.io", "wixpress.com", "godaddy.com", "squarespace.com", "example.com"}
IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".gif", ".webp")

# Tracks the last request time per domain so we never exceed 1 req/sec/domain,
# even across the several fetches made for a single business.
_last_request_at: dict[str, float] = {}


@dataclass
class Enrichment:
    status: str  # 'found' | 'not_found' | 'failed' | 'no_website'
    email: Optional[str] = None
    source_url: Optional[str] = None
    confidence: Optional[str] = None  # 'high' | 'low'


def enrich_lead(website: Optional[str]) -> Enrichment:
    """Scrape a business website for its first plausible contact email.

    Tries the homepage, then a handful of common contact pages, stopping
    as soon as a valid email is found or MAX_PAGES_PER_BUSINESS is hit.
    Never raises — any failure comes back as Enrichment(status='failed').
    """
    if not website:
        return Enrichment(status="no_website")

    try:
        parsed = urlparse(website if "://" in website else f"https://{website}")
        if not parsed.netloc:
            return Enrichment(status="failed")
        base_url = f"{parsed.scheme}://{parsed.netloc}"
        website_domain = parsed.netloc
    except Exception:
        return Enrichment(status="failed")

    pages_fetched = 0
    try:
        with httpx.Client(
            follow_redirects=True, timeout=TIMEOUT_SECONDS, headers={"User-Agent": USER_AGENT}
        ) as client:
            robots = _load_robots(client, base_url)
            candidate_urls = [base_url] + [urljoin(base_url, path) for path in CONTACT_PATHS]

            for url in candidate_urls:
                if pages_fetched >= MAX_PAGES_PER_BUSINESS:
                    break
                if not robots.can_fetch(USER_AGENT, url):
                    continue

                html = _fetch(client, url)
                if html is None:
                    continue
                pages_fetched += 1

                email = _find_email_in_html(html)
                if not email:
                    continue
                is_valid, confidence = _validate_email(email, website_domain)
                if is_valid:
                    return Enrichment(status="found", email=email.lower(), source_url=url, confidence=confidence)
    except Exception:
        return Enrichment(status="failed")

    if pages_fetched == 0:
        return Enrichment(status="failed")
    return Enrichment(status="not_found")


def _load_robots(client: httpx.Client, base_url: str) -> robotparser.RobotFileParser:
    """Fetch and parse robots.txt; an absent or unreadable file allows all."""
    rp = robotparser.RobotFileParser()
    robots_url = urljoin(base_url, "/robots.txt")
    try:
        _respect_rate_limit(urlparse(base_url).netloc)
        resp = client.get(robots_url)
        rp.parse(resp.text.splitlines() if resp.status_code == 200 else [])
    except Exception:
        rp.parse([])
    return rp


def _fetch(client: httpx.Client, url: str) -> Optional[str]:
    """GET a page politely; returns None on any failure instead of raising."""
    try:
        _respect_rate_limit(urlparse(url).netloc)
        resp = client.get(url)
        if resp.status_code != 200:
            return None
        content_type = resp.headers.get("content-type", "")
        if "text/html" not in content_type and content_type != "":
            return None
        return resp.text
    except Exception:
        return None


def _respect_rate_limit(domain: str) -> None:
    now = time.monotonic()
    last = _last_request_at.get(domain)
    if last is not None:
        elapsed = now - last
        if elapsed < MIN_SECONDS_BETWEEN_REQUESTS_PER_DOMAIN:
            time.sleep(MIN_SECONDS_BETWEEN_REQUESTS_PER_DOMAIN - elapsed)
    _last_request_at[domain] = time.monotonic()


def _find_email_in_html(html: str) -> Optional[str]:
    """mailto: links first (highest confidence signal), then a text regex scan."""
    try:
        soup = BeautifulSoup(html, "html.parser")
    except Exception:
        soup = None

    if soup is not None:
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if href.lower().startswith("mailto:"):
                addr = href.split(":", 1)[1].split("?")[0].strip()
                if addr:
                    return addr

    match = EMAIL_REGEX.search(html)
    return match.group(0) if match else None


def _validate_email(email: str, website_domain: str) -> tuple[bool, str]:
    """Filter junk/platform addresses; flag domain mismatches as low confidence."""
    email = email.strip().strip(".,;:()<>\"'")
    lower = email.lower()

    if lower.endswith(IMAGE_EXTENSIONS):
        return False, ""
    if "@" not in lower:
        return False, ""

    local, _, domain = lower.partition("@")
    if not local or not domain or "." not in domain:
        return False, ""
    if local.startswith(BLOCKED_LOCAL_PREFIXES):
        return False, ""
    if domain in BLOCKED_DOMAINS:
        return False, ""

    confidence = "high"
    site_root = _root_domain(website_domain)
    email_root = _root_domain(domain)
    if site_root and email_root and site_root != email_root:
        confidence = "low"
    return True, confidence


def _root_domain(netloc: str) -> str:
    """Best-effort registrable-domain guess: last two labels, minus 'www'."""
    netloc = netloc.lower()
    if netloc.startswith("www."):
        netloc = netloc[4:]
    parts = netloc.split(".")
    return ".".join(parts[-2:]) if len(parts) >= 2 else netloc
