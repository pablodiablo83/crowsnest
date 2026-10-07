// LIVE check of /api/inshore against the real Met Office page (run in CI: the sandbox cannot reach it).
// Needs a server on 8091 without INSHORE_URL. Fails if the page can no longer be parsed (layout change).
const B = process.env.BASE || 'http://localhost:8091';
(async () => {
  const r = await fetch(`${B}/api/inshore?lat=55.85&lon=-4.95`), d = await r.json();
  const fail = m => { console.log('FAIL ' + m); process.exit(1); };
  if (!r.ok) fail('inshore: ' + (d.detail || d.error));
  if (d.stale) fail('served stale: ' + d.staleReason);
  console.log(`issued ${d.issued} | ${d.areas.length} areas | nearest ${d.nearest && d.nearest.n} | situation ${d.situation.length} chars`);
  for (const a of d.areas) console.log(`${a.warning ? 'WARN' : 'ok  '} ${a.key.padEnd(3)} ${a.name.slice(0, 60).padEnd(60)} ${a.blocks.map(b => b.title + ':' + b.items.length).join(' | ')}`);
  if (d.areas.length < 19) fail('expected 19+ areas');
  const a14 = d.areas.find(a => a.key === '14');
  if (!a14 || !a14.blocks.length || a14.blocks[0].items.length < 4 || a14.blocks[0].items[0][0] !== 'Wind') fail('area 14 not parsed');
  if (!/\(UTC\)/.test(d.issued)) fail('issue time not parsed');
  console.log('inshore parse OK');
})().catch(e => { console.log('ERROR', e.message); process.exit(1); });
