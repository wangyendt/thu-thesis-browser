'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launch, remote, waitFor, OUTPUT } = require('./test-helpers.cjs');

function fixturePDF() {
  const content = 'BT /F1 16 Tf 50 740 Td (AUTHORIZED PREVIEW - WATERMARK MUST REMAIN) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
  let text = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(text)); text += `${i+1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(text);
  text += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(text);
}

(async () => {
  const { application, window } = await launch(path.join(OUTPUT, `pdf-profile-${Date.now()}`));
  const savedFile = path.join(OUTPUT, `saved-viewer-${Date.now()}.pdf`);
  const data = fixturePDF();
  const viewerIndex = process.argv.includes('--popup') ? 1 : 0;
  const viewerRemote = script => remote(application, script, viewerIndex);
  try {
    await application.evaluate(async ({ session, net, dialog, webContents }, { pdf, savedFile, realViewer, nativeDialog, staleReady, cancel }) => {
      const ses = session.fromPartition('persist:thesis-browser');
      globalThis.__fixturePDF = Buffer.from(pdf, 'base64');
      globalThis.__saveDialogCalls = [];
      const originalDialog = dialog.showSaveDialog.bind(dialog);
      dialog.showSaveDialog = async (parent, options) => {
        const viewer = webContents.getAllWebContents().find(wc => wc.getURL().includes('/pdf/generic/web/viewer.html'));
        const readAlreadyStarted = await viewer.executeJavaScript('!!window.__getDataCalled');
        globalThis.__saveDialogCalls.push({ hasParent: !!parent, readAlreadyStarted, hasPDFExtension: options.filters.some(f => f.extensions.includes('pdf')) });
        if (nativeDialog) return originalDialog(parent, { ...options, defaultPath: savedFile });
        if (cancel) return { canceled: true };
        if (staleReady) await viewer.executeJavaScript('window.PDFViewerApplication = window.__preservedViewer; undefined;');
        return { canceled: false, filePath: savedFile };
      };
      ses.on('will-download', (_event, item) => item.setSavePath(savedFile));
      await ses.protocol.handle('https', async request => {
        const url = new URL(request.url);
        if (url.pathname === '/__thesis_browser_fixture.pdf') return new Response(globalThis.__fixturePDF, { headers: { 'Content-Type': 'application/pdf' } });
        if (realViewer) return net.fetch(request, { bypassCustomProtocolHandlers: true });
        return new Response(`<!doctype html><meta charset="utf-8"><title>Loaded PDF preview</title>
          <button id="downloadButton" style="display:none">Save</button><canvas id="viewer"></canvas>
          <script>window.PDFViewerApplication={pdfDocument:{numPages:1, getData:async()=>new Uint8Array(${JSON.stringify([...globalThis.__fixturePDF])})},documentInfo:{Title:'Watermarked test preview'},_docFilename:'fixture.pdf'};</script>`, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
      });
    }, { pdf: data.toString('base64'), savedFile, realViewer: process.argv.includes('--real-viewer'), nativeDialog: process.argv.includes('--native-dialog'), staleReady: process.argv.includes('--stale-ready'), cancel: process.argv.includes('--cancel') });
    if (viewerIndex) {
      await waitFor(() => remote(application, "document.readyState === 'complete'"));
      await remote(application, "window.open('https://newetds.lib.tsinghua.edu.cn/pdf/generic/web/viewer.html?file=%2F__thesis_browser_fixture.pdf'); undefined;");
    } else await window.evaluate(() => window.browser.command('navigate', 'https://newetds.lib.tsinghua.edu.cn/pdf/generic/web/viewer.html?file=%2F__thesis_browser_fixture.pdf'));
    await waitFor(() => viewerRemote('!!window.PDFViewerApplication?.pdfDocument?.numPages'), 45000);
    assert.equal(await viewerRemote("getComputedStyle(document.getElementById('downloadButton')).display"), 'none');
    // This is the regression: saving a loaded PDF must work even when the site hides its Save UI.
    await window.locator('#save-pdf').waitFor({ timeout: 2500 });
    await waitFor(() => window.locator('#save-pdf').isEnabled());
    await viewerRemote(`(() => { const pdf=window.PDFViewerApplication.pdfDocument; const original=pdf.getData.bind(pdf); pdf.getData=()=>{window.__getDataCalled=true;return original();}; })()`);
    if (process.argv.includes('--stale-ready')) {
      await viewerRemote('window.__preservedViewer = window.PDFViewerApplication; window.PDFViewerApplication = {pdfDocument:null};');
      await new Promise(resolve => setTimeout(resolve, 1200));
      assert.equal(await window.locator('#save-pdf').isEnabled(), true, 'A stale readiness probe must not lock out the Save As dialog');
    }
    await window.locator('#save-pdf').click();
    await waitFor(() => application.evaluate(() => globalThis.__saveDialogCalls.length > 0), 1500);
    const dialogCall = await application.evaluate(() => globalThis.__saveDialogCalls[0]);
    assert.equal(dialogCall.hasParent, true);
    assert.equal(dialogCall.readAlreadyStarted, false, 'Save dialog must open before any potentially slow PDF data read');
    assert.equal(dialogCall.hasPDFExtension, true);
    console.log('PASS: explicit parented Save As dialog appears BEFORE reading PDF bytes');
    if (process.argv.includes('--cancel')) {
      await waitFor(() => window.locator('#status').innerText().then(t => t.includes('已取消')));
      assert.equal(await viewerRemote('!!window.__getDataCalled'), false);
      assert.equal(fs.existsSync(savedFile), false);
      console.log('PASS: canceling the dialog does not read PDF data or create a file');
      return;
    }
    if (process.argv.includes('--native-dialog')) console.log('NATIVE DIALOG OPEN: choose Save to complete visual verification.');
    await waitFor(() => fs.existsSync(savedFile) && fs.statSync(savedFile).size === data.length, process.argv.includes('--native-dialog') ? 120000 : 30000);
    assert.deepEqual(fs.readFileSync(savedFile), data, 'Saved PDF must be byte-for-byte identical, including the watermark');
    await window.locator('#download-list').getByText(/下载完成/).waitFor();
    console.log(`PASS: ${viewerIndex ? 'popup tab -> ' : ''}${process.argv.includes('--real-viewer') ? 'actual official PDF.js viewer' : 'loaded PDF preview'} -> Save As -> byte-identical PDF with watermark`);
    // Switching away must not export a stale document from a different tab/page.
    await window.evaluate(() => window.browser.command('navigate', 'https://newetds.lib.tsinghua.edu.cn/qh/cjjs'));
    await waitFor(() => window.locator('#save-pdf').isDisabled());
    console.log('PASS: Save PDF disabled outside a loaded PDF preview');
  } finally { await application.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
