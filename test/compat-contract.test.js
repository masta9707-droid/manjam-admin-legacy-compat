'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'public', 'mfa-compat.js'), 'utf8');

test('keeps the legacy application bundles and loads the compatibility gateway first', () => {
  for (const asset of ['runtime.js', 'polyfills.js', 'main.js', 'styles.css']) {
    assert.equal(fs.existsSync(path.join(root, 'public', asset)), true, asset);
  }
  assert.ok(index.indexOf('/mfa-compat.js') < index.indexOf('/main.js'));
});

test('implements password login and MFA verification without disabling MFA', () => {
  assert.match(script, /post\('\/auth\/login'/);
  assert.match(script, /post\('\/auth\/mfa\/verify'/);
  assert.match(script, /result\.mfaRequired/);
  assert.doesNotMatch(script, /ADMIN_MFA_ENFORCED/);
});

test('keeps the challenge and credentials out of browser storage', () => {
  const storageWrites = Array.from(script.matchAll(/localStorage\.setItem\(([^\n]+)\)/g), (match) => match[1]);
  assert.equal(storageWrites.length, 2);
  assert.ok(storageWrites.every((line) => /currentUser|token/.test(line)));
  assert.ok(storageWrites.every((line) => !/challenge|password|otp/i.test(line)));
  assert.doesNotMatch(script, /sessionStorage\.setItem/);
});

test('self-heals legacy invalid sessions before mounting the MFA gateway', () => {
  assert.match(script, /token === 'undefined'/);
  assert.match(script, /rawProfile === 'undefined'/);
  assert.match(script, /JSON\.parse\(rawProfile\)/);
  assert.match(script, /clearSession\(\)/);
});

test('rejects expired or malformed MFA challenges', () => {
  assert.match(script, /expiresInSeconds < 1 \|\| expiresInSeconds > 300/);
  assert.match(script, /Date\.now\(\) >= challengeExpiresAt/);
  assert.match(script, /Mã xác minh đã hết hạn/);
});

test('validates the return route before navigation', () => {
  assert.match(script, /candidate\.indexOf\('\/\/'\) === 0/);
  assert.match(script, /return '\/page\/home'/);
});
