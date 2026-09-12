"""Tests for the Google Places API (New) client: error message mapping
and pagination behavior. All network calls are mocked -- no real
requests to Google, ever."""
from __future__ import annotations

from unittest.mock import patch

import httpx
import pytest

import places


def _response(status_code, json_body=None, text=""):
    request = httpx.Request("POST", places.SEARCH_URL)
    if json_body is not None:
        return httpx.Response(status_code, json=json_body, request=request)
    return httpx.Response(status_code, text=text, request=request)


class TestErrorMapping:
    def test_invalid_api_key(self):
        r = _response(
            400,
            {
                "error": {
                    "code": 400,
                    "message": "API key not valid. Please pass a valid API key.",
                    "status": "INVALID_ARGUMENT",
                    "details": [{"reason": "API_KEY_INVALID"}],
                }
            },
        )
        msg = places._build_error_message(r)
        assert "API key is invalid" in msg
        assert "API key not valid" in msg  # Google's own message is still surfaced

    def test_service_not_enabled(self):
        r = _response(
            403,
            {
                "error": {
                    "code": 403,
                    "message": "Places API (New) has not been used in project 123 before or it is disabled.",
                    "status": "PERMISSION_DENIED",
                    "details": [{"reason": "SERVICE_DISABLED"}],
                }
            },
        )
        assert "not enabled" in places._build_error_message(r)

    def test_billing_disabled(self):
        r = _response(
            403,
            {
                "error": {
                    "code": 403,
                    "message": "This API method requires billing to be enabled.",
                    "status": "PERMISSION_DENIED",
                    "details": [{"reason": "BILLING_DISABLED"}],
                }
            },
        )
        assert "Billing is not enabled" in places._build_error_message(r)

    def test_ip_restricted_key(self):
        r = _response(
            403,
            {
                "error": {
                    "code": 403,
                    "message": "Requests from this IP are blocked.",
                    "status": "PERMISSION_DENIED",
                    "details": [{"reason": "API_KEY_IP_ADDRESS_BLOCKED"}],
                }
            },
        )
        assert "IP addresses" in places._build_error_message(r)

    def test_referrer_restricted_key(self):
        r = _response(
            403,
            {
                "error": {
                    "code": 403,
                    "message": "API keys with referer restrictions cannot be used with this API.",
                    "status": "PERMISSION_DENIED",
                    "details": [{"reason": "API_KEY_HTTP_REFERRER_BLOCKED"}],
                }
            },
        )
        assert "HTTP referrers" in places._build_error_message(r)

    def test_quota_exceeded(self):
        r = _response(
            429,
            {
                "error": {
                    "code": 429,
                    "message": "Quota exceeded for quota metric Requests.",
                    "status": "RESOURCE_EXHAUSTED",
                    "details": [],
                }
            },
        )
        assert "quota" in places._build_error_message(r).lower()

    def test_unrecognized_reason_still_surfaces_googles_message(self):
        r = _response(
            400,
            {
                "error": {
                    "code": 400,
                    "message": "Invalid field mask field: places.bogusField",
                    "status": "INVALID_ARGUMENT",
                    "details": [],
                }
            },
        )
        assert "bogusField" in places._build_error_message(r)

    def test_non_json_body_does_not_crash(self):
        r = _response(502, text="<html>Bad Gateway</html>")
        msg = places._build_error_message(r)
        assert "502" in msg


class TestSearchTextValidation:
    def test_missing_api_key_raises_actionable_error(self):
        with pytest.raises(places.PlacesAPIError, match="GOOGLE_PLACES_API_KEY"):
            places.search_text("hvac companies", "", max_results=20)

    def test_empty_query_raises(self):
        with pytest.raises(places.PlacesAPIError):
            places.search_text("   ", "fake_key", max_results=20)


def _place(i):
    return {"id": f"place_{i}", "displayName": {"text": f"Biz {i}"}, "businessStatus": "OPERATIONAL"}


def _json_response(status_code, body):
    request = httpx.Request("POST", places.SEARCH_URL)
    return httpx.Response(status_code, json=body, request=request)


class TestPagination:
    def test_retries_transient_error_on_paginated_request(self):
        calls = []

        def side_effect(self, url, headers=None, json=None):
            calls.append(json.get("pageToken"))
            if json.get("pageToken") and len(calls) == 2:
                return _json_response(
                    400, {"error": {"message": "token not yet valid", "status": "INVALID_ARGUMENT", "details": []}}
                )
            if not json.get("pageToken"):
                return _json_response(200, {"places": [_place(1)] * 20, "nextPageToken": "TOK1"})
            return _json_response(200, {"places": [_place(2)] * 20})

        with patch("httpx.Client.post", side_effect), patch("time.sleep", return_value=None):
            outcome = places.search_text("test query", "fake_key", max_results=40)

        assert len(outcome.places) == 40
        assert len(calls) == 3  # page1, page2 (fails), page2 retry (succeeds)
        assert outcome.requests_made == 3  # every real HTTP call, including the failed retry

    def test_hard_page_cap_stops_runaway_pagination(self):
        call_count = [0]

        def side_effect(self, url, headers=None, json=None):
            call_count[0] += 1
            return _json_response(200, {"places": [_place(call_count[0])], "nextPageToken": "SAME_TOKEN_FOREVER"})

        with patch("httpx.Client.post", side_effect), patch("time.sleep", return_value=None):
            outcome = places.search_text("test query", "fake_key", max_results=60)

        assert call_count[0] == places.MAX_PAGES
        assert len(outcome.places) == places.MAX_PAGES
        assert outcome.requests_made == places.MAX_PAGES

    def test_fewer_results_than_requested_terminates_cleanly(self):
        def side_effect(self, url, headers=None, json=None):
            return _json_response(200, {"places": [_place(1), _place(2)]})

        with patch("httpx.Client.post", side_effect), patch("time.sleep", return_value=None):
            outcome = places.search_text("niche query", "fake_key", max_results=60)

        assert len(outcome.places) == 2
        assert outcome.requests_made == 1

    def test_first_page_error_is_not_retried(self):
        call_count = [0]

        def side_effect(self, url, headers=None, json=None):
            call_count[0] += 1
            return _json_response(
                400,
                {
                    "error": {
                        "message": "API key not valid.",
                        "status": "INVALID_ARGUMENT",
                        "details": [{"reason": "API_KEY_INVALID"}],
                    }
                },
            )

        with patch("httpx.Client.post", side_effect), patch("time.sleep", return_value=None):
            with pytest.raises(places.PlacesAPIError) as exc_info:
                places.search_text("test", "bad_key", max_results=20)

        assert call_count[0] == 1
        # The exception itself carries the count so a caller can still
        # record usage for a search that made a real (billed) API call
        # before ultimately failing.
        assert exc_info.value.requests_made == 1
