import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const root = new URL('../src/console/', import.meta.url);
const [html, css, js] = await Promise.all([
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('styles.css', root), 'utf8'),
  readFile(new URL('app.js', root), 'utf8'),
]);
const assets = `${html}\n${css}\n${js}`;

function includesAll(source, values, label) {
  for (const value of values) assert.ok(source.includes(value), `${label}: missing ${value}`);
}

test('console is strict-CSP-compatible and keeps behavior and styling external', () => {
  assert.match(html, /<link[^>]+href="\/console\/styles\.css"/);
  assert.match(html, /<script[^>]+src="\/console\/app\.js"[^>]*><\/script>/);
  assert.doesNotMatch(html, /<style\b/i);
  assert.doesNotMatch(html, /<script(?![^>]+src=)[^>]*>/i);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(html, /\sstyle\s*=/i);
  assert.doesNotMatch(js, /\.style\b|setAttribute\(['"]style/i);
});

test('console never persists credentials or one-time Keys in browser stores', () => {
  assert.doesNotMatch(js, /localStorage|sessionStorage|indexedDB/i);
  assert.doesNotMatch(js, /document\.cookie/i);
  assert.match(js, /credentials:\s*['"]same-origin['"]/);
  assert.match(js, /cache:\s*['"]no-store['"]/);
  assert.match(js, /state\.oneTimeKey\s*=\s*data\.clientKey/);
  assert.match(js, /state\.oneTimeKey\s*=\s*null/g);
});

test('all dynamic rendering uses text-safe DOM APIs', () => {
  assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/i);
  assert.match(js, /textContent/);
  assert.match(js, /document\.createElement/);
});

test('account flows include login, logout, password, sessions, CSRF, and recent auth', () => {
  includesAll(js, [
    "api('/account/login'", "api('/account/session'", "api('/account/password'",
    "api('/account/sessions'", "api('/account/sessions/others'", "api('/account/reauthenticate'",
    "headers.set('X-CSRF-Token'", 'ensureRecentAuth',
  ], 'account flow');
  assert.match(html, /autocomplete="username"/);
  assert.match(html, /autocomplete="current-password"/);
  assert.doesNotMatch(assets, /sign[ -]?up|register|registration|mfa|multi-factor|two-factor|2fa/i);
});

test('spaces and clients expose exact structural limits and lifecycle actions', () => {
  includesAll(js, [
    "api('/spaces'", '/deletion-impact', '/delete`', '/restore`',
    '/clients`', '/rotate-key`', '/revoke`', '/reset-installation`',
    'activeLimit ?? 10', 'showOneTimeKey',
  ], 'space and client flow');
  assert.match(js, /overlapSeconds/);
  assert.match(js, /86400/);
  assert.match(js, /confirmationName/);
  assert.match(js, /limitProgress\(activeCount, activeLimit/);
});

test('operational views cover usage, audit, conflicts, and verified exports', () => {
  includesAll(js, [
    "api('/usage'", '/audit?', '/conflicts?status=unresolved', '/resolve`',
    '/exports`', '/download`', "job.state === 'verified'",
  ], 'operational flow');
  assert.match(js, /无业务容量配额/);
  assert.doesNotMatch(css, /quota/i);
});

test('shell and dialogs include keyboard, focus, status, and responsive hooks', () => {
  includesAll(html, [
    'href="#main-content"', 'aria-live="polite"', 'role="alert"',
    'aria-controls="sidebar"', '<dialog', 'aria-labelledby="dialog-title"',
  ], 'accessibility markup');
  includesAll(js, [
    "event.key === 'Escape'", "event.key !== 'Tab'", 'state.lastFocused.focus()',
    "setAttribute('aria-expanded'", "setAttribute('aria-current'", "setAttribute('aria-busy'",
  ], 'accessibility behavior');
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /td::before\s*\{\s*content:\s*attr\(data-label\)/);
});
