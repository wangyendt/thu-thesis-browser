'use strict';

const { app, BrowserWindow, WebContentsView, ipcMain, session, shell, dialog, Menu, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { isTrustedShellSender } = require('./ipc-trust.cjs');
const { HOME, SITE, isInternalURL, isSiteURL, isExternalURL, normalizeSearch } = require('./policy.cjs');
const { PATCH_SCRIPT, quickSearchScript } = require('./site-patch.cjs');
const { PDF_STATE_SCRIPT, READ_PDF_SCRIPT } = require('./pdf-save.cjs');
const { isSummaryURL, buildPaperFilename, READ_METADATA_SCRIPT } = require('./paper-metadata.cjs');

app.setName('Thesis Browser');
if (process.platform === 'win32') app.setAppUserModelId('local.thu.thesisbrowser');
// Only used by local automated tests; production always uses the OS application-data directory.
const profilePath = app.commandLine.getSwitchValue('user-data-dir');
if (profilePath && path.isAbsolute(profilePath)) app.setPath('userData', profilePath);
else if (!app.isPackaged && process.env.THESIS_BROWSER_TEST_DATA) app.setPath('userData', process.env.THESIS_BROWSER_TEST_DATA);
const SHELL_FILE = path.join(__dirname, 'shell.html');
const PARTITION = 'persist:thesis-browser';
const HEADER = 150;
const FOOTER = 28;
let mainWindow, siteSession, activeId, settings, exitConfirmed = false;
const tabs = new Map();
const downloads = new Map();
let nextTabId = 1, nextDownloadId = 1, panel = '', statusMessage = '';

function readSettings() {
  try { return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8')); }
  catch { return {}; }
}
function saveSettings() {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(path.join(app.getPath('userData'), 'settings.json'), JSON.stringify(settings, null, 2));
}
function active() { return tabs.get(activeId); }
function sendState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const list = [...tabs.values()].map(t => ({
    id: t.id, title: t.title, url: t.view.webContents.getURL(), loading: t.loading,
    patched: t.patched, error: t.error, active: t.id === activeId, pdf: t.pdf, saving: t.saving, savePhase: t.savePhase,
    back: t.view.webContents.navigationHistory.canGoBack(), forward: t.view.webContents.navigationHistory.canGoForward()
  }));
  mainWindow.webContents.send('browser:state', {
    tabs: list, downloads: [...downloads.values()].map(d => ({ ...d, item: undefined })),
    downloadDirectory: settings.downloadDirectory || app.getPath('downloads'),
    search: settings.search || { student: '2022', discipline: '工程管理', title: '', exact: true },
    panel, message: statusMessage, version: app.getVersion()
  });
}
function message(text) { statusMessage = text; sendState(); }
function confirmExit(event) {
  if (!exitConfirmed && [...downloads.values()].some(d => d.item && d.state === 'progressing') && mainWindow) {
    const answer = dialog.showMessageBoxSync(mainWindow, { type: 'question', buttons: ['继续下载', '退出'], defaultId: 0, cancelId: 0, message: '仍有下载任务，确定退出吗？' });
    if (answer === 0) event.preventDefault(); else exitConfirmed = true;
  }
}
function layout() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const [width, height] = mainWindow.getContentSize();
  for (const tab of tabs.values()) {
    tab.view.setVisible(tab.id === activeId);
    tab.view.setBounds({ x: 0, y: HEADER, width: Math.max(200, width - (panel ? 360 : 0)), height: Math.max(100, height - HEADER - FOOTER) });
  }
}
function selectTab(id) {
  if (!tabs.has(id)) return;
  activeId = id; layout(); sendState(); void inspectPDF(tabs.get(id));
}
async function inspectPDF(tab) {
  if (!tab || tab.inspecting || tab.view.webContents.isDestroyed()) return;
  const wc = tab.view.webContents;
  if (!isSiteURL(wc.getURL()) || new URL(wc.getURL()).pathname !== '/pdf/generic/web/viewer.html') {
    if (tab.pdf?.isViewer) { tab.pdf = { isViewer: false, ready: false, pages: 0 }; sendState(); }
    return;
  }
  if (wc.isLoadingMainFrame()) return;
  tab.inspecting = true;
  const sourceURL = wc.getURL();
  try {
    const pdf = await wc.executeJavaScript(PDF_STATE_SCRIPT);
    if (wc.isDestroyed() || wc.getURL() !== sourceURL) return;
    pdf.filename = buildPaperFilename(tab.paper || pdf.metadata, pdf.filename);
    if (JSON.stringify(pdf) !== JSON.stringify(tab.pdf)) { tab.pdf = pdf; sendState(); }
  } catch { /* A navigation may destroy the inspected document. */ }
  finally { tab.inspecting = false; }
}
async function saveCurrentPDF(tab) {
  if (!tab || tab.saving) return;
  const wc = tab.view.webContents;
  if (!isSiteURL(wc.getURL()) || new URL(wc.getURL()).pathname !== '/pdf/generic/web/viewer.html') throw new Error('请先打开论文的 PDF 预览标签页');
  const sourceURL = wc.getURL();
  tab.saving = true; tab.savePhase = '选择保存位置…';
  message('请选择 PDF 保存位置；选择后再读取文档。');
  let timer, temporaryPath, entry;
  try {
    // Explicit, parented OS dialog BEFORE any renderer evaluation or PDF read.
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '保存当前 PDF（保留原有水印）', buttonLabel: '保存 PDF',
      defaultPath: path.join(settings.downloadDirectory || app.getPath('downloads'), buildPaperFilename(tab.paper || tab.pdf?.metadata, tab.pdf?.filename || '论文.pdf')),
      filters: [{ name: 'PDF 文档', extensions: ['pdf'] }],
      properties: ['showOverwriteConfirmation', 'createDirectory']
    });
    if (result.canceled || !result.filePath) { message('已取消保存 PDF。'); return; }
    if (wc.isDestroyed() || wc.getURL() !== sourceURL) throw new Error('预览文档已切换，请重新保存当前论文');
    const destination = /\.pdf$/i.test(result.filePath) ? result.filePath : `${result.filePath}.pdf`;
    entry = { id: nextDownloadId++, filename: path.basename(destination), state: 'preparing', received: 0, total: 0, path: destination, item: null };
    downloads.set(entry.id, entry); panel = 'downloads'; layout();
    tab.savePhase = '正在读取 PDF…';
    message('正在读取完整 PDF；首页显示不代表全文已加载，原有水印会保留…');
    const resultData = await Promise.race([
      wc.executeJavaScript(READ_PDF_SCRIPT, true),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('读取 PDF 超时，请确认网络正常后重试')), 100000); })
    ]);
    clearTimeout(timer);
    if (wc.isDestroyed() || wc.getURL() !== sourceURL) throw new Error('预览文档已切换，已停止保存');
    if (!(resultData?.bytes instanceof Uint8Array)) throw new Error('预览器没有返回 PDF 字节，请重新打开论文预览后重试');
    const data = Buffer.from(resultData.bytes.buffer, resultData.bytes.byteOffset, resultData.bytes.byteLength);
    if (!data.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('返回内容不是有效 PDF，未写入文件');
    entry.state = 'saving'; entry.total = data.length; tab.savePhase = '正在写入文件…'; sendState();
    const staging = path.join(path.dirname(destination), `.${path.basename(destination)}.${randomUUID()}.part`);
    const handle = await fs.promises.open(staging, 'wx');
    temporaryPath = staging;
    try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
    await fs.promises.rename(staging, destination); temporaryPath = null;
    entry.state = 'completed'; entry.received = data.length;
    message(`PDF 已保存：${destination}`);
  } catch (error) {
    if (entry) { entry.state = 'failed'; entry.error = error.message; }
    throw error;
  } finally {
    clearTimeout(timer);
    if (temporaryPath) await fs.promises.unlink(temporaryPath).catch(() => {});
    tab.saving = false; tab.savePhase = ''; sendState();
  }
}
function closeTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;
  mainWindow.contentView.removeChildView(tab.view);
  tabs.delete(id);
  if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
  if (id === activeId) activeId = [...tabs.keys()].at(-1);
  if (!tabs.size) newTab(HOME); else { layout(); sendState(); }
}
async function openExternal(url) {
  if (!isExternalURL(url)) return message('已阻止非网页链接。');
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'question', buttons: ['取消', '用系统浏览器打开'], defaultId: 0, cancelId: 0,
    message: '即将离开内嵌的清华网站', detail: url
  });
  if (result.response === 1) await shell.openExternal(url);
}
function allowedNavigation(url) {
  if (isInternalURL(url)) return true;
  // Chromium's PDF viewer and same-origin blob PDFs are allowed, never arbitrary file: URLs.
  if (url.startsWith(`blob:${SITE}/`)) return true;
  return false;
}
async function applyPatch(tab) {
  if (tab.view.webContents.isDestroyed() || !isSiteURL(tab.view.webContents.getURL())) return;
  try { tab.patched = await tab.view.webContents.executeJavaScript(PATCH_SCRIPT); }
  catch { tab.patched = false; }
  sendState();
}
async function runPendingSearch(tab) {
  if (!tab.pendingSearch || tab.view.webContents.isDestroyed()) return;
  const options = tab.pendingSearch;
  tab.pendingSearch = null;
  try {
    await applyPatch(tab);
    await tab.view.webContents.executeJavaScript(quickSearchScript(options));
    message('已提交检索；学科名按“专业”字段查询。');
  } catch (error) { message(`检索未提交：${error.message}`); }
}
async function capturePaperMetadata(tab) {
  const wc = tab.view.webContents;
  const url = wc.isDestroyed() ? '' : wc.getURL();
  if (!isSummaryURL(url)) return;
  try {
    const paper = await wc.executeJavaScript(READ_METADATA_SCRIPT);
    if (!wc.isDestroyed() && wc.getURL() === url) tab.paper = paper;
  } catch { /* The summary may have navigated away. */ }
}
function inheritsPaper(previous, url) {
  const pdfPath = value => { try { return isSiteURL(value) && new URL(value).pathname === '/pdf/generic/web/viewer.html'; } catch { return false; } };
  const initialBlank = !previous || previous === 'about:blank';
  return (pdfPath(url) && (isSummaryURL(previous) || previous === url || initialBlank)) || (url === 'about:blank' && initialBlank);
}
function newTab(url = HOME, options = {}) {
  const view = new WebContentsView({ ...(options.webContents ? { webContents: options.webContents } : {}), webPreferences: {
    ...options.webPreferences, partition: PARTITION, nodeIntegration: false, contextIsolation: true, sandbox: true,
    webSecurity: true, allowRunningInsecureContent: false, plugins: true,
    navigateOnDragDrop: false,
    // Never inherit privileges or a preload from window.open's features.
    preload: undefined, nodeIntegrationInSubFrames: false, nodeIntegrationInWorker: false
  } });
  const tab = { id: nextTabId++, view, title: '正在载入…', loading: true, patched: false, error: '', pendingSearch: null, pdf: { isViewer: false, ready: false, pages: 0 }, saving: false, paper: null, metadataGeneration: 0 };
  tabs.set(tab.id, tab);
  mainWindow.contentView.addChildView(view);
  const wc = view.webContents;
  tab.committedURL = wc.getURL();
  if (options.paperPromise) {
    const generation = tab.metadataGeneration;
    void options.paperPromise.then(paper => {
      if (!wc.isDestroyed() && tab.metadataGeneration === generation) {
        tab.paper = paper; void inspectPDF(tab);
      }
    });
  }
  wc.setZoomFactor(0.9);
  wc.on('page-title-updated', (_event, title) => { tab.title = title; sendState(); });
  wc.on('did-start-loading', () => { tab.loading = true; tab.error = ''; sendState(); });
  wc.on('did-stop-loading', () => { tab.loading = false; sendState(); });
  wc.on('did-start-navigation', (_e, url, inPlace, isMainFrame) => {
    if (isMainFrame && !inPlace) {
      // Only a summary -> PDF transition (including its blank popup) inherits metadata.
      if (!inheritsPaper(tab.committedURL, url)) tab.metadataGeneration++;
      tab.patched = false; tab.pdf = { isViewer: false, ready: false, pages: 0 }; sendState();
    }
  });
  wc.on('dom-ready', () => { void capturePaperMetadata(tab); void applyPatch(tab); });
  wc.on('did-finish-load', async () => {
    await applyPatch(tab); await runPendingSearch(tab);
    await capturePaperMetadata(tab);
    await inspectPDF(tab); sendState();
  });
  wc.on('did-navigate', (_event, url) => {
    // An attachment starts navigation but never commits a new page. Keep its
    // originating summary metadata until will-download has selected the name.
    if (!inheritsPaper(tab.committedURL, url)) tab.paper = null;
    tab.committedURL = url; sendState();
  });
  wc.on('did-navigate-in-page', () => sendState());
  wc.on('did-fail-load', (_e, code, description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) { tab.error = `${description} (${code})`; message('网页加载失败，请检查网络、校园网/VPN后点击刷新。'); }
  });
  for (const eventName of ['will-navigate', 'will-redirect']) wc.on(eventName, (event, target) => {
    if (!allowedNavigation(target)) { event.preventDefault(); void openExternal(target); }
  });
  // createWindow preserves window.opener, POST bodies, referrers and login popups.
  wc.setWindowOpenHandler(details => {
    if (!allowedNavigation(details.url) && details.url !== 'about:blank') {
      void openExternal(details.url); return { action: 'deny' };
    }
    return { action: 'allow', createWindow: popupOptions => {
      // Snapshot the exact opener, not whichever detail tab happens to be active later.
      const sourceURL = wc.getURL();
      const paperPromise = isSummaryURL(sourceURL)
        ? wc.executeJavaScript(READ_METADATA_SCRIPT).then(paper => paper?.sourceURL === sourceURL ? paper : null).catch(() => null)
        : Promise.resolve(null);
      const popup = newTab(null, { ...popupOptions, paperPromise, webPreferences: { ...popupOptions.webPreferences,
        partition: PARTITION, nodeIntegration: false, contextIsolation: true, sandbox: true,
        webSecurity: true, allowRunningInsecureContent: false } });
      return popup.view.webContents;
    } };
  });
  wc.on('close', () => { if (tabs.has(tab.id)) setImmediate(() => closeTab(tab.id)); });
  wc.on('context-menu', (_e, params) => {
    const template = [
      { label: '后退', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
      { label: '刷新', click: () => wc.reload() },
      { type: 'separator' },
      { label: '复制', role: 'copy', enabled: !!params.selectionText },
      { label: '粘贴', role: 'paste', enabled: params.isEditable },
      { label: '全选', role: 'selectAll' }
    ];
    if (params.linkURL) template.push({ label: '在新标签页打开链接', enabled: allowedNavigation(params.linkURL), click: () => newTab(params.linkURL) });
    Menu.buildFromTemplate(template).popup({ window: mainWindow });
  });
  wc.on('before-input-event', (event, input) => {
    const cmd = input.control || input.meta;
    if (input.type !== 'keyDown') return;
    if (cmd && input.key.toLowerCase() === 'w') { event.preventDefault(); closeTab(tab.id); }
    if (cmd && input.key.toLowerCase() === 'r') { event.preventDefault(); wc.reload(); }
    if (input.key === 'F5') { event.preventDefault(); wc.reload(); }
  });
  selectTab(tab.id);
  if (url) void wc.loadURL(url).catch(() => {});
  return tab;
}

