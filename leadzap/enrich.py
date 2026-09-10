"""Email enrichment: scrape a business website for a public contact email.

Politeness rules (do not remove): descriptive User-Agent, 10s timeout,
max 1 request/second per domain (genuinely per-domain — see
_respect_rate_limit), robots.txt is checked before every fetch, at most
4 pages are fetched per business, redirects and response size are
capped. Every network call is wrapped so a single broken site can never
crash a batch run.

Concurrency note: this module's HTTP calls are synchronous (httpx.Client,
not AsyncClient) and use time.sleep() for rate limiting. That's safe only
because callers must run enrich_lead() off the asyncio event loop thread
(main.py does this via a worker thread pool) — see main.py's
_run_enrichment_job for the concurrency model and its own docstring for
how that's verified.
"""
from __future__ import annotations

import html as html_module
import re
import threading
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
MAX_REDIRECTS = 5
# A real contact page is a few KB to a few hundred KB. Capping reads here
# means a 50MB page (or a misconfigured server streaming forever) can
# never eat unbounded memory or time — we just stop reading and work with
# whatever arrived.
MAX_RESPONSE_BYTES = 2_000_000

CONTACT_PATHS = ["/contact", "/contact-us", "/about", "/about-us"]
# Keywords used to recognize a contact-ish link when we discover real
# navigation links on the homepage, instead of only guessing fixed paths.
CONTACT_LINK_KEYWORDS = ("contact", "about", "get-in-touch", "reach-us", "connect")

# Websites that are really just a social/aggregator profile rather than a
# real site. Scraping facebook.com/some-business for a contact page wastes
# the whole per-business page budget (and is blocked by their robots.txt
# anyway) — short-circuit instead.
SOCIAL_AGGREGATOR_DOMAINS = {
    "facebook.com", "instagram.com", "linkedin.com", "linktr.ee",
    "twitter.com", "x.com", "yelp.com", "youtube.com", "tiktok.com",
    "m.me", "pinterest.com",
}

# Role-based addresses are more likely to be the right inbox — and less
# likely to be a random staff member who's left the company — than a
# personal-looking one, so they're preferred when a page has several.
ROLE_LOCAL_PARTS = {
    "info", "contact", "hello", "office", "admin", "sales", "support",
    "enquiries", "inquiries", "help",
}

EMAIL_REGEX = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
# Matches "name [at] domain [dot] com" and "name(at)domain.com" style
# obfuscation. Deliberately requires the "at" token to be bracketed or
# parenthesized: without that anchor, a bare word "at" (extremely common
# in ordinary English) would false-positive constantly. The domain is an
# explicit "label (dot-separator label)+" structure — where each
# separator is either a literal "." or a bracketed "[dot]"/"(dot)" — so
# matching stops at a real domain boundary instead of the first
# whitespace, which a non-greedy blob-plus-lookahead approach doesn't.
_DOMAIN_LABEL = r"[a-zA-Z0-9-]+"
_DOT_SEPARATOR = r"\s*(?:\.|[\[\(]\s*dot\s*[\]\)])\s*"
_OBFUSCATED_EMAIL_REGEX = re.compile(
    rf"([a-zA-Z0-9._%+-]+)\s*[\[\(]\s*at\s*[\]\)]\s*"
    rf"({_DOMAIN_LABEL}(?:{_DOT_SEPARATOR}{_DOMAIN_LABEL})+)",
    re.IGNORECASE,
)
_DOT_TOKEN_REGEX = re.compile(r"[\[\(]\s*dot\s*[\]\)]", re.IGNORECASE)

BLOCKED_LOCAL_PREFIXES = ("noreply", "no-reply", "donotreply")
BLOCKED_DOMAINS = {"sentry.io", "wixpress.com", "godaddy.com", "squarespace.com", "example.com"}
IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".gif", ".webp")

# Tracks the last request time per domain, each guarded by its OWN lock
# (see _get_domain_lock) so requests to different domains never wait on
# each other — only requests to the SAME domain are serialized to
# respect the 1 req/sec limit. A single global lock would be simpler but
# would serialize the entire batch regardless of domain, which is exactly
# the bug this design avoids.
_last_request_at: dict[str, float] = {}
_domain_locks: dict[str, threading.Lock] = {}
_domain_locks_guard = threading.Lock()


