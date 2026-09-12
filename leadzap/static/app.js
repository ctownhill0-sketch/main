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
const requestEstimateEl = el("request-estimate");
const usageCounterEl = el("usage-counter");
const usageWarningEl = el("usage-warning");
const usageWarningTextEl = el("usage-warning-text");
const usageWarningDismissBtn = el("usage-warning-dismiss");

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

let loadLeadsSeq = 0;

async function loadLeads() {
  // Guard against an out-of-order response: if a NEWER loadLeads() call
  // has already started (or finished) by the time this one's fetch
  // resolves, discard this one rather than let a stale response
  // clobber fresher state that's already on screen.
  const mySeq = ++loadLeadsSeq;
  const params = currentFilters();
  const res = await fetch(`/api/leads?${params.toString()}`);
  const data = res.ok ? await res.json() : [];
  if (mySeq !== loadLeadsSeq) return;

  state.leads = data;
  // Drop selections only for leads no longer in the current filtered
  // view (e.g. filtered out) -- an unrelated edit or an enrichment batch
  // completing shouldn't silently clear a selection you're mid-workflow on.
  const currentIds = new Set(data.map((l) => l.id));
  for (const id of Array.from(state.selectedIds)) {
    if (!currentIds.has(id)) state.selectedIds.delete(id);
  }
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
  return `<select class="status-select status-${lead.status}" data-id="${lead.id}" data-field="status" data-previous-value="${lead.status}">${options}</select>`;
}

function renderTable() {
  // A notes editor the user has open (and possibly mid-typing, unsaved)
  // must survive a refresh -- rebuilding the row from scratch would
  // destroy the textarea, and relying on the resulting native blur
  // event to save it is NOT reliable: that save races the very fetch
  // that's about to render this row from (now-stale) server data, and
  // can leave the on-screen preview showing blank/old text even though
  // the save actually landed in the DB. Capture open editors' current
  // (possibly unsaved) values now, and restore them after rebuilding.
  const openEditors = {};
  document.querySelectorAll(".notes-textarea").forEach((ta) => {
    openEditors[ta.dataset.id] = ta.value;
  });

  if (state.leads.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="8">No leads match the current filters.</td></tr>`;
    selectAllCheckbox.checked = false;
    return;
  }

  tbody.innerHTML = state.leads
    .map((lead) => {
      const rowClass = needsFollowup(lead) ? "needs-followup" : "";
      const website = isHttpUrl(lead.website)
        ? `<a class="website-link" href="${escapeAttr(lead.website)}" target="_blank" rel="noopener">${escapeHtml(
            shortenUrl(lead.website)
          )}</a>`
        : lead.website
        ? `<span class="badge badge-muted" title="${escapeAttr(lead.website)}">invalid URL</span>`
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
          <td><input type="date" class="followup-input" data-id="${lead.id}" data-field="followup_date" data-previous-value="${
        lead.followup_date || ""
      }" value="${lead.followup_date || ""}" /></td>
          <td class="notes-cell">${renderNotesCell(lead)}</td>
        </tr>`;
    })
    .join("");

  attachRowHandlers();
  updateSelectAllState();

  // Re-open any editor that was open before this refresh, restoring
  // whatever the user had typed -- which may be ahead of the freshly
  // loaded server value if they hadn't saved yet.
  Object.entries(openEditors).forEach(([id, value]) => {
    const previewDiv = tbody.querySelector(`.notes-preview[data-id="${id}"]`);
    if (previewDiv) {
      openNotesEditor(previewDiv, value);
    }
  });
}

function renderNotesCell(lead) {
  const escaped = escapeHtml(lead.notes || "");
  const empty = !lead.notes;
  return `<div class="notes-preview ${empty ? "empty" : ""}" data-id="${lead.id}">${empty ? "" : escaped}</div>`;
}

function isHttpUrl(url) {
  // Website is stored from Google's own websiteUri and is never
  // user-editable, so this should always be true in practice -- but
  // rendering it as a clickable href without checking the scheme would
  // let a javascript:/data: URL execute on click if that assumption
  // ever breaks. Only http(s) gets a real link.
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
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
      const previousValue = e.target.dataset.previousValue ?? e.target.value;
      const newValue = e.target.value;
      e.target.disabled = true; // prevent a second overlapping change while this one saves
      try {
        await patchLead(id, { status: newValue });
        e.target.dataset.previousValue = newValue;
        refreshAll();
      } catch (err) {
        e.target.value = previousValue; // the save failed -- don't leave the UI showing an unsaved value
        showSaveError(`Couldn't save status change: ${err.message}`);
      } finally {
        e.target.disabled = false;
      }
    });
  });

  document.querySelectorAll('.followup-input').forEach((input) => {
    input.addEventListener("change", async (e) => {
      const id = Number(e.target.dataset.id);
      const previousValue = e.target.dataset.previousValue ?? "";
      const newValue = e.target.value;
      e.target.disabled = true;
      try {
        await patchLead(id, { followup_date: newValue });
        e.target.dataset.previousValue = newValue;
        refreshAll();
      } catch (err) {
        e.target.value = previousValue;
        showSaveError(`Couldn't save follow-up date: ${err.message}`);
      } finally {
        e.target.disabled = false;
      }
    });
  });

  document.querySelectorAll(".notes-preview").forEach((div) => {
    div.addEventListener("click", () => openNotesEditor(div));
  });
}

