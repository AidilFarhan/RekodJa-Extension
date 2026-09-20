/* Gmail is optional: its scope is requested only from the Scan button. */
const gmailScopes = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/gmail.readonly"
];
const gmailScan = document.getElementById("gmailScan");
const gmailStatus = document.getElementById("gmailStatus");
const gmailResults = document.getElementById("gmailResults");
const gmailSectionTitle = document.querySelector("h3");
let gmailBusy = false;
let lastGmailRequestAt = 0;
const gmailPause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
let savedScan = null;
const scanCacheKey = "gmailScanV1";

/* ------------------------------------------------------------------
   Restore previous scan on popup open
   ------------------------------------------------------------------ */

async function restoreScan() {
  try {
    const stored = await chrome.storage.local.get(scanCacheKey);
    const cached = stored[scanCacheKey];
    if (cached && cached.version === 1 && Array.isArray(cached.messages) && Array.isArray(cached.rows) && cached.target) {
      savedScan = cached;
      showSavedScan();
      return true;
    }
    // Stale or incomplete cache — discard it.
    if (cached) {
      await chrome.storage.local.remove(scanCacheKey);
    }
  } catch (err) {
    console.warn("[gmail] restoreScan failed:", err);
  }
  return false;
}

function hasSavedScan() {
  return savedScan !== null;
}

/* ------------------------------------------------------------------
   Persist scan to storage immediately (no debounce — popup close
   must not cancel a save).
   ------------------------------------------------------------------ */

function storeScan() {
  if (!savedScan) return Promise.resolve();
  return chrome.storage.local.set({[scanCacheKey]: savedScan});
}

/* ------------------------------------------------------------------
   UI updates
   ------------------------------------------------------------------ */

function showSavedScan() {
  gmailResults.replaceChildren();
  for (const message of savedScan.messages) renderGmailCandidate(message, savedScan.email, savedScan.target, savedScan.rows);
  updateButtonAfterScan();
  const lastScanTime = new Date(savedScan.scannedAt).toLocaleString();
  gmailStatus.textContent = `${savedScan.summary} Last scan: ${lastScanTime}. Destination: ${savedScan.target.sheetTabName}.`;
}

function updateButtonAfterScan() {
  if (hasSavedScan()) {
    gmailScan.textContent = "Rescan Gmail";
    gmailScan.classList.remove("initial");
    gmailScan.classList.add("rescan");
  } else {
    gmailScan.textContent = "Connect Gmail & Scan";
    gmailScan.classList.remove("rescan");
    gmailScan.classList.add("initial");
  }
}

/* Show a lightweight "last scan" hint line above the results area,
   even before the user expands the Gmail section. */
function renderLastScanHint() {
  const existing = document.getElementById("lastScanHint");
  if (existing) existing.remove();
  if (!hasSavedScan()) return;

  const hint = document.createElement("div");
  hint.id = "lastScanHint";
  hint.style.cssText = "margin-top:8px;font-size:11px;color:#6b7280;border-top:1px solid #e5e7eb;padding-top:6px;";
  const time = new Date(savedScan.scannedAt).toLocaleString();
  hint.textContent = `↻ Saved scan from ${time} — ${savedScan.messages.length} threads. Tap "Scan again" to refresh.`;
  gmailResults.parentNode.insertBefore(hint, gmailResults);
}

/* ------------------------------------------------------------------
   Init: restore + hint
   ------------------------------------------------------------------ */

gmailScan.classList.add("initial");
// Restoration is awaited below.

function gmailAuth() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({interactive: true, scopes: gmailScopes}, (token, granted) => {
      const error = chrome.runtime.lastError;
      if (error || !token) return reject(new Error(error?.message || "Google sign-in cancelled."));
      if (granted && gmailScopes.some(scope => !granted.includes(scope))) {
        return reject(new Error("Allow both Gmail read access and Sheets access to import."));
      }
      resolve(token);
    });
  });
}

