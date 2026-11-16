'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { launch, remote, waitFor, OUTPUT } = require('./test-helpers.cjs');

(async () => {
  const { application, window } = await launch(path.join(OUTPUT, `tab-lifecycle-${Date.now()}`));
  try {
    await application.evaluate(async ({ session }) => {
      // Report main-process errors as test failures instead of blocking on an OS dialog.
      process.removeAllListeners('uncaughtException');
      globalThis.__lifecycleErrors = [];
      process.on('uncaughtException', error => globalThis.__lifecycleErrors.push(error.stack));
      process.on('unhandledRejection', error => globalThis.__lifecycleErrors.push(String(error?.stack || error)));
      await session.fromPartition('persist:thesis-browser').protocol.handle('https', () => new Response(
        '<!doctype html><title>Lifecycle fixture</title><a id="popup" target="_blank" href="/popup">Open</a>',
        { headers: { 'Content-Type': 'text/html' } }
      ));
    });
    await window.evaluate(() => window.browser.command('reload'));
    await waitFor(() => remote(application, "document.title === 'Lifecycle fixture'"));
    await remote(application, "document.getElementById('popup').click()");
    await waitFor(() => window.locator('.tab').count().then(count => count === 2));
    await waitFor(() => remote(application, "document.readyState === 'complete'", 1));

    const result = await application.evaluate(async ({ webContents, Menu }) => {
      const popup = webContents.getAllWebContents().filter(wc => wc.getURL().includes('/popup')).at(-1);
      const events = [];
      popup.on('close', () => events.push('close'));
      // Closing an opener destroys its popup WITHOUT emitting `close`.
      // The next new-tab action must not traverse a stale tab record.
      return new Promise(resolve => {
        popup.once('destroyed', () => {
          events.push('destroyed');
          let error;
          try { Menu.getApplicationMenu().items.find(item => item.label === '文件').submenu.items[0].click(); }
          catch (caught) { error = caught.stack; }
          setTimeout(() => resolve({ error, errors: globalThis.__lifecycleErrors, events }), 200);
        });
        const opener = webContents.getAllWebContents().filter(wc => wc.getURL().includes('/qh/')).at(0);
        opener.close();
      });
    });
    assert.deepEqual(result.events, ['destroyed'], 'Exercise destruction without the close event');
    assert.equal(result.error, undefined, 'Opening a tab after popup destruction must not read getURL on missing webContents');
    assert.deepEqual(result.errors, [], 'No asynchronous main-process errors');
    const state = await window.evaluate(() => window.browser.command('state'));
    assert.equal(state.ok, true);
    console.log('PASS: destroyed popup -> immediate new tab -> state update without getURL crash');

    const nativeViews = () => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.length);
    await waitFor(async () => await window.locator('.tab').count() === await nativeViews());
    for (let i = 0; i < 3; i++) {
      const before = await window.locator('.tab').count();
      await window.locator('.new-tab').click();
      await waitFor(() => window.locator('.tab').count().then(count => count === before + 1));
      await window.locator('.tab-title').first().click();
      await window.locator('.tab-close').last().click();
      await waitFor(() => window.locator('.tab').count().then(count => count === before));
    }
    console.log('PASS: toolbar new/select/close actions remain usable; no ghost tabs');

    await remote(application, "document.getElementById('popup').click()");
    await waitFor(() => remote(application, "document.readyState === 'complete'", 2));
    const before = await window.locator('.tab').count();
    // Do not await evaluation in a renderer that is deliberately closing itself.
    await remote(application, 'setTimeout(() => window.close(), 50); undefined;', 2);
    await waitFor(() => window.locator('.tab').count().then(count => count === before - 1));
    while (await window.locator('.tab').count() > 1) await window.locator('.tab-close').last().click();
    await window.locator('.tab-close').click();
    await waitFor(() => window.locator('.tab').count().then(count => count === 1));
    await waitFor(() => remote(application, "document.title === 'Lifecycle fixture'"));
    assert.deepEqual(await application.evaluate(() => globalThis.__lifecycleErrors), []);
    assert.equal(await nativeViews(), 1);
    console.log('PASS: window.close and closing the last tab clean up safely and retain a usable home tab');
  } finally { await application.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