function setupDownloads() {
  siteSession.on('will-download', (_event, item, source) => {
    const id = nextDownloadId++;
    const tab = [...tabs.values()].find(t => t.view.webContents === source);
    const filename = (item.getMimeType() === 'application/pdf' || /\.pdf$/i.test(item.getFilename())) && tab?.paper
      ? buildPaperFilename(tab.paper, item.getFilename()) : path.basename(item.getFilename());
    const entry = { id, filename, state: 'progressing', received: 0, total: item.getTotalBytes(), path: '', item };
    downloads.set(id, entry);
    item.setSaveDialogOptions({
      title: '保存下载文件', defaultPath: path.join(settings.downloadDirectory || app.getPath('downloads'), filename)
    });
    panel = 'downloads'; layout(); sendState();
    item.on('updated', (_e, state) => {
      Object.assign(entry, { state, received: item.getReceivedBytes(), total: item.getTotalBytes(), path: item.getSavePath() });
      sendState();
    });
    item.once('done', (_e, state) => {
      Object.assign(entry, { state, received: item.getReceivedBytes(), total: item.getTotalBytes(), path: item.getSavePath(), item: null });
      message(state === 'completed' ? `下载完成：${entry.filename}` : `下载${state === 'cancelled' ? '已取消' : '中断'}：${entry.filename}`);
    });
  });
}

