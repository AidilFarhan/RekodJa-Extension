# Job Tracker Quick Add — v1.4 handoff

Chrome Manifest V3 extension, plain JavaScript/HTML. No build step or backend.

## Files

- `manifest.json`: extension permissions, Google OAuth client and popup entry point.
- `popup.html`: manual job entry, settings and Gmail scan UI.
- `popup.js`: existing job-page extraction, date parsing, Google Sheets integration and formatting. Tracker columns A:G: application date, company, role, job/email link, status, source, days since applied.
- `gmail.js`: optional read-only Gmail OAuth, three-month scan, email text parsing, advertising filters, company matching, review cards, import/update, quota backoff and local scan persistence.
- `tests/gmail.test.cjs`: mocked tests; run `node --test tests/gmail.test.cjs`.
- `GMAIL_SETUP.md`: account/project setup and usage.
- `PRIVACY_POLICY.md`: privacy details; contact placeholder still needs filling before publication.

## Current behavior

Scan full text of matching Gmail messages from the last three months with pagination and paced requests. Ignore known invitations, job alerts and advertisements. Extract company/role/sender with rules, suggest status and require user review before writing.

Match existing Sheet records by thread link, then normalized company. Multiple matches require selection. Updates preserve the original job URL and other data, changing only status and sender. Imports append a new application. Re-read Sheet data before writes to reject stale matches.

Completed scans, form edits and saved markers persist in `chrome.storage.local`. Reopening the popup restores the last scan. Failed rescans preserve old results. User-started scans run in gmail-background.js with persisted checkpoints and a recovery alarm. gmail-core.js contains shared parsing helpers. Closing the popup does not cancel a scan; Rescan Gmail explicitly replaces completed results. Individual Sheet saves still require the popup to remain open. Gmail/Sheet account data stored by the running browser is not part of this source ZIP.

## Setup and constraints

Load this directory unpacked in Chrome. The OAuth client ID in the manifest must match that Chrome extension ID. Gmail and Sheets APIs must be enabled in the owning Google Cloud project. The manifest client ID is a public OAuth identifier, not a client secret. Do not add credentials, tokens or private keys to the source.

The current tests use synthetic data, not live Google accounts. Rules are not guaranteed to recognize every email template or company alias. Cross-popup concurrent writes are not transactionally locked. Before further changes, read the existing implementation and preserve the user's review-before-save workflow.