async function gmailRequest(token, url, options = {}, attempt = 0) {
  const isGmail = new URL(url).hostname === "gmail.googleapis.com";
  // Read requests cost quota too. Pace the sequential scan to at most 2/s.
  if (isGmail) {
    const delay = Math.max(0, 500 - (Date.now() - lastGmailRequestAt));
    if (delay) await gmailPause(delay);
    lastGmailRequestAt = Date.now();
  }
  const response = await fetch(url, {...options, headers: {
    Authorization: "Bearer " + token, "Content-Type": "application/json"
  }});
  if (!response.ok) {
    let error = {};
    try { error = (await response.json()).error || {}; } catch { /* Some errors have no JSON body. */ }
    const service = new URL(url).hostname === "gmail.googleapis.com" ? "Gmail" : "Google Sheets";
    const detail = typeof error.message === "string" ? error.message : "";
    const reason = error.details?.find(item => item.reason)?.reason || error.errors?.[0]?.reason || "";
    const rateLimited = response.status === 429 || ((response.status === 403) && /RATE_LIMIT_EXCEEDED|rateLimitExceeded|userRateLimitExceeded|units per minute|requests per minute/i.test(reason + " " + detail));
    if (rateLimited) {
      const retryHeader = response.headers?.get("Retry-After");
      const retryAfter = retryHeader ? (/^\d+$/.test(retryHeader) ? Number(retryHeader) * 1000 : Math.max(0, Date.parse(retryHeader) - Date.now())) : 0;
      // Only retry Gmail reads; never repeat a potentially successful Sheet append.
      if (isGmail && (!options.method || options.method === "GET") && attempt < 5 && !(retryAfter > 60000)) {
        const delay = Math.max(retryAfter || 0, Math.min(60000, 5000 * 2 ** attempt + Math.floor(Math.random() * 1000)));
        const previousStatus = gmailStatus.textContent;
        gmailStatus.textContent = `Gmail quota temporarily reached. Waiting ${Math.ceil(delay / 1000)} seconds, then continuing automatically (${attempt + 1}/5). Keep this popup open.`;
        await gmailPause(delay);
        gmailStatus.textContent = previousStatus;
        return gmailRequest(token, url, options, attempt + 1);
      }
      throw new Error(`${service} scan/request paused: Google's rate limit is still active. Wait ${retryAfter > 60000 ? Math.ceil(retryAfter / 60000) + " minutes" : "1–2 minutes"} before trying again. No permission or client ID change is needed.`);
    }
    if (response.status === 401) await chrome.identity.removeCachedAuthToken({token});
    let hint = "Scan again before retrying a save.";
    if (/SERVICE_DISABLED|accessNotConfigured/i.test(reason)) hint = `Enable ${service === "Gmail" ? "Gmail" : "Google Sheets"} API in the Google Cloud project that owns your OAuth client, then retry.`;
    else if (/ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficientPermissions/i.test(reason) || /insufficient.*scope/i.test(detail)) {
      await chrome.identity.removeCachedAuthToken({token});
      hint = "Click Connect Gmail & Scan again and allow both Gmail read access and Sheets access.";
    } else if (response.status === 403 && service === "Google Sheets") hint = "Check the Sheet ID and that the connected Google account has Editor access to this spreadsheet.";
    else if (response.status === 403) hint = "Check Gmail API access and any Google Workspace administrator restrictions.";
    else if (response.status === 401) hint = "Click Connect Gmail & Scan again to sign in.";
    throw new Error(`${service} error (${response.status}${reason ? "; " + reason : ""}): ${detail || "Google denied the request."} ${hint}`);
  }
  return response.json();
}

