'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { isTrustedShellSender } = require('../src/ipc-trust.cjs');
const shellFile = path.join(os.tmpdir(), 'ADMINI~1', 'portable', 'resources', 'app.asar', 'src', 'shell.html');
const encoded = pathToFileURL(shellFile).href.replace(/~/g, '%7E');
function event(url) { const frame = { url }; const sender = { mainFrame: frame }; return { event: { sender, senderFrame: frame }, sender }; }

test('portable Windows ~ and %7E forms refer to the SAME trusted local shell', () => {
  for (const url of [encoded, encoded.replace(/%7E/gi, '~')]) {
    const e = event(url); assert.equal(isTrustedShellSender(e.event, e.sender, shellFile), true);
  }
});
test('rejects remote origins, another local file, query/hash and encoded path tricks', () => {
  for (const url of ['https://newetds.lib.tsinghua.edu.cn/', pathToFileURL(path.join(os.tmpdir(), 'other.html')).href, `${encoded}?evil=1`, `${encoded}#evil`, encoded.replace('/src/', '/src%2F')]) {
    const e = event(url); assert.equal(isTrustedShellSender(e.event, e.sender, shellFile), false);
  }
});
test('requires the exact local webContents AND its main frame, not just a matching URL', () => {
  const e = event(encoded);
  assert.equal(isTrustedShellSender({ ...e.event, sender: {} }, e.sender, shellFile), false);
  assert.equal(isTrustedShellSender({ ...e.event, senderFrame: { url: encoded } }, e.sender, shellFile), false);
});