class _ConnectFailed(Exception):
    """Internal signal: the homepage couldn't even be reached on this
    scheme (DNS/connect/TLS failure) — caller may retry the other scheme.
    Never escapes this module."""


@dataclass
class Enrichment:
    status: str  # 'found' | 'not_found' | 'failed' | 'no_website'
    email: Optional[str] = None
    source_url: Optional[str] = None
    confidence: Optional[str] = None  # 'high' | 'low'


def enrich_lead(website: Optional[str]) -> Enrichment:
    """Scrape a business website for the best plausible contact email.

    Discovers real contact/about links from the homepage (falling back to
    a handful of guessed paths only if none are found), collects every
    valid candidate up to MAX_PAGES_PER_BUSINESS, and prefers a role-based
    mailto address over a personal-looking one. Retries once on the other
    scheme (http/https) if the site can't even be connected to. Never
    raises — any failure comes back as Enrichment(status='failed').
    """
    if not website:
        return Enrichment(status="no_website")

    netloc = _extract_netloc(website)
    if not netloc:
        return Enrichment(status="failed")
    if _is_social_or_aggregator(netloc):
        return Enrichment(status="not_found")

    preferred_scheme = "http" if website.strip().lower().startswith("http://") else "https"
    fallback_scheme = "http" if preferred_scheme == "https" else "https"

    for scheme in (preferred_scheme, fallback_scheme):
        try:
            return _scrape_site(f"{scheme}://{netloc}", netloc)
        except _ConnectFailed:
            continue
        except Exception:
            return Enrichment(status="failed")
    return Enrichment(status="failed")


def _extract_netloc(website: str) -> Optional[str]:
    try:
        parsed = urlparse(website if "://" in website else f"https://{website}")
        return parsed.netloc or None
    except Exception:
        return None


def _is_social_or_aggregator(netloc: str) -> bool:
    return _root_domain(netloc) in SOCIAL_AGGREGATOR_DOMAINS


def _scrape_site(base_url: str, netloc: str) -> Enrichment:
    """Fetch pages for one business (one scheme) and return the best
    email found. Raises _ConnectFailed if the homepage itself can't be
    reached, so the caller can retry the other scheme."""
    candidates: list[tuple[str, bool, str]] = []  # (email, is_mailto, source_url)
    pages_fetched = 0

    with httpx.Client(
        follow_redirects=True,
        max_redirects=MAX_REDIRECTS,
        timeout=TIMEOUT_SECONDS,
        headers={"User-Agent": USER_AGENT},
    ) as client:
        robots = _load_robots(client, base_url)

        try:
            homepage_html = _fetch_raise(client, base_url)
        except httpx.RequestError as exc:
            raise _ConnectFailed() from exc
        pages_fetched += 1

        if homepage_html:
            candidates.extend(
                (email, is_mailto, base_url) for email, is_mailto in _extract_candidates(homepage_html)
            )
            if _has_strong_match(candidates):
                return _finalize(candidates, netloc, pages_fetched)
            pages_to_check = _discover_contact_links(homepage_html, base_url)
        else:
            pages_to_check = []

        if not pages_to_check:
            pages_to_check = [urljoin(base_url, path) for path in CONTACT_PATHS]

        for url in pages_to_check:
            if pages_fetched >= MAX_PAGES_PER_BUSINESS:
                break
            if not robots.can_fetch(USER_AGENT, url):
                continue
            page_html = _fetch_safe(client, url)
            pages_fetched += 1  # counts the attempt, same as the homepage fetch above, even on failure
            if page_html is None:
                continue
            candidates.extend(
                (email, is_mailto, url) for email, is_mailto in _extract_candidates(page_html)
            )
            if _has_strong_match(candidates):
                break

    return _finalize(candidates, netloc, pages_fetched)


