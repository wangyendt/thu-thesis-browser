'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file));

test('Windows icon contains crisp PNG variants from 16 through 256 pixels', () => {
  const ico = read('assets/icon.ico');
  assert.equal(ico.readUInt16LE(0), 0); assert.equal(ico.readUInt16LE(2), 1);
  const sizes = [];
  for (let i=0; i<ico.readUInt16LE(4); i++) {
    const at=6+i*16, width=ico[at] || 256, offset=ico.readUInt32LE(at+12), length=ico.readUInt32LE(at+8);
    const png=ico.subarray(offset,offset+length);
    assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16),width); assert.equal(png.readUInt32BE(20),width); sizes.push(width);
    if(width===256) assert.deepEqual(png,read('assets/icon-256.png'));
  }
  assert.deepEqual(sizes,[16,20,24,32,40,48,64,128,256]);
});
test('large PNG and ICNS are valid and cross-platform icon config stays unified', () => {
  const png=read('assets/icon.png'); assert.equal(png.readUInt32BE(16),1024);
  const icns=read('assets/icon.icns'); assert.equal(icns.subarray(0,4).toString(),'icns'); assert.equal(icns.readUInt32BE(4),icns.length);
  const build=require('../package.json').build;
  assert.equal(build.win.icon,'assets/icon.ico');
  assert.notEqual(build.win.signAndEditExecutable,false,'Turning off resource editing loses the EXE icon');
  assert.equal(build.win.signExecutable,false);
  assert.equal(build.mac.icon,'assets/icon.icns'); assert.equal(build.linux.icon,'assets/icon.png');
  assert.ok(build.files.includes('assets/**/*'));
  assert.ok(read('src/shell.html').toString().includes('src="../assets/icon.svg"'));
});
