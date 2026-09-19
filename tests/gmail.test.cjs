const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function setup(responses = [], localData = {}) {
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.style = {}; this.value = ''; this.events = {}; }
    append(...children) { this.children.push(...children); }
    replaceChildren() { this.children = []; }
    addEventListener(name, fn) { const previous = this.events[name]; this.events[name] = (...args) => { if (previous) previous(...args); return fn(...args); }; }
  }
  const elements = Object.fromEntries(['gmailScan', 'gmailStatus', 'gmailResults'].map(id => [id, new Element('div')]));
  const requests = [];
  const delays = [];
  const context = vm.createContext({
    URL,
    setTimeout: (callback, ms) => { delays.push(ms); callback(); },
    atob, TextDecoder, Uint8Array,
    document: {getElementById: id => elements[id], createElement: tag => new Element(tag)},
    chrome: {runtime: {}, identity: {
      getAuthToken: (options, callback) => callback('token', options.scopes), removeCachedAuthToken: async () => {}
    }, storage: {sync: {get: async () => ({sheetId: 'sheet', sheetTabName: "Bob's Jobs"})}, local: {
      get: async () => structuredClone(localData),
      set: async value => Object.assign(localData, structuredClone(value))
    }}},
    fetch: async (url, options) => {
      requests.push({url, options});
      assert.ok(responses.length, 'Unexpected request: ' + url);
      const value = responses.shift();
      return {ok: !value.error && !value.httpStatus, status: value.httpStatus || value.error || 200, headers: {get: () => value.retryAfter || null}, json: async () => value};
    },
    formatDateISO: date => date.toISOString().slice(0, 10),
    parseRelativeDate: value => { const d = new Date(value); return !isNaN(d) && d.toISOString().slice(0, 10) === value ? d : null; },
    quoteSheetTabName: name => "'" + name.replace(/'/g, "''") + "'",
    extractRowNumber: () => null,
  });
  vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../gmail.js'), 'utf8'), context);
  return {context, elements, requests, delays};
}
const message = {id: 'm1', threadId: 't1', internalDate: '1789430400000', payload: {headers: [{name: 'Subject', value: 'Thank you for applying'}]}, snippet: 'Application received'};
const email = 'person@example.com';
const link = 'https://mail.google.com/mail/?authuser=person%40example.com#all/t1';
function cardFixture(responses, rows = [], candidate = message) {
  const fixture = setup(responses);
  fixture.context.renderGmailCandidate(candidate, email, {sheetId: 'sheet', sheetTabName: "Bob's Jobs"}, rows);
  const card = fixture.elements.gmailResults.children[0];
  const inputs = card.children.filter(e => e.tag === 'label').map(e => e.children[0]);
  inputs[0].value = '=IMPORTXML("bad")'; inputs[1].value = 'Engineer';
  inputs[6].checked = true;
  const button = card.children.find(e => e.tag === 'button');
  return {...fixture, card, inputs, button};
}
test('status suggestions prioritize rejection over interview and leave unrelated mail unknown', () => {
  const {context} = setup();
  assert.equal(context.classifyEmail('Interview update', 'Unfortunately, not moving forward'), 'Rejected');
  assert.equal(context.classifyEmail('Job offer', ''), '');
  assert.equal(context.classifyEmail('Your employment offer', 'We are pleased to offer you the position of Engineer.'), 'Offer');
  assert.equal(context.classifyEmail('Interview invitation', ''), 'Interview');
  assert.equal(context.classifyEmail('Permohonan diterima', ''), 'Applied');
  assert.equal(context.classifyEmail('Weekly newsletter', ''), '');
});

