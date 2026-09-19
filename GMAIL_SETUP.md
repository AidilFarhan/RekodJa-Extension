# Try v1.4 Gmail tracking

1. In the Google Cloud project that owns the OAuth client in `manifest.json`, enable **Gmail API**. Keep Google Sheets API enabled.
2. In Google Auth Platform's Data Access settings, add `https://www.googleapis.com/auth/gmail.readonly`. Keep the existing spreadsheets scope. If the OAuth app is in Testing, add your Google account as a test user under Audience.
3. Keep the extension ID that matches the existing Chrome Extension OAuth client. Reload this extension from `chrome://extensions`.
4. Open extension Settings and connect the destination Sheet/tab. Existing columns remain A: Date Applied, B: Company, C: Role, D: Link, E: Status, F: Source, G: Days Since Applied.
5. Click **Connect Gmail & Scan** and grant Google access. The account is selected through Chrome Identity; the scan shows its email address. Use the appropriate Chrome profile for a different account.
6. Scan matching messages from the last 3 months. All search-result pages are read, so large inboxes take longer. Review the latest relevant message per thread, suggested company/role, sender and status. Existing companies show **Update application**; new companies show **Import this application**. If multiple applications match, select the correct record. Tick the review checkbox before saving. You may close the popup during scanning. Reopen it to view progress or completed results. Keep it open only while saving an individual record to Sheets.

## Behavior and limits

- Gmail permission is requested only when scanning, separately from the ordinary Save to Tracker flow. It is read-only: the extension cannot send, delete, or mark emails read.
- Search and status suggestions use English and some Malay phrases. The scan reads text from email bodies, with a snippet fallback. Attachments are not downloaded and email HTML is never displayed or executed. Common quoted replies are removed before classification. Known invitations, job alerts, newsletters and promotional subjects are filtered out. These rules can still miss unusual messages or misclassify wording; review is required. A rejection-context phrase containing regret suggests Rejected; a personal employment offer suggests Offer. An interview invitation remains Interview, not Offer.
- Company and role are extracted from explicit wording in subjects and email text. A branded recruitment sender or one unambiguous company name from the Sheet can supply a company suggestion. Missing details must be entered manually; follow-up emails leave the application date blank.
- Sender addresses are saved under Email Sender, reusing that header after G or creating it in the first wholly empty column after G. Existing columns are preserved.
- New rows use a Gmail thread link in column D and `Other` in Source to fit the current tracker dropdown. Dates and the days-since formula use the existing tracker layout.
- Matching first checks the Gmail thread link, then the company name in column B (ignoring case, punctuation and repeated spaces). Company abbreviations and legal suffix differences are not fuzzy-matched: correct the company field if needed. The first row is treated as headers. Manually added applications can match by company even with a job URL in column D. Multiple matches require choosing the correct row, role and date.
- Updates change **status and email sender** only, preserving the existing application date, company, role and job URL. Check chronology before updating from an older email. The record is re-read before saving; a changed or newly matching record requires a new scan and review. Concurrent edits during a save are not transactionally locked; use one popup at a time.
- Completed scan text, the target Sheet snapshot, edits and saved markers are kept in chrome.storage.local on this browser. Reopening the popup restores them without Gmail requests. Scan again replaces the cache only after the new scan completes successfully. Scans run in a background worker and checkpoint progress locally. Only individual Sheet saves require the popup to stay open. No mailbox content is sent to an AI service or developer server.
- A failed/uncertain save can be retried after scanning again: the existing thread link is checked in the Sheet before appending. There is no automatic retry of append requests.

## Validation

Local mocked tests cover status suggestions, scan deduplication, new-row import, repeat-thread updates, formula safety, denied access, and invalid dates. Live Google authorization and real inbox/Sheet writes still need testing with your configured account.

For public distribution, review Google's restricted Gmail scope verification requirements. This local implementation does not mean the Google Cloud app has been configured or verified.

References: [Gmail message search](https://developers.google.com/workspace/gmail/api/guides/list-messages), [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [Chrome Identity](https://developer.chrome.com/docs/extensions/reference/api/identity).



