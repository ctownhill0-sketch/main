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


class PlacesAPIError(Exception):
    """Raised for any failure to complete a Places API search, with the
    real error message surfaced (API error body, network error, etc.)."""


def search_text(query: str, api_key: str, max_results: int = 20) -> list[dict[str, Any]]:
    """Search Google Places (New) for businesses matching a free-text query.

    Pages automatically (via nextPageToken) until `max_results` places have
    been collected or the API has no more pages to give.
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

    with httpx.Client(timeout=15.0) as client:
        while len(results) < max_results:
            body: dict[str, Any] = {
                "textQuery": query,
                "pageSize": min(MAX_PAGE_SIZE, max_results - len(results)),
            }
            if page_token:
                body["pageToken"] = page_token
                time.sleep(PAGE_TOKEN_DELAY_SECONDS)

            try:
                response = client.post(SEARCH_URL, headers=headers, json=body)
            except httpx.RequestError as exc:
                raise PlacesAPIError(f"Request to Google Places API failed: {exc}") from exc

            if response.status_code != 200:
                raise PlacesAPIError(
                    f"Google Places API error ({response.status_code}): {_extract_error_message(response)}"
                )

            data = response.json()
            places = data.get("places", [])
            results.extend(places)

            page_token = data.get("nextPageToken")
            if not page_token or not places:
                break

    return results[:max_results]


def _extract_error_message(response: httpx.Response) -> str:
    """Pull the human-readable message out of a Google API error body."""
    try:
        payload = response.json()
        return payload.get("error", {}).get("message") or response.text
    except ValueError:
        return response.text
