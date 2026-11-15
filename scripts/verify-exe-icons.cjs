'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const resedit = require('resedit');
const root = path.resolve(__dirname, '..');
const digest = bin => crypto.createHash('sha256').update(Buffer.from(bin)).digest('hex');
const ico = resedit.Data.IconFile.from(fs.readFileSync(path.join(root,'assets','icon.ico')));
const expected = new Set(ico.icons.map(i=>digest(i.data.bin)));
const version = require('../package.json').version;
for (const relative of ['release/win-unpacked/Thesis Browser.exe', `release/ThesisBrowser-${version}-win-x64.exe`]) {
  const exe = resedit.NtExecutable.from(fs.readFileSync(path.join(root,relative)));
  const resources = resedit.NtExecutableResource.from(exe);
  const groups = resedit.Resource.IconGroupEntry.fromEntries(resources.entries);
  const matching = groups.find(group => {
    const images=group.getIconItemsFromEntries(resources.entries);
    return images.length === expected.size && images.every(image=>image.isRaw() && expected.has(digest(image.bin)));
  });
  assert.ok(matching,`EXE must embed the SAME multi-size icon: ${relative}`);
  console.log(`PASS: ${relative} embeds all ${expected.size} matching icon sizes`);
}
