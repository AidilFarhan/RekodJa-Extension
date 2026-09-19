importScripts('gmail-core.js');
const JOB = 'gmailScanJob', STATUS = 'gmailScanStatus', CACHE = 'gmailScanV1';
const ALARM = 'gmail-scan-checkpoint';
const scopes = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/gmail.readonly'];
let working = false, starting = false;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function auth() {
  return new Promise((resolve, reject) => chrome.identity.getAuthToken({interactive: false, scopes}, token => {
    const error = chrome.runtime.lastError;
    if (error || !token) reject(new Error('Open the extension and click Rescan Gmail to sign in again.'));
    else resolve(token);
  }));
}
async function request(token, url) {
  const response = await fetch(url, {headers: {Authorization: 'Bearer ' + token}, signal: AbortSignal.timeout(20000)});
  const body = await response.json();
  if (response.ok) return body;
  const reason = body.error?.details?.find(d => d.reason)?.reason || body.error?.errors?.[0]?.reason || '';
  const message = body.error?.message || `Google request failed (${response.status})`;
  const error = new Error(message);
  error.retryable = response.status === 429 || response.status >= 500 || (response.status === 403 && /rateLimit|RATE_LIMIT|per minute/i.test(reason + message));
  const header = response.headers.get('Retry-After');
  error.retryAfter = header ? (/^\d+$/.test(header) ? Number(header) * 1000 : Math.max(0, Date.parse(header) - Date.now())) : 0;
  if (response.status === 401) await chrome.identity.removeCachedAuthToken({token});
  throw error;
}
async function checkpoint(job, message) {
  await chrome.storage.local.set({[JOB]: job, [STATUS]: {state: 'running', message, checked: job.checked}});
}
async function startScan() {
  if (starting) return;
  starting = true;
  try {
    const old = (await chrome.storage.local.get(JOB))[JOB];
    if (old) { void pump(); return; }
    const target = await chrome.storage.sync.get(['sheetId', 'sheetTabName']);
    if (!target.sheetId || !target.sheetTabName) throw new Error('Connect a Sheet and select its tab in Settings first.');
    await chrome.alarms.create(ALARM, {periodInMinutes: 0.5});
    await checkpoint({target, phase: 'profile', checked: 0, skipped: 0, messages: [], pending: [], nextPage: '', retries: 0}, 'Starting Gmail scan…');
    void pump();
  } finally { starting = false; }
}
async function step(job, token) {
  if (job.phase === 'profile') {
    job.email = (await request(token, 'https://gmail.googleapis.com/gmail/v1/users/me/profile')).emailAddress;
    job.phase = 'sheet';
  } else if (job.phase === 'sheet') {
    const tab = "'" + job.target.sheetTabName.replace(/'/g, "''") + "'!A:F";
    job.rows = (await request(token, `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(job.target.sheetId)}/values/${encodeURIComponent(tab)}`)).values || [];
    job.phase = 'list';
  } else if (job.phase === 'list') {
    const query = 'newer_than:3m -in:spam -in:trash -in:sent -in:drafts {"application" "thank you for applying" "thanks for applying" "interview" "regret" "job offer" "offer of employment" "permohonan" "temuduga" "temu duga"}';
    const page = await request(token, 'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=50&q=' + encodeURIComponent(query) + (job.nextPage ? '&pageToken=' + encodeURIComponent(job.nextPage) : ''));
    job.pending = page.messages || []; job.nextPage = page.nextPageToken || '';
    job.phase = job.pending.length ? 'messages' : (job.nextPage ? 'list' : 'done');
  } else if (job.phase === 'messages') {
    const message = await request(token, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${job.pending[0].id}?format=full`);
    const subject = message.payload?.headers?.find(h => h.name.toLowerCase() === 'subject')?.value || '';
    const text = currentEmailText(message);
    if (!(message.labelIds || []).some(label => ['SENT', 'DRAFT'].includes(label)) && isApplicationEmail(subject, text)) {
      const compact = {id: message.id, threadId: message.threadId, internalDate: message.internalDate, snippet: text,
        payload: {headers: (message.payload?.headers || []).filter(h => /^(subject|from)$/i.test(h.name))}};
      const previous = job.messages.findIndex(item => item.threadId === message.threadId);
      if (previous < 0) job.messages.push(compact);
      else if (Number(message.internalDate) > Number(job.messages[previous].internalDate)) job.messages[previous] = compact;
    } else job.skipped++;
    job.checked++; job.pending.shift();
    if (!job.pending.length) job.phase = job.nextPage ? 'list' : 'done';
  }
}
async function pump() {
  if (working) return;
  working = true;
  let schedule = false;
  try {
    let job = (await chrome.storage.local.get(JOB))[JOB];
    if (!job) { await chrome.alarms.clear(ALARM); return; }
    if (job.retryAt > Date.now()) return;
    const token = await auth();
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      try {
        await step(job, token);
        job.retries = 0; job.retryAt = 0;
      } catch (error) {
        if ((error.retryable || error.name === 'TimeoutError' || error instanceof TypeError) && job.retries < 5) {
          job.retries++;
          job.retryAt = Date.now() + Math.max(error.retryAfter || 0, Math.min(60000, 5000 * 2 ** job.retries));
          await checkpoint(job, `Google temporarily paused the scan. Retrying after ${new Date(job.retryAt).toLocaleTimeString()}.`);
          return;
        }
        throw error;
      }
      if (job.phase === 'done') {
        job.messages.sort((a, b) => Number(b.internalDate) - Number(a.internalDate));
        const summary = `${job.email}: ${job.messages.length} application threads from the last 3 months. ${job.skipped} unrelated emails skipped.`;
        // Publish only completed results. Previous results survive failed rescans.
        await chrome.storage.local.set({[CACHE]: {version: 1, email: job.email, target: job.target, rows: job.rows,
          messages: job.messages, drafts: {}, scannedAt: Date.now(), summary}, [STATUS]: {state: 'complete', message: summary}, [JOB]: null});
        await chrome.alarms.clear(ALARM);
        return;
      }
      await checkpoint(job, `Scanning the last 3 months: ${job.checked} emails read, ${job.skipped} unrelated emails skipped.`);
      await wait(500);
    }
    schedule = true;
  } catch (error) {
    await chrome.storage.local.set({[JOB]: null, [STATUS]: {state: 'error', message: error.message}});
    await chrome.alarms.clear(ALARM);
  } finally {
    working = false;
    if (schedule) setTimeout(() => void pump(), 500);
  }
}
async function resume() {
  if ((await chrome.storage.local.get(JOB))[JOB]) {
    await chrome.alarms.create(ALARM, {periodInMinutes: 0.5});
    void pump();
  }
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!['gmail-scan-start', 'gmail-scan-resume'].includes(message.type)) return;
  (message.type === 'gmail-scan-start' ? startScan() : resume()).then(() => reply({ok: true}), error => reply({ok: false, error: error.message}));
  return true;
});
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) void pump(); });
chrome.runtime.onStartup.addListener(() => void resume());
chrome.runtime.onInstalled.addListener(() => void resume());
