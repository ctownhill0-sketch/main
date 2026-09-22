#!/usr/bin/env node
// Best-effort headless UI verification for a sandbox with no display: boots
// the Vite dev server, screenshots the given route(s) with Playwright's
// pre-installed Chromium, and saves them to scripts/.screenshots/. Not a
// substitute for interactively running `pnpm tauri dev` — Tauri-only APIs
// (invoke) don't exist in a plain browser, so screens gated on their result
// fall back to their error/empty state, which is still useful for layout QA.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

const PORT = 4173;
const routes = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ["/"];
const outDir = path.resolve(import.meta.dirname, ".screenshots");
mkdirSync(outDir, { recursive: true });

const server = spawn("pnpm", ["exec", "vite", "preview", "--port", String(PORT), "--strictPort"], {
  cwd: path.resolve(import.meta.dirname, ".."),
  stdio: "pipe",
});

await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("dev server did not start in time")), 30000);
  server.stdout.on("data", (chunk) => {
    if (chunk.toString().includes("Local:")) {
      clearTimeout(timeout);
      resolve();
    }
  });
  server.stderr.on("data", (chunk) => console.error(chunk.toString()));
});

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

// Fake Tauri IPC so screens gated on `invoke()` render their real content
// instead of falling back to an error/onboarding state. Fixture data lives
// in scripts/screenshot-fixtures.mjs; extend it there as new commands land.
const { fixtures } = await import("./screenshot-fixtures.mjs");
await page.addInitScript((fixturesJson) => {
  const fixtures = JSON.parse(fixturesJson);
  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd) => {
      if (cmd in fixtures) return fixtures[cmd];
      console.warn(`[screenshot mock] no fixture for command "${cmd}"`);
      return null;
    },
    transformCallback: () => 0,
    unregisterCallback: () => {},
  };
}, JSON.stringify(fixtures));

for (const route of routes) {
  const url = `http://localhost:${PORT}/#${route}`;
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  const filename = `${route.replace(/\//g, "_") || "root"}.png`;
  await page.screenshot({ path: path.join(outDir, filename) });
  console.log(`Saved ${filename}`);
}

await browser.close();
server.kill();
process.exit(0);
