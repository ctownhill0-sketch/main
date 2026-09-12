"""Tests for email extraction, filtering, and scoring logic in enrich.py.
All pure functions -- no network calls, no fixtures needed beyond what's
built in."""
from __future__ import annotations

import time

import pytest

import enrich


class TestJunkFilter:
    """Every junk pattern from the original spec, plus the subdomain
    case that slipped through before the fix (see git history: this
    filter shipped once already looking complete and still had a real
    bypass for platform-domain subdomains)."""

    @pytest.mark.parametrize(
        "email",
        [
            "noreply@acme.com",
            "no-reply@acme.com",
            "donotreply@acme.com",
            "logo@2x.png",
            "sentry@sentry.io",
            "someone@wixpress.com",
            "sentry@sentry-next.wixpress.com",  # subdomain of a blocked domain
            "user@example.com",
            "admin@godaddy.com",
            "help@squarespace.com",
        ],
    )
    def test_rejects_junk(self, email):
        valid, _ = enrich._validate_email(email, "somesite.com")
        assert not valid, f"{email} should have been rejected"

    def test_accepts_legitimate_email(self):
        valid, confidence = enrich._validate_email("info@somesite.com", "somesite.com")
        assert valid
        assert confidence == "high"

    def test_no_at_sign_rejected(self):
        valid, _ = enrich._validate_email("not-an-email", "somesite.com")
        assert not valid


class TestSubdomainBlocking:
    def test_exact_blocked_domain(self):
        assert enrich._domain_is_blocked("wixpress.com")

    def test_subdomain_of_blocked_domain(self):
        assert enrich._domain_is_blocked("sentry-next.wixpress.com")

    def test_deeper_subdomain_of_blocked_domain(self):
        assert enrich._domain_is_blocked("a.b.wixpress.com")

    def test_lookalike_domain_not_a_real_subdomain_is_not_blocked(self):
        # Must be a genuine suffix match (preceded by a dot), not a bare
        # substring check -- "wixpress.com" appearing anywhere in the
        # string must not be enough.
        assert not enrich._domain_is_blocked("mywixpress.com.au")
        assert not enrich._domain_is_blocked("notwixpress.com")


class TestConfidenceScoring:
    def test_same_domain_is_high(self):
        valid, confidence = enrich._validate_email("info@acmehvac.com", "www.acmehvac.com")
        assert valid and confidence == "high"

    def test_freemail_address_is_low(self):
        valid, confidence = enrich._validate_email("owner@gmail.com", "www.acmehvac.com")
        assert valid and confidence == "low"

    def test_mismatched_corporate_domain_is_low(self):
        # e.g. the web designer's own address left in a template footer
        valid, confidence = enrich._validate_email("webmaster@someagency.com", "www.acmehvac.com")
        assert valid and confidence == "low"

    def test_www_prefix_does_not_cause_a_false_mismatch(self):
        valid, confidence = enrich._validate_email("info@acmehvac.com", "acmehvac.com")
        assert valid and confidence == "high"


class TestObfuscatedEmailParsing:
    @pytest.mark.parametrize(
        "text,expected",
        [
            ("Reach us at jane [at] acmehvac [dot] com any time.", "jane@acmehvac.com"),
            ("Email: sales(at)acmehvac.com", "sales@acmehvac.com"),
            ("Contact info [at] acmehvac [dot] com for quotes.", "info@acmehvac.com"),
            ("Write to us at team [at] example [dot] co [dot] uk please.", "team@example.co.uk"),
        ],
    )
    def test_extracts_obfuscated_email(self, text, expected):
        assert expected in enrich._find_obfuscated_emails(text)

    @pytest.mark.parametrize(
        "text",
        [
            "Meet us at 5pm at the office.",
            "The dot com boom happened at the turn of the century.",
            "We are at 123 Main St. Call anytime.",
        ],
    )
    def test_no_false_positives_on_ordinary_prose(self, text):
        # Bare "at"/"dot" (not bracketed) must never be treated as
        # obfuscation -- both words are far too common in normal English.
        assert enrich._find_obfuscated_emails(text) == []

    def test_html_entity_encoded_email_is_decoded(self):
        candidates = enrich._extract_candidates("<p>Email: jane&#64;acmehvac&#46;com</p>")
        assert any(email == "jane@acmehvac.com" for email, _ in candidates)


