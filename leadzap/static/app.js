// LeadZap frontend — vanilla JS, no build step.

const STATUS_OPTIONS = [
  "new",
  "contacted",
  "replied",
  "call_booked",
  "closed_won",
  "closed_lost",
  "not_a_fit",
];

const state = {
  leads: [],
  selectedIds: new Set(),
};

const el = (id) => document.getElementById(id);

const searchForm = el("search-form");
const searchQueryInput = el("search-query");
const searchCountInput = el("search-count");
const searchBtn = el("search-btn");
const searchError = el("search-error");
const searchStatus = el("search-status");

const filterStatus = el("filter-status");
const filterEmail = el("filter-email");
const filterFollowup = el("filter-followup");
const filterSearch = el("filter-search");

const selectAllCheckbox = el("select-all");
const tbody = el("leads-tbody");

const enrichSelectedBtn = el("enrich-selected-btn");
const enrichMissingBtn = el("enrich-missing-btn");
const exportBtn = el("export-btn");
const enrichProgressEl = el("enrich-progress");

let progressPollTimer = null;

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

function currentFilters() {
  const params = new URLSearchParams();
  if (filterStatus.value) params.set("status", filterStatus.value);
  if (filterEmail.value) params.set("has_email", filterEmail.value);
  if (filterFollowup.checked) params.set("needs_followup", "true");
  if (filterSearch.value.trim()) params.set("q", filterSearch.value.trim());
  return params;
}

async function loadLeads() {
  const params = currentFilters();
  const res = await fetch(`/api/leads?${params.toString()}`);
  state.leads = res.ok ? await res.json() : [];
  state.selectedIds.clear();
  renderTable();
}

async function loadStats() {
  const res = await fetch("/api/stats");
  if (!res.ok) return;
  const stats = await res.json();
  for (const key of ["total", "contacted", "replied", "call_booked", "closed_won", "emails_found"]) {
    const target = el(`stat-${key}`);
    if (target) target.textContent = stats[key] ?? 0;
  }
}

function refreshAll() {
  loadLeads();
  loadStats();
}

// ---------------------------------------------------------------------------
// Table rendering
// ---------------------------------------------------------------------------

// Statuses a lead can still meaningfully be followed up on -- mirrors
// db.FOLLOWUP_ACTIVE_STATUSES. Terminal statuses (closed_won/
// closed_lost/not_a_fit) are excluded from highlighting, but their
// followup_date is never cleared -- reopening a lead makes it relevant again.
const FOLLOWUP_ACTIVE_STATUSES = ["new", "contacted", "replied", "call_booked"];