function gmailField(card, labelText, value, choices) {
  const label = document.createElement("label");
  label.textContent = labelText;
  const input = document.createElement(choices ? "select" : "input");
  if (choices) for (const choice of choices) {
    const option = document.createElement("option");
    option.value = choice; option.textContent = choice || "Choose status";
    input.append(option);
  }
  else input.type = "text";
  input.value = value;
  input.style.width = "100%";
  label.append(input); card.append(label);
  return input;
}


let backgroundScanning = false;
const scanReady = restoreScan().then(renderLastScanHint);
function showScanProgress(status) {
  backgroundScanning = status?.state === 'running';
  gmailBusy = backgroundScanning;
  gmailScan.disabled = backgroundScanning;
  if (backgroundScanning) {
    gmailScan.textContent = 'Scanning Gmail…';
    gmailStatus.textContent = (status.message || 'Scanning Gmail…') + ' You can close this popup.';
  } else {
    updateButtonAfterScan();
    if (status?.state === 'error') gmailStatus.textContent = status.message + ' Previous results are kept.';
  }
}
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  if (changes[scanCacheKey]?.newValue && changes[scanCacheKey].newValue.scannedAt !== savedScan?.scannedAt) {
    savedScan = changes[scanCacheKey].newValue; showSavedScan(); renderLastScanHint();
  }
  if (changes.gmailScanStatus) showScanProgress(changes.gmailScanStatus.newValue);
});
scanReady.then(async () => {
  const data = await chrome.storage.local.get('gmailScanStatus');
  showScanProgress(data.gmailScanStatus);
  chrome.runtime.sendMessage({type: 'gmail-scan-resume'}).catch(() => {});
});
gmailScan.addEventListener('click', async () => {
  await scanReady;
  if (gmailBusy || backgroundScanning) return;
  gmailBusy = true; gmailScan.disabled = true;
  try {
    await gmailAuth(); // Consent belongs to a user gesture, not the worker.
    const reply = await chrome.runtime.sendMessage({type: 'gmail-scan-start'});
    if (!reply?.ok) throw new Error(reply?.error || 'Could not start Gmail scan. Reload the extension.');
    showScanProgress({state: 'running', message: 'Scanning Gmail in the background…'});
  } catch (error) {
    gmailBusy = false; gmailScan.disabled = false; updateButtonAfterScan();
    gmailStatus.textContent = error.message;
  }
});

