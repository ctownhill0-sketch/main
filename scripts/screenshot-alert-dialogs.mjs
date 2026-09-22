#!/usr/bin/env node
// One-off check for the new AlertDialog confirmations and empty states.
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

// 1. Remove-lead AlertDialog on Pipeline.
await page.goto(`http://localhost:${PORT}/#/pipeline`, { waitUntil: "networkidle" });
await page.getByLabel(/^Remove .* from pipeline$/).first().click();
await page.waitForTimeout(250);
await page.screenshot({ path: path.join(outDir, "alert-dialog-remove-lead.png") });
await page.keyboard.press("Escape");
await page.waitForTimeout(150);

// 2. Delete-saved-search AlertDialog on Search.
await page.goto(`http://localhost:${PORT}/#/search`, { waitUntil: "networkidle" });
await page.getByLabel(/^Delete saved search/).first().click();
await page.waitForTimeout(250);
await page.screenshot({ path: path.join(outDir, "alert-dialog-delete-search.png") });
await page.keyboard.press("Escape");
await page.waitForTimeout(150);

// 3. Empty states (fixtures with empty arrays) — fresh page to avoid any
// ambiguity from stacking a second addInitScript on the same page.
const emptyPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await emptyPage.addInitScript(() => {
  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd) => {
      if (cmd === "has_api_key") return true;
      if (cmd === "list_places") return [];
      if (cmd === "list_leads") return [];
      if (cmd === "list_tags") return [];
      if (cmd === "get_lead_statuses") return ["New", "Contacted", "Qualified", "Won", "Lost"];
      return null;
    },
    transformCallback: () => 0,
    unregisterCallback: () => {},
  };
});
await emptyPage.goto(`http://localhost:${PORT}/#/results`, { waitUntil: "networkidle" });
await emptyPage.waitForTimeout(200);
await emptyPage.screenshot({ path: path.join(outDir, "empty-state-results.png") });

await emptyPage.goto(`http://localhost:${PORT}/#/pipeline`, { waitUntil: "networkidle" });
await emptyPage.waitForTimeout(200);
await emptyPage.screenshot({ path: path.join(outDir, "empty-state-pipeline.png") });

console.log("Saved alert-dialog and empty-state screenshots");
await browser.close();
server.kill();
process.exit(0);