class TestContactLinkDiscovery:
    """Relative URL resolution -- a previously-flagged top source of
    missed emails when only guessing fixed paths."""

    def test_resolves_root_relative_link(self):
        html = '<html><body><a href="/contact">Contact Us</a></body></html>'
        links = enrich._discover_contact_links(html, "https://example.com/")
        assert links == ["https://example.com/contact"]

    def test_resolves_bare_relative_link(self):
        html = '<html><body><a href="contact.html">Contact</a></body></html>'
        links = enrich._discover_contact_links(html, "https://example.com/")
        assert links == ["https://example.com/contact.html"]

    def test_resolves_dot_dot_relative_link(self):
        html = '<html><body><a href="../contact">Contact</a></body></html>'
        links = enrich._discover_contact_links(html, "https://example.com/about/team/")
        assert links == ["https://example.com/about/contact"]

    def test_ignores_offsite_links(self):
        html = '<html><body><a href="https://otherdomain.com/contact">Contact</a></body></html>'
        assert enrich._discover_contact_links(html, "https://example.com/") == []

    def test_ignores_mailto_tel_and_hash_links(self):
        html = """<html><body>
            <a href="mailto:x@example.com">Email</a>
            <a href="tel:5551234">Call</a>
            <a href="#contact">Contact</a>
        </body></html>"""
        assert enrich._discover_contact_links(html, "https://example.com/") == []

    def test_requires_a_contact_keyword(self):
        html = '<html><body><a href="/random-page">Random</a></body></html>'
        assert enrich._discover_contact_links(html, "https://example.com/") == []


class TestRoleBasedPreference:
    def test_prefers_role_based_over_personal_when_both_are_mailto(self):
        candidates = [
            ("jane.smith@acmehvac.com", True, "https://acmehvac.com"),
            ("info@acmehvac.com", True, "https://acmehvac.com"),
        ]
        best = enrich._choose_best_email(candidates, "www.acmehvac.com")
        assert best["email"] == "info@acmehvac.com"

    def test_prefers_role_based_plaintext_over_personal_mailto(self):
        candidates = [
            ("bob@acmehvac.com", True, "https://acmehvac.com"),
            ("contact@acmehvac.com", False, "https://acmehvac.com/contact"),
        ]
        best = enrich._choose_best_email(candidates, "www.acmehvac.com")
        assert best["email"] == "contact@acmehvac.com"

    def test_prefers_same_domain_over_freemail_when_neither_is_role_based(self):
        candidates = [
            ("owner@gmail.com", True, "https://acmehvac.com"),
            ("bob@acmehvac.com", False, "https://acmehvac.com/about"),
        ]
        best = enrich._choose_best_email(candidates, "www.acmehvac.com")
        assert best["email"] == "bob@acmehvac.com"
        assert best["confidence"] == "high"

    def test_no_valid_candidates_returns_none(self):
        candidates = [("noreply@acmehvac.com", True, "https://acmehvac.com")]
        assert enrich._choose_best_email(candidates, "www.acmehvac.com") is None


class TestRegexPerformanceSafety:
    """Regression test for the catastrophic-backtracking bug found during
    Phase 3 real-scale testing: a large page with no email-like structure
    (e.g. an inline base64 image) made both EMAIL_REGEX and the
    obfuscated-email regex hang for minutes. Fixed via bounded, chunked
    scanning -- this test guards against that fix being lost."""

    def test_pathological_content_resolves_quickly(self):
        pathological_html = "<html><body>" + ("x" * (2 * 1024 * 1024)) + "</body></html>"
        start = time.monotonic()
        candidates = enrich._extract_candidates(pathological_html)
        elapsed = time.monotonic() - start
        assert elapsed < 3.0, f"took {elapsed:.2f}s -- possible regex backtracking regression"
        assert candidates == []

    def test_huge_inline_script_is_stripped_before_scanning(self):
        html = (
            "<html><body><script>" + ("var x=1;" * 100_000) + "</script>"
            '<a href="mailto:info@biz.com">c</a></body></html>'
        )
        start = time.monotonic()
        candidates = enrich._extract_candidates(html)
        elapsed = time.monotonic() - start
        assert elapsed < 1.0
        assert ("info@biz.com", True) in candidates
