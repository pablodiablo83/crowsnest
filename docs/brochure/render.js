const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('file://' + process.argv[2] + '/brochure.html', { waitUntil: 'networkidle' }); await p.evaluate(() => document.fonts.ready);
  await p.pdf({ path: process.argv[3], format: 'A4', printBackground: true, preferCSSPageSize: true });
  if (process.argv[4]) { await p.setViewportSize({ width: 794, height: 1123 }); const n = await p.$$eval('.pg', x => x.length);
    for (let i = 0; i < n; i++) { const el = (await p.$$('.pg'))[i]; await el.screenshot({ path: process.argv[4] + '/p' + (i + 1) + '.png' }); } }
  await b.close(); })();