async function command(action, payload) {
  const tab = active(); const wc = tab?.view.webContents;
  switch (action) {
    case 'state': sendState(); break;
    case 'back': if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); break;
    case 'forward': if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); break;
    case 'reload': wc?.reload(); break;
    case 'save-pdf': await saveCurrentPDF(tab); break;
    case 'home': newTab(HOME); break;
    case 'select': selectTab(Number(payload)); break;
    case 'close': closeTab(Number(payload)); break;
    case 'navigate': {
      if (typeof payload !== 'string' || payload.length > 4096) throw new Error('无效网址');
      if (isInternalURL(payload)) await wc?.loadURL(payload); else await openExternal(payload);
      break;
    }
    case 'search': {
      const options = normalizeSearch(payload);
      settings.search = options; saveSettings();
      let target = tab;
      if (!target || !isSiteURL(wc.getURL()) || !new URL(wc.getURL()).pathname.endsWith('/cjjs')) target = newTab(null);
      target.pendingSearch = options;
      if (isSiteURL(target.view.webContents.getURL()) && !target.loading) await runPendingSearch(target);
      else await target.view.webContents.loadURL(HOME);
      break;
    }
    case 'panel': panel = panel === payload ? '' : (['downloads', 'help'].includes(payload) ? payload : ''); layout(); sendState(); break;
    case 'external': if (wc) await openExternal(wc.getURL()); break;
    case 'copy': if (wc) clipboard.writeText(wc.getURL()); message('已复制当前论文网址。'); break;
    case 'choose-directory': {
      const result = await dialog.showOpenDialog(mainWindow, { title: '选择默认下载目录', defaultPath: settings.downloadDirectory || app.getPath('downloads'), properties: ['openDirectory', 'createDirectory'] });
      if (!result.canceled) { settings.downloadDirectory = result.filePaths[0]; saveSettings(); sendState(); }
      break;
    }
    case 'open-directory': await shell.openPath(settings.downloadDirectory || app.getPath('downloads')); break;
    case 'reveal': { const d = downloads.get(Number(payload)); if (d?.path && d.state === 'completed') shell.showItemInFolder(d.path); break; }
    case 'cancel-download': downloads.get(Number(payload))?.item?.cancel(); break;
    default: throw new Error('不支持的操作');
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400, height: 960, minWidth: 1050, minHeight: 680, show: false,
    title: '论文检索 · Thesis Browser', backgroundColor: '#f4f5f9',
    icon: path.join(__dirname, '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon-256.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true }
  });
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.on('resize', layout);
  mainWindow.on('close', confirmExit);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    for (const t of tabs.values()) if (!t.view.webContents.isDestroyed()) t.view.webContents.close();
    tabs.clear(); mainWindow = null;
  });
  mainWindow.webContents.on('did-finish-load', sendState);
  void mainWindow.loadFile(path.join(__dirname, 'shell.html'));
  newTab(HOME);
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock?.setIcon(path.join(__dirname, '..', 'assets', 'icon.png'));
  settings = readSettings();
  siteSession = session.fromPartition(PARTITION);
  siteSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  siteSession.setPermissionCheckHandler(() => false);
  // Do not bypass certificate failures or alter the site's login/download authorization.
  setupDownloads();
  const pdfTimer = setInterval(() => { void inspectPDF(active()); }, 1000);
  pdfTimer.unref();
  ipcMain.handle('browser:command', async (event, action, payload) => {
    if (!mainWindow || !isTrustedShellSender(event, mainWindow.webContents, SHELL_FILE)) {
      throw new Error('Untrusted IPC sender');
    }
    try { await command(action, payload); return { ok: true }; }
    catch (error) { message(error.message); return { ok: false, error: error.message }; }
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { label: '文件', submenu: [
      { label: '新建检索标签页', accelerator: 'CmdOrCtrl+T', click: () => newTab(HOME) },
      { label: '关闭当前标签页', accelerator: 'CmdOrCtrl+W', click: () => closeTab(activeId) },
      { type: 'separator' }, { role: 'quit', label: '退出' }
    ] },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '查看', submenu: [
      { label: '刷新网页', accelerator: 'CmdOrCtrl+R', click: () => active()?.view.webContents.reload() },
      { label: '放大网页', accelerator: 'CmdOrCtrl+Plus', click: () => { const wc = active()?.view.webContents; if (wc) wc.setZoomFactor(Math.min(2, wc.getZoomFactor() + 0.1)); } },
      { label: '缩小网页', accelerator: 'CmdOrCtrl+-', click: () => { const wc = active()?.view.webContents; if (wc) wc.setZoomFactor(Math.max(0.5, wc.getZoomFactor() - 0.1)); } },
      { role: 'togglefullscreen', label: '全屏' }
    ] }
  ]));
  createWindow();
  app.on('activate', () => { if (!mainWindow) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', confirmExit);
