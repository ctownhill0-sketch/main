"""Client for the Google Places API (New) Text Search endpoint.

Uses `places:searchText` (not the legacy Places API). See:
https://developers.google.com/maps/documentation/places/web-service/text-search
"""
from __future__ import annotations

import time
from typing import Any, Optional

import httpx

SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"

# nextPageToken must be requested explicitly in the field mask, separate
# from the "places." prefixed fields, or pagination silently breaks.
FIELD_MASK = ",".join(
    [
        "places.id",
        "places.displayName",
        "places.formattedAddress",
        "places.nationalPhoneNumber",
        "places.websiteUri",
        "places.rating",
        "places.userRatingCount",
        "places.businessStatus",
        "nextPageToken",
    ]
)

MAX_PAGE_SIZE = 20
# Google requires a short delay before a nextPageToken becomes usable.
PAGE_TOKEN_DELAY_SECONDS = 2.0
# Hard ceiling on pages fetched per search, independent of max_results.
# max_results caps at 60 (see main.py), which needs at most 3 pages at
# MAX_PAGE_SIZE=20 — this just guarantees pagination can never spin
# forever even if Google ever returned a non-advancing token.
MAX_PAGES = 5
# Extra backoff attempts (seconds) for a paginated request that fails —
# covers the case where a freshly-issued nextPageToken isn't active yet.
# Not applied to the first page: a 400/429 there is a real config or
# quota problem, not a pagination timing issue, so it should surface
# immediately rather than being retried away.
PAGE_TOKEN_RETRY_DELAYS = [2.0, 4.0]

# Google's structured API-key/consumer error reasons (google.rpc.ErrorInfo
# `reason`), consistent across Google Cloud and Maps Platform APIs. Keying
# off these is far more reliable than pattern-matching free-text messages,
# which can change wording. If Google ever omits a reason we don't
# recognize, _build_error_message() falls back to surfacing its raw
# message untouched — never worse than before.
_REASON_MESSAGES: dict[str, str] = {
    "API_KEY_INVALID": (
        "Your Google Places API key is invalid. Check GOOGLE_PLACES_API_KEY "
        "in your .env file for typos, and confirm the key still exists in "
        "Google Cloud Console."
    ),
    "API_KEY_SERVICE_BLOCKED": (
        "This API key isn't allowed to call Places API (New). In Google "
        "Cloud Console, open the key's 'API restrictions' and add Places "
        "API (New) to the allowed list."
    ),
    "API_KEY_HTTP_REFERRER_BLOCKED": (
        "This API key is restricted to specific HTTP referrers, which "
        "blocks server-side calls like this one. Remove the referrer "
        "restriction, or use a separate key without it, for this local tool."
    ),
    "API_KEY_IP_ADDRESS_BLOCKED": (
        "This API key is restricted to specific IP addresses that don't "
        "include this machine's. Update the key's IP restrictions in "
        "Google Cloud Console, or remove them."
    ),
    "API_KEY_ANDROID_APP_BLOCKED": (
        "This API key is restricted to Android apps, which blocks "
        "server-side calls like this one. Use a key without app restrictions."
    ),
    "API_KEY_IOS_APP_BLOCKED": (
        "This API key is restricted to iOS apps, which blocks server-side "
        "calls like this one. Use a key without app restrictions."
    ),
    "SERVICE_DISABLED": (
        "Places API (New) is not enabled on this Google Cloud project. "
        "Enable it under APIs & Services > Library."
    ),
    "BILLING_DISABLED": (
        "Billing is not enabled on this Google Cloud project. The Places "
        "API requires an active billing account, even for usage covered "
        "by the free monthly credit."
    ),
    "RATE_LIMIT_EXCEEDED": (
        "You've hit your Places API rate limit or quota. Wait a bit before "
        "retrying, or raise your quota in Google Cloud Console."
    ),
}


class PlacesAPIError(Exception):
    """Raised for any failure to complete a Places API search, with the
    real error message surfaced (API error body, network error, etc.)."""


def search_text(query: str, api_key: str, max_results: int = 20) -> list[dict[str, Any]]:
    """Search Google Places (New) for businesses matching a free-text query.

    Pages automatically (via nextPageToken) until `max_results` places have
    been collected, the API has no more pages to give, or MAX_PAGES is hit.
    """
    if not api_key:
        raise PlacesAPIError(
            "GOOGLE_PLACES_API_KEY is missing. Add it to your .env file and restart the server."
        )
    if not query.strip():
        raise PlacesAPIError("Search query is empty.")

    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": FIELD_MASK,
    }

    results: list[dict[str, Any]] = []
    page_token: Optional[str] = None
    pages_fetched = 0

    with httpx.Client(timeout=15.0) as client:
        while len(results) < max_results and pages_fetched < MAX_PAGES:
            body: dict[str, Any] = {
                "textQuery": query,
                "pageSize": min(MAX_PAGE_SIZE, max_results - len(results)),
            }
            is_paginated = page_token is not None
            if page_token:
                body["pageToken"] = page_token
                time.sleep(PAGE_TOKEN_DELAY_SECONDS)

            response = _post_with_retry(client, headers, body, is_paginated)
            pages_fetched += 1

            data = response.json()
            places = data.get("places", [])
            results.extend(places)

            page_token = data.get("nextPageToken")
            if not page_token or not places:
                break

    return results[:max_results]


def _post_with_retry(
    client: httpx.Client, headers: dict[str, str], body: dict[str, Any], is_paginated: bool
) -> httpx.Response:
    """POST to the search endpoint, retrying a transient-looking failure on
    a paginated request (a freshly-issued nextPageToken not yet being
    active). The first page never retries a 400/429 — there, it's a real
    config or quota problem, not a timing issue, and should surface at once.
    """
    retry_delays = PAGE_TOKEN_RETRY_DELAYS if is_paginated else []
    attempt = 0

    while True:
        try:
            response = client.post(SEARCH_URL, headers=headers, json=body)
        except httpx.TimeoutException as exc:
            raise PlacesAPIError(
                "Request to Google Places API timed out. Check your internet connection and try again."
            ) from exc
        except httpx.RequestError as exc:
            raise PlacesAPIError(f"Could not reach Google Places API: {exc}") from exc

        if response.status_code == 200:
            return response

        if response.status_code in (400, 429) and attempt < len(retry_delays):
            time.sleep(retry_delays[attempt])
            attempt += 1
            continue

        raise PlacesAPIError(_build_error_message(response))


def _build_error_message(response: httpx.Response) -> str:
    """Turn a Google API error body into an actionable message. Always
    falls back to surfacing Google's own message untouched if we don't
    recognize the specific failure — never a generic "search failed"."""
    status_code = response.status_code
    try:
        payload = response.json()
    except ValueError:
        return f"Google Places API error ({status_code}): {response.text or 'no response body'}"

    error = payload.get("error") if isinstance(payload, dict) else None
    if not isinstance(error, dict):
        return f"Google Places API error ({status_code}): {response.text}"

    message = error.get("message") or "no message provided"

    reason = None
    for detail in error.get("details") or []:
        if isinstance(detail, dict) and detail.get("reason"):
            reason = detail["reason"]
            break

    if reason and reason in _REASON_MESSAGES:
        return f"{_REASON_MESSAGES[reason]} (Google said: \"{message}\")"

    if status_code == 429 or error.get("status") == "RESOURCE_EXHAUSTED":
        return f"Places API quota exceeded: {message}"

    return f"Google Places API error ({status_code}): {message}"