function todayISO() {
  // Local calendar date, not toISOString() (which is UTC) -- this must
  // match the backend's date.today() (also local time) or a lead near
  // midnight could show as overdue here but not server-side, or vice versa.
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function needsFollowup(lead) {
  return (
    FOLLOWUP_ACTIVE_STATUSES.includes(lead.status) &&
    lead.followup_date &&
    lead.followup_date <= todayISO()
  );
}

function emailCell(lead) {
  if (!lead.website && lead.enrichment_status === "no_website") {
    return `<span class="badge badge-muted">no website</span>`;
  }
  if (lead.email) {
    const badgeClass = lead.email_confidence === "low" ? "badge-low" : "badge-high";
    const badgeText = lead.email_confidence === "low" ? "low confidence" : "verified match";
    return `
      <div class="email-cell">
        <span>${escapeHtml(lead.email)}</span>
        <span class="badge ${badgeClass}">${badgeText}</span>
      </div>`;
  }
  const statusLabels = {
    pending: `<span class="badge badge-muted">not enriched</span>`,
    not_found: `<span class="badge badge-muted">no email found</span>`,
    failed: `<span class="badge badge-failed">enrichment failed</span>`,
    no_website: `<span class="badge badge-muted">no website</span>`,
  };
  return statusLabels[lead.enrichment_status] || statusLabels.pending;
}

function statusSelect(lead) {
  const options = STATUS_OPTIONS.map(
    (s) =>
      `<option value="${s}" ${s === lead.status ? "selected" : ""}>${s
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())}</option>`
  ).join("");
  return `<select class="status-select status-${lead.status}" data-id="${lead.id}" data-field="status">${options}</select>`;
}

function renderTable() {
  if (state.leads.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="8">No leads match the current filters.</td></tr>`;
    selectAllCheckbox.checked = false;
    return;
  }

  tbody.innerHTML = state.leads
    .map((lead) => {
      const rowClass = needsFollowup(lead) ? "needs-followup" : "";
      const website = lead.website
        ? `<a class="website-link" href="${escapeAttr(lead.website)}" target="_blank" rel="noopener">${escapeHtml(
            shortenUrl(lead.website)
          )}</a>`
        : `<span class="badge badge-muted">none</span>`;

      return `
        <tr class="${rowClass}" data-row-id="${lead.id}">
          <td><input type="checkbox" class="row-check" data-id="${lead.id}" ${
        state.selectedIds.has(lead.id) ? "checked" : ""
      } /></td>
          <td>
            <div class="lead-name">${escapeHtml(lead.name)}</div>
            <div class="lead-address">${escapeHtml(lead.address || "")}</div>
          </td>
          <td>${escapeHtml(lead.phone || "—")}</td>
          <td>${emailCell(lead)}</td>
          <td>${website}</td>
          <td>${statusSelect(lead)}</td>
          <td><input type="date" class="followup-input" data-id="${lead.id}" data-field="followup_date" value="${
        lead.followup_date || ""
      }" /></td>
          <td class="notes-cell">${renderNotesCell(lead)}</td>
        </tr>`;
    })
    .join("");

  attachRowHandlers();
  updateSelectAllState();
}

function renderNotesCell(lead) {
  const escaped = escapeHtml(lead.notes || "");
  const empty = !lead.notes;
  return `<div class="notes-preview ${empty ? "empty" : ""}" data-id="${lead.id}">${empty ? "" : escaped}</div>`;
}

function shortenUrl(url) {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function escapeAttr(str) {
  return (str ?? "").replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Row interaction
// ---------------------------------------------------------------------------

function attachRowHandlers() {
  document.querySelectorAll(".row-check").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const id = Number(e.target.dataset.id);
      if (e.target.checked) state.selectedIds.add(id);
      else state.selectedIds.delete(id);
      updateSelectAllState();
    });
  });

  document.querySelectorAll(".status-select").forEach((sel) => {
    sel.addEventListener("change", async (e) => {
      const id = Number(e.target.dataset.id);
      await patchLead(id, { status: e.target.value });
      refreshAll();
    });
  });

  document.querySelectorAll('.followup-input').forEach((input) => {
    input.addEventListener("change", async (e) => {
      const id = Number(e.target.dataset.id);
      await patchLead(id, { followup_date: e.target.value });
      refreshAll();
    });
  });

  document.querySelectorAll(".notes-preview").forEach((div) => {
    div.addEventListener("click", () => openNotesEditor(div));
  });
}

function openNotesEditor(previewDiv) {
  const id = Number(previewDiv.dataset.id);
  const lead = state.leads.find((l) => l.id === id);
  const textarea = document.createElement("textarea");
  textarea.className = "notes-textarea";
  textarea.value = lead ? lead.notes || "" : "";
  previewDiv.replaceWith(textarea);
  textarea.focus();

  const save = async () => {
    await patchLead(id, { notes: textarea.value });
    if (lead) lead.notes = textarea.value;
    const newPreview = document.createElement("div");
    newPreview.className = `notes-preview ${textarea.value ? "" : "empty"}`;
    newPreview.dataset.id = String(id);
    newPreview.textContent = textarea.value;
    newPreview.addEventListener("click", () => openNotesEditor(newPreview));
    textarea.replaceWith(newPreview);
  };

  textarea.addEventListener("blur", save);
}

async function patchLead(id, fields) {
  await fetch(`/api/leads/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
}

function updateSelectAllState() {
  const checkboxes = document.querySelectorAll(".row-check");
  selectAllCheckbox.checked = checkboxes.length > 0 && state.selectedIds.size === checkboxes.length;
}

selectAllCheckbox.addEventListener("change", (e) => {
  document.querySelectorAll(".row-check").forEach((cb) => {
    cb.checked = e.target.checked;
    const id = Number(cb.dataset.id);
    if (e.target.checked) state.selectedIds.add(id);
    else state.selectedIds.delete(id);
  });
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

searchForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  searchError.hidden = true;
  searchStatus.hidden = true;
  searchBtn.disabled = true;
  searchBtn.textContent = "Searching...";

  try {
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: searchQueryInput.value.trim(),
        max_results: Number(searchCountInput.value) || 20,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || "Search failed.");
    }
    searchStatus.textContent =
      `Found ${data.total_found} result(s) — ${data.inserted} new, ` +
      `${data.updated} refreshed, ${data.skipped} skipped.`;
    searchStatus.hidden = false;
    refreshAll();
  } catch (err) {
    searchError.textContent = err.message;
    searchError.hidden = false;
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = "Find Leads";
  }
});

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

[filterStatus, filterEmail, filterFollowup].forEach((elm) => elm.addEventListener("change", loadLeads));
let filterSearchTimer = null;
filterSearch.addEventListener("input", () => {
  clearTimeout(filterSearchTimer);
  filterSearchTimer = setTimeout(loadLeads, 300);
});

// ---------------------------------------------------------------------------
// Enrichment
// ---------------------------------------------------------------------------

async function startEnrichment(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.detail || "Could not start enrichment.");
    return;
  }
  if (data.count === 0) {
    enrichProgressEl.textContent = "Nothing to enrich.";
    enrichProgressEl.hidden = false;
    return;
  }
  pollProgress();
}

enrichSelectedBtn.addEventListener("click", () => {
  const ids = Array.from(state.selectedIds);
  if (ids.length === 0) {
    alert("Select at least one lead first.");
    return;
  }
  startEnrichment("/api/enrich/selected", { lead_ids: ids });
});

enrichMissingBtn.addEventListener("click", () => {
  startEnrichment("/api/enrich/all-missing", {});
});

function pollProgress() {
  setButtonsDisabled(true);
  clearInterval(progressPollTimer);
  progressPollTimer = setInterval(async () => {
    const res = await fetch("/api/enrich/progress");
    const progress = await res.json();

    if (progress.total > 0) {
      enrichProgressEl.textContent = `Enriching ${progress.done} of ${progress.total}${
        progress.current_name ? ` — ${progress.current_name}` : ""
      }...`;
      enrichProgressEl.hidden = false;
    }

    if (!progress.running) {
      clearInterval(progressPollTimer);
      setButtonsDisabled(false);
      enrichProgressEl.textContent = "Enrichment complete.";
      setTimeout(() => (enrichProgressEl.hidden = true), 4000);
      refreshAll();
    }
  }, 1000);
}

function setButtonsDisabled(disabled) {
  enrichSelectedBtn.disabled = disabled;
  enrichMissingBtn.disabled = disabled;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

exportBtn.addEventListener("click", () => {
  const params = currentFilters();
  window.location.href = `/api/export/csv?${params.toString()}`;
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

refreshAll();

// Resume polling if a job was already running when the page loaded/reloaded.
(async function checkInFlightJob() {
  const res = await fetch("/api/enrich/progress");
  const progress = await res.json();
  if (progress.running) pollProgress();
})();