const quotaError = {httpStatus: 403, error: {message: 'Quota exceeded: Units per minute per user', details: [{reason: 'RATE_LIMIT_EXCEEDED'}]}};
test('Gmail quota errors wait and retry the same read, then recover', async () => {
  const f = setup([quotaError, quotaError, {emailAddress: email}]);
  const result = await f.context.gmailRequest('token', 'https://gmail.googleapis.com/gmail/v1/users/me/profile');
  assert.equal(result.emailAddress, email);
  assert.equal(f.requests.length, 3);
  assert.equal(new Set(f.requests.map(r => r.url)).size, 1);
  const backoffs = f.delays.filter(ms => ms >= 5000);
  assert.equal(backoffs.length, 2);
  assert.ok(backoffs[1] > backoffs[0]);
});
test('quota retries stop after five retries and explain cooldown rather than permissions', async () => {
  const f = setup(Array(6).fill(quotaError));
  await assert.rejects(f.context.gmailRequest('token', 'https://gmail.googleapis.com/gmail/v1/users/me/profile'), /rate limit is still active/);
  assert.equal(f.requests.length, 6);
});
test('honors Retry-After and paces successful Gmail reads', async () => {
  const f = setup([{httpStatus: 429, retryAfter: '15', error: {message: 'Slow down'}}, {}, {}]);
  await f.context.gmailRequest('token', 'https://gmail.googleapis.com/gmail/v1/users/me/profile');
  await f.context.gmailRequest('token', 'https://gmail.googleapis.com/gmail/v1/users/me/profile');
  assert.ok(f.delays.includes(15000));
  assert.ok(f.delays.some(ms => ms > 0 && ms <= 500));
});
test('never automatically retries Sheet writes or ordinary permission errors', async () => {
  const f = setup([quotaError]);
  await assert.rejects(f.context.gmailRequest('token', 'https://sheets.googleapis.com/v4/spreadsheets/id/values/A:H:append', {method: 'POST'}), /rate limit/);
  assert.equal(f.requests.length, 1);
  const denied = setup([{httpStatus: 403, error: {message: 'API disabled', details: [{reason: 'SERVICE_DISABLED'}]}}]);
  await assert.rejects(denied.context.gmailRequest('token', 'https://gmail.googleapis.com/gmail/v1/users/me/profile'), /Enable Gmail API/);
  assert.equal(denied.requests.length, 1);
});
test('scan groups messages by thread, newest first', async () => {
  const {elements} = setup([{emailAddress: email}, {values: []}, {messages: [{id: 'm1'}, {id: 'm2'}]}, message,
    {...message, id: 'm2', internalDate: '1789516800000', payload: {headers: [{name: 'Subject', value: 'Interview invitation'}]}}]);
  await elements.gmailScan.events.click();
  assert.equal(elements.gmailResults.children.length, 1);
  assert.equal(elements.gmailResults.children[0].children[0].textContent, 'Interview invitation');
});
test('new import uses RAW, date serial and escaped destination tab', async () => {
  const f = cardFixture([{values: []}, {}, {updates: {updatedRange: "'Jobs'!A2:H2"}}]);
  f.inputs[4].value = 'hiring@acme.com';
  await f.button.events.click();
  assert.equal(f.requests.length, 3);
  const write = f.requests[2];
  assert.match(write.url, /valueInputOption=RAW/);
  assert.ok(decodeURIComponent(write.url).includes("'Bob''s Jobs'!A:H"));
  const row = JSON.parse(write.options.body).values[0];
  assert.equal(typeof row[0], 'number');
  assert.equal(row[1], '=IMPORTXML("bad")');
  assert.equal(row[3], link);
  assert.equal(row[7], 'hiring@acme.com');
  assert.equal(f.button.textContent, 'Saved');
});
test('same thread updates status and sender without appending', async () => {
  const rows = [['Date', 'Company', 'Role', 'Link', '', '', '', 'Email Sender'], ['2026-01-01', 'Acme', 'Engineer', link]];
  const f = cardFixture([{values: rows}, {}], rows);
  f.inputs[3].value = 'Interview';
  await f.button.events.click();
  assert.equal(f.requests[1].options.method, 'POST');
  const update = JSON.parse(f.requests[1].options.body);
  assert.equal(update.data[0].range, "'Bob''s Jobs'!E2");
  assert.deepEqual(update.data[0].values, [['Interview']]);
  assert.equal(update.data[1].range, "'Bob''s Jobs'!H2");
});

