// Every local file that server.js (and the modules it loads) requires must be copied into the image by the Dockerfile,
// else the container crashes at start and deploy rolls back (25 Nov 2026: ice.js and blackbox.js were missing).
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'); let fails = 0;
const docker = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
const copied = new Set(); for (const m of docker.matchAll(/^COPY\s+(.+?)\s+\.\/?(\S*)\s*$/gm)) for (const f of m[1].split(/\s+/)) copied.add(f.replace(/^\.\//, ''));
const seen = new Set(), todo = ['server.js'];
while (todo.length) {
  const f = todo.pop(); if (seen.has(f)) continue; seen.add(f);
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const m of src.matchAll(/require\(\s*'(\.{1,2}\/[^']+)'\s*\)/g)) {
    let rel = path.normalize(path.join(path.dirname(f), m[1])); if (!/\.\w+$/.test(rel)) rel += '.js';
    if (!fs.existsSync(path.join(ROOT, rel))) continue;
    const ok = copied.has(rel) || [...copied].some(c => !/\.\w+$/.test(c) && rel.startsWith(c + '/'));
    console.log((ok ? 'PASS ' : 'FAIL ') + f + ' requires ' + rel + (ok ? '' : ' - NOT COPIED by the Dockerfile')); if (!ok) fails++;
    todo.push(rel);
  }
}
process.exit(fails ? 1 : 0);
