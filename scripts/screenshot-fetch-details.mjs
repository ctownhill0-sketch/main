#!/usr/bin/env node
// One-off check for the Results page's "Fetch details" confirmation dialog.
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

await page.goto(`http://localhost:${PORT}/#/results`, { waitUntil: "networkidle" });
await page.getByRole("checkbox", { name: /^Select /i }).first().click();
await page.waitForTimeout(150);
await page.getByRole("button", { name: /Fetch details/ }).click();
await page.waitForTimeout(150);
await page.screenshot({ path: path.join(outDir, "fetch-details-confirm.png") });
console.log("Saved fetch-details-confirm.png");
await browser.close();
server.kill();
process.exit(0);
