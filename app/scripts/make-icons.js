// Make the source images for the app icon and splash (assets/icon-only.png 1024, assets/splash*.png 2732) from assets/icon.svg.
// Then `capacitor-assets generate --ios` turns them into the Xcode asset catalog (npm run icons does both).
const sharp = require('sharp'), fs = require('fs'), path = require('path');
const SVG = path.join(__dirname, '..', 'assets', 'icon.svg'), OUT = path.join(__dirname, '..', 'assets');
const ICON_BG = '#FFFFFF', SPLASH_BG = '#00154C';
async function tile(size, bg, frac) {
  const w = Math.round(size * frac);
  const art = await sharp(fs.readFileSync(SVG), { density: 300 }).resize({ width: w }).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: bg } })
    .composite([{ input: art, gravity: 'centre' }]).flatten({ background: bg }).png();
}
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await (await tile(1024, ICON_BG, 0.86)).toFile(path.join(OUT, 'icon-only.png'));
  await (await tile(2732, SPLASH_BG, 0.3)).toFile(path.join(OUT, 'splash.png'));
  await (await tile(2732, SPLASH_BG, 0.3)).toFile(path.join(OUT, 'splash-dark.png'));
  console.log('assets/icon-only.png, splash.png, splash-dark.png');
})().catch(e => { console.error(e); process.exit(1); });
