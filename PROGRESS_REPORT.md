# Progress Report — RekodJa

Date: 2026-09-20

> Full rebrand of "Job Tracker Quick Add / Job Tracker Pro" to **RekodJa**, across the extension, the web app, and the landing site.

---

## 1. The three products

| Product | Location | Stack | Deploy |
|---|---|---|---|
| **RekodJa: Job Tracker** (Chrome extension) | `c:\Users\aidil\OneDrive\Desktop\JOB TRACKER` | Chrome MV3, plain JS/HTML, Google Sheets API | `AidilFarhan/RekodJa-Extension` on GitHub (not yet uploaded to Chrome Web Store) |
| **RekodJa Web App** | `c:\Users\aidil\OneDrive\Desktop\job-tracker-extension\pro` | Next.js 16 + Supabase (SSR auth), Google Identity Services | `AidilFarhan/Job-Tracker-WebApp` → Vercel `jobtrackerwebapp.vercel.app` |
| **Landing site** | GitHub repo `AidilFarhan/RekodJa-site` | Static HTML/CSS | GitHub Pages `jobtracker.aidilfarhanjassim.online` |

The extension and web app share the **same Google Sheet** per user. The extension is the fast capture/entry tool; the web app is the full dashboard. The sheet is the source of truth — the web app reads it (import) and writes back to it (stage changes).

Shared sheet header row:

`Date Applied | Company | Role | Job Link | Status | Source | Days Since Applied | Notes | Email Sender` (columns A–I)

---

## 2. Chrome extension — progress

### 2.1 Rebrand & popup simplification
- `manifest.json` v1.4: name **"RekodJa: Job Tracker"**, `default_title` "RekodJa", Sheets-only OAuth scope.
- Popup restyled to the navy `#14213d` theme matching the web app; heading "Add to RekodJa".
- Button renamed to **"Save"** (was "Save to Tracker"); success message still "Saved to tracker!".
- **Gmail tracking removed from the extension** and archived to `legacy-gmail/` (no Gmail permissions, no background worker, no alarms). Gmail scan now lives only in the web app.

### 2.2 "Access Spreadsheet" button
- Opens `https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit` in a new tab, using the Sheet ID from `chrome.storage.sync`. If no Sheet ID is set, shows an error and opens the Settings panel.

### 2.3 Automatic header row
- `HEADER_ROW` constant + `ensureHeaders()` in `popup.js`: on connect and before every save, row 1 (`A1:I1`) is checked — empty row 1 gets all 9 headers, partial headers are filled cell-by-cell, custom layouts are never overwritten.

### 2.4 Conditional colour formatting (Status E / Source F)
- `STATUS_COLORS` / `SOURCE_COLORS` maps + `applyConditionalColors()` in `popup.js`, applied as Sheets conditional formatting rules (whole columns), old rules replaced, dark backgrounds get white text.
- Exact colours:

  | Status | Hex | | Source | Hex |
  |---|---|---|---|---|
  | Applied | `#ffe5a0` | | LinkedIn | `#0a53a8` |
  | Interview | `#bfe1f6` | | Company Website | `#5a3286` |
  | Offer | `#d4edbc` | | Referral | `#3d3d3d` |
  | Rejected | `#b10202` | | JobStreet | `#ff14d6` |
  | Ghosted | `#473822` | | Indeed | `#bfe1f6` |
  | Withdrawn | `#ffcfc9` | | | |
  | Replied | `#e8eaed` | | | |

### 2.5 Days Since Applied formula hardened
- `writeDaysSinceFormula()` tolerates text dates: number → `TODAY()-A{r}`; text `dd-mm-yyyy`/`yyyy-mm-dd` → parsed with `DATE(...)`; unreadable → blank instead of `#VALUE!`.

### 2.6 Extension tests
- `tests/gmail-background.test.cjs`: 5/5 pass (legacy Gmail, archived).
- `tests/gmail.test.cjs`: pre-existing fixture issue (`document.querySelector` missing in the fake DOM) — unrelated to current changes.

---

## 3. Web app — progress

Repo: `https://github.com/AidilFarhan/Job-Tracker-WebApp.git` (branch `main`, auto-deploy to Vercel).
Run: `npm.cmd run dev` (port 3002). Use `npm.cmd` on this machine (PowerShell blocks `npm.ps1`).
Checks: `npm.cmd run typecheck` clean · `npm.cmd test` **64/64 pass** · `npm.cmd run build` passes.

### 3.1 Stage change syncs back to the Google Sheet
Flow: user changes a stage in the web app → Supabase update **and** the sheet's Status cell is rewritten.

- `src/lib/sheets/sync.ts` (new):
  - `syncStageToSheet()` reads `'<tab>'!A:Z`, finds the matching row using the **same import identity key** (`importKey`), with a job-URL fallback, and `PUT`s the new stage into the Status cell (`USER_ENTERED`).
  - `writeStageToSheet()` never throws — the in-app save always succeeds and sync failures are reported to the UI.
