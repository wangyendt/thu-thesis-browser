'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { PDF_STATE_SCRIPT, READ_PDF_SCRIPT } = require('../src/pdf-save.cjs');

function environment({ origin = 'https://newetds.lib.tsinghua.edu.cn', pathname = '/pdf/generic/web/viewer.html', bytes = new TextEncoder().encode('%PDF-1.4\nWATERMARK MUST REMAIN\n%%EOF'), ready = true, title = 'Test: paper' } = {}) {
  const saved = []; const links = [];
  const context = vm.createContext({
    location: { origin, pathname }, Uint8Array, TextDecoder,
    Blob: class { constructor(parts, options) { saved.push({ parts, options }); } },
    URL: { createObjectURL: () => 'blob:https://newetds.lib.tsinghua.edu.cn/local-test', revokeObjectURL() {} },
    setTimeout: () => 1, clearTimeout() {},
    fetch: () => { throw new Error('Export must not fetch a new signed URL'); },
    document: { body: { append() {} }, createElement: () => { const link = { click() { links.push(this); }, remove() {} }; return link; } },
    PDFViewerApplication: { pdfDocument: ready ? { numPages: 153, getData: async () => bytes } : null, documentInfo: { Title: title } }
  });
  vm.runInContext('window=globalThis', context);
  return { saved, links, context, run: script => vm.runInContext(script, context) };
}

test('only the exact official loaded PDF viewer is eligible for Save PDF', () => {
  const valid = environment();
  assert.equal(valid.run(PDF_STATE_SCRIPT).ready, true);
  for (const options of [{ ready: false }, { pathname: '/qh/cjjs' }, { origin: 'https://evil.test' }]) {
    assert.equal(environment(options).run(PDF_STATE_SCRIPT).ready, false);
  }
});
test('saves the exact existing bytes, preserves watermark and sanitizes filename', async () => {
  const bytes = new TextEncoder().encode('%PDF-1.4\nWATERMARK MUST REMAIN\n%%EOF');
  const env = environment({ bytes, title: 'Unsafe: title/name?' });
  const result = await env.run(READ_PDF_SCRIPT);
  assert.equal(result.filename, 'Unsafe_ title_name_.pdf');
  assert.equal(result.bytes, bytes);
  assert.equal(env.links.length, 0, 'Must not rely on a browser anchor/blob download');
});
test('does not export an HTML login/error response as PDF', async () => {
  const env = environment({ bytes: new TextEncoder().encode('<html>Session expired</html>') });
  await assert.rejects(env.run(READ_PDF_SCRIPT), /有效 PDF/);
  assert.equal(env.saved.length, 0); assert.equal(env.links.length, 0);
});
test('blocks unloaded documents and non-viewer origins', async () => {
  for (const options of [{ ready: false }, { pathname: '/qh/cjjs' }, { origin: 'https://id.tsinghua.edu.cn' }]) {
    const env = environment(options);
    await assert.rejects(env.run(READ_PDF_SCRIPT));
    assert.equal(env.links.length, 0);
  }
});
test('does not silently fall back to requesting a different PDF after getData fails', async () => {
  const env = environment();
  env.context.PDFViewerApplication.pdfDocument.getData = async () => { throw new Error('Session expired'); };
  await assert.rejects(env.run(READ_PDF_SCRIPT), /Session expired/);
  assert.equal(env.links.length, 0);
});
test('rejects export if the current document changes during asynchronous loading', async () => {
  const env = environment();
  env.context.PDFViewerApplication.pdfDocument.getData = async () => {
    env.context.PDFViewerApplication.pdfDocument = null;
    return new TextEncoder().encode('%PDF-1.4\nOLD DOCUMENT');
  };
  await assert.rejects(env.run(READ_PDF_SCRIPT), /文档已切换/);
  assert.equal(env.links.length, 0);
});
