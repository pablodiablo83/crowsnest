const { chromium } = require('playwright');
const B = 'http://localhost:8091', OUT = process.argv[2];
const jobs = [
  ['dash2', 'index', 560], ['hor2', 'hours-of-rest', 1330], ['track2', 'track', 760], ['tides2', 'tides', 900], ['wind2', 'wind', 1350],
  ['track', 'track', 0], ['connect', 'connect', 0], ['pack', 'passage', 'doc']
];
(async () => {
  const SID = await require('/home/user/crowsnest/tests/lib/session.js')(B);
  const br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addCookies([{ name: 'cn_sid', value: SID, url: B }]);
  await ctx.addInitScript(() => { try { localStorage.setItem('cn_fix', JSON.stringify({ lat: 55.68, lon: -5.745, ts: Date.now(), source: 'gps' })); } catch (e) {} window.print = () => {}; });
  await ctx.route('**/api/weather**', r => r.fulfill({ json: { source: 'demo', fetchedAt: new Date().toISOString(), temperatureC: 9.4, weatherCode: 3, windSpeedKn: 14, windDirectionDeg: 225, windGustsKn: 21 } }));
  for (const [name, p, y] of jobs) {
    const page = await ctx.newPage();
    await page.goto(B + '/' + p + '.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(p === 'passage' || p === 'tides' ? 9000 : 3000);
    await page.addStyleTag({ content: '#cErr{display:none!important}' });
    await page.evaluate(() => { document.querySelectorAll('div').forEach(d => { if (/^No map tiles/.test(d.textContent) && d.children.length === 0) d.style.display = 'none'; }); });
    if (y === 'doc') { await page.setViewportSize({ width: 718, height: 1000 }); await page.emulateMedia({ media: 'print' }); await page.waitForTimeout(800); await page.locator('#doc').screenshot({ path: `${OUT}/${name}.png` }); }
    else { await page.evaluate(v => window.scrollTo(0, v), y); await page.waitForTimeout(500); await page.screenshot({ path: `${OUT}/${name}.png` }); }
    console.log(name); await page.close();
  }
  await br.close();
})();
