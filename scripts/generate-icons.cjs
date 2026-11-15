'use strict';
// Render our vector master with Electron's SVG renderer; no image service or extra library.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), [__filename], { env, stdio: 'inherit' });
  process.exit(result.status || 0);
}

const { app, BrowserWindow, nativeImage } = require('electron');
app.disableHardwareAcceleration();
app.setPath('userData', path.join(root, 'test-output', 'icon-render-profile'));
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1024, height: 1024, useContentSize: true,
    show: false, frame: false, transparent: true, backgroundColor: '#00000000',
    webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false } });
  try {
    const svg = fs.readFileSync(path.join(root, 'assets', 'icon.svg'), 'utf8');
    await window.loadURL('data:text/html;charset=utf-8,<meta charset="utf-8"><title>Icon renderer</title>');
    const pngURL = await window.webContents.executeJavaScript(`(async(svg)=>{
      const image = new Image(); image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      await image.decode(); const canvas = document.createElement('canvas'); canvas.width=1024;canvas.height=1024;
      canvas.getContext('2d').drawImage(image,0,0,1024,1024); return canvas.toDataURL('image/png');
    })(${JSON.stringify(svg)})`);
    const original = nativeImage.createFromDataURL(pngURL);
    if (original.isEmpty()) throw new Error('SVG renderer returned an empty bitmap');
    const image = original.resize({ width: 1024, height: 1024, quality: 'best' });
    const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
    const pngs = new Map();
    for (const size of [...sizes, 512, 1024]) {
      const png = image.resize({ width: size, height: size, quality: 'best' }).toPNG();
      if (png.length < 100) throw new Error(`Invalid ${size}px icon`);
      pngs.set(size, png);
    }
    fs.writeFileSync(path.join(root, 'assets', 'icon.png'), pngs.get(1024));
    fs.writeFileSync(path.join(root, 'assets', 'icon-256.png'), pngs.get(256));

    // ICO: retain all small sizes, not just one scaled 256px image.
    const header = Buffer.alloc(6 + sizes.length * 16);
    header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
    let offset = header.length;
    sizes.forEach((size, i) => {
      const base = 6 + i * 16, png = pngs.get(size);
      header[base] = size === 256 ? 0 : size; header[base + 1] = size === 256 ? 0 : size;
      header.writeUInt16LE(1, base + 4); header.writeUInt16LE(32, base + 6);
      header.writeUInt32LE(png.length, base + 8); header.writeUInt32LE(offset, base + 12); offset += png.length;
    });
    fs.writeFileSync(path.join(root, 'assets', 'icon.ico'), Buffer.concat([header, ...sizes.map(size => pngs.get(size))]));

    const chunks = [[16,'icp4'],[32,'icp5'],[64,'icp6'],[128,'ic07'],[256,'ic08'],[512,'ic09'],[1024,'ic10']].map(([size, type]) => {
      const png = pngs.get(size), chunk = Buffer.alloc(8); chunk.write(type); chunk.writeUInt32BE(png.length + 8, 4); return Buffer.concat([chunk, png]);
    });
    const icns = Buffer.alloc(8); icns.write('icns'); icns.writeUInt32BE(8 + chunks.reduce((n,c)=>n+c.length,0),4);
    fs.writeFileSync(path.join(root, 'assets', 'icon.icns'), Buffer.concat([icns, ...chunks]));
    console.log('Generated PNG, multi-resolution ICO, and ICNS from assets/icon.svg');
  } finally { window.destroy(); app.quit(); }
}).catch(error => { console.error(error); app.exit(1); });