function renderGmailCandidate(message, email, target, rows = []) {
  const headers = message.payload?.headers || [];
  const header = name => headers.find(h => h.name.toLowerCase() === name)?.value || "";
  const subject = header("subject");
  const body = currentEmailText(message);
  const details = suggestKnownCompany(extractEmailDetails(subject, body, header("from")), subject + "\n" + body + "\n" + header("from"), rows);
  const status = classifyEmail(subject, body);
  const link = `https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}#all/${message.threadId}`;
  const card = document.createElement("section");
  card.style.cssText = "border-top:1px solid #ddd;margin-top:14px;padding-top:10px;overflow-wrap:anywhere";
  const title = document.createElement("strong"); title.textContent = subject || "(No subject)";
  const from = document.createElement("p"); from.textContent = header("from");
  const snippet = document.createElement("p"); snippet.textContent = body.slice(0, 1500);
  snippet.style.fontSize = "12px";
  const open = document.createElement("a"); open.href = link; open.target = "_blank"; open.rel = "noopener noreferrer"; open.textContent = "Open email";
  card.append(title, from, snippet, open);
  const company = gmailField(card, "Company suggestion (required)", details.company);
  const role = gmailField(card, "Role suggestion (required)", details.role);
  const date = gmailField(card, "Date applied (YYYY-MM-DD; optional)", status === "Applied" ? formatDateISO(new Date(Number(message.internalDate))) : "");
  const state = gmailField(card, "Status suggestion", status, ["", "Applied", "Interview", "Offer", "Rejected", "Ghosted", "Withdrawn", "Replied"]);
  const sender = gmailField(card, "Email sender", details.sender);
  const destination = gmailField(card, "Existing application to update", "", []);
  const reviewed = gmailField(card, "I checked the company, role, destination and status", "");
  reviewed.type = "checkbox";
  reviewed.style.width = "auto";
  const help = document.createElement("p");
  help.className = "hint";
  const save = document.createElement("button");
  const result = document.createElement("p"); result.style.fontSize = "12px";
  card.append(help, save, result); gmailResults.append(card);
  let candidates = [];
  function refreshMatch() {
    candidates = matchApplications(rows, company.value, link);
    destination.replaceChildren();
    destination.parentElement && (destination.parentElement.style.display = candidates.length ? "block" : "none");
    if (candidates.length > 1) {
      const option = document.createElement("option"); option.value = ""; option.textContent = "Choose the correct application"; destination.append(option);
    }
    for (const entry of candidates) {
      const option = document.createElement("option"); option.value = String(entry.index);
      option.textContent = `Row ${entry.index + 1}: ${entry.row[1]} — ${entry.row[2] || "No role"} — ${entry.row[4] || "No status"} (${entry.row[0] || "No date"})`;
      destination.append(option);
    }
    destination.value = candidates.length === 1 ? String(candidates[0].index) : "";
    if (candidates.length === 1 && !role.value) role.value = candidates[0].row[2] || "";
    save.textContent = candidates.length ? "Update application" : "Import this application";
    help.textContent = candidates.length
      ? `Found in ${target.sheetTabName}. Only status and sender will change. Check the selected role and email date (${formatDateISO(new Date(Number(message.internalDate)))}); older emails may have outdated statuses.`
      : `New company in ${target.sheetTabName}. Check or correct the extracted company, role and sender before importing.`;
    reviewed.checked = false;
  }
  company.addEventListener("input", refreshMatch);
  for (const input of [role, date, state, sender, destination]) input.addEventListener("change", () => { reviewed.checked = false; });
  refreshMatch();
  const draft = savedScan?.drafts?.[message.id];
  if (draft) {
    company.value = draft.company; role.value = draft.role; date.value = draft.date;
    state.value = draft.status; sender.value = draft.sender;
    refreshMatch();
    if (candidates.some(entry => String(entry.index) === draft.destination)) destination.value = draft.destination;
    reviewed.checked = Boolean(draft.reviewed);
    if (draft.saved) { save.textContent = "Saved"; save.disabled = true; result.textContent = draft.result || "Saved to tracker."; }
  }
  function persistDraft(saved = false) {
    if (!savedScan || !savedScan.messages.some(item => item.id === message.id)) return;
    savedScan.drafts[message.id] = {company: company.value, role: role.value, date: date.value,
      status: state.value, sender: sender.value, destination: destination.value, reviewed: reviewed.checked,
      saved: saved || Boolean(savedScan.drafts[message.id]?.saved), result: result.textContent};
    // Call storage immediately on edits, without a debounce that popup closing could cancel.
    return storeScan().catch(() => { gmailStatus.textContent = "Could not keep the latest edits. Leave this popup open and try again."; });
  }
  for (const input of [company, role, date, state, sender, destination, reviewed]) {
    input.addEventListener("input", () => { if (input !== reviewed) reviewed.checked = false; persistDraft(); });
    input.addEventListener("change", () => persistDraft());
  }
  save.addEventListener("click", async () => {
    if (gmailBusy) return;
    if (!reviewed.checked) { result.textContent = "Review the details and tick the confirmation box first."; return; }
    const selected = candidates.find(entry => String(entry.index) === destination.value);
    if (candidates.length && !selected) { result.textContent = "Choose the correct existing application first."; return; }
    if (!company.value.trim() || !role.value.trim() || !state.value) {
      result.textContent = "Fill company, role and status before importing."; return;
    }
    const dateText = date.value.trim();
    if (dateText && (!/^\d{4}-\d{2}-\d{2}$/.test(dateText) || !parseRelativeDate(dateText))) {
      result.textContent = "Use a valid date in YYYY-MM-DD format."; return;
    }
    gmailBusy = true; save.disabled = true; gmailScan.disabled = true;
    result.textContent = "Saving…";
    try {
      const token = await gmailAuth();
      const currentTarget = await chrome.storage.sync.get(["sheetId", "sheetTabName"]);
      if (currentTarget.sheetId !== target.sheetId || currentTarget.sheetTabName !== target.sheetTabName) {
        throw new Error("The destination Sheet changed since this scan. Scan again before saving to the new destination.");
      }
      if (typeof ensureHeaders === "function") {
        try { await ensureHeaders(token, target.sheetId, target.sheetTabName); } catch { }
      }
      if (typeof applyConditionalColors === "function") {
        try { await applyConditionalColors(token, target.sheetId, target.sheetTabName); } catch { }
      }
      const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(target.sheetId)}/values/`;
      const range = quoteSheetTabName(target.sheetTabName);
      const existing = await gmailRequest(token, base + encodeURIComponent(range + "!A:ZZ"));
      const matches = matchApplications(existing.values || [], company.value, link);
      let matched;
      if (selected) {
        matched = matches.find(entry => entry.index === selected.index && JSON.stringify(entry.row.slice(0, 6)) === JSON.stringify(selected.row.slice(0, 6)));
        if (!matched) throw new Error("The selected Sheet record changed. Scan again and review the latest match before updating.");
      } else if (matches.length) {
        throw new Error("This company or email is now in the Sheet. Scan again to review it as an update.");
      }
      const senderIndex = senderColumn(existing.values || []);
      const senderLetter = columnLetter(senderIndex);
      if (String(existing.values?.[0]?.[senderIndex] || "").trim().toLowerCase() !== "email sender") {
        await gmailRequest(token, base + encodeURIComponent(range + "!" + senderLetter + "1") + "?valueInputOption=RAW", {
          method: "PUT", body: JSON.stringify({values: [["Email Sender"]]})
        });
      }
      if (matched) {
        const row = matched.index + 1;
        await gmailRequest(token, base.slice(0, -1) + ":batchUpdate", {
          method: "POST", body: JSON.stringify({valueInputOption: "RAW", data: [
            {range: range + "!E" + row, values: [[state.value]]},
            {range: range + "!" + senderLetter + row, values: [[sender.value.trim()]]}
          ]})
        });
        result.textContent = "Existing application status and sender updated. Other fields kept.";
      } else {
        // RAW prevents email-derived text from becoming a spreadsheet formula.
        const dateSerial = dateText ? Math.round((Date.parse(dateText + "T00:00:00Z") - Date.UTC(1899, 11, 30)) / 86400000) : "";
        const newRow = [dateSerial, company.value.trim(), role.value.trim(), link, state.value, "Other"];
        while (newRow.length <= senderIndex) newRow.push("");
        newRow[senderIndex] = sender.value.trim();
        const appended = await gmailRequest(token, base + encodeURIComponent(range + "!A:" + senderLetter) + ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS", {
          method: "POST", body: JSON.stringify({values: [newRow]})
        });
        result.textContent = "Saved. Column D links to the Gmail thread; source is Other.";
        const rowNumber = extractRowNumber(appended.updates?.updatedRange || "");
        if (rowNumber) {
          try {
            if (dateText) await writeDaysSinceFormula(token, target.sheetId, rowNumber, target.sheetTabName);
            await fixCellFormats(token, target.sheetId, rowNumber, target.sheetTabName);
          } catch {
            result.textContent = "Saved, but date formatting or days-since formula needs checking in the Sheet. Do not re-import.";
          }
        }
      }
      save.textContent = "Saved";
      await persistDraft(true);
    } catch (error) {
      result.textContent = error.message;
      save.disabled = false;
    } finally {
      gmailBusy = false; gmailScan.disabled = false;
    }
  });
}
