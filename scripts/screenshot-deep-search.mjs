#!/usr/bin/env node
// One-off interactive check for the Deep Search tab + cost confirmation
// dialog (multi-step, so it doesn't fit the generic screenshot.mjs route
// list). Not part of the regular verification flow — run manually when
// touching that UI.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fixtures } from "./screenshot-fixtures.mjs";

const PORT = 4173;
const outDir = path.resolve(import.meta.dirname, ".screenshots");
mkdirSync(outDir, { recursive: true });

const server = spawn("pnpm", ["exec", "vite", "preview", "--port", String(PORT), "--strictPort"], {
  cwd: path.resolve(import.meta.dirname, ".."),
  stdio: "pipe",
});
await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("timeout")), 30000);
  server.stdout.on("data", (c) => {
    if (c.toString().includes("Local:")) {
      clearTimeout(timeout);
      resolve();
    }
  });
});

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.addInitScript((fixturesJson) => {
  const fixtures = JSON.parse(fixturesJson);
  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd) => (cmd in fixtures ? fixtures[cmd] : null),
    transformCallback: () => 0,
    unregisterCallback: () => {},
  };
}, JSON.stringify(fixtures));

await page.goto(`http://localhost:${PORT}/#/search`, { waitUntil: "networkidle" });
await page.getByRole("tab", { name: "Deep Search" }).click();
await page.getByLabel("Business type / keyword").fill("coffee shops");
await page.getByLabel("Location / area").fill("Austin, TX");
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(outDir, "deep-search-form.png") });

await page.getByRole("button", { name: "Review cost & start" }).click();
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(outDir, "deep-search-confirm.png") });

console.log("Saved deep-search-form.png and deep-search-confirm.png");
await browser.close();
server.kill();
process.exit(0);