def _has_strong_match(candidates: list[tuple[str, bool, str]]) -> bool:
    """Any mailto-sourced address is already the strongest signal a page
    can give (an explicit, deliberate contact link) — stop spending page
    budget once we have one, same as the original "mailto first" design.
    Role-based preference still applies when ranking multiple candidates
    found together on one page (_choose_best_email); it only widens the
    search to more pages when the homepage yields no mailto at all (just
    a plain-text or obfuscated match, or nothing). Earlier this checked
    for a role-based mailto specifically, which meant a business whose
    homepage had a perfectly good but non-role mailto (e.g. "shared@...")
    would still burn the full 4-page budget hunting for something
    "better" that usually isn't there — measurably slower for no real
    quality gain in the common case."""
    return any(is_mailto for _, is_mailto, _ in candidates)


def _finalize(candidates: list[tuple[str, bool, str]], netloc: str, pages_fetched: int) -> Enrichment:
    best = _choose_best_email(candidates, netloc)
    if best is None:
        return Enrichment(status="failed" if pages_fetched == 0 else "not_found")
    return Enrichment(status="found", email=best["email"], source_url=best["source_url"], confidence=best["confidence"])


def _choose_best_email(
    candidates: list[tuple[str, bool, str]], website_domain: str
) -> Optional[dict[str, str]]:
    """Validate every candidate, then rank: role-based address first,
    then same-domain (high confidence), then mailto-sourced, then
    earliest found — stable sort preserves discovery order as the final
    tiebreak."""
    validated = []
    for email, is_mailto, source_url in candidates:
        ok, confidence = _validate_email(email, website_domain)
        if not ok:
            continue
        local = email.lower().split("@", 1)[0]
        validated.append(
            {
                "email": email.lower(),
                "source_url": source_url,
                "confidence": confidence,
                "is_role": local in ROLE_LOCAL_PARTS,
                "is_mailto": is_mailto,
            }
        )
    if not validated:
        return None
    validated.sort(key=lambda c: (not c["is_role"], c["confidence"] != "high", not c["is_mailto"]))
    return validated[0]


def _load_robots(client: httpx.Client, base_url: str) -> robotparser.RobotFileParser:
    """Fetch and parse robots.txt. Absent (404) or unreadable -> allow all
    (per the standard: no robots.txt means no restrictions). A robots.txt
    that explicitly disallows a path is always honored.

    Deliberately NOT run through _respect_rate_limit: robots.txt is a
    tiny, cheap request that standard crawler etiquette treats as exempt
    from a site's own rate limit (it's the mechanism for communicating
    that limit in the first place). Counting it against the 1 req/sec
    budget would only delay the first real content fetch to every new
    domain by up to a second, for no politeness benefit."""
    rp = robotparser.RobotFileParser()
    robots_url = urljoin(base_url, "/robots.txt")
    try:
        resp = client.get(robots_url)
        rp.parse(resp.text.splitlines() if resp.status_code == 200 else [])
    except Exception:
        rp.parse([])
    return rp


def _fetch_raise(client: httpx.Client, url: str) -> Optional[str]:
    """GET a page. A clean HTTP response (even non-200, even non-HTML)
    returns normally (None for anything we won't parse). A connection-
    level failure (DNS, refused, TLS, connect timeout) propagates as
    httpx.RequestError so the caller can decide whether to retry on a
    different scheme."""
    _respect_rate_limit(urlparse(url).netloc)
    with client.stream("GET", url) as resp:
        return _read_response(resp)


def _fetch_safe(client: httpx.Client, url: str) -> Optional[str]:
    """Like _fetch_raise, but never raises — used once we already know
    the site is reachable, so one flaky secondary page can't abort the
    whole business or trigger a needless scheme retry."""
    try:
        return _fetch_raise(client, url)
    except Exception:
        return None


def _read_response(resp: httpx.Response) -> Optional[str]:
    if resp.status_code != 200:
        return None
    content_type = resp.headers.get("content-type", "")
    if content_type and not (content_type.startswith("text/html") or content_type.startswith("text/plain")):
        return None

    chunks: list[bytes] = []
    total = 0
    for chunk in resp.iter_bytes():
        chunks.append(chunk)
        total += len(chunk)
        if total >= MAX_RESPONSE_BYTES:
            break
    raw = b"".join(chunks)

    # A PDF/image served without an honest Content-Type header still has
    # null bytes or other binary markers early on; bail rather than feed
    # garbage to BeautifulSoup/regex.
    if b"\x00" in raw[:2048]:
        return None

    return raw.decode(resp.encoding or "utf-8", errors="replace")


