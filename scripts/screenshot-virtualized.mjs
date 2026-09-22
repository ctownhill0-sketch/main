#!/usr/bin/env node
// One-off check that the Results table virtualizes: generates 300 fake
// places, loads /results, and asserts the number of rendered row elements
// is far smaller than 300 (proving only the visible window is mounted).
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

const PORT = 4173;
const outDir = path.resolve(import.meta.dirname, ".screenshots");
mkdirSync(outDir, { recursive: true });

const bigPlaces = Array.from({ length: 300 }, (_, i) => ({
  placeId: `p${i}`,
  displayName: `Business ${i}`,
  formattedAddress: `${100 + i} Main St, Austin, TX 78701`,
  primaryType: ["cafe", "plumber", "restaurant", "retail"][i % 4],
  businessStatus: ["OPERATIONAL", "CLOSED_TEMPORARILY"][i % 5 === 0 ? 1 : 0],
  lat: 30.26 + i * 0.001,
  lng: -97.74 + i * 0.001,
  discoveredAt: "2026-09-20T14:00:00Z",
  cachedAt: "2026-09-21T09:00:00Z",
  nationalPhoneNumber: i % 3 === 0 ? `(512) 555-0${100 + i}` : null,
  websiteUri: i % 4 === 0 ? null : "https://example.com",
  rating: 3 + (i % 20) / 10,
  userRatingCount: i * 3,
  lastDetailsRefreshedAt: i % 4 === 0 ? "2026-09-21T09:00:00Z" : null,
}));

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
await page.addInitScript((placesJson) => {
  const places = JSON.parse(placesJson);
  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd) => {
      if (cmd === "has_api_key") return true;
      if (cmd === "list_places") return places;
      return null;
    },
    transformCallback: () => 0,
    unregisterCallback: () => {},
  };
}, JSON.stringify(bigPlaces));

await page.goto(`http://localhost:${PORT}/#/results`, { waitUntil: "networkidle" });
await page.waitForTimeout(300);

const rowCount = await page.locator('[role="rowgroup"] [role="row"]').count();
const headerText = await page.locator("text=of 300 places").first().textContent().catch(() => null);

console.log(`Rendered row elements in DOM: ${rowCount} (of 300 total places)`);
console.log(`Header shows: ${headerText}`);

await page.screenshot({ path: path.join(outDir, "virtualized-300-rows.png") });

// Scroll partway down and screenshot again to confirm rows update correctly.
await page.locator('[role="table"]').evaluate((el) => { el.scrollTop = 4000; });
await page.waitForTimeout(300);
const rowCountAfterScroll = await page.locator('[role="rowgroup"] [role="row"]').count();
console.log(`Rendered row elements after scrolling: ${rowCountAfterScroll}`);
await page.screenshot({ path: path.join(outDir, "virtualized-300-rows-scrolled.png") });

await browser.close();
server.kill();

if (rowCount > 60) {
  console.error(`FAIL: expected far fewer than 300 rows rendered, got ${rowCount}`);
  process.exit(1);
}
console.log("PASS: virtualization is working (only a small window of rows is mounted).");
process.exit(0);