function openNotesEditor(previewDiv, overrideValue) {
  const id = Number(previewDiv.dataset.id);
  const lead = state.leads.find((l) => l.id === id);
  const textarea = document.createElement("textarea");
  textarea.className = "notes-textarea";
  textarea.dataset.id = String(id);
  textarea.value = overrideValue !== undefined ? overrideValue : lead ? lead.notes || "" : "";
  previewDiv.replaceWith(textarea);
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);

  const closeToPreview = (value) => {
    const newPreview = document.createElement("div");
    newPreview.className = `notes-preview ${value ? "" : "empty"}`;
    newPreview.dataset.id = String(id);
    newPreview.textContent = value;
    newPreview.addEventListener("click", () => openNotesEditor(newPreview));
    textarea.replaceWith(newPreview);
  };

  const save = async () => {
    const value = textarea.value;
    try {
      await patchLead(id, { notes: value });
      if (lead) lead.notes = value;
      closeToPreview(value);
    } catch (err) {
      // Leave the textarea OPEN with the user's text intact -- closing
      // it to a preview here would show whatever the last-known value
      // was, silently discarding an edit that never actually saved.
      showSaveError(`Couldn't save note: ${err.message}. Your text is still here -- try again.`);
    }
  };

  textarea.addEventListener("blur", save);
}

async function patchLead(id, fields) {
  let res;
  try {
    res = await fetch(`/api/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
  } catch (err) {
    throw new Error("network error");
  }
  if (!res.ok) {
    let detail = `server error (${res.status})`;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {
      // response wasn't JSON -- keep the generic detail above
    }
    throw new Error(detail);
  }
  return res.json();
}

let saveErrorTimer = null;
function showSaveError(message) {
  const toast = el("save-error-toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(saveErrorTimer);
  saveErrorTimer = setTimeout(() => {
    toast.hidden = true;
  }, 6000);
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

const PLACES_PAGE_SIZE = 20; // mirrors places.MAX_PAGE_SIZE

function updateRequestEstimate() {
  const maxResults = Math.max(1, Math.min(60, Number(searchCountInput.value) || 20));
  const requests = Math.ceil(maxResults / PLACES_PAGE_SIZE);
  requestEstimateEl.textContent = `~${requests} Places API request${requests === 1 ? "" : "s"}`;
}

searchCountInput.addEventListener("input", updateRequestEstimate);

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
      `${data.updated} refreshed, ${data.skipped} skipped. ` +
      `(${data.requests_made} Places API request${data.requests_made === 1 ? "" : "s"} used)`;
    searchStatus.hidden = false;
    refreshAll();
    refreshUsage();
  } catch (err) {
    searchError.textContent = err.message;
    searchError.hidden = false;
    refreshUsage(); // a failed search can still have made (and used up) real API calls
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = "Find Leads";
  }
});

// ---------------------------------------------------------------------------
// API usage tracking
// ---------------------------------------------------------------------------

async function refreshUsage() {
  const res = await fetch("/api/usage");
  if (!res.ok) return;
  const usage = await res.json();

  usageCounterEl.textContent = `${usage.places_api_request_count} Places API request(s) made this session`;

  if (usage.should_warn) {
    usageWarningTextEl.textContent =
      `Heads up: you've made ${usage.places_api_request_count} Places API requests ` +
      `(soft cap: ${usage.warn_threshold}). This isn't a hard limit -- just a nudge to check your usage.`;
    usageWarningEl.hidden = false;
  }
}

usageWarningDismissBtn.addEventListener("click", async () => {
  usageWarningEl.hidden = true;
  await fetch("/api/usage/acknowledge-warning", { method: "POST" });
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
updateRequestEstimate();
refreshUsage();

// Resume polling if a job was already running when the page loaded/reloaded.
(async function checkInFlightJob() {
  const res = await fetch("/api/enrich/progress");
  const progress = await res.json();
  if (progress.running) pollProgress();
})();