def _get_domain_lock(domain: str) -> threading.Lock:
    with _domain_locks_guard:
        lock = _domain_locks.get(domain)
        if lock is None:
            lock = threading.Lock()
            _domain_locks[domain] = lock
        return lock


def _respect_rate_limit(domain: str) -> None:
    """Enforce >=1 second between requests to the SAME domain. Guarded by
    a per-domain lock so concurrent requests to DIFFERENT domains never
    wait on each other — only same-domain requests serialize."""
    lock = _get_domain_lock(domain)
    with lock:
        now = time.monotonic()
        last = _last_request_at.get(domain)
        if last is not None:
            elapsed = now - last
            if elapsed < MIN_SECONDS_BETWEEN_REQUESTS_PER_DOMAIN:
                time.sleep(MIN_SECONDS_BETWEEN_REQUESTS_PER_DOMAIN - elapsed)
        _last_request_at[domain] = time.monotonic()


def _extract_candidates(html: str) -> list[tuple[str, bool]]:
    """All plausible (email, is_mailto) pairs on a page: mailto links,
    plain-text regex matches, obfuscated "[at]/[dot]" patterns, and
    HTML-entity-encoded addresses (decoded up front via html.unescape).
    Deduped, first-seen order preserved; a mailto sighting always wins
    the is_mailto flag for that address even if it also appears in plain
    text elsewhere on the page.

    Regex scanning is deliberately bounded (see _scan_in_chunks) rather
    than run over the raw page in one shot: both EMAIL_REGEX and
    _OBFUSCATED_EMAIL_REGEX exhibit severe (measured: quadratic-or-worse)
    backtracking on long runs of characters that never satisfy the
    pattern — e.g. a large inline base64 image/font, or any other big
    blob of unstructured text. Confirmed experimentally: 10KB of such
    content alone took ~1.9s; a real 2MB page (our own size cap) would
    hang for minutes. That would defeat "one broken site can't crash a
    batch" just as badly as an actual crash would."""
    html = html_module.unescape(html)
    found: dict[str, bool] = {}

    try:
        soup = BeautifulSoup(html, "html.parser")
    except Exception:
        soup = None

    text_to_scan = html
    if soup is not None:
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if href.lower().startswith("mailto:"):
                addr = href.split(":", 1)[1].split("?")[0].strip()
                if addr:
                    found[addr] = True

        # <script>/<style> bodies are never a real contact email and are
        # exactly the kind of large, unstructured blob that triggers the
        # backtracking above (minified JS, base64 data URIs) — drop them
        # before scanning, same soup instance, no extra parse cost.
        for tag in soup(["script", "style", "noscript"]):
            tag.decompose()
        text_to_scan = soup.get_text(" ")

    text_to_scan = _bound_for_scanning(text_to_scan)

    for match in _scan_in_chunks(EMAIL_REGEX, text_to_scan):
        found.setdefault(match, False)

    for addr in _find_obfuscated_emails(text_to_scan):
        found.setdefault(addr, False)

    return list(found.items())


# Regex scanning is bounded twice over, deliberately redundant: a total
# character cap (a real contact email is always near the top or bottom
# of a page, never require scanning the whole thing) AND small
# overlapping chunks within that budget (bounds worst-case backtracking
# cost to a small, measured constant regardless of pattern complexity —
# see _extract_candidates' docstring for why this is needed at all).
REGEX_SCAN_MAX_CHARS = 20_000
_SCAN_CHUNK_SIZE = 400
_SCAN_CHUNK_OVERLAP = 100  # comfortably larger than any real email address


def _bound_for_scanning(text: str) -> str:
    """Keep head and tail (where a contact email realistically lives) if
    the page's visible text is unusually long, instead of the whole thing."""
    if len(text) <= REGEX_SCAN_MAX_CHARS:
        return text
    half = REGEX_SCAN_MAX_CHARS // 2
    return text[:half] + " " + text[-half:]


