#!/usr/bin/env node
// One-off check for the Results and Pipeline skeleton loading states —
// delays list_places/list_leads so the skeleton is visible long enough to
// screenshot.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

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
await page.addInitScript(() => {
  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd) => {
      if (cmd === "has_api_key") return true;
      // Never resolve list_places/list_leads/list_tags/get_lead_statuses —
      // keeps the page in its loading state indefinitely for this screenshot.
      if (["list_places", "list_leads", "list_tags", "get_lead_statuses"].includes(cmd)) {
        return new Promise(() => {});
      }
      return null;
    },
    transformCallback: () => 0,
    unregisterCallback: () => {},
  };
});

await page.goto(`http://localhost:${PORT}/#/results`, { waitUntil: "networkidle" });
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(outDir, "results-skeleton.png") });

await page.goto(`http://localhost:${PORT}/#/pipeline`, { waitUntil: "networkidle" });
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(outDir, "pipeline-skeleton.png") });

console.log("Saved results-skeleton.png and pipeline-skeleton.png");
await browser.close();
server.kill();
process.exit(0);
