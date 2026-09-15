const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const build = path.join(root, 'build');
const iconsDir = path.join(build, 'icons');
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

app.commandLine.appendSwitch('force-device-scale-factor', '1');

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(build, 'icon.svg'), 'utf8');
  const html = `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}</style>
</head><body>${svg}</body></html>`;

  const win = new BrowserWindow({
    width: 1024, height: 1024, show: false, frame: false,
    transparent: true, backgroundColor: '#00000000', useContentSize: true
  });

  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise(r => setTimeout(r, 400));

  const image = await win.webContents.capturePage();
  fs.mkdirSync(iconsDir, { recursive: true });

  for (const n of SIZES) {
    const resized = n === 1024 ? image : image.resize({ width: n, height: n, quality: 'best' });
    fs.writeFileSync(path.join(iconsDir, `${n}x${n}.png`), resized.toPNG());
  }
  fs.writeFileSync(path.join(build, 'icon.png'), image.toPNG());

  console.log(`make-icons: ${SIZES.length} tamaños en build/icons + build/icon.png`);
  app.quit();
});
