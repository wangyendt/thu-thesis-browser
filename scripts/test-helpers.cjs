'use strict';
const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'test-output');
fs.mkdirSync(OUTPUT, { recursive: true });

async function launch(profile) {
  const env = { ...process.env, THESIS_BROWSER_TEST_DATA: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  const application = await electron.launch({
    executablePath: process.env.THESIS_BROWSER_EXECUTABLE || require('electron'),
    args: [...(process.env.THESIS_BROWSER_EXECUTABLE ? [] : [ROOT]), `--user-data-dir=${profile}`], env, timeout: 45000
  });
  try {
    // WebContentsView may appear as the first Playwright target; choose the local shell.
    const window = await waitFor(() => application.windows().find(page => page.url().startsWith('file:') && page.url().endsWith('/shell.html')), 30000);
    await window.waitForFunction(() => !!window.browser);
    return { application, window };
  } catch (error) { await application.close(); throw error; }
}
async function remote(application, script, index = 0) {
  return application.evaluate(async ({ webContents }, { script, index }) => {
    const pages = webContents.getAllWebContents().filter(wc => !wc.isDestroyed() && wc.getURL().startsWith('https://newetds.lib.tsinghua.edu.cn/')).sort((a, b) => a.id - b.id);
    if (!pages[index]) throw new Error('找不到论文网页');
    return Promise.race([pages[index].executeJavaScript(script), new Promise((_, reject) => setTimeout(() => reject(new Error('remote evaluation timeout')), 5000))]);
  }, { script, index });
}
async function waitFor(predicate, timeout = 30000) {
  const start = Date.now(); let last;
  while (Date.now() - start < timeout) {
    try { const value = await predicate(); if (value) return value; } catch (error) { last = error; }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out${last ? `: ${last.message}` : ''}`);
}
async function screenshot(application, filename) {
  const png = await application.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));
  fs.writeFileSync(path.join(OUTPUT, filename), Buffer.from(png, 'base64'));
}
module.exports = { launch, remote, waitFor, screenshot, ROOT, OUTPUT };
