import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const publicRoot = path.join(root, 'public');
const artifactRoot = path.join(here, 'artifacts');

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const server = http.createServer(async (request, response) => {
  const requestedPath = new URL(request.url, 'http://127.0.0.1').pathname;
  const relativePath = requestedPath === '/' ? 'index.html' : requestedPath.replace(/^\/+/, '');
  const resolved = path.resolve(publicRoot, relativePath);
  const safePath = resolved.startsWith(publicRoot + path.sep) ? resolved : path.join(publicRoot, 'index.html');
  try {
    const body = await fs.readFile(safePath);
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': contentTypes[path.extname(safePath)] || 'application/octet-stream'
    });
    response.end(body);
  } catch {
    const body = await fs.readFile(path.join(publicRoot, 'index.html'));
    response.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': contentTypes['.html'] });
    response.end(body);
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.route('https://www.google.com/recaptcha/**', (route) => route.abort());
  await page.route('https://api.dev.manjaglobal.com/api/v1/admin/auth/login', async (route) => {
    const body = route.request().postDataJSON();
    assert.deepEqual(body, { email: 'owner@example.test', password: 'fixture-password' });
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        data: { mfaRequired: true, challengeToken: 'fixture-challenge', expiresInSeconds: 300 },
        message: null,
        statusCode: null
      })
    });
  });
  await page.route('https://api.dev.manjaglobal.com/api/v1/admin/auth/mfa/verify', async (route) => {
    const body = route.request().postDataJSON();
    assert.deepEqual(body, { challengeToken: 'fixture-challenge', otp: '123456' });
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          mfaRequired: false,
          token: 'fixture-access-token',
          profile: { id: 'fixture-owner', email: 'owner@example.test', role: 'OWNER' }
        },
        message: null,
        statusCode: null
      })
    });
  });

  await page.addInitScript(() => {
    if (!sessionStorage.getItem('invalid-session-seeded')) {
      localStorage.setItem('token', 'undefined');
      localStorage.setItem('currentUser', 'undefined');
      sessionStorage.setItem('invalid-session-seeded', '1');
    }
  });

  await page.goto(`${baseUrl}/#/login?returnUrl=%2Fpage%2Fhome`, { waitUntil: 'domcontentloaded' });
  await page.locator('#manjam-admin-email').waitFor({ state: 'visible' });

  const healed = await page.evaluate(() => ({
    token: localStorage.getItem('token'),
    profile: localStorage.getItem('currentUser')
  }));
  assert.deepEqual(healed, { token: null, profile: null });

  await page.locator('#manjam-admin-email').fill('owner@example.test');
  await page.locator('#manjam-admin-password').fill('fixture-password');
  await page.locator('[data-password-form] button[type="submit"]').click();
  await page.locator('#manjam-admin-otp').waitFor({ state: 'visible' });

  const preVerifyStorage = await page.evaluate(() => ({ ...localStorage }));
  assert.equal('challengeToken' in preVerifyStorage, false);
  assert.equal('password' in preVerifyStorage, false);
  assert.equal('otp' in preVerifyStorage, false);

  await page.locator('#manjam-admin-otp').fill('123456');
  await page.locator('[data-otp-form] button[type="submit"]').click();
  await page.waitForFunction(() => localStorage.getItem('token') === 'fixture-access-token');

  const finalSession = await page.evaluate(() => ({
    token: localStorage.getItem('token'),
    profile: JSON.parse(localStorage.getItem('currentUser')),
    hash: window.location.hash
  }));
  assert.equal(finalSession.token, 'fixture-access-token');
  assert.equal(finalSession.profile.role, 'OWNER');
  assert.equal(finalSession.hash, '#/page/home');

  await fs.mkdir(artifactRoot, { recursive: true });
  await page.screenshot({ path: path.join(artifactRoot, 'legacy-admin-mfa-fixture.png'), fullPage: true });
  process.stdout.write('PASS legacy Admin password → MFA → session fixture\n');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
