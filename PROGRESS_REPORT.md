# Progress Report — Job Tracker Extension & Web Tracker

Date: 2026-09-20
Prepared for: handoff to Claude (or any developer continuing this work)

---

## 1. The two projects

| Project | Location | Stack | Deploy |
|---|---|---|---|
| **Chrome extension** ("Job Tracker Quick Add") | `c:\Users\aidil\OneDrive\Desktop\JOB TRACKER` | Chrome MV3, plain JS/HTML, Google Sheets API | Loaded unpacked in Chrome (reload manually after changes) |
| **Web tracker** ("Job Tracker Pro") | `c:\Users\aidil\OneDrive\Desktop\job-tracker-extension\pro` | Next.js 16 + Supabase (SSR auth), Google Identity Services | GitHub → auto-deploy (Vercel-style), repo `AidilFarhan/Job-Tracker-WebApp` |

The two apps share the **same Google Sheet** per user. The extension is the fast capture/entry tool; the web tracker is the full dashboard. The sheet is the source of truth both read from (web import) and now **written back to** (web stage changes).

Shared sheet layout (both apps assume this header row):

`Date Applied | Company | Role | Job Link | Status | Source | Days Since Applied | Notes | Email Sender` (columns A–I)

---

## 2. Chrome extension — progress

Files changed: `popup.html`, `popup.js`, `gmail.js` (root folder; ignore `extracted/` and `backup-before-background-*`, they are stale copies).

### 2.1 "Access Spreadsheet" button
- Added below "Save to Tracker" in `popup.html` (green button).
- Opens `https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit` in a new tab, using the Sheet ID from `chrome.storage.sync`.
- If no Sheet ID is set, shows an error and opens the Settings panel.

### 2.2 Automatic header row
- `HEADER_ROW` constant + `ensureHeaders()` in `popup.js`.
- On sheet connect and before every save, row 1 is checked (`A1:I1`):
  - Empty row 1 → writes all 9 headers.
  - Partial headers → fills only blank cells with the expected header for that column.
  - If row 1 has the user's own custom header layout → left untouched (never overwrites).
- Appended rows now span `A:I` (Notes and Email Sender left empty).

### 2.3 Conditional colour formatting (Status E / Source F)
- `STATUS_COLORS` and `SOURCE_COLORS` maps + `applyConditionalColors()` in `popup.js`.
- Applied as **Sheets conditional formatting rules** (whole columns E and F), so manual edits in the sheet also get coloured automatically.
- Old rules on those columns are deleted before re-adding (no stacking).
- Dark backgrounds automatically get white text for readability.
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

- `Replied` was added to the sheet Status dropdown and to the Gmail flow's status options.

### 2.4 Days Since Applied formula hardened
- `writeDaysSinceFormula()` now writes a formula that tolerates **text dates**:
  - Real date (number) → `TODAY()-A{r}`
  - Text `dd-mm-yyyy` or `yyyy-mm-dd` → parsed manually with `DATE(...)`
  - Anything unreadable → blank instead of `#VALUE!`
- This fixes the `#VALUE!` case where `18-09-2026` was stored as text (manual entry + locale mismatch).

### 2.5 Extension tests
- `tests/gmail-background.test.cjs`: 5/5 pass.
- `tests/gmail.test.cjs`: has **pre-existing failures** — the test fixture's fake `document` has no `querySelector`, but `gmail.js` line 9 calls `document.querySelector("h3")` at load time. Unrelated to recent changes; needs the fixture updated if you want that suite green.

---

## 3. Web tracker — progress

Repo: `https://github.com/AidilFarhan/Job-Tracker-WebApp.git` (branch `main`).
Run: `npm.cmd run dev` (port 3002). On this Windows machine `npm` scripts must be invoked with **`npm.cmd`** (PowerShell policy blocks `npm.ps1`).
Checks: `npm.cmd run typecheck` (clean) · `npm.cmd test` (**49/49 pass**) · `npm.cmd run build` (production build passes).

### 3.1 Stage change now syncs back to the Google Sheet (the main new feature)
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

### 3.3 Deploy status
- Pushed to `main`:
  - `26554b1` "Sync stage changes back to the connected Google Sheet"
  - `13bf9e8` "Show the cat loading popup on every navigation"
- Production env vars on the host must include: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_PICKER_API_KEY`, `GOOGLE_CLOUD_PROJECT_NUMBER`, `APP_URL` (production origin), `SUPABASE_URL`, `SUPABASE_ANON_KEY`. All are set in local `.env.local`; host config not verified from here.
- Google Cloud: the OAuth client's **Authorized JavaScript origins** must include the production origin (Picker already works live, so this is likely done).
- Supabase: production `/auth/callback` redirect must be allowed.

---

## 4. Data identity between the apps (important to understand)

- The web app has **no stored sheet row number**. Matching is by `import_key`:
  `sha256([spreadsheetId, sheetName, dateApplied ?? '', company.toLowerCase(), role.toLowerCase(), normalizeUrl(jobUrl)].join('\u001f'))`
- At sync time the key is recomputed from the current sheet row and compared with the stored `applications.import_key`, with a normalized-URL fallback. If a user edits the row's date/company/role/URL in the sheet after import, the key stops matching (URL fallback may still save it).
- `applications.sheet_connection_id` links an app row to `sheet_connections(spreadsheet_id, sheet_name)`. No OAuth refresh tokens are stored anywhere — every write requires a fresh client-side GIS token (`drive.file` scope), which Google re-issues silently after the first grant.

---

## 5. Known issues / pending items

1. **Uncommitted WIP in `pro`** (intentionally left for the user):
   - `src/app/api/sheet-connections/route.ts` + `[id]/route.ts` — "one tracker per account" enforcement (replaces the old upsert).
   - `supabase/migrations/202609190001_single_sheet_connection.sql` — matching migration, not yet committed.
2. **Extension is not under git** — recent extension changes exist only in the working folder. Consider versioning or a backup before bigger changes.
3. `tests/gmail.test.cjs` fixture lacks `document.querySelector` (pre-existing failure).
4. Row matching for sheet write-back breaks if the user edits key identity columns in the sheet between import and sync (reported to UI as "no longer matches a row").
5. The web sync uses `drive.file` scope tokens. Works for sheets connected via the Google Picker; verify the live site actually grants it if stage sync reports "Google access was not granted".

## 6. Suggested next steps for Claude

- Finish and ship the "single tracker connection" WIP (routes + migration + tests).
- Add an extension-side equivalent of the web write-back if desired (extension already reads/writes via Sheets API directly).
- Fix the `gmail.test.cjs` fixture (`querySelector` mock) to make the extension suite fully green.
- Consider persisting the sheet row number (`sheet_row`) at import time as a faster sync lookup, with the identity key as fallback.
