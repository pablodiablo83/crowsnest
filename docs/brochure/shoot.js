const { chromium } = require('playwright');
const B = 'http://localhost:8091', OUT = process.argv[2];
const pages = (process.argv[3] || 'index,hours-of-rest,track,tides,wind,passage,atlantic,connect').split(',');
(async () => {
  const SID = await require('/home/user/crowsnest/tests/lib/session.js')(B);
  const br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addCookies([{ name: 'cn_sid', value: SID, url: B }]);
  await ctx.addInitScript(() => { try { localStorage.setItem('cn_fix', JSON.stringify({ lat: 55.68, lon: -5.745, ts: Date.now(), source: 'gps' })); } catch (e) {} window.print = () => {}; });
  await ctx.route('**/api/weather**', r => r.fulfill({ json: { source: 'demo', fetchedAt: new Date().toISOString(), temperatureC: 9.4, weatherCode: 3, windSpeedKn: 14, windDirectionDeg: 225, windGustsKn: 21 } }));
  for (const p of pages) {
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto(B + '/' + p + '.html', { waitUntil: 'networkidle' }).catch(e => errs.push(String(e)));
    await page.waitForTimeout(p === 'passage' || p === 'tides' ? 9000 : 3000);
    await page.screenshot({ path: `${OUT}/${p}.png` });
    await page.screenshot({ path: `${OUT}/${p}-full.png`, fullPage: true });
    console.log(p, errs.slice(0, 2).join(' | '));
    await page.close();
  }
  await br.close();
})();