- `src/lib/sheets/import.ts` refactored to export shared helpers: `normalize`, `dateValue`, `sheetColumns()` (header alias resolution incl. "Position"/"Current Status"/"Job Link"), `rowIdentityKey()` (sha256 of spreadsheetId + sheetName + date + company + role + normalized URL). `parseSheetRows()` behaviour is unchanged (verified by existing tests).
- `src/app/api/applications/[id]/route.ts` (PATCH): after the DB update it loads the app's `sheet_connection_id`, fetches the connection, and syncs. Returns `{ ok, stage, sheet: { synced, message? } | null }`.
- `src/app/api/applications/[id]/follow-up/route.ts`: same sync; a "Replied" outcome writes `Replied` to the sheet Status column.
- `src/lib/google-token.ts` (new, client): `requestGoogleToken(clientId)` — GIS token client with the existing `drive.file` scope, `prompt: ''` (reuses the grant from tracker setup; no repeated consent).
- `src/app/dashboard/applications/[id]/stage-changer.tsx`: obtains the Google token before PATCH, sends it as `Authorization: Bearer`, and shows a note under the select: "Synced to your Google Sheet ✓" (green) or "Saved here, but the Google Sheet was not updated: …" (red).
- `follow-up-client.tsx`, both detail/follow-up `page.tsx` files updated to pass the OAuth `clientId` (from `googlePickerConfiguration()`).
- `workspace.css`: `.stage-changer` / `.stage-sync-note` styles.
- `tsconfig.json`: added `allowImportingTsExtensions` so `node --test` can import local `.ts` with explicit extensions (`sync.ts` imports `./import.ts`).
- `tests/sheet-sync.test.mjs` (new): 4 tests — correct cell write (`E2`), import-key match when stored URL differs, no-match writes nothing, missing Status column errors.

### 3.2 Global cat loading popup
- `src/components/cat-loader.tsx` (new), mounted in `src/app/layout.tsx` inside `<Suspense fallback={null}>`.
- Shows the running-cat overlay (`/cat-run.gif`, same styling as the import popup) immediately on any internal link click or back/forward navigation, hides when `usePathname`/`useSearchParams` update, with an 8-second safety timeout.
- The existing `app/loading.tsx` and `dashboard/loading.tsx` were already cat-based; the new loader covers normal client-side navigations where those Suspense fallbacks never appeared.

### 3.3 Gmail scan (the big new feature)
- `src/lib/gmail/scan-core.ts`: `classifyEmail` → `''|Applied|Interview|Offer|Rejected|Ghosted|Replied`; Ghosted = "no longer taking applications"; skips JobStreet/Indeed "successfully submitted" confirmations.
- `src/lib/gmail/scan-engine.ts`: `GMAIL_SEARCH_QUERY = newer_than:45d -in:spam -in:trash -in:sent -in:drafts …`; `scanGmail()` returns `{email, scanned, skipped, candidates}`.
- API routes: `POST /api/gmail/scan` (verifies `gmail.readonly` tokeninfo, scans, upserts into `gmail_scan_candidates` preserving review state), `POST /api/gmail/scan/confirm` (records confirmed application + optional sheet sync; also supports `createOnly` for the two-step unmatched flow), `GET/PATCH /api/gmail/scan/candidates` (restore queue / dismiss).
- Review UI: `dashboard/gmail-scan` — type-to-search application combobox, dismiss button, cat loader, local-time email dates.
- Review UI rules verified (commit `85b60ab`):
  - No confidence percentages anywhere. ✅
  - Detected vs user-confirmed events visually distinct — confirmed cards get a green tint + "✓ Confirmed as …". ✅
  - Unmatched emails now require **two separate steps**: match to an application first (pick existing or create new via `createOnly`), then "Confirm stage" separately. Matched emails keep single-click confirm per the approved rule.

### 3.4 Rebrand
- RekodJa wordmark across `layout.tsx`, `nav.tsx`, `sign-in`, `privacy`, `tracker-setup`, `settings`, `globals.css` (commit `ac1ad7c`).
- Privacy policy documents the Gmail scan section (commit `4c51d4b`).

