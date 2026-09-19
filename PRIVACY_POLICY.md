# Privacy Policy — Job Tracker Quick Add

*Last updated: 15 September 2026*

## What this extension does

Job Tracker Quick Add is a Chrome extension that lets you save a job posting you're viewing into a Google Sheet you own, along with the date you applied. It reads the current tab's page title and metadata to guess the company name and job role, and writes that information as a new row into a Google Sheet you specify.

## What data we access

- **Google Sheets data**: With your permission (via Google's OAuth sign-in), the extension can read and write to Google Sheets in your Google Drive. It only ever writes to the specific spreadsheet ID you enter in the extension's Settings panel — it does not browse, list, or access any other file in your Drive.
- **Current tab content**: When you click the extension icon, it reads the page title and a small set of metadata tags (such as Open Graph tags or structured job-posting data) from the active tab to pre-fill the Company and Role fields. This only happens when you actively click the extension icon — it does not run in the background or monitor your browsing.

## What we don't do

- We do not operate a server. All data goes directly from your browser to Google's servers using your own Google account credentials.
- We do not store, log, sell, or share your data with any third party.
- Gmail access is optional. When you click **Connect Gmail & Scan**, we request read-only Gmail access, read your account email address and search matching messages from the last 3 months across all result pages. We use message headers, snippets and email body text to filter application emails and suggest company names, roles and application statuses. We read your selected Sheet to match existing applications by thread link or company name. We do not download attachments, send, delete, or modify emails. We do not access contacts or calendars.
- We do not track your browsing activity.

## Data retention

Since there is no backend server, we do not retain any of your data ourselves. Your job application data lives entirely in the Google Sheet you control. Your Google Sheet ID is stored locally in your browser's extension storage (via `chrome.storage.sync`), which syncs across your own signed-in Chrome browsers and is not accessible to us or anyone else.

Completed scan text, message headers, the destination Sheet snapshot, user edits and saved markers are retained in local extension storage on this browser so results survive closing the popup. They are not synced to other browsers. A successful new scan replaces the previous cache; uninstalling the extension removes its local storage. OAuth tokens are not included in this scan cache. After you review and confirm an import, its application date, entered company/role, Gmail thread link, sender email address and selected status are written directly to your selected Google Sheet. Confirmed updates to an existing application change its status and sender email. Imported records remain in the Sheet until you remove them. Only user-started Gmail scans run in the background; unfinished scan progress is checkpointed locally and resumed after popup closure or a browser restart. Completed results remain until a successful Rescan Gmail replaces them. There is no scheduled inbox monitoring and no email data is sent to an AI service or developer server.

## Revoking access

You can revoke this extension's access to your Google account at any time via [Google Account permissions](https://myaccount.google.com/permissions).

## Contact

Questions about this policy can be sent to: [YOUR EMAIL]

## Changes to this policy

If this policy changes, the "Last updated" date above will be revised accordingly.



