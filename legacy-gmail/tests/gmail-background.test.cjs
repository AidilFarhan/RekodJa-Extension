const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function worker(data = {}, replies = []) {
  const calls = [], listeners = {};
  const event = name => ({addListener: fn => {listeners[name] = fn;}});
  const c = vm.createContext({URL, TextDecoder, Uint8Array, atob, AbortSignal, console,
    setTimeout: fn => {fn();},
    chrome: {identity: {getAuthToken: (_, callback) => callback('token')},
      storage: {local: {get: async () => structuredClone(data), set: async value => Object.assign(data, structuredClone(value))}, sync: {get: async () => ({sheetId: 's', sheetTabName: 'Jobs'})}},
      alarms: {create: async () => {}, clear: async () => {}, onAlarm: event('alarm')},
      runtime: {onMessage: event('message'), onStartup: event('startup'), onInstalled: event('installed')}},
    fetch: async url => {calls.push(url); assert.ok(replies.length, url); const body = replies.shift(); return {ok: !body.error, status: body.error ? 403 : 200, headers: {get: () => null}, json: async () => body};}
  });
  c.importScripts = () => vm.runInContext(fs.readFileSync(__dirname + '/../gmail-core.js', 'utf8'), c);
  vm.runInContext(fs.readFileSync(__dirname + '/../gmail-background.js', 'utf8'), c);
  return {c, calls, listeners};
}
const target = {sheetId: 's', sheetTabName: 'Jobs'};
const message = {id: 'm', threadId: 't', internalDate: '1', snippet: 'Application received', payload: {headers: [{name: 'Subject', value: 'Thank you for applying'}]}};
function job() {return {target, phase: 'profile', checked: 0, skipped: 0, messages: [], pending: [], nextPage: '', retries: 0};}
test('background completes scan with no popup, publishes cache and clears checkpoint', async () => {
  const data = {gmailScanJob: job()};
  const w = worker(data, [{emailAddress: 'me@example.com'}, {values: [['Date', 'Company']]}, {messages: [{id: 'm'}]}, message]);
  await w.c.pump();
  assert.equal(data.gmailScanV1.messages[0].id, 'm');
  assert.equal(data.gmailScanStatus.state, 'complete');
  assert.equal(data.gmailScanJob, null);
});
test('fresh worker resumes message cursor instead of starting scan over', async () => {
  const j = {...job(), phase: 'messages', email: 'me@example.com', rows: [], pending: [{id: 'm'}], checked: 12};
  const data = {gmailScanJob: j};
  const w = worker(data, [message]);
  await w.c.pump();
  assert.equal(w.calls.length, 1);
  assert.match(w.calls[0], /messages\/m/);
  assert.equal(data.gmailScanStatus.state, 'complete');
});
test('quota backoff saves cursor and resumes in another worker', async () => {
  const data = {gmailScanJob: job(), gmailScanV1: {marker: 'old'}};
  const w = worker(data, [{error: {message: 'Units per minute', details: [{reason: 'RATE_LIMIT_EXCEEDED'}]}}]);
  await w.c.pump();
  assert.ok(data.gmailScanJob.retryAt > Date.now());
  assert.equal(data.gmailScanV1.marker, 'old');
  data.gmailScanJob.retryAt = 0;
  const next = worker(data, [{emailAddress: 'me@example.com'}, {values: []}, {messages: []}]);
  await next.c.pump();
  assert.equal(data.gmailScanStatus.state, 'complete');
});
test('failed rescan keeps previously completed results', async () => {
  const data = {gmailScanJob: job(), gmailScanV1: {marker: 'old'}};
  await worker(data, [{error: {message: 'API disabled'}}]).c.pump();
  assert.equal(data.gmailScanV1.marker, 'old');
  assert.equal(data.gmailScanStatus.state, 'error');
});
test('popup restores stored results and rescan control without fetching Google', async () => {
  class Element {
    constructor() {this.style = {}; this.children = []; this.classList = {add() {}, remove() {}}; this.parentNode = {insertBefore() {}}; this.events = {};}
    replaceChildren() {this.children = [];}
    append(...items) {this.children.push(...items);}
    addEventListener(name, fn) {this.events[name] = fn;}
    remove() {}
  }
  const elements = Object.fromEntries(['gmailScan', 'gmailStatus', 'gmailResults'].map(key => [key, new Element()]));
  const data = {gmailScanV1: {version: 1, messages: [message], rows: [], target, email: 'me@example.com', drafts: {}, scannedAt: 1, summary: 'Previous scan'}};
  const c = vm.createContext({console, URL, TextDecoder, Uint8Array, atob, setTimeout,
    formatDateISO: () => '2026-09-16',
    document: {getElementById: id => elements[id], querySelector: () => new Element(), createElement: () => new Element()},
    chrome: {storage: {onChanged: {addListener() {}}, local: {get: async () => data, set: async value => Object.assign(data, value)}}, runtime: {sendMessage: async () => ({ok: true})}},
    fetch: () => {throw new Error('Unexpected Google fetch during restore');}
  });
  vm.runInContext(fs.readFileSync(__dirname + '/../gmail-core.js', 'utf8'), c);
  vm.runInContext(fs.readFileSync(__dirname + '/../gmail.js', 'utf8'), c);
  await vm.runInContext('scanReady', c);
  assert.equal(elements.gmailResults.children.length, 1);
  assert.equal(elements.gmailScan.textContent, 'Rescan Gmail');
  assert.match(elements.gmailStatus.textContent, /Previous scan/);
});


