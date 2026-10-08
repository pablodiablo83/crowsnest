// Make every icon from assets/icon.svg (full-bleed app icon) and assets/mark.svg (the binoculars alone):
//   app:  assets/icon-only.png 1024 (no transparency, as the App Store requires), assets/splash*.png 2732 (mark on navy),
//         Android adaptive icon layers: assets/icon-foreground.png (binoculars, inside the 66% safe zone, transparent)
//         and assets/icon-background.png (the navy gradient)
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
  const fgW = Math.round(1024 * 0.9), fg = await sharp(MARK, { density: Math.ceil(72 * fgW / 1024) + 1 }).resize({ width: fgW }).png().toBuffer();
  await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: fg, gravity: 'centre' }]).png().toFile(path.join(A, 'icon-foreground.png'));
  const BG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0E3F8F"/><stop offset="1" stop-color="#00154C"/></linearGradient></defs><rect width="1024" height="1024" fill="url(#g)"/></svg>');
  await sharp(BG).resize(1024, 1024).png().toFile(path.join(A, 'icon-background.png'));
  await render(ICON, 512).toFile(path.join(WEB, 'icon.png'));
  fs.copyFileSync(path.join(A, 'icon.svg'), path.join(WEB, 'icon.svg'));
  console.log('assets/icon-only.png, icon-foreground.png, icon-background.png, splash.png, splash-dark.png; public/assets/icon.png, icon.svg');
})().catch(e => { console.error(e); process.exit(1); });
