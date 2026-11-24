// Dashboard assistant bar in a browser: reply text, Do it / Cancel buttons, Undo, no server text in innerHTML.
// Fresh server on 8091 (fakes optional). Usage: node tests/pw-assistant.js [screenshot dir]
const { chromium } = require('playwright');
const B = process.env.BASE || 'http://localhost:8091', OUT = process.argv[2] || '/tmp';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const sid = await require('./lib/session')(B);
  const J = (m, p, b) => fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b && JSON.stringify(b) }).then(r => r.json());
  const crew = await J('POST', '/api/crew', { name: 'UI Crew' });
  await J('POST', `/api/crew/${crew.id}/voyages`, { start: new Date(Date.now() - 30 * 3600e3).toISOString(), declaration: { rested: 'yes', ackRecords: true, ackEmergency: true, under18: false, declaredBy: 'seafarer' } });
  const br = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 } }); await ctx.addCookies([{ name: 'cn_sid', value: sid, url: B }]);
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(B + '/');
  const ask = async t => { await pg.fill('#agentInput', t); await pg.press('#agentInput', 'Enter'); await pg.waitForFunction(() => document.getElementById('agentReply').textContent.length > 1 && document.getElementById('agentReply').textContent !== '…', null, { timeout: 15000 }); await pg.waitForTimeout(150); };
  await ask('help'); ok(/Record a work pattern/.test(await pg.locator('#agentReply').innerText()), 'help shown in the bar');
  await ask('record 4 hours on 4 hours off for the last 24 hours');
  ok(await pg.locator('.dagent-act.confirm').count() === 1 && await pg.locator('.dagent-act.cancel').count() === 1, 'plan shows Do it and Cancel');
  await pg.screenshot({ path: OUT + '/assistant-plan.png' });
  await pg.click('.dagent-act.confirm'); await pg.waitForFunction(() => /Done: 6 changes/.test(document.getElementById('agentReply').textContent), null, { timeout: 15000 });
  ok(await pg.locator('.dagent-act.undo').count() === 1, 'Done, with Undo');
  await pg.screenshot({ path: OUT + '/assistant-done.png' });
  await pg.click('.dagent-act.undo'); await pg.waitForFunction(() => /Undone/.test(document.getElementById('agentReply').textContent), null, { timeout: 15000 });
  ok((await J('GET', `/api/crew/${crew.id}/entries`)).length === 0, 'Undo removed the 6 entries');
  await ask('delete my last entry'); ok(/no entries/.test(await pg.locator('#agentReply').innerText()), 'nothing to delete: said plainly');
  await ask('open the wind page'); await pg.waitForURL(/wind\.html/, { timeout: 5000 }); ok(true, 'open: navigates to the page');
  await pg.goto(B + '/'); await ask('<img src=x onerror=alert(1)> working'); ok(await pg.locator('#agentReply img').count() === 0, 'server text is never treated as HTML');
  ok(await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'fits a phone');
  ok(errs.length === 0, 'no page errors ' + errs.join('|'));
  await br.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL ' + e.stack); process.exit(1); });
