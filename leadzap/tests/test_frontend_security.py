"""Regression tests for frontend JS security logic, run against the
REAL static/app.js file (not a reimplementation) so a later edit that
silently weakens it gets caught here.

Technique: Node's vm module executes app.js with just enough of
`document`/`fetch` stubbed to avoid a ReferenceError. The top-level
DOM-wiring code (e.g. `searchForm.addEventListener(...)`) still throws
once it hits a stubbed null element -- but JS hoists `function`
declarations before any statement runs, so by the time that throw
happens, functions like `isHttpUrl` are already attached to the
context object and can be called directly. No browser needed.

Requires Node.js (very likely already present; skipped cleanly if not).
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

APP_JS_PATH = Path(__file__).resolve().parent.parent / "static" / "app.js"

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None, reason="Node.js not found -- skipping frontend JS regression tests"
)


def _call_frontend_function(function_name: str, args: list):
    script = f"""
const vm = require('vm');
const fs = require('fs');
const code = fs.readFileSync({json.dumps(str(APP_JS_PATH))}, 'utf8');
const context = {{
    document: {{ getElementById: () => null, createElement: () => ({{}}), querySelectorAll: () => [] }},
    fetch: () => {{}},
    URLSearchParams: URLSearchParams,
    URL: URL,
    console: console,
}};
vm.createContext(context);
try {{
    vm.runInContext(code, context);
}} catch (e) {{
    // Expected: top-level DOM wiring throws against our stubbed document.
    // Function declarations are hoisted before this point, so we don't care.
}}
const fn = context[{json.dumps(function_name)}];
if (typeof fn !== 'function') {{
    console.log(JSON.stringify({{ok: false, error: 'function not found: ' + {json.dumps(function_name)}}}));
    process.exit(0);
}}
const result = fn(...{json.dumps(args)});
console.log(JSON.stringify({{ok: true, result}}));
"""
    proc = subprocess.run(["node", "-e", script], capture_output=True, text=True, timeout=15)
    assert proc.returncode == 0, f"node script crashed: {proc.stderr}"
    parsed = json.loads(proc.stdout)
    assert parsed["ok"], parsed.get("error")
    return parsed["result"]


class TestUrlSchemeAllowlist:
    """Regression test for the Phase 5 XSS fix. The website link must
    only ever become a clickable <a href> for http(s) URLs -- rendering
    a javascript:/data: URL straight into an href is a real, demonstrated
    XSS vector (see the Phase 5 audit: it was blocked only incidentally,
    by target="_blank", not by design). This exact class of fix is easy
    to silently undo later -- e.g. simplifying isHttpUrl back down to a
    truthiness check, or reverting to escapeAttr-only rendering -- so it
    gets its own test independent of everything else."""

    @pytest.mark.parametrize(
        "url,expected",
        [
            ("https://example.com", True),
            ("http://example.com", True),
            ("HTTPS://EXAMPLE.COM", True),
            ("https://example.com/contact?ref=google", True),
            ("javascript:alert(1)", False),
            ("javascript:alert(document.cookie)", False),
            ("JaVaScRiPt:alert(1)", False),
            ("data:text/html,<script>alert(1)</script>", False),
            ("vbscript:msgbox(1)", False),
            ("//evil.com/x", False),  # protocol-relative -- resolves against the page's own origin, ambiguous
            ("", False),
            (None, False),
            ("not a url at all", False),
        ],
    )
    def test_is_http_url(self, url, expected):
        assert _call_frontend_function("isHttpUrl", [url]) == expected

    # Note: escapeHtml (the other half of the Phase 5 XSS fix) is NOT
    # tested here. It works by round-tripping through a real DOM element's
    # textContent -> innerHTML, which this harness's minimal `document`
    # stub can't faithfully emulate (createElement returns a plain object,
    # not a real element -- .innerHTML would just be undefined). Doing
    # this properly needs jsdom, an extra dependency not currently worth
    # adding for one function; escapeHtml's correctness is instead covered
    # by the real-browser Playwright check done manually in the Phase 5
    # audit (planting <script>/<img onerror> payloads and confirming no
    # dialog fires against the live app).
