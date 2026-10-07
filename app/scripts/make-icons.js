// Make every icon from assets/icon.svg (full-bleed app icon) and assets/mark.svg (the binoculars alone):
//   app:  assets/icon-only.png 1024 (no transparency, as the App Store requires), assets/splash*.png 2732 (mark on navy)
//   web:  ../public/assets/icon.png 512 (favicon, home-screen icon, dashboard header), ../public/assets/icon.svg
// Then `capacitor-assets generate --ios` turns the app images into the Xcode asset catalog (npm run icons does both).
const sharp = require('sharp'), fs = require('fs'), path = require('path');
const A = path.join(__dirname, '..', 'assets'), WEB = path.join(__dirname, '..', '..', 'public', 'assets');
const ICON = fs.readFileSync(path.join(A, 'icon.svg')), MARK = fs.readFileSync(path.join(A, 'mark.svg'));
const SPLASH_BG = '#00154C';
const render = (svg, size) => sharp(svg, { density: Math.ceil(72 * size / 1024) + 1 }).resize(size, size).flatten({ background: SPLASH_BG }).png();
async function splash(size, frac) {
  const w = Math.round(size * frac);
  const art = await sharp(MARK, { density: Math.ceil(72 * w / 1024) + 1 }).resize({ width: w }).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: SPLASH_BG } }).composite([{ input: art, gravity: 'centre' }]).flatten({ background: SPLASH_BG }).png();
}
(async () => {
  await render(ICON, 1024).toFile(path.join(A, 'icon-only.png'));
  await (await splash(2732, 0.32)).toFile(path.join(A, 'splash.png'));
  await (await splash(2732, 0.32)).toFile(path.join(A, 'splash-dark.png'));
  await render(ICON, 512).toFile(path.join(WEB, 'icon.png'));
  fs.copyFileSync(path.join(A, 'icon.svg'), path.join(WEB, 'icon.svg'));
  console.log('assets/icon-only.png, splash.png, splash-dark.png; public/assets/icon.png, icon.svg');
})().catch(e => { console.error(e); process.exit(1); });
