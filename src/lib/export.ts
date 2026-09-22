import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile, writeFile } from "@tauri-apps/plugin-fs";

import type { LeadRow } from "@/lib/commands";

/**
 * Export columns: our own pipeline data (kept indefinitely) plus whatever
 * Google Maps Content is currently on file. Google fields are exported
 * as of the last time they were fetched/refreshed — see the Compliance
 * panel for why this app doesn't warehouse them permanently.
 */
function leadToRow(lead: LeadRow) {
  return {
    "Place ID": lead.placeId,
    Name: lead.displayName ?? "",
    Address: lead.formattedAddress ?? "",
    Type: lead.primaryType ?? "",
    "Business Status": lead.businessStatus ?? "",
    Phone: lead.nationalPhoneNumber ?? "",
    Website: lead.websiteUri ?? "",
    "Pipeline Status": lead.status,
    Tags: lead.tags.map((t) => t.name).join(", "),
    Notes: lead.notes,
    "Added to Pipeline At": lead.createdAt,
    "Last Updated At": lead.updatedAt,
  };
}

function toCsv(rows: ReturnType<typeof leadToRow>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const lines = [
    headers.map(escape).join(","),
    ...rows.map((row) => headers.map((h) => escape(String(row[h as keyof typeof row] ?? ""))).join(",")),
  ];
  return lines.join("\n");
}

export async function exportLeadsToCsv(leads: LeadRow[]): Promise<boolean> {
  const path = await save({
    defaultPath: "leadscout-leads.csv",
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });
  if (!path) return false;
  await writeTextFile(path, toCsv(leads.map(leadToRow)));
  return true;
}

export async function exportLeadsToXlsx(leads: LeadRow[]): Promise<boolean> {
  const path = await save({
    defaultPath: "leadscout-leads.xlsx",
    filters: [{ name: "Excel", extensions: ["xlsx"] }],
  });
  if (!path) return false;

  // Loaded on demand — xlsx is a large dependency only needed for this export.
  const XLSX = await import("xlsx");
  const worksheet = XLSX.utils.json_to_sheet(leads.map(leadToRow));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Leads");
  const buffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  await writeFile(path, new Uint8Array(buffer));
  return true;
}
