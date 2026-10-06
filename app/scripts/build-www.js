// Copy the web app (../public) into www/, the folder Capacitor bundles into the iOS app.
// The pages are the same as the web version; public/net.js switches them to the server's /api/v1 inside the app.
const fs = require('fs'), path = require('path');
const SRC = path.join(__dirname, '..', '..', 'public'), OUT = path.join(__dirname, '..', 'www');
const SKIP = new Set(['app.js', 'styles.css', 'geo.html', 'log.html']);   // unused by the current pages
fs.rmSync(OUT, { recursive: true, force: true });
let n = 0;
(function copy(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (from === SRC && SKIP.has(e.name)) continue;
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copy(a, b); else { fs.copyFileSync(a, b); n++; }
  }
})(SRC, OUT);
for (const f of ['index.html', 'hours-of-rest.html', 'track.html', 'connect.html', 'net.js', 'outbox.js']) {
  if (!fs.existsSync(path.join(OUT, f))) { console.error('missing ' + f); process.exit(1); }
}
console.log('www: ' + n + ' files from public/');