test('extracts employer and role from application wording instead of platform sender', () => {
  const {context} = setup();
  const details = context.extractEmailDetails('Your application for Data Analyst at Acme', '', 'LinkedIn <jobs@linkedin.com>');
  assert.equal(details.company, 'Acme');
  assert.equal(details.role, 'Data Analyst');
  assert.equal(details.sender, 'jobs@linkedin.com');
});
test('extracts details from preview and branded recruitment sender', () => {
  const {context} = setup();
  const details = context.extractEmailDetails('Application received', 'Thank you for applying for the Software Engineer position.', 'Acme Careers <careers@acme.com>');
  assert.equal(details.company, 'Acme');
  assert.equal(details.role, 'Software Engineer');
});
test('leaves ambiguous details blank and supports Malay labels', () => {
  const {context} = setup();
  const unknown = context.extractEmailDetails('Your application', 'Thank you.', 'Jane <jane@gmail.com>');
  assert.equal(unknown.company, ''); assert.equal(unknown.role, '');
  const malay = context.extractEmailDetails('Permohonan diterima', 'Jawatan: Data Analyst; Syarikat: Acme', 'hr@acme.com');
  assert.equal(malay.role, 'Data Analyst'); assert.equal(malay.company, 'Acme');
});
test('sender column preserves occupied columns and reuses existing header', () => {
  const {context} = setup();
  assert.equal(context.senderColumn([['', '', '', '', '', '', '', 'Notes']]), 8);
  assert.equal(context.senderColumn([[], ['', '', '', '', '', '', '', 'existing note']]), 8);
  assert.equal(context.senderColumn([['', '', '', '', '', '', '', 'Notes', 'Email Sender']]), 8);
  assert.equal(context.columnLetter(26), 'AA');
});
test('invalid application date blocks writes', async () => {
  const f = cardFixture([]); f.inputs[2].value = '2026-02-30';
  await f.button.events.click(); assert.equal(f.requests.length, 0);
});
test('denied API access leaves scan retryable with useful message', async () => {
  const {elements} = setup([{error: 403}]);
  await elements.gmailScan.events.click();
  assert.match(elements.gmailStatus.textContent, /Gmail error \(403/);
  assert.equal(elements.gmailScan.disabled, false);
});
test('newly appearing records require a fresh review instead of silently changing import to update', async () => {
  const f = cardFixture([{values: [['Date', 'Company', 'Role', 'Link'], ['', '', '', link]]}]);
  await f.button.events.click();
  assert.equal(f.requests.length, 1);
  assert.match(f.card.children.at(-1).textContent, /now in the Sheet/);
});

test('filters LinkedIn invitations and job advertising but retains application confirmations', () => {
  const {context: c} = setup();
  assert.equal(c.isApplicationEmail('You have 5 new invitations', 'See who reached out, Aidil Farhan'), false);
  assert.equal(c.isApplicationEmail('Job offers for you', 'Apply now! Track your application on LinkedIn'), false);
  assert.equal(c.isApplicationEmail('Interview tips for your next role', 'Your application matters'), false);
  assert.equal(c.isApplicationEmail('Your application was sent to Acme', 'Application submitted. Browse jobs'), true);
  assert.equal(c.classifyEmail('Your application at Acme', 'We regret that we cannot proceed with your application.'), 'Rejected');
  assert.equal(c.classifyEmail('Your employment offer', 'We regret the inconvenience. We are pleased to offer you the position of Engineer.'), 'Offer');
});

test('reads nested MIME bodies in UTF-8 and ignores attached files', () => {
  const {context: c} = setup();
  const body = 'We regret your application was unsuccessful. Syarikat: Café';
  const payload = {mimeType: 'multipart/mixed', parts: [
    {mimeType: 'multipart/alternative', parts: [
      {mimeType: 'text/plain', body: {data: Buffer.from(body).toString('base64url')}},
      {mimeType: 'text/html', body: {data: Buffer.from('<p>Duplicate</p>').toString('base64url')}}
    ]},
    {filename: 'attachment.txt', mimeType: 'text/plain', body: {data: Buffer.from('Offer').toString('base64url')}}
  ]};
  assert.equal(c.emailBody(payload).trim(), body);
  assert.equal(c.classifyEmail('Application update', c.emailBody(payload)), 'Rejected');
});

test('HTML email extraction removes active content and quoted replies', () => {
  const {context: c} = setup();
  const html = '<style>regret</style><script>regret</script><p>We invite you to an interview for Engineer at Acme.</p><blockquote>Your application was unsuccessful</blockquote>';
  const text = c.emailBody({mimeType: 'text/html', body: {data: Buffer.from(html).toString('base64url')}});
  assert.equal(c.classifyEmail('Interview invitation', text), 'Interview');
  assert.equal(text.includes('regret'), false);
  const plain = 'We invite you to an interview.\nOn Monday HR wrote:\nWe regret your application was unsuccessful';
  assert.equal(c.classifyEmail('Interview invitation', c.currentEmailText({snippet: plain})), 'Interview');
});

test('scan paginates across three months and filters advertising', async () => {
  const ad = {...message, payload: {headers: [{name: 'Subject', value: 'You have 5 new invitations'}]}};
  const {elements, requests} = setup([{emailAddress: email}, {values: []},
    {messages: [{id: 'ad'}], nextPageToken: 'next'}, ad,
    {messages: [{id: 'real'}]}, message]);
  await elements.gmailScan.events.click();
  assert.equal(elements.gmailResults.children.length, 1);
  assert.match(decodeURIComponent(requests[2].url), /newer_than:3m/);
  assert.match(requests[4].url, /pageToken=next/);
  assert.match(requests[3].url, /format=full/);
  assert.match(elements.gmailStatus.textContent, /1 unrelated emails skipped/);
});

const headerRow = ['Date', 'Company', 'Role', 'Link', 'Status', 'Source', 'Days', 'Email Sender'];
test('completed scans and edits restore after popup closes without Gmail requests', async () => {
  const local = {};
  const first = setup([{emailAddress: email}, {values: []}, {messages: [{id: 'm1'}]}, message], local);
  await first.elements.gmailScan.events.click();
  const card = first.elements.gmailResults.children[0];
  const fields = card.children.filter(e => e.tag === 'label').map(e => e.children[0]);
  fields[0].value = 'Edited company'; fields[0].events.input();
  fields[1].value = 'Edited role'; fields[1].events.input();
  await Promise.resolve();
  const reopened = setup([], local);
  await vm.runInContext('scanReady', reopened.context);
  const restored = reopened.elements.gmailResults.children[0].children.filter(e => e.tag === 'label').map(e => e.children[0]);
  assert.equal(restored[0].value, 'Edited company');
  assert.equal(restored[1].value, 'Edited role');
  assert.equal(reopened.requests.length, 0);
  assert.match(reopened.elements.gmailScan.textContent, /Scan semula/);
});
test('failed rescan keeps previous results and drafts', async () => {
  const local = {};
  const first = setup([{emailAddress: email}, {values: []}, {messages: [{id: 'm1'}]}, message], local);
  await first.elements.gmailScan.events.click();
  const old = JSON.stringify(local);
  const reopened = setup([{error: 403}], local);
  await reopened.elements.gmailScan.events.click();
  assert.equal(JSON.stringify(local), old);
  assert.equal(reopened.elements.gmailResults.children.length, 1);
});
test('company matching finds manually added job links without matching substrings', () => {
  const {context: c} = setup();
  const rows = [headerRow, ['', 'Acme', 'Engineer', 'https://jobs.example/1'], ['', 'Acme Labs', 'Analyst', 'https://jobs.example/2']];
  assert.equal(c.matchApplications(rows, ' ACME ', link).length, 1);
  assert.equal(c.matchApplications(rows, 'Acm', link).length, 0);
  assert.equal(c.matchApplications(rows, '', link).length, 0);
});

test('existing company shows Update and updates selected row while preserving job URL', async () => {
  const rows = [headerRow, ['2026-01-01', 'Acme', 'Engineer', 'https://jobs.example/1', 'Applied']];
  const candidate = {...message, payload: {headers: [{name: 'Subject', value: 'Your application for Engineer at Acme'}]}};
  const f = cardFixture([{values: rows}, {}], rows, candidate);
  f.inputs[0].value = 'Acme';
  assert.equal(f.button.textContent, 'Update application');
  f.inputs[3].value = 'Rejected';
  await f.button.events.click();
  const data = JSON.parse(f.requests[1].options.body).data;
  assert.deepEqual(data.map(item => item.range), ["'Bob''s Jobs'!E2", "'Bob''s Jobs'!H2"]);
  assert.equal(data[0].values[0][0], 'Rejected');
});

test('multiple roles require explicit row selection and confirmation', async () => {
  const rows = [headerRow, ['', 'Acme', 'Engineer', 'url1'], ['', 'Acme', 'Analyst', 'url2']];
  const candidate = {...message, payload: {headers: [{name: 'Subject', value: 'Your application for Engineer at Acme'}]}};
  const f = cardFixture([], rows, candidate);
  f.inputs[0].value = 'Acme';
  await f.button.events.click();
  assert.equal(f.requests.length, 0);
  assert.match(f.card.children.at(-1).textContent, /Choose the correct/);
  f.inputs[5].value = '1'; f.inputs[6].checked = false;
  await f.button.events.click();
  assert.match(f.card.children.at(-1).textContent, /confirmation box/);
});

test('stale row blocks writes after spreadsheet change', async () => {
  const rows = [headerRow, ['', 'Acme', 'Engineer', link, 'Applied']];
  const fresh = [headerRow, ['', 'Acme', 'Engineer', link, 'Offer']];
  const f = cardFixture([{values: fresh}], rows);
  await f.button.events.click();
  assert.equal(f.requests.length, 1);
  assert.match(f.card.children.at(-1).textContent, /record changed/);
});

test('editing company refreshes import/update choice and clears confirmation', () => {
  const rows = [headerRow, ['', 'Acme', 'Engineer', 'url']];
  const f = cardFixture([], rows);
  assert.equal(f.button.textContent, 'Import this application');
  f.inputs[0].value = 'Acme'; f.inputs[0].events.input();
  assert.equal(f.button.textContent, 'Update application');
  assert.equal(f.inputs[6].checked, false);
});
