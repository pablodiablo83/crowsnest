// The sign-in experience in a browser: redirect to the login page, wrong password, wave, landing back where you were,
// account section (change password, sign out), and an expired session mid-use.
// Needs a fresh server on 8091 and the test account (tests/run-all.sh). NODE_PATH=... node tests/pw-login.js [shots dir]
const { chromium } = require('playwright');
const fs = require('fs');
const B = process.env.BASE || 'http://localhost:8091', SP = process.argv[2] || '.';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const br = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined });
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 } });
  const errs = [], page = await ctx.newPage();
  page.on('pageerror', e => errs.push(e.message));

  await page.goto(B + '/wind.html');
  ok(/\/login\.html\?next=%2Fwind\.html$/.test(page.url()), 'signed out: wind page sends you to the login page');
  await page.waitForSelector('#u');
  await page.screenshot({ path: SP + '/login.png' });
  await page.fill('#u', 'tester'); await page.fill('#p', 'wrong-password-1'); await page.click('#go');
  await page.waitForFunction(() => /wrong username or password/i.test(document.getElementById('err').textContent));
  ok(true, 'wrong password: clear message, stays on the login page');
  await page.fill('#p', 'test-password-1234');
  const [nav] = await Promise.all([page.waitForURL(B + '/wind.html', { timeout: 10000 }), (async () => {
    await page.click('#go');
    await page.waitForSelector('.busy .cn-wave', { state: 'visible', timeout: 3000 });
    await page.screenshot({ path: SP + '/login-wave.png' });
  })()]);
  ok(true, 'signed in: wave shown, then back on the wind page');
  await page.goto(B + '/login.html');
  await page.waitForURL(B + '/', { timeout: 5000 });
  ok(true, 'login page skips straight through when already signed in');

  // account section
  await page.goto(B + '/hours-of-rest.html');
  await page.waitForSelector('[data-act=settings]');
  await page.click('[data-act=settings]');
  await page.waitForSelector('text=Signed in as');
  ok(/Signed in as tester/.test(await page.textContent('.settings-body')), 'Customise shows the signed-in account');
  await page.click('summary:has-text("Change password")');
  await page.fill('#pwCur', 'test-password-1234'); await page.fill('#pwNew', 'short');
  await page.click('form[data-form=password] button[type=submit]');
  await page.waitForSelector('form[data-form=password] .h-err');
  ok(/at least 10 characters/i.test(await page.textContent('form[data-form=password] .errbox')), 'short new password refused with a reason');
  await page.fill('#pwNew', 'another-password-99');
  await page.click('form[data-form=password] button[type=submit]');
  await page.waitForFunction(() => /Password changed/.test(document.getElementById('toastText').textContent));
  ok(true, 'password changed from the app');

  // session ends while a page is open: the next call goes to the login page, then back
  await ctx.clearCookies();
  await page.goto(B + '/');
  await page.waitForURL(/login\.html\?next=%2F$/);
  ok(true, 'cookie gone: dashboard goes to the login page');
  await page.fill('#u', 'tester'); await page.fill('#p', 'another-password-99'); await page.click('#go');
  await page.waitForURL(B + '/');
  await page.waitForSelector('#heroMain, #heroSetup', { state: 'visible' });
  ok(true, 'signed back in with the new password');
  await ctx.clearCookies();
  await page.evaluate(() => fetch('/api/crew'));
  await page.waitForURL(/login\.html\?next=%2F/, { timeout: 5000 });
  ok(true, 'an API call after the session ended goes to the login page');

  // sign out
  await page.fill('#u', 'tester'); await page.fill('#p', 'another-password-99'); await page.click('#go');
  await page.waitForURL(B + '/');
  await page.goto(B + '/hours-of-rest.html'); await page.click('[data-act=settings]');
  await page.click('[data-act=sign-out]');
  await page.waitForURL(/login\.html/);
  const r = await page.evaluate(() => fetch('/api/auth/me').then(x => x.status));
  ok(r === 401, 'Sign out ends the session');
  // put the test password back for any later suite
  await page.fill('#u', 'tester'); await page.fill('#p', 'another-password-99'); await page.click('#go'); await page.waitForURL(B + '/');
  await page.evaluate(() => fetch('/api/auth/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current: 'another-password-99', next: 'test-password-1234' }) }));
  ok(errs.length === 0, 'no page errors ' + errs.join('; '));
  await br.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('ERROR', e.message); process.exit(1); });