def _scan_in_chunks(pattern: re.Pattern, text: str) -> list[str]:
    """Run `pattern.finditer` over small overlapping windows instead of
    the whole string, deduped. Bounds worst-case regex time to
    (number of chunks) x (small, measured per-chunk cost) instead of
    being quadratic in len(text)."""
    seen: dict[str, None] = {}
    stride = _SCAN_CHUNK_SIZE - _SCAN_CHUNK_OVERLAP
    for start in range(0, max(len(text), 1), stride):
        chunk = text[start : start + _SCAN_CHUNK_SIZE]
        if not chunk:
            break
        for match in pattern.finditer(chunk):
            seen.setdefault(match.group(0), None)
        if start + _SCAN_CHUNK_SIZE >= len(text):
            break
    return list(seen.keys())


def _find_obfuscated_emails(text: str) -> list[str]:
    """"name [at] domain [dot] com" / "name(at)domain.com" style
    de-spamification. Only bracket/paren-delimited "[at]"/"(at)" is
    matched — an un-bracketed bare word "at" is far too common in normal
    prose to safely treat as an obfuscation marker. Scanned in bounded
    chunks (see _scan_in_chunks) for the same backtracking reason as
    EMAIL_REGEX; a match spanning a chunk boundary can't be recovered
    this way, but a "local [at] domain [dot] tld" pattern is always far
    shorter than the chunk overlap, so this doesn't cost real hits."""
    results: dict[str, None] = {}
    stride = _SCAN_CHUNK_SIZE - _SCAN_CHUNK_OVERLAP
    for start in range(0, max(len(text), 1), stride):
        chunk = text[start : start + _SCAN_CHUNK_SIZE]
        if not chunk:
            break
        for match in _OBFUSCATED_EMAIL_REGEX.finditer(chunk):
            local, domain_chunk = match.group(1), match.group(2)
            domain_chunk = _DOT_TOKEN_REGEX.sub(".", domain_chunk)
            domain_chunk = re.sub(r"\s+", "", domain_chunk)
            domain_chunk = domain_chunk.strip("[]() .")
            candidate = f"{local}@{domain_chunk}"
            if EMAIL_REGEX.fullmatch(candidate):
                results.setdefault(candidate, None)
        if start + _SCAN_CHUNK_SIZE >= len(text):
            break
    return list(results.keys())


def _discover_contact_links(html: str, base_url: str) -> list[str]:
    """Find real contact/about links in the homepage's own navigation,
    resolved against the CURRENT page's URL (base_url) so relative forms
    like "/contact", "contact.html", and "../contact" all work. Stays on
    the same site; never follows an off-domain link."""
    try:
        soup = BeautifulSoup(html, "html.parser")
    except Exception:
        return []

    base_netloc = urlparse(base_url).netloc
    found: list[str] = []
    seen: set[str] = set()

    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if not href or href.lower().startswith(("mailto:", "tel:", "javascript:", "#")):
            continue
        haystack = f"{href} {a.get_text(' ', strip=True)}".lower()
        if not any(keyword in haystack for keyword in CONTACT_LINK_KEYWORDS):
            continue

        resolved = urljoin(base_url, href)
        if urlparse(resolved).netloc != base_netloc:
            continue
        if resolved not in seen:
            seen.add(resolved)
            found.append(resolved)

    return found[:MAX_PAGES_PER_BUSINESS]


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
    if _domain_is_blocked(domain):
        return False, ""

    confidence = "high"
    site_root = _root_domain(website_domain)
    email_root = _root_domain(domain)
    if site_root and email_root and site_root != email_root:
        confidence = "low"
    return True, confidence


def _domain_is_blocked(domain: str) -> bool:
    """Exact match OR a subdomain of a blocked platform domain — e.g.
    'sentry-next.wixpress.com' is just as much Wix infrastructure junk as
    'wixpress.com' itself."""
    return any(domain == blocked or domain.endswith("." + blocked) for blocked in BLOCKED_DOMAINS)


def _root_domain(netloc: str) -> str:
    """Best-effort registrable-domain guess: last two labels, minus 'www'."""
    netloc = netloc.lower()
    if netloc.startswith("www."):
        netloc = netloc[4:]
    parts = netloc.split(".")
    return ".".join(parts[-2:]) if len(parts) >= 2 else netloc