### 3.5 Deploy status
- Production env vars on the host must include: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_PICKER_API_KEY`, `GOOGLE_CLOUD_PROJECT_NUMBER`, `APP_URL` (production origin), `SUPABASE_URL`, `SUPABASE_ANON_KEY`. All are set in local `.env.local`; host config not verified from here.
- Google Cloud: the OAuth client's **Authorized JavaScript origins** must include the production origin (Picker already works live, so this is likely done).
- Supabase: production `/auth/callback` redirect must be allowed.

### 3.6 Database migrations (hosted Supabase, run in SQL Editor)
- `202609190001_single_sheet_connection.sql` — applied ✅ (RLS tests pass).
- `202609200001_gmail_scan_candidates.sql` — applied ✅ (RLS tests pass).
- `202609200002_application_stage_replied.sql` — ⚠️ **verify it was run** ("Replied" stage saves fail otherwise).

---

## 4. Data identity between the apps (important to understand)

- The web app has **no stored sheet row number**. Matching is by `import_key`:
  `sha256([spreadsheetId, sheetName, dateApplied ?? '', company.toLowerCase(), role.toLowerCase(), normalizeUrl(jobUrl)].join('\u001f'))`
- At sync time the key is recomputed from the current sheet row and compared with the stored `applications.import_key`, with a normalized-URL fallback. If a user edits the row's date/company/role/URL in the sheet after import, the key stops matching (URL fallback may still save it).
- `applications.sheet_connection_id` links an app row to `sheet_connections(spreadsheet_id, sheet_name)`. No OAuth refresh tokens are stored anywhere — every write requires a fresh client-side GIS token (`drive.file` scope), which Google re-issues silently after the first grant.

---

## 5. Landing site — progress

- Full RekodJa rebrand (commit `3f09b2f`): wordmark `Rekod` bold + `Ja` italic blue (`Times New Roman`), across header/footer, privacy and terms pages.
- **Footer wordmark gap fixed** (commit `5a37ad0`): the rule `footer span:last-child { display:flex; gap:20px }` (meant for the Privacy/Terms links) also matched the nested wordmark span, splitting "Rekod" and "Ja" into two flex items 20 px apart. Fixed by scoping to `footer > span:last-child` + `display:inline` on `.wordmark`. Verified live: gap 0 px.
- **Privacy / Terms aligned with current products** (commit `4718427`):
  - Removed the "Optional Gmail scan" section from the extension privacy policy (feature moved to the web app).
  - Added "The RekodJa Web App" section linking to the web app privacy policy.
  - Tutorial step "Click Save to Tracker" → "Click Save" (matches the popup button).
  - Terms of Service checked — already aligned, no changes needed.
  - Dates bumped to 20 September 2026.

---

## 6. Known issues / pending items

1. **Chrome Web Store listing** still says "Job Tracker Quick Add" v1.7 — user must update the listing and upload the new extension build (local manifest is v1.4).
2. **Google Cloud OAuth consent screen** still shows the old app name — user must update in Google Cloud Console.
3. **Verify hosted migration** `202609200002_application_stage_replied.sql` ran on Supabase — probed the hosted API but anon has no table access and no dashboard session was available, so this remains unverified. Run the enum check in the Supabase SQL Editor (SQL at the end of this report).
4. **OAuth client_id differs from published v1.7** — local manifest uses `…-lsqcm88g09vqev7afk2mrb8q5iermc0a`, the published v1.7 used `…-5hfbkkqr7ch3lpg5bav2cuhvu29lrvj4` (same GCP project). Verify the local client is a valid Chrome-extension OAuth client before uploading.
5. `tests/gmail.test.cjs` fixture lacks `document.querySelector` (pre-existing, legacy Gmail suite).
6. Row matching for sheet write-back breaks if the user edits key identity columns in the sheet between import and sync.
7. Landing site copies in `JOB TRACKER\site` and `job-tracker-extension\site` are drifting from the deploy source (`AidilFarhan/RekodJa-site`) — the GitHub repo is the source of truth.

## 7. Published v1.7 vs local comparison (done 20 Sep)

- Downloaded and extracted the live Chrome Web Store build (v1.7, `plkhmignapibfhoppbkebpndckjbjpmg`) and diffed `popup.js`/`popup.html` against the rebranded local code.
- **Result: local is a strict superset.** Every v1.7 logic line is present or intentionally improved (days-since formula now tolerates text dates; rows span A:I with headers and colours). No missing feature or fix.
- The published v1.7's Gmail section was already broken in the store (`popup.html` references `gmail.js`, which is not in the package, and `popup.js` has no Gmail handlers) — removing Gmail from the extension loses nothing.
- v1.7 package also shipped personal files (portfolio, resume, promo videos) — keep the next upload zip clean (manifest, popup, icons, privacy doc only).

## 8. Suggested next steps

- Upload the extension to the Chrome Web Store (and update the listing + OAuth consent screen names).
- Verify the `Replied` migration on hosted Supabase (run the check below in the SQL Editor):
  ```sql
  select e.enumlabel
  from pg_enum e
  join pg_type t on t.oid = e.enumtypid
  where t.typname = 'application_stage'
  order by e.enumsortorder;
  ```
  If `Replied` is missing, run `supabase/migrations/202609200002_application_stage_replied.sql` (it is idempotent).
- Verify the extension OAuth client_id in Google Cloud before publishing.
- Optional: persist `sheet_row` at import time for faster sync lookup, with the identity key as fallback.
- Optional: link the web app privacy page from the app UI (currently only reachable by URL).
